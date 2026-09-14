# Event access and client schedule — Goal15 / T-611 / F-03

Status: **local API, database and client/admin browser checks passed; final route verification and delivery pending**. Updated 15 September 2026 from retained local evidence. Activated by Blake's request to create and carry out the next prompt. This is one bounded delivery within the Friday 18 September programme; it does not establish whole-product launch readiness, a deployed change or founder acceptance.

## Implemented result

Clients and the equivalent default `planner` role receive a strict event-scoped working schedule through their current owned layout relationship. The saved planner leads to the event page and back to an eligible layout. Internal phases, staff notes, snapshots, commercial information and venue-wide Diary stay behind current operational authority. Ordinary venue admins see their venue's submitted client enquiries in both the list and pagination count.

Creating an event no longer grants permanent internal access after a user's venue role changes. Revenue analytics, Event Architect and event notifications now apply the corresponding current event authority. Notification authority and read state are filtered before pagination, and concurrent read acknowledgements use one database upsert. The current policy and lifecycle limits are recorded in [the access decision](../engineering/event-client-access.md).

## Authority matrix

| Person or role | Customer schedule | Internal event work | Enquiry inbox |
| --- | --- | --- | --- |
| Client / booker (`client` or `planner`) | Current eligible owned layout associated with that event | Denied | Own enquiries |
| Sales or operational staff (`staff`) | Current venue authority | Existing venue-scoped work; specific write/review rules retained | Current venue |
| Venue manager/admin (`admin`, platform role none) | Current venue authority | Current venue; no global platform privilege | Current venue |
| Hallkeeper (`hallkeeper`) | Current venue authority | Existing operational read/write and review boundaries retained | Current venue |
| Caterer / supplier | No automatic event grant from a job title or supplier record; an eligible owned layout can qualify a customer account | Existing explicitly scoped supplier flow only; no venue-wide customer grant | Own enquiries if using a customer account |
| Other venue staff/admin | Denied without legitimate current authority | Denied | Their own venue only |
| Platform admin | Explicit platform authority | Existing platform authority | Existing platform scope |
| Signed out, removed account, invalid or revoked relationship | Denied | Denied | Authentication required |

Professions map to these existing capabilities; no fictitious global profession roles were added. Accepted-workspace membership management, general messaging and complete supplier lifecycle remain separate work.

## Source and isolation

Candidate branch: `codex/event-access-client-schedule-20260914`, isolated at `D:/codex/venviewer-event-access-20260914/worktree`, based on verified web/master `91220e00072700143f9c73dfa151bb47b17917d6`. The [14 September 23:27 UTC release preflight](D:/codex/venviewer-event-access-20260914/evidence/release-preflight-final.json) still records master/web at that baseline and API at `7f2a701b4dade7d9d6048a82511ffa83cf4ff821`, with API readiness and web HTTP 200. This is a dated baseline observation, not a candidate deployment receipt or release lock.

Owned PostgreSQL 16.6 listens only on 127.0.0.1:55481, with separate `venviewer_goal15` browser/API and `venviewer_goal15_access_test` regression databases under task-owned user `goal15`. Both use all 69 checkout migrations through 0070. No production database is used for tests. Dependencies were installed with the frozen lockfile. No migration is introduced; T605's dirty commercial work and reserved 0071/0072 are preserved. The pending Flow/runtime branch is not included.

The [local acceptance build receipt](D:/codex/venviewer-event-access-20260914/evidence/web-build.json) explicitly records E2E fixture authentication, the loopback API, stable before/after web source fingerprints, and `productionDeployable: false`. This flagged build must never be published. It renders retained hash-verified public room assets and real furniture geometry. It does not prove Clerk login, mobile 60 fps, survey dimensions, layout safety or founder aesthetic acceptance.

## Local automated evidence

