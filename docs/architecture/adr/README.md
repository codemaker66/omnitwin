# Venviewer architecture decision records

This is the source of truth for architectural decisions. Each ADR is immutable once accepted (per D-070); revisions get new files (e.g., D-003 superseded by D-003a).

## Founding decisions (accepted 2026-04-23)

| ID | Title | Status |
|---|---|---|
| [D-001](D-001.md) | Spark, not drei `<Splat />` | Accepted |
| [D-002](D-002.md) | Three.js minimum version (target 0.180) | Accepted |
| [D-003](D-003.md) | Five-asset Genjutsu pipeline | Superseded by D-003a |
| [D-004](D-004.md) | Projective texturing as base renderer | Superseded by D-004a |
| [D-005](D-005.md) | Splat cropped to reflective surfaces only | Superseded by D-005a |
| [D-006](D-006.md) | gsplat MCMC + bilateral grid | Superseded by D-006a |
| [D-007](D-007.md) | Three camera modes, one scene graph | Accepted |
| [D-008](D-008.md) | Venue is the tenant unit | Accepted |

## Reframings (proposed 2026-04-25)

| ID | Title | Supersedes | Status |
|---|---|---|---|
| [D-003a](D-003a.md) | Layered venue radiance graph | D-003 | Proposed |
| [D-004a](D-004a.md) | Projective texturing as v1 base appearance | D-004 | Proposed |
| [D-005a](D-005a.md) | View-dependent residual layer | D-005 | Proposed |
| [D-006a](D-006a.md) | gsplat MCMC + bilateral grid with 3DGUT hedge | D-006 | Proposed |

## New decisions (proposed 2026-04-25)

| ID | Title | Status |
|---|---|---|
| [D-009](D-009.md) | Typed spatial-layer graph (VSIR-0) | Proposed |
| [D-010](D-010.md) | Pose-frame indirection | Proposed |
| [D-011](D-011.md) | Spatial confidence budget | Proposed |
| [D-012](D-012.md) | Provenance and truth-mode separation | Proposed |
| [D-013](D-013.md) | Format strategy and standards | Proposed |
| [D-014](D-014.md) | Venue Artifact Factory | Accepted |
| [D-015](D-015.md) | Capture certification tiers | Proposed |

## Operational decisions (accepted 2026-04-26)

| ID | Title | Status |
|---|---|---|
| [D-016](D-016.md) | RunPod-canonical training environment | Accepted |

## Workflow infrastructure decisions (proposed 2026-04-25)

| ID | Title | Status |
|---|---|---|
| [D-070](D-070.md) | Files in git as sole source of truth | Proposed |
| [D-071](D-071.md) | Mermaid as on-demand visualization | Proposed |
| [D-072](D-072.md) | task-master-ai not adopted | Proposed |

## Template

See [`_templates/adr-template.md`](_templates/adr-template.md) for the format.

## Status definitions

- **Accepted** — decision is current and binding.
- **Superseded by D-NNN** — replaced by another ADR; kept as historical record.
- **Proposed** — under review, not yet binding.
- **Deferred** — decision postponed; conditions for revisit noted in the ADR.
- **Rejected** — considered and rejected; kept for traceability.
