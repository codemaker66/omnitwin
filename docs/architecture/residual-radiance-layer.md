# Residual Radiance Layer over Semantic PBR Meshes

Status: research track
Date: 2026-04-30
Source: RRL-DR-2026-04-30
Depends on: D-005a, D-009, D-011, D-012, D-014, D-019, D-024, Truth Mode doctrine

## Position

The Residual Radiance Layer is a Venviewer research track, not a production gate.

It does not block T-091A. The production T-091 path remains:

- Spark + SPZ splat runtime for the first real Trades Hall radiance asset.
- Structural mesh for room shell, collision, editing, measurement context, and fallback rendering.
- Truth Mode for explaining what is measured, inferred, generated, proxy, splat-authoritative, or unknown.
- Hero Region Specialists for chandeliers, stained glass, mirrors, ornate plaster, dome/frieze, carved wood, and other difficult fixtures.

A Residual Radiance Layer is a future appearance-enhancement layer bound to an explicit semantic/PBR venue mesh. The mesh remains the operational truth. The residual restores view-dependent appearance, high-frequency visual detail, soft lighting effects, stained-glass/chandelier atmosphere, and appearance energy the PBR mesh cannot explain.

## Core Doctrine

- The semantic/PBR mesh is authoritative for geometry, semantics, collisions, layout constraints, editing, measurement, and exports.
- The residual is subordinate and appearance-only unless a future ADR explicitly grants it another authority.
- The residual should be surface-bound wherever possible.
- The residual inherits semantic region and object identity from the mesh; it must not create an untracked alternate semantic scene.
- The residual must be visible and explainable in Truth Mode.
- The residual must be droppable under performance pressure without breaking the core venue planning experience.
- The residual must not be required for operational exports, fire/egress checks, collision, measurement, or standards interchange.

This doctrine extends D-005a's `ResidualAppearance` role with a more specific research hypothesis: learned residuals over explicit semantic/PBR meshes may give Venviewer photoreal venue feel without surrendering geometry and operations to an opaque radiance field.

## Authority Boundary

Scene Authority Map entries must keep the boundary explicit:

| Concern | Default authority |
|---|---|
| Geometry | Semantic/PBR mesh or approved hero proxy |
| Semantics | Venue graph / semantic mesh labels |
| Physics/collision | Mesh or reviewed proxy bounds |
| Interaction/editing | Mesh/proxy entities |
| Measurement/layout constraints | Mesh and D-011 confidence budget |
| Export/interchange | Mesh/PBR/VSIR export targets |
| Appearance/radiance | Splat, PBR material, lightmap/probe, or declared residual layer |

A residual may be declared as `appearance_authority` or partial `lighting_authority` for a region, but it must not silently become `geometry_authority`, `semantic_authority`, `interaction_authority`, or `export_authority`.

## Binding Strategies

Residuals should bind to explicit mesh semantics first. Allowed binding strategies:

| Binding strategy | Use |
|---|---|
| Mesh triangle ID | Most direct surface binding when mesh topology is stable. |
| Barycentric coordinate | Stable point-on-triangle attachment for learned appearance samples. |
| UV coordinate | Texture-space attachment when UVs are stable and reviewed. |
| Local tangent frame | View-dependent or anisotropic effects tied to a surface normal/tangent basis. |
| Region ID | Coarser binding to Scene Authority Map regions when per-triangle identity is too brittle. |
| Semantic class | Class-level residual policy for materials such as stained glass, crystal, polished metal, or curtains. |
| Approved free-space splat | Fallback only for explicitly approved classes where surface binding is unsuitable, such as chandelier sparkle, thin transparent decor, stained-glass glow, or atmospheric radiance. |

Free-space residuals are the exception. They require an explicit Scene Authority Map declaration, a semantic class, provenance, and Truth Mode labelling.

## Composition Strategy

Additive residual is the default first implementation. It should add missing view-dependent radiance or high-frequency appearance to a mesh/PBR baseline, not replace the baseline.

Alpha-over residual is allowed only for special semantic classes:

- Curtains and thin textile decor.
- Chandeliers and crystal pendants.
- Thin fixtures.
- Transparent or semi-transparent decor.
- Stained-glass glow.

Residuals must not silently carry the whole scene. A valid residual should leave a useful venue planning experience when disabled. If disabling the residual collapses walls, floors, furniture meaning, or operational readability, the residual is doing more than residual appearance work and the experiment fails.

## First Prototype Scope

The first prototype should be deliberately narrow:

- One venue zone, not the full Trades Hall.
- Fixed lighting.
- Explicit semantic/PBR mesh.
- Mesh-only baseline.
- Mesh plus residual comparison.
- One object insertion demo.
- Optional limited discrete lighting states only after the fixed-light comparison is understood.

