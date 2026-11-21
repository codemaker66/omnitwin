<#
.SYNOPSIS
  Runs one credit-runner night from the checkout this script lives in.

.EXAMPLE
  .\tools\credit-runner\run-night.ps1
  .\tools\credit-runner\run-night.ps1 --dry-run
  .\tools\credit-runner\run-night.ps1 --only smoke-readonly
#>
$ErrorActionPreference = 'Stop'
$repo = (git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
pnpm --dir $repo --filter '@omnitwin/credit-runner' night @args
exit $LASTEXITCODE
