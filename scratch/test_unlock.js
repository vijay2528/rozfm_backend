const { pool } = require('../src/config/db');
const EpisodeController = require('../src/controllers/episodeController');

(async () => {
  try {
    // Clean up test data if needed
    await pool.query('INSERT IGNORE INTO users (id, name, phone) VALUES (16, "Test User 16", "1234567890")');
    await pool.query('INSERT IGNORE INTO stories (id, title) VALUES (1, "The Secret Updated")');
    await pool.query('INSERT IGNORE INTO episodes (id, story_id, position, title, is_premium, coins) VALUES (1, 1, 1, "Ep 1", 1, 25), (7, 1, 7, "Ep 7", 1, 25), (8, 1, 8, "Ep 8", 1, 25)');
    await pool.query('INSERT IGNORE INTO user_episode_unlocks (user_id, episode_id, coins_spent) VALUES (16, 7, 25), (16, 8, 25)');

    const req = {
      params: {},
      query: { story_id: 1, page: 1, limit: 10 },
      user: { id: 16 }
    };
    const res = {
      status: (code) => res,
      json: (data) => console.log('RESPONSE:', JSON.stringify(data, null, 2))
    };

    await EpisodeController.index(req, res);
  } catch (e) {
    console.error('Test error:', e);
  } finally {
    process.exit(0);
  }
})();
