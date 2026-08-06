[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $TargetDirectory,

  [string] $Toolchain = "stable-x86_64-pc-windows-msvc",

  [string[]] $AdditionalForbiddenText = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$crateRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$targetRoot = [IO.Path]::GetFullPath($TargetDirectory)
$manifestPath = Join-Path $crateRoot "Cargo.toml"
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
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())

$previousToolchain = $env:RUSTUP_TOOLCHAIN
$previousEncodedRustFlags = $env:CARGO_ENCODED_RUSTFLAGS

try {
  $env:RUSTUP_TOOLCHAIN = $Toolchain
  $rustcVersion = (& rustc -Vv) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    throw "rustc version inspection failed."
  }
  if ($rustcVersion -notmatch "(?m)^release: 1\.87\.0$") {
    throw "The release build requires rustc 1.87.0 exactly."
  }
  if ($rustcVersion -notmatch "(?m)^host: x86_64-pc-windows-msvc$") {
    throw "The release build requires the x86_64-pc-windows-msvc host."
  }

  $remaps = [ordered]@{
    $crateRoot = "/venviewer/source/windows-source-helper"
    $targetRoot = "/venviewer/build/target"
    $cargoRoot = "/venviewer/build/cargo"
    $rustupRoot = "/venviewer/build/rustup"
    $tempRoot = "/venviewer/build/temp"
    $userRoot = "/venviewer/build/user"
  }
  $rustFlags = [Collections.Generic.List[string]]::new()
  $rustFlags.Add("-C")
  $rustFlags.Add("target-feature=+crt-static")
  $rustFlags.Add("-C")
  $rustFlags.Add("link-arg=/Brepro")
  foreach ($mapping in $remaps.GetEnumerator()) {
    $rustFlags.Add("--remap-path-prefix=$($mapping.Key)=$($mapping.Value)")
  }
  $env:CARGO_ENCODED_RUSTFLAGS = [string]::Join([char] 0x1f, $rustFlags)

  & cargo build --manifest-path $manifestPath --release --locked --offline --target-dir $targetRoot
  if ($LASTEXITCODE -ne 0) {
    throw "The locked offline release build failed."
  }

  $executable = Join-Path $targetRoot "x86_64-pc-windows-msvc\release\venviewer-windows-source-helper.exe"
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "The release build did not produce the expected executable."
  }
  $privacyScript = Join-Path $PSScriptRoot "verify-release-binary-privacy.ps1"
  $privacyJson = & $privacyScript -Executable $executable -AdditionalForbiddenText $AdditionalForbiddenText
  if ($LASTEXITCODE -ne 0) {
    throw "The release binary privacy scan failed."
  }
  $privacy = $privacyJson | ConvertFrom-Json
  if ($privacy.findings -ne 0) {
    throw "The release binary privacy scan reported a finding."
  }
  $item = Get-Item -LiteralPath $executable
  $digest = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
  [pscustomobject]@{
    schemaVersion = 1
    architecture = "x86_64-pc-windows-msvc"
    rustcRelease = "1.87.0"
    bytes = $item.Length
    sha256 = "sha256:$digest"
    privacyFindings = $privacy.findings
    privacyEncodings = $privacy.encodingsChecked
  } | ConvertTo-Json -Compress
} finally {
  $env:RUSTUP_TOOLCHAIN = $previousToolchain
  $env:CARGO_ENCODED_RUSTFLAGS = $previousEncodedRustFlags
}
