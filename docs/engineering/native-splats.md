# Native Three.js Gaussian splats

T-627 implements Blake’s 18 September 2026 instruction to drop Spark after the
native r186 baseline. This decision supersedes the renderer choice in D-001/D-002;
historical evidence and source captures remain unchanged. The native renderer is
deployed at `da944981`; [release evidence](../reports/native-splat-baseline-2026-09-18.md#production-delivery)
records complete CI and live checks. Founder visual acceptance remains separate.

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
an exact depth sort. The T-634 patch retains those bins and replaces the serial
GPU prefix scan with 256-bin block scans, a block-total scan and offset addition.
Reset, histogram, the three prefix stages and scatter form one stable six-node
compute group. Exact camera position, mesh world transform and renderer identity
invalidate SH computation; pure camera rotation reuses the same SH contribution.

The WebGL2 path dispatches an equivalent direct CPU counting-sort kernel to one
worker per native scene. It retains the existing floating-point operation order,
`log1p` buckets and stable order within tied bins, and scatters directly into a
recycled exchange buffer without allocating GPU-oriented worker storage.
A snapshot's first order completes before compilation and
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

The full Grand Hall SH3 band contains 138.038 MiB of packed coefficients and
exceeds WebGPU's default 128 MiB binding size. The integrated T-634 patch uses two
contiguous splat ranges when the band exceeds the actual device binding cap.
Their typed views share the existing CPU coefficient array; at 6,030,980 splats,
each range is 69.019 MiB and the largest remaining binding is 92.025 MiB. A shader
branch selects the original six words before unchanged SH decode and arithmetic.
Larger-limit devices keep the original single binding. Canvas still negotiates
supported limits, and the host rejects a complete draw that exceeds the remaining
bounds. No points, bands or packed precision are removed. This implementation is
qualified on the recorded RTX 4090: sixteen finite, nonzero actual-GPU cases
produce bit-exact SH output, and eight full-scene matched views pass the image
guard with an actual 128 MiB device binding cap versus the normal 256 MiB cap.
The split application shader uses seven storage bindings instead of six. Maximum
normalized RGB MAE is 0.019127% and minimum SSIM is 0.999728 at 1600×900 capture
resolution; the drawing buffer remains 3200×1800. Source hashes remain unchanged
through qualification. Binding-cap arithmetic and this same-device check do not establish
available aggregate memory, phone frame rate or reversal of existing SH quantization.

The host retains at most two compiled snapshots for complete motion/detail level
switching. After a larger draw activates successfully, it releases inactive
loading subsets with the same source identities, versions, SH settings and
kernel. The previous draw stays available while replacement compilation is
pending or fails; distinct named levels remain eligible for the cache. This
avoids retaining a nearly complete planner snapshot beside the final scene.

Allocation sizes derived from the pinned source are not measured browser memory.
For SH3, decoded source attributes require 92 bytes per splat. A WebGPU snapshot
after its first SH compute retains 172 bytes per splat in CPU typed-array backing
until that draw's first synchronous CPU sort: merged attributes 92, tile indices
four, native draw copies 52, sort order/bins eight and computed SH contributions
16. Add 512 KiB for GPU histogram/offset backing and 2 KiB for the parallel
prefix's totals/offsets. At 6,030,980 splats, source plus one such snapshot is
about 1.483 GiB before fixed arrays and omitted overhead; another million-splat
snapshot adds about 164.032 MiB. This replaces the eager-scratch accounting of
176 bytes per snapshot splat and about 1.505 GiB for source plus one snapshot.

Lazy CPU scratch avoids `4*N + 8*65536` bytes per native draw: 23.506 MiB at the
full count. This applies to ordinary WebGPU **and worker-managed WebGL** until
that draw first invokes synchronous `computeCPU`, notably for a WebGL capture.
Those arrays then remain retained for its CountingSort lifetime. Worker activity
does not allocate the separate native draw's scratch. The ordinary WebGL-only
path evaluates SH in its vertex shader and does not allocate the 16-byte-per-splat
WebGPU contribution. WebGL PBO uploads create padded texture-sized backing and
can leave original arrays owned by source/merged geometry, so the WebGPU snapshot
formula must not be presented as an exact WebGL total.

Each initialized direct WebGL worker registration additionally retains 20 bytes
per splat: copied centers 12, CPU bins four and one exchange order four, plus
512 KiB of histogram/offset arrays. At 6,030,980 splats this is 115.532 MiB,
46.513 MiB below the former CountingSort-backed worker's 162.045 MiB. The exchange
moves between threads; native draw storage stays attached. Synchronous capture
temporarily saves another four bytes per splat (23.006 MiB at full count) for
each nested scope and may allocate the native draw scratch described above.

These are retained-backing estimates, excluding JavaScript/worker overhead, GPU
storage, render targets, decode transients, PBO duplicates and delayed garbage
collection. The prefix adds another 2 KiB of GPU storage per sort; the SH3 split
changes binding shape rather than total coefficient bytes. Replacement compilation
can exceed the two-snapshot cache limit temporarily. Compare peak and post-GC
memory on the same scene/backend/device before claiming measured memory savings.

Decoder concurrency now uses browser capability hints only for scheduling. It
allows one fetch/decode worker when positive reported memory is at most 4 GiB or
positive integral processor count is at most four. With memory unknown, at most
six reported processors and explicit coarse-pointer/no-hover input also select
one worker. Other or unknown combinations retain two. The independent scene sort
worker is unchanged. This bounds overlapping allocations but may lengthen complete
loading; it changes no source points, SH, pixels, lighting or quality tier, and
does not identify physical RAM or qualify a phone.

## 25 September runtime iteration evidence (T-634)

Five qualified candidate comparisons each improved the declared overall time by
less than 5%, meeting the requested numerical stopping rule. Negative reductions
are regressions. SH caching, combined prefix/batching and lazy scratch are retained;
the isolated prefix and isolated batching candidates were rejected. Lazy scratch
was retained for its conditional memory saving, not as a measured time improvement.

| Candidate | Control ms | Candidate ms | Time reduction | Decision | Streak |
|---|---:|---:|---:|---|---:|
| SH position cache | 8.522315 | 8.151885 | +4.346590% | Retain | 1/5 |
| Parallel prefix alone | 8.151885 | 8.574785 | -5.187765% | Reject | 2/5 |
| Batched submission alone | 7.941793 | 8.661560 | -9.063033% | Reject | 3/5 |
| Parallel prefix plus batching | 7.941793 | 7.881662 | +0.757146% | Retain | 4/5 |
| Lazy native CPU scratch | 7.881662 | 7.956244 | -0.946279% | Retain for memory | 5/5 |

The RTX 4090 / Ryzen 7 3800X / approximately 32 GiB Windows host used Chromium
147 and Three r186. The complete Grand Hall workload contains 6,030,980 original
room/environment splats, SH3 and no furniture, at 1600×900 CSS and DPR2
(3200×1800 drawing buffer), with unchanged Gaussian cutoff/clipping. Each arm has
three 20-second samples of fixed-position rotation and a translated path after
five-second warmups. The score equally averages the per-workload median elapsed
time per GPU-acknowledged complete main render. The driver submits one frame then
awaits GPU queue completion: CPU submission, GPU execution and acknowledgement
delivery are included; automatic R3F callbacks, compositor presentation and input
responsiveness are excluded. It is not interactive FPS or a GPU timestamp duration.

Initial-to-selected point reduction is 6.642214% (8.522315 → 7.956244 ms), not an
additional iteration. Desktop variability means small gains are not guaranteed;
run values/ranges are descriptive, not confidence intervals. The direct worker,
device budget and profiler integration are already present in both baseline arms.
SH3 splitting was integrated after this sequence and passed separate final
source-bound correctness and image qualification; the earlier timing result
does not measure that change.

Every scored pair passes its receipt-bound matched-image guard: normalized RGB
MAE <1% and Gaussian-window RGB SSIM >0.99 with identical source/count, SH, camera
and canvas. The cumulative four-view comparison has maximum MAE 0.0193034% and
minimum SSIM 0.999771831. This bounds numerical still-image differences, not motion
fidelity, reconstruction accuracy or founder aesthetic acceptance. The retained
CPU-worker experiment separately measured 225.192 → 210.303 ms mean kernel time
(6.612%) on 6,030,980 seeded positions, two warmups and ten measured alternating
rounds; twelve complete permutations were identical. It excludes initialization,
transport, queue wait and browser frame work and is not a physical-phone result.

Initial DPR1, uncapped-browser, HMR-warning, 1 Hz rAF and failed-network attempts
remain excluded evidence. Completion-driven render progress can coexist with
approximately 1 Hz or 240 Hz diagnostic rAF cadence. Later contexts route exact
Google Fonts URLs to cached real CSS/WOFF2 response bytes with recorded user agent
and hashes; no empty stylesheet or substituted font is used. Earlier failed
receipts remain unchanged. Raw evidence, hashes, decisions and the HTML-report
inputs live outside Git under the local task evidence directory recorded in
[the 25 September session](../sessions/2026-09-25.md).

## Rolling 20-second profiler

The integrated profiler selects the visible main renderer and records successful
outer main draws, excluding offscreen captures and skipped pacer requests. Open
with the backquote key in development, or load a development or production URL
using `?profiler=1`. Only that explicit URL opt-in retains a touch-accessible
Profiler launcher after closing the panel; ordinary routes have no floating
launcher. It exposes twelve entries: rendered submission FPS;
frame interval mean, p95 and p99; CPU submission; GPU render plus compute; draw
calls; triangles; Gaussian splats; Three-tracked memory; sort duration; and sort
order age. The display uses a rolling 20-second window and reports unavailable
values explicitly. GPU timestamps are sampled at most once per second and are
unavailable on WebGL; queue acknowledgement is never presented as a GPU timestamp.
Memory is renderer-tracked allocation, not physical VRAM or JavaScript heap.

Pause freezes measurement, Play starts a fresh window, Reset clears the window,
and Copy report writes JSON with device, renderer, window, metrics and definitions.
Renderer replacement and return from a hidden tab start a fresh window. Hidden or
paused profiling does not poll or issue timestamp queries. Sort age is the age of
the applied request's camera pose and can grow while a stationary view needs no
new sort; backlog is supplementary diagnostics, not a thirteenth headline stat.
Final-source local development QA passed the actual 20-second windows, twelve
readable entries, real clipboard, Pause/Reset/Play, idle aging, collection shutdown
and SPA renderer cleanup with zero console/page errors. Desktop and phone-viewport
screenshots were inspected; this is UI evidence, not physical-phone performance.
The session links the retained receipts. Implementation commit `891da44a` is
local: final WebGL/capture lifecycle checks, production-flow QA and hosted
checks, release, live verification and the HTML report remain pending. The Gaussian public WIP hold
and T-632 reconstruction ownership remain unchanged.

## Historical runtime comparisons

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
for source hashes and the newer qualified comparisons below.

The actual production worker subsequently retained all 6,030,980 room/environment
splats during a 12.06-second ordinary public-view drag: 151.27 rAF FPS, 12.5 ms
p95 and 20.8 ms p99, with 69 worker sorts applied. Sorting still takes a median
116 ms on its worker; completed orders therefore trail the camera (126.9 ms p95
pose age in this run). This is application responsiveness evidence on the RTX
4090, not the final matched renderer baseline or a mobile result. A poster
capture during an in-flight sort preserved all padded main-view order entries,
camera-sort metadata and renderer target, and left all eleven sources ready.

The final isolated runtime-`188ec0e0` comparison uses fresh controls: native
WebGPU 161.97 FPS versus product Spark 158.75 (+2.03%), and the native WebGL
worker 194.57 (+22.56%). The WebGPU difference is small and these rAF medians
are not general device or presentation guarantees. All twelve samples remain,
including an unexplained one-second-rAF Spark sample; it must not be attributed
to intrinsic rendering cost. Worker order-age p95 reached 1.035–1.100s per frame,
including native re-sort thresholds; higher rAF is not equal motion fidelity.
See the [final report](../reports/native-splat-baseline-2026-09-18.md#final-recovery-baseline-18-september-2026)
for the complete methodology and limitations.

After pacing, the actual full-scene app submitted 190.32 WebGL2 / 147.01 WebGPU
main draws per second in separate twelve-second hardware runs. Both retained
all 6,030,980 splats, SH3 and normal motion/settled resolutions, completed every
observed GPU ticket (maximum two outstanding), and passed poster export with
zero browser errors. Fresh original Linux reduced-motion/linework/staged cases
also passed, zero retries; full captures took 13.848s / 10.994s within unchanged
15s deadlines. The first retains limited headroom. The subsequent PR and both
release-branch CI runs passed the complete browser gate without retries or flakes.
The promoted native deployment then passed public Grand Hall and Reception Room
loading/movement checks; all four before/after images were inspected. These checks
do not establish physical-device coverage or founder aesthetic acceptance.

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

When capture access is enabled, walkthroughs and the internal capture console
retain the full captured interior. The current public Gaussian WIP hold keeps
those Gaussian routes unavailable in production. The generated bundle extent
can come from the scanner trajectory; it
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
