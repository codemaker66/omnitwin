# 09 · Persona Journey Audit — Client, Events Manager, Hallkeeper

**Date:** 29 July 2026
**Method:** Mode 3 user-journey audit (`product-lens`), run three times. Every "HAVE" is traced
to a file, route, or API endpoint in this repo. Claims I could not verify from source are marked
**(?)** rather than asserted.
**Supersedes** the persona-relevant parts of `06-GAP-AUDIT.md` (10 July), which is 19 days stale —
G4 action log, Time Machine, the Diary (slices 1–7), command envelopes and REST idempotency have
all shipped since it was written.
**Complements** `docs/research/r3-client-journey.md` (external UK market research on wedding-client
norms, CMA deposit law, portal expectations). That document independently corroborates two findings
below: the "radio silence in the long middle" complaint cluster (Part 1, Stage 5) and enquiry-stage
responsiveness as the leading trust signal (Part 1, Stage 2).

---

## 0. The one-paragraph verdict

The **spine is extraordinary and the mouth is a mailto link.** Behind the front door sits a
122-table schema, 44 API route groups, 11 real cockpit lenses, an offline-capable ops stack, a
live Diary with conflict detection, and an evidence/claim-guard system most venues' software
vendors don't have. But the highest-traffic surface a paying client touches — the homepage
enquiry — composes an email in `mailto:` and hands the client their own clipboard. Three of the
four rooms Trades Hall actually sells have **no photoreal twin**. Nobody can check whether a date
is free without emailing a human. And there is no way to take money.

The work is not "build more platform." It is **connect the platform that exists to the people
it was built for.**

---

## PART 1 — THE CLIENT

*Persona: Sarah, 34, planning her wedding for 120 guests. Or: Michael, corporate events lead at a
Glasgow law firm, booking an awards dinner. Both are spending £3k–£15k and have never used venue
software before. Both will decide within 90 seconds whether this venue feels serious.*

### Stage 1 · Discover — "Is this place right for me?"

**WHAT WE HAVE**
- `/` → `packages/web/src/pages/fresh/FreshPage.tsx` — photography-first homepage, June shoot,
  dome-aperture hero, light/dark theming, skip-link, `aria-live` regions.
- A genuinely clever **capacity fit-checker**: type guest count + date, get back which room fits,
  a fallback suggestion, the rate line, and a scope note (`FreshPage.tsx:360–399`).
- `/venues/:venueSlug/rooms/:roomSlug` → `RoomShowcasePage.tsx`, public, client-safe copy only.
- `/venues/:venueSlug/twin` → `TwinPage.tsx` — a walkable photoreal twin with dollhouse and
  parallax stages.
- `/trades-house/leaflet` and `/trades-house/discover-your-craft` — a campaign leaflet and a craft quiz.
- `/pricing`, `/privacy`, `/terms`, `/accessibility`.
- Real published room dimensions baked in (Grand Hall 21×10×7m + 7m dome, Saloon 12×7×5.4m,
  Reception 13.4×11.2×3.2m, Robert Adam 9.7×5.6×2.18m).

**WHAT IS MISSING**
- **Only the Reception Room has a built photoreal runtime.** `state/capture_log.json` records the
  Grand Hall (41 GB), Saloon (29 GB) and Robert Adam Room (14 GB) as *"raw capture only —
  processing pending."* The Grand Hall is the room Trades Hall sells weddings in, and it is the
  one room a client cannot walk. This is the single biggest client-facing gap in the product.
- **No public availability.** `GET /calendar` is `authenticate` + `canManageVenue` gated
  (`packages/api/src/routes/calendar.ts:13–14`). The homepage date field accepts a date and checks
  *nothing* against it. The client picks 14 June, emails, and waits.
