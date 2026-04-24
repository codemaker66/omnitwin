# ADR-006 — gsplat with MCMC + bilateral grid for training
Status: Accepted. Date: 2026-04-23.

Production Gaussian splat training uses `gsplat` (nerfstudio-project,
Apache 2.0) configured with MCMC densification strategy and bilateral
grid colour correction enabled.

Why:
- MCMC densification (Kheradmand et al. 2024) consistently produces
  2–4 dB PSNR improvement over ADC on indoor scenes
- Bilateral grid compensates for lighting variation between panoramic
  capture poses, reducing floaters
- Apache 2.0 licence; no vendor lock-in
- Scriptable Python, runs headless, integrates with AssetVersion
  pipeline
- Brush (current training tool) produces the "degrades close-up"
  quality seen in existing `export_100000.ply` — rejected
- Postshot (alternative) requires paid tier for PLY export and lacks
  bilateral grid — rejected

Consequences:
- Training runs locally on Blake's RTX 4090 (24GB VRAM) for
  single-venue work
- RunPod A100 reserved for batch training once 5+ venues are
  onboarding in parallel
- Per-venue training time: 2–5 hours at 30K steps, MCMC, cap-max 3M
  (RTX 4090 ceiling — original spec assumed RTX 5090; corrected after
  hardware verification 2026-04-23)
- Bilateral grid colour correction lives in the training graph; PLY
  export may not match in-training rendering exactly (cc_psnr is the
  meaningful eval metric, not raw psnr)
- Held-out 10% pano set is the evaluation protocol; winner config
  must beat v1 by ≥3 dB PSNR to ship
- On Windows + Python 3.11: `fused-ssim` and `fused-bilagrid` Python
  packages have no compatible wheels and must be omitted; gsplat
  falls back to Python implementations of both (~5-10% slower per
  step, functionally equivalent)
- Full training protocol: `docs/architecture/SPLAT_TRAINING.md` (not
  yet written)

Supersedes: Brush (informal — never formally recorded as ADR).
