const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');
const { resolveUrl } = require('../../utils/storyPresenter');
const { uploadToR2 } = require('../../services/r2StorageService');

class BannerController {
  /**
   * GET /api/v1/admin/banners
   * List all promotional banners
   */
  static async index(req, res) {
    try {
      const [banners] = await pool.query('SELECT * FROM banners ORDER BY position ASC, id DESC');

      const result = banners.map((b) => ({
        id: Number(b.id),
        title: b.title || null,
        image_url: resolveUrl(b.image_path),
        action_type: b.action_type || 'none',
        action_value: b.action_value || null,
        position: Number(b.position || 0),
        is_active: Boolean(b.is_active),
        created_at: b.created_at,
      }));

      return ApiResponse.success(res, { banners: result });
    } catch (error) {
      console.error('Admin List Banners Error:', error);
      return ApiResponse.error(res, 'Failed to fetch banners.', 500);
    }
  }

  /**
   * POST /api/v1/admin/banners
   * Create a new banner
   */
  static async store(req, res) {
    try {
      const { title, action_type, action_value, position, is_active } = req.body;

      let imagePath = req.body.image || req.body.image_path || null;
      if (req.file) {
        imagePath = await uploadToR2(req.file, 'banners');
      }

      if (!imagePath) {
        return ApiResponse.error(res, 'Banner image is required.', 422);
      }

      const activeBool = is_active === undefined || is_active === '1' || is_active === 1 || is_active === true;
      const posVal = position ? parseInt(position, 10) : 0;

      const [result] = await pool.query(
        'INSERT INTO banners (title, image_path, action_type, action_value, position, is_active) VALUES (?, ?, ?, ?, ?, ?)',
        [title || null, imagePath, action_type || 'none', action_value || null, posVal, activeBool ? 1 : 0]
      );

      const [newBanner] = await pool.query('SELECT * FROM banners WHERE id = ? LIMIT 1', [result.insertId]);

      return ApiResponse.success(
        res,
        {
          banner: {
            id: Number(newBanner[0].id),
            title: newBanner[0].title,
            image_url: resolveUrl(newBanner[0].image_path),
            action_type: newBanner[0].action_type,
            action_value: newBanner[0].action_value,
            position: Number(newBanner[0].position),
            is_active: Boolean(newBanner[0].is_active),
            created_at: newBanner[0].created_at,
          },
        },
        'Banner created successfully.',
        201
      );
    } catch (error) {
      console.error('Admin Create Banner Error:', error);
      return ApiResponse.error(res, 'Failed to create banner.', 500);
    }
  }

  /**
   * PUT / POST /api/v1/admin/banners/:id
   * Update existing banner
   */
  static async update(req, res) {
    try {
      const bannerId = req.params.id;
      const { title, action_type, action_value, position, is_active } = req.body;

      const [bannerRows] = await pool.query('SELECT * FROM banners WHERE id = ? LIMIT 1', [bannerId]);
      if (bannerRows.length === 0) {
        return ApiResponse.error(res, 'Banner not found.', 444);
      }

      let imagePath = null;
      if (req.file) {
        imagePath = await uploadToR2(req.file, 'banners');
      } else if (req.body.image || req.body.image_path) {
        imagePath = req.body.image || req.body.image_path;
      }

      const updateFields = [];
      const queryParams = [];

      if (title !== undefined) {
        updateFields.push('`title` = ?');
        queryParams.push(title);
      }
      if (imagePath) {
        updateFields.push('`image_path` = ?');
        queryParams.push(imagePath);
      }
      if (action_type !== undefined) {
        updateFields.push('`action_type` = ?');
        queryParams.push(action_type);
      }
      if (action_value !== undefined) {
        updateFields.push('`action_value` = ?');
        queryParams.push(action_value);
      }
      if (position !== undefined) {
        updateFields.push('`position` = ?');
        queryParams.push(parseInt(position, 10));
      }
      if (is_active !== undefined) {
        const activeBool = is_active === '1' || is_active === 1 || is_active === true;
        updateFields.push('`is_active` = ?');
        queryParams.push(activeBool ? 1 : 0);
      }

      if (updateFields.length > 0) {
        queryParams.push(bannerId);
        await pool.query(`UPDATE banners SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`, queryParams);
      }

      const [updated] = await pool.query('SELECT * FROM banners WHERE id = ? LIMIT 1', [bannerId]);

      return ApiResponse.success(
        res,
        {
          banner: {
            id: Number(updated[0].id),
            title: updated[0].title,
            image_url: resolveUrl(updated[0].image_path),
            action_type: updated[0].action_type,
            action_value: updated[0].action_value,
            position: Number(updated[0].position),
            is_active: Boolean(updated[0].is_active),
            updated_at: updated[0].updated_at,
          },
        },
        'Banner updated successfully.'
      );
    } catch (error) {
      console.error('Admin Update Banner Error:', error);
      return ApiResponse.error(res, 'Failed to update banner.', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/banners/:id
   * Delete a banner
   */
  static async destroy(req, res) {
    try {
      const bannerId = req.params.id;

      const [bannerRows] = await pool.query('SELECT * FROM banners WHERE id = ? LIMIT 1', [bannerId]);
      if (bannerRows.length === 0) {
        return ApiResponse.error(res, 'Banner not found.', 444);
      }

      await pool.query('DELETE FROM banners WHERE id = ?', [bannerId]);

      return ApiResponse.success(res, { banner_id: Number(bannerId) }, 'Banner deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Banner Error:', error);
      return ApiResponse.error(res, 'Failed to delete banner.', 500);
    }
  }
}

module.exports = BannerController;
