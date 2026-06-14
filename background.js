// ============================================================
//  Privacy Auditor – Background Service Worker
// ============================================================

// Pure scoring/tracker logic lives in lib/scoring.js (single source of
// truth, also unit-tested under Node). importScripts runs it in this
// worker's global scope, so TRACKERS, DOMAIN_FAMILIES, FIRST_PARTY_PENALTY,
// getDomain, matchTracker, isSameFamily, scoreToColor, getFirstPartyPenalty
// and calculateScore are all available as globals below.
importScripts('lib/scoring.js');

// ── Per-site blocking store (rule IDs 2000+) ─────────────────
const blockedRules = new Map();
let nextRuleId = 2000;

// ── Whitelist store ──────────────────────────────────────────
let whitelist = new Set();

// In-memory mirror of the global-protection toggle. Used by the blocked-
// request counter so it works in published builds (onRuleMatchedDebug is
// dev-mode only). Kept in sync by enable/disableGlobalProtection().
let globalProtectionOn = false;

// ── Settings ────────────────────────────────────────────────
let notifEnabled    = true;
let notifyThreshold = 45;

// ── Custom block rules (rule IDs 1000–1999) ──────────────────
// User-defined domains blocked globally regardless of global protection toggle
const customRuleMap  = new Map(); // domain → ruleId
let nextCustomRuleId = 1000;

// Restore everything on service worker startup
chrome.storage.local.get(
  ['blockedDomains', 'globalProtection', 'whitelist',
   'notifEnabled', 'notifyThreshold', 'customBlockRules'],
  async (result) => {
    const saved = result.blockedDomains || {};
    for (const [domain, ruleId] of Object.entries(saved)) {
      blockedRules.set(domain, ruleId);
      if (ruleId >= nextRuleId) nextRuleId = ruleId + 1;
    }
    whitelist = new Set(result.whitelist || []);
    if (result.notifEnabled  !== undefined) notifEnabled    = result.notifEnabled;
    if (result.notifyThreshold != null)     notifyThreshold = result.notifyThreshold;

    // Restore custom block rules
    const savedCustom = result.customBlockRules || [];
    if (savedCustom.length) {
      const addRules = savedCustom.map((domain, idx) => ({
        id: 1000 + idx, priority: 2, action: { type: 'block' },
        condition: {
          urlFilter: `||${domain}^`,
          resourceTypes: ['script', 'xmlhttprequest', 'ping', 'image', 'media', 'sub_frame', 'other'],
        },
      }));
      const removeRuleIds = savedCustom.map((_, idx) => 1000 + idx);
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
        savedCustom.forEach((domain, idx) => {
          customRuleMap.set(domain, 1000 + idx);
          nextCustomRuleId = Math.max(nextCustomRuleId, 1001 + idx);
        });
      } catch (err) { console.error('[PA] Custom rule restore failed:', err); }
    }

    if (result.globalProtection) {
      globalProtectionOn = true;
      setTimeout(() => enableGlobalProtection(false), 0);
    }
  }
);

async function persistWhitelist() {
  await chrome.storage.local.set({ whitelist: [...whitelist] });
}

async function persistCustomRules() {
  await chrome.storage.local.set({ customBlockRules: [...customRuleMap.keys()] });
}

async function addCustomRule(domain) {
  if (!domain || customRuleMap.has(domain)) return;
  const ruleId = nextCustomRuleId++;
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [{
      id: ruleId, priority: 2, action: { type: 'block' },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes: ['script', 'xmlhttprequest', 'ping', 'image', 'media', 'sub_frame', 'other'],
      },
    }],
    removeRuleIds: [],
  });
  customRuleMap.set(domain, ruleId);
  await persistCustomRules();
}

async function removeCustomRule(domain) {
  const ruleId = customRuleMap.get(domain);
  if (!ruleId) return;
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ruleId], addRules: [] });
  customRuleMap.delete(domain);
  await persistCustomRules();
}

async function persistBlocked() {
  const obj = {};
  blockedRules.forEach((id, domain) => { obj[domain] = id; });
  await chrome.storage.local.set({ blockedDomains: obj });
}

async function blockDomain(domain) {
  if (!domain || blockedRules.has(domain)) return;
  const ruleId = nextRuleId++;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [{
        id: ruleId,
        priority: 1,
        action: { type: 'block' },
        condition: {
          urlFilter: `||${domain}^`,
          resourceTypes: [
            'script', 'xmlhttprequest', 'ping',
            'image', 'media', 'sub_frame', 'other'
          ],
        },
      }],
      removeRuleIds: [],
    });
    blockedRules.set(domain, ruleId);
    await persistBlocked();
    console.log('[PrivacyAuditor] Blocked:', domain, '→ rule', ruleId);
  } catch (err) {
    nextRuleId--; // roll back unused id
    console.error('[PrivacyAuditor] Failed to block', domain, err);
    throw err;    // re-throw so caller knows it failed
  }
}

