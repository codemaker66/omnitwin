# Discovery: an existing independent Grand Hall splat, and what it costs us

**Status:** `EVIDENCE NOTE — no asset registered, no rights cleared, nothing published`
**Date:** 2026-07-25
**Found during:** Foundry mesh-baseline lane (bounded Grand Hall pilot, sweeps 0–48)

## What was found

`F:\colmap_v2\output\` (duplicated at `F:\E57\colmap_v2\output\`) holds a complete
Gaussian-splat training checkpoint series: `export_005000.ply` through
`export_100000.ply`, twenty files, each exactly 1,038,444,032 bytes.

Header of the final checkpoint, read directly:

```
ply / format binary_little_endian 1.0
comment Exported from Brush
comment Vertical axis: y
comment SH degree: 3
element vertex 4400180
59 float properties, 236-byte stride, x/y/z at property indices 56/57/58
```

So: **4,400,180 Gaussians, full spherical-harmonic degree 3, trained to 100,000
iterations by Brush** (the open-source Rust/WGPU trainer). A sampled-position
probe (200,009 splats, 1st–99th percentile) gives a core extent of
14.75 × 9.79 × 14.90 in COLMAP units; applying the fitted COLMAP→E57 similarity
scale of 1.7362 gives roughly 25.6 × 17.0 × 25.9 m. Like the LiDAR, that is
larger than the room itself because the cameras also saw through doorways and
windows — the same room-envelope crop serves both layers.

## Why it matters, positively

The moonshot's open question "can an owned pipeline match the vendor?" has been
carrying the assumption that no independent Grand Hall splat exists. One does.
It is not XGRIDS-derived, it is not LCC-derived, and it is a legitimate
candidate visual baseline for the pilot's appearance bake-off — subject to the
rights position below.

## Why it matters, negatively — two honest problems

### 1. Provenance: this run is invisible to our own system

`state/training_runs.jsonl` is 0 bytes. The D-014 artifact bundle
(`training_config.json`, `training_metrics.jsonl`, `eval_holdout.json`,
`hardware.json`, `git_state.json`, `colmap_input.json`, `manifest.json`) does
not exist for this run. We therefore cannot currently state, from records, which
images trained it, what the held-out split was, what the evaluation scores were,
or what software version produced it. Everything asserted above is inferred from
file bytes and timestamps, not from a provenance record.

### 2. Rights: it was trained on Matterport-derived imagery

Filesystem timestamps establish the lineage without ambiguity:

| Artifact | Timestamp |
|---|---|
| `F:\E57\cloud_0.e57` (Matterport Pro3 capture) | 1 Mar, 16:43 |
| `colmap_v2\database.db` (features from E57 cubefaces) | 4 Mar, 19:17 |
| `colmap_v2\sparse\0\cameras.bin` (registered model) | 4 Mar, 19:25 |
| `export_045000.ply` … `export_100000.ply` | 4 Mar, 21:29 → 22:19 |

The training images are the 300 cubefaces derived from the Matterport E57. The
Matterport Terms of Use in force from **1 March 2026** prohibit training
artificial-intelligence or machine-learning models using Matterport Data for
commercial use. This training ran on **4 March 2026**, three days after that
took effect.

**This is a technical finding, not legal advice, and not an accusation of
anything.** The asset exists; the question of whether it may be used
commercially, kept for internal research only, or must be set aside is a
contract-specific decision for the customer of record with counsel. It is
recorded here so the decision is made deliberately rather than by accident,
before this splat is ever registered, published, or shown to a client.

## Consequences for the pilot

1. The splat must **not** enter the canonical venue package, the ingest manifest
   as a rights-approved asset, or any published runtime until the Matterport
   training question is answered. The ingest contract already blocks this: its
   rights posture for Matterport-derived assets is `modelTrainingUse:
   requires_review`, and the hardened job-rights validator now refuses any
   `model_training` purpose against such an asset — including via a downstream
   stage consuming an upstream stage's outputs.
2. If rights clear, this becomes the pilot's independent appearance baseline and
   the fair comparator against the vendor LCC result — which is precisely the
   bake-off the moonshot's visual gate demands.
3. If rights do not clear, the same pipeline retrained on **owned** photography
   (DSLR or the operator's own capture) produces an unencumbered equivalent; the
   COLMAP+Brush toolchain is proven to work on this venue either way, which is
   itself valuable evidence.
4. Independently of rights, the checkpoint series is useful **engineering**
   evidence: twenty checkpoints from 5k to 100k iterations at a fixed 4.4M
   Gaussian budget allow a convergence study — how much quality the last 50,000
   iterations actually bought — without spending a penny of new compute.

## Decisive next tests

| Question | Cheapest test | Owner |
|---|---|---|
| May this splat be used commercially? | Contract-specific counsel review of the Matterport agreement against the 1 Mar 2026 ToS | Blake + counsel |
| Is it actually the Grand Hall, geometrically? | Apply the full fitted similarity (rotation + translation + scale) to a sampled subset and measure overlap against the E57 pilot cloud | reconstruction lane |
| Is it any good? | Fixed-view render comparison against held-out cubefaces, plus a convergence sweep across the 20 checkpoints | reconstruction lane |
| Who ran it, with what settings? | Ask the operator; absent an answer, it stays "inferred lineage, unrecorded run" | Blake |
