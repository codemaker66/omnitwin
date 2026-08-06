# Reception Room matched-camera computer-vision check

Executed overnight on 16–17 July 2026. This is experimental evidence with **authority none**. It is not physical approval, a rights decision, or permission to promote a runtime asset.

## Direct answer

Yes. Computer vision can do this job in two linked stages:

1. Line the XGRIDS room model up with the E57 survey using the walls, floor, and ceiling.
2. Put both reconstruction candidates at the same real E57 camera positions and compare them with the real E57 photographs.

The first stage is strong. The correct room alignment beat a deliberately mirrored wrong alignment by 24.03% on held validation geometry. The typical validation-scan-to-model gap was 3.47 cm.

The second stage gives the Quality candidate a **slight directional lead under the frozen primary rule**, but not a physically proven win. One reasonable border sensitivity check changes the result from “Quality leads” to “no reliable winner.” The safe product decision is therefore:

- keep Quality as the current review leader;
- keep Mobile as a live alternative;
- do not automatically promote either candidate from this evidence alone.

## What passed

| Check | Result | Meaning |
|---|---|---|
| Exact Potree decoding | Pass | 175,237 points and all hierarchy byte ranges were decoded and checked. |
| No hand-entered control points | Pass | The 3D alignment was found from room surfaces. |
| Correct direction versus a mirror | Pass | Proper alignment beat the best mirrored competitor on fit and held validation. |
| Fit stability | Pass | Two independent seven-station fits differed by 0.0137° and about 1 cm horizontally. |
| Separate validation geometry | Pass | Scans 131, 134, and 138 were not used to fit the transform. |
| Exact matched cameras | Pass | Both candidates were rendered from the same three E57 camera positions, up vectors, and 90° field of view. |
| Render repeatability | Pass | Independent repeat captures for both candidates were byte-for-byte identical. |
| Frozen primary image rule | Directional pass for Quality | Quality won 2/3 views on edge distance and 3/3 on normalized gradient orientation. |
| Practical size of the visual difference | Not established | No evidence-backed materiality threshold exists for this room. |
| Sensitivity to reasonable preprocessing | Partial | Three setups lead toward Quality; the largest permitted border produces no reliable winner. |
| Physical accuracy approval | Not established | The images and E57 are not independent surveyed control measurements. |

## Geometry evidence

The selected XGRIDS-to-E57 transform keeps scale at exactly 1 and keeps vertical upright:

- horizontal rotation: 167.618744442°;
- translation: `[13.129636871, 1.864579076, -1.467248041]` metres;
- determinant: +1, so it is a proper transform rather than a reflection;
- fit-only wall error: 2.54 cm after the frozen 75% trim;
- mirrored fit error: 10.83 cm;
- held validation combined error: 21.14 cm proper versus 27.83 cm mirrored;
- held validation scan-to-model median: 3.47 cm;
- held validation scan-to-model 95th percentile: 6.94 cm.

The combined error is larger because three validation stations do not see every surface in the complete room model. The scan-to-model direction is the fairer coverage measure.

Main geometry artifacts are under `C:\tmp\reception-potree-e57-feasibility-2026-07-16`:

- `experiment-report.md` — plain-language geometry report;
- `validation-proper-vs-mirror.json` — held-validation receipt;
- `validation-proper-vs-mirror-overlay.png` — human visual;
- `potree-xgrids-frame-relationship.json` — proof that Potree, Quality PLY, and LCC2 already share the same metre frame.

## Matched-camera image evidence

Three native 4096 × 4096 E57 photographs were used: Skybox 4 from scans 131, 134, and 138. Both candidates were captured at 1024 × 1024 with identical camera settings. The browser loaded all four sources for each candidate:

- Quality: 2,002,009 loaded splats;
- Mobile: 1,978,258 loaded splats.

The browser candidate-switch control preserved the exact camera position and showed the development-only message `Experimental E57-matched camera · no physical approval`. Browser diagnostics contained no errors. A non-blocking Three.js shader signed/unsigned warning was present.

The camera values are reproducibly derived by `tools/reception-hd/build_e57_matched_camera_views.py` from the frozen proper registration receipt and the existing E57 LiDAR-reprojection receipt. The tool does not open the raw E57, JPEG bytes, or pose JSON. It rejects mirrored registration, wrong scans or faces, failed pose evidence, non-square intrinsics, malformed records, duplicate JSON keys, and output collisions. Its create-only receipt is `reception-e57-matched-camera-views-2026-07-16.json` with file SHA-256 `06fea12e3933cd0e2cffa524986fe1ad6765b33306e3a9da453cb508f01ded82`.