async function unblockDomain(domain) {
  const ruleId = blockedRules.get(domain);
  if (!ruleId) return;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ruleId],
    addRules: [],
  });
  blockedRules.delete(domain);
  await persistBlocked();
}

async function unblockAll() {
  const ids = [...blockedRules.values()];
  if (ids.length === 0) return;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: ids,
    addRules: [],
  });
  blockedRules.clear();
  await chrome.storage.local.set({ blockedDomains: {} });
}

// ── Global auto-block (rule IDs 1–999) ───────────────────────
// Blocks ALL known tracker domains on EVERY website,
// EXCEPT when the request comes from the tracker's own corporate family.
const GLOBAL_RULE_ID_START = 1;

// Build a map: trackerDomain → [home domains that should NOT be blocked]
// (computed lazily after DOMAIN_FAMILIES and TRACKERS are defined)
function buildFamilyExclusions() {
  const exclusions = new Map(); // domain → string[]
  for (const family of DOMAIN_FAMILIES) {
    for (const member of family) {
      // Any tracker domain that belongs to this family gets the whole family excluded
      if (TRACKERS[member] || Object.keys(TRACKERS).some(t => member.endsWith('.' + t) || t.endsWith('.' + member))) {
        exclusions.set(member, family);
      }
    }
  }
  return exclusions;
}

async function enableGlobalProtection(persist = true) {
  const domains    = Object.keys(TRACKERS);
  const exclusions = buildFamilyExclusions();
  const wlArr      = [...whitelist]; // whitelisted hosts are never blocked

  const addRules = domains.map((domain, idx) => {
    const familyDomains = exclusions.get(domain) ?? [];
    const excluded = [...new Set([
      ...familyDomains.flatMap(f => {
        const parts = f.split('.');
        return parts.length >= 2 ? [parts.slice(-2).join('.')] : [];
      }),
      ...wlArr,  // ← whitelist exclusion
    ])];

    const condition = {
      urlFilter: `||${domain}^`,
      resourceTypes: [
        'script', 'xmlhttprequest', 'ping',
        'image', 'media', 'sub_frame', 'other'
      ],
    };
    if (excluded.length > 0) condition.excludedInitiatorDomains = excluded;

    return {
      id:       GLOBAL_RULE_ID_START + idx,
      priority: 2,
      action:   { type: 'block' },
      condition,
    };
  });

  const removeRuleIds = domains.map((_, idx) => GLOBAL_RULE_ID_START + idx);
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
    globalProtectionOn = true;
    if (persist) await chrome.storage.local.set({ globalProtection: true });
  } catch (err) {
    console.error('[PrivacyAuditor] Global protection failed:', err);
    throw err;
  }
}

async function disableGlobalProtection() {
  const removeRuleIds = Object.keys(TRACKERS).map((_, idx) => GLOBAL_RULE_ID_START + idx);
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [] });
  globalProtectionOn = false;
  await chrome.storage.local.set({ globalProtection: false });
  console.log('[PrivacyAuditor] Global OFF');
}

// ── Desktop notifications ───────────────────────────────────────
// Tracks tabs that already received a notification this page load
const notifiedTabs    = new Set();
const pendingTimers   = new Map(); // tabId → setTimeout handle

const NOTIFY_DELAY_MS  = 3500; // wait for network requests to settle
const NOTIF_LOG_MAX    = 50;   // max stored notifications

/**
 * Persist a notification to storage so the Notification Center can display it.
 * type: 'alert' | 'block' | 'unblock' | 'score' | 'info'
 */
async function logNotification({ type = 'alert', title, message, url = '' }) {
  const { notifLog = [] } = await chrome.storage.local.get('notifLog');
  notifLog.unshift({ id: Date.now(), type, title, message, url, read: false, ts: Date.now() });
  if (notifLog.length > NOTIF_LOG_MAX) notifLog.length = NOTIF_LOG_MAX;
  await chrome.storage.local.set({ notifLog });
}

/** Create a Chrome notification AND log it for the Notification Center */
function createNotif(id, opts, logOpts = {}) {
  chrome.notifications.create(id, opts, () => {
    if (chrome.runtime.lastError) return;
  });
  logNotification({
    type:    logOpts.type ?? 'alert',
    title:   opts.title,
    message: opts.message,
    url:     logOpts.url ?? '',
  });
}

