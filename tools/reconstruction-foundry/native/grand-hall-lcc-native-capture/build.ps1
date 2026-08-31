[CmdletBinding()]
param(
    [string]$LccEditorRoot = 'F:\LccStudio\lcceditor',
    [switch]$SkipLiveSourceVerification
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$moduleRoot = $PSScriptRoot
$sourceRoot = Join-Path $moduleRoot 'src'
$testRoot = Join-Path $moduleRoot 'tests'
$outputRoot = Join-Path $moduleRoot 'out'
$lockPath = Join-Path $moduleRoot 'vendor-lock.json'
$pluginPath = Join-Path $moduleRoot 'plugin.json'
$cameraProfileSourcePath = Join-Path $moduleRoot 'camera-profile.json'
$moduleOutputPath = Join-Path $outputRoot 'VenviewerNativeCapture.dll'
$cameraProfileOutputPath = Join-Path $outputRoot 'camera-profile.json'
$testOutputPath = Join-Path $outputRoot 'CapturePolicyTests.exe'
$runtimeClosureTestOutputPath = Join-Path $outputRoot 'RuntimeClosureTests.exe'
$buildReceiptPath = Join-Path $outputRoot 'build-receipt.json'
$runtimeClosureOutputPath = Join-Path $outputRoot 'runtime-closure-lock.json'

function Resolve-AbsolutePath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [IO.Path]::GetFullPath($Path)
}

function Assert-FileReceipt {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][long]$ExpectedByteLength,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256
    )

    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    if ($item.Length -ne $ExpectedByteLength) {
        throw "Byte-length drift for $Path. Expected $ExpectedByteLength, found $($item.Length)."
    }

    $actualSha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if ($actualSha256 -cne $ExpectedSha256.ToUpperInvariant()) {
        throw "SHA-256 drift for $Path. Expected $ExpectedSha256, found $actualSha256."
    }
}

