# Layout Proof Object and Layout Evidence Pack

Status: Active planning doctrine  
Date: 2026-05-01  
Source: LPO-DR-2026-05-01  
Depends on: D-009, D-011, D-012, D-014, D-015, D-018, D-019, D-024, Truth Mode Doctrine

## Purpose

A Layout Proof Object is Venviewer's internal architecture term for a content-addressed, replayable evidence package attached to one immutable event layout snapshot. It records what was checked, which policy bundle and scenario assumptions were used, which deterministic validators ran, which witness blocks they produced, and when the evidence becomes stale.

Layout Evidence Pack is the preferred customer-facing v0 term. It communicates practical planning evidence without implying legal, fire, accessibility, or regulator approval.

"Compliance credential" is deferred and qualified language. Venviewer must not use it publicly unless the relevant checks are supported by qualified professionals, formal approvals, or a clearly defined attestation regime. Software-generated checks can support planning decisions, but they are not certification by themselves.

## Core Doctrine

- AI generators are untrusted proposers. Prompt-To-Perfect and future AI layout tools may propose layouts, but they do not make a layout valid.
- The deterministic validator kernel is trusted for the specific checks it implements, under explicit versioned policy and scenario inputs.
- Validators produce witness blocks. A pass/fail/warn label without replayable evidence is not enough for a proof object.
- Proof objects cite policy bundles, rule module versions, scenario assumptions, venue/runtime package references, and validator hashes.
- Evidence attaches to a specific immutable layout snapshot. Editing the layout creates a new snapshot and requires fresh evidence.
- Evidence becomes stale when the layout, venue/runtime package, policy bundle, validator, scenario assumptions, or relevant event metadata changes.
- Public UI must not overclaim legal, fire, accessibility, survey, or regulatory certification. Human/expert review is its own evidence claim, not something implied by software checks.
- Review gates are first-class v0 outputs. When deterministic evidence reaches the boundary of machine-checkable planning evidence, the Layout Evidence Pack must emit `requires_human_review` with structured reason, reviewer role, missing data, blocking state, and message key fields.
- Venue-supplied facts used by evidence packs should come through the Venue Data Request Pack. Missing required venue data must become explicit review-gate output rather than an assumed pass.
- Data sufficiency is a precondition for validator verdicts. Missing data must emit `unsupported_request`, `not_checked`, `degraded_evidence`, or `requires_human_review`; it must not be silently converted into `pass` or `fail`.

## Layered Model

### Layer 0: Canonical Layout Snapshot

The immutable input being checked. It is content-addressed and deterministic so validators, UI, exports, and audits can agree on exactly what was evaluated.

### Layer 1: Policy and Rule Modules

Versioned venue policies, operating rules, jurisdictional references where applicable, heritage constraints, accessibility assumptions, and rule modules. Policy bundles are inputs, not ambient context.

### Layer 2: Deterministic Validator Kernel

Pure or reproducible validators that consume the snapshot and policy bundle. The kernel may include arithmetic checks, spatial clearance checks, forbidden-zone checks, budget checks, route checks, and later formal or simulation-backed checks.

The validator kernel emits machine-readable witness data, not human-written explanation strings. Trusted kernel output may include stable identifiers and structured values only:

- `messageKey`
- `messageArgs`
- `facts`
- `derivation`
- `policyRefs`
- `snapshotRefs`

Human-readable explanations belong outside the trusted kernel. Truth Mode, Evidence Pack UI, PDFs, emails, and exports render explanation copy through a frozen, versioned template catalog using `messageKey` and `messageArgs`.

This separation keeps proof hashes stable. Localization, wording edits, punctuation changes, and product-copy improvements must not change validator output or proof hashes. The kernel must not emit English sentences such as "Aisle is too narrow"; it emits the stable key and structured facts needed for an external renderer to explain the result.

#### Route Validation vs Route Finding Boundary

The deterministic validator kernel must distinguish route validation from route finding.

- **Route validation** checks a route already supplied by the planner, the venue, a template, a policy fixture, or another deterministic system component.
- **Route finding** searches for a path through arbitrary walkable geometry.

For v0, Venviewer may validate:

- a submitted route polyline
- an explicit graph path
- a route over predefined nodes and connectors

V0 route validators may check continuity, in-bounds status, minimum width/clearance, portal or connector validity, start/end correctness, and wheelchair connector permission. They must not claim to discover arbitrary valid routes through raw geometry.

