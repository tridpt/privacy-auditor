// ============================================================
//  Privacy Auditor – Background Service Worker
// ============================================================

// ── Per-site blocking store (rule IDs 2000+) ─────────────────
// domain → declarativeNetRequest ruleId
const blockedRules = new Map();
let nextRuleId = 2000;

// ── Whitelist store ──────────────────────────────────────────
// hostname → whitelisted (no global block, no notification)
let whitelist = new Set();

// Restore everything on service worker startup
chrome.storage.local.get(['blockedDomains', 'globalProtection', 'whitelist'], async (result) => {
  const saved = result.blockedDomains || {};
  for (const [domain, ruleId] of Object.entries(saved)) {
    blockedRules.set(domain, ruleId);
    if (ruleId >= nextRuleId) nextRuleId = ruleId + 1;
  }
  whitelist = new Set(result.whitelist || []);
  if (result.globalProtection) {
    setTimeout(() => enableGlobalProtection(false), 0);
  }
});

async function persistWhitelist() {
  await chrome.storage.local.set({ whitelist: [...whitelist] });
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
    if (persist) await chrome.storage.local.set({ globalProtection: true });
  } catch (err) {
    console.error('[PrivacyAuditor] Global protection failed:', err);
    throw err;
  }
}

async function disableGlobalProtection() {
  const removeRuleIds = Object.keys(TRACKERS).map((_, idx) => GLOBAL_RULE_ID_START + idx);
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [] });
  await chrome.storage.local.set({ globalProtection: false });
  console.log('[PrivacyAuditor] Global OFF');
}

// ── Desktop notifications ───────────────────────────────────────
// Tracks tabs that already received a notification this page load
const notifiedTabs    = new Set();
const pendingTimers   = new Map(); // tabId → setTimeout handle

const NOTIFY_THRESHOLD = 45; // score below this triggers alert
const NOTIFY_DELAY_MS  = 3500; // wait for network requests to settle

