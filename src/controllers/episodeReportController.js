const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

const MAX_MESSAGE_LENGTH = 2000;

function formatReport(r) {
  return {
    id: Number(r.id),
    user_id: Number(r.user_id),
    episode_id: Number(r.episode_id),
    story_id: r.story_id !== null && r.story_id !== undefined ? Number(r.story_id) : null,
    reason: r.reason || null,
    message: r.message || null,
    status: r.status || 'pending',
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
    updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}

class EpisodeReportController {
  /**
   * POST /report-episode  |  POST /episodes/report  |  POST /episodes/:id/report
   * Body: { episode_id, story_id?, reason?, message }
   * user_id is taken from the authenticated token.
   */
  static async store(req, res) {
    try {
      const userId = req.user.id;
      const body = req.body || {};

      const episodeId = Number(req.params.id || body.episode_id);
      const storyIdInput = body.story_id !== undefined && body.story_id !== null && body.story_id !== ''
        ? Number(body.story_id)
        : null;
      const reason = body.reason ? String(body.reason).trim().slice(0, 100) : null;
      const message = body.message !== undefined && body.message !== null ? String(body.message).trim() : '';

      // Validation
      const errors = {};
      if (!episodeId || Number.isNaN(episodeId)) errors.episode_id = ['The episode_id field is required.'];
      if (storyIdInput !== null && Number.isNaN(storyIdInput)) errors.story_id = ['The story_id must be a number.'];
      if (!message && !reason) errors.message = ['The message field is required.'];
      if (message.length > MAX_MESSAGE_LENGTH) {
        errors.message = [`The message may not be greater than ${MAX_MESSAGE_LENGTH} characters.`];
      }
      if (Object.keys(errors).length) {
        return ApiResponse.error(res, 'Validation failed.', 422, errors);
      }

      // Episode must exist
      const [episodes] = await pool.query('SELECT id, story_id FROM episodes WHERE id = ? LIMIT 1', [episodeId]);
      if (episodes.length === 0) {
        return ApiResponse.error(res, 'Episode not found.', 404);
      }
      const episode = episodes[0];

      // story_id must match the episode's story if provided
      if (storyIdInput !== null && episode.story_id && Number(episode.story_id) !== storyIdInput) {
        return ApiResponse.error(res, 'Episode does not belong to the given story.', 422, {
          story_id: ['The story_id does not match the episode.'],
        });
      }
      const storyId = episode.story_id ? Number(episode.story_id) : storyIdInput;

      // Prevent duplicate pending reports from the same user on the same episode
      const [existing] = await pool.query(
        "SELECT id FROM episode_reports WHERE user_id = ? AND episode_id = ? AND status = 'pending' LIMIT 1",
        [userId, episodeId]
      );
      if (existing.length > 0) {
        return ApiResponse.error(res, 'You have already reported this episode. Our team is reviewing it.', 409);
      }

      const [result] = await pool.query(
        `INSERT INTO episode_reports (user_id, episode_id, story_id, reason, message, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', NOW(), NOW())`,
        [userId, episodeId, storyId, reason, message || null]
      );

      const [rows] = await pool.query('SELECT * FROM episode_reports WHERE id = ? LIMIT 1', [result.insertId]);

      return ApiResponse.success(res, { report: formatReport(rows[0]) }, 'Episode reported successfully.', 201);
    } catch (error) {
      console.error('Report Episode Error:', error);
      return ApiResponse.error(res, 'Failed to report episode.', 500);
    }
  }

  /**
   * GET /user/episode-reports
   * Lists the authenticated user's own reports (paginated).
   */
  static async myReports(req, res) {
    try {
      const userId = req.user.id;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));
      const offset = (page - 1) * perPage;

      const [[{ total }]] = await pool.query(
        'SELECT COUNT(*) AS total FROM episode_reports WHERE user_id = ?',
        [userId]
      );

      const [rows] = await pool.query(
        `SELECT * FROM episode_reports
         WHERE user_id = ?
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [userId, perPage, offset]
      );

      return ApiResponse.success(res, {
        reports: rows.map(formatReport),
        pagination: {
          page,
          per_page: perPage,
          total: Number(total),
          last_page: Math.max(1, Math.ceil(Number(total) / perPage)),
        },
      });
    } catch (error) {
      console.error('List Episode Reports Error:', error);
      return ApiResponse.error(res, 'Failed to fetch reports.', 500);
    }
  }
}

module.exports = EpisodeReportController;
