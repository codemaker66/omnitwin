# T-594 — coherent loading and working motion on the live site

Date: 7 September 2026. Scope: Blake's request to apply the supplied motion reference everywhere work is visible, publish it, and make future tasks reuse it.

## Delivery

The complete requested update is live at [venviewer.com](https://venviewer.com/), including the final Hallkeeper and calendar retry corrections. The final provider receipt identifies web source `2805f78e5b94e34a95e052407180ed2ed2a9e063`, successful Production deployment `6315127880`, and deployment URL `https://omnitwin-njf2f1lqr-codemaker66s-projects.vercel.app`. Publication succeeded at 19:39 UTC. This task independently observed public entry `/assets/index-KV0_vdZi.js` and the actual Day Board flow in a fresh unmodified browser tab at 19:43–19:44 UTC. The API remains healthy at `7f2a701b`; this follow-up has no API runtime change. The deployment URL is protected, so no protected-bundle byte equality is claimed; provider identity and public alias observations are separate evidence.

The main migration first reached production in source `7f2a701b4dade7d9d6048a82511ffa83cf4ff821`, Vercel deployment `6314446074`, public entry `/assets/index-MYrlSuOu.js`. This task independently observed that entry and the initial live loading states described below. Its 18:47 UTC receipt also identifies the healthy API at the same source.

The final Hallkeeper follow-up is committed as `f606916aa7b7cc6442441c0ab669308ae076ef08`, followed by retry correction `be48b2ed69ff82710fe700808966797d2f4c6cf6`, integrated as `2b30ca4d` and `c698994d`. The later hook correction below is integrated as `90f59e84`. All six final source/test paths match this task's qualified `3d873bfe` and published `2805f78e` without differences. The exclusive release task performed serial publication; no competing deploy was started.

Further actual live retry inspection found that a failed initial calendar load kept showing its old error while the retry was pending. `useCalendar` derived that state from the retained error key, hiding its new internal loading state. Additive correction `3d873bfe5e7b9ef1b53e80f87e2dc2fb91cf931d` clears the previous error and key when the actual request starts. Its two-file diff is reviewed, committed and qualified with 36 tests across the hook, Diary and Day Board suites, targeted ESLint and diff checks. Four deferred cases cover initial retry and superseded retry success/failure. The correction is included in the final published source.

The original 5 September work and measurements were local evidence. The September 7 audit found that only part had reached production, so it rebuilt the remaining migration against the actual release source and followed it through delivery. The account usage interruption delayed publication; interrupted checks are not counted as passed.

## Implemented behavior

- One [shared Activity component](../../packages/web/src/components/shared/Activity.tsx) and stylesheet provide the fine particle sphere, ring and column choreography, copper accent, inline status and substantial-loading capsule. The supplied MP4 is a visual reference; the application does not download it.
- Source inspection counts 83 production TSX consumers plus the first-paint HTML adaptation, excluding tests and the shared component itself. Coverage includes route/auth gates, public room and panorama loading, editor controls and model previews, dashboard and administration, search, upload/export, Diary, Hallkeeper, capture, operations, proposals and supplier views.
- Status follows actual outstanding work, including overlapping requests, server settlement, image/GPU application and offline replay. Success, terminal error, cancellation and stale-context departure retire activity. Existing content stays visible during refresh. Failed requests expose the existing error/retry path; persisted offline queue badges remain static when no work is running.
- Reliable progress remains measured. The shared component owns accessible status and reduced-motion behavior; compact indicators retain the owning control's name. The first-paint adaptation disappears when React mounts.
- Hallkeeper's follow-up tracks pending writes by sheet and queued replay separately. Day Board distinguishes initial loading from refreshing retained bookings, remains static without a linked venue, and shows only one activity status when a failed background refresh is retried.

## Verification

The release coordinator qualified the main combined source with 934 focused tests and Linux lint, types, build and audit. This is the reported affected release gate, not a claim that the entire web test suite was rerun.

This task's component slices passed independently: editor 209 tests across 19 files; Diary/administration 47 across 3; panorama lifecycle 62 across 6; post-merge editor/auth/convention 85. These runs overlap other qualification and must not be summed into a unique total. The first complementary dashboard/page migration also passed its focused checks and actual first-paint browser inspection.

The final four-file Hallkeeper follow-up passed 15 tests, targeted ESLint, full web and E2E typecheck, and a production build (51.05 seconds, 3,469 modules). Independent final review then found the failed-background-refresh retry could show two status regions. A deferred regression reproduced the failure before the one-condition correction. The corrected Hallkeeper/Day Board slice passes 16 tests across two files, targeted ESLint and diff checks. The combined `d6aa0190` production build passed at 19:06 UTC, followed by full web/E2E typecheck and web lint at 19:07 UTC.

The broader `d6aa0190` run executed 444 files with 5,927 passing and 16 skipped tests, but returned nonzero because nine fork workers failed to start. The final PNPM “vitest not found” text was a misleading wrapper result: Vitest did execute. The original failure is retained. The nine missed files then passed all 37 tests with a compatible external one-thread configuration, bringing coverage across the separate runs to 453 files, 5,964 passing tests and 16 skips. This is not represented as one clean full-suite invocation.

This task's subsequent small hook attempts likewise failed startup before executing tests. A direct threads attempt rejected the original fork-only heap argument. The recovered external configuration imports the original configuration and overrides only the pool, worker count and fork-only arguments, preserving setup, environment, includes and timeouts; it uses the same parent heap allocation. On committed `3d873bfe`, all 36 hook/Diary/Day Board tests passed in 16.97 seconds with zero errors, then targeted ESLint passed. Earlier failed attempts remain failures; no assertions, dependencies or timeouts were relaxed.

The release task independently passed 77 calendar, Hallkeeper and timeline tests on integrated `90f59e84`. Final published `2805f78e` then passed full web/E2E typecheck, web lint, production build and the remaining affected 2D checks. The exact final type/lint receipt finished at 19:36 UTC. The source was frozen during qualification.

Actual browser checks used a dedicated authenticated Brave tab on the production domain, read-only navigation and GET requests. Request holding and reduced-motion/viewport emulation were temporary browser controls, not application changes or substituted API responses.

| Live flow | Observed evidence |
| --- | --- |
| First paint | Held the exact published entry script. The rounded status capsule showed “Opening Venviewer…” with 24 particles and the shared motion name. Releasing the load removed the bootstrap. |
| Narrow first paint | 390px viewport and 390px document width, with readable capsule and no horizontal overflow. This is emulation, not a physical-device measurement. |
| Reduced-motion first paint | Animation computed as `none`; the work label remained visible. |
| Grand Hall room | Real download showed “Sharpening the room — 18%”, a 56-particle shared indicator and measured progressbar value 18. After completion, no work status remained. |
| Workspace arrival | Actual route transition showed “Opening your workspace…”, then authenticated venue loading and the loaded dashboard. |
| Diary refresh | A held real calendar GET showed one “Refreshing the Diary…” status, 56 particles, `vv-activity-form`, readable inherited text colour, and the existing booking board. Reduced motion changed animation to `none`; successful refresh removed all activity. |
| Final Day Board (`2805f78e`) | Fresh unmodified authenticated tab loaded the four-room board and exact new public entry. Native date navigation from September 7 to September 8 loaded the correct different bookings. Today announced “Loading the day’s bookings…” in the actual accessibility tree, then restored September 7 with four rooms, zero Activity indicators and zero alerts. |

An additional live Day Board check on the earlier release deliberately disabled networking in the owned test tab and changed its displayed date. The calendar reached “Network error — check your connection” with zero Activity indicators and a retry control. Holding the online retry exposed the hidden-loading defect described above. Restoring normal requests and selecting Today returned the four-room board with no alert or activity. All owned network, interception, cache, media and viewport overrides were explicitly reset and that tab was closed. Final publication was checked in a fresh unmodified tab, which was also closed after verification. The first tab-creation tool timed out while navigation continued; reconnecting from fresh browser inventory showed the loaded page. Other tasks' or the user's tabs were not edited.

Private venue records were not changed by these checks. Checklist writes, overlapping saves, rejected requests, stale sheets and offline replay were verified through rendered component tests with controlled network boundaries; they were not exercised by changing live operational records. No physical-device performance, screen-reader session, or founder aesthetic acceptance is claimed.

## Future work uses the same convention

[AGENTS.md](../../AGENTS.md) requires the shared component and links the [loading and working convention](../../.claude/conventions/loading-and-working-motion.md); [CLAUDE.md](../../CLAUDE.md) imports that policy. The convention specifies actual operation labels, honest progress, cancellation/error settlement, light/dark contrast and reduced motion. ESLint rejects alternate Lucide loaders. The 24-case source convention guard checks matching active branches/containers and catches independent loading animation patterns while allowing static explanations, errors and persisted queues. Lifecycle regressions remain necessary; static analysis is not proof of request ownership.

Eight other active project tasks were directly notified on September 7, covering branding, the showcase, agent guidance, furniture, navigation/access, platform work, copy cleanup and Grand Hall polish. New interfaces must consume Activity when integrated, including work begun in older worktrees.

Local evidence is retained under `D:/claude/venviewer-activity-global-live-evidence-20260907/`. Main release receipts and combined gates are under `D:/claude/venviewer-presentation-readiness-20260907/`, including `live-provider-7f2a701.json`, `live-provider-2805f78e.json` and the source-specific gate directories. Browser evidence was inspected in the task conversation. The earlier reference decoding and dated local measurements remain under `D:/claude/venviewer-loading-20260905/`.
