# Scotland Policy Bundle

Status: Active planning doctrine  
Date: 2026-05-01  
Source: SCOTLAND-PB-001  
Depends on: Layout Proof Object, Canonical Layout Snapshot v0, Assumption Ledger, Purpose-Fit Evidence
Relates to: Review Gate Engine

## Purpose

The Scotland Policy Bundle is Venviewer's planning doctrine for venue/layout checks that are scoped to Scotland-based deployments such as Trades Hall Glasgow.

This document does not encode statutory compliance, fire approval, accessibility approval, or legal egress certification. It defines the v0 boundary for draft planning-policy checks so Layout Evidence Packs cannot imply more than the deterministic validator kernel actually proves.

The Scotland Policy Bundle depends on venue-supplied facts from the Venue Data Request Pack. Licensing notes, capacity limits, protected surfaces, door widths, fire-management notes, accessibility facilities, and load-in rules must not be inferred from scans or public brochures alone. If required pack fields are missing, the policy bundle should trigger the Review Gate Engine instead of allowing a claim to pass silently.

The bundle also follows the Data Sufficiency Contract. Missing data or unsupported v0 requests must produce `unsupported_request`, `not_checked`, `degraded_evidence`, or `requires_human_review`; they must not be silently converted into `pass` or `fail`.

## Review Gate Engine

The Scotland Policy Bundle uses the Review Gate Engine to keep draft planning evidence separate from legal, fire, accessibility, heritage, and venue-operational judgment.

Review gates should trigger when:

- required venue data is missing
- required Venue Data Request Pack fields are unanswered for the target claim
- result is near threshold
- route depends on a historic stair or protected door
- accessible route is partial
- event uses a temporary structure
- layout touches a protected heritage zone
- layout or event includes a high-risk activity
- venue policy requires staff review
- guest flow simulation assumptions are incomplete
- fire/egress claim would exceed planning-evidence scope

Review gate outputs should include:

- `status`: `requires_human_review`
- `review_reason`
- `required_reviewer_role`
- `required_data`
- `blocking`
- `messageKey`
- `messageArgs`

Blocking gates prevent the affected claim from being presented as current/accepted for the target purpose or exposure tier. Non-blocking gates allow draft planning to continue while preserving the review requirement.

Human-readable review explanations are rendered outside the deterministic validator kernel through the witness template catalog.

## Route Validation vs Route Finding

Venviewer must distinguish route validation from route finding.

- **Route validation** checks a route that has already been supplied by the planner, the venue, a template, a policy fixture, or a deterministic system component.
- **Route finding** searches for a path through arbitrary walkable geometry.

For v0, the Scotland Policy Bundle may support route validation only.

Requests for arbitrary route discovery, route optimization, or legal route approval are `unsupported_request` in v0. They are not failed checks and they are not hidden passes.

## V0 Allowed Route Inputs

V0 validators may check:

- a submitted route polyline
- an explicit graph path
- a route over predefined nodes and connectors

The route source must be explicit in the Layout Evidence Pack. If no submitted route, graph path, or predefined node/connector route exists, v0 must report the relevant route claim as `not_checked` or `requires_human_review`, not `pass`.

## V0 Allowed Route Checks

For submitted routes, v0 may validate:

- **continuity:** consecutive route segments connect within the declared tolerance.
- **in-bounds:** route points and segments remain inside the cited venue/floor-plan bounds or declared walkable region.
- **minimum width/clearance:** the route corridor maintains the policy-bundle clearance against placed objects and known fixed features.
- **portal/connector validity:** the route crosses walls, doors, stage edges, level changes, or restricted zones only through declared portals/connectors.
- **start/end correctness:** the route begins and ends at declared sources, destinations, exits, service points, or accessible positions.
- **wheelchair connector permission:** routes that claim wheelchair suitability use connectors declared as permitted for wheelchair access under the active assumptions.

These checks are deterministic validation of supplied route evidence. They are not proof that no better route exists, that all routes have been discovered, or that the venue has legal egress approval.

## Deferred Route Work

The following are explicitly deferred from v0:

- arbitrary route discovery
- navmesh search
- Recast/Detour route synthesis
- OR-Tools or Z3 route optimization
- legal egress route approval

Deferred route-finding work may become v1 research or implementation only after Canonical Layout Snapshot v0, explicit policy bundles, route input vocabulary, geometry/connector fixtures, and validator witness output are stable.

## Evidence Pack Requirements

Any Layout Evidence Pack route witness using this policy bundle must include:

- route input type: `submitted_polyline`, `explicit_graph_path`, or `predefined_node_connector_route`
- route source reference
- route point/path ordering
- relevant assumption IDs from the Assumption Ledger
- cited venue/runtime package or floor-plan reference
- cited portal/connector definitions
- validator version/hash
- tolerance policy
- clearance policy reference
- `messageKey`, `messageArgs`, `facts`, `derivation`, `policyRefs`, and `snapshotRefs`
- explicit limitation that v0 checked the supplied route and did not discover arbitrary routes

Human-readable explanation must be rendered outside the validator kernel through the witness template catalog.

## Staleness

Route-validation evidence becomes stale when:

- the layout snapshot changes
- the submitted route changes
- the venue/runtime package or floor-plan geometry changes
- portal/connector definitions change
- clearance, width, or tolerance policy changes
- wheelchair/accessibility assumptions change
- validator version or hash changes
- relevant event metadata changes

Stale route evidence remains inspectable but must not be presented as current.

## Public and Legal Language Guardrails

Allowed v0 wording:

- "submitted route checked"
- "draft route planning check"
- "route requires human review"
- "route not checked"
- "checked against supplied route"

Disallowed v0 wording unless qualified evidence and professional review exist:

- "route discovered"
- "optimal route"
- "fire approved"
- "legally compliant egress route"
- "certified evacuation route"
- "accessibility approved"

## Non-Goals

- No route-finding implementation.
- No navmesh, Recast/Detour, OR-Tools, or Z3 dependency adoption.
- No legal, fire, evacuation, or accessibility certification.
- No database schema.
- No public copy change.
- No replacement for Layout Proof Object, Canonical Layout Snapshot v0, or Assumption Ledger doctrine.
