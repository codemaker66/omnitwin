# Simulation Job Boundary

Status: Active planning doctrine  
Date: 2026-05-01  
Source: SJB-001  
Depends on: Guest Flow Replay, `.venreplay.zip`, License & IP Compliance Ledger, Operational Geometry Compiler, Flow Zone Authoring Layer  
Relates to: venreplay, Fastify API, JuPedSim, Layout Evidence Pack, Truth Mode, Artifact Registry

## Purpose

The Simulation Job Boundary defines how Venviewer runs Guest Flow Replay simulations without putting Python, C++ native simulation cores, or long-running work inside the Fastify request path.

Guest Flow Replay v0 may use JuPedSim, a Python package with a C++ core. That runtime belongs in an isolated worker/job system. The Fastify API should enqueue jobs, expose status, and read completed replay artifacts. It should not execute simulations synchronously during HTTP requests.

This document is planning doctrine only. It does not implement worker code, queues, APIs, schema, dependencies, simulator integration, or public copy.

## Components

### Fastify Transport Adapter

The Fastify API is the transport boundary.

Responsibilities:

- validate request authorization and venue/layout access
- validate scenario template/instance request shape
- validate required references such as layout snapshot, runtime package, operational geometry hash, assumptions, and policy bundle
- enqueue a simulation job
- return a job/replay status reference
- read completed replay bundle metadata and signed/safe URLs where authorized

Non-responsibilities:

- running JuPedSim/PedPy/Vadere/Recast/Detour inline
- importing Python/native simulation libraries
- blocking request lifecycle on simulation completion
- mutating completed replay artifacts after publication

### Queue Job

The queue job is the durable instruction to run one Scenario Instance.

Required job fields should eventually include:

- `jobId`
- `scenarioTemplateId`
- `scenarioInstanceId`
- `layoutSnapshotHash`
- `runtimePackageHash`
- `operationalGeometryHash`
- `policyBundleRef`
- `assumptionRefs`
- `requestedBy`
- `tenantId`
- `venueId`
- `priority`
- `status`
- `attemptCount`
- `createdAt`
- `startedAt`
- `finishedAt`
- `timeoutAt`
- `errorCode`
- `errorMessageKey`
- `workerVersion`
- `simulatorName`
- `simulatorVersion`

### Python / JuPedSim Worker

The worker owns the simulation runtime.

Responsibilities:

- claim queued jobs
- load pinned simulation environment
- fetch required operational geometry and scenario inputs
- run JuPedSim or another approved simulator
- produce trajectory, metrics, bottleneck, witness, limitation, and log outputs
- write outputs to object storage
- publish replay bundle metadata/status
- record simulator version, worker version, and provenance

The worker may be Python-based and may contain native dependencies. It must not require Fastify process imports or web runtime dependencies.

### Object Storage Output

Simulation outputs should be written to object storage, not returned as large HTTP response bodies from the worker or API.

Expected outputs:

- `.venreplay.zip`
- raw simulator output, internal-only where needed
- logs
- metrics report
- witness JSON
- artifact manifest or metadata

Private venue/customer outputs should follow asset upload/access policy and exposure-tier rules.

### Replay Bundle Row / Metadata

The database or artifact registry should eventually track replay metadata without storing bulky trajectory data inline.

Replay metadata should include:

- `replayBundleId`
- `jobId`
- `scenarioTemplateId`
- `scenarioInstanceId`
- `layoutSnapshotHash`
- `runtimePackageHash`
- `operationalGeometryHash`
- `artifactUri`
- `artifactHash`
- `status`
- `createdAt`
- `createdBy`
- `simulatorName`
- `simulatorVersion`
- `workerVersion`
- `seed`
- `seedCount`
- `limitations`
- `assumptionRefs`
- `provenanceRefs`
- `exposureTier`

## Status States

Initial job/replay status states:

- `queued`
- `running`
- `done`
- `error`

Future implementation may add `cancelled`, `expired`, `stale`, or `superseded`, but v0 should not need them to establish the boundary.

## Retry Policy

Retry policy should distinguish:

- transient infrastructure failure
- simulator crash
- invalid input
- missing data
- timeout
- worker version mismatch
- object storage write failure

Suggested v0 behavior:

- retry transient infrastructure/object-storage failures a small bounded number of times
- do not retry invalid input or unsupported scenario requests without input changes
- record each attempt count, worker version, simulator version, started/finished timestamps, and error message key
- preserve failed job metadata for audit and debugging

Retry behavior must not silently change scenario assumptions or simulator parameters.

## Timeout Policy

Each simulation job should carry an explicit timeout.

Timeout policy should consider:

- scenario type
- expected agent count
- seed count
- simulator backend
- target environment
- maximum acceptable latency for user-facing workflows

Timeouts should produce structured `error` status with a message key, not partial success. If partial artifacts exist, they must be marked incomplete/internal unless explicitly validated.

## Provenance Fields

Simulation outputs should record:

- `jobId`
- `scenarioTemplateId`
- `scenarioInstanceId`
- `layoutSnapshotHash`
- `runtimePackageHash`
- `operationalGeometryHash`
- `policyBundleRef`
- `assumptionRefs`
- `flowZoneRefs`
- `simulatorName`
- `simulatorVersion`
- `workerVersion`
- `workerImageDigest`
- `queueName`
- `seed`
- `seedCount`
- `startedAt`
- `finishedAt`
- `createdBy`
- `inputArtifactRefs`
- `outputArtifactRefs`
- `licenseLedgerRefs`
- `limitations`

## Simulator Version Pinning

Simulator version pinning is mandatory.

Replay evidence must not cite "JuPedSim" generically. It should cite the exact simulator name, version, worker image or environment digest, parameters, seed policy, and relevant license ledger status.

If simulator version changes, replay outputs may become stale or non-comparable unless the scenario is rerun or explicitly marked as cross-version comparison.

## Why This Boundary Exists

### Keeps Node API Responsive

Simulations can be slow, CPU-heavy, memory-heavy, or crash-prone. Fastify should remain responsive for auth, planner API, artifact lookup, and status reads.

### Isolates LGPL / Python / Native Dependency

JuPedSim-like dependencies should be isolated from the Node API process and web runtime. This reduces bundling risk, makes license obligations easier to reason about, and keeps native/Python dependency failures outside the request handler.

### Improves Reproducibility

Durable jobs, pinned simulator versions, explicit seeds, object-storage artifacts, and replay metadata make runs repeatable and inspectable.

### Makes Engine Swap Possible

The Fastify API should enqueue a simulation request against a stable job contract. The worker behind that contract can later change from JuPedSim to another simulator, benchmark path, or internal engine without changing HTTP consumers.

## Non-Goals

- No queue implementation.
- No worker implementation.
- No database schema.
- No JuPedSim/PedPy/Vadere dependencies.
- No Fastify route implementation.
- No object storage integration changes.
- No public copy change.
- No package rename.
