# The Real Hall — design (T-639)

Date: 28 September 2026. Owner: Claude (T-639). Status: direction approved by Blake on 28 September 2026.

Blake's decisions, 28 September 2026:
- Direction: "Yes, first slice" — build the Real Hall, starting with the first slice below.
- Furniture: "Site day, Claude models all" — one site day to photograph and measure the real furniture; Claude models every piece (no freelance artist).
- Judging: "Private preview links" — the new stage may run on preview deployments, never on venviewer.com, while the public Gaussian-splat hold stays.

Design page with the proof renders: https://claude.ai/artifact/SuxsBiZPpu2WcCBBLDGfXq
Evidence (on the build PC): `D:/claude/visual-firstprinciples-20260928/` (render-proof, floor, photo-staging, research reports). Diagnosis it builds on: `D:/claude/splat-quality-20260923/final-recommendation.json`.

## 1. Problem, measured

Blake's verdict (28 September): the Grand Hall splat is very poor, especially the floor; it loads slowly and feels janky. Production shows no splat at all: `lib/splat-access.ts` returns `import.meta.env.DEV` (founder hold, 19 September).

Measured causes on the current renderer (three 0.186 WebGPURenderer + patched `GaussianSplat`):
1. The floor is a 24 cm slab of about 794,000 translucent discs; the laser scan puts 99.3% of the real floor within ±5 cm of one plane.
2. Display settings: three r186 reads `Material.toneMapped` nowhere, so `native-splat-scene.ts` `toneMapped=false` is a no-op; R3F 8.18 applies ACESFilmic unless the canvas is `flat`; splats blend in linear space although they were trained in sRGB space; anti-aliasing opacity compensation is always on. Together: 25 dB against a reference render of the same splats, 46 dB with them removed (2× grid; 30–40 dB at 1×).
3. Loading: each arriving tile re-merges, re-bounds and re-uploads every loaded splat on the main thread (`native-splat-data.ts`, `native-splat-merge.ts`, `new GaussianSplat()`, `compileAsync`): 16–25 s of long tasks, 3.4 s longest, 2.67 GB heap.
4. Phones: Safari reports "Apple GPU", which `device-tier.ts` maps to the high tier, so iPhones receive all 6 million splats.
5. Capture weak spots: fuzzy window wall, dome partly off-surface, baked capture-day sky, SOG palette dulls gilt.

The 28 September proof (`render-proof/`, product renderer, identical cameras, control match 53–63 dB) shows the photographic floor registering to the splats within 1–2 mm and replacing the smear with real boards, grain and board ends. The photo-staging proof (`photo-staging/`) shows furniture composited into a Matterport photograph, lit by it, reading as real.

## 2. Principles

1. Photographs are the truth. Where a surface's shape is known exactly, project the photographs onto it; learn only what cannot be measured.
2. A planner looks at the floor, so the floor is the best-represented surface.
3. Waiting is felt, bytes are not: a photograph first, planning within about 1.5 s, no main-thread task over 100 ms (stretch 50 ms).
4. The camera rests most of the time: rest adds supersampled refinement; motion keeps full sharpness at 60 fps (Plan 16 forbids softening motion).
5. Furniture is lit by the room it stands in, from the room's own daytime station photographs.
6. One object, three forms: gold glyph (plan), hologram (move/load), real piece (room).
7. Provenance stays visible: measured, restored, generated or simulated.

## 3. Architecture

### 3.1 Representation per surface (Grand Hall first; the method generalises to every room)

| Surface | Drawn as | Source |
|---|---|---|
| Floor | Opaque mesh with a photographic texture (2 mm master, KTX2 tiers), roughness, and reflections from station panoramas | Matterport OBJ texture (Arm A) or the E57 photo mosaic (Arm B), whichever wins; LiDAR plane |
| Walls, ceiling planes | Measured shell for depth, occlusion, picking, shadows and the cut-away; splats on top where they win | LiDAR |
| Panelling, boards, portraits, dome, frieze, chandeliers | Splats | XGRIDS captures (best source per surface later, S4) |
| Windows | Sky and street portals (S4) | Weather data, facade photographs |
| Furniture | PBR meshes of the real pieces, instanced, LOD chain, photo-lit, contact-shadowed | Site capture, modelled by Claude |

