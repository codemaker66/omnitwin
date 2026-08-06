# Reception Room computer-vision artifact diagnosis

## Bottom line

Computer vision can locate and measure differences in these renders. It cannot honestly say which reconstruction is physically correct because the accessible folder contains no readable ground-truth reference pixels.

The strongest repeatable finding is about brightness, not resolution: the **quality** renders push more bright areas close to pure white in all three views. This is consistent with brighter tone mapping or highlight clipping. The difference is concentrated in the windows, the bright beam above the curtains, ceiling lights, and parts of the ceiling.

The sharpness result is not decisive. Mobile has about 2.1% more raw fine-scale energy on scan 126 and 1.4% more on scan 129, while quality has about 1.0% more on scan 141. The rank therefore flips between views, and the differences have no calibrated “a human can see this” threshold.

The lower floor is the largest quality/mobile disagreement area in scans 126 and 129. That is a useful target for the next test, but a two-image comparison cannot tell us whether the cause is warped geometry, translucent splats, a brightness difference, or an error in one particular candidate.

No candidate-specific 3D floater can be proved from these static pictures. One small green speck appears in both scan-129 renders at almost the same place, which makes it a shared anomaly rather than evidence against only one candidate.

This report does **not** declare a quality-versus-mobile winner.

## What the saved pixels prove

All eight render hashes match the hashes recorded in the frozen result. The source evidence directory was read only. The protected `references` folder was not read.

Both scan-126 repeats are byte-for-byte identical to their first capture:

- Quality first and repeat: `c1a3ac1a5d301e20aa00a415a6fcd698e6f5620a8e0148e4fc7ff73def4290f1`
- Mobile first and repeat: `49522c92ced2458a2620fa34cc1a869b8765fa6bdb9e0400acc584d0adaffff2`

That proves zero difference between the saved repeat files. It does **not** measure normal capture variation and does not prove that the browser produced a fresh, independent frame.

## Artifact findings

### 1. Exposure and near-white detail: stable signal

“Near white” here means at least one decoded colour channel is 250 or higher on a 0–255 scale. Higher is not automatically worse, but it leaves less room to represent detail in bright regions.

| Scan | Quality near-white pixels | Mobile near-white pixels | Quality excess |
|---|---:|---:|---:|
| 126 | 3.24% | 2.42% | 34% |
| 129 | 3.81% | 2.96% | 29% |
| 141 | 11.98% | 8.44% | 42% |

This direction stayed the same when the cutoff was changed to 245 or 254 and when the ignored border was changed from 24 to 48 or 96 pixels. At the stricter cutoff of 254, quality had roughly 4.1×, 3.5×, and 5.3× as many near-white pixels on scans 126, 129, and 141 respectively.

**Fact:** the quality JPEGs contain more near-white pixels.

**Inference:** quality probably uses a brighter exposure or tone curve and may lose more highlight texture. Only a matched reference with locked exposure can separate those explanations.

### 2. Blur and high-frequency loss: small, view-dependent signal

The analysis measured what remains after subtracting a small Gaussian blur. More residual energy usually means more fine texture or sharper edges, but it can also mean noise, JPEG texture, higher contrast, or splat artifacts.

| Scan | Relative raw fine-energy difference | Direction |
|---|---:|---|
| 126 | +2.1% | Mobile higher |
| 129 | +1.4% | Mobile higher |
| 141 | −1.0% | Quality higher |

The same direction held within each view at blur scales of 0.8, 1.2, and 1.6 pixels, but the winner flipped on scan 141. This is a real pixel-level difference, not a practical HD decision.

### 3. Edge doubling or ghosting: no reliable candidate-specific finding

A synthetic three-pixel ghost increased the lag-three edge-echo correlation from 0.091 to 0.308, so the detector is sensitive to an obvious double edge. In the real images, mobile did not show a stronger echo signature: it was lower on scans 126 and 129 and nearly equal on scan 141. A separate edge-wing proxy moved slightly in the opposite direction, showing that natural scene content and exposure can change the sign.

**Conclusion:** these static JPEGs do not support a reliable claim that either candidate has more edge ghosting.

### 4. Local warping and mismatched structure: floor is the main target

Global alignment required 0 pixels on scans 126 and 129 and a one-pixel vertical adjustment on scan 141. After alignment and a robust brightness correction, the 95th-percentile luminance differences were:

| Scan | Mean difference | 95th percentile | Main hotspot |
|---|---:|---:|---|
| 126 | 3.5% | 9.0% | Lower-right floor |
| 129 | 3.7% | 23.0% | Lower central/right floor |
| 141 | 2.0% | 5.3% | Ceiling/air-conditioning area plus one-pixel view shift |

