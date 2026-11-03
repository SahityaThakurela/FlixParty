// FlixParty - WebRTC Signaling Server v3
// Robust relay for OFFER/ANSWER/ICE between host and guest

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// Room registry: Map<roomId, Map<userId, {ws, username, isHost}>>
const rooms = new Map();

// ── HTTP Health Check ──────────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify({
    service: 'FlixParty Signaling Server',
    status: 'online',
    activeRooms: rooms.size,
    timestamp: new Date().toISOString()
  }));
});

// ── WebSocket Server ───────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  let currentRoomId = null;
  let currentUserId = null;

  // Helper: send JSON to this client
  const send = (obj) => {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(obj));
      }
    } catch (e) { /* ignore */ }
  };

  // Helper: broadcast to all OTHER peers in same room
  const broadcast = (roomId, senderId, obj) => {
    const room = rooms.get(roomId);
    if (!room) return;
    for (const [peerId, peer] of room.entries()) {
      if (peerId !== senderId) {
        try {
          if (peer.ws.readyState === peer.ws.OPEN) {
            peer.ws.send(JSON.stringify(obj));
          }
        } catch (e) { /* ignore */ }
      }
    }
  };

  // Helper: send to a specific peer by userId
  const sendToPeer = (roomId, targetUserId, obj) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const peer = room.get(targetUserId);
    if (peer) {
      try {
        if (peer.ws.readyState === peer.ws.OPEN) {
          peer.ws.send(JSON.stringify(obj));
        }
      } catch (e) { /* ignore */ }
    }
  };

  ws.on('message', (rawData) => {
    let msg;
    try {
      msg = JSON.parse(rawData.toString());
    } catch (err) {
      console.error('[Signaling] JSON parse error:', err.message);
      return;
    }

    switch (msg.type) {

      case 'JOIN_ROOM': {
        currentRoomId = msg.roomId;
        currentUserId = msg.userId;

        if (!rooms.has(currentRoomId)) {
          rooms.set(currentRoomId, new Map());
        }

        const room = rooms.get(currentRoomId);

        // Remove stale entry for same userId (reconnect)
        if (room.has(currentUserId)) {
          room.delete(currentUserId);
        }

        room.set(currentUserId, { ws, send, username: msg.username, isHost: msg.isHost });
        console.log(`[Room ${currentRoomId}] ${msg.username} (${msg.isHost ? 'HOST' : 'GUEST'}) joined — total: ${room.size}`);

        // Tell the joiner how many peers are already present
        send({
          type: 'ROOM_JOINED',
          roomId: currentRoomId,
          peerCount: room.size,
          peers: [...room.keys()].filter(id => id !== currentUserId)
        });

        // Notify all OTHER peers
        broadcast(currentRoomId, currentUserId, {
          type: 'PEER_JOINED',
          fromUserId: currentUserId,
          username: msg.username,
          isHost: msg.isHost
        });
        break;
      }

      case 'OFFER':
      case 'ANSWER':
      case 'ICE_CANDIDATE':
      case 'REQUEST_OFFER':
      case 'WS_DATA':
      case 'WS_VIDEO': {
        if (!currentRoomId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;

        if (msg.type !== 'WS_DATA' && msg.type !== 'WS_VIDEO') {
          console.log(`[Room ${currentRoomId}] Relay ${msg.type} from ${currentUserId}`);
        }

        // Targeted relay (ANSWER goes to specific host userId)
        if (msg.targetUserId) {
          sendToPeer(currentRoomId, msg.targetUserId, { fromUserId: currentUserId, ...msg });
        } else {
          broadcast(currentRoomId, currentUserId, { fromUserId: currentUserId, ...msg });
        }
        break;
      }

      case 'PING':
        send({ type: 'PONG' });
        break;

      default:
        // Forward unknown message types to all peers (future-proofing)
        if (currentRoomId) {
          broadcast(currentRoomId, currentUserId, { fromUserId: currentUserId, ...msg });
        }
        break;
    }
  });

  ws.on('close', () => {
    if (!currentRoomId || !currentUserId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    room.delete(currentUserId);
    console.log(`[Room ${currentRoomId}] ${currentUserId} disconnected — remaining: ${room.size}`);

    broadcast(currentRoomId, currentUserId, {
      type: 'PEER_LEFT',
      fromUserId: currentUserId
    });

    if (room.size === 0) {
      rooms.delete(currentRoomId);
      console.log(`[Room ${currentRoomId}] closed`);
    }
  });

  ws.on('error', (err) => {
    console.error('[Signaling] Socket error:', err.message);
  });
});

httpServer.listen(PORT, () => {
  console.log('======================================');
  console.log('🎬 FlixParty Signaling Server v3');
  console.log(`🚀 Port: ${PORT}`);
  console.log('======================================');
});
