# Venviewer Replay Artifact: `.venreplay.zip`

Status: Active planning doctrine  
Date: 2026-05-01  
Source: VENREPLAY-001  
Depends on: Crowd Simulation Replay Bundle, Layout Proof Object, Canonical Layout Snapshot v0, Assumption Ledger  
Relates to: Truth Mode, Venue Memory, Event Ops Compiler, Exposure Tier

## Purpose

`.venreplay.zip` is Venviewer's native portable replay artifact for Guest Flow Replay and future crowd/flow simulations.

It is a first-class artifact family, comparable in architectural importance to RuntimePackage and Layout Evidence Pack. It packages the exact scenario instance inputs, simulator metadata, trajectories, metrics, bottlenecks, and witness material needed to replay or inspect one flow run without treating it as legal, fire, evacuation, or accessibility certification.

## Artifact Boundary

A `.venreplay.zip` represents a specific Scenario Instance, not a reusable Scenario Template.

The artifact should be:

- content-addressable
- replayable from declared inputs
- inspectable by Truth Mode and QA tooling
- attachable to a Layout Proof Object as evidence
- aggregatable by Venue Memory under a Scenario Template
- safe to expose only according to its Exposure Tier

Large raw simulator outputs may be retained internally for expert/engineering review, but they are not required in the portable v0 artifact.

## Required Contents

V0 `.venreplay.zip` contents:

- `manifest.json`
- `geometry.geojson`
- `scenario.json`
- `agents.csv`
- `trajectory.csv`
- `metrics.json`
- `bottlenecks.geojson`
- `witness.json`
- optional `scene.glb`
- optional raw simulator output stored internally only

The zip should not contain public marketing copy. Human-readable summaries can be rendered by UI/export layers from structured fields and template catalogs.

## Manifest Fields

`manifest.json` should include:

- `artifactVersion`
- `scenarioTemplateId`
- `scenarioInstanceId`
- `layoutSnapshotHash`
- `runtimePackageHash`
- `simulatorName`
- `simulatorVersion`
- `seed`
- `seedCount`
- `generatedAt`
- `assumptions`
- `limitations`
- `fileHashes`

`assumptions` may inline a compact assumption summary or reference Assumption Ledger IDs. `fileHashes` must cover every required and optional file included in the artifact.

## File Roles

| File | Purpose |
| --- | --- |
| `manifest.json` | Artifact index, version, hashes, scenario IDs, simulator metadata, assumptions, and limitations. |
| `geometry.geojson` | 2D planning geometry or flattened 2.5D navigation geometry used by the replay, including explicit vertical connectors where relevant, scoped to the layout/runtime package. |
| `scenario.json` | Scenario Instance details: template reference, spawn/destination semantics, route/navmesh references, simulator parameters, seed policy. |
| `agents.csv` | Agent list and profile assignments used in the run. |
| `trajectory.csv` | Time-indexed positions or route states used for browser replay and metrics reproduction. |
| `metrics.json` | Summary metrics such as completion time, queue length, density hotspots, bottlenecks, and warnings. |
| `bottlenecks.geojson` | Spatial bottleneck, queue, conflict, hotspot, and route-warning features. |
| `witness.json` | Layout Proof Object witness-compatible output: status, message keys, facts, derivation, policy refs, snapshot refs, limitations. |
| `scene.glb` | Optional lightweight display scene for replay inspection. Not authoritative geometry unless declared by the runtime package. |

## Versioning

`artifactVersion` identifies the `.venreplay.zip` schema version.

Versioning rules:

- Breaking file structure changes increment the major version.
- Additive optional fields increment the minor version.
- Parser/rendering bug fixes that do not alter artifact meaning increment the patch version.
- Scenario Template versions and Scenario Instance IDs are separate from artifact schema version.
- Simulator version is recorded separately and can stale an instance without changing artifact schema.

## Hash Policy

V0 hash policy:

- Each file in the zip must be individually hashed and listed in `manifest.json.fileHashes`.
- The artifact digest should be computed over a deterministic manifest plus the ordered file hash list, not over zip container metadata.
- Zip timestamps, compression level, file order, and platform metadata must not affect the logical artifact digest.
- Layout snapshot hash, runtime package hash, policy bundle digest, scenario template version, scenario instance ID, simulator version, seed, and assumptions must be part of the logical replay identity.
- Raw simulator output kept internally should have its own hash and retention reference if cited by `witness.json`, but it does not need to be embedded in the portable artifact.

## Replayability Requirements

A `.venreplay.zip` is replayable when:

- `manifest.json` validates against the artifact schema.
- Every required file exists and matches its hash.
- `scenario.json` references the same scenario template and instance as the manifest.
- `geometry.geojson` is compatible with the cited layout snapshot/runtime package.
- `agents.csv` and `trajectory.csv` can be joined deterministically.
- `metrics.json` can be traced to trajectory or simulator outputs.
- `witness.json` cites the scenario instance, layout snapshot hash, runtime package hash, assumptions, simulator version, and seed/seed set.
- Limitations are present and explicit.

Replayability means the artifact can be inspected and replayed; it does not mean the simulation is certified or universally valid.

## Relation to Layout Proof Object

`witness.json` is the bridge into Layout Proof Objects.

A Layout Proof Object may cite a `.venreplay.zip` artifact as the evidence body for a flow-related witness. The proof object should cite:

- artifact digest
- `witness.json` hash
- scenario template ID/version
- scenario instance ID
- layout snapshot hash
- runtime package hash
- policy bundle reference
- assumptions
- simulator name/version/hash where available
- seed or seed set
- limitations

The Layout Proof Object should remain valid as a proof envelope even if the large replay artifact is stored externally, provided hashes and retrieval references remain stable.

## Relation to Truth Mode

Truth Mode should use `.venreplay.zip` to inspect:

- whether a replay is current, stale, partial, or missing
- which scenario template and instance were used
- which layout/runtime/policy/assumption inputs were cited
- whether one seed or multiple seeds were used
- multi-seed summary, spread, worst case, and whether seed variance changes the conclusion
- which limitations apply
- whether outputs are simulation/planning evidence, not observed venue reality
- bottleneck and route-warning geometry
- witness status and human-review requirements

Normal users should see compact Guest Flow Replay summaries. Expert/QA users can inspect raw files, hashes, trajectories, metrics, witness blocks, and limitations.

## Relation to Venue Memory

Venue Memory should aggregate `.venreplay.zip` artifacts by:

- venue and space
- scenario template ID/version
- comparable assumptions
- layout mode/event mode
- runtime package or geometry generation
- simulator family/version
- key metric families

Past artifacts become learning examples and operational heuristics. They must not become blanket guarantees for future layouts or events.

## Limitations and Disclaimers

Every `.venreplay.zip` must carry limitations.

Required limitations include:

- simulation is planning support, not statutory approval
- no legal evacuation certification
- no fire-approved claim
- no accessibility approval unless separately reviewed by qualified professionals
- output depends on assumptions, geometry, simulator version, seed policy, and scenario template
- stale inputs stale the replay evidence
- multi-seed summaries still require scope and uncertainty disclosure

## Exposure Tier

Most v0 `.venreplay.zip` artifacts should be `internal_only`, `expert_review`, or `authenticated_client`.

Public or published-case-study use requires claim/copy review, exposure-tier approval, and safe language. The artifact may contain technical caveats and raw metrics that are appropriate for expert review but not public marketing.

## Non-Goals

- No simulator implementation.
- No browser replay loader implementation.
- No database tables.
- No zip writer/parser dependency adoption.
- No legal, fire, evacuation, or accessibility certification.
- No public marketing copy changes.
