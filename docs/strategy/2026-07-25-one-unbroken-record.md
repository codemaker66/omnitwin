---
title: One Unbroken Record — a product vision for Venviewer
date: 2026-07-25
status: proposed
authority: subordinate to the Diary Research Canon and CLAUDE.md; see docs/strategy/authority-map.md
---

<!--
PROVENANCE. Produced 2026-07-25 by a sixteen-agent workflow, deliberately
structured so that a beautiful generic answer could not survive it:

  * six independent lenses, none able to see the others' work — the operator's
    day, the client's journey, the technical frontier, the craft, the moat and
    market, and a hostile red team;
  * each lens then handed to an adversarial critic instructed to KILL any move a
    competitor could ship next quarter, any move that photographs well and helps
    nobody, and anything violating claim-safety or captured-truth — on the
    assumption that roughly a third of any such list is padding;
  * three competing syntheses from the surviving material (product-first,
    moat-first, craft-first);
  * one judge that chose a spine rather than averaging, grafted the best of the
    runners-up, and was required to add the closing section on cost and risk.

Every lens was required to cite repo paths for its claims. The Verification
notes at the foot of this document separate what was checked in the working tree
that day from what was taken on report — read that section before spending money
on any figure here.

A designed reading copy of this document was published as an artifact on the same
day. This file is the source of truth.
-->

# One Unbroken Record

**A product vision for Venviewer**
*Drafted 25 July 2026. Every claim below was checked against the working tree that day; the verification notes at the end say exactly what was checked and what was taken on report.*

---

## North star

**Say it once. The building remembers it — and can always tell you where it heard it.**

Two clauses, and the second is what makes the first worth anything. Plenty of software remembers. Very little of it can be interrogated about what it remembers, and none of the software in this category can.

---

## Where we actually are

Venviewer has built nearly every organ of the work and has not yet built the body.

Six independent reads of this repository — the operator's day, the client's journey, the technical frontier, the craft, the market, and a hostile audit — arrived at the same finding from six directions, and none of them was allowed to see the others. The finding is that **the things that know each other are not connected**, and that every significant failure is a missing join rather than a missing capability.

The Diary holds the real room-scoped load-in, setup, live, flip and teardown times. The hallkeeper sheet ignores them: `packages/api/src/services/hallkeeper-sheet-v2-data.ts` derives an 18:00 start minus a ninety-minute buffer from an enquiry's preferred date (`DEFAULT_EVENT_START_HOUR = 18`, `SETUP_BUFFER_MINUTES = 90`), and the whole file contains zero references to `bookings` or `eventPhases`. Read its own comment and it is worse than it first looks: without an enquiry the sheet honestly shows nothing, so the invented number appears precisely when a real footprint is most likely to exist.

The homepage answers "will 180 fit?" from the venue's published figures — beautifully, claim-guarded, drawn to count — and then hands the enquiry to a mail client. `packages/web/src/pages/fresh/FreshPage.tsx:406` is a bare `<a className="fr-cta" href={composed.mailtoHref}>`, and there is no `fetch` and no `API_URL` anywhere in `packages/web/src/pages/fresh/`. Meanwhile `packages/api/src/routes/public-enquiries.ts:48` already writes the enquiry, its history, a `guest_leads` row and a hallkeeper notification, and is already called by two other surfaces.

Eight slices of booking engine — an exclusion constraint, a conflict engine, hold hygiene, a live channel, command envelopes with exactly-once semantics — sit behind a URL that must be typed from memory. `grep 'to="/diary"'` across the web package returns nothing. `DashboardLayout.tsx` mentions the Diary zero times. `DiaryBoardPage.tsx` contains zero `Link` and zero `useNavigate`.

The Twin knows 149 real scan positions across two floors, and every one of them carries `roomSlug: null`. Not one carries the exposure solve its own schema documents. A Diary booking for the Grand Hall cannot open the Grand Hall.

And the chain-of-custody architecture is finished, while `state/asset_versions.json` is twenty-nine bytes — `{"version": 1, "assets": []}` — and `state/training_runs.jsonl` is zero. Eight `.sog` files, sixty megabytes of XGRIDS-derived Reception Room, are tracked in git under `packages/web/public/splats/reception/` and streamed to every visitor to the live homepage, having passed through none of the apparatus built to gate exactly that.

Every one of those is the same defect: a fact that exists, unreachable by the surface that needs it, so a person retypes what the database already knows.

### Why the joins are the strategy and not the housekeeping

Three things that looked like differentiators eighteen months ago are now commodity. Cvent Event Diagramming sells at around $150 a month with a free tier, 6,700 floor plans and embedded Matterport walkthroughs. Freeman launched Gaussian-splat capture across twenty US convention centres in March. Roughly one UK venue in six already publishes live availability. Photoreal capture is not the moat, drag-and-drop layout is not the moat, and a calendar is not the moat. A competitor with ten engineers ships all three in a quarter, and Spalba effectively has, with published conversion numbers to wave at hotel groups.

Two things in this repository have no equivalent in the category, and both of them are joins rather than features.

The first is **commitment as a database guarantee, coupled to reviewed geometry.** `bookings_ink_no_overlap` in `packages/api/drizzle/0050_diary_bookings.sql` makes two confirmed bookings in one room physically impossible in Postgres — not a rule the application hopes for, an invariant the database enforces. And `packages/api/src/routes/room-layout-timeline.ts` joins a booking's phases through frozen layout snapshots to real captured geometry, so you can see what the room will actually look like at four o'clock on a scheduled Saturday. That is one object where Cvent has two products mid-sunset-migration, Freeman has capture with no book, and Tripleseat has a book with no geometry.

