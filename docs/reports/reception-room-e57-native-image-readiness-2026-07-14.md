# Reception Room native E57 computer-vision result

**Date:** 2026-07-14  
**Room candidate:** E57 scans 122–144  
**Decision:** the colour-based direction check passed, but the separate colour-blind 3D-shape check failed its strict held-back test. Do not create a training dataset or treat these camera poses as approved.

## Short answer

Yes, computer vision can test these images, and two different computer-vision checks have now been run.

1. **Colour check:** compare the colour stored on the laser points with each embedded photo. All 138 photos passed.
2. **Shape check:** ignore the laser-point colours and compare 3D shape edges—such as wall, doorframe and furniture edges—with photo edges. This check passed 82 of 96 held-back photos, but 14 did not pass. Because the rule required every photo to pass, the final shape result is **failed**.

The result is useful, but it is not an approval. The fixed six-direction mapping is strongly supported by colour and by most shape comparisons, yet the same-E57 cross-modality shape evidence contains real exceptions. Those exceptions have now been diagnosed visually: four lack well-spread geometry, seven downward views are weakened by repeating floorboards and a soft central region, and three are dominated by repeating translucent curtain folds. That post-hoc explanation is not fresh validation and must not be used to change the failed test after seeing its result.

Training, automatic COLMAP creation, continuous camera calibration and measurement use all remain blocked.

## Exact source

Both checks used this file without changing it:

- file: `F:\E57\cloud_0.e57`
- size: 20,518,437,888 bytes
- SHA-256: `975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd`
- selected stations: 23, numbered 122 through 144
- embedded photos: 138, exactly six per station
- photo size: 4096×4096 pixels
- embedded JPEG bytes read and hashed by the colour audit: 359,565,008

## Check 1 — laser-point colour versus photo colour

The colour check learned one mapping from 14 stations / 84 photos. It then froze that mapping and tested it unchanged on the other 9 stations / 54 photos.

| Check | Result | Plain meaning |
|---|---:|---|
| Complete native image set | 138 / 138 | Every selected station has six readable embedded JPEGs. |
| Development pass | 84 / 84 | Every photo used to learn the mapping passed. |
| Colour-held-back pass | 54 / 54 | The same frozen mapping passed every photo in that colour test group. |
| Direction disagreements | 0 | No colour-held-back photo preferred a different direction. |
| Proper, non-mirrored rig | 23 / 23 stations | Every station produced six distinct directions with the required handedness. |
| Colour agreement, minimum / median / maximum | 0.959714 / 0.984797 / 0.997269 | The required minimum was 0.85. |
| Lead over the next plausible direction, minimum / median / maximum | 0.104339 / 0.571526 / 0.798487 | The required minimum was 0.10. |
| Image-area coverage | 60–64 of 64 cells | The colour agreement was spread across nearly the whole image. |

The fixed mapping tested by both checks is:

| Embedded name | Forward direction in its laser-station frame | Image-right direction |
|---|---|---|
| Skybox 0 | +Z | −Y |
| Skybox 1 | +X | −Y |
| Skybox 2 | −Y | −X |
| Skybox 3 | −X | +Y |
| Skybox 4 | +Y | +X |
| Skybox 5 | −Z | −Y |

All six directions are proper rotations, not mirror images.

This is strong internal evidence, but it is not independent geometry evidence: the E57 laser-point colours may have been made from these same JPEGs.

## Check 2 — colour-blind 3D shape versus photo edges

This second check asked a harder, different question. It read only laser XYZ positions and organized row/column numbers. It did **not** request or read laser-point RGB values. The embedded JPEG was decoded only so that its visible edges could be compared with the projected 3D shape edges.

For every photo, the program:

- projected shape edges from the organized laser grid;
- tried 48 rotations and mirrorings;
- gave every candidate the same set of small ±4-pixel position adjustments;
- required the fixed direction to rank first and beat the next candidate by the frozen margins;
- required enough edge evidence across at least 12 cells, 3 rows, 3 columns and all 4 image quarters.

The geometry development group was 7 stations: 122, 124, 126, 130, 134, 140 and 144. The geometry-held-back group was the other 16 stations: 123, 125, 127, 128, 129, 131, 132, 133, 135, 136, 137, 138, 139, 141, 142 and 143.

“Held back” here means held back only from development of this XYZ-only edge metric. These images were already seen by the earlier colour and visual work, so they are not globally untouched.

### Transparent development history

The first development design did **not** pass. It allowed an exact-pixel-location translation test to veto a six-direction result, and it used a simple 24-cell coverage count. That first report is preserved unchanged.

