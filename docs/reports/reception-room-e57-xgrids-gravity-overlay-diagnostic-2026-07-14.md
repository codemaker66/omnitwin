# Reception Room E57 ↔ XGRIDS gravity-overlay diagnostic

Date: 2026-07-14  
Task: T-516  
Handling: private, geometry-only diagnostic  
Authority: none  
Decision: computer vision found structural evidence consistent with both
captures representing the same room, but this is not formal room-identity
proof and the alignment is not accurate or physically controlled enough to
approve T-505.

## Short answer

Yes, this can be tackled with computer vision, and this slice does exactly
that on the real Reception files.

The program found a shared room outline, kept the result upright, measured
the mismatch from both captures' point of view, and drew eight top, side,
angled, distance and control-comparison pictures. The broad structure lines up.
The detailed geometry does not: typical misses are around 9–14 cm, the worst
5% of the cropped comparison are roughly 67–83 cm away, and only 14.5–18.4%
of cropped points are within 5 cm. The provisional approval bar asks for 90%
within 5 cm.

This is useful measuring evidence. It is not a usable room transform.

## What “computer vision” means here

This pass compared the two three-dimensional shapes directly. It did not read
or publish the E57 photographs and it did not use colour to make a weak shape
look convincing.

The program:

1. checked the exact byte identity of the 20.5 GB, 149-scan Reception E57 and
   the exact XGRIDS point and pose files;
2. used only the declared development scans to find an upright rotation and
   position;
3. kept scale fixed at one metre per unit and allowed rotation only around the
   vertical axis;
4. measured the answer on three separate validation scans that did not change
   the fit;
5. measured both directions, because “XGRIDS has something near the laser” is
   not the same question as “every laser-measured surface exists in XGRIDS”;
6. compared the upright answer with the earlier unrestricted answer, a mirror
   control and a deliberately wrong rotation; and
7. saved the complete view set in a create-only package whose manifest and
   every PNG can be checked for later change.

## Real inputs

| Input | Exact identity |
|---|---|
| Reception E57 | 20,518,437,888 bytes; 149 scans; SHA-256 `975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd` |
| Capture-stage manifest | SHA-256 `c044823c232dae518df84140c90004a1c17dc682c84885d6f36848933d72ddff` |
| Reception scope evidence | file SHA-256 `aba2f18be28e38ece5d5f67f2f64172f2134a36768dfe92772262674f8ea0b32` |
| Quality SH3 XGRIDS PLY | SHA-256 `da8efa94895ef7aa2c6024336278d855fdb13026bf10028901c3ac46d1e91a3d` |
| XGRIDS poses | SHA-256 `d9822320412473bf8dd4681910abf395b2957a1d24612064354944fe8581881f` |
| Prior T-515 diagnostic | whole file `c87aa8a4c96c9e86601013b41287b2019556b384fc868b206cfdb95759afdba2`; internal receipt `3f05ef356b6edaf41ed5464b9b875d2881758d4118fc6ef0533cafd03c00bd93` |

The production identity check rejects the unrelated nine-scan Downloads lobby
E57 before geometry processing.

## Data roles and leakage guard

- Fit scans: `124,125,127,128,130,132,133,135,136,137,139,142,143,144`.
- Validation scans, scored but never used to change the fit: `131,134,138`.
- Boundary context: scan `122` is drawn in purple in the full-context picture,
  but is not fitted or scored. Scans `123` and `140` remain unread.
- Frozen test scans: geometry from `126,129,141` is not requested from the E57
  reader, decoded, sampled, drawn, fitted or scored. Mandatory whole-file
  hashing still reads the E57 container bytes.
- Samples used for measurement: 80,000 XGRIDS Gaussian centres, 225,418 fit
  laser points and 48,310 validation laser points.

Gaussian centres are appearance-building primitives, not surveyed surfaces.
Nearest-neighbour distance is therefore a diagnostic, not a survey certificate.

## Upright candidate found by the program

- vertical rotation: `167.68840673177283°`;
- movement in E57 metres: `[13.528203563868903, 1.9198352646460668,
  -1.4380445457021818]`;
- scale: exactly `1.0`;
- rotation determinant: `+1` (not mirrored);
- vertical-axis error under the declared +Z-up assumption: `0°`.

The yaw search selected one family over its runner-up by `0.20192238855018885`
metres under its internal rule. That settles the program's upright yaw family;
it does not independently prove the building's handedness, level or scale.
Do not copy this candidate into a runtime or `TransformArtifactV0`.

## Measured result

Distances below are ordinary physical distance. `XGRIDS → E57` asks how near
each sampled XGRIDS centre is to a laser point. `E57 → XGRIDS` asks how much of
the laser-measured room has nearby XGRIDS coverage.

| Region and direction | Typical miss (median) | Worst 5% starts at (p95) | Overall error (RMSE) | Within 5 cm |
|---|---:|---:|---:|---:|
| Full, XGRIDS → E57 | 142.2 mm | 496.4 mm | 529.4 mm | 11.28% |
| Full, E57 → XGRIDS | 94.0 mm | 435.7 mm | 186.1 mm | 17.43% |
| Diagnostic crop, XGRIDS → E57 | 117.8 mm | 668.0 mm | 319.6 mm | 14.47% |
| Diagnostic crop, E57 → XGRIDS | 96.6 mm | 826.0 mm | 334.5 mm | 18.36% |

