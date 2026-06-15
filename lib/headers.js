// ============================================================
//  Privacy Auditor – CSP & Referrer-Policy analysis (pure, testable)
//  Single source of truth shared by:
//   • popup.js          (browser, via <script src="lib/headers.js">)
//   • tests/*.test.js   (Node, via require)
//  No chrome.* / DOM APIs here — keep this file side-effect free.
//  NOTE: classic <script> tags share one global lexical scope, so the
//  top-level const/function below are visible to popup.js (which loads
//  after this file). Do NOT re-declare these names in popup.js.
// ============================================================

// ── CSP: directive display order ─────────────────────────────
const CSP_DIRECTIVES_ORDER = [
  'default-src','script-src','script-src-elem','style-src','style-src-elem',
  'img-src','connect-src','font-src','media-src','frame-src',
  'frame-ancestors','form-action','base-uri','object-src','worker-src',
  'manifest-src','child-src','navigate-to',
];

// ── CSP: rule checks (critical → good) ───────────────────────
const CSP_CHECKS = [
  // ─ Critical ──────────────────────────────────────────────────
  { dirs: ['script-src','default-src'], pattern: /'unsafe-inline'/,
    severity: 'critical', icon: '⛔',
    title: "'unsafe-inline' in script-src",
    sub: 'Allows arbitrary inline <script> execution — negates XSS protection.' },
  { dirs: ['script-src','default-src'], pattern: /'unsafe-eval'/,
    severity: 'critical', icon: '⛔',
    title: "'unsafe-eval' in script-src",
    sub: 'Allows eval(), Function(), setTimeout(string) — XSS vector.' },
  { dirs: ['script-src','default-src'], pattern: /\bhttp:/,
    severity: 'critical', icon: '⛔',
    title: 'HTTP source in script-src',
    sub: 'Scripts from insecure HTTP can be MITM-injected.' },

  // ─ High ──────────────────────────────────────────────────────
  { dirs: ['script-src','default-src'], pattern: /(?<![a-z0-9\-])\*/,
    severity: 'high', icon: '🔴',
    title: 'Wildcard (*) in script-src',
    sub: 'Scripts can be loaded from any origin.' },
  { dirs: ['default-src'], negativeCheck: true, // missing default-src
    severity: 'high', icon: '🔴',
    title: 'No default-src directive',
    sub: 'Without default-src, many resource types have no fallback policy.' },
  { dirs: ['style-src','default-src'], pattern: /'unsafe-inline'/,
    severity: 'high', icon: '🔴',
    title: "'unsafe-inline' in style-src",
    sub: 'Allows arbitrary inline styles — CSS injection attacks possible.' },
  { dirs: ['frame-ancestors'], negativeCheck: true,
    severity: 'high', icon: '🔴',
    title: 'Missing frame-ancestors',
    sub: 'Without frame-ancestors, site may be embeddable — clickjacking risk.' },
  { dirs: ['object-src'], negativeCheck: true,
    severity: 'high', icon: '🔴',
    title: 'Missing object-src',
    sub: 'Plugins (Flash, Java applets) may load without restriction.' },

  // ─ Medium ────────────────────────────────────────────────────
  { dirs: ['script-src','default-src'], pattern: /\bdata:/,
    severity: 'medium', icon: '🟡',
    title: "data: URI in script-src",
    sub: 'data: URIs in scripts can be abused for XSS in some browsers.' },
  { dirs: ['base-uri'], negativeCheck: true,
    severity: 'medium', icon: '🟡',
    title: 'Missing base-uri',
    sub: 'Attackers can inject <base> tags to redirect relative URLs.' },
  { dirs: ['form-action'], negativeCheck: true,
    severity: 'medium', icon: '🟡',
    title: 'Missing form-action',
    sub: 'Forms may submit to external domains if not restricted.' },
  { dirs: ['img-src','default-src'], pattern: /(?<![a-z0-9\-])\*/,
    severity: 'medium', icon: '🟡',
    title: "Wildcard (*) in img-src",
    sub: 'Images from any origin — potential for tracking pixels.' },

  // ─ Good (positive) ───────────────────────────────────────────
  { dirs: ['object-src'], pattern: /'none'/,
    severity: 'good', icon: '✅',
    title: "object-src 'none'",
    sub: 'Plugins/Flash are fully blocked — excellent.' },
  { dirs: ['base-uri'], pattern: /'none'|'self'/,
    severity: 'good', icon: '✅',
    title: 'base-uri restricted',
    sub: 'Base tag injection prevented — good.' },
  { dirs: ['frame-ancestors'], pattern: /'none'|'self'/,
    severity: 'good', icon: '✅',
    title: 'frame-ancestors restricted',
    sub: 'Clickjacking protection in place.' },
  { dirs: ['script-src','default-src'], pattern: /'nonce-[^']+'/,
    severity: 'good', icon: '✅',
    title: 'Nonce-based script policy',
    sub: 'Using nonces for script allowlisting — modern best practice.' },
  { dirs: ['script-src','default-src'], pattern: /'strict-dynamic'/,
    severity: 'good', icon: '✅',
    title: "'strict-dynamic' in script-src",
    sub: 'Trusted scripts can propagate trust — very secure approach.' },
];

