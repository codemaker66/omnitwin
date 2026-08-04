# Implementation brief — Venviewer Twin: cinematic glide, floor system, mesh cleanup

> Written 2026-07-10 as a handoff for an external AI assistant (ChatGPT). The
> full text below is designed to be pasted as a single prompt. It encodes the
> architecture, the three tasks, the known traps, and the acceptance bar.

---

You are working on **Venviewer Twin** — a browser-based photorealistic walkthrough of Trades Hall Glasgow (a venue-booking product, like a luxury Matterport rival). The repo is a pnpm monorepo at `c:\Users\blake\omnitwin2`. You will implement three features. Read this entire brief before writing any code.

## Non-negotiable engineering rules

- TypeScript **strict**, zero `any`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
- React + React Three Fiber (`@react-three/fiber` v8, three r0.180, `@react-three/drei`). Zustand for state. Zod for runtime validation. Vitest for tests.
- **Springs, never tweens** for all object/camera animation (see `packages/web/src/lib/springs.ts` — `stepSpring`, semi-implicit Euler). CSS transitions are acceptable for HUD chrome only.
- The R3F Canvas runs `frameloop="demand"` — **nothing renders unless `invalidate()` is called**. Any continuous animation must run its own `requestAnimationFrame` loop or call `invalidate()` every frame while active.
- Every animation must honour `prefers-reduced-motion` (helper: `packages/web/src/twin/reduced-motion.ts`).
- Aesthetic bar: Aman/Four-Seasons restraint. Deep green-black + flame gold. No gimmicks; every motion a whisper. If a skeptic could call an effect "a swoosh", dial it down.
- Windows dev environment. Dev server: `cd packages/web && VITE_CLERK_PUBLISHABLE_KEY=pk_live_localbuildcheck pnpm dev` → `http://localhost:5173/venues/trades-hall/twin`.
- Verification bar for EVERY change: `pnpm --filter @omnitwin/types build` (if types changed), then in `packages/web`: `pnpm typecheck`, `pnpm exec eslint src/twin`, `pnpm exec vitest run src/twin` — all green — plus a **visual check in a real browser** (Playwright headless screenshots) before you call anything done. Never claim "it works" without having looked at rendered output.

## Deployment split (critical to understand)

- **Code** ships via git push to `master` → Vercel auto-deploys `venviewer.com`.
- **Assets** (`packages/web/public/twin/trades-hall/**` — `manifest.json`, pano tiles, `mesh/dollhouse.glb`) are **gitignored** and served in production from Cloudflare R2 at `twin.venviewer.com` (env `VITE_TWIN_ASSET_BASE`). Locally the same files are read from `public/`. Any asset change (manifest edits, cleaned mesh) works locally immediately but reaches production ONLY when the owner (Blake) mints an R2 API token and runs `rclone copy packages/web/public/twin r2:venviewer-twin`. Flag asset changes clearly so he knows a sync is needed.

## Architecture map — read these files first, in this order

All under `packages/web/src/twin/` unless noted:

1. `packages/types/src/twin.ts` — Zod schema for the bundle manifest. Nodes: `{id, index, pose:{q,t}, floor, roomSlug, exposure?}`. `pose.t` is E57 world (z-up, metres); scanner eye height ≈1.4–1.5 m above its floor. Manifest also carries `edges` (`{a,b,distanceM}` nav graph), `entryNodeId`, `entryLook`, `mesh`.
2. `twin-basis.ts` — ALL coordinate-frame math. `e57PointToThree([x,y,z]) → [x,z,-y]` (three is y-up). `E57_TO_THREE_QUAT`, `MESH_OFFSET_M` mount the dollhouse mesh into the same world. Do not invent new frame math anywhere else.
3. `useTwinWalk.ts` — the CURRENT movement core you will largely replace for gliding: a discrete hop state machine. `hopTo(id)` runs one spring (`HOP_SPRING {stiffness:120, damping:22}`) driving `progress` 0→1 per edge in its own rAF loop; arrival at `progress ≥ 0.995` commits the node and writes `?node=` to the URL (React Router `useSearchParams`). Teleports and reduced-motion arrive instantly. The URL is the walk's source of truth (back/forward work).
4. `TwinViewer.tsx` (~1200 lines) — composition root. Key pieces:
   - `CameraDolly` — per-frame camera position lerp `from→to` by `progress` from a mutable ref (never React state); owns yaw-toward-travel during hops (smoothstep, keeps user pitch); fov "breath" on isolated hops only (suppressed when chained within 250 ms).
   - Two `PanoStage`s during a hop: departing pano **fully opaque underneath** (renderOrder 0), arriving fades in on top (renderOrder 1) — this ordering prevents black flashes when the arriving texture is still streaming. Do not regress this.
   - `ParallaxStage` mount (desktop `pointer:fine` only, idle-gated), the `stages` map, the Usher queue (`usherQueue` state + effect that chains `walk.hopTo` per settle), the First Light rig, minimap/HUD wiring.
