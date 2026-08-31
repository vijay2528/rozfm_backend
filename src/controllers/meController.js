const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const { toProfileFieldsArray, checkIsProfileComplete, checkIsCategorySelected } = require('../utils/userPresenter');
const { uploadToR2, deleteFromR2 } = require('../services/r2StorageService');

class MeController {
  static async show(req, res) {
    try {
      const user = req.user;
      const isProfileComplete = checkIsProfileComplete(user);
      const isCategorySelected = await checkIsCategorySelected(user.id);
      return ApiResponse.success(res, {
        isProfileComplete,
        isCategorySelected,
        user: toProfileFieldsArray(user, { isProfileComplete, isCategorySelected }),
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
          if (field === 'phone' && data.phone && data.phone !== currentUser.phone) {
            const [existing] = await pool.query('SELECT id FROM users WHERE phone = ? AND id != ? LIMIT 1', [data.phone, userId]);
            if (existing.length > 0) {
              return ApiResponse.error(res, 'Phone number is already taken.', 422);
            }
          }
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

      const [userRows] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
      const updatedUser = userRows[0];

      const isProfileComplete = checkIsProfileComplete(updatedUser);
      const isCategorySelected = await checkIsCategorySelected(updatedUser.id);

      return ApiResponse.success(
        res,
        {
          isProfileComplete,
          isCategorySelected,
          user: toProfileFieldsArray(updatedUser, { isProfileComplete, isCategorySelected }),
        },
        'Profile updated.'
      );
    } catch (error) {
      console.error('Update Profile Error:', error);
      return ApiResponse.error(res, 'Failed to update profile.', 500);
    }
  }

  static async selectLanguage(req, res) {
    try {
      const { locale } = req.body;
      if (!locale) {
        return ApiResponse.error(res, 'Locale language is required.', 422);
      }
      await pool.query('UPDATE users SET locale = ? WHERE id = ?', [locale, req.user.id]);
      return ApiResponse.success(res, { locale }, 'Language preference updated.');
    } catch (error) {
      console.error('Select Language Error:', error);
      return ApiResponse.error(res, 'Failed to select language.', 500);
    }
  }

  static async deleteAccount(req, res) {
    try {
      await pool.query('DELETE FROM users WHERE id = ?', [req.user.id]);
      return ApiResponse.success(res, null, 'Account deleted successfully.');
    } catch (error) {
      console.error('Delete Account Error:', error);
      return ApiResponse.error(res, 'Failed to delete account.', 500);
    }
  }

  static async requestPhoneUpdate(req, res) {
    try {
      const { phone } = req.body;
      if (!phone) {
        return ApiResponse.error(res, 'Phone number is required.', 422);
      }
      const [existing] = await pool.query('SELECT id FROM users WHERE phone = ? AND id != ? LIMIT 1', [phone, req.user.id]);
      if (existing.length > 0) {
        return ApiResponse.error(res, 'Phone number is already registered to another account.', 422);
      }

      // Generate demo OTP '123456' for verification
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await pool.query(
        'INSERT INTO otp_verifications (phone, otp, expires_at) VALUES (?, ?, ?)',
        [phone, '123456', expiresAt]
      );

      return ApiResponse.success(res, { phone, otp_demo: '123456' }, 'OTP sent for phone update verification.');
    } catch (error) {
      console.error('Request Phone Update Error:', error);
      return ApiResponse.error(res, 'Failed to initiate phone update.', 500);
    }
  }

  static async verifyPhoneUpdate(req, res) {
    try {
      const { phone, otp } = req.body;
      if (!phone || !otp) {
        return ApiResponse.error(res, 'Phone and OTP are required.', 422);
      }

      const [otpRows] = await pool.query(
        'SELECT * FROM otp_verifications WHERE phone = ? AND otp = ? AND expires_at > NOW() ORDER BY id DESC LIMIT 1',
        [phone, otp]
      );

      if (otpRows.length === 0) {
        return ApiResponse.error(res, 'Invalid or expired OTP.', 422);
      }

      await pool.query('UPDATE users SET phone = ? WHERE id = ?', [phone, req.user.id]);
      return ApiResponse.success(res, { phone }, 'Phone number updated successfully.');
    } catch (error) {
      console.error('Verify Phone Update Error:', error);
      return ApiResponse.error(res, 'Failed to verify phone update.', 500);
    }
  }

  static async getNotificationSettings(req, res) {
    try {
      const [rows] = await pool.query('SELECT * FROM user_notification_settings WHERE user_id = ? LIMIT 1', [req.user.id]);
      let settings = rows[0];

      if (!settings) {
        settings = {
          new_episodes: 1,
          promotions: 1,
          recommendations: 1,
          account_activity: 1,
        };
      }

      return ApiResponse.success(res, {
        new_episodes: Boolean(settings.new_episodes),
        promotions: Boolean(settings.promotions),
        recommendations: Boolean(settings.recommendations),
        account_activity: Boolean(settings.account_activity),
      });
    } catch (error) {
      console.error('Get Notification Settings Error:', error);
      return ApiResponse.error(res, 'Failed to fetch notification settings.', 500);
    }
  }

  static async updateNotificationSettings(req, res) {
    try {
      const { new_episodes, promotions, recommendations, account_activity } = req.body;
      const userId = req.user.id;

      const newEp = new_episodes !== undefined ? (new_episodes ? 1 : 0) : 1;
      const promo = promotions !== undefined ? (promotions ? 1 : 0) : 1;
      const recom = recommendations !== undefined ? (recommendations ? 1 : 0) : 1;
      const accAct = account_activity !== undefined ? (account_activity ? 1 : 0) : 1;

      await pool.query(
        `INSERT INTO user_notification_settings (user_id, new_episodes, promotions, recommendations, account_activity)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         new_episodes = VALUES(new_episodes),
         promotions = VALUES(promotions),
         recommendations = VALUES(recommendations),
         account_activity = VALUES(account_activity)`,
        [userId, newEp, promo, recom, accAct]
      );

      return ApiResponse.success(
        res,
        {
          new_episodes: Boolean(newEp),
          promotions: Boolean(promo),
          recommendations: Boolean(recom),
          account_activity: Boolean(accAct),
        },
        'Notification settings updated.'
      );
    } catch (error) {
      console.error('Update Notification Settings Error:', error);
      return ApiResponse.error(res, 'Failed to update notification settings.', 500);
    }
  }
}

module.exports = MeController;
