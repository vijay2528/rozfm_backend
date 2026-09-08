const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const userService = require('../services/userService');
const { sendSuccess, sendError } = require('../utils/response');
const { toProfileFieldsArray, toUserProfileDetailsArray, formatNumber } = require('../utils/userPresenter');
const { toStoryFieldsArray, resolveUrl } = require('../utils/storyPresenter');

class UserController {
  /**
   * GET /api/v1/users/:id or GET /api/v1/users/:id/profile
   * Fetch user profile details by ID with stats, series list, reviews, and follow state
   */
  static async show(req, res) {
    try {
      const targetUserId = req.params.id || req.params.userId;
      const currentUserId = req.user ? req.user.id : null;

      const [userRows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [targetUserId]);
      if (userRows.length === 0) {
        return ApiResponse.error(res, 'User not found.', 404);
      }
      const user = userRows[0];

      // 1. Calculate total plays across all stories created by target user
      const [[{ totalPlays }]] = await pool.query(
        'SELECT COALESCE(SUM(total_views), 0) + COALESCE(SUM(listeners_count), 0) AS totalPlays FROM stories WHERE user_id = ?',
        [targetUserId]
      );

      // 2. Count followers and following
      const [[{ followersCount }]] = await pool.query(
        'SELECT COUNT(*) AS followersCount FROM user_follows WHERE following_id = ?',
        [targetUserId]
      );
      const [[{ followingCount }]] = await pool.query(
        'SELECT COUNT(*) AS followingCount FROM user_follows WHERE follower_id = ?',
        [targetUserId]
      );

      // 3. Check if requesting user follows target user
      let isFollowing = false;
      if (currentUserId && Number(currentUserId) !== Number(targetUserId)) {
        const [followRows] = await pool.query(
          'SELECT id FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1',
          [currentUserId, targetUserId]
        );
        isFollowing = followRows.length > 0;
      }

      // 4. Fetch target user's stories ("My Series")
      const [storyRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.user_id = ?
         ORDER BY s.created_at DESC`,
        [targetUserId]
      );

      const storiesList = storyRows.map((s) => toStoryFieldsArray(s));

      // 5. Fetch reviews related to target user's stories or written by target user
      const [reviewRows] = await pool.query(
        `SELECT r.*, u.name as reviewer_name, u.avatar_path as reviewer_avatar, s.title as story_title
         FROM reviews r
         JOIN stories s ON r.story_id = s.id
         JOIN users u ON r.user_id = u.id
         WHERE s.user_id = ? OR r.user_id = ?
         ORDER BY r.created_at DESC
         LIMIT 20`,
        [targetUserId, targetUserId]
      );

      const reviewsList = reviewRows.map((r) => ({
        review_id: r.id,
        user_id: r.user_id,
        user_name: r.reviewer_name,
        user_avatar: r.reviewer_avatar ? resolveUrl(r.reviewer_avatar) : null,
        story_id: r.story_id,
        story_title: r.story_title,
        rating: Number(r.rating || 0),
        review: r.review || null,
        created_at: r.created_at,
      }));

      const profileData = toUserProfileDetailsArray(user, {
        playsCount: totalPlays,
        followersCount: followersCount,
        followingCount: followingCount,
        isFollowing: isFollowing,
        stories: storiesList,
        reviews: reviewsList,
      });

      return ApiResponse.success(res, { user: profileData });
    } catch (error) {
      console.error('Get User Profile Error:', error);
      return ApiResponse.error(res, 'Failed to fetch user profile.', 500);
    }
  }

  /**
   * POST /api/v1/users/:id/follow
   * Follow or unfollow a user
   */
  static async toggleFollow(req, res) {
    try {
      const targetUserId = req.params.id || req.params.userId;
      const currentUserId = req.user.id;

      if (Number(currentUserId) === Number(targetUserId)) {
        return ApiResponse.error(res, 'You cannot follow yourself.', 422);
      }

      const [userRows] = await pool.query('SELECT id FROM users WHERE id = ? LIMIT 1', [targetUserId]);
      if (userRows.length === 0) {
        return ApiResponse.error(res, 'User not found.', 404);
      }

      const [existing] = await pool.query(
        'SELECT id FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1',
        [currentUserId, targetUserId]
      );

      let isFollowing = false;
      if (existing.length > 0) {
        await pool.query('DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?', [currentUserId, targetUserId]);
        isFollowing = false;
      } else {
        await pool.query('INSERT INTO user_follows (follower_id, following_id) VALUES (?, ?)', [currentUserId, targetUserId]);
        isFollowing = true;
      }

      const [[{ followersCount }]] = await pool.query(
        'SELECT COUNT(*) AS followersCount FROM user_follows WHERE following_id = ?',
        [targetUserId]
      );

      return ApiResponse.success(
        res,
        {
          is_following: isFollowing,
          followers_count: Number(followersCount),
          followers_formatted: formatNumber(followersCount),
        },
        isFollowing ? 'User followed successfully.' : 'User unfollowed successfully.'
      );
    } catch (error) {
      console.error('Toggle Follow Error:', error);
      return ApiResponse.error(res, 'Failed to toggle follow.', 500);
    }
  }

  /**
   * GET /api/v1/users/:id/stories
   * Fetch paginated series/stories created by user
   */
  static async getUserStories(req, res) {
    try {
      const targetUserId = req.params.id || req.params.userId;
      const { page = 1, limit = 10 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const offset = (pageNum - 1) * limitNum;

      const [[{ count }]] = await pool.query('SELECT COUNT(*) as count FROM stories WHERE user_id = ?', [targetUserId]);

      const [storyRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.user_id = ?
         ORDER BY s.created_at DESC
         LIMIT ? OFFSET ?`,
        [targetUserId, limitNum, offset]
      );

      const storiesList = storyRows.map((s) => toStoryFieldsArray(s));

      return ApiResponse.success(res, {
        stories: storiesList,
        total: count,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(count / limitNum),
      });
    } catch (error) {
      console.error('Get User Stories Error:', error);
      return ApiResponse.error(res, 'Failed to fetch user stories.', 500);
    }
  }