The second is **rights and provenance as code that gates what the software is permitted to do** — custody registration, registry attestation, revocation, an execution-admission barrier that has already refused a training purpose against a Matterport-derived asset, Ed25519 DSSE verification, and a claim lexicon enforced in CI across source, email templates and the PDF generator. A machine-checkable refusal to over-claim, in a category whose newest entrant advertises "measurement-grade accuracy". Nobody else bothered, because bothering only pays if you intend to still be trusted in five years.

Both are currently worth approximately nothing, and that is the part that matters. `bookings.eventId` is nullable (`schema.ts:3189`) and nothing in the codebase ever fills it — `routes/bookings.ts:289` hardcodes `eventId: null` — while `event_phases.eventId` is `notNull` (`schema.ts:1224`). A booking born in the Diary, which is all of them, is structurally incapable of having a layout, a day sheet, a handoff pack or an Occupancy Footprint. The rights apparatus inspects an exposure path the live asset does not take. And zero events have ever been operated through the product end to end, so the one moat a competitor genuinely cannot buy — this building's own accumulated record of what actually happens on a Saturday — has not begun accruing.

This is also why one venue is the wedge and not the ceiling. A spine can only be drawn against a real building with a real operator and a real Saturday. Platforms built for a thousand venues make every join optional, because that is what "configurable" means, and an optional join is not a join. The reason nobody in this category has an unbroken thread is not that the code is hard; it is that you cannot design one from an average. Trades Hall is the only place the thread can be found. Once found, it generalises — and the route to venue ten is a proven day, not a tenancy layer.

### And the craft argument is the same argument

An operator does not experience the exclusion constraint. They experience not retyping a client's name for the fourth time this morning. A couple does not experience a DSSE envelope. They experience the room being visibly the room. The interface disappears when the software plainly knows its own building, and it is precisely the joins that make it look like it does. This is the rare situation where the highest-craft work available is also the cheapest.

### Two honest caveats, because a vision's first job is to be true

No real event has ever been carried through this product from enquiry to the morning after. Several confident sentences in the strategy documents are therefore assertions rather than findings.

And the shipping branch's CI is red. The last twelve runs on `master` are failure, cancelled or startup failure — three of them on 25 July alone. `ci.yml:145` runs `pnpm -r test`, which bails on an upstream Foundry package, so the API's 156 test files — tenancy, auth, the exactly-once command ledger, the overlap constraint — have never executed on the platform the API deploys to. Until that changes, the product cannot prove a claim about itself, and the first section of the sequence below is about fixing that rather than adding to it.

---

## The two doctrines are the product, not the tax

Claim-safety and captured-truth are usually described here as constraints. They are the mechanism.

A sheet that confidently prints 18:00 when nobody set 18:00 is strictly worse than a sheet that says "no footprint set for this room" and offers the button that sets it. The first is a lie you discover at six in the morning; the second is a task. If the building is going to remember on the operator's behalf, the remembering has to be auditable — which is exactly what the two doctrines already provide. They are the difference between a convenience and something you would bet a Saturday on.

They need one amendment, and it makes them stricter rather than looser: the vocabulary must distinguish "we have not checked this yet" from "nothing in this product will ever check this." A careful `not_checked` chip currently reads to a buyer as a careful feature. Enforce the distinction with a check that fails when a shipped witness has no code path capable of returning a computed value.

---

## The pillars

### One Thread

*From the Saturday on the board I can reach everything about it — the layout, the client, the proposal, the pack, the sheet — and nothing downstream ever asks me to type what the board already knows.*

Four moves, one of which gates the other three.

**The bind.** Inking a booking must create or attach an event and space-scope its phases. One migration, one transition hook. This was diagnosed elsewhere as a navigation problem; it is a missing edge, and everything else in this pillar and half of Tonight's Hall depends on it, so it goes first and alone.

**The door.** `/diary` exists and is role-gated in `router.tsx`, and nothing in the product links to it. A nav entry in `DashboardLayout.tsx` beside the existing `/event-architect` link, and the Board as the post-sign-in landing for admin, staff and hallkeeper. Ten lines, priced as ten lines.

**One clock.** Two separate things wearing one name. First, a correctness fix that must not wait behind anything: the same setup time is formatted three ways across the two artefacts of one event, and not one of the three formatters is pinned to the venue's timezone — `hallkeeper-pdf-v2.ts:489` takes `en-GB` with no `timeZone` (Railway's process zone), `HallkeeperPage.tsx:976` and `:1194` take the browser's. For the whole wedding season the screen and the paper disagree by an hour. One venue-timezone formatter in `@omnitwin/types` — which both packages already depend on, which is exactly why they drifted — with tests straddling the March and October transitions. Second, after the bind: `resolveTiming` is deleted and the sheet reads the room-scoped footprint. Where none exists the sheet says so and offers the action that sets it, because a blank chip is operationally worse than the fiction it replaced.

**The spine.** The booking drawer gets one primary action, and then five slots — layout, client, proposal, pack, sheet — that appear only once there is an event to hang them on. Ship the bind before the spine, or the drawer renders five honest blanks for every booking the Diary has ever created, which is all of them.

*It proves itself when:* a coordinator opens Saturday's inked wedding on the Board, clicks through to its layout, sets load-in for 08:30 — and the next morning the printed sheet reads 08:30, in Glasgow time, identical on the screen and on the paper. Nobody typed it twice and nobody phoned to correct it.

### Tonight's Hall

*I open the product and it tells me what is happening today, in which rooms, and what needs deciding — before I have typed anything or been sent a link.*

