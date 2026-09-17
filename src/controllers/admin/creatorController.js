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

      // Creators have role = 'creator' OR role = 'Creator' OR role_id = 3
      let whereClauses = ["(u.role = 'creator' OR u.role = 'Creator')"];
      let queryParams = [];

      if (search) {
        whereClauses.push('(u.name LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (status && status !== 'all') {
        const lowerStatus = status.toLowerCase();
        if (lowerStatus === 'suspended') {
          whereClauses.push("(u.is_blocked = 1 OR u.status = 'suspended')");
        } else if (lowerStatus === 'active') {
          whereClauses.push("(u.is_blocked = 0 AND COALESCE(u.status, 'active') = 'active')");
        } else if (lowerStatus === 'pending') {
          whereClauses.push("(u.is_blocked = 0 AND u.status = 'pending')");
        } else {
          whereClauses.push('u.status = ?');
          queryParams.push(lowerStatus);
        }
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      // Total count query
      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) as count FROM users u ${whereSql}`,
        queryParams
      );

      // Summary statistics
      const [[{ total_creators }]] = await pool.query(
        `SELECT COUNT(*) as total_creators FROM users u WHERE (u.role = 'creator' OR u.role = 'Creator')`
      );
      const [[{ active_creators }]] = await pool.query(
        `SELECT COUNT(*) as active_creators FROM users u WHERE (u.role = 'creator' OR u.role = 'Creator') AND u.is_blocked = 0 AND COALESCE(u.status, 'active') = 'active'`
      );
      const [[{ pending_creators }]] = await pool.query(
        `SELECT COUNT(*) as pending_creators FROM users u WHERE (u.role = 'creator' OR u.role = 'Creator') AND u.is_blocked = 0 AND u.status = 'pending'`
      );
      const [[{ suspended_creators }]] = await pool.query(
        `SELECT COUNT(*) as suspended_creators FROM users u WHERE (u.role = 'creator' OR u.role = 'Creator') AND (u.is_blocked = 1 OR u.status = 'suspended')`
      );

      // Paginated list query
      const [rows] = await pool.query(
        `SELECT 
          u.id,
          u.name,
          u.username,
          u.email,
          u.phone,
          u.avatar_path,
          u.is_verified,
          u.is_blocked,
          COALESCE(u.status, 'active') as raw_status,
          u.rev_share_percentage,
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
        const revShareVal = c.rev_share_percentage !== null && c.rev_share_percentage !== undefined
          ? Number(c.rev_share_percentage)
          : defaultRevShare;

        let effectiveStatus = c.raw_status;
        if (c.is_blocked === 1) {
          effectiveStatus = 'suspended';
        }

        const earningsVal = Number(c.earnings || 0);
        const followersVal = Number(c.followers_count || 0);

        return {
          id: c.id,
          name: c.name || 'Unnamed Creator',
          username: c.username || null,
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
          pending: Number(pending_creators || 0),
          suspended: Number(suspended_creators || 0),
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
   * Get complete details of a specific creator
   */
  static async show(req, res) {
    try {
      const creatorId = req.params.id;
      const defaultRevShare = await AdminCreatorController.getGlobalRevShareSetting();

      const [rows] = await pool.query(
        `SELECT 
          u.id,
          u.name,
          u.username,
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
          COALESCE(u.status, 'active') as raw_status,
          u.rev_share_percentage,
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
      const revShareVal = c.rev_share_percentage !== null && c.rev_share_percentage !== undefined
        ? Number(c.rev_share_percentage)
        : defaultRevShare;

      let effectiveStatus = c.raw_status;
      if (c.is_blocked === 1) {
        effectiveStatus = 'suspended';
      }

      const earningsVal = Number(c.earnings || 0);
      const followersVal = Number(c.followers_count || 0);

      // Fetch creator's stories
      const [stories] = await pool.query(
        `SELECT id, title, cover_image_path, status, release_status, episodes_count, listeners_count, total_views, rating, created_at
         FROM stories WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
        [creatorId]
      );

      // Fetch recent earnings history
      const [recentEarnings] = await pool.query(
        `SELECT id, story_id, episode_id, amount, coins, source_type, description, created_at
         FROM writer_earnings WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
        [creatorId]
      );

      const creatorDetails = {
        id: c.id,
        name: c.name || 'Unnamed Creator',
        username: c.username || null,
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
        created_at: c.created_at,
        updated_at: c.updated_at,
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
        username,
        password,
        bio,
        is_verified = 0,
        status = 'active',
        rev_share_percentage,
      } = req.body;

      if (!name) {
        return ApiResponse.error(res, 'Creator name is required.', 420);
      }

      // Check duplicate email / phone / username if provided
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
      const revShareVal = rev_share_percentage !== undefined && rev_share_percentage !== '' && rev_share_percentage !== null
        ? parseInt(rev_share_percentage, 10)
        : null;

      const isBlockedVal = status === 'suspended' ? 1 : 0;

      const [result] = await pool.query(
        `INSERT INTO users 
         (name, email, phone, username, password, bio, avatar_path, role, role_id, is_verified, status, is_blocked, rev_share_percentage) 
         VALUES (?, ?, ?, ?, ?, ?, ?, 'creator', 3, ?, ?, ?, ?)`,
        [
          name,
          email || null,
          phone || null,
          username || null,
          hashedPassword,
          bio || null,
          avatarPath,
          verifiedVal,
          status || 'active',
          isBlockedVal,
          revShareVal,
        ]
      );

      const newCreatorId = result.insertId;

      return ApiResponse.success(
        res,
        { id: newCreatorId, name, email, phone, role: 'creator', status, rev_share_percentage: revShareVal },
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
   * Update creator profile, status, verification & revenue share
   */
  static async update(req, res) {
    try {
      const creatorId = req.params.id;
      const {
        name,
        email,
        phone,
        username,
        bio,
        is_verified,
        status,
        rev_share_percentage,
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
      if (username !== undefined) {
        updateFields.push('username = ?');
        queryParams.push(username || null);
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
        updateFields.push('status = ?');
        queryParams.push(status);
        const isBlocked = status === 'suspended' ? 1 : 0;
        updateFields.push('is_blocked = ?');
        queryParams.push(isBlocked);
      }
      if (rev_share_percentage !== undefined) {
        const revVal = rev_share_percentage !== '' && rev_share_percentage !== null
          ? parseInt(rev_share_percentage, 10)
          : null;
        updateFields.push('rev_share_percentage = ?');
        queryParams.push(revVal);
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
   * Quick status change (active, pending, suspended)
   */
  static async updateStatus(req, res) {
    try {
      const creatorId = req.params.id;
      const { status } = req.body;

      if (!status) {
        return ApiResponse.error(res, 'Status is required (active, pending, suspended).', 420);
      }

      const validStatuses = ['active', 'pending', 'suspended'];
      const normalizedStatus = status.toLowerCase();
      if (!validStatuses.includes(normalizedStatus)) {
        return ApiResponse.error(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
      }

      const isBlocked = normalizedStatus === 'suspended' ? 1 : 0;

      const [result] = await pool.query(
        'UPDATE users SET status = ?, is_blocked = ?, updated_at = NOW() WHERE id = ?',
        [normalizedStatus, isBlocked, creatorId]
      );

      if (result.affectedRows === 0) {
        return ApiResponse.error(res, 'Creator not found.', 404);
      }

      return ApiResponse.success(res, { id: creatorId, status: normalizedStatus, is_blocked: Boolean(isBlocked) }, 'Creator status updated successfully.');
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
}

module.exports = AdminCreatorController;
