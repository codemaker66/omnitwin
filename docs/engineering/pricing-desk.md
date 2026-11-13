# The Pricing desk and its suggestions

**Read this when:** changing who sets prices, how a rate applies on a date, the
Pricing desk (`/dashboard?view=pricing`), or the pricing suggestions.

## Who does what

| Role | Price list and who changed each rate | Edit, retire, bring back | Suggestions |
| --- | --- | --- | --- |
| admin, manager (`PRICING_WRITE_ROLES` in `@omnitwin/types`) | yes | yes | yes |
| staff, sales | yes | no; the desk names who can | no |
| hallkeeper, planner, client, caterer | no (prices are not shown to the floor, goal 18 decision 6b) | no | no |

Routes: `GET /venues/:venueId/pricing-desk` (`canManageCommercial`),
`GET .../pricing-desk/advice` and the dismissals (`canWritePricing`). Rates are
written only through `/venues/:venueId/pricing`; every write is recorded in
`general_audit_log` in its own transaction (`services/pricing-rule-audit.ts`),
with `followedAdvice` in the metadata when a suggestion was followed.

Reading a price is never public (Blake, 17 October 2026: suggestions are advice,
never automatic and never exposed; a visitor is asked to enquire for a quote).
`GET /venues/:venueId/pricing`, `GET .../pricing/:id`, `POST .../pricing/estimate`
and `GET /enquiries/:id/quote` all need a sign-in and `canManageCommercial` for
the venue: signed out is 401; a client, an enquirer, a planner, the hallkeeper or
another venue's team is 403, with no rule, amount or date in the body (the
`/pricing` routes refuse before any lookup; the quote first finds the enquiry to
learn its venue). Allowed answers carry `Cache-Control: private, no-store`.
A dated rate saved from a suggestion is an ordinary active rule, so this gate is
what keeps a venue's high-demand dates and raised prices to its own team. A price
a client may one day see would be a separate projection that leaves out dated
and suggested rates, not these routes.

## A rate for particular dates

Rules stack: each applicable rule adds a line. A rate for particular dates
(for example one saved from a suggestion for Saturday 12 June 2027) **takes the
place of** the everyday rate on those dates, for the same room, the same time of
day and the same way of charging. Among such rules the one naming the fewest
dates stands; rules naming the same dates still stack, as before. One function
decides it, `standingRates` / `rateReplacements` in
`packages/types/src/pricing-desk.ts`, read by the API calculator
(`services/price-calculator.ts`), the proposals price list
(`proposals/price-list-format.ts`) and the desk's consequence line.

A set-aside rate's day and month adjustments (`dayOfWeekModifiers`,
`seasonalModifiers`) go with it. Suggestions are worked out on a rate's price
before its adjustments, so a rate added from a suggestion carries the same
adjustments as the rate it is based on; otherwise a "raise" on an adjusted
Saturday could charge less than today. The desk does not edit adjustments; it
shows them on the rate and the suggestion, and the consequence line says when a
dated rate typed in by hand does not carry them.

## How a suggestion is worked out

`packages/api/src/services/pricing-advice.ts` is pure (no database, no clock);
`services/pricing-desk-data.ts` reads the venue's own bookings, booking history,
enquiries and accepted quote lines, without seed fixtures. The method follows
`docs/research/r6-revenue-management.md`. Each room, date and rate (its time of
day mapped to morning, afternoon and evening, the evening running to 06:00) is
judged from these signals, each with its records:

- **2nd option or joint options** on the date: demand the 1st option displaces
  (+8%, +4% for each further party, up to +16%), weighted by the venue's own
  hold-to-confirmed rate once five or more holds have been decided.
- **Enquiries naming the date** that have not become a booking (+5% for two or
  more for the room; +3% for three or more across the venue).
- **Season**: the same weekday in the same month (else season) in the venue's
  own record, Cornell's bands: at least 80% sold +10%, 65% +5%, below 20% −5%.
  Needs six comparable dates.
- **Pace**: the month's dates held or confirmed now, against the same month a
  year ago at the same distance out (holds counted by the hold-to-confirmed
  rate); ±5%. Needs the book to have been kept a year ago.
- **Enquiry pace** for the room and month, against last year at this point; ±3%.
- **Close-in pickup** (within 90 days, nothing pencilled): how often comparable
  dates still free this far out were then booked; below 20% −5%, 60% or more +3%.
- **Last year's rate**: accepted quote lines from the room's rate in the same
  month last year, at least two; +4% when they sold 5% or more above today's rate.

The change is capped at +25% and −10%. A figure needs a baseline signal (one of
the history signals above) and at least five records; otherwise the desk says
"Too little history to suggest a change", and lists the facts only where a 2nd
option or pressing enquiries would have asked for a figure. The range narrows
from about ±8% on a thin record to ±2% on thirty records, and a change inside its
own range is left alone. Figures round to the steps a rate card uses (£50 above
£1,000, £10 above £200, £1 above £20).