These results have overlapping coverage and must not be added together as unique tests. Earlier failing evidence remains retained: the permission regressions reproduced 48 failures before correction, and later coherence, configuration-binding and rendered UI findings were fixed with their own checks.

| Check | Verified result | Retained evidence |
| --- | --- | --- |
| Full API suite | 2,931 passed; 251 skipped; 173 files passed and 13 skipped | [api-tests-all.log](D:/codex/venviewer-event-access-20260914/evidence/api-tests-all.log) |
| Shared types | 2,237 passed across 99 files; no type errors | [types-tests.log](D:/codex/venviewer-event-access-20260914/evidence/types-tests.log) |
| API typecheck and build | Both exited 0 | [typecheck](D:/codex/venviewer-event-access-20260914/evidence/api-typecheck.log), [build](D:/codex/venviewer-event-access-20260914/evidence/api-build.log) |
| Web typecheck and local acceptance build | Both exited 0 at the recorded candidate stage | [typecheck](D:/codex/venviewer-event-access-20260914/evidence/web-typecheck-final.log), [build](D:/codex/venviewer-event-access-20260914/evidence/web-build-final.log) |
| Required real PostgreSQL gate | 53 passed, zero skipped: 28 projection cases and 25 event-capability cases, serial execution; 69 exact migration hashes/timestamps matched before/after and replay was unchanged | [gate receipt](D:/codex/venviewer-event-access-20260914/worktree/packages/api/.test-results/event-access-db/1789427290006-9c5e3971-d1a1-447b-a00a-114a4921019f/receipt.json) |
| Database gate rejection tests | 3 passed; unsafe/missing targets, drift and failed/skipped/incomplete reports rejected | [guard results](D:/codex/venviewer-event-access-20260914/evidence/event-access-gate-guards-two-suites.json) |
| Full local HTTP acceptance | 25 passed against the actual API and disposable PostgreSQL; source fingerprints unchanged across the run | [HTTP receipt](D:/codex/venviewer-event-access-20260914/evidence/http-access-acceptance.json) |
| Operational UI guards | 123 passed across 7 files; loading, logout, unknown/customer roles, stale responses and platform-admin preservation covered | [web results](D:/codex/venviewer-event-access-20260914/evidence/operational-web-guards.json) |
| Planner disclosure correction | 34 passed: 15 PlannerCockpit and 19 WhenRibbon cases; focused lint passed | [QA regression results](D:/codex/venviewer-event-access-20260914/evidence/client-planner-qa-fixes.json) |

The separate required PostgreSQL gate covers its two named suites; it does **not** convert all 251 optional skips in the general API run into passes. No hosted candidate CI result is claimed. CI now creates a dedicated `venviewer_event_access_test` database on its existing disposable PostgreSQL service and runs the required gate; an absent target cannot silently skip it.

The projection's real SQL tests cover two venues and clients, current persisted authority despite stale claims, the production local-user identity bridge after downgrade, link/owner/role/deletion/variant changes, malformed associations, safe fields and an in-flight read snapshot barrier. The capability suite covers analytics authority, notification recipient/event isolation and pagination, and five concurrent acknowledgements producing one read marker. The [independent API/SQL/CI review](D:/codex/venviewer-event-access-20260914/evidence/final-api-review.md) found no material issue in its reviewed diff; it retains exact file hashes and does not substitute for live verification.

The 25 HTTP checks also create and submit a real enquiry inside the disposable fixture, verify its inclusion in an ordinary venue admin's inbox, exclude it from the other client's inbox, deny customer Diary/internal graph/analytics and foreign-venue access, and verify committed ownership revocation and restoration. Authentication uses the explicit test seam, not a Clerk provider session; external delivery was not configured.

## Actual local browser evidence

The client opened the event page, followed its owned layout into the rendered planner, and returned to the schedule. [Recorded requests](D:/codex/venviewer-event-access-20260914/evidence/browser-client-planner-requests.txt) show the selected-configuration schedule request returning 200 alongside actual layout and furniture assets. The final panel observation contains no internal phase-graph, room-timeline, Diary or platform-runtime request. These are local fixture observations, not production account checks.