The proposed crop is the overlap of each development cloud's 2nd–98th
percentile bounds after the fit. It was chosen after seeing development
geometry, is not a reviewed room boundary, and changes which surfaces are in
the comparison. Cropping improves XGRIDS → E57 RMSE from 529.4 mm to 319.6 mm,
but worsens E57 → XGRIDS RMSE from 186.1 mm to 334.5 mm; p95 gets worse in both
directions. The program records every result instead of selecting only the
nicer one.

The earlier provisional diagnostic bar was at most 20 mm RMSE, at most 35 mm
p95 and at least 90% in both directions within 50 mm. The upright candidate is
not close to that bar.

## What the eight pictures show

- The cropped top view shows the same upper/shared room outline in cyan E57
  laser geometry and orange XGRIDS geometry.
- The lower extension has substantial orange-only or high-distance coverage,
  so the two captures do not describe that area in the same way.
- The two side views show visible floor, height and ceiling disagreement.
- The distance views contain all four honest bins: within 5 cm, 5–10 cm,
  10–25 cm and more than 25 cm. Only patches are in the closest green bin.
- The full-context view retains XGRIDS outliers almost 29.13 m from their
  nearest validation laser point. Those outliers make the real room look small
  in the full view; the separate crop views provide the readable close-up.
- White in an overlay means two points landed on the same top-view pixel. It
  does not claim that they agree in three dimensions.

## Why the mirror control still matters

The upright candidate is physically easier to interpret than T-515's selected
proper result, which mapped the vertical axis almost downward. It also performs
far better than the deliberately wrong rotation, whose full errors are roughly
1,079 mm and 758 mm. That is strong evidence that the data contains a real room
alignment signal.

It is not enough to settle physical handedness. The forbidden mirror is worse
than the upright answer in one full direction (572.4 mm versus 529.4 mm), but
better in the reverse direction (179.4 mm versus 186.1 mm), and it puts 21.77%
of reverse-direction points within 5 cm versus 17.43%. Which candidate appears
better still depends on the measured direction and region. A known physical
control point or other independent evidence is required.

## Delivered and verified package

- Generator: `tools/reception-hd/render_e57_xgrids_alignment_views.py`
  - `99,170` bytes
  - SHA-256 `7bbea2e17c609fb5305512af2fda014de147b6ee6cc5084d42a3ee1e335fa5b4`
- Tests: `tools/reception-hd/tests/test_render_e57_xgrids_alignment_views.py`
  - `27,371` bytes
  - SHA-256 `bb0c58dd8915151c9a60c8c71e8fb55b0bd88beaa3db17ecf27f3bc3d2f15c38`
- Canonical private package:
  `output/playwright/reception-hd-investigation/private-t516-gravity-overlay-2026-07-14-v2/`
  - whole `manifest.json` SHA-256 `d0b9a1e5199c4ea565ea94210c7db98b7b3b1a2447c911c7c3d2b156e392ffc9`
  - internal manifest receipt `9aed42dd70c9783e45723c0b612bba22c22a87a0e7400f0b270a55a7e1b1bcaf`
  - status `private_visual_diagnostic_t505_blocked`
  - authority `none`
  - eight PNGs, all labelled private, authority-none and T-505-blocked

The first valid package, manifest SHA-256
`066a5c2a8dc0d3022e3752a0fd608b8ed31f25edc04cfed0ad0eb1ad3ab81386`,
is preserved as an audit trail. Independent review found that metre labels
overlapped in its two widest views. V2 changes only label spacing, retains the
one-metre grid, and recomputes the complete package and receipts.

Verification:

- focused T-516 suite: 20/20 passed;
- full Reception suite: 222 passed with 2 environment-dependent Windows
  symlink-permission skips;
- Python compilation: passed;
- `git diff --check`: passed;
- external whole-manifest verification: passed against SHA-256
  `d0b9a1e5199c4ea565ea94210c7db98b7b3b1a2447c911c7c3d2b156e392ffc9`;
- independent review: all eight V2 PNGs and the external manifest pin checked;
  prior wide-axis readability issue resolved; no P0–P3 issue remains.

The package records Pillow and resolved-font information and claims only exact
bytes for its saved PNGs. The embedded fallback font has no separate font-file
hash, and cross-machine PNG byte identity is not claimed. The external manifest
hash detects changes to the recorded package; it does not authenticate author,
time, truth, rights or source custody.

## What must happen next

1. Produce and human-review a room-only structural mask or crop. The computer
   can propose it, as it did here, but that proposal must not silently become
   the official room boundary.
2. Add at least three well-spread physical controls visible in both coordinate
   systems, or another independently verified camera/LiDAR calibration, to
   break the mirror ambiguity and anchor scale and position.
3. Fit floors, ceilings and walls as structural planes on development scans,
   then run the frozen test scans `126,129,141` once. Do not tune on those test
   results.
4. Keep T-505, T-502, runtime use, registration and publication blocked until
   the reviewed crop, independent controls, accuracy, rights and human-review
   gates all pass.

No source capture or source-data file was changed. No photograph was exported.
No training, provider call, paid compute, upload, signing, registration,
runtime promotion or publication occurred.
