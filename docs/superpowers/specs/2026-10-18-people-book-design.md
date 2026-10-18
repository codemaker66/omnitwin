# The People Book: design

Design, 18 October 2026. Status: **draft for Blake's approval** (nothing is built until he approves it).
Part of the replacement map (T-665, `docs/superpowers/specs/2026-10-18-replacement-map-design.md`), wave 1,
the first build. Branch `claude/people-book-20261018`.

## 1. What Blake asked for

- **Replace Salesforce for Trades House** (18 October): "We want to reverse engineer salesforce … so that trades
  house no longer needs salesforce because they will use us."
- **The People Book first** (18 October, approving the map).
- **A guest belongs to their event** (18 October): guests are not in the People Book. The guest-data DPIA draft
  sets their rules (requirement DR-31), and they arrive in wave 2.
- **Marketing**: unknown; Blake will ask the venue. Until then marketing is off by default.
- **One tap for bookings and money**; templates a person approved once send by themselves.

What "reverse engineer" means in practice: Trades House exports its own data and its own org's configuration
(custom objects and fields, reports in use, email templates and automation) from inside its own Salesforce org,
using Salesforce's own export tools, and Venviewer is built from that and from Salesforce's published object
reference. No Salesforce code, screens or proprietary material enter the product or this public repository.

## 2. What it replaces, and what veterans will not give up

Salesforce's standard records in a venue's daily use: Account, Contact, Lead, Opportunity (Venviewer already
has deals), Task and Event activities and Notes, with the duplicate rules, related lists and activity timeline
around them. Field names come from Salesforce's object reference
(`D:/claude/replacement-map-20261017/research/r1-salesforce-objfields.json`). What Trades House actually uses,
including any custom objects for bookings, is unknown until its export and metadata arrive (section 11).

A veteran refuses to lose: one record per client with every enquiry, deal and event beside it; the activity
timeline; logging a call fast; duplicate warnings; search across everything; and their history on day one.

## 3. Goals, non-goals and anti-goals

**Goals**

1. One record for each client person and organisation at a venue, editable by the people who own the
   relationship, with every duplicate either merged or knowingly kept apart.
2. Everything that happened with a client on one timeline, built by the server from the records themselves.
3. Trades House's Salesforce people, organisations, deals and activities come across by a repeatable import that
   never duplicates, until Salesforce can be switched off.
4. The privacy policy's promises kept by code: deletion 24 months after the last contact, and access, correction
   and erasure on request.
5. The all-day standard holds on the desk.

**Non-goals for this build**: guests (wave 2, event-scoped); agreements, payments and invoices (the agreement
build); sending email and the inbox (the inbox build); importing the diary's bookings (switching day, which will
reuse this import's foundation); marketing campaigns.

**Anti-goals**: Salesforce's complexity copied (custom fields everywhere, page layouts, admin dependence); a merge
that loses history; a person record reachable from another venue; health or access needs in a person record
(DPIA DR-09); a CRM label becoming access to an event (today a client reaches an event only through a live link
they own, `packages/api/src/services/client-event-schedule.ts:21-27`, and that rule stands).

## 4. Constraints

- **Tenancy.** Every person and organisation belongs to one venue. Cross-venue reads answer "not found", never
  "forbidden", as the existing search already does and tests.
- **Roles.** `canManageCommercial` (admin, manager, staff, sales) reads and writes the book; hallkeepers see only the
  day-of contact for events on their Day Board; platform admins as today. The web role sets mirror the API's and
  `role-capabilities.test.ts` keeps them equal.
- **History is kept.** Status histories and activities stay; merges re-point references and keep a merge record.
- **Idempotent writes.** Advisory locks or unique keys for creating from an enquiry and for imports (the pattern of
  `packages/api/src/routes/crm.ts:121`).
- **Schema first, code later.** Migrations add what code then reads; Railway migrates inside the image before
  promotion; migration numbers are assigned by the chief of staff at merge, and the journal's `when` must exceed
  the last one.
- **Privacy.** No named diet or access needs here. Personal data stays out of logs and error tracking. Nothing is
  exported or erased without a named person and a recorded reason.
- **Public repository.** No real client data in fixtures, seeds, screenshots or test traces.
- **House.** `components/shared/Activity.tsx` for every wait, `styles/house-tokens.css`, springs, the desk grammar
  (ivory ledger, copper plane of counts that are also filters, forest decision panel), keyboard parity, and the
  all-day standard's automated checks on every screen this build touches.

## 5. What exists today (verified in code, origin/master `b46f0dfc`)

- `client_accounts` (`packages/api/src/db/schema.ts:769-783`): one per converted enquiry, named after the person,
  with no route to edit it. `contacts` (`:785-801`): one per account, `email` NOT NULL, not lowercased, no unique
  key. Both are created only by `POST /crm/from-enquiry` (`routes/crm.ts:101-190`).
