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

      const numericRating = Number(rating);
      if (!rating || isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
        return ApiResponse.error(res, 'Rating must be between 1 and 5 stars.', 422);
      }

      // Check if story exists
      const [stories] = await pool.query('SELECT id FROM stories WHERE id = ? LIMIT 1', [storyId]);
      if (stories.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 404);
      }

      // Check if review already exists for this user and story
      const [existing] = await pool.query(
        'SELECT id FROM reviews WHERE user_id = ? AND story_id = ? LIMIT 1',
        [userId, storyId]
      );

      if (existing.length > 0) {
        await pool.query(
          'UPDATE reviews SET rating = ?, review = ?, updated_at = NOW() WHERE user_id = ? AND story_id = ?',
          [numericRating, review || null, userId, storyId]
        );
      } else {
        await pool.query(
          'INSERT INTO reviews (user_id, story_id, rating, review) VALUES (?, ?, ?, ?)',
          [userId, storyId, numericRating, review || null]
        );
      }

      // Recalculate story rating
      const [avgRow] = await pool.query(
        'SELECT AVG(rating) as avg_rating FROM reviews WHERE story_id = ?',
        [storyId]
      );
      const rawAvg = parseFloat(avgRow[0].avg_rating) || 0;
      const newRating = Number(rawAvg.toFixed(1));
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
