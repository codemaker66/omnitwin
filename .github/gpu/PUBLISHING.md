# One explicit local GPU result

The trusted operator runs this command outside the worker, from the reviewed
repository containing the committed controller. Every value is explicit:

```text
node .github/gpu/publish-result.mjs --request-dir PATH --worker-output PATH --repo PATH --run-id ID --attempt NUMBER --source EXACT_SHA
```

`gh` supplies its existing authenticated operator identity. The command rejects
an operator who is not the personal repository owner. The worker receives no
GitHub credentials. No daemon, runner registration, repository setting, release,
comment or production record is created.

The publisher obtains the live CI attempt, exact commit and original
`gpu-request-ID-attempt` artifact from GitHub. It verifies the archive's recorded
digest, reads only its three fixed regular files without extraction, and compares
every request/trusted/READY byte with the selected local request. The source map
comes independently from Git objects. Controller, profile, verifier and actual
runner-helper hashes must match that admitted commit.

The bounded worker output must contain matching source-before/source-after checks,
runtime-before/runtime-after probes, an execution record and the raw Playwright
report. The execution record binds the request, source, four runner helpers,
sandbox binary and measured monotonic duration. `exclusiveBenchmarkLease` means
the controller held its nonblocking benchmark lock; it does not assert that the
founder's desktop GPU had no other consumer. Runtime values come from the actual
namespace probes. All five unchanged cases and raw timing assertions must pass
the current verifier before any publication begins.

After verification and a fresh live-attempt/expiry check, the publisher writes an
exclusive, synced intent file under the repository's Git common directory at
`venviewer-gpu-publications/ID-attempt-nonce.json`. This ledger prevents accidental
replay even if output directories are copied. It then creates one evidence Git
blob and one source-bound owner commit status. The status authenticates the
controller's execution evidence; it is not a claim of GitHub-hosted GPU hardware.

`publisher-evidence/` beneath the worker output retains the original archive,
bundle, verification, sanitized authentication record, durable intent and exact
publication responses. It never includes CLI stderr or ambient credentials.
The hosted waiter downloads and independently verifies the raw bundle before
its own check can succeed and retains it as a normal Actions artifact.

An existing intent or output evidence directory makes a repeated invocation fail.
If a POST response is uncertain, inspect that record and the actual GitHub state;
do not delete the intent and blindly retry. A blob uploaded after which the job
expires does not produce a success status. Provider failures remain failures.

Unit tests inject all GitHub operations and use expressly synthetic identity
envelopes. The archive tests operate only in memory. Neither unit success nor a
retained historical renderer report authorizes publication for a new nonce.
