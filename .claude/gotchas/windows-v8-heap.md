# Windows / V8 heap gotchas

**Read this when:** adding or modifying a `vitest.config.ts`, writing a new `typecheck` script, or seeing `MemoryExhaustion` / OOM errors during `tsc --noEmit`, `vitest run`, or `pnpm -r run …` on Windows.

---

- **`MemoryExhaustion: Crash intentionally because memory is exhausted.`** is
  V8's native `FatalProcessOutOfMemory` handler text. It is emitted by Node
  itself, not by any hook. If you see it during `tsc --noEmit`, `vitest run`,
  or `pnpm -r run …`, you are hitting V8's ~1.7 GB default heap limit, not a
  plugin assertion. The hook dir does **not** contain a `MemoryExhaustion`
  assertion — audited 2026-04-17.
- Heap bumps are already pinned where they matter and should stay pinned:
  - `packages/{types,web,api}/vitest.config.ts` — `pool: "forks"` +
    `execArgv: ["--max-old-space-size=8192"]`. `types` and `api` also use
    `singleFork: true` to serialise heavy suites.
  - `packages/api/package.json` — `"typecheck": "node --max-old-space-size=8192
    node_modules/typescript/bin/tsc --noEmit"`. **Do not** wrap tsc in a
    `node -e execSync(...)`; the heap flag only applies to the outer Node
    process and is lost when tsc is spawned as a child.
- If you add a new vitest package, copy the `pool: "forks"` +
  `execArgv: --max-old-space-size=8192` block. Do **not** rely on setting
  `NODE_OPTIONS` in a shell — contributors on Windows running scripts directly
  will skip the env var and hit the same OOM. Bake it into the config.
- No hook is wired to `PostToolUse: Read` in this project. Red-herring errors
  that appear to correlate with parallel Reads are Bash-side OOMs from a
  neighbouring tool call (typically `pnpm test` / `pnpm typecheck`) whose
  stderr interleaves with concurrent tool output.
