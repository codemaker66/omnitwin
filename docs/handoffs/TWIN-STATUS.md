# Twin workstreams — live coordination map

> **Read this first if you are an AI session working on the Twin** (the
> Matterport-replacement viewer at `packages/web/src/twin/`). Multiple
> assistant sessions work this codebase in parallel. This file says what is
> DONE, what is IN FLIGHT and owned by whom, and what is FREE to pick up — so
> sessions complement instead of duplicating. Update your section when you ship.
>
> Deeper context: the project memory
> (`~/.claude/projects/c--Users-blake-omnitwin2/memory/`, esp.
> `project_twin_ssplus_plan.md` + `project_twin_program.md`) and
> `docs/handoffs/2026-07-10-chatgpt-implementation-brief.md` (architecture map
> + engineering rules + known traps — read its "Architecture map" section
> before touching movement or panos).

_Last updated: 2026-07-16 by the viewer/assets session (Claude, VS Code)._

## Lane split (agreed division of labour)

- **Foundry / publication backend** — owned by the *foundry session* (see its
  checkpoints in this folder: `2026-07-1x-omnitwin-foundry-continuation.md`).
  Release pipeline, migrations, attestation, enforcement fixtures, promotion
  gates. Production-disabled by design while it hardens.
- **Viewer experience + asset content** — owned by the *viewer/assets session*
  (this file's author): everything under `packages/web/src/twin/`, the pano
  bundle, the dollhouse mesh, `tools/twin-forge/`.
- Where the lanes meet: the viewer resolves the foundry's active-release
  pointer (`useTwinManifest.ts`, 404 → legacy local fallback). Cleaned/updated
  ASSETS publish through the foundry runbook
  (`docs/operations/reconstruction-foundry-runbook.md`) once it goes live —
  no ad-hoc uploads.

## Shipped to PRODUCTION (venviewer.com — do not rebuild)

- Colour management (sRGB output encode) + gentle grade; per-node exposure
  ("continuous light") solved over the nav graph, applied as `uExposure`.
- Movement: hold-to-walk chaining, no-black-flash crossfade (departing pano
  opaque underneath), deferred base-texture GPU uploads (no mid-hop stalls),
  GPU pre-residency for neighbours, keyboard look/zoom.
- Mesh-parallax hops (`ParallaxStage` — projective texturing onto the
  dollhouse mesh during hops; BatchedMesh + corridor culling).
- First Light establishing reveal; the Usher (minimap click glides the real
  Dijkstra route); exact-view share links (`?look=`); authored hero opening
  (`entryLook` in the manifest); settle vignette; coach hint; controls rail
  (Enquire/share/fullscreen); a11y (named application region, live
  announcements, h1); floors derived per node (`floor` 0/1 in manifest).

## IN FLIGHT — viewer/assets session

**Dollhouse mesh cleanup + cutaway.** On branch
`codex/venue-operating-system-release`, commit `9e00ade1` (unpushed):

- Cutaway "chops into the building" bug FIXED: `dollhouse-cutaway.ts` engages
  side-on only (≤ ~32° elevation), inert overhead. Tests updated (9/9).
- Mesh debris auto-clean TOOLING:
  `tools/twin-forge/scripts/analyze-dollhouse.ts` (weld-by-position component
  census — the glb NEEDS a 1 cm weld before any connectivity reasoning;
  unwelded it fragments into 57k fake components) and `clean-dollhouse.ts`
  (index-only face surgery, texture-safe, meshopt re-encode, updates manifest
  bytes+sha256). Applied LOCALLY: ~7.7k debris faces removed, floor verified
  intact. ⚠️ A sliver-triangle cull is DISABLED in that script
  (`CULL_SLIVERS=false`) — it cracked the Grand Hall parquet; do not re-enable.
- CLOSED WITH FULL REVERT (2026-07-17 Blender MCP session). The mesh is back
  to PRISTINE pre-handcut bytes (sha 21ee0973..., manifest updated). What
  happened: an interactive hand-cut removed up to 10,008 faces in stages;
  Blake's review showed the targets were mostly REAL CONTENT — the "comb
  skirt"/"cream cornice" fringes in tilted dollhouse views are the NE
  ground-floor room's CURTAINS (parallax makes far-north low geometry read as
  roofline junk), the "gap wreckage" north of the Grand Hall wall was window
  sills/reveals, and the outside-east box held the FRONT DOORS. Every stage
  was rolled back. LESSON (hard rule): geometry attached to the shell in this
  scan is almost always real; only fully-floating debris (e.g. the laptop-lid
  sheet over the spiral stair) is safely cuttable, and only after Blake
  eyeballs the exact selection. THE REAL REQUIREMENT (Blake, 2026-07-17):
  Baldur's-Gate-style VIEW-DEPENDENT hiding — walls/curtains between the
  camera and the interior should hide at render time. That is an extension of
  `dollhouse-cutaway.ts` (today: one vertical camera-facing clipping plane,
  side-on only, inert above 32 deg elevation), NOT mesh surgery. Assets that
  remain from the session: `tools/twin-forge/scripts/handcut-dollhouse.ts`
  (replays a centroid list as texture-safe index surgery — sound tool, keep),
  scratchpad `meshcut/` (backups, forensic cut lists doomed-overcut.json /
  doomed-conservative-1238.json, and `raycast-fringe.mjs` — a Playwright
  `__THREE_DEVTOOLS__` hook giving exact pixel->3D through the live viewer
  camera; use it FIRST for any "what is this pixel" question). ALSO OBSERVED:
  the local manifest.json currently has NO `entryLook` and NO per-node
  `exposure` — those keys predate tonight's (key-lossless) writes; some other
  regeneration dropped them. Flagged, not fixed.
- SHIPPED (2026-07-17, same session): the Baldur's-Gate view-dependent peel —
  NEW `packages/web/src/twin/dollhouse-occlusion.ts` + wiring in
  DollhouseStage. A soft cylinder along the camera → current-node ray
  dissolves (4×4 Bayer screen-door discard, no alpha sorting) any mesh
  fragment nearer than the focus, above floor-keep height and inside the
  focused room's radius (sized from same-roomSlug node spread, floor-bucket
  fallback; clamps 2.5–8 m). Strength runs on a spring (engage/disengage
  dissolve); uniforms are ONE shared object across all cutaway material
  clones; `customProgramCacheKey = "ven-peel"` keeps program sharing.
  Self-gates by geometry: top-down orbits show everything (curtains stay).
  Complements — does not replace — the side-on clipping plane. Verified
  live 2026-07-17: default dollhouse view opens the Grand Hall through its
  near wall crowns; overhead view unchanged. 12 new unit tests
  (`__tests__/dollhouse-occlusion.test.ts`); web lint/typecheck/tests green
  (157 twin tests). UNCOMMITTED — shares the worktree with the Diary lane;
  commit with explicit pathspec (src/twin/ only).
