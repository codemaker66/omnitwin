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

## Checks

- Maths: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/pricing-advice.test.ts`
- Access: `src/__tests__/pricing-desk-routes.test.ts`; on Postgres,
  `src/__tests__/pricing-desk-postgres.test.ts` with
  `VENVIEWER_ROUTE_TEST_DATABASE_URL` naming a loopback
  `venviewer_route_atomicity_test`.
- Dated rates: `src/__tests__/price-calculator.test.ts`,
  `packages/types/src/__tests__/pricing-desk.test.ts`,
  `packages/web/src/components/dashboard/proposals/__tests__/price-list-format.test.ts`.
- Desk: `packages/web/src/components/dashboard/pricing/__tests__/`.
