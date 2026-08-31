# Grand Hall native LCC capture

This folder builds an original, fail-closed managed module that runs inside the
user's installed XGRIDS Unity `LCCEditor.exe`. It opens no network connection,
modifies no source scan, creates no architecture, and does not use
SplatTransform or another renderer as a native proxy.

That network statement is limited to the first-party module: its source and
compiled IL reference no network API. No packet capture is performed, so this
folder does not claim that the separately supplied vendor editor, licensing
service, operating system, or GPU driver is network-silent.

The module exists for one evidence task only: render the locked canonical
`scans_BIG_MODEL_TH_GH_1` native LCC2 at one exact inspection camera and produce
a diagnostically bounded 1600x900 raw Unity-Gamma UNorm RGB24 display-code
frame, an identity-mapped sRGB-tagged PNG8, an exact `value*257` sRGB-tagged
PNG16 expansion that adds no precision, and a machine-readable receipt. The
owned-request capture contract is module `1.7.0`, native receipt schema `v14`,
and operator receipt schema `v4`.

## What is authoritative

- Canonical scene:
  `C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_1\lcc2-result\Grand_Hall.lcc2`
- Manifest SHA-256:
  `927A92699DE222E99D2684CA2567A35AB1E523A036461E6E01236B7B77B7F659`
- The module verifies the exact 60-file, 214,350,601-byte package before and
  after capture, including member hashes and unchanged last-write timestamps.
  Its ordered `relativePath|byteLength|SHA256\n` inventory digest is
  `6013763AE4D9FA13CB10D2C62E9B11B971BC2F22420CA2ADE6F736AEECC4B793`.
  Paths are platform-native relative Windows paths in the locked receipt
  sequence; each record uses the uppercase file SHA-256 and
  one LF. The exact allowlist separately rejects every missing, extra,
  case-different, or changed member.
- Source-space camera position: `[-4.774913, -16.59914, -0.687065]`
- Source-space target: `[-4.5826875, -8.392191, -0.687065]`
- Source-space up: `[0, 0, 1]`
- The public `ILCCSceneManager.LCCObjectToWorldSpace` conversion is applied at
  runtime. For the zero-offset GH_1 LCC2 it must produce position
  `[4.774913, -0.687065, 16.59914]`, target
  `[4.5826875, -0.687065, 8.392191]`, and up `[0, 1, 0]` within `1e-5`, or the
  run fails.
- Projection: vertical FOV `60`, near `0.05 m`, far `80 m`, aspect `16/9`.

These camera values are sourced from `camera-profile.json`, not duplicated as
numeric C# constants. The module and wrapper require its exact SHA-256
`9ECA9B6582B7301EC1C059B1A5BE699E5A4983773AFECB2BEEA46C2668305922`.
The profile binds the XGRIDS LCC2 source, LCCEditor native Unity, and browser
Three.js frames, including the exact Three.js target used by the browser
receipt. It remains inspection-only and `authority: none`.

The target is deliberately an inspection-only horizontal q05/q95
pose-envelope centre. It is **not** a calibrated source-camera orientation.
The output therefore remains diagnostic, `authority: none`, and cannot by
itself accept Grand Hall scope, a room transform, or architectural truth.

## Why this is a genuine native lane

`LCCEditor.exe` itself loads the `.lcc2` and renders through the installed
LCCSDK. The module uses public, inspectable managed contracts already shipped
with that application:

- `IModule` and `IContainer.Resolve<T>()` for plugin loading;
- `IEventBus`, the exact global `modules.loaded` lifecycle event,
  `lccscene.load.begin`, and `lccscene.loaded`, for lifecycle completion and
  the vendor's pre-`Renderer.Load(...)` full-render latch;
- `IProjectManager.CreateTemporaryLCCProject(path)` and
  `ISceneManager.LoadDefaultScene()` for the vendor's high-level project and
  scene-load workflow;
- `ILCCSceneManager.LCCObjectToWorldSpace`, `SetMainCamera`, `SetFOV`,
  `SetRecordMode`, `SetLockFPS`, and `ForceRerenderer`;
