# Browser release verification

The reviewed browser inventory has 359 cases. Four hosted CPU shards execute
354 cases; the five Twin performance cases execute on the existing RTX 4090
through WSL D3D12. The final hosted job reconciles every case against the
reviewed inventory, including the original skips and expected failures.

**GPU scope (Blake, 26 September 2026).** The GPU run is required only when a
change can reach what it measures: the renderer, the tour, the benchmark and
the toolchain that serves them. `gpu-scope.mjs` holds the rules; its tests list
examples on both sides. A change it cannot compare with a base commit is always
in scope. Inside the scope, the final job requires both paths, and a missing GPU
result is a failed gate, never an exemption. Outside it, the GPU job is skipped
and the final job requires the complete CPU partition. It records the five GPU
cases as not in scope, never as passed (`cpu-browser-gate-passed-gpu-not-in-scope`).
The final job makes the scope decision again on its own and fails if it
disagrees with the scope job. Shared code outside these rules, such as the
application shell and global styles, can still move the Twin byte budgets. Such
a regression surfaces at the next in-scope run.

The original 353 identities, 42 skips and four expected failures are retained.
The 2026-09-24 admission adds three ordinary Hallkeeper regressions: approved
sheet load failure and retry, approved PDF failure invalidating printable
contents, and a successful non-PDF response being rejected. The 2026-09-26
admission adds three ordinary staff Enquiries regressions (T-632, T-633):
newest-first paging with its total, the pre-ordering API fallback, and triage
beside the list.

**Reviewed benchmark.** `source_manifest.py` and `verify-receipt.mjs` pin the
SHA-256 of `packages/web/e2e/twin-performance.spec.ts`, and
`fixtures/pinned-twin-performance.spec.ts` holds the same bytes. Any benchmark
change needs a reviewed re-pin of all three. On 26 September 2026 Blake approved
the re-pin to `3560350f52bc0db11331a545d07df87d55ba86cdef9426b719b4a0a6fa3a2d15`.
The self-hosted fonts change (`777e3985`) had replaced the benchmark's blocks on
Google's font hosts with a block on the self-hosted `.woff` and `.woff2` files,
so the byte budgets keep measuring what they were set on. This benchmark version
has no GPU evidence yet; the next in-scope run supplies it. The baseline's
`inventoryAdmissions` records their exact source and listing provenance;
the historical `sourceRunId` and `sourceReports` do not claim to have executed
these additions. A listing enumerates identities only: test-body `test.fail`
and conditional `test.skip` statuses remain pinned to their reviewed execution
policy, and the final gate still requires every current case to execute with
its expected status.

The GPU profile is an observed reference workstation, not qualification of an
iPhone, iPad, ordinary office PC, photographic reconstruction or aesthetic
acceptance. Frame intervals measure renderer submissions and RAF, not physical
display presentation. All original pixel sizes, fixtures and limits remain.

## One explicitly admitted local run

This is an operator-invoked, temporary process. No self-hosted GitHub runner,
daemon, GitHub App, rented GPU or branch-protection change is required. The
operator must be available while the hosted request is pending. Future runs
without an available operator expire and fail; this is not an unattended service.

1. Inspect the current CI run and the actual checkout SHA in the early
   `gpu-request-RUN_ID-RUN_ATTEMPT` artifact. Pull requests use the merge checkout,
   which can differ from the PR head. Admit that exact reviewed source explicitly.
2. Download the named artifact into a fresh request directory using `gh run
   download`. Preserve `request.json`, `trusted.json` and `READY.json` exactly.
3. Fetch the exact Git object into the local repository and independently run
   `source_manifest.py --repo REPOSITORY_PATH --commit FULL_SHA`. Confirm the
   source map matches the request. Create a fresh native Linux workspace with
   `git -c core.autocrlf=false archive`; do not reuse a mutable development tree.
4. Install the frozen dependencies and build outputs from that reviewed source
   with pnpm 9.15.4 and Node 22.23.2, using the existing offline pnpm store and a
   clean environment. Dependency preparation is a separate trusted operator
   step; it is not execution inside the browser sandbox. Retain its log. Only
   the two declared shared-package build directories and build-info files are
   permitted alongside tracked source and dependencies.
5. Run the prepared checkout's `.github/gpu/run-worker.py` with explicit
   `--workspace`, `--request-dir`, new `--output`, `--bwrap`, `--browser-cache`,
   `--pnpm` and `--lease` paths. Serialize benchmark work on this workstation.
   `--pnpm` is the self-contained installed 9.15.4 tool directory, not its binary.
   Use the same lease for every participating local benchmark controller.
6. Inspect the retained log, source checks and actual before/after runtime
   observations. Run `publish-result.mjs` with the explicit request/output/repo,
   run ID, attempt and admitted source SHA. It independently authenticates the
   original artifact and source, checks raw results, then publishes the bounded
   evidence blob and owner-authored commit status. Credentials stay in this
   controller and are never passed into the worker.
7. Wait for the hosted GPU verification and final complete-inventory gate.
   Preserve their normal Actions artifacts. An unreferenced Git blob is only
   the transport; its indefinite retention is not assumed.

The worker requires the reviewed Ubuntu bubblewrap 0.9.0 binary with SHA-256
`52231e1caf55bcbc667b269f49c63599a6f7db4767ae6a039580d0ff853db712`.
The qualification used the Ubuntu `bubblewrap_0.9.0-1ubuntu0.1_amd64.deb` package
downloaded and extracted into a temporary directory, without system installation.
Its archive SHA-256 is
`1b506492bd9c7fd0cdb4f02ac822f1d3e336b0aead5113c1239baf8db5db562a`.

## Boundaries and evidence

The browser gets new user, process, network, IPC, UTS and cgroup namespaces;
read-only source/dependencies/tools; private writable caches/results; a private
Xvfb display; and `/dev/dxg`. External networking, host sockets, home directories,
mounts and credentials are absent. The process drops capabilities and cannot
create nested user namespaces. GPU access still exposes the graphics driver.
This is a specific tested boundary for reviewed source, not proof against every
host-kernel vulnerability.

Namespace UID 65534 maps to host UID 0 in the measured WSL setup. Isolation
comes from the mounts, namespaces and capability policy; this is not a separate
unprivileged host account. `exclusiveBenchmarkLease` and receipt `exclusive`
mean that participating benchmark controllers use one nonblocking lease. They
do not assert that the host desktop or every unrelated GPU process is absent.

The full source map and actual runner helper hashes are checked before and after
execution. Runtime probes observe Chromium, Playwright, Node, OS/kernel, driver,
renderer and a WebGL pixel readback; the profile supplies expectations only.
An outer timeout bounds execution and the private namespace owns child cleanup.

Receipt v2 keeps wall timestamps for recorded-start freshness and uses measured
monotonic durations for elapsed-time checks. Playwright reports these clocks
separately. It does not infer a wall-clock end by adding monotonic duration to a
wall start. The controller must record elapsed time during the actual run;
historical missing measurements must never be invented.

The operator status authenticates an execution assertion, not hardware remote
attestation. The hosted verifier independently checks the exact report, request,
source, actor, run/attempt, nonce, expiry and raw performance observations. A
durable publication intent prevents blind retries after an uncertain GitHub
write. Inspect retained responses before resolving an interrupted publication.

These are mandatory CI workflow dependencies and the release procedure. They
do not claim that GitHub server-side rules prohibit every direct branch push.
See [hosted protocol](HOSTED_GATE.md) for the request and evidence formats.