function maybeNotify(tabId) {
  if (!notifEnabled) return;           // notifications toggled off in settings
  if (notifiedTabs.has(tabId)) return;
  if (!tabData.has(tabId))     return;

  const d        = tabData.get(tabId);
  const hostname = getDomain(d.url || '');
  if (hostname && whitelist.has(hostname)) return;

  const score = calculateScore(d);
  if (score >= notifyThreshold) return; // use user-configured threshold

  notifiedTabs.add(tabId);

  const trackerCount = d.trackers.size;
  const grade        = score < 20 ? 'Very Invasive' : 'Bad Privacy';

  createNotif(`pa-${tabId}-${Date.now()}`, {
    type:     'basic',
    iconUrl:  'icons/icon48.png',
    title:    `⚠️ Privacy Alert — ${grade} (${score}/100)`,
    message:  `${hostname ?? 'This page'} is running ${trackerCount} tracker${trackerCount !== 1 ? 's' : ''}. Your data is being collected.`,
    priority: 1,
  }, { type: 'alert', url: d.url ?? '' });
}

// Schedule a delayed notification (resets timer each call, fires once)
function scheduleNotify(tabId) {
  if (notifiedTabs.has(tabId)) return;
  if (pendingTimers.has(tabId)) clearTimeout(pendingTimers.get(tabId));
  const handle = setTimeout(() => {
    pendingTimers.delete(tabId);
    maybeNotify(tabId);
  }, NOTIFY_DELAY_MS);
  pendingTimers.set(tabId, handle);

}

// ── In-memory tab data store ─────────────────────────────────
const tabData     = new Map();
const cspCache    = new Map(); // tabId → CSP string (persists across initTabData resets)
const refPolCache = new Map(); // tabId → Referrer-Policy string

// ── Session persistence ──────────────────────────────────────
// MV3 kills the service worker after ~30s idle, wiping the in-memory
// stores above. chrome.storage.session is an in-memory store that
// survives worker restarts (cleared on browser close), so we snapshot
// tabData + header caches there and restore on wake-up. Maps/Sets are
// serialized to arrays since storage only holds JSON.
const SESSION_KEY = 'paSession';
let snapshotTimer = null;
let stateReady    = false; // true once restoreState() has run

function serializeTab(d) {
  return {
    ...d,
    trackers:       [...d.trackers.entries()],
    fingerprinting: [...d.fingerprinting],
  };
}

function deserializeTab(s) {
  return {
    ...s,
    trackers:       new Map(s.trackers ?? []),
    fingerprinting: new Set(s.fingerprinting ?? []),
  };
}

function scheduleSnapshot() {
  if (snapshotTimer) return;
  snapshotTimer = setTimeout(async () => {
    snapshotTimer = null;
    try {
      const tabs = {};
      for (const [id, d] of tabData) tabs[id] = serializeTab(d);
      await chrome.storage.session.set({
        [SESSION_KEY]: {
          tabs,
          csp:    Object.fromEntries(cspCache),
          refPol: Object.fromEntries(refPolCache),
        },
      });
    } catch (_) {}
  }, 1000); // debounce — at most one write per second
}

async function restoreState() {
  if (stateReady) return;
  try {
    const { [SESSION_KEY]: snap } = await chrome.storage.session.get(SESSION_KEY);
    if (snap) {
      for (const [id, s] of Object.entries(snap.tabs ?? {})) {
        tabData.set(Number(id), deserializeTab(s));
      }
      for (const [id, v] of Object.entries(snap.csp ?? {}))    cspCache.set(Number(id), v);
      for (const [id, v] of Object.entries(snap.refPol ?? {})) refPolCache.set(Number(id), v);
    }
  } catch (_) {}
  stateReady = true;
}

// Restore immediately on worker startup (before any message arrives).
restoreState();

function initTabData(tabId, url = '') {
  tabData.set(tabId, {
    trackers:        new Map(),
    requests:        { total: 0, external: 0 },
    requestLog:      [],   // per-request entries for waterfall
    startTs:         Date.now(),
    fingerprinting:  new Set(),
    cookies:         { count: 0 },
    localStorage:    0,
    sessionStorage:  0,
    csp:             null,
    blockedRequests: 0,
    mixedContent:    [],
    url,
    timestamp:       Date.now(),
  });
}

