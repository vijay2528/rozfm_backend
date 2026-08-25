const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

class ReviewController {
  static async index(req, res) {
    try {
      const storyId = req.params.id || req.params.story;
      const [reviews] = await pool.query(
        `SELECT r.*, u.name as user_name, u.avatar_path as user_avatar
         FROM reviews r
         JOIN users u ON r.user_id = u.id
         WHERE r.story_id = ?
         ORDER BY r.created_at DESC`,
        [storyId]
      );

      return ApiResponse.success(res, { reviews });
    } catch (error) {
      console.error('List Reviews Error:', error);
      return ApiResponse.error(res, 'Failed to fetch reviews.', 500);
    }
  }

  static async store(req, res) {
    try {
      const storyId = req.params.id || req.params.story;
      const userId = req.user.id;
      const { rating, review } = req.body;

      if (!rating || rating < 1 || rating > 5) {
        return ApiResponse.error(res, 'Rating must be between 1 and 5 stars.', 422);
      }

      await pool.query(
        `INSERT INTO reviews (user_id, story_id, rating, review)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE rating = VALUES(rating), review = VALUES(review), updated_at = NOW()`,
        [userId, storyId, rating, review || null]
      );

      // Recalculate story rating
      const [avgRow] = await pool.query(
        'SELECT AVG(rating) as avg_rating FROM reviews WHERE story_id = ?',
        [storyId]
      );
      const newRating = Number((avgRow[0].avg_rating || 0).toFixed(1));
      await pool.query('UPDATE stories SET rating = ? WHERE id = ?', [newRating, storyId]);

      return ApiResponse.success(res, { rating: newRating }, 'Review submitted successfully.');
    } catch (error) {
      console.error('Submit Review Error:', error);
      return ApiResponse.error(res, 'Failed to submit review.', 500);
    }
  }

  static async userReviews(req, res) {
    try {
      const userId = req.user.id;
      const [reviews] = await pool.query(
        `SELECT r.*, s.title as story_title
         FROM reviews r
         JOIN stories s ON r.story_id = s.id
         WHERE r.user_id = ?
         ORDER BY r.created_at DESC`,
        [userId]
      );

      return ApiResponse.success(res, { reviews });
    } catch (error) {
      console.error('User Reviews Error:', error);
      return ApiResponse.error(res, 'Failed to fetch user reviews.', 500);
    }
  }
}

module.exports = ReviewController;
