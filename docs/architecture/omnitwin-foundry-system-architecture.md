# OmniTwin Foundry system architecture

**Status:** proposed architecture for review; it does not supersede accepted ADRs.

**Boundary:** ingest-to-canonical-package. The existing Reconstruction Foundry remains the downstream review, signing, publication and active-channel boundary.

## Decision summary

Build one product with clear internal ports:

- existing React UI reused as the operator experience;
- a thin Tauri 2 shell candidate, with Electron as fallback after a three-OS renderer spike;
- a local control daemon that owns project state, read-only ingest, planning and sidecar lifecycle;
- digest-pinned workers for geometry, registration, appearance, semantics, QA and packaging;
- a Foundry-owned JobSpec and artifact/provenance registry;
- local inspection, planning, deterministic geometry and non-training validation first, with accepted D-016 retaining RunPod as the only current splat-training environment and replaceable Temporal/SkyPilot/Kubernetes/provider adapters later;
- the existing Reconstruction Foundry as the only release/publish boundary.

Do not begin with a distributed microservice fleet. The named services below are logical capability boundaries and worker contracts. They may share one daemon/process until load, security or team ownership justifies separation.

## Architecture comparison

| Option | Strength | Cost/risk | Decision |
|---|---|---|---|
| Tauri shell | small package, Rust permission boundary, reuses web UI | OS WebViews vary; GPU/codec parity must be tested | preferred shell candidate |
| Electron shell | deterministic bundled Chromium, mature sidecars | larger attack/update footprint and memory | fallback for renderer parity |
| Browser only | zero install, familiar UI | cannot safely inventory tens of GB or manage local GPU tools without a bridge | remote-review mode only |
| Qt | high-quality native UI | LGPL/GPL/commercial compliance; duplicates React; Qt WebEngine obligations | reject unless native needs dominate |
| Fully native per OS | maximum integration | three code paths and no React reuse | reject |
| Web UI + local daemon | secure file/process separation, cross-platform, local-first | daemon lifecycle/signing complexity | recommended logical pattern; ADR acceptance pending |
| Web UI + remote jobs only | easy fleet control | upload cost, privacy, offline failure and lock-in | optional execution, not default |

## Context and ownership

    Capture media / E57 / CAD / vendor exports
                       |
                       v
      Operator UI -> Local control daemon -> Foundry project registry
                       |                         |
                       v                         v
                 Worker planner --------> Artifact/provenance store
                       |
              +--------+---------+
              |                  |
              v                  v
        Local executors    Approved remote adapters
              |                  |
              +--------+---------+
                       v
         Canonical multi-representation package
                       |
                       v
      Existing Reconstruction Foundry review/sign/publish

Ownership rules:

- the operator UI owns interaction state only;
- the daemon owns durable project/control state;
- workers own no canonical state and communicate through declared artifacts;
- the registry owns hashes, lineage, rights state, transforms and quality;
- executors own ephemeral scheduling identifiers only;
- the publisher cannot infer missing QA or provenance.

## Logical components

### Operator UI

Responsibilities:

- create/open project;
- request read-only roots through the shell permission broker;
- review inventory, rights warnings, coordinate candidates and job plans;
- display cost, resource, progress, logs, uncertainty and recapture;
- compare fixed views and collect independent human decisions;
- explicitly request execution and downstream release handoff.

It never receives cloud credentials, arbitrary filesystem access or raw worker process handles.

### Desktop shell

The shell brokers file/directory grants, daemon startup, deep links, OS notifications, code signing/update/rollback and renderer GPU diagnostics. Its allow-list contains only daemon commands; it cannot construct arbitrary shell strings. The daemon receives opened handles or canonical granted roots, not unconstrained paths from web content.

### Local control daemon

Responsibilities:

- project locking and schema migrations;
- deterministic read-only inspection and hashing;
- source-rights/access policy;
- processing DAG compilation;
- provider-neutral job planning;
- worker sandbox/mount construction;
- event/log/progress streaming;
- checkpoint/retry/cancel/kill;
- artifact verification and registry commit;
- local review evidence capture;
- package assembly request.

Use localhost IPC with per-project/session authentication and strict origin checks. Prefer a versioned HTTP/JSON or gRPC boundary that also works with a browser review client. Never expose it on the LAN by default.

### Ingest service

Inspect signatures before extensions. Record ordinary metadata without decoding arbitrary payloads. Emit FoundryIngestManifestV0 with:

