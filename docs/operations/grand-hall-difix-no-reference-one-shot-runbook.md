# Grand Hall Difix no-reference bounded local one-shot

## Status and scope

This runbook describes the single-frame, local, zero-external-cost Difix
diagnostic lane. Its runtime and model are sealed. One authorized adapter
process was launched on 2026-08-30, but it stopped before model load or inference
because its TypeScript-compiled lock used locale-sensitive key ordering while
Python used code-point ordering. It produced no candidate, adapter receipt, or
actual-execution evidence. That consumed, failed attempt remains immutable at
`F:\venviewer-provider-cache\difix3d\runs\grand-hall-difix-source-pose-19890-one-shot-v1-49ce7219-20260830T131956Z`.
Its stored lock digest is
`sha256:30488d9a1bd32c372d72e728e5f8c775f64029cc4e5c396fce10810ea1645bae`;
the Python/portable recomputation is
`sha256:de6c2a5f3a1f1684c5f9bff0e2ab370e425332b3fc5ee6dfd43bbe635700366f`;
and its terminal attempt-receipt digest is
`sha256:2d1e6232a9c328d2130462d27ecd04a4692aa8a0c409dd0786035052ce1bbdcf`.

The source render and captured master remain immutable. A result from this lane
is always `generated_cinematic_diagnostic` with no captured, structural, room
boundary, runtime-admission, publication, staging, or production authority.
There is no retry, including after CUDA out-of-memory.
The audited provider/model license lane is local internal non-commercial
research/evaluation only; this lane does not authorize deployment or
distribution of provider materials or its diagnostic output.

The immutable restoration experiment deliberately remains
`execution="not_authorized"` and `dispatchEnabled=false`. A separate,
short-lived overlay may grant one exact local attempt without editing that base
experiment. Compiling a lock, checking materials, or sealing a runtime never
dispatches provider inference.

## Exact provider lane

The lane accepts only:

- repository `nv-tlabs/Difix3D` at
  `c76edc595586e16732c91ddee82f3a6d83a8a9cc`;
- direct `src/pipeline_difix.py::DifixPipeline`, source bytes
  `sha256:2f73e2708b3f9ce560800163554f869e5e43e3a42049f67da3609f7736cbab3a`;
- model `nvidia/difix` at
  `2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388`;
- the independently audited snapshot manifest
  `sha256:6d3d3d8155b03b3021deb1597eb70355dfff2281ba4e526920ec7b1c12f2aea9`;
- exactly these weights:

  - `text_encoder/model.safetensors`, 1,361,596,304 bytes,
    `sha256:67e013543d4fac905c882e2993d86a2d454ee69dc9e8f37c0c23d33a48959d15`;
  - `unet/diffusion_pytorch_model.safetensors`, 3,463,726,504 bytes,
    `sha256:3815819b0009d16b5f7538ecbf2dd0ac4a6b07a238ab82d869465c347864bb70`;
  - `vae/diffusion_pytorch_model.safetensors`, 338,717,612 bytes,
    `sha256:20a5e872469d801876e448ec1d499b1e99cc666497a6aa133ed22c9e0a7a1a25`.

The adapter deliberately accepts the audited `model_index.json` contract where
`requires_safety_checker=true` and `safety_checker`, `feature_extractor`, and
`image_encoder` are null. It asserts these exact facts before invocation. It
does not use `inference_difix.py`, the provider's `model.py` wrapper, a remote
model ID, or any network fallback.

The local snapshot does contain one custom Python component,
`vae/autoencoder_kl.py`, 24,456 bytes,
`sha256:a0c16e2fe489d0386b04274b25e6cec212f37264283f8ce1c042270d27250edf`.
Diffusers 0.25.1 deliberately copies and executes that reviewed local file.
This is **audited local custom-code execution**, not generic remote-code trust
or retrieval. Immediately before loading, the adapter stream-hashes that file,
every scheduler/text/tokenizer/UNet/VAE config or tokenizer input, and all three
weights. It then proves the loaded VAE class came from an exact byte-identical
copy beneath the fresh attempt-local dynamic-module cache, and rehashes the copy
after inference.

