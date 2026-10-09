const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');
const PushNotificationService = require('../../services/pushNotificationService');

class SettingsController {
  // ── General Settings ─────────────────────────────────────────────────────

  static async getGeneralSettings(req, res) {
    try {
      const [rows] = await pool.query('SELECT `key`, `value` FROM settings');
      const settingsMap = {};
      rows.forEach((r) => {
        settingsMap[r.key] = r.value;
      });

      const generalSettings = {
        platform_name: settingsMap.platform_name || settingsMap.app_name || 'Roz FM',
        support_email: settingsMap.support_email || 'support@rozfm.com',
        default_language: settingsMap.default_language || 'English',
        app_version: settingsMap.app_version || '1.0.0',
        platform_tagline: settingsMap.platform_tagline || 'Stories that stay with you.',
        social_links: {
          instagram: settingsMap.social_instagram || 'instagram.com/rozfm',
          twitter: settingsMap.social_twitter || settingsMap.social_x || 'x.com/rozfm',
        },
        social_instagram: settingsMap.social_instagram || 'instagram.com/rozfm',
        social_twitter: settingsMap.social_twitter || settingsMap.social_x || 'x.com/rozfm',
        maintenance_mode: settingsMap.maintenance_mode === 'true' || settingsMap.maintenance_mode === true,
        allow_new_signups: settingsMap.allow_new_signups === undefined ? true : (settingsMap.allow_new_signups === 'true' || settingsMap.allow_new_signups === true),
        guest_mode_access: settingsMap.guest_mode_access === undefined ? true : (settingsMap.guest_mode_access === 'true' || settingsMap.guest_mode_access === true),
      };

      return ApiResponse.success(res, { general_settings: generalSettings }, 'General settings fetched successfully.');
    } catch (error) {
      console.error('Admin Get General Settings Error:', error);
      return ApiResponse.error(res, 'Failed to fetch general settings.', 500);
    }
  }

  static async updateGeneralSettings(req, res) {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return ApiResponse.error(res, 'Settings object is required.', 422);
      }

      const settingsToUpdate = {};

      if (body.platform_name !== undefined) settingsToUpdate.platform_name = body.platform_name;
      if (body.app_name !== undefined) settingsToUpdate.platform_name = body.app_name;
      if (body.support_email !== undefined) settingsToUpdate.support_email = body.support_email;
      if (body.default_language !== undefined) settingsToUpdate.default_language = body.default_language;
      if (body.app_version !== undefined) settingsToUpdate.app_version = body.app_version;
      if (body.platform_tagline !== undefined) settingsToUpdate.platform_tagline = body.platform_tagline;

      if (body.social_links && typeof body.social_links === 'object') {
        if (body.social_links.instagram !== undefined) settingsToUpdate.social_instagram = body.social_links.instagram;
        if (body.social_links.twitter !== undefined) settingsToUpdate.social_twitter = body.social_links.twitter;
        if (body.social_links.x !== undefined) settingsToUpdate.social_twitter = body.social_links.x;
      }
      if (body.social_instagram !== undefined) settingsToUpdate.social_instagram = body.social_instagram;
      if (body.social_twitter !== undefined) settingsToUpdate.social_twitter = body.social_twitter;
      if (body.social_x !== undefined) settingsToUpdate.social_twitter = body.social_x;

      if (body.maintenance_mode !== undefined) settingsToUpdate.maintenance_mode = String(Boolean(body.maintenance_mode));
      if (body.allow_new_signups !== undefined) settingsToUpdate.allow_new_signups = String(Boolean(body.allow_new_signups));
      if (body.guest_mode_access !== undefined) settingsToUpdate.guest_mode_access = String(Boolean(body.guest_mode_access));

      for (const [k, v] of Object.entries(body)) {
        if (typeof v !== 'object' && !['platform_name', 'app_name', 'support_email', 'default_language', 'app_version', 'platform_tagline', 'social_instagram', 'social_twitter', 'social_x', 'maintenance_mode', 'allow_new_signups', 'guest_mode_access', 'social_links'].includes(k)) {
          settingsToUpdate[k] = String(v);
        }
      }

