# The planner's kit: what an event planner can do alone, and free, at any venue

**Approved by Blake on 13 November 2026**; his four answers are in section 7. Ledger row T-719, lane L4 of the
2027 build ([the plan](2026-11-13-platform-plan-design.md), section 10 item 5: to "Are event planners a 2027
goal?" Blake answered "Asap"). **Nothing here is built yet.** The build plan comes next, then the build with
tests first. A mock-up of four screens goes with this design as a private page, kept outside the repository;
he judged its look the same day. Nobody has yet watched a planner use any of this.

## 1. Intent, and why

**What.** A person planning an event (a professional planner, a couple, a society's dinner secretary) can, alone
and without paying: sign up without Venviewer's staff; pick a room that has been measured or draw their own to
scale; keep a guest list; put names on seats; share and print; and invite the venue onto the event.

**Why now.** Today a stranger can lay out the Grand Hall in the public planner and print one page. There it
stops: no guests, no names, no paper for the door, and only Trades Hall's rooms. The person seating 180 for a
wedding or a society dinner still keeps a spreadsheet and a second tool, and emails the venue a file to re-key.
The planner is also how a venue that has never heard of Venviewer first meets it.

**This is the kit around the planner.** The room itself (the canvas, its controls and its look) belongs to the
planner's own owners (T-687, T-671, T-686), and other rooms to T-662. The kit does not redraw or re-decide any
of it.

**Goals**

1. From a first visit to a printed table plan, alone, with no account and no payment.
2. At any venue, with nothing stated about a venue that the planner did not type.
3. Guests' names kept briefly, safely and under the planner's control.
4. The venue receives something useful before it is asked for anything.

**Not in this design:** invitations, replies and meal choices (wave 2); guests' diets and access needs (they
wait for the signed impact assessment; section 5.7 shows where they go later); tickets (wave 3); a directory or
marketplace of venues (plan 5.7); a venue signing itself up (wave 4).

**It would be a failure, even if it works, if:** a venue finds facts about itself on Venviewer that it never
gave; a guest's name reaches another planner, a venue or a log; the free kit stops below a real wedding; the
venue's page holds the plan back until someone signs up; or the kit grows a second planner beside the planner.

## 2. What exists today

Read from origin/master `85a17749` on 13 November 2026.

| What | Today | Where |
|---|---|---|
| The public planner | Anyone can open `/plan`. The first open makes an anonymous plan on the server, for a live room of a live venue, 60 an hour per address | `packages/web/src/router.tsx:480-493`; `packages/api/src/routes/public-configs.ts:142-163` |
| A plan must have a venue's room | A plan's room and venue are both required, so no plan can exist for a room that is not a venue's | `packages/api/src/db/schema.ts:530-531` |
| Unsaved plans | An anonymous plan nobody saved, claimed, linked or shared is deleted after 72 hours, by a nightly job at 02:00 | `packages/api/src/services/cleanup.ts:77-88`; `.github/workflows/cleanup.yml:23-24` |
| Claiming a plan | An account takes an anonymous plan only with the secret the creating browser was given; a plan already in the venue's work can never be claimed | `packages/api/src/routes/claim-config.ts:23-35, 49` |
| Accounts | **Nobody can sign up alone.** A first sign-in makes an account only if the address has a pending invitation or is on an approved domain | `packages/api/src/middleware/auth.ts:308-312, 112-124` |
| Roles | Eight, among them `client` and `planner`. Both land on `/events`, their own events and saved plans. But `planner` is also admitted to the venue's desk and room pages | `schema.ts:232`; `packages/web/src/lib/role-routing.ts:19-27`; `role-capabilities.ts:115, 128-134` |
| The client's home | `/events` lists the signed-in person's own events and plans, read by their id alone; `/events/:eventId` is one event | `router.tsx:580-600`; `packages/api/src/routes/client-home.ts:6-17` |
| The view-only link | A link to look at a plan and not change it: 32 random bytes kept only as a hash, 30 days, five at once, never cached or indexed. It exists only for anonymous plans and stops when the plan is claimed | `packages/api/src/routes/public-plan-views.ts:14-50, 60-125`; `services/plan-view-links.ts:44-48, 76, 111`; `packages/types/src/plan-view.ts:21-24`; `router.tsx:747` |
| Signing in takes sharing away | Once a plan is claimed, its link and its one-page PDF stop, and a signed-in planner with no venue is told "Sign in as venue staff to create a client share link." | `plan-view-links.ts:76, 111`; `packages/web/src/components/editor/cockpit/ShareLensPanel.tsx:291` |
| Paper | One A4 page: the room, a scale bar, counts of what is placed and the line "Drawn by a visitor; not reviewed by the venue." No prices, no capacity verdict | `packages/api/src/services/visitor-plan-pdf.ts:9-27`; `public-configs.ts:533` |
| Sending a plan to the venue | An unsaved plan can be sent to Trades Hall's events team. It arrives as an enquiry in the venue's own list | `packages/api/src/routes/public-enquiries.ts:196-203` |
| Guests | Nothing. No table holds a guest, a seat, a household or a reply. A plan holds a guest count. A placed piece can carry a label of up to 80 characters; numbering the tables is built but switched off; a table's seats come from the furniture catalogue | `schema.ts` (table names searched: guest, seat, rsvp, household, attendee); `schema.ts:388, 551, 743-768`; `packages/types/src/hallkeeper-instructions.ts:170`; `packages/web/src/stores/placement-store.ts:325-330` |
| Diets and access on a plan | A plan's own details can already hold a count for each diet, a free-text allergy line and access needs, which print on the hallkeeper's sheet. They describe the event, not a named guest | `packages/types/src/hallkeeper-instructions.ts:103-109`; `packages/types/src/event-requirements.ts:110-116` |
| Rooms | Every room is a venue's record with a size and an outline. The Grand Hall is measured by laser scan, 21.14 m by 10.59 m; the other Trades Hall rooms are the venue's published sizes drawn as plain shapes. A save is refused if a piece lies outside the room's stored outline | `schema.ts:181-202`; `packages/api/src/db/grand-hall-e57.ts:36`; `db/seed.ts:73-90`; `routes/placed-objects.ts:181-188, 250-256, 355-359`; `routes/public-configs.ts:308-309` |
| The list of venues | A constant holding Trades Hall alone | `packages/api/src/services/public-discovery.ts:65` |
| Limits on a free visitor | 100 requests a minute, 2 MB a request, and the per-route limits above | `packages/api/src/index.ts:168, 227-229` |
| What the privacy page promises | Accounts for "clients, planners and people who work for the venue"; "please do not put health information" in a message; backups hold seven days of history and a daily copy for 14 days | `packages/web/src/pages/LegalPage.tsx:245, 291, 517` |

The redesigned planner (T-687) is not yet in this repository (`docs/state/tasks.md:14`). Its owner told this lane
on 13 November how it stores a table: an id, a number given once in the order staff walk the room, a kind and a
seat count. Chairs are not stored.

## 3. The planner's job today, and where it hurts

A person seating 180 keeps the names in a spreadsheet with a table-number column, draws the room in a seating
tool or a slide, and emails the venue a PDF. More than a dozen seating tools were read on 13 November from
their own pages (the notes are kept outside the repository). What they show:

1. **Free stops before 180.** Free tiers end at 15, 30, 75, 100 or 150 guests. No tool read gives 180 guests, a
   room to scale, a list by table and a link to share, at no cost.
2. **Almost nobody draws the room to scale.** One UK tool says in writing that exact scaling is not supported.
3. **Late changes meet printed paper.** One society dinner closes names a week before, because cards are printed.
4. **The hand-over is a file.** Every tool emails a PDF or a spreadsheet; the venue types it in again.
5. **Diets sit in free text, under privacy terms that are silent or out of date.** One tool will stop accepting
   edits in June 2027; two others' websites are for sale.

The best documented path is a paid UK desktop program: about 20 clicks and 6 typed fields, and up to 18 tables
dragged into place, after buying and installing it. These counts come from vendors' help pages, read through a
tool that summarises; they must be re-checked on the live pages before any public claim.

## 4. Approaches considered

| Approach | What it gives | What it costs |
|---|---|---|
| A. Trades Hall's rooms only: add a guest list and paper to today's public planner | The smallest build; nothing to settle about other venues | It is not "any venue". A planner whose event is elsewhere gets nothing, and no new venue ever meets Venviewer through it |
| **B. The planner's own event, at any venue (chosen)** | The planner owns their event. They pick a measured room where one exists, or draw their own from their own sizes. The venue is invited by a link the planner sends | A plan must be allowed a room that is no venue's (one change to the database), and the rules of section 5.3 must hold |
| C. A directory of venues' rooms first, gathered from public sources or from planners' drawings, so planners pick instead of draw | Faster for the second planner at the same venue | It states facts about venues that never agreed, which the brief forbids; it is a marketplace by another name (plan 5.7); and it is heavy |

**B is chosen** because it is the only one that is "any venue" without claiming any venue's facts, and its first
stage ships beside wave 1a with nothing needed from the other lanes.

## 5. The design

### 5.1 The journey, counted

Counted as the plan's scoreboard counts: clicks + typed fields. The job: a spreadsheet of 180 names, 18 tables
of 10, names on seats, a printed table plan. (d) is documented on the vendor's own page; (i) is inferred. Ours
is a target counted on the mock-up, not on a built product.

| Step | Today: a spreadsheet and the best documented tool | The kit (target) |
|---|---|---|
| Get in | Buy a licence and install it; its trial stops at 30 guests (d). Not counted | Open the page. No account, no payment |
| A room to scale | A dearer edition only: place a picture of the room and scale it, about 12 + 1 to 2 (d) | A measured room: 1. Your own: 2 + 2 (width and length) |
| The list in | 10 + about 3 column choices (d; the choices i) | 2 + one paste |
| Tables | 3 + 2, then up to 18 drags (d; the drags i) | 1: "18 round tables of 10" |
| Names on seats | 2, automatic (d) | 1, in list order with each party kept together; then moves by hand |
| Print the table plan | 4 + 1 (d) | 2 |
| **In all** | **About 20 + 6 and up to 18 drags, after a purchase and an install** | **7 or 8 clicks, at most 2 typed fields, one paste** |
| Give it to the venue | Email a PDF; the venue re-keys it | 2: make the venue's link, copy it |

### 5.2 Accounts: what needs none, and what one is for

- **With no account:** open the planner, pick or draw a room, lay it out, paste a guest list, seat it, print.
  The plan is kept as today (72 hours unless saved). **The guests' names stay in that browser, on that device,
  and are never sent to Venviewer.** Today's view-only link to an unsaved plan stays as it is; it shows the room
  and never a name.
- **A free account** (an email address, confirmed by the sign-in provider) is for three things: keeping the
  work, opening it on another device, and sharing a list. The planner makes it themselves. Today that is
  impossible (section 2), so stage 1 builds sign-up, behind a switch (section 5.8).
- **One owner.** A planner's event has one owner, and nobody else can change it. A couple share one sign-in, or
  one of them looks through the client's link. Co-planners would need their own design.
- **A self-made account belongs to no venue and can reach nothing of any venue's**: only its own events, plans
  and guests. The `planner` role is today admitted to the venue's pages, so a self-made account is given the
  least-privileged role, and a test walks every venue's route as one and expects a refusal.
- **Limits that stop abuse of a free service** (my calls, section 9): 20 live events an account; 600 guests an
  event; 12 working links an event; a name of at most 80 characters, shown as plain text; the request limits
  that exist today; no file uploads; **and in stages 1 and 2 the product emails nobody but the account's own
  holder**, which removes the one real route for spam. Shared pages are never indexed, and each carries a way
  to report it.

### 5.3 A room at any venue

A planner meets three kinds of room, and each says what it is.

| Kind | What it is | Says |
|---|---|---|
| Measured | A room of a venue on Venviewer that has been measured. Today: the Grand Hall | "Measured by laser scan" |
| The venue's figures | A room of a venue on Venviewer, drawn as a plain shape from the venue's own published size | "The venue's published size" |
| Your own drawing | Any room anywhere, drawn by the planner. Version one is a rectangle from two typed sizes | "Sizes entered by you" |

**The rule for a venue that is not on Venviewer:**

1. **The venue is a name the planner typed**, kept on that planner's event only. It is not a venue record. It has
   no page, cannot be searched for, and is never matched with what another planner typed.
2. **The room is the planner's own drawing.** Every size carries "entered by [the planner] on [date]", on screen
   and on every sheet and link.
3. **Venviewer adds nothing:** no address looked up, no photograph, no capacity, no "it fits". The planner's
   capacity and safety checks stay off for an own room, because the plan's rule is no verdict on an assumed
   figure. Distances between tables are shown, since they follow from the planner's own sizes.
4. **Nothing accumulates.** Two planners' drawings of one hall are never merged or counted, and no list of the
   venues planners have typed exists. What planners type about venues is not used to approach those venues.
5. **A drawing never becomes a venue's fact.** If that venue later joins, its rooms are its own records. A
   correction made through a planner's link is kept as "from [the name they typed], through your link", never as
   the venue's statement.

A drawn room is stored with the planner's own plan, never in any venue's room record: that is the line between
one venue's data and everyone else's. Agreed with T-662's owner on 13 November, who also asked that the stored
shape be an outline with room to grow (an L-shape, a stage, pillars), which rides on the planner's own outline
code and not on a second drawing tool.

### 5.4 Guests, and names on seats

- **What is kept about a guest:** a name as the planner writes it, the party they came with (optional), a table
  and a seat. Nothing else. No email, no telephone, no notes box.
- **Getting the list in:** paste from a spreadsheet, or choose a file. It is read in the browser. The planner
  picks the name column and, if there is one, the party column. **Every other column is dropped in the browser
  before anything is saved**, and the kit says so: "Only names and parties were taken."
- **Seating is done from the list, not by drawing in the room.** Tables are rows; names move between them. "Seat
  everyone" fills tables in list order with each party kept together. A guest with no seat is always shown as
  "to seat", with a count.
- **The boundary with the planner's canvas**, agreed with T-687's owner on 13 November:
  - The kit reads four things about a table and never writes the plan: its id, its number, its kind and its
    seats. A guest is bound to a table; a seat is at most a number round that table, never a drawn chair.
  - Guests bind to Dinner only, the plan the venue is sent.
  - When a table disappears, its guests go back to "to seat", visibly. Nothing is moved silently.
  - The guest count is the planner's to apply. The list only proposes it.
  - No name appears in the room unless the canvas's owner decides it should.
- **Stage 1 builds against the planner that is in the product today**, where numbering the tables is built but
  switched off. So the kit keeps its own short record of each table (a number, a name, and seats taken from the
  furniture catalogue), a guest is bound to that record, and the kit only counts the plan's tables, to show a
  line when the two disagree ("the room has 17
  tables; your list has 18"). The list belongs to one plan of the event, which becomes "Dinner" when T-687's
  planner is in the product. That planner's table id is then added to the kit's record. No guest has to be
  moved, because guests are bound to the kit's record and never to the plan.

### 5.5 Share and print

| For | What they get | Names | Account |
|---|---|---|---|
| The door | The table plan, A to Z and by table; place cards | Yes, on paper | |
| The client (the couple, the society) | A link to look at the plan and the list, not change them | Yes: they are their own guests | None needed |
| The caterer | Covers by table | No | None needed |
| The venue | The room plan, how many tables and chairs, the set-by time | No | None needed |

- Every sheet carries its version and date. A plan changed since it was printed says so on the event page.
- Sharing a list needs an account, because without one the names are only on the planner's own device. Today's
  view-only link stops when its plan is claimed at sign-up (section 2). The kit's links belong to the planner's
  event, so they do not; at sign-up the planner is told the old link has stopped and is offered a new one.
- The table plan is lists, never a drawing of the room, so it does not touch the open question of whether
  guests are ever shown a drawn plan. The room plan a venue receives is the planner's own drawing (T-687's), not
  a second one made by the kit.
- Each link is a long random code kept only as a hash, with an end date (30 days after the event) and a way to
  stop it, built on the view-only link that exists. **The server decides what each kind of link may show from a
  fixed list of fields**, so a venue's or caterer's link cannot return a name.

### 5.6 Inviting the venue

- **How.** The planner makes the venue's link and sends it themselves, from their own email, with a few drafted
  lines to copy. A note from a planner the venue knows is more likely to be opened than one from a platform it
  does not, and nothing waits on the plumbing lane.
- **What the venue sees.** The room plan to scale, how many tables and chairs, the set-by time, the planner's
  name as typed, and a plain statement of whose measurements these are. No guests' names.
- **What the venue can do, with no account:** print it, or suggest a corrected size with their name on it. A
  suggestion changes nothing until the planner accepts it. If accepting would leave a piece outside the room,
  the planner is shown which, and nothing is moved for them. Replies go to the planner's own email, where the
  link came from; the product stores no messages.
- **To take the event in** (stage 3): where the venue is on Venviewer, the plan reaches it the way a plan does
  today, as an enquiry in the venue's own list; the kit builds no second way in. A signed-in member of its staff
  then takes the event into the Diary. From then it is an event of the venue's like any other, with the planner
  named on it. Where the venue is not on Venviewer, the page ends with one line about what Venviewer does
  for venues. How a new venue starts, and at what price, is not decided here.
- **The honest reason a venue adopts.** A plan to scale and the numbers arrive without anyone re-keying them, and
  the venue need do nothing to use them. If it joins, the same plan sits in its own Diary on its own measured
  rooms, under its own rules, instead of being argued over by email. Printing never waits on signing up.

### 5.7 Guests' names: data protection by design

Names are ordinary personal data, not special-category data. The rules are built in from the first screen.

| | Rule |
|---|---|
| What is held | A name, a party, a table and a seat. No contact details, no notes, no diet, no access need |
| Why | To make that event's table plan. Nothing else: no marketing, no matching across events, no use by Venviewer for its own purposes, never sent to an AI model |
| Who sees a name | The planner; whoever the planner gives a client's link. Never the venue or the caterer through their links, never another planner, never Venviewer's staff as routine |
| With no account | Names never leave the planner's device |
| How long | Until 30 days after the event (the period the draft impact assessment gives guest records), or 90 days after the last change when no date is set. On that day the names and their seats are deleted; the tables, the plan and the counts stay while the account does. The planner is warned a week before, on the event page and by an email to their own address |
| Taking it out, and deleting | The planner downloads the list or deletes it at any time. Deleted names leave the backups as those expire (14 days, by the privacy page) |
| A forgotten account | An account nobody has signed in to for 24 months is deleted with everything in it: the period the privacy page already uses for enquiries, for the solicitor to confirm |
| Names on Venviewer's servers | Only from a signed-in owner who has accepted the planner's terms, and not before those terms and the page for guests exist and the solicitor has read them |
| Kept out of other places | No name in an address, a log, an error report or an email. A test with a made-up "canary" guest proves it on every change |
| Guests are told | A public page, "If your name is on a table plan", and the planner's own duty in the terms |

**Where diets and access needs go later.** Not in the list, and not typed by the planner. When the venue's
impact assessment is signed, each guest gives their own, with their own consent, and they are held apart from
the names and destroyed 14 days after the event, as the draft says. Until then the caterer's sheet says plainly
that it holds covers only. T-687's owner and this lane agreed that nothing is asked twice: when guests give
their own needs, the planner's letter prints counts without names, and asks its own question only when there is
no list.

**What a plan already holds.** A plan's own details can hold diet counts, a free-text allergy line and access
needs today (section 2). The kit adds nothing to them and never shows them on its links or sheets. For a plan in
a planner's own room they are not offered and the server refuses them, because no venue is there to answer for
them. For a plan in a Venviewer venue's room they stay as they are, under that venue's own rules.

**Who is responsible for the names when no venue is involved.** This is for the solicitor, not decided here.
The position put to them: the planner decides who is on the list and why, so the planner is responsible for it
(the controller), and Venviewer keeps it on the planner's instructions (the processor), under terms accepted at
sign-up. The clearest rival says exactly this. Questions for the solicitor:

1. Is that right when the planner is a private person, such as a couple? The law's household exemption covers
   them, not the company that provides the tool.
2. Do processor terms accepted on a screen suffice, and what must they say?
3. How are guests told, when only their name is held and the planner never gives their address?
4. Are 30 days after the event, and 14 days in backups, defensible?
5. When a venue takes an event in, the venue becomes responsible for what it receives: what must happen at that
   moment?
6. Does a short written screening suffice for a names-only list, or is a full impact assessment needed?
7. Children's names on a table plan, with no ages held.

### 5.8 Stages, and what each needs

| Stage | What ships | Needs from others |
|---|---|---|
| 1. The list and the paper | A guest list; names on seats; the table plan, place cards and covers. All of it works on the planner's own device with no account, in any room the planner opens today. Sign-up is built behind a switch that is off for the public. Keeping names on Venviewer's servers opens only when the planner's terms and the page for guests exist and the solicitor has read them | Nothing from other lanes. The terms and the guests' page are drafted in plain words with this stage, for the solicitor to read. Before the switch opens to everyone, the sign-in provider's own settings (open sign-up, protection against robots) are checked |
| 2. Any venue | Draw your own room; the venue's name as the planner's label; links by kind; the venue's page with print and a suggested correction | The planner must open a room whose outline the plan carries (a small seam with the planner's owners). L-shapes wait for the outline work in pull request #411 |
| 3. Joined up | A venue on Venviewer takes the event into its Diary. The deletion job moves onto the plumbing's queue. An invitation sent by the product itself, only if Blake wants one, with daily limits | L1: an event to join, and an outside planner as a named party on it (put to the spine lane on 13 November; not yet answered). L2: the queue and the sends |
| Later, each with its own design | Guests' own needs; invitations and replies | The signed impact assessment; wave 2 |

