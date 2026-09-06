# Demo Spark renderer teardown

Status: isolated implementation, CPU/build qualification and the coordinating agent's bounded furnished-planner browser check passed. No deployment performed. Full signed-in demo, visual acceptance and device qualification remain open.

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

## Coordinator browser verification

Frozen implementation: `e1970973a26ced396c92e8dd4d0579f51d05c6e4`. The coordinator ran the candidate at `http://127.0.0.1:5202` using the command above with port 5202, private Vite cache and the private patched Spark package. Vite's dependency metadata resolves Spark to `packages/web/node_modules/@sparkjsdev/spark/dist/spark.module.js`; its SHA-256 matches the patched ESM hash above. The application worktree was clean at the tested commit, and no source changed during the browser run. The resolved package path and hashes are also recorded in `combined-demo-check/source-provenance.json`.

The actual saved demo draft passed from **13:44:25 to 13:45:02 UTC on 6 September**:

- 144 actual chairs in both views, 18 round tables, shared target 150→155 and an 11-seat shortfall.
- Refresh preserves saved furniture and clears the session-only attendance target.
- Truth Mode clears the left blueprint sidebar; its rectangle begins at x=280, after the sidebar ending at x=260. The normal guest stepper works without minimizing the widget or forcing clicks. Screenshots were inspected. Other floating controls still crowd the planner; this does not establish overall design acceptance.
- Switching after capture readiness produces no teardown error. A fresh load was also switched to 2D in the `fallback` phase, before readiness; returning to 3D created a fresh renderer that reached `resolved`.
- **Zero page errors and zero attempted writes.** GET-only real API passthrough was used; the expected anonymous 401 responses remain recorded. No fake saved state or API data was supplied.

Evidence: `D:/claude/demo-rehearsal-20260906/combined-demo-check/result.json` and the three untouched screenshots in that directory. Harness: `D:/claude/demo-rehearsal-20260906/seating-check.mjs`, SHA-256 `4afd119bde4af20c23b12e4c1d20a68193f7a7165fa239fdca792e139983ad8b`. Original failed seating/teardown receipts remain under `seating-check/`.

This demo reliability fix does not establish device-wide performance, completed reconstruction, photographic PSNR, a complete signed-in demo or the broader all-source Grand Hall quality targets. No push, deployment, paid job, raw asset edit or reconstruction acceptance occurred.

## Bounded furniture movement rehearsal

On the same unchanged implementation, the coordinator also passed a real round-table group drag, single-gesture Undo/Redo, actual autosave, clean-context reopen and UI restoration from **13:51:27 to 13:51:58 UTC**. Server readback showed the table and eight chairs moving uniformly by 0.462 m / 0.294 m, the other 153 objects unchanged, and original positions restored at draft revision 9. Only two writes were allowed in the successful run, both HTTP 200 to the exact labelled demo draft's batch-save endpoint. Zero page errors and attempted out-of-scope writes occurred. Expected anonymous 401s remain recorded.

The earlier run also saved and restored, but its save-boundary SVG comparison was tighter than PostgreSQL's `numeric(8,3)` coordinate precision. Original failures are preserved. A harness-only correction permits the half-millimetre rounding bound at that boundary, while unsaved Undo/Redo, radius and clean-reopen checks remain strict. The successful rerun recorded actual rounding of 0.2711 mm / 0.1727 mm; no application code was changed. Across both runs, four additional saves affected only this demo draft, and all original object content was restored.

Evidence: `D:/claude/demo-rehearsal-20260906/group-drag-combined-precision/`, including whitelisted original/moved/restored object snapshots, observed SVG comparison receipts, screenshots and `result.json`. Earlier failure: `group-drag-combined/`. Harness: `group-drag-rehearsal.mjs`, SHA-256 `e25004b708641a2264a0291ce5324ffa7de9aa5a01932b095daeba8e65a67faf`.

This covers one round-table group gesture in 2D and its persisted state, not all object types, 3D dragging or metric survey accuracy. Both test harnesses closed their browsers. The coordinator stopped the verified owned Vite process on port 5202 after the final run; other sessions were not stopped.
