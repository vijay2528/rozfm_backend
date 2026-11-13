const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

/**
 * Format currency in Indian Lakhs/Thousands/Crores or formatted integer
 */
function formatCurrencyINR(amount) {
  const num = Number(amount) || 0;
  if (num === 0) return '₹0';
  if (num >= 10000000) {
    return `₹${(num / 10000000).toFixed(2)}Cr`;
  }
  if (num >= 100000) {
    return `₹${(num / 100000).toFixed(1)}L`;
  }
  if (num >= 1000) {
    return `₹${(num / 1000).toFixed(1)}K`;
  }
  return `₹${Math.round(num).toLocaleString('en-IN')}`;
}

/**
 * Format exact currency in standard Indian commas (e.g. ₹18,42,900)
 */
function formatExactCurrencyINR(amount) {
  const num = Math.round(Number(amount) || 0);
  return `₹${num.toLocaleString('en-IN')}`;
}

/**
 * Format count numbers (e.g. 2.84M, 412K, 18,204, 3)
 */
function formatCount(num) {
  const n = Number(num) || 0;
  if (n === 0) return '0';
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(2)}M`;
  }
  if (n >= 100000) {
    return `${Math.round(n / 1000)}K`;
  }
  if (n >= 10000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  if (n >= 1000) {
    return n.toLocaleString('en-IN');
  }
  return n.toString();
}

/**
 * Format listening hours (e.g. 9.6M hrs, 250K hrs, 45 hrs, 0 hrs)
 */
function formatListeningHours(hours) {
  const h = Number(hours) || 0;
  if (h === 0) return '0 hrs';
  if (h >= 1000000) {
    return `${(h / 1000000).toFixed(1)}M hrs`;
  }
  if (h >= 1000) {
    return `${Math.round(h / 1000)}K hrs`;
  }
  if (h < 1 && h > 0) {
    return `${h.toFixed(1)} hrs`;
  }
  return `${Math.round(h)} hrs`;
}

/**
 * Format relative time ago (e.g. 8 min ago, 1 hr ago, 3 days ago)
 */
function timeAgo(date) {
  if (!date) return 'Recently';
  const now = new Date();
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'Recently';

  const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr${diffHr > 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/**
 * Calculate growth metrics
 */
function calculateGrowth(current, previous, defaultText = '+0%') {
  const curr = Number(current) || 0;
  const prev = Number(previous) || 0;

  if (prev === 0) {
    if (curr > 0) return { percentage: 100, is_positive: true, text: '+100%' };
    return { percentage: 0, is_positive: true, text: defaultText };
  }

  const diff = curr - prev;
  const pct = parseFloat(((diff / prev) * 100).toFixed(1));
  const isPositive = pct >= 0;
  const sign = isPositive ? '+' : '';
  return {
    percentage: Math.abs(pct),
    is_positive: isPositive,
    text: `${sign}${pct}%`,
  };
}

// Preset color palette for categories / genres donut chart
const GENRE_COLORS = [
  '#8B5CF6', // Purple
  '#3B82F6', // Blue
  '#F59E0B', // Amber / Yellow
  '#EF4444', // Red
  '#10B981', // Emerald
  '#EC4899', // Pink
  '#6366F1', // Indigo
  '#14B8A6', // Teal
  '#06B6D4', // Cyan
  '#84CC16', // Lime
];

/**
 * Generate date keys for the last 7 calendar days (from 6 days ago up to today)
 */
function getLast7DaysKeys() {
  const keys = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

class DashboardController {
  /**
   * GET /api/v1/admin/overview
   * GET /api/v1/admin/dashboard/overview
   * 100% Dynamic platform health snapshot computed in real-time from the database:
   * - 8 KPI Cards (Total Revenue, Active Users, Stories, Episodes, Creators, Listening Time, Premium Members, Daily Growth)
   * - Dynamic 7-day sparkline arrays for every KPI
   * - Coin Revenue with this month's revenue & real growth
   * - Quick Actions shortcuts
   * - Revenue Trend Chart (12-month data series computed from database)
   * - Listening by Genre donut chart (considering Category table, watch history, episode plays & story engagement)
   * - Real-time Recent Activity feed from database events
   */
  static async getOverview(req, res) {
    try {
      const last7Days = getLast7DaysKeys();

      // ─────────────────────────────────────────────────────────────────────────────
      // 1. Total Revenue & Coin Revenue (100% Dynamic from DB)
      // ─────────────────────────────────────────────────────────────────────────────
      let totalCoinSales = 0;
      let totalSubsRevenue = 0;
      let totalCoinTxns = 0;
      let totalUnlocksRevenue = 0;

      let thisMonthCoinRevenue = 0;
      let lastMonthCoinRevenue = 0;
      let thisMonthTotalRevenue = 0;
      let lastMonthTotalRevenue = 0;

      const revenueDailyMap = new Map();

      try {
        const [salesRes] = await pool.query(
          `SELECT 
             COALESCE(SUM(amount), 0) AS total_sales,
             COALESCE(SUM(CASE WHEN created_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00') THEN amount ELSE 0 END), 0) AS this_month_sales,
             COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00'), INTERVAL 1 MONTH) AND created_at < DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00') THEN amount ELSE 0 END), 0) AS last_month_sales
           FROM coin_sales 
           WHERE status = 1 OR status IN ('completed', 'success', 'paid')`
        ).catch(() => [[{ total_sales: 0, this_month_sales: 0, last_month_sales: 0 }]]);
        totalCoinSales = Number(salesRes[0]?.total_sales || 0);
        thisMonthCoinRevenue = Number(salesRes[0]?.this_month_sales || 0);
        lastMonthCoinRevenue = Number(salesRes[0]?.last_month_sales || 0);

        // Daily coin sales in last 7 days for sparkline
        const [dailySales] = await pool.query(`
          SELECT DATE(created_at) as d, SUM(amount) as sum_val
          FROM coin_sales
          WHERE (status = 1 OR status IN ('completed', 'success', 'paid')) AND created_at >= CURDATE() - INTERVAL 6 DAY
          GROUP BY DATE(created_at)
        `).catch(() => [[]]);
        dailySales.forEach(r => {
          const key = new Date(r.d).toISOString().slice(0, 10);
          revenueDailyMap.set(key, (revenueDailyMap.get(key) || 0) + Number(r.sum_val || 0));
        });
      } catch (_) {}

      try {
        const [subRes] = await pool.query(
          `SELECT 
             COALESCE(SUM(p.price), 0) AS total_sub,
             COALESCE(SUM(CASE WHEN s.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00') THEN p.price ELSE 0 END), 0) AS this_month_sub,
             COALESCE(SUM(CASE WHEN s.created_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00'), INTERVAL 1 MONTH) AND s.created_at < DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00') THEN p.price ELSE 0 END), 0) AS last_month_sub
           FROM subscriptions s 
           LEFT JOIN purchase_plans p ON s.plan_id = p.id 
           WHERE s.status IN ('active', 'completed', 'paid', '1')`
        ).catch(() => [[{ total_sub: 0, this_month_sub: 0, last_month_sub: 0 }]]);
        totalSubsRevenue = Number(subRes[0]?.total_sub || 0);
        thisMonthTotalRevenue += Number(subRes[0]?.this_month_sub || 0);
        lastMonthTotalRevenue += Number(subRes[0]?.last_month_sub || 0);

        // Daily subscriptions in last 7 days for sparkline
        const [dailySubs] = await pool.query(`
          SELECT DATE(s.created_at) as d, SUM(p.price) as sum_val
          FROM subscriptions s
          LEFT JOIN purchase_plans p ON s.plan_id = p.id
          WHERE s.status IN ('active', 'completed', 'paid', '1') AND s.created_at >= CURDATE() - INTERVAL 6 DAY
          GROUP BY DATE(s.created_at)
        `).catch(() => [[]]);
        dailySubs.forEach(r => {
          const key = new Date(r.d).toISOString().slice(0, 10);
          revenueDailyMap.set(key, (revenueDailyMap.get(key) || 0) + Number(r.sum_val || 0));
        });
      } catch (_) {}

      try {
        const [txnRes] = await pool.query(
          `SELECT 
             COALESCE(SUM(coins), 0) AS total_coins,
             COALESCE(SUM(CASE WHEN created_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00') THEN coins ELSE 0 END), 0) AS this_month_coins,
             COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00'), INTERVAL 1 MONTH) AND created_at < DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00') THEN coins ELSE 0 END), 0) AS last_month_coins
           FROM coin_transactions 
           WHERE type LIKE '%purchase%' OR type LIKE '%credit%'`
        ).catch(() => [[{ total_coins: 0, this_month_coins: 0, last_month_coins: 0 }]]);
        totalCoinTxns = Number(txnRes[0]?.total_coins || 0) * 0.5;
        if (thisMonthCoinRevenue === 0) {
          thisMonthCoinRevenue = Number(txnRes[0]?.this_month_coins || 0) * 0.5;
          lastMonthCoinRevenue = Number(txnRes[0]?.last_month_coins || 0) * 0.5;
        }
      } catch (_) {}

      try {
        const [unlockRes] = await pool.query(
          `SELECT COALESCE(SUM(coins_spent), 0) AS total_unlocks FROM user_episode_unlocks`
        ).catch(() => [[{ total_unlocks: 0 }]]);
        totalUnlocksRevenue = Number(unlockRes[0]?.total_unlocks || 0) * 0.5;
      } catch (_) {}

      const totalRevenueNum = totalCoinSales + totalSubsRevenue + totalCoinTxns + totalUnlocksRevenue;
      thisMonthTotalRevenue += thisMonthCoinRevenue;
      lastMonthTotalRevenue += lastMonthCoinRevenue;

      const formattedTotalRevenue = formatCurrencyINR(totalRevenueNum);
      const revenueGrowth = calculateGrowth(thisMonthTotalRevenue, lastMonthTotalRevenue, '+0%');
      const revenueTrendSparkline = last7Days.map(d => Number((revenueDailyMap.get(d) || 0).toFixed(2)));

      // Coin revenue this month
      const formattedCoinRevenue = formatExactCurrencyINR(thisMonthCoinRevenue);
      const coinGrowth = calculateGrowth(thisMonthCoinRevenue, lastMonthCoinRevenue, '+0%');
      const coinGrowthText = `${coinGrowth.text} vs last month`;

      // ─────────────────────────────────────────────────────────────────────────────
      // 2. Active Users & Daily Growth (100% Dynamic from DB)
      // ─────────────────────────────────────────────────────────────────────────────
      let totalUsersCount = 0;
      let activeUsersCount = 0;
      let dailyGrowthCount = 0;
      let yesterdayUsersCount = 0;
      let prev30dUsersCount = 0;

      const userDailySparklineMap = new Map();

      try {
        const [[{ total_users }]] = await pool.query('SELECT COUNT(*) as total_users FROM users').catch(() => [[{ total_users: 0 }]]);
        totalUsersCount = Number(total_users || 0);

        const [[{ active_users }]] = await pool.query(
          `SELECT COUNT(DISTINCT id) as active_users FROM users 
           WHERE updated_at >= NOW() - INTERVAL 30 DAY OR created_at >= NOW() - INTERVAL 30 DAY`
        ).catch(() => [[{ active_users: 0 }]]);
        activeUsersCount = Number(active_users || 0);

        const [[{ today_users }]] = await pool.query(
          `SELECT COUNT(*) as today_users FROM users 
           WHERE created_at >= CURDATE()`
        ).catch(() => [[{ today_users: 0 }]]);
        dailyGrowthCount = Number(today_users || 0);

        const [[{ yesterday_users }]] = await pool.query(
          `SELECT COUNT(*) as yesterday_users FROM users 
           WHERE created_at >= CURDATE() - INTERVAL 1 DAY AND created_at < CURDATE()`
        ).catch(() => [[{ yesterday_users: 0 }]]);
        yesterdayUsersCount = Number(yesterday_users || 0);

        const [[{ prev_30d }]] = await pool.query(
          `SELECT COUNT(*) as prev_30d FROM users 
           WHERE created_at >= NOW() - INTERVAL 60 DAY AND created_at < NOW() - INTERVAL 30 DAY`
        ).catch(() => [[{ prev_30d: 0 }]]);
        prev30dUsersCount = Number(prev_30d || 0);

        // Daily users sparkline for last 7 days
        const [dailyUsers] = await pool.query(`
          SELECT DATE(created_at) as d, COUNT(*) as cnt
          FROM users
          WHERE created_at >= CURDATE() - INTERVAL 6 DAY
          GROUP BY DATE(created_at)
        `).catch(() => [[]]);
        dailyUsers.forEach(r => {
          const key = new Date(r.d).toISOString().slice(0, 10);
          userDailySparklineMap.set(key, Number(r.cnt || 0));
        });
      } catch (_) {}

      const displayActiveUsers = activeUsersCount > 0 ? activeUsersCount : totalUsersCount;
      const formattedActiveUsers = formatCount(displayActiveUsers);
      const activeUsersGrowth = calculateGrowth(activeUsersCount || totalUsersCount, prev30dUsersCount, '+0%');
      const activeUsersSparkline = last7Days.map(d => userDailySparklineMap.get(d) || 0);

      const formattedDailyGrowth = `+${dailyGrowthCount.toLocaleString('en-IN')}`;
      const dailyGrowthTrend = calculateGrowth(dailyGrowthCount, yesterdayUsersCount, '+0%');
      const dailyGrowthSparkline = last7Days.map(d => userDailySparklineMap.get(d) || 0);

      // ─────────────────────────────────────────────────────────────────────────────
      // 3. Total Stories (100% Dynamic from DB)
      // ─────────────────────────────────────────────────────────────────────────────
      let totalStoriesCount = 0;
      let prevMonthStoriesCount = 0;
      const storiesSparklineMap = new Map();

      try {
        const [[{ total_stories }]] = await pool.query('SELECT COUNT(*) as total_stories FROM stories').catch(() => [[{ total_stories: 0 }]]);
        totalStoriesCount = Number(total_stories || 0);

        const [[{ prev_stories }]] = await pool.query(
          'SELECT COUNT(*) as prev_stories FROM stories WHERE created_at < NOW() - INTERVAL 30 DAY'
        ).catch(() => [[{ prev_stories: 0 }]]);
        prevMonthStoriesCount = Number(prev_stories || 0);

        const [dailyStories] = await pool.query(`
          SELECT DATE(created_at) as d, COUNT(*) as cnt
          FROM stories
          WHERE created_at >= CURDATE() - INTERVAL 6 DAY
          GROUP BY DATE(created_at)
        `).catch(() => [[]]);
        dailyStories.forEach(r => {
          const key = new Date(r.d).toISOString().slice(0, 10);
          storiesSparklineMap.set(key, Number(r.cnt || 0));
        });
      } catch (_) {}

      const formattedStories = totalStoriesCount.toLocaleString('en-IN');
      const storiesGrowth = calculateGrowth(totalStoriesCount, prevMonthStoriesCount, '+0%');
      const storiesSparkline = last7Days.map(d => storiesSparklineMap.get(d) || 0);

      // ─────────────────────────────────────────────────────────────────────────────
      // 4. Total Episodes (100% Dynamic from DB)
      // ─────────────────────────────────────────────────────────────────────────────
      let totalEpisodesCount = 0;
      let prevMonthEpisodesCount = 0;
      const episodesSparklineMap = new Map();

      try {
        const [[{ total_episodes }]] = await pool.query('SELECT COUNT(*) as total_episodes FROM episodes').catch(() => [[{ total_episodes: 0 }]]);
        totalEpisodesCount = Number(total_episodes || 0);

        const [[{ prev_episodes }]] = await pool.query(
          'SELECT COUNT(*) as prev_episodes FROM episodes WHERE created_at < NOW() - INTERVAL 30 DAY'
        ).catch(() => [[{ prev_episodes: 0 }]]);
        prevMonthEpisodesCount = Number(prev_episodes || 0);

        const [dailyEpisodes] = await pool.query(`
          SELECT DATE(created_at) as d, COUNT(*) as cnt
          FROM episodes
          WHERE created_at >= CURDATE() - INTERVAL 6 DAY
          GROUP BY DATE(created_at)
        `).catch(() => [[]]);
        dailyEpisodes.forEach(r => {
          const key = new Date(r.d).toISOString().slice(0, 10);
          episodesSparklineMap.set(key, Number(r.cnt || 0));
        });
      } catch (_) {}

      const formattedEpisodes = totalEpisodesCount.toLocaleString('en-IN');
      const episodesGrowth = calculateGrowth(totalEpisodesCount, prevMonthEpisodesCount, '+0%');
      const episodesSparkline = last7Days.map(d => episodesSparklineMap.get(d) || 0);

      // ─────────────────────────────────────────────────────────────────────────────
      // 5. Active Creators (100% Dynamic from DB)
      // ─────────────────────────────────────────────────────────────────────────────
      let totalCreatorsCount = 0;
      let prevMonthCreatorsCount = 0;
      const creatorsSparklineMap = new Map();

      try {
        const [[{ creators }]] = await pool.query(
          `SELECT COUNT(*) as creators FROM users 
           WHERE (role LIKE '%creator%' OR role LIKE '%writer%') AND (is_blocked = 0 OR is_blocked IS NULL)`
        ).catch(() => [[{ creators: 0 }]]);
        totalCreatorsCount = Number(creators || 0);

        const [[{ prev_creators }]] = await pool.query(
          `SELECT COUNT(*) as prev_creators FROM users 
           WHERE (role LIKE '%creator%' OR role LIKE '%writer%') AND created_at < NOW() - INTERVAL 30 DAY`
        ).catch(() => [[{ prev_creators: 0 }]]);
        prevMonthCreatorsCount = Number(prev_creators || 0);

        const [dailyCreators] = await pool.query(`
          SELECT DATE(created_at) as d, COUNT(*) as cnt
          FROM users
          WHERE (role LIKE '%creator%' OR role LIKE '%writer%') AND created_at >= CURDATE() - INTERVAL 6 DAY
          GROUP BY DATE(created_at)
        `).catch(() => [[]]);
        dailyCreators.forEach(r => {
          const key = new Date(r.d).toISOString().slice(0, 10);
          creatorsSparklineMap.set(key, Number(r.cnt || 0));
        });
      } catch (_) {}

      const formattedCreators = totalCreatorsCount.toLocaleString('en-IN');
      const creatorsGrowth = calculateGrowth(totalCreatorsCount, prevMonthCreatorsCount, '+0%');
      const creatorsSparkline = last7Days.map(d => creatorsSparklineMap.get(d) || 0);

      // ─────────────────────────────────────────────────────────────────────────────
      // 6. Listening Time (Hours - 100% Dynamic from DB)
      // ─────────────────────────────────────────────────────────────────────────────
      let totalListeningSeconds = 0;
      let prevMonthListeningSeconds = 0;
      const listeningSparklineMap = new Map();

      try {
        const [[{ wh_seconds }]] = await pool.query(
          'SELECT COALESCE(SUM(progress_seconds), 0) as wh_seconds FROM watch_histories'
        ).catch(() => [[{ wh_seconds: 0 }]]);
        const [[{ ep_seconds }]] = await pool.query(
          'SELECT COALESCE(SUM(plays_count * duration_seconds), 0) as ep_seconds FROM episodes WHERE plays_count > 0'
        ).catch(() => [[{ ep_seconds: 0 }]]);

        totalListeningSeconds = Math.max(Number(wh_seconds || 0), Number(ep_seconds || 0));

        const [[{ prev_wh_seconds }]] = await pool.query(
          `SELECT COALESCE(SUM(progress_seconds), 0) as prev_wh_seconds 
           FROM watch_histories 
           WHERE COALESCE(last_watched_at, updated_at, created_at) < NOW() - INTERVAL 30 DAY`
        ).catch(() => [[{ prev_wh_seconds: 0 }]]);
        prevMonthListeningSeconds = Number(prev_wh_seconds || 0);

        const [dailyWh] = await pool.query(`
          SELECT DATE(COALESCE(last_watched_at, updated_at, created_at)) as d, SUM(progress_seconds) as sum_sec
          FROM watch_histories
          WHERE COALESCE(last_watched_at, updated_at, created_at) >= CURDATE() - INTERVAL 6 DAY
          GROUP BY DATE(COALESCE(last_watched_at, updated_at, created_at))
        `).catch(() => [[]]);
        dailyWh.forEach(r => {
          const key = new Date(r.d).toISOString().slice(0, 10);
          const hrs = Number((Number(r.sum_sec || 0) / 3600).toFixed(2));
          listeningSparklineMap.set(key, hrs);
        });
      } catch (_) {}

      const calculatedHours = totalListeningSeconds > 0 ? (totalListeningSeconds / 3600) : 0;
      const formattedListeningHours = formatListeningHours(calculatedHours);
      const listeningGrowth = calculateGrowth(totalListeningSeconds, prevMonthListeningSeconds, '+0%');
      const listeningSparkline = last7Days.map(d => listeningSparklineMap.get(d) || 0);

      // ─────────────────────────────────────────────────────────────────────────────
      // 7. Premium Members (100% Dynamic from DB)
      // ─────────────────────────────────────────────────────────────────────────────
      let totalPremiumCount = 0;
      let prevMonthPremiumCount = 0;
      const premiumSparklineMap = new Map();

      try {
        const [[{ subs }]] = await pool.query(
          `SELECT COUNT(DISTINCT user_id) as subs FROM subscriptions 
           WHERE status IN ('active', '1', 'completed') AND (expires_at IS NULL OR expires_at > NOW())`
        ).catch(() => [[{ subs: 0 }]]);

        const [[{ vipUsers }]] = await pool.query(
          `SELECT COUNT(*) as vipUsers FROM users 
           WHERE subscription_type IN ('vip', 'premium') OR role IN ('vip', 'premium')`
        ).catch(() => [[{ vipUsers: 0 }]]);

        totalPremiumCount = Math.max(Number(subs || 0), Number(vipUsers || 0));

        const [[{ prev_subs }]] = await pool.query(
          `SELECT COUNT(DISTINCT user_id) as prev_subs FROM subscriptions 
           WHERE created_at < NOW() - INTERVAL 30 DAY`
        ).catch(() => [[{ prev_subs: 0 }]]);
        prevMonthPremiumCount = Number(prev_subs || 0);

        const [dailySubs] = await pool.query(`
          SELECT DATE(created_at) as d, COUNT(*) as cnt
          FROM subscriptions
          WHERE created_at >= CURDATE() - INTERVAL 6 DAY
          GROUP BY DATE(created_at)
        `).catch(() => [[]]);
        dailySubs.forEach(r => {
          const key = new Date(r.d).toISOString().slice(0, 10);
          premiumSparklineMap.set(key, Number(r.cnt || 0));
        });
      } catch (_) {}

      const formattedPremium = formatCount(totalPremiumCount);
      const premiumGrowth = calculateGrowth(totalPremiumCount, prevMonthPremiumCount, '+0%');
      const premiumSparkline = last7Days.map(d => premiumSparklineMap.get(d) || 0);

      // ─────────────────────────────────────────────────────────────────────────────
      // 8. Quick Actions Shortcuts
      // ─────────────────────────────────────────────────────────────────────────────
      const quickActions = [
        {
          id: 'upload_audio',
          title: 'Upload Audio',
          icon: 'upload',
          action: 'upload_audio',
          route: '/admin/stories/create',
        },
        {
          id: 'send_notification',
          title: 'Send Notification',
          icon: 'bell',
          action: 'send_notification',
          route: '/admin/notifications/push',
        },
        {
          id: 'add_coupon',
          title: 'Add Coupon',
          icon: 'ticket',
          action: 'add_coupon',
          route: '/admin/coupons/create',
        },
        {
          id: 'review_queue',
          title: 'Review Queue',
          icon: 'check-circle',
          action: 'review_queue',
          route: '/admin/pending-stories',
        },
      ];

      // ─────────────────────────────────────────────────────────────────────────────
      // 9. Revenue Trend Chart (100% Dynamic Jan - Dec from DB)
      // ─────────────────────────────────────────────────────────────────────────────
      const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const totalRevenueMonthly = new Array(12).fill(0);
      const coinRevenueMonthly = new Array(12).fill(0);

      try {
        const [salesMonthly] = await pool.query(`
          SELECT MONTH(created_at) AS month_num, SUM(amount) AS sum_amount
          FROM coin_sales
          WHERE (status = 1 OR status IN ('completed', 'success', 'paid')) AND YEAR(created_at) = YEAR(CURRENT_DATE)
          GROUP BY MONTH(created_at)
        `).catch(() => [[]]);

        const [subMonthly] = await pool.query(`
          SELECT MONTH(s.created_at) AS month_num, SUM(p.price) AS sum_amount
          FROM subscriptions s
          LEFT JOIN purchase_plans p ON s.plan_id = p.id
          WHERE s.status IN ('active', 'completed', 'paid', '1') AND YEAR(s.created_at) = YEAR(CURRENT_DATE)
          GROUP BY MONTH(s.created_at)
        `).catch(() => [[]]);

        const [unlocksMonthly] = await pool.query(`
          SELECT MONTH(unlocked_at) AS month_num, SUM(coins_spent) AS sum_amount
          FROM user_episode_unlocks
          WHERE YEAR(unlocked_at) = YEAR(CURRENT_DATE)
          GROUP BY MONTH(unlocked_at)
        `).catch(() => [[]]);

        salesMonthly.forEach((r) => {
          const m = Number(r.month_num) - 1;
          if (m >= 0 && m < 12) {
            const amt = Math.round(Number(r.sum_amount || 0));
            coinRevenueMonthly[m] += amt;
            totalRevenueMonthly[m] += amt;
          }
        });

        subMonthly.forEach((r) => {
          const m = Number(r.month_num) - 1;
          if (m >= 0 && m < 12) {
            totalRevenueMonthly[m] += Math.round(Number(r.sum_amount || 0));
          }
        });

        unlocksMonthly.forEach((r) => {
          const m = Number(r.month_num) - 1;
          if (m >= 0 && m < 12) {
            totalRevenueMonthly[m] += Math.round(Number(r.sum_amount || 0) * 0.5);
          }
        });
      } catch (_) {}

      const revenueTrend = {
        title: 'Revenue Trend',
        labels: monthLabels,
        series: {
          total: totalRevenueMonthly,
          coins: coinRevenueMonthly,
        },
        toggles: [
          { key: 'total', label: 'Total', color: '#8B5CF6' },
          { key: 'coins', label: 'Coins', color: '#F59E0B' },
        ],
      };

      // ─────────────────────────────────────────────────────────────────────────────
      // 10. Listening by Genre (100% Dynamic considering Category table & DB counts)
      // ─────────────────────────────────────────────────────────────────────────────
      let categoryListeningList = [];

      try {
        const [catRows] = await pool.query(`
          SELECT 
            c.id AS category_id,
            COALESCE(c.category_name, 'Uncategorized') AS category_name,
            COALESCE(wh_agg.total_seconds, 0) AS total_seconds,
            COALESCE(wh_agg.session_count, 0) AS session_count,
            COALESCE(s_agg.stories_count, 0) AS stories_count,
            COALESCE(s_agg.total_listeners, 0) AS total_listeners,
            COALESCE(s_agg.total_views, 0) AS total_views,
            COALESCE(ep_agg.total_ep_plays, 0) AS total_ep_plays
          FROM categories c
          LEFT JOIN (
            SELECT s.category_id, 
                   COUNT(s.id) AS stories_count,
                   SUM(COALESCE(s.listeners_count, 0)) AS total_listeners,
                   SUM(COALESCE(s.total_views, 0)) AS total_views
            FROM stories s
            GROUP BY s.category_id
          ) s_agg ON s_agg.category_id = c.id
          LEFT JOIN (
            SELECT s.category_id,
                   COUNT(wh.id) AS session_count,
                   SUM(COALESCE(wh.progress_seconds, 0)) AS total_seconds
            FROM watch_histories wh
            JOIN stories s ON wh.story_id = s.id
            GROUP BY s.category_id
          ) wh_agg ON wh_agg.category_id = c.id
          LEFT JOIN (
            SELECT s.category_id,
                   SUM(COALESCE(ep.plays_count, 0)) AS total_ep_plays
            FROM episodes ep
            JOIN stories s ON ep.story_id = s.id
            GROUP BY s.category_id
          ) ep_agg ON ep_agg.category_id = c.id
          ORDER BY total_seconds DESC, total_ep_plays DESC, total_views DESC, total_listeners DESC, stories_count DESC, c.category_name ASC
        `).catch(() => [[]]);

        if (catRows && catRows.length > 0) {
          const totalWeight = catRows.reduce((acc, row) => {
            const sec = Number(row.total_seconds || 0);
            const plays = Number(row.total_ep_plays || 0);
            const views = Number(row.total_views || 0);
            const listeners = Number(row.total_listeners || 0);
            const stories = Number(row.stories_count || 0);

            const weight = sec > 0
              ? sec
              : (plays * 60) + (views * 30) + (listeners * 60) + (stories * 10);
            return acc + weight;
          }, 0);

          let runningPct = 0;
          categoryListeningList = catRows.map((cat, index) => {
            const sec = Number(cat.total_seconds || 0);
            const plays = Number(cat.total_ep_plays || 0);
            const views = Number(cat.total_views || 0);
            const listeners = Number(cat.total_listeners || 0);
            const stories = Number(cat.stories_count || 0);

            const weight = sec > 0
              ? sec
              : (plays * 60) + (views * 30) + (listeners * 60) + (stories * 10);

            let pct = 0;
            if (totalWeight > 0) {
              pct = Math.round((weight / totalWeight) * 100);
              // Ensure percentages sum to 100 for non-zero items
              if (index === catRows.length - 1 && runningPct + pct !== 100 && runningPct > 0) {
                pct = Math.max(0, 100 - runningPct);
              }
              runningPct += pct;
            }

            const calculatedHours = sec > 0 ? (sec / 3600) : (plays > 0 ? (plays * 0.25) : 0);
            return {
              category_id: Number(cat.category_id),
              genre: cat.category_name,
              category_name: cat.category_name,
              percentage: pct,
              percentage_text: `${pct}%`,
              listening_time: formatListeningHours(calculatedHours),
              plays: Number(cat.session_count || plays || views || 0),
              stories_count: stories,
              color: GENRE_COLORS[index % GENRE_COLORS.length],
            };
          });
        }
      } catch (_) {}

      const activeGenres = categoryListeningList.filter(g => g.percentage > 0);
      const displayGenres = activeGenres.length > 0 ? categoryListeningList : categoryListeningList.slice(0, 8);

      const listeningByGenre = {
        title: 'Listening by Genre',
        total: displayGenres.reduce((acc, g) => acc + g.percentage, 0),
        center_text: displayGenres.some(g => g.percentage > 0) ? '100' : '0',
        unit: '%',
        genres: displayGenres,
        segments: displayGenres.map((g) => ({
          label: g.genre,
          value: g.percentage,
          color: g.color,
        })),
      };

      // ─────────────────────────────────────────────────────────────────────────────
      // 11. Recent Activity Feed (100% Dynamic from DB events)
      // ─────────────────────────────────────────────────────────────────────────────
      const recentActivities = [];

      try {
        // A. Recently verified creators from DB
        const [creators] = await pool.query(
          `SELECT id, name, updated_at 
           FROM users 
           WHERE (role LIKE '%creator%' OR role LIKE '%writer%') AND is_verified = 1 
           ORDER BY updated_at DESC LIMIT 5`
        ).catch(() => [[]]);
        creators.forEach((c) => {
          recentActivities.push({
            id: `creator-${c.id}`,
            type: 'creator_verified',
            title: `Creator "${c.name || 'Creator'}" verified`,
            icon: 'star',
            color: '#F59E0B',
            timestamp: c.updated_at || new Date(),
            time_ago: timeAgo(c.updated_at),
          });
        });

        // B. Stories scheduled or published from DB
        const [stories] = await pool.query(
          `SELECT id, title, updated_at, created_at, status, release_status, is_approved 
           FROM stories 
           ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 5`
        ).catch(() => [[]]);
        stories.forEach((s) => {
          const isSched = String(s.status || s.release_status || '').toLowerCase().includes('schedule');
          recentActivities.push({
            id: `story-${s.id}`,
            type: isSched ? 'story_scheduled' : 'story_published',
            title: isSched ? `"${s.title}" scheduled for release` : `Story "${s.title}" published`,
            icon: 'book',
            color: '#8B5CF6',
            timestamp: s.updated_at || s.created_at || new Date(),
            time_ago: timeAgo(s.updated_at || s.created_at),
          });
        });

        // C. Processed creator payouts/withdrawals from DB
        const [payouts] = await pool.query(
          `SELECT w.id, w.amount, w.updated_at, u.name 
           FROM writer_withdrawals w 
           LEFT JOIN users u ON w.user_id = u.id 
           WHERE w.status IN ('paid', 'approved', 'completed') 
           ORDER BY w.updated_at DESC LIMIT 5`
        ).catch(() => [[]]);
        payouts.forEach((p) => {
          recentActivities.push({
            id: `payout-${p.id}`,
            type: 'payout_processed',
            title: `Payout of ₹${Number(p.amount || 0).toLocaleString('en-IN')} processed to ${p.name || 'Creator'}`,
            icon: 'credit-card',
            color: '#22C55E',
            timestamp: p.updated_at || new Date(),
            time_ago: timeAgo(p.updated_at),
          });
        });

        // D. Flagged reports from DB
        const [flagged] = await pool.query(
          `SELECT er.id, er.created_at, s.title 
           FROM episode_reports er 
           LEFT JOIN stories s ON er.story_id = s.id 
           ORDER BY er.created_at DESC LIMIT 5`
        ).catch(() => [[]]);
        flagged.forEach((f) => {
          recentActivities.push({
            id: `flagged-${f.id}`,
            type: 'story_flagged',
            title: `Story "${f.title || 'Story'}" flagged for review`,
            icon: 'alert-triangle',
            color: '#EF4444',
            timestamp: f.created_at || new Date(),
            time_ago: timeAgo(f.created_at),
          });
        });

        // E. Today's user registrations from DB
        if (dailyGrowthCount > 0) {
          recentActivities.push({
            id: 'users-growth-today',
            type: 'user_growth',
            title: `${dailyGrowthCount.toLocaleString('en-IN')} new users joined today`,
            icon: 'users',
            color: '#3B82F6',
            timestamp: new Date(),
            time_ago: 'Today',
          });
        }

        // F. Recent user signups from DB
        const [recentUsers] = await pool.query(
          `SELECT id, name, created_at 
           FROM users 
           ORDER BY created_at DESC LIMIT 5`
        ).catch(() => [[]]);
        recentUsers.forEach((u) => {
          recentActivities.push({
            id: `user-${u.id}`,
            type: 'user_registered',
            title: `New user "${u.name || 'User'}" joined`,
            icon: 'users',
            color: '#3B82F6',
            timestamp: u.created_at || new Date(),
            time_ago: timeAgo(u.created_at),
          });
        });

        // Sort all real database activities by timestamp descending
        recentActivities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      } catch (_) {}

      // ─────────────────────────────────────────────────────────────────────────────
      // Response Payload (100% Dynamic)
      // ─────────────────────────────────────────────────────────────────────────────
      const responseData = {
        title: 'Overview',
        subtitle: "Real-time snapshot of Roz FM's platform health — revenue, listener activity and creator performance.",
        kpis: {
          total_revenue: {
            label: 'Total Revenue',
            value: formattedTotalRevenue,
            amount: totalRevenueNum,
            change: revenueGrowth.text,
            is_positive: revenueGrowth.is_positive,
            sparkline: revenueTrendSparkline,
          },
          active_users: {
            label: 'Active Users',
            value: formattedActiveUsers,
            count: displayActiveUsers,
            change: activeUsersGrowth.text,
            is_positive: activeUsersGrowth.is_positive,
            sparkline: activeUsersSparkline,
          },
          total_stories: {
            label: 'Total Stories',
            value: formattedStories,
            count: totalStoriesCount,
            change: storiesGrowth.text,
            is_positive: storiesGrowth.is_positive,
            sparkline: storiesSparkline,
          },
          total_episodes: {
            label: 'Total Episodes',
            value: formattedEpisodes,
            count: totalEpisodesCount,
            change: episodesGrowth.text,
            is_positive: episodesGrowth.is_positive,
            sparkline: episodesSparkline,
          },
          active_creators: {
            label: 'Active Creators',
            value: formattedCreators,
            count: totalCreatorsCount,
            change: creatorsGrowth.text,
            is_positive: creatorsGrowth.is_positive,
            sparkline: creatorsSparkline,
          },
          listening_time: {
            label: 'Listening Time',
            value: formattedListeningHours,
            total_hours: Number(calculatedHours.toFixed(1)),
            change: listeningGrowth.text,
            is_positive: listeningGrowth.is_positive,
            sparkline: listeningSparkline,
          },
          premium_members: {
            label: 'Premium Members',
            value: formattedPremium,
            count: totalPremiumCount,
            change: premiumGrowth.text,
            is_positive: premiumGrowth.is_positive,
            sparkline: premiumSparkline,
          },
          daily_growth: {
            label: 'Daily Growth',
            value: formattedDailyGrowth,
            count: dailyGrowthCount,
            change: dailyGrowthTrend.text,
            is_positive: dailyGrowthTrend.is_positive,
            sparkline: dailyGrowthSparkline,
          },
        },
        coin_revenue: {
          title: 'Coin Revenue',
          period: 'This month',
          value: formattedCoinRevenue,
          amount: thisMonthCoinRevenue,
          change: coinGrowthText,
          is_positive: coinGrowth.is_positive,
        },
        quick_actions: quickActions,
        revenue_trend: revenueTrend,
        listening_by_genre: listeningByGenre,
        listening_by_category: listeningByGenre,
        recent_activity: recentActivities.slice(0, 8),
      };

      return ApiResponse.success(res, responseData, 'Admin overview statistics retrieved successfully');
    } catch (error) {
      console.error('Admin Overview Error:', error);
      return ApiResponse.error(res, 'Failed to load admin overview statistics.', 500);
    }
  }

  /**
   * GET /api/v1/admin/real-time-analytics
   * GET /api/v1/admin/realtime-analytics
   * 100% Dynamic real-time listener activity across the platform, refreshed every 10 seconds:
   * - 4 Live KPI Cards (Listeners Online, Episodes Playing, New Signups (1h), Coin Purchases (1h))
   * - Dynamic 12-interval sparklines across the last 60 minutes
   * - Area chart: Concurrent Listeners — last 60 min (12 x 5-minute time intervals)
   */
  static async getRealtimeAnalytics(req, res) {
    try {
      const now = new Date();
      const windowMinutes = Math.min(180, Math.max(15, parseInt(req.query.window, 10) || 60));
      const intervalMinutes = Math.min(30, Math.max(1, parseInt(req.query.interval, 10) || 5));
      const bucketCount = Math.floor(windowMinutes / intervalMinutes); // default 12 buckets

      // Build time buckets from oldest to newest (last 60 minutes)
      const buckets = [];
      for (let i = bucketCount - 1; i >= 0; i--) {
        const start = new Date(now.getTime() - (i + 1) * intervalMinutes * 60 * 1000);
        const end = new Date(now.getTime() - i * intervalMinutes * 60 * 1000);
        const label = end.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
        buckets.push({
          start,
          end,
          label,
          timestamp: end.toISOString(),
          listenersSet: new Set(),
          episodesSet: new Set(),
          signupsCount: 0,
          purchasesCount: 0,
        });
      }

      // 1. Fetch real-time watch histories in window
      try {
        const [whRows] = await pool.query(
          `SELECT 
             user_id,
             episode_id,
             COALESCE(last_watched_at, updated_at, created_at) AS event_time
           FROM watch_histories
           WHERE COALESCE(last_watched_at, updated_at, created_at) >= NOW() - INTERVAL ? MINUTE`,
          [windowMinutes]
        ).catch(() => [[]]);

        whRows.forEach((r) => {
          const t = new Date(r.event_time).getTime();
          buckets.forEach((b) => {
            if (t >= b.start.getTime() && t < b.end.getTime()) {
              if (r.user_id) b.listenersSet.add(r.user_id);
              if (r.episode_id) b.episodesSet.add(r.episode_id);
            }
          });
        });
      } catch (_) {}

      // 2. Fetch new signups in window
      try {
        const [userRows] = await pool.query(
          `SELECT id, created_at
           FROM users
           WHERE created_at >= NOW() - INTERVAL ? MINUTE`,
          [windowMinutes]
        ).catch(() => [[]]);

        userRows.forEach((u) => {
          const t = new Date(u.created_at).getTime();
          buckets.forEach((b) => {
            if (t >= b.start.getTime() && t < b.end.getTime()) {
              b.signupsCount += 1;
            }
          });
        });
      } catch (_) {}

      // 3. Fetch coin purchases in window
      try {
        const [salesRows] = await pool.query(
          `SELECT id, created_at
           FROM coin_sales
           WHERE (status = 1 OR status IN ('completed', 'success', 'paid')) AND created_at >= NOW() - INTERVAL ? MINUTE`,
          [windowMinutes]
        ).catch(() => [[]]);

        const [txnsRows] = await pool.query(
          `SELECT id, created_at
           FROM coin_transactions
           WHERE (type LIKE '%purchase%' OR type = 'credit') AND created_at >= NOW() - INTERVAL ? MINUTE`,
          [windowMinutes]
        ).catch(() => [[]]);

        salesRows.forEach((s) => {
          const t = new Date(s.created_at).getTime();
          buckets.forEach((b) => {
            if (t >= b.start.getTime() && t < b.end.getTime()) {
              b.purchasesCount += 1;
            }
          });
        });

        txnsRows.forEach((tx) => {
          const t = new Date(tx.created_at).getTime();
          buckets.forEach((b) => {
            if (t >= b.start.getTime() && t < b.end.getTime()) {
              b.purchasesCount += 1;
            }
          });
        });
      } catch (_) {}

      // 4. Current online listeners right now (within recent 15 minutes)
      let currentListenersOnline = 0;
      let currentEpisodesPlaying = 0;

      try {
        const [[{ online_listeners }]] = await pool.query(
          `SELECT COUNT(DISTINCT user_id) as online_listeners
           FROM watch_histories
           WHERE COALESCE(last_watched_at, updated_at, created_at) >= NOW() - INTERVAL 15 MINUTE`
        ).catch(() => [[{ online_listeners: 0 }]]);

        const [[{ online_logins }]] = await pool.query(
          `SELECT COUNT(DISTINCT id) as online_logins
           FROM users
           WHERE last_login_at >= NOW() - INTERVAL 15 MINUTE`
        ).catch(() => [[{ online_logins: 0 }]]);

        currentListenersOnline = Math.max(Number(online_listeners || 0), Number(online_logins || 0));

        const [[{ playing_episodes }]] = await pool.query(
          `SELECT COUNT(DISTINCT episode_id) as playing_episodes
           FROM watch_histories
           WHERE COALESCE(last_watched_at, updated_at, created_at) >= NOW() - INTERVAL 15 MINUTE`
        ).catch(() => [[{ playing_episodes: 0 }]]);

        currentEpisodesPlaying = Number(playing_episodes || 0);
      } catch (_) {}

      // Fallback: if last bucket had listeners, ensure current count is at least that
      const lastBucket = buckets[buckets.length - 1];
      if (lastBucket) {
        currentListenersOnline = Math.max(currentListenersOnline, lastBucket.listenersSet.size);
        currentEpisodesPlaying = Math.max(currentEpisodesPlaying, lastBucket.episodesSet.size);
      }

      // 5. Total 1h counts
      const totalSignups1h = buckets.reduce((acc, b) => acc + b.signupsCount, 0);
      const totalPurchases1h = buckets.reduce((acc, b) => acc + b.purchasesCount, 0);

      // Data series for chart & sparklines
      const chartLabels = buckets.map((b) => b.label);
      const chartTimestamps = buckets.map((b) => b.timestamp);
      const concurrentListenersData = buckets.map((b) => b.listenersSet.size);
      const episodesPlayingSparkline = buckets.map((b) => b.episodesSet.size);
      const signupsSparkline = buckets.map((b) => b.signupsCount);
      const purchasesSparkline = buckets.map((b) => b.purchasesCount);

      const peakListeners = Math.max(...concurrentListenersData, currentListenersOnline, 0);
      const totalSumListeners = concurrentListenersData.reduce((acc, v) => acc + v, 0);
      const avgListeners = bucketCount > 0 ? Number((totalSumListeners / bucketCount).toFixed(1)) : 0;

      const responseData = {
        title: 'Real-time Analytics',
        subtitle: 'Live listener activity across the platform, refreshed every 10 seconds.',
        is_live: true,
        refresh_interval_seconds: 10,
        timestamp: now.toISOString(),
        kpis: {
          listeners_online: {
            label: 'Listeners Online',
            value: formatCount(currentListenersOnline),
            count: currentListenersOnline,
            tag: 'Live',
            is_live: true,
            icon: 'headphones',
            color: '#22C55E',
            sparkline: concurrentListenersData,
          },
          episodes_playing: {
            label: 'Episodes Playing',
            value: formatCount(currentEpisodesPlaying),
            count: currentEpisodesPlaying,
            tag: 'Live',
            is_live: true,
            icon: 'play',
            color: '#8B5CF6',
            sparkline: episodesPlayingSparkline,
          },
          new_signups_1h: {
            label: 'New Signups (1h)',
            value: formatCount(totalSignups1h),
            count: totalSignups1h,
            tag: 'Live',
            is_live: true,
            icon: 'users',
            color: '#3B82F6',
            sparkline: signupsSparkline,
          },
          coin_purchases_1h: {
            label: 'Coin Purchases (1h)',
            value: formatCount(totalPurchases1h),
            count: totalPurchases1h,
            tag: 'Live',
            is_live: true,
            icon: 'coins',
            color: '#F59E0B',
            sparkline: purchasesSparkline,
          },
        },
        chart: {
          title: 'Concurrent Listeners — last 60 min',
          unit: 'listeners',
          window_minutes: windowMinutes,
          interval_minutes: intervalMinutes,
          current_listeners: currentListenersOnline,
          peak_listeners: peakListeners,
          average_listeners: avgListeners,
          labels: chartLabels,
          data: concurrentListenersData,
          timestamps: chartTimestamps,
        },
      };

      return ApiResponse.success(res, responseData, 'Real-time analytics retrieved successfully');
    } catch (error) {
      console.error('Real-time Analytics Error:', error);
      return ApiResponse.error(res, 'Failed to load real-time analytics.', 500);
    }
  }

  /**
   * GET /api/v1/admin/dashboard
   * Preserves existing dashboard contract while enriching with overview metrics
   */
  static async index(req, res) {
    try {
      // 1. Total & recent users count
      const [[{ total_users }]] = await pool.query('SELECT COUNT(*) as total_users FROM users').catch(() => [[{ total_users: 0 }]]);
      const [[{ new_users_this_month }]] = await pool.query(
        "SELECT COUNT(*) as new_users_this_month FROM users WHERE created_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00')"
      ).catch(() => [[{ new_users_this_month: 0 }]]);

      // 2. Stories & Episodes stats
      const [[{ total_stories }]] = await pool.query('SELECT COUNT(*) as total_stories FROM stories').catch(() => [[{ total_stories: 0 }]]);
      const [[{ active_stories }]] = await pool.query(
        "SELECT COUNT(*) as active_stories FROM stories WHERE status IN ('ongoing', 'published')"
      ).catch(() => [[{ active_stories: 0 }]]);
      const [[{ total_episodes }]] = await pool.query('SELECT COUNT(*) as total_episodes FROM episodes').catch(() => [[{ total_episodes: 0 }]]);

      // 3. Plays & Listeners stats
      const [[{ total_plays }]] = await pool.query('SELECT SUM(plays_count) as total_plays FROM episodes').catch(() => [[{ total_plays: 0 }]]);
      const [[{ total_listeners }]] = await pool.query('SELECT SUM(listeners_count) as total_listeners FROM stories').catch(() => [[{ total_listeners: 0 }]]);

      // 4. Revenue & Financial stats
      const [[{ total_coin_sales_amount }]] = await pool.query(
        'SELECT COALESCE(SUM(coins), 0) as total_coin_sales_amount FROM coin_transactions WHERE type = "credit"'
      ).catch(() => [[{ total_coin_sales_amount: 0 }]]);
      const [[{ total_active_subscriptions }]] = await pool.query(
        'SELECT COUNT(*) as total_active_subscriptions FROM subscriptions WHERE status = "active"'
      ).catch(() => [[{ total_active_subscriptions: 0 }]]);

      // 5. Recent 5 user registrations
      const [recentUsers] = await pool.query(
        'SELECT id, name, email, phone, subscription_type, created_at FROM users ORDER BY created_at DESC LIMIT 5'
      ).catch(() => [[]]);

      // 6. Recent 5 coin transactions
      const [recentTransactions] = await pool.query(
        `SELECT ct.*, u.name as user_name, u.email as user_email
         FROM coin_transactions ct
         LEFT JOIN users u ON ct.user_id = u.id
         ORDER BY ct.created_at DESC LIMIT 5`
      ).catch(() => [[]]);

      // 7. Top 5 popular stories
      const [topStories] = await pool.query(
        `SELECT s.id, s.title, s.cover_image_path, s.listeners_count, s.total_views, c.category_name
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         ORDER BY s.total_views DESC LIMIT 5`
      ).catch(() => [[]]);

      const overview = {
        users: {
          total: Number(total_users || 0),
          new_this_month: Number(new_users_this_month || 0),
          formatted_total: formatCount(total_users || 0),
        },
        stories: {
          total: Number(total_stories || 0),
          active: Number(active_stories || 0),
        },
        episodes: {
          total: Number(total_episodes || 0),
        },
        engagement: {
          total_plays: Number(total_plays || 0),
          total_plays_formatted: formatCount(total_plays || 0),
          total_listeners: Number(total_listeners || 0),
          total_listeners_formatted: formatCount(total_listeners || 0),
        },
        financials: {
          total_coins_distributed: Number(total_coin_sales_amount || 0),
          active_subscriptions: Number(total_active_subscriptions || 0),
        },
      };

      return ApiResponse.success(res, {
        overview,
        recent_users: recentUsers,
        recent_transactions: recentTransactions,
        top_stories: topStories,
      });
    } catch (error) {
      console.error('Admin Dashboard Error:', error);
      return ApiResponse.error(res, 'Failed to load admin dashboard statistics.', 500);
    }
  }
}

module.exports = DashboardController;
