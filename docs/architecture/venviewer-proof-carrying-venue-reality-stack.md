# Venviewer Proof-Carrying Venue Reality Stack

Status: planning doctrine  
Created: 2026-05-01  
Source: STACK-001 master catch-up consolidation

This document consolidates recent Venviewer research and planning doctrine into
one architecture map. It is not a replacement for the detailed docs it cites.
It is the connective tissue: what owns truth, what owns representation, what
becomes evidence, what must stay internal, and what remains subordinate to the
current P0/T-091 execution priorities.

Related detailed doctrine:

- ADR D-009, D-011, D-012, D-014, D-019, D-024
- `docs/architecture/truth-mode-doctrine.md`
- `docs/architecture/layout-proof-object.md`
- `docs/architecture/crowd-simulation-replay-bundle.md`
- `docs/architecture/assumption-ledger.md`
- `docs/architecture/venue-claim-lifecycle-engine.md`
- `docs/architecture/capture-control-network.md`
- `docs/architecture/calibrated-reliance-principle.md`
- `docs/architecture/purpose-fit-evidence.md`
- `docs/architecture/data-sufficiency-contract.md`
- `docs/architecture/review-gate-engine.md`
- `docs/architecture/operational-geometry-compiler.md`
- `docs/architecture/flow-zone-authoring-layer.md`
- `docs/architecture/lighting-context-package.md`
- `docs/architecture/residual-radiance-layer.md`
- `docs/architecture/venviewer-artifact-registry.md`
- `docs/architecture/license-ip-compliance-ledger.md`
- `docs/architecture/exposure-tier.md`
- `docs/architecture/claim-aware-copy-guard.md`

## 1. Proof-Carrying Venue Reality Stack

Venviewer is building a proof-carrying venue reality compiler. The stack has
six layers:

1. Capture Control Layer
   - Establishes metric, repeatable, inspectable spatial control.
   - Owns E57 station poses, Matterport poses, fiducials, manual landmarks,
     TransformArtifacts, capture sessions, and control QA.

2. Epistemic Claim Layer
   - Owns venue claims, their basis, provenance, freshness, contestation, and
     lifecycle.
   - Uses HVET as a compact application profile for claims.

3. Scene Authority Layer
   - Owns which representation is authoritative for geometry, appearance,
     lighting, physics, semantics, interaction, and export per region.
   - The Scene Authority Map is not a truth model; it routes authority.

4. Provenance and Attestation Layer
   - Owns internal provenance, DSSE/in-toto process attestations, C2PA export
     assertions, artifact hashes, and audit-chain references.

5. Truth Mode Layer
   - Human-facing trust interface. It shows epistemic state, assumptions,
     authority, provenance, evidence state, and uncertainty with progressive
     disclosure.

6. Operational Evidence Layer
   - Owns Layout Evidence Packs, Guest Flow Replays, policy bundles, witness
     blocks, operational geometry, evidence disclosures, and review gates.

Core ownership:

- VSIR remains the canonical spatial/domain structure.
- Scene Authority Map owns representation authority.
- Venue Claim Graph owns epistemic assertions.
- Truth Mode is the human-facing trust interface.
- Layout Evidence Packs and Guest Flow Replays are operational proof artifacts.
- Proof-of-Reality is the umbrella product promise, not a single file format.

## 2. Venue Claim Graph

The Venue Claim Graph is the internal graph of epistemic assertions attached to
regions, objects, assets, layouts, events, routes, captures, evidence packs, and
exports.

HVET is the vocabulary/profile for individual claims. The Claim Graph is not the
same as the Scene Authority Map. The Claim Graph asks "what is asserted, by what
evidence, at what time, for what scope?" The Scene Authority Map asks "which
representation has authority for this region/purpose?"

Rules:

- Claims, not whole objects, are classified.
- Representation form is not truth state.
- AI-generated is a modifier, not a basis.
- Documented is a first-class basis.
- `measured_empty` is distinct from `unknown`.
- Verification is separate from confidence.
- Provenance is evidence, not automatic truth.
- Claims can be contested, superseded, stale, expired, withdrawn, or published.

Examples:

- Chandelier geometry claim: target chandelier A, scope geometry, basis proxy or
  measured, modifier artist_proxy if manually modeled, confidence tier, Scene
  Authority reference, evidence references.
- Chandelier appearance claim: scope appearance, basis scan_observed or residual
  appearance layer, provenance to splat/residual artifact.
- Chandelier semantic claim: scope semantic identity, basis documented or human
  reviewed, source venue inventory or staff review.
- Measured-empty egress route claim: region is observed clear at represented
  time; it expires on layout change, capture refresh, or hallkeeper contest.
- Documented room-capacity claim: basis documented, source venue policy or
  licensing note, stale on policy update or venue review expiry.
