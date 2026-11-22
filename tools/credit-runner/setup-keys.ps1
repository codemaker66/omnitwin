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
  Refused, before anything is created: a folder inside the repository or inside
  any git work tree (a .git in it or a folder above it, found through junctions
  and symlinks), and a -KeyDir starting with \ or / (a network, device,
  long-path or drive-root spelling). Finding where the folder really is needs
  node, which the runner needs anyway.
#>
param(
  [ValidatePattern('^[a-z][a-z0-9-]*$')]
  [string[]] $Pot = @('pot-1'),
  [string] $KeyDir = (Join-Path $env:USERPROFILE '.credit-runner-keys')
)
$ErrorActionPreference = 'Stop'

# Why a key is not one the runner takes, or $null when it is. The key itself is never shown.
# The shape test is case-sensitive, like the runner's own (src/keys.ts).
function Get-KeyProblem([string] $Key) {
  if ($Key -match '^sk-ant-admin') { return 'That is an Admin API key (sk-ant-admin...), which the runner must never hold; store a workspace API key (sk-ant-api...).' }
  if ($Key -match '^sk-ant-oat') { return 'That is an OAuth token (sk-ant-oat...), not a Console API key; store a workspace API key (sk-ant-api...).' }
  if ($Key -cnotmatch '^sk-ant-[A-Za-z0-9_-]{20,}$') { return 'That does not look like an Anthropic API key (one line starting sk-ant-).' }
  return $null
}

# \\server\share, \\?\ and \\.\ spellings are not resolved the way a drive path is; ask for a drive path.
if ($KeyDir.StartsWith('\') -or $KeyDir.StartsWith('/')) {
  throw "Give -KeyDir as a full path that starts with a drive letter, or a relative one: '$KeyDir' starts with \ or / (a network, device, long-path or drive-root spelling)."
}
# One full path for every step: a relative -KeyDir is taken from this window's
# location (the .NET calls below would otherwise read it from another folder).
$here = (Get-Location).ProviderPath
$dir = if ([System.IO.Path]::IsPathRooted($KeyDir)) { [System.IO.Path]::GetFullPath($KeyDir) } else { [System.IO.Path]::GetFullPath((Join-Path $here $KeyDir)) }
if ($dir.StartsWith('\\')) {
  throw "'$KeyDir' leads to a network or device path from this window's location; give -KeyDir as a full path that starts with a drive letter."
}

# A key folder inside the repository, or inside any git work tree, is one careless
# `git add` from a public record. Where the folder really is comes from node's
# realpath (fs.realpathSync.native) of its nearest existing folder, through
# junctions and symlinks; a .git is looked for there and above it, and above the
# path as written.
# The script prints no path but the -KeyDir it was given.
$where = @'
const fs = require('fs'), path = require('path');
const real = (p) => { const rest = []; for (let c = path.resolve(p); ; ) { try { return path.join(fs.realpathSync.native(c), ...rest); } catch (e) { const up = path.dirname(c); if (up === c || e.code !== 'ENOENT') throw e; rest.unshift(path.basename(c)); c = up; } } };
const gitAbove = (p) => { for (let c = p; ; ) { try { fs.lstatSync(path.join(c, '.git')); return true; } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e; } const up = path.dirname(c); if (up === c) return false; c = up; } };
const dir = process.env.CREDIT_RUNNER_KEY_DIR, folder = real(dir), repo = real(process.env.CREDIT_RUNNER_REPO);
const rel = path.relative(repo.toLowerCase(), folder.toLowerCase());
const inRepo = rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
process.stdout.write(inRepo ? 'repository' : gitAbove(folder) || gitAbove(dir) ? 'git' : 'ok');
'@
$node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $node) { throw 'node was not found on PATH; it is needed to find where the key folder really is. Nothing was created.' }
$env:CREDIT_RUNNER_KEY_DIR = $dir
$env:CREDIT_RUNNER_REPO = Join-Path $PSScriptRoot '..\..'
$ErrorActionPreference = 'Continue'
try {
  $verdict = "$(& $node.Source -e (($where -split "`r?`n") -join ' ') 2>$null)"
  $nodeExit = $LASTEXITCODE
}
finally {
  $ErrorActionPreference = 'Stop'
  Remove-Item Env:CREDIT_RUNNER_KEY_DIR, Env:CREDIT_RUNNER_REPO -ErrorAction SilentlyContinue
}
if ($nodeExit -ne 0 -or $verdict -notin @('ok', 'repository', 'git')) {
  throw "Could not tell where '$KeyDir' really is (node failed). Nothing was created."
}
if ($verdict -eq 'repository') {
  throw "The key folder '$KeyDir' is inside the repository; choose one outside it (the default is under your profile)."
}
if ($verdict -eq 'git') {
  throw "The key folder '$KeyDir' is inside a git work tree (a .git in it or a folder above it); choose one outside every repository (the default is under your profile)."
}
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
    $problem = Get-KeyProblem $plain
    if ($null -ne $problem) {
      Write-Warning "$problem Skipped $name."
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
