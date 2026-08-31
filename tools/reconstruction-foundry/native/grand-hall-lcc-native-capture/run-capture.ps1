[CmdletBinding()]
param(
    [switch]$LeaseSelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hardTimeoutSeconds = 900
$scene = [IO.Path]::GetFullPath(
    'C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_1\lcc2-result\Grand_Hall.lcc2')
$approvedSandboxEditor = [IO.Path]::GetFullPath(
    'C:\Users\blake\AppData\Local\Venviewer\lcc-native-capture-sandbox\lcceditor-0.15.0.7')
$moduleRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$buildReceiptPath = Join-Path $moduleRoot 'out\build-receipt.json'
$outputRoot = [IO.Path]::GetFullPath(
    'C:\Users\blake\AppData\Local\Venviewer\native-captures')
$playerLog = [IO.Path]::GetFullPath(
    'C:\Users\blake\AppData\LocalLow\XGrids\LCCEditor\Player.log')
$featureTogglePath = [IO.Path]::GetFullPath(
    'C:\Users\blake\AppData\LocalLow\XGrids\LCCEditor\feature_toggles\module_toggles.dat')
$featureToggleDirectory = [IO.Path]::GetDirectoryName($featureTogglePath)
$featureToggleBackupPath = Join-Path $featureToggleDirectory (
    '.module_toggles.dat.venviewer-native-capture.original')
$featureToggleLeasePath = Join-Path $featureToggleDirectory (
    '.module_toggles.dat.venviewer-native-capture.lease.json')
$expectedOriginalFeatureToggleSha256 = '8FF16CAC30F3F49A71BE9A06D486B1BB9B682E0CCF1C5C35869A251D98313531'
$encryptUtilAssemblyPath = [IO.Path]::GetFullPath(
    'F:\LccStudio\lcceditor\LCCEditor_Data\Managed\LCCWorld.Common.dll')
$encryptUtilAssemblySha256 = 'CC166D8396D462A1EE27C308855DDADF7010E58FD185276D78645490A747EFC2'
$featureToggleModuleId = 'com.venviewer.native_capture'
$environmentVariableNames = @(
    'VENVIEWER_LCC_NATIVE_CAPTURE_ARM',
    'VENVIEWER_LCC_NATIVE_CAPTURE_AUTO_QUIT',
    'VENVIEWER_LCC_NATIVE_CAPTURE_EDITOR_ROOT',
    'VENVIEWER_LCC_NATIVE_CAPTURE_OUTPUT_DIR',
    'VENVIEWER_LCC_NATIVE_CAPTURE_MODULE_SHA256',
    'VENVIEWER_LCC_NATIVE_CAPTURE_PLUGIN_SHA256',
    'VENVIEWER_LCC_NATIVE_CAPTURE_RUNTIME_CLOSURE_SHA256',
    'VENVIEWER_LCC_NATIVE_CAPTURE_CAMERA_PROFILE_SHA256'
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

function Get-Sha256HexFromBytes {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)

    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        return [Convert]::ToHexString($sha256.ComputeHash($Bytes))
    }
    finally {
        $sha256.Dispose()
    }
}

function Write-DurableNewFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][byte[]]$Bytes
    )

    $stream = [IO.FileStream]::new(
        $Path,
        [IO.FileMode]::CreateNew,
        [IO.FileAccess]::Write,
        [IO.FileShare]::None,
        4096,
        [IO.FileOptions]::WriteThrough)
    try {
        $stream.Write($Bytes, 0, $Bytes.Length)
        $stream.Flush($true)
    }
    finally {
        $stream.Dispose()
    }
}

function Write-DurableReplacement {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][byte[]]$Bytes
    )

    $directory = [IO.Path]::GetDirectoryName($Path)
    $temporaryPath = Join-Path $directory (
        '.' + [IO.Path]::GetFileName($Path) + '.venviewer-native-capture.tmp-' +
        [Guid]::NewGuid().ToString('N'))
    $displacedPath = Join-Path $directory (
        '.' + [IO.Path]::GetFileName($Path) + '.venviewer-native-capture.displaced-' +
        [Guid]::NewGuid().ToString('N'))
    try {
        Write-DurableNewFile -Path $temporaryPath -Bytes $Bytes
        [IO.File]::Replace($temporaryPath, $Path, $displacedPath)
        if (Test-Path -LiteralPath $displacedPath -PathType Leaf) {
            Remove-Item -LiteralPath $displacedPath -Force
        }
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
        if (Test-Path -LiteralPath $displacedPath -PathType Leaf) {
            Remove-Item -LiteralPath $displacedPath -Force
        }
    }
}

