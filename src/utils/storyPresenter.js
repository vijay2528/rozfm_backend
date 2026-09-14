const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';

function resolveUrl(pathStr) {
  if (!pathStr) return null;
  if (pathStr.startsWith('http://') || pathStr.startsWith('https://')) {
    return pathStr;
  }
  return `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${pathStr.replace(/^\//, '')}`;
}

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

function formatDuration(seconds) {
  const sec = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const remSec = sec % 60;

  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${remSec}s`;
  }
  return `${remSec}s`;
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatRemainingTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s === 0) return '0s remaining';
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins}m remaining`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s remaining`;
  }
  return `${secs}s remaining`;
}

function toEpisodeFieldsArray(episode, storyTitle = null, isUnlocked = true, progressData = null) {
  const durationMins = episode.duration_minutes !== null && episode.duration_minutes !== undefined
    ? Number(episode.duration_minutes)
    : (episode.duration_seconds ? Number((episode.duration_seconds / 60).toFixed(2)) : null);

  const hasAudio = Boolean(episode.audio_path);
  const audioUrl = resolveUrl(episode.audio_path);
  const coinVal = episode.coins !== null && episode.coins !== undefined ? Number(episode.coins) : 25;
  const storyImageUrl = resolveUrl(episode.story_cover_image_path || episode.cover_image_path || episode.story_image || episode.cover_image);

  const isUnl = Boolean(isUnlocked || !episode.is_premium);
  const isSched = episode.publish_as === 'schedule_for_later' || (episode.scheduled_at && new Date(episode.scheduled_at) > new Date());
  const isDownAllowed = episode.is_downloadable !== undefined && episode.is_downloadable !== null
    ? Boolean(Number(episode.is_downloadable))
    : true;
  const isDown = hasAudio && isDownAllowed && isUnl;

  const totalDurationSecs = Number(episode.duration_seconds || (progressData ? progressData.total_duration_seconds : 0) || 0);
  const progressSecs = progressData ? Number(progressData.progress_seconds || 0) : 0;
  const remainingSecs = Math.max(0, totalDurationSecs - progressSecs);

  let completionPct = 0;
  if (progressData && progressData.completion_percentage !== undefined && progressData.completion_percentage !== null) {
    completionPct = Number(progressData.completion_percentage);
  } else if (totalDurationSecs > 0) {
    completionPct = parseFloat(((progressSecs / totalDurationSecs) * 100).toFixed(2));
    if (completionPct > 100) completionPct = 100;
  }

  const isComp = progressData ? Boolean(progressData.completed || completionPct >= 90) : false;
  const isLastW = progressData ? Boolean(progressData.is_last_watched) : false;
  let statusStr = 'unwatched';
  if (isComp) {
    statusStr = 'completed';
  } else if (progressData && (progressData.status || progressSecs > 0)) {
    statusStr = progressData.status || 'playing';
  }

  const lastWatchedAtStr = progressData && progressData.last_watched_at ? new Date(progressData.last_watched_at).toISOString() : null;

  return {
    episode_id: Number(episode.id),
    story_id: Number(episode.story_id),
    created_by: episode.created_by ? Number(episode.created_by) : null,
    story_title: storyTitle || episode.story_title || null,
    story_image: storyImageUrl,
    story_cover_image: storyImageUrl,
    cover_image: storyImageUrl,
    episode_no: Number(episode.position || 1),
    title: episode.title,
    audio_title: episode.audio_title || episode.title,
    description: episode.description || null,
    publish_as: episode.publish_as || 'publish_now',
    scheduled_at: episode.scheduled_at || null,
    duration_seconds: totalDurationSecs,
    duration_formatted: formatTime(totalDurationSecs),
    duration_minutes: durationMins,
    type: episode.is_premium ? 'premium' : 'free',
    coins: coinVal,
    is_premium: Boolean(episode.is_premium),
    is_unlocked: isUnl,
    is_scheduled: Boolean(isSched),
    is_downloadable: Boolean(isDown),
    audio_file: audioUrl,
    audio_status: hasAudio ? 'uploaded' : 'missing',
    published_date: episode.published_at || episode.created_at,
    plays: Number(episode.plays_count || 0),

    // Playback Progress & Resume Fields
    progress_seconds: progressSecs,
    progress_formatted: formatTime(progressSecs),
    remaining_seconds: remainingSecs,
    remaining_formatted: formatRemainingTime(remainingSecs),
    completion_percentage: completionPct,
    is_completed: isComp,
    is_last_watched: isLastW,
    playback_status: statusStr,
    last_watched_at: lastWatchedAtStr,
    progress: {
      progress_seconds: progressSecs,
      progress_formatted: formatTime(progressSecs),
      total_duration_seconds: totalDurationSecs,
      total_duration_formatted: formatTime(totalDurationSecs),
      remaining_seconds: remainingSecs,
      remaining_formatted: formatRemainingTime(remainingSecs),
      completion_percentage: completionPct,
      status: statusStr,
      is_completed: isComp,
      is_last_watched: isLastW,
      last_watched_at: lastWatchedAtStr,
    },
  };
}

function toStoryFieldsArray(story, options = {}) {
  const {
    isLiked = false,
    isBookmarked = false,
    episodes = null,
    lastPlayedEpisode = null,
    userUnlockedEpisodeIds = new Set(),
    hasActiveMembership = false,
    performance = null,
    completionRate = null,
    avgListeningTime = null,
    watchHistory = null,
  } = options;

  const coverUrl = resolveUrl(story.cover_image_path);
  const bannerUrl = resolveUrl(story.banner_image_path);

  const totalViews = Math.max(Number(story.total_views || 0), Number(story.real_plays_count || 0));
  const totalEpisodes = story.real_episodes_count !== undefined && story.real_episodes_count !== null
    ? Number(story.real_episodes_count)
    : Number(story.episodes_count || 0);

  const listenersCount = Number(story.listeners_count || 0);
  const likesCount = Number(story.likes_count || 0);
  const sharesCount = Number(story.shares_count || 0);

  const statusStr = story.status || null;
  const isLive = statusStr ? ['published', 'ongoing', 'completed', 'live'].includes(String(statusStr).toLowerCase()) : false;

  const performanceObj = performance || {
    plays: {
      count: totalViews,
      formatted: formatNumber(totalViews),
      growth: '0%',
    },
    listeners: {
      count: listenersCount,
      formatted: formatNumber(listenersCount),
      growth: '0%',
    },
    likes: {
      count: likesCount,
      formatted: formatNumber(likesCount),
      growth: '0%',
    },
    shares: {
      count: sharesCount,
      formatted: formatNumber(sharesCount),
      growth: '0%',
    },
  };

  const compRateVal = completionRate !== null && completionRate !== undefined
    ? Number(completionRate)
    : Number(story.completion_rate || 0);

  const completionRateObj = {
    rate: compRateVal,
    formatted: `${compRateVal}%`,
  };

  const avgSecsVal = avgListeningTime !== null && avgListeningTime !== undefined
    ? Number(avgListeningTime)
    : Number(story.avg_listening_time || 0);

  const avgListeningTimeObj = {
    seconds: avgSecsVal,
    formatted: formatDuration(avgSecsVal),
  };

  const progressSecs = watchHistory ? Number(watchHistory.progress_seconds || 0) : 0;
  const totalDurationSecs = watchHistory ? Number(watchHistory.total_duration_seconds || 0) : 0;
  const remainingSecs = Math.max(0, totalDurationSecs - progressSecs);
  const completionPct = watchHistory ? Number(watchHistory.completion_percentage || 0) : 0;
  const avgProgressPct = watchHistory ? Number(watchHistory.average_progress_percentage || completionPct || 0) : 0;

  const data = {
    story_id: Number(story.id),
    title: story.title,
    description: story.description || null,
    cover_image: coverUrl,
    banner_image: bannerUrl,
    category: story.category_name || story.genre || null,
    genre: story.category_name || story.genre || null,
    author: story.author_name || story.author || null,
    author_id: Number(story.user_id || 0),
    language: story.language || 'en',
    tags: story.tags || null,
    total_episodes: totalEpisodes,
    episodes_count: totalEpisodes,
    real_episodes_count: totalEpisodes,
    listeners: listenersCount,
    total_views: totalViews,
    play_count: totalViews,
    plays_count: totalViews,
    status: statusStr,
    release_status: story.release_status || null,
    release: story.release_status || null,
    is_live: isLive,
    rating: Number(story.rating || 0.0),
    is_premium: Boolean(story.is_premium),
    likes_count: likesCount,
    shares_count: sharesCount,
    is_liked: Boolean(isLiked),
    is_bookmarked: Boolean(isBookmarked),
    performance: performanceObj,
    completion_rate: completionRateObj,
    avg_listening_time: avgListeningTimeObj,
    created_at: story.created_at,
  };

  if (watchHistory) {
    data.progress_seconds = progressSecs;
    data.progress_formatted = formatTime(progressSecs);
    data.total_duration_seconds = totalDurationSecs;
    data.total_duration_formatted = formatTime(totalDurationSecs);
    data.remaining_seconds = remainingSecs;
    data.remaining_formatted = formatRemainingTime(remainingSecs);
    data.completion_percentage = completionPct;
    data.progress_percentage = completionPct;
    data.average_progress_percentage = avgProgressPct;
    data.last_watched_episode_id = watchHistory.episode_id || null;
    data.last_watched_episode_no = watchHistory.episode_no || null;
    data.last_watched_episode_title = watchHistory.episode_title || null;
    data.last_watched_at = watchHistory.last_watched_at || null;
  }

  if (lastPlayedEpisode) {
    data.last_played_episode = lastPlayedEpisode;
    data.current_playing_episode = lastPlayedEpisode;
  }

  if (Array.isArray(episodes)) {
    data.episodes = episodes.map((ep) =>
      toEpisodeFieldsArray(ep, story.title, !ep.is_premium || hasActiveMembership || userUnlockedEpisodeIds.has(Number(ep.id)) || userUnlockedEpisodeIds.has(String(ep.id)))
    );
  }

  return data;
}

module.exports = {
  resolveUrl,
  formatNumber,
  formatDuration,
  formatTime,
  formatRemainingTime,
  toStoryFieldsArray,
  toEpisodeFieldsArray,
};
