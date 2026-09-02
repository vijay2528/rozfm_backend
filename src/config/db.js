const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'rozfm_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

/**
 * Verify database connectivity on server startup
 */
async function checkConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log('✅ Connected to MySQL database successfully.');

    // Run table migrations automatically only if explicitly enabled in .env (e.g. RUN_MIGRATIONS=true)
    if (process.env.RUN_MIGRATIONS === 'true') {
      const runMigrations = require('./migrate');
      await runMigrations();
    }
  } catch (error) {
    console.error('❌ Failed to connect to MySQL database:', error.message);
    throw error;
  }
}

module.exports = {
  pool,
  checkConnection,
  initDb: checkConnection,
};
