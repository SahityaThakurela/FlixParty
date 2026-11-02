// FlixParty - WebRTC Manager
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

    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
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

  // Initialize Local Camera & Microphone
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
      return this.localStream;
    } catch (err) {
      this.log(`Camera/Mic access note: ${err.message}`, 'warn');
      // If camera blocked, try audio only
      if (videoEnabled && audioEnabled) {
        try {
          return await this.initMedia(false, true);
        } catch (e) {
          // No media available, continue with data-only watch party
        }
      }
      return null;
    }
  }

  // Voice Activity Detection (Detects when speaking to pulse avatar aura)
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
            const sum = pcmData.reduce((acc, val) => acc + val, 0);
            const avg = sum / pcmData.length;
            this.callbacks.onVoiceActivity('local', avg > 18);
          }
          if (this.remoteAnalyser) {
            this.remoteAnalyser.getByteFrequencyData(pcmData);
            const sum = pcmData.reduce((acc, val) => acc + val, 0);
            const avg = sum / pcmData.length;
            this.callbacks.onVoiceActivity('remote', avg > 18);
          }
        }, 120);
      }
    } catch (e) {
      // AudioContext may be restricted until user gesture
    }
  }

  // Toggle Microphone Mute
  toggleAudio() {
    if (!this.localStream) return false;
    const audioTracks = this.localStream.getAudioTracks();
    if (audioTracks.length === 0) return false;

    this.isAudioMuted = !this.isAudioMuted;
    audioTracks.forEach(track => {
      track.enabled = !this.isAudioMuted;
    });
    return !this.isAudioMuted; // Returns active status
  }

  // Toggle Webcam On/Off
  toggleVideo() {
    if (!this.localStream) return false;
    const videoTracks = this.localStream.getVideoTracks();
    if (videoTracks.length === 0) return false;

    this.isVideoOff = !this.isVideoOff;
    videoTracks.forEach(track => {
      track.enabled = !this.isVideoOff;
    });
    return !this.isVideoOff; // Returns active status
  }

  // Connect via Signaling Server
  connectToSignaling(roomId, isHost) {
    this.roomId = roomId;
    this.isHost = isHost;

    try {
      this.log(`Connecting to signaling server: ${this.serverUrl}`);
      this.signalingSocket = new WebSocket(this.serverUrl);

      this.signalingSocket.onopen = () => {
        this.log('Connected to signaling server');
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
          await this.handleSignalingMessage(msg);
        } catch (err) {
          console.error('[FlixParty] Signaling message parse error:', err);
        }
      };

      this.signalingSocket.onerror = (err) => {
        this.log('Signaling server connection error. Ensure signaling server is running.', 'warn');
        this.callbacks.onConnectionState('signaling_error');
      };

      this.signalingSocket.onclose = () => {
        this.log('Signaling connection closed');
      };
    } catch (e) {
      this.log(`Signaling setup failed: ${e.message}`, 'error');
    }
  }

  // Handle incoming signaling messages
  async handleSignalingMessage(msg) {
    switch (msg.type) {
      case 'ROOM_JOINED':
        this.log(`Joined room: ${this.roomId}`);
        if (msg.peerCount > 1 && this.isHost) {
          // If we are host and another peer is in room, initiate offer
          await this.createPeerConnection();
          await this.createAndSendOffer();
        }
        break;

      case 'PEER_JOINED':
        this.log(`Friend joined party: ${msg.username || 'Friend'}`);
        if (this.isHost) {
          await this.createPeerConnection();
          await this.createAndSendOffer();
        }
        break;

      case 'OFFER':
        if (!this.isHost) {
          await this.createPeerConnection();
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          const answer = await this.peerConnection.createAnswer();
          await this.peerConnection.setLocalDescription(answer);
          this.sendSignalingMessage({
            type: 'ANSWER',
            sdp: answer,
            targetUserId: msg.fromUserId
          });
        }
        break;

      case 'ANSWER':
        if (this.peerConnection) {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        }
        break;

      case 'ICE_CANDIDATE':
        if (this.peerConnection && msg.candidate) {
          try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch (e) {
            console.error('Error adding ICE candidate:', e);
          }
        }
        break;

      case 'PEER_LEFT':
        this.log('Friend disconnected from party', 'warn');
        this.callbacks.onConnectionState('disconnected');
        break;
    }
  }

  sendSignalingMessage(payload) {
    if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
      this.signalingSocket.send(JSON.stringify({
        roomId: this.roomId,
        fromUserId: this.userId,
        ...payload
      }));
    }
  }

  // Create PeerConnection & Media Setup
  async createPeerConnection() {
    if (this.peerConnection) return;

    this.peerConnection = new RTCPeerConnection({ iceServers: this.iceServers });

    // Attach local media tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    // Handle remote media tracks
    this.peerConnection.ontrack = (event) => {
      this.log('Received remote media stream');
      this.remoteStream = event.streams[0];
      this.callbacks.onRemoteStream(this.remoteStream);
      this.setupVoiceActivityDetection(this.remoteStream, false);
    };

    // Send ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignalingMessage({
          type: 'ICE_CANDIDATE',
          candidate: event.candidate
        });
      }
    };

    // Connection state monitor
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      this.log(`P2P Connection State: ${state}`);
      this.isConnected = (state === 'connected');
      this.callbacks.onConnectionState(state);
    };

    // Setup DataChannel
    if (this.isHost) {
      this.dataChannel = this.peerConnection.createDataChannel('flixparty-sync', { ordered: true });
      this.setupDataChannel(this.dataChannel);
    } else {
      this.peerConnection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel(this.dataChannel);
      };
    }
  }

  async createAndSendOffer() {
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    this.sendSignalingMessage({
      type: 'OFFER',
      sdp: offer
    });
  }

  // Setup WebRTC DataChannel listeners
  setupDataChannel(channel) {
    channel.onopen = () => {
      this.log('P2P DataChannel connected - Zero-lag sync active!');
      this.callbacks.onConnectionState('connected');
      // Announce username
      this.sendData({
        type: 'USER_INTRO',
        username: this.username,
        userId: this.userId
      });
    };

    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.callbacks.onDataMessage(data);
      } catch (err) {
        console.error('Error parsing DataChannel message:', err);
      }
    };

    channel.onclose = () => {
      this.log('DataChannel closed');
    };
  }

  // Send packet across WebRTC DataChannel (Sub-millisecond latency)
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

  // Disconnect & cleanup all resources
  disconnect() {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.signalingSocket) {
      this.signalingSocket.close();
      this.signalingSocket = null;
    }

    this.isConnected = false;
    this.callbacks.onConnectionState('closed');
  }
}

