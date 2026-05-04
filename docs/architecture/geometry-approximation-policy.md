# Geometry Approximation Policy

Status: Active planning doctrine  
Date: 2026-05-01  
Source: GAP-001  
Depends on: Layout Evidence Pack, Operational Geometry Compiler, Planning Evidence Disclosure, Purpose-Fit Evidence  
Relates to: Deterministic Validator Kernel, Truth Mode, Scotland Policy Bundle, Flow Zone Authoring Layer, Hallkeeper Sheet

## Purpose

The Geometry Approximation Policy governs when proof/evidence geometry may differ from visual planner geometry.

The visual planner may support round tables, arbitrary rotations, curved features, grouped furniture, ornamental geometry, and rich rendering details. The Validator Kernel v0 may need simpler proof geometry: integer-millimetre coordinates, restricted rotations, conservative bounding boxes, hulls, or explicit unsupported outcomes. That simplification is acceptable only when it is explicit, conservative where safety-relevant, and visible in Truth Mode / Layout Evidence Pack.

This document is planning doctrine only. It does not implement runtime code, validators, footprint generators, database schema, public copy, or UI.

## Core Doctrine

- Proof geometry cannot silently diverge from visual geometry.
- Every approximation must declare its approximation kind, source visual geometry reference, generated proof footprint, purpose, tolerance, and limitations.
- Safety, route, clearance, accessibility, egress-planning, and forbidden-zone checks must use conservative over-approximation unless exact geometry is available and validated.
- Capacity and space-utilization checks must disclose approximations that could materially affect counts or fit.
- Unsupported geometry must produce `unsupported_request`, `not_checked`, `degraded_evidence`, or `requires_human_review`; it must not be silently simplified into a confident pass/fail.
- Approximation metadata should appear in Layout Evidence Packs and Truth Mode when it affects evidence meaning.
- Approximation policy is purpose-fit. A visual approximation acceptable for proposal preview may be unacceptable for route-width evidence.

## Approximation Kinds

| Kind | Meaning | Typical use |
|---|---|---|
| `exact_footprint` | Proof geometry matches the validated operational footprint for the object/region. | Rectangular stage with surveyed dimensions; known table footprint. |
| `conservative_bounding_box` | Bounding box chosen to over-cover the visual/object footprint for safety or clearance checks. | Object with uncertain decorative overhang or unverified grouping. |
| `oriented_bounding_box` | Rotated rectangle aligned to object orientation. | Rotated rectangular table, bar, stage, AV riser, or sign. |
| `capsule_clearance_hull` | Capsule or inflated hull representing object footprint plus clearance/service envelope. | Queues, service aisles, chair pull-out clearance, temporary route corridor. |
| `convex_hull` | Convex polygon covering a grouped or irregular object set. | Cluster of chairs, multi-part furniture group, movable service area. |
| `aabb_approximation` | Axis-aligned bounding box in the operational frame. | v0 fallback for simple validators where rotation support is unavailable. |
| `unsupported_geometry` | Geometry cannot be represented safely for the requested evidence purpose. | Curves, complex groups, non-planar or self-intersecting objects where no conservative safe approximation is available. |

## Required Metadata

Every approximated proof footprint should eventually include:

- `visualGeometryRef`
- `proofGeometryRef`
- `approximationKind`
- `purpose`
- `sourceObjectIds`
- `coordinateFrame`
- `units`
- `tolerance`
- `isConservative`
- `conservatismDirection`
- `generatedBy`
- `generatedAt`
- `limitations`
- `truthModeLabel`
- `evidenceDisclosure`

## Rules

### Safety And Clearance

Safety, egress-planning, accessibility-planning, route-width, aisle-clearance, forbidden-zone, and staff/supplier route checks must use conservative over-approximation when exact proof geometry is unavailable.

Conservative means the approximation should not understate the space consumed by an obstacle, route restriction, or clearance envelope. If a conservative approximation cannot be generated, the output must not be a pass.

### Capacity And Space Checks

Capacity, seat count, rounds count, and space-utilization checks may use simpler geometry, but the Layout Evidence Pack must disclose approximation if it affects the conclusion.

Examples:

- A bounding box around a round table may be acceptable for aisle clearance, but it may undercount usable space if used for packing/capacity decisions.
- A cluster hull around chairs may be acceptable for clearance, but it may hide the exact chair count if used for seating evidence.

### Unsupported Geometry

Unsupported geometry yields `unsupported_request` for the requested purpose unless a lower-assurance output is explicitly allowed.

Examples:

- If a curved route boundary cannot be represented safely for a route-width check, the witness should be `unsupported_request` or `requires_human_review`.
- If a decorative visual-only object has no operational footprint, it should not participate in evidence as if it were measured geometry.

### Visual Geometry Versus Proof Geometry

Visual geometry and proof geometry can differ only with explicit approximation metadata.

The evidence system must be able to answer:

- what the user saw
- what the validator checked
- how the proof footprint was generated
- whether the approximation was conservative
- which claim families or purposes used it
- whether the approximation affects confidence, review status, or disclosure

## Examples

### Round Table

A round table may be represented as:

- `exact_footprint`: circular footprint if the validator supports circles.
- `conservative_bounding_box`: square bounding box enclosing the circle for clearance checks.
- `capsule_clearance_hull`: inflated circular/capsule hull when chair pull-out or service clearance matters.

Truth Mode / Evidence Pack should disclose if a square proof footprint was used for a visually round table.

### Rotated Rectangle

A rotated rectangle may be represented as:

- `oriented_bounding_box` when the validator supports orientation.
- `aabb_approximation` when v0 only supports axis-aligned geometry.

For clearance/safety checks, the AABB must conservatively cover the rotated object. For packing/capacity checks, the approximation must be disclosed because it may change available space.

### Grouped Chairs

Grouped chairs may be represented as:

- exact individual footprints when each chair is modeled operationally.
- `convex_hull` or `capsule_clearance_hull` for cluster-level clearance or service movement.

If the group hull hides exact chair count or exact aisle gaps, the evidence must not overclaim precision.

### Stage

A stage may be represented as:

- `exact_footprint` polygon if measured or venue-supplied.
- `oriented_bounding_box` if it is rectangular and rotated.
- `unsupported_geometry` if the visual stage has curved/complex geometry and no safe operational footprint exists.

Stage approximations should be visible to Event Ops and Hallkeeper outputs because load, access, and setup assumptions may depend on them.

## Truth Mode And Evidence Pack Disclosure

Truth Mode should expose approximation at progressive disclosure levels:

- L1/L2: compact "approximated for planning check" or "review recommended" cue when approximation affects a visible result.
- L3: approximation kind, source object, proof footprint summary, conservative flag, tolerance, limitations, and affected witness blocks.
- L4: raw approximation metadata, geometry references, hash inputs, and validator facts.

Layout Evidence Packs should cite approximation metadata in witness blocks and use Planning Evidence Disclosure where approximation affects the assurance level.

## Non-Goals

- No proof footprint generator implementation.
- No validator implementation.
- No geometry library dependency.
- No Truth Mode UI implementation.
- No runtime rendering change.
- No public copy change.
- No package rename.