Review found that the 240 translations tested exact pixel placement, not which cube direction was correct. Long straight room edges could slide along one another. Version 2 therefore reports that translation result separately as `UNIQUE`, `NONUNIQUE` or `UNASSESSABLE`; it does not let it approve continuous calibration or veto a discrete direction. Version 2 also replaced the simple 24-cell count with the distributed row/column/quadrant rule above. This was a **post-development rule change**, recorded openly.

Version 2 passed all 42 development photos. The recorded workflow describes the next run as a declared one-shot, metric-held-out, same-E57 cross-modality check, and the local artifacts are internally consistent with that workflow.

These are unsigned, `authority: none` local artifacts. They cannot prove the actor, chronology, uniqueness of the run, or absence of prior access. The 16 scans were held out only from tuning this XYZ-edge metric; they already existed in the earlier colour and visual work and are not globally unseen.

### Held-back result

The recorded, declared one-shot held-back outcome was `REJECT_GEOMETRY_MISMATCH`.

| Check | Result | Plain meaning |
|---|---:|---|
| Full geometry pass | 82 / 96 photos | These photos passed every frozen direction, margin and evidence check. |
| Fixed V2 candidate was not rank 1 | 6 / 96 | Another rotation or mirroring scored above the fixed V2 candidate. |
| Fixed V2 candidate was rank 1, but lead too small | 4 / 96 | The result was too close to call under the frozen margin. |
| Edge evidence not spread through all 4 quarters | 4 / 96 | The fixed V2 candidate was rank 1, but the evidence did not cover the whole image as required. |
| Fixed V2 candidate ranked first before small shifts | 90 / 96 | Six photos ranked another candidate first. |
| Fixed V2 candidate ranked first after equal small shifts | 90 / 96 | The same six remained non-first. |
| Stations where all six photos passed | 5 / 16 | Scans 125, 129, 133, 135 and 143. |
| Match score, minimum / median / maximum | 0.305574 / 0.682155 / 0.878058 | Frozen pass floor was 0.35; this was only one part of the gate. |
| Unshifted lead, minimum / median / maximum | −0.082149 / 0.194959 / 0.494432 | Negative means another direction scored higher. Required minimum was 0.02. |
| Shifted lead, minimum / median / maximum | −0.075287 / 0.170224 / 0.489069 | Required minimum was 0.02 after equal small adjustments. |
| Distributed edge coverage | 92 pass / 4 fail | All four failures missed one image quarter; cell, row and column counts otherwise cleared their minimums. |
| Exact-pixel-location diagnostic | 70 unique / 13 nonunique / 13 unassessable | Diagnostic only; it did not change the direction verdict. |
| Shift-sensitive diagnostic | 12 / 96 | Largest gain from a small shift was 0.031083. This did not replace the fixed mapping. |

Seven of the 14 non-passing photos were `Skybox 5`, the downward-looking face, and those seven include four of the six cases where the fixed V2 candidate was not rank 1. An earlier exploratory overlay used a predeclared centre `(256,256)`, radius-80 circle on the 512×512 diagnostic grid for all seven selected failures and six matched controls. Every circle contained zero geometry-edge pixels, so that specific inside-region calculation was null. The later case-sheet review found a broader pattern: all seven downward non-passes combine repeating floorboards with a large soft or hidden centre area, making rotations hard to distinguish. Passing controls show the centre area too, so it is not a failure by itself and its cause cannot be identified from these boards. It cannot exempt the face or rewrite the failed result.

The other non-passes include two `Skybox 1` coverage failures, one `Skybox 2` ambiguity and one mismatch, one `Skybox 3` coverage failure, and one `Skybox 4` coverage failure and one mismatch. The problem is therefore not confined entirely to the downward face.

## Historical exploratory exception overlays (v1)

An authority-none exploratory package now preserves exact native JPEG copies and generated diagnostic overlays for all 14 non-passing faces plus 14 deterministic nearest same-face passing controls. One control is reused, so the package contains 27 unique faces: 27 captured JPEG byte copies and 27 generated 4096×4096 PNG overlays. The PNGs contain diagnostic marks only; no AI-generated scene pixels were introduced. The package did not train, calibrate, materialize poses, sign, publish or confer metric authority.

The failure unmatched-edge rate exceeded its paired control for 13 of 14 pairs. Mean failure rate was `0.547400907071`, paired-control mean was `0.369792160357`, mean paired delta was `0.177608746714`, median delta was `0.181264386`, and the range was `-0.092123737` to `0.375904862`. These are descriptive, selected pairs from the already-opened negative set—not independent samples, a fresh validation set or causal evidence.

