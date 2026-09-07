# Burgess Turini 18/3 chair import — T-602

Blake supplied a Hyper3D Rodin PBR chair export and asked for it to be added to
inventory as a chair. This change registers a distinct **Burgess Turini 18/3** in
the global catalogue and planner. Venue stock is unrecorded until an administrator
records a real count. Existing Banquet Chair identities, layouts and stock remain
unchanged; automatic table seating still uses the existing Banquet Chair.

The import was prepared on `codex/turini-chair-import` at
`D:/claude/venviewer-turini-chair-20260906`, based on the coordinated demo candidate
`06fa42be`. T-601 retains sole production release ownership. Local verification
does not claim deployment or founder aesthetic acceptance.

## Asset and physical dimensions

| Field | Value |
| --- | --- |
| Catalogue UUID | `7f1fb7a2-5210-57b1-9108-11255c059520` |
| Slug / category | `burgess-turini-18-3` / `chair` |
| Manufacturer envelope supplied by Blake | width 0.42 m × depth 0.58 m × height 0.88 m |
| Nominal seat height / weight | 0.445 m / 4.7 kg |
| Collision / seating | box / one seat |
| Delivery model | `/models/furniture/burgess-turini-18-3/v1/chair.glb` |
| Inventory preview | `/models/furniture/burgess-turini-18-3/v1/preview.webp` |

The untouched source is
`E:/downloads/7ffa5e4b-0840-4a1d-9513-21c1b81b6e5d/base_basic_pbr.glb`:
23,909,760 bytes, 500,000 triangles, SHA-256
`9e7aa9ad1a2d818ca034971db2cd481ec7a37d8ea2c4469057179c3b10e5c37c`.
Its full-detail height-normalized master remains in local preparation evidence at
`D:/claude/turini-chair-20260906/final/height-normalized-master.glb`.

The delivery GLB is **7,443,316 bytes, 52,986 triangles, 57,896 vertices**, with one
PBR material. SHA-256:
`1aac4fc1affbc8f489e818634c21191b1a5fcf8fd70e0325bf041f2129cb91ec`.
Normal, base-colour and combined metallic/roughness maps retain their original
2048 × 2048 resolution. Lossless WebP conversion preserves decoded RGBA pixels
exactly. The model requires `EXT_texture_webp`; no geometry decoder was added.

Source proportions did not match the supplied manufacturer envelope. Uniformly
fitting height alone produced width 0.448 m and depth 0.605 m. The delivery
derivative therefore applies a documented axis calibration, recomputing normals,
to fit 0.42 × 0.88 × 0.58 m. The pivot is floor-centred, +Y up and +Z forward.
This is calibrated **AI-generated presentation geometry**, not a measured scan.
The nominal seat height is metadata, not independently calibrated seat geometry.

The source export has salmon/peach upholstery and a dark burgundy reflective
frame; the brochure's red/gold finish was not recreated. Source materials remain
intact. The inventory caption says **3D model preview**, and uses the catalogue
UUID rather than matching an arbitrary equipment name. A missing preview reports
its absence. No stock count, photograph or manufacturer-perfect reproduction is
implied.

Only the optimized GLB, rendered preview and technical provenance are delivery
files. Blake's request to import the supplied model authorizes the normal browser
delivery needed for that use. Original GLBs, source photographs, brochure and
private venue captures are not part of this publication.

## Runtime and database integration

`GltfFurniture` clones presentation materials while sharing the GLTF cache's
geometry and textures. Opacity/tint and shadows preserve the supplied PBR maps.
Instances are centred and grounded from their bounds. Imported templates notify
the batching layer after asynchronous loading; the planner re-harvests the
material groups and replaces its procedural loading fallback. Load/parse failures
retain the existing error fallback. Grouped geometry/material arrays retain
their ranges and material identity. Disposal releases owned resources without
destroying shared cached textures or geometry.

This batching qualification applies to the editable planner. Historical timeline
previews retain their existing per-item imported rendering path.

Migration `0067_burgess_turini_chair.sql` inserts only the new catalogue row.
A matching replay is inert; an incompatible identity fails rather than replacing
it. It does not modify venue stock. Its exact-byte SHA-256 is
`0f8568415568524e47bb25bad056836df0f6c7dc313d811ab9e25659cb17f780`.
Journal entry: index **65**, version **7**, timestamp **1788717900000**, tag
**0067_burgess_turini_chair**, breakpoints **true**. Prior SQL and journal entries
are preserved. The SQL files are `-text` in `.gitattributes` to retain byte hashes.

