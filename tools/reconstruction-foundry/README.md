# Reconstruction Foundry local checker and operator CLI

This tool prepares and verifies immutable private Twin candidates. It cannot
publish a release, promote a production channel, roll back, list or delete R2
objects, or change a bucket policy.

## Start here: check one file or folder on this computer

Open PowerShell in the OmniTwin repository, replace the example path, and run this one command:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli foundry -- local-app --source "C:\path\to\your-capture"
```

Then follow these steps:

1. Copy the private local link printed in PowerShell and open it in your browser. Add `--open` to the command only if you want the tool to open that link for you.
2. Wait while the app reads file names, sizes, format clues, and fingerprints. A fingerprint is a short code used to tell whether two files contain exactly the same bytes.
3. Read the findings. **No files are approved yet.** The technical word shown in the receipt is “quarantined”; here it only means a person still needs to check who owns the file, where it came from, and how it may be used.
4. In **Decide every file**, choose **Keep in review draft** or **Leave out of review draft**. “Keep” records a proposed type and origin; it does not grant rights or prove physical accuracy. Unknown or weakly identified formats cannot be kept by this simple screen.
5. Enter a short project ID and your name, then click **Build review draft**. The result is tied to the exact receipt and has authority `none`.
6. Click **Build plan preview** to compare this-computer CPU, this-computer GPU, and RunPod routes. Missing worker programs, computer capacity, or cloud price evidence appears as a blocker. The preview does not contact RunPod, upload data, start software, or spend money.
7. Download the receipt, review draft, result draft, and plan preview if you need to keep them. Your browser normally saves the JSON files in its Downloads folder. The local server keeps no copy and writes nothing beside the capture. These files contain relative file names, fingerprints/header evidence, the project ID, and the reviewer's name. Check them and keep them private before sharing.

What is safe in this screen:

- It reads the one file or folder named in the start command.
- It listens only on `127.0.0.1`, which means this computer.
- It can identify likely formats, sizes, exact duplicate files, and reasons a person must review them.
- It can compile a fingerprint-bound review draft and a non-executable plan preview entirely in memory.
- It keeps captured, enhanced, generated, and imagined material in separate truth categories.

What this screen cannot do:

- It cannot accept a different file path from the browser.
- It cannot change, copy, legally approve, upload, reconstruct, train on, or publish source files.
- It cannot measure this computer, discover credentials, invent a cloud price, contact a provider, start a process, or authorize spending.
- It creates no cloud or internet request of its own. Use a truly local disk or removable drive: a mapped, shared, or cloud-synced drive can make Windows fetch file bytes from another computer and is unsupported.

### Optional GLB format preview

The page contains a separate **Optional offline GLB format preview** panel. In
the normal command shown above, this panel stays blocked. That is intentional:
the browser is not allowed to choose a file path, supply its own trust key, or
grant itself permission to process a file.

The panel becomes available only when a trusted process has already supplied
all three of these things to the local app:

1. one exact intake receipt tied to one exact local GLB;
2. one pinned public key chosen outside the browser; and
3. one short-lived, signed permit for the exact source bytes and the exact
   format-only operation. The trusted local process accepts that permit digest
   at most once while that process remains alive.

When those checks match, the operator can request one attempt. The click sends
only opaque receipt, asset, and request references; it does not record a new
operator statement, approve rights, or issue the signed permit.
The app reads the exact file into memory and gives the transform helper only
those bytes, never the file path. It reads the file again after transformation,
then gives the fresh bytes and candidate to a separate verifier helper. That
second helper repeats the complete deterministic checks away from the app's
main event loop before any download is offered. Both helpers must be confirmed
stopped. The result is kept in this process's memory only until the permit
expires or the local session stops.

This preview does **not** add detail, improve appearance, reconstruct geometry,
prove physical accuracy, approve rights, or make anything production-ready.
It has authority `none`, and production execution remains disabled. The helper
has a 64 MiB input/output cap, a deadline, and V8 heap settings. Those are not a
hard whole-process or computer-memory limit: transferred buffers and native or
WASM code can use memory outside the V8 heap, and the process can still run out
of memory. It runs as the current Windows user, is **not a security sandbox**,
and must receive only a trusted private source.

The controller rejects direct network-share/device paths, noncanonical paths,
and symbolic links, junctions, or hard-linked source files that are present
when it checks. This is not protection against another program running as the
same Windows user and deliberately replacing part of the path during the read.
It also cannot prove that a normal drive-letter path is not a mapped drive or
cloud placeholder.
That fact is therefore reported as `localVolumeEstablished: false`. Independently
confirm that the source is on a truly local disk before enabling this preview;
otherwise Windows could fetch bytes over a network despite the app making no
network request of its own.

The app deliberately writes no server output file and clears its buffers only
on a best-effort basis. This is not secure erasure: Windows paging, crash
dumps, or other operating-system behaviour may leave additional copies.

Downloading creates another copy. The browser writes the GLB or JSON report
to its normal Downloads location, which may be cloud-synced. The operator is
responsible for that downloaded copy, while the app keeps its separate memory
copy until permit expiry or session stop. A consumed permit cannot be reused in
the same trusted local process. This memory-only controller cannot prove
single use across a complete process restart; the trusted permit issuer or a
future durable orchestration ledger must prevent that wider replay. Start a
new local session with a newly issued permit for another legitimate attempt.

To stop it, click **Stop local session** on the page, or press this exact keyboard command in the same PowerShell window:

```text
Ctrl+C
```

The private session also stops by itself after four hours. The page keeps showing the time remaining and warns during the final 15 minutes. Start the command again to make a new session. If a fixed local port is necessary, add `--port 43127` using any free port from 1024 through 65535.

The app does not say that it has stopped until it can confirm that every preview
helper has ended and every read-only source-file handle has closed. If either
confirmation fails or does not answer promptly, the local server remains in its
**stopping** state instead of reporting a completed stop. A program that called
`stop()` can try again immediately. The app also keeps trying automatically,
including after the four-hour limit, until it receives both confirmations.

## Advanced commands

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- local-app --source C:\path\to\capture-drop
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- inspect-intake --source C:\path\to\capture-drop
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- admit-intake-draft --receipt C:\path\to\receipt.json --review C:\path\to\review.json
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- stage-intake-draft --source C:\path\to\capture-drop --receipt C:\path\to\receipt.json --review C:\path\to\review.json --out C:\path\to\verified-stage
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- plan-job-draft --request C:\path\to\plan-request.json --manifest C:\path\to\foundry-ingest-manifest-v0.json
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- verify-training-candidate --bundle C:\path\to\extracted-run --venue-id trades-hall --run-id 20260713T120000Z-pod-abc123
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli lcc2-frontier -- --manifest "C:\path\to\scene.lcc2" --environment exclude
pnpm --filter @omnitwin/reconstruction-foundry-cli foundry -- prepare --bundle C:\path\to\twin --out C:\path\to\evidence
pnpm --filter @omnitwin/reconstruction-foundry-cli foundry -- upload-candidate --prepared C:\path\to\evidence
pnpm --filter @omnitwin/reconstruction-foundry-cli foundry -- verify-candidate --prefix candidates/venue-slug/64-character-release-digest
pnpm --filter @omnitwin/reconstruction-foundry-cli foundry -- prepare-signing-request --payload C:\Downloads\signing-payload.json --out C:\foundry\signing-request
pnpm --filter @omnitwin/reconstruction-foundry-cli foundry -- assemble-attestation --payload C:\Downloads\signing-payload.json --key-id venue-release-key --signature-base64 BASE64_FROM_KMS --out C:\foundry\attestation.dsse.json
```

