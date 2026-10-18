# Config B local contract preflight — 14 July 2026

## Bottom line

We repaired and tested the checker. We did not run or enable training.

“Preflight” means a safety inspection before a training job is allowed to run.
The local command can now reject inconsistent Config B settings, inspect a
prepared pinhole COLMAP/depth dataset and produce a receipt explaining what it
checked. A successful check means “these declared inputs agree with this exact
frozen contract.” It does not mean the trainer works.

The final receipt therefore says `contract_valid_runtime_blocked`, not “ready
to train.” T-514 is complete as a local non-training proof. T-502 remains not
started.

## What computer vision showed

A separate live, read-only inspection of the already-open Reception Room in
LCCEditor showed a convincing room-wide view. Moving closer exposed visible
softness or smearing on the central doors, glass and wood, floorboards, trim and
small fittings.

This matters because softness was visible before a Venviewer/Spark comparison,
so the web renderer cannot safely be blamed for all of it. It does not yet tell
us how much additional loss comes from LCC2 conversion, SPZ/SOG compression or
Spark. Those comparisons still need the same saved camera positions.

This was an operator observation, not a retained or camera-matched evidence
artifact. The editor was already in an unsaved temporary session. No project
was saved, exported, overwritten or modified.

## What was built

- A dependency-light command that can show help and run a CPU-only contract
  check without importing the training stack.
- Exact value freezing for Config B. A harmless-looking change such as depth
  weight `0.02` to `0.03` is now rejected as `CONFIG_B_DRIFT`.
- An audited target argument list for the pinned gsplat MCMC entrypoint. This is
  a declaration of intended arguments, not proof that Tyro accepts them in the
  RunPod image.
- An exact gsplat 1.5.3 source lock covering the release archive, Apache-2.0
  licence record, API assumptions and eight required upstream source files.
  The source is pinned but is not vendored or runtime-verified.
- A deterministic synthetic COLMAP fixture with two pinhole cameras, three
  full-resolution images, three exact factor-2 images, two training images, one
  held-out image and two training-only sparse-depth priors.
- Dataset checks that follow gsplat's real sorted-name `test_every=8` rule and
  reject held-out depth, wrong image mappings, malformed images, incorrect
  dimensions, ambiguous names and unsupported cameras.
- A corrected E57 projector contract that uses the pinned pye57 and pycolmap
  object shapes, selects training cameras only, binds `images` and `sparse/0`
  to the same dataset, rejects invalid ICP scores/transforms and writes to a new
  output directory only.
- A fail-closed `execute` command. The legacy RunPod runner remains disabled.

## Exact verification

Final local verification:

| Check | Result |
|---|---|
| Focused Python tests | 74 passed, 0 failed, 0 skipped |
| Python compilation | Passed |
| Dependency-light help | Passed |
| Heavy-module import guard | Passed; Torch, gsplat, Tyro, Open3D, pye57 and pycolmap were not loaded by help/import |
| Fresh synthetic preflight A | Exit 0 |
| Fresh synthetic preflight B | Exit 0 |
| Receipt comparison | Byte-for-byte identical on two fresh roots on this host |
| Existing receipt overwrite | Refused with exit 2; original hash unchanged |
| Training execution attempt | Refused with exit 78 |
| Final adversarial audit | No remaining P0, P1 or P2 defect in the scoped non-training claim |

Receipt evidence:

| Field | Value |
|---|---|
| Receipt size | 12,910 bytes |
| Receipt SHA-256 | `7b896c930587756b622001b34a4ac68da75dba10b69e1a975323f73b5280c907` |
| Payload SHA-256 | `8132107010427e8d60f3f6dd93f8ac24bebfdeea79cc3547b67a43d0e3fa9eb1` |
| Config SHA-256 | `60a631c366f1acaf28d5a977125ce283b376c12c41f847e3c55872bc89c6c09b` |
| Source-lock SHA-256 | `e9d1ce90702d078f3215951ebb6899ec640f44dbfd7bd5c3742874c5896d748b` |
| Decision | `contract_valid_runtime_blocked` |
| Authority | `none` |
| Runtime ready | `false` |
| Training started | `false` |
| GPU/provider/network/object-store use | all `false` |
| Source closure present/verified | `false` / `false` |
| Named runtime dependencies inventoried | 20 |

Core implementation identities:

| File | SHA-256 |
|---|---|
| `venviewer_training/simple_trainer_depth.py` | `e883f24c221412e6ee54c84cc0aca873947ed9410f703f300dedc1667bb19aa5` |
| `venviewer_training/trainer_contract.py` | `8637c732d5e06e0089db5e1ca2d0bd9e34b6b93d63bb340ff40455cac3b644bd` |
| `venviewer_training/colmap_contract.py` | `df9edda48bfa791f1820350abd9dff8bfb01fd9326b20e7528a8163f718b711c` |
| `venviewer_training/project_e57_depth.py` | `e7d76fbcbc0d3fcdfb4a19cd69bfba3af4b4db2ebb8bcdbf7f66ca72ea758f0f` |
| `venviewer_training/tests/test_trainer_contract.py` | `d19a8dbaa29174be2730c7bd9ecb0c0e82efe9243a251f4198b00c7923dcba89` |
| `venviewer_training/tests/test_project_e57_depth.py` | `7b1b61e02a70cf9bc89d62b2cdcb0b5c613737c9b1f8ae3e334c63b11cea7aef` |

The two receipts prove same-host repeatability for this fixture and installed
dependency inventory. They do not prove byte-identical output on a different
operating system or dependency set.

## What the tests deliberately tried to break

The final suite includes failures for:

- changed Config B values, missing fields, typos, stale fields and mistyped
  values;
- wrong train/held-out splits and depth leakage into held-out views;
- missing, extra, mis-sized, wrongly mapped or invalid images;
- unknown and known distorted camera models;
- malformed, incorrectly named, out-of-bounds or missing depth priors;
- fake, incomplete, unsafe and path-traversing source locks;
- source-lock line-ending drift;
- unexpected runtime imports, provider/process calls and output overwrite;
- E57 and COLMAP API-shape mistakes;
- cross-dataset `images`/`sparse/0` mixing;
- empty E57 projections and stale depth outputs;
- NaN or impossible ICP scores, bad thresholds, invalid RMSE, scale/shear,
  reflections, malformed transforms and unsafe quaternions; and
- SSIM call-signature drift.

The first passing suite was not accepted as final. Independent red-team work
found four real fail-open classes—Config B value drift, held-out/empty depth
generation, stale output reuse and NaN ICP acceptance. Each was reproduced,
fixed and given a regression test before the final 74-test pass.

## Camera and depth limits

The checked path accepts only `SIMPLE_PINHOLE` and `PINHOLE`. The Config B
`with_ut` and `with_eval3d` values are frozen target flags, but distorted-camera
ingestion and 3DGUT execution have not been proved. PortalCam fisheye inputs
must not be declared supported until a real camera conversion or native
distortion path survives a held-out test.

The E57 projector now checks basic numerical safety and rigid-transform shape.
It has not run end to end on the Reception Room E57 with Open3D or RunPod. A
finite ICP fitness is not the same as a reviewed room alignment. T-505 still
must establish overlap, residuals, control points and fixed-view agreement.

The external depth files are validated and indexed, but they are not connected
to the actual training loss. The adapter intentionally fails closed rather than
silently training without requested depth.

The PyTorch SSIM fallback matches the expected callable interface in focused
tests. Numerical equivalence and speed relative to the fused CUDA package were
not measured and are not claimed.

## Safety boundary

No model optimization, GPU work, provider call, paid compute, source upload,
object-store mutation, signing, registration, release or publication was
performed by this slice. The preflight has authority `none`.

The source lock records gsplat's Apache-2.0 licence identity, but it is not a
legal opinion. Other runtime packages, data rights and venue-capture rights
still require their own accepted records.

## How to reproduce the local proof

From the repository root:

```powershell
python -B -m unittest discover -s venviewer_training/tests -p 'test_*.py'
python -B -m compileall -q venviewer_training
python -B -m venviewer_training.simple_trainer_depth --help
python -B -m venviewer_training.simple_trainer_depth preflight `
  --config configs/training/config_b.yaml `
  --synthetic-fixture
python -B -m venviewer_training.simple_trainer_depth execute -- --max-steps 1
```

The last command must refuse with exit 78. Do not treat the successful
preflight as authorization to bypass the Foundry or D-016 execution gates.

## What remains before T-502

1. Complete T-501: create and verify the legally clean XGRIDS/photograph to
   COLMAP ingestion bridge, including the real camera model and calibration.
2. Complete T-505: produce a reviewed Reception Room E57↔visual transform with
   residuals, overlap, control points and camera-matched fixed views.
3. Build and test the pinned RunPod runtime translation. Prove that Tyro accepts
   the compiled arguments in the actual image.
4. Connect external depth to the loss and prove it is used on training views
   only.
5. Prove the bilateral-grid output, evaluation, resume and mandatory D-014
   evidence bundle.
6. Only after rights, confirmation and exact compute approval, run a bounded
   smoke test and then a fair Reception Room baseline against the LCC2 master.

For the visual diagnosis, the cheapest next operator action is still a
camera-matched five-feature capture: fireplace, chandelier, framed artwork,
carved timber/ornament and furniture surface, using the same saved framing in
LCCEditor, the least-compressed export, SPZ/SOG and Venviewer/Spark. Computer
vision can assist with navigating and comparing those views, but it cannot make
different camera positions into valid evidence.
