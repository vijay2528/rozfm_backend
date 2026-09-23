const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');

async function seedRevenueShareCreators() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('Seeding revenue share sample creators...');

    const creators = [
      {
        name: 'Meera Iyer',
        email: 'meera.iyer@rozfm.com',
        phone: '+919988776655',
        username: 'meera_iyer',
        rev_share_percentage: 70,
        this_month_amount: 842000,
      },
      {
        name: 'Aman Kapoor',
        email: 'aman.kapoor@rozfm.com',
        phone: '+919988776656',
        username: 'aman_kapoor',
        rev_share_percentage: 65,
        this_month_amount: 310500,
      },
      {
        name: 'Rhea Verma',
        email: 'rhea.verma@rozfm.com',
        phone: '+919988776657',
        username: 'rhea_verma',
        rev_share_percentage: 60,
        this_month_amount: 58200,
      },
      {
        name: 'Sanya Bose',
        email: 'sanya.bose@rozfm.com',
        phone: '+919988776658',
        username: 'sanya_bose',
        rev_share_percentage: 72,
        this_month_amount: 1290000,
      },
      {
        name: 'Ishaan Gill',
        email: 'ishaan.gill@rozfm.com',
        phone: '+919988776659',
        username: 'ishaan_gill',
        rev_share_percentage: 55,
        this_month_amount: 14000,
      },
    ];

    const hashedPassword = await bcrypt.hash('CreatorPass123!', 10);

    for (const c of creators) {
      // Check if user already exists by name or email
      const [existing] = await connection.query(
        'SELECT id FROM users WHERE email = ? OR name = ? LIMIT 1',
        [c.email, c.name]
      );

      let userId;
      if (existing.length > 0) {
        userId = existing[0].id;
        await connection.query(
          `UPDATE users 
           SET role = 'creator', role_id = 3, rev_share_percentage = ?, is_blocked = 0, status = 'active'
           WHERE id = ?`,
          [c.rev_share_percentage, userId]
        );
      } else {
        const [inserted] = await connection.query(
          `INSERT INTO users (name, email, phone, username, password, role, role_id, rev_share_percentage, is_verified, is_blocked, status)
           VALUES (?, ?, ?, ?, ?, 'creator', 3, ?, 1, 0, 'active')`,
          [c.name, c.email, c.phone, c.username, hashedPassword, c.rev_share_percentage]
        );
        userId = inserted.insertId;
      }

      // Check current month earnings in writer_earnings
      const [earnings] = await connection.query(
        `SELECT id FROM writer_earnings 
         WHERE user_id = ? AND MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())
         LIMIT 1`,
        [userId]
      );

      if (earnings.length === 0) {
        await connection.query(
          `INSERT INTO writer_earnings (user_id, amount, coins, source_type, description, created_at)
           VALUES (?, ?, ?, 'story_revenue', 'Monthly Creator Revenue Share Payout', NOW())`,
          [userId, c.this_month_amount, c.this_month_amount * 10]
        );
      } else {
        await connection.query(
          `UPDATE writer_earnings SET amount = ? WHERE id = ?`,
          [c.this_month_amount, earnings[0].id]
        );
      }
    }

    console.log('✅ Revenue share sample creators seeded successfully!');
  } catch (err) {
    console.error('Error seeding revenue share creators:', err);
  } finally {
    if (connection) connection.release();
    await pool.end();
  }
}

seedRevenueShareCreators();