- No video, no drone/exterior footage, no 360 stills as a fallback for un-splatted rooms.
- No real-wedding gallery, no testimonials, no press, no "who else has been married here."
- No supplier/recommended-vendor list (florists, caterers, bands) — a standard venue-site expectation.
- No FAQ, no "what's included," no parking/access/transport page.
- No `og:image` / rich social preview **(?)** — flagged in the July landing critique; not re-verified here.

**WHAT WE SHOULD ADD**
1. **Public availability strip — highest impact per pound in the whole product.** The Diary
   already holds the truth. Expose a read-only, PII-free endpoint returning per-day
   `available | limited | unavailable` for the next 18 months, and paint it under the homepage
   date picker. The client learns in 200ms what currently takes two days and a human.
2. **Finish the Grand Hall twin.** Everything else in the product is downstream of the client
   believing the room. (RunPod lane — G10 in the old audit.)
3. **A "walk it at 8pm in December" light-state toggle** on the twin — venues are sold on
   atmosphere, and a captured splat plus a time-of-day grade is a genuinely rare thing to have.
4. Real-wedding gallery keyed to the *actual layouts* in the system — "this is the Grand Hall,
   cabaret 120, and here is the plan that produced it." Nobody else can do that.
5. Supplier directory, FAQ, access & parking, and an `og:image`. Unglamorous; expected.

---

### Stage 2 · Enquire — "I want to talk to someone"

**WHAT WE HAVE**
- `POST /public/enquiries` — a real, working, public enquiry endpoint
  (`packages/api/src/routes/public-enquiries.ts`) that creates a CRM record and emails the
  hallkeeper (`newEnquiryNotification`).
- Two surfaces call it: the planner's `components/editor/GuestEnquiryModal.tsx` and the twin's
  `twin/TwinEnquiryModal.tsx`.
- Client-facing status emails exist: `enquiryApproved`, `enquiryRejected`.

**WHAT IS MISSING**
- **The homepage does not use it.** The front-door CTA is `<a href={composed.mailtoHref}>`
  (`FreshPage.tsx:406`) plus a copy-to-clipboard button. So the enquiry that most clients send
  **never becomes a CRM record**, never gets a reference number, never enters the pipeline, and
  never triggers a duplicate check. This is a P0.
- No acknowledgement to the client. `newEnquiryNotification` goes to staff. The client who does
  reach the API gets silence.
- No reference number, no "we typically reply within X hours," no expectation setting.
- No file attachment (mood board, running order, prior quote).
- No callback-request or "book a viewing" slot picker.

**WHAT WE SHOULD ADD**
1. **Replace the `mailto:` with a real form posting to `/public/enquiries`.** Keep the fit-checker
   and the composed summary — they're good — but submit them. Keep `mailto:` as the no-JS fallback.
2. **Instant client acknowledgement email** with a reference, the composed summary echoed back,
   and a named person. Add `enquiryReceived` to `services/email-templates.tsx` (8 templates exist;
   this is the missing first one).
3. **Site-visit booking** off the back of the enquiry, writing a `viewing` hold into the Diary.
4. A "keep me posted on this date" soft-hold that expires — captures intent without blocking the room.

---

### Stage 3 · Explore & design — "Show me my event in the room"

**WHAT WE HAVE — and this is the crown jewel**
- `/plan` and `/plan/:code` → `pages/EditorPage.tsx`, guest-accessible via shortcode, no login wall.
- 3D planner: placement, snapping (`SnapGuides.tsx`), ghost preview (`PlacementGhost.tsx`),
  marquee select, measurement + tape measure, section plane, X-ray, wall auto-fade,
  instanced furniture, adaptive resolution.
- **Unified undo/redo plus the Time Machine** — `components/editor/TimeMachinePanel.tsx` with
  deep undo, version restore and replay over a typed action log (`stores/action-log-store.ts`,
  `stores/planner-action-log.ts`).
- **11 real cockpit lenses**: Guests, Flow, Evidence, Lighting, Power, Rigging, AV, Ops, Costs,
  Share, Design (`components/editor/cockpit/`).