5. `PanoStage.tsx` — inverted-sphere equirect renderer. Exports `gradeGLSL` (linear→sRGB OETF + gentle grade — the single colour pipeline), `makeGradeUniforms`. Streams textures via `useEquirectTexture` (512 preview → 4096 base → 8192 zoom tier). While the `hopping` prop is true the arriving node holds its 512 preview and defers the ~34 MB base GPU upload to settle (this killed a 50–80 ms per-hop stall — do not regress). Per-node `exposure {gain, wb[3]}` is applied as `uExposure` in linear space before the sRGB encode.
6. `ParallaxStage.tsx` — the projective-texture stage: during a hop (0<progress<1) the dollhouse mesh is rendered with a shader that samples BOTH hop panos by each fragment's world direction from the two scan centres, blended by progress → true 3D parallax while moving. Uses `BatchedMesh` with a corridor culling radius (`PARALLAX_CORRIDOR_RADIUS_M = 8`). Invisible at rest (at a pano's own centre the projection is pixel-identical to the sphere, so the handoff is seamless by construction). You will GENERALIZE this for continuous movement.
7. `TravelControls.tsx` — click-to-travel + WASD. Picks targets via `travel.ts` `pickTravelTarget` (alignment cone: 55° for clicks, 85° for held keys, excludes the node just departed). Hold-to-walk chains hops via a continue-on-settle effect. `travel-route.ts` — Dijkstra over `edges` for the Usher (minimap click glides the real route, ≤12 hops).
8. `WalkControls.tsx` — look/zoom springs (drag yaw/pitch, wheel/pinch/keyboard fov). **On enable it adopts the camera's current pose as spring rest.** It is disabled while hopping; the dolly owns the camera mid-hop.
9. `useEquirectTexture.ts` — texture streaming + `warmEquirectBase` (GPU pre-residency for neighbours). `useTwinPrefetch.ts` — HTTP cache warming of neighbour tiles on every arrival.
10. `TwinMinimap.tsx` — SVG dot map (has existing floor-toggle scaffolding keyed on `node.floor` — audit it; until now every node had floor 0).
11. `DollhouseStage.tsx` — mesh modes (dollhouse/plan) via `useGLTF`, mounted with `E57_TO_THREE_QUAT`/`MESH_OFFSET_M`.
12. Tests live in `__tests__/` beside sources; e2e in `packages/web/e2e/twin-walk.spec.ts`. Update tests you invalidate — never delete assertions just to go green.

Known traps (all previously hit, all real):
- Sibling **effect order matters**: anything that must seed the camera before `WalkControls` adopts it must be mounted BEFORE it in JSX (see `InitialLookRig` in `TwinViewer.tsx`). `Canvas onCreated` is NOT reliable for this.
- ESLint `strictTypeChecked` includes `no-unnecessary-condition` — redundant guards fail the build.
- Unit tests run under happy-dom: no real WebGL, no real image loads (texture hooks stay pending forever — by design).
- `manifest.json` is gitignored; commit code with explicit pathspecs (`git commit -- <files>`), never `git add -A`.
- The URL (`?node=`) must not be spammed with history entries mid-motion — write it on settle only.

---

## TASK 0 (do first, ~30 min): verify continuous light actually renders

