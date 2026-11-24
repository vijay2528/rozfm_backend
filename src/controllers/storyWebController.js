const { pool } = require('../config/db');
const path = require('path');
const fs = require('fs');
const StoryController = require('./storyController');
const EpisodeController = require('./episodeController');

const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';
const STATIC_PLAY_BASE = 'https://play.google.com/store/apps/details?id=com.rozfm&referrer=deep_link=';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.rozfm';

function resolveUrl(pathStr, host = 'api.rozfm.com', protocol = 'https') {
  if (!pathStr) return `${protocol}://${host}/logo.png`;
  if (pathStr.startsWith('http://') || pathStr.startsWith('https://')) {
    return pathStr;
  }
  return `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${pathStr.replace(/^\//, '')}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildLandingHtml({
  pageTitle,
  metaTitle,
  metaDescription,
  canonicalUrl,
  coverImage,
  badgeText,
  subTitle,
  author,
  category,
  intentPath,
  contentType = 'story'
}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#100b1d">
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${escapeHtml(metaDescription)}">

    <!-- Open Graph / WhatsApp / Facebook / Telegram Meta Tags -->
    <meta property="og:type" content="music.song">
    <meta property="og:site_name" content="Roz FM">
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
    <meta property="og:title" content="${escapeHtml(metaTitle)}">
    <meta property="og:description" content="${escapeHtml(metaDescription)}">
    <meta property="og:image" content="${escapeHtml(coverImage)}">
    <meta property="og:image:secure_url" content="${escapeHtml(coverImage)}">
    <meta property="og:image:width" content="600">
    <meta property="og:image:height" content="600">
    <meta property="og:image:type" content="image/jpeg">

    <!-- Twitter Card Meta Tags -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:site" content="@rozfm">
    <meta name="twitter:url" content="${escapeHtml(canonicalUrl)}">
    <meta name="twitter:title" content="${escapeHtml(metaTitle)}">
    <meta name="twitter:description" content="${escapeHtml(metaDescription)}">
    <meta name="twitter:image" content="${escapeHtml(coverImage)}">

    <link rel="icon" type="image/png" href="/logo.png">

    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            min-height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #ffffff;
            background:
                radial-gradient(ellipse at 50% 10%, #51247a 0%, transparent 48%),
                linear-gradient(145deg, #100b1d, #1b1030 58%, #090711);
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 24px;
            overflow-x: hidden;
        }

        .glow {
            position: fixed;
            width: 320px;
            height: 320px;
            border-radius: 50%;
            filter: blur(100px);
            opacity: 0.35;
            pointer-events: none;
            z-index: 1;
        }

        .glow.one {
            background: #a855f7;
            top: -120px;
            left: -100px;
        }

        .glow.two {
            background: #ec4899;
            right: -100px;
            bottom: -130px;
        }

        .container {
            position: relative;
            z-index: 2;
            width: 100%;
            max-width: 440px;
            text-align: center;
            animation: appear 0.8s ease;
        }

        @keyframes appear {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.12);
            backdrop-filter: blur(8px);
            border-radius: 100px;
            padding: 6px 14px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.8px;
            text-transform: uppercase;
            color: #e9d5ff;
            margin-bottom: 22px;
        }

        .badge-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #a855f7;
            box-shadow: 0 0 10px #c084fc;
        }

        .cover-wrapper {
            width: 190px;
            height: 190px;
            margin: 0 auto 24px;
            padding: 4px;
            border-radius: 28px;
            background: linear-gradient(135deg, #f0abfc, #a855f7, #6366f1);
            box-shadow: 0 20px 50px rgba(168, 85, 247, 0.4);
            position: relative;
        }

        .cover-inner {
            width: 100%;
            height: 100%;
            border-radius: 24px;
            overflow: hidden;
            background: #1e1338;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .cover-inner img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }

        .title {
            font-size: 24px;
            font-weight: 800;
            line-height: 1.25;
            margin-bottom: 8px;
            letter-spacing: -0.4px;
            color: #ffffff;
            text-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
        }

        .meta {
            font-size: 13px;
            font-weight: 500;
            color: #c084fc;
            margin-bottom: 14px;
        }

        .desc {
            font-size: 14px;
            color: #cbd5e1;
            line-height: 1.5;
            margin-bottom: 24px;
            padding: 0 8px;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .tags {
            display: flex;
            justify-content: center;
            gap: 8px;
            margin-bottom: 26px;
        }

        .tag-pill {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 8px 12px;
            font-size: 11px;
            color: #e2e8f0;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 2px;
            min-width: 80px;
        }

        .tag-pill span.icon {
            font-size: 15px;
        }

        .play-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            width: 100%;
            padding: 16px 24px;
            border-radius: 16px;
            background: linear-gradient(135deg, #a855f7, #ec4899);
            color: #ffffff;
            text-decoration: none;
            font-weight: 700;
            font-size: 16px;
            letter-spacing: 0.2px;
            box-shadow: 0 12px 30px rgba(168, 85, 247, 0.45);
            transition: all 0.2s ease;
            cursor: pointer;
            border: none;
        }

        .play-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 16px 36px rgba(168, 85, 247, 0.6);
        }

        .play-icon {
            width: 22px;
            height: 22px;
        }

        .status {
            margin-top: 18px;
            font-size: 12px;
            color: #94a3b8;
            min-height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .spinner {
            display: inline-block;
            width: 13px;
            height: 13px;
            border: 2px solid rgba(255, 255, 255, 0.2);
            border-top-color: #a855f7;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .footer {
            margin-top: 24px;
            font-size: 11px;
            color: #64748b;
        }
    </style>
</head>
<body>
    <div class="glow one"></div>
    <div class="glow two"></div>

    <main class="container">
        <div class="badge">
            <span class="badge-dot"></span>
            ${escapeHtml(badgeText)}
        </div>

        <div class="cover-wrapper">
            <div class="cover-inner">
                <img src="${escapeHtml(coverImage)}" alt="${escapeHtml(pageTitle)}" onerror="this.src='/logo.png'">
            </div>
        </div>

        <h1 class="title">${escapeHtml(subTitle)}</h1>
        <div class="meta">${escapeHtml(author)} &bull; ${escapeHtml(category)}</div>

        <p class="desc">${escapeHtml(metaDescription)}</p>

        <div class="tags">
            <div class="tag-pill">
                <span class="icon">🎧</span>
                <span>Audio Story</span>
            </div>
            <div class="tag-pill">
                <span class="icon">🎙️</span>
                <span>Voice Cast</span>
            </div>
            <div class="tag-pill">
                <span class="icon">⭐</span>
                <span>Top Series</span>
            </div>
        </div>

        <a class="play-btn" id="downloadBtn" href="${STATIC_PLAY_BASE}${escapeHtml(canonicalUrl)}" target="_blank" rel="noopener noreferrer">
            <svg class="play-icon" viewBox="0 0 24 24" fill="white">
                <path d="M3.5 2.8v18.4L14 12 3.5 2.8z"/>
                <path d="M15.1 11l2.7-2.7-11-6.1 8.3 8.8z"/>
                <path d="M15.1 13l2.7 2.7-11 6.1 8.3-8.8z"/>
            </svg>
            Get it on Google Play
        </a>

        <div class="status" id="status">
            <span class="spinner"></span>
            Opening in Roz FM App...
        </div>

        <div class="footer">
            &copy; 2026 Roz FM. All rights reserved.
        </div>
    </main>

    <script>
        (function () {
            // Static Google Play base with referrer
            const STATIC_PLAY_BASE = "${STATIC_PLAY_BASE}";

            // Dynamically get the current browser URL from the address bar (retains query parameters)
            const currentBrowserLink = window.location.href ? window.location.href.split('#')[0] : '';
            const PLAY_STORE_URL = STATIC_PLAY_BASE + currentBrowserLink;
            const INTENT_PATH = "${escapeHtml(intentPath)}";
            const params = new URLSearchParams(window.location.search);
            const status = document.getElementById("status");
            const button = document.getElementById("downloadBtn");

            // Update button href dynamically
            if (button) {
                button.href = PLAY_STORE_URL;
                button.addEventListener("click", function () {
                    this.href = STATIC_PLAY_BASE + window.location.href.split('#')[0];
                });
            }

            // Preview mode for inspection without triggering auto-redirect
            if (params.get("preview") === "1" || params.get("noredirect") === "1") {
                if (status) status.innerHTML = "Roz FM App Preview Mode";
                return;
            }

            const isAndroid = /Android/i.test(navigator.userAgent);

            // On Android, attempt to trigger deep link into the installed app
            if (isAndroid) {
                const intentUrl = "intent://" + INTENT_PATH +
                    "#Intent;scheme=rozfm;package=com.rozfm;S.browser_fallback_url=" +
                    encodeURIComponent(PLAY_STORE_URL) + ";end";

                const start = Date.now();
                window.location.href = intentUrl;

                setTimeout(function () {
                    // If user is still on this web page after 2.5s, app is likely not installed
                    if (Date.now() - start < 3500) {
                        if (status) {
                            status.innerHTML = '<span class="spinner"></span> Redirecting to Google Play...';
                        }
                        window.location.href = PLAY_STORE_URL;
                    }
                }, 2500);
            } else {
                // Non-Android / Desktop: direct after countdown
                setTimeout(function () {
                    if (status) {
                        status.innerHTML = 'Ready! Tap <b>Get it on Google Play</b> to listen on Roz FM.';
                    }
                }, 2000);
            }
        })();
    </script>
</body>
</html>`;
}

