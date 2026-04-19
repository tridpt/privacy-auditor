# 🔍 Privacy Auditor

<div align="center">

![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Version](https://img.shields.io/badge/Version-1.0.0-purple?style=for-the-badge)

**A comprehensive Chrome extension that audits websites in real-time for trackers, fingerprinting, CSP weaknesses, cookie risks, network behavior, and privacy policy violations — all in one powerful popup.**

</div>

---

## ✨ Feature Overview

### 🎯 Core Analysis
| Feature | Description |
|---|---|
| **Tracker Detection** | 50+ known trackers across 8 categories (Analytics, Ads, Session Recording, Social, etc.) |
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
├── background.js      # Service worker — tracker DB, network & CSP capture, scoring
├── injected.js        # Main-world script — fingerprint API hooks (bypasses page CSP)
├── content.js         # Isolated-world script — DOM scan, relay fingerprint signals
├── popup.html         # Popup UI structure (8 tabs)
├── popup.js           # Popup logic — rendering, tab navigation, all feature engines
├── popup.css          # Premium dark UI styles
└── options.html/css   # Extension options page
```

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
- **CSP bypass** — `injected.js` uses `world: "MAIN"` in the manifest, never injected via `innerHTML`
- **Timing-safe header capture** — CSP and Referrer-Policy stored in dedicated `cspCache` / `refPolCache` Maps to avoid race condition where `tabs.onUpdated(loading)` would reset `tabData` after `onHeadersReceived` already wrote the headers
- **Memory-safe request log** — Network waterfall entries capped at 250 per tab
- **Lazy tab rendering** — Network waterfall fetched only on first tab switch via `tabSwitch` custom event
- **Double `requestAnimationFrame`** — Used before checking scroll dimensions to ensure browser has completed layout paint

---

## 📄 License

MIT License — see [LICENSE](LICENSE)

---

<div align="center">
  Built with ❤️ as a portfolio project · Feel free to fork and improve!
</div>