### 3.2 Colour and pass order

Target: splats blend in their trained, display-referred space and are never tone-mapped; lit meshes (floor, shell, furniture) are tone-mapped once, then composited with the splats against one depth buffer.

Two implementations, chosen by a prototype in the first increment:
- **A. Per-material output (preferred if it holds up):** renderer `toneMapping = NoToneMapping` with no output conversion of the framebuffer (display-referred framebuffer, as the 24 September parity arm); lit materials apply `renderOutput(tonemap, sRGB)` in their own TSL output; splat colour passes through; blending then happens on display-referred values. Minimal pipeline change.
- **B. Two-stage pass:** opaque meshes into a linear HDR target with depth; one output transform into a display target that shares that depth; splats drawn into the display target. Needs shared-depth targets proven in r186.

Anti-aliasing compensation applies only to sources whose SOG metadata says `antialias: true`. Acceptance: splat parity at the matched 1× grid ≥ 40 dB PSNR / ≤ 0.02 LPIPS against a classic-3DGS reference, per backend (WebGPU, WebGL2); furniture colour checked against the photo-staging proof; Blake's eye.

### 3.3 Loading

- **Photographic first frame:** a converged still of each room at its planner spawn camera, rendered by our own renderer (2–3 aspect variants, AVIF ≈ 150–250 KB), shown at once; the live canvas cross-fades in (≈ 400 ms) only when a readiness gate passes (floor skin, shell, in-frustum splats at target level); the first user input fades immediately. Never fade from a sharp still to a blurry frame.
- **Splat pool (no re-merge):** a fixed-capacity pool per device class (budget × 1.15); workers fetch, decode, transform to the scene frame, pack to the pool layout and compute chunk bounds; the main thread writes sub-ranges under a per-frame upload cap (≈ 4 MB phone, 16 MB desktop, one chunk per frame); the material compiles once; the global sort runs on chunk arrival and view change. Implemented as a narrow extension of the existing pinned three patch.
- **Delivery:** content-hashed immutable URLs; R2 custom domain when Blake issues it (the `/splats/*` rewrite remains the fallback).
- **Budgets:** desktop in-frustum complete ≤ 6 s at 20 Mbps; total long tasks < 0.5 s; JS heap ≤ 300 MB desktop, ≤ 150 MB phone.

### 3.4 Device classes

Classify by user agent and form factor, not the GPU string ("Apple GPU" is currently high tier). Splat budgets (starting values, replaced by physical measurements in S6): desktop discrete 3–4M, laptop integrated 1–1.5M, recent iPhone 1.0–1.5M, older iPhone 0.6–1.0M, iPad M-series 1.5–2.5M, flagship Android 0.8–1.2M, mid Android 0.4–0.6M. With the floor and shell as meshes, the splat budget spends on ornament only, which is what keeps phone quality level with desktop (Plan 16).

### 3.5 Furniture