- Command deck, laser markup layer, chair brush, bookmarks/POV cameras, minimap,
  room-layout timeline dock, table dressing (cloth + settings).
- `/blueprint` — a 2D top-down editor on the same scene data.
- Mobile/touch adaptation in 6 planner components (`useIsCoarsePointer`, `useIsNarrowViewport`).
- Truth-mode rail and evidence beams — the product tells you which parts of what you see are
  *measured* versus *assumed*. Nobody else in this category does this.

**WHAT IS MISSING**
- **Altitude is still split.** 2D lives at a separate `/blueprint` route; the plan (01 P1) called
  for one continuous view. The client has to know two URLs exist.
- **No client-facing guided start.** A first-time client landing on `/plan` meets a professional
  cockpit. There is no "wedding, 120 guests, dinner then dancing → here's a starting layout."
- The **Event Architect** auto-layout engine exists and is good — but it is staff-gated
  (`/event-architect`, roles admin/hallkeeper/planner/staff) and supports only two styles
  (`dinner-rounds`, `theatre` — `packages/types/src/event-architect.ts:30`).
- No first-person walk *inside the planner* (the Twin is a separate page on a separate route).
- No seat-level view — "what will Aunt Margaret at table 7 actually see?"
- No guest list / seating-chart layer at all: no names, no place cards, no dietary tags on seats,
  no "don't sit these two together."
- No layout comparison view (A/B two plans side by side).
- No shareable read-only planner link for the client's partner/committee to *comment* on.
- No print/PDF of the client's own layout.

**WHAT WE SHOULD ADD**
1. **Open the Event Architect to clients as a warm start**, wrapped in three plain questions
   (occasion / guests / does it need to change during the night). Generate, then let them edit.
   The engine, validator and guest-flow replay already exist — this is UI, not new machinery.
2. **Seating chart layer.** Upload or paste a guest list; drag names to seats; dietary and access
   flags ride through to the hallkeeper sheet (which already has `DietarySummary` and
   `AccessibilityRequirements` fields waiting). This is the number-one thing clients ask venue
   software for and we have the whole downstream already built.
3. **Absorb `/blueprint` into the planner as an altitude band** (G3). One view, one URL.
4. **"Your view from here"** — click any chair, see the room from that seat. We have a photoreal
   splat and a camera rig; this is close to free and it is *devastating* in a sales meeting.
5. **A shareable comment link** for the client's decision group, reusing the proposal
   share-token pattern that already works.
6. Client-facing layout PDF — same pdfkit lane as the hallkeeper sheet.

---

### Stage 4 · Propose, agree, pay

**WHAT WE HAVE**
- `/proposal/:shareCode` and `/proposal-share/:token` → `pages/ProposalPage.tsx`. Public,
  capability-scoped, client-safe shape only.
- Client can **approve**, **request changes**, and **hold a comment thread** with the venue
  (`ProposalPage.tsx:311–380`).
- Proposal versioning, status machine, share tokens, history, available-transitions
  (`routes/proposals.ts` — 21 endpoints).
- Quotes with line items and pricing rules (`routes/quotes.ts`).
- `ProposalLayoutVisual` — the proposal shows the actual layout.

**WHAT IS MISSING**
- **No payments.** `stripe_events` is a table in `db/schema.ts` and there is a migration script
  (`scripts/apply-migration-0018.ts`). That is the entire extent of it. No deposit, no card
  capture, no payment link, no balance schedule, no receipts.
- **No e-signature / contract acceptance.** "Approve" flips a status; it is not a signed T&C
  acceptance with an audit trail a venue could rely on. (See `docs/research/r3-client-journey.md`
  on UK CMA deposit constraints — this needs to be got right, not just built.)
- **No proposal PDF.** pdfkit is wired only for the hallkeeper sheet
  (`services/hallkeeper-pdf-v2.ts`, `services/pdf-prerender.ts`). The client cannot download or
  forward the thing they are being asked to spend £10k on.
