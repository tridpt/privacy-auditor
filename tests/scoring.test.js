// ============================================================
//  Unit tests for lib/scoring.js — pure logic, no chrome.* APIs.
//  Run with:  npm test   (uses Node's built-in test runner)
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  TRACKERS, DOMAIN_FAMILIES, FIRST_PARTY_PENALTY,
  getDomain, matchTracker, isSameFamily, scoreToColor,
  getFirstPartyPenalty, calculateScore, trackerValues,
} = require('../lib/scoring.js');

// Helper: build a tracker value object as stored in tabData.
const trk = (name, category, risk) => ({ name, category, risk });

// ── getDomain ────────────────────────────────────────────────
test('getDomain strips www and returns hostname', () => {
  assert.equal(getDomain('https://www.example.com/path?q=1'), 'example.com');
  assert.equal(getDomain('https://sub.example.com'), 'sub.example.com');
  assert.equal(getDomain('http://localhost:3000'), 'localhost');
});

test('getDomain returns null for invalid input', () => {
  assert.equal(getDomain('not a url'), null);
  assert.equal(getDomain(''), null);
  assert.equal(getDomain(undefined), null);
});

// ── matchTracker ─────────────────────────────────────────────
test('matchTracker matches exact known tracker domains', () => {
  const m = matchTracker('google-analytics.com');
  assert.ok(m);
  assert.equal(m.name, 'Google Analytics');
  assert.equal(m.category, 'Analytics');
});

test('matchTracker matches subdomains of known trackers', () => {
  // ssl.google-analytics.com has no exact entry, so it resolves via the
  // subdomain fallback to the base google-analytics.com tracker.
  const m = matchTracker('ssl.google-analytics.com');
  assert.ok(m);
  assert.equal(m.name, 'Google Analytics');
});

test('matchTracker prefers an exact entry over the subdomain fallback', () => {
  // region1.google-analytics.com IS a distinct exact entry (GA4 endpoint).
  const m = matchTracker('region1.google-analytics.com');
  assert.ok(m);
  assert.equal(m.name, 'Google Analytics 4');
});

test('matchTracker returns null for unknown and empty domains', () => {
  assert.equal(matchTracker('example.com'), null);
  assert.equal(matchTracker(''), null);
  assert.equal(matchTracker(null), null);
});

test('matchTracker does not false-match a domain that merely contains a tracker name', () => {
  // "notgoogle-analytics.com" should NOT match "google-analytics.com"
  assert.equal(matchTracker('notgoogle-analytics.com'), null);
});

// ── isSameFamily ─────────────────────────────────────────────
test('isSameFamily detects same corporate family', () => {
  assert.equal(isSameFamily('fbcdn.net', 'facebook.com'), true);
  assert.equal(isSameFamily('ytimg.com', 'youtube.com'), true);
  assert.equal(isSameFamily('doubleclick.net', 'google.com'), true);
});

test('isSameFamily returns false across different families', () => {
  assert.equal(isSameFamily('facebook.com', 'google.com'), false);
  assert.equal(isSameFamily('example.com', 'facebook.com'), false);
});

test('isSameFamily returns false for null/empty input', () => {
  assert.equal(isSameFamily(null, 'facebook.com'), false);
  assert.equal(isSameFamily('facebook.com', ''), false);
});

// ── scoreToColor ─────────────────────────────────────────────
test('scoreToColor maps score ranges to expected colors', () => {
  assert.equal(scoreToColor(90), '#22c55e'); // green
  assert.equal(scoreToColor(80), '#22c55e');
  assert.equal(scoreToColor(70), '#84cc16'); // lime
  assert.equal(scoreToColor(55), '#f59e0b'); // amber
  assert.equal(scoreToColor(40), '#f97316'); // orange
  assert.equal(scoreToColor(10), '#ef4444'); // red
});

// ── getFirstPartyPenalty ─────────────────────────────────────
test('getFirstPartyPenalty flags known first-party collectors', () => {
  const fb = getFirstPartyPenalty('https://www.facebook.com/feed');
  assert.equal(fb.penalty, 30);
  assert.ok(fb.note);

  const sub = getFirstPartyPenalty('https://m.facebook.com');
  assert.equal(sub.penalty, 30); // subdomain still penalised
});

test('getFirstPartyPenalty returns zero for ordinary sites', () => {
  const r = getFirstPartyPenalty('https://example.com');
  assert.equal(r.penalty, 0);
  assert.equal(r.note, null);
});

test('getFirstPartyPenalty handles missing/invalid url', () => {
  assert.equal(getFirstPartyPenalty('').penalty, 0);
  assert.equal(getFirstPartyPenalty(undefined).penalty, 0);
});