- States per item: `glyph` (plan view; one instanced SDF draw), `hologram` (moving or loading; low-LOD mesh, emissive Fresnel, alpha-hashed so it writes depth), `real` (PBR). A per-instance reveal (≤ 600 ms, spring-timed, staggered 20–40 ms) drives the transitions; an item stays a hologram until its assets are resident, so the hologram is also the loading state. Reduced motion: instant state change. All visible loading/working states go through `components/shared/Activity.tsx`.
- Lighting: blend the 2–4 nearest daytime station panoramas (stations 001–031; never the dusk station 041 used by today's experiment) with recovered highlight intensity; box-projected reflections from the nearest station; one static key-light shadow; instanced contact decals; a furniture-only tone curve fitted to the capture.
- Performance: `StaticDrawUsage` for instance buffers (today's `DynamicDrawUsage` makes r186 re-upload every render); single-sided closed meshes; per-instance culling and LOD; KTX2 + meshopt.

### 3.6 Assets and provenance

- Floor skin package per room: `floor.json` (plane, polygon, texel → room-frame mapping, source, harmonisation), KTX2 tiers (8192 / 4096 / 2048), roughness, provenance "measured (photographic)"; colour harmonised to the splat room (the Arm A texture is 1.65× brighter and yellower than the splats).
- Derived splat tiles with the floor slab removed (and later window glass and baked sky), written as new SOG files with provenance; source captures are never rewritten.
- Furniture: measured dimensions in each model's provenance; AI-generated models are labelled representative until replaced.

### 3.7 Access (founder hold)

`gaussianSplatsAvailable()` becomes: local development, or a preview deployment. The deployment environment comes from the build (Vercel `VERCEL_ENV`, exposed through a Vite define); production builds always return false. Unit tests pin production = false, preview = true, development = true. The hold on venviewer.com stays until Blake lifts it.

## 4. The first slice

One vertical slice that proves the whole idea, shipped in three increments, each deployed to a preview link for Blake:

**I1 — Looks right.** Colour and pass order (3.2); floor skin mesh, harmonised; floor-slab removal; phone classification fix; access change for preview links. The floor texture is Arm A unless Arm B beats it on the harness's floor-close and plan views for both sharpness (variance of Laplacian on the six fixed crops) and colour uniformity (standard deviation of low-pass luminance across the floor); when the two disagree, Blake chooses from the side-by-side. Blake sees: the real floor and cleaner colour in the planner's Grand Hall.

**I2 — Opens fast, never freezes.** Photographic first frame and gated cross-fade; the splat pool; upload cap. Blake sees: the hall appear in under a second and never stutter.

**I3 — The table arrives.** Photo-lit furniture (3.5) for the round table and pink chair with scripted material fixes; glyph → hologram → real on placement; chairs arrive in a wave around the table with the existing spring core and arrangement. Blake sees: placing a table feels like the film.

Done when: all three increments are merged to master behind the hold, deployed, verified on a preview link in a real browser, and Blake has judged them; regression tests, typecheck, lint and build pass; the render harness contact sheets and load traces are recorded.

## 5. Later slices (each its own spec and plan)

S2 rest: shell from LiDAR (depth pre-pass, cut-away cap line), floor gloss (station reflections + furniture reflection). S3: rest accumulation and one-press proposal stills (three-gpu-pathtracer WebGPU for desktop photo mode). S4: best-source splat composite, window portals, lighting moods and weather. S5: the real furniture (below). S6: physical-device qualification. Goal 03's planner surface (formations, snapping, the summoning, Grand Assembly) builds on this stage in parallel.

## 6. Furniture programme

1. Site day (two people, one day): Claude supplies the shot list and measurement sheet (per type: dimensions, 20–40 reference photos with a colour card, turntable photogrammetry for the three chair types, polarised swatch pairs for about ten materials, a dressed 6 ft round for drape reference, lux readings).
2. Claude builds: a parametric generator for rounds, trestles, café tables, poseurs and stage decks; chairs from photogrammetry of the site photographs, cleaned and retopologised in Blender, with materials from the swatches; pre-simulated linens per table size; an L0–L4 chain; KTX2 + meshopt.
3. Until then: scripted fixes to the 20 existing AI models (fabric metalness 0, velvet sheen, true sizes from the venue's equipment list, KTX2), labelled representative.

## 7. Verification

- Unit tests for every new pure module (device classification, access gate, readiness gate, reveal state machine, pool allocation, floor manifest parsing).
- The render harness (`render-proof`) becomes a regression instrument: fixed views, splat parity at 1×, floor sharpness, contact sheets.
- Load traces at 20 Mbps (CDP throttling): long-task totals, longest task, heap, time to first live frame, time to in-frustum complete.
- Preview deployment checked in a real browser before each hand-off; physical phones in S6.
- One GPU-heavy job at a time on the build PC (two power losses on 28 September under concurrent GPU load).

## 8. Risks

Per-material output (3.2 A) may not match splat parity or may complicate existing lit components; the pinned-patch lifecycle has regressed before; wall-base seams between the sharp floor and soft splat skirting; floor colour harmonisation; `VERCEL_ENV` availability at build time; physical-phone budgets are estimates until S6; the build PC's power stability.

## 9. Not in the first slice

Best-source splat composite, window portals, weather, lighting moods, rest accumulation, photo mode, real furniture models, physical-device qualification, the Goal 03 planner surface rebuild.
