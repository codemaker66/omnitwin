# 18 · Ship Friday — the ultra plan to make Venviewer public-ready

Written overnight 14–15 September 2026 by the Fable session, revised Tuesday morning after six adversarial critics (feasibility, evidence, completeness, policy, sequencing, founder-readability) and re-verification against `origin/master` 641f2667. For Blake and every session that works this week.
Target: **Friday 18 September 2026, 16:00 BST** release, live verification by 17:30.

Blake's instruction, verbatim: "i want it to shippable by this friday -- plan out everything we must accomplish for this to become possible. we need a beautiful looking venue planner where we can drag and drop furniture into with 60fps on mobile devices … a replacement to matterport's venue viewing capability … the behind the scenes work area of our platform for hallkeepers, caterers, venue salesmen, venue managers, venue bookers and clients etc and all other roles to be fully operational and in sync able to communicate with each other … buttons they can press for the usual help … it will ping the timetable for all hallkeepers and events staff and caterers to see with a notication flashing on their event, all people will be able to dm instantly with each other too … to look like it was made by the finest ui/ux teams at apple … everything from every angle and perspective for every user must look and behave perfectly."

Evidence: sixteen read-only readers over production HEAD (`D:\claude\ship-friday-plan\understand-map.json`, digest `understand-digest.md`), a twenty-one-role veteran panel (`veteran-panel-full.json`, synthesis `veteran-synthesis.json`), a browser pass on live venviewer.com at desktop and phone width (`live-observations-2026-09-14.md`), and the critique (`critique-full.json`, `critique-digest.md`). Citations marked INSPECTED were read in source at 91220e00 and re-checked where the overnight commits touched the file; anything in `router.tsx`, `PlannerScene.tsx`, `use-room-runtime-splat.ts`, `VerticalToolbox.tsx`, `enquiries.ts` or `utils/query.ts` must be re-verified against 641f2667 before a lane starts. Nothing here is a completion claim.

---

## 0. The answer

Yes: Friday 18 September can be the day Venviewer is public-ready for Trades Hall — one front door in the ivory, forest-green and copper style you chose on 6–7 September, a planner you can drag furniture in on an iPhone and iPad, five of eight rooms walkable on touch, the whole-building twin (already live) linked from the front door, a timetable you can click into, a hallkeeper phone that reaches the room sheet, a back office that works for the venue's own manager, and the first request buttons flashing on the timetable.

Friday will not have: instant direct messages between everyone (Release 2, 25 September); caterers or sales as their own working surfaces (a caterer can be invited from Friday but has no kitchen screen until R2; suppliers keep share-token passes until R5); a client login or page (a client sees their proposal link only); measurement, dollhouse or exact-view sharing in the room walk (R2, so Friday matches Matterport's walk, not its measure, tag or share); a 60 fps claim on phones (nothing has been measured on a real iPhone; I will publish whatever your devices say); or real stock unless you say yes to the import (§6 decision 14). Placeholder copy is swept to zero on public routes; the signed-in surfaces carry 71 placeholder entries of which Release 1 clears about half (the DEMO ONLY checkbox, the AI panel, the fictional walkthrough, the fabricated sheet times, the invented accessories, the raw enum severities), the rest listed by file in the understand map for R2's first day.

The readers' must-fix lists on today's code total 666 engineer-hours (25 blockers, 113 majors, 141 placeholder smells) before any new feature; the veteran panel's dream application is 59 clusters of which the code holds six in complete form (the Diary, the walk on desktop, the planner on desktop, the setup-sheet compiler, inventory as a domain, proposals by share token). Thirteen lanes run in parallel from Tuesday on an integration branch, gated by the checklist in §2, with one merge into master on Friday. I need your one-word answers to §6 by noon Tuesday (the register and the roles first) and the four actions at the top of §7. If the checklist is not green on Thursday at 18:00 we ship Monday 21 September rather than a half-painted door.

Two contradictions I flag rather than resolve (the Blake Clause): R1 ships one register over today's surfaces, not the from-scratch sublime rebuild you called paramount (that is R2+, §6 decision 1); and R1 serves phones a visibly reduced splat level as an interim tier, which plan 16 says is your call (§6 decision 11). R1 also keeps today's staff/hallkeeper Diary authority; plan 16's admin-approval policy lands with the decision object in R3.

---

## 1. Where we actually are (measured Monday evening, re-verified Tuesday 09:40)

### 1.1 Production identity and the pipeline

| Fact | Evidence |
|---|---|
| Web live = `origin/master` 641f2667 (15 Sep 09:29 BST), the sha embedded in the served bundle; 18 commits landed overnight after this plan was drafted (04dbd8bb client schedules and event authority, 713cad08 / 68172fc0 / 3ee0e5be planner warnings and touch chrome, b380d6b4 security patch, 87aca5ca capture-failure recovery) | `curl venviewer.com` → `index-*.js` contains `VITE_VERCEL_GIT_COMMIT_SHA:"641f2667"` |
| API live = 641f2667 v0.0.4, built 15 Sep 08:45 UTC by **Railway's GitHub integration** sixteen minutes after a push whose CI was red; the migration journal is still 69 entries, so no schema drift yet. `railway up` is the manual override, not the normal path. Migrations are applied by hand through the guarded helper | `/health/version`; `railway.json` watchPatterns include `packages/api/**` and `packages/types/**` |
| Vercel has no CI gate: the red-CI push is the served bundle; master has no branch protection; the GitHub `production` environment exists but has no protection rules | `gh api …/branches/master/protection` 404; `gh api …/environments` → `protection_rules: []` |
| CI on 91220e00 (run 34160437128) and on 641f2667 (run 34948745909): Lint, Typecheck, Test, Build, Security Audit, API Native Image green; **all four E2E shards red** (17+44+18+18 failed, 37 never ran: shards hit the 26-minute global timeout) | `gh run view` |
| Master CI has not been green since 963d2274 on 2026-05-11, so `deploy.yml` (the only thing that applies migrations) has been "skipped" on every run; all 69 migrations were applied by hand | `gh run list --workflow CI --branch master --status success` |
| Production runs blind: Sentry `missing_env` on both sides, no uptime monitor, no alert route, no status page, backup restore drill "Not performed"; one production cron exists (`cleanup.yml`, nightly 02:00 UTC, deletes unclaimed previews older than 72 h, no receipt or dry-run) | `GET /health/observability`; `docs/operations/backup-restore-drill.md:37-49`; `.github/workflows/cleanup.yml` |
| No Content-Security-Policy on the web app; `security.txt` still points at omnitwin.com | `packages/web/vercel.json:45-74`; `public/.well-known/security.txt:7-12` |
| The repository `codemaker66/omnitwin` is **public** | `gh repo view --json visibility` |
| The shared checkout `C:\Users\blake\omnitwin2` is 5 ahead / 141 behind origin with 276 status entries (101 untracked); its `AGENTS.md`, `CLAUDE.md`, `GOAL.md`, `goals/EXECUTION.md` and `docs/state/tasks.md` differ from origin — it is not a byte-identical copy and it is the common `.git` for twenty linked worktrees | `git rev-list --left-right --count master...origin/master`; `git status --short` |
| Of the 40 Codex branches assessed, 33 are fully absorbed into master. Real unmerged value: 997d980b (round-table chair-corner capacity, 2 files, merge-tree clean), the T-581 planner ladder 6dad07fe (conflicts in four files against 641f2667), `worktree-twin-cad` (pushed except its last two commits, 444de374), `codex/capture-failure-recovery-20260907` (6 unmerged, unassessed) and `codex/trades-hall-demo-release` (4 unmerged, unassessed). Eight branches exist only as local refs on this machine | `git cherry -v origin/master <branch>`; `git rev-list --left-right --count worktree-twin-cad...origin/worktree-twin-cad` = 2 / 0 |
| Active Codex lanes this week that this plan must not collide with: T-601 (release owner, in progress), T-605 (Goal 12, reserves migration **0071**, `codex/intelligent-event-decision-20260907`), Goal 17 / T-613 browser-release checks (`origin/codex/browser-release-20260915`, edits the planner specs, `playwright.config.ts`, `VerticalToolbox.tsx`, hallkeeper CSS), `origin/codex/release-dependency-security-20260915`, `origin/codex/venue-operating-system-release`; T-606 (hallkeeper experience) is marked done on master; the highest task row on master is T-609 | `docs/state/tasks.md` on 641f2667; `git branch -r` |

### 1.2 What a visitor sees (browser pass, anonymous, desktop and 375 px, Monday evening)

Touch behaviour, `/demo`, the pricing trial dead-end and the robots rule below are source-inspected (`SelectionSystem.tsx:370-376`, `InteriorCamera.tsx:191-275`, `DemoShowcasePage.tsx:61`, `PricingPage.tsx:463` → `WorkspaceAccessGate.tsx:55`, `robots.txt`), not observed on a device.

- **Home `/`**: an ivory Trades Hall landing whose primary nav shows *Dashboard · Diary · Hallkeeper* to the public (each bounces to a Clerk login wall). Three of eight rooms read "Not yet walkable · alignment in review"; the Saloon reads "Dimensions under review". The hero prints "10.1 × 19.9 × 6.9 m" while the venue publishes 21 × 10 × 7 m. On a phone the nav wraps to two rows and the hero is a black block for the first seconds. No photography of dressed rooms, no capacities, no prices, no enquiry form; "Enquire" is a link to `/fresh#enquire`, a robots-disallowed sibling page, with no hash-scroll handling.
- **Grand Hall walk `/room/grand-hall`**: eighteen seconds of blurry coarse blobs, a legible coarse room at about thirty-six seconds, and a HUD still reading "Sharpening the room — 0%". At phone width: **twenty seconds of black** with a "Streaming the room" pill and nothing drawn. On touch the walk can look but cannot move; a second finger corrupts the view. The header carries the staff links again.
- **The twin `/tour`**: live. Vercel sets `VITE_TWIN_ASSET_BASE` to `https://twin.venviewer.com`, the manifest is served as JSON (149 scans, forged 11 July), and the panoramic walk (Viewpoint 46 of 149, WALK / DOLLHOUSE / PLAN) opened in six seconds. The "being prepared" branch only fires if that variable is ever removed. The front door does not yet link to it (`FRESH_TOUR_ENABLED` is off).
- **Planner `/plan` (anonymous)**: desktop is a dark graphite cockpit headed "TRADE'S HALL OF GLASGOW" (apostrophe error) with two toolbars containing "Select" twice, four "Add furniture" entry points, engineering copy in the layers rail ("Captured layer staged from source — not yet registered or alignment-reviewed"), a room-layouts strip saying "Sign in to view the room schedule", and "Loading captured room · 0 of 5 chunks". At phone width it is a different product: ivory card, a white box room with a beige grid, a dark five-button dock, "Banquet Draft" as the layout name (a hard-coded literal), and after twenty seconds no captured room and no loading indicator. **A finger cannot move furniture at all** on any touch device; the mobile copy says "Drag in the scene to move".
- **Diary, Hallkeeper, Dashboard**: a four-second black screen, then a redirect to a clean forest-green Clerk sign-in.
- **Pricing `/pricing`**: a third visual language (black and gold "VENVIEWER"), sitemap-listed, selling a £47.99/month tier with a "14-day free trial" that dead-ends at "Ask your Venviewer contact", plus a competitor price table under an "industry estimates" disclaimer. No billing exists.
- **`/demo`**: a public, crawlable sales deck headed "A SHOWCASE FOR ELAINE" with "ILLUSTRATIVE" diary and floor plans. **`/trades-house/leaflet`** (sitemap-listed) shows the internal note "final copy and image-rights review required before print"; the quiz's "Request an introduction" is a mailto.
- Six distinct visual languages on routes reachable without login; the design reader counted twelve across all live routes, 22 CSS files with private token sets, 1,132 hex colours in CSS and 1,081 inline style objects. Inter is loaded at weights 200–600 while 178 rules request 700–950, so browsers fall back to 600 or faux-bold (inferred from source, not screenshot-verified). A golden SVG cursor and a bouncing-button rule in `index.html` apply to every page outside `/fresh`.

### 1.3 What the venue team gets today

- **Roles**: exactly five (`client | planner | staff | hallkeeper | admin`), one role and one venue per account. There is no caterer, AV, security, sales, manager or booker role; "executive" and "supplier" are branched on in UI but no user can hold them. Only a Venviewer platform admin can invite anyone; invitations send no email. A venue administrator cannot add a hallkeeper. `canManageVenue` includes hallkeepers, so it cannot express admin approval.
- **Back office**: the empty Enquiries queue for a venue admin was fixed this morning (04dbd8bb, via `canManageVenue`, which now also grants hallkeepers venue-wide enquiry reads); the Pipeline 403 remains (`crm.ts:34-38`, `opportunities.ts:41-45` are staff-only); every commercial list caps at the 20 *oldest* rows; the platform admin's analytics always error; "Pipeline value" means two different things on two tabs; every sales view is inline-styled with zero media queries; three visual systems on one shell; a "DEMO ONLY" checkbox lives in the production approval flow. Suppliers: a share-token portal exists (`/supplier-share/:token`) that shows a compiled handoff pack and takes an acknowledgement; staff are not notified of it.
- **Diary**: production-grade underneath (exactly-once command ledger, exclusion constraint, live channel, the T-603 ivory rebuild fully applied). But you cannot click an empty slot to create, cannot resize a block, cannot change room or see notes in the edit drawer, the enquiry tray silently reads only the first 20 enquiries of any state, hold-reminder emails have no scheduler, and touch drag fights scrolling. Turnaround rules exist in production (written 4 September); the conflict rail still reports "not checked", cause unknown.
- **Hallkeeper**: six real server-backed surfaces (Day Board, sheet, room-plans library, event-day board, handoff, mission control) in four visual systems. At 06:00 a hallkeeper cannot get from a Day Board slot to the room's setup sheet unless staff pre-compiled a handoff pack from the planner cockpit (which never passes the event id, so the Event Day board always says "missing handoff"). The PDF prints times in the server's timezone (an hour out in BST); the sheet fabricates an 18:00 UTC event start from the enquiry date. A **fictional walkthrough** is linked from every hallkeeper surface in production. The ops board never refreshes; issues can be opened but never resolved.
- **Inventory**: a serious, well-engineered domain (stock, receipts, windows, reservations from frozen snapshots, remedies). As of the 7 September 19:21 UTC readiness report production held **zero stock rows** and 40 `asset_definitions` (8 legacy duplicates); no commit since seeds stock, but Lane 10 re-verifies with a `SELECT` before anything else. The real Trades Hall equipment (200 Chiavari chairs, 41 trestles, 120 pink chairs, 107 red/gold gallery chairs, linen, TVs, mics) was never imported; its intake sits only in a private-source commit off master. The planner is unaware of stock. Hallkeeper sheets instruct staff to lay "Gold Organza Runners" the venue does not own.
- **Messaging**: none. No threads, messages, receipts or requests tables. The websocket carries three booking commands only; notifications are polled once on mount inside the dashboard's "More" popover; clients can receive nothing. Goal 04's six slices are 0 / 15 / 0 / 20 / 0 / 0 per cent built.
- **Event chain**: API-mature (phases, immutable freezes, review state machine, handoff compiler, mission control), UI-incomplete: no screen edits an event's guest count or times; a 150→180 change via API writes one feed row and nothing downstream goes stale; the reviewer email deep-links to the homepage; the AI panel renders "AI drafts are disabled until provider environment is configured" to staff.
- **Data**: `seed.ts` writes 23 fictional bookings for w/c 14 September ("Mackenzie–Ross wedding" and others); GOAL.md records a demo week seeded into production for w/c 7 September; whether either is on the live timetable is unverified (memory only) and is Lane 10's first read-only check. Role and status columns have no CHECK constraints; `general_audit_log` has no venue id and no reader; Clerk user deletion keeps PII forever; hot paths lack indexes; the venue is known by two slugs (`trades-hall` for assets, `trades-hall-glasgow` in the database).
- **Tests**: 456 web files (~5,450 cases), 180 API files (~2,135), 39 Playwright specs (261 cases). The Playwright suite is red on master because a 7 September copy commit removed strings five specs hard-code, the planner desktop redesign was never reflected in the specs, hallkeeper fixtures use non-UUID ids against a uuid schema, and twin visual baselines exist only for win32 — Codex's T-613 branch is repairing this now. 69 API test files boot Fastify against a mock database URL; several (e.g. `configurations.test.ts:37-46`) accept a 500 as a pass. No e2e covers sign-in, booking create, /diary, a real save round-trip, real PDF bytes, or any touch input.

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
| CI, deploy, observability | 26.75 h | 3 | 11 |
| Data model | 23 h | 1 | 7 |
| Branch archaeology | 20.5 h | 0 | 4 |
| **Total** | **666 h** | **25** | **113** |

The window is Tuesday 09:00 to the Thursday 14:00 freeze: about 25 working hours per owner. Thirteen owners give 325 h; six give 150 h. The first draft's Tier A needed about 415 h after removing double counts and could not fit. Tier A is therefore re-cut below to about **335 h across thirteen concurrent sessions** (26 h per owner, at the edge, which is why the kill order in §9 is triggered at two checkpoints, not at the freeze), or about **145 h across six** (Lanes 0, 1, 2-reduced, 3+4 mobile, 5-reduced, 7+8 scoping; Lanes 6, 9, 11 and 12 go to R2 and Lane 10 keeps only the seed purge and the CHECK/index migration). Tier B defers about 205 h to Release 2 (Lane 1's component library included at ~40 h) and about 70 h of the readers' lists sit in the R2+ notes. The captain records the number of sessions actually available at Tuesday 08:00 in `goals/EXECUTION.md` before the lanes are cut. If Tier A is not green at Thursday 18:00, the honest move is to ship Monday 21 September.