The guest list here is the first slice of wave 2's, so wave 2 extends it and does not rebuild it.

## 6. The change, for the builder

**New records** (names are proposals).

- **A planner's event**: its owner (a user, required), a title, a date, the venue and room as the planner calls
  them, the date its guests are deleted, and later an empty-until-used link to the venue's event. It is not a row
  in the venue's `events` table: a venue's lists must never show an event the venue has not taken in.
- **Its plans**: which plans belong to it, and which one is Dinner. A plan belongs to at most one planner's
  event. This table points at a plan, so it joins the preview sweep's kept-by list, whose test fails otherwise
  (`cleanup.ts:38-40`).
- **Its tables**: number, name, seats, and the plan's table id when one can be trusted.
- **Its guests**: name, party, table, seat.
- **Its links**: the hash, the kind (client, venue, caterer), the end date, when stopped, when last opened.
  Same making and hashing as `plan-view-links.ts`; a new table, because today's links belong to anonymous plans
  and stop when the plan is claimed.
- **Stage 2, an own room**: the outline, the ceiling height, the labels, who entered them and when, held on the
  plan itself. Because a plan's room and venue are required columns, one fixed "no venue" row and one fixed
  "own room" row are seeded as their anchor; they hold no planner's data. The saved-outline check
  (`placed-objects.ts:182, 250, 355`, and the anonymous save at `public-configs.ts:308-309`) reads the plan's
  own outline when there is one, and a plan in an own room refuses the diet and access fields. Considered
  instead: making the two columns optional, which is more honest but changes types across files that other
  lanes own.

