const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

/**
 * Ensure coupon_codes table exists and seed defaults if empty.
 */
async function ensureCouponTable() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`coupon_codes\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`code\` VARCHAR(50) NOT NULL UNIQUE,
        \`discount_type\` ENUM('percentage', 'fixed_amount', 'bonus_coins') NOT NULL DEFAULT 'percentage',
        \`discount_value\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        \`description\` VARCHAR(255) NULL,
        \`applicable_target\` VARCHAR(100) NULL DEFAULT 'all',
        \`max_redemptions\` INT NULL DEFAULT NULL,
        \`redemptions_count\` INT NOT NULL DEFAULT 0,
        \`user_limit\` INT DEFAULT 1,
        \`min_order_amount\` DECIMAL(10,2) DEFAULT 0.00,
        \`expires_at\` DATETIME NULL,
        \`status\` TINYINT(1) DEFAULT 1,
        \`is_active\` TINYINT(1) DEFAULT 1,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Check if table is empty
    const [rows] = await connection.query(`SELECT COUNT(*) AS total FROM \`coupon_codes\``);
    if (rows[0].total === 0) {
      const seedCoupons = [
        ['ROZ50', 'percentage', 50.00, '50% off Gold', 'Gold', 5000, 2410, '2026-08-15 23:59:59', 1],
        ['WELCOME100', 'bonus_coins', 100.00, '100 bonus coins', 'all', null, 18204, null, 1],
        ['MONSOON20', 'percentage', 20.00, '20% off any pack', 'any pack', 10000, 6880, '2026-07-01 23:59:59', 0],
        ['CREATOR2026', 'bonus_coins', 150.00, '150 bonus coins', 'all', 2000, 940, '2026-12-31 23:59:59', 1],
        ['FESTIVE50', 'percentage', 50.00, '50% off festive sale', 'all', 1000, 520, '2026-11-30 23:59:59', 1],
      ];

      for (const coupon of seedCoupons) {
        await connection.query(
          `INSERT INTO \`coupon_codes\` 
           (\`code\`, \`discount_type\`, \`discount_value\`, \`description\`, \`applicable_target\`, \`max_redemptions\`, \`redemptions_count\`, \`expires_at\`, \`status\`) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          coupon
        );
      }
    }
  } catch (err) {
    console.error('Error ensuring coupon_codes table:', err.message);
  } finally {
    connection.release();
  }
}

/**
 * Format database row into standard API coupon object.
 */
function formatCoupon(c) {
  const isExpired = c.expires_at ? new Date(c.expires_at) < new Date() : false;
  let statusText = 'Active';
  if (c.status === 0 || c.is_active === 0) {
    statusText = isExpired ? 'Expired' : 'Inactive';
  } else if (isExpired) {
    statusText = 'Expired';
  }

  let formattedDiscount = c.description;
  if (!formattedDiscount) {
    if (c.discount_type === 'percentage') {
      formattedDiscount = `${Math.round(Number(c.discount_value))}% off`;
    } else if (c.discount_type === 'bonus_coins') {
      formattedDiscount = `${Math.round(Number(c.discount_value))} bonus coins`;
    } else {
      formattedDiscount = `₹${Number(c.discount_value).toFixed(0)} off`;
    }
  }

  let formattedExpires = 'No expiry';
  if (c.expires_at) {
    const d = new Date(c.expires_at);
    if (!isNaN(d.getTime())) {
      formattedExpires = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }
  }

  return {
    id: Number(c.id),
    code: c.code,
    discount: formattedDiscount,
    discount_type: c.discount_type,
    discount_value: Number(c.discount_value),
    description: c.description || formattedDiscount,
    applicable_target: c.applicable_target || 'all',
    max_redemptions: c.max_redemptions !== null ? Number(c.max_redemptions) : null,
    redemptions_count: Number(c.redemptions_count || 0),
    redemptions: Number(c.redemptions_count || 0).toLocaleString('en-US'),
    user_limit: Number(c.user_limit || 1),
    min_order_amount: Number(c.min_order_amount || 0),
    expires_at: c.expires_at || null,
    expires: formattedExpires,
    status: statusText,
    is_active: Boolean(c.status === 1 || c.is_active === 1),
    created_at: c.created_at || null,
    updated_at: c.updated_at || null,
  };
}

class CouponController {
  /**
   * GET /api/v1/admin/coupons
   */
  static async index(req, res) {
    try {
      await ensureCouponTable();

      const { search, status, page = 1, limit = 50 } = req.query;
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
      const limitNum = parseInt(limit, 10);

      let whereClause = 'WHERE 1=1';
      const params = [];

      if (search && search.trim() !== '') {
        whereClause += ' AND (code LIKE ? OR description LIKE ? OR applicable_target LIKE ?)';
        const term = `%${search.trim()}%`;
        params.push(term, term, term);
      }

      if (status && status !== 'All' && status !== 'all') {
        const lowerStatus = status.toLowerCase();
        if (lowerStatus === 'active') {
          whereClause += ' AND (status = 1 AND (expires_at IS NULL OR expires_at >= NOW()))';
        } else if (lowerStatus === 'expired') {
          whereClause += ' AND (expires_at IS NOT NULL AND expires_at < NOW())';
        } else if (lowerStatus === 'inactive') {
          whereClause += ' AND status = 0';
        }
      }

      const [countResult] = await pool.query(
        `SELECT COUNT(*) AS total FROM \`coupon_codes\` ${whereClause}`,
        params
      );
      const total = countResult[0].total;

      const [rows] = await pool.query(
        `SELECT * FROM \`coupon_codes\` ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      );

      const coupons = rows.map(formatCoupon);

      return ApiResponse.success(
        res,
        {
          coupons,
          pagination: {
            total,
            page: parseInt(page, 10),
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum) || 1,
          },
        },
        'Coupons fetched successfully'
      );
    } catch (err) {
      console.error('Error fetching coupons:', err);
      return ApiResponse.error(res, err.message || 'Failed to fetch coupons', 500);
    }
  }

  /**
   * GET /api/v1/admin/coupons/:id
   */
  static async show(req, res) {
    try {
      await ensureCouponTable();
      const { id } = req.params;

      const [rows] = await pool.query(`SELECT * FROM \`coupon_codes\` WHERE id = ?`, [id]);
      if (rows.length === 0) {
        return ApiResponse.error(res, 'Coupon not found', 404);
      }

      const coupon = formatCoupon(rows[0]);
      return ApiResponse.success(
        res,
        {
          coupon,
        },
        'Coupon details retrieved successfully'
      );
    } catch (err) {
      console.error('Error fetching coupon details:', err);
      return ApiResponse.error(res, err.message || 'Failed to fetch coupon details', 500);
    }
  }

  /**
   * POST /api/v1/admin/coupons
   */
  static async store(req, res) {
    try {
      await ensureCouponTable();
      const {
        code,
        discount_type = 'percentage',
        discount_value,
        description,
        applicable_target = 'all',
        max_redemptions = null,
        user_limit = 1,
        min_order_amount = 0,
        expires_at = null,
        status = 1,
        is_active,
      } = req.body;

      if (!code || code.trim() === '') {
        return ApiResponse.error(res, 'Coupon code is required', 400);
      }

      const cleanCode = code.trim().toUpperCase();

      // Check for duplicate code
      const [existing] = await pool.query(`SELECT id FROM \`coupon_codes\` WHERE code = ?`, [cleanCode]);
      if (existing.length > 0) {
        return ApiResponse.error(res, `Coupon code "${cleanCode}" already exists`, 400);
      }

      const statusVal = is_active !== undefined ? (is_active ? 1 : 0) : Number(status ?? 1);

      const [result] = await pool.query(
        `INSERT INTO \`coupon_codes\` 
         (\`code\`, \`discount_type\`, \`discount_value\`, \`description\`, \`applicable_target\`, \`max_redemptions\`, \`user_limit\`, \`min_order_amount\`, \`expires_at\`, \`status\`, \`is_active\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cleanCode,
          discount_type,
          Number(discount_value || 0),
          description || null,
          applicable_target || 'all',
          max_redemptions !== null && max_redemptions !== '' ? Number(max_redemptions) : null,
          Number(user_limit || 1),
          Number(min_order_amount || 0),
          expires_at || null,
          statusVal,
          statusVal,
        ]
      );

      const [newRow] = await pool.query(`SELECT * FROM \`coupon_codes\` WHERE id = ?`, [result.insertId]);
      const created = formatCoupon(newRow[0]);

      return ApiResponse.success(
        res,
        {
          coupon: created,
        },
        `Coupon code ${cleanCode} created successfully`,
        201
      );
    } catch (err) {
      console.error('Error creating coupon:', err);
      return ApiResponse.error(res, err.message || 'Failed to create coupon', 500);
    }
  }

  /**
   * PUT /api/v1/admin/coupons/:id
   */
  static async update(req, res) {
    try {
      await ensureCouponTable();
      const { id } = req.params;

      const [existing] = await pool.query(`SELECT * FROM \`coupon_codes\` WHERE id = ?`, [id]);
      if (existing.length === 0) {
        return ApiResponse.error(res, 'Coupon not found', 404);
      }

      const {
        code,
        discount_type,
        discount_value,
        description,
        applicable_target,
        max_redemptions,
        user_limit,
        min_order_amount,
        expires_at,
        status,
        is_active,
      } = req.body;

      const updates = [];
      const params = [];

      if (code !== undefined) {
        const cleanCode = code.trim().toUpperCase();
        const [dup] = await pool.query(`SELECT id FROM \`coupon_codes\` WHERE code = ? AND id != ?`, [cleanCode, id]);
        if (dup.length > 0) {
          return ApiResponse.error(res, `Coupon code "${cleanCode}" already exists`, 400);
        }
        updates.push('`code` = ?');
        params.push(cleanCode);
      }

      if (discount_type !== undefined) {
        updates.push('`discount_type` = ?');
        params.push(discount_type);
      }

      if (discount_value !== undefined) {
        updates.push('`discount_value` = ?');
        params.push(Number(discount_value));
      }

      if (description !== undefined) {
        updates.push('`description` = ?');
        params.push(description);
      }

      if (applicable_target !== undefined) {
        updates.push('`applicable_target` = ?');
        params.push(applicable_target);
      }

      if (max_redemptions !== undefined) {
        updates.push('`max_redemptions` = ?');
        params.push(max_redemptions !== null && max_redemptions !== '' ? Number(max_redemptions) : null);
      }

      if (user_limit !== undefined) {
        updates.push('`user_limit` = ?');
        params.push(Number(user_limit));
      }

      if (min_order_amount !== undefined) {
        updates.push('`min_order_amount` = ?');
        params.push(Number(min_order_amount));
      }

      if (expires_at !== undefined) {
        updates.push('`expires_at` = ?');
        params.push(expires_at || null);
      }

      if (status !== undefined || is_active !== undefined) {
        const statusVal = is_active !== undefined ? (is_active ? 1 : 0) : Number(status);
        updates.push('`status` = ?', '`is_active` = ?');
        params.push(statusVal, statusVal);
      }

      if (updates.length > 0) {
        params.push(id);
        await pool.query(`UPDATE \`coupon_codes\` SET ${updates.join(', ')} WHERE id = ?`, params);
      }

      const [updatedRow] = await pool.query(`SELECT * FROM \`coupon_codes\` WHERE id = ?`, [id]);
      const updated = formatCoupon(updatedRow[0]);

      return ApiResponse.success(
        res,
        {
          coupon: updated,
        },
        'Coupon updated successfully'
      );
    } catch (err) {
      console.error('Error updating coupon:', err);
      return ApiResponse.error(res, err.message || 'Failed to update coupon', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/coupons/:id
   */
  static async destroy(req, res) {
    try {
      await ensureCouponTable();
      const { id } = req.params;

      const [existing] = await pool.query(`SELECT * FROM \`coupon_codes\` WHERE id = ?`, [id]);
      if (existing.length === 0) {
        return ApiResponse.error(res, 'Coupon not found', 404);
      }

      await pool.query(`DELETE FROM \`coupon_codes\` WHERE id = ?`, [id]);
      return ApiResponse.success(res, null, 'Coupon deleted successfully');
    } catch (err) {
      console.error('Error deleting coupon:', err);
      return ApiResponse.error(res, err.message || 'Failed to delete coupon', 500);
    }
  }
}

module.exports = CouponController;
