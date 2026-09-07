const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const { toStoryFieldsArray } = require('../utils/storyPresenter');

class BookmarkController {
  static async index(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const offset = (pageNum - 1) * limitNum;

      const [[{ count }]] = await pool.query(
        'SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ?',
        [userId]
      );

      const [stories] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name
         FROM bookmarks b
         JOIN stories s ON b.story_id = s.id
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE b.user_id = ?
         ORDER BY b.created_at DESC
         LIMIT ? OFFSET ?`,
        [userId, limitNum, offset]
      );

      const result = stories.map((s) =>
        toStoryFieldsArray(s, { isBookmarked: true })
      );

      return ApiResponse.success(res, {
        bookmarks: result,
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
      console.error('List Bookmarks Error:', error);
      return ApiResponse.error(res, 'Failed to fetch bookmarks.', 500);
    }
  }

  static async toggle(req, res) {
    try {
      const storyId = req.params.id || req.params.story;
      const userId = req.user.id;

      const [story] = await pool.query('SELECT id FROM stories WHERE id = ? LIMIT 1', [storyId]);
      if (story.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 404);
      }

      const [existing] = await pool.query(
        'SELECT id FROM bookmarks WHERE user_id = ? AND story_id = ? LIMIT 1',
        [userId, storyId]
      );

      let isBookmarked = false;
      if (existing.length > 0) {
        await pool.query('DELETE FROM bookmarks WHERE user_id = ? AND story_id = ?', [userId, storyId]);
        isBookmarked = false;
      } else {
        await pool.query('INSERT INTO bookmarks (user_id, story_id) VALUES (?, ?)', [userId, storyId]);
        isBookmarked = true;
      }

      return ApiResponse.success(
        res,
        { is_bookmarked: isBookmarked },
        isBookmarked ? 'Story bookmarked.' : 'Bookmark removed.'
      );
    } catch (error) {
      console.error('Toggle Bookmark Error:', error);
      return ApiResponse.error(res, 'Failed to update bookmark status.', 500);
    }
  }
}

module.exports = BookmarkController;