- `ICameraService.SetTransform` for the numeric pose;
- `ISceneManager.SceneCamera` for the exact Unity camera and clean-view flags;
- `GraphicsSettings.currentRenderPipeline`,
  `UniversalRenderPipelineAsset.rendererDataList`/`renderers`,
  `ScriptableRendererData.rendererFeatures`/`useNativeRenderPass`, and
  `ScriptableRendererFeature.isActive` for a synchronous, read-only inventory
  of configured renderer data, already-instantiated renderer slots, and feature
  identity/active state before and after each request operation;
- the locked `UniversalRenderPipeline.SingleCameraRequest` request type plus
  `RenderPipeline.SupportsRenderRequest` and `SubmitRenderRequest` for a
  synchronous render into a module-owned exact destination;
- `RenderPipelineManager.beginContextRendering`, `beginCameraRendering`,
  `endCameraRendering`, and `endContextRendering` for an exact four-event
  transcript tied to the scene camera, requested pose, projection, and owned
  destination;
- `ICameraService.SetTransform` for one discarded 5 cm camera sentinel and the
  exact restoration, yielding two distinct request renders without mutating a
  renderer feature;
- a module-owned, depthless, single-sample, mipless 1600x900
  `R8G8B8A8_UNorm` `RenderTexture` requested with `sRGB=false` in required
  Unity Gamma colour space, plus `RenderTexture.active`, a first-party
  no-mipmap RGB24 `Texture2D`, `Texture2D.ReadPixels()`, and
  `Texture2D.Apply()` for direct readback; and
- `Texture2D.GetPixels32()` for decoded raw Unity-Gamma UNorm display-code
  admission, followed by a literal integrity-checked identity LUT for PNG8 and
  an exact 8-to-16 `value*257` expansion LUT for PNG16, with deterministic local
  encoding and explicit `sRGB`, `gAMA`, and `cHRM` chunks.

The stock executable has no camera/screenshot command-line arguments. The
installed Qt editor has camera IPC but no demonstrated colour-raster capture
endpoint. This in-process first-party module is the available native path.

The renderer inventory and request route deliberately do not call
`UniversalAdditionalCameraData.scriptableRenderer`,
`UniversalRenderPipelineAsset.scriptableRenderer`,
`UniversalRenderPipelineAsset.GetRenderer`, `SetRenderer`, `SetDirty`, or
`SetActive`: locked Unity IL shows those paths can create, destroy, replace, or
retarget runtime state. Public side-effect-free APIs do not expose the camera's
serialized renderer index. A sole non-null renderer-data/renderer pair is
therefore labelled an inference, never an observed camera binding. Feature
`isActive` is only the serialized base toggle; it is not proof that
`AddRenderPasses` ran for this camera. Null renderer slots are inventoried but
never instantiated by this module. The request route also does not call the
`UniversalAdditionalCameraData.cameraStack` getter because the locked getter
can traverse renderer state; the public single-camera request contract bypasses
camera stacks.

The locked editor loads managed modules through `Init()` but does not invoke
the loader's `ExecuteAll()` in the observed startup path. The module therefore
subscribes in `Init()` to the editor's exact `modules.loaded` event, removes
that handler once the current vendor event dispatch has unwound, and only then
schedules guarded `Execute()` for the next Unity frame. The deferred removal is
required because the locked vendor EventBus enumerates the same mutable
subscriber list that `Unsubscribe()` edits. Separate Interlocked one-shot gates
reject duplicate event or execution delivery. `Stop()` and `Dispose()` remove
any pending lifecycle subscription, so an editor shutdown cannot leave the
bridge armed. Public `Stop()` is terminal: it cooperatively aborts any active
owned request operation at its next cancellable player-loop await; scene-load
callbacks, watchdogs, readiness waits, convergence waits, and later async
continuations reject new work. Successful internal scene-load completion
removes its `lccscene.load.begin` and `lccscene.loaded` subscriptions only after
the current event dispatch has unwound and does not enter that terminal state.
A stop during capture is surfaced through the existing failure receipt. The
operation's `finally` path restores and verifies the exact source camera and
original camera target, removes all four SRP subscriptions, restores
`RenderTexture.active`, releases and destroys only its owned render target, and
destroys any untransferred readable textures.

## Safety and failure behavior

The module is inert unless all eight environment variables in the launch
recipe below are present. An armed run fails closed when any of these drift:

