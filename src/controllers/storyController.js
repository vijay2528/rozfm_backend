const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const { toStoryFieldsArray } = require('../utils/storyPresenter');
const { uploadToR2 } = require('../services/r2StorageService');

class StoryController {
  /**
   * GET /api/v1/stories
   * List published stories with optional filtering (category_id, search, language, sort)
   */
  static async index(req, res) {
    try {
      const { category_id, search, language, sort, page = 1, limit = 10 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const offset = (pageNum - 1) * limitNum;

      let whereClauses = ["s.status IN ('ongoing', 'completed', 'published')"];
      let queryParams = [];

      if (category_id) {
        whereClauses.push('s.category_id = ?');
        queryParams.push(category_id);
      }

      if (language) {
        whereClauses.push('s.language = ?');
        queryParams.push(language);
      }

      if (search) {
        whereClauses.push('(s.title LIKE ? OR s.description LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`);
      }

      let orderBy = 's.created_at DESC';
      if (sort === 'popular') {
        orderBy = 's.listeners_count DESC, s.total_views DESC';
      } else if (sort === 'rating') {
        orderBy = 's.rating DESC';
      } else if (sort === 'trending') {
        orderBy = 's.total_views DESC';
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) as count FROM stories s ${whereSql}`,
        queryParams
      );

      const [stories] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         ${whereSql}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      const userId = req.user ? req.user.id : null;
      let userLikedIds = new Set();
      let userBookmarkedIds = new Set();

      if (userId && stories.length > 0) {
        const storyIds = stories.map((s) => s.id);
        const [likes] = await pool.query(
          'SELECT story_id FROM story_likes WHERE user_id = ? AND story_id IN (?)',
          [userId, storyIds]
        );
        likes.forEach((l) => userLikedIds.add(l.story_id));

        const [bookmarks] = await pool.query(
          'SELECT story_id FROM bookmarks WHERE user_id = ? AND story_id IN (?)',
          [userId, storyIds]
        );
        bookmarks.forEach((b) => userBookmarkedIds.add(b.story_id));
      }

      const result = stories.map((story) =>
        toStoryFieldsArray(story, {
          isLiked: userLikedIds.has(story.id),
          isBookmarked: userBookmarkedIds.has(story.id),
        })
      );

      return ApiResponse.success(res, {
        stories: result,
        total: count,
        total_number: count,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(count / limitNum),
        pagination: {
          total: count,
          page: pageNum,
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('List Stories Error:', error);
      return ApiResponse.error(res, 'Failed to fetch stories.', 500);
    }
  }

  /**
   * GET /api/v1/stories/:id
   * Get single story details with full episodes list
   */
  static async show(req, res) {
    try {
      const storyId = req.params.id || req.params.story;
      const userId = req.user ? req.user.id : null;

      const [storyRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.id = ? LIMIT 1`,
        [storyId]
      );

      if (storyRows.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 444);
      }

      const story = storyRows[0];

      let isLiked = false;
      let isBookmarked = false;
      let userUnlockedEpisodeIds = new Set();
      let hasActiveMembership = false;

      if (userId) {
        const [subRows] = await pool.query(
          "SELECT id FROM subscriptions WHERE user_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1",
          [userId]
        );
        const [userRows] = await pool.query(
          "SELECT subscription_type, role FROM users WHERE id = ? LIMIT 1",
          [userId]
        );
        if (subRows.length > 0 || (userRows.length > 0 && (userRows[0].subscription_type === 'vip' || userRows[0].role === 'vip'))) {
          hasActiveMembership = true;
        }

        const [likeRow] = await pool.query(
          'SELECT id FROM story_likes WHERE user_id = ? AND story_id = ? LIMIT 1',
          [userId, storyId]
        );
        isLiked = likeRow.length > 0;

        const [bookmarkRow] = await pool.query(
          'SELECT id FROM bookmarks WHERE user_id = ? AND story_id = ? LIMIT 1',
          [userId, storyId]
        );
        isBookmarked = bookmarkRow.length > 0;

        const [unlocks] = await pool.query(
          'SELECT episode_id FROM user_episode_unlocks WHERE user_id = ?',
          [userId]
        );
        unlocks.forEach((u) => {
          if (u.episode_id !== null && u.episode_id !== undefined) {
            userUnlockedEpisodeIds.add(Number(u.episode_id));
            userUnlockedEpisodeIds.add(String(u.episode_id));
          }
        });
      }

      // Fetch user's last watched history for this story
      let lastWatchedHistory = null;
      if (userId) {
        try {
          const [historyRows] = await pool.query(
            `SELECT w.*, e.title as episode_title, COALESCE(e.position, 1) as episode_position
             FROM watch_histories w
             INNER JOIN episodes e ON w.episode_id = e.id
             WHERE w.user_id = ? AND w.story_id = ? AND w.episode_id IS NOT NULL
             ORDER BY GREATEST(COALESCE(w.last_watched_at, '1970-01-01'), COALESCE(w.updated_at, '1970-01-01'), COALESCE(w.created_at, '1970-01-01')) DESC, w.id DESC
             LIMIT 1`,
            [userId, storyId]
          );

          if (historyRows.length > 0) {
            lastWatchedHistory = historyRows[0];
          }
        } catch (err) {
          console.error('Fetch user last watched history error:', err);
        }
      }

      // Determine target episode (last played episode or 1st episode as fallback)
      let targetEpisode = null;
      if (lastWatchedHistory && lastWatchedHistory.episode_id) {
        const [epRows] = await pool.query(
          `SELECT e.*, s.title as story_title, s.cover_image_path as story_cover_image_path
           FROM episodes e
           LEFT JOIN stories s ON e.story_id = s.id
           WHERE e.id = ? LIMIT 1`,
          [lastWatchedHistory.episode_id]
        );
        if (epRows.length > 0) {
          targetEpisode = epRows[0];
        }
      }

      if (!targetEpisode) {
        const [firstEpRows] = await pool.query(
          `SELECT e.*, s.title as story_title, s.cover_image_path as story_cover_image_path
           FROM episodes e
           LEFT JOIN stories s ON e.story_id = s.id
           WHERE e.story_id = ?
           ORDER BY e.position ASC, e.id ASC
           LIMIT 1`,
          [storyId]
        );
        if (firstEpRows.length > 0) {
          targetEpisode = firstEpRows[0];
        }
      }

      let lastPlayedEpisodeData = null;
      if (targetEpisode) {
        const isUnlocked = !targetEpisode.is_premium || hasActiveMembership || userUnlockedEpisodeIds.has(Number(targetEpisode.id)) || userUnlockedEpisodeIds.has(String(targetEpisode.id));
        const { toEpisodeFieldsArray } = require('../utils/storyPresenter');

        const progressData = lastWatchedHistory ? {
          progress_seconds: Number(lastWatchedHistory.progress_seconds || 0),
          total_duration_seconds: Number(lastWatchedHistory.total_duration_seconds || targetEpisode.duration_seconds || 0),
          completion_percentage: Number(lastWatchedHistory.completion_percentage || 0),
          status: lastWatchedHistory.status || (lastWatchedHistory.completed ? 'completed' : 'playing'),
          completed: Boolean(lastWatchedHistory.completed),
          is_last_watched: true,
          last_watched_at: lastWatchedHistory.last_watched_at ? new Date(lastWatchedHistory.last_watched_at).toISOString() : null,
        } : {
          progress_seconds: 0,
          total_duration_seconds: Number(targetEpisode.duration_seconds || 0),
          completion_percentage: 0,
          status: 'unwatched',
          completed: false,
          is_last_watched: false,
          last_watched_at: null,
        };

        lastPlayedEpisodeData = toEpisodeFieldsArray(
          targetEpisode,
          story.title,
          isUnlocked,
          progressData
        );
      }

      // Calculate performance & completion metrics dynamically
      let completionRate = 0;
      let avgListeningTime = 0;
      let performanceObj = null;

      try {
        const [watchStats] = await pool.query(
          `SELECT 
             COUNT(id) as total_histories,
             SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed_count,
             AVG(progress_seconds) as avg_progress,
             SUM(CASE WHEN created_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00') THEN 1 ELSE 0 END) as cur_plays,
             SUM(CASE WHEN created_at >= DATE_FORMAT(NOW() - INTERVAL 1 MONTH, '%Y-%m-01 00:00:00') 
                       AND created_at < DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00') THEN 1 ELSE 0 END) as prev_plays,
             COUNT(DISTINCT user_id) as total_listeners,
             COUNT(DISTINCT CASE WHEN created_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00') THEN user_id END) as cur_listeners,
             COUNT(DISTINCT CASE WHEN created_at >= DATE_FORMAT(NOW() - INTERVAL 1 MONTH, '%Y-%m-01 00:00:00') 
                                 AND created_at < DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00') THEN user_id END) as prev_listeners
           FROM watch_histories WHERE story_id = ?`,
          [storyId]
        );

        const [likeStats] = await pool.query(
          `SELECT 
             COUNT(*) as total_likes,
             SUM(CASE WHEN created_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00') THEN 1 ELSE 0 END) as cur_likes,
             SUM(CASE WHEN created_at >= DATE_FORMAT(NOW() - INTERVAL 1 MONTH, '%Y-%m-01 00:00:00') 
                       AND created_at < DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00') THEN 1 ELSE 0 END) as prev_likes
           FROM story_likes WHERE story_id = ?`,
          [storyId]
        );

        const ws = watchStats[0] || {};
        const ls = likeStats[0] || {};

        const totalHistories = Number(ws.total_histories || 0);
        const completedCount = Number(ws.completed_count || 0);

        if (totalHistories > 0) {
          completionRate = Math.round((completedCount / totalHistories) * 100);
        }
        if (ws.avg_progress) {
          avgListeningTime = Math.round(ws.avg_progress);
        }

        const calcGrowth = (cur, prev) => {
          const c = Number(cur) || 0;
          const p = Number(prev) || 0;
          if (p === 0) return c > 0 ? '+100%' : '0%';
          const pct = Number((((c - p) / p) * 100).toFixed(1));
          return pct >= 0 ? `+${pct}%` : `${pct}%`;
        };

        const { formatNumber } = require('../utils/storyPresenter');
        const totalPlays = Math.max(Number(story.total_views || 0), totalHistories);
        const totalListeners = Math.max(Number(story.listeners_count || 0), Number(ws.total_listeners || 0));
        const totalLikes = Number(ls.total_likes || 0);
        const totalShares = Number(story.shares_count || 0);

        performanceObj = {
          plays: {
            count: totalPlays,
            formatted: formatNumber(totalPlays),
            growth: calcGrowth(ws.cur_plays, ws.prev_plays),
          },
          listeners: {
            count: totalListeners,
            formatted: formatNumber(totalListeners),
            growth: calcGrowth(ws.cur_listeners, ws.prev_listeners),
          },
          likes: {
            count: totalLikes,
            formatted: formatNumber(totalLikes),
            growth: calcGrowth(ls.cur_likes, ls.prev_likes),
          },
          shares: {
            count: totalShares,
            formatted: formatNumber(totalShares),
            growth: '0%',
          },
        };
      } catch (err) {
        console.error('Calculate Story Performance Error:', err);
      }

      const watchHistorySummary = lastWatchedHistory ? {
        episode_id: lastWatchedHistory.episode_id,
        episode_no: Number(lastWatchedHistory.episode_position || 1),
        episode_title: lastWatchedHistory.episode_title,
        progress_seconds: Number(lastWatchedHistory.progress_seconds || 0),
        total_duration_seconds: Number(lastWatchedHistory.total_duration_seconds || 0),
        completion_percentage: Number(lastWatchedHistory.completion_percentage || 0),
        last_watched_at: lastWatchedHistory.last_watched_at ? new Date(lastWatchedHistory.last_watched_at).toISOString() : null,
      } : null;

      const result = toStoryFieldsArray(story, {
        isLiked,
        isBookmarked,
        lastPlayedEpisode: lastPlayedEpisodeData,
        userUnlockedEpisodeIds,
        hasActiveMembership,
        performance: performanceObj,
        completionRate,
        avgListeningTime,
        watchHistory: watchHistorySummary,
      });

      return ApiResponse.success(res, {
        story: result,
      });
    } catch (error) {
      console.error('Get Story Error:', error);
      return ApiResponse.error(res, 'Failed to fetch story details.', 500);
    }
  }

