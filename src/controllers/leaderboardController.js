const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';

function formatImageUrl(path) {
  if (!path) return null;
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
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

function formatPlaysText(num) {
  return `${formatNumber(num)} Plays`;
}

function formatListeningTimeText(totalSeconds) {
  const secs = Number(totalSeconds) || 0;
  const mins = Math.floor(secs / 60);
  if (mins >= 60) {
    const hours = (mins / 60).toFixed(1).replace(/\.0$/, '');
    return `${hours} Hours`;
  }
  return `${mins} Mins`;
}

class LeaderboardController {
  /**
   * Helper: Get Top Writers Leaderboard
   */
  static async fetchWriters(limit = 20, offset = 0, currentUserId = null) {
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);
    const offsetNum = Math.max(0, parseInt(offset, 10) || 0);

    const [rows] = await pool.query(
      `SELECT 
        u.id AS user_id,
        u.name,
        u.username,
        u.avatar_path,
        COUNT(DISTINCT s.id) AS stories_count,
        COALESCE(SUM(s.total_views), 0) + COALESCE(SUM(s.listeners_count), 0) AS total_plays
       FROM users u
       INNER JOIN stories s ON s.user_id = u.id
       WHERE u.is_blocked = 0
       GROUP BY u.id
       ORDER BY total_plays DESC, stories_count DESC, u.id ASC
       LIMIT ? OFFSET ?`,
      [limitNum, offsetNum]
    );

    let followedUserIds = new Set();
    if (currentUserId && rows.length > 0) {
      const targetUserIds = rows.map((r) => r.user_id);
      const [followRows] = await pool.query(
        `SELECT following_id FROM user_follows WHERE follower_id = ? AND following_id IN (?)`,
        [currentUserId, targetUserIds]
      );
      followedUserIds = new Set(followRows.map((f) => f.following_id));
    }

    const allRankings = rows.map((r, index) => {
      const rank = offsetNum + index + 1;
      const rawName = r.name && r.name.trim() !== '' ? r.name.trim() : 'Writer';
      const rawUsername = r.username ? r.username.trim().replace(/^@/, '') : `writer_${r.user_id}`;
      const totalPlays = Number(r.total_plays || 0);
      const imgUrl = formatImageUrl(r.avatar_path);

      return {
        rank: rank,
        user_id: Number(r.user_id),
        name: rawName,
        username: rawUsername,
        handle: `@${rawUsername}`,
        profile_image: imgUrl,
        avatar_path: imgUrl,
        stories_count: Number(r.stories_count || 0),
        total_plays: totalPlays,
        plays_formatted: formatPlaysText(totalPlays),
        is_following: followedUserIds.has(r.user_id),
      };
    });

    const topThree = allRankings.slice(0, 3);
    const rankings = allRankings.slice(3);

    return {
      top_three: topThree,
      rankings: rankings,
      all_rankings: allRankings,
    };
  }

  /**
   * Helper: Get Top Stories Leaderboard
   */
  static async fetchStories(limit = 20, offset = 0) {
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);
    const offsetNum = Math.max(0, parseInt(offset, 10) || 0);

    const [rows] = await pool.query(
      `SELECT 
        s.id AS story_id,
        s.title,
        s.slug,
        s.description,
        s.cover_image_path,
        s.banner_image_path,
        s.total_views,
        s.listeners_count,
        s.rating,
        s.episodes_count,
        c.category_name,
        u.id AS writer_id,
        u.name AS writer_name,
        u.username AS writer_username,
        u.avatar_path AS writer_avatar
       FROM stories s
       LEFT JOIN categories c ON c.id = s.category_id
       LEFT JOIN users u ON u.id = s.user_id
       ORDER BY (COALESCE(s.total_views, 0) + COALESCE(s.listeners_count, 0)) DESC, s.rating DESC, s.id ASC
       LIMIT ? OFFSET ?`,
      [limitNum, offsetNum]
    );

    const allRankings = rows.map((r, index) => {
      const rank = offsetNum + index + 1;
      const plays = Number(r.total_views || r.listeners_count || 0);
      const coverUrl = formatImageUrl(r.cover_image_path);
      const bannerUrl = formatImageUrl(r.banner_image_path);
      const writerAvatarUrl = formatImageUrl(r.writer_avatar);

      return {
        rank: rank,
        story_id: Number(r.story_id),
        id: Number(r.story_id),
        title: r.title || 'Untitled Story',
        slug: r.slug || null,
        description: r.description || null,
        cover_image_path: coverUrl,
        banner_image_path: bannerUrl,
        category_name: r.category_name || 'General',
        total_views: Number(r.total_views || 0),
        listeners_count: Number(r.listeners_count || 0),
        plays_count: plays,
        plays_formatted: formatPlaysText(plays),
        rating: parseFloat(r.rating || 0),
        episodes_count: Number(r.episodes_count || 0),
        writer: {
          user_id: r.writer_id ? Number(r.writer_id) : null,
          name: r.writer_name ? r.writer_name.trim() : 'Unknown Writer',
          username: r.writer_username ? r.writer_username.trim() : null,
          profile_image: writerAvatarUrl,
          avatar_path: writerAvatarUrl,
        },
      };
    });

    const topThree = allRankings.slice(0, 3);
    const rankings = allRankings.slice(3);

    return {
      top_three: topThree,
      rankings: rankings,
      all_rankings: allRankings,
    };
  }

  /**
   * Helper: Get Top Listeners Leaderboard
   */
  static async fetchListeners(limit = 20, offset = 0) {
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);
    const offsetNum = Math.max(0, parseInt(offset, 10) || 0);

    const [rows] = await pool.query(
      `SELECT 
        u.id AS user_id,
        u.name,
        u.username,
        u.avatar_path,
        GREATEST(
          COALESCE(wh.total_listened_secs, 0),
          COALESCE(da.total_da_secs, 0)
        ) AS total_listened_seconds,
        COALESCE(st.current_streak_days, 0) AS current_streak_days,
        COALESCE(st.total_energy, 0) AS total_energy
       FROM users u
       LEFT JOIN (
         SELECT user_id, SUM(total_seconds_listened) AS total_listened_secs
         FROM watch_histories
         GROUP BY user_id
       ) wh ON wh.user_id = u.id
       LEFT JOIN (
         SELECT user_id, SUM(listened_seconds) AS total_da_secs
         FROM user_daily_activity
         GROUP BY user_id
       ) da ON da.user_id = u.id
       LEFT JOIN user_streaks st ON st.user_id = u.id
       WHERE u.is_blocked = 0
       ORDER BY total_listened_seconds DESC, total_energy DESC, current_streak_days DESC, u.id ASC
       LIMIT ? OFFSET ?`,
      [limitNum, offsetNum]
    );

    const allRankings = rows.map((r, index) => {
      const rank = offsetNum + index + 1;
      const rawName = r.name && r.name.trim() !== '' ? r.name.trim() : 'Listener';
      const rawUsername = r.username ? r.username.trim().replace(/^@/, '') : `listener_${r.user_id}`;
      const listenedSecs = Number(r.total_listened_seconds || 0);
      const listenedMins = Math.floor(listenedSecs / 60);
      const imgUrl = formatImageUrl(r.avatar_path);

      return {
        rank: rank,
        user_id: Number(r.user_id),
        name: rawName,
        username: rawUsername,
        handle: `@${rawUsername}`,
        profile_image: imgUrl,
        avatar_path: imgUrl,
        total_listened_seconds: listenedSecs,
        total_listened_minutes: listenedMins,
        listening_formatted: formatListeningTimeText(listenedSecs),
        plays_formatted: `${formatNumber(listenedMins)} Mins`,
        current_streak_days: Number(r.current_streak_days || 0),
        total_energy: Number(r.total_energy || 0),
      };
    });

    const topThree = allRankings.slice(0, 3);
    const rankings = allRankings.slice(3);

    return {
      top_three: topThree,
      rankings: rankings,
      all_rankings: allRankings,
    };
  }

  /**
   * GET /api/v1/leaderboard
   * Unified Leaderboard API returning Writers, Stories, and Listeners in a single call or by type
   */
  static async index(req, res) {
    try {
      const type = (req.query.type || 'all').toString().trim().toLowerCase();
      const limit = parseInt(req.query.limit || '20', 10);
      const page = parseInt(req.query.page || '1', 10);
      const offset = (page - 1) * limit;
      const currentUserId = req.user ? req.user.id : null;

      if (type === 'writers') {
        const writers = await LeaderboardController.fetchWriters(limit, offset, currentUserId);
        return ApiResponse.success(res, { type: 'writers', page, limit, ...writers }, 'Writers leaderboard fetched successfully.');
      }

      if (type === 'stories') {
        const stories = await LeaderboardController.fetchStories(limit, offset);
        return ApiResponse.success(res, { type: 'stories', page, limit, ...stories }, 'Stories leaderboard fetched successfully.');
      }

      if (type === 'listeners') {
        const listeners = await LeaderboardController.fetchListeners(limit, offset);
        return ApiResponse.success(res, { type: 'listeners', page, limit, ...listeners }, 'Listeners leaderboard fetched successfully.');
      }

      // Unified response for all three sections in a single API call
      const [writers, stories, listeners] = await Promise.all([
        LeaderboardController.fetchWriters(limit, offset, currentUserId),
        LeaderboardController.fetchStories(limit, offset),
        LeaderboardController.fetchListeners(limit, offset),
      ]);

      return ApiResponse.success(
        res,
        {
          writers: writers,
          stories: stories,
          listeners: listeners,
        },
        'Leaderboard data fetched successfully.'
      );
    } catch (error) {
      console.error('Leaderboard Error:', error);
      return ApiResponse.error(res, 'Failed to fetch leaderboard data.', 500);
    }
  }

  /**
   * GET /api/v1/leaderboard/writers
   */
  static async writers(req, res) {
    try {
      const limit = parseInt(req.query.limit || '20', 10);
      const page = parseInt(req.query.page || '1', 10);
      const offset = (page - 1) * limit;
      const currentUserId = req.user ? req.user.id : null;

      const data = await LeaderboardController.fetchWriters(limit, offset, currentUserId);
      return ApiResponse.success(res, { page, limit, ...data }, 'Writers leaderboard fetched successfully.');
    } catch (error) {
      console.error('Writers Leaderboard Error:', error);
      return ApiResponse.error(res, 'Failed to fetch writers leaderboard.', 500);
    }
  }

  /**
   * GET /api/v1/leaderboard/stories
   */
  static async stories(req, res) {
    try {
      const limit = parseInt(req.query.limit || '20', 10);
      const page = parseInt(req.query.page || '1', 10);
      const offset = (page - 1) * limit;

      const data = await LeaderboardController.fetchStories(limit, offset);
      return ApiResponse.success(res, { page, limit, ...data }, 'Stories leaderboard fetched successfully.');
    } catch (error) {
      console.error('Stories Leaderboard Error:', error);
      return ApiResponse.error(res, 'Failed to fetch stories leaderboard.', 500);
    }
  }

  /**
   * GET /api/v1/leaderboard/listeners
   */
  static async listeners(req, res) {
    try {
      const limit = parseInt(req.query.limit || '20', 10);
      const page = parseInt(req.query.page || '1', 10);
      const offset = (page - 1) * limit;

      const data = await LeaderboardController.fetchListeners(limit, offset);
      return ApiResponse.success(res, { page, limit, ...data }, 'Listeners leaderboard fetched successfully.');
    } catch (error) {
      console.error('Listeners Leaderboard Error:', error);
      return ApiResponse.error(res, 'Failed to fetch listeners leaderboard.', 500);
    }
  }
}

module.exports = LeaderboardController;
