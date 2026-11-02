// FlixParty - Netflix Bridge (Runs in MAIN World)
// Provides direct access to Netflix Video Player API and HTML5 <video> fallback

(function () {
  if (window.__FLIXPARTY_BRIDGE_INITIALIZED__) return;
  window.__FLIXPARTY_BRIDGE_INITIALIZED__ = true;
  console.log('[FlixParty Bridge] Initialized in MAIN world');

  const BRIDGE_SOURCE = 'FLIXPARTY_BRIDGE';
  const CONTENT_TARGET = 'FLIXPARTY_CONTENT';

  let isApplyingRemoteAction = false;
  let remoteActionTimestamp = 0;
  let lastKnownState = {
    isPlaying: false,
    timeMs: 0,
    durationMs: 0,
    isBuffering: false
  };

  // Helper to extract the active video player instance from Netflix's React state
  function getNetflixPlayer() {
    try {
      const api = window.netflix?.appContext?.state?.playerApp?.getAPI()?.videoPlayer;
      if (!api) return null;

      const sessionIds = api.getAllPlayerSessionIds();
      if (!sessionIds || sessionIds.length === 0) return null;

      // Find the player session with active duration
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

  // Fallback to native HTML5 <video> tag
  function getVideoElement() {
    return document.querySelector('video');
  }

  // Get current player state
  function getCurrentState() {
    const player = getNetflixPlayer();
    const video = getVideoElement();

    let isPlaying = false;
    let timeMs = 0;
    let durationMs = 0;
    let isBuffering = false;

    if (player) {
      try {
        timeMs = Math.floor(player.getCurrentTime());
        durationMs = Math.floor(player.getDuration());
        isPlaying = player.isPlaying();
        isBuffering = typeof player.getBusy === 'function' ? player.getBusy() : false;
      } catch (e) {
        // Fallback to video element below
      }
    }

    if (!player && video) {
      timeMs = Math.floor(video.currentTime * 1000);
      durationMs = Math.floor((video.duration || 0) * 1000);
      isPlaying = !video.paused && !video.ended && video.readyState > 2;
      isBuffering = video.readyState < 3;
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
    const player = getNetflixPlayer();
    const video = getVideoElement();

    if (player && typeof player.play === 'function') {
      player.play();
    } else if (video) {
      video.play().catch(() => {
        // Fallback simulate spacebar click on player
        simulateKey(32, 'Space');
      });
    }
  }

  // Execute Pause
  function executePause() {
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
    const player = getNetflixPlayer();
    const video = getVideoElement();

    if (player && typeof player.seek === 'function') {
      player.seek(targetTimeMs);
    } else if (video) {
      video.currentTime = targetTimeMs / 1000;
    }
  }

  // Keyboard event simulator for fallback
  function simulateKey(keyCode, code) {
    const target = document.querySelector('.watch-video--player-view') || document.body;
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
          executePlay();
          break;

        case 'PAUSE':
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

    // Release lock after Netflix processes the event
    setTimeout(() => {
      isApplyingRemoteAction = false;
    }, 500);
  });

  // Attach DOM video event listeners to catch user actions
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

  // Regular health check and polling
  setInterval(() => {
    attachVideoListeners();

    const currentState = getCurrentState();
    // Check if playback state changed without video event
    if (currentState.isPlaying !== lastKnownState.isPlaying) {
      broadcastState(currentState.isPlaying ? 'PLAY' : 'PAUSE');
    }

    // Check for seek jump (> 1.8 seconds discrepancy during normal playback)
    const timeDelta = Math.abs(currentState.timeMs - (lastKnownState.timeMs + 350));
    if (currentState.isPlaying && lastKnownState.isPlaying && timeDelta > 2000) {
      broadcastState('SEEKED', { jumped: true });
    }

    lastKnownState = currentState;
  }, 350);

  // Initial announcement that bridge is ready
  window.postMessage({
    source: BRIDGE_SOURCE,
    type: 'BRIDGE_READY',
    timestamp: Date.now()
  }, '*');
})();