- `guest_leads` (`:947-958`): no venue, keyed by the raw email, and overwritten by any venue's enquiry
  (`routes/public-enquiries.ts:218-237`). A cross-venue leak from the second venue onward.
- `users` holds staff and signed-in clients alike (`:186-211`).
- `opportunities`, `activities` and `follow_up_tasks` hang off a deal; there is no person-level activity
  (`:803-867`).
- `events.client_name` is text (`services/event-binding.ts:113`); `events.client_account_id` is never written.
- `email_sends` is linked to no person (`:1006-1021`).
- The Clients desk (`components/dashboard/ClientsDesk.tsx`, `clients/ClientPanel.tsx`) is read only; its timeline
  is computed in the browser from deals and sent proposals (`clients/clients-desk-format.ts:242-254`); the sales
  role is refused it (`routes/clients.ts:59`, `lib/role-capabilities.ts:44-51`).
- No consent, retention, export or erasure (`services/cleanup.ts` purges previews and orphaned files only), though
  the privacy policy promises them (`packages/web/src/pages/LegalPage.tsx:395-418`, `:444-473`).
- Personal data also sits in free-text copies: deal and booking titles, `events.client_name`,
  `proposals.accepted_name`, comment authors, `email_sends` recipients and subjects, and status notes.
- "salesforce" is a provider label only (`packages/types/src/integration-layer.ts:13-30`): no external ids, no import
  batches.

## 6. The design

### 6.1 Records

- **Person.** Evolve `contacts` in place, because deals and proposals already reference it. Add a normalised email
  (lowercased and trimmed; email becomes optional, so a phone caller or an imported contact without email can be
  stored), a normalised phone, given and family names beside the display name, a job title, an optional postal
  address, notes, `last_contact_at`, the source system and its record id (unique per venue and system, for example
  a Salesforce 18-character Id), `merged_into_id` and `erased_at`.
- **Organisation or household.** Evolve `client_accounts` in place with a kind, organisation or household (a
  wedding couple is a household of two), plus address, website, VAT number (for invoices later), notes, the source
  fields and `merged_into_id`.
- **Membership.** A new link between a person and an organisation or household, with a role label and a primary
  flag, so a society secretary who also books for their firm belongs to both. `contacts.client_account_id`
  becomes the primary organisation until its readers move to memberships.
- **Enquiry link.** `enquiries` gains an optional person. A public enquiry links to the venue's person with the same
  normalised email or creates one, in the enquiry's own transaction, locked on venue and email. `guest_leads`
  stops being written; existing leads become venue-scoped people at each venue where they enquired, which ends the
  cross-venue overwrite.
- **Event parties** (slice 5). An event's people and organisations with a role: booker, billing contact, day-of
  contact, planner, supplier contact. Labels only, never access.

### 6.2 Matching and merging

- Records link automatically only on an exact normalised email within one venue (public enquiries and imports).
- Everything else is a suggestion shown on both records as a possible duplicate: the same phone, or a close name
  within the same organisation. Nothing merges silently.
- A merge says what moves before it happens ("2 enquiries, 1 deal and 3 notes move to Aileen Murray"), re-points
  every reference in one transaction, keeps a merge record with a snapshot of the merged record, and leaves a
  tombstone so old links still resolve. Undo stays open for 30 days and restores the snapshot and every moved
  reference in one tap.

### 6.3 The timeline

Built by the server, newest first and paged, from the records themselves: enquiries and their status changes;
deals and stage changes; activities, now person-level as well as deal-level; follow-ups; proposals sent, opened,
commented on and accepted; holds, bookings and events through the enquiry and deal links (and event parties
later); emails sent, once `email_sends` is linked to a person; imports ("brought in from Salesforce, 18
October"); merges; and consent changes. Each entry names who and when, opens its record, and shows nothing the
reader's role may not see (a hallkeeper never sees a deal's value).

### 6.4 Logging what happened

A composer on every person and organisation: call, email, meeting or note, at now by default, with a short body and
an optional follow-up (date and owner). Opening a person and logging a call takes under fifteen seconds; keys C, E,
M and N choose the kind. `activities` gains an optional person and organisation beside its deal.

### 6.5 Consent, retention and rights

- **Consent per purpose**, each with its source, time and wording version. Service messages about a person's own
  enquiries and events need no consent. Marketing stays off for everyone until a person opts in.
- **Retention.** A person, their enquiries and their copies fall due 24 months after the last contact, as the policy
  promises (`LegalPage.tsx:395-407`). `last_contact_at` moves on enquiries, messages, activities, proposals and
  events. A nightly job, built on the existing scheduled-workflow pattern and dry-run by default, lists what is due.
  A named admin confirms the first live run; after that it runs by itself, because it neither confirms a booking nor
  moves money. A live booking or a recorded legal hold keeps a record, and the reason shows on it.
