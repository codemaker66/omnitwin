[CmdletBinding()]
param(
    [switch]$LeaseSelfTest,
    [switch]$PlayerLogAuditSelfTest
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

function Get-OrdinalOccurrenceCount {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Needle
    )

    if ($Needle.Length -eq 0) {
        throw 'An ordinal occurrence needle must not be empty.'
    }
    $count = 0
    $offset = 0
    while ($offset -le $Text.Length - $Needle.Length) {
        $index = $Text.IndexOf($Needle, $offset, [StringComparison]::Ordinal)
        if ($index -lt 0) {
            break
        }
        $count += 1
        $offset = $index + $Needle.Length
    }
    return $count
}

function Get-PlayerLogFingerprint {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [ordered]@{
            exists = $false
            byteLength = 0
            sha256 = $null
            creationTimeUtcTicks = $null
            lastWriteTimeUtcTicks = $null
        }
    }
    $bytes = [IO.File]::ReadAllBytes($Path)
    $item = Get-Item -LiteralPath $Path -Force
    return [ordered]@{
        exists = $true
        byteLength = $bytes.LongLength
        sha256 = Get-Sha256HexFromBytes -Bytes $bytes
        creationTimeUtcTicks = $item.CreationTimeUtc.Ticks
        lastWriteTimeUtcTicks = $item.LastWriteTimeUtc.Ticks
    }
}