// ── trackerValues ────────────────────────────────────────────
test('trackerValues normalizes Map, array, and empty input', () => {
  const m = new Map([['k', trk('A', 'Analytics', 'low')]]);
  assert.equal(trackerValues(m).length, 1);
  assert.equal(trackerValues([trk('B', 'Ads', 'high')]).length, 1);
  assert.deepEqual(trackerValues(undefined), []);
});

// ── calculateScore ───────────────────────────────────────────
test('calculateScore returns 100 for a clean page', () => {
  const data = {
    trackers: [],
    fingerprinting: new Set(),
    requests: { external: 0 },
    cookies: { count: 0 },
    url: 'https://example.com',
  };
  assert.equal(calculateScore(data), 100);
});

test('calculateScore penalises trackers (5 each, capped at 35)', () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => trk('T' + i, 'Analytics', 'medium'));
  const base = {
    fingerprinting: new Set(), requests: { external: 0 },
    cookies: { count: 0 }, url: 'https://example.com',
  };
  assert.equal(calculateScore({ ...base, trackers: mk(2) }), 90);  // -10
  assert.equal(calculateScore({ ...base, trackers: mk(7) }), 65);  // -35 (cap)
  assert.equal(calculateScore({ ...base, trackers: mk(20) }), 65); // still capped
});

test('calculateScore applies critical session-recorder penalty', () => {
  const data = {
    trackers: [trk('Hotjar', 'Session Recording', 'critical')],
    fingerprinting: new Set(), requests: { external: 0 },
    cookies: { count: 0 }, url: 'https://example.com',
  };
  // -5 (one tracker) -20 (critical) = 75
  assert.equal(calculateScore(data), 75);
});

test('calculateScore accepts fingerprinting as Set, array, or number', () => {
  const base = {
    trackers: [], requests: { external: 0 },
    cookies: { count: 0 }, url: 'https://example.com',
  };
  // 3 fingerprint techniques → -15 (capped)
  assert.equal(calculateScore({ ...base, fingerprinting: new Set(['a', 'b', 'c']) }), 85);
  assert.equal(calculateScore({ ...base, fingerprinting: ['a', 'b', 'c'] }), 85);
  assert.equal(calculateScore({ ...base, fingerprinting: 3 }), 85);
});

test('calculateScore tiers external requests', () => {
  const base = {
    trackers: [], fingerprinting: new Set(),
    cookies: { count: 0 }, url: 'https://example.com',
  };
  assert.equal(calculateScore({ ...base, requests: { external: 3 } }), 100); // no penalty <=5
  assert.equal(calculateScore({ ...base, requests: { external: 8 } }), 98);  // -2
  assert.equal(calculateScore({ ...base, requests: { external: 250 } }), 72); // -28
});

test('calculateScore never returns below zero', () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => trk('T' + i, 'Advertising', 'critical'));
  const data = {
    trackers: mk(30),
    fingerprinting: new Set(['a', 'b', 'c', 'd']),
    requests: { external: 500 },
    cookies: { count: 99 },
    url: 'https://facebook.com',
  };
  const score = calculateScore(data);
  assert.ok(score >= 0, `score should be >= 0, got ${score}`);
});

test('calculateScore handles missing optional fields gracefully', () => {
  // Only trackers provided — requests/cookies/fingerprinting absent
  const score = calculateScore({ trackers: [], url: 'https://example.com' });
  assert.equal(score, 100);
});

// ── Data integrity ───────────────────────────────────────────
test('every tracker entry has name, category, and valid risk', () => {
  const validRisks = new Set(['low', 'medium', 'high', 'critical']);
  for (const [domain, info] of Object.entries(TRACKERS)) {
    assert.ok(info.name, `${domain} missing name`);
    assert.ok(info.category, `${domain} missing category`);
    assert.ok(validRisks.has(info.risk), `${domain} has invalid risk: ${info.risk}`);
  }
});

test('FIRST_PARTY_PENALTY entries are well-formed', () => {
  for (const e of FIRST_PARTY_PENALTY) {
    assert.ok(e.domain);
    assert.ok(typeof e.penalty === 'number' && e.penalty > 0);
    assert.ok(e.note);
  }
});

test('DOMAIN_FAMILIES are non-empty arrays of strings', () => {
  for (const fam of DOMAIN_FAMILIES) {
    assert.ok(Array.isArray(fam) && fam.length > 0);
    for (const d of fam) assert.equal(typeof d, 'string');
  }
});