class StoryWebController {
  /**
   * GET /stories/:id
   * Web Landing Page for shared stories with Open Graph metadata and App/Play Store redirect
   */
  static async renderStoryPage(req, res) {
    try {
      // If request explicitly asks for JSON, delegate to API StoryController
      const acceptHeader = req.headers.accept || '';
      if (
        req.query.format === 'json' ||
        (acceptHeader.includes('application/json') && !acceptHeader.includes('text/html'))
      ) {
        return StoryController.show(req, res);
      }

      const storyId = req.params.id || req.params.storyId;
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const host = req.get('host') || 'api.rozfm.com';
      const currentUrl = `${protocol}://${host}/stories/${encodeURIComponent(storyId)}`;

      // 1. Fetch story details from DB (match by id or slug)
      let story = null;
      try {
        const [rows] = await pool.query(
          `SELECT s.id, s.title, s.description, s.cover_image_path, s.banner_image_path,
                  c.category_name, u.name as author_name
           FROM stories s
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE s.id = ? OR s.slug = ?
           LIMIT 1`,
          [storyId, storyId]
        );
        if (rows && rows.length > 0) {
          story = rows[0];
        }
      } catch (dbErr) {
        console.error('[StoryWebController] Database query error:', dbErr.message);
      }

      const actualId = story ? story.id : storyId;
      const title = story && story.title ? story.title : 'Roz FM - Audio Stories';
      const description = story && story.description
        ? story.description.replace(/\s+/g, ' ').trim().slice(0, 180)
        : 'Your next favourite story is waiting. Discover exciting audio stories and series on Roz FM.';
      const coverImage = resolveUrl(story ? (story.cover_image_path || story.banner_image_path) : null, host, protocol);
      const author = story && story.author_name ? story.author_name : 'Roz FM Originals';
      const category = story && story.category_name ? story.category_name : 'Audio Series';

      const html = buildLandingHtml({
        pageTitle: `${title} - Roz FM`,
        metaTitle: `${title} | Roz FM`,
        metaDescription: description,
        canonicalUrl: currentUrl,
        coverImage: coverImage,
        badgeText: 'ROZ FM EXCLUSIVE',
        subTitle: title,
        author: author,
        category: category,
        intentPath: `stories/${encodeURIComponent(actualId)}`,
        contentType: 'story'
      });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    } catch (err) {
      console.error('[StoryWebController] Story render error:', err);
      return res.redirect(PLAY_STORE_URL);
    }
  }

