const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const { toProfileFieldsArray } = require('../utils/userPresenter');
const { uploadToR2, deleteFromR2 } = require('../services/r2StorageService');

class MeController {
  static async show(req, res) {
    try {
      const user = req.user;
      return ApiResponse.success(res, {
        user: toProfileFieldsArray(user),
      });
    } catch (error) {
      console.error('Get Profile Error:', error);
      return ApiResponse.error(res, 'Failed to fetch profile.', 500);
    }
  }

  static async update(req, res) {
    try {
      const userId = req.user.id;
      const currentUser = req.user;
      const data = req.body;

      const allowedFields = ['name', 'phone', 'country', 'state', 'city', 'age_group', 'gender', 'email', 'locale'];
      const updateFields = [];
      const queryParams = [];

      for (const field of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(data, field)) {
          // If updating phone, ensure unique constraint
          if (field === 'phone' && data.phone && data.phone !== currentUser.phone) {
            const [existing] = await pool.query('SELECT id FROM users WHERE phone = ? AND id != ? LIMIT 1', [data.phone, userId]);
            if (existing.length > 0) {
              return ApiResponse.error(res, 'Phone number is already taken.', 422);
            }
          }
          // If updating email, ensure unique constraint
          if (field === 'email' && data.email && data.email !== currentUser.email) {
            const [existing] = await pool.query('SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1', [data.email.toLowerCase(), userId]);
            if (existing.length > 0) {
              return ApiResponse.error(res, 'Email is already taken.', 422);
            }
          }

          updateFields.push(`\`${field}\` = ?`);
          queryParams.push(field === 'email' ? data.email.toLowerCase() : data[field]);
        }
      }

      // Handle Image File Upload to Cloudflare R2
      if (req.file) {
        try {
          if (currentUser.avatar_path) {
            await deleteFromR2(currentUser.avatar_path);
          }
          const r2Url = await uploadToR2(req.file, 'avatars');
          updateFields.push('`avatar_path` = ?');
          queryParams.push(r2Url);
        } catch (uploadErr) {
          console.error('R2 Upload Error:', uploadErr);
          return ApiResponse.error(res, 'Failed to upload profile image to Cloudflare R2.', 500);
        }
      }

      if (updateFields.length > 0) {
        queryParams.push(userId);
        const updateQuery = `UPDATE users SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`;
        await pool.query(updateQuery, queryParams);
      }

      // Fetch fresh user record
      const [userRows] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
      const updatedUser = userRows[0];

      return ApiResponse.success(
        res,
        {
          user: toProfileFieldsArray(updatedUser),
        },
        'Profile updated.'
      );
    } catch (error) {
      console.error('Update Profile Error:', error);
      return ApiResponse.error(res, 'Failed to update profile.', 500);
    }
  }
}

module.exports = MeController;
