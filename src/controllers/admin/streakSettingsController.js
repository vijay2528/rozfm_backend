const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

/**
 * Format large numbers into human readable format (e.g. 182K, 64K, 9.2K)
 * @param {number} num
 * @returns {string}
 */
function formatUserCount(num) {
  const n = Number(num || 0);
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

class AdminStreakSettingsController {
  /**
   * GET /api/v1/admin/streak-rewards or /api/v1/admin/streak-rewards/list
   * Returns list of streak reward milestones reading streak_milestone_1_days, streak_milestone_2_days, etc. from settings table.
   */
  static async listStreakRewards(req, res) {
    try {
      const [rows] = await pool.query("SELECT `key`, `value` FROM settings WHERE `key` LIKE 'streak_%'");
      const settingsMap = {};
      (rows || []).forEach((r) => {
        settingsMap[r.key] = r.value;
      });

      const milestone1Days = parseInt(settingsMap.streak_milestone_1_days || '3', 10);
      const milestone1Reward = parseInt(settingsMap.streak_milestone_1_reward || '30', 10);
      const milestone1Name = settingsMap.streak_milestone_1_name || 'First Spark';

      const milestone2Days = parseInt(settingsMap.streak_milestone_2_days || '7', 10);
      const milestone2Reward = parseInt(settingsMap.streak_milestone_2_reward || '100', 10);
      const milestone2Name = settingsMap.streak_milestone_2_name || 'Power Listener';

      const milestone3Days = parseInt(settingsMap.streak_milestone_3_days || '30', 10);
      const milestone3Reward = parseInt(settingsMap.streak_milestone_3_reward || '500', 10);
      const milestone3Name = settingsMap.streak_milestone_3_name || 'Energy Master';

      const milestone4Days = parseInt(settingsMap.streak_milestone_4_days || '100', 10);
      const milestone4Reward = parseInt(settingsMap.streak_milestone_4_reward || '2000', 10);
      const milestone4Name = settingsMap.streak_milestone_4_name || 'Legendary';

      // Calculate count of users at each milestone tier from user_streaks table
      let counts = [{}];
      try {
        const [cntRows] = await pool.query(`
          SELECT 
            SUM(CASE WHEN best_streak_days >= ? OR current_streak_days >= ? THEN 1 ELSE 0 END) AS tier1,
            SUM(CASE WHEN best_streak_days >= ? OR current_streak_days >= ? THEN 1 ELSE 0 END) AS tier2,
            SUM(CASE WHEN best_streak_days >= ? OR current_streak_days >= ? THEN 1 ELSE 0 END) AS tier3,
            SUM(CASE WHEN best_streak_days >= ? OR current_streak_days >= ? THEN 1 ELSE 0 END) AS tier4
          FROM user_streaks
        `, [
          milestone1Days, milestone1Days,
          milestone2Days, milestone2Days,
          milestone3Days, milestone3Days,
          milestone4Days, milestone4Days
        ]);
        counts = cntRows;
      } catch (err) {
        counts = [{}];
      }

      const tier1Count = Number(counts[0]?.tier1 || 0);
      const tier2Count = Number(counts[0]?.tier2 || 0);
      const tier3Count = Number(counts[0]?.tier3 || 0);
      const tier4Count = Number(counts[0]?.tier4 || 0);

      const streakRewards = [
        {
          id: 1,
          key: 'streak_milestone_1',
          name: milestone1Name,
          streak_length: `${milestone1Days} days`,
          days_required: milestone1Days,
          coins: milestone1Reward,
          reward_coins: milestone1Reward,
          reward: `${milestone1Reward} coins`,
          users_at_tier: tier1Count,
          users_at_tier_formatted: formatUserCount(tier1Count),
        },
        {
          id: 2,
          key: 'streak_milestone_2',
          name: milestone2Name,
          streak_length: `${milestone2Days} days`,
          days_required: milestone2Days,
          coins: milestone2Reward,
          reward_coins: milestone2Reward,
          reward: `${milestone2Reward} coins`,
          users_at_tier: tier2Count,
          users_at_tier_formatted: formatUserCount(tier2Count),
        },
        {
          id: 3,
          key: 'streak_milestone_3',
          name: milestone3Name,
          streak_length: `${milestone3Days} days`,
          days_required: milestone3Days,
          coins: milestone3Reward,
          reward_coins: milestone3Reward,
          reward: milestone3Reward === 500 ? `${milestone3Reward} coins + Gold trial` : `${milestone3Reward} coins`,
          users_at_tier: tier3Count,
          users_at_tier_formatted: formatUserCount(tier3Count),
        },
        {
          id: 4,
          key: 'streak_milestone_4',
          name: milestone4Name,
          streak_length: `${milestone4Days} days`,
          days_required: milestone4Days,
          coins: milestone4Reward,
          reward_coins: milestone4Reward,
          reward: milestone4Reward === 2000 ? `2,000 coins + Badge` : `${milestone4Reward} coins`,
          users_at_tier: tier4Count,
          users_at_tier_formatted: formatUserCount(tier4Count),
        },
      ];

      return ApiResponse.success(res, {
        streak_rewards: streakRewards,
        rewards: streakRewards,
        settings: {
          streak_daily_goal_minutes: parseInt(settingsMap.streak_daily_goal_minutes || '15', 10),
          streak_daily_reward_coins: parseInt(settingsMap.streak_daily_reward_coins || '5', 10),
          streak_encouragement_quote: settingsMap.streak_encouragement_quote || "You're building serious energy!",
          streak_milestone_1_days: milestone1Days,
          streak_milestone_1_reward: milestone1Reward,
          streak_milestone_1_name: milestone1Name,
          streak_milestone_2_days: milestone2Days,
          streak_milestone_2_reward: milestone2Reward,
          streak_milestone_2_name: milestone2Name,
          streak_milestone_3_days: milestone3Days,
          streak_milestone_3_reward: milestone3Reward,
          streak_milestone_3_name: milestone3Name,
          streak_milestone_4_days: milestone4Days,
          streak_milestone_4_reward: milestone4Reward,
          streak_milestone_4_name: milestone4Name,
        },
      });
    } catch (error) {
      console.error('Admin List Streak Rewards Error:', error);
      return ApiResponse.error(res, 'Failed to fetch streak reward coins list.', 500);
    }
  }

  /**
   * GET /api/v1/admin/streak-settings
   * Fetch current admin streak configurations
   */
  static async getSettings(req, res) {
    try {
      const [rows] = await pool.query("SELECT `key`, `value` FROM settings WHERE `key` LIKE 'streak_%'");
      const settingsMap = {};
      (rows || []).forEach((r) => {
        settingsMap[r.key] = r.value;
      });

      return ApiResponse.success(res, {
        daily_goal_minutes: parseInt(settingsMap.streak_daily_goal_minutes || '15', 10),
        daily_reward_coins: parseInt(settingsMap.streak_daily_reward_coins || '5', 10),
        encouragement_quote: settingsMap.streak_encouragement_quote || "You're building serious energy!",
        milestone_1_days: parseInt(settingsMap.streak_milestone_1_days || '3', 10),
        milestone_1_reward: parseInt(settingsMap.streak_milestone_1_reward || '30', 10),
        milestone_1_name: settingsMap.streak_milestone_1_name || 'First Spark',
        milestone_2_days: parseInt(settingsMap.streak_milestone_2_days || '7', 10),
        milestone_2_reward: parseInt(settingsMap.streak_milestone_2_reward || '100', 10),
        milestone_2_name: settingsMap.streak_milestone_2_name || 'Power Listener',
        milestone_3_days: parseInt(settingsMap.streak_milestone_3_days || '30', 10),
        milestone_3_reward: parseInt(settingsMap.streak_milestone_3_reward || '500', 10),
        milestone_3_name: settingsMap.streak_milestone_3_name || 'Energy Master',
        milestone_4_days: parseInt(settingsMap.streak_milestone_4_days || '100', 10),
        milestone_4_reward: parseInt(settingsMap.streak_milestone_4_reward || '2000', 10),
        milestone_4_name: settingsMap.streak_milestone_4_name || 'Legendary',
        streak_milestone_1_days: parseInt(settingsMap.streak_milestone_1_days || '3', 10),
        streak_milestone_1_reward: parseInt(settingsMap.streak_milestone_1_reward || '30', 10),
        streak_milestone_2_days: parseInt(settingsMap.streak_milestone_2_days || '7', 10),
        streak_milestone_2_reward: parseInt(settingsMap.streak_milestone_2_reward || '100', 10),
        streak_milestone_3_days: parseInt(settingsMap.streak_milestone_3_days || '30', 10),
        streak_milestone_3_reward: parseInt(settingsMap.streak_milestone_3_reward || '500', 10),
        streak_milestone_4_days: parseInt(settingsMap.streak_milestone_4_days || '100', 10),
        streak_milestone_4_reward: parseInt(settingsMap.streak_milestone_4_reward || '2000', 10),
      });
    } catch (error) {
      console.error('Admin Get Streak Settings Error:', error);
      return ApiResponse.error(res, 'Failed to fetch streak settings.', 500);
    }
  }

  /**
   * POST /api/v1/admin/streak-rewards or PUT /api/v1/admin/streak-rewards/:id
   * Update specific streak reward tier or all settings
   */
  static async updateStreakReward(req, res) {
    try {
      const id = parseInt(req.params.id || req.body.id || '1', 10);
      const { days_required, streak_length, reward_coins, coins, name } = req.body;

      const daysVal = days_required !== undefined ? days_required : (streak_length ? parseInt(streak_length, 10) : null);
      const coinsVal = reward_coins !== undefined ? reward_coins : coins;

      if (id >= 1 && id <= 4) {
        if (daysVal !== null && daysVal !== undefined && !isNaN(daysVal)) {
          await pool.query(
            `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
            [`streak_milestone_${id}_days`, String(daysVal)]
          );
        }
        if (coinsVal !== null && coinsVal !== undefined && !isNaN(coinsVal)) {
          await pool.query(
            `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
            [`streak_milestone_${id}_reward`, String(coinsVal)]
          );
        }
        if (name) {
          await pool.query(
            `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
            [`streak_milestone_${id}_name`, String(name)]
          );
        }
      }

      return await AdminStreakSettingsController.listStreakRewards(req, res);
    } catch (error) {
      console.error('Admin Update Streak Reward Error:', error);
      return ApiResponse.error(res, 'Failed to update streak reward.', 500);
    }
  }

  /**
   * POST /api/v1/admin/streak-settings or PUT /api/v1/admin/streak-settings
   * Update admin streak configurations
   */
  static async updateSettings(req, res) {
    try {
      const {
        daily_goal_minutes,
        daily_reward_coins,
        encouragement_quote,
        milestone_1_days,
        milestone_1_reward,
        milestone_1_name,
        milestone_2_days,
        milestone_2_reward,
        milestone_2_name,
        milestone_3_days,
        milestone_3_reward,
        milestone_3_name,
        milestone_4_days,
        milestone_4_reward,
        milestone_4_name,
        streak_milestone_1_days,
        streak_milestone_1_reward,
        streak_milestone_2_days,
        streak_milestone_2_reward,
        streak_milestone_3_days,
        streak_milestone_3_reward,
        streak_milestone_4_days,
        streak_milestone_4_reward,
      } = req.body;

      const updates = {};
      if (daily_goal_minutes !== undefined) updates.streak_daily_goal_minutes = String(daily_goal_minutes);
      if (daily_reward_coins !== undefined) updates.streak_daily_reward_coins = String(daily_reward_coins);
      if (encouragement_quote !== undefined) updates.streak_encouragement_quote = String(encouragement_quote);

      const m1Days = streak_milestone_1_days !== undefined ? streak_milestone_1_days : milestone_1_days;
      const m1Reward = streak_milestone_1_reward !== undefined ? streak_milestone_1_reward : milestone_1_reward;
      if (m1Days !== undefined) updates.streak_milestone_1_days = String(m1Days);
      if (m1Reward !== undefined) updates.streak_milestone_1_reward = String(m1Reward);
      if (milestone_1_name !== undefined) updates.streak_milestone_1_name = String(milestone_1_name);

      const m2Days = streak_milestone_2_days !== undefined ? streak_milestone_2_days : milestone_2_days;
      const m2Reward = streak_milestone_2_reward !== undefined ? streak_milestone_2_reward : milestone_2_reward;
      if (m2Days !== undefined) updates.streak_milestone_2_days = String(m2Days);
      if (m2Reward !== undefined) updates.streak_milestone_2_reward = String(m2Reward);
      if (milestone_2_name !== undefined) updates.streak_milestone_2_name = String(milestone_2_name);

      const m3Days = streak_milestone_3_days !== undefined ? streak_milestone_3_days : milestone_3_days;
      const m3Reward = streak_milestone_3_reward !== undefined ? streak_milestone_3_reward : milestone_3_reward;
      if (m3Days !== undefined) updates.streak_milestone_3_days = String(m3Days);
      if (m3Reward !== undefined) updates.streak_milestone_3_reward = String(m3Reward);
      if (milestone_3_name !== undefined) updates.streak_milestone_3_name = String(milestone_3_name);

      const m4Days = streak_milestone_4_days !== undefined ? streak_milestone_4_days : milestone_4_days;
      const m4Reward = streak_milestone_4_reward !== undefined ? streak_milestone_4_reward : milestone_4_reward;
      if (m4Days !== undefined) updates.streak_milestone_4_days = String(m4Days);
      if (m4Reward !== undefined) updates.streak_milestone_4_reward = String(m4Reward);
      if (milestone_4_name !== undefined) updates.streak_milestone_4_name = String(milestone_4_name);

      for (const [key, value] of Object.entries(updates)) {
        await pool.query(
          `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
          [key, value]
        );
      }

      return await AdminStreakSettingsController.listStreakRewards(req, res);
    } catch (error) {
      console.error('Admin Update Streak Settings Error:', error);
      return ApiResponse.error(res, 'Failed to update streak settings.', 500);
    }
  }
}

module.exports = AdminStreakSettingsController;
