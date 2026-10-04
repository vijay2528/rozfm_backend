const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

/**
 * Ensure database tables for recommendation lists exist and have seed data.
 */
async function ensureRecommendationTables() {
  const connection = await pool.getConnection();
  try {
    // 1. Continue Listening
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`recommendation_continue_listening\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_name\` VARCHAR(120) NOT NULL,
        \`user_initials\` VARCHAR(10) NULL,
        \`user_color\` VARCHAR(20) NULL,
        \`story_title\` VARCHAR(255) NOT NULL,
        \`progress\` INT DEFAULT 0,
        \`last_played\` VARCHAR(50) NOT NULL,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const [rows1] = await connection.query(`SELECT COUNT(*) AS total FROM \`recommendation_continue_listening\``);
    if (rows1[0].total === 0) {
      const items = [
        ['Rohan Mehta', 'RM', '#3E9CF3', 'Whispers of Old Delhi', 31, '2h ago'],
        ['Priya Sharma', 'PS', '#F2B84B', 'Ashes & Ember', 42, '5h ago'],
        ['Vikram Singh', 'VS', '#F1495D', 'Love in Lucknow', 53, '1d ago'],
        ['Sara Ali', 'SA', '#22C55E', 'The Last Signal', 64, '2d ago'],
        ['Karan Malhotra', 'KM', '#8B5CF6', 'Crimson Court', 75, '3d ago'],
        ['Neha Kapoor', 'NK', '#EC4899', 'The Silent Monsoon', 86, '5d ago'],
      ];
      for (const item of items) {
        await connection.query(
          `INSERT INTO \`recommendation_continue_listening\` (\`user_name\`, \`user_initials\`, \`user_color\`, \`story_title\`, \`progress\`, \`last_played\`) VALUES (?, ?, ?, ?, ?, ?)`,
          item
        );
      }
    }

    // 2. Trending
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`recommendation_trending\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`rank\` INT NOT NULL,
        \`story_title\` VARCHAR(255) NOT NULL,
        \`creator_name\` VARCHAR(120) NOT NULL,
        \`velocity\` INT NOT NULL,
        \`color\` VARCHAR(20) DEFAULT '#8B5CF6',
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const [rows2] = await connection.query(`SELECT COUNT(*) AS total FROM \`recommendation_trending\``);
    if (rows2[0].total === 0) {
      const items = [
        [1, 'The Silent Monsoon', 'Meera Iyer', 39, '#8B5CF6'],
        [2, 'Whispers of Old Delhi', 'Aman Kapoor', 34, '#F2B84B'],
        [3, 'Ashes & Ember', 'Rhea Verma', 29, '#3E9CF3'],
        [4, 'Love in Lucknow', 'Sanya Bose', 24, '#F1495D'],
        [5, 'The Last Signal', 'Ishaan Gill', 19, '#22C55E'],
        [6, 'Crimson Court', 'Meera Iyer', 14, '#8B5CF6'],
      ];
      for (const item of items) {
        await connection.query(
          `INSERT INTO \`recommendation_trending\` (\`rank\`, \`story_title\`, \`creator_name\`, \`velocity\`, \`color\`) VALUES (?, ?, ?, ?, ?)`,
          item
        );
      }
    }

    // 3. New Releases
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`recommendation_new_releases\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`story_title\` VARCHAR(255) NOT NULL,
        \`creator_name\` VARCHAR(120) NOT NULL,
        \`published_on\` VARCHAR(50) NOT NULL,
        \`color\` VARCHAR(20) DEFAULT '#8B5CF6',
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const [rows3] = await connection.query(`SELECT COUNT(*) AS total FROM \`recommendation_new_releases\``);
    if (rows3[0].total === 0) {
      const items = [
        ['The Silent Monsoon', 'Meera Iyer', '28 Jul 2026', '#8B5CF6'],
        ['Whispers of Old Delhi', 'Aman Kapoor', '27 Jul 2026', '#F2B84B'],
        ['Ashes & Ember', 'Rhea Verma', '26 Jul 2026', '#3E9CF3'],
        ['Love in Lucknow', 'Sanya Bose', '25 Jul 2026', '#F1495D'],
        ['The Last Signal', 'Ishaan Gill', '24 Jul 2026', '#22C55E'],
        ['Crimson Court', 'Meera Iyer', '22 Jul 2026', '#8B5CF6'],
      ];
      for (const item of items) {
        await connection.query(
          `INSERT INTO \`recommendation_new_releases\` (\`story_title\`, \`creator_name\`, \`published_on\`, \`color\`) VALUES (?, ?, ?, ?)`,
          item
        );
      }
    }

    // 4. Top Picks
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`recommendation_top_picks\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`story_title\` VARCHAR(255) NOT NULL,
        \`creator_name\` VARCHAR(120) NOT NULL,
        \`rating\` DECIMAL(3, 1) NOT NULL,
        \`color\` VARCHAR(20) DEFAULT '#8B5CF6',
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const [rows4] = await connection.query(`SELECT COUNT(*) AS total FROM \`recommendation_top_picks\``);
    if (rows4[0].total === 0) {
      const items = [
        ['The Silent Monsoon', 'Meera Iyer', 4.8, '#8B5CF6'],
        ['Whispers of Old Delhi', 'Aman Kapoor', 4.6, '#F2B84B'],
        ['Love in Lucknow', 'Sanya Bose', 4.9, '#F1495D'],
        ['Crimson Court', 'Meera Iyer', 4.5, '#8B5CF6'],
      ];
      for (const item of items) {
        await connection.query(
          `INSERT INTO \`recommendation_top_picks\` (\`story_title\`, \`creator_name\`, \`rating\`, \`color\`) VALUES (?, ?, ?, ?)`,
          item
        );
      }
    }

    // 5. Recommended
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`recommendation_recommended\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`story_title\` VARCHAR(255) NOT NULL,
        \`recommended_because\` VARCHAR(255) NOT NULL,
        \`match_score\` INT NOT NULL,
        \`color\` VARCHAR(20) DEFAULT '#8B5CF6',
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const [rows5] = await connection.query(`SELECT COUNT(*) AS total FROM \`recommendation_recommended\``);
    if (rows5[0].total === 0) {
      const items = [
        ['The Silent Monsoon', 'Similar to recent listens', 92, '#8B5CF6'],
        ['Whispers of Old Delhi', 'Popular in your genre', 88, '#F2B84B'],
        ['Ashes & Ember', 'Because you liked The Silent Monsoon', 84, '#3E9CF3'],
        ['Love in Lucknow', 'Trending near you', 80, '#F1495D'],
        ['The Last Signal', 'New from a followed creator', 76, '#22C55E'],
        ['Crimson Court', 'Highly rated this week', 72, '#8B5CF6'],
      ];
      for (const item of items) {
        await connection.query(
          `INSERT INTO \`recommendation_recommended\` (\`story_title\`, \`recommended_because\`, \`match_score\`, \`color\`) VALUES (?, ?, ?, ?)`,
          item
        );
      }
    }
  } catch (err) {
    console.error('Error ensuring recommendation tables:', err.message);
  } finally {
    connection.release();
  }
}