The provider never loads those source snapshot paths directly. After the claim
is consumed, the adapter stable-reads each of the 13 exact closure files once
and copies 5,165,655,355 bytes (about 5.17 GB / 4.81 GiB) into a fresh,
create-only private model snapshot directly beneath that attempt. Every target
is created with `O_EXCL` and no-follow semantics, then made read-only. Difix is
given only this private snapshot root. The adapter rehashes all 13 private files
after inference and requires the before/after snapshot digest to be identical.

The exact call is RGB8 sRGB PNG, 1024x576, no conversion, crop, or resize;
`prompt="remove degradation"`; no reference image; FP32; one inference step;
custom timestep `[199]`; guidance 0; no negative prompt; one image; eta 0; CUDA
generator seed 42; PIL output; guidance rescale 0; no clip skip. Autocast,
xformers, TF32, tiling, offload, and compile are prohibited.

## Command surface

Display the command reference:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- --help
```

The `compile`, `authorize`, and non-exhaustive `check` commands are local and do
not invoke WSL, CUDA, or a provider. `seal-runtime`, `seal-model`, `check-seal`,
`check --exhaustive`, and `run` enter WSL through:

```text
unshare --user --map-root-user --net
```

All Python processes receive an empty environment plus an explicit offline
allowlist and run under Python `-I -B`. The inference process binds fresh,
previously absent `HF_MODULES_CACHE` and `TORCH_HOME` directories directly
beneath the exact create-only attempt directory. The reviewed adapter and seal
tool are stable-read, size/hash checked, compiled, and executed from verified
in-memory bytes rather than reopened by pathname. The execution lock also binds
the exact sanitized `PATH`, including WSL's `/usr/lib/wsl/lib` NVIDIA utility
directory so the no-network CUDA preflight can invoke the host-projected
`nvidia-smi` without inheriting the operator environment. Implicit Hugging
Face tokens and telemetry are disabled. No Hugging Face token, API key,
provider credential, or other secret is accepted or required.

This local diagnostic assumes a sole trusted operator for the Windows/WSL user
identity while an attempt runs. It fails closed against accidental drift, path
substitution, links, ordinary concurrent writers, and observed post-load
mutation. A malicious process already controlling that same OS identity could
change permissions and perform a swap/revert attack; defeating that requires a
separate privileged account or VM trust boundary and is outside this lane.

## 1. Create seals explicitly

Sealing reads and hashes every file and may take a long time on `F:`. It also
records every symlink and its resolved target, the external interpreter chain,
the separately pinned `/usr/bin/python3` trusted-verifier chain, the
deterministic provider source archive, the wheelhouse and wheel-hash
inventory, and pip-freeze. Nothing invokes the model.

Use a new create-only output path. Replace `<distribution>` and the output paths
with reviewed values. Do not run these commands as part of an ordinary check.

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- seal-runtime `
  --distribution '<distribution>' `
  --python-wsl '/usr/bin/python3' `
  --seal-tool-wsl '/mnt/c/Users/blake/omnitwin2-grand-hall-exact-runtime/tools/reconstruction-foundry/python/grand_hall_difix_runtime_seal.py' `
  --seal-tool-sha256 'sha256:1fd19dc305ae8aa7f22a7df9e21456cdc01fb04828030649b2d0dab172733306' `
  --seal-tool-size-bytes '21933' `
  -- seal-runtime `
  --runtime-id 'difix-py312-cu128-c76edc-v1' `
  --created-at '<UTC instant>' `
  --venv-host 'F:\venviewer-provider-cache\difix3d\c76edc595586e16732c91ddee82f3a6d83a8a9cc\runtime-py312-cu128-v1\venv' `
  --venv-wsl '/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/runtime-py312-cu128-v1/venv' `
  --venv-python-wsl '/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/runtime-py312-cu128-v1/venv/bin/python' `
  --trusted-verifier-python-wsl '/usr/bin/python3' `
  --source-host 'F:\venviewer-provider-cache\difix3d\c76edc595586e16732c91ddee82f3a6d83a8a9cc\source\Difix3D' `
  --source-wsl '/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/source/Difix3D' `
  --source-archive-host 'F:\venviewer-provider-cache\difix3d\c76edc595586e16732c91ddee82f3a6d83a8a9cc\source\Difix3D-c76edc595586e16732c91ddee82f3a6d83a8a9cc.tar' `
  --source-archive-wsl '/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/source/Difix3D-c76edc595586e16732c91ddee82f3a6d83a8a9cc.tar' `
  --wheelhouse-host 'F:\venviewer-provider-cache\difix3d\c76edc595586e16732c91ddee82f3a6d83a8a9cc\wheelhouse' `
  --wheelhouse-wsl '/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/wheelhouse' `
  --wheel-hashes-host 'F:\venviewer-provider-cache\difix3d\c76edc595586e16732c91ddee82f3a6d83a8a9cc\inventory\wheels.sha256' `
  --wheel-hashes-wsl '/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/inventory/wheels.sha256' `
  --pip-freeze-host 'F:\venviewer-provider-cache\difix3d\c76edc595586e16732c91ddee82f3a6d83a8a9cc\inventory\pip-freeze.txt' `
  --pip-freeze-wsl '/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/inventory/pip-freeze.txt' `
  --output '/mnt/f/<reviewed-create-only-runtime-seal.json>'
