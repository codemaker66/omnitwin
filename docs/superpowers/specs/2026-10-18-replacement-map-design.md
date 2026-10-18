# Venviewer, the whole system: the replacement map and the all-day standard

Design, 18 October 2026. Status: **draft for Blake's approval** (brainstorming hard gate: nothing in it is
built until he approves it). Branch `claude/replacement-map-20261018`. Evidence workspace
`D:/claude/replacement-map-20261017/` (outside the repo).

## 1. What Blake asked for, and why

Blake, 17 October 2026:

> "we are to replace salesforce and cvent and every other event/venue management system … everything they
> use salesforce for and cvent and other companies we will provide in a much more useful and easy way in a
> next-gen capability way, and also all pain points and things they wish those companies provided, we will
> solve and have in our offerings."

and, on how it must feel:

> "never daunting to a user, always immensely satisying an easy. we want the user to feel like they are
> getting a lot done, and also actually get a lot done … even when they work on our systems 10 hours a day 5
> days a week they are never fatigued or disinheartened or daunted by what they see on screen -- it is always
> a visual pleasure, the same way some games can have their players play all day every day."

On 18 October he chose, from offered options, **"Everything, both sides"** for scope and **"Map first, then
build"** for the first step.

What that means in practice: Venviewer becomes the one system a venue, its clients, their guests and its
suppliers use for everything from the first enquiry to the thank-you after the event. On the venue side it
does what teams use Salesforce, Amadeus Delphi, Oracle OPERA Sales and Event Management, Tripleseat,
Momentus, Priava, Event Temple, iVvy, Perfect Venue, Planning Pod, HoneyBook and Cvent's hospitality tools
for. On the other side it does what hosts, planners and guests use Cvent Event Management, Eventbrite,
Ticket Tailor, Swoogo, Bizzabo, Zola, Joy, Bridebook, Hitched, RSVPify, Aisle Planner and seating tools for.
Every job is done with fewer steps, nothing typed twice, nothing stated that nobody checked, and screens
people can work in all day without tiring.

Why now:

