const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const { toEpisodeFieldsArray } = require('../utils/storyPresenter');

class EpisodeController {
  /**
   * GET /api/v1/episodes/:id
   * Fetch single episode details
   */
  static async show(req, res) {
    try {
      const episodeId = req.params.id || req.params.episode;
      const userId = req.user ? req.user.id : null;

      const [rows] = await pool.query(
        `SELECT e.*, s.title as story_title
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
          const [unlockRow] = await pool.query(
            'SELECT id FROM user_episode_unlocks WHERE user_id = ? AND episode_id = ? LIMIT 1',
            [userId, episodeId]
          );
          isUnlocked = unlockRow.length > 0;
        }
      }

      const result = toEpisodeFieldsArray(episode, episode.story_title, isUnlocked);
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
        tags,
        audio_title,
        coins,
        is_premium,
        duration_seconds,
        duration_minutes,
        audio_file,
        audio_path,
      } = req.body;

      const targetStoryId = req.params.storyId || story_id;

      if (!targetStoryId || !title || title.trim() === '') {
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

      let audioFilePath = audio_file || audio_path || null;
      if (req.file) {
        const { uploadToR2 } = require('../services/r2StorageService');
        audioFilePath = await uploadToR2(req.file, 'episodes');
      }

      const createdById = req.user ? req.user.id : null;

      const [result] = await pool.query(
        `INSERT INTO episodes (
          story_id, created_by, title, position, description, publish_as, scheduled_at,
          tags, audio_title, duration_seconds, duration_minutes, is_premium,
          coins, audio_path, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          targetStoryId,
          createdById,
          title.trim(),
          epPosition,
          description || null,
          publishAsMode,
          scheduledDateTime,
          tags || null,
          audio_title || title.trim(),
          duration_seconds ? parseInt(duration_seconds, 10) : 0,
          duration_minutes ? parseFloat(duration_minutes) : null,
          is_premium ? 1 : 0,
          coinCost,
          audioFilePath,
          publishedAt,
        ]
      );

      const episodeId = result.insertId;

      // Refresh episodes count on parent story
      const [epCount] = await pool.query('SELECT COUNT(*) as cnt FROM episodes WHERE story_id = ?', [targetStoryId]);
      await pool.query('UPDATE stories SET episodes_count = ? WHERE id = ?', [epCount[0].cnt, targetStoryId]);

      const [newEp] = await pool.query('SELECT * FROM episodes WHERE id = ? LIMIT 1', [episodeId]);
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
        tags,
        audio_title,
        duration_seconds,
        duration_minutes,
        is_premium,
        coins,
        audio_file,
        audio_path,
      } = req.body;

      const updateFields = [];
      const queryParams = [];

      if (title !== undefined) {
        updateFields.push('`title` = ?');
        queryParams.push(title.trim());
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
      if (tags !== undefined) {
        updateFields.push('`tags` = ?');
        queryParams.push(tags);
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
        updateFields.push('`is_premium` = ?');
        queryParams.push(is_premium ? 1 : 0);
      }
      if (coins !== undefined) {
        updateFields.push('`coins` = ?');
        queryParams.push(parseInt(coins, 10));
      }

      if (req.file) {
        const { uploadToR2 } = require('../services/r2StorageService');
        const r2AudioUrl = await uploadToR2(req.file, 'episodes');
        updateFields.push('`audio_path` = ?');
        queryParams.push(r2AudioUrl);
      } else if (audio_file !== undefined || audio_path !== undefined) {
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
        `SELECT e.*, s.title as story_title FROM episodes e JOIN stories s ON e.story_id = s.id WHERE e.id = ? LIMIT 1`,
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
