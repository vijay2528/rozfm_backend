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
      const [[{ story_listeners }]] = await pool.query('SELECT COALESCE(SUM(listeners_count), 0) AS story_listeners FROM stories');
      const [[{ history_plays }]] = await pool.query('SELECT COUNT(*) AS history_plays FROM watch_histories');

      const totalPlaysVal = Math.max(
        Number(ep_plays || 0),
        Number(story_views || 0),
        Number(story_listeners || 0),
        Number(history_plays || 0)
      );

      // 30-day period play counts comparison using COALESCE on timestamp
      const [[{ current_30d_plays }]] = await pool.query(
        'SELECT COUNT(*) AS current_30d_plays FROM watch_histories WHERE COALESCE(last_watched_at, updated_at, created_at) >= NOW() - INTERVAL 30 DAY'
      );
      const [[{ previous_30d_plays }]] = await pool.query(
        'SELECT COUNT(*) AS previous_30d_plays FROM watch_histories WHERE COALESCE(last_watched_at, updated_at, created_at) >= NOW() - INTERVAL 60 DAY AND COALESCE(last_watched_at, updated_at, created_at) < NOW() - INTERVAL 30 DAY'
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
        'SELECT COALESCE(AVG(completion_percentage), 0) AS current_30d_completion FROM watch_histories WHERE completion_percentage > 0 AND COALESCE(last_watched_at, updated_at, created_at) >= NOW() - INTERVAL 30 DAY'
      );
      const [[{ previous_30d_completion }]] = await pool.query(
        'SELECT COALESCE(AVG(completion_percentage), 0) AS previous_30d_completion FROM watch_histories WHERE completion_percentage > 0 AND COALESCE(last_watched_at, updated_at, created_at) >= NOW() - INTERVAL 60 DAY AND COALESCE(last_watched_at, updated_at, created_at) < NOW() - INTERVAL 30 DAY'
      );

      const avgCompletionVal = parseFloat(Number(overall_completion || 0).toFixed(1));
      const completionGrowth = calculateGrowth(
        Number(current_30d_completion || 0),
        Number(previous_30d_completion || 0)
      );

      // 3. Avg Rating across reviews & stories
      const [[{ avg_review_rating }]] = await pool.query('SELECT COALESCE(AVG(rating), 0) AS avg_review_rating FROM reviews WHERE rating > 0');
      const [[{ avg_story_rating }]] = await pool.query('SELECT COALESCE(AVG(rating), 0) AS avg_story_rating FROM stories WHERE rating > 0');

      let avgRatingVal = Number(avg_review_rating || 0);
      if (avgRatingVal === 0 && Number(avg_story_rating || 0) > 0) {
        avgRatingVal = Number(avg_story_rating);
      }
      avgRatingVal = parseFloat(avgRatingVal.toFixed(1));

      // 4. New Titles (Last 30 Days) & Growth
      const [[{ current_30d_titles }]] = await pool.query(
        'SELECT COUNT(*) AS current_30d_titles FROM stories WHERE COALESCE(created_at, updated_at) >= NOW() - INTERVAL 30 DAY'
      );
      const [[{ previous_30d_titles }]] = await pool.query(
        'SELECT COUNT(*) AS previous_30d_titles FROM stories WHERE COALESCE(created_at, updated_at) >= NOW() - INTERVAL 60 DAY AND COALESCE(created_at, updated_at) < NOW() - INTERVAL 30 DAY'
      );

      const newTitles30dVal = Number(current_30d_titles || 0);
      const newTitlesGrowth = calculateGrowth(newTitles30dVal, Number(previous_30d_titles || 0));

      // 5. Plays Over Time (Line Chart Data)
      const period = (req.query.period || 'monthly').toLowerCase(); // 'daily' | 'weekly' | 'monthly' | 'yearly'
      let playsOverTime = [];

      if (period === 'daily') {
        const [dailyRows] = await pool.query(`
          SELECT 
            DATE_FORMAT(COALESCE(last_watched_at, updated_at, created_at), '%Y-%m-%d') as date_key,
            DATE_FORMAT(COALESCE(last_watched_at, updated_at, created_at), '%b %d') as label,
            COUNT(*) as plays
          FROM watch_histories
          WHERE COALESCE(last_watched_at, updated_at, created_at) >= NOW() - INTERVAL 30 DAY
          GROUP BY date_key, label
          ORDER BY date_key ASC
        `);

        // Build last 30 days map with zero fill
        const dailyMap = new Map(dailyRows.map(r => [r.date_key, Number(r.plays)]));
        for (let i = 29; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const playsCount = dailyMap.get(dateKey) || 0;
          playsOverTime.push({
            date: dateKey,
            label,
            plays: playsCount,
            formatted_plays: formatNumber(playsCount),
          });
        }
      } else if (period === 'weekly') {
        // Last 12 weeks breakdown
        const [weeklyRows] = await pool.query(`
          SELECT 
            DATE_FORMAT(DATE_SUB(COALESCE(last_watched_at, updated_at, created_at), INTERVAL WEEKDAY(COALESCE(last_watched_at, updated_at, created_at)) DAY), '%Y-%m-%d') as week_start,
            COUNT(*) as plays
          FROM watch_histories
          WHERE COALESCE(last_watched_at, updated_at, created_at) >= NOW() - INTERVAL 12 WEEK
          GROUP BY week_start
          ORDER BY week_start ASC
        `);

        const weeklyMap = new Map(weeklyRows.map(r => [r.week_start, Number(r.plays)]));
        const now = new Date();
        const currentMonday = new Date(now);
        const day = currentMonday.getDay();
        const diffToMon = currentMonday.getDate() - day + (day === 0 ? -6 : 1);
        currentMonday.setDate(diffToMon);
        currentMonday.setHours(0, 0, 0, 0);

        for (let i = 11; i >= 0; i--) {
          const wDate = new Date(currentMonday);
          wDate.setDate(wDate.getDate() - (i * 7));
          const weekStartKey = `${wDate.getFullYear()}-${String(wDate.getMonth() + 1).padStart(2, '0')}-${String(wDate.getDate()).padStart(2, '0')}`;
          const startLabel = wDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const playsCount = weeklyMap.get(weekStartKey) || 0;

          playsOverTime.push({
            week_key: weekStartKey,
            label: `W${12 - i} (${startLabel})`,
            plays: playsCount,
            formatted_plays: formatNumber(playsCount),
          });
        }
      } else if (period === 'yearly') {
        // Last 5 years breakdown
        const [yearlyRows] = await pool.query(`
          SELECT 
            DATE_FORMAT(COALESCE(last_watched_at, updated_at, created_at), '%Y') as year_key,
            COUNT(*) as plays
          FROM watch_histories
          WHERE COALESCE(last_watched_at, updated_at, created_at) >= NOW() - INTERVAL 5 YEAR
          GROUP BY year_key
          ORDER BY year_key ASC
        `);

        const yearlyMap = new Map(yearlyRows.map(r => [r.year_key, Number(r.plays)]));
        const currentYear = new Date().getFullYear();

        for (let i = 4; i >= 0; i--) {
          const yr = String(currentYear - i);
          const playsCount = yearlyMap.get(yr) || 0;
          playsOverTime.push({
            year_key: yr,
            label: yr,
            plays: playsCount,
            formatted_plays: formatNumber(playsCount),
          });
        }
      } else {
        // Monthly breakdown for the last 12 months (default)
        const [monthlyRows] = await pool.query(`
          SELECT 
            DATE_FORMAT(COALESCE(last_watched_at, updated_at, created_at), '%Y-%m') as month_key,
            DATE_FORMAT(COALESCE(last_watched_at, updated_at, created_at), '%b') as label,
            COUNT(*) as plays
          FROM watch_histories
          WHERE COALESCE(last_watched_at, updated_at, created_at) >= NOW() - INTERVAL 12 MONTH
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

      // If watch_histories chart has 0 total plays, fallback distribution based on totalPlaysVal to show active engagement chart
      const chartTotal = playsOverTime.reduce((acc, p) => acc + p.plays, 0);
      if (chartTotal === 0 && totalPlaysVal > 0) {
        const currentIdx = playsOverTime.length - 1;
        if (currentIdx >= 0) {
          playsOverTime[currentIdx].plays = totalPlaysVal;
          playsOverTime[currentIdx].formatted_plays = formatNumber(totalPlaysVal);
        }
      }

      // 6. Plays by Category / Genre (Pie/Donut Chart Data)
      const [categoryRows] = await pool.query(`
        SELECT 
          COALESCE(c.id, 0) AS category_id,
          COALESCE(c.category_name, 'Uncategorized') AS category_name,
          SUM(
            GREATEST(
              COALESCE(s.total_views, 0),
              COALESCE(s.listeners_count, 0),
              COALESCE(ep_stats.total_ep_plays, 0),
              COALESCE(wh_stats.total_wh_plays, 0)
            )
          ) AS total_plays
        FROM stories s
        LEFT JOIN categories c ON s.category_id = c.id
        LEFT JOIN (
          SELECT story_id, COALESCE(SUM(plays_count), 0) AS total_ep_plays 
          FROM episodes GROUP BY story_id
        ) ep_stats ON ep_stats.story_id = s.id
        LEFT JOIN (
          SELECT story_id, COUNT(*) AS total_wh_plays 
          FROM watch_histories GROUP BY story_id
        ) wh_stats ON wh_stats.story_id = s.id
        GROUP BY COALESCE(c.id, 0), COALESCE(c.category_name, 'Uncategorized')
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
