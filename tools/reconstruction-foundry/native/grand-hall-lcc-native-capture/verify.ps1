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
$sourceRoot = Join-Path $PSScriptRoot 'src'
$canonicalManifestPath = 'C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_9\lcc-result\Grand_Hall.lcc'
$canonicalManifestSha256 = 'CE2A539483C7C2A271CA2555F6390E16425BB911851A8A56C2F16B17C248CAC1'
$expectedCompilerPath = 'C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\Roslyn\csc.exe'
$expectedCompilerVersion = '4.1400.26.36408'
$expectedCompilerSha256 = 'F895C265B8FA8ED9601F6D8EC87D1E2079F5E851C70D0719A90007564AE8F6AB'
$expectedSourceRelativePaths = @(
    'README.md',
    'build.ps1',
    'plugin.json',
    'run-capture.ps1',
    'src\CapturePolicy.cs',
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
    $canonicalManifestPath
)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required offline-verification file is missing: $requiredPath"
    }
}

$plugin = Get-Content -LiteralPath $pluginPath -Raw | ConvertFrom-Json
Assert-Equal 'com.venviewer.native_capture' ([string]$plugin.Id) 'plugin Id'
Assert-Equal '1.1.1' ([string]$plugin.Version) 'plugin version'
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
Assert-Equal $canonicalManifestSha256 $actualManifestSha256 'canonical _9 manifest SHA-256'

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
if ($moduleSource -notmatch 'camera\.orthographic = false' -or $moduleSource -notmatch 'state\.Camera\.orthographic') {
    throw 'Perspective camera enforcement is missing.'
}
if ($moduleSource.IndexOf('_preLoadPackageSnapshot = CapturePolicy.SnapshotCanonicalPackage', [StringComparison]::Ordinal) -lt 0 -or
    $moduleSource.IndexOf('_preLoadPackageSnapshot = CapturePolicy.SnapshotCanonicalPackage', [StringComparison]::Ordinal) -gt
        $moduleSource.IndexOf('_eventBus.Subscribe("lccscene.loaded"', [StringComparison]::Ordinal)) {
    throw 'Canonical package identity is not captured before scene subscription/load.'
}
$freshProcessGateIndex = $moduleSource.IndexOf('if (_lccSceneManager.IsSceneLoaded())', [StringComparison]::Ordinal)
$preLoadSnapshotIndex = $moduleSource.IndexOf('_preLoadPackageSnapshot = CapturePolicy.SnapshotCanonicalPackage', [StringComparison]::Ordinal)
if ($freshProcessGateIndex -lt 0 -or $freshProcessGateIndex -gt $preLoadSnapshotIndex) {
    throw 'The pre-load package snapshot is not protected by a fresh-process scene gate.'
}
if ($moduleSource -notmatch 'File\.Move\(temporaryPath, finalPath\)') {
    throw 'Final PNG no longer uses same-directory no-replace promotion.'
}
$stateCaptureIndex = $moduleSource.IndexOf('context.CameraState = CaptureOriginalCameraState()', [StringComparison]::Ordinal)
$cameraApplyIndex = $moduleSource.IndexOf('ApplyLockedCamera(context.CameraState)', [StringComparison]::Ordinal)
if ($stateCaptureIndex -lt 0 -or $cameraApplyIndex -lt 0 -or $stateCaptureIndex -gt $cameraApplyIndex) {
    throw 'Original camera state is not assigned before capture-camera mutation.'
}

foreach ($immediateMutationContract in @(
    '(?s)_lccSceneManager\.SetRecordMode\(\s*true,.*?CapturePolicy\.VerticalFieldOfViewDegrees\);\s*state\.RecordModeEnabled = true;',
    '_lccSceneManager\.SetLockFPS\(true\);\s*state\.LockFpsEnabled = true;',
    '_lccSceneManager\.SetRenderAll\(true\);\s*state\.RenderAllMutated = true;',
    '_lccSceneManager\.SetEnvironmentData\(true\);\s*state\.EnvironmentVisibilityRequested = true;'
)) {
    if ($moduleSource -notmatch $immediateMutationContract) {
        throw "A native mutation is not followed immediately by its cleanup-state transition: $immediateMutationContract"
    }
}
foreach ($requiredIndependentRestore in @(
    'if (state.RecordModeEnabled)',
    'if (state.LockFpsEnabled)',
    'if (state.RenderAllMutated)',
    'if (state.EnvironmentVisibilityRequested)',
    'throw new AggregateException("One or more native capture cleanup operations failed.", restoreErrors)'
)) {
    if ($moduleSource.IndexOf($requiredIndependentRestore, [StringComparison]::Ordinal) -lt 0) {
        throw "Independent cleanup evidence is missing: $requiredIndependentRestore"
    }
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
    '\$priorEnvironment\[\$name\]'
)) {
    if ($operatorSource -notmatch $operatorContract) {
        throw "The bounded operator watchdog is missing required evidence '$operatorContract'."
    }
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
    'ICaptureManager::CaptureToFileAsync',
    'ILCCSceneManager::LCCObjectToWorldSpace',
    'ILCCSceneManager::SetRecordMode',
    'ILCCSceneManager::SetFOV',
    'ICameraService::SetTransform',
    'IRendererQualityService::SetRenderQualityType',
    'IRendererQualityService::SupportFullRender',
    'IRendererQualitySceneManager::SetRenderAll',
    'IRendererQualitySceneManager::IsRenderAll',
    'ILCCSceneManager::SetEnvironmentData',
    'UniTask::WhenAny',
    'lccscene\.loaded'
)) {
    if ($il -notmatch $requiredIlPattern) {
        throw "The compiled module is missing required IL evidence '$requiredIlPattern'."
    }
}
foreach ($forbiddenAssembly in @('System.Net.Http', 'NetMQ', 'MCPForUnity')) {
    if ($il -match "\.assembly extern '$([Regex]::Escape($forbiddenAssembly))'|\.assembly extern $([Regex]::Escape($forbiddenAssembly))") {
        throw "The compiled module unexpectedly references $forbiddenAssembly."
    }
}

Write-Output 'PASS: plugin contract'
Write-Output 'PASS: canonical _9 manifest receipt'
Write-Output 'PASS: no vendor binary copied into the first-party folder'
Write-Output 'PASS: no network API or unfinished-code source pattern'
Write-Output 'PASS: compiled public IModule/camera/LCC/capture API calls'
Write-Output "PASS: bounded runtime closure $($runtimeClosure.memberCount) files / $($runtimeClosure.totalByteLength) bytes"
Write-Output "Module SHA-256: $actualModuleSha256"
Write-Output "Plugin SHA-256: $actualPluginSha256"
