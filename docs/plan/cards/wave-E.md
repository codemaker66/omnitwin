# Wave E — the Timeline (the event becomes four-dimensional)

## CARD E1 · Timeline component (G6a)

Spec: 01 P3 + §7 · 05 boards A/C · 06 G6 (data model exists: `cockpit-phase-model.ts`, `EventPhaseGraph`)
Scope: bottom-docked timeline consuming the existing phase model: phase blocks on a time ruler, playhead, collapsed 56 px / expanded state, `[` `]` step keys, Space tap = play/pause (hold = pan — do not collide). Hidden entirely for single-phase events. Phases link to `phase_layout_snapshots` as keyframes.
DoD: renders from real event data (Event Architect output); zero timeline for single-phase configs (test); keyboard operable; House tokens throughout.
Out of scope: scrub morphing (E2), flip intelligence (E3).
Verify: fixture events (1-phase, 5-phase) screenshots + interaction tests.

## CARD E2 · Scrub morph (G6b)

Spec: 01 §7 (correspondence + honesty) · 04 §3.4 · 02 §6 (time-linear scrub)
Scope: scrubbing morphs object transforms between adjacent keyframes: stable-ID correspondence first, nearest-neighbor per SKU second; unmatched objects strike/materialize mid-transition. Presentational only — no interpolated state is ever saved or exported (write the test). Honesty caption "visualizing change between phases" on first N scrubs. Play = whole event in ~20 s.
DoD: morph at 60 fps on the 500-object scene; export during scrub yields the nearest keyframe only; reduced-motion = crossfade; caption uses claim-safe wording.
Out of scope: Rehearse simulation (SS++ Phase 7).
Verify: recording of full-event play + export-during-scrub test.

## CARD E3 · Flip gap + compile hook (G6c)

Spec: 01 P3/§7 (flip = first-class gap) · 05 board C · 06 G6 · claim rule 06 §5
Scope: the gap between phases becomes an object: furniture delta (from keyframe diff via the Action log), crew-minutes **assumption** (config-table constants until post-event actuals exist — label it so), amber glow when window < estimate. "Compile flip plan" feeds the delta into the EXISTING ops-handoff/pick-list pipeline as a draft for human review — reuse, don't rebuild.
DoD: delta correctness tests (adds/removes/moves across two keyframes); assumption labeling passes the claim-guard test; compiled draft appears in the existing handoff surface untouched-by-styling; nothing auto-sends.
Out of scope: supplier notifications, hallkeeper mobile changes.
Verify: end-to-end test ceremony→dinner fixture → compiled pick-list draft screenshot.
