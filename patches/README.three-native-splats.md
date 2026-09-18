# Three r186 Gaussian splat integration

`three@0.186.0.patch` narrowly extends the first-party MIT-licensed
[GaussianSplat addon](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/objects/GaussianSplat.js)
and its [CountingSort](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/gpgpu/CountingSort.js).
It is applied to the pinned package by pnpm. Three's package LICENSE remains
authoritative; the renderer, Gaussian projection, packed SH evaluation and GPU
sorting are upstream code, not a separate renderer dependency.

The projection Jacobian also handles orthographic cameras used by planner exports:
its x/y diagonal is the pixel scale from the projection matrix and its depth
derivatives are zero. The perspective branch remains upstream's projection.
Orthographic near/far clipping uses homogeneous clip coordinates; a perspective-only
behind-eye test is not applied to valid orthographic cameras with negative near planes.

The additive constructor options are:

- `opacityNode(index, center)`: TSL multiplier at the actual sorted splat center.
- `sphericalHarmonicsDirectionNode(index, direction)`: transforms the upstream
  **center minus camera** direction into the source's SH basis after merging.
- `colorSpace`: source RGB space; default `NoColorSpace` preserves upstream.
  Venviewer supplies `SRGBColorSpace` and retains normal linear working space.
- `kernelRadius`: Gaussian cutoff in standard deviations, default upstream 2.
- `minSortIntervalMs`: optional minimum gap between orientation-triggered sorts.

Public `dispose()` frees generated quad, node-storage and compute resources;
the caller continues to own its source geometry. The patch also reinitializes
sort/SH work when the rendering device changes and skips negligible-alpha quads.
No application code reads underscore-prefixed addon internals.

`native-splat-scene.ts` merges complete resident sources into one globally sorted
draw. Affine positions/covariances are transformed into scene coordinates; inverse
linear source transforms preserve SH direction. Room clipping uses scene-space
center SDFs. Fade opacity and clipping are uniforms. Geometry, membership or SH
tier changes stage a replacement and cache at most two complete draw snapshots.
Named motion/detail groups prewarm only once all their registered sources decode.
Inactive sources are absent from each snapshot's sort, not merely transparent.

This supplies **whole capture level selection, not a native spatial LOD tree**.
An unseen active set needs a merge and shader compilation; cached level switches
reuse their buffers. Devices unable to bind a complete level receive an error
requesting a coarser level; no arbitrary splats are dropped. WebGL fallback still
uses upstream main-thread CPU counting sort. Memory includes decoded sources,
cached native buffers and one temporary staged replacement, so cache selection
and motion/rest behavior need real-device verification.

When upgrading Three, review this patch against upstream source, run native loader,
merge and lifecycle tests, then verify WebGPU and WebGL rendering, room clipping,
parent transforms, SH, fades, level swaps and capture export in the browser.
