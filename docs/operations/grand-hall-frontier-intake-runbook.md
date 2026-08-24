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
4. A dedicated write-capable R2 parent credential held only by the trusted local operator process. Use it to sign a shortest-workable-lifetime child credential with `scope: "object-read-write"`, `actions: ["PutObject"]`, and `paths.prefixPaths: ["venues/trades-hall/rooms/grand-hall/xgrids/grand-hall-big-model-sog-fine-v1/"]`. The parent access-key ID must differ from the serving principal's access-key ID. Never place the parent in Railway, chat, the repository, screenshots, or receipts. Mint the child only after the base staging deployment is healthy; use a 3,600-second lifetime for the bounded rehearsal/admission window unless a shorter lifetime has already been timed successfully. If it expires, mint a new equally restricted child and continue from a fresh preflight; never broaden the scope.
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
8. Only after explicit resume, push the dedicated branch without merging it. Let Vercel create the branch Preview. Record its stable branch HTTPS origin and confirm the Vercel deployment identifies the exact reviewed commit.
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
12. In the deployment details, record the effective settings and again prove exactly one active replica. Require `GET /health/ready` to return 200 and `GET /health/version` to report the full reviewed SHA. On this staging target, readiness asks PostgreSQL for `current_database()` and `current_user` and accepts only the code-pinned staging database and role. It does **not** prove migrations are applied.

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
$evidenceRoot = Join-Path $env:LOCALAPPDATA `
  ("Venviewer\grand-hall-staging-evidence\run-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $evidenceRoot -ErrorAction Stop | Out-Null
$reviewedSuccessorSha = "<exact-reviewed-successor-sha>"
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
  $migrationEvidence = Get-Content -LiteralPath $migrationEvidencePath -Raw | ConvertFrom-Json
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
$credentialArtifact = Join-Path $env:TEMP `
  ("grand-hall-r2-writer-" + [Guid]::NewGuid().ToString("N") + ".dpapi")