An independent byte-and-structure audit found the current package internally consistent: exactly 55 regular non-reparse files and 496,463,245 bytes, comprising the manifest plus 54 hash-matching image artifacts totalling 496,344,818 bytes. Every image decoded in its declared format at 4096×4096, and all 27 native JPEG copies matched their frozen-report bytes, scan/image identities, statuses and reasons. Authority remains `none`; all training, signing, publication, known-pose materialization, continuous-calibration and metric-geometry claims remain false.

The package is not standalone metric replay evidence. Its 512×512 geometry, photo, matched and unmatched masks were transient rather than retained. Four frozen primary measurements per selected record are present and equal, but the actual recomputed projection/visibility/occupancy measurements are represented only by a boolean equality claim. The unsigned receipts also do not authenticate the creator or chronology, prove immutability, or establish that this was the only execution. A future v2 must retain receipt-bound raw masks and recomputed projection metrics—or replay the full E57—to close that gap.

A separate stdlib-only verifier now pins the exact protocol, manifest, held-out report and renderer source identities; rejects unknown/duplicate/non-finite policy data; rejects lexical symlink/reparse paths and existing reparse ancestors; enforces the source cross-link and exact 55-file directory; and performs two complete receipt/hash/image passes with stable directory identity and final re-enumeration. It validates native-copy links, record/status/pair bindings and aggregate arithmetic while reporting absent mask replay explicitly. A fresh run returned `PASS_SEALED_PACKAGE_INTEGRITY`, payload SHA-256 `dc7f4655b6baf69914a8efbd8cff53d3d836b5623a35780261fc47d01faca1e5`. Its artifact-set SHA-256 `066d99cd676b6d733a109bb6d9002f68aa45fc934a92ac9c3e009f0471de7be4` and directory-set SHA-256 `68eba6f85bed86f1a1d8b2933f41a904bcb78026c3d444b1dc7552299345b037` are explicitly verifier-derived because v1 did not persist them. A separate post-hardening read-only audit matched the verifier/test hashes, reran the CLI and tests, and reported no P0–P3 finding for this scoped integrity claim; the Windows symlink-creation test remained privilege-skipped while direct reparse-attribute coverage passed. The verifier binds but does not reread the 20.5 GB E57 source, cannot prevent a post-return byte swap, and is not self-authenticating; immutable external custody and an externally pinned verifier are still required.

## Post-hoc visual diagnosis of the 14 non-passes

A second, smaller private bundle was generated specifically for clear human comparison. Each of its 14 case sheets places one non-passing photo above a same-face passing control and shows the stored primary and challenger masks beside the source-photo panel. It reconstructed only 44 selected masks for 22 photos; it did not rerun the 48-way search, recompute ranks or change any frozen decision. It contains 512-pixel diagnostic panels, no native JPEG copies, and no point colour.

The visual result divides all 14 cases into three groups:

- **4 incomplete-coverage cases:** scans 123/Skybox 3, 136/Skybox 1, 137/Skybox 1 and 139/Skybox 4. The fixed direction ranks first, but a blank or nearly featureless image quarter lacks enough geometry edges.
- **7 downward-view cases:** scans 127, 128, 131, 132, 138, 141 and 142 on Skybox 5. Repeating timber boards plus a large soft central region make several rotations look alike. Passing controls also contain that central region, so it weakens evidence but is not a case-specific cause.
- **3 curtain cases:** 136/Skybox 2, 137/Skybox 2 and 142/Skybox 4. Repeated vertical folds and translucent layers are weakly distinctive and may produce different camera-versus-laser edges.

No case sheet demonstrates a coherent whole-rig rotation, mirror or translation error. There is no consistent multi-station shift pattern that supports a global calibration correction. The detailed case table, quantitative descriptions and limitations are in `docs/reports/reception-room-e57-geometry-edge-visual-diagnosis-2026-07-14.md`.

The bundle is local at `artifacts/t500-reception-e57-geometry-edge-diagnostics-2026-07-14`, manifest payload SHA-256 `26b6e44992a79fd484410156fa4b2158ca37c06ba81b48c044769d9c259b44e1`. It contains private venue pixels, is not privacy-cleared and must not be published. This post-hoc diagnosis explains the negative result; it does not turn the consumed held-back stations into fresh evidence.

## Saved E57 camera rotations

The saved rotations are not simply “bad.” The E57 pinhole convention looks along negative camera Z, while COLMAP looks along positive camera Z. In this file, the raw JPEG row order also behaves vertically opposite to the documented E57 pinhole raster relationship.

