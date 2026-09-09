const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

class AdminStreakSettingsController {
  /**
   * GET /api/v1/admin/streak-settings
   * Fetch current admin streak configurations
   */
  static async getSettings(req, res) {
    try {
      const [rows] = await pool.query("SELECT `key`, `value` FROM settings WHERE `key` LIKE 'streak_%'");
      const settingsMap = {};
      rows.forEach((r) => {
        settingsMap[r.key] = r.value;
      });

      return ApiResponse.success(res, {
        daily_goal_minutes: parseInt(settingsMap.streak_daily_goal_minutes || '15', 10),
        daily_reward_coins: parseInt(settingsMap.streak_daily_reward_coins || '5', 10),
        encouragement_quote: settingsMap.streak_encouragement_quote || "You're building serious energy!",
        milestone_1_days: parseInt(settingsMap.streak_milestone_1_days || '3', 10),
        milestone_1_reward: parseInt(settingsMap.streak_milestone_1_reward || '10', 10),
        milestone_1_name: settingsMap.streak_milestone_1_name || 'First Spark',
        milestone_2_days: parseInt(settingsMap.streak_milestone_2_days || '7', 10),
        milestone_2_reward: parseInt(settingsMap.streak_milestone_2_reward || '25', 10),
        milestone_2_name: settingsMap.streak_milestone_2_name || 'Power Listener',
        milestone_3_days: parseInt(settingsMap.streak_milestone_3_days || '15', 10),
        milestone_3_reward: parseInt(settingsMap.streak_milestone_3_reward || '50', 10),
        milestone_3_name: settingsMap.streak_milestone_3_name || 'Energy Master',
        milestone_4_days: parseInt(settingsMap.streak_milestone_4_days || '30', 10),
        milestone_4_reward: parseInt(settingsMap.streak_milestone_4_reward || '100', 10),
        milestone_4_name: settingsMap.streak_milestone_4_name || 'Legendary',
      });
    } catch (error) {
      console.error('Admin Get Streak Settings Error:', error);
      return ApiResponse.error(res, 'Failed to fetch streak settings.', 500);
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
      } = req.body;

      const updates = {};
      if (daily_goal_minutes !== undefined) updates.streak_daily_goal_minutes = String(daily_goal_minutes);
      if (daily_reward_coins !== undefined) updates.streak_daily_reward_coins = String(daily_reward_coins);
      if (encouragement_quote !== undefined) updates.streak_encouragement_quote = String(encouragement_quote);

      if (milestone_1_days !== undefined) updates.streak_milestone_1_days = String(milestone_1_days);
      if (milestone_1_reward !== undefined) updates.streak_milestone_1_reward = String(milestone_1_reward);
      if (milestone_1_name !== undefined) updates.streak_milestone_1_name = String(milestone_1_name);

      if (milestone_2_days !== undefined) updates.streak_milestone_2_days = String(milestone_2_days);
      if (milestone_2_reward !== undefined) updates.streak_milestone_2_reward = String(milestone_2_reward);
      if (milestone_2_name !== undefined) updates.streak_milestone_2_name = String(milestone_2_name);

      if (milestone_3_days !== undefined) updates.streak_milestone_3_days = String(milestone_3_days);
      if (milestone_3_reward !== undefined) updates.streak_milestone_3_reward = String(milestone_3_reward);
      if (milestone_3_name !== undefined) updates.streak_milestone_3_name = String(milestone_3_name);

      if (milestone_4_days !== undefined) updates.streak_milestone_4_days = String(milestone_4_days);
      if (milestone_4_reward !== undefined) updates.streak_milestone_4_reward = String(milestone_4_reward);
      if (milestone_4_name !== undefined) updates.streak_milestone_4_name = String(milestone_4_name);

      for (const [key, value] of Object.entries(updates)) {
        await pool.query(
          `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
          [key, value]
        );
      }

      return await AdminStreakSettingsController.getSettings(req, res);
    } catch (error) {
      console.error('Admin Update Streak Settings Error:', error);
      return ApiResponse.error(res, 'Failed to update streak settings.', 500);
    }
  }
}

module.exports = AdminStreakSettingsController;
