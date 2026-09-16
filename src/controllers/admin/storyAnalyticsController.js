const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');
const { formatNumber } = require('../../utils/storyPresenter');

function calculateGrowth(current, previous) {
  const curr = Number(current) || 0;
  const prev = Number(previous) || 0;

  if (prev === 0) {
    if (curr > 0) return { percentage: 100, is_positive: true, text: '+100%' };
    return { percentage: 0, is_positive: true, text: '+0%' };
  }

  const diff = curr - prev;
  const pct = parseFloat(((diff / prev) * 100).toFixed(1));
  const isPositive = pct >= 0;
  const sign = isPositive ? '+' : '';
  return {
    percentage: Math.abs(pct),
    is_positive: isPositive,
    text: `${sign}${pct}%`,
  };
}

class StoryAnalyticsController {
  /**
   * GET /api/v1/admin/story-analytics
   * Fetch catalogue-wide Story Analytics overview, KPI metrics & chart data for admin panel
   */
  static async getStoryAnalytics(req, res) {
    try {
      // 1. Total Play Count & Growth
      const [[{ ep_plays }]] = await pool.query('SELECT COALESCE(SUM(plays_count), 0) AS ep_plays FROM episodes');
      const [[{ story_views }]] = await pool.query('SELECT COALESCE(SUM(total_views), 0) AS story_views FROM stories');
      const [[{ history_plays }]] = await pool.query('SELECT COUNT(*) AS history_plays FROM watch_histories');

      const totalPlaysVal = Math.max(Number(ep_plays || 0), Number(story_views || 0), Number(history_plays || 0));

      // 30-day period play counts comparison
      const [[{ current_30d_plays }]] = await pool.query(
        'SELECT COUNT(*) AS current_30d_plays FROM watch_histories WHERE last_watched_at >= NOW() - INTERVAL 30 DAY'
      );
      const [[{ previous_30d_plays }]] = await pool.query(
        'SELECT COUNT(*) AS previous_30d_plays FROM watch_histories WHERE last_watched_at >= NOW() - INTERVAL 60 DAY AND last_watched_at < NOW() - INTERVAL 30 DAY'
      );

      const playsGrowth = calculateGrowth(
        Number(current_30d_plays || 0),
        Number(previous_30d_plays || 0)
      );

      // 2. Avg Completion Rate & Growth
      const [[{ overall_completion }]] = await pool.query(
        'SELECT COALESCE(AVG(completion_percentage), 0) AS overall_completion FROM watch_histories WHERE completion_percentage > 0'
      );
      const [[{ current_30d_completion }]] = await pool.query(
        'SELECT COALESCE(AVG(completion_percentage), 0) AS current_30d_completion FROM watch_histories WHERE completion_percentage > 0 AND last_watched_at >= NOW() - INTERVAL 30 DAY'
      );
      const [[{ previous_30d_completion }]] = await pool.query(
        'SELECT COALESCE(AVG(completion_percentage), 0) AS previous_30d_completion FROM watch_histories WHERE completion_percentage > 0 AND last_watched_at >= NOW() - INTERVAL 60 DAY AND last_watched_at < NOW() - INTERVAL 30 DAY'
      );

      const avgCompletionVal = parseFloat(Number(overall_completion || 0).toFixed(1));
      const completionGrowth = calculateGrowth(
        Number(current_30d_completion || 0),
        Number(previous_30d_completion || 0)
      );

      // 3. Avg Rating
      const [[{ avg_review_rating }]] = await pool.query('SELECT COALESCE(AVG(rating), 0) AS avg_review_rating FROM reviews');
      const [[{ avg_story_rating }]] = await pool.query('SELECT COALESCE(AVG(rating), 0) AS avg_story_rating FROM stories WHERE rating > 0');

      let avgRatingVal = Number(avg_review_rating || 0);
      if (avgRatingVal === 0 && Number(avg_story_rating || 0) > 0) {
        avgRatingVal = Number(avg_story_rating);
      }
      avgRatingVal = parseFloat(avgRatingVal.toFixed(1));

      // 4. New Titles (Last 30 Days) & Growth
      const [[{ current_30d_titles }]] = await pool.query(
        'SELECT COUNT(*) AS current_30d_titles FROM stories WHERE created_at >= NOW() - INTERVAL 30 DAY'
      );
      const [[{ previous_30d_titles }]] = await pool.query(
        'SELECT COUNT(*) AS previous_30d_titles FROM stories WHERE created_at >= NOW() - INTERVAL 60 DAY AND created_at < NOW() - INTERVAL 30 DAY'
      );

      const newTitles30dVal = Number(current_30d_titles || 0);
      const newTitlesGrowth = calculateGrowth(newTitles30dVal, Number(previous_30d_titles || 0));

      // 5. Plays Over Time (Line Chart Data)
      const period = req.query.period || 'monthly'; // 'monthly' | 'daily'
      let playsOverTime = [];

      if (period === 'daily') {
        const [dailyRows] = await pool.query(`
          SELECT 
            DATE_FORMAT(last_watched_at, '%Y-%m-%d') as date_key,
            DATE_FORMAT(last_watched_at, '%b %d') as label,
            COUNT(*) as plays
          FROM watch_histories
          WHERE last_watched_at >= NOW() - INTERVAL 30 DAY
          GROUP BY date_key, label
          ORDER BY date_key ASC
        `);

        // Build last 30 days map with zero fill
        const dailyMap = new Map(dailyRows.map(r => [r.date_key, Number(r.plays)]));
        for (let i = 29; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const dateKey = d.toISOString().split('T')[0];
          const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const playsCount = dailyMap.get(dateKey) || 0;
          playsOverTime.push({
            date: dateKey,
            label,
            plays: playsCount,
            formatted_plays: formatNumber(playsCount),
          });
        }
      } else {
        // Monthly breakdown for the last 12 months
        const [monthlyRows] = await pool.query(`
          SELECT 
            DATE_FORMAT(last_watched_at, '%Y-%m') as month_key,
            DATE_FORMAT(last_watched_at, '%b') as label,
            COUNT(*) as plays
          FROM watch_histories
          WHERE last_watched_at >= NOW() - INTERVAL 12 MONTH
          GROUP BY month_key, label
          ORDER BY month_key ASC
        `);

        const monthlyMap = new Map(monthlyRows.map(r => [r.month_key, Number(r.plays)]));
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const now = new Date();

        for (let i = 11; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          const label = monthNames[d.getMonth()];
          const playsCount = monthlyMap.get(monthKey) || 0;

          playsOverTime.push({
            month_key: monthKey,
            label,
            plays: playsCount,
            formatted_plays: formatNumber(playsCount),
          });
        }
      }

      // 6. Plays by Category / Genre (Pie/Donut Chart Data)
      const [categoryRows] = await pool.query(`
        SELECT 
          c.id AS category_id,
          c.category_name,
          COALESCE(SUM(s.total_views), 0) + COALESCE(SUM(e.plays_count), 0) + COUNT(w.id) AS total_plays
        FROM categories c
        LEFT JOIN stories s ON s.category_id = c.id
        LEFT JOIN episodes e ON e.story_id = s.id
        LEFT JOIN watch_histories w ON w.story_id = s.id
        GROUP BY c.id, c.category_name
        ORDER BY total_plays DESC
      `);

      const totalCategoryPlays = categoryRows.reduce((acc, row) => acc + Number(row.total_plays || 0), 0);

      const playsByCategory = categoryRows.map((cat) => {
        const plays = Number(cat.total_plays || 0);
        const percentage = totalCategoryPlays > 0
          ? parseFloat(((plays / totalCategoryPlays) * 100).toFixed(1))
          : 0;

        return {
          category_id: Number(cat.category_id),
          category_name: cat.category_name,
          plays: plays,
          formatted_plays: formatNumber(plays),
          percentage: percentage,
          formatted_percentage: `${percentage}%`,
        };
      });

      // Construct Analytics Response Payload matching Admin Console specification
      const analyticsData = {
        kpis: {
          total_plays: {
            value: totalPlaysVal,
            formatted: formatNumber(totalPlaysVal),
            growth: playsGrowth,
          },
          avg_completion: {
            value: avgCompletionVal,
            formatted: `${avgCompletionVal}%`,
            growth: completionGrowth,
          },
          avg_rating: {
            value: avgRatingVal,
            formatted: avgRatingVal.toFixed(1),
          },
          new_titles_30d: {
            value: newTitles30dVal,
            formatted: formatNumber(newTitles30dVal),
            growth: newTitlesGrowth,
          },
        },
        charts: {
          plays_over_time: {
            period: period,
            data: playsOverTime,
          },
          plays_by_category: {
            total_plays: totalCategoryPlays,
            formatted_total_plays: formatNumber(totalCategoryPlays),
            data: playsByCategory,
          },
        },
      };

      return ApiResponse.success(res, analyticsData, 'Story analytics fetched successfully.');
    } catch (error) {
      console.error('Admin Story Analytics Error:', error);
      return ApiResponse.error(res, 'Failed to fetch story analytics.', 500);
    }
  }
}

module.exports = StoryAnalyticsController;
