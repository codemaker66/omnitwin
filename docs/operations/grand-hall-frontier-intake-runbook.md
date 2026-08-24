# Grand Hall exact-frontier intake runbook

Date: 2026-08-24
Status: operator procedure, not evidence that intake or deployment occurred
Task: T-540
Owner: Venviewer engineering / an explicitly authorized platform administrator

## Purpose and hard boundary

This runbook uploads and immutably registers only the pinned eleven-member XGRIDS SOG frontier for Trades Hall's individual Grand Hall. It deliberately does not publish the package, construct a whole venue, add neighbouring rooms, merge the exterior facade, or certify operational geometry. This procedure does not itself grant browser automation; the owner has separately authorized authenticated browser/WebGL QA for the dedicated staging target only.

The intake CLI talks only to the selected Venviewer API over HTTPS. That same API process owns the target database connection and the private R2 configuration. Binary uploads are proxied through the authenticated API; the operator is never given R2 account, bucket, object-key, or credential material by preflight.

No generative-modelling, image-generation, or video-generation key is needed. Generated or procedurally invented architectural pixels are prohibited. Existing exterior-facade assets stay separate from the Grand Hall room layer.

## Current execution state

Do not treat this file as an execution record. As of 2026-08-24:

- the owner has selected and authorized the dedicated staging target ID
  `trades-hall-grand-hall-staging`, but it has not been provisioned;
- no canonical member has been uploaded by this work;
- no AssetVersion or RuntimePackage has been registered by this work;
- no branch has been pushed and no code, migration, or package activation has
  been deployed by this work; and
- local source-fixture render-presence diagnostics exist, but no authenticated
  staging/package browser-WebGL visual QA has been run.

## Required operator inputs

Obtain all of the following before changing a target environment:

1. The explicitly selected target ID. For this staging run it is `trades-hall-grand-hall-staging`; it must identify one API/database/private-bucket deployment unambiguously.
2. The selected API's exact clean HTTPS origin, with no credentials, path, query, fragment, or trailing path component.
3. An authorized Venviewer platform administrator signed into the exact staging Vercel Preview. The browser relay obtains a fresh short-lived Clerk session token immediately before each API request. The bearer is transient only across the staging browser/Clerk TLS exchange, the encrypted loopback relay, the local CLI process, and the exact staging API TLS `Authorization` header. Never manually copy, persist, print, log, inspect, screenshot, or place it in Railway, this repository, an environment example, a command argument, shell history, chat, or an operations record.
4. A dedicated write-capable R2 parent credential held only by the trusted local operator process. Use it to sign a shortest-workable-lifetime child credential with `scope: "object-read-write"`, `actions: ["PutObject"]`, and `paths.prefixPaths: ["venues/trades-hall/rooms/grand-hall/xgrids/grand-hall-big-model-sog-fine-v1/"]`. The parent access-key ID must differ from the serving principal's access-key ID. Never place the parent in Railway, chat, the repository, screenshots, or receipts. Mint the child only after the base staging deployment is healthy; use a 3,600-second lifetime for the bounded rehearsal/admission window unless a shorter lifetime has already been timed successfully. If it expires, stop and restore/verify the intake-disabled deployment: remove its staged values without revealing them, remove and recheck the local artifact, revoke/delete that dedicated parent, provision a new dedicated parent, and mint an equally restricted child at the same now-absent deterministic run-specific artifact path before a fresh health check and preflight. Never broaden the scope.
5. Explicit browser permission before any later authenticated staging/package browser or WebGL QA. The owner granted this for the dedicated staging target on 2026-08-24; it does not extend to production.

The CLI also requires the reviewed local Git commit ID. The command below obtains it directly from `HEAD`, validates its lowercase hexadecimal form, and places it in the secret-free receipt. Before any network request, the CLI independently proves that this commit exists, is the exact repository `HEAD`, and that the tracked and untracked worktree is clean. Run only from the exact reviewed checkout; do not type an arbitrary digest. The selected API must be configured with the same commit as its deployed intake build, and both preflight and commit must return that exact value.

The source manifest for this intake is:

`C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_1\lcc2-result\Grand_Hall.lcc2`

Do not substitute another export or another `Grand_Hall.lcc2`. The CLI requires an absolute path, independently inspects the hierarchy, excludes `env.sog`, and refuses a receipt that does not match the code-pinned frontier.

## Staging architecture and provider setup — baby steps

This is the provider handoff, not an execution record. Do not execute any provider step in this section until the owner has reviewed the current clean local successor and explicitly says to resume. A push is a deployment trigger in the connected providers; do not use a merge or production branch for this exercise.

Use this exact isolated shape:

| Layer | Staging choice | Non-negotiable boundary |
|---|---|---|
| Web | Existing Vercel project's branch-scoped Preview deployment | It must use only branch-scoped staging variables and must not change the production deployment or production variables. The root Railway container is API-only and cannot serve this Vite app. |
| API | New Railway project/environment/service named `trades-hall-grand-hall-staging` | Connect only `codex/grand-hall-exact-runtime`; never connect or promote the production branch. |
| Database | New Neon project dedicated to this staging run | Do not create it as a child of, clone of, or connection to the production project. Ordinary Railway Postgres is not an approved substitute: this API runtime uses Neon's serverless WebSocket driver. |
| Runtime objects | New Cloudflare R2 bucket named `trades-hall-grand-hall-staging` in the default jurisdiction | Public access, `r2.dev`, and custom domains remain disabled. Do not reuse any production, legacy-upload, or Foundry bucket. |
| Authentication | New isolated Clerk staging/development instance | Use its `pk_test_` publishable key and matching secret/webhook secret only in staging. Do not add the staging domain or webhook to the production Clerk instance. |

Do not place any secret in chat or the Windows clipboard: clearing the current clipboard does not remove clipboard history, pinned history, or an already cloud-synchronised copy. Transfer provider secrets only with an approved password-manager capture/autotype flow, a masked prompt entered without clipboard, or the tested stdin handoff below. If none is available, stop. If Codex is operating the signed-in browser after the hold is lifted, the owner handles MFA, billing confirmations, and any one-time secret reveal; secret values must not be exposed through tool output, screenshots, inspected/logged browser Network payloads, or a recorded terminal.

1. In Neon, create a **new project** named `trades-hall-grand-hall-staging`. Inside only that new project, create the role `trades_hall_grand_hall_staging_owner`, then create the database `trades_hall_grand_hall_staging` owned by that role. In Neon's Connect dialog, explicitly select that exact database and role before obtaining each connection string. Record the direct hostname separately from the pooled hostname; the pooled hostname normally carries a `-pooler` marker and must not be used by the bootstrap guard below. Capture the pooled connection string into Railway's sealed `DATABASE_URL` field with approved password-manager capture/autotype, and enter the direct connection later only through the masked local prompt; do not use the Windows clipboard for either. Both URLs must select the code-pinned role and database above. The project may have a provider-default branch called `production`; that name does not make it Venviewer production, but the project itself must be new and staging-only.
2. In Cloudflare R2, create `trades-hall-grand-hall-staging` in the **default jurisdiction**. Open its Settings and verify `r2.dev` is disabled and no custom domain is attached.
3. Create one bucket-scoped **Object Read only** serving token. Its access-key ID and secret go only into the Railway `RUNTIME_PROFILE_R2_*` variables.
4. Create a second, dedicated bucket-scoped **Object Read & Write** parent token. Keep its access-key ID and secret local; never configure the parent in Railway. The locally signed child cannot exceed this parent and will later be narrowed to only `PutObject` under the exact canonical prefix.
5. In Clerk, create a separate staging/development application. Record its `pk_test_` publishable key and matching server secret. After the API origin exists, create a staging-only webhook endpoint at `https://<staging-api-host>/webhooks/clerk` and retain its signing secret only for the staging API.
6. In Railway, create a new project, create or rename its dedicated environment to `trades-hall-grand-hall-staging`, and create one empty API service with the same name. Generate its Railway HTTPS domain but do not connect the Git source yet. Record the pathless origin as `https://<staging-api-host>`. New Railway services can no longer opt into legacy `railway.json` Config as Code, so that repository file is not authority for this service. In the service dashboard explicitly stage and visually verify all of these settings before connecting the source: Dockerfile builder with root `Dockerfile`; start command `node --conditions=omnitwin-dist dist/index.js`; exactly one selected region with exactly one replica; application sleeping/serverless sleep disabled; healthcheck path `/health/ready` with a 60-second timeout; restart policy **On Failure** with at most 10 retries; no pre-deploy command or cron. Save non-secret screenshots or a written settings record that shows the one-region/one-replica boundary without exposing variables.
7. In the existing Vercel web project, enable Vercel's system environment variables for the build and add the complete checklist from `packages/web/.env.grand-hall-staging.example`, scoped only to Preview branch `codex/grand-hall-exact-runtime`. The three server-side build bindings are `VENVIEWER_STAGING_REVIEWED_GIT_SHA=<exact-reviewed-successor-sha>`, `VENVIEWER_STAGING_EXPECTED_API_ORIGIN=https://<staging-api-service>.up.railway.app`, and `VENVIEWER_STAGING_EXPECTED_CLERK_FRONTEND_API=<isolated-instance>.clerk.accounts.dev`. The public inputs are `VITE_DEPLOYMENT_TIER=staging`, `VITE_API_URL` equal to that recorded API origin, and the isolated `VITE_CLERK_PUBLISHABLE_KEY=<staging-pk_test-key>`. Remove every inherited Sentry/source-map/PostHog variable from this branch Preview, including empty values; the build deliberately rejects them so it cannot upload or send QA traffic to production telemetry. Do not create or override `VERCEL`, `VERCEL_ENV`, `VERCEL_TARGET_ENV`, `VERCEL_GIT_COMMIT_REF`, or `VERCEL_GIT_COMMIT_SHA`; every Vercel build requires the system branch/SHA metadata, staging binds it to Preview plus the exact reviewed branch/SHA, and a Production-tier build from this dedicated branch fails closed. All `VITE_*` values are public build inputs; never place a secret or admin token in them.
8. Only after explicit resume, use the fail-closed exact-ref push procedure below. It pushes the reviewed commit object to only the dedicated branch without merging it, verifies the remote ref, and triggers this repository's CI for that branch. Require the exact-SHA CI run to pass. Let Vercel create the branch Preview, then record its stable branch HTTPS origin and confirm the Vercel deployment identifies that same reviewed commit.
9. Add that exact staging web origin to the staging Clerk application if its domain policy requires it. Set Railway `CORS_ORIGINS`, `FRONTEND_URL`, and the independent `VENVIEWER_STAGING_EXPECTED_WEB_ORIGIN` binding to that same pathless origin. Set `PUBLIC_API_ORIGIN` to the Railway API origin. The bindings must be coherent:

   ```text
   PUBLIC_API_ORIGIN=https://<staging-api-host>
   CORS_ORIGINS=https://<staging-web-host>
   FRONTEND_URL=https://<staging-web-host>
   VENVIEWER_STAGING_EXPECTED_WEB_ORIGIN=https://<staging-web-host>
   VITE_API_URL=https://<staging-api-host>
   VENVIEWER_STAGING_EXPECTED_API_ORIGIN=https://<staging-api-host>
   ```

10. Configure the complete required Railway variables in the next section with intake disabled. Remove inherited `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_RELEASE`, `POSTHOG_KEY`, and `POSTHOG_HOST` variables entirely, including empty definitions; staging startup rejects their presence to prevent QA/intake data entering production telemetry. Seal every database, Clerk, and R2 secret. Railway sealed values are write-only and are not copied when environments or services are duplicated, so keep the provider originals in the approved password manager.
11. Re-open the service settings and require the staged configuration still shows one region / one replica, sleep disabled, `/health/ready`, the exact start command, Dockerfile builder, and the restart settings above. Only then connect the Railway API service to GitHub branch `codex/grand-hall-exact-runtime` and deploy the exact reviewed commit. Do not use `railway up`, a local tarball, another branch, or a mutable image tag for this proof. Do not scale above one replica during rehearsal or intake: the in-process exclusive admission guard relies on this provider boundary.
12. In the deployment details, record the effective settings and again prove exactly one active replica. Run the fail-closed base-deployment health gate below; do not rely on a browser glance. It requires no redirect, `GET /health/ready` HTTP 200 with `status: "ok"`, and `GET /health/version` HTTP 200 with `nodeEnv: "production"` plus the full reviewed SHA, then retains a safe JSON receipt. On this staging target, readiness asks PostgreSQL for `current_database()` and `current_user` and accepts only the code-pinned staging database and role. It does **not** prove migrations are applied.

### Exact-ref push gate — execute only at step 8 after explicit resume

All PowerShell in this runbook requires 64-bit PowerShell Core 7.4 or newer. Launch `pwsh`; never use Windows PowerShell 5.1 (`powershell.exe`). Repeat the version gate at the start of every restored operator shell.

This repository's CI now runs on pushes to `codex/grand-hall-exact-runtime` as well as `master`. The staging branch must still be pushed by immutable commit ID rather than by mutable `HEAD`. Run this block from the reviewed worktree. It refuses a dirty checkout, another branch, another remote, a non-descendant of the owner-reviewed vertical-slice base, or a pre-existing remote branch at different bytes. It creates the external evidence root used throughout the run and records only non-secret Git identity:

```powershell
if ($PSVersionTable.PSEdition -cne 'Core' -or
    $PSVersionTable.PSVersion -lt [Version]'7.4.0' -or
    -not [Environment]::Is64BitProcess) {
  throw "Grand Hall staging requires 64-bit PowerShell Core 7.4 or newer."
}
$forbiddenGitOverrides = @('GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES')
if (@($forbiddenGitOverrides | Where-Object { Test-Path -LiteralPath "Env:$_" }).Count -ne 0) {
  throw "Remove Git repository-discovery environment overrides before staging."
}
$reviewedBaseSha = "3b14335b28d98ea1654f29713e5272d1d22a066f"
$reviewedSuccessorSha = "<exact-reviewed-successor-sha>"
$stagingBranch = "codex/grand-hall-exact-runtime"
$expectedOriginRemote = "https://github.com/codemaker66/omnitwin.git"

$localHead = (& git rev-parse --verify 'HEAD^{commit}').Trim()
$localBranch = (& git branch --show-current).Trim()
$originFetchRemote = (& git remote get-url origin).Trim()
$originPushRemote = (& git remote get-url --push origin).Trim()
$worktreeStatus = @(& git status --porcelain=v1 --untracked-files=all --ignore-submodules=none)
if ($LASTEXITCODE -ne 0 -or
    $localHead -cne $reviewedSuccessorSha -or
    $localBranch -cne $stagingBranch -or
    $originFetchRemote -cne $expectedOriginRemote -or
    $originPushRemote -cne $expectedOriginRemote -or
    $worktreeStatus.Count -ne 0) {
  throw "The exact clean Grand Hall staging ref is not selected for push."
}
& git merge-base --is-ancestor $reviewedBaseSha $reviewedSuccessorSha
if ($LASTEXITCODE -ne 0) {
  throw "The selected successor does not descend from the reviewed Grand Hall vertical slice."
}

$evidenceRoot = Join-Path $env:LOCALAPPDATA (
  "Venviewer\grand-hall-staging-evidence\run-{0}-{1}" -f `
    (Get-Date -Format "yyyyMMdd-HHmmss"), [Guid]::NewGuid().ToString('N')
)
New-Item -ItemType Directory -Path $evidenceRoot -ErrorAction Stop | Out-Null
$evidenceAncestor = [IO.DirectoryInfo]::new($evidenceRoot)
while ($null -ne $evidenceAncestor) {
  if (Test-Path -LiteralPath (Join-Path $evidenceAncestor.FullName '.git')) {
    throw "The Grand Hall evidence root is inside a Git worktree."
  }
  $evidenceAncestor = $evidenceAncestor.Parent
}
$containingGitRoot = @(& git -C $evidenceRoot rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -eq 0 -or $containingGitRoot.Count -ne 0) {
  throw "The Grand Hall evidence root is inside a Git worktree."
}

$remoteRef = "refs/heads/$stagingBranch"
$remoteBefore = @(& git ls-remote --heads $expectedOriginRemote $remoteRef)
if ($LASTEXITCODE -ne 0 -or $remoteBefore.Count -gt 1) {
  throw "The dedicated remote staging ref could not be established safely."
}
if ($remoteBefore.Count -eq 1) {
  $remoteBeforeSha = ($remoteBefore[0] -split '\s+')[0]
  if ($remoteBeforeSha -cne $reviewedSuccessorSha) {
    throw "The remote staging branch already points at different bytes; do not force-push."
  }
} else {
  & git push "--force-with-lease=${remoteRef}:" `
    $expectedOriginRemote `
    "${reviewedSuccessorSha}:$remoteRef"
  if ($LASTEXITCODE -ne 0) { throw "The exact staging ref push failed." }
}

$remoteAfter = @(& git ls-remote --heads $expectedOriginRemote $remoteRef)
if ($LASTEXITCODE -ne 0 -or $remoteAfter.Count -ne 1) {
  throw "The pushed staging ref could not be verified."
}
$remoteAfterSha = ($remoteAfter[0] -split '\s+')[0]
if ($remoteAfterSha -cne $reviewedSuccessorSha) {
  throw "The remote staging ref does not equal the reviewed successor."
}