- scene path, exact 60-member source inventory, byte lengths, hashes, or timestamps;
- camera-profile bytes, digest, frame identifiers, projection, output, or
  inspection-only/environment-exclusion gates;
- the exact approved disposable editor path or any reparse-point ancestor;
- the complete bounded 890-file editor inventory, including `UnityPlayer.dll`,
  Unity data/resources, native plugins, Mono runtime files, D3D12 runtime, and
  every enabled stock module manifest/DLL/asset;
- module or `plugin.json` hash from the local build receipt;
- runtime source-to-native camera conversion or applied camera transform;
- projection or PNG dimensions;
- output directory safety/emptiness;
- progressive convergence.

The module requests `Ultra` through `IRendererQualityService`, then subscribes
the stable `Func<EventArg<bool>, bool>` handler for the exact
`lccscene.load.begin` topic at `Int32.MaxValue` before
`LoadDefaultScene()`. That synchronous handler calls `SetRenderAll(true)`
before the vendor's `Renderer.Load(...)`. The pending value written by
`SetRenderAll` and the active loaded-dataset value returned by `IsRenderAll`
are distinct vendor fields, so the module deliberately makes no immediate
read-back claim. It instead requires `IsRenderAll()` to be true after the
matching `lccscene.loaded` event and at every later render gate. The locked
vendor IL proves that
`SupportFullRender(Ultra)` is not an API-capability flag: it compares the
current scene's finest-LOD splat count with Ultra's configured `3000` budget.
The canonical package reports 6,019,684 finest-LOD splats, so that predicate is
false by construction. The module records the value as vendor budget-eligibility
telemetry and does not use it in place of the post-load active-mode read-back.
Because the public API exposes no loaded-splat residency count or
streaming-completion metric, `IsRenderAll` is not presented as proof that every
possible Gaussian is resident. After `lccscene.loaded`, the module additionally
requires a conservative minimum of 300 rendered frames and 15 seconds before
sampling.
Attempts are spaced by another 15 rendered frames, and every clean-view flag,
camera value, projection value, Ultra quality, full-render mode, and canonical
scene identity is re-asserted throughout. Three consecutive byte-identical
lower-left raw `R8G8B8A8_UNorm` RGB24 hashes establish the same-host plateau before any
display transfer or PNG encoding. The run stops after 60 attempts or 180
seconds. Each individual SingleCameraRequest operation has a 30-second cooperative
Unity-player-loop deadline with no retry after an observed timeout.
That deadline cannot preempt a blocked Unity main thread or GPU synchronization;
the wrapper's 900-second process watchdog is the hard termination boundary.
The cooperative wait also races terminal `Stop()` on the Unity update loop. No
vendor capture task is launched, retained, or allowed to finish after receipt
publication.
Each attempt is added to the receipt before capture begins, so a timeout, black
raster, surface drift, or other failure remains visible instead of disappearing
with an exception.

The capture operation permits `RenderPipelineManager.currentPipeline` to be
null at entry. It first records the locked
`GraphicsSettings.currentRenderPipeline` asset and a public-getter-only
renderer-data/feature configuration inventory, without forcing a missing
renderer instance. It requires `QualitySettings.activeColorSpace == Gamma`,
then creates one module-owned `R8G8B8A8_UNorm` 1600x900 `Tex2D` destination
with `sRGB=false`, depth disabled, one sample, one mip, no dynamic scale, and no
random writes. Every target observation separately receipts the requested and
effective graphics format/sRGB state; any difference fails the attempt.

A capability-only `RenderPipeline.SupportsRenderRequest` preflight is bound to
that exact owned destination at mip 0, slice 0, and `CubemapFace.Unknown`. It
runs exactly once before either rendered request and outside all render
callbacks. In locked Unity 6000.0.60f1 this public call may initialize the
runtime URP when `currentPipeline` was null. That transition is Unity-owned, may
create renderer instances, is explicitly receipted, and is permitted only
inside the disposable editor process. The module does not claim renderer
instance identity remained stable across initialization, does not claim that no
runtime lifecycle mutation occurred, and does not claim persistent
`RenderPipelineAsset` mutation. Process exit owns the lifetime of any renderer
instance Unity creates.

The persistent renderer-data and feature configuration signature excludes
runtime renderer instances and must remain byte-identical across the capability
preflight. Only after runtime initialization is established does the module
record the full renderer-state signature, including renderer instances. That
post-initialization baseline must remain stable through the sentinel request,
the exact request, and their per-request capability checks.

