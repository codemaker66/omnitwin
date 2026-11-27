# Venviewer 2027: one platform in place of Salesforce and Cvent

Second edition of the design Blake approved on 18 October 2026
([2026-10-18-replacement-map-design.md](2026-10-18-replacement-map-design.md)). Design, 13 November 2026.
Status: **on 13 November 2026 Blake approved its first three pieces (0, A and B) to be designed, and answered
three more of its questions** (section 10, "Decided by Blake on 13 November"). The rest of section 10 is open,
and each piece still gets its own design and Blake's approval before it is built. Its task rows are T-665 and
the rows that cite this design in [the task list](../../state/tasks.md).

The October design stays in force: its map of the work, its all-day standard, its waves and its decisions.
Section 11 lists every place this edition changes it. The evidence (the re-traced inventory, the research, the
critiques and the build plan) is kept outside the repository. This text has been through six independent critics
and a final judge (appendix D).

## 1. The plan on one screen

**What we build first, and why.** Nearly every part of one booking already exists in Venviewer: the enquiry, the
held date, the proposal, the agreement a client signs, the deposit, the plan, the sheet, the supplier's pass, the
Day Board. They are not joined. One occasion is six separate records with six words for yes, a client who has
signed and paid still has no confirmed date, and every personal message leaves through somebody's own email. So
the first work is not a new feature. It is to bring the venue's old diary in, and to make what exists one thing:
one page per event, from the first call to the close of the night.

**What you will see, and when.** First a mock-up of that event page and of "Today", for your eye, and a short test
of whether venue people can find their way. Then the old diary's forward dates inside Venviewer, checked Saturday
by Saturday against the old system. Then the first real booking run here. No dates are promised. Two targets in
our own hands, 19 December and 31 January, are in section 5.6; the second needs the venue by 1 December.

**Why a venue would choose it.** Not for an assistant that drafts replies, or for showing a room in 3D: the larger
rivals are shipping assistants now, and Cvent already draws rooms in 3D. For three things no rival documents,
half-built here and finished in wave 1. Change a number, a date or a plan once, and every sheet, price and bill
follows, with every copy, on paper too, saying what changed. Dates held in rank, each with a decision date that
comes due, reminds its owner and offers the next in line. And the people who set the room working from the same
record as the people who sold it. Beneath those: the venue owns its clients and its money, and nobody pays to
take part.

**Where we really are.** On the plain core we are behind. A British tool launched this year does more of the
twenty everyday jobs than we do, for £79 a month (by its own help pages), and the two American incumbents
document 12 and 14 of the twenty in full. We finish 8. Wave 1 closes that gap. That is the entry ticket, not the
prize.

**What "replace" means in 2027.** Venue business leaves Salesforce first, and its members, crafts and giving
follow. For a venue, Cvent stays a source of enquiries, answered from Venviewer.

**What only you can do** (section 10): let me see Trades Hall's own Salesforce and Cvent; get the venue to sign a
one-page agreement and, by 1 December, name one real event, open its email domain to us and send its export;
approve the first three pieces (the plumbing, the old diary brought in, the join), which replaces your October
choice of the People Book first; set three deadlines (the agreement, the shadowed Saturday, the switch); and say
whether event planners are a 2027 goal.

## 2. Where we stand today

Five readers re-traced every job in the October inventory against today's live code and added what has shipped
since: 378 rows, each with a file and line, every one of 1,184 citations confirmed to point at a real line, and
the counts checked again by an independent reader. The tables are in appendix A. What is switched on in
production cannot be read from code, and is marked where it matters.

1. **About 30 distinct capabilities are new and live**, among them: the hallkeeper sheet whose printed copy says
   whether it is current, the venue inviting its own team and keeping its own rate list, viewings in the Diary,
   live co-editing of a plan, a view-only plan link, and the deletion of allergy notes the privacy policy promised.
2. **The jobs that stop a venue switching barely moved.** Missing went from 73 to 72. Of October's 275 jobs about
   twenty moved forward in four weeks. No money job, guest job or data job that a venue could actually use is live.
3. **About 60 jobs are built but out of reach**: no screen, a table nothing writes, or switched off. They include
   the People Book (your first build of October: complete underneath, with no screen), card deposits (complete,
   in test mode), the planner's new controls (off for everyone) and hold reminders (decided in September, never
   switched on).

**What a person meets today** (read from code, not timed):

- 63 addresses. The staff header mixes three kinds of control and keeps nine or ten desks under "More".
- One occasion lives as six records: enquiry, deal, booking, event, plan and proposal. A deal and a booking are
  not linked. Six words say yes (Approve, Approved, Accepted, Won, Confirm it, Confirmed).
