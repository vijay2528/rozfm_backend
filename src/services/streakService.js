const { pool } = require('../config/db');

function getLocalDateString(dateObj = new Date(), timeZone = 'Asia/Kolkata') {
  const d = new Date(dateObj);
  const options = { year: 'numeric', month: '2-digit', day: '2-digit', timeZone };
  const formatter = new Intl.DateTimeFormat('en-CA', options); // returns YYYY-MM-DD
  return formatter.format(d);
}

class StreakService {
  /**
   * Helper to format dates consistently in IST/local timezone
   */
  static getTodayDateString(timeZone = 'Asia/Kolkata') {
    return getLocalDateString(new Date(), timeZone);
  }

  /**
   * Fetch current streak settings from admin settings table
   */
  static async getStreakSettings() {
    const [rows] = await pool.query("SELECT `key`, `value` FROM settings WHERE `key` LIKE 'streak_%'");
    const settingsMap = {};
    rows.forEach((r) => {
      settingsMap[r.key] = r.value;
    });

    return {
      daily_goal_minutes: parseInt(settingsMap.streak_daily_goal_minutes || '15', 10),
      daily_reward_coins: parseInt(settingsMap.streak_daily_reward_coins || '5', 10),
      encouragement_quote: settingsMap.streak_encouragement_quote || "You're building serious energy!",
      milestones: [
        {
          id: 1,
          days_required: parseInt(settingsMap.streak_milestone_1_days || '3', 10),
          reward_coins: parseInt(settingsMap.streak_milestone_1_reward || '10', 10),
          name: settingsMap.streak_milestone_1_name || 'First Spark',
        },
        {
          id: 2,
          days_required: parseInt(settingsMap.streak_milestone_2_days || '7', 10),
          reward_coins: parseInt(settingsMap.streak_milestone_2_reward || '25', 10),
          name: settingsMap.streak_milestone_2_name || 'Power Listener',
        },
        {
          id: 3,
          days_required: parseInt(settingsMap.streak_milestone_3_days || '15', 10),
          reward_coins: parseInt(settingsMap.streak_milestone_3_reward || '50', 10),
          name: settingsMap.streak_milestone_3_name || 'Energy Master',
        },
        {
          id: 4,
          days_required: parseInt(settingsMap.streak_milestone_4_days || '30', 10),
          reward_coins: parseInt(settingsMap.streak_milestone_4_reward || '100', 10),
          name: settingsMap.streak_milestone_4_name || 'Legendary',
        },
      ],
      achievements: [
        { id: 1, title: 'First Spark', streak_requirement: '3 Day Streak', days_required: 3 },
        { id: 2, title: 'Power Listener', streak_requirement: '7 Day Streak', days_required: 7 },
        { id: 3, title: 'High Voltage', streak_requirement: '15 Day Streak', days_required: 15 },
        { id: 4, title: 'Unstoppable', streak_requirement: '30 Day Streak', days_required: 30 },
      ],
      help_faqs: [
        {
          id: 1,
          question: 'How does my streak work?',
          answer: 'Listen for at least 15 minutes every day to build your streak. Reach daily milestones to earn bonus Energy!',
        },
        {
          id: 2,
          question: 'How do I complete today\'s goal?',
          answer: 'Play any audio story or series for 15 minutes today. Your progress tracks automatically.',
        },
        {
          id: 3,
          question: 'What happens if I miss a day?',
          answer: 'Missing a day breaks your active streak unless you have an active Streak Shield equipped.',
        },
        {
          id: 4,
          question: 'How do rewards work?',
          answer: 'Bonus Energy is credited to your balance automatically when you hit 3, 7, 15, and 30-day streak milestones.',
        },
        {
          id: 5,
          question: 'What is a Streak Shield?',
          answer: 'A Streak Shield protects your streak count when you miss a day of listening.',
        },
      ],
    };
  }

