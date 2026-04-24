# ADR-003 — Five-asset Genjutsu pipeline
Status: Accepted. Date: 2026-04-23.

Every venue's photographic-mode runtime scene is composited at render
time from five assets:
1. **Panoramas** — primary texture source, projected onto OBJ
2. **OBJ mesh** — invisible geometric substrate, holds projection +
   furniture
3. **Gaussian splat** — view-dependent overlay (reflective surfaces
   only)
4. **E57 LiDAR** — measurement reference only, never rendered
5. **COLMAP camera poses** — canonical coordinate frame

Composite happens at render time in the browser via Three.js + Spark +
custom shaders. Assets are NOT merged into a single file server-side.
This is additive to the existing parametric/schematic rendering —
photographic mode is a new render layer, not a replacement (see ADR-007).

Why:
- Each asset is best-in-class at one thing: panos give photographic
  fidelity, splat gives view-dependent sparkle, OBJ gives collision
  and furniture placement, E57 gives survey-grade measurements,
  COLMAP gives precise pose registration
- Attempting to bake them into one file loses the view-dependent
  behaviour of the splat
- Runtime compositing allows per-camera-mode asset selection (ADR-007)

Consequences:
- A Council persona (Mr. Genjutsu, in `.claude/council/MR_GENJUTSU.md`)
  owns the runtime composite architecture
- Renderer (Squad, in `.claude/squad/RENDERER.md`) is the tactical
  implementer
- `AssetVersion` entity in SCHEMA tracks each asset independently with
  hash, format, training config, eval scores (entity not yet in schema;
  additive future work)
- Mr. Pixel's pipeline (capture → mesh → packaging) stops at stage 3;
  Mr. Genjutsu owns stage 4+
- CloudCompare ICP alignment between OBJ and COLMAP coordinate frame
  is a hard prerequisite (<5mm RMS); without it projection misaligns
  and the illusion collapses
- ADR-004 (projective texturing) and ADR-005 (splat cropping) are
  consequences of this decision

Supersedes: none.