$secureAccountId = Read-Host "Enter the staging R2 account ID" -AsSecureString
$secureParentAccessKeyId = Read-Host "Enter the dedicated writer-parent access-key ID" -AsSecureString
$secureParentSecret = Read-Host "Enter the dedicated writer-parent secret access key" -AsSecureString
$accountIdPointer = [IntPtr]::Zero
$parentAccessKeyIdPointer = [IntPtr]::Zero
$parentSecretPointer = [IntPtr]::Zero
try {
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
  $secureAccountId.Dispose()
  $secureParentAccessKeyId.Dispose()
  $secureParentSecret.Dispose()
}
```

Do not open or decrypt the artifact by hand. Resolve the native executable rather than the mutable npm PowerShell wrapper, enter only the three non-secret provider UUIDs, and run the one-shot local handoff:

```powershell
$railwayExecutable = Join-Path $env:APPDATA `
  "npm\node_modules\@railway\cli\bin\railway.exe"
if (!(Test-Path -LiteralPath $railwayExecutable -PathType Leaf)) {
  throw "The native Railway CLI executable was not found at the reviewed path."
}
$expectedRailwayVersion = "railway 5.23.2"
$expectedRailwaySha256 = "22fbe91f45545c89530d630f7eb0d957a42be448d8fe692a83df47d4890059d8"
$actualRailwaySha256 = (Get-FileHash -LiteralPath $railwayExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualRailwaySha256 -cne $expectedRailwaySha256) {
  throw "The native Railway CLI does not match the reviewed SHA-256."
}
$actualRailwayVersion = (& $railwayExecutable --version 2>$null | Select-Object -First 1)
if ($actualRailwayVersion -cne $expectedRailwayVersion) {
  throw "The native Railway CLI does not match the reviewed version and SHA-256."
}
$railwayProjectId = "<dedicated-staging-project-uuid>"
$railwayEnvironmentId = "<dedicated-staging-environment-uuid>"
$railwayServiceId = "<dedicated-staging-api-service-uuid>"

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

Before it executes the CLI or decrypts anything, the handoff requires the native executable to match the code-pinned Railway CLI `5.23.2` SHA-256 above. It then runs `railway status --project <id> --environment <id> --json` from a temporary directory and requires the exact project, environment, and sole API service IDs and names. It rechecks the same reviewed CLI identity immediately before DPAPI decryption and again before each variable write. It validates the DPAPI payload's exact schema, 900–3,600 second lifetime, JWT, bucket, action, prefix, and three-key property set in memory. For each allowlisted key it starts the absolute native `railway.exe` directly and sends only that value through the child's standard input to `variable set <KEY> --stdin --skip-deploys --project <id> --environment <id> --service <id>`. Provider output is captured and discarded. No secret enters the command line, clipboard, shell environment, plaintext file, terminal output, chat, or `.env`. The outer local pnpm/Node operator process necessarily receives its local environment, but every Railway and DPAPI child process receives a fresh allowlisted environment and does not inherit `PATH`, `RAILWAY_TOKEN`, `RAILWAY_API_TOKEN`, parent R2 variables, database values, or the intake administrator token.

`variable set --stdin --skip-deploys` creates or updates values without deploying, but it does **not** seal a newly absent Railway key. Immediately after the command succeeds, open the exact staging environment and service in Railway. For each of the following keys, use its three-dot action to **Seal**, then visually require Railway's sealed/masked state before permitting any deploy:

- `RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID`
- `RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY`
- `RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN`

Do not assume that an updated previously sealed key stayed sealed; visually verify all three every time. A fake or empty placeholder is not a valid child credential, so when a key was previously absent there is a brief provider-manager-visible handoff window between the no-deploy CLI write and the immediate Seal action. During that window do not deploy, reveal, copy, screenshot, or share a value, and do not leave the Railway project unattended. Only the sealed-state check closes this window. Do not use `railway variable list --json` or `--kv`; those forms can return raw values.

If the handoff fails after staging only a subset, remain in the no-deploy state and rerun the exact command with the same artifact and target IDs before expiry; the writes are repeatable. If it cannot be completed safely before expiry, remove any staged child keys without revealing them, delete the artifact, and mint a new equally restricted child. After all three keys are visibly sealed, remove the local artifact:

```powershell
Remove-Item -LiteralPath $credentialArtifact -Force -ErrorAction Stop
if (Test-Path -LiteralPath $credentialArtifact) {
  throw "The temporary writer artifact was not removed."
}
```

Only after the three sealed-state checks may you set the exact target ID, exact reviewed successor SHA, and `RUNTIME_PROFILE_INTAKE_ENABLED=true`, then redeploy the same commit. If re-entry is needed after deleting the artifact, mint a new child at a new path rather than trying to recover a sealed or expired value.

Before rehearsal, check `/health/ready` again and require `/health/version.gitSha` to remain the exact reviewed successor SHA. Intake-enabled startup validates the Docker-stamped SHA, configured deployed SHA, configured target and the complete five-field intake group. It proves that the read and write configuration fields are separate; the live rehearsal below, not startup alone, proves the selected credentials' effective R2 permissions.

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

Run from the exact clean reviewed repository root in PowerShell after the selected API is deployed, configured, enabled, and explicitly authorized. Replace and independently verify the recorded Railway API origin, the origin observed at `/health/version`, and the stable Vercel Preview origin placeholders. `$evidenceRoot` was created outside Git in the migration block above; if this is a new shell, point it to that same existing run directory and verify it before continuing. The package command does not load or require `packages/api/.env`.

Clerk session tokens normally have a one-minute lifetime. The CLI therefore obtains a new token immediately before **every authenticated HTTP request**, not merely once per CLI invocation. It opens a one-time listener on `127.0.0.1`, generates an ephemeral RSA keypair, and prints a non-secret browser-console command containing only its loopback URL and public key. That command asks the signed-in staging Clerk session for a fresh token, encrypts it with a one-time AES-GCM key, wraps that key with RSA-OAEP, zeros the browser plaintext/key buffers, and sends only ciphertext to loopback. Browser Network tooling can retain that loopback request body, but it is not the bearer token and the private key exists only in the local CLI process. The bearer necessarily travels in the expected TLS-protected Clerk exchange and the exact staging API `Authorization` header; never open, preserve, export, screenshot, or log Authorization/header/token/payload material. Later QA may inspect only non-secret request URLs, order, status, and timing without opening sensitive headers or payloads. The token is never placed in the Windows clipboard, printed browser command/history text, shell environment, command arguments, file, Railway variable, receipt, or screenshot.

Apply uses two sequential relay commands: one for preflight and a new one for commit. Admission also uses two when preflight finds a missing member and it actually sends that upload; reconciliation after a lost final PUT can find all eleven members already verified and then uses only the preflight relay. Rehearsal and disabled verification need one. Run each printed command only in the signed-in exact staging Preview console. Chrome may show a loopback/Local Network Access permission prompt; allow it only for that exact staging Preview and this one relay. If permission is denied, the browser blocks loopback, the origin check fails, or the relay times out, stop; do not fall back to clipboard or a long-lived token. Close DevTools after the operation.

Set and cross-check the shared non-secret selections once, then define the relay wrapper:

```powershell
$manifest = "C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_1\lcc2-result\Grand_Hall.lcc2"
$recordedStagingApiOrigin = "<Railway-recorded-clean-staging-api-origin>"
$apiOrigin = "<origin-observed-at-health-version>"
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
$reviewedGitSha = (& git rev-parse --verify 'HEAD^{commit}').Trim()
if ($LASTEXITCODE -ne 0 -or $reviewedGitSha -notmatch '^[a-f0-9]{40,64}$') {
  throw "The reviewed Git commit ID could not be established from this checkout."
}
$worktreeStatus = @(& git status --porcelain=v1 --untracked-files=all --ignore-submodules=none)
if ($LASTEXITCODE -ne 0 -or $worktreeStatus.Count -ne 0) {
  throw "The reviewed Git worktree is not clean, including untracked files."
}

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
$rehearsal = $rehearsalJson | ConvertFrom-Json
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
  $admission = $admissionJson | ConvertFrom-Json
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
$first = $firstJson | ConvertFrom-Json
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
$recovery = $recoveryJson | ConvertFrom-Json
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
$second = $secondJson | ConvertFrom-Json
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
- manifest SHA-256 and frontier receipt SHA-256;
- rehearsal initial/final counts plus exact-create, exact-retry, and corrupt-copy results;
- each one-member admission's target-binding digest, ordered preflight status, admitted member result, and before/after progress;
- commit preflight counts and zero-PUT assertion;
- returned RuntimePackage ID, revision, content digest, `created` value, member count, total bytes, and Gaussian count;
- the disabled-state receipt plus the dated deployment change that disabled intake and removed its target/write credentials; and
- later browser/WebGL QA evidence only after explicit permission.

