# Grand Hall exact-frontier intake runbook

Date: 2026-08-22
Status: operator procedure, not evidence that intake or deployment occurred
Task: T-540
Owner: Venviewer engineering / an explicitly authorized platform administrator

## Purpose and hard boundary

This runbook uploads and immutably registers only the pinned eleven-member XGRIDS SOG frontier for Trades Hall's individual Grand Hall. It deliberately does not publish the package, construct a whole venue, add neighbouring rooms, merge the exterior facade, certify operational geometry, or grant permission for browser automation.

The intake CLI talks only to the selected Venviewer API over HTTPS. That same API process owns the target database connection and the private R2 configuration. Binary uploads are proxied through the authenticated API; the operator is never given R2 account, bucket, object-key, or credential material by preflight.

No generative-modelling, image-generation, or video-generation key is needed. Generated or procedurally invented architectural pixels are prohibited. Existing exterior-facade assets stay separate from the Grand Hall room layer.

## Current execution state

Do not treat this file as an execution record. As of 2026-08-22:

- no target environment has been selected for mutation;
- no canonical member has been uploaded by this work;
- no AssetVersion or RuntimePackage has been registered by this work;
- no code or package activation has been deployed by this work; and
- no browser/WebGL visual QA has been run.

## Required operator inputs

Obtain all of the following before changing a target environment:

1. The explicitly selected target ID. It must be a 3–80 character lowercase identifier containing only letters, digits, `.`, `_`, or `-`, and it must identify one API/database/private-bucket deployment unambiguously.
2. The selected API's exact clean HTTPS origin, with no credentials, path, query, fragment, or trailing path component.
3. An existing bearer token for a user who is currently authorized as a Venviewer platform administrator, or an authorized platform administrator who will run the command. Never place the token in this repository, an environment example, a command argument, a screenshot, or an operations record.
4. A distinct same-bucket R2 principal that is limited to object creation for the runtime-profile bucket/prefix, if one has not already been provisioned. Its access-key ID must differ from the serving principal's access-key ID.
5. Explicit browser permission before any later authenticated browser or WebGL QA.

The CLI also requires the reviewed local Git commit ID. The command below obtains it directly from `HEAD`, validates its lowercase hexadecimal form, and places it in the secret-free receipt. Before any network request, the CLI independently proves that this commit exists, is the exact repository `HEAD`, and that the tracked and untracked worktree is clean. Run only from the exact reviewed checkout; do not type an arbitrary digest. The selected API must be configured with the same commit as its deployed intake build, and both preflight and commit must return that exact value.

The source manifest for this intake is:

`C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_1\lcc2-result\Grand_Hall.lcc2`

Do not substitute another export or another `Grand_Hall.lcc2`. The CLI requires an absolute path, independently inspects the hierarchy, excludes `env.sog`, and refuses a receipt that does not match the code-pinned frontier.

## Target-side configuration

Deploy the reviewed T-540 code to the selected API before enabling intake. Configure secrets in the target's secret manager, never in a committed file.

| Variable | Required value and authority |
|---|---|
| `DATABASE_URL` | Existing connection for the explicitly selected database. Do not copy a URL between targets merely to make the binding pass. |
| `PUBLIC_API_ORIGIN` | The selected clean HTTPS API origin. It must exactly equal the CLI `--api-origin`. |
| `GIT_SHA` | Existing Docker build stamp for the running artifact (`BUILD_GIT_SHA` in the Dockerfile). For intake it must be a lowercase 40–64 digit commit SHA, never `dev`, and must exactly equal `RUNTIME_PROFILE_INTAKE_DEPLOYED_GIT_SHA`. Do not hand-set it independently of the image build. |
| `RUNTIME_PROFILE_R2_ACCOUNT_ID` | Existing private-runtime R2 account. |
| `RUNTIME_PROFILE_R2_PRIVATE_BUCKET` | Existing non-public runtime-profile bucket. |
| `RUNTIME_PROFILE_R2_ACCESS_KEY_ID` | Read-only serving principal. |
| `RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY` | Read-only serving secret. |
| `RUNTIME_PROFILE_INTAKE_TARGET_ID` | The selected target ID. It must exactly equal the CLI `--target-id`. |
| `RUNTIME_PROFILE_INTAKE_DEPLOYED_GIT_SHA` | Intentional intake deployment selection: the exact lowercase 40–64 digit reviewed commit expected in the running image. It must equal both the image-stamped `GIT_SHA` and CLI `--reviewed-git-sha`; do not use a caller assertion, branch name, or mutable release label. |
| `RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID` | Separate intake principal, scoped to put-only access for the same private bucket and canonical prefix. |
| `RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY` | Separate intake secret. |
| `RUNTIME_PROFILE_INTAKE_ENABLED` | `true` only for the approved intake window; its default and normal resting value are `false`. |