function Get-FileMetadataReceipt {
    param([Parameter(Mandatory = $true)][string]$Path)

    $item = Get-Item -LiteralPath $Path -Force
    return [ordered]@{
        creationTimeUtcTicks = $item.CreationTimeUtc.Ticks
        lastWriteTimeUtcTicks = $item.LastWriteTimeUtc.Ticks
        lastAccessTimeUtcTicks = $item.LastAccessTimeUtc.Ticks
        attributes = [int]$item.Attributes
    }
}

function Set-ExactFileMetadata {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Metadata
    )

    [IO.File]::SetAttributes($Path, [IO.FileAttributes]::Normal)
    [IO.File]::SetCreationTimeUtc($Path, [DateTime]::new([long]$Metadata.creationTimeUtcTicks, [DateTimeKind]::Utc))
    [IO.File]::SetLastWriteTimeUtc($Path, [DateTime]::new([long]$Metadata.lastWriteTimeUtcTicks, [DateTimeKind]::Utc))
    [IO.File]::SetLastAccessTimeUtc($Path, [DateTime]::new([long]$Metadata.lastAccessTimeUtcTicks, [DateTimeKind]::Utc))
    [IO.File]::SetAttributes($Path, [IO.FileAttributes][int]$Metadata.attributes)
}

function Test-FileMetadataEqual {
    param(
        [Parameter(Mandatory = $true)]$Expected,
        [Parameter(Mandatory = $true)]$Actual
    )

    return [long]$Expected.creationTimeUtcTicks -eq [long]$Actual.creationTimeUtcTicks -and
        [long]$Expected.lastWriteTimeUtcTicks -eq [long]$Actual.lastWriteTimeUtcTicks -and
        [long]$Expected.lastAccessTimeUtcTicks -eq [long]$Actual.lastAccessTimeUtcTicks -and
        [int]$Expected.attributes -eq [int]$Actual.attributes
}

function Get-LccEditorProcesses {
    return @(Get-Process -Name 'LCCEditor' -ErrorAction SilentlyContinue)
}

function Assert-NoLccEditorProcess {
    $processes = @(Get-LccEditorProcesses)
    if ($processes.Count -ne 0) {
        $ids = ($processes | ForEach-Object { [string]$_.Id }) -join ', '
        throw "The per-user feature-toggle lease requires no running LCCEditor process. Found PID(s): $ids."
    }
}

