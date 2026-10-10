const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const StreakService = require('../services/streakService');
const { resolveUrl, toStoryFieldsArray } = require('../utils/storyPresenter');

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
   * List watch history grouped by story (1 record per story with latest watched episode & unlocked info)
   */
  static async index(req, res) {
    try {
      const userId = req.user.id;

      // Check active VIP/Subscription status for unlocked calculations
      const [subRows] = await pool.query(
        "SELECT id FROM subscriptions WHERE user_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1",
        [userId]
      );
      const [userRows] = await pool.query(
        "SELECT subscription_type, role FROM users WHERE id = ? LIMIT 1",
        [userId]
      );
      const hasActiveMembership = subRows.length > 0 || (userRows.length > 0 && (userRows[0].subscription_type === 'vip' || userRows[0].role === 'vip'));

      const [historyRows] = await pool.query(
        `SELECT w.*, 
                s.id as s_id, s.title as story_title, s.description as story_description, s.cover_image_path, s.banner_image_path, 
                s.episodes_count, s.listeners_count, s.total_views, s.rating, s.is_premium as story_is_premium, s.status as story_status, s.category_id,
                c.category_name,
                u.id as author_id, u.name as author_name, u.avatar_path as author_avatar_path,
                e.id as ep_id, e.title as episode_title, COALESCE(e.position, e.episode_number, 1) as episode_position, 
                COALESCE(e.duration_seconds, 0) as episode_duration
         FROM watch_histories w
         INNER JOIN (
           SELECT story_id, MAX(id) as max_history_id
           FROM watch_histories
           WHERE user_id = ?
           GROUP BY story_id
         ) latest ON w.id = latest.max_history_id
         JOIN stories s ON w.story_id = s.id
         LEFT JOIN episodes e ON w.episode_id = e.id
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE w.user_id = ?
         ORDER BY GREATEST(COALESCE(w.last_watched_at, '1970-01-01'), COALESCE(w.updated_at, '1970-01-01'), COALESCE(w.created_at, '1970-01-01')) DESC, w.id DESC`,
        [userId, userId]
      );

      if (historyRows.length === 0) {
        return ApiResponse.success(res, { history: [], stories: [] });
      }

      const storyIds = historyRows.map((h) => h.story_id);

      // Batch query unlocked episodes count per story for this user
      let unlockedMap = {};
      if (storyIds.length > 0) {
        const [freeCounts] = await pool.query(
          `SELECT story_id, COUNT(*) as free_cnt FROM episodes WHERE story_id IN (?) AND is_premium = 0 GROUP BY story_id`,
          [storyIds]
        );
        const [unlockedCounts] = await pool.query(
          `SELECT ep.story_id, COUNT(DISTINCT ueu.episode_id) as unl_cnt 
           FROM user_episode_unlocks ueu 
           JOIN episodes ep ON ueu.episode_id = ep.id 
           WHERE ueu.user_id = ? AND ep.story_id IN (?) 
           GROUP BY ep.story_id`,
          [userId, storyIds]
        );

        let freeMap = {};
        freeCounts.forEach((r) => { freeMap[r.story_id] = Number(r.free_cnt || 0); });

        let unlMap = {};
        unlockedCounts.forEach((r) => { unlMap[r.story_id] = Number(r.unl_cnt || 0); });

        storyIds.forEach((sid) => {
          const epCount = Number(historyRows.find(h => h.story_id === sid)?.episodes_count || 0);
          if (hasActiveMembership) {
            unlockedMap[sid] = Math.max(epCount, 1);
          } else {
            const freeC = freeMap[sid] || 0;
            const unlC = unlMap[sid] || 0;
            let totalUnl = freeC + unlC;
            if (epCount > 0) {
              totalUnl = Math.min(totalUnl, epCount);
            }
            unlockedMap[sid] = totalUnl;
          }
        });
      }

      const history = historyRows.map((h) => {
        const totalDuration = Number(h.total_duration_seconds || h.episode_duration || 0);
        const progress = Number(h.progress_seconds || 0);
        const completionPct = totalDuration > 0
          ? parseFloat(((progress / totalDuration) * 100).toFixed(2))
          : Number(h.completion_percentage || 0);
        const coverImageUrl = resolveUrl(h.cover_image_path);
        const bannerImageUrl = resolveUrl(h.banner_image_path);
        const authorImageUrl = resolveUrl(h.author_avatar_path);

        const epNo = Number(h.episode_position || 1);
        const unlockedCnt = unlockedMap[h.story_id] !== undefined ? unlockedMap[h.story_id] : 0;
        const unlockedText = `${unlockedCnt} Episodes Unlocked`;

        const storyObj = {
          id: Number(h.story_id),
          story_id: Number(h.story_id),
          title: h.story_title,
          description: h.story_description || null,
          cover_image_path: h.cover_image_path,
          banner_image_path: h.banner_image_path,
          cover_image: coverImageUrl,
          banner_image: bannerImageUrl,
          author_name: h.author_name || null,
          author_image: authorImageUrl,
          category_name: h.category_name || null,
          episodes_count: Number(h.episodes_count || 0),
          listeners_count: Number(h.listeners_count || 0),
          total_views: Number(h.total_views || 0),
          rating: Number(h.rating || 0.0),
          is_premium: Boolean(h.story_is_premium),
          status: h.story_status || null,
        };

        return {
          id: Number(h.id),
          watch_history_id: Number(h.id),
          story_id: Number(h.story_id),
          title: h.story_title,
          story_title: h.story_title,
          story_cover_image: coverImageUrl,
          cover_image: coverImageUrl,
          banner_image: bannerImageUrl,
          author_name: h.author_name || null,
          author_image: authorImageUrl,
          author_avatar: authorImageUrl,

          // Episode info (last watched episode)
          episode_id: h.episode_id ? Number(h.episode_id) : null,
          episode_title: h.episode_title || null,
          episode_name: h.episode_title || null,
          episode_number: epNo,
          episode_no: epNo,
          episode_text: `Episode ${epNo}`,

          // Unlocked info
          unlocked_episodes_count: unlockedCnt,
          episodes_unlocked: unlockedCnt,
          unlocked_episodes_text: unlockedText,
          unlocked_text: unlockedText,

          // Progress & duration
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

          // Embedded story object
          story: toStoryFieldsArray(storyObj),
        };
      });

      return ApiResponse.success(res, { history, stories: history.map((h) => h.story) });
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
        const [epRows] = await pool.query('SELECT story_id, COALESCE(duration_seconds, 0) as duration FROM episodes WHERE id = ? LIMIT 1', [episodeId]);
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
        episodeId
          ? 'SELECT id, total_seconds_listened, COALESCE(play_counted, 0) as play_counted FROM watch_histories WHERE user_id = ? AND story_id = ? AND episode_id = ? LIMIT 1'
          : 'SELECT id, total_seconds_listened, COALESCE(play_counted, 0) as play_counted FROM watch_histories WHERE user_id = ? AND story_id = ? AND episode_id IS NULL LIMIT 1',
        episodeId ? [userId, storyId, episodeId] : [userId, storyId]
      );

      let recordId;
      let newTotalListened = secondsListened;
      let playCounted = 0;

      if (existing.length > 0) {
        recordId = existing[0].id;
        newTotalListened = Number(existing[0].total_seconds_listened || 0) + secondsListened;
        playCounted = Number(existing[0].play_counted || 0);
      }

      // Check 2 minutes (120 seconds) listening threshold
      const maxListened = Math.max(newTotalListened, progressSeconds);
      const is2MinListened = maxListened >= 120 || (totalDurationSeconds > 0 && totalDurationSeconds < 120 && isCompleted);

      let shouldIncrementPlay = false;
      if (episodeId && !playCounted && is2MinListened) {
        shouldIncrementPlay = true;
        playCounted = 1;
      }

      if (existing.length > 0) {
        await pool.query(
          `UPDATE watch_histories 
           SET episode_id = ?, progress_seconds = ?, total_duration_seconds = ?, total_seconds_listened = ?, completion_percentage = ?, status = ?, completed = ?, play_counted = ?, last_watched_at = NOW()
           WHERE id = ?`,
          [episodeId || null, progressSeconds, totalDurationSeconds, newTotalListened, completionPercentage, finalStatus, isCompleted ? 1 : 0, playCounted, recordId]
        );
      } else {
        const [insertRes] = await pool.query(
          `INSERT INTO watch_histories 
           (user_id, story_id, episode_id, progress_seconds, total_duration_seconds, total_seconds_listened, completion_percentage, status, completed, play_counted, last_watched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [userId, storyId, episodeId || null, progressSeconds, totalDurationSeconds, newTotalListened, completionPercentage, finalStatus, isCompleted ? 1 : 0, playCounted]
        );
        recordId = insertRes.insertId;
      }

      if (shouldIncrementPlay) {
        await pool.query('UPDATE episodes SET plays_count = plays_count + 1 WHERE id = ?', [episodeId]);
        await pool.query('UPDATE stories SET total_views = total_views + 1, listeners_count = listeners_count + 1 WHERE id = ?', [storyId]);
      }

      // Record daily streak listening progress asynchronously
      if (secondsListened > 0) {
        StreakService.recordListeningTime(userId, secondsListened).catch((err) =>
          console.error('Streak auto-track error:', err)
        );
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
        episode_id
          ? 'SELECT id, total_seconds_listened, COALESCE(play_counted, 0) as play_counted FROM watch_histories WHERE user_id = ? AND story_id = ? AND episode_id = ? LIMIT 1'
          : 'SELECT id, total_seconds_listened, COALESCE(play_counted, 0) as play_counted FROM watch_histories WHERE user_id = ? AND story_id = ? AND episode_id IS NULL LIMIT 1',
        episode_id ? [userId, resolvedStoryId, episode_id] : [userId, resolvedStoryId]
      );

      let newTotal = secondsToAdd;
      let playCounted = 0;

      if (existing.length > 0) {
        newTotal = Number(existing[0].total_seconds_listened || 0) + secondsToAdd;
        playCounted = Number(existing[0].play_counted || 0);
      }

      const is2MinListened = newTotal >= 120;
      let shouldIncrementPlay = false;
      if (episode_id && !playCounted && is2MinListened) {
        shouldIncrementPlay = true;
        playCounted = 1;
      }

      if (existing.length > 0) {
        await pool.query(
          'UPDATE watch_histories SET total_seconds_listened = ?, play_counted = ?, last_watched_at = NOW() WHERE id = ?',
          [newTotal, playCounted, existing[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO watch_histories (user_id, story_id, episode_id, total_seconds_listened, play_counted, last_watched_at)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [userId, resolvedStoryId, episode_id || null, secondsToAdd, playCounted]
        );
      }

      if (shouldIncrementPlay) {
        await pool.query('UPDATE episodes SET plays_count = plays_count + 1 WHERE id = ?', [episode_id]);
        if (resolvedStoryId) {
          await pool.query('UPDATE stories SET total_views = total_views + 1, listeners_count = listeners_count + 1 WHERE id = ?', [resolvedStoryId]);
        }
      }

      // Record daily streak listening progress asynchronously
      if (secondsToAdd > 0) {
        StreakService.recordListeningTime(userId, secondsToAdd).catch((err) =>
          console.error('Streak auto-track error:', err)
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

      const [epRows] = await pool.query('SELECT story_id, COALESCE(duration_seconds, 0) as duration, COALESCE(position, 1) as episode_number, title FROM episodes WHERE id = ? LIMIT 1', [episodeId]);
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
          episode_number: Number(ep.episode_number || 1),
          episode_no: Number(ep.episode_number || 1),
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
        episode_number: Number(ep.episode_number || 1),
        episode_no: Number(ep.episode_number || 1),
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
        `SELECT w.*, e.title as episode_title, COALESCE(e.position, 1) as episode_position, COALESCE(e.duration_seconds, 0) as episode_duration
         FROM watch_histories w
         INNER JOIN episodes e ON w.episode_id = e.id
         WHERE w.user_id = ? AND w.story_id = ? AND w.episode_id IS NOT NULL
         ORDER BY COALESCE(w.last_watched_at, w.updated_at, w.created_at) DESC, w.id DESC
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
          episode_number: h.episode_position || 1,
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
   * POST /api/v1/episodes/:id/play-duration or POST /api/v1/episodes/play-duration
   * Update episode play duration for current user (current seconds out of total duration in integer)
   */
  static async updatePlayDuration(req, res) {
    try {
      const userId = req.user ? req.user.id : null;
      if (!userId) {
        return ApiResponse.error(res, 'Unauthenticated user.', 401);
      }

      const episodeId = req.params.id || req.params.episodeId || req.body.episode_id || req.body.episodeId;
      if (!episodeId) {
        return ApiResponse.error(res, 'Episode ID is required.', 422);
      }

      // Parse current seconds and total duration seconds as integers
      const rawCurrent = req.body.current_seconds ?? req.body.progress_seconds ?? req.body.played_seconds ?? req.body.current_duration ?? req.body.current_position ?? 0;
      const rawTotal = req.body.total_duration_seconds ?? req.body.total_duration ?? req.body.duration ?? req.body.total_seconds ?? 0;

      const currentSeconds = Math.max(0, parseInt(rawCurrent, 10) || 0);
      let totalDurationSeconds = Math.max(0, parseInt(rawTotal, 10) || 0);

      // Fetch episode details
      const [epRows] = await pool.query(
        'SELECT id, story_id, COALESCE(duration_seconds, 0) as duration, COALESCE(position, 1) as episode_number, title FROM episodes WHERE id = ? LIMIT 1',
        [episodeId]
      );

      if (epRows.length === 0) {
        return ApiResponse.error(res, 'Episode not found.', 404);
      }

      const episode = epRows[0];
      const storyId = episode.story_id;

      if (totalDurationSeconds === 0 && episode.duration > 0) {
        totalDurationSeconds = Number(episode.duration);
      }

      // Calculate completion percentage
      let completionPercentage = 0.0;
      if (totalDurationSeconds > 0) {
        completionPercentage = parseFloat(((currentSeconds / totalDurationSeconds) * 100).toFixed(2));
        if (completionPercentage > 100.0) completionPercentage = 100.0;
      }

      const isCompleted = completionPercentage >= 90.0 || req.body.completed === true || req.body.completed === 'true';
      const status = isCompleted ? 'completed' : (req.body.status ? String(req.body.status).toLowerCase() : 'playing');

      // Upsert into watch_histories
      const [existing] = await pool.query(
        'SELECT id, total_seconds_listened, COALESCE(play_counted, 0) as play_counted FROM watch_histories WHERE user_id = ? AND story_id = ? AND episode_id = ? LIMIT 1',
        [userId, storyId, episodeId]
      );

      let recordId;
      let playCounted = 0;
      let totalListenedSecs = currentSeconds;

      if (existing.length > 0) {
        recordId = existing[0].id;
        playCounted = Number(existing[0].play_counted || 0);
        totalListenedSecs = Math.max(Number(existing[0].total_seconds_listened || 0), currentSeconds);
      }

      const is2MinListened = totalListenedSecs >= 120 || (totalDurationSeconds > 0 && totalDurationSeconds < 120 && isCompleted);

      let shouldIncrementPlay = false;
      if (!playCounted && is2MinListened) {
        shouldIncrementPlay = true;
        playCounted = 1;
      }

      if (existing.length > 0) {
        await pool.query(
          `UPDATE watch_histories 
           SET episode_id = ?, progress_seconds = ?, total_duration_seconds = ?, completion_percentage = ?, status = ?, completed = ?, play_counted = ?, last_watched_at = NOW()
           WHERE id = ?`,
          [episodeId, currentSeconds, totalDurationSeconds, completionPercentage, status, isCompleted ? 1 : 0, playCounted, recordId]
        );
      } else {
        const [insertRes] = await pool.query(
          `INSERT INTO watch_histories 
           (user_id, story_id, episode_id, progress_seconds, total_duration_seconds, total_seconds_listened, completion_percentage, status, completed, play_counted, last_watched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [userId, storyId, episodeId, currentSeconds, totalDurationSeconds, currentSeconds, completionPercentage, status, isCompleted ? 1 : 0, playCounted]
        );
        recordId = insertRes.insertId;
      }

      if (shouldIncrementPlay) {
        await pool.query('UPDATE episodes SET plays_count = plays_count + 1 WHERE id = ?', [episodeId]);
        await pool.query('UPDATE stories SET total_views = total_views + 1, listeners_count = listeners_count + 1 WHERE id = ?', [storyId]);
      }

      return ApiResponse.success(res, {
        watch_history_id: Number(recordId),
        user_id: Number(userId),
        story_id: Number(storyId),
        episode_id: Number(episodeId),
        episode_number: Number(episode.episode_number || 1),
        episode_no: Number(episode.episode_number || 1),
        title: episode.title,
        current_seconds: currentSeconds,
        progress_seconds: currentSeconds,
        progress_formatted: formatTime(currentSeconds),
        total_duration_seconds: totalDurationSeconds,
        total_duration_formatted: formatTime(totalDurationSeconds),
        completion_percentage: completionPercentage,
        status: status,
        completed: isCompleted,
      }, 'Episode play duration updated successfully.');
    } catch (error) {
      console.error('Update Episode Play Duration Error:', error.message, error.stack);
      return ApiResponse.error(res, `Failed to update episode play duration: ${error.message}`, 500);
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