The read principal needs only the object-read authority required for complete verification and authenticated serving. The intake principal must not have read, list, or delete authority. The API always supplies `If-None-Match: *` on its only PutObject call and never issues an unconditional overwrite, so it cannot replace an existing canonical key. Keep public bucket access, `r2.dev`, and custom public domains disabled.

Configuration is complete only when the API starts successfully and `/health/version` reports the intended image-stamped `GIT_SHA`. Intake-enabled startup validation rejects a missing, `dev`, malformed, or mismatched build stamp before the routes can use storage or the database. The configured deployed Git SHA is required whenever intake is enabled; it is not inferred from an operator request. Do not infer the target from a shell prompt, a project name, a browser tab, or the operator's local `.env` file.

## Target binding

Preflight returns a SHA-256 target-binding digest computed by the selected server. It binds the target ID, API origin, actual image-stamped build Git SHA, intentional intake deployment SHA, database connection identity, R2 account, private bucket, canonical object prefix, frontier receipt, and intake binding secret without disclosing those private values. Every member upload echoes the binding and actual build SHA in API headers, and commit echoes the actual build SHA in the body. The CLI rejects any server build SHA that differs from its locally proven reviewed SHA before it accepts upload or commit evidence.

If any bound server configuration changes after preflight, the server returns `GRAND_HALL_INTAKE_TARGET_MISMATCH`. Run preflight again by rerunning the exact CLI command. Never copy a binding from another environment or edit a returned upload capability.

## Mandatory staging rehearsal

Production intake is prohibited until the same build has passed this rehearsal against a dedicated staging database and private bucket. Do not rehearse in a shared or production bucket.

1. Configure staging with its own target ID, API origin, database, bucket, read-only principal, and distinct put-only principal. Enable intake temporarily.
2. Run the supported `--rehearse-conditional-put` command below. It refuses any target that is not a fresh, dedicated staging target with exactly 11 `upload_required` members.
3. The rehearsal holds one unchanged preflight response in memory and submits member 0's exact bytes twice through the same API-relative path and headers. It accepts only HTTP 201 with `created: true`, followed by HTTP 200 with `created: false`.
4. The rehearsal reads and validates member 1, corrupts only an in-memory copy without touching the supplied source, requires HTTP 409 `GRAND_HALL_STORAGE_CONFLICT`, then runs a read-only verification preflight. It succeeds only if member 0 is verified and member 1 remains `upload_required`. It never calls commit or registration.
5. Run the full CLI command below. It must verify the already-present exact member, upload the remaining exact members, rehash all 11 remote objects, and create one `internal_ready` package.
6. Run the identical full CLI command again. It must upload no members and report that the same immutable package was reused. A second package revision or changed content digest fails the rehearsal.
7. Capture the safe evidence listed below, set `RUNTIME_PROFILE_INTAKE_ENABLED=false`, remove all four `RUNTIME_PROFILE_INTAKE_*` target/deployment/write-credential values, and redeploy staging.

The unit and route suites are required in addition to this rehearsal; mocks cannot establish that the selected R2-compatible service enforces conditional create.

Any rehearsal failure is terminal for that staging attempt. Do not run commit, do not delete or overwrite a canonical key, and do not proceed to production. Preserve the secret-free error/receipt material and investigate the isolated staging target under separate incident authority.

## Exact operator commands

Run from the repository root in PowerShell after the selected API is deployed, configured, enabled, and explicitly authorized. Replace only the target and approved evidence-path placeholders. Inject `RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN` into the current process through the approved secret mechanism before running these blocks; do not type or paste the token into an interactive command, because shell history may retain it. The CLI reads the token from the process environment and never accepts it as a command argument. The package command does not load or require `packages/api/.env`.

Set and validate the shared selections once:

```powershell
if ([string]::IsNullOrWhiteSpace($env:RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN)) {
  throw "Inject the existing platform-admin bearer token through the approved secret mechanism first."
}
$manifest = "C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_1\lcc2-result\Grand_Hall.lcc2"
$apiOrigin = "<selected-clean-https-api-origin>"
$targetId = "<selected-target-id>"
$reviewedGitSha = (& git rev-parse --verify 'HEAD^{commit}').Trim()
if ($LASTEXITCODE -ne 0 -or $reviewedGitSha -notmatch '^[a-f0-9]{40,64}$') {
  throw "The reviewed Git commit ID could not be established from this checkout."
}
$worktreeStatus = @(& git status --porcelain=v1 --untracked-files=all --ignore-submodules=none)
if ($LASTEXITCODE -ne 0 -or $worktreeStatus.Count -ne 0) {
  throw "The reviewed Git worktree is not clean, including untracked files."
}
```

On the fresh dedicated staging target, run the non-committing rehearsal and retain its one-line JSON receipt in the approved evidence store:

```powershell
try {
  $rehearsalJson = & pnpm --silent --filter @omnitwin/api run assets:intake-grand-hall-big-model-frontier -- `
    --rehearse-conditional-put `
    --manifest $manifest `
    --api-origin $apiOrigin `
    --target-id $targetId `
    --reviewed-git-sha $reviewedGitSha
  if ($LASTEXITCODE -ne 0) { throw "Grand Hall conditional-PUT rehearsal failed." }
  $rehearsal = $rehearsalJson | ConvertFrom-Json
  if ($rehearsal.mode -ne 'conditional_put_rehearsal' -or
      $rehearsal.committed -ne $false -or $rehearsal.registered -ne $false) {
    throw "Grand Hall rehearsal returned an unexpected receipt."
  }
  $rehearsalJson | Set-Content -LiteralPath "<approved-rehearsal-receipt-path>" -Encoding utf8
} finally {
  Remove-Item Env:RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN -ErrorAction SilentlyContinue
}
```

After reinjecting a current admin token, run the full staging intake twice and compare the receipts. The second invocation must prove immutable reuse:

```powershell
try {
  $run = {
    & pnpm --silent --filter @omnitwin/api run assets:intake-grand-hall-big-model-frontier -- `
      --apply `
      --manifest $manifest `
      --api-origin $apiOrigin `
      --target-id $targetId `
      --reviewed-git-sha $reviewedGitSha
    if ($LASTEXITCODE -ne 0) { throw "Grand Hall exact-frontier intake failed." }
  }
  $firstJson = & $run
  $secondJson = & $run
  $first = $firstJson | ConvertFrom-Json
  $second = $secondJson | ConvertFrom-Json
  if ($second.package.created -ne $false -or
      $second.package.runtimePackageId -ne $first.package.runtimePackageId -or
      $second.package.revision -ne $first.package.revision -or
      $second.package.contentDigest -ne $first.package.contentDigest -or
      $second.puts.Count -ne 0) {
    throw "The repeated intake did not prove exact immutable package reuse."
  }
  $firstJson | Set-Content -LiteralPath "<approved-first-intake-receipt-path>" -Encoding utf8
  $secondJson | Set-Content -LiteralPath "<approved-repeated-intake-receipt-path>" -Encoding utf8
} finally {
  Remove-Item Env:RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN -ErrorAction SilentlyContinue
}
```

Exactly one operation flag is required. `--apply` performs upload/commit; `--rehearse-conditional-put` is staging-only, requires a fresh target, creates only exact member 0, tests a corrupt in-memory buffer against member 1, verifies the resulting object state, and never commits. There is no generic write mode and no supported flag that changes the canonical frontier, storage prefix, registration metadata, or commit confirmation.

If the bearer token expires during transfer, acquire a fresh existing platform-admin token and rerun the identical command. Do not add a token to `packages/api/.env`, because the operation is safely restartable. Every CLI HTTP request has a ten-minute absolute deadline covering both connection and response-body consumption; the abort deadline keeps the direct CLI process alive until it succeeds or fails explicitly. A deadline failure is safe to retry through a new preflight.

## What the command does

### 1. Local admission

Before a network request, the CLI:

- resolves the executing intake script's real path, proves that it lies inside its own discovered Git repository, then proves that the supplied reviewed commit exists, exactly equals that repository's `HEAD`, and that its tracked and untracked worktree state is clean (ambient shell checkout state is never authoritative);
- resolves and inspects the supplied `Grand_Hall.lcc2` hierarchy;
- selects only the 11 authoritative fine leaf members with the environment excluded;
- verifies the hierarchy and aggregate frontier receipts; and
- reads and retains every member needed by the selected operation with a strict byte bound, then verifies exact byte length and SHA-256. Apply admits all 11 members before preflight; rehearsal admits members 0 and 1 before preflight. Later uploads use only those admitted buffers, and the corrupt rehearsal copy is wiped after use.

### 2. Same-server preflight

`POST /admin/assets/grand-hall-frontier-intake/preflight` requires platform-admin authentication and exact target/source/deployed-build identity. The API reads every canonical private object in full. It returns its configured deployed Git SHA and only safe API-relative upload capabilities for missing members. It returns no presigned R2 URL and no private storage identity.

### 3. API-proxied member upload

For each missing member, the CLI sends `application/octet-stream` to `PUT /admin/assets/grand-hall-frontier-intake/members/:memberIndex`. The API validates authentication, index, declared size, canonical source receipts, target ID, origin, and target binding before storage. It hashes the body, performs a fixed-key conditional PUT with the put-only principal, then performs a full read-back through the read-only principal. At most two member uploads are admitted concurrently by the API; the CLI currently submits them sequentially.

### 4. Verified atomic commit

`POST /admin/assets/grand-hall-frontier-intake/commit` requires the literal confirmation `register_exact_internal_ready_grand_hall_frontier`. The server reopens and rehashes all eleven objects before any database write. One advisory-locked transaction then:

- creates or exactly reuses 11 AssetVersion rows in receipt order;
- keeps every `captureSessionId` null unless independent provenance has been validated in a separate evidence process;
- creates or exactly reuses one content-digest-identified `internal_ready` RuntimePackage;
- keeps semantic mesh, collision, and point-cloud references null; and
- writes one platform-admin audit entry when it creates the package.

A member conflict, package conflict, lock failure, or database failure rolls back the transaction. Previously uploaded exact objects remain immutable and can be reused by a safe retry.

## Retry and failure policy

| Result | Operator action |
|---|---|
| Network interruption, HTTP 408, HTTP 429, or transient 5xx | Wait for `Retry-After` when present, obtain a fresh token if needed, then rerun the identical command. Preflight rehashes existing objects and commit exactly reuses existing rows/package. |
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
- target-binding digest;
- preflight existing/upload-required counts and ordered member statuses;
- staging conditional-PUT first/second HTTP status and `created` values;
- returned RuntimePackage ID, revision, content digest, `created` value, member count, total bytes, and Gaussian count;
- the dated change that disabled intake and removed its target/write credentials; and
- later browser/WebGL QA evidence only after explicit permission.

With `pnpm --silent`, standard output is exactly one JSON evidence receipt; progress is written to standard error. The rehearsal receipt contains the server-authenticated operator ID, timestamp, locally proven reviewed Git SHA, server deployed Git SHA, selected target/origin, source and binding digests, ordered initial and verification preflights, both member-0 HTTP/`created` results, the corrupt-buffer HTTP/code result, and explicit `committed: false` / `registered: false` assertions. The apply receipt contains the same identity/source/preflight evidence, every PUT HTTP/`created` result, and the returned package ID, revision, content digest, `created` value, member count, byte total, and Gaussian total. It contains no token, local source path, private key, upload headers, storage account, bucket, object key, or database identity. Preserve the JSON bytes unchanged; do not substitute screenshots for the receipt.

The receipt cannot record a future configuration change. Retain the separately dated deployment change that disables intake and removes its four intake-only target/deployment/write fields, then link that record to the three staging receipts.

Do not record the bearer token, `DATABASE_URL`, R2 credentials, account ID, bucket name, private object keys, response authorization headers, or a local absolute source path in shared logs/screenshots.

## Close the intake window

After successful registration:

1. Set `RUNTIME_PROFILE_INTAKE_ENABLED=false`.
2. Remove `RUNTIME_PROFILE_INTAKE_TARGET_ID`, `RUNTIME_PROFILE_INTAKE_DEPLOYED_GIT_SHA`, `RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID`, and `RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY` together from the deployment.
3. Redeploy/restart the API and confirm preflight now returns `GRAND_HALL_INTAKE_DISABLED` to an authorized request.
4. Revoke the put-only R2 principal if it is single-use. Do not revoke the separate read-only serving principal.
5. Keep the package `internal_ready`. Publishing, public evidence claims, metric planning, and any package promotion require their own reviewed authority.

## Remaining visual gate

Registration is not visual acceptance. With explicit browser permission, perform authenticated source-only WebGL QA at the reviewed fixed cameras and compare the render directly with the supplied capture. Confirm that the renderer shows no invented doors, windows, central dark floor, procedural surfaces, generated fill, planning geometry, neighbouring rooms, or exterior facade. Until that review is recorded, T-540 remains `in-progress`.