- **No proposal emails.** Of the 8 templates in `services/email-templates.tsx`, none covers
  proposal sent / viewed / approved / expiring. The client is never told a proposal is waiting.
- No expiry countdown visible to the client, no "held until" language on the room.

**WHAT WE SHOULD ADD**
1. **Stripe deposit + balance schedule.** This is the largest single commercial hole in the
   product. `stripe_events` already exists; the proposal state machine already has the transitions
   to hang it on. UK norm per R3 research: booking deposit → mid-point instalment ~6 months out →
   balance 4–6 weeks before → final numbers ~2 weeks before.
2. **Proposal PDF** (reuse the pdfkit lane) and **`proposalSent` / `proposalApproved` emails.**
3. **E-signature with an audit trail** — name, timestamp, IP, terms version, immutably recorded.
   The claim/evidence machinery in this repo is *ideal* for this and currently unused for it.
4. Payment schedule visible to the client: deposit taken, balance due date, what's left.

---

### Stage 5 · Between booking and the day — the six-month silence

**WHAT WE HAVE**
- Nothing client-facing. This stage does not exist in the product.

**WHAT IS MISSING**
- **No client portal.** `client` is a real role in `packages/types/src/user.ts:19`, but
  `getDefaultRoute()` sends a logged-in client to `/plan` (`lib/role-routing.ts:8`) and
  `/dashboard` explicitly excludes them (`router.tsx:321`). A client has **no logged-in home** —
  no list of their events, proposals, payments, or documents. They rely entirely on share links
  in old emails.
- No countdown, no task list ("send final numbers by X"), no document vault.
- No final-numbers / dietary / running-order collection form — even though the hallkeeper sheet
  has typed fields waiting for exactly this data.
- No reminders.

> `docs/research/r3-client-journey.md` names this exact stage as **the most damaging and
> emotionally charged complaint cluster across every source** — "radio silence during the long
> middle between booking and the event." We have zero coverage here. It is the highest-ranked
> external finding and our largest structural absence, and those two facts agree.

**WHAT WE SHOULD ADD**
1. **A client portal at `/my-events`** — their events, layouts, proposals, payments, documents,
   and a countdown with a task list. Everything needed to populate it already exists in the API.
2. **Final-details collection** at T-minus-4-weeks, writing straight into `EventInstructions`
   (`dietary`, `accessibility`, `doorSchedule`, `dayOfContact`, `specialInstructions` are all
   already typed in `packages/types/src/hallkeeper-instructions.ts`). The hallkeeper sheet is
   currently waiting on data nobody is asking the client for.
3. Automated milestone emails — the Diary's `holdDecisionReminder` proves the cron/idempotency
   lane works; this is the same pattern applied to bookings.

---

### Stage 6 · The day, and after

**WHAT WE HAVE**
- Staff-side event-day ops (see Part 3). Nothing the client sees.

**WHAT IS MISSING**
- No day-of client view ("your room is set, here's a photo, here's your contact").
- No post-event: no photos returned, no feedback request, no review prompt, no rebooking offer,
  no anniversary/annual-repeat nudge for corporate clients.

**WHAT WE SHOULD ADD**
1. **A "your room is ready" moment** — the hallkeeper's completion photo pushed to the client on
   the morning. Small, cheap, and the kind of thing people screenshot and post.
2. Post-event feedback + review request; for corporate clients, a one-click "same again next year"
   that clones the layout and opens a held date.

---

## PART 2 — THE EVENTS MANAGER AT TRADES HALL

*Persona: the person who owns the enquiry inbox, the diary, the money, and the relationship. They
are juggling 40 live enquiries, a phone that rings, and a hall that must not be double-booked.
Their nightmare is a clash. Their daily grind is re-typing the same information into four places.*

### Stage 1 · Enquiry lands

**WHAT WE HAVE**
- `/dashboard?view=enquiries` → `components/dashboard/EnquiriesView.tsx`, with detail, status
  transitions, and history.
