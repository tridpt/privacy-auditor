// ============================================================
//  Unit tests for lib/headers.js — CSP & Referrer-Policy logic.
//  Pure functions, no chrome.* / DOM. Run with:  npm test
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCsp, analyzeCsp, normalizePolicy, referrerPolicyInfo, RP_DB, CSP_CHECKS,
} = require('../lib/headers.js');

// ── parseCsp ─────────────────────────────────────────────────
test('parseCsp splits directives into a keyed map', () => {
  const d = parseCsp("default-src 'self'; script-src 'self' https://cdn.example.com");
  assert.equal(d['default-src'], "'self'");
  assert.equal(d['script-src'], "'self' https://cdn.example.com");
});

test('parseCsp lowercases directive names and tolerates extra whitespace', () => {
  const d = parseCsp('  DEFAULT-SRC   none ;  IMG-SRC  data:  ');
  assert.equal(d['default-src'], 'none');
  assert.equal(d['img-src'], 'data:');
});

test('parseCsp returns empty object for empty/missing header', () => {
  assert.deepEqual(parseCsp(''), {});
  assert.deepEqual(parseCsp(null), {});
  assert.deepEqual(parseCsp(undefined), {});
});

// ── analyzeCsp: grading ──────────────────────────────────────
test('analyzeCsp grades a strong nonce-based policy as A', () => {
  const csp = "default-src 'self'; script-src 'nonce-abc123' 'strict-dynamic'; " +
              "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; " +
              "form-action 'self'";
  const { grade } = analyzeCsp(csp);
  assert.equal(grade, 'A');
});

test('analyzeCsp grades a CSP with both unsafe-inline + unsafe-eval as F', () => {
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  const { grade, issues } = analyzeCsp(csp);
  assert.equal(grade, 'F');
  // both critical issues should be present
  const titles = issues.map(i => i.title);
  assert.ok(titles.some(t => /unsafe-inline/.test(t)));
  assert.ok(titles.some(t => /unsafe-eval/.test(t)));
});

test('analyzeCsp grades a single critical issue as D', () => {
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
              "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'";
  const { grade } = analyzeCsp(csp);
  assert.equal(grade, 'D');
});

test('analyzeCsp flags HTTP source in script-src as critical', () => {
  const { issues } = analyzeCsp("script-src 'self' http://evil.example.com");
  assert.ok(issues.some(i => i.severity === 'critical' && /HTTP source/i.test(i.title)));
});

test('analyzeCsp flags wildcard in script-src as high', () => {
  const { issues } = analyzeCsp("script-src *");
  assert.ok(issues.some(i => i.severity === 'high' && /Wildcard/i.test(i.title)));
});

test('analyzeCsp reports missing default-src / frame-ancestors / object-src', () => {
  const { issues } = analyzeCsp("script-src 'self'");
  const titles = issues.map(i => i.title);
  assert.ok(titles.some(t => /No default-src/i.test(t)));
  assert.ok(titles.some(t => /frame-ancestors/i.test(t)));
  assert.ok(titles.some(t => /object-src/i.test(t)));
});

test('analyzeCsp does not duplicate the same issue title', () => {
  const { issues } = analyzeCsp("default-src 'unsafe-inline'; script-src 'unsafe-inline'");
  const titles = issues.map(i => i.title);
  assert.equal(new Set(titles).size, titles.length);
});

test('analyzeCsp recognizes positive (good) directives', () => {
  const { issues } = analyzeCsp("object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  assert.ok(issues.some(i => i.severity === 'good'));
});

// ── normalizePolicy ──────────────────────────────────────────
test('normalizePolicy lowercases and trims', () => {
  assert.equal(normalizePolicy('  No-Referrer  '), 'no-referrer');
});

test('normalizePolicy picks the last valid token from a comma list', () => {
  // browsers honor the last recognized policy in a comma-separated list
  assert.equal(normalizePolicy('unsafe-url, strict-origin-when-cross-origin'),
    'strict-origin-when-cross-origin');
});

test('normalizePolicy returns empty string for empty input', () => {
  assert.equal(normalizePolicy(''), '');
  assert.equal(normalizePolicy(null), '');
});

// ── referrerPolicyInfo ───────────────────────────────────────
test('referrerPolicyInfo grades recommended policy as A', () => {
  const { key, info } = referrerPolicyInfo('strict-origin-when-cross-origin');
  assert.equal(key, 'strict-origin-when-cross-origin');
  assert.equal(info.grade, 'A');
});

test('referrerPolicyInfo grades unsafe-url as F', () => {
  const { info } = referrerPolicyInfo('unsafe-url');
  assert.equal(info.grade, 'F');
});

test('referrerPolicyInfo treats a missing header as the empty-key entry', () => {
  const { key, info } = referrerPolicyInfo('');
  assert.equal(key, '');
  assert.equal(info.grade, RP_DB[''].grade);
});

test('referrerPolicyInfo falls back gracefully for non-standard values', () => {
  const { key, info } = referrerPolicyInfo('made-up-policy');
  assert.equal(key, 'made-up-policy');
  assert.ok(info.grade && info.desc); // has a usable descriptor
});

// ── data integrity ───────────────────────────────────────────
test('every CSP check has dirs, severity, icon, and title', () => {
  const valid = new Set(['critical', 'high', 'medium', 'good']);
  for (const c of CSP_CHECKS) {
    assert.ok(Array.isArray(c.dirs) && c.dirs.length, `dirs missing: ${c.title}`);
    assert.ok(valid.has(c.severity), `bad severity: ${c.title}`);
    assert.ok(c.icon && c.title && c.sub, `incomplete: ${c.title}`);
    assert.ok(c.pattern || c.negativeCheck, `no matcher: ${c.title}`);
  }
});

test('every RP_DB entry has grade, risk, riskLabel, and desc', () => {
  const grades = new Set(['A', 'B', 'C', 'F']);
  for (const [key, v] of Object.entries(RP_DB)) {
    assert.ok(grades.has(v.grade), `bad grade for "${key}"`);
    assert.ok(v.risk && v.riskLabel && v.desc, `incomplete RP entry "${key}"`);
  }
});
