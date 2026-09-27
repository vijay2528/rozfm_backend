const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

// ── Helper: Format date to ISO string with timezone offset (+05:30) ────────
function formatIsoTime(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;

  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const tzOffset = -d.getTimezoneOffset();
  const diffSign = tzOffset >= 0 ? '+' : '-';
  const offsetHours = pad(tzOffset / 60);
  const offsetMins = pad(tzOffset % 60);

  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${diffSign}${offsetHours}:${offsetMins}`;
}

class AdminAdRewardSettingsController {
  /**
   * GET /api/v1/admin/ad-reward-settings
   *
   * Returns current ad reward options, daily ad status, wallet coins and limit messages.
   */
  static async getSettings(req, res) {
    try {
      // Fetch all ad reward related keys from settings table
      const [rows] = await pool.query(
        `SELECT \`key\`, \`value\` FROM settings
         WHERE \`key\` IN (
           'coins_per_ad',
           'max_ads_per_day',
           'daily_reset_hour',
           'ad_reward_enabled',
           'ad_reward_tiers',
           'instant_reward',
           'no_limit_mode'
         )`
      );

      const map = {};
      rows.forEach((r) => { map[r.key] = r.value; });

      const coinsPerAd = parseFloat(map.coins_per_ad ?? '1');
      const maxAdsPerDay = parseInt(map.max_ads_per_day ?? '20', 10);
      const dailyResetHour = parseInt(map.daily_reset_hour ?? '0', 10);
      const adRewardEnabled = (map.ad_reward_enabled ?? '1') === '1';

      // Parse tiers JSON safely
      let rawTiers = [];
      try {
        rawTiers = map.ad_reward_tiers ? JSON.parse(map.ad_reward_tiers) : AdminAdRewardSettingsController._defaultTiers();
      } catch (_) {
        rawTiers = AdminAdRewardSettingsController._defaultTiers();
      }
      if (!Array.isArray(rawTiers) || rawTiers.length === 0) {
        rawTiers = AdminAdRewardSettingsController._defaultTiers();
      }

      // Normalize tiers to standard output structure
      const tiers = rawTiers.map((t, idx) => {
        const id = t.id ?? (idx + 1);
        const adsRequired = Number(t.ads_required ?? t.ads_count ?? 1);
        const rewardCoins = Number(t.reward_coins ?? t.coins ?? 1);
        const title = t.title || t.label || `${rewardCoins} Coin${rewardCoins > 1 ? 's' : ''}`;
        const description = t.description || t.subtitle || (adsRequired === 1 ? 'Per Ad' : `Watch ${adsRequired} ads`);
        return {
          id,
          title,
          description,
          ads_required: adsRequired,
          reward_coins: rewardCoins,
        };
      });

      // Target user determination
      const targetUserId = req.query.user_id || req.user?.id || null;
      let walletCoins = 0;
      let todayTxTimestamps = [];

      if (targetUserId) {
        const [[userRow]] = await pool.query(
          'SELECT COALESCE(wallet_balance, 0) AS wallet_balance FROM users WHERE id = ? LIMIT 1',
          [targetUserId]
        );
        if (userRow) {
          walletCoins = Number(userRow.wallet_balance || 0);
        }

        const [txRows] = await pool.query(
          `SELECT created_at FROM coin_transactions
           WHERE user_id = ? AND type = 'ad_reward' AND DATE(created_at) = CURDATE()
           ORDER BY created_at ASC`,
          [targetUserId]
        );
        todayTxTimestamps = txRows.map((r) => new Date(r.created_at));
      }

      const watchedToday = todayTxTimestamps.length;
      const dailyLimit = maxAdsPerDay;
      const remainingToday = Math.max(0, dailyLimit - watchedToday);
      const limitReached = watchedToday >= dailyLimit;
      const canWatchAds = !limitReached && adRewardEnabled && remainingToday > 0;

      const lastAdWatchedAt = watchedToday > 0 ? formatIsoTime(todayTxTimestamps[watchedToday - 1]) : null;
      const limitReachedAt = (limitReached && watchedToday > 0)
        ? formatIsoTime(todayTxTimestamps[Math.min(watchedToday - 1, dailyLimit - 1)])
        : null;

      // Calculate next reset time
      const now = new Date();
      const nextReset = new Date(now);
      nextReset.setHours(dailyResetHour, 0, 0, 0);
      if (now >= nextReset) {
        nextReset.setDate(nextReset.getDate() + 1);
      }
      const nextResetAt = formatIsoTime(nextReset);
      const resetInSeconds = Math.max(0, Math.floor((nextReset.getTime() - now.getTime()) / 1000));

      // Compute reward options tier progress
      let cumulativeAds = 0;
      let optionCanWatchAssigned = false;

      const rewardOptions = tiers.map((tier) => {
        const startIndex = cumulativeAds;
        const adsReq = tier.ads_required;
        const endIndex = startIndex + adsReq;
        cumulativeAds = endIndex;

        const adsWatchedForTier = Math.max(0, Math.min(adsReq, watchedToday - startIndex));
        const adsRemainingForTier = adsReq - adsWatchedForTier;
        const isCompleted = adsWatchedForTier >= adsReq;

        let status = 'pending';
        let canWatch = false;

        if (isCompleted) {
          status = 'completed';
          canWatch = false;
        } else if (adsWatchedForTier > 0) {
          status = 'in_progress';
          if (canWatchAds && !optionCanWatchAssigned) {
            canWatch = true;
            optionCanWatchAssigned = true;
          }
        } else {
          if (startIndex <= watchedToday) {
            status = 'available';
            if (canWatchAds && !optionCanWatchAssigned) {
              canWatch = true;
              optionCanWatchAssigned = true;
            }
          } else {
            status = 'locked';
            canWatch = false;
          }
        }

        const startedAt = todayTxTimestamps.length > startIndex ? formatIsoTime(todayTxTimestamps[startIndex]) : null;
        const tierLastWatchedAt = adsWatchedForTier > 0 && todayTxTimestamps.length >= (startIndex + adsWatchedForTier)
          ? formatIsoTime(todayTxTimestamps[startIndex + adsWatchedForTier - 1])
          : null;
        const completedAt = isCompleted && todayTxTimestamps.length >= endIndex
          ? formatIsoTime(todayTxTimestamps[endIndex - 1])
          : null;

        return {
          id: tier.id,
          title: tier.title,
          description: tier.description,
          ads_required: adsReq,
          reward_coins: tier.reward_coins,
          ads_watched: adsWatchedForTier,
          ads_remaining: adsRemainingForTier,
          status: status,
          is_completed: isCompleted,
          can_watch: canWatch,
          started_at: startedAt,
          last_ad_watched_at: tierLastWatchedAt,
          completed_at: completedAt,
        };
      });

      const limitMessage = {
        show: limitReached,
        limit_reached_at: limitReached ? limitReachedAt : null,
        available_again_at: nextResetAt,
      };

      return ApiResponse.success(res, {
        wallet: {
          coins: walletCoins,
        },
        daily_ad_status: {
          daily_limit: dailyLimit,
          watched_today: watchedToday,
          remaining_today: remainingToday,
          limit_reached: limitReached,
          can_watch_ads: canWatchAds,
          last_ad_watched_at: lastAdWatchedAt,
          limit_reached_at: limitReachedAt,
          next_reset_at: nextResetAt,
          reset_in_seconds: resetInSeconds,
        },
        reward_options: rewardOptions,
        limit_message: limitMessage,
      }, 'Ad rewards fetched successfully');
    } catch (error) {
      console.error('Admin Get Ad Reward Settings Error:', error);
      return ApiResponse.error(res, 'Failed to fetch ad reward settings.', 500);
    }
  }

  /**
   * PUT /api/v1/admin/ad-reward-settings
   * POST /api/v1/admin/ad-reward-settings
   *
   * Update any subset of ad reward settings.
   *
   * Accepted body fields:
   *   coins_per_ad       : number  — coins per ad (min 0)
   *   max_ads_per_day    : number  — max ads per day (min 1)
   *   daily_reset_hour   : number  — 0-23
   *   ad_reward_enabled  : bool/0/1
   *   instant_reward     : bool/0/1
   *   no_limit_mode      : bool/0/1
   *   ad_reward_tiers    : array   — [{ ads_count: 1, coins: 1, label: "1 Coin" }, ...]
   */
  static async updateSettings(req, res) {
    try {
      const body = req.body;

      const updates = {};

      // ── coins_per_ad ───────────────────────────────────────────────────────
      if (body.coins_per_ad !== undefined) {
        const val = parseFloat(body.coins_per_ad);
        if (isNaN(val) || val < 0) {
          return ApiResponse.error(res, 'coins_per_ad must be a non-negative number.', 422);
        }
        updates.coins_per_ad = String(val);
      }

      // ── max_ads_per_day ────────────────────────────────────────────────────
      if (body.max_ads_per_day !== undefined) {
        const val = parseInt(body.max_ads_per_day, 10);
        if (isNaN(val) || val < 1) {
          return ApiResponse.error(res, 'max_ads_per_day must be an integer >= 1.', 422);
        }
        updates.max_ads_per_day = String(val);
      }

      // ── daily_reset_hour ───────────────────────────────────────────────────
      if (body.daily_reset_hour !== undefined) {
        const val = parseInt(body.daily_reset_hour, 10);
        if (isNaN(val) || val < 0 || val > 23) {
          return ApiResponse.error(res, 'daily_reset_hour must be between 0 and 23.', 422);
        }
        updates.daily_reset_hour = String(val);
      }

      // ── Boolean flags ──────────────────────────────────────────────────────
      const boolFlags = ['ad_reward_enabled', 'instant_reward', 'no_limit_mode'];
      for (const flag of boolFlags) {
        if (body[flag] !== undefined) {
          const raw = body[flag];
          const val = (raw === true || raw === 1 || raw === '1' || raw === 'true') ? '1' : '0';
          updates[flag] = val;
        }
      }

      // ── ad_reward_tiers ────────────────────────────────────────────────────
      if (body.ad_reward_tiers !== undefined) {
        let tiers = body.ad_reward_tiers;

        // Allow JSON string input
        if (typeof tiers === 'string') {
          try { tiers = JSON.parse(tiers); } catch (_) {
            return ApiResponse.error(res, 'ad_reward_tiers must be a valid JSON array.', 422);
          }
        }

        if (!Array.isArray(tiers)) {
          return ApiResponse.error(res, 'ad_reward_tiers must be an array.', 422);
        }

        // Validate each tier
        for (let i = 0; i < tiers.length; i++) {
          const t = tiers[i];
          if (typeof t.ads_count !== 'number' || t.ads_count < 1) {
            return ApiResponse.error(res, `Tier[${i}].ads_count must be a positive integer.`, 422);
          }
          if (typeof t.coins !== 'number' || t.coins < 0) {
            return ApiResponse.error(res, `Tier[${i}].coins must be a non-negative number.`, 422);
          }
        }

        updates.ad_reward_tiers = JSON.stringify(tiers);
      }

      if (Object.keys(updates).length === 0) {
        return ApiResponse.error(res, 'No valid settings fields provided.', 422);
      }

      // Persist each key
      for (const [key, value] of Object.entries(updates)) {
        await upsertSetting(key, value);
      }

      // Return updated settings
      const [rows] = await pool.query(
        `SELECT \`key\`, \`value\` FROM settings
         WHERE \`key\` IN (
           'coins_per_ad',
           'max_ads_per_day',
           'daily_reset_hour',
           'ad_reward_enabled',
           'ad_reward_tiers',
           'instant_reward',
           'no_limit_mode'
         )`
      );

      const map = {};
      rows.forEach((r) => { map[r.key] = r.value; });

      let tiers = [];
      try {
        tiers = map.ad_reward_tiers ? JSON.parse(map.ad_reward_tiers) : AdminAdRewardSettingsController._defaultTiers();
      } catch (_) {
        tiers = AdminAdRewardSettingsController._defaultTiers();
      }

      const settings = {
        coins_per_ad:       parseFloat(map.coins_per_ad       ?? '1'),
        max_ads_per_day:    parseInt(map.max_ads_per_day       ?? '10', 10),
        daily_reset_hour:   parseInt(map.daily_reset_hour      ?? '0', 10),
        ad_reward_enabled:  (map.ad_reward_enabled ?? '1') === '1',
        instant_reward:     (map.instant_reward    ?? '1') === '1',
        no_limit_mode:      (map.no_limit_mode     ?? '0') === '1',
        ad_reward_tiers:    tiers,
      };

      return ApiResponse.success(res, { settings }, 'Ad reward settings updated successfully.');
    } catch (error) {
      console.error('Admin Update Ad Reward Settings Error:', error);
      return ApiResponse.error(res, 'Failed to update ad reward settings.', 500);
    }
  }

  /**
   * GET /api/v1/admin/ad-reward-settings/stats
   *
   * Summary statistics about ad reward usage across all users.
   * Returns:
   *   - total_ad_rewards_today     : total ad reward transactions created today
   *   - total_coins_rewarded_today : total coins given for ad watches today
   *   - unique_users_today         : distinct users who earned ad rewards today
   *   - total_ad_rewards_alltime   : all time ad reward transactions
   *   - total_coins_rewarded_alltime
   *   - top_users_today            : top 10 users by coins earned via ads today
   */
  static async getStats(req, res) {
    try {
      // Today summary
      const [[todaySummary]] = await pool.query(
        `SELECT
           COUNT(*)            AS total_ad_rewards_today,
           COALESCE(SUM(coins), 0) AS total_coins_rewarded_today,
           COUNT(DISTINCT user_id) AS unique_users_today
         FROM coin_transactions
         WHERE type = 'ad_reward' AND DATE(created_at) = CURDATE()`
      );

      // All-time summary
      const [[alltimeSummary]] = await pool.query(
        `SELECT
           COUNT(*)                AS total_ad_rewards_alltime,
           COALESCE(SUM(coins), 0) AS total_coins_rewarded_alltime
         FROM coin_transactions
         WHERE type = 'ad_reward'`
      );

      // Top users today
      const [topUsers] = await pool.query(
        `SELECT
           ct.user_id,
           u.name,
           u.email,
           COUNT(*) AS ads_watched,
           SUM(ct.coins) AS coins_earned
         FROM coin_transactions ct
         JOIN users u ON u.id = ct.user_id
         WHERE ct.type = 'ad_reward' AND DATE(ct.created_at) = CURDATE()
         GROUP BY ct.user_id, u.name, u.email
         ORDER BY coins_earned DESC
         LIMIT 10`
      );

      return ApiResponse.success(res, {
        today: {
          total_ad_rewards:       Number(todaySummary.total_ad_rewards_today),
          total_coins_rewarded:   Number(todaySummary.total_coins_rewarded_today),
          unique_users:           Number(todaySummary.unique_users_today),
        },
        alltime: {
          total_ad_rewards:       Number(alltimeSummary.total_ad_rewards_alltime),
          total_coins_rewarded:   Number(alltimeSummary.total_coins_rewarded_alltime),
        },
        top_users_today: topUsers.map((u) => ({
          user_id:      u.user_id,
          name:         u.name,
          email:        u.email,
          ads_watched:  Number(u.ads_watched),
          coins_earned: Number(u.coins_earned),
        })),
      }, 'Ad reward stats fetched successfully.');
    } catch (error) {
      console.error('Admin Ad Reward Stats Error:', error);
      return ApiResponse.error(res, 'Failed to fetch ad reward stats.', 500);
    }
  }

  /**
   * POST /api/v1/admin/ad-reward-settings/reset-defaults
   * Resets all ad reward settings to factory defaults.
   */
  static async resetDefaults(req, res) {
    try {
      const defaults = {
        coins_per_ad:      '1',
        max_ads_per_day:   '10',
        daily_reset_hour:  '0',
        ad_reward_enabled: '1',
        instant_reward:    '1',
        no_limit_mode:     '0',
        ad_reward_tiers:   JSON.stringify(AdminAdRewardSettingsController._defaultTiers()),
      };

      for (const [key, value] of Object.entries(defaults)) {
        await upsertSetting(key, value);
      }

      return ApiResponse.success(res, {
        settings: {
          coins_per_ad:      1,
          max_ads_per_day:   10,
          daily_reset_hour:  0,
          ad_reward_enabled: true,
          instant_reward:    true,
          no_limit_mode:     false,
          ad_reward_tiers:   AdminAdRewardSettingsController._defaultTiers(),
        },
      }, 'Ad reward settings reset to defaults successfully.');
    } catch (error) {
      console.error('Admin Reset Ad Reward Settings Error:', error);
      return ApiResponse.error(res, 'Failed to reset ad reward settings.', 500);
    }
  }

  // ── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Default tier configuration — mirrors the app UI screenshot:
   *   1 Coin  → Watch 1 Ad
   *   3 Coins → Watch 3 Ads
   *   5 Coins → Watch 5 Ads
   *   10 Coins → Watch 10 Ads
   */
  static _defaultTiers() {
    return [
      { id: 1, title: '1 Coin', description: 'Per Ad', ads_required: 1, reward_coins: 1, ads_count: 1, coins: 1, label: '1 Coin', subtitle: 'Per Ad' },
      { id: 2, title: '3 Coins', description: 'Watch 3 ads', ads_required: 3, reward_coins: 3, ads_count: 3, coins: 3, label: '3 Coins', subtitle: 'Watch 3 ads' },
      { id: 3, title: '5 Coins', description: 'Watch 5 ads', ads_required: 5, reward_coins: 5, ads_count: 5, coins: 5, label: '5 Coins', subtitle: 'Watch 5 ads' },
      { id: 4, title: '10 Coins', description: 'Watch 10 ads', ads_required: 10, reward_coins: 10, ads_count: 10, coins: 10, label: '10 Coins', subtitle: 'Watch 10 ads' },
    ];
  }
}

module.exports = AdminAdRewardSettingsController;
