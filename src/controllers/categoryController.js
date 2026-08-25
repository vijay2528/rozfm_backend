const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';
const MIN_SELECTION = 3;

/**
 * Format category object for API response
 */
function formatCategory(category, isSelected = false) {
  let imageUrl = null;
  if (category.category_image_path) {
    if (category.category_image_path.startsWith('http://') || category.category_image_path.startsWith('https://')) {
      imageUrl = category.category_image_path;
    } else {
      imageUrl = `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${category.category_image_path.replace(/^\//, '')}`;
    }
  }

  return {
    id: Number(category.id),
    category_name: category.category_name,
    category_image: imageUrl,
    is_selected: Boolean(isSelected),
  };
}

class CategoryController {
  /**
   * Internal helper to fetch user category preferences data
   */
  static async listForUser(userId) {
    const [userCatRows] = await pool.query(
      'SELECT category_id FROM user_categories WHERE user_id = ?',
      [userId]
    );
    const selectedIds = userCatRows.map((row) => Number(row.category_id));

    const [categoryRows] = await pool.query(
      'SELECT * FROM categories ORDER BY category_name ASC'
    );

    const categories = categoryRows.map((cat) =>
      formatCategory(cat, selectedIds.includes(Number(cat.id)))
    );

    return {
      categories,
      selected_category_ids: selectedIds,
      selected_count: selectedIds.length,
      min_required: MIN_SELECTION,
    };
  }

  /**
   * GET /api/v1/categories
   * Public list of categories
   */
  static async index(req, res) {
    try {
      const [categoryRows] = await pool.query(
        'SELECT * FROM categories ORDER BY category_name ASC'
      );
      const categories = categoryRows.map((cat) => formatCategory(cat, false));

      return ApiResponse.success(res, { categories });
    } catch (error) {
      console.error('List Categories Error:', error);
      return ApiResponse.error(res, 'Failed to fetch categories.', 500);
    }
  }

  /**
   * GET /api/v1/user/categories
   * User preferred categories
   */
  static async userPreferences(req, res) {
    try {
      const userId = req.user.id;
      const data = await CategoryController.listForUser(userId);
      return ApiResponse.success(res, data);
    } catch (error) {
      console.error('Get User Preferences Error:', error);
      return ApiResponse.error(res, 'Failed to fetch user categories.', 500);
    }
  }

  /**
   * POST / PUT /api/v1/user/categories
   * Update user preferred categories
   */
  static async updateUserPreferences(req, res) {
    try {
      const userId = req.user.id;
      let rawCategoryIds = req.body.category_ids;

      if (typeof rawCategoryIds === 'string') {
        try {
          rawCategoryIds = JSON.parse(rawCategoryIds);
        } catch (_) {
          // If comma-separated or single string
          if (rawCategoryIds.includes(',')) {
            rawCategoryIds = rawCategoryIds.split(',');
          } else {
            rawCategoryIds = [rawCategoryIds];
          }
        }
      }

      if (!Array.isArray(rawCategoryIds)) {
        return ApiResponse.error(res, 'Select at least 3 categories you like.', 422, {
          category_ids: ['Select at least 3 categories you like.'],
        });
      }

      const categoryIds = [
        ...new Set(
          rawCategoryIds
            .map((id) => parseInt(id, 10))
            .filter((id) => !isNaN(id) && id > 0)
        ),
      ];

      if (categoryIds.length < MIN_SELECTION) {
        return ApiResponse.error(res, `Select at least ${MIN_SELECTION} categories you like.`, 422, {
          category_ids: [`Select at least ${MIN_SELECTION} categories you like.`],
        });
      }

      // Check if all provided category IDs exist in DB
      const [existingRows] = await pool.query(
        'SELECT id FROM categories WHERE id IN (?)',
        [categoryIds]
      );

      if (existingRows.length !== categoryIds.length) {
        return ApiResponse.error(res, 'One or more selected categories are invalid.', 422, {
          category_ids: ['One or more selected categories are invalid.'],
        });
      }

      // Sync preferences in transaction
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.query('DELETE FROM user_categories WHERE user_id = ?', [userId]);

        const insertValues = categoryIds.map((catId) => [userId, catId]);
        await connection.query(
          'INSERT INTO user_categories (user_id, category_id) VALUES ?',
          [insertValues]
        );

        await connection.commit();
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }

      const data = await CategoryController.listForUser(userId);
      return ApiResponse.success(res, data, 'Category preferences updated.');
    } catch (error) {
      console.error('Update User Preferences Error:', error);
      return ApiResponse.error(res, 'Failed to update category preferences.', 500);
    }
  }
}

module.exports = CategoryController;
