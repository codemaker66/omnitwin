---

**If you only read one part**

- **What the team's working life looks like.** A venue sales and events team runs one long promise: a date pencilled, inked, prepared, delivered, settled and remembered. The days themselves are:
  - interrupt-driven triage in the mornings;
  - show-rounds in the evenings and at weekends;
  - deadline-driven preparation, keyed to final numbers and function sheets;
  - event days away from the desk.
- **Where the work breaks today.** Every pain named in the industry research comes from that one promise being split across inboxes, spreadsheets, PDFs, paper and memory. The research names ghosted leads, stale pencils, surprise VAT, radio silence in the long middle, wrong function sheets, missing supplier paperwork and invoices built by hand.
- **What the tool should do.** "Make everyone's life easier" means the tool carries the promise and its deadlines, so people only make decisions. Every closed loop should look and feel closed.
- **What Venviewer already has.** A strong Diary spine (ranked holds with enforced hygiene, ink exclusion, explained conflicts), versioned proposals with client share links, and function-sheet, supplier-pack and event-day machinery.
- **What is missing or unbuilt.**
  - Multi-channel intake with response clocks.
  - UK tax-correct pricing (VAT, minimum spend, service charge, discounts).
  - Contracts, deposits and payments.
  - Client-side final numbers and allergens.
  - Supplier compliance documents.
  - Settlement, feedback and rebooking.
  - Migration from Salesforce, Cvent and spreadsheets.
- **The old look.** The client proposal page and executive analytics are still in the superseded dark style.

---

## 0. Evidence standard

- **Inspected:** repository source and schema cited with paths and line numbers. I also viewed three committed images: the desk capture, the selected Inventory reference and two e2e visual baselines.
- **Prior repo research:** the closed Diary Research Canon v1.5 (`docs/strategy/the-diary-research-canon.md`) and briefs R1–R11 (`docs/research/`). I reuse their sourced domain facts. Their visual language (§18 "Ink & Gilt") is superseded by the 6 September selection in `.claude/conventions/product-experience.md`.
- **Web research this session:** cited inline and listed in §9. Where only a search summary was available (two pages were blocked by the egress proxy), I say so.
- **Inferred:** the working-week rhythm, the Scottish seasonal calendar and some role splits are models to confirm with the Trades Hall team. They are marked as inference.
- **Nothing was edited.** No files, no git state, no servers.

---

## 1. First principles: what "make everyone's life easier" means in this domain

Four forces shape venue selling and delivery.

1. **The date is the product and it is perishable.** An unsold Saturday is gone for ever. A pencil that should have lapsed blocks a paying client (Canon §3, §5).
2. **Trust is built in the first hour and lost in the long middle.**
   - Speed to lead predicts qualification: 7× within an hour (HBR 2011) and 21× at 5 minutes against 30 (MIT/InsideSales).
   - "Radio silence" after booking, often caused by coordinator turnover, is the most damaging complaint (R3).
3. **Every stage turns into a document someone else relies on:** quote, contract, invoice, function sheet, supplier pack, day sheet. Most operational failures come from a stale copy of one of them (R2).
4. **The work is interrupt-driven and long.** Phones, walk-ins, show-rounds and event nights break every plan.
   - Interrupted work is completed faster but with more stress and frustration (Mark, Gudith & Klocke, CHI 2008).
   - Switching tasks leaves attention residue (Leroy 2009).
   - Both are established literature, not re-fetched in this session.

It follows that a tool that makes life easier must do four things:

- **Carry the clock.** Every promise has an owner, a next action and a date, and the system watches those dates so people do not have to (Canon §17).
- **Carry the record.** One event record, with every document a live, versioned view of it, so nothing is retyped and nothing goes stale.
- **Make re-entry effortless.** After any interruption the screen answers "where was I, what is next" at a glance. Detail opens beside the list, and the next step is always in the same place.
- **Close loops visibly.** Open loops weigh on people (the Zeigarnik effect), and memory of an experience is shaped by its peak and its end (Kahneman et al. 1993, "When more pain is preferred to less: adding a better end"). The tool should design the end of each stage and of each day: All caught up, Inked, Final, Settled.

Encouragement comes from those closures, the colour and the finish, never from praise copy (founder direction).

---

## 2. The cast

**Inside the venue** (the role split is inferred for a mid-size Scottish venue like Trades Hall; confirm locally):

| Role | What they do across the lifecycle |
| --- | --- |
| Head of sales / events sales manager | Sets pricing and hold policy, routes leads, approves discounts, owns targets and forecasts, runs the Monday meeting. |
| Sales executive / enquiries coordinator | Answers enquiries, qualifies, pencils dates, conducts show-rounds, writes proposals, chases decisions, converts to contract. |
| Events coordinator / manager (after booking) | Owns the client from contract to event: final-details meeting, menus, numbers, running order, suppliers, function sheet. The turnover risk sits here (R3). |
| Banqueting / catering manager and chef | Menus, dietary and allergen control, service timings, staffing. At Trades Hall this includes the preferred caterers Regis Catering and Top Class Catering (Canon §13), which is a third-party boundary. |
| Hallkeeper / duty or house manager | The building: keys, alarm, heating, setup and flips, load-in doors, fire exits, licensing hours, lock-up (R2, R7). |
| Setup crew, porters, bar staff | Furniture, flips, bar service; they need exact, current instructions. |
| Finance / credit control | Deposits, invoices, VAT, refunds, reconciliation, export to accounts. |
| General manager / director | Revenue, utilisation, conversion, risk; approves exceptions. |
| Marketing | Channel spend and attribution, reviews, repeat and anniversary campaigns under PECR. |

**Outside the venue:**

- **Clients**, each type with different needs:
  - couples (consumers, protected by CMA/DMCC rules);
  - corporate bookers, PAs and EAs (repeat, ex-VAT thinking, procurement);
  - society, club and trade-body secretaries (annual dinners, Burns suppers, AGMs);
  - charities.
