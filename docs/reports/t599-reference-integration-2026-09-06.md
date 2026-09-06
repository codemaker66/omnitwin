# T599 integration with the reference viewer — 6 September 2026

This is a private, locally verified integration candidate. It combines the
reference viewer at `2e55e2093f25f58b5f26b1370573b4c4b651b140` with the verified T599
application delta `5c60a0dec98fb895b960f8307470afaf8f01a448`. It has not been pushed,
deployed, signed into with a production account, or browser-qualified as a combined
candidate. The deployment freeze remains in force.

Worktree: `D:/claude/venviewer-t599-reference-integration-20260906`, branch
`codex/t599-reference-integration`. Receipts and original failures are preserved at
`D:/claude/venviewer-t599-integration-evidence-20260906`.

## What the integration preserves and changes

The API changes recheck claim and anonymous-thumbnail eligibility at the write,
serialize quote additions and recheck editability after the row lock, and commit
proposal version allocation and its snapshot in one transaction. Dashboard and
calendar changes retain request ownership, real working states and cancellation.
T599 also updates the pinned dependency graph, Node types, workspace scheduling,
CI and local Playwright configuration.

There were ten cherry-pick conflicts: eight dashboard/calendar source and test
paths, plus the root manifest and lockfile. All eight source/test paths were
unchanged between the common baseline `dbdcdec0` and the reference viewer base.
Their complete verified T599 versions therefore preserve the viewer's behavior.
The receipt checks those facts and their final contents, rather than assuming a
whole-file resolution is safe. Two small Activity-state prerequisites from T599's
parent were also required: `useCalendar.ts`'s actual refreshing state and
`ConfirmModal.tsx`'s busy presentation. Shared Activity files were already identical.

The reference viewer's event/bootstrap, session/save, drag/remap, camera/tour,
source-provenance, frozen-preview and hallkeeper source paths are unchanged by this
integration. The independent source reviewer verified the conflict resolutions,
prerequisites, patch composition and installed Spark files. That review did not
substitute for the test runs below.

## One reproducible Spark patch

Spark remains at 2.1.0 with Three 0.180.0. pnpm permits one patch for that exact
Spark version, so the original lifecycle patch and T599's embedded ZIP64 fix are
composed into `patches/@sparkjsdev__spark@2.1.0.patch`. The redundant security-only
patch is not selected. Its original remains in the T599 commit.

Both application orders were tested against pristine distribution files and
produced identical ESM and CommonJS outputs. The combined patch is LF-normalized;
its installed outputs match those composed bytes exactly. The repository's real
Spark lifecycle and ZIP64 regressions pass.

| Artifact | SHA-256 |
| --- | --- |
| Combined patch, 9,417,651 bytes | `9b79df4d4540071b6a784c3d3aa52556c9bbbf208618b09b080074e947471835` |
| Installed `spark.module.js` | `f97adab5edf06c8a754311a49ee0a0c64b7daae54607e1bdf6b38529439d571c` |
| Installed `spark.cjs.js` | `31e78f7b418477214789f42992bf1be671f5a9fca12074687cd66dff77c01e68` |

The pnpm 9 patch hash is `bdnakpe5oiep5uzksirp72ypou`. Relative to the verified T599
lockfile, only the selected Spark patch path/hash references change.

## Independent dependency installation

All nine relevant module directories were absent before installation. The root
and package module directories and `.pnpm` virtual store are private to this
worktree. No install followed a junction into main or another running candidate.

```powershell
pnpm install --lockfile-only --offline --ignore-scripts --store-dir D:/.pnpm-store
pnpm install --offline --frozen-lockfile --store-dir D:/.pnpm-store --package-import-method=copy
```

The frozen install reused 797 packages with zero downloads and completed in
3m13.4s, including its local package-build postinstall. Runtime versions were
Node 22.18.0, pnpm 9.15.4, Fastify 5.12.1 and `@types/node` 22.20.1. Main and the
reference viewer's existing installed dependencies remain untouched.

The ignored generated Trades Hall public manifest required by existing tests was
copied from the verified T599 worktree, with SHA-256
`29c21bbf6031a13c8e79037da4dd4ea30ea972f5bab9c02086ffb138af572be2`.
It is not a newly invented fixture and is not included in the commit.

## Verification

All final checks below passed on the combined source and private dependency graph.
The earlier failures are retained separately; they are not erased by the reruns.

| Check | Result |
| --- | --- |
| `pnpm -r run typecheck` | All eight workspaces pass, including web/E2E and API |
| Full API `pnpm test` | 161 suites pass; 2,807 tests pass, 34 skipped; 589.64s |
| Explicit isolated PostgreSQL route regression | 13/13 pass; 21.43s |
| Initial full web suite | 5,460 pass, one stale source-shape assertion fails, two skipped |
| Relevant verification-harness and actual lighting regressions | 38/38 pass across three suites |
| Final full web suite | All 411 suites and 5,463 tests pass; 272.09s |
| `pnpm -r run lint` | All eight workspaces pass |
| Final test-harness scoped lint | Both repaired test files pass |
| `pnpm -r run build` | All configured workspace builds pass |

Two test-only repairs were needed; no rendering or authorization behavior was
changed to make the checks pass. The Playwright-config hook now allows 20s around
its unchanged 15s child-process deadline; the old 10s hook expired while a cold
Windows child was still running. The room-mesh test now checks the existing
centralized `RoomLighting` owner introduced by the reference viewer's earlier
lighting fix, rather than an obsolete inline-light source string. Its real
`PlannerSceneLighting` behavior tests pass too. The original failed logs remain
beside the final receipts.

The PostgreSQL fixture was newly initialized in the evidence directory, bound
only to `127.0.0.1:55476`, and used the exact disposable database
`venviewer_route_atomicity_test`. The full API run enabled it, then an explicit
verbose rerun documented all 13 real row-lock, concurrent-version, rollback and
late-write cases. It derives its selected table columns from the real schema and
removes its own random test schema. This does not qualify all migrations or
foreign keys. The owned server was stopped after matching its recorded PID and
data directory; its receipts and data are preserved. Other opted-out database
suites remain skipped rather than consulting an ambient database.

The production-mode compilation used the repository CI placeholder
`pk_live_localbuildcheck`; it is not a usable real-account demo build. No production
credentials were read and no production data, emails, jobs or deployments were
triggered. This integration did not rerun the upstream online dependency audit
or Linux CI. Its lockfile security versions match the verified T599 graph except
for the composed Spark patch described above.

## Next verification boundary

Use this genuinely private installed graph for combined UI qualification, or
create a new independent install from its committed lockfile. Do not upgrade the
running viewer through its shared module junctions. The parent task still owns
browser verification of the combined dashboard/calendar/viewer flows and the
decision about any eventual release. This report makes no frame-rate, geometric
registration, PSNR, aesthetic-acceptance or production-readiness claim.