- The same headcount sits in six places, and the event's own count is 0 on every event.
- Every personal send (a reply, a proposal, an agreement, a deposit request, a supplier's pass) is pasted into the
  person's own email.
- Of the twenty everyday jobs, 8 can be finished inside the product, 7 partly, 5 not at all.

**What still stops a team switching, most damaging first:** money (no live payments, invoices, credit notes, VAT
or discounts); no way in or out for data; enquiries arrive only through the web form and nothing personal is sent
from the product; the function sheet has no menus, drinks, equipment or final numbers; there is no client record on
screen; a yes confirms nothing in the Diary; the Diary cannot model combined rooms, regular hirers or holds that
lapse; no forecast; nothing for guests beyond counts; and the venue's own facts are written into the code.

## 3. The shape: a platform you can hold in your head

Salesforce and Cvent daunt for the same reason: they grew by adding places. Our rule is the opposite. **The
platform can grow for ever; the number of places cannot.**

### 3.1 Two kinds of page, and lists that open them

Work lives in only two kinds of page: an **event**, and a **person** (or organisation). Everything else is a list
that opens one of them beside it. A list is never a second home for the same work. One box, Find, takes names,
dates, commands and plain questions.

| List | The question it answers | What it lists |
|---|---|---|
| **Today** | What needs me? | Owed things, soonest first, each with its owner and when it is due |
| **Diary** | What is happening, and when? | Events and held dates by day and room. The Day Board is its view of today; the rota is its view of who is working |
| **Events** | Where has each one got to? | Events by stage. Its first view is **Enquiries**, the desk you approved |
| **People** | Who is this? | Clients, organisations and suppliers |
| **Money** | What is owed and paid? | Money lines by state, each opening its event. It appears when there is money to show |
| **Venue** | What are our rules? | Where the rules live: rooms, furniture, rates, wording, the team. The building book is kept here, and its open items appear as lines in Today |

Reports are views of the list they summarise: conversion on Events, occupancy on the Diary, takings on Money, so
each person sees their own. Anyone who quotes can read the rate list. The bell is the count of Today. A client, a
guest, a supplier and a caterer get one page through a named link, with nothing to learn.

### 3.2 The event page grows with the event

- **It opens under its room**: the photograph, or the captured hall, with the facts in large numerals.
- **The facts that decide come first**: date, guests, room, stage and, for staff who may see it, money. Each held
  date shows its rank and its decision date in your words (1st option, 2nd option, Joint 1st). Each part of the
  day (ceremony, dinner, evening) has its own numbers.
- **One next step**, in the same place every time, with a short **Still needed** list under it: who owes what, by
  when, counted back from the date. Today is made of these lines.
- **One line when something has changed since you last looked.** Nothing otherwise.
- **Five sections, appearing as the event needs them, always in the same order:** Story (messages, calls, notes,
  changes, and everything that was sent), Room (the plan and the seating), The day (timetable, the sheet for each
  department, passes), People, Money (quote, agreement, payments, invoices).
- **Until someone works an enquiry it opens as the Enquiries panel you already approved**: the request, the room,
  the Diary's answer for the date, and the draft reply. Nothing empty is shown.
- **Stage, not conversion.** Elsewhere a lead becomes an opportunity, then a booking, then an event: three or four
  records. Here an enquiry becomes one event the moment someone first works it (a reply, a held date, a price),
  and stays that event to the end. Its stage is worked out from the record, never typed. Proposed stages, for
  you to choose: Enquiry, Provisional, Confirmed, Done; or it closes as Lost or Cancelled, with a reason.
  "Accepted", "Signed" and "Deposit received" are lines in Still needed, under the venue's own rule for what
  confirms a booking, with named exceptions such as account clients. One enquiry can split into two events and
  two can merge, keeping the Story.
- It opens beside the list at a desk and as a full page on a phone.

### 3.3 Today is one honest list

One list of owed things, soonest first. Each line is one event or person, with its owner and when it is due, and
opens beside the list. The counts by kind (to answer, to decide, money, numbers, the floor) are the filters, as on
the Enquiries desk. A person's roles decide only what may appear, so one person who sells, coordinates and chases
money has one list, not three. Unowned work says "take it".

Today may only say "nothing else is owed here today" about what it can see. Until each source is built it names
what it does not watch ("not yet watched here: bank payments, caterers' numbers"). A tick nobody checked is one
of the October design's anti-goals.

### 3.4 The hallkeeper

Printed sheet first, then phone and tablet, with a night theme; a duty manager at a desk sees the same board. On
duty, a hallkeeper's Today opens on the Day Board (tonight's rooms, the sheet and what changed since the version
they last saw, ticks by zone, requests, who to ring tonight) with the owed lines beside it and the close of the
building at the end. Off duty it is the same list as everyone's. It works with no signal: ticks and observations
already queue. A change made after the sheet was printed reaches the person on duty by a route that does not need
the app, a text or a recorded call from the office, and the old printout's code then says "superseded". On a
phone the hallkeeper's bar is Today, Diary and Find.

### 3.5 It is the desk you approved, not a generic shell

Every list is the desk composition: one sentence of real counts, the copper plane whose counts are the filters
(which replaces most sub-menus), the ledger, and the record in the forest panel beside it. The Diary keeps the
full desk composition you chose for it on 26 September, its time grid on the sheet. The Day Board and the planner
keep their own. The event opening under its room, with its facts in large numerals, is the room felt at full
scale, from a calm desk.

### 3.6 Words are proposals until venue people choose them

"House", "Story", "stage" and "pipeline" are not office words, and six words for yes is five too many. Every
place name, section name and stage word goes into the first-click test beside trade alternatives (Venue or
Settings; Story or History; Events or Bookings), and you choose from what venue people actually pick.

### 3.7 The rules of the shape

These join the all-day standard, which already requires that everything needed is on the screen that holds the
action and that the room is one step away.

| Check | Rule |
|---|---|
| SHAPE-1 | At most six places in a fixed order, and fewer until a place has something in it. A place is added only if the first-click test fails without it |
| SHAPE-2 | One home: each of the twenty jobs passes the first-click test, eight in ten first clicks right |
| SHAPE-3 | One next step, in the same position, with what is still needed beneath it |
| SHAPE-4 | The facts first, to those entitled. Staff see date, guests, room, stage, money. Floor sheets lead with access time, doors, room, layout, numbers and what changed. An outsider sees money only if it is theirs |
| SHAPE-5 | When something changed since you last looked, one line says so |
| SHAPE-6 | Change a rule where you see its effect: a price opens its rate, a sentence opens its template |
| SHAPE-7 | Words in, where words are the input: a phone or walk-in enquiry, a pasted email, a note of a call. A person confirms what was understood. Money records never start from a sentence, and every job has a path with the assistant off |
| SHAPE-8 | Every queue uses the desk composition, the same keys and one glossary |
| SHAPE-9 | The only setup is the venue's own facts (rooms, rates, team, VAT position, terms), taken from the import where possible. A missing fact shows as a gap with a person to ask |

### 3.8 States people meet every day

| State | What happens |
|---|---|
| A notification | It is a line in Today; the bell is only its count |
| A phone, for desk roles | Today, Diary, Events and Find in the bar; the rest one step away |
| Search results | Open as the Events or People list, filtered, with the record beside |
| Printing | The week's sheets, table plans and place cards print from a filtered list |
| The first day at a new venue | The first screen is the import; each empty place says in one line how it fills |
| A refusal or a failed save | A refusal names who can grant access; a failed save keeps the work |
| A person at two venues | One Today across both. Today a person belongs to one venue, so this waits for wave 4 |
| A plan with no event yet | A walk-in's sketch or a standard set-up starts from Find, and joins an event later |

### 3.9 Tested before it is built

1. **The baseline**: today's navigation, counted (done).
2. **A first-click test with the place names on cards, before any screen exists**: the twenty jobs and the
   doubtful cases (a deposit that has arrived, a supplier's question, tomorrow's set-up, the rota, a report) as
   tasks, with the Trades Hall team and at least five outside venue people.
3. **A mock-up of Today and one event page**, in the house style with real Trades Hall content. You judge it.

## 4. Why a venue would choose it

### 4.1 The honest position

