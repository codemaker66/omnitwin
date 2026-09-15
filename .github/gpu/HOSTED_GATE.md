# Hosted verification of a local GPU job

The hosted job issues a fresh request and independently verifies returned raw
evidence. The five browser cases execute on the isolated local GPU; a hosted
verifier is not a claim that GitHub supplied the graphics hardware. No status,
blob, worker or GitHub configuration is created by this module.

Run both commands from the exact repository checkout, using a new output directory
whose parent already exists:

```text
node .github/gpu/hosted-gate.mjs prepare --output-dir PATH
node .github/gpu/hosted-gate.mjs wait --output-dir PATH
```

Required environment: `GITHUB_REPOSITORY`, `GITHUB_SHA`, `GITHUB_RUN_ID`,
`GITHUB_RUN_ATTEMPT`, and a read-only `GH_TOKEN` or `GITHUB_TOKEN`. The exact
checkout SHA is authoritative, including the merge checkout for pull requests.
The repository must be public, personally owned `codemaker66/omnitwin`.
Repository and owner numeric IDs are read from authenticated GitHub metadata.
Python 3 derives the full committed source map independently on prepare and wait.
`worker-profile.json`, the verifier, source builder and bridge must match their
committed bytes. The profile is an expectation, not observed worker evidence.

Preparation writes `request.json`, `trusted.json`, then `READY.json` last, using
exclusive creation. The request binds repository/operator IDs, source commit/tree,
run/attempt, a random 32-character nonce, a 25-minute expiry, status context and
trusted/profile/verifier digests. The trusted file follows `verify-receipt.mjs`'s
unchanged contract. The original prepared directory stays in the hosted job.

The external trusted controller must independently admit the source, enforce
single execution and expiry, verify the isolated worker's source/runtime and
raw result, then upload a sanitized JSON Git blob containing exactly:

```text
{schemaVersion: 1, requestSha256, receipt, resultsBase64}
```

`requestSha256` covers the exact request bytes; `receipt` uses the existing
verifier schema; `resultsBase64` preserves the exact raw Playwright JSON bytes.
Controller credentials never enter the worker. An owner-authored status on
`request.sourceCommit` uses `request.statusContext`, description
`sha256:<SHA256 of exact bundle bytes>`, and target URL
`https://api.github.com/repos/codemaker66/omnitwin/git/blobs/<blob SHA>`.
Only the trusted controller may publish success after real execution/verification.
Historical local reports must never receive a freshly invented execution envelope.

The hosted waiter checks the still-active run attempt, paginates statuses newest
first, verifies numeric creator ID, nonce/context and freshness, restricts the
blob URL, verifies Git-object and SHA-256 identities, and reruns all existing raw
receipt checks. Failure, wrong identity, missing data, cancellation and expiry
return nonzero. A new run attempt requires a new request. Gate/history verification
may be repeated after expiry, but new evidence cannot be accepted after expiry.
Receipt execution and status creation must lie within the original request window.

Successful output includes `accepted-bundle.json`, `accepted-status.json`, exact
`results.json`, `receipt.json`, `verification.json` and the final
`authenticated-result.json`. Upload these alongside the original prepared files
as the hosted artifact immediately; unreferenced Git-blob retention is not assumed.
The final browser reconciler must independently compare source/run/attempt and
require both CPU/GPU jobs plus the complete case inventory. The controller-owned
status authenticates the execution attestation; it is not hardware attestation or
physical-device acceptance. Unit fixtures never count as qualification evidence.