**A date-first door.** Every operational surface is keyed on an id today — `/hallkeeper/:configId`, `/ops/events/:eventId`, `/ops/handoff/:packId` — and the only "today" anywhere in the API is a mislabelled `todayTasks` in `routes/crm.ts` that is not filtered to today. So the six-o'clock path into the product is somebody having texted a link the night before. `GET /calendar` already returns rooms, bookings of every kind, room-scoped phases with SQL-derived end instants, and the conflict report, for an arbitrary range. This is a route over an endpoint that already works: the cheapest item on this list carrying the highest stakes.

**The holds get chased.** `services/hold-reminders.ts`, `scripts/run-hold-reminders.ts` and an admin endpoint all exist — idempotent, freshness-windowed, dress-rehearsed. The only `schedule:` in `.github/workflows/` is `cleanup.yml`. The reminder ladder the Diary canon calls the commercial wedge has never fired in production. Order matters: confirm `RESEND_API_KEY` in the Railway environment **first**, because without it the pass records dev-mode rows, and a cron wired ahead of the key exits zero every morning and sends silence — strictly worse than no cron, because it retires the worry.

**One list of what is owed.** `bookings.nextActionDueAt` is stored, indexed, and read by nothing but a calendar passthrough, so the rule that nothing exists without a next action, an owner and a date is enforced at creation and never surfaced. A read-model union over it plus the opportunity's next action, the follow-up tasks and the ops tasks. No fourth table — the canon forbids a third, the Diary accidentally created one, and the fix is to read it.

*It proves itself when:* seven in the morning, on a phone, one tap. Three rooms in play today, the Grand Hall's load-in at 08:30, two holds whose decision day is today, one flag saying Saturday's layout has never been reviewed. No id typed, no link texted the night before — and the two holds got their own email at T-7 without anyone remembering.

### The Answer at Midnight

*At eleven at night I can find out whether my date is on their book, see my 180 in the actual room, and send something that visibly arrives — then forward all of it to my partner and have it open the same way on her phone.*

**One real send.** The highest-intent action on the site hands a pre-written email to a mail client the visitor may not have configured. No lead lands, no hallkeeper is notified, nobody gets a receipt. `POST /public/enquiries` is real, tested, and already called by the Twin's modal. And the downstream is also already built: the Board's holding tray consumes open enquiries, and `POST /bookings/from-enquiry` pencils a hygienic hold. So this is not "a lead reaches a CRM" — it is a card appearing on the board, one click from a hold, on a board with a database guarantee behind it. Add the acknowledgement the client never gets today (a 201 and silence), as a new template in the existing house style. And fix the `guest_leads` dedupe, which keys on email at `public-enquiries.ts:177` — the canon forbids exactly that, because most lead platforms mask or relay the address, and homepage volume is what makes it live.

**The answer we can actually prove.** Not the word "available." The book models no closures, no opening hours, and none of the Trades House's own use of its halls, and the exclusion constraint guarantees non-overlap for ink only. So per room, per date, two states: "we have a confirmed event in the Grand Hall that day," or "nothing confirmed on our book for that date; two rooms are pencilled — a coordinator confirms." Then the composer, pre-filled with that date, gated by the public-venue opt-in and rate limit `public-enquiries.ts` already uses. Availability alone is not the differentiator, since one venue in six offers it. Fit, plus provable book-state, plus the room itself, in one thirty-second answer, is.

**One URL that carries the visit.** `/plan/:code` already resolves guest shortcodes; `POST /public/configurations` already mints one anonymously and already accepts a PNG thumbnail. The homepage simply never mints one, so the occasion, the guest count and the moved table live in React state and one browser's localStorage — and every couple, committee and charity board has a second person to convince. Mint on the first meaningful action, and serve the layout image as that route's social card. The card is the one genuinely new build, because `packages/web/vercel.json` rewrites every path to a single `index.html`, so a shared proposal, a room dossier and a client's own layout all currently preview as the same exterior photograph. Names, dates and guest counts stay out of the shortcode payload: a link anyone can enumerate must not be a lead register.

**Walk the house.** The eight-room Twin — walk, dollhouse, minimap, and its own real-lead enquiry modal — is built, tested and route-mounted, waiting on an R2 bucket and one environment variable (`packages/web/public/twin/` is gitignored at `.gitignore:50`, so production shows a patient "preparing" line). That has been the open item since 2 July. It is an afternoon of the owner's time, not an engineering project, and it is the highest value-per-effort item anywhere in this document.

*It proves itself when:* a couple picks "wedding, 180, 12 September 2027" at eleven at night, learns nothing is confirmed on the book that day, steps into the Reception Room, moves a table, sends the enquiry, and has a receipt in the inbox within the hour. They forward one link. It opens on her mother's phone showing the same room, the same 180, the same moved table — and the preview image is that layout, not the building's roofline.

### One Building, Not Six Lanes

*The building's own facts live in the product instead of in my head, and the rooms know about each other.*

Six rooms that share one Georgian building are modelled as six unrelated ones. The `spaces` table carries width, length, height, outline and sort order, and nothing else — no parent, no combinability, no adjacency (`grep parentSpaceId` returns zero). So a whole-building buyout cannot be inked as one thing, the galleries cannot be attached to the hall they serve, and a band in the Grand Hall at ten o'clock raises no flag against a board dinner in the Saloon. That hierarchy is revenue, not hygiene.