function updateBadge(tabId) {
  if (!tabData.has(tabId)) {
    chrome.action.setBadgeText({ text: '', tabId });
    return;
  }
  const data  = tabData.get(tabId);
  const count = data.trackers.size;

  if (count === 0) {
    // No trackers yet — show neutral grey dot so user knows extension is alive
    chrome.action.setBadgeText({ text: '✓', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#64748b', tabId });
    chrome.action.setBadgeTextColor?.({ color: '#ffffff', tabId });
    return;
  }

  // Show tracker count (capped at 99); real score badge set by updateBadgeFromScore
  chrome.action.setBadgeText({
    text: count > 99 ? '99+' : String(count),
    tabId,
  });

  // Interim color based on risk until full score arrives
  const trackers = [...data.trackers.values()];
  const hasCrit  = trackers.some(t => t.risk === 'critical');
  const hasHigh  = trackers.some(t => t.risk === 'high');
  const color    = hasCrit          ? '#ef4444'
                 : (hasHigh || count > 5) ? '#f97316'
                 : (count > 2)           ? '#f59e0b'
                 :                          '#84cc16';

  chrome.action.setBadgeBackgroundColor({ color, tabId });
  chrome.action.setBadgeTextColor?.({ color: '#ffffff', tabId });
}

// Called after full score calculation — shows definitive score + color
function updateBadgeFromScore(tabId, score) {
  const color = scoreToColor(score);
  const label = String(score); // e.g. "72"

  chrome.action.setBadgeText({ text: label, tabId });
  chrome.action.setBadgeBackgroundColor({ color, tabId });
  chrome.action.setBadgeTextColor?.({ color: '#ffffff', tabId });
}

// ── Network request monitor ──────────────────────────────────
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { tabId, url, initiator } = details;
    if (tabId < 0 || !url) return;

    if (!tabData.has(tabId)) initTabData(tabId);
    const data = tabData.get(tabId);

    data.requests.total++;

    const reqDomain  = getDomain(url);
    const pageDomain = getDomain(initiator || data.url || '');

    // Blocked-request estimate for published builds where onRuleMatchedDebug
    // is unavailable. Skipped entirely when the debug counter is active to
    // avoid double counting.
    if (!useDebugCounter && wouldBeBlocked(reqDomain, pageDomain)) {
      data.blockedRequests++;
      scheduleLifetimeWrite();
    }

    // Count as external only if truly a different org
    const isSubdomain = reqDomain && pageDomain &&
      (reqDomain.endsWith('.' + pageDomain) || pageDomain.endsWith('.' + reqDomain));
    const isExternal = reqDomain && pageDomain && reqDomain !== pageDomain
        && !isSubdomain
        && !isSameFamily(reqDomain, pageDomain);

    // ── Request log for waterfall ─────────────────────────────
    if (data.requestLog.length < 250) {
      const relMs = Date.now() - data.startTs;
      const trkr  = isExternal ? matchTracker(reqDomain) : null;
      data.requestLog.push({
        type:       details.type,
        domain:     reqDomain || pageDomain || '',
        url:        url.slice(0, 120),
        relMs,
        isExternal: !!isExternal,
        isTracker:  !!trkr,
        risk:       trkr ? trkr.risk : null,
      });
    }

    if (isExternal) {
      data.requests.external++;

      const tracker = matchTracker(reqDomain);
      if (tracker) {
        const key = tracker.name + '|' + tracker.category;
        if (!data.trackers.has(key)) {
          data.trackers.set(key, { ...tracker, domain: reqDomain, requestCount: 0 });
          updateBadge(tabId);
          if (tracker.risk === 'high' || tracker.risk === 'critical') {
            scheduleNotify(tabId);
          }
        }
        data.trackers.get(key).requestCount++;
      }
    }

    // ── Mixed content detection ───────────────────────────────
    // Flag HTTP resources loaded on an HTTPS page
    const pageUrl = initiator || data.url || '';
    if (pageUrl.startsWith('https://') && url.startsWith('http://')) {
      if (data.mixedContent.length < 50) {  // cap to avoid memory bloat
        const already = data.mixedContent.some(m => m.url === url);
        if (!already) {
          data.mixedContent.push({
            url,
            domain: reqDomain || getDomain(url) || url,
            type:   details.type,   // 'script','image','stylesheet','xmlhttprequest',…
          });
        }
      }
    }

    scheduleSnapshot(); // persist to storage.session (debounced)
  },
  { urls: ['<all_urls>'] }
);

// ── Tab lifecycle ────────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    initTabData(tabId, tab.url || '');
    // Grey "scanning" indicator while page loads
    chrome.action.setBadgeText({ text: '…', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#475569', tabId });
    chrome.action.setBadgeTextColor?.({ color: '#ffffff', tabId });
    notifiedTabs.delete(tabId);
    if (pendingTimers.has(tabId)) {
      clearTimeout(pendingTimers.get(tabId));
      pendingTimers.delete(tabId);
    }
  }

  // Page fully loaded — best time to check score (all requests captured)
  if (changeInfo.status === 'complete') {
    setTimeout(() => maybeNotify(tabId), 500);
    setTimeout(() => saveToHistory(tabId), 2000); // give extra time for cookies
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabData.delete(tabId);
  cspCache.delete(tabId);
  refPolCache.delete(tabId);
  scheduleSnapshot();
});

