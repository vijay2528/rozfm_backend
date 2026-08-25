const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const { toStoryFieldsArray, toEpisodeFieldsArray } = require('../utils/storyPresenter');

class WatchHistoryController {
  static async index(req, res) {
    try {
      const userId = req.user.id;
      const [historyRows] = await pool.query(
        `SELECT w.*, s.title as story_title, s.cover_image_path, e.title as episode_title, e.position as episode_position
         FROM watch_histories w
         JOIN stories s ON w.story_id = s.id
         LEFT JOIN episodes e ON w.episode_id = e.id
         WHERE w.user_id = ?
         ORDER BY w.last_watched_at DESC`,
        [userId]
      );

      const history = historyRows.map((h) => ({
        id: Number(h.id),
        story_id: Number(h.story_id),
        episode_id: h.episode_id ? Number(h.episode_id) : null,
        story_title: h.story_title,
        episode_title: h.episode_title || null,
        episode_no: h.episode_position || 1,
        progress_seconds: Number(h.progress_seconds || 0),
        completed: Boolean(h.completed),
        last_watched_at: h.last_watched_at,
      }));

      return ApiResponse.success(res, { history });
    } catch (error) {
      console.error('List Watch History Error:', error);
      return ApiResponse.error(res, 'Failed to fetch watch history.', 500);
    }
  }

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
