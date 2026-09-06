# Demo seating counts: shared 2D/3D meanings

Status: implementation and CPU regression checks complete; coordinating agent owns the pending real planner browser check. No deployment performed.

Worktree: `D:/claude/venviewer-demo-seating-20260906`

Branch: `codex/demo-seating-counts`

Base: `ae1accae57f44aee55371535e28000133ffbac41`, the isolated furniture-lighting fix. The lighting GPU evidence update was cherry-picked as `b004554d`. Dirty main and other workers' worktrees were preserved.

## Problem and resulting behavior

The real demo draft contains 18 tables and 144 placed chairs. Its 3D seating count was 144, but the 2D view displayed Guests 1,620 from `objects.length * 10`, and Seats 180 from the tables' nominal catalogue capacity.

The live blueprint now reports **Seats placed 144**, counted from actual chair objects through the same catalogue/category tally used by the 3D seating helper. Loose chairs and chairs in rectangular-table or shared groups each count once. Bare tables provide zero placed seats. The live scene records an explicit chair total, so a zero total cannot fall back to nominal table capacity.

Table figures retain their separate catalogue meaning and are labelled as capacity in the live diagram, inspector, and layers. A missing catalogue capacity is omitted instead of labelled zero. The standalone blueprint editor retains its authored seat-plan semantics. An authoritative empty chair list now draws no synthetic chair ring around a bare table.

2D reads and changes `cockpit.plannedGuestCount`, the same field used by the 3D Guests/Flow/Costs/Share views. An unset target displays **Not set**. The stepper respects the existing maximum guest-flow count and clears the target when decrementing to zero. No attendance is inferred from furniture.

An unset target no longer produces an inspector denominator such as `18 / 0 placed`; it displays `18 placed`.

## Guest target lifecycle

The guest target remains **session-only**. It is not added to configuration saves or anonymous-draft persistence, and a full page reload does not restore it.

The target survives 2D/3D view changes, component remounts, furniture edits, undo/redo, same-configuration reloads, and failed loads/creation. A committed change to a different configuration ID clears only the target. An explicit editor reset also clears it, including when the configuration ID is already null. Other cockpit state, including Splat/Hybrid mode, is preserved.

This follows the editor's committed configuration boundary. Existing configuration loading has no latest-request token; this change does not establish protection against out-of-order requests.

## Verification

Eight new regressions first ran against baseline: **8 failed, 105 passed** across four files. After implementation and the two review corrections, **160 tests passed** across eight focused suites:

- `blueprint-from-store`: actual 18-table/144-chair result, shared input with the actual 3D Guests panel, remounts, chair undo/redo, bare-table rendering, capacity labels, unknown capacity, unset target inspector.
- Blueprint adapter and geometry: loose/shared/rectangular-table chairs, no duplicate tally, exact zero handling, preserved standalone authored-seat behavior.
- Editor store/history/recorder: successful different configuration and new-draft boundaries, failed operations, same-configuration reload, explicit reset, preserved furniture history.
- Shared seating helper and existing 3D Guests panel behavior.

Commands from `packages/web`:

```powershell
pnpm exec vitest run src/__tests__/blueprint-from-store.test.tsx src/lib/blueprint/__tests__/adapt.test.ts src/lib/blueprint/__tests__/geometry.test.ts src/__tests__/editor-store.test.ts src/lib/__tests__/seating-counts.test.ts src/components/editor/cockpit/__tests__/GuestsLensPanel.test.tsx src/stores/__tests__/editor-store-history.test.ts src/stores/__tests__/editor-store-recorder-reset.test.ts --maxWorkers=2
pnpm exec tsc --noEmit
pnpm exec tsc -p e2e --noEmit
pnpm exec eslint src/lib/seating-counts.ts src/lib/blueprint/types.ts src/lib/blueprint/adapt.ts src/lib/blueprint/geometry.ts src/stores/editor-store.ts src/pages/BlueprintPage.tsx src/__tests__/blueprint-from-store.test.tsx src/lib/blueprint/__tests__/adapt.test.ts src/lib/blueprint/__tests__/geometry.test.ts src/__tests__/editor-store.test.ts
pnpm exec vite build --mode test
```

Both TypeScript checks and changed-file ESLint passed. The test-mode bundle build passed with the existing unrelated unmatched CSS brace warning; no CSS is changed here. Test mode avoids production environment enforcement and Sentry uploads, so this is a local compiled-bundle check.

Independent read-only review identified the unset-target inspector denominator; the correction and missing-capacity handling received a focused final review with no remaining blocker. `git diff --check` passed.

The implementation agent ran no browser or GPU sessions. The coordinator's initial run passed the count assertions but failed overall on widget obstruction and Spark teardown; those original receipts remain preserved. The combined candidate `e1970973` subsequently passed the actual-draft count, shared-target, refresh, widget and renderer-transition checks with zero page errors and attempted writes. See [the combined browser receipt and limits](demo-spark-teardown-2026-09-06.md#coordinator-browser-verification). No asynchronous UI changed here, so no Activity component work was required.

## Local browser handoff

From `D:/claude/venviewer-demo-seating-20260906/packages/web`:

```powershell
$env:VITE_API_URL='https://api.venviewer.com'
$env:SPLAT_STAGING_ROOT='D:/claude/splats'
& 'C:/Users/blake/AppData/Roaming/npm/pnpm.cmd' exec vite --host 127.0.0.1 --port 5199 --strictPort
```

Use the existing actual draft `/plan/3b18bfc3-4a40-4723-8130-13134c80e16e?space=grand-hall&capture=1` with GET-only API passthrough and blocked writes. Compare the 3D placed seating metric to the 2D footer, then set the guest target in one view and confirm it in the other. No object changes are required for this browser check.

The numeric tally includes all physical chairs. Existing 2D drawing coverage for loose and rectangular-table chairs is separate from this counting correction. Nominal table capacity remains catalogue data, not a newly verified occupancy claim.

No push, deployment, paid job, raw asset edit, or reconstruction acceptance was performed.
