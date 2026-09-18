# Native Three.js Gaussian splats

T-627 implements Blake’s 18 September 2026 instruction to drop Spark after the
native r186 baseline. This decision supersedes the renderer choice in D-001/D-002;
historical evidence and source captures remain unchanged. Implementation and
qualification are in progress; this note is not a claim of visual acceptance.

## Runtime boundary

`NativeCanvas` retains React 18/R3F 8 context, events and resize behavior. Its
synchronous renderer factory creates `three/webgpu` WebGPURenderer, gates children
and the frame loop until initialization, and explicitly owns teardown. Three
negotiates WebGPU or its WebGL2 fallback. A development `nativeWebGL=1` query forces
fallback qualification. Existing non-splat WebGL canvases remain native Three.

`NativeSplatLayer` loads original capture data through cancellable workers. The
scene host merges active tiles into one first-party GaussianSplat draw so sorting
is global. A narrow [pinned Three patch](../../patches/README.md) exposes per-source
fades, correct SH directions after transforms, center-based room clipping and
resource disposal; no Spark rendering, sorting or WASM remains in the browser.

Room and environment splats share 65,536 logarithmic depth buckets. The original
4,096 linear buckets lost nearby surface ordering when a kilometre-scale
environment expanded the scene's depth range. Both native backends map depth
relative to the near bound before applying `log1p`; negative orthographic near
planes remain supported. Every source record and the original bounds remain.
This improves the reproduced streaking but does not make approximate buckets
an exact depth sort. Three's serial GPU prefix loop also grows with bucket count,
so camera-motion performance requires renewed measurement for this patch.

The WebGL2 path dispatches the same first-party CPU CountingSort to one worker
per native scene. A snapshot's first order completes before compilation and
activation. There is one in-flight job and at most one coalesced latest pose
per resident snapshot; completed orders still apply during continuous motion
so changing cameras cannot starve the sorter. Position data is copied once
per registration. Only an exchange order buffer transfers between threads;
live native position/order buffers stay attached. Snapshot disposal and worker
failure prevent stale readiness, and worker stalls fail explicitly after 30s.
Explicit WebGL captures temporarily compute their camera's synchronous order,
restoring main-view order and metadata before asynchronous readback yields.
Three's WebGL PBO can pad the order array for texture storage without changing
its logical splat count. Worker results and capture copies use the logical count;
applying or restoring them preserves the padded allocation and trailing entries.
A resident worker failure enters the existing recoverable renderer error boundary,
so a hidden failed mesh cannot leave an apparently complete loading status.

SOG is an asset format, independent of Spark. Its ZIP archive contains encoded
WebP data planes; libwebp must return raw bytes (Canvas2D alpha/color processing
can corrupt them). `@jsquash/webp` is a decoder-only dependency. All source SH bands
through SH3 are retained using Three r186's packed coefficient representation;
this does not preserve the full source floating-point range. The decoder bounds allocation,
validates metadata and can be cancelled. Source assets are never rewritten.

Three r186's `GaussianSplat.js::unpackSphericalHarmonicsCoefficients` decodes each
byte as `(byte - 128) / 128`, so the current adapter quantizes every band to eight
bits and clamps coefficients to `[-1, 127/128]`. The previous Spark 2.1.0 SOG path
also restricted these captures to approximately this range. On 18 September
2026, the exact installed `dist/spark.module.js` embedded Rust worker was exercised
in Node, without a renderer, through its real `loadPackedSplats` RPC with
`fileBytes` and `pathName`, leaving `encoding` and `lod` unspecified. The worker's
`decode_to_packedsplats` / `toPackedResult` path returned
`splatEncoding.sh1Max = sh2Max = sh3Max = 1` for the baseline Grand Hall `env.sog`
(11,296 splats) and `0_0.sog` (355,593 splats). This verifies the actual decoder's
returned ranges, rather than assuming its advertised defaults. Spark's installed
`encodeSh1Rgb`, `encodeSh2Rgb`, `encodeSh3Rgb` and corresponding
`evaluatePackedSH1/2/3` functions use signed 7/8/6-bit coefficients scaled to those
maxima, with endpoints of `[-1, 1]`. Native therefore improves SH1/SH3 precision
but slightly lowers the positive endpoint; clipping is largely inherited, not
evidence that the source itself lacks coefficients beyond one. The source SOG
codebooks exceed this range. Avoid claiming lossless SH or full source-range
preservation: that requires an explicit decoder-to-shader scaling contract and
new fidelity qualification, including any RAD encoding differences.

The audited Spark bundle SHA-256 was
`c0355a962f68a6de9b13df69f05b1aba3614d9aec43a4504975daeb349126a8a`.
The baseline SOG SHA-256 values were
`b74e7cd9899bbea8aad30b16c6512b43326c53a46c36ffd6cbd272eb48f914bd`
(`env.sog`) and
`ad9ee1a5edb4cdb07773bfca8bafc211bda2c470820fff310948ee1fa266f41d`
(`0_0.sog`).

## Delivery and limits

