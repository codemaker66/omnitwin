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
| A show-round | `bookings.kind = 'viewing'` | `POST /bookings/viewings` (for an enquiry), or the Diary's create with kind viewing |
| Why a booking was lost | `bookings.lost_reason` | `transitionBookingCore`, with the move to `lost` |
| Where the person found the venue | `enquiries.referrer_host`, `utm_*`, `acquisition_channel` | `POST /public/enquiries`, from `attributeEnquiry` in `@omnitwin/types` |
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
waits, in both orders). It is never before the enquiry arrived, never later than
the moment it is recorded (`enquiries_first_response_order`), and the four columns
are set together or not at all (`enquiries_first_response_whole`).

**Two kinds of reply.** Venviewer records its own, at the server's time: `decision`
(the enquiry approved or declined, which emails the guest) and `proposal` (a
proposal marked sent, for the enquiry it carries or its deal's enquiry at the same
venue). A person reports the rest with `POST /enquiries/:id/first-response`
(`email`, `phone`, `in_person`, `video_call`, `text_message`), optionally saying
when and who replied. Only the venue's own commercial team (admin, manager, staff,
sales) may report one; the floor, customers, a Venviewer platform admin and
another venue are refused. Every report is written to `general_audit_log`
(`enquiry.first_response_reported`), including those that change nothing, because
the enquiry keeps only the earliest. `first_response_recorded_at` minus
`first_response_at` shows how late a reply was reported. The automatic
acknowledgement a guest receives on sending is never a reply.

**What a first reply means.** It is the earliest reply *Venviewer knows of*. A reply
sent from the venue's own mailbox counts only once someone reports it, so until
replying from the desk is the habit, the stamp is an upper bound on the true reply
time. The baseline plan's reconciliation step measures that gap.

**Visits, not requests.** An opening at least 30 minutes after the last is a new
visit (`PROPOSAL_VIEW_VISIT_GAP_MINUTES`), so the page's own refetches and a
reader's reloads count once. A link opened before counting began has neither its
count nor its first visit known: both are NULL, never a guess
(`proposal_share_tokens_views_known`). That includes a link the release before
0100 opened while 0100 was already applied (count 0 beside a last view), which this
release reads as uncounted.

**A viewing is a viewing.** It belongs to its enquiry and never to an event
(`bookings_viewing_has_no_event`), so the client's schedule, the hallkeeper sheet
and supplier passes are unchanged by it. It never makes a date busy or held on a
public read. Its only exit is `cancelled`, no booking can become one (not even by
the admin's structural override), and the conflict engine reports `viewing_overlap`:
a warning during a confirmed booking's occupancy (set-up and clearing included) or
a house block, and info for two viewings at once.

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
  path or query) and the five UTM tags, cleaned; a tag holding an `@` is dropped
  whole. Venviewer's own pages are not a source.
- Engagement events go with their enquiry or proposal, and after 24 months
  (`ENGAGEMENT_RETENTION_MONTHS`, the privacy page's enquiry period) in any case:
  the nightly cleanup (`scripts/run-cleanup.ts`, pass 4) removes them.

**Dark until the notice exists.** Where a person came from, and a walk through the
twin, can only come from the browser. PECR Schedule A1 paragraph 5 (inserted by the
Data (Use and Access) Act 2025, in force 5 February 2026, SI 2026/82) allows such
collection without consent only when people get clear and comprehensive
information about it and a simple, free way to object. Blake chose on 19 October
2026 to build the server side now and send nothing from any page until the privacy
page describes it (legal copy, through the solicitor) and a visitor can object. So
today `attribution` and `engagement` on `POST /public/enquiries`, and
`POST /proposal-share/:token/engagement`, are accepted and tested but never sent,
and their columns and table stay empty. The page that turns them on must update
the privacy page's list of what is collected in the same release.

## Reading the measures

All counts belong to one venue; leave out seed fixtures (`fixture_source IS NOT NULL`)
and drafts.

```sql
-- Hours to the first reply (wall clock), median and p90, and how many have none.
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_response_at - created_at) / 3600) AS median_hours,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM first_response_at - created_at) / 3600) AS p90_hours,
       count(*) FILTER (WHERE first_response_at IS NULL) AS unanswered
FROM enquiries
WHERE venue_id = $1 AND fixture_source IS NULL AND state <> 'draft'
  AND created_at >= $2 AND created_at < $3;

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

## Tests

- `packages/api/src/__tests__/enquiry-funnel-postgres.test.ts`, on a migrated
  disposable database (`VENVIEWER_ENQUIRY_FUNNEL_TEST_DATABASE_URL`): access control,
  cross-venue refusal, validation, the minimum register under concurrent reports and
  a deterministic two-transaction interleaving in both orders, decisions and sent
  proposals as replies, visit counting (including concurrent openings and unknown
  links), engagement (one subject, composite keys, cascade, retention), attribution,
  viewings and lost reasons.
- `packages/api/src/__tests__/enquiry-funnel-migration-postgres.test.ts`
  (`VENVIEWER_ENQUIRY_FUNNEL_MIGRATION_TEST_DATABASE_URL`): 0100 applied to a
  database migrated to just before it and written as the previous release wrote it:
  the backfill, unknown views, the previous release still writing, and a second run
  changing nothing.
- `packages/types/src/__tests__/enquiry-funnel.test.ts`: referrer and tag cleaning,
  the channel table, and every schema's refusals.
- `packages/api/src/__tests__/services/calendar-conflicts.test.ts`: viewing overlap.

## Not here yet

- The Enquiries desk control to report a reply, and the reply-time alarm (run-first
  item 3), which read these columns.
- The page that sends attribution and the 30-second walk, with the privacy notice
  and the objection switch (above).
- A funnel read-out (the measures above as one venue-scoped endpoint), once the
  venue's staffed hours are recorded for business-hour arithmetic.
