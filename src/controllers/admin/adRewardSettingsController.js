const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

// ── Helper: Read a single setting value ────────────────────────────────────
async function getSetting(key, fallback = null) {
  const [[row]] = await pool.query(
    'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
    [key]
  );
  if (row && row.value !== null && row.value !== '') {
    return row.value;
  }
  return fallback !== null ? String(fallback) : null;
}

// ── Helper: Upsert a setting key ───────────────────────────────────────────
async function upsertSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
    [key, String(value)]
  );
}

class AdminAdRewardSettingsController {
  /**
   * GET /api/v1/admin/ad-reward-settings
   *
   * Returns current ad reward configuration used by the app.
   * Includes:
   *   - coins_per_ad          : coins awarded per single ad watch
   *   - max_ads_per_day       : max number of ad reward transactions per day per user
   *   - daily_reset_hour      : UTC hour at which the daily limit resets (0-23, default 0)
   *   - ad_reward_enabled     : master on/off switch (1 or 0)
   *   - ad_reward_tiers       : JSON array of tier objects [{ ads_count, coins, label }]
   *   - instant_reward        : whether rewards are applied instantly (1 or 0)
   *   - no_limit_mode         : when 1, the max_ads_per_day cap is removed
   */
  static async getSettings(req, res) {
    try {
      // Fetch all ad reward related keys in one query
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

      // Build map
      const map = {};
      rows.forEach((r) => { map[r.key] = r.value; });

      // Parse tiers JSON safely
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

      return ApiResponse.success(res, { settings }, 'Ad reward settings fetched successfully.');
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
      { ads_count: 1,  coins: 1,  label: '1 Coin',   subtitle: 'Per Ad' },
      { ads_count: 3,  coins: 3,  label: '3 Coins',  subtitle: 'Watch 3 ads' },
      { ads_count: 5,  coins: 5,  label: '5 Coins',  subtitle: 'Watch 5 ads' },
      { ads_count: 10, coins: 10, label: '10 Coins', subtitle: 'Watch 10 ads' },
    ];
  }
}

module.exports = AdminAdRewardSettingsController;