**Routes and screens.** Sign-up for a new person. `/events` gains the planner's own events. A planner's event
page (list, tables, paper, links). Print pages for the table plan, place cards and covers. The linked pages for
a client, a caterer and a venue. In stage 2, "Where is it?" before the planner opens.

**Left alone.** The canvas, its controls and chrome; venues' rooms; the venue's `events`, bookings and Diary;
enquiries; the hallkeeper sheet; pricing; the assistant.

**Counting the limits.** Today's request limits are counted inside each server process (no shared store is
set, `packages/api/src/index.ts:227-230`). The kit's own limits (events, guests, links) are counted in the
database, so a second server does not double them.

**The rules in the database, and the check that proves each.**

| Rule | In the database | Proved by |
|---|---|---|
| A guest belongs to exactly one planner's event and goes when it goes | A required link that deletes with its event | A test that deleting an event leaves no guest |
| One seat, one guest | The seat is a column on the guest, unique for each table and seat | The same owner, on two devices, takes the same seat at once: one succeeds, the other is told |
| Names reach the server only with the terms accepted | The owner's acceptance, with its date and the version of the terms, is on the account | A route test that a list is refused without it |
| A guest record can hold only a name, a party, a table and a seat | No other columns exist; lengths capped | A schema test; an import test that the dropped columns never reach the network |
| One planner never reads another's guests | Every read is by the owner's id or a link's hash | A cross-planner leak test, gating every release, as piece B's cross-client test does |
| A venue's or caterer's link never returns a name | Answers built from a fixed list of fields for each kind | Route tests with a canary name, also searched for in logs and error reports |
| An own room is no venue's | Held on the plan; present exactly when the plan's room is the anchor | A check on every change and in production that finds no plan breaking it, and that no venue or discovery route returns the anchor |
| A self-made account reaches nothing of any venue's | No venue on the account | A test that walks every venue route as one |
| Names are deleted on time | A delete-after date on every planner's event | The job run against disposable PostgreSQL with the clock moved; a daily production check that nothing is overdue and no link lacks an end date |

