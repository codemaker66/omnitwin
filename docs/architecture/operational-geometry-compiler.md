# Operational Geometry Compiler

Status: Active planning doctrine  
Date: 2026-05-01  
Source: OGC-001  
Depends on: Canonical Layout Snapshot v0, Layout Proof Object, Guest Flow Replay, Data Sufficiency Contract, Assumption Ledger, Venue Data Request Pack  
Relates to: Deterministic Validator Kernel, Flow Zone Authoring Layer, Geometry Approximation Policy, Layout Evidence Pack, Event Ops Compiler, Hallkeeper Sheet, Truth Mode, Scotland Policy Bundle, `.venreplay.zip`

## Purpose

The Operational Geometry Compiler converts canonical room/layout data into deterministic 2D operational geometry for validation, simulation, evidence, and operations.

Rendered floorplans are not enough. A visual floorplan can tolerate decorative strokes, labels, hatches, rounded display corners, artistic simplification, or editor-only grouping. Guest Flow Replay, route validation, accessibility planning checks, egress planning evidence, catering routes, staff paths, hallkeeper sheets, and Layout Evidence Packs need a clean machine-readable geometry layer with explicit polygons, portals, zones, and hashes.

The compiler is a doctrine boundary only in this document. It does not implement compiler code, add dependencies, change runtime rendering, or change public copy.

## Core Doctrine

- Operational geometry is derived from canonical venue/layout state, not from rendered SVG/canvas/DOM pixels.
- Operational geometry is deterministic for the same inputs, assumptions, and compiler version.
- Operational geometry is metric. Units must be explicit and should follow the canonical venue/layout units.
- Operational geometry is purpose-fit. Geometry fit for visual preview may be insufficient for route validation, flow simulation, accessibility checks, or evidence packs.
- Missing or unsupported operational inputs follow the Data Sufficiency Contract. Missing data must become `unsupported_request`, `not_checked`, `degraded_evidence`, or `requires_human_review`, not silent pass/fail.
- Route validation and simulation consume compiled geometry. They should not re-derive walkable regions ad hoc from UI components.
- The compiler may emit 2.5D level/connectors when needed, but v0 starts with room-level 2D operational geometry.
- The compiler output is evidence input. It should be hashable, inspectable, and reproducible.

## Inputs

The compiler consumes:

| Input | Meaning |
|---|---|
| canonical room geometry | The authoritative room shell, boundaries, columns, fixed obstructions, alcoves, stage edges, wall openings, and measured room dimensions available for the target purpose. |
| current layout objects | The immutable or draft layout snapshot objects placed by the planner: tables, chairs, bars, stages, dancefloors, signage, AV, service stations, temporary structures, and other operational objects. |
| furniture footprints | Metric object footprints, clearance envelopes, rotation, anchor point, collision shape, service envelope, and whether the object is movable, temporary, staff-only, or guest-accessible. |
| door/portal data | Door locations, widths, swing/restriction assumptions, portal IDs, accessibility permissions, open/closed state, and connector relationships. |
| venue zones | Heritage protected zones, staff-only zones, service corridors, queue zones, bar/service zones, stage/performance zones, loading routes, no-fix/no-load regions, and accessibility regions. |
| flow zones | Authored operational annotations such as queue, spawn, goal, wait/service, staff-only, supplier/load-in, wheelchair-route, holding-area, door, and portal zones. |
| policy bundle requirements | Geometry requirements from policy/rule modules, such as minimum route width, clearance envelope, queue constraints, forbidden zones, and data fields required for a requested claim family. |
| scenario assumptions | Assumption Ledger entries such as attendance, room mode, doors available, service rates, staff routes, wheelchair assumptions, queue behavior, supplier/load-in behavior, event timing, and simulation scenario parameters. |

Input provenance must remain visible enough for Truth Mode, Layout Evidence Packs, and audit reports to explain why a compiled result was current, degraded, not checked, or review-gated.

## Outputs

The compiler should eventually emit:

| Output | Meaning |
|---|---|
| walkable polygons | Clean polygons representing the guest/staff/supplier-accessible walkable area for the requested purpose and assumptions. |
| obstacle polygons | Non-walkable or restricted polygons generated from walls, fixed obstructions, furniture footprints, service envelopes, forbidden zones, and temporary structures. |
| portal definitions | Door/portal/opening records with IDs, geometry, width, permissions, connected regions/levels, state, assumptions, and provenance. |
| connector graph | Optional graph of nodes and connectors across portals, stairs, lifts, ramps, stage edges, thresholds, or multi-room paths when available. |
| queue zones | Zones where queue formation or queue-capacity simulation is allowed, expected, or forbidden. |
| staff/service zones | Staff-only, supplier, catering, bar, back-of-house, load-in, and service-route zones. |
| GeoJSON for simulation | Simulation/export-friendly 2D or 2.5D geometry, including features, properties, IDs, and coordinate frame metadata. |
| geometry hash | Digest of canonicalized compiler inputs and outputs sufficient to detect stale validations, replays, and evidence packs. |
| data sufficiency result | Explicit result for whether the compiled geometry is sufficient, degraded, not checked, unsupported, or requires human review for the requested consumer/purpose. |

