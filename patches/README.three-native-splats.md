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
- `antialias`: whether to apply upstream's opacity compensation for its 0.3 px²
  low-pass filter; default `true` preserves upstream. Venviewer passes `false`:
  its loaders refuse mip-anti-aliased SOG and SPZ, and compensating a source
  trained without that filter dims it (T-639, measured 28 September 2026).
- `minSortIntervalMs`: optional minimum gap between orientation-triggered sorts.

Public `dispose()` frees generated quad, node-storage and compute resources;
the caller continues to own its source geometry. The patch also reinitializes
sort/SH work when the rendering device changes and skips negligible-alpha quads.
No application code reads underscore-prefixed addon internals.

WebGPU sorts cull (T-644). The histogram pass tests each splat centre against the
four side planes of the vertex stage's centre clip test and leaves out any splat
outside a plane by more than 0.25 m + (distance + 0.25 m) × 2.5°, the most a centre
can move while the camera travels 0.25 m and turns 2.5°. Perspective sorts also
test the footprint: a splat whose projected ellipse cannot reach the screen at the
nearest depth and widest angle those margins allow is left out even when its centre
passes the 1.4× centre clip. The bound uses the kernel cutoff, the covariance trace
times the mesh's largest axis scale², and the vertex stage's 2D dilation for any
drawing buffer at least 256 px on its short side. `CountingSort` treats any
bin at or above `binCount` as excluded (no atomics, no order slot) and its prefix
pass writes the draw's instance count into `drawIndirect[1]` and the exact kept
count into `drawIndirect[5]`; the mesh then draws with `drawIndexedIndirect`. A
re-sort is forced, whatever `minSortIntervalMs` says, once the camera has travelled
or turned 90% of those margins or the projection or mesh transform changes. WebGL2
has no indirect draws: its CPU orders keep every splat and the geometry draws
directly. The public read-only `drawIndirect` lets the profiler read the kept
count back, and `splatCount` reports the loaded splats.

Each draw instance holds 16 splats (T-644). One instance per four-vertex quad bounded
the draw by the GPU's per-instance front end: on an RTX 4090, 1.75 million kept
instances cost 1.19 ms with an empty vertex shader, the time of the full shader. The
quad geometry is now 16 attribute-free indexed quads (triangles 0-1-2 and 0-2-3 of
each, as before); a vertex draws slot `instance × 16 + vertex / 4` at corner
`vertex % 4`, so every quad keeps its four-vertex reuse. The prefix pass writes
`ceil(kept / 16)` instances, and slots past the kept count (WebGPU) or the splat
count (WebGL's complete orders) collapse like culled splats.

WebGPU lights only the drawn splats (T-644). The view-dependent lighting pass runs
one thread per entry of the current draw order and shades the first
`drawIndirect[5]` entries; a new order counts as a change, like camera movement,
because it can keep splats the previous pass did not shade. While walking through
the Grand Hall this cut the lighting pass from 0.567 to 0.345 ms on an RTX 4090.
WebGL still evaluates lighting per vertex.

Quads end at the 1/255 opacity contour (T-644). The reference 3DGS rasterizer
skips fragments below 1/255 opacity, so a faint splat's light never reaches its
kernel edge. A quad's half-extent is min(√(2 ln(255 α)), kernel radius) standard
deviations for the splat's displayed opacity α (after the opacity node and the
anti-aliasing compensation); from α ≈ 0.214 up the contour lies outside the kernel
and the quad is unchanged. The fragment stage discards below 1/255 and the vertex
stage collapses a splat whose peak opacity is under 1/255, replacing the former
0.002 cut-off.

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
requesting a coarser level; no arbitrary splats are dropped. The WebGL fallback
sorts every splat on the CPU, in a worker through the `cpuSort` hook. Memory includes decoded sources,
cached native buffers and one temporary staged replacement, so cache selection
and motion/rest behavior need real-device verification.

When upgrading Three, review this patch against upstream source, run native loader,
merge and lifecycle tests, then verify WebGPU and WebGL rendering, room clipping,
parent transforms, SH, fades, level swaps and capture export in the browser.
