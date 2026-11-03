// FlixParty - Universal Player Bridge (Runs in MAIN World)
// Supports Netflix, YouTube, and HTML5 video platforms

(function () {
  if (window.__FLIXPARTY_BRIDGE_INITIALIZED__) return;
  window.__FLIXPARTY_BRIDGE_INITIALIZED__ = true;

  const isYouTube = window.location.hostname.includes('youtube.com');
  const isNetflix = window.location.hostname.includes('netflix.com');

  console.log(`[FlixParty Bridge] Initialized in MAIN world (${isYouTube ? 'YouTube' : isNetflix ? 'Netflix' : 'Generic Web'})`);

  const BRIDGE_SOURCE = 'FLIXPARTY_BRIDGE';

  let isApplyingRemoteAction = false;
  let remoteActionTimestamp = 0;
  let lastKnownState = {
    isPlaying: false,
    timeMs: 0,
    durationMs: 0,
    isBuffering: false
  };

  // Helper: YouTube player
  function getYouTubePlayer() {
    return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  }

  // Helper: Netflix player instance from React CAD
  function getNetflixPlayer() {
    try {
      const api = window.netflix?.appContext?.state?.playerApp?.getAPI()?.videoPlayer;
      if (!api) return null;

      const sessionIds = api.getAllPlayerSessionIds();
      if (!sessionIds || sessionIds.length === 0) return null;

      for (const id of sessionIds) {
        const p = api.getVideoPlayerBySessionId(id);
        if (p && typeof p.getCurrentTime === 'function' && p.getDuration() > 0) {
          return p;
        }
      }
      return api.getVideoPlayerBySessionId(sessionIds[sessionIds.length - 1]);
    } catch (e) {
      return null;
    }
  }

  // Helper: HTML5 <video> element
  function getVideoElement() {
    if (isYouTube) {
      return document.querySelector('video.video-stream') || document.querySelector('video');
    }
    return document.querySelector('video');
  }

  // Extract current player state across platforms
  function getCurrentState() {
    let isPlaying = false;
    let timeMs = 0;
    let durationMs = 0;
    let isBuffering = false;

    if (isYouTube) {
      const yt = getYouTubePlayer();
      const video = getVideoElement();

      if (yt && typeof yt.getCurrentTime === 'function') {
        timeMs = Math.floor(yt.getCurrentTime() * 1000);
        durationMs = Math.floor((yt.getDuration() || 0) * 1000);
        const playerState = typeof yt.getPlayerState === 'function' ? yt.getPlayerState() : -1;
        isPlaying = (playerState === 1);
        isBuffering = (playerState === 3);
      } else if (video) {
        timeMs = Math.floor(video.currentTime * 1000);
        durationMs = Math.floor((video.duration || 0) * 1000);
        isPlaying = !video.paused && !video.ended && video.readyState > 2;
        isBuffering = video.readyState < 3;
      }
    } else if (isNetflix) {
      const player = getNetflixPlayer();
      const video = getVideoElement();

      if (player) {
        try {
          timeMs = Math.floor(player.getCurrentTime());
          durationMs = Math.floor(player.getDuration());
          isPlaying = player.isPlaying();
          isBuffering = typeof player.getBusy === 'function' ? player.getBusy() : false;
        } catch (e) {}
      }

      if (!player && video) {
        timeMs = Math.floor(video.currentTime * 1000);
        durationMs = Math.floor((video.duration || 0) * 1000);
        isPlaying = !video.paused && !video.ended && video.readyState > 2;
        isBuffering = video.readyState < 3;
      }
    } else {
      const video = getVideoElement();
      if (video) {
        timeMs = Math.floor(video.currentTime * 1000);
        durationMs = Math.floor((video.duration || 0) * 1000);
        isPlaying = !video.paused && !video.ended && video.readyState > 2;
        isBuffering = video.readyState < 3;
      }
    }

    return { isPlaying, timeMs, durationMs, isBuffering };
  }

  // Broadcast state changes to isolated content script
  function broadcastState(eventType, extra = {}) {
    const state = getCurrentState();
    lastKnownState = state;

    window.postMessage({
      source: BRIDGE_SOURCE,
      type: 'PLAYER_EVENT',
      eventType,
      state,
      isRemoteOriginated: isApplyingRemoteAction || (Date.now() - remoteActionTimestamp < 600),
      timestamp: Date.now(),
      ...extra
    }, '*');
  }

  // Execute Play
  function executePlay() {
    if (isYouTube) {
      const yt = getYouTubePlayer();
      if (yt && typeof yt.playVideo === 'function') {
        yt.playVideo();
        return;
      }
    }

    const player = getNetflixPlayer();
    const video = getVideoElement();

    if (player && typeof player.play === 'function') {
      player.play();
    } else if (video) {
      video.play().catch(() => {
        simulateKey(32, 'Space');
      });
    }
  }

  // Execute Pause
  function executePause() {
    if (isYouTube) {
      const yt = getYouTubePlayer();
      if (yt && typeof yt.pauseVideo === 'function') {
        yt.pauseVideo();
        return;
      }
    }

    const player = getNetflixPlayer();
    const video = getVideoElement();

    if (player && typeof player.pause === 'function') {
      player.pause();
    } else if (video) {
      video.pause();
    } else {
      simulateKey(32, 'Space');
    }
  }

  // Execute Seek
  function executeSeek(targetTimeMs) {
    if (isYouTube) {
      const yt = getYouTubePlayer();
      if (yt && typeof yt.seekTo === 'function') {
        yt.seekTo(targetTimeMs / 1000, true);
        return;
      }
    }

    const player = getNetflixPlayer();
    const video = getVideoElement();

    if (player && typeof player.seek === 'function') {
      player.seek(targetTimeMs);
    } else if (video) {
      video.currentTime = targetTimeMs / 1000;
    }
  }

  // Keyboard simulator fallback
  function simulateKey(keyCode, code) {
    const target = document.querySelector('.watch-video--player-view') ||
                   document.querySelector('#movie_player') ||
                   document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, keyCode, code }));
    target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, keyCode, code }));
  }

  // Listen for control commands sent from FlixParty content script
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.target !== BRIDGE_SOURCE) {
      return;
    }

    const { action, timeMs } = event.data;
    console.log('[FlixParty Bridge] Received remote action:', action, timeMs);

    isApplyingRemoteAction = true;
    remoteActionTimestamp = Date.now();

    try {
      switch (action) {
        case 'PLAY':
          if (typeof timeMs === 'number' && timeMs > 0) {
            const current = getCurrentState();
            if (Math.abs(current.timeMs - timeMs) > 1000) {
              executeSeek(timeMs);
            }
          }
          executePlay();
          break;

        case 'PAUSE':
          if (typeof timeMs === 'number' && timeMs > 0) {
            executeSeek(timeMs);
          }
          executePause();
          break;

        case 'SEEK':
          if (typeof timeMs === 'number') {
            executeSeek(timeMs);
          }
          break;

        case 'SYNC_ALIGN':
          if (typeof timeMs === 'number') {
            executeSeek(timeMs);
          }
          if (event.data.isPlaying) {
            executePlay();
          } else {
            executePause();
          }
          break;

        case 'GET_STATE':
          broadcastState('CURRENT_STATE_REPLY');
          break;
      }
    } catch (err) {
      console.error('[FlixParty Bridge] Error executing action:', err);
    }

    setTimeout(() => {
      isApplyingRemoteAction = false;
    }, 500);
  });

  // Attach DOM video event listeners
  let currentVideoEl = null;

  function attachVideoListeners() {
    const video = getVideoElement();
    if (!video || video === currentVideoEl) return;

    currentVideoEl = video;
    console.log('[FlixParty Bridge] Attached to video element');

    video.addEventListener('play', () => broadcastState('PLAY'));
    video.addEventListener('pause', () => broadcastState('PAUSE'));
    video.addEventListener('seeking', () => broadcastState('SEEKING'));
    video.addEventListener('seeked', () => broadcastState('SEEKED'));
  }

  // Detect YouTube video navigation (SPA changes)
  let lastRecordedUrl = window.location.href;
  function detectUrlChange() {
    if (window.location.href !== lastRecordedUrl) {
      lastRecordedUrl = window.location.href;
      broadcastState('NAVIGATED', { url: window.location.href });
    }
  }

  window.addEventListener('yt-navigate-finish', detectUrlChange);
  window.addEventListener('popstate', detectUrlChange);

  // Polling loop for state sync
  setInterval(() => {
    attachVideoListeners();
    detectUrlChange();

    const currentState = getCurrentState();

    if (currentState.isPlaying !== lastKnownState.isPlaying) {
      broadcastState(currentState.isPlaying ? 'PLAY' : 'PAUSE');
    }

    const timeDelta = Math.abs(currentState.timeMs - (lastKnownState.timeMs + 350));
    if (currentState.isPlaying && lastKnownState.isPlaying && timeDelta > 2000) {
      broadcastState('SEEKED', { jumped: true });
    }

    lastKnownState = currentState;
  }, 350);

  // Announce bridge readiness
  window.postMessage({
    source: BRIDGE_SOURCE,
    type: 'BRIDGE_READY',
    timestamp: Date.now()
  }, '*');
})();
