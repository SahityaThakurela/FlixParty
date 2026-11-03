// FlixParty - Sidebar UI Component (In-page Shadow DOM Overlay)
// Works smoothly inside standard and fullscreen Netflix player

class FlixPartySidebar {
  constructor(options = {}) {
    this.options = options;
    this.container = null;
    this.shadow = null;
    this.isCollapsed = false;
    this.isHost = options.isHost || false;
    this.roomId = options.roomId || '';
    this.controlMode = options.controlMode || 'everyone'; // 'everyone' | 'host_only'
    this.unreadCount = 0;
    this.lastSystemMsg = ''; // Prevent duplicate system messages

    // Callbacks to external controller
    this.onSendMessage = options.onSendMessage || (() => {});
    this.onToggleMic = options.onToggleMic || (() => {});
    this.onToggleVideo = options.onToggleVideo || (() => {});
    this.onForceSync = options.onForceSync || (() => {});
    this.onControlModeChange = options.onControlModeChange || (() => {});
    this.onLeaveParty = options.onLeaveParty || (() => {});

    this.init();
  }

  init() {
    // Remove any existing instance
    const existing = document.getElementById('flixparty-root');
    if (existing) existing.remove();

    this.container = document.createElement('div');
    this.container.id = 'flixparty-root';
    this.container.style.cssText = 'all: initial; position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483647; pointer-events: none;';

    this.shadow = this.container.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = this.getTemplate();

    // Attach to body or current fullscreen element
    const mountTarget = document.fullscreenElement || document.body;
    mountTarget.appendChild(this.container);

    this.bindEvents();
    this.bindFullscreenChange();
  }

  // Handle Fullscreen transitions seamlessly
  bindFullscreenChange() {
    const handleFs = () => {
      const target = document.fullscreenElement || document.body;
      if (this.container && this.container.parentElement !== target) {
        target.appendChild(this.container);
      }
    };
    document.addEventListener('fullscreenchange', handleFs);
    document.addEventListener('webkitfullscreenchange', handleFs);
  }

