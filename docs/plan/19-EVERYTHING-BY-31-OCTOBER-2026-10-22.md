# Plan 19 — everything finished by Saturday 31 October 2026 (T-672)

Dates rule. 22 October 2026 is a Thursday and 31 October a Saturday; the first version of this plan labelled
every weekday one day early (caught by the planner session the same afternoon). UK clocks go back at 02:00 on
Sunday 25 October: times before then are BST, after it GMT.

Owner: the "Project status assessment" session (local_2cbfece6), programme lead by Blake's choice on 22 October.
Session orchestration (local_04884754) keeps the one-at-a-time merge queue and the 4090. Codex keeps Goal 21.

## Blake's words (22 October 2026, verbatim)

> Our goal is to complete this project by the 31st of october, that includes all final checks, iterations, and
> reviews, completely finished. Your role is to make that happen with all of our goals and ambitions achieved.

His answers the same afternoon, after the assessment told him plainly which done-when lines were at risk:

- Scope: **every goal as written** (00–21 at full bar), on top of the invite-only Trades Hall pilot he chose on 16 October.
- Splats: "you should be able to work out a way to make the splats to the standard we need, but we are also building
  a new venue grand hall room planner redesign for the placing of the furniture."
- Compute: "do ultimate research so you don't need to do as many splat trains, ask me for money when you have found
  a winning formula." No new paid training until a researched formula is evidenced; then the lead asks him.
- Switched on for real use by 31 October: hold-reminder emails, AI drafting, finger drag on phones.
- Payments: Stripe deposits and e-signing built in **test mode**; live only after his Stripe onboarding and
  Trades Hall's terms.
- Lead: this session. He provides this week: the Railway login and the 45-minute setup sitting, Elaine and a
  hallkeeper, physical devices, the BG3 Toolkit and a second-venue contact.

## 1. What "finished" means

1. Every goal 00–21 closed against **its own done-when text**, each line tagged inspected, tested, measured,
   deployed or accepted. A line that needs Blake's acceptance closes only with his recorded words.
2. All pilot gates closed (16 October): monitoring and uptime, a restore drill, branch protection, honest claims,
   legal copy matching the product, Clerk polish, venue admins inviting staff, one real event, his acceptance.
3. Final reviews passed on a frozen candidate (section 7).
4. `v1.0` tagged on a verified master commit, with web and API both serving it and a rollback marker
   (Neon snapshot id and the previous Vercel and Railway deployment ids).

A done-when that measurement does not meet stays open with the measured number. It is never reworded to pass
(goals/README.md: "a visibly reduced mobile mode cannot close the goal"; goal 13's PSNR clause needs a founder
decision, not a silent change). On 31 October the lead reports every goal as closed or as open with its number.

## 2. Baseline, measured 22 October

- Velocity: 95 PRs merged since 10 October. Web live = master `7bc1bb82`. Latest completed master CI green.
- API live = `ced4a1bb` (#148, 20 October): Railway stopped deploying and its CLI/MCP login expired. Not live
  because of it: the #145 enquiry-funnel endpoints (the live web calls them; "Book a viewing" errors), #139's fixes,
  #149's API half. Database is ahead (98 applied, image knows 97), as designed. The nightly cleanup (allergy notes
  included) runs from GitHub Actions on master's code and is healthy.
- Sentry live; one real API bug (VENVIEWER-API-1, loadouts route, `"id" is ambiguous`, `reference-loadouts.ts:62-63`).
  Neon on the paid Launch plan.
