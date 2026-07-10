# Wave D — Ghosts + Live Numbers (the feel arrives)

## CARD D1 · Ghost material (G5a)

Spec: 01 P2 · 02 §3 ghost spec · 04 §3.1 (confusion risk)
Scope: one ghost treatment for 3D (shader: 32% self-albedo fill, 1 px inner stroke in provenance hue, 3 s ±4% opacity breath; static under reduced-motion) and DOM (chip/card variant). Provenance hues: brass = your preview, violet = AI (future), cyan = simulation (future). Ghosts never occlude picking of real objects; ghosts excluded from any client-safe render/export by default.
DoD: fixture route with real vs ghost objects for visual regression; picking test proves click-through; export path test proves exclusion; hover reveals provenance.
Out of scope: AI scheme generation (SS++ Phase 8), collaborator ghosts (deferred with T-105).
Verify: fixture screenshots light/dark + picking/export tests.

## CARD D2 · Preview-first operations (G5b)

Spec: 01 P2 verbs (summon/materialize/strike) · 01 §21.3 · 02 §6 signature move 3
Scope: paste, duplicate, and `placeChairBrush` render as ghosts first; Enter/click materializes (single Action, single undo step) with the 240 ms rise-and-settle; Esc cancels; strike = sink-and-fade. Brush density becomes adjustable pre-materialize.
DoD: acceptance 01 §21.3 exactly; the materialize animation is interruptible; no regression to raw placement latency; UI copy uses summon/materialize/strike sparingly (verbs in tooltips, not labels).
Out of scope: live-number reflow (D3), arrangers rework.
Verify: Playwright flow paste→ghost→materialize→undo + recording.

## CARD D3 · Vitals + Live Numbers (G7)

Spec: 01 P4 + §8 · 04 §3.3 (pinning) · 06 G7
Scope: bottom-right vitals cluster (Guests n/cap · Clearance state · Flip estimate · £ total from cost-store; revenue role-gated). Tabular mono, count transitions, scrub affordance (dotted underline). Implement ONE scrub target end-to-end: guest count → ghost reflow of brush-zone seating with live clearance halos, release to materialize, Esc cancels — plus **zone/table pinning** (pinned objects are untouchable by reflow) per 04 §3.3. Flip vital shows "assumption" provenance until actuals exist.
DoD: acceptance 01 §21.3 analog for scrub (ghost-preview → single-undo materialize); reflow solver < 400 ms for 150 tables (local, no network); pinning respected in tests; vitals never overlapped by toasts.
Out of scope: aisle-width and seats-per-table scrub targets (fast-follow cards), quote drill-in.
Verify: Playwright scrub recording + solver perf test.