**One room identity across the three surfaces.** All 149 twin nodes carry `roomSlug: null`. Nodes 0–48 are floor 0 at tripod height 1.46–1.54m — the exact cluster T-507 already human-confirmed as the Grand Hall, with 049 excluded as adjacent space, recorded as a digest-bound decision. Those 49 are a metadata write against a decision a human already made, not a geometry programme; the other hundred are a person clicking room polygons under the envelope-review gate that already ships. Keep it uncoupled from the photometric exposure solve, which is a different problem — all 149 nodes also carry no exposure, so the walkthrough's node-to-node continuity is whatever the camera's auto-exposure happened to do.

**The House Book.** The venue row carries name, slug, address, brand colour, timezone and billing state, and nothing about keys, alarm zones, keyholder and ARC, heating lead time, service entrance, goods lift, curfew or listed-building restrictions. Those facts live as per-configuration free text, retyped for every event and silently absent whenever someone is in a hurry. T-260's Venue Data Request Pack already specifies the field list with source type and staleness policy — implement it as real columns carrying both, and render each on the day sheet as either the recorded fact or an explicit "not recorded," never as a blank.

**Two conflict types, as attributed overrides rather than blocks.** The engine implements three, and the loudest of them is the one the database already makes impossible. Guest count against the layout's capacity, and whether the layout was ever reviewed, are both computable today from review gates and capacity intelligence. Ink stays possible always — but inking without a reviewed layout covering the headcount records who overrode it, when, and what was unknown, and that override appears on the ink chip, in the day sheet's title block, and on the room's record. A hard block gets routed around within a week by a coordinator with a client on the phone, and it would put the software in the position of determining whether a room fits a headcount, which is precisely what we refuse to do.

**The smallest one.** `spaces.heightM` carries the real numbers — 7, 5.4, 3.2, 2.18 — and no cockpit lens reads any of them. The rigging lens should decline to offer truss in the Robert Adam Room, stating the 2.18 metres and where that figure came from, rather than letting a plan be drawn that cannot be built.

*It proves itself when:* a whole-building buyout inks as one commitment and six lanes go quiet together; a band in the Grand Hall at 22:00 raises an adjacency flag against the Saloon dinner; and the rigging lens refuses, citing 2.18 metres and the survey it came from.

### Nothing Ships Unowned

*I can hand anyone a one-page account of where every picture and every number on my site came from, who owns it, and what I am allowed to do with it — and the build refuses to ship a byte that isn't on that page.*

**Point the gate at the tree that actually ships.** Eight `.sog` files, sixty megabytes of XGRIDS-derived Reception Room, are tracked in git and streamed from the live homepage with no registered runtime package, no signed transform, no approved QA record and no rights row — while the licence matrix marks that format "reject default / blocked" and the ledger lists the XGRIDS export terms as unresolved. Every gate designed so far inspects the API exposure endpoint, which is not the path the live asset takes. So: one CI check enumerating every asset byte under `git ls-files packages/web/public/`, refusing the build unless each names a rights row and a registered package. It fails on the day it lands. That is the point of it — a gate keyed on the registry instead would certify the empty set.

**The ledger stops being empty.** Write the three real rows: the Reception LCC2 export, whose device serial, firmware and algorithm version are already recorded in `state/capture_log.json`; the Matterport E57 twin source; and the 4.4-million-Gaussian Brush splat — each marked `lineage: inferred`, `rights: pending_review`, pointing at the report that reconstructed it. Inferred but recorded is strictly more honest than twenty-nine bytes. And `training_runs.jsonl` stays at zero, with a one-line note saying why: no RunPod training has ever run, and a row there would be exactly the false claim this apparatus exists to prevent. That refusal is the smallest and most load-bearing item in this document.

**The Warrant.** `RoomAssetStatusSchema` already carries forty-five per-room evidence fields and `TradesHallAssetStatusPage` already renders them. Not one is a rights field. Six columns per capture on that same read model — who owns the source, which vendor terms govern it, which of publish, plan, train and redistribute are permitted, which permission is on file versus outstanding, when the review expires — plus a readable export for the venue. Nobody else in this category has been asked for that, because no competitor could answer.

**The guard reaches runtime.** The claim lexicon is a build-time scan over source paths, and it is genuinely good — it covers the email templates and the PDF generator. The only runtime guard is on proposal version payloads. Four paths let a coordinator's own words reach a third party unguarded: public enquiry replies, share-token proposal text, day-sheet notes that flow into the PDF, and supplier-portal free text. Guard those at write time, offering a suggested rewrite rather than a refusal.

**One owned Grand Hall runtime, by the one chain the matrix leaves open.** Operator-owned stills including the dome, through COLMAP, through gsplat on RunPod, to SPZ or SOG, with the run appended to the ledger as it happens and the evidence bundle written beside it. Done is not "a splat exists": delete the working directory, rebuild from the recorded config, input digests and git state alone, and get the same splat count and the same eval numbers. Say plainly that three hundred rectified faces with known poses proved the pipeline, not the capture, and that handheld stills under a seven-metre gilt dome fail there first. Budget a re-shoot.

**And one afternoon of measurement, because no appearance claim can currently be settled.** Two legitimate blind quality metrics were run on the Reception candidates and disagreed in thirteen of fifteen comparisons, surviving brightness matching. One surveyed tripod pose, occupied three times in a single visit — a camera frame with grey card, colour chart and recorded exposure, then both frozen candidates rendered from the same pose through the existing capture adapter so the pixels carry their asset digests. It needs no retraining and no cross-lineage registration, which is why it is the one part of that chain that is not blocked. It must carry a scene-state witness and refuse to report a number at all if the room has moved since the June capture.