- Pilot gates open: uptime monitor, restore drill, branch protection (master unprotected, repo public),
  Clerk ("OMNITWIN", no logo or legal URLs, public sign-up on), keys pasted in chat unrotated, solicitor review,
  staff invitations, a real event, founder acceptance. Closed since 16 October: false claims (#101, #105, #107),
  soft 404s, price writes limited to price setters, Sentry.
- Goals closed: 14, 15, 16, 17. Historical: 00, 18. Absorbed: 04 into 19. Everything else open.
- Hygiene: 12 open PRs (#25, #27, #28 dead since September); the shared checkout is 1,546 commits behind with
  174 untracked files, so new sessions read stale goals; 82 unpushed commits in 38 worktrees; only-copy work is
  backed up privately (D:/claude/rescue, rounds 1–3) but only on this PC.

## 3. Lanes

Each lane owns its files; two writers never share files. New lanes start as sessions Blake can see.

| Lane | Goals | Owner | Done when |
|---|---|---|---|
| L0 Programme and release | all | lead | Plan kept current, daily status to Blake, API redeployed and verified, v1.0 tagged, every goal reported |
| L1 Pilot gates | pilot, 10 | new session | Staff invitations by venue admins; uptime alerts; restore drill with readback; loadouts fix; demo-seed purge after Blake's OK; Clerk legal URLs live; setup sitting guided |
| L2 Splat research | 02, 08, 13 | new session | A researched formula, with local evidence, for the Grand Hall at Blake's standard (sharp, PSNR target honestly measured, 60 fps on phones, first view in seconds) and a costed training plan for Blake; no paid run before his yes |
| L3 Planner | 03 | "Grand hall room planner redesign" (local_d660c313) and the chrome lane | Chrome slices 6–21 to default; the whole-room Grand Assembly; finger drag on phones; p95 ≤16.7 ms at 180 seats on the device day |
| L4 Living timetable | 19, 05 S1–S3/S5 | new session after the sitting | S9 with real identities on production, ring ≤1 s, wall survives a night, hold reminders reviewed then on, VAPID set |
| L5 One event | 06 | new session | Stripe deposits and e-sign in test mode; the 12 pain points as acceptance tests; one real enquiry and event run with Trades Hall |
| L6 AI and the venue's mind | 09, 12 | new session | AI drafting on with guardrails (never states price, availability or capacity), Anthropic named on the privacy page, metering live; M1–M9 and decision history landed |
| L7 Front of house | 07, 01 | new session | Vitals within 07's budgets on declared profiles; retired routes redirect; accessibility gaps closed; every room's capacities sourced |
| L8 Platform | 10 | new session | A second venue onboarded through the product; CI truthful; multi-venue hard-coding removed |
| L9 Hallkeeper's day | 05 | new session after the sitting | Real inventory counts held and adjusted by admins; T-669's six print steps signed in; five-person usability run |
| L10 Sublime acceptance | 01 | lead with each lane | The sublime test filled per shipped surface; Blake's acceptance walks on 26 and 30 October |
| L11 Grand Hall game environment | 11, 20, 21 | Codex (thread 01a15a5b) | Interior to Blake's acceptance, then exterior, then a real BG3 import, traversal and performance (needs the Toolkit) |
| L12 Final review | all | lead | Section 7 passed on the frozen candidate |
| L13 Hygiene | — | lead or a light session | Dead PRs closed after salvage; docs PRs merged; shared checkout refreshed after a backup; an off-machine private backup |

Existing lanes continue under their owners: the pano splat floor (local_9cc748cb), the T-639 relight
(local_140d1839) and the AA question (local_4c29ce0e). L2 reads their evidence first and does not duplicate them.

## 4. Calendar (BST to Sun 25 02:00, GMT after)

**Revision, Saturday 24 October 13:40.** Nothing ran from Thursday night to Saturday midday: the weekly usage limit
stopped the sessions (the chrome builder died mid-slice-7), the Assembly study runner died before its Friday window,
no lane card was started and the setup sitting did not happen. Done before the stop: the API redeploy (Thu 21:05),
#140, #154, #163, #165 (the room fixes, live a day early) and chrome slice 6. The fixed points stand (freeze Thu 29
18:00, final review Fri 30, tag Sat 31); everything in between is compressed. Lanes run in waves under the four-writer
cap; L2 (research) is light and runs beside them.

| Day | Work | Blake |
|---|---|---|
| Thu 22 | Done: assessment; this plan; API redeployed and verified; lane cards proposed | Done: Railway login |
| Fri 23 | Lost to the usage stop | — |
| Sat 24 | Wave A now: Assembly studies re-rendered on the 4090; chrome builder resumes slice 7; L1 starts (sitting first); flaky-test lane starts. Wave B after the 17:00 usage reset: L2 research | The setup sitting (time with orchestration); choose the Assembly direction when the studies land; start the cards |
| Sun 25 | Clocks go back. Assembly build begins on his choice; L3c (finger drag, graphics-reset recovery) takes the flaky lane's slot once file ownership is agreed with the chrome builder; L6 (AI drafting) can start once the sitting has rotated the key | Invite Elaine and a hallkeeper if not done in the sitting |
| Mon 26 | L1 lands staff invitations; L2's formula and costing to Blake; Assembly behind a flag | Acceptance walk 1, evening (room fixes, front door, tour, chrome so far, the Assembly's first form); the training budget |
| Tue 27 | L4 and L5 with Trades Hall: timetable walk, a real enquiry, usability run; L9 starts if a slot is free | Elaine and the hallkeeper, 60–90 minutes |
| Wed 28 | Device day: every surface on real iPhones, iPads and an office PC; splat candidate only if training ran Mon–Tue | The devices; the splat look call |
| Thu 29 | Feature freeze 18:00; the real event run; the wall's night | — |
| Fri 30 | Final reviews on the frozen candidate; fixes only | Acceptance walk 2; go/no-go |
| Sat 31 | Tag v1.0, deploy, verify live, report every goal | Read the report |

