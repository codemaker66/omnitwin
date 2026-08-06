# OmniTwin Foundry provider recommendation V0

**Schema IDs:**

- `omnitwin.foundry.provider-recommendation-request.v0`
- `omnitwin.foundry.provider-recommendation.v0`

**Runtime contract:**
`packages/reconstruction-foundry/src/provider-recommendation.ts`

**Required upstream contract:**
`docs/specs/omnitwin-plan-only-v0.md`

## Purpose

Provider recommendation V0 makes one deterministic, auditable planning
recommendation from an exact validated PlanOnly V0 request and dossier plus
explicit route evidence. It returns either exactly one route or no
recommendation. It does not change PlanOnly V0 and cannot turn a plan into an
execution.

The implementation has no provider SDK, credential lookup, network client,
object-store client, process spawn, compute approval, billing mutation,
dispatcher, executor, signer, publisher, or promotion path. All evidence is
caller-supplied declarative input. A recommendation is not proof that the
evidence source is trustworthy and is never an authorization to act.

## Exact PlanOnly subject binding

The recommendation request embeds:

- the complete strict `FoundryPlanOnlyRequestV0`;
- its exact `planOnlyRequestSha256`;
- the complete strict `FoundryPlanOnlyDossierV0`;
- its exact `planOnlyDossierSha256`; and
- zero or one evidence record for each PlanOnly candidate route.

Validation recomputes the PlanOnly request digest, validates the dossier's own
canonical digest, requires the dossier's embedded request to be canonically
identical to the separately embedded request, and requires the request routes
and dossier candidates to form an exact one-to-one set. Every supplied route
evidence record binds the complete corresponding PlanOnly candidate under the
domain:

```text
VENVIEWER_FOUNDRY_PROVIDER_RECOMMENDATION_PLAN_CANDIDATE_V0
```

Digest consistency is necessary but is not accepted as semantic proof of a
candidate. For every route, recommendation validation independently derives
the fields that are recomputable from the exact bound PlanOnly request:

- a local route has cost `0`, budget cap `0`, and no object-storage profile;
- a remote route's cost is the six-decimal-place rounded sum of `computeUsd`,
  `storageUsd`, `egressUsd`, `imageAndModelPullUsd`, `retryAllowanceUsd`, and
  `safetyMarginUsd` from that route's exact estimate breakdown;
- a remote route's budget cap and opaque object-storage profile are copied
  from that exact request route; and
- the expected plan-only JobSpec is reconstructed from the request and route.

The dossier candidate must carry exactly the request-derived cost and budget.
Its JobSpec must be canonically identical to the reconstructed JobSpec, or be
null exactly when that reconstructed JobSpec does not validate. This comparison
therefore covers the candidate route, cost, budget, recipe stage array, request
ID, project ID, ingest-manifest digest, creation time, plan-only intent,
read-only source mount, deterministic output prefix, kill switch, null approval,
and object-storage profile. The existing JobSpec digest check remains required.
A caller cannot substitute one of these fields, recompute the JobSpec,
candidate, dossier, evidence, and outer digests, and have the substituted value
accepted.

Evidence cannot name an absent route, duplicate a route, or silently move
between candidates. A missing route evidence record is allowed only so the
result can record that candidate as explicitly ineligible. The result always
contains exactly one evaluation for every PlanOnly candidate.

## Required evidence snapshots

Each route evidence record carries all of the following fields. No field is
inferred from a machine, environment variable, SDK, historical average, wall
clock, provider page, or another route.

- expected duration in whole seconds;
- privacy assessment against the exact opaque privacy-policy ID and SHA-256;
- queue availability and, only when available, expected wait in whole seconds;
- compatibility assessment for every exact digest-pinned worker image required
  by the recipe;
- estimated cost in integer micro-USD; and
- the operator's non-negative preference rank.

Duration, privacy, queue, software, and cost are evidence windows with an
explicit observation time, exclusive expiry time, and non-empty source
reference. The request's supplied `evaluatedAt` is the only evaluation clock.
That time cannot predate the bound PlanOnly request.
An observation from the future or one whose expiry is not after `evaluatedAt`
is stale and hard-blocks that route.

Local routes have the same evidence requirements as remote routes. In
particular, PlanOnly's structural local cost of zero is not treated as
observed cost evidence. Missing local duration, queue, or cost remains missing
and makes that candidate ineligible.

## Nine explicit decision factors

The original routing category is represented by nine independently auditable
factors because RAM and GPU VRAM are deliberately separate:

1. input size in bytes;
2. required and available RAM in micro-GiB;
3. required and available per-GPU VRAM in micro-GiB;
4. expected duration in seconds;
5. privacy compatibility against the exact policy digest;
6. fresh queue availability and expected wait in seconds;
7. exact required worker-image compatibility;
8. estimated cost in micro-USD; and
9. operator preference rank.

The result preserves all nine factors for every candidate, including missing,
stale, unknown, incompatible, and conflicting states. It separately preserves
the complete PlanOnly blocker list and the rights-prefixed subset so that a
recommendation cannot hide upstream capacity, budget, rights, recipe, image,
or D-016 failures.

## Fixed-point comparison

Recommendation comparison never compares floating-point values. Existing
PlanOnly RAM and VRAM numbers, plus the request-derived route cost, are
converted from their canonical decimal representation into exact integers at
six decimal places. A value that cannot be represented exactly at that scale
is a hard blocker. Input bytes, duration, queue wait, micro-USD, micro-GiB, and
preference ranks are safe integers. Cost evidence is already an integer
micro-USD value and cannot carry a fractional micro-USD.

This V0 scale means:

```text
1 GiB = 1,000,000 micro-GiB
1 USD = 1,000,000 micro-USD
```

The units are comparison and audit units. Micro-GiB does not mean MiB.

## Hard eligibility gates

A candidate is ineligible before preference or soft comparison when any of
these conditions applies:

- the upstream PlanOnly candidate is blocked, including any rights blocker;
- input bytes exceed the route's exact maximum;
- RAM or GPU VRAM exceeds capacity or is not exactly representable;
- route evidence is absent or binds a different candidate;
- any required evidence snapshot is absent, expired, or observed in the
  future;
- privacy evidence binds another policy or is not compatible;
- the queue is unavailable or unknown;
- software evidence does not assess the exact recipe image set or any image is
  incompatible or unknown;
- the request-derived route cost is not exactly representable in micro-USD; or
- cost evidence conflicts with that exact request-derived route cost.

CPU cores, GPU count, scratch capacity, PlanOnly estimate freshness and budget,
local-model-training policy, JobSpec structure, and purpose-aware rights remain
enforced by the upstream PlanOnly candidate gate even though they are not soft
ranking factors. Operator preference is evaluated only after every hard gate
passes and therefore cannot override them.

## Deterministic soft comparison and ties

The request supplies an exact permutation of:

```text
estimated_cost
expected_duration
queue_wait
operator_preference
```

Eligible routes are compared lexicographically in that declared order, using
only their non-negative integer values; lower is preferred. Route identity,
provider name, adapter name, request order, object order, and candidate order
are never implicit tie-breakers.

If one candidate has the unique best tuple, the result recommends that exact
candidate. If no candidate is eligible, the result says
`no_eligible_candidates`. If two or more best candidates have identical tuples,
the result says `exact_tie` and records the sorted candidate-binding digests.
It does not manufacture a lexicographic winner.

## Canonical identity and semantic validation

The request and recommendation payload use domain-separated canonical JSON
SHA-256:

```text
VENVIEWER_FOUNDRY_PROVIDER_RECOMMENDATION_REQUEST_V0
VENVIEWER_FOUNDRY_PROVIDER_RECOMMENDATION_V0
```

The public recommendation schema does more than check its outer digest. It
recomputes every candidate evaluation and the decision from the embedded exact
request and rejects a re-digested but semantically substituted result. This
includes substituted output factors, eligibility blockers, comparison values,
tie digests, and the decision itself.

All schemas are closed. Unknown keys, duplicate or unsorted route evidence,
duplicate software assessments, invalid evidence windows, partial queue states,
non-permutation comparison priorities, and tampered PlanOnly subjects fail
validation.

## Authority boundary

Every recommendation has literal `authority: "none"` and fixed capabilities:

| Capability | State |
|---|---:|
| recommendation only | `true` |
| execution authorized | `false` |
| dispatch enabled | `false` |
| provider invocation permitted | `false` |
| network access permitted | `false` |
| object-storage mutation permitted | `false` |
| spend authorized | `false` |
| signing permitted | `false` |
| publication permitted | `false` |
| promotion permitted | `false` |

The record is unsigned. It creates no queue reservation, availability hold,
price lock, privacy approval, rights approval, image attestation, compute
approval, execution confirmation, attempt, provider command, cost watchdog,
output custody, release instruction, or runtime registration.

## Residual limitations

- Evidence provenance is an opaque source reference and self-declared time
  window; V0 does not authenticate the observer or prove chronology.
- Privacy compatibility evaluates a bound policy digest but does not embed or
  independently interpret the policy document.
- Queue, duration, image compatibility, and cost can change immediately after
  evaluation; V0 reserves nothing.
- Cost must equal PlanOnly's planning estimate. V0 does not measure accrued
  cost or predict provider billing behavior.
- Input-byte totals and rights decisions require the ingest manifest, which is
  digest-bound but not embedded in this recommendation request. V0 preserves
  those manifest-dependent values and blockers from the exact dossier; it does
  not claim to independently recompile them. Request-derived route economics
  and JobSpec fields are independently cross-checked as specified above.
- The preference order and ranks are operator declarations, not a learned or
  globally optimal scheduling policy.
- No recommendation may be consumed as execution authority. A separately
  reviewed activation, workload-identity, credential, durable-attempt,
  containment, custody, and live-authority design is still required.
