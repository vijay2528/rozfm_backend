const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const PushNotificationService = require('../services/pushNotificationService');
const PushNotificationSettings = require('../services/pushNotificationSettings');

class CommentController {
  static async index(req, res) {
    try {
      const storyId = req.params.id || req.params.story;
      const userId = req.user ? req.user.id : null;
      const { page = 1, limit = 10 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const offset = (pageNum - 1) * limitNum;

      const [[{ count }]] = await pool.query(
        'SELECT COUNT(*) as count FROM comments WHERE story_id = ? AND parent_id IS NULL',
        [storyId]
      );

      const [[{ totalCommentsCount }]] = await pool.query(
        'SELECT COUNT(*) as totalCommentsCount FROM comments WHERE story_id = ?',
        [storyId]
      );

      const [comments] = await pool.query(
        `SELECT c.*, u.name as user_name, u.avatar_path as user_avatar,
                (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) as likes_count,
                (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id) as replies_count
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.story_id = ? AND c.parent_id IS NULL
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`,
        [storyId, limitNum, offset]
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
        story_id: Number(c.story_id),
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
      console.error('List Comments Error:', error);
      return ApiResponse.error(res, 'Failed to fetch comments.', 500);
    }
  }

  static async store(req, res) {
    try {
      const storyId = req.params.id || req.params.story;
      const userId = req.user.id;
      const { comment, parent_id } = req.body;

      if (!comment || comment.trim() === '') {
        return ApiResponse.error(res, 'Comment text is required.', 422);
      }

      const [story] = await pool.query('SELECT id FROM stories WHERE id = ? LIMIT 1', [storyId]);
      if (story.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 404);
      }

      const [result] = await pool.query(
        'INSERT INTO comments (user_id, story_id, parent_id, comment) VALUES (?, ?, ?, ?)',
        [userId, storyId, parent_id || null, comment.trim()]
      );

      // ── Push: new comment on story ────────────────────────────────────────
      PushNotificationSettings.isEnabled('push_notify_new_comment').then((on) => {
        if (!on) return;
        pool.query(
          'SELECT s.user_id AS author_id, s.title, u.name AS commenter_name FROM stories s JOIN users u ON u.id = ? WHERE s.id = ? LIMIT 1',
          [userId, storyId]
        ).then(([rows]) => {
          if (!rows.length) return;
          const { author_id, title: storyTitle, commenter_name } = rows[0];
          if (Number(author_id) === Number(userId)) return; // skip self-comment
          PushNotificationService.sendToUser(
            Number(author_id),
            '💬 New Comment',
            `${commenter_name} commented on "${storyTitle}"`,
            { action_type: 'story', action_id: String(storyId) }
          ).catch(() => {});
        }).catch(() => {});
      }).catch(() => {});

      return ApiResponse.success(
        res,
        { comment_id: result.insertId, comment: comment.trim() },
        'Comment posted successfully.'
      );
    } catch (error) {
      console.error('Post Comment Error:', error);
      return ApiResponse.error(res, 'Failed to post comment.', 500);
    }
  }

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
      console.error('List Replies Error:', error);
      return ApiResponse.error(res, 'Failed to fetch replies.', 500);
    }
  }

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
      console.error('Toggle Comment Like Error:', error);
      return ApiResponse.error(res, 'Failed to update comment like status.', 500);
    }
  }

  static async update(req, res) {
    try {
      const commentId =
        req.params.commentId ||
        (req.params.storyId ? req.params.id : null) ||
        req.params.comment ||
        req.body?.comment_id ||
        req.query?.comment_id ||
        req.params.id;
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

      // If story ID was specified in route params, verify it matches
      const routeStoryId = req.params.storyId || (req.params.commentId ? req.params.id : null);
      if (routeStoryId && Number(commentRecord.story_id) !== Number(routeStoryId)) {
        return ApiResponse.error(res, 'Comment does not belong to this story.', 400);
      }

      // Only the author of the comment can edit it
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
          story_id: Number(commentRecord.story_id),
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
      console.error('Update Comment Error:', error);
      return ApiResponse.error(res, 'Failed to update comment.', 500);
    }
  }

  static async destroy(req, res) {
    try {
      const commentId =
        req.params.commentId ||
        (req.params.storyId ? req.params.id : null) ||
        req.params.comment ||
        req.body?.comment_id ||
        req.query?.comment_id ||
        req.params.id;
      const userId = req.user.id;

      if (!commentId) {
        return ApiResponse.error(res, 'Comment ID is required.', 422);
      }

      const [rows] = await pool.query(
        `SELECT c.*, s.user_id as story_author_id 
         FROM comments c 
         LEFT JOIN stories s ON c.story_id = s.id 
         WHERE c.id = ? LIMIT 1`,
        [commentId]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Comment not found.', 404);
      }

      const commentRecord = rows[0];

      // If story ID was specified in route params, verify it matches
      const routeStoryId = req.params.storyId || (req.params.commentId ? req.params.id : null);
      if (routeStoryId && Number(commentRecord.story_id) !== Number(routeStoryId)) {
        return ApiResponse.error(res, 'Comment does not belong to this story.', 400);
      }

      // Check authorization: comment owner OR story owner can delete
      const isCommentAuthor = Number(commentRecord.user_id) === Number(userId);
      const isStoryAuthor = Number(commentRecord.story_author_id) === Number(userId);

      if (!isCommentAuthor && !isStoryAuthor) {
        return ApiResponse.error(res, 'You are not authorized to delete this comment.', 403);
      }

      // Delete replies and likes to prevent orphaned records
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
          story_id: Number(commentRecord.story_id),
        },
        'Comment deleted successfully.'
      );
    } catch (error) {
      console.error('Delete Comment Error:', error);
      return ApiResponse.error(res, 'Failed to delete comment.', 500);
    }
  }
}

module.exports = CommentController;
