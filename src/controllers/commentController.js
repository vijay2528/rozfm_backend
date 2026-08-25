const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

class CommentController {
  static async index(req, res) {
    try {
      const storyId = req.params.id || req.params.story;
      const userId = req.user ? req.user.id : null;

      const [comments] = await pool.query(
        `SELECT c.*, u.name as user_name, u.avatar_path as user_avatar,
                (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) as likes_count
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.story_id = ? AND c.parent_id IS NULL
         ORDER BY c.created_at DESC`,
        [storyId]
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
        is_liked: userLikedIds.has(c.id),
        created_at: c.created_at,
      }));

      return ApiResponse.success(res, { comments: result });
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

      const [result] = await pool.query(
        'INSERT INTO comments (user_id, story_id, parent_id, comment) VALUES (?, ?, ?, ?)',
        [userId, storyId, parent_id || null, comment.trim()]
      );

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
      const [replies] = await pool.query(
        `SELECT c.*, u.name as user_name, u.avatar_path as user_avatar
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.parent_id = ?
         ORDER BY c.created_at ASC`,
        [commentId]
      );

      return ApiResponse.success(res, { replies });
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
}

module.exports = CommentController;