- AI-proposed table layout claim: basis proposed, modifier ai_generated, not
  verified until deterministic checks and/or human review run.
- Stale verification claim: previous pass remains inspectable but cannot power
  current public wording.
- Artist-proxy hero-region claim: proxy is legitimate when declared; it must not
  silently become measured geometry.

## 3. Venue Claim Lifecycle Engine

Claim lifecycle is distinct from the Claim Graph. The graph models claim
relationships. The lifecycle engine models temporal state.

Lifecycle states:

- `created`
- `supported`
- `machine_checked`
- `human_reviewed`
- `verified`
- `contested`
- `superseded`
- `stale`
- `expired`
- `withdrawn`
- `published`

Lifecycle events:

- `capture_ingested`
- `claim_created`
- `evidence_attached`
- `validator_checked`
- `human_reviewed`
- `user_contested`
- `layout_changed`
- `venue_geometry_changed`
- `policy_changed`
- `validator_changed`
- `capture_refreshed`
- `claim_published`
- `claim_withdrawn`

Staleness triggers:

- layout snapshot changes
- venue runtime package changes
- Scene Authority changes
- policy bundle changes
- capture session superseded
- proof object superseded
- verification expiry reached
- manual contestation

Consumers:

- Truth Mode shows stale, contested, verified, and withdrawn state.
- Layout Evidence Packs regenerate or flag stale evidence.
- Hallkeeper verification produces human-reviewed overlays.
- Venue Memory learns from prior evidence without treating it as future truth.
- Public exports and provenance include lifecycle state.
- Audit Trail records lifecycle transitions.

## 4. HVET v0

HVET, Heritage-Venue Epistemic Types, is a compact application profile. It is
not a new upper ontology. It borrows from PROV, CIDOC, heritage practice, BIM
LOA/LOD/LOIN, C2PA, DSSE, and in-toto, while avoiding full RDF/OWL runtime
complexity in v0.

HVET classifies claims, not whole objects.

Required axes:

- `target`
- `scope`
- `representedTime`
- `basis`
- `modifiers`
- `verification`
- `contestation`
- `freshness`
- `confidence`
- `measurementQA`
- `evidenceRefs`
- `proofRefs`
- `assertedBy`
- `observedAt`
- `staleAfter`
- `altGroup`

Required basis values:

- `measured`
- `documented`
- `inferred`
- `proxy`
- `proposed`
- `measured_empty`
- `unknown`

Explicit distinctions:

- `documented` is required because venue rules, inventories, conservation
  notes, pricing schedules, and BEO templates are evidence sources.
- `measured_empty` is distinct from `unknown`.
- Verification is distinct from confidence.

## 5. Truth Mode Doctrine

Truth Mode is Venviewer's trust interface, not a debug overlay.

Its purpose is calibrated reliance: users should rely when evidence is strong,
distrust when evidence is weak, and verify when uncertain.

Maturity:

- Trust inspection: expose what is measured, inferred, generated, proxy,
  verified, stale, contested, or unknown.
- Trust workflow: allow hallkeepers and reviewers to approve, contest, expire,
  and regenerate claims.
- Trust infrastructure: expose artifact bundles, process attestations, signed
  proof packages, and export assertions.

Progressive disclosure:

- L1 persistent indicator
- L2 popover
- L3 provenance drawer / evidence chain
- L4 raw manifest / signed artifact / audit bundle

Persona presets:

- Planner Lite
- Hallkeeper Verification
- Developer / QA Debug
- Client Real-vs-Proposed

Evaluation doctrine:

- formative hallkeeper pilot
- role-based benchmark
- field validation
- time to low-trust flag
- issue detection recall
- false positives
- confidence calibration
- provenance comprehension
- workload
- tablet/mobile usability

## 6. Calibrated Reliance Principle

Definitions:

- Appropriate reliance: the user trusts, questions, or escalates exactly as the
  evidence supports.
- Overtrust: the user acts as if a claim is stronger than it is.
- Undertrust: the user ignores good evidence because the system fails to
  communicate it.
- Trust junk: decorative confidence badges, unexplained scores, or reassurance
  that is not tied to evidence.
- Evidence-linked cue: a visible cue that can be inspected back to evidence,
  assumptions, authority, and lifecycle state.

Applies to:

- Truth Mode
- AI layouts
- Layout Evidence Packs
- Guest Flow Replay
- mobile save/send state
- public marketing copy
- Black Label certification

Rules:

- no false precision
- no unexplained trust scores
- verified labels require evidence
- uncertainty cues must not overload users
- normal users see compact cues; expert users can drill down

## 7. Purpose-Fit Evidence

Evidence is evaluated for a purpose, not collapsed into one generic score.

Purpose categories:

