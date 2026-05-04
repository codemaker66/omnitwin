# Review Gate Engine for Layout Evidence Packs

Status: Active planning doctrine  
Date: 2026-05-01  
Source: REVIEW-GATE-001  
Depends on: Layout Proof Object, Scotland Policy Bundle, Assumption Ledger, Venue Claim Lifecycle Engine  
Relates to: Truth Mode, Event Ops Compiler, Send to Events Team workflow

## Purpose

The Review Gate Engine is the Layout Evidence Pack v0 layer that turns "this needs a person" into explicit machine-readable evidence.

Many Venviewer checks can produce draft planning evidence. Legal fire, accessibility, heritage, and venue-operational judgments often require a hallkeeper, venue staff member, accessibility reviewer, fire/safety professional, heritage reviewer, or other qualified person. The system must make that requirement explicit rather than burying it in copy or leaving it to the user to infer.

Human review is not an afterthought. It is a first-class output.

## Core Doctrine

- Deterministic validators can produce planning evidence, warnings, failures, and review gates.
- A review gate can be blocking or non-blocking depending on policy, event risk, and output destination.
- `requires_human_review` is a valid evidence status, not a weak failure or hidden warning.
- Review gates must cite structured reasons, required reviewer role, missing data, and message keys.
- Missing venue data should cite stable Venue Data Request Pack field IDs where applicable.
- Review gates should cite Data Sufficiency Contract outcomes when missing or insufficient data caused the gate.
- Review gates must not use human prose inside the trusted validator output.
- Public, client, supplier, hallkeeper, and Event Ops outputs must preserve review-gate state.

## Trigger Conditions

The Review Gate Engine should trigger when:

- required venue data is missing
- required Venue Data Request Pack fields are unanswered for the current purpose
- result is near threshold
- route depends on a historic stair or protected door
- accessible route is partial
- event uses a temporary structure
- layout touches a protected heritage zone
- layout or event includes a high-risk activity
- venue policy requires staff review
- guest flow simulation assumptions are incomplete
- fire/egress claim would exceed planning-evidence scope

Policy bundles may add venue-specific triggers.

## Output Shape

A review gate should output:

- `status`: `requires_human_review`
- `review_reason`
- `required_reviewer_role`
- `required_data`
- `blocking`
- `messageKey`
- `messageArgs`

The output may also include:

- policy references
- snapshot references
- affected object IDs
- affected route IDs
- affected zone IDs
- threshold and measured value facts
- data sufficiency outcome
- assumption IDs
- suggested next action
- expiry or re-review trigger

`review_reason` is a machine-readable reason code, not a paragraph of human explanation. Human-readable rendering belongs in Truth Mode, Evidence Pack UI, emails, PDFs, and Send to Events Team surfaces through the witness template catalog.

When `required_data` refers to missing venue facts, it should point to Venue Data Request Pack fields rather than generic prose. This lets the events team resolve the gate through onboarding review rather than guessing which document or staff answer is needed.

## Blocking vs Non-Blocking

Blocking review gates prevent the Layout Evidence Pack from being presented as current/accepted for a target purpose or exposure tier.

Examples:

- fire/egress claim would exceed planning-evidence scope
- route depends on an unreviewed protected door
- required venue data is missing for a claim being exported
- event uses a temporary structure with no venue approval

Non-blocking review gates allow draft planning to continue while preserving the review requirement.

Examples:

- result is near a conservative threshold but not failed
- guest-flow assumptions are incomplete for an exploratory draft
- venue staff review is required before event-team acceptance

The same gate can be non-blocking in an internal planning view and blocking in an authenticated-client export or public-facing case study.

## Reviewer Roles

Initial reviewer roles should include:

- `venue_events_team`
- `hallkeeper`
- `venue_operations_manager`
- `accessibility_reviewer`
- `fire_safety_reviewer`
- `heritage_reviewer`
- `supplier_coordinator`
- `technical_admin`

These roles are not permissions by themselves. They name the kind of review required. Access control and routing are implementation concerns for later tasks.

## Integration With Deterministic Validator Kernel

The validator kernel may emit review gates as structured witness output.

The kernel should not say "this is legally safe" or "this will pass fire review." It should say, in structured form:

- which rule or threshold was evaluated
- what fact was observed
- which review gate fired
- why review is required
- what data or reviewer role is needed
- whether the gate blocks the current purpose or output

Message rendering follows the existing `messageKey` / `messageArgs` rule.

## Integration With Scotland Policy Bundle

For Scotland-based Layout Evidence Packs, the Scotland Policy Bundle should use review gates to prevent v0 planning checks from implying legal, fire, accessibility, or heritage approval.

Examples:

- Historic stair or protected door involvement triggers `requires_human_review`.
- Partial accessible route evidence triggers `requires_human_review`.
- Missing submitted route input triggers `not_checked` or `requires_human_review`.
- A fire/egress claim that would exceed draft planning scope triggers a blocking review gate.
- Venue policy can require staff review even when deterministic checks pass.

## Integration With Truth Mode

Truth Mode should display review gates as their own state.

Normal users should see compact labels such as:

- "Needs venue review"
- "Needs accessibility review"
- "Draft only"
- "Missing venue data"

Expert/QA users should inspect reason codes, required reviewer role, required data, affected objects/routes/zones, policy references, assumptions, facts, and message keys.

Truth Mode must not collapse review gates into a single green check.

## Integration With Event Ops Compiler

Event Ops Compiler should carry review gates into operational outputs.

If a BEO, hallkeeper sheet, supplier pack, catering route note, accessibility note, or fire/egress planning note depends on a gated claim, the output should show:

- whether the gate is blocking
- who must review it
- what data is missing
- what claim or route/object/zone is affected
- whether the output is draft, current, stale, or accepted

Operational documents should not silently omit review gates.

## Integration With Send to Events Team

The Send to Events Team workflow should treat review gates as handoff metadata.

When a planner sends a layout:

- blocking gates should be visible before send
- non-blocking gates should be included in the handoff summary
- required reviewer roles should route or tag the request where possible
- missing data should be named
- the events team should see what has been machine-checked and what requires human judgment

This improves trust without claiming that the software has completed professional review.

## Staleness

Review gates become stale or require regeneration when:

- layout snapshot changes
- policy bundle changes
- venue/runtime package changes
- assumptions change
- missing data is supplied
- reviewer decision is recorded
- event metadata changes risk level
- related route, zone, temporary structure, or protected-feature data changes

Resolved review gates should remain auditable.

## Non-Goals

- No review queue implementation.
- No database tables.
- No permissions/RBAC implementation.
- No validator implementation.
- No public copy change.
- No claim of legal, fire, accessibility, heritage, or professional approval.
