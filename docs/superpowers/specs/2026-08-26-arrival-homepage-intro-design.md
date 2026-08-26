# The Arrival — live fly-in homepage intro (design)

**Date:** 2026-08-26
**Status:** Approved in brainstorming; awaiting implementation plan
**Decided with Blake:** lane = live 3D intro (not video, not AI generation); placement = replaces the venviewer.com homepage hero; explode target = Twin mesh floors via the existing peel system.
**Supersedes/advances:** the hero direction of `2026-07-09-living-hall-landing-plan.md` ("page is the product") and the arrival beats of `2026-07-01-landing-rite-redesign-design.md`. Non-hero sections of /fresh are untouched by this spec.

## 1. Intent

venviewer.com opens from the sky. The visitor arrives high over live photorealistic Glasgow, the camera dives the same path Blake flew in Google Maps, and lands on the Trades Hall facade (85 Glassford Street — green dome centered). At arrival, Google's melty close-range photogrammetry crossfades into our own sharper Twin capture — the pitch made visible: Google Earth stops at the roof; Venviewer goes inside. Clicking the Hall explodes it into drifting labeled storeys; a storey opens the Twin walk, and "Plan this room" opens `/plan`. The same scene, screen-recorded, becomes the marketing video — one build, both deliverables.

### Why not the alternatives (evaluated and rejected)

- **Per-frame image generation over the recording:** no temporal coherence; streets shimmer frame-to-frame. Rejected.
- **AI video generation:** current models hallucinate urban geography under camera motion — invented closes and wrong roofs in a city our audience knows. Rejected for geometry; acceptable later only for deterministic finishing (grade/upscale) of captured footage.
- **Google Earth Studio re-shoot:** better easing than a hand-flown recording, but stays a non-interactive video, commercial licensing is restrictive, and the melty final approach is unfixable there. Rejected as the destination (fine as a throwaway pitch asset if ever needed).
- **Polishing the existing 9.37 s recording:** lowest ceiling (1080p source, hand-flown motion, melty finale). Rejected as the product path; the clip remains reference material for the camera rail and marketing.

### Source-footage facts (probed 2026-08-26)

`D:\Davinci exports\trades hall zoom in 2.mov` — 9.37 s, 1920x1080, 60 fps, H.264 62 Mbps, DaVinci Resolve export, no Google UI chrome, letterboxed. Path: city-wide establishing shot over the Clyde → dive → settle on the Glassford Street facade. The final ~2 s hold static on the building — that hold is the handoff moment the design builds around. Reference frames extracted during brainstorming (scratchpad, disposable).

## 2. The shot — three acts

**Act I — The world.** Page loads with the camera already high over Glasgow: live Google Photorealistic 3D Tiles streaming into our own R3F canvas. Headline/lede are DOM overlay, readable immediately (SEO and a11y independent of WebGL). When tile resolution at the start pose crosses a readiness threshold, the dive begins automatically: a keyframed camera rail recreating the recording's path with deliberate easing, ~8–10 s. A quiet "skip" affordance jumps to the settled state.

**Act II — The reveal.** Camera settles on the recording's final framing. The Twin dollhouse mesh — georeferenced into the tile world — crossfades in over Google's version of the building, noticeably sharper than the world around it. The peel system ships as-is (see §4). A quiet pulse invites: "Open the Hall."

**Act III — The explode.** Click: storeys separate vertically on spring physics (springs, not tweens — standing feedback rule), each with a DOM-anchored label (Grand Hall, Saloon, Reception Room, Robert Adam Room…). Interactions: click a storey → Twin walk for that area; "Plan this room" → `/plan`. A close affordance reassembles the Hall (springs reverse). Below the hero, the rest of /fresh (rooms, rates, working enquiry form, footer) is unchanged.

Reduced motion (`prefers-reduced-motion`): no flight, no explode animation — the settled arrived state renders directly, explode becomes an instant cross-dissolve to the separated state. Pointer-following visuals, if any, stay live per the standing reduced-motion/pointer rule.

## 3. Architecture

New module `packages/web/src/pages/landing/arrival/`:

| Unit | Responsibility |
| --- | --- |
| `ArrivalHero.tsx` | Owns the hero `<Canvas>` + DOM overlay (headline, labels, skip, attribution slot). Nothing outside the hero. |
| `GoogleTilesStage.tsx` | `<TilesRenderer>` from `3d-tiles-renderer/r3f` + `GoogleCloudAuthPlugin` (session tokens) + `TilesAttributionOverlay` (required credits). Key from `VITE_GOOGLE_MAPS_TILES_KEY`. |
| `camera-rail.ts` | Pure math, no React: geodetic keyframes → ECEF → scene-space poses; eased interpolation; exported types for tests. |
| `HallHandoff.tsx` | Crossfade orchestration between the tile building and the georeferenced Twin mesh (opacity ramp + readiness gating). |
| `ExplodedHall.tsx` | Storey explode: per-chunk storey bucketing (chunk centroid world-Y against storey boundary heights derived from the twin manifest's `node.floor` buckets — the scan poses per storey give the boundary Ys; no new hand-tuned height table), springed Y-separation. Reuses dollhouse/peel modules unmodified. |
| `arrival-store.ts` | Zustand phase machine: `loading → flight → arrived → exploded` (+ `fallback`). Frameloop `always` only during flight/explode animation; `demand` otherwise. |

**Coordinate strategy.** Google tiles are ECEF (Earth-centered meters; Glasgow ~3.9e6 m from origin — Float32-hostile). Use the renderer's supported pattern of keeping the camera near origin and transforming the globe group. The Twin mesh joins the tile world through ONE measured anchor — lat/lon/alt + heading — calibrated manually against the rendered tiles once and stored as a named constant with provenance (same discipline as the Twin's FACE_TO_CUBE table). No second alignment constant may be introduced (two truths → visible misalignment; the FloorConstellation floor-datum rule generalizes here).