// ── CSP: parse header string into a { directive: value } map ──
function parseCsp(header) {
  if (!header) return {};
  const directives = {};
  header.split(';').forEach(part => {
    const tokens = part.trim().split(/\s+/);
    if (!tokens.length) return;
    const key = tokens[0].toLowerCase();
    if (key) directives[key] = tokens.slice(1).join(' ');
  });
  return directives;
}

// ── CSP: analyze + grade (A–F) ───────────────────────────────
function analyzeCsp(cspStr) {
  const directives = parseCsp(cspStr);
  const issues = [];
  const seen   = new Set(); // avoid duplicate issues

  for (const check of CSP_CHECKS) {
    const key = check.title;
    if (seen.has(key)) continue;

    if (check.negativeCheck) {
      // Flag if NONE of the listed directives are present
      const anyPresent = check.dirs.some(d => d in directives);
      if (!anyPresent) {
        issues.push({ ...check });
        seen.add(key);
      }
    } else if (check.pattern) {
      // Flag if ANY listed directive matches the pattern
      for (const dir of check.dirs) {
        if (dir in directives && check.pattern.test(directives[dir])) {
          issues.push({ ...check, matchedDir: dir });
          seen.add(key);
          break;
        }
      }
    }
  }

  // Grade: A–F
  const critCount = issues.filter(i => i.severity === 'critical').length;
  const highCount = issues.filter(i => i.severity === 'high').length;
  const goodCount = issues.filter(i => i.severity === 'good').length;
  let grade;
  // F only when CSP is present but completely neutered by both unsafe-inline + unsafe-eval
  const titleStr  = issues.map(i => i.title || '').join(' ');
  const bothUnsafe = /unsafe-inline/i.test(titleStr) && /unsafe-eval/i.test(titleStr);
  if      (!cspStr)                      grade = 'D'; // No CSP is common, was unfairly F
  else if (critCount >= 1 && bothUnsafe) grade = 'F'; // CSP present but useless
  else if (critCount >= 2)               grade = 'F';
  else if (critCount >= 1)               grade = 'D';
  else if (highCount >= 3)               grade = 'D';
  else if (highCount >= 1)               grade = 'C';
  else if (goodCount >= 3)               grade = 'A';
  else                                   grade = 'B';

  return { directives, issues, grade };
}