- immutable source root, explicit case-sensitivity semantics and relative path;
- byte size and full SHA-256 for staged/authoritative artifacts;
- type, MIME and access state;
- coordinate/calibration relationships;
- source/parent relationships;
- commercial, training and redistribution decisions;
- provenance class, typed evidence kinds, inspection value and caveats.

Giant raw files may receive an explicitly labeled diagnostic sample fingerprint during discovery, but full SHA-256 is required before they become archival truth inputs. Sampling is never represented as a full digest.

V0 bounds a manifest to 100,000 assets and a canonical package to 100,000 representations in aggregate. Larger programmes must shard into reviewed manifest/package revisions instead of constructing unbounded in-memory arrays.

### Registration and geometry workers

Workers are separate images because native/CUDA/ROS/dependency stacks differ. Candidate families:

- libE57Format/PDAL for point I/O;
- KISS-ICP/LIO-SAM/GTSAM for odometry/fusion candidates;
- COLMAP global/incremental and curated hloc models for image registration;
- Open3D TSDF/ICP and PoissonRecon for deterministic meshes;
- AliceVision as an MPL-compliant secondary photogrammetry lane;
- clean licensed neural surface experiments isolated from authoritative defaults.

Every worker consumes explicit frames, calibration and rights policy. A worker cannot silently assume units, axis, handedness, quaternion order, opacity/scale convention or camera model.

### Appearance workers

Candidate workers include gsplat and 3DGRUT after dependency/patent review; deterministic texture/PBR pipelines; hero micro-splat/mesh lanes; and runtime transcoders. XGRIDS-derived inputs remain conditional adapters. The graphdeco/noncommercial family is excluded from the production default.

### Semantic service

Start with SAM 2 proposal masks, project/fuse them against authoritative geometry, and require human review. Open-vocabulary labels and 3D checkpoints are separately licensed capabilities. Semantics never edit geometry implicitly.

### Backend recommender

The recommender consumes only declared project purpose, source-accuracy tiers, asset rights, calibration/frame state, camera/path connectivity, coverage, resource profiles and prior evidenced outcomes. It returns a ranked graph and materially different alternatives with mechanism, licence posture, expected evidence, failure modes and falsifiers. It records exclusions and uncertainty. It cannot change rights, transforms, authority, quality outcomes, JobSpec execution intent, approval or publication state; a human chooses the graph, the rights policy issues a separate trusted decision, and the operator separately confirms execution.

### Generative enhancement service

This service accepts only a captured/enhanced input, region mask, conditioning assets, approved model policy and output class. It writes a distinct output asset and FoundryGeneratedRegion record. It cannot publish to captured authority, planning mesh, collision or navmesh roles.

### QA service

The QA service evaluates a versioned FoundryQualityContractV0 whose definition digest resolves through a trusted immutable profile registry. It emits raw measurements and typed evidence references; it does not choose a nicer status. A passed report must contain every required measured pass and every required human approval, and the evidence resolver must validate subjects, evidence kinds and reviewer attestations. The registry/store is an integration boundary, not implemented by the contract module.

### Packaging service

Assemble a FoundryCanonicalVenuePackageV0:

- venue and room frames;
- measured/planning/collision/nav/architectural geometry;
- visual splat and hero/PBR overlays;
- semantic graph, uncertainty map, camera spawn points, optional guided paths and room connectivity;
- `venueTransformArtifactAssetId`, per-representation `transformArtifactAssetId` and `sceneAuthorityMapAssetId` references;
- passed evidence-resolved quality report IDs, generated-region records and nullable `releaseManifestAssetId`;
- master and runtime format descriptors.

It then creates an input candidate for the existing Reconstruction Foundry. It never updates the production pointer.

## Canonical data model

### Source and artifact identity

All authoritative artifacts are content addressed. Human-friendly IDs are stable manifest keys; identity is the digest. Paths are traversal-free relative POSIX paths inside a granted root or object prefix, and each source root declares case sensitivity so locator uniqueness follows the actual filesystem/object-store semantics.

### Frames and transforms

Frames identify venue control, room local, sensor, camera, LiDAR, geodetic, projected or arbitrary spaces. Units, handedness, up axis, authority and nullable structured CRS are explicit; geodetic/projected frames require the appropriate CRS and axis order. Transform edges are proposed/reviewed/rejected and reference:

- `operationKind`: affine similarity or CRS projection;
- a column-major matrix for affine similarity, or null for a CRS projection;
- source/target frames;
- source evidence assets;
- alignment method;
- residual distribution and overlap/control evidence;
- creator and human reviewer;
- `transformArtifactAssetId`, `residualReportAssetId`, `reviewerAttestationAssetId` and, for CRS projection, `projectionArtifactAssetId`.