- **Intermediaries:** venue-finding agencies, DMCs and marketplaces (Hitched, Bridebook, Tagvenue, Add to Event, Hire Space, Cvent's supplier network).
- **Suppliers:** caterers, AV/production, florists, bands and ceilidh bands, pipers, photographers, décor and furniture hire, SIA door staff.
- **Authorities:** the licensing board (occasional licences, extended hours), the registrar (M10 notices for Scottish weddings), building management and the alarm receiving centre.

---

## 3. The shape of the week and the year (inferred model, to confirm)

**The week:**

- **Monday morning:** the weekend's outcomes, decisions due this week, this week's events, final numbers due.
- **Daily morning:** triage of overnight and weekend enquiries; the marketplace clocks are running.
- **Late morning:** proposals and quotes.
- **Afternoons:** client calls and final-details meetings.
- **Evenings and Saturdays:** show-rounds for couples.
- **A weekly function-sheet meeting** for the next week's events.
- **Event nights and weekends** away from the desk, often in poor signal (R2).

**The Scottish venue year:**

- Wedding enquiries peak in the November–February engagement season, which is also when venues can realistically switch software (R11).
- Burns suppers cluster around late January.
- Corporate Christmas bookings peak in September, and weekend November and December nights are gone by August (VenueScanner 2026, search summary).
- St Andrew's Night (30 November) and Hogmanay bring festive licensing extensions.
- Society dinners and AGMs recur annually.
- The calendar items are inferred from general knowledge except where cited.

**Consequence for design:** the tool must be fastest at triage and re-entry, work one-handed on a phone during tours and event days, and make each day and week end on a visible "all caught up".

---

## 4. The lifecycle, stage by stage

Each stage covers: roles; data needed; pain today; what a dream tool does automatically; the moment of truth; what Venviewer has (inspected); what is missing.

### Stage 1. Enquiry capture from every channel

**Roles.** The sales executive reads first and the sales manager routes. The receptionist or duty manager takes phone calls and walk-ins out of hours. Marketing reads attribution.

**Data needed:**
- the person: name, organisation, role, phone, email (possibly relayed or masked);
- the event: type and format, preferred and alternative dates, flexibility, day-part, guests, rooms if known, budget, catering and bar interest, accessibility needs;
- the lead: source and campaign, that source's response clock, consent captured, and any layout or sketch;
- whether this is a returning client.

**Pain today:**
- Leads are scattered across inboxes, marketplace portals, phone notes and paper, and some are lost out of hours.
- Marketplace alerts omit basics. A Hitched RFI's mandatory fields are only name, phone and wedding date.
- Emails are masked or withheld (Bridebook below its top tiers, Tagvenue, Add to Event before a quote), so duplicates arrive across channels (R11).
- Details are retyped into a CRM, and nobody knows which channel pays.

**A dream tool, automatically:**
- one inbox, fed by the venue's own web widget, the planner and twin, and a per-venue ingest address that parses each marketplace's alert email;
- phone quick-entry of five fields, with optional dictation;
- tags the source and starts that source's clock (Tagvenue 2 business days for a booking request, 72 hours for an enquiry; Add to Event's 24-hour norm);
- recognises returning clients and likely duplicates (name + event date + phone) and suggests a merge;
- sends a warm, factual acknowledgement within a minute, with a VAT-inclusive price guide;
- checks availability before a human reads the enquiry.

**Moment of truth.** At 8.55 the Tagvenue lead from 23.00 last night is already on the desk. It has been parsed, matched to Tuesday's phone call from the same person, acknowledged at 23.01, and shows "1 day 14 h left".

**Venviewer has:**
- the GuestEnquiry contract, with a planner configuration xor a twin venue slug (`packages/types/src/enquiry.ts:119-137`);
- `POST /public/enquiries` with an allowlist and email-keyed `guest_leads` (`packages/api/src/routes/public-enquiries.ts:52`; `packages/api/src/db/schema.ts:889-900`);
- new-enquiry email to users with the `hallkeeper` role, with a fallback address (`public-enquiries.ts:202-247`);
- the Enquiries desk with stage counts, age, keyboard triage and next-best-move (`packages/web/src/components/dashboard/enquiries/`; `docs/design/enquiries-desk-2026-09-24/README.md`);
- a `website_embed_configs` table (`schema.ts`).

**Missing:**
- source field and response clocks;
- email ingest and per-source parsers;
- a staff create-enquiry path (no create call in `packages/web/src/api/enquiries.ts:78-160`);
- acknowledgement email to the enquirer;
- dedupe on name, date and phone;
- alternative dates, budget, organisation and day-part;
- an optional room (`spaceId` is NOT NULL, `schema.ts:668-686`);
- consent capture (R10).

### Stage 2. Qualification and speed to lead

**Roles.** The sales executive qualifies, the manager sets the qualification rules, and the client answers.

**Data needed:**
- fit: date availability, capacity for the format, budget against minimum spend or packages, event type the venue accepts;
- decision-maker and timeline;
- competitors being considered;
- the lead's value, and its displacement value on a hot date (Canon §5).

**Pain today:**
- Replies are slow or vague; 81% of couples are frustrated with venue responses (Bridebook 2026, via R11).
- Every reply is retyped from scratch.
- Qualification lives in someone's head.
- There is no view of which channels convert, and no follow-up cadence. Top performers make 20–26 touches over 50–90 days, against a baseline of 3–5 (VenueBot 2026, search summary; vendor data, directional).