The colour-tested conversion is:

- keep the embedded JPEG pixels unchanged;
- transform the saved camera rotation with `diag(1, -1, -1)`;
- use `cy_raw = image_height - cy_e57` for the vertical principal point.

That conversion predicts the colour relationship on all 138 photos. It emits 138 **candidate** poses only. The failed XYZ-only held-back gate means those candidates must not be automatically materialized or used for training.

## What is established

- The selected E57 contains six readable native 4096×4096 JPEGs at each of 23 stations.
- The six embedded names have one stable, proper, non-mirrored colour mapping across all 138 photos.
- The fixed mapping also passes the complete XYZ-only shape gate on 82 of 96 geometry-held-back photos.
- The loose 1536×1536 cube-image labels are unnecessary for these checks and remain untrusted.
- The exact failed and passing development records, frozen protocol and failed held-back record are preserved with hashes.

## What is not established

- **A fully accepted direction mapping:** the strict XYZ-only held-back gate failed on 14 photos.
- **Exact pixel placement or continuous calibration:** the translation diagnostic is not a calibration proof, and focal length, principal point and distortion have not been independently solved.
- **Metric or inter-station accuracy:** this work does not validate scale, depth accuracy or station-to-station geometry.
- **Room identity:** scans 122–144 still require an operator or independent control confirmation.
- **Privacy clearance:** every native JPEG still needs full-resolution human review and masks.
- **Rights:** possession or decoding of the E57 does not establish commercial ML-training, derivative or distribution rights.
- **Generalisation:** this result covers only the Reception candidate range.

## Privacy and dataset boundaries

The hash-bound derived-panorama review found:

- **scan 123:** a large blurred person — quarantine the whole station;
- **scan 140:** a partial person — quarantine the whole station;
- **scan 122:** crosses the Reception doorway/corridor boundary — keep as a challenge station, not an ordinary core station;
- **all reviewed panoramas:** a blurred nadir/tripod-region patch — every admitted station needs an explicit mask.

Three native images also carry low-detail review warnings rather than automatic rejection: scan 126 Skybox 3, scan 139 Skybox 4 and scan 143 Skybox 0. A person must inspect the exact embedded JPEGs before deciding whether the cause is a plain surface, focus/exposure loss, motion, privacy blur or another defect.

The remaining 20 core stations are **not human-cleared**. Their 120 native JPEGs still need full-resolution review.

The existing no-leak technical split below is only a future candidate. It must not be used unless human review, masks, rights, room identity, continuous calibration and a new independent geometry validation all pass:

- training: 124, 125, 127, 128, 130, 132, 133, 135, 136, 137, 139, 142, 143, 144
- validation: 131, 134, 138
- test: 126, 129, 141

All six photos and all laser data from one station must remain in the same split.

## Evidence and correction record

| Record | Outcome | Payload SHA-256 | Whole-file SHA-256 |
|---|---|---|---|
| `reception-room-e57-lidar-reprojection-2026-07-14-v2.json` | 138/138 colour pass | `a1482521518db90fb0edd41855a2be34efc28b45a348e64358b18d78d09f784c` | `7e1a881c3fdf613a9fa8ddcb1f6c11db582318b0b61ec26452b564a8dee3b4ad` |
| `reception-room-e57-geometry-edge-development-2026-07-14.json` | preserved failed v1 development design | `cf5c21ff0c1a2ba243c4a51bb8f04d945b03511e4c02de002619f375e0321591` | `d8307d8547ba2bce44f87a3173497a83762f98c994e13af272d95c21a24f941a` |
| `reception-room-e57-geometry-edge-development-v2-2026-07-14.json` | 42/42 v2 development pass | `d3c47288b7f57339777afaf44ca2d80268313746c6d02475bdb5220b3ddf0d18` | `96a9fd87a9a78a68b4ebe3f699f313e1f56d985ce40856532198b40a29435389` |
| `reception-room-e57-geometry-edge-protocol-v2-2026-07-14.json` | frozen declared one-shot instructions | `05802cd31a964ae64a9f05949f040291cc3bc06a4765d3e4e9150866bcd9ead4` | `7212244f38a4678cd3e3b60a491c6b2154390d253d9eaa22e0255e16e8cd78d9` |
| `reception-room-e57-geometry-edge-heldout-v2-2026-07-14.json` | 82 pass / 14 non-pass; overall reject | `5bdfcb380692dfa6bb61c62880303cd46a13455737653667dfcba139213bf906` | `ed744eba259c5a40c886af65d8fccf54c36a60ee2e5890449dee0c23f50794a0` |
| `reception-room-e57-geometry-edge-exploratory-overlay-protocol-v1-2026-07-14.json` | declared exploratory failure/control overlay protocol; authority none | `2c62194a6153a6659e7c4caf6e2de2e8baa3cac717cad0ad5c88dae0ac859a38` | `b5347ef067b530653907dc2147133698bdf2ed2466858d8bfcf5cac3e33350c4` |
| `evidence/reception-room-e57-geometry-edge-exploratory-overlays-v1-2026-07-14/manifest.json` | 27 native copies + 27 generated overlays; byte-consistent, masks not retained | `352d1b10aa3353369a1db6dd4f751ecc7363cdd37994809fb37a1bb8655a1912` | `b9ff934550b796be8a651476fb6f8095871d1f5ce38fbf2ef7898b9d4f27d382` |

