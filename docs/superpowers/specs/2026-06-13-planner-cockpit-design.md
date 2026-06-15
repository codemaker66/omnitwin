# Planner Cockpit — Design Spec

**Date:** 2026-06-13
**Author:** Squad frontend-architecture lead (Claude Code)
**Status:** Proposed — awaiting Blake review
**Related tasks:** T-427 (proposals/quotes), T-447 (revenue), T-458 (guest-flow), T-166/T-191 (Truth Mode/evidence UI), T-095/T-462 (multi-venue)
**Supersedes nothing.** Promotes the internal `/dev/trades-hall-visual` command shell into the real planner at `/plan`.

---

## 1. Goal

Make the real planner at `/plan` look and behave like the uploaded "Venviewer" cockpit mockup — **and** make every control do its real job, against live data, at SS++ tier. The outcome must be simultaneously:

- **Visually maximal** — cinematic, alive, tasteful; the kind of screen a multibillion-dollar product (Linear/Stripe/Apple/Hermès tier) ships as a flagship.
- **Functionally maximal** — a single command center where a venue planner does the entire job (design → guests → flow → evidence → lighting → ops → costs → share) on one screen, with real, value-giving outputs.
- **Honest** — SAFE language throughout; no fabricated certainty; graceful, beautiful degradation when data is absent.

### The reframe (why this is tractable)

The cockpit **already exists** as a built page: [`TradesHallVisualPage.tsx`](../../../packages/web/src/pages/TradesHallVisualPage.tsx) at `/dev/trades-hall-visual`, a near-1:1 render of the mockup. It already pulls real data (`getEventPhaseGraph`, `getTruthModeSummary`, `getLatestGuestFlowReplay`, `getLatestRuntimePackage`) and mounts the real `SparkSplatLayer`. Its gaps:

- It's stranded on a dev route and runs mostly on `TRADES_HALL_VISUAL_DEMO_STATE` fixtures.
- Its canvas is a **read-only viewer**, not the editable planner scene.
- Most chrome buttons are **inert** (nav rail only sets local state; cards just toggle an overlay; gates/status/save/user are hardcoded).

So this is not "build a cockpit." It is **merge the existing cockpit chrome with the live editable planner, replace fixtures with real bindings, and wire every control** — then make it sing.

### Decisions locked with Blake

1. **First slice = the full merge** (chrome + editable scene + overlays), not a staged viewer.
2. **Home = `/plan`** and `/plan/:configId` (and `/plan/:code`, `/v/:venueSlug/plan`). The cockpit *is* the planner.
3. **Left rail = navigation; tools live under Design mode**, docked inboard of the nav rail.
4. **Governing bar = maximally impressive, SS++ taste + engineering, real-world useful, fun.**

---

## 2. The SS++ bar — concrete, not vibes

This section is a requirement, reviewed like any other. "Would Linear/Stripe/Apple/Hermès ship this as-is?" is the test for every surface.

### Signature "wow" moments (must-haves)

- **Splat dissolve.** Mesh ↔ Splat ↔ Hybrid is a **spring cross-dissolve** (opacity + subtle scale), not a hard cut — the gaussian-splat Trades Hall melts in over the procedural mesh. This is the headline moment; it must feel physical.
- **Cinematic establishing move.** On first load, the camera performs one slow, eased dolly to the default framing while chrome regions stagger in (top bar → rails → bottom), each with spring entrance. ~1.2s, skippable on interaction, **disabled under `prefers-reduced-motion`.**
- **Phase time-machine.** Selecting a phase in the Event Phase Graph re-frames the scene to that phase's saved layout snapshot — the *same room across the event timeline* (Arrival → Ceremony → Room Flip → Dinner …). Transitions are spring-interpolated object moves where snapshots exist. This is the single most impressive *and* useful capability.
- **Living guest-flow replay.** Agents are glowing world-space motes with motion trails moving along real navmesh paths; the density heatmap shimmers; the scrub/play timeline feels alive. Bottlenecks pulse.
- **Mode lenses.** Switching the nav rail is a **lens change on one scene**: the right panel cross-fades, and the canvas overlays animate in/out for that mode (Flow lights up paths; Evidence highlights review-gated objects with a gold outline; Costs dims to a revenue-scenario read; etc.).
- **Object card that tracks.** The selected-object card spring-pops beside the object and follows it as you orbit (projected from world space).

### Motion & feel system

- **Springs, not tweens**, per `feedback_spring_physics` — per-interaction tuning (snappy for selection, soft for panels, slow-luxe for camera/scene). No linear easings on anything the eye lands on.
- **Gold accent language** already in the codebase (`#c9a84c`, near-black glass, Inter + Playfair Display) is the palette. Reuse the existing shimmer/glow/hover idioms from `VerticalToolbox`.
- **Micro-interactions everywhere**: button press scale `0.97`, focus-visible gold rings, hover lift, chip pulse on live status, number roll-ups on metric changes.
- **`prefers-reduced-motion` is first-class** — every cinematic behavior has a tasteful instant/cross-fade fallback. SS++ taste includes respecting this.

