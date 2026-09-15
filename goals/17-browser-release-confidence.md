# Goal 17 — Restore trustworthy browser release checks

Activated by Blake on 15 September 2026: “create a ./goal and run it”.
Task **T-613**, active. Owner: **Build next-gen venue platform**, with T-601
serial release coordination. No token budget requested. Goal16/T-612 remains
owned by **Plan venue platform launch** and is not duplicated here.

## Outcome and execution

Make the complete browser release suite a trustworthy check of Venviewer's
current planner and venue workflows. Reproduce the four failed E2E shards from
the released production lineage, identify obsolete tests, environmental failures
and real application defects, and repair their causes. Keep meaningful coverage
and the selected visual direction. Carry the candidate through reviewed commits,
hosted verification, coordinated integration and the changed live journey.

The creation baseline is web/master54ebfc61 and API04dbd8bb, following the
planner release recorded in the Goal17 working report.
Creation-time CI34919476716 had four failed E2E shards. The prior bounded comparison
covered only shards1/4 and4/4, whose33 failed names also failed on28209abc.
This is a diagnostic lead, not proof that the other tests pass or all failures
are harmless. Preserve initial logs, traces and failed images.

1. **Owned baseline.** Recheck remote/live lineage and concurrent ownership.
   Use a clean isolated checkout and owned dependencies, not the shared dirty
   tree. Inventory the complete test count, existing skips and failures across
   every shard. Retain precise commands, configuration and source identity.
2. **Repair real causes.** Exercise failed flows in the actual rendered app.
   Update a locator only after verifying the current intended accessible
   interaction. Repair application defects at their owning boundary. Fix
   fixture/environment drift explicitly; mocks do not prove the live API.
3. **Visual evidence.** Inspect missing or changed reference images in the
   intended Linux browser environment before accepting them. Do not blanket
   regenerate screenshots, remove failing scenarios, widen image tolerances,
   lower frame targets, add unconditional skips or swallow errors to get green.
   Explain any obsolete assertion and preserve its useful behavior contract.
   Keep founder aesthetic acceptance distinct from technical screenshot checks.
4. **Complete qualification.** Run the affected cases, relevant unit/type/lint/
   build checks, then all four browser shards against the final source. Every
   scheduled non-skipped test must execute; disclose the exact remaining
   pre-existing skip inventory rather than presenting skipped coverage as
   qualified. Investigate unstable retries. Retain current security and required
   PostgreSQL gates when combining with Goal16; do not edit its dependency pins.
5. **Review and delivery.** Independently review application/test changes and
   visual evidence. Integrate coherent exact-path commits through T-601, serially
   with Goal16's qualified dependency candidate. Verify hosted browser results
   on the actual combined commit. Any product change includes deployment,
   provider/source checks and the affected existing authorized live flow.
   Test-only changes still require hosted CI evidence on the integrated commit;
   do not force an unrelated API redeployment.
6. **Closeout.** Record before/after results, source/artifact IDs, screenshots,
   hosted outcomes and live evidence in
   `docs/reports/browser-release-confidence-2026-09-15.md`. Update this goal,
   T-613 and the dated session. Completion requires a trustworthy complete
   browser gate and applicable delivery, not merely creating this document.

## Boundaries

Preserve F03 authorization and event access, inventory and Diary semantics,
saved layout data, Flow/capture recovery, touch controls and the combined Spark
lifecycle patch. Follow the shared Activity and product-experience conventions
for visible changes. Check actual source before changing tests or behavior.

Goal16 owns package/lock/native-dependency fixes. T-605 keeps its unfinished
source and migrations0071/0072; reconstruction/game environment remain with
their current owners. No production fixture creation, privilege changes,
customer/staff messages, source capture edits, paid compute or new infrastructure
is needed for this goal. Existing deployment authorization remains in force;
coordinate rather than racing another release.

This is a bounded part of the Friday18September release programme,
supporting release verification and rehearsal. It does not certify the complete
ecosystem, the sublime, physical iPhone/iPad/office-PC60fps or photographicPSNR50+.

## First action

Read every failed shard's retained evidence while establishing the owned source
and browser environment. Assign disjoint repair groups only after classifying
failures. Run and inspect a representative failure before changing it.

