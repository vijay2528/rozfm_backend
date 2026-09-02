const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');
const { resolveUrl } = require('../../utils/storyPresenter');
const { uploadToR2 } = require('../../services/r2StorageService');

/**
 * Format database row into standard API banner object
 */
function formatBanner(b) {
  return {
    id: Number(b.id),
    title: b.title || null,
    image_path: b.image_path || null,
    image_url: resolveUrl(b.image_path),
    link_action: b.link_action || null,
    position: b.position || 'Home',
    starts_at: b.starts_at ? new Date(b.starts_at).toISOString() : null,
    ends_at: b.ends_at ? new Date(b.ends_at).toISOString() : null,
    is_active: Number(b.is_active === 1 || b.is_active === true || b.is_active === '1' ? 1 : 0),
    sort_order: Number(b.sort_order || 0),
    action_type: b.action_type || 'none',
    action_value: b.action_value || null,
    created_at: b.created_at,
    updated_at: b.updated_at,
  };
}

/**
 * Normalize banner position to Home, Explore, or Player
 */
function normalizePosition(val) {
  if (!val) return 'Home';
  const str = String(val).trim();
  const lower = str.toLowerCase();
  if (lower === 'home' || str === '0') return 'Home';
  if (lower === 'explore' || str === '1') return 'Explore';
  if (lower === 'player' || str === '2') return 'Player';
  return str;
}

class BannerController {
  /**
   * GET /api/v1/admin/banners
   * List all promotional banners with optional filtering
   */
  static async index(req, res) {
    try {
      const { position, is_active } = req.query;
      let query = 'SELECT * FROM banners';
      const whereClauses = [];
      const queryParams = [];

      if (position) {
        whereClauses.push('`position` = ?');
        queryParams.push(normalizePosition(position));
      }

      if (is_active !== undefined && is_active !== '') {
        const activeVal = is_active === '1' || is_active === 1 || is_active === 'true' || is_active === true ? 1 : 0;
        whereClauses.push('`is_active` = ?');
        queryParams.push(activeVal);
      }

      if (whereClauses.length > 0) {
        query += ' WHERE ' + whereClauses.join(' AND ');
      }

      query += ' ORDER BY sort_order ASC, position ASC, id DESC';

      const [banners] = await pool.query(query, queryParams);
      const result = banners.map(formatBanner);

      return ApiResponse.success(res, { banners: result });
    } catch (error) {
      console.error('Admin List Banners Error:', error);
      return ApiResponse.error(res, 'Failed to fetch banners.', 500);
    }
  }

  /**
   * GET /api/v1/admin/banners/:id
   * Fetch single banner detail by ID
   */
  static async show(req, res) {
    try {
      const bannerId = req.params.id;
      const [banners] = await pool.query('SELECT * FROM banners WHERE id = ? LIMIT 1', [bannerId]);

      if (banners.length === 0) {
        return ApiResponse.error(res, 'Banner not found.', 404);
      }

      return ApiResponse.success(res, { banner: formatBanner(banners[0]) });
    } catch (error) {
      console.error('Admin Show Banner Error:', error);
      return ApiResponse.error(res, 'Failed to fetch banner details.', 500);
    }
  }

  /**
   * POST /api/v1/admin/banners
   * Create a new banner
   */
  static async store(req, res) {
    try {
      const {
        title,
        link_action,
        position,
        starts_at,
        ends_at,
        is_active,
        sort_order,
        action_type,
        action_value,
      } = req.body;

      let imagePath = req.body.image_path || req.body.image || null;
      if (req.file) {
        imagePath = await uploadToR2(req.file, 'banners');
      }

      if (!imagePath) {
        return ApiResponse.error(res, 'Banner image is required.', 422);
      }

      const activeVal = is_active === undefined || is_active === '1' || is_active === 1 || is_active === true || is_active === 'true' ? 1 : 0;
      const posVal = normalizePosition(position);
      const sortVal = sort_order !== undefined && sort_order !== null ? parseInt(sort_order, 10) || 0 : 0;
      const startsAtVal = starts_at && starts_at !== 'null' ? new Date(starts_at) : null;
      const endsAtVal = ends_at && ends_at !== 'null' ? new Date(ends_at) : null;

      const [result] = await pool.query(
        `INSERT INTO banners 
        (title, image_path, link_action, position, starts_at, ends_at, is_active, sort_order, action_type, action_value) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          title || null,
          imagePath,
          link_action || null,
          posVal,
          startsAtVal,
          endsAtVal,
          activeVal,
          sortVal,
          action_type || 'none',
          action_value || null,
        ]
      );

      const [newBanner] = await pool.query('SELECT * FROM banners WHERE id = ? LIMIT 1', [result.insertId]);

      return ApiResponse.success(
        res,
        { banner: formatBanner(newBanner[0]) },
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
      const {
        title,
        link_action,
        position,
        starts_at,
        ends_at,
        is_active,
        sort_order,
        action_type,
        action_value,
      } = req.body;

      const [bannerRows] = await pool.query('SELECT * FROM banners WHERE id = ? LIMIT 1', [bannerId]);
      if (bannerRows.length === 0) {
        return ApiResponse.error(res, 'Banner not found.', 404);
      }

      let imagePath = null;
      if (req.file) {
        imagePath = await uploadToR2(req.file, 'banners');
      } else if (req.body.image_path || req.body.image) {
        imagePath = req.body.image_path || req.body.image;
      }

      const updateFields = [];
      const queryParams = [];

      if (title !== undefined) {
        updateFields.push('`title` = ?');
        queryParams.push(title || null);
      }
      if (imagePath) {
        updateFields.push('`image_path` = ?');
        queryParams.push(imagePath);
      }
      if (link_action !== undefined) {
        updateFields.push('`link_action` = ?');
        queryParams.push(link_action || null);
      }
      if (position !== undefined) {
        updateFields.push('`position` = ?');
        queryParams.push(normalizePosition(position));
      }
      if (starts_at !== undefined) {
        updateFields.push('`starts_at` = ?');
        queryParams.push(starts_at && starts_at !== 'null' ? new Date(starts_at) : null);
      }
      if (ends_at !== undefined) {
        updateFields.push('`ends_at` = ?');
        queryParams.push(ends_at && ends_at !== 'null' ? new Date(ends_at) : null);
      }
      if (is_active !== undefined) {
        const activeVal = is_active === '1' || is_active === 1 || is_active === true || is_active === 'true' ? 1 : 0;
        updateFields.push('`is_active` = ?');
        queryParams.push(activeVal);
      }
      if (sort_order !== undefined) {
        updateFields.push('`sort_order` = ?');
        queryParams.push(parseInt(sort_order, 10) || 0);
      }
      if (action_type !== undefined) {
        updateFields.push('`action_type` = ?');
        queryParams.push(action_type);
      }
      if (action_value !== undefined) {
        updateFields.push('`action_value` = ?');
        queryParams.push(action_value);
      }

      if (updateFields.length > 0) {
        queryParams.push(bannerId);
        await pool.query(`UPDATE banners SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`, queryParams);
      }

      const [updated] = await pool.query('SELECT * FROM banners WHERE id = ? LIMIT 1', [bannerId]);

      return ApiResponse.success(
        res,
        { banner: formatBanner(updated[0]) },
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
        return ApiResponse.error(res, 'Banner not found.', 404);
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