- The bind shipped on 17 October (PR #104, migration 0090): every hold and booking already belongs to one
  event record, enforced by the database. Everything in this map hangs from that record, so the foundation
  that makes "one system" possible exists.
- The 16 October research (21 role clusters, 27 rival products, 95 sources) named what a veteran cannot
  switch without, and today's verified inventory shows exactly which jobs exist in code.
- Trades Hall's invite-only pilot and the public release are being prepared now.
- Delphi venues face a forced change anyway: Amadeus has told them that Salesforce retires the platform behind
  Delphi's Word merge tool in June 2027, so every proposal and contract template must move to a new tool
  ([Amadeus, what's new](https://help.amadeus-hospitality.com/sales-and-event-management/advanced/content/whats-new.html)).

The veterans' daily loop, as the research found it, is six things: how fast an enquiry becomes a proposal;
reading the diary at a glance; the function sheet staying true when numbers change; deposits reaching
finance; email landing on the right record; and the phone on the day itself. Those six decide whether a
team loves or hates its system, so they decide the order here.

## 2. Decisions this document records

- **Both sides (Blake, 18 October).** This supersedes July's refusal of "volume plays on someone else's turf"
  for registration, ticketing, RSVPs, guest lists, seating and event sites, and the 16 October red team's
  "cannot win" list for the attendee side. The other standing refusals keep their force (section 4).
- **Map first, then build (Blake, 18 October).** This document is the map. After Blake approves it he picks
  the first build (section 10), which gets its own design, plan and delivery.

## 3. Goals, non-goals and anti-goals

**Goals**

1. Every job in the map (section 7) is live for the people who do it, at the all-day standard.
2. A venue switches: Trades Hall's forward book, clients, agreements and money run on Venviewer, reconciled to
   the penny against the old system and the bank, and the old tools can be switched off.
3. A host runs their guest side on Venviewer for an event at the venue: guest list, invitations, RSVPs, meal
   choices, seating, tickets where they are sold, and arrival, with every count reaching the kitchen and the
   hallkeeper without anyone re-typing it.
4. Every pain point in the evidence has a named answer and a place in the sequence.

**Approaches Blake approves rather than cuts** (each is a decision in section 11, not a silent reduction):

- Other companies' audiences: Cvent Supplier Network's planners, Bridebook's and Hitched's couples, Hire
  Space's and Tagvenue's visitors. We take their enquiries into the venue's one inbox and answer from the
  record; we do not try to rebuild their marketplaces with one venue.
- Gift registries, hotel property-management systems and live-streaming platforms: we link to them (a
  registry link on the event page, partner-hotel room blocks, a stream link on the attendee page).

**Non-goals**

- Holding client money. The venue is merchant of record on its own payment account; Venviewer never holds
  funds (standing refusal, restated 16 October).
- Being the venue's accounting ledger. Invoices carry the venue's numbering and land in the venue's
  accounting system unless its accountant agrees otherwise in writing (standing refusal, restated 16 October).

**Anti-goals** (a failure even if everything technically works)

- Parity that feels like Salesforce: dense, configurable everything, daunting.
- Anyone re-types something Venviewer already knows.
- A figure shown as fact that nobody checked, or a green tick for something nobody verified.
- A veteran keeps a second spreadsheet because the product hides an assumption.
- People love the demonstration and bypass the product on the real shift.
- Engagement tricks: streaks, colleague leaderboards, compulsion loops, surveillance of individual workers.
- AI that sends or decides on its own.
- Guests' health or access needs held without a lawful basis and a signed data-protection impact assessment.

## 4. Constraints

- **Stack.** React and React Three Fiber, Fastify, PostgreSQL with Drizzle, Zustand, Zod, Vitest, pnpm;
  strict TypeScript with no `any`; Spark renders splats inside the existing renderer lifecycle.
- **The record.** The event is the spine. A hold or booking cannot exist without its event (the bind). New
  records (agreements, payments, invoices, guests, tickets, documents, messages) attach to the event and to
  people, never float free.
- **Truth.** No verdict on an assumed input; every figure carries who stated it and when; a gap is shown as
  a person to ask. Capacity authority runs from the fire risk assessment, to the licence, to the published
  guide. No England or US code is cited for a Scottish building. Software warns and records; it never blocks
  the person at the alarm panel or replaces the radio and 999.
- **Availability.** No public "available" or "free" for a room until its forward book is reconciled.
- **Money.** The venue is merchant of record; Venviewer never holds funds; cancellation decisions show the
  clause, the facts and the arithmetic and are made by a named person.
- **Privacy.** UK GDPR. An Article 28 processor agreement between the venue and Venviewer before switching
  day. A signed DPIA before named dietary, health or access data (Article 9). Retention rules are built, not
  only published: today the privacy policy promises deletion after 24 months and nothing deletes.
- **AI.** Drafts only; a person reads the exact words and sends. AI never states availability, price,
  capacity or safety unless the figure comes from the record. Off in production until the privacy notice
  names the processor and inbound text is isolated from instructions.
- **Rights.** The splat hold of 19 September stands. Nothing proprietary from another company enters the
  repository, which is public. Research uses public documentation, API references, user reviews and trials
  only where their terms allow.
- **Delivery.** One merge to master at a time through the chief of staff; migration numbers are fixed at
  merge; GPU-scoped changes pass the GPU gate; every visible wait uses `Activity.tsx`; motion uses springs;
  one sound registry; the shipping contract in `.claude/conventions/shipping-changes.md`.
- **UK law that shapes design** (sources in section 13): VAT treatment of venue hire and catering, Scots law
  on contracts and signatures, all-in pricing for tickets under the Digital Markets, Competition and Consumers
  Act 2024, the Consumer Contracts Regulations exemption for dated leisure services, and Martyn's Law
  (Terrorism (Protection of Premises) Act 2025).

## 5. Where we stand (verified in code)

A verified inventory of origin/master `cc9e8e4d` on 18 October traced 275 jobs from screen to route to table,
each with file and line evidence (`D:/claude/replacement-map-20261017/coverage-cc9e8e4d.md`):

| Live | Partial | Missing | API only | Schema only | Dark | Unverified |
|---:|---:|---:|---:|---:|---:|---:|
| 86 | 58 | 73 | 23 | 16 | 12 | 7 |

Three merges since (#109 hallkeeper sheets that print their version and a QR that answers "current" or
"superseded"; #110 clients and planners signing in to their own events; #121 share-code tests) improve
rows without being re-traced here.

Three patterns decide the plan:

1. **Ahead where no incumbent is.** One event record from the first pencil, enforced by the database. Clients
   propose times on the real plan and the house holds them. The Day Board with live room observations and
   request escalation. Layout review with presence. Supplier passes. Martyn's Law prompts. The captured room.
2. **Missing the plain core venues buy their software for.** Contracts, signatures, deposits, payments,
   invoices, VAT and accounting sync; import, export and calendar feeds; menus, drinks and equipment on the
   function sheet; client records you can edit and merge; email in and out; forecasts and reports. On the
   other side, everything: guest lists, RSVPs, named seating, tickets, registration, check-in.
3. **Built but unreachable.** 23 API-only and 16 schema-only jobs: supplier packs, pricing modifiers, revenue
   scenarios, creating and editing an event, proposal version history, task assignment, venue-editable email
   templates, webhooks. Finishing these is the cheapest progress in the map.

Two live defects found on 18 October were passed to the chief of staff with file and line references: a
public venue route returns more than public facts, and the 24-month deletion the privacy policy promises
(`packages/web/src/pages/LegalPage.tsx:397`) is not built (`packages/api/src/services/cleanup.ts` purges only
previews and orphaned uploads). The People Book in wave 1 carries out the retention rule.

## 6. The shape: one event, many windows

The incumbents are many modules bolted together: a CRM, a diary, a function-sheet tool, a diagramming tool,
a payments add-on, a registration product, a guest app. Their worst pains come from the joins: re-keying,
stale copies, and nobody knowing which version is true. Venviewer is one record seen through many windows.

Seven spines carry every job in the map. Three exist; four are new.

| Spine | What it holds | State |
|---|---|---|
| **Event** | The event and its bookings, phases, layouts, requests and sheets (the bind) | Live |
| **Time** | The diary, holds and option ladder, the living timetable, the Day Board | Live; needs room combinations, series, automatic expiry, calendar feeds |
| **Truth** | Provenance, claim states and evidence for every figure | Live in the planner; extend to every surface |
| **People** | Organisations, people and households, with roles per event (booker, host, guest, supplier, staff), consent and retention, and one timeline of everything that happened | New. Today's accounts and contacts are side effects of converting an enquiry, one account per enquiry, uneditable |
| **Money** | Quote, agreement, signature, payment schedule, payments, invoices and credit notes, refunds, the accounting push; and on the attendee side orders, tickets and payouts | New. Quotes are live; nothing after them exists |
| **Documents and doors** | Every proposal, agreement, function sheet, run of show, plan, invoice, guest list, place card and pass as a versioned document that knows when it is out of date, shared through doors (named, expiring, revocable links that need no account) | Partly live (proposal links, supplier pass, sheets that know their version) |
| **Conversations** | One inbox per venue: email out from the venue's own domain, email in (replies and new enquiries), notes, calls, messages and later SMS, each attached to people and the event, with delivery receipts and quiet hours | New. Today staff copy links into their own mail |

The **people spine serves both sides**: the booker on the venue side and the host's guests on the attendee
side are the same kind of record with different roles on an event. Designing it once is the largest single
saving in the plan, and the red team of 16 October named "one party-and-grant model, designed once" as a
foundation several items silently assume.

The **windows** are the role views over that record: the venue team's desks, the Diary and the Day Board;
the client's hub; the guest's page; the supplier's pass; the hallkeeper's sheet; the wall. Each opens on its
own work.

<!--GENERATED-SECTIONS-->
<!-- Generated from D:/claude/replacement-map-20261017/page/map.json by tools/build_page.py; edit the data, not this block. -->

## 7. The replacement map

Each row is a family of work. Open one to see what their tools do, what Venviewer has today with its verified status, and what we build, with the pain it ends. Filter by who the work is for or by wave.

| Family | For | Wave | Today (live / partial / missing) | What we build | The pain it ends |
|---|---|---|---|---|---|
| **A. Enquiries and first answers** | venue team | Venue switches, Every venue | 3 / 5 / 3 | One inbox for the web form, email, phone, walk-ins and the listing sites. Each enquiry gets one named owner and one honest first-reply clock across every channel. Before anyone replies, the record has matched the person, checked the date room by room and priced it from the rate card with each figure’s source, and a reply is drafted for a person to send. A phone call is logged in fifteen seconds. Cvent RFPs can arrive today through Cvent’s Lead Catcher email, which needs no licence; replying from Venviewer needs Cvent’s two-way proposal API, a beta its account team grants. Other listing sites follow where their terms allow, once a four-week log shows which channels matter. | Every lead has to be pulled into the venue’s own system, checked for missing detail, priced, proposed and chased by hand. ([source](https://hipporev.ai/blog/hidden-cost-of-cvent-hotel-sales)) |
| **B. Clients and relationships** | venue team, hosts and guests | Venue switches | 3 / 4 / 4 | One people record for both sides: organisations, people and households, each with a role on an event (booker, host, guest, supplier, staff). Edit, merge and remove duplicates in one stroke. Calls, emails, meetings and notes sit on one timeline with every enquiry, event, agreement and payment. Consent is kept per purpose, the 24-month retention the policy promises is carried out, and any person’s data can be exported or erased. ‘Same again’ turns last year’s event into this year’s draft, timed to when that client usually rebooks. | Without a dedicated administrator the complexity bites, and every change waits on admin time. ([source](https://www.capterra.com/p/61368/Salesforce/reviews/)) |
| **C. Pipeline and forecasts** | venue team | Venue switches | 2 / 2 / 3 | Deal values come from live quotes and are never typed by hand. Probability comes from the venue’s own conversion by stage and source. The monthly forecast separates signed agreements, paid deposits and weighted holds, and every figure opens to the bookings behind it. Lost reasons are a short fixed list, so win and loss by source, room and season take one click. | Opportunities and events are separate records, so lost-booking and enquiry reporting needs two reports. ([source](https://a2is.com/catalog/event-management-software/priava/reviews-priava)) |
| **D. The diary and the building** | venue team | Venue switches | 9 / 4 / 1 | Keep what already leads: every booking on one event record, first and second options, live presence and the clash checks. Add what Delphi veterans rely on and would refuse to lose: combined and divided rooms, setup and teardown time around every booking, a holding line for events not yet given a room, and waitlists behind a held date. Then add recurring series, ranked holds that come due on the venue’s own rule, with reminders to their owner and a release ready for one tap, so nothing lingers (no rival reviewed ranks holds and resolves them on a clock), availability search by dates, guests and layout, and read-only calendar feeds for each room and each person. | A veteran who calls Delphi a genuinely amazing system still saw one ballroom sold to two clients, with both sets of orders printed. ([source](https://princessvalerie.net/blog/delphi-garbage-in-garbage-out)) |
| **E. Prices and rate cards** | venue team | Venue switches | 1 / 1 / 3 | A rate card the venue’s admin and manager maintain themselves, by season, day and time window, with minimum spends, packages and discounts that need a named approver. Suggestions sit beside a price as dated context and never change it on their own (your 17 October decision). The front door’s published rates come from the same rules instead of constants in the code. | Updating menus, contract and function-sheet templates costs extra, and entering rates up front takes a long time. ([source](https://www.capterra.com/p/141909/IVvy/reviews/)) |
| **F. Proposals** | venue team, hosts and guests | Venue switches | 12 / 4 / 5 | Keep the live composer, templates, versions and the client link. Add good, better and best options in one proposal, a version history with a side-by-side compare, a validity date that expires on its own, sending from the venue’s own address, a letterhead PDF, and acceptance that flows straight into the agreement. | Client-facing documents need Crystal Reports or Word-merge skills, and often a paid custom report, to look good. ([source](https://capterra.com/p/2403/Momentus-Technologies/reviews/?page=2)) |
| **G. Agreements, deposits and payments** | venue team, hosts and guests, planners and attendees | Venue switches, Tickets and conferences | 0 / 0 / 7 | The accepted version, the venue’s terms and the deposit become one agreement, signed online with a record of who signed what and when. A single-event hire needs no formal writing in Scots law, so this is lawful evidence; recurring hires over a year go to the venue’s solicitor. Payment goes straight to the venue’s own account by card or bank (Stripe’s Standard accounts with direct charges, so refunds and disputes sit with the venue and Venviewer never holds the money), or is marked received by hand. Once the agreement is signed and the deposit is in, the booking is ready and a named person confirms it in one tap, and the second option hears at once. Cancellations show the clause, the facts and the arithmetic for a named person to decide. | A reviewer reports about $12,000 held for longer than the stated two to three days. ([source](https://www.trustpilot.com/review/honeybook.com?stars=1)) |
| **H. Invoices, VAT and accounts** | venue team | Venue switches | 1 / 0 / 5 | Invoices and credit notes with the right VAT for each line: a plain hall hire may be exempt, while weddings, hires the venue caters and all catering are standard-rated, and a deposit fixes the tax point when it arrives. The venue’s accounting system numbers them, Venviewer pushes them to Xero, Sage or QuickBooks with a safe retry, and payment status comes back. It is UK-first from the start: pounds, VAT numbers and UK accounting packages, which only one of the eleven venue systems reviewed names. Every change to money records who and why, and a refund raises its credit note within 14 days. | Any user can edit an invoice or apply a discount with no trail. ([source](https://hoteltechreport.com/compare/event-temple-vs-splash)) |
| **I. The function sheet** | venue team, hosts and guests | Venue switches, Hosts and guests | 5 / 4 / 4 | Menus, drinks packages, equipment orders and timings live on the event. Final numbers close on the caterer’s own cut-off, with a change log after it. Each department (kitchen, bar, AV, hallkeeper and the outside caterer) sees its own version, knows when it is out of date and acknowledges a change in one tap. A number changed once changes everywhere it appears. Sheets are marked done, distributed and revised with every version kept, editing a signed sheet starts a new version for re-signing instead of erasing the signatures, the week’s sheets print in one batch, and a livery dinner’s toasts and running order print as the toastmaster’s cue sheet. | Event order formatting is rigid, and changing guest numbers means editing many places. ([source](https://a2is.com/catalog/event-management-software/priava/reviews-priava)) |
| **J. Floor plans and seating** | venue team, hosts and guests, planners and attendees | Hosts and guests | 7 / 6 / 2 | Keep what leads: the 3D planner in the real room, phases over time and review with presence. Add named seating on that plan: drag guests from the list to seats, flag accessible seats, seat society and livery dinners by precedence with a head table and sprigs, print the table plan and place cards, and share a view-only plan with suppliers. Late replies move into the plan on their own, so nobody re-types a seating chart. | Late registrants do not appear in the layout and must be added by hand. ([source](https://www.capterra.com/p/10021770/Cvent-Event-Diagramming/?page=2)) |
| **K. The day itself** | venue team | Venue switches | 11 / 5 / 2 | Keep the Day Board, hallkeeper sheet, observations, requests and Mission Control. Add tasks assigned to named people, real supplier arrival windows, a close of night with a room passport and a signed show report, extras agreed on the night flowing to the final invoice, and hours worked against the rota. | There is no link to staff scheduling, so the rota lives somewhere else. ([source](https://a2is.com/catalog/event-management-software/priava/reviews-priava)) |
| **L. Suppliers** | venue team | Venue switches | 1 / 2 / 3 | Finish the supplier pass that is already built: issued from the event, with a mandatory expiry and one-tap revoke (the doors work now in review). Add a supplier book with contacts, insurance and risk documents that remind before they expire, preferred lists and commissions, and give each supplier the venue’s own to-scale plan and their timings, nothing more. | When a venue has no to-scale plan, every planner redraws the room themselves. ([source](https://aisleplanner.com/samantha-joders-top-layout-guest-seating-tool-tips-0/)) |
| **M. The client’s hub** | hosts and guests, venue team | Hosts and guests | 6 / 1 / 3 | One client hub, opened by a named link with no account needed: the proposal, the signed agreement, payments and receipts, documents, the living timetable, the guest list and seating, requests and two-way messages with the house. Each client sees only their own event, proven by a test that fails on any leak. | Client messages sometimes appear in another client’s portal. ([source](https://www.trustpilot.com/review/planningpod.com)) |
| **N. Messages and email** | venue team, hosts and guests, planners and attendees | Venue switches, Hosts and guests | 4 / 3 / 7 | Send from the venue’s own verified domain in the seller’s name. Replies and new enquiries come back in, and every message, call and note sits on the person and the event. Templates the venue edits, reminders for numbers and deposits that respect quiet hours, a delivery log anyone can read, texts for the day itself, and a daily digest instead of a flood. | Messages sent through the platform land in clients’ spam, clients reply outside it, and threads fragment. ([source](https://www.capterra.com/reviews/118047/Tripleseat)) |
| **O. Reports** | venue team | Venue switches | 1 / 2 / 4 | Revenue booked, forecast and paid by month, room and source; occupancy; conversion and win and loss. Every figure opens to its rows and ties to the accounting push. Saved views, date ranges, CSV and PDF export and a weekly digest. Figures appear in groups of five or more and never rank individual staff. | Reporting is the most-cited weak area: filters, Excel exports and custom reports. ([source](https://hoteltechreport.com/compare/event-temple-vs-splash)) |
| **P. Switching day and the open door** | venue team, planners and attendees | Venue switches, Tickets and conferences | 2 / 2 / 4 | An import that reads Salesforce, Delphi, Tripleseat and spreadsheet exports, shows a dry run with every clash and a forward value that matches the old system’s own report to the penny, then binds each booking to its event. Planners’ exports from Eventbrite, Tito, Swoogo, Bizzabo and Cvent arrive the same way. Everything leaves on any day as CSV, JSON and calendar feeds, with a public API, webhooks and Zapier later. | A plan that looked monthly was a 12-month contract, and the customer was billed for the rest after cancelling. ([source](https://www.trustpilot.com/review/tripleseat.com)) |
| **Q. Team, privacy and platform** | venue team | Venue switches, Every venue | 5 / 8 / 5 | Venue admins invite, re-role and remove their own colleagues; an audit trail authorised people can read; the retention, export and erasure the privacy policy promises; and a public venue list trimmed to public facts. Later come self-serve sign-up and billing, single sign-on and groups of venues. | Onboarding is measured in years, not weeks. ([source](https://capterra.com/p/2403/Momentus-Technologies/reviews/?page=2)) |
| **R. Guests, tickets and arrival** | hosts and guests, planners and attendees | Hosts and guests, Tickets and conferences | 0 / 1 / 6 | Wave 2 builds what the venue must own: the guest list with households, invitations and RSVPs on a page that shows the real room, meal choices, diets and access needs asked of each guest with their own consent after a signed DPIA, the guarantee against the caterer’s cut-off, and an offline door list. Wave 3 adds table sales where each host names their guests and meals, ticketing with every fee in the first price, conference registration, sessions, badges and check-in, and imports from planners’ own tools. | A host had 132 replies but 108 guests on a count billed automatically, about $2,000 wasted. ([source](https://www.weddingwire.com/wedding-forums/no-shows-and-early-departures/6a89ef0f1d14a12b.html)) |
| **S. Drafting and intelligence** | venue team, hosts and guests, planners and attendees | ongoing | 0 / 1 / 1 | Drafts for replies, proposals, function-sheet wording and guest messages; summaries of long threads; what changed since you last looked; an incoming RFP read into a structured enquiry. Every draft shows its sources, a person reads the exact words and sends, and AI never states availability, price, capacity or safety unless the figure comes from the record. It stays off until the privacy notice names the processor. | AI-drafted replies can say a room is free when the venue’s real calendar sits in another system. ([source](https://g2.com/products/perfect-venue/reviews)) |
| **T. Showing the venue** | venue team, hosts and guests | Every venue | 3 / 1 / 1 | The panorama tour now, and the captured room when your splat hold lifts. Proposals, guest pages and attendee pages open in the real room, brochures are generated from the record, and from venue two each venue gets its own site. | Venues that had closed or lost their wedding licence were still listed. ([source](https://www.trustpilot.com/review/bridebook.com?stars=1)) |
| **Z. What only Venviewer does** | venue team, hosts and guests, planners and attendees | ongoing | 10 / 2 / 0 | Keep and extend one event record for every booking, the living timetable, the Day Board with observations and request escalation, layout review with presence, supplier passes, Martyn’s Law prompts and the captured room. Each new spine hangs from them rather than beside them. |  |

## 8. The all-day standard

No study shows that a palette or a layout prevents fatigue across a long day. What reliably helps is task-level: fast responses, few interruptions, undo instead of warnings, never losing work, control over your own workspace, real progress and a day that can end. The standard measures those and treats beauty as required but never enough on its own. It is written for eight-hour days with ten-hour days still comfortable, and nothing in it encourages longer ones. Each check names its threshold and how it is verified.

**Eyes.** comfortable reading all day

| Check | Rule | Threshold | Verified by |
|---|---|---|---|
| EYE-1 | Text-dense working screens default to dark ink on a light, warm ground; a dark theme is offered, never forced. | Every staff and client page whose main content is text or tables renders dark ink on ivory by default; a dark theme exists and is reachable in 2 interactions; neither theme uses pure #000 text on pure #FFF. | Checked in CI |
| EYE-2 | Every piece of text clears a contrast floor, and long reading is softer than the floor and kinder than the maximum. | All text at least 4.5:1 (3:1 only for display sizes 24 px or larger); text blocks of three or more lines at least 7:1 on client pages (house rule) but not above 15:1; the copper accent is display-size only. | Checked in CI |
| EYE-3 | Working text is never small: names, facts and numbers a person decides on are at least 14 px, and nothing readable is under 12 px. | Computed font size of body, table cells, row meta and form fields at least 14 px; any other readable text at least 12 px; only decorative eyebrows may be 11 px, and then must be 7:1; no text under 11 px anywhere. | Checked in CI |
| EYE-4 | Prose has a comfortable measure and leading; tables and ledgers have row rhythm instead. | Any paragraph of three or more lines is 45-80 characters wide with line-height at least 1.5 and left-aligned; dense table rows have at least 8 px vertical padding at 14 px text. | Checked in CI |
| EYE-5 | Every column of money, dates, quantities and times uses aligned (tabular) numerals. | 100 percent of numeric table cells, totals, counters and timers compute font-variant-numeric to tabular-nums (or a font whose default figures are tabular) and right-align decimals; counts that tick do not shift neighbouring text. | Checked in CI |
| EYE-6 | Large areas are low-saturation warm neutrals; saturation is spent on state, and state never rests on colour alone. | Every status distinguishes by word or icon plus hue (zero colour-only statuses); screenshots in greyscale and under deuteranopia/protanopia simulation keep all statuses distinguishable; no more than 10 percent of screen pixels exceed the saturation of the copper accent. | Checked in CI |

**Mind.** nothing to remember, nothing to decode

| Check | Rule | Threshold | Verified by |
|---|---|---|---|
| MIND-1 | A decision never depends on a fact the person must remember from another screen. | For each of the 10 top tasks, every datum needed to take the primary action is visible on the screen that holds the action; in a moderated walkthrough, back-navigations made only to look something up equal 0; no more than 4 ungrouped new items need comparing at once. | Tested with people |
| MIND-2 | Each screen state has one obvious primary action, in the same place every time. | Exactly one primary-styled action per view state, at a fixed position per page type; at most 7 top-level navigation items per role; no control relocates between visits. | Checked in CI |
| MIND-3 | Reveal detail in two levels at most, never hide what an expert uses often, and keep everything findable by search. | Any field or action used in more than 20 percent of observed tasks sits on level one; disclosure depth is at most 2; every hidden item is reachable through Find (Ctrl/Cmd+K) in two keystrokes; 'show all' is one tap on each role's home. | Expert review |
| MIND-4 | State is always spoken in words with who and when, and missing evidence is shown as a gap, never as reassuring colour. | 100 percent of records in lists and detail show a status word plus the time of last change; zero icon-only statuses; zero green states without a named human check (fixture test over the status mapping); every figure on ops and client surfaces opens to who stated it and when. | Checked in CI |
| MIND-5 | The product speaks the trade's language, with one glossary and no system words. | UI strings pass a lint against a banned list (hash, snapshot, handoff vN, pencil, ink, prospect, ladder position) and a glossary of approved nouns; in a moderated test, zero participants ask what a word means or misuse a term. | Checked in CI |

**Attention.** interruptions earned, work never lost

| Check | Rule | Threshold | Verified by |
|---|---|---|---|
| ATT-1 | Nothing interrupts typing or a dirty draft; non-urgent notices wait for a task boundary or a batch. | Zero modals, toasts or focus steals while any field has focus or a draft is dirty (Playwright focus-theft test); non-urgent items arrive in at most 3 digests per day, user-adjustable; urgent safety items bypass and are the only exception. | Checked in CI |
| ATT-2 | Each role has a stated daily budget of unsolicited interruptions, and the product reports against it. | Unsolicited in-app interruptions per hour (any sound, banner, modal or focus change the user did not request): at most 2 for sales and finance roles, at most 6 on event days for the duty roles; any rise of more than 20 percent release over release fails the build review. | Measured in use |
| ATT-3 | Coming back is free: the exact place, selection, scroll and unsent words are restored, with a short 'since you left' summary. | After a forced tab reload, a 24-hour absence and a sign-out/in, at least 99 percent of dirty drafts, the open record, the scroll position and the selection are restored (chaos e2e); time from return to first productive action is 10 seconds or less (moderated, median). | Checked in CI |
| ATT-4 | Calm by construction: the periphery informs, the centre is for the task, and one accent colour carries urgency. | No ordinary working screen has continuous motion over 5 seconds without a pause control, no flashes, and at most one numeric attention badge per role home; urgency uses one accent hue; the shared Activity component is the only loading motion. | Checked in CI |
| ATT-5 | Alerts are rare, role-relevant and complete; an alert that is usually ignored is deleted. | Each alert type is acted on in-session at least 50 percent of the time (instrumented; below that it is redesigned or removed); every alert states what changed, who is affected, what is known, who can act and what the choices are; zero sounds without an opt-in; zero repeating chimes. | Measured in use |

**Hands.** instant, keyboard-first and undoable

| Check | Rule | Threshold | Verified by |
|---|---|---|---|
| HAND-1 | The interface answers touch and keys inside a tenth of a second and never shifts under the pointer. | Visible response to a press, key or selection within 100 ms (95 percent of interactions on a mid-range reference laptop and phone); INP p75 at most 200 ms and p95 at most 500 ms on every route; CLS p75 at most 0.1; no element moves within 300 ms before a click lands on it. | Measured in use |
| HAND-2 | Opening a record is near-instant from cache; anything slower shows honest progress with a way out. | List-to-record and record-to-record navigation p75 at most 400 ms on a warm cache and at most 1 s cold; every operation over 1 s uses ActivityStatus with real progress when over 10 s plus cancel; no artificial delays. | Measured in use |
| HAND-3 | Every frequent job has a key, the keys are shown on the buttons, and one palette reaches anything. | 100 percent of the top-20 tasks are completable without a pointer; key hints are visible on every primary button; Find opens in at most 100 ms and returns first results in at most 300 ms; a power user (weekly active, 5+ hours) uses at least one shortcut daily in at least 50 percent of sessions (a target, not a proven norm). | Measured in use |
| HAND-4 | Targets are big enough to hit with a thumb, a glove or a tired hand, and the common ones are the biggest and nearest. | All interactive targets at least 24 by 24 px everywhere (AA) and at least 44 by 44 px on touch layouts; hallkeeper and event-day controls at least 48 px with at least 8 px between; the primary action is the largest target in its region. | Checked in CI |
| HAND-5 | Undo, don't ask: reversible actions just happen and can be undone; confirmation is for external, irreversible commitments and says exactly what will happen. | Every reversible edit has undo for at least 30 seconds (or full history); confirmations appear only for sends, charges, deletes and cancellations and name the recipients and payload; autosave persists a draft within 2 seconds of a pause; a chaos test (kill tab, drop network, mid-edit) loses 0 bytes of committed edits and 0 drafts. | Checked in CI |
| HAND-6 | Nobody types the same fact twice in a chain of work. | In a task walkthrough from enquiry through hold, proposal, contract, invoice and event sheet, the count of re-entered data (names, dates, headcounts, addresses) equals 0; a data field entered once appears everywhere it is needed with its source. | Tested with people |

**Heart.** real progress and work worth signing

| Check | Rule | Threshold | Verified by |
|---|---|---|---|
| HEART-1 | People are in charge: their order, layout and settings stick, and the product never forces a tour or a path. | Filters, sort, density, pane widths and last-used view persist per person; zero unskippable onboarding; moderated: 'I could work in the order I wanted' median at least 6 of 7. | Tested with people |
| HEART-2 | Competence is felt through honest, immediate feedback on the real result, never praise. | Every committed action changes a visible, true state (a count, a stage, a status) within 300 ms; zero congratulatory strings, points or badges in the UI (string lint); SEQ for each top task at least 6.0 of 7 (benchmark average is about 5.5). | Tested with people |
| HEART-3 | Progress is real and visible, and every queue can reach 'nothing else is owed'. | Every queue-like view shows remaining count and a designed empty state; 0 progress indicators not tied to a measurable quantity; at end of day each role can see its owed count (zero, or a named list); moderated: 100 percent of participants can say what is left without searching. | Tested with people |
| HEART-4 | Outputs are artefacts to be proud of: proposals, sheets and portals are designed to be sent unedited, and names go on the work. | A design review of every outbound artefact (proposal, contract, run sheet, portal page, PDF) asks 'would I send this unedited with my name' and passes; moderated: at least 70 percent of staff say they would send the first generated draft with light edits; observed: staff show the screen or output to a colleague unprompted at least once per fortnight. | Tested with people |
| HEART-5 | Design the first minute, the hardest moment and the ending of every task, because those are what are remembered. | Each of first sign-in, a failed save, a sent proposal, a signed contract, a handed-over shift and a closed day has a designed final state (reviewed by Blake); the failed-save state keeps the person's work and says what was saved, sent or accepted; SEQ/TLX collected at those points, not only mid-task. | Expert review |
| HEART-6 | Feel safe, abundant and soft: nothing is irreversible by accident, defaults and templates remove blank pages, and stimuli are gentle. | Error and empty-state copy passes a blameless checklist (what happened, what is safe, what to do; no 'invalid', 'illegal' or 'you failed') enforced by lint; red is reserved for destructive or blocking states; every blank page offers a real starting point; motion on frequent actions is under 300 ms. | Expert review |

**Trust.** no tricks and no surveillance

| Check | Rule | Threshold | Verified by |
|---|---|---|---|
| TRUST-1 | No dark patterns, in the Gray taxonomy or the CMA's sense, and leaving is as easy as joining. | Zero instances in a per-release dark-pattern review against the five Gray categories; cancel, export and delete take no more steps than sign-up; all consents are unticked by default and equally weighted. | Expert review |
| TRUST-2 | No compulsion loops: no streaks, points, badges, variable rewards or colleague leaderboards. | Code and design review finds zero streak counters, points, XP, badges, rankings of staff, scheduled 'daily check-in' rewards or surprise bonuses; a string/component lint forbids streak, leaderboard, points, badge; the session tally (if kept) shows only the person's own count and can be turned off. | Checked in CI |
| TRUST-3 | Measure the product, never the person: no per-worker speed, idle or keystroke metrics visible to anyone. | Telemetry schema review shows zero individually identified productivity metrics exposed to any manager; analytics aggregate to cells of at least 5 people; self-view of one's own session tally is the only per-person metric; the schema is published to staff. | Expert review |
| TRUST-4 | AI drafts and a named person decides; nothing leaves in the venue's name without someone reading the exact words. | 100 percent of outbound sends show exact payload and recipients before sending; 0 auto-sends and 0 auto-confirmations; every AI output is labelled, editable and dismissable in one action; automation-bias watch: if more than 95 percent of AI drafts are accepted with less than 5 seconds of dwell, flag for review. | Measured in use |

**Rhythm.** a start, a flow and an end

| Check | Rule | Threshold | Verified by |
|---|---|---|---|
| RHY-1 | The day starts oriented: in ten seconds, without clicking, a person sees what changed since they left and what matters today. | Moderated: 90 percent of participants state their top three priorities within 10 seconds of landing on their role home; the home needs no click to show 'new since you left'. | Tested with people |
| RHY-2 | Pauses are free: any screen can be left at any moment with nothing lost, nothing times out destructively, and the product never nags about breaks. | Session expiry never discards drafts (verified by e2e); 0 'are you still there' prompts that lose state; 0 break-reminder nags by default (an optional, silent, user-set eye-break cue is allowed); a user can leave mid-edit at any point and return to an identical state. | Checked in CI |
| RHY-3 | The day can end: a designed 'nothing else is owed today' state, a clean handover, and no after-hours pull by default. | Every role has a day-closed state listing what is owed (zero, or named items with owners); default notification quiet hours; the product never encourages overtime (no 'one more' prompts); moderated end-of-day: 'I know nothing else is owed' at least 6 of 7. Design for eight working hours with graceful ten-hour days, not a ten-hour norm. | Diary study |

**Night.** kind to the hallkeeper at 1 a.m.

| Check | Rule | Threshold | Verified by |
|---|---|---|---|
| NIGHT-1 | At night the same screens remain legible without bleaching night-adapted eyes: a low-luminance theme with larger, higher-contrast small text. | A night theme exists, selectable and by time of day or system setting; text under 16 px measures at least 7:1 in night theme; night text is never pure white; large background fields stay at relative luminance of 0.05 or below; night type is at least 1 px larger than day for sub-16 px text (inferred target). | Checked in CI |
| NIGHT-2 | Light and sound discipline in the dark: no bright flash between screens, no sound or vibration unless asked, nothing that wakes a room. | In night theme the mean relative luminance of first paint and of every route-change frame is 0.05 or below (screenshot capture at route load); 0 audio plays without an explicit user gesture or opt-in; 0 haptic calls without opt-in. | Checked in CI |

**Access.** works for everyone

| Check | Rule | Threshold | Verified by |
|---|---|---|---|
| ACC-1 | Reduced motion gives the same information and the same finished composition with nothing moving. | With prefers-reduced-motion emulated, no element runs a CSS animation or transform transition on any route (automated), and every status that was conveyed by motion is conveyed by static text or shape. | Checked in CI |
| ACC-2 | Focus is always visible, never hidden, and follows a sensible order. | Zero axe-core violations on key routes; the ring measures at least 3:1 on every ground; tab order matches visual order on all top-20 task pages; a focused control is never covered by a sticky header or panel. | Checked in CI |
| ACC-3 | Text scales and layouts reflow without losing function, because some staff need 200 percent text. | No horizontal scroll at 320 CSS px for non-spatial pages; no clipped or overlapping content at 200 percent text zoom or WCAG text-spacing overrides; 3D planner has a documented non-3D alternative. | Checked in CI |

**Ahead.** ten years ahead, tested

| Check | Rule | Threshold | Verified by |
|---|---|---|---|
| AHEAD-1 | Local-first speed: reads and edits apply instantly on the device, sync in the background, and work offline. | With the network cut, the top-10 read and edit tasks continue and reconcile with visible, human-worded conflict handling on reconnect; reversible edits complete locally in 100 ms or less; sync convergence p95 at most 2 s on a good connection. | Checked in CI |
| AHEAD-2 | The real hall is the canvas: any decision can be seen in the room in one step, with consistent spatial orientation. | From any booking, hold or proposal, 'see it in the room' is 1 click and first frame within 2 seconds on the declared reference phone and laptop; moderated A/B shows task accuracy on a seating or capacity question at least as high with the room view as without. | Tested with people |
| AHEAD-3 | Adaptivity is opt-in, explainable and accurate; density is the user's choice; core navigation never rearranges itself. | A density control (comfortable and compact) persists per person; adaptive suggestions are labelled and can be disabled; suggestions with acceptance below 60 percent over a month are switched off automatically; core navigation order is fixed. | Measured in use |
| AHEAD-4 | Ten years ahead is judged by veterans choosing: a blind comparison against their present tools and the best non-industry software. | SUS at least 80 and UMUX-Lite at least 80 after 8 weeks of real use; in blind pairwise sessions on identical tasks, at least 75 percent of 12 experienced venue staff say they would rather use Venviewer all day than Salesforce, Cvent or their present spreadsheet; no sample under 8 is reported as a rate. | Tested with people |

## 9. The order

Each wave ends on real work at Trades Hall, judged by the people who do it. Tracks inside a wave run in parallel where they share no files, and merges still land one at a time through the chief of staff.

### Wave 1: The venue runs its whole book here

- The People Book: organisations, people and households you can edit and merge, consent, one timeline, and the 24-month retention the privacy policy promises
- The yes that sticks: agreement, online signature, deposit, and the date confirmed in one tap
- Invoices and credit notes with the right VAT, pushed to the venue’s own accounting system
- One inbox: the venue’s own sending domain, replies and new enquiries in, Cvent RFPs by Lead Catcher email, calls logged in fifteen seconds
- The function sheet: menus, drinks, equipment, timings, and final numbers with a change log, for each department
- Switching day: an import with a penny-level dry run, everything exportable on any day, calendar feeds
- The 39 jobs built but out of reach, starting with pricing by season and time, event editing and task assignment
- The all-day standard as code: checks in CI, a night theme, a density choice and a day that ends

**Proves it when** one real Trades Hall booking runs end to end in Venviewer from enquiry to the close of the night, finance reconciles a month to the penny against the old system and the bank, and the sales lead has not opened the old diary for four weeks.

### Wave 2: Hosts and guests on the real room

- The guest list with households, plus-ones and children; invitations and RSVPs on a page that shows the real room
- Meal choices, diets and access needs asked of each guest with their own consent after a signed DPIA, purged after the event with the counts kept
- Named seating on the captured plan, with precedence, a head table and sprigs for society dinners; table plans and place cards to print
- The guarantee against the caterer’s cut-off, with a change log the kitchen acknowledges
- The client hub behind one door, and an offline door list for arrival
- Imports from Zola, Joy, Bridebook, RSVPify and spreadsheets

**Proves it when** a real wedding or dinner at Trades Hall reaches the caterer and the hallkeeper with no re-typing, and the caterer confirms the counts matched what was served.

### Wave 3: Tickets, tables and conferences

- Table sales where each table host names their guests and each guest’s meal through their own link
- Ticketing with member and guest prices, every mandatory fee in the first price, waitlists and refunds on the venue’s terms, paid into the organiser’s own account
- Conference registration: ticket types, sessions and agenda, group bookings, badges and offline check-in
- An attendee page with the agenda and wayfinding in the real room
- Imports from Eventbrite, Tito, Ticket Tailor, Swoogo, Bizzabo and Cvent for planners who keep their own tools
- Martyn’s Law records for expected attendance and entry, ready before the duties start (expected spring 2027)

**Proves it when** one ticketed society dinner is sold, seated, checked in and paid out at Trades Hall with every fee shown up front, and one conference day runs from registration to the door with no re-typing.

### Wave 4: Every enquiry, every venue

- Replies to Cvent RFPs from Venviewer through Cvent’s two-way proposal API, and enquiries from Hire Space, Tagvenue, Bridebook and Hitched where their terms allow
- Self-serve sign-up and billing for venues, single sign-on, and groups of venues
- A public API, webhooks and Zapier
- A site for each venue, and room-block links to partner hotels

**Proves it when** a second venue goes live with no change to the product’s code, and its team switches within a week.

## 10. Scenes the build is judged against

These are the moments the build is judged against. They describe the target, not what exists today, and the names and figures are illustrative.

- **Tuesday 09:04, The enquiry that arrives answered.** A society secretary asks for 12 March, 180 for dinner. Before Moira opens it, Venviewer has found last year’s dinner for the same society, checked the Grand Hall for that night (a first option is held until 14 November), priced it from this year’s rate card with each figure’s source, and drafted a reply in Moira’s voice. She changes one line and sends it from the venue’s own address. The secretary’s link opens the Grand Hall with last year’s layout already set.
- **Tuesday 15:20, The yes that sticks.** The secretary accepts. One page shows the exact version, the venue’s terms and the deposit due. She signs and pays the venue directly by bank. Moira sees the date ready and confirms it in one tap, the second-option holder hears at once and kindly, and the invoice appears in the venue’s accounting system with the right VAT. Nobody re-types anything.
- **Friday 12:00, Final numbers without a phone call.** Final numbers close at noon on the caterer’s rule. The host’s guest list has already become counts: 176 guests, 14 vegetarian, two nut allergies at table 7. A late change after the cut-off shows on the change log, the kitchen sheet moves to version 9, and the caterer acknowledges it in one tap.
- **Saturday 18:30, Names on the real tables.** The host has placed every guest on the actual tables in the captured Grand Hall, with the head table and sprigs set by precedence. Place cards and the table plan print from the same record. At the door two staff work an offline list with table and diet flags. It records who has arrived and is never presented as a safety count.
- **Thursday 19:00, A table sold, then named.** A livery company sells its annual dinner by the table. Each table host pays once, then names their nine guests and each guest’s meal through their own link before the caterer’s cut-off. Every fee is in the first price shown, and the money lands in the organiser’s own account.
- **Monday 17:40, A day that ends.** Moira opened the day to three things owed: reply to the Hendersons, confirm Saturday’s numbers, approve the Saloon layout. She worked through them from the keyboard, and each finished item settled into her own list of what she did today. At 17:40 the screen says nothing else is owed today. It never flashed, never ranked her and never asked her to stay.
- **Switching day, The old book moves in.** The venue exports from its old system. Venviewer shows a dry run: 1,204 bookings, three clashes, and a forward value that matches the old system’s own report to the penny. The office settles the three clashes, the old diary stays read-only for a week as the fallback, and every booking now sits on one event record.

## 11. Decisions only Blake can make

Four decisions are asked now, as buttons in our conversation. The rest are asked when the piece they belong to is designed, so you decide each with that piece in front of you.

1. **Do you approve the map, and which piece do we build first?** Nothing is built until you approve. Each first-build option is part of wave 1 and no other session owns it. *Recommendation:* Approve, and build the People Book first. It serves both sides, carries out the retention promise the privacy policy already makes, and the agreement, the inbox and the guest list all attach to it.
2. **What does Trades Hall run its bookings on today?** It decides which importer, accounting link and mail link come first, and what switching day reconciles against. *Recommendation:* Tell me what you know; anything unknown goes on the setup sitting’s list for the office to answer.
3. **When a rule is met, does Venviewer act by itself or wait for one tap?** A deposit lands, a hold reaches its decision date, an RSVP arrives. The 16 October principle was that nothing confirms or releases itself. The standard’s TRUST-4 check currently says zero automatic sends; your answer sets its final wording. *Recommendation:* Templates a person approved once send by themselves (receipts, RSVP and ticket confirmations, reminders inside quiet hours). Anything that changes a booking or money (confirming a date, releasing a hold, a refund) waits for one tap by a named person, who sees it ready with the reason.
4. **Shall I draft the guest-data impact assessment now, for the venue to sign?** Wave 2 cannot hold a named guest’s diet or access needs without a signed DPIA, and the venue must name its owner. *Recommendation:* Yes. A draft now keeps wave 2 on time; the venue reviews and signs it.

**Asked when that piece is designed**

- **What confirms a booking, how money reaches the venue, who numbers invoices, and whether any fee applies** (When the agreement and payments are designed). *Recommendation:* Signed agreement plus deposit, as a venue setting; the venue’s own Stripe account with direct charges; the accounting system numbers invoices; no fee on client payments for now.
- **Does the inbox replace staff mailboxes for client mail, or sync with them both ways** (When the inbox is designed). *Recommendation:* Send from the venue’s own domain and capture replies there, with copies from staff mailboxes; two-way sync only if staff still live in Outlook after a measured month.
- **Whose record a guest is, and whether one person spans several venues** (When the People Book is designed). *Recommendation:* A guest belongs to their event: held only to run it, never in the client book or marketing, purged after it with the counts kept; each venue keeps its own records, and only a person’s own sign-in spans venues.
- **Other companies’ audiences, gift registries, hotel systems and live streams: link or build** (Before wave 4). *Recommendation:* Take marketplace enquiries into the inbox and link to the rest; a marketplace needs many venues first.
- **Who measures the working day** (Before the baseline week on today’s tools). *Recommendation:* An independent UX researcher for the baseline week and the comparison at week eight.

**Calls made in this document** (for Blake to check)

- The import starts with spreadsheets and a mapping screen, proven on Trades Hall’s own export; named importers for Salesforce, Delphi and Tripleseat follow the venues that use them. Switching day reconciles against the record the venue trusts: the old system’s own report where one exists, otherwise its accounts and the bank.
- Food and drink work both ways: priced menus on the venue’s quote when the venue resells, or counts and commission only when the caterer bills the client. Trades Hall’s answer sets its default.
- The standard’s automated checks block a merge on any screen a build touches; the measured and people-tested checks judge each wave’s proof and never block a merge on their own.
- Working offline comes first to floor roles after a two-phone signal walk at Trades Hall. Desk roles get instant local updates instead. Every new record is written as a command that can be safely retried, so an offline outbox can be added without redesign.
- A wave’s build may start before the previous wave is proved; proofs decide acceptance, not starts. Moving today’s client records into the People Book lands before the public release.
- Who owns each piece of work is visible for handover and cover. Each person sees their own numbers. Revenue by owner is visible to admins for commission and is never ranked. Speed figures for a person are shown only to that person.
- The twenty everyday jobs the standard is measured on: log an enquiry, reply to it, check a date across rooms, place a hold, move a hold, build and send a proposal, record an agreement, record a deposit, ink a booking, find a client and their history, log a call or note, update final numbers, change a function-sheet line, approve a layout, issue a supplier pass, read the Day Board, record a room observation, answer a request, raise an invoice or credit note, and close the night.

<!--/GENERATED-SECTIONS-->

## 12. What Trades Hall must supply, and what is left to the builder

**Inputs from the venue** (facts, not decisions; each blocks only the build named):

| Input | Needed before | Why |
|---|---|---|
| The VAT position: registered, opted to tax the hall or not, and how weddings are treated | Invoices (wave 1) | HMRC Notice 742: a plain hall hire is normally an exempt licence to occupy unless opted to tax, while wedding facilities and hires the venue caters are standard-rated |
| The venue's terms and cancellation scale, reviewed by its solicitor | Agreements (wave 1) | The CMA's 2016 letter to wedding venues: a deposit should be a small reservation fee, and cancellation charges should reflect the net loss after a re-let |
| Each partner caterer's final-numbers cut-off and change rule (Regis Banqueting, Top Class Catering) | Function sheet (wave 1) | The guarantee and change log are built on the caterer's own rule |
| A sample export from the current diary and client records | Switching day (wave 1) | The importer is proven on the venue's real file, not a guess |
| The accounting package and who administers it | Invoices (wave 1) | Xero, Sage and QuickBooks differ in idempotency and limits |
| Access to the venue's email domain settings | One inbox (wave 1) | Sending from the venue's own domain needs DNS records |
| A named owner for the guest-data DPIA | Wave 2 | Named diets and access needs are special category data |

**Left to the builder** (decide within the constraints in section 4 and the standard in section 8):

- Table design for each new spine, including how today's `client_accounts`, `contacts` and `guest_leads`
  migrate into the people record without losing history, and how roles per event are modelled.
- Migration numbers (fixed at merge through the chief of staff), library versions (from the lockfile and
  current official documentation), and how wave 1 splits into parallel tracks that touch different files.
- Field mappings for imports, starting from the extracted references: Salesforce standard objects
  (`research/r1-salesforce-objfields.json`), OPERA's block-event CSV columns (r1), Tripleseat, Event Temple
  and iVvy fields (r2), and Eventbrite, Tito, Swoogo and Ticket Tailor objects (r4).
- Exact screens and copy within the house register (`packages/web/src/styles/house-tokens.css`) and the
  all-day standard. Blake judges the look; the standard's checks judge the rest.
- Tests at the boundary that owns each guarantee: disposable PostgreSQL for the people, money and import
  spines; route tests for every role gate; a cross-client leak test as a release gate for every door; and
  the standard's CI checks on every surface a build touches.

## 13. Evidence and method

- **Code.** A read-only snapshot of origin/master `cc9e8e4d` traced 275 jobs from screen to route to table,
  every cited file and line machine-checked (`D:/claude/replacement-map-20261017/coverage-cc9e8e4d.md` and
  `.json`). Two headline claims were re-checked by hand on 18 October (the public venue list and the
  unbuilt retention). Merges #109, #110 and #121 landed afterwards and are noted, not re-traced.
- **Research.** Seven files written on 18 October from public API references, help centres, published
  guides, user reviews and UK primary sources (`D:/claude/replacement-map-20261017/research/`): r1 Salesforce,
  Delphi and OPERA; r2 the venue sales-and-catering systems; r3 Cvent's sourcing and hospitality tools,
  including its public OpenAPI file; r4 registration and ticketing; r5 hosts and private events; r6 the
  all-day standard; r7 money, contracts and VAT. They extend the 16 October research (21 roles, 27 products,
  95 sources). Per-family dossiers joining the research to the coverage are in `dossiers/`.
- **Limits.** Nobody at Trades Hall was consulted for this map. G2, Capterra, TrustRadius and Reddit blocked
  direct reads for several agents and the shared search budget ran out late in the run, so some review
  themes are secondary and marked as such in the files. The standard's thresholds are targets until a real
  working day is measured. Legal and tax points are informed reading, not advice: a solicitor and an
  accountant confirm each before money moves.
- **What would prove the map right.** Each wave's proof in section 9, measured by the people who do the
  work, and the working-day measurement in the standard, run by someone who is neither Blake nor an agent.