A reviewed edge requires distinct, resolvable assets typed as TransformArtifact, residual report and reviewer attestation. CRS projection must be a separate geodetic-to-projected operation with no affine matrix and a typed projection-operation asset; an affine edge cannot hide a geodetic conversion. “Accepted” is not a separate transform state.

No render-layer transform is authoritative because it exists in frontend code.

### Authority

Every region declares geometry, appearance, lighting, physics, semantics, interaction and export authorities using D-024 Scene Authority Maps. A splat may be appearance authority while an E57-derived mesh remains geometry/physics authority. Generated content may be appearance authority only in an explicitly generated derivative.

### Rights and policy

Rights are first-class:

- basis: customer-owned, explicit licence, vendor export terms, written permission, public domain or unknown;
- commercial use;
- model training use;
- redistribution;
- terms timestamp/reference and restrictions.

Unknown/restricted/prohibited values prevent automatic global legal approval. That manifest state remains intentionally all-purpose and conservative. For execution, each JobSpec stage declares non-empty `rightsPurposes`, and `validateFoundryJobRights(job, manifest)` fails closed against every exact stage input; it can distinguish internal use, model training, redistribution and public release without turning prose into permission. A licence-policy capability and the resulting decision belong in every worker image/checkpoint record.

## Job model

FoundryJobSpecV0 is the portable control-plane contract. It records:

- project and exact ingest-manifest digest;
- plan-only or execute intent;
- provider kind and adapter ID;
- stage DAG;
- stage-specific `rightsPurposes` bound to each stage's exact input assets;
- digest-pinned container image and argv array;
- input asset IDs and named outputs;
- CPU/RAM/GPU/VRAM/scratch;
- network policy;
- checkpoint/resume policy;
- read-only source mount and output prefix;
- estimate, budget cap and kill switch;
- nullable `computeApprovalId`; plans carry null, while remote execute references a trusted control-plane approval registry entry.

The command is an argv array, never a concatenated shell string. Every execute request requires two trusted short-lived capabilities: a `FoundryExecutionConfirmation` bound to the exact canonical job subject/job ID, and a `FoundryRightsApproval` bound to that job subject, the reviewed ingest-manifest digest and a policy version. The dispatcher rejects booleans, inline/untrusted records, mismatches, predating/future decisions and expiry, then calls `consumeExecutionConfirmation` only after all checks; false/throw denies. The future durable control plane must back that callback with an atomic consume before starting work. Remote execution additionally requires a nonexpired trusted-registry compute approval whose ID, exact job subject, job, project, provider, adapter and maximum cost match. A plan-only job carries no compute-approval reference and is never dispatchable.

### Executor ports

Each adapter translates the same validated JobSpec:

| Adapter | Role |
|---|---|
| local CPU | inspection, hashing, metadata, small geometry/QA |
| local CUDA | bounded inference and explicitly supported non-training validation; splat training remains unsupported locally under D-016 |
| Windows native | only approved licensed tools that cannot run in OCI |
| local OCI/Linux CUDA | reproducible default workers |
| RunPod | current canonical GPU provider adapter after approval |
| AWS/Azure/GCP | optional enterprise adapters |
| Kubernetes/Argo | self-hosted cluster execution |
| SkyPilot | optional multi-cloud provisioning/execution |

Provider adapters return a parsed `FoundryProviderPlan`, not an opaque scheduling response. `validateFoundryProviderPlan` requires the exact provider/adapter, the domain-separated canonical JobSpec digest, complete one-for-one stage-set parity and an estimate within the JobSpec budget cap. Adapters do not alter the JobSpec or master scene.

## Durable state and idempotency

Project state machine:

    created -> inspecting -> inventory_review
           -> planning -> awaiting_approval
           -> running <-> paused/retrying
           -> qa_review -> package_ready
           -> handed_to_release_foundry

Blocked, cancelled and failed are terminal for an attempt, not for a project. A new attempt references prior checkpoints and the unchanged JobSpec digest.

Each stage:

- derives an idempotency key from job digest, stage ID and input digests;
- writes only to a temporary attempt prefix;
- checkpoints to content-addressed outputs;
- verifies declared output hashes/schema;
- commits an immutable artifact registration atomically;
- leaves failed partials quarantined and garbage-collectable.

Resuming never creates a new logical run silently. Cancellation reaches the provider and worker; the kill switch is independent of the UI connection.

## Object storage abstraction

Use an S3-compatible artifact port with:

- digest-addressed immutable objects;
- temporary upload + checksum + atomic registration;
- multipart resume;
- server-side encryption and scoped credentials;
- configurable local filesystem implementation;
- signed access URLs only at the review/publish boundary;
- lifecycle policies that never delete registered source/master artifacts.

