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
$testRoot = Join-Path $PSScriptRoot 'tests'
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
    'src\DeterministicPng.cs',
    'src\DisplayEncodingPolicy.cs',
    'src\FixedCameraProfile.cs',
    'src\NativeCaptureModule.cs',
    'src\ReceiptModels.cs',
    'src\RuntimeClosurePolicy.cs',
    'tests\CapturePolicyTests.cs',
    'tests\DisplayEncodingTests.cs',
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

function Assert-ContainsLiteral {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Needle,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if ($Text.IndexOf($Needle, [StringComparison]::Ordinal) -lt 0) {
        throw "$Label is missing '$Needle'."
    }
}

function Assert-NotMatch {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if ($Text -match $Pattern) {
        throw "$Label contains forbidden pattern '$Pattern'."
    }
}

function Get-SourceRegion {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$StartMarker,
        [Parameter(Mandatory = $true)][string]$EndMarker,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $start = $Text.IndexOf($StartMarker, [StringComparison]::Ordinal)
    $end = if ($start -lt 0) {
        -1
    }
    else {
        $Text.IndexOf(
            $EndMarker,
            $start + $StartMarker.Length,
            [StringComparison]::Ordinal)
    }
    if ($start -lt 0 -or $end -le $start) {
        throw "$Label boundaries are missing."
    }
    return $Text.Substring($start, $end - $start)
}

foreach ($requiredPath in @(
    $ModulePath,
    $BuildReceiptPath,
    $pluginPath,
    $lockPath,
    $operatorPath,
    $cameraProfilePath,
    $canonicalManifestPath,
    $featureTogglePath
)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required offline-verification file is missing: $requiredPath"
    }
}

$plugin = Get-Content -LiteralPath $pluginPath -Raw | ConvertFrom-Json
Assert-Equal 'com.venviewer.native_capture' ([string]$plugin.Id) 'plugin Id'
Assert-Equal '1.7.0' ([string]$plugin.Version) 'plugin version'
Assert-Equal 'managed' ([string]$plugin.Type) 'plugin type'
Assert-Equal 'VenviewerNativeCapture.dll' ([string]$plugin.EntryPoint) 'plugin entry point'
Assert-Equal 'Venviewer.NativeCapture.NativeCaptureModule' ([string]$plugin.Class) 'plugin class'
Assert-Equal $true ([bool]$plugin.Enabled) 'plugin enabled flag'
Assert-Equal 0 ([int]$plugin.Dependencies.Count) 'plugin dependency count'
Assert-ContainsLiteral ([string]$plugin.Description) 'SingleCameraRequest' 'plugin description'

$buildReceipt = Get-Content -LiteralPath $BuildReceiptPath -Raw | ConvertFrom-Json
Assert-Equal 'venviewer.grand-hall.lcc-native-capture-build-receipt.v1' ([string]$buildReceipt.schemaVersion) 'build receipt schema'
Assert-Equal $true ([bool]$buildReceipt.tests.liveCanonicalPackageVerified) 'live canonical package verification'
Assert-Equal $true ([bool]$buildReceipt.tests.runtimeClosureVerified) 'runtime closure test result'
Assert-Equal $true ([bool]$buildReceipt.tests.displayEncodingTestsPassed) 'display encoding test result'
Assert-Equal $true ([bool]$buildReceipt.tests.playerLogAuditSelfTestPassed) 'Player.log audit self-test result'
Assert-Equal $true ([bool]$buildReceipt.tests.passed) 'policy test result'
Assert-Equal $false ([bool]$buildReceipt.networkUsed) 'network-used flag'
Assert-Equal $false ([bool]$buildReceipt.vendorBinariesCopiedIntoRepository) 'vendor-copy flag'

$actualModuleSha256 = (Get-FileHash -LiteralPath $ModulePath -Algorithm SHA256).Hash
$actualPluginSha256 = (Get-FileHash -LiteralPath $pluginPath -Algorithm SHA256).Hash
Assert-Equal ([string]$buildReceipt.module.sha256) $actualModuleSha256 'built module SHA-256'
Assert-Equal ([string]$buildReceipt.pluginManifest.sha256) $actualPluginSha256 'plugin SHA-256'
Assert-Equal $cameraProfileSha256 ([string]$buildReceipt.cameraProfile.sha256) 'camera profile receipt SHA-256'
Assert-Equal $cameraProfileSha256 ((Get-FileHash -LiteralPath $cameraProfilePath -Algorithm SHA256).Hash) 'camera profile source SHA-256'
Assert-Equal $cameraProfileSha256 ((Get-FileHash -LiteralPath ([string]$buildReceipt.cameraProfile.path) -Algorithm SHA256).Hash) 'camera profile output SHA-256'

$compilerPath = [string]$buildReceipt.compiler.path
if (-not (Test-Path -LiteralPath $compilerPath -PathType Leaf)) {
    throw "The receipt compiler no longer exists: $compilerPath"
}
Assert-Equal $expectedCompilerPath ([IO.Path]::GetFullPath($compilerPath)) 'locked compiler path'
Assert-Equal $expectedCompilerSha256 ([string]$buildReceipt.compiler.sha256) 'locked compiler receipt SHA-256'
Assert-Equal $expectedCompilerVersion ([string]$buildReceipt.compiler.fileVersion) 'locked compiler receipt version'
Assert-Equal $expectedCompilerSha256 ((Get-FileHash -LiteralPath $compilerPath -Algorithm SHA256).Hash) 'compiler SHA-256'
Assert-Equal $expectedCompilerVersion ((Get-Item -LiteralPath $compilerPath).VersionInfo.FileVersion) 'compiler file version'

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
$buildScriptSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'build.ps1') -Raw
Assert-ContainsLiteral $buildScriptSource `
    "`$pendingBuildReceiptPath = Join-Path `$outputRoot 'build-receipt.json.pending'" `
    'pending build-receipt path'
Assert-ContainsLiteral $buildScriptSource `
    '[IO.File]::Move($pendingBuildReceiptPath, $buildReceiptPath)' `
    'verified build-receipt publication'
Assert-ContainsLiteral $buildScriptSource `
    'Remove-Item -LiteralPath $pendingBuildReceiptPath -Force' `
    'failed pending build-receipt cleanup'

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
Assert-Equal 10 ([int]$runtimeClosure.enabledStockModuleIds.Count) 'enabled stock module count'
Assert-Equal ([int]$runtimeClosure.enabledStockModuleIds.Count) ([int]$runtimeClosure.enabledStockModuleRoots.Count) 'enabled stock module root count'
$closurePaths = @($runtimeClosure.members | ForEach-Object { [string]$_.relativePath })
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

Assert-Equal $canonicalManifestSha256 ((Get-FileHash -LiteralPath $canonicalManifestPath -Algorithm SHA256).Hash) 'canonical GH_1 LCC2 manifest SHA-256'
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
if ($cameraProfileRaw -notmatch '"target"\s*:\s*\[\s*0\.15796363067625974\s*,\s*2\.15606153541565\s*,\s*-0\.19184415815737577\s*\]') {
    throw 'The camera profile does not contain the exact browser-authority Three target tuple.'
}

