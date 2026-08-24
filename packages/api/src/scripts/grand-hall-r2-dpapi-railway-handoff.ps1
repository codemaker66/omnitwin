$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
$failureExitCode = 61

function Get-RequiredHelperValue {
  param([Parameter(Mandatory = $true)] [string] $Name)
  $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if ([String]::IsNullOrWhiteSpace($value)) {
    throw 'A required local handoff selection is unavailable.'
  }
  return $value
}

function Assert-ReviewedRailwayExecutable {
  param(
    [Parameter(Mandatory = $true)] [string] $RailwayExecutable,
    [Parameter(Mandatory = $true)] [string] $ExpectedSha256,
    [Parameter(Mandatory = $true)] [string] $ExpectedVersion
  )

  if (-not [IO.Path]::IsPathRooted($RailwayExecutable) -or
      [IO.Path]::GetFileName($RailwayExecutable) -cne 'railway.exe' -or
      $ExpectedSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      $ExpectedVersion -cnotmatch '^railway [0-9]+\.[0-9]+\.[0-9]+$') {
    throw 'Pinned Railway CLI identity is invalid.'
  }
  $item = Get-Item -LiteralPath $RailwayExecutable -Force
  if (-not $item.PSIsContainer -and
      (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)) {
    $fileStream = $null
    $sha256 = $null
    $hashBytes = $null
    try {
      $fileStream = [IO.File]::Open(
        $item.FullName,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::Read
      )
      $sha256 = [Security.Cryptography.SHA256]::Create()
      $hashBytes = $sha256.ComputeHash($fileStream)
      $actualSha256 = [BitConverter]::ToString($hashBytes).Replace('-', '').ToLowerInvariant()
    } finally {
      if ($null -ne $hashBytes) { [Array]::Clear($hashBytes, 0, $hashBytes.Length) }
      if ($null -ne $sha256) { $sha256.Dispose() }
      if ($null -ne $fileStream) { $fileStream.Dispose() }
    }
    if ($actualSha256 -cne $ExpectedSha256) {
      throw 'Railway CLI SHA-256 does not match the reviewed binary.'
    }
    $versionProcess = $null
    try {
      $versionStartInfo = [Diagnostics.ProcessStartInfo]::new()
      $versionStartInfo.FileName = [string]$item.FullName
      $versionStartInfo.Arguments = '--version'
      $versionStartInfo.WorkingDirectory = [IO.Path]::GetTempPath()
      $versionStartInfo.UseShellExecute = $false
      $versionStartInfo.CreateNoWindow = $true
      $versionStartInfo.RedirectStandardOutput = $true
      $versionStartInfo.RedirectStandardError = $true
      $versionStartInfo.EnvironmentVariables.Clear()
      foreach ($environmentName in @(
        'SystemRoot', 'WINDIR', 'SystemDrive', 'ProgramData', 'TEMP', 'TMP',
        'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'HOME'
      )) {
        $environmentValue = [Environment]::GetEnvironmentVariable($environmentName, 'Process')
        if (-not [String]::IsNullOrEmpty($environmentValue)) {
          $versionStartInfo.EnvironmentVariables[$environmentName] = $environmentValue
        }
      }
      $versionStartInfo.EnvironmentVariables['CI'] = 'true'
      $versionStartInfo.EnvironmentVariables['NO_COLOR'] = '1'
      $versionProcess = [Diagnostics.Process]::new()
      $versionProcess.StartInfo = $versionStartInfo
      if (-not $versionProcess.Start()) {
        throw 'Railway CLI version process did not start.'
      }
      $versionOutput = $versionProcess.StandardOutput.ReadToEndAsync()
      $versionError = $versionProcess.StandardError.ReadToEndAsync()
      if (-not $versionProcess.WaitForExit(10000)) {
        try { $versionProcess.Kill() } catch { }
        throw 'Railway CLI version process exceeded its deadline.'
      }
      $versionOutput.Wait()
      $versionError.Wait()
      $versionText = ([string]$versionOutput.Result).Trim()
      if ($versionProcess.ExitCode -ne 0 -or
          $versionText -cne $ExpectedVersion) {
        throw 'Railway CLI version does not match the reviewed binary.'
      }
    } finally {
      if ($null -ne $versionProcess) { $versionProcess.Dispose() }
    }
    return
  }
  throw 'Pinned Railway CLI is not a regular non-link file.'
}

