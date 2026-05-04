# Assumption Ledger for Evidence Packs and Simulations

Status: Active planning doctrine  
Date: 2026-05-01  
Source: ASSUMPTION-001  
Depends on: Layout Proof Object doctrine, Crowd Simulation Replay Bundle doctrine, Truth Mode Doctrine, D-018, D-024

## Purpose

An Assumption Ledger is the first-class list of assumptions under which a Layout Evidence Pack, Guest Flow Replay, constraint check, pricing proposal, or operational output is meaningful.

Venviewer must not treat assumptions as hidden validator constants, prompt text, or informal notes. If an output depends on a guest count, service rate, door state, room mode, policy version, staff count, inventory list, accessibility assumption, or capture/geometry condition, that assumption must be explicit, inspectable, and staleable.

Proof outputs are valid only under their assumptions. Changing an assumption does not merely update UI copy; it can invalidate evidence, simulation results, pricing outputs, and operational instructions.

## Relationship to Existing Doctrine

The Assumption Ledger is distinct from:

- **Canonical Layout Snapshot v0:** the frozen subject being checked. The snapshot may reference assumptions, but the ledger owns their structured identity and lifecycle.
- **Layout Proof Object / Layout Evidence Pack:** the evidence package that cites the assumptions used by validators and witnesses.
- **Crowd Simulation Replay Bundle:** the simulation evidence package that cites scenario assumptions, agent assumptions, seed assumptions, and simulator parameters.
- **Truth Mode:** the trust interface that discloses which assumptions support, limit, or stale a visible claim.
- **Scene Authority Map:** authority and representation routing. Scene Authority changes can stale assumptions, but the ledger does not decide representation authority.

Assumption Ledger is the shared input contract. It prevents the same assumption from being duplicated as prose in one evidence pack, a JSON field in one replay bundle, and an undocumented parameter in one validator.

## Assumption Categories

Initial categories:

- `attendance`: guest count, attendee class, seated/standing split, no-show assumptions.
- `event_mode`: wedding, gala, conference, ceremony, reception, dinner, staff-only setup, room flip.
- `time_window`: arrival window, service window, setup window, teardown window, room-flip interval.
- `door_exits_availability`: which doors, exits, routes, lifts, and access points are open, restricted, or staff-only.
- `staff_availability`: staff count, roles, shift windows, route access, setup or service constraints.
- `furniture_inventory`: tables, chairs, stages, linen, bar modules, AV, stock counts, dimensions, availability.
- `service_rate`: bar throughput, catering pass rate, cloakroom speed, check-in rate, queue processing assumptions.
- `accessibility`: wheelchair routes, turning radius assumptions, lift availability, accessible seating, assistance requirements.
- `policy_rule`: policy bundle version, code or standard edition where applicable, rule module version/hash.
- `venue_operating_rule`: house rules, listed-building restrictions, protected zones, supplier/load-in constraints.
- `pricing`: price book version, package assumptions, exclusions, taxes, discretionary service, currency.
- `simulation`: simulator name/version, seed or seed set, agent profiles, route preferences, model limitations.
- `capture_geometry`: capture date, runtime package, geometry confidence, Scene Authority Map reference, stale capture regions.

Categories are not claim statuses. They describe the assumption's domain so validators, simulations, UI, and operators can decide how to present and stale it.

## Required Fields

Every assumption entry should include:

- `assumptionId`: stable ID within the evidence or replay package.
- `category`: one of the documented assumption categories.
- `statement`: plain-language assertion, suitable for L2/L3 Truth Mode disclosure.
- `source`: where the assumption came from: venue policy, user input, staff review, capture metadata, pricing book, simulator config, imported event record, or system default.
- `assertedBy`: user, role, system, policy bundle, or import that asserted it.
- `confidence`: categorical confidence or assurance band; no false precision.
- `effectiveFrom`: optional start time or version boundary.
- `effectiveTo`: optional end time, expiry, or validity boundary.
- `usedBy`: references to Layout Evidence Packs, witness blocks, Guest Flow Replays, Event Ops outputs, pricing proposals, or Prompt-To-Perfect generations that consumed it.
- `staleWhen`: machine-readable staleness conditions.
- `requiresHumanReview`: boolean. True when the assumption cannot be safely accepted from automation alone.

Optional implementation fields may add reviewer identity, reviewedAt, supersededBy, evidenceRefs, policyRefs, venueRefs, or notes, but those are not required for this planning doctrine.

