// ============================================================
//  Privacy Auditor – Popup Logic
// ============================================================

'use strict';

// currently active tab id — needed for BLOCK_ALL
let currentTabId   = null;
let currentData    = null;  // full scan data for export

// ── Constants ────────────────────────────────────────────────
const ARC_TOTAL = 267.5; // π × 85  (radius of gauge arc)

const SCORE_GRADES = [
  { min: 80, label: '🟢 Good Privacy',   color: '#22c55e' },
  { min: 60, label: '🟡 Fair Privacy',   color: '#eab308' },
  { min: 40, label: '🟠 Poor Privacy',   color: '#f97316' },
  { min: 20, label: '🔴 Bad Privacy',    color: '#ef4444' },
  { min:  0, label: '⛔ Very Invasive',  color: '#dc2626' },
];

const FP_META = {
  canvas_toDataURL:    { icon: '🎨', title: 'Canvas Fingerprinting',        desc: 'Page reads canvas pixels via toDataURL() to build a device fingerprint.' },
  canvas_toBlob:       { icon: '🎨', title: 'Canvas Fingerprinting (Blob)',  desc: 'Page extracts canvas image data via toBlob() for identification.' },
  canvas_getImageData: { icon: '🖼️', title: 'Canvas Pixel Extraction',      desc: 'Page reads raw pixel data from a canvas element.' },
  webgl_context:       { icon: '🔺', title: 'WebGL Context Accessed',        desc: 'A WebGL context was created, often a precursor to GPU fingerprinting.' },
  webgl_getParameter:  { icon: '🔺', title: 'WebGL GPU Fingerprinting',      desc: 'Page queries WebGL parameters to fingerprint your GPU and graphics driver.' },
  audio_oscillator:    { icon: '🔊', title: 'Audio Fingerprinting',          desc: 'Page uses AudioContext oscillator to generate a hardware-unique audio fingerprint.' },
  audio_analyser:      { icon: '🔊', title: 'Audio Analyser Fingerprinting', desc: 'Page uses AudioContext analyser for audio-based device identification.' },
  font_check:          { icon: '🔤', title: 'Font Fingerprinting',           desc: 'Page checks which fonts are installed to create a fingerprint.' },
  battery_api:         { icon: '🔋', title: 'Battery API Accessed',          desc: 'Page reads battery status, which can be used for user tracking.' },
  navigator_fingerprint:{ icon: '🧭', title: 'Navigator Fingerprinting',     desc: 'Page systematically reads multiple navigator properties to identify you.' },
};

// ── Helpers ──────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getGrade(score) {
  return SCORE_GRADES.find(g => score >= g.min) ?? SCORE_GRADES.at(-1);
}

function scoreColor(score) {
  return getGrade(score).color;
}

// ── Permission Audit ──────────────────────────────────────────
const PERM_META = {
  geolocation:        { label: 'Location',       icon: '📍', risk: 'critical', rgb: '239,68,68',   color: '#ef4444', desc: 'Precise GPS / network location' },
  camera:             { label: 'Camera',         icon: '📷', risk: 'critical', rgb: '239,68,68',   color: '#ef4444', desc: 'Video capture from camera' },
  microphone:         { label: 'Microphone',     icon: '🎤', risk: 'critical', rgb: '239,68,68',   color: '#ef4444', desc: 'Audio capture from microphone' },
  notifications:      { label: 'Notifications',  icon: '🔔', risk: 'high',     rgb: '249,115,22',  color: '#f97316', desc: 'Show desktop notifications' },
  'clipboard-read':   { label: 'Clipboard Read', icon: '📋', risk: 'high',     rgb: '249,115,22',  color: '#f97316', desc: 'Read clipboard contents silently' },
  'clipboard-write':  { label: 'Clipboard Write',icon: '✏️', risk: 'medium',   rgb: '234,179,8',   color: '#eab308', desc: 'Write data to clipboard' },
  'payment-handler':  { label: 'Payment',        icon: '💳', risk: 'high',     rgb: '249,115,22',  color: '#f97316', desc: 'Handle payment requests' },
  push:               { label: 'Push Messages',  icon: '📡', risk: 'medium',   rgb: '234,179,8',   color: '#eab308', desc: 'Receive push messages when inactive' },
  'background-sync':  { label: 'BG Sync',        icon: '🔄', risk: 'medium',   rgb: '234,179,8',   color: '#eab308', desc: 'Sync data in background' },
  'persistent-storage':{ label: 'Persist Storage',icon: '💾', risk: 'low',    rgb: '99,102,241',  color: '#6366f1', desc: 'Persist data across sessions' },
  'screen-wake-lock': { label: 'Wake Lock',      icon: '🔆', risk: 'low',     rgb: '99,102,241',  color: '#6366f1', desc: 'Prevent screen from sleeping' },
  midi:               { label: 'MIDI',           icon: '🎵', risk: 'medium',   rgb: '234,179,8',   color: '#eab308', desc: 'Access MIDI musical devices' },
};

async function auditPermissions(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (permNames) => {
        const out = [];
        for (const name of permNames) {
          try {
            const status = await navigator.permissions.query({ name });
            out.push({ name, state: status.state });
          } catch (_) {
            out.push({ name, state: 'unsupported' });
          }
        }
        return out;
      },
      args: [Object.keys(PERM_META)],
    });
    return results?.[0]?.result ?? [];
  } catch (_) {
    return [];
  }
}

