# Grand Hall GSFixer-base diagnostic

Status: private local non-commercial R&D. This lane invokes the official
GSFix3D `MarigoldGSFixerPipeline` at source commit
`88b03c0230ceef58455cd0cb7eda4a58923cf4ab` with
`goldoak1421/gsfixer-base@10da3bf12c1c299d559a85572601f17054dd4d2a`.

Every result is `GENERATED_CINEMATIC`, has no captured, structural, metric or
planning authority, and is non-promotable until separately accepted by a
human. The lane never edits source SOG, SPZ, LCC, mesh, E57 or panorama data.

## Current disposition

- A genuine official GSFixer-base Grand Hall single-frame diagnostic exists.
- It is evidence under ordinary trusted-local-host assumptions, not
  cryptographically complete execution provenance.
- It is a broad repaint, not a localized or multiview-consistent repair, and
  is ineligible for the captured master and is not nominated. A deterministic
  forbidden-architecture review-evidence pack now records the full-frame
  change, but its semantic status correctly remains `not_evaluated` pending
  qualified human review.
- The current v5 supervisor materially strengthens directory and process
  binding, but no provider preflight or inference has run under this build.
- V5 remains **NO-GO for promotable cryptographic provenance** because it does
  not seal the complete executable runtime closure.
- The wider Grand Hall goal remains active.

## Historical official v2 candidate

Run directory:

```text
F:\venviewer-provider-cache\gsfix3d\runs\grand-hall-gsfixer-base-fixed-camera-v2-e7160280-20260831T022206Z
```

Exact experiment:

- Input: authority-none 1024 x 576 RGB8 fixed-camera render, SHA-256
  `22585a23b5ced06c652f838d894a02903c2c405107dd13eaeb0957754d30ec43`.
- Candidate SHA-256:
  `2ad387c377ce7b0de9ebe989ae8e1a289e7ce19659eaf0c374e0c024e8c7c8dc`.
- Historical adapter: 27,134 bytes, SHA-256
  `fc57a75c0252d868c921ea3273f56811f60c5b9bf27abe489ff660bf6f10d608`.
- Seed 2025, four DDIM steps, processing resolution 768, output 1024 x 576,
  CUDA float16 on an RTX 4090.
- The execution was offline and network-isolated with deterministic settings.
  Bit-exact repeatability was not established by a second inference.

The historical candidate did not run through the later v4 or v5 supervisor,
attempt-private provider/model snapshots, or receipt-directory descriptor
binding. Those later controls must not be retroactively attributed to it.

## Evaluation and visual verdict

All-one-mask native-resolution metrics:

| Measure | Result |
| --- | ---: |
| SSIM | `0.731416727275937` |
| LPIPS | `0.19470929991331964` |
| MAE | `0.08122710405957811` |
| Maximum protected-edge displacement | `138.00362314084367 px` |
| Protected pixels | `589824` |
| Changed pixels | `589793` |

Diagnostic inspection shows a whole-frame warm, high-contrast repaint with
material changes across the timber and floor rather than a targeted artifact
repair. It is not scene-fine-tuned, multiview-consistent, lifted back into 3D,
or suitable for the captured master.

The formal forbidden-architecture semantic verdict is `not_evaluated`.
Inspection must not be represented as a formal clearance for windows, doors,
openings, walls, dark central floor, neighbouring rooms, facade content or
generated fill.

The authority-none evidence pack is local at:

```text
F:\venviewer-provider-cache\gsfix3d\evaluations\grand-hall-gsfixer-v2-forbidden-architecture-evidence-20260831T0800Z
```

