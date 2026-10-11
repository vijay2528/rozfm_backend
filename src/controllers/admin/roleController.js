const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

const SYSTEM_PERMISSION_CATALOG = [
  {
    category: 'Dashboard & Analytics',
    permissions: [
      { id: 'dashboard.view', name: 'View Overview', description: 'Access dashboard overview and KPI statistics' },
      { id: 'dashboard.realtime', name: 'View Realtime', description: 'Monitor realtime active listeners and traffic metrics' },
      { id: 'analytics.stories', name: 'Story Analytics', description: 'View deep listening and story retention analytics' },
      { id: 'analytics.creators', name: 'Creator Analytics', description: 'Inspect creator performance benchmarks' }
    ]
  },
  {
    category: 'Audio Stories & Episodes',
    permissions: [
      { id: 'stories.view', name: 'View Stories', description: 'Browse and search audio story catalog' },
      { id: 'stories.create', name: 'Create Stories', description: 'Add and publish new audio stories' },
      { id: 'stories.edit', name: 'Edit Stories', description: 'Update story metadata, banners, and status' },
      { id: 'stories.delete', name: 'Delete Stories', description: 'Remove stories from catalog' },
      { id: 'episodes.manage', name: 'Manage Episodes', description: 'Upload, edit, reorder, and delete episodes' },
      { id: 'categories.manage', name: 'Manage Categories', description: 'Create and organize story categories' }
    ]
  },
  {
    category: 'Creators & Writers',
    permissions: [
      { id: 'creators.view', name: 'View Creators', description: 'Access verified creator and writer profiles' },
      { id: 'creators.edit', name: 'Manage Creators', description: 'Update creator bios, badges, and verification' },
      { id: 'creators.revshare', name: 'Manage Rev Share', description: 'Configure revenue sharing split rates' },
      { id: 'withdrawals.manage', name: 'Manage Withdrawals', description: 'Approve or reject creator payout requests' }
    ]
  },
  {
    category: 'Finance & Monetization',
    permissions: [
      { id: 'payments.view', name: 'View Payments', description: 'Inspect wallet and payment transactions' },
      { id: 'coin_packs.manage', name: 'Manage Coin Packs', description: 'Configure coin pricing bundles and offers' },
      { id: 'memberships.manage', name: 'Manage Memberships', description: 'Create and edit VIP membership plans' },
      { id: 'coupons.manage', name: 'Manage Coupons', description: 'Generate promo codes and discounts' },
      { id: 'reports.export', name: 'Export Reports', description: 'Download revenue and accounting CSV reports' }
    ]
  },
  {
    category: 'Moderation & Reviews',
    permissions: [
      { id: 'moderation.view', name: 'View Moderation Queue', description: 'Access pending stories and episode queue' },
      { id: 'moderation.manage', name: 'Moderate Content', description: 'Approve, reject, or flag submitted content' },
      { id: 'reviews.manage', name: 'Moderate Reviews', description: 'Inspect and remove abusive user ratings' },
      { id: 'comments.manage', name: 'Moderate Comments', description: 'Filter and delete reported user comments' }
    ]
  },
  {
    category: 'Users & Community',
    permissions: [
      { id: 'users.view', name: 'View Users', description: 'Search and inspect user accounts' },
      { id: 'users.edit', name: 'Edit Users', description: 'Update profile details and subscriptions' },
      { id: 'users.block', name: 'Block / Suspend Users', description: 'Ban or suspend user accounts' },
      { id: 'users.coins', name: 'Adjust Coins Balance', description: 'Credit or debit coins manually' },
      { id: 'tickets.read', name: 'Support Tickets', description: 'Review support tickets and user inquiries' },
      { id: 'faqs.manage', name: 'Manage FAQs', description: 'Configure FAQ menus and answers' }
    ]
  },
  {
    category: 'Settings & Administration',
    permissions: [
      { id: 'settings.general', name: 'General Settings', description: 'App branding and platform configuration' },
      { id: 'settings.storage', name: 'Storage Settings', description: 'Cloud storage and S3 configuration' },
      { id: 'settings.payment_keys', name: 'Payment Gateways', description: 'Manage Razorpay and payment credentials' },
      { id: 'settings.maintenance', name: 'Maintenance Mode', description: 'Toggle maintenance state' },
      { id: 'settings.security', name: 'Security Policies', description: 'Session timeouts and 2FA policies' },
      { id: 'roles.manage', name: 'Roles & Permissions', description: 'Create and configure admin roles' }
    ]
  }
];

