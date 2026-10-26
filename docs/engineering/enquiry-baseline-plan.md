# Rebuilding Trades Hall's 12-month enquiry baseline

**Read this when:** measuring reply time, enquiry completeness or conversion at
Trades Hall before Venviewer, or reconciling the funnel's rows with the venue's
mailbox. Status: a plan. Nothing here has been run, and it needs the venue's
written consent first.

Source: run-first item 1 of the 16 October 2026 report *Deeper upgrades across the
Venviewer stack*. The pass rule there: "logged rows reconcile with the mailbox".
What the funnel records from now on is in [enquiry-funnel.md](enquiry-funnel.md).

## The question it answers

How long did Trades Hall take to give an enquirer a first substantive reply, and how
complete were enquiries when they arrived, over the twelve months before Venviewer?
Measured as the median and p90 business hours to the first substantive reply, the
share of enquiries arriving with a date, a guest count and a room, and, joined with
the diary, show-rounds per booking and days from a hold to its decision. The
post-launch comparison runs 8 to 12 weeks against it. Reply times are heavy-tailed,
so the test is a rank test (Mann–Whitney U) on per-enquiry hours, reported beside
medians and p90s, with the same calendar months compared where seasonality bites
(wedding enquiries peak after the December engagement season).

## Before anything is touched

1. **Consent, through Blake.** The venue is the data controller for its mailbox and
   diary; Venviewer processes enquiry information only on its instructions. Blake
   asks Trades Hall for written agreement to this purpose (measuring reply time and
   enquiry completeness for the pilot), its scope (info@ and the diary, the last 12
   months), and the method below. No session opens the mailbox before that is on
   file.
2. **A short data-protection note**, agreed with the venue: purpose, the fields kept,
   who sees what, how long, deletion. The rule throughout is minimisation: no message
   bodies, names, email addresses or phone numbers leave the venue's own machine.
3. **Staffed hours.** The venue confirms the hours it answers enquiries (for example
   Monday to Friday, 09:00–17:00 Europe/London) and which Scottish bank holidays it
   closes. Business-hour arithmetic uses exactly these and is tested across both
   clock changes.

## How the mailbox is read

- **The venue exports, Venviewer never signs in.** A member of the venue's staff
  exports the 12 months of info@ (inbox and sent items) from their own mail client
  or admin console onto a venue machine. No mailbox credentials are shared.
- **An extraction script runs on that machine** and writes one CSV row per enquiry
  thread, with only:
  - `thread_key`: a keyed hash (HMAC-SHA256) of the thread identifiers, with the key
    held by the venue, so rows can be joined and re-checked without revealing who;
  - `received_at`: the first inbound message from outside the venue, UTC;
  - `first_reply_at`: the first outbound message from a venue address that is not an
    automatic reply (excluded by `Auto-Submitted`, `X-Autoreply` and
    `Precedence: auto_reply` headers, and by the venue's own acknowledgement and
    out-of-office texts, matched by template);
  - `replied_by_role` where a signature shows it (events, office, management), never a
    name;
  - `came_via`: the venue's own form, a listing site passing the lead on (known by
    sender domain: Hitched, Bridebook and the like), a direct email, or a phone note;
  - `had_date`, `had_guest_count`, `had_room`, `occasion`: set by hand from the first
    message, by the venue's staff or under their eye.
- **What is not an enquiry** is left out: suppliers, marketing, existing clients'
  follow-ups, spam. The rule for each is written down before labelling starts.
- **Phone enquiries** are counted from the diary or any call log the venue keeps; where
  none exists that gap is stated, not estimated.

## The diary side

From the venue's diary for the same months: holds and the date each was decided
(confirmed or released), show-rounds where they were written down, and which
enquiries became bookings. Joined to mailbox rows by date and room, never by name,
and only as counts.

## Staff minutes per proposal

Time the next ten proposals by hand: the coordinator notes start and stop for each,
with interruptions noted rather than subtracted, on a one-page sheet. Reported as
the median and range of minutes. This is a time-and-motion count, not a log of
the person.

## Checks that it is right

- **Two labellers on 30 threads.** Two people independently label 30 randomly chosen
  threads (substantive reply or not, occasion, completeness). Cohen's kappa of 0.8 or
  more on "substantive reply" before the rest is labelled; disagreements settle the
  written rule.
- **Twenty threads end to end.** Twenty random rows are checked against their threads
  by the venue: received time, first reply time and source.
- **Against the ledger.** The count of bookings the rows imply is compared with the
  venue's own ledger for the period; a gap is explained or the extraction fixed.
- **After go-live, the funnel against the mailbox.** For four weeks, every venue reply
  in info@ should have its reported stamp (`first_response_*`, channel `email`). The
  share without one measures under-reporting, which bounds how far the funnel's
  reply times can be trusted until replying from the desk is the habit.

## What comes out, and where it is kept

A baseline report for the venue and Blake: per month and per source, the count of
enquiries, median and p90 business and wall-clock hours to the first reply, the
share with no reply, completeness shares, show-rounds per booking and days to a
hold's decision. The per-thread CSV stays on the venue's machine (or a Venviewer
location the venue agrees to, never this public repository) and is deleted when
the venue says the baseline is final; the export itself is deleted as soon as the
CSV is written. Only the report's aggregates are shared further.

## Effort

About two to three days with the mailbox once consent is in place (the report's
estimate), most of it in labelling and the checks above.
