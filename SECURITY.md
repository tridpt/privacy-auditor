# Security Policy

## Reporting a vulnerability

Privacy Auditor is a security and privacy tool, so security reports are taken
seriously.

If you discover a vulnerability — for example a way the extension leaks the data
it inspects, a flaw in the blocking rules, or an issue in how fingerprint hooks
are injected — please report it privately rather than opening a public issue.

- Use GitHub's **[Report a vulnerability](https://github.com/tridpt/privacy-auditor/security/advisories/new)**
  (Security tab → Advisories) to open a private advisory.

Please include:

- A description of the issue and its impact.
- Steps to reproduce.
- The Chrome version and extension version (`manifest.json` → `version`).

## Scope

In scope:

- The extension code in this repository (service worker, content scripts, popup,
  options, `lib/`).
- The blocking and detection logic.

Out of scope:

- Vulnerabilities in third-party sites being audited.
- The Gemini API or any external service the user opts into.
- Issues that require a already-compromised browser or OS.

## Data handling

This extension performs all analysis locally and does not send browsing data to
any server, except the optional "Analyze with AI" feature, which sends scan
results to Google's Gemini API only when the user explicitly clicks it and has
configured their own API key. See [PRIVACY.md](PRIVACY.md) for details.

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅        |
