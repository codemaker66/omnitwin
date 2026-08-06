# OmniTwin Foundry derivative execution V1 boundary

Status: design contract for the additive V1 registry/candidate slice. It does
not enable an execution, provider call, worker invocation, output release, or
publication.

## Why V1 is additive

The durable execution kernel in migration 0053 accepts an exact, closed
`omnitwin.foundry.execution-subject.v0` object. Admission, prepared provider
requests, commands, claims, invocation events, and authority predicates bind
that exact V0 digest. Derivative-rights fields cannot be added to the V0 JSON
without changing its identity, and side data that is not explicitly propagated
is ignored by the V0 authority path.

The V1 design therefore uses closed, domain-separated sidecar artifacts. The
V0 subject remains the base execution identity; the V1 subject binds its exact
digest and adds the derivative binding set, restriction lineage, registry
attestation, and later single-execution activation identity.

## Authority states

The following states are deliberately different:

1. A 0054 derivative approval is claimant-bound evidence with
   `authority = none`.
2. A 0055 accepted review proves that a platform administrator inspected exact
   custodied bytes. It remains `authority = none` and is only eligible for a
   registry attestation.
3. A V1 authenticated registry attestation establishes trusted registry
   provenance for one exact accepted review. It is not dispatch authority and
   has `executionEligible = false`.
4. A V1 candidate reserves one exact attestation, review, and approval for one
   exact base execution subject. It remains `authority = none`,
   `executionEligible = false`, `dispatchEnabled = false`, and
   `outputDisposition = quarantine_only`.
5. A future activation migration may activate a candidate for one execution.
   That operation must be atomic with execution admission and must not be added
   until all current-authority, egress-redemption, output-custody, containment,
   and release gates are installed together.

Historical evidence remains immutable after expiry or revocation. Current
authority is always recomputed from database time and current registry state;
idempotent replay of a historical row does not make it current again.

## Initial closed operation set

The first derivative candidate is intentionally narrower than the general
Foundry job schema:

- exactly one job stage;
- stage kind `geometry`;
- command exactly
  `["omnitwin-sealed-worker", "normalize_mesh_glb", "v0"]`;
- operation `normalize_mesh_glb/v0`;
- derivative class `lossless_internal_format_normalization`;
- operation class `deterministic_transformation`;
- network access `none`;
- rights purposes exactly `["commercial_internal_use"]`;
- exactly one input asset;
- input type `glb_gltf`, media type `model/gltf-binary`, and `.glb` suffix;
- output policy fixed to quarantine-only with model training,
  redistribution, public release, signing, publication, and promotion denied.

Unknown commands, aliases, versions, extra stages, missing bindings, extra
bindings, and partial asset coverage fail closed.

## Canonical artifacts

Every artifact is strict JSON and is hashed as:

```text
sha256(schemaVersion + "\n" + stableCanonicalJson(material))
```

The registry attestation binds the accepted review receipt, approval digest,
custody receipt, job/manifest subjects, policy generation, stage, operation,
asset, authenticated attestor, database time, and approval expiry.

The restriction-lineage set always carries the exact source `assetIds`, so a
source with zero restrictions is still explicit and cannot disappear. Its
`entries` array is empty only when the approval's ordered restriction list is
empty. Each non-empty entry carries the exact ordered restriction object,
disposition, rationale, and supporting-evidence digest from the 0054 approval.

The binding set binds the exact job, project, envelope, base V0 execution
subject, job and manifest subjects, worker profile, stage, operation, asset,
registry attestation, review receipt, approval digest, custody receipt, and
terms-evidence identity.

The candidate subject binds the binding-set, restriction-set, and output-policy
digests and freezes all live capability flags to false. A separate candidate
reservation receipt records the one-time reservation of the attestation,
review, and approval. It is not a future execution-activation receipt.

## Transaction and lock rules

Registry attestation and candidate creation use database-assigned millisecond
timestamps. They lock the authenticated administrator row and the exact source
rows, acquire derivative-policy serialization before sampling database time,
then re-evaluate current policy generation, approval expiry, policy revocation,
and attestation revocation.

Candidate uniqueness is enforced for the attestation, accepted review,
approval, base V0 subject, and candidate subject. Concurrent reservations use
the unique insert as the arbitration point; there is no check-then-insert
double-spend window. An exact idempotent retry may return only the same stored
material. A different request conflicts.

## Legacy downgrade barrier

Until V1 activation exists, PostgreSQL must reject the known derivative
operation through the V0 execution path. The classifier is derived from the
immutable stored job JSON, not from a caller-supplied boolean. Every legacy
geometry stage is treated as derivative-relevant, even when its command uses an
unknown alias or shell wrapper. The database additionally rejects every job
whose immutable worker binding is registry-classified as
`deterministic_transformation`; application claim and invocation queries repeat
that positive worker-binding check as defence in depth. The barrier blocks new
V0 executions, attempts, prepared submit/checkpoint requests,
submit/checkpoint commands, and pending-to-claimed submit/checkpoint
transitions. A final event guard also denies any new
`provider_invocation_started` submit/checkpoint event, closing the
claimed-before-migration race.

Poll, reconcile, stop, completion, and forensic result custody remain available
for any pre-existing execution so containment cannot be disabled by a rights
failure.

## Conditions for live activation

Do not make a V1 candidate execution-eligible until one activation change
installs all of these boundaries together:

- a V1 sidecar and deferred exact-coverage closure for every newly admitted
  execution;
- atomic candidate activation in the admission transaction;
- current derivative authority at admission, prepare, command creation, claim,
  invocation, checkpoint, result/output commit, and release;
- authenticated executor identity and exact worker/executable eligibility;
- a short-lived, single-use gateway redemption immediately before the first
  provider or local-process side effect;
- dedicated revocation containment that is distinct from operator cancel;
- authenticated output byte custody and immutable restriction lineage;
- quarantine of late results; and
- derivative-aware registration, review, signing, publication, promotion, and
  legacy-release denial.

The production `normalize_mesh_glb` binding remains disabled until those
conditions and their concurrent PostgreSQL tests pass.