  /**
   * POST /api/v1/stories & POST /api/v1/stories/upload
   * Create a new story (supports multipart/form-data & application/json)
   */
  static async store(req, res) {
    try {
      const { title, description, category_id, language, tags, is_premium, status } = req.body;
      const userId = req.user ? req.user.id : null;

      if (!title || title.trim() === '') {
        return ApiResponse.error(res, 'Story title is required.', 422);
      }

      let coverImagePath = req.body.cover_image || req.body.image || req.body.cover || null;
      let bannerImagePath = req.body.banner_image || req.body.banner || null;

      // Extract uploaded files from multer (supports upload.any() Array & upload.fields() Object)
      if (req.files) {
        if (Array.isArray(req.files)) {
          const coverFile = req.files.find((f) => ['cover_image', 'image', 'cover'].includes(f.fieldname));
          if (coverFile) {
            try {
              coverImagePath = await uploadToR2(coverFile, 'covers');
            } catch (uploadErr) {
              console.error('Failed to upload cover image:', uploadErr.message);
            }
          }

          const bannerFile = req.files.find((f) => ['banner_image', 'banner'].includes(f.fieldname));
          if (bannerFile) {
            try {
              bannerImagePath = await uploadToR2(bannerFile, 'banners');
            } catch (uploadErr) {
              console.error('Failed to upload banner image:', uploadErr.message);
            }
          }
        } else {
          const coverFile = (req.files.cover_image && req.files.cover_image[0]) ||
            (req.files.image && req.files.image[0]) ||
            (req.files.cover && req.files.cover[0]);
          if (coverFile) {
            try {
              coverImagePath = await uploadToR2(coverFile, 'covers');
            } catch (uploadErr) {
              console.error('Failed to upload cover image:', uploadErr.message);
            }
          }

          const bannerFile = (req.files.banner_image && req.files.banner_image[0]) ||
            (req.files.banner && req.files.banner[0]);
          if (bannerFile) {
            try {
              bannerImagePath = await uploadToR2(bannerFile, 'banners');
            } catch (uploadErr) {
              console.error('Failed to upload banner image:', uploadErr.message);
            }
          }
        }
      } else if (req.file) {
        const field = req.file.fieldname;
        if (['cover_image', 'image', 'cover'].includes(field)) {
          try {
            coverImagePath = await uploadToR2(req.file, 'covers');
          } catch (uploadErr) {
            console.error('Failed to upload cover file:', uploadErr.message);
          }
        } else if (['banner_image', 'banner'].includes(field)) {
          try {
            bannerImagePath = await uploadToR2(req.file, 'banners');
          } catch (uploadErr) {
            console.error('Failed to upload banner file:', uploadErr.message);
          }
        }
      }

      const validStatuses = ['ongoing', 'completed', 'draft', 'published'];
      const storyStatus = (status && validStatuses.includes(status.toLowerCase()))
        ? status.toLowerCase()
        : 'ongoing';

      const isPremiumBool = is_premium === true || is_premium === 'true' || is_premium === '1' || is_premium === 1;

      const parsedCatId = (category_id !== undefined && category_id !== null && category_id !== '')
        ? parseInt(category_id, 10)
        : null;
      const categoryIdVal = isNaN(parsedCatId) ? null : parsedCatId;

      const [result] = await pool.query(
        `INSERT INTO stories (user_id, title, description, category_id, cover_image_path, banner_image_path, language, tags, is_premium, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          title.trim(),
          description || null,
          categoryIdVal,
          coverImagePath,
          bannerImagePath,
          language || 'en',
          tags || null,
          isPremiumBool ? 1 : 0,
          storyStatus,
        ]
      );

      const storyId = result.insertId;
      const [storyRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.id = ? LIMIT 1`,
        [storyId]
      );

      return ApiResponse.success(
        res,
        { story: toStoryFieldsArray(storyRows[0]) },
        'Story created successfully.',
        201
      );
    } catch (error) {
      console.error('Create Story Error:', error);
      return ApiResponse.error(res, 'Failed to create story.', 500);
    }
  }

