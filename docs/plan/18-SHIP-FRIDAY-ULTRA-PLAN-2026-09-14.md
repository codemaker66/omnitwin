# 18 · Ship Friday — the ultra plan to make Venviewer public-ready

Written overnight 14–15 September 2026 by the Fable session, for Blake and every session that works this week.
Target: **Friday 18 September 2026, 16:00 BST** release, live verification by 17:30.

Blake's instruction, verbatim: "i want it to shippable by this friday -- plan out everything we must accomplish for this to become possible. we need a beautiful looking venue planner where we can drag and drop furniture into with 60fps on mobile devices … a replacement to matterport's venue viewing capability … the behind the scenes work area of our platform for hallkeepers, caterers, venue salesmen, venue managers, venue bookers and clients etc and all other roles to be fully operational and in sync able to communicate with each other … buttons they can press for the usual help … it will ping the timetable for all hallkeepers and events staff and caterers to see with a notication flashing on their event, all people will be able to dm instantly with each other too … to look like it was made by the finest ui/ux teams at apple … everything from every angle and perspective for every user must look and behave perfectly."

Evidence behind every claim here: sixteen read-only readers over production HEAD (`D:\claude\ship-friday-plan\understand-map.json`, digest at `understand-digest.md`), a twenty-one-role veteran panel (`veteran-panel-full.json`, synthesis at `veteran-synthesis.json`), and my own browser pass on live venviewer.com at desktop and phone width on Monday evening (`live-observations-2026-09-14.md`, summarised in §1.2). Everything marked INSPECTED was read in source at `origin/master` 91220e00, the commit production runs. Nothing here is a completion claim.

---

## 0. The answer

Friday can be the day Venviewer becomes **public-ready for Trades Hall**: one front door, one design register on every surface a visitor or the venue team touches, a planner you can actually drag furniture in on an iPhone and iPad, the Grand Hall walk and the whole-building twin both live, a timetable you can click into, a hallkeeper's phone that gets from the day board to the room sheet, a back office that does not empty or 403 for the venue's own manager, the venue's real stock in the system, the request buttons and the flashing slot in their first real form, and a release pipeline that is green, gated and monitored. That is Release 1, and it is what this plan sequences hour by hour.

Friday cannot be the day the platform "goes far beyond Salesforce and Cvent" for every role. The readers' own must-fix lists total **666 engineer-hours** across 25 blockers, 113 majors and 141 placeholder smells on the code that is live today, before a single new feature. The veteran panel's dream application is 59 feature clusters, of which the code holds perhaps six in complete form. Pretending otherwise would put a construction screen behind a beautiful door. So the plan is a **release train**: Release 1 on Friday is the public-ready floor; Releases 2 to 5 over the following five weeks carry the conversation, the kitchen, the client page, the commercial spine, the money and the platform, each mapped to the panel's clusters in §8.

The single most important structural fact: **the shared checkout on this machine is not production.** `C:\Users\blake\omnitwin2` is 123 commits behind `origin/master` with 175 dirty files; production web is `origin/master` (Vercel publishes every push, gated by nothing), the production API is one commit behind that (hand-deployed by `railway up`), and CI has been red on master since 11 May. Codex's product work of the last ten days lives in `D:\claude\venviewer-*` worktrees; the 7 September demo release merged most of it, but eight branches with real fixes exist only as local refs on this one machine, and the previous Claude session's fifteen twin commits are unpushed. Lane 0 fixes all of that before anything else moves (§4).

The Blake Clause applies to one contradiction: **"60 fps on mobile" is unmeasured in either direction.** Every performance number in the repository comes from one RTX 4090 laptop through desktop Chromium; iOS Safari reports every Apple device as "Apple GPU", which the classifier maps to the desktop "high" tier, so an iPhone today is handed the full 6,019,684-Gaussian Grand Hall at DPR 2 with no level of detail. Friday's release will make the phone path correct and will publish the numbers we measure on the devices you lend (§7, item 2). It will not claim 60 fps until a device says so.

---

## 1. Where we actually are (measured)

### 1.1 Production identity and the pipeline

| Fact | Evidence |
|---|---|
| Web live = `origin/master` 91220e00 (7 Sep 20:42); Vercel publishes every push with no ignore step and no branch protection | live bundle `VITE_VERCEL_GIT_COMMIT_SHA`; `vercel.json` has no `ignoreCommand`; `gh api …/branches/master/protection` 404 |
| API live = 7f2a701b v0.0.4 built 7 Sep 18:42 UTC, `/health/ready` ok; `packages/api` is byte-identical between the two shas | `/health/version`; `git diff 7f2a701b 91220e00 -- packages/api` empty |
| CI on 91220e00: Lint, Typecheck, Test, Build, Security Audit green; **all four E2E shards red** (17+44+18+18 failed, 37 never ran: shards hit the 26-minute global timeout) | run 34160437128 |
| Master CI has not been green since 963d2274 on 2026-05-11, so `deploy.yml` (the only thing that applies migrations) has been "skipped" on every run; all 69 migrations were applied by hand | `gh run list --workflow CI --branch master --status success` |
| Production runs blind: Sentry `missing_env` on both sides, no uptime monitor, no alert route, no status page, backup restore drill "Not performed" | `GET /health/observability`; `docs/operations/backup-restore-drill.md:37-49` |
| No Content-Security-Policy on the web app; `security.txt` still points at omnitwin.com | `vercel.json:45-74`; `public/.well-known/security.txt:7-12` |
| The shared checkout is 5 ahead / 123 behind origin with 175 dirty files (mostly the 6 Sep agent-modernisation docs; 62 vs 69 migrations) | `git rev-list --left-right --count master...origin/master` |
| 31 of 40 recent Codex branches are fully absorbed into master; **four carry real unmerged product value** (capture-flow-integration 87aca5ca, round-seating 997d980b, the T-581 planner ladder 6dad07fe, worktree-twin-cad ×15); **eight exist only as local refs with no origin copy** | `git cherry -v origin/master <branch>` per branch |

### 1.2 What a visitor sees tonight (browser pass, anonymous, desktop and 375 px)

- **Home `/`**: an ivory Trades Hall landing whose primary nav shows *Dashboard · Diary · Hallkeeper* to the public (each bounces to a Clerk login wall). Four of eight rooms read "Not yet walkable · alignment in review"; the Saloon reads "Dimensions under review". The hero prints "10.1 × 19.9 × 6.9 m" while the venue publishes 21 × 10 × 7 m. On a phone the nav wraps to two rows and the hero is a black block for the first seconds. No photography of dressed rooms, no capacities, no prices, no enquiry form; "Enquire" is a link to `/fresh#enquire`, a robots-disallowed sibling page, with no hash-scroll handling.
- **Grand Hall walk `/room/grand-hall`**: eighteen seconds of blurry coarse blobs, a legible coarse room at about thirty-six seconds, and a HUD still reading "Sharpening the room — 0%". At phone width: **twenty seconds of black** with a "Streaming the room" pill and nothing drawn. On touch the walk can look but cannot move; a second finger corrupts the view. The header carries the staff links again.
- **The twin `/tour`**: a sharp panoramic walk (Viewpoint 46 of 149, WALK / DOLLHOUSE / PLAN) opened in six seconds in my browser — but the reader found that in production the bundle is gitignored and unpublished, so the PROD branch of `TwinPage` renders "The twin is being prepared. Walk the photographs meanwhile." with a Try-again button that cannot succeed. Every "Walk the whole building" link on the site ends there. My browser pass may have hit a cached bundle; treat the source finding as authoritative until Lane 3's R2 publish is verified live.
- **Planner `/plan` (anonymous)**: desktop is a dark graphite cockpit headed "TRADE'S HALL OF GLASGOW" (apostrophe error) with two toolbars containing "Select" twice, four "Add furniture" entry points, engineering copy in the layers rail ("Captured layer staged from source — not yet registered or alignment-reviewed"), a room-layouts strip saying "Sign in to view the room schedule", and "Loading captured room · 0 of 5 chunks". At phone width it is a different product: ivory card, a white box room with a beige grid, a dark five-button dock, "Banquet Draft" as the layout name (a hard-coded literal), and after twenty seconds no captured room and no loading indicator. **A finger cannot move furniture at all** on any touch device; the mobile copy says "Drag in the scene to move".
- **Diary, Hallkeeper, Dashboard**: a four-second black screen, then a redirect to a clean forest-green Clerk sign-in.
- **Pricing `/pricing`**: a third visual language (black and gold "VENVIEWER"), sitemap-listed, selling a £47.99/month tier with a "14-day free trial" that dead-ends at "Ask your Venviewer contact", plus a competitor price table under an "industry estimates" disclaimer. No billing exists.
- **`/demo`**: a public, crawlable sales deck headed "A SHOWCASE FOR ELAINE" with "ILLUSTRATIVE" diary and floor plans.
- Six distinct visual languages on routes reachable without login; the design reader counted twelve across all live routes, 22 CSS files with private token sets, 1,132 hex colours in CSS and 1,081 inline style objects. Inter is loaded at weights 200–600 while 178 rules ask for 700–950, so the intended type hierarchy never renders. A golden SVG cursor and a bouncing-button rule in `index.html` apply to every page outside `/fresh`.

### 1.3 What the venue team gets today

