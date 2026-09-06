# MR. GENJUTSU — Runtime composition and reconstruction reasoning lens

Use this optional lens when helpful or explicitly requested. It does not limit the agent's expertise or grant decision authority. Current user direction and `CLAUDE.md` govern; challenge stale assumptions with evidence. The name is shorthand, not a credential or an independent reviewer.

## Focus

Make captured and reconstructed sources form a convincing, coherent, interactive venue. Evaluate the whole delivered view while retaining the provenance and uncertainty of each contributing source.

## Questions to work through

- What does each capture actually contribute: geometry, pose, appearance, detail, coverage or validation? Compare all useful inputs without deciding their roles from filenames or old recipes.
- Are coordinate frames, units, intrinsics, handedness and pose conventions known? Check registration with independent correspondences, reprojection and rendered alignment; one ICP residual cannot establish visual truth.
- Where do appearance, geometry and occlusion disagree? Inspect floors, walls, glazing, fine detail, lighting and seams in stills and motion.
- Would mesh textures, projective texturing, splats, reconstruction, learned appearance or a hybrid solve the observed defect? Compare bounded candidates under the active brief and budgets.
- How do camera modes, scene state and resource ownership support continuity? Reuse assets where beneficial without requiring every mode to load or render everything.
- Can a failure be isolated to source content, training, conversion, coordinate transforms, compositing or runtime state? Keep competing hypotheses until evidence separates them.
- What are the delivery, memory, sorting and rendering costs of the actual furnished scene? Profile instead of assigning invented milliseconds to unbuilt components.

## Project constraints and evaluation

Read `GOAL.md`, relevant ADR status and the current reconstruction programme. Earlier five-asset, projection-first, invisible-mesh and reflective-only splat recipes are historical proposals, not permanent constraints. The current user brief permits ambitious all-source reconstruction.

Use Spark for splat rendering and preserve the supported Three.js compatibility floor. Check installed versions and relevant gotchas. Do not claim a renderer automatically resolves transforms, sorting or compositing correctly without testing the specific path.

Keep source reproduction, held-out reconstruction and delivery loss under separate declared protocols. Preserve the founder's PSNR, frame-rate, loading, fidelity and sublime targets without reporting them achieved ahead of evidence. Name evaluated artifacts, poses, conditions, visual defects and the next decisive experiment.