The comparison is not only Salesforce and Cvent. A UK venue also chooses between British tools. The table is from
help pages, search excerpts and prices (Cvent from search excerpts only); nobody has tested the rivals by hand.
Their first job is a phone enquiry, which we cannot yet log.

| Rival | What it is | Price | Of the twenty jobs: yes / partly / no |
|---|---|---|---|
| Plain Salesforce | A sales database. No record holds a room against time | £20 to $550 a person a month, by edition | 6 / 8 / 6. It cannot check a date, hold or move a hold, take a deposit, approve a plan or invoice |
| Amadeus Delphi | Venue sales and events on Salesforce, shaped for hotels | Not published | 12 / 8 / 0. Final numbers take 21 to 31 clicks across four tools |
| Cvent | A marketplace where planners send requests to venues, plus tools for planners | Free listing; venues pay to be seen | 0 / 9 / 11 not covered, from the venue's side |
| Tripleseat | Venue sales and events, American. The easiest incumbent | Not published | 14 / 6 / 0. About half in 2 to 4 clicks; a credit only as a negative payment; no supplier role |
| VenueBook | British, launched 2026 by one founder: enquiries to function sheets, e-signature, card deposits, a client portal, a 2D table plan, a one-way link to Xero | £79 a month plus VAT, no contract | 9 / 10 / 1 |
| Hallmaster | British, 3,500 halls: a diary with invoicing | £195 to £279 a year, VAT included | 6 / 7 / 7 |
| **Venviewer today** | | | **8 / 7 / 5** |

What Trades Hall itself runs (Salesforce with something customised, or the separate sales-and-catering software
you mentioned on 26 September) is unknown until we see it. Nothing here is claimed as "easier than what Trades
Hall has" until then.

### 4.2 Three things no rival documents

Each says what we have today and what is still to build. The repository is public, so a rival can check.

1. **Change it once.** One change to a number, a date or a plan moves the sheet, the plan, the price and the
   bill. Every copy knows its version and says what changed, on paper as well as on screen.
   *Today:* the sheet has versions, its printed code answers "current" or "superseded", ticks belong to the event,
   and a hold or booking cannot exist without its event. *To build:* numbers for each part of the day, and the
   join. *Rivals:* Delphi's deposit schedule and room plan do not follow a changed number (its own help says so);
   Tripleseat's sheet is live for its readers but documents no version and no notice of what changed; VenueBook's
   documents no versions; Hallmaster has no sheet.
2. **Dates held properly.** Several holds on one date in rank order, each with a decision date and an owner. When
   a date comes due its owner is reminded; release is one tap; the next in line's owner is told, with a drafted
   email to send.
   *Today:* ranks, decision dates, clash checks, and clients proposing times that the house holds. *To build:*
   reminders switched on, lapsing, regular hirers' series, rooms sold together. *Rivals:* Salesforce cannot hold a
   room; VenueBook, Hallmaster and Tripleseat document no rank and no expiry; Momentus ranks holds.
3. **The floor and the room in the same system as the sale.** The hallkeeper's sheet, the Day Board, supplier
   passes, room observations, Martyn's Law prompts on each event, and the measured Grand Hall in which the client
   approved the plan.
   *Today:* all of those. *Not yet:* a close of the night; rooms other than the Grand Hall are plain shapes; the
   captured room is held back. *Rivals:* none documents a supplier's pass, an issue log during an event, plan
   approval or a measured 3D room. VenueBook has a to-scale 2D table plan; Cvent draws seating from a sentence,
   in beta.

And one thing about the business rather than the product: **the venue owns its clients and its money, and nobody
pays to take part.** The venue is the merchant on its own payment account; there is no commission and no fee to
be seen; clients, guests, suppliers and caterers are free; everything will leave on any day (piece K; nothing
exports today). Salesforce charges for every person. Cvent charges venues to be seen. Marketplaces take 10 to 15
per cent. *This is a principle until you set the price* (section 6), and at £79 a month a British rival already
includes everything.

**Facts that can be trusted** is a discipline, not a moat: every figure with who stated it and when, a gap shown
as a person to ask, and an assistant that may not state a date, price or capacity the record does not hold.

### 4.3 What will be ordinary by the end of 2027, and what we leave to them

By then the larger venue systems will read an enquiry and draft the reply, answer questions about the figures in
plain words, and offer a way in for assistants. Cvent will draw seating from a sentence in 3D. We need the first
of these (drafts are in pilot at Trades Hall) and will not win the others as races. We leave to them: deep
reporting, deep sales-database features, generating layouts by machine, marketplaces, and benchmarks across
thousands of venues, which one venue cannot have and we will not pretend to. Appendix B has the detail.

### 4.4 What "replace" means in 2027

- **Salesforce:** bookings, clients and money leave it first (wave 1a ends with the old diary read-only for venue
  business). Members, crafts and giving follow with their own design, and then it is switched off entirely, as
  you decided on 18 October.
- **Cvent, for a venue:** Cvent stays a source of enquiries. They arrive in the venue's own list and are answered
  from there. Its tools for running an event are replaced for the events the venue hosts (guests and seating in
  wave 2, tables and tickets in wave 3).
- **Cvent, for a planner:** an open decision (section 10, item 5).

### 4.5 The honest limits

One venue, and nobody at it yet watched at work: until the proofs of section 7 have happened, "far better" is a
design claim. Cvent's planners are Cvent's. A conference of thousands is not what a hall for 250 needs.

## 5. The programme

### 5.1 Before any building

- **A one-page agreement with Trades Hall.** A named lead at the venue with authority over how the office works
  and what things are called; two hours a week; dates for the export, the shadowed Saturday and the parallel
  month; the price after the pilot; being a reference; the data-processing terms. If it is not signed by a date
  you set, a second partner venue is sought and the plan does not wait for Trades Hall.
- **The look at their Salesforce and Cvent.** It fixes what wave 1a contains, and decides which system piece A
  reads and which one goes read-only.
- **The first-click test and the mock-up** (3.9).
- **The office's quiet weeks and its financial year**, so the baseline, the first real booking and the parallel
  month fall on dates the office can bear. December and Burns season are not those dates.

### 5.2 Wave 1a: the switch

**Done when the old diary (Salesforce, or the sales-and-catering software, whichever holds the bookings) has been
read-only for venue business for four weeks, with the forward value matched to the penny at the switch.** It
holds what that system does today, the join, and what makes the switch safe (pieces 0, I, J and K). The later
steps of H and G's caterer page may ship in 1a but do not gate it. The list is provisional until we have seen the
old system. At most three pieces are in build at once. Each gets a short design and your approval before any
code. An engineer's reading of the code shaped the list: the join is a change to the database before it is a
change to any screen, and five pieces leaned on plumbing nobody has built.

