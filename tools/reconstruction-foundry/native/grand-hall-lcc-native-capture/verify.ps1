[CmdletBinding()]
param(
    [string]$LccEditorRoot = 'F:\LccStudio\lcceditor',
    [string]$ModulePath = (Join-Path $PSScriptRoot 'out\VenviewerNativeCapture.dll'),
    [string]$BuildReceiptPath = (Join-Path $PSScriptRoot 'out\build-receipt.json')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pluginPath = Join-Path $PSScriptRoot 'plugin.json'
$lockPath = Join-Path $PSScriptRoot 'vendor-lock.json'
$operatorPath = Join-Path $PSScriptRoot 'run-capture.ps1'
$cameraProfilePath = Join-Path $PSScriptRoot 'camera-profile.json'
$sourceRoot = Join-Path $PSScriptRoot 'src'
$canonicalManifestPath = 'C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_1\lcc2-result\Grand_Hall.lcc2'
$canonicalManifestSha256 = '927A92699DE222E99D2684CA2567A35AB1E523A036461E6E01236B7B77B7F659'
$cameraProfileSha256 = '9ECA9B6582B7301EC1C059B1A5BE699E5A4983773AFECB2BEEA46C2668305922'
$featureTogglePath = 'C:\Users\blake\AppData\LocalLow\XGrids\LCCEditor\feature_toggles\module_toggles.dat'
$featureToggleSha256 = '8FF16CAC30F3F49A71BE9A06D486B1BB9B682E0CCF1C5C35869A251D98313531'
$expectedCompilerPath = 'C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\Roslyn\csc.exe'
$expectedCompilerVersion = '4.1400.26.36408'
$expectedCompilerSha256 = 'F895C265B8FA8ED9601F6D8EC87D1E2079F5E851C70D0719A90007564AE8F6AB'
$expectedSourceRelativePaths = @(
    'README.md',
    'build.ps1',
    'camera-profile.json',
    'plugin.json',
    'run-capture.ps1',
    'src\CapturePolicy.cs',
    'src\FixedCameraProfile.cs',
    'src\NativeCaptureModule.cs',
    'src\ReceiptModels.cs',
    'src\RuntimeClosurePolicy.cs',
    'tests\CapturePolicyTests.cs',
    'tests\RuntimeClosureTests.cs',
    'vendor-lock.json',
    'verify.ps1'
)

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)]$Expected,
        [Parameter(Mandatory = $true)]$Actual,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if ($Expected -cne $Actual) {
        throw "$Label mismatch. Expected '$Expected', found '$Actual'."
    }
}

foreach ($requiredPath in @(
    $ModulePath,
    $BuildReceiptPath,
    $pluginPath,
    $lockPath,
    $operatorPath,
    $cameraProfilePath,
    $canonicalManifestPath
)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required offline-verification file is missing: $requiredPath"
    }
}

$plugin = Get-Content -LiteralPath $pluginPath -Raw | ConvertFrom-Json
Assert-Equal 'com.venviewer.native_capture' ([string]$plugin.Id) 'plugin Id'
Assert-Equal '1.2.7' ([string]$plugin.Version) 'plugin version'
Assert-Equal 'managed' ([string]$plugin.Type) 'plugin type'
Assert-Equal 'VenviewerNativeCapture.dll' ([string]$plugin.EntryPoint) 'plugin entry point'
Assert-Equal 'Venviewer.NativeCapture.NativeCaptureModule' ([string]$plugin.Class) 'plugin class'
Assert-Equal $true ([bool]$plugin.Enabled) 'plugin enabled flag'
Assert-Equal 0 ([int]$plugin.Dependencies.Count) 'plugin dependency count'

$buildReceipt = Get-Content -LiteralPath $BuildReceiptPath -Raw | ConvertFrom-Json
Assert-Equal 'venviewer.grand-hall.lcc-native-capture-build-receipt.v1' ([string]$buildReceipt.schemaVersion) 'build receipt schema'
Assert-Equal $true ([bool]$buildReceipt.tests.liveCanonicalPackageVerified) 'live canonical package verification'
Assert-Equal $true ([bool]$buildReceipt.tests.runtimeClosureVerified) 'runtime closure test result'
Assert-Equal $true ([bool]$buildReceipt.tests.passed) 'policy test result'
$actualModuleSha256 = (Get-FileHash -LiteralPath $ModulePath -Algorithm SHA256).Hash
$actualPluginSha256 = (Get-FileHash -LiteralPath $pluginPath -Algorithm SHA256).Hash
Assert-Equal ([string]$buildReceipt.module.sha256) $actualModuleSha256 'built module SHA-256'
Assert-Equal ([string]$buildReceipt.pluginManifest.sha256) $actualPluginSha256 'plugin SHA-256'
Assert-Equal $cameraProfileSha256 ([string]$buildReceipt.cameraProfile.sha256) 'camera profile receipt SHA-256'
Assert-Equal $cameraProfileSha256 ((Get-FileHash -LiteralPath $cameraProfilePath -Algorithm SHA256).Hash) 'camera profile source SHA-256'
Assert-Equal $cameraProfileSha256 ((Get-FileHash -LiteralPath ([string]$buildReceipt.cameraProfile.path) -Algorithm SHA256).Hash) 'camera profile output SHA-256'
Assert-Equal $false ([bool]$buildReceipt.networkUsed) 'network-used flag'
Assert-Equal $false ([bool]$buildReceipt.vendorBinariesCopiedIntoRepository) 'vendor-copy flag'

$compilerPath = [string]$buildReceipt.compiler.path
if (-not (Test-Path -LiteralPath $compilerPath -PathType Leaf)) {
    throw "The receipt compiler no longer exists: $compilerPath"
}
Assert-Equal $expectedCompilerPath ([IO.Path]::GetFullPath($compilerPath)) 'locked compiler path'
Assert-Equal $expectedCompilerSha256 ([string]$buildReceipt.compiler.sha256) 'locked compiler receipt SHA-256'
Assert-Equal $expectedCompilerVersion ([string]$buildReceipt.compiler.fileVersion) 'locked compiler receipt version'
Assert-Equal ([string]$buildReceipt.compiler.sha256) ((Get-FileHash -LiteralPath $compilerPath -Algorithm SHA256).Hash) 'compiler SHA-256'
Assert-Equal ([string]$buildReceipt.compiler.fileVersion) ((Get-Item -LiteralPath $compilerPath).VersionInfo.FileVersion) 'compiler file version'

$expectedSourceSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($relativePath in $expectedSourceRelativePaths) {
    if (-not $expectedSourceSet.Add($relativePath)) {
        throw "Duplicate path in the hard-coded source allowlist: $relativePath"
    }
}
$actualSourceSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$moduleRootPrefix = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
foreach ($source in $buildReceipt.sources) {
    $sourcePath = [string]$source.path
    $fullSourcePath = [IO.Path]::GetFullPath($sourcePath)
    if (-not $fullSourcePath.StartsWith($moduleRootPrefix, [StringComparison]::Ordinal)) {
        throw "A receipted source escapes the reviewed first-party folder: $sourcePath"
    }
    $relativeSourcePath = $fullSourcePath.Substring($moduleRootPrefix.Length)
    if (-not $actualSourceSet.Add($relativeSourcePath)) {
        throw "The build receipt contains a duplicate source path: $relativeSourcePath"
    }
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "A receipted source file is missing: $sourcePath"
    }
    Assert-Equal ([long]$source.byteLength) ([long](Get-Item -LiteralPath $sourcePath).Length) "source byte length $sourcePath"
    Assert-Equal ([string]$source.sha256) ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash) "source SHA-256 $sourcePath"
}
if ($actualSourceSet.Count -ne $expectedSourceSet.Count -or
    -not $actualSourceSet.SetEquals($expectedSourceSet)) {
    $missing = @($expectedSourceSet | Where-Object { -not $actualSourceSet.Contains($_) }) -join ', '
    $extra = @($actualSourceSet | Where-Object { -not $expectedSourceSet.Contains($_) }) -join ', '
    throw "Build-receipt source allowlist mismatch. Missing: [$missing]. Extra: [$extra]."
}

$runtimeClosurePath = [string]$buildReceipt.runtimeClosureLock.path
if (-not (Test-Path -LiteralPath $runtimeClosurePath -PathType Leaf)) {
    throw "The runtime closure lock is missing: $runtimeClosurePath"
}
Assert-Equal ([string]$buildReceipt.runtimeClosureLock.sha256) ((Get-FileHash -LiteralPath $runtimeClosurePath -Algorithm SHA256).Hash) 'runtime closure lock SHA-256'
$runtimeClosure = Get-Content -LiteralPath $runtimeClosurePath -Raw | ConvertFrom-Json
Assert-Equal 'venviewer.grand-hall.lcc-native-runtime-closure-lock.v1' ([string]$runtimeClosure.schemaVersion) 'runtime closure schema'
Assert-Equal ([int]$buildReceipt.runtimeClosureLock.memberCount) ([int]$runtimeClosure.memberCount) 'runtime closure member count'
Assert-Equal ([string]$buildReceipt.runtimeClosureLock.inventorySha256) ([string]$runtimeClosure.inventorySha256) 'runtime closure inventory SHA-256'
Assert-Equal 1 ([int]$runtimeClosure.excludedRelativeRoots.Count) 'runtime closure exclusion count'
Assert-Equal 'Modules\Venviewer Native Capture' ([string]$runtimeClosure.excludedRelativeRoots[0]) 'runtime closure first-party exclusion'
$closurePaths = @($runtimeClosure.members | ForEach-Object { [string]$_.relativePath })
Assert-Equal 10 ([int]$runtimeClosure.enabledStockModuleIds.Count) 'enabled stock module count'
Assert-Equal ([int]$runtimeClosure.enabledStockModuleIds.Count) ([int]$runtimeClosure.enabledStockModuleRoots.Count) 'enabled stock module root count'
foreach ($requiredClosurePath in @(
    'UnityPlayer.dll',
    'LCCEditor_Data\boot.config',
    'LCCEditor_Data\data.unity3d',
    'LCCEditor_Data\resources.resource',
    'LCCEditor_Data\RuntimeInitializeOnLoads.json',
    'LCCEditor_Data\ScriptingAssemblies.json',
    'LCCEditor_Data\sharedassets0.resource'
)) {
    if ($closurePaths -cnotcontains $requiredClosurePath) {
        throw "The runtime closure omits required pixel-affecting file '$requiredClosurePath'."
    }
}
foreach ($manifest in Get-ChildItem -LiteralPath (Join-Path $LccEditorRoot 'Modules') -Recurse -Filter plugin.json -File) {
    $pluginDocument = Get-Content -LiteralPath $manifest.FullName -Raw | ConvertFrom-Json
    if ([bool]$pluginDocument.Enabled) {
        $relativeManifest = $manifest.FullName.Substring((Resolve-Path -LiteralPath $LccEditorRoot).Path.Length + 1)
        if ($closurePaths -cnotcontains $relativeManifest) {
            throw "The runtime closure omits enabled module manifest '$relativeManifest'."
        }
    }
}

$actualManifestSha256 = (Get-FileHash -LiteralPath $canonicalManifestPath -Algorithm SHA256).Hash
Assert-Equal $canonicalManifestSha256 $actualManifestSha256 'canonical GH_1 LCC2 manifest SHA-256'
$cameraProfileRaw = Get-Content -LiteralPath $cameraProfilePath -Raw
$cameraProfile = $cameraProfileRaw | ConvertFrom-Json
Assert-Equal 'venviewer.grand-hall.fixed-camera-profile.v1' ([string]$cameraProfile.schemaVersion) 'camera profile schema'
Assert-Equal 'xgrids_lcc2_source_z_up' ([string]$cameraProfile.frames.source.id) 'camera profile source frame'
Assert-Equal 'xgrids_lcceditor_unity_y_up' ([string]$cameraProfile.frames.native.id) 'camera profile native frame'
Assert-Equal 'venviewer_browser_centered_y_up' ([string]$cameraProfile.frames.three.id) 'camera profile Three frame'
Assert-Equal 1600 ([int]$cameraProfile.output.width) 'camera profile width'
Assert-Equal 900 ([int]$cameraProfile.output.height) 'camera profile height'
Assert-Equal $false ([bool]$cameraProfile.environment.include) 'camera profile environment inclusion'
Assert-Equal $false ([bool]$cameraProfile.environment.visibilityGetterAvailable) 'camera profile environment getter claim'
if ($cameraProfileRaw -notmatch
    '"target"\s*:\s*\[\s*0\.15796363067625974\s*,\s*2\.15606153541565\s*,\s*-0\.19184415815737577\s*\]') {
    throw 'The camera profile does not contain the exact browser-authority Three target tuple.'
}

Assert-Equal $featureToggleSha256 ((Get-FileHash -LiteralPath $featureTogglePath -Algorithm SHA256).Hash) 'reviewed original per-user feature-toggle SHA-256'
$encryptUtilAssembly = Join-Path $LccEditorRoot 'LCCEditor_Data\Managed\LCCWorld.Common.dll'
$encryptUtilType = [Reflection.Assembly]::LoadFrom($encryptUtilAssembly).GetType(
    'XGrids.LCCWorld.Common.Utils.EncryptUtil',
    $true)
$decryptMethod = $encryptUtilType.GetMethod('DecryptFromHex', [Reflection.BindingFlags]'Public,Static')
$encryptMethod = $encryptUtilType.GetMethod('EncryptToHex', [Reflection.BindingFlags]'Public,Static')
if ($null -eq $decryptMethod -or $null -eq $encryptMethod) {
    throw 'The installed public EncryptUtil contract is unavailable.'
}
$toggleCiphertext = [string](Get-Content -LiteralPath $featureTogglePath -Raw)
$decryptArguments = [object[]]::new(2)
$decryptArguments[0] = $toggleCiphertext
$decryptArguments[1] = [string]'xgrids'
$toggleJson = [string]$decryptMethod.Invoke($null, $decryptArguments)
$toggleConfig = $toggleJson | ConvertFrom-Json
Assert-Equal 0 (@($toggleConfig.toggles | Where-Object {
    [string]$_.module_id -ceq 'com.venviewer.native_capture'
}).Count) 'reviewed original native-capture toggle count'

