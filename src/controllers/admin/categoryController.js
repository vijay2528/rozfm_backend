const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');
const { resolveUrl } = require('../../utils/storyPresenter');
const { uploadToR2 } = require('../../services/r2StorageService');

class CategoryController {
  /**
   * GET /api/v1/admin/categories
   * List all categories with total stories count
   */
  static async index(req, res) {
    try {
      const [categories] = await pool.query(
        `SELECT c.*, COUNT(s.id) as stories_count
         FROM categories c
         LEFT JOIN stories s ON s.category_id = c.id
         GROUP BY c.id
         ORDER BY c.category_name ASC`
      );

      const result = categories.map((cat) => ({
        id: Number(cat.id),
        category_name: cat.category_name,
        category_image: resolveUrl(cat.category_image_path),
        stories_count: Number(cat.stories_count || 0),
        created_at: cat.created_at,
      }));

      return ApiResponse.success(res, { categories: result });
    } catch (error) {
      console.error('Admin List Categories Error:', error);
      return ApiResponse.error(res, 'Failed to fetch categories.', 500);
    }
  }

  /**
   * POST /api/v1/admin/categories
   * Create a new category
   */
  static async store(req, res) {
    try {
      const { category_name } = req.body;

      if (!category_name || category_name.trim() === '') {
        return ApiResponse.error(res, 'Category name is required.', 422);
      }

      let imagePath = req.body.category_image || req.body.image || null;
      if (req.file) {
        imagePath = await uploadToR2(req.file, 'categories');
      }

      const [result] = await pool.query(
        'INSERT INTO categories (category_name, category_image_path) VALUES (?, ?)',
        [category_name.trim(), imagePath]
      );

      const [newCat] = await pool.query('SELECT * FROM categories WHERE id = ? LIMIT 1', [result.insertId]);

      return ApiResponse.success(
        res,
        {
          category: {
            id: Number(newCat[0].id),
            category_name: newCat[0].category_name,
            category_image: resolveUrl(newCat[0].category_image_path),
            created_at: newCat[0].created_at,
          },
        },
        'Category created successfully.',
        201
      );
    } catch (error) {
      console.error('Admin Create Category Error:', error);
      return ApiResponse.error(res, 'Failed to create category.', 500);
    }
  }

  /**
   * PUT / POST /api/v1/admin/categories/:id
   * Update existing category
   */
  static async update(req, res) {
    try {
      const catId = req.params.id;
      const { category_name } = req.body;

      const [catRows] = await pool.query('SELECT * FROM categories WHERE id = ? LIMIT 1', [catId]);
      if (catRows.length === 0) {
        return ApiResponse.error(res, 'Category not found.', 444);
      }

      let imagePath = null;
      if (req.file) {
        imagePath = await uploadToR2(req.file, 'categories');
      } else if (req.body.category_image || req.body.image) {
        imagePath = req.body.category_image || req.body.image;
      }

      const updateFields = [];
      const queryParams = [];

      if (category_name && category_name.trim() !== '') {
        updateFields.push('`category_name` = ?');
        queryParams.push(category_name.trim());
      }

      if (imagePath) {
        updateFields.push('`category_image_path` = ?');
        queryParams.push(imagePath);
      }

      if (updateFields.length > 0) {
        queryParams.push(catId);
        await pool.query(`UPDATE categories SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`, queryParams);
      }

      const [updated] = await pool.query('SELECT * FROM categories WHERE id = ? LIMIT 1', [catId]);

      return ApiResponse.success(
        res,
        {
          category: {
            id: Number(updated[0].id),
            category_name: updated[0].category_name,
            category_image: resolveUrl(updated[0].category_image_path),
            updated_at: updated[0].updated_at,
          },
        },
        'Category updated successfully.'
      );
    } catch (error) {
      console.error('Admin Update Category Error:', error);
      return ApiResponse.error(res, 'Failed to update category.', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/categories/:id
   * Delete a category
   */
  static async destroy(req, res) {
    try {
      const catId = req.params.id;

      const [catRows] = await pool.query('SELECT * FROM categories WHERE id = ? LIMIT 1', [catId]);
      if (catRows.length === 0) {
        return ApiResponse.error(res, 'Category not found.', 444);
      }

      await pool.query('DELETE FROM categories WHERE id = ?', [catId]);

      return ApiResponse.success(res, { category_id: Number(catId) }, 'Category deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Category Error:', error);
      return ApiResponse.error(res, 'Failed to delete category.', 500);
    }
  }
}

module.exports = CategoryController;
