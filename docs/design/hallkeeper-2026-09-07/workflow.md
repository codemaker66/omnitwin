# The hallkeeper's day

Research and proposed product design · 7 September 2026 · T-606

The expanded experience is in [care and craft](care-and-craft.md): receiving and interpreting instructions, personal client care, service recovery, interrupted work and a clean finish. Use it with this complete lifecycle and implementation contract. [Four revised image prompts](image-prompts-v2.md) develop the direction Blake liked; [v2 evidence](verification-v2.md) and the [acceptance matrix](experience-acceptance.md) distinguish demonstrated interactions from designed and future production behaviour.

## The promise

**Know what is agreed, know what needs you next, and leave knowing someone has the rest.**

The hallkeeper should spend more of the day looking after the building and its people, and less reconstructing instructions, chasing answers, walking back to a store, correcting invisible changes or worrying about what was missed. A beautiful sheet is the entrance to this workflow. The real product connects the agreed event to the physical work, the people doing it and the exceptions they encounter.

The central design principle is **give the hallkeeper less to carry in their head**. Do not expose every capability at once. Keep an immediately useful day sheet, a room work pack and a compact exception rail. Reveal detail when a task or decision needs it. A veteran's skill remains valuable; the system handles memory, coordination and bookkeeping around it.

This is a researched proposal, not a claim that every pain point has been eliminated. There have been no hallkeeper interviews or venue trials in this task. The veteran perspective is an explicit design exercise. Operational proposals below must be tested with real staff and approved local procedures.

## What was requested and what the image means

Blake requested a hallkeeper sheet and complete workflow that pair stylistically with the attached booking board, deep creative thinking, internet research and prompts for images he will generate in ChatGPT. The image supplies visual evidence, not additional instructions or event records.

The retained [reference](style-reference.png) is 1586 × 992, SHA-256 `DA4F191405D207B99652EFDF89F61CBFADB4AEFE94AFD0D55BE8D08BDCFF7A6F`. Its Hillside House identity, dates, people, bookings and quantities are illustrative. Concept examples use that fictional venue so they cannot be mistaken for imported Trades Hall bookings. The product remains Venviewer; a venue's own identity can lead its workspace.

Deliverables: this specification, [copyable image prompts](image-prompts.md) and an interactive in-conversation design study. These are independent design artifacts. T-601 owns the combined demo release, T-603 owns the Diary redesign, and T-605 owns the active intelligent platform implementation. No application source or production record is changed here.

## Research translated into design

These are primary sources accessed on 7 September 2026. The right column is our proposed product response, not a feature endorsed by the source. Industrial human-factors guidance is explicitly applied by analogy to venue work.