Assert-Equal $featureToggleSha256 ((Get-FileHash -LiteralPath $featureTogglePath -Algorithm SHA256).Hash) 'reviewed original per-user feature-toggle SHA-256'
$encryptUtilAssembly = Join-Path $LccEditorRoot 'LCCEditor_Data\Managed\LCCWorld.Common.dll'
$encryptUtilType = [Reflection.Assembly]::LoadFrom($encryptUtilAssembly).GetType(
    'XGrids.LCCWorld.Common.Utils.EncryptUtil',
    $true)
$decryptMethod = $encryptUtilType.GetMethod('DecryptFromHex', [Reflection.BindingFlags]'Public,Static')
if ($null -eq $decryptMethod) {
    throw 'The installed public EncryptUtil decrypt contract is unavailable.'
}
$decryptArguments = [object[]]::new(2)
$decryptArguments[0] = [string](Get-Content -LiteralPath $featureTogglePath -Raw)
$decryptArguments[1] = [string]'xgrids'
$toggleConfig = ([string]$decryptMethod.Invoke($null, $decryptArguments)) | ConvertFrom-Json
Assert-Equal 0 (@($toggleConfig.toggles | Where-Object {
    [string]$_.module_id -ceq 'com.venviewer.native_capture'
}).Count) 'reviewed original native-capture toggle count'

$moduleSourcePath = Join-Path $sourceRoot 'NativeCaptureModule.cs'
$capturePolicyPath = Join-Path $sourceRoot 'CapturePolicy.cs'
$deterministicPngPath = Join-Path $sourceRoot 'DeterministicPng.cs'
$displayEncodingPolicyPath = Join-Path $sourceRoot 'DisplayEncodingPolicy.cs'
$receiptModelsPath = Join-Path $sourceRoot 'ReceiptModels.cs'
$capturePolicyTestsPath = Join-Path $testRoot 'CapturePolicyTests.cs'
$displayEncodingTestsPath = Join-Path $testRoot 'DisplayEncodingTests.cs'
$moduleSource = Get-Content -LiteralPath $moduleSourcePath -Raw
$capturePolicySource = Get-Content -LiteralPath $capturePolicyPath -Raw
$deterministicPngSource = Get-Content -LiteralPath $deterministicPngPath -Raw
$displayEncodingPolicySource = Get-Content -LiteralPath $displayEncodingPolicyPath -Raw
$receiptModelsSource = Get-Content -LiteralPath $receiptModelsPath -Raw
$capturePolicyTestsSource = Get-Content -LiteralPath $capturePolicyTestsPath -Raw
$displayEncodingTestsSource = Get-Content -LiteralPath $displayEncodingTestsPath -Raw

$sourceFiles = Get-ChildItem -LiteralPath $sourceRoot -Filter '*.cs' -File
foreach ($pattern in @(
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
)) {
    $matches = $sourceFiles | Select-String -Pattern $pattern -CaseSensitive
    if ($matches) {
        throw "Forbidden source pattern '$pattern' was found: $($matches.Path):$($matches.LineNumber)"
    }
}

Assert-ContainsLiteral $moduleSource 'private const string ModuleVersion = "1.7.0";' 'module source'
Assert-ContainsLiteral $moduleSource 'schemaVersion = "venviewer.grand-hall.lcc-native-capture-receipt.v14",' 'native receipt construction'
Assert-ContainsLiteral $capturePolicySource 'RequireTreeWithoutReparsePoints(root, "canonical Grand Hall package tree")' 'canonical package snapshot'
foreach ($lifecycleContract in @(
    'class NativeCaptureLifecycleState',
    'TryScheduleModulesLoaded()',
    'TryMarkNextFrameExecutionReady()',
    'LifecycleExecutionDecision TryEnterExecution()',
    'Interlocked.Exchange(ref _stopped, 1);',
    '"modules.loaded"',
    '"lccscene.load.begin"',
    '"lccscene.loaded"',
    'CreateTemporaryLCCProject(',
    'LoadDefaultScene()',
    'SetRenderAll(true)',
    'SetEnvironmentData(false)'
)) {
    Assert-ContainsLiteral ($capturePolicySource + $moduleSource) $lifecycleContract 'lifecycle and scene-load contract'
}
Assert-NotMatch $moduleSource 'ILCCSceneManager\.LoadScene\s*\(' 'module source'

$productionRouteSource = Get-SourceRegion -Text $moduleSource -StartMarker 'private async UniTask CaptureUntilConverged(' -EndMarker 'private async UniTask<Texture2D> CaptureTextureWithTimeout(' -Label 'production capture route'
$singleRequestOperationSource = Get-SourceRegion -Text $moduleSource -StartMarker 'private sealed class SingleCameraRenderRequestOperation : IDisposable' -EndMarker 'private sealed class SnapFrameReadbackOperation : IDisposable' -Label 'SingleCameraRenderRequest operation'
$targetRestoreSource = Get-SourceRegion -Text $singleRequestOperationSource -StartMarker 'private void RestoreOriginalCameraTargetTexture()' -EndMarker 'private void RestoreRenderTextureActive()' -Label 'camera-target restoration method'
$readOnlyInventorySource = Get-SourceRegion -Text $moduleSource -StartMarker 'internal static UrpRendererInventoryReceipt CaptureReadOnlyUrpRendererInventory(' -EndMarker 'private void CaptureFinalSurfaceState()' -Label 'read-only renderer inventory'
$captureAsyncSource = Get-SourceRegion -Text $singleRequestOperationSource -StartMarker 'internal async UniTask<Texture2D> CaptureAsync()' -EndMarker 'internal void Abort()' -Label 'SingleCameraRenderRequest capture sequence'
$capabilityPreflightSource = Get-SourceRegion -Text $singleRequestOperationSource -StartMarker 'private void EstablishLockedRenderPipelineBoundary()' -EndMarker 'private SingleCameraRenderRequestInvocationReceipt ExecuteRequest(' -Label 'capability preflight'
$perRequestSource = Get-SourceRegion -Text $singleRequestOperationSource -StartMarker 'private SingleCameraRenderRequestInvocationReceipt ExecuteRequest(' -EndMarker 'private Texture2D ReadOwnedRenderTexture(' -Label 'per-request render submission'
$callbackObserverSource = Get-SourceRegion -Text $singleRequestOperationSource -StartMarker 'private void HandleBeginContextRendering(' -EndMarker 'private bool ExactFourEventTranscriptMatches(' -Label 'render callback observers'

