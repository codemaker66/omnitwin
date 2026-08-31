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
a conditionally clean 1600x900 diagnostic PNG plus a machine-readable receipt.
The read-only renderer-inventory contract is module `1.2.7` and native receipt
schema `v7`.

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
  of configured renderer data, already-instantiated renderer slots, and the
  SnapFrame singleton relationship before the first capture attempt;
- `LCCCore.SnapFrameCaptureFeature.Instance`, `TargetCamera`, `FrameRT`, and
  `FrameDirty` for read-only access to the renderer feature already activated
  by the vendor's loaded-world workflow;
- `RenderPipelineManager.beginCameraRendering` and `endCameraRendering` for
  exact-camera, exact-pose, projection, frame, and dirty-state evidence across
  a four-stage freshness handshake;
- `ICameraService.SetTransform` for one discarded 5 cm camera sentinel and the
  exact restoration that forces the vendor SnapFrame pass to refresh without
  toggling the pass or replacing its target camera;
- `RenderTexture.active`, a first-party no-mipmap RGB24 `Texture2D`,
  `Texture2D.ReadPixels()`, and `Texture2D.Apply()` for direct readback of the
  stable vendor-owned `FrameRT`; and
- `Texture2D.GetPixels32()` plus `ImageConversion.EncodeToPNG()` for decoded
  RGB admission followed by local PNG encoding.

The stock executable has no camera/screenshot command-line arguments. The
installed Qt editor has camera IPC but no demonstrated colour-raster capture
endpoint. This in-process first-party module is the available native path.

The renderer inventory deliberately does not call
`UniversalAdditionalCameraData.scriptableRenderer`,
`UniversalRenderPipelineAsset.scriptableRenderer`,
`UniversalRenderPipelineAsset.GetRenderer`, `SetRenderer`, `SetDirty`, or
`SetActive`: locked Unity IL shows those paths can create, destroy, replace, or
retarget runtime state. Public side-effect-free APIs do not expose the camera's
serialized renderer index. A sole non-null renderer-data/renderer pair is
therefore labelled an inference, never an observed camera binding. Feature
`isActive` is only the serialized base toggle; it is not proof that
`AddRenderPasses` ran for this camera. Null renderer slots are inventoried but
never instantiated by this module.

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
SnapFrame operation at its next end-of-frame await; scene-load
callbacks, watchdogs, readiness waits, convergence waits, and later async
continuations reject new work. Successful internal scene-load completion
removes its `lccscene.load.begin` and `lccscene.loaded` subscriptions only after
the current event dispatch has unwound and does not enter that terminal state.
A stop during capture is surfaced through the existing failure receipt. The
operation's `finally` path restores and verifies the exact source camera,
removes both SRP subscriptions, restores `RenderTexture.active`, and destroys
only its own temporary readable textures.

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
scene identity is re-asserted throughout. Three consecutive byte-identical PNGs
establish a same-host hash plateau. The run stops after 60 attempts or 180
seconds. Each individual SnapFrame operation has a 30-second cooperative
Unity-player-loop deadline with no retry after an observed timeout.
That deadline cannot preempt a blocked Unity main thread or GPU synchronization;
the wrapper's 900-second process watchdog is the hard termination boundary.
The cooperative wait also races terminal `Stop()` on the Unity update loop. No
vendor capture task is launched, retained, or allowed to finish after receipt
publication.
Each attempt is added to the receipt before capture begins, so a timeout, black
raster, surface drift, or other failure remains visible instead of disappearing
with an exception.

Locked IL shows that the vendor's `SnapFrameCaptureFeature` blits the scene
camera target at `AfterRenderingTransparents` into an ARGB32 `FrameRT` when its
public `FrameDirty` predicate detects a camera change. The module never calls
`SetActive`, never writes `TargetCamera`, never writes or destroys `FrameRT`,
and never assigns `Camera.targetTexture`. It requires the existing feature to
be active, bound to the exact scene camera, and backed by one stable, live,
created, single-sample, 1600x900, no-mipmap `FrameRT` throughout the attempt.

