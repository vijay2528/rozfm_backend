const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

class MonetizationController {
  // ── Subscription Plans CRUD ─────────────────────────────────────────────

  static async listPlans(req, res) {
    try {
      const [plans] = await pool.query('SELECT * FROM purchase_plans ORDER BY price ASC');
      return ApiResponse.success(res, { plans });
    } catch (error) {
      console.error('Admin List Plans Error:', error);
      return ApiResponse.error(res, 'Failed to fetch subscription plans.', 500);
    }
  }

  static async storePlan(req, res) {
    try {
      const { name, coins, bonus_coins, price, currency, badge_text, is_popular, status } = req.body;

      if (!name || price === undefined) {
        return ApiResponse.error(res, 'Plan name and price are required.', 422);
      }

      const [result] = await pool.query(
        `INSERT INTO purchase_plans (name, coins, bonus_coins, price, currency, badge_text, is_popular, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name.trim(),
          coins ? parseInt(coins, 10) : 0,
          bonus_coins ? parseInt(bonus_coins, 10) : 0,
          parseFloat(price),
          currency || 'INR',
          badge_text || null,
          is_popular === '1' || is_popular === 1 || is_popular === true ? 1 : 0,
          status === '0' || status === 0 || status === false ? 0 : 1,
        ]
      );

      const [newPlan] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [result.insertId]);
      return ApiResponse.success(res, { plan: newPlan[0] }, 'Plan created successfully.', 201);
    } catch (error) {
      console.error('Admin Store Plan Error:', error);
      return ApiResponse.error(res, 'Failed to create subscription plan.', 500);
    }
  }

  static async updatePlan(req, res) {
    try {
      const planId = req.params.id;
      const { name, coins, bonus_coins, price, currency, badge_text, is_popular, status } = req.body;

      const [rows] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [planId]);
      if (rows.length === 0) {
        return ApiResponse.error(res, 'Plan not found.', 444);
      }

      const updateFields = [];
      const queryParams = [];

      if (name) { updateFields.push('`name` = ?'); queryParams.push(name.trim()); }
      if (coins !== undefined) { updateFields.push('`coins` = ?'); queryParams.push(parseInt(coins, 10)); }
      if (bonus_coins !== undefined) { updateFields.push('`bonus_coins` = ?'); queryParams.push(parseInt(bonus_coins, 10)); }
      if (price !== undefined) { updateFields.push('`price` = ?'); queryParams.push(parseFloat(price)); }
      if (currency) { updateFields.push('`currency` = ?'); queryParams.push(currency); }
      if (badge_text !== undefined) { updateFields.push('`badge_text` = ?'); queryParams.push(badge_text); }
      if (is_popular !== undefined) { updateFields.push('`is_popular` = ?'); queryParams.push(is_popular ? 1 : 0); }
      if (status !== undefined) { updateFields.push('`status` = ?'); queryParams.push(status ? 1 : 0); }

      if (updateFields.length > 0) {
        queryParams.push(planId);
        await pool.query(`UPDATE purchase_plans SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`, queryParams);
      }

      const [updated] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [planId]);
      return ApiResponse.success(res, { plan: updated[0] }, 'Plan updated successfully.');
    } catch (error) {
      console.error('Admin Update Plan Error:', error);
      return ApiResponse.error(res, 'Failed to update plan.', 500);
    }
  }

  static async deletePlan(req, res) {
    try {
      const planId = req.params.id;
      await pool.query('DELETE FROM purchase_plans WHERE id = ?', [planId]);
      return ApiResponse.success(res, { plan_id: Number(planId) }, 'Plan deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Plan Error:', error);
      return ApiResponse.error(res, 'Failed to delete plan.', 500);
    }
  }

  // ── Coin Packs CRUD ──────────────────────────────────────────────────────

  static async listPacks(req, res) {
    try {
      const [packs] = await pool.query('SELECT * FROM coin_sales ORDER BY amount ASC');
      const formattedPacks = packs.map((p) => ({
        id: Number(p.id),
        name: p.pack_name,
        pack_name: p.pack_name,
        coins: Number(p.coins || 0),
        price: Number(p.amount || 0),
        amount: Number(p.amount || 0),
        bonus: Number(p.bonus || 0),
        is_best_value: Boolean(p.is_best_value),
        status: Number(p.status),
        created_at: p.created_at,
        updated_at: p.updated_at,
      }));
      return ApiResponse.success(res, { coin_packs: formattedPacks });
    } catch (error) {
      console.error('Admin List Coin Packs Error:', error);
      return ApiResponse.error(res, 'Failed to fetch coin packs.', 500);
    }
  }

  static async showPack(req, res) {
    try {
      const packId = req.params.id;
      const [rows] = await pool.query('SELECT * FROM coin_sales WHERE id = ? LIMIT 1', [packId]);
      if (rows.length === 0) {
        return ApiResponse.error(res, 'Coin pack not found.', 444);
      }
      const p = rows[0];
      const coinPack = {
        id: Number(p.id),
        name: p.pack_name,
        pack_name: p.pack_name,
        coins: Number(p.coins || 0),
        price: Number(p.amount || 0),
        amount: Number(p.amount || 0),
        bonus: Number(p.bonus || 0),
        is_best_value: Boolean(p.is_best_value),
        status: Number(p.status),
        created_at: p.created_at,
        updated_at: p.updated_at,
      };
      return ApiResponse.success(res, { coin_pack: coinPack });
    } catch (error) {
      console.error('Admin Show Coin Pack Error:', error);
      return ApiResponse.error(res, 'Failed to fetch coin pack details.', 500);
    }
  }

  static async storePack(req, res) {
    try {
      const packName = req.body.name || req.body.pack_name;
      const amountVal = req.body.price !== undefined ? req.body.price : req.body.amount;
      const coinsVal = req.body.coins !== undefined ? req.body.coins : 0;
      const bonusVal = req.body.bonus !== undefined ? req.body.bonus : (req.body.bonus_coins !== undefined ? req.body.bonus_coins : 0);
      const { is_best_value, status } = req.body;

      if (!packName || amountVal === undefined) {
        return ApiResponse.error(res, 'Pack name and price/amount are required.', 422);
      }

      const [result] = await pool.query(
        'INSERT INTO coin_sales (pack_name, coins, bonus, amount, is_best_value, status) VALUES (?, ?, ?, ?, ?, ?)',
        [
          String(packName).trim(),
          parseInt(coinsVal, 10) || 0,
          parseInt(bonusVal, 10) || 0,
          parseFloat(amountVal) || 0,
          is_best_value === '1' || is_best_value === 1 || is_best_value === true ? 1 : 0,
          status === '0' || status === 0 || status === false ? 0 : 1,
        ]
      );

      const [rows] = await pool.query('SELECT * FROM coin_sales WHERE id = ? LIMIT 1', [result.insertId]);
      const p = rows[0];
      const coinPack = {
        id: Number(p.id),
        name: p.pack_name,
        pack_name: p.pack_name,
        coins: Number(p.coins || 0),
        price: Number(p.amount || 0),
        amount: Number(p.amount || 0),
        bonus: Number(p.bonus || 0),
        is_best_value: Boolean(p.is_best_value),
        status: Number(p.status),
        created_at: p.created_at,
        updated_at: p.updated_at,
      };

      return ApiResponse.success(res, { coin_pack: coinPack }, 'Coin pack created successfully.', 201);
    } catch (error) {
      console.error('Admin Store Coin Pack Error:', error);
      return ApiResponse.error(res, 'Failed to create coin pack.', 500);
    }
  }

  static async updatePack(req, res) {
    try {
      const packId = req.params.id;
      const packName = req.body.name || req.body.pack_name;
      const amountVal = req.body.price !== undefined ? req.body.price : req.body.amount;
      const coinsVal = req.body.coins;
      const bonusVal = req.body.bonus !== undefined ? req.body.bonus : req.body.bonus_coins;
      const { is_best_value, status } = req.body;

      const [existing] = await pool.query('SELECT * FROM coin_sales WHERE id = ? LIMIT 1', [packId]);
      if (existing.length === 0) {
        return ApiResponse.error(res, 'Coin pack not found.', 444);
      }

      const updateFields = [];
      const queryParams = [];

      if (packName !== undefined) { updateFields.push('`pack_name` = ?'); queryParams.push(String(packName).trim()); }
      if (coinsVal !== undefined) { updateFields.push('`coins` = ?'); queryParams.push(parseInt(coinsVal, 10) || 0); }
      if (bonusVal !== undefined) { updateFields.push('`bonus` = ?'); queryParams.push(parseInt(bonusVal, 10) || 0); }
      if (amountVal !== undefined) { updateFields.push('`amount` = ?'); queryParams.push(parseFloat(amountVal) || 0); }
      if (is_best_value !== undefined) { updateFields.push('`is_best_value` = ?'); queryParams.push(is_best_value ? 1 : 0); }
      if (status !== undefined) { updateFields.push('`status` = ?'); queryParams.push(status ? 1 : 0); }

      if (updateFields.length > 0) {
        queryParams.push(packId);
        await pool.query(`UPDATE coin_sales SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`, queryParams);
      }

      const [updated] = await pool.query('SELECT * FROM coin_sales WHERE id = ? LIMIT 1', [packId]);
      const p = updated[0];
      const coinPack = {
        id: Number(p.id),
        name: p.pack_name,
        pack_name: p.pack_name,
        coins: Number(p.coins || 0),
        price: Number(p.amount || 0),
        amount: Number(p.amount || 0),
        bonus: Number(p.bonus || 0),
        is_best_value: Boolean(p.is_best_value),
        status: Number(p.status),
        created_at: p.created_at,
        updated_at: p.updated_at,
      };

      return ApiResponse.success(res, { coin_pack: coinPack }, 'Coin pack updated successfully.');
    } catch (error) {
      console.error('Admin Update Coin Pack Error:', error);
      return ApiResponse.error(res, 'Failed to update coin pack.', 500);
    }
  }

  static async deletePack(req, res) {
    try {
      const packId = req.params.id;
      const [existing] = await pool.query('SELECT * FROM coin_sales WHERE id = ? LIMIT 1', [packId]);
      if (existing.length === 0) {
        return ApiResponse.error(res, 'Coin pack not found.', 444);
      }
      await pool.query('DELETE FROM coin_sales WHERE id = ?', [packId]);
      return ApiResponse.success(res, { pack_id: Number(packId) }, 'Coin pack deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Coin Pack Error:', error);
      return ApiResponse.error(res, 'Failed to delete coin pack.', 500);
    }
  }

  // ── Financial Transactions Log ──────────────────────────────────────────

  static async listTransactions(req, res) {
    try {
      const { type, search, page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

      let whereClauses = ['1=1'];
      let queryParams = [];

      if (type) {
        whereClauses.push('ct.type = ?');
        queryParams.push(type);
      }

      if (search) {
        whereClauses.push('(u.name LIKE ? OR u.email LIKE ? OR ct.description LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) as count FROM coin_transactions ct LEFT JOIN users u ON ct.user_id = u.id ${whereSql}`,
        queryParams
      );

      const [transactions] = await pool.query(
        `SELECT ct.*, u.name as user_name, u.email as user_email, u.phone as user_phone
         FROM coin_transactions ct
         LEFT JOIN users u ON ct.user_id = u.id
         ${whereSql}
         ORDER BY ct.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ApiResponse.success(res, {
        transactions,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('Admin List Transactions Error:', error);
      return ApiResponse.error(res, 'Failed to fetch transaction logs.', 500);
    }
  }
}

module.exports = MonetizationController;
