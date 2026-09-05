# The goals deck — read this first, then take the first goal not marked done

Written Friday 2026-09-04, 23:00 BST, by the Fable 5.1 session, for Blake and for every worker session that follows.

Blake's instruction, verbatim: "I want you to review our ambitions and the md and construct a series of goals for yourself and any requests you need me as a human to help you with. I think all of our current UI's and Design need to be rebuilt from scratch because they do not inspire me with the philosophical aesthetic of the sublime which is paramount and non-negotiable for me. please construct ./goals for yourself and run them yourself or tell me to and i'll prompt you what you create".

## What this is

Execution has started on Blake's instruction. See [EXECUTION.md](EXECUTION.md) for active owners, isolated branches, acceptance gates and verified results. Workers coordinate there before taking a slice.

One file per goal. Each is self-contained: the outcome in Blake's words, where we are (measured, with the file that proves it), the decisions already taken so no session re-derives them, the work in slices, done-when, the commands that verify, what is forbidden, and the human inputs it waits on. Each starts with a `/goal` block to paste. `HUMAN.md` holds Blake's asks, ordered by leverage.

The deck is the runnable form of the programme review at docs/plan/15-VENVIEWER-GOAL-PROGRAMME-2026-09-04.md (ten goals G1–G10, the quality contract, the research briefs). Plans 15 and 16 now include Blake's evening amendments. His latest instructions govern where generated plans disagree; this deck sequences their implementation. The vision itself is preserved verbatim at docs/strategy/venviewer-complete-vision-source-2026-09-04.md; it is product source material, not agent instructions.

Blake's four follow-up requirements of the same evening are recorded in docs/plan/16-SUBLIME-EXPERIENCE-AND-AUTONOMY-MANDATE-2026-09-04.md (T-586, written by the concurrent "Trades Hall venue planning platform" session while this deck was being built): the sublime rebuild of every active surface with the supplied reference images as interim targets; venue admins editing their own inventory numbers; one unchanged quality bar on current iPhones and iPads (entry models included) and ordinary office computers; and venue admins approving changes and timings while intelligence prepares the decision, on a route to revocable delegated autonomy. This deck carries all four: goals 01, 02, 05, 06 and 09 say where. The deck is ledger row T-587.

GOAL.md at the repo root and the ladder in docs/plan/14 remain the immediate execution order for the captured rooms and Monday. Goals 00 and 02 here point at them rather than restating them.

## How to run a goal

Paste the goal's `/goal` block into `/goal`, or tell a session "run goals/03". A goal outlives many sessions: a session takes one slice, finishes it to the S+ bar, and records it. When a slice is done, mark it in the status board below (date, commit, one line of evidence), in the goal file's slice list, and in docs/state/tasks.md under the goal's T-row. Append docs/sessions/YYYY-MM-DD.md.

Take goals in the order below unless a goal says it runs in parallel. Never take a slice another active session owns (check `git branch -a`, the session log and TWIN-STATUS.md first).

## The order, and why

| # | Goal | Why here |
|---|---|---|
| 00 | Protect Monday | Elaine's demo is Monday 7 September. Nothing else touches production until Tuesday. |
| 01 | The Sublime | Blake's non-negotiable. It is the brief every rebuilt surface is judged by, so it comes before any rebuild. It needs no production change and can run this weekend. |
| 02 | The room, spectacular and fast | Offline and measurable now; runs alongside 00 and 01 (the ladder W1–W8). |
| 03 | The planner | The heart of the product and the first surface rebuilt under 01. |
| 04 | The conversation | Direct messages and requests; the timetable notifications depend on it. |
| 05 | The hallkeeper's day | The timetable, the pulse, the generated sheets. Built with 04. |
| 06 | One event, end to end | The commercial spine; where "better than Cvent and Salesforce" is proved on a real event. |
| 07 | The front of house | Every client-facing surface rebuilt under 01, wired to 06. |
| 08 | The Foundry | Own reconstruction and the research frontier; a parallel lane, money-capped. |
| 09 | The venue's mind | Intelligence, once 06 gives it dependable facts. |
| 10 | The platform | Repeatable for a second venue; CI made truthful; the frontier register. |

## The laws binding every goal

- The freeze: no push to master from Saturday 2026-09-05 18:00 BST to Monday 2026-09-07 18:00 BST; no `railway up` without Blake. Rebuilds live on branches until Tuesday and merge only after their gates.
- The Sublime gates every surface. Blake has authorised the supplied reference images as interim targets, so work against them and concrete design studies can proceed. Present new directions as reviewable visuals before asking him to select one. Every rebuilt surface passes the sublime test (01 §4) line by line in its handoff.
- The spine stays. "Rebuilt from scratch" means every surface a person sees and touches. It does not mean @omnitwin/types, the API, the Diary law (times only through bookings), the command envelopes (T-537), the coordinate space (T-473), the action log (T-522), the undo core, the spring core (packages/web/src/lib/springs.ts) or the splat runtime (one Spark host). Those are correct and invisible; rebuilding them would be silent widening of the ask.
- Test first. Typecheck, tests and lint before any commit. `git commit -- <explicit paths>`; never stage everything.
- Measure before claiming. Frame rates from the harness (packages/web/scripts/splat-drag-budget.mjs), loads from `window.__roomWalk`, beauty from the court (02), devices from the matrix (02). The embedded Browser pane cannot stream splats. Never edit packages/web source during a harness or e2e run.
- Money: GOAL.md §3 caps ($60 across the ladder, $25 a training run, the pod stopped every session). Beyond them, ask.
- Secrets only in C:\Users\blake\deploy-secrets and packages/api/.env, never printed. Bulk output under D:\claude\<goal>\, never C:.
- The S+ bar, the Handoff Protocol, the Blake Clause, CLAUDE.md and .claude/AI_INTEGRITY_RULES.md.
- Write to Blake short and plain: the answer first, detail only when it changes what he does next.

