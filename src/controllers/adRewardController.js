const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

/**
 * Default fallback values (used if settings key is missing from the DB).
 */
const DEFAULT_COINS_PER_AD = 10;
const DEFAULT_MAX_ADS_PER_DAY = 10; // safety cap — user cannot earn more than this many ad rewards per day

/**
 * Read a single setting value from the settings table.
 * If the key does not exist, it is auto-inserted with the fallback value (INSERT IGNORE)
 * so subsequent reads always find a row.
 * Returns the numeric value, or the fallback if the stored value is non-numeric.
 */
async function getSetting(key, fallback) {
  try {
    // Try to insert the default first (INSERT IGNORE does nothing if key already exists)
    await pool.query(
      'INSERT IGNORE INTO settings (`key`, `value`) VALUES (?, ?)',
      [key, String(fallback)]
    );

    const [[row]] = await pool.query(
      'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
      [key]
    );
    if (row && row.value !== null && row.value !== '') {
      const num = parseFloat(row.value);
      return isNaN(num) ? fallback : num;
    }
  } catch (err) {
    console.warn(`getSetting("${key}") warning:`, err.message);
  }
  return fallback;
}


class AdRewardController {
  /**
   * GET /api/v1/ads/reward-config
   * Returns the current coins_per_ad setting and today's remaining ad slots for the user.
   * The app can call this before showing ads to display the reward amount.
   */
  static async config(req, res) {
    try {
      const userId = req.user.id;

      const [coinsPerAd, maxAdsPerDay] = await Promise.all([
        getSetting('coins_per_ad', DEFAULT_COINS_PER_AD),
        getSetting('max_ads_per_day', DEFAULT_MAX_ADS_PER_DAY),
      ]);

      // Count ads already watched today by this user
      const [[{ watchedToday }]] = await pool.query(
        `SELECT COALESCE(SUM(ABS(coins)), 0) / ? AS watchedToday
         FROM coin_transactions
         WHERE user_id = ? AND type = 'ad_reward' AND DATE(created_at) = CURDATE()`,
        [coinsPerAd > 0 ? coinsPerAd : 1, userId]
      );

      // Actually count number of ad_reward transactions today
      const [[{ adCountToday }]] = await pool.query(
        `SELECT COUNT(*) AS adCountToday
         FROM coin_transactions
         WHERE user_id = ? AND type = 'ad_reward' AND DATE(created_at) = CURDATE()`,
        [userId]
      );

      const adsWatchedToday = Number(adCountToday || 0);
      const adsRemainingToday = Math.max(0, maxAdsPerDay - adsWatchedToday);
      const canWatchAd = adsRemainingToday > 0;

      // Current wallet balance
      const [[{ wallet_balance }]] = await pool.query(
        'SELECT COALESCE(wallet_balance, 0) AS wallet_balance FROM users WHERE id = ? LIMIT 1',
        [userId]
      );

      return ApiResponse.success(res, {
        coins_per_ad: coinsPerAd,
        max_ads_per_day: maxAdsPerDay,
        ads_watched_today: adsWatchedToday,
        ads_remaining_today: adsRemainingToday,
        can_watch_ad: canWatchAd,
        wallet_balance: Number(wallet_balance || 0),
      }, 'Ad reward config fetched successfully.');
    } catch (error) {
      console.error('Ad Reward Config Error:', error);
      return ApiResponse.error(res, 'Failed to fetch ad reward config.', 500);
    }
  }

