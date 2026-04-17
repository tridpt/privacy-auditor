// ── Helpers ───────────────────────────────────────────────────
function send(type, payload = {}) {
  return new Promise(resolve =>
    chrome.runtime.sendMessage({ type, ...payload }, r => resolve(r))
  );
}

function showSaved(msg = '✓ Saved') {
  const el = document.getElementById('saveStatus');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Sidebar navigation ────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    const target = document.getElementById(link.dataset.sec);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// ── Notifications section ────────────────────────────────────
const notifToggle    = document.getElementById('notifEnabled');
const thresholdSlider = document.getElementById('thresholdSlider');
const thresholdVal   = document.getElementById('thresholdVal');
const thresholdFill  = document.getElementById('thresholdFill');
const thresholdRow   = document.getElementById('thresholdRow');

// Load current settings
async function loadSettings() {
  const s = await send('GET_SETTINGS');
  notifToggle.checked       = s.notifEnabled !== false;
  thresholdSlider.value     = s.notifyThreshold ?? 45;
  thresholdVal.textContent  = thresholdSlider.value;
  updateThresholdFill();
  thresholdRow.style.opacity = notifToggle.checked ? '1' : '.4';
}

function updateThresholdFill() {
  const pct = ((thresholdSlider.value - 10) / 70) * 100;
  thresholdFill.style.width = pct + '%';
}

notifToggle.addEventListener('change', async () => {
  thresholdRow.style.opacity = notifToggle.checked ? '1' : '.4';
  await send('SAVE_SETTINGS', { notifEnabled: notifToggle.checked });
  showSaved();
});

thresholdSlider.addEventListener('input', () => {
  thresholdVal.textContent = thresholdSlider.value;
  updateThresholdFill();
});
thresholdSlider.addEventListener('change', async () => {
  await send('SAVE_SETTINGS', { notifyThreshold: +thresholdSlider.value });
  showSaved();
});

// ── Whitelist section ────────────────────────────────────────
const wlInput  = document.getElementById('wlInput');
const wlAddBtn = document.getElementById('wlAddBtn');
const wlList   = document.getElementById('wlList');
const wlEmpty  = document.getElementById('wlEmpty');

async function loadWhitelist() {
  const { whitelist = [] } = await send('GET_WHITELIST');
  renderDomainList(wlList, wlEmpty, whitelist, removeWL);
}

async function removeWL(host) {
  await send('REMOVE_FROM_WHITELIST', { hostname: host });
  await loadWhitelist();
  showSaved('✓ Removed from whitelist');
}

wlAddBtn.addEventListener('click', async () => {
  const host = wlInput.value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
  if (!host) return;
  await send('ADD_TO_WHITELIST', { hostname: host });
  wlInput.value = '';
  await loadWhitelist();
  showSaved('✓ Added to whitelist');
});
wlInput.addEventListener('keydown', e => e.key === 'Enter' && wlAddBtn.click());

// ── Custom Block Rules section ───────────────────────────────
const crInput  = document.getElementById('crInput');
const crAddBtn = document.getElementById('crAddBtn');
const crList   = document.getElementById('crList');
const crEmpty  = document.getElementById('crEmpty');

async function loadCustomRules() {
  const { rules = [] } = await send('GET_CUSTOM_RULES');
  renderDomainList(crList, crEmpty, rules, removeCR);
}

async function removeCR(domain) {
  await send('REMOVE_CUSTOM_RULE', { domain });
  await loadCustomRules();
  showSaved('✓ Rule removed');
}

crAddBtn.addEventListener('click', async () => {
  const domain = crInput.value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
  if (!domain) return;
  crAddBtn.disabled = true;
  crAddBtn.textContent = '⏳';
  const resp = await send('ADD_CUSTOM_RULE', { domain });
  crAddBtn.disabled = false;
  crAddBtn.textContent = 'Block Domain';
  if (resp?.ok === false) {
    alert('Failed to add rule: ' + (resp.error || 'Unknown error'));
    return;
  }
  crInput.value = '';
  await loadCustomRules();
  showSaved('✓ Domain blocked');
});
crInput.addEventListener('keydown', e => e.key === 'Enter' && crAddBtn.click());

// ── Shared domain list renderer ──────────────────────────────
function renderDomainList(listEl, emptyEl, items, removeFn) {
  if (!items.length) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = items.map(item => `
    <div class="domain-item">
      <span class="domain-name">${esc(item)}</span>
      <button class="remove-btn" data-item="${esc(item)}">Remove</button>
    </div>`).join('');

  listEl.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => removeFn(btn.dataset.item));
  });
}