  /**
   * GET /episodes/:id
   * Web Landing Page for shared episodes (e.g. WhatsApp share link: https://api.rozfm.com/episodes/8zngxA9?story_id=RB7b30d)
   */
  static async renderEpisodePage(req, res) {
    try {
      // If request explicitly asks for JSON, delegate to API EpisodeController
      const acceptHeader = req.headers.accept || '';
      if (
        req.query.format === 'json' ||
        (acceptHeader.includes('application/json') && !acceptHeader.includes('text/html'))
      ) {
        return EpisodeController.show(req, res);
      }

      const episodeParam = req.params.id;
      const storyIdFromQuery = req.query.story_id;
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const host = req.get('host') || 'api.rozfm.com';

      // Full URL with query parameters exactly as requested
      const queryString = req.originalUrl && req.originalUrl.includes('?')
        ? req.originalUrl.substring(req.originalUrl.indexOf('?'))
        : (storyIdFromQuery ? `?story_id=${encodeURIComponent(storyIdFromQuery)}` : '');
      const currentUrl = `${protocol}://${host}/episodes/${encodeURIComponent(episodeParam)}${queryString}`;

      let episode = null;
      let story = null;

      try {
        // 1. Try to fetch episode directly by id or position/title
        const [epRows] = await pool.query(
          `SELECT e.*, s.id as story_id, s.title as story_title, s.description as story_description,
                  s.cover_image_path as story_cover_image_path, s.banner_image_path as story_banner_image_path,
                  c.category_name, u.name as author_name
           FROM episodes e
           JOIN stories s ON e.story_id = s.id
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE e.id = ?
           LIMIT 1`,
          [episodeParam]
        );

        if (epRows && epRows.length > 0) {
          episode = epRows[0];
          story = {
            id: epRows[0].story_id,
            title: epRows[0].story_title,
            description: epRows[0].story_description,
            cover_image_path: epRows[0].story_cover_image_path,
            banner_image_path: epRows[0].story_banner_image_path,
            category_name: epRows[0].category_name,
            author_name: epRows[0].author_name,
          };
        } else if (storyIdFromQuery) {
          // 2. Fallback: Lookup parent story by story_id query param
          const [storyRows] = await pool.query(
            `SELECT s.*, c.category_name, u.name as author_name
             FROM stories s
             LEFT JOIN categories c ON s.category_id = c.id
             LEFT JOIN users u ON s.user_id = u.id
             WHERE s.id = ? OR s.slug = ?
             LIMIT 1`,
            [storyIdFromQuery, storyIdFromQuery]
          );

          if (storyRows && storyRows.length > 0) {
            story = storyRows[0];
            // Check if episodeParam corresponds to episode_number or ID within this story
            const [epSub] = await pool.query(
              `SELECT * FROM episodes WHERE story_id = ? AND (id = ? OR episode_number = ?) LIMIT 1`,
              [story.id, episodeParam, episodeParam]
            );
            if (epSub && epSub.length > 0) {
              episode = epSub[0];
            }
          }
        }
      } catch (dbErr) {
        console.error('[StoryWebController] Episode DB query error:', dbErr.message);
      }

      // Title & metadata formatting
      let pageTitle = 'Roz FM - Audio Series';
      let metaTitle = 'Roz FM - Audio Series';
      let subTitle = 'Roz FM Originals';
      let badgeText = 'ROZ FM EPISODE';

      if (episode && episode.title) {
        subTitle = episode.title;
        const epNumberStr = episode.episode_number ? `Ep. ${episode.episode_number}: ` : '';
        pageTitle = `${epNumberStr}${episode.title} - ${story ? story.title : 'Roz FM'}`;
        metaTitle = `${epNumberStr}${episode.title} | ${story ? story.title : 'Roz FM'}`;
      } else if (story && story.title) {
        subTitle = story.title;
        pageTitle = `${story.title} - Roz FM`;
        metaTitle = `${story.title} | Roz FM`;
      }

      const description = (episode && episode.description)
        ? episode.description.replace(/\s+/g, ' ').trim().slice(0, 180)
        : (story && story.description
            ? story.description.replace(/\s+/g, ' ').trim().slice(0, 180)
            : 'Listen to this exciting audio story episode exclusively on Roz FM.');

      const coverImage = resolveUrl(
        (episode && episode.cover_image_path) || (story && (story.cover_image_path || story.banner_image_path)),
        host,
        protocol
      );

      const author = story && story.author_name ? story.author_name : 'Roz FM Originals';
      const category = episode && episode.episode_number
        ? `Episode ${episode.episode_number}`
        : (story && story.category_name ? story.category_name : 'Audio Episode');

      const actualEpId = episode ? episode.id : episodeParam;
      const actualStoryId = story ? story.id : (storyIdFromQuery || '');
      const intentPath = `episodes/${encodeURIComponent(actualEpId)}${actualStoryId ? `?story_id=${encodeURIComponent(actualStoryId)}` : ''}`;

      const html = buildLandingHtml({
        pageTitle: `${pageTitle} - Roz FM`,
        metaTitle: metaTitle,
        metaDescription: description,
        canonicalUrl: currentUrl,
        coverImage: coverImage,
        badgeText: badgeText,
        subTitle: subTitle,
        author: author,
        category: category,
        intentPath: intentPath,
        contentType: 'episode'
      });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    } catch (err) {
      console.error('[StoryWebController] Episode render error:', err);
      return res.redirect(PLAY_STORE_URL);
    }
  }
}

module.exports = StoryWebController;