The freshness proof spans four strictly increasing exact-camera end callbacks:
an unchanged exact baseline with `FrameDirty=false`; a deterministic 5 cm
sentinel with `FrameDirty=true`; restoration of the exact pose with
`FrameDirty=true`; and an unchanged exact frame with `FrameDirty=false`. The
sentinel is read and analysed only as discarded evidence. Its non-degenerate
RGB hash must differ from the final exact-pose RGB hash. The exact pose,
world-to-camera matrix, projection, camera identity, target binding, surface
identity, and callback history must all survive the sequence.

Every first-party readback saves the prior `RenderTexture.active`, activates
and verifies the vendor-owned `FrameRT`, creates a readable no-mipmap RGB24
`Texture2D`, calls `ReadPixels()` and `Apply()`, and restores and verifies the
prior active target in `finally`. The raster gate rejects all-black and
near-constant frames using minimum non-black-pixel fraction, channel range,
distinct-colour count, and luminance variation. Only an admitted exact-pose RGB
frame is encoded, durably written without replacement, validated for PNG
dimensions, and hash-checked against the encoded bytes.

`FrameRT` is specifically the camera target after transparents and before later
post-processing or overlay composition; it is not claimed to be the final
visible framebuffer. The module therefore inventories active canvases, rejects
every active world-space Canvas and screen-space-camera canvases that can render through the scene
camera, rejects known capture overlays and capture view, and requires a single
unstacked URP base camera with null target texture and the exact full-screen
viewport. Grid, gizmo, trajectory, interaction, and screen-renderer helpers
must remain disabled at every checkpoint. These gates reduce contamination;
they do not replace visual QA.

The receipt also records `SystemInfo.graphicsDeviceType`,
`SystemInfo.graphicsUVStartsAtTop`, the active Unity colour space, the stable
FrameRT graphics format and sRGB flag, the lower-left `ReadPixels` coordinate
origin, and the currently applied CPU row transform (`none`). These values make
the orientation and colour path inspectable; they do not prove that a D3D
RenderTexture blit is visually upright. The first native PNG remains diagnostic
until its top and bottom are visually compared with the locked SOG/SPZ evidence.
If it is inverted, the implementation must apply and receipt one deterministic
vertical row flip before it can support matched-camera metrics.

Capture-level provenance distinguishes the configured pixel source from an
actually observed source. `configuredPixelSource` declares the required lane;
`observedPixelSource` remains null until an attempt completes first-party
readback, and `everyObservedPixelSourceMatchesConfigured` remains false when no
source was observed. These aggregates are recomputed from all retained attempts
after both accepted and rejected outcomes, so a failure receipt cannot imply
that configured pixels were produced.

The per-attempt timeout observes the module-owned SnapFrame operation. On an
observed cooperative timeout or terminal `Stop()`, cancellation is consumed at
the next end-of-frame await and the same operation restores the exact camera
before it completes. Cleanup failure is never hidden behind the initiating
failure. The disposable process remains the final boundary for a blocked Unity
main thread, GPU synchronization, or native driver call. A failed operation
restores and verifies the camera synchronously but does not claim that the
vendor FrameRT completed a restored/stable render handshake before process
exit; only successful attempts make that surface-restoration claim.

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
5. inspects its IL for the required public API calls;
6. creates `out\runtime-closure-lock.json` for every regular file in the
   installed editor tree except the first-party module directory;
7. rejects network references, unfinished-code markers, and copied vendor
   binaries;
8. writes `out\build-receipt.json`.

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
it never launches LCCEditor.

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
also verifies the native receipt's `.sha256` sidecar content, not merely its
existence. This implementation task documented the following command but did
**not** run it:

```powershell
Set-Location 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime\tools\reconstruction-foundry\native\grand-hall-lcc-native-capture'
& .\run-capture.ps1
```

Expected success files:

- `grand-hall-native-capture-1600x900.png`
- `grand-hall-native-capture-receipt.json`
- `grand-hall-native-capture-receipt.json.sha256`
- `grand-hall-native-capture-operator-receipt.json`
- up to three `.native-candidate-*.png` convergence witnesses

On failure, inspect `grand-hall-native-capture-operator-receipt.json`, then any
`grand-hall-native-capture-failure-receipt.json`, and the local XGRIDS log at
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