```

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- seal-model `
  --distribution '<distribution>' `
  --python-wsl '/usr/bin/python3' `
  --seal-tool-wsl '/mnt/c/Users/blake/omnitwin2-grand-hall-exact-runtime/tools/reconstruction-foundry/python/grand_hall_difix_runtime_seal.py' `
  --seal-tool-sha256 'sha256:1fd19dc305ae8aa7f22a7df9e21456cdc01fb04828030649b2d0dab172733306' `
  --seal-tool-size-bytes '21933' `
  -- seal-model `
  --created-at '<UTC instant>' `
  --snapshot-host 'F:\venviewer-provider-cache\difix3d\models\nvidia-difix-2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388' `
  --snapshot-wsl '/mnt/f/venviewer-provider-cache/difix3d/models/nvidia-difix-2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388' `
  --output '/mnt/f/<reviewed-create-only-model-seal.json>'
```

Rechecking a runtime seal repeats every exact runtime/source/wheel path from the
seal command and binds the create-only manifest:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- check-seal `
  --distribution '<distribution>' `
  --python-wsl '/usr/bin/python3' `
  --seal-tool-wsl '/mnt/c/Users/blake/omnitwin2-grand-hall-exact-runtime/tools/reconstruction-foundry/python/grand_hall_difix_runtime_seal.py' `
  --seal-tool-sha256 'sha256:1fd19dc305ae8aa7f22a7df9e21456cdc01fb04828030649b2d0dab172733306' `
  --seal-tool-size-bytes '21933' `
  -- check-runtime `
  --venv-host 'F:\venviewer-provider-cache\difix3d\c76edc595586e16732c91ddee82f3a6d83a8a9cc\runtime-py312-cu128-v1\venv' `
  --venv-wsl '/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/runtime-py312-cu128-v1/venv' `
  --venv-python-wsl '/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/runtime-py312-cu128-v1/venv/bin/python' `
  --trusted-verifier-python-wsl '/usr/bin/python3' `
  --source-host 'F:\venviewer-provider-cache\difix3d\c76edc595586e16732c91ddee82f3a6d83a8a9cc\source\Difix3D' `
  --source-wsl '/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/source/Difix3D' `
  --source-archive-host 'F:\venviewer-provider-cache\difix3d\c76edc595586e16732c91ddee82f3a6d83a8a9cc\source\Difix3D-c76edc595586e16732c91ddee82f3a6d83a8a9cc.tar' `
  --source-archive-wsl '/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/source/Difix3D-c76edc595586e16732c91ddee82f3a6d83a8a9cc.tar' `
  --wheelhouse-host 'F:\venviewer-provider-cache\difix3d\c76edc595586e16732c91ddee82f3a6d83a8a9cc\wheelhouse' `
  --wheelhouse-wsl '/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/wheelhouse' `
  --wheel-hashes-host 'F:\venviewer-provider-cache\difix3d\c76edc595586e16732c91ddee82f3a6d83a8a9cc\inventory\wheels.sha256' `
  --wheel-hashes-wsl '/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/inventory/wheels.sha256' `
  --pip-freeze-host 'F:\venviewer-provider-cache\difix3d\c76edc595586e16732c91ddee82f3a6d83a8a9cc\inventory\pip-freeze.txt' `
  --pip-freeze-wsl '/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/inventory/pip-freeze.txt' `
  --manifest '/mnt/f/<reviewed-create-only-runtime-seal.json>'
```