foreach ($productionContract in @(
    'CaptureSingleCameraRequestTextureWithTimeout(state, attempt)',
    'new SingleCameraRenderRequestOperation(this, state, attempt)',
    'CapturePolicy.RequireSingleCameraRenderRequestExactRasterBinding(',
    'CapturePolicy.SingleCameraRenderRequestPixelSource',
    'singleCameraRenderRequestSurface =',
    'first-party RGB24 ReadPixels',
    'DisplayEncodingPolicy.CreateUnityGammaUnormRgb24(',
    'DisplayEncodingPolicy.MapIdentityToSrgbTagged8(',
    'DisplayEncodingPolicy.ExpandToSrgbTagged16(',
    'DeterministicPng.Encode(',
    'lower_left_Unity_Gamma_R8G8B8A8_UNorm_display_code_rgb24_sha256_before_row_flip_and_sRGB_tagging',
    'UpdateCaptureReadbackAggregates(capture);'
)) {
    Assert-ContainsLiteral $productionRouteSource $productionContract 'production request route'
}
Assert-NotMatch $productionRouteSource 'await\s+CaptureTextureWithTimeout\s*\(' 'production request route'
Assert-NotMatch $productionRouteSource 'new\s+SnapFrameReadbackOperation\s*\(' 'production request route'
Assert-NotMatch $productionRouteSource 'CaptureTo(File|Texture)Async' 'production request route'
Assert-NotMatch $productionRouteSource 'ImageConversion\.EncodeToPNG' 'production request route'
$legacyMethodReferences = [Regex]::Matches($moduleSource, '\bCaptureTextureWithTimeout\s*\(').Count
Assert-Equal 1 $legacyMethodReferences 'unreachable legacy SnapFrame method reference count'
Assert-NotMatch $readOnlyInventorySource 'SnapFrameCaptureFeature\.Instance|\.TargetCamera|\.FrameRT|\.FrameDirty' 'read-only renderer inventory'

foreach ($requestContract in @(
    'GraphicsFormat.R8G8B8A8_UNorm',
    'new RenderTextureDescriptor(',
    'sRGB = false',
    'dimension = TextureDimension.Tex2D',
    'volumeDepth = 1',
    'msaaSamples = 1',
    'mipCount = 1',
    'depthStencilFormat = GraphicsFormat.None',
    'useMipMap = false',
    'autoGenerateMips = false',
    'enableRandomWrite = false',
    'useDynamicScale = false',
    'new UniversalRenderPipeline.SingleCameraRequest',
    'destination = _ownedRenderTexture',
    'mipLevel = 0',
    'slice = 0',
    'face = CubemapFace.Unknown',
    'RenderPipeline.SupportsRenderRequest(_camera, request)',
    'RenderPipeline.SubmitRenderRequest(_camera, request)',
    'RenderPipelineManager.beginContextRendering +=',
    'RenderPipelineManager.beginCameraRendering +=',
    'RenderPipelineManager.endCameraRendering +=',
    'RenderPipelineManager.endContextRendering +=',
    '"beginContext"',
    '"beginCamera"',
    '"endCamera"',
    '"endContext"',
    'new Texture2D(',
    'TextureFormat.RGB24',
    'texture.ReadPixels(',
    'texture.Apply(false, false);',
    'RenderTexture.active = _ownedRenderTexture;',
    'RenderTexture.active = previousActive;',
    'target.Release();',
    'UnityEngine.Object.Destroy(target);',
    'SentinelStage',
    'ExactStage',
    'sentinelAndExactRgbDiffer',
    'ComputeUrpRendererStateSignature(',
    'ComputeUrpRendererConfigurationSignature(',
    'EstablishLockedRenderPipelineBoundary();',
    'new SpawnPointVisualizationSuppressionLease(_owner, _camera);',
    '_spawnPointSuppression.Suppress();',
    '_spawnPointSuppression.MarkSentinelRequestAndReadbackComplete();',
    '_spawnPointSuppression.MarkExactRequestAndReadbackComplete();',
    'RestoreSpawnPointVisualizations();',
    'entryPipelinePresent',
    'capabilityPreflightCallCount = 1;',
    'capabilityPreflightDestinationInstanceId =',
    'capabilityPreflightBoundToExactOwnedDestination = true;',
    'unityOwnedRuntimeInitializationOccurred =',
    'rendererConfigurationSignatureBeforeSha256',
    'rendererConfigurationSignatureAfterSha256',
    'rendererConfigurationStableAcrossInitialization',
    'disposableProcessOnlyRuntimeLifetime = true;',
    'persistentRenderPipelineAssetMutationClaimed = false;',
    'sceneCameraScreenRendererGetterContract =',
    'CapturePolicy.SceneCameraScreenRendererGetterContract;',
    'sceneCameraScreenRendererSetterInvoked = false;',
    'sceneCameraScreenRendererModeBefore =',
    '_owner._sceneManager.SceneCameraScreenRenderer;',
    'sceneCameraScreenRendererModeAfter =',
    'sceneCameraTargetTextureNullBeforeOperation =',
    'sceneCameraTargetTextureNullAfterOperation =',
    'visualQaRequired = true;',
    'finalSourceFaithfulAcceptanceClaimed = false;',
    'Resources.FindObjectsOfTypeAll<CameraDraw>()',
    'cpuOrientationStatus =',
    '"unverified_pending_visual_qa"'
)) {
    Assert-ContainsLiteral $singleRequestOperationSource $requestContract 'SingleCameraRenderRequest operation'
}

