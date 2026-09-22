const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');
const { formatNumber, resolveUrl } = require('../../utils/storyPresenter');

// ── Shared helpers ─────────────────────────────────────────────────────────────

function formatDate(date) {
  if (!date) return null;
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Common story list query builder.
 * approvalStatus: 'Pending' | 'Approved' | 'Rejected'
 */
async function fetchStoryList({ approvalStatus, search, category_id, language, pageNum, limitNum }) {
  const offset = (pageNum - 1) * limitNum;

  let whereClauses = [`s.is_approved = ?`];
  let queryParams = [approvalStatus];

  // For Pending / Approved lists, restrict to creator roles only
  if (approvalStatus !== 'Rejected') {
    whereClauses.push("(u.role = 'creator' OR u.role = 'Creator')");
  }

  if (search) {
    whereClauses.push('(s.title LIKE ? OR u.name LIKE ?)');
    queryParams.push(`%${search}%`, `%${search}%`);
  }
  if (category_id) {
    whereClauses.push('s.category_id = ?');
    queryParams.push(category_id);
  }
  if (language) {
    whereClauses.push('s.language = ?');
    queryParams.push(language);
  }

  const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

  const [[{ total_count }]] = await pool.query(
    `SELECT COUNT(*) AS total_count
     FROM stories s
     LEFT JOIN users u ON s.user_id = u.id
     ${whereSql}`,
    queryParams
  );

  const [rows] = await pool.query(
    `SELECT
       s.id,
       s.title,
       s.description,
       s.cover_image_path,
       s.status,
       s.release_status,
       s.is_approved,
       s.admin_remarks,
       s.language,
       s.is_premium,
       s.rating,
       s.total_views,
       s.listeners_count,
       s.episodes_count,
       s.created_at,
       s.updated_at,
       u.id          AS creator_id,
       u.name        AS creator_name,
       u.avatar_path AS creator_avatar,
       u.email       AS creator_email,
       c.category_name,
       (SELECT COUNT(*) FROM episodes e WHERE e.story_id = s.id)                       AS real_episodes_count,
       (SELECT COALESCE(SUM(e.plays_count), 0) FROM episodes e WHERE e.story_id = s.id) AS total_plays
     FROM stories s
     LEFT JOIN users u ON s.user_id = u.id
     LEFT JOIN categories c ON s.category_id = c.id
     ${whereSql}
     ORDER BY s.created_at DESC
     LIMIT ? OFFSET ?`,
    [...queryParams, limitNum, offset]
  );

  const stories = rows.map((s) => {
    const plays = Math.max(Number(s.total_plays || 0), Number(s.total_views || 0));
    const episodes = Number(s.real_episodes_count || s.episodes_count || 0);
    return {
      id: Number(s.id),
      title: s.title,
      description: s.description || null,
      cover_image: resolveUrl(s.cover_image_path),
      cover_image_path: s.cover_image_path || null,
      category: s.category_name || null,
      language: s.language || null,
      is_premium: Boolean(s.is_premium),
      rating: Number(s.rating || 0),
      status: s.status || null,
      release_status: s.release_status || null,
      is_approved: s.is_approved,
      admin_remarks: s.admin_remarks || null,
      episodes_count: episodes,
      total_plays: plays,
      formatted_plays: formatNumber(plays),
      listeners_count: Number(s.listeners_count || 0),
      formatted_listeners: formatNumber(s.listeners_count || 0),
      submitted_date: formatDate(s.created_at),
      creator: {
        id: s.creator_id ? Number(s.creator_id) : null,
        name: s.creator_name || 'Unknown Creator',
        avatar: resolveUrl(s.creator_avatar),
        email: s.creator_email || null,
      },
      created_at: s.created_at,
      updated_at: s.updated_at,
    };
  });

  return { stories, total_count: Number(total_count || 0) };
}

/**
 * Shared summary KPIs across all approval buckets
 */
async function fetchApprovalSummary() {
  const [[{ total_approved }]] = await pool.query(
    `SELECT COUNT(*) AS total_approved FROM stories s
     LEFT JOIN users u ON s.user_id = u.id
     WHERE s.is_approved = 'Approved'
       AND (u.role = 'creator' OR u.role = 'Creator')`
  );
  const [[{ total_pending }]] = await pool.query(
    `SELECT COUNT(*) AS total_pending FROM stories WHERE is_approved = 'Pending'`
  );
  const [[{ total_rejected }]] = await pool.query(
    `SELECT COUNT(*) AS total_rejected FROM stories WHERE is_approved = 'Rejected'`
  );
  return {
    total_approved: Number(total_approved || 0),
    total_pending: Number(total_pending || 0),
    total_rejected: Number(total_rejected || 0),
  };
}

// ── Controller ────────────────────────────────────────────────────────────────

class AdminPublishedStoriesController {

  // ── 1. PENDING STORIES LIST ─────────────────────────────────────────────────

  /**
   * GET /api/v1/admin/pending-stories
   *
   * Lists all stories where is_approved = 'Pending'.
   * Matches the "Pending Stories" screen — STORY | CREATOR | SUBMITTED | Actions
   *
   * Query params: search, category_id, language, page, limit
   */
  static async pendingStories(req, res) {
    try {
      const { search, category_id, language, page = 1, limit = 20 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

      const { stories, total_count } = await fetchStoryList({
        approvalStatus: 'Pending',
        search, category_id, language, pageNum, limitNum,
      });

      const summary = await fetchApprovalSummary();

      return ApiResponse.success(
        res,
        {
          stories,
          data: stories,
          summary,
          pagination: {
            total: total_count,
            page: pageNum,
            limit: limitNum,
            total_pages: Math.ceil(total_count / limitNum),
          },
        },
        'Pending stories fetched successfully.'
      );
    } catch (error) {
      console.error('Admin Pending Stories Error:', error);
      return ApiResponse.error(res, 'Failed to fetch pending stories.', 500);
    }
  }

  // ── 2. PUBLISHED (APPROVED) STORIES LIST ────────────────────────────────────

  /**
   * GET /api/v1/admin/published-stories
   *
   * Lists all stories where is_approved = 'Approved'.
   * Matches the "Published Stories" screen — STORY | CREATOR | EPISODES | PLAYS
   *
   * Query params: search, category_id, language, page, limit
   */
  static async index(req, res) {
    try {
      const { search, category_id, language, page = 1, limit = 20 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

      const { stories, total_count } = await fetchStoryList({
        approvalStatus: 'Approved',
        search, category_id, language, pageNum, limitNum,
      });

      const summary = await fetchApprovalSummary();

      return ApiResponse.success(
        res,
        {
          stories,
          data: stories,
          summary,
          pagination: {
            total: total_count,
            page: pageNum,
            limit: limitNum,
            total_pages: Math.ceil(total_count / limitNum),
          },
        },
        'Published stories fetched successfully.'
      );
    } catch (error) {
      console.error('Admin Published Stories Error:', error);
      return ApiResponse.error(res, 'Failed to fetch published stories.', 500);
    }
  }

  // ── 3. SINGLE STORY DETAIL ──────────────────────────────────────────────────

  /**
   * GET /api/v1/admin/published-stories/:id
   * GET /api/v1/admin/pending-stories/:id
   *
   * Full detail of any story regardless of approval status.
   */
  static async show(req, res) {
    try {
      const storyId = req.params.id;

      const [rows] = await pool.query(
        `SELECT
           s.*,
           u.id          AS creator_id,
           u.name        AS creator_name,
           u.avatar_path AS creator_avatar,
           u.email       AS creator_email,
           c.category_name,
           (SELECT COUNT(*) FROM episodes e WHERE e.story_id = s.id)              AS real_episodes_count,
           (SELECT COALESCE(SUM(e.plays_count), 0) FROM episodes e WHERE e.story_id = s.id) AS total_plays,
           (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id)         AS likes_count
         FROM stories s
         LEFT JOIN users u ON s.user_id = u.id
         LEFT JOIN categories c ON s.category_id = c.id
         WHERE s.id = ?
         LIMIT 1`,
        [storyId]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 404);
      }

      const s = rows[0];
      const plays = Math.max(Number(s.total_plays || 0), Number(s.total_views || 0));
      const episodes = Number(s.real_episodes_count || s.episodes_count || 0);

      const story = {
        id: Number(s.id),
        title: s.title,
        description: s.description || null,
        cover_image: resolveUrl(s.cover_image_path),
        banner_image: resolveUrl(s.banner_image_path),
        cover_image_path: s.cover_image_path || null,
        category: s.category_name || null,
        language: s.language || null,
        tags: s.tags || null,
        is_premium: Boolean(s.is_premium),
        rating: Number(s.rating || 0),
        status: s.status || null,
        release_status: s.release_status || null,
        is_approved: s.is_approved,
        admin_remarks: s.admin_remarks || null,
        episodes_count: episodes,
        total_plays: plays,
        formatted_plays: formatNumber(plays),
        listeners_count: Number(s.listeners_count || 0),
        formatted_listeners: formatNumber(s.listeners_count || 0),
        likes_count: Number(s.likes_count || 0),
        shares_count: Number(s.shares_count || 0),
        submitted_date: formatDate(s.created_at),
        creator: {
          id: s.creator_id ? Number(s.creator_id) : null,
          name: s.creator_name || 'Unknown Creator',
          avatar: resolveUrl(s.creator_avatar),
          email: s.creator_email || null,
        },
        created_at: s.created_at,
        updated_at: s.updated_at,
      };

      return ApiResponse.success(res, { story }, 'Story detail fetched successfully.');
    } catch (error) {
      console.error('Admin Story Show Error:', error);
      return ApiResponse.error(res, 'Failed to fetch story detail.', 500);
    }
  }

  // ── 4. APPROVE STORY ────────────────────────────────────────────────────────

  /**
   * POST /api/v1/admin/stories/:id/approve
   * PUT  /api/v1/admin/stories/:id/approve
   *
   * Sets is_approved = 'Approved' and stores admin_remarks in DB.
   *
   * Body (optional):
   *  - remarks : string — admin note / approval message saved in admin_remarks
   */
  static async approve(req, res) {
    try {
      const storyId = req.params.id;
      const remarks = req.body.remarks || req.body.admin_remarks || req.body.note || null;

      const [existing] = await pool.query(
        'SELECT id, title, is_approved FROM stories WHERE id = ? LIMIT 1',
        [storyId]
      );
      if (existing.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 404);
      }

      await pool.query(
        "UPDATE stories SET is_approved = 'Approved', admin_remarks = ?, updated_at = NOW() WHERE id = ?",
        [remarks, storyId]
      );

      return ApiResponse.success(
        res,
        {
          id: Number(storyId),
          title: existing[0].title,
          is_approved: 'Approved',
          admin_remarks: remarks,
        },
        'Story approved successfully.'
      );
    } catch (error) {
      console.error('Admin Approve Story Error:', error);
      return ApiResponse.error(res, 'Failed to approve story.', 500);
    }
  }

  // ── 5. REJECT STORY ─────────────────────────────────────────────────────────

  /**
   * POST /api/v1/admin/stories/:id/reject
   * PUT  /api/v1/admin/stories/:id/reject
   *
   * Sets is_approved = 'Rejected' and stores the rejection remarks in admin_remarks.
   *
   * Body:
   *  - remarks : string — reason for rejection (required for good UX, enforced)
   */
  static async reject(req, res) {
    try {
      const storyId = req.params.id;
      const remarks = req.body.remarks || req.body.admin_remarks || req.body.rejection_reason || req.body.note || null;

      if (!remarks || !remarks.trim()) {
        return ApiResponse.error(
          res,
          'Remarks / rejection reason is required when rejecting a story.',
          422
        );
      }

      const [existing] = await pool.query(
        'SELECT id, title, is_approved FROM stories WHERE id = ? LIMIT 1',
        [storyId]
      );
      if (existing.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 404);
      }

      await pool.query(
        "UPDATE stories SET is_approved = 'Rejected', admin_remarks = ?, updated_at = NOW() WHERE id = ?",
        [remarks.trim(), storyId]
      );

      return ApiResponse.success(
        res,
        {
          id: Number(storyId),
          title: existing[0].title,
          is_approved: 'Rejected',
          admin_remarks: remarks.trim(),
        },
        'Story rejected successfully.'
      );
    } catch (error) {
      console.error('Admin Reject Story Error:', error);
      return ApiResponse.error(res, 'Failed to reject story.', 500);
    }
  }

  // ── 6. GENERIC APPROVAL STATUS UPDATE ──────────────────────────────────────

  /**
   * POST /api/v1/admin/stories/:id/approval-status
   * PUT  /api/v1/admin/stories/:id/approval-status
   *
   * Generic update — sets is_approved to Approved | Rejected | Pending.
   * Stores remarks in admin_remarks.
   *
   * Body:
   *  - status  : 'Approved' | 'Rejected' | 'Pending'
   *  - remarks : string (required when status = 'Rejected')
   */
  static async updateApprovalStatus(req, res) {
    try {
      const storyId = req.params.id;
      const { status } = req.body;
      const remarks = req.body.remarks || req.body.admin_remarks || req.body.rejection_reason || req.body.note || null;

      const validStatuses = ['Approved', 'Rejected', 'Pending'];
      if (!status || !validStatuses.includes(status)) {
        return ApiResponse.error(
          res,
          `Invalid status "${status}". Allowed values: ${validStatuses.join(', ')}.`,
          422
        );
      }

      if (status === 'Rejected' && (!remarks || !remarks.trim())) {
        return ApiResponse.error(
          res,
          'Remarks / rejection reason is required when rejecting a story.',
          422
        );
      }

      const [existing] = await pool.query(
        'SELECT id, title FROM stories WHERE id = ? LIMIT 1',
        [storyId]
      );
      if (existing.length === 0) {
        return ApiResponse.error(res, 'Story not found.', 404);
      }

      await pool.query(
        'UPDATE stories SET is_approved = ?, admin_remarks = ?, updated_at = NOW() WHERE id = ?',
        [status, remarks ? remarks.trim() : null, storyId]
      );

      return ApiResponse.success(
        res,
        {
          id: Number(storyId),
          title: existing[0].title,
          is_approved: status,
          admin_remarks: remarks ? remarks.trim() : null,
        },
        `Story ${status.toLowerCase()} successfully.`
      );
    } catch (error) {
      console.error('Admin Update Story Approval Error:', error);
      return ApiResponse.error(res, 'Failed to update story approval status.', 500);
    }
  }
}

module.exports = AdminPublishedStoriesController;