- `visual_presentation`
- `event_layout`
- `hallkeeper_setup`
- `guest_flow`
- `accessibility_planning`
- `egress_planning`
- `pricing`
- `heritage_interpretation`
- `architectural_survey`
- `marketing_render`

Rules:

- One region can be fit for one purpose and not another.
- Certification must not imply all-purpose validity.
- Truth Mode can show purpose-specific confidence.
- Evidence Packs must declare purpose.

## 8. Documented Venue Intelligence

Documented claims are first-class evidence inputs.

Sources:

- venue policy documents
- staff-authored rules
- published website/CMS facts
- conservation/heritage notes
- accessibility notes
- inventory records
- pricing schedules
- BEO templates
- supplier rules

Mappings:

- HVET basis is `documented`.
- Venue Claim Graph records source, assertion, scope, date, reviewer, and
  staleness policy.
- Truth Mode can show "documented by venue" separately from measured or inferred
  evidence.
- Layout Evidence Packs cite documented claims as inputs.
- Event Ops Compiler uses documented rules for BEOs, hallkeeper sheets, and
  supplier packs.

## 9. Provenance Architecture

Venviewer uses three provenance layers:

1. Internal scene-native provenance graph
   - Source of truth for per-object and per-region claims.
   - Owns source artifacts, transforms, evidence refs, assertions, and
     relationships.

2. DSSE / in-toto
   - Signed process attestations for ingest, registration, reconstruction, mesh
     cleanup, splat training, package assembly, render jobs, and evidence
     generation.

3. C2PA
   - Public-facing exported artifact assertions for images, videos, PDFs, and
     similar shareable outputs.

Rules:

- C2PA is not the internal truth model.
- DSSE/in-toto prove process steps, not visual correctness.
- glTF/OpenUSD metadata carry interchange references.
- Truth Mode projects internal provenance into human-readable form.

## 10. OpenUSD Truth Layering

OpenUSD is export/interchange, not Venviewer's internal source of truth. VSIR
and the Venue Claim Graph remain canonical.

USD layers may mirror:

- base capture layer
- cleaned mesh layer
- hero proxy override layer
- verification layer
- presentation layer
- event proposal layer

Mapping:

- `customLayerData` carries scene-wide provenance IDs.
- Root prim `assetInfo` carries package identity and version.
- Prim `customData` carries event IDs, basis, quality state, validity, and
  evidence refs.
- Sparse overrides represent hero asset, proxy, verification, and presentation
  edits.

## 11. Scene Authority Map

Scene Authority Map owns representation routing per region, object, and purpose.

It must include:

- geometry authority
- appearance authority
- lighting authority
- physics authority
- semantic authority
- interaction authority
- export authority
- truth status
- confidence
- provenance references
- reconstruction strategy
- transform artifact reference

Scene Authority Map is not the Venue Claim Graph. It can cite claims and
provenance, but its primary job is deciding which representation is allowed to
answer which question.

## 12. Capture Control Network / Pose Authority

Capture Control Network establishes metric, repeatable, inspectable spatial
control.

Capture control sources:

- raw structured E57 poses
- Matterport API/SDK sweep poses
- COLMAP poses
- AprilTags
- ChArUco boards
- manual landmarks
- control distances
- TransformArtifacts
- capture session metadata
- known-pose COLMAP models

Pose Authority declares which source owns camera/station poses for a capture or
training run.

Priority order:

1. raw structured E57 if valid
2. Matterport API/SDK fallback
3. validated fiducial control
4. manually picked landmarks
5. COLMAP fallback
6. visual alignment only, lowest confidence

E57 inspection checklist:

- raw original E57, not re-saved
- `data3D` entries
- pose entries
- translation and rotation
- `images2D`
- `associatedData3DGuid`
- `sphericalRepresentation`
- warning if only `visualReferenceRepresentation`
- warning if flattened cloud only

Feeds:

- Pose Authority
- TransformArtifacts
- T-091B alignment
- Truth Mode
- Black Label capture certification
- annual refreshes

## 13. Fiducial / Black Label Capture Protocol

High-tier repeatable capture needs control that survives refreshes.

Doctrine:

- two-pass control workflow
- AprilTags for roomwide control
- ChArUco for local precision
- control pass, then clean pass
- no physical attachment to heritage fabric
- required where repeatable control matters
- optional where it does not
- TransformArtifacts persist the resulting frame relationships

Black Label capture certification must be scope/purpose aware. It must not imply
all-purpose validity.

## 14. Device-Class UX Doctrine

Device classes:

- phone = review, approval, guided edits, on-site execution
- tablet = touch-first authoring and presentation
- desktop = dense power-user work

Rules:

- same canonical data, different surface grammar
- no dead-end surfaces
- phone users must not get a squeezed desktop editor
- tablet users must get a serious planning/presentation surface
- desktop remains the power editor

Follow-ups:

- pinch/two-finger pan
- mobile quality tier
- haptics
- tablet inspector
- motion/reduced-motion polish
- autosave with backoff/offline queue
- dynamic topbar sublabel
- coachmark dismissal persistence

## 15. Event Phase Graph

Events are phase graphs/timelines, not single layouts.

Core phases:

- arrival
- ceremony
- dinner
- speeches
- bar queue
- dance floor
- room flip
- breakdown

Each phase may have:

- layout snapshot
- guest/staff goals
- furniture state
- lighting state
- evidence checks
- replay scenario
- ops tasks

Links:

- Grand Assembly can visualize phase transitions.
- Guest Flow Replay runs scenario instances against phase snapshots.
- Event Ops Compiler uses phase tasks and staff routes.
- Venue Memory learns comparable phase outcomes.
- Layout Evidence Packs attach evidence to immutable phase snapshots.

## 16. Layout Proof Object / Layout Evidence Pack

Layout Proof Object is the internal replayable evidence package for one
immutable layout snapshot. Layout Evidence Pack is the safer customer-facing v0
term. "Compliance credential" is deferred and must remain qualified.

Core doctrine:

- AI generators are untrusted proposers.
- Deterministic validator kernel is trusted.
- Validators produce witness blocks.
- Proof objects cite policy bundles and scenario assumptions.
- Evidence becomes stale when layout, venue, policy, validator, or assumptions
  change.
- Public UI must not overclaim legal, fire, accessibility, or heritage
  certification.

Layer model:

- canonical layout snapshot
- policy/rule modules
- deterministic validator kernel
- domain witness blocks
- Layout Proof Object / Evidence Pack
- future attestation envelope / DSSE / in-toto / VC / C2PA

## 17. Assumption Ledger

Every Layout Evidence Pack, Guest Flow Replay, pricing proposal, constraint
check, and operational output must carry an Assumption Ledger.

Categories:

- attendance
- event mode
- time window
- door/exits availability
- staff availability
- furniture inventory
- service rate
- accessibility
- policy/rule
- venue operating rule
- pricing
- simulation
- capture/geometry

Required fields:

- `assumptionId`
- `category`
- `statement`
- `source`
- `assertedBy`
- `confidence`
- `effectiveFrom` / `effectiveTo`
- `usedBy`
- `staleWhen`
- `requiresHumanReview`

## 18. Evidence Readiness Gate / Data Sufficiency Contract

No check, simulation, or evidence output may silently convert missing data into
pass/fail.

Missing or unsupported data yields:

- `unsupported_request`
- `not_checked`
- `degraded_evidence`
- `requires_human_review`

Applies to:

- Deterministic Validator Kernel
- Scotland Policy Bundle
- Guest Flow Replay
- Lighting Context
- Residual Capture
- Truth Mode
- Event Ops Compiler

## 19. Review Gate Engine

Human/professional review is an explicit output, not an afterthought.

Triggers:

- required venue data missing
- near-threshold results
- historic stairs/protected doors
- partial accessible route
- temporary structure
- protected heritage zone
- venue policy requires staff review
- guest flow assumptions incomplete
- fire/egress claim exceeds planning-evidence scope

Outputs:

- `requires_human_review`
- `review_reason`
- `required_reviewer_role`
- `required_data`
- blocking / non-blocking
- `messageKey` / `messageArgs`

## 20. Human Review Overlay

Human and professional decisions sit on top of machine evidence. They do not
mutate machine witnesses.

Fields:

- reviewer role
- decision
- reason
- timestamp
- scope
- expiry if relevant

The overlay can support, contest, supersede, or publish a claim. It must remain
separate from deterministic witness output so machine results stay replayable.

## 21. Deterministic Validator Kernel / venkernel

`venkernel` is the trusted computational core.

Doctrine:

- pure TypeScript
- isomorphic browser/server
- fixed-point integer millimetres
- no floats in rule path
- no Z3, OR-Tools, or Recast in v0 acceptance path
- data-only policy bundles
- no arbitrary JS policy execution
- small trusted kernel
- deterministic canonicalization
- witness blocks
- content-addressed outputs

V0 checks:

- capacity arithmetic
- forbidden zones / heritage zones
- object collision / clearance
- egress width
- budget
- submitted-route or explicit-graph validation only

Boundary:

- route validation is v0
- route finding is v1+

Kernel emits:

- `messageKey`
- `messageArgs`
- `facts`
- `derivation`
- `policyRefs`
- `snapshotRefs`

Human prose lives outside the kernel.

## 22. Evidence Explanation Template Catalog

Human-readable evidence explanations are rendered outside trusted witnesses.

Template catalog fields:

- messageKey registry
- messageArgs schema
- user-facing template
- technical template
- locale
- severity wording
- claim-language guardrail

Reason:

