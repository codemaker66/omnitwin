# Reconstruction Foundry operator runbook

Status: **local evidence and candidate-review tooling only**, updated
2026-08-09. T-486 remains in progress.

This runbook covers commands and pages that are reachable in the current
repository. It does not describe a browser drag/drop reconstruction pipeline,
general compute service, production Runtime Foundry dashboard, public release
promotion, or active-release browser loader because those paths are not
verified end to end.

## 1. Start the source-bound local app

Choose one local file or folder before the browser starts:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- local-app --source "F:\path\to\capture-or-folder"
```

Add `--open` to launch the printed loopback URL or `--port 43167` to request a
fixed loopback port. The browser cannot choose another capture path and does
not accept capture-media drag/drop. Use a confirmed local/removable disk; a
mapped or cloud-backed drive can make Windows fetch bytes remotely even though
the app creates no network client.

The guided app currently displays:

1. Universal Intake Receipt;
2. Universal Source Facts **V5**;
3. an authority-none operator review draft;
4. a non-executable local/remote route plan preview;
5. optional permit-gated, memory-only GLB format preview controls; and
6. a link to the local JSON review page for Room Reality candidate metadata and
   generated E57 crop visuals.

It does not reconstruct, train, approve rights, discover credentials, contact
a provider, sign, publish, promote, or activate a runtime.

## 2. Inspect the V6 source-facts chain

The advanced CLI, not the guided app, reaches Source Facts V6:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- inspect-source-facts --source "F:\path\to\capture-or-folder"
```

V6 first rebuilds and verifies the complete intake/V5 pair, then adds one
receipt-bound ordinary point-cloud PLY refinement per matching candidate. The
PLY refinement inspects bounded header structure and exact payload extent from
the bytes retained during hashing. It does not decode coordinates or establish
units, frame, scale, accuracy, provenance, rights, registration, or movable
object classification.

Recognized mesh, classic Gaussian, and PlayCanvas packed PLY profiles do not
pass as ordinary point geometry. Other Gaussian variants require review.
LAS/LAZ, XYZ, Grand Hall-scale E57 geometry decode, and fusion workers are not
supplied by V6. A separate local authority-none pye57 seam can exercise at most
a 256 MiB container, 1,000,000 Cartesian points, 64 scans, and 79 fixed-size
batches with complete explicit poses. It re-reads from the selected scan's
beginning for each batch and is not a streaming production worker. The accepted
0.4.19 binding's exposed `CompressedVectorReader.seek` method returned
libE57Format `ErrorNotImplemented` on the tiny ASTM-E57 fixture. Resume replays
and verifies the bounded source prefix. Whole-container hashes include possible
image bytes, although the bridge does not decode or extract images. The
path-based source, bridge, interpreter, and dependency environment remain
caller-supplied/unverified and cannot provide activation evidence.

## 3. Admit and stage an exact draft

Admission requires the exact receipt plus an all-path, self-digested operator
review:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- admit-intake-draft --receipt C:\private\receipt.json --review C:\private\review.json
```

The result remains `requires_review` or `blocked`, authority `none`, and
non-executable. It cannot elevate rights.

To make a verified local custody copy of admitted bytes:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- stage-intake-draft --source "F:\path\to\capture" --receipt C:\private\receipt.json --review C:\private\review.json --out C:\private\verified-stage
```

Staging re-inspects the source, copies through mutation-detecting handles,
writes evidence sidecars, atomically creates a new output, and verifies it.
Existing output is not replaced. Staging is custody work, not processing or
execution authority.

## 4. Compose independently admitted roots

Create a JSON input containing `projectId`, `createdAt`, `createdBy`, and two
or more `mounts`. Each mount needs a unique `namespaceId` and the complete
self-digested `admissionResult`. Then run:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- compose-capture-bundle --input C:\private\bundle-input.json
```

The composer:

- re-verifies each embedded admission result;
- deterministically remaps roots, frames, transforms, assets, provenance
  edges, operation IDs, and generated regions;
- preserves the strictest legal state;
- rejects the same content mounted from different roots; and
- returns authority `none` with the original no-execution capabilities.

It reads no source bytes, copies nothing, and does not align, scale, register,
or fuse coordinate systems.

## 5. Assess adapter truth

Provide one exact ingest manifest and an explicit host inventory containing all
five reviewed dependency entries in canonical order. Use the listed version
only when the dependency status is `available`; `missing` and `unverified`
entries carry a null version:

- `pye57_read_only_metadata_probe` 0.4.19;
- `pye57_cartesian_geometry_reader` 0.4.19;
- `gltf_transform_core` 4.3.0;
- `gltf_validator` 2.0.0-dev.3.10; and
- `meshoptimizer` 1.2.0.

The pye57 Cartesian dependency entry records only a caller-supplied host
observation that the narrow reader is present. It does not authenticate its
runtime environment or make the recorded 965.52-million-point Grand Hall E57
processable; that exact asset remains worker-missing.

Run:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- assess-adapters --manifest C:\private\manifest.json --host C:\private\host-capabilities.json
```

