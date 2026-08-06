# Reception Room computer-vision triage

This check compares screenshots taken from the same camera. It looks for three
practical warning signs:

1. an edge in the baseline picture disappeared;
2. a second, nearby edge appeared, which can indicate a shifted or doubled
   surface;
3. a large part of the picture or its overall colour changed.

It never edits the screenshots. It also does not decide whether a room is
physically accurate or ready to ship.

## Run the check

From the repository root, run:

```powershell
python tools/reception-hd/triage_fixed_views.py `
  --root <folder-containing-the-fixed-view-png-files> `
  --capture-manifest docs/reports/reception-room-fixed-view-manifest.json `
  --output tools/reception-hd/reports/reception-room-fixed-view-cv-triage.json
```

`--capture-manifest` is optional. When supplied, the tool hashes the manifest
and verifies every used image against its `screenshotIntegrity` list. A
mismatch stops the report instead of silently combining stale evidence.

The default run compares all six named camera views for:

- the valid Mobile SPZ leaf set against the invalid parent-plus-child set; and
- the Quality SH3 source PLY against the valid Quality SOG leaf set.

To compare another pair that uses the same filename pattern, add:

```powershell
--pair baseline-variant-id:candidate-variant-id
```

Use `--pair` more than once to check several pairs. When any `--pair` is
provided, it replaces the two default pairs.

## Make the result visual

After creating the v2 JSON report, turn it into plain-language comparison
boards:

```powershell
python tools/reception-hd/render_triage_report.py `
  --report tools/reception-hd/reports/reception-room-fixed-view-cv-triage.json `
  --screenshot-root <folder-containing-the-fixed-view-png-files> `
  --output <new-empty-output-folder>
```

Each lossless PNG has three panels: the baseline, the candidate and a coloured
difference map. Orange review boards say **computer-vision warning — human
review needed**. Neutral clear-triage boards say that no configured warning
crossed its limit and explicitly say that this is not approval. The renderer
rechecks the report receipt, screenshot hashes, dimensions and stored metrics;
it stops instead of drawing from stale or altered evidence.

## Read the result

- `triage_clear`: none of the pinned warning signals fired. This is not an
  approval or a claim that the candidate is better.
- `review`: at least one warning signal fired. A person should inspect the
  matching screenshot pair.
- `not_assessable`: the baseline was flat, dominated by unstable noise, or had
  too few useful edges. Do not turn this into a pass.

The local/multiscale warning also looks for a large change concentrated in one
part of the frame and for coherent detail loss across three blur scales. These
can be caused by legitimate camera, exposure, contrast, or geometry changes,
so they always lead to review rather than a quality conclusion.

The v2 JSON stores the SHA-256, size, dimensions, and usage of every PNG it
actually reads. It also binds the optional capture manifest, this tool's source
bytes, Python and package versions, and the complete report with a canonical
SHA-256 receipt. It stores basenames only, not the local input folder.

## Run the adversarial tests

```powershell
python -m unittest discover -s tools/reception-hd/tests -p "test_*.py" -v
```

The tests cover an exact structured match, doubled and faint ghost edges,
missing edges, a local occlusion, blur, gross colour drift, flat and noisy
inputs, mismatched dimensions, path sanitisation, manifest verification, and a
one-byte input change altering the report receipt.

## Check whether E57 room photographs are technically usable

The room-image audit answers a different question from screenshot comparison:
does one selected E57 scan range contain a complete, decodable set of embedded
skybox images and declared camera metadata worth taking into a direct
laser-to-photo reprojection test?

The primary candidate is not the loose 1536-pixel cube-view folder. The audit
opens the E57 itself and reads each embedded 4096×4096 `Image2D` skybox JPEG, its
unique GUID, pinhole intrinsics, rotation, translation, and associated scan
GUID. Loose panoramas and cube views are checked only as diagnostics.

```powershell
python tools/reception-hd/audit_e57_room_images.py `
  --e57 "F:\E57\cloud_0.e57" `
  --panoramas "F:\E57\equirect_fixed" `
  --cubefaces "F:\E57\cubemaps_photo_v3" `
  --scans 122-144 `
  --visual-review docs/reports/reception-room-e57-visual-review-2026-07-14.json `
  --panorama-derivation-script "F:\E57\extract_equirect_v2.py" `
  --panorama-derivation-report "F:\E57\equirect_fixed\_equirect_v2_report.json" `
  --cubeface-derivation-script "F:\E57\extract_photos_v3.py" `
  --cubeface-derivation-report "F:\E57\cubemaps_photo_v3\_extract_v3_report.json" `
  --output <new-report.json>
```