*It proves itself when:* the build refuses with the eight committed splat files unregistered, and passes once the rows exist; the Grand Hall rebuilds from records alone to the same numbers; and an operator taps the setup time on a day sheet and reads "set by you, Tuesday 14:02, from the Grand Hall's footprint," taps the capacity and reads "the venue's published figure, 2026 rate card," taps the room and reads "captured 1 June 2026, XGRIDS PortalCam — rights review outstanding." Three taps, three honest answers, one of them uncomfortable. Nothing shrugs and nothing bluffs.

### The First Real Saturday

*The turnaround it quotes me came from my own last three Saturdays — and it tells me it only has three.*

This is the only pillar that compounds, and it cannot start until one real event has been carried through the product end to end. So the first move is a calendar item, not a build: take the next real Trades Hall Saturday through enquiry, hold, ink, layout, sheet, pack and the morning after, and write down every place it broke. That single event settles cheaply, by observation, what four separate reviews currently answer by assertion — whether the three layout presets ignore what actually decides a room, whether setup error costs real money, whether anyone wants to co-plan live with a client, whether acoustics is the property clients ask about most. It is the highest-information move available and it is on nobody's list.

**Close the loop that already collects.** `event_mission_phases` and `event_mission_tasks` already record `actual_started_at` and `actual_ended_at`; issues are already anchored to zones; the Event Day Ops board already shows planned beside actual. Nothing reads any of it. Add the close-out moment — phases planned beside recorded, one number to type (the actual head count, a triple no table currently holds), one line per issue — and ship the reader in the same slice, because a writer without a reader is a second collection surface nobody opens.

**Cite, do not average.** With one venue, n per room and event type will be two to four across a whole season. "Median 52 minutes over eight events" would be a synthesised statistic wearing evidence clothing, and it is exactly the kind of number that hardens into a quoted promise. So show the recorded flips themselves — date, crew size, measured duration — with the count stated first, and withhold a typical figure until a stated minimum. Three real Saturdays a coordinator recognises beat an average of three she cannot interrogate.

**Measure what the client feels.** Nothing anywhere counts the hours between an enquiry landing and the first human reply, and no lost reason is captured on any opportunity. The research that says 81% of couples are frustrated by venue response times is a measurement of the venue's own speed, and the product currently has no instrument for it. Those two numbers are the only honest way to know whether any of the work above changed anything.

*It proves itself when:* a coordinator quoting a two-event Saturday reads "Grand Hall banquet to cabaret: 3 flips recorded — 88, 95, 110 minutes," each clickable through to its date and crew, under the line "too few for a typical figure." She quotes from the three she recognises, and the estimate is hers rather than the software's guess.

### One Register

*It feels like one thing made by one hand, and I can read it at six in the morning and in daylight.*

The taste is already written down with unusual rigour and it reached about five percent of the product. `var(--house-*)` appears in ten files; the three motion tokens are consumed exactly once. A correct spring integrator — semi-implicit Euler, dt-subdivided, allocation-free, unit-tested — sits in `lib/springs.ts` with eight consumers, every one of them in the Twin or the landing page, and none anywhere the operator's hands are. And `framer-motion` and `@react-spring/web` are both in `package.json` with zero import sites.

So: delete the two unused dependencies this week, then convert the four interactions the operator touches hundreds of times a day — lens-rail selection, lens-panel enter, evidence-chip state change, dock collapse — onto the spring that already works. Three tiers and one integrator reads as designed; twenty-five durations and two paid-for unused libraries read as accreted.

Type is a redirect, not a font project. `index.html` already render-blocks the four faces the design language nominates, and the operator stylesheet is injected only on routes wrapped in `cockpitImport()` — which the Diary and Event Architect are not. A cold landing on `/diary` from a home-screen shortcut renders in whatever the operating system supplies; arriving after visiting `/plan` renders in Inter. The operator's typeface currently depends on their navigation history. Point three tokens at what is already downloaded and delete the injection.

Then four small things of the same shape. Honest waiting: extract the one place that gets it right — the room materialising *is* the progress indicator — into a primitive with three states, counted, progressive, and silent-but-static, and delete the nine rotating spinners elsewhere. Errors as sentences: one `errorCopy(code)` module at the api-client boundary, keyed on the typed codes that already exist, since ten sites render `err.message` straight to the DOM and two of them are client-facing. Room at the edges: one keystroke that overlays the rail and the panel above the stage instead of beside it, taking a 1366×768 laptop from about a third of the screen to nearly all of it, with no grid rewrite. And the paper register on the one artefact a client reads before spending five figures, which currently renders on cool graphite and reaches for a serif whose only loader is an unrelated quiz page's stylesheet.

The floor under all of it is the honest part: the accessibility harness audits eleven routes and passes 24/24 — and `/diary`, `/plan` and `/hallkeeper` are not among them. Add them, let them fail, fix what fails. Then the Diary board's double-dimmed 9.6px text is an accessibility fact rather than a matter of opinion.

*It proves itself when:* `/diary` opens cold from a home-screen shortcut in the right typeface, readable at arm's length in daylight, passing the audit in CI; a deliberate save failure says what could not be saved, what was preserved, and what to do, with no code in it; and one keystroke fills the screen with the Reception Room.

---

## The sequence

### Horizon zero — days, before any pillar

The product cannot currently prove a claim about itself, so nothing else is worth claiming yet.

