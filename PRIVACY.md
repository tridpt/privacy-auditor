# Privacy Policy — Privacy Auditor

_Last updated: 15 June 2026_

Privacy Auditor is a Chrome extension that analyzes websites for trackers,
fingerprinting, and other privacy risks. This policy explains exactly what the
extension does with data. The short version: **everything stays on your device.
Privacy Auditor has no backend server and we never receive your data.**

## What the extension accesses

To perform its analysis, the extension reads the following **locally, in your
browser only**:

- **Network requests** of the pages you visit (via the `webRequest` API) — used
  to detect tracker domains and build the request waterfall.
- **Page content signals** — script tags, cookie counts, and storage key counts,
  read by the content script to assess the page.
- **Cookies** of the active site (via the `cookies` API) — used to count and
  risk-score cookies. Cookie values are never transmitted anywhere.
- **The active tab's URL** — used to identify the site being analyzed.
- **Response headers** (CSP, Referrer-Policy) of the main page — used to grade
  the site's security posture.

## What is stored, and where

All data is stored **on your device only**, using Chrome's local and session
storage:

- Site history (hostnames + privacy scores), whitelist, blocked-domain list,
  notification log, weekly statistics, and your settings.
- A temporary in-memory snapshot of the current scan (`chrome.storage.session`),
  cleared when you close the browser.

We do **not** operate any server, analytics, or data-collection endpoint. The
extension authors cannot see your browsing data.

## Optional: Gemini AI analysis

The "Analyze with Gemini AI" feature is **opt-in** and only works if you provide
your own Google Gemini API key. When you click it:

- The current scan summary (site hostname, privacy score, detected tracker
  names, fingerprinting techniques, request counts) is sent **directly from your
  browser to Google's Gemini API** using your key.
- Your API key is stored locally and only used for these requests.
- This data is handled under
  [Google's Privacy Policy](https://policies.google.com/privacy) and the
  [Gemini API terms](https://ai.google.dev/gemini-api/terms). We are not an
  intermediary — the request goes straight to Google.

If you never set an API key or never click the button, no data leaves your
device.

## What we do NOT do

- We do not sell, share, or transmit your browsing data to the authors or any
  third party (other than the optional, user-initiated Gemini request above).
- We do not use tracking, analytics, or advertising inside the extension.
- We do not collect personally identifiable information.

## Permissions justification

| Permission | Why it is needed |
|---|---|
| `webRequest` | Detect tracker requests and build the network waterfall |
| `cookies` | Count and risk-score cookies (including HttpOnly) |
| `tabs` / `activeTab` | Identify the URL of the page being analyzed |
| `scripting` | Inject the main-world fingerprint-detection hooks |
| `storage` | Save history, settings, whitelist locally |
| `declarativeNetRequest` | Block tracker requests when you enable blocking |
| `notifications` | Show local alerts for high-risk pages |
| `contextMenus` | Provide right-click shortcuts |
| `host_permissions: <all_urls>` | Analysis must work on any site you visit |

## Contact

For questions about this policy, open an issue at
<https://github.com/tridpt/privacy-auditor>.