## Operational Geometry Classes

Initial geometry classes should include:

- `room_boundary`
- `walkable_area`
- `obstacle`
- `furniture_footprint`
- `clearance_envelope`
- `door`
- `portal`
- `connector`
- `queue_zone`
- `spawn_zone`
- `goal_zone`
- `staff_only_zone`
- `service_zone`
- `heritage_restricted_zone`
- `accessibility_connector`
- `unknown_or_unverified_area`

These are operational classes, not visual layer names. A single rendered object may compile into multiple operational features: for example, a bar can create an obstacle polygon, a queue zone, a service zone, and a staff-only edge.

## Consumers

### Deterministic Validator Kernel

The validator kernel should use compiled geometry for clearance, forbidden-zone, submitted-route, explicit graph path, capacity, operational/setup, and simple accessibility planning checks. Kernel witnesses should cite geometry hash, compiler version, relevant feature IDs, policy refs, assumptions, and data sufficiency result.

### Guest Flow Replay

Guest Flow Replay should use compiled walkable polygons, spawn zones, goal zones, queue zones, obstacles, portals, and connector graph data. `.venreplay.zip` artifacts should cite the operational geometry hash and compiler version.

### Layout Evidence Pack

Layout Evidence Packs should record which operational geometry output was used for each witness block. If layout, venue geometry, policy bundle, scenario assumptions, or compiler version changes, affected evidence becomes stale.

### Event Ops Compiler

Event Ops outputs should use compiled service zones, staff-only zones, supplier/load-in routes, queue zones, and hallkeeper-relevant operational features. The compiler prevents operational sheets from inheriting decorative floorplan assumptions.

### Hallkeeper Sheet

Hallkeeper sheets should cite operational footprints and zones for setup instructions, conflict warnings, service paths, protected surfaces, and review gates.

### Truth Mode

Truth Mode should explain operational geometry as a derived evidence layer. It should distinguish measured room geometry, venue-supplied assumptions, compiled walkable areas, degraded/missing inputs, and human-review gates.

## Failure Modes

The compiler must detect or explicitly surface:

- self-intersecting polygons
- zero-area slivers
- disconnected walkable regions
- missing door widths
- unsupported curved geometry
- unverified furniture footprint
- missing portal/connector definitions
- furniture outside room bounds
- overlapping obstacles that break expected walkable continuity
- unknown level/connector relationships
- scenario request that needs unavailable geometry class
- policy requirement that cannot be evaluated from available geometry
- mismatch between visual object and operational footprint

Failure must not become a hidden pass. Depending on purpose, failures should emit a Data Sufficiency Contract result and/or Review Gate Engine output.

## Data Sufficiency

Every compiled output should declare a data sufficiency result for the requested consumer.

Examples:

- Missing door width for a route-width check: `not_checked` or `requires_human_review`.
- Unverified table footprint for capacity/clearance evidence: `degraded_evidence`.
- Arbitrary route discovery requested before v1 route-finding support: `unsupported_request`.
- Curved geometry approximated by a polygon for low-risk planning: `degraded_evidence` with approximation metadata.
- Visual-only object with no operational footprint: `requires_human_review` or excluded from evidence, depending on purpose.

## Geometry Hash

The geometry hash should be a stable digest of:

- compiler schema/version
- canonical room geometry references
- layout snapshot hash
- furniture footprint definitions
- venue zone definitions
- portal/connector definitions
- policy bundle references relevant to geometry
- scenario assumptions relevant to geometry
- emitted operational geometry features after deterministic ordering

The hash is not a legal proof by itself. It is an input identity mechanism so validators, Guest Flow Replays, Layout Evidence Packs, and Truth Mode can detect stale evidence.

## Determinism And Canonicalization

Future implementation should define:

- coordinate frame and units
- polygon winding convention
- rounding/tolerance policy
- feature ID stability rules
- deterministic feature ordering
- treatment of holes and multipolygons
- curved-geometry approximation rules, following the Geometry Approximation Policy when proof geometry differs from visual geometry
- invalid geometry repair policy versus hard failure
- collision between visual grouping and operational grouping

The compiler should prefer failing with a clear data sufficiency/review output over silently repairing geometry in a way that changes evidence meaning.

## Non-Goals

- No compiler code in this doctrine task.
- No GeoJSON schema implementation yet.
- No polygon clipping library adoption yet.
- No navmesh or arbitrary route-finding implementation.
- No JuPedSim/PedPy/Vadere/Recast/Detour dependency.
- No legal egress or accessibility certification claim.
- No public copy change.
- No package rename.
