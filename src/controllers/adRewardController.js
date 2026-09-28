const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const AdminAdRewardSettingsController = require('./admin/adRewardSettingsController');

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
   * POST /api/v1/ad-reward-settings/watch
   * Called after a user watches an ad for a specific reward option, tier, or episode.
   *
   * Request body parameters (all optional with smart defaults):
   *   option_id / tier_id : number  — ID of the reward option/tier selected (1, 2, 3, 4)
   *   reward_coins / coins: number  — optional explicit reward coins to credit
   *   ads_count           : number  — optional number of ads watched (default 1)
   *   episode_id          : number  — optional episode ID if watching for episode access
   *   ad_type             : string  — optional label ('rewarded', 'interstitial')
   *   reference_id        : string  — optional ad network transaction ID
   *
   * Returns:
   *   coins_earned, reward_coins, option_id, ads_watched, and updated status data (wallet, daily_ad_status, reward_options, limit_message)
   */
  static async watch(req, res) {
    try {
      const userId = req.user.id;
      const {
        ads_count,
        option_id,
        tier_id,
        reward_coins,
        coins,
        ad_type = 'rewarded',
        reference_id = null,
        episode_id = null,
      } = req.body;

      // ── 1. Read Settings ───────────────────────────────────────────────────
      const [settingsRows] = await pool.query(
        `SELECT \`key\`, \`value\` FROM settings
         WHERE \`key\` IN ('coins_per_ad', 'max_ads_per_day', 'ad_reward_enabled', 'ad_reward_tiers')`
      );
      const settingsMap = {};
      settingsRows.forEach((r) => { settingsMap[r.key] = r.value; });

      const adRewardEnabled = (settingsMap.ad_reward_enabled ?? '1') === '1';
      if (!adRewardEnabled) {
        return ApiResponse.error(res, 'Ad rewards are currently disabled.', 400);
      }

      const defaultCoinsPerAd = parseFloat(settingsMap.coins_per_ad ?? '1') || 1;
      const maxAdsPerDay = parseInt(settingsMap.max_ads_per_day ?? '20', 10) || 20;

      let rawTiers = [];
      try {
        rawTiers = settingsMap.ad_reward_tiers ? JSON.parse(settingsMap.ad_reward_tiers) : AdminAdRewardSettingsController._defaultTiers();
      } catch (_) {
        rawTiers = AdminAdRewardSettingsController._defaultTiers();
      }
      if (!Array.isArray(rawTiers) || rawTiers.length === 0) {
        rawTiers = AdminAdRewardSettingsController._defaultTiers();
      }

      const selectedOptionId = option_id !== undefined && option_id !== null && option_id !== ''
        ? option_id
        : (tier_id !== undefined && tier_id !== null && tier_id !== '' ? tier_id : null);

      let targetTier = null;
      if (selectedOptionId !== null) {
        targetTier = rawTiers.find((t, idx) => String(t.id ?? (idx + 1)) === String(selectedOptionId));
      }

      const hasEpisode = episode_id !== undefined && episode_id !== null && String(episode_id).trim() !== '';

      let episode = null;
      let rewardCoinsToAward = null;

      // Priority 1: If client explicitly passed reward_coins or coins in the request body
      const bodyRewardCoins = reward_coins !== undefined
        ? parseFloat(reward_coins)
        : (coins !== undefined ? parseFloat(coins) : null);

      if (bodyRewardCoins !== null && !isNaN(bodyRewardCoins) && bodyRewardCoins > 0) {
        rewardCoinsToAward = bodyRewardCoins;
      }

      if (hasEpisode) {
        const epId = parseInt(episode_id, 10);
        if (isNaN(epId) || epId <= 0) {
          return ApiResponse.error(res, 'Invalid episode_id provided.', 422);
        }

        const [epRows] = await pool.query(
          'SELECT id, title, position, coins, story_id FROM episodes WHERE id = ? LIMIT 1',
          [epId]
        );

        if (!epRows || epRows.length === 0) {
          return ApiResponse.error(res, 'Episode not found.', 404);
        }

        episode = epRows[0];
        if (rewardCoinsToAward === null) {
          const epCoins = Number(episode.coins);
          rewardCoinsToAward = (!isNaN(epCoins) && epCoins > 0) ? epCoins : defaultCoinsPerAd;
        }
      } else if (targetTier) {
        // Priority 2: Use the option ID's specific reward_coins (not default setting coins!)
        if (rewardCoinsToAward === null) {
          const tierReward = Number(targetTier.reward_coins ?? targetTier.coins);
          rewardCoinsToAward = (!isNaN(tierReward) && tierReward > 0) ? tierReward : defaultCoinsPerAd;
        }
      } else {
        // Priority 3: Fallback if no option_id, no episode, no body reward_coins
        if (rewardCoinsToAward === null) {
          const count = ads_count ? parseInt(ads_count, 10) : 1;
          const validCount = (!isNaN(count) && count > 0) ? count : 1;
          rewardCoinsToAward = validCount * defaultCoinsPerAd;
        }
      }

      rewardCoinsToAward = Math.round(rewardCoinsToAward);
      if (rewardCoinsToAward <= 0) {
        return ApiResponse.error(res, 'No coins to award.', 422);
      }

      // ── 2. Check Daily Limit ───────────────────────────────────────────────
      const [[{ adCountToday }]] = await pool.query(
        `SELECT COUNT(*) AS adCountToday
         FROM coin_transactions
         WHERE user_id = ? AND type = 'ad_reward' AND DATE(created_at) = CURDATE()`,
        [userId]
      );
      const adsAlreadyWatched = Number(adCountToday || 0);
      const adsRemainingToday = Math.max(0, maxAdsPerDay - adsAlreadyWatched);

      if (adsRemainingToday <= 0) {
        const statusData = await AdminAdRewardSettingsController.getAdRewardStatusData(userId);
        return ApiResponse.error(
          res,
          `Daily ad reward limit reached. You have watched ${adsAlreadyWatched}/${maxAdsPerDay} ads today.`,
          429,
          statusData
        );
      }

      // ── 3. DB Transaction: Credit wallet & insert transaction row ─────────
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        await connection.query(
          'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
          [rewardCoinsToAward, userId]
        );

        const adIndex = adsAlreadyWatched + 1;
        const description = episode
          ? `Ad Reward — ${ad_type} ad watched for Episode #${episode.position || episode.id}: ${episode.title}`
          : (targetTier
              ? `Ad Reward — ${targetTier.title || targetTier.label || `Option #${selectedOptionId}`} (+${rewardCoinsToAward} coins)`
              : `Ad Reward — ${ad_type} ad #${adIndex} watched (+${rewardCoinsToAward} coins)`);

        await connection.query(
          `INSERT INTO coin_transactions (user_id, type, coins, description, reference_id, created_at)
           VALUES (?, 'ad_reward', ?, ?, ?, NOW())`,
          [userId, rewardCoinsToAward, description, reference_id || null]
        );

        await connection.commit();
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }

      // ── 4. Fetch fresh ad reward status data for instant UI refresh ───────
      const statusData = await AdminAdRewardSettingsController.getAdRewardStatusData(userId);

      return ApiResponse.success(res, {
        coins_earned: rewardCoinsToAward,
        reward_coins: rewardCoinsToAward,
        option_id: selectedOptionId ? Number(selectedOptionId) : null,
        ads_watched: 1,
        ...statusData,
      }, `${rewardCoinsToAward} coin${rewardCoinsToAward > 1 ? 's' : ''} credited for ad reward.`);
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
