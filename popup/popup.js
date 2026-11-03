// FlixParty - Extension Popup Script
// Manifest V3 best practices: async/await throughout, no .then() chains

document.addEventListener('DOMContentLoaded', async () => {
  const notSupportedNotice = document.getElementById('notSupportedNotice');
  const openNetflixBtn = document.getElementById('openNetflixBtn');
  const openYouTubeBtn = document.getElementById('openYouTubeBtn');
  const activePartyView = document.getElementById('activePartyView');
  const inactivePartyView = document.getElementById('inactivePartyView');
  const activeRoomCode = document.getElementById('activeRoomCode');
  const usernameInput = document.getElementById('usernameInput');
  const joinRoomInput = document.getElementById('joinRoomInput');
  const startPartyBtn = document.getElementById('startPartyBtn');
  const joinPartyBtn = document.getElementById('joinPartyBtn');
  const copyInviteBtn = document.getElementById('copyInviteBtn');
  const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
  const leavePartyBtn = document.getElementById('leavePartyBtn');
  const settingsLink = document.getElementById('settingsLink');

  // Load saved username
  const stored = await chrome.storage.local.get(['username', 'partyActive', 'currentRoomId']);
  if (stored.username) {
    usernameInput.value = stored.username;
  }

  // Save username on change
  usernameInput.addEventListener('input', async (e) => {
    const val = e.target.value.trim() || 'Friend';
    await chrome.storage.local.set({ username: val });
  });

  // Settings Link
  settingsLink.addEventListener('click', async (e) => {
    e.preventDefault();
    await chrome.runtime.openOptionsPage();
  });

  // Open Netflix Button
  openNetflixBtn?.addEventListener('click', async () => {
    await chrome.tabs.create({ url: 'https://www.netflix.com' });
    window.close();
  });

  // Open YouTube Button
  openYouTubeBtn?.addEventListener('click', async () => {
    await chrome.tabs.create({ url: 'https://www.youtube.com' });
    window.close();
  });

  // Query current active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isSupported = tab?.url?.includes('netflix.com') || tab?.url?.includes('youtube.com');

  if (!isSupported) {
    notSupportedNotice.style.display = 'flex';
    inactivePartyView.style.display = 'none';
    activePartyView.style.display = 'none';
    return;
  }

  // Check if content script has active party
  let partyStatus = null;
  try {
    partyStatus = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PARTY_STATUS' });
  } catch (err) {
    // Content script not loaded yet or page is still loading
  }

  if (partyStatus && partyStatus.isPartyActive) {
    showActiveView(partyStatus.roomId);
  } else {
    showInactiveView();
  }

  function showActiveView(roomId) {
    activePartyView.style.display = 'block';
    inactivePartyView.style.display = 'none';
    activeRoomCode.textContent = roomId;
  }

  function showInactiveView() {
    activePartyView.style.display = 'none';
    inactivePartyView.style.display = 'block';
  }

  // Start Party Action
  startPartyBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim() || 'Host';
    await chrome.storage.local.set({ username });

    const newRoomId = 'FLIX-' + Math.floor(1000 + Math.random() * 9000);
    try {
      const res = await chrome.tabs.sendMessage(tab.id, {
        type: 'START_PARTY_CMD',
        roomId: newRoomId
      });
      if (res && res.success) {
        showActiveView(newRoomId);
      }
    } catch (err) {
      alert('Please open a Netflix or YouTube video first, then click Start Party!');
    }
  });

  // Join Party Action
  joinPartyBtn.addEventListener('click', async () => {
    const roomId = joinRoomInput.value.trim();
    if (!roomId) {
      alert('Please enter a valid Room Code');
      return;
    }

    const username = usernameInput.value.trim() || 'Friend';
    await chrome.storage.local.set({ username });

    try {
      const res = await chrome.tabs.sendMessage(tab.id, {
        type: 'JOIN_PARTY_CMD',
        roomId
      });
      if (res && res.success) {
        showActiveView(roomId);
      }
    } catch (err) {
      alert('Please ensure you are on a Netflix or YouTube video page before joining!');
    }
  });

  // Copy Invite Link
  copyInviteBtn.addEventListener('click', async () => {
    const roomId = activeRoomCode.textContent;
    let inviteUrl = tab.url;

    // Append ?flixparty=ROOM_ID to current URL
    const urlObj = new URL(tab.url);
    urlObj.searchParams.set('flixparty', roomId);
    inviteUrl = urlObj.toString();

    await navigator.clipboard.writeText(inviteUrl);
    copyInviteBtn.innerHTML = '✓ Link Copied!';
    setTimeout(() => {
      copyInviteBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        Copy Invite Link
      `;
    }, 2000);
  });

  // Toggle Sidebar
  toggleSidebarBtn.addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SIDEBAR_CMD' });
      window.close();
    } catch (err) {
      // Tab closed or not available
    }
  });

  // Leave Party
  leavePartyBtn.addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'LEAVE_PARTY_CMD' });
      showInactiveView();
    } catch (err) {
      showInactiveView();
    }
  });
});

