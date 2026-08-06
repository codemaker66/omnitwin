[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Executable,

  [string[]] $AdditionalForbiddenText = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Find-ByteSequence {
  param(
    [Parameter(Mandatory = $true)]
    [byte[]] $Haystack,

    [Parameter(Mandatory = $true)]
    [byte[]] $Needle
  )

  if ($Needle.Length -eq 0 -or $Needle.Length -gt $Haystack.Length) {
    return $false
  }
  $lastStart = $Haystack.Length - $Needle.Length
  for ($start = 0; $start -le $lastStart; $start += 1) {
    if ($Haystack[$start] -ne $Needle[0]) {
      continue
    }
    $matches = $true
    for ($offset = 1; $offset -lt $Needle.Length; $offset += 1) {
      if ($Haystack[$start + $offset] -ne $Needle[$offset]) {
        $matches = $false
        break
      }
    }
    if ($matches) {
      return $true
    }
  }
  return $false
}

$selfTestMarker = "VENVIEWER_PRIVACY_SCAN_PROBE"
$asciiSelfTest = [Text.Encoding]::UTF8.GetBytes("prefix-$selfTestMarker-suffix")
$utf16SelfTest = [Text.Encoding]::Unicode.GetBytes("prefix-$selfTestMarker-suffix")
$asciiNeedle = [Text.Encoding]::UTF8.GetBytes($selfTestMarker)
$utf16Needle = [Text.Encoding]::Unicode.GetBytes($selfTestMarker)
if (-not (Find-ByteSequence -Haystack $asciiSelfTest -Needle $asciiNeedle) -or
  -not (Find-ByteSequence -Haystack $utf16SelfTest -Needle $utf16Needle)) {
  throw "The binary privacy scanner failed its in-memory encoding self-test."
}

$executablePath = [IO.Path]::GetFullPath($Executable)
if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
  throw "The executable to inspect does not exist."
}

$userRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
$cargoRoot = if ([string]::IsNullOrWhiteSpace($env:CARGO_HOME)) {
  Join-Path $userRoot ".cargo"
} else {
  [IO.Path]::GetFullPath($env:CARGO_HOME)
}
$rustupRoot = if ([string]::IsNullOrWhiteSpace($env:RUSTUP_HOME)) {
  Join-Path $userRoot ".rustup"
} else {
  [IO.Path]::GetFullPath($env:RUSTUP_HOME)
}
$forbidden = [Collections.Generic.List[string]]::new()
foreach ($value in @("C:\Users\", $env:USERNAME, $userRoot, $cargoRoot, $rustupRoot)) {
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    $forbidden.Add($value)
  }
}
foreach ($value in $AdditionalForbiddenText) {
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    $forbidden.Add($value)
  }
}

$bytes = [IO.File]::ReadAllBytes($executablePath)
$findingCount = 0
$markerIndex = 0
foreach ($marker in $forbidden) {
  $forms = @($marker, $marker.ToLowerInvariant(), $marker.ToUpperInvariant()) |
    Select-Object -Unique
  foreach ($form in $forms) {
    $ascii = [Text.Encoding]::UTF8.GetBytes($form)
    $utf16 = [Text.Encoding]::Unicode.GetBytes($form)
    if ((Find-ByteSequence -Haystack $bytes -Needle $ascii) -or
      (Find-ByteSequence -Haystack $bytes -Needle $utf16)) {
      $findingCount += 1
      Write-Error "Forbidden build-path marker index $markerIndex was found in the executable."
    }
  }
  $markerIndex += 1
}
if ($findingCount -ne 0) {
  throw "The release executable contains forbidden local build-path text."
}

$item = Get-Item -LiteralPath $executablePath
$digest = (Get-FileHash -LiteralPath $executablePath -Algorithm SHA256).Hash.ToLowerInvariant()
[pscustomobject]@{
  schemaVersion = 1
  encodingsChecked = @("ascii_utf8", "utf16le")
  forbiddenMarkerCount = $forbidden.Count
  findings = 0
  bytes = $item.Length
  sha256 = "sha256:$digest"
} | ConvertTo-Json -Compress
