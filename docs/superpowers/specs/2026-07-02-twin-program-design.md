# The Twin Program — Venviewer's Matterport-Rival Stack (Design Spec)

**Date:** 2026-07-02
**Status:** Draft for Blake's review (scope chosen: full program spec before code)
**Data basis:** Trades Hall Glasgow capture `TH_T9pXgB4ygNf` (verified on disk 2026-07-02)
**Governing ADRs:** D-014 (accepted — hard boundary); D-003a, D-005a, D-009…D-013, D-015 (proposed — build compatibly, do not lock in)

---

## 1. Intent

Build Venviewer's own digital-twin stack — viewer, tools, pipeline, and
extension surface — that is *superior to Matterport's offering* on our own
captured data, and that slots into the existing venue-planning SaaS. Matterport
shows a space; Venviewer plans the event inside it. The twin is not a separate
product — it is the spatial substrate under every existing planner feature
(layouts, capacity, lighting/AV/rigging lenses, proposals, hallkeeper sheets).

**"Superior" means, concretely:**

1. **No hosting ransom.** Matterport charges per-space subscription to keep
   *your own scan* online. Our data is ours, in open formats, on our infra.
2. **Planner-native.** Walk to a scan point, see the *planned layout* standing
   in the real room (chairs, stages, rig) — Matterport cannot do this.
3. **Splat-grade realism.** Free-roam Gaussian splats (Spark) beat Matterport's
   mesh-warp transitions. We already train splats from this same E57.
4. **Claim-safe measurement.** Point-cloud-backed measurement with explicit
   confidence tiers (ADR-011/015) instead of Matterport's unqualified numbers.
5. **Open extension surface.** A typed plugin API where Matterport has a
   closed SDK, so venue chains / AV suppliers can build on top.
6. **Multi-capture future.** Same viewer consumes Matterport E57 today and
   XGrids LCC (Lixel) splat captures tomorrow — capture-vendor independence.

## 2. The data reality (verified on disk)

| Asset | Location | Facts |
|---|---|---|
| Panoramas | `F:\downloads (some very important)\E57\panoramas` | 149 × equirectangular 3600×1800 JPG (~2.5 MB each, ~375 MB total). Zenith hole (scanner FOV) — viewer must crown it. |
| Poses | E57 headers; legacy `poses.json` | Quaternion `[w,x,y,z]` + translation (m); tripod height ≈1.5 m. Extraction pipeline + coordinate-basis math already exists and is documented in that folder's CLAUDE.md. |
| Laser scan | `E57\cloud_0.e57` | 19.5 GB structured, 100+ scan positions (source of truth for poses + measurement). |
| Point cloud | `mp_matterpak…\cloud.xyz` | 1.5 GB XYZ export. |
| Mesh | `mp_matterpak…` | Textured OBJ (36 MB + JPG atlas) **and a GLB ladder: 103 / 78 / 31 / 20.5 MB (`trades-hall-web.glb`)** — dollhouse-ready. |
| Splats | `E57\colmap_output` etc. | Trained PLY series up to `export_60000.ply` (~1 GB); needs SPZ conversion for web. |
| Plans | matterpak PDFs | Floor + ceiling colour plans. |
| Reference CAD | `E57\th obj`, `th.nwc` | Architect model for scale validation only. |

## 3. Product surface — five phases

### Phase 1 — **The Walk** (pano walkthrough)
Matterport's core experience, owned end-to-end.

- Stand at any of 149 scan points; look around (drag/inertia with our spring
  grammar); click a neighbouring point to move.
- **Rendering:** cube-map faces (existing `pano_to_cubemap.py` math) tiled at
  two LODs — 256px preview faces (instant) + 1024px full faces streamed per
  view direction. Three.js `CubeTexture` on an inverted sphere/box inside the
  existing R3F stack; NO new renderer.
- **Transitions:** the differentiator. Camera dollies toward the target node
  while the current cube cross-fades into the target cube pre-warped by the
  mesh depth (GLB raycast for parallax anchor). Springs, not tweens.
- **Nav graph:** offline-computed visibility/distance graph between scan
  nodes (mesh raycast for door/wall occlusion) — hand-editable JSON overrides.
- **Zenith crown:** radial gradient into the venue's dark-heritage palette —
  turn the scanner hole into a design element (same trick as The Rite).
