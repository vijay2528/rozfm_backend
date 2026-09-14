const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';

function resolveUrl(pathStr) {
  if (!pathStr) return null;
  if (typeof pathStr !== 'string') return null;
  const trimmed = pathStr.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${trimmed.replace(/^\//, '')}`;
}

function formatNumber(num) {
  const n = Number(num) || 0;
  if (n >= 1000000) {
    return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (n >= 1000) {
    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return n.toString();
}

function formatCurrency(amount) {
  const val = Number(amount) || 0;
  return '₹' + val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calculateGrowth(current, previous) {
  const curr = Number(current) || 0;
  const prev = Number(previous) || 0;

  if (prev === 0) {
    if (curr > 0) return { percentage: 100, is_positive: true, text: '+100%' };
    return { percentage: 0, is_positive: true, text: '+0%' };
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

class WriterDashboardController {
  /**
   * GET /api/v1/writer/dashboard
   * Writer Studio Dashboard summary endpoint
   */
  static async index(req, res) {
    try {
      const targetUserId =
        req.query.user_id ||
        req.query.id ||
        (req.user ? req.user.id : null);

      if (!targetUserId) {
        return ApiResponse.error(res, 'User ID is required.', 400);
      }

      const userIdNum = Number(targetUserId);

      // 1. Fetch User / Writer Details
      let user = null;
      try {
        const [[userRow]] = await pool.query(
          `SELECT id, name, username, email, avatar_path, bio, role, subscription_type, is_verified
           FROM users WHERE id = ? LIMIT 1`,
          [userIdNum]
        );
        user = userRow;
      } catch (err) {
        console.error('Error fetching writer user:', err.message);
      }

      if (!user) {
        return ApiResponse.error(res, 'Writer user not found.', 404);
      }

      // Check if user is a creator/writer
      let userStoriesCount = 0;
      try {
        const [[storyCntRow]] = await pool.query(
          'SELECT COUNT(*) AS cnt FROM stories WHERE user_id = ?',
          [userIdNum]
        );
        if (storyCntRow) userStoriesCount = Number(storyCntRow.cnt || 0);
      } catch (_) {}

      const userRole = user.role ? String(user.role).toLowerCase() : 'user';
      const isCreatorRole = ['creator', 'writer', 'admin', 'moderator'].includes(userRole);
      const isCreator = isCreatorRole || userStoriesCount > 0;

      if (!isCreator) {
        return ApiResponse.success(res, null, 'User is not a creator yet.');
      }

      // Determine Writer Badge Title
      let badgeText = 'Writer';
      if (user.subscription_type && String(user.subscription_type).toLowerCase() === 'premium') {
        badgeText = 'Premium Writer';
      } else if (user.role && (String(user.role).toLowerCase() === 'creator' || String(user.role).toLowerCase() === 'admin')) {
        badgeText = 'Verified Creator';
      }

      const rawUsername = user.username ? user.username.replace(/^@/, '') : null;
      const handle = rawUsername ? `@${rawUsername}` : null;

      const writerInfo = {
        user_id: user.id,
        name: user.name || null,
        username: rawUsername,
        handle: handle,
        profile_image: resolveUrl(user.avatar_path),
        avatar_path: resolveUrl(user.avatar_path),
        badge_text: badgeText,
        is_premium: Boolean(user.subscription_type && String(user.subscription_type).toLowerCase() === 'premium'),
        tagline: user.bio || null,
      };

      // 3. Earnings Calculation from writer_earnings & fallback user_episode_unlocks
      let todayAmt = 0;
      let yestAmt = 0;
      let monthAmt = 0;
      let totalAmt = 0;

      // Try querying writer_earnings table
      try {
        const [[{ todayEarningsRaw }]] = await pool.query(
          `SELECT COALESCE(SUM(amount), 0) AS todayEarningsRaw
           FROM writer_earnings WHERE user_id = ? AND DATE(created_at) = CURDATE()`,
          [userIdNum]
        );
        const [[{ yestEarningsRaw }]] = await pool.query(
          `SELECT COALESCE(SUM(amount), 0) AS yestEarningsRaw
           FROM writer_earnings WHERE user_id = ? AND DATE(created_at) = CURDATE() - INTERVAL 1 DAY`,
          [userIdNum]
        );
        const [[{ monthEarningsRaw }]] = await pool.query(
          `SELECT COALESCE(SUM(amount), 0) AS monthEarningsRaw
           FROM writer_earnings WHERE user_id = ? AND MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())`,
          [userIdNum]
        );
        const [[{ totalEarningsRaw }]] = await pool.query(
          `SELECT COALESCE(SUM(amount), 0) AS totalEarningsRaw
           FROM writer_earnings WHERE user_id = ?`,
          [userIdNum]
        );

        todayAmt = Number(todayEarningsRaw || 0);
        yestAmt = Number(yestEarningsRaw || 0);
        monthAmt = Number(monthEarningsRaw || 0);
        totalAmt = Number(totalEarningsRaw || 0);
      } catch (err) {
        console.warn('writer_earnings table query warning:', err.message);
      }

      // If writer_earnings is empty or missing, fallback to computing from user_episode_unlocks
      if (totalAmt === 0) {
        try {
          const [unlockRows] = await pool.query(
            `SELECT ueu.coins_spent, ueu.unlocked_at, DATE(ueu.unlocked_at) AS unlock_date
             FROM user_episode_unlocks ueu
             JOIN episodes e ON ueu.episode_id = e.id
             JOIN stories s ON e.story_id = s.id
             WHERE s.user_id = ?`,
            [userIdNum]
          );

          if (unlockRows.length > 0) {
            let sharePct = 70.0;
            let coinsPerRupee = 10.0;

            try {
              const [settingRows] = await pool.query(
                "SELECT `key`, `value` FROM settings WHERE `key` IN ('writer_revenue_share_percentage', 'coins_per_rupee')"
              );
              settingRows.forEach((s) => {
                if (s.key === 'writer_revenue_share_percentage' && s.value) {
                  const val = parseFloat(s.value);
                  if (!isNaN(val) && val >= 0) sharePct = val;
                }
                if (s.key === 'coins_per_rupee' && s.value) {
                  const val = parseFloat(s.value);
                  if (!isNaN(val) && val > 0) coinsPerRupee = val;
                }
              });
            } catch (_) {}

            const todayStr = new Date().toISOString().split('T')[0];
            const yestDate = new Date(Date.now() - 86400000);
            const yestStr = yestDate.toISOString().split('T')[0];
            const currentMonth = new Date().getMonth();
            const currentYear = new Date().getFullYear();

            unlockRows.forEach((r) => {
              const coins = Number(r.coins_spent || 0);
              const writerCoins = (coins * sharePct) / 100;
              const inr = writerCoins / coinsPerRupee;

              totalAmt += inr;

              const uDate = r.unlock_date ? new Date(r.unlock_date).toISOString().split('T')[0] : '';
              if (uDate === todayStr) todayAmt += inr;
              if (uDate === yestStr) yestAmt += inr;

              const uObj = new Date(r.unlocked_at || Date.now());
              if (uObj.getMonth() === currentMonth && uObj.getFullYear() === currentYear) {
                monthAmt += inr;
              }
            });
          }
        } catch (unlockErr) {
          console.warn('user_episode_unlocks fallback query warning:', unlockErr.message);
        }
      }

      const earningsGrowth = calculateGrowth(todayAmt, yestAmt);

      const earnings = {
        today: {
          amount: parseFloat(todayAmt.toFixed(2)),
          formatted: formatCurrency(todayAmt),
          currency: 'INR',
          currency_symbol: '₹',
          growth_percentage: earningsGrowth.percentage,
          is_positive: earningsGrowth.is_positive,
          growth_formatted: earningsGrowth.text,
          vs_yesterday_text: `${earningsGrowth.text} vs yesterday`,
        },
        this_month: {
          amount: parseFloat(monthAmt.toFixed(2)),
          formatted: formatCurrency(monthAmt),
          currency: 'INR',
          currency_symbol: '₹',
        },
        total: {
          amount: parseFloat(totalAmt.toFixed(2)),
          formatted: formatCurrency(totalAmt),
          currency: 'INR',
          currency_symbol: '₹',
        },
      };

      // 4. Writer's Stories and Episodes
      let stories = [];
      try {
        const [storyRows] = await pool.query(
          'SELECT id, total_views, listeners_count, shares_count FROM stories WHERE user_id = ?',
          [userIdNum]
        );
        stories = storyRows;
      } catch (err) {
        console.warn('Stories query warning:', err.message);
      }

      const storyIds = stories.map((s) => s.id);
      const totalStoriesCount = stories.length;

      let totalEpisodesCount = 0;
      if (storyIds.length > 0) {
        try {
          const [[{ epCount }]] = await pool.query(
            'SELECT COUNT(*) AS epCount FROM episodes WHERE story_id IN (?)',
            [storyIds]
          );
          totalEpisodesCount = Number(epCount || 0);
        } catch (err) {
          console.warn('Episodes query warning:', err.message);
        }
      }

      // 5. Today's Overview (Plays, Likes, Comments, Shares)
      let todayPlays = 0;
      let yestPlays = 0;
      let todayLikes = 0;
      let yestLikes = 0;
      let todayComments = 0;
      let yestComments = 0;
      let todayShares = 0;

      if (storyIds.length > 0) {
        // Plays today & yesterday from watch_histories
        try {
          const [[{ tPlays }]] = await pool.query(
            `SELECT COUNT(*) AS tPlays FROM watch_histories 
             WHERE story_id IN (?) AND DATE(updated_at) = CURDATE()`,
            [storyIds]
          );
          const [[{ yPlays }]] = await pool.query(
            `SELECT COUNT(*) AS yPlays FROM watch_histories 
             WHERE story_id IN (?) AND DATE(updated_at) = CURDATE() - INTERVAL 1 DAY`,
            [storyIds]
          );
          todayPlays = Number(tPlays || 0);
          yestPlays = Number(yPlays || 0);
        } catch (_) {}

        // Likes today & yesterday from story_likes
        try {
          const [[{ tLikes }]] = await pool.query(
            `SELECT COUNT(*) AS tLikes FROM story_likes 
             WHERE story_id IN (?) AND DATE(created_at) = CURDATE()`,
            [storyIds]
          );
          const [[{ yLikes }]] = await pool.query(
            `SELECT COUNT(*) AS yLikes FROM story_likes 
             WHERE story_id IN (?) AND DATE(created_at) = CURDATE() - INTERVAL 1 DAY`,
            [storyIds]
          );
          todayLikes = Number(tLikes || 0);
          yestLikes = Number(yLikes || 0);
        } catch (_) {}

        // Comments today & yesterday from comments
        try {
          const [[{ tComments }]] = await pool.query(
            `SELECT COUNT(*) AS tComments FROM comments 
             WHERE story_id IN (?) AND DATE(created_at) = CURDATE()`,
            [storyIds]
          );
          const [[{ yComments }]] = await pool.query(
            `SELECT COUNT(*) AS yComments FROM comments 
             WHERE story_id IN (?) AND DATE(created_at) = CURDATE() - INTERVAL 1 DAY`,
            [storyIds]
          );
          todayComments = Number(tComments || 0);
          yestComments = Number(yComments || 0);
        } catch (_) {}

        // Total Shares across writer's stories
        todayShares = stories.reduce((acc, s) => acc + Number(s.shares_count || 0), 0);
      }

      const playsGrowth = calculateGrowth(todayPlays, yestPlays);
      const likesGrowth = calculateGrowth(todayLikes, yestLikes);
      const commentsGrowth = calculateGrowth(todayComments, yestComments);
      const sharesGrowth = calculateGrowth(todayShares, 0);

      const todayOverview = {
        plays: {
          count: todayPlays,
          formatted: formatNumber(todayPlays),
          growth_percentage: playsGrowth.percentage,
          is_positive: playsGrowth.is_positive,
          formatted_growth: playsGrowth.text,
        },
        likes: {
          count: todayLikes,
          formatted: formatNumber(todayLikes),
          growth_percentage: likesGrowth.percentage,
          is_positive: likesGrowth.is_positive,
          formatted_growth: likesGrowth.text,
        },
        comments: {
          count: todayComments,
          formatted: formatNumber(todayComments),
          growth_percentage: commentsGrowth.percentage,
          is_positive: commentsGrowth.is_positive,
          formatted_growth: commentsGrowth.text,
        },
        shares: {
          count: todayShares,
          formatted: formatNumber(todayShares),
          growth_percentage: sharesGrowth.percentage,
          is_positive: sharesGrowth.is_positive,
          formatted_growth: sharesGrowth.text,
        },
      };

      return ApiResponse.success(
        res,
        {
          writer_info: writerInfo,
          earnings: earnings,
          today_overview: todayOverview,
          stories_summary: {
            total_stories: totalStoriesCount,
            total_episodes: totalEpisodesCount,
          },
        },
        'Writer dashboard statistics fetched successfully.'
      );
    } catch (error) {
      console.error('Writer Dashboard Critical Error:', error);
      return ApiResponse.error(res, 'Failed to fetch writer dashboard statistics.', 500);
    }
  }
}

module.exports = WriterDashboardController;
