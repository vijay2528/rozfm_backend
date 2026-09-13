const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');
const { toStoryFieldsArray, toEpisodeFieldsArray } = require('../../utils/storyPresenter');
const { uploadToR2 } = require('../../services/r2StorageService');

class ContentController {
  /**
   * GET /api/v1/admin/stories
   * List all stories with filter by status, category, language, search
   */
  static async listStories(req, res) {
    try {
      const { status, category_id, language, search, page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

      let whereClauses = ['1=1'];
      let queryParams = [];

      if (status) {
        whereClauses.push('s.status = ?');
        queryParams.push(status);
      }

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

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

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
         ORDER BY s.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      const result = stories.map((s) => toStoryFieldsArray(s));

      return ApiResponse.success(res, {
        stories: result,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('Admin List Stories Error:', error);
      return ApiResponse.error(res, 'Failed to fetch admin stories list.', 500);
    }
  }

  /**
   * GET /api/v1/admin/stories/:id
   * Fetch single story details for admin view/edit form
   */
  static async showStory(req, res) {
    try {
      const storyId = req.params.id;

      const [stories] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.id = ? LIMIT 1`,
        [storyId]
      );

      if (stories.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 444);
      }

      const result = toStoryFieldsArray(stories[0]);

      return ApiResponse.success(res, { story: result });
    } catch (error) {
      console.error('Admin Show Story Error:', error);
      return ApiResponse.error(res, 'Failed to fetch story details.', 500);
    }
  }

  /**
   * POST /api/v1/admin/stories
   * Create a new story (supports multipart/form-data & application/json)
   */
  static async storeStory(req, res) {
    try {
      const {
        title,
        description,
        synopsis,
        category_id,
        category,
        language,
        tags,
        is_premium,
        status,
        story_status,
        release,
        release_status,
        user_id,
        creator_id,
        creator,
        assigned_creator,
        author_id,
      } = req.body;

      if (!title || !title.trim()) {
        return ApiResponse.error(res, 'Story title is required.', 422);
      }

      const storyDescription = description || synopsis || null;
      const storyLanguage = language || 'Hindi';

      // 1. Resolve Category ID
      let finalCategoryId = null;
      const rawCategory = category_id || category;
      if (rawCategory !== undefined && rawCategory !== null && rawCategory !== '') {
        const parsedCat = parseInt(rawCategory, 10);
        if (!isNaN(parsedCat)) {
          finalCategoryId = parsedCat;
        } else {
          const [catRows] = await pool.query(
            'SELECT id FROM categories WHERE LOWER(category_name) = ? LIMIT 1',
            [String(rawCategory).trim().toLowerCase()]
          );
          if (catRows.length > 0) {
            finalCategoryId = catRows[0].id;
          }
        }
      }

      // 2. Resolve Creator / User ID
      let finalUserId = req.user ? req.user.id : null;
      const rawUser = user_id || creator_id || creator || assigned_creator || author_id;
      if (rawUser !== undefined && rawUser !== null && rawUser !== '') {
        const parsedUser = parseInt(rawUser, 10);
        if (!isNaN(parsedUser)) {
          finalUserId = parsedUser;
        } else {
          const [userRows] = await pool.query(
            'SELECT id FROM users WHERE LOWER(name) = ? LIMIT 1',
            [String(rawUser).trim().toLowerCase()]
          );
          if (userRows.length > 0) {
            finalUserId = userRows[0].id;
          }
        }
      }

      // 3. Resolve Release Status & Story Status
      let finalReleaseStatus = (release !== undefined && release !== null) ? String(release) : ((release_status !== undefined && release_status !== null) ? String(release_status) : null);
      let finalStatus = (status !== undefined && status !== null) ? String(status) : ((story_status !== undefined && story_status !== null) ? String(story_status) : null);
      const rawStatus = (status || story_status || release || '').toString().toLowerCase();

      if (rawStatus) {
        if (rawStatus.includes('draft') || rawStatus.includes('save as draft')) {
          finalStatus = finalStatus || 'draft';
          finalReleaseStatus = finalReleaseStatus || 'save_as_draft';
        } else if (rawStatus.includes('schedule')) {
          finalStatus = finalStatus || 'scheduled';
          finalReleaseStatus = finalReleaseStatus || 'schedule_release';
        } else if (rawStatus.includes('completed')) {
          finalStatus = 'completed';
        } else if (rawStatus.includes('ongoing')) {
          finalStatus = 'ongoing';
        } else if (rawStatus.includes('publish')) {
          if (status && ['ongoing', 'completed'].includes(status.toLowerCase())) {
            finalStatus = status.toLowerCase();
          } else if (!finalStatus) {
            finalStatus = 'published';
          }
          if (!finalReleaseStatus) finalReleaseStatus = 'publish_immediately';
        } else if (['ongoing', 'completed', 'draft', 'published', 'scheduled'].includes(rawStatus)) {
          finalStatus = rawStatus;
        }
      }

      // 4. Handle Cover & Banner Image files uploaded via Multer/R2
      let coverImagePath = req.body.cover_image_path || req.body.cover_image || req.body.image || null;
      let bannerImagePath = req.body.banner_image_path || req.body.banner_image || req.body.banner || null;

      if (req.files) {
        let filesArr = [];
        if (Array.isArray(req.files)) {
          filesArr = req.files;
        } else if (typeof req.files === 'object') {
          Object.values(req.files).forEach((val) => {
            if (Array.isArray(val)) filesArr.push(...val);
            else if (val) filesArr.push(val);
          });
        }

        const coverFile = filesArr.find((f) => ['cover_image', 'image', 'cover', 'cover_image_path'].includes(f.fieldname));
        if (coverFile) {
          try {
            coverImagePath = await uploadToR2(coverFile, 'covers');
          } catch (uploadErr) {
            console.error('Failed to upload cover image:', uploadErr.message);
          }
        }

        const bannerFile = filesArr.find((f) => ['banner_image', 'banner', 'banner_image_path'].includes(f.fieldname));
        if (bannerFile) {
          try {
            bannerImagePath = await uploadToR2(bannerFile, 'banners');
          } catch (uploadErr) {
            console.error('Failed to upload banner image:', uploadErr.message);
          }
        }
      } else if (req.file) {
        const field = req.file.fieldname;
        if (['cover_image', 'image', 'cover', 'cover_image_path'].includes(field)) {
          try {
            coverImagePath = await uploadToR2(req.file, 'covers');
          } catch (uploadErr) {
            console.error('Failed to upload cover image:', uploadErr.message);
          }
        } else if (['banner_image', 'banner', 'banner_image_path'].includes(field)) {
          try {
            bannerImagePath = await uploadToR2(req.file, 'banners');
          } catch (uploadErr) {
            console.error('Failed to upload banner image:', uploadErr.message);
          }
        }
      }

      const isPremiumBool = is_premium === true || is_premium === 'true' || is_premium === '1' || is_premium === 1;

      // 5. Insert Story
      const [result] = await pool.query(
        `INSERT INTO stories (user_id, title, description, category_id, cover_image_path, banner_image_path, language, tags, is_premium, status, release_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          finalUserId,
          title.trim(),
          storyDescription,
          finalCategoryId,
          coverImagePath,
          bannerImagePath,
          storyLanguage,
          tags || null,
          isPremiumBool ? 1 : 0,
          finalStatus,
          finalReleaseStatus,
        ]
      );

      const newStoryId = result.insertId;

      // 6. Return response
      const [storyRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.id = ? LIMIT 1`,
        [newStoryId]
      );

      return ApiResponse.success(
        res,
        { story: toStoryFieldsArray(storyRows[0]) },
        'Story created successfully.',
        201
      );
    } catch (error) {
      console.error('Admin Create Story Error:', error);
      return ApiResponse.error(res, 'Failed to create story.', 500);
    }
  }

  /**
   * PUT / POST /api/v1/admin/stories/:id
   * Update an existing story (supports multipart/form-data & application/json)
   */
  static async updateStory(req, res) {
    try {
      const storyId = req.params.id;

      const [existingRows] = await pool.query('SELECT * FROM stories WHERE id = ? LIMIT 1', [storyId]);
      if (existingRows.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 444);
      }

      const {
        title,
        description,
        synopsis,
        category_id,
        category,
        language,
        tags,
        is_premium,
        status,
        story_status,
        release,
        user_id,
        creator_id,
        creator,
        assigned_creator,
        author_id,
      } = req.body;

      const updateFields = [];
      const queryParams = [];

      if (title !== undefined && title !== null && title.trim() !== '') {
        updateFields.push('`title` = ?');
        queryParams.push(title.trim());
      }

      const storyDescription = description !== undefined ? description : (synopsis !== undefined ? synopsis : undefined);
      if (storyDescription !== undefined) {
        updateFields.push('`description` = ?');
        queryParams.push(storyDescription);
      }

      const rawCategory = category_id !== undefined ? category_id : category;
      if (rawCategory !== undefined && rawCategory !== null && rawCategory !== '') {
        const parsedCat = parseInt(rawCategory, 10);
        if (!isNaN(parsedCat)) {
          updateFields.push('`category_id` = ?');
          queryParams.push(parsedCat);
        } else {
          const [catRows] = await pool.query('SELECT id FROM categories WHERE LOWER(category_name) = ? LIMIT 1', [
            String(rawCategory).trim().toLowerCase(),
          ]);
          if (catRows.length > 0) {
            updateFields.push('`category_id` = ?');
            queryParams.push(catRows[0].id);
          }
        }
      }

      if (language !== undefined) {
        updateFields.push('`language` = ?');
        queryParams.push(language);
      }

      if (tags !== undefined) {
        updateFields.push('`tags` = ?');
        queryParams.push(tags);
      }

      const rawUser = user_id || creator_id || creator || assigned_creator || author_id;
      if (rawUser !== undefined && rawUser !== null && rawUser !== '') {
        const parsedUser = parseInt(rawUser, 10);
        if (!isNaN(parsedUser)) {
          updateFields.push('`user_id` = ?');
          queryParams.push(parsedUser);
        } else {
          const [userRows] = await pool.query('SELECT id FROM users WHERE LOWER(name) = ? LIMIT 1', [
            String(rawUser).trim().toLowerCase(),
          ]);
          if (userRows.length > 0) {
            updateFields.push('`user_id` = ?');
            queryParams.push(userRows[0].id);
          }
        }
      }

      if (is_premium !== undefined) {
        updateFields.push('`is_premium` = ?');
        const isPremiumBool = is_premium === true || is_premium === 'true' || is_premium === '1' || is_premium === 1;
        queryParams.push(isPremiumBool ? 1 : 0);
      }

      const rawRelease = release || release_status;
      if (rawRelease !== undefined && rawRelease !== null && rawRelease !== '') {
        updateFields.push('`release_status` = ?');
        queryParams.push(String(rawRelease));
      }

      const rawStatus = (status || story_status || '').toString().toLowerCase();
      if (rawStatus) {
        let finalStatus = null;
        if (rawStatus.includes('draft') || rawStatus.includes('save as draft')) {
          finalStatus = 'draft';
        } else if (rawStatus.includes('schedule')) {
          finalStatus = 'scheduled';
        } else if (rawStatus.includes('completed')) {
          finalStatus = 'completed';
        } else if (rawStatus.includes('ongoing')) {
          finalStatus = 'ongoing';
        } else if (rawStatus.includes('publish')) {
          if (status && ['ongoing', 'completed'].includes(status.toLowerCase())) {
            finalStatus = status.toLowerCase();
          } else {
            finalStatus = 'published';
          }
        } else if (['ongoing', 'completed', 'draft', 'published', 'scheduled'].includes(rawStatus)) {
          finalStatus = rawStatus;
        }

        if (finalStatus) {
          updateFields.push('`status` = ?');
          queryParams.push(finalStatus);
        }
      }

      let coverImagePath = null;
      let bannerImagePath = null;

      if (req.files) {
        let filesArr = [];
        if (Array.isArray(req.files)) {
          filesArr = req.files;
        } else if (typeof req.files === 'object') {
          Object.values(req.files).forEach((val) => {
            if (Array.isArray(val)) filesArr.push(...val);
            else if (val) filesArr.push(val);
          });
        }

        const coverFile = filesArr.find((f) => ['cover_image', 'image', 'cover', 'cover_image_path'].includes(f.fieldname));
        if (coverFile) {
          try {
            coverImagePath = await uploadToR2(coverFile, 'covers');
          } catch (uploadErr) {
            console.error('Failed to upload cover image:', uploadErr.message);
          }
        }

        const bannerFile = filesArr.find((f) => ['banner_image', 'banner', 'banner_image_path'].includes(f.fieldname));
        if (bannerFile) {
          try {
            bannerImagePath = await uploadToR2(bannerFile, 'banners');
          } catch (uploadErr) {
            console.error('Failed to upload banner image:', uploadErr.message);
          }
        }
      } else if (req.file) {
        const field = req.file.fieldname;
        if (['cover_image', 'image', 'cover', 'cover_image_path'].includes(field)) {
          try {
            coverImagePath = await uploadToR2(req.file, 'covers');
          } catch (uploadErr) {
            console.error('Failed to upload cover image:', uploadErr.message);
          }
        } else if (['banner_image', 'banner', 'banner_image_path'].includes(field)) {
          try {
            bannerImagePath = await uploadToR2(req.file, 'banners');
          } catch (uploadErr) {
            console.error('Failed to upload banner image:', uploadErr.message);
          }
        }
      }

      if (coverImagePath) {
        updateFields.push('`cover_image_path` = ?');
        queryParams.push(coverImagePath);
      }
      if (bannerImagePath) {
        updateFields.push('`banner_image_path` = ?');
        queryParams.push(bannerImagePath);
      }

      if (updateFields.length > 0) {
        updateFields.push('`updated_at` = NOW()');
        const updateSql = `UPDATE stories SET ${updateFields.join(', ')} WHERE id = ?`;
        queryParams.push(storyId);
        await pool.query(updateSql, queryParams);
      }

      const [updatedRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
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
      console.error('Admin Update Story Error:', error);
      return ApiResponse.error(res, 'Failed to update story.', 500);
    }
  }

  /**
   * PUT /api/v1/admin/stories/:id/status
   * Update story status (ongoing, completed, draft, published)
   */
  static async updateStoryStatus(req, res) {
    try {
      const storyId = req.params.id;
      const { status } = req.body;

      const validStatuses = ['ongoing', 'completed', 'draft', 'published'];
      if (!status || !validStatuses.includes(status.toLowerCase())) {
        return ApiResponse.error(res, 'Valid status is required (ongoing, completed, draft, published).', 422);
      }

      const [storyRows] = await pool.query('SELECT * FROM stories WHERE id = ? LIMIT 1', [storyId]);
      if (storyRows.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 444);
      }

      await pool.query('UPDATE stories SET status = ?, updated_at = NOW() WHERE id = ?', [status.toLowerCase(), storyId]);

      return ApiResponse.success(res, { story_id: Number(storyId), status: status.toLowerCase() }, 'Story status updated successfully.');
    } catch (error) {
      console.error('Admin Update Story Status Error:', error);
      return ApiResponse.error(res, 'Failed to update story status.', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/stories/:id
   * Delete a story and its associated episodes & likes
   */
  static async deleteStory(req, res) {
    try {
      const storyId = req.params.id;

      const [storyRows] = await pool.query('SELECT * FROM stories WHERE id = ? LIMIT 1', [storyId]);
      if (storyRows.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 444);
      }

      await pool.query('DELETE FROM stories WHERE id = ?', [storyId]);

      return ApiResponse.success(res, { story_id: Number(storyId) }, 'Story deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Story Error:', error);
      return ApiResponse.error(res, 'Failed to delete story.', 500);
    }
  }

  /**
   * GET /api/v1/admin/episodes
   * List all episodes across all stories with filters
   */
  static async listEpisodes(req, res) {
    try {
      const { story_id, search, is_premium, filter, status, is_locked, is_unlocked, is_scheduled, is_downloadable, page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

      let whereClauses = ['1=1'];
      let queryParams = [];

      if (story_id) {
        whereClauses.push('e.story_id = ?');
        queryParams.push(story_id);
      }

      if (search) {
        whereClauses.push('(e.title LIKE ? OR e.description LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`);
      }

      if (is_premium !== undefined && is_premium !== '') {
        whereClauses.push('e.is_premium = ?');
        queryParams.push(is_premium === '1' || is_premium === 'true' ? 1 : 0);
      }

      // Collect active filter flags
      let activeFilters = new Set();
      const rawFilter = filter || status;
      if (rawFilter) {
        const filterItems = Array.isArray(rawFilter) ? rawFilter : String(rawFilter).split(',');
        filterItems.forEach((item) => {
          const trimmed = String(item).trim().toLowerCase();
          if (['locked', 'unlocked', 'scheduled', 'downloadable'].includes(trimmed)) {
            activeFilters.add(trimmed);
          }
        });
      }
      if (is_locked === 'true' || is_locked === '1' || is_locked === 1 || is_locked === true) activeFilters.add('locked');
      if (is_unlocked === 'true' || is_unlocked === '1' || is_unlocked === 1 || is_unlocked === true) activeFilters.add('unlocked');
      if (is_scheduled === 'true' || is_scheduled === '1' || is_scheduled === 1 || is_scheduled === true) activeFilters.add('scheduled');
      if (is_downloadable === 'true' || is_downloadable === '1' || is_downloadable === 1 || is_downloadable === true) activeFilters.add('downloadable');

      if (activeFilters.has('locked')) {
        whereClauses.push('e.is_premium = 1');
      }

      if (activeFilters.has('unlocked')) {
        whereClauses.push('e.is_premium = 0');
      }

      if (activeFilters.has('scheduled')) {
        whereClauses.push("(e.publish_as = 'schedule_for_later' OR (e.scheduled_at IS NOT NULL AND e.scheduled_at > NOW()))");
      }

      if (activeFilters.has('downloadable')) {
        whereClauses.push("(e.audio_path IS NOT NULL AND e.audio_path != '' AND (e.is_downloadable IS NULL OR e.is_downloadable = 1))");
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ count }]] = await pool.query(`SELECT COUNT(*) as count FROM episodes e ${whereSql}`, queryParams);

      const [episodes] = await pool.query(
        `SELECT e.*, s.title as story_title
         FROM episodes e
         LEFT JOIN stories s ON e.story_id = s.id
         ${whereSql}
         ORDER BY e.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      const result = episodes.map((ep) => toEpisodeFieldsArray(ep, ep.story_title, true));

      return ApiResponse.success(res, {
        episodes: result,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('Admin List Episodes Error:', error);
      return ApiResponse.error(res, 'Failed to fetch admin episodes list.', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/episodes/:id
   * Delete an episode and update parent story episodes count
   */
  static async deleteEpisode(req, res) {
    try {
      const episodeId = req.params.id;

      const [epRows] = await pool.query('SELECT * FROM episodes WHERE id = ? LIMIT 1', [episodeId]);
      if (epRows.length === 0) {
        return ApiResponse.error(res, 'Episode not found.', 444);
      }

      const storyId = epRows[0].story_id;

      await pool.query('DELETE FROM episodes WHERE id = ?', [episodeId]);

      // Update parent story episode count
      const [[{ cnt }]] = await pool.query('SELECT COUNT(*) as cnt FROM episodes WHERE story_id = ?', [storyId]);
      await pool.query('UPDATE stories SET episodes_count = ? WHERE id = ?', [cnt, storyId]);

      return ApiResponse.success(res, { episode_id: Number(episodeId), story_id: Number(storyId) }, 'Episode deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Episode Error:', error);
      return ApiResponse.error(res, 'Failed to delete episode.', 500);
    }
  }
}

module.exports = ContentController;