**Tests first**, on real PostgreSQL with an explicit disposable target: each row above, and the failure paths (a
paste of 5,000 rows; a name of 500 characters; a link that is stopped, expired or malformed, each giving the
same answer; a table removed while a guest is being seated; an event deleted while a link is open; a list kept
twice from two devices).

**The migration.** New tables only in stage 1, so nothing is backfilled and the rollback drops them. Stage 2
adds one optional column to plans and two seeded rows; its rollback removes them once no own room exists. Each
is its own pull request in its own merge slot, numbered at merge. The deletion job joins the nightly clean-up
that exists, and moves to the plumbing's queue when that lands.

## 7. What Blake decided, and what still waits on him

Decided by Blake on 13 November 2026, by button. His answers are verbatim.

| Question | His answer |
|---|---|
| Do you approve the design: a planner owns their own event at any venue (approach B)? | "Approve it (Recommended)" |
| Is the look of the mock-up's four screens right to build on? | "Yes, build on it (Recommended)" |
| Is the test in section 8 the right test for the kit being done? | "Yes, that test (Recommended)" |
| Who gets the kit first, and when may guests' names be kept on Venviewer's servers? | "Five invited planners (Recommended)". They work on their own devices, where no guest's name reaches us. Accounts that keep names, and sign-up for everyone, open after a solicitor has read the terms |

