const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

class PlanController {
  static async index(req, res) {
    try {
      let rows = [];

      try {
        const [resRows] = await pool.query('SELECT * FROM purchase_plans WHERE is_active = 1 ORDER BY price ASC');
        rows = resRows;
      } catch (err1) {
        try {
          const [resRows] = await pool.query('SELECT * FROM purchase_plans WHERE status = 1 ORDER BY price ASC');
          rows = resRows;
        } catch (err2) {
          const [resRows] = await pool.query('SELECT * FROM purchase_plans ORDER BY price ASC');
          rows = resRows;
        }
      }

      let plans = (rows || [])
        .filter((p) => {
          if (p.is_active !== undefined && p.is_active !== null) {
            return p.is_active == 1 || p.is_active === true;
          }
          if (p.status !== undefined && p.status !== null) {
            return p.status == 1 || p.status === true;
          }
          return true;
        })
        .map((p) => {
          const priceVal = p.price !== undefined && p.price !== null
            ? Number(p.price)
            : (p.amount !== undefined && p.amount !== null ? Number(p.amount) : 0);

          return {
            id: Number(p.id),
            name: p.name,
            coins: Number(p.coins || 0),
            bonus_coins: Number(p.bonus_coins || 0),
            price: priceVal,
            amount: priceVal,
            currency: p.currency || 'INR',
            badge_text: p.badge_text || null,
            is_popular: Boolean(p.is_popular),
            is_active: p.is_active !== undefined ? Boolean(p.is_active) : (p.status !== undefined ? Boolean(p.status) : true),
            status: p.status !== undefined ? (p.status == 1 ? 1 : 0) : (p.is_active !== undefined ? (p.is_active == 1 ? 1 : 0) : 1),
          };
        });

      if (plans.length === 0) {
        plans = [
          { id: 1, name: 'Starter Pack', coins: 100, bonus_coins: 10, price: 99.00, amount: 99.00, currency: 'INR', badge_text: null, is_popular: false, is_active: true, status: 1 },
          { id: 2, name: 'Value Pack', coins: 500, bonus_coins: 75, price: 399.00, amount: 399.00, currency: 'INR', badge_text: 'POPULAR', is_popular: true, is_active: true, status: 1 },
          { id: 3, name: 'Mega Pack', coins: 1200, bonus_coins: 300, price: 899.00, amount: 899.00, currency: 'INR', badge_text: 'BEST VALUE', is_popular: false, is_active: true, status: 1 },
        ];
      }

      return ApiResponse.success(res, { plans });
    } catch (error) {
      console.error('List Plans Error:', error);
      return ApiResponse.error(res, 'Failed to fetch purchase plans.', 500);
    }
  }
}

module.exports = PlanController;

