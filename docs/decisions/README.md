# Architectural Decision Records

Load-bearing decisions for Venviewer (codebase: OMNITWIN). Each ADR
is a single file. Terse by design — if a decision needs a full essay,
write it in `docs/architecture/` and link to it here.

## Format

Each ADR follows this shape:
ADR-NNN — One-line decision title
Status: Accepted | Superseded | Deprecated. Date: YYYY-MM-DD.
[One paragraph: the decision, stated clearly.]
Why:

[Reason 1]
[Reason 2]
[Reason 3]

Consequences:

[What this forces us to do]
[What this prevents]

Supersedes: ADR-NNN (or none).
Superseded by: ADR-NNN (or none).

## Index

| ADR | Title | Status |
|---|---|---|
| [001](./ADR-001-spark-not-drei.md) | Spark not drei for Gaussian splats | Accepted |
| [002](./ADR-002-threejs-180-minimum.md) | Three.js ≥ 0.180 required | Accepted |
| [003](./ADR-003-five-asset-pipeline.md) | Five-asset Genjutsu pipeline | Accepted |
| [004](./ADR-004-projective-texturing-base.md) | Projective texturing is the base renderer | Accepted |
| [005](./ADR-005-splat-cropped-to-reflective.md) | Splat cropped to reflective surfaces only | Accepted |
| [006](./ADR-006-gsplat-mcmc-bilateral.md) | gsplat with MCMC + bilateral grid for training | Accepted |
| [007](./ADR-007-three-camera-modes.md) | Three camera modes, one scene graph | Accepted |
| [008](./ADR-008-venue-as-tenant.md) | Venue is the tenant unit; no separate Tenant entity | Accepted |

## Writing new ADRs

When a new decision lands, create `ADR-NNN-kebab-title.md`, update this
index, and commit. Decisions that are superseded stay in the folder
(historical record); mark status and link to the replacement.
