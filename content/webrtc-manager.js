// FlixParty - WebRTC Manager (v2 — robust signaling + reconnect)
// Handles P2P Video/Audio streaming, DataChannel sync, and Signaling

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

    // Audio analyzers for voice activity detection
    this.audioCtx = null;
    this.localAnalyser = null;
    this.remoteAnalyser = null;
    this.vadInterval = null;
    this.pendingCandidates = [];

    // Reconnection tracking
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;

    // Event callbacks
    this.callbacks = {
      onConnectionState: () => {},
      onRemoteStream: () => {},
      onLocalStream: () => {},
      onDataMessage: () => {},
      onVoiceActivity: () => {},
      onLog: () => {}
    };

    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.relay.metered.ca:80' },
      {
        urls: 'turn:standard.relay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:standard.relay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:standard.relay.metered.ca:443?transport=tcp',
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

  // ── Local Media ─────────────────────────────────────────────────────────────

  async initMedia(videoEnabled = true, audioEnabled = true) {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: videoEnabled ? {
          width: { ideal: 480, max: 640 },
          height: { ideal: 360, max: 480 },
          frameRate: { ideal: 24, max: 30 }
        } : false,
        audio: audioEnabled ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } : false
      });

      this.callbacks.onLocalStream(this.localStream);
      this.setupVoiceActivityDetection(this.localStream, true);

      // If peerConnection already exists, attach tracks now
      if (this.peerConnection) {
        this._attachLocalTracks();
      }

      return this.localStream;
    } catch (err) {
      this.log(`Camera/Mic access error: ${err.message}`, 'warn');
      if (videoEnabled && audioEnabled) {
        try { return await this.initMedia(false, true); } catch (e) {}
      }
      return null;
    }
  }

  _attachLocalTracks() {
    if (!this.localStream || !this.peerConnection) return;
    const senders = this.peerConnection.getSenders();
    this.localStream.getTracks().forEach(track => {
      const existingSender = senders.find(s => s.track && s.track.kind === track.kind);
      if (existingSender) {
        existingSender.replaceTrack(track).catch(() => {});
      } else {
        this.peerConnection.addTrack(track, this.localStream);
      }
    });
  }

  // ── Voice Activity Detection ─────────────────────────────────────────────────

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

  // ── Media Controls ───────────────────────────────────────────────────────────

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

  // ── Signaling Connection ─────────────────────────────────────────────────────

  connectToSignaling(roomId, isHost) {
    this.roomId = roomId;
    this.isHost = isHost;
    this._destroyed = false;
    this._doConnect();
  }

  _doConnect() {
    if (this._destroyed) return;

    // Close stale socket if any
    if (this.signalingSocket) {
      try { this.signalingSocket.close(); } catch (e) {}
      this.signalingSocket = null;
    }

    this.log(`Connecting to signaling server: ${this.serverUrl}`);

    try {
      this.signalingSocket = new WebSocket(this.serverUrl);
    } catch (e) {
      this.log(`WebSocket URL invalid: ${e.message}`, 'error');
      this.callbacks.onConnectionState('signaling_error');
      return;
    }

    this.signalingSocket.onopen = () => {
      this._reconnectAttempts = 0;
      this.log('Connected to signaling server ✓');
      this.callbacks.onConnectionState('signaling_connected');

      this.signalingSocket.send(JSON.stringify({
        type: 'JOIN_ROOM',
        roomId: this.roomId,
        userId: this.userId,
        username: this.username,
        isHost: this.isHost
      }));
    };

    this.signalingSocket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await this._handleSignalingMessage(msg);
      } catch (err) {
        console.error('[FlixParty] Signaling parse error:', err);
      }
    };

    this.signalingSocket.onerror = () => {
      this.log('Signaling server error', 'warn');
      this.callbacks.onConnectionState('signaling_error');
    };

    this.signalingSocket.onclose = () => {
      this.log('Signaling connection closed');
      if (!this._destroyed && this._reconnectAttempts < 5) {
        const delay = Math.min(2000 * Math.pow(1.5, this._reconnectAttempts), 15000);
        this._reconnectAttempts++;
        this.log(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this._reconnectAttempts})...`);
        this._reconnectTimer = setTimeout(() => this._doConnect(), delay);
      }
    };
  }

  // ── Signaling Message Handler ────────────────────────────────────────────────

  async _handleSignalingMessage(msg) {
    switch (msg.type) {

      case 'ROOM_JOINED': {
        this.log(`Joined room: ${this.roomId} — peers already present: ${msg.peerCount - 1}`);
        this.callbacks.onConnectionState('signaling_connected');

        // If we joined and there are already peers in the room:
        // - If we're the host, send OFFER to each existing peer
        // - If we're the guest, just wait — host will send OFFER when they see PEER_JOINED
        if (msg.peerCount > 1 && this.isHost) {
          this.log('Host rejoining with peer already in room — sending offer');
          await this._resetAndOffer();
        }
        break;
      }

      case 'PEER_JOINED': {
        this.log(`Peer joined: ${msg.username || 'Friend'} (isHost: ${msg.isHost})`);
        this.callbacks.onConnectionState('peer_joined');

        if (this.isHost) {
          // We are the host — create and send offer to the joining guest
          this.log('Host detected guest join — creating offer');
          await this._resetAndOffer();
        }
        // If we're the guest, do nothing — wait for OFFER from host
        break;
      }

      case 'OFFER': {
        if (!this.isHost) {
          this.log('Received OFFER from host — creating answer');
          await this._handleOffer(msg);
        }
        break;
      }

      case 'ANSWER': {
        if (this.isHost && this.peerConnection) {
          this.log('Received ANSWER from guest');
          if (this.peerConnection.signalingState !== 'have-local-offer') {
            this.log(`Ignoring ANSWER — unexpected signalingState: ${this.peerConnection.signalingState}`, 'warn');
            break;
          }
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          await this._drainPendingCandidates();
        }
        break;
      }

      case 'ICE_CANDIDATE': {
        if (!msg.candidate) break;
        if (this.peerConnection && this.peerConnection.remoteDescription && this.peerConnection.remoteDescription.type) {
          try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch (e) {
            console.warn('[FlixParty] addIceCandidate error:', e.message);
          }
        } else {
          this.pendingCandidates.push(msg.candidate);
        }
        break;
      }

      case 'PEER_LEFT': {
        this.log('Peer left the party', 'warn');
        this.callbacks.onConnectionState('peer_left');
        // Close and clean up peer connection so we're ready for next join
        this._closePeerConnection();
        break;
      }
    }
  }

  // ── PeerConnection Lifecycle ─────────────────────────────────────────────────

  _closePeerConnection() {
    if (this.dataChannel) {
      try { this.dataChannel.close(); } catch (e) {}
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      try { this.peerConnection.close(); } catch (e) {}
      this.peerConnection = null;
    }
    this.pendingCandidates = [];
    this.isConnected = false;
  }

  async _resetAndOffer() {
    this._closePeerConnection();
    await this._createPeerConnection();

    // Wait up to 1s for local stream to be ready
    if (!this.localStream) {
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (this.localStream) break;
      }
    }

    this._attachLocalTracks();
    await this._createAndSendOffer();
  }

  async _createPeerConnection() {
    if (this.peerConnection) return;

    this.peerConnection = new RTCPeerConnection({ iceServers: this.iceServers });

    // Attach local media
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    // Remote media
    this.peerConnection.ontrack = (event) => {
      this.log(`Remote track received: ${event.track.kind}`);
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else {
        if (!this.remoteStream) this.remoteStream = new MediaStream();
        this.remoteStream.addTrack(event.track);
      }
      this.callbacks.onRemoteStream(this.remoteStream);
      this.setupVoiceActivityDetection(this.remoteStream, false);
    };

    // ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this._sendSignaling({ type: 'ICE_CANDIDATE', candidate: event.candidate });
      }
    };

    // ICE connection state
    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection ? this.peerConnection.iceConnectionState : '?';
      this.log(`ICE state: ${state}`);
      if (state === 'connected' || state === 'completed') {
        this.isConnected = true;
        this.callbacks.onConnectionState('connected');
      } else if (state === 'failed') {
        this.log('ICE failed — trying restart', 'warn');
        // Try ICE restart
        if (this.isHost && this.peerConnection) {
          this.peerConnection.restartIce();
          this._createAndSendOffer(true).catch(() => {});
        }
      } else if (state === 'disconnected') {
        this.callbacks.onConnectionState('peer_left');
      }
    };

    // P2P connection state
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection ? this.peerConnection.connectionState : '?';
      this.log(`P2P state: ${state}`);
      if (state === 'connected') {
        this.isConnected = true;
        this.callbacks.onConnectionState('connected');
      } else if (state === 'failed') {
        this.callbacks.onConnectionState('peer_left');
        this._closePeerConnection();
      }
    };

    // DataChannel
    if (this.isHost) {
      this.dataChannel = this.peerConnection.createDataChannel('flixparty-sync', {
        ordered: true
      });
      this._setupDataChannel(this.dataChannel);
    } else {
      this.peerConnection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this._setupDataChannel(this.dataChannel);
      };
    }
  }

  async _handleOffer(msg) {
    this._closePeerConnection();
    await this._createPeerConnection();

    // Attach local tracks before answering
    this._attachLocalTracks();

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    await this._drainPendingCandidates();

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    this._sendSignaling({
      type: 'ANSWER',
      sdp: answer,
      targetUserId: msg.fromUserId
    });
  }

  async _createAndSendOffer(iceRestart = false) {
    if (!this.peerConnection) return;
    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
      iceRestart
    });
    await this.peerConnection.setLocalDescription(offer);
    this._sendSignaling({ type: 'OFFER', sdp: offer });
  }

  async _drainPendingCandidates() {
    while (this.pendingCandidates.length > 0) {
      const c = this.pendingCandidates.shift();
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        console.warn('[FlixParty] Pending candidate error:', e.message);
      }
    }
  }

  // ── DataChannel ──────────────────────────────────────────────────────────────

  _setupDataChannel(channel) {
    channel.onopen = () => {
      this.log('DataChannel open — zero-lag sync active! ✓');
      this.isConnected = true;
      this.callbacks.onConnectionState('connected');
      this.sendData({ type: 'USER_INTRO', username: this.username, userId: this.userId });
    };

    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.callbacks.onDataMessage(data);
      } catch (err) {
        console.error('[FlixParty] DataChannel parse error:', err);
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
      this.dataChannel.send(JSON.stringify({
        from: this.userId,
        timestamp: Date.now(),
        ...payload
      }));
      return true;
    }
    return false;
  }

  // ── Signaling Send ───────────────────────────────────────────────────────────

  _sendSignaling(payload) {
    if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
      this.signalingSocket.send(JSON.stringify({
        roomId: this.roomId,
        fromUserId: this.userId,
        ...payload
      }));
    } else {
      this.log('Cannot send — signaling socket not open', 'warn');
    }
  }

  // ── Disconnect / Cleanup ─────────────────────────────────────────────────────

  disconnect() {
    this._destroyed = true;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

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
