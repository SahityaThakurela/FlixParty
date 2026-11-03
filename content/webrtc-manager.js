// FlixParty - WebRTC Manager (v3 — bulletproof P2P connection)
// Complete rewrite to fix all race conditions and connection failures

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
    this.isConnected = false;
    this.isAudioMuted = false;
    this.isVideoOff = false;
    this._destroyed = false;

    // ICE candidate queue — never wiped during renegotiation
    this.pendingCandidates = [];

    // Guard against concurrent offer/answer creation
    this._negotiating = false;

    // Reconnection tracking
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._pingInterval = null;

    // Audio analyzers for voice activity detection
    this.audioCtx = null;
    this.localAnalyser = null;
    this.remoteAnalyser = null;
    this.vadInterval = null;

    // Event callbacks
    this.callbacks = {
      onConnectionState: () => {},
      onRemoteStream: () => {},
      onLocalStream: () => {},
      onDataMessage: () => {},
      onVoiceActivity: () => {},
      onLog: () => {}
    };

    // TURN servers — using free Open Relay Project (works across NAT)
    // Also adding Metered and Cloudflare STUN for best coverage
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turns:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ];
  }

  setCallback(event, fn) {
    if (this.callbacks[event] !== undefined) {
      this.callbacks[event] = fn;
    }
  }

  log(msg, type = 'info') {
    console.log(`[FlixParty WebRTC] ${msg}`);
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
      this.callbacks.onLocalStream(stream);
      this.setupVoiceActivityDetection(stream, true);

      // If peerConnection already exists (e.g. offer arrived before camera ready), attach tracks now
      if (this.peerConnection && this.peerConnection.signalingState !== 'closed') {
        this._attachLocalTracks();
      }

      return stream;
    } catch (err) {
      this.log(`Camera/Mic access error: ${err.message}`, 'warn');
      // Fallback: try audio-only
      if (videoEnabled) {
        try { return await this.initMedia(false, audioEnabled); } catch (e) {}
      }
      return null;
    }
  }

  _attachLocalTracks() {
    if (!this.localStream || !this.peerConnection) return;
    if (this.peerConnection.signalingState === 'closed') return;

    const senders = this.peerConnection.getSenders();
    this.localStream.getTracks().forEach(track => {
      const existing = senders.find(s => s.track && s.track.kind === track.kind);
      if (existing) {
        existing.replaceTrack(track).catch(e => {
          console.warn('[FlixParty] replaceTrack error:', e.message);
        });
      } else {
        try {
          this.peerConnection.addTrack(track, this.localStream);
        } catch (e) {
          console.warn('[FlixParty] addTrack error:', e.message);
        }
      }
    });
  }

  // ── Voice Activity Detection ──────────────────────────────────────────────────

  setupVoiceActivityDetection(stream, isLocal) {
    try {
      if (!stream || stream.getAudioTracks().length === 0) return;
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContextClass();
      }

      const source = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      if (isLocal) this.localAnalyser = analyser;
      else this.remoteAnalyser = analyser;

      if (!this.vadInterval) {
        const pcmData = new Uint8Array(128);
        this.vadInterval = setInterval(() => {
          if (this.localAnalyser && !this.isAudioMuted) {
            this.localAnalyser.getByteFrequencyData(pcmData);
            const avg = pcmData.reduce((a, v) => a + v, 0) / pcmData.length;
            this.callbacks.onVoiceActivity('local', avg > 18);
          }
          if (this.remoteAnalyser) {
            this.remoteAnalyser.getByteFrequencyData(pcmData);
            const avg = pcmData.reduce((a, v) => a + v, 0) / pcmData.length;
            this.callbacks.onVoiceActivity('remote', avg > 18);
          }
        }, 120);
      }
    } catch (e) { /* AudioContext may need user gesture */ }
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

  // ── Signaling Connection ──────────────────────────────────────────────────────

  connectToSignaling(roomId, isHost) {
    this.roomId = roomId;
    this.isHost = isHost;
    this._destroyed = false;
    this._reconnectAttempts = 0;
    this._doConnect();
  }

  _doConnect() {
    if (this._destroyed) return;

    // Close stale socket
    if (this.signalingSocket) {
      try { this.signalingSocket.close(); } catch (e) {}
      this.signalingSocket = null;
    }

    this.log(`Connecting to signaling: ${this.serverUrl}`);

    try {
      this.signalingSocket = new WebSocket(this.serverUrl);
    } catch (e) {
      this.log(`WebSocket URL invalid: ${e.message}`, 'error');
      this.callbacks.onConnectionState('signaling_error');
      return;
    }

    this.signalingSocket.onopen = () => {
      this._reconnectAttempts = 0;
      this.log('Signaling connected ✓');
      this.callbacks.onConnectionState('signaling_connected');

      // Join room
      this._wsSend({
        type: 'JOIN_ROOM',
        roomId: this.roomId,
        userId: this.userId,
        username: this.username,
        isHost: this.isHost
      });

      // Keepalive ping — Render.com drops WS after 55s idle
      if (this._pingInterval) clearInterval(this._pingInterval);
      this._pingInterval = setInterval(() => {
        if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
          this._wsSend({ type: 'PING' });
        }
      }, 20000);
    };

    this.signalingSocket.onmessage = async (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      await this._handleSignalingMessage(msg);
    };

    this.signalingSocket.onerror = () => {
      this.log('Signaling error', 'warn');
      this.callbacks.onConnectionState('signaling_error');
    };

    this.signalingSocket.onclose = () => {
      this.log('Signaling closed');
      if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
      if (!this._destroyed && this._reconnectAttempts < 5) {
        const delay = Math.min(2000 * Math.pow(1.5, this._reconnectAttempts), 15000);
        this._reconnectAttempts++;
        this.log(`Reconnecting in ${Math.round(delay / 1000)}s...`);
        this._reconnectTimer = setTimeout(() => this._doConnect(), delay);
      }
    };
  }

  // Raw WS send helper
  _wsSend(obj) {
    try {
      if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
        this.signalingSocket.send(JSON.stringify(obj));
      }
    } catch (e) { /* ignore */ }
  }

  // ── Signaling Message Handler ─────────────────────────────────────────────────

  async _handleSignalingMessage(msg) {
    this.log(`[Signaling RX] ${msg.type}`);

    switch (msg.type) {

      case 'PONG':
        // keepalive reply — ignore
        break;

      case 'ROOM_JOINED': {
        this.log(`Joined room ${this.roomId}. Peers present: ${msg.peerCount - 1}`);
        this.callbacks.onConnectionState('signaling_connected');

        // If host joins and peer is already in the room, send offer immediately
        if (msg.peerCount > 1 && this.isHost) {
          this.log('Host rejoining — peer already present, creating offer now');
          await this._doOffer();
        }
        break;
      }

      case 'PEER_JOINED': {
        this.log(`Peer joined: ${msg.username || 'Friend'}`);
        this.callbacks.onConnectionState('peer_joined');

        if (this.isHost) {
          // Host is always the one who creates the offer
          this.log('Host sending offer to joining peer');
          await this._doOffer();
        }
        // Guest just waits for the OFFER message from host
        break;
      }

      case 'OFFER': {
        // Only the guest (non-host) handles incoming OFFERs
        if (this.isHost) break;
        this.log('Guest received OFFER — creating answer');
        this.callbacks.onConnectionState('peer_joined');
        await this._doAnswer(msg);
        break;
      }

      case 'ANSWER': {
        // Only the host handles the incoming ANSWER
        if (!this.isHost) break;
        if (!this.peerConnection) break;

        const state = this.peerConnection.signalingState;
        if (state !== 'have-local-offer') {
          this.log(`Ignoring ANSWER in state: ${state}`, 'warn');
          break;
        }

        this.log('Host received ANSWER — setting remote description');
        try {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          // Flush any ICE candidates that arrived before the remote desc was set
          await this._drainCandidates();
        } catch (e) {
          this.log(`setRemoteDescription(answer) error: ${e.message}`, 'error');
        }
        break;
      }

      case 'ICE_CANDIDATE': {
        if (!msg.candidate) break;
        const candidate = msg.candidate;

        // FIX: Check both peerConnection existence AND remoteDescription is set
        const readyToAdd = this.peerConnection &&
          this.peerConnection.remoteDescription &&
          this.peerConnection.remoteDescription.type &&
          this.peerConnection.signalingState !== 'closed';

        if (readyToAdd) {
          try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            this.log(`ICE candidate added directly`);
          } catch (e) {
            this.log(`addIceCandidate error: ${e.message}`, 'warn');
          }
        } else {
          // Queue for later — will be drained after remote desc is set
          this.pendingCandidates.push(candidate);
          this.log(`ICE candidate queued (${this.pendingCandidates.length} pending)`);
        }
        break;
      }

      case 'PEER_LEFT': {
        this.log('Peer left', 'warn');
        this.callbacks.onConnectionState('peer_left');
        this._closePeerConnection();
        break;
      }
    }
  }

  // ── Offer / Answer Flow ───────────────────────────────────────────────────────

  // HOST creates and sends an SDP offer
  async _doOffer() {
    if (this._negotiating) {
      this.log('Already negotiating, skipping duplicate offer', 'warn');
      return;
    }
    this._negotiating = true;

    try {
      // Close any old connection — but preserve pendingCandidates queue!
      const saved = this.pendingCandidates.slice();
      this._closeConnectionOnly();
      this.pendingCandidates = saved;

      await this._createPC();

      // Wait up to 2s for camera/mic to be ready
      if (!this.localStream) {
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 100));
          if (this.localStream) break;
        }
      }
      this._attachLocalTracks();

      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await this.peerConnection.setLocalDescription(offer);

      this._sendSignaling({ type: 'OFFER', sdp: offer });
      this.log('Offer sent to guest');
    } catch (e) {
      this.log(`_doOffer error: ${e.message}`, 'error');
    } finally {
      this._negotiating = false;
    }
  }

  // GUEST creates and sends an SDP answer
  async _doAnswer(offerMsg) {
    if (this._negotiating) {
      this.log('Already negotiating, skipping duplicate answer', 'warn');
      return;
    }
    this._negotiating = true;

    try {
      // Close any old connection — preserve queued ICE candidates
      const saved = this.pendingCandidates.slice();
      this._closeConnectionOnly();
      this.pendingCandidates = saved;

      await this._createPC();

      // Wait up to 2s for camera/mic to be ready BEFORE setting remote desc
      if (!this.localStream) {
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 100));
          if (this.localStream) break;
        }
      }
      this._attachLocalTracks();

      // Set remote desc (the offer from host)
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offerMsg.sdp));

      // Now drain any candidates that arrived before remote desc was set
      await this._drainCandidates();

      // Create and set local desc (our answer)
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      // Send answer back to host
      this._sendSignaling({
        type: 'ANSWER',
        sdp: answer,
        targetUserId: offerMsg.fromUserId
      });
      this.log('Answer sent to host');
    } catch (e) {
      this.log(`_doAnswer error: ${e.message}`, 'error');
    } finally {
      this._negotiating = false;
    }
  }

  // ── PeerConnection Lifecycle ──────────────────────────────────────────────────

  // Only close the RTCPeerConnection — don't touch pendingCandidates
  _closeConnectionOnly() {
    if (this.dataChannel) {
      try { this.dataChannel.close(); } catch (e) {}
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      try { this.peerConnection.close(); } catch (e) {}
      this.peerConnection = null;
    }
    this.isConnected = false;
  }

  // Full close including candidate queue (used when peer actually leaves)
  _closePeerConnection() {
    this._closeConnectionOnly();
    this.pendingCandidates = [];
  }

  async _createPC() {
    if (this.peerConnection && this.peerConnection.signalingState !== 'closed') return;

    this.log('Creating new RTCPeerConnection');
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: 'all',       // try STUN first, fall back to TURN
      bundlePolicy: 'max-bundle',      // bundle audio/video/data on one connection
      rtcpMuxPolicy: 'require'
    });

    // Attach local stream if already available
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        try { this.peerConnection.addTrack(track, this.localStream); } catch (e) {}
      });
    }

    // Receive remote tracks
    this.peerConnection.ontrack = (event) => {
      this.log(`Remote track: ${event.track.kind}`);
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else {
        if (!this.remoteStream) this.remoteStream = new MediaStream();
        this.remoteStream.addTrack(event.track);
      }
      this.callbacks.onRemoteStream(this.remoteStream);
      this.setupVoiceActivityDetection(this.remoteStream, false);
    };

    // Send ICE candidates to the peer via signaling
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.log(`Local ICE candidate: ${event.candidate.type || 'unknown'}`);
        this._sendSignaling({
          type: 'ICE_CANDIDATE',
          candidate: event.candidate.toJSON()
        });
      } else {
        this.log('ICE gathering complete');
      }
    };

    this.peerConnection.onicegatheringstatechange = () => {
      this.log(`ICE gathering: ${this.peerConnection ? this.peerConnection.iceGatheringState : '?'}`);
    };

    // ICE connection state — main signal for P2P up/down
    this.peerConnection.oniceconnectionstatechange = () => {
      if (!this.peerConnection) return;
      const state = this.peerConnection.iceConnectionState;
      this.log(`ICE connection: ${state}`);
      if (state === 'connected' || state === 'completed') {
        this.isConnected = true;
        this.callbacks.onConnectionState('connected');
      } else if (state === 'failed') {
        this.log('ICE failed — restarting ICE', 'warn');
        this.callbacks.onConnectionState('ice_failed');
        // Auto-restart: host creates a new offer with iceRestart
        if (this.isHost) {
          this._iceRestart();
        }
      } else if (state === 'disconnected') {
        this.log('ICE temporarily disconnected — waiting', 'warn');
        // Don't emit peer_left here — give it time to recover
      } else if (state === 'closed') {
        this.isConnected = false;
      }
    };

    // Overall P2P connection state
    this.peerConnection.onconnectionstatechange = () => {
      if (!this.peerConnection) return;
      const state = this.peerConnection.connectionState;
      this.log(`P2P connection: ${state}`);
      if (state === 'connected') {
        this.isConnected = true;
        this.callbacks.onConnectionState('connected');
      } else if (state === 'failed') {
        this.log('P2P failed — attempting recovery', 'warn');
        if (this.isHost) {
          setTimeout(() => this._doOffer(), 1000);
        }
      }
    };

    // DataChannel setup
    if (this.isHost) {
      // Host creates the DataChannel
      this.dataChannel = this.peerConnection.createDataChannel('flixparty-sync', {
        ordered: true,
        negotiated: false
      });
      this._setupDataChannel(this.dataChannel);
    } else {
      // Guest receives the DataChannel
      this.peerConnection.ondatachannel = (event) => {
        this.log('DataChannel received by guest');
        this.dataChannel = event.channel;
        this._setupDataChannel(this.dataChannel);
      };
    }
  }

  // ICE restart: host creates a new offer with iceRestart=true
  async _iceRestart() {
    if (!this.peerConnection || this.peerConnection.signalingState === 'closed') {
      await this._doOffer();
      return;
    }
    try {
      this.log('Performing ICE restart');
      const offer = await this.peerConnection.createOffer({
        iceRestart: true,
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await this.peerConnection.setLocalDescription(offer);
      this._sendSignaling({ type: 'OFFER', sdp: offer });
    } catch (e) {
      this.log(`ICE restart failed: ${e.message}`, 'error');
      // Fall back to full renegotiation
      await this._doOffer();
    }
  }

  // Drain queued ICE candidates
  async _drainCandidates() {
    if (!this.peerConnection || this.peerConnection.signalingState === 'closed') return;
    this.log(`Draining ${this.pendingCandidates.length} queued ICE candidates`);
    while (this.pendingCandidates.length > 0) {
      const c = this.pendingCandidates.shift();
      if (!c) continue;
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        this.log(`Pending candidate error: ${e.message}`, 'warn');
      }
    }
  }

  // ── DataChannel ───────────────────────────────────────────────────────────────

  _setupDataChannel(channel) {
    channel.onopen = () => {
      this.log('DataChannel OPEN ✓ — sync active');
      this.isConnected = true;
      this.callbacks.onConnectionState('connected');
      // Introduce ourselves
      this.sendData({ type: 'USER_INTRO', username: this.username, userId: this.userId });
    };

    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.callbacks.onDataMessage(data);
      } catch (e) {
        console.error('[FlixParty] DataChannel parse error:', e);
      }
    };

    channel.onclose = () => {
      this.log('DataChannel closed');
      this.isConnected = false;
    };

    channel.onerror = (err) => {
      console.error('[FlixParty] DataChannel error:', err);
    };
  }

  sendData(payload) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify({
          from: this.userId,
          timestamp: Date.now(),
          ...payload
        }));
        return true;
      } catch (e) {
        console.warn('[FlixParty] sendData error:', e.message);
      }
    }
    return false;
  }

  // ── Signaling Send ────────────────────────────────────────────────────────────

  _sendSignaling(payload) {
    const msg = JSON.stringify({
      roomId: this.roomId,
      fromUserId: this.userId,
      ...payload
    });
    if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
      this.signalingSocket.send(msg);
    } else {
      this.log('Cannot send signaling — socket not open', 'warn');
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  disconnect() {
    this._destroyed = true;

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