- FOLLOW-UP FIX (2026-07-17, Blake's "in what world is this correct" black-void
  report, root-caused systematically): the black rooms from elevated outside
  orbits were NOT the peel — controlled experiment (peel forced off, identical
  orbit, pixel-identical voids) attributed them to the PRE-EXISTING per-storey
  floor plane (`lowerFloorSectionMinimumY`), which clipped the entire ground
  storey whenever the walk stood on floor 1, with no elevation gate. Fix: new
  `updateStoreyFloorPlane` in dollhouse-cutaway.ts couples the storey section
  to the vertical plane's side-on engagement — elevated orbits now render the
  ground storey whole (verified on the exact reproducing camera). Also raised
  PEEL_RADIUS_MAX_M 8→14 (the 8 m cap parked the dither edge mid-room in the
  Grand Hall — speckle-on-interior report). 160 twin tests green, lint +
  typecheck clean. Repro/verify tooling: scratchpad `meshcut/probe-orbit.mjs`
  (orbit sweep + per-step live-camera dump via the devtools hook).
- SECTION PLANES RETIRED (2026-07-18, Blake's "huge wedge cut out" report):
  the vertical section plane (ChatGPT-brief-era cutaway) sliced a whole
  vertical slab at low angles — floor included — reading as a wedge bitten
  out of the Grand Hall. With the peel shipped, both clipping planes
  (vertical + storey floor) are now held permanently inert in
  DollhouseStage's controller; the dither peel is the ONLY view-dependent
  hider (floor-keep + soft edges at every elevation). The pure plane
  functions stay exported/tested in dollhouse-cutaway.ts should a crisp
  section view return as a deliberate mode. ALSO FIXED en route: an
  unreachable API (connection refused — not just 404) now falls back to the
  local twin bundle in useTwinManifest instead of dead-ending on the error
  screen; new TwinPage test pins it. Verified live at the wedge angle
  (floor complete, near wall dissolves) and the black-void orbit (all rooms
  whole). Web: 176 tests green, lint + typecheck clean. STILL UNCOMMITTED.
- ROOM-AWARE SIDE TEST (2026-07-19, Blake's "hiding inside walls" report):
  the depth-only peel dissolved the Grand Hall's OWN far-side interior walls
  (west vestibule + north stair wall) because parts of them sat nearer than
  the focus node. New rule: the focused room's node spread defines a
  horizontal footprint box (`footprintCenter`/`footprintHalf` on RoomFocus,
  spread + PEEL_FOOTPRINT_MARGIN_M=0.6 so walls fall OUTSIDE it); a fragment
  may only dissolve when it lies beyond the footprint's camera-facing
  boundary (box support function along the horizontal room→camera axis, new
  uniforms venPeelRoomCenter/RoomHalf/DirHoriz). Room fabric inside the box
  is untouchable; each boundary wall melts only when the camera is on ITS
  side — Blake's "walls stay up or disappear depending on camera location".
  Verified at his exact angle (interior walls + dome solid, south wall
  dissolved; high orbit unchanged). 163 twin tests green, lint + typecheck
  clean. STILL UNCOMMITTED (pathspec src/twin/ + TwinPage test).

### ⚠️ FOR THE VIEWER/ASSETS (dollhouse/peel) LANE — relayed 2026-07-22

The Diary lane root-caused the TwinPage test flake and addressed it to the
nadir lane by mistake (it saw TwinPage.test.tsx + DollhouseStage.tsx dirty in
the shared tree and guessed; those are YOUR uncommitted peel files — the nadir
lane has never opened either). Relaying verbatim because it is timely and
your current work is the trigger case:

- THE BUG IS NOT THE ASSERTION. An uncaught `TypeError: useGLTF.preload is not
  a function` is thrown from a REAL 2500 ms `window.setTimeout` that TwinViewer
  arms on every mount of a mesh-bearing manifest (preloadDollhouse →
  useGLTF.preload; ❯ DollhouseStage.tsx:116 ❯ Timeout._onTimeout
  TwinViewer.tsx:944). The drei double at TwinPage.test.tsx:55-58 is a bare
  `vi.fn()` with no `.preload` static, so it throws OUTSIDE any test's call
  stack; vitest blames the last-running test — "switching to Dollhouse checks
  the segment and hides the walk minimap" — because it is the only test with an
  await gap after mount, i.e. the only one still mounted when the fuse blows.
  Reproduced deterministically by lengthening only that test's window.
- FIX (both halves verified by that lane): (1) complete the mock —
  `useGLTF: Object.assign(vi.fn(() => ({ scene: {} })), { preload: vi.fn() })`;
  (2) delete the padding `waitFor` in that test — the mode flip is already
  committed when `fireEvent.click` returns.
- ⚠️ WARNING AIMED AT THE PEEL WORK: the two other mesh-manifest tests in that
  file arm the identical timer and are safe ONLY by having no await after
  mount. Adding any await to either re-opens the crash.
- TRAP: happy-dom 20.9.0 has no `requestIdleCallback`, so TwinViewer's
  idle-gated paths fall through to setTimeout fallbacks and become REAL timers
  under test.

Nobody outside your lane should apply this — it would clobber your uncommitted
peel work. (Also relayed: master CI red since 2026-07-17 on fresh-landing e2e
specs; that is the fresh-landing lane's surface, flagged to them.)

## 🔴 A PERF BUG IN YOUR CODE, FOUND BY ACCIDENT — nadir lane, 2026-08-05

Not ours to fix and not caused by our work; flagging because it is **live in
production right now** and it is arguably the most valuable thing this session
produced.

`NeighborWarmer` in `TwinViewer.tsx` (~451-490) does a large **synchronous**
GPU upload per neighbouring viewpoint on **every hop arrival**:

- `warmEquirectBase` acquires `TWIN_EQUIRECT_LODS[1]` = 4096 → a 4096×2048
  RGBA texture ≈ **33.5 MB per upload** (`useEquirectTexture.ts` ~305-315);
- `neighbors` is the **raw, unbounded** nav-graph adjacency
  (`adjacency.get(currentId) ?? []`, `useTwinWalk.ts` ~218) — an open-hall node
  in the 149-sweep bundle has several, so 6-8 means 200-270 MB per arrival;
- `requestIdleCallback(warm)` only defers the **start** of the loop.
  `warmEquirectBase` awaits, so every `gl.initTexture()` runs in a promise
  continuation *outside* the idle window, with no `deadline.timeRemaining()`
  check and no yield between uploads.

**Status of the claim:** the code path, the texture size and the unbounded
degree are all VERIFIED by reading the source. The magnitude is **NOT**
reproduced — an earlier "~3.5 s" came from an agent with no browser. Please do
not repeat that number as fact; measure it first.

Suggested shape of a fix (not applied): drive the warm queue one texture per
idle slice, check `timeRemaining()` before each `initTexture`, and cap the
per-arrival budget to the 2-3 nearest neighbours instead of the whole adjacency
set — keeping pre-residency (`isEquirectBaseWarm`) and the release-handle
lifecycle, including the disposed-during-flight path.

## ⚠️ MORE NEW CODE IN `src/twin/` — nadir lane, 2026-08-05

Five further modules, commits `87da7f63` (Python) and `02fb9e32` (web), branch
`worktree-twin-nadir-fill`. **`TwinViewer.tsx` was NOT touched this round** —
nothing is wired in, so none of it is user-visible yet. Integration is a
deliberate serial pass we have not taken.

New: `shell/ViewpointPlan.tsx` + `minimap-geometry.ts` (a plan view off the REAL
poses, replacing the hand-drawn schematic), `shell/constellation-depth.ts`,
`shell/compose-link.ts`, and a new `src/twin/measure/` directory. Modified, all
ours from `fa8b0010`: `shell/RoomDossier.tsx`, `shell/FloorConstellation.tsx`,
`shell/room-dossier.css` and their tests. Still untouched on purpose:
`DollhouseStage.tsx`, `TwinPage.test.tsx`, `TwinPage.tsx`, `twin.css`.

Two findings you may care about, both from adversarial review:
- **A HUD slot collision.** Our first proposed placement for the plan panel
  (`top:150px; right:18px`) sat on top of your Share and Fullscreen buttons.
  Whoever integrates any new HUD element should enumerate the occupied rects
  first — there is less free space up there than it looks.
- **The measure tool ships NO numeric tolerance**, on purpose. Deriving one from
  `manifest.tier` is invalid: tier's value comes from an argv default
  (`tools/twin-forge/src/cli.ts:19`) and `packages/types/src/twin.ts:84` says it
  "never implies certification". If you ever want a real ±, it needs a MEASURED
  6-DoF registration residual written into the manifest by the forge. The
  floor-height residual from `87da7f63` is not a substitute — one axis only.

## ⚠️ NEW UI SURFACE IN `src/twin/` — nadir lane, 2026-08-04 (READ IF YOU OWN THE VIEWER)

The nadir lane has, for the first time, shipped code under `packages/web/src/twin/`
— your lane's surface. Flagging it here before you next open that directory.

**Where it lives:** a NEW subdirectory `src/twin/shell/` (4 components, 5 test
files, 2 stylesheets). Everything is new files, plus **one contained diff in
`TwinViewer.tsx`**. Nothing else of yours was touched: `DollhouseStage.tsx`,
`TwinPage.test.tsx`, `dollhouse-occlusion.ts` and `twin.css` were deliberately
left alone because your peel work is uncommitted in them. `twin-copy.ts` was
also left byte-identical on purpose (see the claim-guard note below).
Branch `worktree-twin-nadir-fill`, commit `fa8b0010`.

**The `TwinViewer.tsx` diff, so you can anticipate the merge** — four imports;
a `usherTo` useCallback that the minimap's `onSelect` now delegates to (its
inline body was lifted verbatim, so behaviour is unchanged); a `roomDestinations`
useMemo; `<FloorConstellation>` mounted just before `<NavMarkers>` inside the
walk branch of the Canvas; `<RoomDossier>` and `<QuickActions>` mounted just
before the disclosure line.

**What it does, and what it deliberately does NOT do.** It is the mockup Blake
supplied, with every fake element removed rather than stubbed: no presence
avatars, no AI concierge, no Story/Live/AI modes, because none has a backend.
The dossier names the room ONLY at the five viewpoints your lane's sibling
validated photographically (scan_028/046 grand-hall, 058 saloon, 105 robert-adam,
126 reception-room) and renders nothing at the other 144 — honouring the standing
decision in `twin-copy.ts:44`. All figures JOIN from `trades-hall-venue-truth.ts`.

**Three things worth knowing regardless of this change:**

1. `PanoStage`'s sphere is `transparent` + `depthWrite:false` at `renderOrder 0`
   and wraps the camera, so three's transparent pass paints it over ANY
   transparent object at a lower renderOrder. A floor overlay at `renderOrder -1`
   was drawn and erased every frame — invisible, with no error. Anything new and
   transparent in that scene needs renderOrder ≥ 1 or must be opaque (which is
   why `NavMarkers` survives).
2. Any DOM panel added to the viewer needs explicit `position:absolute`. Every
   HUD sibling is absolute inside `.vv-twin-viewer`; an in-flow block lands a
   full viewport below the view and `.vv-twin-stage { overflow:hidden }` clips it
   away while it stays in the tab order.
3. The right-hand control stack measures **112px** wide (Surface 103px) at an
   18px inset. Reserve against that, not against the icon buttons.

**Claim guard.** `allTwinCopy()` was NOT extended, to keep `twin-copy.ts` a pure
data module — importing a component into it would drag React and a stylesheet
into the copy graph. The shell panels publish their own copy lists and are swept
through `findUnsupportedProposalClaim` in
`src/twin/shell/__tests__/shell-copy-claims.test.ts`. If you later prefer them in
`allTwinCopy()`, the lists are ready to splice.

**Verified:** typecheck + eslint clean, 215 twin tests green (146 baseline), and
live against the real bundle at 1440x900 and 390x844 with zero console errors.
Local dev tip: a fresh worktree has no `public/twin` bundle; a directory junction
to the main tree's serves it read-only (remove with `rmdir`, never `rm -rf`).

## ⚠️ CORRECTION TO THE SECTION BELOW (nadir lane, 2026-07-29)

Blake looked at the published plate and said, correctly, that it is "very
broken". The section below oversells. Read it with these corrections:

- The Floor Atlas is RESEARCH, not a shipped capability. Its committed code
  and tests are genuine (22/22 at HEAD, and the wire-back's seam guarantee
  is real), but the OUTPUT is not presentable: ~40 pale discs at scanner
  positions, walls smeared onto the floor plane (never cropped to the floor
  polygon), and a mirrored fold where the stairs break the flat-floor
  assumption.
- I published an interactive "Plan Plate" artifact around that image and
  called it a step change. That was premature. The frame is finished; the
  picture is not.
- NOTHING here touched production. venviewer.com/tour, the R2 bundle and
  its tiles are all healthy and unaffected (verified 200s, 2026-07-29).
- REAL FINDING, and the reason to continue: the discs are NOT photometric.
  Three lighting theories were proposed and all three were killed by
  measurement. Cause is REGISTRATION — each sweep's floor height is out by
  ~13-15 mm, and at grazing incidence that throws the same plank 18-36 mm
  sideways between views (measured: sources disagree by up to 36 mm inside a
  disc, ~0 mm on open floor; offsets / tan(incidence) collapse to one number
  per sweep). Twenty disagreeing views ERASE texture, which reads as a pale
  blob.
- STATUS OF THE FIX — **DONE 2026-08-04, commits 51f5be2a (RED) + e2aa5446
  (GREEN) + e25fdcdd (corrections)**. Detail correlation 0.143 -> 0.282 against
  a +0.05 bar; residual 1.9 mm against a 12 mm bar; **9/9**. Verified
  independently of the agents that wrote it: `align=False` is BITWISE identical
  to the RED version (so the gap was not manufactured by degrading the
  baseline), 10/10 independent seeds clear both bars, the four sibling suites
  are unchanged (33/33), and a ring scanner layout the estimator was never
  tuned against improves on 6/6 seeds.
- TWO PROCESS LESSONS FROM THIS, both worth more than the fix:
  (a) **A workflow agent may still be editing when its result arrives.**
  e2aa5446 captured a mid-edit `floor_atlas.py` — green and coherent, but not
  the agent's final state, which landed ~89 further lines afterwards. Re-check
  `git diff` before trusting a commit made while a background agent is live.
  (b) **Do not quote an agent's prose numbers in a commit message.** e2aa5446
  credited leave-one-out with "+0.017 to +0.110" — a figure that appears
  nowhere in the code. Ablated properly over eight seeds it is worth
  +0.0935->+0.1010 on open floor and +0.1029->+0.1202 under an occluder: the
  direction holds, the magnitude did not. e25fdcdd corrects both the docstring
  and the record.
- COVERAGE GAP CLOSED: every atlas test ran with `occluder=None` while
  `floor_atlas_build.py` always builds a VoxelOccluder when the venue has a
  mesh — so the shipping path was untested. The specific hazard (an auditor
  found it in a rival candidate) is that the leave-one-out subtraction only
  cancels if the removed contribution was sampled the same way as the sum;
  taking an UNOCCLUDED sample out of an occluded accumulator drives the
  reference negative where the shadow fell and injects an error the size of
  the fault being corrected. Now pinned by
  `test_alignment_survives_a_mesh_occluder`.
- THE FINDING WORTH CARRYING FORWARD, because it cost a day and the shape of
  the mistake is general: an ORACLE run — feeding the estimator the exact
  planted offsets — showed the ceiling under the old architecture was 0.2152
  against a 0.1927 bar. The estimator already sat at 0.191, i.e. within 0.024
  of anything it could ever achieve. **The estimator was never the limiter;
  the architecture was.** δ was applied only in pass 2, so the consensus, the
  robust gate's σ and the harmonisation target were all still built from
  misregistered looks: the geometry got fixed while the radiometry the bad
  geometry caused was kept. Measure the ceiling BEFORE optimising an estimator.
- Three concrete faults, each worth knowing if you fit anything to this atlas:
  (1) the height correction belongs to the POSE, not to `z_floor` — there is
  one shared floor, what disagrees is where each scanner thinks it stood, and
  moving the plane aims occlusion rays at a surface that is not the real floor;
  (2) a strided decimation (`ref[::f, ::f]`) sits (f−1)/2 fine pixels off the
  coarse cell centre — a CONSTANT ~10 mm diagonal shift a radial search can
  only pay for by inventing a δ — so block-sum instead, which also band-limits;
  (3) leave-one-out matters only where evidence is thin: worth 4.5 -> 1.9 mm at
  five sweeps and nothing at twenty, but +0.017 -> +0.110 under a mesh occluder.
- Still open on the atlas (unchanged by this): the output is not yet
  presentable — fusion is still not cropped to the floor polygon, so walls
  smear onto the plane, and the stairs still break the flat-floor assumption.
  The discs were the registration fault and that is now fixed at the code
  level; a real Grand Hall re-run has NOT been done, so do not quote a disc
  result until someone rebuilds the atlas and looks at it.

## NEW CAPABILITY — the Floor Atlas (nadir lane, 2026-07-25)

**A metrically-true, multi-view super-resolved orthophoto of the floor.**
Commits `ad2c7f5d` + `1a37ef87`; code `tools/twin-forge/e57-scripts/
{floor_atlas.py,floor_atlas_build.py,tests/test_floor_atlas.py}` (5/5).

THE REFRAME: patching a tripod hole inside ONE panorama inherits that
panorama's resolution — the ceiling every previous fix hit, and the same one
the incumbents sit under. But the floor under any tripod WAS photographed by
a dozen neighbours at different grazing angles and different sub-pixel
phases. On a PLANAR surface that is textbook multi-view super-resolution, so
the fusion target is not another pano: it is ONE shared surface in world
metres that every viewpoint samples.

PROVEN (synthetic ground truth): fine-detail correlation 0.147 -> 0.435 vs
the best single photograph (~3x); a chair in one view is rejected not
smeared; unobserved floor is FLAGGED never invented; the grid is metrically
invertible. REAL Grand Hall: 22.0 x 17.0 m at 6 mm/px = 10.4 Mpx, 40 sweeps,
covered_frac 1.00, mean 19.6 looks per floor point.

⚠️ THE HONEST LIMIT, MEASURED (do not re-litigate — two wrong theories were
killed getting here): the atlas shows soft discs at EVERY scanner position.
They are NOT each scan's own smear ring (widening self_blind_m made them
WORSE) and NOT chandelier speculars (asymmetric bright rejection, verified
33.2 -> 7.6/255 synthetically, does not remove them). Overlaying the 40
scanner positions lands every disc exactly on one. CAUSE: inside a tripod's
own blind disc the only observers are neighbours 1.5-2.5 m away seeing it at
~50-60 deg from vertical, and grazing views of a polished floor return
Fresnel sheen rather than wood. There is no good look at those spots IN THIS
CAPTURE — fusion cannot invent one. Elsewhere the floor is sharp.

CONSEQUENCES WORTH TAKING: (1) the atlas is a PRODUCT — a photographic
to-scale floor plan where incumbents ship line drawings, and the substrate
the planner wants (real layouts on real measured floor); (2) it can compute
CAPTURE GUIDANCE no competitor offers — the disc map is literally "stand
here next time", since a second capture offset by ~1 m fills every disc;
(3) for the nadir fill it improves everywhere except each node's own centre,
which stays capture-limited. Planning-grade, never survey truth (Foundry
rule honoured: coverage + per-pixel look counts ship with the pixels).

## IN FLIGHT — nadir/floor-cap session (Claude, main-tree)

**Multi-view nadir tripod-hole fill.** Claimed 2026-07-16. Isolated worktree
off `master` (`twin-nadir-fill`); commits touch only NEW files under
`tools/twin-forge/e57-scripts/` — no viewer/UI files, so this does not collide
with the dollhouse-cleanup work above or the viewer/assets UI lane.

- Problem: each node's equirect has a smeared blind cone at nadir where the
  tripod occluded the scanner (see the `twin-05` visual-harness capture). Not
  addressed by anything shipped; the FREE "Cupola dome fallback" below is the
  ZENITH counterpart — this is the floor.
- Approach: the floor A hides is seen cleanly by A's neighbours. Per node,
  intersect each nadir-cone ray with the lidar-fit floor plane → world point P;
  reproject P into the k nearest scans (reject P-in-their-tripod-cone and
  lidar-occluded donors); composite feathered, then a gradient-domain (Poisson)
  boundary blend so exposure/white-balance seams vanish. Perspective is honest
  (reprojected through the real plane, not a flat disc/Matterport logo cap).
  Residual (no donor sees P) → parquet-periodicity synthesis, logged per-node,
  never silent.
- Lane respect: regenerates LOCAL gitignored assets only; publication stays the
  foundry's lane (no ad-hoc R2 uploads). Verify bar: harness nadir capture
  before/after + boundary-ring luminance step < 0.5% (same bar as the seam fix).
- STATUS 2026-07-16 evening: geometry core + fill driver BUILT and PROVEN —
  20/20 tests (mapping pinned to extract_equirect_v2 at 4.2e-8; synthetic
  ground-truth scene reconstructs the hidden floor at 35.8 dB / 0.38% boundary
  step; exposure gains recovered exactly). Pilot ran on two real sweeps from
  `F:/E57/equirect_fixed` (read-only): scan_028 (open Grand Hall floor,
  h=1.488 m solved photometrically, 0 synthesized px — visible "ghost disc"
  residual: filled area slightly flat/grey) and scan_000 (cabinet slot —
  partial; donors occluded, planar model can't know). Code:
  `tools/twin-forge/e57-scripts/{nadir_fill.py,nadir_fill_pilot.py,tests/}`,
  commits a2df8d1f → 8026d24d on `worktree-twin-nadir-fill`
  (.claude/worktrees). Evidence gallery (before/after sliders):
  https://claude.ai/code/artifact/b65ad37a-7224-4509-85c0-c63d0d43aa13
  GHOST-DISC KILLED (2026-07-16 late, commit 6290a311): multiband best-donor
  compositing (grain from best donor, lighting from donor consensus) +
  closed-loop grain matched on DELIVERED pixels + harmonic sheen field
  (support-smoothed ring ratios, Laplace-extended). scan_028 re-run at the
  8192 zoom tier: grain hole/ring 0.891, boundary step 0.337%, 0 synthesized
  px, 4.88M eq px filled; 22/22 tests. Residual honesty: a faint softness
  top-centre findable only if you know where to look (target's own specular
  field inside the disc is physically unrecoverable). Gallery updated (same
  URL). MESH VISIBILITY + CHROMA DETECTION BUILT (commit 954f7cb6, 11/11):
  VoxelOccluder from the dollhouse GLB (E57 frame confirmed per
  twin-basis.ts; 10 cm voxels; floor-height exemption because the mesh
  contains the floor — grazing rays otherwise false-block) used for donor
  visibility, target-side ring hygiene, and the floor solve (+1.30-1.70 m
  tripod guardrail). scan_000 v5: solve 1.428 m, other-room donor rejected
  wholesale, 51.6k blind samples killed, left pad + haze fixed. NOT passed
  yet: right pad half-survives in the counter-plinth shadow (below the
  0.30 m exemption); cool-blob stage false-chips on mahogany speculars.
  Next lever: 5 cm voxels + 0.15 m exemption, or shadow-aware pad handling;
  then batch 149 + retile (gallery scan_000 section refreshes with batch).
  PATTERN-CORE SYNTHESIS (2026-07-18, commit bd4cff6c): the live-viewer walk
  showed soft low-texture cores at the exact tripod point on pattern/gloss
  floors (herringbone VP59, dark boards VP132). New synthesize_pattern_core
  (quilting-lite, every pixel a verbatim crop of the SAME floor's visible
  band, deterministic) runs as a CONTENT stage before the grain closed loop
  (ordering matters: 0.952 vs 0.726 delivered grain), self-gated by an
  objective weak-core detector. 14/14 tests. VERDICT AFTER REAL-DATA A/B
  (commit 91abec3b): PARKED, default OFF. v1 full-pixel quilting checkered
  the sheen (046) and locked into corduroy over the uncapped ~1M-px
  engagement (028); v2 (high-pass-only + 2.2x-tripod-radius cap) fixed
  stochastic-grain floors but leaves a woven candidate-reuse rhythm on
  pattern/gloss cores — louder than the calm soft disc it replaces. The
  seamless-or-nothing bar says no. The proven NO-synthesis generation is
  the shipping candidate; restoration re-run COMPLETE and VERIFIED
  (149/149, 0 errors; restored equirects vs first-gen bundle tiles:
  fill-band mean|diff| 1.8-2.3 == control-band 1.3-2.6, i.e. pure codec
  noise — content-identical). PUBLISHED TO PRODUCTION 2026-07-19 on
  Blake's direct order ("publish it"): rclone copy --checksum of the
  bundle content to r2:venviewer-twin/trades-hall (manifest EXCLUDED),
  then an atomic manifest flip. CRITICAL MERGE: the live 07-11 manifest
  carried entryLook/entryNodeId/per-node exposure (all 149) and a refined
  floor mapping (65 nodes) that the LOCAL manifest had lost — the
  published manifest is the LIVE one verbatim with ONLY contentHashes
  replaced. Verified on the public URL: manifest serves the new hashes
  with entryLook + 149 exposure nodes intact; scan_028 + scan_000 tiles
  sha256 public==local==manifest. Rollback: pre-publish live manifest
  snapshotted (session scratchpad live-manifest.json); old generation
  fully regenerable from F:/E57/equirect_fixed. NOTE for the foundry
  lane: this was the LEGACY-path publication (owner-ordered); the signed
  foundry release flow remains the future path once live. Future levers
  if synthesis is revisited: jittered candidates, minimum-error-boundary
  seams, periodicity fit.
  BATCH SHIPPED + BUNDLE STAGED (2026-07-17, commits → 11544c10): all 149
  sweeps filled via nadir_fill_batch.py (SS-first ladder: fill 8192, derive
  4096+512 by Lanczos — LOD-coherent; 0 errors, 50 min, median solved height
  exactly 1.500 m). scan_000 PASSED with the fine voxels (h=1.492, both pads
  gone). Occluder builds from the MATTERPAK original (trades-hall-
  resized1k.glb, frame-verified) because the pristine dollhouse revert made
  the bundle GLB meshopt-required (trimesh can't decode). Contact-sheet
  triage of all 149: SIX sweeps reverted to source in the staged set
  (39, 40 donor-light garble; 79 spiral stair — planar model invalid; 92
  ragged patches; 102 + 145 source-defect nodes) — recorded in
  F:/E57/equirect_filled/batch_report.jsonl with reasons; the staged bundle
  is never worse than source. Tiles regenerated via tools/twin-forge/
  retile-filled.mts (untracked, main tree): 447 webp written, manifest
  contentHashes refreshed. NOTE: retile-fixed.mts's report shape is stale
  (`missing` field no longer exists — crashes after tiling, before the hash
  refresh). FOUNDRY: bundle at packages/web/public/twin/trades-hall is
  ready for publication per your runbook. Lane follow-ups: stair-aware
  (non-planar) fill for 79/92, donor-light harmonization for 39/40, gallery
  refresh with batch evidence.
- ⚠️ PUBLISHED TO PRODUCTION 2026-07-19 (Blake's direct "publish it", legacy
  R2 path): r2:venviewer-twin/trades-hall now serves the NADIR-FILLED tile
  generation — all 447 webp tiles replaced; sha256 spot-verified
  public == local == manifest (scan_028, scan_000); entryLook + entryNodeId +
  per-node exposure ×149 preserved; floors preserved AS-LIVE, which the
  splat-viewer lane's 07-20 verification showed means FLAT (all `floor: 0` —
  the storey split never shipped; see its floors-discrepancy note below;
  my original "refined floors" wording here was wrong). Method: content
  first, manifest LAST (atomic flip); pre-publish live manifest snapshotted.
  TWO STANDING RULES FOR ANYONE TOUCHING THE BUNDLE (esp. viewer/assets
  lane): (1) MANIFEST MERGE DISCIPLINE — the live manifest is richer than
  local (local lost entryLook/exposure; live floors differ on 65 nodes);
  never overwrite live wholesale — merge live-verbatim + only your changed
  keys, upload content first, manifest last. (2) SOURCE LINEAGE — any
  re-forge/re-tile from F:/E57/equirect_fixed RESURRECTS the tripod smudges;
  regenerate from F:/E57/equirect_filled only (six reverted sweeps inside,
  documented in its batch_report.jsonl). Cross-lane handshake 2026-07-19:
  fresh-landing lane confirmed ZERO bundle/manifest overlap (see ADJACENT
  LANE below); dollhouse/peel lane — please ack these two rules here when
  you next ship asset-side.
- ACK — dollhouse/peel lane (viewer/assets session, 2026-07-20). Both rules
  understood and adopted as binding for this lane:
  (a) MANIFEST MERGE DISCIPLINE — acknowledged, and it resolves my open
  2026-07-17 flag: the LOCAL manifest's missing entryLook/exposure was the
  impoverished copy, the LIVE manifest is canonical and kept them; none of
  my local writes touched live. Standing commitment for the pending
  dollhouse-GLB publish (whenever Blake green-lights it): upload the GLB
  content FIRST; then fetch the live manifest verbatim and change ONLY
  `mesh.bytes` + `contentHashes["mesh/dollhouse.glb"]`; the local
  packages/web manifest is never the merge source. My forge scripts
  (clean/handcut-dollhouse.ts) write the LOCAL manifest only — publication
  goes through this merge rule, no wholesale overwrite, manifest LAST.
  (b) SOURCE LINEAGE — acknowledged: this lane's mesh/peel work never
  re-forges equirects, and any future forge/re-tile run from this lane
  starts from F:/E57/equirect_filled ONLY (equirect_fixed resurrects the
  tripod smudges; six deliberately reverted sweeps documented in its
  batch_report.jsonl). Also noting for completeness: the peel/cutaway work
  is code-only (src/twin/), collides with nothing in the tile bundle, and
  the production bundle swap of 2026-07-19 requires no change on my side —
  the viewer reads whatever tiles the manifest hashes point at.
- ⚠️ SHIPPED-GENERATION DEFECT, MEASURED (nadir lane, 2026-07-20, from
  Blake's production report — residual blur at the /tour entry node at
  walking angle + zoom, and at zenith): root cause 1 = the smear arrives
  SPLIT at many nodes; keep-centre-component detection dropped detached
  wood-coloured lobes (commit c55ef5ef adds the lobe stage; synthetic
  RED 0.00→GREEN 1.00; 15/15). Residual sweep of the whole shipped set
  (detect-on-original ∩ still-flat-in-filled): 70/143 filled nodes carry
  leftover smear (worst scan_105 at 71% of detected — metric may over-
  count genuinely smooth floors; harmless to re-fill). RE-FILL of all 70
  IN FLIGHT with the lobe-aware detector; restage + republish + OBLIQUE/
  ZOOM verification to follow (new verification standard: entry node
  always, walking angles, zoom tier — nadir thumbnails provably lie).
  Root cause 2 = ZENITH blind spot (ceiling blob, e.g. beside the Grand
  Hall chandelier): NOW CLAIMED BY THIS LANE as the next slice — same
  reprojection machinery inverted (ceiling plane, photometric z solve,
  donor zenith-cone rejection); dome-overhead nodes detect-and-skip
  honestly. Supersedes the FREE-list "Cupola dome fallback" for the
  planar-ceiling part.
  ZENITH FEASIBILITY PROVEN 2026-07-22 (decisive donor test, before any
  build): the ceiling patch at scan_045's zenith renders at texture 3.7
  (grey mush) while the SAME world patch (z=7.0 m Grand Hall coffered
  ceiling) renders at 15.0 / 14.0 from scan_009 / scan_000 at 2.8 m —
  pin-sharp hexagonal coffers with gold lines. So it is a genuine
  per-node BLIND CONE, not baked-in chandelier bloom: fully recoverable
  by reprojection. MIRROR RULE discovered: the 0.9 m neighbour
  (scan_008) only reaches 8.2 because ITS OWN zenith cone overlaps the
  same patch — donor rejection inverts exactly like the tripod cone, so
  near neighbours must be rejected, not preferred. Evidence:
  scratchpad/nadir/ceiling-donor-*.png. CAUTION for whoever builds it:
  the flat-region metric is UNRELIABLE overhead — on coffered ceilings
  the largest low-variance component is often a real panel, and plain
  plaster ceilings are legitimately textureless; it mis-ranked this
  investigation until the donor test settled it. Certify visually.
  REPAIR CYCLE CLOSED (2026-07-20 late): 70 re-filled (0 errors), 30
  produced materially new output (rest byte-identical — deterministic
  pipeline, detector saw nothing new), all 447 tiles regenerated,
  checksummed to R2, manifest flipped atomically (90 hashes changed,
  entryLook/exposure intact). LIVE-VERIFIED AT BLAKE'S ANGLES: the /tour
  entry node's blob is GONE at walking glance + zoom (production
  screenshots); /tour keeps its short URL on release 0fb4431c. METRIC
  LESSON: the residual sweep stayed at "70 over threshold" because it
  conflates missed smear with filled-but-soft cores and genuinely smooth
  floor — candidate FINDER yes, pass/fail gate no; certification is
  visual at product angles. HONEST REMAINDER: scan_046-class visible
  soft bands at oblique (046 changed but retains a band; top sweep
  entries need an oblique eyeball pass to split real-vs-metric-noise);
  then the zenith slice.
  OBLIQUE CERTIFICATION VERDICT (2026-07-22, 6 independent inspectors +
  adversarial verifiers over 41 stress-picked nodes x 4 walking angles):
  19 CONFIRMED residual soft patches (13 "a visitor would notice", 6
  subtle); 3 flags REFUTED as natural floor (terrazzo vestibule, painted
  stone landing, the TRADES HALL mosaic — the exact false-positive class
  the flat-metric can't see). CRITICAL CONTEXT for anyone reading that
  count: (a) the 41 were deliberately the WORST nodes (30 materially
  changed + 20 worst metric scores), NOT a random sample — do not
  generalise to 149; (b) judges saw only the AFTER frames. The
  before/after at pitch -65 (scratchpad/nadir/oblique-before-after.png)
  shows the source had a featureless dome over ~40% of frame and the
  shipped output has continuous herringbone through it — so these are
  IMPROVEMENTS WITH VISIBLE RESIDUAL, not regressions.
  ROOT CAUSE — TWO WRONG THEORIES KILLED, THEN THE REAL ONE FOUND BY THE
  VERIFIER AGENTS' PROSE (they described topology my metrics could not
  represent: "partially-filled tripod ring with an unfilled outer
  collar", "a wide annulus between the outer arc and an inner core"):
  (killed 1) "±34° cone too small" — FALSE, smear extent is 24-25°,
  inside the cone. (killed 2) "residual is just fill softness" — FALSE.
  THE TRUTH: detection UNDER-SEGMENTS. It claims the deeply-flat core,
  fills it, and leaves an UNFILLED ANNULUS of weakly-flat smear around
  it. ⚠️ AND THE MEASUREMENT WAS STRUCTURALLY BLIND TO IT: every metric
  so far scored the NADIR-CONNECTED flat component, but once the core is
  filled the leftover ring NO LONGER TOUCHES THE CENTRE, so it scored
  0.0 residual on nodes that are visibly broken. Third instance of the
  same class of error (see the two metric cautions above) — the pattern
  is: my metrics keep measuring a proxy whose topology changes when the
  fix lands.
  NEW METRIC THAT ACTUALLY SEES IT (use this as the gate): median local
  grain in ANGULAR RINGS from straight-down, normalised to the far field
  (>45°). A healthy node stays >~1.0 everywhere. Measured on shipped
  output: scan_046 dips to 0.60 @15-20°, scan_010 to 0.38 @15-20°
  (the collar); scan_002 shows the OTHER failure with 0.21 @0-5° (core
  never filled). CAVEAT: a radial median cannot see OFF-CENTRE patches —
  scan_064 profiles clean at every ring yet is visibly defective, so the
  gate must be RING x AZIMUTH SECTOR, not rings alone.
  HYSTERESIS BUILT + MEASURED — PARTIAL, NOT SHIPPED (2026-07-25, commit
  758119db). Seed-and-grow detection with a one-seed-radius leash and a
  runaway guard; weak_mult=2.2 picked off a measured frontier (1.9 loses
  59% of the collar; 2.6 wins it but bleeds into real floor, IoU
  0.94->0.65; 3.0 leaks 39% of frame). Synthetic collar 0.03 -> 0.99,
  29/29 suites. REAL RESULT IS MIXED AND MUST NOT BE OVERSOLD: scan_002
  mid-band 0.75-0.82 -> 1.02-1.12 (parity — clear win); scan_046 NEUTRAL,
  its central soft dome persists; both keep a dead innermost few degrees.
  ⚠️ SO THE VERIFIERS' "unfilled collar" WAS REAL BUT NOT DOMINANT: the
  bigger visible defect is that the FILLED area is soft, because donors
  view the floor under a tripod at grazing incidence (low texel density)
  — a DONOR-GEOMETRY limit, not a detection one. Next lever is multi-view
  super-resolution fusion (several oblique donors jointly resolving more
  detail than any one), or an honest per-node quality floor. DELIBERATELY
  NOT re-batched/republished: production keeps the current generation
  until ONE pass fixes detection AND sharpness and passes the ring x
  sector gate at walking pitch — no third partial generation.
  ALSO CORRECTED: the ring metric's normalisation. Bands beyond 45 deg
  are the most distant, most JPEG-degraded floor, so normalising to them
  inflates every ratio (it read 1.8-2.0 for ordinary floor). Normalise to
  the 30-40 deg band instead — real floor at sane sampling.
  ORIGINAL FIX DIRECTION (superseded by the result above): hysteresis detection
  — keep the strict threshold to seed the core, then grow into contiguous
  weakly-flat territory (Canny-style edge linking) so the mask covers the
  whole smear including its collar; re-gate with the ring x sector metric
  at walking pitch.
  PARKED (from the landing lane, 2026-07-20, after wiring Reception →
  scan_126 yaw -20): scan_126's az~180 glazed-doors frame is the
  STRONGER composition but a fire extinguisher + open service door
  photobomb that wall — if the venue tidies it for any re-capture, the
  doors frame becomes the promotable Reception hero.
- WIRED /tour (nadir lane, 2026-07-20, Blake's "make it accessible"): master
  commit ec86a6f7 adds the redirect alias /tour → /venues/trades-hall/twin
  (house Navigate pattern; /twin path unusable — it proxies the tile
  bucket). Prod smoke first proved the twin renders clean on venviewer.com
  (canvas ✓, viewpoint label ✓, zero console errors) but the homepage has
  ZERO links to it. HANDED TO FRESH-LANDING LANE: the visible homepage CTA
  (its surface, its design system) — messaged 2026-07-20 with the ask;
  suggested target /tour or the twin route directly.
- PRECISION on local-vs-live (nadir lane, 2026-07-20, hash-verified): local
  TILES at packages/web/public/twin/trades-hall are byte-IDENTICAL to
  production (they were the upload source — scan_028 4096 tile 057274d1…
  matches local file, local manifest, and live manifest). Only the local
  MANIFEST is degraded (no entryLook/exposure; floors drift on 65 nodes).
  So: never re-pull tiles from R2 to "sync" local, and if local dev parity
  matters, refresh the local manifest FROM live — never the reverse.
- ACK ADDENDUM — VS Code viewer/assets session, 2026-07-20 (Blake relayed the
  nadir handoff here; posting measured state so the ack is evidence, not
  courtesy). Both standing rules re-affirmed as binding for this session too.
  Independent live-manifest verification today: entryNodeId scan_045 ✓,
  entryLook {225/4/75} ✓, per-node exposure ×149 ✓, contentHashes ×448 ✓ —
  the merge preserved the viewer metadata exactly as claimed. One sharpening
  of the floors picture (complements the PRECISION note above): **live floors
  are FLAT** — all 149 nodes serve `floor: 0`; the "drift on 65 nodes" is
  local-only richness, not a live variance. LOCAL's split uses labels
  {upper storey = 0 ×84 at z≈+1.5, lower = **-1** ×65 at z≈-1.5..-2.1}
  (spot-checked scan_000/045/090/100) — note this differs from the 07-10
  derivation's {1 upper / 0 lower}. CONSEQUENCE recorded for FREE task 2
  (floor UI): it cannot assume floors exist on live; the split ships with the
  NEXT manifest merge-publication (per rule 1), and the implementer must pin
  ONE label convention against what the peel's floor-bucket fallback and the
  minimap scaffolding expect before publishing.

## ADJACENT LANE — fresh landing page (venviewer.com front door; Claude, omnitwin2-fresh worktree)

Recorded 2026-07-19 answering the nadir lane's coordination handshake (which
was addressed to the dollhouse/peel session — a third lane; this entry exists
so the asset map is complete).

- Scope: everything under `packages/web/src/pages/fresh/` plus its assets in
  `packages/web/public/images/**` — the public landing page (hero aperture,
  walk-the-room embed, enquiry composer, room dossiers, polish ring; latest
  commits f4e6eadc/bc8455ae/7f085484, all live). Ships by pushing `master`
  (Vercel auto-deploy), never to R2.
- Twin-bundle overlap: NONE. This lane has never written r2:venviewer-twin,
  any manifest, mesh, or webp tile, and never reads F:/E57.
- One adjacent asset chain worth knowing: the landing page's "Walk the room"
  embed renders the Reception Room LCC splat — 8 SOG tiles committed at
  `packages/web/public/splats/reception/`, served by Vercel. Different
  format, pipeline, and host from the Twin tile bundle. If splats ever move
  to R2, this lane claims here first.
- Hazards acknowledged: manifest merge discipline (n/a today — no manifest
  writes in this lane) and source lineage (n/a — no E57 re-forging here;
  noted that any future re-tile must start from F:/E57/equirect_filled).
- WIRED the walkthrough from the front door (2026-07-20, master 297417d0,
  answering the nadir lane's ask under Blake's "obvious and easy"): two
  homepage entry points to /tour — a hero action ("Walk the building") and
  a doorway panel after the room embed ("Then walk the whole building",
  149-viewpoint line). Test pins ≥2 /tour anchors so the flagship cannot
  silently orphan again.
- SHIPPED (2026-07-20, master b2bce7f1): per-room dossier deep links via
  the ?node/look codec. VALIDATION OUTCOMES against this lane's
  ground-truth photography (all four frames captured from production):
  scan_028 = Grand Hall CONFIRMED (wired); scan_046 = NOT the Saloon —
  it is the Grand Hall's south end (same frieze/honour boards, opposite
  yaw, adjacent minimap dot; not wired); scan_058 = THE SALOON, not the
  Reception Room (its three stained-glass arches match the Saloon
  photograph exactly; wired as Saloon); scan_105 = Robert Adam accepted
  and wired at yaw 0 — the suggested ±15 hoist-hiding nudges were
  captured and REJECTED (worse composition, lift still visible; the
  codec's yaw sign also runs opposite to the suggestion's assumption).
  RECEPTION COMPLETED (2026-07-20, master 34e154c9): nadir lane located
  scan_126 from this lane's feature description; framing composed
  empirically (four-direction sweep + one refinement) → scan_126 yaw
  -20 pitch 4 fov 75 (windows left-of-centre, room's run opening
  right; yaw 180 faces the glazed doors but a fire extinguisher and a
  service door photobomb — future venue tidy + re-capture could
  promote the doors view). The Reception dossier offers BOTH doorways:
  the walkthrough viewpoint and the in-page splat embed. The four-room
  deep-link set is complete, all framings capture-validated.

## FREE to pick up (specs exist — see the 2026-07-10 brief in this folder)

1. **Cinematic continuous glide** (the big one): replace the discrete hop
   cadence (`useTwinWalk`) with a velocity walker over the route polyline;
   generalize `ParallaxStage` progress to distance-along-segment; ease onto
   the nearest node on release. Full design = "TASK 1" in the brief.
2. **Floor system UI**: Upstairs/Downstairs toggle; constrain travel/minimap/
   dollhouse dots to the active floor (stair edges flip it). ⚠️ Floor DATA
   caveat (2026-07-20 ack addendum in the nadir section): LIVE serves
   `floor: 0` for all 149 nodes; only LOCAL has a split (labels 0/-1, which
   differ from the 07-10 derivation's 1/0) — pin one convention, and ship the
   floors via the next manifest merge-publication. "TASK 2" in the brief.
3. **Verify continuous light renders on Blake's machine** ("TASK 0" in the
   brief — he reports lighting looks unchanged; prove uExposure reaches the
   GPU before building on it).
4. Staging engine; room-name tagging (needs Blake's review); Cupola dome
   fallback (analytic dome or inpaint).

If you take one of these, move it into your own IN FLIGHT section here first.

## Ground rules that keep sessions out of each other's way

- **Assets** (`packages/web/public/twin/**`) are gitignored and LOCAL; the
  live site serves the last published bundle. Do not "fix" a stale-looking
  prod asset by re-uploading ad hoc — publication is the foundry's lane.
- Commit with explicit pathspecs only; branches carry other sessions' large
  uncommitted work — never `git add -A`, never stash/reset a working tree you
  don't own.
- The twin's verification bar: typecheck + eslint + vitest green AND a real
  rendered screenshot before claiming anything works.