- `/dashboard?view=pipeline` → `CommercialPipelineView` (opportunities).
- `/dashboard?view=search` → client search, plus `ClientProfile` with cross-view return context.
- CRM tables: `opportunities`, activities, status history.
- Enquiry → booking: `POST /bookings/from-enquiry`.
- Notification centre (`components/dashboard/NotificationCenter.tsx`).

**WHAT IS MISSING**
- **The homepage's enquiries never arrive here** (Part 1, Stage 2). The manager's actual inbox is
  Outlook, and the dashboard sees only planner- and twin-originated enquiries. This makes the
  entire CRM under-fed by design.
- No enquiry source attribution, no response-time SLA clock, no auto-assignment, no duplicate
  detection.
- No inbound email ingestion — nothing parses a real email into an enquiry.
- No lead scoring or "this date is high-value, prioritise."

**WHAT WE SHOULD ADD**
1. Fix the homepage form (again — it is the load-bearing fix for this persona too).
2. **Response-time clock and an "unanswered > 24h" rail** on the enquiries view. R3 research:
   couples judge a venue's future reliability by enquiry-stage responsiveness.
3. Email ingestion (forward-to-address → enquiry) so the manager can keep working the way they
   already work while the system catches up around them.

### Stage 2 · The Diary

**WHAT WE HAVE — genuinely strong**
- `/diary` → `pages/diary/DiaryBoardPage.tsx`: drag-to-move bookings, **live multi-user updates**
  (`useDiaryLive`), a **conflict rail**, a **holding tray**, ink-confirm, undo toast, and a
  welcome panel.
- `GET /calendar` — one shared read model for every view, half-open overlap semantics, room lanes,
  bookings *and* room-scoped timed phases (the Occupancy Footprint), with conflicts computed in
  the same request (`routes/calendar.ts:20–32`).
- Turnaround rules (`turnaroundRules` table) — the diary knows a room needs resetting between events.
- **Hold reminders** with `email_sends`-keyed idempotency, an admin endpoint and a cron CLI (T-527).
- **Command envelopes + REST idempotency** (T-537/T-538): one ledger across both transports,
  replay-authorised against the *recorded* venue.

**WHAT IS MISSING**
- No external calendar sync (Google/Outlook/iCal feed). The manager still lives in Outlook.
- No mobile diary view — the board is desktop-shaped.
- No provisional/pencil tier distinct from a firm hold **(?)** — `deriveBookingState` exists; the
  UI surfacing of tiers not verified here.
- No revenue-per-slot or yield view on the board ("this Saturday is worth £8k, don't give it away").
- No recurring bookings (a monthly society dinner must be entered 12 times).

**WHAT WE SHOULD ADD**
1. **Two-way Outlook/Google sync, plus a read-only iCal feed.** Until this exists the Diary is a
   second system rather than the system.
2. **Public availability endpoint** (see Part 1) — same data, PII stripped.
3. Yield overlay on the board; recurring-booking support; a phone-shaped diary.

### Stage 3 · Quote, propose, close

**WHAT WE HAVE**
- Quotes, line items, pricing rules, proposals with versions and share tokens, proposal comment
  threads, `available-transitions`, `/dashboard?view=proposals`.
- Reference loadouts (`LoadoutsView`) — reusable equipment/furniture sets.
- Configuration reviews with approval emails (`routes/configuration-reviews.ts`).

**WHAT IS MISSING**
- **No payments, no invoices, no accounting export.** (Same hole as Part 1, Stage 4.)
- No proposal PDF to attach to an email.
- No proposal-viewed telemetry — the manager cannot see the client opened it.
- No templates ("standard wedding package") to start a quote from.
- No margin/cost view — `stores/cost-store.ts` exists client-side; there is no manager-facing
  profitability read.

**WHAT WE SHOULD ADD**
1. Stripe + invoices + a Xero/QuickBooks CSV export.
2. **Proposal open/view tracking** — the single most useful signal in venue sales.
3. Package templates, and a margin column on the pipeline.

