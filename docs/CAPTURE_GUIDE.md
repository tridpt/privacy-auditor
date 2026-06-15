# 📹 Capture Guide — Demo GIF & Screenshots

A short, polished demo is the single highest-impact thing you can add for a
portfolio. This guide gives you an exact shot list so the result looks
intentional, not improvised.

## Before you record

1. Load the extension fresh (`chrome://extensions` → reload) so the badge starts clean.
2. Pick a **tracker-heavy site** for a dramatic result — news or e-commerce works best
   (e.g. a major news homepage). Avoid sites with login walls.
3. **Reload the target tab** right before recording so all requests are captured.
4. Set Chrome zoom to 100% and use a clean profile (no unrelated extensions in the toolbar).
5. Close DevTools — the popup looks best on its own.

## Demo GIF — shot list (~10–15 seconds)

Keep it tight. Recommended sequence:

1. Click the extension icon → popup opens showing the **privacy score gauge** (1–2s pause).
2. Scroll to the **Trackers** tab → show the detected tracker list with risk badges.
3. Switch to **Fingerprinting** → show detected APIs.
4. Switch to **CSP** → show the grade.
5. Click **Block All** (or toggle Global Protection) → show the badge / lifetime banner update.

End on the score or the "blocked" state — a satisfying final frame.

## Recording tools

| OS | Tool | Notes |
|---|---|---|
| Windows | [ScreenToGif](https://www.screentogif.com/) | Free, records a region directly to GIF, has a frame editor |
| Windows | ShareX | Also exports GIF |
| Any | OBS → convert to GIF | Higher quality if you record MP4 first |

Record just the popup region (≈ 400×600) rather than the full screen — the
file stays small and the popup fills the frame.

## Keep the file small

- Target **under ~8 MB** so GitHub renders it inline in the README.
- 10–15 fps is plenty for UI; trim dead frames at the start/end.
- If it's too large: reduce frame rate, shorten the clip, or crop tighter.

## Wiring it into the README

1. Save the GIF as `docs/demo.gif`.
2. In `README.md`, near the top, uncomment the demo image line and remove the
   "coming soon" note:
   ```markdown
   ![Privacy Auditor demo](docs/demo.gif)
   ```

## Optional: static screenshots

Nice for showing individual tabs without watching the whole GIF. Save as
`docs/screenshot-<tab>.png` (e.g. `screenshot-trackers.png`) and reference them
in a small table:

```markdown
| Score | Trackers | CSP |
|---|---|---|
| ![](docs/screenshot-score.png) | ![](docs/screenshot-trackers.png) | ![](docs/screenshot-csp.png) |
```

Use a 2× device pixel ratio (Chrome DevTools device toolbar, or just a
high-DPI display) for crisp images.
