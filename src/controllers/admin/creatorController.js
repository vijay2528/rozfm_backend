const bcrypt = require('bcryptjs');
const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

function formatFollowersCount(num) {
  const val = Number(num) || 0;
  if (val >= 1000000) {
    return (val / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (val >= 1000) {
    return Math.round(val / 1000) + 'K';
  }
  return val.toString();
}

function formatCurrencyINR(amount) {
  const num = Number(amount) || 0;
  const formatted = num.toLocaleString('en-IN');
  return `₹${formatted}`;
}

function formatDate(date) {
  if (!date) return 'Recent';
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'Recent';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

class AdminCreatorController {
  /**
   * Helper to get global revenue share percentage from settings table
   */
  static async getGlobalRevShareSetting() {
    try {
      const [rows] = await pool.query("SELECT value FROM settings WHERE `key` = 'writer_revenue_share_percentage' LIMIT 1");
      if (rows.length > 0 && rows[0].value) {
        return parseInt(rows[0].value, 10) || 70;
      }
    } catch (e) {
      console.error('Error fetching global rev share setting:', e);
    }
    return 70;
  }

  /**
   * GET /api/v1/admin/creators
   * Paginated list of content creators with search, status filters, counts, rev share & earnings
   */
  static async index(req, res) {
    try {
      const { search, status, page = 1, limit = 20 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      const defaultRevShare = await AdminCreatorController.getGlobalRevShareSetting();

      // Creators have role = 'creator' OR role = 'Creator'
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

      // Total count query
      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) as count FROM users u ${whereSql}`,
        queryParams
      );

      // Summary statistics derived from is_blocked
      const [[{ total_creators }]] = await pool.query(
        `SELECT COUNT(*) as total_creators FROM users u WHERE (u.role = 'creator' OR u.role = 'Creator')`
      );
      const [[{ active_creators }]] = await pool.query(
        `SELECT COUNT(*) as active_creators FROM users u WHERE (u.role = 'creator' OR u.role = 'Creator') AND u.is_blocked = 0`
      );
      const [[{ inactive_creators }]] = await pool.query(
        `SELECT COUNT(*) as inactive_creators FROM users u WHERE (u.role = 'creator' OR u.role = 'Creator') AND u.is_blocked = 1`
      );

      // Paginated list query
      const [rows] = await pool.query(
        `SELECT 
          u.id,
          u.name,
          u.email,
          u.phone,
          u.avatar_path,
          u.is_verified,
          u.is_blocked,
          u.created_at,
          u.updated_at,
          (SELECT COUNT(*) FROM stories s WHERE s.user_id = u.id) as stories_count,
          (SELECT COUNT(*) FROM user_follows uf WHERE uf.following_id = u.id) as followers_count,
          (SELECT COALESCE(SUM(amount), 0) FROM writer_earnings we WHERE we.user_id = u.id) as earnings
         FROM users u
         ${whereSql}
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      // Format output items
      const creators = rows.map((c) => {
        const revShareVal = defaultRevShare;
        const effectiveStatus = c.is_blocked === 1 ? 'InActive' : 'active';
        const earningsVal = Number(c.earnings || 0);
        const followersVal = Number(c.followers_count || 0);

        return {
          id: c.id,
          name: c.name || 'Unnamed Creator',
          email: c.email || null,
          phone: c.phone || null,
          avatar_path: c.avatar_path || null,
          avatar_url: c.avatar_path || null,
          is_verified: Boolean(c.is_verified),
          is_blocked: Boolean(c.is_blocked),
          stories_count: Number(c.stories_count || 0),
          followers_count: followersVal,
          formatted_followers: formatFollowersCount(followersVal),
          rev_share: revShareVal,
          formatted_rev_share: `${revShareVal}%`,
          earnings: earningsVal,
          formatted_earnings: formatCurrencyINR(earningsVal),
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
          active: Number(active_creators || 0),
          inactive: Number(inactive_creators || 0),
        },
        pagination: {
          total: count,
          page: pageNum,
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      }, 'Creators list fetched successfully.');
    } catch (error) {
      console.error('Admin List Creators Error:', error);
      return ApiResponse.error(res, 'Failed to fetch creators list.', 500);
    }
  }

  /**
   * GET /api/v1/admin/creators/:id
   * Get complete details of a specific creator for the admin Creator Profile page
   */
  static async show(req, res) {
    try {
      const creatorId = req.params.id;
      const defaultRevShare = await AdminCreatorController.getGlobalRevShareSetting();

      const [rows] = await pool.query(
        `SELECT 
          u.id,
          u.name,
          u.email,
          u.phone,
          u.bio,
          u.country,
          u.state,
          u.city,
          u.avatar_path,
          u.instagram_link,
          u.youtube_link,
          u.facebook_link,
          u.is_verified,
          u.is_blocked,
          u.wallet_balance,
          u.created_at,
          u.updated_at,
          (SELECT COUNT(*) FROM stories s WHERE s.user_id = u.id) as stories_count,
          (SELECT COUNT(*) FROM user_follows uf WHERE uf.following_id = u.id) as followers_count,
          (SELECT COALESCE(SUM(amount), 0) FROM writer_earnings we WHERE we.user_id = u.id) as earnings
         FROM users u
         WHERE u.id = ? AND (u.role = 'creator' OR u.role = 'Creator')
         LIMIT 1`,
        [creatorId]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Creator not found.', 404);
      }

      const c = rows[0];
      const revShareVal = defaultRevShare;
      const effectiveStatus = c.is_blocked === 1 ? 'InActive' : 'active';
      const earningsVal = Number(c.earnings || 0);
      const followersVal = Number(c.followers_count || 0);

      // Follower growth in past 30 days
      const [[{ followers_growth_30d }]] = await pool.query(
        `SELECT COUNT(*) AS followers_growth_30d FROM user_follows WHERE following_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [creatorId]
      );
      const followerGrowthVal = Number(followers_growth_30d || 0);

      // Fetch creator's stories
      const [stories] = await pool.query(
        `SELECT id, title, cover_image_path, status, release_status, is_approved, episodes_count, listeners_count, total_views, rating, created_at
         FROM stories WHERE user_id = ? ORDER BY created_at DESC`,
        [creatorId]
      );

      // Total plays across all stories
      const totalPlays = stories.reduce((sum, s) => sum + Number(s.total_views || s.listeners_count || 0), 0);

      // Average completion percentage from watch_histories
      let avgCompletion = 0;
      try {
        const [[compRow]] = await pool.query(
          `SELECT COALESCE(AVG(wh.completion_percentage), 0) AS avg_comp
           FROM watch_histories wh
           INNER JOIN stories s ON wh.story_id = s.id
           WHERE s.user_id = ?`,
          [creatorId]
        );
        avgCompletion = Math.round(Number(compRow?.avg_comp || 0));
      } catch (_) {}

      // Current month earnings
      const [[thisMonthRow]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS this_month_earnings
         FROM writer_earnings
         WHERE user_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00')`,
        [creatorId]
      );
      const thisMonthEarnings = Number(thisMonthRow?.this_month_earnings || 0);

      // Earnings trend by month (current year Jan - Dec)
      const currentYear = new Date().getFullYear();
      const [monthlyEarningsRows] = await pool.query(
        `SELECT MONTH(created_at) AS m, COALESCE(SUM(amount), 0) AS month_total
         FROM writer_earnings
         WHERE user_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-01-01 00:00:00')
         GROUP BY MONTH(created_at)`,
        [creatorId]
      );
      const earningsByMonthMap = {};
      monthlyEarningsRows.forEach((r) => {
        earningsByMonthMap[r.m] = Number(r.month_total || 0);
      });
      const earningsTrendData = [];
      for (let m = 1; m <= 12; m++) {
        earningsTrendData.push(earningsByMonthMap[m] || 0);
      }

      // Wallet calculations
      const availableBalance = Number(c.wallet_balance || 0);
      const [[pendingWithdrawalsRow]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS pending_clearance
         FROM writer_withdrawals
         WHERE user_id = ? AND status = 'pending'`,
        [creatorId]
      );
      const pendingClearance = Number(pendingWithdrawalsRow?.pending_clearance || 0);

      // Withdrawals list
      const [withdrawalRows] = await pool.query(
        `SELECT id, amount, status, transaction_reference, requested_at, created_at
         FROM writer_withdrawals
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
        [creatorId]
      );

      const withdrawals = withdrawalRows.map((w) => ({
        id: `WD-${w.id}`,
        raw_id: w.id,
        amount: formatCurrencyINR(w.amount),
        amount_num: Number(w.amount || 0),
        status: (w.status || 'Pending').charAt(0).toUpperCase() + (w.status || 'Pending').slice(1).toLowerCase(),
        date: formatDate(w.created_at || w.requested_at),
        created_at: w.created_at,
      }));

      // Published Stories vs Pending Stories
      const publishedStories = stories
        .filter((s) => {
          const app = String(s.is_approved || '').toLowerCase();
          const st = String(s.status || '').toLowerCase();
          return app === 'approved' || st === 'published' || (!app && st !== 'pending' && st !== 'draft');
        })
        .map((s) => {
          const playsNum = Number(s.total_views || s.listeners_count || 0);
          return {
            id: s.id,
            title: s.title,
            episodes: Number(s.episodes_count || 0),
            plays: playsNum > 0 ? formatFollowersCount(playsNum) : '-',
            plays_num: playsNum,
            cover_image_path: s.cover_image_path || null,
            rating: s.rating,
            status: s.status || 'Published',
            created_at: s.created_at,
          };
        });

      const pendingStories = stories
        .filter((s) => {
          const app = String(s.is_approved || '').toLowerCase();
          const st = String(s.status || '').toLowerCase();
          return app === 'pending' || st === 'pending';
        })
        .map((s) => {
          const playsNum = Number(s.total_views || s.listeners_count || 0);
          return {
            id: s.id,
            title: s.title,
            episodes: Number(s.episodes_count || 0),
            plays: playsNum > 0 ? formatFollowersCount(playsNum) : '-',
            plays_num: playsNum,
            cover_image_path: s.cover_image_path || null,
            rating: s.rating,
            status: 'Pending',
            created_at: s.created_at,
          };
        });

      // Fetch recent earnings history
      const [recentEarnings] = await pool.query(
        `SELECT id, story_id, episode_id, amount, coins, source_type, description, created_at
         FROM writer_earnings WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
        [creatorId]
      );

      const creatorDetails = {
        id: c.id,
        name: c.name || 'Unnamed Creator',
        email: c.email || null,
        phone: c.phone || null,
        bio: c.bio || null,
        country: c.country || null,
        state: c.state || null,
        city: c.city || null,
        avatar_path: c.avatar_path || null,
        avatar_url: c.avatar_path || null,
        instagram_link: c.instagram_link || null,
        youtube_link: c.youtube_link || null,
        facebook_link: c.facebook_link || null,
        is_verified: Boolean(c.is_verified),
        is_blocked: Boolean(c.is_blocked),
        stories_count: Number(c.stories_count || 0),
        followers_count: followersVal,
        formatted_followers: formatFollowersCount(followersVal),
        rev_share: revShareVal,
        formatted_rev_share: `${revShareVal}%`,
        earnings: earningsVal,
        formatted_earnings: formatCurrencyINR(earningsVal),
        status: effectiveStatus,
        wallet_balance: availableBalance,
        created_at: c.created_at,
        updated_at: c.updated_at,

        // ── 1. Analytics Tab ──────────────────────────────────────────────────
        analytics: {
          total_plays: totalPlays,
          formatted_total_plays: totalPlays > 0 ? formatFollowersCount(totalPlays) : '0',
          avg_completion: `${avgCompletion}%`,
          avg_completion_delta: '+0%',
          this_month_earnings: thisMonthEarnings,
          formatted_this_month_earnings: formatCurrencyINR(thisMonthEarnings),
          follower_growth: followerGrowthVal > 0 ? `+${followerGrowthVal.toLocaleString()}` : '+0',
          follower_growth_delta: '+0%',
          earnings_trend: {
            data: earningsTrendData,
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
          },
        },

        // ── 2. Revenue Share Tab ──────────────────────────────────────────────
        revenue_share: {
          rev_share: revShareVal,
          platform_share: 100 - revShareVal,
          formatted_rev_share: `${revShareVal}%`,
          formatted_platform_share: `${100 - revShareVal}%`,
        },

        // ── 3. Wallet Tab ─────────────────────────────────────────────────────
        wallet: {
          available_balance: availableBalance,
          formatted_available_balance: formatCurrencyINR(availableBalance),
          pending_clearance: pendingClearance,
          formatted_pending_clearance: formatCurrencyINR(pendingClearance),
          lifetime_earnings: earningsVal,
          formatted_lifetime_earnings: formatCurrencyINR(earningsVal),
        },

        // ── 4. Withdrawals Tab ────────────────────────────────────────────────
        withdrawals,

        // ── 5. Published Stories Tab ──────────────────────────────────────────
        published_stories: publishedStories,

        // ── 6. Pending Stories Tab ────────────────────────────────────────────
        pending_stories: pendingStories,

        // Backward compatibility
        stories,
        recent_earnings: recentEarnings,
      };

      return ApiResponse.success(res, creatorDetails, 'Creator details fetched successfully.');
    } catch (error) {
      console.error('Admin Show Creator Error:', error);
      return ApiResponse.error(res, 'Failed to fetch creator details.', 500);
    }
  }

  /**
   * POST /api/v1/admin/creators or /api/v1/admin/creators/invite
   * Create or Invite a new creator
   */
  static async store(req, res) {
    try {
      const {
        name,
        email,
        phone,
        password,
        bio,
        is_verified = 0,
        status = 'active',
      } = req.body;

      if (!name) {
        return ApiResponse.error(res, 'Creator name is required.', 420);
      }

      // Check duplicate email / phone if provided
      if (email) {
        const [dupEmail] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
        if (dupEmail.length > 0) {
          return ApiResponse.error(res, 'A user with this email already exists.', 400);
        }
      }
      if (phone) {
        const [dupPhone] = await pool.query('SELECT id FROM users WHERE phone = ? LIMIT 1', [phone]);
        if (dupPhone.length > 0) {
          return ApiResponse.error(res, 'A user with this phone number already exists.', 400);
        }
      }

      const hashedPassword = password ? await bcrypt.hash(password, 10) : await bcrypt.hash('RozFM@Creator123', 10);
      const avatarPath = req.file ? req.file.path : null;
      
      const verifiedVal = is_verified === '1' || is_verified === 'true' || is_verified === 1 || is_verified === true ? 1 : 0;
      const isBlockedVal = (status && (status.toLowerCase() === 'inactive' || status.toLowerCase() === 'suspended')) ? 1 : 0;
      const effectiveStatus = isBlockedVal === 1 ? 'InActive' : 'active';

      const defaultRevShare = await AdminCreatorController.getGlobalRevShareSetting();

      const [result] = await pool.query(
        `INSERT INTO users 
         (name, email, phone, password, bio, avatar_path, role, role_id, is_verified, is_blocked) 
         VALUES (?, ?, ?, ?, ?, ?, 'creator', 3, ?, ?)`,
        [
          name,
          email || null,
          phone || null,
          hashedPassword,
          bio || null,
          avatarPath,
          verifiedVal,
          isBlockedVal,
        ]
      );

      const newCreatorId = result.insertId;

      return ApiResponse.success(
        res,
        { id: newCreatorId, name, email, phone, role: 'creator', status: effectiveStatus, rev_share: defaultRevShare, formatted_rev_share: `${defaultRevShare}%` },
        'Creator created successfully.',
        201
      );
    } catch (error) {
      console.error('Admin Create Creator Error:', error);
      return ApiResponse.error(res, 'Failed to create creator.', 500);
    }
  }

  /**
   * PUT /api/v1/admin/creators/:id
   * Update creator profile, status, verification
   */
  static async update(req, res) {
    try {
      const creatorId = req.params.id;
      const {
        name,
        email,
        phone,
        bio,
        is_verified,
        status,
        password,
      } = req.body;

      const [creatorRows] = await pool.query('SELECT id FROM users WHERE id = ? LIMIT 1', [creatorId]);
      if (creatorRows.length === 0) {
        return ApiResponse.error(res, 'Creator not found.', 404);
      }

      let updateFields = [];
      let queryParams = [];

      if (name !== undefined) {
        updateFields.push('name = ?');
        queryParams.push(name);
      }
      if (email !== undefined) {
        updateFields.push('email = ?');
        queryParams.push(email || null);
      }
      if (phone !== undefined) {
        updateFields.push('phone = ?');
        queryParams.push(phone || null);
      }
      if (bio !== undefined) {
        updateFields.push('bio = ?');
        queryParams.push(bio || null);
      }
      if (is_verified !== undefined) {
        const vVal = is_verified === '1' || is_verified === 'true' || is_verified === 1 || is_verified === true ? 1 : 0;
        updateFields.push('is_verified = ?');
        queryParams.push(vVal);
      }
      if (status !== undefined) {
        const lowerStatus = status.toLowerCase();
        if (lowerStatus === 'inactive' || lowerStatus === 'suspended') {
          updateFields.push('is_blocked = 1');
        } else if (lowerStatus === 'active') {
          updateFields.push('is_blocked = 0');
        }
      }
      if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        updateFields.push('password = ?');
        queryParams.push(hashedPassword);
      }
      if (req.file) {
        updateFields.push('avatar_path = ?');
        queryParams.push(req.file.path);
      }

      if (updateFields.length > 0) {
        updateFields.push('updated_at = NOW()');
        await pool.query(`UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`, [...queryParams, creatorId]);
      }

      return ApiResponse.success(res, { id: creatorId }, 'Creator profile updated successfully.');
    } catch (error) {
      console.error('Admin Update Creator Error:', error);
      return ApiResponse.error(res, 'Failed to update creator profile.', 500);
    }
  }

  /**
   * PUT /api/v1/admin/creators/:id/status
   * Quick status change (active, inactive)
   */
  static async updateStatus(req, res) {
    try {
      const creatorId = req.params.id;
      const { status } = req.body;

      if (!status) {
        return ApiResponse.error(res, 'Status is required (active, inactive).', 420);
      }

      const normalizedStatus = status.toLowerCase();
      const isBlocked = (normalizedStatus === 'inactive' || normalizedStatus === 'suspended') ? 1 : 0;
      const effectiveStatus = isBlocked === 1 ? 'InActive' : 'active';

      const [result] = await pool.query(
        'UPDATE users SET is_blocked = ?, updated_at = NOW() WHERE id = ?',
        [isBlocked, creatorId]
      );

      if (result.affectedRows === 0) {
        return ApiResponse.error(res, 'Creator not found.', 404);
      }

      return ApiResponse.success(res, { id: creatorId, status: effectiveStatus, is_blocked: Boolean(isBlocked) }, 'Creator status updated successfully.');
    } catch (error) {
      console.error('Admin Update Creator Status Error:', error);
      return ApiResponse.error(res, 'Failed to update creator status.', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/creators/:id
   * Delete creator account
   */
  static async destroy(req, res) {
    try {
      const creatorId = req.params.id;

      const [result] = await pool.query('DELETE FROM users WHERE id = ?', [creatorId]);
      if (result.affectedRows === 0) {
        return ApiResponse.error(res, 'Creator not found.', 404);
      }

      return ApiResponse.success(res, { id: creatorId }, 'Creator deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Creator Error:', error);
      return ApiResponse.error(res, 'Failed to delete creator.', 500);
    }
  }

  /**
   * GET /api/v1/admin/creators/:id/analytics
   * Tab 1: Creator Analytics (Total Plays, Avg Completion, This Month Earnings, Follower Growth, Earnings Trend)
   */
  static async getAnalytics(req, res) {
    try {
      const creatorId = req.params.id;
      const [cRows] = await pool.query('SELECT id, name FROM users WHERE id = ? AND (role = "creator" OR role = "Creator") LIMIT 1', [creatorId]);
      if (cRows.length === 0) return ApiResponse.error(res, 'Creator not found.', 404);

      const [stories] = await pool.query(
        'SELECT episodes_count, listeners_count, total_views FROM stories WHERE user_id = ?',
        [creatorId]
      );
      const totalPlays = stories.reduce((sum, s) => sum + Number(s.total_views || s.listeners_count || 0), 0);

      let avgCompletion = 0;
      try {
        const [[compRow]] = await pool.query(
          `SELECT COALESCE(AVG(wh.completion_percentage), 0) AS avg_comp
           FROM watch_histories wh
           INNER JOIN stories s ON wh.story_id = s.id
           WHERE s.user_id = ?`,
          [creatorId]
        );
        avgCompletion = Math.round(Number(compRow?.avg_comp || 0));
      } catch (_) {}

      const [[thisMonthRow]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS this_month_earnings
         FROM writer_earnings
         WHERE user_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00')`,
        [creatorId]
      );
      const thisMonthEarnings = Number(thisMonthRow?.this_month_earnings || 0);

      const [[{ followers_growth_30d }]] = await pool.query(
        `SELECT COUNT(*) AS followers_growth_30d FROM user_follows WHERE following_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [creatorId]
      );
      const followerGrowthVal = Number(followers_growth_30d || 0);

      const [monthlyEarningsRows] = await pool.query(
        `SELECT MONTH(created_at) AS m, COALESCE(SUM(amount), 0) AS month_total
         FROM writer_earnings
         WHERE user_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-01-01 00:00:00')
         GROUP BY MONTH(created_at)`,
        [creatorId]
      );
      const earningsByMonthMap = {};
      monthlyEarningsRows.forEach((r) => {
        earningsByMonthMap[r.m] = Number(r.month_total || 0);
      });
      const earningsTrendData = [];
      for (let m = 1; m <= 12; m++) {
        earningsTrendData.push(earningsByMonthMap[m] || 0);
      }

      return ApiResponse.success(res, {
        creator_id: Number(creatorId),
        creator_name: cRows[0].name,
        total_plays: totalPlays,
        formatted_total_plays: totalPlays > 0 ? formatFollowersCount(totalPlays) : '0',
        avg_completion: `${avgCompletion}%`,
        avg_completion_delta: '+0%',
        this_month_earnings: thisMonthEarnings,
        formatted_this_month_earnings: formatCurrencyINR(thisMonthEarnings),
        follower_growth: followerGrowthVal > 0 ? `+${followerGrowthVal.toLocaleString()}` : '+0',
        follower_growth_delta: '+0%',
        earnings_trend: {
          data: earningsTrendData,
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        },
      }, 'Creator analytics fetched successfully.');
    } catch (error) {
      console.error('Admin Creator Analytics Error:', error);
      return ApiResponse.error(res, 'Failed to fetch creator analytics.', 500);
    }
  }

  /**
   * GET /api/v1/admin/creators/:id/wallet
   * Tab 3: Creator Wallet (Available Balance, Pending Clearance, Lifetime Earnings)
   */
  static async getWallet(req, res) {
    try {
      const creatorId = req.params.id;
      const [cRows] = await pool.query('SELECT id, name, wallet_balance FROM users WHERE id = ? AND (role = "creator" OR role = "Creator") LIMIT 1', [creatorId]);
      if (cRows.length === 0) return ApiResponse.error(res, 'Creator not found.', 404);

      const availableBalance = Number(cRows[0].wallet_balance || 0);
      const [[pendingWithdrawalsRow]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS pending_clearance
         FROM writer_withdrawals
         WHERE user_id = ? AND status = 'pending'`,
        [creatorId]
      );
      const pendingClearance = Number(pendingWithdrawalsRow?.pending_clearance || 0);

      const [[lifetimeRow]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS lifetime_earnings
         FROM writer_earnings
         WHERE user_id = ?`,
        [creatorId]
      );
      const lifetimeEarnings = Number(lifetimeRow?.lifetime_earnings || 0);

      return ApiResponse.success(res, {
        creator_id: Number(creatorId),
        creator_name: cRows[0].name,
        available_balance: availableBalance,
        formatted_available_balance: formatCurrencyINR(availableBalance),
        pending_clearance: pendingClearance,
        formatted_pending_clearance: formatCurrencyINR(pendingClearance),
        lifetime_earnings: lifetimeEarnings,
        formatted_lifetime_earnings: formatCurrencyINR(lifetimeEarnings),
      }, 'Creator wallet details fetched successfully.');
    } catch (error) {
      console.error('Admin Creator Wallet Error:', error);
      return ApiResponse.error(res, 'Failed to fetch creator wallet.', 500);
    }
  }

  /**
   * GET /api/v1/admin/creators/:id/withdrawals
   * Tab 4: Creator Withdrawals list with status, amount, and request date
   */
  static async getWithdrawals(req, res) {
    try {
      const creatorId = req.params.id;
      const [cRows] = await pool.query('SELECT id, name FROM users WHERE id = ? AND (role = "creator" OR role = "Creator") LIMIT 1', [creatorId]);
      if (cRows.length === 0) return ApiResponse.error(res, 'Creator not found.', 404);

      const { status, page = 1, limit = 20 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      let whereClauses = ['user_id = ?'];
      const params = [creatorId];

      if (status && status !== 'all') {
        whereClauses.push('status = ?');
        params.push(status.toLowerCase() === 'success' ? 'paid' : status.toLowerCase());
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM writer_withdrawals ${whereSql}`, params);

      const [withdrawalRows] = await pool.query(
        `SELECT id, amount, status, transaction_reference, requested_at, created_at
         FROM writer_withdrawals
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      );

      const withdrawals = withdrawalRows.map((w) => ({
        id: `WD-${w.id}`,
        raw_id: w.id,
        amount: formatCurrencyINR(w.amount),
        amount_num: Number(w.amount || 0),
        status: (w.status || 'Pending').charAt(0).toUpperCase() + (w.status || 'Pending').slice(1).toLowerCase(),
        raw_status: w.status,
        transaction_reference: w.transaction_reference || null,
        date: formatDate(w.created_at || w.requested_at),
        created_at: w.created_at,
      }));

      return ApiResponse.success(res, {
        creator_id: Number(creatorId),
        creator_name: cRows[0].name,
        withdrawals,
        data: withdrawals,
        pagination: {
          total: Number(total || 0),
          page: pageNum,
          limit: limitNum,
          total_pages: Math.ceil((total || 0) / limitNum) || 0,
        },
      }, 'Creator withdrawals fetched successfully.');
    } catch (error) {
      console.error('Admin Creator Withdrawals Error:', error);
      return ApiResponse.error(res, 'Failed to fetch creator withdrawals.', 500);
    }
  }

  /**
   * GET /api/v1/admin/creators/:id/published-stories
   * Tab 5: Published stories belonging to this creator
   */
  static async getPublishedStories(req, res) {
    try {
      const creatorId = req.params.id;
      const [cRows] = await pool.query('SELECT id, name FROM users WHERE id = ? AND (role = "creator" OR role = "Creator") LIMIT 1', [creatorId]);
      if (cRows.length === 0) return ApiResponse.error(res, 'Creator not found.', 404);

      const { search, page = 1, limit = 20 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      let whereClauses = [
        'user_id = ?',
        "(is_approved = 'Approved' OR status = 'published' OR (is_approved IS NULL AND status NOT IN ('pending', 'draft', 'rejected')))"
      ];
      const params = [creatorId];

      if (search && search.trim() !== '') {
        whereClauses.push('(title LIKE ? OR description LIKE ?)');
        params.push(`%${search.trim()}%`, `%${search.trim()}%`);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM stories ${whereSql}`, params);

      const [storyRows] = await pool.query(
        `SELECT id, title, cover_image_path, episodes_count, listeners_count, total_views, rating, status, is_approved, created_at
         FROM stories
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      );

      const stories = storyRows.map((s) => {
        const playsNum = Number(s.total_views || s.listeners_count || 0);
        return {
          id: s.id,
          title: s.title,
          episodes: Number(s.episodes_count || 0),
          episodes_count: Number(s.episodes_count || 0),
          plays: playsNum > 0 ? formatFollowersCount(playsNum) : '-',
          plays_num: playsNum,
          cover_image_path: s.cover_image_path || null,
          rating: s.rating,
          status: s.status || 'Published',
          is_approved: s.is_approved || 'Approved',
          created_at: s.created_at,
        };
      });

      return ApiResponse.success(res, {
        creator_id: Number(creatorId),
        creator_name: cRows[0].name,
        stories,
        published_stories: stories,
        pagination: {
          total: Number(total || 0),
          page: pageNum,
          limit: limitNum,
          total_pages: Math.ceil((total || 0) / limitNum) || 0,
        },
      }, 'Creator published stories fetched successfully.');
    } catch (error) {
      console.error('Admin Creator Published Stories Error:', error);
      return ApiResponse.error(res, 'Failed to fetch published stories.', 500);
    }
  }

  /**
   * GET /api/v1/admin/creators/:id/pending-stories
   * Tab 6: Pending approval stories belonging to this creator
   */
  static async getPendingStories(req, res) {
    try {
      const creatorId = req.params.id;
      const [cRows] = await pool.query('SELECT id, name FROM users WHERE id = ? AND (role = "creator" OR role = "Creator") LIMIT 1', [creatorId]);
      if (cRows.length === 0) return ApiResponse.error(res, 'Creator not found.', 404);

      const { search, page = 1, limit = 20 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      let whereClauses = [
        'user_id = ?',
        "(is_approved = 'Pending' OR status = 'pending')"
      ];
      const params = [creatorId];

      if (search && search.trim() !== '') {
        whereClauses.push('(title LIKE ? OR description LIKE ?)');
        params.push(`%${search.trim()}%`, `%${search.trim()}%`);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM stories ${whereSql}`, params);

      const [storyRows] = await pool.query(
        `SELECT id, title, cover_image_path, episodes_count, listeners_count, total_views, rating, status, is_approved, created_at
         FROM stories
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      );

      const stories = storyRows.map((s) => {
        const playsNum = Number(s.total_views || s.listeners_count || 0);
        return {
          id: s.id,
          title: s.title,
          episodes: Number(s.episodes_count || 0),
          episodes_count: Number(s.episodes_count || 0),
          plays: playsNum > 0 ? formatFollowersCount(playsNum) : '-',
          plays_num: playsNum,
          cover_image_path: s.cover_image_path || null,
          rating: s.rating,
          status: 'Pending',
          is_approved: 'Pending',
          date: formatDate(s.created_at),
          created_at: s.created_at,
        };
      });

      return ApiResponse.success(res, {
        creator_id: Number(creatorId),
        creator_name: cRows[0].name,
        stories,
        pending_stories: stories,
        pagination: {
          total: Number(total || 0),
          page: pageNum,
          limit: limitNum,
          total_pages: Math.ceil((total || 0) / limitNum) || 0,
        },
      }, 'Creator pending stories fetched successfully.');
    } catch (error) {
      console.error('Admin Creator Pending Stories Error:', error);
      return ApiResponse.error(res, 'Failed to fetch pending stories.', 500);
    }
  }

  /**
   * GET /api/v1/admin/creators/:id/revenue-share
   * Tab 2: Creator Revenue Share % and platform split
   */
  static async getRevenueShare(req, res) {
    try {
      const creatorId = req.params.id;
      const [cRows] = await pool.query('SELECT id, name FROM users WHERE id = ? AND (role = "creator" OR role = "Creator") LIMIT 1', [creatorId]);
      if (cRows.length === 0) return ApiResponse.error(res, 'Creator not found.', 404);

      const defaultRevShare = await AdminCreatorController.getGlobalRevShareSetting();

      return ApiResponse.success(res, {
        creator_id: Number(creatorId),
        creator_name: cRows[0].name,
        rev_share: defaultRevShare,
        creator_percentage: defaultRevShare,
        platform_percentage: 100 - defaultRevShare,
        formatted_rev_share: `${defaultRevShare}%`,
        formatted_platform_share: `${100 - defaultRevShare}%`,
      }, 'Creator revenue share fetched successfully.');
    } catch (error) {
      console.error('Admin Creator Revenue Share Error:', error);
      return ApiResponse.error(res, 'Failed to fetch creator revenue share.', 500);
    }
  }
}

module.exports = AdminCreatorController;
