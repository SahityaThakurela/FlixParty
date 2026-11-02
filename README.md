# 🎬 FlixParty — Full-Fledged Netflix Watch Party with Video Call, Voice & Chat

> A high-performance, zero-lag alternative to Teleparty with built-in **WebRTC Video Calling**, **Voice Chat**, **Real-Time Text Messaging**, and **Sub-Millisecond Synchronized Playback**.

---

## ✨ Features

- **⚡ Zero-Lag Direct P2P Playback Sync**:
  - Uses direct **WebRTC DataChannels** between you and your friend. Play, pause, and seek commands sync instantly with sub-millisecond latency.
  - **Intelligent Drift Correction**: Periodically compares playback timestamps. If one friend buffers or experiences network hitch (>1.2s), the player smoothly realigns automatically.
  - **Echo-Loop Prevention**: State locks prevent cyclical ping-pong triggers when syncing actions.
- **📹 Real-Time Video Call**:
  - Direct webcam feeds for you and your friend.
  - Camera On/Off toggle.
- **🎙️ Voice Chat & Audio Indicators**:
  - High-quality WebRTC audio with echo cancellation and background noise suppression.
  - Microphone Mute/Unmute toggle.
  - **Voice Activity Detection**: Green aura ring pulses around avatar when speaking.
- **💬 Live In-Page Chat & Emoji Reactions**:
  - Sleek text chat with timestamps and system notifications (e.g. *"Alice paused at 14:20"*).
  - Quick emoji reaction bar (🍿, ❤️, 😂, 😱, 👏, 🔥) that animates floating emojis across the screen.
- **👑 Toggleable Host Controls**:
  - **Everyone can control**: Both you and your friend can freely pause, play, or jump to any timestamp.
  - **Host only control**: Only the party creator can control playback; guest actions politely revert.
- **🖥️ Fullscreen Compatible In-Page Sidebar**:
  - Collapsible Netflix-themed Dark Mode sidebar.
  - Uses **Shadow DOM** to prevent CSS style conflicts with Netflix.
  - Seamlessly persists and remains fully interactive even when Netflix enters fullscreen mode.
  - Floating mini-pill when collapsed so it never blocks subtitles.

---

## 📁 Project Structure

```
.
├── manifest.json                  # Manifest V3 extension configuration
├── icons/                         # Extension icons (16px, 48px, 128px)
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── content/                       # Content scripts injected into Netflix
│   ├── netflix-bridge.js          # MAIN-world script accessing Netflix videoPlayer API
│   ├── webrtc-manager.js          # WebRTC P2P audio/video & DataChannel engine
│   ├── sidebar.js                 # In-page Shadow DOM sidebar UI & video grid
│   └── content.js                 # Coordinator between Bridge, WebRTC & UI
├── popup/                         # Chrome extension toolbar popup
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── options/                       # Settings & Camera/Mic test page
│   ├── permissions.html
│   ├── permissions.css
│   └── permissions.js
├── background/                    # Background Service Worker
│   └── service-worker.js
├── server/                        # Standalone Signaling Server
│   ├── server.js                  # Zero-dependency Node.js WebSocket server
│   └── package.json
└── generate_icons.py              # Script to generate pixel-perfect PNG icons
```

---

## 🚀 Quick Start Guide

### Step 1: Start the Signaling Server

The included signaling server is **100% zero-dependency** (built with Node.js standard libraries). You do **not** even need to run `npm install`:

```bash
cd server
node server.js
```

You will see:
```
===============================================
🎬 FlixParty WebRTC Signaling Server Running!
🚀 Port: 3000
🌐 Local WebSocket URL: ws://localhost:3000
===============================================
```

*(Note: For watching with friends across different internet networks without port forwarding, you can deploy `server/server.js` for free to [Render](https://render.com), [Railway](https://railway.app), or [Glitch](https://glitch.com), then update the Server URL in the extension Settings).*

---

### Step 2: Load the Extension into Google Chrome

1. Open Google Chrome and go to `chrome://extensions` in the address bar.
2. In the top-right corner, toggle on **"Developer mode"**.
3. Click the **"Load unpacked"** button in the top-left.
4. Select this directory (`Teleparty alternative `).
5. The **FlixParty** extension is now installed and will appear in your Chrome toolbar!

---

### Step 3: (Optional) Test Camera & Microphone

1. Click the FlixParty extension icon in the toolbar, then click the **Gear (⚙️)** icon in the top right.
2. Click **"Start Camera & Mic Test"** to preview your camera and verify your microphone volume levels.
3. Set your preferred **Display Nickname**.

---

### Step 4: Start Watching Netflix with Your Friend!

1. Open [Netflix](https://www.netflix.com) in your browser and start playing any movie or TV show episode.
2. Click the **FlixParty** extension icon in your Chrome toolbar.
3. Click **"Start the Party"**.
4. The FlixParty sidebar will appear on the right side of the Netflix player:
   - Your webcam feed will turn on.
   - A Room Code (e.g. `FLIX-7492`) will be generated.
   - Click **"Copy Invite Link"** from the popup or click the room tag in the sidebar to copy the link.
5. Send the link or Room Code to your friend.
6. **For your friend**:
   - They open the link or open the same Netflix title, click FlixParty, enter the Room Code, and click **"Join"**.
7. **Done!** Both video feeds will connect directly via WebRTC, voice chat will activate, and your Netflix playback will stay synchronized with zero lag!

---

## ⚙️ Control Modes

As the host, you can switch playback control at any time using the dropdown at the top of the chat:
- **Everyone can control**: Both you and your friend can play, pause, or seek freely.
- **Host only control**: Only the host can play/pause/seek. If a guest tries to scrub or pause, their player will automatically snap back to the host's playback position.

---

## 🛠️ Deploying the Signaling Server to the Cloud (Free)

To connect with friends who are not on your local Wi-Fi network:

1. Create a free account on [Render.com](https://render.com).
2. Click **New +** -> **Web Service**.
3. Point to the `server/` directory of this repo (or upload `server.js` and `package.json`).
4. Set Build Command: *(leave blank or `npm install`)*.
5. Set Start Command: `node server.js`.
6. Once deployed, copy your WebSocket URL (e.g. `wss://your-app-name.onrender.com`).
7. In the extension settings (`options/permissions.html`), paste this URL into **WebRTC Signaling Server URL** and click Save.

---

## 🔒 Privacy & Security

- **P2P Audio & Video**: Media streams and playback sync data travel directly peer-to-peer between you and your friend using standard WebRTC encryption (DTLS/SRTP).
- The signaling server only brokers the initial connection handshake (SDP & ICE) and does not store or process any audio, video, or Netflix credentials.