With `pnpm --silent`, standard output is exactly one JSON evidence receipt; progress is written to standard error. `--out` is mandatory. The CLI exclusively reserves the actual external destination before token/source/network access, writes the same JSON-plus-line-feed bytes only after a successful operation, flushes them to storage, and refuses every existing destination. A failed operation/finalization can leave an empty or incomplete reserved file; preserve it and use a new path on retry.

The rehearsal receipt nests safe server evidence: authenticated operator, deployed build, target/origin/source identity, initial/final counts, exact-create/retry/corruption results, and explicit no-commit/no-registration assertions. Each admission receipt records its preflight/binding, at most one PUT result, progress, and explicit no-commit/no-registration assertions. Apply receipts record a fully verified preflight, an empty PUT list, and the package ID, revision, content digest, `created` value, member count, byte total, and Gaussian total. The disabled-state receipt contains only timestamp, locally proven reviewed SHA, target/origin, HTTP 503, exact disabled code, and `disabled: true`. Receipts contain no token, local source path, private key, upload headers, storage account, bucket, object key, or database identity. Preserve the JSON bytes unchanged; do not substitute screenshots for a receipt.

The receipts cannot record a future configuration change. Retain the separately dated deployment change that disables intake and removes its five intake-only target/deployment/temporary-write fields, then link that record to the rehearsal, every admission, first apply, repeated apply, and disabled-state receipts.

