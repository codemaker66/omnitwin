# Reception Room E57 geometry-edge visual diagnosis

**Date:** 2026-07-14  
**Scope:** the 14 non-passing photos in the frozen 16-station geometry-held-back run  
**Authority:** none; local and private diagnostic evidence only  
**Decision:** the pictures explain why the edge test struggled, but they do not overturn its failed result or approve camera poses for training.

## Short answer

Computer vision was used to compare every failed photo with a passing photo of the same cube face. It found three understandable failure patterns:

1. **Four photos do not contain enough laser-derived edges in every part of the image.** The fixed direction still ranked first; the strict coverage rule correctly refused to approve it from incomplete evidence.
2. **Seven downward-looking photos are dominated by repeating floorboards and a large soft or hidden centre area.** Several rotations therefore look almost interchangeable to an edge matcher.
3. **Three photos are dominated by repeating translucent curtain folds.** The camera and laser may not see the same curtain layer, and many vertical folds look alike.

There is no consistent pattern saying that the complete six-camera mapping is rotated, mirrored or shifted incorrectly. The frozen result nevertheless remains a failure: 82 of 96 photos passed, but the rule required all 96.

## What was inspected

A separate exporter reconstructed only the masks already selected in the frozen report. It did **not** rerun the 48-way search, recalculate ranks, change thresholds or reclassify any photo.

- 13 E57 scans were read, using XYZ and organized row/column fields only.
- 22 selected JPEGs were decoded: 14 non-passes and 8 unique same-face passing controls.
- 44 selected geometry masks were reconstructed: the stored primary and stored challenger for each selected photo.
- Point colour and intensity were not requested or read.
- The output contains 14 case sheets, one contact sheet, an HTML index, a blank human-review CSV, a warning and a hash-bound manifest.
- Display lines were widened by one pixel so a human can see them. That display-only widening was not used for scoring.

The private bundle is at:

`C:\Users\blake\omnitwin2\artifacts\t500-reception-e57-geometry-edge-diagnostics-2026-07-14`

Its manifest payload SHA-256 is `26b6e44992a79fd484410156fa4b2158ca37c06ba81b48c044769d9c259b44e1`; the whole manifest SHA-256 is `557eeeb3b14382df44f71b1777d5a467f5dc48c231c70be99c9e8363d66ab7b4`. The bundle contains venue imagery, is not privacy-cleared and must not be published.

## Case-by-case result

| Case | Photo | Frozen result | Post-hoc visual explanation |
|---:|---|---|---|
| 1 | scan 123, Skybox 3 | insufficient geometry | The lower-left quarter has almost no usable scan edge evidence. The fixed direction is still the clear winner. |
| 2 | scan 127, Skybox 5 | mismatch | Repeating timber boards plus the soft central region make several downward rotations look similar. Small shifts do not rescue the fixed direction. |
| 3 | scan 128, Skybox 5 | mismatch | The same downward-view problem; the fixed direction loses by only 0.008 before shifts. |
| 4 | scan 131, Skybox 5 | ambiguous | Repeating floor texture and the soft centre leave too little distinctive evidence. A small shift changes the already-close margin. |
| 5 | scan 132, Skybox 5 | ambiguous | Repeating floor texture and the soft centre produce a near tie; small-shift sensitivity is secondary. |
| 6 | scan 136, Skybox 1 | insufficient geometry | The lower-left quarter is mostly smooth wall/floor with too little scan edge evidence. The fixed direction wins clearly. |
| 7 | scan 136, Skybox 2 | ambiguous | Repeated translucent curtain folds dominate the picture. The fixed direction ranks first, but the shifted lead is 0.019 against a 0.020 rule. |
| 8 | scan 137, Skybox 1 | insufficient geometry | The lower-left quarter again lacks enough scan edges. The fixed direction wins clearly. |
| 9 | scan 137, Skybox 2 | mismatch | Dense repeated curtain folds and layered transparency give weak cross-modality discrimination. A small shift does not rescue the fixed direction. |
| 10 | scan 138, Skybox 5 | ambiguous | Repeating boards and the soft central area create a close result; small-shift sensitivity is secondary. |
| 11 | scan 139, Skybox 4 | insufficient geometry | The lower-right quarter is a largely flat wall and contains no geometry-edge pixels. The fixed direction wins clearly. |
| 12 | scan 141, Skybox 5 | mismatch | Repeating floorboards plus the soft central area make the downward orientations difficult to separate. |
| 13 | scan 142, Skybox 4 | mismatch | The view is dominated by similar vertical curtain folds. The fixed direction is second by only 0.002; the passing control has more distinctive doors. |
| 14 | scan 142, Skybox 5 | mismatch | Repeating floorboards plus the soft central area again make several downward orientations look alike. |

## Evidence for the three patterns

### 1. Missing spatial coverage

All four coverage-blocked photos kept the fixed direction at rank 1. Their missing quarter contained the following geometry-edge support:

| Photo | Missing quarter | Edge pixels in that quarter | Largest 8×8-grid cell | Cells reaching the 25-pixel minimum |
|---|---|---:|---:|---:|
| scan 123, Skybox 3 | lower left | 24 | 16 | 0 |
| scan 136, Skybox 1 | lower left | 31 | 15 | 0 |
| scan 137, Skybox 1 | lower left | 46 | 22 | 0 |
| scan 139, Skybox 4 | lower right | 0 | 0 | 0 |

Plain meaning: these are not demonstrated direction errors. The test declined to approve a direction because one part of each image supplied too little shape evidence.

### 2. Downward floor views

All seven Skybox 5 non-passes show repeating timber-floor structure and a large low-detail centre region in the source-photo panel, before any generated overlay is drawn. The selected pictures cannot identify what created that region. It could be a capture-rig area, stitching, source masking, privacy treatment or another occlusion; it must not be labelled as a person from this evidence.

The same central region also appears in passing Skybox 5 controls, so it is not a failure by itself. Its effect is to remove distinctive evidence from the centre. Repeated floorboards then make several rotations resemble one another. Passing controls generally retain stronger asymmetric clues near the edges, such as a wall or curtain boundary.

As a descriptive post-hoc check, high-frequency detail inside a 70-pixel-radius central disk was only 4.3%–6.5% of the outer-ring level in the seven failed Skybox 5 source panels. Passing Skybox 5 controls were similarly low at 4.5%–6.0%. This confirms that the soft centre is systematic, not unique to the failed cases. It does not prove what caused it or excuse the failed gate.

### 3. Curtain views

The three curtain cases are visually dominated by repeated vertical folds. Among their strongest photo edges, 90.5%–93.9% were vertical. A laser can return from fabric, gaps or a surface behind a translucent curtain differently from a camera, while many adjacent folds still look nearly identical.

This supports repeated-structure and camera-versus-laser ambiguity as the likely mechanism. It is not proof of a global direction error, and curtain dominance alone is not sufficient to fail: some passing controls also contain strong vertical curtains.

## What the computer vision does—and does not—prove

The visual diagnosis explains all 14 non-passes as weak or non-distinctive evidence classes. It found:

- no case sheet that demonstrates a coherent six-face mapping error;
- no repeatable multi-face, multi-station shift pattern that justifies a global camera-calibration correction;
- no basis for changing the frozen mapping, thresholds or held-back decision;
- no permission to create known camera poses, train a model or claim metric geometry.

This is post-hoc diagnosis of an already-opened negative set. It is useful for understanding the failure, but it is not an independent validation. If a future method masks the centre, weights materials differently or combines several cube faces, it must be designed before seeing genuinely fresh control data. The same 16 held-back stations cannot become untouched again.

The 512-pixel diagnostic boards also do not replace full-resolution privacy review. Scan 123 remains quarantined under the earlier full-resolution panorama finding; this selected Skybox 3 board neither proves nor disproves that separate finding.

## Decision and next action

Preserve the geometry-held-back result as a valid negative. Stop critical-path tuning on these 16 E57 stations. Keep all continuous-calibration, metric-geometry, known-pose-materialization and training authorizations false.

The highest-value next technical action is the private Stage-0 actual-route A/B already being built: compare the valid four-leaf Quality SH3 and Mobile SPZ frontiers, retain the invalid all-level and coarse-root controls, test environment on/off, and capture real hero views, spatially different camera centres, an orbit, matrices, Gaussian count, frame rate, GPU memory, load time, hashes and transform provenance. That test can improve visible quality without pretending the E57 pose gate passed.

Full-resolution privacy masks, Reception crop confirmation, fresh independent geometry controls and written E57 processing/derivative/training rights remain required for any future E57 data use.

## Implementation record

- exporter: `tools/reception-hd/export_e57_geometry_edge_diagnostics.py`
- exporter SHA-256: `616a1447acacfa2324039c4a5aeb5ec2f18d4caa464e5d9f0fc27fefcd80d86d`
- tests: `tools/reception-hd/tests/test_export_e57_geometry_edge_diagnostics.py`
- tests SHA-256: `4f3e9468c8303509d75fe15ed2a634bee51a27daaad1ae2da8665d9f2f962476`
- focused exporter tests: 35 passed
- complete Reception HD test suite: 159 passed, 1 Windows privilege-dependent symlink test skipped (160 run)
- source E57: 20,518,437,888 bytes, SHA-256 `975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd`
- frozen held-back report whole-file SHA-256: `ed744eba259c5a40c886af65d8fccf54c36a60ee2e5890449dee0c23f50794a0`
- frozen protocol whole-file SHA-256: `7212244f38a4678cd3e3b60a491c6b2154390d253d9eaa22e0255e16e8cd78d9`

No source mutation, threshold change, outcome recomputation, training, upload, network use, paid compute, signing, publication or rights approval occurred.
