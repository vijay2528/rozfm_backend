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
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toString();
}

/**
 * Calculate growth percentage between two periods and return a rich object.
 */
function calcGrowth(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) {
    if (c > 0) return { percent: 100, is_positive: true, text: '+100%', arrow: '↑' };
    return { percent: 0, is_positive: true, text: '+0%', arrow: '↑' };
  }
  const pct = parseFloat((((c - p) / p) * 100).toFixed(1));
  const isPos = pct >= 0;
  return {
    percent: Math.abs(pct),
    is_positive: isPos,
    text: `${isPos ? '+' : ''}${pct}%`,
    arrow: isPos ? '↑' : '↓',
  };
}

/**
 * Derive SQL date-range clause and interval grouping from a "period" query param.
 * period: 'today' | 'this_week' | 'this_month' (default) | 'last_month' | 'all_time'
 *
 * Returns { currentStart, previousStart, previousEnd, groupBy, dateFormat, labelFormat }
 */
function getPeriodConfig(period) {
  switch ((period || 'this_month').toLowerCase()) {
    case 'today':
      return {
        currentStart: 'CURDATE()',
        currentEnd: 'NOW()',
        previousStart: 'CURDATE() - INTERVAL 1 DAY',
        previousEnd: 'CURDATE()',
        // For "today" chart: hourly buckets
        dateFormat: '%Y-%m-%d %H:00:00',
        groupBy: 'HOUR(created_at)',
        labelFormat: 'hour',
      };
    case 'this_week':
      return {
        currentStart: 'DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)',
        currentEnd: 'NOW()',
        previousStart: 'DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) + 7 DAY)',
        previousEnd: 'DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)',
        dateFormat: '%Y-%m-%d',
        groupBy: 'DATE(created_at)',
        labelFormat: 'date',
      };
    case 'last_month':
      return {
        currentStart: 'DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, \'%Y-%m-01\')',
        currentEnd: 'DATE_FORMAT(CURDATE(), \'%Y-%m-01\')',
        previousStart: 'DATE_FORMAT(CURDATE() - INTERVAL 2 MONTH, \'%Y-%m-01\')',
        previousEnd: 'DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, \'%Y-%m-01\')',
        dateFormat: '%Y-%m-%d',
        groupBy: 'DATE(created_at)',
        labelFormat: 'date',
      };
    case 'all_time':
      return {
        currentStart: '\'2000-01-01\'',
        currentEnd: 'NOW()',
        previousStart: null,
        previousEnd: null,
        dateFormat: '%Y-%m',
        groupBy: 'DATE_FORMAT(created_at, \'%Y-%m\')',
        labelFormat: 'month',
      };
    case 'this_month':
    default:
      return {
        currentStart: 'DATE_FORMAT(NOW(), \'%Y-%m-01\')',
        currentEnd: 'NOW()',
        previousStart: 'DATE_FORMAT(NOW() - INTERVAL 1 MONTH, \'%Y-%m-01\')',
        previousEnd: 'DATE_FORMAT(NOW(), \'%Y-%m-01\')',
        dateFormat: '%Y-%m-%d',
        groupBy: 'DATE(created_at)',
        labelFormat: 'date',
      };
  }
}