## Staleness

Assumptions become stale when their supporting context changes. Common staleness triggers:

- layout snapshot changes
- venue runtime package changes
- Scene Authority Map changes
- policy bundle or venue rule changes
- pricing book changes
- inventory availability changes
- staff availability changes
- door/exit availability changes
- event metadata changes
- capture session superseded
- simulator version, parameters, seed policy, or navmesh changes
- manual contestation by venue staff, planner, client, or reviewer
- effectiveTo / expiry reached

Stale assumptions must remain inspectable. They should not be deleted or silently overwritten, because they explain why an older evidence pack or replay was once generated.

## How Assumptions Appear

### Truth Mode

Truth Mode must disclose assumptions progressively:

- L1 may show a simple warning such as "Evidence has assumptions" or "Some assumptions need review."
- L2 should summarize the key assumptions that affect the selected claim, region, or output.
- L3 should show the full assumption entries, source, assertedBy, freshness, and staleWhen logic.
- L4 should expose raw package references and hashes when available.

Truth Mode must distinguish "assumption accepted," "assumption requires human review," "assumption stale," and "assumption contested." A green visual check must not hide unresolved assumptions.

### Layout Evidence Pack

Every Layout Evidence Pack must carry an assumption section. Witness blocks should cite the exact assumption IDs they consumed.

Examples:

- Capacity witness cites attendance and table seating assumptions.
- Budget witness cites pricing and inventory assumptions.
- Egress/accessibility witness cites door/exits availability, policy/rule, accessibility, and layout-mode assumptions.
- Heritage witness cites venue operating rules and Scene Authority Map / capture-geometry assumptions.

If an assumption changes, the affected witness blocks become stale and require regeneration or human review.

### Guest Flow Replay

Every Guest Flow Replay must carry an assumption section. Replay bundles should cite assumptions for:

- guest arrival window
- number and type of agents
- bar service rate
- staff and catering routes
- wheelchair route assumptions
- available doors/exits
- simulator parameters, seed or seed set, and route preferences
- navmesh and geometry context

Replay outputs are not portable without the assumption ledger. A queue warning from a 30-minute arrival window cannot be reused for a 10-minute arrival window without regeneration.

### Event Ops Compiler

The Event Ops Compiler must compile BEOs, hallkeeper notes, supplier packs, staff checklists, and load-in instructions with assumption awareness.

Operational outputs should:

- show important assumptions in plain language
- carry stale/needs-review status when assumptions are missing or expired
- avoid presenting priced, staffed, routed, or capacity-sensitive instructions as final when their assumptions are not current
- preserve assumption IDs so later audit and Venue Memory can trace what the output depended on

### Prompt-To-Perfect

Prompt-To-Perfect may propose assumptions, but it does not validate them.

AI-generated plans must separate:

- user-stated assumptions
- AI-inferred assumptions
- system defaults
- venue policy assumptions
- assumptions requiring human review

Before an AI-generated layout is presented as valid, its assumptions must pass deterministic validation or be labelled as requiring review. Hidden AI assumptions are below the bar.

## Human Review

`requiresHumanReview` is not a soft warning. It means the assumption cannot be promoted to operational evidence without a qualified reviewer, venue operator, hallkeeper, or explicitly authorized role.

Examples:

- "North entrance unavailable during load-in" may require venue staff confirmation.
- "Wheelchair route via side corridor" may require hallkeeper or accessibility review.
- "Bar service rate: 80 guests/hour" may require operational precedent or supplier confirmation.
- "Protected fireplace clearance zone is 1.2m" may require policy or heritage review.

Human review should be represented as its own evidence input, not implied by the existence of an assumption.

## Guardrails

- Do not hide assumptions inside validator code.
- Do not treat simulation parameters as implementation detail when they affect user-facing evidence.
- Do not reuse evidence or replay results after a relevant assumption changes.
- Do not collapse assumptions into one free-text field.
- Do not claim legal, fire, accessibility, pricing, or operational certainty beyond the assumptions and review scope.
- Do not allow Prompt-To-Perfect to silently invent operational assumptions.
- Do not make a single global assumption set for all outputs; assumptions are scoped to the evidence/replay/output that consumed them.

## Non-Goals

- No database schema in this doctrine.
- No runtime UI implementation.
- No validator, simulator, pricing, or Event Ops Compiler implementation.
- No public copy changes.
- No package rename.
