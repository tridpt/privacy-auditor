// ============================================================
//  Privacy Auditor – Scoring & tracker logic (pure, testable)
//  Single source of truth shared by:
//   • background.js  (service worker, via importScripts)
//   • tests/*.test.mjs (Node, via require)
//  No chrome.* APIs here — keep this file side-effect free.
// ============================================================

// ── Tracker database ─────────────────────────────────────────
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
  'sc-static.net':            { name: 'Snapchat Pixel',         category: 'Advertising',          risk: 'high',     desc: 'Snapchat conversion tracking pixel' },

  // ── A/B Testing ──────────────────────────────────────────
  'optimizely.com':           { name: 'Optimizely',              category: 'A/B Testing',           risk: 'medium',   desc: 'A/B testing and feature flagging platform' },
  'vwo.com':                  { name: 'VWO',                     category: 'A/B Testing',           risk: 'medium',   desc: 'Visual Website Optimizer — A/B and multivariate testing' },
  'launchdarkly.com':         { name: 'LaunchDarkly',            category: 'A/B Testing',           risk: 'low',      desc: 'Feature flag and progressive delivery platform' },
  'abtasty.com':              { name: 'AB Tasty',                category: 'A/B Testing',           risk: 'medium',   desc: 'CRO platform with personalization and A/B testing' },
  'convert.com':              { name: 'Convert Experiences',     category: 'A/B Testing',           risk: 'medium',   desc: 'A/B testing for enterprise' },

  // ── CRM / Chat ────────────────────────────────────────────
  'intercom.io':              { name: 'Intercom',                category: 'Chat / CRM',            risk: 'low',      desc: 'Customer messaging and support platform' },
  'js.intercomcdn.com':       { name: 'Intercom CDN',            category: 'Chat / CRM',            risk: 'low'    },
  'drift.com':                { name: 'Drift',                   category: 'Chat / CRM',            risk: 'low',      desc: 'Conversational marketing and sales platform' },
  'driftt.com':               { name: 'Drift',                   category: 'Chat / CRM',            risk: 'low'    },
  'zd-cdn.com':               { name: 'Zendesk',                 category: 'Chat / CRM',            risk: 'low',      desc: 'Customer support and ticketing platform' },
  'widget.freshworks.com':    { name: 'Freshchat',               category: 'Chat / CRM',            risk: 'low',      desc: 'Freshworks customer messaging widget' },
  'tawk.to':                  { name: 'Tawk.to',                 category: 'Chat / CRM',            risk: 'low',      desc: 'Free live chat support widget' },

  // ── Adobe Suite ───────────────────────────────────────────
  'omtrdc.net':               { name: 'Adobe Analytics',         category: 'Analytics',             risk: 'medium',   desc: 'Adobe Analytics data collection — formerly Omniture SiteCatalyst' },
  '2o7.net':                  { name: 'Adobe SiteCatalyst',      category: 'Analytics',             risk: 'medium',   desc: 'Legacy Adobe Analytics beacon domain' },
  'adobedtm.com':             { name: 'Adobe Launch (DTM)',       category: 'Tag Manager',           risk: 'medium',   desc: 'Adobe tag management system' },
  'assets.adobedtm.com':      { name: 'Adobe DTM Assets',        category: 'Tag Manager',           risk: 'medium'   },
  'demdex.net':               { name: 'Adobe Audience Manager',  category: 'Data Broker',           risk: 'high',     desc: 'Adobe DMP — cross-site audience segmentation and data selling' },

  // ── Microsoft ─────────────────────────────────────────────
  'bat.bing.com':             { name: 'Microsoft Ads (UET)',      category: 'Advertising',           risk: 'high',     desc: 'Microsoft Universal Event Tracking for Bing Ads campaigns' },
  'c.bing.com':               { name: 'Bing Analytics',          category: 'Analytics',             risk: 'medium',   desc: 'Microsoft Bing web analytics' },

  // ── Amazon ────────────────────────────────────────────────
  'amazon-adsystem.com':      { name: 'Amazon Advertising',      category: 'Advertising',           risk: 'high',     desc: 'Amazon DSP and programmatic ad delivery across the web' },
  'ad.doubleclick.net':       { name: 'DoubleClick Ad',          category: 'Advertising',           risk: 'high'   },

  // ── Yandex / Russian ──────────────────────────────────────
  'mc.yandex.ru':             { name: 'Yandex Metrica',          category: 'Analytics',             risk: 'high',     desc: 'Russian analytics with session recording — subject to Russian data laws' },
  'mc.webvisor.org':          { name: 'Yandex Webvisor',         category: 'Session Recording',     risk: 'critical', desc: 'Yandex session replay tool — records mouse movement and keystrokes' },
  'counter.ok.ru':            { name: 'Odnoklassniki Counter',   category: 'Analytics',             risk: 'high',     desc: 'VK / Odnoklassniki tracking counter' },

  // ── HubSpot / Marketing Automation ───────────────────────
  'js.hs-analytics.net':      { name: 'HubSpot Analytics',       category: 'Marketing Automation',  risk: 'medium',   desc: 'HubSpot marketing, CRM, and lead tracking' },
  'js.hs-scripts.com':        { name: 'HubSpot Scripts',         category: 'Marketing Automation',  risk: 'medium'   },
  'track.hubspot.com':        { name: 'HubSpot Tracking',        category: 'Marketing Automation',  risk: 'medium'   },
  'pi.pardot.com':            { name: 'Salesforce Pardot',       category: 'Marketing Automation',  risk: 'medium',   desc: 'Salesforce B2B marketing automation and lead scoring' },
  'munchkin.marketo.net':     { name: 'Marketo Munchkin',        category: 'Marketing Automation',  risk: 'medium',   desc: 'Adobe Marketo lead tracking — follows users across pages' },
  'mktocdn.com':              { name: 'Marketo CDN',             category: 'Marketing Automation',  risk: 'medium'   },
  'klaviyo.com':              { name: 'Klaviyo',                 category: 'Marketing Automation',  risk: 'medium',   desc: 'E-commerce email and SMS marketing platform with behavioral tracking' },
  'a.klaviyo.com':            { name: 'Klaviyo Tracking',        category: 'Marketing Automation',  risk: 'medium'   },

  // ── Data Brokers / DMPs ───────────────────────────────────
  'bluekai.com':              { name: 'Oracle BlueKai',          category: 'Data Broker',           risk: 'critical', desc: 'Oracle DMP — collects, profiles, and sells user data at massive scale' },
  'data.krux.com':            { name: 'Salesforce Krux',         category: 'Data Broker',           risk: 'critical', desc: 'Salesforce DMP for cross-site audience data collection and monetization' },
  'liveramp.com':             { name: 'LiveRamp',                category: 'Data Broker',           risk: 'critical', desc: 'Identity resolution — links users across devices, browsers, and apps' },
  'rlcdn.com':                { name: 'LiveRamp CDN',            category: 'Data Broker',           risk: 'critical'  },
  'lotame.com':               { name: 'Lotame',                  category: 'Data Broker',           risk: 'high',     desc: 'Cross-device audience targeting and independent data exchange' },
  'exelator.com':             { name: 'Nielsen eXelate',         category: 'Data Broker',           risk: 'high',     desc: 'Nielsen audience data platform for cross-publisher targeting' },
  'mediamath.com':            { name: 'MediaMath',               category: 'Data Broker',           risk: 'high',     desc: 'Programmatic marketing platform with audience data sharing' },

  // ── Identity & Fingerprinting Services ───────────────────
  'api.fpjs.io':              { name: 'FingerprintJS Pro',       category: 'Fingerprinting',        risk: 'critical', desc: 'Commercial browser fingerprinting — uniquely identifies users without cookies, highly accurate' },
  'fpnpmcdn.net':             { name: 'FingerprintJS CDN',       category: 'Fingerprinting',        risk: 'critical'  },
  'cdn.fingerprint.com':      { name: 'Fingerprint.com',         category: 'Fingerprinting',        risk: 'critical', desc: 'Device identity / fraud detection using advanced browser fingerprinting' },
  'iovation.com':             { name: 'iovation (TransUnion)',    category: 'Fingerprinting',        risk: 'high',     desc: 'Device-based fraud prevention via fingerprinting — used in banking and e-commerce' },
  'threatmetrix.com':         { name: 'ThreatMetrix (LexisNexis)', category: 'Fingerprinting',      risk: 'high',     desc: 'Behavioral biometrics and device fingerprinting for fraud detection' },

  // ── Session Recording (additional) ───────────────────────
  'smartlook.com':            { name: 'Smartlook',               category: 'Session Recording',     risk: 'critical', desc: 'Screen recording and heatmaps — records all user interactions' },
  'rec.smartlook.com':        { name: 'Smartlook Recording',     category: 'Session Recording',     risk: 'critical'  },
  'contentsquare.net':        { name: 'ContentSquare',           category: 'Session Recording',     risk: 'critical', desc: 'Full session replay with digital experience analytics' },
  'glassbox.com':             { name: 'Glassbox',                category: 'Session Recording',     risk: 'critical', desc: 'Automatic session capture — records every click, tap, and scroll' },
  'ptengine.com':             { name: 'Ptengine',                category: 'Session Recording',     risk: 'critical', desc: 'Heatmap and session recording analytics' },
  'sessioncam.com':           { name: 'SessionCam',              category: 'Session Recording',     risk: 'critical', desc: 'Session recording, heatmaps, and funnel analysis' },
  'inspectlet.com':           { name: 'Inspectlet',              category: 'Session Recording',     risk: 'critical', desc: 'Session recording with eye-tracking heatmaps' },

  // ── Tag Managers ──────────────────────────────────────────
  'tealium.com':              { name: 'Tealium iQ',              category: 'Tag Manager',           risk: 'medium',   desc: 'Enterprise tag management and customer data platform' },
  'tags.tiqcdn.com':          { name: 'Tealium CDN',             category: 'Tag Manager',           risk: 'medium'   },

  // ── Ad Networks (additional) ─────────────────────────────
  'adsrvr.org':               { name: 'The Trade Desk',          category: 'Advertising',           risk: 'high',     desc: 'Major DSP for programmatic advertising — extensive cross-site tracking' },
  'indexexchange.com':        { name: 'Index Exchange',          category: 'Advertising',           risk: 'high',     desc: 'Header bidding and programmatic advertising exchange' },
  'bidswitch.net':            { name: 'BidSwitch (IPONWEB)',     category: 'Advertising',           risk: 'high',     desc: 'Real-time bidding infrastructure for programmatic auctions' },
  'media.net':                { name: 'Media.net (Yahoo)',       category: 'Advertising',           risk: 'high',     desc: 'Yahoo/Bing contextual advertising network' },
  'sovrn.com':                { name: 'Sovrn',                   category: 'Advertising',           risk: 'high',     desc: 'Publisher ad platform and data commerce' },
  'awin.com':                 { name: 'AWIN',                    category: 'Advertising',           risk: 'high',     desc: 'Global affiliate marketing network' },
  'tradedoubler.com':         { name: 'Tradedoubler',            category: 'Advertising',           risk: 'high',     desc: 'Performance marketing and affiliate network' },
  'smartadserver.com':        { name: 'Smart AdServer',          category: 'Advertising',           risk: 'high',     desc: 'Independent ad server for publishers and buyers' },
  '33across.com':             { name: '33Across',                category: 'Advertising',           risk: 'high',     desc: 'Cookieless advertising and identity resolution' },
  'casalemedia.com':          { name: 'Index Exchange (Casale)', category: 'Advertising',           risk: 'high'   },

  // ── Social / Sharing Widgets ─────────────────────────────
  'disqus.com':               { name: 'Disqus',                  category: 'Social',                risk: 'medium',   desc: 'Comment widget — tracks readers across all sites using it' },
  'addthis.com':              { name: 'AddThis (Oracle)',        category: 'Social',                risk: 'high',     desc: 'Social sharing widget with extensive cross-site behavioral tracking sold to Oracle' },
  'sharethis.com':            { name: 'ShareThis',               category: 'Social',                risk: 'high',     desc: 'Social sharing with user data monetization' },
  'go.redirectingat.com':     { name: 'Skimlinks',               category: 'Advertising',           risk: 'medium',   desc: 'Automatically converts links to affiliate links — tracks purchases' },

  // ── Extended Monitoring ───────────────────────────────────
  'bugsnag.com':              { name: 'Bugsnag',                 category: 'Monitoring',            risk: 'low',      desc: 'Application error monitoring and stability management' },
  'raygun.com':               { name: 'Raygun',                  category: 'Monitoring',            risk: 'low',      desc: 'Crash reporting and real user monitoring' },
  'rollbar.com':              { name: 'Rollbar',                 category: 'Monitoring',            risk: 'low',      desc: 'Real-time error tracking and alerting' },
  'cdn.lr-in.com':            { name: 'LogRocket CDN',           category: 'Session Recording',     risk: 'critical'  },
};

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

