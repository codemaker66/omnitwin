# RunPod training operator runbook

**Audience:** Blake (and any future trainer operator).
**Scope:** every action between "I want to train a Venviewer splat" and "the signed AssetVersion bundle is in R2 ready for backend ingestion."
**Backed by:** D-006a (gsplat MCMC + bilateral grid), D-014 (Venue Artifact Factory), D-016 (RunPod-canonical training environment).

This runbook is the canonical source for training-pipeline ops. If you find yourself copying a step from chat history, copy it here instead.

---

## Prerequisites (one-time setup)

### RunPod account

1. Create a RunPod account at https://runpod.io.
2. Add a payment method. Routine training cost band: **$5–15 per run** at $1.19/hr Community Cloud A100 80GB.
3. From the RunPod console, create a Pod Template using the `infra/runpod/runpod-template.json` definition. Set the image to `omnitwin/trainer:1.5.3-cu124` once the image is built and pushed.

### R2 buckets

Two buckets in the Cloudflare R2 account:

| Bucket | Purpose | Pod write access |
|---|---|---|
| `venviewer-training-inputs`  | Per-venue `colmap_v2` datasets and cached `depths_e57` priors. | Read-only from pod. |
| `venviewer-training-outputs` | Bundle tarballs at `{venue_id}/{run_id}/` and partial state at `{venue_id}/{run_id}.partial/`. | Write from pod. |

Trust boundary per D-014: pods carry R2-scoped credentials only. No database, no Fastify, no signing keys. Backend ingestion (T-053) is the trust gate.

### RunPod secrets

Configure these in the RunPod console under **Settings → Secrets**. The pod template substitutes them as `{{ RUNPOD_SECRET_<name> }}`.

| Secret name | Purpose |
|---|---|
| `r2_account_id`         | Cloudflare R2 account id (the subdomain in the endpoint URL). |
| `r2_access_key_id`      | R2 S3-compatible access key, scoped to the two buckets above. |
| `r2_secret_access_key`  | R2 S3-compatible secret. |
| `git_deploy_key_b64`    | Base64-encoded ed25519 private key for `git@github.com:codemaker66/omnitwin2.git` (read-only deploy key). |
| `pod_ssh_pubkey`        | Your SSH public key, added to `~/.ssh/authorized_keys` on pod boot for inbound debug access. |
| `runpod_api_key`        | Optional. If set, `run_training.sh` self-terminates the pod on success. |

### Trainer image

Build and push the trainer image once (and on every Dockerfile change):

```bash
cd infra/runpod
docker build -t omnitwin/trainer:1.5.3-cu124 .
docker push omnitwin/trainer:1.5.3-cu124
```

The Dockerfile force-imports `gsplat` at build time and runs `healthcheck.py --no-cuda`, so a broken image fails at build, not at first pod boot.

---

## Smoke test ($0.20, ~10 min)

This is the **mandatory gate** before any production run. It validates that every extension actually loads and runs end-to-end on a fresh A100 pod, on a known-good public dataset (mip-NeRF 360 garden subset), at a cost low enough that we can rerun it whenever something feels off.

### 1. Stage the smoke dataset (one-time)

```bash
# from any machine with rclone configured
rclone copy ./mipnerf_garden_subset r2:venviewer-training-inputs/smoke/colmap_v2
```

The "smoke/colmap_v2" prefix carries the same shape as a real venue input: `images/`, `sparse/0/{cameras,images,points3D}.bin`. (No E57 cloud needed — depth supervision still runs but with no priors present.)

### 2. Launch the pod

In the RunPod console, deploy a new pod from the `venviewer-trainer-a100-cu124` template. GPU: A100 80GB (Community Cloud). On boot the bootstrap script pulls the trainer code from git and drops to bash.

### 3. Verify the build

SSH into the pod (or open the web terminal) and run:

```bash
/opt/verify_build.sh
```

Confirm the output JSON shows `gsplat` 1.5.3, `cuda` 12.4, A100 80GB visible in `nvidia_smi`. If any field is missing, **stop here** — the image is wrong; rebuild before continuing.