Avoid embedding R2, S3, Azure Blob or GCS keys in algorithms. Storage profiles are control-plane references.

## Security model

Threats include malicious media, archive bombs, path traversal, hostile model files, worker supply-chain compromise, credential leakage, arbitrary command execution and a compromised renderer.

Controls:

- signature-first parsers and bounded metadata reads;
- path canonicalization, archive-entry limits and decompression quotas;
- untrusted decoders in restricted workers;
- read-only raw mounts and separate scratch/output mounts;
- no host Docker socket inside workers;
- digest-pinned images with SBOM, signature and vulnerability policy;
- model/checkpoint hashes plus safe serialization formats where possible;
- secrets by short-lived reference, never JobSpec/log;
- outbound network denied unless a stage declares the minimum target;
- renderer isolated from credentials/files/processes;
- audit log for plan, approval, dispatch, cancellation, review and release handoff.

## Cross-platform constraints

- Windows: native paths are normalized only at the shell/daemon edge; manifests remain POSIX-relative.
- macOS: notarization, sandbox bookmarks and Metal/WebView behavior need a dedicated spike.
- Linux: package system/OpenGL/WebGPU variations need tested distributions.
- CUDA workers should prefer Linux OCI even when the UI runs on Windows; WSL/sidecar behavior must be visible to the operator.
- Any licensed Windows-native tool is a declared nonportable adapter and cannot be required for prospective independence.

## Observability

Events include job/stage IDs, artifact IDs, progress units, resource usage, checkpoint, retry, cost accrued and structured error code. Logs redact roots, signed URLs, credentials, device serials and personal data. Operator errors contain a safe next action; expert logs retain native stderr as a restricted artifact.

Metrics:

- ingest throughput and hash backlog;
- stage queue/start/run/checkpoint/retry/cancel latency;
- estimated vs actual cost;
- cache hit and recomputation;
- CPU/GPU/RAM/VRAM/scratch peaks;
- artifact verification failure;
- per-quality-gate status and reviewer cycle time.

Camera/path observability records versioned camera IDs/models, source resolution/crop/exposure, keyframes, path segment IDs, loop/room-graph connectivity, coverage gaps, path discontinuities and temporal artifacts. Navigation connectivity is evaluated against the reviewed nav/collision authority rather than inferred from appearance.

## Versioning and evolution

- Schemas are immutable by version; migrations produce a new manifest with provenance.
- Worker capabilities declare accepted/emitted schema versions.
- Format adapters pin format/library versions and coordinate conventions.
- Release-candidate formats remain feature flagged.
- Existing ArtifactManifest, TransformArtifact, Scene Authority Map and release contracts are referenced, not duplicated or widened silently.
- D-019's VSIR activation gate remains intact; these Foundry contracts do not claim a completed training-derived VSIR.

## Failure and rollback

| Failure | Behavior |
|---|---|
| corrupt source | quarantine asset record; leave source untouched; show reacquire action |
| lost UI/daemon restart | resume from durable event/checkpoint state |
| worker crash/preemption | retry from last verified checkpoint within policy |
| cost approaches cap | stop scheduling, checkpoint, request approval |
| invalid output/schema/hash | quarantine attempt; never register as canonical |
| failed QA | retain candidate privately; prescribe recapture/rebuild |
| bad release | existing Reconstruction Foundry channel rollback, not Foundry source mutation |
| schema migration failure | retain old immutable manifest and abort migration |

## Initial deployment

Phase 1 is local-only for contracts, read-only inspection, planning, deterministic fixtures and non-training validation: shared TypeScript contracts, SQLite or repo-consistent local project registry, filesystem artifact store, subprocess/OCI planner and manual review UI. Any actual splat-training smoke remains an explicitly approved RunPod action under D-016. Phase 2 adds durable orchestration and one approved remote adapter; Phase 3 adds cluster/provider breadth.

## Architecture acceptance gates

1. Reconcile the existing T-486 workstream and prove there is one publish boundary.
2. Validate 50–100 GB ingest/resume without copying or mutating sources.
3. Execute the same frozen fixture locally and on one approved remote adapter with identical declared artifacts.
4. Kill/restart/cancel each stage and reconcile checkpoints, costs and logs.
5. Prove renderer, daemon, updater and sidecar parity on Windows/macOS/Linux.
6. Trace one captured region and one generated region through source, transform, worker, package and review.
7. Demonstrate that a provider and a runtime format can each be replaced without rewriting the canonical manifest.