// ── Pure helpers ─────────────────────────────────────────────
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

function scoreToColor(score) {
  if (score >= 80) return '#22c55e'; // green   — safe
  if (score >= 65) return '#84cc16'; // lime    — okay
  if (score >= 50) return '#f59e0b'; // amber   — caution
  if (score >= 35) return '#f97316'; // orange  — risky
  return '#ef4444';                  // red     — critical
}

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

// `data.trackers` may be a Map (live service worker) or an array (tests/serialized).
function trackerValues(trackers) {
  if (!trackers) return [];
  if (trackers instanceof Map) return [...trackers.values()];
  if (Array.isArray(trackers)) return trackers;
  return [];
}

function calculateScore(data) {
  let score = 100;
  const trackers = trackerValues(data.trackers);

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

  // Fingerprinting (accept Set, array, or number)
  const fpField = data.fingerprinting;
  const fpCount = fpField instanceof Set ? fpField.size
                : Array.isArray(fpField) ? fpField.length
                : typeof fpField === 'number' ? fpField
                : 0;
  if (fpCount > 0) score -= Math.min(fpCount * 5, 15);

  // External requests – stricter tiers
  const ext = data.requests?.external ?? 0;
  if      (ext > 200) score -= 28;
  else if (ext > 100) score -= 22;
  else if (ext >  50) score -= 16;
  else if (ext >  25) score -= 10;
  else if (ext >  10) score -= 5;
  else if (ext >   5) score -= 2;

  // Cookies
  const ck = data.cookies?.count ?? 0;
  if      (ck > 30) score -= 10;
  else if (ck > 15) score -= 5;
  else if (ck >  5) score -= 2;

  return Math.max(0, Math.round(score));
}

// ── Exports for both worlds ──────────────────────────────────
// Service worker: importScripts() runs this in global scope, so the
// const declarations above are already globals — nothing more needed.
// Node (tests): expose via module.exports.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TRACKERS, DOMAIN_FAMILIES, FIRST_PARTY_PENALTY,
    getDomain, matchTracker, isSameFamily, scoreToColor,
    getFirstPartyPenalty, calculateScore, trackerValues,
  };
}
