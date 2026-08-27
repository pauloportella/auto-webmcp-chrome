// Dev-only: one local poller avoids per-tab traffic; every annotated tab reloads with it.
{
  let buildStamp = null;
  let reloading = false;
  let tracked = false;

  async function trackAnnotatedTab() {
    if (tracked || !document.documentElement.hasAttribute("data-webmcp-tools-available")) return;
    try {
      tracked = Boolean((await chrome.runtime.sendMessage({ type: "DEV_TRACK_TAB" }))?.ok);
    } catch {
      tracked = false;
    }
  }

  async function pollBuild() {
    if (reloading) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: "DEV_BUILD_STAMP" });
      if (
        response?.stamp &&
        document.documentElement.dataset.webmcpAnnotatorBuildStamp !== response.stamp
      ) {
        document.documentElement.dataset.webmcpAnnotatorBuildStamp = response.stamp;
      }
      if (
        location.origin === "http://127.0.0.1:4173" &&
        buildStamp &&
        response?.stamp &&
        response.stamp !== buildStamp
      ) {
        reloading = true;
        await chrome.runtime.sendMessage({ type: "DEV_RELOAD" });
        return;
      }
      buildStamp = response?.stamp || buildStamp;
    } catch {
      // Reloading invalidates the old content-script context briefly.
    }
  }

  const observer = new MutationObserver(() => void trackAnnotatedTab());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-webmcp-tools-available"],
  });
  void trackAnnotatedTab();
  void pollBuild();
  if (location.origin === "http://127.0.0.1:4173") setInterval(pollBuild, 750);
}