**Library (verified via Context7, 2026-08-26).** `3d-tiles-renderer` (NASA-AMMOS) provides the R3F components, `GoogleCloudAuthPlugin` (handles Google's session-token flow and per-tile attribution collection), and `TilesAttributionOverlay`. Exact package version and its three.js peer range to be pinned at install (web is on three 0.180.0, R3F 8.18.0).

## 4. Constraints carried in from the codebase

- **Peel is settled.** The dollhouse per-triangle facing split (dollhouse-peel.ts) is the product of three measured rounds — the explode must move whole chunks and never touch material sidedness or the facing split. The absence instrument re-runs after explode wiring as a regression gate.
- **Demand frameloop discipline.** The planner's `frameloop="demand"` conventions apply outside animation phases.
- **Spark is absent from this scene.** The hero is mesh-only; no splats, so no Spark render-target constraints apply. If a splat ever enters the hero, `.claude/gotchas/spark-render-target-effects.md` triggers.
- **StrictMode/WebGL context-loss gotcha** from the Rite work applies to any hero canvas mount/unmount handling.
- **Naming:** module and copy use House/Floor vocabulary ("the Arrival", "Open the Hall"); no new cockpit names.

## 5. Data & dependencies

- **Google Maps Platform API key (Blake):** Map Tiles API enabled, billing on, referer-restricted to venviewer.com + localhost dev origins. Env: `VITE_GOOGLE_MAPS_TILES_KEY` (Vercel + local `.env`).
- **Twin asset hosting (blocking for production):** the dollhouse bundle currently serves locally only (known R2 blocker). Shipping the hero publicly requires hosted assets. Plan must include: measure the mesh bundle; if heavy, cut a decimated hero LOD; stand up hosting (R2 or equivalent) before launch.
- **Licensing/pricing (verify before production wiring, not assumed):** Map Tiles ToS for homepage use; whether recording a marketing video from our own tiles-powered app is permitted; current pricing SKU and free-tier limits. Attribution overlay ships regardless.

## 6. Failure & fallback

Single fallback for every failure class — poster-tier device, `prefers-reduced-motion` when WebGL also unavailable, WebGL unavailable/context loss, missing/invalid API key, quota exhaustion, tiles network failure mid-flight: **fade to the current sandstone hero image**, which remains in the DOM as the base layer. The live scene is strictly progressive enhancement; the page never breaks and never blocks on the canvas. Mid-flight network failure holds the last rendered frame briefly, then fades to the still. The 9.37 s clip is NOT a runtime dependency.

## 7. Testing

- **Unit (Vitest):** camera-rail interpolation and geodetic→ECEF conversion against fixture coordinates; storey bucketing against synthetic chunk centroids; phase-machine transitions including every failure → `fallback` edge.
- **E2E (Playwright, established GPU recipe):** serial, per-file invocations, no page.evaluate after heavy readback; preview-mode recipe for deterministic phases; skip/reduced-motion paths asserted in DOM.
- **Visual:** `visual-check` harness stills per phase (loading/flight/arrived/exploded/fallback); `frame-budget-pass` on the hero; dollhouse absence instrument re-run post-explode as the peel regression gate.

## 8. Out of scope (v1)

Free-roam globe controls; audio; scroll-scrubbed camera; multi-venue anchors; in-scene 3D text (labels are DOM-anchored); any change to non-hero /fresh sections; AI enhancement of any footage. The marketing video is a capture session run after v1 lands, not a feature of the page.

## 9. Milestones (est. 4–6 sessions)

1. **M1 — The world:** tiles stage + camera rail flying the recorded path; skip; fallback skeleton.
2. **M2 — The reveal:** Twin mesh georeferenced anchor + crossfade handoff.
3. **M3 — The explode:** storey bucketing, springs, labels, Twin-walk and `/plan` CTAs.
4. **M4 — Armor:** full fallback matrix, tests, frame budget, absence-instrument gate.
5. **M5 — Ship & shoot:** polish/grade pass, production key + hosting wiring, marketing capture from the live scene.

Milestone-level acceptance: each milestone leaves `pnpm typecheck / test / build` green and the live /fresh page functionally unchanged for non-hero content.