function Get-EncryptUtilType {
    Assert-FileSha256 `
        -Path $encryptUtilAssemblyPath `
        -ExpectedSha256 $encryptUtilAssemblySha256 `
        -Label 'installed public EncryptUtil assembly'
    $assembly = [Reflection.Assembly]::LoadFrom($encryptUtilAssemblyPath)
    $type = $assembly.GetType('XGrids.LCCWorld.Common.Utils.EncryptUtil', $true)
    foreach ($methodName in @('DecryptFromHex', 'EncryptToHex')) {
        $method = $type.GetMethod($methodName, [Reflection.BindingFlags]'Public,Static')
        if ($null -eq $method) {
            throw "The installed public EncryptUtil.$methodName method is unavailable."
        }
    }
    return $type
}

function Invoke-EncryptUtil {
    param(
        [Parameter(Mandatory = $true)][Type]$EncryptUtilType,
        [Parameter(Mandatory = $true)][ValidateSet('DecryptFromHex', 'EncryptToHex')][string]$Method,
        [Parameter(Mandatory = $true)][string]$Value
    )

    $methodInfo = $EncryptUtilType.GetMethod($Method, [Reflection.BindingFlags]'Public,Static')
    return [string]$methodInfo.Invoke($null, [object[]]@($Value, 'xgrids'))
}

function Assert-OnlyNativeCaptureToggleAdded {
    param(
        [Parameter(Mandatory = $true)]$OriginalConfig,
        [Parameter(Mandatory = $true)]$AugmentedConfig
    )

    $original = @($OriginalConfig.toggles)
    $augmented = @($AugmentedConfig.toggles)
    if ($augmented.Count -ne $original.Count + 1) {
        throw 'The augmented feature-toggle config must contain exactly one additional entry.'
    }
    for ($index = 0; $index -lt $original.Count; $index += 1) {
        if ([string]$original[$index].module_id -cne [string]$augmented[$index].module_id -or
            [string]$original[$index].module_name -cne [string]$augmented[$index].module_name -or
            [int]$original[$index].enabled -ne [int]$augmented[$index].enabled) {
            throw "A stock feature-toggle entry changed at ordinal $index."
        }
    }

    $added = $augmented[$augmented.Count - 1]
    if ([string]$added.module_id -cne $featureToggleModuleId -or [int]$added.enabled -ne 1) {
        throw 'The sole added feature toggle is not com.venviewer.native_capture enabled=1.'
    }
    if (@($augmented | Where-Object { [string]$_.module_id -ceq $featureToggleModuleId }).Count -ne 1) {
        throw 'The native-capture feature-toggle entry is missing or duplicated.'
    }
}

function Write-FeatureToggleLeaseMarker {
    param(
        [Parameter(Mandatory = $true)]$Marker,
        [Parameter(Mandatory = $true)][bool]$Replace
    )

    $json = $Marker | ConvertTo-Json -Depth 8
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json + [Environment]::NewLine)
    if ($Replace) {
        Write-DurableReplacement -Path $featureToggleLeasePath -Bytes $bytes
    }
    else {
        Write-DurableNewFile -Path $featureToggleLeasePath -Bytes $bytes
    }
}

function Remove-OwnedFeatureToggleTemporaryFiles {
    Get-ChildItem -LiteralPath $featureToggleDirectory -File -Force |
        Where-Object {
            ($_.Name.IndexOf('.venviewer-native-capture.tmp-', [StringComparison]::Ordinal) -ge 0 -or
                $_.Name.IndexOf('.venviewer-native-capture.displaced-', [StringComparison]::Ordinal) -ge 0) -and
            $_.FullName -cne $featureToggleBackupPath -and
            $_.FullName -cne $featureToggleLeasePath
        } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
}

function Restore-FeatureToggleLease {
    param([Parameter(Mandatory = $true)]$Evidence)

    $Evidence.restoreAttempted = $true
    Assert-NoLccEditorProcess
    if (-not (Test-Path -LiteralPath $featureToggleBackupPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $featureToggleLeasePath -PathType Leaf)) {
        throw 'The durable feature-toggle backup or lease marker is missing during restoration.'
    }

    $marker = Get-Content -LiteralPath $featureToggleLeasePath -Raw | ConvertFrom-Json
    if ([string]$marker.schemaVersion -cne 'venviewer.lcc-native-capture-feature-toggle-lease.v1' -or
        [string]$marker.targetPath -cne $featureTogglePath -or
        [string]$marker.backupPath -cne $featureToggleBackupPath -or
        [string]$marker.originalSha256 -cne $expectedOriginalFeatureToggleSha256) {
        throw 'The durable feature-toggle lease marker is not the expected recovery contract.'
    }

    $originalBytes = [IO.File]::ReadAllBytes($featureToggleBackupPath)
    $backupSha256 = Get-Sha256HexFromBytes -Bytes $originalBytes
    if ($backupSha256 -cne $expectedOriginalFeatureToggleSha256) {
        throw "The durable feature-toggle backup hash drifted: $backupSha256."
    }

    $Evidence.preRestoreSha256 = if (Test-Path -LiteralPath $featureTogglePath -PathType Leaf) {
        Get-Sha256HexFromBytes -Bytes ([IO.File]::ReadAllBytes($featureTogglePath))
    }
    else {
        $null
    }
    $allowedPreRestoreHashes = @($expectedOriginalFeatureToggleSha256)
    if ([string]$marker.augmentedSha256 -match '^[A-F0-9]{64}$') {
        $allowedPreRestoreHashes += [string]$marker.augmentedSha256
    }
    $Evidence.preRestoreExpectedHashes = $allowedPreRestoreHashes
    $Evidence.preRestoreTargetMatchedLease = $allowedPreRestoreHashes -ccontains
        [string]$Evidence.preRestoreSha256
    Assert-NoLccEditorProcess
    Write-DurableReplacement -Path $featureTogglePath -Bytes $originalBytes
    $restoredBytes = [IO.File]::ReadAllBytes($featureTogglePath)
    $restoredSha256 = Get-Sha256HexFromBytes -Bytes $restoredBytes
    Set-ExactFileMetadata -Path $featureTogglePath -Metadata $marker.originalMetadata
    $restoredMetadata = Get-FileMetadataReceipt -Path $featureTogglePath
    $metadataExact = Test-FileMetadataEqual -Expected $marker.originalMetadata -Actual $restoredMetadata
    if ($restoredSha256 -cne $expectedOriginalFeatureToggleSha256 -or -not $metadataExact) {
        throw 'The feature-toggle lease did not restore exact original bytes, timestamps, and attributes.'
    }

    $Evidence.restoredSha256 = $restoredSha256
    $Evidence.restoredMetadata = $restoredMetadata
    $Evidence.restoredMetadataExact = $metadataExact
    $Evidence.restored = $true
    [IO.File]::SetAttributes($featureToggleBackupPath, [IO.FileAttributes]::Normal)
    Remove-Item -LiteralPath $featureToggleBackupPath -Force
    Remove-Item -LiteralPath $featureToggleLeasePath -Force
    Remove-OwnedFeatureToggleTemporaryFiles
}

function Repair-StaleFeatureToggleLease {
    $backupExists = Test-Path -LiteralPath $featureToggleBackupPath -PathType Leaf
    $markerExists = Test-Path -LiteralPath $featureToggleLeasePath -PathType Leaf
    if (-not $backupExists -and -not $markerExists) {
        Remove-OwnedFeatureToggleTemporaryFiles
        return $false
    }

    if (-not (Test-Path -LiteralPath $featureTogglePath -PathType Leaf)) {
        throw 'A stale feature-toggle lease exists but its target file is missing.'
    }
    $targetSha256 = Get-Sha256HexFromBytes -Bytes ([IO.File]::ReadAllBytes($featureTogglePath))
    if ($backupExists -and $markerExists) {
        $recoveryEvidence = [ordered]@{
            restoreAttempted = $false
            preRestoreSha256 = $null
            preRestoreExpectedHashes = $null
            preRestoreTargetMatchedLease = $false
            restoredSha256 = $null
            restoredMetadata = $null
            restoredMetadataExact = $false
            restored = $false
        }
        Restore-FeatureToggleLease -Evidence $recoveryEvidence
        return $true
    }

    if ($targetSha256 -cne $expectedOriginalFeatureToggleSha256) {
        throw 'An incomplete stale feature-toggle lease cannot be recovered without both durable artifacts.'
    }

    if ($backupExists) {
        [IO.File]::SetAttributes($featureToggleBackupPath, [IO.FileAttributes]::Normal)
        Remove-Item -LiteralPath $featureToggleBackupPath -Force
    }
    if ($markerExists) {
        Remove-Item -LiteralPath $featureToggleLeasePath -Force
    }
    Remove-OwnedFeatureToggleTemporaryFiles
    return $true
}

function New-FeatureToggleLease {
    param([Parameter(Mandatory = $true)][bool]$StaleLeaseRecovered)

    Assert-NoLccEditorProcess
    $originalMetadata = Get-FileMetadataReceipt -Path $featureTogglePath
    $originalBytes = [IO.File]::ReadAllBytes($featureTogglePath)
    $originalSha256 = Get-Sha256HexFromBytes -Bytes $originalBytes
    if ($originalSha256 -cne $expectedOriginalFeatureToggleSha256) {
        throw "The per-user module_toggles.dat is not the exact reviewed original. Found $originalSha256."
    }
    Write-DurableNewFile -Path $featureToggleBackupPath -Bytes $originalBytes
    Set-ExactFileMetadata -Path $featureToggleBackupPath -Metadata $originalMetadata
    $backupSha256 = Get-Sha256HexFromBytes -Bytes ([IO.File]::ReadAllBytes($featureToggleBackupPath))
    if ($backupSha256 -cne $originalSha256) {
        throw 'The durable feature-toggle backup does not match the original bytes.'
    }

    $marker = [ordered]@{
        schemaVersion = 'venviewer.lcc-native-capture-feature-toggle-lease.v1'
        targetPath = $featureTogglePath
        backupPath = $featureToggleBackupPath
        ownerProcessId = $PID
        acquiredAtUtc = [DateTime]::UtcNow.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
        originalSha256 = $originalSha256
        augmentedSha256 = $null
        originalMetadata = $originalMetadata
        soleAddedModuleId = $featureToggleModuleId
        soleAddedEnabledValue = 1
    }
    Write-FeatureToggleLeaseMarker -Marker $marker -Replace $false

    $evidence = [ordered]@{
        activePath = $featureTogglePath
        backupPath = $featureToggleBackupPath
        leaseMarkerPath = $featureToggleLeasePath
        encryptUtilAssemblyPath = $encryptUtilAssemblyPath
        encryptUtilAssemblySha256 = $encryptUtilAssemblySha256
        encryptUtilPublicMethods = @('DecryptFromHex(string,string)', 'EncryptToHex(string,string)')
        expectedOriginalSha256 = $expectedOriginalFeatureToggleSha256
        originalSha256 = $originalSha256
        backupSha256 = $backupSha256
        augmentedSha256 = $null
        preRestoreSha256 = $null
        preRestoreExpectedHashes = $null
        preRestoreTargetMatchedLease = $false
        restoredSha256 = $null
        originalMetadata = $originalMetadata
        restoredMetadata = $null
        restoredMetadataExact = $false
        soleAddedModuleId = $featureToggleModuleId
        soleAddedEnabledValue = 1
        stockModuleEntriesUnchanged = $false
        noOtherLccEditorProcessAtAcquisition = $true
        noUnexpectedLccEditorProcessAfterLaunch = $false
        staleLeaseRecoveredBeforeAcquisition = $StaleLeaseRecovered
        childTerminationConfirmedBeforeRestore = $false
        secondOwnedTerminationAttemptedBeforeRestore = $false
        secondOwnedTerminationSucceededBeforeRestore = $false
        noLccEditorProcessBeforeRestore = $false
        remainingLccEditorProcessIdsBeforeRestore = @()
        restorationDeferredForLiveEditor = $false
        restoreAttempted = $false
        restored = $false
    }

    try {
        $encryptUtilType = Get-EncryptUtilType
        $encryptedOriginal = [Text.Encoding]::UTF8.GetString($originalBytes)
        $decryptedOriginal = Invoke-EncryptUtil `
            -EncryptUtilType $encryptUtilType `
            -Method DecryptFromHex `
            -Value $encryptedOriginal
        $originalConfig = $decryptedOriginal | ConvertFrom-Json
        $existing = @($originalConfig.toggles | Where-Object {
            [string]$_.module_id -ceq $featureToggleModuleId
        })
        if ($existing.Count -ne 0) {
            throw 'The reviewed original already contains the native-capture module ID.'
        }

        $originalForComparison = $decryptedOriginal | ConvertFrom-Json
        $originalConfig.toggles = @($originalConfig.toggles) + @(
            [pscustomobject][ordered]@{
                module_id = $featureToggleModuleId
                module_name = 'Venviewer Grand Hall Native Capture'
                enabled = 1
            })
        Assert-OnlyNativeCaptureToggleAdded `
            -OriginalConfig $originalForComparison `
            -AugmentedConfig $originalConfig
        $augmentedJson = $originalConfig | ConvertTo-Json -Depth 10
        $encryptedAugmented = Invoke-EncryptUtil `
            -EncryptUtilType $encryptUtilType `
            -Method EncryptToHex `
            -Value $augmentedJson
        $augmentedBytes = [Text.UTF8Encoding]::new($false).GetBytes($encryptedAugmented)

        Assert-NoLccEditorProcess
        Write-DurableReplacement -Path $featureTogglePath -Bytes $augmentedBytes
        $activeAugmentedBytes = [IO.File]::ReadAllBytes($featureTogglePath)
        $augmentedSha256 = Get-Sha256HexFromBytes -Bytes $activeAugmentedBytes
        $verifiedJson = Invoke-EncryptUtil `
            -EncryptUtilType $encryptUtilType `
            -Method DecryptFromHex `
            -Value ([Text.Encoding]::UTF8.GetString($activeAugmentedBytes))
        $verifiedConfig = $verifiedJson | ConvertFrom-Json
        Assert-OnlyNativeCaptureToggleAdded `
            -OriginalConfig $originalForComparison `
            -AugmentedConfig $verifiedConfig
        $marker.augmentedSha256 = $augmentedSha256
        Write-FeatureToggleLeaseMarker -Marker $marker -Replace $true
        $evidence.augmentedSha256 = $augmentedSha256
        $evidence.stockModuleEntriesUnchanged = $true
        return $evidence
    }
    catch {
        $acquisitionException = $_.Exception
        try {
            if ((Test-Path -LiteralPath $featureToggleBackupPath -PathType Leaf) -and
                (Test-Path -LiteralPath $featureToggleLeasePath -PathType Leaf)) {
                Restore-FeatureToggleLease -Evidence $evidence
            }
            else {
                $null = Repair-StaleFeatureToggleLease
                $evidence.restoreAttempted = $true
                $evidence.restoredSha256 = $expectedOriginalFeatureToggleSha256
                $evidence.restoredMetadataExact = $true
                $evidence.restored = $true
            }
        }
        catch {
            throw [InvalidOperationException]::new(
                'Feature-toggle lease acquisition failed and exact automatic restoration also failed.',
                $_.Exception)
        }
        throw [InvalidOperationException]::new(
            'Feature-toggle lease acquisition failed; the reviewed original was restored.',
            $acquisitionException)
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
        [Parameter(Mandatory = $true)]$FeatureToggleLeaseEvidence,
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
        featureToggleLease = $FeatureToggleLeaseEvidence
        executable = (Join-Path $approvedSandboxEditor 'LCCEditor.exe')
        canonicalScene = $scene
        outputDirectory = $OutputDirectory
        nativeReceiptSha256 = $NativeReceiptSha256
        finalPngSha256 = $FinalPngSha256
        playerLog = $playerLog
        limitations = @(
            'This operator receipt bounds process lifetime; it is not evidence that the native scene was accepted.',
            'On hard timeout the wrapper terminates the disposable LCCEditor process tree; in-process cleanup may not run.',
            'The per-user feature-toggle lease changes only com.venviewer.native_capture and restores the exact original bytes, timestamps, and attributes only after no LCCEditor process remains.',
            'If any owned or unexpected LCCEditor process remains alive, restoration is deferred and the durable backup plus marker are retained for stale recovery instead of racing a vendor write.',
            'If the leased target is neither the marker-bound augmented hash nor the reviewed original hash, the run fails and restores the durable reviewed original after every editor has exited.',
            'The lease reads the installed public EncryptUtil; it does not modify vendor binaries, CodeMeter, or any stock module ID.',
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

if ($LeaseSelfTest) {
    Assert-NoLccEditorProcess
    Assert-FileSha256 `
        -Path $featureTogglePath `
        -ExpectedSha256 $expectedOriginalFeatureToggleSha256 `
        -Label 'reviewed original per-user feature-toggle fixture source'
    $testRoot = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) (
        'venviewer-feature-toggle-lease-test-' + [Guid]::NewGuid().ToString('N'))
    $liveFeatureTogglePath = $featureTogglePath
    $originalDirectory = $featureToggleDirectory
    $originalBackupPath = $featureToggleBackupPath
    $originalLeasePath = $featureToggleLeasePath
    try {
        New-Item -ItemType Directory -Path $testRoot | Out-Null
        $featureToggleDirectory = $testRoot
        $featureTogglePath = Join-Path $testRoot 'module_toggles.dat'
        $featureToggleBackupPath = Join-Path $testRoot '.module_toggles.dat.venviewer-native-capture.original'
        $featureToggleLeasePath = Join-Path $testRoot '.module_toggles.dat.venviewer-native-capture.lease.json'
        [IO.File]::WriteAllBytes($featureTogglePath, [IO.File]::ReadAllBytes($liveFeatureTogglePath))
        [IO.File]::SetAttributes($featureTogglePath, [IO.FileAttributes]::Archive)
        [IO.File]::SetLastWriteTimeUtc(
            $featureTogglePath,
            [DateTime]::new(638900000000000000, [DateTimeKind]::Utc))
        [IO.File]::SetLastAccessTimeUtc(
            $featureTogglePath,
            [DateTime]::new(638800000000000000, [DateTimeKind]::Utc))
        $fixtureMetadata = Get-FileMetadataReceipt -Path $featureTogglePath
        $selfTestEvidence = New-FeatureToggleLease -StaleLeaseRecovered $false
        if ([string]$selfTestEvidence.originalSha256 -cne $expectedOriginalFeatureToggleSha256 -or
            [string]::IsNullOrWhiteSpace([string]$selfTestEvidence.augmentedSha256) -or
            [string]$selfTestEvidence.augmentedSha256 -ceq $expectedOriginalFeatureToggleSha256 -or
            -not [bool]$selfTestEvidence.stockModuleEntriesUnchanged) {
            throw 'The feature-toggle lease self-test did not produce the exact bounded augmentation.'
        }
        Restore-FeatureToggleLease -Evidence $selfTestEvidence
        $restoredMetadata = Get-FileMetadataReceipt -Path $featureTogglePath
        if (-not [bool]$selfTestEvidence.restored -or
            [string]$selfTestEvidence.restoredSha256 -cne $expectedOriginalFeatureToggleSha256 -or
            -not (Test-FileMetadataEqual -Expected $fixtureMetadata -Actual $restoredMetadata) -or
            -not [bool]$selfTestEvidence.preRestoreTargetMatchedLease -or
            (Test-Path -LiteralPath $featureToggleBackupPath) -or
            (Test-Path -LiteralPath $featureToggleLeasePath)) {
            throw ('The feature-toggle lease self-test did not restore exact bytes and metadata or clean its lease. ' +
                'restored=' + [string]$selfTestEvidence.restored +
                '; restoredSha256=' + [string]$selfTestEvidence.restoredSha256 +
                '; metadataExact=' + [string](Test-FileMetadataEqual -Expected $fixtureMetadata -Actual $restoredMetadata) +
                '; backupExists=' + [string](Test-Path -LiteralPath $featureToggleBackupPath) +
                '; markerExists=' + [string](Test-Path -LiteralPath $featureToggleLeasePath) + '.')
        }
        $staleFixtureMetadata = Get-FileMetadataReceipt -Path $featureTogglePath
        $null = New-FeatureToggleLease -StaleLeaseRecovered $false
        if (-not (Repair-StaleFeatureToggleLease)) {
            throw 'The feature-toggle lease self-test did not recognize a complete stale lease.'
        }
        $staleRestoredMetadata = Get-FileMetadataReceipt -Path $featureTogglePath
        $staleRestoredSha256 = Get-Sha256HexFromBytes -Bytes ([IO.File]::ReadAllBytes($featureTogglePath))
        if ($staleRestoredSha256 -cne $expectedOriginalFeatureToggleSha256 -or
            -not (Test-FileMetadataEqual -Expected $staleFixtureMetadata -Actual $staleRestoredMetadata)) {
            throw 'The stale feature-toggle lease recovery did not restore exact original bytes and metadata.'
        }
        Write-Output 'PASS: crash-recoverable feature-toggle lease round trip'
    }
    finally {
        $featureTogglePath = $liveFeatureTogglePath
        $featureToggleDirectory = $originalDirectory
        $featureToggleBackupPath = $originalBackupPath
        $featureToggleLeasePath = $originalLeasePath
        if (Test-Path -LiteralPath $testRoot -PathType Container) {
            Remove-Item -LiteralPath $testRoot -Recurse -Force
        }
    }
    return
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
Assert-NoReparseAncestor -Path $featureTogglePath -Label 'per-user feature-toggle file'

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
    cameraProfileSha256 = ([string]$buildReceipt.cameraProfile.sha256).ToUpperInvariant()
}
$moduleDestination = Join-Path $approvedSandboxEditor 'Modules\Venviewer Native Capture'
$installedModule = Join-Path $moduleDestination 'VenviewerNativeCapture.dll'
$installedPlugin = Join-Path $moduleDestination 'plugin.json'
$installedClosureLock = Join-Path $moduleDestination 'runtime-closure-lock.json'
$installedCameraProfile = Join-Path $moduleDestination 'camera-profile.json'
Assert-FileSha256 -Path $installedModule -ExpectedSha256 ([string]$buildReceipt.module.sha256) -Label 'installed first-party module'
Assert-FileSha256 -Path $installedPlugin -ExpectedSha256 ([string]$buildReceipt.pluginManifest.sha256) -Label 'installed plugin manifest'
Assert-FileSha256 -Path $installedClosureLock -ExpectedSha256 ([string]$buildReceipt.runtimeClosureLock.sha256) -Label 'installed runtime closure lock'
if ([string]$buildReceipt.cameraProfile.sha256 -cne
    '9ECA9B6582B7301EC1C059B1A5BE699E5A4983773AFECB2BEEA46C2668305922') {
    throw 'The build receipt camera profile does not equal the compiled digest lock.'
}
Assert-FileSha256 -Path $installedCameraProfile -ExpectedSha256 ([string]$buildReceipt.cameraProfile.sha256) -Label 'installed fixed-camera profile'
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
    'grand-hall-gh1-lcc2-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' +
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
$featureToggleLeaseEvidence = [ordered]@{
    activePath = $featureTogglePath
    expectedOriginalSha256 = $expectedOriginalFeatureToggleSha256
    originalSha256 = $null
    augmentedSha256 = $null
    preRestoreSha256 = $null
    preRestoreExpectedHashes = $null
    preRestoreTargetMatchedLease = $false
    restoredSha256 = $null
    restoredMetadataExact = $false
    soleAddedModuleId = $featureToggleModuleId
    soleAddedEnabledValue = 1
    stockModuleEntriesUnchanged = $false
    noOtherLccEditorProcessAtAcquisition = $false
    noUnexpectedLccEditorProcessAfterLaunch = $false
    staleLeaseRecoveredBeforeAcquisition = $false
    childTerminationConfirmedBeforeRestore = $false
    secondOwnedTerminationAttemptedBeforeRestore = $false
    secondOwnedTerminationSucceededBeforeRestore = $false
    noLccEditorProcessBeforeRestore = $false
    remainingLccEditorProcessIdsBeforeRestore = @()
    restorationDeferredForLiveEditor = $false
    restoreAttempted = $false
    restored = $false
}

try {
    Assert-NoLccEditorProcess
    $staleLeaseRecovered = Repair-StaleFeatureToggleLease
    $featureToggleLeaseEvidence = New-FeatureToggleLease -StaleLeaseRecovered $staleLeaseRecovered
    Assert-NoLccEditorProcess
    [Environment]::SetEnvironmentVariable(
        'VENVIEWER_LCC_NATIVE_CAPTURE_ARM',
        'CANONICAL_GH1_LCC2_NATIVE_CAPTURE_V1',
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
    [Environment]::SetEnvironmentVariable(
        'VENVIEWER_LCC_NATIVE_CAPTURE_CAMERA_PROFILE_SHA256',
        [string]$buildReceipt.cameraProfile.sha256,
        'Process')

    $executable = Join-Path $approvedSandboxEditor 'LCCEditor.exe'
    $captureProcess = Start-Process `
        -FilePath $executable `
        -WorkingDirectory $approvedSandboxEditor `
        -ArgumentList @('-screen-width', '1600', '-screen-height', '900', '-screen-fullscreen', '0') `
        -WindowStyle Hidden `
        -PassThru
    $processId = $captureProcess.Id
    $unexpectedEditors = @(Get-LccEditorProcesses | Where-Object { $_.Id -ne $processId })
    if ($unexpectedEditors.Count -ne 0) {
        $terminationAttempted = $true
        $terminationSucceeded = Stop-CaptureProcessTree -Process $captureProcess
        throw 'Another LCCEditor process appeared after the feature-toggle lease was acquired.'
    }
    $featureToggleLeaseEvidence.noUnexpectedLccEditorProcessAfterLaunch = $true

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

    if ($null -ne $featureToggleLeaseEvidence.originalSha256 -and
        -not [bool]$featureToggleLeaseEvidence.restored) {
        $ownedEditorsBeforeRestore = @()
        if ($null -ne $processId) {
            $ownedEditorsBeforeRestore = @(
                Get-LccEditorProcesses | Where-Object { $_.Id -eq $processId }
            )
        }
        if ($ownedEditorsBeforeRestore.Count -ne 0) {
            $terminationAttempted = $true
            $featureToggleLeaseEvidence.secondOwnedTerminationAttemptedBeforeRestore = $true
            $secondTerminationSucceeded = Stop-CaptureProcessTree -Process $ownedEditorsBeforeRestore[0]
            $featureToggleLeaseEvidence.secondOwnedTerminationSucceededBeforeRestore =
                $secondTerminationSucceeded
            if (-not $secondTerminationSucceeded) {
                $terminationSucceeded = $false
                $status = 'failure'
                $message += ' A second bounded termination attempt could not stop the owned editor process tree.'
            }
        }

        $allEditorsBeforeRestore = @(Get-LccEditorProcesses)
        $ownedEditorStillRunning = $false
        if ($null -ne $processId) {
            $ownedEditorStillRunning = @(
                $allEditorsBeforeRestore | Where-Object { $_.Id -eq $processId }
            ).Count -ne 0
        }
        $featureToggleLeaseEvidence.childTerminationConfirmedBeforeRestore =
            -not $ownedEditorStillRunning
        $featureToggleLeaseEvidence.noLccEditorProcessBeforeRestore =
            $allEditorsBeforeRestore.Count -eq 0
        $featureToggleLeaseEvidence.remainingLccEditorProcessIdsBeforeRestore = @(
            $allEditorsBeforeRestore | ForEach-Object { $_.Id }
        )

        if ($allEditorsBeforeRestore.Count -eq 0) {
            try {
                Restore-FeatureToggleLease -Evidence $featureToggleLeaseEvidence
                if (-not [bool]$featureToggleLeaseEvidence.preRestoreTargetMatchedLease) {
                    $status = 'failure'
                    $message += ' The leased feature-toggle target drifted unexpectedly; the durable reviewed original was restored after all editor processes exited.'
                }
            }
            catch {
                $status = 'failure'
                $editorsAfterRestoreFailure = @(Get-LccEditorProcesses)
                if ($editorsAfterRestoreFailure.Count -ne 0) {
                    $featureToggleLeaseEvidence.noLccEditorProcessBeforeRestore = $false
                    $featureToggleLeaseEvidence.remainingLccEditorProcessIdsBeforeRestore = @(
                        $editorsAfterRestoreFailure | ForEach-Object { $_.Id }
                    )
                    $featureToggleLeaseEvidence.restorationDeferredForLiveEditor = $true
                    $remainingProcessIds = @(
                        $featureToggleLeaseEvidence.remainingLccEditorProcessIdsBeforeRestore
                    ) -join ', '
                    $message += " Feature-toggle restoration was deferred after a final process gate detected LCCEditor process(es) ($remainingProcessIds); the durable backup and lease marker were retained."
                }
                else {
                    $message += ' Exact per-user feature-toggle restoration failed: ' + $_.Exception.Message
                }
                if ($null -eq $failureException) {
                    $failureException = $_.Exception
                }
            }
        }
        else {
            $featureToggleLeaseEvidence.restorationDeferredForLiveEditor = $true
            $status = 'failure'
            $remainingProcessIds = @(
                $featureToggleLeaseEvidence.remainingLccEditorProcessIdsBeforeRestore
            ) -join ', '
            $message += " Feature-toggle restoration was deliberately deferred because LCCEditor process(es) remain alive ($remainingProcessIds); the durable backup and lease marker were retained for stale recovery after every editor exits."
            if ($null -eq $failureException) {
                $failureException = [InvalidOperationException]::new(
                    'Exact feature-toggle restoration is unsafe while any LCCEditor process remains alive.')
            }
        }
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
        -FeatureToggleLeaseEvidence $featureToggleLeaseEvidence `
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
