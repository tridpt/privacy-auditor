// ============================================================
//  Privacy Auditor – Content Script (isolated world)
//  Fingerprint hooks live in injected.js (world: MAIN) to
//  bypass page CSP. This script relays those signals and
//  scans the DOM for scripts/cookies/storage.
// ============================================================

// ── Relay fingerprint signals from injected.js ───────────────
const sentFP = new Set();
window.addEventListener('message', (ev) => {
  if (ev.source !== window || !ev.data?.__PA__) return;
  if (ev.data.type === 'fp') {
    const api = ev.data.api;
    if (sentFP.has(api)) return;
    sentFP.add(api);
    try {
      chrome.runtime.sendMessage({ type: 'FINGERPRINT_DETECTED', api });
    } catch (_) {}
  }
});

// ── DOM scan: scripts + cookies + storage ────────────────────
function scanPage() {
  // Collect <script src="..."> URLs
  const scriptUrls = [];
  document.querySelectorAll('script[src]').forEach(el => {
    if (el.src) scriptUrls.push(el.src);
  });

  // Count cookies
  let cookieCount = 0;
  try {
    const raw = document.cookie;
    cookieCount = raw ? raw.split(';').filter(c => c.trim()).length : 0;
  } catch (_) {}

  // Storage key counts
  let lsKeys = 0, ssKeys = 0;
  try { lsKeys = localStorage.length;  } catch (_) {}
  try { ssKeys = sessionStorage.length; } catch (_) {}

  try {
    chrome.runtime.sendMessage({
      type:          'PAGE_SCAN',
      scriptUrls,
      cookies:       { count: cookieCount },
      localStorage:  lsKeys,
      sessionStorage: ssKeys,
    });
  } catch (_) {}
}

// Run after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scanPage);
} else {
  scanPage();
}

// Re-scan after full load to catch deferred/async scripts
window.addEventListener('load', () => {
  setTimeout(scanPage, 1500);
}, { once: true });
