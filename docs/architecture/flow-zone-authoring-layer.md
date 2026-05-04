# Flow Zone Authoring Layer

Status: Active planning doctrine  
Date: 2026-05-01  
Source: FZAL-001  
Depends on: Operational Geometry Compiler, Guest Flow Replay, Assumption Ledger, Venue Data Request Pack  
Relates to: Event Ops Compiler, Layout Evidence Pack, Hallkeeper Sheet, Truth Mode, Scotland Policy Bundle, `.venreplay.zip`

## Purpose

The Flow Zone Authoring Layer is the venue-authored operational annotation layer for movement, queues, staff paths, service points, portals, and scenario setup.

Guest Flow Replay requires more than room polygons and furniture obstacles. It needs intentional venue knowledge: where guests arrive, where they should wait, where a bar queue may form, which doors are usable, where suppliers load in, which areas are staff-only, and which points are legitimate goals for a scenario. Those zones should be first-class operational annotations, not hardcoded simulator internals or one-off replay configuration.

This document is planning doctrine only. It does not implement UI, database tables, runtime code, route finding, simulation code, dependencies, or public copy changes.

## Core Doctrine

- Flow zones are authored operational facts or assumptions, not decorative floorplan labels.
- Flow zones feed the Operational Geometry Compiler, Guest Flow Replay, Event Ops Compiler, Layout Evidence Packs, and hallkeeper workflows.
- Flow zones must carry provenance: who authored them, when, from which venue data or review, and under which assumptions.
- Flow zones must be purpose-fit. A zone useful for bar-queue planning may be insufficient for accessibility evidence or egress planning.
- Missing or unverified flow zones follow the Data Sufficiency Contract and Review Gate Engine.
- Customer-visible zones must use safe language: planning, preview, draft, or evidence terms rather than certification terms.
- Simulation code may consume flow zones, but must not invent venue-critical zones silently.

## Flow Zone Kinds

Initial flow zone kinds:

- `room`
- `obstacle`
- `door`
- `portal`
- `queue`
- `spawn`
- `goal`
- `wait_service`
- `staff_only`
- `supplier_load_in`
- `wheelchair_route`
- `holding_area`

## Zone Definitions

| Kind | Geometry type | Required properties | Who can author it | Customer-visible | Feeds |
|---|---|---|---|---|---|
| `room` | Polygon or multipolygon | Stable ID, room/venue reference, units, coordinate frame, provenance, purpose, confidence, source room geometry reference | Capture/reconstruction operator, venue ops reviewer, authorized admin | Usually yes as room outline or named space | Operational Geometry Compiler, Validator Kernel, Guest Flow Replay, Layout Evidence Pack, Event Ops Compiler |
| `obstacle` | Polygon or multipolygon | Stable ID, obstacle type, fixed/movable flag, footprint source, height if relevant, clearance behavior, provenance, confidence | Capture operator, planner for temporary obstacles, venue ops reviewer | Sometimes, when relevant to planning | Operational Geometry Compiler, Validator Kernel, Guest Flow Replay, Hallkeeper Sheet |
| `door` | Line segment, polygon, or portal point with width | Stable ID, width, swing/open state if known, accessibility permission, connected spaces, source, operating assumptions, review status | Venue ops reviewer, capture operator, accessibility/fire reviewer where applicable | Sometimes; normal users see simplified door/entry labels | Operational Geometry Compiler, Validator Kernel, Guest Flow Replay, Layout Evidence Pack |
| `portal` | Connector edge or opening geometry | Stable ID, from/to regions, width/clearance, permissions, directionality if any, level change if any, operating assumptions | Venue ops reviewer, capture operator, expert reviewer for regulated paths | Usually hidden except expert/debug/evidence views | Operational Geometry Compiler, Validator Kernel, Guest Flow Replay, `.venreplay.zip` |
| `queue` | Polygon or polyline corridor | Stable ID, queue purpose, capacity model if known, service point reference, allowed direction, assumptions, conflict policy | Venue ops reviewer, event planner, hallkeeper | Yes when shown as planning preview; expert details hidden | Guest Flow Replay, Event Ops Compiler, Layout Evidence Pack, Hallkeeper Sheet |
| `spawn` | Point, multipoint, line, or polygon | Stable ID, scenario template reference, agent profile mix, arrival rate/window assumptions, allowed scenarios, provenance | Scenario designer, venue ops reviewer | Usually hidden in normal customer view | Guest Flow Replay, `.venreplay.zip`, Layout Evidence Pack |
| `goal` | Point, polygon, or set of target nodes | Stable ID, scenario template reference, goal type, eligible agent profiles, completion rule, assumptions | Scenario designer, venue ops reviewer | Usually hidden or summarized | Guest Flow Replay, `.venreplay.zip`, Layout Evidence Pack |
| `wait_service` | Point, line, or polygon | Stable ID, service type, service rate if known, staff requirement, queue relation, operating assumptions | Venue ops reviewer, event planner, catering/bar reviewer | Sometimes, especially for bars/check-in/cloakroom | Guest Flow Replay, Event Ops Compiler, Layout Evidence Pack, Hallkeeper Sheet |
| `staff_only` | Polygon or route corridor | Stable ID, role permissions, time window, linked service routes, conflict policy, source, review status | Venue ops reviewer, hallkeeper, event ops lead | Generally no for clients; yes in staff/hallkeeper outputs | Event Ops Compiler, Hallkeeper Sheet, Guest Flow Replay, Validator Kernel |
| `supplier_load_in` | Polyline corridor, polygon, or portal chain | Stable ID, supplier class, load-in direction, restrictions, time window, door/portal references, assumptions | Venue ops reviewer, supplier coordinator, hallkeeper | Usually no for clients; yes in supplier packs | Event Ops Compiler, Hallkeeper Sheet, Guest Flow Replay, Layout Evidence Pack |
| `wheelchair_route` | Explicit polyline or graph path over connectors | Stable ID, route purpose, start/end, connector permissions, width/gradient/elevator assumptions where known, review status | Accessibility reviewer, venue ops reviewer, expert reviewer where required | Summary may be visible; details in evidence/expert views | Validator Kernel, Layout Evidence Pack, Truth Mode, Guest Flow Replay |
| `holding_area` | Polygon | Stable ID, holding purpose, capacity assumption, agent profiles, time window, staff relation, constraints | Venue ops reviewer, event planner, hallkeeper | Sometimes, depending on event flow | Guest Flow Replay, Event Ops Compiler, Hallkeeper Sheet |