Still his, when they are built: the first version of the planner's terms and of the page for guests, before
anyone outside sees them; and the words on the venue's page about Venviewer for venues.

Two notes from T-687's owner also wait on him, with that work and not with this: whether guests are ever shown a
drawn plan, and how the planner's letter asks about diets before guests can give their own.

## 8. Done when

Approved by Blake on 13 November 2026 as this lane's test, since the plan had none.

*Done when* five planners who have never seen it each take their own real list of a hundred or more names from a
first visit to a printed table plan, alone, in under fifteen minutes and in no more than ten clicks and three
typed fields; and one venue that is not on Venviewer opens a planner's link and prints the room plan without
help.

It fails if a planner needs help, or a count is exceeded: that step is redesigned before the kit is opened to
everyone. Nothing is claimed as "better" until those five have been watched. The first half can be met with no
name ever leaving a planner's own device.

## 9. Calls made here, for Blake to check

- With no account, names stay on the planner's device.
- No notes box on a guest, and every column but name and party dropped on the way in.
- The limits in 5.2, and the keeping times in 5.7.
- The venue's link is sent by the planner, not by the product.
- What planners type about venues is never used to approach those venues.
- A rectangle first; one drawn room for each plan.
- Seating from the list; stage 1 built against today's planner, with the kit's own short record of each table.
- One owner for each planner's event; no co-planners yet.
- On the deletion day only the names and seats go; a forgotten account goes after 24 months.
- A venue's correction is a suggestion the planner accepts; the product stores no messages.
- The diet and access fields a plan already has are refused for a plan in a planner's own room.
- The planner is responsible for the names and Venviewer keeps them on instruction, as the position put to the
  solicitor.

**Left to the builder:** the names of tables and columns; whether paper is the browser's own print or a PDF;
how the browser keeps an unsaved list; which existing role a self-made account takes, provided the rule in
section 6 holds.

## 10. Evidence, and its limits

- **Code** read on origin/master `85a17749`, 13 November 2026; every line cited was opened.
- **Rivals** from their own help and pricing pages on 13 November, through a tool that summarises. Several pages
  refused to load, and no rival was used by hand. The notes are kept outside the repository.
- **The draft impact assessment** for guest data of 18 October, kept outside the repository, is the source of
  the keeping times and of the rules on diets.
- **Agreed on 13 November** with the owners of T-687 (names on seats) and T-662 (a planner's own room). Put to
  the spine lane and not yet answered.
- **Nobody was consulted:** no planner, no venue, no caterer, no guest, no solicitor. The points of law are
  informed reading, not advice.
