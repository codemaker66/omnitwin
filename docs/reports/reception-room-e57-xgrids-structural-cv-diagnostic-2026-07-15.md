# Reception Room E57 ↔ XGRIDS structural 3D computer-vision diagnostic

Date: 2026-07-15  
Task: T-505 structural-alignment investigation  
Authority: none  
Decision: 3D computer vision successfully found strong room structure in both real captures, but neither capture proved a trustworthy Reception Room floor boundary. No room height, alignment transform, registration, overlay, or approval was created.

## Short answer

Yes, this can be done with computer vision. This pass used the three-dimensional point clouds directly to find walls, floors, and ceilings.

The vision worked: it found nine wall planes in XGRIDS and nine wall planes in the fit-only E57 data. Each capture contained two clear wall directions, so the program was not merely following one long wall.

The program then stopped for a good reason. A horizontal band is not automatically the Reception Room floor. To count as the room floor, it must also form one believable continuous interior surface and make physical contact with independent room walls. Neither capture passed that test. The program therefore refused to invent a room height or line the captures up from ambiguous geometry.

## What the program looked for

The structural pipeline works in this order:

1. classify likely vertical walls and horizontal surfaces;
2. merge duplicate physical samples so repeated points cannot create fake confidence;
3. fit separate wall planes;
4. find horizontal height bands;
5. require a proposed floor or ceiling to cover real two-dimensional interior area;
6. require that surface to meet enough of at least two independent walls; and
7. only then compare partial one-to-one wall assignments and calculate an upright fixed-scale transform.

The real run reached step 5 and stopped at the floor-boundary test. It never reached transform fitting.

## Real-data boundary

The final real check was deliberately narrower than the publishing CLI. It was an in-memory, read-only diagnostic with no receipt or image output.

- XGRIDS input: the 496,504,970-byte Quality SH3 PLY with 2,002,028 declared vertices.
- XGRIDS deterministic sample: 160,000 Gaussian centres.
- E57 input: the 20,518,437,888-byte, 149-station Reception E57.
- E57 stations requested: `124,125,127,128,130,132,133,135,136,137,139,142,143,144` only.
- E57 points returned from those 14 fit stations: 225,418.
- Validation stations requested: none.
- Frozen test stations `126,129,141` requested or decoded: none.
- Excluded stations `122,123,140` requested or decoded: none.
- Complete E57 byte hash in this fit-only rerun: not performed, because that would read all container bytes, including sealed-station bytes.
- Files written by either real probe: none.

The input sizes still match the previously pinned Reception files. This rerun did not claim a new whole-file identity verification.

## What was measured

| Measurement | XGRIDS | Fit-only E57 |
|---|---:|---:|
| Classified structural surfaces | 17,559 | 40,981 |
| Wall-class surfaces | 8,545 | 9,543 |
| Floor-class surfaces | 4,073 | 13,158 |
| Ceiling-class surfaces | 4,941 | 18,280 |
| Wall planes found before the floor gate | 9 | 9 |
| Independent wall directions present | yes | yes |
| Structural inventory completed | no | no |
| Failure code | `HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND` | `HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND` |

The E57 floor-height evidence was numerically strong: its main band was at approximately `-2.8802 m`, contained 13,065 points, and represented 99.29% of its floor candidates. It still failed the room-boundary test. This distinction matters: many points at the same height can describe disconnected floor pieces, nearby spaces, or geometry that never reaches the fitted room walls.

XGRIDS contained two nearly equal main floor-height bands, around `-1.5205 m` and `-1.4312 m`, representing about 46.4% and 47.0% of its floor candidates. Neither band qualified as one authoritative Reception Room floor boundary.

Both captures failed with the same plain-language reason:

> No floor level satisfies the continuous-footprint, capped-endpoint, actual-wall-contact boundary test.

## Why no alignment was produced

The program needs a trustworthy floor and top ceiling before it can establish room height, fixed scale, and vertical placement. It also needs those surfaces to be tied to the same walls used for horizontal alignment.

Because the floor boundary was not proven:

- room height is unknown;
- fixed-scale compatibility cannot be approved;
- vertical translation is not trustworthy;
- wall matches alone cannot safely identify the intended room envelope; and
- drawing an overlay would make an unproven transform look more certain than it is.

The correct result is therefore a refusal, not a best-looking guess.

## Matcher and geometry hardening completed in this slice

The structural tool was hardened before the real rerun. Important changes include:

- physical, rotation-safe duplicate-point handling;
- rejection of boundary-only circles, nested rings, concave outlines without local interior support, and density seams that can fake floor area;
- exact partial one-to-one wall matching, including the option to leave a weak compatible wall unmatched;
- a requirement that the same two wall correspondences be independent in both captures;
- assignment decisions that cannot be changed by plane IDs, tuple order, common rotation, common translation, or swapping source and target;
- role-symmetric tie handling that first protects coverage on the weaker side;
- full-score support area recomputed from indexed physical points instead of trusting claimed metadata;
- unassessable occupancy treated as zero evidence, not a perfect match;
- bounded numeric domains and clean rejection of huge, malformed, nonfinite, or off-plane inputs; and
- deterministic proof-work limits that return no heuristic incumbent when exact matching would be too large.

Production file:

- `tools/reception-hd/register_e57_xgrids_surfaces.py`
- 420,828 bytes
- SHA-256 `84d4eaf4d2c8b0f6d60e3c48283f4f3dd319320a65c172f6792da21619f8d31a`

The pinned E57 helper remains:

- `tools/reception-hd/align_e57_xgrids.py`
- 90,503 bytes
- SHA-256 `d8c5b1c00505a9ae3fb90071fe351bf3003330a784f724facb8d67c34761092d`

## Verification

- Complete `tools/reception-hd` suite on the final production hash: 386 tests run; 384 passed and 2 operating-system-dependent tests skipped.
- Exact scorer hardening: 19/19 passed.
- Plane invariance: 5/5 passed.
- Distinct-plane geometry: 92/92 passed.
- Physical duplicate/footprint hardening: 19/19 passed.
- Independent final-hash exhaustive audit: 3,000/3,000 random problems matched brute force, covering 83,976 valid candidate matchings.
- In that audit, 587 correct winners deliberately left an available weak wall unmatched.
- Independent transform-invariance audit: plane-ID changes, tuple reordering, source/target swaps, common rotations, and exact-score ties passed.
- Python compilation: passed.
- Independent sealed-scan static audit: passed.
- Frozen test geometry accessed during development or real reruns: no.

## Outputs deliberately absent

The following blocked package files do not exist:

- `output/playwright/reception-hd-investigation/private-t505-structural-cv-2026-07-15.json`
- `output/playwright/reception-hd-investigation/private-t505-structural-cv-2026-07-15-top.png`
- `output/playwright/reception-hd-investigation/private-t505-structural-cv-2026-07-15-side.png`

No `TransformArtifactV0`, database registration, runtime change, provider call, training job, upload, publication, or spend occurred.

## What would make the next computer-vision run useful

The next input needs to remove the room-boundary ambiguity. Any one of these would materially help:

1. a human-reviewed 3D crop containing only the Reception Room;
2. a simple boundary polygon marking which floor area belongs to that room;
3. clearer capture coverage along floor-to-wall and ceiling-to-wall junctions at two or more corners; or
4. surveyed control points that identify the same physical corners in both captures.

After that, rerun the structural fit with the same fit stations, keep validation held out, and continue to leave the frozen test stations untouched. Until then, T-505 should remain open.
