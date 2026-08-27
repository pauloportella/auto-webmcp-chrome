const RELOAD_TABS_KEY = "webmcpDevReloadTabs";
let trackQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => {
  setTimeout(async () => {
    const stored = await chrome.storage.local.get(RELOAD_TABS_KEY);
    const tabIds = Array.isArray(stored[RELOAD_TABS_KEY]) ? stored[RELOAD_TABS_KEY] : [];
    await chrome.storage.local.remove(RELOAD_TABS_KEY);
    await Promise.all(tabIds.map((tabId) => chrome.tabs.reload(tabId).catch(() => {})));
  }, 250);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "DEV_BUILD_STAMP") {
    fetch(`${chrome.runtime.getURL("build-stamp.txt")}?t=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.text())
      .then((stamp) => sendResponse({ stamp: stamp.trim() }));
    return true;
  }

  if (message.type === "DEV_TRACK_TAB") {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId)) return undefined;
    trackQueue = trackQueue.then(async () => {
      const stored = await chrome.storage.local.get(RELOAD_TABS_KEY);
      const tabIds = new Set(
        Array.isArray(stored[RELOAD_TABS_KEY]) ? stored[RELOAD_TABS_KEY] : [],
      );
      tabIds.add(tabId);
      await chrome.storage.local.set({ [RELOAD_TABS_KEY]: [...tabIds] });
    });
    trackQueue.then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "DEV_RELOAD") {
    sendResponse({ ok: true });
    setTimeout(() => chrome.runtime.reload(), 100);
    return true;
  }
});