The captures used the same camera values rounded to nine decimal places; the receipt preserves 17-digit round-trip values. The largest position difference is below one micrometre, far below the centimetre-scale registration uncertainty.

Primary scorer result:

- status: `directional_lead`;
- candidate: `quality`;
- Quality view wins: edge distance 2/3, gradient orientation 3/3;
- Mobile view wins: edge distance 1/3, gradient orientation 0/3;
- practical materiality: `not_calibrated`;
- physical approval: false;
- runtime-promotion approval: false.

The two aggregate metrics do not tell an identical story. Mean edge distance slightly favours Mobile by about 0.36%, while mean normalized gradient orientation slightly favours Quality by about 0.22%. The predeclared majority-of-views rule produces the Quality directional lead. This disagreement is another reason not to call the result a physical winner.

Private matched-camera artifacts are outside the repository in `C:\Users\blake\Documents\Codex\2026-07-12\new-chat-2`:

- `reception-e57-matched-cv-final-result-2026-07-16.json` — primary authority-none receipt;
- `reception-e57-matched-cv-final-contact-sheet-2026-07-16.png` — labeled human-review sheet;
- `reception-e57-matched-camera-views-2026-07-16.json` — reproducible full-precision camera receipt;
- `reception-e57-matched-cv-input-2026-07-16.json` — exact primary manifest;
- `private-reception-validation-jpegs-2026-07-16` — private E57 references;
- `private-reception-e57-matched-renders-2026-07-16` — private candidate renders and repeats.

The E57 photographs contain static architecture in the reviewed views, but they have not been granted publication or training rights. They remain private.

## Sensitivity checks

These checks were run after the primary result and are labeled sensitivity analyses. They do not replace or silently rewrite the frozen primary rule.

| Comparison setup | Result |
|---|---|
| 1024 px, 24 px border — primary | Quality directional lead |
| 1024 px, no border removed | Quality directional lead |
| 512 px, 12 px border | Quality directional lead |
| 1024 px, 48 px border | No reliable winner |

No setup produces an overall Mobile lead. The 48 px result shows that the Quality lead is not fully robust to every allowed preprocessing choice.

## Adversarial findings and fixes

An independent code review found four problems in the first registration diagnostic. All four were fixed before accepting the tool:

1. A test-only scan adapter could overstate what data had been read. Custom adapters are now internal-test-only, fail closed, and produce unusable receipts with unknown side-effect claims.
2. A reflection was being given a mathematically meaningless ordinary rotation angle. Mirror angle is now null and marked not applicable.
3. A wrong large Potree file could be read before its size was rejected. All three exact pinned sizes are now checked before reading payload bytes, then checked again against snapshots and hashes.
4. A nearly tied normal-versus-mirror result could flip with floating-point noise. A result now needs to beat `max(1 mm, 0.5%)`; otherwise it remains ambiguous.

The image scorer also keeps full-precision decisions, reports signed and relative effect sizes, and explicitly says that no practical-effect threshold has been calibrated.

## Tools and verification

New reusable tools:

- `tools/reception-hd/register_potree_e57.py` — hardened Potree/E57 diagnostic;
- `tools/reception-hd/build_e57_matched_camera_views.py` — strict E57-to-viewer camera derivation;
- `tools/reception-hd/compare_matched_renders.py` — exact-camera structural image scorer and contact-sheet builder;
- `packages/web/src/pages/living-hall/reception-experimental-camera.ts` — strict development-only camera input.

Checks completed:

- 38 focused alignment/registration tests passed; one Windows symlink-privilege test skipped;
- 8 focused matched-camera derivation tests passed;
- 12 focused image-scorer tests passed;
- 22 focused web tests passed;
- web TypeScript passed;
- scoped web lint passed;
- browser rendering passed for both candidates.

## Exact remaining gap

This experiment supports a cautious Quality preference, not a final physical-quality winner. The decisive next test is to freeze this exact camera and scoring protocol, then run it once on the method-specific holdout stations 126, 129, and 141 without changing thresholds afterward. Those stations have appeared in earlier repository diagnostics, so they must be described as a holdout for this matched-render method, not as data that has never been inspected anywhere.

Independent surveyed control points or a fresh, separately captured photographic survey would still be required for a strong physical-accuracy claim. Human venue review is also needed before calling a subtle visual difference “more beautiful.”