It binds the exact source and candidate above, records 589,793 changed pixels
outside the empty generated region (589,793 changed pixels total), and includes
lossless source/candidate/difference views. The contact sheet is 4,046,058
bytes with SHA-256
`ee4dba96f41e9d9068638e821fa97df6767aab11d8b82c183ff2de09571f3ff6`;
the heatmap is 462,103 bytes with SHA-256
`6bc06496fe85fbd0ae0f190a958c135afd6cf7936ddcd2ceba8aef337b9d29c2`.
The receipt-last publication receipt is 1,240 bytes with SHA-256
`d5d6e31ad2d1aabb9210eb00a2293840024d37157932f328e8a5b52579ebfd51`.
The semantic document self-digest reported by the evaluator is
`b1e0598b357d8ae5bf8e0a6b029ef44cee8ffeb92f7a8dd964373de35445b789`;
the serialized semantic-result file is 885 bytes with SHA-256
`47d0fcee9cc8f6841eec0b99ef4035ba5d68ccb0184f92ed54ea02c26ade03f1`.
Automatic semantic detection was deliberately not performed, so these outputs
are navigation evidence for review rather than an architectural pass/fail
claim.

## Current v5 hardening artifact

Source and build identities:

- Supervisor source: 42,209 bytes, SHA-256
  `ebb5b43f4ae572bc4beba28e5199831e2039c0e86d684fde031ebc2f1ecb96c7`.
- Adapter: 77,721 bytes, SHA-256
  `8c359df43135b7e10b78d1c140c49700350feeca4db32ea002a7fe9bc98d3d42`.
- Same-host deterministic v5 bounded-reader ELF: 5,876,200 bytes, SHA-256
  `b442be9b867e7c54307e95701b151b155ffaa88c6c1f6837a6c1855701fb8b95`.
- An independent same-command rebuild has the same size and SHA-256.
- `file` reports a statically linked x86-64 ELF; `readelf` reports no dynamic
  section and no interpreter segment.
- GCC C17 strict syntax and `-fanalyzer` pass with warnings treated as errors.
- The adapter suite passes 24/24 under Linux and 20/20 applicable tests on
  Windows, with two procfs tests and the two native Linux harnesses
  intentionally skipped there.

The same-host deterministic build uses GCC 13.3.0, `-O2`, static linking,
warnings-as-errors, stack protection, fortified source, full RELRO/NOW and no
build ID.

V5 provides:

- exact argument schema and a cleared environment;
- inherited-descriptor closure and pinned Python/adapter bytes;
- Python and adapter copies in sealed Linux memfds;
- command-bound random-nonce completion proof with exact-length rejection;
- deadline-bounded proof-stream draining; a proof is valid only after EOF, so
  a late append or an escaped descendant that keeps the descriptor open is
  rejected;
- complete site-packages tree measurement before activation and after child
  execution, explicitly labelled `site_packages_only` with the host ELF/shared
  libraries, Python standard library and `lib-dynload`, and CUDA driver/device
  runtime listed as unmeasured;
- attempt-private exact provider/model execution snapshots and confined
  provider imports;
- receipt and attempt directories created through pinned parent dirfds;
- receipt path, descriptor, device and inode binding, re-attested before proof
  emission and terminal publication; and
- a provisional adapter success receipt that remains explicitly ineligible
  until the detached supervisor publishes the terminal outcome;
- Linux parent-death signalling for the direct child and handled-signal
  process-group cleanup;
- negative coverage for missing or overlong proof, wrong inode, renamed or
  replaced receipt path, an already-existing terminal receipt, and a delayed
  append from a descendant that escaped the adapter process group; and
- native deadline coverage using a continuously readable proof stream that
  never reaches `EAGAIN` or EOF.

These controls harden future trusted-host diagnostics. They do not make the
historical v2 result stronger and have not produced a new candidate.

## Why v5 is still a provenance NO-GO

The current supervisor does not bind all executable bytes that can affect the
result:

- the sealed Python file still loads an unpinned host ELF interpreter and
  shared libraries;
- Python executes host standard-library and `lib-dynload` code before the
  adapter can attest it;
- the mutable live site-packages tree has a hash-to-import time-of-check/time-
  of-use window, while the post-run hash only detects a mutation after code
  may have executed;