An actual inspector edit moved the selected table group from X = 3.03 m to 3.13 m and saved through the API. PostgreSQL snapshots show 162 objects throughout: revision 1 became revision 2, exactly one nine-object group's transforms changed, and the other 153 domain objects remained unchanged. Reopening the layout retained revision 2 and the same change; the inspector was then used to restore the original X. See [before](D:/codex/venviewer-event-access-20260914/evidence/persistence/event-linked-flow/before-summary.json), [saved](D:/codex/venviewer-event-access-20260914/evidence/persistence/event-linked-flow/after-summary.json), [reopened](D:/codex/venviewer-event-access-20260914/evidence/persistence/event-linked-flow/reopened-summary.json) and [restore interaction](D:/codex/venviewer-event-access-20260914/evidence/browser-layout-restore.txt). This proves this grouped edit/save/reopen path; it is not a drag-performance measurement.

Taking the actual browser offline caused an honest schedule error and removed the previous schedule. Restoring the connection and selecting Try again recovered all eight phases from the API. Separately, a committed SQL owner transfer in the disposable database followed by Refresh hid the old event name and phases; restoring the owner and retrying recovered all eight. Receipts: [network error/retry](D:/codex/venviewer-event-access-20260914/evidence/browser-error-retry.txt), [SQL revoke](D:/codex/venviewer-event-access-20260914/evidence/browser-owner-revoke.json), [denied rendering](D:/codex/venviewer-event-access-20260914/evidence/browser-revoked.txt), [SQL restore](D:/codex/venviewer-event-access-20260914/evidence/browser-owner-restore.json), [recovered rendering](D:/codex/venviewer-event-access-20260914/evidence/browser-recovered.txt). This verifies revocation on the subsequent read, not unsolicited push revocation of an idle page.

The second client, using the `planner` alias, saw only its own private layout and its overnight event. The view displayed `Fri 18 Sept · 23:30–Sat 19 Sept · 01:00`, the next-day departure, and explicit “Time to be confirmed” / “Room to be confirmed” for the unassigned phase. That client was denied the first client's event. See [second-client snapshot](D:/codex/venviewer-event-access-20260914/evidence/browser-second-client-snapshot.txt), [other-client denial](D:/codex/venviewer-event-access-20260914/evidence/browser-other-client-denied.txt) and [overnight mobile capture](D:/codex/venviewer-event-access-20260914/output/playwright/goal15/client-overnight-mobile.png).

Rendered QA found and corrected an empty customer Booking time disclosure, a desktop dark background overriding the ivory schedule, and mobile overflow from full-viewport width plus margins. The final [DOM and computed-style checks](D:/codex/venviewer-event-access-20260914/evidence/browser-panel-checks.txt) recorded:

| Viewport | Final schedule bounds | Surface and content |
| --- | --- | --- |
| Desktop 1440 × 1000 | x 12, right 1426; 1414 × 292 | Ivory `rgb(247,245,238)`, dark ink `rgb(23,62,51)`, opaque phase cards; 8 phases; Booking time absent |
| Mobile 390 × 844 | x 10, right 380, bottom 834; 370 × 302; document width 390 | Same readable palette, contained horizontal phase scrolling, 8 phases; Booking time absent |

The retained computed colors give approximately 10.86:1 ink-on-paper and 6.20:1 secondary-text-on-card contrast; these two calculated pairs are not a complete accessibility audit. Final captures are [desktop](D:/codex/venviewer-event-access-20260914/output/playwright/goal15/client-planner-desktop-final.png) and [mobile](D:/codex/venviewer-event-access-20260914/output/playwright/goal15/client-planner-mobile-final.png). Both observed panel checks recorded no captured page errors. Earlier network logs include a failed external font request, and the deliberate offline/denied checks record their expected request errors; the entire run is not described as error-free.