$pushEvidencePath = Join-Path $evidenceRoot "00-exact-ref-push.json"
$pushEvidence = [ordered]@{
  schemaVersion = "venviewer.grand-hall-exact-ref-push-evidence.v1"
  recordedAt = (Get-Date).ToUniversalTime().ToString('o')
  remote = $expectedOriginRemote
  branch = $stagingBranch
  reviewedBaseSha = $reviewedBaseSha
  reviewedSuccessorSha = $reviewedSuccessorSha
  remoteSha = $remoteAfterSha
}
$pushBytes = [Text.UTF8Encoding]::new($false).GetBytes(
  (($pushEvidence | ConvertTo-Json -Depth 4 -Compress) + "`n")
)
$pushStream = [IO.FileStream]::new(
  $pushEvidencePath,
  [IO.FileMode]::CreateNew,
  [IO.FileAccess]::Write,
  [IO.FileShare]::None
)
try {
  $pushStream.Write($pushBytes, 0, $pushBytes.Length)
  $pushStream.Flush($true)
} finally {
  $pushStream.Dispose()
  [Array]::Clear($pushBytes, 0, $pushBytes.Length)
}
```

The empty expected value in `--force-with-lease="$remoteRef:"` is an atomic create-only lease: it fails if any actor creates the remote ref after the precheck and never authorizes rewriting an existing ref. On a lease failure, stop and rerun the full precheck; do not remove or weaken the lease.

Wait for the GitHub Actions `CI` run whose commit is exactly `$reviewedSuccessorSha`; require every job to pass and retain the non-secret run URL/commit association. A branch push does not authorize a PR, merge, production deployment, or rewrite/force-update of an existing ref. Do not connect Railway to the branch or accept the Vercel Preview as deployable evidence until that exact-SHA CI run is green.

### Fail-closed deployment health evidence

Define this helper once in the same unrecorded operator PowerShell. It uses a no-redirect HTTP client, a 30-second per-endpoint request deadline, and a 64 KiB response cap. It exclusively creates a safe JSON receipt under the external run directory only after both endpoints prove the expected staging state:

```powershell
if ($PSVersionTable.PSEdition -cne 'Core' -or
    $PSVersionTable.PSVersion -lt [Version]'7.4.0' -or
    -not [Environment]::Is64BitProcess) {
  throw "Grand Hall staging requires 64-bit PowerShell Core 7.4 or newer."
}
function Invoke-GrandHallStagingHealthGate {
  param(
    [Parameter(Mandatory = $true)][string]$ApiOrigin,
    [Parameter(Mandatory = $true)][string]$ReviewedGitSha,
    [Parameter(Mandatory = $true)][string]$EvidenceRoot,
    [Parameter(Mandatory = $true)][string]$Out
  )

  if ($ApiOrigin -cnotmatch '^https://[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.up\.railway\.app$' -or
      $ReviewedGitSha -cnotmatch '^[a-f0-9]{40}$') {
    throw "The staging health selection is not a clean Railway origin and exact Git SHA."
  }
  $canonicalEvidenceRoot = (Resolve-Path -LiteralPath $EvidenceRoot -ErrorAction Stop).Path
  $canonicalOutParent = (Resolve-Path -LiteralPath (Split-Path -Parent $Out) -ErrorAction Stop).Path
  $evidenceRootInfo = Get-Item -LiteralPath $canonicalEvidenceRoot -Force -ErrorAction Stop
  $forbiddenGitOverrides = @('GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES')
  if (@($forbiddenGitOverrides | Where-Object { Test-Path -LiteralPath "Env:$_" }).Count -ne 0) {
    throw "Remove Git repository-discovery environment overrides before health evidence."
  }
  $evidenceAncestor = [IO.DirectoryInfo]::new($canonicalEvidenceRoot)
  while ($null -ne $evidenceAncestor) {
    if (Test-Path -LiteralPath (Join-Path $evidenceAncestor.FullName '.git')) {
      throw "The staging health evidence root is inside a Git worktree."
    }
    $evidenceAncestor = $evidenceAncestor.Parent
  }
  $containingGitRoot = @(& git -C $canonicalEvidenceRoot rev-parse --show-toplevel 2>$null)
  if (-not [IO.Path]::IsPathFullyQualified($Out) -or
      ($evidenceRootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
      $LASTEXITCODE -eq 0 -or
      $containingGitRoot.Count -ne 0 -or
      -not [StringComparer]::OrdinalIgnoreCase.Equals(
        $canonicalOutParent,
        $canonicalEvidenceRoot
      ) -or
      (Test-Path -LiteralPath $Out)) {
    throw "The staging health evidence path is not a fresh file in the approved run directory."
  }

  $assertExactPropertyNames = {
    param(
      [object]$Value,
      [string[]]$Expected,
      [string]$Label
    )
    if ($null -eq $Value -or $Value -isnot [pscustomobject]) {
      throw "$Label is not a JSON object."
    }
    $actual = @($Value.PSObject.Properties.Name | Sort-Object)
    $wanted = @($Expected | Sort-Object)
    if (@(Compare-Object -ReferenceObject $wanted -DifferenceObject $actual -CaseSensitive).Count -ne 0) {
      throw "$Label contains missing or non-allowlisted fields."
    }
  }
  $assertJsonString = {
    param(
      [object]$Value,
      [string]$Expected,
      [string]$Label
    )
    if ($Value -isnot [string] -or $Value -cne $Expected) {
      throw "$Label is not the exact expected JSON string."
    }
  }

  $handler = [Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $false
  $handler.UseCookies = $false
  $client = [Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(30)
  $client.MaxResponseContentBufferSize = 65536
  try {
    $readJson = {
      param([string]$RequestUri)
      $response = $null
      try {
        $response = $client.GetAsync($RequestUri).GetAwaiter().GetResult()
        if ([int]$response.StatusCode -ne 200 -or $null -ne $response.Headers.Location) {
          throw "A staging health endpoint returned a non-200 or redirect response."
        }
        if ($response.Content.Headers.ContentType.MediaType -cne 'application/json') {
          throw "A staging health endpoint did not return JSON."
        }
        $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if ([Text.Encoding]::UTF8.GetByteCount($text) -gt 65536) {
          throw "A staging health endpoint exceeded the response limit."
        }
        try { return $text | ConvertFrom-Json -NoEnumerate -ErrorAction Stop } catch {
          throw "A staging health endpoint returned invalid JSON."
        }
      } finally {
        if ($null -ne $response) { $response.Dispose() }
      }
    }

    $ready = & $readJson "$ApiOrigin/health/ready"
    $version = & $readJson "$ApiOrigin/health/version"
  } finally {
    $client.Dispose()
    $handler.Dispose()
  }
  & $assertExactPropertyNames $ready @('status') 'Readiness response'
  & $assertExactPropertyNames $version @(
    'version', 'gitSha', 'builtAt', 'nodeEnv'
  ) 'Version response'
  & $assertJsonString $ready.status 'ok' 'Readiness status'
  & $assertJsonString $version.nodeEnv 'production' 'Version Node environment'
  & $assertJsonString $version.gitSha $ReviewedGitSha 'Version Git SHA'
  if ($version.version -isnot [string] -or
      [String]::IsNullOrWhiteSpace($version.version) -or
      $version.builtAt -isnot [string] -or
      [String]::IsNullOrWhiteSpace($version.builtAt)) {
    throw "The staging version metadata is not composed of non-empty JSON strings."
  }

  $receipt = [ordered]@{
    schemaVersion = "venviewer.grand-hall-staging-health-evidence.v1"
    recordedAt = (Get-Date).ToUniversalTime().ToString('o')
    targetId = "trades-hall-grand-hall-staging"
    apiOrigin = $ApiOrigin
    reviewedGitSha = $ReviewedGitSha
    ready = [ordered]@{ httpStatus = 200; status = $ready.status }
    version = [ordered]@{
      httpStatus = 200
      version = $version.version
      gitSha = $version.gitSha
      builtAt = $version.builtAt
      nodeEnv = $version.nodeEnv
    }
    redirectsFollowed = 0
  }
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(
    (($receipt | ConvertTo-Json -Depth 5 -Compress) + "`n")
  )
  $outLeaf = Split-Path -Leaf $Out
  $pendingOut = Join-Path $canonicalEvidenceRoot (
    ".{0}.{1}.pending" -f $outLeaf, ([Guid]::NewGuid().ToString('N'))
  )
  $stream = [IO.FileStream]::new(
    $pendingOut,
    [IO.FileMode]::CreateNew,
    [IO.FileAccess]::Write,
    [IO.FileShare]::None
  )
  try {
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally {
    $stream.Dispose()
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
  [IO.File]::Move($pendingOut, $Out, $false)
  return $receipt
}

$recordedStagingApiOrigin = "<Railway-recorded-clean-staging-api-origin>"
$baseHealthPath = Join-Path $evidenceRoot "health-01-intake-disabled-base.json"
$baseHealth = Invoke-GrandHallStagingHealthGate `
  -ApiOrigin $recordedStagingApiOrigin `
  -ReviewedGitSha $reviewedSuccessorSha `
  -EvidenceRoot $evidenceRoot `
  -Out $baseHealthPath
```

The function's `apiOrigin` field proves the no-redirect request target selected by the operator; `/health/version` itself does not and must not be described as returning an origin. If a new shell is required later, restore the same external `$evidenceRoot`, re-enter the same non-secret origin/SHA selections, and redefine the identical helper before continuing. Never overwrite or delete an earlier receipt to make a later deployment appear successful.

## Target-side configuration

Deploy the reviewed T-540 code to the selected API before enabling intake. Configure secrets in the target's secret manager, never in a committed file.

| Variable | Required value and authority |
|---|---|
| `DATABASE_URL` | Pooled connection for the new, isolated Neon staging project, selecting role `trades_hall_grand_hall_staging_owner` and database `trades_hall_grand_hall_staging`. Those identities are code-pinned rather than configured beside the secret. Do not use a production-derived branch, reuse another target's URL, or substitute ordinary Railway Postgres. Use the matching direct connection only in the local migration/bootstrap process; do not put that second URL in Railway. |
| `VENVIEWER_DEPLOYMENT_TARGET_ID` | Persistent deployment identity, exactly `trades-hall-grand-hall-staging`. Keep it after intake is disabled so authenticated QA cannot silently bind to production resources. |
| `VENVIEWER_STAGING_REVIEWED_GIT_SHA` | Persistent exact reviewed successor SHA. The Docker-stamped `GIT_SHA` must equal it during intake-disabled setup, intake, shutdown proof, and QA. |
| `VENVIEWER_STAGING_EXPECTED_DATABASE_HOST` | Separately recorded exact lowercase pooled Neon hostname. Every staging startup requires `DATABASE_URL` to match it, requires a `*-pooler.*.neon.tech` host, requires the code-pinned role/database above, and permits only strict TLS query parameters. |
| `PUBLIC_API_ORIGIN` | The selected clean HTTPS API origin. It must exactly equal the CLI `--api-origin`. |
| `BUILD_GIT_SHA` | Set in Railway to `${{RAILWAY_GIT_COMMIT_SHA}}`. The Dockerfile derives runtime `GIT_SHA` from this build arg; do not set `GIT_SHA` independently. The resulting stamp must always equal `VENVIEWER_STAGING_REVIEWED_GIT_SHA`, and while intake is enabled must also equal `RUNTIME_PROFILE_INTAKE_DEPLOYED_GIT_SHA`. |
| `BUILD_APP_VERSION` | `0.0.4`, matching `packages/api/package.json`, so `/health/version` does not fall back to `0.0.0`. This is metadata, not the Git identity gate. |
| `CORS_ORIGINS` / `FRONTEND_URL` / `VENVIEWER_STAGING_EXPECTED_WEB_ORIGIN` | The same exact clean HTTPS Vercel staging branch origin, with no production origin added for this isolated target. The expected-origin binding remains configured after intake shutdown. |
| `CLERK_SECRET_KEY` / `CLERK_WEBHOOK_SECRET` | Secrets from the isolated Clerk staging instance and its staging-only `/webhooks/clerk` endpoint. Do not reuse or modify the production Clerk instance. |
| `RUNTIME_PROFILE_R2_ACCOUNT_ID` | Exact 32-character lowercase hexadecimal Cloudflare account ID containing the new staging-only private R2 bucket. Endpoint-like values are rejected before client construction. |
| `RUNTIME_PROFILE_R2_PRIVATE_BUCKET` | Exactly `trades-hall-grand-hall-staging`, created in R2's default jurisdiction with every public access path disabled. |
| `RUNTIME_PROFILE_R2_ACCESS_KEY_ID` | Bucket-scoped Object Read only serving principal. |
| `RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY` | Secret for that read-only serving principal. |
| `RUNTIME_PROFILE_INTAKE_TARGET_ID` | The selected target ID. It must exactly equal the CLI `--target-id`. |
| `RUNTIME_PROFILE_INTAKE_DEPLOYED_GIT_SHA` | Intentional intake deployment selection: the exact lowercase 40–64 digit reviewed commit expected in the running image. It must equal both the image-stamped `GIT_SHA` and CLI `--reviewed-git-sha`; do not use a caller assertion, branch name, or mutable release label. |
| `RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID` | Access-key ID from the locally signed, short-lived child credential. It is used only by the intake writer. |
| `RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY` | Secret access key from the same short-lived child credential. |
| `RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN` | Session token from the same short-lived child credential. Treat it as a bearer secret and configure it only with the other two child fields. |
| `RUNTIME_PROFILE_INTAKE_ENABLED` | `true` only for the approved intake window; its default and normal resting value are `false`. |
| Railway-provided identity | Do not create or override `RAILWAY_PROJECT_NAME`, `RAILWAY_ENVIRONMENT_NAME`, `RAILWAY_SERVICE_NAME`, `RAILWAY_PUBLIC_DOMAIN`, or `RAILWAY_GIT_BRANCH`. Every staging startup requires the first three to equal `trades-hall-grand-hall-staging`, the public domain to equal `PUBLIC_API_ORIGIN`'s hostname, and the branch to equal `codex/grand-hall-exact-runtime`. Seeing that branch without the complete configured staging boundary also fails startup, blocking ordinary mismatched or production-shaped variable sets. |

The read principal needs only the object-read authority required for complete verification and authenticated serving. The locally signed child credential must be restricted to `PutObject` on the immutable code-owned prefix above; it must not have read, list, delete, or out-of-prefix authority. The API passes its session token only to the intake writer, always supplies `If-None-Match: *` on its only PutObject call, and never issues an unconditional overwrite. Keep the write-capable parent local. Keep public bucket access, `r2.dev`, and custom public domains disabled. The committed R2 endpoint is the default-jurisdiction endpoint; do not create an EU-jurisdiction bucket for this run unless the endpoint becomes configurable and that change is separately reviewed.

Configuration is complete only when the API starts successfully and `/health/version` reports the intended image-stamped `GIT_SHA`. The persistent staging boundary rejects values that conflict with the recorded database host plus code-pinned role/database, private-bucket name, syntactic Cloudflare account ID, API/web origins, Clerk test-key shape, Railway names/domain/branch, telemetry-absence rule, or reviewed build stamp even when intake is disabled. These application checks cannot cryptographically identify the Neon project, Cloudflare account, Clerk application, or Railway project; retain the separate provider-console resource IDs/settings evidence created during setup. A disabled deployment is also rejected if any of the five intake-only target/deployment/temporary-writer fields remains configured. The temporary configured deployed Git SHA is required whenever intake is enabled; it is not inferred from an operator request. Do not infer the target from a shell prompt, a project name, a browser tab, or the operator's local `.env` file.

Use the staging-safe checklist in `packages/api/.env.grand-hall-staging.example`; `packages/api/.env.production.example` remains a general production reference and must not be copied into this target. Configure only the required values and complete optional feature groups; empty optional example values fail validation. For this staging run, the required API values are `NODE_ENV`, `VENVIEWER_DEPLOYMENT_TARGET_ID`, `VENVIEWER_STAGING_REVIEWED_GIT_SHA`, `DATABASE_URL`, the `VENVIEWER_STAGING_EXPECTED_DATABASE_HOST` binding, the isolated `CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SECRET`, identical `CORS_ORIGINS` / `FRONTEND_URL` / `VENVIEWER_STAGING_EXPECTED_WEB_ORIGIN`, `PUBLIC_API_ORIGIN`, the four `RUNTIME_PROFILE_R2_*` serving fields, `BUILD_GIT_SHA`, `BUILD_APP_VERSION`, and an explicit `RUNTIME_PROFILE_INTAKE_ENABLED=false`. Railway injects the five provider-identity values above. Add the target/deployed-SHA/three child-credential fields only for the temporary enabled window. Keep the persistent staging identity, reviewed SHA, database, web-origin, provider-identity, Clerk, API-origin, and read-only R2 bindings after intake shutdown. The admin token/relay selections, `VENVIEWER_GRAND_HALL_REVIEWED_GIT_SHA`, both `VENVIEWER_PLATFORM_ADMIN_BOOTSTRAP_*` selectors, and all four local `VENVIEWER_GRAND_HALL_R2_*` mint inputs—especially the writer-parent access key and secret—are never Railway variables. The deployed API rejects even empty definitions of every such local-only field rather than silently stripping them.

## Fresh database migration and staging administrator

On this staging target, `/health/ready` proves the server-reported database name and role, but it can return 200 before the application schema exists. Railway has no staging migration hook in this repository. Migrate the new Neon project explicitly from the exact reviewed checkout with the staging-only guarded command, then run the read-only tail verifier. Never use the generic `db:migrate` command for this staging proof. Never run `db:seed` or set `SEED_ALLOW_REMOTE`: the seed creates demo users and all six room records, which violates this isolated Grand Hall exercise.

Use Neon's **direct** staging connection for the local migration process. The Railway API continues to use the separately bound pooled staging connection. In a local PowerShell that is not being recorded, enter the direct URL through a hidden prompt using approved password-manager autotype or manual entry—never clipboard paste—so it does not enter the command line, shell history, clipboard history, or cloud clipboard:

```powershell
$minimumPowerShellVersion = [Version]'7.4.0'
if ($PSVersionTable.PSEdition -cne 'Core' -or
    $PSVersionTable.PSVersion -lt $minimumPowerShellVersion -or
    -not [Environment]::Is64BitProcess) {
  throw "Grand Hall staging requires 64-bit PowerShell Core 7.4 or newer."
}
$reviewedSuccessorSha = "<exact-reviewed-successor-sha>"
if (!(Test-Path -LiteralPath $evidenceRoot -PathType Container)) {
  throw "The external evidence directory created by the exact-ref push gate is unavailable."
}
$recordedDirectNeonHost = "<recorded-direct-staging-neon-host>"
$secureDatabaseUrl = Read-Host "Autotype or enter the direct URL for the new staging-only Neon project (never paste)" -AsSecureString
$databaseUrlPointer = [IntPtr]::Zero
try {
  $databaseUrlPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureDatabaseUrl)
  $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($databaseUrlPointer)
  $env:VENVIEWER_PLATFORM_ADMIN_BOOTSTRAP_TARGET_ID = "trades-hall-grand-hall-staging"
  $env:VENVIEWER_PLATFORM_ADMIN_BOOTSTRAP_EXPECTED_DATABASE_HOST = $recordedDirectNeonHost
  $env:VENVIEWER_GRAND_HALL_REVIEWED_GIT_SHA = $reviewedSuccessorSha

  & pnpm --silent --filter @omnitwin/api db:migrate-grand-hall-staging
  if ($LASTEXITCODE -ne 0) {
    throw "Guarded fresh staging migration failed; do not rerun against this database."
  }

  $migrationEvidencePath = Join-Path $evidenceRoot "migration-readiness.json"
  & pnpm --silent --filter @omnitwin/api db:verify-tail -- --deploy-gate --out $migrationEvidencePath
  if ($LASTEXITCODE -ne 0) { throw "Post-migration tail verification failed." }
  $migrationEvidence = Get-Content -LiteralPath $migrationEvidencePath -Raw |
    ConvertFrom-Json -NoEnumerate -ErrorAction Stop
  if ($migrationEvidence.journal.pendingCount -ne 0 -or
      $migrationEvidence.journal.prefixMatches -ne $true -or
      $migrationEvidence.prerequisites.complete -ne $true) {
    throw "The staging database is not at the reviewed migration tail."
  }

  & pnpm --silent --filter @omnitwin/api platform-admin:bootstrap -- `
    --email "<exact-verified-staging-clerk-email>" `
    --name "<staging-operator-name>"
  if ($LASTEXITCODE -ne 0) { throw "Staging platform-admin bootstrap failed." }
} finally {
  Remove-Item Env:VENVIEWER_PLATFORM_ADMIN_BOOTSTRAP_TARGET_ID -ErrorAction SilentlyContinue
  Remove-Item Env:VENVIEWER_PLATFORM_ADMIN_BOOTSTRAP_EXPECTED_DATABASE_HOST -ErrorAction SilentlyContinue
  Remove-Item Env:VENVIEWER_GRAND_HALL_REVIEWED_GIT_SHA -ErrorAction SilentlyContinue
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  if ($databaseUrlPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($databaseUrlPointer)
  }
  $secureDatabaseUrl.Dispose()
}
```

The guarded migrator and privileged bootstrap do not load `packages/api/.env`. Before opening a database client, each independently requires `VENVIEWER_GRAND_HALL_REVIEWED_GIT_SHA`, proves that commit exists and is exact `HEAD`, and rejects every tracked or untracked worktree change. The Git child receives no database or provider credentials. Before its first mutation, the migrator applies the same exact staging target/direct-host/query validator used by bootstrap and requires the URL and the server-reported identity to use code-pinned database `trades_hall_grand_hall_staging` and role `trades_hall_grand_hall_staging_owner`. It obtains a staging migration advisory lock, fails safely on asynchronous pool errors, and requires both zero public tables and no Drizzle migration ledger. It then applies the committed journal in-process without spawning a generic migration child. A failure can leave a partial schema, so do not rerun or weaken the freshness check; preserve the target for investigation and provision another fresh staging database if authorized. The post-migration verifier must prove zero pending migrations, an exact journal prefix, and complete prerequisites. Bootstrap then revalidates the URL and rechecks server-reported database/role inside its transaction before taking its own advisory lock. It locks every public application table against concurrent writes and refuses a row in any table other than an idempotent exact-email `users` retry. It creates or upgrades only that exact email row and leaves `clerk_id` null until first sign-in. Sign into the staging web with that exact verified Clerk email, then require authenticated `GET /auth/me` to show both `role: "admin"` and database-authoritative `platformRole: "admin"`. Stop if the email differs, the row is not linked, or either role is missing.

## Mint, stage, and seal the temporary R2 writer

Do this only after the intake-disabled API is healthy, the exact build SHA is visible at `/health/version`, migrations are verified, and the staging administrator has signed in successfully. The dedicated parent token stays local. The mint helper signs locally with Node built-ins, is pinned to bucket `trades-hall-grand-hall-staging`, and restricts the child to `PutObject` under the exact Grand Hall prefix. On this Windows workstation it writes one new CurrentUser-DPAPI-protected binary artifact outside every Git worktree. It writes no secret to standard output and never creates a plaintext credential JSON file.

Install the official Railway CLI and complete its browser login **before** minting the child. Use the CLI's existing CurrentUser login file; do not set `RAILWAY_TOKEN` or `RAILWAY_API_TOKEN`. Record the dedicated staging project's, environment's, and API service's non-secret lowercase UUIDs from Railway. All three provider resources must be named exactly `trades-hall-grand-hall-staging`.

Run the following in a local PowerShell that is not being recorded. Obtain the account ID and the dedicated Object Read & Write parent access-key pair directly from Cloudflare's R2 token screen or the approved password manager. Enter them with approved password-manager autotype or manual entry, never clipboard paste. Do not use the Object Read only serving credential here.

```powershell
if ($PSVersionTable.PSEdition -cne 'Core' -or
    $PSVersionTable.PSVersion -lt [Version]'7.4.0' -or
    -not [Environment]::Is64BitProcess) {
  throw "Grand Hall staging requires 64-bit PowerShell Core 7.4 or newer."
}
function Assert-GrandHallReviewedCleanCheckout {
  param([Parameter(Mandatory = $true)][string]$ReviewedSuccessorSha)

  $forbiddenOverrides = @(
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES'
  )
  if ($ReviewedSuccessorSha -cnotmatch '^[a-f0-9]{40}$' -or
      @($forbiddenOverrides | Where-Object { Test-Path -LiteralPath "Env:$_" }).Count -ne 0) {
    throw "The reviewed checkout selection or Git environment is invalid."
  }
  $gitRootResult = @(& git rev-parse --show-toplevel)
  $gitRootExit = $LASTEXITCODE
  $headResult = @(& git rev-parse --verify 'HEAD^{commit}')
  $headExit = $LASTEXITCODE
  $branchResult = @(& git branch --show-current)
  $branchExit = $LASTEXITCODE
  $statusResult = @(
    & git status --porcelain=v1 --untracked-files=all --ignore-submodules=none
  )
  $statusExit = $LASTEXITCODE
  if ($gitRootExit -ne 0 -or $gitRootResult.Count -ne 1 -or
      $headExit -ne 0 -or $headResult.Count -ne 1 -or
      $branchExit -ne 0 -or $branchResult.Count -ne 1 -or
      $statusExit -ne 0 -or $statusResult.Count -ne 0) {
    throw "The reviewed checkout could not be established as clean and unique."
  }
  $canonicalGitRoot = (Resolve-Path -LiteralPath $gitRootResult[0] -ErrorAction Stop).Path
  $canonicalCurrentDirectory = (Resolve-Path -LiteralPath (Get-Location).Path -ErrorAction Stop).Path
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals(
        $canonicalCurrentDirectory,
        $canonicalGitRoot
      ) -or
      $headResult[0] -cne $ReviewedSuccessorSha -or
      $branchResult[0] -cne 'codex/grand-hall-exact-runtime') {
    throw "The exact reviewed Grand Hall branch and commit are not selected."
  }
}

Assert-GrandHallReviewedCleanCheckout -ReviewedSuccessorSha $reviewedSuccessorSha
function Get-GrandHallWriterArtifacts {
  param([Parameter(Mandatory = $true)][string]$ArtifactPath)

  if (-not [IO.Path]::IsPathFullyQualified($ArtifactPath)) {
    throw "The Grand Hall writer artifact path is not absolute."
  }
  $artifactCanonical = [IO.Path]::GetFullPath($ArtifactPath)
  $artifactDirectory = Split-Path -Parent $artifactCanonical
  $artifactLeaf = Split-Path -Leaf $artifactCanonical
  $temporaryArtifactName = '^\.{0}\.[0-9a-fA-F]{{8}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{12}}\.tmp$' -f `
    [regex]::Escape($artifactLeaf)
  if (!(Test-Path -LiteralPath $artifactDirectory -PathType Container)) {
    return @()
  }
  return @(
    Get-ChildItem -LiteralPath $artifactDirectory -Force -File -ErrorAction Stop |
      Where-Object {
        [StringComparer]::OrdinalIgnoreCase.Equals(
          [IO.Path]::GetFullPath($_.FullName),
          $artifactCanonical
        ) -or $_.Name -match $temporaryArtifactName
      }
  )
}

function Remove-GrandHallWriterArtifacts {
  param([Parameter(Mandatory = $true)][string]$ArtifactPath)

  foreach ($artifact in @(Get-GrandHallWriterArtifacts -ArtifactPath $ArtifactPath)) {
    Remove-Item -LiteralPath $artifact.FullName -Force -ErrorAction Stop
  }
  if (@(Get-GrandHallWriterArtifacts -ArtifactPath $ArtifactPath).Count -ne 0) {
    throw "A Grand Hall DPAPI writer artifact or temporary sibling was not removed."
  }
}

$evidenceRunId = Split-Path -Leaf $evidenceRoot
if ($evidenceRunId -cnotmatch '^run-[0-9]{8}-[0-9]{6}-[0-9a-f]{32}$') {
  throw "The approved Grand Hall evidence run ID is invalid."
}
$credentialArtifact = Join-Path $env:TEMP `
  ("grand-hall-r2-writer-{0}.dpapi" -f $evidenceRunId)
$credentialAncestor = [IO.DirectoryInfo]::new((Split-Path -Parent $credentialArtifact))
while ($null -ne $credentialAncestor) {
  if (Test-Path -LiteralPath (Join-Path $credentialAncestor.FullName '.git')) {
    throw "The Grand Hall writer artifact directory is inside a Git worktree."
  }
  $credentialAncestor = $credentialAncestor.Parent
}
$forbiddenGitOverrides = @('GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES')
if (@($forbiddenGitOverrides | Where-Object { Test-Path -LiteralPath "Env:$_" }).Count -ne 0) {
  throw "Remove Git repository-discovery environment overrides before minting."
}
$credentialDirectoryGitRoot = @(
  & git -C (Split-Path -Parent $credentialArtifact) rev-parse --show-toplevel 2>$null
)
if ($LASTEXITCODE -eq 0 -or $credentialDirectoryGitRoot.Count -ne 0) {
  throw "The Grand Hall writer artifact directory is inside a Git worktree."
}
if (@(Get-GrandHallWriterArtifacts -ArtifactPath $credentialArtifact).Count -ne 0) {
  throw "A run-specific Grand Hall writer artifact or temporary sibling already exists."
}
$secureAccountId = $null
$secureParentAccessKeyId = $null
$secureParentSecret = $null
$accountIdPointer = [IntPtr]::Zero
$parentAccessKeyIdPointer = [IntPtr]::Zero
$parentSecretPointer = [IntPtr]::Zero
$mintSucceeded = $false
try {
  $secureAccountId = Read-Host "Enter the staging R2 account ID" -AsSecureString
  $secureParentAccessKeyId = Read-Host "Enter the dedicated writer-parent access-key ID" -AsSecureString
  $secureParentSecret = Read-Host "Enter the dedicated writer-parent secret access key" -AsSecureString
  Assert-GrandHallReviewedCleanCheckout -ReviewedSuccessorSha $reviewedSuccessorSha
  $accountIdPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureAccountId)
  $parentAccessKeyIdPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureParentAccessKeyId)
  $parentSecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureParentSecret)
  $env:VENVIEWER_GRAND_HALL_R2_ACCOUNT_ID =
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($accountIdPointer)
  $env:VENVIEWER_GRAND_HALL_R2_BUCKET = "trades-hall-grand-hall-staging"
  $env:VENVIEWER_GRAND_HALL_R2_WRITER_PARENT_ACCESS_KEY_ID =
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($parentAccessKeyIdPointer)
  $env:VENVIEWER_GRAND_HALL_R2_WRITER_PARENT_SECRET_ACCESS_KEY =
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($parentSecretPointer)

  & pnpm --silent --filter @omnitwin/api assets:mint-grand-hall-r2-temporary-writer -- `
    --out $credentialArtifact `
    --ttl-seconds 3600
  if ($LASTEXITCODE -ne 0) { throw "Temporary Grand Hall R2 writer mint failed." }
  $mintSucceeded = $true
} finally {
  Remove-Item Env:VENVIEWER_GRAND_HALL_R2_ACCOUNT_ID -ErrorAction SilentlyContinue
  Remove-Item Env:VENVIEWER_GRAND_HALL_R2_BUCKET -ErrorAction SilentlyContinue
  Remove-Item Env:VENVIEWER_GRAND_HALL_R2_WRITER_PARENT_ACCESS_KEY_ID -ErrorAction SilentlyContinue
  Remove-Item Env:VENVIEWER_GRAND_HALL_R2_WRITER_PARENT_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
  foreach ($pointer in @($accountIdPointer, $parentAccessKeyIdPointer, $parentSecretPointer)) {
    if ($pointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
  }
  if ($null -ne $secureAccountId) { $secureAccountId.Dispose() }
  if ($null -ne $secureParentAccessKeyId) { $secureParentAccessKeyId.Dispose() }
  if ($null -ne $secureParentSecret) { $secureParentSecret.Dispose() }
  if (!$mintSucceeded) {
    Remove-GrandHallWriterArtifacts -ArtifactPath $credentialArtifact
  }
}
```

A failed mint is indeterminate once its provider request may have been dispatched: the helper above removes and rechecks both possible local DPAPI artifacts, but it cannot prove that no child was issued. Do not retry with that parent. Revoke/delete the dedicated writer parent in Cloudflare, provision a new dedicated writer parent, and restart this section with a fresh run-specific artifact. Never broaden or reuse the read-only serving principal.

The mint block proves the exact branch, reviewed `HEAD`, repository root, and tracked/untracked-clean status before asking for any parent value, then repeats that proof inside the cleanup-protected scope while all three inputs are still `SecureString` values and before any plaintext provider environment variable exists. The Git children therefore receive no R2 parent secret.

Do not open or decrypt the artifact by hand. The block below is independently resumable after restoring the exact existing `$evidenceRoot` and separately reviewed `$reviewedSuccessorSha`: it reconstructs the run-specific artifact path and cleanup helpers, rejects any hidden temporary sibling or substitute artifact, re-proves the exact clean checkout immediately before local code can decrypt the child, and then applies the same lifetime gate. Resolve the native executable rather than the mutable npm PowerShell wrapper, enter only the three non-secret provider UUIDs, and run the one-shot local handoff:

```powershell
if ($PSVersionTable.PSEdition -cne 'Core' -or
    $PSVersionTable.PSVersion -lt [Version]'7.4.0' -or
    -not [Environment]::Is64BitProcess) {
  throw "Grand Hall staging requires 64-bit PowerShell Core 7.4 or newer."
}
function Assert-GrandHallReviewedCleanCheckout {
  param([Parameter(Mandatory = $true)][string]$ReviewedSuccessorSha)

  $forbiddenOverrides = @(
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES'
  )
  if ($ReviewedSuccessorSha -cnotmatch '^[a-f0-9]{40}$' -or
      @($forbiddenOverrides | Where-Object { Test-Path -LiteralPath "Env:$_" }).Count -ne 0) {
    throw "The reviewed checkout selection or Git environment is invalid."
  }
  $gitRootResult = @(& git rev-parse --show-toplevel)
  $gitRootExit = $LASTEXITCODE
  $headResult = @(& git rev-parse --verify 'HEAD^{commit}')
  $headExit = $LASTEXITCODE
  $branchResult = @(& git branch --show-current)
  $branchExit = $LASTEXITCODE
  $statusResult = @(
    & git status --porcelain=v1 --untracked-files=all --ignore-submodules=none
  )
  $statusExit = $LASTEXITCODE
  if ($gitRootExit -ne 0 -or $gitRootResult.Count -ne 1 -or
      $headExit -ne 0 -or $headResult.Count -ne 1 -or
      $branchExit -ne 0 -or $branchResult.Count -ne 1 -or
      $statusExit -ne 0 -or $statusResult.Count -ne 0) {
    throw "The reviewed checkout could not be established as clean and unique."
  }
  $canonicalGitRoot = (Resolve-Path -LiteralPath $gitRootResult[0] -ErrorAction Stop).Path
  $canonicalCurrentDirectory = (Resolve-Path -LiteralPath (Get-Location).Path -ErrorAction Stop).Path
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals(
        $canonicalCurrentDirectory,
        $canonicalGitRoot
      ) -or
      $headResult[0] -cne $ReviewedSuccessorSha -or
      $branchResult[0] -cne 'codex/grand-hall-exact-runtime') {
    throw "The exact reviewed Grand Hall branch and commit are not selected."
  }
}

Assert-GrandHallReviewedCleanCheckout -ReviewedSuccessorSha $reviewedSuccessorSha
function Get-GrandHallWriterArtifacts {
  param([Parameter(Mandatory = $true)][string]$ArtifactPath)

  $artifactCanonical = [IO.Path]::GetFullPath($ArtifactPath)
  $artifactDirectory = Split-Path -Parent $artifactCanonical
  $artifactLeaf = Split-Path -Leaf $artifactCanonical
  $temporaryArtifactName = '^\.{0}\.[0-9a-fA-F]{{8}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{12}}\.tmp$' -f `
    [regex]::Escape($artifactLeaf)
  return @(
    Get-ChildItem -LiteralPath $artifactDirectory -Force -File -ErrorAction Stop |
      Where-Object {
        [StringComparer]::OrdinalIgnoreCase.Equals(
          [IO.Path]::GetFullPath($_.FullName),
          $artifactCanonical
        ) -or $_.Name -match $temporaryArtifactName
      }
  )
}

function Remove-GrandHallWriterArtifacts {
  param([Parameter(Mandatory = $true)][string]$ArtifactPath)

  foreach ($artifact in @(Get-GrandHallWriterArtifacts -ArtifactPath $ArtifactPath)) {
    Remove-Item -LiteralPath $artifact.FullName -Force -ErrorAction Stop
  }
  if (@(Get-GrandHallWriterArtifacts -ArtifactPath $ArtifactPath).Count -ne 0) {
    throw "A Grand Hall DPAPI writer artifact or temporary sibling was not removed."
  }
}

$canonicalEvidenceRoot = (Resolve-Path -LiteralPath $evidenceRoot -ErrorAction Stop).Path
$evidenceRootInfo = Get-Item -LiteralPath $canonicalEvidenceRoot -Force -ErrorAction Stop
$forbiddenGitOverrides = @('GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES')
if (($evidenceRootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
    @($forbiddenGitOverrides | Where-Object { Test-Path -LiteralPath "Env:$_" }).Count -ne 0) {
  throw "The restored evidence root or Git environment is unsafe."
}
$evidenceAncestor = [IO.DirectoryInfo]::new($canonicalEvidenceRoot)
while ($null -ne $evidenceAncestor) {
  if (Test-Path -LiteralPath (Join-Path $evidenceAncestor.FullName '.git')) {
    throw "The restored evidence root is inside a Git worktree."
  }
  $evidenceAncestor = $evidenceAncestor.Parent
}
$containingGitRoot = @(& git -C $canonicalEvidenceRoot rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -eq 0 -or $containingGitRoot.Count -ne 0) {
  throw "The restored evidence root is inside a Git worktree."
}
$evidenceRunId = Split-Path -Leaf $canonicalEvidenceRoot
if ($evidenceRunId -cnotmatch '^run-[0-9]{8}-[0-9]{6}-[0-9a-f]{32}$') {
  throw "The approved Grand Hall evidence run ID is invalid."
}
$credentialArtifact = Join-Path $env:TEMP `
  ("grand-hall-r2-writer-{0}.dpapi" -f $evidenceRunId)
$credentialArtifactCanonical = [IO.Path]::GetFullPath($credentialArtifact)
$writerArtifacts = @(Get-GrandHallWriterArtifacts -ArtifactPath $credentialArtifact)
if ($writerArtifacts.Count -ne 1 -or
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
      [IO.Path]::GetFullPath($writerArtifacts[0].FullName),
      $credentialArtifactCanonical
    ) -or
    ($writerArtifacts[0].Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw "The exact completed run-specific DPAPI artifact is unavailable; do not hand off."
}
$railwayExecutable = Join-Path $env:APPDATA `
  "npm\node_modules\@railway\cli\bin\railway.exe"
if (!(Test-Path -LiteralPath $railwayExecutable -PathType Leaf)) {
  throw "The native Railway CLI executable was not found at the reviewed path."
}
$expectedRailwaySha256 = "22fbe91f45545c89530d630f7eb0d957a42be448d8fe692a83df47d4890059d8"
$actualRailwaySha256 = (Get-FileHash -LiteralPath $railwayExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualRailwaySha256 -cne $expectedRailwaySha256) {
  throw "The native Railway CLI does not match the reviewed SHA-256."
}
$railwayProjectId = "<dedicated-staging-project-uuid>"
$railwayEnvironmentId = "<dedicated-staging-environment-uuid>"
$railwayServiceId = "<dedicated-staging-api-service-uuid>"

Assert-GrandHallReviewedCleanCheckout -ReviewedSuccessorSha $reviewedSuccessorSha
& pnpm --silent --filter @omnitwin/api `
  assets:stage-grand-hall-r2-temporary-writer-in-railway -- `
  --in $credentialArtifact `
  --railway-executable $railwayExecutable `
  --project-id $railwayProjectId `
  --environment-id $railwayEnvironmentId `
  --service-id $railwayServiceId `
  --confirm-target trades-hall-grand-hall-staging
if ($LASTEXITCODE -ne 0) {
  throw "Temporary Grand Hall R2 writer Railway handoff failed. Do not deploy."
}
```

The outer shell first proves the exact reviewed branch, `HEAD`, repository root, and clean tracked/untracked state, checks the native binary's SHA-256 without executing it, and repeats the checkout proof immediately before launching local handoff code. Before it decrypts anything, the handoff verifies that same binary as Railway CLI `5.23.2` in a temporary directory with a fresh allowlisted child environment. It runs `railway status --project <id> --environment <id> --json` and requires the exact project, environment, and sole API service IDs and names. It rechecks the same reviewed CLI identity immediately before DPAPI decryption and again before each variable write. It validates the DPAPI payload's exact schema, 900–3,600 second lifetime, JWT, bucket, action, prefix, and three-key property set in memory. It refuses to begin unless at least 20 minutes remain, then requires at least 15 minutes before and after every Railway write so success leaves time for immediate manual sealing and the bounded deploy. For each allowlisted key it starts the absolute native `railway.exe` directly and sends only that value through the child's standard input to `variable set <KEY> --stdin --skip-deploys --project <id> --environment <id> --service <id>`. Provider output is captured and discarded. No secret enters the command line, clipboard, shell environment, plaintext file, terminal output, chat, or `.env`. The outer local pnpm/Node operator process necessarily receives its local environment, but every Railway and DPAPI child process receives a fresh allowlisted environment and does not inherit `PATH`, `RAILWAY_TOKEN`, `RAILWAY_API_TOKEN`, parent R2 variables, database values, or the intake administrator token.

`variable set --stdin --skip-deploys` creates or updates values without deploying, but it does **not** seal a newly absent Railway key. Immediately after the command succeeds, open the exact staging environment and service in Railway. For each of the following keys, use its three-dot action to **Seal**, then visually require Railway's sealed/masked state before permitting any deploy:

- `RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID`
- `RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY`
- `RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN`

Do not assume that an updated previously sealed key stayed sealed; visually verify all three every time. A fake or empty placeholder is not a valid child credential, so when a key was previously absent there is a brief provider-manager-visible handoff window between the no-deploy CLI write and the immediate Seal action. During that window do not deploy, reveal, copy, screenshot, or share a value, and do not leave the Railway project unattended. Only the sealed-state check closes this window. Do not use `railway variable list --json` or `--kv`; those forms can return raw values.

If the handoff fails after staging only a subset, remain in the no-deploy state. Rerun the exact command with the same artifact and target IDs only if its built-in 20-minute start / 15-minute per-write lifetime gates still admit it; the writes are repeatable. A lifetime refusal is not retry authority. Remove any staged child keys without revealing them, call `Remove-GrandHallWriterArtifacts -ArtifactPath $credentialArtifact`, revoke/delete the dedicated writer parent, and mint from a new dedicated writer parent at the same now-absent deterministic run-specific artifact path. After all three keys are visibly sealed, remove and recheck the local artifact:

```powershell
Remove-GrandHallWriterArtifacts -ArtifactPath $credentialArtifact
```

Only after the three sealed-state checks may you set the exact target ID, exact reviewed successor SHA, and `RUNTIME_PROFILE_INTAKE_ENABLED=true`, then redeploy the same commit. If re-entry is needed after deleting the artifact, first restore and verify the intake-disabled deployment, remove any staged child values without revealing them, revoke/delete the old dedicated writer parent, provision a new dedicated parent, prove that `Get-GrandHallWriterArtifacts -ArtifactPath $credentialArtifact` returns zero files, and mint the new child at that same reconstructed run-specific path. Never try to recover a sealed or expired value or invent a substitute artifact path.

Before rehearsal, rerun the fail-closed health helper and retain a separate immutable attempt-specific intake-enabled deployment receipt. A failed write can leave a hidden `.pending` file; preserve it and retry with a new GUID receipt path. Only the atomically moved `.json` receipt is eligible below:

```powershell
$enabledHealthPath = Join-Path $evidenceRoot (
  "health-02-intake-enabled-{0}.json" -f ([Guid]::NewGuid().ToString('N'))
)
$enabledHealth = Invoke-GrandHallStagingHealthGate `
  -ApiOrigin $recordedStagingApiOrigin `
  -ReviewedGitSha $reviewedSuccessorSha `
  -EvidenceRoot $evidenceRoot `
  -Out $enabledHealthPath
```

Intake-enabled startup validates the Docker-stamped SHA, configured deployed SHA, configured target and the complete five-field intake group. It proves that the read and write configuration fields are separate; the live rehearsal below, not startup alone, proves the selected credentials' effective R2 permissions.

## Target binding

Preflight returns a SHA-256 target-binding digest computed by the selected server. It binds the target ID, API origin, actual image-stamped build Git SHA, intentional intake deployment SHA, database connection identity, R2 account, private bucket, canonical object prefix, frontier receipt, and intake binding secret without disclosing those private values. Every member upload echoes the binding and actual build SHA in API headers, and commit echoes the actual build SHA in the body. The CLI rejects any server build SHA that differs from its locally proven reviewed SHA before it accepts upload or commit evidence.

The single-request rehearsal deliberately does not obtain or echo a client-side target binding. The same API request validates authentication, exact target/origin/build/source headers, the fixed staging target, and the initial/final private-object state internally. Its safe server evidence echoes the non-secret target/build/source identity instead.

If any bound server configuration changes after preflight, the server returns `GRAND_HALL_INTAKE_TARGET_MISMATCH`. Run preflight again by rerunning the exact CLI command. Never copy a binding from another environment or edit a returned upload capability.

## Mandatory staging rehearsal

Production is outside this directive and remains prohibited. Run this rehearsal only against the dedicated staging database and private bucket; do not rehearse in any shared or production resource.

1. Configure staging with target ID `trades-hall-grand-hall-staging`, its own API origin, database, private bucket, read-only principal, and locally signed temporary PutObject-only child credential. Enable intake temporarily.
2. Run `--rehearse-conditional-put` once. The CLI sends exact member 0 as the binary body of one authenticated `PUT /admin/assets/grand-hall-frontier-intake/rehearsal` request. The server refuses unless the selected R2 frontier begins at exactly `0 existing / 11 missing`.
3. Inside that one authenticated request, the server conditionally creates the exact object (`201`, `created: true`), retries the same bytes (`200`, `created: false`), requires a same-length corrupted in-memory copy to fail with `409 GRAND_HALL_STORAGE_CONFLICT`, wipes the corrupt copy, and reopens storage to prove exactly `1 existing / 10 missing`. It never calls commit or registration.
4. Repeatedly run `--admit-next-member`, using a fresh Clerk token and a new evidence path every time. Each invocation preflights the target and admits at most one missing canonical member. Continue until a receipt reports `11 existing / 0 missing` and `allMembersVerified: true`.
5. Run `--apply`. It is commit-only: it refuses unless all eleven remote objects are already verified, performs zero PUTs, rehashes all eleven on the server, and creates one `internal_ready` package.
6. Run `--apply` again with a fresh token and evidence path. It must perform zero PUTs and return `created: false` for the same package ID, revision, and content digest.
7. Capture the safe evidence listed below, set `RUNTIME_PROFILE_INTAKE_ENABLED=false`, remove all five `RUNTIME_PROFILE_INTAKE_*` target/deployment/temporary-write-credential values, redeploy staging, and run the source-free `--verify-disabled` proof.

The unit and route suites are required in addition to this rehearsal; mocks cannot establish that the selected R2-compatible service enforces conditional create.

Any rehearsal failure after its request was dispatched is terminal for the clean-rehearsal attempt on that prefix. Do not rerun the rehearsal, run commit, or delete/overwrite a canonical key merely to recover a `0 / 11` shape. Preserve the reserved evidence path and investigate the isolated staging target. A failed one-member admission is restart-safe through a fresh preflight and new evidence path; a lost successful PUT response will appear as verified-existing on the retry. Production remains out of scope regardless of the result.

## Exact operator commands

Run from the exact clean reviewed repository root in PowerShell after the selected API is deployed, configured, enabled, and explicitly authorized. Replace and independently verify the recorded Railway API origin and the stable Vercel Preview origin placeholders. The no-redirect health receipt—not `/health/version`—proves the API origin that was actually requested. `$evidenceRoot` was created outside Git by the exact-ref push gate; if this is a new shell, point it to that same existing run directory and verify it before continuing. The package command does not load or require `packages/api/.env`.

Clerk session tokens normally have a one-minute lifetime. The CLI therefore obtains a new token immediately before **every authenticated HTTP request**, not merely once per CLI invocation. It opens a one-time listener on `127.0.0.1`, generates an ephemeral RSA keypair, and prints a non-secret browser-console command containing only its loopback URL and public key. That command asks the signed-in staging Clerk session for a fresh token, encrypts it with a one-time AES-GCM key, wraps that key with RSA-OAEP, zeros the browser plaintext/key buffers, and sends only ciphertext to loopback. Browser Network tooling can retain that loopback request body, but it is not the bearer token and the private key exists only in the local CLI process. The bearer necessarily travels in the expected TLS-protected Clerk exchange and the exact staging API `Authorization` header; never open, preserve, export, screenshot, or log Authorization/header/token/payload material. Later QA may inspect only non-secret request URLs, order, status, and timing without opening sensitive headers or payloads. The token is never placed in the Windows clipboard, printed browser command/history text, shell environment, command arguments, file, Railway variable, receipt, or screenshot.

Apply uses two sequential relay commands: one for preflight and a new one for commit. Admission also uses two when preflight finds a missing member and it actually sends that upload; reconciliation after a lost final PUT can find all eleven members already verified and then uses only the preflight relay. Rehearsal and disabled verification need one. Run each printed command only in the signed-in exact staging Preview console. Chrome may show a loopback/Local Network Access permission prompt; allow it only for that exact staging Preview and this one relay. If permission is denied, the browser blocks loopback, the origin check fails, or the relay times out, stop; do not fall back to clipboard or a long-lived token. Close DevTools after the operation.

Set and cross-check the shared non-secret selections once, then define the relay wrapper:

```powershell
if ($PSVersionTable.PSEdition -cne 'Core' -or
    $PSVersionTable.PSVersion -lt [Version]'7.4.0' -or
    -not [Environment]::Is64BitProcess) {
  throw "Grand Hall staging requires 64-bit PowerShell Core 7.4 or newer."
}
$forbiddenGitOverrides = @('GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES')
if (@($forbiddenGitOverrides | Where-Object { Test-Path -LiteralPath "Env:$_" }).Count -ne 0) {
  throw "Remove Git repository-discovery environment overrides before intake."
}
$manifest = "C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_1\lcc2-result\Grand_Hall.lcc2"
$recordedStagingApiOrigin = "<Railway-recorded-clean-staging-api-origin>"
$apiOrigin = $recordedStagingApiOrigin
$stagingWebOrigin = "<exact-stable-vercel-preview-origin>"
$targetId = "trades-hall-grand-hall-staging"
if ($apiOrigin -cne $recordedStagingApiOrigin) {
  throw "The observed API origin does not match the separately recorded Railway origin."
}
$env:RUNTIME_PROFILE_INTAKE_EXPECTED_STAGING_API_ORIGIN = $recordedStagingApiOrigin
$env:RUNTIME_PROFILE_INTAKE_EXPECTED_STAGING_WEB_ORIGIN = $stagingWebOrigin
if (Test-Path Env:RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN) {
  throw "Remove the shell admin token; this run requires encrypted browser relay."
}
if (!(Test-Path -LiteralPath $evidenceRoot -PathType Container)) {
  throw "The approved evidence directory is unavailable."
}
$canonicalEvidenceRoot = (Resolve-Path -LiteralPath $evidenceRoot -ErrorAction Stop).Path
$evidenceRootInfo = Get-Item -LiteralPath $canonicalEvidenceRoot -Force -ErrorAction Stop
if (($evidenceRootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw "The approved evidence directory is not a direct directory."
}
$evidenceAncestor = [IO.DirectoryInfo]::new($canonicalEvidenceRoot)
while ($null -ne $evidenceAncestor) {
  if (Test-Path -LiteralPath (Join-Path $evidenceAncestor.FullName '.git')) {
    throw "The approved evidence directory is inside a Git worktree."
  }
  $evidenceAncestor = $evidenceAncestor.Parent
}
$reviewedGitSha = (& git rev-parse --verify 'HEAD^{commit}').Trim()
if ($LASTEXITCODE -ne 0 -or $reviewedGitSha -notmatch '^[a-f0-9]{40,64}$') {
  throw "The reviewed Git commit ID could not be established from this checkout."
}
$worktreeStatus = @(& git status --porcelain=v1 --untracked-files=all --ignore-submodules=none)
if ($LASTEXITCODE -ne 0 -or
    $worktreeStatus.Count -ne 0 -or
    $reviewedGitSha -cne $reviewedSuccessorSha) {
  throw "The exact reviewed clean Git worktree is not selected, including untracked files."
}
function Assert-GrandHallHealthPropertyNames {
  param(
    [Parameter(Mandatory = $true)][object]$Value,
    [Parameter(Mandatory = $true)][string[]]$Expected,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if ($Value -isnot [pscustomobject]) { throw "$Label is not a JSON object." }
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $wanted = @($Expected | Sort-Object)
  if (@(Compare-Object -ReferenceObject $wanted -DifferenceObject $actual -CaseSensitive).Count -ne 0) {
    throw "$Label contains missing or non-allowlisted fields."
  }
}
function Assert-GrandHallHealthString {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyString()][object]$Value,
    [Parameter(Mandatory = $true)][string]$Expected,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if ($Value -isnot [string] -or $Value -cne $Expected) {
    throw "$Label is not the exact expected JSON string."
  }
}
function Assert-GrandHallHealthInt64 {
  param(
    [Parameter(Mandatory = $true)][object]$Value,
    [Parameter(Mandatory = $true)][long]$Expected,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if ($Value -isnot [long] -or $Value -ne $Expected) {
    throw "$Label is not the exact expected JSON integer."
  }
}
function Read-GrandHallEnabledHealthReceipt {
  param(
    [Parameter(Mandatory = $true)][IO.FileInfo]$Candidate,
    [Parameter(Mandatory = $true)][string]$CanonicalEvidenceRoot
  )
  if (($Candidate.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
      -not [StringComparer]::OrdinalIgnoreCase.Equals(
        (Resolve-Path -LiteralPath $Candidate.DirectoryName -ErrorAction Stop).Path,
        $CanonicalEvidenceRoot
      )) {
    throw "An intake-enabled health receipt is not a direct evidence file."
  }
  $bytes = $null
  $stream = $null
  try {
    $stream = [IO.FileStream]::new(
      $Candidate.FullName,
      [IO.FileMode]::Open,
      [IO.FileAccess]::Read,
      [IO.FileShare]::None
    )
    if ($stream.Length -lt 1 -or $stream.Length -gt 65536) {
      throw "An intake-enabled health receipt is outside its bounded evidence size."
    }
    $bytes = [byte[]]::new([int]$stream.Length)
    $offset = 0
    while ($offset -lt $bytes.Length) {
      $read = $stream.Read($bytes, $offset, $bytes.Length - $offset)
      if ($read -le 0) {
        throw "An intake-enabled health receipt ended before its declared length."
      }
      $offset += $read
    }
    $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
    return $text | ConvertFrom-Json -NoEnumerate -ErrorAction Stop
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
    if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
  }
}

$containingGitRoot = @(& git -C $canonicalEvidenceRoot rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -eq 0 -or $containingGitRoot.Count -ne 0) {
  throw "The approved evidence directory is inside a Git worktree."
}
$enabledHealthItems = @(
  Get-ChildItem -LiteralPath $canonicalEvidenceRoot -File -Force -ErrorAction Stop |
    Where-Object {
      $_.Name -cmatch '^health-02-intake-enabled-[0-9a-f]{32}\.json$'
    }
)
if ($enabledHealthItems.Count -eq 0) {
  throw "No immutable intake-enabled health receipt exists in this evidence run."
}
$validatedEnabledHealth = @()
foreach ($enabledHealthItem in $enabledHealthItems) {
  $candidateHealth = Read-GrandHallEnabledHealthReceipt `
    -Candidate $enabledHealthItem `
    -CanonicalEvidenceRoot $canonicalEvidenceRoot
  Assert-GrandHallHealthPropertyNames $candidateHealth @(
    'schemaVersion', 'recordedAt', 'targetId', 'apiOrigin', 'reviewedGitSha',
    'ready', 'version', 'redirectsFollowed'
  ) 'Intake-enabled health receipt'
  Assert-GrandHallHealthPropertyNames $candidateHealth.ready @(
    'httpStatus', 'status'
  ) 'Intake-enabled readiness receipt'
  Assert-GrandHallHealthPropertyNames $candidateHealth.version @(
    'httpStatus', 'version', 'gitSha', 'builtAt', 'nodeEnv'
  ) 'Intake-enabled version receipt'
  Assert-GrandHallHealthString $candidateHealth.schemaVersion `
    'venviewer.grand-hall-staging-health-evidence.v1' 'Enabled health schema'
  Assert-GrandHallHealthString $candidateHealth.targetId `
    'trades-hall-grand-hall-staging' 'Enabled health target ID'
  Assert-GrandHallHealthString $candidateHealth.apiOrigin `
    $recordedStagingApiOrigin 'Enabled health API origin'
  Assert-GrandHallHealthString $candidateHealth.reviewedGitSha `
    $reviewedGitSha 'Enabled health reviewed SHA'
  Assert-GrandHallHealthInt64 $candidateHealth.ready.httpStatus 200 `
    'Enabled readiness HTTP status'
  Assert-GrandHallHealthString $candidateHealth.ready.status 'ok' `
    'Enabled readiness status'
  Assert-GrandHallHealthInt64 $candidateHealth.version.httpStatus 200 `
    'Enabled version HTTP status'
  Assert-GrandHallHealthString $candidateHealth.version.gitSha $reviewedGitSha `
    'Enabled deployed Git SHA'
  Assert-GrandHallHealthString $candidateHealth.version.nodeEnv 'production' `
    'Enabled Node environment'
  Assert-GrandHallHealthInt64 $candidateHealth.redirectsFollowed 0 `
    'Enabled redirect count'
  $candidateRecordedAt = [DateTimeOffset]::MinValue
  if ($candidateHealth.recordedAt -isnot [string] -or
      $candidateHealth.recordedAt -cnotmatch 'Z$' -or
      -not [DateTimeOffset]::TryParse(
        $candidateHealth.recordedAt,
        [ref]$candidateRecordedAt
      ) -or
      $candidateHealth.version.version -isnot [string] -or
      [String]::IsNullOrWhiteSpace($candidateHealth.version.version) -or
      $candidateHealth.version.builtAt -isnot [string] -or
      [String]::IsNullOrWhiteSpace($candidateHealth.version.builtAt) -or
      $candidateRecordedAt -gt [DateTimeOffset]::UtcNow.AddMinutes(1)) {
    throw "An intake-enabled health receipt has invalid metadata."
  }
  $validatedEnabledHealth += [pscustomobject]@{
    receipt = $candidateHealth
    recordedAt = $candidateRecordedAt.ToUniversalTime()
    fileName = $enabledHealthItem.Name
    path = $enabledHealthItem.FullName
  }
}
$selectedEnabledHealth = $validatedEnabledHealth |
  Sort-Object -Property recordedAt, fileName |
  Select-Object -Last 1
if ($selectedEnabledHealth.recordedAt -lt [DateTimeOffset]::UtcNow.AddMinutes(-15)) {
  throw "The latest exact intake-enabled health receipt is stale; create a new attempt receipt."
}
$enabledHealthEvidence = $selectedEnabledHealth.receipt
$enabledHealthRecordedAt = $selectedEnabledHealth.recordedAt
$enabledHealthPath = $selectedEnabledHealth.path

function Invoke-WithFreshIntakeAdminToken {
  param([Parameter(Mandatory = $true)][scriptblock]$Operation)
  $env:RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN_RELAY = "browser-loopback"
  try {
    return & $Operation
  } finally {
    Remove-Item Env:RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN_RELAY -ErrorAction Stop
  }
}
```

On the fresh dedicated staging target, run the one-request, non-committing rehearsal. The CLI exclusively reserves `--out` before it reads the token, source, or network and refuses an existing destination:

```powershell
$rehearsalPath = Join-Path $evidenceRoot "01-conditional-put-rehearsal.json"
$rehearsalJson = Invoke-WithFreshIntakeAdminToken {
  $output = & pnpm --silent --filter @omnitwin/api run assets:intake-grand-hall-big-model-frontier -- `
    --rehearse-conditional-put `
    --manifest $manifest `
    --api-origin $apiOrigin `
    --target-id $targetId `
    --reviewed-git-sha $reviewedGitSha `
    --out $rehearsalPath
  if ($LASTEXITCODE -ne 0) { throw "Grand Hall conditional-PUT rehearsal failed." }
  $output
}
$rehearsal = $rehearsalJson | ConvertFrom-Json -NoEnumerate -ErrorAction Stop
if ($rehearsal.mode -ne 'conditional_put_rehearsal' -or
    $rehearsal.reviewedGitSha -cne $reviewedGitSha -or
    $rehearsal.serverEvidence.targetId -cne $targetId -or
    $rehearsal.serverEvidence.apiOrigin -cne $apiOrigin -or
    $rehearsal.serverEvidence.deployedGitSha -cne $reviewedGitSha -or
    $rehearsal.serverEvidence.initialPreflight.existingMemberCount -ne 0 -or
    $rehearsal.serverEvidence.initialPreflight.uploadRequiredCount -ne 11 -or
    $rehearsal.serverEvidence.conditionalPut.created.statusCode -ne 201 -or
    $rehearsal.serverEvidence.conditionalPut.created.created -ne $true -or
    $rehearsal.serverEvidence.conditionalPut.exactRetry.statusCode -ne 200 -or
    $rehearsal.serverEvidence.conditionalPut.exactRetry.created -ne $false -or
    $rehearsal.serverEvidence.conditionalPut.corruptCopy.statusCode -ne 409 -or
    $rehearsal.serverEvidence.conditionalPut.corruptCopy.code -ne 'GRAND_HALL_STORAGE_CONFLICT' -or
    $rehearsal.serverEvidence.conditionalPut.corruptCopy.storedBytesUnchanged -ne $true -or
    $rehearsal.serverEvidence.finalPreflight.existingMemberCount -ne 1 -or
    $rehearsal.serverEvidence.finalPreflight.uploadRequiredCount -ne 10 -or
    $rehearsal.serverEvidence.commitAttempted -ne $false -or
    $rehearsal.serverEvidence.registrationAttempted -ne $false) {
  throw "Grand Hall rehearsal returned an unexpected receipt."
}
```

Now admit the remaining members one at a time. For every CLI prompt, run only the newly printed one-time browser-console command; never reuse a command, URL, key, or nonce from an earlier prompt. The loop creates a unique external evidence path for each invocation and stops only at `11 / 0`:

```powershell
$admissionOrdinal = 0
$allMembersVerified = $false
while (!$allMembersVerified) {
  $admissionOrdinal += 1
  $admissionPath = Join-Path $evidenceRoot `
    ("02-admission-{0:D2}-{1}.json" -f $admissionOrdinal, [Guid]::NewGuid().ToString("N"))
  $admissionJson = Invoke-WithFreshIntakeAdminToken {
    $output = & pnpm --silent --filter @omnitwin/api run assets:intake-grand-hall-big-model-frontier -- `
      --admit-next-member `
      --manifest $manifest `
      --api-origin $apiOrigin `
      --target-id $targetId `
      --reviewed-git-sha $reviewedGitSha `
      --out $admissionPath
    if ($LASTEXITCODE -ne 0) { throw "Grand Hall one-member admission failed." }
    $output
  }
  $admission = $admissionJson | ConvertFrom-Json -NoEnumerate -ErrorAction Stop
  if ($admission.mode -ne 'admit_next_member' -or
      $admission.committed -ne $false -or
      $admission.registered -ne $false -or
      $admission.preflight.existingMemberCount -ne $admission.progress.existingMemberCountBefore -or
      $admission.preflight.uploadRequiredCount -ne $admission.progress.uploadRequiredCountBefore -or
      ($admission.progress.existingMemberCountAfter +
        $admission.progress.uploadRequiredCountAfter) -ne 11) {
    throw "Grand Hall admission returned inconsistent progress evidence."
  }
  if ($null -eq $admission.admittedMember) {
    if ($admission.progress.uploadRequiredCountBefore -ne 0 -or
        $admission.progress.allMembersVerified -ne $true) {
      throw "Grand Hall admission omitted a still-missing member."
    }
  } elseif ($admission.admittedMember.httpStatus -ne 201 -or
            $admission.admittedMember.created -ne $true -or
            $admission.progress.existingMemberCountAfter -ne
              ($admission.progress.existingMemberCountBefore + 1) -or
            $admission.progress.uploadRequiredCountAfter -ne
              ($admission.progress.uploadRequiredCountBefore - 1)) {
    throw "Grand Hall admission did not prove one immutable create."
  }
  $allMembersVerified = $admission.progress.allMembersVerified
}
```

Run the first commit-only apply. On the uninterrupted fresh path it must perform zero PUTs and create exactly revision 1:

```powershell
$firstPath = Join-Path $evidenceRoot "03-first-apply.json"
$firstJson = Invoke-WithFreshIntakeAdminToken {
  $output = & pnpm --silent --filter @omnitwin/api run assets:intake-grand-hall-big-model-frontier -- `
    --apply `
    --manifest $manifest `
    --api-origin $apiOrigin `
    --target-id $targetId `
    --reviewed-git-sha $reviewedGitSha `
    --out $firstPath
  if ($LASTEXITCODE -ne 0) { throw "First Grand Hall exact-frontier apply failed." }
  $output
}
$first = $firstJson | ConvertFrom-Json -NoEnumerate -ErrorAction Stop
if ($first.mode -ne 'apply' -or
    $first.preflight.existingMemberCount -ne 11 -or
    $first.preflight.uploadRequiredCount -ne 0 -or
    $first.puts.Count -ne 0 -or
    $first.package.created -ne $true -or
    $first.package.revision -ne 1 -or
    $first.package.memberCount -ne 11 -or
    $first.package.totalBytes -ne 106479738 -or
    $first.package.gaussianCount -ne 6019684) {
  throw "The first apply did not prove the exact fresh staging registration."
}
$baseline = $first
```

After **any** apply command emits final class `reconcile_apply`, preserve that attempt's evidence path exactly as-is and do not count the uncertain response as either the baseline or the required idempotency proof. Run the repeatable reconciliation block below with a fresh token. It generates a new GUID-named evidence path every time, and the CLI still reserves that path exclusively before using it. If the reconciliation command also emits `reconcile_apply`, preserve its path and run this same block again; never reuse a path.

When no earlier successful apply response exists, a successful reconciliation establishes the baseline and may return `created: true` when the uncertain commit did not land or `created: false` when it did. When `$baseline` already exists, a successful reconciliation must instead return the same package with `created: false`. In either case, every identity/count field must be exact, and a successful reconciliation resets the requirement for one **further** matching `created: false` apply before shutdown:

```powershell
$hadBaseline = $null -ne (Get-Variable -Name baseline -ErrorAction SilentlyContinue)
$priorBaseline = if ($hadBaseline) { $baseline } else { $null }
$recoveryPath = Join-Path $evidenceRoot (
  "apply-reconcile-{0}.json" -f [Guid]::NewGuid().ToString('N')
)
$recoveryJson = Invoke-WithFreshIntakeAdminToken {
  $output = & pnpm --silent --filter @omnitwin/api run assets:intake-grand-hall-big-model-frontier -- `
    --apply `
    --manifest $manifest `
    --api-origin $apiOrigin `
    --target-id $targetId `
    --reviewed-git-sha $reviewedGitSha `
    --out $recoveryPath
  if ($LASTEXITCODE -ne 0) { throw "Grand Hall recovery apply failed." }
  $output
}
$recovery = $recoveryJson | ConvertFrom-Json -NoEnumerate -ErrorAction Stop
if ($recovery.mode -ne 'apply' -or
    $recovery.preflight.existingMemberCount -ne 11 -or
    $recovery.preflight.uploadRequiredCount -ne 0 -or
    $recovery.puts.Count -ne 0 -or
    -not ($recovery.package.created -is [bool]) -or
    $recovery.package.revision -ne 1 -or
    $recovery.package.memberCount -ne 11 -or
    $recovery.package.totalBytes -ne 106479738 -or
    $recovery.package.gaussianCount -ne 6019684) {
  throw "The recovery apply did not establish an exact package baseline."
}
if ($hadBaseline -and (
    $recovery.package.created -ne $false -or
    $recovery.package.runtimePackageId -ne $priorBaseline.package.runtimePackageId -or
    $recovery.package.revision -ne $priorBaseline.package.revision -or
    $recovery.package.contentDigest -ne $priorBaseline.package.contentDigest)) {
  throw "The recovery apply did not exactly reconcile the previously proven package."
}
$baseline = $recovery
```

Run one identical commit-only apply after either the uninterrupted first apply or the recovery baseline, with a fresh browser token. It must perform zero PUTs, return `created: false`, and reuse that same immutable package:

```powershell
$secondPath = Join-Path $evidenceRoot (
  "apply-idempotency-{0}.json" -f [Guid]::NewGuid().ToString('N')
)
$secondJson = Invoke-WithFreshIntakeAdminToken {
  $output = & pnpm --silent --filter @omnitwin/api run assets:intake-grand-hall-big-model-frontier -- `
    --apply `
    --manifest $manifest `
    --api-origin $apiOrigin `
    --target-id $targetId `
    --reviewed-git-sha $reviewedGitSha `
    --out $secondPath
  if ($LASTEXITCODE -ne 0) { throw "Repeated Grand Hall exact-frontier apply failed." }
  $output
}
$second = $secondJson | ConvertFrom-Json -NoEnumerate -ErrorAction Stop
if ($second.mode -ne 'apply' -or
    $second.preflight.existingMemberCount -ne 11 -or
    $second.preflight.uploadRequiredCount -ne 0 -or
    $second.puts.Count -ne 0 -or
    $second.package.created -ne $false -or
    $second.package.runtimePackageId -ne $baseline.package.runtimePackageId -or
    $second.package.revision -ne $baseline.package.revision -or
    $second.package.contentDigest -ne $baseline.package.contentDigest -or
    $second.package.memberCount -ne 11 -or
    $second.package.totalBytes -ne 106479738 -or
    $second.package.gaussianCount -ne 6019684) {
  throw "The repeated intake did not prove exact immutable package reuse."
}
```

Exactly one operation flag and `--out` are required. Every mode is code-pinned to `trades-hall-grand-hall-staging` and requires `--api-origin` to equal the independently set local `RUNTIME_PROFILE_INTAKE_EXPECTED_STAGING_API_ORIGIN`. `--rehearse-conditional-put` makes the one binary rehearsal request and never commits. `--admit-next-member` admits at most one missing member and never commits. `--apply` performs no upload and commits only a fully verified eleven-member frontier. `--verify-disabled` accepts no manifest, reads no source, and makes one authenticated preflight that accepts only HTTP 503 `GRAND_HALL_INTAKE_DISABLED`. No supported flag changes the canonical frontier, prefix, metadata, or commit confirmation.

Outside a dispatched rehearsal, an HTTP 401/403, including an expired-token response, has final failure class `stop`. A dispatched rehearsal keeps its stricter `terminal_rehearsal` class even when the response is 401/403. Both classes require stopping; do not rerun either case under this runbook without a separate reviewed reauthorization and policy/code change. Preserve its reserved evidence file and never delete or overwrite a canonical R2 key. If any commit request may have succeeded but its response was lost and the emitted final class is `reconcile_apply`, use only the repeatable reconciliation block above. Repeat it with a fresh GUID path after every further `reconcile_apply`. Once reconciliation returns an exact response, require one further matching `created: false` apply; if that proof response is also uncertain, reconcile again and reset the one-further-apply requirement. Never weaken the metadata comparisons. Every CLI HTTP request has a ten-minute absolute deadline covering connection and response-body consumption.

## What the command does

### 1. Local guard and evidence reservation

Before it reads the admin token, source, or network, the CLI:

- requires the exact staging target and an exact match between `--api-origin` and the independently supplied local expected-origin variable;
- resolves the executing intake script's real path, proves that it lies inside its own discovered Git repository, then proves that the supplied reviewed commit exists, exactly equals that repository's `HEAD`, and that its tracked and untracked worktree state is clean; and
- resolves the evidence parent, rejects a destination inside any Git worktree (including another checkout), and exclusively creates the actual destination as an empty private file so a later request can never overwrite existing evidence. Git boundary subprocesses receive only process-launch essentials and never inherit the admin token or storage credentials.

Every source-bearing mode first streams and hashes every declared splat container while inspecting the supplied `Grand_Hall.lcc2`, excludes `env.sog`, and validates the pinned hierarchy/frontier receipt. It does this before acquiring a token or making a network request. Rehearsal then separately buffers and hashes only exact member 0 for its request. One-member admission acquires a fresh token immediately before preflight, then, only when preflight identifies a missing member, separately reads/buffers that one member and acquires another fresh token immediately before its upload. Commit-only apply performs the full streaming inspection but creates no member upload buffer; it acquires fresh tokens only immediately before preflight and commit. Disabled verification accepts no manifest, performs no source inspection or read, and acquires its token only immediately before its single preflight request.

### 2. One-request conditional-PUT rehearsal

`PUT /admin/assets/grand-hall-frontier-intake/rehearsal` accepts exact canonical member-0 bytes and one platform-admin bearer token. Under one exclusive server admission it performs the fresh-state check, exact create, exact reuse, same-length corruption rejection, corrupt-buffer wipe, and final `1 / 10` read. It returns no upload capability or private storage identity and never invokes registration.

### 3. Same-server preflight and one-member admission

`POST /admin/assets/grand-hall-frontier-intake/preflight` requires platform-admin authentication and exact target/source/deployed-build identity. The API reads every canonical private object in full. It returns its configured deployed Git SHA and only safe API-relative upload capabilities for missing members. It returns no presigned R2 URL and no private storage identity.

In admission mode, the CLI sends at most one `application/octet-stream` body to `PUT /admin/assets/grand-hall-frontier-intake/members/:memberIndex`. The API validates authentication, index, declared size, canonical source receipts, target ID, origin, and target binding before storage. It hashes the body, performs a fixed-key conditional PUT with the put-only principal, then performs a full read-back through the read-only principal. The CLI never batches multiple source members into one short Clerk-token window.

### 4. Verified commit-only registration

`POST /admin/assets/grand-hall-frontier-intake/commit` requires the literal confirmation `register_exact_internal_ready_grand_hall_frontier`. The server reopens and rehashes all eleven objects before any database write. One advisory-locked transaction then:

- creates or exactly reuses 11 AssetVersion rows in receipt order;
- keeps every `captureSessionId` null unless independent provenance has been validated in a separate evidence process;
- creates or exactly reuses one content-digest-identified `internal_ready` RuntimePackage;
- keeps semantic mesh, collision, and point-cloud references null; and
- writes one platform-admin audit entry when it creates the package.

A member conflict, package conflict, lock failure, or database failure rolls back the transaction. Previously uploaded exact objects remain immutable and can be reused by a safe retry.

## Retry and failure policy

On failure, treat the CLI's final standard-error line as the decision record. It is one LF-terminated JSON object with only `class`, `code`, optional validated HTTP `status`, and optional bounded `retryAfterSeconds`. Never infer permission to retry from earlier progress text. Use the `class` exactly as follows:

| Failure `class` | Baby-step response |
|---|---|
| `safe_to_retry` | No mutating request was entered, or a read-only/token step failed transiently. Preserve the old evidence path, wait `retryAfterSeconds` when present, obtain a fresh relay token, choose a new evidence path, and rerun the same exact command. |
| `reconcile_admission` | A member PUT was entered and its outcome or evidence may be incomplete. Preserve the old path; never delete or overwrite the canonical key. Obtain a fresh token and new path, then rerun `--admit-next-member`; its fresh preflight rehashes any object that actually landed. |
| `reconcile_apply` | Commit was entered and its outcome or evidence may be incomplete. Preserve the old path and use the repeatable reconciliation block above with a fresh token and GUID path. Repeat that block after every further `reconcile_apply`. Once it returns an exact response, require one further matching `created: false` apply before shutdown; another uncertain proof response resets this reconciliation-plus-one-further-apply requirement. |
| `terminal_rehearsal` | Stop this clean-rehearsal attempt on the prefix. Preserve the evidence path and target state. Do not rerun rehearsal, delete an object, or proceed to apply. |
| `stop` | Stop. Resolve the allowlisted `code` against the rows below without weakening any target, auth, source, storage, or integrity check. |

`retryAfterSeconds` can appear only on `safe_to_retry`, `reconcile_admission`, or `reconcile_apply` and is limited to 0–3,600 seconds. Unknown exceptions become `{"class":"stop","code":"UNEXPECTED_FAILURE"}`. Arbitrary server messages, response bodies, URLs, tokens, paths, and headers are never copied into the failure line.

| Result | Operator action |
|---|---|
| Admission network/HTTP failure | Follow the final JSON `class`, not the transport symptom. Retry only `safe_to_retry` or `reconcile_admission` exactly as described above; `stop` (including an invalid or oversized response) is not retry authority. A permitted retry's fresh preflight rehashes existing objects. |
| Rehearsal request fails after dispatch | Stop the clean-rehearsal attempt. Preserve its reserved evidence path and inspect the isolated target; do not delete an object or rerun rehearsal to manufacture `0 / 11`. |
| Apply response is lost after dispatch | Preserve the attempt and use the repeatable reconciliation block above with a fresh token and GUID path. When no successful baseline exists, recovery may return `created: true` if the lost commit did not land or `created: false` if it did; with an existing baseline it must return the same package with `created: false`. Repeat reconciliation after every further lost response, and after a successful reconciliation require one further identical `created: false` apply before shutdown. |
| HTTP 401 or 403 | Stop. Confirm that the bearer token is current and its user is an existing platform administrator. Do not weaken route authorization. |
| `GRAND_HALL_INTAKE_DISABLED` | Stop. Confirm the selected server has the complete intake configuration and is inside an approved enabled window. |
| `GRAND_HALL_INTAKE_TARGET_MISMATCH` | Stop. Reconfirm the target ID/origin, deployed Git SHA, and target-side configuration, then rerun preflight. Do not transplant a binding. |
| `GRAND_HALL_FRONTIER_MISMATCH` or local receipt failure | Stop. Reconfirm the exact supplied manifest. Do not rename, resize, re-encode, or substitute an export. |
| Storage or AssetVersion conflict | Stop and preserve evidence. Never delete, overwrite, or register around the canonical key. Use separately authorized incident/restoration tooling only after the target and existing bytes are understood. |
| Commit reports `created: false` | This is the expected idempotent result only when the package ID, revision, content digest, 11 members, 106,479,738 bytes, and 6,019,684 Gaussians all match. |

Never use `POST /admin/assets/register-version`, `POST /admin/assets/runtime-package-revisions`, direct SQL, the legacy runtime-assets path, or a public bucket to work around an intake refusal. Those paths are deliberately blocked for the exact Grand Hall target and namespace.

## Safe evidence to retain

Record the following without secrets or private storage identifiers:

- date/time, operator identity, locally proven reviewed Git SHA, server deployed Git SHA, target ID, and clean API origin;
- the exact-ref push receipt, exact-SHA GitHub Actions run association, the base-disabled and final-disabled no-redirect health receipts, every immutable intake-enabled health attempt, and the exact selected enabled attempt;
- manifest SHA-256 and frontier receipt SHA-256;
- rehearsal initial/final counts plus exact-create, exact-retry, and corrupt-copy results;
- each one-member admission's target-binding digest, ordered preflight status, admitted member result, and before/after progress;
- commit preflight counts and zero-PUT assertion;
- returned RuntimePackage ID, revision, content digest, `created` value, member count, total bytes, and Gaussian count;
- every immutable disabled-state attempt, the exact selected disabled-state receipt, plus the dated deployment change that disabled intake and removed its target/write credentials; and
- later browser/WebGL QA receipt plus its retained canvas-only PNG bytes only after explicit permission.

With `pnpm --silent`, standard output is exactly one JSON evidence receipt; progress is written to standard error. `--out` is mandatory. The CLI exclusively reserves the actual external destination before token/source/network access, writes the same JSON-plus-line-feed bytes only after a successful operation, flushes them to storage, and refuses every existing destination. A failed operation/finalization can leave an empty or incomplete reserved file; preserve it and use a new path on retry.

The rehearsal receipt nests safe server evidence: authenticated operator, deployed build, target/origin/source identity, initial/final counts, exact-create/retry/corruption results, and explicit no-commit/no-registration assertions. Each admission receipt records its preflight/binding, at most one PUT result, progress, and explicit no-commit/no-registration assertions. Apply receipts record a fully verified preflight, an empty PUT list, and the package ID, revision, content digest, `created` value, member count, byte total, and Gaussian total. The disabled-state receipt contains only timestamp, locally proven reviewed SHA, target/origin, HTTP 503, exact disabled code, and `disabled: true`. Receipts contain no token, local source path, private key, upload headers, storage account, bucket, object key, or database identity. Preserve the JSON bytes unchanged; do not substitute screenshots for a receipt.

The receipts cannot record a future configuration change. Retain the separately dated deployment change that disables intake and removes its five intake-only target/deployment/temporary-write fields, then link that record to the rehearsal, every admission, first apply, repeated apply, and disabled-state receipts.

Do not record the bearer token, `DATABASE_URL`, R2 credentials, account ID, bucket name, private object keys, response authorization headers, or a local absolute source path in shared logs/screenshots.

## Close the intake window

After successful registration:

1. Set `RUNTIME_PROFILE_INTAKE_ENABLED=false`.
2. Remove `RUNTIME_PROFILE_INTAKE_TARGET_ID`, `RUNTIME_PROFILE_INTAKE_DEPLOYED_GIT_SHA`, `RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID`, `RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY`, and `RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN` together from the deployment.
3. Keep `VENVIEWER_DEPLOYMENT_TARGET_ID`, `VENVIEWER_STAGING_REVIEWED_GIT_SHA`, `VENVIEWER_STAGING_EXPECTED_DATABASE_HOST`, `VENVIEWER_STAGING_EXPECTED_WEB_ORIGIN`, all five Railway identity values, the isolated Clerk values, `PUBLIC_API_ORIGIN`, `FRONTEND_URL` / `CORS_ORIGINS`, and the read-only `RUNTIME_PROFILE_R2_*` connection unchanged. These persistent checks reject configuration that conflicts with the recorded staging names, hosts, origins, branch, role/database, and bucket; the retained provider-console resource-ID evidence remains necessary because the application cannot prove provider account/project identity from credentials alone.
4. Redeploy the exact same commit. Startup now fails if the flag is false while any of the five intake-only fields remains configured. Run the fail-closed health helper again and retain a distinct final-disabled deployment receipt; together with successful startup, this proves the temporary intake group is absent rather than merely ignored:

   ```powershell
   $finalHealthPath = Join-Path $evidenceRoot "health-03-intake-disabled-final.json"
   $finalHealth = Invoke-GrandHallStagingHealthGate `
     -ApiOrigin $recordedStagingApiOrigin `
     -ReviewedGitSha $reviewedSuccessorSha `
     -EvidenceRoot $evidenceRoot `
     -Out $finalHealthPath
   ```

5. Use one newly encrypted browser-relay token and create the shutdown receipt with the source-free verification mode. Every permitted pre-dispatch retry creates a new GUID path; preserve an incomplete earlier attempt, and never overwrite it:

   ```powershell
   $disabledPath = Join-Path $evidenceRoot (
     "06-disabled-intake-{0}.json" -f ([Guid]::NewGuid().ToString('N'))
   )
   $disabledJson = Invoke-WithFreshIntakeAdminToken {
     $output = & pnpm --silent --filter @omnitwin/api run assets:intake-grand-hall-big-model-frontier -- `
       --verify-disabled `
       --api-origin $apiOrigin `
       --target-id $targetId `
       --reviewed-git-sha $reviewedGitSha `
       --out $disabledPath
     if ($LASTEXITCODE -ne 0) { throw "Grand Hall intake shutdown verification failed." }
     $output
   }
   $disabled = $disabledJson |
     ConvertFrom-Json -NoEnumerate -ErrorAction Stop
   $actualDisabledFields = @($disabled.PSObject.Properties.Name | Sort-Object)
   $expectedDisabledFields = @(
     'schemaVersion', 'mode', 'recordedAt', 'reviewedGitSha', 'targetId',
     'apiOrigin', 'httpStatus', 'errorCode', 'disabled'
   ) | Sort-Object
   $finalHealthAt = [DateTimeOffset]::MinValue
   $disabledAt = [DateTimeOffset]::MinValue
   if ($disabled -isnot [pscustomobject] -or
       @(Compare-Object -ReferenceObject $expectedDisabledFields -DifferenceObject $actualDisabledFields -CaseSensitive).Count -ne 0 -or
       $disabled.schemaVersion -isnot [string] -or
       $disabled.schemaVersion -cne 'venviewer.grand-hall-frontier-intake-disabled-evidence.v1' -or
       $disabled.mode -isnot [string] -or
       $disabled.mode -cne 'verify_disabled' -or
       $disabled.recordedAt -isnot [string] -or
       $disabled.recordedAt -cnotmatch 'Z$' -or
       -not [DateTimeOffset]::TryParse($disabled.recordedAt, [ref]$disabledAt) -or
       $finalHealth.recordedAt -isnot [string] -or
       $finalHealth.recordedAt -cnotmatch 'Z$' -or
       -not [DateTimeOffset]::TryParse($finalHealth.recordedAt, [ref]$finalHealthAt) -or
       $disabled.reviewedGitSha -isnot [string] -or
       $disabled.reviewedGitSha -cne $reviewedGitSha -or
       $disabled.targetId -isnot [string] -or
       $disabled.targetId -cne $targetId -or
       $disabled.apiOrigin -isnot [string] -or
       $disabled.apiOrigin -cne $apiOrigin -or
       $disabled.httpStatus -isnot [long] -or
       $disabled.httpStatus -ne 503 -or
       $disabled.errorCode -isnot [string] -or
       $disabled.errorCode -cne 'GRAND_HALL_INTAKE_DISABLED' -or
       $disabled.disabled -isnot [bool] -or
       $disabled.disabled -ne $true -or
       $disabledAt -lt $finalHealthAt -or
       $disabledAt -gt [DateTimeOffset]::UtcNow.AddMinutes(1)) {
     throw "The staging API did not prove that Grand Hall intake is closed."
   }
   ```

6. Remove the local non-secret binding/relay variables after the shutdown receipt and prove no shell token exists:

   ```powershell
   if (Test-Path Env:RUNTIME_PROFILE_INTAKE_EXPECTED_STAGING_API_ORIGIN) {
     Remove-Item Env:RUNTIME_PROFILE_INTAKE_EXPECTED_STAGING_API_ORIGIN -ErrorAction Stop
   }
   if (Test-Path Env:RUNTIME_PROFILE_INTAKE_EXPECTED_STAGING_WEB_ORIGIN) {
     Remove-Item Env:RUNTIME_PROFILE_INTAKE_EXPECTED_STAGING_WEB_ORIGIN -ErrorAction Stop
   }
   if (Test-Path Env:RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN_RELAY) {
     Remove-Item Env:RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN_RELAY -ErrorAction Stop
   }
   if (Test-Path Env:RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN) {
     throw "A shell admin token exists unexpectedly; stop and clear the operator shell."
   }
   ```

7. Recheck that neither the named `.dpapi` writer artifact nor a hidden `.<artifact-basename>.<uuid>.tmp` sibling from this run remains, including hidden files:

   ```powershell
   $evidenceRunId = Split-Path -Leaf $evidenceRoot
   if ($evidenceRunId -cnotmatch '^run-[0-9]{8}-[0-9]{6}-[0-9a-f]{32}$') {
     throw "The approved Grand Hall evidence run ID is invalid."
   }
   $credentialArtifact = Join-Path $env:TEMP `
     ("grand-hall-r2-writer-{0}.dpapi" -f $evidenceRunId)
   $credentialArtifactCanonical = [IO.Path]::GetFullPath($credentialArtifact)
   $credentialDirectory = Split-Path -Parent $credentialArtifactCanonical
   $credentialLeaf = Split-Path -Leaf $credentialArtifactCanonical
   $temporaryArtifactName = '^\.{0}\.[0-9a-fA-F]{{8}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{12}}\.tmp$' -f `
     [regex]::Escape($credentialLeaf)
   $writerArtifactsRemaining = @(
     Get-ChildItem -LiteralPath $credentialDirectory -Force -File -ErrorAction Stop |
       Where-Object {
         [StringComparer]::OrdinalIgnoreCase.Equals(
           [IO.Path]::GetFullPath($_.FullName),
           $credentialArtifactCanonical
         ) -or $_.Name -match $temporaryArtifactName
       }
   )
   if ($writerArtifactsRemaining.Count -ne 0) {
     throw "A Grand Hall DPAPI writer artifact or temporary sibling still exists."
   }
   ```

   In Cloudflare, revoke/delete the dedicated Object Read & Write parent token so its temporary children can no longer be used. Do not revoke the separate Object Read only serving principal.
8. Keep the package `internal_ready`. Publishing, public evidence claims, metric planning, and any package promotion require their own reviewed authority.

## Remaining visual gate

Registration is not visual acceptance. Take the immutable `runtimePackageId` from the successful apply receipt and open the authenticated staging web origin at:

```text
/dev/trades-hall-visual?venue=trades-hall&room=grand-hall&runtimePackageId=<apply-receipt-runtime-package-id>
```

Do not omit the selector or substitute a latest-package URL for exact-package QA. Confirm in the browser network record that `/assets/runtime-packages/latest` is not requested, the displayed package ID exactly matches the apply receipt, metadata is admitted before member zero is requested, and only the authenticated private-preview member endpoints transfer the eleven SOG objects.

With explicit browser permission, perform authenticated source-only WebGL QA at the deterministic current inspection camera and through restrained inspection within the captured room envelope. Confirm that the renderer shows no invented doors, windows, central dark floor, procedural surfaces, generated fill, planning geometry, neighbouring rooms, or exterior facade. Record console errors, failed requests, loaded member/Gaussian counts, package ID, and canvas-only PNG hashes without recording cookies, authorization headers, or tokens.

Before opening the browser, require that these two run-specific destinations do not exist. The run directory was exclusively created for this deployment outside Git, so a pre-existing file means the evidence run is contaminated and must stop:

```powershell
if ($PSVersionTable.PSEdition -cne 'Core' -or
    $PSVersionTable.PSVersion -lt [Version]'7.4.0' -or
    -not [Environment]::Is64BitProcess) {
  throw "Grand Hall staging requires 64-bit PowerShell Core 7.4 or newer."
}
$forbiddenGitOverrides = @('GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES')
if (@($forbiddenGitOverrides | Where-Object { Test-Path -LiteralPath "Env:$_" }).Count -ne 0) {
  throw "Remove Git repository-discovery environment overrides before browser QA."
}
$canonicalEvidenceRoot = (Resolve-Path -LiteralPath $evidenceRoot -ErrorAction Stop).Path
$evidenceRootInfo = Get-Item -LiteralPath $canonicalEvidenceRoot -Force -ErrorAction Stop
if (($evidenceRootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw "The Grand Hall QA evidence root is not a direct directory."
}
$evidenceAncestor = [IO.DirectoryInfo]::new($canonicalEvidenceRoot)
while ($null -ne $evidenceAncestor) {
  if (Test-Path -LiteralPath (Join-Path $evidenceAncestor.FullName '.git')) {
    throw "The Grand Hall QA evidence root is inside a Git worktree."
  }
  $evidenceAncestor = $evidenceAncestor.Parent
}
$containingGitRoot = @(& git -C $canonicalEvidenceRoot rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -eq 0 -or $containingGitRoot.Count -ne 0) {
  throw "The Grand Hall QA evidence root is inside a Git worktree."
}
$qaObservationPath = Join-Path $canonicalEvidenceRoot "07-browser-tool-observation.json"
$qaCanvasPath = Join-Path $canonicalEvidenceRoot "08-grand-hall-canvas.png"
if ((Test-Path -LiteralPath $qaObservationPath) -or
    (Test-Path -LiteralPath $qaCanvasPath)) {
  throw "The Grand Hall browser QA evidence destinations are not fresh."
}
```

Use browser automation to create both files directly from the live signed-in staging inspection; do not hand-author or prefill either. Begin the metadata request within 15 minutes of the final intake-disabled health receipt; stop if that freshness window is missed. The observation JSON must contain only the validator's allowlisted fields below. It records selected non-secret metadata, API-relative request paths without query strings, HTTP status/timing, client-verified byte identities, count/error observations, and the bounded visual inspection. It must not contain headers, cookies, Clerk payloads, request/response bodies, request URLs beyond the two clean origins, console messages, or a full browser export. Capture the PNG from the WebGL canvas only—not the page, DevTools, browser chrome, or another image—and write it directly to the fixed path above.

After browser automation closes, run this validator. It discovers the successful exact idempotency-apply receipt from the unique external run directory, validates it, derives the immutable package identity from it, and then binds every browser observation to that package and the final intake-disabled deployment. It does not accept a manually entered package ID or a syntactically plausible list of arbitrary member paths:

```powershell
if ($PSVersionTable.PSEdition -cne 'Core' -or
    $PSVersionTable.PSVersion -lt [Version]'7.4.0' -or
    -not [Environment]::Is64BitProcess) {
  throw "Grand Hall staging requires 64-bit PowerShell Core 7.4 or newer."
}
function Assert-ExactPropertyNames {
  param(
    [Parameter(Mandatory = $true)][object]$Value,
    [Parameter(Mandatory = $true)][string[]]$Expected,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $wanted = @($Expected | Sort-Object)
  if (@(Compare-Object -ReferenceObject $wanted -DifferenceObject $actual -CaseSensitive).Count -ne 0) {
    throw "$Label contains missing or non-allowlisted fields."
  }
}

function ConvertTo-GrandHallQaTimestamp {
  param(
    [Parameter(Mandatory = $true)][object]$Value,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $parsed = [DateTimeOffset]::MinValue
  if ($Value -isnot [string]) {
    throw "$Label is not a JSON string timestamp."
  }
  $text = [string]$Value
  if ($text -cnotmatch 'Z$' -or -not [DateTimeOffset]::TryParse($text, [ref]$parsed)) {
    throw "$Label is not an explicit UTC timestamp."
  }
  return $parsed.ToUniversalTime()
}

function Assert-GrandHallJsonString {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyString()][object]$Value,
    [Parameter(Mandatory = $true)][string]$Label,
    [string]$Expected
  )
  if ($Value -isnot [string] -or
      ($PSBoundParameters.ContainsKey('Expected') -and $Value -cne $Expected)) {
    throw "$Label is not the exact expected JSON string."
  }
}

function Assert-GrandHallJsonInt64 {
  param(
    [Parameter(Mandatory = $true)][object]$Value,
    [Parameter(Mandatory = $true)][long]$Expected,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if ($Value -isnot [long] -or $Value -ne $Expected) {
    throw "$Label is not the exact expected JSON integer."
  }
}

function Assert-GrandHallJsonBoolean {
  param(
    [Parameter(Mandatory = $true)][object]$Value,
    [Parameter(Mandatory = $true)][bool]$Expected,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if ($Value -isnot [bool] -or $Value -ne $Expected) {
    throw "$Label is not the exact expected JSON boolean."
  }
}

function Read-GrandHallBoundedDirectFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][int]$MinimumBytes,
    [Parameter(Mandatory = $true)][int]$MaximumBytes,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if (-not [IO.Path]::IsPathFullyQualified($Path)) {
    throw "$Label path is not absolute."
  }
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "$Label is a reparse point."
  }
  $stream = [IO.FileStream]::new(
    $item.FullName,
    [IO.FileMode]::Open,
    [IO.FileAccess]::Read,
    [IO.FileShare]::None
  )
  try {
    if ($stream.Length -lt $MinimumBytes -or $stream.Length -gt $MaximumBytes) {
      throw "$Label is outside its bounded evidence size."
    }
    $bytes = [byte[]]::new([int]$stream.Length)
    $offset = 0
    while ($offset -lt $bytes.Length) {
      $read = $stream.Read($bytes, $offset, $bytes.Length - $offset)
      if ($read -le 0) { throw "$Label ended before its declared length." }
      $offset += $read
    }
    return ,$bytes
  } finally {
    $stream.Dispose()
  }
}

function Get-GrandHallSha256Hex {
  param([Parameter(Mandatory = $true)][byte[]]$Bytes)
  $hasher = [Security.Cryptography.SHA256]::Create()
  try {
    return [Convert]::ToHexString($hasher.ComputeHash($Bytes)).ToLowerInvariant()
  } finally {
    $hasher.Dispose()
  }
}

$expectedMembers = @(
  [pscustomobject]@{ fileName = '0_0_0_1_0_1.sog'; sizeBytes = 9980174; gaussianCount = 556880; sha256 = '97efa65f9aaddbd69780664c6668817125c3153469918d5f291b348ee0b6d7e1' },
  [pscustomobject]@{ fileName = '0_1_0_1_0_0.sog'; sizeBytes = 9500250; gaussianCount = 528394; sha256 = '2b0c0cce30cb31a34b253d5985985b3d547debe8bca1a97401eb72ab3ad3bdbf' },
  [pscustomobject]@{ fileName = '0_2_0_0_1_1.sog'; sizeBytes = 10575631; gaussianCount = 608233; sha256 = 'b354ba55785e73a42aa4d108ac0c1fb93c333cbf5bd881e6c75149c2cecccd3e' },
  [pscustomobject]@{ fileName = '0_3_0_0_0_0.sog'; sizeBytes = 10376269; gaussianCount = 604745; sha256 = 'e590fb5d7488071c63f10df33b31e451f3c0348c2209f1bf594015c28a1fff24' },
  [pscustomobject]@{ fileName = '0_3_0_1_0_1.sog'; sizeBytes = 10207866; gaussianCount = 585011; sha256 = '84b2ff813e0746d8fc8dfcc9d044dba15fef5f62ca137794c30989c04ba82a9d' },
  [pscustomobject]@{ fileName = '0_4_0_1_0_0.sog'; sizeBytes = 9199768; gaussianCount = 514640; sha256 = '5863e052c6f99316914df9168829543b82fb35db0118b5e02d30e4d326a79d03' },
  [pscustomobject]@{ fileName = '0_5_0_0_0_1.sog'; sizeBytes = 8975642; gaussianCount = 504860; sha256 = '65fd21b69a1def23cb4bd5b756da7ac03e4451a476a80a61c47b853a0366a8f1' },
  [pscustomobject]@{ fileName = '0_5_0_1_0_1.sog'; sizeBytes = 9708760; gaussianCount = 551142; sha256 = 'd3272fee659e486190af1d2ac9427c39e5536bc85b90b5570df4b6e9e9124631' },
  [pscustomobject]@{ fileName = '0_6_0_0_0_1.sog'; sizeBytes = 10231737; gaussianCount = 597926; sha256 = '18e23290236bb3f220df2b59f6f255a421151c0f1da7ed633bd00d06eddf0171' },
  [pscustomobject]@{ fileName = '0_7_0_0_0_0.sog'; sizeBytes = 9417293; gaussianCount = 524982; sha256 = '7c4cca3644294c2955cfe9e41f387e70ce79e1aedcca132392c0493325ce4386' },
  [pscustomobject]@{ fileName = '0_7_0_0_0_1.sog'; sizeBytes = 8306348; gaussianCount = 442871; sha256 = '5e4409b07084ce7089e77a17d1eec0d2c4691f7a9d9e52f55ef752529d356ea9' }
)
$expectedManifestSha256 = '927a92699de222e99d2684ca2567a35ab1e523a036461e6e01236b7b77b7f659'
$expectedFrontierReceiptSha256 = 'sha256:8e7514e75aa19345dda1955f2cee3f9369339c553c2711c084cd04be4c9c1352'
$uuidPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$sha256Pattern = '^[a-f0-9]{64}$'
$canonicalEvidenceRoot = (Resolve-Path -LiteralPath $evidenceRoot -ErrorAction Stop).Path
$evidenceRootInfo = Get-Item -LiteralPath $canonicalEvidenceRoot -Force -ErrorAction Stop
$forbiddenGitOverrides = @('GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES')
if (@($forbiddenGitOverrides | Where-Object { Test-Path -LiteralPath "Env:$_" }).Count -ne 0) {
  throw "Remove Git repository-discovery environment overrides before browser QA validation."
}
$evidenceAncestor = [IO.DirectoryInfo]::new($canonicalEvidenceRoot)
while ($null -ne $evidenceAncestor) {
  if (Test-Path -LiteralPath (Join-Path $evidenceAncestor.FullName '.git')) {
    throw "The Grand Hall QA evidence root is inside a Git worktree."
  }
  $evidenceAncestor = $evidenceAncestor.Parent
}
$containingGitRoot = @(& git -C $canonicalEvidenceRoot rev-parse --show-toplevel 2>$null)
if (($evidenceRootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
    $LASTEXITCODE -eq 0 -or
    $containingGitRoot.Count -ne 0) {
  throw "The Grand Hall QA evidence root is not a direct external directory."
}

$idempotencyFiles = @(
  Get-ChildItem -LiteralPath $canonicalEvidenceRoot -File -ErrorAction Stop |
    Where-Object { $_.Name -cmatch '^apply-idempotency-[0-9a-f]{32}\.json$' }
)
$validIdempotencyEvidence = @()
foreach ($candidateFile in $idempotencyFiles) {
  $candidateBytes = $null
  try {
    $candidateBytes = Read-GrandHallBoundedDirectFile `
      -Path $candidateFile.FullName `
      -MinimumBytes 1 `
      -MaximumBytes 1048576 `
      -Label 'Idempotency apply evidence'
    $candidateSha256 = Get-GrandHallSha256Hex $candidateBytes
    $candidateText = [Text.UTF8Encoding]::new($false, $true).GetString($candidateBytes)
    $candidate = $candidateText | ConvertFrom-Json -NoEnumerate -ErrorAction Stop
    Assert-ExactPropertyNames $candidate @(
      'schemaVersion', 'mode', 'recordedAt', 'reviewedGitSha', 'deployedGitSha',
      'operatorUserId', 'targetId', 'apiOrigin', 'targetBindingSha256',
      'manifestSha256', 'frontierReceiptSha256', 'preflight', 'puts', 'package'
    ) 'Idempotency apply receipt'
    Assert-ExactPropertyNames $candidate.preflight @(
      'existingMemberCount', 'uploadRequiredCount', 'members'
    ) 'Idempotency apply preflight'
    Assert-ExactPropertyNames $candidate.package @(
      'runtimePackageId', 'revision', 'contentDigest', 'created', 'memberCount',
      'totalBytes', 'gaussianCount'
    ) 'Idempotency apply package'
    Assert-GrandHallJsonString $candidate.schemaVersion 'Apply schema' `
      'venviewer.grand-hall-frontier-intake-evidence.v1'
    Assert-GrandHallJsonString $candidate.mode 'Apply mode' 'apply'
    Assert-GrandHallJsonString $candidate.reviewedGitSha 'Apply reviewed SHA' $reviewedSuccessorSha
    Assert-GrandHallJsonString $candidate.deployedGitSha 'Apply deployed SHA' $reviewedSuccessorSha
    Assert-GrandHallJsonString $candidate.operatorUserId 'Apply operator user ID'
    Assert-GrandHallJsonString $candidate.targetId 'Apply target ID' 'trades-hall-grand-hall-staging'
    Assert-GrandHallJsonString $candidate.apiOrigin 'Apply API origin' $recordedStagingApiOrigin
    Assert-GrandHallJsonString $candidate.targetBindingSha256 'Apply target binding'
    Assert-GrandHallJsonString $candidate.manifestSha256 'Apply manifest SHA' $expectedManifestSha256
    Assert-GrandHallJsonString $candidate.frontierReceiptSha256 `
      'Apply frontier receipt SHA' `
      $expectedFrontierReceiptSha256
    Assert-GrandHallJsonString $candidate.package.runtimePackageId 'Apply package ID'
    Assert-GrandHallJsonString $candidate.package.contentDigest 'Apply content digest'
    Assert-GrandHallJsonInt64 $candidate.preflight.existingMemberCount 11 'Apply existing member count'
    Assert-GrandHallJsonInt64 $candidate.preflight.uploadRequiredCount 0 'Apply missing member count'
    Assert-GrandHallJsonBoolean $candidate.package.created $false 'Apply created flag'
    Assert-GrandHallJsonInt64 $candidate.package.revision 1 'Apply package revision'
    Assert-GrandHallJsonInt64 $candidate.package.memberCount 11 'Apply package member count'
    Assert-GrandHallJsonInt64 $candidate.package.totalBytes 106479738 'Apply package byte count'
    Assert-GrandHallJsonInt64 $candidate.package.gaussianCount 6019684 'Apply Gaussian count'
    if ($candidate.puts -isnot [object[]] -or
        $candidate.preflight.members -isnot [object[]]) {
      throw 'Apply puts or members is not a JSON array.'
    }
    for ($memberIndex = 0; $memberIndex -lt $candidate.preflight.members.Count; $memberIndex += 1) {
      $candidateMember = $candidate.preflight.members[$memberIndex]
      Assert-ExactPropertyNames $candidateMember @(
        'memberIndex', 'fileName', 'status'
      ) "Apply preflight member $memberIndex"
      Assert-GrandHallJsonInt64 $candidateMember.memberIndex $memberIndex `
        "Apply preflight member $memberIndex index"
      Assert-GrandHallJsonString $candidateMember.fileName `
        "Apply preflight member $memberIndex name"
      Assert-GrandHallJsonString $candidateMember.status `
        "Apply preflight member $memberIndex status" `
        'verified_existing'
    }
    $candidateRecordedAt = ConvertTo-GrandHallQaTimestamp `
      $candidate.recordedAt `
      'Idempotency apply time'
  } catch {
    continue
  } finally {
    if ($null -ne $candidateBytes) {
      [Array]::Clear($candidateBytes, 0, $candidateBytes.Length)
    }
  }
  $candidateMembersAreExact = @($candidate.preflight.members).Count -eq $expectedMembers.Count
  if ($candidateMembersAreExact) {
    for ($index = 0; $index -lt $expectedMembers.Count; $index += 1) {
      $actualMember = $candidate.preflight.members[$index]
      if ($actualMember.memberIndex -ne $index -or
          $actualMember.fileName -cne $expectedMembers[$index].fileName -or
          $actualMember.status -cne 'verified_existing') {
        $candidateMembersAreExact = $false
        break
      }
    }
  }
  if ($candidate.schemaVersion -cne 'venviewer.grand-hall-frontier-intake-evidence.v1' -or
      $candidate.mode -cne 'apply' -or
      $candidate.reviewedGitSha -cne $reviewedSuccessorSha -or
      $candidate.deployedGitSha -cne $reviewedSuccessorSha -or
      $candidate.targetId -cne 'trades-hall-grand-hall-staging' -or
      $candidate.apiOrigin -cne $recordedStagingApiOrigin -or
      $candidate.manifestSha256 -cne $expectedManifestSha256 -or
      $candidate.frontierReceiptSha256 -cne $expectedFrontierReceiptSha256 -or
      $candidate.preflight.existingMemberCount -ne 11 -or
      $candidate.preflight.uploadRequiredCount -ne 0 -or
      !$candidateMembersAreExact -or
      @($candidate.puts).Count -ne 0 -or
      $candidate.package.created -ne $false -or
      $candidate.package.runtimePackageId -cnotmatch $uuidPattern -or
      $candidate.package.revision -ne 1 -or
      $candidate.package.contentDigest -cnotmatch $sha256Pattern -or
      $candidate.package.memberCount -ne 11 -or
      $candidate.package.totalBytes -ne 106479738 -or
      $candidate.package.gaussianCount -ne 6019684) {
    continue
  }
  $validIdempotencyEvidence += [pscustomobject]@{
    receipt = $candidate
    recordedAt = $candidateRecordedAt
    sha256 = $candidateSha256
  }
}
if ($validIdempotencyEvidence.Count -eq 0) {
  throw "No exact successful idempotency-apply receipt exists in this evidence run."
}
$packageIdentities = @(
  $validIdempotencyEvidence |
    ForEach-Object {
      '{0}|{1}|{2}' -f $_.receipt.package.runtimePackageId,
        $_.receipt.package.revision,
        $_.receipt.package.contentDigest
    } |
    Sort-Object -Unique
)
if ($packageIdentities.Count -ne 1) {
  throw "The successful idempotency receipts disagree on immutable package identity."
}
$selectedApplyEvidence = $validIdempotencyEvidence |
  Sort-Object -Property recordedAt, sha256 |
  Select-Object -Last 1
$applyReceipt = $selectedApplyEvidence.receipt
$runtimePackageId = $applyReceipt.package.runtimePackageId

$finalHealthPath = Join-Path $canonicalEvidenceRoot "health-03-intake-disabled-final.json"
$finalHealthBytes = $null
try {
  $finalHealthBytes = Read-GrandHallBoundedDirectFile `
    -Path $finalHealthPath `
    -MinimumBytes 1 `
    -MaximumBytes 65536 `
    -Label 'Final intake-disabled health evidence'
  $finalHealthSha256 = Get-GrandHallSha256Hex $finalHealthBytes
  $finalHealthText = [Text.UTF8Encoding]::new($false, $true).GetString($finalHealthBytes)
  $finalHealth = $finalHealthText | ConvertFrom-Json -NoEnumerate -ErrorAction Stop
} finally {
  if ($null -ne $finalHealthBytes) {
    [Array]::Clear($finalHealthBytes, 0, $finalHealthBytes.Length)
  }
}
Assert-ExactPropertyNames $finalHealth @(
  'schemaVersion', 'recordedAt', 'targetId', 'apiOrigin', 'reviewedGitSha',
  'ready', 'version', 'redirectsFollowed'
) 'Final intake-disabled health receipt'
Assert-ExactPropertyNames $finalHealth.ready @('httpStatus', 'status') `
  'Final readiness evidence'
Assert-ExactPropertyNames $finalHealth.version @(
  'httpStatus', 'version', 'gitSha', 'builtAt', 'nodeEnv'
) 'Final version evidence'
Assert-GrandHallJsonString $finalHealth.schemaVersion 'Final health schema' `
  'venviewer.grand-hall-staging-health-evidence.v1'
Assert-GrandHallJsonString $finalHealth.targetId 'Final health target ID' `
  'trades-hall-grand-hall-staging'
Assert-GrandHallJsonString $finalHealth.apiOrigin 'Final health API origin' `
  $recordedStagingApiOrigin
Assert-GrandHallJsonString $finalHealth.reviewedGitSha 'Final health reviewed SHA' `
  $reviewedSuccessorSha
Assert-GrandHallJsonInt64 $finalHealth.ready.httpStatus 200 'Final readiness HTTP status'
Assert-GrandHallJsonString $finalHealth.ready.status 'Final readiness status' 'ok'
Assert-GrandHallJsonInt64 $finalHealth.version.httpStatus 200 'Final version HTTP status'
Assert-GrandHallJsonString $finalHealth.version.version 'Final application version'
Assert-GrandHallJsonString $finalHealth.version.gitSha 'Final deployed SHA' $reviewedSuccessorSha
Assert-GrandHallJsonString $finalHealth.version.builtAt 'Final build timestamp'
Assert-GrandHallJsonString $finalHealth.version.nodeEnv 'Final Node environment' 'production'
Assert-GrandHallJsonInt64 $finalHealth.redirectsFollowed 0 'Final redirect count'
if ($finalHealth.schemaVersion -cne 'venviewer.grand-hall-staging-health-evidence.v1' -or
    $finalHealth.targetId -cne 'trades-hall-grand-hall-staging' -or
    $finalHealth.apiOrigin -cne $recordedStagingApiOrigin -or
    $finalHealth.reviewedGitSha -cne $reviewedSuccessorSha -or
    $finalHealth.ready.httpStatus -ne 200 -or
    $finalHealth.ready.status -cne 'ok' -or
    $finalHealth.version.httpStatus -ne 200 -or
    $finalHealth.version.gitSha -cne $reviewedSuccessorSha -or
    $finalHealth.version.nodeEnv -cne 'production' -or
    $finalHealth.redirectsFollowed -ne 0) {
  throw "The final intake-disabled deployment receipt is unavailable or mismatched."
}
$finalHealthAt = ConvertTo-GrandHallQaTimestamp $finalHealth.recordedAt 'Final health time'
if ($finalHealthAt -lt $selectedApplyEvidence.recordedAt) {
  throw "The final intake-disabled health receipt predates the selected apply proof."
}

$disabledIntakeFiles = @(
  Get-ChildItem -LiteralPath $canonicalEvidenceRoot -File -Force -ErrorAction Stop |
    Where-Object {
      $_.Name -cmatch '^06-disabled-intake-[0-9a-f]{32}\.json$'
    }
)
$parsedDisabledIntakeEvidence = @()
foreach ($candidateFile in $disabledIntakeFiles) {
  if (($candidateFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "A disabled-intake evidence candidate is a reparse point."
  }
  if ($candidateFile.Length -eq 0) {
    continue
  }
  $candidateBytes = $null
  try {
    $candidateBytes = Read-GrandHallBoundedDirectFile `
      -Path $candidateFile.FullName `
      -MinimumBytes 1 `
      -MaximumBytes 65536 `
      -Label 'Disabled-intake evidence'
    $candidateSha256 = Get-GrandHallSha256Hex $candidateBytes
    try {
      $candidateText = [Text.UTF8Encoding]::new($false, $true).GetString(
        $candidateBytes
      )
      $candidateDisabledIntake = $candidateText |
        ConvertFrom-Json -NoEnumerate -ErrorAction Stop
    } catch {
      continue
    }
  } finally {
    if ($null -ne $candidateBytes) {
      [Array]::Clear($candidateBytes, 0, $candidateBytes.Length)
    }
  }
  Assert-ExactPropertyNames $candidateDisabledIntake @(
    'schemaVersion', 'mode', 'recordedAt', 'reviewedGitSha', 'targetId',
    'apiOrigin', 'httpStatus', 'errorCode', 'disabled'
  ) 'Disabled-intake receipt'
  Assert-GrandHallJsonString $candidateDisabledIntake.schemaVersion `
    'Disabled-intake schema'
  Assert-GrandHallJsonString $candidateDisabledIntake.mode 'Disabled-intake mode'
  Assert-GrandHallJsonString $candidateDisabledIntake.reviewedGitSha `
    'Disabled-intake reviewed SHA'
  Assert-GrandHallJsonString $candidateDisabledIntake.targetId `
    'Disabled-intake target ID'
  Assert-GrandHallJsonString $candidateDisabledIntake.apiOrigin `
    'Disabled-intake API origin'
  Assert-GrandHallJsonString $candidateDisabledIntake.errorCode `
    'Disabled-intake error code'
  if ($candidateDisabledIntake.httpStatus -isnot [long] -or
      $candidateDisabledIntake.disabled -isnot [bool]) {
    throw "A disabled-intake receipt contains coercible scalar fields."
  }
  $candidateDisabledAt = ConvertTo-GrandHallQaTimestamp `
    $candidateDisabledIntake.recordedAt `
    'Disabled-intake time'
  $parsedDisabledIntakeEvidence += [pscustomobject]@{
    receipt = $candidateDisabledIntake
    recordedAt = $candidateDisabledAt
    sha256 = $candidateSha256
    fileName = $candidateFile.Name
  }
}
if ($parsedDisabledIntakeEvidence.Count -eq 0) {
  throw "No complete disabled-intake proof exists in this evidence run."
}
foreach ($candidateEvidence in $parsedDisabledIntakeEvidence) {
  $candidate = $candidateEvidence.receipt
  if ($candidate.schemaVersion -cne 'venviewer.grand-hall-frontier-intake-disabled-evidence.v1' -or
      $candidate.mode -cne 'verify_disabled' -or
      $candidate.reviewedGitSha -cne $reviewedSuccessorSha -or
      $candidate.targetId -cne 'trades-hall-grand-hall-staging' -or
      $candidate.apiOrigin -cne $recordedStagingApiOrigin -or
      $candidate.httpStatus -ne 503 -or
      $candidate.errorCode -cne 'GRAND_HALL_INTAKE_DISABLED' -or
      $candidate.disabled -ne $true) {
    throw "The disabled-intake receipts disagree on target, provenance, or state."
  }
}
$eligibleDisabledIntakeEvidence = @(
  $parsedDisabledIntakeEvidence |
    Where-Object {
      $_.recordedAt -ge $finalHealthAt -and
      $_.recordedAt -le [DateTimeOffset]::UtcNow.AddMinutes(1)
    }
)
if ($eligibleDisabledIntakeEvidence.Count -eq 0) {
  throw "No exact disabled-intake proof follows the final health receipt."
}
$selectedDisabledIntakeEvidence = $eligibleDisabledIntakeEvidence |
  Sort-Object -Property recordedAt, sha256 |
  Select-Object -Last 1
$disabledIntake = $selectedDisabledIntakeEvidence.receipt
$disabledIntakeAt = $selectedDisabledIntakeEvidence.recordedAt
$disabledIntakeSha256 = $selectedDisabledIntakeEvidence.sha256
$disabledIntakeFileName = $selectedDisabledIntakeEvidence.fileName

$qaObservationPath = Join-Path $canonicalEvidenceRoot "07-browser-tool-observation.json"
$qaCanvasPath = Join-Path $canonicalEvidenceRoot "08-grand-hall-canvas.png"
$qaEvidencePath = Join-Path $canonicalEvidenceRoot "09-authenticated-webgl-qa.json"
foreach ($requiredPath in @($qaObservationPath, $qaCanvasPath)) {
  $requiredItem = Get-Item -LiteralPath $requiredPath -Force -ErrorAction Stop
  if (-not [IO.Path]::IsPathFullyQualified($requiredPath) -or
      -not [StringComparer]::OrdinalIgnoreCase.Equals(
        (Resolve-Path -LiteralPath (Split-Path -Parent $requiredPath) -ErrorAction Stop).Path,
        $canonicalEvidenceRoot
      ) -or
      !(Test-Path -LiteralPath $requiredPath -PathType Leaf) -or
      ($requiredItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "A browser QA input is not a file in the unique external evidence run."
  }
}
if (Test-Path -LiteralPath $qaEvidencePath) {
  throw "The authenticated WebGL QA receipt destination already exists."
}

$qaObservationBytes = $null
try {
  $qaObservationBytes = Read-GrandHallBoundedDirectFile `
    -Path $qaObservationPath `
    -MinimumBytes 1 `
    -MaximumBytes 262144 `
    -Label 'Browser QA observation'
  $qaObservationSha256 = Get-GrandHallSha256Hex $qaObservationBytes
  $qaObservationText = [Text.UTF8Encoding]::new($false, $true).GetString($qaObservationBytes)
  $qaObservation = $qaObservationText | ConvertFrom-Json -NoEnumerate -ErrorAction Stop
} finally {
  if ($null -ne $qaObservationBytes) {
    [Array]::Clear($qaObservationBytes, 0, $qaObservationBytes.Length)
  }
}
Assert-ExactPropertyNames $qaObservation @(
  'schemaVersion', 'recordedAt', 'targetId', 'apiOrigin', 'webOrigin',
  'reviewedGitSha', 'runtimePackageId', 'revision', 'contentDigest', 'pagePath',
  'metadataRequest', 'metadata', 'memberRequests', 'latestPackageRequestCount',
  'unexpectedRuntimeAssetRequestCount', 'loadedMemberCount',
  'decodedGaussianCount', 'failedRequestCount', 'consoleErrorCount',
  'forbiddenVisualsObserved', 'canvas'
) 'Browser observation'
Assert-ExactPropertyNames $qaObservation.metadataRequest @(
  'method', 'path', 'httpStatus', 'startedAt', 'completedAt'
) 'Metadata request'
Assert-ExactPropertyNames $qaObservation.metadata @(
  'scope', 'runtimePackageId', 'venueSlug', 'roomSlug', 'revision', 'identityKind',
  'contentDigest', 'evidenceStatus', 'runtimeStatus', 'reviewedProfileId',
  'decisionId', 'decisionRef', 'hierarchySha256', 'format', 'level',
  'lodSelectionPolicy', 'expectedGaussianCount', 'primaryVisualAssetVersionId',
  'semanticMeshAssetVersionId', 'collisionAssetVersionId',
  'pointCloudAssetVersionId', 'visualAssets'
) 'Preview metadata'
Assert-ExactPropertyNames $qaObservation.forbiddenVisualsObserved @(
  'inventedDoors', 'inventedWindows', 'centralDarkFloor', 'proceduralSurfaces',
  'generatedFill', 'planningGeometry', 'neighbouringRooms', 'exteriorFacade'
) 'Forbidden visual observation'
Assert-ExactPropertyNames $qaObservation.canvas @(
  'fileName', 'captureKind', 'capturedAt'
) 'Canvas observation'

$expectedPagePath = "/dev/trades-hall-visual?venue=trades-hall&room=grand-hall&runtimePackageId=$runtimePackageId"
$expectedMetadataPath = "/admin/assets/runtime-package-previews/$runtimePackageId"
Assert-GrandHallJsonString $qaObservation.schemaVersion 'Browser observation schema' `
  'venviewer.grand-hall-browser-tool-observation.v1'
Assert-GrandHallJsonString $qaObservation.targetId 'Browser observation target ID' `
  'trades-hall-grand-hall-staging'
Assert-GrandHallJsonString $qaObservation.apiOrigin 'Browser observation API origin' `
  $recordedStagingApiOrigin
Assert-GrandHallJsonString $qaObservation.webOrigin 'Browser observation web origin' `
  $stagingWebOrigin
Assert-GrandHallJsonString $qaObservation.reviewedGitSha 'Browser observation reviewed SHA' `
  $reviewedSuccessorSha
Assert-GrandHallJsonString $qaObservation.runtimePackageId 'Browser observation package ID' `
  $runtimePackageId
Assert-GrandHallJsonInt64 $qaObservation.revision $applyReceipt.package.revision `
  'Browser observation package revision'
Assert-GrandHallJsonString $qaObservation.contentDigest 'Browser observation content digest' `
  $applyReceipt.package.contentDigest
Assert-GrandHallJsonString $qaObservation.pagePath 'Browser observation page path' `
  $expectedPagePath
Assert-GrandHallJsonString $qaObservation.metadataRequest.method 'Metadata request method' 'GET'
Assert-GrandHallJsonString $qaObservation.metadataRequest.path 'Metadata request path' `
  $expectedMetadataPath
Assert-GrandHallJsonInt64 $qaObservation.metadataRequest.httpStatus 200 `
  'Metadata request HTTP status'
Assert-GrandHallJsonInt64 $qaObservation.latestPackageRequestCount 0 `
  'Latest-package request count'
Assert-GrandHallJsonInt64 $qaObservation.unexpectedRuntimeAssetRequestCount 0 `
  'Unexpected runtime-asset request count'
Assert-GrandHallJsonInt64 $qaObservation.loadedMemberCount 11 'Loaded member count'
Assert-GrandHallJsonInt64 $qaObservation.decodedGaussianCount 6019684 `
  'Decoded Gaussian count'
Assert-GrandHallJsonInt64 $qaObservation.failedRequestCount 0 'Failed request count'
Assert-GrandHallJsonInt64 $qaObservation.consoleErrorCount 0 'Console error count'
Assert-GrandHallJsonString $qaObservation.canvas.fileName 'Canvas file name' `
  '08-grand-hall-canvas.png'
Assert-GrandHallJsonString $qaObservation.canvas.captureKind 'Canvas capture kind' `
  'webgl_canvas_only'

$metadata = $qaObservation.metadata
Assert-GrandHallJsonString $metadata.scope 'Preview scope' `
  'exact_private_runtime_package_preview'
Assert-GrandHallJsonString $metadata.runtimePackageId 'Preview package ID' $runtimePackageId
Assert-GrandHallJsonString $metadata.venueSlug 'Preview venue slug' 'trades-hall'
Assert-GrandHallJsonString $metadata.roomSlug 'Preview room slug' 'grand-hall'
Assert-GrandHallJsonInt64 $metadata.revision $applyReceipt.package.revision 'Preview revision'
Assert-GrandHallJsonString $metadata.identityKind 'Preview identity kind' 'content_sha256'
Assert-GrandHallJsonString $metadata.contentDigest 'Preview content digest' `
  $applyReceipt.package.contentDigest
Assert-GrandHallJsonString $metadata.evidenceStatus 'Preview evidence status' 'unverified'
Assert-GrandHallJsonString $metadata.runtimeStatus 'Preview runtime status' 'internal_ready'
Assert-GrandHallJsonString $metadata.decisionId 'Preview decision ID' `
  'grand-hall-big-model-sog-fine-v1'
Assert-GrandHallJsonString $metadata.decisionRef 'Preview decision reference' `
  $expectedFrontierReceiptSha256
Assert-GrandHallJsonString $metadata.hierarchySha256 'Preview hierarchy SHA' `
  $expectedManifestSha256
Assert-GrandHallJsonString $metadata.format 'Preview format' 'sog'
Assert-GrandHallJsonString $metadata.level 'Preview level' 'fine'
Assert-GrandHallJsonString $metadata.lodSelectionPolicy 'Preview LOD policy' `
  'authoritative-leaf-nodes-exclude-environment-v1'
Assert-GrandHallJsonInt64 $metadata.expectedGaussianCount 6019684 `
  'Preview expected Gaussian count'
Assert-GrandHallJsonString $metadata.primaryVisualAssetVersionId `
  'Preview primary visual asset ID'
if ($metadata.visualAssets -isnot [object[]] -or
    $qaObservation.memberRequests -isnot [object[]]) {
  throw 'Preview visual assets or browser member requests is not a JSON array.'
}
foreach ($property in $qaObservation.forbiddenVisualsObserved.PSObject.Properties) {
  Assert-GrandHallJsonBoolean $property.Value $false `
    "Forbidden visual observation $($property.Name)"
}
$metadataStartedAt = ConvertTo-GrandHallQaTimestamp $qaObservation.metadataRequest.startedAt 'Metadata request start'
$metadataCompletedAt = ConvertTo-GrandHallQaTimestamp $qaObservation.metadataRequest.completedAt 'Metadata request completion'
$observationRecordedAt = ConvertTo-GrandHallQaTimestamp $qaObservation.recordedAt 'Browser observation time'
$canvasCapturedAt = ConvertTo-GrandHallQaTimestamp $qaObservation.canvas.capturedAt 'Canvas capture time'
if ($qaObservation.schemaVersion -cne 'venviewer.grand-hall-browser-tool-observation.v1' -or
    $qaObservation.targetId -cne 'trades-hall-grand-hall-staging' -or
    $qaObservation.apiOrigin -cne $recordedStagingApiOrigin -or
    $qaObservation.webOrigin -cne $stagingWebOrigin -or
    $qaObservation.reviewedGitSha -cne $reviewedSuccessorSha -or
    $qaObservation.runtimePackageId -cne $runtimePackageId -or
    $qaObservation.revision -ne $applyReceipt.package.revision -or
    $qaObservation.contentDigest -cne $applyReceipt.package.contentDigest -or
    $qaObservation.pagePath -cne $expectedPagePath -or
    $qaObservation.metadataRequest.method -cne 'GET' -or
    $qaObservation.metadataRequest.path -cne $expectedMetadataPath -or
    $qaObservation.metadataRequest.httpStatus -ne 200 -or
    $metadataStartedAt -lt $disabledIntakeAt -or
    $metadataStartedAt -gt $finalHealthAt.AddMinutes(15) -or
    $metadataCompletedAt -lt $metadataStartedAt -or
    $observationRecordedAt -lt $metadataCompletedAt -or
    $observationRecordedAt -gt [DateTimeOffset]::UtcNow.AddMinutes(1)) {
  throw "The browser observation is not bound to the exact final staging package request."
}

if ($metadata.scope -cne 'exact_private_runtime_package_preview' -or
    $metadata.runtimePackageId -cne $runtimePackageId -or
    $metadata.venueSlug -cne 'trades-hall' -or
    $metadata.roomSlug -cne 'grand-hall' -or
    $metadata.revision -ne $applyReceipt.package.revision -or
    $metadata.identityKind -cne 'content_sha256' -or
    $metadata.contentDigest -cne $applyReceipt.package.contentDigest -or
    $metadata.evidenceStatus -cne 'unverified' -or
    $metadata.runtimeStatus -cne 'internal_ready' -or
    $null -ne $metadata.reviewedProfileId -or
    $metadata.decisionId -cne 'grand-hall-big-model-sog-fine-v1' -or
    $metadata.decisionRef -cne $expectedFrontierReceiptSha256 -or
    $metadata.hierarchySha256 -cne $expectedManifestSha256 -or
    $metadata.format -cne 'sog' -or
    $metadata.level -cne 'fine' -or
    $metadata.lodSelectionPolicy -cne 'authoritative-leaf-nodes-exclude-environment-v1' -or
    $metadata.expectedGaussianCount -ne 6019684 -or
    $null -ne $metadata.semanticMeshAssetVersionId -or
    $null -ne $metadata.collisionAssetVersionId -or
    $null -ne $metadata.pointCloudAssetVersionId -or
    @($metadata.visualAssets).Count -ne $expectedMembers.Count) {
  throw "The browser-observed preview metadata is not the exact source-only Grand Hall package."
}

$observedAssetIds = @()
for ($index = 0; $index -lt $expectedMembers.Count; $index += 1) {
  $expected = $expectedMembers[$index]
  $asset = $metadata.visualAssets[$index]
  Assert-ExactPropertyNames $asset @(
    'assetVersionId', 'fileName', 'fileExt', 'sha256', 'sizeBytes'
  ) "Preview visual asset $index"
  Assert-GrandHallJsonString $asset.assetVersionId "Preview visual asset $index ID"
  Assert-GrandHallJsonString $asset.fileName "Preview visual asset $index name" `
    $expected.fileName
  Assert-GrandHallJsonString $asset.fileExt "Preview visual asset $index extension" '.sog'
  Assert-GrandHallJsonString $asset.sha256 "Preview visual asset $index SHA" `
    $expected.sha256
  Assert-GrandHallJsonInt64 $asset.sizeBytes $expected.sizeBytes `
    "Preview visual asset $index byte count"
  if ($asset.assetVersionId -cnotmatch $uuidPattern -or
      $asset.fileName -cne $expected.fileName -or
      $asset.fileExt -cne '.sog' -or
      $asset.sha256 -cne $expected.sha256 -or
      $asset.sizeBytes -ne $expected.sizeBytes) {
    throw "Preview visual asset $index does not match the canonical source member."
  }
  $observedAssetIds += $asset.assetVersionId
}
if (@($observedAssetIds | Sort-Object -Unique).Count -ne $expectedMembers.Count -or
    $metadata.primaryVisualAssetVersionId -cne $observedAssetIds[0] -or
    @($qaObservation.memberRequests).Count -ne $expectedMembers.Count) {
  throw "The preview does not declare eleven distinct ordered source assets."
}

$previousCompletedAt = $metadataCompletedAt
for ($index = 0; $index -lt $expectedMembers.Count; $index += 1) {
  $expected = $expectedMembers[$index]
  $request = $qaObservation.memberRequests[$index]
  $expectedRequestPath = "/admin/assets/runtime-package-previews/$runtimePackageId/assets/$($observedAssetIds[$index])/$($expected.fileName)"
  Assert-ExactPropertyNames $request @(
    'order', 'memberIndex', 'assetVersionId', 'fileName', 'sha256', 'sizeBytes',
    'gaussianCount', 'method', 'path', 'httpStatus', 'responseBytes',
    'verifiedSha256', 'startedAt', 'completedAt'
  ) "Member request $index"
  Assert-GrandHallJsonInt64 $request.order $index "Member request $index order"
  Assert-GrandHallJsonInt64 $request.memberIndex $index "Member request $index member index"
  Assert-GrandHallJsonString $request.assetVersionId "Member request $index asset ID" `
    $observedAssetIds[$index]
  Assert-GrandHallJsonString $request.fileName "Member request $index file name" `
    $expected.fileName
  Assert-GrandHallJsonString $request.sha256 "Member request $index declared SHA" `
    $expected.sha256
  Assert-GrandHallJsonInt64 $request.sizeBytes $expected.sizeBytes `
    "Member request $index declared byte count"
  Assert-GrandHallJsonInt64 $request.gaussianCount $expected.gaussianCount `
    "Member request $index Gaussian count"
  Assert-GrandHallJsonString $request.method "Member request $index method" 'GET'
  Assert-GrandHallJsonString $request.path "Member request $index path" `
    $expectedRequestPath
  Assert-GrandHallJsonInt64 $request.httpStatus 200 "Member request $index HTTP status"
  Assert-GrandHallJsonInt64 $request.responseBytes $expected.sizeBytes `
    "Member request $index response byte count"
  Assert-GrandHallJsonString $request.verifiedSha256 "Member request $index verified SHA" `
    $expected.sha256
  $requestStartedAt = ConvertTo-GrandHallQaTimestamp $request.startedAt "Member $index request start"
  $requestCompletedAt = ConvertTo-GrandHallQaTimestamp $request.completedAt "Member $index request completion"
  if ($request.order -ne $index -or
      $request.memberIndex -ne $index -or
      $request.assetVersionId -cne $observedAssetIds[$index] -or
      $request.fileName -cne $expected.fileName -or
      $request.sha256 -cne $expected.sha256 -or
      $request.sizeBytes -ne $expected.sizeBytes -or
      $request.gaussianCount -ne $expected.gaussianCount -or
      $request.method -cne 'GET' -or
      $request.path -cne $expectedRequestPath -or
      $request.httpStatus -ne 200 -or
      $request.responseBytes -ne $expected.sizeBytes -or
      $request.verifiedSha256 -cne $expected.sha256 -or
      $requestStartedAt -lt $previousCompletedAt -or
      $requestCompletedAt -lt $requestStartedAt) {
    throw "Member request $index is not the exact ordered authenticated source transfer."
  }
  $previousCompletedAt = $requestCompletedAt
}

$observedForbiddenVisual = @(
  $qaObservation.forbiddenVisualsObserved.PSObject.Properties |
    Where-Object { $_.Value -ne $false }
)
if ($qaObservation.latestPackageRequestCount -ne 0 -or
    $qaObservation.unexpectedRuntimeAssetRequestCount -ne 0 -or
    $qaObservation.loadedMemberCount -ne 11 -or
    $qaObservation.decodedGaussianCount -ne 6019684 -or
    $qaObservation.failedRequestCount -ne 0 -or
    $qaObservation.consoleErrorCount -ne 0 -or
    $observedForbiddenVisual.Count -ne 0 -or
    $canvasCapturedAt -lt $previousCompletedAt -or
    $observationRecordedAt -lt $canvasCapturedAt -or
    $qaObservation.canvas.fileName -cne '08-grand-hall-canvas.png' -or
    $qaObservation.canvas.captureKind -cne 'webgl_canvas_only') {
  throw "Authenticated Grand Hall WebGL QA did not satisfy the exact source-only observation gate."
}

$pngInfo = Get-Item -LiteralPath $qaCanvasPath -Force -ErrorAction Stop
if ([Math]::Abs(($pngInfo.LastWriteTimeUtc - $canvasCapturedAt.UtcDateTime).TotalMinutes) -gt 5) {
  throw "The canvas PNG filesystem time is not contemporaneous with the browser observation."
}
$qaCanvasBytes = $null
$pngMemoryStream = $null
$pngImage = $null
$pngBitmap = $null
try {
  $qaCanvasBytes = Read-GrandHallBoundedDirectFile `
    -Path $qaCanvasPath `
    -MinimumBytes 25 `
    -MaximumBytes 67108864 `
    -Label 'Browser QA canvas PNG'
  $qaCanvasSha256 = Get-GrandHallSha256Hex $qaCanvasBytes
  $pngMagic = [BitConverter]::ToString($qaCanvasBytes[0..7]).Replace('-', '')
  if ($pngMagic -cne '89504E470D0A1A0A') {
    throw "The QA canvas evidence does not have a PNG signature."
  }
  Add-Type -AssemblyName System.Drawing -ErrorAction Stop
  $pngMemoryStream = [IO.MemoryStream]::new($qaCanvasBytes, $false)
  $pngImage = [Drawing.Image]::FromStream($pngMemoryStream, $true, $true)
  if ($pngImage.RawFormat.Guid -ne [Drawing.Imaging.ImageFormat]::Png.Guid) {
    throw "The decoded QA canvas evidence is not PNG."
  }
  $pngBitmap = [Drawing.Bitmap]::new($pngImage)
  $pngWidth = $pngBitmap.Width
  $pngHeight = $pngBitmap.Height
  if ($pngWidth -le 0 -or $pngHeight -le 0) {
    throw "The QA canvas PNG has invalid dimensions."
  }
} finally {
  if ($null -ne $pngBitmap) { $pngBitmap.Dispose() }
  if ($null -ne $pngImage) { $pngImage.Dispose() }
  if ($null -ne $pngMemoryStream) { $pngMemoryStream.Dispose() }
  if ($null -ne $qaCanvasBytes) {
    [Array]::Clear($qaCanvasBytes, 0, $qaCanvasBytes.Length)
  }
}

$applyEvidenceSha256 = $selectedApplyEvidence.sha256
$qaReceipt = [ordered]@{
  schemaVersion = "venviewer.grand-hall-authenticated-webgl-qa-evidence.v3"
  recordedAt = (Get-Date).ToUniversalTime().ToString('o')
  targetId = "trades-hall-grand-hall-staging"
  apiOrigin = $recordedStagingApiOrigin
  webOrigin = $stagingWebOrigin
  reviewedGitSha = $reviewedSuccessorSha
  runtimePackageId = $runtimePackageId
  revision = $applyReceipt.package.revision
  contentDigest = $applyReceipt.package.contentDigest
  idempotencyApplyEvidenceSha256 = $applyEvidenceSha256
  finalDisabledHealthEvidenceSha256 = $finalHealthSha256
  finalDisabledHealthRecordedAt = $finalHealth.recordedAt
  disabledIntakeEvidenceSha256 = $disabledIntakeSha256
  disabledIntakeRecordedAt = $disabledIntake.recordedAt
  disabledIntakeEvidenceFileName = $disabledIntakeFileName
  browserObservationSha256 = $qaObservationSha256
  cameraRegistration = "inspection_only"
  sourceDecisionId = "grand-hall-big-model-sog-fine-v1"
  observation = $qaObservation
  canvasPng = [ordered]@{
    fileName = $qaObservation.canvas.fileName
    sha256 = $qaCanvasSha256
    width = $pngWidth
    height = $pngHeight
  }
  visualAssessment = "not_reviewed"
  humanAcceptance = "unresolved"
}
$qaBytes = [Text.UTF8Encoding]::new($false).GetBytes(
  (($qaReceipt | ConvertTo-Json -Depth 10 -Compress) + "`n")
)
$qaStream = [IO.FileStream]::new(
  $qaEvidencePath,
  [IO.FileMode]::CreateNew,
  [IO.FileAccess]::Write,
  [IO.FileShare]::None
)
try {
  $qaStream.Write($qaBytes, 0, $qaBytes.Length)
  $qaStream.Flush($true)
} finally {
  $qaStream.Dispose()
  [Array]::Clear($qaBytes, 0, $qaBytes.Length)
}
```

The strict receipt hashes the same bounded, exclusively read bytes that it parses or decodes. It establishes consistency among the retained apply bytes, fresh final-disabled deployment health receipt, separately authenticated disabled-intake proof, allowlisted browser-tool observation, exact ordered metadata/member identities, per-request timing/status, and the fully decoded run-specific PNG bytes. It is not a cryptographic attestation that the browser tool observed what it reported, that the PNG came from a particular canvas, or that the captured source itself contains no artefact. The visual booleans remain a bounded inspection observation, not source truth or human acceptance. Preserve all three QA files and their bound input receipts in the external run directory without moving them into Git.

This staging QA is not a controlled visual benchmark or formal visual acceptance. The current camera is source-position-derived and explicitly records `cameraRegistration: inspection_only`; its orientation/FOV have not been matched to and human-reviewed against the native viewer. The current SOG and SPZ diagnostic PNGs remain `visualAssessment: not_reviewed`, and the owner's literal `[accept/reject]` placeholder has not selected either result. Do not relabel the staging QA as `passed`, `reviewed_accepted`, photoreal, measured geometry, or source-camera parity. A later acceptance decision must cite the exact evidence hashes it reviewed. Until both staging QA and that separate human decision are recorded, T-540 remains `in-progress`.