- proof hashes remain stable
- localization does not change proof output
- wording changes do not alter validation results
- trusted kernel stays small and deterministic

## 23. Frozen Evaluation Context

Every proof/evidence run freezes:

- currency
- unit system
- timezone assumptions
- policy version
- feature flags
- tolerance model
- locale-independent message keys
- validator version

No hidden wall clock, timezone, randomness, or background fetch may enter a
verdict path.

## 24. Rule Dependency Graph

Rule dependencies must be explicit and stable.

Doctrine:

- explicit dependencies preferred over arbitrary weights
- stable rule order
- derived facts versioned
- review gates may depend on rule outputs
- no circular dependencies

## 25. Proof Witness vs Telemetry Sidecar

Separate:

- deterministic witness / proof object
- non-deterministic telemetry / performance / log sidecar

Rule:

No wall-clock timings, runtime timings, performance data, random diagnostics, or
non-deterministic process details inside proof hashes.

## 26. Geometry Approximation Policy

Visual geometry and proof geometry can differ only with explicit approximation
metadata.

Approximation kinds:

- exact footprint
- conservative bounding box
- oriented bounding box
- capsule/clearance hull
- convex hull
- AABB approximation
- unsupported geometry

Rules:

- safety/clearance checks use conservative over-approximation
- unsupported geometry yields `unsupported_request`
- Truth Mode and Evidence Packs disclose approximation

## 27. Operational Geometry Compiler

The Operational Geometry Compiler converts canonical layout/room data into
deterministic operational geometry.

Outputs:

- room polygons
- obstacle polygons
- doors/portals
- queue zones
- spawn zones
- goal zones
- staff-only zones
- service zones
- walkable area
- route graph / connector graph where available

Consumers:

- Deterministic Validator Kernel
- Guest Flow Replay
- Layout Evidence Pack
- Event Ops Compiler
- Hallkeeper Sheet
- Truth Mode

## 28. Venue Local CRS / Operational Projection

Operational geometry needs a venue-local coordinate reference, not ad hoc screen
or render coordinates.

Fields:

- local metric coordinate system
- floor/level ID
- projection method
- transform to/from canonical venue frame
- units
- axis orientation
- precision/tolerance

Feeds:

- 2D planner
- validator kernel
- Guest Flow Replay
- route checks
- operational geometry

## 29. 2.5D Event Object Semantics

Event objects need operational semantics beyond visual mesh.

Metadata:

- footprint
- height
- top elevation
- load estimate
- heat output
- temporary structure flag
- stage/platform flag
- rigging requirement
- floor-loading relevance
- human-review triggers

This supports validator, guest-flow, hallkeeper, and regulatory review paths
without pretending the visual mesh is sufficient.

## 30. Regulatory Trigger Tags

Regulatory trigger tags create review gates, not software certification.

Tags:

- `raised_structure`
- `stage_platform`
- `truss_rigging`
- `heat_source`
- `fabric_drape`
- `heavy_load`
- `cable_crossing`
- `external_catering_equipment`
- `heritage_contact_risk`

## 31. Utility & Cable Routing Layer

Future Event Ops doctrine needs a utility and cable routing layer.

Concepts:

- power points
- AV ports
- cable routes
- trip-hazard crossings
- cable mats
- speaker/projector lines
- service/bar power
- vendor equipment feeds

This layer supports Event Ops Compiler, Hallkeeper Sheet, supplier packs, and
review gates.

## 32. Scotland / UK Policy Bundle v0

Scotland/UK policy bundles produce planning evidence only.

They are not:

- Fire Risk Assessment
- Building Standards verification
- Listed Building Consent determination
- Equality Act compliance sign-off
- statutory approval

Mechanizable v0:

- capacity benchmark
- basic egress geometry
- accessibility geometry
- protected-zone / heritage overlays
- operational rule checks
- budget

Human/professional review:

- final safe capacity
- fire risk assessment
- heritage significance / consent
- reasonable adjustments
- operational management
- authority acceptance

## 33. Policy Wording Registry / Rule-Owned Wording

Every rule should carry:

- technical message
- customer-safe wording
- forbidden wording
- citation text
- required disclaimer
- review wording

Safe terms:

- planning evidence
- indicative
- supplied layout
- stated assumptions
- review recommended
- geometric pathway visualization

Forbidden unless professionally supported:

- certified
- approved
- legally compliant
- safe evacuation
- fire approved
- structural certification

Disclaimers are not enough. Safe wording must be enforced by rule-owned
templates.

## 34. Planning Evidence Disclosure

Evidence artifacts need purpose-fit disclosures and watermarks.

Where disclosures appear:

- Layout Evidence Pack
- Guest Flow Replay
- Flow Evidence Pack
- PDF exports
- Truth Mode
- proposal share pages
- `.venreplay` viewer

Example:

`Planning evidence - not a fire-safety assessment.`

## 35. Venue Data Request Pack

Venue Data Request Pack is the structured onboarding artifact for venue-supplied
facts.

Sections:

- room capacities by event mode
- authority/licensing notes
- exits/door widths
- stair/lift/ramp dimensions
- accessible WC/refuge points
- hearing loop/accessibility facilities
- fire strategy / evacuation notes if available
- heritage protected zones/surfaces
- no-drill/no-fix/no-load rules
- furniture inventory
- table/chair dimensions
- bar/service/catering positions
- supplier/load-in routes
- BEO templates
- staffing assumptions
- pricing schedule if relevant

For each field:

- required / optional / human-review-only
- source type
- provider
- whether it becomes a documented claim
- staleness policy

## 36. Guest Flow Replay / venreplay

Internal term: Crowd Simulation Replay Bundle.  
Safer customer-facing v0 language: Guest Flow Replay / Flow Evidence Pack.  
Artifact family: `.venreplay.zip`.

Scenario selection:

- data-gated
- bar queue first if Saloon/bar/door/service assumptions are verified
- guest arrival first/fallback if vertical access/arrival data is stronger
- room flip later
- egress only as non-certification analysis mode

Replay authority modes:

- `recorded_trajectory`
- `deterministic_recipe`
- `live_preview`
- `video_render`

Browser RVO2:

- preview/research only unless determinism is proven

JuPedSim:

- stronger evidence-path candidate
- queue/waiting support promising
- worker/job boundary preferred

`.venreplay.zip` contents:

- `manifest.json`
- `geometry.geojson`
- `scenario.json`
- `agents.csv`
- `trajectory.csv`
- `metrics.json`
- `bottlenecks.geojson`
- `witness.json`
- optional `scene.glb`

## 37. Guest Flow Scenario Data Contract

Bar queue requires:

- bar location
- service points
- service rate assumptions
- queue zone
- portal/door width
- post-speech demand curve

Guest arrival requires:

- entrance path
- stair/lift connectors
- arrival curve
- hall-door distribution
- accessible connector assumptions

Room flip requires:

- phase graph
- staff routes
- holding zones
- furniture state transitions
- timing assumptions

Missing required data yields data sufficiency outcomes, not confident evidence.

## 38. Scenario Template vs Scenario Instance

Scenario Template:

- reusable scenario type
- declares geometry classes, assumptions, default profiles, measurement
  definitions, output metrics, and witness integration

Scenario Instance:

- specific run against layout hash, assumptions, seed, simulator version, output
  trajectories, metrics, and witness block

## 39. Multi-Seed Evidence Summary

Multi-seed summaries aggregate scenario instances without hiding variance.

Metrics:

- P50/P95 arrival time
- last-agent time
- peak queue length
- worst portal frequency
- density hotspot frequency
- wheelchair route time distribution
- conflict seconds distribution

If seed variance changes the operational conclusion, the result becomes
degraded evidence or requires review.

## 40. PET / Metric Naming Guard

Adopt PET as the route-conflict metric name.

Safe wording:

- operational flow indicator
- route conflict indicator
- comfort/congestion warning
- planning evidence

Avoid:

- safe
- unsafe
- evacuation certified
- fire-approved
- guaranteed

## 41. Simulation Job Boundary

Simulation execution is isolated from the API request lifecycle.

Boundary:

- Fastify enqueues job
- worker runs simulator
- object storage stores replay bundle
- API reads completed artifact
- statuses are `queued`, `running`, `done`, `error`
- retry/timeout policy required
- tool/version/license provenance required

Reasons:

- keeps API responsive
- isolates Python/LGPL/native dependencies
- improves reproducibility
- makes engine swap possible

## 42. Flow Zone Authoring Layer

Flow zones are venue-authored operational annotations, not hidden simulation
config.

Kinds:

- room
- obstacle
- door
- portal
- queue
- spawn
- goal
- wait_service
- staff_only
- supplier_load_in
- wheelchair_route
- holding_area

## 43. Lighting Context Package / venlight

Lighting Context Package is core infrastructure for inserted event objects.

Contents:

- baked structural lighting
- diffuse SH probe grid
- local reflection cubemaps
- direct light proxies
- contact shadows
- shadow catcher surfaces
- occlusion proxy mesh
- lighting state label
- device quality tiers
- Truth Mode caveats

Rules:

- structural mesh = lighting/occlusion truth
- splat/radiance = appearance truth
- inserted objects sample lighting context
- no full real-time GI claim
- WebGL-first; WebGPU research branch
- do not assume LightProbeGrid r183+ in the current Three 0.180 runtime
- renderer-agnostic probe data first

## 44. Probe Leakage Guard

Probe leakage guard prevents lighting interpolation from crossing physical or
semantic boundaries.

