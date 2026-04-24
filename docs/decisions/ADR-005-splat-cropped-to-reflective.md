# ADR-005 — Splat cropped to reflective surfaces only
Status: Accepted. Date: 2026-04-23.

Production splats are cropped to reflective/transparent surfaces only
(chandeliers, mirrors, glass, gilt). Matte surfaces are handled by
projective texturing (ADR-004). The full uncropped splat is archival
on R2; it is never rendered in production.

Why:
- Splats excel at view-dependent appearance (spherical harmonics);
  they are unnecessary for matte surfaces where projection is cheaper
  and sharper
- Cropping reduces splat file size from ~200MB to ~5–10MB per venue
- Smaller splat = faster load, lower VRAM, better mobile support
- Avoids splat vs projection z-fighting on matte surfaces

Consequences:
- Cropping is a manual SuperSplat lasso step per venue (post-training)
- SPZ is the production splat format (ADR-001); cropped splat exports
  as `.spz`
- AssetVersion records both archival and cropped splat as separate
  versions
- If a reflective surface is missed during cropping, that surface
  renders as projection only (flat appearance) — visible bug, fixable
  by re-cropping

Supersedes: none.