If no submitted route, explicit graph path, or predefined node/connector route exists, a v0 route witness must use `not_checked` or `requires_human_review` rather than `pass`.

Deferred work includes arbitrary route discovery, navmesh search, Recast/Detour route synthesis, OR-Tools or Z3 route optimization, and legal egress route approval.

Unsupported requests are distinct from failed checks. If a planner asks v0 to discover arbitrary valid routes through raw geometry, the witness should use `unsupported_request` rather than `fail`. A `fail` means a supported check ran and found a violation; `unsupported_request` means the requested check is outside the available data or implemented kernel.

### Layer 3: Domain Witness Blocks

Structured outputs for each claim family. Witnesses include verdicts, assumptions, cited rules, input hashes, derived values, artifacts, and replay instructions where possible.

### Layer 4: Layout Proof Object / Layout Evidence Pack

The assembled evidence package for one immutable layout snapshot. Internally this is the Layout Proof Object; in v0 customer-facing UI this is the Layout Evidence Pack.

### Layer 5: Future Attestation Envelope

Future signed and portable envelopes may use DSSE, in-toto, W3C Verifiable Credentials, COSE, or C2PA-style assertions. These are transport and attestation formats, not substitutes for the deterministic witness content.

## Canonical Layout Snapshot Requirements

A canonical layout snapshot must include:

- schema version
- explicit units
- venue reference
- geometry/runtime package reference
- layout object list with stable IDs
- object asset/type references
- object poses and dimensions needed by validators
- event metadata that affects rule applicability
- scenario assumptions
- tolerance policy
- generator provenance if AI-generated
- author/editor metadata where applicable
- deterministic serialization
- content digest

Canonicalization is required for layout digesting. This is separate from DSSE signing semantics. D-019 correctly avoids requiring JCS for DSSE signatures because DSSE signs exact payload bytes; layout snapshots still need a deterministic serialization rule so two equivalent validator runs can compute the same layout digest.

Existing hallkeeper sheet snapshots are an adjacent precedent: `configuration_sheet_snapshots.sourceHash` hashes deterministic extraction input for idempotency. Layout Proof Objects are broader: they cover validator evidence, policy references, staleness, and replayability rather than only the hallkeeper handoff payload.

## Policy Bundle Requirements

A policy bundle should include:

- jurisdiction or venue policy reference
- code or standard edition where applicable
- venue operating rules
- heritage rules
- accessibility assumptions
- effective date range
- policy bundle digest
- rule module version and hash
- scenario class or event type assumptions
- explicit exclusions and human-review requirements
- Venue Data Request Pack field/source references for venue-supplied facts

Policy bundles must be immutable once cited by a proof object. Corrections or updated rules create a new policy bundle version and stale prior evidence where relevant.

## Claim Families

The initial claim families are:

- capacity
- egress
- accessibility
- budget
- heritage
- operational/setup
- supplier/load-in
- venue-specific rules

Additional claim families require explicit vocabulary and witness definitions before they appear in public UI.

## Claim Statuses

Claim status is not a legal certification state. The standard statuses are:

- `pass`
- `warn`
- `fail`
- `not_checked`
- `inapplicable`
- `requires_human_review`
- `stale`

`requires_human_review` must be represented directly. It must not be collapsed into `pass`.

Data sufficiency outcomes supplement claim status where needed:

- `unsupported_request`
- `degraded_evidence`

These outcomes must not be treated as pass/fail. They say the evidence request could not be supported fully by available data, validator scope, or assumptions.

## Review Gates

The Review Gate Engine is part of Layout Evidence Pack v0.

A review gate is a structured output that says a claim, route, object, zone, or operational output needs human or professional review before it can be accepted for a declared purpose.

Review gates may be emitted when:

- required venue data is missing
- a result is near threshold
- a route depends on a historic stair or protected door
- an accessible route is partial
- an event uses a temporary structure
- a layout touches a protected heritage zone
- venue policy requires staff review
- guest flow simulation assumptions are incomplete
- a fire/egress claim would exceed planning-evidence scope

A review gate should include:

- `status`: `requires_human_review`
- `review_reason`
- `required_reviewer_role`
- `required_data`
- `data_sufficiency_outcome` where missing or insufficient data caused the gate
- `blocking`
- `messageKey`
- `messageArgs`

`review_reason` is a stable reason code, not human prose. `blocking` tells whether the evidence can continue as draft/non-blocking planning evidence or whether the current purpose/export/handoff must stop until review occurs.

The detailed doctrine lives in `docs/architecture/review-gate-engine.md`.

## Witness Blocks

Each claim family produces one or more witness blocks. A witness block should include:

- verdict
- `messageKey`
- `messageArgs`
- `facts`
- `derivation`
- `policyRefs`
- `snapshotRefs`
- cited rule or policy IDs where applicable
- assumptions
- inputs by hash or reference
- machine-readable computation summary, not human prose
- derived values
- artifacts if any
- verifier recipe if replayable
- confidence or assurance level
- validator name, version, and hash
- generated timestamp
- staleness inputs
- review gate outputs where applicable

`messageArgs` must contain primitive or structured values, not sentence fragments. `facts` should contain measured or derived facts. `derivation` should describe deterministic operations or validator recipe references. `policyRefs` and `snapshotRefs` must point to versioned inputs. Human explanation strings are rendered later from the template catalog and are not trusted proof content.

Examples:

- capacity witness: object counts, seating assumptions, venue capacity rule reference, derived totals, and margin.
- budget witness: priced line items, pricing policy reference, currency, assumptions, excluded costs, and total.
- heritage witness: forbidden zones, protected fixture references, placed object intersections, and human-review flags.

## Rollout

### v0: Draft Evidence

V0 exists to make planning checks honest and repeatable without claiming legal certification.

- deterministic arithmetic/static checks
- capacity checks
- simple clearance and forbidden-zone checks
- submitted-route validation over explicit polylines, graph paths, or predefined node/connector routes only
- budget checks
- simple operational/setup checks
- unsigned or placeholder-signed witness JSON
- evidence displayed as "planning check" or "Layout Evidence Pack"
- no legal certification claim

### v1: Replayable Evidence

V1 makes evidence durable enough to connect to Truth Mode and operations.

- signed proof object
- stable validator kernel
- route-finding research or navmesh route checks only after the v0 validation boundary is preserved in witness output
- structured policy bundles
- evidence pack UI
- integration with Truth Mode and Event Ops Compiler
- Audit Trail events for proof generation, staleness, and regeneration

### v2: Expert/Formal Evidence

V2 is for high-stakes evidence and external portability.

- expert co-signatures
- DSSE/in-toto envelope
- optional W3C VC, COSE, or C2PA exports
- simulation replay packages
- selective SMT/formal proofs for highest-stakes invariants
- explicit qualified-professional review records where needed

## Staleness and Regeneration

Evidence becomes stale when:

- layout snapshot changes
- venue geometry/runtime package changes
- policy bundle changes
- validator version or hash changes
- scenario assumptions change
- event metadata affecting rule applicability changes
- referenced asset definitions change in a way that affects checks

Stale evidence should remain inspectable, but it must not be presented as current. Truth Mode and the planner should distinguish current, partial, stale, and not-checked evidence.

## Assurance Language Guardrails

Use this language for v0:

- "planning check"
- "Layout Evidence Pack"
- "checked against venue rules"
- "requires human review"
- "draft evidence"
- "stale evidence"

Do not use this language unless the required qualified evidence exists:

- "certified"
- "legally compliant"
- "fire approved"
- "surveyor-grade"
- "regulator approved"
- "guaranteed accessible"
- "approved for occupancy"

Human or expert review must appear as a separate claim/status with reviewer identity, scope, timestamp, and expiry where applicable.

## Integrations

### Truth Mode

Truth Mode should expose whether a layout has no evidence, partial evidence, current evidence, stale evidence, failed checks, or human-review requirements. It should not turn proof objects into a single green badge.

### Event Ops Compiler

The Event Ops Compiler should compile BEO, hallkeeper, supplier, and run-of-show outputs from evidence-backed layout state where possible. If evidence is missing or stale, operations outputs should carry that status.

### Prompt-To-Perfect

AI-generated layouts must be verified by deterministic checks before being presented as valid. AI can propose; validators decide the checked status.

### Audit Trail

Proof object generation, policy bundle selection, witness generation, staleness, regeneration, expert review, and evidence export must be audit events.

### Venue Memory

Past evidence packs are learning examples and precedent records. They are not blanket guarantees that future layouts are valid under different geometry, policies, assumptions, or validators.

## Non-Goals

- No solver or validator implementation in this doctrine.
- No database tables in this doctrine.
- No W3C VC, C2PA, DSSE, or in-toto dependency adoption in v0.
- No public compliance claim changes.
- No replacement for D-019 VSIR, D-024 Scene Authority Map, or Truth Mode.