- **Roles**: exactly five (`client | planner | staff | hallkeeper | admin`), one role and one venue per account. There is no caterer, AV, security, sales, manager or booker role; "executive" and "supplier" are branched on in UI but no user can hold them. Only a Venviewer platform admin can invite anyone; invitations send no email. A venue administrator cannot add a hallkeeper.
- **Back office**: a venue admin lands on an empty Enquiries queue (list scoped to the user's own rows for role `admin`) and gets a 403 on Pipeline; every commercial list caps at the 20 *oldest* rows; the platform admin's analytics always error; "Pipeline value" means two different things on two tabs; every sales view is inline-styled with zero media queries; three visual systems on one shell; a "DEMO ONLY" checkbox lives in the production approval flow.
- **Diary**: production-grade underneath (exactly-once command ledger, exclusion constraint, live channel, the T-603 ivory rebuild fully applied). But you cannot click an empty slot to create, cannot resize a block, cannot change room or see notes in the edit drawer, the enquiry tray silently reads only the first 20 enquiries of any state, hold-reminder emails have no scheduler, turnaround rules have no write surface, and touch drag fights scrolling.
- **Hallkeeper**: five real server-backed surfaces in four visual systems. At 06:00 a hallkeeper cannot get from a Day Board slot to the room's setup sheet unless staff pre-compiled a handoff pack from the planner cockpit (which never passes the event id, so the Event Day board always says "missing handoff"). The PDF prints times in the server's timezone (an hour out in BST); the sheet fabricates an 18:00 UTC event start from the enquiry date. A **fictional walkthrough** is linked from every hallkeeper surface in production. The ops board never refreshes; issues can be opened but never resolved.
- **Inventory**: a serious, well-engineered domain (stock, receipts, windows, reservations from frozen snapshots, remedies) with **zero stock rows in production**. The real Trades Hall equipment (200 Chiavari chairs, 41 trestles, 120 pink chairs, 107 red/gold gallery chairs, linen, TVs, mics) was never imported and is not on master. Production `asset_definitions` (40 rows, 8 legacy duplicates) diverges from the code catalogue (35) the planner uses. Only venue admins can see stock; the planner is unaware of it. Hallkeeper sheets instruct staff to lay "Gold Organza Runners" the venue does not own.
- **Messaging**: none. No threads, messages, receipts or requests tables. The websocket carries three booking commands only; notifications are polled once on mount inside the dashboard's "More" popover; clients can receive nothing. Goal 04's six slices are 0 / 15 / 0 / 20 / 0 / 0 per cent built.
- **Event chain**: API-mature (phases, immutable freezes, review state machine, handoff compiler, mission control), UI-incomplete: no screen edits an event's guest count or times; a 150→180 change via API writes one feed row and nothing downstream goes stale; the reviewer email deep-links to the homepage; the AI panel renders "AI drafts are disabled until provider environment is configured" to staff.
- **Data**: the seed writes a fictional booking week for **this exact week** (w/c 14 Sep: "Mackenzie–Ross wedding", 22 bookings) and memory records the demo week as seeded into production — to be verified and purged in Lane 10 before Friday. Role and status columns have no CHECK constraints; `general_audit_log` has no venue id and no reader; Clerk user deletion keeps PII forever; hot paths lack indexes; the venue is known by two slugs.
- **Tests**: 456 web files (~5,450 cases), 180 API files (~2,135), 39 Playwright specs (261 cases). The Playwright suite is red on master because a 7 September copy commit removed strings five specs hard-code, the planner desktop redesign was never reflected in the specs, hallkeeper fixtures use non-UUID ids against a uuid schema, twin visual baselines exist only for win32. 69 API route test files run Fastify against a dead mock database and accept a 500 as a pass. No e2e covers sign-in, booking create, /diary, a real save round-trip, real PDF bytes, or any touch input.

### 1.4 The arithmetic

| Area | Readers' Friday must-fix | Blockers | Majors |
|---|---:|---:|---:|
| Messaging, notifications, real-time | 63 h | 0 | 4 |
| Identity, roles, onboarding | 57 h | 1 | 7 |
| Planner / editor | 52 h | 2 | 5 |
| Mobile and device performance | 51 h | 4 | 6 |
| Test and quality health | 47 h | 1 | 5 |
| Back office / CRM | 46 h | 4 | 9 |
| Diary | 45.5 h | 0 | 7 |
| Room walk / twin | 44 h | 2 | 5 |
| Hallkeeper's day | 43 h | 1 | 11 |
| Inventory and catalogue | 42 h | 2 | 7 |
| Public site | 41 h | 1 | 8 |
| Event lifecycle | 35 h | 2 | 6 |
| Design system, a11y, copy | 29.5 h | 1 | 11 |
| CI, deploy, observability | 26.8 h | 3 | 11 |
| Data model | 23 h | 1 | 7 |
| Branch archaeology | 20.5 h | 0 | 4 |
| **Total** | **666 h** | **25** | **113** |

Four working days remain (Tuesday to Friday). Release 1 below takes roughly 430 of those hours as release-blocking (Tier A) and defers roughly 165 to Release 2 (Tier B) with a kill order (§9). That is only achievable with five or six lanes running in parallel from Tuesday morning in isolated worktrees, one merge captain, and Blake's decisions from §6 made on Tuesday. If Tier A is not green at Thursday 18:00, the honest move is to ship Monday 21 September, not to ship on Friday with the door half-painted.

---

## 2. Definition of Shippable — the floor

A release is shippable when every line below is true on production, checked by the named verification, by someone other than the person who did the work. This is the gate at Thursday 18:00 and again at Friday 15:00.

**Public face**
1. One canonical public home. `/landing`, `/welcome`, `/living-hall`, `/editor` and `/demo` redirect or are gated; `/fresh` survives only as the enquiry/about page it is linked as. Verify: `curl -I` each route; Playwright route pass.
2. No staff route in any public nav. Verify: RoomsHomePage/RoomWalkPage tests updated; anonymous Playwright pass.
3. Zero engineering, placeholder or construction copy on any route reachable without login: no "alignment in review", "not yet registered", "Runtime room visual is not currently available", "being prepared", "DEMO ONLY", "Banquet Draft", "Loading...", "Example rates", "check dimensions". Verify: the claim-guard sweep extended with these strings; grep of the built bundle.
4. Every Enquire posts to `POST /public/enquiries` (no mailto), the form is reachable in one tap from every public page, and the client receives a "we received it" acknowledgement. Verify: real submission on production with a test address; row in `enquiries`; Resend log.
5. `/pricing` off the public surface (not in nav, sitemap or robots-allowed) until billing exists. `/demo` admin-gated. Verify: sitemap.xml, robots.txt, route guard.
6. Front door first image under 3 s on a throttled 4G profile; hero and rail images under 300 KB each with `srcset`. Verify: Playwright with throttling, network log.
7. Apple-touch-icon, web manifest, per-route `<title>`, `viewport-fit=cover`, corrected `security.txt`. Verify: curl + iOS Add to Home Screen.

**The room**
8. The room is never black: coarse level visible within 3 s at 20 Mbps on desktop and on a phone; the status pill reports honest progress and never sticks at 0 % for a minute. Verify: `window.__roomWalk` ledger timings recorded on a real iPhone and iPad and on the 4090; screenshots at 3 s and 10 s.
9. Touch locomotion in the walk (tap-to-glide on the floor, hold-to-walk), second finger handled, pinch does not corrupt look. Verify: touch e2e (hasTouch) plus a real-device check.
10. iPhone and iPad classified into a protected tier that turns the LoD tree on and serves the vendor's coarser level as the sharp layer; no 106 MB download on a phone without consent. Verify: `device-tier.test.ts` updated; network log on a real iPhone shows the ≤52 MB level.
11. The whole-building twin published (R2 asset base set on Vercel, `manifest.json` served as JSON) and every "Walk the whole building" link lands in it, or those links are removed. Verify: `curl` the manifest through venviewer.com; Playwright opens `/tour` and reads a viewpoint.
12. WebGL context loss on planner and walk shows a calm status and recovers or offers reload; no silent black canvas. Verify: `loseContext()` in DevTools on both routes.

**The planner**
13. Touch drag-to-move furniture on iPhone and iPad (drag-on-selected-item; two fingers stay camera), with pointer capture, magnetise and spring settle unchanged. Verify: touch e2e at 390×844 and 1024×768; real-device run.
14. Planner DPR capped at 2 (1.5 while the camera moves), the planner reads the device profile and the coarse-first ladder, and a measured frame-interval p95 on the named devices with the Reception Room splat and 100 chairs is **published as measured**, whatever it says. Verify: `?perf=1` sampler writing to `window.__venPerf`; JSON in `D:\claude\device-matrix\`.
15. One desktop control system (tool pill + inspector + one "Add furniture"); no duplicated verbs; iPad gets a touch-desktop layout, not the phone dock. Verify: planner e2e green; screenshots at 1366 and 390.
16. Loaded configuration name and space name shown everywhere; no literal fallbacks. Verify: unit test on `MobilePlannerTopBar`.

**The timetable (Diary)**
17. Click an empty slot to create a booking pre-filled with that day and room; the edit drawer shows notes, allows room change and shows the owner's name; the open-enquiries tray reads every open enquiry, newest first. Verify: diary e2e (stubbed calendar) in CI plus a signed-in production check.
18. Touch: a finger scrolls; a long-press lifts. Verify: touch e2e.
19. Hold reminders scheduled (cron hits `POST /admin/diary/hold-reminders`) with one dry-run receipt; turnaround rules present for Trades Hall so the conflict rail stops saying "not checked". Verify: production log line; conflict rail on a seeded gap.

**The hallkeeper's day**
20. From the Day Board a slot reaches its room's setup sheet without a pre-compiled handoff; the sheet's times and the PDF's times equal the Diary's booking in the venue's timezone. Verify: one real booking followed phone → sheet → PDF; PDF opened and read.
21. One visual system across Day Board, sheet, event-day board, handoff and mission control; the fictional walkthrough removed from production navigation; the ops board refreshes live; an issue can be resolved. Verify: screenshots of the five pages; Playwright hallkeeper spec green.
22. A request lands on its slot within one second of being sent, pulses once, holds a steady dot, shows "seen by [name]", and can be accepted and resolved from the slot; an unacknowledged "now" request escalates to the duty role on the venue's window. Verify: two-browser e2e over the real websocket against production (Lane 9).

**The back office**
23. A venue admin sees the venue's enquiries and can open Pipeline; every list is newest-first with real pagination; analytics numbers agree with their labels and with the Pipeline tab; a new enquiry and a client's proposal response produce an in-app notification visible without opening "More". Verify: signed-in production check as Blake's admin account; unit tests on scoping.
24. Enquiries, Client Search, Client Profile, Pipeline, Proposals and Analytics share one register and are usable at 390 px. Verify: screenshots; a11y route audit extended.

**People and roles**
25. Venue admins can list members, invite by email with a role (a real email with a personal link), change a role, and suspend; the role vocabulary includes at least `caterer` (supplier-class), `sales`, `manager` alongside the five, defined once in `@omnitwin/types` and fanned out to every gate; the six per-route role helpers collapsed to three in `utils/query.ts`. Verify: API route tests for 401/403 across venues and roles; invitation e2e.
26. The `/pricing` trial dead-end removed; denial screens have a next action; one Clerk appearance. Verify: screenshots of the sign-in journey on a phone.

**Data**
27. Real Trades Hall stock loaded in production (the 53-record intake plus the 200 Chiavari), catalogue and `asset_definitions` reconciled to one list, invented accessories removed, no fictional bookings on the live timetable, CHECK constraints on role and status columns, indexes on the hot paths, Clerk deletion anonymises PII. Verify: `SELECT count(*)` on the stock table and the assessment page; migration 0071 applied through the guarded helper after a fresh Neon backup branch.

**Pipeline and operations**
28. CI green on master (E2E job finishes and passes, or split with a written reason), branch protection requires it, Vercel skips builds without a green CI, the migration policy in `deploy.yml` decided and written down, Sentry live on both sides with one verified scrubbed event, uptime monitors with an alert route, the Neon restore drill performed and recorded, CSP in report-only, provenance automated. Verify: the checklist rows in `docs/operations/production-monitoring-checklist.md` filled with ids and timestamps.
29. A real-stack e2e lane (API + migrated disposable Postgres + `vite preview`) runs sign-in → book → plan → save/reload → submit → approve → sheet/PDF in CI; a touch e2e for the planner exists. Verify: the CI job.

**Judgement**
30. Blake has walked the release on his own phone and iPad and on the venue laptop, and has said which of the surfaces he accepts aesthetically. Technical checks never award that.

---

## 3. The release train

| Release | Date | What it is | Panel clusters carried (see §8) |
|---|---|---|---|
| **R1 Public-ready** | Fri 18 Sep | Everything in §2. The public front, the room, the planner on touch, the timetable you can click into, the hallkeeper corridor, the back office that works for the GM, real stock, people & access, requests + flashing slot v1, monitored pipeline. | P1 (v1), P3 (partial: real sheet times and kit strip), P4 (v1 room state), P8 (capacity from one source, no egress maths yet), P14, P26 (one-thumb, quiet-by-room), P27 (honest labels), P40, P41 (basics) |
| **R2 The conversation** | Fri 25 Sep | Event thread (staff-private and client-facing, receipts, quiet hours), request escalation ladders per button, in-product inbox everywhere, email-after-silence, supplier no-login pass with "I have arrived", kitchen sheet and dietary count matrix v1, client one-page day card, Day Board ops states (doors open, overrun), delta alarms, resize in the Diary, print, guided walk chrome merged from twin-cad. | P1 (complete), P2, P5, P10 (v1), P16, P18, P28, P33, P44, P4 (complete) |
| **R3 One event, end to end** | Fri 2 Oct | Proposal-is-the-room (client layout in the captured room, one-tap approve freezes the version), quotes with schedule and cancellation ladder, holds ladder with expiry and courteous challenge, change-order ledger and Time Machine on a booking, inventory reconciliation across the day, licence clock, compliance wall, seat's-eye view v1, house rules layer v1, real event rehearsal with Elaine. | P6, P7, P9 (v1), P11, P12, P13, P19, P20, P23, P24, P29, P30, P36 |
| **R4 Money and memory** | Fri 16 Oct | Final account from the day board, Monday Numbers, pay and sign in the client page (Stripe + e-sign, test mode until HUMAN 9/10), preference ledger, incident book and recovery ledger, lock-up walk, fire-alarm isolation workflow, door count, room technical pack, flip clock from the layout delta, goods lift as a resource. | P15, P17, P21, P22, P25, P32, P39, P46, P47, P48 |
| **R5 The platform** | Nov | Multi-venue tenancy without a fork, offline-tolerant hallkeeper phone, supplier and caterer as real logins, Redis backplane and second replica, AI decision preparation on the decision object (goal 09), guest card, pins in the room, production geometry, seat-level dietary, sun at the hour. | P31, P34, P35, P37, P38, P42, P43, P45, P49–P59 |

Nothing in R2–R5 is a promise of dates; each is a fortnight-shaped slice whose scope is the panel's clusters and whose gate is §2 re-run plus the cluster's own done-when. R1 is the only date this document commits to.

---

## 4. Release 1 — the work, by lane

Thirteen lanes. Each lane is one isolated worktree cut from `origin/master` (never the shared checkout), one owner session, explicit pathspec commits, a PR into master, and the merge captain's queue. Hours are the readers' estimates for a strong engineer; agents run them in parallel but the numbers still bound the funnel. **Tier A** is release-blocking; **Tier B** ships if done by Thursday 18:00 and otherwise moves to R2. Files cited are on `origin/master` 91220e00.

### Lane 0 — Foundation and release safety (Tuesday; owner: the merge captain)

Tier A, 43 h.

1. Push every local-only branch to origin now (0.5 h): `codex/capture-flow-integration-20260907`, `codex/capture-failure-recovery-20260907`, `codex/furniture-scaled-round-capacity-20260907`, `codex/flow-clarity-20260907`, `codex/t581-planner-ladder`, `codex/trades-hall-demo-release`, `codex/inventory-selected-style`, `codex/furniture-drag-history`, and the tip of `worktree-twin-cad`. Sole copies are on one disk.
2. Cherry-pick 87aca5ca (capture-failure recovery + Flow-lens-in-Interior fix; based on master tip, merge-tree clean) and 997d980b (round-table chair-corner capacity) onto master (4 h); run web typecheck, the named tests, and the browser check of the all-geometry-failed planner path.
3. Push the shared checkout's five landing/Craft commits to a branch and reset `C:\Users\blake\omnitwin2` to `origin/master` (0.5 h). Commit the 175 dirty files only if a diff against origin shows anything not already on master (the branches reader says they are byte-identical copies).
4. **CI green** (14 h): update the planner specs to the ToolPill/reference-dock chrome (`PlannerCockpit.tsx:53` hides the toolbar behind "More planner tools"; give the outliner/inspector "Add furniture" buttons unique accessible names or use `exact: true`); import copy constants into the five specs that hard-code strings removed by 63257478 (`THRESHOLD_LINE`, pricing h1, "Saved just now" → the save-status labels, "Take me to the diary"); hallkeeper fixtures to real UUIDs and the moved h1; delete the win32-only twin visual baselines or generate linux ones; remove the twin-walk minimap assertion; lower the `plan-room-resolve.spec.ts` 240 s timeout and CI retries to 1 so shards finish; move the six hard-coded `C:/Users/blake` artifact paths to `test.info().outputPath` (e26bda63 pattern).
5. Deploy gate (4 h): branch protection on master requiring the CI check; a Vercel Ignored Build Step that exits non-zero unless the commit's CI run succeeded (or move web publish into `deploy.yml` after migrations); **decide the migration policy** before CI goes green, because `deploy.yml:72-78` will silently resume auto-migrating production on the first green run (§6, decision 12).
6. Sentry on both sides (2 h): `SENTRY_DSN`/`SENTRY_ENVIRONMENT` on Railway, `VITE_SENTRY_DSN` + auth token on Vercel; verify one scrubbed event. Uptime monitors at one minute on `/health/live`, `/health/ready`, `/health/observability` and `https://venviewer.com/` with an alert route to Blake's phone (1 h). Neon restore drill on a disposable branch, recorded (2 h). CSP report-only header covering Clerk, Spark wasm, the R2 rewrite and Google Fonts (2 h). `security.txt` corrected (0.25 h). Provenance from `RAILWAY_GIT_COMMIT_SHA` instead of a manual stamp (0.5 h). Ops docs corrected: RUNBOOK env table, `.env.production.example` (JWT/STRIPE removed), `deploy-flow-current.md` (1 h). Delete `apply-migration-0009..0018.ts`, `verify-migration-0024.ts`, the `apply-migration-0018.yml` and `backfill-layout-urls.yml` workflows (2 h).
7. Merge `worktree-twin-cad` (8 h) — **only after Lane 3 item 1 publishes the twin bundle**; merge-tree is clean but resolve typecheck fallout from removed props (`hopKey`, `HOP_FOV_BREATH_DEG`, `cutaway*`), run the twin tests, walk the Grand Hall in fullscreen and plan mode. Blake decides whether fullscreen hiding the reticle and dollhouse dots is accepted (§6, decision 9).

Verify: `pnpm -r typecheck`, `pnpm -r lint`, `pnpm --filter @omnitwin/web build`, CI green on the merge commit, `docs/operations/production-monitoring-checklist.md` rows filled.

### Lane 1 — One register (Tuesday; owner: design-engineering session)

Tier A, 20 h. The cheapest lane with the largest effect on "looks made by one team".

- Remove the `index.html:61-148` globals (golden cursor, gold scrollbar, universal 1.06× button pop); re-scope any wanted spring to the planner shell only (2 h).
- Fix the font axis: load Inter 700 (or the variable axis 200..800) at `router.tsx:26`; replace 720/740/750/760/780/820/850/860/950 with 600/700 across the 178 rules (3 h).
- Define or rename the four consumed-but-undefined House tokens (`--house-brass` vs `--house-accent-brass` at `PlannerCockpit.css:7`, `CockpitBottom.css:626-688`, `FurnitureInspectionDock.css:29`) and add a unit test that every `var(--house-*)` consumed in `src` resolves in `styles/house-tokens.css` (1.5 h).
- Re-skin the three shared primitives on House tokens: `ToastContainer.tsx:122-127`, `StatusBadge.tsx:174-182`, `ConfirmModal.tsx` (Tailwind pastels on a dark product); replace the twelve ASCII "..." with "…" (3 h).
- Raise every ≤9 px rule to an 11 px floor on live surfaces (`CockpitBottom.css`, `PhaseLayoutSnapshotAction.css`, `diary-board.css:101`, `hallkeeper-workspace.css:6`) and re-flow (3 h).
- Restore text selection in planner inputs (`App.css:27-37`) (0.5 h). Focus traps for the five `aria-modal` dialogs without one (`EventDetailsPanel`, `BlueprintPage` overlay, `BoardPalette`, `WelcomePanel`, `RoomSelector`) (3 h). `<main>` landmarks and skip links on the eleven pages without them, starting with `EditorPage`, `DashboardPage`, `DayBoardPage` (2 h). Align `theme-color` with the page ground and give `html/body` a light ground under light routes (1 h). One focus-ring style (1 h).

Verify: `house-tokens.test.ts` extended; a11y route audit; before/after screenshots of Diary, dashboard, planner, home.

Tier B (R2): the component library (Button, Dialog/Sheet, Toast, Field, Table, Card, Tabs) on a two-register token set; migration of the 1,081 inline style sites starting with `PricingPage`, `ProposalsView`, `ProposalPage`, `BlueprintPage`, `VerticalToolbox`, `CommercialPipelineView`; axe-core in Playwright; visual-regression baselines per route.

### Lane 2 — The front door (Tuesday–Wednesday; owner: front-of-house session)

Tier A, 33 h.

- **One canonical home** (14 h): merge `FreshPage`'s photography, venue-published capacities, wedding rates and the enquiry composer (the only page with a real form, `FreshPage.tsx:928`) into `RoomsHomePage`'s room rail; the hero is the Grand Hall resolving from its coarse level (goal 07's rule), never a generated image. Capacities worded as envelopes by layout from `lib/trades-hall-venue-truth.ts`, never one number. Decision 1 in §6.
- Remove Dashboard/Diary/Hallkeeper from the public primary nav on `/`, `/fresh` and `/room/:slug` (`RoomsHomePage.tsx:132-138`, `FreshPage.tsx:693-698`, `RoomWalkPage.tsx:131-138`); keep "Plan an event" and one "Log in"; update the pinned tests (1.5 h).
- Enquire reaches the form: composer on the canonical page; hash-scroll on mount for any surviving `/fresh#enquire`; replace every mailto (`rite-copy.ts:249-257`, `LivingHallPage.tsx:345-350`, `craft-quiz-model.ts:940-952`, `LegalPage` contact, the `/fresh` footer) with the composer or a link to it (4 h). The client-facing "we received it" email on `POST /public/enquiries`, and staff/sales notified rather than hallkeepers only (`public-enquiries.ts:202-248`), land in Lane 7.
- `/pricing` off the public surface: out of sitemap and nav, `Disallow`, route gated or figures labelled indicative and the trial CTAs removed (1.5 h). `/demo` behind the admin `ProtectedRoute` and `Disallow` (0.5 h).
- Landing cull: redirect `/landing`, `/welcome`, `/living-hall`, `/editor` to `/`; keep `/fresh` only as the about/enquiry page (3 h). Retire or 301 the orphaned showcase route `/venues/trades-hall/rooms/:slug` (always renders API fallback copy; `assets.ts:1877-1891`) and remove the `#contact` dead anchor (2 h). Kill the remaining dead anchors: Spotlight `/rooms/grand-hall` and `/#rooms`, Pricing `/#how-it-works` (1.5 h).
- Front-door weight: responsive WebP ladders with `sizes` for the hero (913 KB JPEG) and the seven supplied stills (1.7–2.6 MB PNGs), `fetchpriority=high` on the hero, drop the two unused font families (3 h).
- SEO/PWA basics: apple-touch-icon, web manifest, per-route `<title>`/description for `/` and `/room/:slug`, `viewport-fit=cover`, fix the stale `index.html:12-13` comment (2 h).

Tier B (4 h): accessibility statement "Known problems" pointed at the surviving page with re-measured contrast; a Playwright pass of the canonical home and one `/room/*` at iPhone 13 and iPad viewports (no console errors, no horizontal overflow, an fps sample) that also submits the real enquiry POST against the disposable stack.

Verify: `node packages/web/scripts/demo-smoke.mjs` (after its machine-bound import is fixed in Lane 12), the new front-door e2e, a real enquiry on production.

### Lane 3 — The room: walk and twin (Tuesday–Thursday; owner: room session)

Tier A, 37 h, plus Blake's R2 action.

1. **Settle the twin dead end** (5 h + Blake): Blake creates the R2 bucket and custom domain (§7 item 1); the engineer `rclone`-copies `packages/web/public/twin` to it, sets `VITE_TWIN_ASSET_BASE` on Vercel, confirms `manifest.json` returns `application/json` through venviewer.com, flips `FRESH_TOUR_ENABLED`, and verifies `/tour` in a fresh incognito profile. If the bucket cannot exist by Wednesday noon, remove every "Walk the whole building / Live tour / Explore the venue" link for R1 rather than ship a Try-again button.
2. Touch locomotion in `InteriorCamera.tsx` (10 h): tap on the floor to glide there (raycast the y=0 plane, clamp with `containPosition`), hold-to-walk on a long press, treat a second pointer as pinch-to-move-forward and never as look; reuse the pointer-map pattern from `twin/WalkControls.tsx:255-313`.
3. A real mobile tier (6 h, shared with Lane 4): classify touch-primary "Apple GPU"/Adreno/Mali by UA + `pointer: coarse` + `maxTouchPoints` + `deviceMemory` below "high"; that tier gets `lod: true`, a 1.0–1.5 M motion budget, settled DPR 1.5. Update `device-tier.test.ts:44` (it currently asserts the wrong mapping).
4. Serve the vendor's coarser level as the sharp layer for weak tiers (6 h): Grand Hall level 4 = 2.95 M / 51.6 MB, level 3 = 1.45 M / 25.8 MB, already staged; wire `roomSplatLadder(profile)`; label it the interim device tier (plan 16 §1 says a reduced tier is not the final answer; R2–R5 carry the parity work).
5. Walk chrome for public use (5 h): drop the staff links, `100dvh` + safe-area insets (`RoomWalkPage.css:11,21-33,121-129`), a fullscreen control, an honest status pill that never sticks at 0 % (fix the T-582 poller at `RoomSplatScene.tsx:303`). `viewport-fit=cover`, apple-touch-icon and manifest (1 h, shared with Lane 2).
6. WebGL context loss handling on planner and walk canvases: `preventDefault`, calm Activity status, re-invalidate on restore, reload offer after a failure (4 h).

Tier B (4 h): a Playwright spec for `/room/grand-hall` (closed door for `robert-adam-room`, first view via `__roomWalk`, containment via `__roomCamera` after a drag/keys burst) plus the mobile viewport.

Verify: `__roomWalk` ledger on a real iPhone and iPad (§7 item 2) and on the 4090; network log showing the ≤52 MB level on the phone; `/tour` manifest through the domain.

R2+: reopen the three closed rooms (crop the walk box for Robert Adam, yaw step for North Gallery); dollhouse/plan mode for `/room` via `RoomClipBox keepHeightFraction<1` and an orbit rig; re-chunk finest tiles to ~4 MB; the Grand Hall floor at the content level (goal 13, T-596).

### Lane 4 — The planner on touch (Tuesday–Thursday; owner: planner session)

Tier A, 42 h. Tier B, 26 h.

Tier A:
- **Touch drag-to-move** (10 h): in `SelectionSystem.tsx:370-376` a primary touch that lands on the currently selected item (or on any placed item after one tap) enters the existing move gesture with pointer capture; two fingers stay camera; the copy at `VerticalToolbox.tsx:1331,1344` becomes true.
- DPR cap and adaptive resolution (5 h): clamp `nativePlannerPixelRatio` to 2, mount `AdaptiveResolution` (or `regress` on the rig) so DPR drops to 1.5 while `cameraInteractionActive`; `planner-resolution-policy.ts:2-3`, `PlannerScene.tsx:239,477`, `CameraRig.tsx:781`.
- The planner reads the device profile and the coarse-first ladder (8 h): pass `runtime` into `CockpitSplatLayer` → `SparkSplatLayer`; use `roomSplatLadder` in `runtime-package-resolution.ts:349`; this is the T-581 ladder's job — rebase 6dad07fe after 87aca5ca (three conflicts: `CockpitSplatLayer.tsx`, `PlannerScene.tsx`, `use-room-runtime-splat.ts`) or reimplement the smaller version if the rebase fights.
- Loaded configuration name and space name in `MobilePlannerTopBar.tsx:172-175` (1 h).
- Planner e2e repair (10 h; shared with Lane 0 item 4).
- Device measurement (8 h; needs §7 item 2): `?perf=1` rAF sampler writing to `window.__venPerf`; run Reception Room + 100 chairs on each lent device; publish the JSON.

Tier B:
- One desktop control system (12 h): remove the `VerticalToolbox` desktop rail and the compact command deck duplicates; Camera Views, Events Sheet and the outliner into the tool pill/inspector; one "Add furniture". Decision 5 in §6.
- Tablet layout (8 h): coarse pointer + width ≥ 900 px = touch-desktop (inspector + pill + 44 px targets), not the phone dock (`EditorPage.tsx:441`, `use-media-query.ts:41-53`). Decision 6.
- Delete dead `CockpitTopBar.tsx` and `CatalogueDrawer.tsx` with their tests; remove the injected `<style>` blocks from `VerticalToolbox` (2 h). Timeline dock collapsible to a hairline and off on phones when no event is linked (4 h).

Verify: touch e2e at 390×844 (hasTouch, isMobile) and 1024×768; the frame-interval JSON; planner e2e green.

R2+: draco/meshopt + KTX2 for the GLBs (Lane 10 does a first compression pass); measured dimensions for the 14 "approximate" models and removal of the AI-stand-in badges; finer snap; furniture LoD per tier; production frame telemetry behind consent.

### Lane 5 — The timetable (Tuesday–Wednesday; owner: diary session)

Tier A, 34.5 h. Tier B, 11 h.

Tier A:
- Enquiry tray source (3 h): request `status=submitted` and `under_review` with a full page (or a dedicated open-enquiries endpoint); stop refetching everything on every board change (`DiaryBoardPage.tsx:158-162`, `routes/enquiries.ts:48`).
- Create-in-context (6 h): New booking seeds the viewed day and the clicked or first visible room; click an empty overview cell or day-lane position to open the drawer prefilled (`DiaryBoardPage.tsx:344-353`, `lib/drawer-form.ts:134-148`).
- Touch model (6 h): long-press (or an explicit grip) lifts blocks and slips; `touch-action: pan-x pan-y` until lifted; remove the immediate `preventDefault` on slips (`diary-board.css:115,149`, `useBoardDrag.ts:138-141`).
- Edit drawer completeness (5 h): show and edit notes, allow room change, show the owner's name (join `users.name` into the calendar entry), show the linked client (`BookingDrawer.tsx:336, 447-452`).
- Guard global shortcuts while a drawer or `<select>` has focus; exclude self from the presence count (1.5 h).
- Hold reminders scheduled (2 h): a GitHub Actions or Railway cron hitting `POST /admin/diary/hold-reminders` with a service token; one dry-run receipt in production.
- Turnaround rules (4 h): a minimal admin PATCH/POST route plus a venue-settings row, and confirm or seed the production "House default turnaround" so the conflict rail stops saying "not checked".
- Repair the two diary e2e specs' stale strings and add `/diary` (stubbed calendar) to the default route pass (4 h). Retire the hidden month view and sweep the T-603 residue (3 h).

Tier B: resize handles on Day-timeline blocks with the same ink-confirm and undo (8 h); print stylesheet for week and day (3 h).

Verify: diary e2e in CI; signed-in production check creating, moving and editing a booking on a phone and a laptop; the cron log.

R2+: ICS feed or drop `external_calendar_links`; venue timezone through `board-time.ts`; booking-level client/headcount/catering fields and history; recurring series; idempotent from-enquiry; spring motion on settle.

### Lane 6 — The hallkeeper's day (Tuesday–Thursday; owner: hallkeeper session)

Tier A, 34 h. Tier B, 9 h.

Tier A:
- Day Board → setup sheet corridor that does not depend on a compiled handoff (6 h): resolve `booking.eventId` → event configuration link (`resolveEventLinkedLayouts`) → the room's approved configuration → `/hallkeeper/:configId`; show an honest "no sheet yet" with the next action when nothing is linked (`DayBoardPage.tsx:62`).
- Times (4 h): pin all PDF times to `data.venue.timezone` (`hallkeeper-pdf-v2.ts:514-517, 824`); stop fabricating timing — derive `eventStart`/`setupBy` from the linked Diary booking, never an 18:00 UTC default (`hallkeeper-sheet-v2-data.ts:29-37, 414-437`).
- Remove the fictional walkthrough from production navigation (`DayBoardPage.tsx:131`, `HallkeeperPage.tsx:477`, `HallkeeperWorkspace.tsx:123`) and move the route under `/dev` (1 h).
- One visual system (10 h): re-skin `EventDayOpsPage`, `OpsHandoffPage` and `EventMissionControl` onto the ivory/forest Hallkeeper tokens and type used by the Day Board and sheet; remove the "4D Mission Control / Spatial command map / Phase authority" copy from a hallkeeper's page.
- Live sync on the event-day board (4 h): reuse `useDiaryLive` or a 10 s poll with an in-flight guard; refetch after every mutation; persist acknowledgements from the server (`EventDayOpsPage.tsx:143, 228, 298`).
- Issue lifecycle (4 h): resolve/close and assign via `updateEventDayIssue`; optional phase/task link; reflect resolution on the sheet's "Keep in view".
- One execution model per event page (3 h): hide Mission Control's incident form and task grid when the ops board's own controls are shown, or make the ops board a thin client of Mission Control. Decision 10.
- Supplier arrivals only when an `arrivalWindow` or supplier is captured; compiler notes labelled as notes (1.5 h). Venue timezone instead of the hard-coded "Europe/London" (0.5 h).

Tier B: derive the sheet's current stage and next action from the Day Board clock with a manual override (4 h); an at-a-glance kit strip (tables, chairs by type, AV, linen) in the sheet header and PDF (2 h); repair `e2e/hallkeeper.spec.ts` and add a Day Board e2e (3 h).

Verify: one real booking followed phone → sheet → PDF with the PDF opened; screenshots of the five pages side by side; hallkeeper e2e green.

R2+: slot messaging and ops states (Lane 9 continues), caterer/AV surfaces on the same sheet with role filters, offline-first shell (revive `use-hallkeeper-sheet.ts`), richer "what changed", server push for shared checks, multi-venue room plans.

### Lane 7 — The back office (Tuesday–Thursday; owner: commercial session)

Tier A, 28 h. Tier B, 20 h.

Tier A:
- Role scoping (6 h): venue admins see the venue's enquiries (`enquiries.ts:76-82` scopes `admin` to their own rows) and can use Pipeline/Opportunities (`crm.ts:34-38`, `opportunities.ts:41-45`); hide Create Opportunity / Pipeline / Client Search / Analytics from roles the API rejects (`EnquiriesView.tsx:249-258`, `DashboardLayout.tsx:61-62`, `router.tsx:417`). Lands together with Lane 8's helper collapse.
- Newest-first plus real pagination for enquiries, proposals and opportunities (`enquiries.ts:48,97`; `proposals.ts:85,301`; `opportunities.ts:138`; `crm.ts:190`) (4 h).
- Analytics truthfulness (8 h): venue picker or `venueId` for platform admins (`revenue-analytics.ts:63-70`); one definition of pipeline value shared with the Pipeline tab; utilisation from bookings; drop the permanently empty scenario cards.
- Notifications that notify (6 h): write an `eventPlanNotification` on new public enquiry and on client accept/request-changes regardless of `configurationId` (`public-enquiries.ts:202-248`, `proposals.ts:155-157`); the client-facing acknowledgement email; unread count on the visible nav (Lane 9 makes it live).
- Reviewer email deep link: support `/dashboard?view=reviews&config=:id` and fix `configuration-reviews.ts:474` (2 h). Remove or dev-gate the "DEMO ONLY" copy (`ReviewsView.tsx:507-513`, `SubmitForReviewPanel.tsx:198`) and drop the legacy `/proposal/:shareCode` page in favour of the token page (2 h). Decision 13.

Tier B: one register and responsive layout for Enquiries, Client Search, Client Profile, Pipeline, Proposals, Analytics — inline styles to House tokens, dark register, breakpoints, 44 px targets (12 h); the enquiry → opportunity → proposal corridor navigable (Create Opportunity jumps to the pipeline with it selected; the raw-UUID quick-create becomes a picker; opportunity detail shows the client; dashboard proposals can attach a configuration so the client sees the layout) (8 h).

Verify: signed-in production check as Blake's admin: enquiries visible, Pipeline opens, analytics agree with the Pipeline tab; unit tests on scoping; screenshots at 390 px.

R2+: contracts, deposits, invoicing, e-sign (R4); client accounts and contacts surfaces; proposal templates and F&B packages; pricing rule editor; email integration for replies and sends; team messaging (Lane 9 continues).

### Lane 8 — People and roles (Tuesday–Thursday; owner: identity session)

Tier A, 44 h. Tier B, 13 h.

Tier A:
- **Role vocabulary defined once** (12 h): add `caterer` (supplier-class, event-scoped), `sales`, `manager` to `USER_ROLES` in `packages/types/src/user.ts:19`; fan out to `auth.ts:37`, `env.ts:26`, `types/onboarding.ts`, the `EVENT_PLAN_AUDIENCE_ROLES` CHECK (migration 0071 with Lane 10), `role-routing.ts`, `DashboardLayout.tsx`; delete the unreachable `executive` branches (`router.tsx:417`, `role-routing.ts:10`, `DashboardLayout.tsx:57-58`, `DashboardPage.tsx:66-75`). Decision 7 fixes the exact list. The unsafe `EventPlanAudienceRoleSchema.parse(request.user.role)` sites (`events.ts:580`, `proposals.ts:451,572,885`, `event-day-ops.ts:164,240`) become safe parses.
- **People & access for venue admins** (18 h): list members with role and status, invite by email with a role, change role, suspend/remove; API routes gated by a venue-admin capability (not `canManageVenue`, which includes hallkeepers); the "Clients & access" view stays platform-admin for organisations.
- Collapse the six per-route role helpers into `utils/query.ts` (`canManageCommercial`, `canManageIntegrations`, `canManageRevenue`) with venue admin included everywhere staff is and planner removed from integrations/revenue (6 h).
- The public dead end (4 h): remove the trial CTAs from `/pricing` (Lane 2 hides the page) and route uninvited signed-in identities to a "Request access" form posting to the existing public enquiry route with a venue-access reason; denial screens get "Use another account" and "Back to Venviewer" (`ProtectedRoute.tsx:36-56`).
- Sign-in polish (4 h): one Clerk appearance for provider, pages and consent; brand links home; remove "Clerk will send a reset code" and the self-serve sign-up subtitle (`clerk-localization.ts:165-175`).

Tier B: real invitation email with a personal `/register?invite=<token>` link using the unused `token_hash` column (6 h); a short-TTL per-clerkId fast path in `authenticate` so every request stops paying an advisory-locked transaction (`auth.ts:193-275`) (5 h); browser evidence of the auth journey at phone widths (2 h).

Verify: API tests for 401 without identity, 403 across venues and across roles, 400 malformed, on every new route; an invitation e2e; screenshots of the sign-in journey on a phone.

R2+: memberships instead of `users.role/venue_id`; Clerk Organizations evaluation; supplier logins (R5); the AI draft endpoint gated by role and venue.

### Lane 9 — Requests and the flashing slot (Tuesday–Friday; owner: conversation session)

Tier A, 42 h. Tier B, 21 h. This is Blake's feature; it is built on the primitives that exist (the venue-scoped websocket with exactly-once command envelopes, the event bus, the notification tables, the Day Board's slot state machine) and on goal 04's decisions.

Tier A:
- **Requests as first-class data** (12 h): `requests` table (venue id, booking or slot, room, kind `chairs | tables | refreshments | av | access | temperature | cleaning | other`, quantity, urgency `routine | soon | now`, free text, requested-by actor or share token, owner, state `sent | acknowledged | accepted | resolved` with outcome and note, idempotency key) plus `request_status_history`; Zod in `@omnitwin/types`; routes gated by venue tenancy for staff and by share token for clients; audience fixed at creation and never widened. Reconcile with `event_day_issues` first (an issue and a request share one model only if the fields say they do; today the issue schema lacks kind/quantity/room/slot/urgency, so a new table is the honest answer).
- Live delivery (6 h): `notification.created` and `request.changed` on the bus `EventMap`; emit after commit; fan out over `/ws/diary` to the venue's connected staff; client reconnect replays; the inbox subscribes.
- **The request slab on the Day Board slot** (10 h): `day-board-state.ts` gains a requests input keyed by booking; open requests render as one slab over their slot (goal 04: one slab, no bubbles); the slot pulses **once** then holds a steady coloured dot (the panel's resolution of the flashing contradiction: never above three per second, no siren, silence in a room in use); "seen by [name]" within the SLA; accept and resolve from the slot; the Diary drawer shows the same request.
- Client request composer (8 h) on the client's share-token page(s): room and slot pre-filled; kind, quantity and urgency in one gesture; an eight-second undo; then the tile shows who has it. The R1 catalogue is the seed set starred in §8.2.
- Inbox visible and live (4 h): unread count on the visible nav; `NotificationCenter` subscribed to the channel and restyled onto House tokens.
- Verify the live path in production (2 h): a scripted check that `wss://…/ws/diary` upgrades through Railway from venviewer.com and a second browser receives a request within one second.

Tier B: minimal staff-private and client-facing message threads attached to a request (threads with fixed audience, messages, per-recipient receipts; routes with audience tests; a quiet column at the edge of the room, no chat bubbles) (16 h); idempotent issue creation for offline replay (3 h); staff notification on supplier acknowledgement/changes-requested (2 h).

Escalation for R1 is the simplest honest ladder: unacknowledged "now" after 3 minutes → duty role (whoever holds `manager`, else venue admin) by in-product notification plus email through the existing Resend service; the per-button ladders and quiet hours from §8.2 land in R2.

Verify: route tests (401/403/400, audience immutability, idempotency replay returns the same request); the two-browser websocket e2e against the disposable stack and once against production; Blake presses "water" on his phone and a second phone on the Day Board sees it pulse.

R2+: full request taxonomy and per-venue SLAs; email-after-silence and duty-admin escalation as a cron pass; people matrix as venue configuration; web push and quiet hours; Redis backplane before a second replica; presence unified.

### Lane 10 — Inventory and data (Tuesday–Wednesday; owner: data session)

Tier A, 31 h. Tier B, 25 h.

Tier A:
- **Real Trades Hall stock into production** (10 h): map the 53 source records (`docs/data/trades-hall-equipment-2026-09-05.json` — bring the off-master intake d044dec6 onto master first) plus the 200 Chiavari to catalogue items with owned quantity, storage and seat count; import through the audited stock-adjustment command so every row carries an actor and reason; photographs from §7 item 4 as they arrive.
- Reconcile production `asset_definitions` with the code catalogue (5 h): a migration that retires or renames the 8 legacy rows (check `placed_objects` FK usage first) and adds the 3 missing canonical items; add Chiavari, pink, red/gold gallery chairs, highchairs, staging sections, TVs, mics to `asset-catalogue.ts`; extend `FURNITURE_CATEGORIES` with linen/staging/av where needed.
- Verify and purge the fictional seed week from production (2 h): compare production bookings against the `seed.ts:311-467` titles; delete or relabel; add a seed marker so fixtures can never be mistaken for real inks again. A fresh Neon backup branch precedes any deletion.
- Copy and default-state pass (3 h): remove "check dimensions"/"Approx." subtitles; replace the "Add catalogue items to record stock" dead end; open on an item with stock and a photo; hide digest hashes and UUIDs behind a disclosure. Replace the invented accessories (`hallkeeper-accessories.ts:113-131`) with Trades Hall's real black/white linen and chair covers, or remove dressing accessories until confirmed (2 h).
- Read-only inventory for hallkeeper, staff, planner (4 h): split read authority from write authority in `venue-inventory.ts:84-87`.
- Migration 0071 (3 h): CHECK constraints for `users.role` (with Lane 8's list), `configurations.state/review_status/visibility/layout_style`, `enquiries.state`, plus backfill assertions. Indexes: `events(venue_id, starts_at)`, `events(venue_id, ends_at)`, `pricing_rules(venue_id, space_id) WHERE deleted_at IS NULL`, `placed_objects(asset_definition_id)` (2 h).

Tier B: stock in the planner (owned/usable badge per catalogue card, soft warning when placed exceeds usable) (8 h); compress the furniture GLBs (meshopt/draco, 1K textures, target <1.5 MB per item; the default chair is 7.4 MB with 2K textures) (6 h); anonymise on Clerk `user.deleted` and document retention (3 h); `general_audit_log` gains `venue_id` and a reader or stops being written (2 h); delete the migration debris and the `db:generate` trap (2 h); catalogue photographs wired (4 h).

Verify: `SELECT` counts on production after import; the assessment page for the demo week; `route-atomicity-postgres` and the inventory postgres suites; the guarded migration helper's ledger receipt.

R2+: banqueting consumables model (linen, crockery, glassware, cutlery with per-table/per-cover ratios); editable hired-in stock with a real hire order; demand from saved layouts; catalogue administration UI; schema unification of Venue/Space/Enquiry/PricingRule across types, API and web (the three divergent shapes).

### Lane 11 — The event chain (Wednesday–Thursday; owner: event session)

Tier A, 12 h. Tier B, 18 h.

Tier A:
- Bind handoff packs to events from the planner (6 h): pass the linked `eventId` from `?eventId` into `compileOpsHandoffPack` in `OpsLensPanel.tsx:68`; create the `event_configuration_links` row when the corridor opens; the Event Day board stops saying "missing handoff".
- Copy and dead-end cleanup (2 h): hide `AIDraftPanel` when `/ai/status` is not configured; reword the Event Architect hero; hide the Event Architect nav link for R1 (1 h; decision 11). Persist change acknowledgements (3 h, with Lane 6).

Tier B: an event editing surface (guest count, start/end, status via `PATCH /events` with `expectedStateDigest`, in the Diary drawer and the Event Day header) and phase scheduling so fresh events populate the timeline (8 h); minimal change impact — when guest count or timings change, mark linked handoff packs stale and flag frozen snapshots and approved sheets whose count differs (4 h); mobile and token pass on `ReviewsView`, `NotificationCenter`, `EventMissionControl` (6 h, with Lane 7).

R2+: the decision object (goal 09 M1), the change-impact engine, a real AI provider adapter gated by role and venue, push transport, a reachable Time Machine.

### Lane 12 — Verification and release (Wednesday–Friday; owner: release captain plus the test session)

Tier A, 29 h. Tier B, 13 h.

Tier A:
- A real-stack e2e lane in CI (16 h): boot the API against the existing postgres service with migrations and `db:seed`, serve `vite preview` (`E2E_WEB_SERVER=preview`), Clerk test keys as secrets, and run sign-in → book → plan → save/reload → submit → approve → sheet/PDF bytes. Decision 14 supplies the keys.
- Touch drag-and-drop e2e for the planner at iPhone and iPad viewports using `hasTouch`/`page.touchscreen` (5 h).
- Delete dead test code and machine-bound paths (3 h). Release rehearsal (4 h): the release checklist from `docs/operations/trades-hall-demo-release-2026-09-07.md` re-run for R1: backup branch, migration preflight, `railway up` from a clean checkout, deployment id, `/health/version`, push, Vercel alias, then the signed-in walk. Production smoke run (1 h).

Tier B: replace sleep-based assertions with polls and set CI retries to 1 (3 h); update the opt-in live specs to current copy (2 h); move enquiries, public-configuration save/claim, calendar read model and hallkeeper sheet onto the real-Postgres runner so a 500 no longer passes (8 h).

R2+: a WebKit/iOS Safari project; a device lane; consolidate the six T-469 harness specs; run e2e against the production bundle by default; the copy-constant rule for e2e.

---

## 5. The week, hour by hour

**Tuesday 15 September**
- On reading: Blake answers §6 (most are one word) and starts §7 items 1–3. Lane 0 items 1–3: push local-only branches, cherry-picks, reset the shared checkout; cut the twelve lane worktrees from the new master tip.
- 09:00 Lane 0 item 4 (CI green), Lane 1 (one register), Lane 10 (seed-week verification, read-only) and Lane 8 (role vocabulary) start. Decision 7 (roles) is needed by 12:00 because Lanes 8, 9 and 10 all fan out from it.
- 12:00 All lanes running. The merge captain publishes the queue order: Lane 0 → 1 → 10 → 8 → 7 → 5 → 6 → 2 → 3 → 4 → 9 → 11.
- 16:00 CI green target on a foundation PR. Branch protection and the Vercel gate go on. Migration policy decided (decision 12).
- 18:00 Sentry, uptime, restore drill, CSP report-only done. First lane PRs merge behind a green check. Blake: R2 bucket and DNS done; devices handed over or the one-command harness run. Evening: Blake's first judging pass on Lane 1's before/after and Lane 2's home direction.

**Wednesday 16 September**
- 08:00 Merge window 1 (Lanes 1, 10, 8, 7 in whatever order is green).
- 12:00 Twin published and verified through the domain, or the links come out. Stock import applied to production through the guarded helper after a fresh backup branch.
- 18:00 Merge window 2 (Lanes 5, 6, 2). Blake's second judging pass: home, walk chrome, Diary, the hallkeeper's five pages, the dashboard register.
- Evening: Lane 12's real-stack e2e lane lands; device measurements start on whatever devices arrived.

**Thursday 17 September**
- 08:00 Merge window 3 (Lanes 3, 4, 9, 11). Tier B items land only if their lane is already green.
- 14:00 Feature freeze for R1. Only fixes for §2 lines after this.
- 15:00 Full §2 gate run by the release captain with a second session verifying, not the authors.
- 18:00 **Go / no-go.** Go means every Tier A line in §2 is true on a release candidate deployed to the Railway service and a Vercel preview. No-go means the honest Monday 21 September plan, with Friday used to finish Tier A.
- Evening: Blake walks the release candidate on his phone, iPad and the venue laptop; the aesthetic verdict per surface goes in the session log.

**Friday 18 September**
- 08:00–13:00 Fix window for anything Blake or the gate found; no new scope.
- 13:00 Release rehearsal (Lane 12): backup branch id, migration preflight, clean-checkout `railway up`, deployment id, `/health/version`.
- 15:00 §2 gate re-run on the candidate.
- 16:00 Push to master; Vercel alias verified; API revision verified; production smoke.
- 16:30–17:30 Live verification with real accounts: an enquiry from a phone; a booking created by clicking a slot; a hallkeeper phone from Day Board to sheet to PDF; a request pressed on one phone and seen on another; the walk and the twin on the lent devices; the planner drag on the iPad.
- 17:30 The release note in `docs/sessions/2026-09-18.md`: source and deployment identity, the §2 checklist with evidence links, the measured device numbers, and the material limits carried into R2. Then nobody touches production until Monday.

---

## 6. Decisions I need from Blake (recommendation first; one word suffices)

1. **The homepage.** Merge `/fresh`'s photography, capacities, rates and enquiry composer into `/` (the scanned-rooms page keeps the rail; the Grand Hall resolving is the hero). Recommend yes.
2. **Pricing.** Take `/pricing` off the public surface until billing exists. Recommend yes.
3. **`/demo`.** Gate behind admin. Recommend yes.
4. **The three closed rooms.** Keep Robert Adam, North Gallery and Lady Convenor's closed but with venue copy ("Ask us to walk this room in person") instead of "alignment in review". Recommend yes; reopening is R2 work.
5. **Planner desktop control system.** The tool pill + inspector (the 6 September direction) survives; the legacy toolbar rail and the compact deck go. Recommend yes.
6. **iPad.** A touch-desktop layout (inspector, pill, 44 px targets), not the phone dock. Recommend yes.
7. **Role vocabulary for R1.** Add `caterer`, `sales`, `manager` to the five; keep suppliers on share-token passes until R5; `hallkeeper` loses venue-management power (edit venue, spaces, pricing) but keeps read on inventory and write on room state. Recommend yes. (AV, security, front of house become `staff` with a job-title field until their surfaces exist.)
8. **Flashing.** One soft pulse then a steady coloured dot; vibration and sound only for "now"; silence in a room whose Diary phase is "in use". Never a strobe. Recommend yes — it is the accessibility line and the veterans' consensus.
9. **Twin fullscreen.** Accept the previous session's decision that fullscreen hides the reticle, dollhouse dots and all chrome. Recommend yes, with one tap anywhere bringing the chrome back.
10. **Hallkeeper execution model.** The event-day ops board is the hallkeeper's surface; Mission Control's incident form and task grid are hidden there and Mission Control stays a manager's view. Recommend yes.
11. **Event Architect.** Hidden from navigation for R1 (null price book, unusable phone review). Recommend yes.
12. **Migration policy.** `deploy.yml` auto-migrates only behind a GitHub environment approval; hand migration through the guarded helper stays the R1 path. Recommend yes.
13. **Proposal links.** Retire `/proposal/:shareCode` in favour of the hashed token page; existing sent links get a redirect for thirty days. Recommend yes.
14. **Clerk test keys and fixture users** as GitHub secrets for the real-stack e2e lane. Recommend yes.
15. **Water and custom-request routing defaults.** Water → caterer if attached, else hallkeeper, 10 minutes; custom → events staff in office hours, hallkeeper otherwise, one-tap re-route. Recommend yes.
16. **Hallkeepers and prices.** Hallkeepers never see prices; they record facts and photos, finance prices them. Recommend yes.
17. **The seed week.** If production holds the fictional w/c 14 Sep bookings, delete them after a backup branch. Recommend yes.
18. **Go/no-go authority.** The release captain calls it at Thursday 18:00 on the §2 gate; a no-go means Monday 21 September. Recommend yes.

## 7. What only Blake can do this week (ordered by leverage)

1. **R2 for the twin** (Tuesday): create the bucket and the custom domain, add the Cloudflare CNAME; hand the engineer the endpoint and a scoped token. Unblocks §2 line 11 and the twin-cad merge.
2. **Devices** (Tuesday): lend, on the venue's Wi-Fi and on 4G, whichever you own of iPhone 15/16 or 17, an entry iPhone, iPad (A16) and iPad Air/Pro, the venue laptop, plus one ordinary office PC; or run the one-command harness the room session hands you and send back the JSON to `D:\claude\device-matrix\`. Unblocks every honest fps and load number.
3. **Sentry and uptime accounts** (Tuesday): an org for Sentry (or a DSN pair) and an uptime monitor account with your phone as the alert route. Unblocks §2 line 28.
4. **Equipment photographs** (by Wednesday): front, side and above for the Chiavari, the checked chair, the pink chair, the gallery chair, each trestle and round, the poseur, the lectern, the projector/TV; phone photos are fine. Unblocks the inventory's first impression.
5. **The people matrix** (Wednesday): correct the draft in §8.3 — who receives each request kind, who covers an absence, how long before an unowned request escalates and to whom, which admins hold approval for layout, price and timing changes.
6. **Judging sessions** (Tuesday, Wednesday, Thursday evenings): 30 minutes each on your phone and iPad; say which surfaces you accept. Nothing in §2 line 30 happens without it.
7. **Elaine** (Friday or the following week): a real upcoming event and 60–90 minutes with a working hallkeeper for the R2/R3 rehearsals; a consenting client if possible.
8. **Terms and money** (R3/R4, not this week): pricing, deposit schedule, cancellation terms, Stripe and e-sign business details when asked.

---

## 8. The ecosystem beyond Friday — what the veterans specified

The full panel output is `D:\claude\ship-friday-plan\veteran-panel-full.json` (21 roles, 534 dream features, 553 request buttons); the chair's synthesis is `veteran-synthesis.json`. This section carries what the plan needs.

### 8.1 The fifty-nine clusters, ranked, with the release that carries each

The chair ranked by how many roles asked and by five-star impact; I have mapped each to the train in §3. Priority, surface, complexity, roles asking, then the cluster.

1. messaging · M · 21 roles · Concierge request buttons with named acknowledgement, SLA clock and escalation → R1 v1, R2 complete
2. messaging · M · 12 · Event-scoped instant messaging (one thread per booking, mention a role, read receipts as names, quiet hours) → R2
3. hallkeeper · M · 16 · Setup sheet / BEO generated from the plan, with the real room in it, versioned and delta-marked → R1 partial (real times, kit strip), R2 (photo frame, deltas, receipts)
4. hallkeeper · S · 11 · Room state ledger and "Your room is set" photo → R2
5. client · M · 10 · One passwordless client page per event → R2
6. walk · M · 11 · Plan in the real room: walk-to-planner switch and layout at eye level → R3
7. planner · M · 6 · Seat's-eye view, stand at the lectern, sightline and hearing check → R3
8. planner · M · 12 · Capacity truth: egress-true licensed capacity and one source of room facts → R1 (one source), R3 (egress maths)
9. diary · M · 12 · One timeline: run of show as the Diary projection with a live service clock → R3
10. kitchen · M · 9 · Kitchen sheet, dietary count matrix, allergy query, hands please → R2 v1
11. backoffice · M · 8 · Inventory reconciliation across the day and an inconsistency detector → R3
12. client · M · 9 · The proposal is the room → R3
13. diary · M · 9 · Hold ladder with expiry, courteous challenge and public date check → R3
14. public · S · 12 · Real enquiry, response clock and share previews → R1
15. backoffice · S · 9 · Preference ledger and recognition on return → R4
16. hallkeeper · S · 8 · Line-Up, morning page, handover and pass-on book → R2
17. hallkeeper · M · 8 · Incident book, recovery ledger and glitch log → R4
18. hallkeeper · S · 4 · Lock-up walk, close-down checklist and night report → R2
19. planner · M · 9 · House rules of a 1794 building enforced at placement → R3
20. finance · M · 7 · Quote integrity: schedule, cancellation ladder, immutable versions, discount authority → R3
21. finance · M · 8 · Final account from the day board and extend-the-night → R4
22. finance · M · 9 · Monday Numbers, cash forecast and one-story analytics → R4 (R1 makes today's analytics truthful)
23. diary · S · 7 · Licence clock, protected dates, house bookings → R3
24. backoffice · M · 7 · Compliance wall and supplier documents → R3
25. hallkeeper · M · 6 · Door count and live occupancy against licence → R4
26. mobile · S · 9 · Gloves-on, quiet-by-room mode, true dark mode → R1 (one-thumb, quiet-by-room), R2 (dictation, queued taps)
27. walk · S · 10 · Honest measurement, exact-view sharing, room facts in the walk → R1 (honest labels), R2 (share exact view)
28. client · M · 9 · Supplier pass and vendor access pack → R2
29. backoffice · M · 9 · Change order ledger and Time Machine on a booking → R3
30. planner · S · 6 · Start from memory: layouts by feeling, ghost furniture → R3
31. planner · M · 5 · Counts from the drawing: pull list, staffing, table numbering → R5
32. hallkeeper · S · 6 · Fire alarm isolation workflow and lighting states → R4
33. hallkeeper · S · 9 · Housekeeping rhythm: toilet rounds, pre-heat from the Diary, turnaround buffers → R2
34. backoffice · M · 5 · Onboarding, import, export and support → R5
35. public · M · 6 · Your Evening guest card and wayfinding → R5
36. backoffice · S · 9 · Service culture loop: same-night thank-you, review at the moment of joy → R3
37. backoffice · S · 5 · Brand truth: one room-facts record, consent-aware images, set-room capture → R5
38. kitchen · M · 4 · Kitchen wall screen, multi-room kitchen timeline → R5
39. backoffice · S · 6 · Room technical pack and production memory → R4
40. platform · S · 7 · One design language → R1 (register), R2 (component library)
41. platform · M · 9 · Accessibility as standard (WCAG 2.2 AA) → R1 (basics), R2 (axe gate, WebKit)
42. planner · M · 4 · Clear-route ruler and access items → R5
43. mobile · M · 5 · Kiosk modes → R5
44. mobile · S · 7 · Delta alarms and covers this week → R2
45. walk · M · 11 · Pinned snags, faults and questions in the captured room → R5
46. diary · L · 8 · Flip clock: turnaround computed from the layout delta → R4 (fixed buffers in R1)
47. diary · M · 5 · Goods lift, loading bay and supplier slots as bookable resources → R4
48. finance · M · 8 · Pay and sign in the page → R4
49. kitchen · L · 7 · Seat-level dietary map and guest self-declaration → R5
50. planner · L · 5 · Production geometry: power map, rigging registry, projection throw → R5
51. walk · L · 12 · Step-free route and escape routes walked in the twin → R5
52. planner · L · 5 · Guest-count ripple and live price in the planner → R5
53. walk · L · 6 · Light and presence: sun at the hour, candlelight, walk together → R5
54. platform · L · 9 · Offline-tolerant hallkeeper phone → R5
55. platform · M · 7 · Supplier and caterer as real roles, day pass for casuals, evacuation mode → R5
56. hallkeeper · XL · 5 · Plan-to-reality photo check and porter route order → R5
57. backoffice · L · 4 · Facilities intelligence: asset passport, wear ledger, repeat-fault detection → R5
58. public · L · 5 · Public design-your-event in the real room → R5
59. platform · XL · 3 · Multi-venue tenancy → R5

The chair marked 44 of 59 as Friday-viable. I do not agree; the readers' 666 hours on the existing code decide the week. The R1 mapping above is mine.

### 8.2 The request buttons

Twenty categories with routing, default urgency and SLA, from the merged catalogues. The R1 seed set is starred; R2 carries the rest and per-venue SLAs.

| Category | Urgency · SLA | Routes to | Buttons |
|---|---|---|---|
| Comfort and consumables ★ | soon · 10 min | hallkeeper; caterer when on the event; events staff | Water (table / top table / all) ★, tea and coffee top-up ★, too hot / too cold ★, lights brighter/dimmer/preset, windows or blinds, ice, station replenish |
| AV and technical ★ | now · 3 min | AV technician or AV-trained staff; hallkeeper; duty manager on breach | AV / media help ★, microphone not working ★, projector or screen ★, connect my laptop, Wi-Fi help, music up/down/stop, cannot hear the speeches, power trip, house lighting state |
| Furniture and layout ★ | soon · 15 min | hallkeeper; events staff | More chairs (count) ★, another table (type) ★, remove chairs or tables, layout change (opens the plan), clear and reset, dance floor ready, signage/easel/seating board, stage or lectern |
| Cleaning and facilities ★ | soon · 10 min | hallkeeper; cleaner; facilities; venue admin for leaks and alarm faults | Spill / wet floor ★, glass breakage, toilets need attention ★, blocked toilet, bins, leak, lift fault, lamp out, door or lock |
| Kitchen and service | now · 2 min | kitchen/caterer; bar; floor manager; hallkeeper for shortages | Fire next course, hold course N minutes, slip all timings, hands please, dietary plate ready, allergy query (table, seat, allergen), headcount confirmed |
| Timing and running order | now · 5 min | caterer; AV; hallkeeper; events staff; organiser; venue admin for extensions | Running late (+15/+30/+60), hold the food, speeches starting/finished, doors held/open, running order change, quiet please |
| Safety and emergency | now · 2 min | duty manager; first aider; security; hallkeeper; all on shift for evacuate | First aid (999 stated first), ambulance called, security (discreet), silent duress (long-press), fire/smoke, evacuate (two-step) / stand down, blocked exit |
| Access and inclusion ★ | now · 3 min | hallkeeper; AV-trained staff; front of house; duty manager | Guest needs access help ★, step-free route guidance, hearing loop not working, captions not showing, interpreter arrived, lower lighting / stop strobe |
| Arrivals, doors and deliveries | now · 5 min | hallkeeper; front of house; events staff | Delivery at the goods door, I have arrived, open the load-in door, lift needed, loading bay blocked, new ETA, parking after unloading, client arriving |
| Guest services | routine · 15 min | front of house; events staff; hallkeeper | Cloakroom, bring my coat, taxi, lost property, quiet room, charge my phone, where is my seat, cake and gifts |
| Room status and handover | routine · 20 min | hallkeeper; organiser; events staff; caterer; venue admin | Room set and ready (photo), is my room ready, setup complete for inspection, load-out complete, ready to strike, handover acknowledged |
| Heritage, permits and compliance | routine · 24 h | conservation officer; venue admin; hallkeeper | Heritage review (auto), open flame, haze (isolate / re-enable), fixing or hanging, heavy load or staging, confetti |
| Damage, snags and incidents | soon · 30 min | hallkeeper; facilities; venue admin; conservation; duty manager | Snag (photo, pin), damage to historic fabric, spill on historic floor, wax or adhesive, equipment fault, near miss, glitch, access barrier |
| Sales, holds and bookings | routine · 4 h | events staff; hallkeeper; venue admin; supplier; client | Place 1st option, challenge 1st option, release my hold, extension, show-round slot, dress the room for a show-round, feasibility check |
| Money and approvals | soon · 2 h | venue admin/GM; finance; events staff; client | Approve discount, approve overtime, extend room (licence and cost shown), issue contract, raise deposit invoice, chase overdue, release hold |
| Client planning (pre-event) | routine · 4 h | events staff; caterer; hallkeeper; venue admin; client; supplier | Ask a question, change guest numbers, add dietary or access need, book a viewing, change the layout, supplier load-in details, change order, photo consent |
| Staffing and operations | soon · 10 min | duty manager; events staff; hallkeeper; facilities; venue admin | Extra staff (role, count), turnaround help, manager to the room, someone come to me (escalating clock), walk the building with me, debrief now, heating pre-set |
| Courtesy, reputation and broadcasts | routine · 4 h | venue admin; executive; staff; client; organiser | All is well, thank the team, tell the host something, request a review, reply to a review, approve social post, correct a room fact |
| Platform and support | routine · 60 min | Venviewer support; venue admin | Report a problem (diagnostics attached), training, data import, new staff account, full export, text-only contact |
| Custom request ★ | soon · 15 min | events staff (office hours) or hallkeeper (otherwise); re-routable in one tap | Something else… (free text ★, optional photo and pin, urgency picker, suggestions mapped to tiles as you type) |

### 8.3 The people matrix (draft for Blake to correct; becomes venue configuration in R2, never code constants)

| Role | Receives | Can approve | Escalates to | Surfaces |
|---|---|---|---|---|
| Venue admin / GM | discount, overtime, late running, credit notes, capacity and heritage overrides; escalations after duty manager; incidents, damage, security, licence | pricing exceptions above ceilings; licence-hour and capacity overrides with reason; contracts, deposits, refunds | Trustees | back office, finance, Diary, Day Board, mobile |
| Duty manager | "now" requests unacknowledged by the first responder; manager to the room; medical, security, fire, duress, evacuation | extend running time within licence; recovery gestures; fire-alarm isolation; contractor stop-work | venue admin | mobile, Day Board, messaging |
| Events staff (sales and coordination) | enquiries with SLA clock; client questions, change orders, dietary and access; custom requests for triage; show-rounds, feasibility, quotes | holds within policy; quotes within discount ceiling; layout changes with hallkeeper reply | duty manager, then venue admin | Diary, back office, planner, client page preview, messaging, mobile |
| Hallkeeper | water, chairs, temperature, lights, doors, spills, toilets, deliveries, arrivals; layout changes and sheet deltas; room-ready, lock-up | room state; layout-change feasibility; delivery and load-in acceptance; closing report | duty manager | Day Board, mobile, sheet PDF, walk (pins) |
| Facilities / housekeeping | faults, leaks, lift, heating, toilet rounds, compliance due dates; turnaround clocks | maintenance holds in the Diary; work orders and contractor passes; consumable reorders | venue admin | Day Board, back office, Diary, walk, mobile |
| Front of house / reception | arrivals by time and door; VIP greet with preference card; cloakroom, taxi, lost property, where is my seat | lost-property release; cloakroom retrieval order | duty manager | front-door display, mobile, Line-Up |
| Kitchen / caterer | kitchen sheet and dietary matrix; delta alarms; allergy queries; headcounts; fire/hold/slip; water and coffee when on the event; load-in slot | ready to serve, hold, dietary plate ready, hands please; kitchen handover | events staff, then duty manager | kitchen wall screen, kitchen lane, mobile, supplier pass |
| AV / production | room technical pack; plan changes after issue; AV help, mic dead, cannot hear, lighting state; speech cues; isolation approvals | show-clock cues; sound-check windows | hallkeeper for building; venue admin for rigging and power | show clock, planner, walk, supplier pass |
| Other suppliers | supplier pass: windows, door, route, rules, contact, their items in the plan; timing and layout changes near their items | placement handshake for their items; their ETA | hallkeeper, then events staff | supplier pass (no login), walk, messaging |
| Client / organiser | their page: plan, timeline, money, next things, named people; room-set photo; approvals to make; request acknowledgements | layouts, quotes, running orders, change orders; extra-hour charge on the night; photo consent | duty manager via "someone come to me" | client page, walk, planner (limited), messaging, mobile |
| Guest | Your Evening card; found-at-your-table | own dietary and access declaration; tell-the-host | organiser, then front of house | public guest card, walk |
| Finance | discount approvals above ceilings; extras to bill; cancellations, refunds, VAT; overdue deposits; quote expiries | invoices; credit notes with reason; payment schedules; yield modifiers | venue admin | finance, Diary (deposit radar), back office |
| Safety and licensing | incidents; capacity gauge; licence clock; statutory test due dates; PEEPs | risk assessments; capacity overrides; evacuation and stand-down | venue admin; Licensing Board externally | Day Board, mobile, back office, planner (egress), walk (routes) |
| Conservation / heritage trustee | heritage review flags; flame, haze, fixing, load, confetti, filming; damage to fabric; wear ledger | heritage decisions with conditions; approved rigging points | Trustees; Historic Environment Scotland for consent | back office, planner (protected layer), walk (pins), sheet heritage panel |
| Marketing and brand | enquiry sources; set-room captures; consent states; review queue; listing drift | social posts, testimonials, hero imagery; room-fact corrections with second sign-off | venue admin | back office, public, kiosk, client page preview |
| Executive / Trustees | Monday one-pager; monthly board pack; annual wear and compliance report | protected House dates; reply to review | none | finance (board pack), back office (read-only) |
| Venviewer support | report-a-problem with diagnostics; training and import requests; health strip | imports on request; sandbox and rollout | founder / engineering | back office, health strip, sandbox venue |

### 8.4 Five-star non-negotiables (the standing acceptance list for every release)

One truth: the Diary is the only source of times, the plan the only source of counts, everything else a projection. Every request has an owner, a clock, a "seen by [name]" within two minutes, a "done" with a name, and automatic escalation; nothing dies in a pocket. Requests route only to people on shift; nothing rings in a room in use. The setup matches the approved plan and a time-stamped photo proves it. Capacities are the lower of licence and egress from one audited source. The client and their family open everything on a phone without an account or a login before seeing the room. Nobody is asked twice. Every allergy reaches the pass by table and seat. The price seen is the price paid. A hold cannot exist without an owner, an expiry and a reason. Every enquiry acknowledged within a minute and answered by a named human within a working hour, measured. The organiser's name, history and preferences on every staff screen that concerns them. 60 fps and the room never black behind a spinner. One-handed, wet hands, gloves, dark corridor. Print is first class. Heritage and safety rules at the moment of decision, every refusal with an alternative. Role and tenancy boundaries hold under audit. Every write attributable and reversible where the domain allows. WCAG 2.2 AA everywhere. Honest status and honest words: no developer language, no "Loading...", no placeholders, no construction screens, British spelling, dates as 18 September 2026. One design language. The venue owns its data and its captures.

### 8.5 The Apple bar per surface (what to hunt)

- **Planner**: direct manipulation at 60 fps; one selection ring; tool state always visible; Escape cancels, undo always; capacity and price settle live in tabular numerals; warnings as a quiet amber edge with a sentence and a one-tap fix. Hunt: cartoon rectangles beside a photoreal room; generic chairs; furniture clipping through chimneypieces; a layout lost on refresh; drag-only interaction with no keyboard or numeric path.
- **Walk**: never black; a soft complete room within a second, sharpening in place with an honest status; dollhouse-to-eye-level preserves orientation; any view becomes a link; measure shows provenance; unverified viewpoints say so. Hunt: a spinner over black; a wrong room label; frame drops when turning on an iPad in a client's hand; memory crash on iOS Safari; no way to share the exact spot.
- **Diary**: real density in one type system with tabular times; keyboard-first; the card becomes the sheet rather than a page replacing a page; holds show owner, expiry and rank; buffers, licence hours, protected dates as hatched bands. Hunt: a hold with no expiry; a turnaround typed rather than enforced; full-page reloads between Diary, event and planner; a calendar starting on Sunday.
- **Hallkeeper**: opens on today in under two seconds with no login on a saved device; only what changed since last look, as was/now; four full-width thumb actions; true dark mode; the printed sheet typeset like a menu. Hunt: scroll through last week to find today; a login wall mid-shift; icons without labels; developer language; a sheet that is a spreadsheet export; any sound in a room in use.
- **Messaging**: a persistent bottom-anchored concierge bar of house-language tiles; one tap sends, eight-second undo, then the tile shows "Morag has it, 4 minutes"; the event row pulses once and holds a steady dot; copy in sentences with first names. Hunt: "Ticket #204 status: IN_PROGRESS" where a client can see; a confirmation dialog before sending; flashing above three per second; notifications to people who finished their shift; requests that vanish.
- **Client**: one link, no account, landing inside their event; their name, date, room and one next action; a named person with a face and a reply-time promise; approvals as a signature moment. Hunt: a password before seeing anything; "Dear Valued Customer"; `{first_name}` tokens; noreply@; a PDF quote with TBC; a total that moves after yes.
- **Back office**: one story per screen — a headline sentence, one chart, three tappable numbers; an inbox with a clock; guest-ready preview before anything is sent; empty states as welcomes. Hunt: a dashboard of twelve tiles nobody reads; three Fionas after an import; grey "No data" boxes; numbers that differ from the GM's Monday page.
- **Public**: first image under three seconds on 4G, the Grand Hall itself; the enquiry as one sentence with inline availability; honest capacities from one source; a phone number and a human name; correct preview cards on every share. Hunt: a mailto; a construction screen; capacities disagreeing with the brochure; stock photography or generated renders as the venue; a cookie wall or login before the room.
- **Mobile**: one-handed, primary actions in thumb reach, 44-point targets, no horizontal scroll, Dynamic Type reflow; persistent sessions; iPad Split View keeps every function; queued taps with "not sent yet". Hunt: text under eleven points; "Your session has expired" at midnight mid-typing; the planner unusable at one-third width on iPad; frozen pointer-following visuals under reduced motion.
- **Platform**: one made object — one type family, one grid, two radii, one accent, one spring table, one component library; errors in a sentence that says what to do. Hunt: nine surfaces with nine motion styles; five greys of border; "Something went wrong" with no path; tenancy assumed rather than enforced; American spelling in a Glasgow venue's voice.

### 8.6 Competitor parity — the twenty-three "must match for launch" capabilities and where we are

| Capability (who has it) | Today | How we beat it |
|---|---|---|
| Function sheet/BEO generated from the booking, versioned, distributed (Tripleseat, Priava, iVvy, Cvent, Delphi) | partial: compiled from frozen snapshots; times fabricated; no deltas | counts from furniture placed in the captured room; a photoreal frame on the sheet; was/now deltas with read receipts |
| Lead inbox creating a CRM record with automated first response and response-time tracking (Tripleseat, Event Temple, Perfect Venue) | partial: enquiries + email to hallkeepers; no acknowledgement to client; no clock | enquiry as a sentence with live availability; named tour link; SLA clock escalating to the GM |
| Multi-room diary with 1st/2nd holds, expiry, turnaround buffers, conflict prevention (Momentus, Priava, iVvy, Tripleseat) | real for bookings and conflicts; holds lack an expiry ladder; reminders unscheduled | holds cannot exist without owner and expiry; licence hours and protected dates in the same Diary; turnaround from the layout delta |
| To-scale drag-and-drop diagramming with real furniture, capacity and spacing checks, shareable (Cvent Diagramming, Planning Pod, Prismm) | real on desktop; absent on touch; generic footprints for 14 items | the diagram is the photoreal room; egress-true capacity; the client approves from any seat's view without an account |
| Photoreal walkthrough on a phone with dollhouse, plan, measurement, tags, guided tour (Matterport, iGuide) | walk live for 5 rooms, look-only on touch; twin unpublished | a continuous splat walk that knows the Diary and inventory; the venue owns the captures with no per-room rent |
| Deep link to an exact view, shareable without login, rich preview, embeddable (Matterport, Kuula) | the twin has share; the walk has none | the exact view is the atom of every message, proposal line and setup instruction |
| Proposal/contract with online acceptance or e-signature (Tripleseat, Cvent, Event Temple, HoneyBook) | proposal accept exists via share token; no e-sign; dashboard proposals cannot attach a layout | the proposal opens on the client's layout in the real room; acceptance freezes the version and stamps the plan |
| Client portal with documents, tasks, timeline, messages, payments (Planning Pod, Tripleseat, Event Temple, Momentus) | none | one passwordless page that contains the room itself and the named people on duty |
| Run of show shared with staff and vendors, with owners (Planning Pod, iVvy, Priava, Shoflo) | phases exist; unschedulable from the product | the timeline is the Diary projection; fire/hold/slip moves everyone once |
| Operational work orders routed to departments (Momentus, Priava) | issues open-only, event-scoped | requests one-tap from the organiser's hand, acknowledged by name with an SLA clock |
| Staff request ticketing with acknowledgement, SLA, escalation (ALICE, HotSOS, Quore) | none | open to the client and suppliers, spatially pinned, feeding Monday's numbers |
| Inventory reservation across simultaneous events with shortfall warnings (Momentus, Cvent) | real domain, zero stock, planner unaware | reservations from the placed layout hour by hour; an inconsistency detector |
| Automated follow-up sequences tied to pipeline stage (Event Temple, Tripleseat, Salesforce) | follow-up tasks exist; no sequences or open tracking | chases carry the client's room picture; pause on tour re-visits |
| Account and contact activity timeline with role permissions and audit (Salesforce, Tripleseat) | tables exist; no client profile surface | recognition (preference ledger, "welcome back") rather than a record |
| Reporting on pipeline, conversion, occupancy, revenue (Salesforce, Event Temple, Cvent) | analytics with wrong definitions and a 400 for platform admins | Monday Numbers drilling to the Diary booking, plus request-SLA and setup-accuracy metrics |
| Real-time public availability with instant hold or enquiry on a date (iVvy, Priava, Perfect Venue) | none public | availability shown inside the room you are standing in |
| Dietary and accessibility per attendee carried to the kitchen and sheet (Cvent, Tripleseat, Planning Pod) | sheet schema has dietary/accessibility; no structured counts flow | UK-14 counts locked with a change ledger, mapped to the seat |
| Vendor portal / supplier collaboration on the plan (Planning Pod, Prismm, Cvent) | supplier share tokens and acknowledgements; silent to staff | a no-login supplier pass with door, route, rules, on-shift contact and "I have arrived" |
| Guest-facing event page with agenda, map, add-to-calendar, live changes (Cvent Attendee Hub, Zola) | none | Your Evening card projects the Diary live and shows the seat's view |
| Post-event survey and review prompts (Tripleseat, Perfect Venue, Bridebook) | none | a same-night thank-you from a named person, then a review at the moment of joy |
| Accessibility conformance acceptable to procurement (Cvent, Salesforce, Momentus) | a statement exists; the audit skips flagship routes | WCAG 2.2 AA including the planner canvas and the seated-eye walk |
| CSV/ICS import, full export, sandbox (Salesforce, Planning Pod, Priava) | none | import reconciles against the Diary and turnaround rules with one-action undo |
| Branded transactional email with the venue's name and a delivery log (all incumbents) | Resend, nine templates, audited | typeset like the screen, no noreply anywhere |

Four capabilities the chair marked "later": pay-in-portal (R4), named seating chart and place cards (R5), kitchen display (R5), planned preventive maintenance (R5).

### 8.7 Twenty things nobody else has

1. The planner lives inside the photoreal captured room: real Trades Hall chairs and trestles in the actual Grand Hall, switchable from the eye-level walk, walkable as the client's own event.
2. One-tap concierge request buttons in the organiser's, guest's and supplier's hands that flash the event on the hallkeeper's timetable, are acknowledged by a named person within a visible SLA, escalate automatically and feed Monday's numbers.
3. A setup sheet whose counts come from the drawing, with a photograph of the finished room from the door, versioned, delta-marked since you last looked, read-receipted.
4. Seat's-eye view: tap any chair or the lectern and see that guest's view of the top table, stage and screen, with poor-sightline and poor-hearing seats counted.
5. Egress-true capacity from the real exits and the premises licence, identical on layout, website, proposal and sheet.
6. The proposal is the room: quote lines beside a walkable render of the client's layout, opened without an account, engagement measured as time spent standing in the hall.
7. Diary-locked quoting: change the finish time once and price, overtime clause, licence check, sheet and guest card follow.
8. Since-you-looked board and delta alarms: kitchen, hallkeeper and technical director receive only the three lines that changed.
9. Room-ready handshake: "Your room is set" with a time-stamped photo before the client parks.
10. Flip clock: turnaround computed from the difference between two layouts, compared with what that exact change has historically taken.
11. House rules of a 1794 building enforced at placement, every refusal paired with an approved alternative.
12. Pinned snags, faults and questions in the captured room, tied to the hire, settling deposit disputes.
13. The Line-Up, pass-on book and self-writing handover generated from the Diary, preferences and the day's requests.
14. Live service clock shared by kitchen, floor, AV, hallkeeper and organiser.
15. Chair and inventory reconciliation across every room and hour at booking time.
16. Supplier pass and "I have arrived" with a named "coming down".
17. A guided tour that ends in the Diary with live free dates shown in the room you are standing in.
18. Honest measurement and honest labels; the venue owns its captures.
19. Fire-alarm isolation workflow with countdown and mandatory re-enable; licence clock on every relevant phone.
20. Your Evening guest card and "stand at your seat".

### 8.8 Where the veterans disagreed, and the resolutions adopted

Flashing (one pulse then a steady dot; sound only for "now"; silence by Diary phase). Water routing (caterer if attached, else hallkeeper, 10 minutes). Custom-request triage (sender may choose; events staff in office hours, hallkeeper otherwise). First aid (broadcast to all on shift plus first aider, incident opened, 999 stated, discreet on public screens). Messaging by Friday (minimal one thread per event with receipts and quiet hours in R2, not R1). Client link (a minimal day page in R2; the lifetime record in R3). Hallkeepers and prices (facts and photos only; finance prices). Full sheet versus delta (complete sheet plus a delta strip). Escalation ladders (per-button, configurable, safety officer's defaults for "now"). Turnaround (fixed buffers now, computed flip clock in R4). Supplier role (no-login pass in R2, authenticated role in R5). Pins in the room (R5). Guest self-declaration of dietaries (organiser-entered counts first; guest links after the special-category data model exists). Heritage layer (hidden by default for clients; placement warnings always shown with the alternative). Public holds (availability view and enquiry-on-a-date first; self-service holds later). Confirmation dialogs (undo replaces confirmation except for irreversible life-safety and money actions). Notification cadence (inside-48-hour changes instant; everything else digests). SLA numbers (stricter of the ops roles for "now"; median for the rest; all per venue).

---

## 9. Risks, and the kill order

**What makes Friday slip**
1. The merge funnel: thirteen lanes into one master with a red-until-Tuesday CI and a single API replica. Mitigation: the merge captain, three merge windows, feature freeze Thursday 14:00, no Tier B after a lane's Tier A is not green.
2. The twin bucket: if R2 is not live by Wednesday noon the twin links come out and the twin-cad merge waits for R2.
3. Devices: without lent devices the mobile numbers stay unmeasured; the release ships the correct phone path and says "unmeasured on device", never "60 fps".
4. Migration 0071 plus the stock import plus the seed purge touch production data: each goes through the guarded helper after a fresh Neon backup branch, one at a time, with the restore drill already performed.
5. Codex sessions still active in `D:\claude\*` worktrees: check `git branch -a` and the session log before touching any of those branches; coordinate through `goals/EXECUTION.md`.
6. The role vocabulary decision (§6 item 7) blocks Lanes 8, 10 and 9's escalation; it needs an answer by Tuesday 12:00.
7. Monday evening was spent on this plan rather than on Lane 0; Tuesday therefore carries the foundation work as well as the lane starts, which makes Tier B less likely and the kill order more likely to be used.

**Kill order if behind at Thursday 14:00** (first to go first): Lane 4 Tier B (one control system, tablet layout) → Lane 7 Tier B (register + corridor) → Lane 9 Tier B (threads) → Lane 5 Tier B (resize, print) → Lane 11 Tier B (event editing) → Lane 10 Tier B (planner stock badge, GLB compression) → Lane 2's canonical-home merge reduced to "remove staff nav, fix Enquire, hide pricing/demo, cull landings" with `/fresh` promoted to `/` as the canonical page (its content is already complete) → Lane 9's client composer reduced to staff-created requests on the Day Board with the composer in R2. Nothing in Lane 0, Lane 1, Lane 10 Tier A, or §2 lines 1–7 and 28 is ever cut; those are the public floor and the safety floor.

---

## 10. Appendices

- A. Understand map: `D:\claude\ship-friday-plan\understand-map.json` (16 areas: surfaces with state, defects with file:line evidence, placeholder ledger, mobile readiness, tests, Friday list with hours, later list, open questions) and the readable digest `understand-digest.md`. The completeness critic over the sixteen readers did not run (session limit); the plan-level critique replaces it.
- B. Veteran panel: `veteran-panel-full.json` (21 roles) and `veteran-synthesis.json`.
- C. Live observations: `live-observations-2026-09-14.md` (summarised in §1.2).
- D. Branch dispositions (from the branches reader): merge 87aca5ca, 997d980b, worktree-twin-cad (after R2), rebase 6dad07fe; drop the 31 superseded branches and prune the four `prunable` worktrees; cherry-pick the docs/reports left only on local branches (t596, furniture-live-performance, table-chair-orientation, activity-global-live) so master carries their provenance.
- E. The plan worktree: `D:\claude\ship-friday-plan\repo` on branch `claude/ship-friday-plan-2026-09-14` from `origin/master` 91220e00.
- F. Task rows to open in `docs/state/tasks.md` on the foundation PR: one T-number per lane (T-610 … T-622), each pointing at this document's lane section; the release captain's row owns the §2 gate.