- **0. The plumbing.** A list in the database of jobs and sends still to do, so reminders, sends, payments and
  deletions happen later, exactly once, and survive a restart. A sending address and verified domain for each
  venue (this needs the venue's access to its email domain). Mail coming in, with a reply address for each event.
  Encrypted storage for each venue's keys.
  *Done when* a reminder goes out once, even with two servers, and a reply to a sent message lands on its event.
- **A. The Diary holds the whole book.** The forward bookings and holds brought in from the old diary: dates,
  rooms, ranks, decision dates, owners and client contacts, without money. Each imported row keeps where it came
  from, so running it twice changes nothing; a dry-run report and a review of the mapping come first. A regular
  hirer's term entered once, with its exceptions. Rooms sold together block each other. Set-up and breakdown
  either side. A lapsed hold comes up for release in one tap, and the next in line's owner is told, with a drafted
  email to send. Reminders on, after your dry run.
  *Done when* the sales lead checks thirty forward Saturdays against the old diary and finds no difference, and a
  real term of weekly bookings is entered once.
- **B. The spine.** Today a hold or booking cannot exist without its event, and nothing else is tied to it:
  proposals, agreements and deposits reach an event only through whoever drew a plan. This gives the rest the
  same rule. Proposals, deals and worked enquiries point at their event; agreements and payments reach it through
  the proposal; who may see an event is recorded on the event. Old records are joined, with the doubtful ones on a
  review list that has a screen. The money design is settled here, before anything takes money: one ledger of
  payments (card, bank, by hand), a schedule of what is due, a payment account for each venue, and agreements
  that name the bookings they cover.
  *Done when* a check that runs on every change and in production finds no live proposal, agreement or deposit
  request without its event, and a test fails if one client can see another's event.
- **C. One event, one page.** The staff event page of 3.2 and the Events list, opened from where people already
  work. An owner on every enquiry and event. The stage and Still needed. Numbers shown with their sources, never
  0 as a fact. Split and merge.
  *Done when* from any part of an occasion one step shows the rest, and no screen says opportunity,
  configuration or handoff pack.
- **D. People, on screen.** The People list and the person's page with one timeline; old enquiries linked to
  their person, with a review list. A call or note on a person or an event, from anywhere. "Same again": last
  year's event as this year's draft. The venue's own extra fields.
  *Done when* a repeat society dinner is made from last year's in under a minute, and a duplicate is merged and
  unmerged.
- **E. The yes that confirms.** A yes given by phone. The venue's terms kept once. A countersigned copy to both
  sides. A deposit by card into the venue's own account, by bank, or recorded by hand. The venue's own confirm
  rule, with exceptions that need a reason. "Ready to confirm" in the Diary; one tap by a named person; the next
  in line's owner told, with a drafted email. Real money moves only on your explicit yes.
  *Done when*, on a real booking, it is accept, sign, pay, one tap, and nobody re-types anything.
- **F. Send from here.** The proposal, agreement, deposit request and pass sent from the product in the venue's
  name, the exact words shown first. Replies land on the event. A phone or walk-in enquiry with the caller's
  details, from one sentence.
  *Done when* a real booking has no pasted links, and a phone enquiry is logged in 15 seconds, timed.
- **G. One number.** Guaranteed, expected and set-for numbers for each part of the day, each read by the thing
  that needs it: prices read guaranteed, the sheet reads set-for, the plan reads expected. Diets as counts;
  timings, menus, drinks and equipment. A cut-off with a change log after it. A sheet for each department. A
  change after printing reaches the person on duty without the app. A line changed without opening the 3D
  planner. One standing page for each partner caterer.
  *Done when* a wedding changes one of its three numbers and only that part's sheet and price follow.
- **H. The places and Today.** In small steps, each shippable alone. Each role lands on its own desk. The header
  is grouped into the places that already have content, with every old address still working. Today begins as a
  roll-up of the queues that exist. People and Money appear when they have something in them. Commands in Find.
  The glossary enforced.
  *Done when* the first-click test passes on the built product.
- **I. Keeping and deleting.** One person erased or exported on request. The 24-month deletion the privacy policy
  promises, on a schedule the solicitor approves (signed agreements and payments are kept as the law requires).
  *Done when* one erasure is carried out and the deletion job runs.
- **J. The trust pack.** A signed processor agreement and the list of sub-processors. Alerts to a phone when the
  service is down, and a public status page. A second server. A nightly backup with a timed restore drill. Cyber
  Essentials. Insurance. A written promise of support on event nights, and who answers when you cannot. An exit
  promise: a full export, then ninety days read-only.
  *Done when* all of it is in place before the parallel month starts.
- **K. Switching day.** Everything exportable first: records, signed papers, calendar feeds. The money history.
  The parallel month.
  *Done when* the test at the top of this section is met.

Order and why. 0, A and B come first: nothing can be sent, reminded or paid without the plumbing; a real booking
cannot go into a diary that does not hold the book; and every later screen hangs on the spine. Then C, the first
steps of H and the floor work of wave 1b can run side by side. Then D and E. Then F's sends, which touch the same
screens as E. Then G, and I once D's links and the plumbing exist. J and K's export run alongside from the first
day, because they need other people's time, not building time. Only one piece that changes the database lands at
a time; the others catch up after it.

### 5.3 Wave 1b: the lead

These make Venviewer better than anything the office has had. They may start early. They never gate the switch.
**Done when the venue's accountant reconciles one month to the penny against the old system and the bank**, which
was October's proof for wave 1.

- **Money right.** VAT by line, discounts and packages on a quote. The balance and instalments. A damage deposit
  and its return. A cancellation shown with its clause and its arithmetic for a named person to decide. Invoices
  and credit notes numbered by the venue's own accounting system, starting as a clean export the accountant
  imports and becoming a push with payment status coming back. The Money list.
- **Close the building.** Once a night, over every room used, not once per event. A building book for what no
  event owns (a false alarm, a door that will not latch), which the morning shift reads first. The hallkeeper
  records facts: when the last guest left, what was used, any damage, with a photograph. A named person in the
  office turns them into a charge the next working day. The closing time is offered as the hours actually worked.
  It is finished in airplane mode at the worst spot the signal walk finds.
- **Email in, and the first answer drafted**: the date checked, the price from the rate list, each figure with
  its source, for a person to read and send.
- **The week's hours suggested from the Diary**; tasks given to named people; the supplier book with arrival
  times.
- **Switch on what is built**, wherever a piece touches it; and the all-day standard's automatic checks on every
  screen a piece touches.

### 5.4 The weekly jobs

The twenty jobs are not the whole week. These eleven are where spreadsheets survive. In every wave each one is
either done inside the product or named as still done elsewhere, and the list is published with the wave.

A client moves the date of a signed, paid booking. A second enquiry wants a held Saturday and the first is asked
to decide. A viewing is booked and followed up. A booking is cancelled, with its charge and credit note. A regular
hirer's term is entered. A damage deposit is taken and returned. Final numbers are chased before the caterer's
cut-off. A lapsed hold is released. The week's sheets go to the operations meeting. The month's figures go to the
board. A hallkeeper sets a room and turns it round between events.

### 5.5 Waves 2 to 4: as approved, with these changes

- **A wave's build starts when the wave before it is proved.** October allowed an earlier start. With one founder
  and one venue, four open waves is how breadth kills quality.
- **Wave 2 gains three things.** The venue's facts become a record its admin keeps, with who stated each: today
  they are written into the code for Trades Hall, so a second venue would have none (the same is true of the
  list of venues assistants can read, and of the operating settings). Clients arrive by link without Venviewer's
  staff. And a modest Martyn's Law record in the shape of the regulator's own planning tool (no start date is set
  as of 9 November; a hall for 200 to 799 is in the lighter tier; whether private hire counts is not settled).
- **Wave 3 stays as approved**: tables, tickets, and a conference day from registration to the door, sized for
  the hall. Nothing is cut. Abstracts, exhibitors and hotel blocks are imported from the tools planners already
  use, as October said.
- **The way in for assistants stays honest and small.** It exists, is read-only as you said on 8 October, and
  states only what the record holds. No edge is claimed for it until planners' assistants are seen to book halls,
  which the evidence does not expect in 2027.

### 5.6 Pace, not dates

No calendar is promised. The last four weeks saw 237 merges and moved about twenty of October's 275 jobs, so
merges predict nothing. Each piece is estimated from the bottom up when it is designed. The first piece's real
duration re-estimates the rest. Each fortnight reports how many wave-1 jobs became live. Proofs that need the
venue run on their own clock, which starts when the venue says yes. If wave 1a's proof is not met by a date you
set, scope is cut, not the bar.

Two targets are worth naming because they are mostly in our own hands. They are an engineer's estimate, not a
promise. By 19 December: the plumbing and the spine live, the database check at zero in production, and a staff
event page to read. By 31 January: one real Trades Hall booking taken from enquiry to Confirmed, with its
proposal, agreement and deposit request sent from the product. That one needs the venue, by 1 December, to name
the event, open its email domain to us and send its export, because the booking cannot go into a diary that does
not yet hold the book (piece A). Wave 1a's proof is spring 2027 at the earliest.

### 5.7 What we will not build

- A marketplace of venues, until there are many venues.
- Hotel bedrooms: room blocks, rooming lists, posting to a hotel's own system.
- New kinds of record, a layout editor or a workflow builder. That is where Salesforce's dread comes from. A venue
  does get its own typed extra fields on the event, the person and the organisation, in one fixed panel,
  searchable, imported and exported; and a fixed menu of rules (remind, send an approved wording, escalate) with
  on, off and timing. The look at their Salesforce sets how many.
- A price per person, or modules sold separately.
- A general ledger, or holding a client's money.
- Rankings of staff, streaks, or any watching of individual workers.
- An assistant that sends, confirms or decides by itself.

### 5.8 How the work runs

- At most three pieces in build, each in its own lane, merged one at a time through the release lead. Each lane
  changes only its own screens; only one database change lands at a time.
- Every piece: a short design you approve, a plan, tests first, an independent review, a check on the live site.
- **Design approvals never proceed by default.** Agents may ship anything behind a switch and any wording inside
  the glossary. You decide price, legal terms, money movement and the first version of anything a client sees.
  The venue's lead decides how staff work.
- Every new link gets what holds and bookings already have: a rule in the database, and a check that runs on
  every change and in production.
- A piece is finished when its test has been watched on real work, not when it merges.

## 6. Who buys next

The first draft had a product and no business. This track runs beside the build, with its own test: **a second
venue signed and paying before wave 2's build starts.** Venues switch in windows, so conversations start now.

- **The buyer, proposed:** a UK independent venue with one to six rooms for hire and 100 to 500 guests: heritage
  and society halls, livery and guild halls, civic and charity-owned venues. What they run on today is not known;
  the research could not find what any Scottish heritage hall uses. Ten conversations will say.
- **Venue two** should be the same kind of buyer, and differ in the one way the product must stretch: for
  example, its own kitchen where Trades Hall has partner caterers.
- **The list:** thirty named venues of that kind, starting from the Trades House's own network.
- **What a new venue costs us:** the import (days), its facts (an hour), and its rooms. A drawn room is quick; a
  measured room is a visit and processing, priced. "Live within a week" means on drawn rooms.
- **The price** is yours to set, and it chooses the buyer. Three old drafts in the repository disagree (£19 to
  £29 for Trades Hall; £99 to £999 with staff caps; £490 to £1,990 with a capture fee). The principle proposed:
  the venue pays and nobody else does; a flat monthly price by venue size, never per person; the assistant
  included up to a stated fair-use allowance; a one-off fee for import and room capture, waived on an annual
  plan; monthly with no minimum term always available; a yes or no on a disclosed fee per payment decided before
  tickets (wave 3). It must be explainable beside £79 a month.

## 7. How we would know

Confidence must not run ahead of evidence. Each proof says what result would mean we are wrong.

| | Proof | It shows | It fails if, and then |
|---|---|---|---|
| 1 | **The inventory**, recounted independently each wave, one capability to a row | What exists | Our counts flatter us: recount before anything is claimed |
| 2 | **The scoreboard** (appendix C): the twenty jobs as scripted paths, counted by someone other than the builder, clicks and typed fields, beside the rivals' documented counts | The shortest path exists, and stays short | A job takes more steps than the best rival: redesign it before the next piece |
| 3 | **The baseline**: the office's present tools timed on the twenty jobs and the weekly jobs by an independent observer, and a standard ten-question ease score from the people who use them | What "better" must beat | The present tools are already within a fifth of a target: drop that job from the claim |
| 4 | **One shadowed Saturday**, with a two-phone signal walk | What the night really needs | The night's three worst problems are not in the plan: redesign those pieces before they are built |
| 5 | **One real booking**, enquiry to the night itself, in Venviewer | The path works on real work | Any step that wave 1a claims happens outside Venviewer: wave 1a is not done. The close and the invoice join this proof when wave 1b ships them |
| 6 | **The same people, timed again** on Venviewer, job by job (time, completion, errors, a one-question ease rating), and their ease score again after eight weeks | It is easier for the people who switched | A job is not faster, or the score does not beat their old tools': that job is redesigned and not claimed |
| 7 | **The parallel month**: forward value to the penny; the old diary unopened for four weeks; a list of every spreadsheet, paper form and routine phone call still in use | The venue can switch | Any difference, or any use of the old diary: no switch |
| 8 | **Money changes hands**: Trades Hall renews at its stated price; venue two pays from its first month | It is a business | Nobody pays: the price or the buyer is wrong |
| 9 | **Strangers choose**: experienced venue staff who have used neither product, half starting on each, the same seeded data, an independent moderator, tasks and pass marks written down first; against the best venue rival available on a trial, where its terms allow | It is far better, to people with no reason to be kind | Fewer than 34 of 42 prefer it: we say "preferred by x of n", not "far and away" |
| 10 | **A second venue** live within a week on drawn rooms, with no change to the code once wave 2 has made the venue's facts a record | It is a platform | Any code change: no such claim |

October's bar for proof 9 was nine of twelve in a "blind" test, with an ease score of 80. Nine of twelve happens
by chance about one time in fourteen, and nobody can be blind to which product they are using. So the bar is
raised, half the people start on each product, and the fixed score becomes "beats the same people's score on
their old tools". No sample under eight is reported as a rate. Nothing from proof 3 onward is claimed until it
has happened.

## 8. What could sink this

Written as if it is November 2027 and the plan failed. Each guard is a trigger and an action, not a hope.

| What went wrong | The guard |
|---|---|
| The venue never gave the time. Every proof from 3 up needs it, and the September ask for one Saturday is still open | The one-page agreement (5.1) with dates. If the Saturday has not happened by a date you set, we shadow another venue's night and mark the floor pieces as hypotheses; if the agreement is not signed, a second partner is sought |
| We measured ourselves against the wrong system | Nothing is claimed against "what Trades Hall has" until we have seen it |
| We built widely and nothing reached the standard | Three pieces at most. A wave starts when the last is proved. Scope is cut before the bar |
| Everything waited on you | One short sitting a week, every question a button. Agents ship behind switches; your approval is needed only where 5.8 says |
| We ran two diaries for months and the office gave up | The forward book comes in first (piece A), checked against the old diary |
| A rival offered venues like Trades Hall a free year and a done-for-you move | Be live on the three things of 4.2 and on UK money before any outside venue is approached, and sell exactly those |
| A partner sold "keep Salesforce, add venue tools" | The look at their Salesforce answers what is customised before a partner does |
| "One founder, one venue: how safe are you?" | The trust pack (piece J), finished before the parallel month, and one named reference venue |
| An outage on a Saturday night | A second server, alerts to a phone, a restore drill, and floor tools that work with no signal |
| One client saw another's data | The test in piece B gates every release |
| A money or legal mistake | The venue is the merchant and its accounts are the ledger. The accountant and a Scottish solicitor review before the first real agreement and invoice. No screen says "legally binding" |
| The old book would not move | The look first; a dry run; the old system read-only as the fallback |
| A privacy failure with guests' diets or access needs | Nothing named is collected before the signed impact assessment; held per event, encrypted, destroyed 14 days after |
| The assistant said something untrue in the venue's name | It may state only what the record holds; a person reads the exact words; tested on every release |
| Trades Hall is unusual and the product fitted only it | Every venue rule is a setting with a UK default. Venue two is signed before wave 2 is built |
| Planners never came | Decided, not assumed: section 10, item 5 |

## 9. Approaches considered

| Approach | What it trades |
|---|---|
| A. Parity first: close every missing row, family by family | Looks like progress; produces something shaped like Salesforce; nothing proven on real work until the end |
| **B. One real booking first, then thicken (chosen)** | Fewer new features early; needs the venue's time. Every step ends on real work |
| C. Sit on top of Salesforce and Cvent, syncing both ways | Fast to adopt; their limits and prices become ours for ever; you decided Salesforce goes |
| D. Marketplace first | Needs many venues before it is worth a planner's visit |

## 10. What I need from Blake

The seven decisions of 18 October stand, except the first build (item 3). These are new, in order of what they
unlock.

**Decided by Blake on 13 November:** item 1, a read-only login, which he will arrange; item 3, approved (the
plumbing, the old diary brought in and the spine are designed first, each design coming to him before any code);
item 5, planners "asap", so a planner track starts now beside wave 1a, design first; and the next step, "plan out
the build, then orchestrate so it fits as part of venviewer capability" (the build plan and its lanes are in
the [13 November session log](../../sessions/2026-11-13.md)).