  getTemplate() {
    return `
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          user-select: none;
        }

        :host {
          all: initial;
        }

        .flix-wrapper {
          pointer-events: auto;
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: 385px;
          max-width: 95vw;
          background: rgba(18, 18, 18, 0.94);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-left: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: -10px 0 35px rgba(0, 0, 0, 0.7);
          display: flex;
          flex-direction: column;
          color: #FFFFFF;
          transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          z-index: 2147483647;
        }

        .flix-wrapper.collapsed {
          transform: translateX(100%);
        }

        /* Collapsed Floating Trigger */
        .flix-floating-pill {
          pointer-events: auto;
          position: fixed;
          top: 80px;
          right: 0;
          background: #E50914;
          color: #FFF;
          padding: 10px 14px;
          border-radius: 24px 0 0 24px;
          box-shadow: -4px 4px 15px rgba(0,0,0,0.5);
          cursor: pointer;
          display: none;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 600;
          transition: all 0.2s ease;
          z-index: 2147483647;
        }

        .flix-floating-pill:hover {
          padding-left: 18px;
          background: #F40612;
        }

        .flix-floating-pill.active {
          display: flex;
        }

        .pill-badge {
          background: #FFF;
          color: #E50914;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 10px;
        }

        /* Header */
        .flix-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          background: rgba(26, 26, 26, 0.9);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }

        .flix-brand {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .flix-logo-icon {
          width: 24px;
          height: 24px;
          background: #E50914;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          font-size: 14px;
          color: #FFF;
        }

        .flix-title {
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 0.3px;
          background: linear-gradient(90deg, #FFFFFF, #FF7B7B);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .flix-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .icon-btn {
          background: transparent;
          border: none;
          color: #A3A3A3;
          width: 30px;
          height: 30px;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s, color 0.15s;
        }

        .icon-btn:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #FFF;
        }

        /* Room Bar */
        .flix-room-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 16px;
          background: rgba(0, 0, 0, 0.25);
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          font-size: 12px;
        }

        .room-tag {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(255, 255, 255, 0.07);
          padding: 4px 10px;
          border-radius: 12px;
          cursor: pointer;
          font-family: monospace;
          letter-spacing: 0.5px;
          color: #DDD;
        }

        .room-tag:hover {
          background: rgba(255, 255, 255, 0.14);
          color: #FFF;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: #A3A3A3;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #F59E0B; /* Yellow pending */
        }

        .status-dot.connected {
          background: #10B981; /* Green */
          box-shadow: 0 0 8px #10B981;
        }

        .status-dot.error {
          background: #EF4444; /* Red */
        }

        /* Video Call Area */
        .flix-video-section {
          padding: 10px 14px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(14, 14, 14, 0.5);
        }

        .video-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
          padding: 0 2px;
        }

        .video-section-title {
          font-size: 11px;
          font-weight: 600;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .layout-toggle-group {
          display: flex;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 6px;
          padding: 2px;
          gap: 2px;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .layout-btn {
          background: transparent;
          border: none;
          color: #888;
          font-size: 11px;
          padding: 3px 8px;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: all 0.15s ease;
        }

        .layout-btn:hover {
          color: #FFF;
          background: rgba(255, 255, 255, 0.1);
        }

        .layout-btn.active {
          background: #E50914;
          color: #FFF;
          font-weight: 600;
        }

        .video-grid {
          position: relative;
          width: 100%;
          margin-bottom: 10px;
          transition: all 0.25s ease;
        }

        /* 1. Side-by-Side (Landscape) */
        .video-grid.layout-side {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .video-grid.layout-side .video-tile {
          width: 100%;
          height: 135px;
          aspect-ratio: 4 / 3;
        }

        /* 2. Stacked (Portrait / Vertical - Large view) */
        .video-grid.layout-stacked {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .video-grid.layout-stacked .video-tile {
          width: 100%;
          height: 190px;
          aspect-ratio: 16 / 9;
        }

        /* 3. Focus Mode (PiP) */
        .video-grid.layout-pip {
          position: relative;
          height: 250px;
        }

        .video-grid.layout-pip #remoteTile {
          width: 100%;
          height: 100%;
          position: absolute;
          inset: 0;
          z-index: 1;
        }

        .video-grid.layout-pip #localTile {
          position: absolute;
          bottom: 10px;
          right: 10px;
          width: 110px;
          height: 80px;
          z-index: 2;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.85);
          border: 1.5px solid rgba(255, 255, 255, 0.4);
        }

        .video-tile {
          position: relative;
          background: #000;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.1);
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .video-tile.speaking {
          border: 2px solid #10B981;
          box-shadow: 0 0 12px rgba(16, 185, 129, 0.5);
        }

        .video-tile video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .tile-placeholder {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: #1E1E1E;
          color: #777;
          font-size: 12px;
          gap: 4px;
        }

        .tile-label {
          position: absolute;
          bottom: 6px;
          left: 6px;
          background: rgba(0, 0, 0, 0.65);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 500;
        }

        /* Media Controls */
        .media-controls-bar {
          display: flex;
          align-items: center;
          justify-content: space-around;
          padding: 4px 0;
        }

        .media-btn {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #FFF;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
        }

        .media-btn:hover {
          background: rgba(255, 255, 255, 0.18);
          transform: scale(1.05);
        }

        .media-btn.disabled {
          background: #EF4444;
          border-color: #EF4444;
        }

        /* Sync Controls */
        .flix-sync-bar {
          padding: 8px 14px;
          background: rgba(0, 0, 0, 0.35);
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 11px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }

        .sync-mode-selector {
          background: rgba(255, 255, 255, 0.08);
          color: #EEE;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 4px;
          padding: 3px 6px;
          font-size: 11px;
          outline: none;
          cursor: pointer;
        }

        .sync-mode-selector option {
          background: #222;
          color: #FFF;
        }

        .force-sync-btn {
          background: rgba(229, 9, 20, 0.15);
          border: 1px solid rgba(229, 9, 20, 0.4);
          color: #FF7B7B;
          padding: 3px 8px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 11px;
          transition: background 0.15s;
        }

        .force-sync-btn:hover {
          background: #E50914;
          color: #FFF;
        }

        /* Chat Section */
        .flix-chat-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: rgba(18, 18, 18, 0.7);
        }

        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
        }

        .chat-messages::-webkit-scrollbar {
          width: 5px;
        }

        .chat-messages::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }

        .chat-msg {
          display: flex;
          flex-direction: column;
          max-width: 85%;
        }

        .chat-msg.self {
          align-self: flex-end;
          align-items: flex-end;
        }

        .chat-msg.remote {
          align-self: flex-start;
          align-items: flex-start;
        }

        .chat-msg-header {
          font-size: 10px;
          color: #888;
          margin-bottom: 2px;
          padding: 0 4px;
        }

        .chat-bubble {
          padding: 8px 12px;
          border-radius: 12px;
          font-size: 13px;
          line-height: 1.4;
          word-break: break-word;
          user-select: text;
        }

        .chat-msg.self .chat-bubble {
          background: #E50914;
          color: #FFF;
          border-bottom-right-radius: 2px;
        }

        .chat-msg.remote .chat-bubble {
          background: rgba(255, 255, 255, 0.12);
          color: #EEE;
          border-bottom-left-radius: 2px;
        }

        .chat-system-log {
          align-self: center;
          font-size: 11px;
          color: #999;
          background: rgba(255, 255, 255, 0.05);
          padding: 4px 10px;
          border-radius: 10px;
          text-align: center;
          max-width: 90%;
        }

        /* Emoji Reaction Quick Bar */
        .emoji-bar {
          display: flex;
          align-items: center;
          justify-content: space-around;
          padding: 6px 12px;
          background: rgba(24, 24, 24, 0.8);
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }

        .emoji-btn {
          background: transparent;
          border: none;
          font-size: 18px;
          cursor: pointer;
          transition: transform 0.15s;
        }

        .emoji-btn:hover {
          transform: scale(1.3);
        }

        /* Chat Input */
        .chat-input-bar {
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          background: #181818;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }

        .chat-input {
          flex: 1;
          background: rgba(255, 255, 255, 0.07);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 18px;
          padding: 8px 14px;
          color: #FFF;
          font-size: 13px;
          outline: none;
          user-select: text;
        }

        .chat-input:focus {
          border-color: #E50914;
          background: rgba(255, 255, 255, 0.1);
        }

        .chat-send-btn {
          background: #E50914;
          border: none;
          width: 34px;
          height: 34px;
          border-radius: 50%;
          color: #FFF;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s, transform 0.1s;
        }

        .chat-send-btn:hover {
          background: #F40612;
          transform: scale(1.05);
        }

        /* Toast notification inside video screen */
        .toast-msg {
          position: fixed;
          bottom: 40px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(20, 20, 20, 0.9);
          border: 1px solid #E50914;
          color: #FFF;
          padding: 8px 18px;
          border-radius: 20px;
          font-size: 13px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.8);
          z-index: 2147483647;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.25s ease;
        }

        .toast-msg.show {
          opacity: 1;
        }
      </style>

      <!-- Floating Trigger Pill (When Collapsed) -->
      <div class="flix-floating-pill" id="floatingPill">
        <span>🎬 FlixParty</span>
        <span class="pill-badge" id="pillBadge" style="display:none;">0</span>
      </div>

      <!-- Main Sidebar Panel -->
      <div class="flix-wrapper" id="sidebarWrapper">
        <!-- Header -->
        <div class="flix-header">
          <div class="flix-brand">
            <div class="flix-logo-icon">▶</div>
            <div class="flix-title">FlixParty</div>
          </div>
          <div class="flix-actions">
            <button class="icon-btn" id="sidebarSettingsBtn" title="Settings (Server URL & Audio/Video)">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            </button>
            <button class="icon-btn" id="collapseBtn" title="Collapse Sidebar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
            <button class="icon-btn" id="closeBtn" title="Leave Watch Party">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>

        <!-- Room Information & Status -->
        <div class="flix-room-bar">
          <div class="room-tag" id="copyRoomTag" title="Click to copy Room Code">
            <span>Room:</span>
            <strong id="roomCodeDisplay">${this.roomId || 'Connecting...'}</strong>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </div>
          <div class="status-indicator" id="statusIndicatorBox" style="cursor: pointer;" title="Click to open Settings">
            <span class="status-dot" id="statusDot"></span>
            <span id="statusText">Connecting</span>
          </div>
        </div>

        <!-- Video Call Section -->
        <div class="flix-video-section">
          <div class="video-section-header">
            <span class="video-section-title">Video Call</span>
            <div class="layout-toggle-group">
              <button class="layout-btn active" id="layoutSideBySide" data-layout="side" title="Side-by-Side (Landscape)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="8" height="16" rx="2"/><rect x="13" y="4" width="8" height="16" rx="2"/></svg>
                <span>Side</span>
              </button>
              <button class="layout-btn" id="layoutStacked" data-layout="stacked" title="Stacked (Portrait / Big View)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/></svg>
                <span>Stacked</span>
              </button>
              <button class="layout-btn" id="layoutPiP" data-layout="pip" title="Focus Mode (Picture-in-Picture)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="12" y="12" width="7" height="7" rx="1" fill="currentColor"/></svg>
                <span>Focus</span>
              </button>
            </div>
          </div>

          <div class="video-grid layout-side" id="videoGrid">
            <!-- Local User Video -->
            <div class="video-tile" id="localTile">
              <video id="localVideo" autoplay playsinline muted></video>
              <div class="tile-placeholder" id="localPlaceholder" style="display:none;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                <span>Camera Off</span>
              </div>
              <div class="tile-label">You</div>
            </div>

            <!-- Remote Friend Video -->
            <div class="video-tile" id="remoteTile">
              <video id="remoteVideo" autoplay playsinline></video>
              <div class="tile-placeholder" id="remotePlaceholder">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                <span>Waiting for friend...</span>
              </div>
              <div class="tile-label" id="remoteLabel">Friend</div>
            </div>
          </div>

          <!-- Video & Mic Control Buttons -->
          <div class="media-controls-bar">
            <button class="media-btn" id="micBtn" title="Toggle Microphone">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            </button>
            <button class="media-btn" id="cameraBtn" title="Toggle Camera">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
            </button>
            <button class="media-btn" id="forceSyncBtn" title="Resync Playback Immediately">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            </button>
          </div>
        </div>

        <!-- Control Mode Bar -->
        <div class="flix-sync-bar">
          <div style="display:flex; align-items:center; gap:6px;">
            <span>Controls:</span>
            <select class="sync-mode-selector" id="controlModeSelect" ${!this.isHost ? 'disabled' : ''}>
              <option value="everyone" ${this.controlMode === 'everyone' ? 'selected' : ''}>Everyone can control</option>
              <option value="host_only" ${this.controlMode === 'host_only' ? 'selected' : ''}>Host only control</option>
            </select>
          </div>
          <span style="color:#777; font-size:10px;">${this.isHost ? '👑 Host' : 'Guest'}</span>
        </div>

        <!-- Chat Section -->
        <div class="flix-chat-section">
          <div class="chat-messages" id="chatList">
            <div class="chat-system-log">🍿 Welcome to FlixParty! Play/pause/seek will stay synchronized in real time.</div>
          </div>

          <!-- Quick Emoji Bar -->
          <div class="emoji-bar">
            <button class="emoji-btn" data-emoji="🍿">🍿</button>
            <button class="emoji-btn" data-emoji="❤️">❤️</button>
            <button class="emoji-btn" data-emoji="😂">😂</button>
            <button class="emoji-btn" data-emoji="😱">😱</button>
            <button class="emoji-btn" data-emoji="👏">👏</button>
            <button class="emoji-btn" data-emoji="🔥">🔥</button>
          </div>

          <!-- Chat Input Form -->
          <form class="chat-input-bar" id="chatForm">
            <input type="text" class="chat-input" id="chatInput" placeholder="Type a message..." maxlength="300" autocomplete="off" />
            <button type="submit" class="chat-send-btn" id="sendBtn" title="Send message">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </form>
        </div>
      </div>

      <!-- In-screen Toast -->
      <div class="toast-msg" id="toast"></div>
    `;
  }

