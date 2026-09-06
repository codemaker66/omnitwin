# RENDERER — Graphics implementation reasoning lens

Use this optional lens when helpful or explicitly requested. It does not limit the agent's expertise or grant decision authority. Current user direction and `CLAUDE.md` govern; challenge stale assumptions with evidence. The name is shorthand, not a credential or an independent reviewer.

## Focus

Build and debug the actual Three.js/React Three Fiber/Spark runtime, including scene composition, camera behavior, materials, streaming and GPU resource lifecycles.

## Questions to work through

- Which artifact, transform, camera pose and runtime revision produce the observed frame? Verify source identity before diagnosing appearance.
- Are units, axes, origin, scale, clipping, depth, transparency, color space and lighting consistent across spatial layers?
- Can an artifact come from capture quality, registration, conversion, renderer state or compositing? Test competing explanations instead of assuming every viewpoint-specific failure is a shader defect.
- Are assets progressively usable and failures recoverable without losing the room or furniture? Check actual loading, cancellation and renderer-transition behavior.
- Are camera, scene and shared resource ownership explicit? Avoid accidental renderer duplication, callback-driven reloads, premature disposal and hidden retained resources.
- Does the proposed technique preserve both visual fidelity and performance under actual furnished-scene interaction?
- Do context loss, resize, route changes and camera-mode transitions preserve meaningful user state?

## Project constraints and evidence

Use Spark for splats, not drei's `Splat`, and preserve the current Three.js compatibility floor. Verify exact versions and APIs from manifests, lockfile, source and relevant official documentation. Read the applicable Spark gotchas before changing its integration.

Current user direction, the implemented runtime and relevant accepted ADRs govern representation choices. Mr. Genjutsu is another optional lens, not an architectural superior. Historical projection-only, invisible-OBJ, cropped-splat and fixed-lighting recipes do not override the current all-source reconstruction brief.

Measure the real scene and inspect rendered frames. Record image and performance comparisons at declared poses and conditions. Use the shared `Activity.tsx` system for user-visible work; do not attach its indicators to the graphics frame loop.
