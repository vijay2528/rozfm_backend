const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const StreakService = require('../services/streakService');

class StreakController {
  /**
   * GET /streak or GET /user/streak-summary
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
   * GET /user/streak-summary
   */
  static async getSummary(req, res) {
    try {
      const userId = req.user.id;
      const summary = await StreakService.getSummary(userId);
      return ApiResponse.success(res, summary, 'Streak summary fetched successfully.');
    } catch (error) {
      console.error('Get Streak Summary Error:', error);
      return ApiResponse.error(res, 'Failed to fetch streak summary.', 500);
    }
  }

  /**
   * GET /listening/today-status
   */
  static async getTodayStatus(req, res) {
    try {
      const userId = req.user.id;
      const status = await StreakService.getTodayStatus(userId);
      return ApiResponse.success(res, status, 'Today status fetched successfully.');
    } catch (error) {
      console.error('Get Today Status Error:', error);
      return ApiResponse.error(res, 'Failed to fetch today listening status.', 500);
    }
  }

  /**
   * POST /listening/heartbeat
   * Audio player ping (Section B.2, C.4)
   */
  static async heartbeat(req, res) {
    try {
      const userId = req.user.id;
      const seconds = req.body.seconds || req.body.seconds_listened || req.body.delta_seconds || 15;

      const result = await StreakService.recordListeningTime(userId, seconds);
      const todayStatus = await StreakService.getTodayStatus(userId);

      return ApiResponse.success(res, {
        heartbeat_recorded: result,
        today_status: todayStatus,
      }, 'Listening heartbeat recorded successfully.');
    } catch (error) {
      console.error('Heartbeat Error:', error);
      return ApiResponse.error(res, 'Failed to record listening heartbeat.', 500);
    }
  }

