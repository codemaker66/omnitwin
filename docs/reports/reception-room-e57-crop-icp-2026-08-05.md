# Reception Room E57 crop + preview registration — T-505 candidate fit

**Status:** candidate fit, authority none — not reviewed, no surveyed control, no calibration/rights change. T-502 remains gated on a human-reviewed TransformArtifactV0.
**Date:** 2026-08-05
**Spec followed:** `docs/operations/portalcam-raw-audit-2026-07-16.md` §4 workflow, unblocked by the §8 review pack and Blake's 2026-08-05 room-identity review (relayed phone verdict; PNG hashes re-verified this session against `review-record-2026-08-05.json`).
**Full receipt:** `F:\VenviewerReconstructionWork\reception-preview-cloud-2026-08-05\e57-crop-icp-2026-08-05\crop-icp-result-2026-08-05.json`.

## What ran

The confirmed room-crop seed (vendor preview cloud, 175,237 pts) was globally registered to the venue, refined by ICP, and used to crop a room-local E57 reference; the preview was then final-fitted against that crop. Entirely local compute (numpy + stdlib; own ASTM-E2807 reader after the sandbox proved network-less). Scan selection landed on **E57 sweeps 122–144 by station-in-polygon** — independently matching the July contact-sheet evidence — with **frozen scans 126/129/141 never decoded, fitted, or included**. Two declared deviations from §4's lettered mechanism (FFT 4-DoF global search instead of unavailable Open3D FPFH+RANSAC; station-based scan selection because per-scan cartesianBounds are venue-wide) are recorded in the receipt with a workstation confirmation step left open.

## Result

| Metric (forward, preview→E57 crop) | July 14 baseline | This fit |
|---|---|---|
| Cropped RMSE | 319.6 / 334.5 mm | **14.4 mm** |
| p95 | 668 / 826 mm | **29.6 mm** |
| Within 50 mm | 14.5% / 18.4% | **76.9%** |
| Median | — | **9.0 mm** |
| Matched @30 cm gate | — | 77.0% |

Reverse direction (E57 4 cm subset → preview): median 37.1 mm — bounded by the preview's own point spacing, consistent with density rather than misregistration (the July "mirror better in reverse" symptom is absent). Rotation is 167.76° about z with 0.16° residual tilt; rigid fit — the 9 mm median implies metric scale agreement between the two independent captures. Floor-level ambiguity was resolved by evidence (winner 91.2% matched vs runner-up 35.9%).

Outputs (work folder `e57-crop-icp-2026-08-05/`): `reception-e57-crop-1cm.ply` (10,706,822 pts, 1 cm voxel, Matterport model frame, sha256 `d6b8a6df…6848`, full-res regeneration recipe in receipt), three fixed-view overlays (top-down + two elevations; wall traces coincide visually), the receipt JSON, and `proposed-transform-artifact-v0-draft.json` (schema-adjacent; promotion requires a human transform review — the schema itself enforces a human reviewer).

## What this does and does not establish

It establishes: the §4 unblock thesis worked — a confirmed room-only seed converts the previously failing whole-venue fit into a tight room fit; the E57↔XGRIDS lineage-independent geometric agreement for this room is at the centimetre level over 77% of the preview cloud; the open-format toolchain (potree preview decode + own E57 reader, counts verified against XML) suffices end-to-end. It does not establish: surveyed accuracy (control-point column pending T-480 ingestion), a reviewed transform (T-502 gate intact), calibration/rights, or anything about the frozen validation scans.

## Next decisive steps

1. Blake: review the three overlays + residual table → if accepted, promote the draft to a reviewed TransformArtifactV0 (unlocks T-502's gate).
2. Workstation confirmation run of §4's named mechanism (Open3D FPFH+RANSAC → point-to-plane ICP) against the same pinned inputs.
3. T-480 control ingestion → control-point-error column → accuracy tier.
4. Held-back validation pass using frozen scans 126/129/141 (design first; do not consume casually).
