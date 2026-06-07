# Artifact Freshness Policy

Status: Active planning doctrine  
Date: 2026-06-07  
Source: VAR-001, VCL-001, DSC-001  
Depends on: T-192, T-269, T-283, T-285  
Relates to: Artifact Registry, ArtifactManifestV0, Venue Claim Lifecycle, Data Sufficiency Contract, Truth Mode

## Purpose

Artifact freshness is the policy for deciding whether a Venviewer artifact can
still be used for its declared purpose. It is not a visual quality score and it
is not a public claim. Freshness answers a narrower question: "given what this
artifact says it is for, are its source inputs, assumptions, compatibility, and
review state still acceptable?"

The v0 manifest field is `freshnessState` in `ArtifactManifestV0Schema`.

## States

| State | Meaning | Display posture |
|---|---|---|
| `current` | Source inputs, policy assumptions, runtime compatibility, and required review are still valid for the artifact purpose. | Usable for the declared purpose. |
| `partial` | Some required inputs are present and useful, but the artifact is incomplete for the full declared purpose. | Show as partial; do not collapse to pass/fail. |
| `stale` | A source input, assumption, policy, capture, runtime target, or claim state has changed since creation. | Keep visible for history, but require regeneration or review before current use. |
| `superseded` | A newer artifact intentionally replaces this one for the same subject and purpose. | Keep for audit trail; prefer the newer artifact. |
| `expired` | A time-bound artifact passed its expiry, review window, access window, or validity window. | Do not use except for audit/history. |
| `not_checked` | The artifact exists but freshness has not been evaluated. | Treat as unknown and do not promote. |
| `degraded_evidence` | Inputs are available but weaker than required for the purpose: missing calibration, low confidence, incomplete capture, weak toolchain status, or incompatible runtime target. | Allow internal inspection; require caveat and review. |
| `requires_human_review` | Machine checks cannot settle the freshness question for the purpose. | Queue or request review; do not silently promote. |
| `unsupported_request` | The artifact cannot answer the requested purpose with available data or supported methods. | Stop the request and explain the unsupported gap. |

## Default Rule

If freshness is missing, ambiguous, or not evaluated, treat it as `not_checked`.
No artifact should become more exposed or more authoritative because a freshness
field is absent.

## Trigger Matrix

| Trigger | Freshness impact |
|---|---|
| Source capture changes, is replaced, or receives a better alignment transform. | `stale` for artifacts derived from the old capture or transform. |
| Layout snapshot changes after an evidence pack or replay was produced. | `stale` for layout-specific artifacts. |
| Venue policy bundle, assumption ledger, Scotland policy bundle, or validator rules change. | `stale` for policy-dependent artifacts. |
| Required data is missing for the requested purpose. | `unsupported_request` or `degraded_evidence`, depending on whether partial use remains meaningful. |
| Runtime target changes: Spark/Three version, supported format, mobile fallback, or feature flag requirement. | `stale` or `degraded_evidence` for runtime artifacts until compatibility is rechecked. |
| A newer artifact is selected as replacement for the same subject/purpose. | Old artifact becomes `superseded`; new artifact starts at `not_checked` or stronger after checks. |
| Time-bound access, review, or validity window passes. | `expired`. |
| A human/professional review is required and has not happened. | `requires_human_review`. |
| Toolchain license or redistribution posture changes. | `degraded_evidence`, `requires_human_review`, or `unsupported_request` depending on exposure tier and purpose. |
| Public claim lifecycle state becomes contested, stale, expired, withdrawn, or superseded. | Public/report artifacts associated with that claim become `stale` or `requires_human_review`. |

## Transition Rules

- `not_checked` can move to any state after evaluation.
- `partial` can move to `current` when missing inputs arrive and checks pass.
- `stale` can move to `current` only through regeneration or explicit review.
- `superseded` should not move back to `current`; create or select a new artifact
  instead.
- `expired` should not move back to `current`; extend by issuing a new artifact
  or review record.
- `degraded_evidence` can move to `current` only when the degraded condition is
  resolved or the declared purpose is narrowed.
- `requires_human_review` can move to `current`, `partial`, `degraded_evidence`,
  `unsupported_request`, or `stale` after review.
- `unsupported_request` can move only when the request scope, data inputs, or
  supported methods change.

## Purpose Specificity

Freshness is purpose-specific. The same artifact can be fresh for internal QA and
stale for a client-facing evidence pack. It can be current for visual inspection
and unsupported for compliance-sensitive decisions. The artifact manifest should
therefore pair `freshnessState` with `purpose`, `exposureTier`,
`exportSafety`, and `knownLimitations`.

## Source Input Rules

Every freshness decision should identify which source input caused the state:

- capture session
- asset version
- runtime package
- layout snapshot
- transform artifact
- policy bundle
- validator/witness output
- toolchain or license review
- venue-supplied fact
- human review record
- external file or system

If the cause cannot be identified, set `requires_human_review` rather than
guessing.

## Runtime Compatibility Rules

Runtime compatibility can make an otherwise current artifact stale:

- unsupported format for the target browser path
- missing fallback behavior for the target device class
- renderer/package version drift
- required feature flag not enabled
- asset depends on a toolchain whose runtime use is not cleared
- manifest points to a primary asset that no longer passes URL/storage
  validation

These are freshness issues because the artifact can no longer satisfy its
runtime delivery purpose.

## Relationship To Claims

Artifact freshness does not directly publish or verify a claim. It feeds claim
and copy decisions:

- A stale artifact cannot support strong current wording.
- A `not_checked` artifact cannot support evidence-backed public wording.
- A `requires_human_review` artifact can support review workflows but not final
  customer-facing conclusions.
- A `degraded_evidence` artifact can be useful for internal diagnosis if its
  limitation is visible.
- A `current` artifact supports only the exact purpose and scope declared in its
  manifest.

## Review Record

When freshness changes, record at least:

- artifact ID
- previous state
- next state
- trigger
- source input or policy reference
- actor or service
- timestamp
- short reason
- whether regeneration is required

This can live in a future registry service, audit report, or manifest update.
This doctrine does not implement that storage.

## Non-Goals

- No registry service.
- No database schema.
- No runtime loader changes.
- No public copy changes.
- No automatic stale detection implementation.
- No claim graph implementation.
