# The enquiry funnel

**Read this when:** recording or reading a first reply, a proposal link's visits, a
viewing (show-round), a lost reason, where an enquiry came from, or an engagement
event; or adding a page that would send attribution or engagement.

Source: run-first item 1 of the 16 October 2026 report *Deeper upgrades across the
Venviewer stack* (section "Reply time, not booking rate, can prove value at one
venue"). Task T-670, migration `0100_enquiry_funnel`.

## Why it exists

Detecting a booking-rate lift from 20% to 25% at 80% power needs about 1,090
enquiries per arm, far beyond one heritage venue's year. So Venviewer's value at
Trades Hall is judged on leading measures with large, fast effects: business hours
to the first substantive reply, staff minutes per proposal, how complete an enquiry
arrives, show-rounds per booking and days to a decision on a hold. Before 0100 none
of them was recorded. The 12-month baseline they are compared against is planned
in [enquiry-baseline-plan.md](enquiry-baseline-plan.md).

## What is recorded

| Record | Where | Written by |
|---|---|---|
| The first substantive reply: when, who, how, and when Venviewer learned of it | `enquiries.first_response_at / _by / _channel / _recorded_at` | `services/enquiry-funnel.ts` `stampFirstResponse` only |
| A proposal link's first visit and its visits | `proposal_share_tokens.first_viewed_at`, `view_count` | `countProposalView`, on `GET /proposal-share/:token` |
| A show-round | `bookings.kind = 'viewing'` | `POST /bookings/viewings` (for an enquiry), or the Diary's create with kind viewing (a walk-in) |
| Why a booking was lost | `bookings.lost_reason` | `transitionBookingCore`, with the move to `lost` |
| Where the person found the venue | `enquiries.referrer_host`, `utm_source / _medium / _campaign`, `acquisition_channel` | `POST /public/enquiries`, from `attributeEnquiry` in `@omnitwin/types` |
| A moment of interest on an enquiry or proposal | `venue_engagement_events` | `recordEnquiryEngagement`, `recordProposalEngagement` |

`enquiries.source` widens to seven touchpoints: the five before, plus `listing` (a
listing site's own enquiry form passing the lead on) and `assistant` (an enquiry
an AI assistant made). The touchpoint is how the enquiry arrived; the acquisition
channel is where the person found the venue before that. They differ (a planner
enquiry can come from a listing), so they are separate columns.

## The rules

**The first reply only ever moves earlier.** A write lands only when the enquiry
has no reply yet, or a later one than the write's, in one `UPDATE` whose `WHERE`
PostgreSQL re-checks against the row it has locked. Concurrent writers therefore
agree on the earliest reply in whatever order they commit, and who and how always
travel with when (the Postgres suite holds one transaction open while another
waits, in both orders). It is never before the enquiry was made, never later than
the moment it is recorded (`enquiries_first_response_order`), and the four columns
are set together or not at all (`enquiries_first_response_whole`). A reply given to
the millisecond the enquiry arrived is recorded as the arrival itself.

**Two kinds of reply.** Venviewer records its own, at the server's time: `decision`
(the enquiry approved or declined, which emails the guest) and `proposal` (a
proposal marked sent, for the enquiry it carries or its deal's enquiry at the same
venue). Either names the person only when they are on the venue's team; a
Venviewer operator acting for the venue is recorded as nobody. A person reports
the rest with `POST /enquiries/:id/first-response` (`email`, `phone`, `in_person`,
`video_call`, `text_message`), optionally saying when and who replied:

- only the venue's own commercial team (admin, manager, staff, sales;
  `isVenueCommercialMember`) may report one, and only for someone on that team; the
  floor, customers, a Venviewer platform admin and another venue are refused;
- the reply is measured from when the enquiry was sent (its first move to
  `submitted`), not when a customer's draft was made;
- a reply more than 7 days before it is reported
  (`FIRST_RESPONSE_REPORT_WINDOW_DAYS`) is recorded only by the venue's admin or
  manager, since reply time is what the team is judged on;
- every report is written to `general_audit_log` (`enquiry.first_response_reported`),
  including those that change nothing, with the reply it displaced (`previous`), so
  a report can never erase one without trace. `first_response_recorded_at` minus
  `first_response_at` shows how late a reply was reported.

