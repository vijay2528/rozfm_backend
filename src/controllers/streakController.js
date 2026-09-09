const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const StreakService = require('../services/streakService');

class StreakController {
  /**
   * GET /api/v1/streak
   * Main streak dashboard data (screen_data + bottom_sheets_data)
   */
  static async index(req, res) {
    try {
      const userId = req.user.id;
      const data = await StreakService.getFullStreakData(userId);
      return ApiResponse.success(res, data, 'OK');
    } catch (error) {
      console.error('Get Streak Error:', error);
      return ApiResponse.error(res, 'Failed to fetch streak overview.', 500);
    }
  }

  /**
   * POST /api/v1/streak/claim-daily
   * Claim today's completed daily goal energy reward
   */
  static async claimDailyReward(req, res) {
    try {
      const userId = req.user.id;
      const settings = await StreakService.getStreakSettings();

      const [todayRows] = await pool.query(
        'SELECT * FROM user_daily_activity WHERE user_id = ? AND activity_date = CURDATE() LIMIT 1',
        [userId]
      );

      if (todayRows.length === 0 || !todayRows[0].is_goal_completed) {
        return ApiResponse.error(res, "Today's listening goal is not completed yet.", 422);
      }

      if (todayRows[0].is_reward_claimed) {
        return ApiResponse.error(res, "Today's daily streak reward has already been claimed.", 422);
      }

      const rewardCoins = settings.daily_reward_coins;
      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();

        // Mark today as claimed
        await connection.query(
          'UPDATE user_daily_activity SET is_reward_claimed = 1 WHERE id = ?',
          [todayRows[0].id]
        );

        // Credit user wallet
        await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [rewardCoins, userId]);

        // Insert coin transaction
        await connection.query(
          `INSERT INTO coin_transactions (user_id, type, coins, description) VALUES (?, ?, ?, ?)`,
          [userId, 'streak_daily_claim', rewardCoins, `Claimed Daily Streak Reward (+${rewardCoins} Energy)`]
        );

        // Update user_streaks total energy
        await connection.query('UPDATE user_streaks SET total_energy = total_energy + ? WHERE user_id = ?', [rewardCoins, userId]);

        await connection.commit();
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }

      const updatedStreak = await StreakService.getFullStreakData(userId);