class RecommendationController {
  /**
   * 1. GET /api/v1/admin/recommendations/continue-listening
   */
  static async continueListening(req, res) {
    try {
      await ensureRecommendationTables();
      const { search } = req.query;
      const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limitNum = Math.max(1, parseInt(req.query.limit, 10) || 10);
      const offset = (pageNum - 1) * limitNum;

      let whereClauses = ['1=1'];
      const params = [];

      if (search && search.trim() !== '') {
        const term = `%${search.trim()}%`;
        whereClauses.push('(user_name LIKE ? OR story_title LIKE ? OR last_played LIKE ?)');
        params.push(term, term, term);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [countResult] = await pool.query(
        `SELECT COUNT(*) AS total FROM \`recommendation_continue_listening\` ${whereSql}`,
        params
      );
      const total = countResult[0].total;

      const [rows] = await pool.query(
        `SELECT * FROM \`recommendation_continue_listening\` ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      );

      const items = rows.map((r) => ({
        id: Number(r.id),
        name: r.user_name,
        user_name: r.user_name,
        user_initials: r.user_initials || r.user_name.slice(0, 2).toUpperCase(),
        color: r.user_color || '#3E9CF3',
        user_color: r.user_color || '#3E9CF3',
        story: r.story_title,
        story_title: r.story_title,
        progress: Number(r.progress),
        lastPlayed: r.last_played,
        last_played: r.last_played,
      }));

      return ApiResponse.success(
        res,
        {
          items,
          continue_listening: items,
          pagination: {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum) || 1,
          },
        },
        'Continue listening list fetched successfully'
      );
    } catch (err) {
      console.error('Error fetching continue listening list:', err);
      return ApiResponse.error(res, err.message || 'Failed to fetch continue listening list', 500);
    }
  }

  /**
   * 2. GET /api/v1/admin/recommendations/trending
   */
  static async trending(req, res) {
    try {
      await ensureRecommendationTables();
      const { search } = req.query;
      const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limitNum = Math.max(1, parseInt(req.query.limit, 10) || 10);
      const offset = (pageNum - 1) * limitNum;

      let whereClauses = ['1=1'];
      const params = [];

      if (search && search.trim() !== '') {
        const term = `%${search.trim()}%`;
        whereClauses.push('(story_title LIKE ? OR creator_name LIKE ?)');
        params.push(term, term);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [countResult] = await pool.query(
        `SELECT COUNT(*) AS total FROM \`recommendation_trending\` ${whereSql}`,
        params
      );
      const total = countResult[0].total;

      const [rows] = await pool.query(
        `SELECT * FROM \`recommendation_trending\` ${whereSql} ORDER BY rank ASC LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      );

      const items = rows.map((r) => ({
        id: Number(r.id),
        rank: Number(r.rank),
        title: r.story_title,
        story_title: r.story_title,
        creator: r.creator_name,
        creator_name: r.creator_name,
        velocity: Number(r.velocity),
        velocity_formatted: `+${r.velocity}%`,
        color: r.color || '#8B5CF6',
      }));

      return ApiResponse.success(
        res,
        {
          items,
          trending: items,
          pagination: {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum) || 1,
          },
        },
        'Trending list fetched successfully'
      );
    } catch (err) {
      console.error('Error fetching trending list:', err);
      return ApiResponse.error(res, err.message || 'Failed to fetch trending list', 500);
    }
  }

  /**
   * 3. GET /api/v1/admin/recommendations/new-releases
   */
  static async newReleases(req, res) {
    try {
      await ensureRecommendationTables();
      const { search } = req.query;
      const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limitNum = Math.max(1, parseInt(req.query.limit, 10) || 10);
      const offset = (pageNum - 1) * limitNum;

      let whereClauses = ['1=1'];
      const params = [];

      if (search && search.trim() !== '') {
        const term = `%${search.trim()}%`;
        whereClauses.push('(story_title LIKE ? OR creator_name LIKE ? OR published_on LIKE ?)');
        params.push(term, term, term);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [countResult] = await pool.query(
        `SELECT COUNT(*) AS total FROM \`recommendation_new_releases\` ${whereSql}`,
        params
      );
      const total = countResult[0].total;

      const [rows] = await pool.query(
        `SELECT * FROM \`recommendation_new_releases\` ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      );

      const items = rows.map((r) => ({
        id: Number(r.id),
        title: r.story_title,
        story_title: r.story_title,
        creator: r.creator_name,
        creator_name: r.creator_name,
        publishedOn: r.published_on,
        published_on: r.published_on,
        color: r.color || '#8B5CF6',
      }));

      return ApiResponse.success(
        res,
        {
          items,
          new_releases: items,
          pagination: {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum) || 1,
          },
        },
        'New releases list fetched successfully'
      );
    } catch (err) {
      console.error('Error fetching new releases list:', err);
      return ApiResponse.error(res, err.message || 'Failed to fetch new releases list', 500);
    }
  }

  /**
   * 4. GET /api/v1/admin/recommendations/top-picks
   */
  static async topPicks(req, res) {
    try {
      await ensureRecommendationTables();
      const { search } = req.query;
      const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limitNum = Math.max(1, parseInt(req.query.limit, 10) || 10);
      const offset = (pageNum - 1) * limitNum;

      let whereClauses = ['1=1'];
      const params = [];

      if (search && search.trim() !== '') {
        const term = `%${search.trim()}%`;
        whereClauses.push('(story_title LIKE ? OR creator_name LIKE ?)');
        params.push(term, term);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [countResult] = await pool.query(
        `SELECT COUNT(*) AS total FROM \`recommendation_top_picks\` ${whereSql}`,
        params
      );
      const total = countResult[0].total;

      const [rows] = await pool.query(
        `SELECT * FROM \`recommendation_top_picks\` ${whereSql} ORDER BY rating DESC LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      );

      const items = rows.map((r) => ({
        id: Number(r.id),
        title: r.story_title,
        story_title: r.story_title,
        creator: r.creator_name,
        creator_name: r.creator_name,
        rating: Number(r.rating),
        color: r.color || '#8B5CF6',
      }));

      return ApiResponse.success(
        res,
        {
          items,
          top_picks: items,
          pagination: {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum) || 1,
          },
        },
        'Top picks list fetched successfully'
      );
    } catch (err) {
      console.error('Error fetching top picks list:', err);
      return ApiResponse.error(res, err.message || 'Failed to fetch top picks list', 500);
    }
  }

  /**
   * 5. GET /api/v1/admin/recommendations/recommended
   */
  static async recommended(req, res) {
    try {
      await ensureRecommendationTables();
      const { search } = req.query;
      const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limitNum = Math.max(1, parseInt(req.query.limit, 10) || 10);
      const offset = (pageNum - 1) * limitNum;

      let whereClauses = ['1=1'];
      const params = [];

      if (search && search.trim() !== '') {
        const term = `%${search.trim()}%`;
        whereClauses.push('(story_title LIKE ? OR recommended_because LIKE ?)');
        params.push(term, term);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [countResult] = await pool.query(
        `SELECT COUNT(*) AS total FROM \`recommendation_recommended\` ${whereSql}`,
        params
      );
      const total = countResult[0].total;

      const [rows] = await pool.query(
        `SELECT * FROM \`recommendation_recommended\` ${whereSql} ORDER BY match_score DESC LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      );

      const items = rows.map((r) => ({
        id: Number(r.id),
        title: r.story_title,
        story_title: r.story_title,
        reason: r.recommended_because,
        recommended_because: r.recommended_because,
        score: `${r.match_score}%`,
        match_score: Number(r.match_score),
        color: r.color || '#8B5CF6',
      }));

      return ApiResponse.success(
        res,
        {
          items,
          recommended: items,
          pagination: {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum) || 1,
          },
        },
        'Recommended story list fetched successfully'
      );
    } catch (err) {
      console.error('Error fetching recommended list:', err);
      return ApiResponse.error(res, err.message || 'Failed to fetch recommended list', 500);
    }
  }
}

module.exports = RecommendationController;
