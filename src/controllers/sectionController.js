const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const { toStoryFieldsArray } = require('../utils/storyPresenter');

class SectionController {
  static async trending(req, res) {
    try {
      const [stories] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status IN ('ongoing', 'completed', 'published')
         ORDER BY s.total_views DESC
         LIMIT 30`
      );
      return ApiResponse.success(res, { stories: stories.map((s) => toStoryFieldsArray(s)) });
    } catch (error) {
      console.error('Trending Section Error:', error);
      return ApiResponse.error(res, 'Failed to fetch trending stories.', 500);
    }
  }

  static async popular(req, res) {
    try {
      const [stories] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status IN ('ongoing', 'completed', 'published')
         ORDER BY s.listeners_count DESC, s.total_views DESC
         LIMIT 30`
      );
      return ApiResponse.success(res, { stories: stories.map((s) => toStoryFieldsArray(s)) });
    } catch (error) {
      console.error('Popular Section Error:', error);
      return ApiResponse.error(res, 'Failed to fetch popular stories.', 500);
    }
  }

  static async topRated(req, res) {
    try {
      const [stories] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status IN ('ongoing', 'completed', 'published')
         ORDER BY s.rating DESC, s.listeners_count DESC
         LIMIT 30`
      );
      return ApiResponse.success(res, { stories: stories.map((s) => toStoryFieldsArray(s)) });
    } catch (error) {
      console.error('Top Rated Section Error:', error);
      return ApiResponse.error(res, 'Failed to fetch top rated stories.', 500);
    }
  }

  static async topPicks(req, res) {
    try {
      const [stories] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status IN ('ongoing', 'completed', 'published')
         ORDER BY s.listeners_count DESC
         LIMIT 30`
      );
      return ApiResponse.success(res, { stories: stories.map((s) => toStoryFieldsArray(s)) });
    } catch (error) {
      console.error('Top Picks Section Error:', error);
      return ApiResponse.error(res, 'Failed to fetch top picks stories.', 500);
    }
  }
}

module.exports = SectionController;