### 4. Run the smoke training

```bash
/opt/run_training.sh \
  --venue-id smoke \
  --config /workspace/code/configs/training/config_smoke.yaml \
  --enable-mip-splatting \
  --enable-3dgut \
  --enable-bilateral-grid
```

(No `--enable-dn-supervision` for the smoke — the public garden subset has no E57 cloud.)

Expected wallclock: ~10 minutes. Expected cost: ~$0.20 at $1.19/hr.

### 5. Verify pass criteria

After the script reports `run complete`, check from your laptop:

```bash
rclone ls r2:venviewer-training-outputs/smoke/<run_id>/
```

A `.tar.gz` should be present. Pull it and verify:

| Criterion | How to check |
|---|---|
| `manifest.json` parses | `python -m json.tool manifest.json` |
| `scene.ply` ≥ 100k Gaussians | `python -c "from plyfile import PlyData; print(len(PlyData.read('scene.ply')['vertex']))"` |
| `bilateral_grid.bin` present | listed in `manifest.json.files[]` |
| `hardware.json` shows A100 80GB | `cat hardware.json` |
| PSNR ≥ 22 in `eval_holdout.json.summary.psnr` | `cat eval_holdout.json` |

If all five pass: the smoke gate is open. Update `T-001` status to `done` in `docs/state/tasks.md`. If any fail: the pipeline is not yet production-ready; fix before kicking off Config B.

### 6. Tear down

If `RUNPOD_API_KEY` was set, the pod self-terminated. Otherwise, manually terminate from the RunPod console — **don't leave A100 pods idle**, they bill by the second.

---

## Production run (Config B on Trades Hall)

Once the smoke gate has passed at least once on a recent image build:

### 1. Stage the venue dataset

```bash
rclone copy ./trades_hall/colmap_v2 r2:venviewer-training-inputs/trades-hall/colmap_v2
rclone copy ./trades_hall/scan.e57   r2:venviewer-training-inputs/trades-hall/colmap_v2/scan.e57
```

`scan.e57` lives inside the colmap_v2 directory so the pod gets it via the same single rclone copy.

### 2. Launch + verify (same as smoke, steps 2–3)

### 3. Run Config B

```bash
/opt/run_training.sh \
  --venue-id trades-hall \
  --config /workspace/code/configs/training/config_b.yaml \
  --enable-mip-splatting \
  --enable-3dgut \
  --enable-dn-supervision \
  --enable-bilateral-grid
```

Expected wallclock: 3–10 hours (depends on Gaussian growth dynamics). Expected cost: $5–15 at $1.19/hr.

E57 depth priors generate on first run (~10–15 min) and cache to `r2:venviewer-training-inputs/trades-hall/depths_e57/` so subsequent runs skip that step.

### 4. Monitor

The script writes a tee'd log at `/workspace/logs/train-<run_id>.log`. Tail it from another shell:

```bash
ssh runpod "tail -f /workspace/logs/train-*.log"
```

Watch for:
- early PSNR (should cross 18 by step 2000, 22 by step 7000)
- Gaussian count climbing toward `cap_max=5000000` but not pegging at zero (would indicate MCMC misconfiguration)
- no CUDA OOM messages (5M cap on A100 80GB has comfortable headroom)

### 5. After success

The script pushes the bundle tarball to `r2:venviewer-training-outputs/trades-hall/<run_id>/`. If `RUNPOD_API_KEY` was configured, the pod self-terminates; otherwise terminate manually.

The bundle is **unsigned** at this point. Backend ingestion (T-053, deferred until T-018 lands) is what verifies SHA-256, signs, and registers it into the `AssetVersion` table.

---

## Failure modes and recoveries