Rules:

- many room/zone volumes, not one giant building volume
- no interpolation through walls
- dense probes near transitions
- influence volumes for cubemaps
- wall-leakage test fixture

## 45. Interactive Lighting State Machine

States:

- `idle`
- `dragging`
- `settling`
- `polished`

During drag:

- cheap responsive approximation

After release:

- polish pass / contact shadow / accumulative shadow where appropriate

The UI should feel responsive first, then visually settle.

## 46. Inserted Object Lighting Provenance

Each inserted object may declare:

- `diffuse_source`
- `specular_source`
- `shadow_source`
- `approximation_level`
- `lighting_context_id`
- `lighting_authority`
- Truth Mode caveat

Lighting authority states:

- `sampled_probe`
- `local_cubemap`
- `contact_shadow`
- `direct_light_proxy`
- `unlit_preview`
- `unknown`

## 47. Residual Radiance Layer

Residual Radiance Layer is a research track, not a T-091A blocker.

Doctrine:

- one-zone prototype first
- semantic/PBR mesh authoritative
- residual subordinate, appearance-only, surface-bound where possible
- residual optional, droppable, and disableable
- MILo = geometry proxy, not final semantic/PBR mesh
- Frosting external-mesh path = promising but unverified
- Spark PLY/SPZ/RAD path promising but installed-package verification required
- residual packaged separately as droppable runtime asset

## 48. Residual Bridge Risk Register

Each research-to-runtime bridge needs a risk register entry.

Bridges:

- MILo mesh to Frosting external mesh
- Frosting PLY to Spark
- PLY to SPZ
- SPZ to Spark orientation/coordinate equivalence
- PLY/SPZ to RAD/LoD
- semantic chunking to Spark multi-asset load
- residual disablement
- SH preservation
- coordinate convention

Each bridge has:

- input
- output
- risk
- verification fixture
- fallback
- status

## 49. Residual Metrics

Split Gemini RER into:

- Gap Closure Ratio
- Residual Burden Ratio

Also define:

- Semantic Leakage
- Residual Disable Test
- edit consistency
- Truth Mode explainability

## 50. Splat Coordinate Precision Risk

Large coordinates can create quantization/precision artifacts in compressed
splat encodings.

Rules:

- use local frames per room/zone/artifact
- persist transforms to canonical venue frame
- run fixed-camera tests for PLY/SPZ/RAD conversion

## 51. Authoritative Zone Box

Authoritative Zone Box defines where an artifact is allowed to answer.

Fields:

- bbox min/max
- coordinate frame
- purpose
- provenance
- used by MILo/Frosting/Spark packaging

Any contribution outside the box is leakage unless explicitly declared.

## 52. Residual Disable Test

Required:

- mesh-only baseline remains semantically/operationally usable
- no critical geometry exists only in residual
- no event placement depends on residual
- Truth Mode explains contribution

Failure:

- residual carries essential geometry
- residual hides missing mesh authority
- residual leaves ghosts after mesh edit
- residual cannot be disabled without breaking planning

## 53. Fixed-Light Capture / Photometric Chain-of-Custody

Matterport is useful for geometry, scale, and appearance bootstrap. Serious
residual evaluation requires new fixed-light controlled capture.

Preferred controls:

- DSLR/mirrorless
- single prime lens
- tripod
- manual exposure / white balance / focus
- ColorChecker / grey card
- AprilTags if useful
- daylight excluded if locked evening state
- train/holdout/challenge split
- raw hashes

Appearance QA Pack:

- `lighting_state_id`
- capture date/time
- camera body/lens/settings
- grey card / ColorChecker
- flicker test
- train image list
- holdout image list
- challenge holdout list
- raw file hashes
- known issues

## 54. Verified Tool Capability Registry

External tools must be tracked by installed version and verification fixture.

Tools:

- Spark
- JuPedSim
- Frosting
- MILo
- RVO2
- SPZ
- PlayCanvas splat-transform
- Recast/Detour
- Vadere
- Pathfinder/MassMotion/AnyLogic benchmark status

Statuses:

- `verified`
- `plausible`
- `unverified`
- `false`
- `research_only`

## 55. Bridge Verification Register

Every research-to-product bridge needs:

- `bridgeId`
- input artifact
- output artifact
- claim tested
- verification fixture
- pass/fail criteria
- fallback
- status

No method moves from research to production without a bridge verification record.

## 56. License & IP Compliance Ledger

License & IP review fields:

- dependency/tool
- purpose
- license
- source URL
- production/research/benchmark status
- runtime/server/offline use
- redistribution risk
- attribution requirements
- copyleft obligations
- commercial restrictions
- acquisition-risk note
- approved/blocked/research-only status

Policy:

- research tools may not become production dependencies without review
- LGPL/native/Python/commercial tools isolated where appropriate
- generated artifacts record tool/version/license provenance