  /**
   * POST /api/v1/ads/watch
   * Called after a user watches one or more ads.
   *
   * Request body:
   *   ads_count  : number  — how many ads were watched (e.g. 1, 2, 3)
   *   ad_type    : string  — optional label for the ad type (e.g. 'rewarded', 'interstitial')
   *   reference_id: string — optional ad network transaction/impression ID for deduplication
   *
   * Logic:
   *   1. Read coins_per_ad from settings (default 10)
   *   2. Read max_ads_per_day from settings (default 10)
   *   3. Validate ads_count (must be >= 1, integer)
   *   4. Check how many ads the user has already watched today
   *   5. Cap ads_count so they don't exceed the daily limit
   *   6. Compute total_coins = effective_ads_count * coins_per_ad
   *   7. Credit wallet_balance on the users table
   *   8. Insert one coin_transactions row per ad (type = 'ad_reward')
   *   9. Return new wallet balance + coins earned
   */
  static async watch(req, res) {
    try {
      const userId = req.user.id;
      const {
        ads_count,
        ad_type = 'rewarded',
        reference_id = null,
      } = req.body;

      // ── 1. Validate ads_count ────────────────────────────────────────────────
      const adsCountRaw = parseInt(ads_count, 10);
      if (!ads_count || isNaN(adsCountRaw) || adsCountRaw < 1) {
        return ApiResponse.error(res, 'ads_count must be a positive integer (e.g. 1, 2, 3).', 422);
      }

      // ── 2. Read settings ─────────────────────────────────────────────────────
      const [coinsPerAd, maxAdsPerDay] = await Promise.all([
        getSetting('coins_per_ad', DEFAULT_COINS_PER_AD),
        getSetting('max_ads_per_day', DEFAULT_MAX_ADS_PER_DAY),
      ]);

      // ── 3. Check daily ad count for this user ────────────────────────────────
      const [[{ adCountToday }]] = await pool.query(
        `SELECT COUNT(*) AS adCountToday
         FROM coin_transactions
         WHERE user_id = ? AND type = 'ad_reward' AND DATE(created_at) = CURDATE()`,
        [userId]
      );
      const adsAlreadyWatched = Number(adCountToday || 0);
      const adsRemainingToday = Math.max(0, maxAdsPerDay - adsAlreadyWatched);

      if (adsRemainingToday <= 0) {
        return ApiResponse.error(
          res,
          `Daily ad reward limit reached. You have watched ${adsAlreadyWatched}/${maxAdsPerDay} ads today.`,
          429
        );
      }

      // ── 4. Cap ads_count to the remaining daily quota ────────────────────────
      const effectiveAdsCount = Math.min(adsCountRaw, adsRemainingToday);
      const totalCoins = effectiveAdsCount * coinsPerAd;

      if (totalCoins <= 0) {
        return ApiResponse.error(res, 'No coins to award. Check settings configuration.', 422);
      }

      // ── 5. DB Transaction: credit wallet + insert coin_transactions rows ─────
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // Credit the wallet
        await connection.query(
          'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
          [totalCoins, userId]
        );

        // Insert one coin_transaction row per ad watched
        for (let i = 0; i < effectiveAdsCount; i++) {
          const adIndex = adsAlreadyWatched + i + 1; // e.g. Ad #3 of 10 today
          const description = `Ad Reward — ${ad_type} ad #${adIndex} watched`;
          const refId = effectiveAdsCount === 1
            ? (reference_id || null)
            : (reference_id ? `${reference_id}_${i + 1}` : null);

          await connection.query(
            `INSERT INTO coin_transactions (user_id, type, coins, description, reference_id, created_at)
             VALUES (?, 'ad_reward', ?, ?, ?, NOW())`,
            [userId, coinsPerAd, description, refId]
          );
        }

        await connection.commit();
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }

      // ── 6. Fetch updated wallet balance ───────────────────────────────────────
      const [[{ wallet_balance }]] = await pool.query(
        'SELECT COALESCE(wallet_balance, 0) AS wallet_balance FROM users WHERE id = ? LIMIT 1',
        [userId]
      );

      const newBalance = Number(wallet_balance || 0);
      const totalAdsWatchedToday = adsAlreadyWatched + effectiveAdsCount;

      return ApiResponse.success(res, {
        // Coins earned this request
        ads_watched: effectiveAdsCount,
        coins_per_ad: coinsPerAd,
        coins_earned: totalCoins,
        // Skipped ads (if ads_count exceeded daily limit)
        ads_requested: adsCountRaw,
        ads_skipped: adsCountRaw - effectiveAdsCount,
        skipped_reason: adsCountRaw > effectiveAdsCount ? 'Daily ad limit reached' : null,
        // Wallet
        wallet_balance: newBalance,
        // Daily progress
        ads_watched_today: totalAdsWatchedToday,
        ads_remaining_today: Math.max(0, maxAdsPerDay - totalAdsWatchedToday),
        max_ads_per_day: maxAdsPerDay,
        daily_limit_reached: totalAdsWatchedToday >= maxAdsPerDay,
      }, `${totalCoins} coins credited for watching ${effectiveAdsCount} ad${effectiveAdsCount > 1 ? 's' : ''}.`);
    } catch (error) {
      console.error('Ad Watch Reward Error:', error);
      return ApiResponse.error(res, 'Failed to process ad reward.', 500);
    }
  }

  /**
   * GET /api/v1/ads/history
   * Returns the user's ad reward history (coin_transactions where type = 'ad_reward').
   */
  static async history(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM coin_transactions WHERE user_id = ? AND type = 'ad_reward'`,
        [userId]
      );

      const [rows] = await pool.query(
        `SELECT id, coins, description, reference_id, created_at
         FROM coin_transactions
         WHERE user_id = ? AND type = 'ad_reward'
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [userId, limitNum, offset]
      );

      // Today's summary
      const [[{ todayCoins, todayAds }]] = await pool.query(
        `SELECT
           COALESCE(SUM(coins), 0) AS todayCoins,
           COUNT(*) AS todayAds
         FROM coin_transactions
         WHERE user_id = ? AND type = 'ad_reward' AND DATE(created_at) = CURDATE()`,
        [userId]
      );

      // All-time summary
      const [[{ totalCoins, totalAds }]] = await pool.query(
        `SELECT
           COALESCE(SUM(coins), 0) AS totalCoins,
           COUNT(*) AS totalAds
         FROM coin_transactions
         WHERE user_id = ? AND type = 'ad_reward'`,
        [userId]
      );

      return ApiResponse.success(res, {
        summary: {
          today_ads_watched: Number(todayAds || 0),
          today_coins_earned: Number(todayCoins || 0),
          total_ads_watched: Number(totalAds || 0),
          total_coins_earned: Number(totalCoins || 0),
        },
        transactions: rows.map((r) => ({
          id: r.id,
          coins: Number(r.coins),
          description: r.description,
          reference_id: r.reference_id,
          created_at: r.created_at,
        })),
        total: Number(total),
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(Number(total) / limitNum),
      }, 'Ad reward history fetched successfully.');
    } catch (error) {
      console.error('Ad Reward History Error:', error);
      return ApiResponse.error(res, 'Failed to fetch ad reward history.', 500);
    }
  }
}

module.exports = AdRewardController;