`lcc2-frontier` reads the vendor's `.lcc2` JSON tree and selects the files used
by every leaf node at the declared highest-detail level. It does not guess the
level from a file name. It proves every published LOD count, rejects gaps,
overlaps, missing files, linked paths, hard links, and files that change while
being read. It also validates every declared SOG/SPZ container and requires its
embedded Gaussian count to match the manifest. SOG validation fully decodes
the required WebP images and checks their real v2 slots, dimensions, codebooks,
and pixel capacity. Every validated leaf, ancestor, and environment file is
fingerprinted into the receipt. You must say whether the
separate `env.sog` or `env.spz` file is included or excluded; it is never added
silently. The command prints a deterministic JSON receipt and makes no source
write or network request.

`inspect-intake` accepts one file or folder and recursively produces a JSON
receipt on standard output. It reads regular files in bounded chunks, records
their relative path, size, modification time, SHA-256, format evidence, and
exact-content duplicate groups. It does not copy, rewrite, decode, decrypt, or
reconstruct source data, and it creates no network client or cloud request.

Every inspected file remains quarantined because a dropped file does not prove
ownership, permitted use, or provenance. The receipt gives a plain-language
next action for each reason. This command cannot create
`FoundryIngestManifestV0`, admit an asset, start training, or promote anything.
Unknown formats and proprietary containers require operator or vendor review;
symbolic links already present during discovery are rejected before opening.