Locked URP IL shows that this exact `SingleCameraRequest` shape temporarily
binds its destination to the requested camera, renders that camera through the
ordinary URP context, submits, and restores the original camera target. The
module never pre-assigns `Camera.targetTexture`; its only setter is a defensive
`finally` restoration to the saved original value. It does not use
`CommandBuffer.Blit`, `Graphics.Blit`, `CopyTexture`, `Camera.Render`, a manual
`ScriptableRenderContext.Submit`, or the obsolete `RenderSingleCamera` helper.
It never activates, creates, disposes, retargets, or dirties renderer features.

The locked LCCWorld meaning of `SceneCameraScreenRenderer` is counterintuitive
but explicit: its getter returns true exactly when the vendor `m_tempRT` is
null. Setting it false allocates that vendor temporary render target and assigns
it to `Camera.targetTexture`; setting it true releases the temporary target and
restores a null camera target. The production route therefore requires
`SceneCameraScreenRenderer == true` before and after capture together with an
original `Camera.targetTexture == null`. The older “disabled/false” description
was backwards and is not retained by receipt v14.

With that null-target baseline established, URP alone temporarily binds the
exact module-owned request destination during each `SingleCameraRequest`
callback transcript, then restores the camera to null. The module does not
toggle `SceneCameraScreenRenderer` and does not create, use, release, or destroy
the vendor `m_tempRT`.

Freshness is proven with two separate synchronous requests. The first uses a
deterministic 5 cm camera sentinel and is discarded after decoded-raster
admission. The exact camera is then restored before the second request. Both
requests must produce exactly `beginContext`, `beginCamera`, `endCamera`,
`endContext`, in that order and one frame, for only the exact camera while its
target is the owned destination. The sentinel and exact decoded RGB hashes must
be non-degenerate and different. Renderer-data, renderer-instance, feature
identity, and serialized active-state signatures must match before and after.
Each invocation calls `SupportsRenderRequest` exactly once and
`SubmitRenderRequest` exactly once. Submission is performed by the request
method itself; none of the four callback observers can submit or recursively
render.

Fresh XGRIDS projects also create one self-mode camera marker and one avatar
spawn marker. Their default world coordinates project to the two unwanted
central symbols in the earlier v10 image. Version 1.7.0 therefore discovers
exactly one loaded, active, enabled owner/element/`AnchorScale3D` chain for each
role, inventories every descendant `UnityEngine.Renderer`, and requires at
least one initially visible renderer per role. It rejects duplicate owners,
inactive duplicate elements, changing renderer closure, Canvas/Camera/custom
render callbacks, LCC renderers under either anchor, scene dirtiness, or any
identity/hierarchy/layer drift. Only `Renderer.forceRenderingOff` is leased;
the exact prior value of every target is restored in reverse order before
post-render state checks and again through a retryable first `finally` cleanup.
No GameObject is deactivated and no renderer feature is changed.

Every request readback saves the prior `RenderTexture.active`, activates and
verifies the owned destination, creates a distinct readable no-mipmap RGB24
`Texture2D`, calls `ReadPixels()` and `Apply()`, and restores and verifies the
prior active target in `finally`. The raster gate rejects all-black and
near-constant frames using minimum non-black-pixel fraction, channel range,
distinct-colour count, and luminance variation. The admitted exact-pose bytes
are first preserved unchanged as lower-left raw `R8G8B8A8_UNorm` RGB24 code
values. The descriptor proves no hardware sRGB target encoding; it does not by
itself prove linear-light photometry or an exact photometric transfer. Receipt
v14 explicitly sets `rawRgb24LinearLightPhotometryClaimed: false` and
`exactPhotometricTransferClaimed: false`. The PNG8 derivative preserves every
source code value unchanged after the lower-left-to-top-left row reversal and
tags the PNG as sRGB for browser display. PNG16 expands each 8-bit value exactly
to `value*257`; `expanded16AddsPrecision: false` records that it adds no
information or precision.
Both PNGs are encoded deterministically with the exact chunk order
`IHDR,sRGB,gAMA,cHRM,IDAT,IEND`, filter zero, stored DEFLATE blocks, CRCs and
Adler-32. An independent strict decoder verifies metadata, checksums,
orientation, decoded samples, dimensions, trailing-byte absence, and durable
file hashes before publication.

