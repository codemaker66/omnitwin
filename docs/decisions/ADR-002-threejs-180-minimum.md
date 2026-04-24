# ADR-002 — Three.js ≥ 0.180 required
Status: Accepted. Date: 2026-04-23.

Venviewer's minimum Three.js version is 0.180.0. The codebase is
currently on 0.170.0; upgrade is required before any Spark
integration work begins.

Why:
- Spark 2.0 (ADR-001) depends on Three.js 0.180+ APIs for SplatMesh
  integration and the updated renderer pipeline
- R3F 8.17 is compatible with Three 0.170; R3F 9.x supports Three
  0.180+
- Delaying the upgrade makes the upgrade harder every week as other
  deps drift

Consequences:
- Upgrade is a pre-requisite for ADR-004 (projective texturing) and
  ADR-007 (three camera modes) implementation work
- Upgrade likely forces R3F 8 → 9 migration in parallel
- Pre-Spark tasks can proceed on 0.170; any splat-rendering or
  hybrid-scene task must wait for the upgrade to land

Supersedes: none.