- provider, model and runtime trees are not mounted as one immutable execution
  filesystem;
- imported child code can see the completion nonce and descriptor, so VGH1 is
  meaningful only after the whole child closure is already trusted; and
- an uncatchable supervisor death kills the direct child but does not prove
  that every descendant is gone without a cgroup, PID namespace or equivalent
  containment; and
- network isolation is supplied by the outer launcher rather than created and
  proved by the supervisor itself.

Therefore v5 supports only ordinary trusted-host diagnostic evidence. Do not
describe it as cryptographically audited, promote a candidate because of it,
or launch another long inference merely to exercise it.

## Deferred v6 sealed-runtime design

The next provenance tier is deliberately separated from visible Grand Hall
progress:

1. A statically trusted supervisor creates its own user, mount and network
   namespaces.
2. It streams a complete content-addressed runtime SquashFS into a sealed
   memfd, mounts it read-only in a private namespace, and chroots or pivots
   into it.
3. Provider, model and inputs are exposed read-only; only descriptor-bound
   output locations are writable.
4. A VGH2 proof binds the runtime filesystem, executable closure, inputs,
   model, arguments, output identities, nonce and terminal state.
5. Supervisor and runtime hashes are reproduced independently and exercised
   against adversarial fixtures.

This is a separate hardening lane, not a prerequisite for inspecting or
rejecting the already-existing GSFixer diagnostic.

## Versioned provider catalogue

`restoration-provider-catalog-v1.ts` records the audited ArtiFixer3D+,
Difix3D+, GR3EN and GSFix3D/GSFixer identities without changing the persisted
V0 restoration-experiment schema. The exported canonical catalogue is
deep-frozen, self-digested and checked against the canonical catalogue
embedded in this build; a merely self-consistent repin is rejected.

Every execution contract is non-dispatchable and requires future execution
evidence to bind every applicable input role. Direct image evidence must bind
the exact before/after bytes. Scene-level repair evidence must bind the exact
source checkpoint, every conditioning input, the candidate checkpoint and its
derived comparison-render bytes. GR3EN evidence must bind its 81 ordered frame
and mask manifests, one-to-one index/basename correspondence, canonical
control document, compiled provider YAML and decoded candidate frame order.
GSFix3D lift additionally requires captured training images, dataset layout,
training intrinsics/poses, novel-view controls and the source 3DGS.

The focused catalogue suite passes 7/7 with strict TypeScript and ESLint. A
separate 9,315-byte frozen Difix V0 serialization fixture, SHA-256
`aa02e4ccc9bdf74b4215261f03c6b10d3e7e98b46f93ebefbf3201e4f87b2d18`,
pins the legacy profile digest and byte order while V1 evolves separately.
This is capability and lineage metadata only: it authorizes no provider
execution, upload, licence acceptance, promotion or replacement of captured
truth.

## Other official provider lanes

### ArtiFixer3D+

The plausible Grand Hall sparse model is
`F:\E57\colmap_v2\sparse\0`; its 300 JPEG cubefaces from scans 000-049 live
under `F:\E57\colmap_v2\images`. The model has 231 registered images, one
1024 x 1024 PINHOLE camera and 124,617 sparse points. `frames.bin` and
`rigs.bin` also exist in the sparse model but are not included in the three
hash assertions below.

Exact sparse hashes:

- `cameras.bin`:
  `0be6187f7574551a940222915c67b94354ac679e617854c1a545bd523c2cf3aa`
- `images.bin`:
  `6621fcb62dc5d68653df92dd5a3da2b6428a3817488a868cd86504fe048615b4`
- `points3D.bin`:
  `7f3040d7c5883810f3fbb8d41bc70640b8362ee64bc449ede9abebe44ec62f11`