$createTargetIndex = $captureAsyncSource.IndexOf('CreateOwnedRenderTexture();', [StringComparison]::Ordinal)
$preflightIndex = $captureAsyncSource.IndexOf('EstablishLockedRenderPipelineBoundary();', [StringComparison]::Ordinal)
$suppressionIndex = $captureAsyncSource.IndexOf('_spawnPointSuppression.Suppress();', [StringComparison]::Ordinal)
$firstRequestIndex = $captureAsyncSource.IndexOf('_surface.sentinelRequest = ExecuteRequest(', [StringComparison]::Ordinal)
if ($createTargetIndex -lt 0 -or $preflightIndex -le $createTargetIndex -or
    $suppressionIndex -le $preflightIndex -or $firstRequestIndex -le $suppressionIndex) {
    throw 'The owned exact destination and capability preflight must precede the marker lease, which must precede callback-bearing requests.'
}
$sentinelMarkIndex = $captureAsyncSource.IndexOf('_spawnPointSuppression.MarkSentinelRequestAndReadbackComplete();', [StringComparison]::Ordinal)
$exactRequestIndex = $captureAsyncSource.IndexOf('_surface.exactRequest = ExecuteRequest(', [StringComparison]::Ordinal)
$exactMarkIndex = $captureAsyncSource.IndexOf('_spawnPointSuppression.MarkExactRequestAndReadbackComplete();', [StringComparison]::Ordinal)
$normalRestoreIndex = $captureAsyncSource.IndexOf('RestoreSpawnPointVisualizations();', [StringComparison]::Ordinal)
$postRendererInventoryIndex = $captureAsyncSource.IndexOf('_surface.rendererInventoryAfter =', [StringComparison]::Ordinal)
$finallyRestoreIndex = $captureAsyncSource.LastIndexOf('AttemptCleanup(RestoreSpawnPointVisualizations, cleanupFailures);', [StringComparison]::Ordinal)
$finallyUnsubscribeIndex = $captureAsyncSource.LastIndexOf('AttemptCleanup(UnsubscribeAll, cleanupFailures);', [StringComparison]::Ordinal)
if ($sentinelMarkIndex -le $firstRequestIndex -or
    $exactRequestIndex -le $sentinelMarkIndex -or
    $exactMarkIndex -le $exactRequestIndex -or
    $normalRestoreIndex -le $exactMarkIndex -or
    $postRendererInventoryIndex -le $normalRestoreIndex -or
    $finallyRestoreIndex -lt 0 -or
    $finallyUnsubscribeIndex -le $finallyRestoreIndex) {
    throw 'The spawn-point lease does not cover both readbacks or restore before post-state checks and as the first cleanup action.'
}
foreach ($preflightContract in @(
    'destination = _ownedRenderTexture',
    'mipLevel = 0',
    'slice = 0',
    'face = CubemapFace.Unknown',
    'RenderPipeline.SupportsRenderRequest(_camera, request)',
    '_pipelineBefore = RenderPipelineManager.currentPipeline;',
    '_surface.unityOwnedRuntimeInitializationOccurred =',
    'CapturePolicy.ComputeUrpRendererConfigurationSignature(',
    '_surface.rendererInventoryBefore =',
    '_surface.rendererStateSignatureBeforeSha256 ='
)) {
    Assert-ContainsLiteral $capabilityPreflightSource $preflightContract 'capability preflight'
}
Assert-ContainsLiteral $capabilityPreflightSource '_surface.capabilityPreflightSubmitRenderRequestInvoked = false;' 'capability preflight'
Assert-ContainsLiteral $capabilityPreflightSource '_surface.capabilityPreflightReadbackInvoked = false;' 'capability preflight'
Assert-NotMatch $capabilityPreflightSource 'RenderPipeline\.SubmitRenderRequest\s*\(|SubscribeAll\s*\(|ReadOwnedRenderTexture\s*\(|\.ReadPixels\s*\(' 'capability preflight'
$supportsIndex = $capabilityPreflightSource.IndexOf('RenderPipeline.SupportsRenderRequest(_camera, request)', [StringComparison]::Ordinal)
$configurationAfterIndex = $capabilityPreflightSource.IndexOf('_surface.rendererConfigurationAfterPreflight =', [StringComparison]::Ordinal)
$stateBaselineIndex = $capabilityPreflightSource.IndexOf('_surface.rendererStateSignatureBeforeSha256 =', [StringComparison]::Ordinal)
if ($supportsIndex -lt 0 -or $configurationAfterIndex -le $supportsIndex -or
    $stateBaselineIndex -le $configurationAfterIndex) {
    throw 'The persistent configuration comparison must span initialization, and full renderer-state baselining must begin only afterward.'
}
foreach ($perRequestContract in @(
    'supportsRenderRequestCallCount = 1;',
    'submitRenderRequestCallCount = 1;',
    'RenderPipeline.SupportsRenderRequest(_camera, request)',
    'RenderPipeline.SubmitRenderRequest(_camera, request)',
    'pipelineIdentityVerifiedAfterSupports',
    'rendererStateVerifiedAfterSupports'
)) {
    Assert-ContainsLiteral $perRequestSource $perRequestContract 'per-request render submission'
}
$submitRequestIndex = $perRequestSource.IndexOf(
    'RenderPipeline.SubmitRenderRequest(_camera, request)',
    [StringComparison]::Ordinal)
$suppressionBeforeSubmitIndex = $perRequestSource.LastIndexOf(
    '_spawnPointSuppression.RequireSuppressed();',
    $submitRequestIndex,
    [StringComparison]::Ordinal)
$suppressionAfterSubmitIndex = $perRequestSource.IndexOf(
    '_spawnPointSuppression.RequireSuppressed();',
    $submitRequestIndex + 1,
    [StringComparison]::Ordinal)
if ($submitRequestIndex -lt 0 -or
    $suppressionBeforeSubmitIndex -lt 0 -or
    $suppressionAfterSubmitIndex -le $submitRequestIndex) {
    throw 'The spawn-point lease must be checked immediately around synchronous SubmitRenderRequest.'
}
Assert-NotMatch $callbackObserverSource 'SupportsRenderRequest|SubmitRenderRequest' 'render callback observers'
Assert-Equal 3 ([Regex]::Matches(
    $singleRequestOperationSource,
    '_owner\._sceneManager\.SceneCameraScreenRenderer').Count) 'screen-renderer getter count'
Assert-ContainsLiteral $singleRequestOperationSource '!_owner._captureManager.IsCaptureViewVisible &&' 'clean production surface guard'
Assert-ContainsLiteral $singleRequestOperationSource '_owner._sceneManager.SceneCameraScreenRenderer &&' 'clean production surface guard'
Assert-Equal 0 ([Regex]::Matches(
    $singleRequestOperationSource,
    '\.SceneCameraScreenRenderer\s*=(?!=)').Count) 'screen-renderer setter count'

foreach ($forbiddenRequestPattern in @(
    'CommandBuffer',
    'Graphics\.Blit',
    '\.Blit\s*\(',
    'CopyTexture',
    'ScriptableRenderContext\.Submit',
    '\bcontext\.Submit\s*\(',
    '\b_camera\.Render\s*\(',
    'UniversalRenderPipeline\.RenderSingleCamera',
    '\.cameraStack\b',
    'SnapFrameCaptureFeature\.Instance',
    '\.TargetCamera\b',
    '\.FrameRT\b',
    '\.FrameDirty\b',
    'ScriptableRendererFeature\.SetActive',
    '\.SetRenderer\s*\(',
    '\.SetDirty\s*\(',
    'GraphicsSettings\.[A-Za-z0-9_]+\s*=',
    'QualitySettings\.renderPipeline\s*='
)) {
    Assert-NotMatch $singleRequestOperationSource $forbiddenRequestPattern 'SingleCameraRenderRequest operation'
}
$targetTextureAssignments = [Regex]::Matches(
    $singleRequestOperationSource,
    '\b_camera\.targetTexture\s*=(?!=)').Count
Assert-Equal 1 $targetTextureAssignments 'scoped Camera.targetTexture assignment count'
Assert-ContainsLiteral $targetRestoreSource '_camera.targetTexture = _originalCameraTargetTexture;' 'camera-target restoration method'
Assert-ContainsLiteral $targetRestoreSource '_surface.cameraTargetTextureAssignedByModule = true;' 'camera-target restoration method'
if ($targetRestoreSource.IndexOf(
        '_surface.cameraTargetTextureAssignedByModule = true;',
        [StringComparison]::Ordinal) -gt $targetRestoreSource.IndexOf(
        '_camera.targetTexture = _originalCameraTargetTexture;',
        [StringComparison]::Ordinal)) {
    throw 'The cleanup receipt must record a module camera-target assignment before performing it.'
}