| # | What | Recommended |
|---|---|---|
| 1 | **A look at Trades Hall's own Salesforce and Cvent**, by a read-only login or an export: which system holds the bookings, and what the hall uses Cvent for. It is the one piece of raw material this plan lacks | Arrange a read-only login; failing that, the office's weekly export |
| 2 | **The venue, in writing and by 1 December.** The one-page agreement (5.1): a named lead, two hours a week. And three things by 1 December: one real event named, the hall's email domain opened to us, and the export sent | Put it to the Trades House this month |
| 3 | **The first three pieces**: the plumbing, the old diary brought in, and the spine (0, A and B), with wave 1 split into the switch and the lead. This replaces October's choice of the People Book first; its record is built and its screen is piece D | Approve 0, A and B first |
| 4 | **Three deadlines that are yours to set**: for the agreement, for the shadowed Saturday, and for the switch | Suggested: 1 December; 31 January (not in December); 31 May 2027 |
| 5 | **Are event planners a 2027 goal?** If yes, the way in is wave 2's guest list, seating and plan given free to any planner for an event at any venue, with the venue invited onto the event. If no, "every events manager" leaves the test of success for 2027 | Yes, after wave 2 is proved |
| 6 | **Members, crafts and giving**: venue business leaves Salesforce first; they follow with their own design | Agree the order |
| 7 | **The shape and its words**: judge the mock-up; choose the stage words and the place names from what venue people pick; and that an enquiry becomes its event when someone first works it, opening as the Enquiries panel until then | Yes to the last; the rest when the mock-up arrives |
| 8 | **The buyer and the price band** (section 6) | A band, before venue two is approached |
| 9 | **Two professionals**: the venue's accountant (VAT position, accounting system) and a Scottish solicitor (the terms, and how long signed papers are kept) | Ask the Trades House who they use |
| 10 | **Asked when their piece is designed**: which bookings may be confirmed without a deposit; whether a seller may place a Provisional hold while the caller is on the phone; whether Trades Hall takes deposits into its own payment account; whether the repository stays public once a second venue's settings enter it | |
| 11 | **Three things built and waiting on you**: the hold-reminder dry run, the planner's new controls, card deposits going live | One short sitting |

