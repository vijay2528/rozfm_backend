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

      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const host = req.get('host') || 'api.rozfm.com';
      const baseUrl = `${protocol}://${host}`;

      return ApiResponse.success(res, {
        app_name: settingsMap.app_name || 'ROZ FM',
        app_version: settingsMap.app_version || '1.0.0',
        maintenance_mode: settingsMap.maintenance_mode === 'true' || false,
        coin_conversion_rate: Number(settingsMap.coin_conversion_rate || 10),
        currency_symbol: settingsMap.currency_symbol || '₹',
        support_email: settingsMap.support_email || 'support@rozfm.com',
        privacy_policy_url: settingsMap.privacy_policy_url || `${baseUrl}/privacy-policy`,
        refund_policy_url: settingsMap.refund_policy_url || `${baseUrl}/refund-policy`,
        terms_and_condition_url: settingsMap.terms_and_condition_url || `${baseUrl}/terms-and-condition`,
        terms_and_conditions_url: settingsMap.terms_and_conditions_url || `${baseUrl}/terms-and-condition`,
        copy_right_policy: settingsMap.copy_right_policy || `${baseUrl}/copy-right-policy`,
        copy_right_policy_url: settingsMap.copy_right_policy_url || `${baseUrl}/copy-right-policy`,
      });
    } catch (error) {
      console.error('Config Error:', error);
      return ApiResponse.error(res, 'Failed to fetch configuration.', 500);
    }
  }

  static async policies(req, res) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.get('host') || 'api.rozfm.com';
    const baseUrl = `${protocol}://${host}`;

    return ApiResponse.success(res, {
      privacy_policy_url: `${baseUrl}/privacy-policy`,
      refund_policy_url: `${baseUrl}/refund-policy`,
      terms_and_condition_url: `${baseUrl}/terms-and-condition`,
      copy_right_policy: `${baseUrl}/copy-right-policy`,
      copy_right_policy_url: `${baseUrl}/copy-right-policy`,
    });
  }

  static async languages(req, res) {
    try {
      const [rows] = await pool.query('SELECT id, name, code, created_at, updated_at FROM languages ORDER BY id ASC');
      let languages = rows.map((l) => ({
        id: Number(l.id),
        name: l.name,
        code: l.code,
        created_at: l.created_at,
        updated_at: l.updated_at,
      }));

      if (languages.length === 0) {
        languages = [
          { id: 1, name: 'Hindi', code: 'hi' },
          { id: 2, name: 'English', code: 'en' },
          { id: 3, name: 'Tamil', code: 'ta' },
          { id: 4, name: 'Telugu', code: 'te' },
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

  static async coinFaqs(req, res) {
    try {
      let dbRows = [];
      try {
        const [rows] = await pool.query(
          'SELECT * FROM coin_faqs WHERE status = 1 ORDER BY position ASC, id ASC'
        );
        dbRows = rows;
      } catch (err) {
        // Fallback if table query fails
      }

      let coinFaqs = [];

      if (dbRows && dbRows.length > 0) {
        coinFaqs = dbRows.map((r) => ({
          id: Number(r.id),
          icon: r.icon || 'wallet',
          title: r.title,
          description: r.description,
        }));
      }

      // Fallback defaults if DB returns empty
      if (coinFaqs.length === 0) {
        coinFaqs = [
          {
            id: 1,
            icon: 'wallet',
            title: 'Earn Coins',
            description: 'Watch short reward ads, complete daily listening goals & maintain your streak to earn free coins.',
          },
          {
            id: 2,
            icon: 'shopping_bag',
            title: 'Buy Coin Packs',
            description: 'Purchase coin packs directly from My Store to get bonus coins instantly.',
          },
          {
            id: 3,
            icon: 'lock',
            title: 'Unlock Episodes',
            description: 'Use your earned or purchased coins to unlock exclusive premium audio episodes.',
          },
        ];
      }

      return ApiResponse.success(
        res,
        {
          coin_faqs: coinFaqs,
        },
        'Coin FAQs fetched successfully.'
      );
    } catch (error) {
      console.error('Coin FAQs Error:', error);
      return ApiResponse.error(res, 'Failed to fetch coin FAQs.', 500);
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
