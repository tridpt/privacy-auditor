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

// ── Tracker DB Browser ───────────────────────────────────────
let allTrackers = [];
let dbRiskFilter = 'all';
let dbCatFilter  = '';

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

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
  // Load AI settings
  const { geminiApiKey, aiLanguage, geminiModel } =
    await chrome.storage.local.get(['geminiApiKey', 'aiLanguage', 'geminiModel']);
  if (geminiApiKey) geminiKeyInput.value = geminiApiKey;
  if (aiLanguage)   document.getElementById('aiLanguage').value = aiLanguage;
  if (geminiModel)  document.getElementById('geminiModel').value = geminiModel;
})();