A suggestion never changes a price. Accepting it opens the rate form filled in
(a rate for that date, or the date's own rate when it already has one); a person
saves it. Dismissals are kept in `general_audit_log` (`pricing_advice.dismissed`,
`pricing_advice.restored`; the newest decision on a key stands), so no migration.

## Competitor prices

`services/competitor-prices.ts` is an interface for a licensed feed (Blake,
17 October 2026: provider still being researched). It has no implementation, no
caller and no network access, and a test keeps it that way. Competitor prices
must never set or change a price automatically (UK CMA guidance on pricing
algorithms; Competition Act 1998, Chapter I). If a feed is added, show its
figures to a person as context with their provenance; do not feed them into
`computePricingAdvice`.

## The competitor watch

Blake approved the competitor-watch proposal on 17 October 2026: a dated
notebook beside the price list, gathered by people, never a pricing input.
Migration 0097, `services/competitor-watch-data.ts`,
`routes/competitor-watch.ts`, `services/page-check.ts`; the shared contract and
the rules are in `packages/types/src/competitor-watch.ts`.

| Who | Reads | Writes |
| --- | --- | --- |
| admin, manager (`canWritePricing`) | the set, captures, losses, page checks, the market context | everything below |
| the commercial team (`canManageCommercial`) | the set's names only (`GET .../names`), to say who won a lost deal | who won, through Mark lost |
| everyone else, and every other venue | nothing | nothing |

- **The set** (`competitor_venues`): name, website, the page with their
  prices, primary or secondary, a required reason, a review date six months
  out ("Review due" on the day). At most twelve. Removing one keeps it, its
  captures and its lost deals, with who removed it. "Start from the suggested
  set" loads the ten Blake approved (`SUGGESTED_COMPETITOR_SET`) into an empty
  set, for Trades Hall only; the figures the proposal saw are not carried, so
  every price in the watch is one the office captured.
- **Captures** (`competitor_price_captures`), append-only: a trigger refuses
  any edit or delete, except marking a source gone, once. A newer capture
  names the one it replaces (same competitor and venue, by key; one
  replacement each). The source must be the venue's own page (on its website)
  or its brochure; listing sites and marketplaces (`LISTING_SITE_HOSTS`) are
  refused with the reason. A screenshot or brochure goes up through the
  existing upload path (`context: "competitor_watch"`, the competitor's id,
  setters only); uploads answer 503 where storage is not configured, and the
  figure can be saved without one. States (`captureFreshness`): Current (90
  days or less, its year not passed, the page not changed since), Check due
  (90 to 180 days, or the page changed since), Stale (over 180 days or its
  year passed), Source gone, Unverified (the page gave no year).
- **Who won a lost deal** (`competitor_losses`) rides the existing reason:
  `PATCH /opportunities/:id` with `stage: "lost"` takes optional `lostTo` (a
  venue in the set, or another by name, and any figure the client gave) and
  writes the deal, its stage move and the loss in one transaction. A client's
  figure appears only on that deal's timeline, labelled "Client's figure,
  unverified"; the watch shows a competitor's lost deals and their reasons,
  never the figure.
- **Market context** (`GET .../context?year=`): the Current captures for the
  suggestion's year, primary first then by name, at most six, with how many
  more and how many are due a check. Never averaged, ranked, converted between
  bases or offered to match. The card in the suggestion panel stays closed
  until asked and says "Context only. Not used to set the suggestion."
  `pricing-advice.ts`, `pricing-desk-data.ts` and `routes/pricing-desk.ts`
  name none of the watch (`competitor-watch-boundary.test.ts`), and
  `competitor-watch-postgres.test.ts` proves the suggestions identical with and
  without captures, a lost deal and a page change.
- **The page check**: only for a page a person has recorded as allowed (they
  read the terms and robots.txt; who and when are kept), on the venue's own
  website, over https. It reads robots.txt first (RFC 9309, product token
  `VenviewerPageCheck`) and obeys it, names itself by its user agent, connects
  only to public addresses (checked at connection time), reads at most 2 MB
  in ten seconds, keeps only a SHA-256 of the page's main text and the date
  (`competitor_page_checks`), never parses a price and cannot write a capture.
  At most weekly per page; four weeks' rest after 401, 403 or 429. A changed
  page shows "Page changed: re-capture" until someone records a newer figure
  or says it was no real change. Changing the website or the page turns the
  check off until it is allowed again.
- **Running it**: the office's "Check the pages now"
  (`POST .../page-checks`), or `POST /admin/competitor-watch/page-checks` for
  every venue's due pages, as a platform administrator or with
  `COMPETITOR_WATCH_CRON_TOKEN` (its own secret; 32+ characters). The
  workflow `.github/workflows/competitor-page-check.yml` is manual only; its
  weekly schedule stays commented out until Blake approves it. Its public
  summary carries counts only.

Not built from the proposal: segments and capacities per competitor, a
cross-shop evidence field, a retention pass that drops evidence files after
24 months, and the twice-yearly review against the lost-enquiry log as a
report. Competition counsel should read the proposal's sections 4.3, 4.4 and
5.4 before launch (its own recommendation).

## Checks

- Maths: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/pricing-advice.test.ts`
- Access: `src/__tests__/pricing-desk-routes.test.ts`, and for reading a price
  `src/__tests__/pricing-rules-read-guard.test.ts`; on Postgres,
  `src/__tests__/pricing-desk-postgres.test.ts` with
  `VENVIEWER_ROUTE_TEST_DATABASE_URL` naming a loopback
  `venviewer_route_atomicity_test`.
- Dated rates: `src/__tests__/price-calculator.test.ts`,
  `packages/types/src/__tests__/pricing-desk.test.ts`,
  `packages/web/src/components/dashboard/proposals/__tests__/price-list-format.test.ts`.
- Desk: `packages/web/src/components/dashboard/pricing/__tests__/`.
- The competitor watch: `packages/types/src/__tests__/competitor-watch.test.ts`;
  in the API `page-check.test.ts` (network faked), `competitor-watch-routes.test.ts`,
  `competitor-watch-boundary.test.ts`, and on Postgres (the migration's own SQL)
  `competitor-watch-postgres.test.ts` with `VENVIEWER_ROUTE_TEST_DATABASE_URL`;
  who won a lost deal in `packages/web/src/components/dashboard/__tests__/PipelineDesk.test.tsx`.
