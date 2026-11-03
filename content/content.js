// FlixParty - Main Content Script (Isolated World)
// Coordinates Netflix Bridge, WebRTC Manager, and In-Page Sidebar

(function () {
  console.log('[FlixParty Content] Injected on Netflix');

  let webrtcManager = null;
  let sidebar = null;
  let isPartyActive = false;
  let currentRoomId = null;
  let isHost = false;
  let controlMode = 'everyone'; // 'everyone' | 'host_only'
  let username = 'Friend';
  let serverUrl = 'ws://localhost:3000';

  let localPlayerState = {
    isPlaying: false,
    timeMs: 0,
    durationMs: 0
  };

  let lastRemoteSyncTimestamp = 0;
  let syncHeartbeatInterval = null;

  // Load preferences from chrome.storage.local
  async function loadSettings() {
    const data = await chrome.storage.local.get(['username', 'serverUrl', 'controlMode', 'currentRoomId', 'partyActive', 'isHost']);
    if (data.username) username = data.username;
    if (data.serverUrl) serverUrl = data.serverUrl;
    if (data.controlMode) controlMode = data.controlMode;

    // Check if URL contains ?flixparty=ROOM_ID (for one-click invite links!)
    const urlParams = new URLSearchParams(window.location.search);
    const inviteRoom = urlParams.get('flixparty');
    if (inviteRoom && !isPartyActive) {
      setTimeout(() => {
        joinParty(inviteRoom);
      }, 1500);
    }
  }

  loadSettings();

  // Listen for settings changes (e.g. server URL updated in options)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.serverUrl && changes.serverUrl.newValue) {
        serverUrl = changes.serverUrl.newValue;
        console.log('[FlixParty] Server URL updated to:', serverUrl);
        if (webrtcManager) {
          webrtcManager.serverUrl = serverUrl;
          if (isPartyActive && currentRoomId) {
            sidebar?.addSystemLog(`Connecting to updated server: ${serverUrl}`);
            webrtcManager.connectToSignaling(currentRoomId, isHost);
          }
        }
      }
      if (changes.username && changes.username.newValue) {
        username = changes.username.newValue;
      }
    }
  });

  // Initialize or start a party
  async function startParty(roomId = null, hostStatus = true) {
    const targetRoom = (roomId ? roomId.trim() : null);

    if (isPartyActive && currentRoomId === targetRoom && sidebar) {
      sidebar.setCollapsed(false);
      return;
    }

    if (isPartyActive) {
      leaveParty();
    }

    isHost = hostStatus;
    currentRoomId = targetRoom || 'FLIX-' + Math.floor(1000 + Math.random() * 9000);
    isPartyActive = true;

    // Create Sidebar UI
    sidebar = new FlixPartySidebar({
      roomId: currentRoomId,
      isHost,
      controlMode,
      onSendMessage: (text) => {
        if (webrtcManager) {
          webrtcManager.sendData({
            type: 'CHAT',
            text,
            username
          });
        }
      },
      onToggleMic: () => {
        return webrtcManager ? webrtcManager.toggleAudio() : false;
      },
      onToggleVideo: () => {
        return webrtcManager ? webrtcManager.toggleVideo() : false;
      },
      onForceSync: () => {
        requestForceSync();
      },
      onControlModeChange: (mode) => {
        controlMode = mode;
        if (webrtcManager) {
          webrtcManager.sendData({
            type: 'SET_CONTROL_MODE',
            mode
          });
        }
      },
      onLeaveParty: () => {
        leaveParty();
      }
    });

    // Initialize WebRTC Manager
    webrtcManager = new FlixWebRTCManager({
      username,
      isHost,
      serverUrl
    });

    // Wire WebRTC callbacks to Sidebar UI and Sync Engine
    webrtcManager.setCallback('onConnectionState', (state) => {
      if (!sidebar) return;
      sidebar.setConnectionStatus(state);
      if (state === 'peer_joined') {
        sidebar.addSystemLog('🍿 Friend is connecting...');
      } else if (state === 'connected') {
        sidebar.addSystemLog('✅ P2P connected! Zero-lag sync active.');
      } else if (state === 'peer_left') {
        sidebar.addSystemLog('👋 Friend left the party.');
      }
    });

    webrtcManager.setCallback('onLocalStream', (stream) => {
      if (sidebar) sidebar.setLocalStream(stream);
    });

    webrtcManager.setCallback('onRemoteStream', (stream) => {
      if (sidebar) sidebar.setRemoteStream(stream);
    });

    webrtcManager.setCallback('onVoiceActivity', (peer, isSpeaking) => {
      if (sidebar) sidebar.setSpeaking(peer, isSpeaking);
    });

    webrtcManager.setCallback('onDataMessage', (data) => {
      handleRemoteDataMessage(data);
    });

    webrtcManager.setCallback('onLog', (msg) => {
      console.log('[FlixParty Log]', msg);
    });

    // Connect to Signaling server immediately
    webrtcManager.connectToSignaling(currentRoomId, isHost);

    // Request camera and microphone asynchronously (non-blocking)
    webrtcManager.initMedia(true, true).catch(err => {
      console.warn('[FlixParty] Media init note:', err);
    });

    // Notify service worker
    chrome.runtime.sendMessage({
      type: 'PARTY_STARTED',
      roomId: currentRoomId,
      isHost
    });

    // Request initial player state from bridge
    window.postMessage({ target: 'FLIXPARTY_BRIDGE', action: 'GET_STATE' }, '*');

    // Start Heartbeat sync
    startHeartbeatSync();

    sidebar.addSystemLog(`🎬 Party room ${currentRoomId} ready! Share room code with friends.`);
  }

  // Join an existing party
  async function joinParty(roomId) {
    if (!roomId) return;
    await startParty(roomId.trim(), false);
  }

  // Leave active party
  function leaveParty() {
    if (syncHeartbeatInterval) {
      clearInterval(syncHeartbeatInterval);
      syncHeartbeatInterval = null;
    }

    if (webrtcManager) {
      webrtcManager.disconnect();
      webrtcManager = null;
    }

    if (sidebar) {
      sidebar.destroy();
      sidebar = null;
    }

    isPartyActive = false;
    currentRoomId = null;

    chrome.runtime.sendMessage({ type: 'PARTY_LEFT' });
  }

  // Heartbeat to detect and eliminate any playback drift (> 1.2s)
  function startHeartbeatSync() {
    if (syncHeartbeatInterval) clearInterval(syncHeartbeatInterval);

    syncHeartbeatInterval = setInterval(() => {
      if (!isPartyActive || !webrtcManager || !webrtcManager.isConnected) return;

      // Host sends heartbeat sync ticks
      if (isHost) {
        webrtcManager.sendData({
          type: 'SYNC_HEARTBEAT',
          timeMs: localPlayerState.timeMs,
          isPlaying: localPlayerState.isPlaying,
          timestamp: Date.now()
        });
      }
    }, 2000);
  }

  // Smart video comparison: checks video IDs rather than full URL query strings
  function isSameVideo(urlA, urlB) {
    if (!urlA || !urlB) return true;
    try {
      const u1 = new URL(urlA);
      const u2 = new URL(urlB);

      // YouTube: compare 'v' parameter
      if (u1.hostname.includes('youtube.com') && u2.hostname.includes('youtube.com')) {
        const v1 = u1.searchParams.get('v');
        const v2 = u2.searchParams.get('v');
        if (v1 && v2) return v1 === v2;
      }

      // Netflix: compare /watch/XXXXX ID
      if (u1.hostname.includes('netflix.com') && u2.hostname.includes('netflix.com')) {
        const getNetflixId = (p) => {
          const match = p.match(/\/watch\/(\d+)/);
          return match ? match[1] : null;
        };
        const id1 = getNetflixId(u1.pathname);
        const id2 = getNetflixId(u2.pathname);
        if (id1 && id2) return id1 === id2;
      }

      return u1.origin === u2.origin && u1.pathname === u2.pathname;
    } catch (e) {
      return true;
    }
  }

  // Handle remote WebRTC DataChannel messages
  function handleRemoteDataMessage(data) {
    switch (data.type) {
      case 'CHAT':
        if (sidebar) {
          sidebar.addChatMessage(data.username || 'Friend', data.text, false);
        }
        break;

      case 'USER_INTRO':
        if (sidebar) {
          sidebar.addSystemLog(`🍿 ${data.username || 'Friend'} joined the party!`);
          const remoteLabel = sidebar.shadow.getElementById('remoteLabel');
          if (remoteLabel) remoteLabel.textContent = data.username || 'Friend';
        }
        // If we are the host, immediately synchronize the new friend to our video & controls!
        if (isHost && webrtcManager) {
          webrtcManager.sendData({
            type: 'SET_CONTROL_MODE',
            mode: controlMode
          });
          webrtcManager.sendData({
            type: 'FORCE_SYNC_ALIGN',
            timeMs: localPlayerState.timeMs,
            isPlaying: localPlayerState.isPlaying,
            url: window.location.href
          });
        }
        break;

      case 'SYNC_PLAY':
        applyRemotePlayback('PLAY', data.timeMs);
        if (sidebar) sidebar.addSystemLog(`▶ ${data.username || 'Friend'} pressed Play`);
        break;

      case 'SYNC_PAUSE':
        applyRemotePlayback('PAUSE', data.timeMs);
        if (sidebar) sidebar.addSystemLog(`⏸ ${data.username || 'Friend'} paused at ${formatTime(data.timeMs)}`);
        break;

      case 'SYNC_SEEK':
        applyRemotePlayback('SEEK', data.timeMs);
        if (sidebar) sidebar.addSystemLog(`⏩ ${data.username || 'Friend'} jumped to ${formatTime(data.timeMs)}`);
        break;

      case 'SYNC_NAVIGATE':
        if (data.url && !isSameVideo(data.url, window.location.href)) {
          if (sidebar) sidebar.addSystemLog(`🎬 Host navigated to: ${data.url}`);
          try {
            const newUrl = new URL(data.url);
            newUrl.searchParams.set('flixparty', currentRoomId);
            window.location.href = newUrl.toString();
          } catch (e) {
            window.location.href = data.url;
          }
        }
        break;

      case 'SYNC_HEARTBEAT':
        handleHeartbeat(data);
        break;

      case 'SET_CONTROL_MODE':
        controlMode = data.mode;
        if (sidebar) {
          sidebar.controlMode = controlMode;
          const select = sidebar.shadow.getElementById('controlModeSelect');
          if (select) select.value = controlMode;
          sidebar.addSystemLog(`👑 Host set controls to: ${controlMode === 'everyone' ? 'Everyone can control' : 'Host only control'}`);
        }
        break;

      case 'REQUEST_FORCE_SYNC':
        // Host replies with exact current state
        if (isHost && webrtcManager) {
          webrtcManager.sendData({
            type: 'FORCE_SYNC_ALIGN',
            timeMs: localPlayerState.timeMs,
            isPlaying: localPlayerState.isPlaying,
            url: window.location.href
          });
        }
        break;

      case 'FORCE_SYNC_ALIGN':
        if (data.url && !isSameVideo(data.url, window.location.href)) {
          if (sidebar) sidebar.addSystemLog(`🎬 Aligning video with host...`);
          try {
            const newUrl = new URL(data.url);
            newUrl.searchParams.set('flixparty', currentRoomId);
            window.location.href = newUrl.toString();
            return;
          } catch (e) {
            window.location.href = data.url;
            return;
          }
        }
        applyRemotePlayback('SYNC_ALIGN', data.timeMs, data.isPlaying);
        if (sidebar) sidebar.showToast('Aligned to host playback!');
        break;
    }
  }

  // Apply remote command to Netflix Bridge
  function applyRemotePlayback(action, timeMs, isPlaying = false) {
    lastRemoteSyncTimestamp = Date.now();
    window.postMessage({
      target: 'FLIXPARTY_BRIDGE',
      action,
      timeMs,
      isPlaying
    }, '*');
  }

  // Calculate drift and gently correct if needed
  function handleHeartbeat(data) {
    // Only non-hosts follow host heartbeat
    if (isHost) return;

    const oneWayLatency = Math.max(0, (Date.now() - data.timestamp) / 2);
    const expectedTimeMs = data.timeMs + (data.isPlaying ? oneWayLatency : 0);
    const driftMs = Math.abs(localPlayerState.timeMs - expectedTimeMs);

    // If drift is significant (> 1.4 seconds), realign without stutter
    if (driftMs > 1400) {
      console.log(`[FlixParty Sync] Drift detected: ${driftMs}ms. Correcting...`);
      applyRemotePlayback('SEEK', expectedTimeMs);
    }

    // If play/pause state is mismatched, align to host
    if (localPlayerState.isPlaying !== data.isPlaying) {
      applyRemotePlayback(data.isPlaying ? 'PLAY' : 'PAUSE', expectedTimeMs);
    }
  }

  function requestForceSync() {
    if (!isHost && webrtcManager) {
      webrtcManager.sendData({ type: 'REQUEST_FORCE_SYNC' });
    }
  }

  // Listen to messages from MAIN-world Netflix Bridge
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'FLIXPARTY_BRIDGE') {
      return;
    }

    const { type, eventType, state, isRemoteOriginated } = event.data;

    if (type === 'PLAYER_EVENT') {
      localPlayerState = state;

      // Ignore actions caused by incoming remote sync commands
      if (isRemoteOriginated || (Date.now() - lastRemoteSyncTimestamp < 800)) {
        return;
      }

      // Check control permissions: If host_only and current user is guest, revert!
      if (controlMode === 'host_only' && !isHost && isPartyActive) {
        if (eventType === 'PLAY' || eventType === 'PAUSE' || eventType === 'SEEKED') {
          if (sidebar) sidebar.showToast('Only the host can control playback in this party');
          requestForceSync();
          return;
        }
      }

      // Broadcast user action to peer
      if (isPartyActive && webrtcManager && webrtcManager.isConnected) {
        if (eventType === 'PLAY') {
          webrtcManager.sendData({
            type: 'SYNC_PLAY',
            timeMs: state.timeMs,
            username
          });
        } else if (eventType === 'PAUSE') {
          webrtcManager.sendData({
            type: 'SYNC_PAUSE',
            timeMs: state.timeMs,
            username
          });
        } else if (eventType === 'SEEKED') {
          webrtcManager.sendData({
            type: 'SYNC_SEEK',
            timeMs: state.timeMs,
            username
          });
        } else if (eventType === 'NAVIGATED') {
          if (isHost) {
            webrtcManager.sendData({
              type: 'SYNC_NAVIGATE',
              url: window.location.href,
              username
            });
          }
        }
      }
    }
  });

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
      case 'GET_PARTY_STATUS':
        sendResponse({
          isPartyActive,
          roomId: currentRoomId,
          isHost,
          controlMode
        });
        return false;

      case 'START_PARTY_CMD':
        startParty(request.roomId, true);
        sendResponse({ success: true, roomId: currentRoomId });
        return false;

      case 'JOIN_PARTY_CMD':
        joinParty(request.roomId);
        sendResponse({ success: true, roomId: request.roomId });
        return false;

      case 'LEAVE_PARTY_CMD':
        leaveParty();
        sendResponse({ success: true });
        return false;

      case 'TOGGLE_SIDEBAR_CMD':
        if (sidebar) {
          sidebar.setCollapsed(!sidebar.isCollapsed);
        } else {
          startParty();
        }
        sendResponse({ success: true });
        return false;

      default:
        return false;
    }
  });

  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }
})();