// ── Site History ──────────────────────────────────────────────
// Saves the last 100 unique hostnames visited with their privacy score.
async function saveToHistory(tabId) {
  if (!tabData.has(tabId)) return;
  const d = tabData.get(tabId);
  if (!d.url || !/^https?:/.test(d.url)) return;  // skip chrome:// etc.

  const hostname = getDomain(d.url);
  if (!hostname) return;

  const score        = calculateScore(d);
  const trackerCount = d.trackers.size;
  const fpCount      = d.fingerprinting.size;

  const entry = { hostname, score, trackerCount, fpCount, timestamp: Date.now() };

  const { siteHistory = [] } = await chrome.storage.local.get('siteHistory');
  // Keep only the latest entry per hostname
  const filtered = siteHistory.filter(e => e.hostname !== hostname);
  const updated  = [entry, ...filtered].slice(0, 100);
  await chrome.storage.local.set({ siteHistory: updated });
}

// ── Message handler ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const senderTabId = sender.tab?.id;

  switch (message.type) {

    case 'FINGERPRINT_DETECTED': {
      if (!senderTabId || senderTabId < 0) break;
      if (!tabData.has(senderTabId)) initTabData(senderTabId);
      tabData.get(senderTabId).fingerprinting.add(message.api);
      scheduleSnapshot();
      break;
    }

    case 'PAGE_SCAN': {
      if (!senderTabId || senderTabId < 0) break;
      if (!tabData.has(senderTabId)) initTabData(senderTabId);
      const d = tabData.get(senderTabId);

      if (message.cookies)       d.cookies       = message.cookies;
      if (message.localStorage  !== undefined) d.localStorage  = message.localStorage;
      if (message.sessionStorage !== undefined) d.sessionStorage = message.sessionStorage;

      // Scan <script src> tags reported by content script
      // Skip same-family CDN domains (e.g. fbcdn.net when on facebook.com)
      if (Array.isArray(message.scriptUrls)) {
        const pageDomain = getDomain(d.url || '');
        for (const url of message.scriptUrls) {
          const domain  = getDomain(url);
          if (!domain || isSameFamily(domain, pageDomain)) continue; // ← fix
          const tracker = matchTracker(domain);
          if (tracker) {
            const key = tracker.name + '|' + tracker.category;
            if (!d.trackers.has(key)) {
              d.trackers.set(key, { ...tracker, domain, requestCount: 0 });
            }
          }
        }
      }
      updateBadge(senderTabId); // refresh badge after DOM scan
      scheduleNotify(senderTabId); // schedule notification after requests settle
      scheduleSnapshot();
      break;
    }

    case 'GET_DATA': {
      const tabId = message.tabId;

      // Async: fetch accurate cookie count via chrome.cookies API
      // (reads HttpOnly + secure cookies that document.cookie cannot)
      ;(async () => {
        await restoreState(); // ensure session snapshot is loaded after SW wake-up
        if (!tabData.has(tabId)) { sendResponse(null); return; }
        const d = tabData.get(tabId);

        let cookieCount = d.cookies.count;
        try {
          if (d.url && (d.url.startsWith('http://') || d.url.startsWith('https://'))) {
            const allCookies = await chrome.cookies.getAll({ url: d.url });
            cookieCount = allCookies.length;
          }
        } catch (_) {}

        // Re-calc score with real cookie count
        const dataWithRealCookies = { ...d, cookies: { count: cookieCount } };
        const score = calculateScore(dataWithRealCookies);

        // Update badge with definitive score + color
        updateBadgeFromScore(tabId, score);

        // Include first-party note if applicable
        const fpInfo = getFirstPartyPenalty(d.url);

        // Lifetime blocked count
        const { lifetimeBlocked = 0 } = await chrome.storage.local.get('lifetimeBlocked');

        sendResponse({
          score,
          trackers:         [...d.trackers.values()],
          fingerprinting:   [...d.fingerprinting],
          requests:         d.requests,
          cookies:          { count: cookieCount },
          localStorage:     d.localStorage,
          sessionStorage:   d.sessionStorage,
          timestamp:        d.timestamp,
          firstPartyNote:   fpInfo.note || null,
          blocked:          [...blockedRules.keys()],
          blockedRequests:  d.blockedRequests,
          lifetimeBlocked,
          isHttps:          d.url?.startsWith('https://') ?? false,
          mixedContent:     d.mixedContent ?? [],
        });
      })();

      return true; // keep message port open for async response
    }

    case 'GET_REQUEST_LOG': {
      ;(async () => {
        await restoreState();
        const d = tabData.get(message.tabId);
        sendResponse({ log: d ? d.requestLog : [], startTs: d ? d.startTs : 0 });
      })();
      return true;
    }

    case 'BLOCK_DOMAIN': {
      ;(async () => {
        await blockDomain(message.domain);
        sendResponse({ ok: true, blocked: [...blockedRules.keys()] });
      })();
      return true;
    }

    case 'UNBLOCK_DOMAIN': {
      ;(async () => {
        await unblockDomain(message.domain);
        sendResponse({ ok: true, blocked: [...blockedRules.keys()] });
      })();
      return true;
    }

    case 'BLOCK_ALL': {
      ;(async () => {
        const tabId = message.tabId;
        if (tabData.has(tabId)) {
          for (const t of tabData.get(tabId).trackers.values()) {
            try { await blockDomain(t.domain); } catch (_) {} // skip if one fails
          }
        }
        sendResponse({ ok: true, blocked: [...blockedRules.keys()] });
      })();
      return true;
    }

    case 'UNBLOCK_ALL': {
      ;(async () => {
        await unblockAll();
        sendResponse({ ok: true, blocked: [] });
      })();
      return true;
    }

    case 'GET_BLOCKED': {
      sendResponse({ blocked: [...blockedRules.keys()] });
      return true;
    }

    case 'ENABLE_GLOBAL_PROTECTION': {
      ;(async () => {
        try {
          await enableGlobalProtection();
          sendResponse({ ok: true, globalProtection: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }

    case 'DISABLE_GLOBAL_PROTECTION': {
      ;(async () => {
        try {
          await disableGlobalProtection();
          sendResponse({ ok: true, globalProtection: false });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }

    case 'GET_GLOBAL_PROTECTION': {
      chrome.storage.local.get(['globalProtection'], (r) => {
        sendResponse({ globalProtection: !!r.globalProtection });
      });
      return true;
    }

    case 'TEST_NOTIFICATION': {
      chrome.notifications.create(`pa-test-${Date.now()}`, {
        type:     'basic',
        iconUrl:  'icons/icon48.png',
        title:    '🔔 Privacy Auditor — Test',
        message:  'Notifications are working correctly!',
        priority: 2,
      }, (id) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, id });
        }
      });
      return true;
    }

    case 'ADD_TO_WHITELIST': {
      ;(async () => {
        const { hostname } = message;
        if (!hostname) { sendResponse({ ok: false }); return; }
        whitelist.add(hostname);
        await persistWhitelist();
        // Rebuild global rules to exclude this host
        const { globalProtection } = await chrome.storage.local.get('globalProtection');
        if (globalProtection) await enableGlobalProtection(false);
        sendResponse({ ok: true, whitelist: [...whitelist] });
      })();
      return true;
    }

    case 'REMOVE_FROM_WHITELIST': {
      ;(async () => {
        const { hostname } = message;
        whitelist.delete(hostname);
        await persistWhitelist();
        const { globalProtection } = await chrome.storage.local.get('globalProtection');
        if (globalProtection) await enableGlobalProtection(false);
        sendResponse({ ok: true, whitelist: [...whitelist] });
      })();
      return true;
    }

    case 'GET_WHITELIST': {
      sendResponse({ whitelist: [...whitelist] });
      return true;
    }

    case 'GET_SETTINGS': {
      sendResponse({ notifEnabled, notifyThreshold });
      return true;
    }

    case 'SAVE_SETTINGS': {
      ;(async () => {
        const { notifEnabled: ne, notifyThreshold: nt } = message;
        if (ne !== undefined) notifEnabled    = ne;
        if (nt !== undefined) notifyThreshold = nt;
        await chrome.storage.local.set({ notifEnabled, notifyThreshold });
        sendResponse({ ok: true });
      })();
      return true;
    }

    case 'ADD_CUSTOM_RULE': {
      ;(async () => {
        try {
          await addCustomRule(message.domain);
          sendResponse({ ok: true, rules: [...customRuleMap.keys()] });
        } catch (err) { sendResponse({ ok: false, error: err.message }); }
      })();
      return true;
    }

    case 'REMOVE_CUSTOM_RULE': {
      ;(async () => {
        await removeCustomRule(message.domain);
        sendResponse({ ok: true, rules: [...customRuleMap.keys()] });
      })();
      return true;
    }

    case 'GET_CUSTOM_RULES': {
      sendResponse({ rules: [...customRuleMap.keys()] });
      return true;
    }

    case 'GET_TRACKER_DB': {
      // Serialize TRACKERS map: [{ domain, name, category, risk }]
      const entries = Object.entries(TRACKERS).map(([domain, info]) => ({
        domain, ...info,
      }));
      sendResponse({ trackers: entries });
      return true;
    }

    case 'GET_REFERRER_POLICY': {
      ;(async () => {
        await restoreState(); // ensure caches restored if worker just woke
        const rp = refPolCache.has(message.tabId)
          ? refPolCache.get(message.tabId)
          : null;
        sendResponse({ policy: rp });
      })();
      return true;
    }

    case 'GET_CSP': {
      // Read from cspCache (not tabData) — avoids timing issue where
      // initTabData(loading) resets tabData.csp AFTER onHeadersReceived sets it
      ;(async () => {
        await restoreState();
        const csp = cspCache.has(message.tabId)
          ? cspCache.get(message.tabId)
          : null;
        sendResponse({ csp });
      })();
      return true;
    }
  }

  return false;
});

// ── CSP Header Capture ────────────────────────────────────────
// Capture Content-Security-Policy from main-frame responses
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.type !== 'main_frame' || details.tabId < 0) return;
    const cspHeader = details.responseHeaders?.find(
      h => h.name.toLowerCase() === 'content-security-policy'
    );
    const refHeader = details.responseHeaders?.find(
      h => h.name.toLowerCase() === 'referrer-policy'
    );
    // Store in dedicated caches — separate from tabData so initTabData resets don't clear them
    cspCache.set(details.tabId, cspHeader?.value ?? '');
    refPolCache.set(details.tabId, refHeader?.value ?? '');
    scheduleSnapshot();
  },
  { urls: ['<all_urls>'], types: ['main_frame'] },
  ['responseHeaders']
);

