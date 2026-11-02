// FlixParty - Background Service Worker (Manifest V3)

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[FlixParty] Service Worker installed');
  // Initialize default preferences
  const current = await chrome.storage.local.get(['username', 'serverUrl', 'controlMode']);
  const defaults = {
    username: current.username || 'Friend',
    serverUrl: current.serverUrl || 'ws://localhost:3000',
    controlMode: current.controlMode || 'everyone', // 'everyone' | 'host_only'
    partyActive: false,
    currentRoomId: null
  };
  await chrome.storage.local.set(defaults);
});

// Update badge status based on party state
async function updateBadge(tabId, text, color) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (color) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color });
    }
  } catch (err) {
    // Tab might be closed
  }
}

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const tabId = sender?.tab?.id;

    switch (message.type) {
      case 'PARTY_STARTED':
      case 'PARTY_JOINED':
        await chrome.storage.local.set({
          partyActive: true,
          currentRoomId: message.roomId,
          isHost: message.isHost || false
        });
        if (tabId) {
          await updateBadge(tabId, 'LIVE', '#E50914');
        }
        sendResponse({ success: true });
        break;

      case 'PARTY_LEFT':
        await chrome.storage.local.set({
          partyActive: false,
          currentRoomId: null,
          isHost: false
        });
        if (tabId) {
          await updateBadge(tabId, '', '#000000');
        }
        sendResponse({ success: true });
        break;

      case 'GET_ACTIVE_TAB_INFO': {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const isNetflix = activeTab?.url?.includes('netflix.com');
        const isWatching = activeTab?.url?.includes('netflix.com/watch');
        sendResponse({
          tabId: activeTab?.id,
          url: activeTab?.url,
          isNetflix,
          isWatching
        });
        break;
      }

      case 'OPEN_OPTIONS':
        await chrome.runtime.openOptionsPage();
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ received: true });
        break;
    }
  })();
  return true; // Keep message channel open for async response
});

// Clean up badge when navigating away from Netflix
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab?.url) {
    if (!tab.url.includes('netflix.com')) {
      await updateBadge(tabId, '', '#000000');
    }
  }
});

