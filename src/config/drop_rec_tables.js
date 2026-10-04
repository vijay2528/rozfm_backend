const { pool } = require('./db');

async function dropTables() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('Dropping 5 temporary recommendation tables...');
    await connection.query(`DROP TABLE IF EXISTS \`recommendation_continue_listening\`;`);
    await connection.query(`DROP TABLE IF EXISTS \`recommendation_trending\`;`);
    await connection.query(`DROP TABLE IF EXISTS \`recommendation_new_releases\`;`);
    await connection.query(`DROP TABLE IF EXISTS \`recommendation_top_picks\`;`);
    await connection.query(`DROP TABLE IF EXISTS \`recommendation_recommended\`;`);
    console.log('✅ Successfully dropped temporary recommendation tables!');
  } catch (err) {
    console.error('Error dropping tables:', err.message);
  } finally {
    if (connection) connection.release();
    process.exit(0);
  }
}

dropTables();
