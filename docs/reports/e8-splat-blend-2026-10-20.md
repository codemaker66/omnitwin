# E8: the splat blend, measured (20 October 2026)

**Question.** Does production blend Gaussian splats in a different colour space from the one they were trained in?

**Answer.** Yes. Production converts each splat's colour from sRGB to linear light and blends in the half-float
pass (`colorSpace: SRGBColorSpace` in `packages/web/src/lib/native-splat-scene.ts`; `colorSpaceToWorking` in
`patches/three@0.186.0.patch`). Training rasterisers composite the stored, display-encoded values: gsplat
1.5.3 in classic mode, and our trainer, which loads photographs as `uint8/255`. Measured against gsplat on the
production Grand Hall tiles, today's draw renders soft pixels **about 6 code values brighter** than the trained look.
That is what the hypothesis predicted: gsplat's own renderer, switched to a linear blend, shifts them by +7.9. Blending
as stored, without the per-splat clamp at 1 (arm C), brings the product **4.2 dB closer to the trainer's renderer
on all 20 held-out views**. Both steps of the rule registered beforehand passed. The look change is Blake's call:
[comparison page](https://claude.ai/artifact/B4oo64bjznCxPTdt6royfa).

Research only: production is unchanged. Workspace on the build PC: `D:/claude/e8-blend-20261019`. It holds the
pre-registration, scripts, every render, `scores/scores.json` and `notes/`.

## Method

- **Asset.** The production Grand Hall: `env.sog` plus the 11 finest-level XGRIDS tiles, 6,030,980 splats, SH degree 3,
  each sha256-matched to the live bundle (`trades-hall-splat-bundles.ts`, master `be2aaab8`).
- **Reference.** gsplat 1.5.3 `rasterization`, classic mode, `eps2d` 0.3, black background, on the RTX 4090. The
  colours are gsplat's own, `clamp_min(SH + 0.5, 0)`. gsplat clamps each splat's colour at 0 only, which was checked
  in its source before arm C was defined.
- **Poses.** 20 held-out views: E57 sweeps 7, 22, 33, 36 and 43, which the pano lane holds out, times the four
  side faces, with bundle-adjusted orientations. All use the product's intrinsics: 48° vertical field of view and
  3840 × 2160 (1920 × 1080 at the high tier's settled DPR 2). The planner's orthographic plan view is reported
  separately.
- **Arms.** The product's code path: master's patched three r186 (patch sha256 `63f7dc77`), the repo's SOG decoder,
  `mergeNativeSplatSources` and `NativeSplatScene`'s splat options. The kernel is √8, and the display uses
  `NoToneMapping`, as `CaptureToneMapping` shows a captured room. **A** is today: linear blend, antialias
  compensation on. **B** blends the encoded values. **C** is B without the per-splat clamp at 1. Diagnostics
  **A0, B0 and C0** repeat each arm with the antialias compensation off, which is gsplat's classic behaviour.
- **Masks, fixed before any arm rendered.** *Soft* = gsplat alpha < 0.98, or an edge pixel: a Sobel luma gradient of
  at least 6 code values per pixel, dilated 3 × 3. That is 12.8% of pixels, almost all of them edges, since alpha
  stays below 0.98 on only 0.07% of an interior view. *Elsewhere* = every other pixel. *Crops* = chandelier and
  window rectangles drawn on the gsplat references only: 11.7% of pixels, in 14 of the 20 views.
- **Score.** PSNR from the pooled squared error over the 20 views, RGB 0–255.
- **Rule.** Adopt B if it gains at least +0.5 dB on *soft* and loses at most 0.1 dB *elsewhere* and on all pixels.
  Adopt C over B if the crops gain at least a further +0.3 dB.

## Results (pooled PSNR against gsplat, dB, 20 held-out views)

| Arm | all | soft | elsewhere | crops |
|---|---|---|---|---|
| A, today | 32.10 | 25.23 | 35.73 | 30.72 |
| B, encoded blend | 34.59 | 26.25 | 42.90 | 31.06 |
| **C, B without the clamp at 1** | **36.29** | **27.51** | **50.19** | **35.19** |
| A0, A with AA compensation off | 32.91 | 26.62 | 35.71 | 31.75 |
| B0 | 39.07 | 32.01 | 43.01 | 32.17 |
| C0 | 48.75 | 41.28 | 53.58 | 47.20 |

- **B over A:** +1.03 dB on soft (15 of 20 views, paired t 3.3), +7.17 dB elsewhere (20/20), +2.49 dB on all pixels
  (20/20). **Adopt B: passed.**
- **C over B:** +4.13 dB on crops (14/14, t 3.4), +7.29 dB elsewhere (20/20), +1.70 dB on all pixels (20/20).
  **Adopt C: passed.**
- **Mean signed luma on soft pixels, arm minus gsplat:** A +6.0, A0 +7.7, B −4.1, C −1.9, C0 −0.2 code values.
  Today's draw is too bright, as predicted.
- **Plan view, outside the rule:** A 30.25, C 36.52, C0 43.53 dB on all pixels.

**Controls.**
- gsplat blending in linear light scores 32.87 dB against gsplat, which reproduces the I1a plan's 32.5–34.2 dB.
- gsplat with the per-splat clamp at 1 scores 39.50 dB. 6–9% of splats exceed 1.0 after spherical harmonics, and up
  to 27% of a window-facing frame sums above 1.0 before display.
- The instrument floor is 49 dB: A0 against gsplat's linear blend scores 49.17, and B0 against gsplat with the
  clamp scores 49.37. Kernel cut, sort, 8-bit colour storage and half-float accumulation together stay below that.
- Today's two draw paths (`renderer.render` against a `RenderPipeline` pass) agree to 62.7 and 53.2 dB.

**Why the gain is not confined to edges.** An interior pixel is a mixture of many overlapping, partly transparent
splats of different colours. Blending them in linear light shifts every such mixture, so pixels that are opaque in
sum change too: the *elsewhere* mask gains 7 dB.

**Stills.** At the product's arrival, chandelier, gilding and plan poses, today's draw is 2.4–3.4 code values
brighter than C on average, and 22–34% of pixels differ by more than 3. At 1:1, today puts a soft halo around each
chandelier bulb and slightly washes the brass and the gilt lettering of the Deacon Conveners' boards.

## Recommendation

Adopt C (splats blended in their stored, display-encoded values; per-splat colour clamped at 0 only) if Blake accepts
the look. It is a separate PR under T-639 (its I1b). The splat layer blends encoded in its own half-float pass,
is decoded to linear once, and is then composited with the linear-lit meshes; the display stays `NoToneMapping`. The
patched addon already exposes `colorSpace`; it needs a clamp option and the planner needs the two-stage composite
where furniture shares the frame. The same decision covers the photo-trained hall T-639 is re-aimed at: its trainer
stores room-splat colour as display sRGB (`train.py:624`, confirmed by the T-639 lane), so gsplat parity applies to
it directly.

## Also found (not part of the rule)

**The antialias compensation is now the largest remaining departure from the trained look at desktop DPR 2.**
Production turned it on on 17 October (T-658). Turning it off gains +12.5 dB on all pixels and +13.8 dB on soft
pixels (C → C0), and +4.5 dB for B. Every served tile's SOG meta says `"antialias": false`. T-658 measured its gain
against a supersampled reference at DPR 1 and 0.5. E8 measures fidelity to the trained renderer at DPR 2, so both
results can hold at their own scales. A per-DPR policy is a decision for the T-658 and T-639 owners with Blake,
measured in this harness at DPR 1 and 0.5 as well.

## Caveats

- XGRIDS trained the production tiles with its own closed trainer. gsplat stands in for a standard 3DGS trainer;
  the tiles declare `antialias: false`.
- The reference is gsplat at the same resolution, not the photographs. Scoring XGRIDS against the E57 photos is
  limited by the colour difference between the two cameras (17.4 dB in the pano lane's fair comparison), so it was
  not used here.
- Desktop quality only. Phone tiers, at DPR 1 and 1.5, were not rendered.
- The plan view clips wall tops into ragged edges whatever the blend. The plan still was framed inside the walls.

## Reproduce

```bash
cd D:/claude/e8-blend-20261019
python views.py                      # 20 held-out views + plan, product intrinsics
python ref_gsplat.py                 # gsplat reference + linear and clamp controls (holds gpu.lock)
(cd app && pnpm install --prefer-offline) && node make_addon_variant.mjs && (cd app && npx vite build)
node driver.mjs                      # arms A, B, C, A0, B0, C0 in the product renderer (holds gpu.lock)
python score.py                      # scores/summary.md, scores/scores.json
```