      for (const [key, value] of Object.entries(settingsToUpdate)) {
        await pool.query(
          `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
          [key, String(value)]
        );
      }

      if (settingsToUpdate.platform_name) {
        await pool.query(
          `INSERT INTO settings (\`key\`, \`value\`) VALUES ('app_name', ?)
           ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
          [String(settingsToUpdate.platform_name)]
        );
      }

      return await SettingsController.getGeneralSettings(req, res);
    } catch (error) {
      console.error('Admin Update General Settings Error:', error);
      return ApiResponse.error(res, 'Failed to update general settings.', 500);
    }
  }

  // ── Storage Settings (Cloudflare R2 / AWS S3 / Firebase) ─────────────────────

  static async getStorageSettings(req, res) {
    try {
      const [rows] = await pool.query('SELECT `key`, `value` FROM settings');
      const settingsMap = {};
      rows.forEach((r) => {
        settingsMap[r.key] = r.value;
      });

      const storageSettings = {
        cloudflare_r2: {
          bucket_name: settingsMap.r2_bucket_name || settingsMap.r2_bucket || process.env.AWS_BUCKET || 'rozfm-audio-prod',
          region: settingsMap.r2_region || process.env.AWS_DEFAULT_REGION || 'auto',
          enabled: settingsMap.r2_enabled === undefined ? true : (settingsMap.r2_enabled === 'true' || settingsMap.r2_enabled === true),
        },
        aws_s3: {
          s3_bucket: settingsMap.s3_bucket_name || settingsMap.s3_bucket || 'rozfm-assets-backup',
          bucket_name: settingsMap.s3_bucket_name || settingsMap.s3_bucket || 'rozfm-assets-backup',
        },
        firebase: {
          project_id: settingsMap.firebase_project_id || process.env.FIREBASE_PROJECT_ID || 'rozfm-prod',
          storage_enabled: settingsMap.firebase_storage_enabled === undefined ? true : (settingsMap.firebase_storage_enabled === 'true' || settingsMap.firebase_storage_enabled === true),
        },
        r2_bucket_name: settingsMap.r2_bucket_name || settingsMap.r2_bucket || process.env.AWS_BUCKET || 'rozfm-audio-prod',
        r2_region: settingsMap.r2_region || process.env.AWS_DEFAULT_REGION || 'auto',
        r2_enabled: settingsMap.r2_enabled === undefined ? true : (settingsMap.r2_enabled === 'true' || settingsMap.r2_enabled === true),
        s3_bucket_name: settingsMap.s3_bucket_name || settingsMap.s3_bucket || 'rozfm-assets-backup',
        firebase_project_id: settingsMap.firebase_project_id || process.env.FIREBASE_PROJECT_ID || 'rozfm-prod',
        firebase_storage_enabled: settingsMap.firebase_storage_enabled === undefined ? true : (settingsMap.firebase_storage_enabled === 'true' || settingsMap.firebase_storage_enabled === true),
      };

      return ApiResponse.success(res, { storage_settings: storageSettings }, 'Storage settings fetched successfully.');
    } catch (error) {
      console.error('Admin Get Storage Settings Error:', error);
      return ApiResponse.error(res, 'Failed to fetch storage settings.', 500);
    }
  }

  static async updateStorageSettings(req, res) {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return ApiResponse.error(res, 'Storage settings object is required.', 422);
      }

      const settingsToUpdate = {};

      if (body.cloudflare_r2 && typeof body.cloudflare_r2 === 'object') {
        if (body.cloudflare_r2.bucket_name !== undefined) settingsToUpdate.r2_bucket_name = body.cloudflare_r2.bucket_name;
        if (body.cloudflare_r2.region !== undefined) settingsToUpdate.r2_region = body.cloudflare_r2.region;
        if (body.cloudflare_r2.enabled !== undefined) settingsToUpdate.r2_enabled = String(Boolean(body.cloudflare_r2.enabled));
      }
      if (body.r2_bucket_name !== undefined) settingsToUpdate.r2_bucket_name = body.r2_bucket_name;
      if (body.r2_bucket !== undefined) settingsToUpdate.r2_bucket_name = body.r2_bucket;
      if (body.r2_region !== undefined) settingsToUpdate.r2_region = body.r2_region;
      if (body.r2_enabled !== undefined) settingsToUpdate.r2_enabled = String(Boolean(body.r2_enabled));

      if (body.aws_s3 && typeof body.aws_s3 === 'object') {
        if (body.aws_s3.s3_bucket !== undefined) settingsToUpdate.s3_bucket_name = body.aws_s3.s3_bucket;
        if (body.aws_s3.bucket_name !== undefined) settingsToUpdate.s3_bucket_name = body.aws_s3.bucket_name;
      }
      if (body.s3_bucket_name !== undefined) settingsToUpdate.s3_bucket_name = body.s3_bucket_name;
      if (body.s3_bucket !== undefined) settingsToUpdate.s3_bucket_name = body.s3_bucket;

      if (body.firebase && typeof body.firebase === 'object') {
        if (body.firebase.project_id !== undefined) settingsToUpdate.firebase_project_id = body.firebase.project_id;
        if (body.firebase.storage_enabled !== undefined) settingsToUpdate.firebase_storage_enabled = String(Boolean(body.firebase.storage_enabled));
      }
      if (body.firebase_project_id !== undefined) settingsToUpdate.firebase_project_id = body.firebase_project_id;
      if (body.firebase_storage_enabled !== undefined) settingsToUpdate.firebase_storage_enabled = String(Boolean(body.firebase_storage_enabled));

      for (const [key, value] of Object.entries(settingsToUpdate)) {
        await pool.query(
          `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
          [key, String(value)]
        );
      }

      return await SettingsController.getStorageSettings(req, res);
    } catch (error) {
      console.error('Admin Update Storage Settings Error:', error);
      return ApiResponse.error(res, 'Failed to update storage settings.', 500);
    }
  }

  // ── Payment Keys (Admin Panel - Stored in Settings Table) ───────────────────

  static async getPaymentKeys(req, res) {
    try {
      const { search, mode, gateway } = req.query;

      const [rows] = await pool.query("SELECT `key`, `value` FROM settings WHERE `key` LIKE 'payment_key_%'");
      const settingsMap = {};
      rows.forEach((r) => {
        settingsMap[r.key] = r.value;
      });

      const gatewaysConfig = [
        { id: 1, key: 'razorpay', defaultName: 'Razorpay', defaultKeyId: 'rzp_live_987654321092ac', defaultSecret: 'rzp_sec_9876543210' },
        { id: 2, key: 'google_play', defaultName: 'Google Play', defaultKeyId: 'gpa_332198765410df', defaultSecret: 'gpa_sec_3321987654' },
        { id: 3, key: 'apple_storekit', defaultName: 'Apple StoreKit', defaultKeyId: 'app_112233445566e1', defaultSecret: 'app_sec_1122334455' },
      ];

      const maskKeyId = (keyId) => {
        if (!keyId) return '';
        if (keyId.length <= 10) return keyId;
        return `${keyId.substring(0, 8)}••••${keyId.slice(-4)}`;
      };

      let list = gatewaysConfig.map((g) => {
        const name = settingsMap[`payment_key_${g.key}_name`] || g.defaultName;
        const keyId = settingsMap[`payment_key_${g.key}_key_id`] || g.defaultKeyId;
        const keySecret = settingsMap[`payment_key_${g.key}_key_secret`] || g.defaultSecret;
        const webhookSecret = settingsMap[`payment_key_${g.key}_webhook_secret`] || '';
        const merchantId = settingsMap[`payment_key_${g.key}_merchant_id`] || '';
        const gMode = settingsMap[`payment_key_${g.key}_mode`] || 'Live';
        const gStatus = settingsMap[`payment_key_${g.key}_status`] || 'active';

        return {
          id: g.id,
          gateway: name,
          gateway_name: name,
          gateway_key: g.key,
          key_id: keyId,
          masked_key_id: maskKeyId(keyId),
          key_secret: keySecret ? (keySecret.length > 8 ? `${keySecret.substring(0, 4)}••••${keySecret.slice(-4)}` : keySecret) : '',
          webhook_secret: webhookSecret ? '••••••••' : null,
          merchant_id: merchantId || null,
          mode: gMode,
          status: gStatus === 'active' || gStatus === '1' || gStatus === true ? 'active' : 'inactive',
          is_active: gStatus === 'active' || gStatus === '1' || gStatus === true,
        };
      });

      if (search) {
        const term = search.toLowerCase();
        list = list.filter((item) => item.gateway_name.toLowerCase().includes(term) || item.gateway_key.toLowerCase().includes(term) || item.key_id.toLowerCase().includes(term));
      }

      if (mode) {
        list = list.filter((item) => item.mode.toLowerCase() === mode.toLowerCase());
      }

      if (gateway) {
        const gTerm = gateway.toLowerCase();
        list = list.filter((item) => item.gateway_key.toLowerCase() === gTerm || item.gateway_name.toLowerCase().includes(gTerm));
      }

      return ApiResponse.success(res, {
        payment_keys: list,
        total_results: list.length,
        summary_text: `Showing ${list.length} of ${list.length} results`,
      }, 'Payment keys fetched successfully.');
    } catch (error) {
      console.error('Admin Get Payment Keys Error:', error);
      return ApiResponse.error(res, 'Failed to fetch payment keys.', 500);
    }
  }

  static async getPaymentKeyById(req, res) {
    try {
      const param = String(req.params.id || '').toLowerCase();
      let gatewayKey = 'razorpay';

      if (param === '1' || param === 'razorpay') gatewayKey = 'razorpay';
      else if (param === '2' || param === 'google_play' || param === 'google') gatewayKey = 'google_play';
      else if (param === '3' || param === 'apple_storekit' || param === 'apple') gatewayKey = 'apple_storekit';
      else gatewayKey = param.replace(/\s+/g, '_');

      const [rows] = await pool.query("SELECT `key`, `value` FROM settings WHERE `key` LIKE ?", [`payment_key_${gatewayKey}_%`]);
      const settingsMap = {};
      rows.forEach((r) => {
        settingsMap[r.key] = r.value;
      });

      const defaults = {
        razorpay: { id: 1, name: 'Razorpay', key_id: 'rzp_live_987654321092ac', key_secret: 'rzp_sec_9876543210' },
        google_play: { id: 2, name: 'Google Play', key_id: 'gpa_332198765410df', key_secret: 'gpa_sec_3321987654' },
        apple_storekit: { id: 3, name: 'Apple StoreKit', key_id: 'app_112233445566e1', key_secret: 'app_sec_1122334455' },
      };

      const def = defaults[gatewayKey] || { id: 99, name: gatewayKey, key_id: '', key_secret: '' };
      const name = settingsMap[`payment_key_${gatewayKey}_name`] || def.name;
      const keyId = settingsMap[`payment_key_${gatewayKey}_key_id`] || def.key_id;
      const keySecret = settingsMap[`payment_key_${gatewayKey}_key_secret`] || def.key_secret;
      const webhookSecret = settingsMap[`payment_key_${gatewayKey}_webhook_secret`] || '';
      const merchantId = settingsMap[`payment_key_${gatewayKey}_merchant_id`] || '';
      const mode = settingsMap[`payment_key_${gatewayKey}_mode`] || 'Live';
      const status = settingsMap[`payment_key_${gatewayKey}_status`] || 'active';

      const maskKeyId = (id) => (id && id.length > 10 ? `${id.substring(0, 8)}••••${id.slice(-4)}` : id);

      const data = {
        id: def.id,
        gateway: name,
        gateway_name: name,
        gateway_key: gatewayKey,
        key_id: keyId,
        masked_key_id: maskKeyId(keyId),
        key_secret: keySecret,
        webhook_secret: webhookSecret,
        merchant_id: merchantId,
        mode: mode,
        status: status === 'active' || status === '1' || status === true ? 'active' : 'inactive',
        is_active: status === 'active' || status === '1' || status === true,
      };

      return ApiResponse.success(res, { payment_key: data }, 'Payment key fetched successfully.');
    } catch (error) {
      console.error('Admin Get Payment Key Detail Error:', error);
      return ApiResponse.error(res, 'Failed to fetch payment key details.', 500);
    }
  }

  static async updatePaymentKey(req, res) {
    try {
      const param = String(req.params.id || '').toLowerCase();
      const body = req.body;

      let gatewayKey = 'razorpay';
      if (param === '1' || param === 'razorpay') gatewayKey = 'razorpay';
      else if (param === '2' || param === 'google_play' || param === 'google') gatewayKey = 'google_play';
      else if (param === '3' || param === 'apple_storekit' || param === 'apple') gatewayKey = 'apple_storekit';
      else if (body.gateway_key) gatewayKey = String(body.gateway_key).toLowerCase().replace(/\s+/g, '_');
      else if (body.gateway_name) gatewayKey = String(body.gateway_name).toLowerCase().replace(/\s+/g, '_');

      const updates = {};
      if (body.gateway_name) updates[`payment_key_${gatewayKey}_name`] = body.gateway_name.trim();
      if (body.key_id) updates[`payment_key_${gatewayKey}_key_id`] = body.key_id.trim();
      if (body.key_secret !== undefined) updates[`payment_key_${gatewayKey}_key_secret`] = body.key_secret.trim();
      if (body.webhook_secret !== undefined) updates[`payment_key_${gatewayKey}_webhook_secret`] = body.webhook_secret.trim();
      if (body.merchant_id !== undefined) updates[`payment_key_${gatewayKey}_merchant_id`] = body.merchant_id.trim();
      if (body.mode) updates[`payment_key_${gatewayKey}_mode`] = (body.mode === 'Test' || body.mode === 'sandbox') ? 'Test' : 'Live';
      if (body.status !== undefined || body.is_active !== undefined) {
        const stVal = (body.status === 'active' || body.status === 1 || body.status === true || body.is_active === true || body.is_active === 1) ? 'active' : 'inactive';
        updates[`payment_key_${gatewayKey}_status`] = stVal;
      }

      for (const [key, value] of Object.entries(updates)) {
        await pool.query(
          `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
          [key, String(value)]
        );
      }

      req.params.id = gatewayKey;
      return await SettingsController.getPaymentKeyById(req, res);
    } catch (error) {
      console.error('Admin Update Payment Key Error:', error);
      return ApiResponse.error(res, 'Failed to update payment key.', 500);
    }
  }

  static async exportPaymentKeys(req, res) {
    try {
      const [rows] = await pool.query("SELECT `key`, `value` FROM settings WHERE `key` LIKE 'payment_key_%'");
      const settingsMap = {};
      rows.forEach((r) => { settingsMap[r.key] = r.value; });

      const gateways = [
        { id: 1, key: 'razorpay', defaultName: 'Razorpay', defaultKeyId: 'rzp_live_987654321092ac' },
        { id: 2, key: 'google_play', defaultName: 'Google Play', defaultKeyId: 'gpa_332198765410df' },
        { id: 3, key: 'apple_storekit', defaultName: 'Apple StoreKit', defaultKeyId: 'app_112233445566e1' },
      ];

      const maskKeyId = (id) => (id && id.length > 10 ? `${id.substring(0, 8)}••••${id.slice(-4)}` : id);

      const csvHeaders = 'ID,Gateway Name,Gateway Key,Key ID (Masked),Mode,Status\n';
      const csvRows = gateways.map((g) => {
        const name = settingsMap[`payment_key_${g.key}_name`] || g.defaultName;
        const keyId = settingsMap[`payment_key_${g.key}_key_id`] || g.defaultKeyId;
        const mode = settingsMap[`payment_key_${g.key}_mode`] || 'Live';
        const status = settingsMap[`payment_key_${g.key}_status`] || 'active';
        return `${g.id},"${name}","${g.key}","${maskKeyId(keyId)}","${mode}","${status}"`;
      }).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=payment_keys_export.csv');
      return res.status(200).send(csvHeaders + csvRows);
    } catch (error) {
      console.error('Admin Export Payment Keys Error:', error);
      return ApiResponse.error(res, 'Failed to export payment keys.', 500);
    }
  }

  // ── Maintenance Mode Settings ──────────────────────────────────────────────

  static async getMaintenanceSettings(req, res) {
    try {
      const [rows] = await pool.query('SELECT `key`, `value` FROM settings');
      const settingsMap = {};
      rows.forEach((r) => {
        settingsMap[r.key] = r.value;
      });

      const maintenanceActive = settingsMap.maintenance_mode_active === 'true' || settingsMap.maintenance_mode_active === true || settingsMap.maintenance_mode === 'true' || settingsMap.maintenance_mode === true;

      const maintenanceSettings = {
        maintenance_mode_active: maintenanceActive,
        is_active: maintenanceActive,
        maintenance_message: settingsMap.maintenance_message || "We're upgrading Roz FM for you. Back shortly!",
        scheduled_start: settingsMap.scheduled_start || '02 Aug 2026, 2:00 AM IST',
        scheduled_end: settingsMap.scheduled_end || '02 Aug 2026, 4:00 AM IST',
      };

      return ApiResponse.success(res, { maintenance_settings: maintenanceSettings }, 'Maintenance mode settings fetched successfully.');
    } catch (error) {
      console.error('Admin Get Maintenance Settings Error:', error);
      return ApiResponse.error(res, 'Failed to fetch maintenance mode settings.', 500);
    }
  }

  static async updateMaintenanceSettings(req, res) {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return ApiResponse.error(res, 'Maintenance settings object is required.', 422);
      }

      const settingsToUpdate = {};

      if (body.maintenance_mode_active !== undefined) {
        const valStr = String(Boolean(body.maintenance_mode_active));
        settingsToUpdate.maintenance_mode_active = valStr;
        settingsToUpdate.maintenance_mode = valStr;
      }
      if (body.is_active !== undefined) {
        const valStr = String(Boolean(body.is_active));
        settingsToUpdate.maintenance_mode_active = valStr;
        settingsToUpdate.maintenance_mode = valStr;
      }
      if (body.maintenance_message !== undefined) settingsToUpdate.maintenance_message = body.maintenance_message;
      if (body.scheduled_start !== undefined) settingsToUpdate.scheduled_start = body.scheduled_start;
      if (body.scheduled_end !== undefined) settingsToUpdate.scheduled_end = body.scheduled_end;

      for (const [key, value] of Object.entries(settingsToUpdate)) {
        await pool.query(
          `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
          [key, String(value)]
        );
      }

      return await SettingsController.getMaintenanceSettings(req, res);
    } catch (error) {
      console.error('Admin Update Maintenance Settings Error:', error);
      return ApiResponse.error(res, 'Failed to update maintenance mode settings.', 500);
    }
  }

  // ── Security Settings ──────────────────────────────────────────────────────

  static async getSecuritySettings(req, res) {
    try {
      const [rows] = await pool.query('SELECT `key`, `value` FROM settings');
      const settingsMap = {};
      rows.forEach((r) => {
        settingsMap[r.key] = r.value;
      });

      const securitySettings = {
        require_2fa_for_admins: settingsMap.require_2fa_for_admins === 'true' || settingsMap.require_2fa_for_admins === true,
        session_timeout: settingsMap.session_timeout || '15 minutes',
        max_login_attempts: settingsMap.max_login_attempts ? Number(settingsMap.max_login_attempts) || settingsMap.max_login_attempts : '3',
        ip_allowlist_enforced: settingsMap.ip_allowlist_enforced === 'true' || settingsMap.ip_allowlist_enforced === true,
      };

      return ApiResponse.success(res, { security_settings: securitySettings }, 'Security settings fetched successfully.');
    } catch (error) {
      console.error('Admin Get Security Settings Error:', error);
      return ApiResponse.error(res, 'Failed to fetch security settings.', 500);
    }
  }

  static async updateSecuritySettings(req, res) {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return ApiResponse.error(res, 'Security settings object is required.', 422);
      }

      const settingsToUpdate = {};

      if (body.require_2fa_for_admins !== undefined) settingsToUpdate.require_2fa_for_admins = String(Boolean(body.require_2fa_for_admins));
      if (body.session_timeout !== undefined) settingsToUpdate.session_timeout = String(body.session_timeout);
      if (body.max_login_attempts !== undefined) settingsToUpdate.max_login_attempts = String(body.max_login_attempts);
      if (body.ip_allowlist_enforced !== undefined) settingsToUpdate.ip_allowlist_enforced = String(Boolean(body.ip_allowlist_enforced));

      for (const [key, value] of Object.entries(settingsToUpdate)) {
        await pool.query(
          `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
          [key, String(value)]
        );
      }

      return await SettingsController.getSecuritySettings(req, res);
    } catch (error) {
      console.error('Admin Update Security Settings Error:', error);
      return ApiResponse.error(res, 'Failed to update security settings.', 500);
    }
  }

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

      // Invalidate push notification settings cache so changes take effect immediately
      const PushNotificationSettings = require('../../services/pushNotificationSettings');
      PushNotificationSettings.invalidateCache();

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

      const fcmData = {
        action_type: action_type || 'none',
        action_id: action_value ? String(action_value) : '',
      };

      let recipientCount = 0;
      let fcmResult = { successCount: 0, failureCount: 0 };

      if (user_id) {
        // ── Send to a single user ──────────────────────────────────────────────
        const [users] = await pool.query('SELECT id FROM users WHERE id = ? LIMIT 1', [user_id]);
        if (users.length > 0) {
          recipientCount = 1;
          // Insert DB notification
          await pool.query(
            `INSERT INTO notifications (user_id, type, title, message, icon_type, action_type, action_id, is_read, created_at)
             VALUES (?, 'system', ?, ?, 'bell', ?, ?, 0, NOW())`,
            [users[0].id, title.trim(), body.trim(), action_type || 'none', action_value || null]
          );
          // Send FCM push
          const msgId = await PushNotificationService.sendToUser(users[0].id, title.trim(), body.trim(), fcmData);
          fcmResult = { successCount: msgId ? 1 : 0, failureCount: msgId ? 0 : 1 };
        }
      } else {
        // ── Broadcast to all active users ──────────────────────────────────────
        const [users] = await pool.query('SELECT id FROM users WHERE is_blocked = 0');
        recipientCount = users.length;

        for (const u of users) {
          await pool.query(
            `INSERT INTO notifications (user_id, type, title, message, icon_type, action_type, action_id, is_read, created_at)
             VALUES (?, 'system', ?, ?, 'bell', ?, ?, 0, NOW())`,
            [u.id, title.trim(), body.trim(), action_type || 'none', action_value || null]
          );
        }

        // Send FCM pushes in batch (uses device_token from users table directly)
        fcmResult = await PushNotificationService.sendToAllUsers(title.trim(), body.trim(), fcmData);
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
            fcm: fcmResult,
          },
        },
        `Push notification sent to ${recipientCount} user(s). FCM delivered: ${fcmResult.successCount}.`
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
