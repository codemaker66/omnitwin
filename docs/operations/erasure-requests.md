# Erasure requests

Written 26 October 2026 and rewritten 13 November 2026 (release audit people-privacy-5). The privacy page
says a person can ask us to delete their enquiry sooner, and that enquiries that did not become bookings,
and the contact record, go 24 months after our last contact.

- **The erase route** (below) erases a person who has no booking and no contract, in one transaction, and
  says exactly what it did.
- **The nightly 24-month pass** (below) does the same for people we have not been in touch with for 24
  months, and for enquiries nobody holds.
- **By hand** (sections 1 to 4): a person the route refuses (a booking or a contract the venue keeps), an
  account, and the few stores the route leaves, listed under the route.

**The clock:** one month from the day the request arrives (UK GDPR Article 12(3)).
Write the date down when it arrives.

## 1. Receive and record

1. Confirm who is asking: reply to the email address on the enquiry, not to a new one.
2. Start an entry in the erasure log (private, never in this repository). Write:
   - the date received and the deadline (one month later);
   - the venue;
   - the ids you find in step 2 (ids only, never the name or email);
   - how it was erased (the route, or by hand), and the ids of any Neon snapshot taken for it.

   The [disaster-recovery](disaster-recovery.md) page relies on this log: after a restore from backup, every
   erasure in it since the restore point is done again, route and by hand alike. The route's own audit rows
   are in the same database and are lost with it, so **log every request, route or not**.

## 2. Find everything (read-only)

Find the person and everything that carries them, at **one venue**: `:venue_id` is the venue the request is
about, `:email` the address on the request (lower-cased). Read only; change nothing yet. An address another
live person at the venue also holds (a couple sharing one inbox) identifies nobody alone: go by the person,
not the address, and leave what is the other person's. A deal made from their enquiry that another live person
now leads (a PA enquired; her director became the main contact) is that person's, with its proposals, events and
bookings: only the erased person's name leaves it.