class EpisodeAnalyticsController {
  /**
   * GET /api/v1/analytics/episodes
   * Unified episode analytics for the authenticated writer (across all stories).
   *
   * Query params:
   *   period   : today | this_week | this_month (default) | last_month | all_time
   *   story_id : optional — scope to a single story
   *   limit    : top episodes count (default 10)
   *   page     : page for top episodes pagination (default 1)
   *
   * Response:
   *   summary       — plays, listeners, likes with growth vs previous period
   *   plays_over_time — daily/hourly time-series array for chart rendering
   *   top_episodes  — ranked episodes by play count
   *   period_label  — human-readable period label
   */
  static async index(req, res) {
    try {
      const userId = req.user.id;
      const { period = 'this_month', story_id, limit = 10, page = 1 } = req.query;
      const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const offset = (pageNum - 1) * limitNum;

      const periodCfg = getPeriodConfig(period);

      // ── Resolve story IDs the writer owns ─────────────────────────────────────
      let storyIds = [];
      if (story_id) {
        // Validate ownership
        const [storyRows] = await pool.query(
          'SELECT id FROM stories WHERE id = ? AND user_id = ? LIMIT 1',
          [story_id, userId]
        );
        if (storyRows.length === 0) {
          return ApiResponse.error(res, 'Story not found or does not belong to you.', 404);
        }
        storyIds = [parseInt(story_id, 10)];
      } else {
        const [allStories] = await pool.query(
          'SELECT id FROM stories WHERE user_id = ?',
          [userId]
        );
        storyIds = allStories.map((s) => s.id);
      }

      if (storyIds.length === 0) {
        return ApiResponse.success(res, buildEmptyPayload(period), 'No stories found for this writer.');
      }

      // ── Fetch episode IDs belonging to these stories ───────────────────────────
      const [episodeRows] = await pool.query(
        'SELECT id FROM episodes WHERE story_id IN (?)',
        [storyIds]
      );
      const episodeIds = episodeRows.map((e) => e.id);

      // ── Run all analytics queries in parallel ──────────────────────────────────
      const [summary, playsOverTime, topEpisodes] = await Promise.all([
        EpisodeAnalyticsController.fetchSummary(storyIds, episodeIds, periodCfg),
        EpisodeAnalyticsController.fetchPlaysOverTime(storyIds, periodCfg),
        EpisodeAnalyticsController.fetchTopEpisodes(storyIds, episodeIds, limitNum, offset, periodCfg),
      ]);

      const periodLabels = {
        today: 'Today',
        this_week: 'This Week',
        this_month: 'This Month',
        last_month: 'Last Month',
        all_time: 'All Time',
      };

      return ApiResponse.success(res, {
        period: period,
        period_label: periodLabels[period.toLowerCase()] || 'This Month',
        available_periods: ['today', 'this_week', 'this_month', 'last_month', 'all_time'],
        summary,
        plays_over_time: playsOverTime,
        top_episodes: {
          ...topEpisodes,
          page: pageNum,
          limit: limitNum,
        },
      }, 'Episode analytics fetched successfully.');
    } catch (error) {
      console.error('Episode Analytics Error:', error);
      return ApiResponse.error(res, 'Failed to fetch episode analytics.', 500);
    }
  }