function Write-RunPlayerLogEvidence {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$OutputDirectory,
        [Parameter(Mandatory = $true)][string]$ApprovedEditorRoot,
        [Parameter(Mandatory = $true)]$PreRunFingerprint,
        [Parameter(Mandatory = $true)][long]$LaunchStartedUtcTicks,
        [AllowNull()][string]$NativeReceiptPath,
        [AllowNull()][string]$NativeReceiptSha256,
        [Parameter(Mandatory = $true)][bool]$RequireNativeReceiptBinding
    )

    if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
        throw "The post-run Player.log is missing: $SourcePath"
    }
    $sourceBytes = [IO.File]::ReadAllBytes($SourcePath)
    $sourceItem = Get-Item -LiteralPath $SourcePath -Force
    $sourceSha256 = Get-Sha256HexFromBytes -Bytes $sourceBytes
    if ($sourceBytes.LongLength -eq 0) {
        throw 'The post-run Player.log is empty.'
    }
    if ($sourceItem.LastWriteTimeUtc.Ticks -lt $LaunchStartedUtcTicks) {
        throw 'The post-run Player.log was not written at or after process launch.'
    }
    if ([bool]$PreRunFingerprint.exists -and
        [long]$PreRunFingerprint.byteLength -eq $sourceBytes.LongLength -and
        [string]$PreRunFingerprint.sha256 -ceq $sourceSha256) {
        throw 'Player.log did not change during the bounded editor run.'
    }

    $utf8 = [Text.UTF8Encoding]::new($false, $true)
    $sourceText = $utf8.GetString($sourceBytes)
    $normalizedEditorRoot = ([IO.Path]::GetFullPath($ApprovedEditorRoot) -replace '\\', '/')
    $startupMarker = "Mono path[0] = '$normalizedEditorRoot/LCCEditor_Data/Managed'"
    $startupMarkerLineMatches = [Regex]::Matches(
        $sourceText,
        '(?m)^' + [Regex]::Escape($startupMarker) + '\r?$')
    if ($startupMarkerLineMatches.Count -eq 0) {
        throw 'Player.log does not contain a line-bounded startup marker for the approved sandbox editor.'
    }
    $startCharacterOffset =
        $startupMarkerLineMatches[$startupMarkerLineMatches.Count - 1].Index

    $startByteOffset = $utf8.GetByteCount($sourceText.Substring(0, $startCharacterOffset))
    $runBytes = [byte[]]::new($sourceBytes.Length - $startByteOffset)
    [Buffer]::BlockCopy(
        $sourceBytes,
        $startByteOffset,
        $runBytes,
        0,
        $runBytes.Length)
    $runText = $utf8.GetString($runBytes)
    if (-not $runText.StartsWith($startupMarker, [StringComparison]::Ordinal)) {
        throw 'The extracted Player.log run slice does not begin at the exact startup marker.'
    }

    $receiptMarker = $null
    $receiptMarkerCount = 0
    $receiptMarkerIndex = -1
    $receiptMarkerNextLineIndex = -1
    if (-not [string]::IsNullOrEmpty($NativeReceiptPath) -and
        -not [string]::IsNullOrEmpty($NativeReceiptSha256)) {
        if ($NativeReceiptSha256 -notmatch '^[A-Fa-f0-9]{64}$') {
            throw 'The Player.log binding received an invalid native receipt SHA-256.'
        }
        $receiptMarker = '[VenviewerNativeCapture] Receipt: ' +
            $NativeReceiptPath + ' SHA-256 ' + $NativeReceiptSha256.ToUpperInvariant()
        $receiptMarkerLineMatches = [Regex]::Matches(
            $runText,
            '(?m)^' + [Regex]::Escape($receiptMarker) + '\r?$')
        $receiptMarkerCount = $receiptMarkerLineMatches.Count
        if ($receiptMarkerCount -gt 0) {
            $receiptMarkerIndex = $receiptMarkerLineMatches[0].Index
            $receiptMarkerLineFeedIndex = $runText.IndexOf(
                "`n",
                $receiptMarkerIndex,
                [StringComparison]::Ordinal)
            $receiptMarkerNextLineIndex = if ($receiptMarkerLineFeedIndex -ge 0) {
                $receiptMarkerLineFeedIndex + 1
            }
            else {
                $runText.Length
            }
        }
    }
    if ($RequireNativeReceiptBinding -and $receiptMarkerCount -ne 1) {
        throw 'The run-specific Player.log slice is not uniquely bound to the current native receipt marker.'
    }

    $srgbFallbackWarning =
        'Requested RenderTexture with sRGB format. sRGB formats are not supported in gamma mode, fallback to a UNorm format. Use a UNorm format instead of sRGB to silence this warning.'
    $srgbFallbackWarningCount = Get-OrdinalOccurrenceCount `
        -Text $runText `
        -Needle $srgbFallbackWarning
    $knownStartupDbufferClearShaderError =
        'ERROR: Shader Hidden/Universal Render Pipeline/DBufferClear shader is not supported on this GPU (none of subshaders/fallbacks are suitable)'
    $errorLineMatches = [Regex]::Matches(
        $runText,
        '(?m)^[^\r\n]*\bERROR:[^\r\n]*\r?$')
    $knownStartupDbufferClearShaderErrorCount = 0
    foreach ($errorLineMatch in $errorLineMatches) {
        if ($errorLineMatch.Value.TrimEnd("`r") -ceq
            $knownStartupDbufferClearShaderError) {
            $knownStartupDbufferClearShaderErrorCount += 1
        }
    }
    $unexpectedErrorLineCount =
        $errorLineMatches.Count - $knownStartupDbufferClearShaderErrorCount
    $errorClassification = if ($unexpectedErrorLineCount -gt 0) {
        'unexpected_error_lines_observed'
    }
    elseif ($knownStartupDbufferClearShaderErrorCount -eq 1) {
        'one_known_startup_dbuffer_clear_shader_unsupported_error_observed'
    }
    elseif ($knownStartupDbufferClearShaderErrorCount -gt 1) {
        'known_startup_dbuffer_clear_shader_error_cardinality_drift'
    }
    else {
        'known_startup_dbuffer_clear_shader_error_missing'
    }

    $windowsMediaFoundationWarningPrefix =
        'Color primaries 0 is unknown or unsupported by WindowsMediaFoundation. Falling back to default may result in color shift. '
    $expectedWindowsMediaFoundationWarning =
        $windowsMediaFoundationWarningPrefix +
        [IO.Path]::GetFullPath((Join-Path $ApprovedEditorRoot 'LCCEditor_Data\sharedassets0.resource'))
    $windowsMediaFoundationWarningMatches = [Regex]::Matches(
        $runText,
        '(?m)^[^\r\n]*WindowsMediaFoundation[^\r\n]*\r?$')
    $knownWindowsMediaFoundationUnknownColorPrimariesWarningCount = 0
    foreach ($warningLineMatch in $windowsMediaFoundationWarningMatches) {
        if ($warningLineMatch.Value.TrimEnd("`r") -ceq
            $expectedWindowsMediaFoundationWarning) {
            $knownWindowsMediaFoundationUnknownColorPrimariesWarningCount += 1
        }
    }
    $unexpectedWindowsMediaFoundationUnknownColorPrimariesWarningCount =
        $windowsMediaFoundationWarningMatches.Count -
        $knownWindowsMediaFoundationUnknownColorPrimariesWarningCount
    $windowsMediaFoundationWarningClassification =
        if ($unexpectedWindowsMediaFoundationUnknownColorPrimariesWarningCount -gt 0) {
            'unexpected_windows_media_foundation_unknown_color_primaries_warning_observed'
        }
        elseif ($knownWindowsMediaFoundationUnknownColorPrimariesWarningCount -eq 1) {
            'one_known_windows_media_foundation_unknown_color_primaries_warning_observed_limitation_only'
        }
        elseif ($knownWindowsMediaFoundationUnknownColorPrimariesWarningCount -gt 1) {
            'known_windows_media_foundation_warning_cardinality_drift'
        }
        else {
            'known_windows_media_foundation_warning_missing'
        }
    $terminalShutdownMarker =
        'Input System module state changed to: Shutdown.'
    $terminalShutdownMarkerMatches = [Regex]::Matches(
        $runText,
        '(?m)^' + [Regex]::Escape($terminalShutdownMarker) + '\r?$')
    $terminalShutdownMarkerAfterReceipt =
        $terminalShutdownMarkerMatches.Count -eq 1 -and
        $receiptMarkerIndex -ge 0 -and
        $terminalShutdownMarkerMatches[0].Index -gt $receiptMarkerIndex
    $terminalShutdownMarkerAtEof =
        $runText.EndsWith($terminalShutdownMarker + "`r`n", [StringComparison]::Ordinal)
    $terminalShutdownComplete =
        $terminalShutdownMarkerAfterReceipt -and $terminalShutdownMarkerAtEof
    $exceptionMatches = [Regex]::Matches(
        $runText,
        '(?m)^[A-Za-z_][A-Za-z0-9_.+`]*Exception:[^\r\n]*\r?$')
    $knownTooltipRescacheShutdownBlockPattern =
        '(?m)^ObjectDisposedException: Cannot access a disposed object\.\r\n' +
        "^Object name: 'ResCacheManager<Object>\[ResManager\.Resources\.Object\]'\.\r\n" +
        '^  at XGrids\.LCCWorld\.Res\.ResCacheManager`1\[T\]\.Release \(System\.String key\) \[0x00089\] in <ecf2cac8628d444a8ffff8a2c195da27>:0 ?\r\n' +
        '^  at XGrids\.LCCWorld\.Res\.ResReleaserAdapter`1\[T\]\.Release \(System\.String key\) \[0x00000\] in <ecf2cac8628d444a8ffff8a2c195da27>:0 ?\r\n' +
        '^  at XGrids\.LCCWorld\.Res\.ResHandle`1\[T\]\.Dispose \(\) \[0x00010\] in <ecf2cac8628d444a8ffff8a2c195da27>:0 ?\r\n' +
        '^  at Battlehub\.UIControls\.TooltipControl\.TruncatedTextTooltip\.OnDestroy \(\) \[0x0000a\] in <ecf2cac8628d444a8ffff8a2c195da27>:0 ?\r\n(?=\r\n|$)'
    $knownTooltipRescacheShutdownBlockMatches = [Regex]::Matches(
        $runText,
        $knownTooltipRescacheShutdownBlockPattern)
    $knownEnvironmentOnDisableShutdownBlockPattern =
        '(?m)^NullReferenceException: Object reference not set to an instance of an object\.\r\n' +
        '^  at UnityEngine\.Bindings\.ThrowHelper\.ThrowNullReferenceException \(System\.Object obj\) \[0x00018\] in <7605667304d149c99f4a7b2919f242b4>:0 ?\r\n' +
        '^  at UnityEngine\.Behaviour\.get_enabled \(\) \[0x00006\] in <7605667304d149c99f4a7b2919f242b4>:0 ?\r\n' +
        '^  at LCCCore\.LCCManager\.SetEnvironment \(LCCCore\.Renderer _renderer, System\.Boolean _isRender\) \[0x00000\] in <eff3262970214cd9930e18bf8abd6d90>:0 ?\r\n' +
        '^  at XGrids\.LCCWorld\.Framework\.LCCSceneManager\.SetEnvironmentData \(System\.Boolean isOn, LCCCore\.Renderer renderer\) \[0x00027\] in <ecf2cac8628d444a8ffff8a2c195da27>:0 ?\r\n' +
        '^  at XGrids\.LCCWorld\.Framework\.LCCEnvironmentComponent\.OnRTEDisabled \(\) \[0x00008\] in <ecf2cac8628d444a8ffff8a2c195da27>:0 ?\r\n' +
        '^  at XGrids\.LCCWorld\.RTCommon\.RTEEventHub\.OnAnyDisabled \(Battlehub\.RTCommon\.RuntimeAsset obj\) \[0x0002c\] in <ecf2cac8628d444a8ffff8a2c195da27>:0 ?\r\n' +
        '^  at \(wrapper delegate-invoke\) <Module>\.invoke_void_RuntimeAsset\(Battlehub\.RTCommon\.RuntimeAsset\) ?\r\n' +
        '^  at Battlehub\.RTCommon\.RuntimeAsset\.OnDisable \(\) \[0x00013\] in <ecf2cac8628d444a8ffff8a2c195da27>:0 ?\r\n(?=\r\n|$)'
    $knownEnvironmentOnDisableShutdownBlockMatches = [Regex]::Matches(
        $runText,
        $knownEnvironmentOnDisableShutdownBlockPattern)
    $knownPostReceiptVendorTooltipRescacheShutdownExceptionCount = 0
    $knownPreReceiptVendorTooltipRescacheShutdownExceptionCount = 0
    $knownPostReceiptVendorTooltipRescacheShutdownBlockMatches = @()
    foreach ($knownBlockMatch in $knownTooltipRescacheShutdownBlockMatches) {
        if ($receiptMarkerIndex -ge 0 -and
            $knownBlockMatch.Index -gt $receiptMarkerIndex) {
            $knownPostReceiptVendorTooltipRescacheShutdownExceptionCount += 1
            $knownPostReceiptVendorTooltipRescacheShutdownBlockMatches += $knownBlockMatch
        }
        else {
            $knownPreReceiptVendorTooltipRescacheShutdownExceptionCount += 1
        }
    }
    $knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount = 0
    $knownPreReceiptVendorEnvironmentOnDisableShutdownExceptionCount = 0
    $knownPostReceiptVendorEnvironmentOnDisableShutdownBlockMatches = @()
    foreach ($knownBlockMatch in $knownEnvironmentOnDisableShutdownBlockMatches) {
        if ($receiptMarkerIndex -ge 0 -and
            $knownBlockMatch.Index -gt $receiptMarkerIndex) {
            $knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount += 1
            $knownPostReceiptVendorEnvironmentOnDisableShutdownBlockMatches += $knownBlockMatch
        }
        else {
            $knownPreReceiptVendorEnvironmentOnDisableShutdownExceptionCount += 1
        }
    }
    $knownApprovedPostReceiptShutdownExceptionCount =
        $knownPostReceiptVendorTooltipRescacheShutdownExceptionCount +
        $knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount
    $unclassifiedExceptionCount =
        $exceptionMatches.Count - $knownApprovedPostReceiptShutdownExceptionCount
    $approvedPostReceiptShutdownBlockMatches = @(
        $knownPostReceiptVendorTooltipRescacheShutdownBlockMatches
    ) + @(
        $knownPostReceiptVendorEnvironmentOnDisableShutdownBlockMatches
    )
    $exceptionDiagnosticLineMatches = [Regex]::Matches(
        $runText,
        '(?m)^(?:[^\r\n]*Exception:[^\r\n]*|Object name: [^\r\n]*|[ \t]+at [^\r\n]*)\r?$')
    $knownApprovedPostReceiptExceptionDiagnosticLineCount = 0
    foreach ($diagnosticLineMatch in $exceptionDiagnosticLineMatches) {
        $coveredByApprovedPostReceiptBlock = $false
        foreach ($approvedBlockMatch in $approvedPostReceiptShutdownBlockMatches) {
            if ($diagnosticLineMatch.Index -ge $approvedBlockMatch.Index -and
                $diagnosticLineMatch.Index -lt
                    ($approvedBlockMatch.Index + $approvedBlockMatch.Length)) {
                $coveredByApprovedPostReceiptBlock = $true
                break
            }
        }
        if ($coveredByApprovedPostReceiptBlock) {
            $knownApprovedPostReceiptExceptionDiagnosticLineCount += 1
        }
    }
    $unclassifiedExceptionDiagnosticLineCount =
        $exceptionDiagnosticLineMatches.Count -
        $knownApprovedPostReceiptExceptionDiagnosticLineCount

    $tooltipShutdownBlocksConsecutive = $false
    if ($knownPostReceiptVendorTooltipRescacheShutdownBlockMatches.Count -eq 5) {
        $tooltipShutdownBlocksConsecutive = $true
        for ($blockIndex = 0; $blockIndex -lt 4; $blockIndex += 1) {
            $currentBlock =
                $knownPostReceiptVendorTooltipRescacheShutdownBlockMatches[$blockIndex]
            $nextBlock =
                $knownPostReceiptVendorTooltipRescacheShutdownBlockMatches[$blockIndex + 1]
            $gapStart = $currentBlock.Index + $currentBlock.Length
            $gap = $runText.Substring($gapStart, $nextBlock.Index - $gapStart)
            if ($gap -cne "`r`n") {
                $tooltipShutdownBlocksConsecutive = $false
                break
            }
        }
    }
    $environmentShutdownImmediatelyAfterReceiptMarker =
        $knownPostReceiptVendorEnvironmentOnDisableShutdownBlockMatches.Count -eq 1 -and
        $receiptMarkerNextLineIndex -ge 0 -and
        $knownPostReceiptVendorEnvironmentOnDisableShutdownBlockMatches[0].Index -eq
            $receiptMarkerNextLineIndex

    $approvedShutdownProfileFullyConsumed =
        $unclassifiedExceptionCount -eq 0 -and
        $unclassifiedExceptionDiagnosticLineCount -eq 0
    $cleanShutdownProfileMatches =
        $receiptMarkerCount -eq 1 -and
        $terminalShutdownComplete -and
        $exceptionMatches.Count -eq 0 -and
        $exceptionDiagnosticLineMatches.Count -eq 0
    $tooltipShutdownProfileMatches =
        $receiptMarkerCount -eq 1 -and
        $terminalShutdownComplete -and
        $knownPostReceiptVendorTooltipRescacheShutdownExceptionCount -eq 5 -and
        $knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount -eq 0 -and
        $exceptionMatches.Count -eq 5 -and
        $tooltipShutdownBlocksConsecutive -and
        $approvedShutdownProfileFullyConsumed
    $environmentShutdownProfileMatches =
        $receiptMarkerCount -eq 1 -and
        $terminalShutdownComplete -and
        $knownPostReceiptVendorTooltipRescacheShutdownExceptionCount -eq 0 -and
        $knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount -eq 1 -and
        $exceptionMatches.Count -eq 1 -and
        $environmentShutdownImmediatelyAfterReceiptMarker -and
        $approvedShutdownProfileFullyConsumed
    $approvedShutdownProfileMatchCount =
        [int][bool]$cleanShutdownProfileMatches +
        [int][bool]$tooltipShutdownProfileMatches +
        [int][bool]$environmentShutdownProfileMatches
    $approvedShutdownProfile = 'none'
    $approvedShutdownProfilePhaseSatisfied = $false
    if ($cleanShutdownProfileMatches) {
        $approvedShutdownProfile = 'clean_shutdown_no_exceptions'
        $approvedShutdownProfilePhaseSatisfied = $true
    }
    elseif ($tooltipShutdownProfileMatches) {
        $approvedShutdownProfile = 'tooltip_rescache_object_disposed_x5'
        $approvedShutdownProfilePhaseSatisfied =
            $tooltipShutdownBlocksConsecutive
    }
    elseif ($environmentShutdownProfileMatches) {
        $approvedShutdownProfile = 'environment_on_disable_null_reference_x1'
        $approvedShutdownProfilePhaseSatisfied =
            $environmentShutdownImmediatelyAfterReceiptMarker
    }
    $approvedShutdownProfileMatched = $approvedShutdownProfileMatchCount -eq 1
    $approvedShutdownProfilesMutuallyExclusive =
        -not ($knownPostReceiptVendorTooltipRescacheShutdownExceptionCount -gt 0 -and
            $knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount -gt 0)
    $shutdownProfileClassification = if ($approvedShutdownProfileMatched) {
        if ($approvedShutdownProfile -ceq 'clean_shutdown_no_exceptions') {
            'one_exact_approved_clean_shutdown_profile_observed'
        }
        else {
            'one_exact_approved_post_receipt_shutdown_limitation_profile_observed'
        }
    }
    elseif ($knownPostReceiptVendorTooltipRescacheShutdownExceptionCount -gt 0 -and
        $knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount -gt 0) {
        'mixed_approved_shutdown_shapes_rejected'
    }
    elseif ($unclassifiedExceptionCount -gt 0 -or
        $unclassifiedExceptionDiagnosticLineCount -gt 0) {
        'unclassified_extended_reordered_or_pre_receipt_exception_rejected'
    }
    elseif (-not $tooltipShutdownBlocksConsecutive -and
        $knownPostReceiptVendorTooltipRescacheShutdownExceptionCount -eq 5) {
        'tooltip_shutdown_profile_nonconsecutive_blocks_rejected'
    }
    elseif (-not $environmentShutdownImmediatelyAfterReceiptMarker -and
        $knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount -eq 1) {
        'environment_shutdown_profile_phase_relation_rejected'
    }
    else {
        'approved_shutdown_profile_count_mismatch_or_missing_profile_rejected'
    }
    $exceptionClassification = $shutdownProfileClassification

    $runPath = Join-Path $OutputDirectory 'grand-hall-native-capture-player-log-run.log'
    if (Test-Path -LiteralPath $runPath) {
        throw "The run-specific Player.log evidence path already exists: $runPath"
    }
    Write-DurableNewFile -Path $runPath -Bytes $runBytes
    $publishedBytes = [IO.File]::ReadAllBytes($runPath)
    $runSha256 = Get-Sha256HexFromBytes -Bytes $runBytes
    $publishedSha256 = Get-Sha256HexFromBytes -Bytes $publishedBytes
    if ($publishedBytes.LongLength -ne $runBytes.LongLength -or
        $publishedSha256 -cne $runSha256) {
        throw 'The published run-specific Player.log evidence differs from the extracted bytes.'
    }

    return [ordered]@{
        sourcePath = $SourcePath
        sourceFingerprintBeforeRun = $PreRunFingerprint
        sourceFingerprintAfterRun = [ordered]@{
            exists = $true
            byteLength = $sourceBytes.LongLength
            sha256 = $sourceSha256
            creationTimeUtcTicks = $sourceItem.CreationTimeUtc.Ticks
            lastWriteTimeUtcTicks = $sourceItem.LastWriteTimeUtc.Ticks
        }
        extractionBoundary = 'last_exact_approved_sandbox_unity_startup_marker_through_eof_after_process_exit'
        excludedPrefixByteLength = $startByteOffset
        runLogPath = $runPath
        runLogByteLength = $runBytes.LongLength
        runLogSha256 = $runSha256
        strictUtf8Decoded = $true
        beginsAtExactApprovedSandboxStartupMarker = $true
        exactApprovedSandboxStartupMarkerCount =
            $startupMarkerLineMatches.Count
        nativeReceiptMarker = $receiptMarker
        nativeReceiptMarkerCount = $receiptMarkerCount
        nativeReceiptUniquelyBound = $receiptMarkerCount -eq 1
        nativeReceiptMarkerExactLineBound = $receiptMarkerCount -eq 1
        renderTextureSrgbFallbackWarningCount = $srgbFallbackWarningCount
        errorLineCount = $errorLineMatches.Count
        knownStartupDbufferClearShaderUnsupportedErrorCount =
            $knownStartupDbufferClearShaderErrorCount
        unexpectedErrorLineCount = $unexpectedErrorLineCount
        errorFree = $errorLineMatches.Count -eq 0
        errorClassification = $errorClassification
        windowsMediaFoundationUnknownColorPrimariesWarningCount =
            $windowsMediaFoundationWarningMatches.Count
        knownWindowsMediaFoundationUnknownColorPrimariesWarningCount =
            $knownWindowsMediaFoundationUnknownColorPrimariesWarningCount
        unexpectedWindowsMediaFoundationUnknownColorPrimariesWarningCount =
            $unexpectedWindowsMediaFoundationUnknownColorPrimariesWarningCount
        windowsMediaFoundationWarningFree =
            $windowsMediaFoundationWarningMatches.Count -eq 0
        windowsMediaFoundationWarningClassification =
            $windowsMediaFoundationWarningClassification
        windowsMediaFoundationUnknownColorPrimariesLimitation =
            'Vendor media initialization reported unknown color primaries and a default fallback; this is retained as a limitation and is not evidence that it affected the SOG render.'
        terminalShutdownMarker = $terminalShutdownMarker
        terminalShutdownMarkerCount = $terminalShutdownMarkerMatches.Count
        terminalShutdownMarkerAfterReceipt = $terminalShutdownMarkerAfterReceipt
        terminalShutdownMarkerAtEof = $terminalShutdownMarkerAtEof
        terminalShutdownComplete = $terminalShutdownComplete
        exceptionStartCount = $exceptionMatches.Count
        knownPostReceiptVendorTooltipRescacheShutdownExceptionCount =
            $knownPostReceiptVendorTooltipRescacheShutdownExceptionCount
        knownPreReceiptVendorTooltipRescacheShutdownExceptionCount =
            $knownPreReceiptVendorTooltipRescacheShutdownExceptionCount
        knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount =
            $knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount
        knownPreReceiptVendorEnvironmentOnDisableShutdownExceptionCount =
            $knownPreReceiptVendorEnvironmentOnDisableShutdownExceptionCount
        knownApprovedPostReceiptShutdownExceptionCount =
            $knownApprovedPostReceiptShutdownExceptionCount
        unclassifiedExceptionCount = $unclassifiedExceptionCount
        exceptionDiagnosticLineCount = $exceptionDiagnosticLineMatches.Count
        knownApprovedPostReceiptExceptionDiagnosticLineCount =
            $knownApprovedPostReceiptExceptionDiagnosticLineCount
        unclassifiedExceptionDiagnosticLineCount =
            $unclassifiedExceptionDiagnosticLineCount
        exceptionFree = $exceptionDiagnosticLineMatches.Count -eq 0
        exceptionClassification = $exceptionClassification
        shutdownProfileSetId =
            'venviewer.grand-hall.lcc-native-shutdown-profile-set.v1'
        approvedShutdownProfile = $approvedShutdownProfile
        approvedShutdownProfileMatched = $approvedShutdownProfileMatched
        approvedShutdownProfileMatchCount = $approvedShutdownProfileMatchCount
        approvedShutdownProfileExactlyOneMatched =
            $approvedShutdownProfileMatchCount -eq 1
        approvedShutdownProfilesMutuallyExclusive =
            $approvedShutdownProfilesMutuallyExclusive
        approvedShutdownProfileFullyConsumed =
            $approvedShutdownProfileFullyConsumed
        approvedShutdownProfilePhaseSatisfied =
            $approvedShutdownProfilePhaseSatisfied
        tooltipShutdownBlocksConsecutive = $tooltipShutdownBlocksConsecutive
        environmentShutdownImmediatelyAfterReceiptMarker =
            $environmentShutdownImmediatelyAfterReceiptMarker
        shutdownProfileClassification = $shutdownProfileClassification
        shutdownProfileLimitation = if ($approvedShutdownProfile -ceq
            'clean_shutdown_no_exceptions') {
            'No exception diagnostics were observed after the uniquely bound receipt marker.'
        }
        else {
            'Two distinct vendor-only post-receipt teardown shapes were observed in artifact-complete, exit-code-zero runs across module builds with the same locked vendor runtime; selection cause remains unresolved. An exact limitation profile is not an ignored exception and not evidence of exception-free shutdown.'
        }
        onlyExpectedDiagnosticsObserved =
            $srgbFallbackWarningCount -eq 0 -and
            $knownStartupDbufferClearShaderErrorCount -eq 1 -and
            $unexpectedErrorLineCount -eq 0 -and
            $knownWindowsMediaFoundationUnknownColorPrimariesWarningCount -eq 1 -and
            $unexpectedWindowsMediaFoundationUnknownColorPrimariesWarningCount -eq 0 -and
            $approvedShutdownProfileMatched -and
            $approvedShutdownProfilesMutuallyExclusive -and
            $approvedShutdownProfileFullyConsumed -and
            $approvedShutdownProfilePhaseSatisfied -and
            $unclassifiedExceptionCount -eq 0 -and
            $unclassifiedExceptionDiagnosticLineCount -eq 0
    }
}

