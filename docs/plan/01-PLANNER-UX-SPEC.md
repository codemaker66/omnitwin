# 01 · The Floor — Planner UX Specification

Venviewer / OmniTwin · v1.0 · July 2026 · Status: design plan, pre-build
Companions: 00-Master-Plan · 02-Design-Language ("House") · 03-Architecture · 04-Red-Team-Critique · 05-Wireframes

---

## 1. What the Floor is

The planning page is named **the Floor** — hospitality's own word ("on the floor," floor plan, floor staff). It is not a diagramming tool with a 3D preview bolted on. It is the captured room itself, made operable.

One sentence: **a captured room — visually real, operationally live — that you plan inside, scrub through time, interrogate for proof, and hand to operations, without ever leaving it.**

The Floor's design thesis: every competitor separates *the drawing* (2D diagram), *the picture* (renders/photos), *the numbers* (capacity sheets), and *the schedule* (BEO timeline) into different artifacts. The Floor collapses all four into one object. That collapse — not any single feature — is what makes veterans gasp.

Doctrine inherited from the project bible and enforced everywhere in this spec:

- Spatial truth before decoration. The splat is visual evidence; the reviewed proxy geometry is planning authority; copy never outruns evidence.
- AI proposes; checks, evidence, and humans own authority.
- Missing data is shown honestly and made useful.
- Every state is recoverable; nothing dead-ends.

## 2. The six primitives

Six interaction inventions form the Floor's operating physics. Every feature in this spec is an application of one of them. They are the moat at the interaction layer — each is coherent alone, but they compound: *scrub Altitude while a Ghost variant is staged at a Timeline phase, drag a Live Number, and Proof updates in place.*

### P1 · Altitude — 2D and 3D are one view at different heights

There is no "2D mode / 3D mode" tab. There is one continuous camera dimension:

| Band | Height | Rendering emphasis | You use it for |
|---|---|---|---|
| Eye | 1.2–2.0 m | Full splat, guest perspective | Sightlines, emotion, walkthroughs |
| Room | 2–6 m | Splat + planner objects | Arranging, reviewing composition |
| Dollhouse | 6–20 m | Cutaway: splat fades, clay + splat hybrid | Zones, flow, whole-room judgment |
| Plan | ∞ (orthographic) | Ink linework + clay furniture, measurements on | Precision placement, printing, dimensions |

Scroll moves altitude. Between Dollhouse and Plan, perspective eases to orthographic, the splat dissolves into drawn linework ("the blueprint develops in reverse"), labels rotate to face up, and the measurement layer fades in. Zoom back down and the drawing develops into photoreality. Keys 1–4 jump to band presets (Tab stays reserved for focus traversal — §16).

Why it matters: mode-switching is where users lose spatial orientation in every existing tool. Altitude keeps one continuous space in the user's head. It is also the signature demo moment — the plan *is* the room.

### P2 · Ghosts — one material for everything possible-but-not-real

Anything proposed but not committed renders in a single, instantly recognizable **ghost material** (spec in 02-Design-Language): AI-suggested layouts, paste/duplicate previews, a collaborator's in-flight drag, variant diffs, simulated guests, and the "what would it take" counterfactuals.

Verbs (used in UI copy and the command grammar):

