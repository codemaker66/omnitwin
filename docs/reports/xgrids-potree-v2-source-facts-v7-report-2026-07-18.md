# XGRIDS/Potree v2 Source Facts V7 report

Date: 2026-07-18  
Workstream: T-530 under active T-508  
Authority: none

## Outcome

The bounded V7 slice is implemented, replayed against ten real primary XGRIDS
preview bundles and independently audited with no remaining actionable P0-P2
correctness issue. It preserves the exact V6 Source Facts, Readiness and
Checklist artifacts and adds separate digest domains for exact three-member
Potree bundle refinements. No cybersecurity work is needed for this ordinary
local reconstruction-product path.

The profile follows the official PotreeConverter three-file layout and the
official viewer's 22-byte hierarchy/proxy traversal behavior. In particular, a
proxy target chunk replaces the logical proxy row; target declaration
differences are retained as compatibility observations instead of rejected
solely for non-equality. Primary references are the
[PotreeConverter README](https://github.com/potree/PotreeConverter/blob/2.1.3/README.md#L2-L13),
[hierarchy writer](https://github.com/potree/PotreeConverter/blob/a70ef212198b0e5ae1d071713a0c8cbda8fcc9a7/Converter/include/HierarchyBuilder.h#L240-L344),
[octree range writer](https://github.com/potree/PotreeConverter/blob/a70ef212198b0e5ae1d071713a0c8cbda8fcc9a7/Converter/src/indexer.cpp#L1434-L1516),
and [official viewer loader](https://github.com/potree/potree/blob/5636cd471d9eb464969e758be45c44d7613d3859/src/modules/loader/2.0/OctreeLoader.js#L14-L264).

## What V7 establishes

- Exact co-located identities for `metadata.json`, `hierarchy.bin` and
  `octree.bin`, bound as one bundle while unrelated ancillary files remain
  outside that bundle.
- Bounded duplicate-key-safe UTF-8 metadata syntax for version `2.0`, encoding
  `DEFAULT`, and the frozen metadata-order 14-byte record declaration:
  `position int32[3]`, `intensity uint8`, `lcc prediction uint8`.
- Complete reachable 22-byte hierarchy traversal, including bounded proxy
  chunks, BFS child accounting, node type/count evidence and derived depth.
- Exact per-node `point count × 14 = byte size` equations, disjoint and gapless
  octree ranges, full byte coverage, and equality of metadata, hierarchy and
  octree-derived totals.
- Deterministic path-specific readiness refinements and digest-bound evidence
  requests for every unresolved Potree claim.

Metadata and hierarchy capture is bounded, `octree.bin` is streamed and hashed,
and complete bundles are inspected sequentially. The same streams supply both
parsing and exact identity checks. Cancellation issues no V7 artifact.

V7 decodes no coordinate, intensity or vendor-attribute value. It does not
establish what `lcc prediction` means, units, axes, frame, CRS, physical extent,
completeness, accuracy, registration, raw-capture status, provenance, rights,
viewer fidelity, processing permission or authority.

## Real read-only evidence

The Reception bundle at
`F:/gaussian splat -- xgrids/model/Reception_Room_2026-06-01-150618/project_data/model`
repeated byte-identically:

| Member | Bytes | SHA-256 |
| --- | ---: | --- |
| `metadata.json` | 1,299 | `65e314ff0908ba9a87a4e149f82c3bc76fe529fd0aa63b621c7c69b8e94a0d7e` |
| `hierarchy.bin` | 2,046 | `40d1fe4a74f7cd5f92ec6752bc9f5aebe5ba262795da8748c00363017f76e21b` |
| `octree.bin` | 2,453,318 | `c49eb7a959be867ef27b63ca1e17b36505566a882f359b642b268afb979e98f5` |

Bundle SHA-256 is
`f226739d3f8e94605b8c363a1b135986388b5cf920df0194ff960bfed5940fb2`.
The exact structural result is 175,237 declared/resolved points, a 14-byte
record, 93 logical nodes, 2,046 reachable hierarchy bytes, no proxies and 93
disjoint, gapless ranges covering all 2,453,318 octree bytes.

V7 retained three compatibility notes rather than erasing them: metadata depth
0 versus observed depth 3, 13 `LEAF` rows with child masks, and omitted optional
attribute histograms. It also retained all ten unresolved claims.

The artifact chain is:

`40ea026b… receipt → 8a29ba1a… source facts → 2c65daca… readiness → a834f354… checklist`

The other nine primary room bundles fail closed under the frozen profile:

- Four have `POTREE_V2_OCTREE_LENGTH_MISMATCH`: `default`,
  `Grand_Hall_Bright_Walls`, `Robert_Adam_Room` and `The_Grand_Hall`.
- Five have `POTREE_V2_HIERARCHY_UNREACHABLE_BYTES`: `DC_Room` (572 bytes),
  `Lady_Conveynor` (154), `North_Gallery` (110), `South_Gallery` (88) and
  `The_Saloon` (748).

Those are structural classifications, not proof of truncation, general
corruption or failure in a vendor-specific viewer.

## Product surface and verification

The loopback app now presents the exact V7 bundle card, three compatibility
notes, ten unknowns, one path-specific readiness refinement, ten digest-bound
evidence requests, and canonical V7 downloads. Desktop 1280×720 and mobile
390×844 checks found no page-level horizontal overflow, dialog/error overlay or
browser warning/error. Each download control reported its exact artifact
fingerprint; separate loopback checks returned HTTP 200 with the exact schema
and filename. The first browser download-event waiter itself timed out, so no
browser event is claimed as evidence. The listener stopped and port 41773 is
closed.

Final verification:

- focused V7: 23/23 across three files;
- full Reconstruction Foundry: 638 passed, one existing skip across 53 files;
- core lint, typecheck and build: passed;
- focused local app: 60/60 across three files;
- CLI typecheck and targeted lint: passed;
- independent adversarial review: no actionable P0-P2 issue;
- exact Reception receipt and V7 facts: byte-identical over two runs.

The exact machine-readable record is
`docs/reports/xgrids-potree-v2-source-facts-v7-evidence-2026-07-18.json`.
This completes only T-530's bounded V7 slice. T-508 and the broader OmniTwin
Foundry `/goal` remain active.

## Next bounded step

Do not widen V7 silently. A useful V8 candidate is a separately reviewed,
bounded point-value decoder/preview profile for the exact established Reception
bundle: finite-value and declared-range checks, node-bound sampling, explicit
memory/time/cancellation limits and repeatable same-camera local preview
evidence. It must continue to keep decoded values separate from units, frame,
physical meaning, completeness, accuracy, registration, provenance, rights and
authority. Independent surveyed controls and purpose-scoped rights remain later
authority prerequisites, not blockers to ordinary local product work.