function maybeNotify(tabId) {
  if (notifiedTabs.has(tabId)) return;
  if (!tabData.has(tabId))     return;

  const d        = tabData.get(tabId);
  const hostname = getDomain(d.url || '');
  if (hostname && whitelist.has(hostname)) return; // skip whitelisted sites

  const score = calculateScore(d);
  if (score >= NOTIFY_THRESHOLD) return;

  notifiedTabs.add(tabId);

  const trackerCount = d.trackers.size;
  const grade        = score < 20 ? 'Very Invasive' : 'Bad Privacy';

  chrome.notifications.create(`pa-${tabId}-${Date.now()}`, {
    type:     'basic',
    iconUrl:  'icons/icon48.png',
    title:    `⚠️ Privacy Alert — ${grade} (${score}/100)`,
    message:  `${hostname ?? 'This page'} is running ${trackerCount} tracker${trackerCount !== 1 ? 's' : ''}. Your data is being collected.`,
    priority: 1,
  }, (id) => {
    if (chrome.runtime.lastError) {
      console.error('[PA] Notification error:', chrome.runtime.lastError.message);
    }
  });
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

const TRACKERS = {
  // ── Google ──────────────────────────────────────────────
  'google-analytics.com':     { name: 'Google Analytics',     category: 'Analytics',         risk: 'medium' },
  'googletagmanager.com':     { name: 'Google Tag Manager',   category: 'Tag Manager',       risk: 'medium' },
  'googlesyndication.com':    { name: 'Google AdSense',       category: 'Advertising',       risk: 'high'   },
  'doubleclick.net':          { name: 'Google DoubleClick',   category: 'Advertising',       risk: 'high'   },
  'googleadservices.com':     { name: 'Google Ad Services',   category: 'Advertising',       risk: 'high'   },
  'adservice.google.com':     { name: 'Google Ad Service',    category: 'Advertising',       risk: 'high'   },
  'pagead2.googlesyndication.com': { name: 'Google PageAd',  category: 'Advertising',       risk: 'high'   },

  // ── Meta / Facebook ──────────────────────────────────────
  'connect.facebook.net':     { name: 'Facebook Pixel',       category: 'Advertising',       risk: 'high'   },
  'facebook.com':             { name: 'Facebook SDK',         category: 'Social',            risk: 'medium' },
  'fbcdn.net':                { name: 'Facebook CDN',         category: 'Social',            risk: 'medium' },
  'graph.facebook.com':       { name: 'Facebook Graph API',   category: 'Social',            risk: 'medium' },

  // ── Session Recorders ────────────────────────────────────
  'hotjar.com':               { name: 'Hotjar',               category: 'Session Recording', risk: 'critical' },
  'static.hotjar.com':        { name: 'Hotjar',               category: 'Session Recording', risk: 'critical' },
  'vars.hotjar.com':          { name: 'Hotjar',               category: 'Session Recording', risk: 'critical' },
  'fullstory.com':            { name: 'FullStory',            category: 'Session Recording', risk: 'critical' },
  'rs.fullstory.com':         { name: 'FullStory',            category: 'Session Recording', risk: 'critical' },
  'clarity.ms':               { name: 'Microsoft Clarity',   category: 'Session Recording', risk: 'critical' },
  'c.clarity.ms':             { name: 'Microsoft Clarity',   category: 'Session Recording', risk: 'critical' },
  'crazyegg.com':             { name: 'Crazy Egg',            category: 'Session Recording', risk: 'critical' },
  'luckyorange.com':          { name: 'Lucky Orange',         category: 'Session Recording', risk: 'critical' },
  'mouseflow.com':            { name: 'Mouseflow',            category: 'Session Recording', risk: 'critical' },
  'logrocket.com':            { name: 'LogRocket',            category: 'Session Recording', risk: 'critical' },

  // ── Analytics SDKs ───────────────────────────────────────
  'mixpanel.com':             { name: 'Mixpanel',             category: 'Analytics',         risk: 'medium' },
  'cdn.mxpnl.com':            { name: 'Mixpanel CDN',         category: 'Analytics',         risk: 'medium' },
  'segment.com':              { name: 'Segment',              category: 'Analytics',         risk: 'medium' },
  'cdn.segment.com':          { name: 'Segment CDN',          category: 'Analytics',         risk: 'medium' },
  'api.segment.io':           { name: 'Segment API',          category: 'Analytics',         risk: 'medium' },
  'amplitude.com':            { name: 'Amplitude',            category: 'Analytics',         risk: 'medium' },
  'api.amplitude.com':        { name: 'Amplitude API',        category: 'Analytics',         risk: 'medium' },
  'heapanalytics.com':        { name: 'Heap Analytics',       category: 'Analytics',         risk: 'medium' },
  'cdn.heapanalytics.com':    { name: 'Heap Analytics CDN',   category: 'Analytics',         risk: 'medium' },
  'sentry.io':                { name: 'Sentry',               category: 'Monitoring',        risk: 'low'    },
  'cloudflareinsights.com':   { name: 'Cloudflare Analytics', category: 'Analytics',         risk: 'low'    },
  'newrelic.com':             { name: 'New Relic',            category: 'Monitoring',        risk: 'low'    },
  'scorecardresearch.com':    { name: 'Comscore',             category: 'Analytics',         risk: 'medium' },

  // ── LinkedIn ───────────────────────────────────────────────
  'snap.licdn.com':           { name: 'LinkedIn Insight Tag', category: 'Advertising',       risk: 'high'   },
  'px.ads.linkedin.com':      { name: 'LinkedIn Ads',         category: 'Advertising',       risk: 'high'   },

  // ── Twitter / X ──────────────────────────────────────────
  'ads-twitter.com':          { name: 'Twitter/X Ads',        category: 'Advertising',       risk: 'high'   },
  'static.ads-twitter.com':   { name: 'Twitter/X Ads',        category: 'Advertising',       risk: 'high'   },
  'platform.twitter.com':     { name: 'Twitter Widget',       category: 'Social',            risk: 'medium' },

  // ── TikTok ───────────────────────────────────────────────
  'analytics.tiktok.com':     { name: 'TikTok Pixel',         category: 'Advertising',       risk: 'high'   },
  'business-api.tiktok.com':  { name: 'TikTok Business API',  category: 'Advertising',       risk: 'high'   },

  // ── Criteo ───────────────────────────────────────────────
  'criteo.com':               { name: 'Criteo',               category: 'Advertising',       risk: 'high'   },
  'static.criteo.net':        { name: 'Criteo',               category: 'Advertising',       risk: 'high'   },

  // ── Ad Networks ──────────────────────────────────────────
  'adnxs.com':                { name: 'Xandr / AppNexus',     category: 'Advertising',       risk: 'high'   },
  'quantserve.com':           { name: 'Quantcast',            category: 'Advertising',       risk: 'high'   },
  'moatads.com':              { name: 'Moat / Oracle Data',   category: 'Advertising',       risk: 'high'   },
  'taboola.com':              { name: 'Taboola',              category: 'Advertising',       risk: 'high'   },
  'outbrain.com':             { name: 'Outbrain',             category: 'Advertising',       risk: 'high'   },
  'rubiconproject.com':       { name: 'Rubicon Project',      category: 'Advertising',       risk: 'high'   },
  'pubmatic.com':             { name: 'PubMatic',             category: 'Advertising',       risk: 'high'   },
  'openx.net':                { name: 'OpenX',                category: 'Advertising',       risk: 'high'   },

  // ── Social ────────────────────────────────────────────────
  'ct.pinterest.com':         { name: 'Pinterest Tag',        category: 'Advertising',       risk: 'high'   },
  'sc-static.net':            { name: 'Snapchat Pixel',       category: 'Advertising',       risk: 'high'   },

  // ── A/B Testing ──────────────────────────────────────────
  'optimizely.com':           { name: 'Optimizely',           category: 'A/B Testing',       risk: 'medium' },
  'vwo.com':                  { name: 'VWO',                  category: 'A/B Testing',       risk: 'medium' },
  'launchdarkly.com':         { name: 'LaunchDarkly',         category: 'A/B Testing',       risk: 'low'    },

  // ── CRM / Chat ────────────────────────────────────────────
  'intercom.io':              { name: 'Intercom',             category: 'Chat / CRM',        risk: 'low'    },
  'js.intercomcdn.com':       { name: 'Intercom CDN',         category: 'Chat / CRM',        risk: 'low'    },
  'drift.com':                { name: 'Drift',                category: 'Chat / CRM',        risk: 'low'    },
  'driftt.com':               { name: 'Drift',                category: 'Chat / CRM',        risk: 'low'    },
  'zd-cdn.com':               { name: 'Zendesk',              category: 'Chat / CRM',        risk: 'low'    },
};

// ── In-memory tab data store ─────────────────────────────────
const tabData = new Map();

function initTabData(tabId, url = '') {
  tabData.set(tabId, {
    trackers:      new Map(),
    requests:      { total: 0, external: 0 },
    fingerprinting: new Set(),
    cookies:       { count: 0 },
    localStorage:  0,
    sessionStorage: 0,
    url,
    timestamp:     Date.now(),
  });
}

// ── Helpers ──────────────────────────────────────────────────
function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function matchTracker(domain) {
  if (!domain) return null;
  if (TRACKERS[domain]) return TRACKERS[domain];
  for (const [td, info] of Object.entries(TRACKERS)) {
    if (domain.endsWith('.' + td)) return info;
  }
  return null;
}

// ── Corporate domain families ─────────────────────────────────
// If a request comes from the SAME company as the page, it's not
// a third-party tracker (e.g. fbcdn.net when on facebook.com).
const DOMAIN_FAMILIES = [
  // Meta
  ['facebook.com', 'fbcdn.net', 'instagram.com', 'cdninstagram.com',
   'whatsapp.com', 'meta.com', 'fb.com', 'fb.watch', 'connect.facebook.net'],
  // Google
  ['google.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com',
   'youtube.com', 'ytimg.com', 'googlevideo.com', 'ggpht.com',
   'googletagmanager.com', 'google-analytics.com', 'googlesyndication.com',
   'doubleclick.net', 'googleadservices.com'],
  // Twitter / X
  ['twitter.com', 'twimg.com', 'x.com', 't.co', 'ads-twitter.com'],
  // Microsoft
  ['microsoft.com', 'msn.com', 'bing.com', 'live.com', 'azure.com',
   'clarity.ms', 'hotmail.com', 'outlook.com'],
  // Amazon
  ['amazon.com', 'amazonaws.com', 'amazon-adsystem.com', 'cloudfront.net'],
  // LinkedIn
  ['linkedin.com', 'licdn.com', 'snap.licdn.com'],
  // TikTok / ByteDance
  ['tiktok.com', 'tiktokcdn.com', 'analytics.tiktok.com'],
];

function isSameFamily(domainA, domainB) {
  if (!domainA || !domainB) return false;
  const matches = (d, candidate) =>
    d === candidate || d.endsWith('.' + candidate) || candidate.endsWith('.' + d);
  for (const family of DOMAIN_FAMILIES) {
    const aIn = family.some(f => matches(domainA, f));
    const bIn = family.some(f => matches(domainB, f));
    if (aIn && bIn) return true;
  }
  return false;
}

// ── Badge helper ──────────────────────────────────────────
function updateBadge(tabId) {
  if (!tabData.has(tabId)) {
    chrome.action.setBadgeText({ text: '', tabId });
    return;
  }
  const data   = tabData.get(tabId);
  const count  = data.trackers.size;

  if (count === 0) {
    chrome.action.setBadgeText({ text: '', tabId });
    return;
  }

  // Text: show count, cap at 99
  chrome.action.setBadgeText({
    text: count > 99 ? '99+' : String(count),
    tabId,
  });

  // Colour: red > orange > yellow based on worst risk
  const trackers   = [...data.trackers.values()];
  const hasCrit    = trackers.some(t => t.risk === 'critical');
  const hasHigh    = trackers.some(t => t.risk === 'high');
  const color      = (hasCrit || count > 5) ? '#ef4444'
                   : (hasHigh || count > 2)  ? '#f97316'
                   :                           '#f59e0b';

  chrome.action.setBadgeBackgroundColor({ color, tabId });

  // Badge text colour (white always)
  chrome.action.setBadgeTextColor?.({ color: '#ffffff', tabId });
}

// ── Known first-party data collectors ───────────────────────
// These sites ARE the tracker — penalise even when on their domain.
const FIRST_PARTY_PENALTY = [
  { domain: 'facebook.com',  penalty: 30, note: 'Meta (Facebook) collects extensive first-party data' },
  { domain: 'instagram.com', penalty: 25, note: 'Meta (Instagram) collects extensive first-party data' },
  { domain: 'tiktok.com',    penalty: 28, note: 'TikTok collects extensive behavioural data' },
  { domain: 'twitter.com',   penalty: 20, note: 'Twitter/X collects first-party tracking data' },
  { domain: 'x.com',         penalty: 20, note: 'Twitter/X collects first-party tracking data' },
  { domain: 'linkedin.com',  penalty: 18, note: 'LinkedIn tracks behaviour for ad targeting' },
  { domain: 'google.com',    penalty: 15, note: 'Google collects search & browsing data' },
  { domain: 'youtube.com',   penalty: 15, note: 'YouTube tracks watch history & behaviour' },
];

function getFirstPartyPenalty(url) {
  if (!url) return { penalty: 0, note: null };
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (const entry of FIRST_PARTY_PENALTY) {
      if (host === entry.domain || host.endsWith('.' + entry.domain)) {
        return entry;
      }
    }
  } catch (_) {}
  return { penalty: 0, note: null };
}