| # | Symptom | Likely cause | Recovery |
|---|---|---|---|
| 1 | `ImportError: pycolmap.SceneManager` | Upstream PyPI pycolmap installed instead of rmbrualla fork. | Rebuild the Docker image; the Dockerfile pins the rmbrualla fork at commit cc7ea4b73. |
| 2 | `ImportError: gsplat ... CUDA extension` | Wheel didn't compile cleanly against the pod's CUDA / driver. | Force-rebuild without cache: `docker build --no-cache -t omnitwin/trainer:... .`. Verify `TORCH_CUDA_ARCH_LIST="8.0"` matches A100 SM. |
| 3 | `struct.error reading cameras.bin` | COLMAP binary file truncated or wrong endian — usually rclone partial transfer. | Re-pull dataset: `rclone copy --transfers 16 r2:.../colmap_v2 /workspace/data --no-traverse`. Check file sizes against R2 source. |
| 4 | PSNR plateau ~12–14 dB after 5000 iters | **Equirectangular images in input.** gsplat does NOT train on raw equirect. | The `colmap_v2` dataset must contain undistorted pinhole or fisheye images. Re-process the input: undistort panoramas to perspective views before COLMAP. See "Equirectangular trap" below. |
| 5 | Pod preempted (Spot only) | RunPod reclaimed the GPU. | The SIGTERM handler flushes partial state to `r2:.../{run_id}.partial/` (5-second grace). Relaunch with the same `--venue-id`; `run_training.sh` resumes from `.partial/ckpts`. Accept losing up to ~7000 iters of progress per preemption. |
| 6 | SPZ output file too large | SPZ encoder ran with default block size on a >5M-Gaussian model. | SPZ is OPTIONAL post-processing per D-013. Skip for v1. When re-enabled, tune SPZ block size to model size. |
| 7 | `rclone: 401 Unauthorized` | R2 credentials wrong, expired, or wrong endpoint. | Check `R2_ACCOUNT_ID` env (subdomain in endpoint URL). Re-run `/opt/write_rclone_conf.sh` to re-emit `rclone.conf`. Verify with `rclone lsd r2:`. |
| 8 | `RuntimeError: ICP fitness X.XX below threshold` | E57↔COLMAP alignment failed. | Most often: scale mismatch (E57 in mm, COLMAP in arbitrary units). Check the E57's reported units. Try `--icp-max-corr 1.0 --icp-fitness-threshold 0.2` to widen tolerance, but a successful alignment under tolerance is preferable. |
| 9 | Bundle missing `bilateral_grid.bin` | Training ran without `--enable-bilateral-grid`, or `post_processing` was set to a value other than `bilateral_grid`. | Verify the run command and the config file. The `make_manifest.py` step doesn't synthesize the file — it must be produced by training. |
| 10 | Pod hung after `run complete` line | `RUNPOD_API_KEY` not set, or API request failed silently. | Self-termination is best-effort. Manually terminate from the RunPod console. To debug: `tail` the log file and look for the curl response. |
| 11 | CUDA OOM mid-training | Gaussian count growth outpaced VRAM. | Drop `cap_max` (e.g. 5000000 → 3500000) or increase `data_factor` (2 → 4) and rerun. Don't enable training-side bf16 until validated separately. |
| 12 | `fused_ssim` import failure during training | Wheel missing or ABI-incompatible. | The trainer transparently falls back to `venviewer_training.ssim_fallback`. Slower (~5–10×) but produces the same result. No action needed; verify the fallback was used in the log. |

---

## Cost reference

Per the RunPod pricing as of 2026-04-26:

| Tier | GPU | $/hr |
|---|---|---|
| Community Cloud (default) | A100 80GB | $1.19 |
| Secure Cloud (canonical bake-off) | A100 80GB | $1.39–1.89 |
| Ablation alternative | L40S 48GB | $0.79 |
| Ablation alternative | RTX 6000 Ada 48GB | $0.74 |

**Budget targets:**

| Run type | Wallclock | Cost |
|---|---|---|
| Smoke      | ~10 min  | ~$0.20 |
| Routine Config B | 3–10 h | $5–15 |
| Canonical multi-flag (bake-off) | up to ~16 h | ≤$30 |

---

## Equirectangular panorama trap