The manifest on R2 carries per-node `exposure` and `PanoStage` applies `uExposure`, but the owner reports "lighting is no different". Before building anything: load two adjacent nodes with very different solved gains (the darkest edges are around `scan_112`/`scan_093`), screenshot each with exposure applied vs forced `[1,1,1]`, and confirm a visible difference. If the uniform is not reaching the GPU (e.g. the node objects lose `exposure` between manifest fetch and prop), fix that first — Task 1's light-constancy depends on it.

## TASK 1 — Replace the hop cadence with one continuous, cinematic glide

**Problem:** movement today is press-W → 0.65 s spring hop → settle → repeat. Even with parallax it reads as "flipping through pictures". The owner wants a **continuous, stately, luxurious glide** — a camera operator walking a gimbal through the hall. No cadence, no per-step settle, no stutter, light constant throughout.

**Target feel:** hold W (or click a distant point / minimap): the camera **translates continuously** along the nav route at a cinematic pace (~1.1–1.3 m/s cruise; ease in over ~0.6 s; ease out on release), corners rounded, yaw easing gently toward the direction of travel (never snapping), fov rock-steady. Release → the glide eases onto the **nearest node** and stops there (stills must always be AT a scan centre for perfect fidelity). Reduced motion keeps today's instant teleports.

**Design (how I would build it):**