## 11. What this edition changes in the October design

1. **The order of wave 1.** The plumbing, the old diary brought in and the spine come first. October put the
   People Book first; its record is built, and its screen is now piece D.
2. **Wave 1 is split** into the switch (which gates turning the old diary read-only, and checks forward value)
   and the lead (which does not gate it). October's proof, "finance reconciles a month to the penny against the
   old system and the bank", becomes the lead's finish line.
3. **A wave's build waits for the last wave's proof.** October allowed an earlier start.
4. **The veterans' test** (October's AHEAD-4): nine of twelve "blind" becomes 34 of 42, half starting on each
   product. The fixed ease score of 80 becomes "beats the same people's score on their old tools". The comparison
   is with the best venue rival on trial, not with software from outside the industry.
5. **Martyn's Law** moves from wave 3 to wave 2, as a modest record.
6. **Members, crafts and giving** are sequenced after venue business. The decision to move them stands.
7. **Added:** the plumbing, the trust pack, the agreement with the venue, the commercial track, the weekly jobs.
8. **Words:** stage and place names are proposals to be tested. Your hold words of 26 September (Provisional,
   1st option, 2nd option, Joint 1st, Confirmed) are kept exactly, on each held date.
9. **The "no toolkit" rule** now allows the venue's own typed extra fields and a fixed menu of rules.

