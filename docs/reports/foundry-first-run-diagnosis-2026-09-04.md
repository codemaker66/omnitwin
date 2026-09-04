# The first Grand Hall training run: why it failed, and what a real run needs

**For:** the Foundry programme (T-502's first run) · **Written:** 2026-09-04, 01:00–03:00 BST · **Pod:** trmciz4jo6yf6m (H100 80 GB, $3.49/h, stopped at the end) · **Dataset:** hall-t502 (41,737 images: 7,178 undistorted pinholes at 4000×3000 and 34,559 virtual pinhole views at 1400×1400 rendered from the two fisheyes; 2,477,228 triangulated points; `images_2` a uniform half)

## 1. What happened

Run `gh-configb-20260903T225152Z` (gsplat 1.5.3 `simple_trainer.py mcmc`, cap 3 M, depth loss λ 0.02, `--no-normalize-world-space`, 30,000 steps) evaluated at step 7,000 to PSNR 13.03 / SSIM 0.47 / LPIPS 0.86 over 5,218 held-out views, each evaluation taking 55 minutes. The held-out render was a formless brown blur against a sharp ground truth. Stopped at step ~14,400.

## 2. What was ruled out, by measurement

| check | method | result |
|---|---|---|
| image ↔ pose pairing, image scale | gsplat's parser pairs the sorted `images/` and `images_2/` listings and takes one scale from the first image | both folders hold 41,737 files with identical stems; `images_2` is exactly half for every camera class |
| virtual-view geometry | each view's own triangulated points projected onto its image with the stored pose and intrinsics | on the chandelier, arches and coffers (`reproj_i00007_c1_c.png`) |
| pinhole geometry | the same at full resolution (`crop_i00007_c2_2.png`, `crop_i00007_c3_2.png`) | on the bulbs, the frieze, the cornice strip and the door frames within a few pixels. An earlier "214 px offset" was my error: the four-parameter PINHOLE model read as the three-parameter one |
| black masked pixels | fraction of near-black pixels per camera and suffix in `images_2` | a/f/u views 8 % (fisheye rim corners), c1_a up to 58 % (the operator), pinholes 0 %: a floater source, not a smear source |
| the depth term, world normalisation, mixing view types | five 3,000-step experiments, one variable each, held out every 300th image | all within 1 dB (§3) |
| MCMC position noise scaling with the scene | read `strategy/ops.py: inject_noise_to_position` | the noise is gated by `op_sigmoid(1 − opacity)` (k 100, x0 0.995), so it moves only Gaussians already below 0.5 % opacity; it cannot dissolve a scene, and the zone test confirms it (§4) |

A trap for the reader of gsplat's progress bar: the `loss=` it prints is the loss of the one image of that step. The first run's values (0.145 at 3k, 0.485 at 14k) read as divergence and were not; only the held-out evaluation counts.

## 3. The sweep (diag-20260904T001413Z: 3,000 steps each, five in parallel, held out every 300th)

| run | data | flags vs the run | held-out PSNR / SSIM / LPIPS | render |
|---|---|---|---|---|
| E0 | all 41,737 | as run | 14.98 / 0.493 / 0.747 | |
| E1 | 7,178 pinholes only | as run | 15.96 / 0.588 / 0.853 | flat fog, no structure (`sweep-E1-pinhole.png`) |
| E2 | 34,559 virtual views only | as run | 14.48 / 0.472 / 0.790 | the room in place, blurred (`sweep-E2-virtual.png`) |
| E3 | all | normalised world | 15.00 / 0.494 / 0.747 | |
| E4 | all | no depth loss | 14.95 / 0.499 / 0.760 | |

Three thousand steps over 41,737 images is 0.07 passes. No single variable moved the needle, which sent the search to the amount of training rather than its ingredients.

## 4. The zone test (zone-20260904T002803Z: the 1,023 pinhole frames of instants < 1,500, 7,000 steps, cap 1.5 M, held out every 8th)

| run | world | held-out PSNR / SSIM / LPIPS | render |
|---|---|---|---|
| Z1 | as run (`--no-normalize-world-space`, scene scale 13.9) | 20.13 / 0.642 / 0.674 | the hall: dome, chandeliers, windows, portraits, fireplace, floor (`zone-Z1-asrun.png`) |
| Z2 | normalised (scene scale 1.08) | 20.44 / 0.648 / 0.662 | the same, a little crisper (`zone-Z2-normalised.png`) |

Seven passes over a thousand frames give a recognisable room in both worlds. The package's geometry trains; the first run was starved: 7,000 steps over 41,737 images is 0.17 passes, and each surface received a few dozen gradient updates where a benchmark scene (30,000 steps over 300 images) receives thousands.

## 5. What a real run needs

1. **Steps per image.** Either far more steps (300,000 steps at 45 it/s is under two hours on the H100), or fewer, better images (an instant stride and the sharpest frames), or batches above one with gsplat's `--steps-scaler`, and probably all three. The budget is the number of gradient updates per surface, not the step count.
2. **Cheap evaluation.** `--disable-video` (the trajectory video renders one frame per training camera and held the GPU for nothing after every evaluation) and a held-out set of a few hundred views, not 5,218.
3. **A normalised world, then the way back.** Normalisation gave 0.3 dB on the same data and is what gsplat's schedules assume. The parser composes a camera similarity, a principal-axes alignment and a possible flip into one 4×4 (`Parser.transform`) that the trainer never writes; the runner must save it beside the run and the export must apply its inverse (means by the inverse, scales by the inverse scale, rotations by the inverse rotation) so the splat lands back in the LCC2 SLAM frame in metres, which the viewer's alignment needs. The package tool's receipt now says so (`TRAINING_FRAME_NOTE` in `xbag_colmap.py`, pinned by a test); it used to say the opposite.
4. **Masks.** 8 % of every a/f/u view and up to 58 % of the aft views are black. gsplat 1.5.3's parser has no mask input; the runner should either crop the virtual views to the lens circle or carry a mask channel the trainer honours.

## 6. Pod traps recorded tonight

The container filesystem is ephemeral: the venv and the gsplat clone live on `/workspace`, but the JIT CUDA build cache (78 s) and torch hub weights are lost per restart. A detached script needs `export PATH=<venv>/bin:$PATH` or gsplat's build cannot find `ninja`. gsplat's examples install the rmbrualla `pycolmap` fork under the real pycolmap's module name; the subset tool runs with `pip install --target /workspace/omnitwin/pyc-real pycolmap` and `PYTHONPATH`. A `nohup … &` inside an ssh command needs `< /dev/null` or the channel hangs.

## 7. Cost and files

About 1.5 h of pod time ($5.20) across two starts. Laptop: `D:\claude\splat-perf\gh-configb\` (renders, overlays, crops), `D:\claude\colmap-gh\{subset-model.py, diag-sweep.sh, zone-run.sh, gsplat-*-1.5.3.py}`. Volume: `/workspace/omnitwin/runs/{gh-configb-20260903T225152Z, diag-20260904T001413Z, zone-20260904T002803Z}` and `/workspace/omnitwin/subsets/`.
