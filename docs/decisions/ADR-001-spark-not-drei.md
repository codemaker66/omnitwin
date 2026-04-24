# ADR-001 — Spark not drei for Gaussian splats
Status: Accepted. Date: 2026-04-23.

Production Gaussian splat renderer is Spark 2.0 (`@sparkjsdev/spark`).
drei's `<Splat />` from `@react-three/drei` is banned.

Why:
- Spark's `SplatMesh` extends `THREE.Object3D`, enabling hybrid
  splat-and-mesh rendering natively in the scene graph
- Spark handles spherical-harmonic-correct object-space transforms;
  drei's Splat does not
- Spark supports SPZ format (our production splat format); drei's
  Splat assumes .ply
- GaussianSplats3D (mkkellogg) is deprecated by its own author in
  favor of Spark
- drei's Splat is a prototyping tool with no LOD, no compositing,
  no SH-aware transforms

Consequences:
- Three.js ≥ 0.180 required (ADR-002)
- `.claude/gotchas/spark-vs-drei-splat.md` enforces this at review time
- Any splat-rendering PR is instantly reviewable: did the author import
  `SplatMesh` from `@sparkjsdev/spark` or `Splat` from
  `@react-three/drei`? The latter is a block.

Supersedes: none.