### Anti-cheese guardrails

No gratuitous parallax, no spinner theater, no sound, no fake "AI thinking" delays, no green "all-clear" badge that hides unresolved review (forbidden by Truth-Mode design). Impressive *because it's real*, not because it's loud.

### 2.1 Beyond the mockup — elevations that push it further

These take the cockpit past the screenshot into "the tool a venue *sells with*." Each is impressive **and** real-world useful **and** feasible web-only (no new backend). Phased so every checkpoint still ends green; **stretch** items never block the DoD.

- **⌘K command palette** *(in-slice, phase 4).* Fuzzy-jump to any lens, phase, object, or action — switch lens, select a phase, frame a table, create a proposal, compile an ops pack, run flow replay, copy a share link. Keyboard-first; the accelerator that makes the cockpit feel like Linear/Superhuman.
- **Showcase / Present mode** *(in-slice, phase 4; reuses the time-machine + camera).* One click plays a cinematic auto-tour of the event timeline: the camera glides phase→phase, the layout morphs via saved snapshots, and overlays narrate the key planning facts (doors, peak density, review gates) in SAFE language. A client-facing pitch surface a planner can present to a couple or corporate — not a toy. Spacebar/arrows scrub; reduced-motion → stepwise, no glide.
- **Evidence → scene beam** *(in-slice, phase 3).* Hovering a review gate or evidence row highlights the exact object/zone in the scene it concerns, making abstract evidence spatial and legible.
- **Live 2D minimap inset** *(in-slice, phase 3).* A corner top-down plan that doubles as navigation (click to recenter), reusing the existing blueprint/2D view.
- **Cinematic fly-to** *(in-slice, phase 4).* Selecting an object or focusing a lens eases the camera to frame it — never a hard jump.
- **Time-of-day relight** *(stretch fast-follow).* A sun/time slider relights the hall through the windows (golden-hour ceremony light). Ties to the Lighting lens; genuinely useful for couples choosing a ceremony time. Only if it fits without breaking a green checkpoint.
- **Scenario A/B** *(stretch — likely its own follow-up slice).* Toggle/compare two `layout_variants` of the same room (e.g. 180 vs 200 covers) with the revenue + comfort-floor read side by side. The `layout_variants` table already exists.

---

## 3. Architecture — single canvas, grid shell

The core problem solved: two `<Canvas>` worlds and two layout models become **one editable canvas inside a CSS-grid cockpit, with overlays living inside the canvas so they track the camera.**

```
PlannerCockpit  (owns the .cockpit grid: topbar / rail / stage / panel / bottom)
├─ CockpitTopBar            (grid: topbar)      ← editor store + auth + linked event
├─ CockpitNavRail           (grid: rail)        ← activeMode (8 lenses) + avatar
├─ stage cell
│  ├─ PlannerScene          ← the ONE editable <Canvas> (extracted from App.tsx)
│  │   ├─ existing editing systems (RoomMesh, PlacedFurniture, SelectionSystem,
│  │   │   MarkupLayer, CirculationOverlay, CameraRig, …) — reused unchanged
│  │   ├─ SparkSplatLayer    ← splat moved INTO this canvas (Mesh/Splat/Hybrid)
│  │   └─ CockpitSceneOverlays (R3F)  ← flow motes, density, route conflicts,
│  │                                    heritage zones, review-gate highlights
│  ├─ VerticalToolbox       ← reused, shown only in Design mode, docked inboard
│  ├─ StageHudOverlays (HTML, projected) ← clearance callouts, heritage labels,
│  │                                         selected-object card, layer toggle
│  └─ CanvasLayerControls   ← Mesh / Splat / Hybrid (real cross-dissolve)
├─ CockpitTruthRail         (grid: panel)       ← truth-mode + evidence-runtime APIs
└─ CockpitBottom            (grid: bottom)
   ├─ CockpitPhaseGraph     ← getEventPhaseGraph(linked eventId) + phase snapshots
   └─ CockpitInsightCards   ← real values; open real Ops/Evidence/Revenue/Flow
```

### Key moves

