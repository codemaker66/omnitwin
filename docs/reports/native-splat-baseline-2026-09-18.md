# Three.js native Gaussian splats versus Spark — 18 September 2026

Requested investigation and isolated renderer benchmark, recorded before
the T-627 migration. Statements about installed dependencies below describe that
baseline. Current implementation is tracked in [native splats](../engineering/native-splats.md).

**Later follow-up:** the [matched-radius comparison below](#follow-up-final-patched-addon-with-matched-radius-18-september-2026)
uses the final patched addon at the application's √8σ radius and measures
**18.33% higher median FPS** than Spark's old product settings on this isolated
room workload. Use that follow-up when discussing the final addon. The original
stock-addon experiment and its measurements are preserved below.

**Original baseline outcome:** the application used external Spark. The focused desktop comparison
measured about **20% higher frame rate** with stock Three r186 native WebGPU, retaining
all 6,019,684 SH3 room splats. Native is a credible optimization candidate, not
a qualified drop-in replacement; loader, delivery, integration, fallback and
physical-device requirements remain below. Production remains unchanged.

## Implementation and released alternative

Venviewer uses **Spark 2.1.0, Three.js 0.180.0, R3F 8.18.0 and Drei 9.122.0**.
The package manifest and lockfile, `SparkSplatLayer.tsx` constructors, shared
`SparkRendererMount`, and `RoomSplatScene` WebGL canvas confirm this. Spark is
the Gaussian renderer, rather than merely an asset loader. The installed
versions were independently read and hashed in the evidence directory below.

[Three.js r186](https://github.com/mrdoob/three.js/releases/tag/r186), released
8 September 2026, adds the first-party
[GaussianSplat addon](https://threejs.org/docs/pages/GaussianSplat.html).
The npm registry also reports 0.186.0 as latest during this investigation.
It requires **WebGPURenderer**, including that renderer's `forceWebGL` backend;
it cannot be substituted into the existing `WebGLRenderer` canvas.

The major architectural opportunity is GPU sorting on WebGPU. The r186
[CountingSort implementation](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/gpgpu/CountingSort.js)
uses 4,096 depth bins; its WebGL fallback sorts synchronously in JavaScript.
Removing a dependency alone does not establish a runtime improvement.

## Experiment

Evidence and executable harness:
`C:/Users/blake/omnitwin2/.codex-tmp/native-splat-20260918/` (retained local evidence).
The report's final results derive from `results.json` and the preserved raw
`full-*.log`/`tile-*.log` browser records, not historical measurements.

- Headed Chrome on this Windows desktop, NVIDIA GeForce **RTX 4090, 24 GB**,
  driver 616.92. This is a different reported GPU identity from the historical
  laptop baseline and is not mobile qualification.
- Actual canvas 1600 × 900, DPR 1, no MSAA, no tone mapping, opaque black
  background, `preserveDrawingBuffer:false` during timing. The browser viewport
  is 1600 × 1000; the extra 100 pixels are outside the measured canvas.
- Preserved full Grand Hall room export: **6,019,684 SH3 splats**, 1,420,646,902
  bytes, SHA-256 `8eedc06489084bc80853bfd881ca5da381123eedc9954725eec46f59a614ae9b`.
  It excludes the 11,296-splat environment and all furniture/application UI.
  The current complete captured scene would contain 6,030,980 logical splats.
- Same original file bytes, count, SH degree, transform, camera and scripted
  motion in each arm. Browser SHA-256 checks precede rendering. The fixed wall
  view follows the existing source-bound tile diagnostic; motion combines
  ±0.28 radian yaw and ±0.35 metre translation, over six/eight-second cycles.
- Four-second motion warmup followed by twelve-second samples. Frame intervals
  are raw `requestAnimationFrame` deltas with the first recorded interval
  excluded, without outlier removal. FPS is 1000/mean interval; p95 is nearest
  rank. These measure browser frame pacing, not GPU timestamps or certified
  physical presentation.
- Spark's main arm uses current high-tier renderer settings: packed data,
  SH3, no LOD, one renderer, default radial sorting, blur 0.3, tail √8.
  Delivery differs from the product's SOG tiles: this test loads one ordinary
  PLY and one mesh to hold the source constant across engines.
- The additional controlled Spark arm uses native-like tail 2, Z sorting,
  alpha cutoff 0 and radius cap 2048, retaining compensated blur 0.3.
  This controls several shader choices; it does **not** establish pixel parity.
  Native uses its official sRGB working-space convention. Spark retains its
  own normal colour path. Native and Spark packing and sort scheduling differ.

## Results

### Original focused baseline

After an unstable native WebGL run, each headline renderer was restarted in a
fresh headed browser process. The tab was explicitly brought forward and
focus/visibility changes were recorded throughout every warmup and sample.
All six final captures began and ended focused/visible, with no changes or
runtime errors. The later order (WebGPU then Spark) also reverses the initial
Spark-then-WebGPU order; this is a small repeated experiment, not a fully
randomized hardware benchmark.

| Full-room renderer | Median FPS, three runs | Run range | Median p95 interval | Median p99 interval |
| --- | ---: | ---: | ---: | ---: |
| Spark 2.1 / Three r180, current high-tier settings | **133.33** | 132.76–134.55 | **16.7 ms** | **21.0 ms** |
| Three r186 native WebGPU | **159.92** | 158.72–160.39 | **12.5 ms** | **12.6 ms** |

This is approximately **19.9% higher FPS** and **25.1% lower p95 frame interval**.
Use this conservative final result rather than the initial 29.55% gain below.
The source/count, camera, drawing buffer, SH3 and runtime-error checks are
identical. Raw records are `full-spark-final-{1,2,3}.log` and
`full-native-webgpu-recheck-{1,2,3}.log`. Independent recalculation confirms them.

### Initial series and diagnostic controls

The initial series used three serial samples per arm, each following its own
four-second motion warmup:

| Full-room renderer | Median FPS | Run range | Median p95 interval | Median p99 interval |
| --- | ---: | ---: | ---: | ---: |
| Spark, current high-tier settings | 132.28 | 131.75–132.29 | 16.7 ms | 21.0 ms |
| Spark, controlled kernel/sort settings | 129.58 | 129.42–129.85 | 16.7 ms | 24.9 ms |
| Three r186 native WebGPU | **171.37** | **171.08–171.56** | **8.5 ms** | **12.6 ms** |

Native WebGPU delivered **29.55% higher frame rate** than the current-settings
Spark arm and **32.24% higher** than controlled Spark. Its median p95 interval
was 49.10% lower **in that initial series**. These are observed gains for this isolated desktop motion
workload, not an app-wide, loading-time or mobile speedup. The gain remains in
the additional comparison controlling several kernel/sort settings. Those
settings changed together; this experiment does not separately isolate their
individual costs or every internal cause.

Sort-event counts differ: default Spark reports 39–40 completion-time changes,
controlled Spark 54–55, and native WebGPU 58–60 successful dispatches per sample.
Completion and dispatch counts are not identical metrics, so this is diagnostic
context rather than a normalized sorting-throughput comparison.

Native WebGL fallback was unstable: its first sample averaged 44.64 FPS, with
p99 1004.1 ms; subsequent samples fell to roughly one callback per second. The
regular cadence is not explained by the much shorter CPU submission time.
Visibility was recorded as visible at result capture, but that alone does not
exclude browser throttling. These records are retained as **unqualified fallback
behavior**, not a trustworthy general percentage regression.

A fresh headed browser with explicit `bringToFront` and focus/visibility event
recording removed that cadence: native WebGL measured **149.17 FPS**, p95
**8.4 ms**, p99 **62.6 ms**. Focus remained true and no focus/visibility changes
were recorded throughout the warmup/sample. This single diagnostic shows that
the initial collapse is not an intrinsic 1 FPS limit. It also shows longer tail
stalls than either primary Spark or WebGPU arm, so mean FPS alone would mislead.
Browser/runtime-state attribution remains unresolved; a production fallback
cannot be qualified from this experiment.

A separate focused Spark recovery check returned 134.58 FPS, consistent with
the final baseline. Fresh focused WebGPU repeats were consistently below the
initial series; browser/device runtime state therefore matters. The initial
29.55% must not be presented as a fixed expected uplift. None of these figures
is a device-independent or furnished-application performance promise.

Independent review recalculated the raw intervals and checked identical source
SHA, count, SH3, camera/projection matrices, canvas, browser and zero reported
errors across all twelve initial full-room captures. Static screenshots show the same
framed wall, clock, portraits, frieze and ceiling. They establish a nonblank,
corresponding scene, not pixel equivalence or motion-artifact acceptance.

Fixed-camera evidence: [Spark](../../.codex-tmp/native-splat-20260918/full-spark.png),
[controlled Spark](../../.codex-tmp/native-splat-20260918/full-spark-controlled.png),
[native WebGPU](../../.codex-tmp/native-splat-20260918/full-native-webgpu.png),
[native WebGL](../../.codex-tmp/native-splat-20260918/full-native-webgl.png).

The first small-tile checks (442,871 SH3 splats) are display limited: Spark
237.42 FPS and native WebGL 238.25 FPS. These do not establish a useful gain.
An earlier WebGPU tile diagnostic also approached the 240 Hz ceiling; its
initial run did not serialize raw results and is excluded from the final table.

## Loader limitation and adaptation

The unmodified r186 Gaussian PLY loader failed on the full-room source with
`RangeError: Invalid array length` at `PLYLoader.js:652` while accumulating a
custom attribute. The retained `full-native-webgpu-1.log` records the failure.
Spark successfully loaded and rendered that identical full-room PLY.

The follow-up uses the same official loader on bounded contiguous record
chunks and assembles the resulting attributes into **one GaussianSplat**.
No record reduction, SH reduction, spatial subsampling or renderer/shader change
is performed. The [validation receipt](../../.codex-tmp/native-splat-20260918/chunked-loader-check.json)
proves all six decoded attributes byte-identical and bounds identical against
the whole official loader on the 442,871-record tile, divided into three chunks.
Six malformed-input checks pass. Full-room browser runs additionally verify the
original source hash, complete count and SH3 before sampling. The helper's strict
scope is one binary little-endian, float32 vertex element; it is not a general
production PLY loader replacement.
Native full-room runs additionally request a 256 MiB storage-buffer binding
limit: SH3's largest buffer exceeds the default 128 MiB device limit. This is
an explicit capability requirement, not established support on weaker devices.

Do not interpret `readyMs`, `fetchMs` or `decodeSetupMs` as product startup
comparisons. They include local delivery, hash validation and module/setup work;
the chunked loading adaptation further changes the native loading path.
`cpuSubmitMs` excludes Spark worker CPU and GPU execution. `performance.memory`
is main-thread JS memory only, not whole-process memory or VRAM.

## Migration requirements

Current product behavior that a replacement must preserve includes:

- SOG tile delivery, coarse-to-fine loading, optional RAD paging and LOD budgets.
  r186's supplied loaders cover PLY, SPLAT, KSPLAT, SPZ and glTF; no equivalent
  automatic streaming/LOD system was found. SPZ v4 LOD payload recognition is
  not the same as rendering that LOD hierarchy.
- Global ordering of multiple captured tiles. Native ordering is per splat
  object; [upstream issue 34256](https://github.com/mrdoob/three.js/issues/34256)
  tracks cross-object sorting. This experiment avoids that issue with one object.
- Spark SDF clipping in `RoomClipBox.tsx`, opacity transitions, demand-loop
  invalidation, cancellation/disposal and existing renderer lifecycle tests.
- Furniture/material/depth behavior and the actual R3F planner under the new
  renderer, plus browser fallback and physical-device performance.

Native's 2σ kernel, approximate depth bins, packed SH and different scheduling
mean the same input/count is necessary but insufficient for equal visual quality.
Static screenshot inspection is useful evidence, not photographic fidelity,
motion-artifact acceptance or founder aesthetic acceptance.

The evidence supports **qualifying a native WebGPU path with Spark retained as
the fallback**. It does not support removing Spark globally yet. The next gate
is the actual furnished planner with its current captured delivery, clipping,
transitions and save/reopen flows, tested on the target office and physical
mobile devices, with visual acceptance and measured first-view delivery. A
native path must earn promotion through those checks; this experiment does not
waive them or claim they have passed.

This task establishes the decision baseline; it does not release a speculative
renderer replacement. No paid compute, production data write or deployment is
part of this experiment.

## Verification and retained limits

The actual renderer flow loaded a hash-checked capture, verified full count/SH3,
rendered a nonblank matched view, moved the camera and recorded raw frame
intervals. Node syntax checks, official-loader attribute equivalence and six
malformed-input cases passed. Official npm integrity, installed library/source
hashes, local report links and documentation diff checks passed. Independent
review recomputed timings and identified the unqualified fallback cadence,
prompting the focused recovery rather than accepting a misleading regression.

Successful runs have no recorded runtime/GPU/context-loss errors. The retained
Spark shader signed/unsigned compiler warning and Windows WebGPU warning that
power preference is ignored are not represented as warning-free execution.
No application build was required for this isolated harness/documentation work.
All owned benchmark browser sessions and the benchmark server were stopped after use.

Repository source context was `master` at
`53a340d0a202a3100fef7f1a3e1e0456e90e3b5d` with substantial pre-existing shared
changes. No unrelated files or application dependencies were edited or committed.
The report and local evidence remain a research deliverable, not a deployed
renderer, full visual equivalence, mobile qualification or founder acceptance.

## Follow-up: final patched addon with matched radius, 18 September 2026

The original headline compared stock native's 2σ kernel with Spark's √8σ kernel.
Its additional 2σ controlled Spark arm reduced that mismatch, but neither native
arm exercised the final application patch, √8σ radius or linear colour workflow.
Therefore the original ~20% result alone was insufficient evidence for the
final implementation's renderer performance.

A later isolated run used the actual installed, patched Three r186 addon from
the migration worktree. Both engines now use √8σ, compensated blur 0.3 and all
6,019,684 SH3 room splats. The same original PLY SHA, transform, wall camera,
scripted motion, 1600 × 900 canvas, DPR 1 and 4-second warmup/12-second sampling
were retained. This still excludes the 11,296 environment splats, furniture,
application UI, SOG delivery and the production merged-source adapter's hooks.

Three fresh headed Chrome 153 processes ran serially on the same RTX 4090,
driver 616.92: native, product Spark, then controlled Spark, with three samples
per process. This fixed order is not a randomized benchmark. Native uses the
final addon with `kernelRadius: Math.sqrt(8)`, normal linear working space and
explicit splat sRGB conversion. Product Spark preserves radial sorting,
512-pixel radius cap, its default alpha cutoff and existing colour path.
Controlled Spark instead uses Z sorting, alpha cutoff zero and radius cap
`1024 * Math.sqrt(8)`, matching native's sigma-radius cap before kernel scaling.
Both Spark arms keep their original packed storage and blur settings.

| Renderer, √8σ in every arm | Median FPS, three runs | Run range | Median p95 interval | Median p99 interval |
| --- | ---: | ---: | ---: | ---: |
| Spark 2.1 / Three r180, old product settings | **134.13** | 133.62–134.33 | **16.6 ms** | **20.9 ms** |
| Spark, controlled sorting/cap/cutoff | **130.88** | 130.39–131.08 | **16.7 ms** | **20.9 ms** |
| Final patched Three r186 native WebGPU | **158.72** | 158.56–158.75 | **8.4 ms** | **12.5 ms** |

Native's median FPS was **18.33% higher than product Spark** and **21.27% higher
than controlled Spark** in this follow-up. The earlier improvement therefore
survives correcting the radius mismatch in this scene, but the precise gain
changes. These are browser frame-pacing measurements, not GPU timestamps or a
measurement of the migrated application.

The controlled arm does not prove equal visual quality. Native blends in linear
space after converting splat colour; Spark retains its existing direct colour
path (`encodeLinear: false`). Turning that Spark flag on alone would not supply
the corresponding output-colour pass. Geometry/SH packing, coefficient ranges,
depth-bin ordering and update scheduling also differ. SH3 present on both sides
does not establish identical SH precision or full source-range preservation.
The static images show the same nonblank wall/clock/portrait view; they do not
establish pixel equivalence, motion-artifact acceptance or founder approval.

Evidence is retained in
`D:/codex/venviewer-native-splats-20260918/output/playwright/native-migration/matched-footprint-20260918/`:
the nine `native-final-*`, `spark-product-*` and `spark-controlled-*` raw logs,
three PNGs, executable harness, `results.json`, `source-provenance.json` and
`validation.json`. The validator independently recalculates every FPS result,
checks identical source/count/SH/camera/canvas/browser, verifies focus remained
visible throughout each capture, and rehashes all 20 recorded source/config
files. All nine valid captures report no runtime/GPU/context-loss errors.
The native addon SHA-256 is
`a88cea324b3532236adfe74628eab7c85ec009490b9805a104b3876b1c4f7145`;
the Spark bundle remains
`c0355a962f68a6de9b13df69f05b1aba3614d9aec43a4504975daeb349126a8a`.

One first readiness attempt overlapped another graphics check and was stopped;
its incomplete log is retained and excluded. A separately reported CPU test
batch ran between valid native and Spark captures, outside their warmups and
timed intervals. All owned benchmark browsers and the local server were stopped
after sampling. No original evidence or production source was changed for this
experiment, and it does not replace exact-source release GPU qualification,
physical-device testing, loading/memory measurements or furnished-planner checks.