- **Minimap:** the floorplan PDF vectorised once into SVG (or top-down GLB
  render) with scan dots + viewing cone; click-to-teleport.

### Phase 2 — **Dollhouse & floorplan**
- `trades-hall-web.glb` (20.5 MB → target ≤ 8 MB via meshopt/draco + KTX2
  texture compression) as orbitable dollhouse; smooth dive from dollhouse into
  the nearest pano node (the signature Matterport moment, ours with springs).
- Orthographic top-down floorplan mode; per-floor slicing via the existing
  section-plane machinery from the planner.

### Phase 3 — **Measure & annotate**
- Point-to-point measurement raycast against the GLB, refined against a
  server-side point-cloud sample (decimated `cloud.xyz` in a spatial index).
- Every measurement carries the ADR-011 confidence tier and the standing SAFE
  disclosure (reuse `CAPACITY_GUIDANCE_DISCLOSURE` pattern; the claim guard
  sweeps all twin copy). Planning-grade always; never "survey-certified" until
  ADR-015 certification lands.
- Annotations (pins with text/photos) stored per venue/space via the existing
  API patterns; surface in hallkeeper sheets + proposals.

### Phase 4 — **Free-roam splats (fusion)**
- Convert the best PLY (visual pick from the training series) to SPZ; render
  via the existing Spark 2.0 integration (never drei `<Splat/>`).
- Walk mode ⇄ splat free-roam handoff at scan nodes (pose-aligned, both come
  from the same E57 frame — alignment is a data guarantee, not a solver).
- This phase is the ADR-003a/005a reference implementation (base appearance +
  residual splats) but must not lock those proposed ADRs in: keep the fusion
  behind a capability flag keyed off the AssetVersion bundle contents.

### Phase 5 — **Platform: plugins, embeds, SDK**
- `TwinPluginAPI` (typed, zod-validated): register lenses/overlays/tools with
  the same contract the 11 cockpit lenses already use — the twin viewer reuses
  the cockpit lens framework rather than inventing a second plugin system.
- Public embed (`/venues/:slug/twin` share token route, mirroring proposal
  share-token patterns) + iframe embed with postMessage API.
- Ingestion adapters: Matterport E57 (done), XGrids LCC (spike — format
  research first), raw 360 photos + MapAnything poses (per ADR-010 fallback).

## 4. Architecture

### 4.1 twin-forge (offline pipeline, D-014-compliant)
A CLI (Node/TS in `tools/twin-forge/`, reusing the Python E57 scripts as-is
for extraction) that turns a capture into a **signed AssetVersion bundle**:

```
e57/panos → cube tiles (256+1024, WebP) ┐
poses → PoseFrame node (VSIR-0 shape)   ├─→ twin bundle: manifest.json (zod:
GLB → meshopt+KTX2 dollhouse            │    TwinManifest), tiles/, mesh/,
cloud.xyz → decimated measure index     │    navgraph.json, measure-index/,
splat PLY → SPZ                         ┘    splats/, SHA-256 per entry, signed
```

Runtime consumes **only the bundle** (hard D-014 boundary — same registration
flow as the existing room runtime packages at `/dev/assets/rooms`).

### 4.2 Data model (`packages/types`)
`TwinManifest`, `ScanNode` (id, pose {q,t}, roomSlug link, tier per ADR-015),
`NavEdge`, `TwinLayer` discriminated union following VSIR-0's six families
(capture / geometry / pose / base-appearance / residual / delivery) — typed
compatibly with the proposed ADR shape but versioned `twin/0` so a VSIR
revision is a migration, not a rewrite.

### 4.3 API (`packages/api`)
- `GET /twin/:venueSlug/manifest` (public, client-safe subset; share-token
  variant for embeds).
