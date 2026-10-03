const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

/**
 * Generate a URL-safe slug from a plan name.
 * @param {string} name
 * @returns {string}
 */
function generateSlug(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Format a database row from purchase_plans table into a clean membership plan API object.
 * @param {Object} p - Raw row from the purchase_plans table.
 * @returns {Object}
 */
function formatPlan(p) {
  const monthly = p.monthly_amount !== null && p.monthly_amount !== undefined
    ? Number(p.monthly_amount)
    : (p.price !== null && p.price !== undefined ? Number(p.price) : 0);
  const yearly = p.yearly_amount !== null && p.yearly_amount !== undefined
    ? Number(p.yearly_amount)
    : 0;
  const priceVal = p.price !== null && p.price !== undefined ? Number(p.price) : monthly;

  const isActive = p.is_active !== undefined && p.is_active !== null
    ? (p.is_active === 1 || p.is_active === true || p.is_active === '1')
    : (p.status !== undefined ? (p.status === 1 || p.status === true || p.status === '1') : true);

  return {
    id: Number(p.id),
    name: p.name || '',
    slug: p.slug || generateSlug(p.name),
    description: p.description || null,
    monthly_amount: monthly,
    yearly_amount: yearly,
    price: priceVal,
    amount: priceVal,
    coins: Number(p.coins || 0),
    bonus_coins: Number(p.bonus_coins || 0),
    currency: p.currency || 'INR',
    badge_text: p.badge_text || null,
    is_popular: Boolean(p.is_popular),
    sort_order: p.sort_order !== null && p.sort_order !== undefined ? Number(p.sort_order) : 0,
    is_active: isActive,
    status: isActive ? 1 : 0,
    created_at: p.created_at || null,
    updated_at: p.updated_at || null,
  };
}

class MembershipPlanController {
  /**
   * GET /api/v1/admin/membership-plans
   * List all purchase plans with optional filtering.
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
        whereClauses.push('(`is_active` = ? OR `status` = ?)');
        queryParams.push(activeVal, activeVal);
      }

      if (search) {
        whereClauses.push('(`name` LIKE ? OR `slug` LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      // Count total matching rows
      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) AS count FROM purchase_plans ${whereSql}`,
        queryParams
      );

      // Order by sort_order if available, otherwise by id
      const [rows] = await pool.query(
        `SELECT * FROM purchase_plans ${whereSql} ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      const formattedPlans = rows.map(formatPlan);

      return ApiResponse.success(res, {
        membership_plans: formattedPlans,
        purchase_plans: formattedPlans,
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
      const [rows] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [planId]);

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Membership plan not found.', 404);
      }

      const formatted = formatPlan(rows[0]);
      return ApiResponse.success(res, {
        membership_plan: formatted,
        purchase_plan: formatted,
      });
    } catch (error) {
      console.error('Admin Show Membership Plan Error:', error);
      return ApiResponse.error(res, 'Failed to fetch membership plan.', 500);
    }
  }

  /**
   * POST /api/v1/admin/membership-plans
   * Create a new membership plan in purchase_plans table.
   *
   * Body (JSON):
   *   name           string  required
   *   slug           string  optional (auto-generated from name if omitted)
   *   description    string  optional
   *   monthly_amount number  optional (or price)
   *   yearly_amount  number  optional
   *   price          number  optional
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
        price,
        currency,
        sort_order,
        is_active,
        status,
      } = req.body;

      if (!name || String(name).trim() === '') {
        return ApiResponse.error(res, 'Plan name is required.', 422);
      }

      const planName = String(name).trim();
      const planSlug = slug && String(slug).trim() !== '' ? String(slug).trim() : generateSlug(planName);

      const mAmount = monthly_amount !== undefined && monthly_amount !== null && monthly_amount !== ''
        ? parseFloat(monthly_amount)
        : (price !== undefined && price !== null && price !== '' ? parseFloat(price) : 0);

      const yAmount = yearly_amount !== undefined && yearly_amount !== null && yearly_amount !== ''
        ? parseFloat(yearly_amount)
        : 0;

      const isActiveVal = (is_active === false || is_active === 0 || is_active === '0' || is_active === 'false' || status === 0 || status === '0') ? 0 : 1;
      const sortVal = sort_order !== undefined && sort_order !== null ? parseInt(sort_order, 10) : 0;

      const [result] = await pool.query(
        `INSERT INTO purchase_plans
           (name, slug, description, monthly_amount, yearly_amount, currency, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          planName,
          planSlug,
          description ? String(description).trim() : null,
          mAmount,
          yAmount,
          currency ? String(currency).trim() : 'INR',
          sortVal,
          isActiveVal,
        ]
      );

      const [newRows] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [result.insertId]);
      const formatted = formatPlan(newRows[0]);

      return ApiResponse.success(res, {
        membership_plan: formatted,
        purchase_plan: formatted,
      }, 'Membership plan created successfully.', 201);
    } catch (error) {
      console.error('Admin Store Membership Plan Error:', error);
      return ApiResponse.error(res, 'Failed to create membership plan.', 500);
    }
  }

  /**
   * PUT /api/v1/admin/membership-plans/:id
   * Update an existing membership plan.
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
        price,
        currency,
        sort_order,
        is_active,
        status,
      } = req.body;

      const [existing] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [planId]);
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
        updateFields.push('`slug` = ?');
        queryParams.push(String(slug).trim());
      }

      if (description !== undefined) {
        updateFields.push('`description` = ?');
        queryParams.push(description ? String(description).trim() : null);
      }

      if (monthly_amount !== undefined && monthly_amount !== null && monthly_amount !== '') {
        updateFields.push('`monthly_amount` = ?');
        queryParams.push(parseFloat(monthly_amount) || 0);
      } else if (price !== undefined && price !== null && price !== '') {
        updateFields.push('`monthly_amount` = ?');
        queryParams.push(parseFloat(price) || 0);
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

      if (is_active !== undefined || status !== undefined) {
        const activeVal = (is_active === false || is_active === 0 || is_active === '0' || is_active === 'false' || status === 0 || status === '0') ? 0 : 1;
        updateFields.push('`is_active` = ?');
        queryParams.push(activeVal);
      }

      if (updateFields.length > 0) {
        queryParams.push(planId);
        await pool.query(
          `UPDATE purchase_plans SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`,
          queryParams
        );
      }

      const [updated] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [planId]);
      const formatted = formatPlan(updated[0]);

      return ApiResponse.success(res, {
        membership_plan: formatted,
        purchase_plan: formatted,
      }, 'Membership plan updated successfully.');
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

      const [existing] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [planId]);
      if (existing.length === 0) {
        return ApiResponse.error(res, 'Membership plan not found.', 404);
      }

      await pool.query('DELETE FROM purchase_plans WHERE id = ?', [planId]);
      return ApiResponse.success(res, { plan_id: Number(planId) }, 'Membership plan deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Membership Plan Error:', error);
      return ApiResponse.error(res, 'Failed to delete membership plan.', 500);
    }
  }
}

module.exports = MembershipPlanController;
