# Crowd Simulation Replay Bundle and Guest Flow Replay

Status: Active planning doctrine  
Date: 2026-05-01  
Source: CSRB-DR-2026-05-01  
Depends on: D-009, D-011, D-012, D-014, D-018, D-019, D-024, Layout Proof Object doctrine, Canonical Layout Snapshot v0, Truth Mode Doctrine

## Purpose and Names

Crowd Simulation Replay Bundle is Venviewer's internal architecture term for a replayable movement-simulation evidence package tied to one layout scenario. It records the layout snapshot, venue/runtime geometry, navigation mesh, scenario assumptions, agent profiles, simulator version, random seed(s), trajectory outputs, metrics, limitations, and replay recipe.

Guest Flow Replay, Flow Evidence Pack, and Crowd Flow Preview are the safer customer-facing v0 terms. They describe practical planning support without implying statutory approval.

Evacuation certification, fire-approved simulation, legally compliant egress simulation, and certified evacuation model are deferred and qualified language. Venviewer must not use those claims publicly unless the relevant work is reviewed and approved by qualified professionals under the appropriate regulatory framework. Simulation is decision support and evidence, not statutory approval.

Crowd Simulation Replay Bundles do not block T-091A. They matter later because flow evidence connects Constraint Solver, Event Ops Compiler, Layout Proof Object, Truth Mode, Venue Memory, Revenue Optimizer, and future cinematic replay.

## Purpose

Crowd Simulation Replay Bundles exist to:

- model guest, staff, supplier, catering, wheelchair, queue, room-flip, and exit movement through a proposed layout
- identify bottlenecks, route conflicts, queue risks, accessibility concerns, and operational friction
- provide replayable witness evidence for Layout Proof Objects
- inform Event Ops Compiler outputs such as hallkeeper checklists, supplier packs, load-in notes, and catering route warnings
- support future visual storytelling, including Grand Assembly-style animated venue replays

The system should start with bounded operational scenarios, not emergency certification.

Guest arrival remains the first recommended v0 scenario. It is easier to explain, easier to observe, and less legally loaded than evacuation, full-room optimization, or multi-stage room-flip simulation.

## Scenario Templates vs Scenario Instances

Guest Flow Replay is not a one-off simulation artifact. Venviewer must distinguish reusable scenario templates from specific scenario instances.

### Scenario Template

A Scenario Template is a reusable model of a type of flow.

It should define:

- stable template ID
- venue or venue-class applicability
- flow category
- required geometry classes
- required assumptions
- default agent profile mix
- default spawn/destination semantics
- required route/navmesh inputs
- measurement definitions
- expected output metrics
- witness integration rules
- known limitations and human-review triggers

Examples:

- `guest_arrival_grand_hall`: guests arriving into Trades Hall Grand Hall.
- `room_flip_ceremony_to_dinner`: staff and furniture movement between ceremony and dinner modes.
- `bar_queue_after_speeches`: guest flow from tables toward bar service after speeches.

### Scenario Instance

A Scenario Instance is a specific run of a template against a specific layout snapshot.

It should include:

- stable instance ID
- template ID and template version
- layout snapshot hash
- venue/runtime package hash
- policy bundle reference
- assumption ledger references
- navmesh or route model hash where applicable
- simulator name/version/hash
- simulator parameters
- random seed or seed set
- output trajectory references
- heatmap or derived artifact references
- metrics summary
- witness block reference
- lifecycle/staleness state

Example:

- `wedding_160_arrival_seed_03`: one seeded run of the `guest_arrival_grand_hall` template against a 160-guest wedding layout snapshot.

### Why the Split Matters

The template/instance split is load-bearing because:

- **Replayability:** an instance can be replayed because it cites exact template, layout, runtime, assumptions, simulator, and seed inputs.
- **Venue Memory:** past runs can aggregate by template instead of becoming incomparable one-off files.
- **Comparison across layouts:** two layouts can be compared under the same template and assumption shape.
- **Multi-seed aggregation:** many instances can share one template while varying seed.
- **Staleness:** template, layout, runtime package, policy bundle, assumptions, simulator, or navmesh changes stale the affected instances explicitly.
- **Layout Evidence Pack integration:** witness blocks should cite the scenario template and scenario instance, not just a vague "simulation."

## Scope Categories

Supported scenario categories:

- `guest_arrival_flow`
- `guest_seating_flow`
- `bar_queue_flow`
- `catering_service_route_flow`
- `staff_setup_route_flow`
- `supplier_load_in_flow`
- `wheelchair_accessibility_route_flow`
- `room_flip_movement`
- `exit_egress_planning_check`
- `emergency_evacuation_research_track`

`emergency_evacuation_research_track` is explicitly not v0 certification. It is a research and expert-review path.

## Replay Bundle Contents

A replay bundle should include:

- layout snapshot hash
- venue/runtime package hash
- navmesh version and hash
- policy bundle reference
- scenario template ID and version
- scenario instance ID
- scenario assumptions
- agent profiles
- spawn points
- destinations and goals
- route preferences
- random seed or seed set
- simulator name and version
- simulator parameters
- trajectory output reference
- metrics summary
- heatmap output reference
- replay recipe
- witness block reference
- createdAt and createdBy
- limitations and disclaimers

The bundle should use content-addressed references for large artifacts. Trajectory arrays and heatmaps should not be embedded into database rows if they become large; they should follow the existing header-in-DB, body-in-file posture from D-019.

The portable external artifact form for a Scenario Instance is `.venreplay.zip`. This is a first-class Venviewer Replay Artifact, not an incidental implementation detail. It packages manifest, geometry, scenario, agents, trajectory, metrics, bottlenecks, and witness files for replay, Truth Mode inspection, Layout Proof Object evidence, and Venue Memory aggregation. The detailed artifact doctrine lives in `docs/architecture/venreplay-artifact.md`.

## Flattened 2.5D Vertical Connector Model

V0 should represent multi-level movement with a flattened 2.5D model, not full arbitrary 3D path discovery.

The model should use:

- floor or level IDs
- 2D walkable regions per level
- explicit vertical connectors for stairs, lifts, ramps, stage edges, and thresholds
- connector permissions such as wheelchair allowed, staff-only, supplier-only, or guest-allowed
- connector capacity or width where available
- assumptions for availability and directionality

If a route or scenario needs a vertical connector that is missing, unverified, or outside the Venue Data Request Pack, the replay should emit `not_checked`, `degraded_evidence`, or `requires_human_review`. It must not infer arbitrary cross-level movement from raw geometry.

## Simulation Metrics

Initial metrics:

- total completion time
- average travel time
- max queue length
- queue wait time
- density hotspots
- bottleneck locations
- blocked route count
- accessibility route clear / warning / fail
- staff route conflict count
- catering route conflict count
- egress planning warning count
- uncertainty/confidence label

Metrics must avoid false precision. Normal users should see categorical summaries and meaningful thresholds. Developer and expert review surfaces may expose raw numbers and seed-level outputs.

## Output Visualizations

Potential visual outputs:

- 2D animated dots or agents
- 3D ghosted people or flow ribbons
- density heatmap
- route conflict lines
- bottleneck markers
- queue timeline
- before/after comparison
- replay scrubber
- scenario summary card

Truth Mode must distinguish simulated agents from observed venue reality. Simulated people are planning evidence, not captured facts.

## Tool Strategy

### v0 Prototype

- JuPedSim for simulation where practical.
- PedPy for trajectory metrics where practical.
- Browser replay of exported trajectories.

The first v0 prototype should use one room, one layout, one scenario, exported trajectories, a 2D replay, and a metrics summary.

Browser v0 should replay trajectories in 2D first. 3D ghosted people and cinematic replay are later presentation layers, not prerequisites for evidence.

### Comparison and Research

- Vadere comparison for scenario/model sanity.
- Recast/Detour navmesh and pathing for navigation geometry and route planning.
- ORCA/RVO2 local collision avoidance if useful for agent interaction.

### Professional Benchmark

- Pathfinder, MassMotion, or AnyLogic for high-stakes comparison or expert review if needed.

Professional tools are benchmarks and review references. They are not evidence that Venviewer can claim certified evacuation behavior without qualified scope, assumptions, and review.

## Integration With Layout Proof Object

A crowd replay can become a witness block in a Layout Proof Object.

Witness integration should include:

- claim family: likely `egress`, `accessibility`, `operational_setup`, `supplier_load_in`, or `venue_specific`
- status: `pass`, `warn`, `fail`, `not_checked`, `inapplicable`, `requires_human_review`, or `stale`
- scenario template ID/version
- scenario instance ID
- cited policy and scenario assumptions
- layout snapshot hash
- navmesh hash
- simulator name/version/hash where possible
- seed or seed set
- trajectory output reference
- metrics summary
- replay recipe
- limitations