async function renderPermsTab(tabId) {
  const loadingEl = document.getElementById('permsLoading');
  const gridEl    = document.getElementById('permsGrid');
  const cleanEl   = document.getElementById('permsClean');
  const numEl     = document.getElementById('permsGrantedCount');
  const chipsEl   = document.getElementById('permsChips');

  loadingEl.classList.remove('hidden');
  gridEl.classList.add('hidden');
  cleanEl.classList.add('hidden');
  numEl.textContent = '—';
  chipsEl.innerHTML = '';

  const perms = await auditPermissions(tabId);

  loadingEl.classList.add('hidden');

  const granted = perms.filter(p => p.state === 'granted' && PERM_META[p.name]);
  const denied  = perms.filter(p => p.state === 'denied'  && PERM_META[p.name]);
  const prompt  = perms.filter(p => p.state === 'prompt'  && PERM_META[p.name]);

  // Summary number
  numEl.textContent = granted.length || '0';
  numEl.className   = 'perms-big-num' + (granted.length === 0 ? ' safe' : '');

  // Risk chips for granted
  const riskOrder = ['critical','high','medium','low'];
  const byRisk = {};
  granted.forEach(p => {
    const r = PERM_META[p.name].risk;
    byRisk[r] = (byRisk[r] || 0) + 1;
  });
  chipsEl.innerHTML = riskOrder
    .filter(r => byRisk[r])
    .map(r => `<span class="perm-chip ${r}">${byRisk[r]} ${r}</span>`)
    .join('');

  if (granted.length === 0 && denied.length === 0 && prompt.length === 0) {
    cleanEl.classList.remove('hidden');
    return;
  }

  // Sort: granted first (by risk), then denied, then prompt
  const riskScore = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [
    ...granted.sort((a,b) => (riskScore[PERM_META[a.name].risk]??9) - (riskScore[PERM_META[b.name].risk]??9)),
    ...denied,
    ...prompt.filter(p => PERM_META[p.name]),
  ];

  gridEl.innerHTML = sorted.map((p, i) => {
    const meta  = PERM_META[p.name];
    if (!meta) return '';
    const state = p.state;
    let stateClass, stateLabel;
    if (state === 'granted') {
      stateClass = `granted-${meta.risk}`;
      stateLabel = 'Granted';
    } else if (state === 'denied') {
      stateClass = 'denied';
      stateLabel = 'Denied ✓';
    } else {
      stateClass = 'prompt';
      stateLabel = 'Not asked';
    }
    const colorStyle = state === 'granted'
      ? `--perm-color:${meta.color};--perm-rgb:${meta.rgb};`
      : '';
    return `
      <div class="perm-card state-${state}" style="${colorStyle}animation-delay:${i*25}ms">
        <span class="perm-icon">${meta.icon}</span>
        <div class="perm-body">
          <div class="perm-name">${esc(meta.label)}</div>
          <div class="perm-desc">${esc(meta.desc)}</div>
        </div>
        <span class="perm-state ${stateClass}">${stateLabel}</span>
      </div>`;
  }).join('');

  gridEl.classList.remove('hidden');
  if (granted.length === 0) cleanEl.classList.remove('hidden');
}

// ── CSP Analyzer ─────────────────────────────────────────────
const CSP_DIRECTIVES_ORDER = [
  'default-src','script-src','script-src-elem','style-src','style-src-elem',
  'img-src','connect-src','font-src','media-src','frame-src',
  'frame-ancestors','form-action','base-uri','object-src','worker-src',
  'manifest-src','child-src','navigate-to',
];

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
  if      (!cspStr)          grade = 'F';
  else if (critCount >= 1)   grade = 'F';
  else if (highCount >= 3)   grade = 'D';
  else if (highCount >= 1)   grade = 'C';
  else if (goodCount >= 3)   grade = 'A';
  else                       grade = 'B';

  return { directives, issues, grade };
}

function highlightDirectiveValue(val) {
  return val
    .replace(/'unsafe-inline'|'unsafe-eval'|'unsafe-hashes'/g, m =>
      `<span class="unsafe">${m}</span>`)
    .replace(/\b\*\b/g, m => `<span class="wildcard">${m}</span>`)
    .replace(/'none'|'strict-dynamic'/g, m => `<span class="safe">${m}</span>`);
}

async function renderCspTab(tabId) {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_CSP', tabId });
  const cspStr = resp?.csp ?? null;

  const pill    = document.getElementById('cspGradePill');
  const label   = document.getElementById('cspGradeLabel');
  const statusEl = document.getElementById('cspHeaderStatus');
  const issuesEl = document.getElementById('cspIssues');
  const dirsEl   = document.getElementById('cspDirectives');
  const missingEl = document.getElementById('cspMissing');

  // null = not yet captured (page not reloaded since extension installed)
  // ''   = captured, no CSP header
  if (cspStr === null) {
    pill.textContent = '?';
    pill.className   = 'csp-grade-pill grade-D';
    label.textContent = 'Reload page to capture CSP';
    statusEl.textContent = '↺ Reload needed';
    statusEl.className   = 'csp-header-status missing';
    issuesEl.innerHTML = '';
    dirsEl.innerHTML   = '';
    missingEl.classList.add('hidden');
    return;
  }

  if (!cspStr) {
    pill.textContent  = 'F';
    pill.className    = 'csp-grade-pill grade-F';
    label.textContent = 'No CSP — Critical Risk';
    statusEl.textContent = '✗ Header absent';
    statusEl.className   = 'csp-header-status missing';
    issuesEl.innerHTML   = '';
    dirsEl.innerHTML     = '';
    missingEl.classList.remove('hidden');
    return;
  }

  missingEl.classList.add('hidden');
  statusEl.textContent = '✓ CSP Present';
  statusEl.className   = 'csp-header-status present';

  const { directives, issues, grade } = analyzeCsp(cspStr);
  const gradeLabels = { A:'Excellent',B:'Good',C:'Fair',D:'Weak',F:'Critical Risk' };

  pill.textContent  = grade;
  pill.className    = `csp-grade-pill grade-${grade}`;
  label.textContent = `Grade ${grade} — ${gradeLabels[grade]}`;

  // Issues
  const realIssues = issues.filter(i => i.severity !== 'good');
  const goodItems  = issues.filter(i => i.severity === 'good');
  const sortOrder  = { critical: 0, high: 1, medium: 2, good: 3 };
  realIssues.sort((a, b) => (sortOrder[a.severity] ?? 9) - (sortOrder[b.severity] ?? 9));

  issuesEl.innerHTML = [...realIssues, ...goodItems].map((iss, i) => `
    <div class="csp-issue" style="animation-delay:${i * 30}ms">
      <span class="csp-issue-icon">${iss.icon}</span>
      <div class="csp-issue-body">
        <div class="csp-issue-title">${iss.title}</div>
        <div class="csp-issue-sub">${iss.sub}</div>
      </div>
      <span class="csp-sev ${iss.severity}">${iss.severity}</span>
    </div>`).join('');

  // Directives breakdown
  const presentDirs = CSP_DIRECTIVES_ORDER.filter(d => d in directives);
  const otherDirs   = Object.keys(directives).filter(d => !CSP_DIRECTIVES_ORDER.includes(d));
  const allDirs     = [...presentDirs, ...otherDirs];

  dirsEl.innerHTML = allDirs.length
    ? `<div class="csp-dir-label">Directives (${allDirs.length})</div>` +
      allDirs.map(d => `
        <div class="csp-dir-row">
          <span class="csp-dir-key">${d}</span>
          <span class="csp-dir-val">${highlightDirectiveValue(
            esc(directives[d] || "'none'")
          )}</span>
        </div>`).join('')
    : '';
}