1. **New `useTwinGlide.ts`** — a velocity walker that replaces the per-hop spring for movement (keep `useTwinWalk`'s URL bookkeeping and teleport paths):
   - State: a route polyline `nodes: string[]` (positions via `e57PointToThree`), cumulative arc-lengths, scalar `s` (distance along route), scalar velocity `v`.
   - Own rAF loop while active (demand frameloop!): `v` approaches target speed via a critically-damped spring (house rule); `s += v·dt`. Derive: current segment index, segment fraction `frac`, world position (lerp), path tangent.
   - Extension while held: when `s` nears the end of the polyline, ask the input layer for the next node (existing `pickTravelTarget` with the wide cone, from the route's end node, excluding the previous one) and append it. If nothing qualifies, ease-stop at the final node.
   - Release / interruption: choose the nearest node to current `s`, ease `v` to zero so `s` lands exactly on it; commit that node (`?node=` write, prefetch, announcements). A click/Escape mid-glide also stops it.
   - Corner smoothing: don't aim the camera along the raw segment tangent; low-pass the tangent (spring the yaw target toward `atan2` of the smoothed tangent). Keep the user's pitch untouched.
2. **Rendering between nodes** — generalize what exists rather than inventing:
   - The two `PanoStage`s become "segment endpoints": pano A = segment start node, pano B = segment end node, arriving opacity = `frac` (identical to today's crossfade, just driven by the glider). On segment advance, B becomes the new A — reuse the keyed-by-node-id mounting so textures survive.
   - `ParallaxStage` already takes `currentNode`, `targetNode`, `progress` — feed it the segment endpoints and `frac`. It stays visible for the whole glide (not per-hop), which also removes the per-hop visibility toggling.
   - Texture readiness: keep the existing discipline — the arriving node holds its 512 preview during motion; `warmEquirectBase`/prefetch the NEXT segment's node as soon as a segment begins, so multi-segment glides never wait.
3. **Camera:** `CameraDolly` consumes the glider's continuous position instead of per-hop from/to. Yaw: spring toward the smoothed tangent while `v > 0`; hand back to `WalkControls` only after full stop (mind the adoption-on-enable trap).
4. **Unify the Usher:** a minimap click = the same glider fed the full Dijkstra route (`shortestRoute`). Delete the queue-of-hops effect. A second click still short-circuits (teleport). Single clicks on a visible neighbour = a one-segment glide.
5. **Do not break:** First Light (runs before any movement), look links (`?look=` camera seeding), the opaque-underneath crossfade rule, the deferred-base-upload rule, a11y announcements (announce on stop, not per segment), the coach hint, reduced-motion teleports, and the existing tests' contracts where still valid (update tests that pinned per-hop behaviour deliberately, with comments).

**Acceptance:** screen-record (or Playwright-frame-sample) a 6-second held-W run through the Grand Hall: continuous translation with zero settles; the frame-gap profile shows no main-thread stall >50 ms after the first segment; release stops exactly on a node and the still frame is pixel-sharp; lighting shows no per-node pop. The owner's test is subjective: "does it feel like a luxurious cinematic walk, not steps."

## TASK 2 — Floor system: explicit Upstairs/Downstairs

**Problem:** 149 scans span two storeys (first floor: Grand Hall + Saloon, scans ~000–080, 84 nodes; ground floor: scans 081+, 65 nodes — already written into the LOCAL manifest as `floor: 1` / `floor: 0`, derived from scan height `z > -0.5`). Users accidentally travel between floors, and the minimap is an undifferentiated dot-soup.

**Build:**
1. An active-floor state in `TwinViewer` (default = current node's floor; switching floors teleports to the nearest node of the other floor, or that floor's designated entry).
2. A quiet two-option floor switcher (e.g. "Ground · First") near the minimap, styled like the existing mode control (`twin.css` patterns; sentence case; gold active pill; `aria-pressed`).
3. Constrain wayfinding to the active floor: filter the `neighbors` fed to `TravelControls`/`NavMarkers`/`pickTravelTarget` to same-floor nodes, EXCEPT stair-adjacent edges — implement as: an edge is walkable if `|Δz| < 1.2 m` OR both endpoints share the floor; walking a stair edge flips the active floor automatically.
4. Minimap: show only the active floor's dots (keep/repair the existing floor-toggle scaffolding in `TwinMinimap.tsx`); hide the inactive floor entirely; keep the you-are-here pulse and compass.
5. Dollhouse dots: same active-floor filter.
6. Note in the summary: the `floor` values live in the gitignored manifest → production needs the owner's R2 sync.

**Acceptance:** on the first floor the minimap shows 84 dots only; WASD/click can never land on a ground-floor node except by traversing a stair edge (which flips the toggle); switching the toggle relocates you to the other storey; unit tests for the edge-walkability predicate and the nearest-node-on-switch logic.

## TASK 3 — Clean the broken mesh geometry (window/edge shards)

**Problem:** `packages/web/public/twin/trades-hall/mesh/dollhouse.glb` (7.2 MB) has classic scan-reconstruction debris: floating shards around windows/glass and torn edges (screenshot provided by the owner). They look broken in dollhouse mode and ghost during parallax motion.

**Build (offline script, Python + trimesh — both installed):**
1. Load the glb (`trimesh.load`; it's a scene — iterate its geometries).
2. Split into connected components (`mesh.split(only_watertight=False)`).
3. Drop debris: components with surface area < ~0.5 m² OR bounding-box diagonal < ~0.8 m; ALSO drop components whose centroid lies outside the building's overall bbox inflated by 0.5 m (free-floating shards). Tune thresholds by eye — print a table of component count/area before/after and iterate until the window shards in the owner's screenshot are gone while railings/furniture survive.
4. Re-export as glb. Check `DollhouseStage`'s loader first (plain `useGLTF`, no draco/meshopt extension configured) — a plain glb re-export is compatible; keep the file at or below the original size if possible.
5. Replace `mesh/dollhouse.glb`, update `manifest.json`'s `mesh.bytes` (and `contentHashes["mesh/dollhouse.glb"]` — sha256 hex — if present).
6. **Visual verify** in dollhouse mode (before/after screenshots from the same orbit angle) AND one mid-glide parallax frame (shards should no longer ghost).
7. Flag for R2 sync (asset change).

**Acceptance:** the circled artifacts in the owner's screenshot are gone; total mesh size not larger than before; the dollhouse still shows all real structure (both staircases, balcony rails); no new console errors.

## Working style expected

- Verify with your own eyes (screenshots) before claiming anything works; report failures honestly.
- Ship three separate, reviewable commits (one per task) with explicit file pathspecs; never commit `public/twin/**` (gitignored anyway) or unrelated dirty files (`App.test.tsx`/`App.css` are known pre-existing WIP — leave them).
- If a requirement conflicts with what you find in the repo, say so explicitly rather than silently reinterpreting.