**gsplat does NOT train on raw equirectangular images.** Throwing equirect at the trainer produces a PSNR that plateaus around 12–14 dB and a splat that looks "smeared in a barrel." This is gsplat behaving exactly as designed; the trainer assumes pinhole-projection (or fisheye-projection when `--with_ut` is set) cameras.

**The colmap_v2 dataset must contain pinhole/fisheye undistorted images.** When ingesting from a 360 camera (Insta360, etc.):

1. Undistort each pano into N perspective views (typical: 6 cube faces or 12 overlapping perspective slices) **before** COLMAP feature extraction.
2. Run COLMAP on the perspective views.
3. Stage the result as `colmap_v2`.

When in doubt: open a sample image from `images/` on the pod and visually confirm it looks like a normal photograph, not a stretched equirect.

---

## Spot termination behavior (when re-enabled)

Spot/interruptible pods are **deferred** until on-demand checkpoint resume is proven on at least three real runs (per D-016). Reference behavior for when it is enabled:

- RunPod sends SIGTERM with **5 seconds** of grace before SIGKILL.
- `run_training.sh`'s SIGTERM handler does best-effort `rclone copy $BUNDLE_DIR → r2:.../{run_id}.partial/` then exits 143.
- Background checkpoint mirror runs every 180 seconds, so worst-case lost progress is ~3 minutes of training (typically <7k iterations).
- On relaunch with the same `--venue-id`, the script detects `.partial/ckpts/` and resumes.

---

## Self-termination

`run_training.sh` calls `podTerminate` via the RunPod GraphQL API at the end of a successful run, **only if** both `RUNPOD_API_KEY` and `RUNPOD_POD_ID` are set in the environment.

Why this matters: an A100 80GB at $1.19/hr is $28/day if you forget. Set the secret and let the pod kill itself.

---

## Things to verify on first real run

This is the surface-area checklist for the things that aren't yet validated end-to-end. Tick each one off as the first Trades Hall Config B run lands.

- [ ] gsplat wheel index `https://docs.gsplat.studio/whl/pt24cu124` still resolves on a fresh `pip install`.
- [ ] pycolmap rmbrualla fork at commit `cc7ea4b73` still installs (commit hasn't been deleted/rewritten upstream).
- [ ] R2 zero-egress assumption holds — the run_training.sh data pull reports no egress charges.
- [ ] Bootstrap script's git clone succeeds against the pinned `OMNITWIN_GIT_REPO` + `OMNITWIN_GIT_REF` from the pod template.
- [ ] `rclone lsd r2:` succeeds before any data copy is attempted.
- [ ] E57 depth prior generation on Trades Hall completes within the expected ~10–15 min budget.
- [ ] Trainer's `--depth_loss --external_depth_dir` argument names match what the vendored upstream simple_trainer.py expects (verify against gsplat 1.5.3 examples/simple_trainer.py).
- [ ] gsplat trainer's PLY output path matches the `ls -t "$BUNDLE_DIR/ply/"*.ply | head -1` pattern in `run_training.sh`.
- [ ] Background checkpoint mirror's writes don't race with the trainer's checkpoint writes (look for partial-file warnings in rclone log).
- [ ] Tarball's `tar --sort=name` produces deterministic byte-for-byte output across two reruns of the same training (compare SHA-256).
- [ ] `manifest.json` SHA-256 of `scene.ply` matches `sha256sum scene.ply` after extraction.
- [ ] Self-terminate API call reports success and the pod actually shuts down.

When all twelve are ticked, `T-001` status moves to `done`.

---

## Related documents

- `docs/architecture/adr/D-006a.md` — gsplat MCMC + bilateral grid + 3DGUT decision
- `docs/architecture/adr/D-014.md` — Venue Artifact Factory (bundle format + trust boundary)
- `docs/architecture/adr/D-016.md` — RunPod-canonical training environment
- `docs/specs/runpod-training-contract.md` — bundle format spec, JSON schemas
- `infra/runpod/runpod-template.json` — pod template definition
- `configs/training/config_b.yaml` — production recipe
- `configs/training/config_smoke.yaml` — $0.20 validation recipe