function Assert-ExpectedPlayerLogDiagnostics {
    param([Parameter(Mandatory = $true)]$Evidence)

    $cleanShutdownProfile =
        [string]$Evidence.approvedShutdownProfile -ceq
            'clean_shutdown_no_exceptions'
    if ([int]$Evidence.renderTextureSrgbFallbackWarningCount -ne 0 -or
        [int]$Evidence.knownStartupDbufferClearShaderUnsupportedErrorCount -ne 1 -or
        [int]$Evidence.unexpectedErrorLineCount -ne 0 -or
        [int]$Evidence.knownWindowsMediaFoundationUnknownColorPrimariesWarningCount -ne 1 -or
        [int]$Evidence.unexpectedWindowsMediaFoundationUnknownColorPrimariesWarningCount -ne 0 -or
        [bool]$Evidence.terminalShutdownComplete -ne $true -or
        [int]$Evidence.unclassifiedExceptionCount -ne 0 -or
        [int]$Evidence.unclassifiedExceptionDiagnosticLineCount -ne 0 -or
        [string]$Evidence.shutdownProfileSetId -cne
            'venviewer.grand-hall.lcc-native-shutdown-profile-set.v1' -or
        [bool]$Evidence.approvedShutdownProfileMatched -ne $true -or
        [int]$Evidence.approvedShutdownProfileMatchCount -ne 1 -or
        [bool]$Evidence.approvedShutdownProfileExactlyOneMatched -ne $true -or
        [bool]$Evidence.approvedShutdownProfilesMutuallyExclusive -ne $true -or
        [bool]$Evidence.approvedShutdownProfileFullyConsumed -ne $true -or
        [bool]$Evidence.approvedShutdownProfilePhaseSatisfied -ne $true -or
        ([string]$Evidence.approvedShutdownProfile -cne
            'clean_shutdown_no_exceptions' -and
            [string]$Evidence.approvedShutdownProfile -cne
            'tooltip_rescache_object_disposed_x5' -and
            [string]$Evidence.approvedShutdownProfile -cne
                'environment_on_disable_null_reference_x1') -or
        [bool]$Evidence.errorFree -ne $false -or
        [bool]$Evidence.windowsMediaFoundationWarningFree -ne $false -or
        [bool]$Evidence.exceptionFree -ne $cleanShutdownProfile -or
        [bool]$Evidence.onlyExpectedDiagnosticsObserved -ne $true) {
        throw 'Player.log diagnostics differ from the reviewed startup diagnostics plus one exact approved post-receipt shutdown profile contract.'
    }
}