- **Erasure** removes or anonymises the person everywhere their data sits, including the free-text copies in
  section 5, and leaves only a record that an erasure happened. **Export** gives the person's data as JSON and a
  readable summary. Both are confirmed by an admin or manager, with the exact payload shown first.

### 6.6 The Salesforce import

- **Source.** Trades House's own Salesforce Data Export (Setup, Data Export: a zip of CSV files) and its org's
  metadata for custom objects. The zip is opened in the browser (the web app already ships `@zip.js/zip.js` 2.8.26),
  the CSV files are parsed there with a proven parser, and only mapped fields go to the API, in batches. The raw
  export is never stored.
- **Mapping**, first pass, from Salesforce's object reference: Account to organisation or household; Contact to
  person and membership; Lead to person, with an enquiry when it describes an event; Opportunity to deal, through a
  stage map the venue confirms; Task and Event to activities on the timeline; Note and ContentNote to notes;
  OwnerId to a staff user by email. Custom objects (bookings, functions) are listed with their fields, to be mapped
  at switching day.
- **Each run is a batch.** A dry run first: counts of new, changed, unchanged, possible duplicates against
  Venviewer's own people, and rows it cannot read, each with its reason. Then apply, in one tap. Records match on
  their Salesforce Id per venue, so a re-run updates instead of duplicating. A batch can be rolled back: rows it
  created are removed and fields it changed are restored from its snapshot.

### 6.7 Who sees what

| Role | The People Book |
|---|---|
| admin, manager | everything at their venue; merge; export and erase |
| staff, sales | everything at their venue; merge |
| hallkeeper | the day-of contact for events on their Day Board only |
| client, planner | never the book (their own details through their own sign-in, later) |
| platform admin | as today |

Sales finally reaches the desk (`routes/clients.ts:59`, `lib/role-capabilities.ts:44-51`).

### 6.8 The desk

The Clients desk becomes the People Book, in the accepted desk grammar (see the mockup published with this
design):

- an opening line with the date and a greeting, the title "People", and one sentence on what is owed ("2 possible
  duplicates to look at; 5 follow-ups due this week");
- the copper plane of counts that are also filters: People, Organisations, Follow-ups due, Possible duplicates,
  Brought in;
- a ledger with search on `/`, grouped as In touch this week, Coming up and Everyone A to Z, each row with the
  name, organisation and role, the next event's date tile and the last contact;
- the forest panel: name, organisation and contact details edited in place; facts (next event, events so far, the
  month they usually book); "same again" (slice 5); the timeline; the composer; consent and retention lines; and
  duplicate suggestions;
- states that are designed: an empty book offers the Salesforce import or "add a person"; waits use Activity;
  failures say what was and was not saved; drafts survive a reload.

## 7. Slices, each its own pull request through the chief of staff's queue

1. **The record.** Migrations (person and organisation fields, memberships, the enquiry link, source ids, merge
   records), the backfill (contacts, accounts, and guest leads per venue), and the API to create, edit, search (sales
   included) and merge, with undo. Disposable-Postgres tests.
2. **The desk and the timeline.** The People Book desk, the server-built timeline, the composer with person-level
   activities, and the Find palette.
3. **Consent, retention and rights.** Consent records, the retention job (dry-run first), export and erasure.
4. **The Salesforce import.** Browser parsing, batches, dry run, apply, rollback and the mapping screen.
5. **Event parties and "same again".**

## 8. How we will know it is right

- Disposable-Postgres tests: nothing crosses venues; a merge keeps every reference and its undo restores them; the
  import run twice gives the same rows; retention deletes exactly what is due and nothing on hold; erasure leaves no
  copy (a canary name searched across every table).
- Route tests for every role gate (sales in; a hallkeeper sees day-of contacts only).
- End-to-end, keyboard only: find a person, log a call, merge two records, undo.
- The all-day standard's automated checks on the desk.
- The real proof: Trades House's own Salesforce export dry-runs with counts that match Salesforce's own record
  counts per object, and someone in the office finds three clients they know, with their full history.

## 9. Calls made in this design (for Blake to check)

- `contacts` and `client_accounts` are evolved in place, not replaced, so every existing reference and history
  survives.
- Records link automatically only on an exact email within one venue; everything else is a suggestion.
- A merge can be undone for 30 days.
- The retention job runs by itself once a named admin has confirmed its first live run.
- Export and erasure are for admins and managers, with the payload shown first.
- Hallkeepers see only day-of contacts, and only for their own events.
- The Salesforce export is parsed in the browser and never stored.

## 10. Left to the builder

Column names and types, indexes, the order in which a merge re-points references, the CSV parser, batch sizes, and
the desk's exact layout within the house grammar and the mockup.

## 11. What Trades House must supply

- A full Salesforce Data Export from its org, and its metadata (custom objects and fields, reports in use, email
  templates, flows). Its Salesforce administrator runs both from inside the org; we provide step-by-step
  instructions.
- Whether it sends marketing, and how any consent was collected.
- Which staff own which client relationships (owners are matched by email).
