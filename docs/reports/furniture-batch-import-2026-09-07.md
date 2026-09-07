# Supplied furniture batch — 7 September 2026

Blake requested placement of the supplied furniture in room planning and publication
of the combined progress for Elaine's demonstration. Work is isolated on
`codex/furniture-batch-import-20260907`, based on release candidate `74348f9b`.
T-601, the **Build next-gen venue platform** task, owns the combined production
release. Local verification, integration and live publication are separate states.

## Delivered furniture

The requested `E:/downloads/furniture/_glbs` path was absent. The actual supplied
folder was `E:/downloads/furniture_glbs`, containing 18 named folders. Source GLBs
were selected from their archives without executing archive contents; originals
remain untouched. The pink chair source is byte-identical to the previously
imported Burgess Turini and reuses its existing identity/model.

Five existing catalogue identities receive models and previews: the 6ft trestle,
black and white poseurs, platform and bar. Their physical metadata, stock and
existing placements are preserved. Twelve distinct entries are added:

| Furniture | Planning width × depth × height, metres |
| --- | --- |
| Trestle Table (Black Cloth) | 1.83 × 0.76 × 0.74 |
| Trestle Table (White Cloth) | 1.83 × 0.76 × 0.74 |
| 6ft Wooden Trestle Table | 1.83 × 0.76 × 0.74 |
| Round Table (Black Cloth) | 1.83 × 1.83 × 0.76 |
| Round Table (White Cloth) | 1.83 × 1.83 × 0.76 |
| Cake Cutting Table | 1.10 × 1.10 × 0.76 |
| Ceremony Table | 1.60 × 1.00 × 0.74 |
| Checked Banquet Chair | 0.48 × 0.62 × 0.90 |
| Folding Room Divider | 4.20 × 0.75 × 1.80 |
| Round Café Table (White Cloth) | 0.90 × 0.90 × 0.74 |
| Square Café Table (White Cloth) | 1.05 × 1.05 × 0.74 |
| Servery Unit | 2.05 × 0.60 × 0.90 |

All twelve new envelopes are **approximate**, visibly labelled in the catalogue
and selected-item inspector. They are planning assumptions pending physical
measurements, not manufacturer facts or verified capacities. Six-foot variants
borrow the existing planning envelope; other new entries use provisional sizes
informed by the supplied shape. No physical stock quantities are invented.
The previously measured Turini remains 0.42 × 0.58 × 0.88 m.

## Models and interaction

Seventeen new runtime GLBs total **59,512,608 bytes and 1,144,994 triangles**, down
from 16 million supplied triangles. Neutral rendered previews total 98,252 bytes.
The source and 2K derivatives remain outside the repository. Runtime textures
are resized to 1K and encoded as lossless WebP; this preserves the resized pixels,
not the original 2K image detail. Bar and servery use the stricter simplification
candidate after visual comparisons found texture-edge damage at the lower mesh
budget. Silhouettes, cloth folds, trestle legs and chair handholds were inspected.

The cake table, white poseur and white trestle were supplied without image textures
and retain their basic source material. The other fourteen new models retain
their colour, normal and metallic/roughness maps. No brochure finish or adjacent
photograph was substituted. Previews are model renders, not product photographs.

Runtime geometry is centred, grounded and calibrated to the catalogue envelope;
the divider and platform rotate 90 degrees so their long axis is width. Bounds
were read back from all final GLBs and match within 1e-6 m. Each model directory
contains its source/runtime hashes, calibration and material provenance.
The checked-in preparation script and reviewed manifest reproduce all seventeen
GLBs byte-for-byte from the original sources. A mismatched source hash is rejected.

The picker and drag preview show actual model thumbnails with an image-error
silhouette fallback. Imported cloth is intrinsic, preventing duplicate linen
overlays. Cake and ceremony tables place directly without a dining-chair dialog
and do not contribute dining-seat targets. The divider and servery have named,
rotated/scaled 2D footprints and participate in guest-flow/clearance obstacles.
Imported models do not expose procedural-only explode controls or proxy badges.
Existing procedural furniture remains available for items with no supplied GLB.

## Registration and verification

`0068_furniture_model_batch.sql` appends journal index 66, timestamp
`1788718000000`; the complete chain has 67 entries. Its SHA-256 is
`10844538bafe5e4bef1d8d2f1bd8069429c4e5f0e408a0a097642ac9bd3da1f8`.
The atomic registration locks rows in UUID order, validates identity/metadata,
allows only matching or previously null presentation URLs on the five upgrades,
and rejects incompatible rows without a partial import. Matching replay is inert.
No previous SQL or migration journal entry changes.

Verified in the isolated worktree:

- 51 focused API/database tests: full fresh 67-entry migration ledger, seeding,
  replay, concurrent registration, incompatible-row rollback, existing stock and
  saved-object preservation, and foreign-key saves for every new identity.
  PostgreSQL is an explicit disposable loopback target, not an ambient database.
- 592 affected web tests across 37 files, including GLTF ownership/batching,
  previews, cloth/service-table semantics, pointer placement, 2D and obstacle
  footprints, inspection, inventory, and layout save/reload contracts.
- Shared catalogue tests (17), shared/API/web typechecks, affected lint and API
  build. Web production bundle generation passes in `--mode test`; the release
  owner separately validates the actual production configuration and Linux build.
- Browser verification uses Chrome/ANGLE on NVIDIA RTX 4090, the actual local API
  and a disposable 20 × 20 m synthetic room. Inventory preview and unrecorded
  stock, chair/cake/divider drag, rotation, save/reopen, all 18 models loading,
  and complete-batch saved identities are exercised. A 390 px viewport is a
  responsive-layout check, not evidence from an actual phone GPU.

The final browser run passes with zero page/console errors and no failed HTTP
responses. All 18 catalogue identities are present after complete-batch save and
reload. The three basic-material exports and fifteen textured models (including
the existing Turini) render through the imported instancing path. Audit-log
acknowledgement is awaited before reload so the harness does not abort a separate
fire-and-forget request; this does not turn that existing audit channel into a
durable delivery guarantee.

The first browser run exposed the remaining service-table seating-dialog bug;
two pointer-event tests failed before the placement guard was corrected. A later
complete-batch fixture exceeded its original 10 × 10 m boundary and was correctly
rejected with HTTP 422; the synthetic room was enlarged rather than weakening
validation. A reload instrumentation race was corrected to wait for the actual
R3F canvas root. Failed evidence is retained alongside the final run.

Evidence, scripts, final render sheet and hashes are under
`D:/claude/furniture-batch-20260907`. The complete model set's uncompressed RGBA
texture estimate including mipmaps is approximately 302 MB; this is calculated
from loaded images, not measured GPU allocation. This work does not claim a
furnished Grand Hall performance target, measured phone/iPad frame rate or founder
aesthetic acceptance. Production qualification remains with the release owner.