  bindEvents() {
    const $ = (id) => this.shadow.getElementById(id);

    // Collapse & Expand
    const wrapper = $('sidebarWrapper');
    const floatingPill = $('floatingPill');

    $('collapseBtn').addEventListener('click', () => {
      this.setCollapsed(true);
    });

    floatingPill.addEventListener('click', () => {
      this.setCollapsed(false);
    });

    // Settings
    const openSettings = () => {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    };
    $('sidebarSettingsBtn')?.addEventListener('click', openSettings);
    $('statusIndicatorBox')?.addEventListener('click', openSettings);

    // Close / Leave Party
    $('closeBtn').addEventListener('click', () => {
      if (confirm('Leave this watch party?')) {
        this.onLeaveParty();
        this.destroy();
      }
    });

    // Copy Room Code
    $('copyRoomTag').addEventListener('click', () => {
      if (this.roomId) {
        navigator.clipboard.writeText(this.roomId).then(() => {
          this.showToast('Room code copied to clipboard!');
        });
      }
    });

    // Video Layout Switcher (Side-by-Side vs Stacked vs Focus PiP)
    const videoGrid = $('videoGrid');
    const setVideoLayout = (layout) => {
      if (!videoGrid) return;
      videoGrid.className = `video-grid layout-${layout}`;
      ['layoutSideBySide', 'layoutStacked', 'layoutPiP'].forEach(id => {
        const btn = $(id);
        if (btn) btn.classList.toggle('active', btn.dataset.layout === layout);
      });
      try {
        localStorage.setItem('flixparty_video_layout', layout);
      } catch (e) {}
    };

    let initialLayout = 'side';
    try {
      initialLayout = localStorage.getItem('flixparty_video_layout') || 'side';
    } catch (e) {}
    setVideoLayout(initialLayout);

    $('layoutSideBySide')?.addEventListener('click', () => setVideoLayout('side'));
    $('layoutStacked')?.addEventListener('click', () => setVideoLayout('stacked'));
    $('layoutPiP')?.addEventListener('click', () => setVideoLayout('pip'));

    // Media Controls
    const micBtn = $('micBtn');
    micBtn.addEventListener('click', () => {
      const isActive = this.onToggleMic();
      micBtn.classList.toggle('disabled', !isActive);
      micBtn.style.background = isActive ? '' : '#EF4444';
      this.showToast(isActive ? 'Microphone unmuted' : 'Microphone muted');
    });

    const cameraBtn = $('cameraBtn');
    cameraBtn.addEventListener('click', () => {
      const isActive = this.onToggleVideo();
      cameraBtn.classList.toggle('disabled', !isActive);
      cameraBtn.style.background = isActive ? '' : '#EF4444';
      $('localPlaceholder').style.display = isActive ? 'none' : 'flex';
      $('localVideo').style.display = isActive ? 'block' : 'none';
      this.showToast(isActive ? 'Camera enabled' : 'Camera disabled');
    });

    // Force Sync
    $('forceSyncBtn').addEventListener('click', () => {
      this.onForceSync();
      this.showToast('Resynchronizing playback...');
    });

    // Control Mode Change
    $('controlModeSelect').addEventListener('change', (e) => {
      this.controlMode = e.target.value;
      this.onControlModeChange(this.controlMode);
      this.showToast(`Mode: ${this.controlMode === 'everyone' ? 'Everyone can control' : 'Host only control'}`);
    });

    // Chat Send & Keyboard Isolation
    const chatInput = $('chatInput');
    const chatForm = $('chatForm');
    const sendBtn = $('sendBtn');

    const send = () => {
      const text = chatInput.value.trim();
      if (text) {
        this.onSendMessage(text);
        this.addChatMessage('You', text, true);
        chatInput.value = '';
      }
    };

    // 1. Submit on form submit (natively triggered by Enter key in all browsers)
    if (chatForm) {
      chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopPropagation();
        send();
      });
    }

    // 2. Click send button
    if (sendBtn) {
      sendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        send();
      });
    }

    // Helper to stop keyboard events from leaking to YouTube/Netflix player
    const stopKeyLeaking = (e) => {
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
    };

    const isEnterKey = (e) => {
      return e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.keyCode === 13 || e.which === 13;
    };

    // Keydown handling for Enter
    chatInput.addEventListener('keydown', (e) => {
      stopKeyLeaking(e);
      if (isEnterKey(e) && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    // Keyup handling
    chatInput.addEventListener('keyup', (e) => {
      stopKeyLeaking(e);
      if (isEnterKey(e) && !e.shiftKey && chatInput.value.trim()) {
        e.preventDefault();
        send();
      }
    });

    // Keypress handling
    chatInput.addEventListener('keypress', (e) => {
      stopKeyLeaking(e);
      if (isEnterKey(e) && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    // Safeguard on dropdown and container
    const select = $('controlModeSelect');
    ['keydown', 'keyup', 'keypress'].forEach(evtType => {
      if (select) select.addEventListener(evtType, stopKeyLeaking);
      this.container.addEventListener(evtType, stopKeyLeaking);
    });

    // Blur video player when clicking or focusing chat input
    const blurPlayer = () => {
      try {
        const active = document.activeElement;
        if (active && active !== this.container) {
          active.blur();
        }
        const player = document.getElementById('movie_player') ||
                       document.querySelector('.html5-video-player') ||
                       document.querySelector('video');
        if (player && typeof player.blur === 'function') {
          player.blur();
        }
      } catch (err) {}
    };

    chatInput.addEventListener('focus', blurPlayer);
    chatInput.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      blurPlayer();
    });

    // Quick Emojis
    this.shadow.querySelectorAll('.emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        this.onSendMessage(emoji);
        this.addChatMessage('You', emoji, true);
        this.animateFloatingEmoji(emoji);
      });
    });
  }

  setCollapsed(collapsed) {
    this.isCollapsed = collapsed;
    const wrapper = this.shadow.getElementById('sidebarWrapper');
    const pill = this.shadow.getElementById('floatingPill');
    const badge = this.shadow.getElementById('pillBadge');

    if (collapsed) {
      wrapper.classList.add('collapsed');
      pill.classList.add('active');
      if (this.unreadCount > 0) {
        badge.textContent = this.unreadCount;
        badge.style.display = 'inline-block';
      }
    } else {
      wrapper.classList.remove('collapsed');
      pill.classList.remove('active');
      this.unreadCount = 0;
      badge.style.display = 'none';
    }
  }

  setRoomId(roomId) {
    this.roomId = roomId;
    const el = this.shadow.getElementById('roomCodeDisplay');
    if (el) el.textContent = roomId;
  }

  setConnectionStatus(state) {
    const dot = this.shadow.getElementById('statusDot');
    const text = this.shadow.getElementById('statusText');
    if (!dot || !text) return;

    dot.className = 'status-dot';
    switch (state) {
      case 'signaling_connected':
      case 'room_joined':
      case 'ready':
        dot.classList.add('connected');
        text.textContent = 'Server Online';
        break;
      case 'peer_joined':
        dot.classList.add('connected');
        text.textContent = 'Connecting P2P...';
        break;
      case 'connected':
        dot.classList.add('connected');
        text.textContent = '🟢 In Sync';
        break;
      case 'connecting':
        text.textContent = 'Connecting...';
        break;
      case 'signaling_error':
        dot.classList.add('error');
        text.textContent = 'Server Offline';
        this.addSystemLog('⚠️ Signaling server offline. Start local server with "node server/server.js" or configure your hosted server in Settings.');
        break;
      case 'peer_left':
        dot.classList.add('connected'); // signaling still up
        text.textContent = 'Waiting...';
        // Hide remote video, show placeholder
        const remoteVideo = this.shadow.getElementById('remoteVideo');
        const remotePlaceholder = this.shadow.getElementById('remotePlaceholder');
        if (remoteVideo) { remoteVideo.srcObject = null; remoteVideo.style.display = 'none'; }
        if (remotePlaceholder) remotePlaceholder.style.display = 'flex';
        break;
      case 'disconnected':
      case 'failed':
      case 'closed':
        dot.classList.add('error');
        text.textContent = 'Disconnected';
        break;
      default:
        text.textContent = state;
        break;
    }
  }

  setLocalStream(stream) {
    const video = this.shadow.getElementById('localVideo');
    if (video) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }
  }

  setRemoteStream(stream) {
    const video = this.shadow.getElementById('remoteVideo');
    const placeholder = this.shadow.getElementById('remotePlaceholder');
    if (video) {
      video.srcObject = stream;
      if (placeholder) placeholder.style.display = 'none';
      video.style.display = 'block';
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // If browser autoplay with audio is restricted, start muted and unmute on first click
          video.muted = true;
          video.play().catch(console.warn);
          window.addEventListener('click', () => { video.muted = false; }, { once: true });
        });
      }
    }
  }

  setSpeaking(peer, isSpeaking) {
    const tile = this.shadow.getElementById(peer === 'local' ? 'localTile' : 'remoteTile');
    if (tile) {
      tile.classList.toggle('speaking', isSpeaking);
    }
  }

  addChatMessage(sender, text, isSelf = false) {
    const list = this.shadow.getElementById('chatList');
    if (!list) return;

    const msg = document.createElement('div');
    msg.className = `chat-msg ${isSelf ? 'self' : 'remote'}`;
    msg.innerHTML = `
      <div class="chat-msg-header">${sender}</div>
      <div class="chat-bubble">${this.escapeHTML(text)}</div>
    `;
    list.appendChild(msg);
    list.scrollTop = list.scrollHeight;

    if (this.isCollapsed && !isSelf) {
      this.unreadCount++;
      const badge = this.shadow.getElementById('pillBadge');
      if (badge) {
        badge.textContent = this.unreadCount;
        badge.style.display = 'inline-block';
      }
    }
  }

  addSystemLog(text) {
    const list = this.shadow.getElementById('chatList');
    if (!list) return;

    const log = document.createElement('div');
    log.className = 'chat-system-log';
    log.textContent = text;
    list.appendChild(log);
    list.scrollTop = list.scrollHeight;
  }

  showToast(text) {
    const toast = this.shadow.getElementById('toast');
    if (!toast) return;

    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  animateFloatingEmoji(emoji) {
    const floater = document.createElement('div');
    floater.textContent = emoji;
    floater.style.cssText = `
      position: fixed;
      bottom: 60px;
      right: ${Math.floor(Math.random() * 80 + 380)}px;
      font-size: 32px;
      pointer-events: none;
      z-index: 2147483647;
      animation: floatUp 2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
    `;

    // Add keyframe style if not present
    if (!this.shadow.getElementById('floatingEmojiKeyframe')) {
      const style = document.createElement('style');
      style.id = 'floatingEmojiKeyframe';
      style.textContent = `
        @keyframes floatUp {
          0% { transform: translateY(0) scale(0.7); opacity: 1; }
          50% { transform: translateY(-120px) scale(1.3); opacity: 0.9; }
          100% { transform: translateY(-240px) scale(1); opacity: 0; }
        }
      `;
      this.shadow.appendChild(style);
    }

    this.shadow.appendChild(floater);
    setTimeout(() => floater.remove(), 2100);
  }

  escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  destroy() {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }
}
