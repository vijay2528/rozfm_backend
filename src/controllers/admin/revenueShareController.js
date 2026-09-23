const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

/**
 * Format currency amount to Indian Rupee (INR) format (e.g. ₹8,42,000)
 */
function formatCurrencyINR(amount) {
  const num = Number(amount) || 0;
  const formatted = Math.round(num).toLocaleString('en-IN');
  return `₹${formatted}`;
}

/**
 * Generate 1-2 character initials for user avatar badge (e.g. "Meera Iyer" -> "MI")
 */
function getInitials(name) {
  if (!name || typeof name !== 'string') return 'CR';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'CR';
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Deterministic color palette for avatar circle badge
 */
const AVATAR_COLORS = [
  '#6366F1', // Indigo (MI)
  '#F59E0B', // Amber (AK)
  '#0EA5E9', // Sky Blue (RV)
  '#EF4444', // Red / Rose (SB)
  '#10B981', // Emerald (IG)
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#14B8A6', // Teal
];

function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

class AdminRevenueShareController {
  /**
   * Helper to get global revenue share percentage from settings table
   */
  static async getGlobalRevShareSetting() {
    try {
      const [rows] = await pool.query(
        "SELECT value FROM settings WHERE `key` = 'writer_revenue_share_percentage' LIMIT 1"
      );
      if (rows.length > 0 && rows[0].value) {
        return parseInt(rows[0].value, 10) || 70;
      }
    } catch (e) {
      console.error('Error fetching global rev share setting:', e);
    }
    return 70;
  }

  /**
   * GET /api/v1/admin/revenue-shares OR /api/v1/admin/revenue-share
   * Paginated list of creators with their Rev Share %, current month earnings, and summary metrics
   */
  static async index(req, res) {
    try {
      const {
        search,
        status,
        month,
        year,
        sort_by = 'this_month',
        order = 'DESC',
        page = 1,
        limit = 20,
      } = req.query;

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      const defaultRevShare = await AdminRevenueShareController.getGlobalRevShareSetting();

      // Determine target month & year for "THIS MONTH" column
      let targetMonthSql = 'MONTH(CURRENT_DATE())';
      let targetYearSql = 'YEAR(CURRENT_DATE())';
      let targetMonthParams = [];

      if (month && /^\d{4}-\d{2}$/.test(month)) {
        const [y, m] = month.split('-');
        targetMonthSql = '?';
        targetYearSql = '?';
        targetMonthParams = [parseInt(m, 10), parseInt(y, 10)];
      } else if (month && year) {
        targetMonthSql = '?';
        targetYearSql = '?';
        targetMonthParams = [parseInt(month, 10), parseInt(year, 10)];
      }

      // Where clauses for creators: role = 'creator' OR role = 'Creator'
      let whereClauses = ["(u.role = 'creator' OR u.role = 'Creator')"];
      let queryParams = [];

      if (search) {
        whereClauses.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (status && status !== 'all') {
        const lowerStatus = status.toLowerCase();
        if (lowerStatus === 'inactive' || lowerStatus === 'suspended' || lowerStatus === 'blocked') {
          whereClauses.push('(u.is_blocked = 1 OR u.status = "inactive")');
        } else if (lowerStatus === 'active') {
          whereClauses.push('(u.is_blocked = 0 AND (u.status IS NULL OR u.status = "active"))');
        }
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      // 1. Total count query
      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) as count FROM users u ${whereSql}`,
        queryParams
      );

      // 2. Summary stats across all creators
      const [[{ total_creators }]] = await pool.query(
        `SELECT COUNT(*) as total_creators FROM users u WHERE (u.role = 'creator' OR u.role = 'Creator')`
      );
      const [[{ active_creators }]] = await pool.query(
        `SELECT COUNT(*) as active_creators FROM users u WHERE (u.role = 'creator' OR u.role = 'Creator') AND u.is_blocked = 0`
      );
      const [[{ inactive_creators }]] = await pool.query(
        `SELECT COUNT(*) as inactive_creators FROM users u WHERE (u.role = 'creator' OR u.role = 'Creator') AND u.is_blocked = 1`
      );

      // Total this month revenue across all creators
      const [[{ total_this_month_revenue }]] = await pool.query(
        `SELECT COALESCE(SUM(we.amount), 0) as total_this_month_revenue 
         FROM writer_earnings we 
         JOIN users u ON we.user_id = u.id 
         WHERE (u.role = 'creator' OR u.role = 'Creator')
           AND MONTH(we.created_at) = ${targetMonthSql} 
           AND YEAR(we.created_at) = ${targetYearSql}`,
        targetMonthParams
      );

      // Sort column resolution
      const sortDirection = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      let orderBySql = 'this_month_earnings DESC, u.id ASC';

      if (sort_by === 'name') {
        orderBySql = `u.name ${sortDirection}`;
      } else if (sort_by === 'total_earnings') {
        orderBySql = `total_earnings ${sortDirection}`;
      } else if (sort_by === 'created_at') {
        orderBySql = `u.created_at ${sortDirection}`;
      } else {
        orderBySql = `this_month_earnings ${sortDirection}, u.id ASC`;
      }

      // 3. Paginated list query with subqueries for this_month and total_earnings
      const selectSql = `
        SELECT 
          u.id,
          u.name,
          u.email,
          u.phone,
          u.avatar_path,
          u.is_verified,
          u.is_blocked,
          u.status,
          u.created_at,
          u.updated_at,
          (
            SELECT COALESCE(SUM(we.amount), 0) 
            FROM writer_earnings we 
            WHERE we.user_id = u.id 
              AND MONTH(we.created_at) = ${targetMonthSql} 
              AND YEAR(we.created_at) = ${targetYearSql}
          ) as this_month_earnings,
          (
            SELECT COALESCE(SUM(we2.amount), 0) 
            FROM writer_earnings we2 
            WHERE we2.user_id = u.id
          ) as total_earnings
        FROM users u
        ${whereSql}
        ORDER BY ${orderBySql}
        LIMIT ? OFFSET ?
      `;

      const listParams = [
        ...targetMonthParams,
        ...queryParams,
        limitNum,
        offset,
      ];

      const [rows] = await pool.query(selectSql, listParams);

      // Format records matching UI requirements (rev_share taken directly from settings table)
      const creators = rows.map((c) => {
        const revShareVal = defaultRevShare;
        const thisMonthVal = Number(c.this_month_earnings || 0);
        const totalVal = Number(c.total_earnings || 0);
        const effectiveStatus = c.is_blocked === 1 ? 'inactive' : (c.status || 'active');

        return {
          id: c.id,
          user_id: c.id,
          name: c.name || 'Unnamed Creator',
          email: c.email || null,
          phone: c.phone || null,
          avatar_path: c.avatar_path || null,
          avatar_url: c.avatar_path || null,
          initials: getInitials(c.name),
          avatar_color: getAvatarColor(c.name),
          rev_share: revShareVal,
          rev_share_percentage: revShareVal,
          formatted_rev_share: `${revShareVal}%`,
          this_month: thisMonthVal,
          this_month_earnings: thisMonthVal,
          formatted_this_month: formatCurrencyINR(thisMonthVal),
          total_earnings: totalVal,
          formatted_total_earnings: formatCurrencyINR(totalVal),
          is_verified: Boolean(c.is_verified),
          is_blocked: Boolean(c.is_blocked),
          status: effectiveStatus,
          created_at: c.created_at,
          updated_at: c.updated_at,
        };
      });

      return ApiResponse.success(res, {
        creators,
        data: creators,
        summary: {
          total: Number(total_creators || 0),
          total_creators: Number(total_creators || 0),
          active: Number(active_creators || 0),
          active_creators: Number(active_creators || 0),
          inactive: Number(inactive_creators || 0),
          inactive_creators: Number(inactive_creators || 0),
          default_rev_share: defaultRevShare,
          formatted_default_rev_share: `${defaultRevShare}%`,
          total_this_month_revenue: Number(total_this_month_revenue || 0),
          formatted_total_this_month: formatCurrencyINR(total_this_month_revenue || 0),
        },
        pagination: {
          total: count,
          page: pageNum,
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum) || 1,
        },
      }, 'Revenue share list fetched successfully.');
    } catch (error) {
      console.error('Admin Revenue Share List Error:', error);
      return ApiResponse.error(res, 'Failed to fetch revenue share list.', 500);
    }
  }

  /**
   * GET /api/v1/admin/revenue-shares/export OR /api/v1/admin/revenue-share/export
   * Export revenue share list as CSV or JSON file
   */
  static async exportData(req, res) {
    try {
      const { search, status, month, year, format = 'csv' } = req.query;
      const defaultRevShare = await AdminRevenueShareController.getGlobalRevShareSetting();

      let targetMonthSql = 'MONTH(CURRENT_DATE())';
      let targetYearSql = 'YEAR(CURRENT_DATE())';
      let targetMonthParams = [];

      if (month && /^\d{4}-\d{2}$/.test(month)) {
        const [y, m] = month.split('-');
        targetMonthSql = '?';
        targetYearSql = '?';
        targetMonthParams = [parseInt(m, 10), parseInt(y, 10)];
      } else if (month && year) {
        targetMonthSql = '?';
        targetYearSql = '?';
        targetMonthParams = [parseInt(month, 10), parseInt(year, 10)];
      }

      let whereClauses = ["(u.role = 'creator' OR u.role = 'Creator')"];
      let queryParams = [];

      if (search) {
        whereClauses.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (status && status !== 'all') {
        const lowerStatus = status.toLowerCase();
        if (lowerStatus === 'inactive' || lowerStatus === 'suspended') {
          whereClauses.push('u.is_blocked = 1');
        } else if (lowerStatus === 'active') {
          whereClauses.push('u.is_blocked = 0');
        }
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [rows] = await pool.query(
        `SELECT 
          u.id,
          u.name,
          u.email,
          u.phone,
          u.avatar_path,
          u.is_blocked,
          u.status,
          u.created_at,
          (
            SELECT COALESCE(SUM(we.amount), 0) 
            FROM writer_earnings we 
            WHERE we.user_id = u.id 
              AND MONTH(we.created_at) = ${targetMonthSql} 
              AND YEAR(we.created_at) = ${targetYearSql}
          ) as this_month_earnings,
          (
            SELECT COALESCE(SUM(we2.amount), 0) 
            FROM writer_earnings we2 
            WHERE we2.user_id = u.id
          ) as total_earnings
        FROM users u
        ${whereSql}
        ORDER BY this_month_earnings DESC, u.id ASC`,
        [...targetMonthParams, ...queryParams]
      );

      const records = rows.map((c) => {
        const revShareVal = defaultRevShare;
        const thisMonthVal = Number(c.this_month_earnings || 0);
        const totalVal = Number(c.total_earnings || 0);

        return {
          id: c.id,
          name: c.name || 'Unnamed Creator',
          email: c.email || '',
          phone: c.phone || '',
          rev_share: `${revShareVal}%`,
          this_month: thisMonthVal,
          formatted_this_month: formatCurrencyINR(thisMonthVal),
          total_earnings: totalVal,
          formatted_total: formatCurrencyINR(totalVal),
          status: c.is_blocked === 1 ? 'inactive' : 'active',
          joined_at: c.created_at ? new Date(c.created_at).toISOString().split('T')[0] : '',
        };
      });

      if (format.toLowerCase() === 'json') {
        return ApiResponse.success(res, { creators: records }, 'Revenue share data exported successfully.');
      }

      // Generate CSV
      const headers = ['User ID', 'Name', 'Email', 'Phone', 'Rev Share', 'This Month (INR)', 'Total Revenue (INR)', 'Status', 'Joined Date'];
      const csvLines = [headers.join(',')];

      records.forEach((r) => {
        const line = [
          r.id,
          `"${(r.name || '').replace(/"/g, '""')}"`,
          `"${(r.email || '').replace(/"/g, '""')}"`,
          `"${(r.phone || '').replace(/"/g, '""')}"`,
          `"${r.rev_share}"`,
          `"${r.formatted_this_month}"`,
          `"${r.formatted_total}"`,
          `"${r.status}"`,
          `"${r.joined_at}"`,
        ];
        csvLines.push(line.join(','));
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="rozfm_revenue_shares.csv"');
      return res.status(200).send(csvLines.join('\n'));
    } catch (error) {
      console.error('Admin Export Revenue Share Error:', error);
      return ApiResponse.error(res, 'Failed to export revenue share data.', 500);
    }
  }
}

module.exports = AdminRevenueShareController;