The model check is similarly exact:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- check-seal `
  --distribution '<distribution>' `
  --python-wsl '/usr/bin/python3' `
  --seal-tool-wsl '/mnt/c/Users/blake/omnitwin2-grand-hall-exact-runtime/tools/reconstruction-foundry/python/grand_hall_difix_runtime_seal.py' `
  --seal-tool-sha256 'sha256:1fd19dc305ae8aa7f22a7df9e21456cdc01fb04828030649b2d0dab172733306' `
  --seal-tool-size-bytes '21933' `
  -- check-model `
  --snapshot-host 'F:\venviewer-provider-cache\difix3d\models\nvidia-difix-2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388' `
  --snapshot-wsl '/mnt/f/venviewer-provider-cache/difix3d/models/nvidia-difix-2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388' `
  --manifest '/mnt/f/<reviewed-create-only-model-seal.json>'
```

Both checks write nothing.

## 2. Compile the immutable execution lock

First choose a cryptographically random 32-byte nonce. The same full lowercase
hex nonce must already appear in the exact claim filename in the lock spec and
must later appear in the authorization overlay. Choosing a nonce does not grant
or consume authorization.

Prepare a strict JSON compile spec matching
`GrandHallDifixExecutionLockCompileSpecSchema`. It binds paired host/WSL paths
for the experiment, input pack, seals, Python adapter, seal tool, control
directory, claim, one new attempt directory, distinct direct attempt-local
`hf-modules-cache`, `torch-home`, and `model-execution-snapshot` paths, PNG,
adapter receipt, logs, and started/terminal receipts. The attempt, cache paths,
private model snapshot, and all output files must not exist. The control and
attempt-parent directories must be direct, non-link directories.

Then compile:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- compile `
  --spec 'C:\absolute\reviewed-lock-compile-spec.json'
```

This creates only the exact lock path named by the spec. Its reported state is
`compiled_not_authorized_not_dispatched`.

New locks use the Difix cross-language canonical digest: printable-ASCII object
keys are ordered by Unicode code point, strings must contain valid Unicode, and
numbers must be safe integers. This is the exact ordering used by the isolated
Python adapter. Historical locks made with the earlier locale-sensitive
TypeScript ordering remain schema-readable for forensic audit. When that digest
differs from the portable digest, the runner's isolated Python canonical check
rejects the lock before an authorization claim can be created. A historical
lock whose two algorithms happen to agree is already portable-compatible and
remains subject to every other current gate. Never rewrite a historical lock.
Compile a new lock with a new commit, nonce, run root, and create-only paths
instead.

The same portable verifier is used at every Python-to-TypeScript boundary that
the control plane recomputes: configuration, directory inventories, runtime and
model seals, preload closure, private model snapshot, and adapter receipt. The
scheduler configuration digest remains Python-only because the raw scheduler
configuration is not re-canonicalized by TypeScript.