## 57. Research Ingestion Guard / Venue Fact Verification Gate

Methodology can be adopted while venue facts are rejected.

Venue-specific facts require verification before use in:

- public copy
- policy bundle
- evidence pack
- Truth Mode fixture
- venue onboarding data

Fields:

- source
- venue identity
- verified_by
- confidence
- date
- status

Australian Trades Hall / Solidarity Hall facts must not be applied to Trades
Hall Glasgow without venue-specific verification.

## 58. Claim-Aware Copy Guard

Claim classes:

- public claim
- evidence-backed claim
- aspirational claim
- forbidden claim
- conditional claim
- internal-only claim

Public copy should eventually be linted/generated against active
claims/evidence.

## 59. Exposure Tier

Exposure tiers:

- `internal_only`
- `partner_preview`
- `authenticated_client`
- `investor_demo`
- `expert_review`
- `public_marketing`
- `published_case_study`

Rules:

- `internal_only` cannot live under `public/`
- `public_marketing` requires claim guard
- `partner_preview` requires auth or controlled access
- `published_case_study` requires evidence review

## 60. Venviewer Artifact Registry

Shared artifact fields:

- `artifactId`
- `artifactType`
- `schemaVersion`
- `purpose`
- `sourceInputs`
- `contentHash`
- `createdAt`
- `createdBy`
- `exposureTier`
- `freshnessState`
- `associatedClaims`
- `associatedEvidence`
- `runtimeCompatibility`
- `exportSafety`
- `knownLimitations`

Artifact families:

- `runtime_package`
- `layout_evidence_pack`
- `scene_authority_map`
- `transform_artifact`
- `lighting_context_package`
- `photometric_capture_pack`
- `residual_radiance_asset`
- `venreplay_bundle`
- `policy_bundle`
- `witness_block`
- `proof_object`
- `truth_mode_report`
- `openusd_export`
- `khr_gltf_export`
- `c2pa_manifest`
- `dsse_attestation`

The registry governs outputs and packages. It does not displace VSIR.

## 61. Internal Engine Names

Internal subsystem names:

- `venkernel` = deterministic validator kernel
- `venreplay` = guest/crowd flow replay system
- `venlight` = lighting context / inserted-object lighting system

These are not package names yet. Package creation requires a separate ADR/task.
Public product language remains Venviewer.

## 62. Authoring Constraint Layer

The Authoring Constraint Layer is live editor guidance.

Rules:

- live editor constraints guide or prevent bad placement
- Validator Kernel produces replayable evidence for immutable snapshots
- live warnings are not proof objects

## 63. Severity Split

Separate editor severity from evidence severity.

Editor severity:

- allow
- warn
- block

Evidence severity:

- info
- advisory
- warning
- requires_human_review

A venue no-place zone can hard-block authoring without claiming legal
certification.

## 64. Causal Repair Hint Schema / AI Repair Loop

AI repair loop:

1. AI proposes.
2. Kernel checks.
3. Witness gives structured facts.
4. Repair hint renderer produces AI/human guidance.
5. AI revises.
6. Kernel rechecks.
7. Final output is evidence-backed or requires review.

Repair hint examples:

- move object X by N mm
- widen aisle by N mm
- remove object from protected zone
- reduce attendee count or change event mode

Repair-hint rendering is outside the trusted kernel.

## 65. Seeded Truth Mode Pilot Fixture

Non-production fixture to test Truth Mode before full T-091:

- verified region
- stale claim
- proxy asset
- AI/proposed object
- unknown area
- measured_empty route
- contested claim

The fixture must not be used as public evidence or customer proof.

## 66. measured_empty Operational Doctrine

`measured_empty` means an observed clear/free region at represented time.

Distinctions:

- `unknown` = not observed / insufficient evidence
- no object in layout = absence in layout, not observed physical emptiness

Use cases:

- egress route trust
- wheelchair route trust
- staff/catering route trust
- load-in clearance
- dance floor clear zone
- Guest Flow Replay

Decay:

- expires faster than permanent architecture
- expires on layout change / capture refresh
- can be hallkeeper verified

## 67. Public/P0 Priority Reminder

All doctrine in this document is subordinate to current P0/T-091 execution.

Priority order:

1. P0 public trust exposure / private brief / unsupported claims
2. T-088 invitation-before-user
3. T-089 upload authorization scoping
4. T-091A real Trades Hall splat loads
5. T-091B mesh/splat alignment
6. T-091C Truth Mode v0
7. T-091D Hero Regions
8. T-091E signed runtime package

Do not let new research displace these priorities. Grand Assembly, residual
radiance productionization, guest-flow simulation, regulatory evidence, and
advanced artifact governance remain subordinate until the P0 and T-091 path is
safe.
