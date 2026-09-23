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
        whereClauses.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR u.username LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
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

      if (sort_by === 'rev_share' || sort_by === 'rev_share_percentage') {
        orderBySql = `effective_rev_share ${sortDirection}, this_month_earnings DESC`;
      } else if (sort_by === 'name') {
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
          u.username,
          u.avatar_path,
          u.rev_share_percentage,
          u.is_verified,
          u.is_blocked,
          u.status,
          u.created_at,
          u.updated_at,
          COALESCE(u.rev_share_percentage, ?) as effective_rev_share,
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
        defaultRevShare,
        ...targetMonthParams,
        ...queryParams,
        limitNum,
        offset,
      ];

      const [rows] = await pool.query(selectSql, listParams);

      // Format records matching UI requirements
      const creators = rows.map((c) => {
        const hasCustomRevShare = c.rev_share_percentage !== null && c.rev_share_percentage !== undefined;
        const revShareVal = hasCustomRevShare ? Number(c.rev_share_percentage) : defaultRevShare;
        const thisMonthVal = Number(c.this_month_earnings || 0);
        const totalVal = Number(c.total_earnings || 0);
        const effectiveStatus = c.is_blocked === 1 ? 'inactive' : (c.status || 'active');

        return {
          id: c.id,
          user_id: c.id,
          name: c.name || 'Unnamed Creator',
          email: c.email || null,
          phone: c.phone || null,
          username: c.username || null,
          avatar_path: c.avatar_path || null,
          avatar_url: c.avatar_path || null,
          initials: getInitials(c.name),
          avatar_color: getAvatarColor(c.name),
          rev_share: revShareVal,
          rev_share_percentage: revShareVal,
          is_custom_rev_share: hasCustomRevShare,
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
   * GET /api/v1/admin/revenue-share/:id
   * Get single creator revenue share details, historical monthly earnings, and platform split breakdown
   */
  static async show(req, res) {
    try {
      const creatorId = req.params.id;
      const defaultRevShare = await AdminRevenueShareController.getGlobalRevShareSetting();

      const [rows] = await pool.query(
        `SELECT 
          u.id,
          u.name,
          u.email,
          u.phone,
          u.username,
          u.avatar_path,
          u.bio,
          u.rev_share_percentage,
          u.is_verified,
          u.is_blocked,
          u.status,
          u.created_at,
          u.updated_at,
          (
            SELECT COALESCE(SUM(we.amount), 0) 
            FROM writer_earnings we 
            WHERE we.user_id = u.id 
              AND MONTH(we.created_at) = MONTH(CURRENT_DATE()) 
              AND YEAR(we.created_at) = YEAR(CURRENT_DATE())
          ) as this_month_earnings,
          (
            SELECT COALESCE(SUM(we2.amount), 0) 
            FROM writer_earnings we2 
            WHERE we2.user_id = u.id
          ) as total_earnings,
          (
            SELECT COUNT(*) 
            FROM stories s 
            WHERE s.user_id = u.id
          ) as stories_count
        FROM users u 
        WHERE u.id = ? AND (u.role = 'creator' OR u.role = 'Creator')
        LIMIT 1`,
        [creatorId]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Creator not found.', 404);
      }

      const c = rows[0];
      const hasCustom = c.rev_share_percentage !== null && c.rev_share_percentage !== undefined;
      const revShareVal = hasCustom ? Number(c.rev_share_percentage) : defaultRevShare;
      const platformShareVal = 100 - revShareVal;
      const thisMonthVal = Number(c.this_month_earnings || 0);
      const totalVal = Number(c.total_earnings || 0);

      // Monthly earnings breakdown for the last 6 months
      const [monthlyRows] = await pool.query(
        `SELECT 
          DATE_FORMAT(created_at, '%Y-%m') as \`month\`,
          COALESCE(SUM(amount), 0) as amount
         FROM writer_earnings
         WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
         GROUP BY DATE_FORMAT(created_at, '%Y-%m')
         ORDER BY \`month\` DESC`,
        [creatorId]
      );

      const monthlyHistory = monthlyRows.map((m) => ({
        month: m.month,
        amount: Number(m.amount || 0),
        formatted_amount: formatCurrencyINR(m.amount || 0),
      }));

      // Recent 10 earnings records
      const [recentEarnings] = await pool.query(
        `SELECT 
          id,
          amount,
          coins,
          source_type,
          description,
          created_at
         FROM writer_earnings
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 10`,
        [creatorId]
      );

      const creatorDetails = {
        id: c.id,
        user_id: c.id,
        name: c.name || 'Unnamed Creator',
        email: c.email || null,
        phone: c.phone || null,
        username: c.username || null,
        avatar_path: c.avatar_path || null,
        avatar_url: c.avatar_path || null,
        initials: getInitials(c.name),
        avatar_color: getAvatarColor(c.name),
        bio: c.bio || null,
        rev_share: revShareVal,
        rev_share_percentage: revShareVal,
        formatted_rev_share: `${revShareVal}%`,
        platform_share_percentage: platformShareVal,
        formatted_platform_share: `${platformShareVal}%`,
        is_custom_rev_share: hasCustom,
        default_platform_rev_share: defaultRevShare,
        this_month_earnings: thisMonthVal,
        formatted_this_month: formatCurrencyINR(thisMonthVal),
        total_earnings: totalVal,
        formatted_total_earnings: formatCurrencyINR(totalVal),
        stories_count: Number(c.stories_count || 0),
        status: c.is_blocked === 1 ? 'inactive' : (c.status || 'active'),
        is_verified: Boolean(c.is_verified),
        created_at: c.created_at,
        updated_at: c.updated_at,
        monthly_history: monthlyHistory,
        recent_earnings: recentEarnings.map((r) => ({
          id: r.id,
          amount: Number(r.amount || 0),
          formatted_amount: formatCurrencyINR(r.amount || 0),
          coins: Number(r.coins || 0),
          source_type: r.source_type,
          description: r.description,
          created_at: r.created_at,
        })),
      };

      return ApiResponse.success(res, creatorDetails, 'Creator revenue share details fetched successfully.');
    } catch (error) {
      console.error('Admin Show Revenue Share Error:', error);
      return ApiResponse.error(res, 'Failed to fetch creator revenue share details.', 500);
    }
  }

  /**
   * PUT /api/v1/admin/revenue-share/:id OR POST /api/v1/admin/revenue-share/:id
   * Update creator individual revenue share percentage (0-100)
   */
  static async update(req, res) {
    try {
      const creatorId = req.params.id;
      const { rev_share, rev_share_percentage } = req.body;

      const rawPct = rev_share_percentage !== undefined ? rev_share_percentage : rev_share;

      if (rawPct === undefined || rawPct === null || rawPct === '') {
        return ApiResponse.error(res, 'rev_share_percentage is required.', 422);
      }

      const pct = parseInt(rawPct, 10);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        return ApiResponse.error(res, 'rev_share_percentage must be an integer between 0 and 100.', 422);
      }

      const [rows] = await pool.query(
        "SELECT id, name FROM users WHERE id = ? AND (role = 'creator' OR role = 'Creator') LIMIT 1",
        [creatorId]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Creator not found.', 404);
      }

      await pool.query(
        'UPDATE users SET rev_share_percentage = ?, updated_at = NOW() WHERE id = ?',
        [pct, creatorId]
      );

      return ApiResponse.success(res, {
        id: Number(creatorId),
        name: rows[0].name,
        rev_share: pct,
        rev_share_percentage: pct,
        formatted_rev_share: `${pct}%`,
        platform_share: 100 - pct,
        formatted_platform_share: `${100 - pct}%`,
      }, 'Creator revenue share updated successfully.');
    } catch (error) {
      console.error('Admin Update Revenue Share Error:', error);
      return ApiResponse.error(res, 'Failed to update creator revenue share.', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/revenue-share/:id/reset
   * Reset creator's custom rev share to inherit the platform default setting
   */
  static async resetToDefault(req, res) {
    try {
      const creatorId = req.params.id;
      const defaultRevShare = await AdminRevenueShareController.getGlobalRevShareSetting();

      const [rows] = await pool.query(
        "SELECT id, name FROM users WHERE id = ? AND (role = 'creator' OR role = 'Creator') LIMIT 1",
        [creatorId]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Creator not found.', 404);
      }

      await pool.query(
        'UPDATE users SET rev_share_percentage = NULL, updated_at = NOW() WHERE id = ?',
        [creatorId]
      );

      return ApiResponse.success(res, {
        id: Number(creatorId),
        name: rows[0].name,
        rev_share: defaultRevShare,
        rev_share_percentage: defaultRevShare,
        is_custom_rev_share: false,
        formatted_rev_share: `${defaultRevShare}%`,
      }, 'Creator revenue share reset to platform default successfully.');
    } catch (error) {
      console.error('Admin Reset Revenue Share Error:', error);
      return ApiResponse.error(res, 'Failed to reset creator revenue share.', 500);
    }
  }

  /**
   * GET /api/v1/admin/revenue-share/settings
   * Get platform default revenue share setting
   */
  static async getGlobalSetting(req, res) {
    try {
      const defaultRevShare = await AdminRevenueShareController.getGlobalRevShareSetting();
      return ApiResponse.success(res, {
        key: 'writer_revenue_share_percentage',
        default_rev_share: defaultRevShare,
        formatted_default_rev_share: `${defaultRevShare}%`,
        creator_split: defaultRevShare,
        platform_split: 100 - defaultRevShare,
      }, 'Platform default revenue share setting fetched successfully.');
    } catch (error) {
      console.error('Admin Get Global Rev Share Error:', error);
      return ApiResponse.error(res, 'Failed to fetch default revenue share setting.', 500);
    }
  }

  /**
   * POST /api/v1/admin/revenue-share/settings OR PUT
   * Update platform default revenue share setting
   */
  static async updateGlobalSetting(req, res) {
    try {
      const { rev_share, rev_share_percentage } = req.body;
      const rawPct = rev_share_percentage !== undefined ? rev_share_percentage : rev_share;

      if (rawPct === undefined || rawPct === null || rawPct === '') {
        return ApiResponse.error(res, 'rev_share_percentage is required.', 422);
      }

      const pct = parseInt(rawPct, 10);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        return ApiResponse.error(res, 'rev_share_percentage must be an integer between 0 and 100.', 422);
      }

      await pool.query(
        `INSERT INTO settings (\`key\`, \`value\`) VALUES ('writer_revenue_share_percentage', ?)
         ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
        [String(pct)]
      );

      return ApiResponse.success(res, {
        key: 'writer_revenue_share_percentage',
        default_rev_share: pct,
        formatted_default_rev_share: `${pct}%`,
        creator_split: pct,
        platform_split: 100 - pct,
      }, 'Platform default revenue share setting updated successfully.');
    } catch (error) {
      console.error('Admin Update Global Rev Share Error:', error);
      return ApiResponse.error(res, 'Failed to update default revenue share setting.', 500);
    }
  }

  /**
   * GET /api/v1/admin/revenue-share/export OR /api/v1/admin/revenue-shares/export
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
          u.rev_share_percentage,
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
        const revShareVal = c.rev_share_percentage !== null && c.rev_share_percentage !== undefined
          ? Number(c.rev_share_percentage)
          : defaultRevShare;
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
