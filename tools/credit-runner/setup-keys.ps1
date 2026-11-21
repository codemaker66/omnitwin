<#
.SYNOPSIS
  Stores VenViewer Console API keys for the credit runner, readable only by you.

.DESCRIPTION
  Creates %USERPROFILE%\.venviewer-credits, removes inherited permissions so only
  your account can open it, and saves one key per org as <org>.key. Each key is
  typed at a hidden prompt: it is never shown, logged, kept in shell history, or
  set as an environment variable. The runner hands it to one claude process at a
  time, in that process's own environment only.

  Run it yourself in your own PowerShell window, from the repo root:
    .\tools\credit-runner\setup-keys.ps1              # Batch and Staging
    .\tools\credit-runner\setup-keys.ps1 -Org batch   # one org

  The Production org's credit serves live AI only, so it gets no runner key.
#>
param(
  [ValidateSet('batch', 'staging')]
  [string[]] $Org = @('batch', 'staging')
)
$ErrorActionPreference = 'Stop'

$dir = Join-Path $env:USERPROFILE '.venviewer-credits'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$me = $identity.Name
$mySid = $identity.User.Value

# Owner-only: drop inherited entries, grant full control to your account, then
# remove every other account's grants. icacls /grant:r replaces only your own
# entry, so an explicit grant something else added (on this PC, a Codex sandbox
# group) would otherwise survive. Fails unless your account is the only one left.
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

$names = @{ batch = 'VenViewer Batch'; staging = 'VenViewer Staging' }
foreach ($name in $Org) {
  $label = $names[$name]
  $secure = Read-Host -AsSecureString "Paste the API key for $label (hidden; press Enter alone to skip)"
  $plain = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
  try {
    if ($plain -eq '') {
      Write-Host "Skipped $label."
      continue
    }
    if ($plain -notmatch '^sk-ant-[A-Za-z0-9_-]{20,}$') {
      Write-Warning "That does not look like an Anthropic API key (one line starting sk-ant-). Skipped $label."
      continue
    }
    $path = Join-Path $dir "$name.key"
    [System.IO.File]::WriteAllText($path, $plain)
    Lock-ToOwner $path 'F'
    Write-Host "Saved $label to $path, readable only by $me."
  }
  finally {
    $plain = $null
    $secure.Dispose()
  }
}
Write-Host ''
Write-Host 'Check with: pnpm --filter @omnitwin/credit-runner status'
