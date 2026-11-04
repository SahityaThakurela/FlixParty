// FlixParty - WebRTC Manager v4
// Bulletproof: P2P preferred, WebSocket relay fallback if TURN fails
// Video relay: canvas frames over WebSocket when P2P video fails

class FlixWebRTCManager {
  constructor(options = {}) {
    this.roomId = null;
    this.userId = 'user_' + Math.random().toString(36).substring(2, 9);
    this.username = options.username || 'Friend';
    this.isHost = options.isHost || false;
    this.serverUrl = options.serverUrl || 'ws://localhost:3000';

    this.peerConnection = null;
    this.dataChannel = null;
    this.localStream = null;
    this.remoteStream = null;

    this.signalingSocket = null;
    this.isConnected = false;        // true = DataChannel OR WS relay is open
    this.isP2PConnected = false;     // true = actual WebRTC P2P open
    this._useWSRelay = false;        // fallback: send data via signaling WS
    this.isAudioMuted = false;
    this.isVideoOff = false;
    this._destroyed = false;

    this.pendingCandidates = [];
    this._connectWatchdog = null;    // fires if P2P doesn't open in time
    this._offerPending = false;      // prevent double offers
    this._relayActivated = false;    // once true, stops the reconnect loop

    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._pingInterval = null;

    // Video relay over WebSocket (when P2P/TURN fails)
    this._videoRelayInterval = null; // setInterval that captures+sends frames
    this._videoRelayCanvas = null;   // offscreen canvas for frame capture
    this._videoRelayCtx = null;
    this._remoteRelayCanvas = null;  // canvas shown as remote "video"
    this._remoteRelayCtx = null;
    this._videoRelayActive = false;  // true = we are sending frames via WS

    // Audio relay over WebSocket (when P2P/TURN fails)
    this._audioRelayActive = false;
    this._relayAudioSource = null;
    this._relayAudioProcessor = null;
    this._relaySilentGain = null;
    this._remoteAudioCtx = null;
    this._nextAudioPlayTime = 0;
    this._remoteVadTimeout = null;
    this._remoteStreamAudioSource = null;

    this.audioCtx = null;
    this.localAnalyser = null;
    this.remoteAnalyser = null;
    this.vadInterval = null;

    this.callbacks = {
      onConnectionState: () => {},
      onRemoteStream: () => {},
      onLocalStream: () => {},
      onDataMessage: () => {},
      onVoiceActivity: () => {},
      onRemoteRelayCanvas: () => {}, // called when WS video relay canvas is ready
      onRemoteUsername: () => {},    // called when remote user's display name is discovered
      onLog: () => {}
    };

    // Multiple TURN servers — layered for reliability
    // If direct P2P (STUN) fails, TURN relays the traffic
    this.iceServers = [
      // Google STUN — best for direct connections
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      // Open Relay TURN — primary relay (global endpoint, more reliable)
      {
        urls: [
          'turn:global.relay.metered.ca:80',
          'turn:global.relay.metered.ca:443',
          'turn:global.relay.metered.ca:443?transport=tcp',
          'turns:global.relay.metered.ca:443'
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      // Open Relay TURN — secondary endpoint
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp',
          'turns:openrelay.metered.ca:443'
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      // Viagenie TURN — secondary relay
      {
        urls: 'turn:numb.viagenie.ca',
        username: 'webrtc@live.com',
        credential: 'muazkh'
      },
      // FreeSun TURN — tertiary relay
      {
        urls: [
          'turn:freestun.net:3478',
          'turn:freestun.net:3479',
          'turns:freestun.net:5350'
        ],
        username: 'free',
        credential: 'free'
      }
    ];
  }

  setCallback(event, fn) {
    if (this.callbacks[event] !== undefined) {
      this.callbacks[event] = fn;
    }
  }

  setUsername(name) {
    if (name) {
      this.username = name;
      this.sendData({ type: 'USER_INTRO', username: this.username, userId: this.userId });
    }
  }

  log(msg, type = 'info') {
    console.log(`[FlixParty] ${msg}`);
    this.callbacks.onLog(msg, type);
  }

  // ── Local Media ──────────────────────────────────────────────────────────────

  async initMedia(videoEnabled = true, audioEnabled = true) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoEnabled ? {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 24, max: 30 }
        } : false,
        audio: audioEnabled ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } : false
      });

      this.localStream = stream;
      this.localStream.getAudioTracks().forEach(t => { t.enabled = !this.isAudioMuted; });
      this.callbacks.onLocalStream(stream);
      this.setupVoiceActivityDetection(stream, true);

      if (this.peerConnection && this.peerConnection.signalingState !== 'closed') {
        this._attachLocalTracks();
      }
      if (this._useWSRelay) {
        this._startAudioRelay();
      }
      return stream;
    } catch (err) {
      this.log(`Media error with constraints: ${err.message}, trying basic constraints`, 'warn');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoEnabled,
          audio: audioEnabled
        });
        this.localStream = stream;
        this.localStream.getAudioTracks().forEach(t => { t.enabled = !this.isAudioMuted; });
        this.callbacks.onLocalStream(stream);
        this.setupVoiceActivityDetection(stream, true);
        if (this.peerConnection && this.peerConnection.signalingState !== 'closed') {
          this._attachLocalTracks();
        }
        if (this._useWSRelay) {
          this._startAudioRelay();
        }
        return stream;
      } catch (err2) {
        this.log(`Media init fallback failed: ${err2.message}`, 'error');
        if (videoEnabled) {
          try { return await this.initMedia(false, audioEnabled); } catch (e) {}
        }
        return null;
      }
    }
  }

  _attachLocalTracks() {
    if (!this.localStream || !this.peerConnection) return;
    if (this.peerConnection.signalingState === 'closed') return;
    const senders = this.peerConnection.getSenders();
    this.localStream.getTracks().forEach(track => {
      if (track.kind === 'audio') {
        track.enabled = !this.isAudioMuted;
      } else if (track.kind === 'video') {
        track.enabled = !this.isVideoOff;
      }
      const existing = senders.find(s => s.track && s.track.kind === track.kind);
      if (existing) {
        existing.replaceTrack(track).catch(() => {});
      } else {
        const emptySender = senders.find(s => !s.track);
        if (emptySender) {
          emptySender.replaceTrack(track).catch(() => {});
        } else {
          try { this.peerConnection.addTrack(track, this.localStream); } catch (e) {}
        }
      }
    });
  }

  // ── Voice Activity Detection ──────────────────────────────────────────────────

  setupVoiceActivityDetection(stream, isLocal) {
    try {
      if (!stream || stream.getAudioTracks().length === 0) return;
      if (!this.audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new Ctx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      const source = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      if (isLocal) {
        this._localVadSource = source;
        this.localAnalyser = analyser;
      } else {
        this._remoteVadSource = source;
        this.remoteAnalyser = analyser;
      }
      if (!this.vadInterval) {
        const pcm = new Uint8Array(128);
        this.vadInterval = setInterval(() => {
          if (this.localAnalyser && !this.isAudioMuted) {
            this.localAnalyser.getByteFrequencyData(pcm);
            this.callbacks.onVoiceActivity('local', pcm.reduce((a, v) => a + v, 0) / pcm.length > 18);
          }
          if (this.remoteAnalyser) {
            this.remoteAnalyser.getByteFrequencyData(pcm);
            this.callbacks.onVoiceActivity('remote', pcm.reduce((a, v) => a + v, 0) / pcm.length > 18);
          }
        }, 120);
      }
    } catch (e) {}
  }

  resumeAudioContext() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    if (this._remoteAudioCtx && this._remoteAudioCtx.state === 'suspended') {
      this._remoteAudioCtx.resume().catch(() => {});
    }
  }

  playRemoteAudioWithWebAudio(stream) {
    try {
      if (!stream || stream.getAudioTracks().length === 0) return;
      if (!this._remoteAudioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this._remoteAudioCtx = new Ctx();
      }
      if (this._remoteAudioCtx.state === 'suspended') {
        this._remoteAudioCtx.resume().catch(() => {});
      }
      if (this._remoteStreamAudioSource) {
        try { this._remoteStreamAudioSource.disconnect(); } catch (e) {}
      }
      this._remoteStreamAudioSource = this._remoteAudioCtx.createMediaStreamSource(stream);
      this._remoteStreamAudioSource.connect(this._remoteAudioCtx.destination);
      this.log('Web Audio pipeline connected for remote stream audio');
    } catch (e) {
      this.log(`Web Audio stream error: ${e.message}`, 'warn');
    }
  }

  // ── Media Controls ────────────────────────────────────────────────────────────

  toggleAudio() {
    if (!this.localStream) return false;
    const tracks = this.localStream.getAudioTracks();
    if (!tracks.length) return false;
    this.isAudioMuted = !this.isAudioMuted;
    tracks.forEach(t => { t.enabled = !this.isAudioMuted; });
    return !this.isAudioMuted;
  }

  toggleVideo() {
    if (!this.localStream) return false;
    const tracks = this.localStream.getVideoTracks();
    if (!tracks.length) return false;
    this.isVideoOff = !this.isVideoOff;
    tracks.forEach(t => { t.enabled = !this.isVideoOff; });
    return !this.isVideoOff;
  }

  // ── Signaling ─────────────────────────────────────────────────────────────────

  connectToSignaling(roomId, isHost) {
    this.roomId = roomId;
    this.isHost = isHost;
    this._destroyed = false;
    this._reconnectAttempts = 0;
    this._doConnect();
  }

  _doConnect() {
    if (this._destroyed) return;
    if (this.signalingSocket) {
      try { this.signalingSocket.close(); } catch (e) {}
      this.signalingSocket = null;
    }

    this.log(`Connecting to ${this.serverUrl}`);
    try {
      this.signalingSocket = new WebSocket(this.serverUrl);
    } catch (e) {
      this.log(`WS URL invalid: ${e.message}`, 'error');
      this.callbacks.onConnectionState('signaling_error');
      return;
    }

    this.signalingSocket.onopen = () => {
      this._reconnectAttempts = 0;
      this.log('Signaling connected ✓');
      this.callbacks.onConnectionState('signaling_connected');
      this._wsSend({
        type: 'JOIN_ROOM',
        roomId: this.roomId,
        userId: this.userId,
        username: this.username,
        isHost: this.isHost
      });
      if (this._pingInterval) clearInterval(this._pingInterval);
      this._pingInterval = setInterval(() => {
        this._wsSend({ type: 'PING' });
      }, 20000);
    };

    this.signalingSocket.onmessage = async (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (x) { return; }
      await this._onSignaling(msg);
    };

    this.signalingSocket.onerror = () => {
      this.log('Signaling error', 'warn');
      this.callbacks.onConnectionState('signaling_error');
    };

    this.signalingSocket.onclose = () => {
      this.log('Signaling closed');
      if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
      if (!this._destroyed && this._reconnectAttempts < 6) {
        const delay = Math.min(2000 * Math.pow(1.5, this._reconnectAttempts), 15000);
        this._reconnectAttempts++;
        this.log(`Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this._reconnectAttempts})`);
        this._reconnectTimer = setTimeout(() => this._doConnect(), delay);
      }
    };
  }

  _wsSend(obj) {
    try {
      if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
        this.signalingSocket.send(JSON.stringify(obj));
      }
    } catch (e) {}
  }

  // ── Signaling Handler ─────────────────────────────────────────────────────────

  async _onSignaling(msg) {
    this.log(`◀ ${msg.type}`);

    switch (msg.type) {
      case 'PONG': break; // keepalive reply

      case 'ROOM_JOINED': {
        this.log(`In room. Peers: ${msg.peerCount - 1}`);
        this.callbacks.onConnectionState('signaling_connected');
        if (msg.peers && msg.peers.length > 0) {
          const peer = msg.peers[0];
          const name = typeof peer === 'object' ? peer.username : null;
          if (name) {
            this.callbacks.onRemoteUsername(name);
          }
        }
        // Host reconnected and peer is already there — resend offer
        if (msg.peerCount > 1 && this.isHost) {
          await this._doOffer();
        }
        // Guest reconnected — ask host to resend offer
        if (msg.peerCount > 1 && !this.isHost) {
          this._wsSend({ type: 'REQUEST_OFFER', roomId: this.roomId, fromUserId: this.userId });
        }
        break;
      }

      case 'REQUEST_OFFER': {
        // Host received this from guest who reconnected
        if (this.isHost) {
          this.log('Guest requested offer — sending');
          await this._doOffer();
        }
        break;
      }

      case 'PEER_JOINED': {
        this.log(`Peer joined: ${msg.username}`);
        if (msg.username) {
          this.callbacks.onRemoteUsername(msg.username);
        }
        this.callbacks.onConnectionState('peer_joined', { username: msg.username });
        if (this.isHost) {
          await this._doOffer();
        }
        break;
      }

      case 'OFFER': {
        if (this.isHost) break; // Only guest handles offers
        this.log('Received OFFER from host');
        // Only show "Connecting..." if relay isn't already active (prevents loop)
        if (!this._relayActivated) {
          this.callbacks.onConnectionState('peer_joined');
        }
        await this._doAnswer(msg);
        break;
      }

      case 'ANSWER': {
        if (!this.isHost || !this.peerConnection) break;
        if (this.peerConnection.signalingState !== 'have-local-offer') {
          this.log(`Ignoring ANSWER (state: ${this.peerConnection.signalingState})`, 'warn');
          break;
        }
        try {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          await this._drainCandidates();
        } catch (e) {
          this.log(`setRemoteDesc(answer) error: ${e.message}`, 'error');
        }
        break;
      }

      case 'ICE_CANDIDATE': {
        if (!msg.candidate) break;
        const ready = this.peerConnection &&
          this.peerConnection.remoteDescription &&
          this.peerConnection.remoteDescription.type &&
          this.peerConnection.signalingState !== 'closed';
        if (ready) {
          try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch (e) {
            this.log(`addIceCandidate: ${e.message}`, 'warn');
          }
        } else {
          this.pendingCandidates.push(msg.candidate);
        }
        break;
      }

      case 'PEER_LEFT': {
        this.log('Peer left');
        this._useWSRelay = false;
        this.callbacks.onConnectionState('peer_left');
        this._closePeerConnection();
        break;
      }

      // ── WebSocket Data Relay fallback ──────────────────────────────────────
      // If P2P DataChannel can't open, we relay sync messages through signaling WS
      case 'WS_DATA': {
        if (msg.fromUserId !== this.userId) {
          this.callbacks.onDataMessage(msg.payload);
        }
        break;
      }

      // ── WebSocket Video Relay ──────────────────────────────────────────────
      // When P2P video (TURN) fails, we relay compressed video frames via WS
      case 'WS_VIDEO': {
        if (msg.fromUserId !== this.userId) {
          this._renderRelayFrame(msg.frame);
        }
        break;
      }

      // ── WebSocket Audio Relay ──────────────────────────────────────────────
      // When P2P audio fails or in WS relay mode, play relayed voice frames
      case 'WS_AUDIO': {
        if (msg.fromUserId !== this.userId && msg.pcm) {
          this._renderRelayAudio(msg.pcm, msg.sampleRate || 16000);
        }
        break;
      }
    }
  }

  // ── Offer / Answer ────────────────────────────────────────────────────────────

  async _doOffer() {
    if (this._offerPending) {
      this.log('Offer already in flight, skipping', 'warn');
      return;
    }
    this._offerPending = true;

    try {
      // Close old connection but preserve pending ICE queue
      const savedCandidates = [...this.pendingCandidates];
      this._closeConnectionOnly();
      this.pendingCandidates = savedCandidates;

      await this._createPC();

      // Wait up to 2 seconds for camera to be ready
      for (let i = 0; i < 20 && !this.localStream; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      this._attachLocalTracks();

      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await this.peerConnection.setLocalDescription(offer);
      this._sendSignaling({ type: 'OFFER', sdp: offer });
      this.log('▶ OFFER sent');

      // Start connection watchdog — if no DC open in 20s, retry
      this._startWatchdog();
    } catch (e) {
      this.log(`_doOffer error: ${e.message}`, 'error');
    } finally {
      this._offerPending = false;
    }
  }

  async _doAnswer(offerMsg) {
    try {
      const savedCandidates = [...this.pendingCandidates];
      this._closeConnectionOnly();
      this.pendingCandidates = savedCandidates;

      await this._createPC();

      // Wait up to 2 seconds for camera
      for (let i = 0; i < 20 && !this.localStream; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      this._attachLocalTracks();

      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offerMsg.sdp));
      await this._drainCandidates();

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      this._sendSignaling({
        type: 'ANSWER',
        sdp: answer,
        targetUserId: offerMsg.fromUserId
      });
      this.log('▶ ANSWER sent');

      // Guest watchdog too — if no DC in 20s, request a new offer
      this._startWatchdog();
    } catch (e) {
      this.log(`_doAnswer error: ${e.message}`, 'error');
    }
  }

  // Watchdog: if DataChannel doesn't open in 12s, activate WS relay fallback
  _startWatchdog() {
    if (this._relayActivated) return; // Relay already active — no need for watchdog
    if (this._connectWatchdog) clearTimeout(this._connectWatchdog);
    this._connectWatchdog = setTimeout(() => {
      if (this.isP2PConnected) return; // Already connected — all good
      this.log('⚠ P2P timeout (12s) — activating WS relay fallback', 'warn');
      this._activateWSRelay();
    }, 12000);
  }

  _clearWatchdog() {
    if (this._connectWatchdog) {
      clearTimeout(this._connectWatchdog);
      this._connectWatchdog = null;
    }
  }

  // Activate WebSocket relay mode — sync data goes through signaling server
  // IMPORTANT: This must only run ONCE per session — _relayActivated flag prevents re-entry
  _activateWSRelay() {
    if (this._relayActivated) return; // Guard: only activate once — stops the reconnect loop
    this._relayActivated = true;
    this._useWSRelay = true;
    this.isConnected = true; // Data path is available (via WS)
    this._clearWatchdog();
    this.callbacks.onConnectionState('connected'); // Show as connected
    this.log('WS relay active — sync/chat works. Starting video & audio relay too.');
    // Send USER_INTRO exactly once so both sides show each other's names
    this.sendData({ type: 'USER_INTRO', username: this.username, userId: this.userId });
    // Start video & audio relay over WebSocket — works without P2P/TURN
    this._startVideoRelay();
    this._startAudioRelay();
    // Do NOT retry P2P here — ICE continues negotiating in background.
    // If it eventually succeeds, DataChannel.onopen will switch us back to P2P.
  }

  // ── PeerConnection ────────────────────────────────────────────────────────────

  _closeConnectionOnly() {
    if (this.dataChannel) {
      try { this.dataChannel.close(); } catch (e) {}
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      try { this.peerConnection.close(); } catch (e) {}
      this.peerConnection = null;
    }
    this.isP2PConnected = false;
    // Keep isConnected = true if WS relay is active
    if (!this._useWSRelay) this.isConnected = false;
  }

  _closePeerConnection() {
    this._closeConnectionOnly();
    this.pendingCandidates = [];
    this._useWSRelay = false;
    this._relayActivated = false; // Reset so next party session can activate relay again
    this.isConnected = false;
  }

  async _createPC() {
    if (this.peerConnection && this.peerConnection.signalingState !== 'closed') return;

    this.log('Creating RTCPeerConnection');
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });

    try {
      this.peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
      this.peerConnection.addTransceiver('video', { direction: 'sendrecv' });
    } catch (e) {}

    if (this.localStream) {
      this._attachLocalTracks();
    }

    this.peerConnection.ontrack = (event) => {
      this.log(`Remote track: ${event.track.kind}`);
      if (!this.remoteStream) {
        this.remoteStream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream();
      }
      if (!this.remoteStream.getTracks().includes(event.track)) {
        this.remoteStream.addTrack(event.track);
      }
      this.callbacks.onRemoteStream(this.remoteStream);
      if (event.track.kind === 'audio') {
        this.playRemoteAudioWithWebAudio(this.remoteStream);
        this.setupVoiceActivityDetection(this.remoteStream, false);
      }
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this._sendSignaling({
          type: 'ICE_CANDIDATE',
          candidate: event.candidate.toJSON()
        });
      } else {
        this.log('ICE gathering complete');
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      if (!this.peerConnection) return;
      const state = this.peerConnection.iceConnectionState;
      this.log(`ICE: ${state}`);

      if (state === 'connected' || state === 'completed') {
        this.isP2PConnected = true;
        this.isConnected = true;
        this._useWSRelay = false; // Switch back to P2P if it eventually works
        this._clearWatchdog();
        this.callbacks.onConnectionState('connected');
      } else if (state === 'failed') {
        this.log('ICE failed', 'warn');
        if (this._relayActivated) {
          this.log('ICE failed but WS relay is active — staying on relay', 'warn');
          return; // Don't retry — it would just loop
        }
        if (this.isHost) {
          // Restart ICE first
          try {
            this.peerConnection.restartIce();
            this.peerConnection.createOffer({ iceRestart: true }).then(o => {
              return this.peerConnection.setLocalDescription(o).then(() => {
                this._sendSignaling({ type: 'OFFER', sdp: o });
              });
            }).catch(() => {
              // Full restart
              setTimeout(() => this._doOffer(), 1000);
            });
          } catch (e) {
            setTimeout(() => this._doOffer(), 1000);
          }
        } else {
          // Guest signals host to resend offer
          this._wsSend({ type: 'REQUEST_OFFER', roomId: this.roomId, fromUserId: this.userId });
        }
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      if (!this.peerConnection) return;
      const state = this.peerConnection.connectionState;
      this.log(`P2P: ${state}`);
      if (state === 'connected') {
        this.isP2PConnected = true;
        this.isConnected = true;
        this._clearWatchdog();
        this.callbacks.onConnectionState('connected');
      } else if (state === 'failed') {
        if (this._relayActivated) {
          this.log('P2P connection failed but WS relay is active — staying on relay', 'warn');
          return;
        }
        if (this.isHost) setTimeout(() => this._doOffer(), 1500);
        else this._wsSend({ type: 'REQUEST_OFFER', roomId: this.roomId, fromUserId: this.userId });
      }
    };

    if (this.isHost) {
      this.dataChannel = this.peerConnection.createDataChannel('flixparty-sync', { ordered: true });
      this._setupDataChannel(this.dataChannel);
    } else {
      this.peerConnection.ondatachannel = (e) => {
        this.log('DataChannel received ✓');
        this.dataChannel = e.channel;
        this._setupDataChannel(this.dataChannel);
      };
    }
  }

  async _drainCandidates() {
    if (!this.peerConnection || this.peerConnection.signalingState === 'closed') return;
    this.log(`Draining ${this.pendingCandidates.length} ICE candidates`);
    while (this.pendingCandidates.length > 0) {
      const c = this.pendingCandidates.shift();
      if (!c) continue;
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        this.log(`Candidate drain error: ${e.message}`, 'warn');
      }
    }
  }

  // ── DataChannel ───────────────────────────────────────────────────────────────

  _setupDataChannel(ch) {
    ch.onopen = () => {
      this.log('DataChannel OPEN ✓ — P2P sync active!');
      this.isP2PConnected = true;
      this.isConnected = true;
      this._useWSRelay = false;
      this._clearWatchdog();
      this._stopVideoRelay(); // P2P connected — stop WS video relay, use P2P video instead
      this._stopAudioRelay(); // P2P connected — stop WS audio relay, use P2P audio instead
      this.callbacks.onConnectionState('connected');
      this.sendData({ type: 'USER_INTRO', username: this.username, userId: this.userId });
    };

    ch.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        this.callbacks.onDataMessage(data);
      } catch (x) {}
    };

    ch.onclose = () => {
      this.log('DataChannel closed');
      this.isP2PConnected = false;
      if (!this._useWSRelay) this.isConnected = false;
    };

    ch.onerror = (e) => console.error('[FlixParty DC error]', e);
  }

  // Send data via DataChannel (P2P) or WebSocket relay (fallback)
  sendData(payload) {
    const msg = { from: this.userId, timestamp: Date.now(), ...payload };

    // Try DataChannel first (low latency P2P)
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify(msg));
        return true;
      } catch (e) {
        this.log(`DC send error: ${e.message}`, 'warn');
      }
    }

    // Fallback: relay through signaling WebSocket
    if (this._useWSRelay) {
      this._wsSend({
        type: 'WS_DATA',
        roomId: this.roomId,
        fromUserId: this.userId,
        payload: msg
      });
      return true;
    }

    return false;
  }

  // ── WebSocket Video Relay ─────────────────────────────────────────────────────
  // When P2P video can't establish (NAT/TURN failure), capture frames from the
  // local <video> element using a canvas, compress to JPEG, and send via WS.
  // The remote side receives WS_VIDEO frames and draws them on a canvas.
  // Quality: 240p @ ~5fps — good enough to see faces, low bandwidth.

  _startVideoRelay() {
    if (this._videoRelayActive || this._destroyed) return;
    if (!this.localStream || this.localStream.getVideoTracks().length === 0) return;

    this._videoRelayActive = true;
    this.log('📡 Video relay via WebSocket started (5fps, 240p)');

    // Offscreen canvas for capturing local video frames
    this._videoRelayCanvas = document.createElement('canvas');
    this._videoRelayCanvas.width = 320;
    this._videoRelayCanvas.height = 240;
    this._videoRelayCtx = this._videoRelayCanvas.getContext('2d');

    // Create a hidden <video> element to draw from (gets localStream)
    this._relaySourceVideo = document.createElement('video');
    this._relaySourceVideo.srcObject = this.localStream;
    this._relaySourceVideo.muted = true;
    this._relaySourceVideo.play().catch(() => {});

    // Send frames at 5fps (200ms interval)
    this._videoRelayInterval = setInterval(() => {
      if (!this._videoRelayActive || this._destroyed) return;
      if (this.isP2PConnected) {
        // P2P came back — stop relay
        this._stopVideoRelay();
        return;
      }
      if (this.isVideoOff) return;
      try {
        const v = this._relaySourceVideo;
        if (!v || v.readyState < 2 || v.videoWidth === 0) return;
        this._videoRelayCtx.drawImage(v, 0, 0, 320, 240);
        // JPEG at 35% quality — ~4-8 KB per frame, ~200 Kbps at 5fps
        const frame = this._videoRelayCanvas.toDataURL('image/jpeg', 0.35);
        this._wsSend({
          type: 'WS_VIDEO',
          roomId: this.roomId,
          fromUserId: this.userId,
          frame
        });
      } catch (e) {}
    }, 200);
  }

  _stopVideoRelay() {
    this._videoRelayActive = false;
    if (this._videoRelayInterval) {
      clearInterval(this._videoRelayInterval);
      this._videoRelayInterval = null;
    }
    if (this._relaySourceVideo) {
      this._relaySourceVideo.srcObject = null;
      this._relaySourceVideo = null;
    }
    this._videoRelayCanvas = null;
    this._videoRelayCtx = null;
  }

  _renderRelayFrame(dataUrl) {
    // Draw received frame onto a canvas that acts as the "remote video"
    if (!dataUrl) return;
    if (!this._remoteRelayCanvas) {
      // First frame received — create canvas and notify sidebar
      this._remoteRelayCanvas = document.createElement('canvas');
      this._remoteRelayCanvas.width = 320;
      this._remoteRelayCanvas.height = 240;
      this._remoteRelayCanvas.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      this._remoteRelayCtx = this._remoteRelayCanvas.getContext('2d');
      // Notify sidebar to use this canvas as the remote video element
      this.callbacks.onRemoteRelayCanvas(this._remoteRelayCanvas);
      this.log('📡 Receiving remote video via WebSocket relay');
    }
    const img = new Image();
    img.onload = () => {
      if (this._remoteRelayCtx) {
        this._remoteRelayCtx.drawImage(img, 0, 0, 320, 240);
      }
    };
    img.src = dataUrl;
  }

  // ── WebSocket Audio Relay ─────────────────────────────────────────────────────
  // When P2P audio can't establish, capture mic audio, convert to 16kHz 16-bit PCM,
  // and stream over WebSocket. The peer queues it into an AudioContext jitter buffer.

  _startAudioRelay() {
    if (this._audioRelayActive || this._destroyed) return;
    if (!this.localStream || this.localStream.getAudioTracks().length === 0) return;

    this._audioRelayActive = true;
    this.log('🎤 Audio relay via WebSocket started (16kHz PCM)');

    try {
      if (!this.audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new Ctx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      this._relayAudioSource = this.audioCtx.createMediaStreamSource(this.localStream);
      // ScriptProcessor buffer of 2048 gives ~42ms audio frames
      this._relayAudioProcessor = this.audioCtx.createScriptProcessor(2048, 1, 1);

      this._relayAudioProcessor.onaudioprocess = (e) => {
        if (!this._audioRelayActive || this._destroyed) return;
        if (this.isP2PConnected) {
          this._stopAudioRelay();
          return;
        }
        if (this.isAudioMuted) return;

        const input = e.inputBuffer.getChannelData(0);
        const downsampled = this._downsampleAudio(input, this.audioCtx.sampleRate, 16000);

        // Simple VAD: skip silent chunks to minimize bandwidth
        let maxVal = 0;
        for (let i = 0; i < downsampled.length; i++) {
          const abs = Math.abs(downsampled[i]);
          if (abs > maxVal) maxVal = abs;
        }
        if (maxVal < 0.012) {
          return;
        }

        const pcm16 = new Int16Array(downsampled.length);
        for (let i = 0; i < downsampled.length; i++) {
          const s = Math.max(-1, Math.min(1, downsampled[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const base64 = this._int16ToBase64(pcm16);
        this._wsSend({
          type: 'WS_AUDIO',
          roomId: this.roomId,
          fromUserId: this.userId,
          pcm: base64,
          sampleRate: 16000
        });
      };

      // Connect to silent gain to keep onaudioprocess running without local feedback
      this._relaySilentGain = this.audioCtx.createGain();
      this._relaySilentGain.gain.value = 0;
      this._relayAudioSource.connect(this._relayAudioProcessor);
      this._relayAudioProcessor.connect(this._relaySilentGain);
      this._relaySilentGain.connect(this.audioCtx.destination);
    } catch (err) {
      this.log(`_startAudioRelay error: ${err.message}`, 'warn');
    }
  }

  _stopAudioRelay() {
    this._audioRelayActive = false;
    if (this._relayAudioProcessor) {
      try { this._relayAudioProcessor.disconnect(); } catch (e) {}
      this._relayAudioProcessor = null;
    }
    if (this._relayAudioSource) {
      try { this._relayAudioSource.disconnect(); } catch (e) {}
      this._relayAudioSource = null;
    }
    if (this._relaySilentGain) {
      try { this._relaySilentGain.disconnect(); } catch (e) {}
      this._relaySilentGain = null;
    }
  }

  _downsampleAudio(buffer, fromRate, toRate) {
    if (fromRate === toRate) return buffer;
    const ratio = fromRate / toRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  _int16ToBase64(int16Array) {
    const bytes = new Uint8Array(int16Array.buffer, int16Array.byteOffset, int16Array.byteLength);
    let binary = '';
    const len = bytes.byteLength;
    const chunkSize = 0x8000;
    for (let i = 0; i < len; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
    }
    return btoa(binary);
  }

  _base64ToInt16(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  }

  _renderRelayAudio(base64pcm, sampleRate = 16000) {
    if (this._destroyed || this.isP2PConnected) return;

    try {
      if (!this._remoteAudioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this._remoteAudioCtx = new Ctx();
      }
      if (this._remoteAudioCtx.state === 'suspended') {
        this._remoteAudioCtx.resume().catch(() => {});
      }

      const pcm16 = this._base64ToInt16(base64pcm);
      if (!pcm16 || pcm16.length === 0) return;

      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }

      const buffer = this._remoteAudioCtx.createBuffer(1, float32.length, sampleRate);
      buffer.getChannelData(0).set(float32);

      const source = this._remoteAudioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this._remoteAudioCtx.destination);

      const now = this._remoteAudioCtx.currentTime;
      if (!this._nextAudioPlayTime || this._nextAudioPlayTime < now) {
        this._nextAudioPlayTime = now + 0.02; // 20ms jitter buffer
      }

      source.start(this._nextAudioPlayTime);
      this._nextAudioPlayTime += buffer.duration;

      // Update voice activity indicator for remote friend!
      this.callbacks.onVoiceActivity('remote', true);
      if (this._remoteVadTimeout) clearTimeout(this._remoteVadTimeout);
      this._remoteVadTimeout = setTimeout(() => {
        this.callbacks.onVoiceActivity('remote', false);
      }, 250);
    } catch (e) {
      console.warn('[FlixParty] Audio relay render error:', e);
    }
  }

  // ── Signaling Send ────────────────────────────────────────────────────────────

  _sendSignaling(payload) {
    this._wsSend({
      roomId: this.roomId,
      fromUserId: this.userId,
      ...payload
    });
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  disconnect() {
    this._destroyed = true;
    this._clearWatchdog();
    this._stopVideoRelay();
    this._stopAudioRelay();
    if (this._remoteAudioCtx) {
      try { this._remoteAudioCtx.close(); } catch (e) {}
      this._remoteAudioCtx = null;
    }
    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch (e) {}
      this.audioCtx = null;
    }
    if (this._remoteVadTimeout) {
      clearTimeout(this._remoteVadTimeout);
      this._remoteVadTimeout = null;
    }
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
    if (this.vadInterval) { clearInterval(this.vadInterval); this.vadInterval = null; }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    this._closePeerConnection();
    if (this.signalingSocket) {
      try { this.signalingSocket.close(); } catch (e) {}
      this.signalingSocket = null;
    }
    this.callbacks.onConnectionState('closed');
  }
}