## Appendix A. The inventory

Rows, not distinct capabilities: the same capability sometimes sits in two or three rows.

| | Live | Partial | Missing | Built, no screen | Table only | Switched off | Unverified | Rows |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| October | 86 | 58 | 73 | 23 | 16 | 12 | 7 | 275 |
| 13 November | 142 | 80 | 72 | 29 | 18 | 27 | 10 | 378 |

| Family | Rows | Live | Partial | Built, out of reach | Missing |
|---|---:|---:|---:|---:|---:|
| A. Enquiries | 17 | 5 | 5 | 3 | 4 |
| B. Clients | 16 | 3 | 4 | 5 | 4 |
| C. Pipeline and forecast | 8 | 3 | 3 | 0 | 2 |
| D. The diary | 20 | 13 | 5 | 1 | 1 |
| E. Prices | 12 | 4 | 2 | 3 | 3 |
| F. Proposals | 28 | 12 | 4 | 6 | 5 |
| G. Agreements, deposits, payments | 14 | 0 | 2 | 5 | 7 |
| H. Invoices, VAT, accounts | 6 | 1 | 0 | 0 | 5 |
| I. The function sheet | 25 | 11 | 5 | 5 | 4 |
| J. Floor plans and seating | 31 | 13 | 10 | 5 | 3 |
| K. The day itself | 26 | 14 | 5 | 5 | 2 |
| L. Suppliers | 11 | 4 | 2 | 2 | 3 |
| M. The client's hub | 13 | 9 | 1 | 1 | 2 |
| N. Messages and email | 20 | 7 | 4 | 2 | 6 |
| O. Reports | 12 | 2 | 3 | 3 | 4 |
| P. Data in and out | 17 | 2 | 2 | 6 | 4 |
| Q. Team, privacy, platform | 28 | 8 | 8 | 5 | 5 |
| R. Guests and tickets | 8 | 1 | 1 | 0 | 6 |
| S. Drafting | 11 | 4 | 3 | 3 | 1 |
| T. Showing the venue | 14 | 4 | 1 | 6 | 1 |
| Distinctive (our judgement, not checked rival by rival) | 41 | 22 | 10 | 8 | 0 |

Unverified rows are left out of the second table. Money's one live row is the arithmetic of a quote; the guests'
one live row is the client's own allergy note. The list of built-but-unreachable jobs is kept with the evidence,
outside the repository.

## Appendix B. What will be ordinary by the end of 2027

From the horizon research (kept with the evidence, outside the repository), which marks each claim as the
vendor's own word, independent, or unconfirmed.

| Expected | Who has it | Us |
|---|---|---|
| An enquiry read and a reply drafted | Event Temple and Momentus (September 2026), iVvy (January), Tripleseat (early customers); Delphi turns emails into leads | Drafts in pilot at Trades Hall for summaries, proposals and briefs (by the pilot record; production settings were not readable) |
| Enquiries scored | Momentus; promised for Delphi | Not planned: an honest queue |
| Questions about the figures in plain words | Tripleseat, Cvent (beta), Momentus (unconfirmed) | Later, once the figures exist; left to them as a race |
| A way in for assistants | Hire Space is in private beta inside two general assistants; Salesforce and Cvent have announced theirs | Exists; read-only; states only what the record holds |
| Found by an assistant's search, with a profile score | Cvent (announced), Hire Space | Not without a marketplace; the venue's facts as a record help (wave 2) |
| A price from a brief | Hire Space | The price engine exists for staff; opens to clients when VAT is answered |
| Seating from a sentence, in 3D | Cvent (beta) | Behind on named seating (wave 2); ahead on the real room |
| Small bookings made alone, inside rules set by someone else | Tagvenue (for meeting space); Cvent Essentials (planners inside their own company's rules) | Wave 4 |
| Benchmarks across thousands of venues | Tripleseat | Cannot with one venue |
| A switch for the assistant per venue and per use | Event Temple | An operator setting today; a switch in Venue later |

Salesforce's assistant comes with its Core edition and above ($195 to $550 a person a month, with a yearly
allowance of actions before a charge of about ten cents each); its £20 and $100 editions remain. One analyst
counts three pricing changes in about eighteen months. Cvent has bought seven companies since 2024 (two of them
for about $700 million together) and takes no part in a venue's contracts.

