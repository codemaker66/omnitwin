# Three.js r186 Gaussian addon integration patch

`three@0.186.0.patch` extends the pinned first-party `GaussianSplat` addon and
`CountingSort`; the renderer, projection, GPU sort and SH evaluation remain Three.js.
The patch exposes opacity and SH-direction node hooks, a source color-space option,
a kernel cutoff, sort cadence and explicit disposal of owned GPU resources.
Its CPU-sort dispatch hook also lets the application run the same first-party
CountingSort in a worker. Completed orders are copied into attached native
storage; an explicit synchronous capture scope restores main-camera ordering
before asynchronous readback. WebGPU continues to use Three's GPU sort.

These hooks support one globally sorted room with per-tile fades, scene-space
clipping and correct SH under object transforms. The application keeps the normal
linear working space for furniture and converts capture colors explicitly.

Depth sorting uses 65,536 buckets with the same `log1p(depth - near)` mapping
in GPU and CPU paths. The environment shell extends over a kilometre; the
upstream 4,096 linear buckets then mix nearby room surfaces and expose colored
splats through walls. The shifted mapping also supports nonpositive orthographic
near planes. Every source splat and the original depth bounds remain present.
The depth-order regression exercises the real Gaussian addon and CountingSort
with nearby layers plus a distant outlier; both native backends require visual
qualification and performance must be measured again after this change.

The root pnpm patched dependency makes this reproducible in a clean install.
Keep patch bytes LF, inspect upstream changes when upgrading, and exercise both
WebGPU and native WebGL in a real browser. Read [the runtime note](../docs/engineering/native-splats.md).

The former Spark lifecycle/ZIP64 patch and its vendor-only tests were removed with
the Spark dependency. This does not claim those issues are fixed upstream. SOG now
uses the maintained direct `@zip.js/zip.js` dependency and raw WebP decoding; the
native decoder and lifecycle have their own behavior tests.

## Drei instance upload compatibility

`@react-three__drei@9.122.0.patch` translates the legacy `offset` argument into
Three's current `updateRanges[].start` field in both module builds. The unchanged
React 18/R3F 8/Drei stack otherwise submits an undefined offset to WebGPU when
updating instanced furniture. This was reproduced in the furnished Grand Hall
and in the native instance-upload regression test. The patch changes no geometry,
instance count or update count; remove it when upgrading to a compatible helper.