| Store | What it holds | How to find it | Route |
|---|---|---|---|
| `contacts` | name, email, phone, given/family name, job title, role, postal address, notes, import ids | `venue_id = :venue_id and lower(email) = :email`, plus every tombstone whose `merged_into_id` chain leads to it (a merged-away person keeps its details) | cleared, row kept |
| `contact_points` | emails and phones | by `contact_id` | deleted |
| `account_memberships` | role label | by `contact_id` | cleared |
| `client_accounts` | a household's name, address, notes, VAT number | the person's own household (they are its only live member); one they belong to with another live member | their own: cleared, row kept. Shared: stays the other member's (one they led is handed to them), their name taken out |
| `record_merges.snapshot` | a full copy of a merged person, their contact points, fields copied between records | `survivor_id` or `merged_id` in the person's ids | the copy cleared |
| `enquiries` (and `enquiry_status_history`) | name, email, guest name/email/phone, message | linked to them (`contact_id`), or linked to nobody and sent from an address only they hold | deleted |
| `guest_leads` | email, phone, name | `lower(email)` = one of their addresses or their enquiries'. No venue: kept while any enquiry anywhere uses the address | deleted |
| `email_sends` | recipient, subject | receipts about their enquiries (the key carries the enquiry id); others by `lower(recipient) = :email` | enquiry receipts deleted; others **by hand** |
| `event_plan_notifications` | an enquiry's in-app notice ("Morag Smith enquired about …"); notices about their proposals and their Diary holds | the venue's notices opening with the enquiry's name or address within ten minutes of its arrival, or pointing at their proposal, a change copying them, or their booking | deleted, or their name taken out. An enquiry notice another enquiry kept here could equally have written stays (**by hand**) |
| `proposals`, `proposal_versions`, `proposal_share_tokens` | accepted name, title; each version's title and message to the client; the client's link | by their enquiry or deal | accepted name cleared, name taken out of titles and messages (the version's digest made again), links revoked |
| `proposal_comments` | what the client wrote: author name, email, words | on their proposals; on someone else's, signed with an address only they hold, or under their name in the change feed | on their proposals: client comments deleted (one signed with an address another live person holds is that person's: kept, without the erased person's name), staff comments lose the name. On someone else's proposal: kept for that client, without their name and address |
| `proposal_status_history` | notes, including the client's words when they asked for changes or accepted | on their proposals | client notes cleared; staff notes lose the name |
| `event_plan_changes` | the client's name (`actor_label`) and words copied into the event's change feed | `source_kind` `proposal_comment` (the comment's id) or `proposal_response` (the proposal's id); a client change on someone else's proposal labelled with their name (an acceptance they typed it into); other changes on their events | the copies of their own proposals' answers deleted; the rest lose the name, a client's label included (a member of staff's label stays) |
| `opportunities`, `opportunity_status_history`, `activities` | deal title ("Wedding — Morag Smith"), next action, the note written when the deal moved stage (closing one requires it), activity notes | by `primary_contact_id` or `source_enquiry_id` | name taken out |
| `bookings`, `events`, `event_phases` | Diary titles, event name, client name, notes, phase notes | from their enquiries; on their deals', households' and organisations' events, and on events made from their proposal's layout (`event_configuration_links`) | name taken out (a booking the venue keeps refuses the route) |
| `decisions` | the reason given for a prepared decision about a booking (free text) | `subject_kind = 'booking'` and `subject_id` one of their bookings, or a booking of a deal another live person leads that was made from their enquiry | erased (set to null), the only change a decision allows (migration 0108): always on a booking pencilled from their enquiries; on the other bookings, when it names them |
| `proposal_contract_versions`, `proposal_contract_signatures` | the client's name and email in the contract, the signer's name, email and browser | on their proposals | **kept**: a contract is kept with the booking's records for six years and no statement can change it (migration 0104). The route refuses (`PERSON_HAS_CONTRACT`) |
| `proposal_deposit_requests`, `deposit_payments` | the deposit and its payment record | on their proposals or events | **kept** for six years with the booking's records; the route refuses |
| `quotes`, `follow_up_tasks` | staff-written text that may name the person | by `enquiry_id`, `proposal_id` or the deal | **by hand**: read the text |
| `users` | email, name, phone, organisation | only if the person has an account | **by hand** (step 3's last item) |
| `remembered_dietary_notes` | an allergy note | by the person's user id | **by hand** |

**A booking or a contract changes the answer.** An enquiry that became a booking, and its contract and
deposit, are kept for six years after the financial year of the event (the privacy page's accounting rule).
Erase the contact details nobody needs for that, keep the booking's records, and say so in the reply.

## 3. Erase by hand, in one transaction, rehearsed first

Only for what the route refuses or leaves. Run the change twice:
1. **Dry run:** inside a transaction that ends `ROLLBACK`, with a count check after each statement.
2. **Real run:** the same transaction ending `COMMIT`.

Take a Neon snapshot first, as for any hand change to production, **with an expiry no more than 14 days
away** (or delete it within 14 days), and write its id in the erasure log. A snapshot that never expires
keeps the erased person past the privacy page's promise that backups lose them within 14 days.

- **The person and every tombstone of theirs:**
  - Set `name = 'Erased'`, and set `email`, `phone`, `given_name`, `family_name`, `job_title`, `role_label`,
    `postal_address`, `notes`, `source_system` and `source_id` to null.
  - Set `erased_at = now()`, and `deleted_at = now()` where it is still null.
  - Keep the rows, because bookings and history point at them. An erased person is no longer live anywhere, and a
    merge involving them can no longer be undone (`ERASED`).
- **Their contact points:** delete them. **Their membership role labels:** set to null.
- **Their own household:** set `name = 'Erased'`, and `address`, `notes`, `website`, `vat_number`,
  `source_system` and `source_id` to null. A household another live member stays in is that member's: if the
  erased person led it, make the other member its main contact; take only the erased person's name out of its
  name and notes.
- **Decision reasons:** on bookings pencilled from their enquiries, and on any other booking where the reason names them,
  set `decisions.reason` to null (nothing else in a decision can change).
- **Merge snapshots that mention them:**
  - in `person`, keep `id` and the timestamps, and set the other fields to null or `'Erased'`;
  - set `contactPoints` and `survivorFilled` to `[]`, and each membership's `roleLabel` to null.
- **Unbooked enquiries:** delete them; their status history goes with them, and links from other tables are set
  to null. A booked enquiry is kept, with `guest_name`, `guest_email`, `guest_phone` and `message` set to null
  where the booking does not need them.
- **`guest_leads`:** delete the row, unless an enquiry anywhere still uses the email.
- **`email_sends`:** delete the person's rows (they are delivery receipts).
- **What the client wrote:** delete their `proposal_comments`, the `event_plan_changes` copying them (their
  notices go with them), and set the client's notes in `proposal_status_history` to null; null `accepted_name`
  on unbooked proposals.
- **Notices:** delete the enquiry's in-app notice and the notices about their proposals.
- **Staff text:** edit any free text that names the person in the stores above.
- **An account, if they have one:**
  1. delete the user in Clerk (the webhook only unlinks it);
  2. then set the `users` row's `email` to `erased-<user id>@erased.invalid`, `name` to `Erased`, and
     `display_name`, `phone` and `organization_name` to null;
  3. remove any remembered allergy note (`note` null, `removed_at` set, which keeps the consent record without
     the note).

## 4. Confirm

1. Run step 2's queries again: each should find nothing, or only what a booking or a contract keeps.
2. Reply to the person: what was erased, what is kept and why (a booking's or a contract's six-year rule), and
   that backups lose it within 14 days.
3. Close the entry in the erasure log with the date.

## The erasure route

`POST /people/:personId/erase` (the venue's administrators and managers; another venue's person is not found; a
record merged into someone else answers `MERGED` with who to erase instead) erases, in one transaction:
- the person and every record merged into them: every personal field above cleared, the rows kept;
- their contact points and membership role labels;
- the merge snapshots that copy them;
- their own household's name, address, notes and VAT number. A household they belong to with another live member
  stays that member's (one they led passes to them), and only their name leaves its name and notes;
- their enquiries at the venue: linked to them, or linked to nobody and sent from an address only they hold. An
  address another live person at the venue holds finds nothing: the other person's enquiries, comments and lead
  stay. Each enquiry goes with its status history, the venue's email receipts for it and its in-app notice;
- the guest lead of each of their addresses, and of the addresses their enquiries came from, when no other
  enquiry uses it;
- what the client wrote on their proposals (comments and answers, signed or not), every copy of those words in the
  change feed and its notices, the client's status notes, and the name typed to accept. Their share links are
  revoked, so a link stops working for anyone it was forwarded to as well. A comment there signed with an address
  another live person holds is that person's: it stays, without the erased person's name;
- what they wrote on **someone else's** proposal (signed from an address only they hold, or under their name: an
  acceptance a PA typed for her director) is that client's record: it stays, with every copy in the change feed and
  notices and the name typed to accept, without their name and address;
- a deal made from their enquiry that another live person leads stays that person's, with its proposals, comments,
  acceptance and share links: only their name leaves it;
- their full name and addresses, wherever they appear as whole words in the text the venue keeps: deal titles, next
  actions and stage notes, activity notes, Diary bookings and their events (name, client name, notes, phase notes),
  proposal titles and the versions sent (title and message; another person's proposal with a contract or deposit
  keeps its versions), staff comments and status notes, change feed entries and notices. The reason given for a
  decision is erased on a booking pencilled from their enquiries, and on their other bookings and the nearby deal's
  where it names them. A full name is two words or more; it matches as written, in every casing
  it was written in ("isla erasable" typed into an enquiry as well as "Isla Erasable" on the record); an address
  matches in any case. A full name another live person at the venue also goes by is left: that text may be theirs.
  Their answers on someone else's proposal are found by their address or by their full name on the client's change
  in the feed, so a client who is not in the People Book and has the same full name loses it there too.

It answers with the counts and writes a `people.erased` row to `general_audit_log` with them (no names).

It refuses, changing nothing:
- `PERSON_HAS_BOOKING`: a confirmed booking, or a live provisional one, from one of their enquiries or on an event
  of theirs (an event one of their enquiries was booked into, even when the date was confirmed on the event itself;
  the event of a deal, or an organisation, they are the main contact for; the event of a household they belong to;
  an event made from their proposal's layout). A booking on the event of a deal another live person leads is that
  person's, even when it was pencilled from their enquiry.
  A released or lost hold is not a booking;
- `PERSON_HAS_CONTRACT`: a contract prepared or signed, or a deposit requested, on a proposal of theirs;
- `RETRY`: someone changed one of their records at the same moment; try again.

Then erase by hand what the booking or the contract does not need (section 3).

**Still by hand after the route:** an account (step 3's last item); email receipts sent to their address that are
not about one of their enquiries (`email_sends` by recipient: a planner account's review emails, for example);
`quotes` and `follow_up_tasks` text; any staff text that names them in words other than their full name or address
(their first name on its own, which the route leaves because "Will", "May" or "Rose" are words in other sentences
too; a full name another live person at the venue also goes by; a name typed differently, a nickname; "the bride");
an enquiry's in-app notice another enquiry kept here could equally have written (the same name within the same
minutes, a partner's from the shared inbox), or written under an address since corrected on the enquiry (the notice
holds no enquiry id); and a **deleted** record of theirs (a duplicate deleted instead of merged): the
route does not treat it as theirs, the 24-month pass erases it in time, or erase it by hand. Read the step 2
stores' text before replying.

## The 24-month pass

The nightly cleanup (`scripts/run-cleanup.ts`, `services/people-retention.ts`) runs the same erasure:
- for every person we have not been in touch with for 24 calendar months (the run's time minus 24 months, counted
  by the database: 1 March 2028 reaches back to 1 March 2026, 731 days). "In touch" is any contact about anything of theirs: the People Book's last contact, and their
  enquiries, deals, activity notes, proposals (made, changed or sent), client comments and answers, and Diary
  bookings, and work on a deal another live person leads that was made from their enquiry. Their enquiries are those
  linked to them and those linked to nobody from an address only they hold. An edit to their record alone does not
  count;
- for a person kept for a booking or a contract: their enquiries that never became one are deleted, and the person
  is kept, never half-erased;
- for every enquiry linked to nobody, sent from an address no live person at its venue holds, last touched more
  than 24 months ago and never booked or contracted, with its receipts, notices and guest lead.

Who is looked at is decided from their own records first: someone in touch through those, or kept for a booking or
a contract with nothing left to remove, is never a candidate, so they cannot hold the queue up night after night.
A night acts on at most 100 people and 200 lone enquiries, looks at no more than 500 of each, oldest first, starts
no step after two and a half minutes (the job stops at five, and the passes after this one need their time), and
leaves the rest for the next night (the People Book's backfill falls due together in 2028, so expect a few nights of
catching up then). One person or enquiry failing is rolled back, counted with its SQLSTATE only, and tried again
the next night; the job then fails, after every pass has run. The log carries counts only.

`POST /admin/retention/people` (platform admins) runs every step in one transaction and rolls it back, so its counts
are exactly what the night would do now. A step that changes nothing is rolled back at once; the erasures it
rehearses hold their rows until it finishes, so run it out of hours. It also lists, by id only, **who is kept for a
booking or a contract**: those people wait for the six-year rule, which is done by hand (sections 2 to 4) once the
booking's financial year is six years past. Each erasure writes a
`people.erased` row to `general_audit_log`, with "24 months after the last contact" as its summary and no actor.
The first production record falls due in 2028.