The automatic acknowledgement a guest receives on sending is never a reply. A
decision is stamped as it is made; its email is sent after, and a failed send is
logged by the email service, not unstamped.

**What a first reply means.** It is the earliest reply *Venviewer knows of*. A reply
sent from the venue's own mailbox counts only once someone reports it, so until
replying from the desk is the habit, the stamp is an upper bound on the true reply
time. The baseline plan's reconciliation step measures that gap.

**Recording a reply from the desk.** The Enquiries desk's panel has a *First reply*
section for the venue's commercial team (`replyVenueOf` in
`lib/role-capabilities.ts`, mirroring `isVenueCommercialMember`): it says when and
how the venue first replied, and *Record a reply* posts to the route above with the
channel chosen (never assumed) and either no time ("Just now") or a venue-local
wall time ("Earlier"); once a reply is recorded only an earlier time is offered,
since a later one can never replace it. A report no earlier than the reply held is
answered with the reply that stands, and the panel says so. A save that fails after
the person has moved to another enquiry is said in a toast. Who replied is the
person recording it; naming a colleague is the API's (`respondedBy`), not yet the
desk's. Nothing is sent to the client.

**The reply-time alarm.** `GET /enquiries/reply-alarm` answers the caller's venue's
booking enquiries still in `submitted` or `under_review` with no first reply
`ENQUIRY_REPLY_ALARM_DEFAULT_HOURS` (24) wall-clock hours after they arrived (their
first move to `submitted`, else creation): how many, the one waiting longest
(`longest`), the most recently flagged first (at most `ENQUIRY_REPLY_ALARM_LIST_LIMIT`,
200, as the desk lists them newest first), `nextDueAt` (when the next waiting one
will pass the mark) and `asOf` (the database's clock), all read in one read-only
transaction so they share one `now()`. Requests (access, Venviewer), seed fixtures
and enquiries that arrived before `ENQUIRY_REPLY_ALARM_FROM` (29 October 2026, the
release that let the desk record an outside reply) are left out: before it no
outside reply could be recorded, and most such enquiries could no longer be cleared
(a reply over a week old is the admin's or manager's to record); the desk still
lists them by age. Only the venue's commercial team may read it (the floor, a
customer, a platform admin acting for no venue or holding a floor role: 403).

The desk shows one line under its summary with *Open the longest unanswered*, a
*No reply* mark on each flagged row, and the alarm in the panel's *First reply*. It
reads the alarm when it opens, after a decision, a recorded reply or a reload made
on it, a beat after `nextDueAt` (timed from `asOf`, so a fast browser clock cannot
make it loop), when the desk is looked at again more than five minutes after the
last read, and at least every six hours; a failed read keeps the alarm last read and
is tried again after five minutes. Never on a short timer, so a desk left open does
not keep the database awake. The venue's operating settings hold no reply threshold
yet, so 24 hours is a named default for every venue; it counts nights and weekends,
since business hours need the venue's staffed hours. The filter is served by
`enquiries_venue_state_idx` (venue, state), so the alarm needs no index of its own.

**Visits, not requests.** An opening at least 30 minutes after the last is a new
visit (`PROPOSAL_VIEW_VISIT_GAP_MINUTES`), so the page's own refetches and a
reader's reloads count once, and concurrent openings count once. A link opened
before counting began has neither its count nor its first visit known: both are
NULL, never a guess (`proposal_share_tokens_views_known`). That includes a link the
release before 0100 opened while 0100 was already applied (count 0 beside a last
view), which this release reads as uncounted. A visit says the link was opened, not
by whom: the team reads a proposal through the desk's preview, which never stamps,
but anyone holding the link itself (a colleague included) counts. Counting is a
measure, never the page: if it fails, the client still reads the proposal.

