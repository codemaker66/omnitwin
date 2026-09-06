# Planner tour after a demand-loop idle — 6 September 2026

Local camera fix based on `99be4373`, independently reviewed and verified in the real CameraRig/OrbitControls fixture. The captured-room browser tour still requires root's new qualification; this report does not claim it passed.

## Reproduced failures

Root's preserved browser observation is `D:/claude/reference-viewer-20260906/captured-tour-observation-2056.json`. Source reproduction established both boundaries: a first frame carrying a 20-second demand-loop idle delta immediately advanced the 13.2-second tour to its end, and the synchronous Walk-to-tour handoff restored an old orbit pose 20.126 metres away before the tour sampled its first pose. Three initial regressions failed while the nine existing CameraRig showcase cases passed.

## Change

CameraRig establishes a first rendered frame for each tour start, new path or explicit rewind. It samples that frame without charging pre-playback idle time, then advances with subsequent real frame deltas. Controls become disabled synchronously when a tour starts, before Drei's earlier update. When the planner yields Walk to an already active tour, the rig preserves the current interior pose instead of briefly restoring the old orbit pose. Ordinary Walk exit still restores its saved planning pose.

The source slice changes only CameraRig and its focused fixture. It does not change the path, declared tour duration, captured source, runtime fidelity, preview geometry, store authorization or browser behavior through test-only hooks. Existing preview suspension and Escape/source-loss recovery remain covered.

## Verification and handoff

**36/36 tests passed** across CameraRig showcase and source guards, planner showcase ownership, tour progression and real controls application. New assertions cover the cold first frame, continuing camera movement and elapsed duration, completion, immediate Walk handoff, Escape/restart, path replacement and rewind. Web and E2E TypeScript, changed-file ESLint, `git diff --check` and the Vite test-mode build passed. Independent source review found no material blocker.

Receipts are under `D:/claude/venviewer-tour-idle-20260906/`: `tour-idle-baseline-red.json`, `tour-idle-first-green.json` (one strict floating-point comparison corrected to the fixture's existing 1e-10 tolerance), `tour-idle-final-tests.json`, `tour-idle-typecheck.log`, `tour-idle-e2e-typecheck-final.log`, `tour-idle-lint.log`, and `tour-idle-build.log`. The initial E2E command used a nonexistent config name; its failure is retained in `tour-idle-e2e-typecheck.log`, and the actual package-script target `tsc -p e2e --noEmit` passed.

Root should repeat the captured tour after a long settled demand-loop idle and record actual camera positions throughout playback, no pre-tour orbit flash, normal completion and Escape. Rendering and visual acceptance remain unclaimed. No browser, API, fixture, external-delivery or production changes were made here.
