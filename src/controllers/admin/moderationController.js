const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

class ModerationController {
  // ── Reviews Moderation ──────────────────────────────────────────────────

  static async listReviews(req, res) {
    try {
      const { story_id, page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

      let whereClauses = ['1=1'];
      let queryParams = [];

      if (story_id) {
        whereClauses.push('r.story_id = ?');
        queryParams.push(story_id);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ count }]] = await pool.query(`SELECT COUNT(*) as count FROM reviews r ${whereSql}`, queryParams);

      const [reviews] = await pool.query(
        `SELECT r.*, u.name as user_name, u.email as user_email, s.title as story_title
         FROM reviews r
         LEFT JOIN users u ON r.user_id = u.id
         LEFT JOIN stories s ON r.story_id = s.id
         ${whereSql}
         ORDER BY r.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ApiResponse.success(res, {
        reviews,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('Admin List Reviews Error:', error);
      return ApiResponse.error(res, 'Failed to fetch reviews list.', 500);
    }
  }

  static async deleteReview(req, res) {
    try {
      const reviewId = req.params.id;

      const [revRows] = await pool.query('SELECT * FROM reviews WHERE id = ? LIMIT 1', [reviewId]);
      if (revRows.length === 0) {
        return ApiResponse.error(res, 'Review not found.', 444);
      }

      const storyId = revRows[0].story_id;

      await pool.query('DELETE FROM reviews WHERE id = ?', [reviewId]);

      // Recalculate story average rating
      const [[{ avg_rating }]] = await pool.query(
        'SELECT COALESCE(AVG(rating), 0.0) as avg_rating FROM reviews WHERE story_id = ?',
        [storyId]
      );
      await pool.query('UPDATE stories SET rating = ? WHERE id = ?', [parseFloat(Number(avg_rating).toFixed(1)), storyId]);

      return ApiResponse.success(res, { review_id: Number(reviewId) }, 'Review deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Review Error:', error);
      return ApiResponse.error(res, 'Failed to delete review.', 500);
    }
  }

  // ── Comments Moderation ──────────────────────────────────────────────────

  static async listComments(req, res) {
    try {
      const { story_id, page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

      let whereClauses = ['1=1'];
      let queryParams = [];

      if (story_id) {
        whereClauses.push('c.story_id = ?');
        queryParams.push(story_id);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ count }]] = await pool.query(`SELECT COUNT(*) as count FROM comments c ${whereSql}`, queryParams);

      const [comments] = await pool.query(
        `SELECT c.*, u.name as user_name, u.email as user_email, s.title as story_title
         FROM comments c
         LEFT JOIN users u ON c.user_id = u.id
         LEFT JOIN stories s ON c.story_id = s.id
         ${whereSql}
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ApiResponse.success(res, {
        comments,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('Admin List Comments Error:', error);
      return ApiResponse.error(res, 'Failed to fetch comments list.', 500);
    }
  }

  static async deleteComment(req, res) {
    try {
      const commentId = req.params.id;

      const [commRows] = await pool.query('SELECT * FROM comments WHERE id = ? LIMIT 1', [commentId]);
      if (commRows.length === 0) {
        return ApiResponse.error(res, 'Comment not found.', 444);
      }

      await pool.query('DELETE FROM comments WHERE id = ?', [commentId]);

      return ApiResponse.success(res, { comment_id: Number(commentId) }, 'Comment deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Comment Error:', error);
      return ApiResponse.error(res, 'Failed to delete comment.', 500);
    }
  }
}

module.exports = ModerationController;