**A viewing is a viewing.** It never belongs to an event
(`bookings_viewing_has_no_event`), so the client's schedule, the hallkeeper sheet
and supplier passes are unchanged by it. It never makes a date busy or held on a
public read. Its only move is to be called off (and, by the admin's override, a
called-off one put back): no booking becomes a viewing and a viewing becomes no
commitment. Booked for an enquiry, it must be one asking to book a room (not a
draft, an access request or an enquiry about Venviewer), and the same viewing asked
for twice is booked once (`bookings_viewing_once`; the second request answers with
the first). A walk-in viewing booked straight from the Diary has no enquiry; it
holds the room but is not counted in show-rounds per booking. The conflict engine
reports `viewing_overlap`: a warning during an occupancy (a confirmed booking or an
event's timed phases in the room, set-up and clearing included) or a house block,
and info for two viewings at once. The Day Board shows a viewing, measures a
function's changeover from the last function past it, and never cuts a clear-down
short at one.

**A lost reason is only on a lost booking** (`bookings_lost_reason_check`), from
`BOOKING_LOST_REASONS`, optional, written with the move to lost and cleared by any
other move. The transition's note keeps the detail.

## Privacy

The privacy page says Venviewer runs no analytics product and sets no tracking
cookies, and that stays true:

- Nothing is stored on a visitor's device, and nothing follows an anonymous
  visitor. An engagement event belongs to exactly one enquiry the person sent or
  one proposal they opened, pinned to that venue by composite foreign keys, and
  holds the venue, that enquiry or proposal, the room, the kind and the time:
  never a device, address, cookie, session or name.
- Of where a person came from, only the referring site's host is kept (never its
  path or query; a lowercase hostname or Android app id, `enquiries_referrer_host_shape`)
  and three UTM tags, source, medium and campaign, cleaned. `utm_term` and
  `utm_content` are never read: email tools put per-recipient ids in them, and the
  channel needs neither. A tag holding an `@`, however encoded, or a link is
  dropped whole. Venviewer's own pages are not a source.
- The funnel fields are the venue's own measurements: the enquiry's customer reads
  the enquiry without them (`ENQUIRY_FUNNEL_FIELDS`).