Do not record the bearer token, `DATABASE_URL`, R2 credentials, account ID, bucket name, private object keys, response authorization headers, or a local absolute source path in shared logs/screenshots.

## Close the intake window

After successful registration:

1. Set `RUNTIME_PROFILE_INTAKE_ENABLED=false`.
2. Remove `RUNTIME_PROFILE_INTAKE_TARGET_ID`, `RUNTIME_PROFILE_INTAKE_DEPLOYED_GIT_SHA`, `RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID`, `RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY`, and `RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN` together from the deployment.
3. Keep `VENVIEWER_DEPLOYMENT_TARGET_ID`, `VENVIEWER_STAGING_REVIEWED_GIT_SHA`, `VENVIEWER_STAGING_EXPECTED_DATABASE_HOST`, `VENVIEWER_STAGING_EXPECTED_WEB_ORIGIN`, all five Railway identity values, the isolated Clerk values, `PUBLIC_API_ORIGIN`, `FRONTEND_URL` / `CORS_ORIGINS`, and the read-only `RUNTIME_PROFILE_R2_*` connection unchanged. These persistent checks reject configuration that conflicts with the recorded staging names, hosts, origins, branch, role/database, and bucket; the retained provider-console resource-ID evidence remains necessary because the application cannot prove provider account/project identity from credentials alone.
4. Redeploy the exact same commit. Startup now fails if the flag is false while any of the five intake-only fields remains configured. Require `/health/ready` 200 and the same exact Git SHA at `/health/version`; together with the successful startup, this proves the temporary intake group is absent rather than merely ignored.
5. Use one newly encrypted browser-relay token and create the shutdown receipt with the source-free verification mode:

   ```powershell
   $disabledPath = Join-Path $evidenceRoot "06-disabled-intake.json"
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
   $disabled = $disabledJson | ConvertFrom-Json
   if ($disabled.mode -ne 'verify_disabled' -or
       $disabled.httpStatus -ne 503 -or
       $disabled.errorCode -ne 'GRAND_HALL_INTAKE_DISABLED' -or
       $disabled.disabled -ne $true) {
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

7. Confirm no `.dpapi` writer artifact from this run remains. In Cloudflare, revoke/delete the dedicated Object Read & Write parent token so its temporary children can no longer be used. Do not revoke the separate Object Read only serving principal.
8. Keep the package `internal_ready`. Publishing, public evidence claims, metric planning, and any package promotion require their own reviewed authority.

## Remaining visual gate

Registration is not visual acceptance. Take the immutable `runtimePackageId` from the successful apply receipt and open the authenticated staging web origin at:

```text
/dev/trades-hall-visual?venue=trades-hall&room=grand-hall&runtimePackageId=<apply-receipt-runtime-package-id>
```

Do not omit the selector or substitute a latest-package URL for exact-package QA. Confirm in the browser network record that `/assets/runtime-packages/latest` is not requested, the displayed package ID exactly matches the apply receipt, metadata is admitted before member zero is requested, and only the authenticated private-preview member endpoints transfer the eleven SOG objects.

With explicit browser permission, perform authenticated source-only WebGL QA at the deterministic current inspection camera and through restrained inspection within the captured room envelope. Confirm that the renderer shows no invented doors, windows, central dark floor, procedural surfaces, generated fill, planning geometry, neighbouring rooms, or exterior facade. Record console errors, failed requests, loaded member/Gaussian counts, package ID, and canvas-only PNG hashes without recording cookies, authorization headers, or tokens.

This staging QA is not a controlled visual benchmark or formal visual acceptance. The current camera is source-position-derived and explicitly records `cameraRegistration: inspection_only`; its orientation/FOV have not been matched to and human-reviewed against the native viewer. The current SOG and SPZ diagnostic PNGs remain `visualAssessment: not_reviewed`, and the owner's literal `[accept/reject]` placeholder has not selected either result. Do not relabel the staging QA as `passed`, `reviewed_accepted`, photoreal, measured geometry, or source-camera parity. A later acceptance decision must cite the exact evidence hashes it reviewed. Until both staging QA and that separate human decision are recorded, T-540 remains `in-progress`.
