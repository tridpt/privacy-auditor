# 🔍 Privacy Auditor

<div align="center">

![Privacy Auditor](https://img.shields.io/badge/Chrome_Extension-MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Version](https://img.shields.io/badge/Version-1.0.0-purple?style=for-the-badge)

**A powerful Chrome extension that analyzes websites in real-time for trackers, fingerprinting attempts, and privacy risks.**

</div>

---

## ✨ Features

- 🎯 **Tracker Detection** — 50+ known trackers (Google, Facebook, TikTok, Hotjar, Criteo, and more)
- 🔺 **Fingerprinting Detection** — Canvas, WebGL, Audio, Font, Battery, Navigator API hooks
- 📊 **Privacy Score** — 0–100 animated gauge with color-coded risk levels
- 🍪 **Accurate Cookie Count** — Uses `chrome.cookies` API to read HttpOnly cookies too
- 🌐 **Network Monitoring** — Real-time external request tracking
- 🏢 **Corporate Family Awareness** — Won't falsely flag CDNs when you're on their own site (e.g. `fbcdn.net` on `facebook.com`)
- ⚠️ **First-party Warning** — Flags sites like Facebook, TikTok, YouTube as data collectors even without third-party trackers
- 🌙 **Premium Dark UI** — Glassmorphism design with smooth animations

---

## 📸 Preview

> Paste screenshot here

---

## 🚀 Installation (Developer Mode)

1. Clone this repo:
   ```bash
   git clone https://github.com/tridpt/privacy-auditor.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable **Developer mode** (top right toggle)

4. Click **"Load unpacked"** → select the `privacy-auditor` folder

5. Click the extension icon on any website to audit it!

---

## 🏗️ Architecture

```
privacy-auditor/
├── manifest.json     # MV3 manifest — permissions & content scripts
├── background.js     # Service worker — tracker DB, network monitoring, scoring
├── injected.js       # Main-world hooks — fingerprint detection (bypasses page CSP)
├── content.js        # Isolated-world script — DOM scan, relay fingerprint signals
├── popup.html        # Popup UI structure
├── popup.js          # Popup logic — rendering, animations, tab switching
└── popup.css         # Dark premium styling
```

### How it works

```
Page loads
  ├── injected.js (MAIN world) → hooks Canvas/WebGL/Audio/Font APIs
  ├── content.js (isolated)   → relays fingerprint signals + scans DOM
  └── background.js           → monitors network requests via webRequest API
           │
           ▼
    User opens popup
           │
           ▼
    popup.js requests data from background
           │
           ▼
    Score calculated + UI rendered
```

---

## 📊 Privacy Scoring

| Score | Rating |
|-------|--------|
| 80–100 | 🟢 Good Privacy |
| 60–79  | 🟡 Fair Privacy |
| 40–59  | 🟠 Poor Privacy |
| 20–39  | 🔴 Bad Privacy |
| 0–19   | ⛔ Very Invasive |

**Penalties:**
- Each tracker: −5 pts (max −35)
- Session recorder (Hotjar, Clarity, etc.): −20
- High-risk trackers: −2 each (max −10)
- Canvas/WebGL/Audio fingerprinting: −5 each (max −15)
- External requests > 100: −22
- Known data-collector (Facebook, TikTok, etc.): fixed penalty

---

## 🔍 Detected Tracker Categories

| Category | Examples |
|----------|---------|
| **Analytics** | Google Analytics, Amplitude, Mixpanel, Segment |
| **Advertising** | Facebook Pixel, TikTok Pixel, DoubleClick, Criteo |
| **Session Recording** | Hotjar, FullStory, Microsoft Clarity, Lucky Orange |
| **Tag Managers** | Google Tag Manager |
| **A/B Testing** | Optimizely, VWO |
| **Chat / CRM** | Intercom, Drift, Zendesk |
| **Social** | Twitter Widget, LinkedIn Insight |

---

## 🛡️ Fingerprinting Techniques Detected

- 🎨 **Canvas** — `toDataURL()`, `toBlob()`, `getImageData()`
- 🔺 **WebGL** — `getContext('webgl')`, `getParameter()`
- 🔊 **Audio** — `AudioContext` oscillator & analyser nodes
- 🔤 **Font** — `document.fonts.check()`
- 🔋 **Battery** — `navigator.getBattery()`
- 🧭 **Navigator** — systematic multi-property access pattern

---

## ⚙️ Permissions Used

| Permission | Why |
|-----------|-----|
| `webRequest` | Monitor outgoing network requests |
| `cookies` | Accurate cookie counting (including HttpOnly) |
| `tabs` | Get current tab URL |
| `scripting` | Inject main-world hooks |
| `storage` | Store tab privacy data |

---

## 🧠 Technical Notes

- **Chrome MV3** compatible
- **Bypasses page CSP** — `injected.js` runs via manifest `world: "MAIN"`, not as inline script
- **Corporate family detection** — prevents false positives (e.g. fbcdn.net on facebook.com)
- **async cookie reading** — `chrome.cookies.getAll()` for accurate counts

---

## 📄 License

MIT License — see [LICENSE](LICENSE)

---

<div align="center">
  Built with ❤️ as a portfolio project · Feel free to fork and improve!
</div>