The audit performs these read-only checks:

- fully fingerprints the E57 source and every used JPEG;
- reads only the selected E57 pose headers, never the point records;
- fully decodes and fingerprints all embedded E57 `Image2D` JPEG blobs for the
  selected stations;
- verifies six unique images per station, one shared camera centre, normalized
  rotations, a complete six-direction camera rig, and internally consistent
  pinhole intrinsics;
- fully decodes the 8192×4096 panoramas and six 1536×1536 cube views per
  station;
- records exposure and multiscale detail signals without turning them into a
  misleading single “quality score”;
- checks panorama continuity after allowing a horizontal yaw shift;
- records the camera-station spread; and
- records an explicitly blocked generic E57-to-COLMAP conversion candidate;
  the file-specific reprojection audit below determines whether this E57's raw
  JPEG bytes need a pixel transform;
- refuses to pose-bind the loose 1536-pixel cube views after a systematic
  orientation inconsistency was observed;
- proposes a spatial train/validation/test split by whole station, so six
  images from one camera centre can never leak across evaluation sets.

It also hashes the existing derivation scripts and reports. A list of scan
names or matching hashes is not authenticated lineage. Older partial or
overwritten run reports remain useful descriptive evidence, but they cannot
make the filenames pose-authoritative.

The result is still `known_pose_not_ready_reprojection_and_review_required` and
has authority `none`. A high visual
correlation cannot prove room identity, a camera spread cannot prove surface
coverage, and possession of an E57 export cannot establish commercial
training permission. The face-pose convention also needs an independent
reprojection fixture before COLMAP or a trainer may rely on it.

The optional visual-review file can quarantine a visibly contaminated station
conservatively, but it reviews hash-bound loose panoramas—not every embedded
Image2D JPEG. No station is cleared until a person checks the embedded images
at full resolution. The audit never copies, stages, uploads, reconstructs,
trains on, or publishes the image bytes.

## Check the native photo directions against coloured LiDAR

This second audit reads coloured 3D points from the E57 and projects them into
each embedded JPEG. It tries 48 possible cube directions, including mirrored
ones. It learns one six-name mapping from a discovery group, freezes that
mapping, and tests it unchanged on separate held-out stations.

```powershell
python tools/reception-hd/audit_e57_lidar_reprojection.py `
  --e57 "F:\E57\cloud_0.e57" `
  --scans 122-144 `
  --discovery-scans 124,125,127,128,130,132,133,135,136,137,139,142,143,144 `
  --maximum-points 120000 `
  --analysis-size 512 `
  --output docs/reports/reception-room-e57-lidar-reprojection-2026-07-14-v2.json
```

The 2026-07-14 version-2 run passed all 138 images: 84 discovery images and 54
held-out images. The lowest NCC was 0.959714 against a 0.85 gate. The smallest
lead over the best adequately covered alternative was 0.104339 against a 0.10
gate. No held-out image selected a different direction. All 23 stations formed
a complete, proper, non-mirrored six-direction rig.

For this E57, the unchanged raw JPEGs match the stored Image2D rotations after
the camera-axis conversion `diag(1,-1,-1)` and the continuous principal-point
rule `cy_raw = imageHeight - cy_e57`. Do not additionally flip the JPEG pixels.

This is strong internal evidence, not independent physical calibration. E57
point colours may have been made from the same JPEGs. The report therefore
keeps `knownPoseMaterializationPermitted` and `trainingPermitted` false. A
separate geometry-only edge check was therefore run; its strict held-back gate
did not pass. Full-resolution native-image review, privacy masks, room/crop
confirmation, continuous calibration and rights approval are also still
required.

The original non-v2 report is preserved but superseded because one secondary
micro-angle field compared rounded axes without normalising them. Version 2
corrects that field; the pass/fail result and all practical score values are
unchanged. The corrected implementation passes 57 adversarial tests.

## Check the photo directions without using LiDAR colour

The geometry-edge audit is a genuinely different computer-vision check. It
reads only XYZ plus organized row/column numbers from each E57 point record;
`colors=False` and `intensity=False` are enforced. It decodes the embedded JPEG
because the JPEG edges are the comparison target, but it never requests or
reads E57 point RGB.

In plain language, it projects wall, doorway, furniture and other 3D shape
edges into each photo. It independently rasterizes 48 possible rotations and
mirrorings and gives every candidate the same set of small ±4-pixel shifts.
The fixed direction must rank first before and after those shifts and must beat
the next-best candidate by the frozen margins. Edge evidence must also span at
least 12 cells, 3 rows, 3 columns and all 4 image quarters.