At risk after the slip, reported now rather than on the 31st: a retrained splat reaching the product before the freeze
(it needs L2's formula Monday, his budget and paid runs Tuesday); L5's Stripe test-mode deposits and e-signing, L7,
L8's second venue and L9 do not all fit four PC lanes in three working days. Running L5 and L8 as cloud sessions
(code and tests only, no GPU or local data) would take them off this PC's memory; that needs Blake's word.

## 5. What only Blake can do (and when it blocks)

1. Railway device login (now; blocks the API redeploy).
2. The setup sitting (D:/claude/completion-audit-20261016/SETUP-SITTING.md): rotate the Anthropic, ElevenLabs and
   R2 keys; Clerk name, logo, legal URLs, Verify, sign-up mode; GitHub branch protection and a production reviewer;
   uptime monitors; Railway and Vercel variable pass including VAPID and the AI variables; invite Elaine and a
   hallkeeper (Friday 23; blocks L1's checks, L4, L6, L9).
3. The BG3 Toolkit from his Steam account (blocks Goal 11's import gate).
4. Trades Hall time on Tuesday 27 and the real event (blocks 05, 06, 19).
5. Physical devices on Wednesday 28 (blocks every 60 fps line).
6. A second-venue contact (blocks goal 10).
7. Money for training once L2 has a formula; Stripe onboarding; a solicitor for the legal pages; ICO registration
   and a data-processing agreement with Trades Hall if not already in place.
8. Look decisions as lanes reach them: T-671 D1/D2/D4/D11, the Grand Assembly direction, the E8 blend, the pano
   showcase look, the splat hold.

## 6. Capacity rules

- This PC: at most four Claude writing lanes plus Codex at once; heavy local jobs only with 4 GB RAM free;
  Codex's Blender builds overnight where possible. One GPU job at a time under `gpu.lock`.
- One merge to master at a time, through Session orchestration; migrations take numbers from it.
- One agent fan-out larger than five at a time across all sessions; every subagent's model and effort set.
- RunPod: nothing new before Blake approves L2's budget; every pod registered with the reaper.
- If the PC fails, lanes resume from their checkpoints; nobody types "continue" into many sessions at once.

## 7. Final review (Friday 30, frozen candidate)

- Full CI on the candidate: lint, typecheck, tests, build, audit, browser gate, GPU gate.
- Independent reviews of everything merged since 1 October, at most ten agents at high effort: correctness,
  venue tenancy and authorization, privacy and retention, accessibility (WCAG AA), performance claims.
- Live production checks of every changed flow, signed out and signed in, web and API on the same commit.
- The device day's numbers against each goal's targets.
- The copy and legal read against what the product does.
- Blake's acceptance walk, recorded verbatim. Go/no-go, then the tag.

## 8. Risks and what triggers action

| Risk | Trigger | Action |
|---|---|---|
| PC memory and crashes | under 4 GB free, or a lane dies | Pause the heaviest lane; Blender builds overnight; no mass "continue" |
| Blake's time | a section 5 item slips a day | Re-plan that day; ask with buttons, never prose |
| Trades Hall availability | Tuesday 27 slips | Run with a stand-in identity, keep the real run as the open line |
| API deploy path | Railway stays stuck after login | Redeploy by `railway up` from master's tree; record why it stopped |
| Splat standard unreachable | L2 finds no formula that measures up | Report the measured ceiling and options; the goal stays open with its number |
| Review-found defects | a critical finding after freeze | Fix and re-run the affected gates; the tag waits |
| Usage limits | an account above 65% of its week | Pause non-critical lanes at a checkpoint |
