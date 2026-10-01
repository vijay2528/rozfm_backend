const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

/**
 * Format a database row into a clean membership plan API object.
 * @param {Object} p - Raw row from the membership_plans table.
 * @returns {Object}
 */
function formatPlan(p) {
  return {
    id: Number(p.id),
    name: p.name || '',
    slug: p.slug || '',
    description: p.description || null,
    monthly_amount: p.monthly_amount !== null ? Number(p.monthly_amount) : 0,
    yearly_amount: p.yearly_amount !== null ? Number(p.yearly_amount) : 0,
    currency: p.currency || 'INR',
    sort_order: Number(p.sort_order || 0),
    is_active: p.is_active === 1 || p.is_active === true || p.is_active === '1',
    created_at: p.created_at || null,
    updated_at: p.updated_at || null,
  };
}

/**
 * Generate a URL-safe slug from a plan name.
 * @param {string} name
 * @returns {string}
 */
function generateSlug(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

class MembershipPlanController {
  /**
   * GET /api/v1/admin/membership-plans
   * List all membership plans with optional filtering.
   *
   * Query params:
   *   is_active  (0|1)  – Filter by active status
   *   search     string – Filter by name or slug
   *   page       int    – Pagination page (default: 1)
   *   limit      int    – Items per page (default: 20, max: 100)
   */
  static async index(req, res) {
    try {
      const { is_active, search, page = 1, limit = 20 } = req.query;
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * limitNum;

      const whereClauses = [];
      const queryParams = [];

      if (is_active !== undefined && is_active !== '') {
        const activeVal = is_active === '1' || is_active === 1 || is_active === 'true' ? 1 : 0;
        whereClauses.push('`is_active` = ?');
        queryParams.push(activeVal);
      }

      if (search) {
        whereClauses.push('(`name` LIKE ? OR `slug` LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      // Count total matching rows
      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) AS count FROM membership_plans ${whereSql}`,
        queryParams
      );

      const [rows] = await pool.query(
        `SELECT * FROM membership_plans ${whereSql} ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ApiResponse.success(res, {
        membership_plans: rows.map(formatPlan),
        pagination: {
          total: Number(count),
          page: parseInt(page, 10),
          limit: limitNum,
          total_pages: Math.ceil(Number(count) / limitNum),
        },
      });
    } catch (error) {
      console.error('Admin List Membership Plans Error:', error);
      return ApiResponse.error(res, 'Failed to fetch membership plans.', 500);
    }
  }

  /**
   * GET /api/v1/admin/membership-plans/:id
   * Fetch a single membership plan by ID.
   */
  static async show(req, res) {
    try {
      const planId = req.params.id;
      const [rows] = await pool.query('SELECT * FROM membership_plans WHERE id = ? LIMIT 1', [planId]);

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Membership plan not found.', 404);
      }

      return ApiResponse.success(res, { membership_plan: formatPlan(rows[0]) });
    } catch (error) {
      console.error('Admin Show Membership Plan Error:', error);
      return ApiResponse.error(res, 'Failed to fetch membership plan.', 500);
    }
  }

  /**
   * POST /api/v1/admin/membership-plans
   * Create a new membership plan.
   *
   * Body (JSON):
   *   name           string  required
   *   slug           string  optional (auto-generated from name if omitted)
   *   description    string  optional
   *   monthly_amount number  required
   *   yearly_amount  number  required
   *   currency       string  optional (default: INR)
   *   sort_order     int     optional (default: 0)
   *   is_active      boolean optional (default: true)
   */
  static async store(req, res) {
    try {
      const {
        name,
        slug,
        description,
        monthly_amount,
        yearly_amount,
        currency,
        sort_order,
        is_active,
      } = req.body;

      if (!name || String(name).trim() === '') {
        return ApiResponse.error(res, 'Plan name is required.', 422);
      }
      if (monthly_amount === undefined || monthly_amount === null || monthly_amount === '') {
        return ApiResponse.error(res, 'Monthly amount is required.', 422);
      }
      if (yearly_amount === undefined || yearly_amount === null || yearly_amount === '') {
        return ApiResponse.error(res, 'Yearly amount is required.', 422);
      }

      const planName = String(name).trim();
      const planSlug = slug && String(slug).trim() !== '' ? String(slug).trim() : generateSlug(planName);

      // Ensure slug uniqueness
      const [slugCheck] = await pool.query(
        'SELECT id FROM membership_plans WHERE slug = ? LIMIT 1',
        [planSlug]
      );
      if (slugCheck.length > 0) {
        return ApiResponse.error(res, `A plan with slug "${planSlug}" already exists.`, 422);
      }

      const isActiveVal = is_active === false || is_active === 0 || is_active === '0' || is_active === 'false' ? 0 : 1;

      const [result] = await pool.query(
        `INSERT INTO membership_plans
           (name, slug, description, monthly_amount, yearly_amount, currency, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          planName,
          planSlug,
          description ? String(description).trim() : null,
          parseFloat(monthly_amount) || 0,
          parseFloat(yearly_amount) || 0,
          currency ? String(currency).trim() : 'INR',
          sort_order !== undefined && sort_order !== null ? parseInt(sort_order, 10) : 0,
          isActiveVal,
        ]
      );

      const [newRows] = await pool.query('SELECT * FROM membership_plans WHERE id = ? LIMIT 1', [result.insertId]);
      return ApiResponse.success(res, { membership_plan: formatPlan(newRows[0]) }, 'Membership plan created successfully.', 201);
    } catch (error) {
      console.error('Admin Store Membership Plan Error:', error);
      return ApiResponse.error(res, 'Failed to create membership plan.', 500);
    }
  }

  /**
   * PUT /POST /api/v1/admin/membership-plans/:id
   * Update an existing membership plan.
   *
   * Body (JSON) — all fields optional (only supplied fields are updated):
   *   name, slug, description, monthly_amount, yearly_amount,
   *   currency, sort_order, is_active
   */
  static async update(req, res) {
    try {
      const planId = req.params.id;
      const {
        name,
        slug,
        description,
        monthly_amount,
        yearly_amount,
        currency,
        sort_order,
        is_active,
      } = req.body;

      const [existing] = await pool.query('SELECT * FROM membership_plans WHERE id = ? LIMIT 1', [planId]);
      if (existing.length === 0) {
        return ApiResponse.error(res, 'Membership plan not found.', 404);
      }

      const updateFields = [];
      const queryParams = [];

      if (name !== undefined && String(name).trim() !== '') {
        updateFields.push('`name` = ?');
        queryParams.push(String(name).trim());
      }

      if (slug !== undefined && String(slug).trim() !== '') {
        const newSlug = String(slug).trim();
        // Ensure slug uniqueness (excluding current record)
        const [slugCheck] = await pool.query(
          'SELECT id FROM membership_plans WHERE slug = ? AND id != ? LIMIT 1',
          [newSlug, planId]
        );
        if (slugCheck.length > 0) {
          return ApiResponse.error(res, `A plan with slug "${newSlug}" already exists.`, 422);
        }
        updateFields.push('`slug` = ?');
        queryParams.push(newSlug);
      }

      if (description !== undefined) {
        updateFields.push('`description` = ?');
        queryParams.push(description ? String(description).trim() : null);
      }

      if (monthly_amount !== undefined && monthly_amount !== null && monthly_amount !== '') {
        updateFields.push('`monthly_amount` = ?');
        queryParams.push(parseFloat(monthly_amount) || 0);
      }

      if (yearly_amount !== undefined && yearly_amount !== null && yearly_amount !== '') {
        updateFields.push('`yearly_amount` = ?');
        queryParams.push(parseFloat(yearly_amount) || 0);
      }

      if (currency !== undefined && String(currency).trim() !== '') {
        updateFields.push('`currency` = ?');
        queryParams.push(String(currency).trim());
      }

      if (sort_order !== undefined && sort_order !== null) {
        updateFields.push('`sort_order` = ?');
        queryParams.push(parseInt(sort_order, 10) || 0);
      }

      if (is_active !== undefined) {
        const isActiveVal = is_active === false || is_active === 0 || is_active === '0' || is_active === 'false' ? 0 : 1;
        updateFields.push('`is_active` = ?');
        queryParams.push(isActiveVal);
      }

      if (updateFields.length > 0) {
        queryParams.push(planId);
        await pool.query(
          `UPDATE membership_plans SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`,
          queryParams
        );
      }

      const [updated] = await pool.query('SELECT * FROM membership_plans WHERE id = ? LIMIT 1', [planId]);
      return ApiResponse.success(res, { membership_plan: formatPlan(updated[0]) }, 'Membership plan updated successfully.');
    } catch (error) {
      console.error('Admin Update Membership Plan Error:', error);
      return ApiResponse.error(res, 'Failed to update membership plan.', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/membership-plans/:id
   * Delete a membership plan.
   */
  static async destroy(req, res) {
    try {
      const planId = req.params.id;

      const [existing] = await pool.query('SELECT * FROM membership_plans WHERE id = ? LIMIT 1', [planId]);
      if (existing.length === 0) {
        return ApiResponse.error(res, 'Membership plan not found.', 404);
      }

      await pool.query('DELETE FROM membership_plans WHERE id = ?', [planId]);
      return ApiResponse.success(res, { plan_id: Number(planId) }, 'Membership plan deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Membership Plan Error:', error);
      return ApiResponse.error(res, 'Failed to delete membership plan.', 500);
    }
  }
}

module.exports = MembershipPlanController;
