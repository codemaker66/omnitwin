**Read this when:** adding any drei or postprocessing effect that renders the
scene to an off-screen target (`ContactShadows`, `Environment` with a cubemap
probe, reflection/refraction probes, `useFBO`-based effects, EffectComposer
passes) into a scene containing a Spark `SplatMesh` / `SparkSplatLayer` — or
debugging a splat scene whose floor/foreground erupts into unsorted colour
blobs after an unrelated visual addition.

# Render-target effects corrupt Spark's splat sorting

Spark manages its own Gaussian sort and depth handling. An effect that renders
the scene to an off-screen target inserts an extra render pass with different
camera/target state, and the splat sort that Spark prepared for the main pass
is consumed/invalidated by the off-screen pass. The visible result is not a
subtle artefact: near-camera splats break into unsorted multicoloured blobs
and bright regions blow out.

This is the same family as the repo's core rule "never drei `<Splat/>`"
(`.claude/gotchas/spark-vs-drei-splat.md`): drei's render-target machinery and
Spark's renderer-host assumptions do not compose.

## Observed reproduction (2026-08-06)

In a Vite harness rendering the eight real Reception Room tiles
(`/splats/reception/*.sog`) through `SparkSplatLayer` with catalogue furniture:

- Baseline: room rendered correctly (`scene-state: live`, all 8 tiles).
- Added `<ContactShadows position={...} scale={7} resolution={1024} ...>` from
  `@react-three/drei` 9.122.0 (three 0.180.0) to ground the furniture.
- Result: the captured floor in the near field broke into unsorted colour
  blobs; the ceiling region blew out. Removing `ContactShadows` (and only it)
  restored the correct render on the next run.

Screenshots lived in the session scratchpad (`recept-lit.png` = correct,
`recept-grounded.png` = corrupted) and were shown to Blake in-session on
2026-08-06; they were not persisted into the repo. Status: reproduced once,
deterministically (add → broken, remove → fixed), not yet captured as a
committed regression test. Treat as verified-by-reproduction,
unverified-by-CI.

## What to do instead

Grounding shadows / reflections in a splat scene must cost **no extra scene
pass**:

- a baked shadow-catcher plane (pre-authored texture) under dynamic objects;
- shadows composited into the splat asset itself at build time;
- for reflections/probes: pre-baked environment maps, never live probes.

If an effect seems to require a live render target in a Spark scene, that is a
design smell — take it to the scene-architecture level (separate overlay
canvas, or bake) rather than fighting the sort.
