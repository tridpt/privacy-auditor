# Changelog

All notable changes to Privacy Auditor are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Pure logic modules `lib/scoring.js` and `lib/headers.js`, shared by the
  service worker (`importScripts`), the popup (`<script>`), and Node tests
  (`require`) — a single source of truth.
- 45 unit tests (`npm test`) covering scoring, tracker matching, corporate
  family detection, CSP grading, and referrer-policy analysis. No dependencies
  required (Node built-in test runner).
- GitHub Actions CI running the test suite and a JS syntax check on Node 20 & 22.
- `chrome.storage.session` snapshot/restore so scan data survives MV3 service
  worker restarts instead of showing a blank popup.
- Production-safe lifetime block counter: falls back to estimating matches in
  `onBeforeRequest` when `onRuleMatchedDebug` (dev-only) is unavailable.
- Expanded tracker database to 120+ services across 155 domains and 12
  categories, including modern privacy-washed analytics, additional ad networks,
  CDPs, and a new Consent Management category.
- `PRIVACY.md` privacy policy, `LICENSE` (MIT), `docs/ARCHITECTURE.md` technical
  documentation, and `docs/CAPTURE_GUIDE.md`.
- `build-zip.mjs` (`npm run build`) — packages a Web Store-ready zip containing
  only runtime files.

### Fixed
- AI analysis was completely broken: `GEMINI_BASE` was referenced but never
  defined. Defined the correct base URL.
- Default Gemini model `gemini-2.0-flash-lite` was retired by Google on
  2026-06-01. Switched to the live `gemini-2.5` family and added an alias map so
  users with a retired model saved in storage are transparently upgraded.
- `buildPrompt` read `f.technique` from a Set of API strings, producing
  `undefined` in the AI prompt; now handles string and object shapes.
- Hardened `t.risk` access in `buildPrompt` with optional chaining.

## [1.0.0]

Initial feature-complete release.

### Added
- Real-time tracker detection with risk levels and per-domain request counts.
- Fingerprinting detection (Canvas, WebGL, Audio, Font, Battery, Navigator) via
  a `world: "MAIN"` content script that bypasses page CSP.
- Animated 0–100 privacy score with color-coded badge and score-trend arrow.
- Eight analysis tabs: Trackers, Fingerprinting, CSP, Permissions, Details,
  Cookies, Network waterfall, History.
- CSP grading (A–F) with per-directive issue breakdown.
- Referrer-Policy checker with grade and fix tips.
- Cookie inspector with risk scoring and delete actions.
- Network waterfall (up to 250 requests/tab) with filters and timing bars.
- Per-domain blocking, Block All, and global protection via
  `declarativeNetRequest`.
- Whitelist manager, desktop notifications, weekly stats, auto-rescan.
- Gemini AI "explain this scan" feature.
- JSON and HTML report export.

[Unreleased]: https://github.com/tridpt/privacy-auditor/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/tridpt/privacy-auditor/releases/tag/v1.0.0