Screen-space-overlay canvases are excluded by URP's non-null-target contract.
The module inventories them, rejects every active world-space Canvas and
screen-space-camera Canvas that can render through the scene camera, rejects
known capture overlays and capture view, and requires a full-clear URP base
camera with the exact full-screen viewport. Grid, gizmo, trajectory, and
interaction helpers must remain disabled at every checkpoint; the locked
screen-renderer getter must remain true, proving its vendor temporary target is
absent.

The installed renderer may still contain vendor features, including
`SnapFrameCaptureFeature`; v1.7.0 does not claim to prevent Unity from
instantiating or executing configured vendor features while establishing or
rendering the pipeline. The production lane never invokes the SnapFrame API,
activates or targets the feature, uses `FrameRT`, or uses SnapFrame pixels as
its destination or readback source. The request-owned destination is the sole
configured pixel source for this lane. A private legacy SnapFrame operation
remains compiled for forensic continuity, but it has no production call site;
the verifier requires its old timeout method to have only its declaration and
requires the live capture path to construct only `SingleCameraRenderRequestOperation`.

The module also inventories active `LCCCore.CameraDraw` components. The locked
vendor call graph shows that this end-camera callback can reach a 78-by-13
bottom-right watermark draw, so it is a potential pixel contributor even
though the first-party callbacks are observation-only. That inventory is
diagnostic evidence, not proof of absence or harmlessness. The receipt requires
`visualQaRequired: true`, records orientation as
`unverified_pending_visual_qa`, and keeps
`finalSourceFaithfulAcceptanceClaimed: false`. A successful PNG therefore
remains diagnostic until authenticated visual QA compares it with the locked
Grand Hall evidence for orientation, invented openings, dark central floor,
neighbouring rooms, facade, generated fill, watermark, or other callback
contamination.

The receipt records `SystemInfo.graphicsDeviceType`,
`SystemInfo.graphicsUVStartsAtTop`, the required Gamma Unity colour space,
separate requested/effective target graphics format and sRGB state, the
lower-left `ReadPixels` coordinate origin, and
the applied CPU row transform (`none`). These values make the orientation and
colour path inspectable; they do not prove that the resulting D3D render is
visually upright. If QA finds inversion, the implementation must apply and
receipt one deterministic vertical row flip before matched-camera metrics.

Capture-level provenance distinguishes the configured pixel source from an
actually observed source. `configuredPixelSource` declares the required lane;
`observedPixelSource` remains null until an attempt completes first-party
readback, and `everyObservedPixelSourceMatchesConfigured` remains false when no
source was observed. These aggregates are recomputed from all retained attempts
after both accepted and rejected outcomes, so a failure receipt cannot imply
that configured pixels were produced.

The per-attempt timeout observes the module-owned SingleCameraRequest operation. On an
observed cooperative timeout or terminal `Stop()`, cancellation is consumed at
the next player-loop await and the same operation restores the exact camera and
owned state before it completes. `SubmitRenderRequest` itself is synchronous
and cannot be cooperatively cancelled. Cleanup failure is never hidden behind
the initiating failure. The disposable process remains the final boundary for
a blocked Unity main thread, GPU synchronization, or native driver call. Only a
successful attempt claims a complete request transcript and owned-target
cleanup.

The canonical inventory contains `data/3dgs/env.sog`, but browser-frontier
parity excludes it. The module therefore calls `SetEnvironmentData(false)` and
receipts `environmentDataIncluded: false`, the exclusion reason, and the
request itself. XGRIDS exposes no public environment-visibility getter, so the
receipt explicitly records `environmentVisibilityGetterAvailable: false` and
does not claim a read-back value. The auto-quit disposable process bounds the
unknown prior visibility state.

Every successful public mode mutation records its cleanup state immediately.
Record mode, locked FPS, the environment request, and the pre-load render-all
latch are cleaned up independently so one failing vendor cleanup call does not
suppress the others. A fresh disposable process proves the pending render-all
default is false before the load-begin request. Cleanup therefore requests
`SetRenderAll(false)` for the next load. The vendor exposes no public pending
field getter, so the receipt records that the reset call completed but that no
pending-reset read-back exists; disposable-process exit is the final isolation
boundary, not a fabricated restoration observation.