  /**
   * POST /streak/claim-daily or POST /rewards/claim-daily
   * Claim today's completed daily goal energy reward (Section C.1 transaction & locking)
   */
  static async claimDailyReward(req, res) {
    try {
      const userId = req.user.id;
      const settings = await StreakService.getStreakSettings();
      const todayStr = StreakService.getTodayDateString();

      const connection = await pool.getConnection();
      let rewardCoins = settings.daily_reward_coins;

      try {
        await connection.beginTransaction();

        // Lock today's activity row (C.1 race condition protection)
        const [todayRows] = await connection.query(
          'SELECT * FROM user_daily_activity WHERE user_id = ? AND activity_date = ? FOR UPDATE',
          [userId, todayStr]
        );

        if (todayRows.length === 0 || !todayRows[0].is_goal_completed) {
          await connection.rollback();
          return ApiResponse.error(res, "Today's listening goal is not completed yet.", 422);
        }

        if (todayRows[0].is_reward_claimed) {
          await connection.rollback();
          return ApiResponse.error(res, "Today's daily streak reward has already been claimed.", 422);
        }

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
   * POST /streak/claim-milestone or POST /rewards/claim-milestone
   * Claim journey milestone energy reward (3, 7, 15, 30 days) (Section C.1 transaction & locking)
   */
  static async claimMilestone(req, res) {
    try {
      const userId = req.user.id;
      const milestoneId = parseInt(req.body.milestone_id || req.body.id, 10);

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

      const rewardCoins = milestone.reward_coins;
      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();

        // Row-level lock check for milestone claim (C.1 race condition protection)
        const [existingClaim] = await connection.query(
          'SELECT is_collected FROM user_streak_milestones WHERE user_id = ? AND milestone_id = ? FOR UPDATE',
          [userId, milestoneId]
        );

        if (existingClaim.length > 0 && existingClaim[0].is_collected) {
          await connection.rollback();
          return ApiResponse.error(res, 'Milestone reward already claimed.', 422);
        }

        if (existingClaim.length > 0) {
          await connection.query(
            'UPDATE user_streak_milestones SET is_collected = 1, collected_at = NOW() WHERE user_id = ? AND milestone_id = ?',
            [userId, milestoneId]
          );
        } else {
          await connection.query(
            `INSERT INTO user_streak_milestones (user_id, milestone_id, is_collected, collected_at) VALUES (?, ?, 1, NOW())`,
            [userId, milestoneId]
          );
        }

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
   * POST /streak/use-shield or POST /streak/protect-day
   * Use a Streak Shield to protect a missed day (Section B.6)
   */
  static async useShield(req, res) {
    try {
      const userId = req.user.id;
      let dateToShield = req.body.target_date || req.body.date || req.body.date_to_shield;

      const userStreak = await StreakService.ensureUserStreak(userId);
      const shieldsAvailable = Number(userStreak.shields_available || 0);

      if (shieldsAvailable <= 0) {
        return ApiResponse.error(res, 'No Streak Shields available.', 422);
      }

      if (!dateToShield) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const options = { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Kolkata' };
        dateToShield = new Intl.DateTimeFormat('en-CA', options).format(yesterday);
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
   * GET /user/weekly-activity
   */
  static async getWeeklyActivity(req, res) {
    try {
      const userId = req.user.id;
      const week = await StreakService.getWeeklyActivity(userId);
      return ApiResponse.success(res, { week }, 'Weekly activity fetched.');
    } catch (error) {
      console.error('Get Weekly Activity Error:', error);
      return ApiResponse.error(res, 'Failed to fetch weekly activity.', 500);
    }
  }

  /**
   * GET /streak/next-milestone
   */
  static async getNextMilestone(req, res) {
    try {
      const userId = req.user.id;
      const milestone = await StreakService.getNextMilestone(userId);
      return ApiResponse.success(res, milestone, 'Next milestone fetched.');
    } catch (error) {
      console.error('Get Next Milestone Error:', error);
      return ApiResponse.error(res, 'Failed to fetch next milestone.', 500);
    }
  }

  /**
   * GET /streak/milestones
   */
  static async getMilestones(req, res) {
    try {
      const userId = req.user.id;
      const settings = await StreakService.getStreakSettings();
      const userStreak = await StreakService.ensureUserStreak(userId);
      const currentStreakDays = Number(userStreak.current_streak_days || 0);

      const [milestonesClaimedRows] = await pool.query(
        'SELECT milestone_id FROM user_streak_milestones WHERE user_id = ? AND is_collected = 1',
        [userId]
      );
      const claimedMilestoneIds = new Set(milestonesClaimedRows.map((r) => r.milestone_id));

      const milestones = settings.milestones.map((m) => {
        const isCollected = claimedMilestoneIds.has(m.id);
        const daysLeft = Math.max(0, m.days_required - currentStreakDays);

        return {
          id: m.id,
          days_required: m.days_required,
          name: m.name,
          reward_coins: m.reward_coins,
          energy_reward_text: `+${m.reward_coins} Energy`,
          is_collected: isCollected,
          is_unlocked: currentStreakDays >= m.days_required,
          days_left: daysLeft,
          status: isCollected ? 'Collected' : currentStreakDays >= m.days_required ? 'Unlocked' : 'Locked',
        };
      });

      return ApiResponse.success(res, { milestones }, 'Milestones fetched successfully.');
    } catch (error) {
      console.error('Get Milestones Error:', error);
      return ApiResponse.error(res, 'Failed to fetch milestones.', 500);
    }
  }

  /**
   * GET /streak/shield-status
   */
  static async getShieldStatus(req, res) {
    try {
      const userId = req.user.id;
      const status = await StreakService.getShieldStatus(userId);
      return ApiResponse.success(res, status, 'Shield status fetched successfully.');
    } catch (error) {
      console.error('Get Shield Status Error:', error);
      return ApiResponse.error(res, 'Failed to fetch shield status.', 500);
    }
  }

  /**
   * GET /user/achievements
   */
  static async getAchievements(req, res) {
    try {
      const userId = req.user.id;
      const achievements = await StreakService.getAchievements(userId);
      return ApiResponse.success(res, { achievements }, 'Achievements fetched successfully.');
    } catch (error) {
      console.error('Get Achievements Error:', error);
      return ApiResponse.error(res, 'Failed to fetch achievements.', 500);
    }
  }

  /**
   * GET /streak/activity or GET /user/streak-calendar
   * Activity calendar for selected year and month
   */
  static async getActivityCalendar(req, res) {
    try {
      const userId = req.user.id;
      const todayStr = StreakService.getTodayDateString();
      const todayParts = todayStr.split('-');
      const defaultYear = parseInt(todayParts[0], 10);
      const defaultMonth = parseInt(todayParts[1], 10);

      const year = parseInt(req.query.year || defaultYear, 10);
      const month = parseInt(req.query.month || defaultMonth, 10);

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
        const dObj = new Date(act.activity_date);
        const y = dObj.getFullYear();
        const m = String(dObj.getMonth() + 1).padStart(2, '0');
        const d = String(dObj.getDate()).padStart(2, '0');
        actMap[`${y}-${m}-${d}`] = act;
      });

      const monthDays = [];

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const act = actMap[dateStr];

        let status = 'missed';
        if (act && act.is_goal_completed) status = 'completed';
        else if (act && act.is_shield_used) status = 'protected';
        else if (dateStr === todayStr) status = 'today';
        else if (dateStr > todayStr) status = 'upcoming';

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
   * GET /streak/date-details
   * Details for a specific calendar date
   */
  static async getDateDetails(req, res) {
    try {
      const userId = req.user.id;
      const todayStr = StreakService.getTodayDateString();
      const targetDate = req.query.date || todayStr;

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
      else if (targetDate === todayStr) statusStr = 'In Progress';

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