- Engagement events go with their enquiry or proposal, and after 24 months
  (`ENGAGEMENT_RETENTION_MONTHS`, the privacy page's enquiry period) in any case:
  the nightly cleanup (`scripts/run-cleanup.ts`, pass 5) removes them.

**Dark until the notice exists, enforced by the server.** Where a person came from,
and a walk through the twin, can only come from the browser. PECR Schedule A1
paragraph 5 (inserted by the Data (Use and Access) Act 2025, in force 5 February
2026, SI 2026/82) allows such collection without consent only when people get clear
and comprehensive information about it and a simple, free way to object. Blake chose
on 19 October 2026 to build the server side now and keep nothing until the privacy
page describes it (legal copy, through the solicitor) and a visitor can object. The
server enforces that itself: unless `ENQUIRY_FUNNEL_BROWSER_SIGNALS` is `on`, it
ignores `attribution` and `engagement` on `POST /public/enquiries` and answers 404 to
`POST /proposal-share/:token/engagement`, whatever a page sends. Turning it on goes
with the release that updates the privacy page's list of what is collected and adds
the way to object. Both inputs are forgiving when on: attribution or engagement that
cannot be read is dropped, never refusing the guest's enquiry.

## Reading the measures

All counts belong to one venue; leave out seed fixtures (`fixture_source IS NOT NULL`)
and drafts. An enquiry arrives when it is first moved to `submitted`.

```sql
-- Hours to the first reply (wall clock), median and p90, and how many have none.
WITH arrived AS (
  SELECT e.*, coalesce((SELECT min(h.created_at) FROM enquiry_status_history h
                        WHERE h.enquiry_id = e.id AND h.to_status = 'submitted'), e.created_at) AS arrived_at
  FROM enquiries e
  WHERE e.venue_id = $1 AND e.fixture_source IS NULL AND e.state <> 'draft'
)
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_response_at - arrived_at) / 3600) AS median_hours,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM first_response_at - arrived_at) / 3600) AS p90_hours,
       count(*) FILTER (WHERE first_response_at IS NULL) AS unanswered
FROM arrived WHERE arrived_at >= $2 AND arrived_at < $3;

-- Enquiry completeness: arrived with a date, a guest count and a room.
SELECT avg((preferred_date IS NOT NULL AND estimated_guests IS NOT NULL AND room_chosen)::int) AS complete_share
FROM enquiries WHERE venue_id = $1 AND fixture_source IS NULL AND state <> 'draft' AND created_at >= $2 AND created_at < $3;

-- Show-rounds per confirmed booking, by enquiry.
SELECT count(*) FILTER (WHERE kind = 'viewing' AND status = 'active' AND ends_at < now())::numeric
       / NULLIF(count(DISTINCT enquiry_id) FILTER (WHERE kind = 'ink' AND status = 'active'), 0) AS viewings_per_booking
FROM bookings WHERE venue_id = $1 AND deleted_at IS NULL AND fixture_source IS NULL AND enquiry_id IS NOT NULL;

-- Why bookings were lost.
SELECT coalesce(lost_reason, 'not said') AS reason, count(*) FROM bookings
WHERE venue_id = $1 AND status = 'lost' AND deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC;
```

Business hours, the measure the run-first table judges on, need the venue's staffed
hours, which Venviewer does not hold yet; the baseline plan defines them with the
venue and computes both. Days to a decision on a hold read `booking_status_history`
(from the move into `hold` to the move out of it), as the Diary already records.

## Deploying and rolling back

- 0100 takes every lock at the start in one statement, child tables before the
  tables they point at, with a 5-second lock timeout: a busy moment fails the deploy
  cleanly rather than holding writes. It is additive for the release before it, and
  it must not ship in the same deploy as 0098 (the People Book), whose backfill holds
  `enquiries` for about two seconds. 0098 went live first (`ced4a1bb`, 20 October).
- In the journal 0100 follows 0098 (idx 97, its `when` above 0098's). The migrator
  skips a migration whose `when` is not above the last one applied, so a migration
  merged after 0100 needs a larger `when`, and a test database that ran an earlier
  0100 before 0098 existed must be recreated, not migrated.
- On `POST /public/enquiries`, attribution is written in the People Book's one
  enquiry insert, and engagement inside the same transaction in a savepoint of its
  own, as the person link is: a failure there is logged and the enquiry kept.
- The new fields are optional in the shared schemas, so a web build and an API build
  of either side of 0100 parse each other. The widened enums (`viewing`,
  `viewing_overlap`, the two sources) reach an older reader only once a viewing has
  been booked with the new web, so ship both from the same merge.
- Rolling the API back past this release after viewings exist makes the older API
  refuse to read them (its booking schema has no `viewing`): roll forward, or remove
  the viewing rows first.

## Tests

- `packages/api/src/__tests__/enquiry-funnel-postgres.test.ts`, on a migrated
  disposable database (`VENVIEWER_ENQUIRY_FUNNEL_TEST_DATABASE_URL`): access control,
  cross-venue refusal, validation, arrival from submission, the backdating rule, the
  minimum register under concurrent reports and a deterministic two-transaction
  interleaving in both orders, the audit's displaced reply, decisions and sent
  proposals as replies (an operator's naming nobody), the customer's view without
  the funnel fields, visit counting (concurrent openings, unknown links), engagement
  (one subject, composite keys, cascade, retention), the reply-time alarm (who is
  flagged and who is not, arrival from submission, a recorded reply or decision
  clearing it, its readers and refusals), a replayed report answered with the same
  reply, attribution (hostile referrers,
  the shape check, forgiving input) and the switch, viewings (booked once, refused
  for drafts and requests, never a commitment) and lost reasons.
- `packages/api/src/__tests__/enquiry-funnel-migration-postgres.test.ts`
  (`VENVIEWER_ENQUIRY_FUNNEL_MIGRATION_TEST_DATABASE_URL`): 0100 applied to a
  database migrated to just before it and written as the previous release wrote it:
  the backfill, unknown views, the previous release still writing, and a second run
  changing nothing.
- `packages/types/src/__tests__/enquiry-funnel.test.ts`: referrer and tag cleaning
  (encoded addresses, links, IP literals, IDN), the channel table, and every
  schema's behaviour.
- `packages/api/src/__tests__/services/calendar-conflicts.test.ts`: viewing overlap,
  including an event's phase alone.

## Not here yet

- A reply threshold in the venue's operating settings (the alarm uses the 24-hour
  default until one exists), naming a colleague as the one who replied from the
  desk, and an alarm in business hours once the venue's staffed hours are recorded.
- The page that sends attribution and the 30-second walk, with the privacy notice,
  the objection switch and `ENQUIRY_FUNNEL_BROWSER_SIGNALS=on` (above).
- A funnel read-out (the measures above as one venue-scoped endpoint), once the
  venue's staffed hours are recorded for business-hour arithmetic.
