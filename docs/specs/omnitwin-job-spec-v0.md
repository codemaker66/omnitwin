# OmniTwin job specification v0

**Schema ID:** omnitwin.foundry.job-spec.v0

**Runtime validator:** packages/types/src/omnitwin-foundry.ts

## Purpose

FoundryJobSpecV0 is the provider-neutral, auditable plan for a processing DAG. It separates algorithms and business truth from local, RunPod, AWS, Azure, GCP or cluster scheduling.

The specification is declarative. Its presence does not authorize execution.

## Top-level fields

| Field | Rule |
|---|---|
| id / projectId | stable safe keys |
| ingestManifestSha256 | domain-separated canonical digest returned by `computeFoundryIngestManifestSha256` for the reviewed input inventory |
| executionIntent | plan_only or execute |
| providerKind / providerAdapterId | replaceable scheduling choice |
| stages | DAG of digest-pinned workers |
| objectStorageProfile | opaque control-plane profile, never credentials |
| sourceMountMode | always read_only |
| outputPrefix | safe relative location |
| estimatedCostUsd / budgetCapUsd | estimate cannot exceed cap |
| killSwitchEnabled | always true |
| computeApprovalId | null for plans/local execute; trusted-registry reference required for remote execute |

## Stage contract

Each stage declares:

- unique ID and kind: inspect, register, align, geometry, appearance, semantics, enhance, QA or package;
- dependency IDs;
- OCI image by immutable sha256 digest;
- argv command array;
- input asset IDs and named outputs;
- one or more explicit `rightsPurposes`: `commercial_internal_use`, `model_training`, `redistribution` or `public_release`;
- CPU, RAM, GPU count, minimum VRAM and scratch;
- network access: none, object_storage_only or restricted;
- checkpoint mode and resumability.

CPU-only stages request zero GPU VRAM. A resumable stage requires stage-boundary or periodic checkpoints. Dependencies must reference another declared stage and cannot self-reference. Implementations additionally reject cycles during graph compilation.

`validateFoundryJobRights(job, manifest)` first recomputes the reviewed manifest's domain-separated canonical digest and rejects a mismatch with `ingestManifestSha256`. It then evaluates every stage purpose against every declared input asset and fails closed on missing assets, incomplete rights records or a prohibited/unknown required permission. Commercial internal use, model training and public release require `commercialUse: allowed`; model training additionally requires `modelTrainingUse: allowed`; redistribution and public release require `redistribution: allowed`. Global manifest `approved` remains an intentionally stricter all-purpose state and is not a substitute for this stage-specific dispatch check.

## Execution and approval

plan_only:

- may target any provider to estimate capability/cost;
- cannot be dispatched;
- carries no execution approval;
- performs no object-store, compute or billing mutation.

execute on local_cpu/local_cuda:

- requires a trusted, short-lived `FoundryExecutionConfirmation` supplied to the dispatch decision, not embedded in the JobSpec;
- requires a trusted, nonexpired `FoundryRightsApproval` for the exact JobSpec and ingest-manifest digests;
- remains subject to source rights, resource and safety policy;
- carries `computeApprovalId: null` and does not require a paid-provider approval record;
- does not authorize local splat training: accepted D-016 keeps actual splat training on RunPod.

execute on RunPod/AWS/Azure/GCP/cluster/other:

- requires the same trusted `FoundryRightsApproval` and `FoundryExecutionConfirmation` as local execution;
- requires `computeApprovalId` resolving from the control plane's trusted approval registry;
- the registry record binds approval ID, exact canonical JobSpec subject digest, job ID, project ID, provider kind, provider adapter, approver, approval time, expiry and maximum cost;
- the registry record must post-date JobSpec creation, remain live at dispatch and exactly match the job subject;
- budget cap must not exceed the bound approval maximum;
- estimated cost must not exceed the cap;
- a trusted, short-lived `FoundryExecutionConfirmation` is still required at dispatch;
- the independent kill switch must be enabled.

`FoundryExecutionConfirmation` is a fresh, single-use control-plane capability with `confirmationId`, `jobSubjectSha256`, `jobId`, `confirmedBy`, `confirmedAt` and `expiresAt`. Dispatch rejects a missing or untrusted confirmation, a subject/job mismatch, a confirmation predating the JobSpec, a future confirmation or an expired confirmation. Only after every rights/confirmation/remote-approval check passes does it call `consumeExecutionConfirmation(confirmationId)`; `false` or an exception denies dispatch. The supplied callback must implement a truly atomic durable-store consume before work starts. The contract has no executor/store implementation, so production replay protection remains an integration gate. A boolean confirmation flag is never sufficient.

