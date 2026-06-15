# 🔍 Privacy Auditor

<div align="center">

[![CI](https://github.com/tridpt/privacy-auditor/actions/workflows/ci.yml/badge.svg)](https://github.com/tridpt/privacy-auditor/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-45_passing-brightgreen?style=flat&logo=nodedotjs&logoColor=white)
![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-MV3-4285F4?style=flat&logo=googlechrome&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=flat)
![Version](https://img.shields.io/badge/Version-1.0.0-purple?style=flat)

**A comprehensive Chrome extension that audits websites in real-time for trackers, fingerprinting, CSP weaknesses, cookie risks, network behavior, and privacy policy violations — all in one powerful popup.**

<br>

<!-- DEMO: record a short screen capture and save it as docs/demo.gif, then
     uncomment the line below. See docs/CAPTURE_GUIDE.md for exact steps.
![Privacy Auditor demo](docs/demo.gif)
-->
<sub>📹 Demo GIF coming soon — see <a href="docs/CAPTURE_GUIDE.md">capture guide</a></sub>

</div>

---

## 💡 Why I built this

Most people have no idea how many companies watch them on an average web page — analytics SDKs, ad pixels, session recorders that replay every mouse move, and fingerprinting scripts that identify you without cookies. The tools that *do* expose this are either oversimplified ("X trackers blocked") or buried in DevTools.

I wanted a single popup that answers, in plain language, **"how is this site treating my data, and how bad is it?"** — a real privacy score, the actual tracker names and what they do, the fingerprinting techniques in use, and the server's security posture (CSP, referrer policy, mixed content). Then one click to block it all.

It started as a way to learn the Manifest V3 extension model deeply, and grew into a full auditing tool.

## 🛠️ Engineering highlights

These are the problems that were interesting to solve, beyond the feature list:

- **MV3 service-worker state loss** — Chrome kills the worker after ~30s idle, wiping in-memory scan data. I mirror state to `chrome.storage.session` with a debounced snapshot and rehydrate on wake-up, so the popup never shows a blank page. Read paths `await` restore to avoid a race on cold start.
- **CSP-bypassing fingerprint hooks** — fingerprinting APIs (Canvas, WebGL, Audio…) must be hooked in the page's own world, but strict CSP blocks injected `<script>`. I use a `world: "MAIN"` content script that patches the prototypes while preserving `this` binding and original behavior, relaying signals to an isolated-world script.
- **Header capture race** — `tabs.onUpdated(loading)` would reset tab data *after* `onHeadersReceived` had already written the CSP, losing it. Headers now live in dedicated caches separate from the reset path.
- **Testable core, untestable shell** — all scoring, tracker matching, CSP grading, and referrer analysis live in pure modules (`lib/scoring.js`, `lib/headers.js`) with **45 unit tests** runnable under Node, while DOM/`chrome.*` code stays in the shell. One source of truth: the service worker loads the same files via `importScripts`, the popup via `<script>`.
- **Production-safe block counter** — the obvious `onRuleMatchedDebug` API is dev-mode only. The lifetime counter detects its absence and falls back to estimating matches inside `onBeforeRequest` so it keeps working in published builds.

## 🧰 Tech & tooling

Vanilla JS (no framework) · Manifest V3 · `declarativeNetRequest` · `webRequest` · Node built-in test runner · GitHub Actions CI (Node 20 + 22) · Gemini API for AI explanations

---

## ✨ Feature Overview

### 🎯 Core Analysis
| Feature | Description |
|---|---|
| **Tracker Detection** | 150+ known tracker domains across 12 categories (Analytics, Ads, Session Recording, Data Brokers, Fingerprinting, Consent, etc.) |
| **Fingerprinting Detection** | Canvas, WebGL, Audio, Font, Battery, Navigator API hooks via Main-world injection |
| **Privacy Score** | Animated 0–100 gauge with color-coded risk levels and score trend arrow |
| **First-party Warning** | Flags known data-collector sites (Facebook, TikTok, YouTube) with fixed penalties |
| **Corporate Family Awareness** | Avoids false positives — won't flag `fbcdn.net` on `facebook.com` |
| **HTTPS / Mixed Content** | Detects HTTP resources loaded on HTTPS pages |

### 🗂️ Tab-by-Tab Analysis

#### 📡 Trackers
- Full list of detected tracker domains grouped by name + category
- Risk level badge per tracker (low / medium / high / critical)
- Request count per tracker
- Smart deduplication — same tracker from multiple domains counted once

#### 🖐️ Fingerprinting
- Detected APIs with call count per technique
- Visual signal strength bar
- "Clean / Low / Medium / High" risk assessment

#### 🛡️ CSP (Content Security Policy)
- Grades **A → D** (grade F reserved for CSPs with both `unsafe-inline` + `unsafe-eval`)
- "No CSP" shown as **D — Not Recommended** (not falsely flagged as Critical)
- Per-directive issue list with severity: critical / high / medium
- Highlights unsafe keywords in red, safe keywords in green
- "Add CSP" guidance card when header is missing

#### 🔐 Permissions
- Audits 12 browser permission categories (geolocation, camera, mic, clipboard, etc.)
- Shows granted vs. requested vs. blocked count
- Powered by content script DOM analysis

#### 📋 Details
- Cookie count, localStorage, sessionStorage, session recorders, external/total requests
- **Referrer Policy Checker** — grade A/B/C/D with per-policy description and fix tips:
  - `no-referrer` / `strict-origin-when-cross-origin` → **A**
  - `origin` → **B**
  - `no-referrer-when-downgrade` / missing → **C**
  - `unsafe-url` → **F**
- Export buttons: JSON report + full HTML report

#### 🍪 Cookies
- Full cookie inspector with search + filter (All / Risky / Session / Persistent)
- Risk scoring per cookie (SameSite, Secure, HttpOnly, expiry, suspicious names)
- Delete individual cookies or "Delete All"
- Risk summary badge (🔴 X critical)

#### 🌊 Network (Waterfall)
- Captures up to 250 requests per tab with relative timestamps
- Stacked distribution bar (JS / CSS / XHR / IMG / Fetch / Font)
- Filter chips: All / 🔍 Trackers / 🌐 External / JS / XHR / IMG
- Per-request waterfall timeline bar proportional to load time
- Tracker rows highlighted in red
- Hover tooltip: full URL + timing + tracker flag

#### 📜 History
- Persistent site history with privacy scores
- Whitelist manager — individual domains and wildcard subdomains
- Clear history button

---

### 🔔 Notification Center
- Bell icon with unread badge count
- Categorized alerts: tracker detected / high-risk fingerprinting / score drop
- Dismissible notifications with timestamps

### 📈 Weekly Stats Dashboard
- 7-day sparkline in popup header (canvas mini-chart)
- Weekly bar chart modal (Trackers / Fingerprint / Score over 7 days)
- Per-day breakdown with trend arrow vs. previous week

### 🤖 Gemini AI Explain
- "Explain this scan with AI" button
- Sends scan results to Gemini API and surfaces human-readable summary

### 🚫 Block All Mode
- One-click block all tracking requests for current tab
- Badge changes to "🔴 BL" when active

### 🔄 Auto-Rescan
- Configurable rescan intervals: 15s / 30s / 1m / 5m
- Countdown progress bar in header
- Stops automatically when popup closes

### ⛶ Export Reports
- **JSON** — machine-readable full scan dump
- **HTML** — styled standalone report with score, tracker table, CSP analysis

---

## 🚀 Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/tridpt/privacy-auditor.git
   ```

2. Open Chrome → `chrome://extensions/`

3. Enable **Developer mode** (toggle top-right)

4. Click **Load unpacked** → select the `privacy-auditor/` folder

5. Navigate to any website, **reload the tab**, then click the extension icon

> ⚠️ **Important:** Always reload the target tab after installing/updating the extension to let the network listener capture all requests from the start.

---

## 🏗️ Architecture

```
privacy-auditor/
├── manifest.json      # MV3 manifest — permissions & content scripts
├── background.js      # Service worker — network & CSP capture, blocking, persistence
├── injected.js        # Main-world script — fingerprint API hooks (bypasses page CSP)
├── content.js         # Isolated-world script — DOM scan, relay fingerprint signals
├── popup.html/js/css  # Popup UI — 8 tabs, all feature engines
├── options.html/js/css# Extension options page
├── lib/
│   ├── scoring.js     # Pure tracker DB + scoring logic (shared, unit-tested)
│   └── headers.js     # Pure CSP + referrer-policy analysis (shared, unit-tested)
├── tests/
│   ├── scoring.test.js # 25 Node unit tests for the scoring engine
│   └── headers.test.js # 20 Node unit tests for header analysis
└── build-zip.mjs      # Web Store packaging script
```

> 📐 For a deep dive into the data flow, execution contexts, and design decisions, see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

> `background.js` loads `lib/scoring.js` via `importScripts()` so the tracker
> database and scoring functions live in a single source of truth that is also
> unit-tested under Node — no duplication between runtime and tests.

### Data Flow

```
Page loads
  ├── injected.js (MAIN world)  → hooks Canvas/WebGL/Audio/Font/Battery APIs
  ├── content.js  (isolated)    → relays fingerprint signals, scans DOM
  └── background.js             → onBeforeRequest   → logs to requestLog[] (≤250)
                                   onHeadersReceived → captures CSP + Referrer-Policy
                                   tabs.onUpdated    → initTabData, badge update
         │
         ▼
   User opens popup
         │
         ▼
   popup.js sends messages to background (GET_DATA, GET_CSP, GET_REFERRER_POLICY,
           GET_REQUEST_LOG, GET_COOKIES, GET_PERMS, GET_WHITELIST …)
         │
         ▼
   Score calculated + all tabs rendered lazily (Network waterfall on tab switch)
```

---

## 📊 Privacy Scoring

| Score | Rating |
|---|---|
| 80–100 | 🟢 Good Privacy |
| 60–79 | 🟡 Fair Privacy |
| 40–59 | 🟠 Poor Privacy |
| 20–39 | 🔴 Bad Privacy |
| 0–19 | ⛔ Very Invasive |

**Score Penalties:**
| Condition | Penalty |
|---|---|
| Each unique tracker | −5 pts (max −35) |
| Session recorder detected | −20 pts |
| High-risk trackers | −2 pts each (max −10) |
| Canvas/WebGL/Audio fingerprint | −5 pts each (max −15) |
| External requests > 100 | −22 pts |
| Known data-collector (FB, TikTok…) | Fixed penalty |
| HTTPS missing | −10 pts |
| Mixed content | −5 pts |

---

## 🔍 Tracker Categories

| Category | Examples |
|---|---|
| **Analytics** | Google Analytics, Amplitude, Mixpanel, Segment, Heap |
| **Advertising** | Facebook Pixel, TikTok Pixel, DoubleClick, Criteo, AdRoll |
| **Session Recording** | Hotjar, FullStory, Microsoft Clarity, Lucky Orange |
| **Tag Management** | Google Tag Manager |
| **A/B Testing** | Optimizely, VWO |
| **Chat / CRM** | Intercom, Drift, Zendesk |
| **Social** | Twitter Widget, LinkedIn Insight, Pinterest Tag |

---

## 🛡️ Fingerprinting Techniques Detected

| Technique | APIs Monitored |
|---|---|
| 🎨 Canvas | `toDataURL()`, `toBlob()`, `getImageData()` |
| 🔺 WebGL | `getContext('webgl')`, `getParameter()`, `getExtension()` |
| 🔊 Audio | `AudioContext`, `OscillatorNode`, `AnalyserNode` |
| 🔤 Font | `document.fonts.check()` |
| 🔋 Battery | `navigator.getBattery()` |
| 🧭 Navigator | Systematic multi-property read pattern |

---

## ⚙️ Permissions

| Permission | Purpose |
|---|---|
| `webRequest` | Monitor outgoing requests (tracker + network waterfall) |
| `cookies` | Accurate cookie reading including HttpOnly |
| `tabs` | Detect current tab URL |
| `scripting` | Inject main-world fingerprint hooks |
| `storage` | Persist history, whitelist, notification state |
| `declarativeNetRequest` | Block tracking requests via rule engine |
| `notifications` | Browser-level alerts for high-risk detections |
| `contextMenus` | Right-click "Audit this page" shortcut |

---

## 🧠 Technical Notes

- **Manifest V3** compatible service worker architecture
- **Single source of truth** — all pure scoring/tracker logic lives in `lib/scoring.js`, loaded into the service worker via `importScripts()` and unit-tested under Node. No `chrome.*` calls in that file
- **State survives worker restarts** — MV3 kills the service worker after ~30s idle, wiping in-memory `tabData`. A debounced snapshot is mirrored to `chrome.storage.session` (in-memory, cleared on browser close) and restored on wake-up, so scan data is not lost between popup opens
- **Production-safe block counter** — `onRuleMatchedDebug` only fires for unpacked dev builds. When unavailable (Web Store builds), the lifetime-blocked counter falls back to a manual estimate inside `onBeforeRequest`
- **CSP bypass** — `injected.js` uses `world: "MAIN"` in the manifest, never injected via `innerHTML`
- **Timing-safe header capture** — CSP and Referrer-Policy stored in dedicated `cspCache` / `refPolCache` Maps to avoid race condition where `tabs.onUpdated(loading)` would reset `tabData` after `onHeadersReceived` already wrote the headers
- **Memory-safe request log** — Network waterfall entries capped at 250 per tab
- **Lazy tab rendering** — Network waterfall fetched only on first tab switch via `tabSwitch` custom event
- **Double `requestAnimationFrame`** — Used before checking scroll dimensions to ensure browser has completed layout paint

---

## 🧪 Testing

Pure scoring logic in `lib/scoring.js` is covered by unit tests using Node's
built-in test runner (no dependencies to install):

```bash
npm test
```

Tests live in `tests/scoring.test.js` and cover `calculateScore`,
`matchTracker`, `isSameFamily`, `getFirstPartyPenalty`, `scoreToColor`, and the
integrity of the tracker database.

---

## 📄 License

MIT License — see [LICENSE](LICENSE)

---

<div align="center">
  Built with ❤️ as a portfolio project · Feel free to fork and improve!
</div>