This is a pure assessment. It does not probe the host or asset bytes. Read each
asset's blocker literally: structural inspection is not processing;
availability of a dependency is not execution authority; the narrow GLB core
does not establish that an exact `glb_gltf` asset is a compatible GLB; and
XGRIDS XBIN requires an official reviewed export or SDK.

The current Grand Hall metadata-only preflight and reproducible command are in
`docs/operations/grand-hall-universal-foundry-preflight-2026-08-09.md`.

## 6. Assemble a blocked Room Reality Package candidate

Create an assembly input with `ingestManifest`,
`verifiedIngestManifestSha256`, `packageDraft`, and `referenceCatalog`, then
run:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- assemble-room-package --input C:\private\assembly-input.json
```

A complete structural reference graph produces `local_unverified_candidate`,
not an approved runtime. Expect these release blockers:

- caller-supplied unauthenticated reference catalog;
- unverified exact derived-member identities;
- unverified captured movable-object classification; and
- unresolved or blocked rights when the manifest is not approved.

Signing, publication, export authority, RuntimePackage registration, and
runtime activation remain disabled. A structurally incomplete graph returns a
blocked result with actionable missing references.

## 7. Review candidate metadata and bounded crop visuals locally

### Candidate metadata

Start the local app as in step 1 and open its **Review a Room Reality Package**
link. Paste or choose one JSON dossier containing the authority-none candidate
and optional strict transform, Scene Authority Map, and QA bodies.

The page records one decision and note for each of:

- source comparison;
- alignment;
- scale;
- crop;
- completeness;
- privacy; and
- movable objects.

It emits a digest-bound local review draft. The evidence bodies remain
caller-supplied and unauthenticated. The page does not open real media, compare
pixels, decode geometry, apply a transform/crop/mask, approve rights, or create
a release decision. A download may be written to a cloud-synced Downloads
folder; protect it accordingly.

### Generated E57 crop visuals

The same `/room-review` page can open a locally chosen
`FoundryE57GeometryCropV0` JSON artifact and an optional comparison artifact.
Each artifact is capped at 12 MiB and 50,000 points. The comparison must be a
distinct artifact with the same exact source bytes, source-facts digest, frame,
axes, and units; a cross-source overlay requires reviewed registration evidence
that this page does not create.

The browser validates the schema, self-digest, source binding, bounds, and
authority-none policy before drawing the points in a bounded Canvas projection.
It requires an explicit decision for all seven dimensions listed above; source
comparison is assessable only while a compatible, non-empty second overlay is
visibly enabled. Preview corrections and annotations do not modify an artifact
or create a TransformArtifact, mask, or QA result.

The file stays in browser memory: raw E57 and source images are not read and no
artifact is posted to the loopback server. Authority is `none`; execution,
correction application, TransformArtifact and Scene Authority creation, QA
approval, package export, and runtime activation are all `not_authorized`.

Browser QA opened two distinct compatible generated test crops at the maximum
50,000 points each (100,000 overlaid points). Measured Canvas render timing was
55.1 ms average / 85.7 ms maximum on mobile and 58.45 ms average / 69.8 ms
maximum on desktop. This is an honest P2 result, not 60 fps, not raw Grand Hall
E57 processing, and not the timeline's 500-object/Spark performance proof.

### Bounded metric-registration proposal

The package exports a deterministic source-to-target proper 3D similarity
proposal contract, bounded to 4,096 exact digest/frame/unit-bound
correspondences with partitions fixed before solving. It records separate fit
and held-out residuals and conditioning. Independent adversarial review
returned GO for this bounded contract only.

There is no operator CLI/UI for the proposal and no Grand Hall correspondence
set was processed here. Its result is
`local_unverified_registration_proposal`: overlap is `not_computed`, a reviewed
TransformArtifact is `not_created`, and placement, measurement, export, and
runtime authority remain `none`. Real correspondences, overlap/fusion review,
human transform approval, QA, and activation remain later gates.

## 8. Interpret the two GLB preview boundaries

### Memory-only local-app preview

The optional local-app panel is hidden/blocked unless the launching trusted
process supplies an exact receipt, pinned public key, and short-lived signed
permit for one exact GLB and format-only operation. The helper receives bytes,
not a browser-supplied path, and a separate helper freshly verifies the result.
The output remains authority `none`; downloading creates a separate private
copy.

### Durable resumable preview core

`runFoundryLocalResumableNormalizationPreview` is an exported package core for
the same narrow static-geometry GLB normalization subset. It binds a verified
stage, exact job and derivative-rights evidence, signed permit, host-owned
record-authentication key, fenced lease, append-only state chain, checkpoint,
fresh verification, and create-only artifact index. It supports a deliberate
pause after checkpoint and resumes from the exact authenticated checkpoint.

The built-in durable backend is Linux-only. It pins private roots, resolves
children through no-follow directory handles, serializes every lease mutation
with a kernel file lock, carries monotonic fencing tokens through abandoned
lease records, and publishes durable files by fsync plus atomic no-overwrite
link. Windows and macOS refuse before creating or reading any configured root;
they require a separately reviewed backend rather than a weaker fallback.

There is currently no operator CLI, HTTP API, scheduler, or dashboard action
for this durable core. Do not call its transform helper directly or describe it
as reconstruction. Its output is `private_quarantine_review_only`, every
authority remains `none`, and production execution is disabled.

## 9. Day/Week timeline handoff

The timeline freezes furniture separately from the exact room-package
ID/revision/digest. Browser cache code has unit coverage proving that Day and
Week requests with different furniture and independent snapshot bindings reuse
one decode when their exact ordered captured-room visual bytes and transform
are identical. Each binding is still authorized separately. Database aliases,
package paperwork, and nonvisual members do not justify a room crossfade.

This is not real Grand Hall browser proof. T-541 still blocks authenticated
activation and private member delivery, so no Room Reality candidate from this
runbook may be inserted into a timeline by bypassing the activation boundary.
Do not demonstrate room-package crossfade until a second genuinely distinct,
rights-cleared, reviewed capture exists.

## 10. Developer verification

After changing these contracts, run:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry test
pnpm --filter @omnitwin/reconstruction-foundry lint
pnpm --filter @omnitwin/reconstruction-foundry typecheck
pnpm --filter @omnitwin/reconstruction-foundry build
pnpm --filter @omnitwin/reconstruction-foundry-cli test
pnpm --filter @omnitwin/reconstruction-foundry-cli lint
pnpm --filter @omnitwin/reconstruction-foundry-cli typecheck
pnpm --filter @omnitwin/reconstruction-foundry-cli build
```