## Execution checkpoint — 15 September

All four baseline shards are audited:84 failed,114 passed,37 skipped and116
never executed. Each failed name also failed on the prior release, which is
not a waiver. Isolated repairs now include real camera-panel stacking, mobile
catalogue/empty-schedule placement and44px hallkeeper targets, alongside current
fixtures and interactions. Targeted browser and unit receipts are retained in
the [working report](../docs/reports/browser-release-confidence-2026-09-15.md).

Production dependency release `641f2667` is integrated and its frozen install
passed. The final mobile eight cases and 43 units pass on those pins. All 45
button-action cases, eight capture/tool cases across retained runs, and all 22
Linux state-visual cases pass. The original walk-exit skip remains explicit.
Web build, configuration/composer units, affected types and lint pass.

The first candidate is pushed as draft PR16 at `957f2b00563ab40113e52152601e5ac1dfc03cc2`.
Hosted CI34960484926 has closed: seven jobs passed and three failed. Every one of
the 353 browser cases is accounted for: 298 ordinary passes, four executed expected
failures, seven unexpected failures, two flaky passes and 42 original skips.
No scheduled case was silently lost. The failed jobs are workspace tests and
browser shards three/four; the audit, lint, types, build, native-image and first
two browser shards passed.

The complete independent Linux run closed with 290 ordinary passes, four executed
expected failures, 17 failures and 42 original skips; all 353 names reconcile
without omissions or retries. Follow-up corrections include the two schedule copy
assertions (58 units pass), current Reviews/quiz controls, request boundaries and
the two documented scenario deadlines. All 18 focused Linux cases now pass with
zero retries and no snapshot updates; whole-E2E types and scoped lint pass.

The passive registered-capture baseline still failed on default SwiftShader:
53 returned render calls showed prolonged opacity development, and the final page
screenshot exhausted the existing test budget. That evidence does not establish
font-network causation or GPU presentation timing. A three-file dissolve candidate
passes 45 focused units plus 54 planner/lighting/SS++ regressions, app/E2E types
and scoped lint; the build also passes. The fix is committed locally as `ea07e8b2`.
The corrected SwiftShader capture reaches exact full opacity but still times out
at its viewport screenshot; the same workload passes on the explicitly selected
RTX graphics backend. The software OpenGL comparison also passes in 40.2s; the
three capture specs now select that verified backend in `f78e190f`. Types/lint pass,
and all seven active capture cases pass with one original skip, zero retries and
real cold downloads. The same diagnostic passes with Xvfb. The unchanged Twin
suite under clean Xvfb still has two passes and three timing failures: 244ms
longest hop task, and 66.7ms/50ms pano/dollhouse RAF p95. Actual Mesa rendering
and matching source hashes are retained. Hosted capture qualification and the
required GPU timing path remain open. PR16 is unmerged and
no Goal17 product change is deployed. The working report retains exact receipts.

The strengthened Twin benchmark records actual render submissions and camera
movement during sustained native input. The same five cases, source, pixels and
limits produce two passes/three failures on Mesa llvmpipe and five passes on the
existing RTX 4090 through WSL D3D12. This isolates a hardware dependency; it does
not waive the failing hosted software timing gate. A concrete GPU-check proposal
is prepared, with a founder choice pending on local worker availability versus
separately capped rental. No worker, paid infrastructure or relaxed gate has
been introduced. Physical-device and aesthetic acceptance remain open.

The next candidate is pushed at `61ccc5a601f6fa69d71aadae40f3d797a08740ff`.
Hosted run35008947128 has closed all four browser shards: 304 ordinary passes,
four executed expected failures, three Twin timing failures and the same 42
original skips, no flaky outcomes. All seven active capture cases pass first try.
The complete run has closed: nine jobs passed, only browser shard four failed.
All 353 cases reconcile, with no missing, duplicate, unrun or interrupted case;
six retries belong only to the three timing failures. Required GPU qualification,
integration and delivery remain open. The Vercel preview builds but its planner targets localhost:3001,
so it does not provide venue-flow qualification. Exact receipts are in the report.