## Appendix C. The scoreboard

Best-case paths on both sides: the rivals' from their own documentation, ours read from the code. Proof 6
replaces them with timed ones. Shown as clicks + typed fields. (d) was read on the vendor's own page; (i) is
inferred. Rival counts often start with the record already open; ours start from the first screen after sign-in.
"Best rival" is the lowest documented count among rivals that can do the whole job.

| # | Job | Venviewer today | Best rival, documented | VenueBook | Target |
|---|---|---|---|---|---|
| 1 | Log an enquiry | Web: 2 to 3 + 1. By phone, with the caller's details: cannot | Tripleseat 2 to 4 + 6 to 9 (d) | Yes | By phone: 2 + one sentence, read back |
| 2 | Reply to a web enquiry | Partly: written in the person's own email | Salesforce 5 to 6 + 3 to 4 (i) | Yes | 2: read the draft, send |
| 3 | Check a date across rooms | 1 to 3 + 1 | Delphi 1 to 3 + 1 to 3 (d) | Yes | Kept |
| 4 | Place a provisional hold | 4 + 3 | Tripleseat 3 + 1 (d), no expiry | Partly | 3, dates filled from the venue's rule |
| 5 | Move a hold | 1 to 3 + 0 to 2 | Delphi 2 to 3 + 0 (d) | Yes | Kept |
| 6 | Build and send a proposal | Partly: 8, then pasted into email | Delphi 3 to 6 + 6 to 10, plus Word (d) | Partly | 3, sent from the product |
| 7 | Record a signed agreement | The client can sign on their link; the venue cannot record one | Tripleseat 3 + 1 (d); its client signs from a link | Yes | 0 when the client signs; 3 by hand |
| 8 | Record a deposit | Cannot (card deposits built, test mode only) | Tripleseat: the client pays from the link; by hand 3 to 4 + 1 to 3 (d) | Yes | 0 by card or bank; 3 by hand |
| 9 | Confirm a booking | 2 to 3, with no tie to signature or money | Delphi 2 + 1 (d) | Yes | 1, offered when the venue's rule is met |
| 10 | Find a client and their history | Partly: 3 + 1, history incomplete | Salesforce 3 + 1 (d) | Partly | 2 + the name; the whole history on one page |
| 11 | Log a call or note | Partly: 4 + 1 to 2, on a deal or a booking only | Salesforce 3 + 1 to 3 (d) | Partly | 2, from anywhere |
| 12 | Update final numbers everywhere | Cannot as one edit: six copies | Tripleseat 4 to 8 + 1 to 3 (i); Delphi 21 to 31 + 11 to 22 across four tools (d) | Partly | 1 edit; every sheet follows; each department acknowledges |
| 13 | Change one line of the function sheet | Partly: 10 or more, through the 3D planner (i) | Tripleseat 3 to 4 + 1 (d), no version stamp | Partly | 3; old copies say superseded |
| 14 | Approve a plan | 6 (4 from the email) | None documents an approval step (Tripleseat unread) | Partly | 3 |
| 15 | Give a supplier what they need | Partly: 6 to 7 + 2 to 4, then pasted | Tripleseat 4 to 6 + 2 to 3, an emailed PDF (i) | Partly | 3, sent from the product |
| 16 | See today's events | 0 to 1 | Tripleseat 1 to 3 (i); Delphi 2 + 1 (d) | Yes | Kept |
| 17 | Record a room observation | 2 | Partly in Salesforce, Delphi and Tripleseat, as a note, 3 to 5 (Cvent: not covered); none has an issue log | No | Kept |
| 18 | Answer a client's request | 3 to 4 + 1 | Tripleseat 4 + 1 to 2 (d) | Yes | 3 |
| 19 | Raise an invoice or credit note | Cannot | Tripleseat, partly: 5 to 8 + 2 to 3, a credit as a negative payment (d) | Partly | The invoice raises itself from the agreed schedule; a credit note in 3; VAT right |
| 20 | Close out | Cannot | Delphi 9 to 12 + 3 to 12 (d): mark done, actuals, notes | Partly | A guided close of the building, a larger job than theirs |

On jobs where a rival already takes one to three clicks, matching it is parity, not an advantage. The advantage
is all twenty in one product, no fact typed twice between them, the jobs no rival documents in full (14, 15, 17,
and 19 with credit notes), and two where ours is the larger job: 12, where every copy and price follows with
versions (Tripleseat's sheet follows, by inference, with no versions), and 20, closing the building rather than
marking one event done. VenueBook's and Hallmaster's columns are from help pages; a trial of each would settle
their counts.

## Appendix D. How this plan was tested

The first draft went to six independent critics, each with one lens, who gave 76 findings. A second draft
answered them. A final judge then checked every finding and gave twelve more fixes, all applied here. Scores out
of ten:

| | True to evidence | Simple | Complete | Buildable | Ahead in 2027 | Provable |
|---|---:|---:|---:|---:|---:|---:|
| First draft, average of six critics | 5.5 | 6.0 | 5.0 | 4.3 | 5.5 | 5.3 |
| Second draft, the final judge (before its twelve fixes) | 7 | 7 | 6 | 6 | 6 | 7 |

What the critics changed, in one line each:

- The old diary must come in first, not last, or the office runs two diaries (a venue veteran).
- "1st option" is the rank of a held date, not a stage of the event; the first draft also misquoted your
  26 September words (veteran, simplicity designer, fact-checker).
- Six of the nine advantages first claimed were comfort; three hold. Several were written as true today when they
  are not built (a rival's head of product, fact-checker).
- The six places overlapped: eleven of the twenty jobs had more than one plausible first click (simplicity).
- The hallkeeper was drawn as a phone user on good signal; the job runs on a printed sheet (veteran).
- Wave 1 was the whole product, not the smallest switch; nothing secured the venue's time; there was no buyer, no
  price and no answer on trust (an operator-investor).
- The proof could show "works" but never "far better", and nine of twelve does not beat a coin toss
  (fact-checker).
- The join is a change to the database before it is a change to any screen, and five pieces leaned on plumbing
  nobody has built (an engineer, against the code).
- The British rivals were missing altogether (operator-investor).
- The opening screen overclaimed and buried four of your decisions (the final judge).

The scores are still sixes and sevens, not nines. What would raise them is not more writing: it is seeing the
old system, one shadowed Saturday, and the first real booking. The critiques are kept with the evidence, outside
the repository.