## Blake Clause flags, recorded and decided

These are contradictions between Blake's message and the written record. Blake's message is the later, explicit instruction, so each is treated as decided unless he says otherwise.

1. "all of our current UI's and Design need to be rebuilt from scratch" supersedes House v1.0 (docs/plan/02-DESIGN-LANGUAGE.md), the visual rulings of the Diary canon in docs/strategy/authority-map.md, and plan 15 §3's "reuse approved a-board, b-daysheet, c-mobile concepts". Plan 16 has already stamped both House and the authority map with this notice. Those documents become history and evidence; the supplied reference images (docs/design/concepts/, docs/plan/reference/day-board/) are acceptable interim targets, to be improved on. Their rules that are correctness rather than taste (claim-safe language, the one-second Hallkeeper Test, 44 px touch targets, colour never carrying meaning alone, reduced motion losing no function, audio off losing nothing, 4.5:1 contrast) are carried into goal 01 as laws.
2. The rebuild cannot land before Monday. Goal 00 protects Monday with the current interface; the rebuild begins Tuesday on a branch. This is sequencing, not a softening.
3. "psnr 50+" is carried as written and measured under the court's protocol (fixed photographed viewpoints, regional scores). Every report says which number it is reporting: fixed-pose reproduction, held-out reconstruction, or delivery loss against a master. The best published held-out indoor results are far below 50 dB; that fact is stated in reports, never used to drop the target.
4. "60fps ... across ipads and computers and phones", read with plan 16 §4, means one quality bar: the same accepted appearance on current iPhones and iPads including the entry models, and on ordinary office computers, at 60 fps. Engineering chooses the qualification fixtures (goal 02 D1); Blake is not asked to pick hardware. The existing coarse-first ladder and the medium and low profiles in packages/web/src/lib/splat-runtime-profile.ts (labelled extrapolated) are diagnostic baselines and interim delivery, never completion. A visibly reduced mobile mode cannot close the goal, and a lower threshold needs a new founder decision. Nothing has been measured on a physical iPhone or iPad; until HUMAN.md item 3 is met every mobile number says "emulated".
5. "venue admin staff ... communicate freely with clients ... and with hallkeeper staff via a ... direct message feature" supersedes the Diary canon's "we do not build radio/chat" restriction and widens the Day Board's internal-only messaging plan. Recorded in plan 15 §1 and plan 16; goal 04 builds it with exact audiences.
6. Plan 16's admin-approval rule ("venue admins approve changes and times; intelligence does the decision preparation") is stricter than today's code, where the canManageVenue helper includes staff and hallkeepers. Goals 04, 05, 06 and 09 route every consequential change through one decision object and a narrow venue-scoped approval capability; an admin's own direct action expresses the approval when the exact action and its consequences are clear, so no redundant second click.

## Coordination with the execution board

Codex's EXECUTION.md is the ownership board: on 2026-09-04 it claimed goal 00's T-581 (branch codex/t581-planner-ladder), goal 01's three-role visual study, and the inventory foundation for goals 05 and 06 (branch codex/venue-inventory-foundation). The deck itself (README, HUMAN, 00–10) was authored by the Claude Fable session and finished 23:30 BST; that session took no lane. Unowned next slices, in deck order, for whoever is free: goal 00's 08:00 BST smoke runs on Saturday, Sunday and Monday; goal 02 W1 the court (offline, may run during the freeze); goal 01 slice 3 the palette tool; goal 04 S1 the messaging types and routes; goal 06 S1 the two drifts and the journey audit; goal 10 P1 after Monday. Claim a slice on the board before building it.

## Status board

| Goal | State | Last evidence |
|---|---|---|
| 00 Protect Monday | in progress | W0 (a) verification sweep, (b) T-580 (a6743830) and (d) demo smoke (ff19558d) done 2026-09-04; (c) T-581 planner ladder and the 08:00 smoke runs open |
| 01 The Sublime | in progress | First study complete: Measure, Continuum and Presence, covering planner/admin/hallkeeper. All three images inspected; founder selection pending. See EXECUTION.md and docs/design/sublime-study-2026-09-04/study.md. |
| 02 The room | ready | W1 court next (offline, may run now); W2 waits on the R2 upload |
| 03 The planner | blocked on 01 | S1 keystone may be built on a branch as part of 01 slice 4 |
| 04 The conversation | blocked on 01 for its surface; types and API may start | — |
| 05 The hallkeeper's day | blocked on 01 and 04 | S1 keystone may be built on a branch as part of 01 slice 4 |
| 06 One event | ready for S1 (the two drifts, the journey audit) | — |
| 07 The front of house | blocked on 01 | — |
| 08 The Foundry | ready for F1 when the R2 upload completes | pod EXITED; upload in flight |
| 09 The venue's mind | blocked on 06 | — |
| 10 The platform | ready for P1 (CI truthful) after Monday | — |