// ── Advanced section ─────────────────────────────────────────
document.getElementById('clearHistBtn').addEventListener('click', async () => {
  if (!confirm('Clear all site history? This cannot be undone.')) return;
  await chrome.storage.local.remove('siteHistory');
  showSaved('✓ History cleared');
});

document.getElementById('resetAllBtn').addEventListener('click', async () => {
  if (!confirm('Reset EVERYTHING? All settings, whitelist, custom rules, and history will be deleted.')) return;
  await chrome.storage.local.clear();
  showSaved('✓ All data reset');
  setTimeout(() => location.reload(), 800);
});

// ── AI Analysis section ──────────────────────────────────────
const geminiKeyInput = document.getElementById('geminiApiKey');
const apiKeyStatus   = document.getElementById('apiKeyStatus');

document.getElementById('toggleKeyVisibility').addEventListener('click', () => {
  geminiKeyInput.type = geminiKeyInput.type === 'password' ? 'text' : 'password';
});

document.getElementById('saveApiKeyBtn').addEventListener('click', async () => {
  const key = geminiKeyInput.value.trim();
  if (!key) { apiKeyStatus.textContent = '✗ Enter an API key first'; apiKeyStatus.className = 'api-key-status err'; return; }
  await chrome.storage.local.set({ geminiApiKey: key });
  apiKeyStatus.textContent = '✓ Saved';
  apiKeyStatus.className = 'api-key-status ok';
  setTimeout(() => { apiKeyStatus.textContent = ''; apiKeyStatus.className = 'api-key-status'; }, 3000);
});

document.getElementById('aiLanguage').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ aiLanguage: e.target.value });
  showSaved();
});

document.getElementById('geminiModel').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ geminiModel: e.target.value });
  showSaved();
});

// ── Weekly Stats Dashboard ────────────────────────────────────
async function loadWeeklyStats() {
  const { siteHistory = [] } = await chrome.storage.local.get('siteHistory');
  const now     = Date.now();
  const weekAgo = now - 7 * 86400000;
  const week    = siteHistory.filter(e => e.timestamp >= weekAgo);

  // ── Summary cards ────────────────────────────────────────
  document.getElementById('wsSitesVisited').textContent  = week.length;
  document.getElementById('wsTotalTrackers').textContent =
    week.reduce((s, e) => s + (e.trackerCount ?? 0), 0);

  if (week.length) {
    const avg = Math.round(week.reduce((s, e) => s + e.score, 0) / week.length);
    const avgEl = document.getElementById('wsAvgScore');
    avgEl.textContent = avg;
    avgEl.style.color = avg >= 70 ? '#86efac' : avg >= 45 ? '#fde68a' : '#fca5a5';

    const worst = [...week].sort((a, b) => a.score - b.score)[0];
    document.getElementById('wsWorstSite').textContent =
      `${worst.hostname}\n(${worst.score}/100)`;
  }

  // ── Last-7-days buckets (one per calendar day) ────────────
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    days.push({
      label: d.toLocaleDateString('en-US', { weekday: 'short' }),
      date:  d.toDateString(),
      scores: [],
      trackers: 0,
    });
  }
  week.forEach(e => {
    const dateStr = new Date(e.timestamp).toDateString();
    const bucket  = days.find(d => d.date === dateStr);
    if (bucket) {
      bucket.scores.push(e.score);
      bucket.trackers += e.trackerCount ?? 0;
    }
  });
  const avgScores   = days.map(d => d.scores.length ? Math.round(d.scores.reduce((a,b)=>a+b,0)/d.scores.length) : null);
  const trackerCounts = days.map(d => d.trackers);
  const labels      = days.map(d => d.label);

  drawScoreChart(labels, avgScores);
  drawTrackerChart(labels, trackerCounts);
  renderTopSites(week);
}

// ── Canvas helpers ────────────────────────────────────────────
function scoreToColor(s) {
  if (s === null) return '#64748b';
  if (s >= 80)   return '#22c55e';
  if (s >= 60)   return '#eab308';
  if (s >= 40)   return '#f97316';
  return '#ef4444';
}

