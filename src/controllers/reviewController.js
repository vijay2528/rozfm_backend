const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const PushNotificationService = require('../services/pushNotificationService');
const PushNotificationSettings = require('../services/pushNotificationSettings');

let reviewRepliesTableChecked = false;
async function ensureRepliesTable() {
  if (reviewRepliesTableChecked) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`review_replies\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`review_id\` BIGINT UNSIGNED NOT NULL,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`reply\` TEXT NOT NULL,
        \`created_at\` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_review_replies_review_id\` (\`review_id\`),
        INDEX \`idx_review_replies_user_id\` (\`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    reviewRepliesTableChecked = true;
  } catch (_) { }
}

class ReviewController {
  static async index(req, res) {
    try {
      await ensureRepliesTable();
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
        `SELECT r.*, u.name as user_name, u.avatar_path as user_avatar,
                (SELECT COUNT(*) FROM review_replies rr WHERE rr.review_id = r.id) as replies_count
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
          replies_count: Number(r.replies_count || 0),
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

      // ── Push Notification: new review on story ───────────────────────────
      PushNotificationSettings.isEnabled('push_notify_new_review').then((on) => {
        if (!on) return;
        pool.query(
          'SELECT s.user_id as author_id, s.title, u.name as reviewer_name FROM stories s JOIN users u ON u.id = ? WHERE s.id = ? LIMIT 1',
          [userId, storyId]
        ).then(([storyRows]) => {
          if (!storyRows.length) return;
          const { author_id, title: storyTitle, reviewer_name } = storyRows[0];
          if (Number(author_id) === Number(userId)) return; // skip self-review
          PushNotificationService.sendReviewNotification({
            recipientUserId: Number(author_id),
            storyId,
            storyTitle,
            reviewerName: reviewer_name,
            rating: numericRating,
          }).catch(() => { });
        }).catch(() => { });
      }).catch(() => { });

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

  /**
   * GET /api/v1/reviews/:id/replies
   * GET /api/v1/stories/:storyId/reviews/:reviewId/replies
   * List paginated replies for a specific story review.
   */
  static async replies(req, res) {
    try {
      await ensureRepliesTable();
      const reviewId = req.params.reviewId || req.params.id || req.params.review;
      const { page = 1, limit = 10 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const offset = (pageNum - 1) * limitNum;

      if (!reviewId) {
        return ApiResponse.error(res, 'Review ID is required.', 422);
      }

      const [reviewRows] = await pool.query('SELECT id, story_id FROM reviews WHERE id = ? LIMIT 1', [reviewId]);
      if (reviewRows.length === 0) {
        return ApiResponse.error(res, 'Review not found.', 404);
      }

      const [[{ count }]] = await pool.query(
        'SELECT COUNT(*) as count FROM review_replies WHERE review_id = ?',
        [reviewId]
      );

      const [replies] = await pool.query(
        `SELECT rr.*, u.name as user_name, u.avatar_path as user_avatar
         FROM review_replies rr
         JOIN users u ON rr.user_id = u.id
         WHERE rr.review_id = ?
         ORDER BY rr.created_at ASC
         LIMIT ? OFFSET ?`,
        [reviewId, limitNum, offset]
      );

      const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';

      const formattedReplies = replies.map((r) => {
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
          reply_id: Number(r.id),
          review_id: Number(r.review_id),
          user_id: Number(r.user_id),
          user_name: r.user_name || null,
          user_avatar: avatarUrl,
          user_image: avatarUrl,
          profile_image: avatarUrl,
          reply: r.reply,
          comment: r.reply,
          created_at: r.created_at,
          updated_at: r.updated_at,
        };
      });

      return ApiResponse.success(res, {
        replies: formattedReplies,
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
      console.error('List Review Replies Error:', error);
      return ApiResponse.error(res, 'Failed to fetch review replies.', 500);
    }
  }

  /**
   * POST /api/v1/reviews/:id/replies
   * POST /api/v1/stories/:storyId/reviews/:reviewId/replies
   * POST /api/v1/reviews/:id/reply
   * Post a reply to a story review.
   * Body: { reply } (or { comment })
   */
  static async storeReply(req, res) {
    try {
      await ensureRepliesTable();
      const reviewId = req.params.reviewId || req.params.id || req.params.review;
      const userId = req.user.id;
      const { reply, comment } = req.body;
      const replyText = reply || comment;

      if (!reviewId) {
        return ApiResponse.error(res, 'Review ID is required.', 422);
      }

      if (!replyText || typeof replyText !== 'string' || replyText.trim() === '') {
        return ApiResponse.error(res, 'Reply text is required.', 422);
      }

      const [reviewRows] = await pool.query(
        `SELECT r.id, r.user_id as review_author_id, r.story_id, s.title as story_title
         FROM reviews r
         LEFT JOIN stories s ON r.story_id = s.id
         WHERE r.id = ? LIMIT 1`,
        [reviewId]
      );

      if (reviewRows.length === 0) {
        return ApiResponse.error(res, 'Review not found.', 404);
      }

      const review = reviewRows[0];
      const trimmedReply = replyText.trim();

      const [result] = await pool.query(
        'INSERT INTO review_replies (review_id, user_id, reply) VALUES (?, ?, ?)',
        [reviewId, userId, trimmedReply]
      );

      // Fetch user info for response
      const [userRows] = await pool.query('SELECT name, avatar_path FROM users WHERE id = ? LIMIT 1', [userId]);
      const user = userRows[0] || {};
      const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';
      let avatarUrl = null;
      if (user.avatar_path) {
        if (user.avatar_path.startsWith('http://') || user.avatar_path.startsWith('https://')) {
          avatarUrl = user.avatar_path;
        } else {
          avatarUrl = `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${user.avatar_path.replace(/^\//, '')}`;
        }
      }

      // ── Push notification: reply on review → notify review author ──
      PushNotificationSettings.isEnabled('push_notify_new_review').then((on) => {
        if (!on) return;
        const recipientUserId = review.review_author_id;
        if (!recipientUserId || Number(recipientUserId) === Number(userId)) return; // skip self-reply

        const replierName = user.name || 'Someone';
        const snippet = trimmedReply.length > 50 ? trimmedReply.substring(0, 47) + '...' : trimmedReply;

        PushNotificationService.sendToUser(
          Number(recipientUserId),
          'New Reply on your Review 💬',
          `${replierName} replied: '${snippet}'`,
          {
            type: 'review',
            action_type: 'review',
            action_id: String(review.story_id),
            story_id: String(review.story_id),
            review_id: String(reviewId),
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          }
        ).catch(() => { });
      }).catch(() => { });

      return ApiResponse.success(
        res,
        {
          id: result.insertId,
          reply_id: result.insertId,
          review_id: Number(reviewId),
          user_id: Number(userId),
          user_name: user.name || null,
          user_avatar: avatarUrl,
          reply: trimmedReply,
          created_at: new Date(),
        },
        'Reply posted successfully.'
      );
    } catch (error) {
      console.error('Post Review Reply Error:', error);
      return ApiResponse.error(res, 'Failed to post reply.', 500);
    }
  }

  /**
   * DELETE /api/v1/reviews/:reviewId/replies/:replyId
   * DELETE /api/v1/review-replies/:id
   * Delete a review reply. Allowed for: reply author OR story author OR review owner.
   */
  static async destroyReply(req, res) {
    try {
      await ensureRepliesTable();
      const replyId = req.params.replyId || req.params.id;
      const userId = req.user.id;

      if (!replyId) {
        return ApiResponse.error(res, 'Reply ID is required.', 422);
      }

      const [rows] = await pool.query(
        `SELECT rr.*, r.user_id as review_author_id, s.user_id as story_author_id
         FROM review_replies rr
         JOIN reviews r ON rr.review_id = r.id
         LEFT JOIN stories s ON r.story_id = s.id
         WHERE rr.id = ? LIMIT 1`,
        [replyId]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Reply not found.', 404);
      }

      const replyRecord = rows[0];
      const isReplyAuthor = Number(replyRecord.user_id) === Number(userId);
      const isStoryAuthor = Number(replyRecord.story_author_id) === Number(userId);
      const isReviewAuthor = Number(replyRecord.review_author_id) === Number(userId);

      if (!isReplyAuthor && !isStoryAuthor && !isReviewAuthor) {
        return ApiResponse.error(res, 'You are not authorized to delete this reply.', 403);
      }

      await pool.query('DELETE FROM review_replies WHERE id = ?', [replyId]);

      return ApiResponse.success(
        res,
        {
          id: Number(replyId),
          reply_id: Number(replyId),
          review_id: Number(replyRecord.review_id),
        },
        'Reply deleted successfully.'
      );
    } catch (error) {
      console.error('Delete Review Reply Error:', error);
      return ApiResponse.error(res, 'Failed to delete reply.', 500);
    }
  }
}

module.exports = ReviewController;
