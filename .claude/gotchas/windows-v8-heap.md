**Read this when:** diagnosing V8 memory failures, changing test-worker concurrency,
or adding TypeScript/test commands on Windows.

# Node memory and test contention

Historical runs exhausted the machine when several workspace suites launched
multiple large forks together. The root `pnpm test` command owns workspace-level
scheduling; use it rather than recreating a parallel recursive command in CI.

Inspect current Vitest configs. On 2026-09-06, the types/API suites use
`pool: "forks"`, `fileParallelism: false` and an 8192 MB worker heap; web uses
four workers with the same heap and a 20 s test timeout for expensive module
imports. Older `singleFork` recipes describe a previous Vitest API.

A child process needs its own heap setting. Adding a flag only to a wrapper
process does not configure its children. Preserve required limits in package
scripts/configs; a shell variable alone is not a reliable contributor default.

Diagnose the actual process, command, worker count and available memory before
raising limits. A configured maximum is not reserved memory, and V8 defaults vary
by runtime/machine. Test timeouts, process crashes and failing assertions are
different problems. Preserve the error and reproduce with controlled concurrency;
do not attribute an OOM to a hook merely because outputs interleave.

Do not run another full suite alongside an expensive suite merely to save wall
time. Use focused tests while iterating and coordinate broader verification.
