const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');
const { toStoryFieldsArray, toEpisodeFieldsArray } = require('../../utils/storyPresenter');

class ContentController {
  /**
   * GET /api/v1/admin/stories
   * List all stories with filter by status, category, language, search
   */
  static async listStories(req, res) {
    try {
      const { status, category_id, language, search, page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

      let whereClauses = ['1=1'];
      let queryParams = [];

      if (status) {
        whereClauses.push('s.status = ?');
        queryParams.push(status);
      }

      if (category_id) {
        whereClauses.push('s.category_id = ?');
        queryParams.push(category_id);
      }

      if (language) {
        whereClauses.push('s.language = ?');
        queryParams.push(language);
      }

      if (search) {
        whereClauses.push('(s.title LIKE ? OR s.description LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) as count FROM stories s ${whereSql}`,
        queryParams
      );

      const [stories] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         ${whereSql}
         ORDER BY s.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      const result = stories.map((s) => toStoryFieldsArray(s));

      return ApiResponse.success(res, {
        stories: result,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('Admin List Stories Error:', error);
      return ApiResponse.error(res, 'Failed to fetch admin stories list.', 500);
    }
  }

  /**
   * PUT /api/v1/admin/stories/:id/status
   * Update story status (ongoing, completed, draft, published)
   */
  static async updateStoryStatus(req, res) {
    try {
      const storyId = req.params.id;
      const { status } = req.body;

      const validStatuses = ['ongoing', 'completed', 'draft', 'published'];
      if (!status || !validStatuses.includes(status.toLowerCase())) {
        return ApiResponse.error(res, 'Valid status is required (ongoing, completed, draft, published).', 422);
      }

      const [storyRows] = await pool.query('SELECT * FROM stories WHERE id = ? LIMIT 1', [storyId]);
      if (storyRows.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 444);
      }

      await pool.query('UPDATE stories SET status = ?, updated_at = NOW() WHERE id = ?', [status.toLowerCase(), storyId]);

      return ApiResponse.success(res, { story_id: Number(storyId), status: status.toLowerCase() }, 'Story status updated successfully.');
    } catch (error) {
      console.error('Admin Update Story Status Error:', error);
      return ApiResponse.error(res, 'Failed to update story status.', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/stories/:id
   * Delete a story and its associated episodes & likes
   */
  static async deleteStory(req, res) {
    try {
      const storyId = req.params.id;

      const [storyRows] = await pool.query('SELECT * FROM stories WHERE id = ? LIMIT 1', [storyId]);
      if (storyRows.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 444);
      }

      await pool.query('DELETE FROM stories WHERE id = ?', [storyId]);

      return ApiResponse.success(res, { story_id: Number(storyId) }, 'Story deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Story Error:', error);
      return ApiResponse.error(res, 'Failed to delete story.', 500);
    }
  }

  /**
   * GET /api/v1/admin/episodes
   * List all episodes across all stories with filters
   */
  static async listEpisodes(req, res) {
    try {
      const { story_id, search, is_premium, page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

      let whereClauses = ['1=1'];
      let queryParams = [];

      if (story_id) {
        whereClauses.push('e.story_id = ?');
        queryParams.push(story_id);
      }

      if (search) {
        whereClauses.push('(e.title LIKE ? OR e.description LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`);
      }

      if (is_premium !== undefined && is_premium !== '') {
        whereClauses.push('e.is_premium = ?');
        queryParams.push(is_premium === '1' || is_premium === 'true' ? 1 : 0);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ count }]] = await pool.query(`SELECT COUNT(*) as count FROM episodes e ${whereSql}`, queryParams);

      const [episodes] = await pool.query(
        `SELECT e.*, s.title as story_title
         FROM episodes e
         LEFT JOIN stories s ON e.story_id = s.id
         ${whereSql}
         ORDER BY e.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      const result = episodes.map((ep) => toEpisodeFieldsArray(ep, ep.story_title, true));

      return ApiResponse.success(res, {
        episodes: result,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('Admin List Episodes Error:', error);
      return ApiResponse.error(res, 'Failed to fetch admin episodes list.', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/episodes/:id
   * Delete an episode and update parent story episodes count
   */
  static async deleteEpisode(req, res) {
    try {
      const episodeId = req.params.id;

      const [epRows] = await pool.query('SELECT * FROM episodes WHERE id = ? LIMIT 1', [episodeId]);
      if (epRows.length === 0) {
        return ApiResponse.error(res, 'Episode not found.', 444);
      }

      const storyId = epRows[0].story_id;

      await pool.query('DELETE FROM episodes WHERE id = ?', [episodeId]);

      // Update parent story episode count
      const [[{ cnt }]] = await pool.query('SELECT COUNT(*) as cnt FROM episodes WHERE story_id = ?', [storyId]);
      await pool.query('UPDATE stories SET episodes_count = ? WHERE id = ?', [cnt, storyId]);

      return ApiResponse.success(res, { episode_id: Number(episodeId), story_id: Number(storyId) }, 'Episode deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Episode Error:', error);
      return ApiResponse.error(res, 'Failed to delete episode.', 500);
    }
  }
}

module.exports = ContentController;