function Assert-ExactProperties {
  param(
    [Parameter(Mandatory = $true)] [object] $Object,
    [Parameter(Mandatory = $true)] [string[]] $Expected
  )
  $actual = @($Object.PSObject.Properties.Name)
  if ($actual.Count -ne $Expected.Count) {
    throw 'Protected credential payload has an unexpected property set.'
  }
  foreach ($name in $Expected) {
    if (-not ($actual -ccontains $name)) {
      throw 'Protected credential payload has an unexpected property set.'
    }
  }
}

function Get-StrictInt64 {
  param([Parameter(Mandatory = $true)] [object] $Value)
  if (-not (($Value -is [Int32]) -or ($Value -is [Int64]))) {
    throw 'Protected credential payload has a non-integer time value.'
  }
  return [Int64]$Value
}

function ConvertFrom-StrictBase64UrlJson {
  param([Parameter(Mandatory = $true)] [string] $Value)
  if ($Value -cnotmatch '^[A-Za-z0-9_-]+$') {
    throw 'Protected credential JWT is not canonical base64url.'
  }
  $base64 = $Value.Replace('-', '+').Replace('_', '/')
  switch ($base64.Length % 4) {
    0 { }
    2 { $base64 += '==' }
    3 { $base64 += '=' }
    default { throw 'Protected credential JWT is not canonical base64url.' }
  }
  $bytes = [Convert]::FromBase64String($base64)
  $utf8 = [Text.UTF8Encoding]::new($false, $true)
  return ConvertFrom-Json -InputObject $utf8.GetString($bytes)
}