Pinned identities are source
`a392c4dfe17459ef9952407accdb9fcdcdddba98`, 3DGRUT gitlink
`62e1038b74b2edc01440fd4ddf5f080109b6faba`, and model revision
`f96352ad72c84a628d5844b6543e94ae8c4479b3`. The 14B weight is
67,644,337,412 bytes, SHA-256
`c1a6d31fb849211d4c682a28b40980549cd8f807ee309e7bc0141a336ffcd16b`;
the 1.3B weight is 6,715,346,651 bytes, SHA-256
`23e909fb4232c6a74a1c59eaf0ebfd419dd188e601aa0ab0145b9aaea821e059`.

No ArtiFixer output exists. Source, model and runtime are not materialized
locally; the documented path requires at least about 80 GB GPU memory. Camera
identity, Grand Hall-only scope and masks remain authority-none pending T-554
human acceptance. Remote execution needs explicit paid-compute and private-
upload authorization, not just an API key. Code is Apache-2.0, but the released
checkpoint remains NVIDIA R&D/non-commercial pending exact legal closure.

### GR3EN

Pinned source revision:
`78fd3844a6e0fdd4eb50d0e7986ede1e7f76763b`. Pinned model revision:
`8aa83a10af8b031d015e6170fd01609d54423f4c`. The released model is an
auto-gated 33,785,456,692-byte package and requires acceptance of its Hugging
Face terms. The official path recommends at least 48 GB VRAM, beyond the local
RTX 4090.

The released capability is generative video relighting, not geometry
reconstruction. Its official batch interface consumes exactly 81 ordered PNG
frames and 81 one-to-one aligned PNG control masks plus YAML controls, and
emits a relit MP4. The paper's 3D distillation stage is not published as a
runnable pipeline. Accepted camera-path frames, masks, operator trajectory and
controls, runtime, Hugging Face token and suitable GPU are still required. No
GR3EN Grand Hall output exists.

### Difix3D+

The official one-shot lane has a successful zero-write preflight at:

```text
F:\venviewer-provider-cache\difix3d\runs\grand-hall-difix-source-pose-19890-one-shot-v1-e7160280-20260831T011030Z
```

That preflight is not an execution authorization. Minting or using a one-shot
authorization still requires a fresh explicit user grant.

## Immutable history

- `supervisor-runs/preflight-v1-20260831T031853Z`: failed before model load
  because v1 resolved the virtualenv symlink and lost its packages.
- `supervisor-runs/preflight-v2-20260831T032054Z`: succeeded with the v2
  supervisor, sealed adapter memfd, CUDA and offline namespace.
- `supervisor-runs/negative-bin-true-v3`: rejected a substitute `/bin/true`
  Python executable before receipt-directory creation with exit 125.
- `supervisor-runs/negative-no-proof-v4`: an exact supervised Python child
  exited zero without the nonce proof; the supervisor overrode it to exit 126
  with `completionProofValid=false`.
- `supervisor-runs/preflight-v4-20260831T033339Z`: succeeded with sealed Python
  and adapter memfds and a command-bound proof. V4 remains historical, not the
  recommended current identity.
- `supervisor-runs/negative-late-extra-proof-v5-20260831T0720Z`: a hostile
  fixture forked, called `setsid`, wrote the valid 37-byte prefix and appended
  a byte after the direct child exited. The current v5 terminal recorded 38
  bytes, `completionProofStreamClosed=true`, `completionProofValid=false` and
  exit 126.
- `grand-hall-gsfixer-base-fixed-camera-v1-e7160280-20260831T021627Z`: failed
  before model loading due to the initial strict matplotlib shim.
- `grand-hall-gsfixer-base-fixed-camera-v2-e7160280-20260831T022206Z`: genuine
  official diagnostic described above; rejected for promotion.

## Work still active

- T-554 room identity, interfaces, masks and Grand Hall-only selection are not
  human-accepted.
- Captured-data reconstruction, metric registration and captured-master
  selection remain incomplete.
- No ArtiFixer or GR3EN output exists, and Difix execution remains gated.
- No generated result has been lifted into an optional cinematic 3D branch.
- Venviewer tier integration and authenticated WebGL QA remain undone.
