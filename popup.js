// ============================================================
//  Privacy Auditor – Popup Logic
// ============================================================

'use strict';

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

// ── Gauge animation ──────────────────────────────────────────
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
function renderTrackers(trackers) {
  const list  = document.getElementById('trackerList');
  const empty = document.getElementById('noTrackers');

  if (!trackers?.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...trackers].sort((a, b) => (order[a.risk] ?? 4) - (order[b.risk] ?? 4));

  list.innerHTML = sorted.map((t, i) => `
    <div class="tracker-item risk-${esc(t.risk)}" style="animation-delay:${i * 30}ms">
      <div class="tracker-info">
        <div class="tracker-name">${esc(t.name)}</div>
        <div class="tracker-meta">${esc(t.category)} &bull; ${esc(t.domain)}</div>
      </div>
      <span class="badge badge-${esc(t.risk)}">${esc(t.risk)}</span>
    </div>`).join('');
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

// ── Update stats bar ─────────────────────────────────────────
function updateStats(data) {
  const trackerCount = data.trackers?.length ?? 0;
  const fpCount      = data.fingerprinting?.length ?? 0;
  const cookieCount  = data.cookies?.count ?? 0;
  const extReqs      = data.requests?.external ?? 0;

  document.getElementById('statTrackers').textContent = trackerCount;
  document.getElementById('statFP').textContent       = fpCount;
  document.getElementById('statCookies').textContent  = cookieCount;
  document.getElementById('statExtReq').textContent   = extReqs;

  colorCard('cardTrackers', trackerCount, { dangerAt: 6, warnAt: 2, okAt: 0 });
  colorCard('cardFP',       fpCount,      { dangerAt: 1 });
  colorCard('cardCookies',  cookieCount,  { dangerAt: 25, warnAt: 10, okAt: 3 });
  colorCard('cardExtReq',   extReqs,      { dangerAt: 40, warnAt: 15 });
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
  });
});

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
    try {
      const hostname = new URL(tab.url).hostname;
      document.getElementById('siteHostname').textContent = hostname;
    } catch (_) {}

    const grade = getGrade(data.score);
    const gradeEl = document.getElementById('scoreGrade');
    gradeEl.textContent = grade.label;
    gradeEl.style.color = grade.color;

    // First-party data collector warning
    const banner = document.getElementById('firstPartyBanner');
    if (data.firstPartyNote) {
      banner.textContent = '⚠️ ' + data.firstPartyNote;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }

    updateStats(data);
    renderTrackers(data.trackers);
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

// ── Footer clock ─────────────────────────────────────────────
document.getElementById('footerTime').textContent = new Date().toLocaleTimeString();

// ── Boot ──────────────────────────────────────────────────────
loadData();