Split CI's Test job per package, so `test-api` and `test-web` become independently greenable this week and `test-foundry` stays honestly labelled as red. Adding `--no-bail` alone makes master redder, not truer — the Foundry's Linux failures are POSIX ownership and file-mode assertions in production code that no Windows session has ever executed, which is unexercised security-invariant code and not a chmod. Then: confirm `RESEND_API_KEY`; repoint the frame-budget harness at the real homepage — which now ships 2,002,122 Gaussians to every visitor including phones and has never once been measured — flip its fail flag to default true and put it in CI; publish the Twin to R2 and set the environment variable; land the tracked-tree rights gate and let it fail red; add the three missing routes to the accessibility harness and let them fail. Also here: the known-vulnerable direct dependencies the audit job has been flagging while the task ledger claims zero, because one falsified row makes a reviewer distrust the other 526.

### Weeks one to four — three independent things, ordered by cost

The clock formatter ships immediately, as a correctness fix: the screen and the paper disagree by an hour right now and that must not queue behind footprint work. The nav entry and the landing route ship the same day. The real send ships in the same window, because it is a wire to an endpoint that already works and a tray that already consumes what it produces. Delete the two motion libraries and redirect the type tokens while you are in the file. Then the bind — one migration, one transition hook on ink — which gates the rest of One Thread and the sheet half of Tonight's Hall.

### Weeks four to ten

Tonight's Hall over the calendar endpoint that already answers. The hold cron, once the key is confirmed and not before. The owed list as a read model over three existing sources. The provable book-state answer and the shared URL. `roomSlug` on the 49 already-decided nodes. The three ledger rows. One Register's small conversions. Cheap, loud when they fail, and an empty `asset_versions.json` behind a finished chain-of-custody architecture is the first thing a reviewer greps for.

### Quarter two

One operated Saturday, carried end to end, with every break written down — everything in The First Real Saturday is gated on it. The Warrant's rights columns on the read model that already renders. The runtime copy guard on the four unguarded paths. The two conflict types as attributed overrides. The close-out writer and the flip-history reader in one slice. Room hierarchy and adjacency. The House Book. The owned Grand Hall runtime, reproducible from records after the working directory is deleted, with a re-shoot budgeted. The remaining hundred twin nodes, then the exposure solve — uncoupled, in that order, because the join key must not wait on a photometric solve.

### Honestly research, or honestly blocked

An acoustics model for the dome needs calibrated field measurement, negotiated venue access, and a mapping from RT60 to "will a speech carry for 180" that is itself open research — and its output is precisely the figure that reads as a determination however carefully it is hedged. The ten-line half that is real ships inside another lane.

Registering the two capture lineages to each other needs a reviewed transform artifact; the only current bridge documents its own SfM leakage and calls itself a proposed diagnostic. Until it exists, splat appearance and mesh geometry cannot compose in one scene with honest authority, and no amount of scheduling changes that.

Retraining the Grand Hall from raw XGRIDS is **blocked, not deferred**: the frames sit inside a proprietary container, the calibration files are password-encrypted, control points are empty. The answer is an owned capture, not a decoder.

A layout solver gets step zero only — run the three presets that already ship on one real booking with the operator watching, and record which missing predicate he actually reaches for. Build that one. Building a search for a surface nobody has used optimises a void.

A measured two-state relighting basis is one afternoon at one pose and then a research problem. On-site AR has no code substrate at all: no WebXR reference, no camera path, no capability spike.

None of these are next quarter, and pretending otherwise would be this document's first broken promise.

### Three dependencies that are not engineering and should not be dressed as it

The Twin needs an R2 bucket and one environment variable — an owner action open since 2 July, and the highest value per effort in the entire dossier. The 17 July questionnaire is eighty-eight lines of still-unanswered questions, including the two preferred caterers the product cannot name and the hold duration the Diary already enforces; it is a twenty-minute call that unblocks the House Book, the named supplier brief and the honest utilisation denominator. And a hold cannot speak to a client until a booking has a client: `bookings` carries a staff owner, a nullable event and a nullable enquiry, and no contact of its own, so a hold created in the drawer — the normal path — has nobody reachable. Add the link, and surface a hold with no reachable client in the needs-attention tray rather than failing silently.

### Venue two, sequenced last on purpose

Its gate is a diff, not a feeling: the pull request that onboards venue two contains zero `.tsx` files. The revenue-facing frontend computes room fit from a hard-coded truth module that eight files import; extract it into a per-venue row, keep the claim guard scanning the templates while the values come from the database. Then instrument that one onboarding for the four numbers the red team asked for a fortnight ago and nobody has measured — operator hours per room, GPU pounds per room, capture-to-live days, lines of code changed — and publish them internally even when they are embarrassing. You cannot productise a day you have never run, and you cannot price a service you have never timed.

---

## What we refuse

**Any determination about egress, occupancy, fire or licensing.** Absolute, and it includes the soft versions: no "looks fine" chip near a curfew field, no capacity badge, and no auto-approving a day sheet because no blocking conflicts remain. That last one is the sly one — automating the human acknowledgement would quietly delete the person from the safety chain while looking like a convenience. Where nothing has been checked, `not_checked` stays the correct answer.

**AI that answers enquiries on its own.** The inbox is the pain, which is exactly what makes this tempting. But the research names coordinator turnover and radio silence as the client's first complaint, and the fix it specifies is a named human within twenty-four hours, not a faster robot. A canned-sounding reply to a couple spending five figures makes the silence worse, and one promotional sentence reclassifies the whole message under consent law. Draft assistance for a person to send, yes. Autonomous sending, never. Likewise no fake scarcity: the entire product is a trust argument, and one dark pattern costs more credibility than it converts.

**The word "available."** Our book proves the absence of a confirmed ink and nothing else. Publishing "open" would be a false OK — the one thing captured-truth forbids — and we would find out on the Saturday somebody drove to Glasgow.