Canonical staged SOG URLs replace the optional Spark RAD-tree path. RAD metadata
and historical QA records remain provenance, not a browser dependency. Legacy
registered formats without a native adapter report a conversion error explicitly;
review the loader’s supported formats before registering new runtime artifacts.

Supported inputs are ZIP SOG v1/v2 with lossless WebP planes, ordinary SPZ v1–4
(SPZ LOD trees are rejected), conventional 32-byte SPLAT, and KSPLAT v0.1 with
compression 0/1/2. PLY uses the official parser up to 250,000 vertices; larger
PLY inputs require binary little-endian, all-float32 vertex properties for the
bounded chunk parser. Adapters retain at most SH3. Input guards cap downloads
at 2 GiB and point counts at 16,777,216; SOG additionally caps archives at
512 MiB and each inflated entry at 128 MiB. RAD/RADC registry or manual URLs
report conversion guidance; they do not acquire an implicit Spark fallback.

High-tier views retain the full source reconstruction. Weaker walk tiers select
the highest complete vendor level under the existing settled budget, with the
coarsest available level as the minimum. Motion uses a complete resident coarse
level. This is whole-level switching, not Spark’s continuous LOD. It cannot meet
a budget below the smallest source level without another reconstruction.

The full Grand Hall SH3 buffer exceeds WebGPU’s default 128 MiB binding size.
Canvas negotiates supported larger limits; the host validates the actual limit
before allocating a complete draw. Do not silently remove SH or points to fit.

The host retains at most two compiled snapshots for complete motion/detail level
switching. After a larger draw activates successfully, it releases inactive
loading subsets with the same source identities, versions, SH settings and
kernel. The previous draw stays available while replacement compilation is
pending or fails; distinct named levels remain eligible for the cache. This
avoids retaining a nearly complete planner snapshot beside the final scene.

Allocation sizes derived from the pinned source are not measured browser memory.
For SH3, decoded source attributes require 92 bytes per splat. Each WebGPU
snapshot additionally retains about 176 bytes per splat in CPU typed-array
backing: merged attributes 92, tile indices 4, native draw copies 52, sort arrays
12 (including the eagerly allocated CPU fallback bins), and computed SH
contributions 16. At 6,030,980 splats, source data plus one snapshot accounts for
about 1.505 GiB before fixed arrays, JavaScript/renderer overhead, GPU storage,
render targets and decode temporaries. Each additional million-splat snapshot
adds about 168 MiB of CPU backing. Compiling a replacement can temporarily exceed
the two-snapshot cache limit. Disposed arrays become reclaimable only after
references are released and garbage collection runs. These estimates do not
establish a measured memory limit or an improvement over Spark; compare post-GC
and peak memory on the same scene, backend, device and workload.

Each initialized WebGL worker registration additionally retains 28 bytes per
splat (12 for copied centers, 12 for Three's sort arrays and four for the
exchange order) plus 1 MiB of fixed histogram/offset arrays. A full Grand Hall
registration therefore adds about 162 MiB of CPU backing, before worker/runtime
overhead, transients and delayed garbage collection. Synchronous capture saves
another four bytes per splat temporarily for each nested scope. Moving sorting
off the interaction thread is not a memory optimization.

The isolated follow-up before the depth-order recovery, with matching Gaussian
radius, measured 158.72 versus 134.13 FPS (18.33%) on the RTX 4090. That result
does not measure the revised logarithmic sorting patch. It is not a
measurement of this application integration or proof of equal visual quality;
colour blending, SH packing and sorting still differ. Recheck load time, memory, frame
time, visual fidelity, clipping, overlays, capture exports and teardown in the
complete planner and both renderer backends before making a shipping claim.

The subsequent 65,536-bucket recovery measured 153.74 versus 135.88 FPS
(13.15%) for native WebGPU and product Spark under the same isolated workload.
Its synchronous WebGL2 fallback regressed to 81.41 FPS with 125 ms p95 pauses,
also reproduced in the full public walkthrough. These dated results precede
the asynchronous fallback repair; see the [baseline report](../reports/native-splat-baseline-2026-09-18.md)
for source hashes, raw evidence, scope and pending qualification.

The actual production worker subsequently retained all 6,030,980 room/environment
splats during a 12.06-second ordinary public-view drag: 151.27 rAF FPS, 12.5 ms
p95 and 20.8 ms p99, with 69 worker sorts applied. Sorting still takes a median
116 ms on its worker; completed orders therefore trail the camera (126.9 ms p95
pose age in this run). This is application responsiveness evidence on the RTX
4090, not the final matched renderer baseline or a mobile result. A poster
capture during an in-flight sort preserved all padded main-view order entries,
camera-sort metadata and renderer target, and left all eleven sources ready.