  /**
   * GET /api/v1/users/:id/reviews
   * Fetch paginated reviews related to user's stories
   */
  static async getUserReviews(req, res) {
    try {
      const targetUserId = req.params.id || req.params.userId;
      const { page = 1, limit = 10 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const offset = (pageNum - 1) * limitNum;

      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) as count
         FROM reviews r
         JOIN stories s ON r.story_id = s.id
         WHERE s.user_id = ? OR r.user_id = ?`,
        [targetUserId, targetUserId]
      );

      const [reviewRows] = await pool.query(
        `SELECT r.*, u.name as reviewer_name, u.avatar_path as reviewer_avatar, s.title as story_title
         FROM reviews r
         JOIN stories s ON r.story_id = s.id
         JOIN users u ON r.user_id = u.id
         WHERE s.user_id = ? OR r.user_id = ?
         ORDER BY r.created_at DESC
         LIMIT ? OFFSET ?`,
        [targetUserId, targetUserId, limitNum, offset]
      );

      const reviewsList = reviewRows.map((r) => ({
        review_id: r.id,
        user_id: r.user_id,
        user_name: r.reviewer_name,
        user_avatar: r.reviewer_avatar ? resolveUrl(r.reviewer_avatar) : null,
        story_id: r.story_id,
        story_title: r.story_title,
        rating: Number(r.rating || 0),
        review: r.review || null,
        created_at: r.created_at,
      }));

      return ApiResponse.success(res, {
        reviews: reviewsList,
        total: count,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(count / limitNum),
      });
    } catch (error) {
      console.error('Get User Reviews Error:', error);
      return ApiResponse.error(res, 'Failed to fetch user reviews.', 500);
    }
  }

  // Backward compatibility methods for service-based routes
  static async getUsers(req, res) {
    try {
      const users = await userService.getAllUsers();
      return sendSuccess(res, users, 'Users retrieved successfully');
    } catch (error) {
      return sendError(res, error.message, 500);
    }
  }

  static async getUserById(req, res) {
    return UserController.show(req, res);
  }

  static async createUser(req, res) {
    try {
      const { name, email, role } = req.body;
      if (!name || !email) {
        return sendError(res, 'Name and email are required fields', 400);
      }
      const newUser = await userService.createUser({ name, email, role });
      return sendSuccess(res, newUser, 'User created successfully', 201);
    } catch (error) {
      return sendError(res, error.message, 500);
    }
  }

  static async updateUser(req, res) {
    try {
      const updatedUser = await userService.updateUser(req.params.id, req.body);
      return sendSuccess(res, updatedUser, 'User updated successfully');
    } catch (error) {
      return sendError(res, error.message, 404);
    }
  }

  static async deleteUser(req, res) {
    try {
      const deletedUser = await userService.deleteUser(req.params.id);
      return sendSuccess(res, deletedUser, 'User deleted successfully');
    } catch (error) {
      return sendError(res, error.message, 404);
    }
  }
}

// Function wrapper exports for backward compatibility
module.exports = {
  UserController,
  show: UserController.show,
  toggleFollow: UserController.toggleFollow,
  getUserStories: UserController.getUserStories,
  getUserReviews: UserController.getUserReviews,
  getUsers: UserController.getUsers,
  getUserById: UserController.getUserById,
  createUser: UserController.createUser,
  updateUser: UserController.updateUser,
  deleteUser: UserController.deleteUser,
};