The separate 240-translation calculation asks whether the **exact pixel
location** is unique. It is reported as `UNIQUE`, `NONUNIQUE` or
`UNASSESSABLE`. It cannot veto a discrete cube direction and cannot approve
continuous calibration.

The exact commands, split, thresholds and safety rules are in
`tools/reception-hd/README-geometry-edge-audit.md`.

### Why there are v1 and v2 development reports

The first development design is preserved at
`docs/reports/reception-room-e57-geometry-edge-development-2026-07-14.json`.
It failed because exact-location translations were allowed to veto a direction
result and one image missed an old 24-cell count. Review showed that long room
edges can slide along one another, so that translation test does not answer
the same question as cube orientation.

Version 2 openly records a post-development rule change: exact location became
diagnostic-only, and coverage became a distributed rows/columns/quadrants
check. The revised tool and thresholds were tested, independently reviewed and
frozen before the 16 geometry-held-back stations were opened. All 42
development photos passed v2.

### One-shot held-back result

The frozen held-back run was performed once over 16 stations / 96 photos. Its
overall result was `REJECT_GEOMETRY_MISMATCH`:

- 82 photos passed every frozen rule;
- 6 ranked another direction above the fixed direction;
- 4 kept the fixed direction first but missed a margin;
- 4 kept the fixed direction first but did not carry edge evidence into all
  four image quarters;
- only 5 of 16 stations passed on all six faces;
- 70 exact-location diagnostics were `UNIQUE`, 13 `NONUNIQUE` and 13
  `UNASSESSABLE`; those labels did not change the direction decision.

Seven of the 14 non-passes were the downward-looking `Skybox 5`. Post-hoc
pair-sheet review found a large soft or hidden central region in both failures
and same-face passing controls, so that region alone cannot explain failure and
its source cannot be identified from these boards. Repeating floor texture plus
lost central evidence is the best-supported explanation for weak direction
discrimination. The frozen result remains failed.

The sealed records are:

- v1 development whole-file SHA-256
  `d8307d8547ba2bce44f87a3173497a83762f98c994e13af272d95c21a24f941a`;
- v2 development whole-file SHA-256
  `96a9fd87a9a78a68b4ebe3f699f313e1f56d985ce40856532198b40a29435389`;
- v2 protocol whole-file SHA-256
  `7212244f38a4678cd3e3b60a491c6b2154390d253d9eaa22e0255e16e8cd78d9`;
- v2 held-back report whole-file SHA-256
  `ed744eba259c5a40c886af65d8fccf54c36a60ee2e5890449dee0c23f50794a0`.

Do not tune v2 and rerun the same 16 stations as though they were still held
back. The 14-case visual diagnosis is complete and may be used only to
understand why the evidence was weak. Any replacement validation requires
fresh, independently controlled data. Materialization, training, metric use,
privacy clearance and rights approval remain false.

## Build the private failure-versus-pass diagnosis boards

`export_e57_geometry_edge_diagnostics.py` creates one easy-to-read sheet for
each of the 14 non-passes. The failed photo is on top and a same-face passing
control is underneath. Each row shows the source photo, the frozen primary
mask and the frozen challenger mask.

Run from the repository root:

```powershell
python tools/reception-hd/export_e57_geometry_edge_diagnostics.py --e57 F:\E57\cloud_0.e57 --protocol docs/reports/reception-room-e57-geometry-edge-protocol-v2-2026-07-14.json --heldout-report docs/reports/reception-room-e57-geometry-edge-heldout-v2-2026-07-14.json --output-dir artifacts/t500-reception-e57-geometry-edge-diagnostics-2026-07-14
```

The destination must not already exist. The exporter verifies the exact E57,
protocol and held-back report before reading 13 selected scans and 22 selected
photos. It reconstructs only the 44 masks needed for the boards. It does not
call the full audit, recompute candidate ranks or change a frozen outcome. It
requests `colors=False` and `intensity=False`, performs no network access and
publishes the complete directory atomically.

The 2026-07-14 run created 19 files: 14 case PNGs, one contact sheet, one HTML
index, one blank human-review CSV, one private-data warning and one manifest.
The manifest payload SHA-256 is
`26b6e44992a79fd484410156fa4b2158ca37c06ba81b48c044769d9c259b44e1`.
The output is local, private and not privacy-cleared. Do not commit or publish
its venue pixels.

The resulting visual diagnosis is recorded in
`docs/reports/reception-room-e57-geometry-edge-visual-diagnosis-2026-07-14.md`.
It classifies the 14 cases as four incomplete-coverage views, seven repetitive
downward floor views and three repetitive curtain views. This is post-hoc
explanation, not fresh validation, calibration or training approval.
