[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hardTimeoutSeconds = 900
$scene = [IO.Path]::GetFullPath(
    'C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_9\lcc-result\Grand_Hall.lcc')
$approvedSandboxEditor = [IO.Path]::GetFullPath(
    'C:\Users\blake\AppData\Local\Venviewer\lcc-native-capture-sandbox\lcceditor-0.15.0.7')
$moduleRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$buildReceiptPath = Join-Path $moduleRoot 'out\build-receipt.json'
$outputRoot = [IO.Path]::GetFullPath(
    'C:\Users\blake\AppData\Local\Venviewer\native-captures')
$playerLog = [IO.Path]::GetFullPath(
    'C:\Users\blake\AppData\LocalLow\XGrids\LCCEditor\Player.log')
$environmentVariableNames = @(
    'VENVIEWER_LCC_NATIVE_CAPTURE_ARM',
    'VENVIEWER_LCC_NATIVE_CAPTURE_AUTO_QUIT',
    'VENVIEWER_LCC_NATIVE_CAPTURE_EDITOR_ROOT',
    'VENVIEWER_LCC_NATIVE_CAPTURE_OUTPUT_DIR',
    'VENVIEWER_LCC_NATIVE_CAPTURE_MODULE_SHA256',
    'VENVIEWER_LCC_NATIVE_CAPTURE_PLUGIN_SHA256',
    'VENVIEWER_LCC_NATIVE_CAPTURE_RUNTIME_CLOSURE_SHA256'
)

function Assert-NoReparseAncestor {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $current = [IO.Path]::GetFullPath($Path)
    while (-not (Test-Path -LiteralPath $current)) {
        $parent = [IO.Path]::GetDirectoryName($current)
        if ([string]::IsNullOrEmpty($parent) -or $parent -eq $current) {
            throw "$Label has no existing ancestor: $Path"
        }
        $current = $parent
    }

    while (-not [string]::IsNullOrEmpty($current)) {
        $item = Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "$Label traverses a reparse point: $current"
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ([string]::IsNullOrEmpty($parent) -or $parent -eq $current) {
            break
        }
        $current = $parent
    }
}

function Assert-FileSha256 {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label is missing: $Path"
    }
    if ($ExpectedSha256 -notmatch '^[A-Fa-f0-9]{64}$') {
        throw "$Label has an invalid expected SHA-256 value."
    }
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if ($actual -cne $ExpectedSha256.ToUpperInvariant()) {
        throw "$Label SHA-256 mismatch. Expected $ExpectedSha256, found $actual."
    }
}

function Stop-CaptureProcessTree {
    param([Parameter(Mandatory = $true)][Diagnostics.Process]$Process)

    try {
        if ($Process.HasExited) {
            return $true
        }
    }
    catch {
        return $true
    }

    $taskKill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    try {
        & $taskKill '/PID' ([string]$Process.Id) '/T' '/F' | Out-Null
        $null = $Process.WaitForExit(30000)
    }
    catch {
        try {
            Stop-Process -Id $Process.Id -Force -ErrorAction Stop
            $null = $Process.WaitForExit(30000)
        }
        catch {
            return $false
        }
    }

    try {
        return $Process.HasExited
    }
    catch {
        return $true
    }
}

