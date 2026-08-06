# OmniTwin Foundry derivative activation 0058-A draft — NO-GO report

Date: 2026-07-14  
Migration: `packages/api/drizzle/0058_foundry_derivative_activation_disabled.sql`  
Bytes: `262,281`  
Physical lines: `5,789`  
SHA-256: `1655b8ff5022377f28f7ef1f73aa5ca0e75e0ddc14218339b341b81a33c5506e`

## Status

**DISABLED / NO-GO.** This file is a bounded implementation draft, not an
activation migration ready for reliance. Migration 0059 is absent and remains
prohibited. No application, provider, IAM, object-store, credential, signing,
publication, promotion or production-database action was performed.

## What was verified

The exact migration hash above replayed cleanly through the complete journaled
0000–0058 chain on a disposable, networkless PostgreSQL 16.14 instance using
the pinned `linux/amd64` image
`postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`.
Each migration applied in its own transaction. The only activation epoch was
exactly generation `1`, variant `disabled_sentinel`, enabled `false`.

Migration 0058 uses the second-amended safe-relative output-prefix rule: no
leading/trailing slash, unchanged 0053 path predicate, job prefix equal to the
reservation prefix, and object key formed as
`output_prefix || "/normalized.glb"`.

Predecessor SHA-256 values remained byte-identical:

| Migration | SHA-256 |
| --- | --- |
| 0053 | `6950a3a230dd0d2181f33296dac3bb5ff42ebbe070e5bdcd4d651f8c737ffa34` |
| 0054 | `05e80543a52978c9b01ab277257ca7eed7bd8a2f37dbedfdeee06fa1c730bdb4` |
| 0055 | `47602cf4ef2973a5e8588759519ca6cef3c7d7dd2f52c463ceea3eb4667db2e7` |
| 0056 | `3075ba5895283dd6a15407e4aa3edb44073fe7125a69a541d125579efef7a78d` |
| 0057 | `10fc023060ecd1228421243272d584dcb1b2bd8bd277622d9f66c5cc27ba1c6e` |

The journal parses as JSON and ends at index `56`, tag
`0058_foundry_derivative_activation_disabled`. `git diff --check` passed for
the draft and journal.

## Terminal findings and independent classification

The implementation author treated the two trust-boundary gaps below as P0.
The final independent frozen-hash reviewer classified them as P1 because the
installed state remains disabled and uncallable. Both classifications produce
the same operational verdict: spec-complete 0058-A and 0059 are NO-GO.

### Author P0 / independent P1 — custody facts are not authenticated

`glb_structure_valid` and related chunk/bounds/alignment conclusions still
derive from caller-constructible read-receipt booleans. The worker manifest is
synthesized or restated without an immutable authenticated runner transcript,
trusted verifier receipt, or exact terminal-outcome binding. Existing scalar
columns can compare these claims but cannot prove their origin.

Closing this requires a separately reviewed trusted runner/verifier receipt
contract and a privileged custody/classification API that derives rather than
accepts those facts.

### Author P0 / independent P1 — the closed callable authority boundary is absent

Direct service-role table DML is revoked, but the required closed
`SECURITY DEFINER` functions for authority mutation, activation/claim,
submit/recovery redemption, containment/watchdog work and custody
classification are not present. Only read-helper execution grants exist. The
positive path is therefore uncallable and cannot establish the trusted-service
identity boundary required by the contract.

### P1 — containment is not source-scoped and reverse-closed

The deferred source-containment closure can require an authority-loss source
against unrelated live derivative attempts. Conversely, containment insertion
does not yet prove that its exact source ID/SHA exists and applies to the named
activation/attempt. Unrelated or spoofed source-to-attempt rows can satisfy the
current closure.

### P1 — custody reuses a dispatch-phase horizon

The custody-current predicate still consumes the activation
`authority_not_after` horizon built from dispatch/pricing boundaries and calls
the fixed 0053 execution-current predicate. That violates the contract's
phase-specific/no-reused-horizon rule and can misclassify legitimate
post-dispatch forensic custody as late. Custody needs its own current-authority
derivation rather than reuse of the submit/dispatch horizon.

### P1 — required implementation evidence is absent

No focused 0058 static/live semantic suite, `pg_policy` plus `pg_attribute`
identifier/truncation coverage, Drizzle schema parity, complete adversarial
matrix, callable-API tests, authenticated-runner/verifier tests, or fresh
independent final audit exists. The pre-existing live candidate verifier still
targets 0057 and was not promoted to 0058 evidence.

## Bounded fixes retained in the draft

The stopped draft does contain useful fail-closed corrections discovered during
implementation: current derivative/base rights at closure time; no fallback
past a revoked latest policy; exact recovery source/grant/redemption/event
bindings; database/event-derived action times; terminal result/reference checks;
all-match public reverse scan; current-authority and containment classification;
and historical broker/custodian action-time treatment. These do not neutralize
the P0/P1 findings above.

## Final independent frozen-hash verdict

Against exact SHA-256
`1655b8ff5022377f28f7ef1f73aa5ca0e75e0ddc14218339b341b81a33c5506e`,
the non-author reviewer reported P0 none; P1 for containment/source closure,
the authenticated verifier/runner plus callable service boundary, and the
reused dispatch horizon in custody; and no SQL-specific P2/P3. The separate
known design-inventory P3 remains: future catalog coverage must include
`pg_policy` and `pg_attribute`.

The reviewer gave GO only for installing the inert generation-1 disabled
sentinel. It gave NO-GO for spec-complete 0058-A and 0059. No edits were made by
the reviewer.

## Next admissible step

Design the minimal authenticated runner/verifier receipt and closed privileged
callable API contracts without weakening direct-DML denial. Independently audit
those contracts before changing this draft. Then repair source-scoped
containment, add Drizzle parity and the full static/live/adversarial matrix, and
re-run an independent final audit against one exact migration hash. Do not
create or enable migration 0059.
