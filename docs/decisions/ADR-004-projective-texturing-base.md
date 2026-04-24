# ADR-004 — Projective texturing is the base renderer
Status: Accepted. Date: 2026-04-23.

In photographic free-fly mode, the OBJ mesh is rendered using
panoramas projected onto it as view-dependent textures, blended per
pixel from the N (typically 3–5) nearest panoramas. The OBJ's own
baked textures are never used.

Why:
- Panoramas are photographic; projected onto aligned geometry, walls
  and floors look like the actual venue
- Google Street View has used this technique for 20+ years; it is
  well-trodden
- Gaussian splats alone degrade at close range (floaters, blur);
  projection gives near-photo fidelity in the same regions the splat
  is weakest
- Matches the ADR-003 philosophy of "each asset does what it's best at"

Consequences:
- v1 projection blender is a fragment shader using distance + angular
  + normal weighting (heuristic; full spec in
  `docs/architecture/GENJUTSU.md` when written)
- v2 projection blender is a learned neural blender (R&D Direction 3;
  activated post-launch once data exists)
- Depth maps per panorama must be pre-computed server-side and stored
  on R2 per AssetVersion (for occlusion testing in the shader)
- Target cost: ~3ms per frame on M2 MacBook
- Quality bar "Photographic Everywhere": if the composite looks worse
  than a photograph from the same viewpoint, the projection blender
  or alignment is broken

Supersedes: none.
