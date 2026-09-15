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
      const { status, release_status, release, is_draft, is_scheduled, category_id, language, search, page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

      let whereClauses = ['1=1'];
      let queryParams = [];

      const filterStatus = status || release_status || release;
      const isSchedReq = is_scheduled === '1' || is_scheduled === 'true';

      if (isSchedReq) {
        whereClauses.push("(LOWER(s.status) = 'scheduled' OR LOWER(s.release_status) = 'scheduled' OR LOWER(s.status) LIKE '%schedule%' OR LOWER(s.release_status) LIKE '%schedule%')");
      } else if (filterStatus) {
        const lowerVal = String(filterStatus).trim().toLowerCase();
        if (lowerVal === 'draft' || is_draft === '1' || is_draft === 'true') {
          whereClauses.push("(LOWER(s.status) = 'draft' OR LOWER(s.release_status) = 'draft' OR LOWER(s.release_status) LIKE '%draft%')");
        } else if (lowerVal.includes('schedule')) {
          whereClauses.push("(LOWER(s.status) = 'scheduled' OR LOWER(s.release_status) = 'scheduled' OR LOWER(s.status) LIKE '%schedule%' OR LOWER(s.release_status) LIKE '%schedule%')");
        } else {
          whereClauses.push('(LOWER(s.status) = ? OR LOWER(s.release_status) = ?)');
          queryParams.push(lowerVal, lowerVal);
        }
      } else if (is_draft === '1' || is_draft === 'true') {
        whereClauses.push("(LOWER(s.status) = 'draft' OR LOWER(s.release_status) = 'draft' OR LOWER(s.release_status) LIKE '%draft%')");
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
                (SELECT COUNT(*) FROM episodes e WHERE e.story_id = s.id) as real_episodes_count,
                (SELECT COALESCE(SUM(plays_count), 0) FROM episodes e WHERE e.story_id = s.id) as real_plays_count,
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

      const rawPublishDate = req.body.publish_date !== undefined ? req.body.publish_date : (req.body.publishDate !== undefined ? req.body.publishDate : (req.body.release_date !== undefined ? req.body.release_date : req.body.releaseDate));
      let finalPublishDate = null;
      if (rawPublishDate !== undefined && rawPublishDate !== null && String(rawPublishDate).trim() !== '' && String(rawPublishDate).toLowerCase() !== 'null' && String(rawPublishDate).toLowerCase() !== 'undefined') {
        const str = String(rawPublishDate).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
          finalPublishDate = str;
        } else {
          const d = new Date(str);
          if (!isNaN(d.getTime())) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            finalPublishDate = `${y}-${m}-${day}`;
          } else {
            finalPublishDate = str;
          }
        }
      }

      // 5. Insert Story
      const [result] = await pool.query(
        `INSERT INTO stories (user_id, title, description, category_id, cover_image_path, banner_image_path, language, tags, is_premium, status, release_status, publish_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          finalPublishDate,
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

      const rawPublishDate = req.body.publish_date !== undefined ? req.body.publish_date : (req.body.publishDate !== undefined ? req.body.publishDate : (req.body.release_date !== undefined ? req.body.release_date : req.body.releaseDate));
      if (rawPublishDate !== undefined) {
        updateFields.push('`publish_date` = ?');
        if (rawPublishDate !== null && String(rawPublishDate).trim() !== '' && String(rawPublishDate).toLowerCase() !== 'null' && String(rawPublishDate).toLowerCase() !== 'undefined') {
          const str = String(rawPublishDate).trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
            queryParams.push(str);
          } else {
            const d = new Date(str);
            if (!isNaN(d.getTime())) {
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              queryParams.push(`${y}-${m}-${day}`);
            } else {
              queryParams.push(str);
            }
          }
        } else {
          queryParams.push(null);
        }
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
   * GET /api/v1/admin/episodes/:id
   * Get single episode details by ID
   */
  static async showEpisode(req, res) {
    try {
      const episodeId = req.params.id;

      const [epRows] = await pool.query(
        'SELECT e.*, s.title as story_title FROM episodes e LEFT JOIN stories s ON e.story_id = s.id WHERE e.id = ? LIMIT 1',
        [episodeId]
      );

      if (epRows.length === 0) {
        return ApiResponse.error(res, 'Episode not found.', 444);
      }

      return ApiResponse.success(
        res,
        { episode: toEpisodeFieldsArray(epRows[0], epRows[0].story_title, true) },
        'Episode details fetched successfully.'
      );
    } catch (error) {
      console.error('Admin Show Episode Error:', error);
      return ApiResponse.error(res, 'Failed to fetch episode details.', 500);
    }
  }

  /**
   * POST /api/v1/admin/episodes
   * Create a new episode (Title, Story list selection, Audio file, Duration, is_premium, Published date with time)
   */
  static async storeEpisode(req, res) {
    try {
      const {
        title,
        story_id,
        storyId,
        story,
        description,
        duration,
        duration_seconds,
        duration_minutes,
        is_premium,
        is_downloadable,
        coins,
        published_at,
        publish_date,
        published_date,
        publishedDate,
        scheduled_at,
        schedule_date_time,
        audio_file,
        audio_path,
        audio_title,
      } = req.body || {};

      const targetStoryId = story_id || storyId || story;
      if (!targetStoryId || !title || !String(title).trim()) {
        return ApiResponse.error(res, 'Story ID and episode title are required.', 422);
      }

      const [storyRows] = await pool.query('SELECT id, title FROM stories WHERE id = ? LIMIT 1', [targetStoryId]);
      if (storyRows.length === 0) {
        return ApiResponse.error(res, 'Selected story not found.', 444);
      }

      let audioFilePath = typeof audio_file === 'string' ? audio_file : (audio_path || null);
      const uploadedFile = req.file || (req.files && req.files.length > 0 ? (req.files.find(f => f.fieldname === 'audio_file' || f.fieldname === 'audio') || req.files[0]) : null);
      if (uploadedFile) {
        const { uploadToR2 } = require('../../services/r2StorageService');
        audioFilePath = await uploadToR2(uploadedFile, 'episodes');
      }

      let durSecs = 0;
      if (duration_seconds !== undefined && duration_seconds !== null && duration_seconds !== '') {
        durSecs = parseInt(duration_seconds, 10) || 0;
      } else if (duration !== undefined && duration !== null && duration !== '') {
        durSecs = parseInt(duration, 10) || 0;
      } else if (duration_minutes !== undefined && duration_minutes !== null && duration_minutes !== '') {
        durSecs = Math.round(parseFloat(duration_minutes) * 60) || 0;
      }
      const durMins = durSecs ? parseFloat((durSecs / 60).toFixed(2)) : null;

      const rawDate = published_at || publish_date || published_date || publishedDate || scheduled_at || schedule_date_time || null;
      let publishedAt = new Date();
      if (rawDate && String(rawDate).trim() !== '' && String(rawDate).toLowerCase() !== 'null') {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          publishedAt = d;
        }
      }

      const createdById = req.user ? req.user.id : null;
      const isPremiumVal = (is_premium === '1' || is_premium === 1 || is_premium === 'true' || is_premium === true) ? 1 : 0;
      const isDownloadableVal = (is_downloadable === undefined || is_downloadable === null || is_downloadable === '1' || is_downloadable === 1 || is_downloadable === 'true' || is_downloadable === true) ? 1 : 0;
      const coinCost = coins !== undefined && coins !== null && coins !== '' ? parseInt(coins, 10) : 25;
      const finalAudioTitle = audio_title && String(audio_title).trim() !== '' ? String(audio_title).trim() : String(title).trim();

      // Episode number calculation: 0 episodes -> 1, 2 episodes -> 3
      const [[{ ep_count }]] = await pool.query('SELECT COUNT(*) as ep_count FROM episodes WHERE story_id = ?', [targetStoryId]);
      const nextEpisodeNumber = (ep_count || 0) + 1;

      const [result] = await pool.query(
        `INSERT INTO episodes (
          story_id, created_by, title, episode_number, position, description, publish_as, scheduled_at,
          audio_title, duration_seconds, duration_minutes, is_premium, is_downloadable,
          coins, audio_path, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          targetStoryId,
          createdById,
          String(title).trim(),
          nextEpisodeNumber,
          nextEpisodeNumber,
          description || null,
          'publish_now',
          rawDate ? publishedAt : null,
          finalAudioTitle,
          durSecs,
          durMins,
          isPremiumVal,
          isDownloadableVal,
          coinCost,
          audioFilePath,
          publishedAt,
        ]
      );

      const episodeId = result.insertId;
      const [[{ cnt }]] = await pool.query('SELECT COUNT(*) as cnt FROM episodes WHERE story_id = ?', [targetStoryId]);
      await pool.query('UPDATE stories SET episodes_count = ? WHERE id = ?', [cnt, targetStoryId]);

      const [newEp] = await pool.query(
        'SELECT e.*, s.title as story_title FROM episodes e JOIN stories s ON e.story_id = s.id WHERE e.id = ? LIMIT 1',
        [episodeId]
      );

      return ApiResponse.success(
        res,
        { episode: toEpisodeFieldsArray(newEp[0], storyRows[0].title, true) },
        'Episode created successfully.',
        201
      );
    } catch (error) {
      console.error('Admin Create Episode Error:', error);
      return ApiResponse.error(res, 'Failed to create episode.', 500);
    }
  }

  /**
   * PUT / POST /api/v1/admin/episodes/:id
   * Update an existing episode
   */
  static async updateEpisode(req, res) {
    try {
      const episodeId = req.params.id;
      const [existingRows] = await pool.query('SELECT * FROM episodes WHERE id = ? LIMIT 1', [episodeId]);
      if (existingRows.length === 0) {
        return ApiResponse.error(res, 'Episode not found.', 444);
      }

      const {
        title,
        story_id,
        storyId,
        story,
        description,
        duration,
        duration_seconds,
        duration_minutes,
        is_premium,
        is_downloadable,
        coins,
        published_at,
        publish_date,
        published_date,
        publishedDate,
        scheduled_at,
        schedule_date_time,
        audio_file,
        audio_path,
        audio_title,
      } = req.body || {};

      const updateFields = [];
      const queryParams = [];

      const targetStoryId = story_id || storyId || story;
      if (targetStoryId !== undefined && targetStoryId !== null && targetStoryId !== '') {
        updateFields.push('`story_id` = ?');
        queryParams.push(targetStoryId);
      }

      if (title !== undefined && String(title).trim() !== '') {
        updateFields.push('`title` = ?');
        queryParams.push(String(title).trim());
      }

      if (description !== undefined) {
        updateFields.push('`description` = ?');
        queryParams.push(description);
      }

      if (is_premium !== undefined) {
        updateFields.push('`is_premium` = ?');
        const isPremiumVal = (is_premium === '1' || is_premium === 1 || is_premium === 'true' || is_premium === true) ? 1 : 0;
        queryParams.push(isPremiumVal);
      }

      if (is_downloadable !== undefined) {
        updateFields.push('`is_downloadable` = ?');
        const isDownVal = (is_downloadable === '1' || is_downloadable === 1 || is_downloadable === 'true' || is_downloadable === true) ? 1 : 0;
        queryParams.push(isDownVal);
      }

      let durSecs = undefined;
      if (duration_seconds !== undefined && duration_seconds !== null && duration_seconds !== '') {
        durSecs = parseInt(duration_seconds, 10) || 0;
      } else if (duration !== undefined && duration !== null && duration !== '') {
        durSecs = parseInt(duration, 10) || 0;
      }
      if (durSecs !== undefined) {
        updateFields.push('`duration_seconds` = ?');
        queryParams.push(durSecs);
        updateFields.push('`duration_minutes` = ?');
        queryParams.push(durSecs ? parseFloat((durSecs / 60).toFixed(2)) : null);
      }

      const rawDate = published_at || publish_date || published_date || publishedDate || scheduled_at || schedule_date_time;
      if (rawDate !== undefined && rawDate !== null && String(rawDate).trim() !== '' && String(rawDate).toLowerCase() !== 'null') {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          updateFields.push('`published_at` = ?');
          queryParams.push(d);
        }
      }

      let audioFilePath = null;
      const uploadedFile = req.file || (req.files && req.files.length > 0 ? (req.files.find(f => f.fieldname === 'audio_file' || f.fieldname === 'audio') || req.files[0]) : null);
      if (uploadedFile) {
        const { uploadToR2 } = require('../../services/r2StorageService');
        audioFilePath = await uploadToR2(uploadedFile, 'episodes');
      } else if (typeof audio_file === 'string' && audio_file.trim() !== '') {
        audioFilePath = audio_file;
      } else if (typeof audio_path === 'string' && audio_path.trim() !== '') {
        audioFilePath = audio_path;
      }

      if (audioFilePath) {
        updateFields.push('`audio_path` = ?');
        queryParams.push(audioFilePath);
      }

      if (updateFields.length > 0) {
        updateFields.push('`updated_at` = NOW()');
        queryParams.push(episodeId);
        await pool.query(`UPDATE episodes SET ${updateFields.join(', ')} WHERE id = ?`, queryParams);
      }

      const [updatedEp] = await pool.query(
        'SELECT e.*, s.title as story_title FROM episodes e LEFT JOIN stories s ON e.story_id = s.id WHERE e.id = ? LIMIT 1',
        [episodeId]
      );

      return ApiResponse.success(
        res,
        { episode: toEpisodeFieldsArray(updatedEp[0], updatedEp[0].story_title, true) },
        'Episode updated successfully.'
      );
    } catch (error) {
      console.error('Admin Update Episode Error:', error);
      return ApiResponse.error(res, 'Failed to update episode.', 500);
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
