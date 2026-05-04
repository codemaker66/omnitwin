# Venue Data Request Pack

Status: Active planning doctrine  
Date: 2026-05-01  
Source: VDRP-001  
Depends on: Scotland Policy Bundle, Layout Proof Object, Assumption Ledger, Review Gate Engine, Venue Claim Lifecycle Engine  
Relates to: Event Ops Compiler, Truth Mode, Send to Events Team workflow, onboarding

## Purpose

The Venue Data Request Pack is Venviewer's formal onboarding artifact for venue-supplied facts. It replaces ad hoc emails and brochure scraping with a structured evidence request that a venue can answer, review, and refresh over time.

Scans, public brochures, photographs, and Matterport captures cannot reliably infer licensing limits, fire-management notes, protected heritage surfaces, supplier routes, staffing assumptions, pricing schedules, or operational exceptions. Those facts must come from named venue sources and must carry staleness rules before they feed Scotland Policy Bundles, Layout Evidence Packs, Guest Flow Replays, Event Ops Compiler outputs, or Truth Mode.

The first pack should be drafted for Trades Hall. The same artifact shape should support future high-complexity venues.

## Core Doctrine

- The pack is a structured onboarding artifact, not an informal request thread.
- Every requested field declares a requirement level, source type, provider role, documented-claim behavior, and staleness policy.
- Required fields that remain unanswered become Review Gate Engine `required_data` outputs.
- Venue-provided documents and named staff attestations are preferred over public brochures. Public brochures may be secondary context but should not become high-assurance evidence by themselves.
- Research-derived venue facts are not accepted until verified for the specific venue. Australian Trades Hall, Solidarity Hall, or similarly named venue facts must not be applied to Trades Hall Glasgow without a verified source.
- Attachments are evidence inputs, not automatic truth. Venviewer still records who provided them, what purpose they support, and when they may become stale.
- A venue fact becomes a documented claim only when the source, provider, scope, and staleness rule are recorded.
- Human-review-only fields can support planning evidence but must not be machine-promoted into legal, fire, licensing, accessibility, heritage, or pricing certification.
- This doctrine does not change public copy, package names, database schema, or runtime UI.

## Field Metadata

Each field in a Venue Data Request Pack must include:

- `requirementLevel`: `required`, `optional`, or `human-review-only`
- `sourceType`: the evidence source category
- `providerRole`: who should provide or approve the fact
- `documentedClaim`: `yes`, `conditional`, or `no`
- `stalenessPolicy`: when the fact needs refresh, review, or replacement

Common source types include:

- `venue_policy_document`
- `licence_certificate`
- `fire_strategy_document`
- `accessibility_statement`
- `floor_plan`
- `measured_survey`
- `staff_attestation`
- `inventory_sheet`
- `manufacturer_spec`
- `BEO_template`
- `pricing_sheet`
- `supplier_pack`
- `public_brochure_secondary`
- `unknown`

Common provider roles include:

- `venue_events_team`
- `hallkeeper`
- `venue_operations_manager`
- `facilities_manager`
- `fire_safety_responsible_person`
- `accessibility_contact`
- `heritage_or_building_manager`
- `finance_or_pricing_owner`
- `catering_or_service_lead`
- `supplier_or_load_in_coordinator`

## Request Sections