The source-readiness report is `reception-room-e57-cv-readiness-2026-07-14.json`, payload SHA-256 `d836904a15c8f650321d19f593506ac39a29a5c3a59a9bb0386cae4d751e8cbc`.

The non-v2 colour report is preserved but superseded because one secondary micro-angle field compared rounded vectors without normalising them. Version 2 corrected that field without changing its pass/fail result or practical scores.

The recorded geometry implementation hashes are:

- protocol tool: `dad2fa84c953c3a8dc70ab76c40a92581b845a4a6875465f28bcebd751c6c585`
- geometry core: `0ffa6c5146fdc4b0b319af0041e27af72574822e406dd2b63648420b5ebc4093`
- protocol tests: `bb63277141eb8c181496f8a3a6c267a69f7bb7a7d1c9e1063e866641ab727ab7`
- core tests: `ade338dc2d082dffd1423c841a989929a63443c291939b342eb1fffc4936f798`

The exploratory overlay implementation hashes are:

- renderer: `20ab192d64c877e0d422d7c8095dc9ea28f22daa273679e5e56bb6de5e866020`
- renderer tests: `65f2da45ebcfb9ce104fd554e40e6117a240e4971db1a02666f3381683737aaf`
- external verifier: `36b262a4a3427608be22cd50138e9cb28d70acf7eb5b758166a67fbc3e465895`
- verifier tests: `44a9f9f5723b6e754d7af26e7420b6be37e0b5e0214475ee425220caa0f4828e`

The focused pair-sheet diagnostic implementation hashes are:

- exporter: `616a1447acacfa2324039c4a5aeb5ec2f18d4caa464e5d9f0fc27fefcd80d86d`
- exporter tests: `4f3e9468c8303509d75fe15ed2a634bee51a27daaad1ae2da8665d9f2f962476`

The verifier tests passed 10 with one Windows privilege-dependent symlink test skipped; direct Windows reparse-attribute coverage passed. The combined renderer/verifier slice passed 17 with that one skip.

## Clear next actions

1. Preserve the failed recorded result. Do not tune the frozen v2 thresholds or rerun the 16 stations as if they were still held back.
2. Treat the post-hoc visual diagnosis as complete: the 14 cases are four incomplete-coverage views, seven repetitive downward floor views and three repetitive curtain views. It found no coherent whole-rig mapping or calibration correction. Do not tune a replacement method on these consumed stations.
3. Review all 138 embedded JPEGs at full resolution and create explicit person, tripod and nadir masks. Keep scans 123 and 140 quarantined unless a human review says otherwise. Any future metric-replay bundle must retain receipt-bound raw masks and recomputed projection metrics.
4. Confirm the Reception crop and obtain genuinely independent geometric controls under an authenticated, predeclared protocol. Any replacement method must be designed before it sees fresh validation evidence; these 16 stations cannot become untouched again.
5. Obtain written permission for the intended processing, derivatives, commercial use and model training.
6. Only after privacy, rights, room identity, continuous calibration and a new independent geometry gate pass may a separate COLMAP fixture be considered. Verify that fixture before any training.

## Combined decision

**Computer vision has diagnosed the exceptions. Do not train or materialize poses yet.**

The colour evidence is excellent. The same-E57, colour-blind cross-modality shape evidence is encouraging but not sufficient: 82 of 96 photos passed, while the required all-photo gate failed. The exceptions now have a clear post-hoc explanation, but the next E57 evidence must be genuinely fresh and independently controlled. The immediate HD-quality engineering priority is the private actual-route Quality-versus-Mobile Stage-0 A/B, not more tuning on this consumed E57 set.