function generateSlug(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function computeKeyPermissions(permissions, customKeyPermissions) {
  if (customKeyPermissions && customKeyPermissions.trim()) {
    return customKeyPermissions.trim();
  }
  if (!Array.isArray(permissions) || permissions.length === 0) {
    return 'None';
  }
  if (permissions.includes('*')) {
    return 'Full access';
  }

  const moduleSet = new Set();
  for (const perm of permissions) {
    const mod = String(perm).split('.')[0];
    if (mod === 'stories' || mod === 'episodes') moduleSet.add('Stories');
    else if (mod === 'moderation' || mod === 'reviews' || mod === 'comments') moduleSet.add('Moderation');
    else if (mod === 'payments' || mod === 'coin_packs' || mod === 'memberships' || mod === 'withdrawals') moduleSet.add('Payments');
    else if (mod === 'creators' || mod === 'revshare') moduleSet.add('Creators');
    else if (mod === 'users' || mod === 'tickets') moduleSet.add('Users');
    else if (mod === 'settings' || mod === 'roles') moduleSet.add('Settings');
    else if (mod === 'reports') moduleSet.add('Reports');
    else if (mod === 'dashboard' || mod === 'analytics') moduleSet.add('Analytics');
  }

  const list = Array.from(moduleSet);
  if (list.length === 0) return 'Custom permissions';
  if (list.length > 3) {
    return `${list.slice(0, 3).join(', ')} +${list.length - 3} more`;
  }
  return list.join(', ');
}

class RoleController {
  /**
   * GET /api/v1/admin/roles/permissions
   * List all system available permissions catalog and presets
   */
  static async permissions(req, res) {
    try {
      const presets = [
        {
          key: 'super_admin',
          label: 'Super Admin',
          description: 'Unrestricted full platform access',
          permissions: ['*']
        },
        {
          key: 'content_moderator',
          label: 'Content Moderator',
          description: 'Review and approve stories, episodes, comments, and reviews',
          permissions: [
            'stories.view', 'stories.edit', 'episodes.manage',
            'moderation.view', 'moderation.manage', 'reviews.manage', 'comments.manage'
          ]
        },
        {
          key: 'finance',
          label: 'Finance Specialist',
          description: 'Payment transactions, payout withdrawals, and financial reports',
          permissions: [
            'payments.view', 'withdrawals.manage', 'creators.revshare',
            'reports.export', 'coin_packs.manage', 'memberships.manage'
          ]
        },
        {
          key: 'support',
          label: 'Customer Support',
          description: 'Inspect user accounts, tickets, and help center FAQs',
          permissions: [
            'users.view', 'tickets.read', 'faqs.manage'
          ]
        }
      ];

      return ApiResponse.success(res, {
        catalog: SYSTEM_PERMISSION_CATALOG,
        presets,
        total_permissions: SYSTEM_PERMISSION_CATALOG.reduce((acc, cat) => acc + cat.permissions.length, 0)
      }, 'Available permissions catalog retrieved successfully.');
    } catch (error) {
      console.error('Admin Role Permissions Error:', error);
      return ApiResponse.error(res, 'Failed to fetch permissions catalog.', 500);
    }
  }

  /**
   * GET /api/v1/admin/roles
   * List all user/admin roles with assigned admin user counts and key permissions
   */
  static async index(req, res) {
    try {
      const { search, status, page = 1, limit = 50 } = req.query;
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const offset = (pageNum - 1) * limitNum;

      let whereClauses = ['1=1'];
      let queryParams = [];

      if (search) {
        whereClauses.push('(r.name LIKE ? OR r.display_name LIKE ? OR r.description LIKE ? OR r.key_permissions LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (status !== undefined && status !== '') {
        const statusVal = status === '1' || status === 'true' || status === 1 ? 1 : 0;
        whereClauses.push('r.status = ?');
        queryParams.push(statusVal);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) as count FROM roles r ${whereSql}`,
        queryParams
      );

      const [roles] = await pool.query(
        `SELECT r.id, r.name, r.display_name, r.description, r.permissions, r.key_permissions,
                r.is_system, r.status, r.created_at, r.updated_at,
                COUNT(u.id) AS assigned_users_count
         FROM roles r
         LEFT JOIN users u ON (
           u.role_id = r.id OR 
           LOWER(u.role) = LOWER(r.name) OR 
           LOWER(u.role) = LOWER(r.display_name)
         )
         ${whereSql}
         GROUP BY r.id
         ORDER BY r.is_system DESC, r.id ASC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      const formattedRoles = roles.map((role) => {
        let permissionsArr = [];
        try {
          permissionsArr = typeof role.permissions === 'string'
            ? JSON.parse(role.permissions)
            : role.permissions || [];
        } catch (_) {
          permissionsArr = [];
        }

        const computedKey = computeKeyPermissions(permissionsArr, role.key_permissions);

        return {
          id: Number(role.id),
          name: role.name,
          display_name: role.display_name || role.name,
          role: role.display_name || role.name,
          description: role.description || '',
          permissions: permissionsArr,
          key_permissions: computedKey,
          is_system: Boolean(role.is_system),
          status: Boolean(role.status),
          users: Number(role.assigned_users_count || 0),
          admins: Number(role.assigned_users_count || 0),
          assigned_users_count: Number(role.assigned_users_count || 0),
          created_at: role.created_at,
          updated_at: role.updated_at,
        };
      });

      return ApiResponse.success(res, {
        roles: formattedRoles,
        pagination: {
          total: Number(count),
          page: pageNum,
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum) || 1,
        },
      }, 'Roles retrieved successfully.');
    } catch (error) {
      console.error('Admin List Roles Error:', error);
      return ApiResponse.error(res, 'Failed to fetch roles list.', 500);
    }
  }

  /**
   * GET /api/v1/admin/roles/:id
   * Fetch single role detail along with assigned admin users
   */
  static async show(req, res) {
    try {
      const { id } = req.params;

      const [roleRows] = await pool.query(
        `SELECT id, name, display_name, description, permissions, key_permissions, is_system, status, created_at, updated_at
         FROM roles
         WHERE id = ? OR name = ?
         LIMIT 1`,
        [id, id]
      );

      if (roleRows.length === 0) {
        return ApiResponse.error(res, 'Role not found.', 404);
      }

      const role = roleRows[0];

      let permissionsArr = [];
      try {
        permissionsArr = typeof role.permissions === 'string'
          ? JSON.parse(role.permissions)
          : role.permissions || [];
      } catch (_) {
        permissionsArr = [];
      }

      // Query assigned users / admins
      const [assignedUsers] = await pool.query(
        `SELECT id, name, email, phone, avatar_path, role, role_id, is_blocked, last_login_at, created_at
         FROM users
         WHERE role_id = ? OR LOWER(role) = LOWER(?) OR LOWER(role) = LOWER(?)
         ORDER BY id ASC
         LIMIT 100`,
        [role.id, role.name, role.display_name]
      );

      const computedKey = computeKeyPermissions(permissionsArr, role.key_permissions);

      return ApiResponse.success(res, {
        role: {
          id: Number(role.id),
          name: role.name,
          display_name: role.display_name,
          description: role.description,
          permissions: permissionsArr,
          key_permissions: computedKey,
          is_system: Boolean(role.is_system),
          status: Boolean(role.status),
          assigned_users_count: assignedUsers.length,
          assigned_users: assignedUsers,
          created_at: role.created_at,
          updated_at: role.updated_at,
        }
      }, 'Role details fetched successfully.');
    } catch (error) {
      console.error('Admin Show Role Error:', error);
      return ApiResponse.error(res, 'Failed to fetch role details.', 500);
    }
  }

  /**
   * POST /api/v1/admin/roles
   * Create a new custom admin role
   */
  static async store(req, res) {
    try {
      const {
        display_name,
        name,
        description,
        permissions,
        key_permissions,
        status = 1
      } = req.body;

      if (!display_name || !display_name.trim()) {
        return ApiResponse.error(res, 'Role display name is required.', 422);
      }

      const formattedDisplayName = display_name.trim();
      const slugName = generateSlug(name || formattedDisplayName);

      if (!slugName) {
        return ApiResponse.error(res, 'A valid unique system identifier (name) is required.', 422);
      }

      // Check if role with this name already exists
      const [existing] = await pool.query(
        'SELECT id FROM roles WHERE name = ? OR LOWER(display_name) = LOWER(?) LIMIT 1',
        [slugName, formattedDisplayName]
      );

      if (existing.length > 0) {
        return ApiResponse.error(res, `A role with the name "${formattedDisplayName}" or identifier "${slugName}" already exists.`, 409);
      }

      // Parse permissions array
      let permissionsArray = [];
      if (Array.isArray(permissions)) {
        permissionsArray = permissions;
      } else if (typeof permissions === 'string' && permissions.trim()) {
        try {
          permissionsArray = JSON.parse(permissions);
        } catch (_) {
          permissionsArray = permissions.split(',').map(s => s.trim()).filter(Boolean);
        }
      }

      const computedKey = computeKeyPermissions(permissionsArray, key_permissions);
      const statusVal = status === 1 || status === true || status === '1' || status === 'true' ? 1 : 0;

      const [insertResult] = await pool.query(
        `INSERT INTO roles (name, display_name, description, permissions, key_permissions, is_system, status)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        [
          slugName,
          formattedDisplayName,
          description ? description.trim() : null,
          JSON.stringify(permissionsArray),
          computedKey,
          statusVal
        ]
      );

      const newRoleId = insertResult.insertId;

      return ApiResponse.success(res, {
        role: {
          id: newRoleId,
          name: slugName,
          display_name: formattedDisplayName,
          role: formattedDisplayName,
          description: description ? description.trim() : '',
          permissions: permissionsArray,
          key_permissions: computedKey,
          is_system: false,
          status: Boolean(statusVal),
          assigned_users_count: 0,
          users: 0,
          admins: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      }, 'Role created successfully.', 201);
    } catch (error) {
      console.error('Admin Create Role Error:', error);
      return ApiResponse.error(res, 'Failed to create new role.', 500);
    }
  }

  /**
   * PUT /api/v1/admin/roles/:id
   * Update an existing admin role
   */
  static async update(req, res) {
    try {
      const { id } = req.params;
      const {
        display_name,
        name,
        description,
        permissions,
        key_permissions,
        status
      } = req.body;

      const [roleRows] = await pool.query(
        'SELECT * FROM roles WHERE id = ? LIMIT 1',
        [id]
      );

      if (roleRows.length === 0) {
        return ApiResponse.error(res, 'Role not found.', 404);
      }

      const currentRole = roleRows[0];

      // Prepare fields to update
      const updateFields = [];
      const updateValues = [];

      let finalDisplayName = currentRole.display_name;
      if (display_name !== undefined && display_name !== null) {
        if (!display_name.trim()) {
          return ApiResponse.error(res, 'Role display name cannot be empty.', 422);
        }
        finalDisplayName = display_name.trim();
        updateFields.push('display_name = ?');
        updateValues.push(finalDisplayName);
      }

      // Name identifier can be updated only if not a system role
      if (name !== undefined && name !== null && name.trim()) {
        const newSlug = generateSlug(name);
        if (newSlug !== currentRole.name) {
          if (currentRole.is_system) {
            return ApiResponse.error(res, 'System role machine identifier cannot be changed.', 400);
          }
          // Check for uniqueness
          const [nameConflict] = await pool.query(
            'SELECT id FROM roles WHERE name = ? AND id != ? LIMIT 1',
            [newSlug, id]
          );
          if (nameConflict.length > 0) {
            return ApiResponse.error(res, `A role with identifier "${newSlug}" already exists.`, 409);
          }
          updateFields.push('name = ?');
          updateValues.push(newSlug);
        }
      }

      if (description !== undefined) {
        updateFields.push('description = ?');
        updateValues.push(description ? description.trim() : null);
      }

      let parsedPermissions = null;
      if (permissions !== undefined) {
        if (Array.isArray(permissions)) {
          parsedPermissions = permissions;
        } else if (typeof permissions === 'string') {
          try {
            parsedPermissions = JSON.parse(permissions);
          } catch (_) {
            parsedPermissions = permissions.split(',').map(s => s.trim()).filter(Boolean);
          }
        }
        updateFields.push('permissions = ?');
        updateValues.push(JSON.stringify(parsedPermissions || []));
      } else {
        try {
          parsedPermissions = typeof currentRole.permissions === 'string'
            ? JSON.parse(currentRole.permissions)
            : currentRole.permissions || [];
        } catch (_) {
          parsedPermissions = [];
        }
      }

      if (key_permissions !== undefined) {
        updateFields.push('key_permissions = ?');
        updateValues.push(key_permissions ? key_permissions.trim() : null);
      } else if (permissions !== undefined) {
        // Auto update computed key_permissions if permissions changed and key_permissions was not explicitly sent
        const autoKey = computeKeyPermissions(parsedPermissions, null);
        updateFields.push('key_permissions = ?');
        updateValues.push(autoKey);
      }

      if (status !== undefined) {
        const statusVal = status === 1 || status === true || status === '1' || status === 'true' ? 1 : 0;
        updateFields.push('status = ?');
        updateValues.push(statusVal);
      }

      if (updateFields.length === 0) {
        return ApiResponse.error(res, 'No changes provided for update.', 400);
      }

      updateValues.push(id);

      await pool.query(
        `UPDATE roles SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`,
        updateValues
      );

      // Fetch fresh record
      const [updatedRows] = await pool.query(
        `SELECT r.id, r.name, r.display_name, r.description, r.permissions, r.key_permissions,
                r.is_system, r.status, r.created_at, r.updated_at,
                COUNT(u.id) AS assigned_users_count
         FROM roles r
         LEFT JOIN users u ON (
           u.role_id = r.id OR 
           LOWER(u.role) = LOWER(r.name) OR 
           LOWER(u.role) = LOWER(r.display_name)
         )
         WHERE r.id = ?
         GROUP BY r.id`,
        [id]
      );

      const updated = updatedRows[0];
      let perms = [];
      try {
        perms = typeof updated.permissions === 'string' ? JSON.parse(updated.permissions) : updated.permissions || [];
      } catch (_) {
        perms = [];
      }

      return ApiResponse.success(res, {
        role: {
          id: Number(updated.id),
          name: updated.name,
          display_name: updated.display_name,
          role: updated.display_name,
          description: updated.description || '',
          permissions: perms,
          key_permissions: computeKeyPermissions(perms, updated.key_permissions),
          is_system: Boolean(updated.is_system),
          status: Boolean(updated.status),
          assigned_users_count: Number(updated.assigned_users_count || 0),
          users: Number(updated.assigned_users_count || 0),
          admins: Number(updated.assigned_users_count || 0),
          created_at: updated.created_at,
          updated_at: updated.updated_at,
        }
      }, 'Role updated successfully.');
    } catch (error) {
      console.error('Admin Update Role Error:', error);
      return ApiResponse.error(res, 'Failed to update role.', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/roles/:id
   * Delete a custom admin role (safeguarded against system roles and assigned users)
   */
  static async destroy(req, res) {
    try {
      const { id } = req.params;

      const [roleRows] = await pool.query(
        'SELECT * FROM roles WHERE id = ? LIMIT 1',
        [id]
      );

      if (roleRows.length === 0) {
        return ApiResponse.error(res, 'Role not found.', 404);
      }

      const role = roleRows[0];

      // Safeguard 1: Do not delete system roles
      if (role.is_system) {
        return ApiResponse.error(
          res,
          `Cannot delete system role "${role.display_name}". System roles are required for core security.`,
          403
        );
      }

      // Safeguard 2: Check assigned users
      const [[{ userCount }]] = await pool.query(
        `SELECT COUNT(*) AS userCount FROM users
         WHERE role_id = ? OR LOWER(role) = LOWER(?) OR LOWER(role) = LOWER(?)`,
        [role.id, role.name, role.display_name]
      );

      if (userCount > 0) {
        return ApiResponse.error(
          res,
          `Cannot delete role "${role.display_name}" because ${userCount} user(s) or admin(s) are currently assigned to it. Please reassign those accounts before deletion.`,
          409
        );
      }

      await pool.query('DELETE FROM roles WHERE id = ?', [id]);

      return ApiResponse.success(res, {
        id: Number(id),
        name: role.name,
        display_name: role.display_name
      }, `Role "${role.display_name}" deleted successfully.`);
    } catch (error) {
      console.error('Admin Delete Role Error:', error);
      return ApiResponse.error(res, 'Failed to delete role.', 500);
    }
  }
}

module.exports = RoleController;
