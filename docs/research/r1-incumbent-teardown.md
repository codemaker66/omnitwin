# Incumbent Teardown: Venue & Event-Management Software — Holds, Option Ladders, BEOs & the "Stale Calendar" Problem

## TL;DR
- **The Option Ladder is real but concentrated at the high end.** Only the conference-center/arena-heritage platforms — Momentus (Ungerboeck) and, to a lesser degree, iVvy — implement structured, sequenced holds ("hold rank," Option 1 / Option 2, avails, challenge-and-release). Every SMB/mid-market tool (Tripleseat, Perfect Venue, Planning Pod, Event Temple, Caterease) and every UK community-hall tool (Hallmaster, BookingsGuru/Plus, Skedda) collapses "holds" into a single flat "tentative/provisional/hold" state with no ranking and no automatic challenge workflow. This is a genuine product gap in the mid-market.
- **The "stale calendar" problem is universal and under-served.** Planning Pod is the only mainstream SMB tool that ships hold deadline dates + expiry reminders; most others rely on manual cleanup, and users complain about calendar-sync failures (Google/Outlook), tentatives clogging diaries, and double-booking risk. Even Momentus users manage staleness through a manual "Manage Holds by Day" slider rather than true auto-expiry.
- **Load-bearing conventions to keep:** the tentative→definite→lost/cancelled status spine; the BEO/function-sheet as the operational source of truth; the grid-by-space function diary; conflict detection. **Legacy cruft to break:** un-ranked holds with no expiry, manual hold cleanup, un-customizable status vocabularies (Tripleseat), dated desktop UIs (Caterease), and brittle external calendar sync.

## Key Findings

### The vocabulary actually used (glossary to "steal")
Across vendors, a consistent but not identical lexicon emerged. The terms with the most proven traction:
- **Prospect** — a qualified lead with booked spaces that does NOT block space and can overlap other prospects (Tripleseat, Momentus, Caterease).
- **Tentative** — a hold that DOES block space and conflict-checks (near-universal).
- **Definite** — confirmed/contracted (near-universal; Tripleseat, Momentus, Event Temple, iVvy, Caterease).
- **Inquiry / Enquiry** — pre-space lead, often from a web form (Momentus "Inquiry"; iVvy "enquiry"; UK tools "booking request").
- **Hold rank / Option (H1, Option 1, Option 2)** — sequenced priority on the same space/date (Momentus; concert-industry tools).
- **Avails** — availability list sent to promoters/agents that shows holds but masks names (Momentus, concert industry).
- **Provisional booking** — the UK community-hall term for tentative (Hallmaster, BookingsGuru, Skedda-in-Outlook).
- **Date challenge / challenge-and-release** — the workflow where a lower hold forces the top hold to confirm or release within 24–48h (concert/hospitality industry standard; formalized in Momentus).
- **Decision date / hold deadline** — the expiry date on a hold (Planning Pod uses "hold deadline"; industry uses "decision date").
- **Right of first refusal / first option, second option, joint first** — the hospitality/UK phrasing for the hold queue. (Industry note: post-pandemic demand pushed many UK venues from "First & Second Options" to a "Joint First Option / Shared First Option" basis — worth mirroring in vocabulary.)

### Special Question 1 — Does anyone do Option Ladders / date-challenges well?
**Yes: Momentus (Ungerboeck) Elite is the reference implementation.** Its "Tentative" status is not flat — *"Each individual booked space will have a hold rank/option. When an event is booked, the hold rank/option on each booked space will default to the next available rank for that room at that date/time."* The monthly calendar displays the lowest rank for a day, holds appear on **avails** (with names masked), and there's a dedicated **"Manage Holds by Day"** slider plus a **"Confirm and Release Holds"** workflow: confirming one space to Definite lets staff release the competing holds. Momentus also supports "groupings of holds" booked to the "Next Available Tentative" status for tours/series. This is the closest thing to a native option-ladder in commercial venue software, and it is inherited from Ungerboeck's arena/convention-center heritage (NBA venues use it to "hold potential dates and adjust quickly once the league releases the official schedule"). Scale underscores the pedigree: per Momentus, *"More than 85% of the largest convention centers in the world"* and *"Over 550 stadiums and arenas globally, including more than half of the NFL, NBA, and NHL"* run on the platform, which serves ~4,000 customers across 55+ countries and manages more than 1.5 million events annually.