**A dream tool, automatically:**
- drafts the first reply using real availability ("Saturday 5 June 2027: the Grand Hall is free; the Saloon holds a second option"), the right price guide and the enquirer's own words;
- scores fit against the venue's rules and says why;
- schedules the follow-up cadence with the owner and dates;
- shows response time and conversion by source;
- flags a low-value pencil that is blocking a higher-value enquiry (the Canon's status-conflict rule).

**Moment of truth.** The executive opens an enquiry and the correct, personal reply is already written against today's diary. They read it, adjust a sentence and send, and the tool says exactly who receives it.

**Venviewer has:**
- enquiry transitions with history and 422 on concurrent change (`packages/api/src/routes/enquiries.ts:243-355`);
- create opportunity from enquiry, which makes the account, contact and opportunity (`packages/api/src/routes/crm.ts:63`);
- opportunities with activities and follow-up tasks (`packages/api/src/routes/opportunities.ts:117-379`; `packages/types/src/commercial-spine.ts:29-175`);
- draft-only AI for enquiry summary and lead qualification, disabled until a provider is configured (`packages/types/src/ai-assistant.ts:25-36`; `packages/api/src/services/ai-assistant.ts:40`);
- the desk's copper age and oldest-first next move.

**Missing:**
- the reply composer joined to availability and price;
- a qualification rules model;
- follow-up cadences;
- per-source response and conversion analytics;
- lost reasons (no field found);
- sales-vocabulary states. Enquiry "approve/reject" is layout-review vocabulary (`enquiry.ts:20-48`), and approving emails the client (`enquiries.ts:304-316`).

### Stage 3. Availability and diary holds

**Roles.**
- Sales pencils and challenges.
- The manager sets hold policy.
- Clients decide within a window.
- Other pencilled clients are affected by releases.
- Hallkeepers and operations need turnaround truth.

**Data needed:**
- space–time intervals per room, including setup and teardown footprints;
- kind (prospect, hold, ink, internal block) and ladder rank, including joint first;
- decision date, owner, next action and due date;
- turnaround rules;
- room hierarchy and combinations (whole building against its parts);
- shared resources such as the goods lift, PA system or kitchen;
- noise adjacency;
- the value of each hold, for displacement.

**Pain today:**
- Pencils never expire, and 2nd options are re-ranked to 1st by hand on every release.
- Calendar sync fails and double-booking is the fear.
- No mid-market tool combines ranked holds, automatic expiry and automatic re-sequencing (R1).
- Combined rooms double-book when "whole hall" is modelled as a separate room (Hallmaster's own warning, R1).

**A dream tool, automatically:**
- refuses a pencil without decision date, owner and next action;
- reminds at T-7, T-3 and T-1, and lapses at the decision date unless a deposit or contract is attached;
- re-ranks the ladder on release and drafts the "you are now first option" note for the owner;
- runs a 48-hour challenge when a 2nd option is ready to sign;
- blocks the parts when the whole is booked;
- shows turnaround gaps and explains every conflict in a sentence.

**Moment of truth.** The MacLeod first option releases at 17.00. The Hendersons become first option, the owner already has a two-line note ready to send, and nobody had to remember anything.

**Venviewer has** (the strongest area):
- kinds and liveness with a derived Canon state, ranks, joint flag, and hold hygiene enforced at creation (`packages/types/src/booking.ts:39-195`);
- conversion from an enquiry (`booking.ts:246-275`; `packages/api/src/routes/bookings.ts:250`);
- a conflict engine with not-checked honesty (`booking.ts:300-340`; `packages/api/src/services/calendar-conflicts.ts`);
- turnaround rules (`schema.ts:3343`);
- T-7/3/1 reminders with idempotent sends, run by a platform-admin cron endpoint (`packages/api/src/services/hold-reminders.ts`; `packages/api/src/routes/admin.ts:86-114`);
- re-ranking on exit with a promotion payload (`packages/api/src/services/hold-hygiene.ts`);
- exactly-once diary commands over WebSocket (`packages/api/src/services/diary-commands.ts`);
- the ivory and forest Diary board with rank chips, a needs-action tray for stale pencils, enquiry drag-to-board and undo (`packages/web/src/pages/diary/components/BoardGrid.tsx:63-157`, `BoardPanels.tsx:78-99`, `lib/board-layout.ts:269-300`, `lib/undo-stack.ts`).

**Missing:**
- automatic lapse (expiry is a manual transition, `packages/api/src/services/booking-mutations.ts:443-478`);
- challenge workflow and waitlist;
- room hierarchy and combinability (not in the `spaces` table, `schema.ts:141-162`);
- shared-resource singletons;
- noise adjacency;
- a find-a-date answer across rooms (the Fit Finder);
- ICS or two-way calendar sync;
- displacement and yield signals (Canon §5).

### Stage 4. Show-rounds and site visits

**Roles.** The sales executive (and sometimes the events coordinator or chef) hosts. The client brings decision-makers. The hallkeeper opens rooms. For corporate visits, the AV lead may join.

**Data needed:**
- time, route and rooms to open, and who hosts;
- the client's brief;
- which room is dressed or in use that day;
- notes, questions asked and photos taken;
- the promised follow-up and its date.

**Pain today:**
- Tours are not in the diary, so they collide with setups or other viewings.
- Answers given on the tour (who will run the day, curfew, confetti rules) are lost at the handover to the coordinator (R3).
- The recap and quote arrive days later.
- Viewing-to-booking conversion is not measured.

**A dream tool, automatically:**
- books the tour as a diary object that occupies the rooms and shows the host;
- prepares a one-page tour brief with the client's date, guests and questions, and the rooms' layouts for their event type;
- offers a one-handed phone tour mode that captures notes, voice memos and photos against rooms;
- has the recap, a proposal draft and an optional pencil ready to send within 24 hours (R3's +24-hour touch);
- lets the twin or 3D planner stand in for a remote visit.

**Moment of truth.** Walking back from the Grand Hall, the executive sends the recap and quote from the phone. The recap includes the photo of the couple's chosen corner and the layout they talked about.

**Venviewer has:**
- the twin and walkthrough (`/venues/:venueSlug/twin`, `/room/:roomSlug`, `/tour` in `packages/web/src/router.tsx`);
- the planner and layout attachment on enquiries (`configurationId`);
- sourced room photography on the desk (`packages/web/src/components/dashboard/enquiries/enquiry-room-photo.ts`).

**Missing:**
- tours as diary objects (Canon §17.3, planned);
- tour briefs;
- a phone tour mode;
- capture of notes and photos;
- the post-tour recap;
- viewing and conversion metrics.

### Stage 5. Quotes and proposals

**Roles.** Sales builds. The manager approves discounts and exceptions. The caterer supplies menu pricing. The client compares, comments and accepts.

**Data needed:**
- room hire by day-part or hours;
- or a minimum spend with a shortfall line;
- or per-head packages (drinks, dinner, day delegate rate);
- extras and options;
- service charge;
- VAT per line;
- discounts and their approver;
- day-of-week and seasonal modifiers;
- validity date, deposit and schedule;
- the layout, capacity guidance and inclusions and exclusions;
- the version history.

**Pain today:**
- Surprise VAT and service charges at contract stage are a heavy complaint (R3).
- Proposals are static PDFs and every change means a new document.
- Discounts are applied without control; one Event Temple reviewer notes any user can apply a discount without notification (R1).
- Mixed VAT supplies are hard. Room hire is exempt unless the venue has opted to tax. Catering is standard-rated. A package can be a single standard-rated supply (HMRC Notice 742; VATLP11800; Tax Adviser).
- Since 6 April 2025 consumer prices must include mandatory charges (DMCC Act; CMA guidance 4 April 2025).

**A dream tool, automatically:**
- builds the quote from the brief and the venue's price book;
- computes each line's VAT treatment from the venue's option-to-tax status and supply type;
- presents consumer quotes VAT-inclusive with every mandatory charge, and business quotes ex-VAT with a VAT line;
- adds the minimum-spend shortfall line when spend falls short;
- routes discounts above a threshold for approval;
- re-prices instantly when guests or date change and shows the client what changed;
- keeps the accepted version immutable;
- reports "viewed", "commented" and "accepted" factually, without manipulative tracking.

**Moment of truth.** The client moves from 140 to 160 guests. Per-head lines, VAT, total and deposit update at once, with a clear "what changed" line. The executive sends the new version without opening a spreadsheet.

**Venviewer has:**
- pricing rules (flat, hourly, per-head, tiered, day-of-week and seasonal modifiers, GBP) and a public estimate endpoint (`packages/types/src/pricing.ts`; `packages/api/src/routes/pricing-rules.ts:59-315`; `packages/api/src/services/price-calculator.ts`);
- quotes with exact minor-unit line items, a status machine and supersession (`packages/types/src/proposal.ts:134-316`; `packages/api/src/routes/quotes.ts`);
- package selections (`commercial-spine.ts:203-218`);
- proposals with immutable digest-stamped versions including a layout snapshot, share tokens, comments, client approve and request-changes, and a claim guard (`proposal.ts:81-511`; `packages/api/src/routes/proposals.ts:268-1384`);
- the staff ProposalsView and the client pages `/proposal/:shareCode` and `/proposal-share/:token`.

**Missing:**
- VAT and option-to-tax;
- service charge and minimum spend;
- discounts with approval;
- presentation by client type;
- an internal cost and margin split;
- optional-upgrade toggles for clients;
- proposal analytics.
- The client proposal page is in the old dark graphite and gold style with disclaimer-heavy copy (`packages/web/e2e/operational-state-visual-performance.spec.ts-snapshots/desktop-proposal-share-comment-error-chromium-linux.png`) and needs the desk treatment under Blake's reach decision.

### Stage 6. Contracts and e-signature

**Roles.** Sales issues the contract. The authorised signatory signs for the venue. The client (or their company's signatory) signs. Finance needs the terms.

**Data needed:**
- the contracted proposal version;
- terms and conditions version;
- cancellation scale;
- signatories and their authority;
- the signature evidence (who, when, from where, which document digest);
- the deposit trigger.

**Pain today:**
- Terms are sometimes shared after the deposit is paid (R3).
- Contracts are merged or duplicated by hand; "almost impossible to merge any contracts" is a Delphi complaint.
- Signatures go through a separate tool, and the hold is inked by hand afterwards.

**A dream tool, automatically:**
- generates the contract from the accepted version and the venue's current terms;
- shows a plain-English summary of deposit, schedule and cancellation before signing;
- collects a simple e-signature with an audit trail;
- on signing, inks the hold, issues the deposit request, introduces the events coordinator and opens the client portal.

Under Scots law most contracts need no writing at all, and a simple electronic signature is typically appropriate for commercial agreements. Documents that must be in writing, such as land interests, need an advanced electronic signature (Shepherd and Wedderburn; Burness Paull).

**Moment of truth.** The client signs on their phone in two minutes. The diary turns the pencil to ink and the deposit request goes out, all visible and undoable on the venue side.

**Venviewer has:**
- immutable proposal versions with a digest (`proposal.ts:320-445`);
- client approval with author name and email (`proposals.ts:1317-1384`);
- status histories;
- `e_sign` as an integration provider name only (`packages/types/src/integration-layer.ts:21-30`).

**Missing:**
- contract documents and terms versions;
- signatory model and signature evidence;
- linkage from signature to ink and to the deposit;
- CMA-aware cancellation presets (R3).

### Stage 7. Deposits and payment schedules

**Roles.** Finance and credit control, the events coordinator, the client (or the client's accounts payable team).

**Data needed:**
- milestones (deposit, instalments, balance) with dates and amounts that sum exactly;
- the payment rail;
- VAT invoice at each tax point;
- receipts, reminders, refunds and credit notes;
- a separate damage deposit;
- purchase-order numbers for corporate clients.

**Pain today:**
- Chasing payments by hand.
- Deposit and cancellation terms that breach CMA guidance (fair deposit "no more than a small percentage"; the Bijou deduction ceiling of 28–37% near the date; R3).
- VAT errors on deposits. An advance payment for a taxable supply creates a tax point on receipt (Menzies; HaysMac).
- Card fees and chargeback exposure (R9).
- US tools such as HoneyBook cannot process UK payments (R3).

**A dream tool, automatically:**
- builds the schedule from venue-type presets (R3, R9);
- sends a VAT invoice and payment link at each milestone, with card and pay-by-bank side by side (the venue as merchant of record; R9);
- sends reminders under the service stream (R10) and receipts on payment;
- reconciles, exports to the accounting system, and shows money due this week on the daily brief.

**Moment of truth.** The coordinator never chases a payment. Receipts go out, and finance's export matches the bank.

**Venviewer has:**
- exact money helpers, including `depositSplit` and `allocateMinor` (`packages/api/src/services/money.ts:86-150`);
- GBP minor-unit quotes;
- Stripe tables for Venviewer's own subscriptions only (`packages/api/src/scripts/apply-migration-0018.ts`).

**Missing:** everything client-facing. Milestones, invoices, receipts, credit notes, collection rails, reminders, reconciliation and accounting export.

### Stage 8. Final numbers, dietary and accessibility

**Roles.** The events coordinator, the client (who collects from their guests), the chef and caterer, front of house, and the hallkeeper for access.

**Data needed:**
- the headcount triple: guaranteed, expected, set-for;
- the final-numbers deadline, with the increase-only rule after it;
- menu choices;
- per-guest dietary needs and the 14 regulated allergens, by name and table;
- accessibility needs: wheelchair spaces, hearing loop zone, step-free route, BSL interpreter, large print, carers;
- table plan and running order.

**Pain today:**
- Final-numbers stress and minimum-numbers traps (R3).
- Dietary lists arrive as spreadsheets and emails.
- Kitchen and front-of-house copies disagree (R2).
- Allergens are summarised as counts, so the server cannot find the guest.
- The FSA's 5 March 2025 best-practice guidance recommends written allergen information covering all 14 allergens, and Food Standards Scotland consulted until 17 May 2026 on strengthening written information.
- UK weddings average 4.2 dietary requirements per 100 guests (R3).

**A dream tool, automatically:**
- opens the client's final-details checklist at 6 weeks and asks for numbers at 14 days, with the deadline visible from contract;
- lets the client paste or upload a guest list and tick the 14 allergens per guest;
- turns that into a kitchen board by table and service, and front-of-house seat cards;
- re-prices per-head lines after numbers change;
- locks reductions after the deadline under the contract rule;
- feeds accessibility needs to the hallkeeper sheet and floor plan.

**Moment of truth.** At 14 days the client's portal asks for numbers. The kitchen board already shows seven allergens by guest name and table, and the invoice has moved from 140 to 152 guests with no email thread.

**Venviewer has:**
- the headcount triple on events (`packages/api/src/db/schema.ts:1264-1290`);
- DietarySummary counts for vegetarian, vegan, gluten-free, nut-free, halal and kosher, plus free-text allergies (`packages/types/src/event-requirements.ts:99-150`);
- AccessibilityRequirements (`event-requirements.ts:20-98`);
- both feeding the hallkeeper sheet (`packages/types/src/hallkeeper-instructions.ts:104`; `packages/api/src/services/event-sheet-extractor.ts`).

**Missing:**
- the final-numbers deadline and its rules;
- client-side collection (portal);
- guest list and table plan;
- the 14-allergen per-guest model;
- menu selection;
- re-pricing of numbers into the invoice.

### Stage 9. Function sheets / banqueting event orders

**Roles.** The events coordinator authors. The chef, bar, front of house and hallkeeper consume. The client signs off the client summary. The weekly function-sheet meeting reviews.

**Data needed:**
- a unique reference and version stamp;
- the timeline from load-in to lock-up;
- the headcount triple;
- rooms, setups and flips;
- menus, dietary needs and service times;
- bar and AV;
- staffing;
- contacts and suppliers with arrival windows and doors;
- keys, alarm zones and heating-on time;
- the curfew cluster (terminal hour, last entry, music-off, drinking-up), all operator-entered (R7);
- diagrams as linked attachments.

**Pain today:**
- The version on the kitchen wall differs from the front-of-house copy.
- Changes are not propagated.
- Staff cross-reference several documents.
- The sheet is not finalised early enough. Best practice is "Final" at 72 hours (R2).

**A dream tool, automatically:**
- generates one master sheet and its department views (kitchen board, front of house, hallkeeper, bar, client summary);
- regenerates on every change and shows each department "changed since you last looked" with an acknowledgement;
- moves to "Final" at T-72h only when blocking conflicts are resolved or acknowledged;
- prints a beautiful A4 page with a QR code to the live version.

**Moment of truth.** The coordinator moves the arrival from 18.30 to 18.45. Every department's view marks the change, each acknowledges it, and the printed sheet in the kitchen is the only thing still old, and says so via its QR code.

**Venviewer has:**
- hallkeeper sheet v2 with PDF, floor plan and progress (`packages/api/src/routes/hallkeeper-sheet.ts:133-242`; `packages/api/src/services/hallkeeper-pdf-v2.ts`, `hallkeeper-floor-plan-pdf.ts`);
- ops handoff packs compiled from a configuration (`packages/api/src/services/ops-compiler.ts:742-1018`; `packages/api/src/routes/ops-handoff.ts`), which store BEO documents, load-in and breakdown sequences, room flip plans and snapshot diffs (`schema.ts:1834-1860`);
- an event change feed and acknowledgements (`packages/api/src/routes/event-plan-lifecycle.ts:182-201`);
- the Day Board (`packages/web/src/pages/hallkeeper/DayBoardPage.tsx`) and the hallkeeper workspace (`packages/web/src/components/hallkeeper/`).

**Missing:**
- department views, notably the kitchen board;
- a "Final" status bound to conflicts;
- the curfew, licensing, keys and alarm clusters;
- occasional-licence lead-time tasks for Scottish venues (R7);
- a print route with QR in the selected style;
- client sign-off of the client summary.

### Stage 10. Supplier coordination, turnarounds and setups

**Roles.** The events coordinator, suppliers, hallkeeper and setup crew, and the caterer.

**Data needed:**
- approved and preferred suppliers by trade;
- the requirement per event;
- load-in windows, door or bay owner and route;
- power needs;
- compliance documents with expiry: £5m public liability (often £10m for higher risk), annual PAT certificates, RAMS for rigging or cooking, food hygiene;
- acknowledgement;
- the flip plan with its green-light time and crew.

**Pain today:**
- Documents are chased by email the week before.
- Suppliers arrive early or late with no one on the door (R2).
- Flips are budgeted at 60 minutes but done in 30–45 with extra staff pulled in (R2).
- The same furniture is promised to two rooms (the Inventory reference's shortfall).

**A dream tool, automatically:**
- keeps each supplier's documents in a self-service locker the supplier updates, with expiry reminders to the supplier, not the coordinator;
- sends each supplier a pack with only their window, door, route and contacts, and records acknowledgement;
- builds flip plans with defaults (back-to-front breakdown, edges-inward build, float crew) and checks inventory across overlapping events.

**Moment of truth.** The band's public liability expired last month. The band was reminded three weeks ago and uploaded the new certificate themselves, and the coordinator only ever saw a sage "documents current".

**Venviewer has:**
- supplier coordination packs with requirement, load-in window, handoff instruction and contact-note items, magic-link share, and acknowledge or needs-clarification (`packages/types/src/supplier-coordination.ts:14-34`; `packages/api/src/routes/supplier-coordination.ts:251-636`; `/supplier-share/:token` in `packages/web/src/router.tsx`);
- load-in, breakdown and room flip plan tables (`schema.ts`);
- inventory reservations and shortage remedies (`packages/api/src/routes/inventory-reservations.ts`);
- turnaround rules.

**Missing:**
- the supplier compliance-document model and expiry reminders;
- approved and preferred status with rank (Canon §2.8);
- supplier self-service updates;
- door and bay scheduling;
- flip planner defaults in the UI;
- a supplier contact directory across events.

### Stage 11. Event-day operations

**Roles.** The duty manager or hallkeeper, the events coordinator on site, setup crew, bar, kitchen, security, and the client's on-site contact.

**Data needed:**
- the live timeline and phase states;
- room states (clean, set, live, dirty, flipping);
- who is on, and who to call;
- incidents;
- extras consumed (bar tab, additional guests, overtime, damage);
- the lock-up checklist, including reinstating any fire isolation.

**Pain today:**
- Radios and WhatsApp fail in stone buildings (R2).
- Stale sheets and unbriefed staff.
- Slippage cascades.
- Extras are written on paper and lost before invoicing.

**A dream tool, automatically:**
- keeps the Day Board and phone view in sync and tolerant of dropped signal;
- makes room-state chips one tap;
- shows the next flip with a countdown;
- logs incidents and grades their severity;
- makes extras one tap, and they flow into the final invoice;
- delivers the lock-up checklist from the building's own data.

**Moment of truth.** In the basement with no signal, the hallkeeper's phone still shows room, state, next flip and who to call, and syncs on the stairs.

**Venviewer has:**
- an ops board, issues graded info, attention or urgent, and status updates (`packages/api/src/routes/event-day-ops.ts:113-262`; `packages/types/src/event-day-ops.ts`);
- mission control with presence, phases, tasks, incidents, acknowledgements and replay (`packages/api/src/routes/event-mission-control.ts:214-358`);
- the live Day Board over `/ws/diary`;
- the pages `/hallkeeper/today`, `/ops/events/:eventId` and `/events/:eventId`.

**Missing:**
- offline mode (Canon P2);
- extras capture;
- lock-up and building clusters;
- a staff roster.

### Stage 12. Post-event invoicing (settlement)

**Roles.** Finance, the events coordinator, the client's accounts payable, the caterer if it invoices separately.

**Data needed:**
- contracted lines;
- final numbers;
- recorded extras;
- deposits and instalments received, VAT at each tax point, credit notes;
- damage-deposit decision;
- PO numbers;
- accounting codes.

**Pain today:**
- Invoices are built by hand from memory and paper.
- Some tools have no invoice numbering (R1).
- Discounts are applied without audit (R1).

**A dream tool, automatically:**
- builds the final invoice from the contract plus extras, net of payments;
- releases or claims the damage deposit with a reason;
- exports to accounts and closes the event as "Settled".

**Moment of truth.** The final invoice is waiting on Monday morning, with the bar tab and the six extra guests from Saturday already on it and the deposit netted off. Finance presses send.

**Venviewer has:** nothing client-facing. `money.ts` helpers exist, and revenue analytics works on scenarios (`packages/api/src/routes/revenue-analytics.ts:179-372`).

**Missing:** the entire settlement flow.

### Stage 13. Feedback, rebooking and anniversaries

**Roles.** The events coordinator, the sales executive, marketing and the manager.

**Data needed:**
- private feedback, and whether it ends up public;
- issues raised;
- won and lost reasons;
- series and annual events (society dinners, Burns suppers, Christmas parties, AGMs);
- anniversaries;
- consent per channel (R10);
- client history and preferences.

**Pain today:**
- Negative experiences surface first on public review sites, and some platforms suppress negative reviews, so couples trust forums instead (R3).
- Annual clients are left to call back, even though corporate annual events are often rebooked before this year's event takes place (VenueScanner 2026, search summary).
- Nobody records why an enquiry was lost.

**A dream tool, automatically:**
- sends a thank-you a few days after the event with a private feedback form, before any public review request (R3, R10);
- routes issues to the manager;
- for series and annual clients, offers to pencil the same weekend next year, with consent;
- reminds the owner of anniversaries and repeat windows;
- records won and lost reasons at the moment of decision and turns them into conversion insight.

**Moment of truth.** Three days after the Burns supper, the club secretary gets a thank-you, a two-question feedback note, and the same Saturday next January already pencilled for them. She replies "yes".

**Venviewer has:** revenue and pipeline analytics (`revenue-analytics.ts`) and opportunity won and lost stages (`commercial-spine.ts:29-52`).

**Missing:** feedback, lost reasons, series and rebooking, anniversaries and consent.

---

## 5. Cross-cutting systems

- **One unbroken record.** Enquiry, opportunity, booking, proposal, event, configuration and handoff already link by foreign keys:
  - `bookings.enquiryId` (`booking.ts:131-132`);
  - events to client account and opportunity (`schema.ts:1264-1290`);
  - quotes to opportunity, proposal and enquiry (`proposal.ts:243-262`).
  - Make that linkage the user's experience: one client and event narrative, not five screens.
- **Comms auto-logging and client 360.** A BCC and ingest address threads email onto the event, and calls are logged in one tap (Canon §17 gaps 1–2). Not built.
- **The service drip.** 14 service touches in the service stream, with marketing kept separate under PECR (Canon §6, §16). Only the hold reminder and enquiry decision emails exist (`packages/api/src/services/email-templates.tsx:254-728`).
- **Migration.**
  - A CSV/XLSX wizard that imports future bookings and contacts first (R11).
  - White-glove import from Salesforce/Delphi, Cvent, Tripleseat and spreadsheets.
  - Delphi is built on Salesforce CRM (Amadeus; HotelTechReport), so "stuck with Salesforce" at a venue often means Delphi.
  - The integration layer today stores connection records and a locally signed webhook marked `stubbed` (`packages/api/src/routes/integrations.ts:193-216`; `packages/api/src/services/integration-layer.ts:65-81`). No CSV import or export or ICS feed was found.
- **Reporting.**
  - Saved views and CSV export on every list.
  - Response time and conversion by source.
  - Utilisation.
  - The Monday brief.
  - Executive analytics exists, but in the old dark and cyan style, with "GBP 4,750.00" formatting and a leaked `review_required` token (`packages/web/e2e/dashboard-state-visual-performance.spec.ts-snapshots/desktop-executive-analytics-success-chromium-linux.png`).
- **Parity baseline has moved.**
  - Tripleseat Intelligence (May 2026) drafts lead replies and contracts and nudges unsigned proposals.
  - Cvent's venue suite covers group sales, diagramming and catering, but reviewers cite complexity and add-on pricing.
  - Venviewer's advantage is speed, a single record, spatial truth (twin and planner), venue vocabulary, and calm, beautiful production value.

---

## 6. Map: has versus missing

| Stage | Has (inspected) | Missing |
| --- | --- | --- |
| 1 Capture | Public planner and twin intake, desk triage | Source and clocks, email ingest, phone entry, acknowledgement, dedupe, optional room |
| 2 Qualify | Transitions, CRM from enquiry, tasks, draft-only AI | Reply composer with availability, cadence, lost reasons, source analytics, sales vocabulary |
| 3 Holds | Ranked and joint holds with hygiene, ink exclusion, conflicts, T-7/3/1, re-rank, tray, live board | Auto-lapse, challenge, waitlist, room combinations, resources, Fit Finder, sync |
| 4 Show-rounds | Twin, planner, room photos | Tour objects, tour brief, phone tour mode, recap |
| 5 Quote and proposal | Pricing rules, exact quotes, versioned proposals, share, approve | VAT, service charge, minimum spend, discounts and approval, DMCC presentation, new look |
| 6 Contract | Proposal digest, client approval | Terms, signature evidence, ink and deposit linkage |
| 7 Payments | Money helpers only | Milestones, invoices, rails, reminders, reconciliation, export |
| 8 Numbers and dietary | Headcount triple, diet counts, access fields | Deadline flow, portal, per-guest 14 allergens, menus |
| 9 Function sheet | Sheet v2 PDF, handoff packs, change feed, Day Board | Department views, Final at T-72h, curfew, keys, print route |
| 10 Suppliers | Packs, magic link, acknowledgements, flip tables, inventory | Compliance documents and expiry, preferred status, door and bay |
| 11 Event day | Ops board, issues, mission control | Offline mode, extras capture, lock-up |
| 12 Settlement | none | All of it |
| 13 Feedback and rebooking | Won/lost stages, analytics | Feedback, series, anniversaries, consent |

---

## 7. Psychology and game design applied to the lifecycle

**Research the desk record already cites** (`docs/design/enquiries-desk-2026-09-24/README.md`):
- speed to lead;
- the progress principle;
- the goal gradient;
- aesthetic-usability;
- flow;
- self-determination;
- calm technology;
- preattentive attributes;
- game feel.

**Added here** (established literature, not re-fetched this session):

- **Peak-end rule** (Kahneman et al. 1993). Design the ends: of the day ("All caught up"), of a deal (the ink fill and one stamp), of preparation ("Final") and of an event ("Settled").
- **Zeigarnik effect.** Unfinished tasks linger in memory, so the system holds every open loop with its owner and date and people can let go of them. This is the psychological case for the Canon's universal law.
- **Attention residue** (Leroy 2009) and the cost of interruption (Mark et al. 2008). Keep context beside the list. Remember place and scroll. On return, say in one line what changed while you were away.
- **Recognition over recall** (Nielsen's heuristics). Use the venue's own vocabulary, room photographs and date tiles. Never make people remember codes.
- **Fast response.** The Doherty threshold (1982) puts responses under about 400 ms; the Canon aims for under 100 ms. Keep interactions immediate, with optimistic updates and honest rollback.
- **Consequence previews instead of confirmation dialogs.** They teach competence and safety at once; the desk's decline confirmation is the pattern.
- **Game design without gamification.**
  - A clear goal per surface: an empty New stage, no stale pencils, all sheets Final, all events Settled.
  - Keyboard control.
  - One restrained reward, the stamp.
  - No points or badges, and no praise copy (founder).
- **Calm for eight-hour use.**
  - Copper only for real clocks.
  - Motion only when state changes.
  - No hover swell.
  - Readable AA text and visible focus rings.
  - The room photograph as the single sublime moment, seen from a secure desk.

---

## 8. Recommended build order (most value to the user first)

1. **Intake and speed to lead:**
   - enquiry model upgrade;
   - acknowledgement email;
   - phone entry;
   - ingest address and parsers;
   - response clocks;
   - dedupe suggestions;
   - reply composer joined to availability.
2. **The UK money core:**
   - VAT, service charge, minimum spend and discounts in quotes;
   - DMCC presentation;
   - the proposal page rebuilt in the desk style.
3. **Contract, deposit and payment schedule, and portal by magic link.** Signing inks the hold and requests the deposit.
4. **Diary completion:**
   - auto-lapse and challenge;
   - room combinability;
   - tours as diary objects;
   - the Fit Finder.
5. **Final numbers and the 14-allergen guest list.** Then the function sheet's department views with Final at T-72h.
6. **Supplier compliance locker; offline event-day mode with extras capture.**
7. **Settlement, feedback and rebooking, the client 360 timeline, and migration.** Migration comes earlier if Trades Hall's cutover date requires it.

---

## 9. Sources

**Repository.** All paths cited inline, including:
- `.claude/conventions/product-experience.md`
- `docs/design/enquiries-desk-2026-09-24/README.md`
- `docs/strategy/the-diary-research-canon.md`
- `docs/research/r1-incumbent-teardown.md`
- `docs/research/r2-ops-ethnography.md`
- `docs/research/r3-client-journey.md`
- `docs/research/r7-uk-operational-context.md`
- `docs/research/r10-comms-consent.md`
- `docs/research/r11-migration-leads.md`
- `docs/strategy/venviewer-complete-vision-source-2026-09-04.md` §6, §14–§20

**Web (this session):**

*VAT and pricing*
- [HMRC VAT Notice 742, land and property](https://www.gov.uk/guidance/vat-on-land-and-property-notice-742)
- [HMRC VATLP11800, wedding packages](https://www.gov.uk/hmrc-internal-manuals/vat-land-and-property/vatlp11800)
- [Tax Adviser, VAT and room hire](https://www.taxadvisermagazine.com/article/vat-and-room-hire-tax-marriage)
- [UHY Hacker Young, VAT exemption for room hire](https://www.uhy-uk.com/insights/applying-vat-exemption-room-hire)
- [Menzies, VAT on booking deposits and cancellation fees](https://www.menzies.co.uk/booking-deposits-cancellation-fees-whats-the-vat-impact/)
- [HaysMac, VAT rules on deposits](https://haysmac.com/insights/understanding-vat-rules-on-deposits/)
- [HMRC VATSC05822, deposits and hotel booking charges](https://www.gov.uk/hmrc-internal-manuals/vat-supply-and-consideration/vatsc05822)
- [CMS, DMCC drip pricing](https://cms.law/en/gbr/legal-updates/no-hidden-charges-clamping-down-on-drip-pricing)
- [CMS, DMCC consumer provisions from 6 April 2025](https://cms.law/en/gbr/legal-updates/the-dmcc-act-consumer-elements-come-into-force-from-6-april-2025)
- [Taylor Wessing, CMA drip-pricing guidance](https://www.taylorwessing.com/en/insights-and-events/insights/2025/04/dmcca-drip-pricing)
- [Tagvenue, minimum spend venues](https://www.tagvenue.com/hire/minimum-spend-venues/london)

*Allergens*
- [FSA allergen guidance for food businesses](https://www.food.gov.uk/business-guidance/allergen-guidance-for-food-businesses)
- [Food Standards Scotland allergen consultation](https://www.foodstandards.gov.scot/news/food-standards-scotland-launches-public-consultation-on-allergen-information)

*Scots law and weddings*
- [Shepherd and Wedderburn, electronic signing in Scotland](https://shepwedd.com/knowledge/electronic-signing-documents-scotland/)
- [Burness Paull, electronic signatures in Scotland](https://www.burnesspaull.com/legal-insights-news-events/insights/electronic-signatures-in-scotland-silos-concerns-and-top-tips/)
- [City of Edinburgh Council, legal requirements for marriage](https://www.edinburgh.gov.uk/births-marriages-deaths/legal-requirements-marriage-civil-partnership)
- [Tie the Knot Scotland, M10 guide](https://tietheknot.scot/planning-details/ceremonies/how-to-fill-in-the-marriage-m10-form-for-getting-married-in-scotland/)

*Speed to lead and benchmarks*
- [InsideSales, response time matters](https://www.insidesales.com/response-time-matters/)
- [MIT Lead Response Management study PDF](https://25649.fs1.hubspotusercontent-na2.net/hub/25649/file-13535879-pdf/docs/mit_study.pdf)
- [VenueBot 2026 UK wedding venue enquiries](https://venuebot.io/blog/2026-state-of-uk-wedding-venue-enquiries) (search summary only; the page was blocked by the egress proxy)
- [VenueScanner 2026 UK Christmas party trends](https://www.venuescanner.com/blog/2026-uk-christmas-party-booking-trends-businesses-need-to-know) (search summary)

*Incumbents*
- [Hotel Tech Report, Amadeus Delphi](https://hoteltechreport.com/meetings-and-events/event-management-software/amadeus-delphi)
- [Amadeus, Delphi built on Salesforce](https://www.amadeus-hospitality.com/sales-catering-software/delphi/)
- [Capterra, Cvent reviews](https://www.capterra.com/p/26318/Cvent-Event-Management/reviews/)
- [Cvent, RFP metrics](https://www.cvent.com/en/supplier-venue/rfp-metrics)
- [PR Newswire, Tripleseat Intelligence](https://www.prnewswire.com/news-releases/tripleseat-unveils-ai-suite-to-transform-event-management-302774151.html)

*Suppliers and accessibility*
- [Jigsaw Conferences, event vendor insurance](https://jigsawconferences.co.uk/articles/event-vendor-insurance)
- [Designing Buildings, RAMS](https://www.designingbuildings.co.uk/wiki/Risk_assessments_and_method_statements_RAMS)
- [Euan's Guide, Scotland reviews](https://www.euansguide.com/reviews/scotland)
- [VisitScotland, accessible events](https://support.visitscotland.org/advice-support/support-by-sector/events-festivals/accessible)

**Literature cited without re-fetching:**
- Oldroyd, McElheran & Elkington, HBR 2011.
- Kahneman, Fredrickson, Schreiber & Redelmeier, *Psychological Science* 1993.
- Zeigarnik 1927.
- Leroy, *OBHDP* 2009.
- Mark, Gudith & Klocke, CHI 2008.
- Doherty & Thadani, IBM 1982.
- Amabile & Kramer 2011.
- Weiser & Brown 1995.
