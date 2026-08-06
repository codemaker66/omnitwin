# Reception Room locked computer-vision replication — 17 July 2026

## Plain-English result

The **Mobile SPZ version has the directional computer-vision lead in this locked three-camera replication**.

Mobile won two of the three camera views on the edge-placement check and two of the three views on the line-direction check. That satisfies the rule fixed before the reserved reference photographs were extracted or scored.

This is a **small, directional lead**, not a release decision. The test has no calibrated threshold showing that the numerical differences are visibly or commercially important. It also does not prove survey-grade accuracy, ownership, training rights, or permission to publish.

## What the software checked

The same two checks were applied to both room versions:

1. **Edge placement:** whether door frames, wall boundaries, ceiling lines, and similar edges land near the same positions as the real scanner photograph. Lower is better.
2. **Line direction:** whether those edges point in similar directions to the real scanner photograph. Higher is better.

| Reserved camera | Edge-placement winner | Line-direction winner |
| --- | --- | --- |
| Scan 126 | Mobile | Mobile |
| Scan 129 | Mobile | Quality |
| Scan 141 | Quality | Mobile |

Mobile therefore recorded **2/3 clear wins on each check**. Quality recorded 1/3 on each check.

The two separately acquired repeats at scan 126 were byte-identical for both candidates. Observed repeat noise was therefore zero for that one repeated camera. This does not prove that all browser renders are always deterministic.

## Size of the differences

The relative per-camera differences were small:

| Reserved camera | Edge difference | Line-direction difference |
| --- | ---: | ---: |
| Scan 126 | Mobile by 0.844% | Mobile by 0.069% |
| Scan 129 | Mobile by 0.305% | Quality by 0.207% |
| Scan 141 | Quality by 1.383% | Mobile by 0.612% |

Because no meaningful-effect threshold was fixed from independent evidence, the result may be called only a **directional lead**. It must not be described as a material, visible, physical, or commercial win.

## Geometry check completed first

Before the image comparison, the already-fixed non-mirrored alignment was checked against point coordinates from the same three scanner positions without refitting.

- Fixed alignment combined RMSE: **0.284 m**
- Mirrored alternative combined RMSE: **0.349 m**
- Relative improvement of the fixed alignment: **18.5%**

That supports using the fixed alignment for this comparison. The geometry receipt still explicitly sets transform approval and physical-handedness approval to false.

## Why this changes the earlier interpretation

The earlier three-view matched comparison gave Quality a slight directional lead. This locked replication gives Mobile a slight directional lead. The effects in both runs are small.

The candidate ranking is therefore **not stable across the available views**. A defensible product decision is:

- use Mobile as the provisional leader for this specific locked replication;
- do not promote either candidate as the physically or visibly superior room;
- obtain genuinely new, untouched reference views or an independently run human beauty review before choosing a runtime default.

## Safeguards used

- The scoring rules, cameras, candidates, reference hashes, code hashes, viewer files, and permissions were frozen before reference extraction.
- All eight candidate source assets were hashed from disk and from their exact localhost HTTP responses before capture and again before scoring.
- Eight declared 1024×1024 browser captures carried exact URL, camera, profile, splat-count, loaded-state, viewport, and unique capture-ID evidence.
- The three E57 JPEGs were extracted atomically by exact image index and hash after the candidate renders had been captured.
- The scorer was run once and the result was accepted without retuning.
- No contact sheet or protected reference photograph was published.
- All authority and permission fields remain false.

## Process deviation disclosed

One additional Quality screenshot was triggered during orchestration before an undeclared JavaScript assignment error surfaced. Its temporary filename was overwritten by the properly recorded capture. It was never displayed, copied into the run directory, placed in the manifest, or scored. The reserved reference photographs had not yet been extracted.

This does not change the scored inputs, but it means the process must not claim that exactly eight screenshot operations were triggered. The eight declared scoring captures remain separately identified.

## Scope and limitations

- The three stations were held out only from this matched-render scoring method. They were used in earlier July diagnostics, so this is not a globally pristine or globally unseen holdout.
- Capture independence, browser execution, and one-shot operation are documented procedures, not cryptographic facts.
- Viewer source hashes are not a built-bundle attestation.
- Windows file-mode settings are not a private access-control list.
- The computer-vision checks measure selected structural image relationships; they do not directly measure beauty, texture realism, lighting taste, comfort, or human preference.

## Private evidence

- Result: `C:\Users\blake\Documents\Codex\2026-07-12\new-chat-2\reception-method-holdout-run-2026-07-17\result.json`
- Frozen protocol: `C:\Users\blake\Documents\Codex\2026-07-12\new-chat-2\reception-method-holdout-run-2026-07-17\protocol.json`
- Input manifest: `C:\Users\blake\Documents\Codex\2026-07-12\new-chat-2\reception-method-holdout-run-2026-07-17\manifest.json`
- Extraction receipt: `C:\Users\blake\Documents\Codex\2026-07-12\new-chat-2\reception-method-holdout-run-2026-07-17\references\extraction-receipt.json`
- Transform check: `C:\Users\blake\Documents\Codex\2026-07-12\new-chat-2\reception-e57-method-holdout-transform-2026-07-17.json`
- Capture deviation: `C:\Users\blake\Documents\Codex\2026-07-12\new-chat-2\reception-method-holdout-run-2026-07-17\capture-process-deviation.json`

The result self-digest is `eb7ac03a5867fa1755c3b9656f5fefa884d4f7855ffcbaede47d31c1dc8020c9` and was independently recomputed without rescoring pixels.