## Required Shared Properties

Every flow zone should eventually include:

- `zoneId`
- `zoneKind`
- `geometry`
- `coordinateFrame`
- `units`
- `venueId`
- `roomId`
- `purpose`
- `authoredBy`
- `authoredAt`
- `source`
- `reviewStatus`
- `customerVisibility`
- `feeds`
- `assumptionRefs`
- `provenanceRefs`
- `staleWhen`
- `dataSufficiencyStatus`

## Relationship To Operational Geometry Compiler

The Operational Geometry Compiler consumes flow zones as authored inputs and compiles them into deterministic operational features.

Examples:

- A `queue` zone becomes a simulation queue region, an operational warning area, and possibly a Layout Evidence Pack witness input.
- A `door` and `portal` pair becomes a portal definition and connector graph edge.
- A `staff_only` zone becomes a restricted region for guest flow and a service-path feature for Event Ops.
- A `wheelchair_route` stays an explicit submitted route for validation; v0 does not discover arbitrary accessible routes through raw geometry.

The compiler may reject, degrade, or review-gate flow zones that are self-intersecting, outside room bounds, missing required properties, or unsupported for the requested purpose.

## Relationship To Guest Flow Replay

Guest Flow Replay Scenario Templates should declare which flow zone kinds are required.

Examples:

- `guest_arrival_grand_hall` may require `spawn`, `goal`, `door`, `portal`, and `holding_area`.
- `bar_queue_after_speeches` may require `queue`, `wait_service`, `goal`, and staff conflict zones.
- `supplier_load_in` may require `supplier_load_in`, `portal`, `staff_only`, and obstacle zones.

Scenario Instances should cite the exact flow zone versions used. If a flow zone changes, the replay becomes stale.

## Relationship To Event Ops Compiler

Event Ops Compiler should use flow zones to generate:

- staff route notes
- catering and bar-service placement notes
- load-in/load-out warnings
- queue-management guidance
- hallkeeper setup checks
- supplier pack constraints
- review gates for missing or contested operational zones

Flow zones let operational outputs cite authored venue knowledge instead of inferring everything from the visual layout.

## Relationship To Layout Evidence Pack

Layout Evidence Packs should cite flow zones when witness blocks depend on them.

Examples:

- A bar queue warning cites the queue zone, service point, and service-rate assumptions.
- A wheelchair route check cites an explicit `wheelchair_route`, portal definitions, and assumptions.
- A supplier/load-in witness cites supplier route zones, door/portal data, and operating time windows.

If a flow zone is unverified, stale, contested, or missing, the evidence should be degraded, not checked, unsupported, or routed to human review.

## Relationship To Venue Data Request Pack

The Venue Data Request Pack is a major source for flow zones.

Examples:

- exits and door widths feed `door` and `portal`
- supplier/load-in routes feed `supplier_load_in`
- staff/service/catering positions feed `staff_only`, `wait_service`, and `service` behavior
- accessibility facilities feed `wheelchair_route`
- fire strategy or venue policy notes may create review-only zones or assumptions

Venue-supplied facts should remain linked to the zone that uses them so staleness and review responsibilities are traceable.

## Non-Goals

- No flow-zone editor implementation.
- No database schema.
- No simulation code.
- No route-finding code.
- No proof/validator implementation.
- No public marketing copy.
- No package rename.
