const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

function formatNumber(num) {
  const n = Number(num) || 0;
  if (n >= 1000000) {
    return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (n >= 1000) {
    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return n.toString();
}

class AudienceController {
  /**
   * GET /api/v1/user/audience-stats
   * Single Audience Statistics API for creator audience analytics
   */
  static async getAudienceStats(req, res) {
    try {
      const targetUserId = req.query.user_id || req.query.id || (req.user ? req.user.id : null);

      if (!targetUserId) {
        return ApiResponse.error(res, 'User ID is required.', 400);
      }

      // 1. Total Followers
      const [[{ totalFollowers }]] = await pool.query(
        'SELECT COUNT(*) AS totalFollowers FROM user_follows WHERE following_id = ?',
        [targetUserId]
      );

      // 2. Followers gained today
      const [[{ todayFollowers }]] = await pool.query(
        'SELECT COUNT(*) AS todayFollowers FROM user_follows WHERE following_id = ? AND DATE(created_at) = CURDATE()',
        [targetUserId]
      );

      // 3. New Followers in last 30 days
      const [[{ newFollowersCount }]] = await pool.query(
        'SELECT COUNT(*) AS newFollowersCount FROM user_follows WHERE following_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)',
        [targetUserId]
      );

      // Total count numbers & formatted strings
      const totalCount = Number(totalFollowers || 0);
      const todayGrowthCount = Number(todayFollowers || 0);
      const newCount = Number(newFollowersCount || 0);

      // Growth percentage for new followers in last 30 days
      let newGrowthPct = 0;
      if (totalCount > 0 && newCount > 0) {
        const previousTotal = totalCount - newCount;
        if (previousTotal > 0) {
          newGrowthPct = parseFloat(((newCount / previousTotal) * 100).toFixed(1));
        } else {
          newGrowthPct = 100;
        }
      }

      // 4. Query Top Cities from actual follower profile data
      const [cityRows] = await pool.query(
        `SELECT 
          COALESCE(NULLIF(TRIM(u.city), ''), '') AS city,
          COUNT(*) AS count
         FROM user_follows uf
         JOIN users u ON uf.follower_id = u.id
         WHERE uf.following_id = ? AND u.city IS NOT NULL AND u.city != ''
         GROUP BY u.city
         ORDER BY count DESC
         LIMIT 5`,
        [targetUserId]
      );

      let topCities = [];
      if (cityRows.length > 0) {
        const cityTotal = cityRows.reduce((sum, r) => sum + Number(r.count), 0);
        topCities = cityRows.map((r) => {
          const cCount = Number(r.count);
          const pct = parseFloat(((cCount / (cityTotal || 1)) * 100).toFixed(1));
          return {
            city: r.city,
            percentage: pct,
            percentage_text: `${pct}%`,
            count: cCount,
          };
        });
      }

      // 5. Query Age Groups from actual follower profile data
      const [ageRows] = await pool.query(
        `SELECT 
          COALESCE(NULLIF(TRIM(u.age_group), ''), '') AS age_group,
          COUNT(*) AS count
         FROM user_follows uf
         JOIN users u ON uf.follower_id = u.id
         WHERE uf.following_id = ? AND u.age_group IS NOT NULL AND u.age_group != ''
         GROUP BY u.age_group
         ORDER BY count DESC`,
        [targetUserId]
      );

      let ageGroups = [];
      if (ageRows.length > 0) {
        const ageTotal = ageRows.reduce((sum, r) => sum + Number(r.count), 0);
        ageGroups = ageRows.map((r) => {
          const aCount = Number(r.count);
          const pct = Math.round((aCount / (ageTotal || 1)) * 100);
          return {
            group: r.age_group,
            percentage: pct,
            percentage_text: `${pct}%`,
            count: aCount,
          };
        });
      }

      // 6. Query Gender Demographics
      const [genderRows] = await pool.query(
        `SELECT 
          COALESCE(NULLIF(TRIM(u.gender), ''), '') AS gender,
          COUNT(*) AS count
         FROM user_follows uf
         JOIN users u ON uf.follower_id = u.id
         WHERE uf.following_id = ? AND u.gender IS NOT NULL AND u.gender != ''
         GROUP BY u.gender
         ORDER BY count DESC`,
        [targetUserId]
      );

      let genderDemographics = [];
      if (genderRows.length > 0) {
        const gTotal = genderRows.reduce((sum, r) => sum + Number(r.count), 0);
        genderDemographics = genderRows.map((r) => {
          const gCount = Number(r.count);
          const pct = Math.round((gCount / (gTotal || 1)) * 100);
          const name = r.gender.charAt(0).toUpperCase() + r.gender.slice(1);
          return {
            gender: name,
            percentage: pct,
            percentage_text: `${pct}%`,
            count: gCount,
          };
        });
      }

      return ApiResponse.success(
        res,
        {
          overview: {
            total_followers: {
              count: totalCount,
              formatted: formatNumber(totalCount),
              today_growth_count: todayGrowthCount,
              today_growth_text: `+${todayGrowthCount} today`,
            },
            new_followers: {
              count: newCount,
              formatted: formatNumber(newCount),
              growth_percentage: newGrowthPct,
              growth_percentage_text: newGrowthPct > 0 ? `+${newGrowthPct}%` : `${newGrowthPct}%`,
            },
            unfollowers: {
              count: 0,
              formatted: '0',
              growth_percentage: 0,
              growth_percentage_text: '0%',
            },
          },
          top_cities: topCities,
          age_groups: ageGroups,
          gender_demographics: genderDemographics,
        },
        'Audience statistics fetched successfully.'
      );
    } catch (error) {
      console.error('Audience Stats Error:', error);
      return ApiResponse.error(res, 'Failed to fetch audience statistics.', 500);
    }
  }
}

module.exports = AudienceController;
