const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

/**
 * Format a database row into a clean purchase plan API object.
 * @param {Object} p - Raw row from the purchase_plans table.
 * @returns {Object}
 */
function formatPlan(p) {
  return {
    id: Number(p.id),
    name: p.name || '',
    coins: Number(p.coins || 0),
    bonus_coins: Number(p.bonus_coins || 0),
    price: p.price !== null && p.price !== undefined ? Number(p.price) : 0,
    currency: p.currency || 'INR',
    badge_text: p.badge_text || null,
    is_popular: p.is_popular === 1 || p.is_popular === true || p.is_popular === '1',
    status: p.status === 1 || p.status === true || p.status === '1' ? 1 : 0,
    is_active: p.status === 1 || p.status === true || p.status === '1',
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
   *   is_active  (0|1)  – Filter by status
   *   search     string – Filter by name
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
        whereClauses.push('`status` = ?');
        queryParams.push(activeVal);
      }

      if (search) {
        whereClauses.push('(`name` LIKE ?)');
        queryParams.push(`%${search}%`);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      // Count total matching rows
      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) AS count FROM purchase_plans ${whereSql}`,
        queryParams
      );

      const [rows] = await pool.query(
        `SELECT * FROM purchase_plans ${whereSql} ORDER BY price ASC LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ApiResponse.success(res, {
        purchase_plans: rows.map(formatPlan),
        pagination: {
          total: Number(count),
          page: parseInt(page, 10),
          limit: limitNum,
          total_pages: Math.ceil(Number(count) / limitNum),
        },
      });
    } catch (error) {
      console.error('Admin List Purchase Plans Error:', error);
      return ApiResponse.error(res, 'Failed to fetch purchase plans.', 500);
    }
  }

  /**
   * GET /api/v1/admin/membership-plans/:id
   * Fetch a single purchase plan by ID.
   */
  static async show(req, res) {
    try {
      const planId = req.params.id;
      const [rows] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [planId]);

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Purchase plan not found.', 404);
      }

      return ApiResponse.success(res, { purchase_plan: formatPlan(rows[0]) });
    } catch (error) {
      console.error('Admin Show Purchase Plan Error:', error);
      return ApiResponse.error(res, 'Failed to fetch purchase plan.', 500);
    }
  }

  /**
   * POST /api/v1/admin/membership-plans
   * Create a new purchase plan.
   *
   * Body (JSON):
   *   name         string  required
   *   coins        number  required
   *   bonus_coins  number  optional (default: 0)
   *   price        number  required
   *   currency     string  optional (default: INR)
   *   badge_text   string  optional
   *   is_popular   boolean optional (default: false)
   *   status       int     optional (default: 1)
   */
  static async store(req, res) {
    try {
      const {
        name,
        coins,
        bonus_coins,
        price,
        currency,
        badge_text,
        is_popular,
        status,
      } = req.body;

      if (!name || String(name).trim() === '') {
        return ApiResponse.error(res, 'Plan name is required.', 422);
      }
      if (coins === undefined || coins === null || coins === '') {
        return ApiResponse.error(res, 'Coins value is required.', 422);
      }
      if (price === undefined || price === null || price === '') {
        return ApiResponse.error(res, 'Price is required.', 422);
      }

      const isPopularVal = is_popular === true || is_popular === 1 || is_popular === '1' || is_popular === 'true' ? 1 : 0;
      const statusVal = status === false || status === 0 || status === '0' || status === 'false' ? 0 : 1;

      const [result] = await pool.query(
        `INSERT INTO purchase_plans (name, coins, bonus_coins, price, currency, badge_text, is_popular, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(name).trim(),
          parseInt(coins, 10) || 0,
          parseInt(bonus_coins, 10) || 0,
          parseFloat(price) || 0,
          currency ? String(currency).trim() : 'INR',
          badge_text ? String(badge_text).trim() : null,
          isPopularVal,
          statusVal,
        ]
      );

      const [newRows] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [result.insertId]);
      return ApiResponse.success(res, { purchase_plan: formatPlan(newRows[0]) }, 'Purchase plan created successfully.', 201);
    } catch (error) {
      console.error('Admin Store Purchase Plan Error:', error);
      return ApiResponse.error(res, 'Failed to create purchase plan.', 500);
    }
  }

  /**
   * PUT /api/v1/admin/membership-plans/:id
   * Update an existing purchase plan.
   *
   * Body (JSON) — all fields optional (only supplied fields are updated):
   *   name, coins, bonus_coins, price, currency, badge_text, is_popular, status
   */
  static async update(req, res) {
    try {
      const planId = req.params.id;
      const {
        name,
        coins,
        bonus_coins,
        price,
        currency,
        badge_text,
        is_popular,
        status,
      } = req.body;

      const [existing] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [planId]);
      if (existing.length === 0) {
        return ApiResponse.error(res, 'Purchase plan not found.', 404);
      }

      const updateFields = [];
      const queryParams = [];

      if (name !== undefined && String(name).trim() !== '') {
        updateFields.push('`name` = ?');
        queryParams.push(String(name).trim());
      }

      if (coins !== undefined && coins !== null && coins !== '') {
        updateFields.push('`coins` = ?');
        queryParams.push(parseInt(coins, 10) || 0);
      }

      if (bonus_coins !== undefined && bonus_coins !== null && bonus_coins !== '') {
        updateFields.push('`bonus_coins` = ?');
        queryParams.push(parseInt(bonus_coins, 10) || 0);
      }

      if (price !== undefined && price !== null && price !== '') {
        updateFields.push('`price` = ?');
        queryParams.push(parseFloat(price) || 0);
      }

      if (currency !== undefined && String(currency).trim() !== '') {
        updateFields.push('`currency` = ?');
        queryParams.push(String(currency).trim());
      }

      if (badge_text !== undefined) {
        updateFields.push('`badge_text` = ?');
        queryParams.push(badge_text ? String(badge_text).trim() : null);
      }

      if (is_popular !== undefined) {
        const isPopularVal = is_popular === true || is_popular === 1 || is_popular === '1' || is_popular === 'true' ? 1 : 0;
        updateFields.push('`is_popular` = ?');
        queryParams.push(isPopularVal);
      }

      if (status !== undefined) {
        const statusVal = status === false || status === 0 || status === '0' || status === 'false' ? 0 : 1;
        updateFields.push('`status` = ?');
        queryParams.push(statusVal);
      }

      if (updateFields.length > 0) {
        queryParams.push(planId);
        await pool.query(
          `UPDATE purchase_plans SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`,
          queryParams
        );
      }

      const [updated] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [planId]);
      return ApiResponse.success(res, { purchase_plan: formatPlan(updated[0]) }, 'Purchase plan updated successfully.');
    } catch (error) {
      console.error('Admin Update Purchase Plan Error:', error);
      return ApiResponse.error(res, 'Failed to update purchase plan.', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/membership-plans/:id
   * Delete a purchase plan.
   */
  static async destroy(req, res) {
    try {
      const planId = req.params.id;

      const [existing] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [planId]);
      if (existing.length === 0) {
        return ApiResponse.error(res, 'Purchase plan not found.', 404);
      }

      await pool.query('DELETE FROM purchase_plans WHERE id = ?', [planId]);
      return ApiResponse.success(res, { plan_id: Number(planId) }, 'Purchase plan deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Purchase Plan Error:', error);
      return ApiResponse.error(res, 'Failed to delete purchase plan.', 500);
    }
  }
}

module.exports = MembershipPlanController;