---

## 2. Definition of Shippable — the floor

A release is shippable when every line below is true on the release candidate (the `release/r1` branch on the disposable local stack with a Vercel preview) at Thursday 18:00, and on production at Friday 15:00, checked by someone other than the person who did the work. No gate line may depend on a Tier B item; the captain checks this mapping on Tuesday. Every production check uses a booking, enquiry or request titled "VENVIEWER TEST — delete" in a named test window, and the Friday 17:30 release-note step deletes them (ids listed); no test ink remains on the live timetable. Lines marked (R2) are recorded here so nobody thinks they were forgotten; they are not Friday's gate.

**Public face**
1. One canonical public home. `/landing`, `/welcome`, `/living-hall`, `/editor` and `/demo` redirect or are gated; `/fresh` survives only as the enquiry/about page it is linked as; `/v/:venueSlug/plan` and `/blueprint` (gated like `/plan`) are in the route pass. Verify: `curl -I` each route; the anonymous Playwright route pass.
2. No staff route in any public nav. Verify: RoomsHomePage/RoomWalkPage tests updated; anonymous Playwright pass.
3. Zero engineering, placeholder or construction copy on any route reachable without login: no "alignment in review", "not yet registered", "Runtime room visual is not currently available", "being prepared", "DEMO ONLY", "Banquet Draft", "Loading...", "Example rates", "check dimensions", "final copy and image-rights review required". Verify: a new `packages/web/src/__tests__/public-copy-sweep.test.ts` renders every public route and asserts none of the strings appear, plus a grep of the built `dist/` for the same list; the same sweep runs over signed-in routes and reports the count rather than requiring zero.
4. Every Enquire posts to `POST /public/enquiries` (no mailto) with `TRADES_HALL_ENQUIRY_VENUE_SLUG` from `@omnitwin/types` (never the asset slug), the form is reachable in one tap from every public page, and the client receives a "we received it" email in the venue's voice with the venue's name in From and the organiser's name in the greeting. Verify: a route test asserting 201 with that slug; one real submission on production with a test address; row in `enquiries`; the received email's From and greeting read.
5. `/pricing` off the public surface (not in nav, sitemap or robots-allowed) until billing exists. `/demo` admin-gated. Verify: sitemap.xml, robots.txt, route guard.
6. Front door first image under 3 s on a throttled 4G profile using the photographic hero (the 913 KB JPEG becomes a WebP ladder ≤300 KB with `fetchpriority=high`); the resolving-splat hero is R2. Verify: Playwright with throttling, network log.
7. Apple-touch-icon, web manifest, per-route `<title>`, `viewport-fit=cover`, corrected `security.txt`, a designed not-found page. Verify: curl + iOS Add to Home Screen; open an expired share link.

**The room**
8. The room is never black: the coarsest served level is drawn within 10 s at 20 Mbps on desktop and phone (measured ~8 s today); the status pill reports honest progress and never sticks at 0 %. This is the R1 bar; the veterans' one-second-on-4G bar needs the 3–4 MB first rung (plan 14 V4) and is Lane 3's first R2 item. Verify: `window.__roomWalk` ledger on the 4090 and on every device available; screenshots at 3 s and 10 s.
9. Touch locomotion in the walk (tap-to-glide on the floor, hold-to-walk), second finger handled, pinch does not corrupt look. Verify: touch e2e (hasTouch) plus a real-device check where a device exists.
10. iPhone and iPad classified into a protected tier that turns the LoD tree on and serves the vendor's coarser level as the sharp layer, as a labelled interim tier (§6 decision 11); no 106 MB download on a phone. Verify: `lib/__tests__/device-tier.test.ts:44` updated; network log on a real iPhone shows the ≤52 MB level.
11. The whole-building twin verified live from a fresh profile on desktop and phone, and linked from the front door (`FRESH_TOUR_ENABLED`). Verify: `curl` the manifest through the domain; Playwright opens `/tour` and reads a viewpoint.
12. WebGL context loss on planner and walk shows a calm status and recovers or offers reload; no silent black canvas. Verify: `loseContext()` in DevTools on both routes.