function Write-OperatorReceipt {
    param(
        [Parameter(Mandatory = $true)][string]$OutputDirectory,
        [Parameter(Mandatory = $true)][string]$Status,
        [Parameter(Mandatory = $true)][string]$Message,
        [Parameter(Mandatory = $true)][string]$StartedAtUtc,
        [AllowNull()][Nullable[int]]$ProcessId,
        [AllowNull()][Nullable[int]]$ExitCode,
        [Parameter(Mandatory = $true)][bool]$TimedOut,
        [Parameter(Mandatory = $true)][bool]$TerminationAttempted,
        [Parameter(Mandatory = $true)][bool]$TerminationSucceeded,
        [Parameter(Mandatory = $true)]$BuildEvidence,
        [AllowNull()][string]$NativeReceiptSha256,
        [AllowNull()][string]$FinalPngSha256
    )

    $finalPath = Join-Path $OutputDirectory 'grand-hall-native-capture-operator-receipt.json'
    if (Test-Path -LiteralPath $finalPath) {
        throw "Operator receipt path already exists: $finalPath"
    }
    $temporaryPath = Join-Path $OutputDirectory (
        '.grand-hall-native-capture-operator-receipt.tmp-' + [Guid]::NewGuid().ToString('N'))
    $receipt = [ordered]@{
        schemaVersion = 'venviewer.grand-hall.lcc-native-capture-operator-receipt.v1'
        authority = 'none'
        status = $Status
        message = $Message
        startedAtUtc = $StartedAtUtc
        completedAtUtc = [DateTime]::UtcNow.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
        hardWallClockTimeoutSeconds = $hardTimeoutSeconds
        timedOut = $TimedOut
        processId = $ProcessId
        exitCode = $ExitCode
        processTreeTerminationAttempted = $TerminationAttempted
        processTreeTerminationSucceeded = $TerminationSucceeded
        buildEvidence = $BuildEvidence
        executable = (Join-Path $approvedSandboxEditor 'LCCEditor.exe')
        canonicalScene = $scene
        outputDirectory = $OutputDirectory
        nativeReceiptSha256 = $NativeReceiptSha256
        finalPngSha256 = $FinalPngSha256
        playerLog = $playerLog
        limitations = @(
            'This operator receipt bounds process lifetime; it is not evidence that the native scene was accepted.',
            'On hard timeout the wrapper terminates the disposable LCCEditor process tree; in-process cleanup may not run.',
            'Player.log is referenced locally and is not copied into the evidence output.'
        )
    }
    try {
        $json = $receipt | ConvertTo-Json -Depth 6
        [IO.File]::WriteAllText(
            $temporaryPath,
            $json + [Environment]::NewLine,
            [Text.UTF8Encoding]::new($false))
        [IO.File]::Move($temporaryPath, $finalPath)
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

if (-not (Test-Path -LiteralPath $buildReceiptPath -PathType Leaf)) {
    throw "The verified build receipt is missing: $buildReceiptPath"
}
if (-not (Test-Path -LiteralPath $scene -PathType Leaf)) {
    throw "The canonical scene is missing: $scene"
}
if (-not (Test-Path -LiteralPath $approvedSandboxEditor -PathType Container)) {
    throw "The exact approved disposable editor is missing: $approvedSandboxEditor"
}

Assert-NoReparseAncestor -Path $moduleRoot -Label 'first-party module root'
Assert-NoReparseAncestor -Path $scene -Label 'canonical scene'
Assert-NoReparseAncestor -Path $approvedSandboxEditor -Label 'disposable editor'
Assert-NoReparseAncestor -Path $outputRoot -Label 'capture output root'

$buildReceipt = Get-Content -LiteralPath $buildReceiptPath -Raw | ConvertFrom-Json
if ([string]$buildReceipt.schemaVersion -cne 'venviewer.grand-hall.lcc-native-capture-build-receipt.v1') {
    throw 'The build receipt schema is not the reviewed native-capture schema.'
}
if ([bool]$buildReceipt.networkUsed -ne $false) {
    throw 'The build receipt does not prove an offline build.'
}
if ([bool]$buildReceipt.vendorBinariesCopiedIntoRepository -ne $false) {
    throw 'The build receipt reports that a vendor binary entered the first-party repository.'
}
if ([bool]$buildReceipt.tests.liveCanonicalPackageVerified -ne $true -or
    [bool]$buildReceipt.tests.runtimeClosureVerified -ne $true -or
    [bool]$buildReceipt.tests.passed -ne $true) {
    throw 'The build receipt does not report every required offline verification as passed.'
}
$buildReceiptSha256 = (Get-FileHash -LiteralPath $buildReceiptPath -Algorithm SHA256).Hash
$buildEvidence = [ordered]@{
    buildReceiptPath = $buildReceiptPath
    buildReceiptSha256 = $buildReceiptSha256
    schemaVersion = [string]$buildReceipt.schemaVersion
    networkUsed = [bool]$buildReceipt.networkUsed
    vendorBinariesCopiedIntoRepository = [bool]$buildReceipt.vendorBinariesCopiedIntoRepository
    tests = [ordered]@{
        liveCanonicalPackageVerified = [bool]$buildReceipt.tests.liveCanonicalPackageVerified
        runtimeClosureVerified = [bool]$buildReceipt.tests.runtimeClosureVerified
        passed = [bool]$buildReceipt.tests.passed
    }
    moduleSha256 = ([string]$buildReceipt.module.sha256).ToUpperInvariant()
    pluginManifestSha256 = ([string]$buildReceipt.pluginManifest.sha256).ToUpperInvariant()
    runtimeClosureLockSha256 = ([string]$buildReceipt.runtimeClosureLock.sha256).ToUpperInvariant()
    runtimeClosureInventorySha256 = ([string]$buildReceipt.runtimeClosureLock.inventorySha256).ToUpperInvariant()
}
$moduleDestination = Join-Path $approvedSandboxEditor 'Modules\Venviewer Native Capture'
$installedModule = Join-Path $moduleDestination 'VenviewerNativeCapture.dll'
$installedPlugin = Join-Path $moduleDestination 'plugin.json'
$installedClosureLock = Join-Path $moduleDestination 'runtime-closure-lock.json'
Assert-FileSha256 -Path $installedModule -ExpectedSha256 ([string]$buildReceipt.module.sha256) -Label 'installed first-party module'
Assert-FileSha256 -Path $installedPlugin -ExpectedSha256 ([string]$buildReceipt.pluginManifest.sha256) -Label 'installed plugin manifest'
Assert-FileSha256 -Path $installedClosureLock -ExpectedSha256 ([string]$buildReceipt.runtimeClosureLock.sha256) -Label 'installed runtime closure lock'
$installedClosureDocument = Get-Content -LiteralPath $installedClosureLock -Raw | ConvertFrom-Json
if ([string]$installedClosureDocument.schemaVersion -cne
    'venviewer.grand-hall.lcc-native-runtime-closure-lock.v1' -or
    [string]$installedClosureDocument.inventorySha256 -cne
        ([string]$buildReceipt.runtimeClosureLock.inventorySha256).ToUpperInvariant() -or
    [int]$installedClosureDocument.memberCount -ne [int]$buildReceipt.runtimeClosureLock.memberCount) {
    throw 'The installed runtime closure lock does not agree with the reviewed build receipt.'
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$output = Join-Path $outputRoot (
    'grand-hall-gh9-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' +
    [Guid]::NewGuid().ToString('N').Substring(0, 8))
if (Test-Path -LiteralPath $output) {
    throw "Capture output already exists: $output"
}
New-Item -ItemType Directory -Path $output | Out-Null
Assert-NoReparseAncestor -Path $output -Label 'capture output directory'

$priorEnvironment = @{}
foreach ($name in $environmentVariableNames) {
    $priorEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$startedAtUtc = [DateTime]::UtcNow.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
$captureProcess = $null
$processId = $null
$exitCode = $null
$timedOut = $false
$terminationAttempted = $false
$terminationSucceeded = $true
$status = 'failure'
$message = 'The native capture process did not start.'
$failureException = $null
$nativeReceiptSha256 = $null
$finalPngSha256 = $null

try {
    [Environment]::SetEnvironmentVariable(
        'VENVIEWER_LCC_NATIVE_CAPTURE_ARM',
        'CANONICAL_GH9_NATIVE_CAPTURE_V1',
        'Process')
    [Environment]::SetEnvironmentVariable('VENVIEWER_LCC_NATIVE_CAPTURE_AUTO_QUIT', '1', 'Process')
    [Environment]::SetEnvironmentVariable(
        'VENVIEWER_LCC_NATIVE_CAPTURE_EDITOR_ROOT',
        $approvedSandboxEditor,
        'Process')
    [Environment]::SetEnvironmentVariable('VENVIEWER_LCC_NATIVE_CAPTURE_OUTPUT_DIR', $output, 'Process')
    [Environment]::SetEnvironmentVariable(
        'VENVIEWER_LCC_NATIVE_CAPTURE_MODULE_SHA256',
        [string]$buildReceipt.module.sha256,
        'Process')
    [Environment]::SetEnvironmentVariable(
        'VENVIEWER_LCC_NATIVE_CAPTURE_PLUGIN_SHA256',
        [string]$buildReceipt.pluginManifest.sha256,
        'Process')
    [Environment]::SetEnvironmentVariable(
        'VENVIEWER_LCC_NATIVE_CAPTURE_RUNTIME_CLOSURE_SHA256',
        [string]$buildReceipt.runtimeClosureLock.sha256,
        'Process')

    $executable = Join-Path $approvedSandboxEditor 'LCCEditor.exe'
    $captureProcess = Start-Process `
        -FilePath $executable `
        -WorkingDirectory $approvedSandboxEditor `
        -ArgumentList @($scene, '-screen-width', '1600', '-screen-height', '900', '-screen-fullscreen', '0') `
        -WindowStyle Hidden `
        -PassThru
    $processId = $captureProcess.Id

    if (-not $captureProcess.WaitForExit($hardTimeoutSeconds * 1000)) {
        $timedOut = $true
        $status = 'timeout'
        $message = "The native capture exceeded the $hardTimeoutSeconds-second hard wall-clock timeout."
        $terminationAttempted = $true
        $terminationSucceeded = Stop-CaptureProcessTree -Process $captureProcess
        throw $message
    }

    $exitCode = $captureProcess.ExitCode
    if ($exitCode -ne 0) {
        throw "LCCEditor exited with code $exitCode."
    }

    $nativeReceiptPath = Join-Path $output 'grand-hall-native-capture-receipt.json'
    $finalPngPath = Join-Path $output 'grand-hall-native-capture-1600x900.png'
    $nativeReceiptSidecar = $nativeReceiptPath + '.sha256'
    foreach ($requiredOutput in @($nativeReceiptPath, $nativeReceiptSidecar, $finalPngPath)) {
        if (-not (Test-Path -LiteralPath $requiredOutput -PathType Leaf)) {
            throw "A required native success artifact is missing: $requiredOutput"
        }
    }

    $nativeReceipt = Get-Content -LiteralPath $nativeReceiptPath -Raw | ConvertFrom-Json
    if ([string]$nativeReceipt.status -cne 'success') {
        throw "The native receipt did not report success: $nativeReceiptPath"
    }
    $nativeReceiptSha256 = (Get-FileHash -LiteralPath $nativeReceiptPath -Algorithm SHA256).Hash
    $expectedSidecar = $nativeReceiptSha256 + '  ' +
        [IO.Path]::GetFileName($nativeReceiptPath) + [Environment]::NewLine
    $actualSidecar = Get-Content -LiteralPath $nativeReceiptSidecar -Raw
    if ($actualSidecar -cne $expectedSidecar) {
        throw 'The native receipt SHA-256 sidecar content does not match the computed receipt hash.'
    }
    $finalPngSha256 = (Get-FileHash -LiteralPath $finalPngPath -Algorithm SHA256).Hash
    if ($finalPngSha256 -cne ([string]$nativeReceipt.capture.finalPngSha256).ToUpperInvariant()) {
        throw 'The final PNG SHA-256 does not match the native receipt.'
    }

    $status = 'success'
    $message = 'The bounded native capture process completed and its required artifacts agree.'
}
catch {
    $failureException = $_.Exception
    if (-not $timedOut) {
        $status = 'failure'
        $message = $_.Exception.Message
    }
}
finally {
    if ($null -ne $captureProcess) {
        $stillRunning = $false
        try {
            $stillRunning = -not $captureProcess.HasExited
        }
        catch {
            $stillRunning = $false
        }
        if ($stillRunning) {
            $terminationAttempted = $true
            $terminationSucceeded = Stop-CaptureProcessTree -Process $captureProcess
            if (-not $terminationSucceeded) {
                $status = 'failure'
                $message += ' The disposable editor process tree could not be confirmed terminated.'
            }
        }
        try {
            if ($captureProcess.HasExited) {
                $exitCode = $captureProcess.ExitCode
            }
        }
        catch {
            $exitCode = $null
        }
        $captureProcess.Dispose()
    }

    foreach ($name in $environmentVariableNames) {
        [Environment]::SetEnvironmentVariable($name, $priorEnvironment[$name], 'Process')
    }

    Write-OperatorReceipt `
        -OutputDirectory $output `
        -Status $status `
        -Message $message `
        -StartedAtUtc $startedAtUtc `
        -ProcessId $processId `
        -ExitCode $exitCode `
        -TimedOut $timedOut `
        -TerminationAttempted $terminationAttempted `
        -TerminationSucceeded $terminationSucceeded `
        -BuildEvidence $buildEvidence `
        -NativeReceiptSha256 $nativeReceiptSha256 `
        -FinalPngSha256 $finalPngSha256
}

if ($status -cne 'success') {
    throw [InvalidOperationException]::new(
        "$message Operator receipt: $output\grand-hall-native-capture-operator-receipt.json",
        $failureException)
}

Write-Output "Native capture output: $output"
Write-Output "Operator receipt: $output\grand-hall-native-capture-operator-receipt.json"
