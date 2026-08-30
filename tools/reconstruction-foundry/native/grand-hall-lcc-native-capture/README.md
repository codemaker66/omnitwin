# Grand Hall native LCC capture

This folder builds an original, fail-closed managed module that runs inside the
user's installed XGRIDS Unity `LCCEditor.exe`. It opens no network connection,
modifies no source scan, creates no architecture, and does not use
SplatTransform or another renderer as a native proxy.

The module exists for one evidence task only: render the locked
`scans_BIG_MODEL_TH_GH_9` native LCC at one exact inspection camera and produce
an overlay-free 1600x900 PNG plus a machine-readable receipt.

## What is authoritative

- Canonical scene:
  `C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_9\lcc-result\Grand_Hall.lcc`
- Manifest SHA-256:
  `CE2A539483C7C2A271CA2555F6390E16425BB911851A8A56C2F16B17C248CAC1`
- The module verifies all 11 files and all 1,127,138,769 bytes in the native
  package before and after capture. It also requires unchanged last-write
  timestamps.
- Source-space camera position: `[-4.774913, -16.59914, -0.687065]`
- Source-space target: `[-4.5826875, -8.392191, -0.687065]`
- Source-space up: `[0, 0, 1]`
- The public `ILCCSceneManager.LCCObjectToWorldSpace` conversion is applied at
  runtime. For the raw `_9` file it must produce position
  `[4.774913, -0.687065, 16.59914]`, target
  `[4.5826875, -0.687065, 8.392191]`, and up `[0, 1, 0]` within `1e-5`, or the
  run fails.
- Projection: vertical FOV `60`, near `0.05 m`, far `80 m`, aspect `16/9`.

The target is deliberately an inspection-only horizontal q05/q95
pose-envelope centre. It is **not** a calibrated source-camera orientation.
The output therefore remains diagnostic, `authority: none`, and cannot by
itself accept Grand Hall scope, a room transform, or architectural truth.

## Why this is a genuine native lane

`LCCEditor.exe` itself loads the `.lcc` and renders through the installed
LCCSDK. The module uses public, inspectable managed contracts already shipped
with that application:

- `IModule` and `IContainer.Resolve<T>()` for plugin loading;
- `IEventBus` and `lccscene.loaded` for load completion;
- `ILCCSceneManager.LCCObjectToWorldSpace`, `SetMainCamera`, `SetFOV`,
  `SetRecordMode`, `SetLockFPS`, and `ForceRerenderer`;
- `ICameraService.SetTransform` for the numeric pose;
- `ISceneManager.SceneCamera` for the exact Unity camera and clean-view flags;
- `ICaptureManager.CaptureToFileAsync(path, Rect, ImageFormat.PNG)` for a
  camera render texture, not a desktop or UI screenshot.

The stock executable has no camera/screenshot command-line arguments. The
installed Qt editor has camera IPC but no demonstrated colour-raster capture
endpoint. This in-process first-party module is the available native path.

## Safety and failure behavior

The module is inert unless all seven environment variables in the launch
recipe below are present. An armed run fails closed when any of these drift:

- scene path, 11-member source inventory, byte lengths, hashes, or timestamps;
- the exact approved disposable editor path or any reparse-point ancestor;
- the complete bounded 890-file editor inventory, including `UnityPlayer.dll`,
  Unity data/resources, native plugins, Mono runtime files, D3D12 runtime, and
  every enabled stock module manifest/DLL/asset;
- module or `plugin.json` hash from the local build receipt;
- runtime source-to-native camera conversion or applied camera transform;
- projection or PNG dimensions;
- output directory safety/emptiness;
- progressive convergence.

The module requests `Ultra` through `IRendererQualityService`, requires public
full-render support, calls `SetRenderAll(true)`, and records `IsRenderAll` at
every gate. Because the public API exposes no loaded-splat residency count or
streaming-completion metric, this is not presented as proof that every possible
Gaussian is resident. After `lccscene.loaded`, the module instead requires a
conservative minimum of 300 rendered frames and 15 seconds before sampling.
Attempts are spaced by another 15 rendered frames, and every clean-view flag,
camera value, projection value, Ultra quality, full-render mode, and canonical
scene identity is re-asserted throughout. Three consecutive byte-identical PNGs
establish a same-host hash plateau. The run stops after 60 attempts or 180
seconds, and each individual `ICaptureManager` operation has a 30-second
deadline with no retry after timeout.

The canonical package must report environment data and the module explicitly
requests its visibility with `SetEnvironmentData(true)`. XGRIDS exposes no
public environment-visibility getter, so the receipt records the request and
that limitation rather than claiming visibility was read back. Cleanup clears
the module's visibility request, but cannot prove restoration of an unknown
prior visibility state; this is one reason execution is restricted to an
auto-quit disposable editor.

Every successful public mode mutation records its cleanup state immediately.
Record mode, locked FPS, render-all, and the environment request are restored
independently so one failing vendor cleanup call does not suppress the others.

The module writes only beneath a new, explicitly supplied empty output
directory. It refuses output inside either the source package or disposable
editor. It auto-quits the disposable editor with code `0` on success or `2` on
failure.

An armed run also requires a fresh editor process with no scene already loaded.
Before subscribing to `lccscene.loaded`, it hashes the canonical source package
and the complete disposable-editor closure. Both are rechecked after native
loading and again after capture, including timestamps for the source package.

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
3. hashes the complete live 1.127 GB canonical native package twice;
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
```

Only `plugin.json`, `VenviewerNativeCapture.dll`, and the generated hash-only
`runtime-closure-lock.json` are added. No XGRIDS DLL is copied into the
repository or module directory.

## 4. Launch the deterministic capture

Use the reviewed operator wrapper. Do not invoke `LCCEditor.exe` directly. The
wrapper verifies the installed first-party module artifacts, sets and later
restores all seven process-local arm variables, starts the exact approved
disposable editor, and imposes a non-configurable 900-second hard wall-clock
deadline around the entire native process. That outer deadline includes the
synchronous source/editor hashing that occurs before the in-module scene-load
watchdog begins.

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
