const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

class RoleController {
  /**
   * GET /api/v1/admin/roles
   * List all user roles with assigned user counts
   */
  static async index(req, res) {
    try {
      const { search, status, page = 1, limit = 20 } = req.query;
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * limitNum;

      let whereClauses = ['1=1'];
      let queryParams = [];

      if (search) {
        whereClauses.push('(r.name LIKE ? OR r.display_name LIKE ? OR r.description LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (status !== undefined && status !== '') {
        const statusVal = status === '1' || status === 'true' ? 1 : 0;
        whereClauses.push('r.status = ?');
        queryParams.push(statusVal);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ count }]] = await pool.query(`SELECT COUNT(*) as count FROM roles r ${whereSql}`, queryParams);

      const [roles] = await pool.query(
        `SELECT r.id, r.name, r.display_name, r.description, r.permissions, r.is_system, r.status, r.created_at, r.updated_at,
                COUNT(u.id) AS assigned_users_count
         FROM roles r
         LEFT JOIN users u ON u.role_id = r.id OR (u.role = r.name AND u.role_id IS NULL)
         ${whereSql}
         GROUP BY r.id
         ORDER BY r.is_system DESC, r.id ASC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      const formattedRoles = roles.map((role) => {
        let permissionsArr = [];
        try {
          permissionsArr = typeof role.permissions === 'string' ? JSON.parse(role.permissions) : role.permissions || [];
        } catch (_) {
          permissionsArr = [];
        }

        return {
          id: Number(role.id),
          name: role.name,
          display_name: role.display_name,
          description: role.description,
          permissions: permissionsArr,
          is_system: Boolean(role.is_system),
          status: Boolean(role.status),
          assigned_users_count: Number(role.assigned_users_count || 0),
          created_at: role.created_at,
          updated_at: role.updated_at,
        };
      });

      return ApiResponse.success(res, {
        roles: formattedRoles,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('Admin List Roles Error:', error);
      return ApiResponse.error(res, 'Failed to fetch user roles list.', 500);
    }
  }
}

module.exports = RoleController;