- **Extract `PlannerScene`** from `App.tsx`: the `<Canvas>` + its children become a standalone component with a stable interface (`{ mode, layerMode, overlays }`). `App.tsx`'s floating-overlay chrome is replaced by the cockpit grid; the editing systems are untouched.
- **Reuse `.visual-*` CSS** (the cockpit grid in `TradesHallVisualPage.css`) as the cockpit stylesheet, renamed/namespaced `cockpit-*` to avoid coupling to the dev page; the dev page can keep importing the old names or be retired (see §11).
- **Overlays go in-canvas.** The dev page's percentage-positioned 2D overlays are replaced by: (a) R3F objects in world space for flow/density/conflict/heritage, and (b) HTML callouts projected via the camera (`useThree`) for clearance/labels/object-card so they pin to geometry under orbit/pan/zoom.
- **One source of interaction state:** a small `cockpit-store` (Zustand) holds `activeMode`, `layerMode`, `overlayVisibility`, `selectedPhaseId`, `replay` controls — so chrome and scene stay in sync without prop-drilling.

### Component isolation contract

Each component answers: *what does it do / how is it used / what it depends on.* Mappers (fixture→view, API→view, world→screen projection) are **pure functions in `lib/`**, unit-tested without WebGL. No component reaches past its props into another's internals.

---

## 4. Data flow — real bindings (fixtures are fallbacks only)

| Region | Real source | Fallback (SAFE) |
|---|---|---|
| Top bar: venue/room | editor store `space` | "Opening layout" |
| Top bar: save status | editor store `isDirty/isSaving/lastSavedAt/saveError` (via existing `deriveEditorSaveStatus`) | "Draft saved" |
| Top bar: event/phase | event linked to config (see §10 open item) | "No event linked" |
| Top bar: runtime asset | `getLatestRuntimePackage` + Spark load state | "Procedural layer / no signed capture" |
| Top bar: user avatar | auth store user initials/role | hidden when anonymous |
| Nav rail | `cockpit-store.activeMode` → panel + lens | Design default |
| Truth rail: summary | `getTruthModeSummary(target)` (already real) | computed fallback summary |
| Truth rail: review gates / evidence status | evidence-runtime API for the loaded target | demo arrays, labeled as demo |
| Phase graph | `getEventPhaseGraph(eventId)` + `visualEventPhasesFromGraph` | demo phases, labeled |
| Insight cards | guest-flow replay (real) + evidence/ops/revenue APIs | demo values, labeled |
| Scene overlays | real `placedObjects` + replay artifact | replay worker / demo artifact |

**Rule:** a fixture may only render when its real source is genuinely unavailable, and when shown it is visibly labeled as demo/simulated. No fixture is ever presented as venue truth.

---

## 5. The eight lenses (nav rail) — each genuinely useful

Each lens is a *view on the same loaded configuration*, not a separate app. Right panel + canvas overlays change; the scene persists.

1. **Design** — the editable planner. `VerticalToolbox` + catalogue + command deck active; full edit. (Default.)
2. **Guests** — guest count, table assignments, per-table notes from the config; CRM contact context where linked. Right panel = guest/table list; canvas highlights selected table.
3. **Flow** — guest-flow replay: run/scrub, agents + density + bottlenecks + route conflicts; metrics (agents, peak density, conflict count). All "simulated / human review required."
4. **Evidence** — Truth Mode drill-down: source/verification/confidence/assumptions, review gates, evidence status, per-target. Canvas outlines review-gated objects.
5. **Lighting** — lighting-context evidence state + scene lighting read; "partial / human review required" where unverified. Optional time-of-day relight (stretch, §2.1).
6. **Ops** — Event Ops Compiler: compile/refresh handoff pack, task counts, setup sequence. Card → real ops surface.
7. **Costs** — quote + revenue scenario (exact pence; "scenario estimate, not a quote"). Comfort-floor warnings preserved.
8. **Share** — proposal share link for the config (create/copy client-safe link). Reuses the T-427 proposal spine.

Where a destination's dedicated surface already exists as a page (Ops handoff, Event-day ops, Proposal), the lens either embeds the panel or deep-links with the loaded `configId` — **confirmed per-lens during planning** (§10).

---

## 6. SAFE language & Truth-Mode invariants (non-negotiable)

- Preserve verbatim: "Planning evidence / human review required", "simulated", "scenario estimate, not a quote", "Human review required before operational reliance", "not yet signed".
- Never imply fire/egress/structural/occupancy/legal certification, survey-grade accuracy, or a guaranteed quote.
- No single green "all clear" badge; review gates and stale/partial states stay visible (per `T-166`, `T-191`, Truth-Mode design research).
- Revenue stays scenario-framed with comfort-floor warnings (per `T-447`).

---

## 7. Accessibility

- Full keyboard operability: nav rail and cards are buttons with `aria-pressed`; right panel is a labeled region; phase graph is a list with selection semantics.
- Focus management on lens/panel change; visible focus rings; ESC closes transient layers.
- `prefers-reduced-motion`: cinematic camera/dissolve/stagger collapse to instant or simple cross-fade.
- Color is never the only signal (status chips carry text); contrast meets AA on the dark theme.

