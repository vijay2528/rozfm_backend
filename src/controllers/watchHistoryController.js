const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

function formatTime(seconds) {
  const s = Math.max(0, parseInt(seconds, 10) || 0);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

class WatchHistoryController {
  /**
   * GET /api/v1/watch-history
   * List watch history for authenticated user
   */
  static async index(req, res) {
    try {
      const userId = req.user.id;
      const [historyRows] = await pool.query(
        `SELECT w.*, s.title as story_title, s.cover_image_path, e.title as episode_title, e.episode_number as episode_position, e.duration as episode_duration
         FROM watch_histories w
         JOIN stories s ON w.story_id = s.id
         LEFT JOIN episodes e ON w.episode_id = e.id
         WHERE w.user_id = ?
         ORDER BY w.last_watched_at DESC`,
        [userId]
      );

      const history = historyRows.map((h) => {
        const totalDuration = Number(h.total_duration_seconds || h.episode_duration || 0);
        const progress = Number(h.progress_seconds || 0);
        const completionPct = totalDuration > 0 
          ? parseFloat(((progress / totalDuration) * 100).toFixed(2)) 
          : Number(h.completion_percentage || 0);

        return {
          id: Number(h.id),
          story_id: Number(h.story_id),
          episode_id: h.episode_id ? Number(h.episode_id) : null,
          story_title: h.story_title,
          episode_title: h.episode_title || null,
          episode_no: h.episode_position || 1,
          progress_seconds: progress,
          progress_formatted: formatTime(progress),
          total_duration_seconds: totalDuration,
          total_duration_formatted: formatTime(totalDuration),
          completion_percentage: completionPct,
          status: h.status || (Boolean(h.completed) ? 'completed' : 'playing'),
          completed: Boolean(h.completed),
          total_seconds_listened: Number(h.total_seconds_listened || 0),
          total_minutes_listened: parseFloat((Number(h.total_seconds_listened || 0) / 60).toFixed(1)),
          last_watched_at: h.last_watched_at ? new Date(h.last_watched_at).toISOString() : null,
        };
      });

      return ApiResponse.success(res, { history });
    } catch (error) {
      console.error('List Watch History Error:', error);
      return ApiResponse.error(res, 'Failed to fetch watch history.', 500);
    }
  }

  /**
   * POST /api/v1/watch-history/track-progress or POST /api/v1/episodes/:id/track-progress
   * Track episode playing progress, position, status (playing/stopped/paused/completed), and seconds listened
   */
  static async trackProgress(req, res) {
    try {
      const userId = req.user.id;
      const episodeId = req.params.id || req.body.episode_id;
      let storyId = req.body.story_id;

      let progressSeconds = Math.max(0, parseInt(req.body.progress_seconds || req.body.current_position_seconds || 0, 10));
      let totalDurationSeconds = Math.max(0, parseInt(req.body.total_duration_seconds || req.body.duration_seconds || 0, 10));
      const secondsListened = Math.max(0, parseInt(req.body.seconds_listened || req.body.delta_seconds || 0, 10));
      const statusInput = req.body.status ? String(req.body.status).toLowerCase() : 'playing';

      if (!episodeId && !storyId) {
        return ApiResponse.error(res, 'Episode ID or Story ID is required.', 422);
      }

      // Fetch episode info if episodeId is provided
      let epDuration = 0;
      if (episodeId) {
        const [epRows] = await pool.query('SELECT story_id, duration FROM episodes WHERE id = ? LIMIT 1', [episodeId]);
        if (epRows.length > 0) {
          if (!storyId) storyId = epRows[0].story_id;
          epDuration = Number(epRows[0].duration || 0);
        }
      }

      if (!storyId) {
        return ApiResponse.error(res, 'Story not found for specified episode.', 404);
      }

      if (totalDurationSeconds === 0 && epDuration > 0) {
        totalDurationSeconds = epDuration;
      }

      // Calculate completion percentage
      let completionPercentage = 0;
      if (totalDurationSeconds > 0) {
        completionPercentage = parseFloat(((progressSeconds / totalDurationSeconds) * 100).toFixed(2));
        if (completionPercentage > 100) completionPercentage = 100.0;
      }

      const isExplicitCompleted = req.body.completed === true || req.body.completed === 'true' || statusInput === 'completed';
      const isCompleted = isExplicitCompleted || completionPercentage >= 90.0;
      const finalStatus = isCompleted ? 'completed' : (['playing', 'paused', 'stopped'].includes(statusInput) ? statusInput : 'playing');

      // Check existing watch history row
      const [existing] = await pool.query(
        'SELECT id, total_seconds_listened FROM watch_histories WHERE user_id = ? AND story_id = ? AND (episode_id = ? OR episode_id IS NULL) LIMIT 1',
        [userId, storyId, episodeId || null]
      );

      let recordId;
      let newTotalListened = secondsListened;

      if (existing.length > 0) {
        recordId = existing[0].id;
        newTotalListened = Number(existing[0].total_seconds_listened || 0) + secondsListened;

        await pool.query(
          `UPDATE watch_histories 
           SET episode_id = ?, progress_seconds = ?, total_duration_seconds = ?, total_seconds_listened = ?, completion_percentage = ?, status = ?, completed = ?, last_watched_at = NOW()
           WHERE id = ?`,
          [episodeId || null, progressSeconds, totalDurationSeconds, newTotalListened, completionPercentage, finalStatus, isCompleted ? 1 : 0, recordId]
        );
      } else {
        const [insertRes] = await pool.query(
          `INSERT INTO watch_histories 
           (user_id, story_id, episode_id, progress_seconds, total_duration_seconds, total_seconds_listened, completion_percentage, status, completed, last_watched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [userId, storyId, episodeId || null, progressSeconds, totalDurationSeconds, newTotalListened, completionPercentage, finalStatus, isCompleted ? 1 : 0]
        );
        recordId = insertRes.insertId;

        // Increment stats on first play
        if (episodeId) {
          await pool.query('UPDATE episodes SET plays_count = plays_count + 1 WHERE id = ?', [episodeId]);
        }
        await pool.query('UPDATE stories SET total_views = total_views + 1, listeners_count = listeners_count + 1 WHERE id = ?', [storyId]);
      }

      return ApiResponse.success(res, {
        watch_history_id: Number(recordId),
        user_id: Number(userId),
        story_id: Number(storyId),
        episode_id: episodeId ? Number(episodeId) : null,
        progress_seconds: progressSeconds,
        progress_formatted: formatTime(progressSeconds),
        total_duration_seconds: totalDurationSeconds,
        total_duration_formatted: formatTime(totalDurationSeconds),
        completion_percentage: completionPercentage,
        status: finalStatus,
        completed: isCompleted,
        seconds_listened_added: secondsListened,
        total_seconds_listened: newTotalListened,
        total_minutes_listened: parseFloat((newTotalListened / 60).toFixed(1)),
      }, 'Playback progress updated successfully.');
    } catch (error) {
      console.error('Track Progress Error:', error);
      return ApiResponse.error(res, 'Failed to update playback progress.', 500);
    }
  }

  /**
   * POST /api/v1/watch-history/track-minutes
   * Incrementally track listening time (in seconds/minutes) for user playback
   */
  static async trackMinutes(req, res) {
    try {
      const userId = req.user.id;
      const { story_id, episode_id, seconds, minutes } = req.body;

      if (!story_id && !episode_id) {
        return ApiResponse.error(res, 'story_id or episode_id is required.', 422);
      }

      let secondsToAdd = 0;
      if (seconds) secondsToAdd = Math.max(0, parseInt(seconds, 10) || 0);
      else if (minutes) secondsToAdd = Math.max(0, Math.round(parseFloat(minutes) * 60) || 0);
      else secondsToAdd = 60; // default 1 minute ping

      let resolvedStoryId = story_id;
      if (episode_id && !resolvedStoryId) {
        const [epRows] = await pool.query('SELECT story_id FROM episodes WHERE id = ? LIMIT 1', [episode_id]);
        if (epRows.length > 0) resolvedStoryId = epRows[0].story_id;
      }

      const [existing] = await pool.query(
        'SELECT id, total_seconds_listened FROM watch_histories WHERE user_id = ? AND story_id = ? AND (episode_id = ? OR episode_id IS NULL) LIMIT 1',
        [userId, resolvedStoryId, episode_id || null]
      );

      let newTotal = secondsToAdd;
      if (existing.length > 0) {
        newTotal = Number(existing[0].total_seconds_listened || 0) + secondsToAdd;
        await pool.query(
          'UPDATE watch_histories SET total_seconds_listened = ?, last_watched_at = NOW() WHERE id = ?',
          [newTotal, existing[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO watch_histories (user_id, story_id, episode_id, total_seconds_listened, last_watched_at)
           VALUES (?, ?, ?, ?, NOW())`,
          [userId, resolvedStoryId, episode_id || null, secondsToAdd]
        );
      }

      return ApiResponse.success(res, {
        story_id: resolvedStoryId ? Number(resolvedStoryId) : null,
        episode_id: episode_id ? Number(episode_id) : null,
        seconds_added: secondsToAdd,
        minutes_added: parseFloat((secondsToAdd / 60).toFixed(1)),
        total_seconds_listened: newTotal,
        total_minutes_listened: parseFloat((newTotal / 60).toFixed(1)),
      }, 'Listening minutes tracked.');
    } catch (error) {
      console.error('Track Minutes Error:', error);
      return ApiResponse.error(res, 'Failed to track listening minutes.', 500);
    }
  }

  /**
   * GET /api/v1/episodes/:id/progress
   * Fetch current user's progress for a specific episode
   */
  static async getEpisodeProgress(req, res) {
    try {
      const userId = req.user.id;
      const episodeId = req.params.id;

      const [epRows] = await pool.query('SELECT story_id, duration, episode_number, title FROM episodes WHERE id = ? LIMIT 1', [episodeId]);
      if (epRows.length === 0) {
        return ApiResponse.error(res, 'Episode not found.', 404);
      }
      const ep = epRows[0];

      const [rows] = await pool.query(
        'SELECT * FROM watch_histories WHERE user_id = ? AND episode_id = ? LIMIT 1',
        [userId, episodeId]
      );

      if (rows.length === 0) {
        return ApiResponse.success(res, {
          episode_id: Number(episodeId),
          story_id: Number(ep.story_id),
          episode_no: Number(ep.episode_number),
          title: ep.title,
          progress_seconds: 0,
          progress_formatted: '00:00',
          total_duration_seconds: Number(ep.duration || 0),
          total_duration_formatted: formatTime(ep.duration),
          completion_percentage: 0.0,
          status: 'unwatched',
          completed: false,
          total_seconds_listened: 0,
          last_watched_at: null,
        });
      }

      const h = rows[0];
      const totalDuration = Number(h.total_duration_seconds || ep.duration || 0);
      const progress = Number(h.progress_seconds || 0);
      const completionPct = totalDuration > 0 
        ? parseFloat(((progress / totalDuration) * 100).toFixed(2)) 
        : Number(h.completion_percentage || 0);

      return ApiResponse.success(res, {
        episode_id: Number(episodeId),
        story_id: Number(ep.story_id),
        episode_no: Number(ep.episode_number),
        title: ep.title,
        progress_seconds: progress,
        progress_formatted: formatTime(progress),
        total_duration_seconds: totalDuration,
        total_duration_formatted: formatTime(totalDuration),
        completion_percentage: completionPct,
        status: h.status || (Boolean(h.completed) ? 'completed' : 'playing'),
        completed: Boolean(h.completed),
        total_seconds_listened: Number(h.total_seconds_listened || 0),
        last_watched_at: h.last_watched_at ? new Date(h.last_watched_at).toISOString() : null,
      });
    } catch (error) {
      console.error('Get Episode Progress Error:', error);
      return ApiResponse.error(res, 'Failed to fetch episode progress.', 500);
    }
  }

  /**
   * GET /api/v1/stories/:id/progress
   * Fetch current user's playback progress & last watched episode for a story
   */
  static async getStoryProgress(req, res) {
    try {
      const userId = req.user.id;
      const storyId = req.params.id;

      const [rows] = await pool.query(
        `SELECT w.*, e.title as episode_title, e.episode_number as episode_position, e.duration as episode_duration
         FROM watch_histories w
         LEFT JOIN episodes e ON w.episode_id = e.id
         WHERE w.user_id = ? AND w.story_id = ?
         ORDER BY w.last_watched_at DESC
         LIMIT 1`,
        [userId, storyId]
      );

      if (rows.length === 0) {
        return ApiResponse.success(res, {
          story_id: Number(storyId),
          last_watched_episode: null,
          has_history: false,
        });
      }

      const h = rows[0];
      const totalDuration = Number(h.total_duration_seconds || h.episode_duration || 0);
      const progress = Number(h.progress_seconds || 0);
      const completionPct = totalDuration > 0 
        ? parseFloat(((progress / totalDuration) * 100).toFixed(2)) 
        : Number(h.completion_percentage || 0);

      return ApiResponse.success(res, {
        story_id: Number(storyId),
        has_history: true,
        last_watched_episode: {
          episode_id: h.episode_id ? Number(h.episode_id) : null,
          episode_no: h.episode_position || 1,
          title: h.episode_title || null,
          progress_seconds: progress,
          progress_formatted: formatTime(progress),
          total_duration_seconds: totalDuration,
          total_duration_formatted: formatTime(totalDuration),
          completion_percentage: completionPct,
          status: h.status || (Boolean(h.completed) ? 'completed' : 'playing'),
          completed: Boolean(h.completed),
          last_watched_at: h.last_watched_at ? new Date(h.last_watched_at).toISOString() : null,
        },
      });
    } catch (error) {
      console.error('Get Story Progress Error:', error);
      return ApiResponse.error(res, 'Failed to fetch story progress.', 500);
    }
  }

  /**
   * GET /api/v1/user/listening-stats
   * Get total listening time (seconds, minutes, hours) and aggregate stats for authenticated user
   */
  static async getUserListeningStats(req, res) {
    try {
      const userId = req.user.id;

      const [[{ totalListenedSeconds, totalHistoryCount, completedCount }]] = await pool.query(
        `SELECT 
           COALESCE(SUM(total_seconds_listened), 0) AS totalListenedSeconds,
           COUNT(*) AS totalHistoryCount,
           COALESCE(SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END), 0) AS completedCount
         FROM watch_histories
         WHERE user_id = ?`,
        [userId]
      );

      const seconds = Number(totalListenedSeconds || 0);
      const totalMinutes = parseFloat((seconds / 60).toFixed(1));
      const totalHours = parseFloat((seconds / 3600).toFixed(1));

      return ApiResponse.success(res, {
        stats: {
          total_seconds_listened: seconds,
          total_minutes_listened: totalMinutes,
          total_hours_listened: totalHours,
          formatted_time: `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`,
          episodes_in_history: Number(totalHistoryCount),
          episodes_completed: Number(completedCount),
        },
      });
    } catch (error) {
      console.error('Get User Listening Stats Error:', error);
      return ApiResponse.error(res, 'Failed to fetch listening stats.', 500);
    }
  }

  /**
   * DELETE /api/v1/watch-history
   * Clear all watch history
   */
  static async clear(req, res) {
    try {
      const userId = req.user.id;
      await pool.query('DELETE FROM watch_histories WHERE user_id = ?', [userId]);
      return ApiResponse.success(res, null, 'Watch history cleared.');
    } catch (error) {
      console.error('Clear Watch History Error:', error);
      return ApiResponse.error(res, 'Failed to clear watch history.', 500);
    }
  }

  /**
   * DELETE /api/v1/watch-history/:id
   * Remove single story from watch history
   */
  static async destroy(req, res) {
    try {
      const storyId = req.params.id || req.params.story;
      const userId = req.user.id;

      await pool.query('DELETE FROM watch_histories WHERE user_id = ? AND story_id = ?', [userId, storyId]);
      return ApiResponse.success(res, null, 'Removed from watch history.');
    } catch (error) {
      console.error('Remove Watch History Item Error:', error);
      return ApiResponse.error(res, 'Failed to remove item from watch history.', 500);
    }
  }
}

module.exports = WatchHistoryController;