function calculateScore(data) {
  let score = 100;
  const trackers = [...data.trackers.values()];

  // Tracker penalties
  score -= Math.min(trackers.length * 5, 35);

  // Session recording is very invasive
  if (trackers.some(t => t.risk === 'critical')) score -= 20;

  // High-risk trackers
  const highRisk = trackers.filter(t => t.risk === 'high').length;
  score -= Math.min(highRisk * 2, 10);

  // First-party penalty (site itself is a data collector)
  const fp = getFirstPartyPenalty(data.url);
  score -= fp.penalty;

  // Fingerprinting
  const fpCount = data.fingerprinting.size;
  if (fpCount > 0) score -= Math.min(fpCount * 5, 15);

  // External requests – stricter tiers
  const ext = data.requests.external;
  if      (ext > 200) score -= 28;
  else if (ext > 100) score -= 22;
  else if (ext >  50) score -= 16;
  else if (ext >  25) score -= 10;
  else if (ext >  10) score -= 5;
  else if (ext >   5) score -= 2;

  // Cookies
  const ck = data.cookies.count;
  if      (ck > 30) score -= 10;
  else if (ck > 15) score -= 5;
  else if (ck >  5) score -= 2;

  return Math.max(0, Math.round(score));
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

    // Count as external only if truly a different org
    const isSubdomain = reqDomain && pageDomain &&
      (reqDomain.endsWith('.' + pageDomain) || pageDomain.endsWith('.' + reqDomain));

    if (reqDomain && pageDomain && reqDomain !== pageDomain
        && !isSubdomain
        && !isSameFamily(reqDomain, pageDomain)) {

      data.requests.external++;

      const tracker = matchTracker(reqDomain);
      if (tracker) {
        const key = tracker.name + '|' + tracker.category;
        if (!data.trackers.has(key)) {
          data.trackers.set(key, { ...tracker, domain: reqDomain, requestCount: 0 });
          updateBadge(tabId);
          // Schedule delayed notification when meaningful tracker found
          if (tracker.risk === 'high' || tracker.risk === 'critical') {
            scheduleNotify(tabId);
          }
        }
        data.trackers.get(key).requestCount++;
      }
    }
  },
  { urls: ['<all_urls>'] }
);

// ── Tab lifecycle ────────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    initTabData(tabId, tab.url || '');
    chrome.action.setBadgeText({ text: '', tabId });
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
      break;
    }

    case 'GET_DATA': {
      const tabId = message.tabId;
      if (!tabData.has(tabId)) {
        sendResponse(null);
        return true;
      }

      // Async: fetch accurate cookie count via chrome.cookies API
      // (reads HttpOnly + secure cookies that document.cookie cannot)
      ;(async () => {
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

        // Include first-party note if applicable
        const fpInfo = getFirstPartyPenalty(d.url);

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
          blocked:          [...blockedRules.keys()], // include currently blocked domains
        });
      })();

      return true; // keep message port open for async response
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
  }

  return false;
});
