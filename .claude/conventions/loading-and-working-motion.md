**Read this when:** adding or modifying any user-visible asynchronous operation, loading state, background-work status, route fallback, save, search, upload or export.

# Venviewer loading and working motion

Blake's 2026-09-05 instruction: employ the supplied loading animations across everything in this project and make all other sessions use them for new work.

Reference: `E:/downloads/loading animations2.mp4` (19.648 s, 1920×1080, 60 fps). It shows a restrained rounded status capsule, a fine particle sphere folding into a ring and a flowing column, neutral dots with occasional copper highlights, and an explicit work label. The implementation translates that vocabulary into CSS-animated SVG; the video is reference material, not a runtime download. Decoded inspection artifacts are under `D:/claude/venviewer-loading-20260905/` on Blake's machine.

## Required components

Import from `components/shared/Activity.js` using the appropriate relative path.

```tsx
{loading && <ActivityStatus>Loading reservations…</ActivityStatus>}
{opening && <ActivityStatus variant="panel">Opening the room…</ActivityStatus>}
{uploading && <ActivityStatus progress={measuredPercent}>Uploading photograph…</ActivityStatus>}
<button disabled={saving} aria-busy={saving} onClick={save}>
  {saving && <ActivityIndicator size={18} />}
  {saving ? "Saving…" : "Save"}
</button>
```

`ActivityStatus` supplies one polite live status, a decorative particle indicator and optional measured progress. It renders a span so it can sit inside existing text layouts. `ActivityIndicator` is decorative and must accompany visible work text or a named control. Use it inside an existing status region with headings to avoid nested live announcements. Keep actual operation labels; do not copy “Reasoning” onto a request that is merely fetching data.

Use inline feedback close to the affected content. Use the panel capsule for a route or substantial empty surface. Preserve usable content during refresh. Do not block the entire app for a local action. Preserve real bytes/counts/percentages and error/retry/cancel paths. Mount motion only while work is active; stop it on success, error, cancellation or unmount. A persisted pending record, offline queue, empty state, or unverified asset is not evidence of current computation. Model loading explicitly if the old state conflates waiting and failure.

## Motion and maintenance

- The shared CSS owns the particle choreography and `prefers-reduced-motion` still state. Do not add spinners, animated ellipses, skeletons, pulsing placeholders or independent loading keyframes.
- No artificial delays or made-up completion percentages. No video, canvas, WebGL or frame-by-frame React state for these indicators. Do not attach them to the Three.js frame loop.
- Preserve button names, disabled state, status semantics, retry controls and text contrast. Check light/dark surfaces and a narrow viewport. Use theme inheritance; `--vv-activity-accent` may customize the accent.
- Add deferred-request regression coverage for loading → ready and loading → error, and working → finished as relevant. Run the activity convention check with the normal web test suite.
- `index.html` has a small first-paint adaptation that disappears when React mounts; keep its reduced-motion behavior and visual vocabulary aligned.
- Any other active task/worktree implementing new UI must consume this component when integrated. Read the current `CLAUDE.md` and this file again before finalizing older work.

This instruction is durable project policy. Current implementation/test evidence belongs in `docs/state/tasks.md` (T-594) and the session log; visual acceptance remains Blake's judgment.
