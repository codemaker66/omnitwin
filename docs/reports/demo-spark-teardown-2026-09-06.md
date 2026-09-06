# Demo Spark renderer teardown

Status: isolated implementation and CPU/build qualification complete; the coordinating agent owns the final furnished-planner browser check. No deployment performed.

Worktree: `D:/claude/venviewer-demo-spark-teardown-20260906`

Branch: `codex/demo-spark-teardown`

Base: `63150e0601427c877f91c36cda5e5d73b445ddcf`, containing the furniture lighting and truthful seating/shared attendance fixes. The Truth Mode widget placement fix is included by cherry-pick `021bf7b9` (original `a0274603`).

## Observed failure and bounded repair

The real furnished draft passed the seating, shared attendance, and reload assertions, but its browser run recorded two unhandled `Error: Worker terminate` failures during 2D/3D switching. The original evidence remains at `D:/claude/demo-rehearsal-20260906/seating-check/result.json`.

`SparkRendererMount` already disposes its owned renderer on unmount. Pinned Spark 2.1.0 terminates its sort worker during disposal, rejecting pending sort RPCs, while its asynchronous sort/update chain can still be running. The error escapes that chain. This is a renderer lifecycle defect, separate from the seating changes.

The [official Spark renderer documentation](https://sparkjs.dev/docs/spark-renderer/) describes awaiting `update()` for sorting. In the installed 2.1.0 implementation this is not a disposal barrier: a concurrent sort returns immediately, a throttled sort can schedule a timer and return, and LOD work starts independently. Its public API has no drain/cancel operation.

The version-pinned pnpm patch changes the published ESM and CJS implementations:

- Mark disposal first and make it idempotent. Stop scheduled update/sort work and cancel owned pause timers. Guard entrypoints and asynchronous continuations against restarting work.
- Identify worker disposal with an internal error class. Handle only that class for an already-disposed renderer. Ordinary errors, including a different error with identical `Worker terminate` text, still propagate.
- Keep GPU targets alive until the actual readback settles. Readback waits for every started layer, including when another layer rejects or scheduling throws. Then release resources once. Three 0.180's fence probe rejects on `WAIT_FAILED`; the error path also releases retained targets and preserves the failure. No arbitrary delay or global error filtering is added.
- Handle owned LOD cancellation and prevent late mapping, texture, pager, or dirty-state writes. Snapshot existing LOD texture entries before clearing their map so they are actually disposed.

The captured stack establishes the sort RPC failure. LOD/readback cases are adjacent lifecycle regression coverage, not additional observed production incidents. The patch leaves rendering parameters, shaders, splat data, quality budgets, lighting, and application loading UI unchanged. No Activity surface changes were required.

## Verification and dependency isolation

Two targeted tests first failed against the original package: pending sort disposal rejected with `Worker terminate`, and existing LOD textures were disposed zero times. The private patched package then passed **16 real-method lifecycle regressions**, plus **27 existing Spark layer, version-stack, and Truth Mode widget tests**. These use the actual vendor renderer/worker lifecycle with controlled browser-worker and GPU-fence seams. They cover pending and already-resolved RPC continuations, all owned sort timer stages, multi-layer readback failures, genuine error propagation, idempotence, and a fresh renderer after disposal.

Web and e2e TypeScript checks, changed-test ESLint, and the test-mode Vite build passed. The build retains the existing unrelated unmatched CSS brace warning. It is a local bundle check, without production environment enforcement or Sentry upload. Independent read-only review found no blocking issue in the patch, lock metadata, or regression approach.

Commands from this worktree's `packages/web`:

```powershell
pnpm exec vitest run src/lib/__tests__/spark-renderer-lifecycle.test.ts src/components/scene/__tests__/SparkSplatLayer.test.tsx src/__tests__/spark-stack.test.ts src/components/truth/__tests__/TruthModeIndicator.test.tsx --configLoader runner
pnpm exec tsc --noEmit
pnpm exec tsc -p e2e --noEmit
pnpm exec eslint src/lib/__tests__/spark-renderer-lifecycle.test.ts
pnpm exec vite build --mode test --configLoader runner
```

Root and web `node_modules` are real private directories; most installed packages are read-only junctions to the existing dependencies. `packages/web/node_modules/@sparkjsdev/spark` is a full private copy. Its two patched bundles reproduce byte-for-byte when applying the committed patch to pristine copies. Main's original Spark bundle hashes remain unchanged. No install, shared dependency mutation, or global pnpm store mutation was performed.

The patch is `patches/@sparkjsdev__spark@2.1.0.patch`, recorded in root `package.json` and `pnpm-lock.yaml`. Its pinned pnpm 9.15.4 hash is `rpe4mc35qirg33qd3svi2m4rie`; the registry package integrity remains unchanged. Metadata was derived from the pinned pnpm implementation and independently checked. A fresh package installation was not run against the shared dependency tree.

| Bundle | Original SHA-256 (main unchanged) | Patched SHA-256 (reproduced) |
| --- | --- | --- |
| ESM | `c0355a962f68a6de9b13df69f05b1aba3614d9aec43a4504975daeb349126a8a` | `c50bf3a15abd2977adc390d2b44569350dc21c339b021f2a804b224aea023a1d` |
| CJS | `40da75bd710cdcf5543adbed8c34edcb1bf24dffbb8bdcfa84bdadfec06b49ca` | `1b5bfa04c3f50538e57952dd1677b8d3a893e4c9f26ad613243b5b9f763afff7` |

Local verification JSON and the baseline failure log are retained under this worktree's ignored `node_modules/.spark-patch-baseline/`. The vendor dependency patch should be revisited when upgrading Spark; these lifecycle regressions should remain until equivalent upstream behavior is qualified.

## Frozen browser handoff

The current worktree must use `--configLoader runner`. This avoids the existing shared `.vite-temp` junctions; the web `.vite` cache is private. No browser or GPU session was started by the implementation agent.

```powershell
Set-Location 'D:/claude/venviewer-demo-spark-teardown-20260906/packages/web'
$env:VITE_API_URL='https://api.venviewer.com'
$env:SPLAT_STAGING_ROOT='D:/claude/splats'
& 'C:/Program Files/nodejs/node.exe' './node_modules/vite/bin/vite.js' --configLoader runner --host 127.0.0.1 --port 5201 --strictPort
```

Use `/plan/3b18bfc3-4a40-4723-8130-13134c80e16e?space=grand-hall&capture=1` with the existing GET-only actual API passthrough and blocked writes. Remove the previous Truth Mode **Minimize** workaround; use the exposed 2D guest stepper. Recheck actual seating, shared guest target, settled 2D/3D switches, a short switch while the capture is loading, and refresh, while retaining page-error collection.

Browser acceptance remains pending. This demo reliability fix does not establish device-wide performance, completed reconstruction, PSNR, or the broader all-source Grand Hall quality targets. No push, deployment, paid job, raw asset edit, or reconstruction acceptance occurred.