function Invoke-RailwayVariableSet {
  param(
    [Parameter(Mandatory = $true)] [string] $Field,
    [Parameter(Mandatory = $true)] [string] $Value,
    [Parameter(Mandatory = $true)] [string] $RailwayExecutable,
    [Parameter(Mandatory = $true)] [string] $ExpectedRailwaySha256,
    [Parameter(Mandatory = $true)] [string] $ExpectedRailwayVersion,
    [Parameter(Mandatory = $true)] [string] $ProjectId,
    [Parameter(Mandatory = $true)] [string] $EnvironmentId,
    [Parameter(Mandatory = $true)] [string] $ServiceId
  )

  $process = $null
  try {
    Assert-ReviewedRailwayExecutable `
      -RailwayExecutable $RailwayExecutable `
      -ExpectedSha256 $ExpectedRailwaySha256 `
      -ExpectedVersion $ExpectedRailwayVersion
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $RailwayExecutable
    $startInfo.Arguments = "variable set $Field --stdin --skip-deploys --project $ProjectId --environment $EnvironmentId --service $ServiceId"
    $startInfo.WorkingDirectory = [IO.Path]::GetTempPath()
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
    $startInfo.EnvironmentVariables.Clear()
    foreach ($environmentName in @(
      'SystemRoot',
      'WINDIR',
      'SystemDrive',
      'ProgramData',
      'TEMP',
      'TMP',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'HOMEDRIVE',
      'HOMEPATH',
      'HOME'
    )) {
      $environmentValue = [Environment]::GetEnvironmentVariable($environmentName, 'Process')
      if (-not [String]::IsNullOrEmpty($environmentValue)) {
        $startInfo.EnvironmentVariables[$environmentName] = $environmentValue
      }
    }
    $startInfo.EnvironmentVariables['CI'] = 'true'
    $startInfo.EnvironmentVariables['NO_COLOR'] = '1'

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
      throw 'Railway variable process did not start.'
    }
    $stdoutDrain = $process.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)
    $stderrDrain = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
    $process.StandardInput.Write($Value)
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(30000)) {
      try { $process.Kill() } catch { }
      throw 'Railway variable process exceeded its deadline.'
    }
    $process.WaitForExit()
    $stdoutDrain.Wait()
    $stderrDrain.Wait()
    if ($process.ExitCode -ne 0) {
      throw 'Railway variable process failed.'
    }
  } finally {
    if ($null -ne $process) {
      $process.Dispose()
    }
  }
}

$inputMemory = [IO.MemoryStream]::new()
$inputBacking = $null
$artifact = $null
$ciphertext = $null
$plain = $null
$value = $null
$sessionBytes = $null
$jwtBytes = $null
$jwtHash = $null
$exitCode = 0
try {
  $expectedHeaderBase64 = Get-RequiredHelperValue 'VENVIEWER_DPAPI_EXPECTED_HEADER_BASE64'
  $expectedBucket = Get-RequiredHelperValue 'VENVIEWER_DPAPI_EXPECTED_BUCKET'
  $expectedPrefix = Get-RequiredHelperValue 'VENVIEWER_DPAPI_EXPECTED_PREFIX'
  $allowedFields = @(
    (Get-RequiredHelperValue 'VENVIEWER_DPAPI_RAILWAY_FIELD_1'),
    (Get-RequiredHelperValue 'VENVIEWER_DPAPI_RAILWAY_FIELD_2'),
    (Get-RequiredHelperValue 'VENVIEWER_DPAPI_RAILWAY_FIELD_3')
  )
  $expectedRailwaySha256 = Get-RequiredHelperValue 'VENVIEWER_DPAPI_EXPECTED_RAILWAY_CLI_SHA256'
  $expectedRailwayVersion = Get-RequiredHelperValue 'VENVIEWER_DPAPI_EXPECTED_RAILWAY_CLI_VERSION'
  $railwayExecutable = Get-RequiredHelperValue 'VENVIEWER_RAILWAY_EXECUTABLE'
  $projectId = Get-RequiredHelperValue 'VENVIEWER_RAILWAY_PROJECT_ID'
  $environmentId = Get-RequiredHelperValue 'VENVIEWER_RAILWAY_ENVIRONMENT_ID'
  $serviceId = Get-RequiredHelperValue 'VENVIEWER_RAILWAY_SERVICE_ID'
  $uuidPattern = '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  if ($projectId -cnotmatch $uuidPattern -or
      $environmentId -cnotmatch $uuidPattern -or
      $serviceId -cnotmatch $uuidPattern) {
    throw 'Pinned Railway target selection is invalid.'
  }
  $failureExitCode = 66
  Assert-ReviewedRailwayExecutable `
    -RailwayExecutable $railwayExecutable `
    -ExpectedSha256 $expectedRailwaySha256 `
    -ExpectedVersion $expectedRailwayVersion
  $failureExitCode = 61

  $inputStream = [Console]::OpenStandardInput()
  $inputStream.CopyTo($inputMemory)
  if ($inputMemory.Length -le 0 -or $inputMemory.Length -gt 262144) {
    throw 'Protected credential artifact is invalid.'
  }
  $artifact = $inputMemory.ToArray()
  Add-Type -AssemblyName System.Security | Out-Null
  $expectedHeader = [Convert]::FromBase64String($expectedHeaderBase64)
  if ($artifact.Length -le $expectedHeader.Length) {
    throw 'Protected credential artifact is invalid.'
  }
  for ($index = 0; $index -lt $expectedHeader.Length; $index += 1) {
    if ($artifact[$index] -ne $expectedHeader[$index]) {
      throw 'Protected credential artifact is invalid.'
    }
  }

  $ciphertext = [byte[]]::new($artifact.Length - $expectedHeader.Length)
  [Array]::Copy($artifact, $expectedHeader.Length, $ciphertext, 0, $ciphertext.Length)
  $plain = [Security.Cryptography.ProtectedData]::Unprotect(
    $ciphertext,
    $null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  $utf8 = [Text.UTF8Encoding]::new($false, $true)
  $payload = ConvertFrom-Json -InputObject $utf8.GetString($plain)

  Assert-ExactProperties $payload @(
    'schemaVersion',
    'issuedAt',
    'expiresAt',
    'issuedAtEpochSeconds',
    'expiresAtEpochSeconds',
    'ttlSeconds',
    'restriction',
    'railwayVariables'
  )
  if ($payload.schemaVersion -cne 'venviewer.grand-hall-r2-temporary-writer.v1') {
    throw 'Protected credential payload has an invalid schema.'
  }
  Assert-ExactProperties $payload.restriction @(
    'bucket',
    'scope',
    'actions',
    'prefixPaths'
  )
  $actions = @($payload.restriction.actions)
  $prefixPaths = @($payload.restriction.prefixPaths)
  if ($payload.restriction.bucket -cne $expectedBucket -or
      $payload.restriction.scope -cne 'object-read-write' -or
      $actions.Count -ne 1 -or $actions[0] -cne 'PutObject' -or
      $prefixPaths.Count -ne 1 -or $prefixPaths[0] -cne $expectedPrefix) {
    throw 'Protected credential payload has an invalid restriction.'
  }

  $failureExitCode = 62
  $issuedAtEpochSeconds = Get-StrictInt64 $payload.issuedAtEpochSeconds
  $expiresAtEpochSeconds = Get-StrictInt64 $payload.expiresAtEpochSeconds
  $ttlSeconds = Get-StrictInt64 $payload.ttlSeconds
  $minimumHandoffStartRemainingSeconds = 1200
  $minimumSuccessfulHandoffRemainingSeconds = 900
  if ($ttlSeconds -lt 900 -or $ttlSeconds -gt 3600 -or
      $expiresAtEpochSeconds - $issuedAtEpochSeconds -ne $ttlSeconds) {
    throw 'Protected credential payload has an invalid lifetime.'
  }
  $nowEpochSeconds = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  if ($issuedAtEpochSeconds -gt $nowEpochSeconds + 60 -or
      $expiresAtEpochSeconds - $nowEpochSeconds -lt $minimumHandoffStartRemainingSeconds) {
    throw 'Protected credential payload is outside its valid time window.'
  }
  $issuedAtText = ([DateTimeOffset]::FromUnixTimeSeconds($issuedAtEpochSeconds)).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
  $expiresAtText = ([DateTimeOffset]::FromUnixTimeSeconds($expiresAtEpochSeconds)).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
  if (-not ($payload.issuedAt -is [string]) -or
      -not ($payload.expiresAt -is [string]) -or
      $payload.issuedAt -cne $issuedAtText -or
      $payload.expiresAt -cne $expiresAtText) {
    throw 'Protected credential payload has incoherent timestamps.'
  }

  $failureExitCode = 63
  Assert-ExactProperties $payload.railwayVariables $allowedFields
  foreach ($railwayProperty in @($payload.railwayVariables.PSObject.Properties)) {
    if (-not ($railwayProperty.Value -is [string]) -or
        [String]::IsNullOrWhiteSpace([string]$railwayProperty.Value) -or
        [string]$railwayProperty.Value -match '[\x00-\x1F\x7F]') {
      throw 'Protected credential payload contains an invalid Railway value.'
    }
  }

  $accessKeyId = [string]$payload.railwayVariables.PSObject.Properties[$allowedFields[0]].Value
  $temporarySecret = [string]$payload.railwayVariables.PSObject.Properties[$allowedFields[1]].Value
  $sessionToken = [string]$payload.railwayVariables.PSObject.Properties[$allowedFields[2]].Value
  if ($accessKeyId -cnotmatch '^[A-Za-z0-9]{16,128}$' -or
      $temporarySecret -cnotmatch '^[a-f0-9]{64}$' -or
      $sessionToken -cnotmatch '^[A-Za-z0-9+/]+={0,2}$') {
    throw 'Protected credential payload has an invalid Railway value shape.'
  }
  $sessionBytes = [Convert]::FromBase64String($sessionToken)
  if ([Convert]::ToBase64String($sessionBytes) -cne $sessionToken) {
    throw 'Protected credential session token is not canonical base64.'
  }
  $sessionText = ([Text.UTF8Encoding]::new($false, $true)).GetString($sessionBytes)
  if (-not $sessionText.StartsWith('jwt/', [StringComparison]::Ordinal)) {
    throw 'Protected credential session token has an invalid envelope.'
  }
  $jwt = $sessionText.Substring(4)
  $segments = $jwt.Split([char]'.')
  if ($segments.Count -ne 3 -or
      $segments[2].Length -ne 43 -or
      $segments[2] -cnotmatch '^[A-Za-z0-9_-]{43}$') {
    throw 'Protected credential session token has an invalid JWT shape.'
  }
  $jwtHeader = ConvertFrom-StrictBase64UrlJson $segments[0]
  $jwtClaims = ConvertFrom-StrictBase64UrlJson $segments[1]
  Assert-ExactProperties $jwtHeader @('alg', 'typ')
  if ($jwtHeader.alg -cne 'HS256' -or $jwtHeader.typ -cne 'JWT') {
    throw 'Protected credential JWT has an invalid header.'
  }
  Assert-ExactProperties $jwtClaims @(
    'sub',
    'iss',
    'aud',
    'iat',
    'exp',
    'bucket',
    'scope',
    'actions',
    'paths'
  )
  Assert-ExactProperties $jwtClaims.paths @('prefixPaths')
  $jwtActions = @($jwtClaims.actions)
  $jwtPrefixPaths = @($jwtClaims.paths.prefixPaths)
  if (-not ($jwtClaims.sub -is [string]) -or
      $jwtClaims.sub -cnotmatch '^[a-f0-9]{32}$' -or
      $jwtClaims.iss -cne $accessKeyId -or
      $jwtClaims.aud -cne "$($jwtClaims.sub).r2.cloudflarestorage.com" -or
      (Get-StrictInt64 $jwtClaims.iat) -ne $issuedAtEpochSeconds -or
      (Get-StrictInt64 $jwtClaims.exp) -ne $expiresAtEpochSeconds -or
      $jwtClaims.bucket -cne $expectedBucket -or
      $jwtClaims.scope -cne 'object-read-write' -or
      $jwtActions.Count -ne 1 -or $jwtActions[0] -cne 'PutObject' -or
      $jwtPrefixPaths.Count -ne 1 -or $jwtPrefixPaths[0] -cne $expectedPrefix) {
    throw 'Protected credential JWT claims do not match the sealed restriction.'
  }
  $jwtBytes = [Text.Encoding]::UTF8.GetBytes($jwt)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $jwtHash = $sha256.ComputeHash($jwtBytes)
  } finally {
    $sha256.Dispose()
  }
  $derivedTemporarySecret = [BitConverter]::ToString($jwtHash).Replace('-', '').ToLowerInvariant()
  if ($derivedTemporarySecret -cne $temporarySecret) {
    throw 'Protected credential secret does not match its session token.'
  }

  $failureExitCode = 65
  foreach ($field in $allowedFields) {
    $remainingLifetimeSeconds = $expiresAtEpochSeconds - `
      [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ($remainingLifetimeSeconds -lt $minimumSuccessfulHandoffRemainingSeconds) {
      throw 'Protected credential lifetime is too short to continue Railway handoff.'
    }
    $property = $payload.railwayVariables.PSObject.Properties[$field]
    if ($null -eq $property -or -not ($property.Value -is [string])) {
      throw 'Protected credential payload does not contain an allowlisted Railway field.'
    }
    $value = [string]$property.Value
    Invoke-RailwayVariableSet `
      -Field $field `
      -Value $value `
      -RailwayExecutable $railwayExecutable `
      -ExpectedRailwaySha256 $expectedRailwaySha256 `
      -ExpectedRailwayVersion $expectedRailwayVersion `
      -ProjectId $projectId `
      -EnvironmentId $environmentId `
      -ServiceId $serviceId
    $remainingLifetimeSeconds = $expiresAtEpochSeconds - `
      [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ($remainingLifetimeSeconds -lt $minimumSuccessfulHandoffRemainingSeconds) {
      throw 'Protected credential lifetime is too short after a Railway write.'
    }
    $value = $null
  }
} catch {
  $exitCode = $failureExitCode
} finally {
  $value = $null
  if ($null -ne $artifact) { [Array]::Clear($artifact, 0, $artifact.Length) }
  if ($null -ne $ciphertext) { [Array]::Clear($ciphertext, 0, $ciphertext.Length) }
  if ($null -ne $plain) { [Array]::Clear($plain, 0, $plain.Length) }
  if ($null -ne $sessionBytes) { [Array]::Clear($sessionBytes, 0, $sessionBytes.Length) }
  if ($null -ne $jwtBytes) { [Array]::Clear($jwtBytes, 0, $jwtBytes.Length) }
  if ($null -ne $jwtHash) { [Array]::Clear($jwtHash, 0, $jwtHash.Length) }
  try {
    $inputBacking = $inputMemory.GetBuffer()
    [Array]::Clear($inputBacking, 0, $inputBacking.Length)
  } catch { }
  $inputMemory.Dispose()
}
if ($exitCode -ne 0) {
  [Environment]::Exit($exitCode)
}
