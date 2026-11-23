const { pool } = require('../config/db');
const path = require('path');
const fs = require('fs');
const StoryController = require('./storyController');

const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';
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

      // 2. Prepare metadata with graceful fallback
      const title = story && story.title ? story.title : 'Roz FM - Audio Stories';
      const description = story && story.description
        ? story.description.replace(/\s+/g, ' ').trim().slice(0, 180)
        : 'Your next favourite story is waiting. Discover exciting audio stories and series on Roz FM.';
      const coverImage = resolveUrl(story ? (story.cover_image_path || story.banner_image_path) : null, host, protocol);
      const author = story && story.author_name ? story.author_name : 'Roz FM Originals';
      const category = story && story.category_name ? story.category_name : 'Audio Series';
      const actualId = story ? story.id : storyId;

      // 3. Render HTML
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#100b1d">
    <title>${escapeHtml(title)} - Roz FM</title>
    <meta name="description" content="${escapeHtml(description)}">

    <!-- Open Graph / WhatsApp / Facebook / Telegram Meta Tags -->
    <meta property="og:type" content="music.song">
    <meta property="og:site_name" content="Roz FM">
    <meta property="og:url" content="${escapeHtml(currentUrl)}">
    <meta property="og:title" content="${escapeHtml(title)} | Roz FM">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${escapeHtml(coverImage)}">
    <meta property="og:image:secure_url" content="${escapeHtml(coverImage)}">
    <meta property="og:image:width" content="600">
    <meta property="og:image:height" content="600">
    <meta property="og:image:type" content="image/jpeg">

    <!-- Twitter Card Meta Tags -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)} | Roz FM">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${escapeHtml(coverImage)}">

    <!-- App Links for Android -->
    <meta property="al:android:url" content="rozfm://stories/${escapeHtml(actualId)}">
    <meta property="al:android:package" content="com.rozfm">
    <meta property="al:android:app_name" content="Roz FM">

    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            min-height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Arial, sans-serif;
            color: #fff;
            background:
                radial-gradient(ellipse at 50% 10%, #51247a 0%, transparent 55%),
                linear-gradient(145deg, #100b1d, #1b1030 58%, #090711);
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 24px 16px;
            overflow-x: hidden;
        }

        .glow {
            position: fixed;
            width: 320px;
            height: 320px;
            border-radius: 50%;
            filter: blur(110px);
            opacity: .32;
            pointer-events: none;
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
            animation: appear .6s ease;
        }

        @keyframes appear {
            from {
                opacity: 0;
                transform: translateY(18px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .top-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 14px;
            margin-bottom: 20px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            background: rgba(255, 255, 255, 0.06);
            backdrop-filter: blur(10px);
            border-radius: 30px;
            font-size: 12px;
            font-weight: 600;
            color: #e9d5ff;
            letter-spacing: 0.5px;
        }

        .top-badge img {
            width: 18px;
            height: 18px;
            border-radius: 4px;
        }

        .cover-card {
            position: relative;
            width: 170px;
            height: 235px;
            margin: 0 auto 22px;
            border-radius: 20px;
            padding: 3px;
            background: linear-gradient(135deg, #f0abfc, #a855f7, #6366f1);
            box-shadow: 0 16px 45px rgba(168, 85, 247, 0.38);
        }

        .cover-inner {
            width: 100%;
            height: 100%;
            border-radius: 17px;
            overflow: hidden;
            background: #1c142c;
        }

        .cover-inner img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }

        h1 {
            font-size: 26px;
            font-weight: 800;
            line-height: 1.25;
            letter-spacing: -0.5px;
            margin-bottom: 8px;
            color: #ffffff;
            text-shadow: 0 2px 10px rgba(0,0,0,0.4);
        }

        .meta {
            font-size: 13px;
            color: #c084fc;
            font-weight: 600;
            margin-bottom: 12px;
        }

        .tagline {
            font-size: 14px;
            line-height: 1.6;
            color: #d1c3e0;
            margin-bottom: 24px;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .features {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-bottom: 26px;
        }

        .feature {
            padding: 12px 6px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.05);
            border-radius: 14px;
            backdrop-filter: blur(12px);
        }

        .feature-icon {
            display: block;
            font-size: 22px;
            margin-bottom: 6px;
        }

        .feature p {
            font-size: 11px;
            color: #e1d6ed;
            font-weight: 500;
        }

        .play-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            width: 100%;
            min-height: 56px;
            padding: 16px 20px;
            border-radius: 16px;
            text-decoration: none;
            color: white;
            font-size: 16px;
            font-weight: 800;
            background: linear-gradient(100deg, #9333ea, #c026d3, #ec4899);
            box-shadow: 0 12px 34px rgba(168, 85, 247, 0.45);
            transition: transform .2s, box-shadow .2s;
        }

        .play-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 16px 42px rgba(168, 85, 247, 0.65);
        }

        .play-icon {
            width: 24px;
            height: 24px;
            flex-shrink: 0;
        }

        .status {
            margin-top: 18px;
            min-height: 20px;
            color: #c0b1d1;
            font-size: 12px;
        }

        .spinner {
            display: inline-block;
            width: 14px;
            height: 14px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-top-color: #e9b5ff;
            border-radius: 50%;
            vertical-align: -2px;
            margin-right: 6px;
            animation: spin .8s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .footer {
            margin-top: 26px;
            color: #89799d;
            font-size: 11px;
        }

        @media(max-width:360px) {
            h1 { font-size: 22px; }
            .cover-card { width: 140px; height: 195px; }
        }
    </style>
</head>
<body>
    <div class="glow one"></div>
    <div class="glow two"></div>

    <main class="container">
        <div class="top-badge">
            <img src="/logo.png" alt="Roz FM" onerror="this.style.display='none'">
            <span>ROZ FM EXCLUSIVE</span>
        </div>

        <div class="cover-card">
            <div class="cover-inner">
                <img src="${escapeHtml(coverImage)}" alt="${escapeHtml(title)}" onerror="this.src='/logo.png'">
            </div>
        </div>

        <h1>${escapeHtml(title)}</h1>
        <div class="meta">${escapeHtml(author)} • ${escapeHtml(category)}</div>

        <p class="tagline">${escapeHtml(description)}</p>

        <div class="features">
            <div class="feature">
                <span class="feature-icon">🎧</span>
                <p>Audio Story</p>
            </div>
            <div class="feature">
                <span class="feature-icon">🎙️</span>
                <p>Voice Cast</p>
            </div>
            <div class="feature">
                <span class="feature-icon">⭐</span>
                <p>Top Series</p>
            </div>
        </div>

        <a class="play-btn" id="downloadBtn" href="${PLAY_STORE_URL}" target="_blank" rel="noopener noreferrer">
            <svg class="play-icon" viewBox="0 0 24 24" fill="white">
                <path d="M3.5 2.8v18.4L14 12 3.5 2.8z"/>
                <path d="M15.1 11l2.7-2.7-11-6.1 8.3 8.8z"/>
                <path d="M15.1 13l2.7 2.7-11 6.1 8.3-8.8z"/>
            </svg>
            Get it on Google Play
        </a>

        <div class="status" id="status">
            <span class="spinner"></span>
            Opening story in Roz FM App...
        </div>

        <div class="footer">
            &copy; 2026 Roz FM. All rights reserved.
        </div>
    </main>

    <script>
        (function () {
            const PLAY_STORE_URL = "${PLAY_STORE_URL}";
            const STORY_ID = "${escapeHtml(actualId)}";
            const params = new URLSearchParams(window.location.search);
            const status = document.getElementById("status");

            // Allow manual inspection without triggering redirect
            if (params.get("preview") === "1" || params.get("noredirect") === "1") {
                if (status) status.innerHTML = "Roz FM App Preview Mode";
                return;
            }

            const isAndroid = /Android/i.test(navigator.userAgent);
            const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

            // On Android, attempt to trigger deep link into the installed app
            if (isAndroid) {
                const intentUrl = "intent://stories/" + encodeURIComponent(STORY_ID) +
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

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    } catch (err) {
      console.error('[StoryWebController] Render error:', err);
      return res.redirect(PLAY_STORE_URL);
    }
  }
}

module.exports = StoryWebController;