The object insertion demo is load-bearing. It tests whether the residual behaves as an appearance layer over a mutable planning scene rather than as a hidden full-scene renderer that leaves ghosts when an object moves or disappears.

## Research Candidates

The research track may evaluate:

- MILo.
- Gaussian Frosting.
- SuGaR.
- 2DGS.
- NVDIFFREC / NVDIFFRECMC.
- MaterialFusion-style priors.
- Neural texture / deferred neural shader.
- Probe-grid / GBake-style object insertion.
- Local HDR probe / LightHarmony-style insertion research.

These are candidates, not commitments. The implementation route must be chosen by measured prototype results, browser feasibility, and Truth Mode explainability.

## Browser and Runtime Position

- Spark/SPZ remains the production runtime path.
- Residual runtime experiments may use Spark custom shaders, WebGPU, or offline baked textures.
- Do not assume custom Spark shader support until it is verified against the real Spark 2 API and browser constraints.
- The structural mesh must always remain available as a fallback.
- Residual chunks should be streamable, quantized, and droppable.
- Mobile and tablet performance targets matter. A residual that only works on a workstation is research output, not a production venue runtime.

## Metrics

Standard visual metrics:

- PSNR.
- SSIM.
- LPIPS.

Residual-specific metrics:

- Residual energy ratio: how much of the scene's visible appearance is carried by the residual rather than the mesh/PBR baseline.
- Semantic leakage: whether residual samples cross region or object boundaries without authorization.
- Edit consistency: whether moved, hidden, or deleted objects leave visual ghosts.
- Object insertion realism: whether an inserted object sits plausibly in the lighting/radiance context.
- Runtime FPS on target desktop, tablet, and phone classes.
- Memory footprint.
- Asset size.
- Truth Mode explainability: whether a user can inspect what the residual contributes and why.

## Failure Gates

An experiment fails if:

- The residual carries most of the scene.
- Moving or deleting a mesh object leaves obvious visual ghosts.
- The residual crosses semantic boundaries without authorization.
- The residual cannot be disabled while retaining a useful venue planning experience.
- Browser performance collapses on target devices.
- Truth Mode cannot explain what the residual is doing.

These gates are intentionally harsh. A beautiful but opaque residual layer is not enough for Venviewer because venue planning depends on operational truth, editing, measurement, and trust.

## Fallback Ladder

Plan A: surface-bound residual / Gaussian Frosting-style layer.

Plan B: pure Frosting / appearance splat layer with mesh for structure.

Plan C: PBR-only mesh with lightmaps and probes.

Plan D: VFX-style hybrid where splats provide hero visualization and mesh/PBR handles interaction, constraints, collision, measurement, and exports.

Plan D is acceptable when labelled honestly. It is better to be explicit about a hybrid than to pretend a research residual has become operational truth.

## Truth Mode Requirements

Truth Mode must be able to show:

- The mesh or proxy that owns geometry.
- The residual layer that owns appearance, if any.
- Binding strategy and semantic class.
- Whether residual contribution is additive or alpha-over.
- Residual source/provenance.
- Verification state and confidence band.
- Whether the residual is droppable in the current runtime quality tier.
- Known issues such as ghosting, semantic leakage, or unsupported lighting changes.

Normal users should not see raw residual diagnostics by default. Planner and client views need plain language such as "appearance-enhanced from learned residual" or "mesh-authoritative, residual appearance only." Developer/QA views can expose metrics and residual maps.

## Relationship to Existing Architecture

- D-005a defines the generic view-dependent residual role.
- D-009 defines the typed spatial-layer graph and `ResidualAppearance` family.
- D-011 defines the confidence budget that residual experiments must report against.
- D-012 defines the truth/imagination/provenance separation.
- D-014 defines the signed artifact bundle boundary.
- D-019 defines the VSIR-0 concrete schema posture and header-in-DB/body-in-file payload split.
- D-024 defines Scene Authority Map routing and TransformArtifactV0 references.
- Truth Mode doctrine defines how users inspect source, verification, confidence, staleness, provenance, and authority.

This document adds research direction only. It does not implement runtime code, database schema, Spark shaders, WebGPU code, C2PA, package renames, or public marketing copy.

## Backlog

- T-137: Residual Radiance Layer doctrine and backlog research track.
- T-138: Fixed-light zone prototype plan.
- T-139: MILo / Gaussian Frosting / Spark feasibility spike.
- T-140: Semantic PBR mesh / NVDIFFRECMC experiment.
- T-141: Object insertion probe-grid residual demo.
- T-142: Residual metrics suite.
- T-143: Spark custom residual shader feasibility.
- T-144: Neural texture / deferred shader research branch.
- T-145: Limited lighting-state residual experiment.
- T-146: Stained-glass/chandelier special-class residual policy.