---

## 8. Performance

- Single `<Canvas>`, `frameloop="demand"`; overlays invalidate only on real change.
- Heavy lenses (Flow worker, Ops compile) lazy-load and run off the main paint.
- Replay runs in the existing Web Worker; main thread only renders artifacts.
- Cockpit chrome is memoized per region; `cockpit-store` selectors are narrow to avoid cross-region re-renders.
- Splat dissolve uses opacity, not re-instantiation.

---

## 9. Build phases (one slice; each phase ends green: typecheck + lint + tests + build)

1. **Shell + route swap.** `cockpit-store`; extract `PlannerScene` from `App.tsx`; `PlannerCockpit` grid; mount at `/plan*`; editable scene works inside the grid; tools under Design. Chrome present, some fixtures still. *Exit: `/plan` renders the grid with a fully editable scene; no regression to save/load.*
2. **Wire the chrome.** Top bar, nav rail lenses, Truth rail (gates+status from evidence API), phase graph (linked event), insight cards (real values + open real surfaces), Mesh/Splat/Hybrid, Layers, 3D/2D. Fixtures become labeled fallbacks only. *Exit: every chrome control performs a real action or a safe fallback.*
3. **Overlays + spatial evidence on the real scene.** World-anchored flow/density/conflict/heritage/review-gate highlights; projected HTML callouts + tracking object-card; **evidence→scene beam**; **live 2D minimap inset** (§2.1). *Exit: overlays pin to geometry under orbit/pan/zoom; evidence is spatial.*
4. **The wow pass + accelerators.** Splat dissolve, establishing move, phase time-machine, lens transitions, cinematic fly-to, **⌘K command palette**, **Showcase / Present mode**, micro-interactions, reduced-motion paths. *Exit: signature moments + palette + present mode land; reduced-motion verified.*
5. **Verify + tests + docs.** Unit (pure mappers/projection), RTL (chrome wiring + fallbacks + SAFE copy), E2E (cockpit on `/plan`, lens switching, splat toggle). Full verify chain; SAFE audit; session log + `tasks.md`. *Exit: all green; docs updated.*

Phases are sequential checkpoints, **not** scope reductions — the slice is the whole list.

---

## 10. Open items to confirm during planning (flagged honestly)

- **Event↔config linkage.** Editor store has no event field. Confirm how to resolve the event linked to a configuration (`event_configuration_links`) and whether a web client/endpoint exists. If none, top-bar event + phase graph degrade to "No event linked" and the phase time-machine is inert until an event is attached. *Must verify before phase 2.*
- **Per-lens surfaces.** Confirm the exact real surface each lens binds to (embed vs deep-link) for Guests, Lighting, Ops, Costs, Share — some have full pages (Ops handoff, Proposal), others may be v1-thin (Guests/Lighting). The spec commits to "real data we have, labeled honestly," not invented surfaces.
- **Phase layout snapshots.** Confirm `phase_layout_snapshots` exposes per-phase placed-object sets to the web client for the time-machine; if not, phase selection re-frames camera + metrics only (still useful) and snapshot morphing is a follow-up.
- **Mobile.** Keep existing `MobilePlannerTopBar` + dock for narrow/touch; cockpit grid is the desktop experience (grid already collapses). Confirm the mobile cockpit is "chrome-lite over the editable scene," not the full desktop rail.

---

## 11. Out of scope for this slice / disposition

- **Multi-venue cockpit** (cross-venue analytics) — future (`T-462`).
- **The `/dev/trades-hall-visual` page** — kept during phases 1–4 as the reference; retired or pointed at the new namespaced components in phase 5 to avoid two cockpits drifting.
- **New backend** — none. This slice is web-only assembly + wiring against existing APIs.

---

## 12. Definition of Done

- `/plan` renders the cockpit grid with a **fully editable** scene; no regression in load/save/undo/section/markup.
- Every chrome control performs a **real** action or a **safe, labeled** fallback — zero inert buttons.
- Truth rail, phase graph, and cards read **live** data with fixtures only as labeled fallbacks.
- Overlays track the camera; selected-object card follows its object.
- Signature moments (splat dissolve, establishing move, phase time-machine, lens transitions, cinematic fly-to) land, with reduced-motion paths.
- Accelerators land: **⌘K command palette** jumps to any lens/phase/action; **Showcase / Present mode** plays the cinematic event-timeline tour in SAFE language; **evidence→scene beam** and **live minimap** make the scene legible.
- SAFE language preserved verbatim; no new certainty claims; no green-all-clear badge.
- Green across types/api/web typecheck + lint + tests + build; new tests for mappers, chrome wiring, and an E2E for the cockpit; session log + `tasks.md` updated.
- Passes the test: *would a flagship product ship this screen as-is?*
