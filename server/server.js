// FlixParty - Lightweight Zero-Dependency WebSocket Signaling Server
// Can be run instantly with: node server.js (no npm install required!)
// Or deployed to Render, Railway, Glitch, Heroku, or VPS.

const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// Room registry: Map<roomId, Map<userId, socket>>
const rooms = new Map();

// Helper to encode a string into a WebSocket unmasked text frame
function encodeWebSocketFrame(dataStr) {
  const payload = Buffer.from(dataStr, 'utf8');
  const length = payload.length;

  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text opcode
    header[1] = length;
  } else if (length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

// Decode incoming WebSocket masked frame from client
function decodeWebSocketFrame(buffer) {
  if (buffer.length < 2) return null;

  const firstByte = buffer[0];
  const secondByte = buffer[1];

  const opcode = firstByte & 0x0f;
  const isMasked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < 4) return null;
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null;
    payloadLength = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  if (!isMasked) return null; // Client frames must be masked

  if (buffer.length < offset + 4 + payloadLength) return null;

  const maskKey = buffer.slice(offset, offset + 4);
  offset += 4;

  const payload = buffer.slice(offset, offset + payloadLength);
  const unmasked = Buffer.alloc(payloadLength);

  for (let i = 0; i < payloadLength; i++) {
    unmasked[i] = payload[i] ^ maskKey[i % 4];
  }

  return { opcode, payload: unmasked.toString('utf8'), totalLength: offset + payloadLength };
}

// Create HTTP server
const server = http.createServer((req, res) => {
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

// Handle WebSocket upgrade
server.on('upgrade', (req, socket, head) => {
  const clientKey = req.headers['sec-websocket-key'];
  if (!clientKey) {
    socket.destroy();
    return;
  }

  // Generate Sec-WebSocket-Accept hash
  const acceptKey = crypto
    .createHash('sha1')
    .update(clientKey + WS_GUID)
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`
  ];

  socket.write(headers.join('\r\n') + '\r\n\r\n');

  let currentRoomId = null;
  let currentUserId = null;
  let incomingBuffer = Buffer.alloc(0);

  // Send message helper
  const send = (msgObj) => {
    try {
      if (!socket.destroyed) {
        socket.write(encodeWebSocketFrame(JSON.stringify(msgObj)));
      }
    } catch (e) {
      // Socket may have disconnected
    }
  };

  // Socket data processing
  socket.on('data', (chunk) => {
    incomingBuffer = Buffer.concat([incomingBuffer, chunk]);

    while (incomingBuffer.length > 0) {
      const frame = decodeWebSocketFrame(incomingBuffer);
      if (!frame) break;

      incomingBuffer = incomingBuffer.slice(frame.totalLength);

      // Handle Ping (opcode 0x9) -> Send Pong (opcode 0xA)
      if (frame.opcode === 0x9) {
        const pong = Buffer.from([0x8a, 0x00]);
        socket.write(pong);
        continue;
      }

      // Handle Close (opcode 0x8)
      if (frame.opcode === 0x8) {
        socket.end();
        return;
      }

      // Handle Text message (opcode 0x1)
      if (frame.opcode === 0x1) {
        try {
          const msg = JSON.parse(frame.payload);
          handleClientMessage(msg);
        } catch (err) {
          console.error('[Signaling] JSON parse error:', err.message);
        }
      }
    }
  });

  function handleClientMessage(msg) {
    switch (msg.type) {
      case 'JOIN_ROOM': {
        currentRoomId = msg.roomId;
        currentUserId = msg.userId;

        if (!rooms.has(currentRoomId)) {
          rooms.set(currentRoomId, new Map());
        }

        const room = rooms.get(currentRoomId);
        room.set(currentUserId, { socket, send, username: msg.username, isHost: msg.isHost });

        console.log(`[Signaling] User ${msg.username} (${currentUserId}) joined room ${currentRoomId} (Total: ${room.size})`);

        // Notify joiner
        send({
          type: 'ROOM_JOINED',
          roomId: currentRoomId,
          peerCount: room.size
        });

        // Notify other peers in the room
        for (const [peerId, peer] of room.entries()) {
          if (peerId !== currentUserId) {
            peer.send({
              type: 'PEER_JOINED',
              fromUserId: currentUserId,
              username: msg.username
            });
          }
        }
        break;
      }

      case 'OFFER':
      case 'ANSWER':
      case 'ICE_CANDIDATE': {
        const room = rooms.get(currentRoomId);
        if (!room) return;

        console.log(`[Signaling] Relaying ${msg.type} from ${currentUserId} in room ${currentRoomId} to ${room.size - 1} peers`);

        // Relay signaling packet to peers in room
        for (const [peerId, peer] of room.entries()) {
          if (peerId !== currentUserId) {
            peer.send({
              fromUserId: currentUserId,
              ...msg
            });
          }
        }
        break;
      }
    }
  }

  // Cleanup on disconnect
  socket.on('close', () => {
    if (currentRoomId && currentUserId && rooms.has(currentRoomId)) {
      const room = rooms.get(currentRoomId);
      room.delete(currentUserId);
      console.log(`[Signaling] User ${currentUserId} disconnected from ${currentRoomId}`);

      // Notify remaining peers
      for (const peer of room.values()) {
        peer.send({
          type: 'PEER_LEFT',
          fromUserId: currentUserId
        });
      }

      // Delete room if empty
      if (room.size === 0) {
        rooms.delete(currentRoomId);
        console.log(`[Signaling] Room ${currentRoomId} closed`);
      }
    }
  });

  socket.on('error', (err) => {
    // Handled via close event
  });
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🎬 FlixParty WebRTC Signaling Server Running!`);
  console.log(`🚀 Port: ${PORT}`);
  console.log(`🌐 Local WebSocket URL: ws://localhost:${PORT}`);
  console.log(`===============================================`);
});

