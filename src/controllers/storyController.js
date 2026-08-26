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
      const { category_id, search, language, sort, page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

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

      return ApiResponse.success(res, { stories: result });
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

      // Increment views count
      await pool.query('UPDATE stories SET total_views = total_views + 1 WHERE id = ?', [storyId]);

      // Fetch episodes
      const [episodes] = await pool.query(
        'SELECT * FROM episodes WHERE story_id = ? ORDER BY position ASC',
        [storyId]
      );

      let isLiked = false;
      let isBookmarked = false;
      let userUnlockedEpisodeIds = new Set();

      if (userId) {
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
        unlocks.forEach((u) => userUnlockedEpisodeIds.add(u.episode_id));
      }

      const result = toStoryFieldsArray(story, {
        isLiked,
        isBookmarked,
        episodes,
        userUnlockedEpisodeIds,
      });

      return ApiResponse.success(res, { story: result });
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
      const { title, description, category_id, language, is_premium, status } = req.body;
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
        `INSERT INTO stories (user_id, title, description, category_id, cover_image_path, banner_image_path, language, is_premium, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          title.trim(),
          description || null,
          categoryIdVal,
          coverImagePath,
          bannerImagePath,
          language || 'en',
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

      const { title, description, category_id, language, is_premium, status } = req.body;
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
}

module.exports = StoryController;
