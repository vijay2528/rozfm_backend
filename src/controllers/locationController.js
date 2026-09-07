const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

class LocationController {
  /**
   * GET /api/v1/countries
   * Get list of countries (Supports search query)
   */
  static async getCountries(req, res) {
    try {
      const { search, status = 1 } = req.query;
      const whereClauses = [];
      const queryParams = [];

      if (status !== 'all') {
        whereClauses.push('status = ?');
        queryParams.push(parseInt(status, 10) || 1);
      }

      if (search) {
        whereClauses.push('(name LIKE ? OR code LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const [rows] = await pool.query(
        `SELECT id, name, code, status, created_at, updated_at FROM countries ${whereSql} ORDER BY name ASC`,
        queryParams
      );

      const countries = rows.map((c) => ({
        id: Number(c.id),
        name: c.name,
        code: c.code,
        status: Number(c.status),
        created_at: c.created_at,
        updated_at: c.updated_at,
      }));

      return ApiResponse.success(res, { countries });
    } catch (error) {
      console.error('Get Countries Error:', error);
      return ApiResponse.error(res, 'Failed to fetch countries.', 500);
    }
  }

  /**
   * GET /api/v1/countries/:id
   * Get country by ID
   */
  static async getCountryById(req, res) {
    try {
      const { id } = req.params;
      const [rows] = await pool.query(
        'SELECT id, name, code, status, created_at, updated_at FROM countries WHERE id = ?',
        [id]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Country not found.', 404);
      }

      const country = {
        id: Number(rows[0].id),
        name: rows[0].name,
        code: rows[0].code,
        status: Number(rows[0].status),
        created_at: rows[0].created_at,
        updated_at: rows[0].updated_at,
      };

      return ApiResponse.success(res, { country });
    } catch (error) {
      console.error('Get Country By ID Error:', error);
      return ApiResponse.error(res, 'Failed to fetch country.', 500);
    }
  }

  /**
   * GET /api/v1/states
   * GET /api/v1/countries/:countryId/states
   * Get list of states (Filter by country_id / countryId, search)
   */
  static async getStates(req, res) {
    try {
      const countryId = req.params.countryId || req.query.country_id || req.query.countryId;
      const { search, status = 1 } = req.query;

      const whereClauses = [];
      const queryParams = [];

      if (status !== 'all') {
        whereClauses.push('s.status = ?');
        queryParams.push(parseInt(status, 10) || 1);
      }

      if (countryId) {
        whereClauses.push('s.country_id = ?');
        queryParams.push(parseInt(countryId, 10));
      }

      if (search) {
        whereClauses.push('s.name LIKE ?');
        queryParams.push(`%${search}%`);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const [rows] = await pool.query(
        `SELECT s.id, s.name, s.country_id, co.name AS country_name, co.code AS country_code, s.status, s.created_at, s.updated_at
         FROM states s
         LEFT JOIN countries co ON s.country_id = co.id
         ${whereSql}
         ORDER BY s.name ASC`,
        queryParams
      );

      const states = rows.map((s) => ({
        id: Number(s.id),
        name: s.name,
        country_id: Number(s.country_id),
        country_name: s.country_name || null,
        country_code: s.country_code || null,
        status: Number(s.status),
        created_at: s.created_at,
        updated_at: s.updated_at,
      }));

      return ApiResponse.success(res, { states });
    } catch (error) {
      console.error('Get States Error:', error);
      return ApiResponse.error(res, 'Failed to fetch states.', 500);
    }
  }

  /**
   * GET /api/v1/states/:id
   * Get state by ID
   */
  static async getStateById(req, res) {
    try {
      const { id } = req.params;
      const [rows] = await pool.query(
        `SELECT s.id, s.name, s.country_id, co.name AS country_name, co.code AS country_code, s.status, s.created_at, s.updated_at
         FROM states s
         LEFT JOIN countries co ON s.country_id = co.id
         WHERE s.id = ?`,
        [id]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'State not found.', 404);
      }

      const state = {
        id: Number(rows[0].id),
        name: rows[0].name,
        country_id: Number(rows[0].country_id),
        country_name: rows[0].country_name || null,
        country_code: rows[0].country_code || null,
        status: Number(rows[0].status),
        created_at: rows[0].created_at,
        updated_at: rows[0].updated_at,
      };

      return ApiResponse.success(res, { state });
    } catch (error) {
      console.error('Get State By ID Error:', error);
      return ApiResponse.error(res, 'Failed to fetch state.', 500);
    }
  }

  /**
   * GET /api/v1/cities
   * GET /api/v1/states/:stateId/cities
   * GET /api/v1/countries/:countryId/cities
   * Get list of cities (Filter by state_id / stateId, country_id / countryId, search)
   */
  static async getCities(req, res) {
    try {
      const stateId = req.params.stateId || req.query.state_id || req.query.stateId;
      const countryId = req.params.countryId || req.query.country_id || req.query.countryId;
      const { search, status = 1 } = req.query;

      const whereClauses = [];
      const queryParams = [];

      if (status !== 'all') {
        whereClauses.push('ci.status = ?');
        queryParams.push(parseInt(status, 10) || 1);
      }

      if (stateId) {
        whereClauses.push('ci.state_id = ?');
        queryParams.push(parseInt(stateId, 10));
      }

      if (countryId) {
        whereClauses.push('s.country_id = ?');
        queryParams.push(parseInt(countryId, 10));
      }

      if (search) {
        whereClauses.push('ci.name LIKE ?');
        queryParams.push(`%${search}%`);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const [rows] = await pool.query(
        `SELECT ci.id, ci.name, ci.state_id, s.name AS state_name, s.country_id, co.name AS country_name, ci.status, ci.created_at, ci.updated_at
         FROM cities ci
         LEFT JOIN states s ON ci.state_id = s.id
         LEFT JOIN countries co ON s.country_id = co.id
         ${whereSql}
         ORDER BY ci.name ASC`,
        queryParams
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

      return ApiResponse.success(res, { cities });
    } catch (error) {
      console.error('Get Cities Error:', error);
      return ApiResponse.error(res, 'Failed to fetch cities.', 500);
    }
  }

  /**
   * GET /api/v1/cities/:id
   * Get city by ID
   */
  static async getCityById(req, res) {
    try {
      const { id } = req.params;
      const [rows] = await pool.query(
        `SELECT ci.id, ci.name, ci.state_id, s.name AS state_name, s.country_id, co.name AS country_name, ci.status, ci.created_at, ci.updated_at
         FROM cities ci
         LEFT JOIN states s ON ci.state_id = s.id
         LEFT JOIN countries co ON s.country_id = co.id
         WHERE ci.id = ?`,
        [id]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'City not found.', 404);
      }

      const city = {
        id: Number(rows[0].id),
        name: rows[0].name,
        state_id: Number(rows[0].state_id),
        state_name: rows[0].state_name || null,
        country_id: rows[0].country_id ? Number(rows[0].country_id) : null,
        country_name: rows[0].country_name || null,
        status: Number(rows[0].status),
        created_at: rows[0].created_at,
        updated_at: rows[0].updated_at,
      };

      return ApiResponse.success(res, { city });
    } catch (error) {
      console.error('Get City By ID Error:', error);
      return ApiResponse.error(res, 'Failed to fetch city.', 500);
    }
  }
}

module.exports = LocationController;
