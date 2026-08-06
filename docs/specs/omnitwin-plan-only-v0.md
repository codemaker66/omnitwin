# OmniTwin deterministic plan-only routing v0

**Schema IDs:**

- `omnitwin.foundry.plan-only-request.v0`
- `omnitwin.foundry.plan-only-dossier.v0`

**Runtime validator and compiler:**
`packages/reconstruction-foundry/src/plan-only.ts`

**Referenced execution contract:**
`packages/types/src/omnitwin-foundry.ts`

## Purpose

This contract deterministically evaluates one explicit Foundry stage recipe
against an exact `FoundryIngestManifestV0` and a declared set of local and/or
remote route capacities. It emits auditable routing candidates expressed as
non-dispatchable `FoundryJobSpecV0` plans.

The compiler does not select or launch a provider. It has no provider SDK,
credential lookup, network client, object-store mutation, process spawn,
executor, approval ledger, or billing mutation. A viable candidate means only
that the supplied evidence did not produce a planning blocker. It is not an
execution, training, rights, compute, or spending authorization.

## Plan request

`FoundryPlanOnlyRequestV0` binds:

- a stable plan and project ID;
- the exact domain-separated digest of the supplied ingest manifest;
- an explicit creation time;
- one named recipe containing 1 to 1,000 strict `FoundryJobStage` records; and
- at least one local or remote route.

The recipe uses the existing JobSpec stage contract. Each stage therefore has
explicit dependencies, a digest-pinned OCI image, argv command, input asset
IDs, named outputs, rights purposes, resource requirements, network policy,
and checkpoint/resume declaration. Recipe validation constructs a strict
JobSpec and rejects invalid references, mutable images, and dependency cycles.

A request accepts at most two local routes and twenty remote routes. A route is
unique by provider kind plus adapter ID. Local providers are `local_cpu` and
`local_cuda`. Remote providers are `runpod`, `aws`, `azure`, `gcp`,
`self_hosted_cluster`, and `other`.

Every route declares available CPU cores, RAM, GPU count, per-GPU VRAM,
scratch storage, and maximum input bytes. A remote route additionally declares
an opaque object-storage profile name and one USD estimate snapshot containing:

- observation and expiry times;
- a non-empty source reference;
- compute, storage, egress, image/model-pull, retry-allowance, and safety-margin
  amounts; and
- an explicit budget cap.

The profile name is data in a plan. The compiler does not resolve it, contact
object storage, or validate credentials.

## Deterministic route evaluation

`compileFoundryPlanOnlyDossier` first validates the request and manifest, then
requires the request's manifest digest to equal
`computeFoundryIngestManifestSha256(manifest)`. It validates the recipe as an
acyclic JobSpec graph and evaluates routes in sorted provider/adapter order.

For every route, the compiler:

1. counts each unique referenced input asset once and reports missing asset
   IDs;
2. compares each stage's CPU, RAM, GPU count, GPU VRAM, and scratch request
   with route capacity;
3. compares total input bytes with the route limit;
4. blocks GPU stages on `local_cpu`;
5. applies D-016 by blocking any local route whose recipe declares the
   `model_training` rights purpose;
6. runs purpose-aware `validateFoundryJobRights` against the exact manifest;
7. for remote routes, requires the estimate to have been observed no later
   than the request creation time and to expire after that time; and
8. sums the six estimate components, rounded to six decimal places, and blocks
   an estimate above its budget cap.

Blockers are unique and sorted. A candidate is `viable_plan_only` only with no
blockers; otherwise it is `blocked_plan_only`. A structurally valid JobSpec and
its exact digest may still be present on a blocked candidate so the blocked
plan remains inspectable. A JobSpec is absent only when strict JobSpec
construction itself fails.

The compiler does not automatically choose a winner, reserve capacity, upload
inputs, request approval, or dispatch work.

## Emitted JobSpec invariants

Every emitted candidate JobSpec has:

- `executionIntent: plan_only`;
- `computeApprovalId: null`;
- `sourceMountMode: read_only`;
- `killSwitchEnabled: true`;
- the exact reviewed manifest digest;
- the request's unchanged strict stage recipe;
- a deterministic plan output prefix; and
- a canonical `jobSpecSha256` recomputed by schema validation.

Local candidates have zero estimated cost, a zero budget cap, and no object
storage profile. Remote candidates carry only the supplied opaque profile and
the validated estimate/cap values.

RunPod is therefore represented only as a route plan. A RunPod candidate,
including one whose recipe has a model-training purpose, can be marked viable
for planning after rights, capacity, estimate, and budget checks pass, but it
cannot create a pod, upload an object, start training, consume money, or become
an executable JobSpec. Turning such a plan into execution requires a separate
contract and trusted approval/confirmation path that this compiler does not
implement or invoke.

## Dossier identity and capabilities

The dossier contains the exact request, its digest, the exact manifest digest,
and all sorted route candidates. It cross-checks that each candidate JobSpec
binds the same manifest and that every embedded JobSpec digest is exact.

`requestSha256` and `dossierSha256` are prefixed SHA-256 values over
domain-separated canonical JSON using, respectively:

```text
VENVIEWER_FOUNDRY_PLAN_ONLY_REQUEST_V0
VENVIEWER_FOUNDRY_PLAN_ONLY_DOSSIER_V0
```

The dossier has literal authority `none`. Its capabilities are fixed to:

| Capability | State |
|---|---|
| job planning | `completed_plan_only` |
| execution | `not_authorized` |
| model training | `not_authorized` |
| object-storage mutation | `not_authorized` |
| signing | `not_authorized` |
| publication | `not_authorized` |
| promotion | `not_authorized` |

Cloud planning does not imply cloud execution. In particular, a RunPod plan is
not a provider request, compute approval, execution confirmation, durable
attempt record, cost watchdog, kill-switch implementation, training result,
signature, or release instruction.

## Security and authority boundary

- All route inputs are caller-supplied declarative data and remain subject to
  independent trust and freshness policy.
- Purpose-aware rights checks can block a plan; a passing check does not create
  a rights approval capability.
- Cost estimates and caps are planning evidence only; they do not authorize
  spending or enforce an accrued-cost stop.
- `killSwitchEnabled: true` is a required JobSpec declaration, not a running
  kill-switch service.
- No candidate can be dispatched because `plan_only` is enforced both during
  construction and dossier validation.
- The dossier authorizes no execution, model training, cloud or object-store
  mutation, signing, publication, or promotion.