The module writes only beneath a new, explicitly supplied empty output
directory. It refuses output inside either the source package or disposable
editor. It auto-quits the disposable editor with code `0` on success or `2` on
failure.

An armed run also requires a fresh editor process with no project, current
scene data, or loaded LCC. It hashes the canonical source package and complete
disposable-editor closure, subscribes to `lccscene.load.begin` and
`lccscene.loaded`, and asks the public project manager to create a temporary
project from the exact canonical GH_1 path. The module requires successful
creation, initialized/temporary state, non-null current scene data, and an LCC
asset whose final resolved path is the same canonical path. Both exact handlers
must be accepted before it calls the public
`ISceneManager.LoadDefaultScene()`.
No positional scene argument is used. After the exact event, capture begins
only when `GetRendererHandlerByPath(canonicalPath)` returns a handler with the
same exact path and `IsSceneLoaded(canonicalPath)` succeeds. Any stale project,
wrong generated asset/event/handler path, null handler, rejected default load,
or missing event fails closed. Source and runtime-closure identities are
rechecked after loading and after capture.

## 1. Build and verify offline

No .NET SDK and no download are needed. `build.ps1` uses the installed Roslyn
4.14 compiler and references the already-installed managed assemblies in
`F:\LccStudio\lcceditor\LCCEditor_Data\Managed` without copying them.

From this folder:

```powershell
Set-Location 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime\tools\reconstruction-foundry\native\grand-hall-lcc-native-capture'
& .\build.ps1
```

The default build:

1. verifies every locked vendor dependency;
2. compiles and runs pure policy tests;
3. hashes the complete live 214,350,601-byte canonical native package twice;
4. compiles `out\VenviewerNativeCapture.dll`;
5. inspects its IL for the required public request/readback calls and rejects
   blit, copy, manual-submit, direct-render, camera-stack, and renderer-mutation
   calls inside the production request operation;
6. creates `out\runtime-closure-lock.json` for every regular file in the
   installed editor tree except the first-party module directory;
7. rejects network references, unfinished-code markers, and copied vendor
   binaries;
8. runs a synthetic run-bounded `Player.log` extraction/classification self-test;
9. writes `out\build-receipt.json`.

`-SkipLiveSourceVerification` is available only for source-code iteration. Do
not install or run a build receipt created with that switch.

## 2. Make a disposable local editor copy

Do not place the module in `F:\LccStudio\lcceditor`. Use a disposable copy so
the installed vendor tree remains untouched. The following commands refuse an
existing destination:

```powershell
$sourceEditor = [IO.Path]::GetFullPath('F:\LccStudio\lcceditor')
$sandboxRoot = [IO.Path]::GetFullPath('C:\Users\blake\AppData\Local\Venviewer\lcc-native-capture-sandbox')
$sandboxEditor = Join-Path $sandboxRoot 'lcceditor-0.15.0.7'

if ($sourceEditor -ne [IO.Path]::GetFullPath('F:\LccStudio\lcceditor')) {
    throw 'Unexpected source editor path.'
}
if (Test-Path -LiteralPath $sandboxEditor) {
    throw "Disposable editor already exists: $sandboxEditor"
}
New-Item -ItemType Directory -Path $sandboxRoot -Force | Out-Null
Copy-Item -LiteralPath $sourceEditor -Destination $sandboxEditor -Recurse
```

This copy is for local internal execution only. It must not be committed,
uploaded, redistributed, patched, or used to bypass XGRIDS/CodeMeter
licensing.

## 3. Install only the first-party module in the disposable copy

```powershell
$moduleRoot = 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime\tools\reconstruction-foundry\native\grand-hall-lcc-native-capture'
$moduleDestination = Join-Path $sandboxEditor 'Modules\Venviewer Native Capture'
if (Test-Path -LiteralPath $moduleDestination) {
    throw "Module destination already exists: $moduleDestination"
}
New-Item -ItemType Directory -Path $moduleDestination | Out-Null
Copy-Item -LiteralPath (Join-Path $moduleRoot 'plugin.json') -Destination $moduleDestination
Copy-Item -LiteralPath (Join-Path $moduleRoot 'out\VenviewerNativeCapture.dll') -Destination $moduleDestination
Copy-Item -LiteralPath (Join-Path $moduleRoot 'out\runtime-closure-lock.json') -Destination $moduleDestination
Copy-Item -LiteralPath (Join-Path $moduleRoot 'out\camera-profile.json') -Destination $moduleDestination
```