// ── Blocked Request Counter ────────────────────────────────────
// Preferred path: onRuleMatchedDebug fires for every request matched by
// declarativeNetRequest. BUT it requires the declarativeNetRequestFeedback
// permission AND only works for UNPACKED (dev) extensions — it is silently
// unavailable in published Web Store builds. We detect availability and fall
// back to a manual estimate inside onBeforeRequest so the lifetime counter
// keeps working in production.
let useDebugCounter = false;
if (chrome.declarativeNetRequest?.onRuleMatchedDebug) {
  try {
    chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
      const tabId = info.request.tabId;

      // Increment per-tab counter
      if (tabId >= 0 && tabData.has(tabId)) {
        tabData.get(tabId).blockedRequests++;
      }

      // Batch write to storage (avoid thrashing)
      scheduleLifetimeWrite();
    });
    useDebugCounter = true;
  } catch (_) {
    useDebugCounter = false; // not permitted in this build
  }
}

// Fallback estimator (published builds): returns true if a request to
// `reqDomain` from `pageDomain` would be blocked by one of our rules.
function wouldBeBlocked(reqDomain, pageDomain) {
  if (!reqDomain) return false;

  // Per-site / custom block lists (exact domain or subdomain)
  const onList = (set) => {
    for (const d of set) {
      if (reqDomain === d || reqDomain.endsWith('.' + d)) return true;
    }
    return false;
  };
  if (onList(blockedRules.keys())) return true;
  if (onList(customRuleMap.keys())) return true;

  // Global protection: any known tracker, unless same corporate family
  // as the page or the page host is whitelisted.
  if (globalProtectionOn) {
    if (pageDomain && whitelist.has(pageDomain)) return false;
    if (pageDomain && isSameFamily(reqDomain, pageDomain)) return false;
    if (matchTracker(reqDomain)) return true;
  }
  return false;
}

