const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

/**
 * Ensure coin_transactions table exists and seed sample data if empty.
 */
async function ensureCoinTransactionTable() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`coin_transactions\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`type\` VARCHAR(50) NOT NULL,
        \`coins\` INT NOT NULL,
        \`plan_id\` INT NULL,
        \`coin_pack_id\` INT NULL,
        \`amount\` DECIMAL(10, 2) DEFAULT 0.00,
        \`transaction_type\` VARCHAR(50) DEFAULT 'NULL',
        \`payment_status\` VARCHAR(50) DEFAULT 'NULL',
        \`description\` VARCHAR(255) NULL,
        \`reference_id\` VARCHAR(255) NULL,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_coin_transactions_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    try { await connection.query("ALTER TABLE `coin_transactions` ADD COLUMN IF NOT EXISTS `plan_id` INT NULL AFTER `coins`"); } catch (_) { }
    try { await connection.query("ALTER TABLE `coin_transactions` ADD COLUMN IF NOT EXISTS `coin_pack_id` INT NULL AFTER `plan_id`"); } catch (_) { }
    try { await connection.query("ALTER TABLE `coin_transactions` ADD COLUMN IF NOT EXISTS `amount` DECIMAL(10, 2) DEFAULT 0.00 AFTER `coin_pack_id`"); } catch (_) { }
    try { await connection.query("ALTER TABLE `coin_transactions` ADD COLUMN IF NOT EXISTS `transaction_type` ENUM('credit', 'debit') DEFAULT 'credit' AFTER `amount`"); } catch (_) { }
    try { await connection.query("ALTER TABLE `coin_transactions` ADD COLUMN IF NOT EXISTS `payment_status` VARCHAR(50) DEFAULT 'paid' AFTER `transaction_type`"); } catch (_) { }

    // Check if table is empty
    const [rows] = await connection.query(`SELECT COUNT(*) AS total FROM \`coin_transactions\``);
    if (rows[0].total === 0) {
      // Ensure seed users exist or query existing users
      const [users] = await connection.query(`SELECT id, name FROM \`users\` LIMIT 10`);

      let u1 = users[0]?.id || 1;
      let u2 = users[1]?.id || 2;
      let u3 = users[2]?.id || 3;

      const seedTxns = [
        [u1, 'reward', 100, null, null, 0.00, 'credit', 'paid', 'Streak Milestone Reward (3 Days)', 'STREAK-3D', '2026-07-27 10:30:00'],
        [u2, 'spend', -40, null, null, 0.00, 'debit', 'paid', 'Unlocked Episode #14', 'EP-104', '2026-07-26 14:15:00'],
        [u3, 'coin_pack', 300, null, 2, 199.00, 'credit', 'paid', 'Purchased Popular Coin Pack (₹199)', 'RAZORPAY-8821', '2026-07-25 18:20:00'],
        [u1, 'reward', 400, null, null, 0.00, 'credit', 'paid', 'Daily Listening Bonus & Ad Reward', 'AD-REWARD-99', '2026-07-24 11:45:00'],
        [u2, 'spend', -100, null, null, 0.00, 'debit', 'paid', 'Unlocked Episode #20', 'EP-110', '2026-07-22 09:10:00'],
        [u3, 'coin_pack', 600, null, 4, 399.00, 'credit', 'paid', 'Purchased Mega Coin Pack (₹399)', 'RAZORPAY-9932', '2026-07-19 16:50:00'],
        [u1, 'reward', 700, null, null, 0.00, 'credit', 'paid', 'Referral Bonus Reward', 'REF-2026', '2026-07-28 12:00:00'],
      ];

      for (const txn of seedTxns) {
        await connection.query(
          `INSERT INTO \`coin_transactions\` (\`user_id\`, \`type\`, \`coins\`, \`plan_id\`, \`coin_pack_id\`, \`amount\`, \`transaction_type\`, \`payment_status\`, \`description\`, \`reference_id\`, \`created_at\`)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          txn
        );
      }
    }
  } catch (err) {
    console.error('Error ensuring coin_transactions table:', err.message);
  } finally {
    connection.release();
  }
}

/**
 * Format database row into standard API coin transaction object.
 */
function formatTransaction(t) {
  const coinsNum = Number(t.coins || 0);
  const typeLower = String(t.type || '').toLowerCase();

  let formattedType = 'Reward';
  if (typeLower.includes('purchase') || typeLower.includes('pack') || typeLower.includes('credit') || typeLower.includes('coin')) {
    formattedType = 'Purchase';
  } else if (typeLower.includes('spend') || typeLower.includes('debit') || typeLower.includes('unlock')) {
    formattedType = 'Spend';
  } else if (typeLower.includes('reward') || typeLower.includes('bonus') || typeLower.includes('streak') || typeLower.includes('ad')) {
    formattedType = 'Reward';
  } else {
    formattedType = typeLower.charAt(0).toUpperCase() + typeLower.slice(1);
  }

  const isSpend = formattedType === 'Spend' || coinsNum < 0 || String(t.transaction_type || '').toLowerCase() === 'debit';
  const absCoins = Math.abs(coinsNum);
  const formattedCoins = isSpend ? `-${absCoins}` : `+${absCoins}`;

  let formattedDate = 'Recent';
  if (t.created_at) {
    const d = new Date(t.created_at);
    if (!isNaN(d.getTime())) {
      formattedDate = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }
  }

  const txnNum = 77000 + Number(t.id);
  const txnId = `CN-${txnNum}`;

  const userName = t.user_name || t.user_email || `User #${t.user_id}`;
  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const colors = ['#3E9CF3', '#F2B84B', '#F1495D', '#22C55E', '#8B5CF6', '#EC4899', '#06B6D4'];
  const userColor = colors[Number(t.user_id) % colors.length];

  return {
    id: Number(t.id),
    txn_id: txnId,
    user_id: Number(t.user_id),
    user_name: userName,
    user_email: t.user_email || null,
    user_initials: initials,
    user_color: userColor,
    type: formattedType,
    raw_type: t.type,
    plan_id: t.plan_id ? Number(t.plan_id) : null,
    coin_pack_id: t.coin_pack_id ? Number(t.coin_pack_id) : null,
    amount: Number(t.amount || 0),
    transaction_type: t.transaction_type || (isSpend ? 'debit' : 'credit'),
    payment_status: t.payment_status || 'paid',
    coins: isSpend ? -absCoins : absCoins,
    coins_formatted: formattedCoins,
    date: formattedDate,
    created_at: t.created_at || null,
    description: t.description || null,
    reference_id: t.reference_id || null,
  };
}

class CoinTransactionController {
  /**
   * GET /api/v1/admin/coin-transactions
   */
  static async index(req, res) {
    try {
      await ensureCoinTransactionTable();

      const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limitNum = Math.max(1, parseInt(req.query.limit, 10) || 10);
      const offset = (pageNum - 1) * limitNum;

      let whereClauses = ['1=1'];
      const params = [];

      if (search && search.trim() !== '') {
        const term = `%${search.trim()}%`;
        whereClauses.push('(ct.id LIKE ? OR ct.description LIKE ? OR ct.reference_id LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
        params.push(term, term, term, term, term);
      }

      if (type && type !== 'All' && type !== 'all') {
        const lowerType = type.toLowerCase();
        if (lowerType === 'purchase') {
          whereClauses.push('(ct.type LIKE "%purchase%" OR ct.type LIKE "%credit%" OR ct.type LIKE "%pack%")');
        } else if (lowerType === 'reward') {
          whereClauses.push('(ct.type LIKE "%reward%" OR ct.type LIKE "%bonus%" OR ct.type LIKE "%streak%" OR ct.type LIKE "%ad%")');
        } else if (lowerType === 'spend') {
          whereClauses.push('(ct.type LIKE "%spend%" OR ct.type LIKE "%debit%" OR ct.type LIKE "%unlock%")');
        } else {
          whereClauses.push('ct.type = ?');
          params.push(type);
        }
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [countResult] = await pool.query(
        `SELECT COUNT(*) AS total FROM \`coin_transactions\` ct LEFT JOIN \`users\` u ON ct.user_id = u.id ${whereSql}`,
        params
      );
      const total = countResult[0].total;

      const [rows] = await pool.query(
        `SELECT ct.*, u.name AS user_name, u.email AS user_email
         FROM \`coin_transactions\` ct
         LEFT JOIN \`users\` u ON ct.user_id = u.id
         ${whereSql}
         ORDER BY ct.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      );

      const transactions = rows.map(formatTransaction);

      return ApiResponse.success(
        res,
        {
          transactions,
          coin_transactions: transactions,
          pagination: {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum) || 1,
          },
        },
        'Coin transactions fetched successfully'
      );
    } catch (err) {
      console.error('Error fetching coin transactions:', err);
      return ApiResponse.error(res, err.message || 'Failed to fetch coin transactions', 500);
    }
  }

  /**
   * GET /api/v1/admin/coin-transactions/:id
   */
  static async show(req, res) {
    try {
      await ensureCoinTransactionTable();
      const { id } = req.params;

      const [rows] = await pool.query(
        `SELECT ct.*, u.name AS user_name, u.email AS user_email
         FROM \`coin_transactions\` ct
         LEFT JOIN \`users\` u ON ct.user_id = u.id
         WHERE ct.id = ? OR ct.id = ?`,
        [id, String(id).replace('CN-', '').replace(/^0+/, '')]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Transaction not found', 404);
      }

      const transaction = formatTransaction(rows[0]);
      return ApiResponse.success(
        res,
        {
          transaction,
        },
        'Transaction details retrieved successfully'
      );
    } catch (err) {
      console.error('Error fetching transaction details:', err);
      return ApiResponse.error(res, err.message || 'Failed to fetch transaction details', 500);
    }
  }
}

module.exports = CoinTransactionController;
