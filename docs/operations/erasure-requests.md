# Erasure requests, by hand (until the erasure service ships)

Written 26 October 2026 (release audit people-privacy-5). The privacy page says a
person can ask us to delete their enquiry sooner, and that enquiries that did not
become bookings, and the contact record, go 24 months after our last contact.
Nothing in the product does either yet: no route erases a person or an enquiry,
and `contacts.erased_at` is read as "not live" but never written. Until the
erasure service and its 24-month pass ship, a request is handled by hand, as
below.

**The clock:** one month from the day the request arrives (UK GDPR Article 12(3)).
Write the date down when it arrives.

## 1. Receive and record

1. Confirm who is asking: reply to the email address on the enquiry, not to a new one.
2. Start an entry in the erasure log (private, never in this repository). Write:
   - the date received and the deadline (one month later);
   - the venue;
   - the ids you find in step 2 (ids only, never the name or email).

   The [disaster-recovery](disaster-recovery.md) page relies on this log: after a restore from backup, every
   erasure since the restore point is done again.

## 2. Find everything (read-only)

Find the person and everything that carries them, at **one venue**: `:venue_id` is the venue the request is
about, `:email` the address on the request (lower-cased). Read only; change nothing yet.

| Store | What it holds | How to find it |
|---|---|---|
| `contacts` | name, email, phone, given/family name, job title, role, postal address, notes | `venue_id = :venue_id and lower(email) = :email`, plus every tombstone whose `merged_into_id` chain leads to it (a merged-away person keeps its details) |
| `contact_points` | emails and phones | by `contact_id` (goes with the contact) |
| `account_memberships` | role label | by `contact_id` (goes with the contact) |
| `client_accounts` | a household's name, address, notes | the person's own household only |
| `enquiries` | name, email, guest name/email/phone, message | `venue_id = :venue_id and (lower(email) = :email or lower(guest_email) = :email or contact_id in (…))` |
| `enquiry_status_history` | free-text notes | goes with its enquiry |
| `guest_leads` | email, phone, name | `lower(email) = :email`. It has no venue: keep the row if **another venue's** enquiry still uses the email |
| `record_merges.snapshot` | a full copy of a merged person, their contact points, and fields copied between records (`survivorFilled`) | `survivor_id` or `merged_id` in the person's ids |
| `email_sends` | recipient, subject | `lower(recipient) = :email` |
| `proposals`, `proposal_comments` | accepted name; comment author name and email | by the enquiry or opportunity; `lower(author_email) = :email` |
| `opportunities`, `activities`, `follow_up_tasks`, `quotes`, `bookings`, `events` | staff-written titles and notes that may name the person | by `primary_contact_id`, `source_enquiry_id`, `enquiry_id` or `client_account_id`; read the text |
| `users` | email, name, phone, organisation | only if the person has an account |
| `remembered_dietary_notes` | an allergy note | by the person's user id |

**A booking changes the answer.** An enquiry that became a booking is kept for six years after the financial year
of the event (the privacy page's accounting rule). Erase the contact details nobody needs for that, keep the
booking's record, and say so in the reply.

## 3. Erase, in one transaction, rehearsed first

Run the change twice:
1. **Dry run:** inside a transaction that ends `ROLLBACK`, with a count check after each statement.
2. **Real run:** the same transaction ending `COMMIT`.

Take a Neon snapshot first, as for any hand change to production.

- **The person and every tombstone of theirs:**
  - Set `name = 'Erased'`, and set `email`, `phone`, `given_name`, `family_name`, `job_title`, `role_label`,
    `postal_address` and `notes` to null.
  - Set `erased_at = now()`, and `deleted_at = now()` where it is still null.
  - Keep the rows, because bookings and history point at them. An erased person is no longer live anywhere, and a
    merge involving them can no longer be undone (`ERASED`).
- **Their contact points:** delete them.
- **Merge snapshots that mention them:**
  - in `person`, keep `id` and the timestamps, and set the other fields to null or `'Erased'`;
  - in `contactPoints`, blank each `value` and `displayValue` to `''`;
  - set `survivorFilled` to `[]`.
- **Unbooked enquiries:** delete them; their status history goes with them, and links from other tables are set
  to null. A booked enquiry is kept, with `guest_name`, `guest_email`, `guest_phone` and `message` set to null
  where the booking does not need them.
- **`guest_leads`:** delete the row, unless another venue still uses the email.
- **`email_sends`:** delete the person's rows (they are delivery receipts).
- **Proposals:**
  - delete the person's comments from `proposal_comments`;
  - null `accepted_name` on unbooked proposals.
- **Staff notes:** edit any free text that names the person in the stores above.
- **An account, if they have one:**
  1. delete the user in Clerk (the webhook only unlinks it);
  2. then set the `users` row's `email` to `erased-<user id>@erased.invalid`, `name` to `Erased`, and
     `display_name`, `phone` and `organization_name` to null;
  3. remove any remembered allergy note (`note` null, `removed_at` set, which keeps the consent record without
     the note).

## 4. Confirm

1. Run step 2's queries again: each should find nothing, or only what a booking keeps.
2. Reply to the person: what was erased, what is kept and why (a booking's six-year rule), and that backups lose
   it within 14 days.
3. Close the entry in the erasure log with the date.

## When the service ships

The erasure service (`POST /people/:personId/erase`, venue-scoped, administrators and managers only) and the
nightly 24-month pass do sections 2 and 3 in one transaction, with a dry run. This page then shrinks to steps 1
and 4.
