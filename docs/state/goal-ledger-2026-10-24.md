# Goal done-when ledger, 24 October 2026 (L0, T-672)

Every goal file on master, line by line against its own "Done when" text, five working days before `v1.0`
(feature freeze Thursday 29 October 18:00 GMT; final review Friday 30; tag Saturday 31).

- **Source:** master `d7338a7c` (24 Oct, docs only, `[skip ci]`). The last master commit CI checked is `1d2e417f` (#165).
- **Scope:** every file in `goals/`, plus [GOAL.md](../../GOAL.md), [the task list](tasks.md),
  [plan 19](../plan/19-EVERYTHING-BY-31-OCTOBER-2026-10-22.md) and the latest session log on master,
  [22 October](../sessions/2026-10-22.md). There is no 23 or 24 October log on master.
- **Method:** each line is quoted verbatim and given exactly one status. Doc claims were checked against source and
  tests on master. Five read-only agents gathered the evidence, one per subsystem. The lead session then re-read
  every citation behind a closed line, and every doc/source disagreement named below, before writing them here.
  No tests, builds or browsers were run for this ledger. No step ran at `max` effort.
- **Statuses.**
  - **inspected:** source on master shows it, cited file:line.
  - **tested:** a test on master asserts it, cited with the test's title.
  - **measured:** a recorded number, with whether its scene, device and workload match the line.
  - **deployed:** a doc records it live with a commit.
  - **accepted:** Blake's recorded words.
  - **open:** anything else, with the gap.
- **Closed** means one of the first five statuses. A line is never reworded to pass (goals/README.md; plan 19 §1).
- **Who** for open lines names a plan 19 §3 lane (L0–L13), or Blake with the plan 19 §5 item number.
- **By freeze:**
  - **yes:** engineering alone can close it by Thu 29 18:00, once its lane is staffed.
  - **only if:** it depends on something named, usually Tue 27 (Trades Hall), Wed 28 (devices), the setup sitting
    or a Blake decision.
  - **no:** it cannot close by the freeze as written.

## Summary

| Goal | Lines | Closed | Open | Closable by freeze: yes / only if / no |
|---|---|---|---|---|
| 00 Protect Monday (historical) | 2 | 0 | 2 | 0 / 1 / 1 |
| 01 The Sublime | 6 | 0 | 6 | 2 / 3 / 1 |
| 02 The room | 6 | 0 | 6 | 2 / 2 / 2 |
| 03 The planner | 6 | 0 | 6 | 1 / 4 / 1 |
| 04 The conversation (absorbed into 19) | 5 | 3 | 2 | 1 / 1 / 0 |
| 05 The hallkeeper's day | 6 | 1 | 5 | 3 / 2 / 0 |
| 06 One event | 5 | 0 | 5 | 1 / 2 / 2 |
| 07 The front of house | 5 | 1 | 4 | 1 / 1 / 2 |
| 08 The Foundry | 5 | 1 | 4 | 1 / 2 / 1 |
| 09 The venue's mind | 5 | 1 | 4 | 1 / 2 / 1 |
| 10 The platform | 6 | 0 | 6 | 4 / 1 / 1 |
| 11, 13, 14, 15, 20, 21 | no file on master | — | — | cannot be ledgered against their own text (see the last section) |
| 12 Intelligent venue platform (6 gates) | 6 | 0 | 6 | 0 / 0 / 6 |
| 16 Release dependency security | 6 | 5 | 1 | 0 / 1 / 0 |
| 17 Browser release confidence | 6 | 6 | 0 | — |
| 18 Ship Friday (historical) | 3 | 0 | 3 | 0 / 0 / 3 |
| 19 The living timetable | 14 | 7 | 7 | 1 / 5 / 1 |
| **Total (16 files)** | **92** | **25** | **67** | **18 / 27 / 22** |

No goal file on master is closed on every line except goal 17, whose September closure has since regressed on
master (see goal 17). Plan 19 §2 lists goal 16 as closed, but one of its lines is open (the T-612 row is missing).

The 18 "yes" lines are 86–104 engineering hours in total; 05·4 and 19·10 are one piece of work. They spread over:

- L1/L8: restore drill, tenancy, export, frontier register;
- L2: lineage, D6 tracker, research register;
- L3: reload test;
- L4/L9: decision link and preview run, dense day, offline request queue, phone-equals-print;
- L5: pain-point ledger;
- L6: recommender evidence;
- L7: /fresh;
- L10: gallery, handoff.

Several of them only matter once Blake rules on goal 01 (below).

## Decisions only Blake can make that this ledger surfaces

These decide whether lines can close at all. More code does not close them.

1. **Goal 01 as written against the 6 September register.**
   - The brief prescribes darkness first, one gilt accent, Söhne/Canela and a dark "line of light".
   - The current direction is ivory, forest, copper and sage. The brief's prescriptions are recorded as
     "proposals, not founder requirements" (.claude/conventions/product-experience.md:78; goals/19:37).
   - Plan 17 does not exist, and no selection among the three study directions is recorded.
   - Needed: approve, amend or retire the brief, and select a study direction or declare the study superseded.
   - Blocks 01·1, 01·2 and the ratified "sublime test" that 03·1, 06·5 and 07·1 depend on. (§5 item 8.)
2. **Goals 00 and 18 are historical.**
   - Their lines refer to 5–7 September and to `release/r1`, which never reached master.
   - They can close only by Blake's recorded retirement. Otherwise they are reported open on 31 October
     (plan 19 §1 counts every goal 00–21).
3. **The splat hold.**
   - 00·2 (planner first splat pixels) and 02·1 (the walk on every fixture) measure a splat that production
     no longer shows (splat-access.test.tsx:18-31; T-628).
   - 08·1 needs an owned splat served behind a flag.
   - Needed: whether splats return before 31 October. (§5 item 8.)
4. **Accepted versions and the platform-admin override.**
   - quote-permissions-postgres.test.ts:397 asserts that a platform admin may edit (200), append to (201) and
     delete from (204) an issued quote. proposals.ts:706-713 likewise allows a proposal change in any status.
   - Goal 06 decides "Accepted versions are immutable". Keep the override, or remove it so 06·3 can close?
5. **`/fresh`.** Retire it behind a redirect as goal 07 S7 says (07·5), or record that it stays as the about page.
6. **The demo-seed purge (L1) against 05·1**, "a demo-week shift". Run the shift before the purge, or say what
   replaces the demo week.
7. **Goals 11, 13, 14, 15, 20 and 21.**
   - Their files are not on master, so their own done-when text cannot be checked here.
   - Plan 19 §2 says 14 and 15 are closed. goals/16:13 says goal 15's file "was never committed to this repository".
   - Needed: commit the files (L13, with Codex for 11/20/21), or Blake accepts that they are reported from
     another record.

## Doc and source disagree (checked against source)

- **Living timetable report vs source.** docs/reports/living-timetable-2026-10.md:36 says a disconnected phone's
  acknowledgement reconciles through "S5's offline queue". The queue carries only `task_status`, `issue_create` and
  `observation_record` (packages/web/src/lib/event-day-offline-queue.ts:13-32). A request acknowledge, accept or
  resolve that fails only sets an error and refreshes (packages/web/src/components/requests/RequestsProvider.tsx:231-242).
- **S7 and S8 merge state.** docs/state/tasks.md:166 (T-651) and :43 still say "PR open, not merged" for S7 and S8.
  Both are on master: `574ab2ed` (#127) and `fdf3aeb0` (#128), checked with `git merge-base --is-ancestor`.
- **Inventory merge state.** T-588 (tasks.md:202) says inventory persistence, API and admin UI remain "Not merged".
  goals/19:25 and goals/EXECUTION.md:83 say the same. Migrations `0065_venue_inventory`, `0066_inventory_reservations`,
  the routes and the dashboard InventoryPanel are all on master.
- **Goal 16 status.** goals/16:5 says "complete", but docs/state/tasks.md has no T-612 row, which goal 16's sixth
  criterion requires.
- **The sublime study.** T-589 (tasks.md:203) is "done", and goals/README.md:92 points to
  `docs/design/sublime-study-2026-09-04/`. The study is not on master: goals/EXECUTION.md:101 says it lives only in
  the shared checkout.
- **Goal 12 status.** goals/README.md:10 and docs/engineering/intelligent-platform.md:3 call goal 12 "active".
  T-605 (tasks.md:193) is "deferred", with its second increment off-repo.
- **Stale "Where we are" text.**
  - goals/07:13 says the homepage enquiry is a mailto. The composer posts to `/public/enquiries`
    (packages/web/src/api/configurations.ts:253), and FreshEnquiry.test.tsx:77 asserts no mailto.
  - GOAL.md:107 says the API deploys "only by manual `railway up`". It now deploys through Railway's GitHub
    integration (docs/operations/deploy-flow-current.md:36-41).
  - T-583 (tasks.md:384) is "not-started", although the E2E job is sharded four ways and finishes.
- **Deploy order.** docs/operations/deploy-flow-current.md:107-109 says a red master CI "never puts a migration-bearing
  build live". Step 4 of the same document (:36-41) runs the pre-deploy migrate on push, independent of CI.
- **Missing artefacts.** The verify commands of goals 02, 03 and 08 cannot run as written:
  - `tools/court/` and `packages/web/scripts/court-render.mjs` do not exist.
  - `packages/web/scripts/splat-drag-budget.mjs` takes no `--room` or `--layout` argument.
  - goals/08:60's `docs/reports/foundry-spend.md` does not exist.
- **The decision object.** packages/api/src/utils/query.ts:263-268 says a time or a price "goes to the decision
  object". No such object exists in source. The only decision storage is inventory's (packages/api/src/db/schema.ts:450).

## State of the gates under every goal (24 October)

- **CI on the last code commit.** `1d2e417f` (#165), run 39879311288, passed only on its third attempt. The
  "Browser release gate" job failed on attempts 1 and 2 and passed on 3; all other jobs passed every attempt. #163's
  run 39847320950 failed. The fix waits in PR #168 (T-673, "Fix the browser gate's three flaky cases at their cause"),
  open and not merged.
- **API deploys.** After the manual redeploy on 22 October (21:05), Railway deployed merges by itself:
  - #154: `db2e916b`, live 23:25.
  - #140: `a8dfcfd5`, live 00:22 on 23 October (docs/sessions/2026-10-22.md:276-280).
- **No staging exists.** goals/19:167 says a Vercel preview with a disposable Neon branch is the rehearsal. Every line
  that says "staging" needs that rehearsal; none has been run for goals 04, 06 or 09.
- **No physical device has been measured.** No physical phone or tablet measurement is recorded on master. The
  recorded phone-profile numbers come from the RTX 4090 (docs/engineering/planner-rendering.md:39-43;
  docs/engineering/grand-hall-model.md:525-528). Plan 19 schedules the device day for Wed 28.
- **Real people have not been involved.** No hallkeeper account exists on production (T-608 blocked, tasks.md:196).
  Elaine and a hallkeeper are not yet invited (plan 19 §5 item 2). There is no usability run with n anywhere.
- **Postgres suites that CI never runs.** Some tests cited below are skipped because ci.yml does not set their
  database variable:
  - inventory: `VENVIEWER_INVENTORY_TEST_DATABASE_URL`;
  - window proposals: `VENVIEWER_S6_TEST_DATABASE_URL`;
  - phase-layout snapshot immutability: `VENVIEWER_PHASE_LAYOUT_TEST_DATABASE_URL`.
  The requests and conversations suites do run in CI (`VENVIEWER_REQUESTS_TEST_DATABASE_URL`, .github/workflows/ci.yml:356).

---

## Goal 00 · Protect Monday

[goals/00-protect-monday.md](../../goals/00-protect-monday.md). Plan 19 §2: historical. goals/README.md:91 still
says "in progress".

| # | Done-when line (verbatim) | Status | Evidence | To close: work · who · hours · by freeze |
|---|---|---|---|---|
| 1 | "The immediate V0 protection slice is complete when the three morning smoke results and rehearsal outcomes are recorded and the no-Saturday-planner-push instruction is observed." | open | **Smoke results:** one Saturday result is recorded, and not at 08:00: 08:30 ok, first view 7.9 s (docs/sessions/2026-09-05.md:17). That line says the Sunday and Monday 08:00 runs wrote to `D:\claude\demo-smoke\morning.log`, which is off-repo. docs/sessions/2026-09-06.md (15 lines) and 2026-09-07.md record no morning result. **Rehearsal:** no record of Blake's signed-in Saturday rehearsal (plan 12 §4). **No push:** this part holds; T-581 stayed on its branch (tasks.md:383). **Gap:** 1 of 3 morning results, 0 rehearsal outcomes. | Copy the Sunday and Monday lines from morning.log, and any rehearsal notes, into the 6 and 7 Sep logs · L13 + Blake · 0.5 h · only if morning.log and a rehearsal record still exist (neither can be re-run); otherwise Blake retires the goal (decision 2) |
| 2 | "T-581's later production qualification still requires planner first splat pixels ≤ 15 s at 20 Mbps, usable interaction and the named CI checks; it is not a condition for pushing before Monday." | open | T-581 is "deferred" (tasks.md:383). The last production planner measurement: first captured tile at 22.5 s at 20 Mbps (goals/00:42, Spark era). The planner no longer draws a splat in production: the Grand Hall is a surveyed mesh (T-652, tasks.md:164), and the splat hold applies (T-628, tasks.md:190). On 22 Oct the room appeared in about 15–20 s, unthrottled, in a browser pane (docs/sessions/2026-10-22.md:21-22). That was a mesh, not at 20 Mbps. **Gap:** 22.5 s against ≤15 s, and the measure has nothing to measure today. | Blake decides whether a planner splat returns (decision 3). If it does, build a native coarse-first ladder and run planner-load at 20 Mbps · Blake (§5 item 8), then L3/L2 · 8–16 h · no |

## Goal 01 · The Sublime

[goals/01-the-sublime.md](../../goals/01-the-sublime.md). Lane L10. No line is met on master. The goal cannot close
as written without Blake's ruling (decision 1).

| # | Done-when line (verbatim) | Status | Evidence | To close: work · who · hours · by freeze |
|---|---|---|---|---|
| 1 | "Blake has approved the brief." | open | No `docs/plan/17-THE-SUBLIME-DESIGN-LANGUAGE.md`: docs/plan goes from 16 to 18. No "approved" is recorded in the session logs, the task list or GOAL.md. Later direction treats the brief's prescriptions as "proposals, not founder requirements" (.claude/conventions/product-experience.md:78; goals/19:37). | L10 drafts plan 17, reconciling the brief with the 6 Sep register and keeping §4's correctness lines; Blake approves, amends or retires it · Blake (§5 item 8) + L10 · 2 h + 0.5 h Blake · only if Blake rules at walk 1 (Mon 26) |
| 2 | "The three-role study exists with three directions and his selection recorded." | open | The study is not on master: no `docs/design/sublime-study-2026-09-04/` (goals/EXECUTION.md:101, "not part of this release tree"). T-589 says "Founder selection pending" (tasks.md:203). The 6 Sep pick (product-experience.md:62) is an inventory composition, not a choice among Measure, Continuum and Presence. | Salvage study.md and its three images to master after a privacy check; record Blake's choice, or Blake's statement that the 6 Sep register supersedes the study · L13 + Blake (§5 item 8) · 1 h + Blake's word · only if Blake answers |
| 3 | "The gallery has forty captioned images." | open | `docs/plan/reference/` holds only `day-board/`. 0 of 40 images, no index. | 40 captioned images and an index mapping each to a law. Copyrighted works need licences or links; generated images labelled · L10 · 6–8 h · yes (of little use until line 1 is ruled) |
| 4 | "Eight rooms have measured tokens with the contrast test green." | open | No `tools/palette/`, no `packages/web/src/design/`, no `*.tokens.json`. Contrast tests exist for the hand-set register, not for measured room tokens: house-tokens.test.ts:270 "keeps primary and secondary chrome text ≥ 4.5:1 on every BOH background"; client-surface-contrast.test.ts:63 "client surfaces hold 7:1". **Gap:** 0 of 8 rooms. | The palette tool reading the served splats, 8 token files, a contrast test, 8 swatches · L10 · 10–14 h, needs the local served splats · only if Blake confirms measured per-room palettes still apply alongside the selected register |
| 5 | "The three keystones run behind the flag with screenshots and filled-in sublime tests." | open | No `?house=sublime` (or `house` parameter) anywhere in packages/web/src. No filled sublime test anywhere in docs. **Gap:** 0 of 3 keystones. | Three flagged prototypes with screenshots and ten test lines each. Line 4 needs a timed person and line 6 a physical device · L10 + L3 + L4/L9 · 20–30 h · no |
| 6 | "The handoff lists which House v1.0 rules were kept as correctness." | open | No handoff. The list exists only inside the brief (goals/01:19). | A "kept as correctness" section, each rule linked to its enforcing test (e.g. client-surface-contrast.test.ts:63 for 7:1) · L10 · 1 h · yes (as a document; tied to line 1) |

## Goal 02 · The room, spectacular and fast

[goals/02-the-room.md](../../goals/02-the-room.md). Lane L2 with L3.

| # | Done-when line (verbatim) | Status | Evidence | To close: work · who · hours · by freeze |
|---|---|---|---|---|
| 1 | "On every fixture in the matrix, physically measured: the same accepted appearance (no reduced canvas, ornament, furniture quality or frame rate), first view ≤ 5 s at 20 Mbps (3 s the stretch), visually complete ≤ 8 s at 50 Mbps, frame-interval p95 ≤ 16.7 ms furnished." | open | No `docs/reports/device-matrix-*.md`. **Devices:** the phone-profile numbers come from the RTX 4090; "No phone or tablet has been measured yet" (docs/engineering/planner-rendering.md:39-43). **Splats in production:** held; `/room/grand-hall` mounts no canvas (packages/web/src/__tests__/splat-access.test.tsx:18-31). **Last load measurement:** 8.0 s first view and 72.9 s full sharpness at 20 Mbps, Spark era, 4 Sep (docs/reports/coarse-first-ladder-2026-09-04.md:23-24). Nothing measured at 50 Mbps. **Gap:** 8.0 s vs ≤5 s; 72.9 s vs ≤8 s; 0 physical fixtures. | Lift the hold, view-local delivery (D7), a furnished harness option, the device day · L2 + L3; Blake (§5 items 5, 8) · 60+ h · no |
| 2 | "Interim reduced builds are labelled as such and are not counted." | open | No matrix, so nothing is labelled. The planner's governor gives up resolution, ambient occlusion and bloom on slow devices, recorded only in the `?profiler=1` report (docs/engineering/planner-rendering.md:76-87). | Label every governor-reduced row "reduced" in the device-matrix report · L2/L10 · 3 h · only if the device day runs Wed 28 |
| 3 | "The court's floor band improves on every viewpoint with no whole-frame regression and no flicker." | open | The court does not exist: no `tools/court/`, no `court-render.mjs`, no `?pose=`, no `gh2-vendor` baseline. T-579 is "deferred" (tasks.md:386). | Build W1 (pose parameter, render script, judge, six viewpoints, three regions), then judge the photographic floor · L2 · 16–20 h · only if L2 builds it by Tue 27 (GPU lock, no paid training) |
| 4 | "Every accepted derivative has lineage and a rollback." | open | Partial: the served bundles are pinned by sha256 (packages/web/src/data/generated/trades-hall-splat-bundles.ts:127-211). But `state/asset_versions.json` lists no assets, and the Foundry CLI "cannot … roll back" (tools/reconstruction-foundry/README.md:3-4). | Lineage manifest per served derivative (source hash, tool version, derivative hash), a previous-bundle pointer, a rollback test · L2 · 6 h · yes |
| 5 | "All eight rooms are on the same ladder with their own court baseline." | open | All eight rooms have vendor bundles (trades-hall-splat-bundles.ts), but no court baseline, because there is no court. | A baseline per room after line 3 · L2 · 8 h after the court · no |
| 6 | "PSNR 50+ remains a tracked stretch under D6 until achieved." | open | No pinned D6 protocol on master. **Best held-out:** the T-658 control at 22.527 dB headline, 22.144 raw, 22.770 colour-matched (docs/reports/t658-recon-round2-2026-10-16.md:53-55). Protocol: fold A, five E57 stations × 6 faces at 4096 px (:24-25). **Not reconstruction:** E8's 36.29 dB is renderer-against-gsplat agreement (docs/reports/e8-splat-blend-2026-10-20.md). **Gap:** 22.5 dB held-out vs 50; no tracker. | Write the D6 protocol from T-658's instrument, plus a tracker that says which of the three numbers each report gives · L2 · 2 h · yes (the 50 dB target itself stays open) |

## Goal 03 · The planner

[goals/03-the-planner.md](../../goals/03-the-planner.md). Lane L3. Plan 19 scopes L3 to chrome slices 6–21, the
whole-room Grand Assembly, finger drag and p95 at 180 seats (plan 19:69).

| # | Done-when line (verbatim) | Status | Evidence | To close: work · who · hours · by freeze |
|---|---|---|---|---|
| 1 | "The sublime test passes on every planner state." | open | No filled sublime test for any planner state. The T-671 chrome is behind `?chrome=v2`, in progress (tasks.md:147). Test line 4 needs a timed person and line 6 a physical device. | Fill the test per state (law 8's ten states) with measurements, a person and the device day · L10 + L3 · 10 h + device day · only if decision 1 ratifies the test and the weakest fixture passes Wed 28 |
| 2 | "The interruption suite is green." | open | No `packages/web/e2e/floor-interruptions.spec.ts`, no `/dev/motion-lab`, no `packages/web/src/floor/`. Only spring and offset unit tests exist (packages/web/src/lib/__tests__/furniture-motion.test.ts). | The motion lab and interruption spec (skip, cancel, redrag, undo, route change; counts survive reload). Needs the choreography first · L3 · 16–24 h · only if Grand Assembly lands by Tue 27 |
| 3 | "Frame-interval p95 ≤ 16.7 ms with a 180-seat layout on every device in the matrix (goal 02 D1)." | open | Measured, but the device does not match. 0.18–0.24 ms GPU (phone profile) and 0.75–1.04 ms GPU (desktop profile) with 88–180 guests, RTX 4090 only (docs/engineering/planner-rendering.md:39-43). That is GPU time on one emulated device, not frame interval on the matrix. | A 180-seat planner option in the harness, then the device day · L3; Blake (§5 item 5) · 4 h + Wed 28 · only if every fixture passes Wed 28 |
| 4 | "Each Assembly form has an acceptance recording." | open | No Grand Assembly, Layout Recall, Transformation Assembly or Director's Cut code on master. The studies are on branch `claude/grand-assembly-studies`, not master. No recording. | Build all four forms and record each for Blake · L3; Blake (§5 item 8) · 60+ h · no (at best Grand Assembly alone) |
| 5 | "Elaine recognises the real chair and table." | open | No Trades Hall-measured chair or table. The Burgess Turini chair is "calibrated AI-generated presentation geometry, not a measured scan" (packages/types/src/asset-catalogue.ts:172-186; docs/reports/burgess-turini-chair-import-2026-09-06.md:44). The round table has generic dimensions. Elaine is not invited. | Measure and photograph one chair and one table on Tue 27, draw them, show Elaine · L3; Blake (§5 items 2, 4) · 10 h · only if Tue 27 gives measurements and Elaine reviews by Thursday |
| 6 | "The same approved layout survives reload and yields the correct item counts." | open | Partial only. **Round trip:** an API→store→scene→API round trip on a simulated database (packages/web/src/__tests__/editor-roundtrip.test.ts:568). **Batch save:** checked against Postgres (packages/api/src/__tests__/placed-object-batch-postgres.test.ts:155). **Missing:** no test approves a layout, reloads and asserts counts. | One Playwright test: save a 180-seat layout, approve, reload, assert counts in the planner and the hallkeeper sheet · L3 · 4 h · yes |

## Goal 04 · The conversation

[goals/04-the-conversation.md](../../goals/04-the-conversation.md). Goal 19 absorbs all six slices (goals/19:19). Its
slices are on master: `0586ab03` (#56), `180edb5f` (#62), `ee931af0` (#64). Lane L4.

| # | Done-when line (verbatim) | Status | Evidence | To close: work · who · hours · by freeze |
|---|---|---|---|---|
| 1 | "The sentence in Blake's words works end to end on the local stack with three signed-in identities (admin, hallkeeper, client) and then on a staging deployment: the request reaches the right people and the right slot, one person owns it, stock and approval implications are surfaced through the decision object, the client sees progress, the outcome is recorded." | open | **Local stack:** the three-identities e2e passed 4/4 on 10 Oct, ring 358 ms after send (docs/sessions/2026-10-10.md:48). The spec skips unless `E2E_LIVING_TIMETABLE=1` (packages/web/e2e/living-timetable-three-identities.spec.ts:37). **Staging:** no staging, no preview rehearsal recorded. **Decision object:** requests never reach one. The only decision tables are inventory's (schema.ts:450). The composer says only that a quantity beyond the release "is a request the office decides" (packages/web/src/components/events/ClientRequests.tsx:32-33). | A chairs request over the released count shows the stock assessment and opens a remedy through `/inventory/remedies/prepare`; run the e2e on a Vercel preview with a Neon branch · L4 (+L9) · 8 h + 3 h · yes (plan 19 starts L4 after the setup sitting) |
| 2 | "Exactly once under reconnect." | tested | packages/api/src/__tests__/conversation-commands-postgres.test.ts:109 "sends a message once under a resent commandId; the second ack is a replay of the first"; :145 "is the same message whether the socket or the REST retry got there first"; conversations-postgres.test.ts:206 "sends a message once under a replayed key, even when two phones race". These run in CI (ci.yml:356). Limit: the reconnect-mid-send e2e goal 19 S2 names does not exist. | — |
| 3 | "Audiences are proved exact by tests." | tested | conversations-postgres.test.ts:169 "makes a second thread for the other audience rather than widening the first"; :246 "admits the event's client to the client-facing thread and never to the staff-private one"; :358 "keeps a staff-private thread out of the client's snapshot entirely"; conversations-routes.test.ts:110 "has no route that changes a thread's audience"; requests-postgres.test.ts:279 "fixes the audience at creation and never widens it afterwards". | — |
| 4 | "In the usability run a hallkeeper acknowledges a request within fifteen seconds." | open | Not run: docs/reports/living-timetable-2026-10.md:39. **Gap:** n = 0. | A timed run with a real hallkeeper on docs/operations/living-timetable-rehearsal.md's sheet · Blake (§5 items 2, 4) + L4 · 2 h · only if a hallkeeper is invited and Tue 27 happens |
| 5 | "Nothing a message does changes an approved event." | tested | conversations-routes.test.ts:94 "refuses a message that tries to carry a time or stock change", against the strict schema at packages/types/src/conversations.ts:101-104. Inspected: the request, conversation and observation services write no booking, configuration or inventory row. | — |

## Goal 05 · The hallkeeper's day

[goals/05-the-hallkeepers-day.md](../../goals/05-the-hallkeepers-day.md). Lanes L9 (S4, S6, S7) and L4 (S1–S3, S5 via
goal 19).

| # | Done-when line (verbatim) | Status | Evidence | To close: work · who · hours · by freeze |
|---|---|---|---|---|
| 1 | "A hallkeeper runs a demo-week shift from a phone and the wall display." | open | No hallkeeper account on production (T-608 blocked, tasks.md:196). No shift recorded. | An invited hallkeeper works a seeded day on a phone and the wall (`?register=wall`) with a session watching. Run it before L1's demo-seed purge (decision 6) · Blake (§5 items 2, 4, 5) + L9/L4 · 3 h · only if invited before Tue 27 and devices on Wed 28 |
| 2 | "Every slot's severity is legible in a crowded day and under reduced motion." | open | **Reduced motion:** tested. packages/web/e2e/day-board.spec.ts:217 "keeps every word and loses every breath under reduced motion"; day-board-state.test.ts:459 "every state is legible without colour…". **Crowded day:** no fixture. The e2e has 4 rooms and 7 bookings; the visual harness has 4 rooms. Goal 19 D12 defines dense as 8 lanes, 30 slots, 12 open requests. | A dense-day fixture under both motion settings, with legibility assertions · L4 · 3 h · yes |
| 3 | "The sheet for the linked wedding lists exact counts by type and its release id matches print." | open | The phone stamp and the PDF share `describeSheetCopy` (packages/web/src/components/hallkeeper/PaperCopyStamp.tsx:30; packages/api/src/services/hallkeeper-pdf-v2.ts:121-128). PDF counts are tested on a fixture wedding (hallkeeper-pdf-v2.test.ts:92, :294). No test compares phone and print counts or release id for the linked demo wedding. T-669 (the sheet redesign) is in progress (tasks.md:149). | One API test that compiles the linked wedding's snapshot and asserts the per-type counts and release line are equal in the web payload and the PDF text · L9 · 5 h · yes |
| 4 | "Offline actions reconcile without loss." | open | **Queued:** `task_status`, `issue_create` and `observation_record` only (packages/web/src/lib/event-day-offline-queue.ts:13-32), tested at event-day-offline-queue.test.ts:40. **Not queued:** request acknowledge, accept and resolve fail to an error and a refresh (RequestsProvider.tsx:231-242), so an offline tap is lost. **Known limit:** a replayed tap is credited to whoever is signed in at drain time (tasks.md:166). | A `request_transition` op with its idempotency key and the original actor, drained in order, with tests (closes 19·10 too) · L4 · 6–8 h · yes |
| 5 | "An admin corrects stock and sees the shortage and its remedies without an engineer." | tested | packages/types/src/__tests__/venue-inventory.test.ts:88 "exposes a ten-chair shortage and the affected event without clamping physical stock"; packages/web/src/components/dashboard/inventory/__tests__/InventoryPanel.test.tsx:81 "saves exact changes with an audit receipt and refreshes visible stock"; InventoryDemand.test.tsx:184 "prepares then separately approves an internal request without adding supply". Limits: the inventory Postgres suites skip in CI. No admin has entered real counts on production; that is L9's own done-when. | — |
| 6 | "The usability targets are met and reported with n." | open | Not run (docs/reports/living-timetable-2026-10.md:39). **Gap:** n = 0 against S6's five people across roles. | The run and a report with n and every failure · Blake (§5 items 2, 4) + L9 · 3 h + 1 h · only if Tue 27 happens with the people |

## Goal 06 · One event, end to end

[goals/06-one-event.md](../../goals/06-one-event.md). Lane L5. Plan 19 §4 already lists L5's Stripe deposits and
e-signing as at risk.

| # | Done-when line (verbatim) | Status | Evidence | To close: work · who · hours · by freeze |
|---|---|---|---|---|
| 1 | "A client and a coordinator complete S2 to S9 on staging without retyping anything." | open | **Staging:** none (goals/19:167). **S6:** missing. The only Stripe code is the subscriptions table (packages/api/src/db/schema.ts:1370-1383); there is no deposit or e-sign code. **S8:** missing; nothing computes guest-count or time-move impact. **Spec:** `packages/web/e2e/one-event-journey.spec.ts` does not exist. | Test-mode deposit and e-sign with retry and failure paths; the 150→180 and +30-minute impact path; a scripted two-identity walk of S2–S9 on a preview · L5 (+L6) · 80+ h · no |
| 2 | "Each of the twelve pain points has a passing acceptance test or a recorded reason it waits." | open | Nothing maps the twelve. "pain point" appears nowhere in packages/. Fragments exist: #4 at proposals-client-response-postgres.test.ts:177; #5 in admin-hold-reminders.test.ts; #6 at inventory-reservations-postgres.test.ts:135, skipped in CI. #12 has no export route. **Gap:** 0 of 12. | A pain-point acceptance ledger, one test per point from existing tests where they fit, and a recorded reason for each that waits · L5 · ~10 h · yes |
| 3 | "Accepted versions are immutable under test." | open | **Route locks:** route-level only, with a platform-admin bypass. proposals.ts:706-713; quotes.ts:313-314. quote-permissions-postgres.test.ts:397 asserts that a platform admin edits (200), appends to (201) and deletes from (204) an issued quote, while a venue admin gets 422. **No DB trigger** on proposals, quotes or proposal versions. **Phase snapshots:** immutable in the database (0063), but that suite is skipped in CI. | Triggers refusing UPDATE and DELETE on accepted versions and issued or accepted quotes; remove the override or allow supersession only (decision 4); platform-db tests · L5 · 4–6 h · only if decision 4 removes the override |
| 4 | "The real event closes with matching released instructions, acknowledged changes, actual timings and recorded exceptions, and no critical wrong-version handoff." | open | No real event run; plan 19 lists it open and schedules it for Thu 29. Change acknowledgements exist (packages/api/src/routes/event-plan-lifecycle.ts:249, :269). No release manifest ties instructions to an approved release. | Trades Hall nominates an event; record release id, acknowledgements, observations, exceptions; close-out report · Blake (§5 item 4) + L5/L9 · ~12 h support · only if the event runs and closes before Thu 18:00 (unlikely) |
| 5 | "Pain point 11 is judged by goal 01's sublime test on every surface of the journey." | open | No filled sublime test for any journey surface. The S6 surfaces do not exist. | Fill the test per journey surface after decision 1; Blake's walk · L10 + Blake (§5 item 8) · ~8 h · no |

## Goal 07 · The front of house

[goals/07-the-front-of-house.md](../../goals/07-the-front-of-house.md). Lane L7, which plan 19 §4 lists at risk.

| # | Done-when line (verbatim) | Status | Evidence | To close: work · who · hours · by freeze |
|---|---|---|---|---|
| 1 | "The sublime test passes on every client-facing surface." | open | No filled sublime test for any client-facing surface. No `docs/reports/front-of-house-*.md`. The test itself is unratified (decision 1). Partial correctness only: client-surface-contrast.test.ts:63 (7:1) and :109 (44 px targets). | Fill ten lines each for home, room pages, walk/tour, enquiry, proposal and workspace; timed person and the weakest device · L10 + L7; Blake (§5 items 5, 8) · 12–16 h + Wed 28 · no |
| 2 | "Web vitals meet the p75 thresholds on production for desktop and phone." | open | Nothing in packages/web/src reports vitals. No `e2e/front-of-house-vitals.spec.ts`. **Best record:** live production LCP 5.2 s, lab, one PC, 7 runs (docs/sessions/2026-10-20.md:61); per-run LCP 4.4–7.2 s after #149 (:66-71). Not field p75, not split by device class. INP and CLS never measured. **Gap:** LCP 4.4–7.2 s lab vs ≤2.5 s p75. | Defer below-the-fold room images (the next lever named at :92-94); vitals reporting by device class; the spec · L7 · 8–12 h · no for field p75 (invite-only traffic cannot produce one by Thursday) |
| 3 | "The three P0s from the July critique are closed." | tested | **Enquiry dead end:** closed. The home composer at `id="enquire"` (packages/web/src/pages/RoomsHomePage.tsx:348) posts to `/public/enquiries` (packages/web/src/api/configurations.ts:253). FreshEnquiry.test.tsx:32 "posts the drafted enquiry on the venue path as a website enquiry, then confirms it"; :70 "keeps the draft and the telephone when the post fails". **Capacities:** closed; one source (packages/types/src/trades-hall-venue-truth.ts). trades-hall-venue-truth.test.ts:39 "matches the client-supplied numbers exactly"; RoomsHomePage.test.tsx:97 "carries the capacities by layout, the wedding rates and the composer". **og:image:** closed. packages/web/index.html:61-66, a real 1200×630 photograph; venue-structured-data.test.ts:166 asserts the tag. | Limits: not re-checked against tradeshallglasgow.co.uk today. Two rooms show no capacity (docs/sessions/2026-10-22.md:22-23). Goal 07's own "Decided" rule that og:image be a court render is not met (it is an aerial photograph). That rule is not a done-when line. |
| 4 | "Elaine's client goes from the home to a sent enquiry in under two minutes without a dead end, on a phone." | open | Partial. front-door-responsive.spec.ts:81 "every Ask about a date reaches the composer…". The 22 Oct live walk found the composer working in a desktop pane: untimed, no client, no enquiry sent (docs/sessions/2026-10-22.md:21-22). | A client (or Elaine) on a real phone, stopwatch and screen recording, enquiry row id noted · Blake (§5 item 4) + L7 · 1 h · only if Tue 27 or Wed 28 happens |
| 5 | "Every retired route redirects." | open | **Redirect:** four of five. `/landing`, `/welcome` and `/living-hall` go to "/" (packages/web/src/router.tsx:410-411, :424-425, :434-435; front-door-routes.test.tsx:26-35). The edge also sends `/tour` to the twin (packages/web/vercel.json; vercel-redirects.test.ts:124, :139). **Not redirected:** `/fresh` still serves FreshPage (router.tsx:430-431), and room cards link to `/fresh#enquire`. | Redirect `/fresh` to "/", repoint the room cards' enquiry link, extend both tests; or Blake records that `/fresh` stays (decision 5) · L7 · 1–2 h · yes |

## Goal 08 · The Foundry

[goals/08-the-foundry.md](../../goals/08-the-foundry.md). Lane L2. No paid training before Blake approves L2's
formula and budget (plan 19 §5 item 7). The done-when is one sentence; its clauses are split at the semicolons.

| # | Done-when line (verbatim) | Status | Evidence | To close: work · who · hours · by freeze |
|---|---|---|---|---|
| 1 | "An owned Grand Hall beats gh2-vendor at the court on the floor band and the whole frame and is served behind the flag at goal 02's gates" | open | No court, no `gh2-vendor` baseline, no `?twin=fused` flag in packages/web/src. The owned panorama splat reaches 22.5 dB held-out under T-658's protocol (t658:53-55). Splats are held in production. | L2's formula (Mon 26), Blake's budget, a paid run, the court, the flag, goal 02's gates (all open) · L2; Blake (§5 item 7) · 40+ h · no |
| 2 | "two runs are reproducible from their receipts" | open | `state/training_runs.jsonl` has 0 lines, and nothing writes it. Partial: the T-658 control (22.527) and the T-655 control (22.522) differ by 0.004 dB on the same recipe (t658:53-55). Their receipts are off-repo under `D:/claude/recon-round2-20261016`. | Backfill rows for those runs (package hash, steps, cost, protocol); record the pair as the reproduction · L2 · 3 h · only if the D: workspace holds the hashes |
| 3 | "one real chair and one real table are in the catalogue" | open | No Trades Hall-measured chair or table (as 03·5: asset-catalogue.ts:172-186). | F5 on Tue 27, then catalogue entries with measured footprints · L3; Blake (§5 item 4) · 8 h · only if Tue 27 measurement happens |
| 4 | "the register has verdicts, not names" | open | No register with adopt, revise or park verdicts. **Outcomes for two candidates:** LiDAR line-of-sight depth "hold", −0.070 dB; anti-aliased training promoted at screening but not adopted (t658:103-107). **Licence rows:** some candidates have them (docs/reports/omnitwin-foundry-technology-license-matrix.md). Neural Harmonic Textures, GR3EN, GSFixer/Difix3D+ and MASt3R have none. | A register with a verdict per candidate from existing evidence; untested ones as "park, untested" · L2 · 4 h · yes |
| 5 | "the pod is stopped." | measured | Recorded state, not live-checked: the last pods were "terminated and unregistered", round total $25.04 (docs/sessions/2026-10-16.md:182-183). No pod is recorded in any log dated 17–22 Oct. | Re-check live through RunPod at the tag, since L2 may start pods after Blake's budget · L0/L2 · 0.25 h |

## Goal 09 · The venue's mind

[goals/09-the-venues-mind.md](../../goals/09-the-venues-mind.md). Lane L6.

| # | Done-when line (verbatim) | Status | Evidence | To close: work · who · hours · by freeze |
|---|---|---|---|---|
| 1 | "A date change, a guest-count change, a stock shortage and an unanswered request each run from suggestion through approval, execution and current instructions on staging, and the hard cases pass: no feasible option, contradictory facts, concurrent changes, permissions, stale approval, duplicate execution, partial failure, revocation, recovery." | open | **No general decision object.** The only one is `inventory_decision_commands`: reservation approve/revoke and remedy prepare/approve (schema.ts:450-458; routes/inventory-reservations.ts). **Stock hard cases:** tested in inventory-reservations-postgres.test.ts (authority :148, duplicate :179, concurrency :195, stale :261, revocation :299, partial-failure rollback :379), but skipped in CI. **Missing:** date change, guest-count change, unanswered request, no-feasible-option and contradictory facts. canManageVenue still admits staff and hallkeepers (packages/api/src/utils/query.ts:23-36). No staging; no `e2e/decision-approval.spec.ts`. | M1 types and storage, M2/M3 wiring for time, guest count and request, the nine hard cases, a preview run · L6 (+L5, L4, L9) · 80+ h · no |
| 2 | "A real brief (HUMAN.md 13) yields alternatives Elaine finds useful with a no-fit case." | open | The engine's no-fit is tested: packages/types/src/__tests__/event-architect-engine.test.ts:163 "emits a causal seating repair when the room cannot hold the requested dinner layout". No real brief recorded (HUMAN.md item 13 is off-repo). No Elaine verdict. | Run three real briefs; record Elaine's words · Blake (HUMAN.md 13; §5 item 4) + L6 · 6–10 h · only if briefs arrive before Tue 27 and Elaine reviews then |
| 3 | "Scenarios replay bit-identically by seed." | tested | packages/types/src/__tests__/guest-flow-replay.test.ts:115 "is deterministic for the same seed" (equal `artifactHash` and trajectories); :123 "changes output when the seed changes". Limits: in-process, v0 grid navmesh. The bar-queue scenario T-306 is not started (tasks.md:709). | — |
| 4 | "Every recommendation cites the venue's evidence." | open | **Cite evidence:** the Architect cites witnesses (event-architect-engine.test.ts:116); pricing advice cites too (pricing-advice.test.ts:164). **No evidence:** stage next actions are fixed text (deal-next-action.ts:5-25). No inventory of recommenders, no universal check. | List every recommender, attach source, freshness and scope, add a contract test · L6 · 8–12 h · yes |
| 5 | "The admin-effort baseline is measured before any improvement factor is stated." | open | Nothing measures admin effort. docs/engineering/enquiry-baseline-plan.md:5 "Nothing here has been run", and it measures reply time, not handling time. No improvement factor is claimed in web source. | Time matched tasks (handling time, interruptions, rework) with Elaine; record in docs/reports · L6 + Blake (§5 item 4) · 6–8 h · only if measured on Tue 27 |

## Goal 10 · The platform

[goals/10-the-platform.md](../../goals/10-the-platform.md). Lanes L8 and L1.

| # | Done-when line (verbatim) | Status | Evidence | To close: work · who · hours · by freeze |
|---|---|---|---|---|
| 1 | "The second venue completes the same event loop without a venue-specific code fork." | open | No second venue: plan 19 §5 item 6 has no contact; T-030 not started (tasks.md:476). 17 `"trades-hall"` literals remain in non-test web source, e.g. packages/web/src/hooks/use-room-runtime-splat.ts:31. | A venue contact; remove the hard-codings; onboard through the product; run goal 06's loop · Blake (§5 item 6) + L8 · 16–24 h after the contact · no |
| 2 | "The restore drill passes inside its target time." | open | docs/operations/backup-restore-drill.md:4 "Status: procedure, not a completed restore". All 12 evidence rows read "Not performed". T-062 not started (tasks.md:214). No target time is defined. | Set the target (e.g. ≤60 min), restore a Neon point-in-time branch, run steps 3–7, fill the table, destroy the branch · L1 · 3 h · yes (needs Neon project access) |
| 3 | "CI's overall conclusion is meaningful and the API deploys on push." | open | **Deploys on push:** met in practice. Railway deployed #154 and #140 by itself (docs/sessions/2026-10-22.md:276-280). **CI:** audit, four E2E shards and browser gate are full jobs, none `continue-on-error`. But a red conclusion stops nothing: master is unprotected (plan 19 §2), and Railway migrates and deploys on push independent of CI (docs/operations/deploy-flow-current.md:36-41). That breaks goal 10's own rule, "migrations run in the deploy after a passing gate" (goals/10:20). **Flaky gate:** the browser gate needed three attempts on `1d2e417f` (run 39879311288). | Branch protection requiring CI (setup sitting); land #168's flake fixes; gate Railway on CI or record why the pre-deploy migrate precedes CI · Blake (§5 item 2) + L8 · 4–6 h · only if the setup sitting happens |
| 4 | "Exports work." | open | No venue data export. The exports present are single PDFs: the hallkeeper sheet and the guest plan (visitor-plan-postgres.test.ts:136). Goal 10 asks for open formats and forbids "an export that omits the venue's assets" (goals/10:56). | An admin-only venue export (JSON/CSV per table plus an asset manifest) with a tenancy test · L8 · 8–12 h · yes (L8 is not yet staffed; plan 19 §4 lists it at risk) |
| 5 | "Tenant isolation is proved by tests." | open | Partly tested: dozens of cross-venue cases, e.g. people-routes-postgres.test.ts:170. The platform gate list is at packages/api/src/scripts/run-platform-postgres-tests.ts. No test walks every venue-scoped route. A cross-venue existence leak (422 `VENUE_MISMATCH`) was fixed only on 22 Oct (#154). | A route-table test iterating Fastify's routes, asserting 403/404 for a second venue's staff on every venue-scoped route, with an exemption list · L8 · 6–10 h · yes |
| 6 | "The frontier register has activation criteria for every item." | open | docs/plan/08-FRONTIER-MOONSHOTS.md: 16 ideas tagged Now/Next/Research, no prerequisite or activation criterion anywhere. Most items goal 10 names (Accessibility Journey Twin, Event Passport, Verified Component Cloud, Yield Network…) are absent. | The register: one row per item with prerequisite, activation criterion, first bounded experiment · L8 or L0 · 2–3 h · yes |

## Goal 12 · An intelligent venue platform

[goals/12-intelligent-venue-platform.md](../../goals/12-intelligent-venue-platform.md). No "Done when" heading: the
six completion gates are its done-when lines, quoted in full below. T-605 is "deferred" (tasks.md:193), its second
increment off-repo. Lanes L6 with L5, L8 and L1. No gate can close by the freeze.

Verbatim, 12-intelligent-venue-platform.md lines 165–211:

> 1. **One event, consistent outputs.** A persisted enquiry/brief progresses through
>    feasible options, exact quote/proposal, booking, editable layout, inventory,
>    approved operational release, staff instructions and recorded actuals. Exercise
>    a 150-to-180 guest request, a 30-minute time move and a shortage. Include a
>    known-feasible case for each that executes through a coherent revised release,
>    and separate infeasible cases that explain the concrete no-fit. Preserve
>    matching release identifiers on phone/print outputs and track required acknowledgements.
>    Commercial acceptance, payment, internal approval and operational completion
>    remain distinct. Any dependent stale output is invalidated, never silently current.
> 2. **Portability.** Repeat the supported journey for two venue configurations and
>    dinner/theatre formats, including a room flip, without venue-specific code.
>    If a second customer is unavailable, use a clearly labelled synthetic fixture
>    with different inventory, policies, currency and timezone; claim portability,
>    not customer onboarding or market validation.
> 3. **Integrity and recovery.** Real disposable PostgreSQL tests and worker failure
>    drills prove isolation, concurrent changes, stale/revoked approval, duplicate
>    execution, restart and partial-failure recovery. Test isolation in retrieval,
>    caches, jobs, artifacts and exports as well as routes. No unresolved known critical
>    defect in the delivered journey. Preserve failing evidence and address causes.
> 4. **Intelligence evidence.** Before tuning, freeze a representative suite of
>    valid, ambiguous, impossible, stale, adversarial and cross-tenant requests with
>    independently reviewed expected outcomes and justified numerical acceptance
>    thresholds. All defined hard-boundary cases must pass. Require the declared
>    task-success and unsupported-claim limits and a measured benefit in success or
>    correction effort over the current manual/deterministic journey, with latency
>    and cost inside their budgets. Do not lower thresholds after seeing failures.
>    Publish sample sizes and limits. Real-model, retrieval/ranking, feedback and
>    GPU paths execute and their results enter the journey; a standalone benchmark
>    is insufficient. A documented lack of training data may retain baseline ranking
>    with the working data pipeline; this does not establish a venue-trained model
>    or ML improvement. Negative experiments remain evidence, not promoted features.
> 5. **Performance and operation.** Establish workload/device-specific budgets from
>    the existing product contract before optimization. Freeze workload, baseline,
>    target and tolerances. Meet the declared improvement target, or an already-met
>    applicable product budget without regression; do not chase optimization beyond
>    the agreed gate. Record API/job p50/p95, UI responsiveness, resource use and cost;
>    include a multi-tenant load test and a noisy-neighbour case. Rehearse backup/
>    restore and migration/release recovery on disposable infrastructure. Publish
>    observed capacity and bottlenecks, not an unsupported global-scale claim.
> 6. **A shipped, verified release.** Relevant tests, typechecks, lint, dependency audit,
>    builds and actual rendered desktop/mobile workflows pass on the final integrated
>    candidate. Make applicable CI gates execute meaningfully; name unrun platform,
>    live-provider or physical-device checks. Deliver coherent commits, migration
>    and rollout/rollback instructions, benchmark/eval receipts, an updated engineering
>    map and a concise next-stage roadmap tied to demonstrated bottlenecks. Coordinate
>    integration, deploy the qualified candidate and verify the changed production
>    journey. A handoff or rollout document does not complete this gate.

| Gate | Status | Evidence | To close: work · who · hours · by freeze |
|---|---|---|---|
| 1 One event, consistent outputs | open | **Met in part:** event and booking cores with digest preconditions; stock-shortage decisions (09·1); change acknowledgements. **Not met:** guest-count and time-move decisions, a release manifest binding quote, layout and approvals, matching release ids on phone and print, no-fit for the change classes. docs/engineering/intelligent-platform.md:108 confirms these remain. | Decision executor and an immutable release manifest · L6 + L5 · 60+ h · no |
| 2 Portability | open | No second venue and no synthetic fixture journey. The Architect and snapshots accept GBP only (packages/types/src/event-architect.ts:87, 146; canonical-layout-snapshot.ts:85). | A labelled synthetic venue (other currency and timezone), dinner/theatre and a room flip · L8 (+Blake §5 item 6) · 24–40 h · no |
| 3 Integrity and recovery | open | **Met in part:** a real-Postgres CI gate covers event and booking mutations and quote permissions. **Not met:** inventory decision tests skip in CI; no worker restart or failure drills; no retrieval, cache or export isolation (no retrieval exists); restore drill open (10·2). | Add the decision suites to CI, worker drills, the restore drill · L6 + L1 · 24–40 h · no |
| 4 Intelligence evidence | open | No frozen, reviewed eval suite on master. The brief eval has no recorded run ("Live accuracy unmeasured", tasks.md:167). AI drafting is off in production. No retrieval or ranking, no feedback pipeline, no goal-12 GPU path. | Freeze the suite, real-model run, retrieval baseline, feedback path · L6 · 40–80 h · no |
| 5 Performance and operation | open | No load, multi-tenant or noisy-neighbour test anywhere. Restore not rehearsed. | Frozen budgets, a load test, backup/restore rehearsal · L6 + L1 · 16–24 h · no |
| 6 A shipped, verified release | open | Only the first increment was ever deployed (API `7f2a701b`, tasks.md:78). Gates 1–5 are open. | After gates 1–5: deploy and verify live · L6 + L0 · no |

## Goal 16 · Remove the release dependency security blockers

[goals/16-release-dependency-security.md](../../goals/16-release-dependency-security.md). No "Done when" heading:
its "Required evidence and completion criteria" 1–6 are the lines, quoted in full below. Delivered 15 September on
`641f2667`. Plan 19 §2 lists it closed.

Verbatim, 16-release-dependency-security.md lines 52–96:

> 1. **Current baseline and applicability.** Retain the failing audit, exact source,
>    package-manager/runtime versions, dependency paths and authoritative advisory
>    references. Distinguish production from development exposure and inspection
>    from exploitation evidence. Do not invent an incident or silently waive a
>    finding because its current path appears constrained.
> 2. **Reproducible patched dependencies.** Use compatible exact pins and a reviewed
>    lockfile, followed by a clean frozen-lockfile install. Confirm no affected
>    version survives in the in-scope installed or shipped dependency closure.
>    Run the existing pnpm audit gate at moderate severity and above without
>    suppressions, exclusions or a weaker threshold. Report any lower-severity
>    findings separately. If a new advisory changes scope, investigate and record
>    it rather than assuming the historical count is exhaustive.
> 3. **Real native-library verification.** Build the actual Linux API image with
>    its production architecture and package layout. Record installed Sharp and
>    relevant native decoder versions from that image. Exercise accepted and
>    rejected image/WebP paths with safe fixtures; retain format, size and boundary
>    checks. Preserve original captures. Source pins or a Windows install alone
>    are insufficient evidence for the deployed Linux runtime. Bind this proof
>    to the deployed artifact: inspect those versions in the running container,
>    or verify its immutable image digest matches the qualified image, including
>    architecture and libc. A matching source commit alone does not establish
>    which native libraries the live process uses.
> 4. **Preserved behavior.** Run affected image/foundry/capture-tool tests and
>    appropriate workspace tests, lint, typecheck and builds. The Vitest change
>    must pass existing mandatory platform/event-access/route PostgreSQL gates
>    against explicit disposable databases, with migration/replay receipts and
>    no hidden required skips. Preserve the53-case event-access baseline and
>    current test inventory; do not make a changed test count the definition of
>    success. Exercise actual rendered saved-planner, Flow warning open/dismiss
>    and event-schedule navigation on the qualified build.
> 5. **Independent review and delivery.** Review the dependency diff, native
>    runtime proof and regressions. Preserve newly released Flow/camera/caption
>    behavior and F03 authority guards. Recheck current release ownership and
>    source before integration. Deliver through the existing serial API/web path,
>    verify provider/custom-domain/source/readiness, and check an existing
>    authorized live journey. Where the release changes smoke identities, retain
>    a backup and rotate only the existing public smoke configuration after its
>    unchanged checks pass; preserve scheduler/runner settings.
> 6. **Honest closeout.** Deliver
>    docs/reports/release-dependency-security-2026-09-15.md with before/after audit,
>    exact source and artifact identities, installed/native version evidence,
>    checks, deployment/live receipts and remaining limits. Update T-612, this
>    goal, F-15's execution record and the dated session. Mark complete only when
>    this security slice is delivered and verified; separate unrelated existing
>    E2E/platform failures instead of declaring the full Friday release ready.

| # | Status | Evidence | To close: work · who · hours · by freeze |
|---|---|---|---|
| 1 | measured | Baseline audit on `54ebfc61`: 2 high and 6 moderate, Node 22.18.0, pnpm 9.15.4 (docs/reports/release-dependency-security-2026-09-15.md:21), with per-dependency applicability. | — |
| 2 | measured | `pnpm audit --audit-level=moderate` exits 0 with zero findings and nothing muted (report:33); clean frozen install (report:39). **Still holds on master:** sharp 0.35.5, js-yaml 4.3.2, vitest 4.1.12 (pnpm-lock.yaml:3888, :3185, :4242). New advisories reopened the audit in October; #163 fixed vitest on 22 Oct. The last code commit passed Security Audit (run 39879311288). | — |
| 3 | deployed | The running Railway process reports Sharp 0.35.4, libvips 8.18.6 on musl (report:58-61, :70). Railway `a4963f16`, image digest `sha256:7bd73a67…`, source `641f2667` (report:131-133). Later API images carry Sharp 0.35.5, checked only by CI's native-image job. | — |
| 4 | measured | Platform 60/0 and event-access 53/0 on disposable databases (report:82-83); route atomicity 13/13 (report:87); workspace 12,387 passes, 258 disclosed skips (goals/16:135-137). | — |
| 5 | deployed | PR15, Railway `a4963f16` and Vercel `6455104527` at `641f2667` (report:131-133; goals/16:128-131); public smoke 15/15 (report:144). | — |
| 6 | open | Report delivered and goal updated (goals/16:126-147). **Missing:** the task list has no T-612 row (T-612 appears only as a dependency of T-613, tasks.md:184). No F-15 execution record is on master. The 15 Sep session log has no goal 16 closeout. | Add a T-612 row and a 15 Sep session entry pointing to the report; F-15's record needs Codex's copy or a note that it was never committed · L13 · 0.5 h · only if F-15's record is recovered or Blake accepts the note |

## Goal 17 · Restore trustworthy browser release checks

[goals/17-browser-release-confidence.md](../../goals/17-browser-release-confidence.md). Its numbered items 1–6 are
the lines, quoted in full below. Complete 15 September on `ac338696`. Plan 19 §2 lists it closed.

Verbatim, 17-browser-release-confidence.md lines 24–55:

> 1. **Owned baseline.** Recheck remote/live lineage and concurrent ownership.
>    Use a clean isolated checkout and owned dependencies, not the shared dirty
>    tree. Inventory the complete test count, existing skips and failures across
>    every shard. Retain precise commands, configuration and source identity.
> 2. **Repair real causes.** Exercise failed flows in the actual rendered app.
>    Update a locator only after verifying the current intended accessible
>    interaction. Repair application defects at their owning boundary. Fix
>    fixture/environment drift explicitly; mocks do not prove the live API.
> 3. **Visual evidence.** Inspect missing or changed reference images in the
>    intended Linux browser environment before accepting them. Do not blanket
>    regenerate screenshots, remove failing scenarios, widen image tolerances,
>    lower frame targets, add unconditional skips or swallow errors to get green.
>    Explain any obsolete assertion and preserve its useful behavior contract.
>    Keep founder aesthetic acceptance distinct from technical screenshot checks.
> 4. **Complete qualification.** Run the affected cases, relevant unit/type/lint/
>    build checks, then all four browser shards against the final source. Every
>    scheduled non-skipped test must execute; disclose the exact remaining
>    pre-existing skip inventory rather than presenting skipped coverage as
>    qualified. Investigate unstable retries. Retain current security and required
>    PostgreSQL gates when combining with Goal16; do not edit its dependency pins.
> 5. **Review and delivery.** Independently review application/test changes and
>    visual evidence. Integrate coherent exact-path commits through T-601, serially
>    with Goal16's qualified dependency candidate. Verify hosted browser results
>    on the actual combined commit. Any product change includes deployment,
>    provider/source checks and the affected existing authorized live flow.
>    Test-only changes still require hosted CI evidence on the integrated commit;
>    do not force an unrelated API redeployment.
> 6. **Closeout.** Record before/after results, source/artifact IDs, screenshots,
>    hosted outcomes and live evidence in
>    `docs/reports/browser-release-confidence-2026-09-15.md`. Update this goal,
>    T-613 and the dated session. Completion requires a trustworthy complete
>    browser gate and applicable delivery, not merely creating this document.

| # | Status | Evidence |
|---|---|---|
| 1 | measured | Owned baseline: 84 failed, 114 passed, 37 skipped, 116 never executed across the four shards (goals/17:164-165). |
| 2 | measured | Defects repaired (camera-panel stacking, mobile catalogue, 44 px targets) and merged as PR16 `26184f42` (goals/17:86-87, :166-168). |
| 3 | measured | 22 Linux state-visual cases pass; zero retries and no snapshot updates (goals/17:174, :190). That nothing was blanket-regenerated is the report's own statement. |
| 4 | measured | CI35025245123 attempt 2: all 13 jobs. 353 cases: 307 passed, 4 expected failures, 42 disclosed skips, 0 flaky or retried. Native 12/12; PostgreSQL 60/60 and 53/53 (goals/17:89-96). |
| 5 | deployed | Web and API on `ac338696` (goals/17:83-85); Deploy35031328009 with 0 pending migrations (:98-101); provider receipts and signed-in live checks (:104-122). |
| 6 | inspected | The report is on master (docs/reports/browser-release-confidence-2026-09-15.md), with the T-613 row (tasks.md:184). |

**Regressed on master since.** The trustworthy gate held on `ac338696`; on master it no longer holds.

- Item 4's "Investigate unstable retries" is unmet today. The browser release gate failed attempts 1 and 2 on
  `1d2e417f` and passed on 3 (run 39879311288). #163's run 39847320950 failed.
- PR #168 (T-673) is the open fix; T-673 has no row in the task list on master.
- This does not reopen the September lines. It is a precondition of plan 19 §7's "Full CI on the candidate", and L12
  should not accept a candidate that is green only on a retry.

## Goal 18 · Ship Friday (historical)

[goals/18-ship-friday.md](../../goals/18-ship-friday.md). The file says "historical, not a live instruction"
(goals/18:3-7). `release/r1` never reached master. Its lanes were re-integrated under T-635, and #25, #27 and #28
were closed on 22 Oct. None of the three lines can close as written. Only Blake's recorded retirement ends it
(decision 2).

| # | Done-when line (verbatim) | Status | Evidence | To close: work · who · hours · by freeze |
|---|---|---|---|---|
| 1 | "Every gate line in plan 18 §2 that your lane lists is true on the Vercel preview of `release/r1` against the disposable stack, verified by a session other than yours, and recorded in `docs/sessions/2026-09-1x.md` with the command output or screenshot path." | open | `release/r1` never reached master (goals/18:3-7). No preview gate records in the 2026-09-1x logs. No Ship Friday captain row in goals/EXECUTION.md. | Blake retires the goal as superseded · L0 + Blake · 0.5 h · no (as written) |
| 2 | "For the captain: every Tier A lane merged into `release/r1`, the §2 gate run at Thursday 15:00 with a second session verifying, the go/no-go recorded at 18:00, and on Friday the release sequence completed with `/health/version` showing the pushed sha, the live checks done with labelled test ink and that ink deleted, and the release note written." | open | No captain, Thursday gate, go/no-go, Friday sequence or test-ink record on master. | As line 1 · no |
| 3 | "Local, committed, merged, on the preview, on production and accepted by Blake are recorded as six different states; do not collapse them." | open | No per-lane six-state record for Release 1; only "never reached master". | As line 1 · no |

## Goal 19 · The living timetable

[goals/19-the-living-timetable.md](../../goals/19-the-living-timetable.md). T-651, lane L4. Slices S0–S8 are on master
and live, per the [delivery report](../reports/living-timetable-2026-10.md):

- S0–S3: `0586ab03`;
- S4: `180edb5f`, `ee931af0`;
- S5: `2e255070`, `5ebe8688`;
- S6: `91f53a1f`;
- S7: `574ab2ed`;
- S8: `fdf3aeb0`.

S9 (the production run with real people) has not happened. Push is built but off until the VAPID variables are set
(setup sitting).

**How to read lines 2–11.** These lines describe the steps of line 1's production run. Each is classified on its own
text, and the tests prove each behaviour in code. None has been observed on production with real identities. If the
lead reads them as production clauses, they all stay open until line 1's run, and that one run (about 3 h) would close
them together.

| # | Done-when line (verbatim) | Status | Evidence | To close: work · who · hours · by freeze |
|---|---|---|---|---|
| 1 | "The sentence works on production with three signed-in identities." | open | "none is yet" on production with real people (docs/reports/living-timetable-2026-10.md:7). The production hallkeeper invitation is still "In progress" (goals/19:222; T-651 "Not accepted… waits on his hallkeeper invitation", tasks.md:166). | Blake's walk on docs/operations/living-timetable-rehearsal.md with test ink, then delete the ink · Blake (§5 item 2) + L4 · 3 h · only if a hallkeeper is invited by Mon 26 |
| 2 | "A client proposes "Grand Hall, 12 to 4" from the planner." | tested | WhenRibbon.client.test.tsx:101 "every proposal pauses for the question, then goes out as one keyed PUT"; when-ribbon-entry.test.ts:68 "1. 12-4pm reads the bare 12 as midday against the pm end"; window-proposals-postgres.test.ts:124 "lets the client propose a window as a hold the office owns…". The Postgres suite skips in CI (no `VENVIEWER_S6_TEST_DATABASE_URL`). | — |
| 3 | "The office inks it and the price updated with the window." | inspected | **Ink:** tested. WhenRibbon.test.tsx:425 "goal 19 S6: the office confirms a provisional time from the ribbon, after the question". **Price at one window:** tested. :473 "…a Grand Hall evening reads £1,500". **Re-estimate as the window moves:** source only. A debounced effect keyed on `shownStartMs`/`shownEndMs` calls `estimatePrice` (packages/web/src/components/editor/cockpit/WhenRibbon.tsx:890-925). | For the line 1 run, enter Trades Hall's rates: production holds no pricing rules, so the line reads the no-slot note (docs/sessions/2026-10-16.md:125) · L4/L5 with Trades Hall's sheet · 1 h |
| 4 | "The Day Board shows the slot green an hour before setup, amber half an hour before doors and red while live, on the corrected time." | tested | day-board-state.test.ts:129 "organisers due: inside 60 min of the SETUP opening, green, a four-second breath"; :155 "guests due: inside 30 min of doors, amber, a three-second breath"; :175 "live: red, the room's heartbeat, with time elapsed". Corrected clock: clock-offset.test.ts:27 "takes the median of the last five offsets…". | — |
| 5 | "The client asks for ten more chairs and the copper ring is on the slot on the wall and on a phone within a second." | open | Measured on a live local stack only: ring 358 ms and 211 ms after send, one desktop-size headless board (docs/reports/living-timetable-2026-10.md:31; docs/sessions/2026-10-10.md:48). Not timed on the wall register, on a phone or on production. D12 allows ≤1,500 ms there. | Add wall and phone contexts to the e2e, then time it on production in the line 1 walk · L4 · 3 h + the walk · only if line 1 happens |
| 6 | "Two hallkeepers tap accept and exactly one owns it." | tested | packages/api/src/__tests__/requests-living-postgres.test.ts:220 "lets exactly one of two colleagues take a request, and names the owner to the loser". It races `f.hallkeeper` against `f.secondHallkeeper`: one win, one 409 `REQUEST_TAKEN`. Runs in CI. | — |
| 7 | "The client sees "Elaine has this" and then the outcome." | tested | requests-living-postgres.test.ts:247 "walks the longer ladder, and the thread records each step for the client"; :280 "resolves with an outcome and lets the client reopen, which clears the owner". "Elaine" is a fixture name. | — |
| 8 | "A staff-private note never reaches the client, and a revoked link is closed at once." | tested | conversations-postgres.test.ts:358 "keeps a staff-private thread out of the client's snapshot entirely"; :264 "closes the client's reads and writes the instant the link is revoked"; :279 "closes the client's door the moment the office deletes the plan the link points at". | — |
| 9 | "The wall display survives the night." | open | "a real night on a real tablet not yet run" (docs/reports/living-timetable-2026-10.md:35). Unit tests only: a 26-hour wall shift, wake lock, a fresh token on reconnect. The stale-band e2e is not built. | Leave a signed-in tablet on the wall overnight; record rollover, wake lock and reconnection · L4 + Blake (§5 item 5) · 1 h + a night · no as scheduled (plan 19 puts it Thu 29 night); yes if run on Tue 27 or Wed 28 night |
| 10 | "A disconnected phone's acknowledgement reconciles on reconnect." | open | Request acknowledgements are not queued offline (RequestsProvider.tsx:231-242; event-day-offline-queue.ts:13-32). The delivery report claims otherwise (see "Doc and source disagree"). | Same work as 05·4 · L4 · 6–8 h · yes |
| 11 | "Nothing any message did changed a time, a layout or stock." | tested | conversations-routes.test.ts:94 "refuses a message that tries to carry a time or stock change", against packages/types/src/conversations.ts:101-104. Inspected: requests and messages write no booking, layout or stock. | — |
| 12 | "The frame and latency numbers in D12 are met and labelled emulated or measured." | open | Only the local ring latency is recorded (line 5). "No phone or iPad measurement yet"; the RTX 4090 claim cites project memory, with no number (docs/reports/living-timetable-2026-10.md:38). No board-render, tick, re-render or frame p95 number on master. | Run `splat-drag-budget.mjs --route /hallkeeper/today` on the dense fixture (emulated now, physical Wed 28); instrument render and tick; time the production ring · L4 + Blake (§5 item 5) · 4 h · only if devices are there Wed 28 |
| 13 | "The usability targets are reported with n." | open | Not run (report:39). | Blake (§5 item 4) + L4 · 2 h · only if Tue 27 happens |
| 14 | "Blake has judged the board, the ring and the ribbon with his eyes." | open | No recorded words from Blake on the board, ring or ribbon ("Not accepted: Blake's eyes", tasks.md:166). | Acceptance walk 1 (Mon 26) with the words recorded verbatim · Blake (L10) · 0.5 h · only if Blake walks it on Mon 26 (walk 2 is after the freeze) |

## Goals with no file on master: 11, 13, 14, 15, 20, 21

Plan 19 §1 counts "every goal 00–21", but `goals/` on master holds only 00–10, 12, 16, 17, 18 and 19. What master says
about the others:

| Goal | What master says | Status |
|---|---|---|
| 11 | Plan 19 lane L11: "Grand Hall game environment", with goals 20 and 21; Codex; needs the BG3 Toolkit (§5 item 3). | no done-when text on master |
| 13 | goals/19:25: "the visual quality of the captured room (T-632, goal 13)". Plan 19 §1 says goal 13's PSNR clause needs a founder decision. | no done-when text on master |
| 14 | Plan 19 §2: closed. goals/16:109 refers to "frozen Goal14/15 evidence". | no done-when text on master; the closure cannot be checked here |
| 15 | Plan 19 §2: closed. goals/16:13: "its goal file was never committed to this repository". goals/19:35 says goal 15 settled professions as scoped capabilities. | no done-when text on master; the closure cannot be checked here |
| 20 | Plan 19 lane L11 (Codex). | no done-when text on master |
| 21 | Plan 19 lane L11 (Codex, thread `01a15a5b`). On 22 Oct: v037 current, v038 builds failing on physical memory (docs/sessions/2026-10-22.md:26). | no done-when text on master |

Smallest work: commit each goal file to `goals/` as written, with no edits to its done-when, so the 31 October report
can quote and check it. That is L13 with the lead; Codex holds 11, 20 and 21. About 0.5 h each if the file exists in
the shared checkout or in Codex's thread. Can close by freeze: yes, for the ledgering. The lines themselves then need
their own evidence.