**The planner**
13. Touch drag-to-move furniture on iPhone and iPad (drag-on-selected-item; two fingers stay camera), with pointer capture, magnetise and spring settle unchanged. Verify: touch e2e at 390×844 and 1024×768; a real-device run where a device exists.
14. Planner DPR capped at 2 (1.5 while the camera moves); the planner reads the device profile and the coarse-first ladder; the frame-interval p95 sampler (`?perf=1` → `window.__venPerf`) exists and its JSON is published for the 4090 and every device that was available; unmeasured devices are listed as unmeasured, never as 60 fps. Device availability does not block the gate. Verify: the JSON in `D:\claude\device-matrix\`.
15. (R2) One desktop control system and an iPad touch-desktop layout — Lane 4 Tier B. R1 keeps the pill + inspector direction and removes nothing else.
16. Loaded configuration name and space name shown everywhere; no literal fallbacks. Verify: unit test on `MobilePlannerTopBar`.

**The timetable (Diary)**
17. Click an empty slot to create a booking pre-filled with that day and room; the edit drawer shows notes, allows room change and shows the owner's name; the open-enquiries tray reads every open enquiry, newest first. Verify: diary e2e (stubbed calendar) in CI plus a signed-in production check.
18. Touch: a finger scrolls; a long-press lifts. Verify: touch e2e.
19. Hold reminders scheduled (cron hits `POST /admin/diary/hold-reminders`) with one dry-run receipt; turnaround rules present (verified by SELECT) and the conflict rail no longer says "not checked". Verify: production log line; conflict rail on a seeded gap.

**The hallkeeper's day**
20. From the Day Board a slot reaches its room's setup sheet without a pre-compiled handoff; the sheet's times and the PDF's times equal the Diary's booking in the venue's timezone. Verify: followed end to end on the disposable stack with `db:seed`; on production, one "VENVIEWER TEST — delete" booking created by Blake's admin account after the seed purge, or Elaine's next real event if she names one by Thursday.
21. The fictional walkthrough removed from production navigation; the ops board refreshes live; an issue can be resolved; the Day Board, sheet, room-plans library (`/hallkeeper/rooms`), event-day board, handoff and mission control use the Hallkeeper tokens and type (no new visual system) and carry no "4D Mission Control / Spatial command map" copy. The full one-system re-skin is R2. Verify: screenshots of the six pages; Playwright hallkeeper spec green.
22. A staff-created request lands on its slot within one second of being sent, pulses once, holds a steady dot, and can be accepted and resolved from the slot; an unacknowledged "now" request escalates to the venue admin on the window read from the venue's settings row. Verify: three signed-in identities on the disposable stack over the real websocket; one "VENVIEWER TEST — delete" booking on production at Friday 16:30, seen on a second phone.

**The back office**
23. A venue admin can open Pipeline and Opportunities; every commercial list is newest-first with real pagination; analytics numbers agree with their labels and with the Pipeline tab; a new enquiry and a client's proposal response produce an in-app notification visible without opening "More". Verify: signed-in production check as Blake's admin account; unit tests on scoping.
24. (R2) Enquiries, Client Search, Client Profile, Pipeline, Proposals, Analytics and the supplier portal share one register and are usable at 390 px — Lane 7 Tier B.

**People and roles**
25. The role vocabulary includes `caterer`, `sales`, `manager` alongside the five, defined once in `@omnitwin/types` and fanned out to every gate (including the diary read/write sets, the websocket read set, every `allowedRoles` literal and the `EVENT_PLAN_AUDIENCE_ROLES` CHECK); the per-route helpers collapsed into `utils/query.ts`; API route tests prove 401 without identity, 403 across venues and roles, 400 on malformed input. Venue-admin member management (People & access) and the personal-link invitation email are R2; platform-admin invitation continues as today. Verify: the route tests.
26. The `/pricing` trial dead-end removed; denial screens have a next action. One Clerk appearance is R2. Verify: screenshots of the sign-in journey on a phone.

**Data**
27. Catalogue and `asset_definitions` reconciled to one list, invented accessories removed, no fictional bookings on the live timetable (after §6 decision 10), CHECK constraints on role and status columns and indexes on the hot paths applied through the guarded helper after a fresh Neon backup branch. Real Trades Hall stock is loaded only if §6 decision 14 is yes (Friday 16:30, additive, after the API release). Verify: `SELECT count(*)` before and after; the guarded helper's ledger receipt.

**Pipeline and operations**
28. The existing four E2E shards finish and pass on `release/r1` (new specs run in a separate job with its own 20-minute budget); master has branch protection requiring CI; Vercel skips master builds and production web is published by a `deploy-web` job after migrations; the GitHub `production` environment has a required reviewer (Blake) so `deploy.yml` waits for approval; Sentry live on both sides with one verified scrubbed event; uptime monitors with an alert route; the Neon restore drill performed and recorded; `cleanup.yml` has a dry-run input and a receipt. Verify: the checklist rows in `docs/operations/production-monitoring-checklist.md` filled with ids and timestamps. CSP report-only, `security.txt`, provenance and the ops-doc corrections are R2 if Lane 0's ops session runs out of time.
29. (R2 except the touch e2e) The real-stack e2e lane (sign-in → book → plan → save/reload → submit → approve → sheet/PDF against a migrated disposable Postgres and `vite preview`) is Release 2; R1 carries the touch drag-and-drop e2e for the planner.

**Judgement**
30. Blake has walked the release on his own phone and iPad and on the venue laptop, and has said which of the surfaces he accepts aesthetically. Technical checks never award that.

---

## 3. The release train

| Release | Date | What it is | Panel clusters carried (see §8) |
|---|---|---|---|
| **R1 Public-ready** | Fri 18 Sep | Everything in §2. The public front, the room, the planner on touch, the timetable you can click into, the hallkeeper corridor, the back office that works for the GM, the role vocabulary, staff-created requests + flashing slot v1, gated and monitored pipeline. | P1 (v1: staff-created requests, slab, venue-admin escalation), P3 (real sheet times only; the kit strip if Lane 6 Tier B survives), P8 (one source), P14 (real enquiry and acknowledgement only; response clock and per-route previews R2), P26 (quiet-by-room only; one-thumb Day Board R2), P27 (honest labels), P40 (register), P41 (basics) |
| **R2 The conversation** | Fri 25 Sep | Event thread (staff-private and client-facing, receipts, quiet hours) with requests folded in as messages of kind `request`; the client request composer and per-button escalation ladders from venue configuration; in-product inbox everywhere; email-after-silence; the existing supplier portal extended into the no-login pass with "I have arrived"; kitchen sheet and dietary count matrix v1; client one-page day card; Day Board ops states and room-state ledger (P4); delta alarms; the organiser's name on the Day Board slot, sheet header and request slab; first-class print for Diary week/day, Day Board and the request log; resize in the Diary; People & access and the personal-link invitation email; the 3–4 MB first rung for the walk; twin-cad if it missed R1; the goal-01 sublime rebuild begins on the surfaces Blake judged. | P1 (complete), P2, P4, P5, P10 (v1), P16, P18, P28, P33, P44 |
| **R3 One event, end to end** | Fri 2 Oct | Proposal-is-the-room, quotes with schedule and cancellation ladder, holds ladder with expiry and courteous challenge, change-order ledger and Time Machine on a booking, inventory reconciliation across the day, licence clock, compliance wall, seat's-eye view v1, house rules layer v1, admin approval of times and changes through the decision object (plan 16 §5), real event rehearsal with Elaine. | P6, P7, P9 (v1), P11, P12, P13, P19, P20, P23, P24, P29, P30, P36 |
| **R4 Money and memory** | Fri 16 Oct | Final account from the day board, Monday Numbers, pay and sign in the client page (Stripe + e-sign, test mode until HUMAN 9/10), preference ledger, incident book and recovery ledger, lock-up walk, fire-alarm isolation workflow, door count, room technical pack, flip clock from the layout delta, goods lift as a resource. | P15, P17, P21, P22, P25, P32, P39, P46, P47, P48 |
| **R5 The platform** | Nov | Multi-venue tenancy without a fork, offline-tolerant hallkeeper phone, supplier as a real login (a caterer logs in from R1 but gets kitchen surfaces in R2/P10 and R5/P38), Redis backplane and second replica, AI decision preparation on the decision object (goal 09), guest card, pins in the room, production geometry, seat-level dietary, sun at the hour. | P31, P34, P35, P37, P38, P42, P43, P45, P49–P59 |

Nothing in R2–R5 is a promise of dates; each is a fortnight-shaped slice whose scope is the panel's clusters and whose gate is §2 re-run plus the cluster's own done-when. R1 is the only date this document commits to.

---

## 4. Release 1 — the work, by lane

### 4.0 How the week runs

**The captain.** One named session holds the T-601 release lane for the week; its name and worktree are recorded in `goals/EXECUTION.md` under T-601 by Tuesday 09:00, with either the current holder's handback or Blake's reassignment noted in the T-601 row. It alone merges into `release/r1` and master, allocates migration tags, runs the Friday sequence, and is the only writer of `docs/state/tasks.md` rows for the lanes (lanes append only to `docs/sessions/2026-09-1x.md`). It merges and gates; it owns no lane. If the holder is unavailable, follow the shipping-contract "named owner unavailable" clause and record it.

**The branch.** At Tuesday 08:00 the captain pushes the eight local-only branches, tags `release/r1` at the current `origin/master` sha, publishes that sha in `goals/EXECUTION.md`, and widens `ci.yml` so `release/**` pushes and PRs get the check. Every lane worktree is cut from that sha; every lane PR targets `release/r1`, never master. Merge windows produce a Vercel preview of `release/r1` pointed at the disposable local stack (the T-518 recipe). Master receives exactly one merge, on Friday, in this order: (1) Neon backup branch id recorded; (2) `db:verify-tail` and the migrations applied through the guarded helper against the exact `release/r1` sha; (3) `release/r1` pushed to master, from which Railway builds the API and Vercel the web at the same sha; (4) `/health/version` shows the pushed sha; `railway up` only if the git build does not fire, and only from a checkout that has been `railway link`ed to the existing service (an unlinked `railway up` creates a new project). Web code that calls new API routes is feature-gated until step 4 passes.

**Migration tags.** The captain allocates them serially, one owner per number, after confirming T-605's reservation of 0071 with its owner: 0072 = Lane 10 CHECK constraints, indexes and the role-CHECK widening (window 1); 0073 = Lane 10 `asset_definitions` reconcile (applied only in the Friday migrate step, because the live planner reads those rows until the web deploy); 0074 = Lane 9 `requests` and `request_status_history` (window 3). Lane 5 needs no migration. Only the migration owner touches `drizzle/meta/_journal.json`; other PRs must not include `drizzle/` changes.

**File ownership.** `index.html` `<head>` meta and manifest = Lane 2; `index.html` `<style>` globals = Lane 1. `router.tsx` route list = Lane 2 (redirects, gates) and Lane 8 (`allowedRoles`) only; Lane 1's font href and Lane 7/11 changes go as one-line patches to those owners; nobody reformats it (it is CRLF) and PRs touching it show a diff-stat under 60 lines. `DashboardLayout.tsx` and `NAV_ITEMS` = Lane 8 (Lane 7 sends its nav-gating change as a patch). `NotificationCenter.tsx` = Lane 9 from Tuesday; Lane 7 emits server-side rows only. `DayBoardPage.tsx` = Lane 6 until window 2, exposing a `<SlotRequests>` mount point in its PR; Lane 9 edits only `day-board-state.ts` and the API until then. `PlannerScene.tsx` = Lane 4. `RoomSplatScene.tsx` = Lane 3 after the T-581 rebase PR lands. `utils/query.ts` and every role set = Lane 8. `seed.ts` = Lane 10 until window 1. `docs/state/tasks.md` = the captain only. E2E specs, `playwright.config.ts` and visual baselines = T-613 (Codex) — no other lane edits them; failing specs are reported to T-613's owner via `goals/EXECUTION.md`.

**The paste block for a lane session.**

```
/goal Ship Friday — Lane <N> <name> (T-<row>). Read docs/plan/18-SHIP-FRIDAY-ULTRA-PLAN-2026-09-14.md §4.0 and §4 Lane <N>. Cut `git worktree add D:/claude/venviewer-lane<N>-20260915 -b codex/ship-friday-lane<N> release/r1` (never the shared checkout). Claim it first: add a row to goals/EXECUTION.md (owner, branch, worktree, §2 lines <list>); the captain opens the T row. Tier A in order; Tier B only after Tier A is green. Done when the listed §2 lines are true on the Vercel preview of release/r1 against the disposable stack, verified by someone other than you. Verify with the commands under this lane, then `pnpm -r typecheck && pnpm -r lint && pnpm --filter @omnitwin/web build` and the named specs. Commit with explicit pathspecs; PR to release/r1 titled `Lane <N>: <name> (T-<row>)`; the captain owns the queue and the migration tags. Do not touch C:\Users\blake\omnitwin2, production data, e2e specs, or another lane's files; blockers go in docs/sessions/2026-09-1x.md.
```

Thirteen lanes follow. Hours are the readers' estimates for a strong engineer; shared items are counted once and say so. **Tier A** is release-blocking; **Tier B** ships if done by Thursday 14:00 and otherwise moves to R2.

### Lane 0 — Foundation and release safety (Tuesday; owner: the captain, plus one ops session)

Tier A, 14 h captain + 5 h ops session.

1. Push the eight local-only `codex/*` branches (0.5 h) — **not** `codex/inventory-selected-style`, which carries the retained private equipment `.docx` and jpeg (d044dec6) that must never reach the public repository; back that branch up to `D:\claude\rescue\`. Push the two unpushed commits on `worktree-twin-cad` (444de374).
2. Cherry-pick 997d980b (round-table chair-corner capacity; 2 files, merge-tree clean) as the first PR into `release/r1` (0.5 h). 87aca5ca and `codex/capture-flow-integration-20260907` are already on master; delete that branch. Assess `codex/capture-failure-recovery-20260907` (6 unmerged) and `codex/trades-hall-demo-release` (4) with `git cherry` before Wednesday, or drop them explicitly.
3. The shared checkout (1 h): push its five landing/Craft commits to `rescue/shared-checkout-landing-2026-09-15`; commit every dirty file with explicit pathspecs to `rescue/shared-checkout-dirty-2026-09-15` and push it. Reset the checkout to `origin/master` only after Blake confirms no open session uses it (§6 decision 15, §7 item 2). Never `reset --hard` while a session is open there.
4. CI green is owned by T-613 (`origin/codex/browser-release-20260915`). Window 0, Tuesday: integrate that branch into `release/r1` first (4 h of review and conflict handling); Lane 0 edits no e2e spec, `playwright.config.ts` or visual baseline. New specs from Lanes 2–6 run in a fifth shard or a separate `e2e-new` job with its own 20-minute budget; the existing four shards must finish under 20 minutes before any new spec joins them. Order inside the window: (1) T-613's spec changes, (2) the `worktree-twin-cad` merge (Lane 3), (3) only then regenerate or delete twin baselines, owned by T-613.
5. Deploy gate (5 h): cut `release/r1` and widen `ci.yml` (1 h); set the Vercel Ignored Build Step to skip master (`[ "$VERCEL_GIT_COMMIT_REF" != "master" ]`) and add a `deploy-web` job to `deploy.yml`, after `migrate`, that calls the Vercel Deploy Hook (or `vercel deploy --prod --token`) so production web publishes only once CI is green and migrations have run (3 h); after Blake has added himself as required reviewer on the existing `production` environment (§7 item 3) and the captain has verified `protection_rules` is non-empty via `gh api`, enable branch protection on master requiring the CI check (1 h). Write the migration policy into `docs/operations/deploy-flow-current.md` (0.5 h).
6. Ops session (5 h): Sentry on both sides (`SENTRY_DSN`/`SENTRY_ENVIRONMENT` on Railway, `VITE_SENTRY_DSN` + auth token on Vercel; verify one scrubbed event) (2 h); uptime monitors at one minute on `/health/live`, `/health/ready`, `/health/observability` and `https://venviewer.com/` with an alert route to Blake's phone (1 h); the Neon restore drill on a disposable branch, recorded (2 h); `cleanup.yml` gains a dry-run input and a receipt artefact, and Lane 5's hold-reminder cron sits beside it (0.5 h, counted in Lane 5).

Tier B (R2 if not reached): CSP report-only header; `security.txt`; provenance from `RAILWAY_GIT_COMMIT_SHA`; ops docs corrected (`docs/RUNBOOK.md`, `.env.production.example`, `deploy-flow-current.md`); delete `apply-migration-0009..0018.ts`, `verify-migration-0024.ts`, the `apply-migration-0018.yml` and `backfill-layout-urls.yml` workflows.

§2 lines: 28. Verify: `pnpm -r typecheck && pnpm -r lint && pnpm --filter @omnitwin/web build`; CI green on `release/r1`; `gh api repos/:owner/:repo/branches/master/protection` 200; `gh api repos/:owner/:repo/environments` shows a reviewer; the monitoring checklist rows filled.

### Lane 1 — One register (starts Tuesday 12:00 after §6 decision 1; owner: design-engineering session)

Tier A, 20 h. The register is the selected ivory, forest-green, copper and sage style (`.claude/conventions/product-experience.md`); every re-skin in Lanes 1, 6, 7 and 9 targets it. The dark graphite survives only as the ground inside the 3D viewport. The Trades House campaign pages keep their own brand register as the venue's collateral.

- Remove the `index.html:61-148` globals (golden cursor, gold scrollbar, universal 1.06× button pop); re-scope any wanted spring to the planner shell only (2 h).
- Fix the font axis: load Inter 700 (or the variable axis 200..800) at `router.tsx:26` as a one-line patch to Lane 2; replace 720/740/750/760/780/820/850/860/950 with 600/700 across the 178 rules (3 h).
- Extend `styles/house-tokens.css` with `--vv-ivory`, `--vv-forest`, `--vv-copper`, `--vv-sage`; define or rename the four consumed-but-undefined House tokens (`--house-brass` vs `--house-accent-brass` at `PlannerCockpit.css:7`, `CockpitBottom.css:626-688`, `FurnitureInspectionDock.css:29`); add a unit test that every `var(--house-*)` consumed in `src` resolves (1.5 h).
- Move the three shared primitives and the five `aria-modal` dialogs without a focus trap (`EventDetailsPanel`, `BlueprintPage` overlay, `BoardPalette`, `WelcomePanel`, `RoomSelector`) onto the ivory/forest/copper tokens with a focus trap and Escape/return-focus parity: `ToastContainer.tsx:7-10`, `StatusBadge.tsx:5-13`, `ConfirmModal.tsx`; the brass accent is retired; replace the twelve ASCII "..." with "…" (6 h).
- Raise every ≤9 px rule to an 11 px floor on live surfaces (`CockpitBottom.css`, `PhaseLayoutSnapshotAction.css`, `diary-board.css:101`, `hallkeeper-workspace.css:6`) and re-flow (3 h).
- Restore text selection in planner inputs (`App.css:27-37`) (0.5 h). `<main>` landmarks and skip links on the eleven pages without them, starting with `EditorPage`, `DashboardPage`, `DayBoardPage` (2 h). Align `theme-color` with the page ground and give `html/body` a light ground under light routes (1 h). One focus-ring style (1 h).

Tier B (~40 h, R2): the component library (Button, Dialog/Sheet, Toast, Field, Table, Card, Tabs) on the token set; migration of the 1,081 inline style sites starting with `PricingPage`, `ProposalsView`, `ProposalPage`, `BlueprintPage`, `VerticalToolbox`, `CommercialPipelineView`; axe-core in Playwright; visual-regression baselines per route.

§2 lines: 3 (signed-in count), 7 (theme colour). Verify: `pnpm --filter @omnitwin/web exec vitest run src/__tests__/house-tokens.test.ts`; the a11y route audit; before/after screenshots of Diary, dashboard, planner, home at 390 and 1366.

### Lane 2 — The front door (Tuesday–Wednesday; owner: front-of-house session)

Tier A, 36.5 h (the six-session variant keeps 19 h: everything except the canonical-home merge, with `/fresh` promoted to `/`).

- **One canonical home** (14 h; §6 decision 2): merge `FreshPage`'s photography, venue-published capacities, wedding rates and the enquiry composer (the only page with a real form, `FreshPage.tsx:928`) into `RoomsHomePage`'s room rail; the hero is the photographic Grand Hall (WebP ladder) for R1; the resolving-splat hero is R2. Capacities worded as envelopes by layout from `lib/trades-hall-venue-truth.ts`, never one number. Fallback (kill order §9): promote `/fresh` to `/` as it stands.
- Remove Dashboard/Diary/Hallkeeper from the public primary nav on `/`, `/fresh` and `/room/:slug` (`RoomsHomePage.tsx:132-138`, `FreshPage.tsx:693-698`, `RoomWalkPage.tsx:131-138`); keep "Plan an event" and one "Log in"; update the pinned tests (1.5 h).
- Enquire reaches the form (4 h): composer on the canonical page; hash-scroll on mount for any surviving `/fresh#enquire`; replace every mailto (`rite-copy.ts:249-257`, `LivingHallPage.tsx:345-350`, `craft-quiz-model.ts:940-952`, `TradesHouseCraftQuizPage.tsx:603`, `LegalPage` contact, the `/fresh` footer) with the composer or a link to it; the composer posts `TRADES_HALL_ENQUIRY_VENUE_SLUG` from `@omnitwin/types` and a route test asserts 201 from `POST /public/enquiries` with that slug (the two-slug embarrassment). The client acknowledgement email and staff notification land in Lane 7.
- `/pricing` off the public surface (§6 decision 3): out of sitemap and nav, `Disallow`, route gated or figures labelled indicative and the trial CTAs removed (1.5 h). `/demo` behind the admin `ProtectedRoute` and `Disallow` (0.5 h).
- Landing cull (3 h): redirect `/landing`, `/welcome`, `/living-hall`, `/editor` to `/`; keep `/fresh` only as the about/enquiry page. Retire or 301 the orphaned showcase route `/venues/trades-hall/rooms/:slug` (always renders API fallback copy; `assets.ts:1877-1891`) and remove the `#contact` dead anchor (2 h). Kill the remaining dead anchors: Spotlight `/rooms/grand-hall` and `/#rooms`, Pricing `/#how-it-works` (1.5 h). A designed not-found page in the register ("That link has expired or moved" with Enquire and Home actions) replacing the `*` redirect; expired proposal and supplier tokens render it with the venue's contact (1.5 h).
- Trades House pages (2 h): remove the review note from `/trades-house/leaflet` or drop it from the sitemap until the venue signs off; replace the quiz mailto with the composer link.
- Front-door weight (3 h): responsive WebP ladders with `sizes` for the hero (913 KB JPEG) and the seven supplied stills (1.7–2.6 MB PNGs), `fetchpriority=high` on the hero, drop the two unused font families.
- SEO/PWA basics (2 h): apple-touch-icon, web manifest, per-route `<title>`/description for `/` and `/room/:slug`, `viewport-fit=cover`, fix the stale `index.html:12-13` comment.

Tier B (4 h, R2): accessibility statement "Known problems" pointed at the surviving page with re-measured contrast; a Playwright pass of the canonical home and one `/room/*` at iPhone 13 and iPad viewports that also submits the real enquiry POST against the disposable stack.

§2 lines: 1, 2, 3, 4 (form and slug), 5, 6, 7. Verify: `pnpm --filter @omnitwin/web exec vitest run src/__tests__/public-copy-sweep.test.ts src/pages/__tests__/RoomsHomePage.test.tsx`; `curl -I` each retired route; `node packages/web/scripts/demo-smoke.mjs` once Lane 12 fixes its machine-bound import; a real enquiry on production Friday.

### Lane 3 — The room: walk and twin (Tuesday–Thursday; owner: room session)

Tier A, 38 h.

1. Twin (1 h): verify `/tour` and `/venues/trades-hall/twin` from a fresh profile on desktop and phone; flip `FRESH_TOUR_ENABLED` (`fresh-copy.ts:54`) so the front door links to it; record the link-removal fallback as a rollback note only.
2. Merge `worktree-twin-cad` in window 1 (8 h, Tier A with fallback): merge-tree is clean against 641f2667 but the branch changes the forge (`buildNavGraph` + `assertNavGraphConnected`), so after the merge re-forge the Trades Hall bundle with the new nav graph, `rclone` the delta to the twin bucket, verify manifest edges through the domain, resolve typecheck fallout from removed props (`hopKey`, `HOP_FOV_BREATH_DEG`, `cutaway*`), run the twin tests, walk the Grand Hall in fullscreen and plan mode. Fallback if not green by Thursday 14:00: ship the current viewer on the 11 July bundle; twin-cad → R2. Blake judges the fullscreen decision on the iPad during Tuesday's judging session (§7 item 4).
3. Touch locomotion in `InteriorCamera.tsx` (10 h): tap on the floor to glide there (raycast the y=0 plane, clamp with `containPosition`), hold-to-walk on a long press, treat a second pointer as pinch-to-move-forward and never as look; reuse the pointer-map pattern from `twin/WalkControls.tsx:255-313`. Kill-order fallback: tap-to-glide only.
4. A real mobile tier (6 h; consumed by Lane 4 too, counted here): classify touch-primary "Apple GPU"/Adreno/Mali by UA + `pointer: coarse` + `maxTouchPoints` + `deviceMemory` below "high"; that tier gets `lod: true`, a 1.0–1.5 M motion budget, settled DPR 1.5. Update `lib/__tests__/device-tier.test.ts:44` (it currently asserts the wrong mapping). §6 decision 11 authorises the reduced tier for R1 only.
5. Serve the vendor's coarser level as the sharp layer for weak tiers (6 h): Grand Hall level 4 = 2.95 M / 51.6 MB, level 3 = 1.45 M / 25.8 MB, already staged; wire `roomSplatLadder(profile)`; label it the interim device tier.
6. Walk chrome for public use (5 h): drop the staff links, `100dvh` + safe-area insets (`RoomWalkPage.css:11,21-33,121-129`), a fullscreen control, an honest status pill that never sticks at 0 % (fix the T-582 poller at `RoomSplatScene.tsx:303`, after the T-581 rebase PR lands so the file has one owner). `viewport-fit=cover` is Lane 2's.
7. WebGL context loss on the walk canvas: `preventDefault`, calm Activity status, re-invalidate on restore, reload offer after a failure (2 h; the planner half is Lane 4's).

Tier B (4 h, R2): a Playwright spec for `/room/grand-hall` (closed door for `robert-adam-room`, first view via `__roomWalk`, containment via `__roomCamera` after a drag/keys burst) plus the mobile viewport — handed to T-613 as a new spec in the `e2e-new` job.

§2 lines: 8, 9, 10, 11, 12 (walk). Verify: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/device-tier.test.ts src/components/rooms/__tests__/InteriorCamera.test.tsx`; `__roomWalk` ledger on the 4090 and on every device available; network log showing the ≤52 MB level on the phone; `curl -sI https://twin.venviewer.com/trades-hall/manifest.json`.

R2+: the 3–4 MB first rung; reopen the three closed rooms (crop the walk box for Robert Adam, yaw step for North Gallery); dollhouse/plan mode for `/room` via `RoomClipBox keepHeightFraction<1` and an orbit rig; re-chunk finest tiles; the Grand Hall floor at the content level (goal 13, T-596).

### Lane 4 — The planner on touch (Tuesday–Thursday; owner: planner session)

Tier A, 31 h. Tier B, 26 h.

Tier A:
- The T-581 ladder rebase as its own PR in window 1 (8 h): rebase 6dad07fe onto the `release/r1` sha; merge-tree today conflicts in four files (`CockpitSplatLayer.tsx`, `PlannerScene.tsx`, `use-room-runtime-splat.ts`, `use-room-runtime-splat.test.tsx`) and the branch deletes 206 lines from `RoomSplatScene.tsx`, which the room session reviews. This gives the planner the device profile and the coarse-first ladder (`runtime` into `CockpitSplatLayer` → `SparkSplatLayer`; `roomSplatLadder` in `runtime-package-resolution.ts:349`). Re-run merge-tree before quoting a conflict count.
- **Touch drag-to-move** (10 h): in `SelectionSystem.tsx:370-376` a primary touch that lands on the currently selected item (or on any placed item after one tap) enters the existing move gesture with pointer capture; two fingers stay camera; the copy at `VerticalToolbox.tsx:1331` and `:1339` becomes true. Check the overnight touch-chrome commits (68172fc0, 713cad08, 3ee0e5be) first; they moved the mobile controls.
- DPR cap and adaptive resolution (5 h): clamp `nativePlannerPixelRatio` to 2, mount `AdaptiveResolution` (or `regress` on the rig) so DPR drops to 1.5 while `cameraInteractionActive`; `planner-resolution-policy.ts:2-3`, `PlannerScene.tsx:239,477`, `CameraRig.tsx:781`.
- WebGL context loss on the planner canvas (2 h). `/blueprint` kept only as the planner's WebGL-failure fallback, gated with `withPlannerAuth` like `/plan` and included in the anonymous route pass (1 h).
- Loaded configuration name and space name in `MobilePlannerTopBar.tsx:172-175` (1 h).
- The `?perf=1` rAF sampler writing frame intervals to `window.__venPerf` (4 h); run Reception Room + 100 chairs on the 4090 and on each device Blake lends (§7 item 1); publish the JSON to `D:\claude\device-matrix\` with unmeasured devices listed as unmeasured.

Tier B (R2 unless Thursday has room): one desktop control system (12 h; §6 decision 5) — remove the `VerticalToolbox` desktop rail (hidden behind "More planner tools" at `VerticalToolbox.tsx:1905`) and the compact command deck duplicates; Camera Views, Events Sheet and the outliner into the tool pill/inspector; one "Add furniture". Tablet layout (8 h): coarse pointer + width ≥ 900 px = touch-desktop, not the phone dock (`EditorPage.tsx:441`, `use-media-query.ts:41-53`). Delete dead `cockpit/CockpitTopBar.tsx` and `components/CatalogueDrawer.tsx` with their tests; remove the injected `<style>` blocks from `VerticalToolbox` (2 h). Timeline dock collapsible to a hairline and off on phones when no event is linked (4 h).

§2 lines: 12 (planner), 13, 14, 16, 1 (`/blueprint`). Verify: `pnpm --filter @omnitwin/web exec vitest run src/components/__tests__/SelectionSystem.test.ts src/components/editor/__tests__/PlannerScene.test.tsx src/components/editor/__tests__/MobilePlannerTopBar.test.tsx`; Lane 12's touch e2e at 390×844 and 1024×768; the frame-interval JSON.

R2+: draco/meshopt + KTX2 for the GLBs; measured dimensions for the 14 "approximate" models and removal of the AI-stand-in badges; finer snap; furniture LoD per tier; production frame telemetry behind consent.

### Lane 5 — The timetable (Tuesday–Wednesday; owner: diary session)

Tier A, 31 h (the six-session variant keeps 15 h: the tray, create-in-context and the touch model). Tier B, 11 h.

Tier A:
- Enquiry tray source (3 h): request `status=submitted` and `under_review` with a full page (or a dedicated open-enquiries endpoint); stop refetching everything on every board change (`DiaryBoardPage.tsx:158-162`, `routes/enquiries.ts:48`).
- Create-in-context (6 h): New booking seeds the viewed day and the clicked or first visible room; click an empty overview cell or day-lane position to open the drawer prefilled (`DiaryBoardPage.tsx:344-353`, `lib/drawer-form.ts:134-148`).
- Touch model (6 h): long-press (or an explicit grip) lifts blocks and slips; `touch-action: pan-x pan-y` until lifted; remove the immediate `preventDefault` on slips (`DiaryBoardPage.tsx:428-442`) and add a long-press before `useBoardDrag.ts:138-141` lifts (`diary-board.css:115,149`).
- Edit drawer completeness (5 h): show and edit notes, allow room change, show the owner's name (join `users.name` into the calendar entry), show the linked client (`BookingDrawer.tsx:336, 447-452`).
- Guard global shortcuts while a drawer or `<select>` has focus; exclude self from the presence count (1.5 h).
- Hold reminders scheduled (2 h): a GitHub Actions or Railway cron hitting `POST /admin/diary/hold-reminders` with a service token; one dry-run receipt in production.
- Turnaround rules (0.5 h): `SELECT` from `turnaround_rules` on production first and find why `GET /calendar` reports "not checked"; add the admin write route against the existing table only if rows are absent (R2 otherwise); no migration.
- Repair the two diary e2e specs' stale strings and add `/diary` (stubbed calendar) to the default route pass, handed to T-613 as spec changes (4 h). Retire the hidden month view and sweep the T-603 residue (3 h).

Tier B (R2): resize handles on Day-timeline blocks with the same ink-confirm and undo (8 h); print stylesheet for week and day (3 h).

§2 lines: 17, 18, 19. Verify: `pnpm --filter @omnitwin/web exec vitest run src/pages/diary`; `pnpm --filter @omnitwin/web exec playwright test e2e/diary*.spec.ts --workers 1` on the disposable stack; a signed-in production check creating, moving and editing a "VENVIEWER TEST — delete" booking on a phone and a laptop; the cron log.

R2+: ICS feed or drop `external_calendar_links`; venue timezone through `board-time.ts`; booking-level client/headcount/catering fields and history; recurring series; idempotent from-enquiry; spring motion on settle.

### Lane 6 — The hallkeeper's day (Tuesday–Thursday; owner: hallkeeper session)

Tier A, 28 h. Tier B, 9 h. First reconcile T-606 (`docs/state/tasks.md:86`, marked done on master, the focused sheet and six-room library live): rebase onto it and do not re-skin surfaces it just published beyond the token pass below.

Tier A:
- Day Board → setup sheet corridor that does not depend on a compiled handoff (6 h): resolve `booking.eventId` → event configuration link (`resolveEventLinkedLayouts`) → the room's approved configuration → `/hallkeeper/:configId`; show an honest "no sheet yet" with the next action when nothing is linked (`DayBoardPage.tsx:62`). Expose a `<SlotRequests>` mount point on the slot for Lane 9.
- Times (4 h): pin all PDF times to `data.venue.timezone` (`hallkeeper-pdf-v2.ts:514-517, 824`); stop fabricating timing — derive `eventStart`/`setupBy` from the linked Diary booking, never an 18:00 UTC default (`hallkeeper-sheet-v2-data.ts:29-37, 414-437`).
- Remove the fictional walkthrough from production navigation (`DayBoardPage.tsx:131`, `HallkeeperPage.tsx:477`, `HallkeeperWorkspace.tsx:123`) and move the route under `/dev` (1 h).
- Token, type and copy pass (4 h) across the six pages (`DayBoardPage`, `HallkeeperPage`, `HallkeeperRoomPlansPage`, `EventDayOpsPage`, `OpsHandoffPage`, `EventMissionControl`) onto the Hallkeeper tokens; remove the "4D Mission Control / Spatial command map / Phase authority / Time machine / Live edge" copy from a hallkeeper's page. The full re-skin is R2.
- Live sync on the event-day board (4 h): reuse `useDiaryLive` or a 10 s poll with an in-flight guard; refetch after every mutation; persist acknowledgements from the server (`EventDayOpsPage.tsx:143, 228, 298`; the acknowledgement read route is Lane 11's).
- Issue lifecycle (4 h): resolve/close and assign via `updateEventDayIssue`; optional phase/task link; reflect resolution on the sheet's "Keep in view".
- One execution model per event page (3 h; §6 decision 7): hide Mission Control's incident form and task grid when the ops board's own controls are shown.
- Supplier arrivals only when an `arrivalWindow` or supplier is captured; compiler notes labelled as notes (1.5 h). Venue timezone instead of the hard-coded "Europe/London" (0.5 h).

Tier B (R2): derive the sheet's current stage and next action from the Day Board clock with a manual override (4 h); an at-a-glance kit strip (tables, chairs by type, AV, linen) in the sheet header and PDF (2 h); repair `e2e/hallkeeper.spec.ts` and add a Day Board e2e via T-613 (3 h).

§2 lines: 20, 21. Verify: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/hallkeeper-pdf-v2.test.ts src/__tests__/hallkeeper-floor-plan.test.ts`; `pnpm --filter @omnitwin/web exec vitest run src/pages/hallkeeper src/pages/__tests__/HallkeeperPage.test.tsx`; one booking followed phone → sheet → PDF on the disposable stack with the PDF opened; screenshots of the six pages side by side.

R2+: slot messaging and ops states (Lane 9 continues), caterer/AV surfaces on the same sheet with role filters, offline-first shell (revive `use-hallkeeper-sheet.ts`), richer "what changed", server push for shared checks, multi-venue room plans.

### Lane 7 — The back office (Tuesday–Thursday; owner: commercial session)

Tier A, 28 h. Tier B, 20 h.

Tier A:
- Remaining role scoping (4 h): `crm.ts:34-38` and `opportunities.ts:41-45` still 403 venue admins; import `canManageCommercial` from Lane 8's stub rather than defining a helper; send the nav-gating change (hide Create Opportunity / Pipeline / Client Search / Analytics from roles the API rejects; `EnquiriesView.tsx:249-258`, `DashboardLayout.tsx:61-62`, `router.tsx:417`) to Lane 8 as a patch.
- Newest-first plus real pagination for enquiries, proposals and opportunities (`enquiries.ts:48,97`; `proposals.ts:85,301`; `opportunities.ts:138`; `crm.ts:190`) (4 h).
- Analytics truthfulness (8 h): venue picker or `venueId` for platform admins (`revenue-analytics.ts:63-70`); one definition of pipeline value shared with the Pipeline tab; utilisation from bookings; drop the permanently empty scenario cards. Kill-order fallback: hide the wrong numbers (2 h).
- Notifications that notify (6 h): write an `eventPlanNotification` on new public enquiry and on client accept/request-changes regardless of `configurationId` (`public-enquiries.ts:202-248`, `proposals.ts:155-157`); staff and sales notified, not hallkeepers only; unread count on the visible nav (Lane 9 makes it live).
- The venue's voice on email (2 h): `EMAIL_FROM` set on Railway to the venue's name with a monitored reply-to (the default is `VenViewer <notifications@venviewer.com>`, `email.ts:201`); the client acknowledgement template written in the venue's voice with the organiser's name and an en-GB date, no unsubscribe link.
- Reviewer email deep link: support `/dashboard?view=reviews&config=:id` and fix `configuration-reviews.ts:474` (2 h). Remove or dev-gate the "DEMO ONLY" copy (`ReviewsView.tsx:507-513`, `SubmitForReviewPanel.tsx:198`); retire `/proposal/:shareCode` in favour of the token page with a thirty-day redirect (2 h).

Tier B (R2): one register and responsive layout for Enquiries, Client Search, Client Profile, Pipeline, Proposals, Analytics and `SupplierPortalPage` — inline styles to the ivory/forest/copper tokens, breakpoints, 44 px targets (12 h); the enquiry → opportunity → proposal corridor navigable (Create Opportunity jumps to the pipeline with it selected; the raw-UUID quick-create becomes a picker; opportunity detail shows the client; dashboard proposals can attach a configuration so the client sees the layout) (8 h).

§2 lines: 4 (email), 23. Verify: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/enquiries src/__tests__/crm src/__tests__/opportunities src/__tests__/revenue-analytics`; a signed-in production check as Blake's admin: Pipeline opens, analytics agree with the Pipeline tab; the received acknowledgement email read.

R2+: contracts, deposits, invoicing, e-sign (R4); client accounts and contacts surfaces; proposal templates and F&B packages; pricing rule editor; email integration for replies and sends; team messaging (Lane 9 continues).

### Lane 8 — Roles (Tuesday–Wednesday; owner: identity session)

Tier A, 22 h. Tier B, 13 h. Lane 8 is the only lane that edits a role set or `utils/query.ts`; it lands first in window 1 and Lanes 5, 7, 9 and 10 rebase on it. Until §6 decision 6 arrives, Lane 8 does only the fan-out inventory and the stub PR.

Tier A:
- The stub PR by Tuesday 16:00 (2 h, counted in the 6 h below): `utils/query.ts` exports `canAdministerVenue`, `canManageCommercial`, `canReadInventory`, `canWriteInventory`; Lane 7's crm/opportunities scoping and Lane 10's inventory read split import those and never define their own.
- **Role vocabulary defined once** (12 h): add `caterer` (supplier-class, event-scoped), `sales`, `manager` to `USER_ROLES` in `packages/types/src/user.ts:19`; fan out to `auth.ts:37`, `env.ts:26`, `types/onboarding.ts`, the `EVENT_PLAN_AUDIENCE_ROLES` CHECK (via Lane 10's 0072), `role-routing.ts`, `DashboardLayout.tsx` (delete the `supplier` branch at `:57` with the `executive` ones at `router.tsx:417`, `role-routing.ts:10`, `DashboardLayout.tsx:57-58`, `DashboardPage.tsx:66-75`), `booking-mutations.ts:117` `DIARY_WRITE_ROLES`, `ws/diary-live.ts:49` `DIARY_READ_ROLES`, `enquiries.ts:78`, and every `router.tsx` `allowedRoles` literal (`:409, :418, :425`). The unsafe `EventPlanAudienceRoleSchema.parse(request.user.role)` sites (`events.ts:580`, `proposals.ts:451,572,885`, `event-day-ops.ts:164,240`) become safe parses. Hallkeepers lose edit on venue, spaces and pricing but keep inventory read and room-state write (§6 decision 6b).
- Audit and collapse the per-route helpers remaining on 641f2667 (`crm.ts` `staffVenueOrAdmin`, `opportunities.ts` `commercialScope`, integrations, proposals/events) into `utils/query.ts` beside `canManageVenue`/`canWriteEvents`/`canAccessInternalEvent`, with venue admin included everywhere staff is and planner removed from integrations/revenue (6 h).
- The public dead end (4 h): the trial CTAs come off with `/pricing`; route uninvited signed-in identities to a "Request access" form posting to the existing public enquiry route with a venue-access reason; denial screens get "Use another account" and "Back to Venviewer" (`ProtectedRoute.tsx:36-56`).

Tier B (R2): People & access for venue admins (list, invite by email with a role, change role, suspend) gated by `canAdministerVenue` (18 h); a real invitation email with a personal `/register?invite=<token>` link using the unused `token_hash` column (6 h); one Clerk appearance and the vendor-name copy at `clerk-localization.ts:22-24,32` (4 h); a short-TTL per-clerkId fast path in `authenticate` (`auth.ts:193-275`) (5 h).

§2 lines: 25, 26. Verify: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/auth.test.ts src/__tests__/invitation-auth.test.ts src/__tests__/proposal-permissions-postgres.test.ts src/__tests__/quote-permissions-postgres.test.ts` plus new 401/403/400 tests on every touched route; `pnpm --filter @omnitwin/types test`.

### Lane 9 — Requests and the flashing slot (Tuesday–Friday; owner: conversation session)

Tier A, 30 h. Tier B (R2), 33 h. This is Blake's feature, built on the primitives that exist (the venue-scoped websocket with exactly-once command envelopes, the event bus, the notification tables, the Day Board's slot state machine) and on goal 04's decisions, with three departures Blake is asked to authorise (§6 decisions 12 and 13): requests go live without goal 06's staging rehearsal, rehearsed on the disposable stack and a preview instead; the thread/message model follows in R2 and requests fold into it as messages of kind `request`; direct messages are R2. Lane 9 is decoupled from Lane 8: the R1 escalation target is the venue admin, and `manager` becomes a one-line follow-up if Lane 8 lands first.

Tier A:
- **Requests as first-class data** (12 h, migration 0074): `requests` (venue id, booking or slot, room, kind `refreshments | temperature | cleaning | av | access | other`, quantity, urgency `routine | soon | now`, free text, requested-by actor, owner, state `sent | acknowledged | accepted | resolved` with outcome and note, idempotency key) plus `request_status_history`; Zod in `@omnitwin/types`; routes gated by venue tenancy; audience fixed at creation and never widened. Chairs and tables are deferred until the decision object exists (goal 04 Decided). Reconciled against `event_day_issues` first (its schema lacks kind, quantity, room, slot and urgency, so a new table is the honest answer).
- Live delivery (6 h): `notification.created` and `request.changed` on the bus `EventMap`; emit after commit; fan out over `/ws/diary` to the venue's connected staff; client reconnect replays; the inbox subscribes.
- **The request slab on the Day Board slot** (10 h): `day-board-state.ts` (pure, unit-tested) gains a requests input keyed by booking; open requests render as one slab in Lane 6's `<SlotRequests>` mount point after window 2 (until then Lane 9 touches only `day-board-state.ts` and the API); the slot pulses **once** then holds a steady coloured dot (never above three per second, no siren, silence in a room in use); accept and resolve from the slot; the Diary drawer shows the same request. Staff create requests from the slot in R1 (the client composer is R2).
- Unread count on the visible nav (1 h). Escalation (1 h): an unacknowledged "now" request escalates to the venue admin by in-product notification plus email through the existing Resend service after the window read from a `venue_settings` row seeded for Trades Hall (default 3 minutes), never a code constant, so R2's people matrix replaces data rather than code.

Tier B (R2): the client request composer on a client page; "seen by [name]"; per-button escalation ladders and quiet hours; `NotificationCenter` restyled and subscribed; minimal staff-private and client-facing threads attached to a request; idempotent issue creation for offline replay; staff notification on supplier acknowledgement.

§2 lines: 22. Verify: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/requests` (401/403/400, audience immutability, idempotency replay returns the same request); `pnpm --filter @omnitwin/web exec vitest run src/pages/hallkeeper/lib/__tests__/day-board-state.test.ts`; three signed-in identities on the disposable stack over the real websocket; on production Friday 16:30 one "VENVIEWER TEST — delete" booking: Blake presses a request on one phone and a second phone on the Day Board sees it pulse.

R2+: full request taxonomy and per-venue SLAs; email-after-silence as a cron pass; people matrix as venue configuration; web push and quiet hours; Redis backplane before a second replica; presence unified.

### Lane 10 — Inventory and data (Tuesday–Friday; owner: data session)

Tier A, 22.5 h (+4 h on Friday if §6 decision 14 is yes). Tier B, 25 h. Tuesday's Lane 10 is read-only.

Tier A:
- Read-only first (1 h): `SELECT count(*)` on the stock and `asset_definitions` tables (the 7 September figures are unverified since); compare production bookings for w/c 7 and w/c 14 September against the seed titles in `seed.ts:311-467` (Mackenzie–Ross, MacLeod, Robertson, Kerr, Nairn, Sinclair); record both results in the session log.
- The intake (0.5 h): extract only the derived records into the lane worktree — `git show d044dec6:docs/data/trades-hall-equipment-2026-09-05.json > …` and the source-review note — from the shared object store (`C:\Users\blake\omnitwin2\.git`) before Lane 0 prunes anything. Never cherry-pick d044dec6; the `.docx` and jpeg stay off the repository; whether even the normalised JSON is committed is §6 decision 16 (recommend no; import from the private archive).
- Reconcile the catalogue (5 h, migration 0073, applied only in the Friday migrate step): retire or rename the 8 legacy `asset_definitions` rows (check `placed_objects` FK usage first) and add the 3 missing canonical items; add Chiavari, pink, red/gold gallery chairs, highchairs, staging sections, TVs, mics to `asset-catalogue.ts`; extend `FURNITURE_CATEGORIES` with linen/staging/av where needed.
- Migration 0072 (5 h, window 1): CHECK constraints for `users.role` (with Lane 8's list), `configurations.state/review_status/visibility/layout_style`, `enquiries.state`, the `EVENT_PLAN_AUDIENCE_ROLES` CHECK widening, plus backfill assertions; indexes `events(venue_id, starts_at)`, `events(venue_id, ends_at)`, `pricing_rules(venue_id, space_id) WHERE deleted_at IS NULL`, `placed_objects(asset_definition_id)`.
- The seed purge (2 h; after §6 decision 10, Thursday after go, after a fresh Neon backup branch): delete every booking, event and enquiry whose title matches the seed fixtures, whichever week they sit in; add a seed marker so fixtures can never be mistaken for real inks again.
- Copy and default-state pass (3 h): remove "check dimensions"/"Approx." subtitles; replace the "Add catalogue items to record stock" dead end; open on an item with stock and a photo; hide digest hashes and UUIDs behind a disclosure. Replace the invented accessories (`hallkeeper-accessories.ts:113-131`) with Trades Hall's real black/white linen and chair covers, or remove dressing accessories until confirmed (2 h).
- Read-only inventory for hallkeeper, staff, planner (4 h): import `canReadInventory`/`canWriteInventory` from Lane 8's stub; `packages/types/src/venue-inventory.ts:84-87` (consumed by `routes/venue-inventory.ts:16-25`).
- The stock import (4 h, Friday 16:30–17:30, only if decision 14 is yes): the 53 records plus the 200 Chiavari through the audited stock-adjustment command, actor = Blake's admin account, reason "initial intake 2026-09-05", backup branch id recorded first; additive, after the API release.

Tier B (R2): stock in the planner (owned/usable badge per catalogue card) (8 h); compress the furniture GLBs (meshopt/draco, 1K textures, target <1.5 MB; the default chair is 7.4 MB with 2K textures) (6 h); anonymise on Clerk `user.deleted` and document retention (3 h); `general_audit_log` gains `venue_id` and a reader or stops being written (2 h); delete the migration debris and the `db:generate` trap (2 h); catalogue photographs wired (4 h).

§2 lines: 27. Verify: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/migration-tail-readiness.test.ts src/__tests__/venue-inventory-postgres.test.ts src/__tests__/inventory-reservations-postgres.test.ts src/__tests__/route-atomicity-postgres.test.ts` against the disposable Postgres; `SELECT` counts before and after; the guarded helper's ledger receipt.

R2+: banqueting consumables model; editable hired-in stock with a real hire order; demand from saved layouts; catalogue administration UI; schema unification of Venue/Space/Enquiry/PricingRule across types, API and web.

### Lane 11 — The event chain (Wednesday–Thursday; owner: event session)

Tier A, 12 h. Tier B, 12 h.

Tier A:
- Bind handoff packs to events from the planner (6 h): pass the linked `eventId` from `?eventId` into `compileOpsHandoffPack` in `OpsLensPanel.tsx:68`; create the `event_configuration_links` row when the corridor opens; the Event Day board stops saying "missing handoff".
- Persist change acknowledgements (3 h): `acknowledgedBy`/`acknowledgedAt` on the change feed (or `GET /events/:id/change-acknowledgements`), read by Lane 6's board.
- Copy and dead-end cleanup (2 h): hide `AIDraftPanel` when `/ai/status` is not configured; reword the Event Architect hero. Hide the Event Architect nav link for R1 (1 h; §6 decision 8), sent to Lane 8 as a `NAV_ITEMS` patch.

Tier B (R2): an event editing surface (guest count, start/end, status via `PATCH /events` with `expectedStateDigest`) and phase scheduling so fresh events populate the timeline (8 h); minimal change impact — mark linked handoff packs stale and flag frozen snapshots and approved sheets whose count differs (4 h).

§2 lines: 20 (corridor half), 21 (acknowledgements). Verify: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/event-day-ops src/__tests__/events.test.ts src/__tests__/ops-handoff`; `pnpm --filter @omnitwin/web exec vitest run src/components/editor/cockpit/__tests__/OpsLensPanel.test.tsx src/__tests__/EventDayOpsPage.test.tsx`; open `/ops/events/<id>` on the preview and confirm the board no longer says "missing handoff".

R2+: the decision object (goal 09 M1), the change-impact engine, a real AI provider adapter gated by role and venue, push transport, a reachable Time Machine.

### Lane 12 — Verification and release (Wednesday–Friday; owner: test session, separate from the captain)

Tier A, 13 h. Tier B (R2), 29 h.

Tier A:
- Touch drag-and-drop e2e for the planner at iPhone and iPad viewports using `hasTouch`/`page.touchscreen` (5 h), in the `e2e-new` job; branched from `release/r1` after window 1 so it uses Lane 10's marked seed; Clerk test keys (§7 item 6) by Wednesday 08:00.
- Delete dead test code and machine-bound paths (3 h): `public-config-flow.spec.ts:235-283` `describe.skip` blocks, the `fixme` at `plan-room-resolve.spec.ts:289`, the six `C:/Users/blake` artifact paths (e26bda63 pattern), `demo-smoke.mjs:18`'s machine-bound import — coordinated with T-613 since these are spec files.
- Release rehearsal (4 h) on the disposable stack and a Vercel preview: the checklist from `docs/operations/trades-hall-demo-release-2026-09-07.md` re-run for R1 in the §4.0 order; `railway link` verified with `railway status` before any `railway up`.
- Production smoke run after the Friday deploy (1 h).

Tier B (R2): the real-stack e2e lane in CI (16 h); sleep-based assertions replaced with polls and CI retries set to 1 (3 h); the opt-in live specs updated to current copy (2 h); enquiries, public-configuration save/claim, calendar read model and hallkeeper sheet moved onto the real-Postgres runner so a 500 no longer passes (8 h).

§2 lines: 13 (e2e), 29 (touch), 28 (rehearsal evidence). Verify: `pnpm --filter @omnitwin/web exec playwright test e2e/touch*.spec.ts --workers 1`; the CI job URL for `e2e-new`; the rehearsal's ids and timestamps in `docs/sessions/2026-09-18.md`.

---

## 5. The week, hour by hour

**Tuesday 15 September**
- 08:00 The captain records the available sessions and the cut sha in `goals/EXECUTION.md`, pushes the eight local branches and the two twin-cad commits, tags `release/r1`, widens `ci.yml`; 997d980b lands as the first PR. No cherry-picks or resets before the tag. Lanes cut their worktrees.
- 09:00 Lane 0 window 0 (T-613 integration), Lane 10 (read-only checks), Lane 8 (fan-out inventory and the stub PR) start. Lane 1 waits for §6 decision 1; Lanes 8 and 10 wait for decision 6 before writing the vocabulary or 0072.
- 12:00 Blake's answers to §6 due (the register, the roles, the migration policy, the seed purge first). The captain publishes the queue: Lane 0 → 8 → 10 → 1 → 7 → 5 → 6 → 2 → 4 → 3 → 9 → 11. All lanes running.
- 16:00 Lane 8's stub PR merged into `release/r1`. Blake has added himself as required reviewer on the `production` environment; the captain verifies and enables branch protection.
- 18:00 **Checkpoint 1**: is `release/r1` cut with T-613 integrated and CI running on it? If not, the kill order in §9 starts. Sentry, uptime and the restore drill done by the ops session. Blake's first judging session: Lane 1's before/after, Lane 2's home direction, the twin fullscreen on the iPad.

**Wednesday 16 September**
- 08:00 CI green target on `release/r1`.
- 12:00 Merge window 1 into `release/r1`: Lane 8, Lane 10 (0072), the T-581 rebase PR, Lane 1, Lane 7, in whatever order is green; Lane 3's twin-cad merge and re-forge. Vercel preview of `release/r1` against the disposable stack.
- 18:00 Merge window 2: Lanes 5, 6 (with the `<SlotRequests>` mount point), 2. **Checkpoint 2**: is every Tier A lane green in its worktree? If not, cut per §9. Blake's second judging session: home, walk chrome, Diary, the six hallkeeper pages, the dashboard.
- Evening: Lane 12's touch e2e lands in `e2e-new`; device measurements start on whatever devices arrived.

**Thursday 17 September**
- 08:00 Merge window 3: Lanes 4, 3, 9 (0074), 11. Tier B items land only if their lane's Tier A is already green.
- 14:00 Feature freeze for R1. Only fixes for §2 lines after this.
- 15:00 Full §2 gate on `release/r1` (disposable stack + Vercel preview) run by the captain with a second session verifying, not the authors.
- 18:00 **Go / no-go.** Go means every Tier A line in §2 is true on the release candidate; nothing new is on the Railway service until Friday. No-go means the honest Monday 21 September plan, with Friday used to finish Tier A. After go: the seed purge (Lane 10, after a fresh backup branch).
- Evening: Blake walks the release candidate preview on his phone, iPad and the venue laptop; the aesthetic verdict per surface goes in the session log.

**Friday 18 September**
- 08:00–12:00 Fix window for anything Blake or the gate found; no new scope.
- 13:00–14:00 The release sequence (§4.0): backup branch id → `db:verify-tail` and migrations 0072, 0073, 0074 through the guarded helper against the exact `release/r1` sha → push to master → Railway builds the API and Vercel the web at the same sha → `/health/version` shows it (`railway link` + `railway up` only as the fallback).
- 14:30 Production smoke; §2 gate re-run on production.
- 16:00 Live verification with real accounts, everything titled "VENVIEWER TEST — delete": an enquiry from a phone (the acknowledgement email read); a booking created by clicking a slot; a hallkeeper phone from Day Board to sheet to PDF; a request pressed on one phone and seen on another; the walk and the twin on the lent devices; the planner drag on the iPad. The stock import if decision 14 is yes (16:30–17:30).
- 17:30 The release note in `docs/sessions/2026-09-18.md`: source and deployment identity, the §2 checklist with evidence links, the measured device numbers, the test ink deleted (ids listed), and the material limits carried into R2. Weekend hold on production, fix-forward only for a live incident (§6 decision 17); `cleanup.yml` runs over the weekend as normal.

---

## 6. Decisions I need from Blake (recommendation first; one word suffices; the first four by noon Tuesday)

1. **The register.** Ivory, forest green and copper — the style you selected on 6–7 September — on every R1 surface: home, walk chrome, planner shell and inspector, sign-in, Diary, hallkeeper pages, back office, the request slab. The dark graphite survives only as the ground inside the 3D viewport; the golden cursor, gold scrollbar and brass accent go. The goal-01 sublime rebuild and your pick from the three-role study are R2+. Recommend yes. Lane 1 waits on this.
2. **The homepage.** Merge `/fresh`'s photography, capacities, rates and enquiry composer into `/` (the scanned-rooms page keeps the rail; the photographic Grand Hall is the hero for R1). Recommend yes.
3. **Pricing.** Take `/pricing` off the public surface until billing exists. Recommend yes.
4. **The three closed rooms.** Keep Robert Adam, North Gallery and Lady Convenor's closed but with venue copy ("Ask us to walk this room in person") instead of "alignment in review". Recommend yes; reopening is R2 work.
5. **Planner desktop control system.** The tool pill + inspector (the 6 September direction) survives; the legacy toolbar rail and the compact deck go (Tier B, so R2 if Thursday is full). Recommend yes.
6. **Roles**, three parts, needed by Tuesday noon: (a) add `caterer`, `sales`, `manager` to the five — recommend yes; (b) hallkeepers lose edit on venue, spaces and pricing but keep inventory read and room-state write, and never see prices (they record facts and photos; finance prices them) — recommend yes; (c) suppliers stay on share-token passes until R5 — recommend yes. (AV, security and front of house become `staff` with a job-title field until their surfaces exist.)
7. **Hallkeeper execution model.** The event-day ops board is the hallkeeper's surface; Mission Control's incident form and task grid are hidden there and Mission Control stays a manager's view. Recommend yes.
8. **Event Architect.** Hidden from navigation for R1 (null price book, unusable phone review). Recommend yes.
9. **Migration policy.** Add yourself as required reviewer on the existing GitHub `production` environment so `deploy.yml`'s migrate job waits for approval; hand migration through the guarded helper stays the R1 path. Recommend yes (a GitHub settings change only you can make, Tuesday before 16:00).
10. **The seed week.** Production holds a fictional demo week (seeded for 7 September; possibly 14 September too). After a Neon backup branch, delete every booking, event and enquiry whose title matches the seed fixtures, whichever week they sit in, and add a seed marker so it cannot recur. Recommend yes.
11. **The phone tier for R1.** iPhone and iPad get the vendor's 2.95 M-splat level as the sharp layer and DPR 1.5 in motion, labelled interim; parity work continues per plan 16. This is a visible reduction and needs your word. Recommend yes for R1 only.
12. **Requests in production on Friday** without goal 04's staging rehearsal, rehearsed on the disposable stack and a preview instead; threads and messages in R2, with requests folded into them. Recommend yes.
13. **Direct messages** between everyone are Release 2 on 25 September; Friday carries staff-created requests and the flashing slot only. Recommend yes.
14. **The stock import.** Import the 53-record equipment intake plus the 200 Chiavari into production stock on Friday after the API release through the audited adjustment command (your admin account, reason "initial intake 2026-09-05", backup branch first). Recommend yes.
15. **The shared checkout.** Reset `C:\Users\blake\omnitwin2` to `origin/master` after the two rescue branches are pushed, once you confirm no VS Code or Codex session is open there. Recommend yes.
16. **Publish the normalised equipment JSON** (never the `.docx`) to the public repository? Recommend no — keep it in the private archive and import from it.
17. **Go/no-go authority.** The captain calls it at Thursday 18:00 on the §2 gate; a no-go means Monday 21 September; a weekend hold on production after Friday, fix-forward only for a live incident. Recommend yes.

Adopted unless you say otherwise: one pulse then a steady dot on the request slab (plan 16 rejects constant pulsing; the veterans agreed); R1 water requests route to the hallkeeper, and caterer routing arrives with the supplier pass in R2; the legacy `/proposal/:shareCode` links redirect to the token page for thirty days.

## 7. What only Blake can do this week (ordered by leverage)

0. **By noon Tuesday**: one word each on §6, the register and the roles first.
1. **Devices** (Tuesday): lend, on the venue's Wi-Fi and on 4G, whichever you own of iPhone 15/16/17, an entry iPhone, iPad (A16) and iPad Air/Pro, the venue laptop, plus one ordinary office PC; or run the one-command harness the planner session hands you and send back the JSON to `D:\claude\device-matrix\`. Unblocks every honest fps and load number and your own judging sessions.
2. **The checkout and the captain's authority** (Tuesday): confirm nothing of yours is open in `C:\Users\blake\omnitwin2` so Lane 0 can reset it after the rescue branches exist; confirm the captain may `railway link`/`railway up` the existing service and set Vercel and Railway variables.
3. **Environment protection** (Tuesday before 16:00): add yourself as required reviewer on the GitHub `production` environment (decision 9).
4. **Judging sessions** (Tuesday, Wednesday, Thursday evenings, 30 minutes each on your phone and iPad): home, walk chrome, Diary, the six hallkeeper pages, the dashboard, and the twin's fullscreen (does it hide the reticle and the dollhouse dots?) on the iPad. This is §2 line 30; nothing else satisfies it.
5. **Sentry and uptime accounts** (Tuesday): an org for Sentry (or a DSN pair) and an uptime monitor account with your phone as the alert route.
6. **Clerk test keys** and the fixture users as GitHub secrets, by Wednesday 08:00, for the touch e2e job.
7. **Equipment photographs** (by Wednesday): front, side and above for the Chiavari, the checked chair, the pink chair, the gallery chair, each trestle and round, the poseur, the lectern, the projector/TV; phone photos are fine.
8. **A real booking for the Friday walk**: name one real upcoming booking we may use (or Elaine's next event if she names one by Thursday); otherwise the walk uses a labelled test booking.

Later, not this week: Elaine and a working hallkeeper for the R2/R3 rehearsals; the people matrix corrections (R2, when it becomes venue configuration); pricing, deposit schedule, cancellation terms, Stripe and e-sign business details (R3/R4).

---

## 8. The ecosystem beyond Friday — what the veterans specified

The full panel output is `D:\claude\ship-friday-plan\veteran-panel-full.json` (21 roles, 534 dream features, 553 request buttons); the chair's synthesis is `veteran-synthesis.json`. This section carries what the plan needs.

### 8.1 The fifty-nine clusters, ranked, with the release that carries each

The chair ranked by how many roles asked and by five-star impact; I have mapped each to the train in §3. Priority, surface, complexity, roles asking, then the cluster.

1. messaging · M · 21 roles · Concierge request buttons with named acknowledgement, SLA clock and escalation → R1 v1 (staff-created, venue-admin escalation), R2 complete
2. messaging · M · 12 · Event-scoped instant messaging (one thread per booking, mention a role, read receipts as names, quiet hours) → R2
3. hallkeeper · M · 16 · Setup sheet / BEO generated from the plan, with the real room in it, versioned and delta-marked → R1 partial (real times), R2 (kit strip, photo frame, deltas, receipts)
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
14. public · S · 12 · Real enquiry, response clock and share previews → R1 (real enquiry and acknowledgement), R2 (response clock, per-route previews)
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
26. mobile · S · 9 · Gloves-on, quiet-by-room mode, true dark mode → R1 (quiet-by-room), R2 (one-thumb Day Board, dictation, queued taps)
27. walk · S · 10 · Honest measurement, exact-view sharing, room facts in the walk → R1 (honest labels), R2 (share exact view)
28. client · M · 9 · Supplier pass and vendor access pack → R2 (extending the existing supplier portal)
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
46. diary · L · 8 · Flip clock: turnaround computed from the layout delta → R4 (fixed buffers stay in R1)
47. diary · M · 5 · Goods lift, loading bay and supplier slots as bookable resources → R4
48. finance · M · 8 · Pay and sign in the page → R4
49. kitchen · L · 7 · Seat-level dietary map and guest self-declaration → R5
50. planner · L · 5 · Production geometry: power map, rigging registry, projection throw → R5
51. walk · L · 12 · Step-free route and escape routes walked in the twin → R5
52. planner · L · 5 · Guest-count ripple and live price in the planner → R5
53. walk · L · 6 · Light and presence: sun at the hour, candlelight, walk together → R5
54. platform · L · 9 · Offline-tolerant hallkeeper phone → R5
55. platform · M · 7 · Supplier and caterer as real roles, day pass for casuals, evacuation mode → R5 (caterer logs in from R1)
56. hallkeeper · XL · 5 · Plan-to-reality photo check and porter route order → R5
57. backoffice · L · 4 · Facilities intelligence: asset passport, wear ledger, repeat-fault detection → R5
58. public · L · 5 · Public design-your-event in the real room → R5
59. platform · XL · 3 · Multi-venue tenancy → R5

The chair marked 44 of 59 as Friday-viable. I do not agree; the readers' 666 hours on the existing code decide the week. The R1 mapping above is mine.

### 8.2 The request buttons

Twenty categories with routing, default urgency and SLA, from the merged catalogues. The R1 seed set is starred (staff-created in R1; the client composer and the routing to caterers arrive in R2 with the supplier pass); R2 carries the rest and per-venue SLAs as venue configuration.

| Category | Urgency · SLA | Routes to | Buttons |
|---|---|---|---|
| Comfort and consumables ★ | soon · 10 min | hallkeeper (R1); caterer when on the event (R2); events staff | Water (table / top table / all) ★, tea and coffee top-up ★, too hot / too cold ★, lights brighter/dimmer/preset, windows or blinds, ice, station replenish |
| AV and technical ★ | now · 3 min | AV technician or AV-trained staff; hallkeeper; duty manager on breach | AV / media help ★, microphone not working ★, projector or screen ★, connect my laptop, Wi-Fi help, music up/down/stop, cannot hear the speeches, power trip, house lighting state |
| Furniture and layout | soon · 15 min | hallkeeper; events staff | More chairs (count), another table (type), remove chairs or tables, layout change (opens the plan), clear and reset, dance floor ready, signage/easel/seating board, stage or lectern — R2, once the decision object carries stock consequences |
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

### 8.3 The people matrix (draft for Blake to correct in R2; becomes venue configuration, never code constants)

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
| Photoreal walkthrough on a phone with dollhouse, plan, measurement, tags, guided tour (Matterport, iGuide) | walk live for 5 rooms, look-only on touch; the twin live with dollhouse and plan | a continuous splat walk that knows the Diary and inventory; the venue owns the captures with no per-room rent |
| Deep link to an exact view, shareable without login, rich preview, embeddable (Matterport, Kuula) | the twin has share; the walk has none | the exact view is the atom of every message, proposal line and setup instruction |
| Proposal/contract with online acceptance or e-signature (Tripleseat, Cvent, Event Temple, HoneyBook) | proposal accept exists via share token; no e-sign; dashboard proposals cannot attach a layout | the proposal opens on the client's layout in the real room; acceptance freezes the version and stamps the plan |
| Client portal with documents, tasks, timeline, messages, payments (Planning Pod, Tripleseat, Event Temple, Momentus) | none | one passwordless page that contains the room itself and the named people on duty |
| Run of show shared with staff and vendors, with owners (Planning Pod, iVvy, Priava, Shoflo) | phases exist; unschedulable from the product | the timeline is the Diary projection; fire/hold/slip moves everyone once |
| Operational work orders routed to departments (Momentus, Priava) | issues open-only, event-scoped | requests one-tap from the organiser's hand, acknowledged by name with an SLA clock |
| Staff request ticketing with acknowledgement, SLA, escalation (ALICE, HotSOS, Quore) | none (R1 v1 lands the slab) | open to the client and suppliers, spatially pinned, feeding Monday's numbers |
| Inventory reservation across simultaneous events with shortfall warnings (Momentus, Cvent) | real domain, zero stock, planner unaware | reservations from the placed layout hour by hour; an inconsistency detector |
| Automated follow-up sequences tied to pipeline stage (Event Temple, Tripleseat, Salesforce) | follow-up tasks exist; no sequences or open tracking | chases carry the client's room picture; pause on tour re-visits |
| Account and contact activity timeline with role permissions and audit (Salesforce, Tripleseat) | tables exist; no client profile surface | recognition (preference ledger, "welcome back") rather than a record |
| Reporting on pipeline, conversion, occupancy, revenue (Salesforce, Event Temple, Cvent) | analytics with wrong definitions and a 400 for platform admins | Monday Numbers drilling to the Diary booking, plus request-SLA and setup-accuracy metrics |
| Real-time public availability with instant hold or enquiry on a date (iVvy, Priava, Perfect Venue) | none public | availability shown inside the room you are standing in |
| Dietary and accessibility per attendee carried to the kitchen and sheet (Cvent, Tripleseat, Planning Pod) | sheet schema has dietary/accessibility; no structured counts flow | UK-14 counts locked with a change ledger, mapped to the seat |
| Vendor portal / supplier collaboration on the plan (Planning Pod, Prismm, Cvent) | a share-token supplier portal with acknowledgements; silent to staff | the portal extended into a no-login pass with door, route, rules, on-shift contact and "I have arrived" |
| Guest-facing event page with agenda, map, add-to-calendar, live changes (Cvent Attendee Hub, Zola) | none | Your Evening card projects the Diary live and shows the seat's view |
| Post-event survey and review prompts (Tripleseat, Perfect Venue, Bridebook) | none | a same-night thank-you from a named person, then a review at the moment of joy |
| Accessibility conformance acceptable to procurement (Cvent, Salesforce, Momentus) | a statement exists; the audit skips flagship routes | WCAG 2.2 AA including the planner canvas and the seated-eye walk |
| CSV/ICS import, full export, sandbox (Salesforce, Planning Pod, Priava) | none | import reconciles against the Diary and turnaround rules with one-action undo |
| Branded transactional email with the venue's name and a delivery log (all incumbents) | Resend, nine templates, audited; From is "VenViewer" | typeset like the screen, from the venue's name, no noreply anywhere |

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

Flashing (one pulse then a steady dot; sound only for "now"; silence by Diary phase). Water routing (caterer if attached, else hallkeeper, 10 minutes; hallkeeper only in R1). Custom-request triage (sender may choose; events staff in office hours, hallkeeper otherwise). First aid (broadcast to all on shift plus first aider, incident opened, 999 stated, discreet on public screens). Messaging by Friday (minimal one thread per event with receipts and quiet hours in R2, not R1 — §6 decision 13). Client link (a minimal day page in R2; the lifetime record in R3). Hallkeepers and prices (facts and photos only; finance prices — §6 decision 6b). Full sheet versus delta (complete sheet plus a delta strip). Escalation ladders (per-button, configurable, safety officer's defaults for "now"; R1 = venue admin from a settings row). Turnaround (fixed buffers now, computed flip clock in R4). Supplier role (no-login pass in R2, authenticated role in R5). Pins in the room (R5). Guest self-declaration of dietaries (organiser-entered counts first; guest links after the special-category data model exists). Heritage layer (hidden by default for clients; placement warnings always shown with the alternative). Public holds (availability view and enquiry-on-a-date first; self-service holds later). Confirmation dialogs (undo replaces confirmation except for irreversible life-safety and money actions). Notification cadence (inside-48-hour changes instant; everything else digests). SLA numbers (stricter of the ops roles for "now"; median for the rest; all per venue).

---

## 9. Risks, and the kill order

**What makes Friday slip**
1. The merge funnel: thirteen lanes into one integration branch with CI red until Wednesday morning and a single API replica. Mitigation: the captain merges and gates only, three merge windows into `release/r1`, feature freeze Thursday 14:00, no Tier B after a lane's Tier A is not green, one master merge on Friday.
2. Collisions with active Codex lanes: T-601 (release owner), T-605 (Goal 12, migration 0071), T-613 (`codex/browser-release-20260915`, the e2e specs), `codex/release-dependency-security-20260915`, `codex/venue-operating-system-release`. Mitigation: §4.0 ownership, the captain's handback recorded in `goals/EXECUTION.md`, no lane edits specs, migration tags allocated serially.
3. Devices: without lent devices the mobile numbers stay unmeasured; the release ships the correct phone path and says "unmeasured on device", never "60 fps".
4. Production data changes, in this order only, each after a fresh Neon backup branch and through the guarded helper or the audited command: Thursday after go, the seed purge (decision 10); Friday 13:00 in the migrate step, 0072, 0073 (the `asset_definitions` reconcile, because the live planner reads those rows until the web deploy) and 0074; Friday 16:30, the stock import (decision 14, additive).
5. The public repository: nothing from `codex/inventory-selected-style` or d044dec6 is pushed; the retained `.docx` and jpeg stay off origin; decision 16 governs even the normalised JSON.
6. The register decision (§6 item 1) blocks Lane 1; the roles decision (item 6) blocks Lanes 8 and 10's 0072; both need an answer by Tuesday 12:00.
7. Monday evening was spent on this plan rather than on Lane 0; Tuesday carries the foundation work as well as the lane starts, and Tier A sits at the edge of the capacity model, which is why the checkpoints below exist.

**Checkpoints and the kill order.** Checkpoint 1 is Tuesday 18:00 (is `release/r1` cut with T-613 integrated?); checkpoint 2 is Wednesday 18:00 (is every Tier A lane green in its worktree?). If behind at either, cut in this order, Tier A first: (1) the twin-cad merge → R2 (ship the 11 July bundle on the current viewer); (2) Lane 9 → staff-created requests only, escalation email dropped; (3) Lane 2's canonical-home merge → `/fresh` promoted to `/` (3 h); (4) Lane 6's token pass → walkthrough removal, corridor, times and live sync only; (5) Lane 7's analytics truthfulness → hide the wrong numbers (2 h); (6) Lane 3's touch locomotion → tap-to-glide only; (7) Lane 4's T-581 rebase → DPR cap and touch drag only, the ladder to R2; (8) Lane 11 entirely → R2; (9) Lane 9 entirely → R2, Day Board unchanged. Never cut: Lane 0 items 1–5 and the ops session, Lane 1, Lane 2-reduced (staff nav, Enquire and its slug guard, pricing off, `/demo` gated, the landing cull, dead anchors, images, SEO/PWA), Lane 10's seed purge and 0072, §2 lines 1–5 and 7 once decisions 2–4 are yes, and the CI/branch-protection/deploy-web half of line 28.

---

## 10. Appendices

- A. Understand map: `D:\claude\ship-friday-plan\understand-map.json` (16 areas: surfaces with state, defects with file:line evidence, placeholder ledger, mobile readiness, tests, Friday list with hours, later list, open questions) and the readable digest `understand-digest.md`. The readers' completeness critic did not run (session limit); the plan-level critique replaced it.
- B. Veteran panel: `veteran-panel-full.json` (21 roles) and `veteran-synthesis.json`.
- C. Live observations: `live-observations-2026-09-14.md`.
- D. The critique: `critique-full.json` (six critics and the synthesis editor; 20 blockers, 53 majors, 32 changes, all applied above) and `critique-digest.md`.
- E. Branch dispositions: cherry-pick 997d980b; rebase 6dad07fe as Lane 4's window-1 PR; merge `worktree-twin-cad` in Lane 3 with the re-forge; assess `codex/capture-failure-recovery-20260907` (6) and `codex/trades-hall-demo-release` (4) with `git cherry` before Wednesday or drop them; delete the 33 fully-absorbed branches and prune the four `prunable` worktrees; cherry-pick the docs/reports left only on local branches (t596, furniture-live-performance, table-chair-orientation, activity-global-live) so master carries their provenance; `codex/inventory-selected-style` is backed up privately, never pushed.
- F. The plan worktree: `D:\claude\ship-friday-plan\repo` on branch `claude/ship-friday-plan-2026-09-14`, rebased onto `origin/master` 641f2667.
- G. Task rows: T-610 is this plan's own row; the highest row on master is T-609, and T-612/T-613 are claimed on Codex branches (Goals 16 and 17). The captain reserves provisional rows T-614 … T-626, one per lane, in one commit on the foundation PR after reading `docs/state/tasks.md` on the cut sha; each points at this document's lane section; the captain's own row owns the §2 gate.
- H. Out of R1 scope and exempt from the register: `tools/*` (7 manifests, still typechecked and linted by `pnpm -r`), the admin consoles `/dev/trades-hall-visual`, `/dev/assets/rooms`, `/dev/capture-intake`, `/captures`, and the foundry, capture-intake and derivative-rights API routes; Lane 8's fan-out keeps their platform-admin gates unchanged. The Trades House campaign pages keep their own brand register.