`FoundryRightsApproval` is a trusted purpose-policy decision with `jobSubjectSha256`, `ingestManifestSha256`, `policyVersion`, literal `decision: allowed`, `decidedBy`, `decidedAt` and `expiresAt`. Every execute dispatch fails closed if this record is absent, untrusted, mismatched, predates the JobSpec, is future-dated or has expired. The rights approval is separate from the operator confirmation and, for remote work, the compute approval.

Inline/untrusted approval or confirmation JSON is never sufficient. An expired capability cannot be extended implicitly. Any change to a subject-bound JobSpec field changes the canonical subject digest and requires a new plan, confirmation and, for remote execution, approval.

## Provider adapter interface

Adapters translate the same validated contract into an execution plan. They may add ephemeral provider references but cannot:

- change stages, images, argv, inputs or declared outputs;
- inject provider IDs into canonical scene/package state;
- widen network/source-write access;
- exceed the budget cap;
- turn plan_only into execute.

A provider response must parse as `FoundryProviderPlan`: exact `providerKind`, `providerAdapterId`, `jobSpecSha256`, nonnegative `estimatedCostUsd`, and one unique `{stageId, executionReference}` entry per stage. `computeFoundryJobSpecSha256` uses domain-separated canonical JobSpec JSON. `validateFoundryProviderPlan(job, plan)` rejects provider/adapter or digest mismatch, any missing/extra stage, duplicate stage entries, and an estimate above the JobSpec budget cap. A syntactically valid provider response is therefore not sufficient by itself.

Required adapters over the programme:

| Adapter | Use |
|---|---|
| local_cpu | inspection, hashes, light geometry/QA |
| local_cuda | bounded inference/non-training validation; no splat training under D-016 |
| local_oci / linux_cuda | reproducible worker default |
| windows_native | approved licensed nonportable tools only |
| runpod | first remote GPU provider |
| aws / azure / gcp | enterprise alternatives |
| self_hosted_cluster | Kubernetes/Argo or scheduler |
| skypilot | optional multi-provider executor |

## Cost model

The estimate includes:

- compute by resource/time and retry assumption;
- persistent/ephemeral storage;
- upload/download/egress;
- image/model pulls;
- safety margin;
- currency/rate timestamp in the provider plan.

The control plane records estimate, approved maximum and actual accrued cost. At a configurable warning percentage it checkpoints and warns; at cap it stops scheduling and requests a new approval. A disconnected UI does not disable the cap.

## Checkpoint and artifact protocol

1. Read inputs only by declared digest.
2. Write to attempt-scoped scratch/output.
3. Periodically checkpoint with stage/job/input digest metadata.
4. On success, validate output schema and full hashes.
5. Atomically register immutable output artifacts.
6. Quarantine partial/invalid attempts.
7. Resume only when worker and checkpoint compatibility are declared.

Retries use deterministic seeds where applicable and retain attempt history. A resume is not a new logical run with an unrelated timestamp ID.

## Security

- commands are argv arrays, not shell strings;
- images are digest-pinned, signed/SBOM-scanned by deployment policy;
- raw mounts are read-only and scratch/output are separate;
- secrets are short-lived references resolved by the executor;
- network is denied by default;
- logs redact roots, credentials, signed URLs, device identifiers and personal data;
- untrusted decoders run with CPU/RAM/file/count/time quotas;
- workers cannot access the host Docker socket or publisher credentials.

## Example plan

    {
      "schemaVersion": "omnitwin.foundry.job-spec.v0",
      "id": "grand-hall-inspection-plan",
      "projectId": "grand-hall-pilot",
      "ingestManifestSha256": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "executionIntent": "plan_only",
      "providerKind": "runpod",
      "providerAdapterId": "runpod-v0",
      "stages": [{
        "id": "inspect",
        "kind": "inspect",
        "dependsOn": [],
        "containerImage": "registry.example/foundry-inspect@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "command": ["foundry", "inspect", "--manifest", "manifest.json"],
        "inputAssetIds": ["e57-main"],
        "outputNames": ["inspection-report"],
        "rightsPurposes": ["commercial_internal_use"],
        "cpuCores": 4,
        "ramGiB": 16,
        "gpuCount": 0,
        "minimumGpuVramGiB": 0,
        "scratchGiB": 100,
        "networkAccess": "none",
        "checkpoint": "stage_boundary",
        "resumable": true
      }],
      "objectStorageProfile": null,
      "sourceMountMode": "read_only",
      "outputPrefix": "projects/grand-hall/jobs/grand-hall-inspection-plan",
      "estimatedCostUsd": 5,
      "budgetCapUsd": 10,
      "killSwitchEnabled": true,
      "computeApprovalId": null,
      "createdAt": "2026-07-12T10:00:00.000Z"
    }

This example is valid for planning and intentionally not dispatchable. An executable remote variant is still blocked until the manifest digest matches, `validateFoundryJobRights` passes, and the control plane supplies exact subject-bound `FoundryRightsApproval`, `FoundryExecutionConfirmation` and remote compute approval capabilities.
