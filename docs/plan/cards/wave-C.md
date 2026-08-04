# Wave C — Altitude + performance (one continuous view, 60 fps)

## CARD C1 · Altitude camera rig (G3a)

Spec: 01 P1 + §4 · 04 §3.2 (fallback) · 06 G3
Scope: single camera rig with an altitude parameter driving four bands (Eye 1.2–2 m / Room 2–6 m / Dollhouse 6–20 m / Plan ortho). Scroll = altitude; pinch = in-band zoom; keys 1–4 = band presets; Tab untouched (a11y). Perspective→orthographic ease between Dollhouse and Plan (short, no roll; reduced-motion = cut). Replace/absorb `CameraRig`/`CockpitPlanningCamera` defaults. Ship a settings flag "discrete bands" (animated cuts) as the 04 §3.2 fallback and for user testing.
DoD: no orientation-loss regressions in existing camera tests; band state exposed to stores (label/overlay layers react); Eye band has proxy-mesh collision if walk ships here, else Eye = low orbit (walk explicitly out of scope).
Out of scope: first-person WASD walk + seat view (post-F card), ink emergence (C2).
Verify: Playwright screenshots per band + scroll-through recording.

## CARD C2 · Ink layer / Plan band (G3b)

Spec: 01 P1 table (Plan band: ink + dimensions) · 02 §6 "blueprint dissolve"
Scope: generated linework layer from manifest/proxy geometry (walls, openings, columns) + clay furniture tops; measurement/dimension display in Plan band; splat opacity and label billboarding driven by the altitude parameter (per-layer emphasis curves). The dissolve must be shader-level fades, not scene swaps.
DoD: Plan band legible on the fixture room without splat loaded (atelier parity); dimensions read from real manifest scale ("ops-grade-2cm" tier respected — but never claim survey-grade); 60 fps through the full dissolve on the reference laptop.
Out of scope: PDF export restyle (existing hallkeeper PDFs untouched).
Verify: screenshots at 5 altitude stops; frame-budget test extended to the dissolve.

## CARD C3 · Blueprint absorption (G3c)

Spec: 01 P1 ("no 2D mode tab") · 06 §2 Track 3
Scope: `/blueprint` route becomes a redirect into the planner at Plan band (deep-link preserves `:configId`). Port anything Blueprint-only (layer rows, scale label, alignment guides) into Plan band or explicitly list as retired with rationale. Keep a printable view.
DoD: zero lost capabilities without a written disposition; existing blueprint tests migrated; hallkeeper/PDF paths unaffected; old URLs keep working.
Out of scope: new Plan-band-only tools.
Verify: route tests + side-by-side screenshots old Blueprint vs Plan band.

## CARD C4 · Instancing + BVH + ladder (G9)

Spec: 01 §17 budgets · 03 §5 · 06 §5 (instancing screenshots vs absent code — investigate first)
Scope: FIRST check git history/branches for prior instancing work (root screenshots suggest it existed — reuse if sound). Then: per-SKU `InstancedMesh` for furniture, three-mesh-bvh raycasting against proxy/collision geometry only, and the quality ladder skeleton (full splat → reduced LOD → static fallback → Plan-only) with a device micro-benchmark choosing the initial tier.
DoD: 500 placed objects at 60 fps on the reference laptop with 2 M visible splats; picking accuracy unchanged (selection tests); ladder tiers reachable via dev override; budget test raised to the 500-object scene.
Out of scope: Spark splat-tree tuning per room (lands with G10 assets).
Verify: perf test numbers in handoff + before/after frame timings.
