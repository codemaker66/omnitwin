# T-609 — concise product copy

Blake requested removal of unnecessary text throughout Venviewer. The change removes repeated headings, slogans, technical narration and redundant instructions from public pages, planning, Diary, inventory, administration, account screens, event operations, Hallkeeper and demos. Useful labels, recovery actions, access requirements, unknown-data distinctions, approval boundaries and fictional/example status remain.

## Source and integration

- Copy merge: `f93622b693491856354d21c176b726b7192ca29b`, relative to its second parent `7f2a701b4dade7d9d6048a82511ffa83cf4ff821`.
- Planner recovery follow-up: `b9fef22b5c82f0cdfc1c149ab244a9d959d13dd6`.
- Separate inherited test repairs: `1343687f2496937cfb7a004f04d7c5d64f2f296a`, already integrated by the release owner as `4e4a40c3`; do not duplicate this import.
- Published release `2805f78e` is merged without conflicts. New founder-requested Hallkeeper redesign work supersedes obsolete overlapping copy changes. The count label retains "manifest items" to distinguish setup-manifest units from floor-plan furniture footprints.
- The shared working tree was preserved. Work is isolated in `D:/claude/venviewer-copy-cleanup-20260907`.

## Verification

Web lint, source/E2E typecheck and a production-mode build passed. Nine Playwright accessibility checks passed across desktop, tablet and mobile: pricing, executive analytics and unavailable supplier portal. Actual local homepage, demo chapter navigation, planner recovery and Retry loading were visually checked. Independent reviews found no missing essential labels, broken accessibility references or unintended behavior changes in the copy delta.

The initial full suite reported 443 passing files and 15 failed assertions. Nine copy assertions were updated; their seven files passed all 97 tests. Six inherited furniture/model/role assertions were corrected separately; their three files passed all 27 tests. The final full attempt passed 452 files / 5,947 tests, with 16 skipped, but one worker exited unexpectedly. The missing unchanged `createLaptopProxy.test.ts` file was identified from the seven-test count and retained cache-duration evidence, and its isolated rerun passed all seven tests. Thus all 453 files are covered across completed runs; the failed full invocation is not described as green. After the final planner recovery edit, all 29 venue-routing tests, affected lint and whole source/E2E typecheck passed again.

A subsequent two-worker full rerun repeatedly stalled in worker startup and was stopped after confirming task-specific process identities. Its partial log is retained. A separate small Node experiment confirmed that a thread worker with empty `execArgv` inherits the parent's 8 GiB heap limit; the release owner used a compatible temporary thread config to complete its own missing-file checks. No product source or test expectations were weakened to address worker failures.

Local evidence is retained under `D:/claude/venviewer-copy-cleanup-20260907/output/playwright/`, including original failures, corrected focused runs, final full-run log, pre-rerun cache, isolated laptop result, terminated two-worker log and responsive browser results.

Final integration checks against the merged live release pass: all 16 Hallkeeper/Day Board tests, whole web source/E2E typecheck, lint and production-mode build. Source was frozen during these checks. The existing full CI E2E suite is not green on the incoming release; the nine affected responsive checks above do not claim to resolve that broader suite.

## Delivery

Production publication and the changed live-flow checks remain pending the active serial release. Local qualification is not deployment or founder aesthetic acceptance. The demo PDF, substantive legal text and real operational records were not rewritten by this copy change.
