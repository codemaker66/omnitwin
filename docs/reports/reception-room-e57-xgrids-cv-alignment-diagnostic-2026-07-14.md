# Reception Room E57 ↔ XGRIDS computer-vision alignment diagnostic

Date: 2026-07-14  
Task: T-515  
Authority: none  
Decision: the local computer-vision path works as a diagnostic, but the measured candidate is not accurate or unambiguous enough for T-505, training, runtime use, or publication.

## Plain-language result

Yes, the two 3D captures can be compared automatically. The exact real-data run confirmed that the E57 and XGRIDS files contain strongly overlapping Reception Room structure. It also found the reason the result cannot yet be approved: when the program was allowed to test every axis orientation, a mirrored/improper alternative fitted the held-back geometry slightly better than the selected proper transform. The selected transform also missed the strict accuracy and coverage targets by a large margin.

This is useful progress. It replaces “the rooms look alike” with reproducible numbers and a fail-closed tool. It does **not** create an approved room transform.

## Delivered tool

- `tools/reception-hd/align_e57_xgrids.py`
  - 90,503 bytes
  - SHA-256 `d8c5b1c00505a9ae3fb90071fe351bf3003330a784f724facb8d67c34761092d`
- `tools/reception-hd/tests/test_align_e57_xgrids.py`
  - 36,479 bytes
  - SHA-256 `2a5551615ab03759b108e7a5b26a70db6536f385c9bd583cafc54cfaeb65597b`

The CLI has two modes:

1. `preflight` fully binds the exact E57, capture-stage manifest, Reception scope evidence, XGRIDS PLY, XGRIDS poses, and tool bytes.
2. `diagnose` reads organized E57 geometry, checks every declared PLY vertex XYZ, fits proper and improper candidates, preserves frozen validation scans, and reports bidirectional untrimmed and trimmed distances.

Both modes are read-only over source data. Receipts are create-only, private, authority-none JSON. The tool cannot register a `TransformArtifactV0`, approve rights, start training, call a provider, alter runtime state, sign, publish, or spend money.

## Exact real inputs

| Input | Bound identity |
|---|---|
| Staged E57 | 20,518,437,888 bytes; 149 scans; SHA-256 `975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd` |
| Capture-stage manifest | SHA-256 `c044823c232dae518df84140c90004a1c17dc682c84885d6f36848933d72ddff` |
| Reception scope evidence | file SHA-256 `aba2f18be28e38ece5d5f67f2f64172f2134a36768dfe92772262674f8ea0b32`; payload SHA-256 `d836904a15c8f650321d19f593506ac39a29a5c3a59a9bb0386cae4d751e8cbc` |
| Quality SH3 XGRIDS PLY | 496,504,970 bytes; 2,002,028 declared vertices; SHA-256 `da8efa94895ef7aa2c6024336278d855fdb13026bf10028901c3ac46d1e91a3d` |
| XGRIDS pose path | 4,529 ordered poses; SHA-256 `d9822320412473bf8dd4681910abf395b2957a1d24612064354944fe8581881f` |

The production identity pin rejects the unrelated 1.15 GB, nine-scan Downloads lobby file before geometry processing.

## Reproducible real receipts

The private local receipts are under `output/playwright/reception-hd-investigation/` and are ignored by normal source control.

| Receipt | Result | Internal receipt digest | Whole-file SHA-256 |
|---|---|---|---|
| `private-t515-preflight-2026-07-14.json` | `preflight_complete_t505_blocked` | `b550166a28e1c59255009e1254db9413309e2febf7f549ee9b13adf8e039e8f0` | `2923f44c9fa4d22cdb29faefe2a084fed029aa4c0085cfd7f85fbfe27f6e7e18` |
| `private-t515-diagnostic-2026-07-14.json` | `diagnostic_complete_t505_blocked` | `3f05ef356b6edaf41ed5464b9b875d2881758d4118fc6ef0533cafd03c00bd93` | `c87aa8a4c96c9e86601013b41287b2019556b384fc868b206cfdb95759afdba2` |

The diagnostic used:

- fit scans `124,125,127,128,130,132,133,135,136,137,139,142,143,144`;
- validation scans `131,134,138`, never used to initialize or update the fit;
- test scans `126,129,141`, not read by this diagnostic;
- boundary/quarantine scans `122,123,140`, excluded from fitting and validation;
- deterministic organized row/column E57 sampling;
- 40,000 deterministic XGRIDS Gaussian centres;
- scale fixed to exactly `1.0` metre per unit;
- 24 proper and 24 independently optimized improper/mirrored axis starts.

## Measured outcome

The operator-proposed diagnostic targets were the current quality-contract pilot values: validation RMSE at most 20 mm, validation p95 at most 35 mm, and at least 90% overlap in both directions within 50 mm.

| Validation measurement | Result | Target | Outcome |
|---|---:|---:|---|
| Combined bidirectional RMSE | 421.8 mm | ≤ 20 mm | failed |
| Combined bidirectional p95 | 646.9 mm | ≤ 35 mm | failed |
| Minimum directional overlap within 50 mm | 9.85% | ≥ 90% | failed |
| Combined median | 138.1 mm | descriptive | — |
| 95%-retained combined RMSE | 203.8 mm | descriptive only | — |

Trimming does not rescue the result. The receipt retains the untrimmed maximums and both directions so missing coverage and outliers cannot disappear behind one favorable number.

The selected proper candidate had determinant `+1`, fixed scale `1.0`, and this **diagnostic-only, do-not-use** XGRIDS→E57 transform:

```text
R =
[ 0.9914160311,  0.1305757179, -0.0066509535]
[ 0.1307449740, -0.9901599727,  0.0498896797]
[-0.0000711272, -0.0503310070, -0.9987325892]

t = [18.2878669362, 1.6968381673, -1.7193253233] metres
```

This orientation flips the vertical axis almost completely. More importantly, the separately optimized improper/mirrored candidate scored slightly **better** on frozen validation: RMSE 414.2 mm versus 421.8 mm for the proper candidate, and 13.14% versus 9.85% minimum overlap at 50 mm. The required negative-control separation therefore failed. A deliberately wrong 37-degree rotation scored much worse at 954.3 mm RMSE, so the data contains a real alignment signal, but not enough unique physical evidence to settle handedness and orientation safely.

## What the computer vision proved

- The exact staged E57 and exact Quality SH3 XGRIDS cloud have substantial same-room structural signal.
- A wrong unrelated E57 is rejected by byte identity before use.
- The room cannot be approved from a favorable one-way or trimmed ICP number.
- The current uncropped E57 station geometry plus Gaussian centres is ambiguous under mirror/axis alternatives.
- The current source combination does not meet the provisional 20 mm / 35 mm / 90% diagnostic targets.

## What it did not prove

- reviewed physical room identity or a reviewed room-local E57 crop;
- rights to process, derive, train on, distribute, or publish either source;
- physical handedness or an independently measured scale;
- survey/control accuracy;
- privacy clearance of the native E57 photographs;
- fixed-view human acceptance;
- complete PLY face/non-vertex validation;
- a reviewed, signed, or registered `TransformArtifactV0`;
- eligibility for T-502, runtime, public exposure, or release.

## Verification

- focused alignment suite: 25/25 passed;
- full `tools/reception-hd` suite: 202 passed, 2 environment-dependent skips;
- Python compilation: passed;
- `git diff --check`: passed;
- independent red-team review: clean for the authority-none CLI claim, with no remaining P0–P3 defect.

The receipts explicitly state that hash-before/hash-after cannot defeat an adversarial mutate-then-restore during an open read. Stronger custody requires an externally immutable or read-only source mount.

## Next technical move

Keep T-505 open. The next useful computer-vision slice is a gravity-constrained, room-crop-aware private overlay package with top, two side, oblique, and bidirectional distance views. It must show full context as well as the candidate crop, retain scan 122 as boundary evidence, and label Gaussian centres as appearance primitives rather than surveyed surfaces. Even a much better gravity-constrained fit cannot replace the missing rights decision, reviewed crop/identity, independent controls, or human transform review.
