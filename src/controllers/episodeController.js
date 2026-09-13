const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const { toEpisodeFieldsArray } = require('../utils/storyPresenter');

class EpisodeController {
  /**
   * GET /api/v1/episodes or GET /api/v1/stories/:storyId/episodes
   * Fetch paginated list of episodes with total count, progress for every episode, and last resume episode
   */
  static async index(req, res) {
    try {
      const storyId = req.params.storyId || req.params.id || req.query.story_id;
      const { search, page = 1, limit = 10, filter, status, is_locked, is_unlocked, is_scheduled, is_downloadable } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const offset = (pageNum - 1) * limitNum;
      const userId = req.user ? req.user.id : null;

      let whereClauses = ['1=1'];
      let queryParams = [];

      if (storyId) {
        whereClauses.push('e.story_id = ?');
        queryParams.push(storyId);
      }

      if (search) {
        whereClauses.push('(e.title LIKE ? OR e.description LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`);
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
        if (userId) {
          whereClauses.push('(e.is_premium = 1 AND e.id NOT IN (SELECT episode_id FROM user_episode_unlocks WHERE user_id = ?))');
          queryParams.push(userId);
        } else {
          whereClauses.push('e.is_premium = 1');
        }
      }

      if (activeFilters.has('unlocked')) {
        if (userId) {
          whereClauses.push('(e.is_premium = 0 OR e.id IN (SELECT episode_id FROM user_episode_unlocks WHERE user_id = ?))');
          queryParams.push(userId);
        } else {
          whereClauses.push('e.is_premium = 0');
        }
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
        `SELECT e.*, s.title as story_title, s.cover_image_path as story_cover_image_path
         FROM episodes e
         LEFT JOIN stories s ON e.story_id = s.id
         ${whereSql}
         ORDER BY e.position ASC, e.id ASC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      let userUnlockedEpisodeIds = new Set();
      let hasActiveMembership = false;
      let watchHistoryMap = {};
      let lastWatchedEpisodeId = null;

      if (userId && episodes.length > 0) {
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

        const episodeIds = episodes.map((ep) => ep.id);
        const [unlocks] = await pool.query(
          'SELECT episode_id FROM user_episode_unlocks WHERE user_id = ? AND episode_id IN (?)',
          [userId, episodeIds]
        );
        unlocks.forEach((u) => {
          if (u.episode_id !== null && u.episode_id !== undefined) {
            userUnlockedEpisodeIds.add(Number(u.episode_id));
            userUnlockedEpisodeIds.add(String(u.episode_id));
          }
        });

        // Query watch history for user
        let whQuery = 'SELECT * FROM watch_histories WHERE user_id = ? AND episode_id IN (?) ORDER BY GREATEST(COALESCE(last_watched_at, \'1970-01-01\'), COALESCE(updated_at, \'1970-01-01\'), COALESCE(created_at, \'1970-01-01\')) DESC, id DESC';
        let whParams = [userId, episodeIds];

        if (storyId) {
          whQuery = 'SELECT * FROM watch_histories WHERE user_id = ? AND story_id = ? AND episode_id IS NOT NULL ORDER BY GREATEST(COALESCE(last_watched_at, \'1970-01-01\'), COALESCE(updated_at, \'1970-01-01\'), COALESCE(created_at, \'1970-01-01\')) DESC, id DESC';
          whParams = [userId, storyId];
        }

        const [whRows] = await pool.query(whQuery, whParams);
        whRows.forEach((wh) => {
          if (wh.episode_id && !watchHistoryMap[wh.episode_id]) {
            watchHistoryMap[wh.episode_id] = wh;
          }
        });

        // Determine last watched/resumed episode across story
        if (whRows.length > 0) {
          const validHistory = whRows.filter((r) => r.episode_id);
          if (validHistory.length > 0) {
            lastWatchedEpisodeId = Number(validHistory[0].episode_id);
          }
        }
      }

      const result = episodes.map((ep) => {
        const isUnlocked = !ep.is_premium || hasActiveMembership || Boolean(userId && (userUnlockedEpisodeIds.has(Number(ep.id)) || userUnlockedEpisodeIds.has(String(ep.id))));
        const wh = watchHistoryMap[ep.id] || null;
        const isLastW = Boolean(lastWatchedEpisodeId && ep.id === lastWatchedEpisodeId);
        const progressData = wh ? { ...wh, is_last_watched: isLastW } : { is_last_watched: isLastW };

        return toEpisodeFieldsArray(ep, ep.story_title, isUnlocked, progressData);
      });

      // Construct last resume / last watched episode object for top-level response
      let lastWatchedEpisodeObj = null;
      if (userId && lastWatchedEpisodeId) {
        let targetEp = episodes.find((e) => e.id === lastWatchedEpisodeId);
        if (!targetEp) {
          const [fetched] = await pool.query(
            `SELECT e.*, s.title as story_title, s.cover_image_path as story_cover_image_path
             FROM episodes e JOIN stories s ON e.story_id = s.id WHERE e.id = ? LIMIT 1`,
            [lastWatchedEpisodeId]
          );
          if (fetched.length > 0) targetEp = fetched[0];
        }

        if (targetEp) {
          const wh = watchHistoryMap[targetEp.id] || null;
          const isUnlocked = !targetEp.is_premium || hasActiveMembership || Boolean(userId && userUnlockedEpisodeIds.has(targetEp.id));
          const progressData = wh ? { ...wh, is_last_watched: true } : { is_last_watched: true };
          lastWatchedEpisodeObj = toEpisodeFieldsArray(targetEp, targetEp.story_title, isUnlocked, progressData);
        }
      } else if (episodes.length > 0) {
        // Fallback default: If no watch history exists, offer first episode as starting point
        const firstEp = episodes[0];
        const isUnlocked = !firstEp.is_premium || hasActiveMembership || Boolean(userId && userUnlockedEpisodeIds.has(firstEp.id));
        lastWatchedEpisodeObj = toEpisodeFieldsArray(firstEp, firstEp.story_title, isUnlocked, { is_last_watched: true });
      }

      return ApiResponse.success(res, {
        last_watched_episode: lastWatchedEpisodeObj,
        last_resume_episode: lastWatchedEpisodeObj,
        episodes: result,
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
      console.error('List Episodes Error:', error);
      return ApiResponse.error(res, 'Failed to fetch episodes list.', 500);
    }
  }

  /**
   * GET /api/v1/episodes/:id
   * Fetch single episode details
   */
  static async show(req, res) {
    try {
      const episodeId = req.params.id || req.params.episode;
      const userId = req.user ? req.user.id : null;

      const [rows] = await pool.query(
        `SELECT e.*, s.title as story_title, s.cover_image_path as story_cover_image_path
         FROM episodes e
         JOIN stories s ON e.story_id = s.id
         WHERE e.id = ? LIMIT 1`,
        [episodeId]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Episode not found.', 444);
      }

      const episode = rows[0];

      // Increment play count
      await pool.query('UPDATE episodes SET plays_count = plays_count + 1 WHERE id = ?', [episodeId]);
      await pool.query('UPDATE stories SET listeners_count = listeners_count + 1 WHERE id = ?', [episode.story_id]);

      let isUnlocked = true;
      if (episode.is_premium) {
        if (!userId) {
          isUnlocked = false;
        } else {
          const [subRows] = await pool.query(
            "SELECT id FROM subscriptions WHERE user_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1",
            [userId]
          );
          const [userRows] = await pool.query(
            "SELECT subscription_type, role FROM users WHERE id = ? LIMIT 1",
            [userId]
          );
          const hasActiveMembership = subRows.length > 0 || (userRows.length > 0 && (userRows[0].subscription_type === 'vip' || userRows[0].role === 'vip'));

          if (hasActiveMembership) {
            isUnlocked = true;
          } else {
            const [unlockRow] = await pool.query(
              'SELECT id FROM user_episode_unlocks WHERE user_id = ? AND episode_id = ? LIMIT 1',
              [userId, episodeId]
            );
            isUnlocked = unlockRow.length > 0;
          }
        }
      }

      let wh = null;
      if (userId) {
        const [whRows] = await pool.query(
          'SELECT * FROM watch_histories WHERE user_id = ? AND episode_id = ? LIMIT 1',
          [userId, episodeId]
        );
        if (whRows.length > 0) wh = whRows[0];
      }

      const result = toEpisodeFieldsArray(episode, episode.story_title, isUnlocked, wh);
      return ApiResponse.success(res, { episode: result });
    } catch (error) {
      console.error('Get Episode Error:', error);
      return ApiResponse.error(res, 'Failed to fetch episode.', 500);
    }
  }

  /**
   * POST /api/v1/episodes
   * Create a new episode for a story
   */
  static async store(req, res) {
    try {
      const {
        story_id,
        title,
        episode_number,
        episode_no,
        position,
        description,
        publish_as,
        scheduled_at,
        schedule_date_time,
        audio_title,
        coins,
        is_premium,
        is_downloadable,
        duration_seconds,
        duration_minutes,
        audio_file,
        audio_path,
      } = req.body || {};

      const targetStoryId = req.params.storyId || story_id;

      if (!targetStoryId || !title || String(title).trim() === '') {
        return ApiResponse.error(res, 'Story ID and episode title are required.', 422);
      }

      // Verify parent story exists
      const [storyRows] = await pool.query('SELECT title FROM stories WHERE id = ? LIMIT 1', [targetStoryId]);
      if (storyRows.length === 0) {
        return ApiResponse.error(res, 'Parent story not found.', 444);
      }

      let epPosition = episode_number || episode_no || position;
      epPosition = epPosition ? parseInt(epPosition, 10) : null;
      if (!epPosition) {
        const [maxPos] = await pool.query('SELECT MAX(position) as max_pos FROM episodes WHERE story_id = ?', [targetStoryId]);
        epPosition = (maxPos[0].max_pos || 0) + 1;
      }

      // Default coins to 25 if not provided or empty
      const coinCost = coins !== undefined && coins !== null && coins !== ''
        ? parseInt(coins, 10)
        : 25;

      const publishAsMode = publish_as || 'publish_now';
      const scheduledDateTime = scheduled_at || schedule_date_time || null;
      let publishedAt = new Date();
      if (publishAsMode === 'schedule_for_later' && scheduledDateTime) {
        publishedAt = new Date(scheduledDateTime);
      }

      let audioFilePath = typeof audio_file === 'string' ? audio_file : (audio_path || null);
      const uploadedFile = req.file || (req.files && req.files.length > 0 ? (req.files.find(f => f.fieldname === 'audio_file' || f.fieldname === 'audio') || req.files[0]) : null);
      if (uploadedFile) {
        const { uploadToR2 } = require('../services/r2StorageService');
        audioFilePath = await uploadToR2(uploadedFile, 'episodes');
      }

      const createdById = req.user ? req.user.id : null;
      const isPremiumVal = (is_premium === '1' || is_premium === 1 || is_premium === 'true' || is_premium === true) ? 1 : 0;
      const isDownloadableVal = (is_downloadable === undefined || is_downloadable === null || is_downloadable === '1' || is_downloadable === 1 || is_downloadable === 'true' || is_downloadable === true) ? 1 : 0;
      const finalAudioTitle = audio_title && String(audio_title).trim() !== '' ? String(audio_title).trim() : String(title).trim();

      const [result] = await pool.query(
        `INSERT INTO episodes (
          story_id, created_by, title, position, description, publish_as, scheduled_at,
          audio_title, duration_seconds, duration_minutes, is_premium, is_downloadable,
          coins, audio_path, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          targetStoryId,
          createdById,
          String(title).trim(),
          epPosition,
          description || null,
          publishAsMode,
          scheduledDateTime,
          finalAudioTitle,
          duration_seconds ? parseInt(duration_seconds, 10) : 0,
          duration_minutes ? parseFloat(duration_minutes) : null,
          isPremiumVal,
          isDownloadableVal,
          coinCost,
          audioFilePath,
          publishedAt,
        ]
      );

      const episodeId = result.insertId;

      // Refresh episodes count on parent story
      const [epCount] = await pool.query('SELECT COUNT(*) as cnt FROM episodes WHERE story_id = ?', [targetStoryId]);
      await pool.query('UPDATE stories SET episodes_count = ? WHERE id = ?', [epCount[0].cnt, targetStoryId]);

      const [newEp] = await pool.query(
        'SELECT e.*, s.title as story_title, s.cover_image_path as story_cover_image_path FROM episodes e JOIN stories s ON e.story_id = s.id WHERE e.id = ? LIMIT 1',
        [episodeId]
      );
      return ApiResponse.success(
        res,
        { episode: toEpisodeFieldsArray(newEp[0], storyRows[0].title, true) },
        'Episode created successfully.',
        201
      );
    } catch (error) {
      console.error('Create Episode Error:', error);
      return ApiResponse.error(res, 'Failed to create episode.', 500);
    }
  }

  /**
   * PUT / POST /api/v1/episodes/:id
   * Edit / Update an existing episode
   */
  static async update(req, res) {
    try {
      const episodeId = req.params.id || req.params.episode;
      const [epRows] = await pool.query('SELECT * FROM episodes WHERE id = ? LIMIT 1', [episodeId]);

      if (epRows.length === 0) {
        return ApiResponse.error(res, 'Episode not found.', 444);
      }

      const {
        title,
        episode_number,
        episode_no,
        position,
        description,
        publish_as,
        scheduled_at,
        schedule_date_time,
        audio_title,
        duration_seconds,
        duration_minutes,
        is_premium,
        coins,
        audio_file,
        audio_path,
      } = req.body || {};

      const updateFields = [];
      const queryParams = [];

      if (title !== undefined) {
        updateFields.push('`title` = ?');
        queryParams.push(String(title).trim());
      }
      const epPos = episode_number || episode_no || position;
      if (epPos !== undefined) {
        updateFields.push('`position` = ?');
        queryParams.push(parseInt(epPos, 10));
      }
      if (description !== undefined) {
        updateFields.push('`description` = ?');
        queryParams.push(description);
      }
      if (publish_as !== undefined) {
        updateFields.push('`publish_as` = ?');
        queryParams.push(publish_as);
      }
      const schedTime = scheduled_at || schedule_date_time;
      if (schedTime !== undefined) {
        updateFields.push('`scheduled_at` = ?');
        queryParams.push(schedTime);
      }
      if (audio_title !== undefined) {
        updateFields.push('`audio_title` = ?');
        queryParams.push(audio_title);
      }
      if (duration_seconds !== undefined) {
        updateFields.push('`duration_seconds` = ?');
        queryParams.push(parseInt(duration_seconds, 10));
      }
      if (duration_minutes !== undefined) {
        updateFields.push('`duration_minutes` = ?');
        queryParams.push(parseFloat(duration_minutes));
      }
      if (is_premium !== undefined) {
        const isPremiumVal = (is_premium === '1' || is_premium === 1 || is_premium === 'true' || is_premium === true) ? 1 : 0;
        updateFields.push('`is_premium` = ?');
        queryParams.push(isPremiumVal);
      }
      if (req.body.is_downloadable !== undefined) {
        const isDownVal = (req.body.is_downloadable === '1' || req.body.is_downloadable === 1 || req.body.is_downloadable === 'true' || req.body.is_downloadable === true) ? 1 : 0;
        updateFields.push('`is_downloadable` = ?');
        queryParams.push(isDownVal);
      }
      if (coins !== undefined) {
        updateFields.push('`coins` = ?');
        queryParams.push(parseInt(coins, 10));
      }

      const uploadedFile = req.file || (req.files && req.files.length > 0 ? (req.files.find(f => f.fieldname === 'audio_file' || f.fieldname === 'audio') || req.files[0]) : null);
      if (uploadedFile) {
        const { uploadToR2 } = require('../services/r2StorageService');
        const r2AudioUrl = await uploadToR2(uploadedFile, 'episodes');
        updateFields.push('`audio_path` = ?');
        queryParams.push(r2AudioUrl);
      } else if (typeof audio_file === 'string' || audio_path !== undefined) {
        updateFields.push('`audio_path` = ?');
        queryParams.push(audio_file || audio_path);
      }

      if (updateFields.length > 0) {
        queryParams.push(episodeId);
        await pool.query(
          `UPDATE episodes SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`,
          queryParams
        );
      }

      const [updatedRows] = await pool.query(
        `SELECT e.*, s.title as story_title, s.cover_image_path as story_cover_image_path FROM episodes e JOIN stories s ON e.story_id = s.id WHERE e.id = ? LIMIT 1`,
        [episodeId]
      );

      return ApiResponse.success(
        res,
        { episode: toEpisodeFieldsArray(updatedRows[0], updatedRows[0].story_title, true) },
        'Episode updated successfully.'
      );
    } catch (error) {
      console.error('Update Episode Error:', error);
      return ApiResponse.error(res, 'Failed to update episode.', 500);
    }
  }

  /**
   * POST /api/v1/episodes/:id/unlock
   * Unlock premium episode using wallet coins
   */
  static async unlock(req, res) {
    try {
      const episodeId = req.params.id || req.params.episode;
      const userId = req.user.id;

      const [episodeRows] = await pool.query(
        'SELECT * FROM episodes WHERE id = ? LIMIT 1',
        [episodeId]
      );

      if (episodeRows.length === 0) {
        return ApiResponse.error(res, 'Episode not found.', 444);
      }

      const episode = episodeRows[0];
      if (!episode.is_premium) {
        return ApiResponse.success(res, { is_unlocked: true }, 'Episode is free.');
      }

      // Check if already unlocked
      const [existing] = await pool.query(
        'SELECT id FROM user_episode_unlocks WHERE user_id = ? AND episode_id = ? LIMIT 1',
        [userId, episodeId]
      );

      if (existing.length > 0) {
        return ApiResponse.success(res, { is_unlocked: true }, 'Episode is already unlocked.');
      }

      const coinCost = Number(episode.coins || 0);

      // Check user wallet balance
      const [userRows] = await pool.query('SELECT wallet_balance FROM users WHERE id = ? LIMIT 1', [userId]);
      const currentBalance = Number(userRows[0].wallet_balance || 0);

      if (currentBalance < coinCost) {
        return ApiResponse.error(
          res,
          `Insufficient coins. Required: ${coinCost}, Available: ${currentBalance}`,
          422
        );
      }

      // Execute unlock in transaction
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // Deduct coins
        await connection.query(
          'UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?',
          [coinCost, userId]
        );

        // Record unlock
        await connection.query(
          'INSERT INTO user_episode_unlocks (user_id, episode_id, coins_spent) VALUES (?, ?, ?)',
          [userId, episodeId, coinCost]
        );

        // Record coin transaction
        await connection.query(
          'INSERT INTO coin_transactions (user_id, type, coins, description, reference_id) VALUES (?, ?, ?, ?, ?)',
          [userId, 'spend', coinCost, `Unlocked Episode #${episode.position}: ${episode.title}`, String(episodeId)]
        );

        await connection.commit();
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }

      const result = toEpisodeFieldsArray(episode, null, true);
      return ApiResponse.success(res, { episode: result, is_unlocked: true }, 'Episode unlocked successfully.');
    } catch (error) {
      console.error('Unlock Episode Error:', error);
      return ApiResponse.error(res, 'Failed to unlock episode.', 500);
    }
  }
}

module.exports = EpisodeController;
