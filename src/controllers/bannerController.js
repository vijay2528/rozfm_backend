const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const { resolveUrl } = require('../utils/storyPresenter');

class BannerController {
  static async index(req, res) {
    try {
      const { position } = req.query;
      let query = `
        SELECT * FROM banners 
        WHERE is_active = 1 
          AND (starts_at IS NULL OR starts_at <= NOW()) 
          AND (ends_at IS NULL OR ends_at >= NOW())
      `;
      const queryParams = [];

      if (position) {
        query += ' AND `position` = ?';
        queryParams.push(position);
      }

      query += ' ORDER BY sort_order ASC, position ASC, id DESC';

      const [rows] = await pool.query(query, queryParams);

      const banners = rows.map((b) => ({
        id: Number(b.id),
        title: b.title || null,
        image: resolveUrl(b.image_path),
        image_path: b.image_path || null,
        link_action: b.link_action || null,
        position: b.position || 'Home',
        starts_at: b.starts_at ? new Date(b.starts_at).toISOString() : null,
        ends_at: b.ends_at ? new Date(b.ends_at).toISOString() : null,
        is_active: Number(b.is_active),
        sort_order: Number(b.sort_order || 0),
        action_type: b.action_type || 'none',
        action_value: b.action_value || null,
      }));

      return ApiResponse.success(res, { banners });
    } catch (error) {
      console.error('List Banners Error:', error);
      return ApiResponse.error(res, 'Failed to fetch banners.', 500);
    }
  }
}

module.exports = BannerController;
