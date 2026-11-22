<#
.SYNOPSIS
  Stores Console API keys for the credit runner, readable only by you.

.DESCRIPTION
  Creates the key folder, removes inherited permissions so only your account can
  open it, and saves one key per credit pot as <pot>.key. Each key is typed at a
  hidden prompt: it is never shown, logged, kept in shell history, or set as an
  environment variable. The runner hands it to the SDK client in-process only.

  Run it yourself in your own PowerShell window, from the repo root:
    .\tools\credit-runner\setup-keys.ps1                   # pot-1
    .\tools\credit-runner\setup-keys.ps1 -Pot pot-1,pot-2  # more than one pot
    .\tools\credit-runner\setup-keys.ps1 -KeyDir <folder>   # another folder

  The key folder is the `keyDir` of your sandbox.config.json; keep the two equal.
#>
param(
  [ValidatePattern('^[a-z][a-z0-9-]*$')]
  [string[]] $Pot = @('pot-1'),
  [string] $KeyDir = (Join-Path $env:USERPROFILE '.credit-runner-keys')
)
$ErrorActionPreference = 'Stop'

$dir = $KeyDir
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$me = $identity.Name
$mySid = $identity.User.Value

# Owner-only: drop inherited entries, grant full control to your account, then
# remove every other account's grants. icacls /grant:r replaces only your own
# entry, so an explicit grant something else added (a sandbox group, say) would
# otherwise survive. Fails unless your account is the only one left.
function Lock-ToOwner([string] $Path, [string] $Rights) {
  icacls $Path /inheritance:r /grant:r "${me}:$Rights" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls could not lock $Path" }
  $others = {
    (Get-Acl -LiteralPath $Path).GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) |
      Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -ne $mySid } |
      ForEach-Object { $_.IdentityReference.Value } | Select-Object -Unique
  }
  foreach ($sid in @(& $others)) {
    icacls $Path /remove:g "*$sid" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls could not remove $sid from $Path" }
  }
  $left = @(& $others)
  if ($left.Count -gt 0) { throw "$Path is still open to $($left -join ', ')" }
}

New-Item -ItemType Directory -Force -Path $dir | Out-Null
Lock-ToOwner $dir '(OI)(CI)F'

foreach ($name in $Pot) {
  $secure = Read-Host -AsSecureString "Paste the API key for $name (hidden; press Enter alone to skip)"
  $plain = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
  try {
    if ($plain -eq '') {
      Write-Host "Skipped $name."
      continue
    }
    if ($plain -notmatch '^sk-ant-[A-Za-z0-9_-]{20,}$') {
      Write-Warning "That does not look like an Anthropic API key (one line starting sk-ant-). Skipped $name."
      continue
    }
    $path = Join-Path $dir "$name.key"
    [System.IO.File]::WriteAllText($path, $plain)
    Lock-ToOwner $path 'F'
    Write-Host "Saved $name to $path, readable only by $me."
  }
  finally {
    $plain = $null
    $secure.Dispose()
  }
}
Write-Host ''
Write-Host 'Check with: pnpm --filter @omnitwin/credit-runner sandbox status'