      return ApiResponse.success(
        res,
        {
          reward_coins: rewardCoins,
          reward_energy_text: `+${rewardCoins} Energy`,
          streak: updatedStreak,
        },
        'Daily goal reward claimed successfully.'
      );
    } catch (error) {
      console.error('Claim Daily Reward Error:', error);
      return ApiResponse.error(res, 'Failed to claim daily reward.', 500);
    }
  }

  /**
   * POST /api/v1/streak/claim-milestone
   * Claim journey milestone energy reward (3, 7, 15, 30 days)
   */
  static async claimMilestone(req, res) {
    try {
      const userId = req.user.id;
      const milestoneId = parseInt(req.body.milestone_id, 10);

      if (!milestoneId) {
        return ApiResponse.error(res, 'milestone_id is required.', 422);
      }

      const settings = await StreakService.getStreakSettings();
      const milestone = settings.milestones.find((m) => m.id === milestoneId);

      if (!milestone) {
        return ApiResponse.error(res, 'Invalid streak milestone.', 404);
      }

      const userStreak = await StreakService.ensureUserStreak(userId);
      const currentStreakDays = Number(userStreak.current_streak_days || 0);

      if (currentStreakDays < milestone.days_required) {
        return ApiResponse.error(
          res,
          `You need a ${milestone.days_required}-day streak to claim this milestone. Current: ${currentStreakDays} days.`,
          422
        );
      }

      const [existingClaim] = await pool.query(
        'SELECT id FROM user_streak_milestones WHERE user_id = ? AND milestone_id = ? AND is_collected = 1 LIMIT 1',
        [userId, milestoneId]
      );

      if (existingClaim.length > 0) {
        return ApiResponse.error(res, 'Milestone reward already claimed.', 422);
      }

      const rewardCoins = milestone.reward_coins;
      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();

        // Record milestone claim
        await connection.query(
          `INSERT INTO user_streak_milestones (user_id, milestone_id, is_collected, collected_at)
           VALUES (?, ?, 1, NOW())
           ON DUPLICATE KEY UPDATE is_collected = 1, collected_at = NOW()`,
          [userId, milestoneId]
        );

        // Credit user wallet
        await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [rewardCoins, userId]);

        // Insert coin transaction
        await connection.query(
          `INSERT INTO coin_transactions (user_id, type, coins, description) VALUES (?, ?, ?, ?)`,
          [userId, 'streak_milestone_claim', rewardCoins, `Claimed ${milestone.name} Milestone Reward (+${rewardCoins} Energy)`]
        );

        // Update user_streaks total energy
        await connection.query('UPDATE user_streaks SET total_energy = total_energy + ? WHERE user_id = ?', [rewardCoins, userId]);

        await connection.commit();
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }

      const updatedStreak = await StreakService.getFullStreakData(userId);

      return ApiResponse.success(
        res,
        {
          milestone_id: milestoneId,
          milestone_name: milestone.name,
          reward_coins: rewardCoins,
          reward_energy_text: `+${rewardCoins} Energy`,
          streak: updatedStreak,
        },
        'Milestone reward claimed successfully.'
      );
    } catch (error) {
      console.error('Claim Milestone Error:', error);
      return ApiResponse.error(res, 'Failed to claim milestone reward.', 500);
    }
  }

  /**
   * POST /api/v1/streak/use-shield
   * Use a Streak Shield to protect a missed day
   */
  static async useShield(req, res) {
    try {
      const userId = req.user.id;
      const { target_date } = req.body;

      const userStreak = await StreakService.ensureUserStreak(userId);
      const shieldsAvailable = Number(userStreak.shields_available || 0);

      if (shieldsAvailable <= 0) {
        return ApiResponse.error(res, 'No Streak Shields available.', 422);
      }

      let dateToShield = target_date;
      if (!dateToShield) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        dateToShield = yesterday.toISOString().split('T')[0];
      }

      const [actRows] = await pool.query(
        'SELECT * FROM user_daily_activity WHERE user_id = ? AND activity_date = ? LIMIT 1',
        [userId, dateToShield]
      );

      if (actRows.length > 0 && actRows[0].is_goal_completed) {
        return ApiResponse.error(res, 'This date was already completed. No shield needed.', 422);
      }

      if (actRows.length > 0 && actRows[0].is_shield_used) {
        return ApiResponse.error(res, 'A Streak Shield was already used for this date.', 422);
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        if (actRows.length > 0) {
          await connection.query('UPDATE user_daily_activity SET is_shield_used = 1 WHERE id = ?', [actRows[0].id]);
        } else {
          await connection.query(
            `INSERT INTO user_daily_activity (user_id, activity_date, listened_seconds, goal_minutes, is_goal_completed, is_shield_used)
             VALUES (?, ?, 0, 15, 0, 1)`,
            [userId, dateToShield]
          );
        }

        await connection.query(
          'UPDATE user_streaks SET shields_available = GREATEST(0, shields_available - 1) WHERE user_id = ?',
          [userId]
        );

        await connection.commit();
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }

      await StreakService.recalculateStreak(userId);
      const updatedStreak = await StreakService.getFullStreakData(userId);

      return ApiResponse.success(
        res,
        {
          shield_used_for_date: dateToShield,
          shields_remaining: Math.max(0, shieldsAvailable - 1),
          streak: updatedStreak,
        },
        'Streak Shield activated successfully.'
      );
    } catch (error) {
      console.error('Use Shield Error:', error);
      return ApiResponse.error(res, 'Failed to use streak shield.', 500);
    }
  }

  /**
   * GET /api/v1/streak/activity
   * Activity calendar for selected year and month
   */
  static async getActivityCalendar(req, res) {
    try {
      const userId = req.user.id;
      const year = parseInt(req.query.year || new Date().getFullYear(), 10);
      const month = parseInt(req.query.month || (new Date().getMonth() + 1), 10);

      const daysInMonth = new Date(year, month, 0).getDate();
      const startDateStr = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDateStr = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

      const [activities] = await pool.query(
        `SELECT * FROM user_daily_activity
         WHERE user_id = ? AND activity_date >= ? AND activity_date <= ?`,
        [userId, startDateStr, endDateStr]
      );

      const actMap = {};
      activities.forEach((act) => {
        const dStr = new Date(act.activity_date).toISOString().split('T')[0];
        actMap[dStr] = act;
      });

      const todayStr = new Date().toISOString().split('T')[0];
      const monthDays = [];

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const act = actMap[dateStr];

        let status = 'missed';
        if (act && act.is_goal_completed) status = 'completed';
        else if (act && act.is_shield_used) status = 'shielded';
        else if (dateStr === todayStr) status = 'today';
        else if (new Date(dateStr) > new Date(todayStr)) status = 'upcoming';

        monthDays.push({
          date: dateStr,
          day_number: day,
          listened_minutes: act ? Math.floor(Number(act.listened_seconds || 0) / 60) : 0,
          status: status,
        });
      }

      return ApiResponse.success(res, {
        year: year,
        month: month,
        days_in_month: daysInMonth,
        activity: monthDays,
      });
    } catch (error) {
      console.error('Get Activity Calendar Error:', error);
      return ApiResponse.error(res, 'Failed to fetch activity calendar.', 500);
    }
  }

  /**
   * GET /api/v1/streak/date-details
   * Details for a specific calendar date (bottom sheet #6)
   */
  static async getDateDetails(req, res) {
    try {
      const userId = req.user.id;
      const targetDate = req.query.date || new Date().toISOString().split('T')[0];

      const settings = await StreakService.getStreakSettings();
      const [rows] = await pool.query(
        'SELECT * FROM user_daily_activity WHERE user_id = ? AND activity_date = ? LIMIT 1',
        [userId, targetDate]
      );

      const act = rows.length > 0 ? rows[0] : null;
      const listenedMinutes = act ? Math.floor(Number(act.listened_seconds || 0) / 60) : 0;
      const isCompleted = act ? Boolean(act.is_goal_completed) : false;
      const isShielded = act ? Boolean(act.is_shield_used) : false;

      const dateObj = new Date(targetDate);
      const formattedTitle = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

      let statusStr = 'Missed';
      if (isCompleted) statusStr = 'Completed';
      else if (isShielded) statusStr = 'Protected (Shield Used)';
      else if (targetDate === new Date().toISOString().split('T')[0]) statusStr = 'In Progress';

      return ApiResponse.success(res, {
        date: targetDate,
        date_title: formattedTitle,
        rows: {
          status: statusStr,
          listening_text: `${listenedMinutes} mins`,
          reward_type: `Daily Goal (+${settings.daily_reward_coins} Energy)`,
          potential_reward: `+${settings.daily_reward_coins} Energy`,
        },
        action_button_text: 'DONE',
      });
    } catch (error) {
      console.error('Get Date Details Error:', error);
      return ApiResponse.error(res, 'Failed to fetch date details.', 500);
    }
  }
}

module.exports = StreakController;
