# OmniTwin Foundry offline review package v0

**Schema:** `omnitwin.foundry.offline-review-package.v0`  
**Implementation:** `packages/types/src/omnitwin-foundry-offline-review.ts`

## Purpose

This package is a digest-bound, tamper-evident index for offline evidence
preflight. It lets a reviewer inspect the included exact bytes without creating
an API review, evidence registration, TransformArtifact, signature, publication
or promotion. “Tamper-evident” does not claim that the storage is WORM,
content-addressed, read-only or otherwise physically immutable.

It is intentionally narrower than T-486. An offline package may say that its
evidence files are complete enough to inspect, but public approval is always
`not_ready_offline` and signing is always `not_ready_unsigned`.

## Boundary

The schema contains no:

- release ID or idempotency key;
- approved/rejected decision;
- target exposure;
- registered TransformArtifact or Scene Authority Map reference;
- reviewer identity or review time;
- review digest;
- DSSE envelope, signature, public key or signing payload;
- publication or production-channel instruction.

It is not added to `ReconstructionReviewEvidenceArtifactKind`. Parsing it as a
`TransformArtifactV0`, `ReconstructionReleaseReviewInput`, evidence-registration
input or signing payload must fail.

## Material

The digest-bound material records:

- package/project/venue/room identity;
- creator and UTC creation time;
- fixed mode `offline_unsigned_preflight`;
- fixed authority `none`;
- one subject artifact, either a phase-one bundle or a release manifest;
- a sorted list of digest-bound files with ID, kind, safe relative path, prefixed
  SHA-256, byte length and media type;
- evidence-review readiness;
- non-empty public-approval and signing requirements.

The package SHA-256 is domain-separated over canonical JSON using:

```text
omnitwin.foundry.offline-review-package.v0\n
```

## Evidence-review-ready requirements

A phase-one subject requires at least:

- phase-one bundle;
- ingest manifest;
- identity review;
- source inspection;
- residual report;
- transform proposal;
- fixed-view evidence.

A release-manifest subject requires at least:

- release manifest;
- QA report;
- transform proposal;
- Scene Authority Map draft;
- fixed-view evidence.

The type schema verifies structural completeness and digest identity. The
offline builder must additionally verify every referenced byte hash, parse
known JSON with its existing schema, cross-bind the copied bundle, index,
inspection, audit, intake and release epochs, prove the exact included file
tree, and reject case-insensitive path collisions. `evidenceReview.status =
ready` is permitted only when the included bytes are sufficient to reproduce
the intended human evidence review; structural completeness alone is not
enough.

## Grand Hall posture

The current Grand Hall package is structurally complete and its included bytes
are tamper-evident, but it cannot reproduce the intended identity and release
review. The 30 original cubefaces, five six-face sheets, known-reference sheet,
and identity-gate evidence JSON are absent; rights for the restricted pixels
also remain unresolved. The exact prepared-epoch source manifest is included
and byte-bound to the release manifest, but it does not cure the identity and
rights gap. The package must therefore state:

```json
{
  "evidenceReview": {
    "status": "blocked",
    "blockers": [
      "Complete identity re-review pixels and identity-gate evidence are withheld pending rights clearance"
    ]
  },
  "publicApproval": {
    "status": "not_ready_offline",
    "requirements": [
      "Independent surveyed control and frozen external validation",
      "Release-load-bearing reviewed TransformArtifactV0",
      "Complete SceneAuthorityMapV0",
      "Authenticated identity and node-scope review",
      "Resolved Matterport and reference-image rights",
      "Exact online T-486 validation"
    ]
  },
  "signing": {
    "status": "not_ready_unsigned",
    "requirements": [
      "Persist an evidence-complete public approval",
      "Obtain the exact server-issued signing payload"
    ]
  }
}
```

No placeholder may be shaped like a valid online T-486 input. Missing online
artifacts are listed in the blocker report as withheld, not fabricated.