### Stage 4 · Plan the event in detail

**WHAT WE HAVE**
- Events with phases, scenarios, layout variants and a phase graph (`routes/events.ts`).
- **Event Architect** — deterministic auto-layout for `dinner-rounds` and `theatre`, with service
  model, guest-flow replay, route-conflict detection, a layout validator and an ops-review gate
  (`packages/types/src/event-architect.ts`).
- **Event Mission Control** — mission, timeline, replay, presence, phases, tasks, incidents
  (`routes/event-mission-control.ts` — 10 endpoints).
- **Supplier coordination** — packs, share tokens, acknowledgement, and a "changes since previous
  handoff" delta (`pages/SupplierPortalPage.tsx`, `routes/supplier-coordination.ts`).
- Ops handoff packs compiled from a configuration
  (`POST /ops/handoff-packs/from-configuration/:configId`).

**WHAT IS MISSING**
- Only two auto-layout styles (no cabaret, no U-shape, no boardroom, no classroom, no standing
  reception).
- No staff rostering / who-is-working.
- No equipment inventory with availability ("we only own 90 gold chairs and two events want them").
- No supplier directory or contract store — supplier packs exist but suppliers themselves aren't
  first-class entities **(?)**.
- No budget-vs-actual on an event.

**WHAT WE SHOULD ADD**
1. **Equipment inventory with cross-event availability checking.** This is the clash the Diary
   cannot currently catch, and it is the one that ruins a Saturday.
2. More layout styles in the Architect — cabaret and standing reception especially.
3. Staff roster tied to the event's phase timings.

### Stage 5 · Reporting

**WHAT WE HAVE**
- `ExecutiveAnalyticsView` + `routes/revenue-analytics.ts`.
- Action log / audit trail across the planner and diary (G4, T-522).

**WHAT IS MISSING / BROKEN**
- ⚠️ **`executive` is not a real role.** `USER_ROLES` is
  `["client","planner","staff","hallkeeper","admin"]` (`packages/types/src/user.ts:19`), yet
  `router.tsx:321`, `DashboardPage.tsx:72–79`, `DashboardLayout.tsx:50` and `role-routing.ts:8`
  all branch on `role === "executive"`. The DB column is a free `varchar(20)` (`db/schema.ts:170`)
  and the web session schema types `role` as `z.string().min(1)` (`api/auth.ts:10`), so an
  executive user *can* be created — but only by hand-editing the database, and the canonical enum
  doesn't know it exists. **The Executive Analytics view is effectively unreachable.** Either add
  `executive` to `USER_ROLES` and give admins a way to assign it, or delete the branches.
- No scheduled/emailed reports, no conversion-funnel analytics, no source attribution,
  no forecast, no occupancy-rate view.

**WHAT WE SHOULD ADD**
1. Resolve the `executive` role drift (decide: real role, or remove).
2. A monthly board pack, auto-generated and emailed.
3. Enquiry→booking conversion funnel with source attribution.

---

## PART 3 — THE HALLKEEPER

*Persona: the person who at 7am walks into a cold stone hall with a trolley of chairs and has to
make it match a picture someone drew three weeks ago. They are on their feet, holding a phone or a
printed sheet, in a building where the wifi is a rumour. They do not want software. They want to
not have to think.*

### Stage 1 · Getting the job

**WHAT WE HAVE**
- `/hallkeeper/:configId` → `pages/HallkeeperPage.tsx` (1,400 lines), role-gated to
  admin/hallkeeper/planner.
- `GET /hallkeeper/:configId/v2` — the structured sheet, including **exact per-object positions**
  (`RowPosition`: objectId, x, z, rotationY — `packages/types/src/hallkeeper-v2.ts:52`).
- **A real PDF** (`services/hallkeeper-pdf-v2.ts`), R2 pre-rendered, with a print stylesheet and
  an honest download error state (`HallkeeperPage.tsx:358–390`).