  /**
   * Ensure user_streaks record exists for the user
   */
  static async ensureUserStreak(userId) {
    const [userRows] = await pool.query('SELECT wallet_balance FROM users WHERE id = ? LIMIT 1', [userId]);
    const walletBalance = userRows.length > 0 ? Math.max(0, parseInt(userRows[0].wallet_balance, 10) || 0) : 0;

    const [rows] = await pool.query('SELECT * FROM user_streaks WHERE user_id = ? LIMIT 1', [userId]);
    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO user_streaks (user_id, current_streak_days, best_streak_days, total_energy, shields_available, shield_progress_days)
         VALUES (?, 0, 0, ?, 1, 0)`,
        [userId, walletBalance]
      );
      const [newRows] = await pool.query('SELECT * FROM user_streaks WHERE user_id = ? LIMIT 1', [userId]);
      return newRows[0];
    } else {
      // Sync total energy with wallet balance
      await pool.query('UPDATE user_streaks SET total_energy = ? WHERE user_id = ?', [walletBalance, userId]);
      rows[0].total_energy = walletBalance;
      return rows[0];
    }
  }

  /**
   * Record listening seconds for today and auto-update streak goal
   * Note: Enforces Section C.4 anti-cheat cap (max 60 seconds per single heartbeat ping)
   */
  static async recordListeningTime(userId, seconds) {
    const rawSeconds = Math.max(0, parseInt(seconds, 10) || 0);
    if (rawSeconds <= 0) return null;

    // Sanity check (C.4 anti-cheat): cap single heartbeat to max 60 seconds
    const secondsToAdd = Math.min(rawSeconds, 60);

    const settings = await this.getStreakSettings();
    const goalSeconds = settings.daily_goal_minutes * 60;
    const todayStr = this.getTodayDateString();

    const [todayRows] = await pool.query(
      'SELECT * FROM user_daily_activity WHERE user_id = ? AND activity_date = ? LIMIT 1',
      [userId, todayStr]
    );

    let newListenedSeconds = secondsToAdd;
    let wasCompletedBefore = false;

    if (todayRows.length > 0) {
      newListenedSeconds = Number(todayRows[0].listened_seconds || 0) + secondsToAdd;
      wasCompletedBefore = Boolean(todayRows[0].is_goal_completed);

      const isCompleted = newListenedSeconds >= goalSeconds ? 1 : 0;

      await pool.query(
        `UPDATE user_daily_activity
         SET listened_seconds = ?, goal_minutes = ?, is_goal_completed = ?
         WHERE id = ?`,
        [newListenedSeconds, settings.daily_goal_minutes, isCompleted, todayRows[0].id]
      );
    } else {
      const isCompleted = newListenedSeconds >= goalSeconds ? 1 : 0;
      await pool.query(
        `INSERT INTO user_daily_activity (user_id, activity_date, listened_seconds, goal_minutes, is_goal_completed)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, todayStr, newListenedSeconds, settings.daily_goal_minutes, isCompleted]
      );
    }

    // Recalculate streak stats if goal newly completed today
    const isNewlyCompleted = newListenedSeconds >= goalSeconds && !wasCompletedBefore;
    await this.recalculateStreak(userId, isNewlyCompleted);

    return {
      today_listened_seconds: newListenedSeconds,
      today_goal_seconds: goalSeconds,
      is_goal_completed: newListenedSeconds >= goalSeconds,
      is_newly_completed: isNewlyCompleted,
    };
  }

  /**
   * Recalculate user streak based on consecutive completed/shielded days
   */
  static async recalculateStreak(userId, isNewCompletionToday = false) {
    const userStreak = await this.ensureUserStreak(userId);
    const settings = await this.getStreakSettings();
    const todayStr = this.getTodayDateString();

    const [activities] = await pool.query(
      `SELECT activity_date, is_goal_completed, is_shield_used
       FROM user_daily_activity
       WHERE user_id = ?
       ORDER BY activity_date DESC`,
      [userId]
    );

    const activityMap = {};
    activities.forEach((act) => {
      const dateStr = getLocalDateString(act.activity_date);
      activityMap[dateStr] = act;
    });

    // Determine current streak
    let streakCount = 0;
    let checkDate = new Date();

    const todayAct = activityMap[todayStr];
    if (todayAct && (todayAct.is_goal_completed || todayAct.is_shield_used)) {
      // Streak includes today
    } else {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    while (true) {
      const dStr = getLocalDateString(checkDate);
      const act = activityMap[dStr];
      if (act && (act.is_goal_completed || act.is_shield_used)) {
        streakCount++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    const newBestStreak = Math.max(Number(userStreak.best_streak_days || 0), streakCount);

    let shieldProgress = Number(userStreak.shield_progress_days || 0);
    let shieldsAvailable = Number(userStreak.shields_available || 0);

    if (isNewCompletionToday) {
      shieldProgress += 1;
      if (shieldProgress >= 7) {
        shieldProgress = 0;
        if (shieldsAvailable < 2) {
          shieldsAvailable += 1;
        }
      }
    }

    await pool.query(
      `UPDATE user_streaks
       SET current_streak_days = ?, best_streak_days = ?, shields_available = ?, shield_progress_days = ?, last_active_date = ?
       WHERE user_id = ?`,
      [streakCount, newBestStreak, shieldsAvailable, shieldProgress, todayStr, userId]
    );

    // Check & earn achievements
    for (const ach of settings.achievements) {
      if (streakCount >= ach.days_required) {
        await pool.query(
          `INSERT INTO user_streak_achievements (user_id, achievement_id, is_earned, earned_at)
           VALUES (?, ?, 1, NOW())
           ON DUPLICATE KEY UPDATE is_earned = 1`,
          [userId, ach.id]
        );
      }
    }

    return {
      current_streak_days: streakCount,
      best_streak_days: newBestStreak,
      shields_available: shieldsAvailable,
      shield_progress_days: shieldProgress,
    };
  }

  /**
   * GET /user/streak-summary
   */
  static async getSummary(userId) {
    const userStreak = await this.ensureUserStreak(userId);
    const settings = await this.getStreakSettings();
    const todayStr = this.getTodayDateString();

    const [nowParts] = await pool.query('SELECT MONTH(?) as currentMonth, YEAR(?) as currentYear', [todayStr, todayStr]);
    const currentMonth = nowParts[0].currentMonth;
    const currentYear = nowParts[0].currentYear;

    const [[{ thisMonthDays }]] = await pool.query(
      `SELECT COUNT(*) as thisMonthDays
       FROM user_daily_activity
       WHERE user_id = ? AND is_goal_completed = 1
         AND MONTH(activity_date) = ? AND YEAR(activity_date) = ?`,
      [userId, currentMonth, currentYear]
    );

    const currentStreakDays = Number(userStreak.current_streak_days || 0);
    let nextMilestone = settings.milestones.find((m) => m.days_required > currentStreakDays);
    if (!nextMilestone) {
      nextMilestone = settings.milestones[settings.milestones.length - 1];
    }

    return {
      current_streak_days: currentStreakDays,
      best_streak_days: Number(userStreak.best_streak_days || 0),
      total_energy: Number(userStreak.total_energy || 0),
      this_month_days: Number(thisMonthDays || 0),
      today_reward: settings.daily_reward_coins,
      next_milestone_reward: nextMilestone.reward_coins,
    };
  }

  /**
   * GET /listening/today-status
   */
  static async getTodayStatus(userId) {
    const settings = await this.getStreakSettings();
    const todayStr = this.getTodayDateString();

    const [todayRows] = await pool.query(
      'SELECT * FROM user_daily_activity WHERE user_id = ? AND activity_date = ? LIMIT 1',
      [userId, todayStr]
    );

    const listenedSeconds = todayRows.length > 0 ? Number(todayRows[0].listened_seconds || 0) : 0;
    const goalMinutes = settings.daily_goal_minutes;
    const goalSeconds = goalMinutes * 60;
    const percentage = Math.min(100, Math.round((listenedSeconds / goalSeconds) * 100));
    const isCompleted = todayRows.length > 0 ? Boolean(todayRows[0].is_goal_completed) : false;
    const isClaimed = todayRows.length > 0 ? Boolean(todayRows[0].is_reward_claimed) : false;

    return {
      today_listened_seconds: listenedSeconds,
      today_goal_seconds: goalSeconds,
      today_listened_minutes: Math.floor(listenedSeconds / 60),
      today_goal_minutes: goalMinutes,
      progress_percentage: percentage,
      is_goal_completed: isCompleted,
      is_reward_claimed: isClaimed,
      reward_energy: settings.daily_reward_coins,
      encouragement_quote: settings.encouragement_quote,
    };
  }

  /**
   * GET /user/weekly-activity
   */
  static async getWeeklyActivity(userId) {
    const settings = await this.getStreakSettings();
    const todayStr = this.getTodayDateString();

    const todayObj = new Date();
    const dayOfWeek = todayObj.getDay(); // 0 is Sun, 1 is Mon...
    const distToMon = (dayOfWeek + 6) % 7;
    const mondayObj = new Date(todayObj);
    mondayObj.setDate(todayObj.getDate() - distToMon);

    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayObj);
      d.setDate(mondayObj.getDate() + i);
      weekDates.push(d);
    }

    const startDateStr = getLocalDateString(weekDates[0]);
    const endDateStr = getLocalDateString(weekDates[6]);

    const [weekActivities] = await pool.query(
      `SELECT * FROM user_daily_activity
       WHERE user_id = ? AND activity_date >= ? AND activity_date <= ?`,
      [userId, startDateStr, endDateStr]
    );

    const weekActMap = {};
    weekActivities.forEach((wa) => {
      const dStr = getLocalDateString(wa.activity_date);
      weekActMap[dStr] = wa;
    });

    const dayNames = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const goalMinutes = settings.daily_goal_minutes;

    return weekDates.map((dateObj, idx) => {
      const dStr = getLocalDateString(dateObj);
      const dateNum = dateObj.getDate();
      const isToday = dStr === todayStr;
      const isPast = dStr < todayStr;

      const act = weekActMap[dStr];
      const actListenedSecs = act ? Number(act.listened_seconds || 0) : 0;
      const actListenedMins = Math.floor(actListenedSecs / 60);

      let status = 'missed';
      let statusLabel = 'MISSED';
      let energy = 0;

      if (idx === 6) {
        // Sunday bonus
        status = act && act.is_goal_completed ? 'completed' : 'bonus';
        statusLabel = act && act.is_goal_completed ? 'COMPLETED' : 'REWARD';
        energy = 20;
      } else if (act && act.is_goal_completed) {
        status = 'completed';
        statusLabel = 'COMPLETED';
        energy = settings.daily_reward_coins;
      } else if (act && act.is_shield_used) {
        status = 'completed';
        statusLabel = 'SHIELDED';
        energy = 0;
      } else if (isToday) {
        status = 'today';
        statusLabel = 'TODAY';
        energy = settings.daily_reward_coins;
      } else if (isPast) {
        status = 'missed';
        statusLabel = 'MISSED';
        energy = 0;
      } else {
        status = 'upcoming';
        statusLabel = 'UPCOMING';
        energy = settings.daily_reward_coins;
      }

      return {
        day_name: dayNames[idx],
        date_number: dateNum,
        date: dStr,
        status: status,
        status_label: statusLabel,
        energy: energy,
        reward: idx === 6 ? 'Sunday Bonus' : 'Standard Day',
        listening: `${Math.min(actListenedMins, goalMinutes)}/${goalMinutes}`,
      };
    });
  }

  /**
   * GET /streak/next-milestone
   */
  static async getNextMilestone(userId) {
    const userStreak = await this.ensureUserStreak(userId);
    const settings = await this.getStreakSettings();
    const currentStreakDays = Number(userStreak.current_streak_days || 0);

    const [milestonesClaimedRows] = await pool.query(
      'SELECT milestone_id FROM user_streak_milestones WHERE user_id = ? AND is_collected = 1',
      [userId]
    );
    const claimedMilestoneIds = new Set(milestonesClaimedRows.map((r) => r.milestone_id));

    let nextMilestone = settings.milestones.find((m) => m.days_required > currentStreakDays);
    if (!nextMilestone) {
      nextMilestone = settings.milestones[settings.milestones.length - 1];
    }

    const daysLeftToUnlock = Math.max(0, nextMilestone.days_required - currentStreakDays);

    return {
      next_reward_day: nextMilestone.days_required,
      next_reward_energy: nextMilestone.reward_coins,
      current_streak_days: currentStreakDays,
      days_left_to_unlock: daysLeftToUnlock,
      energy_reward: nextMilestone.reward_coins,
      energy_reward_text: `+${nextMilestone.reward_coins} Energy`,
      required_streak_days: nextMilestone.days_required,
      required_streak_text: `${nextMilestone.days_required} days`,
      current_progress_text: `${currentStreakDays} / ${nextMilestone.days_required}`,
      status_text: `${daysLeftToUnlock} days left`,
      is_collected: claimedMilestoneIds.has(nextMilestone.id),
      milestone_name: nextMilestone.name,
    };
  }

  /**
   * GET /streak/shield-status
   */
  static async getShieldStatus(userId) {
    const userStreak = await this.ensureUserStreak(userId);
    const shieldsAvailable = Number(userStreak.shields_available || 0);
    const shieldProgressDays = Number(userStreak.shield_progress_days || 0);
    const daysLeftToEarnShield = Math.max(0, 7 - shieldProgressDays);

    return {
      shields_available: shieldsAvailable,
      max_shields: 2,
      current_days_progress: shieldProgressDays,
      target_days_progress: 7,
      days_left_to_earn: daysLeftToEarnShield,
      progress_ratio: parseFloat((shieldProgressDays / 7).toFixed(2)),
    };
  }

  /**
   * GET /user/achievements
   */
  static async getAchievements(userId) {
    const userStreak = await this.ensureUserStreak(userId);
    const settings = await this.getStreakSettings();
    const currentStreakDays = Number(userStreak.current_streak_days || 0);

    const [earnedAchievementsRows] = await pool.query(
      'SELECT achievement_id FROM user_streak_achievements WHERE user_id = ? AND is_earned = 1',
      [userId]
    );
    const earnedAchievementIds = new Set(earnedAchievementsRows.map((r) => r.achievement_id));

    return settings.achievements.map((ach) => ({
      id: ach.id,
      title: ach.title,
      streak_requirement: ach.streak_requirement,
      days_required: ach.days_required,
      is_earned: earnedAchievementIds.has(ach.id) || currentStreakDays >= ach.days_required,
    }));
  }

  /**
   * Get main screen & bottom sheet data for authenticated user
   */
  static async getFullStreakData(userId) {
    const userStreak = await this.ensureUserStreak(userId);
    const settings = await this.getStreakSettings();
    const todayStr = this.getTodayDateString();

    // 1. Fetch Today's Activity
    const [todayRows] = await pool.query(
      'SELECT * FROM user_daily_activity WHERE user_id = ? AND activity_date = ? LIMIT 1',
      [userId, todayStr]
    );

    const listenedSeconds = todayRows.length > 0 ? Number(todayRows[0].listened_seconds || 0) : 0;
    const listenedMinutes = Math.floor(listenedSeconds / 60);
    const goalMinutes = settings.daily_goal_minutes;
    const goalSeconds = goalMinutes * 60;
    const isClaimed = todayRows.length > 0 ? Boolean(todayRows[0].is_reward_claimed) : false;

    // 2. Best streak & this month completed days
    const summary = await this.getSummary(userId);

    // 3. Build Week Calendar (Monday to Sunday)
    const weekCalendar = await this.getWeeklyActivity(userId);

    // 4. Milestones & Claims
    const [milestonesClaimedRows] = await pool.query(
      'SELECT milestone_id FROM user_streak_milestones WHERE user_id = ? AND is_collected = 1',
      [userId]
    );
    const claimedMilestoneIds = new Set(milestonesClaimedRows.map((r) => r.milestone_id));

    const currentStreakDays = Number(userStreak.current_streak_days || 0);

    let nextMilestone = settings.milestones.find((m) => m.days_required > currentStreakDays);
    if (!nextMilestone) {
      nextMilestone = settings.milestones[settings.milestones.length - 1];
    }

    const daysLeftToUnlock = Math.max(0, nextMilestone.days_required - currentStreakDays);

    const journeyMilestones = settings.milestones.map((m) => {
      const isCollected = claimedMilestoneIds.has(m.id);
      const isCurrentTarget = m.id === nextMilestone.id;
      const daysLeft = Math.max(0, m.days_required - currentStreakDays);

      let statusText = isCollected
        ? 'Collected'
        : daysLeft === 0
        ? 'Unlocked'
        : `${daysLeft} days left`;

      let status = isCollected
        ? 'Collected'
        : currentStreakDays >= m.days_required
        ? 'Unlocked'
        : 'Locked';

      return {
        id: m.id,
        days_title: `${m.days_required} DAYS`,
        energy_reward: `+${m.reward_coins} Energy`,
        milestone_name: m.name,
        status_text: statusText,
        is_collected: isCollected,
        is_current_target: isCurrentTarget,
        progress: `${Math.min(currentStreakDays, m.days_required)}/${m.days_required}`,
        status: status,
      };
    });

    // 5. Achievements
    const achievements = await this.getAchievements(userId);

    // 6. Streak Shield
    const shieldStatus = await this.getShieldStatus(userId);

    // Construct Response matching exact user payload specification
    return {
      screen_data: {
        streak_overview: summary,
        today_goal: {
          today_listened_seconds: listenedSeconds,
          today_goal_seconds: goalSeconds,
          today_reward_energy: settings.daily_reward_coins,
          is_claimed: isClaimed,
        },
        week_calendar: weekCalendar,
        next_reward: {
          next_reward_day: nextMilestone.days_required,
          next_reward_energy: nextMilestone.reward_coins,
          current_streak_days: currentStreakDays,
          days_left_to_unlock: daysLeftToUnlock,
          energy_reward: nextMilestone.reward_coins,
          energy_reward_text: `+${nextMilestone.reward_coins} Energy`,
          required_streak_days: nextMilestone.days_required,
          required_streak_text: `${nextMilestone.days_required} days`,
          current_progress_text: `${currentStreakDays} / ${nextMilestone.days_required}`,
          status_text: `${daysLeftToUnlock} days left`,
        },
        journey_milestones: journeyMilestones,
        streak_shield: shieldStatus,
        achievements: achievements,
        help_faqs: settings.help_faqs,
      },
      bottom_sheets_data: {
        '1_energy_milestone_bottom_sheet': {
          title: 'ENERGY MILESTONE!',
          subtitle: "Today's Goal",
          reward_energy: settings.daily_reward_coins,
          reward_energy_text: `+${settings.daily_reward_coins} Energy`,
          action_button_text: 'CLAIM REWARD',
        },
        '2_total_energy_bottom_sheet': {
          header_title: 'Total Energy',
          total_energy: Number(userStreak.total_energy || 0),
          description: `${userStreak.total_energy} Energy is your current total Energy balance — not today's reward.`,
          rows: {
            current_balance: Number(userStreak.total_energy || 0),
            today_reward: settings.daily_reward_coins,
            next_milestone_reward: nextMilestone.reward_coins,
          },
          action_button_text: 'GOT IT',
        },
        '3_streak_shield_bottom_sheet': {
          header: {
            title: 'Streak Shield',
            description: 'Protect one missed listening day without losing your streak.',
          },
          availability: {
            shields_available: shieldStatus.shields_available,
            max_shields: shieldStatus.max_shields,
          },
          next_shield_progress: {
            title: 'Earn Your Next Shield',
            current_days_progress: shieldStatus.current_days_progress,
            target_days_progress: shieldStatus.target_days_progress,
            days_left: shieldStatus.days_left_to_earn,
            progress_ratio: shieldStatus.progress_ratio,
            subtitle: `${shieldStatus.days_left_to_earn} more successful listening days to earn 1 Shield.`,
          },
          rules_cards: [
            {
              icon: '⚡',
              title: 'Complete daily goals',
              subtitle: 'Finish 7 successful listening days to earn a new Shield.',
            },
            {
              icon: '🛡',
              title: 'Store up to 2',
              subtitle: 'You cannot hold more than 2 Shields at one time.',
            },
            {
              icon: '✕',
              title: 'Missed-day reward',
              subtitle: 'A protected missed day keeps the streak safe, but earns 0 ⚡ Energy.',
            },
            {
              icon: '👇',
              title: 'You stay in control',
              subtitle: 'A Shield is not consumed silently. Roz FM asks before using it.',
            },
          ],
          action_button_text: 'PREVIEW MISSED-DAY ACTION',
        },
        '4_streak_next_reward_bottom_sheet': {
          title: 'Next Reward',
          subtitle: `Reach a ${nextMilestone.days_required}-day streak to unlock this energy reward.`,
          rows: {
            energy_reward: nextMilestone.reward_coins,
            energy_reward_text: `+${nextMilestone.reward_coins} Energy`,
            required_streak_days: nextMilestone.days_required,
            required_streak_text: `${nextMilestone.days_required} days`,
            current_progress_text: `${currentStreakDays} / ${nextMilestone.days_required}`,
            days_left_to_unlock: daysLeftToUnlock,
            status_text: `${daysLeftToUnlock} days left`,
          },
          action_button_text: 'KEEP CHARGING',
        },
        '5_streak_journey_bottom_sheet': {
          milestone_id: nextMilestone.id,
          header_title: `${nextMilestone.days_required} Day Milestone`,
          milestone_name: nextMilestone.name,
          rows: {
            energy_reward: `+${nextMilestone.reward_coins} Energy`,
            current_streak_days: currentStreakDays,
            target_days: nextMilestone.days_required,
            progress_text: `${currentStreakDays} / ${nextMilestone.days_required} days`,
            is_collected: claimedMilestoneIds.has(nextMilestone.id),
            status: `${daysLeftToUnlock} days left`,
          },
        },
        '6_streak_date_details_bottom_sheet': {
          date: todayStr,
          date_title: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
          rows: {
            status: listenedMinutes >= goalMinutes ? 'Completed' : 'In Progress',
            listening_text: `${listenedMinutes} mins`,
            reward_type: `Daily Goal (+${settings.daily_reward_coins} Energy)`,
            potential_reward: `+${settings.daily_reward_coins} Energy`,
          },
          action_button_text: 'DONE',
        },
        '7_streak_achievement_bottom_sheet': {
          achievement_id: 1,
          title: 'First Spark',
          streak_requirement: '3 Day Streak',
          is_earned: currentStreakDays >= 3,
          rows: {
            status: currentStreakDays >= 3 ? 'Earned' : 'Locked',
            requirement: '3 Day Streak',
          },
          action_button_text: 'CLOSE',
        },
      },
    };
  }
}

module.exports = StreakService;