Use the documented `--silent` invocation when another program will consume the
receipt, so package-manager progress text does not surround the JSON. The
receipt intentionally contains no wall-clock “generated at” value: unchanged
source paths, bytes, and file modification times produce the same JSON and the
same receipt digest.

The scan fails closed if a path is replaced, becomes a symbolic link, changes
while hashing, or if the final file set no longer matches discovery. The
receipt is therefore a verified snapshot of what was observed during that
completed scan; it is not proof that the files can never change afterward.
One intake is bounded to 100,000 regular files, 100,000 directories (including
the root), and 256 nested directory levels. Directory entries are streamed;
file bytes use one 8 MiB work buffer plus at most 64 KiB of retained header.

The current shared format vocabulary does not yet have distinct types for
`.splat`, `.ksplat`, `.pcd`, `.pts`, or `.exr`. Those files are kept as
`unknown` and quarantined rather than being mislabeled. Adding those types is a
separate shared-contract change in `@omnitwin/types`.

Run intake only against a local disk or removable drive controlled by the
operator. Direct Windows UNC and device paths are rejected. Mapped network
drives are unsupported because Node cannot reliably distinguish them from
local drive letters. The inspector creates no network client, but Windows does
not offer Node a true “open without following any newly inserted reparse
point” flag. Identity checks reject a path replacement before replacement
content bytes are read; they are not a defence against another hostile process
deliberately rewriting the source tree during the scan.

`admit-intake-draft` consumes the exact receipt plus an all-path, self-digested
operator review. Every receipt path must be admitted or explicitly excluded.
Admitted size and SHA-256 values must match the receipt, detector selections
must match a recorded candidate unless an evidence-backed override is present,
and proprietary raw XGRIDS payloads remain technically blocked. The output is
a deterministic `FoundryIngestManifestV0` with legal review still
`requires_review` or `blocked`, authority `none`, and no execution capability.

`stage-intake-draft` repeats the complete source inspection, copies only the
admitted bytes through mutation-detecting file handles into a sibling temporary
directory, re-inspects the source, writes the receipt/review/result/exclusion
evidence and draft manifest, then atomically promotes and re-verifies the exact
local stage. Existing outputs are never replaced. This is local custody work;
it does not plan a job, dispatch compute, train, sign, publish, or promote a
runtime package.

The shared Foundry package now also contains a sealed `inspect_sources` worker
core for the next execution slice. It accepts one exact verified stage plus a
single-stage, zero-cost local JobSpec; rejects arbitrary commands, network/GPU
use, links, hardlinks, incomplete purpose-aware rights, evidence drift, and
overlapping output paths; then performs handle-bound full hashes and bounded
header detection. It writes canonical `source-inspection.json` followed by a
self-digested `artifact-index.json` commit marker in a new private directory.
Both artifacts have authority `none`. The worker explicitly records that the
upstream execution subject, live approval, worker-profile allowlist, and fence
are not established inside the worker. It is therefore exported for a future
reviewed control-plane adapter but is intentionally not exposed as a CLI/API
run command yet. It does not decode payloads, reconstruct geometry, increase
visual detail, register an artifact, sign, publish, or promote anything.