- `hallkeeperNotified` email template.
- Ops handoff packs.

**WHAT IS MISSING**
- No "here is your day" list — the hallkeeper must be handed a `configId`. There is no
  hallkeeper home screen showing today's and tomorrow's jobs across rooms.
- No push notification when a layout changes after they've started.

**WHAT WE SHOULD ADD**
1. **A hallkeeper home screen**: today, tomorrow, this week — every room, every setup, sorted by
   deadline. `phaseDeadlines` already exists in the schema.

### Stage 2 · Understanding the layout

**WHAT WE HAVE — the best-designed part of the product for its user**
- `components/hallkeeper/InteractiveFloorPlan.tsx` — a top-down plan with real positions.
- **Setup phases** with icons and order: Structure ▣ → Furniture ▬ → Dress ✦ → Technical ⚡ →
  Final Touches ★ (`packages/types/src/hallkeeper-accessories.ts:56–60`).
- **Implied accessories** — the sheet derives what each parent object needs (cloths, settings),
  with quantity-per-parent and phase assignment (`ImpliedAccessorySchema`).
- **Instructions**: special instructions, day-of contact (name/role/phone/email), phase deadlines
  with reasons, access notes, accessibility requirements, dietary summary (Veg / Vegan / GF /
  Nut-free / Halal / Kosher), door schedule (`packages/types/src/hallkeeper-instructions.ts`).
- Instructions banner and status banner components.

**WHAT IS MISSING**
- **No 3D or photoreal reference for the hallkeeper.** They get a 2D plan. The photoreal twin
  exists in this repo, and the person who most needs to see "what should this look like when I'm
  done" cannot see it.
- No "you are here" orientation — the plan doesn't tell them which end of the room is the door.
- No measurements from fixed architectural features ("top table 2.4m from the north wall"), which
  is how a human actually positions furniture.
- Dietary/accessibility/door-schedule fields exist but **nobody is collecting the data** (Part 1,
  Stage 5) — so in practice these render empty.

**WHAT WE SHOULD ADD**
1. **A reference render per phase** — the finished-state image beside the plan. Auto-generated
   from the layout via the existing ortho-capture lane (`web/src/lib/ortho-capture.ts` is already there).
2. **Setting-out dimensions from fixed features** — offsets from walls, doors, columns and the
   Grand Hall dome centre. This is the difference between a plan and an instruction.
3. Give the hallkeeper the Twin, filtered to their room, as the "what good looks like" reference.

### Stage 3 · Doing the work

**WHAT WE HAVE — and this is genuinely excellent engineering**
- **Progress checkboxes per row** (`GET/PATCH /hallkeeper/:configId/progress`) with
  `checkedBy` + `checkedAt`.
- **Offline queues in IndexedDB** for both hallkeeper progress (`web/src/lib/progress-sync-queue.ts`)
  and event-day ops (`web/src/lib/event-day-offline-queue.ts`) — last-write-wins per task, every
  queued issue retained, replayed on reconnect. Somebody thought hard about a stone building with
  bad wifi.
- `/ops/events/:eventId` → `pages/EventDayOpsPage.tsx`: ops board, task status, **issue raising**,
  and **changes-since-last-handoff**.
- Mission Control incidents and presence.

**WHAT IS MISSING**
- ⚠️ **No PWA. No service worker. No web app manifest.** `packages/web/public/` contains no
  `manifest.json` and `vite.config.ts` has no PWA plugin. So: the app cannot be installed to a
  home screen, and if the hallkeeper opens it cold with no signal, **they get nothing**. The
  IndexedDB queues only help a tab that is *already open*. This undercuts the offline work that
  has already been done.
- No large-touch-target / glove mode; the hallkeeper page is not among the 6 components that adapt
  to coarse pointers.
- No completion photo capture — no way to prove or record the finished room.
- No voice or hands-free interaction.
- No timer against `phaseDeadlines` — the deadlines are stored but not counted down.

