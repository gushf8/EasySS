// cobalt_bridge.js
// Runs in ISOLATED world on cobalt.tools
// Listens for postMessage from the MAIN world interceptor (cobalt_bridge_main.js)
// and relays the captured CDN URL to the extension background

(function () {
  // Only activate when triggered by the extension
  const hash = window.location.hash;
  if (!hash || !hash.startsWith('#easyssdl:')) return;

  // Notify background that the bridge tab is alive
  try {
    chrome.runtime.sendMessage({ type: 'COBALT_BRIDGE_STARTED' });
  } catch (_) {}

  // Listen for the result from the MAIN world interceptor
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== '__EASYSSDL_RESULT__') return;

    const { downloadUrl, filename } = event.data;
    if (!downloadUrl) return;

    try {
      chrome.runtime.sendMessage({
        type: 'COBALT_BRIDGE_SUCCESS',
        url: downloadUrl,
        filename: filename || ''
      });
    } catch (_) {}
  });

  // Timeout watchdog: if nothing comes in 40s, report failure
  const watchdog = setTimeout(() => {
    try {
      chrome.runtime.sendMessage({ type: 'COBALT_BRIDGE_FAILED', reason: 'timeout' });
    } catch (_) {}
  }, 40000);

  // Clear watchdog when success is sent
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === '__EASYSSDL_RESULT__') {
      clearTimeout(watchdog);
    }
  });
})();