The block matcher found many local disagreements, but only 37%–51% of blocks passed its texture and confidence checks, and several reached the three-pixel search limit. That is enough to locate suspicious regions, but not enough to call the displacement a calibrated geometry error.

**Fact:** the candidates disagree most strongly on the floor in scans 126 and 129.

**Inference:** patchy/translucent splats or local geometry may be involved. Ground truth or parallax is required to assign blame.

### 5. Possible floaters: one shared green speck, no 3D proof

In scan 129, an automatic colour-outlier screen found a green component in both candidates:

- Quality: 93 pixels, box `(172,278)` to `(187,288)`, centre about `(179.6,282.3)`
- Mobile: 71 pixels, box `(178,278)` to `(188,288)`, centre about `(182.5,282.7)`

Because it occurs in both candidates, it may be a shared source artifact, lens flare, or shared reconstruction feature. A static picture cannot reveal whether it floats in front of the ceiling.

![Shared green speck crop](maps/scan-129-shared-green-speck-crop.png)

## How to read the maps

Each six-panel map contains the two source renders, aligned pair difference, local fine-detail balance, local position disagreement, and near-white pixels.

- Fine detail: blue means quality has more raw fine energy; orange means mobile has more.
- Near white: blue means quality only; orange means mobile only; pale yellow means both.
- Bright colours in the pair-difference and local-position panels show where to inspect, not which candidate is correct.

- [Scan 126 artifact map](maps/scan-126-artifact-map.png)
- [Scan 129 artifact map](maps/scan-129-artifact-map.png)
- [Scan 141 artifact map](maps/scan-141-artifact-map.png)

## Sanity and sensitivity checks

The analysis was tested against known changes:

- Comparing an image with itself returned zero difference, SSIM 1.0, and zero local shift.
- Saving the same decoded image as another quality-95 JPEG changed the fine-detail RMS by only about 0.04%.
- Adding a one-pixel Gaussian blur reduced fine-detail RMS by about 34%.
- Adding a clear three-pixel, 50% ghost raised lag-three edge correlation by about 239%.
- Moving a 256×256 centre patch by two pixels produced a detected maximum local displacement of two pixels.
- Increasing brightness by 20% raised the computed near-white luminance fraction from 2.83% to 6.54%.

These controls show that the measurements respond to the artifact types they are meant to screen. They do not turn natural-image indicators into physical truth.

## The exact next test that would decide meaningful HD quality

The shortest honest route is a new **lossless, ground-truth-matched capture**, not another score on these JPEGs.

1. Obtain authorized, readable ground-truth images for the exact camera poses. Do not work around the locked folder. Export the reference and both candidates at **4096×4096 PNG**, using the same projection, crop, exposure, white balance, tone mapping, and device-pixel ratio.
2. Capture three genuinely fresh frames per candidate. Force a new render between captures and record a unique frame counter plus the lossless file hash. This replaces the byte-identical repeat limitation with a real variation estimate.
3. Predeclare regions before looking at the results:
   - scan 129 lower floor for patching/warping;
   - scan 141 windows and bright beam for highlight loss;
   - ten slanted or nearly slanted hard edges across vents, cornices, window frames, and wall fittings for sharpness.
4. Measure four things against the ground truth:
   - **MTF50 ratio** on the ten edge regions: how much real edge resolution survives;
   - **highlight-detail retention** after exposure matching: how many reference-bright pixels still have visible variation instead of flattening near white;
   - **95th-percentile reference-aligned flow error in pixels** on textured regions: local warping;
   - **three-pixel edge-echo correlation**: double edges or ghosting.
5. Add one **21-frame sideways sweep** through the scan-129 view: move the camera from −10 cm to +10 cm in 1 cm steps, keep the look-at point and exposure fixed, and save every frame as PNG. Track the green speck and floor patches. A feature that moves differently from the ceiling/floor surface is a floater; a feature that follows the surface is not.
6. Calibrate “meaningful” before scoring. Show a small blind blur/warp ladder at the intended display size to representative viewers and record the smallest difference they can reliably notice. Use that measured threshold, not an invented number, as the pass/fail line.

The one most decisive metric for the HD claim is the **ground-truth MTF50 retention ratio with a human-calibrated visibility threshold**. The sideways sweep is the decisive test for floaters and local warping.

## Reproducibility and boundaries

- Full numeric output: `artifact-metrics.json`
- Input hashes and frozen-result hash checks: `input-manifest.json`
- Software versions and analysis-code hash: `software-and-code.json`
- Reproducible analysis code: `analyze-renders.cjs`
- Compact table: `artifact-summary.csv`

The metrics are exploratory and unauthenticated. They do not grant approval, prove physical accuracy, or override the frozen result's documented lack of a practical-materiality threshold.
