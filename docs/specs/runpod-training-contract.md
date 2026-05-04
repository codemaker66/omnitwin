# Venviewer training-output bundle contract (v1)

**Status:** v1 — accepted 2026-04-26.
**Schema version field:** `"venviewer.assetbundle.v0"` (the wire-format constant; bumped only on breaking schema changes).
**Authority:** D-014 (Venue Artifact Factory) defines the boundary; this spec is its concrete shape. D-016 names the pipeline that produces conforming bundles. This file is the binding contract for both producers (RunPod trainer) and consumers (backend ingestion T-053, downstream registry).

A bundle is the unit that crosses the training/runtime boundary. Producing a conforming bundle is the **only** way training output enters the system.

---

## 1. Bundle layout

A bundle is a directory whose contents are tarred (gzip, deterministic ordering via `tar --sort=name`) into `{run_id}.tar.gz` and pushed to R2 at:

```
r2:venviewer-training-outputs/{venue_id}/{run_id}/{run_id}.tar.gz
```

The extracted root MUST contain exactly the files below. Names are fixed.

```
{run_id}/
├── manifest.json          # top-level descriptor; SHA-256 of every other file
├── scene.ply              # gsplat-native canonical model artifact
├── training_config.json   # full config snapshot (every flag, every override)
├── training_metrics.jsonl # per-iter loss / PSNR / SSIM / LPIPS, one row per line
├── eval_holdout.json      # held-out view metrics + WebGL FPS measurements
├── hardware.json          # GPU model, CUDA runtime, RunPod pod metadata
├── git_state.json         # trainer code commit SHA, branch, dirty flag, remote
├── colmap_input.json      # COLMAP scene metadata: cam count, image count, point bbox
└── bilateral_grid.bin     # OPTIONAL — present iff bilateral grid was enabled
```

Every file except `bilateral_grid.bin` is **mandatory**.

---

## 2. File schemas

### 2.1 `manifest.json` (canonical entry point)

```json
{
  "schema_version": "venviewer.assetbundle.v0",
  "venue_id":       "trades-hall",
  "run_id":         "20260426T173005Z-runpod_abc123",
  "signature": {
    "status":    "placeholder",
    "algorithm": null,
    "key_id":    null,
    "value":     null
  },
  "files": [
    { "name": "bilateral_grid.bin",     "size": 16384,    "sha256": "<hex>" },
    { "name": "colmap_input.json",      "size": 482,      "sha256": "<hex>" },
    { "name": "eval_holdout.json",      "size": 19234,    "sha256": "<hex>" },
    { "name": "git_state.json",         "size": 167,      "sha256": "<hex>" },
    { "name": "hardware.json",          "size": 312,      "sha256": "<hex>" },
    { "name": "scene.ply",              "size": 248513024,"sha256": "<hex>" },
    { "name": "training_config.json",   "size": 1842,     "sha256": "<hex>" },
    { "name": "training_metrics.jsonl", "size": 4129312,  "sha256": "<hex>" }
  ],
  "total_size": 252850779
}
```

Field rules:

- `schema_version` — fixed string `"venviewer.assetbundle.v0"`. Bumped on breaking change only.
- `venue_id` — short kebab-case identifier; matches the R2 prefix.
- `run_id` — UTC ISO-8601 compact + RunPod pod id: `YYYYMMDDTHHMMSSZ-{pod_id}`. Globally unique.
- `signature` — see §3 (Signing).
- `files[]` — alphabetically sorted by `name`. `manifest.json` itself is **not** listed (it would have to record its own SHA, which is impossible without a signing trick we don't yet need).
- `files[].size` — bytes, integer.
- `files[].sha256` — hex digest, lowercase.
- `total_size` — sum of `files[].size`. Sanity check; must equal the sum or ingestion rejects the bundle.

### 2.2 `scene.ply`

gsplat-native PLY (binary little endian) of the trained Gaussians. The canonical model artifact. SPZ derivation is OPTIONAL post-processing — it does not ship in the bundle.

### 2.3 `training_config.json`

The full effective config — every flag the trainer was launched with, every override that was applied at runtime, every default that was inherited. Producers SHOULD include the path of the config file the trainer was launched from, and the SHA-256 of that config file.

```json
{
  "config_path":   "/workspace/code/configs/training/config_b.yaml",
  "config_sha256": "<hex>",
  "max_steps":     30000,
  "antialiased":   true,
  "depth_loss":    true,
  "depth_lambda":  0.02,
  "with_ut":       true,
  "with_eval3d":   true,
  "post_processing": "bilateral_grid",
  "bilateral_grid_shape": [16, 16, 8],
  "strategy": {
    "type":              "MCMCStrategy",
    "cap_max":           5000000,
    "noise_lr":          500000.0,
    "refine_start_iter": 500,
    "refine_stop_iter":  25000,
    "refine_every":      100,
    "min_opacity":       0.005
  },
  "extra_flags": ["--enable-mip-splatting", "--enable-3dgut", "--enable-dn-supervision", "--enable-bilateral-grid"]
}
```

### 2.4 `training_metrics.jsonl`

One JSON object per line, one line per iteration the trainer recorded a metric. Trainer-defined fields with the convention that any key starting `eval_*` is a held-out metric.

```jsonl
{"step":  500, "loss": 0.0428, "psnr": 17.21}
{"step": 1000, "loss": 0.0319, "psnr": 19.04}
...
{"step": 7000, "loss": 0.0124, "psnr": 25.31, "eval_psnr": 24.87, "eval_ssim": 0.853, "eval_lpips": 0.187}
```

### 2.5 `eval_holdout.json`

Produced by `venviewer_training.eval_holdout`. Held-out view metrics plus WebGL FPS measurements where available.

```json
{
  "config":    { ... },
  "data":      "/workspace/data",
  "device":    "cuda",
  "torch_version": "2.4.1",
  "summary": {
    "psnr":  24.87,
    "ssim":  0.853,
    "lpips": 0.187,
    "fps":   null
  },
  "per_image": [
    { "name": "DSC_0042.JPG", "psnr": 25.21, "ssim": 0.861, "lpips": 0.179 },
    ...
  ]
}
```

`summary.fps` is left `null` at training time. `webgl_fps.ts` populates it later from a real-client measurement; backend ingestion MAY merge that measurement into the bundle.

### 2.6 `hardware.json`

```json
{
  "gpu":           "NVIDIA A100-SXM4-80GB",
  "device_count":  1,
  "torch":         "2.4.1+cu124",
  "cuda":          "12.4",
  "trainer_image": "1.5.3-cu124",
  "pod_id":        "abc123def456",
  "pod_region":    "runpod-us-east-1"
}
```

### 2.7 `git_state.json`

Captured at run-time from the bootstrap-snapshotted `.git_sha` / `.git_branch` / `.git_remote` files.

```json
{
  "sha":    "6cfd06042a0424c81232821bb15ff03a1b43c379",
  "branch": "master",
  "remote": "git@github.com:codemaker66/omnitwin.git",
  "dirty":  false
}
```

### 2.8 `colmap_input.json`

Scene metadata captured from the COLMAP reconstruction at training start.

```json
{
  "n_cameras":       1,
  "n_images":        287,
  "n_points3D":      198432,
  "image_width":     5472,
  "image_height":    3648,
  "point_bbox_min": [-12.4, -8.7, -2.1],
  "point_bbox_max": [ 13.1,  9.2,  4.3]
}
```

### 2.9 `bilateral_grid.bin` (optional)

Raw float32 little-endian dump of the bilateral grid post-processing parameters, shape from `training_config.bilateral_grid_shape` (default `[16, 16, 8]`). Present iff the trainer was launched with `--enable-bilateral-grid`. Absent otherwise.

---

## 3. Signing posture

### v1 (current)

Every bundle ships with a placeholder signature so the schema doesn't change between v1 and v2:

```json
"signature": {
  "status":    "placeholder",
  "algorithm": null,
  "key_id":    null,
  "value":     null
}
```

The placeholder is intentionally non-empty. Consumers MUST tolerate it and treat the bundle as **untrusted candidate** until backend ingestion (T-053) replaces it with a real signature.

### v1 → v2 migration (Ed25519 in KMS)

When T-018 (AssetVersion + CaptureSession Drizzle schema) lands, backend ingestion (T-053) starts signing bundles after SHA-256 verification:

```json
"signature": {
  "status":    "signed",
  "algorithm": "ed25519",
  "key_id":    "venviewer-bundle-signing-2026-q2",
  "value":     "<base64 ed25519 signature over manifest.json with signature.value blanked>"
}
```

Signing is over the canonical JSON of `manifest.json` with `signature.value` set to the empty string before serialization (so the signature signs over its own surrounding shape).

### v2 → v3 migration (Sigstore, D-013)

When the org signs up to Sigstore (D-013 future work), `algorithm` flips to `"sigstore"` and `value` becomes the bundle of cosign payload + Rekor log entry. Schema shape unchanged.

---

## 4. Trust boundary

Producers (RunPod training pods) hold:

- **R2 write access** scoped to `venviewer-training-outputs/{venue_id}/{run_id}/`
  and `venviewer-training-outputs/{venue_id}/{run_id}.partial/`.
- **R2 read access** to `venviewer-training-inputs/{venue_id}/`.
- **Read-only git deploy key** for the trainer code repo.

Producers do NOT hold:

- Any database credential.
- Any Fastify or backend API credential.
- Any signing key.
- Any production secret.

A pod can publish a bundle to its own outputs prefix. A pod cannot make that bundle "real."

Consumers (backend ingestion T-053) are the trust gate. Ingestion:

1. Pulls the candidate bundle from `venviewer-training-outputs/{venue_id}/{run_id}/{run_id}.tar.gz`.
2. Extracts; reads `manifest.json`.
3. For every entry in `manifest.json.files[]`, recomputes SHA-256 of the named file and verifies it matches the manifest's claim.
4. Verifies the bundle's structural shape against §1 (presence of mandatory files; absence of unexpected files; `total_size` matches sum).
5. Verifies `manifest.json.venue_id` and `manifest.json.run_id` match the R2 path the bundle was pulled from.
6. Replaces `signature` with a real Ed25519 signature per §3.
7. Writes a row into the `AssetVersion` table referencing the signed bundle's R2 path.

Any failure rejects the bundle and surfaces the failure to the operator. The candidate bundle stays in R2 for forensics — it is not deleted on rejection.

---

## 5. Backend ingestion verification protocol (T-053)

Pseudocode for the verifier. Implementation lives at `scripts/admin/register_trained_bundle.ts` once T-018 lands.

```
function ingest(venue_id, run_id):
    bundle = pull_tarball(venue_id, run_id)
    extract(bundle, tmp_dir)

    manifest = json.load(tmp_dir / "manifest.json")

    assert manifest.schema_version == "venviewer.assetbundle.v0"
    assert manifest.venue_id == venue_id
    assert manifest.run_id == run_id
    assert manifest.signature.status == "placeholder"
    assert sum(f.size for f in manifest.files) == manifest.total_size

    expected_required = {
        "scene.ply", "training_config.json", "training_metrics.jsonl",
        "eval_holdout.json", "hardware.json", "git_state.json",
        "colmap_input.json"
    }
    listed = set(f.name for f in manifest.files)
    assert expected_required.issubset(listed)

    for entry in manifest.files:
        actual = sha256(tmp_dir / entry.name)
        assert actual == entry.sha256, f"hash mismatch on {entry.name}"
        assert filesize(tmp_dir / entry.name) == entry.size

    # promote
    manifest.signature = sign_ed25519(manifest_canonical_bytes(manifest))
    write_signed_manifest_back_to_bundle(...)
    asset_version.insert(venue_id, run_id, signed_manifest_url, ...)
```

---

## 6. Versioning

This document is part of the v1 contract. Breaking changes to any field MUST bump `schema_version` in `manifest.json`. Backwards-compatible additions (new files, new optional fields) do NOT bump `schema_version`. The signing migration in §3 is a backwards-compatible field-population change, not a schema change.

---

## 7. Related

- `docs/architecture/adr/D-013.md` — format strategy and standards (signing migration target)
- `docs/architecture/adr/D-014.md` — Venue Artifact Factory (parent decision)
- `docs/architecture/adr/D-016.md` — RunPod-canonical training environment
- `infra/runpod/RUNBOOK.md` — operator runbook
- `venviewer_training/make_manifest.py` — producer-side manifest builder