- Asset bytes from object storage/CDN (Vercel-fronted R2 recommended: ~2–4 GB
  per venue at Phase-4 fullness; Vercel static hosting alone won't carry it).
  Decision needed from Blake: R2 vs S3 vs Bunny (see §7).
- Annotation CRUD following existing enquiry/proposal route conventions.

### 4.4 Viewer (`packages/web/src/twin/`)
- `TwinViewer` R3F canvas (lazy route chunk — same bundle discipline as ever:
  the twin chunk must not load on marketing routes).
- `PanoStage` (cube tiles, LOD streaming), `WalkControls` (springs; reuse
  rite-motion's spring core, promoted to a shared lib), `NavReticle`,
  `DollhouseStage`, `MeasureTool`, `TwinMinimap`, `SplatStage` (Spark).
- Cockpit-lens-framework integration so planner lenses (Guests, Lighting,
  Rigging…) can mount inside the twin viewer — Phase 5 formalises this.

### 4.5 Truth & claims posture
All twin surfaces speak planning-grade language; provenance `measured` for
E57-derived layers; the claim guard (`findUnsupportedProposalClaim`) sweeps
every user-visible twin string by test, exactly like The Rite.

## 5. Why this beats Matterport (scorecard we will demo)

| Capability | Matterport | Venviewer Twin |
|---|---|---|
| Walkthrough | ✓ (hosted, subscription) | ✓ (owned, open formats) |
| Dollhouse | ✓ | ✓ (from their own matterpak export) |
| Measurement | unqualified numbers | confidence-tiered, claim-safe |
| Photoreal free-roam | ✗ (mesh warp) | ✓ Gaussian splats (Spark) |
| Event planning in-twin | ✗ | ✓ (the whole planner) |
| Plugin surface | closed SDK | typed lens/plugin API |
| Capture vendors | Matterport cameras | Matterport E57 + XGrids LCC + photo+MapAnything |
| Offline/export | paywalled matterpak | our bundle IS the export |

## 6. Phasing, DoD, budgets

| Phase | Definition of Done | Budget |
|---|---|---|
| 1 Walk | 149 nodes walkable at `/venues/trades-hall/twin` behind auth flag; first pano interactive < 2.5 s on 4G; node hop < 800 ms perceived; unit + e2e + visual-harness coverage | viewer chunk ≤ 250 KB gz (excl. three) |
| 2 Dollhouse | dive-in/out ≤ 1.2 s; GLB ≤ 8 MB; floorplan mode | +80 KB gz |
| 3 Measure | ±2 cm vs laser reference on 20 test edges (internal validation vs E57); disclosure on every readout | index ≤ 30 MB server-side |
| 4 Splats | SPZ ≤ 150 MB streamed; 60 fps desktop / 30 fps mobile mid-tier; walk⇄roam handoff | per existing perf harness |
| 5 Platform | one internal lens (Guests) mounted in-twin via the plugin API; public embed route with token | — |

Each phase ships through the full house chain: spec-slice → tests-first where
sane → typecheck/lint/test/build → visual harness → e2e → review agents →
tasks.md log. One phase = one implementation plan (superpowers writing-plans).

## 7. Open decisions for Blake

1. **Object storage/CDN** for twin bundles: Cloudflare R2 (recommended: zero
   egress fees, S3-compatible) vs AWS S3+CloudFront vs Bunny. Needed by
   Phase 1 (tiles ≈ 400 MB for Trades Hall).
2. **Access posture for v1:** internal/admin-flagged first (recommended) or
   public from day one on the showcase pages?
3. **XGrids LCC:** spike now (format research, no code) or defer wholly to
   Phase 5? Recommended: 1-day research spike during Phase 2 so the manifest
   format reserves the right shapes.
4. Naming: "Twin" (working name) — happy to bikeshed once, then it's frozen.

## 8. Out of scope (entire program)

- Live multi-user presence in the twin (later program).
- VR/AR headset modes.
- Automated deghosting of scanner streak artifacts (manual scan exclusion
  stays, per the pipeline CLAUDE.md).
- Re-training splats (existing PLY series is sufficient for Phase 4 v1).
- Certified/survey-grade measurement claims (ADR-015 gate stays closed).

## 9. Risks

- **Asset weight** — 400 MB tiles + 150 MB SPZ per venue: mitigated by LOD
  streaming + range requests; R2 egress economics.
- **Proposed-ADR churn** (VSIR-0 et al.): mitigated by `twin/0` versioned
  manifest + adapters, no production lock-in of proposed shapes.
- **Pose basis mistakes** (the pipeline CLAUDE.md documents the trap):
  mitigated by an automated Phase-1 test that renders a known cube face and
  asserts the scan-0 forward direction against the recorded reference.
- **Matterport ToS** on derived exports: the matterpak/E57 are Blake's paid
  exports of his own capture of his client's venue; we build on the exports,
  not on Matterport's runtime APIs. Flag for a legal review once
  commercialised beyond Trades Hall.