| Field | Requirement | Source type | Provider | Documented claim | Staleness policy |
|---|---:|---|---|---|---|
| Room capacities by event mode | required | `venue_policy_document`, `licence_certificate`, `BEO_template` | `venue_events_team`, `venue_operations_manager` | yes | Stale when licence, venue policy, room configuration, event mode, or capacity schedule changes; review at least annually. |
| Authority/licensing capacity notes | human-review-only | `licence_certificate`, `venue_policy_document` | `venue_operations_manager`, `fire_safety_responsible_person` | conditional | Stale when authority/licensing documents or venue operating policy changes; never treated as software certification. |
| Exits and door widths | required | `measured_survey`, `floor_plan`, `fire_strategy_document`, `staff_attestation` | `facilities_manager`, `hallkeeper` | yes | Stale when building works, door availability, fire strategy, venue policy, or runtime package changes. |
| Stair, lift, and ramp dimensions | required | `measured_survey`, `floor_plan`, `accessibility_statement` | `facilities_manager`, `accessibility_contact` | yes | Stale when access equipment, level-change routes, building works, or accessibility policy changes. |
| Accessible WC and refuge points | required | `accessibility_statement`, `floor_plan`, `staff_attestation` | `accessibility_contact`, `facilities_manager` | yes | Stale when facilities, refuge policy, floor plan, or access routes change. |
| Hearing loop and accessibility facilities | optional | `accessibility_statement`, `manufacturer_spec`, `staff_attestation` | `accessibility_contact`, `venue_events_team` | yes | Stale when equipment, service availability, room coverage, or accessibility statement changes; review annually. |
| Fire strategy / evacuation management notes, if available | human-review-only | `fire_strategy_document`, `venue_policy_document`, `staff_attestation` | `fire_safety_responsible_person`, `venue_operations_manager` | conditional | Stale when fire strategy, event risk, temporary structure use, route assumptions, or venue policy changes. |
| Heritage protected zones and surfaces | required | `venue_policy_document`, `floor_plan`, `staff_attestation`, `public_brochure_secondary` | `heritage_or_building_manager`, `hallkeeper` | yes | Stale when conservation advice, protected-surface policy, works, or room-use rules change. |
| No-drill / no-fix / no-load rules | required | `venue_policy_document`, `supplier_pack`, `staff_attestation` | `hallkeeper`, `venue_operations_manager`, `heritage_or_building_manager` | yes | Stale when operating policy, supplier rules, heritage restrictions, or event-specific exceptions change. |
| Furniture inventory | required | `inventory_sheet`, `staff_attestation` | `hallkeeper`, `venue_operations_manager` | yes | Stale when stock is added, removed, repaired, retired, or counted; review during inventory refresh. |
| Table and chair dimensions | required | `inventory_sheet`, `manufacturer_spec`, `measured_survey` | `hallkeeper`, `venue_operations_manager` | yes | Stale when furniture models, stock, dimensions, or layout templates change. |
| Bar, service, and catering positions | required | `floor_plan`, `supplier_pack`, `BEO_template`, `staff_attestation` | `catering_or_service_lead`, `venue_events_team`, `hallkeeper` | yes | Stale when event mode, temporary bar position, catering route, service plan, or venue policy changes. |
| Supplier and load-in routes | required | `supplier_pack`, `floor_plan`, `venue_policy_document`, `staff_attestation` | `supplier_or_load_in_coordinator`, `venue_operations_manager` | yes | Stale when access policy, building works, loading restrictions, event schedule, or supplier plan changes. |
| BEO templates | optional | `BEO_template`, `venue_policy_document` | `venue_events_team`, `venue_operations_manager` | no | Stale when the venue revises templates, terminology, signoff steps, or operational handoff format. |
| Staffing assumptions | required | `BEO_template`, `venue_policy_document`, `staff_attestation` | `venue_events_team`, `venue_operations_manager` | conditional | Stale per event, staffing model, guest count, service style, risk level, or venue staffing policy. |
| Pricing schedule, if relevant | optional | `pricing_sheet`, `venue_policy_document`, `staff_attestation` | `finance_or_pricing_owner`, `venue_events_team` | conditional | Stale when pricing date, package, supplier rates, tax, service charge, or event-specific terms change. |

## Documented Claim Ingestion

The Venue Data Request Pack is an input to the Venue Claim Lifecycle Engine.

When a field is accepted, Venviewer should record:

- the field ID and value
- source document or attestation reference
- provider role and reviewer where applicable
- declared purpose
- whether it is a documented claim, assumption, template input, or human-review-only note
- staleness triggers
- exposure tier if the fact may appear outside internal tooling

Accepted facts should not automatically become public claims. Public marketing, partner preview, authenticated-client exports, and published case studies still require the Claim-Aware Copy Guard and Exposure Tier rules.

## Review Gate Integration

Missing required Venue Data Request Pack fields should trigger Review Gate Engine outputs instead of silent passes.

The pack follows the Data Sufficiency Contract. Missing venue facts should become `not_checked`, `degraded_evidence`, `unsupported_request`, or `requires_human_review` depending on requested purpose and validator scope.

Examples:

- missing exit widths blocks an egress planning claim
- missing protected-surface rules blocks a heritage placement claim
- missing supplier route rules blocks supplier/load-in evidence
- missing staffing assumptions makes an Event Ops Compiler output draft-only
- missing pricing schedule prevents a budget witness from claiming current venue pricing

`required_data` should cite stable Venue Data Request Pack field IDs so the events team can see exactly what is missing.

## Truth Mode and Evidence Pack Display

Truth Mode should expose venue-supplied facts as evidence inputs, not as invisible background assumptions.

Normal users should see compact labels such as:

- "Venue data supplied"
- "Venue review needed"
- "Missing door width"
- "Pricing not current"

Expert users should be able to inspect the source type, provider role, documented-claim status, staleness policy, and linked claim or witness.

Layout Evidence Packs should disclose which claims rely on venue-supplied facts and whether those facts are current, stale, missing, or human-review-only.

## Onboarding Lifecycle

The expected onboarding lifecycle is:

1. Venviewer issues a Venue Data Request Pack for the venue and event spaces.
2. The venue returns documents, structured answers, and named staff attestations.
3. Venviewer maps returned fields to documented claims, assumptions, templates, or human-review-only notes.
4. Missing required fields create review gates.
5. Accepted fields feed policy bundles, Layout Evidence Packs, Guest Flow Replays, Event Ops Compiler outputs, and Truth Mode.
6. Annual refreshes, policy changes, venue works, inventory changes, or event-specific exceptions regenerate the affected requests and stale dependent evidence.

## Non-Goals

- No UI implementation.
- No database schema.
- No runtime code.
- No public marketing copy change.
- No legal, fire, accessibility, licensing, or survey certification claim.
- No package rename.
