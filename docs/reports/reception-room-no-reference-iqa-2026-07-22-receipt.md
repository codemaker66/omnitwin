# Reception Room: secondary blind image-quality check

## Plain answer

Computer vision can compare these renders, and it has. But the available images do not contain enough information for an honest “Quality wins” or “Mobile wins” decision.

The strongest new evidence is that two legitimate blind scoring approaches point in opposite directions:

| Check | What it tends to reward | Result on all three full images |
|---|---|---|
| BRISQUE, run through two implementations | Natural-looking local image statistics; lower is better | Mobile scored better at scans 126, 129, and 141 |
| CLIP-IQA | Resemblance to the learned idea of a “good photo”; higher is better | Quality scored better at scans 126, 129, and 141 |

The same split remained after matching each pair’s average brightness. It is therefore not honest to use either blind score alone as the verdict.

## What was tested

The test used six unique 1024×1024 JPEG renders: Quality and Mobile at scans 126, 129, and 141. Byte-for-byte duplicate repeat captures were excluded.

Each pair was checked in five ways:

1. the complete image;
2. the upper half;
3. the central area;
4. the lower half; and
5. the complete image after a recorded, pair-specific mean-brightness adjustment.

That produced 15 pair-and-region comparisons. The two BRISQUE implementations agreed with each other in 14 of 15 comparisons, so their implementation is behaving consistently. BRISQUE and CLIP-IQA disagreed with each other in 13 of 15 comparisons.

The two cross-model agreements both occurred at scan 129: Quality in the upper half and Mobile in the centre. That local rank change is further evidence that the candidates trade different qualities rather than one being uniformly superior.

## What this means in normal language

The Quality candidate more often looks like the kind of bright, polished image the CLIP-based scorer associates with a good photograph. The Mobile candidate more often has the local pixel statistics BRISQUE considers natural.

Neither scorer knows where the real Reception Room surfaces actually were. Neither knows whether a bright patch is accurate lighting, clipped detail, or a reconstruction error. They measure appearance, not physical truth.

This result agrees with the earlier artifact diagnosis:

- Quality contains substantially more near-white pixels and appears brighter.
- Fine-detail rankings change by scan instead of producing one stable winner.
- The largest candidate mismatch in scans 126 and 129 is concentrated in the lower floor area.

Together, the tests say: **there is a real, measurable trade-off, but no evidence-backed universal winner yet.**

## The decisive next test

Use one fixed camera view and save three lossless PNG files:

1. a real/reference image from that exact view;
2. the Quality render from that exact view; and
3. the Mobile render from that exact view.

Repeat that set three times. Then make a 21-frame sideways sweep of roughly one centimetre per step. This provides the missing truth needed to measure geometry alignment, temporal stability, texture persistence, highlight recovery, and artifact motion.

The exact capture instructions are in the earlier [next-test checklist](../reception-cv-artifact-diagnosis-2026-07-18/NEXT-TEST-CHECKLIST.md).

## Important limits

- This is a no-reference test: it cannot measure reconstruction accuracy.
- Only three viewpoints were available.
- JPEG compression is already baked into the inputs.
- CLIP-IQA was intentionally evaluated as a 224×224 preview, so it is mainly a broad appearance signal, not a fine-detail ruler.
- The brightness-matching variation is a sensitivity check, not a replacement image. Brightening Mobile clipped about 2.6%, 3.1%, and 8.9% of pixels at scans 126, 129, and 141 respectively.
- No calibrated significance threshold was available for these exact room renders; score differences are descriptive.
- No protected reference directory was opened or enumerated.

## Reproducibility result

The verifier re-read the six frozen inputs, checked every input and model checksum, recomputed every score on the CPU, and matched the saved result within an absolute tolerance of 0.00001.

Result: **PASS** on 22 July 2026.