Only `plugin.json`, `VenviewerNativeCapture.dll`, the digest-bound
`camera-profile.json`, and the generated hash-only `runtime-closure-lock.json`
are added. No XGRIDS DLL is copied into the repository or module directory.

## 4. Launch the deterministic capture

Use the reviewed operator wrapper. Do not invoke `LCCEditor.exe` directly. The
wrapper verifies the installed first-party module artifacts, sets and later
restores all eight process-local arm variables, starts the exact approved
disposable editor, and imposes a non-configurable 900-second hard wall-clock
deadline around the entire native process. That outer deadline includes the
synchronous source/editor hashing that occurs before the in-module scene-load
watchdog begins.

Module inclusion is controlled by the per-user encrypted feature-toggle file;
the installed `AuthorityProvider.CheckModuleAuthority` implementation is not a
module-inclusion gate. Before launch the wrapper requires no running
`LCCEditor` process and requires the exact reviewed original
`module_toggles.dat` SHA-256
`8FF16CAC30F3F49A71BE9A06D486B1BB9B682E0CCF1C5C35869A251D98313531`.
Using the installed public `XGrids.LCCWorld.Common.Utils.EncryptUtil`, it makes
a durable exact-byte backup plus recovery marker and adds only
`com.venviewer.native_capture` with `enabled=1`; every stock module ID/name/
enabled value is checked unchanged. The editor receives no positional scene
argument. After the child terminates (including timeout termination), the
wrapper makes a second bounded termination attempt against only its owned PID
if needed, then requires that no owned or unexpected `LCCEditor` process remain
before it atomically restores the original bytes and restores the pre-read
creation, last-write, last-access timestamps and attributes exactly. It records
original, augmented, pre-restore, and restored hashes plus metadata equality in
the operator receipt. A later invocation repairs a complete stale lease before
acquiring a new one. If the active lease target unexpectedly drifted, the run
fails but restores the durable reviewed original only after every editor has
exited, so an unknown permissive configuration is not left behind. If any editor
remains alive after the owned-process termination attempts, the run fails loudly
and deliberately retains the durable backup and lease marker for stale recovery
instead of racing a vendor write.

The wrapper never edits a vendor binary, CodeMeter/service state, licensing
material, or a stock module ID. `-LeaseSelfTest` exercises augmentation,
ordinary restoration, and stale-lease recovery against a temporary copy only;
it never launches LCCEditor. `-PlayerLogAuditSelfTest` exercises prefix
exclusion, exact receipt binding, the requested-sRGB warning detector, exact
startup DBufferClear ERROR classification, exact WindowsMediaFoundation
unknown-color-primaries limitation classification, the five known post-receipt
Tooltip/ResCache shutdown blocks, the one known post-receipt Environment
OnDisable shutdown block, a complete exception-free shutdown, and adversarial
wrong-count, mixed, reordered, extended, pre-receipt, incomplete,
ERROR/warning/exception rejection against synthetic temporary logs only; it
also never launches LCCEditor.

On timeout, the wrapper terminates the disposable editor process tree and emits
an atomic operator receipt. A forced timeout can prevent in-process cleanup,
which is why the wrapper never targets the vendor installation and the sandbox
is disposable. The editor window is deliberately hidden because this is an
unattended evidence capture: visible UI and operator interaction must not affect
the raster. If XGRIDS or CodeMeter requires a licence dialog, it will remain
unanswered and the run will time out; resolve licensing through the normal
vendor workflow before retrying rather than making this capture interactive.

The operator receipt records and the wrapper fail-closes on the build-receipt
schema, offline/vendor-copy flags, all verification flags, and the exact build
receipt, module, plugin, runtime-closure-lock, and closure-inventory hashes. It
also binds the live `run-capture.ps1` byte length and SHA-256 to exactly one
matching build-receipt `sources[]` entry, and verifies the native receipt's
`.sha256` sidecar content rather than merely its existence.
`build.ps1` writes a pending receipt for offline verification and publishes
`build-receipt.json` only after that verifier exits successfully; a failed
verification leaves no optimistic final receipt.

