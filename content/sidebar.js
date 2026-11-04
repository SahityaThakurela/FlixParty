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
    this.username = options.username || 'You';
    this.remoteUsername = options.remoteUsername || '';
    this.controlMode = options.controlMode || 'everyone'; // 'everyone' | 'host_only'
    this.unreadCount = 0;
    this.lastSystemMsg = ''; // Prevent duplicate system messages
    this.activeReply = null; // WhatsApp-style reply context: { sender, text }

    // Callbacks to external controller
    this.onSendMessage = options.onSendMessage || (() => {});
    this.onSendReaction = options.onSendReaction || (() => {});
    this.onUpdateUsername = options.onUpdateUsername || (() => {});
    this.onToggleMic = options.onToggleMic || (() => {});
    this.onToggleVideo = options.onToggleVideo || (() => {});
    this.onForceSync = options.onForceSync || (() => {});
    this.onControlModeChange = options.onControlModeChange || (() => {});
    this.onLeaveParty = options.onLeaveParty || (() => {});
    this.onUnlockAudio = options.onUnlockAudio || (() => {});

    this.init();
  }

  init() {
    // Remove any existing instance
    const existing = document.getElementById('flixparty-root');
    if (existing) existing.remove();

    this.container = document.createElement('div');
    this.container.id = 'flixparty-root';
    this.container.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 2147483647; pointer-events: none;';

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
          background: #121418;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-left: 1px solid rgba(255, 255, 255, 0.07);
          box-shadow: -10px 0 35px rgba(0, 0, 0, 0.7);
          display: flex;
          flex-direction: column;
          color: #F0F2F5;
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
          background: #A8D84A;
          color: #1A1A1A;
          padding: 10px 14px;
          border-radius: 24px 0 0 24px;
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
          background: #BEEB62;
        }

        .flix-floating-pill.active {
          display: flex;
        }

        .pill-badge {
          background: #1A1A1A;
          color: #A8D84A;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 10px;
        }

        /* Header (Bar 1) */
        .flix-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: #0D0F11;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          gap: 6px;
        }

        .flix-brand {
          display: flex;
          align-items: center;
          gap: 7px;
          flex-shrink: 0;
        }

        .flix-logo-icon {
          width: 22px;
          height: 22px;
          background: #A8D84A;
          border-radius: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          font-size: 12px;
          color: #1A1A1A;
        }

        .flix-title {
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.3px;
          background: linear-gradient(90deg, #FFFFFF, #A8D84A);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: #A3A3A3;
          background: rgba(255, 255, 255, 0.06);
          padding: 3px 8px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.05);
          transition: background 0.15s, color 0.15s;
          white-space: nowrap;
          cursor: pointer;
        }

        .status-indicator:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #FFF;
        }

        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #F59E0B; /* Yellow pending */
          flex-shrink: 0;
        }

        .status-dot.connected {
          background: #10B981; /* Green */
          box-shadow: 0 0 6px #10B981;
        }

        .status-dot.error {
          background: #EF4444; /* Red */
        }

        .flix-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .icon-btn {
          background: transparent;
          border: none;
          color: #A3A3A3;
          width: 26px;
          height: 26px;
          border-radius: 5px;
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

        /* Room Bar (Bar 2 - Combined Room Code & Layout Toggles) */
        .flix-room-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px;
          background: #0F1115;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          font-size: 11px;
        }

        .room-tag {
          display: flex;
          align-items: center;
          gap: 5px;
          background: rgba(255, 255, 255, 0.07);
          padding: 3px 8px;
          border-radius: 6px;
          cursor: pointer;
          font-family: monospace;
          letter-spacing: 0.5px;
          color: #DDD;
          font-size: 11px;
          transition: background 0.15s, color 0.15s;
        }

        .room-tag:hover {
          background: rgba(255, 255, 255, 0.14);
          color: #FFF;
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
          font-size: 10.5px;
          padding: 2px 7px;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 3px;
          transition: all 0.15s ease;
        }

        .layout-btn:hover {
          color: #FFF;
          background: rgba(255, 255, 255, 0.1);
        }

        .layout-btn.active {
          background: #A8D84A;
          color: #1A1A1A;
          font-weight: 600;
        }

        /* Video Call Area */
        .flix-video-section {
          padding: 8px 10px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(13, 15, 17, 0.5);
        }

        .video-grid {
          position: relative;
          width: 100%;
          margin-bottom: 0;
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
          width: 124px;
          height: 90px;
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
          border: 2px solid #A8D84A;
          box-shadow: 0 0 14px rgba(168, 216, 74, 0.4);
        }

        .video-tile video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: none;
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
          max-width: 75%;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        #localLabel {
          top: 6px;
          bottom: auto;
          left: 6px;
          z-index: 6;
        }

        .local-mute-badge {
          position: absolute;
          top: 6px;
          right: 6px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #EF4444;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 6px rgba(0,0,0,0.5);
          z-index: 6;
        }

        .audio-unmute-badge {
          position: absolute;
          top: 6px;
          right: 6px;
          background: #A8D84A;
          color: #1A1A1A;
          border: none;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
          z-index: 10;
          box-shadow: 0 2px 8px rgba(0,0,0,0.5);
          transition: transform 0.15s, background 0.15s;
        }

        .audio-unmute-badge:hover {
          background: #BEEB62;
          transform: scale(1.06);
        }

        /* In-Video Floating Media Controls (Visible on hover of local video tile with glassmorphism theme) */
        .media-controls-bar {
          position: absolute;
          bottom: 8px;
          left: 50%;
          transform: translateX(-50%) translateY(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 4px 8px;
          background: rgba(13, 15, 17, 0.75);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 24px;
          box-shadow: 0 4px 18px rgba(0, 0, 0, 0.7);
          z-index: 10;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }

        #localTile:hover .media-controls-bar,
        #localTile:focus-within .media-controls-bar,
        .media-controls-bar:hover {
          opacity: 1;
          pointer-events: auto;
          transform: translateX(-50%) translateY(0);
        }

        .video-grid.layout-pip .media-controls-bar {
          bottom: 5px;
          padding: 3px 5px;
          gap: 4px;
        }

        .media-btn {
          position: relative;
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.16);
          color: #FFF;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease, color 0.2s ease;
          flex-shrink: 0;
          outline: none;
        }

        .video-grid.layout-pip .media-btn {
          width: 26px;
          height: 26px;
        }

        .video-grid.layout-pip .media-btn svg {
          width: 14px;
          height: 14px;
        }

        .media-btn:hover {
          background: rgba(255, 255, 255, 0.24);
          border-color: rgba(255, 255, 255, 0.3);
          transform: scale(1.1);
        }

        .media-btn:active {
          transform: scale(0.92);
        }

        /* Muted / Video Stopped State */
        .media-btn.disabled {
          background: rgba(239, 68, 68, 0.88);
          border-color: rgba(239, 68, 68, 0.95);
          box-shadow: 0 0 10px rgba(239, 68, 68, 0.45);
          color: #FFF;
        }

        .media-btn.disabled:hover {
          background: #EF4444;
          box-shadow: 0 0 14px rgba(239, 68, 68, 0.65);
        }

        /* Animated Cross / Diagonal Slash for Mute & Camera Off */
        .slash-line {
          stroke: #FFF;
          stroke-dasharray: 28;
          stroke-dashoffset: 28;
          transition: stroke-dashoffset 0.28s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .media-btn.disabled .slash-line {
          stroke-dashoffset: 0;
        }

        /* Click Pulse Bounce Animation */
        @keyframes btnPulse {
          0% { transform: scale(1); }
          40% { transform: scale(0.85); }
          100% { transform: scale(1.1); }
        }

        .media-btn.pulse {
          animation: btnPulse 0.26s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }

        /* Resync Refresh Spin Animation */
        @keyframes spinRefresh {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .media-btn.spinning svg {
          animation: spinRefresh 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        .media-btn.spinning {
          border-color: #A8D84A;
          color: #A8D84A;
          box-shadow: 0 0 12px rgba(168, 216, 74, 0.5);
        }

        /* Sync Controls */
        .flix-sync-bar {
          padding: 8px 14px;
          background: #0F1115;
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
          background: rgba(168, 216, 74, 0.1);
          border: 1px solid rgba(168, 216, 74, 0.35);
          color: #A8D84A;
          padding: 3px 8px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 11px;
          transition: background 0.15s;
        }

        .force-sync-btn:hover {
          background: #A8D84A;
          color: #1A1A1A;
        }

        /* Chat Section */
        .flix-chat-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: #0D0F11;
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
          max-width: 88%;
          position: relative;
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
          margin-bottom: 3px;
          padding: 0 4px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .chat-msg.self .chat-msg-header {
          flex-direction: row-reverse;
        }

        .chat-msg-sender {
          font-weight: 600;
          color: #AAA;
        }

        .chat-msg.self .chat-msg-sender {
          color: #A8D84A;
        }

        .chat-msg-time {
          font-size: 9px;
          color: #666;
          font-weight: normal;
        }

        .chat-bubble-container {
          display: flex;
          align-items: center;
          gap: 5px;
          position: relative;
          max-width: 100%;
        }

        .chat-msg.self .chat-bubble-container {
          flex-direction: row-reverse;
        }

        .msg-reply-btn {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #A3A3A3;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: all 0.15s ease;
          flex-shrink: 0;
        }

        .chat-msg:hover .msg-reply-btn {
          opacity: 1;
        }

        .msg-reply-btn:hover {
          background: #A8D84A;
          color: #1A1A1A;
          border-color: #A8D84A;
          transform: scale(1.12);
        }

        .chat-bubble {
          padding: 10px 14px;
          border-radius: 18px;
          font-size: 13px;
          line-height: 1.45;
          word-break: break-word;
          user-select: text;
        }

        .chat-msg.self .chat-bubble {
          background: #A8D84A;
          color: #1A1A1A;
          border-radius: 18px 18px 4px 18px;
          box-shadow: 0 2px 8px rgba(168, 216, 74, 0.2);
        }

        .chat-msg.remote .chat-bubble {
          background: #242830;
          color: #F0F2F5;
          border-radius: 18px 18px 18px 4px;
        }

        /* Quoted message inside bubble (WhatsApp style tag) */
        .chat-reply-quote {
          display: flex;
          background: #0F1115;
          border-radius: 6px;
          overflow: hidden;
          margin-bottom: 6px;
          border-left: 3px solid #A8D84A;
          user-select: none;
        }

        .chat-msg.self .chat-reply-quote {
          background: rgba(0, 0, 0, 0.25);
          border-left-color: #FFFFFF;
        }

        .reply-quote-body {
          padding: 4px 8px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .reply-quote-sender {
          font-weight: 700;
          font-size: 10.5px;
          color: #9BA3AF;
          line-height: 1.2;
        }

        .chat-msg.self .reply-quote-sender {
          color: #FFF;
        }

        .reply-quote-text {
          font-size: 11px;
          color: #DDD;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 220px;
          line-height: 1.25;
        }

        /* Large Emojis in Chat (when message is emoji-only) */
        .chat-msg .chat-bubble.emoji-only {
          background: transparent !important;
          padding: 2px 4px !important;
          line-height: 1.15 !important;
          box-shadow: none !important;
          border-radius: 0 !important;
        }

        .chat-msg .chat-bubble.single-emoji .chat-bubble-text {
          font-size: 46px !important;
          line-height: 1.1 !important;
          filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.5));
        }

        .chat-msg .chat-bubble.few-emojis .chat-bubble-text {
          font-size: 34px !important;
          line-height: 1.2 !important;
          filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.4));
        }

        .chat-msg .chat-bubble.emoji-only:not(.single-emoji):not(.few-emojis) .chat-bubble-text {
          font-size: 26px !important;
          line-height: 1.3 !important;
          filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.3));
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
          padding: 7px 12px;
          background: #121418;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }

        .emoji-btn {
          background: transparent;
          border: none;
          font-size: 22px;
          cursor: pointer;
          transition: transform 0.18s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          user-select: none;
        }

        .emoji-btn:hover {
          transform: scale(1.35);
        }

        .emoji-btn:active {
          transform: scale(0.95);
        }

        .emoji-picker-toggle-btn {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #FFF;
          font-size: 14px;
          border-radius: 12px;
          padding: 2px 7px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 3px;
          transition: background 0.15s, transform 0.15s;
          user-select: none;
        }

        .emoji-picker-toggle-btn:hover {
          background: rgba(255, 255, 255, 0.18);
          transform: scale(1.08);
        }

        /* Full Emoji Picker Panel */
        .full-emoji-picker {
          background: #121418;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          flex-direction: column;
          animation: slideUpEmoji 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          max-height: 220px;
          z-index: 10;
        }

        @keyframes slideUpEmoji {
          from { transform: translateY(12px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        .emoji-picker-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 5px 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(13, 15, 17, 0.9);
        }

        .emoji-picker-tabs {
          display: flex;
          gap: 3px;
        }

        .emoji-tab-btn {
          background: transparent;
          border: none;
          font-size: 17px;
          padding: 3px 6px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.15s, transform 0.15s;
          user-select: none;
        }

        .emoji-tab-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          transform: scale(1.15);
        }

        .emoji-tab-btn.active {
          background: rgba(168, 216, 74, 0.2);
          box-shadow: inset 0 -2px 0 #A8D84A;
        }

        .emoji-picker-close-btn {
          background: transparent;
          border: none;
          color: #888;
          font-size: 13px;
          cursor: pointer;
          padding: 3px 6px;
          border-radius: 4px;
          transition: color 0.15s;
        }

        .emoji-picker-close-btn:hover {
          color: #FFF;
        }

        .emoji-picker-grid {
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          gap: 2px;
          padding: 6px 8px;
          max-height: 165px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
        }

        .emoji-picker-grid::-webkit-scrollbar {
          width: 4px;
        }

        .emoji-picker-grid::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }

        .emoji-picker-item {
          font-size: 21px;
          text-align: center;
          padding: 4px 1px;
          border-radius: 5px;
          cursor: pointer;
          transition: background 0.12s, transform 0.12s;
          user-select: none;
          line-height: 1.2;
        }

        .emoji-picker-item:hover {
          background: rgba(255, 255, 255, 0.16);
          transform: scale(1.28);
        }

        .emoji-inline-btn {
          background: transparent;
          border: none;
          font-size: 19px;
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.15s, background 0.15s;
          user-select: none;
          flex-shrink: 0;
        }

        .emoji-inline-btn:hover {
          transform: scale(1.22);
          background: rgba(255, 255, 255, 0.08);
        }

        /* Reply Preview Bar above input (WhatsApp style tag) */
        .chat-reply-preview {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 12px;
          background: #1A1C22;
          border-top: 1px solid rgba(255, 255, 255, 0.07);
          border-left: 3px solid #A8D84A;
          gap: 8px;
          animation: slideUpReply 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes slideUpReply {
          from { transform: translateY(8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        .reply-preview-body {
          flex: 1;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .reply-preview-sender {
          font-size: 11px;
          font-weight: 700;
          color: #A8D84A;
          line-height: 1.2;
        }

        .reply-preview-text {
          font-size: 11px;
          color: #AAA;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 270px;
          line-height: 1.2;
        }

        .reply-cancel-btn {
          background: transparent;
          border: none;
          color: #888;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.15s, background 0.15s;
          flex-shrink: 0;
        }

        .reply-cancel-btn:hover {
          color: #FFF;
          background: rgba(255, 255, 255, 0.1);
        }

        /* Chat Input */
        .chat-input-bar {
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          background: #121418;
          border-top: 1px solid rgba(255, 255, 255, 0.07);
        }

        .chat-input {
          flex: 1;
          background: #1A1C22;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 18px;
          padding: 8px 14px;
          color: #F0F2F5;
          font-size: 13px;
          outline: none;
          user-select: text;
        }

        .chat-input:focus {
          border-color: #A8D84A;
          background: #1E2126;
          box-shadow: 0 0 0 3px rgba(168, 216, 74, 0.15);
        }

        .chat-send-btn {
          background: #A8D84A;
          border: none;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          color: #1A1A1A;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s, transform 0.1s;
        }

        .chat-send-btn:hover {
          background: #BEEB62;
          transform: scale(1.05);
        }

        /* Toast notification inside video screen */
        .toast-msg {
          position: fixed;
          bottom: 40px;
          left: 50%;
          transform: translateX(-50%);
          background: #1A1C22;
          border: 1px solid rgba(168, 216, 74, 0.35);
          color: #F0F2F5;
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
        <!-- Bar 1: Brand & Status & Header Actions -->
        <div class="flix-header">
          <div class="flix-brand">
            <div class="flix-logo-icon">▶</div>
            <div class="flix-title">FlixParty</div>
          </div>
          <div class="header-right">
            <div class="status-indicator" id="statusIndicatorBox" style="cursor: pointer;" title="Click to open Settings">
              <span class="status-dot" id="statusDot"></span>
              <span id="statusText">Connecting</span>
            </div>
            <div class="flix-actions">
              <button class="icon-btn" id="sidebarSettingsBtn" title="Settings (Server URL & Audio/Video)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              </button>
              <button class="icon-btn" id="collapseBtn" title="Collapse Sidebar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </button>
              <button class="icon-btn" id="closeBtn" title="Leave Watch Party">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Bar 2: Room Code & Video Layout Switches -->
        <div class="flix-room-bar">
          <div class="room-tag" id="copyRoomTag" title="Click to copy Room Code">
            <span>Room:</span>
            <strong id="roomCodeDisplay">${this.roomId || 'Connecting...'}</strong>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </div>
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

        <!-- Video Call Section -->
        <div class="flix-video-section">
          <div class="video-grid layout-side" id="videoGrid">
            <!-- Local User Video -->
            <div class="video-tile" id="localTile">
              <video id="localVideo" autoplay playsinline muted></video>
              <div class="tile-placeholder" id="localPlaceholder" style="display:none;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                <span>Camera Off</span>
              </div>
              <div class="tile-label" id="localLabel" style="cursor: pointer;" title="Click to change your display name">${this.username} ✎</div>
              
              <!-- Indicator when mic is muted (visible even when not hovering) -->
              <div class="local-mute-badge" id="localMuteBadge" style="display:none;" title="Microphone muted">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFF" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line><line x1="2" y1="2" x2="22" y2="22"></line></svg>
              </div>

              <!-- In-Video Transparent Media Controls (Appears on hover to save vertical space) -->
              <div class="media-controls-bar" id="mediaControlsBar">
                <button type="button" class="media-btn" id="micBtn" title="Toggle Microphone">
                  <svg class="media-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                    <line class="slash-line" x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></line>
                  </svg>
                </button>
                <button type="button" class="media-btn" id="cameraBtn" title="Toggle Camera">
                  <svg class="media-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M23 7l-7 5 7 5V7z"></path>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                    <line class="slash-line" x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></line>
                  </svg>
                </button>
                <button type="button" class="media-btn" id="forceSyncBtn" title="Resync Playback Immediately">
                  <svg class="media-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <polyline points="1 20 1 14 7 14"></polyline>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                  </svg>
                </button>
              </div>
            </div>

            <!-- Remote Friend Video -->
            <div class="video-tile" id="remoteTile">
              <video id="remoteVideo" autoplay playsinline></video>
              <audio id="remoteAudio" autoplay playsinline></audio>
              <button class="audio-unmute-badge" id="unmuteAudioBadge" style="display:none;" title="Click to unmute">🔊 Click to Unmute</button>
              <div class="tile-placeholder" id="remotePlaceholder">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                <span>Waiting for friend...</span>
              </div>
              <div class="tile-label" id="remoteLabel">${this.remoteUsername || 'Friend'}</div>
            </div>
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

          <!-- Quick Emoji Bar with Full Picker Toggle -->
          <div class="emoji-bar">
            <button class="emoji-btn" data-emoji="🍿">🍿</button>
            <button class="emoji-btn" data-emoji="❤️">❤️</button>
            <button class="emoji-btn" data-emoji="😂">😂</button>
            <button class="emoji-btn" data-emoji="😱">😱</button>
            <button class="emoji-btn" data-emoji="👏">👏</button>
            <button class="emoji-btn" data-emoji="🔥">🔥</button>
            <button type="button" class="emoji-picker-toggle-btn" id="toggleEmojiPickerBtn" title="Full Emoji Section">
              <span>😊 More</span>
            </button>
          </div>

          <!-- Full Emoji Picker Section -->
          <div class="full-emoji-picker" id="fullEmojiPicker" style="display: none;">
            <div class="emoji-picker-header">
              <div class="emoji-picker-tabs">
                <button type="button" class="emoji-tab-btn active" data-tab="smileys" title="Smileys">😀</button>
                <button type="button" class="emoji-tab-btn" data-tab="gestures" title="Gestures">👋</button>
                <button type="button" class="emoji-tab-btn" data-tab="hearts" title="Hearts & Love">❤️</button>
                <button type="button" class="emoji-tab-btn" data-tab="party" title="Movie & Party">🍿</button>
                <button type="button" class="emoji-tab-btn" data-tab="food" title="Food & Drink">🍕</button>
              </div>
              <button type="button" class="emoji-picker-close-btn" id="closeEmojiPickerBtn" title="Close Emojis">✕</button>
            </div>
            <div class="emoji-picker-grid" id="emojiPickerGrid"></div>
          </div>

          <!-- WhatsApp-style Reply Preview Bar (Tag context) -->
          <div class="chat-reply-preview" id="chatReplyPreview" style="display: none;">
            <div class="reply-preview-body">
              <div class="reply-preview-sender" id="replyPreviewSender">Replying to Friend</div>
              <div class="reply-preview-text" id="replyPreviewText">Message preview</div>
            </div>
            <button type="button" class="reply-cancel-btn" id="cancelReplyBtn" title="Cancel reply">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>

          <!-- Chat Input Form -->
          <form class="chat-input-bar" id="chatForm">
            <button type="button" class="emoji-inline-btn" id="inlineEmojiBtn" title="Choose emoji">😊</button>
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

    // Global unlock handler: first interaction unlocks audio on autoplay-restricted pages
    const unlockUserGesture = () => {
      this.unlockAudio();
    };
    document.addEventListener('click', unlockUserGesture, { capture: true });
    document.addEventListener('keydown', unlockUserGesture, { capture: true });
    this.container.addEventListener('click', unlockUserGesture);

    // Audio unmute badge click
    $('unmuteAudioBadge')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.unlockAudio();
      this.showToast('Audio unmuted!');
    });

    // Media Controls (In-Video Floating Controls)
    const micBtn = $('micBtn');
    const localMuteBadge = $('localMuteBadge');
    if (micBtn) {
      micBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.unlockAudio();
        const isActive = this.onToggleMic();
        micBtn.classList.toggle('disabled', !isActive);
        micBtn.classList.add('pulse');
        setTimeout(() => micBtn.classList.remove('pulse'), 300);
        if (localMuteBadge) {
          localMuteBadge.style.display = isActive ? 'none' : 'flex';
        }
        this.showToast(isActive ? 'Microphone unmuted' : 'Microphone muted');
      });
    }

    const cameraBtn = $('cameraBtn');
    if (cameraBtn) {
      cameraBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.unlockAudio();
        const isActive = this.onToggleVideo();
        cameraBtn.classList.toggle('disabled', !isActive);
        cameraBtn.classList.add('pulse');
        setTimeout(() => cameraBtn.classList.remove('pulse'), 300);
        const placeholder = $('localPlaceholder');
        const video = $('localVideo');
        if (placeholder) placeholder.style.display = isActive ? 'none' : 'flex';
        if (video) video.style.display = isActive ? 'block' : 'none';
        this.showToast(isActive ? 'Camera enabled' : 'Camera disabled');
      });
    }

    // Force Sync (Refresh button with 360 spin animation)
    const forceSyncBtn = $('forceSyncBtn');
    if (forceSyncBtn) {
      forceSyncBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        forceSyncBtn.classList.add('spinning');
        setTimeout(() => forceSyncBtn.classList.remove('spinning'), 650);
        this.onForceSync();
        this.showToast('Resynchronizing playback...');
      });
    }

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
    const chatReplyPreview = $('chatReplyPreview');
    const cancelReplyBtn = $('cancelReplyBtn');

    const cancelReply = () => {
      this.activeReply = null;
      if (chatReplyPreview) chatReplyPreview.style.display = 'none';
      if (chatInput) chatInput.placeholder = 'Type a message...';
    };

    if (cancelReplyBtn) {
      cancelReplyBtn.addEventListener('click', cancelReply);
    }

    const send = () => {
      const text = chatInput.value.trim();
      if (text) {
        const replyContext = this.activeReply;
        this.onSendMessage(text, replyContext);
        this.addChatMessage(this.username || 'You', text, true, replyContext, Date.now());
        if (this.isEmojiOnly(text)) {
          this.animateFloatingEmoji(text);
        }
        chatInput.value = '';
        cancelReply();
        if (fullEmojiPicker) fullEmojiPicker.style.display = 'none';
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

    // Keydown handling for Enter & Escape
    chatInput.addEventListener('keydown', (e) => {
      stopKeyLeaking(e);
      if (e.key === 'Escape') {
        cancelReply();
        return;
      }
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

    // Quick Emojis (Triggers large reaction burst & syncs to friend)
    this.shadow.querySelectorAll('.emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        if (this.onSendReaction) {
          this.onSendReaction(emoji);
        } else {
          this.onSendMessage(emoji);
        }
        this.addChatMessage(this.username || 'You', emoji, true);
        this.animateFloatingEmoji(emoji);
      });
    });

    // Full Emoji Picker Section Logic
    const fullEmojiPicker = $('fullEmojiPicker');
    const emojiPickerGrid = $('emojiPickerGrid');
    const toggleEmojiPickerBtn = $('toggleEmojiPickerBtn');
    const inlineEmojiBtn = $('inlineEmojiBtn');
    const closeEmojiPickerBtn = $('closeEmojiPickerBtn');

    const EMOJI_CATEGORIES = {
      smileys: [
        '😀','😃','😄','😁','😆','😅','😂','🤣','🥹','😇','🙂','🙃','😉','😌','😍','🥰',
        '😘','😗','😙','😚','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨',
        '😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕',
        '🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟',
        '🙁','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣',
        '😞','😓','😩','😫','🥱','😤','😡','😠','🤬','💀','🤡','👻','💩','🤖'
      ],
      gestures: [
        '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆',
        '🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️',
        '💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀',
        '👁️','👅','👄','🫂'
      ],
      hearts: [
        '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖',
        '💘','💝','💟','💌','💋','💍','💎','✨','💫','⭐','🌟','❤️‍🔥','❤️‍🩹'
      ],
      party: [
        '🍿','🎬','🎥','📽️','🎞️','🎟️','🎫','🏆','🥇','🥈','🥉','🎪','🎭','🎨','🎤','🎧',
        '🎼','🎹','🥁','🎷','🎺','🎸','🎮','🎲','🎳','🎯','🎰','🧩','🥂','🍻','🍾','🥳',
        '🎉','🎊','🎈','🔥','💥','⚡','💯','💣','🪄','🔮'
      ],
      food: [
        '🍕','🍔','🍟','🌭','🍿','🧂','🥓','🥚','🍳','🧇','🥞','🧈','🍞','🥐','🥖','🥨',
        '🥯','🧀','🥗','🥪','🌮','🌯','🍱','🍙','🍜','🍝','🍣','🥟','🍦','🍧','🍨','🍩',
        '🍪','🎂','🍰','🍫','🍬','🍭','☕','🧋','🥤','🍺','🍷','🍸','🍹','🧊'
      ]
    };

    let activeEmojiTab = 'smileys';

    const renderEmojiTab = (tabName) => {
      if (!emojiPickerGrid) return;
      activeEmojiTab = tabName;
      emojiPickerGrid.innerHTML = '';
      const list = EMOJI_CATEGORIES[tabName] || EMOJI_CATEGORIES.smileys;
      list.forEach(emoji => {
        const item = document.createElement('span');
        item.className = 'emoji-picker-item';
        item.textContent = emoji;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const start = chatInput.selectionStart ?? chatInput.value.length;
          const end = chatInput.selectionEnd ?? chatInput.value.length;
          const text = chatInput.value;
          chatInput.value = text.substring(0, start) + emoji + text.substring(end);
          chatInput.selectionStart = chatInput.selectionEnd = start + emoji.length;
          chatInput.focus();
        });
        emojiPickerGrid.appendChild(item);
      });

      this.shadow.querySelectorAll('.emoji-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
      });
    };

    const toggleEmojiPicker = (e) => {
      if (e) e.stopPropagation();
      if (!fullEmojiPicker) return;
      const isOpen = fullEmojiPicker.style.display !== 'none';
      if (isOpen) {
        fullEmojiPicker.style.display = 'none';
      } else {
        fullEmojiPicker.style.display = 'flex';
        renderEmojiTab(activeEmojiTab);
      }
    };

    toggleEmojiPickerBtn?.addEventListener('click', toggleEmojiPicker);
    inlineEmojiBtn?.addEventListener('click', toggleEmojiPicker);
    closeEmojiPickerBtn?.addEventListener('click', () => {
      if (fullEmojiPicker) fullEmojiPicker.style.display = 'none';
    });

    this.shadow.querySelectorAll('.emoji-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderEmojiTab(btn.dataset.tab);
      });
    });

    // Click on local display name to change nickname anytime
    const localLabel = $('localLabel');
    if (localLabel) {
      localLabel.addEventListener('click', () => {
        const entered = prompt('Enter your display name:', this.username);
        if (entered && entered.trim() && entered.trim() !== this.username) {
          this.setLocalUsername(entered.trim());
          this.onUpdateUsername(this.username);
          this.showToast(`Display name updated to: ${this.username}`);
        }
      });
    }
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

  setLocalUsername(name) {
    if (!name) return;
    this.username = name;
    const el = this.shadow.getElementById('localLabel');
    if (el) el.textContent = `${name} ✎`;
  }

  setRemoteUsername(name) {
    if (!name) return;
    this.remoteUsername = name;
    const el = this.shadow.getElementById('remoteLabel');
    if (el) el.textContent = name;
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
      video.style.display = 'block'; // Show video element now that it has a source
      video.play().catch(() => {});
    }
  }

  unlockAudio() {
    const audio = this.shadow?.getElementById('remoteAudio');
    if (audio) {
      audio.muted = false;
      audio.play().catch(() => {});
    }
    const video = this.shadow?.getElementById('remoteVideo');
    if (video) {
      video.muted = false;
      video.play().catch(() => {});
    }
    const badge = this.shadow?.getElementById('unmuteAudioBadge');
    if (badge) badge.style.display = 'none';

    if (this.onUnlockAudio) {
      this.onUnlockAudio();
    }
  }

  setRemoteStream(stream) {
    const video = this.shadow.getElementById('remoteVideo');
    const audio = this.shadow.getElementById('remoteAudio');
    const placeholder = this.shadow.getElementById('remotePlaceholder');
    const badge = this.shadow.getElementById('unmuteAudioBadge');

    if (video) {
      video.srcObject = stream;
      if (placeholder) placeholder.style.display = 'none';
      video.style.display = 'block';
      video.play().catch(() => {});
    }

    if (audio) {
      audio.srcObject = stream;
      audio.muted = false;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('[FlixParty] Remote audio autoplay restricted by browser:', err);
          if (badge) badge.style.display = 'block';
        });
      }
    }
  }

  // Called when P2P video failed and WS video relay is active.
  // Swaps the <video> element for a <canvas> that receives relayed frames.
  setRemoteRelayCanvas(canvas) {
    const remoteTile = this.shadow.getElementById('remoteTile');
    const placeholder = this.shadow.getElementById('remotePlaceholder');
    if (!remoteTile) return;

    // Remove existing video element (or old relay canvas) from the tile
    const oldVideo = this.shadow.getElementById('remoteVideo');
    if (oldVideo) oldVideo.style.display = 'none';

    // Check if we already inserted a relay canvas
    const existing = this.shadow.getElementById('remoteRelayCanvas');
    if (existing) existing.remove();

    canvas.id = 'remoteRelayCanvas';
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit;';
    remoteTile.appendChild(canvas);

    if (placeholder) placeholder.style.display = 'none';
  }

  setSpeaking(peer, isSpeaking) {
    const tile = this.shadow.getElementById(peer === 'local' ? 'localTile' : 'remoteTile');
    if (tile) {
      tile.classList.toggle('speaking', isSpeaking);
    }
  }

  isEmojiOnly(str) {
    if (!str || typeof str !== 'string') return false;
    const trimmed = str.trim();
    if (!trimmed) return false;
    const clean = trimmed.replace(/[\s\uFE0E\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]/gu, '');
    if (!clean) return false;
    return /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})+$/u.test(clean);
  }

  getEmojiCount(str) {
    if (!str || typeof str !== 'string') return 0;
    const match = str.match(/\p{Extended_Pictographic}|\p{Emoji_Presentation}/gu);
    return match ? match.length : 0;
  }

  setReplyTo(sender, text) {
    this.activeReply = { sender, text };
    const preview = this.shadow.getElementById('chatReplyPreview');
    const senderEl = this.shadow.getElementById('replyPreviewSender');
    const textEl = this.shadow.getElementById('replyPreviewText');
    const chatInput = this.shadow.getElementById('chatInput');

    if (senderEl) senderEl.textContent = `Replying to ${sender}`;
    if (textEl) textEl.textContent = text.length > 50 ? text.substring(0, 50) + '...' : text;
    if (preview) preview.style.display = 'flex';
    if (chatInput) {
      chatInput.placeholder = `Reply to ${sender}...`;
      chatInput.focus();
    }
  }

  addChatMessage(sender, text, isSelf = false, replyTo = null, timestamp = null) {
    const list = this.shadow.getElementById('chatList');
    if (!list) return;

    const isEmoji = this.isEmojiOnly(text);
    const count = isEmoji ? this.getEmojiCount(text) : 0;

    let emojiClass = '';
    if (isEmoji) {
      if (count === 1) {
        emojiClass = 'emoji-only single-emoji';
      } else if (count <= 3) {
        emojiClass = 'emoji-only few-emojis';
      } else {
        emojiClass = 'emoji-only';
      }
    }

    // Format timestamp: e.g. "11:28 AM"
    const date = timestamp ? new Date(timestamp) : new Date();
    const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    // WhatsApp-style quoted reply snippet
    let replyQuoteHTML = '';
    if (replyTo && replyTo.text) {
      const quoteSender = this.escapeHTML(replyTo.sender || 'Friend');
      const quoteSnippet = this.escapeHTML(replyTo.text);
      replyQuoteHTML = `
        <div class="chat-reply-quote">
          <div class="reply-quote-body">
            <div class="reply-quote-sender">${quoteSender}</div>
            <div class="reply-quote-text">${quoteSnippet}</div>
          </div>
        </div>
      `;
    }

    const msg = document.createElement('div');
    msg.className = `chat-msg ${isSelf ? 'self' : 'remote'}`;
    msg.innerHTML = `
      <div class="chat-msg-header">
        <span class="chat-msg-sender">${this.escapeHTML(sender)}</span>
        <span class="chat-msg-time">${timeStr}</span>
      </div>
      <div class="chat-bubble-container">
        <div class="chat-bubble ${emojiClass}">
          ${replyQuoteHTML}
          <div class="chat-bubble-text">${this.escapeHTML(text)}</div>
        </div>
        <button type="button" class="msg-reply-btn" title="Reply to ${this.escapeHTML(sender)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>
        </button>
      </div>
    `;

    // Wire up reply button on this message
    const replyBtn = msg.querySelector('.msg-reply-btn');
    if (replyBtn) {
      replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setReplyTo(sender, text);
      });
    }

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
    const primaryEmoji = (emoji || '🍿').trim();

    // Ensure vaporization keyframe animation exists
    if (!this.shadow.getElementById('flixVaporKeyframes')) {
      const style = document.createElement('style');
      style.id = 'flixVaporKeyframes';
      style.textContent = `
        @keyframes flixVaporStream {
          0% {
            opacity: 0;
            transform: translate3d(0, 0, 0) scale(0.35) rotate(0deg);
            filter: blur(1px) drop-shadow(0 0 4px rgba(255, 255, 255, 0.8));
          }
          14% {
            opacity: 0.95;
            transform: translate3d(var(--sway-1), -65px, 0) scale(1.15) rotate(var(--rot-1));
            filter: blur(0px) drop-shadow(0 0 12px rgba(168, 216, 74, 0.8)) drop-shadow(0 0 20px rgba(255, 255, 255, 0.45));
          }
          38% {
            opacity: 1;
            transform: translate3d(var(--sway-2), -170px, 0) scale(1.02) rotate(var(--rot-2));
            filter: blur(0px) drop-shadow(0 0 14px rgba(168, 216, 74, 0.65));
          }
          65% {
            opacity: 0.88;
            transform: translate3d(var(--sway-3), -295px, 0) scale(1.12) rotate(var(--rot-3));
            filter: blur(1.5px) drop-shadow(0 0 18px rgba(168, 216, 74, 0.5));
          }
          88% {
            opacity: 0.45;
            transform: translate3d(var(--sway-4), -410px, 0) scale(1.28) rotate(var(--rot-4));
            filter: blur(3.5px) drop-shadow(0 0 24px rgba(255, 255, 255, 0.3));
          }
          100% {
            opacity: 0;
            transform: translate3d(var(--sway-end), -490px, 0) scale(1.45) rotate(var(--rot-end));
            filter: blur(7px) drop-shadow(0 0 30px rgba(255, 255, 255, 0));
          }
        }
      `;
      this.shadow.appendChild(style);
    }

    // Position beside the chat sidebar (sidebar width is 385px from right edge)
    // When sidebar is collapsed, position near floating pill
    const baseRight = this.isCollapsed ? 45 : 405;

    // Launch a chimney stream of 14 glowing vaporizing emojis
    const particleCount = 14;
    for (let i = 0; i < particleCount; i++) {
      // Stagger delays across ~750ms to create a continuous rising vapor stream
      const delay = Math.round(i * 52 + (Math.random() * 26));

      // Varied particle sizes: micro vapor embers (18px) to medium floaters (38px)
      const size = Math.floor(18 + Math.random() * 22);

      // Duration for each particle between 2.1s and 2.7s
      const duration = (2.1 + Math.random() * 0.6).toFixed(2);

      // Horizontal spread beside the chat panel (within 45px range)
      const xSpread = Math.round((Math.random() - 0.5) * 45);
      const spawnRight = baseRight + xSpread;

      // Starting bottom near the reaction/input bar
      const spawnBottom = Math.round(75 + (Math.random() * 30 - 15));

      // Organic sway simulation for rising heat/vapor
      const swayDir = Math.random() > 0.5 ? 1 : -1;
      const swayAmp = 18 + Math.random() * 32;
      const sway1 = (swayDir * swayAmp * 0.4).toFixed(1) + 'px';
      const sway2 = (-swayDir * swayAmp * 0.75).toFixed(1) + 'px';
      const sway3 = (swayDir * swayAmp * 1.1).toFixed(1) + 'px';
      const sway4 = (-swayDir * swayAmp * 0.6).toFixed(1) + 'px';
      const swayEnd = (swayDir * swayAmp * 1.3).toFixed(1) + 'px';

      const rot1 = ((Math.random() - 0.5) * 20).toFixed(1) + 'deg';
      const rot2 = ((Math.random() - 0.5) * 35).toFixed(1) + 'deg';
      const rot3 = ((Math.random() - 0.5) * 50).toFixed(1) + 'deg';
      const rot4 = ((Math.random() - 0.5) * 70).toFixed(1) + 'deg';
      const rotEnd = ((Math.random() - 0.5) * 90).toFixed(1) + 'deg';

      setTimeout(() => {
        const floater = document.createElement('div');
        floater.textContent = primaryEmoji;
        floater.style.cssText = `
          position: fixed;
          bottom: ${spawnBottom}px;
          right: ${spawnRight}px;
          font-size: ${size}px;
          line-height: 1;
          pointer-events: none;
          z-index: 2147483647;
          user-select: none;
          will-change: transform, opacity, filter;
          --sway-1: ${sway1};
          --sway-2: ${sway2};
          --sway-3: ${sway3};
          --sway-4: ${sway4};
          --sway-end: ${swayEnd};
          --rot-1: ${rot1};
          --rot-2: ${rot2};
          --rot-3: ${rot3};
          --rot-4: ${rot4};
          --rot-end: ${rotEnd};
          animation: flixVaporStream ${duration}s cubic-bezier(0.2, 0.75, 0.35, 1) forwards;
        `;
        this.shadow.appendChild(floater);
        setTimeout(() => {
          if (floater.parentElement) floater.remove();
        }, Math.round(parseFloat(duration) * 1000) + 120);
      }, delay);
    }
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
