const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

class AdminLocationController {
  // ── Countries CRUD ─────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/admin/countries
   */
  static async listCountries(req, res) {
    try {
      const { search, status, page = 1, limit = 20 } = req.query;
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * limitNum;

      const whereClauses = ['1=1'];
      const queryParams = [];

      if (status !== undefined && status !== '') {
        whereClauses.push('status = ?');
        queryParams.push(parseInt(status, 10));
      }

      if (search) {
        whereClauses.push('(name LIKE ? OR code LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) as count FROM countries ${whereSql}`,
        queryParams
      );

      const [rows] = await pool.query(
        `SELECT id, name, code, status, created_at, updated_at
         FROM countries
         ${whereSql}
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      const countries = rows.map((c) => ({
        id: Number(c.id),
        name: c.name,
        code: c.code,
        status: Number(c.status),
        created_at: c.created_at,
        updated_at: c.updated_at,
      }));

      return ApiResponse.success(res, {
        countries,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('Admin List Countries Error:', error);
      return ApiResponse.error(res, 'Failed to fetch countries.', 500);
    }
  }

  /**
   * POST /api/v1/admin/countries
   */
  static async storeCountry(req, res) {
    try {
      const { name, code, status = 1 } = req.body;

      if (!name || !name.trim()) {
        return ApiResponse.error(res, 'Country name is required.', 422, {
          name: ['Country name is required.'],
        });
      }

      const [result] = await pool.query(
        'INSERT INTO countries (name, code, status) VALUES (?, ?, ?)',
        [name.trim(), code ? code.trim().toUpperCase() : null, parseInt(status, 10) || 1]
      );

      const [newRow] = await pool.query(
        'SELECT id, name, code, status, created_at, updated_at FROM countries WHERE id = ?',
        [result.insertId]
      );

      return ApiResponse.success(res, { country: newRow[0] }, 'Country created successfully.', 201);
    } catch (error) {
      console.error('Admin Store Country Error:', error);
      return ApiResponse.error(res, 'Failed to create country.', 500);
    }
  }

  /**
   * PUT /api/v1/admin/countries/:id
   */
  static async updateCountry(req, res) {
    try {
      const { id } = req.params;
      const { name, code, status } = req.body;

      const [existing] = await pool.query('SELECT id FROM countries WHERE id = ?', [id]);
      if (existing.length === 0) {
        return ApiResponse.error(res, 'Country not found.', 404);
      }

      const updateFields = [];
      const updateValues = [];

      if (name !== undefined) {
        if (!name.trim()) {
          return ApiResponse.error(res, 'Country name cannot be empty.', 422);
        }
        updateFields.push('name = ?');
        updateValues.push(name.trim());
      }

      if (code !== undefined) {
        updateFields.push('code = ?');
        updateValues.push(code ? code.trim().toUpperCase() : null);
      }

      if (status !== undefined) {
        updateFields.push('status = ?');
        updateValues.push(parseInt(status, 10) || 0);
      }

      if (updateFields.length > 0) {
        updateValues.push(id);
        await pool.query(`UPDATE countries SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
      }

      const [updated] = await pool.query(
        'SELECT id, name, code, status, created_at, updated_at FROM countries WHERE id = ?',
        [id]
      );

      return ApiResponse.success(res, { country: updated[0] }, 'Country updated successfully.');
    } catch (error) {
      console.error('Admin Update Country Error:', error);
      return ApiResponse.error(res, 'Failed to update country.', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/countries/:id
   */
  static async deleteCountry(req, res) {
    try {
      const { id } = req.params;

      const [existing] = await pool.query('SELECT id FROM countries WHERE id = ?', [id]);
      if (existing.length === 0) {
        return ApiResponse.error(res, 'Country not found.', 404);
      }

      await pool.query('DELETE FROM countries WHERE id = ?', [id]);
      return ApiResponse.success(res, null, 'Country deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Country Error:', error);
      return ApiResponse.error(res, 'Failed to delete country.', 500);
    }
  }

  // ── States CRUD ────────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/admin/states
   */
  static async listStates(req, res) {
    try {
      const { country_id, countryId, search, status, page = 1, limit = 20 } = req.query;
      const targetCountryId = country_id || countryId;
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * limitNum;

      const whereClauses = ['1=1'];
      const queryParams = [];

      if (targetCountryId) {
        whereClauses.push('s.country_id = ?');
        queryParams.push(parseInt(targetCountryId, 10));
      }

      if (status !== undefined && status !== '') {
        whereClauses.push('s.status = ?');
        queryParams.push(parseInt(status, 10));
      }

      if (search) {
        whereClauses.push('s.name LIKE ?');
        queryParams.push(`%${search}%`);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) as count FROM states s ${whereSql}`,
        queryParams
      );

      const [rows] = await pool.query(
        `SELECT s.id, s.name, s.country_id, co.name AS country_name, s.status, s.created_at, s.updated_at
         FROM states s
         LEFT JOIN countries co ON s.country_id = co.id
         ${whereSql}
         ORDER BY s.id DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      const states = rows.map((s) => ({
        id: Number(s.id),
        name: s.name,
        country_id: Number(s.country_id),
        country_name: s.country_name || null,
        status: Number(s.status),
        created_at: s.created_at,
        updated_at: s.updated_at,
      }));

      return ApiResponse.success(res, {
        states,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('Admin List States Error:', error);
      return ApiResponse.error(res, 'Failed to fetch states.', 500);
    }
  }

  /**
   * POST /api/v1/admin/states
   */
  static async storeState(req, res) {
    try {
      const { country_id, countryId, name, status = 1 } = req.body;
      const targetCountryId = country_id || countryId;

      if (!targetCountryId) {
        return ApiResponse.error(res, 'country_id is required.', 422, {
          country_id: ['country_id is required.'],
        });
      }

      if (!name || !name.trim()) {
        return ApiResponse.error(res, 'State name is required.', 422, {
          name: ['State name is required.'],
        });
      }

      // Check country existence
      const [cExists] = await pool.query('SELECT id FROM countries WHERE id = ?', [targetCountryId]);
      if (cExists.length === 0) {
        return ApiResponse.error(res, 'Invalid country_id provided.', 422);
      }

      const [result] = await pool.query(
        'INSERT INTO states (country_id, name, status) VALUES (?, ?, ?)',
        [parseInt(targetCountryId, 10), name.trim(), parseInt(status, 10) || 1]
      );

      const [newRow] = await pool.query(
        `SELECT s.id, s.name, s.country_id, co.name AS country_name, s.status, s.created_at, s.updated_at
         FROM states s LEFT JOIN countries co ON s.country_id = co.id WHERE s.id = ?`,
        [result.insertId]
      );

      return ApiResponse.success(res, { state: newRow[0] }, 'State created successfully.', 201);
    } catch (error) {
      console.error('Admin Store State Error:', error);
      return ApiResponse.error(res, 'Failed to create state.', 500);
    }
  }

  /**
   * PUT /api/v1/admin/states/:id
   */
  static async updateState(req, res) {
    try {
      const { id } = req.params;
      const { country_id, countryId, name, status } = req.body;
      const targetCountryId = country_id || countryId;

      const [existing] = await pool.query('SELECT id FROM states WHERE id = ?', [id]);
      if (existing.length === 0) {
        return ApiResponse.error(res, 'State not found.', 404);
      }

      const updateFields = [];
      const updateValues = [];

      if (targetCountryId !== undefined) {
        const [cExists] = await pool.query('SELECT id FROM countries WHERE id = ?', [targetCountryId]);
        if (cExists.length === 0) {
          return ApiResponse.error(res, 'Invalid country_id provided.', 422);
        }
        updateFields.push('country_id = ?');
        updateValues.push(parseInt(targetCountryId, 10));
      }

      if (name !== undefined) {
        if (!name.trim()) {
          return ApiResponse.error(res, 'State name cannot be empty.', 422);
        }
        updateFields.push('name = ?');
        updateValues.push(name.trim());
      }

      if (status !== undefined) {
        updateFields.push('status = ?');
        updateValues.push(parseInt(status, 10) || 0);
      }

      if (updateFields.length > 0) {
        updateValues.push(id);
        await pool.query(`UPDATE states SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
      }

      const [updated] = await pool.query(
        `SELECT s.id, s.name, s.country_id, co.name AS country_name, s.status, s.created_at, s.updated_at
         FROM states s LEFT JOIN countries co ON s.country_id = co.id WHERE s.id = ?`,
        [id]
      );

      return ApiResponse.success(res, { state: updated[0] }, 'State updated successfully.');
    } catch (error) {
      console.error('Admin Update State Error:', error);
      return ApiResponse.error(res, 'Failed to update state.', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/states/:id
   */
  static async deleteState(req, res) {
    try {
      const { id } = req.params;

      const [existing] = await pool.query('SELECT id FROM states WHERE id = ?', [id]);
      if (existing.length === 0) {
        return ApiResponse.error(res, 'State not found.', 404);
      }

      await pool.query('DELETE FROM states WHERE id = ?', [id]);
      return ApiResponse.success(res, null, 'State deleted successfully.');
    } catch (error) {
      console.error('Admin Delete State Error:', error);
      return ApiResponse.error(res, 'Failed to delete state.', 500);
    }
  }

  // ── Cities CRUD ────────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/admin/cities
   */
  static async listCities(req, res) {
    try {
      const { state_id, stateId, country_id, countryId, search, status, page = 1, limit = 20 } = req.query;
      const targetStateId = state_id || stateId;
      const targetCountryId = country_id || countryId;
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * limitNum;

      const whereClauses = ['1=1'];
      const queryParams = [];

      if (targetStateId) {
        whereClauses.push('ci.state_id = ?');
        queryParams.push(parseInt(targetStateId, 10));
      }

      if (targetCountryId) {
        whereClauses.push('s.country_id = ?');
        queryParams.push(parseInt(targetCountryId, 10));
      }

      if (status !== undefined && status !== '') {
        whereClauses.push('ci.status = ?');
        queryParams.push(parseInt(status, 10));
      }

      if (search) {
        whereClauses.push('ci.name LIKE ?');
        queryParams.push(`%${search}%`);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) as count FROM cities ci LEFT JOIN states s ON ci.state_id = s.id ${whereSql}`,
        queryParams
      );

      const [rows] = await pool.query(
        `SELECT ci.id, ci.name, ci.state_id, s.name AS state_name, s.country_id, co.name AS country_name, ci.status, ci.created_at, ci.updated_at
         FROM cities ci
         LEFT JOIN states s ON ci.state_id = s.id
         LEFT JOIN countries co ON s.country_id = co.id
         ${whereSql}
         ORDER BY ci.id DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      const cities = rows.map((ci) => ({
        id: Number(ci.id),
        name: ci.name,
        state_id: Number(ci.state_id),
        state_name: ci.state_name || null,
        country_id: ci.country_id ? Number(ci.country_id) : null,
        country_name: ci.country_name || null,
        status: Number(ci.status),
        created_at: ci.created_at,
        updated_at: ci.updated_at,
      }));

      return ApiResponse.success(res, {
        cities,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('Admin List Cities Error:', error);
      return ApiResponse.error(res, 'Failed to fetch cities.', 500);
    }
  }

  /**
   * POST /api/v1/admin/cities
   */
  static async storeCity(req, res) {
    try {
      const { state_id, stateId, name, status = 1 } = req.body;
      const targetStateId = state_id || stateId;

      if (!targetStateId) {
        return ApiResponse.error(res, 'state_id is required.', 422, {
          state_id: ['state_id is required.'],
        });
      }

      if (!name || !name.trim()) {
        return ApiResponse.error(res, 'City name is required.', 422, {
          name: ['City name is required.'],
        });
      }

      // Check state existence
      const [sExists] = await pool.query('SELECT id FROM states WHERE id = ?', [targetStateId]);
      if (sExists.length === 0) {
        return ApiResponse.error(res, 'Invalid state_id provided.', 422);
      }

      const [result] = await pool.query(
        'INSERT INTO cities (state_id, name, status) VALUES (?, ?, ?)',
        [parseInt(targetStateId, 10), name.trim(), parseInt(status, 10) || 1]
      );

      const [newRow] = await pool.query(
        `SELECT ci.id, ci.name, ci.state_id, s.name AS state_name, s.country_id, co.name AS country_name, ci.status, ci.created_at, ci.updated_at
         FROM cities ci
         LEFT JOIN states s ON ci.state_id = s.id
         LEFT JOIN countries co ON s.country_id = co.id
         WHERE ci.id = ?`,
        [result.insertId]
      );

      return ApiResponse.success(res, { city: newRow[0] }, 'City created successfully.', 201);
    } catch (error) {
      console.error('Admin Store City Error:', error);
      return ApiResponse.error(res, 'Failed to create city.', 500);
    }
  }

  /**
   * PUT /api/v1/admin/cities/:id
   */
  static async updateCity(req, res) {
    try {
      const { id } = req.params;
      const { state_id, stateId, name, status } = req.body;
      const targetStateId = state_id || stateId;

      const [existing] = await pool.query('SELECT id FROM cities WHERE id = ?', [id]);
      if (existing.length === 0) {
        return ApiResponse.error(res, 'City not found.', 404);
      }

      const updateFields = [];
      const updateValues = [];

      if (targetStateId !== undefined) {
        const [sExists] = await pool.query('SELECT id FROM states WHERE id = ?', [targetStateId]);
        if (sExists.length === 0) {
          return ApiResponse.error(res, 'Invalid state_id provided.', 422);
        }
        updateFields.push('state_id = ?');
        updateValues.push(parseInt(targetStateId, 10));
      }

      if (name !== undefined) {
        if (!name.trim()) {
          return ApiResponse.error(res, 'City name cannot be empty.', 422);
        }
        updateFields.push('name = ?');
        updateValues.push(name.trim());
      }

      if (status !== undefined) {
        updateFields.push('status = ?');
        updateValues.push(parseInt(status, 10) || 0);
      }

      if (updateFields.length > 0) {
        updateValues.push(id);
        await pool.query(`UPDATE cities SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
      }

      const [updated] = await pool.query(
        `SELECT ci.id, ci.name, ci.state_id, s.name AS state_name, s.country_id, co.name AS country_name, ci.status, ci.created_at, ci.updated_at
         FROM cities ci
         LEFT JOIN states s ON ci.state_id = s.id
         LEFT JOIN countries co ON s.country_id = co.id
         WHERE ci.id = ?`,
        [id]
      );

      return ApiResponse.success(res, { city: updated[0] }, 'City updated successfully.');
    } catch (error) {
      console.error('Admin Update City Error:', error);
      return ApiResponse.error(res, 'Failed to update city.', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/cities/:id
   */
  static async deleteCity(req, res) {
    try {
      const { id } = req.params;

      const [existing] = await pool.query('SELECT id FROM cities WHERE id = ?', [id]);
      if (existing.length === 0) {
        return ApiResponse.error(res, 'City not found.', 404);
      }

      await pool.query('DELETE FROM cities WHERE id = ?', [id]);
      return ApiResponse.success(res, null, 'City deleted successfully.');
    } catch (error) {
      console.error('Admin Delete City Error:', error);
      return ApiResponse.error(res, 'Failed to delete city.', 500);
    }
  }
}

module.exports = AdminLocationController;