**Counter-marketing on accuracy.** A competitor is shipping splats across twenty convention centres under a measurement-grade banner. We will not match that claim, and we will not name theirs in our copy either, because an assertion about the safety of somebody else's determination is still a safety claim, made about a building we have never stood in.

**Generative staging and neural restyling.** With no reference photograph from a known pose we cannot prove a generated still preserved the room's geometry. Everyone will have image models within a year; the differentiation was never the generation, it was the cage. The cage has to exist first, and the measurement before the cage.

**A public trust page publishing our own accuracy.** Today it renders an empty table, and it is a permanent adversarial surface: the first month a flip estimate is forty percent out, a competitor screenshots it. That page is earned after two years of accurate numbers, not launched to demonstrate that we would have earned them.

**A row in `training_runs.jsonl`.** The gap audit asks for one and it would be a lie.

**Reverse-engineering the capture container or the encrypted calibration files.** The frames and the extrinsics are right there, which is exactly what makes it tempting. It is forbidden by our own licence matrix and it would poison the acquisition story more thoroughly than any missing feature. Owned capture is cheaper.

**Multiplayer, CRDTs, presence cursors, soft locks.** One venue, one operator; the hallkeeper has their own cache-first sheet and the ops lead their own handoff route. The second concurrent user does not exist. What does exist is that two tabs today destroy work: a save conflict discards local objects and empties the undo history. Fix that in twenty lines — keep the local copy, offer keep-mine or take-theirs per object — and leave the hardened websocket server honestly labelled as built ahead of demand rather than retrofitting a consumer to justify it.

**Frosted glass, and a third motion library.** The blanket blur removal in the planner shell was not laziness — it was a measured frame spike, fixed and recorded, on a shell already near its budget over a live WebGL canvas, and translucency on data surfaces was rejected outright by the owner. Reinstating it would be prosecuting the wrong rulebook. Add a comment recording why, so the next engineer stops rediscovering it. And sampling the scene's colour into the panel surfaces is a captured-truth failure wearing a compliment: tint the substrate from a runtime sample and the contrast audit no longer describes what ships.

**Holding money.** Invoicing and payment milestones are in scope and overdue. Escrow, split disbursement, or the platform anywhere in the flow of funds needs legal review before code, with the venue as merchant of record.

**A fifth homepage.** Four are routed in production right now — roughly eleven thousand lines across four page directories, in about four months, for one venue — while the enquiry on the live one is a `mailto` and the funnel is a verified dead end. Each one is genuinely well made. That is the problem, not the defence. No new front door until an enquiry-to-booking number exists, which requires the real send first, which means the rule has a denominator instead of a feeling.

**New Foundry contract families, until an asset crosses the existing ones.** This is the hardest refusal, because it is the most admirable work in the repository. The Foundry and its tools together are roughly twice the size of the frontend the venue actually touches, carry twenty-one near-parallel versioned contracts, and have published nothing. Signed attestation, immutable activation ledgers and a nine-artifact evidence chain are the right architecture for the fiftieth room. At room one they are a beautifully engineered way not to ship room two. Freeze the surface area and get one asset all the way through.

**Volume plays on someone else's turf.** No attendee registration or badging. No template marketplace to answer 6,700 floor plans — our answer to 6,700 drawings is one room that is actually true. No guest RSVP or wedding-website builder, no supplier directory, no in-app radio, no headset walkthrough, no multi-venue control plane before venue two exists.

**And the backlog itself.** Five hundred and twenty-seven task rows: 264 done, 158 never started, 92 deferred. A ledger where half the entries have never begun is not a plan, it is a wish archive, and it makes every stated intention indistinguishable from the two hundred and fifty that were also going to happen. Cut it to the thirty rows this vision needs and delete the rest. A reviewer reads an unbounded backlog as an absence of judgment, and on this evidence they would be right.

---

## The one thing

**The bind, plus the ten-line nav entry that makes the Diary reachable at all.**

The real send is a close second, it is cheaper, and it touches revenue directly — if there were one day rather than one quarter, do that. But the bind wins the quarter, because it is the only item on this list that makes the rest of the product true rather than merely present. `bookings.eventId` is nullable, `routes/bookings.ts:289` sets it to null, and `event_phases.eventId` is `notNull`. That single missing edge is why the hallkeeper sheet invents a time instead of reading one, why the Board is a sealed island with no way out, why a booking cannot open its layout or its pack, and why six of the moves in this document would otherwise render a wall of honest blanks. It is one migration and one transition hook — days, not weeks — and on the far side of it every other continuity promise here becomes a wiring job instead of a research problem.

And it is the one thing because of what it exists for: the first Saturday carried end to end. Nothing compounds in this product until a real event has run through it once, and no event can run through it while the thread is broken. Every month without that is a month the only moat a competitor cannot buy does not exist.

The test is not that a booking now has an event id. It is that a coordinator sets a load-in time once, on the Board, and the hallkeeper reads that exact number off paper the next morning in Glasgow time. That is the whole north star, running once, on one Saturday.

---

## What this costs and what it risks

I want to end with the part that would be easiest to leave out.

**The plan can make the product temporarily worse, and that is the most likely way it fails.** Half of what is proposed here replaces confident fictions with honest absences. The sheet stops inventing 18:00 and starts saying "no footprint set for this room." The drawer stops being empty and starts showing five slots, some of which will read "not created yet" for every booking made before the bind. Operationally, an honest blank on a Saturday morning is not free — the hallkeeper who used to have a wrong number now has no number, and the fix (setting the footprint) is a new habit that has to survive a busy week. Every one of those changes must ship with the action that fills the gap, in the same commit, or the owner's felt experience of this quarter is that the software got quieter and less useful. That is the failure mode I would bet on if this goes wrong, and it is not a technical one.

