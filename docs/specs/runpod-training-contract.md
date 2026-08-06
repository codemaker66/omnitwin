# Venviewer training-output bundle contract (v1)

**Status:** accepted 2026-04-26 as the historical v0 candidate shape; current
execution and promotion use is blocked pending the control bindings below.
**Schema version field:** `"venviewer.assetbundle.v0"` (the wire-format constant; bumped only on breaking schema changes).
**Authority:** D-014 (Venue Artifact Factory) defines the boundary; this spec is its concrete shape. D-016 names the pipeline that produces conforming bundles. This file is the binding contract for both producers (RunPod trainer) and consumers (backend ingestion T-053, downstream registry).

A bundle is the intended unit that crosses the training/runtime boundary.
Producing this v0 shape is necessary for legacy-candidate verification, but is
not sufficient for training output to enter registration or runtime.

> **Current implementation boundary (2026-07-13):**
> `verify-training-candidate` performs read-only, local verification of an
> already-extracted D-014 v0 candidate. A pass produces an
> `untrusted_candidate_verified` dossier with authority `none`. It does not
> extract, dispatch, train, upload, register, sign, publish, promote, or
> authorize runtime consumption. The concrete legacy runner at
> `infra/runpod/run_training.sh` is blocked fail-closed.

---

## 1. Bundle layout

A bundle is a directory whose contents are tarred (gzip, deterministic ordering via `tar --sort=name`) into `{run_id}.tar.gz` and pushed to R2 at:

```
r2:venviewer-training-outputs/{venue_id}/{run_id}/{run_id}.tar.gz
```

The extracted root basename MUST equal the control-plane-supplied expected
`run_id`, and the root MUST contain exactly the top-level files below. Names
are fixed; nested directories, unexpected entries, symlinks, non-regular
entries, and files with additional hard links are rejected.

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
└── bilateral_grid.bin     # OPTIONAL legacy entry; currently rejected (see §2.9)
```

Every file except `bilateral_grid.bin` is **mandatory**.

The local verifier accepts the extracted directory as input. A tarball and its
R2 object path are transport artifacts and are not themselves verification
subjects.

---

## 2. File schemas

### 2.1 `manifest.json` (canonical entry point)

The following is a historical shape example. Because it lists
`bilateral_grid.bin`, it is intentionally **not** accepted by the current local
verifier; §2.9 explains the missing binary contract.

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

gsplat-native PLY (binary little endian) of the trained Gaussians. The
implemented verifier requires `binary_little_endian 1.0`, exactly one vertex
element, no mesh or list elements, and the exact ordered float32 scalar gsplat
property layout for `training_config.sh_degree`. The declared vertex count
must be positive and no greater than both the verifier cap and
`strategy.cap_max`; file size must exactly equal the fixed-stride payload.
Every Gaussian value is streamed and checked for finiteness, and each rotation
quaternion must have non-zero length. An extension, magic prefix, or matching
SHA-256 alone is not sufficient. SPZ derivation is OPTIONAL post-processing —
it does not ship in the bundle.

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

D-014 v0 does not define enough information to verify this file. In
particular, view count, channels, tensor layout, dtype, endian, and
serialization are underspecified; `training_config.bilateral_grid_shape`
cannot supply the missing contract. The local verifier therefore rejects a
candidate when `bilateral_grid.bin` is present or when
`post_processing` requests `bilateral_grid`. No corrected binary format is
defined by this document.

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

The placeholder is intentionally non-empty. The local verifier requires this
exact placeholder shape and treats the bundle as an **untrusted candidate**.
It cannot replace the placeholder or authorize another component to do so.

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

## 4. Intended trust boundary and current block

The credential separation below remains the accepted design. It is not a
description of a currently authorized producer: the legacy manual RunPod
runner is unconditionally blocked because it bypassed the JobSpec, reviewed
rights, execution confirmation, compute approval, cost controls, kill switch,
and durable attempt ledger.

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

Consumers (backend ingestion T-053) are intended to be the trust gate. Before
the promotion sequence below can be implemented as authoritative ingestion,
the candidate must be bound to all of the following exact subjects:

- reviewed ingest-manifest digest;
- canonical JobSpec digest;
- validated provider-plan digest/identity;
- durable execution-attempt ledger record;
- passed quality contract and its evidence; and
- trusted signature subject/payload.

D-014 v0 carries none of those bindings. Consequently, a locally verified v0
candidate cannot be registered as evidence or an AssetVersion, signed,
consumed by runtime, published, or promoted. The following sequence is the
historical intended flow after those bindings are added; the v0 checks alone
do not authorize step 6 or 7.

Ingestion:

1. Pulls the candidate bundle from `venviewer-training-outputs/{venue_id}/{run_id}/{run_id}.tar.gz`.
2. Extracts; reads `manifest.json`.
3. For every entry in `manifest.json.files[]`, recomputes SHA-256 of the named file and verifies it matches the manifest's claim.
4. Verifies the bundle's structural shape against §1 (presence of mandatory files; absence of unexpected files; `total_size` matches sum).
5. Verifies `manifest.json.venue_id` and `manifest.json.run_id` match the R2 path the bundle was pulled from.
6. After verifying every required subject binding, replaces `signature` with a real Ed25519 signature per §3.
7. Writes a row into the `AssetVersion` table referencing the signed bundle's R2 path.

Any failure rejects the bundle and surfaces the failure to the operator. The candidate bundle stays in R2 for forensics — it is not deleted on rejection.

---

## 5. Historical backend-ingestion sketch (T-053; incomplete and non-executable)

The original pseudocode below documented structural checks only. It is not a
complete trust protocol and must not be implemented as written: it omits the
ingest-manifest, JobSpec, provider-plan, attempt-ledger, quality, and trusted
signature bindings required by §4. In particular, reaching the `promote`
comment after shape/hash checks does not authorize signing or registration.

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

    # BLOCKED: first resolve and verify every §4 subject binding.
    # Shape, hashes, R2 location and pod metadata do not authorize promotion.
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