**iVvy is partial.** Its booking API exposes statuses of Prospective, **Prospective Hold**, Tentative, Confirmed, and Ordering — so it has a distinct "hold" concept beyond plain tentative — and it markets a CRM that "clearly shows tentative, hold, and confirmed stages." But there is no evidence of automatic sequenced ranking (H1/H2) or an automated challenge/release engine; iVvy leans on escalation emails and RFP workflows instead.

**Everyone else in scope does NOT.** Tripleseat has exactly three space-blocking behaviors (Prospect = non-blocking/overlapping; Tentative = blocks + conflict-checks; Definite) and explicitly *"it is not possible to customize the names or colors of statuses."* No ranking, no challenge. Planning Pod has holds with deadline dates and reminders but no queue/rank. Perfect Venue and Event Temple have flat status pipelines. Community-hall tools (Hallmaster, BookingsGuru, Skedda) have a binary provisional/requested → confirmed model. Notably, the venues that need option-ladders most (music venues) buy **purpose-built niche tools** — holdscalendar.com and Patchboard — precisely because mainstream event software doesn't manage the "1H/2H, challenge, auto-shuffle 2H→1H" workflow. That confirms the white space. The manual ladder is also codified in venue-side policies (e.g., The GRAND permits up to four holds — First/Second/Third/Fourth — each holding sequential "right of refusal," 14-day expiry, and a pre-signed-contract challenge that forces the hold ahead to confirm or release within two business days).

**Verdict on the gap:** The Option Ladder is a solved problem only for enterprises that can afford Momentus. In the entire SMB/mid-market segment it is genuinely absent — teams simulate it with color codes, notes, and manual emails. A mid-market tool that shipped ranked holds + automatic challenge/expiry with clean vocabulary ("1st option / 2nd option / decision date / challenge") would be differentiated.

### Special Question 2 — The "stale calendar" problem
User and industry evidence confirms this is real and painful:
- Manual re-sequencing is the core pain: with generic calendars *"Every time you release a date you have to update all the holds behind from 2H to 1H, 3H to 2H, etc."* (Patchboard, describing why venues abandon Google Calendar).
- Holds that never expire: industry guidance repeatedly warns *"Don't let tentative holds linger indefinitely"* and recommends written expiry + challenge policies — implying most operators lack them.
- Calendar-sync failures are a recurring complaint. Planning Pod reviewers: *"the calendar sync does not work properly, which makes it useless for scheduling appointments."*
- Double-booking anxiety drives tool purchases across every platform's marketing ("prevent double bookings" is near-universal copy), which signals the underlying fear is widespread.

**Vendor features that fight staleness:**
- **Planning Pod:** hold deadline dates + auto-reminders to staff and leads when a hold nears expiry — the best SMB anti-staleness feature found.
- **iVvy:** automatic-cancellation of tentative bookings on payment deadline (in some product lines), escalation emails at 24/36h, and a marketplace no-reply after 48h.
- **Momentus:** "Manage Holds by Day" cleanup slider, "Open Tentative" dashboard panel, and lost/cancelled reasons — but expiry is manual, not automatic.
- **Skedda:** non-blocking requests (multiple people can request the same slot; nothing is held), missed-check-in auto-release, and an activity feed audit trail.
- **UK hall tools:** provisional bookings block the slot and email the hirer, but rely on an admin to confirm/cancel.

The synthesis: nobody in the mainstream mid-market combines (a) ranked holds, (b) automatic expiry, and (c) automatic queue re-sequencing. That trio is the unmet need.

---

## Details — Platform by Platform