| Evidence | Design consequence |
|---|---|
| [HSE: managing an event](https://www.hse.gov.uk/event-safety/managing-an-event.htm) includes build-up, load-in, breakdown, coordination, monitoring and debrief. | The event occupies resources before guests arrive and after they leave. Specialist work has specialist owners; a hallkeeper coordinates without absorbing every responsibility. |
| [HSE: shift handover](https://www.hse.gov.uk/humanfactors/topics/shift-handover.htm) describes preparation, two-way exchange and incoming cross-check, with verbal and written communication. | Generate a short handover, support a conversation and record explicit acceptance. A sent PDF is not a transfer of responsibility. |
| [HSE: workload](https://www.hse.gov.uk/humanfactors/topics/workload.htm) covers mental and physical demand, interruptions and distribution of work. | Include travel, setup, cover and breaks in feasibility. Detect the same person being needed in two places; batch routine updates and make understaffing visible. |
| [HSE: hospitality manual handling](https://www.hse.gov.uk/catering/msd.htm) discusses avoiding or reducing hazardous handling and considering task, load, environment and individual factors. | Consolidated picks, available handling aids and suitable crew matter more than a faster checklist. Route suggestions use verified local constraints and never prescribe guessed lifting limits. |
| [HSE: event transport](https://www.hse.gov.uk/event-safety/transport.htm) addresses separating pedestrians and vehicles and protecting emergency access. | Loading bays, corridors, lifts and public arrival periods participate in scheduling. Book the receiver and unloading path as well as the delivery time. |
| [VisitScotland: inclusive and accessible events](https://support.visitscotland.org/advice-support/support-by-sector/events-festivals/accessible) treats inclusion across planning, information, travel and the venue. | Agreed assistance becomes discreet, owned actions across the guest's journey, including seating, hearing support, toilets and quiet space. An access request is not just a note attached to a name. |
| [Food Standards Scotland: allergen information](https://www.foodstandards.gov.scot/business-guidance/running-a-food-business/publications/food-allergen-labelling-and-information-requirements-technical-guidance) addresses food-business information responsibilities. | Show caterer-confirmed information and its owner/version. Route uncertain substitutions to the caterer; AI summaries cannot certify food safety. |
| [HSE: incidents and emergencies](https://www.hse.gov.uk/event-safety/incidents-and-emergencies.htm) covers responsibilities, communication and contingency arrangements. | Keep approved instructions and responsible contacts immediately available. An emergency never waits for form completion, connectivity or AI. |
| [Scottish Government: means of escape](https://www.gov.scot/publications/practical-fire-safety-guidance-existing-non-residential-premises-2/pages/7/) and [disabled evacuation guidance](https://www.gov.scot/publications/fire-safety-guidance-evacuating-disabled-people-from-buildings/) describe context-dependent arrangements. | Capacity, routes and evacuation plans must come from authorised venue records. Furniture fitting a diagram is not evidence that an event is approved. |
| [Historic Environment Scotland: filming at historic sites](https://www.historicenvironment.scot/about-us/our-work/filming-and-photography/filming-at-historic-scotland-sites/) illustrates site-specific restrictions on equipment and attachments. | Put approved care instructions on the relevant room/equipment, with condition photographs. HES conditions are examples, not universal Trades Hall rules. |
| [Oracle OPERA: event note change log](https://docs.oracle.com/en/industries/hospitality/opera-cloud/21.5/ocsuh/t_reports_event_note_change_log_report_rep_event_note_changelog.htm) documents dated, attributed changes after BEO distribution. | Version-aware changes are established operational needs. Extend the idea to impact, ownership, acknowledgement and changed physical checks. Vendor documentation proves its described feature, not improved outcomes in our product. |
| [Trades Hall's own site](https://www.tradeshallglasgow.co.uk/) describes flexible event use and external catering partners. | A Trades Hall implementation needs useful exchanges across venue staff, organisers and external partners. This source does not establish current stock, routes, staffing or approved capacities for a particular setup. |

## The complete service journey

| Moment | What the hallkeeper sees and does | What the system prepares or removes |
|---|---|---|
| Enquiry and quoting | Consult a small feasibility brief when a promise affects delivery. Identify missing access, labour, storage, noise or turnaround constraints. | Draft requirements from supplied material with source links; compare rooms, resources and operational windows. Surface unanswered questions before a commitment. |
| Site visit and planning | Walk the actual spaces with the organiser; capture a location-specific note/photo and the person who must resolve it. | Link the note to the relevant room, layout and event. Reuse verified room guidance without copying previous clients' private details. |
| Confirmation | See one agreed brief with named commercial and operational decision-makers. | Preserve contractual commitments separately from drafts. Link approved layout, guest count, access/setup/live/clearance times, responsibilities and unresolved decisions. |
| Week ahead | Review unusual jobs, labour peaks, maintenance outages, hire needs and stock shared between events. | Detect conflicts across the whole venue; prepare feasible choices with cost/time/approval implications. Requests for hire never count as confirmed supply. |
| Day before | Review only outstanding confirmations and changes. Check the supplier arrival/collection schedule. | Assemble the issued operational pack, role-specific instructions, picks, setup sequences and printable sheets. Chase drafts are reviewable; external sending requires authorised channels. |
| Shift start | Read a two-minute brief: changes, open issues, first deadline, who is present, cover and what's different about today. | Compare against the person's last acknowledged release, collect unresolved work and show gaps in ownership. Offer an optional read-aloud brief with a text equivalent. |
| Opening round | Follow a short route through checks actually applicable to this venue and day. Report an issue in place. | Group checks by location; show the relevant switch, method or reference. Include building access, facilities, contractor occupancy and readiness dependencies from approved procedures. |
| Collection and setup | Follow the current plan, collect the right items once and see which prerequisite is holding work up. | Consolidate picks by store/location, show trolley and crew needs, avoid incompatible double bookings, display keep/move/remove differences from the current layout. |
| Suppliers arrive | Receive the expected supplier at the agreed entrance; log actual receipt, shortages or damage once. | Arrival instructions, arrival window, receiver, contact, unloading route and collection plan travel together. An arrival ping is not proof that goods were accepted. |
| Before admission | Walk the room with a concise release check and the relevant specialist confirmations. | Surface blockers by consequence. Reopen checks invalidated by changes. Record the authorised room-release decision separately from task ticks. |
| Guests and programme | See the next cue, who owns it, the next room move and exceptions needing attention. | Route ordinary requests to the responsible role, organise welfare/cleaning/replenishment rounds, track accepted requests and their deadlines. Protect attention during sensitive moments. |
| Last-minute change | Review exactly what is requested, what it affects and what can actually be achieved. | Compare released and requested values, recompute dependencies, prepare viable options and audience-specific updates. Preserve the old release until a new one is approved and issued. |
| Room changeover | Work a feasible clearance → cleaning → movement → setup → inspection sequence. | Use observed progress and available people/equipment. Show when the next room use is threatened and which options remain; never silently delete cleaning or checks to make a schedule fit. |
| Break or shift relief | Transfer cover to a colleague who accepts it; hand over exceptions and imminent obligations. | Divert routine requests to the accepted cover. Show unaccepted cover as a gap. Allow an incoming cross-check and questions; do not equate notification with acceptance. |
| Departure and close | Confirm departures, remaining suppliers, returns, condition, lost property and venue-specific shutdown. | Build a closing route, return list and unresolved-work handover. Keep collection/defect work open after the client has left. |
| Next morning and learning | Review useful exceptions and correct a room tip or process. | Draft work orders, discrepancy records, authorised charge evidence and improved duration estimates. Avoid re-entering the same incident in multiple systems. |

## Every point of contact has an owner

The hallkeeper must not become the default recipient of every message. A role has a named person on duty, an accepted deputy, a preferred contact method, availability and a route for unresolved matters. Venue policy determines when responsibility transfers. The product records acceptance, not assumed availability.

| Person or team | They provide | They receive / act on |
|---|---|---|
| Sales / booking administrator | Agreed requirements, source documents, approval and commercial commitments | Feasibility exceptions, missing decisions and consequences before promising a change |
| Organiser / authorised client representative | Programme, final requirements and change requests | One current agreement, clear options and confirmation of accepted changes |
| Duty manager / venue authority | Release decisions, staffing, permitted tradeoffs and escalation cover | An actionable problem with consequence, deadline, evidence and viable choices |
| Setup crew / hallkeepers | Actual condition, work progress, blockers and equipment location | Room packs, collection sequence, crew requirements and clear completion criteria |
| Catering and bar | Confirmed dietary/service information, equipment needs, readiness and substitutions | Relevant guest/service counts, timings, routes and changed requirements |
| AV / production / performers | Technical requirements, test outcome and operating contact | Access, approved placement, programme cues and verified technical constraints |
| Florist / décor / hire / courier | Delivery, quantities, collection and crew requirements | Correct door, receiver, unloading slot, permitted placement and heritage care instructions |
| Reception / security / stewards | Arrivals, visitor/contractor status, access and guest-flow issues | Expected arrivals, approved destinations, assistance actions and applicable access instructions |
| Cleaning / waste | Room availability, work completion, supplies and exceptions | Release times, next deadline, suitable methods and location-specific care guidance |
| Maintenance / competent specialist | Restriction, inspection/repair result and return-to-service decision | Exact fault location, observed symptom, operational impact and approved access window |
| Relief colleague | Questions, cross-check and explicit acceptance | Unresolved work, critical contacts, keys/equipment whereabouts and imminent deadlines |
| Management / finance | Policy and authorised follow-up decisions | Condition/return/discrepancy evidence; proposed charges remain unapproved until reviewed |
| Neighbours / public-facing contact | Noise/access complaints or agreed restrictions | A clear route to the duty role and updates appropriate to the issue |
| Emergency responders | Direction through established emergency arrangements | Approved venue address, access and incident information; the app must never obstruct those arrangements |

Guest requests can be made through staff or an accessible optional channel without requiring a guest account. A lost item, temperature request, spill or accessibility request gets an owner and visible outcome. Sensitive guest information is restricted to those who need it; it does not appear on a shared wall board or generic supplier export.

## The screen family

### 1. Today: the hallkeeper sheet

Keep the reference's broad ivory working plane, airy horizontal rhythm, warm dark text, delicate dividers, rounded cards, sage/apricot/honey surfaces and restrained room imagery. Deep forest anchors important actions; it does not become a new dark sidebar. Copper is an accent. Red is reserved for genuinely urgent conditions, always accompanied by words and a useful response.

The reference's coloured booking categories do not become readiness colours. In operations, every condition has text: waiting for access, preparing, awaiting check, released, occupied, clearing, unavailable. Preserve space and calm without making text faint. The room imagery brings the scale and significance of the building into the workspace; operational content remains readable and still.

Desktop composition:

- **Top:** venue, date/shift, current issued revision, last successful sync and accessible actions for the sheet, contacts and handover.
- **Left:** room identity/photo, current condition and next deadline; a whole-venue view remains available.
- **Centre:** a readable schedule spanning access, setup, public use and clearance, with the hallkeeper's next work exposed. Expand a room/event into its pack rather than opening another disconnected application.
- **Right:** a small “Needs attention” rail with the issue, consequence, accountable person, due time and next action. Routine updates stay in context.
- **At the point of work:** room, event, task, due time, owner, applicable instructions and “Done / Blocked / Need help”. “Done” records work; it is not automatically inspection or room release.

Avoid a giant chat panel, executive metrics, a readiness percentage, a field for every possible detail and an endlessly flashing notification centre. Readiness is explained by its blockers. “Awaiting the AV check” is more useful than “94% ready”.

### 2. Room work pack

One screen combines the approved plan and its revision, labelled setup reference, correct counts, pick locations, sequence, role owners, deadlines, access/service constraints, condition and focused room knowledge. A furniture movement list distinguishes keep, move, remove and bring in. Position identifiers on the plan link to rows so the crew can locate the instruction.

Offer a simple 2D plan first and an optional true 3D/spatial view when useful. A generated room image can be a design reference, never a measured layout, approved access route or verified equipment identity. Actual scene and stock sources retain their qualifications.

### 3. Changes and decisions

A side sheet shows **released → requested**, who requested it, when, and the source. Consequences cover layout, available stock, catering, labour, room/resource bookings, time, supplier needs and affected checks. Distinguish known impact from assumptions and unknowns.

Actions depend on authority: prepare a request, ask a relevant person, propose alternatives, or approve/decline when authorised. Show the exact audience and pending acknowledgements after a revision is issued. “Request captured”, “Decision approved”, “Instructions issued”, “Received”, “Acknowledged” and “Work completed” are different states.

### 4. Deliveries and collections

Arrival windows, access point, receiver, stock/equipment, unloading resources, contractor information and collections form one operational record. Record unexpected arrivals or substitutions without quietly changing the approved event. Photos and discrepancies can support receipt and returns. Avoid displaying lock codes, security details or other clients' data in general supplier views.

### 5. Phone on the floor

Default to the relevant room and next action, with large readable controls and concise instructions. Provide text, optional push-to-talk capture and optional read-aloud; no always-listening microphone or mandatory voice interaction. A dictated note becomes a reviewable transcription with uncertain names/counts visible. “Blocked” offers useful reasons and free text, then shows who is responsible for resolving it.

Make offline state explicit: issued revision, last sync, local pending actions and how to use established contact routes. Large touch targets, keyboard access, visible focus, high contrast, zoom/reflow and reduced motion are required. Do not squeeze the desktop calendar onto a phone.

### 6. Handover and close

Generate a short exceptions-led brief: what changed, next deadlines, remaining people/suppliers, room restrictions, keys/equipment, unresolved issues and commitments. The incoming colleague can question, cross-check and accept specific responsibility. Preserve items still awaiting acceptance. Closing includes consumables/replenishment, storage/returns, room condition, lost property, waste and applicable shutdown steps. Tomorrow's preparation and open work survive today's event closure.

If someone closes alone, support the venue's agreed check-in, expected finish, named responding contact, missed-contact escalation and loss-of-connectivity fallback. A saved check-in without a functioning response arrangement does not guarantee assistance. This applies [HSE lone-worker guidance](https://www.hse.gov.uk/lone-working/worker/index.htm) to the proposed closing workflow.

### 7. Paper and wall views

Generate paper from the same issued operational release: an A4 day summary with continuation room sheets when needed, readable greyscale labels, room/event/date on every page, version, issue time, page count, critical contacts, deadlines, owners and space for notes. Never shrink unlimited content to one page. A dated correction slip/reprint procedure identifies changes and superseded copies; a QR code alone cannot update paper.

A wall board is a privacy-filtered overview of rooms, readiness, arrivals and actionable issues. It does not reveal guest support details, private contacts, security instructions or commercial terms. Offline and stale states remain conspicuous.

## Tools that remove work

| Tool | What it actually does | Required boundary |
|---|---|---|
| Brief builder | Extracts proposed requirements once, links evidence, reuses confirmed data across role views | Conflicting/missing facts remain unresolved; no invented approval |
| Change impact preview | Shows which work, people and reservations a proposed change affects | Recompute against the current release; old approval cannot authorise a new request |
| Turnaround rehearsal | Tests delays and alternatives against real dependencies and available resources | Declared assumptions, uncertainty and an honest “no feasible option”; no invented staff or shortened checks |
| Collection planner | Groups equipment by verified location and routes work to reduce repeat journeys | Condition, reservation windows, trolley/crew/route constraints; estimates need local observation |
| Setup comparison | Shows keep/move/remove/add between room configurations | Uses the released plan and observed room state; simulation is not physical verification |
| Attention routing | Routes a request to its owner; escalates unresolved time-critical work under policy | Receipt/acknowledgement/completion kept distinct; accepted cover before redirecting responsibility |
| Venue memory | Finds a reviewed local instruction exactly where it is needed | Author, source, applicability, review/expiry and “colleague tip” separate from procedure |
| Issue-to-work-order | Turns an observed defect into assigned maintenance and tracks affected events | Apply restrictions according to fault implications and approved venue policy; safety-related restrictions require authorised return to service. Reports do not silently deduct or replace stock. |
| Ready-by estimate | Estimates completion from remaining dependencies, actual progress and available staff | Label estimates and uncertainty; no safety score or employee ranking |
| Quiet service cues | Shows the right cue to the responsible role, at the right time | Venue-approved noise/light/service constraints; sensitive periods do not hide urgent escalation |
| Accepted cover | Transfers routine responsibility for a break/shift with acknowledgment | No assumption that a muted notification means someone else is looking after the room |
| Returns and learning | Reconciles equipment, damage and useful lessons from the same event record | Review before charges, inventory corrections or revised procedures; configurable retention |

Later, source-grounded AI can answer “What has changed since yesterday?”, draft role briefs, transcribe observations, retrieve an approved AV instruction and propose recovery plans. Scheduling, permissions, transactions and physical sign-off stay with the systems and people that own them. Computer vision may flag a possible difference for inspection, but cannot declare an exit clear or a room safe. Device/sensor integration starts only with real supported hardware, freshness and failure behaviour. No such integrations are implied by this concept.

## One example, all the way through

**Illustrative scenario only:** Hillside House, Thursday 15 May 2025, 14:10. Heritage Trust Dinner is released at v7 for 120 guests in the Grand Hall, with 20 tables of six, room ready by 17:15 and doors at 18:00. The organiser requests 132 guests. Nora's proposed break cover is Maya from 15:00–15:20, awaiting acceptance; escalate to Ellis at 14:55 if unaccepted. Confirm return of routine hallkeeper duties to Nora at 15:20; her furniture collection begins 15:30 and physical room check is 17:15. This is not a real booking or verified venue capacity.

1. The request appears as **120 → 132, awaiting decision**. v7 still governs setup and the paper sheet.
2. Arithmetic suggests two extra tables and twelve chairs. The system must still check layout suitability, available equipment over the full interval, handling, staff time, catering confirmation and applicable room limits. It does not equate arithmetic with feasibility.
3. The duty role sees “Additional stock not yet confirmed; revised plan awaiting review”. Setup work unaffected by the request can continue. Work depending on the new plan waits.
4. If a feasible approved option exists, the authorised person issues v8. If not, they can retain 120 or agree another feasible arrangement; the original plan is not silently corrupted.
5. The relevant setup and catering owners receive the exact changes. Their acknowledgements are tracked separately. Only affected completed checks reopen; the old record remains visible.
6. The hallkeeper's pick list and sequence reflect the issued option. The room becomes awaiting release check when preparation is complete; it does not become released because all boxes are ticked.
7. If the device is offline, it continues showing v7 with its last sync time and pending actions. Staff use established contact arrangements for critical changes. An offline copy cannot know that an unseen v8 exists.
8. At handover the incoming colleague sees the current known revision, unresolved confirmations and next deadline, cross-checks with the outgoing colleague and accepts responsibility. Closing work continues until completed or accepted by a named successor.

## The underlying operational contract

These are proposed requirements, not new API claims. Implement them through the active platform lane and accepted applicable architecture decisions.

- **Shared authority:** booking/phase records own schedule; an approved operational release references exact configuration, stock assumptions and instructions. Sheet, board, mobile and PDF are views of that release. Actual observations do not overwrite scheduled times.
- **Identity and history:** every action binds venue, event, room/phase, release revision and actor. Record source time, recorded time and the venue timezone, including overnight work and daylight-saving transitions. Preserve historical releases and their evidence under approved retention rules.
- **Separate states:** request ≠ approval ≠ release ≠ notification ≠ acknowledgement ≠ completion ≠ inspection ≠ operational release of the room. “Unknown”, “not required”, “not yet checked”, “blocked” and “complete” are distinct.
- **Dependencies:** work links to prerequisites, people/skills, equipment, access, location and windows. Changing a prerequisite invalidates relevant checks, with an explanation. Reassignment follows venue policy with explicit acceptance and escalation on absence.
- **Concurrency and recovery:** use version checks and idempotent desired-state commands; preserve a stable command identity after an uncertain response. Show conflict-resolution choices without silently replaying work against the wrong release.
- **Offline scope:** authorised cached packs, least necessary sensitive data, visible freshness and pending states, controlled expiry, device access policy and reconciliation. Never promise immediate remote revocation on a disconnected device. Cold start, expiry, reconnect and conflicting edits need actual tests.
- **Privacy:** venue-scoped access on the server, role-specific views and exports, restricted access/health information, no alarm codes on wall sheets. External sharing and communications require the appropriate user/venue authorisation.
- **Attention:** configurable urgency tied to consequence and time; routine digests, actionable escalation, accepted cover and acknowledgement-to-quiet where appropriate. AI confidence is not urgency. Unacknowledged urgent work never disappears just because a toast expired.
- **Working states:** implemented asynchronous UI consumes the shared Activity components, keeps usable content visible and provides honest progress/error/cancel/retry. A queued offline action is a waiting state, not active computation.

## What the repository already offers, and what remains

Read-only source inspection in the shared checkout found useful foundations. These findings do not certify the current deployed site or an end-to-end integration; the checkout contains concurrent edits.

| Foundation | Inspected entry points | Opportunity / limit |
|---|---|---|
| Calendar-derived room lanes | `packages/web/src/pages/hallkeeper/DayBoardPage.tsx` | Read-only Day Board; connect work and request context without duplicating booking authority |
| Setup sheet and phase/zone/item model | `packages/web/src/pages/HallkeeperPage.tsx`, `packages/types/src/hallkeeper-v2.ts` | Plan-linked rows, completion, print/PDF and progress retry exist; unify presentation and strengthen readiness semantics |
| Event instructions | `packages/types/src/hallkeeper-instructions.ts` | Contacts, load-in, access, dietary summary and deadlines provide a starting contract |
| Snapshot handoff compiler | `packages/api/src/services/ops-compiler.ts`, `packages/types/src/ops-compiler.ts`, `packages/web/src/pages/OpsHandoffPage.tsx` | Picks, sequences, room flips and differences exist as a separate surface; integrate with the working day |
| Live tasks and issues | `packages/web/src/pages/EventDayOpsPage.tsx`, `packages/types/src/event-day-ops.ts` | Assignments, issues, acknowledgements and offline writes are source-inspected foundations; full offline shift operation is not proven |
| Sheet generation | `packages/api/src/services/hallkeeper-sheet-v2-data.ts` | `resolveTiming` currently derives an 18:00 UTC fallback and 90-minute setup from an enquiry date. Replace with authoritative released schedule in the implementation lane; do not preserve guessed times as facts. |

The current assembler can fall back to live content if a stored snapshot fails validation. A universal immutable/current-sheet guarantee is therefore not established. Existing “all checked” wording must not be treated as proof of physical inspection or room release. These are concrete integration requirements for T-605; this design task does not modify those shared source files.

## Delivery order and acceptance

1. **Make one event dependable:** reconcile schedule/release authority; connect Day Board, room sheet, existing task/issue records and handover; carry a controlled change through to truthful print. Preserve useful code and tests. Reproduce the schedule/snapshot/readiness gaps before changing them.
2. **Make a whole shift workable:** accepted cover, multiroom resource/time conflicts, arrivals/collections, mobile and a verified offline pack. Include empty, dense, blocked, stale, unauthorised and failure states in the design.
3. **Remove repeated effort:** stock location/picks, reviewed venue memory, reusable setup recipes, returns/work orders and quieter role communication.
4. **Add intelligence on evidence:** evaluated source extraction, retrieval, recovery options and learned local duration estimates. Measure benefits before claiming them; keep manual paths useful.

Acceptance should follow an actual event journey with venue staff. Proposed targets are to be agreed after a baseline, not fabricated achievements. Measure time to find the current instruction, clarification calls, changes missed, repeated entry, unnecessary journeys, late conflicts discovered, unaccepted work at shift end and staff-reported mental effort. Pair speed with accuracy and recovery; avoid ranking individual workers by checkbox volume.

Pressure-test the following before production acceptance:

- Extra guests while catering and the printed sheet retain an old revision.
- Two rooms need the same equipment; clearance, handling and setup exceed the apparent free gap.
- A delivery and public arrival collide on the same access route.
- A supplier arrives early with damaged or substituted items and a different collection time.
- A guest needs an agreed access arrangement while the lift is unavailable and an alternative is unverified.
- A room looks complete but a specialist check is missing; a later layout change invalidates an earlier check.
- One colleague is scheduled at reception, unloading and setup simultaneously; break cover is not accepted.
- A late event crosses midnight and shift change; the next morning's room setup is affected.
- Connectivity fails, the app restarts, two staff change related work and an old queued command reconnects after a new release.
- An external message fails or its delivery is uncertain; the UI must not display success without evidence.
- A snapshot is invalid, a contact cannot be loaded, or venue permission is lost; currentness/authority must not disappear quietly.
- Emergency instructions are needed with no network; the established emergency response is available without a form.
- Grey-scale paper, small phone, keyboard-only use, text enlargement, reduced motion and a crowded day remain readable.

Before implementing real venue recipes, collect current approved layouts/inventory locations, operating windows, staffing/roles, equipment instructions, access/evacuation information, retention/sharing rules and representative existing sheets. This is field validation work, not a prerequisite for generating the design images. Shadow a real opening, changeover and handover; ask the hallkeeper what they repeatedly have to remember, fetch, explain and chase. Their corrections should alter the workflow.

## Design decision for this delivery

Use the screenshot's light visual language and create one coherent hallkeeper workspace with progressive detail. Prioritise reliable changes, feasible work and accepted handover. Preserve physical judgement and local knowledge. No new architecture decision is treated as accepted, no current task ownership is transferred, and no visual concept is called deployed or aesthetically accepted.
