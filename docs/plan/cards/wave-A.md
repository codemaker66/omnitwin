# Wave A — the golden loop (L0: "the room resolves")

## CARD A1 · Reception Room runtime default-on (G1a)

Spec: 00 §5 beat 1 · 01 §13 loading/fallback · 06 G1
Scope: make the built Reception Room runtime package the default `/plan` experience. Resolve the room via `/assets/runtime-packages/latest` + `useRoomRuntimeSplat`; mount through `SparkSplatLayer`; surface an honest status chip sourced from claim/evidence state ("Runtime asset loaded — not yet signed", or current state). If no package resolves, render the atelier fallback (clay + ink) with the chip "Captured visual layer not yet available — planning on reviewed geometry" — never a blank canvas, never placeholder imagery.
Files in play: `packages/web/src/**/PlannerScene.tsx`, `useRoomRuntimeSplat`, runtime-packages API client, chip component.
DoD: acceptance 01 §21.1 (chip + interactive < 1.5 s on proxy); fallback path has a test; chip text comes from data, not hardcoded copy; works logged-out on the anonymous draft path.
Out of scope: progressive-resolve choreography (A2), multi-room switcher polish.
Verify: vitest on package resolution + fallback; Playwright screenshot of loaded room + chip; screenshot of fallback with package URL stubbed to 404.

## CARD A2 · Resolve-over-blueprint load (G1b)

Spec: 01 §13 "the room resolves" · 02 §6 signature move 1 · 06 G1
Scope: first paint = architecture linework/proxy from the manifest (< 300 ms, cached); splat streams in over it coarse-to-fine with a quiet caption ("Loading captured room · Reception Room · 63 MB"). No spinner anywhere. Interactive (camera + selection) during resolve. Reduced-motion: crossfade instead of develop effect.
Files: PlannerScene layer order, SparkSplatLayer load events (splatCount/localBounds already emitted), new ink/skeleton layer (may seed C2).
DoD: measured first-paint < 300 ms warm / < 1.5 s cold on the reference laptop; no input blocking during stream; caption uses claim-safe wording; frame-budget test still green.
Out of scope: full Plan-band ink system (C2).
Verify: Playwright with network throttled to 50 Mbps + screenshots at t=0.3 s / 2 s / complete.

## CARD A3 · House token layer (G2a)

Spec: 02 §3–§5 · 06 §3.3 (no Tailwind; extend `--vv-*`)
Scope: introduce `packages/web/src/styles/house-tokens.css`: map existing `--vv-ink/gold/cream/cyan/danger/success/focus` onto the House token names (bg/0..2, hairline, text/1..3, accent/brass, status sage/amber/grey/oxblood/cyan/violet) with 02's values; keep `--vv-*` as aliases so nothing breaks; add ghost-material constants and motion-duration tokens (instant/deliberate/cinematic). Document in the file header which token is canonical.
DoD: zero visual regressions on golden routes (pixel-diff); one page (planner chrome) actually consumes House names to prove the path; dark-theme contrast audit ≥ 4.5:1 on chrome text (write the check as a test over token values).
Out of scope: FOH ivory register (F2), font licensing changes.
Verify: visual regression suite + token contrast test.

## CARD A4 · Chip grammar (G2b)

Spec: 01 §9 (canonical states) · 02 §3 status table · 06 G2
Scope: promote `vv-status-chip` into a single `EvidenceChip`/`StatusChip` component implementing the four evidence states (Current sage / Review required amber / Stale grey / Missing dashed-outline) + provenance badges (operator / machine-checked / AI violet / simulated cyan) — hue + icon + label always, never color alone. Replace ad-hoc chip usages found in router fallback, cockpit rail, truth indicator.
DoD: storybook-style fixture route rendering all states for visual regression; chips consume claim/evidence data shapes already in the API; keyboard-focusable with visible ring; states match 01 §9 names exactly.
Out of scope: evidence drawer redesign (Wave D+), review-gate flows.
Verify: fixture screenshots + unit tests on state mapping.