### 1. Event Temple
- **(a) Function diary:** Grid-style calendar showing tentative and definite bookings in a single view; pipeline/stage board for leads. Modern, cloud-based; praised as clean but "could be a little more aesthetically pleasing."
- **(b) Holds/options:** Flat statuses — leads carry a "tentative date" and "definite date" plus stage & pipeline. No structured hold rank, no evidence of hold-expiry/decision-date/auto-release in the help center (integrates externally with FIRST-HOLD for live availability). Statuses cannot be deeply sequenced.
- **(c) BEO workflow:** Strong. Customizable BEOs, batch update of service charges, group menu items, workflow reminders. Users praise "Customizable BEO's, easy invoice creation."
- **(d) Client portal:** Document sharing, e-proposals, online payment ("paid 50% faster"), text-to-lead. Mobile app rated weaker ("mobile app isn't as feature rich").
- **(e) Pricing:** Per-user + per-venue, annual billing only with a 1-year minimum, plus an initial setup fee. Vendor publishes no prices on its own site. Third-party estimates (2024–2025): Basic ~$125/mo (2 users; additional users ~$99/mo each), Professional ~$249/mo, Enterprise custom; other listings cite entry as low as ~$99–$109/mo. Treat as estimate; confirm by quote.
- **Complaints:** No accounting/invoice controls (*"any user can edit an invoice/apply a discount without notification… invoices can be deleted, and there's no way to get it back"*); coding errors in the new UI; user-access-level limitations; weak reporting.
- **Praise:** Outstanding, responsive customer support; ease of use; automation/workflows; cost (~half of Tripleseat per some reviewers).

### 2. Tripleseat
- **(a) Function diary:** Color-coded calendar of tentative holds, confirmed events, and available space; syncs to Outlook for chefs. Multi-space. Timeline week view criticized ("only shows you one day").
- **(b) Holds/options:** Three behaviors — **Prospect** (non-blocking, can overlap other prospects, can still send docs/take payment), **Tentative** (blocks space, conflict-checks), **Definite**. Statuses and colors are NOT customizable. No hold rank, no challenge/expiry.
- **(c) BEO workflow:** Best-in-class for restaurants. Duplicate/layout editor, internal vs guest BEOs, kitchen sheets, picklists, live documents that auto-update across all docs, real-time guest-portal versions ("days of emailing multiple versions of a Word document are over"), internal notes visible only on chef BEO.
- **(d) Client portal:** Guest Portal with live docs, messaging/chat log, card-on-file authorization, 24/7 payments, view/sign. Strong.
- **(e) Pricing:** Unpublished; quote-based, per the vendor. Widely regarded as premium/enterprise-priced; reviewers switch to Perfect Venue citing cost and UX overwhelm.
- **Complaints:** Emails landing in spam; document formatting (line spacing/paragraph breaks lost on paste); occasional bugs/slow support ("it has consistently been slow and we have had service interruptions"); can feel "overwhelming"; mobile inconsistent.
- **Praise:** Centralized comms, double-booking prevention via calendar flags, reporting, responsive support, Tripleseat University onboarding.

