/**
 * ScentSaver Chrome Extension — Background Service Worker
 * Handles right-click context menu creation and selection text lookup.
 */

const CONTEXT_MENU_ID = "scentsaver-lookup-selection";
const PENDING_LOOKUP_KEY = "scentsaver_pending_lookup";

// Register context menu item on install / update
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "Find ScentSaver alternative for '%s'",
      contexts: ["selection"]
    });
  });
});

// Handle click on context menu item
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.selectionText) {
    return;
  }

  const sanitizedQuery = info.selectionText.trim().substring(0, 120);
  if (!sanitizedQuery) return;

  // Save pending lookup for popup.js to consume
  await chrome.storage.local.set({
    [PENDING_LOOKUP_KEY]: {
      query: sanitizedQuery,
      source: "context_menu",
      timestamp: Date.now()
    }
  });

  // Attempt to open the extension popup directly
  try {
    if (chrome.action && typeof chrome.action.openPopup === "function") {
      await chrome.action.openPopup();
      return;
    }
  } catch (err) {
    // openPopup may reject if browser window lacks active focus
  }

  // Fallback: open small dedicated window
  chrome.windows.create({
    url: chrome.runtime.getURL("popup.html?source=context_menu"),
    type: "popup",
    width: 400,
    height: 580
  });
});