After the editor process exits, the wrapper reads the fixed vendor
`Player.log`, selects only the bytes from the last exact approved-sandbox Unity
startup marker through EOF, and publishes those exact bytes as
`grand-hall-native-capture-player-log-run.log`. The operator receipt binds the
source log's pre/post fingerprints, excluded prefix length, run-log byte length
and SHA-256, strict UTF-8 decode, and the unique current native-receipt marker.
This excludes unrelated earlier log content while retaining capture-time
warnings and post-receipt shutdown output. Any requested-sRGB fallback warning,
unexpected ERROR line, unexpected WindowsMediaFoundation line, or unclassified
exception diagnostic fails the operator run. Every accepted profile requires
one exact native-receipt marker and one exact terminal Input System shutdown
marker at EOF, so a clean-looking truncated log cannot pass.

The closed shutdown-profile set is
`venviewer.grand-hall.lcc-native-shutdown-profile-set.v1` and contains exactly
three mutually exclusive profiles:

- `clean_shutdown_no_exceptions`: no exception header, object-name, or stack
  diagnostic line occurs in the complete run slice; `exceptionFree: true`;
- `tooltip_rescache_object_disposed_x5`: five consecutive exact six-line
  `ObjectDisposedException` blocks from
  `ResCacheManager<Object>[ResManager.Resources.Object]` through
  `TooltipControl.TruncatedTextTooltip.OnDestroy`; and
- `environment_on_disable_null_reference_x1`: one exact nine-line
  `NullReferenceException` block from Unity `ThrowHelper` through
  `RuntimeAsset.OnDisable`, immediately after the native-receipt marker.

The latter two profiles are distinct named vendor-shutdown limitations and
record `exceptionFree: false`; they are not ignored exceptions. They were
observed in artifact-complete, exit-code-zero runs across two first-party module
builds with the same locked vendor runtime, but the evidence does not establish
that vendor shutdown order is nondeterministic or identify why the shape
changed. Wrong counts, mixed profiles, wrong ordering or phase, pre-receipt
occurrences, extra/interleaved frames, or any diagnostic line not fully
consumed by the selected exact block fail closed. The classified DBufferClear
line likewise leaves `errorFree: false`, and the classified media warning
leaves `windowsMediaFoundationWarningFree: false`. The media warning is retained
as a limitation, not evidence that it affected the SOG render. The run-specific
log remains the full source for human review.

This implementation task documented the following command but did
**not** run it:

```powershell
Set-Location 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime\tools\reconstruction-foundry\native\grand-hall-lcc-native-capture'
& .\run-capture.ps1
```

Expected success files:

- `grand-hall-native-capture-1600x900.png`
- `grand-hall-native-capture-1600x900.srgb-tagged-expanded16.png`
- `grand-hall-native-capture-1600x900.unorm-lower-left.rgb24`
- `grand-hall-native-capture-receipt.json`
- `grand-hall-native-capture-receipt.json.sha256`
- `grand-hall-native-capture-player-log-run.log`
- `grand-hall-native-capture-operator-receipt.json`
- up to three each of `.native-candidate-*.png`,
  `.native-srgb-tagged-expanded16-candidate-*.png`, and
  `.native-unorm-rgb24-candidate-*.rgb24` convergence witnesses

On failure, inspect `grand-hall-native-capture-operator-receipt.json`, then any
`grand-hall-native-capture-failure-receipt.json`, and the run-specific log
artifact when extraction completed. The operator receipt also records the
source XGRIDS log at
`C:\Users\blake\AppData\LocalLow\XGrids\LCCEditor\Player.log`. A failure
receipt is still `authority: none`; it is diagnostic, not an accepted artifact.

## License boundary

The user's rights statement covers the supplied venue data. It does not by
itself establish a right to redistribute or modify XGRIDS software. No
top-level XGRIDS EULA was found in the installed tree during the read-only
audit; only third-party license files were present. This implementation
therefore stays on the conservative boundary: locally reference and run the
installed editor's public managed contracts, keep all source and DLL output
first-party, do not ship vendor assemblies, do not patch protection/licensing,
and confirm XGRIDS terms before distributing this module or any editor bundle.
