# Contributing to Privacy Auditor

Thanks for your interest. This is a portfolio project, but contributions and
suggestions are welcome.

## Getting started

1. Fork and clone the repo.
2. Load the extension locally:
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - **Load unpacked** → select the repository root
   - Reload the target tab after installing so the network listener captures all
     requests from the start.

No build step is required to run the extension — it is plain JavaScript.

## Running tests

```bash
npm test        # 45 unit tests (Node built-in runner, no dependencies)
npm run build   # package dist/privacy-auditor-<version>.zip
```

Tests cover the pure logic in `lib/`. Please add or update tests when you change
scoring, tracker matching, CSP grading, or referrer-policy analysis.

## Project structure

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture. The key
rule:

- **Pure logic goes in `lib/`** (no `chrome.*`, no DOM) so it stays testable
  under Node.
- **Side-effectful code** (`chrome.*`, DOM) stays in `background.js`,
  `popup.js`, `content.js`, `injected.js`.

The same `lib/` files are loaded three ways — `importScripts` (worker),
`<script>` (popup), and `require` (tests) — so keep the `module.exports` guard
at the bottom of each file intact.

## Coding style

- Vanilla JS, no frameworks, no transpilation.
- Match the existing style (2-space indent, single quotes, descriptive names).
- Wrap every `chrome.*` call that can fail in `try/catch` or check
  `chrome.runtime.lastError`.
- Keep memory bounded — respect existing caps (request log ≤ 250/tab, etc.).

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`.

## Adding a tracker

Add an entry to `TRACKERS` in `lib/scoring.js` with `name`, `category`, `risk`
(`low` / `medium` / `high` / `critical`), and an optional `desc`. The test suite
validates that every entry is well-formed.