let lifetimePending    = 0;
let lifetimeWriteTimer = null;

function scheduleLifetimeWrite() {
  lifetimePending++;
  if (lifetimeWriteTimer) return;
  lifetimeWriteTimer = setTimeout(async () => {
    lifetimeWriteTimer = null;
    const n = lifetimePending;
    lifetimePending = 0;
    const { lifetimeBlocked = 0 } = await chrome.storage.local.get('lifetimeBlocked');
    await chrome.storage.local.set({ lifetimeBlocked: lifetimeBlocked + n });
  }, 2000); // batch writes every 2 s
}

// ── Context Menu ──────────────────────────────────────────────
function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    // Root item
    chrome.contextMenus.create({
      id: 'pa-root',
      title: '🔏 Privacy Auditor',
      contexts: ['page', 'link', 'selection'],
    });

    // ── Page actions ────────────────────────────────
    chrome.contextMenus.create({
      id: 'pa-score',
      parentId: 'pa-root',
      title: '🔍 Show Privacy Score for This Page',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'pa-rescan',
      parentId: 'pa-root',
      title: '🔄 Rescan This Page',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'pa-dashboard',
      parentId: 'pa-root',
      title: '📊 Open Privacy Dashboard',
      contexts: ['page', 'link', 'selection'],
    });

    // ── Separator ───────────────────────────────────
    chrome.contextMenus.create({
      id: 'pa-sep',
      parentId: 'pa-root',
      type: 'separator',
      contexts: ['link', 'selection'],
    });

    // ── Link actions ────────────────────────────────
    chrome.contextMenus.create({
      id: 'pa-block',
      parentId: 'pa-root',
      title: '🚫 Block This Domain',
      contexts: ['link'],
    });
    chrome.contextMenus.create({
      id: 'pa-unblock',
      parentId: 'pa-root',
      title: '✅ Unblock This Domain',
      contexts: ['link'],
    });
    chrome.contextMenus.create({
      id: 'pa-lookup-link',
      parentId: 'pa-root',
      title: '🗄️ Look Up in Tracker DB',
      contexts: ['link'],
    });

    // ── Selection action ────────────────────────────
    chrome.contextMenus.create({
      id: 'pa-lookup-sel',
      parentId: 'pa-root',
      title: '🗄️ Search Tracker DB: "%s"',
      contexts: ['selection'],
    });
  });
}