Canonical asset metadata now carries optional versioned delivery URLs. The
shared create/response schemas accept existing absolute URLs and safe
same-origin root paths; scheme-relative hosts, backslashes, control characters,
malformed escapes and traversal segments are rejected in the new path branch.
Inventory's catalogue DTO remains the existing id/name/category contract.

Normal database seeding calls an environment-free canonical registration helper.
In one transaction it inserts missing rows, validates every existing canonical
identity and returns the complete catalogue for accessory registration. Matching
migrated rows retain their timestamps; incompatible metadata rolls back newly
inserted rows. This fixes the fresh migrate-then-seed duplicate UUID without
changing migration semantics or running broad seeding against production.

## Verification and release handoff

Evidence lives outside the repository at
`D:/claude/venviewer-turini-evidence-20260906`; preparation renders and the
full-detail master remain at `D:/claude/turini-chair-20260906`.

- Source and derivative hashes, finite/indexed geometry, exact bounds and
  decoded texture equality checked; front-quarter/back-quarter/side renders
  compared before selecting the attribute-aware simplification.
- Shared furniture/catalogue/integration checks: **164 passed**; full types
  lint, typecheck and build passed.
- Focused GLTF lifecycle/instancing/fidelity coverage: **46 passed**. Inventory
  picture, inventory panel and catalogue suite: **43 passed**.
- Actual isolated PostgreSQL migration suite: **5 passed**, including replay,
  stock preservation, listing with stock null, placement FK/dimensions, conflict
  refusal and concurrent registration. All **66 journal migrations** applied to
  a separate synthetic browser database; real readiness, inventory,
  configuration and space endpoints returned 200.
- Fresh 66-migration canonical-seed regression plus seed validation: **21
  passed**. The former blind insert was reproduced as PostgreSQL 23505; the
  corrected normal seed helper, replay and nine metadata-conflict rollback
  cases passed on a new disposable database. Actual `GET /assets` and create
  asset DTOs also parsed the canonical root-relative model/preview paths.
- Web source and e2e typecheck, changed-file ESLint, and Vite packaging with
  `--mode test` passed. API typecheck and build passed. The isolated checkout
  has no live Clerk key; production web configuration is the release owner's
  gate. Local API checks used Node 22.18.0, not the deployment image's pin.
- Chrome desktop/mobile inventory rendering and chair-row placement were
  exercised against the actual synthetic API. Actual planner inspection
  confirmed one imported PBR material batch, 52,986 triangles per chair,
  all maps/shadows intact, exact envelope and floor pivot. Selection, 90-degree
  rotation, Save and reload retained the catalogue UUID and pose.
- A synthetic **144-chair** scene retained one imported material batch.
  Chrome reported an NVIDIA RTX 4090 via ANGLE/D3D11. This checks batching
  correctness; it is not a furnished Grand Hall frame-rate or device-matrix
  acceptance claim.

Early browser harness attempts used an outdated toolbar label and imported a
second Vite store module without the running HMR timestamp. Those failed harness
observations were retained; final state inspection uses the actual module URL
observed in browser traffic. They are not model or persistence defects.

The browser save gate also found and repaired an existing action-log DTO
double-envelope mismatch: the shared client unwraps `data`, while action-log
callers expected another `data`. Four regression cases failed before the narrow
two-schema/two-return fix; **60 related checks passed** afterward, retaining
malformed-response rejection and depth bounds. The final actual browser rerun
passed with zero page/console errors, saved pose/UUID intact, and inventory stock
still null. This repair is a separate coherent commit in the release handoff.

T-601 must integrate the tested commits, repair the separate phase-test fixture
that blindly inserts all canonical assets after migration, run its combined
fresh/actual-target migration checks and apply the migration before publishing
the web catalogue. Do not run broad demo seeding against production.

## Reproduction

`packages/web/scripts/prepare-burgess-turini.mjs` uses the pinned local
`tools/twin-forge` dependencies (`@gltf-transform/*` 4.3.0, meshoptimizer 1.2.0,
sharp 0.35.3) and rejects a source whose hash differs from the reviewed export.
Invoke it with repository root, source GLB and an external output directory.
It produces the calibrated chair, provenance and a retained full-detail master;
the thumbnail was separately rendered from the final model in Blender 5.2.1.
The delivery preview is 800 × 800 WebP, 32,596 bytes, SHA-256
`cb5abbf943b7e9ed5d4b841223a0549a74f446c404a37dc99c2f32c0397c57eb`.
