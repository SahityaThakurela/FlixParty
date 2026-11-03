// FlixParty - WebRTC Signaling Server (using 'ws' npm package for reliability)
// Deploy to Render: set start command to "node server.js"
// Render auto-runs "npm install" before start.

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

        // Remove stale entry for same userId (reconnect scenario)
        if (room.has(currentUserId)) {
          room.delete(currentUserId);
        }

        room.set(currentUserId, { ws, send, username: msg.username, isHost: msg.isHost });

        console.log(`[Signaling] ${msg.username} (${currentUserId}) joined room ${currentRoomId} — peers: ${room.size}`);

        // Tell the joiner how many peers are present
        send({
          type: 'ROOM_JOINED',
          roomId: currentRoomId,
          peerCount: room.size,
          peers: [...room.keys()].filter(id => id !== currentUserId)
        });

        // Tell everyone else that a new peer joined
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
      case 'ICE_CANDIDATE': {
        const room = rooms.get(currentRoomId);
        if (!room) return;

        console.log(`[Signaling] Relaying ${msg.type} from ${currentUserId} in ${currentRoomId} to ${room.size - 1} peer(s)`);

        // If a targetUserId is specified, send only to them; otherwise broadcast
        if (msg.targetUserId) {
          const peer = room.get(msg.targetUserId);
          if (peer) {
            peer.send({ fromUserId: currentUserId, ...msg });
          }
        } else {
          broadcast(currentRoomId, currentUserId, { fromUserId: currentUserId, ...msg });
        }
        break;
      }

      default:
        // Forward any unknown message types to peers (future-proofing)
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
    console.log(`[Signaling] ${currentUserId} left room ${currentRoomId} — remaining: ${room.size}`);

    broadcast(currentRoomId, currentUserId, {
      type: 'PEER_LEFT',
      fromUserId: currentUserId
    });

    if (room.size === 0) {
      rooms.delete(currentRoomId);
      console.log(`[Signaling] Room ${currentRoomId} closed`);
    }
  });

  ws.on('error', (err) => {
    console.error('[Signaling] Socket error:', err.message);
  });
});

httpServer.listen(PORT, () => {
  console.log('===============================================');
  console.log('🎬 FlixParty Signaling Server (ws package)');
  console.log(`🚀 Port: ${PORT}`);
  console.log(`🌐 WebSocket: ws://localhost:${PORT}`);
  console.log('===============================================');
});
