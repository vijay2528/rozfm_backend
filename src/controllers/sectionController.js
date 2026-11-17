const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const { toStoryFieldsArray } = require('../utils/storyPresenter');

const PUBLIC_STORY_STATUS_CONDITION = `(
  (
    (LOWER(COALESCE(s.release_status, '')) LIKE '%schedule%' OR LOWER(COALESCE(s.status, '')) LIKE '%schedule%')
    AND s.publish_date IS NOT NULL
    AND DATE(s.publish_date) <= CURDATE()
  )
  OR
  (
    (LOWER(COALESCE(s.release_status, '')) NOT LIKE '%schedule%' AND LOWER(COALESCE(s.status, '')) NOT LIKE '%schedule%')
    AND (s.status IS NULL OR s.status = '' OR LOWER(s.status) IN ('ongoing', 'completed', 'published'))
  )
) AND (LOWER(COALESCE(s.release_status, '')) NOT LIKE '%draft%' AND LOWER(COALESCE(s.status, '')) NOT LIKE '%draft%')`;

class SectionController {
  static async trending(req, res) {
    try {
      const [stories] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name, u.avatar_path as author_image
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE ${PUBLIC_STORY_STATUS_CONDITION}
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
        `SELECT s.*, c.category_name, u.name as author_name, u.avatar_path as author_image
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE ${PUBLIC_STORY_STATUS_CONDITION}
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
        `SELECT s.*, c.category_name, u.name as author_name, u.avatar_path as author_image
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE ${PUBLIC_STORY_STATUS_CONDITION}
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
        `SELECT s.*, c.category_name, u.name as author_name, u.avatar_path as author_image
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE ${PUBLIC_STORY_STATUS_CONDITION}
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
