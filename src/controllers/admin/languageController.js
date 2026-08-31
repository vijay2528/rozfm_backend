const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

class LanguageController {
  /**
   * GET /api/v1/admin/languages
   * Paginated list of languages with search filter
   */
  static async index(req, res) {
    try {
      const { search, page = 1, limit = 20 } = req.query;
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * limitNum;

      let whereClauses = ['1=1'];
      let queryParams = [];

      if (search) {
        whereClauses.push('(name LIKE ? OR code LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ count }]] = await pool.query(`SELECT COUNT(*) as count FROM languages ${whereSql}`, queryParams);

      const [languages] = await pool.query(
        `SELECT id, name, code, created_at, updated_at
         FROM languages
         ${whereSql}
         ORDER BY id ASC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      const formattedLanguages = languages.map((lang) => ({
        id: Number(lang.id),
        name: lang.name,
        code: lang.code,
        created_at: lang.created_at,
        updated_at: lang.updated_at,
      }));

      return ApiResponse.success(res, {
        languages: formattedLanguages,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('Admin List Languages Error:', error);
      return ApiResponse.error(res, 'Failed to fetch languages list.', 500);
    }
  }
}

module.exports = LanguageController;
