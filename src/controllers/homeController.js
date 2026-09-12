const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const { toStoryFieldsArray, toEpisodeFieldsArray } = require('../utils/storyPresenter');

class HomeController {
  static async index(req, res) {
    try {
      const { search } = req.query;
      const userId = req.user ? req.user.id : null;

      // Handle Search query
      if (search) {
        const [searchResults] = await pool.query(
          `SELECT s.*, c.category_name, u.name as author_name,
                  (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
           FROM stories s
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE s.status IN ('ongoing', 'completed', 'published') AND (s.title LIKE ? OR s.description LIKE ?)
           ORDER BY s.listeners_count DESC, s.total_views DESC
           LIMIT 30`,
          [`%${search}%`, `%${search}%`]
        );

        const results = searchResults.map((s) => toStoryFieldsArray(s));
        return ApiResponse.success(res, { 'Top Results': results });
      }

      // Fetch user liked & bookmarked story IDs if authenticated
      let userLikedIds = new Set();
      let userBookmarkedIds = new Set();
      let preferredCategoryIds = [];

      if (userId) {
        const [likes] = await pool.query('SELECT story_id FROM story_likes WHERE user_id = ?', [userId]);
        likes.forEach((l) => userLikedIds.add(l.story_id));

        const [bookmarks] = await pool.query('SELECT story_id FROM bookmarks WHERE user_id = ?', [userId]);
        bookmarks.forEach((b) => userBookmarkedIds.add(b.story_id));

        const [prefCats] = await pool.query('SELECT category_id FROM user_categories WHERE user_id = ?', [userId]);
        preferredCategoryIds = prefCats.map((c) => c.category_id);
      }

      const mapStory = (s) =>
        toStoryFieldsArray(s, {
          isLiked: userLikedIds.has(s.id),
          isBookmarked: userBookmarkedIds.has(s.id),
        });

      // ── 1. Continue Listening ───────────────────────────────────────────────
      // Logic: Recent listening activity per story ordered by last watched time
      let continueListening = [];
      if (userId) {
        const [clRows] = await pool.query(
          `SELECT s.*, c.category_name, u.name as author_name,
                  (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count,
                  w.episode_id as wh_episode_id,
                  w.progress_seconds as wh_progress_seconds,
                  w.total_duration_seconds as wh_total_duration_seconds,
                  w.completion_percentage as wh_completion_percentage,
                  w.status as wh_status,
                  w.completed as wh_completed,
                  COALESCE(w.last_watched_at, w.updated_at, w.created_at) as wh_last_watched_at,
                  e.id as ep_id,
                  e.title as ep_title,
                  e.position as ep_position,
                  e.description as ep_description,
                  e.is_premium as ep_is_premium,
                  e.coins as ep_coins,
                  e.audio_path as ep_audio_path,
                  e.published_at as ep_published_at,
                  e.created_at as ep_created_at,
                  COALESCE(e.duration_seconds, w.total_duration_seconds, 0) as ep_duration
           FROM watch_histories w
           INNER JOIN (
             SELECT story_id, MAX(id) as max_history_id
             FROM watch_histories
             WHERE user_id = ? AND episode_id IS NOT NULL
             GROUP BY story_id
           ) latest ON w.id = latest.max_history_id
           JOIN stories s ON w.story_id = s.id
           LEFT JOIN episodes e ON w.episode_id = e.id
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE w.user_id = ? AND s.status IN ('ongoing', 'completed', 'published')
           ORDER BY COALESCE(w.last_watched_at, w.updated_at, w.created_at) DESC, w.id DESC
           LIMIT 10`,
          [userId, userId]
        );

        const storyIds = clRows.map((r) => r.id);
        let avgProgressMap = {};

        if (storyIds.length > 0) {
          const [avgRows] = await pool.query(
            `SELECT story_id, AVG(completion_percentage) as avg_completion
             FROM watch_histories
             WHERE user_id = ? AND story_id IN (?)
             GROUP BY story_id`,
            [userId, storyIds]
          );
          avgRows.forEach((r) => {
            avgProgressMap[r.story_id] = parseFloat(Number(r.avg_completion || 0).toFixed(2));
          });
        }

        continueListening = clRows.map((s) => {
          const progressSecs = Number(s.wh_progress_seconds || 0);
          const totalSecs = Number(s.ep_duration || s.wh_total_duration_seconds || 0);
          let compPct = Number(s.wh_completion_percentage || 0);
          if (compPct === 0 && totalSecs > 0) {
            compPct = parseFloat(((progressSecs / totalSecs) * 100).toFixed(2));
          }
          const avgCompPct = avgProgressMap[s.id] !== undefined ? avgProgressMap[s.id] : compPct;

          const watchHistoryData = {
            episode_id: s.wh_episode_id ? Number(s.wh_episode_id) : null,
            episode_no: s.ep_position ? Number(s.ep_position) : 1,
            episode_title: s.ep_title || null,
            progress_seconds: progressSecs,
            total_duration_seconds: totalSecs,
            completion_percentage: compPct,
            average_progress_percentage: avgCompPct,
            status: s.wh_status || 'playing',
            last_watched_at: s.wh_last_watched_at ? new Date(s.wh_last_watched_at).toISOString() : null,
          };

          let lastPlayedEpisodeData = null;
          if (s.wh_episode_id && s.ep_title) {
            const epObj = {
              id: s.wh_episode_id,
              story_id: s.id,
              title: s.ep_title,
              position: s.ep_position || 1,
              description: s.ep_description || null,
              is_premium: s.ep_is_premium || 0,
              coins: s.ep_coins || 25,
              audio_path: s.ep_audio_path || null,
              published_at: s.ep_published_at || s.ep_created_at,
              duration_seconds: totalSecs,
            };
            const progressObj = {
              progress_seconds: progressSecs,
              total_duration_seconds: totalSecs,
              completion_percentage: compPct,
              status: s.wh_status || 'playing',
              completed: Boolean(s.wh_completed),
              is_last_watched: true,
              last_watched_at: s.wh_last_watched_at ? new Date(s.wh_last_watched_at).toISOString() : null,
            };
            lastPlayedEpisodeData = toEpisodeFieldsArray(epObj, s.title, true, progressObj);
          }

          return toStoryFieldsArray(s, {
            isLiked: userLikedIds.has(s.id),
            isBookmarked: userBookmarkedIds.has(s.id),
            watchHistory: watchHistoryData,
            lastPlayedEpisode: lastPlayedEpisodeData,
          });
        });
      }

      // ── 2. Recommended for You ─────────────────────────────────────────────
      // Logic: High likes/bookmarks & matching preferred categories if user logged in
      let recWhere = "s.status = 'published'";
      let recParams = [];
      if (preferredCategoryIds.length > 0) {
        recWhere += ' AND s.category_id IN (?)';
        recParams.push(preferredCategoryIds);
      }

      const [recRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count,
                (SELECT COUNT(*) FROM bookmarks bm WHERE bm.story_id = s.id) as bookmarks_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE ${recWhere}
         ORDER BY (likes_count + bookmarks_count) DESC, s.rating DESC, s.listeners_count DESC
         LIMIT 10`,
        recParams
      );

      let recommendedForYou = recRows.map(mapStory);
      // Fallback for recommended if fewer than 5
      if (recommendedForYou.length < 5) {
        const [fallbackRec] = await pool.query(
          `SELECT s.*, c.category_name, u.name as author_name,
                  (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
           FROM stories s
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE s.status IN ('ongoing', 'completed', 'published')
           ORDER BY s.rating DESC, s.listeners_count DESC
           LIMIT 10`
        );
        recommendedForYou = fallbackRec.map(mapStory);
      }

      // ── 3. Trending ─────────────────────────────────────────────────────────
      // Logic: High views & activity (views + listeners count)
      const [trendingRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status IN ('ongoing', 'completed', 'published')
         ORDER BY s.total_views DESC, s.listeners_count DESC
         LIMIT 10`
      );
      const trending = trendingRows.map(mapStory);

      // ── 4. New Releases ─────────────────────────────────────────────────────
      // Logic: Recently published stories (order by created_at DESC)
      const [newReleasesRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status IN ('ongoing', 'completed', 'published') AND s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         ORDER BY s.total_views DESC, s.created_at DESC
         LIMIT 10`
      );

      let newReleases = newReleasesRows.map(mapStory);
      if (newReleases.length < 5) {
        const [fallbackNew] = await pool.query(
          `SELECT s.*, c.category_name, u.name as author_name,
                  (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
           FROM stories s
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE s.status IN ('ongoing', 'completed', 'published')
           ORDER BY s.created_at DESC
           LIMIT 10`
        );
        newReleases = fallbackNew.map(mapStory);
      }

      // ── 5. Top 10 ───────────────────────────────────────────────────────────
      // Logic: Highest total views, exactly top 10
      const [top10Rows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status IN ('ongoing', 'completed', 'published')
         ORDER BY s.total_views DESC, s.listeners_count DESC
         LIMIT 10`
      );
      const top10 = top10Rows.map(mapStory);

      // ── 6. Updated Today ────────────────────────────────────────────────────
      // Logic: Stories updated or created in the last 24 hours
      const [updatedTodayRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status IN ('ongoing', 'completed', 'published') AND (s.updated_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) OR s.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR))
         ORDER BY s.updated_at DESC
         LIMIT 10`
      );

      let updatedToday = updatedTodayRows.map(mapStory);
      if (updatedToday.length < 5) {
        const [fallbackUpdated] = await pool.query(
          `SELECT s.*, c.category_name, u.name as author_name,
                  (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
           FROM stories s
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE s.status IN ('ongoing', 'completed', 'published')
           ORDER BY s.updated_at DESC
           LIMIT 10`
        );
        updatedToday = fallbackUpdated.map(mapStory);
      }

      // ── 7. Because You Listened ─────────────────────────────────────────────
      // Logic: Based on user's recent listened story's category or author
      let becauseYouListened = [];
      let baseStoryTitle = null;

      if (userId) {
        const [lastWatched] = await pool.query(
          `SELECT w.story_id, s.category_id, s.title
           FROM watch_histories w
           JOIN stories s ON w.story_id = s.id
           WHERE w.user_id = ?
           ORDER BY w.last_watched_at DESC
           LIMIT 1`,
          [userId]
        );

        if (lastWatched.length > 0) {
          const recentStoryId = lastWatched[0].story_id;
          const recentCategoryId = lastWatched[0].category_id;
          baseStoryTitle = lastWatched[0].title;

          const [bylRows] = await pool.query(
            `SELECT s.*, c.category_name, u.name as author_name,
                    (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
             FROM stories s
             LEFT JOIN categories c ON s.category_id = c.id
             LEFT JOIN users u ON s.user_id = u.id
             WHERE s.status IN ('ongoing', 'completed', 'published') AND s.category_id = ? AND s.id != ?
             ORDER BY s.listeners_count DESC
             LIMIT 10`,
            [recentCategoryId, recentStoryId]
          );
          becauseYouListened = bylRows.map(mapStory);
        }
      }

      if (becauseYouListened.length === 0) {
        const [fallbackByl] = await pool.query(
          `SELECT s.*, c.category_name, u.name as author_name,
                  (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
           FROM stories s
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE s.status IN ('ongoing', 'completed', 'published')
           ORDER BY s.listeners_count DESC
           LIMIT 10`
        );
        becauseYouListened = fallbackByl.map(mapStory);
      }

      // ── 8. Popular ──────────────────────────────────────────────────────────
      // Logic: Generally most consumed stories by all users
      const [popularRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status IN ('ongoing', 'completed', 'published')
         ORDER BY s.listeners_count DESC, s.total_views DESC
         LIMIT 10`
      );
      const popular = popularRows.map(mapStory);

      // ── 9. Free Stories ──────────────────────────────────────────────────────
      // Logic: Stories where is_premium = 0
      const [freeRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status = 'published' AND s.is_premium = 0
         ORDER BY s.listeners_count DESC
         LIMIT 10`
      );
      const freeStories = freeRows.map(mapStory);

      // Construct final response payload using Title Case section names
      return ApiResponse.success(res, {
        'Continue Listening': continueListening,
        'continue_listening': continueListening,
        'Recommended for You': recommendedForYou,
        'Trending': trending,
        'New Releases': newReleases,
        'Top 10': top10,
        'Updated Today': updatedToday,
        'Because You Listened': becauseYouListened,
        'Popular': popular,
        'Free Stories': freeStories,
        because_you_listened_title: baseStoryTitle,
      });
    } catch (error) {
      console.error('Home Feed Error:', error);
      return ApiResponse.error(res, 'Failed to fetch home feed.', 500);
    }
  }
}

module.exports = HomeController;
