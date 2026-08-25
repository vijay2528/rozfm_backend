const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const { resolveUrl } = require('../utils/storyPresenter');

class BannerController {
  static async index(req, res) {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM banners WHERE is_active = 1 ORDER BY position ASC'
      );

      const banners = rows.map((b) => ({
        id: Number(b.id),
        title: b.title,
        image: resolveUrl(b.image_path),
        action_type: b.action_type || 'none',
        action_value: b.action_value || null,
        position: Number(b.position || 0),
      }));

      return ApiResponse.success(res, { banners });
    } catch (error) {
      console.error('List Banners Error:', error);
      return ApiResponse.error(res, 'Failed to fetch banners.', 500);
    }
  }
}

module.exports = BannerController;