### 3. Momentus Technologies (Ungerboeck / Priava)
- **(a) Function diary:** Grid/day/month calendar with room rows; drag horizontally/vertically to book multiple rooms/dates; each space auto-assigned next tentative status and color-coded for conflicts; custom calendar views; publishes to Apple/Google. Setup/teardown handled via space "usages" (bump-in/bump-out).
- **(b) Holds/options — THE reference implementation:** Six statuses (Inquiry, Prospect, Tentative, Definite, Lost, Cancelled). Tentative carries per-space **hold rank / option** defaulting to next available; **avails** show holds with masked names; "Manage Holds by Day" and "Confirm and Release Holds" workflows; hold groupings for tours/series. Renamable to "request/hold/pencil/confirmed." Separate contract-status track (Proposal Created→Sent→Approved→Contract Sent→Signed).
- **(c) BEO workflow:** Event orders, functions, work orders auto-push to operations; room diagramming; change notifications; document capture. Enterprise-grade.
- **(d) Client portal:** Event portal shares full contracted details, functions, orders, move-in/out; Booking Portal add-on for external self-service booking with price schedules and booking-capability limits (max status a user can book). Momentus Pay for branded checkout.
- **(e) Pricing:** Unpublished/enterprise; modular; Priava legacy was a flat-fee cloud model. Serves 85%+ of the world's largest convention centers and 550+ stadiums/arenas; ~4,000 customers across 55+ countries; ~92,000 daily users; 1.5M+ events/year; customers process $19B+ in venue/event revenue annually.
- **Legacy note:** Ungerboeck acquired **Priava** (Nov 2021, cloud, strong in AU/NZ/UK) and ShoWorks; rebranded to Momentus. Priava/EBMS lineage. Priava marketing still emphasizes "create holds for repeat business" and hold-then-confirm "in just a few clicks" (Gray's Inn case study).
- **Complaints:** Some slow support/extra charges for certain issues; complexity/learning curve implied by enterprise scope.
- **Praise:** "Best client support"; single source of truth; handles last-minute schedule changes (NBA); Outlook sync.

### 4. Planning Pod
- **(a) Function diary:** Color-coded booking calendar; day/list/calendar/timeline; syncs to Google/Outlook/Apple/iCal; customizable time/space conflict alerts; embeddable availability calendar/web-form; drag-and-drop lead pipeline.
- **(b) Holds/options — best SMB anti-staleness:** "Put lead dates, times and rooms/spaces on hold… Set hold deadlines and send reminders to staff and leads when a hold is about to expire." Has deadline + reminders but NO rank/queue/challenge.
- **(c) BEO workflow:** BEOs (FOH/kitchen/client/delivery), templated proposals/contracts, triggered workflows. Criticized: "BEO only accepts Food & Bev packages… if you are a company that has rentals, you can do them as line items. This is a design failure."
- **(d) Client portal:** Branded portal to view/sign proposals & contracts, pay invoices (installments), forms/questionnaires. Mixed reviews: "my clients will not use the features available to them because it is too confusing/complicated."
- **(e) Pricing:** Published tiers (per account, not per user); mid-market; "saves 62+ hours/month" marketing. (Exact tier prices vary; confirm on site.)
- **Complaints:** "clunky UI"; steep learning curve/"sooo many glitches"; forced Academy videos; calendar sync failures; email integration "terrible"; comms mis-linking to wrong account; dated interface; weak mobile.
- **Praise:** True all-in-one consolidation; lead pipeline at-a-glance; floor plans; responsive human support.

### 5. iVvy
- **(a) Function diary:** Central function diary showing quoted/tentative/confirmed for both meeting space and sleeping rooms; multi-property/multi-venue cross-sell view ("I oversee 15 venues… makes life much easier when cross-selling"); default setup/pack-down buffer times per space.
- **(b) Holds/options:** Statuses Prospective, **Prospective Hold**, Tentative, Confirmed, Ordering. Distinct "hold" concept and CRM showing "tentative, hold, and confirmed stages," plus escalation emails (24/36h) and marketplace 48h no-reply. No evidence of automatic H1/H2 ranking or challenge engine.
- **(c) BEO workflow:** Version-controlled BEOs + virtual run sheets on tablet/phone, updated in real time. Strong.
- **(d) Client portal:** Branded online booking engine + Marketplace — iVvy: *"With more than 32,000 event organisers searching every month, iVvy gives you global visibility."* E-signature contracts; iVvy Pay (Worldpay) auto-invoicing/reminders.
- **(e) Pricing:** Unpublished (last listed data Sept 2024); mid-market/enterprise; marketplace commission model on Marketplace leads. Reasonably priced per an arts-venue reviewer vs. arts-specific competitors.
- **Complaints:** "occasional small glitch"; learning curve for new staff; limited menu/group-item customization; "no phone call log option"; one harsh outlier: "Terrible system, horrible reporting. Clunky"; a poor mobile/QR booking experience reported by one attendee.
- **Praise:** Customizable, fast proposals/contracts, strong reporting vs peers, 24/7 human support, double-booking prevention across multi-venue.

### 6. Perfect Venue
- **(a) Function diary:** Centralized calendar syncing with Google Calendar; shows all events including leads to avoid double-bookings; multi-venue. Some find "the calendar feature… can be difficult to navigate."
- **(b) Holds/options:** Status pipeline (Lead → Qualified → Proposal Sent → Confirmed → Completed/Lost). "Holding a date" is a manual byproduct of the deposit process — "You may be holding a date for a while before receiving a payment." Availability blocked via a manual note checkbox. No structured hold expiry/auto-release found.
- **(c) BEO workflow:** Auto-generated BEOs & proposals that update as details change; email templates + AI replies; free BEO template marketing. Praised as fast/easy.
- **(d) Client portal:** Express Book (guests check availability, pick menus, submit deposits); e-sign proposals; Stripe payments/refunds. Complaint: "Invoicing… format not friendly. No invoice numbering."
- **(e) Pricing:** Free plan (14-day trial reverts to Free) + "No Subscriptions, No Setup Fees, Unlimited Users and Locations. Just pay credit card processing!" Paid tiers Basic/Professional/Premium/Enterprise, per location: annual ≈ $99 / $199 / $299 (monthly ≈ $139 / $239 / $339); older card sets show $59/$119/$189, and support has quoted "starting at $79/month." Added processing-fee tiers 1.2% / 0.5% / 0.3% / 0% on top of Stripe 2.9%+30¢.
- **Complaints:** Calendar navigation; invoicing format/no numbering; wants QuickBooks/Clover links; customization "could use an upgrade."
- **Praise:** Ease of use ("half the clicks" vs Tripleseat); price/value; migration ("white glove"); Google Calendar sync; fast inquiry response; common landing spot for teams fleeing Tripleseat/Gather migrations.

### 7. Caterease
- **(a) Function diary:** Scheduler with interactive calendars/graphs; color scheme Red=Prospect, Blue=Tentative, Green=Definite (customizable). Desktop-heritage; can "run a bit slow… pulling large queries."
- **(b) Holds/options:** Prospect Manager (separate lead DB) → promote to account; statuses Prospective/Tentative/Definite/Closed/Cancelled; can "book events that are tentative, prospective, and booked… create placeholders." No hold rank/challenge/expiry.
- **(c) BEO workflow:** Deep. FOH + BOH print designers, custom event prints, packing/ingredient lists, merge-field email templates, sub-events/"meals." "From the BEO to the invoice it is all there."
- **(d) Client portal:** Customer Portal to review details, chat, download prints, sign off, and post payments; HPay tokenized payments/DocuSign. Portal seen as dated by some.
- **(e) Pricing:** Positioned as "the world's most popular catering software" with 50,000+ users. Tiered, billed annually, with a one-time setup fee (~$200) and ~$28/mo per extra user. **Sources conflict on the tier numbers:** one review breakdown cites Express/Standard/Professional ≈ $68–$132/mo; a mid-2026 third-party listing cites four tiers — Express $99, Standard $149, Professional $199, Complete $399/mo (with the Complete tier carrying a $200 launch fee per user). Add-ons are charged separately ("nickel-and-dimed"). Cloud + on-prem. Treat exact figures as estimates.
- **Complaints:** "outdated looking and very slow"; "breaks down constantly, hasn't been updated in YEARS, doesn't work on Apple, no app"; tax/global changes not auto-applied event-to-event; add-on fees; steep for small shops.
- **Praise:** Unmatched depth for catering ops; time savings; customizable prints/screens; US-based support.

### 8. Rendezvous (NFS Technology Group)
- **(a) Function diary:** "Colourful and simplistic" diary view; multi-location room booking; catering & AV against bookings; deep Outlook/Exchange integration; floor-plan booking; recurring events. Two product faces: workplace (desk/room, now under Korbyt branding) and **Rendezvous Events** (venue management with MS Dynamics CRM, diary, billing).
- **(b) Holds/options:** Provisional/confirmed model; business rules auto-release no-shows/"ghost meetings." Enquiry handling to ensure none overlooked. No public evidence of ranked option-ladders.
- **(c) BEO/function-sheet:** Venue events module covers contracts, invoicing, operations; function/run sheets implied. Less publicly documented than the F&B-first tools.
- **(d) Client portal:** Self-service portal for staff room/desk booking; web bookings + event registration via API; digital signage/wayfinding.
- **(e) Pricing:** Unpublished (quote via NFS/SoftwareSuggest). Enterprise; historically offered perpetual on-prem + cloud; NFS states its approach "benefits over 1800 clients globally."
- **Complaints:** Some infrequent users "find it hard to remember how to use"; WebEx integration gap noted; a few wanted more cloud hosting regions (e.g., Canada).
- **Praise:** Ease of use/low training curve; excellent support & rollout; multi-location; Rendezvous received a 5.0 rating at Gartner Peer Insights in March 2022 ("Excellent, simple to use desk booking app, implemented quickly and seamlessly").

### 9. Skedda (and AllBooked)
- **(a) Function diary:** Day/map/floor-plan scheduler; per-space; visual real-time availability; buffer time; booking windows; color coding; two-way Microsoft/Google sync.
- **(b) Holds/options — deliberately non-blocking:** Booking Requests & Approvals: "booking requests are non-blocking. Submitting a request doesn't put the space 'on hold'… Multiple people can request the same space and time, and nothing is confirmed until an admin approves one." In Outlook the request shows **Tentative** until approved (then Accepted/Declined). This is the philosophical OPPOSITE of an option-ladder — Skedda intentionally refuses to let requests reserve availability, so admins pick the best-fit request rather than honoring a queue. Missed-check-in auto-release available.
- **(c) BEO workflow:** None to speak of — Skedda is space-scheduling, not F&B event orchestration; no BEO/function-sheet.
- **(d) Client portal:** Self-service booking via subdomain; trusted users; upfront or book-now-pay-later via Stripe; tablet room terminals.
- **(e) Pricing:** Per space, billed annually, unlimited users. Starter $99/mo (15 spaces), Plus $149/mo (20), Premier $199/mo (25); scales with space count (e.g., Plus $249/35, Premier $349/45); Enterprise custom. Visitor Management +$99/mo. **Booking Approvals is Premier-only** (AllBooked equivalent: Advanced plan) — confirmed via both the support docs and the pricing-page feature grid.
- **Complaints:** Reporting/analytics limited without a higher tier; support response times can be slow.
- **Praise:** Clean interface; flexible booking rules; visual floor plans; easy setup; strong for hybrid workplaces/community facilities.

### 10. UK community-hall tools — Hallmaster & BookingsGuru (+ comparables)
- **Hallmaster:** *"The Hallmaster booking system has… been chosen by ACRE (Action with Communities in Rural England) to be promoted as the preferred booking system for Village Halls throughout Scotland and the Rural Community Councils in England"*; used in ~3,000 venues across 9 countries. Public embeddable calendar; **provisional booking** → Booking Officer confirms; privacy modes (Private / Hide Contact Info / Public); multi-room with clash detection (warns you NOT to make one "whole hall" room or you'll get double-bookings); invoicing + payment tracking + accounting exports (QuickBooks/Xero/Sage); heating/access integrations. Tiered pricing from ~£12–15/mo single venue; 90-day free trial; church-hall entry marketing at *"just £2.64 per week."* Praise: cut admin costs (~£2,000/yr claimed), no more double bookings, great support. No option-ladder — binary Requested/Confirmed.
- **BookingsGuru / BookingsPlus:** A managed lettings *service* (a real account-management team handles admin/marketing) built on the BookingsPlus software; targets schools, churches, community venues. Online booking portal, invoicing, payment tracking, configurable T&Cs. More "done-for-you" than self-serve; setup more complex than the simplest tools.
- **Close comparables (for context):** Hallbookingonline (provisional→approve, low-cost), MyHallWizard (colour-coded multi-room calendar + enquiries + one-click invoicing), LemonBooking (booking groups/conditional pricing + website builder), MIDAS (cloud, up to 10 spaces entry), Plinth (charity CRM + room booking). All share the request/provisional→confirm binary; none offers ranked holds or challenge workflows.

---

## Cross-Platform Comparison — Holds / Options / Tentative Handling

| Platform | Non-blocking "lead" state | Blocking hold state | Ranked options (H1/H2) | Auto-expiry / decision date | Challenge/release workflow | Status vocab customizable? |
|---|---|---|---|---|---|---|
| **Momentus** | Inquiry, Prospect | Tentative (per-space **hold rank/option**) | **Yes** | Manual (Manage Holds by Day) | **Yes** (Confirm & Release) | Yes (rename to hold/pencil/etc.) |
| **iVvy** | Prospective | Tentative, **Prospective Hold** | Partial/No | Auto-cancel on payment deadline (some lines) + escalation emails | No | Limited |
| **Planning Pod** | Open Lead | Hold (with **deadline + reminders**) | No | **Yes (hold deadline reminders)** | No | Partial |
| **Tripleseat** | Prospect (overlapping) | Tentative | No | No | No | **No** |
| **Event Temple** | Lead / pipeline stage | Tentative | No | No evidence | No | Rename tentative/prospect/definite |
| **Perfect Venue** | Lead / Qualified | Manual date block | No | No | No | Limited |
| **Caterease** | Prospect | Tentative | No | No | No | Yes (colors/names) |
| **Rendezvous** | Enquiry | Provisional | No | Auto-release no-shows (rules) | No | Config-dependent |
| **Skedda** | Booking request (**non-blocking by design**) | Confirmed only | No (deliberately) | Missed-check-in release | No (chooses best-fit instead) | Limited |
| **Hallmaster / BookingsGuru** | Booking request | Provisional | No | No | No | No |

---

## Recommendations

**If you're validating the Option Ladder as a product wedge — build it; the white space is confirmed.**
1. **Target the mid-market gap first (Tripleseat/Perfect Venue/Planning Pod territory).** These tools have flat holds and their users manually simulate ladders with colors and emails. Ship: (a) ranked holds (1st option / 2nd option / waitlist) per space+date; (b) a **decision date** on every hold with automatic reminders and auto-release; (c) an automatic **challenge** workflow (2nd option triggers a 24–48h ultimatum to 1st option) with auto re-sequencing (2H→1H) on release. This trio exists nowhere in the mid-market.
2. **Steal the proven vocabulary, don't invent.** Use "1st option / 2nd option / joint first" (UK + hospitality), "tentative → definite" (universal spine), "decision date" or "hold deadline" (Planning Pod), "challenge / release" and "avails" (concert industry + Momentus). Avoid coining new terms — operators already know these.
3. **Make the calendar self-cleaning by default.** Every hold must carry an expiry; surface an "aging holds" / "open tentative" report (copy Momentus's "Open Tentative" panel and Planning Pod's reminders). This directly attacks the near-universal "stale calendar" complaint.
4. **Fix external calendar sync as a first-class feature, not an afterthought** — sync failures (Google/Outlook/iCal) are the single most repeated cross-platform complaint (explicit in Planning Pod reviews; implied everywhere).

**Benchmarks / thresholds that would change the plan:**
- If discovery shows target SMB venues rarely field competing holds on the same date (low date-contention), **downgrade the challenge engine** to just expiry + reminders (the Planning Pod model) and compete on UX/price instead.
- If you find Momentus/iVvy moving down-market with ranked holds bundled cheaply, the wedge narrows — pivot to vertical-specific vocab (weddings "provisional/first refusal"; music "1H/2H/avails"; community halls "provisional/confirmed") as the differentiator.
- If a segment (e.g., music venues) already pays for holdscalendar.com/Patchboard, treat that as validated willingness-to-pay and a possible beachhead rather than a competitor to avoid.

**Conventions to KEEP (load-bearing):** tentative→definite→lost/cancelled status spine; separate contract-status track (Momentus's split of booking status vs contract status is elegant); BEO/function sheet as ops source-of-truth with live updates; grid-by-space diary with conflict detection; internal vs client document variants.

**Conventions to BREAK (legacy cruft users complain about):** un-ranked, never-expiring holds; manual hold cleanup; un-customizable status vocab (Tripleseat's rigidity is a named complaint); dated desktop UIs and no-mobile/no-Apple support (Caterease); brittle calendar sync; BEOs that only accept F&B line items (Planning Pod); invoices with no numbering (Perfect Venue).

## Caveats
- **Pricing is volatile and often unpublished.** Tripleseat, iVvy, Momentus, and Rendezvous do not publish prices; Event Temple publishes none on its own site (figures here are third-party estimates from 2024–2025 and are marked as such). Caterease tier figures conflict across sources ($68–$132 vs $99/$149/$199/$399) and are treated as estimates. Perfect Venue and Skedda figures are from live pages but scale with locations/spaces. Verify all pricing with a current quote before relying on it.
- **"No evidence found" ≠ "feature absent."** For Event Temple and Perfect Venue hold-expiry, exhaustive help-center searches surfaced no structured hold-expiry/auto-release feature, but this is absence of evidence, not proof. Confirm in a live demo.
- **Review mining skews positive on vendor-incentivized sites.** Capterra/Software Advice mark incentivized reviews; G2 quotes tend to be the most candid on complaints. Reddit/r/eventprofs threads on option-ladders were dominated by venue-operator and agency guidance (Match My Venue, Ticket Fairy, individual venue policies like The GRAND) rather than software-specific gripes — useful for vocabulary, less so for per-tool sentiment.
- **Momentus = Ungerboeck = Priava.** These are the same vendor post-2021/2022 rebrand; "Momentus Elite" is the current flagship, "Priava" is the legacy cloud product (strong AU/NZ/UK), and help content spans both domains. Treat feature claims from priava.com as current Momentus marketing.
- The concert-venue niche tools (holdscalendar.com, Patchboard) were not in the requested platform list but are the clearest proof of the option-ladder white space and are included for that reason.