// ── Score Trend ───────────────────────────────────────────────
async function renderScoreTrend(hostname, currentScore) {
  const el = document.getElementById('scoreTrend');
  if (!el || !hostname) { el?.classList.add('hidden'); return; }

  // Read history — find PREVIOUS entry (older than 3s to avoid same-session writes)
  const { siteHistory = [] } = await chrome.storage.local.get('siteHistory');
  const prev = siteHistory.find(
    e => e.hostname === hostname && (Date.now() - e.timestamp) > 3000
  );

  if (!prev) {
    el.classList.add('hidden');
    return;
  }

  const delta = currentScore - prev.score;
  const absDelta = Math.abs(delta);

  let direction, arrow, label;
  if (delta > 0) {
    direction = 'up';
    arrow     = '↑';
    label     = `+${absDelta} vs last visit`;
  } else if (delta < 0) {
    direction = 'down';
    arrow     = '↓';
    label     = `${delta} vs last visit`;
  } else {
    direction = 'same';
    arrow     = '→';
    label     = 'Same as last visit';
  }

  el.className = `score-trend ${direction}`;
  el.innerHTML = `<span class="trend-arrow">${arrow}</span><span>${label}</span>`;
  el.title     = `Previous: ${prev.score}/100  ·  Now: ${currentScore}/100`;
  el.classList.remove('hidden');
}

