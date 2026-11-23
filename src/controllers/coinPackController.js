const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

class CoinPackController {
  /**
   * Check if a coin pack or plan object represents a Welcome Offer
   * @param {Object} pack
   * @returns {boolean}
   */
  static isWelcomePack(pack) {
    if (!pack) return false;
    const prodId = String(pack.product_id || '').toLowerCase();
    const name = String(pack.pack_name || pack.name || '').toLowerCase();
    const desc = String(pack.description || '').toLowerCase();
    const slug = String(pack.slug || '').toLowerCase();
    return (
      Boolean(pack.is_welcome_offer) ||
      prodId.includes('welcome') ||
      name.includes('welcome') ||
      desc.includes('welcome') ||
      slug.includes('welcome')
    );
  }

  /**
   * Has this user ever purchased a Welcome Offer pack or plan?
   * Checks coin_transactions (permanent log) for any paid welcome pack transactions.
   * @param {number|string} userId
   * @returns {Promise<boolean>}
   */
  static async hasPurchasedWelcomeOffer(userId) {
    if (!userId) return false;
    try {
      const [rows] = await pool.query(
        `SELECT 1 FROM coin_transactions ct
         LEFT JOIN coin_sales cs ON cs.id = ct.coin_pack_id
         LEFT JOIN purchase_plans pp ON pp.id = ct.plan_id
         WHERE ct.user_id = ?
           AND (ct.payment_status = 'paid' OR ct.payment_status = 'success')
           AND (
             LOWER(COALESCE(cs.product_id, '')) LIKE '%welcome%'
             OR LOWER(COALESCE(cs.pack_name, '')) LIKE '%welcome%'
             OR LOWER(COALESCE(pp.product_id, '')) LIKE '%welcome%'
             OR LOWER(COALESCE(pp.name, '')) LIKE '%welcome%'
             OR LOWER(COALESCE(ct.description, '')) LIKE '%welcome%'
           )
         LIMIT 1`,
        [userId]
      );
      if (rows && rows.length > 0) return true;
    } catch (err) {
      console.warn('[CoinPackController] Error checking welcome offer purchases:', err.message);
    }
    return false;
  }

  static async index(req, res) {
    try {
      const [rows] = await pool.query('SELECT * FROM coin_sales WHERE status = 1 OR status = "active" ORDER BY amount ASC');

      const userId = req.user?.id || null;
      const welcomeOfferPurchased = await CoinPackController.hasPurchasedWelcomeOffer(userId);

      let coinPacks = rows.map((cp) => {
        const isWelcome = CoinPackController.isWelcomePack(cp);
        return {
          id: Number(cp.id),
          product_id: cp.product_id || null,
          name: cp.pack_name,
          pack_name: cp.pack_name,
          description: cp.description || null,
          coins: Number(cp.coins || 0),
          bonus: Number(cp.bonus || 0),
          price: Number(cp.amount || 0),
          amount: Number(cp.amount || 0),
          currency: cp.currency || 'INR',
          region: cp.region || 'IN',
          is_best_value: Boolean(cp.is_best_value),
          is_welcome_offer: isWelcome,
          status: cp.status === 1 || cp.status === 'active' ? 'active' : 'inactive',
        };
      });

      if (coinPacks.length === 0) {
        coinPacks = [
          { id: 1, pack_name: '50 Coins', coins: 50, amount: 49.00, is_best_value: false, is_welcome_offer: false },
          { id: 2, pack_name: '200 Coins', coins: 200, amount: 149.00, is_best_value: true, is_welcome_offer: false },
          { id: 3, pack_name: '500 Coins', coins: 500, amount: 349.00, is_best_value: false, is_welcome_offer: false },
        ];
      }

      // If user has already purchased the Welcome Offer, do not allow purchasing it again
      // Remove it from the available coin packs list for this account
      if (welcomeOfferPurchased) {
        coinPacks = coinPacks.filter((cp) => !cp.is_welcome_offer);
      }

      return ApiResponse.success(res, {
        coin_packs: coinPacks,
        welcome_offer_purchased: welcomeOfferPurchased,
        can_purchase_welcome_offer: !welcomeOfferPurchased,
      });
    } catch (error) {
      console.error('List Coin Packs Error:', error);
      return ApiResponse.error(res, 'Failed to fetch coin packs.', 500);
    }
  }
}

module.exports = CoinPackController;