$forbiddenSourcePatterns = @(
    'System\.Net',
    'HttpClient',
    'WebRequest',
    'TcpClient',
    'UdpClient',
    '\bSocket\b',
    'NetMQ',
    'https?://',
    'NotImplementedException',
    '//\s*TODO'
)
$sourceFiles = Get-ChildItem -LiteralPath $sourceRoot -Filter '*.cs' -File
foreach ($pattern in $forbiddenSourcePatterns) {
    $matches = $sourceFiles | Select-String -Pattern $pattern -CaseSensitive
    if ($matches) {
        throw "Forbidden source pattern '$pattern' was found: $($matches.Path):$($matches.LineNumber)"
    }
}
if (-not (Select-String -LiteralPath (Join-Path $sourceRoot 'CapturePolicy.cs') -Pattern 'RequireTreeWithoutReparsePoints\(root, "canonical Grand Hall package tree"\)' -CaseSensitive)) {
    throw 'Canonical package snapshot no longer proves recursive reparse-point rejection.'
}
$moduleSource = Get-Content -LiteralPath (Join-Path $sourceRoot 'NativeCaptureModule.cs') -Raw
$capturePolicySource = Get-Content -LiteralPath (Join-Path $sourceRoot 'CapturePolicy.cs') -Raw
$receiptModelsSource = Get-Content -LiteralPath (Join-Path $sourceRoot 'ReceiptModels.cs') -Raw
$capturePolicyTestsSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'tests\CapturePolicyTests.cs') -Raw
$buildSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'build.ps1') -Raw
if ($moduleSource.IndexOf(
        'private const string ModuleVersion = "1.2.7";',
        [StringComparison]::Ordinal) -lt 0) {
    throw 'The compiled module source and plugin manifest version are not both 1.2.7.'
}
if ($capturePolicySource -notmatch
    '(?s)class InterlockedOneShotGate.*?TryEnter\(\).*?Interlocked\.CompareExchange\(ref _entered, 1, 0\) == 0') {
    throw 'The Interlocked one-shot lifecycle gate implementation is missing.'
}
foreach ($lifecycleStateContract in @(
    'class NativeCaptureLifecycleState',
    'TryScheduleModulesLoaded()',
    'TryMarkNextFrameExecutionReady()',
    'LifecycleExecutionDecision TryEnterExecution()',
    'Interlocked.Exchange(ref _stopped, 1);'
)) {
    if ($capturePolicySource.IndexOf($lifecycleStateContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The testable lifecycle-state contract is missing '$lifecycleStateContract'."
    }
}
$lifecycleSubscribeMatch = [Regex]::Match(
    $moduleSource,
    '_eventBus\.Subscribe<IEvent>\(\s*"modules\.loaded"',
    [Text.RegularExpressions.RegexOptions]::Singleline)
$lifecycleSubscribeIndex = if ($lifecycleSubscribeMatch.Success) {
    $lifecycleSubscribeMatch.Index
}
else {
    -1
}
$executeMethodIndex = $moduleSource.IndexOf('public void Execute()', [StringComparison]::Ordinal)
if ($lifecycleSubscribeIndex -lt 0 -or $executeMethodIndex -lt 0 -or
    $lifecycleSubscribeIndex -gt $executeMethodIndex) {
    throw 'Init no longer subscribes to exact modules.loaded before the Execute entry point.'
}
$modulesLoadedHandlerIndex = $moduleSource.IndexOf(
    'private bool HandleModulesLoaded(IEvent moduleLoadedEvent)',
    [StringComparison]::Ordinal)
$nextFrameSchedulerIndex = $moduleSource.IndexOf(
    'private async UniTask ScheduleExecuteAfterModulesLoadedAsync()',
    [StringComparison]::Ordinal)
if ($modulesLoadedHandlerIndex -lt 0 -or $nextFrameSchedulerIndex -lt 0 -or
    $modulesLoadedHandlerIndex -gt $nextFrameSchedulerIndex) {
    throw 'The modules.loaded lifecycle handler/scheduler contract is missing.'
}
$modulesLoadedHandlerSource = $moduleSource.Substring(
    $modulesLoadedHandlerIndex,
    $nextFrameSchedulerIndex - $modulesLoadedHandlerIndex)
$lifecycleScheduleIndex = $modulesLoadedHandlerSource.IndexOf(
    'ScheduleExecuteAfterModulesLoadedAsync().Forget(',
    [StringComparison]::Ordinal)
if ($modulesLoadedHandlerSource.IndexOf('_lifecycle.IsStopped', [StringComparison]::Ordinal) -lt 0 -or
    $modulesLoadedHandlerSource.IndexOf('_lifecycle.TryScheduleModulesLoaded()', [StringComparison]::Ordinal) -lt 0 -or
    $lifecycleScheduleIndex -lt 0) {
    throw 'modules.loaded no longer uses its Interlocked one-shot deferred handoff.'
}
$validateServicesIndex = $moduleSource.IndexOf('private void ValidateResolvedServices()', [StringComparison]::Ordinal)
$nextFrameSchedulerSource = $moduleSource.Substring(
    $nextFrameSchedulerIndex,
    $validateServicesIndex - $nextFrameSchedulerIndex)
foreach ($nextFrameContract in @(
    'await UniTask.Yield(PlayerLoopTiming.LastPostLateUpdate);',
    'UnsubscribeModulesLoaded();',
    'await UniTask.NextFrame(PlayerLoopTiming.LastPostLateUpdate);',
    '_lifecycle.TryMarkNextFrameExecutionReady()',
    'Execute();'
)) {
    if ($nextFrameSchedulerSource.IndexOf($nextFrameContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The next-frame lifecycle scheduler is missing '$nextFrameContract'."
    }
}
$deferredUnsubscribeIndex = $nextFrameSchedulerSource.IndexOf(
    'UnsubscribeModulesLoaded();',
    [StringComparison]::Ordinal)
$nextFrameIndex = $nextFrameSchedulerSource.IndexOf(
    'await UniTask.NextFrame(PlayerLoopTiming.LastPostLateUpdate);',
    [StringComparison]::Ordinal)
$guardedExecuteIndex = $nextFrameSchedulerSource.IndexOf('Execute();', [StringComparison]::Ordinal)
if ($deferredUnsubscribeIndex -lt 0 -or $nextFrameIndex -lt 0 -or $guardedExecuteIndex -lt 0 -or
    $deferredUnsubscribeIndex -gt $nextFrameIndex -or $nextFrameIndex -gt $guardedExecuteIndex) {
    throw 'modules.loaded must safely unsubscribe after dispatch and before scheduling next-frame Execute.'
}
foreach ($executionContract in @(
    '_lifecycle.TryEnterExecution()',
    'LifecycleExecutionDecision.NotReady',
    'LifecycleExecutionDecision.Stopped',
    'LifecycleExecutionDecision.Duplicate',
    'Duplicate Execute request ignored by the Interlocked one-shot guard.'
)) {
    if ($moduleSource.IndexOf($executionContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The guarded Execute contract is missing '$executionContract'."
    }
}
$stopMethodIndex = $moduleSource.IndexOf('public void Stop()', [StringComparison]::Ordinal)
$disposeMethodIndex = $moduleSource.IndexOf('public void Dispose()', [StringComparison]::Ordinal)
$handleModulesLoadedIndex = $moduleSource.IndexOf('private bool HandleModulesLoaded(', [StringComparison]::Ordinal)
if ($stopMethodIndex -lt 0 -or $disposeMethodIndex -lt 0 -or $handleModulesLoadedIndex -lt 0 -or
    $stopMethodIndex -gt $disposeMethodIndex -or $disposeMethodIndex -gt $handleModulesLoadedIndex) {
    throw 'The Stop/Dispose lifecycle-cleanup structure is missing.'
}
$stopMethodSource = $moduleSource.Substring($stopMethodIndex, $disposeMethodIndex - $stopMethodIndex)
$disposeMethodSource = $moduleSource.Substring($disposeMethodIndex, $handleModulesLoadedIndex - $disposeMethodIndex)
if ($stopMethodSource.IndexOf('_lifecycle.Stop();', [StringComparison]::Ordinal) -lt 0 -or
    $stopMethodSource.IndexOf('UnsubscribeModulesLoaded();', [StringComparison]::Ordinal) -lt 0 -or
    $stopMethodSource.IndexOf('UnsubscribeSceneLoadBegin();', [StringComparison]::Ordinal) -lt 0 -or
    $stopMethodSource.IndexOf('UnsubscribeSceneLoaded();', [StringComparison]::Ordinal) -lt 0 -or
    $disposeMethodSource.IndexOf('Stop();', [StringComparison]::Ordinal) -lt 0) {
    throw 'Stop/Dispose no longer terminally closes and removes all lifecycle subscriptions.'
}
$tryStartIndex = $moduleSource.IndexOf(
    'private void TryStartCaptureAfterLoadContract(bool deferUntilEventDispatchUnwinds)',
    [StringComparison]::Ordinal)
$failSceneLoadIndex = $moduleSource.IndexOf('private void FailSceneLoadContract(', [StringComparison]::Ordinal)
$unsubscribeSceneIndex = $moduleSource.IndexOf('private void UnsubscribeSceneLoaded()', [StringComparison]::Ordinal)
$throwIfStoppedIndex = $moduleSource.IndexOf('private void ThrowIfStopped()', [StringComparison]::Ordinal)
if ($tryStartIndex -lt 0 -or $failSceneLoadIndex -lt 0 -or $tryStartIndex -gt $failSceneLoadIndex -or
    $unsubscribeSceneIndex -lt 0 -or $throwIfStoppedIndex -lt 0) {
    throw 'The internal scene-unsubscribe/cooperative-stop structure is missing.'
}
$tryStartSource = $moduleSource.Substring($tryStartIndex, $failSceneLoadIndex - $tryStartIndex)
$internalBeginUnsubscribeIndex = $tryStartSource.IndexOf('UnsubscribeSceneLoadBegin();', [StringComparison]::Ordinal)
$internalLoadedUnsubscribeIndex = $tryStartSource.IndexOf('UnsubscribeSceneLoaded();', [StringComparison]::Ordinal)
$internalStartIndex = $tryStartSource.IndexOf('StartCapture(CapturePolicy.CanonicalScenePath);', [StringComparison]::Ordinal)
if ($tryStartSource.IndexOf('_lifecycle.IsStopped', [StringComparison]::Ordinal) -lt 0 -or
    $tryStartSource.IndexOf('StartCaptureAfterSceneEventDispatchAsync().Forget(', [StringComparison]::Ordinal) -lt 0 -or
    $tryStartSource.IndexOf('await UniTask.Yield(PlayerLoopTiming.LastPostLateUpdate);', [StringComparison]::Ordinal) -lt 0 -or
    $internalBeginUnsubscribeIndex -lt 0 -or $internalLoadedUnsubscribeIndex -lt 0 -or
    $internalStartIndex -lt 0 -or
    $internalBeginUnsubscribeIndex -gt $internalStartIndex -or
    $internalLoadedUnsubscribeIndex -gt $internalStartIndex -or
    $tryStartSource.IndexOf('Stop();', [StringComparison]::Ordinal) -ge 0) {
    throw 'Successful internal scene load must unsubscribe its event without terminally calling Stop.'
}
$unsubscribeSceneSource = $moduleSource.Substring($unsubscribeSceneIndex, $throwIfStoppedIndex - $unsubscribeSceneIndex)
if ($unsubscribeSceneSource.IndexOf('_eventBus.Unsubscribe("lccscene.loaded"', [StringComparison]::Ordinal) -lt 0 -or
    $unsubscribeSceneSource.IndexOf('_eventBus.Unsubscribe("lccscene.load.begin"', [StringComparison]::Ordinal) -lt 0 -or
    $unsubscribeSceneSource.IndexOf('_lifecycle.Stop();', [StringComparison]::Ordinal) -ge 0) {
    throw 'Internal begin/loaded scene unsubscription is missing or terminally stops the lifecycle.'
}
$watchSceneIndex = $moduleSource.IndexOf('private async UniTask WatchSceneLoadAsync()', [StringComparison]::Ordinal)
$failArmedIndex = $moduleSource.IndexOf('private void FailArmedStartup(', [StringComparison]::Ordinal)
$handleSceneIndex = $moduleSource.IndexOf('private bool HandleSceneLoaded(', [StringComparison]::Ordinal)
$startCaptureIndex = $moduleSource.IndexOf('private void StartCapture(', [StringComparison]::Ordinal)
$runCaptureIndex = $moduleSource.IndexOf('private async UniTask RunCaptureAsync(', [StringComparison]::Ordinal)
foreach ($stoppedWorkContract in @(
    @($watchSceneIndex, $failArmedIndex, '_lifecycle.IsStopped', 'scene-load watchdog'),
    @($handleSceneIndex, $tryStartIndex, '_lifecycle.IsStopped', 'scene event handler'),
    @($startCaptureIndex, $runCaptureIndex, '_lifecycle.IsStopped', 'capture start')
)) {
    $contractStart = [int]$stoppedWorkContract[0]
    $contractEnd = [int]$stoppedWorkContract[1]
    if ($contractStart -lt 0 -or $contractEnd -le $contractStart -or
        $moduleSource.Substring($contractStart, $contractEnd - $contractStart).IndexOf(
            [string]$stoppedWorkContract[2],
            [StringComparison]::Ordinal) -lt 0) {
        throw "The $($stoppedWorkContract[3]) no longer rejects work after Stop."
    }
}
$waitCameraIndex = $moduleSource.IndexOf('private async UniTask WaitForCameraApplication(', [StringComparison]::Ordinal)
$waitReadinessIndex = $moduleSource.IndexOf('private async UniTask WaitForRendererReadiness(', [StringComparison]::Ordinal)
$requireCameraIndex = $moduleSource.IndexOf('private void RequireLockedCameraState(', [StringComparison]::Ordinal)
$captureConvergenceIndex = $moduleSource.IndexOf('private async UniTask CaptureUntilConverged(', [StringComparison]::Ordinal)
$captureTimeoutIndex = $moduleSource.IndexOf(
    'private async UniTask<Texture2D> CaptureTextureWithTimeout(',
    [StringComparison]::Ordinal)
$finalizePngIndex = $moduleSource.IndexOf('private void FinalizePng(', [StringComparison]::Ordinal)
foreach ($cooperativeStopContract in @(
    @($runCaptureIndex, $waitCameraIndex, 'capture pipeline'),
    @($waitCameraIndex, $waitReadinessIndex, 'camera-application awaits'),
    @($waitReadinessIndex, $requireCameraIndex, 'renderer-readiness loop'),
    @($captureConvergenceIndex, $captureTimeoutIndex, 'capture-convergence loop'),
    @($captureTimeoutIndex, $finalizePngIndex, 'bounded texture-capture await')
)) {
    $contractStart = [int]$cooperativeStopContract[0]
    $contractEnd = [int]$cooperativeStopContract[1]
    if ($contractStart -lt 0 -or $contractEnd -le $contractStart -or
        $moduleSource.Substring($contractStart, $contractEnd - $contractStart).IndexOf(
            'ThrowIfStopped();',
            [StringComparison]::Ordinal) -lt 0) {
        throw "The $($cooperativeStopContract[2]) lacks cooperative Stop checks."
    }
}
foreach ($postConvergenceStopContract in @(
    '(?s)PackageSnapshot after = CapturePolicy\.SnapshotCanonicalPackage\(scenePath\);\s*ThrowIfStopped\(\);\s*CapturePolicy\.RequireUnchanged\(before, after\);',
    '(?s)RuntimeClosureReceipt postCaptureRuntimeClosure = RuntimeClosurePolicy\.Verify\(.*?_expectedRuntimeClosureSha256\);\s*ThrowIfStopped\(\);\s*RequireSameRuntimeClosure',
    '(?s)receipt\.vendor\.runtimeClosure\.preLoadAndPostCaptureIdentityVerified = true;\s*ThrowIfStopped\(\);\s*FinalizePng\(receipt\.capture\);'
)) {
    if ($moduleSource -notmatch $postConvergenceStopContract) {
        throw "A post-convergence Stop boundary is missing: $postConvergenceStopContract"
    }
}
if ($moduleSource -notmatch 'camera\.orthographic = false' -or $moduleSource -notmatch 'state\.Camera\.orthographic') {
    throw 'Perspective camera enforcement is missing.'
}
if ($moduleSource.IndexOf('_preLoadPackageSnapshot = CapturePolicy.SnapshotCanonicalPackage', [StringComparison]::Ordinal) -lt 0 -or
    $moduleSource.IndexOf('_preLoadPackageSnapshot = CapturePolicy.SnapshotCanonicalPackage', [StringComparison]::Ordinal) -gt
        $moduleSource.IndexOf('"lccscene.load.begin"', [StringComparison]::Ordinal)) {
    throw 'Canonical package identity is not captured before scene subscription/load.'
}
$beginSubscribeMatch = [Regex]::Match(
    $moduleSource,
    '(?s)_sceneLoadBeginSubscribed\s*=\s*_eventBus\.Subscribe(?:<EventArg<bool>>)?\(\s*"lccscene\.load\.begin"\s*,\s*_sceneLoadBeginHandler\s*,\s*Int32\.MaxValue\s*\);')
$beginSubscribeIndex = if ($beginSubscribeMatch.Success) { $beginSubscribeMatch.Index } else { -1 }
$loadedSubscribeMatch = [Regex]::Match(
    $moduleSource,
    '(?s)_subscribed\s*=\s*_eventBus\.Subscribe(?:<EventArg<string>>)?\(\s*"lccscene\.loaded"\s*,\s*_sceneLoadedHandler\s*,\s*100\s*\);')
$subscribeIndex = if ($loadedSubscribeMatch.Success) { $loadedSubscribeMatch.Index } else { -1 }
$temporaryProjectIndex = $moduleSource.IndexOf('_projectManager.CreateTemporaryLCCProject(', [StringComparison]::Ordinal)
$defaultSceneLoadIndex = $moduleSource.IndexOf('_sceneManager.LoadDefaultScene()', [StringComparison]::Ordinal)
if ($beginSubscribeIndex -lt 0 -or $subscribeIndex -lt 0 -or
    $temporaryProjectIndex -lt 0 -or $defaultSceneLoadIndex -lt 0 -or
    $beginSubscribeIndex -gt $subscribeIndex -or
    $subscribeIndex -gt $temporaryProjectIndex -or
    $temporaryProjectIndex -gt $defaultSceneLoadIndex) {
    throw 'The priority load-begin subscription, loaded subscription, temporary project creation, and default-scene load are out of order.'
}
foreach ($loadContract in @(
    'RequireFreshVendorState();',
    'ValidateTemporaryProjectState();',
    '_projectManager.CreateTemporaryLCCProject(',
    '_sceneManager.LoadDefaultScene()',
    '_sceneManager.CurrentSceneData.TryGetLCCAsset(out asset)',
    '_projectManager.GetAssetFinalPath(asset.path)',
    '_lccSceneManager.GetRendererHandlerByPath(',
    'CapturePolicy.RequireCanonicalScenePath(_rendererHandler.Path)',
    '_lccSceneManager.IsSceneLoaded(CapturePolicy.CanonicalScenePath)',
    'Volatile.Read(ref _sceneLoadedEventObserved)',
    'commandLineSceneArgumentUsed = false',
    'venviewer.grand-hall.lcc-native-capture-receipt.v7',
    'FixedCameraProfile.Load('
)) {
    if ($moduleSource.IndexOf($loadContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The fail-closed native scene-load/profile contract is missing '$loadContract'."
    }
}
$freshProcessGateIndex = $moduleSource.IndexOf('RequireFreshVendorState();', [StringComparison]::Ordinal)
$preLoadSnapshotIndex = $moduleSource.IndexOf('_preLoadPackageSnapshot = CapturePolicy.SnapshotCanonicalPackage', [StringComparison]::Ordinal)
if ($freshProcessGateIndex -lt 0 -or $freshProcessGateIndex -gt $preLoadSnapshotIndex) {
    throw 'The pre-load package snapshot is not protected by a fresh-process scene gate.'
}

$loadBeginHandlerIndex = $moduleSource.IndexOf(
    'private bool HandleSceneLoadBegin(EventArg<bool> eventData)',
    [StringComparison]::Ordinal)
$loadedHandlerIndex = $moduleSource.IndexOf(
    'private bool HandleSceneLoaded(EventArg<string> eventData)',
    [StringComparison]::Ordinal)
if ($loadBeginHandlerIndex -lt 0 -or $loadedHandlerIndex -le $loadBeginHandlerIndex) {
    throw 'The exact typed lccscene.load.begin/loaded handler contract is missing.'
}
$loadBeginHandlerSource = $moduleSource.Substring(
    $loadBeginHandlerIndex,
    $loadedHandlerIndex - $loadBeginHandlerIndex)
$setRenderAllTrueIndex = $loadBeginHandlerSource.IndexOf(
    '_lccSceneManager.SetRenderAll(true);',
    [StringComparison]::Ordinal)
if ($moduleSource.IndexOf(
        'private Func<EventArg<bool>, bool> _sceneLoadBeginHandler;',
        [StringComparison]::Ordinal) -lt 0 -or
    $moduleSource.IndexOf(
        '_sceneLoadBeginHandler = HandleSceneLoadBegin;',
        [StringComparison]::Ordinal) -lt 0 -or
    $setRenderAllTrueIndex -lt 0 -or
    @([Regex]::Matches($moduleSource, '_lccSceneManager\.SetRenderAll\(true\);')).Count -ne 1 -or
    $loadBeginHandlerSource.IndexOf(
        '_renderAllPendingTrueRequestedBeforeLoad = true;',
        [StringComparison]::Ordinal) -lt $setRenderAllTrueIndex) {
    throw 'SetRenderAll(true) must occur exactly once in the stable typed load-begin handler.'
}
$afterSetRenderAllTrue = $loadBeginHandlerSource.Substring($setRenderAllTrueIndex)
if ($afterSetRenderAllTrue.IndexOf('_lccSceneManager.IsRenderAll()', [StringComparison]::Ordinal) -ge 0) {
    throw 'The load-begin handler falsely treats IsRenderAll as an immediate pending-value read-back.'
}
if ($loadBeginHandlerSource.IndexOf(
        '_renderAllPendingDefaultDerivedFromFreshRenderer = _freshProjectStateVerified;',
        [StringComparison]::Ordinal) -lt 0) {
    throw 'The fresh disposable renderer no longer supplies the pending-false default evidence.'
}

$tryStartAfterLoadedIndex = $moduleSource.IndexOf(
    'private void TryStartCaptureAfterLoadContract(',
    [StringComparison]::Ordinal)
$loadedHandlerSource = $moduleSource.Substring(
    $loadedHandlerIndex,
    $tryStartAfterLoadedIndex - $loadedHandlerIndex)
foreach ($postLoadRenderAllContract in @(
    '_renderAllActiveTrueObservedAfterLoad = _lccSceneManager.IsRenderAll();',
    '!_renderAllPendingDefaultDerivedFromFreshRenderer',
    '!_renderAllPendingTrueRequestedBeforeLoad',
    '!_renderAllActiveTrueObservedAfterLoad'
)) {
    if ($loadedHandlerSource.IndexOf($postLoadRenderAllContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The post-load active render-all admission is missing '$postLoadRenderAllContract'."
    }
}

$deferredSceneUnsubscribeIndex = $moduleSource.IndexOf(
    'private async UniTask StartCaptureAfterSceneEventDispatchAsync()',
    [StringComparison]::Ordinal)
$failSceneContractIndex = $moduleSource.IndexOf(
    'private void FailSceneLoadContract(',
    [StringComparison]::Ordinal)
$deferredSceneUnsubscribeSource = $moduleSource.Substring(
    $deferredSceneUnsubscribeIndex,
    $failSceneContractIndex - $deferredSceneUnsubscribeIndex)
$sceneYieldIndex = $deferredSceneUnsubscribeSource.IndexOf(
    'await UniTask.Yield(PlayerLoopTiming.LastPostLateUpdate);',
    [StringComparison]::Ordinal)
$beginRemovalIndex = $deferredSceneUnsubscribeSource.IndexOf(
    'UnsubscribeSceneLoadBegin();',
    [StringComparison]::Ordinal)
$loadedRemovalIndex = $deferredSceneUnsubscribeSource.IndexOf(
    'UnsubscribeSceneLoaded();',
    [StringComparison]::Ordinal)
if ($sceneYieldIndex -lt 0 -or $beginRemovalIndex -lt $sceneYieldIndex -or
    $loadedRemovalIndex -lt $sceneYieldIndex) {
    throw 'Scene-load handlers must be removed only after the mutable vendor dispatch has yielded.'
}

$restorePreLoadIndex = $moduleSource.IndexOf(
    'private void RestorePreLoadRenderState()',
    [StringComparison]::Ordinal)
$attemptRestoreIndex = $moduleSource.IndexOf(
    'private static void AttemptRestore(',
    [StringComparison]::Ordinal)
$restorePreLoadSource = $moduleSource.Substring(
    $restorePreLoadIndex,
    $attemptRestoreIndex - $restorePreLoadIndex)
foreach ($pendingResetContract in @(
    '_renderAllPendingFalseResetAttempted = true;',
    '_lccSceneManager.SetRenderAll(false);',
    '_renderAllPendingFalseResetCallCompleted = true;'
)) {
    if ($restorePreLoadSource.IndexOf($pendingResetContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The pending render-all cleanup is missing '$pendingResetContract'."
    }
}
if ($restorePreLoadSource.IndexOf('_lccSceneManager.IsRenderAll()', [StringComparison]::Ordinal) -ge 0 -or
    @([Regex]::Matches($moduleSource, '_lccSceneManager\.SetRenderAll\(false\);')).Count -ne 1) {
    throw 'Pending render-all reset must be requested once without a fabricated public read-back.'
}
foreach ($renderAllReceiptContract in @(
    'public bool renderAllPendingDefaultDerivedFromFreshRenderer;',
    'public bool renderAllPendingTrueRequestedBeforeLoad;',
    'public bool renderAllActiveTrueObservedAfterLoad;',
    'public bool renderAllPendingFalseResetAttempted;',
    'public bool renderAllPendingFalseResetCallCompleted;',
    'public bool renderAllPendingResetReadbackAvailable;',
    'public string renderAllIsolationBoundary;'
)) {
    if ($receiptModelsSource.IndexOf($renderAllReceiptContract, [StringComparison]::Ordinal) -lt 0) {
        throw "Receipt v7 is missing render-all evidence '$renderAllReceiptContract'."
    }
}
if ($moduleSource.IndexOf('renderAllPendingResetReadbackAvailable = false', [StringComparison]::Ordinal) -lt 0 -or
    $moduleSource.IndexOf('renderAllIsolationBoundary = "disposable_process_exit"', [StringComparison]::Ordinal) -lt 0 -or
    $moduleSource.IndexOf('RenderAllMutated', [StringComparison]::Ordinal) -ge 0 -or
    $moduleSource.IndexOf('_originalRenderAll', [StringComparison]::Ordinal) -ge 0) {
    throw 'Receipt v7 no longer states the honest pending-reset/disposable-process boundary.'
}
foreach ($forbiddenDirectLoadContract in @(
    '_lccSceneManager.LoadScene(',
    '_sceneLoadedCallback',
    'HandleSceneLoadedCallback',
    'callbackObserved',
    'returnedHandlerNonNull'
)) {
    if ($moduleSource.IndexOf($forbiddenDirectLoadContract, [StringComparison]::Ordinal) -ge 0) {
        throw "The obsolete direct scene-load contract remains: $forbiddenDirectLoadContract"
    }
}
$writeBytesIndex = $moduleSource.IndexOf('private static void WriteNoReplaceBytes(', [StringComparison]::Ordinal)
$writeTextIndex = $moduleSource.IndexOf('private static void WriteNoReplaceText(', [StringComparison]::Ordinal)
if ($writeBytesIndex -lt 0 -or $writeTextIndex -le $writeBytesIndex) {
    throw 'The durable no-replace byte writer is missing.'
}
$writeBytesSource = $moduleSource.Substring($writeBytesIndex, $writeTextIndex - $writeBytesIndex)
if ($writeBytesSource.IndexOf('FileMode.CreateNew', [StringComparison]::Ordinal) -lt 0 -or
    $writeBytesSource.IndexOf('stream.Flush(true);', [StringComparison]::Ordinal) -lt 0 -or
    $writeBytesSource.IndexOf('File.Move(temporaryPath, path);', [StringComparison]::Ordinal) -lt 0) {
    throw 'The byte writer no longer durably flushes and promotes without replacement.'
}
$stateCaptureIndex = $moduleSource.IndexOf('context.CameraState = CaptureOriginalCameraState()', [StringComparison]::Ordinal)
$cameraApplyIndex = $moduleSource.IndexOf('ApplyLockedCamera(context.CameraState)', [StringComparison]::Ordinal)
if ($stateCaptureIndex -lt 0 -or $cameraApplyIndex -lt 0 -or $stateCaptureIndex -gt $cameraApplyIndex) {
    throw 'Original camera state is not assigned before capture-camera mutation.'
}

foreach ($immediateMutationContract in @(
    '(?s)_lccSceneManager\.SetRecordMode\(\s*true,.*?_cameraProfile\.Projection\.VerticalFieldOfViewDegrees\);\s*state\.RecordModeEnabled = true;',
    '_lccSceneManager\.SetLockFPS\(true\);\s*state\.LockFpsEnabled = true;',
    '_lccSceneManager\.SetEnvironmentData\(false\);\s*state\.EnvironmentExclusionRequested = true;'
)) {
    if ($moduleSource -notmatch $immediateMutationContract) {
        throw "A native mutation is not followed immediately by its cleanup-state transition: $immediateMutationContract"
    }
}
foreach ($renderModeContract in @(
    'CapturePolicy.RequireUltraQuality(',
    'RequireObservedUltraRenderAll();',
    'vendorFullRenderBudgetPredicate = "SupportFullRender(Ultra)"',
    'vendorFullRenderBudgetEligible =',
    'vendorFullRenderBudgetEligibilityUsedForAdmission = false',
    '_rendererQualityService.SupportFullRender(RenderQualityType.Ultra)',
    'renderAllRequestedBeforeSceneLoad = _renderAllPendingTrueRequestedBeforeLoad',
    'renderAllObservedAfterSceneLoad = _renderAllActiveTrueObservedAfterLoad'
)) {
    if ($moduleSource.IndexOf($renderModeContract, [StringComparison]::Ordinal) -lt 0) {
        throw "Native Ultra/render-all evidence is missing: $renderModeContract"
    }
}
if ($moduleSource.IndexOf('fullRenderSupported =', [StringComparison]::Ordinal) -ge 0 -or
    $moduleSource.IndexOf('vendorFullRenderBudgetEligibilityReported =', [StringComparison]::Ordinal) -ge 0 -or
    $moduleSource.IndexOf('RequireUltraFullRenderCapability', [StringComparison]::Ordinal) -ge 0) {
    throw 'The vendor scene-budget predicate is still being treated as full-render capability.'
}
foreach ($requiredIndependentRestore in @(
    'if (state.RecordModeEnabled)',
    'if (state.LockFpsEnabled)',
    'if (state.EnvironmentExclusionRequested)',
    'RestorePreLoadRenderState();',
    'throw new AggregateException("One or more native capture cleanup operations failed.", restoreErrors)'
)) {
    if ($moduleSource.IndexOf($requiredIndependentRestore, [StringComparison]::Ordinal) -lt 0) {
        throw "Independent cleanup evidence is missing: $requiredIndependentRestore"
    }
}

foreach ($obsoleteCaptureRoute in @(
    'CaptureToFileAsync(',
    'CaptureToTextureAsync(',
    'ExactTargetReadbackProbe',
    'RequireExactTargetReadbackRoute('
)) {
    if ($moduleSource.IndexOf($obsoleteCaptureRoute, [StringComparison]::Ordinal) -ge 0 -or
        $capturePolicySource.IndexOf($obsoleteCaptureRoute, [StringComparison]::Ordinal) -ge 0) {
        throw "The obsolete Camera.targetTexture/vendor capture route remains: '$obsoleteCaptureRoute'."
    }
}
if ($moduleSource -match '\.SetActive\s*\(' -or
    $moduleSource -match '\.TargetCamera\s*=(?!=)' -or
    $moduleSource -match '\.targetTexture\s*=(?!=)' -or
    $moduleSource -match '\.FrameRT\s*=(?!=)') {
    throw 'The first-party module must not activate/mutate SnapFrame, TargetCamera, Camera.targetTexture, or FrameRT.'
}

$lockedSnapFrameReferences = @(
    @('UnityEngine.UIModule.dll', 'F6B73BB8B4DFF00448F0C2E20BF9A92487128A05F81AAF814A1DE021DA59C6A5'),
    @('Unity.RenderPipelines.Core.Runtime.dll', 'E68FCEB04E8F571E6F2B10ED15D5FE19A83E274EC557E68AE2D72C3E068E074D'),
    @('Unity.RenderPipelines.Universal.Runtime.dll', '59458EF5AD12F800842598647AE8AE6E82A074852C1D2684B81A322FDBC86CE1'),
    @('Unity.RenderPipelines.GPUDriven.Runtime.dll', '5A240D9060CA4ED75FBBF6D764C777477B5F6D11B8AC0B58D00E4F730C61661C'),
    @('mscorlib.dll', 'E3CF08610C3F99B3436C106AB3C54564417B7EE47BC5D764311C4910B41EB1CE'),
    @('System.dll', '0EA6AFCCBD47AC4110E0C3EA6A9ED3A2B5154445CBFAAD23531E2924AE80D40B'),
    @('System.Core.dll', 'FFD6840FA7808D2372FED8542FEA05B0913AC03018A3BF2BD3D200F078595C49'),
    @('System.Memory.dll', 'C4F030A2CBA7DA7CDCF493257C24560E203D355904AEE490D645A935842F834A')
)
foreach ($lockedReference in $lockedSnapFrameReferences) {
    $name = [string]$lockedReference[0]
    $sha256 = [string]$lockedReference[1]
    if ($buildSource.IndexOf("'$name'", [StringComparison]::Ordinal) -lt 0 -or
        $moduleSource.IndexOf($name, [StringComparison]::Ordinal) -lt 0 -or
        $moduleSource.IndexOf($sha256, [StringComparison]::Ordinal) -lt 0) {
        throw "The public SnapFrame dependency is not compile-time and runtime locked: $name."
    }
}
foreach ($unityProfileCompileContract in @(
    "'/nostdlib+'",
    "'mscorlib.dll'",
    "'System.dll'",
    "'System.Core.dll'",
    "'System.Memory.dll'",
    "'Unity.RenderPipelines.GPUDriven.Runtime.dll'"
)) {
    if ($buildSource.IndexOf($unityProfileCompileContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The locked Unity-profile ReadOnlySpan build is missing '$unityProfileCompileContract'."
    }
}

$inventoryMethodStart = $moduleSource.IndexOf(
    'internal static UrpRendererInventoryReceipt CaptureReadOnlyUrpRendererInventory(',
    [StringComparison]::Ordinal)
$inventoryMethodEnd = $moduleSource.IndexOf(
    'private void CaptureFinalSurfaceState()',
    [StringComparison]::Ordinal)
if ($inventoryMethodStart -lt 0 -or $inventoryMethodEnd -le $inventoryMethodStart) {
    throw 'The bounded synchronous public-URP inventory method is missing.'
}
$inventoryMethodSource = $moduleSource.Substring(
    $inventoryMethodStart,
    $inventoryMethodEnd - $inventoryMethodStart)
foreach ($inventorySourceContract in @(
    'GraphicsSettings.currentRenderPipeline',
    'universalAsset.rendererDataList',
    'universalAsset.renderers',
    'rendererData.rendererFeatures',
    'rendererData.useNativeRenderPass',
    'feature.isActive',
    'SnapFrameCaptureFeature.Instance',
    '"UniversalRenderPipelineAsset.scriptableRenderer"',
    'matchesSnapFrameStaticInstance = matchesStaticInstance',
    'RuntimeHelpers.GetHashCode(renderer)',
    'rendererObjectIdentityStableDuringSynchronousInventory',
    'rendererFeatureIdentityAndActiveStateStableDuringSynchronousInventory',
    'snapFrameStaticInstanceStableDuringSynchronousInventory',
    'mutationObservedDuringSynchronousInventory'
)) {
    if ($inventoryMethodSource.IndexOf($inventorySourceContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The read-only URP renderer inventory is missing '$inventorySourceContract'."
    }
}
foreach ($inventoryAsyncOrCapturePattern in @(
    '\bawait\b',
    '=>',
    '\byield\s+return\b',
    '\.Select\s*\(',
    '\.Where\s*\(',
    '\.ToArray\s*\('
)) {
    if ($inventoryMethodSource -match $inventoryAsyncOrCapturePattern) {
        throw "The ReadOnlySpan inventory escaped its synchronous non-LINQ boundary: '$inventoryAsyncOrCapturePattern'."
    }
}
$inventoryCodeWithoutStrings = [Regex]::Replace(
    $inventoryMethodSource,
    '"(?:\\.|[^"\\])*"',
    '""')
foreach ($inventoryMutationPattern in @(
    '\.GetRenderer\s*\(',
    '\.scriptableRenderer\b',
    '\.SetRenderer\s*\(',
    '\.SetDirty\s*\(',
    '\.SetActive\s*\(',
    '\.Create\s*\(',
    '\.Dispose\s*\(',
    '\.rendererFeatures\s*\.(Add|Remove|Clear|Insert)\s*\('
)) {
    if ($inventoryCodeWithoutStrings -match $inventoryMutationPattern) {
        throw "The supposedly read-only URP inventory calls a mutation-risk API: '$inventoryMutationPattern'."
    }
}
foreach ($inventoryPolicyContract in @(
    'internal static void RequireReadOnlyUrpRendererInventory(',
    'inventory.prohibitedMutationApis.SequenceEqual(',
    'inventory.prohibitedMutationApis.Length != 6',
    'bool expectedStaticInstanceMatch = typeIsSnapFrame &&',
    'feature.instanceId == inventory.snapFrameStaticInstanceId',
    'feature.matchesSnapFrameStaticInstance !=',
    'inventory.snapFrameStaticInstanceId',
    'inventory.observationFrame < 0',
    '!IsFinite(inventory.observationRealtimeSeconds)',
    'inventory.sceneCameraRendererIndexProvenance,',
    'inventory.rendererDataAndInstanceCountsMatch !=',
    'feature.featureIndex != featureIndex',
    'rendererData.rendererDataIndex != dataIndex',
    'renderer.rendererIndex != rendererIndex',
    'feature.snapFrameCaptureFeatureType != typeIsSnapFrame',
    'inventory.snapFrameStaticInstanceMatchedConfiguredFeatureCount !=',
    'staticInstanceMatchCount',
    'inventory.sceneCameraRendererIndexInferred !='
)) {
    if ($capturePolicySource.IndexOf($inventoryPolicyContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The pure read-only URP inventory policy is missing '$inventoryPolicyContract'."
    }
}
foreach ($inventoryTestContract in @(
    'TestReadOnlyUrpRendererInventoryContract();',
    'configuredWithoutSingleton',
    'singletonOutsideConfiguredList',
    'blankNames',
    'nullSlots',
    'lazyRendererArray',
    'forgedTypeFlag',
    'duplicateIndex',
    'prohibitedApiDrift',
    'forgedSingletonMatch',
    'suppressedSingletonMatch',
    'forgedInferredProvenance',
    'forgedUnresolvedProvenance',
    'negativeFrame',
    'nonFiniteRealtime',
    'infiniteRealtime',
    'negativeRealtime'
)) {
    if ($capturePolicyTestsSource.IndexOf($inventoryTestContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The adversarial read-only URP inventory tests are missing '$inventoryTestContract'."
    }
}

$populateAttemptIndex = $moduleSource.IndexOf(
    'private async UniTask PopulateCaptureAttemptAsync(',
    [StringComparison]::Ordinal)
$snapFrameOperationIndex = $moduleSource.IndexOf(
    'private sealed class SnapFrameReadbackOperation : IDisposable',
    [StringComparison]::Ordinal)
$lockedRuntimeFileIndex = $moduleSource.IndexOf(
    'private sealed class LockedRuntimeFile',
    [StringComparison]::Ordinal)
if ($populateAttemptIndex -lt 0 -or $captureTimeoutIndex -le $populateAttemptIndex -or
    $finalizePngIndex -le $captureTimeoutIndex -or
    $snapFrameOperationIndex -le $finalizePngIndex -or
    $lockedRuntimeFileIndex -le $snapFrameOperationIndex) {
    throw 'The retained-attempt/SnapFrame-operation/publication pipeline structure is missing.'
}
$convergenceSource = $moduleSource.Substring(
    $captureConvergenceIndex,
    $populateAttemptIndex - $captureConvergenceIndex)
$inventoryAssignmentIndex = $convergenceSource.IndexOf(
    'capture.urpRendererInventory =',
    [StringComparison]::Ordinal)
$inventoryPolicyIndex = $convergenceSource.IndexOf(
    'CapturePolicy.RequireReadOnlyUrpRendererInventory(',
    [StringComparison]::Ordinal)
$convergenceStopwatchIndex = $convergenceSource.IndexOf(
    'var stopwatch = Stopwatch.StartNew();',
    [StringComparison]::Ordinal)
$attemptRetainedIndex = $convergenceSource.IndexOf(
    'capture.attempts.Add(attempt);',
    [StringComparison]::Ordinal)
$attemptCaptureIndex = $convergenceSource.IndexOf(
    'await PopulateCaptureAttemptAsync(state, candidatePath, attempt);',
    [StringComparison]::Ordinal)
if ($inventoryAssignmentIndex -lt 0 -or $inventoryPolicyIndex -lt 0 -or
    $convergenceStopwatchIndex -lt 0 -or
    $inventoryAssignmentIndex -gt $inventoryPolicyIndex -or
    $inventoryPolicyIndex -gt $convergenceStopwatchIndex -or
    $attemptRetainedIndex -lt 0 -or $attemptCaptureIndex -lt 0 -or
    $attemptRetainedIndex -gt $attemptCaptureIndex -or
    $convergenceSource.IndexOf('snapFrameSurface = new SnapFrameSurfaceReceipt()', [StringComparison]::Ordinal) -lt 0 -or
    $convergenceSource.IndexOf('underlyingCaptureCancellationAvailable = true', [StringComparison]::Ordinal) -lt 0 -or
    $convergenceSource.IndexOf('attempt.status = "rejected";', [StringComparison]::Ordinal) -lt 0 -or
    $convergenceSource.IndexOf('attempt.failureType = exception.GetType().FullName;', [StringComparison]::Ordinal) -lt 0 -or
    $convergenceSource.IndexOf('attempt.failureMessage = exception.Message;', [StringComparison]::Ordinal) -lt 0) {
    throw 'A failed public-SnapFrame attempt can disappear instead of remaining in receipt v7.'
}

$populateAttemptSource = $moduleSource.Substring(
    $populateAttemptIndex,
    $captureTimeoutIndex - $populateAttemptIndex)
$pixelReadIndex = $populateAttemptSource.IndexOf('texture.GetPixels32();', [StringComparison]::Ordinal)
$rasterAnalysisIndex = $populateAttemptSource.IndexOf('CapturePolicy.AnalyzeRgb24(', [StringComparison]::Ordinal)
$rasterAdmissionIndex = $populateAttemptSource.IndexOf('CapturePolicy.RequireNonDegenerateRaster(', [StringComparison]::Ordinal)
$exactRasterBindingIndex = $populateAttemptSource.IndexOf('CapturePolicy.RequireSnapFrameExactRasterBinding(', [StringComparison]::Ordinal)
$pngEncodeIndex = $populateAttemptSource.IndexOf('ImageConversion.EncodeToPNG(texture);', [StringComparison]::Ordinal)
$candidateWriteIndex = $populateAttemptSource.IndexOf('WriteNoReplaceBytes(candidatePath, pngBytes);', [StringComparison]::Ordinal)
$postWriteHashIndex = $populateAttemptSource.IndexOf('CapturePolicy.Sha256File(candidatePath);', [StringComparison]::Ordinal)
if ($pixelReadIndex -lt 0 -or $rasterAnalysisIndex -le $pixelReadIndex -or
    $rasterAdmissionIndex -le $rasterAnalysisIndex -or
    $exactRasterBindingIndex -le $rasterAdmissionIndex -or
    $pngEncodeIndex -le $exactRasterBindingIndex -or
    $candidateWriteIndex -le $pngEncodeIndex -or $postWriteHashIndex -le $candidateWriteIndex -or
    $populateAttemptSource.IndexOf('attempt.firstPartyTextureReadable = texture.isReadable;', [StringComparison]::Ordinal) -lt 0 -or
    $populateAttemptSource.IndexOf('attempt.firstPartyTextureNoMipChain = texture.mipmapCount == 1;', [StringComparison]::Ordinal) -lt 0 -or
    $populateAttemptSource.IndexOf('attempt.firstPartyTextureInstanceId != texture.GetInstanceID()', [StringComparison]::Ordinal) -lt 0 -or
    $populateAttemptSource.IndexOf('attempt.encodedSha256 = CapturePolicy.Sha256Bytes(pngBytes);', [StringComparison]::Ordinal) -lt 0 -or
    $populateAttemptSource.IndexOf('attempt.postWriteFileShaVerified = true;', [StringComparison]::Ordinal) -lt 0) {
    throw 'First-party SnapFrame RGB admission and exact-surface/raster binding must precede PNG encoding, durable publication, and byte/file hash agreement.'
}
$populateTextureOwnershipPattern = '(?s)Texture2D\s+texture\s*=\s*null;\s*byte\[\]\s+pngBytes;\s*try\s*\{\s*texture\s*=\s*await\s+CaptureTextureWithTimeout\(state,\s*attempt\);.*?ImageConversion\.EncodeToPNG\(texture\);.*?\}\s*finally\s*\{\s*if\s*\(texture\s*!=\s*null\)\s*\{\s*UnityEngine\.Object\.Destroy\(texture\);\s*\}\s*\}\s*ThrowIfStopped\(\);\s*WriteNoReplaceBytes\(candidatePath,\s*pngBytes\);'
if ($populateAttemptSource -notmatch $populateTextureOwnershipPattern) {
    throw 'The transferred first-party Texture2D is not owned by one try/finally spanning readback, raster admission, and PNG encoding before durable publication.'
}

$captureTextureSource = $moduleSource.Substring(
    $captureTimeoutIndex,
    $finalizePngIndex - $captureTimeoutIndex)
if ($moduleSource.IndexOf('private SnapFrameReadbackOperation _activeReadbackOperation;', [StringComparison]::Ordinal) -lt 0 -or
    $captureTextureSource -notmatch '(?s)Interlocked\.CompareExchange\(\s*ref _activeReadbackOperation,\s*operation,\s*null\) != null') {
    throw 'The module no longer owns exactly one cancellable SnapFrame operation through atomic registration and cleanup.'
}
$stopMethodStart = $moduleSource.IndexOf('public void Stop()', [StringComparison]::Ordinal)
$disposeMethodStart = $moduleSource.IndexOf('public void Dispose()', [StringComparison]::Ordinal)
if ($stopMethodStart -lt 0 -or $disposeMethodStart -le $stopMethodStart) {
    throw 'The terminal Stop/Dispose method boundaries are missing.'
}
$stopMethodSource = $moduleSource.Substring(
    $stopMethodStart,
    $disposeMethodStart - $stopMethodStart)
$stopLifecycleIndex = $stopMethodSource.IndexOf('_lifecycle.Stop();', [StringComparison]::Ordinal)
$stopOperationAbortIndex = $stopMethodSource.IndexOf('AbortActiveReadbackOperation();', [StringComparison]::Ordinal)
$stopLifecycleUnsubscribeIndex = $stopMethodSource.IndexOf('UnsubscribeModulesLoaded();', [StringComparison]::Ordinal)
if ($stopLifecycleIndex -lt 0 -or $stopOperationAbortIndex -le $stopLifecycleIndex -or
    $stopLifecycleUnsubscribeIndex -le $stopOperationAbortIndex) {
    throw 'Terminal Stop must close lifecycle entry, cancel the active SnapFrame operation, then remove subscriptions.'
}
foreach ($captureTextureContract in @(
    'var operation = new SnapFrameReadbackOperation(this, state, attempt);',
    'CancellationTokenSource deadlineCancellation = null;',
    'deadlineCancellation = new CancellationTokenSource();',
    'UniTask deadlineOrStopTask = WaitForCaptureDeadlineOrStopAsync(',
    'UniTask<Texture2D> captureTask = operation.CaptureAsync().Preserve();',
    'await UniTask.WhenAny(captureTask, deadlineOrStopTask);',
    'Texture2D completedTexture = null;',
    'bool completedTextureReturned = false;',
    'operation.Abort();',
    'cancelledTexture = await captureTask;',
    'UnityEngine.Object.Destroy(cancelledTexture);',
    'Exception cleanupFailure = null;',
    'if (cleanupFailure != null)',
    'attempt.captureTaskStopObserved = true;',
    'attempt.captureTaskTimeoutObserved = true;',
    'attempt.captureTaskCompletedBeforeDeadline = true;',
    'completedTextureReturned = true;',
    'return completedTexture;',
    'deadlineCancellation.Cancel();',
    'deadlineCancellation.Dispose();',
    'operation.Dispose();'
)) {
    if ($captureTextureSource.IndexOf($captureTextureContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The bounded, cooperatively cancellable SnapFrame contract is missing '$captureTextureContract'."
    }
}
$captureFinallyIndex = $captureTextureSource.LastIndexOf('finally', [StringComparison]::Ordinal)
if ($captureFinallyIndex -lt 0) {
    throw 'The SnapFrame-operation final cleanup block is missing.'
}
$captureFinallySource = $captureTextureSource.Substring($captureFinallyIndex)
$unreturnedTextureDestroyIndex = $captureFinallySource.IndexOf('if (!completedTextureReturned && completedTexture != null)', [StringComparison]::Ordinal)
$deadlineCancelIndex = $captureFinallySource.IndexOf('deadlineCancellation.Cancel();', [StringComparison]::Ordinal)
$deadlineDisposeIndex = $captureFinallySource.IndexOf('deadlineCancellation.Dispose();', [StringComparison]::Ordinal)
$finalOperationAbortIndex = $captureFinallySource.IndexOf('operation.Abort();', [StringComparison]::Ordinal)
$activeOperationClearIndex = $captureFinallySource.IndexOf('Interlocked.CompareExchange(', [StringComparison]::Ordinal)
$operationDisposeIndex = $captureFinallySource.IndexOf('operation.Dispose();', [StringComparison]::Ordinal)
if ($unreturnedTextureDestroyIndex -lt 0 -or
    $deadlineCancelIndex -le $unreturnedTextureDestroyIndex -or $deadlineDisposeIndex -le $deadlineCancelIndex -or
    $finalOperationAbortIndex -le $deadlineDisposeIndex -or
    $activeOperationClearIndex -le $finalOperationAbortIndex -or
    $operationDisposeIndex -le $activeOperationClearIndex -or
    $captureFinallySource -notmatch '(?s)Interlocked\.CompareExchange\(\s*ref _activeReadbackOperation,\s*null,\s*operation\);') {
    throw 'SnapFrame finalization must destroy an unreturned owned texture, cancel/dispose the deadline loser, abort, atomically clear ownership, then dispose.'
}
$deadlineTaskIndex = $captureTextureSource.IndexOf(
    'UniTask deadlineOrStopTask = WaitForCaptureDeadlineOrStopAsync(',
    [StringComparison]::Ordinal)
$capturePreserveIndex = $captureTextureSource.IndexOf('operation.CaptureAsync().Preserve();', [StringComparison]::Ordinal)
$captureWaitIndex = $captureTextureSource.IndexOf('await UniTask.WhenAny(captureTask, deadlineOrStopTask)', [StringComparison]::Ordinal)
$timeoutAbortIndex = $captureTextureSource.IndexOf('operation.Abort();', [StringComparison]::Ordinal)
$cancelledAwaitIndex = $captureTextureSource.IndexOf('cancelledTexture = await captureTask;', [StringComparison]::Ordinal)
if ($deadlineTaskIndex -lt 0 -or $capturePreserveIndex -le $deadlineTaskIndex -or
    $captureWaitIndex -le $capturePreserveIndex -or
    $timeoutAbortIndex -le $captureWaitIndex -or $cancelledAwaitIndex -le $timeoutAbortIndex) {
    throw 'Deadline/Stop handling must preserve one operation, cancel its four-EOF handshake, and await exact restoration before throwing.'
}

$deadlineOrStopStart = $moduleSource.IndexOf(
    'private async UniTask WaitForCaptureDeadlineOrStopAsync(',
    [StringComparison]::Ordinal)
if ($deadlineOrStopStart -le $captureTimeoutIndex -or $deadlineOrStopStart -ge $finalizePngIndex) {
    throw 'The cooperative deadline/Stop helper is missing or outside the bounded SnapFrame operation.'
}
$deadlineOrStopSource = $moduleSource.Substring(
    $deadlineOrStopStart,
    $finalizePngIndex - $deadlineOrStopStart)
foreach ($deadlineOrStopContract in @(
    'await UniTask.WhenAny(',
    'UniTask.Delay(',
    'TimeSpan.FromSeconds(CapturePolicy.PerCaptureTimeoutSeconds)',
    'delegate { return _lifecycle.IsStopped; }',
    'PlayerLoopTiming.Update',
    'cancellationToken',
    'SuppressCancellationThrow()'
)) {
    if ($deadlineOrStopSource.IndexOf($deadlineOrStopContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The cooperative deadline/Stop helper is missing '$deadlineOrStopContract'."
    }
}
if (@([Regex]::Matches($deadlineOrStopSource, 'SuppressCancellationThrow\(\)')).Count -ne 2) {
    throw 'Both the deadline and terminal-Stop cooperative waiters must suppress their shared cancellation.'
}

$finalizePngSource = $moduleSource.Substring(
    $finalizePngIndex,
    $moduleSource.IndexOf('private void PruneOldCandidates(', [StringComparison]::Ordinal) - $finalizePngIndex)
foreach ($finalPublicationContract in @(
    'byte[] selectedBytes = File.ReadAllBytes(capture.selectedAttemptPath);',
    'CapturePolicy.Sha256Bytes(selectedBytes);',
    'WriteNoReplaceBytes(finalPath, selectedBytes);',
    'CapturePolicy.Sha256File(finalPath);'
)) {
    if ($finalizePngSource.IndexOf($finalPublicationContract, [StringComparison]::Ordinal) -lt 0) {
        throw "Final PNG publication is missing '$finalPublicationContract'."
    }
}

$snapFrameOperationSource = $moduleSource.Substring(
    $snapFrameOperationIndex,
    $lockedRuntimeFileIndex - $snapFrameOperationIndex)
foreach ($snapFrameOperationContract in @(
    '(float)CapturePolicy.SnapFrameSentinelTranslationMetres,',
    'private const string BaselineStage = "baseline_exact";',
    'private const string SentinelStage = "sentinel_discard";',
    'private const string RestoredStage = "restored_exact";',
    'private const string StableStage = "stable_exact";',
    'SnapFrameCaptureFeature.Instance;',
    '_feature.TargetCamera',
    '_feature.FrameRT',
    '_feature.FrameDirty',
    '_feature.isActive',
    '_surface.graphicsDeviceType = SystemInfo.graphicsDeviceType.ToString();',
    '_surface.graphicsUvStartsAtTop = SystemInfo.graphicsUVStartsAtTop;',
    '_surface.activeColorSpace = QualitySettings.activeColorSpace.ToString();',
    '_surface.readPixelsCoordinateOrigin =',
    'CapturePolicy.SnapFrameReadPixelsCoordinateOrigin;',
    '_surface.cpuRowTransform = CapturePolicy.SnapFrameCpuRowTransform;',
    'internal async UniTask<Texture2D> CaptureAsync()',
    'internal void Abort()',
    'public void Dispose()',
    'CapturePolicy.RequireSnapFrameCaptureRoute(',
    '_attempt.pixelSource = CapturePolicy.SnapFramePixelSource;',
    '_attempt.readbackTrigger = "public_snap_frame_four_eof_camera_callback_handshake";'
)) {
    if ($snapFrameOperationSource.IndexOf($snapFrameOperationContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The direct public SnapFrame operation is missing '$snapFrameOperationContract'."
    }
}
if ($snapFrameOperationSource -match 'UnityEngine\.Object\.DestroyImmediate\s*\(' -or
    $snapFrameOperationSource -match '\.Release\s*\(') {
    throw 'The first-party module must never destroy or release the vendor-owned SnapFrame FrameRT.'
}
$allowedSnapFrameDestroyArguments = @('sentinelTexture', 'exactTexture', 'texture')
foreach ($destroyCall in [Regex]::Matches(
        $snapFrameOperationSource,
        'UnityEngine\.Object\.Destroy\(\s*(?<argument>[^\)\r\n]+)\s*\)')) {
    $destroyArgument = $destroyCall.Groups['argument'].Value.Trim()
    if ($allowedSnapFrameDestroyArguments -cnotcontains $destroyArgument) {
        throw "The SnapFrame operation destroys an unowned or vendor-surface object '$destroyArgument'."
    }
}

$captureAsyncStart = $snapFrameOperationSource.IndexOf(
    'internal async UniTask<Texture2D> CaptureAsync()',
    [StringComparison]::Ordinal)
$abortStart = $snapFrameOperationSource.IndexOf(
    'internal void Abort()',
    [StringComparison]::Ordinal)
if ($captureAsyncStart -lt 0 -or $abortStart -le $captureAsyncStart) {
    throw 'The four-end-of-frame SnapFrame operation boundaries are missing.'
}
$captureAsyncSource = $snapFrameOperationSource.Substring(
    $captureAsyncStart,
    $abortStart - $captureAsyncStart)
if (@([Regex]::Matches(
        $captureAsyncSource,
        [Regex]::Escape('await UniTask.WaitForEndOfFrame(_cancellation.Token);'))).Count -ne 4) {
    throw 'The SnapFrame operation must use exactly four cancellable end-of-frame waits.'
}
$orderedCaptureContracts = @(
    'CaptureInitialSurfaceState();',
    'Subscribe();',
    'BaselineStage,',
    'await UniTask.WaitForEndOfFrame(_cancellation.Token);',
    '_surface.dirtyBeforeRequest = ToDirtyObservation(baseline);',
    '_surface.frameRenderTextureBefore = ObserveAndRequireFrameRenderTexture(',
    'ApplyPose(_sentinelPosition, _exactRotation);',
    '_surface.sentinelPosition = ToArray(_sentinelPosition);',
    '_surface.sentinelWorldToCameraMatrixColumnMajor =',
    'SentinelStage,',
    'await UniTask.WaitForEndOfFrame(_cancellation.Token);',
    '_surface.dirtyAfterRequest = ToDirtyObservation(sentinel);',
    '_surface.frameRenderTextureAfterDirtyRequest = ObserveAndRequireFrameRenderTexture(',
    'sentinelTexture = ReadFrameRenderTexture(',
    '_surface.sentinelRaster = CapturePolicy.AnalyzeRgb24(',
    'CapturePolicy.RequireNonDegenerateRaster(',
    'UnityEngine.Object.Destroy(sentinelTexture);',
    'RestoreExactCameraState();',
    'RestoredStage,',
    'await UniTask.WaitForEndOfFrame(_cancellation.Token);',
    '_surface.dirtyBeforeReadback = ToDirtyObservation(restored);',
    '_surface.frameRenderTextureBeforeReadback = ObserveAndRequireFrameRenderTexture(',
    'StableStage,',
    'await UniTask.WaitForEndOfFrame(_cancellation.Token);',
    '_surface.dirtyAfterCompletion = ToDirtyObservation(stable);',
    '_surface.frameRenderTextureAfter = ObserveAndRequireFrameRenderTexture(',
    '_surface.exactRestoreVerified = ExactCameraStateMatches();',
    'exactTexture = ReadFrameRenderTexture(_feature.FrameRT, _surface.readback);',
    '_surface.exactFrameRgb24Sha256 = CapturePolicy.Sha256Bytes(exactRgb24);',
    '_surface.sentinelAndExactRgbDiffer = !String.Equals(',
    '_attempt.pixelSource = CapturePolicy.SnapFramePixelSource;',
    'CaptureExactCameraAfterState();',
    'CaptureFinalSurfaceState();',
    'Unsubscribe();',
    'CapturePolicy.RequireSnapFrameCaptureRoute(',
    'exactOwnershipTransferred = true;',
    'return exactTexture;'
)
$orderedSearchFrom = 0
foreach ($orderedCaptureContract in $orderedCaptureContracts) {
    $orderedCaptureIndex = $captureAsyncSource.IndexOf(
        $orderedCaptureContract,
        $orderedSearchFrom,
        [StringComparison]::Ordinal)
    if ($orderedCaptureIndex -lt 0) {
        throw "The four-EOF sentinel/restore/readback sequence is missing or out of order at '$orderedCaptureContract'."
    }
    $orderedSearchFrom = $orderedCaptureIndex + $orderedCaptureContract.Length
}
foreach ($captureFinallyContract in @(
    'finally',
    'Exception cleanupFailure = null;',
    'if (!ExactCameraStateMatches())',
    'RestoreExactCameraState();',
    'CaptureExactCameraAfterState();',
    '_owner.RequireLockedCameraState(_cameraState);',
    'CaptureFinalSurfaceState();',
    'Unsubscribe();',
    'if (sentinelTexture != null)',
    'if ((!exactOwnershipTransferred || cleanupFailure != null) &&',
    'Exception combinedFailure = operationFailure == null',
    'new AggregateException(operationFailure, cleanupFailure);',
    'throw new InvalidOperationException('
)) {
    if ($captureAsyncSource.IndexOf($captureFinallyContract, [StringComparison]::Ordinal) -lt 0) {
        throw "SnapFrame camera/readback cleanup is missing '$captureFinallyContract'."
    }
}
if ($captureAsyncSource.IndexOf('Exception operationFailure = null;', [StringComparison]::Ordinal) -lt 0 -or
    $captureAsyncSource.IndexOf('operationFailure = exception;', [StringComparison]::Ordinal) -lt 0) {
    throw 'SnapFrame operation failures are not retained for cleanup-failure aggregation.'
}
foreach ($exactAfterContract in @(
    'private void CaptureExactCameraAfterState()',
    '_surface.exactPositionAfter = ToArray(_camera.transform.position);',
    '_surface.exactRotationXyzwAfter = ToArray(_camera.transform.rotation);',
    '_surface.exactWorldToCameraMatrixColumnMajorAfter =',
    '_surface.exactProjectionMatrixColumnMajorAfter =',
    '_surface.exactRestoreVerified = ExactCameraStateMatches();'
)) {
    if ($snapFrameOperationSource.IndexOf($exactAfterContract, [StringComparison]::Ordinal) -lt 0) {
        throw "Exact after-state and restoration evidence is missing '$exactAfterContract'."
    }
}

foreach ($cameraCallbackContract in @(
    'RenderPipelineManager.beginCameraRendering += _beginHandler;',
    'RenderPipelineManager.endCameraRendering += _endHandler;',
    'RenderPipelineManager.beginCameraRendering -= _beginHandler;',
    'RenderPipelineManager.endCameraRendering -= _endHandler;',
    'RecordCameraCallback("begin", callbackCamera);',
    'RecordCameraCallback("end", callbackCamera);',
    'callbackCamera.GetInstanceID() != _cameraInstanceId',
    'cameraMatchesExactSceneCamera = sceneCameraMatch',
    'poseMatchesStage = poseMatches',
    'projectionMatchesExactProfile = projectionMatches',
    'frameDirty = _feature != null && _feature.FrameDirty',
    '_surface.beginCameraRenderingCallbackCount += 1;',
    '_surface.endCameraRenderingCallbackCount += 1;',
    'private SnapFrameCameraCallbackReceipt RequireStageEndCallback(',
    'candidate.cameraMatchesExactSceneCamera',
    'candidate.targetTextureNull',
    'candidate.poseMatchesStage',
    'candidate.projectionMatchesExactProfile',
    'candidate.frameDirty == expectedDirty'
)) {
    if ($snapFrameOperationSource.IndexOf($cameraCallbackContract, [StringComparison]::Ordinal) -lt 0) {
        throw "Exact-camera begin/end callback provenance is missing '$cameraCallbackContract'."
    }
}

foreach ($surfaceIsolationContract in @(
    'UniversalAdditionalCameraData',
    'CameraRenderType.Base',
    'data.cameraStack.Count',
    'Resources.FindObjectsOfTypeAll<Canvas>()',
    'canvas.renderMode == UnityEngine.RenderMode.WorldSpace ||',
    'canvas.renderMode == UnityEngine.RenderMode.ScreenSpaceCamera',
    'Resources.FindObjectsOfTypeAll<GameObject>()',
    'IsKnownCaptureOverlayName(candidate.name)',
    '_owner._captureManager.IsCaptureViewVisible',
    '_owner._sceneManager.IsGridVisible',
    '_owner._sceneManager.IsSceneGizmoVisible',
    '_owner._sceneManager.ShowTrajectory',
    '_owner._sceneManager.SceneCameraInteraction',
    '_owner._sceneManager.SceneCameraScreenRenderer',
    '_surface.cleanViewStateVerifiedAtEveryCheckpoint &= cleanView;',
    '_surface.cameraConfigurationUnchanged =',
    'RectArraysEqual(_surface.sceneCameraPixelRectAfter, _surface.sceneCameraPixelRect)'
)) {
    if ($snapFrameOperationSource.IndexOf($surfaceIsolationContract, [StringComparison]::Ordinal) -lt 0) {
        throw "SnapFrame overlay/canvas/camera-stack isolation is missing '$surfaceIsolationContract'."
    }
}
if (@([Regex]::Matches(
        $captureAsyncSource,
        [Regex]::Escape('RequireCheckpoint('))).Count -ne 4) {
    throw 'The four-EOF operation must execute exactly four surface-contamination checkpoints.'
}
$captureOverlayInventoryStart = $snapFrameOperationSource.IndexOf(
    'private void CaptureOverlayInventory()',
    [StringComparison]::Ordinal)
$requireNoUnsafeStart = $snapFrameOperationSource.IndexOf(
    'private void RequireNoUnsafeSurfaceContributor()',
    [StringComparison]::Ordinal)
$requireCheckpointStart = $snapFrameOperationSource.IndexOf(
    'private void RequireCheckpoint(',
    [StringComparison]::Ordinal)
$observeFrameRenderTextureStart = $snapFrameOperationSource.IndexOf(
    'private SnapFrameRenderTextureObservationReceipt ObserveAndRequireFrameRenderTexture(',
    [StringComparison]::Ordinal)
if ($captureOverlayInventoryStart -lt 0 -or $requireNoUnsafeStart -le $captureOverlayInventoryStart -or
    $requireCheckpointStart -le $requireNoUnsafeStart -or
    $observeFrameRenderTextureStart -le $requireCheckpointStart) {
    throw 'The SnapFrame overlay-inventory/checkpoint method boundaries are missing.'
}
$captureOverlayInventorySource = $snapFrameOperationSource.Substring(
    $captureOverlayInventoryStart,
    $requireNoUnsafeStart - $captureOverlayInventoryStart)
foreach ($stickyInventoryContract in @(
    '_surface.unsafeRenderThroughCanvasObserved |= unsafeCanvas;',
    '(_surface.knownActiveCaptureOverlayNames ??',
    '.Concat(currentOverlayNames)',
    '_surface.knownActiveCaptureOverlayNames = overlayNames;',
    '_surface.knownActiveCaptureOverlayCount = overlayNames.Length;'
)) {
    if ($captureOverlayInventorySource.IndexOf($stickyInventoryContract, [StringComparison]::Ordinal) -lt 0) {
        throw "Transient Canvas/overlay evidence is not sticky across checkpoints: '$stickyInventoryContract'."
    }
}
$requireCheckpointSource = $snapFrameOperationSource.Substring(
    $requireCheckpointStart,
    $observeFrameRenderTextureStart - $requireCheckpointStart)
foreach ($checkpointInventoryContract in @(
    'CaptureOverlayInventory();',
    '_surface.knownActiveCaptureOverlayCount == 0',
    '!_surface.unsafeRenderThroughCanvasObserved',
    '_surface.cleanViewStateVerifiedAtEveryCheckpoint &= cleanView;'
)) {
    if ($requireCheckpointSource.IndexOf($checkpointInventoryContract, [StringComparison]::Ordinal) -lt 0) {
        throw "A four-EOF checkpoint no longer refreshes and retains transient surface evidence: '$checkpointInventoryContract'."
    }
}

foreach ($frameRenderTextureContract in @(
    'RenderTexture frameRenderTexture = _feature.FrameRT;',
    'isLive = frameRenderTexture != null',
    'isCreated = frameRenderTexture != null && frameRenderTexture.IsCreated()',
    'width = frameRenderTexture == null ? 0 : frameRenderTexture.width',
    'height = frameRenderTexture == null ? 0 : frameRenderTexture.height',
    'depth = frameRenderTexture == null ? 0 : frameRenderTexture.depth',
    'antiAliasing = frameRenderTexture == null ? 0 : frameRenderTexture.antiAliasing',
    'colorFormat = frameRenderTexture == null',
    'frameRenderTexture.format.ToString()',
    'graphicsFormat = frameRenderTexture == null',
    'frameRenderTexture.graphicsFormat.ToString()',
    'sRgb = frameRenderTexture != null && frameRenderTexture.sRGB',
    'receipt.width != _owner._cameraProfile.Output.Width',
    'receipt.width != _camera.pixelWidth || receipt.height != _camera.pixelHeight',
    'receipt.depth != 0 || receipt.antiAliasing != 1',
    'receipt.useMipMap || receipt.autoGenerateMips',
    'expectedInstanceId != 0 && receipt.instanceId != expectedInstanceId',
    '_frameRenderTextureInstanceId != receipt.instanceId'
)) {
    if ($snapFrameOperationSource.IndexOf($frameRenderTextureContract, [StringComparison]::Ordinal) -lt 0) {
        throw "Stable, live 1600x900 public FrameRT proof is missing '$frameRenderTextureContract'."
    }
}

foreach ($runtimeFiniteContract in @(
    'private static void RequireProjectionValue(string label, float actual, float expected)',
    'if (!IsFinite(actual) || !IsFinite(expected) ||',
    'private static bool IsFinite(float value)',
    'return !Single.IsNaN(value) && !Single.IsInfinity(value);',
    'IsFinite(camera.transform.position.x)',
    'IsFinite(expectedPosition.x)',
    'IsFinite(rotationDot)',
    'if (!IsFinite(leftValue) || !IsFinite(rightValue) ||'
)) {
    if ($moduleSource.IndexOf($runtimeFiniteContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The runtime camera/projection comparator is not finite-number fail-closed: '$runtimeFiniteContract'."
    }
}

$operationDisposeStart = $snapFrameOperationSource.IndexOf(
    'public void Dispose()',
    [StringComparison]::Ordinal)
$captureInitialSurfaceStart = $snapFrameOperationSource.IndexOf(
    'private void CaptureInitialSurfaceState()',
    [StringComparison]::Ordinal)
if ($operationDisposeStart -lt 0 -or $captureInitialSurfaceStart -le $operationDisposeStart) {
    throw 'The SnapFrame operation Dispose method boundaries are missing.'
}
$operationDisposeSource = $snapFrameOperationSource.Substring(
    $operationDisposeStart,
    $captureInitialSurfaceStart - $operationDisposeStart)
$disposeAbortIndex = $operationDisposeSource.IndexOf('Abort();', [StringComparison]::Ordinal)
$disposeCancellationIndex = $operationDisposeSource.IndexOf('_cancellation.Dispose();', [StringComparison]::Ordinal)
if ($operationDisposeSource.IndexOf('Interlocked.Exchange(ref _disposed, 1)', [StringComparison]::Ordinal) -lt 0 -or
    $disposeAbortIndex -lt 0 -or $disposeCancellationIndex -le $disposeAbortIndex) {
    throw 'SnapFrame operation disposal must be idempotent, abort cooperative waits, then dispose its CancellationTokenSource.'
}

$readFrameStart = $snapFrameOperationSource.IndexOf(
    'private Texture2D ReadFrameRenderTexture(',
    [StringComparison]::Ordinal)
$applyPoseStart = $snapFrameOperationSource.IndexOf(
    'private void ApplyPose(',
    [StringComparison]::Ordinal)
if ($readFrameStart -lt 0 -or $applyPoseStart -le $readFrameStart) {
    throw 'The first-party SnapFrame RGB24 readback method boundaries are missing.'
}
$readFrameSource = $snapFrameOperationSource.Substring(
    $readFrameStart,
    $applyPoseStart - $readFrameStart)
$previousActiveIndex = $readFrameSource.IndexOf('RenderTexture previousActive = RenderTexture.active;', [StringComparison]::Ordinal)
$setActiveIndex = $readFrameSource.IndexOf('RenderTexture.active = frameRenderTexture;', [StringComparison]::Ordinal)
$verifyActiveIndex = $readFrameSource.IndexOf('active.GetInstanceID() == _frameRenderTextureInstanceId;', [StringComparison]::Ordinal)
$rgb24Index = $readFrameSource.IndexOf('TextureFormat.RGB24,', [StringComparison]::Ordinal)
$readPixelsIndex = $readFrameSource.IndexOf('texture.ReadPixels(', [StringComparison]::Ordinal)
$applyIndex = $readFrameSource.IndexOf('texture.Apply(false, false);', [StringComparison]::Ordinal)
$restoreActiveIndex = $readFrameSource.IndexOf('RenderTexture.active = readback.renderTextureActiveWasNullBeforeReadback', [StringComparison]::Ordinal)
$verifyRestoredIndex = $readFrameSource.IndexOf('readback.renderTextureActiveRestored =', [StringComparison]::Ordinal)
$stableAfterReadbackIndex = $readFrameSource.IndexOf('RenderTexture current = _feature.FrameRT;', [StringComparison]::Ordinal)
if ($previousActiveIndex -lt 0 -or $setActiveIndex -le $previousActiveIndex -or
    $verifyActiveIndex -le $setActiveIndex -or $rgb24Index -le $verifyActiveIndex -or
    $readPixelsIndex -le $rgb24Index -or $applyIndex -le $readPixelsIndex -or
    $restoreActiveIndex -le $applyIndex -or $verifyRestoredIndex -le $restoreActiveIndex -or
    $stableAfterReadbackIndex -le $verifyRestoredIndex -or
    $readFrameSource -notmatch '(?s)finally\s*{\s*RenderTexture\.active = readback\.renderTextureActiveWasNullBeforeReadback\s*\? null\s*:\s*previousActive;' -or
    $readFrameSource.IndexOf('readback.firstPartyTextureDistinctFromVendorFrameRenderTexture =', [StringComparison]::Ordinal) -lt 0 -or
    $readFrameSource.IndexOf('readback.vendorFrameRenderTextureDestroyRequested = false;', [StringComparison]::Ordinal) -lt 0) {
    throw 'First-party RGB24 FrameRT ReadPixels/Apply must save, verify, and exactly restore RenderTexture.active without destroying FrameRT.'
}

$routePolicyStart = $capturePolicySource.IndexOf(
    'internal static void RequireSnapFrameCaptureRoute(',
    [StringComparison]::Ordinal)
$expectedInputFilesStart = $capturePolicySource.IndexOf(
    'internal static readonly ExpectedFile[] ExpectedInputFiles',
    [StringComparison]::Ordinal)
if ($routePolicyStart -lt 0 -or $expectedInputFilesStart -le $routePolicyStart) {
    throw 'The tested pure SnapFrame route-policy boundaries are missing.'
}
$routePolicySource = $capturePolicySource.Substring(
    $routePolicyStart,
    $expectedInputFilesStart - $routePolicyStart)
if ($capturePolicySource.IndexOf(
        'internal const double SnapFrameSentinelTranslationMetres = 0.05;',
        [StringComparison]::Ordinal) -lt 0 -or
    $capturePolicyTestsSource.IndexOf(
        'CapturePolicy.SnapFrameSentinelTranslationMetres,',
        [StringComparison]::Ordinal) -lt 0 -or
    $capturePolicyTestsSource.IndexOf(
        'sentinelPosition = new[] { 1.05, 2.0, 3.0 },',
        [StringComparison]::Ordinal) -lt 0) {
    throw 'The exact five-centimetre SnapFrame sentinel constant and valid receipt fixture are not locked.'
}
foreach ($routeContract in @(
    'SnapFrameFeatureTypeFullName',
    'surface.featureBaseActiveBefore',
    'surface.featureBaseActiveAfter',
    'surface.featureTargetCameraInstanceIdBefore != surface.sceneCameraInstanceId',
    'surface.sceneCameraTargetTextureNullBefore',
    'surface.captureViewAbsentBefore',
    'surface.unsafeRenderThroughCanvasObserved',
    'surface.knownActiveCaptureOverlayCount != 0',
    'canvas.canRenderThroughSceneCamera',
    'surface.cleanViewStateVerifiedAtEveryCheckpoint',
    'String.IsNullOrEmpty(surface.graphicsDeviceType)',
    'String.IsNullOrEmpty(surface.activeColorSpace)',
    'surface.readPixelsCoordinateOrigin,',
    'SnapFrameReadPixelsCoordinateOrigin,',
    'surface.cpuRowTransform,',
    'SnapFrameCpuRowTransform,',
    'surface.universalCameraStackCount != 0',
    'SnapFrameSurfaceProvenance',
    'RequireSnapFrameRenderTextureObservation(',
    'observation.depth != 0 || observation.antiAliasing != 1',
    'observation.colorFormat, "ARGB32"',
    'String.IsNullOrEmpty(observation.graphicsFormat)',
    'surface.frameRenderTextureAfterDirtyRequest.graphicsFormat,',
    'surface.frameRenderTextureBeforeReadback.graphicsFormat,',
    'surface.frameRenderTextureAfter.graphicsFormat,',
    'surface.frameRenderTextureAfterDirtyRequest.sRgb !=',
    'surface.frameRenderTextureBeforeReadback.sRgb !=',
    'surface.frameRenderTextureAfter.sRgb !=',
    'surface.frameRenderTextureBefore.sRgb',
    'RequireSnapFrameDirtySequence(surface);',
    'surface.dirtyBeforeRequest.dirty',
    '!surface.dirtyAfterRequest.dirty',
    '!surface.dirtyBeforeReadback.dirty',
    'surface.dirtyAfterCompletion.dirty',
    'surface.frameRenderTextureBefore.observationFrame !=',
    'surface.dirtyBeforeRequest.observationFrame',
    'surface.sentinelPoseReached',
    'surface.exactRestoreVerified',
    'SentinelPositionMatchesExpected(',
    'SnapFrameSentinelTranslationMetres',
    'IsFiniteVector(surface.sentinelWorldToCameraMatrixColumnMajor, 16)',
    'RequireSnapFrameCallbackHistory(surface);',
    'surface.beginCameraRenderingCallbackCount < 4',
    'surface.endCameraRenderingCallbackCount < 4',
    'surface.cameraCallbacks.Count < 8',
    'callback.sequence < end.sequence',
    'callback.frame == frame && callback.sequence < end.sequence',
    '!IsFinite(callback.realtimeSeconds)',
    '!CallbackMatchesStageEvidence(surface, callback)',
    'surface.sentinelReadback',
    'RequireNonDegenerateRaster(surface.sentinelRaster, CaptureWidth, CaptureHeight);',
    'surface.sentinelAndExactRgbDiffer',
    'surface.exactFrameRgb24Sha256',
    'internal static void RequireSnapFrameExactRasterBinding(',
    'string surfaceSha256 = RequireSha256(',
    'string decodedSha256 = RequireSha256(',
    'String.Equals(surfaceSha256, decodedSha256, StringComparison.Ordinal)',
    'readback.firstPartyTextureDistinctFromVendorFrameRenderTexture',
    'readback.vendorFrameRenderTextureDestroyRequested',
    'SnapFramePixelSource'
)) {
    if ($routePolicySource.IndexOf($routeContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The tested pure SnapFrame admission policy is missing '$routeContract'."
    }
}
if ($capturePolicyTestsSource.IndexOf('TestSnapFrameCaptureRoutePolicy();', [StringComparison]::Ordinal) -lt 0) {
    throw 'The SnapFrame route policy test is not invoked.'
}
foreach ($adversarialSnapFrameTest in @(
    'surface => surface.featureBaseActiveBefore = false',
    'surface => surface.featureTargetCameraInstanceIdBefore += 1',
    'surface => surface.knownActiveCaptureOverlayCount = 1',
    'canRenderThroughSceneCamera = true',
    'surface => surface.cleanViewStateVerifiedAtEveryCheckpoint = false',
    'surface => surface.graphicsDeviceType = null',
    'surface => surface.activeColorSpace = null',
    'surface => surface.readPixelsCoordinateOrigin = "upper_left"',
    'surface => surface.cpuRowTransform = "vertical_flip"',
    'surface => surface.universalCameraStackCount = 1',
    'surface => surface.frameRenderTextureBefore.depth = 1',
    'surface => surface.frameRenderTextureBeforeReadback.sRgb = true',
    'surface => surface.frameRenderTextureAfter.graphicsFormat = "B8G8R8A8_UNorm"',
    'surface => surface.frameRenderTextureAfter.sRgb = true',
    'surface => surface.frameRenderTextureAfterDirtyRequest.observationFrame = 99',
    'surface => surface.dirtyAfterRequest.dirty = false',
    'surface => surface.sentinelPoseReached = false',
    'surface => surface.sentinelPosition[0] =',
    'surface.exactPositionBefore[0] + 0.06',
    'surface => surface.exactPositionAfter[0] = Double.NaN',
    'surface => surface.callbackHistoryOverflowed = true',
    'surface.cameraCallbacks[0].callback = "end";',
    'surface.cameraCallbacks[1].callback = "begin";',
    'surface => surface.cameraCallbacks[0].realtimeSeconds = Double.NaN',
    'surface => surface.cameraCallbacks[0].position[0] = Double.NaN',
    'surface => surface.sentinelReadback.vendorFrameRenderTextureDestroyRequested = true',
    'degenerateSentinel.sentinelRaster.luminanceStandardDeviation = 0.0',
    'nonFiniteSentinel.sentinelRaster.nonBlackPixelFraction = Double.NaN',
    'surface => surface.sentinelAndExactRgbDiffer = false',
    'surface => surface.readback.firstPartyTextureDistinctFromVendorFrameRenderTexture = false',
    'CapturePolicy.RequireSnapFrameExactRasterBinding(boundSurface, boundRaster);',
    'CapturePolicy.RequireSnapFrameExactRasterBinding(null, boundRaster);',
    '"first_party_exact_vendor_render_target"'
)) {
    if ($capturePolicyTestsSource.IndexOf($adversarialSnapFrameTest, [StringComparison]::Ordinal) -lt 0) {
        throw "The adversarial SnapFrame matrix is missing '$adversarialSnapFrameTest'."
    }
}

function Get-ReceiptModelSection {
    param(
        [Parameter(Mandatory = $true)][string]$StartMarker,
        [Parameter(Mandatory = $true)][string]$EndMarker,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $start = $receiptModelsSource.IndexOf($StartMarker, [StringComparison]::Ordinal)
    $end = $receiptModelsSource.IndexOf($EndMarker, [StringComparison]::Ordinal)
    if ($start -lt 0 -or $end -le $start) {
        throw "Receipt v7 is missing the $Label model boundaries."
    }
    return $receiptModelsSource.Substring($start, $end - $start)
}

$snapFrameRenderReceiptSource = Get-ReceiptModelSection `
    -StartMarker 'internal sealed class SnapFrameRenderTextureObservationReceipt' `
    -EndMarker 'internal sealed class SnapFrameDirtyObservationReceipt' `
    -Label 'SnapFrame RenderTexture observation'
$snapFrameDirtyReceiptSource = Get-ReceiptModelSection `
    -StartMarker 'internal sealed class SnapFrameDirtyObservationReceipt' `
    -EndMarker 'internal sealed class SnapFrameReadbackReceipt' `
    -Label 'SnapFrame dirty observation'
$snapFrameReadbackReceiptSource = Get-ReceiptModelSection `
    -StartMarker 'internal sealed class SnapFrameReadbackReceipt' `
    -EndMarker 'internal sealed class SnapFrameCameraCallbackReceipt' `
    -Label 'SnapFrame readback'
$snapFrameCallbackReceiptSource = Get-ReceiptModelSection `
    -StartMarker 'internal sealed class SnapFrameCameraCallbackReceipt' `
    -EndMarker 'internal sealed class SnapFrameCanvasReceipt' `
    -Label 'SnapFrame camera callback'
$snapFrameCanvasReceiptSource = Get-ReceiptModelSection `
    -StartMarker 'internal sealed class SnapFrameCanvasReceipt' `
    -EndMarker 'internal sealed class UrpRendererFeatureReceipt' `
    -Label 'SnapFrame Canvas'
$urpRendererInventoryReceiptSource = Get-ReceiptModelSection `
    -StartMarker 'internal sealed class UrpRendererFeatureReceipt' `
    -EndMarker 'internal sealed class SnapFrameSurfaceReceipt' `
    -Label 'read-only URP renderer inventory'
$snapFrameSurfaceReceiptSource = Get-ReceiptModelSection `
    -StartMarker 'internal sealed class SnapFrameSurfaceReceipt' `
    -EndMarker 'internal sealed class CaptureAttemptReceipt' `
    -Label 'SnapFrame surface'
$attemptReceiptSource = Get-ReceiptModelSection `
    -StartMarker 'internal sealed class CaptureAttemptReceipt' `
    -EndMarker 'internal sealed class CaptureReceipt' `
    -Label 'capture attempt'
$captureReceiptSource = Get-ReceiptModelSection `
    -StartMarker 'internal sealed class CaptureReceipt' `
    -EndMarker 'internal sealed class HostReceipt' `
    -Label 'capture'

$receiptSectionContracts = @(
    @('SnapFrame RenderTexture observation', $snapFrameRenderReceiptSource, @(
        'public int observationFrame;', 'public int instanceId;', 'public bool isLive;',
        'public bool isCreated;', 'public int width;', 'public int height;', 'public int depth;',
        'public int antiAliasing;', 'public string colorFormat;', 'public string graphicsFormat;',
        'public bool sRgb;', 'public bool useMipMap;', 'public bool autoGenerateMips;')),
    @('SnapFrame dirty observation', $snapFrameDirtyReceiptSource, @(
        'public int observationFrame;', 'public bool dirty;')),
    @('SnapFrame readback', $snapFrameReadbackReceiptSource, @(
        'public bool renderTextureActiveWasNullBeforeReadback;',
        'public int renderTextureActiveBeforeReadbackInstanceId;',
        'public int renderTextureActiveBoundForReadbackInstanceId;',
        'public bool activeFrameRenderTextureVerifiedBeforeReadPixels;',
        'public bool firstPartyReadPixelsCompleted;', 'public bool firstPartyApplyCompleted;',
        'public bool renderTextureActiveWasNullAfterReadback;',
        'public int renderTextureActiveAfterReadbackInstanceId;',
        'public bool renderTextureActiveRestored;', 'public int firstPartyTextureInstanceId;',
        'public string firstPartyTextureFormat;', 'public bool firstPartyTextureReadable;',
        'public bool firstPartyTextureNoMipChain;',
        'public bool firstPartyTextureDistinctFromVendorFrameRenderTexture;',
        'public bool vendorFrameRenderTextureDestroyRequested;')),
    @('SnapFrame camera callback', $snapFrameCallbackReceiptSource, @(
        'public int sequence;', 'public string callback;', 'public string stage;', 'public int frame;',
        'public double realtimeSeconds;', 'public bool cameraMatchesExactSceneCamera;',
        'public bool targetTextureNull;', 'public bool poseMatchesStage;',
        'public bool projectionMatchesExactProfile;', 'public bool frameDirty;',
        'public int frameRenderTextureInstanceId;', 'public double[] position;',
        'public double[] rotationXyzw;', 'public double[] worldToCameraMatrixColumnMajor;',
        'public double[] projectionMatrixColumnMajor;')),
    @('SnapFrame Canvas', $snapFrameCanvasReceiptSource, @(
        'public int instanceId;', 'public string name;', 'public string renderMode;',
        'public int layer;', 'public string layerName;', 'public int worldCameraInstanceId;',
        'public bool worldCameraMatchesSceneCamera;', 'public bool layerIncludedBySceneCamera;',
        'public bool canRenderThroughSceneCamera;')),
    @('read-only URP renderer inventory', $urpRendererInventoryReceiptSource, @(
        'internal sealed class UrpRendererFeatureReceipt',
        'public int featureIndex;', 'public bool present;', 'public string name;',
        'public string typeFullName;', 'public int instanceId;', 'public bool active;',
        'public bool snapFrameCaptureFeatureType;',
        'public bool matchesSnapFrameStaticInstance;',
        'internal sealed class UrpRendererDataReceipt',
        'public int rendererDataIndex;', 'public bool useNativeRenderPass;',
        'public int featureCount;', 'public int snapFrameCaptureFeatureCount;',
        'public List<UrpRendererFeatureReceipt> features;',
        'internal sealed class UrpRendererInstanceReceipt',
        'public int rendererIndex;', 'public int runtimeIdentityHashCode;',
        'internal sealed class UrpRendererInventoryReceipt',
        'public string observationApi;', 'public int observationFrame;',
        'public double observationRealtimeSeconds;', 'public bool publicGettersOnly;',
        'public bool mutationApiInvoked;', 'public string[] prohibitedMutationApis;',
        'public bool currentRenderPipelineAssetPresent;',
        'public string currentRenderPipelineAssetName;',
        'public string currentRenderPipelineAssetTypeFullName;',
        'public int currentRenderPipelineAssetInstanceId;',
        'public bool currentRenderPipelineAssetIsUniversal;',
        'public bool universalAdditionalCameraDataPresent;',
        'public int rendererDataCount;', 'public int rendererInstanceCount;',
        'public bool rendererDataAndInstanceCountsMatch;',
        'public List<UrpRendererDataReceipt> rendererData;',
        'public List<UrpRendererInstanceReceipt> rendererInstances;',
        'public int activeSnapFrameCaptureFeatureCount;',
        'public bool snapFrameStaticInstancePresent;',
        'public int snapFrameStaticInstanceId;',
        'public string snapFrameStaticInstanceTypeFullName;',
        'public int snapFrameStaticInstanceMatchedConfiguredFeatureCount;',
        'public bool snapFrameStaticInstanceStableDuringSynchronousInventory;',
        'public bool sceneCameraRendererIndexInferred;',
        'public int sceneCameraRendererIndex;',
        'public string sceneCameraRendererIndexProvenance;',
        'public bool rendererObjectIdentityStableDuringSynchronousInventory;',
        'public bool rendererFeatureIdentityAndActiveStateStableDuringSynchronousInventory;',
        'public bool mutationObservedDuringSynchronousInventory;')),
    @('SnapFrame surface', $snapFrameSurfaceReceiptSource, @(
        'public bool featurePresent;', 'public string featureTypeFullName;',
        'public int featureInstanceId;', 'public bool featureStaticInstanceMatched;',
        'public bool featureBaseActiveBefore;', 'public bool featureBaseActiveAfter;',
        'public bool sceneCameraLive;', 'public int sceneCameraInstanceId;',
        'public bool featureTargetCameraLiveBefore;',
        'public int featureTargetCameraInstanceIdBefore;',
        'public bool featureTargetCameraLiveAtReadback;',
        'public int featureTargetCameraInstanceIdAtReadback;',
        'public bool featureTargetCameraLiveAfter;',
        'public int featureTargetCameraInstanceIdAfter;', 'public bool featureTargetUnchanged;',
        'public bool sceneCameraTargetTextureNullBefore;',
        'public bool sceneCameraTargetTextureNullAfterDirtyRequest;',
        'public bool sceneCameraTargetTextureNullBeforeReadback;',
        'public bool sceneCameraTargetTextureNullAfter;',
        'public bool captureViewAbsentBefore;', 'public bool captureViewAbsentAfterDirtyRequest;',
        'public bool captureViewAbsentBeforeReadback;', 'public bool captureViewAbsentAfter;',
        'public int knownActiveCaptureOverlayCount;',
        'public string[] knownActiveCaptureOverlayNames;',
        'public List<SnapFrameCanvasReceipt> activeCanvases;',
        'public bool unsafeRenderThroughCanvasObserved;',
        'public string graphicsDeviceType;', 'public bool graphicsUvStartsAtTop;',
        'public string activeColorSpace;', 'public string readPixelsCoordinateOrigin;',
        'public string cpuRowTransform;',
        'public int sceneCameraPixelWidth;', 'public int sceneCameraPixelHeight;',
        'public int screenWidth;', 'public int screenHeight;',
        'public int sceneCameraCullingMask;', 'public int sceneCameraCullingMaskAfter;',
        'public int sceneCameraTargetDisplay;', 'public int sceneCameraTargetDisplayAfter;',
        'public float[] sceneCameraRect;', 'public float[] sceneCameraRectAfter;',
        'public float[] sceneCameraPixelRect;', 'public float[] sceneCameraPixelRectAfter;',
        'public bool cameraConfigurationUnchanged;',
        'public bool cleanViewStateVerifiedAtEveryCheckpoint;',
        'public bool universalAdditionalCameraDataPresent;',
        'public string universalCameraRenderType;', 'public int universalCameraStackCount;',
        'public bool universalRenderPostProcessing;', 'public string frameSurfaceProvenance;',
        'public SnapFrameRenderTextureObservationReceipt frameRenderTextureBefore;',
        'public SnapFrameRenderTextureObservationReceipt frameRenderTextureAfterDirtyRequest;',
        'public SnapFrameRenderTextureObservationReceipt frameRenderTextureBeforeReadback;',
        'public SnapFrameRenderTextureObservationReceipt frameRenderTextureAfter;',
        'public SnapFrameDirtyObservationReceipt dirtyBeforeRequest;',
        'public SnapFrameDirtyObservationReceipt dirtyAfterRequest;',
        'public SnapFrameDirtyObservationReceipt dirtyBeforeReadback;',
        'public SnapFrameDirtyObservationReceipt dirtyAfterCompletion;',
        'public double[] exactPositionBefore;', 'public double[] exactRotationXyzwBefore;',
        'public double[] exactWorldToCameraMatrixColumnMajorBefore;',
        'public double[] exactProjectionMatrixColumnMajorBefore;',
        'public double[] sentinelPosition;', 'public double[] sentinelRotationXyzw;',
        'public double[] sentinelWorldToCameraMatrixColumnMajor;',
        'public double[] exactPositionAfter;', 'public double[] exactRotationXyzwAfter;',
        'public double[] exactWorldToCameraMatrixColumnMajorAfter;',
        'public double[] exactProjectionMatrixColumnMajorAfter;',
        'public bool sentinelPoseReached;',
        'public SnapFrameReadbackReceipt sentinelReadback;',
        'public RasterStatisticsReceipt sentinelRaster;',
        'public string exactFrameRgb24Sha256;', 'public bool sentinelAndExactRgbDiffer;',
        'public bool exactRestoreVerified;', 'public bool cameraCallbackSubscriptionRemoved;',
        'public int beginCameraRenderingCallbackCount;',
        'public int endCameraRenderingCallbackCount;', 'public bool callbackHistoryOverflowed;',
        'public bool everyCameraCallbackMatchedStagePose;',
        'public bool baselineExactEndCallbackVerified;',
        'public bool sentinelEndCallbackVerified;',
        'public bool restoredExactEndCallbackVerified;',
        'public bool stableExactEndCallbackVerified;',
        'public List<SnapFrameCameraCallbackReceipt> cameraCallbacks;',
        'public SnapFrameReadbackReceipt readback;')),
    @('capture attempt', $attemptReceiptSource, @(
        'public string status;', 'public int srpEndCameraRenderingCallbackCount;',
        'public int firstSrpEndCameraRenderingFrame;', 'public int lastSrpEndCameraRenderingFrame;',
        'public bool standardCameraRenderCallbackProofAvailable;',
        'public bool firstPartyReadPixelsCompleted;', 'public bool firstPartyApplyCompleted;',
        'public int firstPartyTextureInstanceId;', 'public string firstPartyTextureFormat;',
        'public bool firstPartyTextureReadable;', 'public bool firstPartyTextureNoMipChain;',
        'public SnapFrameSurfaceReceipt snapFrameSurface;', 'public string pixelSource;',
        'public string readbackTrigger;', 'public bool captureTaskCompletedBeforeDeadline;',
        'public bool captureTaskStopObserved;', 'public bool captureTaskTimeoutObserved;',
        'public bool underlyingCaptureCancellationAvailable;', 'public bool pixelReadCompleted;',
        'public RasterStatisticsReceipt raster;', 'public bool pngEncodingCompleted;',
        'public long encodedByteLength;', 'public string encodedSha256;',
        'public bool postWriteFileShaVerified;', 'public string failureType;',
        'public string failureMessage;'))
)
foreach ($receiptSectionContract in $receiptSectionContracts) {
    $label = [string]$receiptSectionContract[0]
    $source = [string]$receiptSectionContract[1]
    foreach ($requiredField in @($receiptSectionContract[2])) {
        if ($source.IndexOf([string]$requiredField, [StringComparison]::Ordinal) -lt 0) {
            throw "Receipt v7 $label evidence is missing '$requiredField'."
        }
    }
}
foreach ($obsoleteAttemptReceiptContract in @(
    'beforeRenderCallbackInvoked', 'afterRenderCallbackInvoked', 'renderProbeSubscriptionRemoved',
    'renderTargetInstanceId', 'activeExactTargetVerifiedBeforeReadPixels',
    'readbackReplacementDisposalRequestCount', 'callbackReadbackFailureType',
    'vendorReturnedTexturePresent', 'vendorReturnedTextureUsedForAdmission',
    'lateCaptureTaskObserverAttached', 'exactCameraRenderCallbackCount'
)) {
    if ($attemptReceiptSource.IndexOf($obsoleteAttemptReceiptContract, [StringComparison]::Ordinal) -ge 0) {
        throw "Receipt v7 retains obsolete exact-target/vendor-texture evidence '$obsoleteAttemptReceiptContract'."
    }
}
foreach ($rasterPolicyContract in @(
    'internal static RasterStatisticsReceipt AnalyzeRgb24(',
    'internal static void RequireNonDegenerateRaster(',
    'statistics.nonBlackPixelFraction < MinimumNonBlackPixelFraction',
    'statistics.maximumChannelDynamicRange < MinimumMaximumChannelDynamicRange',
    'statistics.distinctRgbLowerBound < MinimumDistinctRgbCount',
    '!IsFinite(statistics.nonBlackPixelFraction)',
    '!IsFinite(statistics.meanLuminance)',
    '!IsFinite(statistics.luminanceStandardDeviation)',
    'statistics.luminanceStandardDeviation < MinimumLuminanceStandardDeviation',
    'statistics.nonDegenerateVerified = true;'
)) {
    if ($capturePolicySource.IndexOf($rasterPolicyContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The decoded-raster admission policy is missing '$rasterPolicyContract'."
    }
}
foreach ($captureReceiptContract in @(
    'surface = "ISceneManager.SceneCamera through public LCCCore.SnapFrameCaptureFeature.FrameRT at AfterRenderingTransparents, exact-camera SRP callback handshake, first-party RGB24 ReadPixels, and Unity ImageConversion.EncodeToPNG"',
    'renderCallbackSurface = "RenderPipelineManager.beginCameraRendering and endCameraRendering for the exact SceneCamera at baseline, discarded sentinel, exact restore, and stable exact stages"',
    'uiComposited = false',
    'globalCameraCallbackRequiredForAdmission = true',
    'standardCameraRenderCallbackProofAvailable = false',
    'pipelineAssetType = pipelineAsset == null',
    'configuredPixelSource = CapturePolicy.SnapFramePixelSource',
    'observedPixelSource = null',
    'everyObservedPixelSourceMatchesConfigured = false',
    'UpdateCaptureReadbackAggregates(capture);',
    'capture.observedPixelSource = observedPixelSources.FirstOrDefault();',
    'capture.everyObservedPixelSourceMatchesConfigured =',
    'observedPixelSources.Length > 0 &&',
    'capture.configuredPixelSource,',
    'perCaptureTimeoutSemantics = "cooperative_cancelled_end_of_frame_handshake_with_exact_camera_finally_restore"',
    'perCaptureTimeoutCanPreemptBlockedUnityMainThread = false',
    'lateResultObserverCompletionAwaitedBeforeProcessExit = false',
    'hardTerminationBoundary = "external_operator_process_watchdog"',
    'capture.standardCameraRenderCallbackProofAvailable = capture.attempts.Any(',
    '_attempt.standardCameraRenderCallbackProofAvailable = true;',
    'blackChannelThreshold = CapturePolicy.BlackChannelThreshold',
    'minimumNonBlackPixelFraction = CapturePolicy.MinimumNonBlackPixelFraction',
    'minimumMaximumChannelDynamicRange = CapturePolicy.MinimumMaximumChannelDynamicRange',
    'minimumDistinctRgbCount = CapturePolicy.MinimumDistinctRgbCount',
    'minimumLuminanceStandardDeviation = CapturePolicy.MinimumLuminanceStandardDeviation',
    'everyAttemptDecodedAndNonDegenerate = false'
)) {
    if ($moduleSource.IndexOf($captureReceiptContract, [StringComparison]::Ordinal) -lt 0) {
        throw "Receipt v7 is missing public-SnapFrame capture-admission evidence '$captureReceiptContract'."
    }
}
foreach ($captureReceiptModelContract in @(
    'public string perCaptureTimeoutSemantics;',
    'public bool perCaptureTimeoutCanPreemptBlockedUnityMainThread;',
    'public bool lateResultObserverCompletionAwaitedBeforeProcessExit;',
    'public string hardTerminationBoundary;',
    'public bool globalCameraCallbackRequiredForAdmission;',
    'public bool standardCameraRenderCallbackProofAvailable;',
    'public string pipelineAssetType;',
    'public string configuredPixelSource;',
    'public string observedPixelSource;',
    'public bool everyObservedPixelSourceMatchesConfigured;',
    'public UrpRendererInventoryReceipt urpRendererInventory;'
)) {
    if ($captureReceiptSource.IndexOf($captureReceiptModelContract, [StringComparison]::Ordinal) -lt 0) {
        throw "Receipt v7 is missing capture-level SnapFrame evidence '$captureReceiptModelContract'."
    }
}
if ($moduleSource.IndexOf('globalCameraCallbackRequiredForAdmission = false', [StringComparison]::Ordinal) -ge 0) {
    throw 'Receipt v7 must require exact-camera global begin/end callback evidence for admission.'
}
$updateReadbackAggregatesStart = $moduleSource.IndexOf(
    'private static void UpdateCaptureReadbackAggregates(CaptureReceipt capture)',
    [StringComparison]::Ordinal)
if ($updateReadbackAggregatesStart -lt 0 -or
    $moduleSource.IndexOf(
        'private async UniTask<Texture2D> CaptureTextureWithTimeout(',
        [StringComparison]::Ordinal) -le $updateReadbackAggregatesStart) {
    throw 'The capture-level readback-provenance aggregator boundaries are missing.'
}
$updateReadbackAggregatesSource = $moduleSource.Substring(
    $updateReadbackAggregatesStart,
    $captureTimeoutIndex - $updateReadbackAggregatesStart)
foreach ($readbackAggregateContract in @(
    'capture.attempts',
    '.Where(candidate => !String.IsNullOrEmpty(candidate.pixelSource))',
    '.Select(candidate => candidate.pixelSource)',
    'capture.observedPixelSource = observedPixelSources.FirstOrDefault();',
    'capture.everyObservedPixelSourceMatchesConfigured =',
    'observedPixelSources.Length > 0 &&',
    'observedPixelSources.All(candidate => String.Equals(',
    'capture.configuredPixelSource,',
    'StringComparison.Ordinal));'
)) {
    if ($updateReadbackAggregatesSource.IndexOf($readbackAggregateContract, [StringComparison]::Ordinal) -lt 0) {
        throw "The capture-level pixel-source aggregator is missing '$readbackAggregateContract'."
    }
}
if (@([Regex]::Matches(
        $convergenceSource,
        [Regex]::Escape('UpdateCaptureReadbackAggregates(capture);'))).Count -lt 2) {
    throw 'Pixel-source/callback aggregates must be recomputed after both rejected and non-rejected attempts.'
}

$operatorTokens = $null
$operatorParseErrors = $null
$operatorAst = [Management.Automation.Language.Parser]::ParseFile(
    $operatorPath,
    [ref]$operatorTokens,
    [ref]$operatorParseErrors)
if ($null -eq $operatorAst -or $operatorParseErrors.Count -ne 0) {
    $details = ($operatorParseErrors | ForEach-Object { $_.Message }) -join '; '
    throw "The operator watchdog script does not parse cleanly: $details"
}
$operatorSource = Get-Content -LiteralPath $operatorPath -Raw
foreach ($operatorContract in @(
    '\$hardTimeoutSeconds = 900',
    '\$captureProcess = Start-Process',
    '\$captureProcess\.WaitForExit\(\$hardTimeoutSeconds \* 1000\)',
    'Stop-CaptureProcessTree -Process \$captureProcess',
    "'System32\\taskkill.exe'",
    "'/T'",
    "'/F'",
    'grand-hall-native-capture-operator-receipt\.json',
    '\[IO\.File\]::Move\(\$temporaryPath, \$finalPath\)',
    '\$priorEnvironment\[\$name\]',
    '\$expectedOriginalFeatureToggleSha256 = ''8FF16CAC30F3F49A71BE9A06D486B1BB9B682E0CCF1C5C35869A251D98313531''',
    'XGrids\.LCCWorld\.Common\.Utils\.EncryptUtil',
    'Write-DurableNewFile -Path \$featureToggleBackupPath',
    '\[IO\.File\]::Replace\(\$temporaryPath, \$Path, \$displacedPath\)',
    'Assert-OnlyNativeCaptureToggleAdded',
    'Assert-NoLccEditorProcess',
    'function Restore-FeatureToggleLease',
    'Restore-FeatureToggleLease -Evidence \$featureToggleLeaseEvidence',
    'Set-ExactFileMetadata -Path \$featureTogglePath',
    'restoredMetadataExact',
    'preRestoreTargetMatchedLease',
    'secondOwnedTerminationAttemptedBeforeRestore',
    'noLccEditorProcessBeforeRestore',
    'remainingLccEditorProcessIdsBeforeRestore',
    'restorationDeferredForLiveEditor',
    'stockModuleEntriesUnchanged',
    'featureToggleLease = \$FeatureToggleLeaseEvidence',
    'VENVIEWER_LCC_NATIVE_CAPTURE_CAMERA_PROFILE_SHA256'
)) {
    if ($operatorSource -notmatch $operatorContract) {
        throw "The bounded operator watchdog is missing required evidence '$operatorContract'."
    }
}
if ($operatorSource -match '-ArgumentList\s+@\(\$scene' -or
    $operatorSource -notmatch "-ArgumentList\s+@\('-screen-width'") {
    throw 'The operator must not rely on an ignored positional scene argument.'
}
$metadataCaptureIndex = $operatorSource.IndexOf(
    '$originalMetadata = Get-FileMetadataReceipt -Path $featureTogglePath',
    [StringComparison]::Ordinal)
$originalByteReadIndex = $operatorSource.IndexOf(
    '$originalBytes = [IO.File]::ReadAllBytes($featureTogglePath)',
    [StringComparison]::Ordinal)
if ($metadataCaptureIndex -lt 0 -or $originalByteReadIndex -lt 0 -or
    $metadataCaptureIndex -gt $originalByteReadIndex -or
    $operatorSource -notmatch '638900000000000000' -or
    $operatorSource -notmatch '638800000000000000') {
    throw 'Feature-toggle metadata must be captured before the first byte read and tested with distinct last-write/last-access timestamps.'
}
& $operatorPath -LeaseSelfTest
if (-not $?) {
    throw 'The crash-recoverable feature-toggle lease self-test failed.'
}
$processDisposeIndex = $operatorSource.LastIndexOf('$captureProcess.Dispose()', [StringComparison]::Ordinal)
$featureRestoreIndex = $operatorSource.LastIndexOf(
    'Restore-FeatureToggleLease -Evidence $featureToggleLeaseEvidence',
    [StringComparison]::Ordinal)
if ($processDisposeIndex -lt 0 -or $featureRestoreIndex -lt 0 -or $processDisposeIndex -gt $featureRestoreIndex) {
    throw 'Exact per-user feature-toggle restoration must occur after child-process termination/disposal.'
}
$zeroEditorGateIndex = $operatorSource.LastIndexOf(
    'if ($allEditorsBeforeRestore.Count -eq 0)',
    [StringComparison]::Ordinal)
$deferredRestoreIndex = $operatorSource.LastIndexOf(
    '$featureToggleLeaseEvidence.restorationDeferredForLiveEditor = $true',
    [StringComparison]::Ordinal)
if ($zeroEditorGateIndex -lt 0 -or $featureRestoreIndex -lt $zeroEditorGateIndex -or
    $deferredRestoreIndex -lt $featureRestoreIndex) {
    throw 'Feature-toggle restoration is not gated on zero owned or unexpected LCCEditor processes.'
}
$restoreFunctionIndex = $operatorSource.IndexOf(
    'function Restore-FeatureToggleLease',
    [StringComparison]::Ordinal)
$restoreFunctionEndIndex = $operatorSource.IndexOf(
    'function Repair-StaleFeatureToggleLease',
    [StringComparison]::Ordinal)
$restoreFunctionSource = $operatorSource.Substring(
    $restoreFunctionIndex,
    $restoreFunctionEndIndex - $restoreFunctionIndex)
if (@([regex]::Matches($restoreFunctionSource, 'Assert-NoLccEditorProcess')).Count -lt 2) {
    throw 'The restoration primitive must gate both its evidence read and atomic replacement on zero LCCEditor processes.'
}
if ($operatorSource -match 'com\.xgrids\.' -or
    $operatorSource -match '(Stop-Service|Start-Service|sc\.exe|CodeMeter\.exe|CodeMeterCC)') {
    throw 'The operator must not target stock module IDs, vendor services, or CodeMeter.'
}
if ($operatorSource -notmatch '-WindowStyle Hidden' -or
    $operatorSource -notmatch 'processTreeTerminationSucceeded') {
    throw 'The operator watchdog does not enforce hidden launch and process-tree termination accounting.'
}
foreach ($operatorEvidenceContract in @(
    'venviewer\.grand-hall\.lcc-native-capture-build-receipt\.v1',
    'buildReceiptSha256',
    'moduleSha256',
    'pluginManifestSha256',
    'runtimeClosureLockSha256',
    'runtimeClosureInventorySha256',
    'cameraProfileSha256',
    'liveCanonicalPackageVerified',
    'runtimeClosureVerified',
    'vendorBinariesCopiedIntoRepository',
    '\$actualSidecar -cne \$expectedSidecar'
)) {
    if ($operatorSource -notmatch $operatorEvidenceContract) {
        throw "The operator receipt/build gate is missing evidence '$operatorEvidenceContract'."
    }
}

$vendorLock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
Assert-Equal 'venviewer.grand-hall.lcc-native-vendor-lock.v2' ([string]$vendorLock.schemaVersion) 'vendor lock schema'
Assert-Equal $expectedCompilerPath ([IO.Path]::GetFullPath([string]$vendorLock.compiler.absolutePath)) 'vendor-lock compiler path'
Assert-Equal 59672 ([long]$vendorLock.compiler.byteLength) 'vendor-lock compiler byte length'
Assert-Equal $expectedCompilerVersion ([string]$vendorLock.compiler.fileVersion) 'vendor-lock compiler version'
Assert-Equal $expectedCompilerSha256 ([string]$vendorLock.compiler.sha256) 'vendor-lock compiler SHA-256'
$vendorHashes = @{}
foreach ($file in $vendorLock.files) {
    $vendorHashes[[string]$file.sha256] = [string]$file.relativePath
}
foreach ($lockedReference in $lockedSnapFrameReferences) {
    $name = [string]$lockedReference[0]
    $sha256 = [string]$lockedReference[1]
    $relativePath = 'LCCEditor_Data/Managed/' + $name
    $matches = @($vendorLock.files | Where-Object {
        [string]$_.relativePath -ceq $relativePath
    })
    if ($matches.Count -ne 1) {
        throw "The vendor lock must contain exactly one public SnapFrame dependency entry for $relativePath."
    }
    Assert-Equal 'compile_and_runtime' ([string]$matches[0].role) "vendor-lock role $relativePath"
    Assert-Equal $sha256 ([string]$matches[0].sha256) "vendor-lock SHA-256 $relativePath"
    $installedReferencePath = Join-Path $LccEditorRoot ($relativePath -replace '/', '\')
    if (-not (Test-Path -LiteralPath $installedReferencePath -PathType Leaf)) {
        throw "The locked public SnapFrame dependency is missing from the installed editor: $installedReferencePath"
    }
    Assert-Equal ([long]$matches[0].byteLength) ([long](Get-Item -LiteralPath $installedReferencePath).Length) "installed byte length $relativePath"
    Assert-Equal $sha256 ((Get-FileHash -LiteralPath $installedReferencePath -Algorithm SHA256).Hash) "installed SHA-256 $relativePath"
}
$firstPartyBinaries = Get-ChildItem -LiteralPath $PSScriptRoot -File -Recurse |
    Where-Object { $_.Extension -in @('.dll', '.exe') }
foreach ($binary in $firstPartyBinaries) {
    $hash = (Get-FileHash -LiteralPath $binary.FullName -Algorithm SHA256).Hash
    if ($vendorHashes.ContainsKey($hash)) {
        throw "Vendor binary '$($vendorHashes[$hash])' was copied into the first-party folder as '$($binary.FullName)'."
    }
}

$ildasmCandidates = @(
    'C:\Program Files (x86)\Microsoft SDKs\Windows\v10.0A\bin\NETFX 4.8 Tools\ildasm.exe',
    'C:\Program Files (x86)\Microsoft SDKs\Windows\v10.0A\bin\NETFX 4.8.1 Tools\ildasm.exe'
)
$ildasm = $ildasmCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $ildasm) {
    throw 'ildasm.exe is required for offline interface verification and was not found.'
}

$il = (& $ildasm /text /nobar $ModulePath | Out-String)
if ($LASTEXITCODE -ne 0) {
    throw "ildasm failed with exit code $LASTEXITCODE."
}
foreach ($requiredIlPattern in @(
    'implements \[LCCWorld\]XGrids\.LCCWorld\.Framework\.IModule',
    'NativeCaptureModule::Init',
    'NativeCaptureModule::Execute',
    'NativeCaptureModule::HandleModulesLoaded',
    'NativeCaptureModule::ScheduleExecuteAfterModulesLoadedAsync',
    'NativeCaptureModule::Stop',
    'NativeCaptureModule::Dispose',
    'NativeCaptureModule::HandleSceneLoadBegin',
    'NativeCaptureModule::UnsubscribeSceneLoadBegin',
    'NativeCaptureModule::UnsubscribeSceneLoaded',
    'NativeCaptureModule::StartCaptureAfterSceneEventDispatchAsync',
    'NativeCaptureModule::PopulateCaptureAttemptAsync',
    'NativeCaptureModule::CaptureTextureWithTimeout',
    'NativeCaptureModule::ThrowIfStopped',
    'SnapFrameReadbackOperation::CaptureAsync',
    'SnapFrameReadbackOperation::Abort',
    'SnapFrameReadbackOperation::Dispose',
    'SnapFrameReadbackOperation::CaptureReadOnlyUrpRendererInventory',
    'SnapFrameReadbackOperation::Subscribe',
    'SnapFrameReadbackOperation::Unsubscribe',
    'SnapFrameReadbackOperation::ObserveAndRequireFrameRenderTexture',
    'SnapFrameReadbackOperation::ReadFrameRenderTexture',
    'CapturePolicy::RequireSnapFrameCaptureRoute',
    'CapturePolicy::RequireSnapFrameExactRasterBinding',
    'CapturePolicy::RequireNonDegenerateRaster',
    'CapturePolicy::RequireReadOnlyUrpRendererInventory',
    'InterlockedOneShotGate::TryEnter',
    'NativeCaptureLifecycleState::TryScheduleModulesLoaded',
    'NativeCaptureLifecycleState::TryMarkNextFrameExecutionReady',
    'NativeCaptureLifecycleState::TryEnterExecution',
    'NativeCaptureLifecycleState::Stop',
    'Interlocked::CompareExchange',
    'SnapFrameCaptureFeature::get_Instance',
    'SnapFrameCaptureFeature::get_TargetCamera',
    'SnapFrameCaptureFeature::get_FrameRT',
    'SnapFrameCaptureFeature::get_FrameDirty',
    'ScriptableRendererFeature::get_isActive',
    'GraphicsSettings::get_currentRenderPipeline',
    'UniversalRenderPipelineAsset::get_rendererDataList',
    'UniversalRenderPipelineAsset::get_renderers',
    'ScriptableRendererData::get_rendererFeatures',
    'ScriptableRendererData::get_useNativeRenderPass',
    'RuntimeHelpers::GetHashCode',
    'Texture2D::\.ctor',
    'Texture2D::ReadPixels',
    'Texture2D::Apply',
    'Texture2D::GetPixels32',
    'RenderTexture::get_active',
    'RenderTexture::set_active',
    'RenderTexture::IsCreated',
    'RenderTexture::get_format',
    'RenderTexture::get_graphicsFormat',
    'RenderTexture::get_sRGB',
    'RenderTexture::get_useMipMap',
    'RenderTexture::get_autoGenerateMips',
    'Camera::get_targetTexture',
    'ImageConversion::EncodeToPNG',
    'RenderPipelineManager::add_beginCameraRendering',
    'RenderPipelineManager::remove_beginCameraRendering',
    'RenderPipelineManager::add_endCameraRendering',
    'RenderPipelineManager::remove_endCameraRendering',
    'UniversalAdditionalCameraData::get_renderType',
    'UniversalAdditionalCameraData::get_cameraStack',
    'UniversalAdditionalCameraData::get_renderPostProcessing',
    'Resources::FindObjectsOfTypeAll',
    'Canvas::get_worldCamera',
    'Canvas::get_renderMode',
    'SystemInfo::get_graphicsDeviceType',
    'SystemInfo::get_graphicsUVStartsAtTop',
    'QualitySettings::get_activeColorSpace',
    'System\.Single::IsNaN',
    'System\.Single::IsInfinity',
    'UnityEngine\.Object::Destroy',
    'IProjectManager::CreateTemporaryLCCProject',
    'IProjectManager::get_IsInitialized',
    'IProjectManager::get_IsTemporary',
    'IProjectManager::GetAssetFinalPath',
    'ISceneManager::LoadDefaultScene',
    'SceneData::TryGetLCCAsset',
    'ILCCSceneManager::GetRendererHandlerByPath',
    'ILCCSceneManager::IsSceneLoaded',
    'LCCRendererHandler::get_Path',
    'ILCCSceneManager::LCCObjectToWorldSpace',
    'ILCCSceneManager::SetRecordMode',
    'ILCCSceneManager::SetFOV',
    'ICameraService::SetTransform',
    'IRendererQualityService::SetRenderQualityType',
    'IRendererQualityService::SupportFullRender',
    'IRendererQualitySceneManager::SetRenderAll',
    'IRendererQualitySceneManager::IsRenderAll',
    'ILCCSceneManager::SetEnvironmentData',
    'FixedCameraProfile::Load',
    'UniTask::WhenAny',
    'lccscene\.load\.begin',
    'lccscene\.loaded',
    'modules\.loaded'
)) {
    if ($il -notmatch $requiredIlPattern) {
        throw "The compiled module is missing required IL evidence '$requiredIlPattern'."
    }
}
if ($il -match 'ILCCSceneManager::LoadScene') {
    throw 'The compiled module still calls the low-level ILCCSceneManager.LoadScene API.'
}
foreach ($forbiddenIlPattern in @(
    'ICaptureManager::CaptureToFileAsync',
    'ICaptureManager::CaptureToTextureAsync',
    'SnapFrameCaptureFeature::set_TargetCamera',
    'SnapFrameCaptureFeature::set_FrameRT',
    'ScriptableRendererFeature::SetActive',
    'UniversalAdditionalCameraData::get_scriptableRenderer',
    'UniversalRenderPipelineAsset::get_scriptableRenderer',
    'UniversalRenderPipelineAsset::GetRenderer',
    'UniversalAdditionalCameraData::SetRenderer',
    'ScriptableRendererData::SetDirty',
    'ScriptableRendererFeature::Create',
    'ScriptableRendererFeature::Dispose',
    'ScriptableRenderer::Dispose',
    'GraphicsSettings::set_',
    'QualitySettings::set_renderPipeline',
    'Camera::set_targetTexture',
    'RenderTexture::Release'
)) {
    if ($il -match $forbiddenIlPattern) {
        throw "The compiled module contains a forbidden capture-surface mutation or obsolete API call '$forbiddenIlPattern'."
    }
}
foreach ($forbiddenAssembly in @('System.Net.Http', 'NetMQ', 'MCPForUnity')) {
    if ($il -match "\.assembly extern '$([Regex]::Escape($forbiddenAssembly))'|\.assembly extern $([Regex]::Escape($forbiddenAssembly))") {
        throw "The compiled module unexpectedly references $forbiddenAssembly."
    }
}

Write-Output 'PASS: plugin contract'
Write-Output 'PASS: canonical GH_1 LCC2 manifest and 60-file policy receipt'
Write-Output 'PASS: digest-bound fixed-camera profile and exact Three tuple'
Write-Output 'PASS: priority load-begin/default-scene/active-render-all fail-closed contract'
Write-Output 'PASS: modules.loaded next-frame one-shot lifecycle/cleanup contract'
Write-Output 'PASS: terminal Stop/internal scene-unsubscribe/cooperative async-stop contract'
Write-Output 'PASS: reversible per-user native-module toggle lease static contract'
Write-Output 'PASS: no vendor binary copied into the first-party folder'
Write-Output 'PASS: no network API or unfinished-code source pattern'
Write-Output 'PASS: retained-attempt decoded-raster/public-SnapFrame/four-EOF capture contract'
Write-Output 'PASS: compiled public IModule/camera/LCC/SnapFrame/URP readback API calls'
Write-Output "PASS: bounded runtime closure $($runtimeClosure.memberCount) files / $($runtimeClosure.totalByteLength) bytes"
Write-Output "Module SHA-256: $actualModuleSha256"
Write-Output "Plugin SHA-256: $actualPluginSha256"