// ── Referrer-Policy database ─────────────────────────────────
const RP_DB = {
  'no-referrer': {
    grade: 'A', risk: 'safe', riskLabel: '✅ Best',
    desc: 'No referrer information is ever sent. Maximum privacy — third parties cannot see which page linked to them.',
    tip: null,
  },
  'strict-origin': {
    grade: 'A', risk: 'safe', riskLabel: '✅ Strict',
    desc: 'Only the origin (scheme + host) is sent to any destination. Path and query string are never leaked.',
    tip: null,
  },
  'strict-origin-when-cross-origin': {
    grade: 'A', risk: 'safe', riskLabel: '✅ Strict',
    desc: 'Full URL sent for same-origin requests; only origin sent cross-origin. The recommended modern default.',
    tip: null,
  },
  'same-origin': {
    grade: 'A', risk: 'safe', riskLabel: '✅ Good',
    desc: 'Full URL sent to same-origin only. No referrer is sent to cross-origin destinations.',
    tip: null,
  },
  'origin': {
    grade: 'B', risk: 'medium', riskLabel: '⚠️ Moderate',
    desc: 'Only the origin is sent to all destinations — including cross-origin. Path and query are hidden, but origin is always visible.',
    tip: 'Consider upgrading to strict-origin-when-cross-origin for better privacy.',
  },
  'origin-when-cross-origin': {
    grade: 'B', risk: 'medium', riskLabel: '⚠️ Moderate',
    desc: 'Full URL to same-origin; only origin to cross-origin. Slightly better than the default but still leaks origin to third parties.',
    tip: 'Consider strict-origin-when-cross-origin for stronger protection.',
  },
  'no-referrer-when-downgrade': {
    grade: 'C', risk: 'high', riskLabel: '🔶 Weak',
    desc: 'Full URL sent to HTTPS destinations, no referrer to HTTP. This is the browser default — it leaks full paths (including search terms, IDs) to all HTTPS third parties.',
    tip: 'Upgrade to strict-origin-when-cross-origin to prevent path leakage to third-party servers.',
  },
  '': {
    grade: 'C', risk: 'high', riskLabel: '🔶 Missing',
    desc: 'No Referrer-Policy header was set. Browser falls back to its default (usually no-referrer-when-downgrade), leaking full URLs to HTTPS third parties.',
    tip: 'Add: Referrer-Policy: strict-origin-when-cross-origin to your server response headers.',
  },
  'unsafe-url': {
    grade: 'F', risk: 'crit', riskLabel: '🚨 Critical',
    desc: 'Always sends the full URL including path, query string, and fragment to all destinations — even cross-origin, even over HTTP. Maximum exposure.',
    tip: 'Immediately change to strict-origin-when-cross-origin. unsafe-url leaks sensitive URLs to every third-party resource.',
  },
};

// ── Referrer-Policy: pick the effective token from a raw header ─
function normalizePolicy(raw) {
  if (!raw) return '';
  // Some servers send comma-separated list; use the last valid one (browsers do the same)
  const parts = raw.split(',').map(s => s.trim().toLowerCase());
  for (let i = parts.length - 1; i >= 0; i--) {
    if (RP_DB[parts[i]] !== undefined) return parts[i];
  }
  return parts[parts.length - 1] || '';
}

// Resolve a raw Referrer-Policy header to its info object, falling back to a
// sensible "unknown / non-standard" descriptor for experimental values.
function referrerPolicyInfo(raw) {
  const key  = normalizePolicy(raw);
  const info = RP_DB[key] ?? {
    grade: 'C', risk: 'high', riskLabel: '⚠️ Unknown',
    desc: `Policy "${key}" is non-standard or experimental. Check browser support.`,
    tip: 'Use strict-origin-when-cross-origin for broad compatibility and strong privacy.',
  };
  return { key, info };
}

// ── Exports for both worlds ──────────────────────────────────
// Browser: classic <script> runs this in global scope, so the const/function
// declarations above are already accessible to popup.js — nothing more needed.
// Node (tests): expose via module.exports.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CSP_DIRECTIVES_ORDER, CSP_CHECKS,
    parseCsp, analyzeCsp,
    RP_DB, normalizePolicy, referrerPolicyInfo,
  };
}
