const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

class PlanController {
  static async index(req, res) {
    try {
      const [rows] = await pool.query('SELECT * FROM purchase_plans WHERE status = 1 ORDER BY price ASC');

      let plans = rows.map((p) => ({
        id: Number(p.id),
        name: p.name,
        coins: Number(p.coins),
        bonus_coins: Number(p.bonus_coins || 0),
        price: Number(p.price),
        currency: p.currency || 'INR',
        badge_text: p.badge_text || null,
        is_popular: Boolean(p.is_popular),
      }));

      if (plans.length === 0) {
        plans = [
          { id: 1, name: 'Starter Pack', coins: 100, bonus_coins: 10, price: 99.00, currency: 'INR', badge_text: null, is_popular: false },
          { id: 2, name: 'Value Pack', coins: 500, bonus_coins: 75, price: 399.00, currency: 'INR', badge_text: 'POPULAR', is_popular: true },
          { id: 3, name: 'Mega Pack', coins: 1200, bonus_coins: 300, price: 899.00, currency: 'INR', badge_text: 'BEST VALUE', is_popular: false },
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