foreach ($policyContract in @(
    'SingleCameraRenderRequestPixelSource',
    'SingleCameraRenderRequestSurfaceProvenance',
    'SingleCameraRenderRequestRenderBoundaryEvidence',
    'CreateSingleCameraRenderRequestProhibitedMutationApis()',
    'RequireSingleCameraRenderRequestCaptureRoute(',
    'RequireSingleCameraRenderRequestExactRasterBinding(',
    'surface.visualQaRequired',
    'surface.finalSourceFaithfulAcceptanceClaimed',
    'surface.snapFrameApiInvoked',
    'surface.snapFramePixelSourceUsed',
    'surface.cameraTargetTextureAssignedByModule',
    'surface.ownedRenderTextureReleaseRequested',
    'surface.ownedRenderTextureDestroyRequested',
    'surface.unownedResourceDestroyOrReleaseRequested',
    'surface.sentinelAndExactRgbDiffer',
    'surface.cameraStackGetterInvoked',
    'surface.cameraStackBypassedByRequestContract',
    'surface.capabilityPreflightCallCount',
    'surface.capabilityPreflightBoundToExactOwnedDestination',
    'surface.capabilityPreflightSubmitRenderRequestInvoked',
    'surface.capabilityPreflightReadbackInvoked',
    'surface.unityOwnedRuntimeInitializationOccurred',
    'surface.rendererConfigurationStableAcrossInitialization',
    'surface.pipelineRuntimeIdentityStableAfterEstablishment',
    'surface.disposableProcessOnlyRuntimeLifetime',
    'surface.persistentRenderPipelineAssetMutationClaimed',
    'surface.sceneCameraScreenRendererModeBefore',
    'surface.sceneCameraScreenRendererModeAfter',
    'surface.sceneCameraScreenRendererGetterContract',
    'SceneCameraScreenRendererGetterContract',
    'surface.sceneCameraScreenRendererSetterInvoked',
    'surface.sceneCameraTargetTextureNullBeforeOperation',
    'surface.sceneCameraTargetTextureNullAfterOperation',
    'RequireUrpRendererConfigurationInventory(',
    'ComputeUrpRendererConfigurationSignature(',
    'RequireSpawnPointVisualizationSuppression(',
    'surface.urpRendererDataOrFeatureMutationApiInvoked'
)) {
    Assert-ContainsLiteral $capturePolicySource $policyContract 'SingleCameraRenderRequest policy'
}
foreach ($receiptContract in @(
    'internal sealed class SingleCameraRenderRequestTargetReceipt',
    'internal sealed class SingleCameraRenderRequestReadbackReceipt',
    'internal sealed class SingleCameraRenderRequestCallbackReceipt',
    'internal sealed class SingleCameraRenderRequestInvocationReceipt',
    'internal sealed class NativeCanvasReceipt',
    'internal sealed class UrpRendererConfigurationFeatureReceipt',
    'internal sealed class UrpRendererConfigurationDataReceipt',
    'internal sealed class UrpRendererConfigurationReceipt',
    'internal sealed class SingleCameraRenderRequestSurfaceReceipt',
    'internal sealed class SpawnPointVisualizationTargetReceipt',
    'internal sealed class SpawnPointVisualizationSuppressionReceipt',
    'public SingleCameraRenderRequestInvocationReceipt sentinelRequest;',
    'public SingleCameraRenderRequestInvocationReceipt exactRequest;',
    'public SingleCameraRenderRequestSurfaceReceipt singleCameraRenderRequestSurface;',
    'public bool visualQaRequired;',
    'public bool finalSourceFaithfulAcceptanceClaimed;',
    'public bool snapFrameApiInvoked;',
    'public bool snapFramePixelSourceUsed;',
    'public bool cameraTargetTextureAssignedByModule;',
    'public bool entryPipelinePresent;',
    'public int capabilityPreflightCallCount;',
    'public int capabilityPreflightDestinationInstanceId;',
    'public bool capabilityPreflightBoundToExactOwnedDestination;',
    'public bool capabilityPreflightSupportsRenderRequestReturnedTrue;',
    'public bool capabilityPreflightSubmitRenderRequestInvoked;',
    'public bool capabilityPreflightReadbackInvoked;',
    'public bool unityOwnedRuntimeInitializationOccurred;',
    'public UrpRendererConfigurationReceipt rendererConfigurationBeforePreflight;',
    'public UrpRendererConfigurationReceipt rendererConfigurationAfterPreflight;',
    'public string rendererConfigurationSignatureBeforeSha256;',
    'public string rendererConfigurationSignatureAfterSha256;',
    'public bool rendererConfigurationStableAcrossInitialization;',
    'public bool pipelineRuntimeIdentityStableAfterEstablishment;',
    'public bool disposableProcessOnlyRuntimeLifetime;',
    'public bool persistentRenderPipelineAssetMutationClaimed;',
    'public bool sceneCameraScreenRendererModeBefore;',
    'public bool sceneCameraScreenRendererModeAfter;',
    'public string sceneCameraScreenRendererGetterContract;',
    'public bool sceneCameraScreenRendererSetterInvoked;',
    'public bool sceneCameraTargetTextureNullBeforeOperation;',
    'public bool sceneCameraTargetTextureNullAfterOperation;',
    'public SpawnPointVisualizationSuppressionReceipt spawnPointVisualizationSuppression;',
    'public bool everyAttemptSpawnPointVisualizationsSuppressedAndRestored;',
    'public string requestedGraphicsFormat;',
    'public bool requestedSrgb;',
    'public string effectiveGraphicsFormat;',
    'public bool effectiveGraphicsFormatRenderSupported;',
    'public bool effectiveSrgb;',
    'public bool requestedAndEffectiveFormatMatch;',
    'public string rawRgb24Semantics;',
    'public bool rawRgb24LinearLightPhotometryClaimed;',
    'public string rawRgb24CandidatePath;',
    'public string browserDisplay8CodeMapping;',
    'public string browserDisplay16CodeMapping;',
    'public bool exactPhotometricTransferClaimed;',
    'public bool expanded16AddsPrecision;',
    'public string browserDisplaySrgbTaggedExpanded16CandidatePath;',
    'public string browserDisplaySrgbTaggedExpanded16PngPath;',
    'public string finalBrowserDisplayCodeMapping;',
    'public string finalExpanded16CodeMapping;'
)) {
    Assert-ContainsLiteral $receiptModelsSource $receiptContract 'receipt v14 model'
}
foreach ($obsoleteReceiptField in @(
    'public bool pipelinePreinitializedBeforeSupportsCheck;',
    'public string pipelineTypeFullNameBefore;',
    'public int pipelineRuntimeIdentityHashCodeBefore;',
    'public string pipelineTypeFullNameAfter;',
    'public int pipelineRuntimeIdentityHashCodeAfter;',
    'public bool sceneCameraScreenRendererDisabledBefore;',
    'public bool sceneCameraScreenRendererDisabledAfter;',
    'public string rawLinearCandidatePath;',
    'public string rawLinearEvidencePath;',
    'public bool graphicsFormatRenderSupported;',
    'public string displayTransferFunction;',
    'public string displaySrgb16CandidatePath;',
    'public string archivalDisplaySrgb16PngPath;',
    'public string finalDisplayTransferFunction;'
)) {
    Assert-NotMatch $receiptModelsSource ([Regex]::Escape($obsoleteReceiptField)) 'receipt v14 model'
}
foreach ($testContract in @(
    'TestSingleCameraRenderRequestRoutePolicy();',
    'RequireSingleCameraRenderRequestCaptureRoute(',
    'RequireSingleCameraRenderRequestExactRasterBinding(',
    'sentinelAndExactRgbDiffer',
    'capabilityPreflightSupportsRenderRequestReturnedTrue',
    'capabilityPreflightSubmitRenderRequestInvoked',
    'capabilityPreflightReadbackInvoked',
    'rendererConfigurationSignatureBeforeSha256',
    'rendererConfigurationSignatureAfterSha256',
    'unityOwnedRuntimeInitializationOccurred',
    'pipelineIdentityVerifiedAfterSupports',
    'sceneCameraScreenRendererModeBefore',
    'sceneCameraScreenRendererModeAfter',
    'sceneCameraScreenRendererGetterContract',
    'sceneCameraScreenRendererSetterInvoked',
    'sceneCameraTargetTextureNullBeforeOperation',
    'sceneCameraTargetTextureNullAfterOperation',
    'RequireSpawnPointVisualizationSuppression(',
    'Spawn-point suppression adversarial mutation #',
    'DisplayEncodingTests.Run();'
)) {
    Assert-ContainsLiteral ($capturePolicyTestsSource + $displayEncodingTestsSource) $testContract 'v1.7.0 policy tests'
}
foreach ($displayContract in @(
    'IDENTITY_UNITY_GAMMA_UNORM_DISPLAY_CODE_VALUES_TO_SRGB_TAGGED_PNG8',
    'UINT8_CODE_VALUE_TIMES_257_TO_SRGB_TAGGED_PNG16_NO_ADDED_PRECISION',
    'Unity_Gamma_R8G8B8A8_UNorm_display_code_values_read_via_Texture2D_RGB24_lower_left_before_row_flip',
    'RawRgb24LinearLightPhotometryClaimed = false',
    'ExactPhotometricTransferClaimed = false',
    'Expanded16AddsPrecision = false',
    '40AFF2E9D2D8922E47AFD4648E6967497158785FBD1DA870E7110266BF944880',
    'F393097E80EC38DB493EB054A0886181EB2C0E8CF7B5CDF1DE392FBE94B0D1F5',
    'internal const string ChunkSequence = "IHDR,sRGB,gAMA,cHRM,IDAT,IEND";',
    'WriteChunk(stream, "sRGB"',
    'WriteChunk(stream, "gAMA"',
    'WriteChunk(stream, "cHRM"',
    'DecodeStoredZlib(',
    'NoTrailingBytesVerified = true;',
    '95FA7DD623ED6A2E75940BB73EF630591A1B1479908FCB61949A6D402B07CBF7',
    '7BA8BE7303E4E13D0E62B4E123461C37A16E9F5FE4BDA0741383AE2170B97DBF'
)) {
    Assert-ContainsLiteral ($displayEncodingPolicySource + $deterministicPngSource + $displayEncodingTestsSource) $displayContract 'deterministic display encoding contract'
}
Assert-NotMatch $displayEncodingPolicySource 'OETF|EncodeSrgb' 'identity display-code policy'
Assert-ContainsLiteral $moduleSource '78-by-13 bottom-right watermark draw' 'diagnostic CameraDraw limitation'
Assert-ContainsLiteral $singleRequestOperationSource 'candidate.GetType().FullName + "|" +' 'active CameraDraw identity inventory'

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
    'RawRgb24Sha256',
    'ExpandedSrgbTagged16PngSha256',
    'everyAttemptSpawnPointVisualizationsSuppressedAndRestored',
    'venviewer\.grand-hall\.lcc-native-capture-receipt\.v14',
    'venviewer\.grand-hall\.lcc-native-capture-operator-receipt\.v4',
    'Write-RunPlayerLogEvidence',
    'grand-hall-native-capture-player-log-run\.log',
    'last_exact_approved_sandbox_unity_startup_marker_through_eof_after_process_exit',
    'startupMarkerLineMatches',
    'exactApprovedSandboxStartupMarkerCount',
    'suffixed-startup-marker',
    'renderTextureSrgbFallbackWarningCount',
    'knownStartupDbufferClearShaderUnsupportedErrorCount',
    'unexpectedErrorLineCount',
    'errorFree',
    'knownWindowsMediaFoundationUnknownColorPrimariesWarningCount',
    'unexpectedWindowsMediaFoundationUnknownColorPrimariesWarningCount',
    'windowsMediaFoundationUnknownColorPrimariesLimitation',
    'knownPostReceiptVendorTooltipRescacheShutdownExceptionCount',
    'knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount',
    'knownTooltipRescacheShutdownBlockPattern',
    'knownEnvironmentOnDisableShutdownBlockPattern',
    'venviewer\.grand-hall\.lcc-native-shutdown-profile-set\.v1',
    'clean_shutdown_no_exceptions',
    'tooltip_rescache_object_disposed_x5',
    'environment_on_disable_null_reference_x1',
    'terminalShutdownComplete',
    'approvedShutdownProfileFullyConsumed',
    'approvedShutdownProfilePhaseSatisfied',
    'approvedShutdownProfilesMutuallyExclusive',
    'Unreviewed\.Interleaved\.Frame',
    'interleavedEvidence',
    'unclassifiedExceptionCount',
    'unclassifiedExceptionDiagnosticLineCount',
    'exceptionFree',
    'onlyExpectedDiagnosticsObserved',
    'operatorSourceBoundToBuildReceipt',
    '\$operatorSourceMatches\.Count -ne 1',
    '\$operatorSourceReceipt\.byteLength',
    'Assert-ExpectedPlayerLogDiagnostics',
    'PlayerLogAuditSelfTest',
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
if ($processDisposeIndex -lt 0 -or $featureRestoreIndex -lt 0 -or
    $processDisposeIndex -gt $featureRestoreIndex) {
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
$restoreFunctionSource = Get-SourceRegion -Text $operatorSource -StartMarker 'function Restore-FeatureToggleLease' -EndMarker 'function Repair-StaleFeatureToggleLease' -Label 'feature-toggle restoration primitive'
if ([Regex]::Matches($restoreFunctionSource, 'Assert-NoLccEditorProcess').Count -lt 2) {
    throw 'The restoration primitive must gate both evidence read and atomic replacement on zero LCCEditor processes.'
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
    'displayEncodingTestsPassed',
    'playerLogAuditSelfTestPassed',
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
$lockedManagedReferences = @(
    @('LCCWorld.dll', '4A73BEFBB6517B15A0BE23B3F32D4F60EFAA593A414CE6CC3B3EA921BE0F084D'),
    @('LCCWorld.Common.dll', 'CC166D8396D462A1EE27C308855DDADF7010E58FD185276D78645490A747EFC2'),
    @('LCCSDK.dll', 'C02359FA2A7695C59B6A295E00C4383E0C576B8BC74585E68C05ECDF02A20BAE'),
    @('Unity.RenderPipelines.Universal.Runtime.dll', '59458EF5AD12F800842598647AE8AE6E82A074852C1D2684B81A322FDBC86CE1'),
    @('Unity.RenderPipelines.Core.Runtime.dll', 'E68FCEB04E8F571E6F2B10ED15D5FE19A83E274EC557E68AE2D72C3E068E074D')
)
$vendorHashes = @{}
foreach ($file in $vendorLock.files) {
    $vendorHashes[[string]$file.sha256] = [string]$file.relativePath
}
foreach ($lockedReference in $lockedManagedReferences) {
    $name = [string]$lockedReference[0]
    $sha256 = [string]$lockedReference[1]
    $relativePath = 'LCCEditor_Data/Managed/' + $name
    $matches = @($vendorLock.files | Where-Object {
        [string]$_.relativePath -ceq $relativePath
    })
    if ($matches.Count -ne 1) {
        throw "The vendor lock must contain exactly one compile/runtime dependency entry for $relativePath."
    }
    Assert-Equal 'compile_and_runtime' ([string]$matches[0].role) "vendor-lock role $relativePath"
    Assert-Equal $sha256 ([string]$matches[0].sha256) "vendor-lock SHA-256 $relativePath"
    $installedReferencePath = Join-Path $LccEditorRoot ($relativePath -replace '/', '\')
    if (-not (Test-Path -LiteralPath $installedReferencePath -PathType Leaf)) {
        throw "The locked managed dependency is missing from the installed editor: $installedReferencePath"
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
$ildasm = $ildasmCandidates | Where-Object {
    Test-Path -LiteralPath $_ -PathType Leaf
} | Select-Object -First 1
if (-not $ildasm) {
    throw 'ildasm.exe is required for offline interface verification and was not found.'
}
$lccWorldPath = Join-Path $LccEditorRoot 'LCCEditor_Data\Managed\LCCWorld.dll'
$lccWorldIl = (& $ildasm /text /nobar $lccWorldPath | Out-String)
if ($LASTEXITCODE -ne 0) {
    throw "ildasm failed for locked LCCWorld.dll with exit code $LASTEXITCODE."
}
$screenRendererGetterMatch = [Regex]::Match(
    $lccWorldIl,
    '(?ms)\.method public[^\r\n]*\r?\n\s*instance bool\s+get_SceneCameraScreenRenderer\(\) cil managed\s*\{\s*// Code size.*?\}\s*// end of method SceneManager::get_SceneCameraScreenRenderer')
if (-not $screenRendererGetterMatch.Success) {
    throw 'The locked concrete SceneManager screen-renderer getter IL was not found.'
}
$screenRendererGetterIl = $screenRendererGetterMatch.Value
foreach ($getterContract in @(
    'SceneManager::m_tempRT',
    'ldnull',
    'UnityEngine.Object::op_Equality',
    'ret'
)) {
    if ($screenRendererGetterIl -notmatch [Regex]::Escape($getterContract)) {
        throw "The locked screen-renderer getter is missing '$getterContract'."
    }
}
Assert-Equal 1 ([Regex]::Matches($screenRendererGetterIl, 'SceneManager::m_tempRT').Count) 'locked screen-renderer getter temp-target read count'

$screenRendererSetterMatch = [Regex]::Match(
    $lccWorldIl,
    '(?ms)\.method public[^\r\n]*\r?\n\s*instance void\s+set_SceneCameraScreenRenderer\(bool ''value''\) cil managed\s*\{\s*// Code size.*?\}\s*// end of method SceneManager::set_SceneCameraScreenRenderer')
if (-not $screenRendererSetterMatch.Success) {
    throw 'The locked concrete SceneManager screen-renderer setter IL was not found.'
}
$screenRendererSetterIl = $screenRendererSetterMatch.Value
foreach ($setterContract in @(
    'RenderTexture::ReleaseTemporary',
    'ldarg.1',
    'brtrue.s',
    'RenderTexture::GetTemporary',
    'Camera::set_targetTexture',
    'stfld      class [UnityEngine.CoreModule]UnityEngine.RenderTexture XGrids.LCCWorld.Framework.SceneManager::m_tempRT'
)) {
    if ($screenRendererSetterIl -notmatch [Regex]::Escape($setterContract)) {
        throw "The locked screen-renderer setter is missing '$setterContract'."
    }
}
$setterBranchIndex = $screenRendererSetterIl.IndexOf('brtrue.s', [StringComparison]::Ordinal)
$setterAllocateIndex = $screenRendererSetterIl.IndexOf('RenderTexture::GetTemporary', [StringComparison]::Ordinal)
$setterAllocatedTargetIndex = $screenRendererSetterIl.IndexOf('Camera::set_targetTexture', [StringComparison]::Ordinal)
$setterNullTargetIndex = $screenRendererSetterIl.LastIndexOf('Camera::set_targetTexture', [StringComparison]::Ordinal)
if ($setterBranchIndex -lt 0 -or $setterAllocateIndex -le $setterBranchIndex -or
    $setterAllocatedTargetIndex -le $setterAllocateIndex -or
    $setterNullTargetIndex -le $setterAllocatedTargetIndex) {
    throw 'Locked setter semantics changed: false must allocate/assign a vendor target and true must take the later null-target path.'
}
Assert-Equal 2 ([Regex]::Matches($screenRendererSetterIl, 'Camera::set_targetTexture').Count) 'locked screen-renderer setter target assignment count'

$il = (& $ildasm /text /nobar $ModulePath | Out-String)
if ($LASTEXITCODE -ne 0) {
    throw "ildasm failed with exit code $LASTEXITCODE."
}

foreach ($requiredIlPattern in @(
    'implements \[LCCWorld\]XGrids\.LCCWorld\.Framework\.IModule',
    'NativeCaptureModule::Init',
    'NativeCaptureModule::Execute',
    'NativeCaptureModule::HandleModulesLoaded',
    'NativeCaptureModule::Stop',
    'NativeCaptureModule::PopulateCaptureAttemptAsync',
    'NativeCaptureModule::CaptureSingleCameraRequestTextureWithTimeout',
    'SingleCameraRenderRequestOperation::CaptureAsync',
    'SingleCameraRenderRequestOperation::EstablishLockedRenderPipelineBoundary',
    'SingleCameraRenderRequestOperation::ExecuteRequest',
    'SingleCameraRenderRequestOperation::ReadOwnedRenderTexture',
    'SpawnPointVisualizationSuppressionLease::Suppress',
    'SpawnPointVisualizationSuppressionLease::RequireSuppressed',
    'SpawnPointVisualizationSuppressionLease::Restore',
    'Renderer::set_forceRenderingOff',
    'SnapFrameReadbackOperation::CaptureReadOnlyUrpRendererInventory',
    'SingleCameraRenderRequestOperation::RestoreOriginalCameraTargetTexture',
    'SingleCameraRenderRequestOperation::ReleaseAndDestroyOwnedRenderTexture',
    'SingleCameraRenderRequestOperation::CapturePotentialCameraCallbackContributors',
    'CapturePolicy::RequireSingleCameraRenderRequestCaptureRoute',
    'CapturePolicy::RequireSingleCameraRenderRequestExactRasterBinding',
    'CapturePolicy::RequireSpawnPointVisualizationSuppression',
    'CapturePolicy::ComputeUrpRendererConfigurationSignature',
    'DisplayEncodingPolicy::MapIdentityToSrgbTagged8',
    'DisplayEncodingPolicy::ExpandToSrgbTagged16',
    'DeterministicPng::Encode',
    'DeterministicPng::VerifyAndDecode',
    'RenderPipeline::SupportsRenderRequest',
    'RenderPipeline::SubmitRenderRequest',
    'UniversalRenderPipeline/SingleCameraRequest|UniversalRenderPipeline\+SingleCameraRequest',
    'RenderTextureDescriptor::\.ctor',
    'RenderTextureDescriptor::set_sRGB',
    'RenderTexture::\.ctor',
    'RenderTexture::Create',
    'RenderTexture::Release',
    'Texture2D::\.ctor',
    'Texture2D::ReadPixels',
    'Texture2D::Apply',
    'Texture2D::GetPixels32',
    'RenderTexture::get_active',
    'RenderTexture::set_active',
    'Camera::get_targetTexture',
    'Camera::set_targetTexture',
    'RenderPipelineManager::add_beginContextRendering',
    'RenderPipelineManager::remove_beginContextRendering',
    'RenderPipelineManager::add_beginCameraRendering',
    'RenderPipelineManager::remove_beginCameraRendering',
    'RenderPipelineManager::add_endCameraRendering',
    'RenderPipelineManager::remove_endCameraRendering',
    'RenderPipelineManager::add_endContextRendering',
    'RenderPipelineManager::remove_endContextRendering',
    'GraphicsSettings::get_currentRenderPipeline|RenderPipelineManager::get_currentPipeline',
    'SystemInfo::IsFormatSupported',
    'RuntimeHelpers::GetHashCode',
    'Resources::FindObjectsOfTypeAll',
    'CameraDraw',
    'IProjectManager::CreateTemporaryLCCProject',
    'ISceneManager::LoadDefaultScene',
    'ILCCSceneManager::LCCObjectToWorldSpace',
    'ILCCSceneManager::SetRecordMode',
    'ILCCSceneManager::SetFOV',
    'ICameraService::SetTransform',
    'IRendererQualitySceneManager::SetRenderAll',
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
if ($il -match 'ImageConversion::EncodeToPNG') {
    throw 'The compiled module still uses Unity untagged PNG encoding instead of the deterministic display encoder.'
}

$singleRequestIlMatch = [Regex]::Match(
    $il,
    '(?ms)^[ \t]*\.class[^\r\n]*SingleCameraRenderRequestOperation[^\{]*\{.*?^[ \t]*\} // end of class SingleCameraRenderRequestOperation[ \t]*\r?$')
if (-not $singleRequestIlMatch.Success) {
    throw 'The compiled SingleCameraRenderRequestOperation IL class boundary was not found.'
}
$singleRequestIl = $singleRequestIlMatch.Value
foreach ($forbiddenRequestIlPattern in @(
    'CommandBuffer::Blit',
    'Graphics::Blit',
    'CopyTexture',
    'ScriptableRenderContext::Submit',
    'Camera::Render',
    'UniversalRenderPipeline::RenderSingleCamera',
    'UniversalAdditionalCameraData::get_cameraStack',
    'SnapFrameCaptureFeature::get_',
    'SnapFrameCaptureFeature::set_',
    'ScriptableRendererFeature::SetActive',
    'UniversalAdditionalCameraData::SetRenderer',
    'ScriptableRendererData::SetDirty',
    'ScriptableRendererFeature::Create',
    'ScriptableRendererFeature::Dispose',
    'ScriptableRenderer::Dispose',
    'GraphicsSettings::set_',
    'QualitySettings::set_renderPipeline'
)) {
    if ($singleRequestIl -match $forbiddenRequestIlPattern) {
        throw "The compiled production request operation contains forbidden IL '$forbiddenRequestIlPattern'."
    }
}
Assert-Equal 1 ([Regex]::Matches($singleRequestIl, 'Camera::set_targetTexture').Count) 'compiled scoped Camera.targetTexture restoration count'
Assert-Equal 3 ([Regex]::Matches($singleRequestIl, 'ISceneManager::get_SceneCameraScreenRenderer').Count) 'compiled screen-renderer getter count'
Assert-Equal 0 ([Regex]::Matches($singleRequestIl, 'ISceneManager::set_SceneCameraScreenRenderer').Count) 'compiled screen-renderer setter count'
Assert-Equal 2 ([Regex]::Matches($singleRequestIl, 'RenderPipeline::SupportsRenderRequest').Count) 'compiled capability and per-request SupportsRenderRequest call-site count'
Assert-Equal 1 ([Regex]::Matches($singleRequestIl, 'RenderPipeline::SubmitRenderRequest').Count) 'compiled per-request SubmitRenderRequest call-site count'
foreach ($forbiddenAssembly in @('System.Net.Http', 'NetMQ', 'MCPForUnity')) {
    if ($il -match "\.assembly extern '$([Regex]::Escape($forbiddenAssembly))'|\.assembly extern $([Regex]::Escape($forbiddenAssembly))") {
        throw "The compiled module unexpectedly references $forbiddenAssembly."
    }
}

Write-Output 'PASS: plugin v1.7.0, native receipt v14, and operator receipt v4 contracts'
Write-Output 'PASS: locked true-when-null LCCWorld screen-renderer getter/setter semantics'
Write-Output 'PASS: canonical GH_1 LCC2 manifest and digest-bound camera profile'
Write-Output 'PASS: build/source/compiler/runtime-closure receipts and vendor dependency locks'
Write-Output 'PASS: modules.loaded lifecycle, high-level scene load, render-all and environment gates'
Write-Output 'PASS: production route reaches only the owned URP SingleCameraRequest operation'
Write-Output 'PASS: exact Gamma R8G8B8A8_UNorm sRGB=false requested/effective 1600x900 sentinel/exact request and direct RGB24 readback contract'
Write-Output 'PASS: exact XGRIDS self/avatar spawn-marker renderer closure is suppressed and reversibly restored'
Write-Output 'PASS: raw Unity-Gamma UNorm display-code plateau, identity sRGB-tagged PNG8, and exact value*257 no-added-precision PNG16'
Write-Output 'PASS: capability-bound disposable Unity initialization and persistent configuration stability contract'
Write-Output 'PASS: post-initialization renderer-state baseline, per-request cardinality and four-event callback transcript'
Write-Output 'PASS: scoped source/IL rejects blit, copy, manual submit, Camera.Render, camera-stack and renderer mutation'
Write-Output 'PASS: active CameraDraw is a potential 78x13 watermark contributor; visual QA remains required and diagnostic-only'
Write-Output 'PASS: reversible feature-toggle lease and bounded disposable-process watchdog'
Write-Output 'PASS: run-bounded Player.log artifact, exact closed shutdown profiles, operator source binding, and honest exception/error classification'
Write-Output 'PASS: no network API, unfinished-code marker, or copied vendor binary'
Write-Output "PASS: bounded runtime closure $($runtimeClosure.memberCount) files / $($runtimeClosure.totalByteLength) bytes"
Write-Output "Module SHA-256: $actualModuleSha256"
Write-Output "Plugin SHA-256: $actualPluginSha256"
