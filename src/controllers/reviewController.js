const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

class ReviewController {
  static async index(req, res) {
    try {
      const storyId = req.params.id || req.params.story;
      const { page = 1, limit = 10 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const offset = (pageNum - 1) * limitNum;

      const [[statsRow]] = await pool.query(
        `SELECT 
           COUNT(*) as total_ratings,
           COALESCE(AVG(rating), 0) as average_rating,
           SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as five_star_count
         FROM reviews WHERE story_id = ?`,
        [storyId]
      );

      const totalRatings = Number(statsRow ? statsRow.total_ratings : 0);
      const avgRating = parseFloat(Number(statsRow ? statsRow.average_rating : 0).toFixed(1));
      const fiveStarCount = Number(statsRow ? statsRow.five_star_count : 0);

      const [reviews] = await pool.query(
        `SELECT r.*, u.name as user_name, u.avatar_path as user_avatar
         FROM reviews r
         JOIN users u ON r.user_id = u.id
         WHERE r.story_id = ?
         ORDER BY r.created_at DESC
         LIMIT ? OFFSET ?`,
        [storyId, limitNum, offset]
      );

      const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';

      const formattedReviews = reviews.map((r) => {
        let avatarUrl = null;
        if (r.user_avatar) {
          if (r.user_avatar.startsWith('http://') || r.user_avatar.startsWith('https://')) {
            avatarUrl = r.user_avatar;
          } else {
            avatarUrl = `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${r.user_avatar.replace(/^\//, '')}`;
          }
        }
        return {
          id: Number(r.id),
          user_id: Number(r.user_id),
          story_id: Number(r.story_id),
          rating: Number(r.rating),
          review: r.review,
          user_name: r.user_name || null,
          user_avatar: avatarUrl,
          user_image: avatarUrl,
          user_profile_image: avatarUrl,
          profile_image: avatarUrl,
          created_at: r.created_at,
          updated_at: r.updated_at,
        };
      });

      return ApiResponse.success(res, {
        reviews: formattedReviews,
        total_ratings: totalRatings,
        average_rating: avgRating,
        five_star_count: fiveStarCount,
        total: totalRatings,
        total_number: totalRatings,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(totalRatings / limitNum),
        pagination: {
          total: totalRatings,
          page: pageNum,
          limit: limitNum,
          total_pages: Math.ceil(totalRatings / limitNum),
        },
      });
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
      const { page = 1, limit = 10 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const offset = (pageNum - 1) * limitNum;

      const [[{ count }]] = await pool.query(
        'SELECT COUNT(*) as count FROM reviews WHERE user_id = ?',
        [userId]
      );

      const [reviews] = await pool.query(
        `SELECT r.*, s.title as story_title, u.name as user_name, u.avatar_path as user_avatar
         FROM reviews r
         JOIN stories s ON r.story_id = s.id
         JOIN users u ON r.user_id = u.id
         WHERE r.user_id = ?
         ORDER BY r.created_at DESC
         LIMIT ? OFFSET ?`,
        [userId, limitNum, offset]
      );

      const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';

      const formattedReviews = reviews.map((r) => {
        let avatarUrl = null;
        if (r.user_avatar) {
          if (r.user_avatar.startsWith('http://') || r.user_avatar.startsWith('https://')) {
            avatarUrl = r.user_avatar;
          } else {
            avatarUrl = `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${r.user_avatar.replace(/^\//, '')}`;
          }
        }
        return {
          id: Number(r.id),
          user_id: Number(r.user_id),
          story_id: Number(r.story_id),
          story_title: r.story_title,
          rating: Number(r.rating),
          review: r.review,
          user_name: r.user_name || null,
          user_avatar: avatarUrl,
          user_image: avatarUrl,
          user_profile_image: avatarUrl,
          profile_image: avatarUrl,
          created_at: r.created_at,
          updated_at: r.updated_at,
        };
      });

      return ApiResponse.success(res, {
        reviews: formattedReviews,
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
      console.error('User Reviews Error:', error);
      return ApiResponse.error(res, 'Failed to fetch user reviews.', 500);
    }
  }
}

module.exports = ReviewController;
