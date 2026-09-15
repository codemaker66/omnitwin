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
Current CI34919476716 has four failed E2E shards. The prior bounded comparison
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

Repairs and their evidence are committed locally. Complete Linux qualification
is running as four sequential single-worker shards, with zero retries and no
snapshot updates. Hosted qualification and production delivery remain open.

The strengthened Twin benchmark records actual render submissions and camera
movement during sustained native input. The same five cases, source, pixels and
limits produce two passes/three failures on Mesa llvmpipe and five passes on the
existing RTX 4090 through WSL D3D12. This isolates a hardware dependency; it does
not waive the failing hosted software timing gate. A concrete GPU-check proposal
is prepared, with a founder choice pending on local worker availability versus
separately capped rental. No worker, paid infrastructure or relaxed gate has
been introduced. Physical-device and aesthetic acceptance remain open.
