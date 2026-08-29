const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

class SettingsController {
  // ── System Settings ─────────────────────────────────────────────────────

  static async getSettings(req, res) {
    try {
      const [rows] = await pool.query('SELECT * FROM settings');
      const settingsMap = {};
      rows.forEach((r) => {
        settingsMap[r.key] = r.value;
      });

      return ApiResponse.success(res, { settings: settingsMap });
    } catch (error) {
      console.error('Admin Get Settings Error:', error);
      return ApiResponse.error(res, 'Failed to fetch system settings.', 500);
    }
  }

  static async updateSettings(req, res) {
    try {
      const settings = req.body;
      if (!settings || typeof settings !== 'object') {
        return ApiResponse.error(res, 'Settings key-value object is required.', 422);
      }

      for (const [key, value] of Object.entries(settings)) {
        await pool.query(
          `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
          [key, String(value)]
        );
      }

      const [rows] = await pool.query('SELECT * FROM settings');
      const settingsMap = {};
      rows.forEach((r) => {
        settingsMap[r.key] = r.value;
      });

      return ApiResponse.success(res, { settings: settingsMap }, 'System settings updated successfully.');
    } catch (error) {
      console.error('Admin Update Settings Error:', error);
      return ApiResponse.error(res, 'Failed to update system settings.', 500);
    }
  }

  // ── Push Notifications Broadcast ────────────────────────────────────────

  static async sendNotification(req, res) {
    try {
      const { title, body, user_id, action_type, action_value } = req.body;

      if (!title || !body) {
        return ApiResponse.error(res, 'Notification title and body are required.', 422);
      }

      let recipientCount = 0;
      if (user_id) {
        const [[{ count }]] = await pool.query('SELECT COUNT(*) as count FROM users WHERE id = ?', [user_id]);
        recipientCount = count;
      } else {
        const [[{ count }]] = await pool.query('SELECT COUNT(*) as count FROM users WHERE is_blocked = 0');
        recipientCount = count;
      }

      return ApiResponse.success(
        res,
        {
          notification: {
            title,
            body,
            target_user_id: user_id ? Number(user_id) : 'all',
            recipients_count: recipientCount,
            action_type: action_type || 'none',
            action_value: action_value || null,
            sent_at: new Date(),
          },
        },
        `Push notification broadcast queued for ${recipientCount} user(s).`
      );
    } catch (error) {
      console.error('Admin Send Notification Error:', error);
      return ApiResponse.error(res, 'Failed to send push notification.', 500);
    }
  }

  // ── FAQs CRUD ───────────────────────────────────────────────────────────

  static async storeFaq(req, res) {
    try {
      const { question, answer, position, status } = req.body;

      if (!question || !answer) {
        return ApiResponse.error(res, 'Question and answer are required.', 422);
      }

      const posVal = position ? parseInt(position, 10) : 0;
      const statusVal = status === '0' || status === 0 || status === false ? 0 : 1;

      const [result] = await pool.query(
        'INSERT INTO faqs (question, answer, position, status) VALUES (?, ?, ?, ?)',
        [question.trim(), answer.trim(), posVal, statusVal]
      );

      const [newFaq] = await pool.query('SELECT * FROM faqs WHERE id = ? LIMIT 1', [result.insertId]);

      return ApiResponse.success(res, { faq: newFaq[0] }, 'FAQ created successfully.', 201);
    } catch (error) {
      console.error('Admin Store FAQ Error:', error);
      return ApiResponse.error(res, 'Failed to create FAQ.', 500);
    }
  }

  static async updateFaq(req, res) {
    try {
      const faqId = req.params.id;
      const { question, answer, position, status } = req.body;

      const updateFields = [];
      const queryParams = [];

      if (question) { updateFields.push('`question` = ?'); queryParams.push(question.trim()); }
      if (answer) { updateFields.push('`answer` = ?'); queryParams.push(answer.trim()); }
      if (position !== undefined) { updateFields.push('`position` = ?'); queryParams.push(parseInt(position, 10)); }
      if (status !== undefined) { updateFields.push('`status` = ?'); queryParams.push(status ? 1 : 0); }

      if (updateFields.length > 0) {
        queryParams.push(faqId);
        await pool.query(`UPDATE faqs SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`, queryParams);
      }

      const [updated] = await pool.query('SELECT * FROM faqs WHERE id = ? LIMIT 1', [faqId]);
      return ApiResponse.success(res, { faq: updated[0] }, 'FAQ updated successfully.');
    } catch (error) {
      console.error('Admin Update FAQ Error:', error);
      return ApiResponse.error(res, 'Failed to update FAQ.', 500);
    }
  }

  static async deleteFaq(req, res) {
    try {
      const faqId = req.params.id;
      await pool.query('DELETE FROM faqs WHERE id = ?', [faqId]);
      return ApiResponse.success(res, { faq_id: Number(faqId) }, 'FAQ deleted successfully.');
    } catch (error) {
      console.error('Admin Delete FAQ Error:', error);
      return ApiResponse.error(res, 'Failed to delete FAQ.', 500);
    }
  }
}

module.exports = SettingsController;