Replay evidence becomes stale when:

- scenario template changes
- layout snapshot changes
- venue geometry/runtime package changes
- policy bundle changes
- simulator version or parameters change
- scenario assumptions change
- navmesh version/hash changes

For sensitive scenarios, a single stochastic run must not be treated as deterministic truth. Use multiple Scenario Instances with different seeds or mark the witness as requiring human review.

Multi-seed evidence should summarize the seed set, count, spread, worst case, and whether conclusions are stable enough for the declared purpose. If the seed spread changes the operational conclusion, the evidence should be `degraded_evidence` or `requires_human_review`, not a confident pass.

Guest Flow Replay follows the Data Sufficiency Contract. Missing scenario assumptions, missing route inputs, missing door availability, unsupported evacuation certification requests, and missing vertical connectors must be explicit outcomes rather than hidden assumptions.

## Integration With Truth Mode

Truth Mode should show simulation as planning evidence, not physical proof.

Truth Mode responsibilities:

- show which scenario template and instance were used
- disclose scenario assumptions and limitations
- show whether the replay is current, partial, stale, or missing
- distinguish simulated people from observed/captured reality
- expose random seed or seed-set status for advanced review
- show uncertainty/confidence categorically
- avoid false precision and avoid legal/fire approval language

Truth Mode should not turn crowd simulation into one green compliance badge.

## Integration With Event Ops Compiler

Event Ops Compiler can use replay output to inform:

- staff route notes
- load-in sequence
- catering route warnings
- room flip complexity
- hallkeeper checklist items
- supplier pack warnings
- bar staffing or queue-risk notes
- accessibility route review notes

If replay evidence is stale or missing, compiled operations outputs should carry that status rather than silently using old flow assumptions. Where possible, Event Ops Compiler outputs should cite the scenario template and instance that produced a route, queue, or staffing warning.

## Integration With Venue Memory and Revenue Optimizer

Venue Memory can store past flow replays as examples: which layouts queued badly, where staff routes conflicted, which bar placements worked, and how room flips behaved. Past replay results should aggregate by scenario template and comparable assumption sets rather than by unstructured one-off simulation files. Past results are learning examples, not universal guarantees for future layouts.

Revenue Optimizer can use flow metrics as guardrails. It must not optimize revenue by creating unacceptable queue, accessibility, staff-route, catering-route, or egress-planning risks.

## Rollout

### v0: Guest Flow Replay Prototype

- one layout
- one room
- guest arrival scenario first, such as `guest_arrival_grand_hall`; bar queue can follow once assumptions are stable
- one or more scenario instances against a saved layout snapshot
- exported trajectories
- 2D replay
- metrics summary
- no legal/evacuation certification claim

### v1: Operational Flow Evidence

- multiple scenarios
- staff, catering, wheelchair, supplier/load-in, and room-flip routes
- heatmaps
- replay bundle stored with or referenced by Layout Proof Object
- Truth Mode disclosure
- Event Ops Compiler integration

### v2: Expert Review / Egress Research

- professional simulator comparison
- expert-reviewed assumptions
- sensitivity analysis
- possible external engineering review
- no certification unless properly qualified

## Guardrails

- No public legal evacuation certification claim.
- No "fire-approved" claim.
- No "legally compliant egress simulation" claim.
- No single deterministic truth claim from one stochastic run.
- Always expose assumptions.
- Use multiple seeds for sensitive scenarios.
- Professional review is required before external compliance claims.
- Simulation is decision support, not statutory approval.
- Emergency evacuation work remains research until qualified review and policy scope exist.

## Relationship to Current Code

Current code provides only primitive geometry and operations inputs:

- `editor-store` holds live mutable planner state and is not itself evidence.
- Canonical Layout Snapshot v0 defines the saved immutable layout subject.
- `placement-validation.ts` checks point-in-polygon containment; it is not crowd simulation.
- `room-geometries.ts` and `spaces.floorPlanOutline` provide geometry inputs, but navmesh generation is not implemented.
- Hallkeeper manifest generation and sheet snapshots provide operational handoff precedent, but they do not model movement or queues.

## Non-Goals

- No simulation code in this doctrine.
- No JuPedSim, PedPy, Vadere, Recast/Detour, ORCA/RVO2, Pathfinder, MassMotion, or AnyLogic dependency adoption.
- No database tables.
- No runtime replay UI.
- No public marketing copy changes.
- No package rename.
- No emergency evacuation certification.