**WHAT WE SHOULD ADD**
1. **Ship a PWA + service worker with the hallkeeper sheet and its assets precached.** This is the
   highest-value, lowest-risk item in Part 3. The offline queues are already built; this makes
   them actually work.
2. **Completion photo per phase**, stamped and attached to the config — proof for the venue, and
   the "your room is ready" moment for the client (Part 1, Stage 6). One feature, two personas.
3. **Deadline countdown** on each phase, driven by the existing `phaseDeadlines`.
4. A high-contrast, big-target hallkeeper mode.

### Stage 4 · Change, teardown, reset

**WHAT WE HAVE**
- Changes-since-last-handoff delta; issue raising; incident logging; turnaround rules in the Diary.

**WHAT IS MISSING**
- No teardown/reset checklist — the sheet describes building the room, not returning it.
- No damage/breakage report, no lost-property log.
- No handback confirmation to the events manager ("room reset, ready for tomorrow").
- No time-taken capture, so nobody ever learns that a 120-cover cabaret takes 3 hours, not 2.

**WHAT WE SHOULD ADD**
1. **Teardown checklist + handback confirmation**, closing the loop to the Diary's turnaround rule.
2. **Time-taken capture per phase.** Feed it back into `phaseDeadlines` so the estimates get
   better every event. This is the flywheel nobody else in venue software has.
3. Damage/breakage report attached to the event.

---

## 4 · The ranked list — if only ten things get done

| # | Item | Persona | Why it wins |
|---|---|---|---|
| 1 | Homepage enquiry form → `POST /public/enquiries` (+ client ack email) | Client, Manager | The front door currently bypasses the entire CRM. Hours of work. |
| 2 | Public availability strip from the Diary | Client, Manager | Removes a two-day round trip. The data model already exists. |
| 3 | Stripe deposits + balance schedule | Client, Manager | The product cannot take money. Largest commercial hole. |
| 4 | PWA + service worker for the hallkeeper | Hallkeeper | Makes the offline work already built actually work. |
| 5 | Grand Hall photoreal runtime | Client | The flagship room can't be walked. Everything is downstream of belief. |
| 6 | Client portal `/my-events` + final-details collection | Client, Manager | Fills the six-month silence; feeds the hallkeeper sheet's empty fields. |
| 7 | Seating chart layer (names, dietary, access) | Client, Hallkeeper | Most-requested venue feature; entire downstream already built. |
| 8 | Proposal PDF + proposal emails + view tracking | Client, Manager | Currently the client is never told a proposal exists. |
| 9 | Completion photo per phase | Hallkeeper, Client | One feature, two personas, high emotional return. |
| 10 | Outlook/Google calendar sync | Manager | Until this lands the Diary is a second system, not the system. |

**Resolve alongside:** the `executive` role drift (Part 2, Stage 5) — a whole analytics view is
currently unreachable by any user the type system admits.

---

## 5 · What is genuinely world-class already

Stated plainly, because an audit that only lists gaps misrepresents the thing:

- **Truth mode and evidence beams.** The product distinguishes what is *measured* from what is
  *assumed*, and makes it spatial. No venue-planning tool does this.
- **The offline ops stack.** Somebody modelled a real stone building with real bad wifi and built
  IndexedDB queues with last-write-wins semantics for it.
- **The Diary's single shared read model** — one endpoint, half-open overlap semantics, conflicts
  computed in the same request. This is how you avoid a class of bug entirely.
- **Command envelopes with a global idempotency ledger across two transports**, with replay
  authorised against the *recorded* venue rather than the current one.
- **The typed action log and Time Machine.** Deep undo, version restore and replay as one engine.
- **Hallkeeper accessory derivation.** The system works out that 12 rounds imply 12 cloths and 96
  settings, and phases them. That is real domain modelling.

The gap is not capability. It is **connection** — spine to skin, and skin to the three people who
have to use it.