Real-source acceptance additionally requires explicit rights, read-only
custody, human review, interruption/reload proof, desktop/mobile browser proof,
and the 500-object performance path. Synthetic fixtures prove contracts only.

## 11. Release commands retained in the repository

The CLI still exposes `prepare`, `upload-candidate`, `verify-candidate`,
`prepare-signing-request`, and `assemble-attestation`. It deliberately exposes
no publish, promote, rollback, delete, list, bucket-policy, or private-key
command.

Do not infer from those commands that production release is operational. This
session did not apply migration 0049, provision or write R2/KMS, upload customer
bytes, publish a release, move a production pointer, verify a Runtime Foundry
dashboard, or verify an active-release browser resolver/hash path. Production
publication and activation need a separately reviewed runbook after T-541 and
the missing browser/operator surfaces exist.

## Stop conditions

Stop rather than bypass a gate when:

- a receipt, source-facts, stage, manifest, candidate, checkpoint, or output
  digest differs;
- a source path changes, becomes linked, or is not on confirmed local custody;
- rights are blocked, incomplete, expired, or for a different purpose;
- an XGRIDS/PortalCam source has no reviewed official export/SDK path;
- units, axes, origin, transform, overlap, crop, completeness, privacy, or
  movable-object classification are unresolved;
- Windows private-output custody cannot be established;
- a permit, lease fence, checkpoint, or fresh verification fails;
- a caller asks to register, publish, activate, or timeline-bind an
  authority-none candidate; or
- the only evidence is a synthetic fixture or metadata-only preflight.

Stop the local app with its **Stop local session** control or `Ctrl+C`. The app
does not claim a completed stop until its helper work and source handles have
ended.