  /**
   * GET /api/v1/analytics/episodes/:episodeId
   * Detailed analytics for a single episode.
   */
  static async showEpisode(req, res) {
    try {
      const userId = req.user.id;
      const episodeId = req.params.id || req.params.episodeId;
      const { period = 'this_month' } = req.query;
      const periodCfg = getPeriodConfig(period);

      // Validate episode belongs to writer
      const [epRows] = await pool.query(
        `SELECT e.*, s.title AS story_title, s.cover_image_path AS story_cover,
                s.id AS story_id, s.user_id
         FROM episodes e
         JOIN stories s ON e.story_id = s.id
         WHERE e.id = ? AND s.user_id = ? LIMIT 1`,
        [episodeId, userId]
      );
      if (epRows.length === 0) {
        return ApiResponse.error(res, 'Episode not found or does not belong to you.', 404);
      }
      const ep = epRows[0];

      // Summary for this episode
      const [currentPlays] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM watch_histories
         WHERE episode_id = ? AND created_at >= ${periodCfg.currentStart} AND created_at <= ${periodCfg.currentEnd}`,
        [episodeId]
      );
      const [prevPlays] = periodCfg.previousStart
        ? await pool.query(
            `SELECT COUNT(*) AS cnt FROM watch_histories
             WHERE episode_id = ? AND created_at >= ${periodCfg.previousStart} AND created_at < ${periodCfg.previousEnd}`,
            [episodeId]
          )
        : [[{ cnt: 0 }]];

      const [currentListeners] = await pool.query(
        `SELECT COUNT(DISTINCT user_id) AS cnt FROM watch_histories
         WHERE episode_id = ? AND created_at >= ${periodCfg.currentStart} AND created_at <= ${periodCfg.currentEnd}`,
        [episodeId]
      );
      const [prevListeners] = periodCfg.previousStart
        ? await pool.query(
            `SELECT COUNT(DISTINCT user_id) AS cnt FROM watch_histories
             WHERE episode_id = ? AND created_at >= ${periodCfg.previousStart} AND created_at < ${periodCfg.previousEnd}`,
            [episodeId]
          )
        : [[{ cnt: 0 }]];

      // Episode-level likes (via story_likes if tied to story, and episode watch completions)
      const [totalLikesRow] = await pool.query(
        'SELECT COUNT(*) AS cnt FROM story_likes WHERE story_id = ?',
        [ep.story_id]
      );

      // Time series for this episode
      const [playsTimeSeries] = await pool.query(
        `SELECT
           DATE_FORMAT(created_at, '${periodCfg.dateFormat}') AS label,
           COUNT(*) AS plays
         FROM watch_histories
         WHERE episode_id = ? AND created_at >= ${periodCfg.currentStart} AND created_at <= ${periodCfg.currentEnd}
         GROUP BY ${periodCfg.groupBy}
         ORDER BY label ASC`,
        [episodeId]
      );

      // Completion rate
      const [completionRow] = await pool.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed_count,
           AVG(completion_percentage) AS avg_completion_pct,
           AVG(progress_seconds) AS avg_progress_seconds
         FROM watch_histories
         WHERE episode_id = ?`,
        [episodeId]
      );
      const compStats = completionRow[0] || {};
      const completionRate = compStats.total > 0
        ? Math.round((Number(compStats.completed_count) / Number(compStats.total)) * 100)
        : 0;

      const curPlays = Number(currentPlays[0]?.cnt || 0);
      const prePlays = Number(prevPlays[0]?.cnt || 0);
      const curListeners = Number(currentListeners[0]?.cnt || 0);
      const preListeners = Number(prevListeners[0]?.cnt || 0);
      const totalLikes = Number(totalLikesRow[0]?.cnt || 0);

      const playsGrowth = calcGrowth(curPlays, prePlays);
      const listenersGrowth = calcGrowth(curListeners, preListeners);

      const periodLabels = {
        today: 'Today', this_week: 'This Week', this_month: 'This Month',
        last_month: 'Last Month', all_time: 'All Time',
      };

      return ApiResponse.success(res, {
        period: period,
        period_label: periodLabels[period.toLowerCase()] || 'This Month',
        episode: {
          id: ep.id,
          title: ep.title || `Episode ${ep.position || ep.id}`,
          episode_number: Number(ep.episode_number || ep.position || 1),
          story_id: ep.story_id,
          story_title: ep.story_title,
          cover_image: resolveUrl(ep.story_cover),
          is_premium: Boolean(ep.is_premium),
        },
        summary: {
          plays: {
            count: curPlays,
            formatted: formatNumber(curPlays),
            growth: playsGrowth,
          },
          listeners: {
            count: curListeners,
            formatted: formatNumber(curListeners),
            growth: listenersGrowth,
          },
          likes: {
            count: totalLikes,
            formatted: formatNumber(totalLikes),
          },
          completion_rate: completionRate,
          completion_rate_text: `${completionRate}%`,
          avg_progress_seconds: Math.round(Number(compStats.avg_progress_seconds || 0)),
          avg_completion_percent: Math.round(Number(compStats.avg_completion_pct || 0)),
        },
        plays_over_time: playsTimeSeries.map((r) => ({
          label: r.label,
          plays: Number(r.plays),
        })),
      }, 'Episode detail analytics fetched successfully.');
    } catch (error) {
      console.error('Episode Detail Analytics Error:', error);
      return ApiResponse.error(res, 'Failed to fetch episode detail analytics.', 500);
    }
  }

  // ─────────────────────────── Helpers ─────────────────────────────────────────

  /**
   * Summary: Plays, Listeners, Likes for current period vs previous period.
   */
  static async fetchSummary(storyIds, episodeIds, periodCfg) {
    const episodeIdsParam = episodeIds.length > 0 ? episodeIds : [0];

    // Current period plays & listeners
    const [[curPlaysRow]] = await pool.query(
      `SELECT COUNT(*) AS plays, COUNT(DISTINCT user_id) AS listeners
       FROM watch_histories
       WHERE story_id IN (?) AND created_at >= ${periodCfg.currentStart} AND created_at <= ${periodCfg.currentEnd}`,
      [storyIds]
    );

    // Previous period plays & listeners
    let prevPlaysRow = { plays: 0, listeners: 0 };
    if (periodCfg.previousStart) {
      [[prevPlaysRow]] = await pool.query(
        `SELECT COUNT(*) AS plays, COUNT(DISTINCT user_id) AS listeners
         FROM watch_histories
         WHERE story_id IN (?) AND created_at >= ${periodCfg.previousStart} AND created_at < ${periodCfg.previousEnd}`,
        [storyIds]
      );
    }

    // Current period likes (story_likes)
    const [[curLikesRow]] = await pool.query(
      `SELECT COUNT(*) AS likes
       FROM story_likes
       WHERE story_id IN (?) AND created_at >= ${periodCfg.currentStart} AND created_at <= ${periodCfg.currentEnd}`,
      [storyIds]
    );

    // Previous period likes
    let prevLikesRow = { likes: 0 };
    if (periodCfg.previousStart) {
      [[prevLikesRow]] = await pool.query(
        `SELECT COUNT(*) AS likes
         FROM story_likes
         WHERE story_id IN (?) AND created_at >= ${periodCfg.previousStart} AND created_at < ${periodCfg.previousEnd}`,
        [storyIds]
      );
    }

    const curPlays = Number(curPlaysRow.plays || 0);
    const prevPlays = Number(prevPlaysRow.plays || 0);
    const curListeners = Number(curPlaysRow.listeners || 0);
    const prevListeners = Number(prevPlaysRow.listeners || 0);
    const curLikes = Number(curLikesRow.likes || 0);
    const prevLikes = Number(prevLikesRow.likes || 0);

    const playsGrowth = calcGrowth(curPlays, prevPlays);
    const listenersGrowth = calcGrowth(curListeners, prevListeners);
    const likesGrowth = calcGrowth(curLikes, prevLikes);

    return {
      plays: {
        count: curPlays,
        formatted: formatNumber(curPlays),
        growth_percent: playsGrowth.percent,
        growth_text: playsGrowth.text,
        is_positive: playsGrowth.is_positive,
        arrow: playsGrowth.arrow,
      },
      listeners: {
        count: curListeners,
        formatted: formatNumber(curListeners),
        growth_percent: listenersGrowth.percent,
        growth_text: listenersGrowth.text,
        is_positive: listenersGrowth.is_positive,
        arrow: listenersGrowth.arrow,
      },
      likes: {
        count: curLikes,
        formatted: formatNumber(curLikes),
        growth_percent: likesGrowth.percent,
        growth_text: likesGrowth.text,
        is_positive: likesGrowth.is_positive,
        arrow: likesGrowth.arrow,
      },
    };
  }

  /**
   * Plays Over Time: daily (or hourly) time-series for line chart.
   */
  static async fetchPlaysOverTime(storyIds, periodCfg) {
    const [rows] = await pool.query(
      `SELECT
         DATE_FORMAT(created_at, '${periodCfg.dateFormat}') AS label,
         COUNT(*) AS plays,
         COUNT(DISTINCT user_id) AS listeners
       FROM watch_histories
       WHERE story_id IN (?) AND created_at >= ${periodCfg.currentStart} AND created_at <= ${periodCfg.currentEnd}
       GROUP BY ${periodCfg.groupBy}
       ORDER BY label ASC`,
      [storyIds]
    );

    const points = rows.map((r) => ({
      label: r.label,
      plays: Number(r.plays),
      listeners: Number(r.listeners),
    }));

    const totalPlays = points.reduce((acc, p) => acc + p.plays, 0);
    const peakPoint = points.reduce(
      (best, p) => (p.plays > best.plays ? p : best),
      { label: null, plays: 0, listeners: 0 }
    );

    return {
      data: points,
      peak: peakPoint.label ? peakPoint : null,
      total_in_period: totalPlays,
      chart_type: periodCfg.labelFormat,
    };
  }

  /**
   * Top Episodes: episodes ranked by plays in the current period.
   * Each item includes plays, likes, and share_percent of total plays.
   */
  static async fetchTopEpisodes(storyIds, episodeIds, limit, offset, periodCfg) {
    if (episodeIds.length === 0) {
      return { episodes: [], total: 0, total_pages: 0 };
    }

    // Total plays in period (for computing share %)
    const [[{ totalPlays }]] = await pool.query(
      `SELECT COUNT(*) AS totalPlays FROM watch_histories
       WHERE story_id IN (?) AND created_at >= ${periodCfg.currentStart} AND created_at <= ${periodCfg.currentEnd}`,
      [storyIds]
    );
    const totalPlaysNum = Number(totalPlays || 0);

    // Per-episode play count in period
    const [rows] = await pool.query(
      `SELECT
         e.id AS episode_id,
         e.title,
         e.position,
         e.episode_number,
         e.is_premium,
         s.id AS story_id,
         s.title AS story_title,
         s.cover_image_path AS story_cover,
         COUNT(wh.id) AS plays_count,
         COUNT(DISTINCT wh.user_id) AS listeners_count,
         SUM(CASE WHEN wh.completed = 1 THEN 1 ELSE 0 END) AS completed_count,
         (
           SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = e.story_id
         ) AS story_likes_count
       FROM episodes e
       JOIN stories s ON e.story_id = s.id
       LEFT JOIN watch_histories wh
         ON wh.episode_id = e.id
         AND wh.created_at >= ${periodCfg.currentStart}
         AND wh.created_at <= ${periodCfg.currentEnd}
       WHERE e.story_id IN (?)
       GROUP BY e.id, e.title, e.position, e.episode_number, e.is_premium,
                s.id, s.title, s.cover_image_path
       ORDER BY plays_count DESC, listeners_count DESC
       LIMIT ? OFFSET ?`,
      [storyIds, limit, offset]
    );

    // Total count for pagination (all episodes across these stories)
    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM episodes WHERE story_id IN (?)',
      [storyIds]
    );

    const episodes = rows.map((ep, index) => {
      const plays = Number(ep.plays_count || 0);
      const listeners = Number(ep.listeners_count || 0);
      const completed = Number(ep.completed_count || 0);
      const storeLikes = Number(ep.story_likes_count || 0);
      const sharePct = totalPlaysNum > 0
        ? parseFloat(((plays / totalPlaysNum) * 100).toFixed(1))
        : 0;
      const completionRate = plays > 0 ? Math.round((completed / plays) * 100) : 0;

      return {
        rank: offset + index + 1,
        episode_id: ep.episode_id,
        id: ep.episode_id,
        title: ep.title || `Episode ${ep.episode_number || ep.position || ep.episode_id}`,
        episode_number: Number(ep.episode_number || ep.position || 1),
        is_premium: Boolean(ep.is_premium),
        story_id: ep.story_id,
        story_title: ep.story_title,
        cover_image: resolveUrl(ep.story_cover),
        // Metrics
        plays: plays,
        plays_formatted: formatNumber(plays),
        listeners: listeners,
        listeners_formatted: formatNumber(listeners),
        likes: storeLikes,
        likes_formatted: formatNumber(storeLikes),
        completed_count: completed,
        completion_rate: completionRate,
        completion_rate_text: `${completionRate}%`,
        // Share of total plays this period
        share_percent: sharePct,
        share_percent_text: `${sharePct}%`,
      };
    });

    return {
      episodes,
      total: Number(total),
      total_pages: Math.ceil(Number(total) / limit),
      total_plays_in_period: totalPlaysNum,
    };
  }
}

/**
 * Helper: build empty analytics payload when writer has no stories.
 */
function buildEmptyPayload(period) {
  const periodLabels = {
    today: 'Today', this_week: 'This Week', this_month: 'This Month',
    last_month: 'Last Month', all_time: 'All Time',
  };
  const emptyMetric = { count: 0, formatted: '0', growth_percent: 0, growth_text: '+0%', is_positive: true, arrow: '↑' };
  return {
    period,
    period_label: periodLabels[period] || 'This Month',
    available_periods: ['today', 'this_week', 'this_month', 'last_month', 'all_time'],
    summary: { plays: emptyMetric, listeners: emptyMetric, likes: emptyMetric },
    plays_over_time: { data: [], peak: null, total_in_period: 0, chart_type: 'date' },
    top_episodes: { episodes: [], total: 0, total_pages: 0, total_plays_in_period: 0, page: 1, limit: 10 },
  };
}

module.exports = EpisodeAnalyticsController;
