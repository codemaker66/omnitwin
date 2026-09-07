# T-609 — concise product copy

Blake requested removal of unnecessary text throughout Venviewer. The change removes repeated headings, slogans, technical narration and redundant instructions from public pages, planning, Diary, inventory, administration, account screens, event operations, Hallkeeper and demos. Useful labels, recovery actions, access requirements, unknown-data distinctions, approval boundaries and fictional/example status remain.

## Source and integration

- Copy merge: `f93622b693491856354d21c176b726b7192ca29b`, relative to its second parent `7f2a701b4dade7d9d6048a82511ffa83cf4ff821`.
- Planner recovery follow-up: `b9fef22b5c82f0cdfc1c149ab244a9d959d13dd6`.
- Separate inherited test repairs: `1343687f2496937cfb7a004f04d7c5d64f2f296a`, already integrated by the release owner as `4e4a40c3`; do not duplicate this import.
- Published release `2805f78e` is merged without conflicts. New founder-requested Hallkeeper redesign work supersedes obsolete overlapping copy changes. The count label retains "manifest items" to distinguish setup-manifest units from floor-plan furniture footprints.
- Subsequent release `3b1d3389` is preserved, including email verification, account-settings recovery, fresh-token retry and authoritative API access. Conflicts were resolved semantically; the shorter account headings do not change those controls or conditions.
- The shared working tree was preserved. Work is isolated in `D:/claude/venviewer-copy-cleanup-20260907`.

## Verification

Web lint, source/E2E typecheck and a production-mode build passed. Nine Playwright accessibility checks passed across desktop, tablet and mobile: pricing, executive analytics and unavailable supplier portal. Actual local homepage, demo chapter navigation, planner recovery and Retry loading were visually checked. Independent reviews found no missing essential labels, broken accessibility references or unintended behavior changes in the copy delta.

The initial full suite reported 443 passing files and 15 failed assertions. Nine copy assertions were updated; their seven files passed all 97 tests. Six inherited furniture/model/role assertions were corrected separately; their three files passed all 27 tests. The final full attempt passed 452 files / 5,947 tests, with 16 skipped, but one worker exited unexpectedly. The missing unchanged `createLaptopProxy.test.ts` file was identified from the seven-test count and retained cache-duration evidence, and its isolated rerun passed all seven tests. Thus all 453 files are covered across completed runs; the failed full invocation is not described as green. After the final planner recovery edit, all 29 venue-routing tests, affected lint and whole source/E2E typecheck passed again.

A subsequent two-worker full rerun repeatedly stalled in worker startup and was stopped after confirming task-specific process identities. Its partial log is retained. A separate small Node experiment confirmed that a thread worker with empty `execArgv` inherits the parent's 8 GiB heap limit; the release owner used a compatible temporary thread config to complete its own missing-file checks. No product source or test expectations were weakened to address worker failures.

Local evidence is retained under `D:/claude/venviewer-copy-cleanup-20260907/output/playwright/`, including original failures, corrected focused runs, final full-run log, pre-rerun cache, isolated laptop result, terminated two-worker log and responsive browser results.

Final integration checks against the merged live release pass: all 16 Hallkeeper/Day Board tests, whole web source/E2E typecheck, lint and production-mode build. Source was frozen during these checks. The existing full CI E2E suite is not green on the incoming release; the nine affected responsive checks above do not claim to resolve that broader suite.

After the `3b1d3389` auth merge, isolated original-config runs pass all 11 workspace-access tests and all 24 auth-component tests. A prior thread run hit a dashboard-module import timeout and worker-response timeout; its failed evidence is retained. The isolated dashboard import then passed in 3.3 seconds with the unchanged 20-second timeout. Final source/E2E typecheck, affected lint and production-mode build pass again. The inherited runtime and dependency targets match; measured host paging/startup delays support an execution slowdown rather than a reproduced auth defect.

## Delivery

Published source `54f4dc5a6b14990e5d74f13d9a813e01b82e95c0` preserves the final `fbc6cb9e` release ancestry. Its 127 changed paths contain only web source/tests and four documentation files. Independent review confirms no API, shared types, auth-store, manifests, deployment configuration or migration delta; ClerkAuthBridge is identical to the incoming auth fix. The exact clean-source build passed using the current public Clerk frontend and API origin with E2E bypass disabled.

Vercel Production deployment `6315730961` succeeded. The authenticated provider overview independently confirmed Ready, Production Current, `venviewer.com` and the exact source. Public entry is `/assets/index-C3g5BLPx.js`, CSS `/assets/index-DNroCu9R.css`; API remains ready at `7f2a701b`. The generated deployment URL is protected, so no unauthenticated provider/public HTML equivalence is claimed.

Actual production browser checks passed on the homepage, inventory, client access page, Diary and its help disclosure, existing approved Hallkeeper sheet, existing 162-object 3D planner, demo chapter navigation and fictional walkthrough. The sheet still distinguishes 288 manifest items from 162 furniture footprints, with all 43 setup checks observed unchecked. No operational records, invitations, grants, approvals or messages were changed. Screenshots and accessibility trees are retained in the originating task; durable observations and build/provider receipts are under `D:/claude/venviewer-copy-release-evidence-20260907/`.

The existing public smoke configuration was rotated to the observed deployment and raw HTML hash after all 15 checks passed, with zero failures. Its passing configuration and final file are byte-identical, the previous configuration is backed up and the scheduler remains Ready and unchanged. Rotation evidence is `D:/claude/demo-smoke-readonly-20260906/copy-rotation-54f4dc5a-20260907/rotation-receipt.json`. These unauthenticated GET/HEAD checks supplement the actual browser review above.

CI run `34159454748` passed Build, Typecheck, Lint and Security Audit at the live-review checkpoint; Test and E2E were still running. The earlier full-suite worker failures and non-green incoming E2E remain explicit limitations. Founder aesthetic acceptance and device performance are not claimed. The demo PDF and substantive legal text were not rewritten. T-609 is delivered; the serial release lane returns to T-601, with the separately owned newer Hallkeeper redesign remaining next-release work.