- **Summon** — bring a possibility into the room as ghosts.
- **Materialize** — commit ghosts to the plan (single undoable action).
- **Strike** — remove (theater's own word); objects sink and fade, never pop.

Rules: ghosts never block picking of real objects; ghosts never appear in client-safe surfaces unless explicitly shared as "options"; every ghost carries provenance (AI / collaborator / variant / simulation) readable on hover. Materializing is always one decisive action — the commit moment is designed to feel *good* (see §14).

Why it matters: it gives AI a safe, legible place to live (proposer, never authority), makes multiplayer legible, and turns "preview before commit" from a dialog problem into physics.

### P3 · The Timeline — the event is a four-dimensional object

A bottom-docked phase timeline (Arrival · Ceremony · Dinner · Speeches · Dancing · Breakdown · custom). Each phase holds a layout keyframe; the flip is not a phase but the first-class *gap* between keyframes. **Scrubbing the playhead morphs the room between keyframes** — chairs strike, rounds materialize, the dancefloor arrives — a 20-second film of the whole event when you press play.

- The room flip is no longer a document; it is the *diff between two keyframes*, and the flip task list compiles from that diff automatically (furniture deltas → pick list → setup/strike sequence).
- Conflicts render on the timeline itself: insufficient flip window glows amber on the gap between phases; click it for the evidence.
- Single-phase events (a board dinner) never see the timeline expanded — it collapses to nothing. Complexity is progressive.

### P4 · Live Numbers — every number is a handle

Guest count, table count, aisle width, per-table seats, flip minutes, quote total: numbers in the Floor are not readouts, they are **scrubbable controls** (Bret Victor's principle, finally applied to event space). Drag "120 guests" to 148 and the seating scheme reflows *as ghosts* in real time, clearance halos updating; release to materialize or Esc to cancel.

Rules: scrubbing always previews as ghosts, never mutates directly; each number shows its provenance on hover (entered / derived / AI-estimated); derived numbers (e.g. flip time) can't be dragged but explain themselves when clicked.

### P5 · Command — say what you want, see it before it's true

One command pill, top-center (⌘K or click, mic for voice). Three registers, one grammar:

- **Verbs**: `add 12 rounds of 10`, `arrange cabaret`, `check clearances`, `compare A/B`, `share client view`.
- **Questions**: "will 140 fit cabaret with a dancefloor?" → an answer chip in safe language ("Planning guidance: 132 comfortable, 140 tight at aisle minimums — human review required") plus a summoned ghost proof.
- **Descriptions**: "candlelit charity dinner for 90, band, wide route to the bar" → three ghost schemes staged in the actual room as cards with tradeoff chips ("+1 table · tighter west aisle"); arrow keys cycle them live in the room; Enter materializes.

Latency law: verb commands resolve locally in <400 ms; AI schemes stream in progressively (first ghost <4 s). The pill is an accelerant, never a gate — every command has a button-and-menu equivalent for staff who will never type a command.

### P6 · Proof — honesty as a visible material

Truth Mode is not a separate screen; it is the Floor's material honesty, always one gesture away:

- An **evidence chip** in the top bar aggregates layout state: `Current · 12 checks` / `Stale · re-run` / `Review required` / `Missing`.
- Every object, overlay, and number is selection-aware: click a table → source, spacing checks, linked ops tasks; click a route → width, assumptions, conflicts; click the splat → capture source, "runtime asset loaded, not yet signed"; click a heatmap → "Simulated · seed 41 · assumptions."
- Edits mark dependent checks stale instantly (grey, one-click re-run). Exports pass the claim guard: forbidden claims ("fire approved," "certified safe") are blocked with safe rewordings offered.

Why it matters: every rival sells prettiness. Proof is the enterprise-grade trust layer that makes prettiness *credible* — and it is the hardest primitive to copy because it is cultural, not cosmetic.

---

## 3. Anatomy

Back-of-House register (dark, operational — see 02). The room is always the largest thing on screen. Chrome floats above the scene as smoked-glass panels and never forms an opaque frame.

```
┌────────────────────────────────────────────────────────────────────┐
│ ◃ Trades Hall / North Gallery / Hamilton Wedding / Layout B        │ top bar 48px
│              [ Ask or command…  ⌘K ]        ●●○ ⚑Evidence ▷Present │
│                                                                    │
│ ┌─Scene──┐                                            ┌─Inspector┐ │
│ │ Phases │                                            │ Object   │ │
│ │ Zones  │              THE ROOM                      │ Checks   │ │
│ │ Objects│         (full-bleed viewport)              │ Evidence │ │
│ │ Layers │                                            │ Ops      │ │
│ └────────┘                                            └──────────┘ │
│                                                   Guests 118/140   │
│                                                   Clearance ✓      │ vitals
│                                                   Flip 35m · £14.2k│
│ ├─ Arrival ──┤── Ceremony ──┤─Flip─┤──── Dinner ────┤─ Dancing ─┤  │ timeline 56px
└────────────────────────────────────────────────────────────────────┘
```

Zones:

- **The room (viewport)** — full-bleed, edge to edge. Everything else is translucent and dismissible. `F` enters Focus: all chrome fades to nothing but the command pill's ghost.
- **Top bar (48 px)** — breadcrumb (venue / room / event / variant, each segment a switcher); command pill center; right cluster: presence avatars, evidence chip, share, Present.
- **Scene rail (left, 280 px, collapses to 48 px icons)** — Phases, Zones, Objects, Layers as a tree. It doubles as the accessibility surface (§16): the rail *is* the room, in list form. Drag to reorder groups, eye/lock toggles, counts per group ("Rounds ×12 · 120 seats").
- **Inspector (right, 320 px, contextual)** — tabs: Object · Checks · Evidence · Ops. Empty selection shows the Room card: capacity guidance (planning-grade wording), runtime asset status, package links, review state.
- **Vitals (bottom-right floating stack)** — the numbers that matter, always ambient: `Guests 118/140 · Clearance ✓ · Flip 35m · £14.2k` (revenue role-gated). Tabular figures; changes count up/down; every vital is a Live Number (P4) or explains itself.
- **Timeline (bottom, 56 px collapsed / 200 px expanded)** — P3. Hidden entirely for single-phase events.
- **Context arc** — right-click on any object opens a radial menu at the cursor: max six verbs (Duplicate, Arrange, Label, Check, Ops task, Strike). Everything in the arc also exists in the Inspector.

Layout principles: nothing overlaps the vitals; toasts dock bottom-left; only one hint chip may exist at a time; dialogs are a last resort (inline editing and drawers first); the scene never scrolls — panels do.

## 4. The camera

- Scroll = altitude (P1); pinch zooms within a band; right-drag orbits (Room/Dollhouse) or looks (Eye); Space-drag pans; double-click travels to the clicked point.
- Eye band walks: WASD/arrows at 1.4 m/s with proxy-mesh collision, click-to-walk on floor, headroom bob disabled (this is a professional tool, not a game).
- **Saved POVs**: name and pin camera positions ("From the head table," "Bar queue view"). POVs appear as small brass markers in Dollhouse+ bands and power the client walkthrough and auto-cinematography.
- **Seat view**: click any chair in Eye/Room band → snap to that guest's seated eyeline (1.15 m), with a sightline readout to the stage/head table ("clear · 14 m"). The "grandma test" — an emotional selling tool and an accessibility check at once.
- Camera motion is always interruptible; any input cancels a transition. Cinematic moves (≤800 ms, custom ease) are reserved for: band jumps, POV recall, Present mode, seat view.

## 5. Objects and manipulation

Object classes: tables (rounds, trestles, cabaret, sweetheart), seating, staging, dancefloor, bars, AV, décor/floral, service furniture, linework/markup, zones, routes, anchors (comments, POVs).

- **Placement**: drag from the Objects drawer, or the **seating brush** — paint a zone and it fills with the selected table template at a target density; scrub density afterwards (P4). Painting respects architecture: clearances to walls, columns, doors, and declared service routes are maintained live.
- **Integrity rule**: real furniture cannot be scaled — a 6ft round is a 6ft round (swap SKU to change size). This small refusal *is* the trust story at object level. Décor and markup scale freely.
- **Selection**: click, marquee, double-click into groups; `G` groups; selection outlines use the actor's presence hue in multiplayer.
- **Handles**: planar move; Y rotation with 15° detents (free with ⌥); no gizmo clutter — handles appear on hover-intent, sized by altitude band.
- **Snapping**: magnetic guides to wall offsets, column clearances, aisle spines, and sibling spacing (equal-gap whiskers, Figma-grade); hold ⌘ to suspend. Snap events tick (one-frame hairline flash + optional felt sound).
- **Clearance halos**: dragging shows each object's spacing envelope; violations shade amber (tight) or red (blocked) with the violated rule named inline ("Service route min 1.5 m — currently 1.1 m"). Never a modal.
- **Repulsion assist** (toggle, default on for brush-placed sets): tables gently maintain minimum spacing when neighbors are dragged — the room feels physically considerate.
- **Labels**: auto-numbered tables with smart renumber on reorder; seat labels; callouts that survive altitude changes (billboard in 3D, flatten in Plan).
- **Arrangers**: rows/curves/radial/cabaret/classroom/theatre generators with scrubbable parameters (pitch, curve radius, aisle count) — all ghost-previewed.
- **Measurement**: `L` for tape (snaps to architecture and objects); persistent dimensions in Plan band; area readout for zones.

Every mutation is a typed, invertible **Action** (see 03-Architecture): this single decision powers undo/redo, version history, multiplayer, AI tool-use, the audit trail, and phase diffs. Undo is instant and infinite within a session; history is a filmstrip of auto-thumbnails (hover to peek, click to branch a variant).

## 6. Variants and comparison

- Any layout state can be **forked as a variant** (A/B/C…), named, and starred. Variants are first-class: linked to proposals, comparable, and mergeable at object-group level ("take the bar setup from B").
- **Compare**: side-by-side (synced cameras) or **overlay diff** — B's differences ghost into A: additions in ghost-positive, removals in ghost-negative, moves as faint arcs. A wipe slider sweeps between full renders of A and B in-room — the jaw-drop comparison view.
- Client-facing variants render as "Option One / Option Two" with curated differences listed in plain language, auto-drafted, human-edited (claim-guarded).

## 7. The Timeline in detail

- **Structure**: phases as blocks on a time ruler; each phase holds a layout keyframe, guest count, staff/supplier requirements, and check states. Drag edges to retime; drag blocks to reorder; `[` `]` step phases; Space plays.
- **Scrub morphing**: object correspondence is computed per SKU and position (stable IDs first, nearest-neighbor second); unmatched objects strike/materialize during the transition. Morph is presentational only — data is discrete keyframes (no fictional in-between states are ever exported).
- **Flip intelligence**: the gap between phases is a first-class object. It knows the furniture delta, estimated crew-minutes (learned from post-event actuals once available; clearly labeled "estimate — based on N past flips" or "assumption" before data exists), and glows amber when the scheduled window is shorter than the estimate.
- **Compile to ops**: one action turns a flip (or the whole timeline) into the handoff draft: pick list, setup/strike sequence, supplier arrival slots — opened in the Ops tab for human review, never auto-sent.
- **Rehearse**: per-phase deterministic guest-flow simulation (see §10) plays *inside* the scrub — drag the playhead and watch arrival pressure build at the bar.

## 8. Live Numbers in detail

Scrub targets and their reflow behaviors:

| Number | Drag behavior | Guardrails shown live |
|---|---|---|
| Guest count | Seating scheme reflows as ghosts (adds/removes tables per scheme rules) | Capacity guidance band, clearance halos |
| Seats per table | Re-chairs all tables of that SKU | Comfort spacing per seat |
| Aisle width | Aisle spines widen; adjacent tables shift | Service route minimums |
| Table count | Density changes within painted zones | Zone overflow warning |
| Flip window | Timeline gap resizes | Crew-minutes estimate vs window |
| Quote total | Read-only; opens line-item breakdown | — |

Physics: 0 ms preview start (ghost reflow is computed locally on the proxy layer), materialize on release, Esc cancels, ⌥-drag for fine steps. Numbers being scrubbed enlarge slightly and show tick marks — the number *feels* like a physical slider.

## 9. Proof (Truth Mode) in the Floor

- **Evidence chip states**: `Current` (sage) · `Stale` (grey, "re-run") · `Review required` (amber) · `Missing` (outline). Click → Evidence drawer: Source · Verification · Confidence · Assumptions · Review gates · Change history · Known limitations.
- **Selection-aware**: the drawer always reflects the current selection (object, route, overlay, splat layer, or whole layout). Every claim in the drawer names its authority: "reviewed floor polygon (12 Mar 2026)," "operator-entered," "machine-checked, human review pending."
- **Review gates**: submitting for review freezes an immutable snapshot (hash shown); reviewers approve/reject/flag with scope; gate states surface on the evidence chip and on the calendar event.
- **Evidence pack export**: layout snapshot + hash, capacity guidance, route checks, assumptions, gate states, simulation artifacts if any — one click, claim-guarded, honest about gaps ("no simulation run for Dinner phase").
- **Language law**: allowed/forbidden claim lexicons from the project bible are enforced in copy components themselves — a UI string that says "certified safe" fails CI (see 03).

## 10. Rehearse — guest flow, honestly staged

- Deterministic, seeded agent simulation over the reviewed walkable geometry (floor polygons minus buffered object footprints → navmesh). Runs in a worker; replay artifact saved and hashed.
- Rendering: ghost guests (P2 material, slightly warmer), cyan flow trails, floor-glow density, queue badges with estimated wait ranges, bottleneck callouts with the constraint named.
- Framing is always **planning evidence**: the word "Simulated" is rendered into the overlay itself (not a dismissible tooltip), with seed + assumptions one click away. No evacuation or safety-certification claims, ever.
- Interaction: scrub timeline while agents flow; click a bottleneck → "what would it take" counterfactual chips (widen aisle to 1.8 m · second bar · stagger arrival) — each summons its ghost fix with tradeoffs.

## 11. Collaboration

- **Presence**: collaborators appear as name-tagged points of warm light in the room (their camera position), plus avatars in the top bar. Each person has a hue; their selections and in-flight drags render as that hue's ghost.
- **Follow**: click an avatar to ride their camera. **Present** (top-right) inverts it — everyone follows you; you get a laser dot and they get a "being guided" chrome-free view. Designed for client video calls: the planner drives, the couple rides through their wedding.
- **Spatial comments**: pin threads to 3D anchors (and to phases — a note on Dinner doesn't haunt Ceremony). Comments flatten sensibly in Plan band. Client comments from the proposal portal land as the same anchors, in FOH voice.
- **Conflict model**: CRDT co-editing (03); no hard locks — an object mid-drag by another user shows their hue and defers your grab for 400 ms rather than fighting.

## 12. The copilot's rules of the house

- The AI speaks only through P2 (ghosts) and P5 (command answers). It never mutates the plan, never approves, never sends.
- After significant edits it may offer at most one **Director's alternative** card (a composed variation with a one-line rationale). Pull, not push: it waits in the command pill's tray, never interrupts, and expires quietly.
- Every AI artifact is labeled (`AI` glyph + provenance in Proof), editable, and claim-guarded before any client-facing use.
- The copilot explains the room on request ("why is this route amber?") by citing the same evidence objects a human would see — no invented authority, no hallucinated measurements: it may only cite values that exist in the semantic model.

## 13. States

- **First run (blank hall)**: the room, fully resolved, plus exactly three chips — `Start from a template` · `Describe the event` · `Place your first table` — and a pulsing Objects drawer. No tour, no modal. Hints are just-in-time, one at a time, dismissible forever.
- **Loading — "the room resolves"**: proxy linework fades in first (<300 ms, from the always-cached manifest), architecture reads immediately; the splat streams over it coarse-to-fine (SOG progressive levels), like a photograph developing over a blueprint. A quiet caption: "Loading captured room · North Gallery · 41 MB." Loading is a signature moment, not an apology.
- **No splat yet**: the honest fallback is designed to be beautiful — "atelier" material (matte clay + ink lines) with the chip "Captured visual layer not yet available — planning on reviewed geometry." Never a placeholder render, never stock imagery.
- **Degraded**: automatic quality ladder — full splat 60 fps → reduced splat LOD → static panorama + clay → Plan band only. The ladder is announced once, quietly, with a "why" link. A ten-year-old venue laptop still gets a flawless Plan experience with identical data and checks.
- **Errors**: plain English, cause + next step + "copy diagnostics." Autosave means no work is ever lost; reconnection replays offline actions and reports conflicts as ghosts to resolve.

## 14. Feel — the earned-delight doctrine

The brief asks for dopamine engineering. The Floor uses it — but *casino mechanics are explicitly rejected* (no streaks, no fake scarcity, no confetti storms, no variable-ratio manipulation). In a product whose core promise is truth, manipulative delight is self-harm. Delight here is earned by competence and returned as craft:

1. **Speed is the first dopamine.** Sub-16 ms manipulation, sub-400 ms commands, zero spinners. Nothing feels premium if it hesitates.
2. **Materialize is the reward beat.** The commit gesture (P2) gets the best animation in the product: a 240 ms rise-and-settle with a soft focus pulse. You *did* something.
3. **Progress is a ring, not a nag.** The event readiness ring (layout → checks → review → ops) fills in the top bar; completing a stage fills an arc with a slow, satisfying ease. One next-best-action chip, never a guilt backlog.
4. **Peak-end choreography.** Leaving a session plays a 3-second orbit of what you built plus a delta card: "Tonight: seated 120 · 3 checks passed · flip cut by 8 min." The last thing you feel is progress.
5. **The hero shot.** Every layout auto-composes one gorgeous still (auto-cinematography picks the angle). It's the thumbnail, the proposal cover, and the thing staff screenshot to show their boss — the growth loop is the delight loop.
6. **Ownership.** Layouts, variants, and POVs take names ("Sarah's candlelit scheme"). People protect what they name.
7. **Micro-physics.** Hover lift, one-frame snap ticks, halo eases, count-up vitals — catalog in 02. Optional "felt & brass" sound palette, default off.
8. **Restraint is the luxury signal.** One accent color. One reward beat. Motion budgets enforced. When everything celebrates, nothing does.

## 15. Inputs

- **Pointer**: LMB select/drag · RMB orbit/look · scroll altitude · pinch zoom · Space-drag pan · double-click travel · right-click context arc.
- **Keys**: `V` select · `H` hand · `T/C/S/B/D` table/chair/stage/bar/dancefloor · `L` measure · `N` note · `G` group · `F` focus · `⇧F` frame selection · `1–4` altitude · `⇧1–3` mesh/splat/hybrid · `[` `]` phase · `Space` tap = play/pause, hold = pan · `⌘K` command · `⌘Z/⇧⌘Z` undo/redo · `⌘D` duplicate · `⌘J` ledger · `⌘/` shortcut overlay · `Esc` exits one level (selection → tool → focus).
- **Touch (tablet, ops-adjacent)**: two-finger orbit/pan, pinch altitude, long-press context arc, drag with magnetic snap; 44 px minimum targets.
- **Voice**: the mic in the command pill accepts the same grammar — built for ops mode's dirty-hands reality, available on the Floor.

## 16. The Ledger, and access for every body

- **Ledger view (`⌘J`)**: the room as a data table — every object, its SKU, position, zone, phase, seats, checks, ops links. Fully editable; edits are the same Actions and reflect in-room live. The Ledger is simultaneously: the screen-reader surface, the power-user bulk editor, and the adoption bridge for staff who trust spreadsheets more than splats. It is not a lesser mode; it is the same truth, tabular.
- Scene rail mirrors the scene as an accessible tree (ARIA), so all spatial state is reachable without the canvas.
- Reduced motion: springs → fades, camera cinematics off, scrub morphs become crossfades. Reduced transparency: glass panels go solid.
- Color is never the only signal: status = hue + icon + label. Contrast ≥ 4.5:1 on all chrome; focus rings on everything; full keyboard operability of every panel and every verb (spatial placement included, via Ledger + arrow-key nudge).

## 17. Performance budgets (feel targets, CI-enforced)

| Metric | Budget | Notes |
|---|---|---|
| First interactive (proxy visible, tools live) | < 1.5 s | manifest + proxy cached aggressively |
| Splat visually complete | < 8 s @ 50 Mbps | progressive; interactive throughout |
| Input → visual response (drag) | < 16 ms | raycast/instancing on proxy layer only |
| Command pill open | < 50 ms | — |
| Verb command → ghost preview | < 400 ms | local solver |
| AI scheme → first ghost | < 4 s, streaming | — |
| Sustained frame rate | 60 fps with 500 instances + 2 M visible splats | M2-Air-class reference device |
| Room switch | < 2 s | adjacent-room manifest prefetch |
| Autosave | < 150 ms after idle | actions log continuously |

Budgets ship in CI as regression gates (see 03). A feature that busts the frame budget doesn't ship, however pretty.

## 18. Leaving the Floor (exits)

- **Present mode**: one keystroke strips chrome, locks to curated POVs and FOH voice — safe to screenshare with a client instantly.
- **Client share**: generates the proposal-portal view (FOH register): curated variants, hero shots, walkthrough, comments enabled; internal overlays and evidence detail excluded unless deliberately included. Watermarked; claim-guarded.
- **Exports**: 4K stills from any POV, Plan-band PDF with dimensions, evidence pack, ops handoff draft. Every export names its evidence status in the footer — honesty travels with the artifact.

## 19. Instrumentation

- North-star feel metric: **TTFW (time to first wow)** — session start → first materialize; target < 90 s for a new user on the golden path.
- Activation: ≥ 60% of new staff produce a layout with passing checks in session one.
- Engagement: ≥ 3 weekly-active planner users per venue; command-pill share of actions (adoption of P5); variant compares per proposal (should be ≥ 1 — comparing is selling).
- Quality: p95 frame time by device tier; ghost-cancel rate (high = previews mistrusted); stale-evidence dwell (how long layouts stay unverified).
- Business echo: proposal views → approvals; time from enquiry → approved proposal (leading indicator for the north star in 00 §6).

## 20. Non-goals (v1 of the Floor)

- Not a CAD tool: no wall/architecture editing (capture and semantic admin own geometry).
- No photoreal relighting promises; time-of-day light study ships later as clearly-labeled simulation (R&D lane, 03).
- No automatic legal capacity claims — guidance language only, forever.
- No VR editing; WebXR walkthrough is view-only and later.
- No public template marketplace yet; templates are per-venue institutional memory first.

## 21. Acceptance criteria (golden path, Given/When/Then)

1. Given a room with a published runtime package, when a planner opens the Floor, then proxy linework is interactive < 1.5 s and the splat resolves progressively with the status chip reading "Runtime asset loaded — not yet signed" (or current signed state).
2. Given the Objects drawer, when the planner paints a seating zone for 120, then tables fill respecting wall/route clearances, the vitals read the seated count live, and no modal appears.
3. Given a placed scheme, when the planner drags the guest-count vital 120 → 148, then reflow renders as ghosts with live clearance halos, and releasing materializes exactly the previewed state (single undo step).
4. Given phases Ceremony and Dinner with different keyframes, when the playhead scrubs between them, then the room morphs, the flip gap shows crew-minutes vs window, and "Compile flip plan" produces a pick list + sequence draft for review.
5. Given the command "will 140 fit cabaret?", when it resolves, then the answer uses planning-guidance language, summons a ghost proof, and writes no change to the plan.
6. Given any edit to a checked layout, when the edit commits, then dependent checks flip to Stale within 1 s and re-run on one click.
7. Given a client-safe share, when copy containing a forbidden claim is included, then generation is blocked with safe alternatives offered inline.
8. Given a low-end device, when the quality ladder engages, then Plan band remains 60 fps with full data parity and the user is informed once, quietly.
9. Given two collaborators, when one drags an object, then the other sees a hue-ghost within 150 ms and cannot grab it for 400 ms.
10. Given session end after ≥ 5 materializes, when the planner closes, then the peak-end orbit + delta card plays once (skippable, never repeated on quick reopen).

## 22. Open questions

- Capacity guidance authority: who maintains per-room guidance bands and their review cadence? (product + venue policy)
- Ghost visibility for clients: are "options" ghosts ever shown in the portal, or only materialized variants? (design + sales)
- SKU catalog governance: who owns furniture truth per venue — onboarding import, ops corrections, or both? (product + ops)
- Offline scope for the Floor (ops mode is offline-first; is the planner?) (engineering)
- Crew-minutes model cold start: which assumption set do we ship before post-event actuals exist? (data + ops, claim-guarded either way)