function Assert-PlayerLogDiagnosticsRejected {
    param([Parameter(Mandatory = $true)]$Evidence)

    $rejected = $false
    try {
        Assert-ExpectedPlayerLogDiagnostics -Evidence $Evidence
    }
    catch {
        $rejected = $true
    }
    if (-not $rejected) {
        throw 'The Player.log diagnostics rejection self-test accepted an invalid fixture.'
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
        [AllowNull()]$PlayerLogEvidence,
        [AllowNull()][string]$NativeReceiptSha256,
        [AllowNull()][string]$FinalPngSha256,
        [AllowNull()][string]$RawRgb24Sha256,
        [AllowNull()][string]$ExpandedSrgbTagged16PngSha256
    )

    $finalPath = Join-Path $OutputDirectory 'grand-hall-native-capture-operator-receipt.json'
    if (Test-Path -LiteralPath $finalPath) {
        throw "Operator receipt path already exists: $finalPath"
    }
    $temporaryPath = Join-Path $OutputDirectory (
        '.grand-hall-native-capture-operator-receipt.tmp-' + [Guid]::NewGuid().ToString('N'))
    $receipt = [ordered]@{
        schemaVersion = 'venviewer.grand-hall.lcc-native-capture-operator-receipt.v4'
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
        playerLogEvidence = $PlayerLogEvidence
        executable = (Join-Path $approvedSandboxEditor 'LCCEditor.exe')
        canonicalScene = $scene
        outputDirectory = $OutputDirectory
        nativeReceiptSha256 = $NativeReceiptSha256
        finalPngSha256 = $FinalPngSha256
        rawRgb24Sha256 = $RawRgb24Sha256
        expandedSrgbTagged16PngSha256 = $ExpandedSrgbTagged16PngSha256
        playerLog = $playerLog
        limitations = @(
            'This operator receipt bounds process lifetime; it is not evidence that the native scene was accepted.',
            'On hard timeout the wrapper terminates the disposable LCCEditor process tree; in-process cleanup may not run.',
            'The per-user feature-toggle lease changes only com.venviewer.native_capture and restores the exact original bytes, timestamps, and attributes only after no LCCEditor process remains.',
            'If any owned or unexpected LCCEditor process remains alive, restoration is deferred and the durable backup plus marker are retained for stale recovery instead of racing a vendor write.',
            'If the leased target is neither the marker-bound augmented hash nor the reviewed original hash, the run fails and restores the durable reviewed original after every editor has exited.',
            'The lease reads the installed public EncryptUtil; it does not modify vendor binaries, CodeMeter, or any stock module ID.',
            'The run-specific Player.log evidence starts at the last exact approved-sandbox Unity startup marker and ends at EOF after process exit; unrelated prefix bytes are excluded.',
            'The exact single known startup DBufferClear unsupported-shader ERROR is classified and counted; errorFree remains false. Any other ERROR line fails a successful operator run.',
            'The exact single WindowsMediaFoundation unknown-color-primaries warning for sharedassets0.resource is classified as a limitation. It is not proof that the warning affected the SOG render.',
            'Two distinct vendor-only post-receipt teardown shapes were observed in artifact-complete, exit-code-zero runs across module builds with the same locked vendor runtime; their selection cause remains unresolved. The closed profile set permits either a complete clean shutdown with no exception diagnostics, five consecutive exact TooltipControl/ResCacheManager ObjectDisposedException blocks, or one exact Environment OnDisable NullReferenceException block immediately after the receipt marker. The two exception profiles are named limitations, not ignored exceptions; exceptionFree is true only for the clean profile.',
            'Every shutdown profile requires one exact terminal Input System shutdown marker at EOF. Mixed profiles, wrong counts, wrong stack ordering or phase, pre-receipt occurrences, extra or interleaved frames, unclassified exception diagnostics, incomplete logs, and requested-sRGB fallback warnings all fail the operator run.'
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

if ($PlayerLogAuditSelfTest) {
    $testRoot = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) (
        'venviewer-player-log-audit-test-' + [Guid]::NewGuid().ToString('N'))
    $testEditorRoot = [IO.Path]::GetFullPath('C:\Approved\LCCEditor')
    $startupMarker = "Mono path[0] = 'C:/Approved/LCCEditor/LCCEditor_Data/Managed'"
    $receiptPath = 'C:\Evidence\grand-hall-native-capture-receipt.json'
    $receiptSha256 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    $receiptMarker = '[VenviewerNativeCapture] Receipt: ' +
        $receiptPath + ' SHA-256 ' + $receiptSha256
    $knownDbufferError =
        'ERROR: Shader Hidden/Universal Render Pipeline/DBufferClear shader is not supported on this GPU (none of subshaders/fallbacks are suitable)'
    $knownWindowsMediaFoundationWarning =
        'Color primaries 0 is unknown or unsupported by WindowsMediaFoundation. Falling back to default may result in color shift. C:\Approved\LCCEditor\LCCEditor_Data\sharedassets0.resource'
    $terminalShutdownMarker =
        'Input System module state changed to: Shutdown.'
    $knownException = @'
ObjectDisposedException: Cannot access a disposed object.
Object name: 'ResCacheManager<Object>[ResManager.Resources.Object]'.
  at XGrids.LCCWorld.Res.ResCacheManager`1[T].Release (System.String key) [0x00089] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at XGrids.LCCWorld.Res.ResReleaserAdapter`1[T].Release (System.String key) [0x00000] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at XGrids.LCCWorld.Res.ResHandle`1[T].Dispose () [0x00010] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at Battlehub.UIControls.TooltipControl.TruncatedTextTooltip.OnDestroy () [0x0000a] in <ecf2cac8628d444a8ffff8a2c195da27>:0

'@
    $knownException = ($knownException -replace "`r?`n", "`r`n") + "`r`n"
    $interleavedException = @'
ObjectDisposedException: Cannot access a disposed object.
Object name: 'ResCacheManager<Object>[ResManager.Resources.Object]'.
  at XGrids.LCCWorld.Res.ResCacheManager`1[T].Release (System.String key) [0x00089] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at Unreviewed.Interleaved.Frame () [0x00001] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at XGrids.LCCWorld.Res.ResReleaserAdapter`1[T].Release (System.String key) [0x00000] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at XGrids.LCCWorld.Res.ResHandle`1[T].Dispose () [0x00010] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at Battlehub.UIControls.TooltipControl.TruncatedTextTooltip.OnDestroy () [0x0000a] in <ecf2cac8628d444a8ffff8a2c195da27>:0

'@
    $interleavedException =
        ($interleavedException -replace "`r?`n", "`r`n") + "`r`n"
    $knownEnvironmentException = @'
NullReferenceException: Object reference not set to an instance of an object.
  at UnityEngine.Bindings.ThrowHelper.ThrowNullReferenceException (System.Object obj) [0x00018] in <7605667304d149c99f4a7b2919f242b4>:0
  at UnityEngine.Behaviour.get_enabled () [0x00006] in <7605667304d149c99f4a7b2919f242b4>:0
  at LCCCore.LCCManager.SetEnvironment (LCCCore.Renderer _renderer, System.Boolean _isRender) [0x00000] in <eff3262970214cd9930e18bf8abd6d90>:0
  at XGrids.LCCWorld.Framework.LCCSceneManager.SetEnvironmentData (System.Boolean isOn, LCCCore.Renderer renderer) [0x00027] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at XGrids.LCCWorld.Framework.LCCEnvironmentComponent.OnRTEDisabled () [0x00008] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at XGrids.LCCWorld.RTCommon.RTEEventHub.OnAnyDisabled (Battlehub.RTCommon.RuntimeAsset obj) [0x0002c] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at (wrapper delegate-invoke) <Module>.invoke_void_RuntimeAsset(Battlehub.RTCommon.RuntimeAsset)
  at Battlehub.RTCommon.RuntimeAsset.OnDisable () [0x00013] in <ecf2cac8628d444a8ffff8a2c195da27>:0

'@
    $knownEnvironmentException =
        ($knownEnvironmentException -replace "`r?`n", "`r`n") + "`r`n"
    $environmentExtraFrameException = @'
NullReferenceException: Object reference not set to an instance of an object.
  at UnityEngine.Bindings.ThrowHelper.ThrowNullReferenceException (System.Object obj) [0x00018] in <7605667304d149c99f4a7b2919f242b4>:0
  at UnityEngine.Behaviour.get_enabled () [0x00006] in <7605667304d149c99f4a7b2919f242b4>:0
  at Unreviewed.Interleaved.EnvironmentFrame () [0x00001] in <abcdef0123456789>:0
  at LCCCore.LCCManager.SetEnvironment (LCCCore.Renderer _renderer, System.Boolean _isRender) [0x00000] in <eff3262970214cd9930e18bf8abd6d90>:0
  at XGrids.LCCWorld.Framework.LCCSceneManager.SetEnvironmentData (System.Boolean isOn, LCCCore.Renderer renderer) [0x00027] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at XGrids.LCCWorld.Framework.LCCEnvironmentComponent.OnRTEDisabled () [0x00008] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at XGrids.LCCWorld.RTCommon.RTEEventHub.OnAnyDisabled (Battlehub.RTCommon.RuntimeAsset obj) [0x0002c] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at (wrapper delegate-invoke) <Module>.invoke_void_RuntimeAsset(Battlehub.RTCommon.RuntimeAsset)
  at Battlehub.RTCommon.RuntimeAsset.OnDisable () [0x00013] in <ecf2cac8628d444a8ffff8a2c195da27>:0

'@
    $environmentExtraFrameException =
        ($environmentExtraFrameException -replace "`r?`n", "`r`n") + "`r`n"
    $environmentWrongOrderException = @'
NullReferenceException: Object reference not set to an instance of an object.
  at UnityEngine.Bindings.ThrowHelper.ThrowNullReferenceException (System.Object obj) [0x00018] in <7605667304d149c99f4a7b2919f242b4>:0
  at UnityEngine.Behaviour.get_enabled () [0x00006] in <7605667304d149c99f4a7b2919f242b4>:0
  at XGrids.LCCWorld.Framework.LCCSceneManager.SetEnvironmentData (System.Boolean isOn, LCCCore.Renderer renderer) [0x00027] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at LCCCore.LCCManager.SetEnvironment (LCCCore.Renderer _renderer, System.Boolean _isRender) [0x00000] in <eff3262970214cd9930e18bf8abd6d90>:0
  at XGrids.LCCWorld.Framework.LCCEnvironmentComponent.OnRTEDisabled () [0x00008] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at XGrids.LCCWorld.RTCommon.RTEEventHub.OnAnyDisabled (Battlehub.RTCommon.RuntimeAsset obj) [0x0002c] in <ecf2cac8628d444a8ffff8a2c195da27>:0
  at (wrapper delegate-invoke) <Module>.invoke_void_RuntimeAsset(Battlehub.RTCommon.RuntimeAsset)
  at Battlehub.RTCommon.RuntimeAsset.OnDisable () [0x00013] in <ecf2cac8628d444a8ffff8a2c195da27>:0

'@
    $environmentWrongOrderException =
        ($environmentWrongOrderException -replace "`r?`n", "`r`n") + "`r`n"
    function Invoke-PlayerLogAuditFixture {
        param(
            [Parameter(Mandatory = $true)][string]$Name,
            [Parameter(Mandatory = $true)][string]$RunText
        )

        $source = Join-Path $testRoot ($Name + '-player.log')
        [IO.File]::WriteAllText($source, 'old', $utf8)
        $before = Get-PlayerLogFingerprint -Path $source
        $fixtureOutput = Join-Path $testRoot ($Name + '-output')
        New-Item -ItemType Directory -Path $fixtureOutput | Out-Null
        [IO.File]::WriteAllText($source, $RunText, $utf8)
        return Write-RunPlayerLogEvidence `
            -SourcePath $source `
            -OutputDirectory $fixtureOutput `
            -ApprovedEditorRoot $testEditorRoot `
            -PreRunFingerprint $before `
            -LaunchStartedUtcTicks ([DateTime]::UtcNow.AddMinutes(-1).Ticks) `
            -NativeReceiptPath $receiptPath `
            -NativeReceiptSha256 $receiptSha256 `
            -RequireNativeReceiptBinding $true
    }
    try {
        New-Item -ItemType Directory -Path $testRoot | Out-Null
        $utf8 = [Text.UTF8Encoding]::new($false)

        $knownSource = Join-Path $testRoot 'known-player.log'
        [IO.File]::WriteAllText($knownSource, "unrelated prior log secret`r`n", $utf8)
        $knownBefore = Get-PlayerLogFingerprint -Path $knownSource
        $knownOutput = Join-Path $testRoot 'known-output'
        New-Item -ItemType Directory -Path $knownOutput | Out-Null
        $knownRun = "unrelated prior log secret`r`n" + $startupMarker + "`r`n" +
            $knownDbufferError + "`r`n" +
            $knownWindowsMediaFoundationWarning + "`r`n" +
            $receiptMarker + "`r`n" + $knownException + $knownException +
            $knownException + $knownException + $knownException +
            $terminalShutdownMarker + "`r`n"
        [IO.File]::WriteAllText($knownSource, $knownRun, $utf8)
        $knownEvidence = Write-RunPlayerLogEvidence `
            -SourcePath $knownSource `
            -OutputDirectory $knownOutput `
            -ApprovedEditorRoot $testEditorRoot `
            -PreRunFingerprint $knownBefore `
            -LaunchStartedUtcTicks ([DateTime]::UtcNow.AddMinutes(-1).Ticks) `
            -NativeReceiptPath $receiptPath `
            -NativeReceiptSha256 $receiptSha256 `
            -RequireNativeReceiptBinding $true
        $knownPublishedText = [IO.File]::ReadAllText([string]$knownEvidence.runLogPath, $utf8)
        if ($knownPublishedText.Contains('unrelated prior log secret') -or
            [int]$knownEvidence.exactApprovedSandboxStartupMarkerCount -ne 1 -or
            [int]$knownEvidence.nativeReceiptMarkerCount -ne 1 -or
            [int]$knownEvidence.renderTextureSrgbFallbackWarningCount -ne 0 -or
            [int]$knownEvidence.errorLineCount -ne 1 -or
            [int]$knownEvidence.knownStartupDbufferClearShaderUnsupportedErrorCount -ne 1 -or
            [int]$knownEvidence.unexpectedErrorLineCount -ne 0 -or
            [bool]$knownEvidence.errorFree -ne $false -or
            [int]$knownEvidence.windowsMediaFoundationUnknownColorPrimariesWarningCount -ne 1 -or
            [int]$knownEvidence.knownWindowsMediaFoundationUnknownColorPrimariesWarningCount -ne 1 -or
            [int]$knownEvidence.unexpectedWindowsMediaFoundationUnknownColorPrimariesWarningCount -ne 0 -or
            [bool]$knownEvidence.windowsMediaFoundationWarningFree -ne $false -or
            [int]$knownEvidence.exceptionStartCount -ne 5 -or
            [int]$knownEvidence.knownPostReceiptVendorTooltipRescacheShutdownExceptionCount -ne 5 -or
            [int]$knownEvidence.knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount -ne 0 -or
            [int]$knownEvidence.unclassifiedExceptionCount -ne 0 -or
            [bool]$knownEvidence.exceptionFree -ne $false -or
            [string]$knownEvidence.approvedShutdownProfile -cne
                'tooltip_rescache_object_disposed_x5' -or
            [bool]$knownEvidence.approvedShutdownProfileMatched -ne $true -or
            [bool]$knownEvidence.onlyExpectedDiagnosticsObserved -ne $true -or
            [string]$knownEvidence.exceptionClassification -cne
                'one_exact_approved_post_receipt_shutdown_limitation_profile_observed') {
            throw ('The Player.log audit self-test did not classify the bounded known-shutdown fixture exactly: errors=' +
                [string]$knownEvidence.errorLineCount + ', knownErrors=' +
                [string]$knownEvidence.knownStartupDbufferClearShaderUnsupportedErrorCount +
                ', wmf=' + [string]$knownEvidence.windowsMediaFoundationUnknownColorPrimariesWarningCount +
                ', exceptions=' + [string]$knownEvidence.exceptionStartCount +
                ', knownExceptions=' +
                [string]$knownEvidence.knownPostReceiptVendorTooltipRescacheShutdownExceptionCount +
                ', unclassifiedExceptions=' + [string]$knownEvidence.unclassifiedExceptionCount + '.')
        }
        Assert-ExpectedPlayerLogDiagnostics -Evidence $knownEvidence

        $environmentSource = Join-Path $testRoot 'environment-profile-player.log'
        [IO.File]::WriteAllText($environmentSource, 'old', $utf8)
        $environmentBefore = Get-PlayerLogFingerprint -Path $environmentSource
        $environmentOutput = Join-Path $testRoot 'environment-profile-output'
        New-Item -ItemType Directory -Path $environmentOutput | Out-Null
        [IO.File]::WriteAllText(
            $environmentSource,
            $startupMarker + "`r`n" + $knownDbufferError + "`r`n" +
                $knownWindowsMediaFoundationWarning + "`r`n" +
                $receiptMarker + "`r`n" + $knownEnvironmentException +
                "[ModelManagerService] All models cleared`r`n" +
                $terminalShutdownMarker + "`r`n",
            $utf8)
        $environmentEvidence = Write-RunPlayerLogEvidence `
            -SourcePath $environmentSource `
            -OutputDirectory $environmentOutput `
            -ApprovedEditorRoot $testEditorRoot `
            -PreRunFingerprint $environmentBefore `
            -LaunchStartedUtcTicks ([DateTime]::UtcNow.AddMinutes(-1).Ticks) `
            -NativeReceiptPath $receiptPath `
            -NativeReceiptSha256 $receiptSha256 `
            -RequireNativeReceiptBinding $true
        if ([int]$environmentEvidence.exceptionStartCount -ne 1 -or
            [int]$environmentEvidence.knownPostReceiptVendorTooltipRescacheShutdownExceptionCount -ne 0 -or
            [int]$environmentEvidence.knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount -ne 1 -or
            [int]$environmentEvidence.unclassifiedExceptionCount -ne 0 -or
            [bool]$environmentEvidence.exceptionFree -ne $false -or
            [string]$environmentEvidence.approvedShutdownProfile -cne
                'environment_on_disable_null_reference_x1' -or
            [bool]$environmentEvidence.approvedShutdownProfileMatched -ne $true -or
            [bool]$environmentEvidence.onlyExpectedDiagnosticsObserved -ne $true -or
            [string]$environmentEvidence.exceptionClassification -cne
                'one_exact_approved_post_receipt_shutdown_limitation_profile_observed') {
            throw 'The Player.log audit self-test did not classify the exact Environment OnDisable shutdown profile.'
        }
        Assert-ExpectedPlayerLogDiagnostics -Evidence $environmentEvidence

        $cleanSource = Join-Path $testRoot 'clean-profile-player.log'
        [IO.File]::WriteAllText($cleanSource, 'old', $utf8)
        $cleanBefore = Get-PlayerLogFingerprint -Path $cleanSource
        $cleanOutput = Join-Path $testRoot 'clean-profile-output'
        New-Item -ItemType Directory -Path $cleanOutput | Out-Null
        [IO.File]::WriteAllText(
            $cleanSource,
            $startupMarker + "`r`n" + $knownDbufferError + "`r`n" +
                $knownWindowsMediaFoundationWarning + "`r`n" +
                $receiptMarker + "`r`n" +
                "[ModelManagerService] All models cleared`r`n" +
                $terminalShutdownMarker + "`r`n",
            $utf8)
        $cleanEvidence = Write-RunPlayerLogEvidence `
            -SourcePath $cleanSource `
            -OutputDirectory $cleanOutput `
            -ApprovedEditorRoot $testEditorRoot `
            -PreRunFingerprint $cleanBefore `
            -LaunchStartedUtcTicks ([DateTime]::UtcNow.AddMinutes(-1).Ticks) `
            -NativeReceiptPath $receiptPath `
            -NativeReceiptSha256 $receiptSha256 `
            -RequireNativeReceiptBinding $true
        if ([int]$cleanEvidence.exceptionStartCount -ne 0 -or
            [int]$cleanEvidence.exceptionDiagnosticLineCount -ne 0 -or
            [bool]$cleanEvidence.exceptionFree -ne $true -or
            [string]$cleanEvidence.approvedShutdownProfile -cne
                'clean_shutdown_no_exceptions' -or
            [bool]$cleanEvidence.approvedShutdownProfileMatched -ne $true -or
            [bool]$cleanEvidence.terminalShutdownComplete -ne $true -or
            [bool]$cleanEvidence.onlyExpectedDiagnosticsObserved -ne $true -or
            [string]$cleanEvidence.exceptionClassification -cne
                'one_exact_approved_clean_shutdown_profile_observed') {
            throw 'The Player.log audit self-test did not accept an exact complete exception-free shutdown profile.'
        }
        Assert-ExpectedPlayerLogDiagnostics -Evidence $cleanEvidence

        $truncatedCleanEvidence = Invoke-PlayerLogAuditFixture `
            -Name 'truncated-clean-profile' `
            -RunText ($startupMarker + "`r`n" + $knownDbufferError + "`r`n" +
                $knownWindowsMediaFoundationWarning + "`r`n" +
                $receiptMarker + "`r`n[ModelManagerService] All models cleared`r`n")
        if ([bool]$truncatedCleanEvidence.exceptionFree -ne $true -or
            [bool]$truncatedCleanEvidence.terminalShutdownComplete -ne $false -or
            [bool]$truncatedCleanEvidence.approvedShutdownProfileMatched -ne $false -or
            [bool]$truncatedCleanEvidence.onlyExpectedDiagnosticsObserved -ne $false) {
            throw 'The Player.log audit self-test accepted a truncated clean shutdown without the terminal marker.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $truncatedCleanEvidence

        $unexpectedSource = Join-Path $testRoot 'unexpected-player.log'
        [IO.File]::WriteAllText($unexpectedSource, 'old', $utf8)
        $unexpectedBefore = Get-PlayerLogFingerprint -Path $unexpectedSource
        $unexpectedOutput = Join-Path $testRoot 'unexpected-output'
        New-Item -ItemType Directory -Path $unexpectedOutput | Out-Null
        [IO.File]::WriteAllText(
            $unexpectedSource,
            $startupMarker + "`r`n" + $receiptMarker +
                "`r`nNullReferenceException: unclassified fixture`r`n`r`n" +
                $terminalShutdownMarker + "`r`n",
            $utf8)
        $unexpectedEvidence = Write-RunPlayerLogEvidence `
            -SourcePath $unexpectedSource `
            -OutputDirectory $unexpectedOutput `
            -ApprovedEditorRoot $testEditorRoot `
            -PreRunFingerprint $unexpectedBefore `
            -LaunchStartedUtcTicks ([DateTime]::UtcNow.AddMinutes(-1).Ticks) `
            -NativeReceiptPath $receiptPath `
            -NativeReceiptSha256 $receiptSha256 `
            -RequireNativeReceiptBinding $true
        if ([int]$unexpectedEvidence.exceptionStartCount -ne 1 -or
            [int]$unexpectedEvidence.unclassifiedExceptionCount -ne 1 -or
            [bool]$unexpectedEvidence.exceptionFree -ne $false -or
            [string]$unexpectedEvidence.exceptionClassification -cne
                'unclassified_extended_reordered_or_pre_receipt_exception_rejected') {
            throw 'The Player.log audit self-test did not surface an unclassified exception.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $unexpectedEvidence

        $unexpectedErrorSource = Join-Path $testRoot 'unexpected-error-player.log'
        [IO.File]::WriteAllText($unexpectedErrorSource, 'old', $utf8)
        $unexpectedErrorBefore = Get-PlayerLogFingerprint -Path $unexpectedErrorSource
        $unexpectedErrorOutput = Join-Path $testRoot 'unexpected-error-output'
        New-Item -ItemType Directory -Path $unexpectedErrorOutput | Out-Null
        [IO.File]::WriteAllText(
            $unexpectedErrorSource,
            $startupMarker + "`r`nERROR: unexpected fixture`r`n" +
                $receiptMarker + "`r`n" + $terminalShutdownMarker + "`r`n",
            $utf8)
        $unexpectedErrorEvidence = Write-RunPlayerLogEvidence `
            -SourcePath $unexpectedErrorSource `
            -OutputDirectory $unexpectedErrorOutput `
            -ApprovedEditorRoot $testEditorRoot `
            -PreRunFingerprint $unexpectedErrorBefore `
            -LaunchStartedUtcTicks ([DateTime]::UtcNow.AddMinutes(-1).Ticks) `
            -NativeReceiptPath $receiptPath `
            -NativeReceiptSha256 $receiptSha256 `
            -RequireNativeReceiptBinding $true
        if ([int]$unexpectedErrorEvidence.errorLineCount -ne 1 -or
            [int]$unexpectedErrorEvidence.knownStartupDbufferClearShaderUnsupportedErrorCount -ne 0 -or
            [int]$unexpectedErrorEvidence.unexpectedErrorLineCount -ne 1 -or
            [bool]$unexpectedErrorEvidence.errorFree -ne $false -or
            [bool]$unexpectedErrorEvidence.onlyExpectedDiagnosticsObserved -ne $false) {
            throw 'The Player.log audit self-test did not surface an unexpected ERROR line.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $unexpectedErrorEvidence

        $prefixedErrorEvidence = Invoke-PlayerLogAuditFixture `
            -Name 'prefixed-error-line' `
            -RunText ($startupMarker + "`r`n" +
                "2026-08-31T20:30:34Z ERROR: prefixed fixture`r`n" +
                $knownWindowsMediaFoundationWarning + "`r`n" +
                $receiptMarker + "`r`n" + $terminalShutdownMarker + "`r`n")
        if ([int]$prefixedErrorEvidence.errorLineCount -ne 1 -or
            [int]$prefixedErrorEvidence.knownStartupDbufferClearShaderUnsupportedErrorCount -ne 0 -or
            [int]$prefixedErrorEvidence.unexpectedErrorLineCount -ne 1 -or
            [bool]$prefixedErrorEvidence.onlyExpectedDiagnosticsObserved -ne $false) {
            throw 'The Player.log audit self-test did not reject a prefixed unexpected ERROR line.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $prefixedErrorEvidence

        $unexpectedWmfSource = Join-Path $testRoot 'unexpected-wmf-player.log'
        [IO.File]::WriteAllText($unexpectedWmfSource, 'old', $utf8)
        $unexpectedWmfBefore = Get-PlayerLogFingerprint -Path $unexpectedWmfSource
        $unexpectedWmfOutput = Join-Path $testRoot 'unexpected-wmf-output'
        New-Item -ItemType Directory -Path $unexpectedWmfOutput | Out-Null
        [IO.File]::WriteAllText(
            $unexpectedWmfSource,
            $startupMarker + "`r`n" + $knownDbufferError + "`r`n" +
                'Unexpected WindowsMediaFoundation fixture' + "`r`n" +
                $receiptMarker + "`r`n" + $knownException + $knownException +
                $knownException + $knownException + $knownException +
                $terminalShutdownMarker + "`r`n",
            $utf8)
        $unexpectedWmfEvidence = Write-RunPlayerLogEvidence `
            -SourcePath $unexpectedWmfSource `
            -OutputDirectory $unexpectedWmfOutput `
            -ApprovedEditorRoot $testEditorRoot `
            -PreRunFingerprint $unexpectedWmfBefore `
            -LaunchStartedUtcTicks ([DateTime]::UtcNow.AddMinutes(-1).Ticks) `
            -NativeReceiptPath $receiptPath `
            -NativeReceiptSha256 $receiptSha256 `
            -RequireNativeReceiptBinding $true
        if ([int]$unexpectedWmfEvidence.unexpectedWindowsMediaFoundationUnknownColorPrimariesWarningCount -ne 1 -or
            [bool]$unexpectedWmfEvidence.onlyExpectedDiagnosticsObserved -ne $false) {
            throw 'The Player.log audit self-test did not surface an unexpected WindowsMediaFoundation line.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $unexpectedWmfEvidence

        $interleavedSource = Join-Path $testRoot 'interleaved-shutdown-player.log'
        [IO.File]::WriteAllText($interleavedSource, 'old', $utf8)
        $interleavedBefore = Get-PlayerLogFingerprint -Path $interleavedSource
        $interleavedOutput = Join-Path $testRoot 'interleaved-shutdown-output'
        New-Item -ItemType Directory -Path $interleavedOutput | Out-Null
        [IO.File]::WriteAllText(
            $interleavedSource,
            $startupMarker + "`r`n" + $knownDbufferError + "`r`n" +
                $knownWindowsMediaFoundationWarning + "`r`n" +
                $receiptMarker + "`r`n" + $knownException + $knownException +
                $knownException + $knownException + $interleavedException +
                $terminalShutdownMarker + "`r`n",
            $utf8)
        $interleavedEvidence = Write-RunPlayerLogEvidence `
            -SourcePath $interleavedSource `
            -OutputDirectory $interleavedOutput `
            -ApprovedEditorRoot $testEditorRoot `
            -PreRunFingerprint $interleavedBefore `
            -LaunchStartedUtcTicks ([DateTime]::UtcNow.AddMinutes(-1).Ticks) `
            -NativeReceiptPath $receiptPath `
            -NativeReceiptSha256 $receiptSha256 `
            -RequireNativeReceiptBinding $true
        if ([int]$interleavedEvidence.exceptionStartCount -ne 5 -or
            [int]$interleavedEvidence.knownPostReceiptVendorTooltipRescacheShutdownExceptionCount -ne 4 -or
            [int]$interleavedEvidence.unclassifiedExceptionCount -ne 1 -or
            [bool]$interleavedEvidence.onlyExpectedDiagnosticsObserved -ne $false) {
            throw 'The Player.log audit self-test accepted an interleaved shutdown stack frame as known.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $interleavedEvidence

        $fixturePrefix = $startupMarker + "`r`n" + $knownDbufferError + "`r`n" +
            $knownWindowsMediaFoundationWarning + "`r`n"

        $mixedEvidence = Invoke-PlayerLogAuditFixture `
            -Name 'mixed-shutdown-profiles' `
            -RunText ($fixturePrefix + $receiptMarker + "`r`n" +
                $knownException + $knownException + $knownException +
                $knownException + $knownException + $knownEnvironmentException +
                $terminalShutdownMarker + "`r`n")
        if ([int]$mixedEvidence.exceptionStartCount -ne 6 -or
            [int]$mixedEvidence.knownPostReceiptVendorTooltipRescacheShutdownExceptionCount -ne 5 -or
            [int]$mixedEvidence.knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount -ne 1 -or
            [int]$mixedEvidence.unclassifiedExceptionCount -ne 0 -or
            [bool]$mixedEvidence.approvedShutdownProfilesMutuallyExclusive -ne $false -or
            [bool]$mixedEvidence.approvedShutdownProfileMatched -ne $false -or
            [string]$mixedEvidence.shutdownProfileClassification -cne
                'mixed_approved_shutdown_shapes_rejected') {
            throw 'The Player.log audit self-test accepted mixed approved shutdown shapes.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $mixedEvidence

        $wrongTooltipCountEvidence = Invoke-PlayerLogAuditFixture `
            -Name 'wrong-tooltip-count' `
            -RunText ($fixturePrefix + $receiptMarker + "`r`n" +
                $knownException + $knownException + $knownException + $knownException +
                $terminalShutdownMarker + "`r`n")
        if ([int]$wrongTooltipCountEvidence.exceptionStartCount -ne 4 -or
            [int]$wrongTooltipCountEvidence.knownPostReceiptVendorTooltipRescacheShutdownExceptionCount -ne 4 -or
            [int]$wrongTooltipCountEvidence.unclassifiedExceptionCount -ne 0 -or
            [bool]$wrongTooltipCountEvidence.approvedShutdownProfileMatched -ne $false -or
            [string]$wrongTooltipCountEvidence.shutdownProfileClassification -cne
                'approved_shutdown_profile_count_mismatch_or_missing_profile_rejected') {
            throw 'The Player.log audit self-test accepted the wrong Tooltip/ResCache profile count.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $wrongTooltipCountEvidence

        $tooManyTooltipEvidence = Invoke-PlayerLogAuditFixture `
            -Name 'too-many-tooltip-blocks' `
            -RunText ($fixturePrefix + $receiptMarker + "`r`n" +
                $knownException + $knownException + $knownException +
                $knownException + $knownException + $knownException +
                $terminalShutdownMarker + "`r`n")
        if ([int]$tooManyTooltipEvidence.exceptionStartCount -ne 6 -or
            [int]$tooManyTooltipEvidence.knownPostReceiptVendorTooltipRescacheShutdownExceptionCount -ne 6 -or
            [bool]$tooManyTooltipEvidence.approvedShutdownProfileMatched -ne $false) {
            throw 'The Player.log audit self-test accepted six Tooltip/ResCache blocks.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $tooManyTooltipEvidence

        $nonconsecutiveTooltipEvidence = Invoke-PlayerLogAuditFixture `
            -Name 'nonconsecutive-tooltip-blocks' `
            -RunText ($fixturePrefix + $receiptMarker + "`r`n" +
                $knownException + $knownException +
                "[ModelManagerService] intervening cleanup record`r`n" +
                $knownException + $knownException + $knownException +
                $terminalShutdownMarker + "`r`n")
        if ([int]$nonconsecutiveTooltipEvidence.knownPostReceiptVendorTooltipRescacheShutdownExceptionCount -ne 5 -or
            [bool]$nonconsecutiveTooltipEvidence.tooltipShutdownBlocksConsecutive -ne $false -or
            [bool]$nonconsecutiveTooltipEvidence.approvedShutdownProfileMatched -ne $false -or
            [string]$nonconsecutiveTooltipEvidence.shutdownProfileClassification -cne
                'tooltip_shutdown_profile_nonconsecutive_blocks_rejected') {
            throw 'The Player.log audit self-test accepted separated Tooltip/ResCache blocks.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $nonconsecutiveTooltipEvidence

        $wrongEnvironmentCountEvidence = Invoke-PlayerLogAuditFixture `
            -Name 'wrong-environment-count' `
            -RunText ($fixturePrefix + $receiptMarker + "`r`n" +
                $knownEnvironmentException + $knownEnvironmentException +
                $terminalShutdownMarker + "`r`n")
        if ([int]$wrongEnvironmentCountEvidence.exceptionStartCount -ne 2 -or
            [int]$wrongEnvironmentCountEvidence.knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount -ne 2 -or
            [int]$wrongEnvironmentCountEvidence.unclassifiedExceptionCount -ne 0 -or
            [bool]$wrongEnvironmentCountEvidence.approvedShutdownProfileMatched -ne $false -or
            [string]$wrongEnvironmentCountEvidence.shutdownProfileClassification -cne
                'approved_shutdown_profile_count_mismatch_or_missing_profile_rejected') {
            throw 'The Player.log audit self-test accepted the wrong Environment OnDisable profile count.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $wrongEnvironmentCountEvidence

        $delayedEnvironmentEvidence = Invoke-PlayerLogAuditFixture `
            -Name 'delayed-environment-profile' `
            -RunText ($fixturePrefix + $receiptMarker + "`r`n" +
                "[ModelManagerService] intervening cleanup record`r`n" +
                $knownEnvironmentException + $terminalShutdownMarker + "`r`n")
        if ([int]$delayedEnvironmentEvidence.knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount -ne 1 -or
            [bool]$delayedEnvironmentEvidence.environmentShutdownImmediatelyAfterReceiptMarker -ne $false -or
            [bool]$delayedEnvironmentEvidence.approvedShutdownProfileMatched -ne $false -or
            [string]$delayedEnvironmentEvidence.shutdownProfileClassification -cne
                'environment_shutdown_profile_phase_relation_rejected') {
            throw 'The Player.log audit self-test accepted a delayed Environment OnDisable block.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $delayedEnvironmentEvidence

        $wrongOrderEvidence = Invoke-PlayerLogAuditFixture `
            -Name 'wrong-environment-order' `
            -RunText ($fixturePrefix + $receiptMarker + "`r`n" +
                $environmentWrongOrderException + $terminalShutdownMarker + "`r`n")
        if ([int]$wrongOrderEvidence.exceptionStartCount -ne 1 -or
            [int]$wrongOrderEvidence.knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount -ne 0 -or
            [int]$wrongOrderEvidence.unclassifiedExceptionCount -ne 1 -or
            [bool]$wrongOrderEvidence.approvedShutdownProfileMatched -ne $false) {
            throw 'The Player.log audit self-test accepted a reordered Environment OnDisable stack.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $wrongOrderEvidence

        $preReceiptEvidence = Invoke-PlayerLogAuditFixture `
            -Name 'pre-receipt-environment' `
            -RunText ($fixturePrefix + $knownEnvironmentException +
                $receiptMarker + "`r`n" + $knownEnvironmentException +
                $terminalShutdownMarker + "`r`n")
        if ([int]$preReceiptEvidence.exceptionStartCount -ne 2 -or
            [int]$preReceiptEvidence.knownPreReceiptVendorEnvironmentOnDisableShutdownExceptionCount -ne 1 -or
            [int]$preReceiptEvidence.knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount -ne 1 -or
            [int]$preReceiptEvidence.unclassifiedExceptionCount -ne 1 -or
            [bool]$preReceiptEvidence.approvedShutdownProfileMatched -ne $false) {
            throw 'The Player.log audit self-test accepted a pre-receipt approved shutdown shape.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $preReceiptEvidence

        $environmentExtraFrameEvidence = Invoke-PlayerLogAuditFixture `
            -Name 'environment-extra-frame' `
            -RunText ($fixturePrefix + $receiptMarker + "`r`n" +
                $environmentExtraFrameException + $terminalShutdownMarker + "`r`n")
        if ([int]$environmentExtraFrameEvidence.exceptionStartCount -ne 1 -or
            [int]$environmentExtraFrameEvidence.knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount -ne 0 -or
            [int]$environmentExtraFrameEvidence.unclassifiedExceptionCount -ne 1 -or
            [bool]$environmentExtraFrameEvidence.approvedShutdownProfileMatched -ne $false) {
            throw 'The Player.log audit self-test accepted an extra Environment OnDisable stack frame.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $environmentExtraFrameEvidence

        $alteredOffsetEnvironmentException =
            $knownEnvironmentException.Replace('[0x00027]', '[0x00028]')
        $alteredOffsetEvidence = Invoke-PlayerLogAuditFixture `
            -Name 'environment-altered-offset' `
            -RunText ($fixturePrefix + $receiptMarker + "`r`n" +
                $alteredOffsetEnvironmentException + $terminalShutdownMarker + "`r`n")
        if ([int]$alteredOffsetEvidence.knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount -ne 0 -or
            [int]$alteredOffsetEvidence.unclassifiedExceptionDiagnosticLineCount -le 0 -or
            [bool]$alteredOffsetEvidence.approvedShutdownProfileMatched -ne $false) {
            throw 'The Player.log audit self-test accepted an altered Environment stack offset.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $alteredOffsetEvidence

        $prefixedExceptionEvidence = Invoke-PlayerLogAuditFixture `
            -Name 'prefixed-exception-diagnostic' `
            -RunText ($fixturePrefix + $receiptMarker + "`r`n" +
                "2026-08-31T20:30:34Z Exception: prefixed fixture`r`n" +
                $terminalShutdownMarker + "`r`n")
        if ([int]$prefixedExceptionEvidence.exceptionDiagnosticLineCount -ne 1 -or
            [int]$prefixedExceptionEvidence.unclassifiedExceptionDiagnosticLineCount -ne 1 -or
            [bool]$prefixedExceptionEvidence.exceptionFree -ne $false -or
            [bool]$prefixedExceptionEvidence.approvedShutdownProfileMatched -ne $false) {
            throw 'The Player.log audit self-test accepted a prefixed exception diagnostic.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $prefixedExceptionEvidence

        $warningSource = Join-Path $testRoot 'warning-player.log'
        [IO.File]::WriteAllText($warningSource, 'old', $utf8)
        $warningBefore = Get-PlayerLogFingerprint -Path $warningSource
        $warningOutput = Join-Path $testRoot 'warning-output'
        New-Item -ItemType Directory -Path $warningOutput | Out-Null
        $srgbFallbackWarning =
            'Requested RenderTexture with sRGB format. sRGB formats are not supported in gamma mode, fallback to a UNorm format. Use a UNorm format instead of sRGB to silence this warning.'
        [IO.File]::WriteAllText(
            $warningSource,
            $startupMarker + "`r`n" + $receiptMarker + "`r`n" +
                $srgbFallbackWarning + "`r`n" +
                $terminalShutdownMarker + "`r`n",
            $utf8)
        $warningEvidence = Write-RunPlayerLogEvidence `
            -SourcePath $warningSource `
            -OutputDirectory $warningOutput `
            -ApprovedEditorRoot $testEditorRoot `
            -PreRunFingerprint $warningBefore `
            -LaunchStartedUtcTicks ([DateTime]::UtcNow.AddMinutes(-1).Ticks) `
            -NativeReceiptPath $receiptPath `
            -NativeReceiptSha256 $receiptSha256 `
            -RequireNativeReceiptBinding $true
        if ([int]$warningEvidence.renderTextureSrgbFallbackWarningCount -ne 1) {
            throw 'The Player.log audit self-test did not detect the sRGB fallback warning.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $warningEvidence

        $missingReceiptRejected = $false
        try {
            $missingOutput = Join-Path $testRoot 'missing-output'
            New-Item -ItemType Directory -Path $missingOutput | Out-Null
            $null = Write-RunPlayerLogEvidence `
                -SourcePath $warningSource `
                -OutputDirectory $missingOutput `
                -ApprovedEditorRoot $testEditorRoot `
                -PreRunFingerprint $warningBefore `
                -LaunchStartedUtcTicks ([DateTime]::UtcNow.AddMinutes(-1).Ticks) `
                -NativeReceiptPath 'C:\Evidence\different.json' `
                -NativeReceiptSha256 $receiptSha256 `
                -RequireNativeReceiptBinding $true
        }
        catch {
            $missingReceiptRejected = $true
        }
        if (-not $missingReceiptRejected) {
            throw 'The Player.log audit self-test accepted a missing native receipt marker.'
        }

        $duplicateReceiptRejected = $false
        try {
            $null = Invoke-PlayerLogAuditFixture `
                -Name 'duplicate-receipt-marker' `
                -RunText ($fixturePrefix + $receiptMarker + "`r`n" +
                    $receiptMarker + "`r`n" + $terminalShutdownMarker + "`r`n")
        }
        catch {
            $duplicateReceiptRejected = $true
        }
        if (-not $duplicateReceiptRejected) {
            throw 'The Player.log audit self-test accepted duplicate native receipt markers.'
        }

        $embeddedReceiptRejected = $false
        try {
            $null = Invoke-PlayerLogAuditFixture `
                -Name 'embedded-receipt-marker' `
                -RunText ($fixturePrefix + 'prefix ' + $receiptMarker +
                    " suffix`r`n" + $terminalShutdownMarker + "`r`n")
        }
        catch {
            $embeddedReceiptRejected = $true
        }
        if (-not $embeddedReceiptRejected) {
            throw 'The Player.log audit self-test accepted an embedded native receipt marker.'
        }

        $suffixedStartupRejected = $false
        try {
            $null = Invoke-PlayerLogAuditFixture `
                -Name 'suffixed-startup-marker' `
                -RunText ($startupMarker + " suffix`r`n" +
                    $receiptMarker + "`r`n" + $terminalShutdownMarker + "`r`n")
        }
        catch {
            $suffixedStartupRejected = $true
        }
        if (-not $suffixedStartupRejected) {
            throw 'The Player.log audit self-test accepted a suffixed startup marker as an exact extraction boundary.'
        }

        $lfEnvironmentEvidence = Invoke-PlayerLogAuditFixture `
            -Name 'lf-environment-profile' `
            -RunText (($fixturePrefix + $receiptMarker + "`r`n" +
                $knownEnvironmentException + $terminalShutdownMarker + "`r`n").Replace(
                    "`r`n",
                    "`n"))
        if ([int]$lfEnvironmentEvidence.knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount -ne 0 -or
            [bool]$lfEnvironmentEvidence.terminalShutdownComplete -ne $false -or
            [bool]$lfEnvironmentEvidence.approvedShutdownProfileMatched -ne $false) {
            throw 'The Player.log audit self-test accepted a non-CRLF Environment profile.'
        }
        Assert-PlayerLogDiagnosticsRejected -Evidence $lfEnvironmentEvidence
        Write-Output 'PASS: run-bounded Player.log extraction and exception classification'
    }
    finally {
        if (Test-Path -LiteralPath $testRoot -PathType Container) {
            Remove-Item -LiteralPath $testRoot -Recurse -Force
        }
    }
    return
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
    [bool]$buildReceipt.tests.displayEncodingTestsPassed -ne $true -or
    [bool]$buildReceipt.tests.playerLogAuditSelfTestPassed -ne $true -or
    [bool]$buildReceipt.tests.passed -ne $true) {
    throw 'The build receipt does not report every required offline verification as passed.'
}
$operatorSourcePath = [IO.Path]::GetFullPath($PSCommandPath)
$operatorSourceMatches = @(
    $buildReceipt.sources | Where-Object {
        [IO.Path]::GetFullPath([string]$_.path).Equals(
            $operatorSourcePath,
            [StringComparison]::OrdinalIgnoreCase)
    }
)
if ($operatorSourceMatches.Count -ne 1) {
    throw ('The live operator source must match exactly one build-receipt source entry; found ' +
        [string]$operatorSourceMatches.Count + '.')
}
$operatorSourceReceipt = $operatorSourceMatches[0]
$operatorSourceItem = Get-Item -LiteralPath $operatorSourcePath -Force
$operatorSourceSha256 =
    (Get-FileHash -LiteralPath $operatorSourcePath -Algorithm SHA256).Hash
if ([long]$operatorSourceReceipt.byteLength -ne [long]$operatorSourceItem.Length -or
    ([string]$operatorSourceReceipt.sha256).ToUpperInvariant() -cne
        $operatorSourceSha256) {
    throw 'The live operator source bytes do not match their unique build-receipt source entry.'
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
        displayEncodingTestsPassed = [bool]$buildReceipt.tests.displayEncodingTestsPassed
        playerLogAuditSelfTestPassed = [bool]$buildReceipt.tests.playerLogAuditSelfTestPassed
        passed = [bool]$buildReceipt.tests.passed
    }
    moduleSha256 = ([string]$buildReceipt.module.sha256).ToUpperInvariant()
    pluginManifestSha256 = ([string]$buildReceipt.pluginManifest.sha256).ToUpperInvariant()
    runtimeClosureLockSha256 = ([string]$buildReceipt.runtimeClosureLock.sha256).ToUpperInvariant()
    runtimeClosureInventorySha256 = ([string]$buildReceipt.runtimeClosureLock.inventorySha256).ToUpperInvariant()
    cameraProfileSha256 = ([string]$buildReceipt.cameraProfile.sha256).ToUpperInvariant()
    operatorSourcePath = $operatorSourcePath
    operatorSourceByteLength = [long]$operatorSourceItem.Length
    operatorSourceSha256 = $operatorSourceSha256
    operatorSourceBoundToBuildReceipt = $true
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
$playerLogBeforeRun = Get-PlayerLogFingerprint -Path $playerLog
$launchStartedUtcTicks = 0L
$playerLogEvidence = $null
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
$rawRgb24Sha256 = $null
$expandedSrgbTagged16PngSha256 = $null
$nativeReceiptPath = $null
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
    $launchStartedUtcTicks = [DateTime]::UtcNow.Ticks
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
    $rawRgb24Path = Join-Path $output 'grand-hall-native-capture-1600x900.unorm-lower-left.rgb24'
    $expandedSrgbTagged16PngPath = Join-Path $output 'grand-hall-native-capture-1600x900.srgb-tagged-expanded16.png'
    $nativeReceiptSidecar = $nativeReceiptPath + '.sha256'
    foreach ($requiredOutput in @(
        $nativeReceiptPath,
        $nativeReceiptSidecar,
        $finalPngPath,
        $rawRgb24Path,
        $expandedSrgbTagged16PngPath
    )) {
        if (-not (Test-Path -LiteralPath $requiredOutput -PathType Leaf)) {
            throw "A required native success artifact is missing: $requiredOutput"
        }
    }

    $nativeReceipt = Get-Content -LiteralPath $nativeReceiptPath -Raw | ConvertFrom-Json
    if ([string]$nativeReceipt.status -cne 'success') {
        throw "The native receipt did not report success: $nativeReceiptPath"
    }
    if ([string]$nativeReceipt.schemaVersion -cne 'venviewer.grand-hall.lcc-native-capture-receipt.v14' -or
        -not [bool]$nativeReceipt.capture.everyAttemptSpawnPointVisualizationsSuppressedAndRestored -or
        [string]$nativeReceipt.capture.plateauHashDomain -cne 'lower_left_Unity_Gamma_R8G8B8A8_UNorm_display_code_rgb24_sha256_before_row_flip_and_sRGB_tagging' -or
        [string]$nativeReceipt.capture.rawRgb24Semantics -cne 'Unity_Gamma_R8G8B8A8_UNorm_display_code_values_read_via_Texture2D_RGB24_lower_left_before_row_flip' -or
        [bool]$nativeReceipt.capture.rawRgb24LinearLightPhotometryClaimed -ne $false -or
        [bool]$nativeReceipt.capture.exactPhotometricTransferClaimed -ne $false -or
        [bool]$nativeReceipt.capture.expanded16AddsPrecision -ne $false -or
        [string]$nativeReceipt.capture.finalBrowserDisplayCodeMapping -cne 'IDENTITY_UNITY_GAMMA_UNORM_DISPLAY_CODE_VALUES_TO_SRGB_TAGGED_PNG8' -or
        [string]$nativeReceipt.capture.finalExpanded16CodeMapping -cne 'UINT8_CODE_VALUE_TIMES_257_TO_SRGB_TAGGED_PNG16_NO_ADDED_PRECISION' -or
        -not [bool]$nativeReceipt.capture.finalPngSrgbTagsVerified -or
        -not [bool]$nativeReceipt.capture.browserDisplaySrgbTaggedExpanded16PngChunksVerified) {
        throw 'The native receipt lacks the v14 marker-suppression, exact UNorm display-code plateau, identity PNG8 mapping, or no-added-precision PNG16 expansion proof.'
    }
    foreach ($attempt in @($nativeReceipt.capture.attempts)) {
        $surface = $attempt.singleCameraRenderRequestSurface
        if ([string]$surface.activeColorSpace -cne 'Gamma' -or
            [string]$surface.activeColorSpaceAfter -cne 'Gamma' -or
            [string]$attempt.rawRgb24Semantics -cne
                'Unity_Gamma_R8G8B8A8_UNorm_display_code_values_read_via_Texture2D_RGB24_lower_left_before_row_flip' -or
            [bool]$attempt.rawRgb24LinearLightPhotometryClaimed -ne $false -or
            [bool]$attempt.exactPhotometricTransferClaimed -ne $false -or
            [bool]$attempt.expanded16AddsPrecision -ne $false -or
            [string]$attempt.browserDisplay8CodeMapping -cne
                'IDENTITY_UNITY_GAMMA_UNORM_DISPLAY_CODE_VALUES_TO_SRGB_TAGGED_PNG8' -or
            [string]$attempt.browserDisplay16CodeMapping -cne
                'UINT8_CODE_VALUE_TIMES_257_TO_SRGB_TAGGED_PNG16_NO_ADDED_PRECISION') {
            throw 'A native attempt lacks the exact Gamma/UNorm display-code and no-photometric-transfer semantics.'
        }
        $targets = @(
            $surface.sentinelRequest.targetBeforeSubmit,
            $surface.sentinelRequest.targetAfterSubmit,
            $surface.exactRequest.targetBeforeSubmit,
            $surface.exactRequest.targetAfterSubmit
        )
        foreach ($target in $targets) {
            if ([string]$target.requestedGraphicsFormat -cne 'R8G8B8A8_UNorm' -or
                [bool]$target.requestedSrgb -ne $false -or
                [string]$target.effectiveGraphicsFormat -cne 'R8G8B8A8_UNorm' -or
                [bool]$target.effectiveSrgb -ne $false -or
                [bool]$target.requestedAndEffectiveFormatMatch -ne $true -or
                [bool]$target.effectiveGraphicsFormatRenderSupported -ne $true) {
                throw 'A native attempt did not prove exact requested/effective UNorm non-sRGB target identity.'
            }
        }
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
    $rawRgb24Sha256 = (Get-FileHash -LiteralPath $rawRgb24Path -Algorithm SHA256).Hash
    if ($rawRgb24Sha256 -cne ([string]$nativeReceipt.capture.rawRgb24EvidenceSha256).ToUpperInvariant()) {
        throw 'The raw UNorm RGB24 SHA-256 does not match the native receipt.'
    }
    $expandedSrgbTagged16PngSha256 = (Get-FileHash -LiteralPath $expandedSrgbTagged16PngPath -Algorithm SHA256).Hash
    if ($expandedSrgbTagged16PngSha256 -cne ([string]$nativeReceipt.capture.browserDisplaySrgbTaggedExpanded16PngSha256).ToUpperInvariant()) {
        throw 'The sRGB-tagged exact-expanded PNG16 SHA-256 does not match the native receipt.'
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

    if ($launchStartedUtcTicks -gt 0) {
        try {
            $requireNativeReceiptBinding =
                -not [string]::IsNullOrEmpty($nativeReceiptPath) -and
                -not [string]::IsNullOrEmpty($nativeReceiptSha256)
            $playerLogEvidence = Write-RunPlayerLogEvidence `
                -SourcePath $playerLog `
                -OutputDirectory $output `
                -ApprovedEditorRoot $approvedSandboxEditor `
                -PreRunFingerprint $playerLogBeforeRun `
                -LaunchStartedUtcTicks $launchStartedUtcTicks `
                -NativeReceiptPath $nativeReceiptPath `
                -NativeReceiptSha256 $nativeReceiptSha256 `
                -RequireNativeReceiptBinding $requireNativeReceiptBinding
            if ($status -ceq 'success' -and
                -not [bool]$playerLogEvidence.nativeReceiptUniquelyBound) {
                $status = 'failure'
                $message += ' The run-specific Player.log is not uniquely bound to the native receipt.'
            }
            if ($status -ceq 'success') {
                Assert-ExpectedPlayerLogDiagnostics -Evidence $playerLogEvidence
            }
            if ([bool]$playerLogEvidence.onlyExpectedDiagnosticsObserved) {
                if ([string]$playerLogEvidence.approvedShutdownProfile -ceq
                    'clean_shutdown_no_exceptions') {
                    $message += ' Player.log records one classified startup DBufferClear unsupported-shader ERROR (errorFree=false), one classified WindowsMediaFoundation unknown-color-primaries limitation (warningFree=false; no claim that it affected SOG), and the exact complete clean shutdown profile (exceptionFree=true).'
                }
                else {
                    $message += ' Player.log records one classified startup DBufferClear unsupported-shader ERROR (errorFree=false), one classified WindowsMediaFoundation unknown-color-primaries limitation (warningFree=false; no claim that it affected SOG), and exact approved post-receipt shutdown limitation profile ' +
                        [string]$playerLogEvidence.approvedShutdownProfile +
                        ' (exceptionFree=false).'
                }
            }
            else {
                $message += ' Player.log diagnostic counts differ from the reviewed baseline: known DBufferClear errors=' +
                    [string]$playerLogEvidence.knownStartupDbufferClearShaderUnsupportedErrorCount +
                    ', unexpected ERROR lines=' + [string]$playerLogEvidence.unexpectedErrorLineCount +
                    ', known WindowsMediaFoundation warnings=' +
                    [string]$playerLogEvidence.knownWindowsMediaFoundationUnknownColorPrimariesWarningCount +
                    ', unexpected WindowsMediaFoundation lines=' +
                    [string]$playerLogEvidence.unexpectedWindowsMediaFoundationUnknownColorPrimariesWarningCount +
                    ', known Tooltip/ResCache shutdown exceptions=' +
                    [string]$playerLogEvidence.knownPostReceiptVendorTooltipRescacheShutdownExceptionCount +
                    ', known Environment OnDisable shutdown exceptions=' +
                    [string]$playerLogEvidence.knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount +
                    ', shutdown profile=' + [string]$playerLogEvidence.approvedShutdownProfile +
                    ', shutdown classification=' + [string]$playerLogEvidence.shutdownProfileClassification +
                    ', unclassified exception headers=' + [string]$playerLogEvidence.unclassifiedExceptionCount +
                    ', unclassified exception diagnostic lines=' +
                    [string]$playerLogEvidence.unclassifiedExceptionDiagnosticLineCount + '.'
            }
        }
        catch {
            $status = 'failure'
            $message += ' Run-specific Player.log evidence failed: ' + $_.Exception.Message
            if ($null -eq $failureException) {
                $failureException = $_.Exception
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
        -PlayerLogEvidence $playerLogEvidence `
        -NativeReceiptSha256 $nativeReceiptSha256 `
        -FinalPngSha256 $finalPngSha256 `
        -RawRgb24Sha256 $rawRgb24Sha256 `
        -ExpandedSrgbTagged16PngSha256 $expandedSrgbTagged16PngSha256
}

if ($status -cne 'success') {
    throw [InvalidOperationException]::new(
        "$message Operator receipt: $output\grand-hall-native-capture-operator-receipt.json",
        $failureException)
}

Write-Output "Native capture output: $output"
Write-Output "Operator receipt: $output\grand-hall-native-capture-operator-receipt.json"
