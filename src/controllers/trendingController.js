const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';

function resolveUrl(pathStr) {
  if (!pathStr) return null;
  if (typeof pathStr !== 'string') return null;
  const trimmed = pathStr.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
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

function calcGrowthPercent(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c > 0 ? 100 : 0;
  return Number((((c - p) / p) * 100).toFixed(1));
}

function formatGrowth(pct) {
  if (pct > 0) return `\u2191 ${pct}%`;
  if (pct < 0) return `\u2193 ${Math.abs(pct)}%`;
  return '0%';
}

class TrendingController {
  /**
   * GET /api/v1/trending
   * Unified trending page data:
   *  - my_ranking: authenticated user's overall rank (in India/country) & per-genre rank
   *  - trending_stories: top stories grouped by categories (with per-category trending list)
   *  - fast_growing: stories with highest play-count growth % this week vs last week
   */
  static async index(req, res) {
    try {
      const userId = req.user ? req.user.id : null;
      const { category_id, limit = 10 } = req.query;
      const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));

      // 1. My Ranking (only for authenticated users)
      let myRanking = null;
      if (userId) {
        myRanking = await TrendingController.fetchMyRanking(userId);
      }

      // 2. Trending Stories (by category)
      const trendingStories = await TrendingController.fetchTrendingStories(limitNum, category_id || null);

      // 3. Fast Growing (This Week)
      const fastGrowing = await TrendingController.fetchFastGrowing(limitNum);

      return ApiResponse.success(res, {
        my_ranking: myRanking,
        trending_stories: trendingStories,
        fast_growing: fastGrowing,
      }, 'Trending data fetched successfully.');
    } catch (error) {
      console.error('Trending Index Error:', error);
      return ApiResponse.error(res, 'Failed to fetch trending data.', 500);
    }
  }

  /**
   * GET /api/v1/trending/my-ranking
   * Returns the authenticated user's:
   *  - overall_rank: rank by total plays among all writers
   *  - overall_total: total number of writers on platform
   *  - category_ranks: per-genre rank
   */
  static async myRanking(req, res) {
    try {
      const userId = req.user ? req.user.id : null;
      if (!userId) {
        return ApiResponse.error(res, 'Authentication required.', 401);
      }

      const ranking = await TrendingController.fetchMyRanking(userId);
      return ApiResponse.success(res, { ranking }, 'User ranking fetched successfully.');
    } catch (error) {
      console.error('My Ranking Error:', error);
      return ApiResponse.error(res, 'Failed to fetch user ranking.', 500);
    }
  }

  /**
   * GET /api/v1/trending/stories
   * Trending stories list, optionally filtered by category_id.
   * Query params: category_id, limit, page
   */
  static async trendingStories(req, res) {
    try {
      const { category_id, limit = 10, page = 1 } = req.query;
      const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const offset = (pageNum - 1) * limitNum;

      const data = await TrendingController.fetchTrendingStories(limitNum, category_id || null, offset);
      return ApiResponse.success(res, {
        ...data,
        page: pageNum,
        limit: limitNum,
      }, 'Trending stories fetched successfully.');
    } catch (error) {
      console.error('Trending Stories Error:', error);
      return ApiResponse.error(res, 'Failed to fetch trending stories.', 500);
    }
  }

  /**
   * GET /api/v1/trending/fast-growing
   * Stories with highest growth % in plays this week vs last week.
   * Query params: limit, page
   */
  static async fastGrowing(req, res) {
    try {
      const { limit = 10, page = 1 } = req.query;
      const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const offset = (pageNum - 1) * limitNum;

      const data = await TrendingController.fetchFastGrowing(limitNum, offset);
      return ApiResponse.success(res, {
        ...data,
        page: pageNum,
        limit: limitNum,
      }, 'Fast growing stories fetched successfully.');
    } catch (error) {
      console.error('Fast Growing Error:', error);
      return ApiResponse.error(res, 'Failed to fetch fast growing stories.', 500);
    }
  }

  // ─────────────────────── Helper Methods ───────────────────────────────────────

  /**
   * Compute the authenticated user's writer ranking:
   * - overall_rank: rank by total plays on all users' stories globally
   * - overall_total: total writers on the platform
   * - category_ranks: array of { category_id, category_name, rank, total_in_category }
   */
  static async fetchMyRanking(userId) {
    // Get all writer play totals (ordered DESC) to derive the user's rank
    const [writerPlays] = await pool.query(
      `SELECT
         s.user_id,
         COALESCE(SUM(COALESCE(s.total_views, 0)), 0) + COALESCE(SUM(COALESCE(s.listeners_count, 0)), 0) AS total_plays
       FROM stories s
       GROUP BY s.user_id
       ORDER BY total_plays DESC`
    );

    const totalWriters = writerPlays.length;
    const overallRankEntry = writerPlays.findIndex((w) => Number(w.user_id) === Number(userId));
    const overallRank = overallRankEntry >= 0 ? overallRankEntry + 1 : null;

    // Category-level ranks: for each category the user has stories in, compute rank
    const [userCategories] = await pool.query(
      `SELECT DISTINCT s.category_id, c.category_name
       FROM stories s
       LEFT JOIN categories c ON c.id = s.category_id
       WHERE s.user_id = ? AND s.category_id IS NOT NULL`,
      [userId]
    );

    const categoryRanks = await Promise.all(
      userCategories.map(async (cat) => {
        const [catPlays] = await pool.query(
          `SELECT
             s.user_id,
             COALESCE(SUM(COALESCE(s.total_views, 0)), 0) + COALESCE(SUM(COALESCE(s.listeners_count, 0)), 0) AS total_plays
           FROM stories s
           WHERE s.category_id = ?
           GROUP BY s.user_id
           ORDER BY total_plays DESC`,
          [cat.category_id]
        );
        const totalInCat = catPlays.length;
        const rankInCat = catPlays.findIndex((w) => Number(w.user_id) === Number(userId));
        const myPlaysInCat = rankInCat >= 0 ? Number(catPlays[rankInCat].total_plays) : 0;

        return {
          category_id: cat.category_id,
          category_name: cat.category_name || 'General',
          rank: rankInCat >= 0 ? rankInCat + 1 : null,
          total_in_category: totalInCat,
          my_plays: myPlaysInCat,
          my_plays_formatted: `${formatNumber(myPlaysInCat)} Plays`,
        };
      })
    );

    // User's own total plays
    const myWriterEntry = writerPlays.find((w) => Number(w.user_id) === Number(userId));
    const myTotalPlays = myWriterEntry ? Number(myWriterEntry.total_plays) : 0;

    return {
      overall_rank: overallRank,
      overall_total: totalWriters,
      my_total_plays: myTotalPlays,
      my_total_plays_formatted: `${formatNumber(myTotalPlays)} Plays`,
      category_ranks: categoryRanks,
    };
  }

  /**
   * Fetch trending stories by total plays (optionally filtered by category).
   * Returns:
   *  - categories: list of all categories (for tab bar)
   *  - stories: list of trending stories with plays, growth indicator, is_now_trending flag
   */
  static async fetchTrendingStories(limit = 10, categoryId = null, offset = 0) {
    // All active categories for the tab bar
    const [categories] = await pool.query(
      `SELECT id, category_name FROM categories ORDER BY category_name ASC`
    );

    const params = [];
    let whereClause = `WHERE (s.status IS NULL OR s.status = '' OR LOWER(s.status) IN ('ongoing', 'completed', 'published'))`;

    if (categoryId) {
      whereClause += ` AND s.category_id = ?`;
      params.push(categoryId);
    }

    const [storiesRows] = await pool.query(
      `SELECT
         s.id,
         s.title,
         s.cover_image_path,
         s.total_views,
         s.listeners_count,
         s.rating,
         s.episodes_count,
         s.category_id,
         c.category_name,
         u.id AS author_id,
         u.name AS author_name,
         u.avatar_path AS author_avatar,
         COALESCE(s.total_views, 0) + COALESCE(s.listeners_count, 0) AS total_plays,
         (
           SELECT COUNT(*) FROM watch_histories wh
           WHERE wh.story_id = s.id
             AND wh.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         ) AS plays_this_week,
         (
           SELECT COUNT(*) FROM watch_histories wh
           WHERE wh.story_id = s.id
             AND wh.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
             AND wh.created_at <  DATE_SUB(NOW(), INTERVAL 7 DAY)
         ) AS plays_last_week
       FROM stories s
       LEFT JOIN categories c ON c.id = s.category_id
       LEFT JOIN users u ON u.id = s.user_id
       ${whereClause}
       ORDER BY total_plays DESC, s.rating DESC, s.id ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Total count for pagination
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM stories s ${whereClause}`,
      params
    );

    // The top story globally (rank 1) gets is_now_trending = true
    const maxPlays = storiesRows.length > 0 ? Number(storiesRows[0].total_plays) : 0;

    const stories = storiesRows.map((s, index) => {
      const totalPlays = Number(s.total_plays || 0);
      const playsThisWeek = Number(s.plays_this_week || 0);
      const playsLastWeek = Number(s.plays_last_week || 0);
      const growthPct = calcGrowthPercent(playsThisWeek, playsLastWeek);
      const coverUrl = resolveUrl(s.cover_image_path);
      const authorAvatarUrl = resolveUrl(s.author_avatar);

      return {
        rank: offset + index + 1,
        story_id: s.id,
        id: s.id,
        title: s.title || 'Untitled',
        cover_image_path: coverUrl,
        cover_image: coverUrl,
        category_id: s.category_id,
        category_name: s.category_name || 'General',
        rating: parseFloat(s.rating || 0),
        episodes_count: Number(s.episodes_count || 0),
        total_plays: totalPlays,
        plays_formatted: `${formatNumber(totalPlays)} Plays`,
        plays_this_week: playsThisWeek,
        plays_last_week: playsLastWeek,
        growth_percent: growthPct,
        growth_text: formatGrowth(growthPct),
        is_growing: growthPct > 0,
        is_now_trending: offset + index === 0 && totalPlays === maxPlays,
        author: {
          id: s.author_id,
          name: s.author_name || 'Unknown',
          avatar: authorAvatarUrl,
        },
      };
    });

    return {
      categories: categories.map((c) => ({ id: c.id, name: c.category_name })),
      stories,
      total,
      total_pages: Math.ceil(total / limit),
    };
  }

  /**
   * Fetch fast-growing stories based on plays growth % this week vs last week.
   * Stories ranked by growth percentage (descending), with a minimum of 1 play this week.
   */
  static async fetchFastGrowing(limit = 10, offset = 0) {
    const [rows] = await pool.query(
      `SELECT
         s.id,
         s.title,
         s.cover_image_path,
         s.total_views,
         s.listeners_count,
         s.rating,
         s.category_id,
         c.category_name,
         u.id AS author_id,
         u.name AS author_name,
         u.avatar_path AS author_avatar,
         COALESCE(s.total_views, 0) + COALESCE(s.listeners_count, 0) AS total_plays,
         (
           SELECT COUNT(*) FROM watch_histories wh
           WHERE wh.story_id = s.id
             AND wh.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         ) AS plays_this_week,
         (
           SELECT COUNT(*) FROM watch_histories wh
           WHERE wh.story_id = s.id
             AND wh.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
             AND wh.created_at <  DATE_SUB(NOW(), INTERVAL 7 DAY)
         ) AS plays_last_week
       FROM stories s
       LEFT JOIN categories c ON c.id = s.category_id
       LEFT JOIN users u ON u.id = s.user_id
       WHERE (s.status IS NULL OR s.status = '' OR LOWER(s.status) IN ('ongoing', 'completed', 'published'))
       HAVING plays_this_week > 0
       ORDER BY plays_this_week DESC
       LIMIT 200`
    );

    // Sort by growth % descending in JS (avoids SQL division-by-zero complications)
    const withGrowth = rows
      .map((s) => {
        const playsThisWeek = Number(s.plays_this_week || 0);
        const playsLastWeek = Number(s.plays_last_week || 0);
        const growthPct = calcGrowthPercent(playsThisWeek, playsLastWeek);
        return { ...s, playsThisWeek, playsLastWeek, growthPct };
      })
      .sort((a, b) => b.growthPct - a.growthPct || b.playsThisWeek - a.playsThisWeek);

    const total = withGrowth.length;
    const paginated = withGrowth.slice(offset, offset + limit);

    const stories = paginated.map((s, index) => {
      const totalPlays = Number(s.total_plays || 0);
      const coverUrl = resolveUrl(s.cover_image_path);
      const authorAvatarUrl = resolveUrl(s.author_avatar);

      return {
        rank: offset + index + 1,
        story_id: s.id,
        id: s.id,
        title: s.title || 'Untitled',
        cover_image_path: coverUrl,
        cover_image: coverUrl,
        category_id: s.category_id,
        category_name: s.category_name || 'General',
        rating: parseFloat(s.rating || 0),
        total_plays: totalPlays,
        plays_formatted: `${formatNumber(totalPlays)} Plays`,
        plays_this_week: s.playsThisWeek,
        plays_last_week: s.playsLastWeek,
        growth_percent: s.growthPct,
        growth_text: formatGrowth(s.growthPct),
        growth_badge: `${s.growthPct > 0 ? '+' : ''}${formatNumber(s.growthPct)}%`,
        is_growing: s.growthPct > 0,
        author: {
          id: s.author_id,
          name: s.author_name || 'Unknown',
          avatar: authorAvatarUrl,
        },
      };
    });

    return {
      stories,
      total,
      total_pages: Math.ceil(total / limit),
      period: 'this_week',
    };
  }
}

module.exports = TrendingController;