## 3. Check without authorization

The quick check rehashes every directly bound file and revalidates the existing
input pack:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- check `
  --lock 'C:\absolute\execution-lock.json'
```

The exhaustive check additionally rehashes every runtime, source, wheel, and
model file inside the exact no-network namespace:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- check `
  --lock 'C:\absolute\execution-lock.json' `
  --exhaustive
```

Neither check creates a claim or invokes Difix.

## 4. Compile a short-lived authorization only after a fresh user grant

Do not perform this step from an old chat statement or by inferring consent. A
reviewed authorization spec must bind the current active-goal objective artifact
by exact host/WSL path, size, byte hash, and statement hash; the exact execution
lock; an identified goal-owner/operator; the lock's nonce; issuance; and an
expiry no more than 30 minutes later.

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- authorize `
  --spec 'C:\absolute\reviewed-authorization-spec.json'
```

This only writes the create-only authorization overlay. It reports
`authorization_overlay_compiled_not_dispatched`. Never edit or replace an
overlay after compilation.

## 5. Run exactly once

Before the atomic claim is created, the runner performs only bounded checks that
can complete within the 30-minute authorization window:

1. verifies paired host/WSL paths;
2. verifies the immutable experiment is still `not_authorized`;
3. binds the quick material projection and validates the objective and
   authorization time window;
4. stable-reads the lock again inside an isolated Python no-network process and
   requires its raw bytes, size, stored digest, and Python-canonical digest to
   match the exact pre-claim lock;
5. enters the exact OS no-network namespace;
6. requires socket `connect_ex` to return Linux `ENETUNREACH` (101); and
7. allocates and synchronizes a CUDA tensor on the visible GPU.

Only then does it atomically create the claim. The claim consumes the
authorization even if attempt-directory creation, exhaustive material
verification, model loading, inference, postflight verification, or receipt
writing fails. Never delete the claim to retry.

If the claim path is created but writing, syncing, or closing its JSON receipt
fails, the path still counts as consumed. The runner records a terminal
failed/no-retry control-plane receipt and does not continue to provider launch.

Inside the consumed attempt, but still before any provider launch, the runner
exhaustively rehashes source, input pack, provider, runtime, wheels, model,
adapter, and seal tool. It requires the exhaustive material projection to equal
the quick projection, then re-reads the exact execution lock, authorization, and
objective artifact. Any mismatch or exhaustive-check failure writes a terminal
failed/no-retry receipt and does not launch Difix. Authorization expiry after the
valid atomic claim does not invalidate the already-consumed long-running
attempt.

Inside the consumed attempt, the actual inference process checks network
unreachability again before importing the model, stream-hashes the complete
audited load closure while copying it create-only into the private 13-file
attempt snapshot, loads only from that private snapshot, validates the copied
custom VAE under the attempt-local cache, and checks network unreachability a
second time before invoking the pipeline. It then rehashes the entire private
snapshot after inference.

The explicit command is intentionally awkward:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- run `
  --lock 'C:\absolute\execution-lock.json' `
  --authorization 'C:\absolute\authorization.json' `
  --opt-in 'I AUTHORIZE ONE LOCAL ZERO-COST NO-NETWORK DIFIX DIAGNOSTIC ATTEMPT; CONSUME THIS AUTHORIZATION EVEN IF IT FAILS.'
```

The adapter writes the candidate PNG create-only and records the actual
scheduler class/config hash, actual timestep, dtype, package versions, GPU,
CUDA runtime, driver, peak CUDA allocated/reserved bytes, peak RSS, Python
isolation, both network errno checks, the complete pre-load closure hash, and
the before/after private-model-snapshot and custom-VAE cache hashes. The control
plane captures and hashes stdout/stderr, repeats the exhaustive material check,
then validates the adapter receipt and independently decodes the PNG. The final receipt is
`succeeded`, `failed`, `out_of_memory`, or a postflight integrity failure. Every
terminal state prohibits retry and retains authority `none`.