  /**
   * PUT / POST /api/v1/stories/:id
   * Edit / Update an existing story (supports multipart/form-data & application/json)
   */
  static async update(req, res) {
    try {
      const storyId = req.params.id || req.params.story;
      const [storyRows] = await pool.query('SELECT * FROM stories WHERE id = ? LIMIT 1', [storyId]);

      if (storyRows.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 444);
      }

      const { title, description, category_id, language, tags, is_premium, status } = req.body;
      const updateFields = [];
      const queryParams = [];

      if (title !== undefined && title !== null && title.trim() !== '') {
        updateFields.push('`title` = ?');
        queryParams.push(title.trim());
      }
      if (description !== undefined) {
        updateFields.push('`description` = ?');
        queryParams.push(description);
      }
      if (category_id !== undefined && category_id !== null && category_id !== '') {
        updateFields.push('`category_id` = ?');
        const parsedCat = parseInt(category_id, 10);
        queryParams.push(isNaN(parsedCat) ? null : parsedCat);
      }
      if (language !== undefined) {
        updateFields.push('`language` = ?');
        queryParams.push(language);
      }
      if (tags !== undefined) {
        updateFields.push('`tags` = ?');
        queryParams.push(tags);
      }
      if (is_premium !== undefined) {
        updateFields.push('`is_premium` = ?');
        const isPremiumBool = is_premium === true || is_premium === 'true' || is_premium === '1' || is_premium === 1;
        queryParams.push(isPremiumBool ? 1 : 0);
      }
      if (status !== undefined) {
        updateFields.push('`status` = ?');
        queryParams.push(status);
      }

      let coverImagePath = null;
      let bannerImagePath = null;

      if (req.files) {
        if (Array.isArray(req.files)) {
          const coverFile = req.files.find((f) => ['cover_image', 'image', 'cover'].includes(f.fieldname));
          if (coverFile) {
            try {
              coverImagePath = await uploadToR2(coverFile, 'covers');
            } catch (err) {
              console.error('Cover image update upload error:', err.message);
            }
          }

          const bannerFile = req.files.find((f) => ['banner_image', 'banner'].includes(f.fieldname));
          if (bannerFile) {
            try {
              bannerImagePath = await uploadToR2(bannerFile, 'banners');
            } catch (err) {
              console.error('Banner image update upload error:', err.message);
            }
          }
        } else {
          const coverFile = (req.files.cover_image && req.files.cover_image[0]) ||
            (req.files.image && req.files.image[0]) ||
            (req.files.cover && req.files.cover[0]);
          if (coverFile) {
            try {
              coverImagePath = await uploadToR2(coverFile, 'covers');
            } catch (err) {
              console.error('Cover image update upload error:', err.message);
            }
          }

          const bannerFile = (req.files.banner_image && req.files.banner_image[0]) ||
            (req.files.banner && req.files.banner[0]);
          if (bannerFile) {
            try {
              bannerImagePath = await uploadToR2(bannerFile, 'banners');
            } catch (err) {
              console.error('Banner image update upload error:', err.message);
            }
          }
        }
      } else if (req.file) {
        const field = req.file.fieldname;
        if (['cover_image', 'image', 'cover'].includes(field)) {
          try {
            coverImagePath = await uploadToR2(req.file, 'covers');
          } catch (err) {
            console.error('Cover file update upload error:', err.message);
          }
        } else if (['banner_image', 'banner'].includes(field)) {
          try {
            bannerImagePath = await uploadToR2(req.file, 'banners');
          } catch (err) {
            console.error('Banner file update upload error:', err.message);
          }
        }
      }

      if (coverImagePath) {
        updateFields.push('`cover_image_path` = ?');
        queryParams.push(coverImagePath);
      } else if (req.body.cover_image || req.body.image || req.body.cover) {
        updateFields.push('`cover_image_path` = ?');
        queryParams.push(req.body.cover_image || req.body.image || req.body.cover);
      }

      if (bannerImagePath) {
        updateFields.push('`banner_image_path` = ?');
        queryParams.push(bannerImagePath);
      } else if (req.body.banner_image || req.body.banner) {
        updateFields.push('`banner_image_path` = ?');
        queryParams.push(req.body.banner_image || req.body.banner);
      }
      if (updateFields.length > 0) {
        queryParams.push(storyId);
        await pool.query(
          `UPDATE stories SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`,
          queryParams
        );
      }

      const [updatedRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.id = ? LIMIT 1`,
        [storyId]
      );

      return ApiResponse.success(
        res,
        { story: toStoryFieldsArray(updatedRows[0]) },
        'Story updated successfully.'
      );
    } catch (error) {
      console.error('Update Story Error:', error);
      return ApiResponse.error(res, 'Failed to update story.', 500);
    }
  }

  /**
   * PUT / POST /api/v1/stories/:id
   * Edit / Update an existing story (supports multipart/form-data & application/json)
   */
  static async update(req, res) {
    try {
      const storyId = req.params.id || req.params.story;
      const [storyRows] = await pool.query('SELECT * FROM stories WHERE id = ? LIMIT 1', [storyId]);

      if (storyRows.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 444);
      }

      const { title, description, category_id, language, tags, is_premium, status } = req.body;
      const updateFields = [];
      const queryParams = [];

      if (title !== undefined && title !== null && title.trim() !== '') {
        updateFields.push('`title` = ?');
        queryParams.push(title.trim());
      }
      if (description !== undefined) {
        updateFields.push('`description` = ?');
        queryParams.push(description);
      }
      if (category_id !== undefined && category_id !== null && category_id !== '') {
        updateFields.push('`category_id` = ?');
        const parsedCat = parseInt(category_id, 10);
        queryParams.push(isNaN(parsedCat) ? null : parsedCat);
      }
      if (language !== undefined) {
        updateFields.push('`language` = ?');
        queryParams.push(language);
      }
      if (tags !== undefined) {
        updateFields.push('`tags` = ?');
        queryParams.push(tags);
      }
      if (is_premium !== undefined) {
        updateFields.push('`is_premium` = ?');
        const isPremiumBool = is_premium === true || is_premium === 'true' || is_premium === '1' || is_premium === 1;
        queryParams.push(isPremiumBool ? 1 : 0);
      }
      if (status !== undefined) {
        updateFields.push('`status` = ?');
        queryParams.push(status);
      }

      let coverImagePath = null;
      let bannerImagePath = null;

      if (req.files) {
        if (Array.isArray(req.files)) {
          const coverFile = req.files.find((f) => ['cover_image', 'image', 'cover'].includes(f.fieldname));
          if (coverFile) {
            try {
              coverImagePath = await uploadToR2(coverFile, 'covers');
            } catch (err) {
              console.error('Cover image update upload error:', err.message);
            }
          }

          const bannerFile = req.files.find((f) => ['banner_image', 'banner'].includes(f.fieldname));
          if (bannerFile) {
            try {
              bannerImagePath = await uploadToR2(bannerFile, 'banners');
            } catch (err) {
              console.error('Banner image update upload error:', err.message);
            }
          }
        } else {
          const coverFile = (req.files.cover_image && req.files.cover_image[0]) ||
            (req.files.image && req.files.image[0]) ||
            (req.files.cover && req.files.cover[0]);
          if (coverFile) {
            try {
              coverImagePath = await uploadToR2(coverFile, 'covers');
            } catch (err) {
              console.error('Cover image update upload error:', err.message);
            }
          }

          const bannerFile = (req.files.banner_image && req.files.banner_image[0]) ||
            (req.files.banner && req.files.banner[0]);
          if (bannerFile) {
            try {
              bannerImagePath = await uploadToR2(bannerFile, 'banners');
            } catch (err) {
              console.error('Banner image update upload error:', err.message);
            }
          }
        }
      } else if (req.file) {
        const field = req.file.fieldname;
        if (['cover_image', 'image', 'cover'].includes(field)) {
          try {
            coverImagePath = await uploadToR2(req.file, 'covers');
          } catch (err) {
            console.error('Cover file update upload error:', err.message);
          }
        } else if (['banner_image', 'banner'].includes(field)) {
          try {
            bannerImagePath = await uploadToR2(req.file, 'banners');
          } catch (err) {
            console.error('Banner file update upload error:', err.message);
          }
        }
      }

      if (coverImagePath) {
        updateFields.push('`cover_image_path` = ?');
        queryParams.push(coverImagePath);
      } else if (req.body.cover_image || req.body.image || req.body.cover) {
        updateFields.push('`cover_image_path` = ?');
        queryParams.push(req.body.cover_image || req.body.image || req.body.cover);
      }

      if (bannerImagePath) {
        updateFields.push('`banner_image_path` = ?');
        queryParams.push(bannerImagePath);
      } else if (req.body.banner_image || req.body.banner) {
        updateFields.push('`banner_image_path` = ?');
        queryParams.push(req.body.banner_image || req.body.banner);
      }

      if (updateFields.length > 0) {
        queryParams.push(storyId);
        await pool.query(
          `UPDATE stories SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`,
          queryParams
        );
      }

      const [updatedRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.id = ? LIMIT 1`,
        [storyId]
      );

      return ApiResponse.success(
        res,
        { story: toStoryFieldsArray(updatedRows[0]) },
        'Story updated successfully.'
      );
    } catch (error) {
      console.error('Update Story Error:', error);
      return ApiResponse.error(res, 'Failed to update story.', 500);
    }
  }

  /**
   * POST /api/v1/stories/:id/like
   * Toggle story like status
   */
  static async toggleLike(req, res) {
    try {
      const storyId = req.params.id || req.params.story;
      const userId = req.user.id;

      const [story] = await pool.query('SELECT id FROM stories WHERE id = ? LIMIT 1', [storyId]);
      if (story.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 404);
      }

      const [existing] = await pool.query(
        'SELECT id FROM story_likes WHERE user_id = ? AND story_id = ? LIMIT 1',
        [userId, storyId]
      );

      let isLiked = false;
      if (existing.length > 0) {
        await pool.query('DELETE FROM story_likes WHERE user_id = ? AND story_id = ?', [userId, storyId]);
        isLiked = false;
      } else {
        await pool.query('INSERT INTO story_likes (user_id, story_id) VALUES (?, ?)', [userId, storyId]);
        isLiked = true;
      }

      const [countRow] = await pool.query(
        'SELECT COUNT(*) as count FROM story_likes WHERE story_id = ?',
        [storyId]
      );
      const likesCount = countRow[0].count;

      return ApiResponse.success(
        res,
        { is_liked: isLiked, likes_count: likesCount },
        isLiked ? 'Story liked.' : 'Story unliked.'
      );
    } catch (error) {
      console.error('Toggle Story Like Error:', error);
      return ApiResponse.error(res, 'Failed to update story like status.', 500);
    }
  }

  /**
   * POST /api/v1/stories/:id/share
   * Increment story shares count
   */
  static async share(req, res) {
    try {
      const storyId = req.params.id || req.params.story;
      await pool.query('UPDATE stories SET shares_count = shares_count + 1 WHERE id = ?', [storyId]);
      const [rows] = await pool.query('SELECT shares_count FROM stories WHERE id = ? LIMIT 1', [storyId]);
      const sharesCount = rows.length > 0 ? rows[0].shares_count : 0;

      return ApiResponse.success(res, { shares_count: sharesCount }, 'Story share count updated.');
    } catch (error) {
      console.error('Share Story Error:', error);
      return ApiResponse.error(res, 'Failed to share story.', 500);
    }
  }

  /**
   * GET /api/v1/user/liked-stories
   * List stories liked by authenticated user with pagination limit and total count
   */
  static async likedStories(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const offset = (pageNum - 1) * limitNum;

      const [[{ count }]] = await pool.query(
        'SELECT COUNT(*) as count FROM story_likes WHERE user_id = ?',
        [userId]
      );

      const [stories] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl2 WHERE sl2.story_id = s.id) as likes_count
         FROM story_likes sl
         JOIN stories s ON sl.story_id = s.id
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE sl.user_id = ?
         ORDER BY sl.created_at DESC
         LIMIT ? OFFSET ?`,
        [userId, limitNum, offset]
      );

      let userBookmarkedIds = new Set();
      if (stories.length > 0) {
        const storyIds = stories.map((s) => s.id);
        const [bookmarks] = await pool.query(
          'SELECT story_id FROM bookmarks WHERE user_id = ? AND story_id IN (?)',
          [userId, storyIds]
        );
        bookmarks.forEach((b) => userBookmarkedIds.add(b.story_id));
      }

      const result = stories.map((s) =>
        toStoryFieldsArray(s, {
          isLiked: true,
          isBookmarked: userBookmarkedIds.has(s.id),
        })
      );

      return ApiResponse.success(res, {
        stories: result,
        total: count,
        total_number: count,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(count / limitNum),
        pagination: {
          total: count,
          page: pageNum,
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('List Liked Stories Error:', error);
      return ApiResponse.error(res, 'Failed to fetch liked stories.', 500);
    }
  }
}

module.exports = StoryController;