The ordinary venue admin opened the actual operations page with all eight phases, then the enquiry inbox containing two submitted enquiries created through the local API acceptance runs. Opening an enquiry showed its exact title, the message “Disposable integration check; no external communication”, submitted status, status history and the correct saved-layout link. The fixture had no approved handoff, so its operations page explicitly reported that state; this did not exercise a live mission. No Start Review, opportunity creation, AI draft or external action was invoked. See [admin operations](D:/codex/venviewer-event-access-20260914/evidence/browser-admin-ops-snapshot.txt), [inbox](D:/codex/venviewer-event-access-20260914/evidence/browser-admin-enquiries.txt), [enquiry detail](D:/codex/venviewer-event-access-20260914/evidence/browser-admin-enquiry-detail.txt) and [detail capture](D:/codex/venviewer-event-access-20260914/output/playwright/goal15/admin-enquiry-detail.png).

All receipts contain synthetic local data under `D:/codex/venviewer-event-access-20260914/evidence` and `output/playwright/goal15`. The Event Architect run-route alias now uses the same operational guard as its entry route. Its [26 focused tests passed](D:/codex/venviewer-event-access-20260914/evidence/architect-route-alias-typechecked.json), and the [full web typecheck exited 0](D:/codex/venviewer-event-access-20260914/evidence/web-typecheck-alias-final.log) after the test-only typing correction. The [final frontend review](D:/codex/venviewer-event-access-20260914/evidence/final-frontend-review.md) retains reviewed source hashes and found no additional material regression. The screenshots above precede that final alias correction; rebuilding and exercising the actual route aliases remain with the release owner. Release checks will be recorded in their own receipts and the next report amendment.

## Existing platform CI limits

Final route admission review also removed the new event page's base-role restriction: authenticated users reach the strict server projection, which remains the authority for their event. This preserves explicit platform administration even with an executive or supplier base role; unsupported ordinary roles receive the unavailable state. The actual-router regression reproduced three failures, then [33 focused cases passed](D:/codex/venviewer-event-access-20260914/evidence/client-event-route-admission-final.json), with [full web/E2E typecheck](D:/codex/venviewer-event-access-20260914/evidence/web-typecheck-event-admission-final.log) and focused lint passing. No account privilege is changed. The final committed build and rendered route check remain part of the release receipt.

Read-only [audit of baseline CI 34160437128](D:/codex/venviewer-event-access-20260914/evidence/e2e-baseline-review.md) found 97 failed cases, 136 passed, 42 skipped and 76 not run across four shards. The original logs are retained. Source comparison confirms several outdated labels, missing panel expansion steps and invalid non-UUID fixtures, plus missing Linux screenshot baselines. Two performance tests missed their stated thresholds; other workflow and visual failures remain unresolved. This is not a passing current platform E2E gate and does not qualify the Friday launch. The local F03 checks above do not erase or weaken those failures.

## Delivery still required

Finish the current route-alias verification and any resulting final checks, inspect the complete diff, commit exact paths, coordinate one release through T601 or the standing unavailable-owner fallback, verify Linux/API readiness and production web identity, then exercise the changed live flow with an existing authorized account and layout. Commit, deployment and authenticated live verification are pending. The available browser reached Google's account chooser; the intended Venviewer account/client relationship has been requested from Blake. No account was chosen, impersonated, created or promoted to manufacture a live pass.

Physical-device mobile performance, real Clerk authentication/provider revocation, founder aesthetic acceptance and the broader Friday ecosystem remain unqualified by this slice. A responsive browser viewport is not an iPhone/Android performance result, and the working schedule does not establish a confirmed booking or approved event plan.

Goal15 remains active until the scoped behavior is shipped and verified live. No customer/staff messages, paid compute or unrelated production business mutations are authorized by this report.