function drawScoreChart(labels, data) {
  const canvas = document.getElementById('scoreChart');
  const empty  = document.getElementById('scoreChartEmpty');
  const hasData = data.some(v => v !== null);

  if (!hasData) { canvas.style.display='none'; empty.classList.remove('hidden'); return; }
  canvas.style.display=''; empty.classList.add('hidden');

  const W = canvas.offsetWidth || 600;
  const H = 160;
  canvas.width  = W * devicePixelRatio;
  canvas.height = H * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const pad = { t:16, r:16, b:32, l:36 };
  const cw  = W - pad.l - pad.r;
  const ch  = H - pad.t - pad.b;
  const n   = labels.length;
  const xStep = cw / (n - 1);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth   = 1;
  [0, 25, 50, 75, 100].forEach(val => {
    const y = pad.t + ch - (val / 100) * ch;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cw, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.font      = `${10 * devicePixelRatio / devicePixelRatio}px Inter, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(val, pad.l - 6, y + 4);
  });

  // Build points (skip null)
  const pts = data.map((v, i) => v === null ? null : {
    x: pad.l + i * xStep,
    y: pad.t + ch - (v / 100) * ch,
    v,
  });

  // Gradient fill under line
  const filled = pts.filter(Boolean);
  if (filled.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(filled[0].x, filled[0].y);
    filled.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(filled.at(-1).x, pad.t + ch);
    ctx.lineTo(filled[0].x, pad.t + ch);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
    grad.addColorStop(0,   'rgba(99,102,241,.35)');
    grad.addColorStop(1,   'rgba(99,102,241,.02)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Line segments (coloured by score)
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (!a || !b) continue;
    const grad = ctx.createLinearGradient(a.x, 0, b.x, 0);
    grad.addColorStop(0, scoreToColor(a.v));
    grad.addColorStop(1, scoreToColor(b.v));
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  // Data points
  pts.forEach(p => {
    if (!p) return;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle   = scoreToColor(p.v);
    ctx.strokeStyle = '#0d1424';
    ctx.lineWidth   = 2;
    ctx.fill(); ctx.stroke();
  });

  // X-axis labels
  labels.forEach((lbl, i) => {
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.font      = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(lbl, pad.l + i * xStep, H - 6);
  });
}

function drawTrackerChart(labels, counts) {
  const canvas = document.getElementById('trackerChart');
  const empty  = document.getElementById('trackerChartEmpty');
  const hasData = counts.some(v => v > 0);

  if (!hasData) { canvas.style.display='none'; empty.classList.remove('hidden'); return; }
  canvas.style.display=''; empty.classList.add('hidden');

  const W = canvas.offsetWidth || 600;
  const H = 160;
  canvas.width  = W * devicePixelRatio;
  canvas.height = H * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const pad  = { t:16, r:16, b:32, l:36 };
  const cw   = W - pad.l - pad.r;
  const ch   = H - pad.t - pad.b;
  const n    = labels.length;
  const max  = Math.max(...counts, 1);
  const bw   = (cw / n) * 0.55;
  const gap  = (cw / n) * 0.45;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth   = 1;
  [0, .25, .5, .75, 1].forEach(f => {
    const y = pad.t + ch - f * ch;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cw, y); ctx.stroke();
    const val = Math.round(f * max);
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.font      = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(val, pad.l - 6, y + 4);
  });

  // Bars
  counts.forEach((v, i) => {
    const x   = pad.l + i * (cw / n) + gap / 2;
    const h   = (v / max) * ch;
    const y   = pad.t + ch - h;
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, 'rgba(239,68,68,.8)');
    grad.addColorStop(1, 'rgba(239,68,68,.25)');
    ctx.fillStyle   = grad;
    ctx.strokeStyle = 'rgba(239,68,68,.5)';
    ctx.lineWidth   = 1;
    const r = Math.min(4, bw / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + bw, y, x + bw, y + h, r);
    ctx.arcTo(x + bw, y + h, x, y + h, 0);
    ctx.arcTo(x, y + h, x, y, 0);
    ctx.arcTo(x, y, x + bw, y, r);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Value labels on bars
    if (v > 0) {
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.font      = '9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(v, x + bw / 2, y - 4);
    }

    // X labels
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.font      = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + bw / 2, H - 6);
  });
}

function renderTopSites(week) {
  const topEl   = document.getElementById('wsTopSites');
  const emptyEl = document.getElementById('wsTopSitesEmpty');

  if (!week.length) { topEl.innerHTML=''; emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');

  // Unique sites — keep worst score per hostname
  const map = new Map();
  week.forEach(e => {
    if (!map.has(e.hostname) || e.score < map.get(e.hostname).score) map.set(e.hostname, e);
  });
  const top = [...map.values()].sort((a,b) => a.score - b.score).slice(0, 7);

  topEl.innerHTML = top.map((e, i) => {
    const color = scoreToColor(e.score);
    const barW  = (1 - e.score / 100) * 100; // wider bar = worse
    return `<div class="ws-site-row">
      <span class="ws-site-rank">#${i + 1}</span>
      <span class="ws-site-name">${e.hostname}</span>
      <div class="ws-site-bar-wrap">
        <div class="ws-site-bar" style="width:${barW}%;background:${color}"></div>
      </div>
      <span class="ws-site-score" style="color:${color}">${e.score}</span>
      <span class="ws-site-trackers">${e.trackerCount ?? 0} tracker${(e.trackerCount??0)!==1?'s':''}</span>
    </div>`;
  }).join('');
}

// ── Tracker DB Browser ───────────────────────────────────────
let allTrackers = [];
let dbRiskFilter = 'all';
let dbCatFilter  = '';

function renderTrackerDB() {
  const q      = (document.getElementById('dbSearch')?.value ?? '').toLowerCase();
  const list   = document.getElementById('dbList');
  const empty  = document.getElementById('dbEmpty');
  const stats  = document.getElementById('dbStats');

  let filtered = allTrackers;
  if (dbRiskFilter !== 'all') filtered = filtered.filter(t => t.risk === dbRiskFilter);
  if (dbCatFilter)            filtered = filtered.filter(t => t.category === dbCatFilter);
  if (q) filtered = filtered.filter(t =>
    t.name.toLowerCase().includes(q) || t.domain.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
  );

  // Stats chips
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  filtered.forEach(t => { if (counts[t.risk] !== undefined) counts[t.risk]++; });
  stats.innerHTML = [
    `<span class="db-stat-chip">🔍 ${filtered.length} shown</span>`,
    counts.critical ? `<span class="db-stat-chip" style="color:#fca5a5">⛔ ${counts.critical} Critical</span>` : '',
    counts.high     ? `<span class="db-stat-chip" style="color:#fca5a5">🔴 ${counts.high} High</span>` : '',
    counts.medium   ? `<span class="db-stat-chip" style="color:#fde68a">🟡 ${counts.medium} Medium</span>` : '',
    counts.low      ? `<span class="db-stat-chip" style="color:#86efac">🟢 ${counts.low} Low</span>` : '',
  ].join('');

  if (!filtered.length) {
    list.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = filtered.map(t => `
    <div class="db-entry${t.desc ? ' has-desc' : ''}" data-desc="${esc(t.desc || '')}">
      <div class="db-risk-dot dot-${esc(t.risk)}"></div>
      <div class="db-entry-main">
        <div class="db-entry-name">${esc(t.name)}</div>
        <div class="db-entry-domain">${esc(t.domain)}${t.desc ? `<span class="db-desc-text"> — ${esc(t.desc)}</span>` : ''}</div>
      </div>
      <span class="db-cat-badge">${esc(t.category)}</span>
      <span class="db-risk-badge risk-${esc(t.risk)}">${esc(t.risk)}</span>
    </div>`).join('');
}

async function loadTrackerDB() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_TRACKER_DB' });
  allTrackers = resp?.trackers ?? [];

  // Sort: critical → high → medium → low, then by name
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  allTrackers.sort((a, b) => (order[a.risk] ?? 4) - (order[b.risk] ?? 4) || a.name.localeCompare(b.name));

  document.getElementById('dbTotal').textContent = allTrackers.length;

  // Populate category dropdown
  const cats = [...new Set(allTrackers.map(t => t.category))].sort();
  const sel  = document.getElementById('dbCategoryFilter');
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    sel.appendChild(opt);
  });

  renderTrackerDB();
}

document.getElementById('dbSearch')?.addEventListener('input', renderTrackerDB);

document.getElementById('dbCategoryFilter')?.addEventListener('change', (e) => {
  dbCatFilter = e.target.value;
  renderTrackerDB();
});

document.querySelectorAll('.db-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.db-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    dbRiskFilter = btn.dataset.filter;
    renderTrackerDB();
  });
});

// ── Init ──────────────────────────────────────────────────────
(async () => {
  await loadSettings();
  await loadWhitelist();
  await loadCustomRules();
  await loadTrackerDB();
  await loadWeeklyStats();
  // Load AI settings
  const { geminiApiKey, aiLanguage, geminiModel } =
    await chrome.storage.local.get(['geminiApiKey', 'aiLanguage', 'geminiModel']);
  if (geminiApiKey) geminiKeyInput.value = geminiApiKey;
  if (aiLanguage)   document.getElementById('aiLanguage').value = aiLanguage;
  if (geminiModel)  document.getElementById('geminiModel').value = geminiModel;
})();
