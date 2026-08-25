const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

class ConfigController {
  static async show(req, res) {
    try {
      const [settingsRows] = await pool.query('SELECT `key`, `value` FROM settings');
      const settingsMap = {};
      settingsRows.forEach((row) => {
        settingsMap[row.key] = row.value;
      });

      return ApiResponse.success(res, {
        app_name: settingsMap.app_name || 'ROZ FM',
        app_version: settingsMap.app_version || '1.0.0',
        maintenance_mode: settingsMap.maintenance_mode === 'true' || false,
        coin_conversion_rate: Number(settingsMap.coin_conversion_rate || 10),
        currency_symbol: settingsMap.currency_symbol || '₹',
        support_email: settingsMap.support_email || 'support@rozfm.com',
      });
    } catch (error) {
      console.error('Config Error:', error);
      return ApiResponse.error(res, 'Failed to fetch configuration.', 500);
    }
  }

  static async languages(req, res) {
    try {
      const [rows] = await pool.query('SELECT * FROM languages ORDER BY name ASC');
      let languages = rows.map((l) => ({
        id: Number(l.id),
        name: l.name,
        code: l.code,
        is_default: Boolean(l.is_default),
      }));

      if (languages.length === 0) {
        languages = [
          { id: 1, name: 'Hindi', code: 'hi', is_default: true },
          { id: 2, name: 'English', code: 'en', is_default: false },
          { id: 3, name: 'Tamil', code: 'ta', is_default: false },
          { id: 4, name: 'Telugu', code: 'te', is_default: false },
        ];
      }

      return ApiResponse.success(res, { languages });
    } catch (error) {
      console.error('Languages Error:', error);
      return ApiResponse.error(res, 'Failed to fetch languages.', 500);
    }
  }

  static async faqs(req, res) {
    try {
      const [rows] = await pool.query('SELECT * FROM faqs WHERE status = 1 ORDER BY position ASC');
      return ApiResponse.success(res, { faqs: rows });
    } catch (error) {
      console.error('Faqs Error:', error);
      return ApiResponse.error(res, 'Failed to fetch FAQs.', 500);
    }
  }

  static async supportFaqs(req, res) {
    try {
      const [menus] = await pool.query('SELECT * FROM support_faq_menus ORDER BY position ASC');
      const [questions] = await pool.query('SELECT * FROM support_faq_questions ORDER BY position ASC');

      const result = menus.map((menu) => ({
        id: Number(menu.id),
        title: menu.title,
        questions: questions
          .filter((q) => q.menu_id === menu.id)
          .map((q) => ({
            id: Number(q.id),
            question: q.question,
            answer: q.answer,
          })),
      }));

      return ApiResponse.success(res, { menus: result });
    } catch (error) {
      console.error('Support Faqs Error:', error);
      return ApiResponse.error(res, 'Failed to fetch support FAQs.', 500);
    }
  }

  static async legalCopyright(req, res) {
    return ApiResponse.success(res, {
      title: 'Copyright Policy',
      content: 'All audio content, stories, logos, and graphics published on ROZ FM are protected by copyright laws.',
    });
  }

  static async legalPrivacy(req, res) {
    return ApiResponse.success(res, {
      title: 'Privacy Policy',
      content: 'ROZ FM is committed to safeguarding user personal information and privacy.',
    });
  }

  static async legalTerms(req, res) {
    return ApiResponse.success(res, {
      title: 'Terms of Service',
      content: 'By accessing or using ROZ FM, you agree to comply with our user agreement and guidelines.',
    });
  }

  static async legalSecurityAdvice(req, res) {
    return ApiResponse.success(res, {
      title: 'Security Advice',
      content: 'Never share your account OTP or password with anyone. ROZ FM staff will never ask for your credentials.',
    });
  }
}

module.exports = ConfigController;