**The bind is one migration and the backfill is where it bites.** The migration and the transition hook are genuinely days. Deciding what happens to every existing Diary booking — which of them get a synthesised event, which get one on next touch, which stay bare — is a judgment call about live data with a live venue attached, and it is the kind of thing that turns a two-day job into a two-week job with a rollback plan. Budget for that honestly rather than discovering it.

**The rights gate is designed to fail on a revenue-bearing asset, and there are only three exits.** Land the tracked-tree check and CI goes red over sixty megabytes of Reception Room that the homepage currently serves. The exits are: clear the XGRIDS terms in writing (unknown timeline, not ours to control), rebuild the room from owned capture (a fortnight plus re-shoots), or take the room off the homepage. There is no fourth. If none of those happens, we will have built a machine that documents our own breach every time anyone pushes — and the temptation will be to add an allowlist, which is how a gate becomes theatre. Do not land that check without deciding, in advance and in writing, which exit we are taking.

**Almost everything here is serialised through one person's attention.** Three of the highest-value items on this list — the R2 bucket, the mail key, the questionnaire — are not engineering at all, and they have been open for weeks. That is the real velocity constraint. A small team can absorb the engineering; it cannot absorb a plan whose critical path repeatedly waits on the same owner for a twenty-minute decision. If nothing else changes about how this quarter runs, change that: batch the owner-actions into one session and clear all three before the first migration lands.

**The quarter that makes the product true will look like the quarter that shipped nothing.** Continuity does not demo. A nav entry, a timezone formatter, a foreign key and an empty ledger gaining three honest rows produce no screenshot. Meanwhile a fifth landing page or a scrubbable relighting basis photographs beautifully. That asymmetry is exactly what produced the current state — four homepages and one connected booking — and it will press again in about six weeks. The defence is the proof-clauses attached to each pillar: film the continuous take, hold the paper next to the screen. They are unglamorous on purpose, and they are the only evidence that will mean anything to a reviewer or to the venue.

**And it may turn out that the coordinator does not want this.** The First Real Saturday is the cheapest item in the plan and the only one that can invalidate the others. If the operated event reveals that nobody reaches for the layout from the Board, that the day sheet's invented time was never actually a problem because everyone phones anyway, that would be worth knowing in week five rather than month five. Run it early enough that the answer can still change the plan.

**Which pillar I would abandon first, if forced: One Building, Not Six Lanes.**

Not because it is wrong — a whole-building buyout that cannot be inked as one thing is real money left on the table, and six rooms in one Georgian building genuinely do interact. I would drop it first because it is the only pillar whose cost is mostly *new schema*: parent and adjacency columns, a combinability model, sixteen House Book fields with source and staleness metadata, a singleton resource for the goods lift. New tables at one venue, ahead of demand, is precisely the pattern that produced twenty-one parallel Foundry contract families and zero published assets. And the evidence about demand is not encouraging: the questionnaire that seeds the House Book has been sitting unanswered for eight days, and it takes twenty minutes. If the person who needs those facts most has not spent twenty minutes on them, that is data.

Three fragments of it I would keep even then, because they cost nothing and are already sitting in seeded data: `roomSlug` on the 49 already-decided twin nodes, the two new conflict types as attributed overrides, and the rigging lens refusing truss in a 2.18-metre room. Those are joins. The rest of that pillar is a schema, and schemas can wait for the Saturday that asks for them.

---

### Verification notes

Checked directly in the working tree on 25 July 2026 (branch `feature/diary-p0-slice-3`, which carries uncommitted work from several lanes): `bookings.eventId` nullability at `schema.ts:3189` and `eventId: null` at `routes/bookings.ts:289`; `event_phases.eventId` `notNull` at `schema.ts:1224`; zero `to="/diary"` in `packages/web/src`; zero `Link`/`useNavigate` in `DiaryBoardPage.tsx`; zero mentions of the Diary in `DashboardLayout.tsx`; the 18:00 / 90-minute constants and zero `bookings`/`eventPhases` references in `hallkeeper-sheet-v2-data.ts`; three un-zoned `toLocaleTimeString` calls across `hallkeeper-pdf-v2.ts:489` and `HallkeeperPage.tsx:976,1194`; eight tracked `.sog` files under `packages/web/public/splats/reception/`; `state/asset_versions.json` at 29 bytes and `state/training_runs.jsonl` at 0; 149 twin nodes with 149 null `roomSlug` and zero exposure records; `.gitignore:50`; the `mailto` anchor at `FreshPage.tsx:406` and no `fetch`/`API_URL` in `pages/fresh/`; `guest_leads` dedupe on email at `public-enquiries.ts:177`; `pnpm -r test` at `ci.yml:145` against 156 API test files; `cleanup.yml` as the only scheduled workflow; no `parentSpaceId`/combinability/adjacency in `schema.ts`; `bookings_ink_no_overlap` in `drizzle/0050`; the existence of `routes/room-layout-timeline.ts`; and the last twelve `ci.yml` runs on `master` (all failure, cancelled or startup failure; three on 25 July).

Taken on report from the six-lens dossier and not independently re-verified here: the "last green on 11 May, five successes in a hundred runs" figure; the venue-timezone stamp elsewhere in the PDF generator; the T-507 Grand Hall node decision; the competitor pricing, launch and conversion figures; the licence-matrix and capture-log details; and the task-ledger status tallies. Where those matter to a decision, check them again before spending money on them.