The package also contains the first bounded proof core for
`normalize_mesh_glb/v0`. Its test-only in-memory harness accepts exactly one
hash-and-size-bound GLB and rejects `.gltf`, URIs, input extensions, extras,
materials/textures/images, cameras, skins, animations, morph targets, sparse
or quantized accessors, custom attributes, non-triangle topology, and
non-identity transforms. The reviewed subset is indexed static geometry with
float32 `POSITION` and uint16/uint32 indices, one tightly packed accessor per
buffer view. It registers only glTF Transform's `EXT_meshopt_compression`
extension and manually selects its lossless `NONE`-filter encoder path; it
does not call the convenience `meshopt()` transform or any quantize, reorder,
simplify, weld, deduplicate, prune, or texture operation. Before and after GLBs
must have zero Khronos Validator errors and warnings, and every output view is
independently meshopt-decoded into an exact canonical semantic snapshot before
the authority-`none`, self-digested report is returned.

Production `normalize_mesh_glb/v0` execution is disabled on every platform
before source parsing or filesystem access. A byte hash alone is not execution
authority: the reviewed adapter must still bind the exact verified stage,
ingest/admission evidence, JobSpec, live attempt/fence, worker profile, and
purpose-aware normalization-derivative rights. Recipe-stage scoping and that
control-plane binding remain blocked, so no CLI, API, scheduler, provider, or
object-store path can run this transform. The pure harness requires
`NODE_ENV=test` and is deliberately absent from the package root export.

`plan-job-draft` compiles one explicit digest-pinned stage recipe against the
exact manifest into local and/or remote routing candidates. It checks input
identity, purpose-aware rights, local/remote capacity, D-016's local-training
ban, provider-estimate freshness and the cost cap. Every emitted JobSpec is
literal `plan_only` with `computeApprovalId: null`; the command has no provider
SDK, credentials, object-store mutation, process spawn or executor.

`verify-training-candidate` locally verifies an extracted D-014 v0 candidate:
exact top-level file set, placeholder signature, manifest identity, every size
and SHA-256, bounded duplicate-key-safe JSON, completed monotonic metrics,
held-out summary consistency, exact gsplat float32 PLY layout/payload, and a
final whole-tree reinspection. Bilateral-grid candidates fail closed because
the legacy contract does not declare the tensor's view count, channels,
layout, dtype/endian, or serialization. A passing result remains an
`untrusted_candidate_verified` dossier with authority `none`; legacy D-014 v0
does not bind the ingest manifest, JobSpec, provider plan, durable attempt
ledger, quality contract, or trusted signature, so signing, registration,
runtime use, publication, and promotion stay blocked.

Production `inspect_sources` file-output execution currently fails closed on Windows. Portable
Node filesystem APIs cannot prove a private Windows ACL, so a reviewed Windows
ACL or OS-sandbox backend is required before this worker can run there outside
its test-only core harness. The harness is guarded by `NODE_ENV=test` and is
not exported from the package root. No CLI, API, scheduler, or provider adapter
invokes the worker yet.

`prepare` is local and read-only with respect to the Twin folder. It writes
three immutable evidence sidecars to a separate output folder.

`upload-candidate` and `verify-candidate` require these environment variables:

```text
FOUNDRY_R2_ACCOUNT_ID
FOUNDRY_R2_ACCESS_KEY_ID
FOUNDRY_R2_SECRET_ACCESS_KEY
FOUNDRY_R2_CANDIDATE_BUCKET
```

`R2_SESSION_TOKEN` and `FOUNDRY_R2_ENDPOINT` are optional. Use a dedicated,
private candidate bucket and credentials restricted to object reads and
writes. The CLI itself always sends create-if-absent writes and exposes no
overwrite operation. Never use an unrelated public-bucket token for candidate
intake.

## Keyless signing handoff

Download the exact signing payload from the visible Foundry review screen.
`prepare-signing-request` validates every payload byte and writes:

- `dsse-pae.bin`: the exact raw bytes the controlled Ed25519 KMS must sign;
- `signing-request.json`: release/review digests and the PAE digest;
- `dsse-envelope-template.json`: a clearly marked, non-uploadable template.

Ask the KMS to sign `dsse-pae.bin` as a **RAW Ed25519 message**. Then pass only
the returned base64 signature and trusted key ID to `assemble-attestation`.
The CLI accepts no private-key option and never signs anything itself. Upload
the assembled `.dsse.json` through the Foundry review screen for server-side
trusted-key verification.