function Find-RoslynCompiler {
    $candidates = @(
        'C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\Roslyn\csc.exe',
        'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe'
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    throw 'A local Roslyn csc.exe was not found. No network fallback is permitted.'
}

function New-RuntimeClosureLock {
    param(
        [Parameter(Mandatory = $true)][string]$EditorRoot,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )

    $root = Resolve-AbsolutePath $EditorRoot
    $excludedRoot = 'Modules\Venviewer Native Capture'
    $allEntries = Get-ChildItem -LiteralPath $root -Recurse -Force
    $reparse = $allEntries | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }
    if ($reparse) {
        throw "The vendor editor closure contains a reparse point: $($reparse[0].FullName)"
    }

    $members = @($allEntries |
        Where-Object { -not $_.PSIsContainer } |
        ForEach-Object {
            $relativePath = $_.FullName.Substring($root.Length + 1)
            if ($relativePath -eq $excludedRoot -or $relativePath.StartsWith(
                $excludedRoot + [IO.Path]::DirectorySeparatorChar,
                [StringComparison]::OrdinalIgnoreCase)) {
                return
            }

            [pscustomobject][ordered]@{
                relativePath = $relativePath
                byteLength = [long]$_.Length
                sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
            }
        })
    $memberList = [Collections.Generic.List[object]]::new()
    foreach ($member in $members) {
        $memberList.Add($member)
    }
    $memberComparison = [Comparison[object]]{
        param($left, $right)
        [StringComparer]::Ordinal.Compare([string]$left.relativePath, [string]$right.relativePath)
    }
    $memberList.Sort($memberComparison)
    $members = @($memberList)

    $inventoryBuilder = [Text.StringBuilder]::new()
    [long]$totalByteLength = 0
    foreach ($member in $members) {
        [void]$inventoryBuilder.Append([string]$member.relativePath)
        [void]$inventoryBuilder.Append('|')
        [void]$inventoryBuilder.Append(([long]$member.byteLength).ToString([Globalization.CultureInfo]::InvariantCulture))
        [void]$inventoryBuilder.Append('|')
        [void]$inventoryBuilder.Append(([string]$member.sha256).ToUpperInvariant())
        [void]$inventoryBuilder.Append("`n")
        $totalByteLength += [long]$member.byteLength
    }

    $inventoryBytes = [Text.Encoding]::UTF8.GetBytes($inventoryBuilder.ToString())
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $inventorySha256 = [Convert]::ToHexString($sha.ComputeHash($inventoryBytes))
    }
    finally {
        $sha.Dispose()
    }

    $enabledStockModules = @(Get-ChildItem -LiteralPath (Join-Path $root 'Modules') -Recurse -Filter plugin.json -File |
        ForEach-Object {
            $pluginDocument = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
            if ([bool]$pluginDocument.Enabled) {
                [pscustomobject]@{
                    id = [string]$pluginDocument.Id
                    root = $_.Directory.FullName.Substring($root.Length + 1)
                }
            }
        } |
        Sort-Object -Property id -CaseSensitive)

    $document = [ordered]@{
        schemaVersion = 'venviewer.grand-hall.lcc-native-runtime-closure-lock.v1'
        sourceEditorRoot = $root
        selectionPolicy = 'Every regular file recursively beneath the editor root, excluding only the first-party module directory.'
        excludedRelativeRoots = @($excludedRoot)
        enabledStockModuleIds = @($enabledStockModules | ForEach-Object { $_.id })
        enabledStockModuleRoots = @($enabledStockModules | ForEach-Object { $_.root })
        inventorySha256 = $inventorySha256
        memberCount = $members.Count
        totalByteLength = $totalByteLength
        members = $members
        limitations = @(
            'This bounded closure covers regular files in the disposable editor tree, including Unity data, native plugins, Mono runtime files, and every enabled stock module file.',
            'It does not close over the GPU driver, operating system, firmware, CodeMeter service, external per-user configuration, or dynamically generated process state.'
        )
    }

    $json = $document | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($OutputPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

$resolvedModuleRoot = Resolve-AbsolutePath $moduleRoot
$resolvedOutputRoot = Resolve-AbsolutePath $outputRoot
if (-not $resolvedOutputRoot.StartsWith($resolvedModuleRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The build output escaped the first-party module folder.'
}

$vendorLock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
foreach ($file in $vendorLock.files) {
    $relativePath = [string]$file.relativePath -replace '/', [IO.Path]::DirectorySeparatorChar
    $absolutePath = Join-Path $LccEditorRoot $relativePath
    Assert-FileReceipt -Path $absolutePath -ExpectedByteLength ([long]$file.byteLength) -ExpectedSha256 ([string]$file.sha256)
}
foreach ($file in $vendorLock.externalFiles) {
    Assert-FileReceipt -Path ([string]$file.absolutePath) -ExpectedByteLength ([long]$file.byteLength) -ExpectedSha256 ([string]$file.sha256)
}

if (-not (Test-Path -LiteralPath $outputRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $outputRoot | Out-Null
}
foreach ($generatedPath in @($moduleOutputPath, $cameraProfileOutputPath, $testOutputPath, $runtimeClosureTestOutputPath, $buildReceiptPath, $runtimeClosureOutputPath)) {
    if (Test-Path -LiteralPath $generatedPath -PathType Leaf) {
        Remove-Item -LiteralPath $generatedPath -Force
    }
}

New-RuntimeClosureLock -EditorRoot $LccEditorRoot -OutputPath $runtimeClosureOutputPath
Assert-FileReceipt `
    -Path $cameraProfileSourcePath `
    -ExpectedByteLength 2136 `
    -ExpectedSha256 '9ECA9B6582B7301EC1C059B1A5BE699E5A4983773AFECB2BEEA46C2668305922'
Copy-Item -LiteralPath $cameraProfileSourcePath -Destination $cameraProfileOutputPath

$compiler = Find-RoslynCompiler
$compilerVersion = (Get-Item -LiteralPath $compiler).VersionInfo.FileVersion
$compilerSha256 = (Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash
$expectedCompilerSha256 = 'F895C265B8FA8ED9601F6D8EC87D1E2079F5E851C70D0719A90007564AE8F6AB'
$lockedCompilerPath = Resolve-AbsolutePath ([string]$vendorLock.compiler.absolutePath)
if ((Resolve-AbsolutePath $compiler) -cne $lockedCompilerPath) {
    throw "Roslyn compiler path drift. Expected $lockedCompilerPath, found $compiler."
}
if ([string]$vendorLock.compiler.sha256 -cne $expectedCompilerSha256) {
    throw 'The vendor lock no longer contains the reviewed Roslyn compiler SHA-256.'
}
Assert-FileReceipt `
    -Path $compiler `
    -ExpectedByteLength ([long]$vendorLock.compiler.byteLength) `
    -ExpectedSha256 $expectedCompilerSha256
if ($compilerVersion -cne [string]$vendorLock.compiler.fileVersion) {
    throw "Roslyn compiler version drift. Expected $($vendorLock.compiler.fileVersion), found $compilerVersion."
}
$capturePolicyPath = Join-Path $sourceRoot 'CapturePolicy.cs'
$receiptModelsPath = Join-Path $sourceRoot 'ReceiptModels.cs'
$moduleSourcePath = Join-Path $sourceRoot 'NativeCaptureModule.cs'
$runtimeClosureSourcePath = Join-Path $sourceRoot 'RuntimeClosurePolicy.cs'
$cameraProfileSourceCodePath = Join-Path $sourceRoot 'FixedCameraProfile.cs'
$testSourcePath = Join-Path $testRoot 'CapturePolicyTests.cs'
$runtimeClosureTestSourcePath = Join-Path $testRoot 'RuntimeClosureTests.cs'

$commonCompilerArguments = @(
    '/nologo',
    '/utf8output',
    '/langversion:7.3',
    '/checked+',
    '/deterministic+',
    '/optimize+',
    '/warnaserror+',
    '/debug-'
)

$managedRoot = Join-Path $LccEditorRoot 'LCCEditor_Data\Managed'
$newtonsoftReference = '/reference:' + (Join-Path $managedRoot 'Newtonsoft.Json.dll')
$netstandardReference = '/reference:' + (Join-Path $managedRoot 'netstandard.dll')
& $compiler @commonCompilerArguments '/nowarn:0649' '/target:exe' "/out:$testOutputPath" $newtonsoftReference $netstandardReference $capturePolicyPath $cameraProfileSourceCodePath $receiptModelsPath $testSourcePath
if ($LASTEXITCODE -ne 0) {
    throw "Capture policy test compilation failed with exit code $LASTEXITCODE."
}

if ($SkipLiveSourceVerification) {
    & $testOutputPath $cameraProfileSourcePath (Join-Path $managedRoot 'Newtonsoft.Json.dll')
}
else {
    & $testOutputPath $cameraProfileSourcePath (Join-Path $managedRoot 'Newtonsoft.Json.dll') '--live'
}
if ($LASTEXITCODE -ne 0) {
    throw "Capture policy tests failed with exit code $LASTEXITCODE."
}

$references = @(
    'LCCWorld.dll',
    'LCCSDK.dll',
    'UnityEngine.dll',
    'UnityEngine.CoreModule.dll',
    'UnityEngine.ImageConversionModule.dll',
    'UnityEngine.UIModule.dll',
    'Unity.RenderPipelines.Core.Runtime.dll',
    'Unity.RenderPipelines.Universal.Runtime.dll',
    'Unity.RenderPipelines.GPUDriven.Runtime.dll',
    'UniTask.dll',
    'Cinemachine.dll',
    'Newtonsoft.Json.dll',
    'USD.NET.Unity.dll',
    'USD.NET.dll',
    'netstandard.dll'
) | ForEach-Object { '/reference:' + (Join-Path $managedRoot $_) }

$unityProfileReferences = @(
    'mscorlib.dll',
    'System.dll',
    'System.Core.dll',
    'System.Memory.dll'
) | ForEach-Object { '/reference:' + (Join-Path $managedRoot $_) }

& $compiler @commonCompilerArguments '/nowarn:0649' '/target:exe' "/out:$runtimeClosureTestOutputPath" @references $capturePolicyPath $receiptModelsPath $runtimeClosureSourcePath $runtimeClosureTestSourcePath
if ($LASTEXITCODE -ne 0) {
    throw "Runtime closure test compilation failed with exit code $LASTEXITCODE."
}

$runtimeClosureSha256 = (Get-FileHash -LiteralPath $runtimeClosureOutputPath -Algorithm SHA256).Hash
& $runtimeClosureTestOutputPath $LccEditorRoot $managedRoot $runtimeClosureOutputPath $runtimeClosureSha256
if ($LASTEXITCODE -ne 0) {
    throw "Runtime closure tests failed with exit code $LASTEXITCODE."
}

& $compiler @commonCompilerArguments '/nostdlib+' '/target:library' "/out:$moduleOutputPath" @unityProfileReferences @references $capturePolicyPath $cameraProfileSourceCodePath $receiptModelsPath $runtimeClosureSourcePath $moduleSourcePath
if ($LASTEXITCODE -ne 0) {
    throw "Native capture module compilation failed with exit code $LASTEXITCODE."
}

$sourceReceipts = @(
    $capturePolicyPath,
    $cameraProfileSourceCodePath,
    $cameraProfileSourcePath,
    $receiptModelsPath,
    $moduleSourcePath,
    $runtimeClosureSourcePath,
    $testSourcePath,
    $runtimeClosureTestSourcePath,
    $pluginPath,
    $lockPath,
    (Join-Path $moduleRoot 'build.ps1'),
    (Join-Path $moduleRoot 'run-capture.ps1'),
    (Join-Path $moduleRoot 'verify.ps1'),
    (Join-Path $moduleRoot 'README.md')
) |
    Sort-Object |
    ForEach-Object {
        $item = Get-Item -LiteralPath $_
        [ordered]@{
            path = $item.FullName
            byteLength = $item.Length
            sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
        }
    }

$moduleItem = Get-Item -LiteralPath $moduleOutputPath
$pluginItem = Get-Item -LiteralPath $pluginPath
$runtimeClosureItem = Get-Item -LiteralPath $runtimeClosureOutputPath
$cameraProfileItem = Get-Item -LiteralPath $cameraProfileOutputPath
$buildReceipt = [ordered]@{
    schemaVersion = 'venviewer.grand-hall.lcc-native-capture-build-receipt.v1'
    builtAtUtc = [DateTime]::UtcNow.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
    networkUsed = $false
    vendorBinariesCopiedIntoRepository = $false
    lccEditorRoot = (Resolve-AbsolutePath $LccEditorRoot)
    compiler = [ordered]@{
        path = $compiler
        fileVersion = $compilerVersion
        sha256 = $compilerSha256
    }
    module = [ordered]@{
        path = $moduleItem.FullName
        byteLength = $moduleItem.Length
        sha256 = (Get-FileHash -LiteralPath $moduleItem.FullName -Algorithm SHA256).Hash
    }
    pluginManifest = [ordered]@{
        path = $pluginItem.FullName
        byteLength = $pluginItem.Length
        sha256 = (Get-FileHash -LiteralPath $pluginItem.FullName -Algorithm SHA256).Hash
    }
    cameraProfile = [ordered]@{
        path = $cameraProfileItem.FullName
        byteLength = $cameraProfileItem.Length
        sha256 = (Get-FileHash -LiteralPath $cameraProfileItem.FullName -Algorithm SHA256).Hash
    }
    runtimeClosureLock = [ordered]@{
        path = $runtimeClosureItem.FullName
        byteLength = $runtimeClosureItem.Length
        sha256 = (Get-FileHash -LiteralPath $runtimeClosureItem.FullName -Algorithm SHA256).Hash
        inventorySha256 = (Get-Content -LiteralPath $runtimeClosureOutputPath -Raw | ConvertFrom-Json).inventorySha256
        memberCount = (Get-Content -LiteralPath $runtimeClosureOutputPath -Raw | ConvertFrom-Json).memberCount
    }
    tests = [ordered]@{
        executable = $testOutputPath
        runtimeClosureExecutable = $runtimeClosureTestOutputPath
        liveCanonicalPackageVerified = -not $SkipLiveSourceVerification.IsPresent
        runtimeClosureVerified = $true
        passed = $true
    }
    sources = $sourceReceipts
    vendorLockSha256 = (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash
}

$json = $buildReceipt | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($buildReceiptPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

& (Join-Path $moduleRoot 'verify.ps1') -LccEditorRoot $LccEditorRoot -ModulePath $moduleOutputPath -BuildReceiptPath $buildReceiptPath
if ($LASTEXITCODE -ne 0) {
    throw "Offline verification failed with exit code $LASTEXITCODE."
}

Write-Output "Module: $moduleOutputPath"
Write-Output "Module SHA-256: $((Get-FileHash -LiteralPath $moduleOutputPath -Algorithm SHA256).Hash)"
Write-Output "Plugin SHA-256: $((Get-FileHash -LiteralPath $pluginPath -Algorithm SHA256).Hash)"
Write-Output "Build receipt: $buildReceiptPath"