Native Three does not preserve the presented canvas buffer through the old
WebGL `preserveDrawingBuffer` option. Poster exports use an explicit same-device
render target. Room-resolution E2E evidence crops the existing compositor surface
through CDP without another draw or graphics context. It verifies ownership of
the live canvas, DPR1 dimensions, containment in the unchanged viewport, the
default render target and exact PNG dimensions. Viewport expansion is disabled.
The original 15-second host deadline includes session setup, capture and cleanup;
waits, image-size threshold, one blank-image retry and full traces remain. These
images may include displayed DOM overlays; they are not raw framebuffer or
forced-render measurements. Direct redraw/readback and earlier compositor
failures remain recorded in the session evidence.

Planner completion follows completed GPU work for each source's native main-camera
draw at its uploaded revealed opacity. Completion is registered in the outer
canvas render and starts waiting only after the whole draw successfully returns:
the active WebGPU queue acknowledges submission completion, or a nonblocking
WebGL2 fence is polled. Snapshot replacement, disposal and device/context loss
cancel or fail pending readiness; a 30-second GPU stall becomes an explicit
product error. This does not change the 15-second capture deadline or certify
browser compositor presentation. Decode still starts the fade, so rendering never
waits on its own completion signal. The pending caption pauses in Model view, while
terminal failure notices remain available. A replacement renderer clears old
draw counts even when source URLs are unchanged; callbacks from its predecessor
cannot advance the new generation. Ink fades consume actual nonnegative elapsed
time and apply their final snap without an extra animation callback, preserving
normal easing and reduced-motion behavior under slow software-rendered frames.

Automatic canvas rendering now owns a bounded GPU submission queue. R3F continues
updating the current camera and scene, while skipped draw requests coalesce into
one invalidation after capacity becomes available. Explicit renders and exports
remain immediate. At most two automatic draws may be outstanding; a completion
observed more than 50ms after submission begins reduces capacity to one, and three
successive observations below 25ms restore two. These intervals include CPU
submission, GPU queueing and observation delay; they are not GPU timestamps.
WebGL polls the fence nonblockingly before each capacity decision, so the 16ms
background timer does not impose a frame-rate ceiling. Failure, replacement and
disposal cancel owned tickets and cannot wake a removed root. Source readiness
retains its independent completed-work contract.

Public walkthroughs and the internal capture console retain the full captured
interior. The generated bundle extent can come from the scanner trajectory; it
frames the camera and constrains movement but does not guarantee containment of
walls or ceiling. Do not apply it as a splat clip volume. Previous Spark layers
had `editable:false`, so their global `RoomClipBox` was inactive. Enabling that
box during the native migration removed visible Grand Hall surfaces and caused
a production rollback on 18 September. Explicit future cutaway views require a
separately qualified architectural clip volume and visual evidence.

Vite prepares the planner's static import graph when the development server
starts and preoptimizes the lazy native decoder imports. This avoids reproduced
first-navigation transform and dependency-reload delays. It does not load the
route in a browser, move test stopwatches or establish a production startup gain.

The native material-clipping bridge wraps public `renderObject`, shared by
compilation and drawing. Three r186's `compileAsync` bypasses the separate
`setRenderObjectFunction` hook, which previously warmed unclipped shaders and
left the actual clipped variants cold. Planner warmup runs after the camera
owners apply their frame pose and repeats when the procedural fallback shell
becomes visible. It leaves demand rendering and actual-draw readiness intact.

The placed-object UI browser group uses the existing `captureLaunchOptions`
OpenGL profile. A same-source Linux diagnostic observed native WebGL2 on
SwiftShader exceed the unchanged 30-second limit for the 162-object navigation
case, while Mesa llvmpipe completed the same assertions and both screenshots.
Only this group's graphics selection changes; its fixtures, viewport, timeouts,
clearance checks and inventory remain. This replaces default-SwiftShader
coverage for this group, not a fix or performance qualification of SwiftShader.
The separately pinned hardware GPU gate is unchanged.

## Browser inventory identity review

On 18 September 2026, the committed CI discovery command
`pnpm --filter @omnitwin/web exec playwright test --list --update-snapshots=none --reporter=json`
was run with `CI=true` against the frozen E2E sources. It collected 353 cases
(348 CPU, five GPU), no discovery errors and no execution results. Comparison
against the reviewed browser baseline found exactly one renamed case and no
other identity changes: `splat-fixture.spec.ts` changed from suite `Spark fixture`
and title `loads the Three.js 0.180 + Spark smoke route` to suite
`Native Gaussian fixture` and title
`loads the Three.js r186 native Gaussian smoke route`. Its Playwright ID changed
from `93ffd98e958758b817a2-0df8b72c6017f4d93352` to
`93ffd98e958758b817a2-e36e3b1c31c31c0adc7c`.

Only that ID, title and suite name were updated in
[the browser baseline](../../.github/gpu/browser-baseline.json). Its `passed`
expectation, all other 352 cases, 42 original skips, four expected failures and
the 353/348/5 partition remain unchanged. Existing source-run, source-commit and
report-hash fields remain historical provenance; this documented rename does
not alter or replace any execution receipt. Discovery and gate-tooling tests
are not browser or GPU qualification of the migration: fresh exact-source CI
and authenticated hardware evidence are still required.
