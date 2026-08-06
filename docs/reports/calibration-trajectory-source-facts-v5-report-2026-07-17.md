# Calibration / Trajectory Source Facts V5 report

Date: 2026-07-17
Workstream: T-508, ordinary offline product engineering
Authority: none

## Outcome

The V5 calibration/trajectory slice is implemented and independently audited.
It adds a new immutable receipt-bound Source Facts, Source Readiness and
Operator Evidence chain for bounded UTF-8 CSV and JSON document structure. It
does not widen V1-V4 meanings and does not perform cybersecurity work.

The inspector uses the already-open identity-checked handle. Established facts
carry the exact source byte count and SHA-256, and the outcome, asset and
artifact boundaries recheck those bindings. Cancellation issues no artifact.
Failure code/category pairs are frozen, and format-specific failures cannot be
substituted between CSV and JSON.

## What V5 establishes

- CSV: complete record/field structure, quoting/multiline/line-break counts,
  per-column exact decimal-lexeme summaries and a structural shape digest.
- JSON: complete duplicate-key-safe syntax and bounded tree shape, root kind
  and keys/length, value/container/scalar counts, exact decimal-lexeme summary
  and a structural shape digest.
- Exact binding to the unchanged intake receipt path, byte size and SHA-256.
- Deterministic readiness and operator-evidence requests for every unresolved
  trajectory or calibration fact.

It does not assign column/key meanings, timestamps, cadence, coordinate frame,
CRS, units, transform direction, matrix layout, quaternion order, calibration
applicability, synchronization, accuracy, drift, provenance, rights,
registration, route, worker or execution permission.

## Real read-only evidence

| Source | Bytes | Structural result | Final facts SHA-256 |
| --- | ---: | --- | --- |
| Grand Hall `poses.csv` | 3,659,287 | 42,850 records; 342,800 fields; uniform 8-field structure | `5ad9462a40f5c1be0613d7dd92294fa74d09e677cf9af0441c0d1fbe79cfa461` |
| LCC2 `poses.json` | 542,394 | 54,351 values; depth 5; root keys `poses`, `fusionPoses` | `5e5b9633890c0b5ac9ef158b0d8a676cf462668c3c4814640964f238c6a206ca` |
| E57 original `poses.json` | 39,717 | 1,491 values; 149 root keys | `e2bb832d49d2d431c3c649141df81558b3be11b87dd17f494dc2963ec366ea9f` |
| E57 staged `poses.json` | 37,780 | 1,491 values; 149 root keys | `4d576334862a0fb3017df044149a076e5b020724efc3be0db9449b7309d2f55c` |

The two E57 documents have the same bounded shape digest,
`1a1326d33e6b584963e631f1c041d3608e354306632fc1c18ee680f61437032b`,
but different exact bytes and different complete artifact chains. This is a
shape observation only, not a claim of semantic equivalence.

Real calibration evidence was not available within the frozen V5 target. The
calibration path is therefore fixture-only. No encrypted calibration was
decrypted, copied, renamed or treated as authoritative.

## Product surface and verification

The local app exposes bounded facts plus canonical Source Facts V5, Readiness
V5 and Checklist V5 downloads. Rendered QA covered the Grand Hall source at
1280×720 and 390×844 with no page overflow or console warning/error, and all
three V5 files were confirmed on disk. The final preview/status refinements are
unit-covered; no second rendered-browser or saved-screenshot claim is made.

Final verification:

- focused V5: 28/28;
- Reconstruction Foundry: 567 passed, one existing skip across 44 files;
- local Foundry CLI/app: 240/240 across 17 files;
- shared types: 2,110/2,110 across 91 files;
- package lint, typecheck and build gates passed at the V5 checkpoint, and the
  final targeted lint for every V5-touched CLI file remains clean;
- final exact replay reproduced all four recorded artifact chains;
- independent contract and parser reviews found no remaining actionable defect.

After that clean checkpoint, another concurrent workstream created the untracked
`local-offline-normalization-preview-container-preflight.ts`, whose current
package-wide CLI lint has five unrelated findings. It was preserved. CLI
typecheck, build, 240/240 tests and the V5-targeted lint remain green, so this is
workspace drift rather than a V5 defect.

The exact machine-readable record is
`docs/reports/calibration-trajectory-source-facts-v5-evidence-2026-07-17.json`.
This completes the bounded V5 slice only. T-508 and the broader OmniTwin
Foundry `/goal` remain active.
