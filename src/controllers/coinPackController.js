const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

class CoinPackController {
  static async index(req, res) {
    try {
      const [rows] = await pool.query('SELECT * FROM coin_sales WHERE status = 1 ORDER BY amount ASC');

      let coinPacks = rows.map((cp) => ({
        id: Number(cp.id),
        pack_name: cp.pack_name,
        coins: Number(cp.coins),
        amount: Number(cp.amount),
        is_best_value: Boolean(cp.is_best_value),
      }));

      if (coinPacks.length === 0) {
        coinPacks = [
          { id: 1, pack_name: '50 Coins', coins: 50, amount: 49.00, is_best_value: false },
          { id: 2, pack_name: '200 Coins', coins: 200, amount: 149.00, is_best_value: true },
          { id: 3, pack_name: '500 Coins', coins: 500, amount: 349.00, is_best_value: false },
        ];
      }

      return ApiResponse.success(res, { coin_packs: coinPacks });
    } catch (error) {
      console.error('List Coin Packs Error:', error);
      return ApiResponse.error(res, 'Failed to fetch coin packs.', 500);
    }
  }
}

module.exports = CoinPackController;