chrome.runtime.onInstalled.addListener(createContextMenus);
chrome.runtime.onStartup.addListener(createContextMenus);

// ── Context Menu click handler ────────────────────────────────
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {

    case 'pa-score': {
      if (!tab?.id) break;
      const d = tabData.get(tab.id);
      if (!d || d.trackers.size === 0) {
        createNotif('pa-score-' + tab.id, {
          type: 'basic', iconUrl: 'icons/icon48.png',
          title: 'Privacy Auditor',
          message: 'No scan data yet — reload the page first.',
        }, { type: 'info', url: tab.url ?? '' });
        break;
      }
      const score  = calculateScore(d);
      const grade  = score >= 80 ? '✅ Good'
                   : score >= 60 ? '🟡 Fair'
                   : score >= 40 ? '🟠 Poor'
                   : score >= 20 ? '🔴 Bad'
                   : '🚨 Critical';
      const domain = getDomain(tab.url) || tab.url;
      const mc     = d.mixedContent?.length ? ` · ⚠️ ${d.mixedContent.length} mixed` : '';
      createNotif('pa-score-' + tab.id, {
        type: 'basic', iconUrl: 'icons/icon48.png',
        title: `${grade}  ${score}/100 — ${domain}`,
        message: `🔍 ${d.trackers.size} trackers · 🖐 ${d.fingerprinting.size} fingerprint APIs · 🍪 ${d.cookies.count} cookies${mc}`,
      }, { type: 'score', url: tab.url ?? '' });
      break;
    }

    case 'pa-rescan': {
      if (tab?.id) chrome.tabs.reload(tab.id);
      break;
    }

    case 'pa-dashboard': {
      // Clear any pending deep-link so options opens normally
      await chrome.storage.local.remove('contextMenuAction');
      chrome.runtime.openOptionsPage();
      break;
    }

    case 'pa-block': {
      if (!info.linkUrl) break;
      try {
        const domain = new URL(info.linkUrl).hostname.replace(/^www\./, '');
        if (!domain) break;
        await blockDomain(domain);
        createNotif('pa-block-' + Date.now(), {
          type: 'basic', iconUrl: 'icons/icon48.png',
          title: 'Domain Blocked 🚫',
          message: `${domain} is now blocked on all sites.`,
        }, { type: 'block', url: info.linkUrl });
      } catch (_) {}
      break;
    }

    case 'pa-unblock': {
      if (!info.linkUrl) break;
      try {
        const domain = new URL(info.linkUrl).hostname.replace(/^www\./, '');
        if (!domain) break;
        await unblockDomain(domain);
        createNotif('pa-unblock-' + Date.now(), {
          type: 'basic', iconUrl: 'icons/icon48.png',
          title: 'Domain Unblocked ✅',
          message: `${domain} has been removed from your block list.`,
        }, { type: 'unblock', url: info.linkUrl });
      } catch (_) {}
      break;
    }

    case 'pa-lookup-link': {
      if (!info.linkUrl) break;
      try {
        const domain = new URL(info.linkUrl).hostname.replace(/^www\./, '');
        await chrome.storage.local.set({
          contextMenuAction: { type: 'tracker-db-search', query: domain },
        });
        chrome.runtime.openOptionsPage();
      } catch (_) {}
      break;
    }

    case 'pa-lookup-sel': {
      const query = info.selectionText?.trim();
      if (!query) break;
      await chrome.storage.local.set({
        contextMenuAction: { type: 'tracker-db-search', query },
      });
      chrome.runtime.openOptionsPage();
      break;
    }
  }
});