// ── Gauge animation ───────────────────────────────────────────
function animateGauge(targetScore) {
  const arc   = document.getElementById('scoreArc');
  const num   = document.getElementById('scoreNum');
  const color = scoreColor(targetScore);

  arc.style.stroke = color;
  arc.style.filter = `drop-shadow(0 0 6px ${color}88)`;

  const duration = 1100;
  const start    = performance.now();

  function tick(now) {
    const t       = Math.min((now - start) / duration, 1);
    const eased   = 1 - Math.pow(1 - t, 3);
    const current = Math.round(targetScore * eased);
    const dash    = (current / 100) * ARC_TOTAL;

    num.textContent = current;
    arc.setAttribute('stroke-dasharray', `${dash} ${ARC_TOTAL + 10}`);

    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ── Stat cards ────────────────────────────────────────────────
function colorCard(id, value, { dangerAt, warnAt, okAt } = {}) {
  const card = document.getElementById(id);
  card.classList.remove('danger', 'warning', 'ok');
  if      (dangerAt !== undefined && value >= dangerAt) card.classList.add('danger');
  else if (warnAt   !== undefined && value >= warnAt)   card.classList.add('warning');
  else if (okAt     !== undefined && value <= okAt)     card.classList.add('ok');
}

// ── Render: Trackers ─────────────────────────────────────────
function renderTrackers(trackers, blockedSet = new Set()) {
  const list    = document.getElementById('trackerList');
  const empty   = document.getElementById('noTrackers');
  const blockBar = document.getElementById('blockBar');

  if (!trackers?.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    blockBar.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  blockBar.classList.remove('hidden');

  const order  = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...trackers].sort((a, b) => (order[a.risk] ?? 4) - (order[b.risk] ?? 4));

  list.innerHTML = sorted.map((t, i) => {
    const isBlocked = blockedSet.has(t.domain);
    return `
    <div class="tracker-item risk-${esc(t.risk)} ${isBlocked ? 'is-blocked' : ''}" style="animation-delay:${i * 30}ms" data-domain="${esc(t.domain)}">
      <div class="tracker-info">
        <div class="tracker-name">${esc(t.name)}</div>
        <div class="tracker-meta">${esc(t.category)} &bull; ${esc(t.domain)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <span class="badge badge-${esc(t.risk)}">${esc(t.risk)}</span>
        <button class="block-btn ${isBlocked ? 'is-blocked' : ''}" data-domain="${esc(t.domain)}">
          ${isBlocked ? '✓ Blocked' : 'Block'}
        </button>
      </div>
    </div>`;
  }).join('');
}

// ── Render: Fingerprinting ───────────────────────────────────
function renderFingerprinting(fps) {
  const list  = document.getElementById('fpList');
  const empty = document.getElementById('noFP');

  if (!fps?.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = fps.map((api, i) => {
    const m = FP_META[api] ?? { icon: '👁️', title: api, desc: 'Fingerprinting technique detected.' };
    return `
      <div class="fp-item" style="animation-delay:${i * 30}ms">
        <span class="fp-icon">${m.icon}</span>
        <div>
          <div class="fp-title">${esc(m.title)}</div>
          <div class="fp-desc">${esc(m.desc)}</div>
        </div>
      </div>`;
  }).join('');
}

// ── Render: Details ──────────────────────────────────────────
function renderDetails(data) {
  const recorders = (data.trackers ?? []).filter(t => t.risk === 'critical').length;

  document.getElementById('dCookies').textContent   = `${data.cookies?.count ?? 0}`;
  document.getElementById('dLS').textContent         = `${data.localStorage ?? 0} keys`;
  document.getElementById('dSS').textContent         = `${data.sessionStorage ?? 0} keys`;
  document.getElementById('dExtReq').textContent     = `${data.requests?.external ?? 0}`;
  document.getElementById('dTotalReq').textContent   = `${data.requests?.total ?? 0}`;
  document.getElementById('dRecorders').textContent  = recorders ? `${recorders} found ⚠️` : 'None ✅';
}

// ── Render: History ───────────────────────────────────────────
function scoreClass(score) {
  if (score >= 80) return 'score-good';
  if (score >= 60) return 'score-fair';
  if (score >= 40) return 'score-poor';
  if (score >= 20) return 'score-bad';
  return 'score-critical';
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

async function renderHistory() {
  const list  = document.getElementById('historyList');
  const empty = document.getElementById('noHistory');
  const { siteHistory = [] } = await chrome.storage.local.get('siteHistory');

  if (!siteHistory.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = siteHistory.map((e, i) => {
    const cls   = scoreClass(e.score);
    const metas = [`${e.trackerCount} tracker${e.trackerCount !== 1 ? 's' : ''}`,
                   e.fpCount ? `${e.fpCount} fingerprint` : null,
                   timeAgo(e.timestamp)].filter(Boolean).join(' · ');
    return `
    <div class="history-item" style="animation-delay:${i * 20}ms">
      <div class="history-score-dot ${cls}">${e.score}</div>
      <div class="history-info">
        <div class="history-host">${esc(e.hostname)}</div>
        <div class="history-meta">${esc(metas)}</div>
      </div>
    </div>`;
  }).join('');
}

// ── Cookie Manager ────────────────────────────────────────────
let allCookies = [];  // cache for filter

function cookieExpiryBadge(c) {
  if (!c.expirationDate) return `<span class="cookie-badge cb-session">Session</span>`;
  const daysLeft = Math.round((c.expirationDate * 1000 - Date.now()) / 86400000);
  if (daysLeft < 0) return `<span class="cookie-badge cb-session">Expired</span>`;
  if (daysLeft < 8) return `<span class="cookie-badge cb-expires">${daysLeft}d left</span>`;
  if (daysLeft < 365) return `<span class="cookie-badge cb-expires">${daysLeft}d</span>`;
  return `<span class="cookie-badge cb-expires">${Math.round(daysLeft/365)}y</span>`;
}

function renderCookieList(cookies) {
  const list  = document.getElementById('cookieList');
  const empty = document.getElementById('noCookies');
  document.getElementById('cookieCount').textContent = `${cookies.length} cookie${cookies.length !== 1 ? 's' : ''}`;

  if (!cookies.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = cookies.map((c, i) => {
    const badges = [
      c.httpOnly  ? `<span class="cookie-badge cb-httponly">HttpOnly</span>` : '',
      c.secure    ? `<span class="cookie-badge cb-secure">Secure</span>`   : '',
      c.sameSite && c.sameSite !== 'unspecified'
                  ? `<span class="cookie-badge cb-samesite">${esc(c.sameSite)}</span>` : '',
      cookieExpiryBadge(c),
    ].join('');

    return `
    <div class="cookie-item" style="animation-delay:${i * 15}ms">
      <div class="cookie-body">
        <div class="cookie-name" title="${esc(c.name)}">${esc(c.name) || '<em>unnamed</em>'}</div>
        <div class="cookie-domain">${esc(c.domain)} • ${esc(c.path)}</div>
        <div class="cookie-badges">${badges}</div>
      </div>
      <button class="delete-cookie-btn" data-name="${esc(c.name)}" data-domain="${esc(c.domain)}" data-path="${esc(c.path)}" title="Delete this cookie">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
          <path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>`;
  }).join('');
}

async function renderCookies() {
  if (!currentHostname) return;
  // getAll by domain (Chrome includes parent domains automatically)
  allCookies = await chrome.cookies.getAll({ domain: currentHostname });
  // Sort: httpOnly first, then by name
  allCookies.sort((a, b) => (b.httpOnly - a.httpOnly) || a.name.localeCompare(b.name));
  renderCookieList(allCookies);
}

// Filter input
document.getElementById('cookieFilter').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  renderCookieList(q ? allCookies.filter(c => c.name.toLowerCase().includes(q)) : allCookies);
});

// Delete single cookie (event delegation on list)
document.getElementById('cookieList').addEventListener('click', async (e) => {
  const btn = e.target.closest('.delete-cookie-btn');
  if (!btn) return;
  btn.disabled = true;
  await chrome.cookies.remove({
    url:  `http${btn.dataset.domain.startsWith('.') ? 's' : ''}://${btn.dataset.domain.replace(/^\./, '')}${btn.dataset.path}`,
    name: btn.dataset.name,
  });
  await renderCookies(); // refresh
});

// Delete All cookies for this site
document.getElementById('deleteAllCookiesBtn').addEventListener('click', async () => {
  const confirmBtn = document.getElementById('deleteAllCookiesBtn');
  confirmBtn.textContent = '⏳';
  confirmBtn.disabled = true;
  for (const c of allCookies) {
    const proto = c.secure ? 'https' : 'http';
    const domain = c.domain.replace(/^\./, '');
    await chrome.cookies.remove({ url: `${proto}://${domain}${c.path}`, name: c.name });
  }
  await renderCookies();
  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Delete All';
});

// ── Update stats bar ─────────────────────────────────────────
function updateStats(data) {
  const trackerCount = data.trackers?.length ?? 0;
  const fpCount      = data.fingerprinting?.length ?? 0;
  const cookieCount  = data.cookies?.count ?? 0;
  const extReqs      = data.requests?.external ?? 0;
  const blocked      = data.blockedRequests ?? 0;

  document.getElementById('statTrackers').textContent = trackerCount;
  document.getElementById('statFP').textContent       = fpCount;
  document.getElementById('statCookies').textContent  = cookieCount;
  document.getElementById('statExtReq').textContent   = extReqs;
  document.getElementById('statBlocked').textContent  = blocked;

  colorCard('cardTrackers', trackerCount, { dangerAt: 6, warnAt: 2, okAt: 0 });
  colorCard('cardFP',       fpCount,      { dangerAt: 1 });
  colorCard('cardCookies',  cookieCount,  { dangerAt: 25, warnAt: 10, okAt: 3 });
  colorCard('cardExtReq',   extReqs,      { dangerAt: 40, warnAt: 15 });

  // Shield card pulses when actively blocking
  const shieldCard = document.getElementById('cardBlocked');
  shieldCard.classList.toggle('active', blocked > 0);

  // Lifetime banner
  const lifetime = data.lifetimeBlocked ?? 0;
  if (lifetime > 0) {
    const banner = document.getElementById('lifetimeBanner');
    const count  = document.getElementById('lifetimeCount');
    banner.classList.remove('hidden');
    animateCount(count, lifetime);
  }
}

function animateCount(el, target) {
  const duration = 800;
  const start    = performance.now();
  const from     = parseInt(el.textContent.replace(/,/g,''), 10) || 0;
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const v = Math.round(from + (target - from) * (1 - Math.pow(1-t, 3)));
    el.textContent = v.toLocaleString();
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ── Show / hide panes ─────────────────────────────────────────
function showPane(id) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// ── Tab wiring ────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    showPane(btn.dataset.tab + 'Tab');
    if (btn.dataset.tab === 'cookies') renderCookies();
    if (btn.dataset.tab === 'csp'  && currentTabId) renderCspTab(currentTabId);
    if (btn.dataset.tab === 'perms' && currentTabId) renderPermsTab(currentTabId);
    if (btn.dataset.tab === 'history') {
      renderHistory();
      renderWhitelistSection();
    }
  });
});

// ── Clear History button ──────────────────────────────────────
document.getElementById('clearHistoryBtn').addEventListener('click', async () => {
  await chrome.storage.local.remove('siteHistory');
  renderHistory();
});

// ── AI Analysis (Gemini) ──────────────────────────────────────
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function buildPrompt(data, hostname, language) {
  const trackerList = (data.trackers ?? []).map(t =>
    `- ${t.name} [${t.category}] Risk:${t.risk.toUpperCase()}${(data.blocked??[]).some(b=>b===t.name+'|'+t.category)?' (BLOCKED)':''}`
  ).join('\n') || '- None detected';

  const fpList = (data.fingerprinting ?? []).map(f => `- ${f.technique}`).join('\n') || '- None';

  return `You are a privacy security expert. Analyze this website privacy scan and explain in ${language}.

Website: ${hostname}
Privacy Score: ${data.score}/100
Grade: ${data.score < 20 ? 'Critical' : data.score < 40 ? 'Bad' : data.score < 60 ? 'Poor' : data.score < 80 ? 'Fair' : 'Good'}

TRACKERS (${(data.trackers??[]).length}):
${trackerList}

FINGERPRINTING:
${fpList}

STORAGE: localStorage=${data.localStorage??0} keys, sessionStorage=${data.sessionStorage??0} keys
COOKIES: ~${data.cookies?.count ?? 'unknown'}
EXTERNAL REQUESTS: ${data.requests?.external ?? 0}

Respond ONLY with valid JSON (no markdown, no code blocks):
{
  "summary": "2-3 sentences in ${language} explaining what this site does with user data",
  "risks": ["risk 1 in ${language}", "risk 2", "risk 3"],
  "recommendations": ["action 1 in ${language}", "action 2", "action 3"],
  "verdict": "SAFE or CAUTION or DANGER"
}`;
}

async function runAiAnalysis() {
  if (!currentData || !currentHostname) return;

  const { geminiApiKey, aiLanguage = 'Vietnamese', geminiModel = 'gemini-2.0-flash-lite' } =
    await chrome.storage.local.get(['geminiApiKey', 'aiLanguage', 'geminiModel']);

  const panel   = document.getElementById('aiPanel');
  const loading = document.getElementById('aiLoading');
  const content = document.getElementById('aiContent');
  const errEl   = document.getElementById('aiError');
  const errMsg  = document.getElementById('aiErrorMsg');
  const errBtn  = document.getElementById('aiErrorSettingsBtn');

  // Reset state
  panel.classList.remove('hidden');
  loading.classList.remove('hidden');
  content.classList.add('hidden');
  errEl.classList.add('hidden');
  errBtn.classList.add('hidden');
  document.getElementById('aiAnalyzeBtn').disabled = true;

  if (!geminiApiKey) {
    loading.classList.add('hidden');
    errMsg.textContent = '⚠️ Gemini API key not set.';
    errEl.classList.remove('hidden');
    errBtn.classList.remove('hidden');
    document.getElementById('aiAnalyzeBtn').disabled = false;
    return;
  }

  try {
    const prompt = buildPrompt(currentData, currentHostname, aiLanguage);
    const resp = await fetch(`${GEMINI_BASE}/${geminiModel}:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 600 },
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `HTTP ${resp.status}`);
    }

    const json = await resp.json();
    const raw  = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    // Parse JSON from response (strip possible code fences)
    const cleaned = raw.replace(/```json|```/g, '').trim();
    let result;
    try { result = JSON.parse(cleaned); }
    catch { throw new Error('Không thể parse kết quả từ Gemini. Thử lại.'); }

    // Render verdict
    const verdictEl = document.getElementById('aiVerdict');
    const verdict   = (result.verdict ?? '').toUpperCase();
    const verdictMap = { SAFE: ['verdict-safe','✅ An toàn'], CAUTION: ['verdict-caution','⚠️ Cảnh báo'], DANGER: ['verdict-danger','🔴 Nguy hiểm'] };
    const [cls, label] = verdictMap[verdict] ?? ['verdict-caution', '⚠️ Không xác định'];
    verdictEl.className = 'ai-verdict-badge ' + cls;
    verdictEl.textContent = label;

    // Render summary
    document.getElementById('aiSummary').textContent = result.summary ?? '';

    // Render risks
    document.getElementById('aiRisks').innerHTML = (result.risks ?? []).map(r => `<li>${esc(r)}</li>`).join('');

    // Render recommendations
    document.getElementById('aiRecommendations').innerHTML = (result.recommendations ?? []).map(r => `<li>${esc(r)}</li>`).join('');

    loading.classList.add('hidden');
    content.classList.remove('hidden');

  } catch (err) {
    loading.classList.add('hidden');
    errMsg.textContent = '❌ ' + (err.message || 'Lỗi không xác định');
    errEl.classList.remove('hidden');
  } finally {
    document.getElementById('aiAnalyzeBtn').disabled = false;
  }
}

document.getElementById('aiAnalyzeBtn').addEventListener('click', runAiAnalysis);

document.getElementById('aiCloseBtn').addEventListener('click', () => {
  document.getElementById('aiPanel').classList.add('hidden');
});

document.getElementById('aiErrorSettingsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ── Whitelist button (current site) ──────────────────────────
let currentHostname = null;

function updateWhitelistUI(isWhitelisted) {
  const btn    = document.getElementById('whitelistBtn');
  const banner = document.getElementById('whitelistBanner');
  btn.classList.remove('hidden');
  if (isWhitelisted) {
    btn.textContent = '🛡️ Whitelisted — click to remove';
    btn.classList.add('is-whitelisted');
    banner.classList.remove('hidden');
  } else {
    btn.textContent = '+ Whitelist this site';
    btn.classList.remove('is-whitelisted');
    banner.classList.add('hidden');
  }
}

document.getElementById('whitelistBtn').addEventListener('click', async () => {
  if (!currentHostname) return;
  const btn = document.getElementById('whitelistBtn');
  const isWL = btn.classList.contains('is-whitelisted');
  btn.disabled = true;

  const type = isWL ? 'REMOVE_FROM_WHITELIST' : 'ADD_TO_WHITELIST';
  await chrome.runtime.sendMessage({ type, hostname: currentHostname });
  updateWhitelistUI(!isWL);
  btn.disabled = false;
});

// ── Whitelist section in History tab ─────────────────────────
async function renderWhitelistSection() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST' });
  const wl   = resp?.whitelist ?? [];
  const section = document.getElementById('whitelistSection');
  const items   = document.getElementById('whitelistItems');

  if (!wl.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  items.innerHTML = wl.map(h => `
    <div class="whitelist-item">
      <span class="whitelist-item-host">${esc(h)}</span>
      <button class="whitelist-remove-btn" data-host="${esc(h)}">Remove</button>
    </div>`).join('');

  items.addEventListener('click', async (e) => {
    const btn = e.target.closest('.whitelist-remove-btn');
    if (!btn) return;
    await chrome.runtime.sendMessage({ type: 'REMOVE_FROM_WHITELIST', hostname: btn.dataset.host });
    if (btn.dataset.host === currentHostname) updateWhitelistUI(false);
    renderWhitelistSection();
  }, { once: true });
}

// ── Load & render data ────────────────────────────────────────
async function loadData() {
  const states = {
    loading: document.getElementById('loadingState'),
    error:   document.getElementById('errorState'),
    nodata:  document.getElementById('nodataState'),
    main:    document.getElementById('mainContent'),
  };

  Object.values(states).forEach(el => el.classList.add('hidden'));
  states.loading.classList.remove('hidden');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Pages we can't analyze
    if (!tab?.url || /^(chrome|about|edge|brave):/.test(tab.url)) {
      states.loading.classList.add('hidden');
      states.error.classList.remove('hidden');
      return;
    }

    // Request data from background
    const data = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'GET_DATA', tabId: tab.id }, (resp) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(resp);
      });
    });

    states.loading.classList.add('hidden');

    if (!data) {
      states.nodata.classList.remove('hidden');
      return;
    }

    // Populate UI
    let hostname = '';
    try {
      hostname = new URL(tab.url).hostname.replace(/^www\./, '');
      document.getElementById('siteHostname').textContent = hostname;
    } catch (_) {}

    currentHostname = hostname || null;

    // Check if current site is whitelisted
    if (currentHostname) {
      const wlResp = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST' });
      const wl = new Set(wlResp?.whitelist ?? []);
      updateWhitelistUI(wl.has(currentHostname));
    }

    // Reveal AI button
    document.getElementById('aiAnalyzeBtn').classList.remove('hidden');

    const grade = getGrade(data.score);
    const gradeEl = document.getElementById('scoreGrade');
    gradeEl.textContent = grade.label;
    gradeEl.style.color = grade.color;

    // Trend arrow — compare with previous visit
    renderScoreTrend(hostname, data.score);

    // First-party data collector warning
    const banner = document.getElementById('firstPartyBanner');
    if (data.firstPartyNote) {
      banner.textContent = '⚠️ ' + data.firstPartyNote;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }

    currentTabId = tab.id;
    currentData  = data;    // save for export

    updateStats(data);
    const blockedSet = new Set(data.blocked ?? []);
    renderTrackers(data.trackers, blockedSet);
    renderFingerprinting(data.fingerprinting);
    renderDetails(data);

    if (data.timestamp) {
      document.getElementById('footerTime').textContent =
        'Scanned ' + new Date(data.timestamp).toLocaleTimeString();
    }

    states.main.classList.remove('hidden');
    animateGauge(data.score);


  } catch (err) {
    console.error('[PrivacyAuditor]', err);
    states.loading.classList.add('hidden');
    states.error.classList.remove('hidden');
  }
}

// ── Refresh button ────────────────────────────────────────────
document.getElementById('refreshBtn').addEventListener('click', () => {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  setTimeout(() => btn.classList.remove('spinning'), 500);
  loadData();
});

// ── Reload page button ────────────────────────────────────────
document.getElementById('reloadPageBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.reload(tab.id);
});

// ── Block All button ──────────────────────────────────────────
document.getElementById('blockAllBtn').addEventListener('click', async () => {
  if (!currentTabId) return;
  const btn = document.getElementById('blockAllBtn');
  btn.textContent = '⏳ Blocking...';
  btn.disabled = true;
  const resp = await chrome.runtime.sendMessage({ type: 'BLOCK_ALL', tabId: currentTabId });
  const blockedSet = new Set(resp?.blocked ?? []);
  // Re-render tracker list with updated blocked state
  const list = document.getElementById('trackerList');
  list.querySelectorAll('.block-btn').forEach(b => {
    const domain = b.dataset.domain;
    const row    = b.closest('.tracker-item');
    if (blockedSet.has(domain)) {
      b.textContent = '✓ Blocked';
      b.classList.add('is-blocked');
      row?.classList.add('is-blocked');
    }
  });
  btn.disabled = false;
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Block All';
});

// ── Unblock All button ────────────────────────────────────────
document.getElementById('unblockAllBtn').addEventListener('click', async () => {
  const btn = document.getElementById('unblockAllBtn');
  btn.textContent = '⏳ Unblocking...';
  btn.disabled = true;
  await chrome.runtime.sendMessage({ type: 'UNBLOCK_ALL' });
  // Reset all block buttons
  document.getElementById('trackerList').querySelectorAll('.block-btn').forEach(b => {
    b.textContent = 'Block';
    b.classList.remove('is-blocked');
    b.closest('.tracker-item')?.classList.remove('is-blocked');
  });
  btn.disabled = false;
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Unblock All';
});

// ── Per-tracker block button (event delegation) ───────────────
document.getElementById('trackerList').addEventListener('click', async (e) => {
  const btn = e.target.closest('.block-btn');
  if (!btn) return;

  const domain    = btn.dataset.domain;
  const row       = btn.closest('.tracker-item');
  const isBlocked = btn.classList.contains('is-blocked');

  btn.disabled = true;
  btn.textContent = '⏳';

  if (isBlocked) {
    await chrome.runtime.sendMessage({ type: 'UNBLOCK_DOMAIN', domain });
    btn.textContent = 'Block';
    btn.classList.remove('is-blocked');
    row?.classList.remove('is-blocked');
  } else {
    await chrome.runtime.sendMessage({ type: 'BLOCK_DOMAIN', domain });
    btn.textContent = '✓ Blocked';
    btn.classList.add('is-blocked');
    row?.classList.add('is-blocked');
  }
  btn.disabled = false;
});

// ── Footer clock ─────────────────────────────────────────────
document.getElementById('footerTime').textContent = new Date().toLocaleTimeString();

// ── Global auto-block toggle ──────────────────────────────────
const globalToggle = document.getElementById('globalToggle');

// Load current state from background on popup open
chrome.runtime.sendMessage({ type: 'GET_GLOBAL_PROTECTION' }, (resp) => {
  if (resp?.globalProtection) globalToggle.checked = true;
});

globalToggle.addEventListener('change', async () => {
  const enabled = globalToggle.checked;
  globalToggle.disabled = true;

  const type = enabled ? 'ENABLE_GLOBAL_PROTECTION' : 'DISABLE_GLOBAL_PROTECTION';
  const resp = await chrome.runtime.sendMessage({ type });

  if (!resp?.ok) {
    // Revert toggle if it failed
    globalToggle.checked = !enabled;
    console.error('[PrivacyAuditor] Toggle failed:', resp);
  }
  globalToggle.disabled = false;
});

// ── Settings button ────────────────────────────────────────────
document.getElementById('openSettingsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ── Export Report ─────────────────────────────────────────────
async function exportReport() {
  if (!currentData || !currentHostname) return;

  const btn = document.getElementById('exportReportBtn');
  btn.classList.add('exporting');
  btn.textContent = '⏳ Preparing…';

  try {
    const d = currentData;
    const grade = getGrade(d.score);

    // Fetch real cookies via chrome.cookies API
    let cookies = [];
    try {
      cookies = await chrome.cookies.getAll({ domain: currentHostname });
    } catch (_) {}

    // Fetch whitelist and global protection state
    const wlResp = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST' });
    const { globalProtection } = await chrome.storage.local.get('globalProtection');
    const isWhitelisted = (wlResp?.whitelist ?? []).includes(currentHostname);

    const report = {
      meta: {
        tool:       'Privacy Auditor v1.0',
        exportedAt: new Date().toISOString(),
        scannedAt:  d.timestamp ? new Date(d.timestamp).toISOString() : null,
      },
      site: {
        hostname:          currentHostname,
        url:               d.url || null,
        whitelisted:       isWhitelisted,
        globalProtection:  !!globalProtection,
      },
      score: {
        value:   d.score,
        outOf:   100,
        grade:   grade.label,
      },
      summary: {
        trackers:          d.trackers?.length ?? 0,
        fingerprintingAPIs: d.fingerprinting?.length ?? 0,
        cookies:           cookies.length,
        externalRequests:  d.requests?.external ?? 0,
        totalRequests:     d.requests?.total ?? 0,
        localStorage:      d.localStorage ?? 0,
        sessionStorage:    d.sessionStorage ?? 0,
      },
      trackers: (d.trackers ?? []).map(t => ({
        name:         t.name,
        category:     t.category,
        risk:         t.risk,
        domain:       t.domain,
        requests:     t.requestCount ?? 0,
        blocked:      (d.blocked ?? []).includes(t.name + '|' + t.category),
      })),
      fingerprinting: (d.fingerprinting ?? []).map(f => ({
        technique:   f.technique,
        severity:    f.severity,
        description: f.description ?? null,
      })),
      cookies: cookies.map(c => ({
        name:           c.name,
        domain:         c.domain,
        path:           c.path,
        httpOnly:       c.httpOnly,
        secure:         c.secure,
        sameSite:       c.sameSite,
        session:        !c.expirationDate,
        expiresAt:      c.expirationDate ? new Date(c.expirationDate * 1000).toISOString() : null,
      })),
      blocked: d.blocked ?? [],
    };

    // Trigger download
    const json     = JSON.stringify(report, null, 2);
    const blob     = new Blob([json], { type: 'application/json' });
    const url      = URL.createObjectURL(blob);
    const date     = new Date().toISOString().slice(0, 10);
    const filename = `privacy-report-${currentHostname}-${date}.json`;

    const a = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } finally {
    btn.classList.remove('exporting');
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Export Privacy Report (.json)`;
  }
}

document.getElementById('exportReportBtn').addEventListener('click', exportReport);

// ── Auto-Rescan ───────────────────────────────────────────────
let autoRescanTimer   = null;
let autoRescanTick    = null;
let autoRescanSeconds = 0;
let autoRescanTotal   = 10;

const autoRescanBtn      = document.getElementById('autoRescanBtn');
const autoRescanInterval = document.getElementById('autoRescanInterval');
const rescanBar          = document.getElementById('rescanBar');
const rescanCountdown    = document.getElementById('rescanCountdown');
const rescanProgress     = document.getElementById('rescanProgress');
const rescanNowBtn       = document.getElementById('rescanNowBtn');

function stopAutoRescan() {
  clearInterval(autoRescanTimer);
  clearInterval(autoRescanTick);
  autoRescanTimer = null;
  autoRescanBtn.classList.remove('active');
  rescanBar.classList.add('hidden');
}

function tickCountdown() {
  autoRescanSeconds--;
  if (autoRescanSeconds < 0) autoRescanSeconds = 0;
  const pct = ((autoRescanTotal - autoRescanSeconds) / autoRescanTotal) * 100;
  rescanProgress.style.width = pct + '%';
  rescanCountdown.textContent = `Next scan in ${autoRescanSeconds}s`;
}

function startAutoRescan() {
  autoRescanTotal   = parseInt(autoRescanInterval.value, 10);
  autoRescanSeconds = autoRescanTotal;

  rescanBar.classList.remove('hidden');
  autoRescanBtn.classList.add('active');

  // Reset progress
  rescanProgress.style.transition = 'none';
  rescanProgress.style.width = '0%';
  requestAnimationFrame(() => {
    rescanProgress.style.transition = 'width 1s linear';
  });

  rescanCountdown.textContent = `Next scan in ${autoRescanTotal}s`;

  // Tick every second
  autoRescanTick = setInterval(tickCountdown, 1000);

  // Fire loadData every N seconds
  autoRescanTimer = setInterval(async () => {
    autoRescanSeconds = autoRescanTotal;
    rescanProgress.style.transition = 'none';
    rescanProgress.style.width = '0%';
    requestAnimationFrame(() => {
      rescanProgress.style.transition = 'width 1s linear';
    });
    await loadData();
  }, autoRescanTotal * 1000);
}

autoRescanBtn.addEventListener('click', () => {
  if (autoRescanTimer) {
    stopAutoRescan();
  } else {
    startAutoRescan();
  }
});

// Changing interval while active → restart
autoRescanInterval.addEventListener('change', () => {
  if (autoRescanTimer) {
    stopAutoRescan();
    startAutoRescan();
  }
});

// "Scan now" — immediate rescan + reset timer
rescanNowBtn.addEventListener('click', async () => {
  clearInterval(autoRescanTick);
  clearInterval(autoRescanTimer);
  autoRescanSeconds = autoRescanTotal;
  rescanProgress.style.transition = 'none';
  rescanProgress.style.width = '0%';
  requestAnimationFrame(() => {
    rescanProgress.style.transition = 'width 1s linear';
  });
  rescanCountdown.textContent = `Next scan in ${autoRescanTotal}s`;
  await loadData();
  // Restart timers
  autoRescanTick  = setInterval(tickCountdown, 1000);
  autoRescanTimer = setInterval(async () => {
    autoRescanSeconds = autoRescanTotal;
    rescanProgress.style.transition = 'none';
    rescanProgress.style.width = '0%';
    requestAnimationFrame(() => {
      rescanProgress.style.transition = 'width 1s linear';
    });
    await loadData();
  }, autoRescanTotal * 1000);
});

// ── Theme Toggle ──────────────────────────────────────────────
const themeBtn = document.getElementById('themeToggleBtn');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  themeBtn.title = theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode';
}

// Load saved theme on startup
chrome.storage.local.get('theme', ({ theme }) => {
  applyTheme(theme || 'dark');
});

themeBtn.addEventListener('click', async () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next    = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  await chrome.storage.local.set({ theme: next });
});

// ── Boot ──────────────────────────────────────────────────────
loadData();
