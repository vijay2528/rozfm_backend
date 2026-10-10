const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

class PlanController {
  static async index(req, res) {
    try {
      let rows = [];

      try {
        const [resRows] = await pool.query('SELECT * FROM purchase_plans');
        rows = resRows;
      } catch (err) {
        rows = [];
      }

      let plans = (rows || [])
        .filter((p) => {
          if (p.is_active !== undefined && p.is_active !== null) {
            return p.is_active == 1 || p.is_active === true;
          }
          if (p.status !== undefined && p.status !== null) {
            return p.status == 1 || p.status === true || String(p.status).toLowerCase() === 'active';
          }
          return true;
        })
        .map((p) => {
          const priceVal = p.price !== undefined && p.price !== null
            ? Number(p.price)
            : (p.amount !== undefined && p.amount !== null
                ? Number(p.amount)
                : (p.monthly_amount !== undefined && p.monthly_amount !== null
                    ? Number(p.monthly_amount)
                    : (p.yearly_amount !== undefined && p.yearly_amount !== null ? Number(p.yearly_amount) : 0)));

          const origPrice = p.original_price !== undefined && p.original_price !== null ? Number(p.original_price) : null;

          let featuresList = [];
          if (p.features) {
            if (typeof p.features === 'string') {
              try {
                featuresList = JSON.parse(p.features);
              } catch (_) {
                featuresList = [p.features];
              }
            } else if (Array.isArray(p.features)) {
              featuresList = p.features;
            }
          }

          return {
            id: Number(p.id),
            name: p.name || 'Subscription Plan',
            coins: Number(p.coins || 0),
            bonus_coins: Number(p.bonus_coins || 0),
            price: priceVal,
            amount: priceVal,
            original_price: origPrice,
            monthly_amount: p.monthly_amount !== undefined && p.monthly_amount !== null ? Number(p.monthly_amount) : null,
            yearly_amount: p.yearly_amount !== undefined && p.yearly_amount !== null ? Number(p.yearly_amount) : null,
            currency: p.currency || 'INR',
            badge_text: p.badge_text || null,
            is_popular: Boolean(p.is_popular),
            is_trial: Boolean(p.is_trial),
            trial_days: Number(p.trial_days || 0),
            duration_days: Number(p.duration_days || 30),
            subtitle: p.subtitle || p.description || null,
            features: featuresList,
            renew_plan_id: p.renew_plan_id ? Number(p.renew_plan_id) : null,
            is_active: p.is_active !== undefined ? Boolean(p.is_active) : (p.status !== undefined ? (p.status == 1 || String(p.status).toLowerCase() === 'active') : true),
            status: p.status !== undefined ? (p.status == 1 || String(p.status).toLowerCase() === 'active' ? 1 : 0) : 1,
            sort_order: p.sort_order !== undefined && p.sort_order !== null ? Number(p.sort_order) : 0,
          };
        })
        .sort((a, b) => (a.sort_order || a.price) - (b.sort_order || b.price));

      return ApiResponse.success(res, { plans });
    } catch (error) {
      console.error('List Plans Error:', error);
      return ApiResponse.error(res, 'Failed to fetch purchase plans.', 500);
    }
  }
}

module.exports = PlanController;


