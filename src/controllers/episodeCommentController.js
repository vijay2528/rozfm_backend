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
   * Supports optional story_id filter (?story_id=... or route param).
   */
  static async index(req, res) {
    try {
      const episodeId = req.params.episodeId || req.params.id || req.query.episode_id || req.query.episodeId;
      const userId = req.user ? req.user.id : null;
      const { page = 1, limit = 10, story_id, storyId } = req.query;
      const targetStoryId = story_id || storyId || req.params.storyId || req.params.story_id;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const offset = (pageNum - 1) * limitNum;

      if (!episodeId && !targetStoryId) {
        return ApiResponse.error(res, 'Episode ID or Story ID is required.', 422);
      }

      let episode = null;
      // Verify episode exists if episodeId is provided
      if (episodeId) {
        const [epRows] = await pool.query('SELECT id, story_id FROM episodes WHERE id = ? LIMIT 1', [episodeId]);
        if (epRows.length === 0) {
          return ApiResponse.error(res, 'Episode not found.', 404);
        }
        episode = epRows[0];
      }

      // Verify story exists if targetStoryId is provided
      if (targetStoryId) {
        const [storyRows] = await pool.query('SELECT id FROM stories WHERE id = ? LIMIT 1', [targetStoryId]);
        if (storyRows.length === 0) {
          return ApiResponse.error(res, 'Story not found.', 404);
        }
      }

      // Build where conditions
      const whereConditions = ['c.parent_id IS NULL'];
      const queryParams = [];

      const countWhereConditions = ['c.parent_id IS NULL'];
      const countParams = [];

      const totalWhereConditions = [];
      const totalParams = [];

      if (episodeId) {
        whereConditions.push('c.episode_id = ?');
        queryParams.push(episodeId);

        countWhereConditions.push('c.episode_id = ?');
        countParams.push(episodeId);

        totalWhereConditions.push('c.episode_id = ?');
        totalParams.push(episodeId);
      }

      if (targetStoryId) {
        whereConditions.push('COALESCE(c.story_id, e.story_id) = ?');
        queryParams.push(targetStoryId);

        countWhereConditions.push('COALESCE(c.story_id, e.story_id) = ?');
        countParams.push(targetStoryId);

        totalWhereConditions.push('COALESCE(c.story_id, e.story_id) = ?');
        totalParams.push(targetStoryId);
      }

      const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
      const countWhereSql = countWhereConditions.length > 0 ? `WHERE ${countWhereConditions.join(' AND ')}` : '';
      const totalWhereSql = totalWhereConditions.length > 0 ? `WHERE ${totalWhereConditions.join(' AND ')}` : '';

      // Count top-level comments for the episode (matching filters)
      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) as count 
         FROM comments c
         LEFT JOIN episodes e ON c.episode_id = e.id
         ${countWhereSql}`,
        countParams
      );

      // Count all comments (including replies) for the episode (matching filters)
      const [[{ totalCommentsCount }]] = await pool.query(
        `SELECT COUNT(*) as totalCommentsCount 
         FROM comments c
         LEFT JOIN episodes e ON c.episode_id = e.id
         ${totalWhereSql}`,
        totalParams
      );

      const [comments] = await pool.query(
        `SELECT c.*, e.story_id as ep_story_id, u.name as user_name, u.avatar_path as user_avatar,
                (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) as likes_count,
                (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id) as replies_count
         FROM comments c
         JOIN users u ON c.user_id = u.id
         LEFT JOIN episodes e ON c.episode_id = e.id
         ${whereSql}
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
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
        story_id: c.story_id ? Number(c.story_id) : (c.ep_story_id ? Number(c.ep_story_id) : (episode && episode.story_id ? Number(episode.story_id) : null)),
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
   * Body: { comment, parent_id?, story_id? }
   */
  static async store(req, res) {
    try {
      const episodeId = req.params.episodeId || req.params.id;
      const userId = req.user.id;
      const { comment, parent_id, story_id, storyId } = req.body;

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
      const targetStoryId = story_id || storyId || episode.story_id || null;

      const [result] = await pool.query(
        'INSERT INTO comments (user_id, story_id, episode_id, parent_id, comment) VALUES (?, ?, ?, ?, ?)',
        [userId, targetStoryId, episodeId, parent_id || null, comment.trim()]
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
            PushNotificationService.sendCommentNotification({
              recipientUserId: Number(authorId),
              commentId: result.insertId,
              episodeId: episodeId,
              storyId: episode.story_id,
              commenterName: commenterName,
              commentText: comment.trim(),
              title: 'New Comment on your Episode 💬',
              body: `${commenterName} commented: '${comment.trim().length > 50 ? comment.trim().substring(0, 47) + '...' : comment.trim()}'`,
            }).catch(() => { });
          })
          .catch(() => { });
      }).catch(() => { });

      return ApiResponse.success(
        res,
        {
          id: result.insertId,
          comment_id: result.insertId,
          story_id: targetStoryId ? Number(targetStoryId) : null,
          episode_id: Number(episodeId),
          comment: comment.trim(),
        },
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
      const commentId = req.params.commentId || req.params.id || req.params.comment;
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
          story_id: commentRecord.story_id ? Number(commentRecord.story_id) : null,
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
          story_id: commentRecord.story_id ? Number(commentRecord.story_id) : null,
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
