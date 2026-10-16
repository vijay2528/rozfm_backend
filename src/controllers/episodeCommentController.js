const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const PushNotificationService = require('../services/pushNotificationService');
const PushNotificationSettings = require('../services/pushNotificationSettings');

/**
 * EpisodeCommentController
 * Handles CRUD and like/unlike for comments scoped to an episode.
 * Uses the same `comments` and `comment_likes` tables as story comments,
 * but filters / inserts by `episode_id` instead of `story_id`.
 */
class EpisodeCommentController {
  /**
   * GET /api/v1/episodes/:episodeId/comments
   * List top-level comments for a specific episode (paginated).
   */
  static async index(req, res) {
    try {
      const episodeId = req.params.episodeId || req.params.id;
      const userId = req.user ? req.user.id : null;
      const { page = 1, limit = 10 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const offset = (pageNum - 1) * limitNum;

      // Verify episode exists
      const [epRows] = await pool.query('SELECT id FROM episodes WHERE id = ? LIMIT 1', [episodeId]);
      if (epRows.length === 0) {
        return ApiResponse.error(res, 'Episode not found.', 404);
      }

      // Count top-level comments for the episode
      const [[{ count }]] = await pool.query(
        'SELECT COUNT(*) as count FROM comments WHERE episode_id = ? AND parent_id IS NULL',
        [episodeId]
      );

      // Count all comments (including replies) for the episode
      const [[{ totalCommentsCount }]] = await pool.query(
        'SELECT COUNT(*) as totalCommentsCount FROM comments WHERE episode_id = ?',
        [episodeId]
      );

      const [comments] = await pool.query(
        `SELECT c.*, u.name as user_name, u.avatar_path as user_avatar,
                (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) as likes_count,
                (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id) as replies_count
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.episode_id = ? AND c.parent_id IS NULL
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`,
        [episodeId, limitNum, offset]
      );

      let userLikedIds = new Set();
      if (userId && comments.length > 0) {
        const commentIds = comments.map((c) => c.id);
        const [likes] = await pool.query(
          'SELECT comment_id FROM comment_likes WHERE user_id = ? AND comment_id IN (?)',
          [userId, commentIds]
        );
        likes.forEach((l) => userLikedIds.add(l.comment_id));
      }

      const result = comments.map((c) => ({
        id: Number(c.id),
        episode_id: Number(c.episode_id),
        user_id: Number(c.user_id),
        user_name: c.user_name,
        user_avatar: c.user_avatar || null,
        comment: c.comment,
        likes_count: Number(c.likes_count || 0),
        replies_count: Number(c.replies_count || 0),
        is_liked: userLikedIds.has(c.id),
        created_at: c.created_at,
      }));

      const totalAll = Number(totalCommentsCount || 0);

      return ApiResponse.success(res, {
        comments: result,
        total_comments_count: totalAll,
        total_comments: totalAll,
        comments_count: totalAll,
        total: count,
        total_number: count,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(count / limitNum),
        pagination: {
          total: count,
          total_comments_count: totalAll,
          page: pageNum,
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('List Episode Comments Error:', error);
      return ApiResponse.error(res, 'Failed to fetch episode comments.', 500);
    }
  }

  /**
   * POST /api/v1/episodes/:episodeId/comments
   * Post a new comment (or reply) on an episode.
   * Body: { comment, parent_id? }
   */
  static async store(req, res) {
    try {
      const episodeId = req.params.episodeId || req.params.id;
      const userId = req.user.id;
      const { comment, parent_id } = req.body;

      if (!comment || comment.trim() === '') {
        return ApiResponse.error(res, 'Comment text is required.', 422);
      }

      // Verify episode exists and fetch related story info for push notification
      const [epRows] = await pool.query(
        `SELECT e.id, e.title, e.story_id, s.user_id AS story_author_id, s.title AS story_title
         FROM episodes e
         LEFT JOIN stories s ON s.id = e.story_id
         WHERE e.id = ? LIMIT 1`,
        [episodeId]
      );
      if (epRows.length === 0) {
        return ApiResponse.error(res, 'Episode not found.', 404);
      }

      const episode = epRows[0];

      const [result] = await pool.query(
        'INSERT INTO comments (user_id, episode_id, parent_id, comment) VALUES (?, ?, ?, ?)',
        [userId, episodeId, parent_id || null, comment.trim()]
      );

      // ── Push notification: new comment on episode → notify story/episode author ──
      PushNotificationSettings.isEnabled('push_notify_new_comment').then((on) => {
        if (!on) return;
        const authorId = episode.story_author_id;
        if (!authorId || Number(authorId) === Number(userId)) return; // skip self-comment

        pool.query('SELECT name FROM users WHERE id = ? LIMIT 1', [userId])
          .then(([userRows]) => {
            if (!userRows.length) return;
            const commenterName = userRows[0].name;
            PushNotificationService.sendToUser(
              Number(authorId),
              '💬 New Comment',
              `${commenterName} commented on episode "${episode.title}"`,
              { action_type: 'episode', action_id: String(episodeId), story_id: String(episode.story_id || '') }
            ).catch(() => {});
          })
          .catch(() => {});
      }).catch(() => {});

      return ApiResponse.success(
        res,
        { comment_id: result.insertId, comment: comment.trim() },
        'Comment posted successfully.'
      );
    } catch (error) {
      console.error('Post Episode Comment Error:', error);
      return ApiResponse.error(res, 'Failed to post comment.', 500);
    }
  }

  /**
   * GET /api/v1/comments/:id/replies
   * List paginated replies for a given comment (reusable for both story and episode comments).
   * Already handled in CommentController.replies — this method mirrors it for consistency.
   */
  static async replies(req, res) {
    try {
      const commentId = req.params.id || req.params.comment;
      const { page = 1, limit = 10 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const offset = (pageNum - 1) * limitNum;

      const [[{ count }]] = await pool.query(
        'SELECT COUNT(*) as count FROM comments WHERE parent_id = ?',
        [commentId]
      );

      const [replies] = await pool.query(
        `SELECT c.*, u.name as user_name, u.avatar_path as user_avatar
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.parent_id = ?
         ORDER BY c.created_at ASC
         LIMIT ? OFFSET ?`,
        [commentId, limitNum, offset]
      );

      return ApiResponse.success(res, {
        replies,
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
      console.error('List Episode Comment Replies Error:', error);
      return ApiResponse.error(res, 'Failed to fetch replies.', 500);
    }
  }

  /**
   * POST /api/v1/comments/:id/like  (same endpoint works for both story & episode comments)
   * Toggle like/unlike on any comment by ID.
   */
  static async toggleLike(req, res) {
    try {
      const commentId = req.params.id || req.params.comment;
      const userId = req.user.id;

      const [existing] = await pool.query(
        'SELECT id FROM comment_likes WHERE user_id = ? AND comment_id = ? LIMIT 1',
        [userId, commentId]
      );

      let isLiked = false;
      if (existing.length > 0) {
        await pool.query('DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?', [userId, commentId]);
        isLiked = false;
      } else {
        await pool.query('INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)', [userId, commentId]);
        isLiked = true;
      }

      return ApiResponse.success(res, { is_liked: isLiked }, isLiked ? 'Comment liked.' : 'Comment unliked.');
    } catch (error) {
      console.error('Toggle Episode Comment Like Error:', error);
      return ApiResponse.error(res, 'Failed to update comment like status.', 500);
    }
  }

  /**
   * POST/PUT /api/v1/episodes/:episodeId/comments/:commentId
   * Update (edit) an existing episode comment. Only the comment author can edit.
   */
  static async update(req, res) {
    try {
      const episodeId = req.params.episodeId || req.params.id;
      const commentId = req.params.commentId || req.params.comment;
      const userId = req.user.id;
      const { comment } = req.body;

      if (!commentId) {
        return ApiResponse.error(res, 'Comment ID is required.', 422);
      }

      if (!comment || typeof comment !== 'string' || comment.trim() === '') {
        return ApiResponse.error(res, 'Comment text is required.', 422);
      }

      const [rows] = await pool.query('SELECT * FROM comments WHERE id = ? LIMIT 1', [commentId]);
      if (rows.length === 0) {
        return ApiResponse.error(res, 'Comment not found.', 404);
      }

      const commentRecord = rows[0];

      // Verify comment belongs to this episode
      if (episodeId && Number(commentRecord.episode_id) !== Number(episodeId)) {
        return ApiResponse.error(res, 'Comment does not belong to this episode.', 400);
      }

      // Only the comment author can edit
      if (Number(commentRecord.user_id) !== Number(userId)) {
        return ApiResponse.error(res, 'You are not authorized to edit this comment.', 403);
      }

      const trimmedComment = comment.trim();
      await pool.query('UPDATE comments SET comment = ?, updated_at = NOW() WHERE id = ?', [
        trimmedComment,
        commentId,
      ]);

      const [updatedRows] = await pool.query(
        `SELECT c.*, u.name as user_name, u.avatar_path as user_avatar,
                (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) as likes_count,
                (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id) as replies_count
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.id = ? LIMIT 1`,
        [commentId]
      );

      const updated = updatedRows[0] || {};

      return ApiResponse.success(
        res,
        {
          id: Number(commentId),
          comment_id: Number(commentId),
          episode_id: Number(commentRecord.episode_id),
          parent_id: commentRecord.parent_id ? Number(commentRecord.parent_id) : null,
          user_id: Number(userId),
          user_name: updated.user_name || null,
          user_avatar: updated.user_avatar || null,
          comment: trimmedComment,
          likes_count: Number(updated.likes_count || 0),
          replies_count: Number(updated.replies_count || 0),
          created_at: commentRecord.created_at,
          updated_at: updated.updated_at || new Date(),
        },
        'Comment updated successfully.'
      );
    } catch (error) {
      console.error('Update Episode Comment Error:', error);
      return ApiResponse.error(res, 'Failed to update comment.', 500);
    }
  }

  /**
   * DELETE /api/v1/episodes/:episodeId/comments/:commentId
   * Delete an episode comment. Allowed for: comment author OR episode's story author.
   */
  static async destroy(req, res) {
    try {
      const episodeId = req.params.episodeId || req.params.id;
      const commentId = req.params.commentId || req.params.comment;
      const userId = req.user.id;

      if (!commentId) {
        return ApiResponse.error(res, 'Comment ID is required.', 422);
      }

      const [rows] = await pool.query(
        `SELECT c.*, s.user_id as story_author_id
         FROM comments c
         LEFT JOIN episodes ep ON c.episode_id = ep.id
         LEFT JOIN stories s ON ep.story_id = s.id
         WHERE c.id = ? LIMIT 1`,
        [commentId]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Comment not found.', 404);
      }

      const commentRecord = rows[0];

      // Verify comment belongs to this episode
      if (episodeId && Number(commentRecord.episode_id) !== Number(episodeId)) {
        return ApiResponse.error(res, 'Comment does not belong to this episode.', 400);
      }

      // Check authorization: comment owner OR story author can delete
      const isCommentAuthor = Number(commentRecord.user_id) === Number(userId);
      const isStoryAuthor = Number(commentRecord.story_author_id) === Number(userId);

      if (!isCommentAuthor && !isStoryAuthor) {
        return ApiResponse.error(res, 'You are not authorized to delete this comment.', 403);
      }

      // Delete replies and their likes first to prevent orphaned records
      const [replies] = await pool.query('SELECT id FROM comments WHERE parent_id = ?', [commentId]);
      if (replies.length > 0) {
        const replyIds = replies.map((r) => r.id);
        await pool.query('DELETE FROM comment_likes WHERE comment_id IN (?)', [replyIds]);
        await pool.query('DELETE FROM comments WHERE parent_id = ?', [commentId]);
      }
      await pool.query('DELETE FROM comment_likes WHERE comment_id = ?', [commentId]);
      await pool.query('DELETE FROM comments WHERE id = ?', [commentId]);

      return ApiResponse.success(
        res,
        {
          id: Number(commentId),
          comment_id: Number(commentId),
          episode_id: Number(commentRecord.episode_id),
        },
        'Comment deleted successfully.'
      );
    } catch (error) {
      console.error('Delete Episode Comment Error:', error);
      return ApiResponse.error(res, 'Failed to delete comment.', 500);
    }
  }
}

module.exports = EpisodeCommentController;
