# 06 · One event, end to end — the commercial promise carried in one record

## The /goal block

Carry one real Trades Hall event through the whole commercial promise inside the product: discovery, a visual enquiry, a contact and opportunity, date options and room holds, a living proposal with a real layout, an exact quote, contract and deposit, a client workspace with its decisions, planning approval, operational release, the hallkeeper's day, close-out and actuals. A change (150 to 180 guests, dinner moved by thirty minutes) shows every affected output, preserves the old release and publishes the new one only on a venue admin's approval through the decision object. Then rehearse it, then operate a nominated real event with Elaine. This is where "an infinitely better Cvent and Salesforce combined" is proved pain point by pain point, and every one of the twelve becomes an acceptance test.

## Outcome, in Blake's words

"Like an infinitely better cvent and salesforce combined and all our magic baked on top to be something all together new and fresh"; "All pain points of the industry will be addressed and we will provide the best service and extreme value to everyone who uses our platform for every use case in anything relating to events." Plan 16 §1: "Venue admins approve changes and times; intelligence does the decision preparation."

## Where we are

CRM, proposals, quotes, versions and shares have code (packages/api/src/routes/proposals.ts; the client page approves, requests changes and comments through a share token). The Diary's seven slices are in production: bookings, the drawer, enquiry conversion, the corridor to the planner (T-539), command envelopes and idempotency. Events carry phases, snapshots and approvals. Stripe is schema only; there is no client payment surface and no e-signature. Eight Resend email templates. Two drifts: the homepage enquiry is a mailto while POST /public/enquiries works, and the two flagship slugs (the asset slug trades-hall against the venues row trades-hall-glasgow) 404 public enquiries when mixed. "executive" is branched on in four files but is not a role. Pricing tiers and the at-cost rate are drafts. Nobody signed in has clicked Diary, planner, sheet and Day Board through on production; that is Saturday's rehearsal. Current review policy lets staff and hallkeepers act on things plan 16 now reserves for admin approval.

## The twelve pain points we beat, each an acceptance line

1. The brief retyped across enquiry, CRM, proposal and BEO.
2. Capacity as one misleading number.
3. The proposal as a PDF of a screenshot.
4. A quote that drifts silently from the version the client accepted.
5. A hold that expires unnoticed.
6. Stock promised to two events at once.
7. The BEO retyped by every department.
8. The client's change lost in an email thread.
9. Staff working from the wrong version on the day.
10. No actuals, so nothing learned.
11. Slow, clunky, ugly software that people abandon for a spreadsheet.
12. The venue's own data locked in.

## Decided

- The existing records are the spine: event, bookings, phases, snapshots, quotes, approvals, shares. "Spatial Event Contract" names their coherent relationship, not a new object or a second clock.
- Accepted versions are immutable. Accepted price, confirmed booking, payment status, planning approval and operational release are five separate states.
- Every consequential change (a time, a guest count, a price, a layout release, a stock remedy) is a decision object (goal 09): options, the recommendation, consequences across booking, layout, inventory, staff, price and timing, missing facts, and the exact mutations; a venue admin approves it through a narrow venue-scoped capability, never through canManageVenue; the admin's own direct action counts as approval when the action and its consequences are clear; a stale approval revalidates and returns the revised choice rather than executing.
- Multi-room events stay one event. Guests see only what concerns them. Money is never held by Venviewer.
- Payment and signature go through providers configured only when HUMAN.md 9 and 10 exist; until then the flows are built against test modes with retries and failure states.
- Client-facing surfaces are rebuilt under the Sublime by goal 07; this goal owns the journey's correctness.

## The work, in slices

S1 The audit and the two drifts: switch the homepage enquiry to POST /public/enquiries, fix the slug namespaces test-first, then walk the whole journey on the local stack with three identities and write docs/reports/journey-audit-2026-09-NN.md: per step, works, half-works, missing, with screenshots. Recover the persona audit (docs/plan/09 exists only in 9c98b293 on an unmerged branch) or rewrite it from the walk.

S2 The visual enquiry: start from a room, an event type, a guest count and dates; a sketch the client makes becomes part of the enquiry; the staff result is a structured brief with a next action, source, owner and duplicate handling. Pain points 1 and 2.

S3 The pipeline as a calm field: enquiry inbox, opportunity stages, promises due, expiring holds, stalled enquiries, next action. Pain point 5.

S4 The living proposal: room, real layout, phases, package, inclusions, exclusions, options, price, assumptions; versions and curated variants; the client compares layouts, comments on an item, requests a change; PDF fallback. Pain point 3.

S5 The exact quote: lines, packages, upgrades, discounts, taxes, deposits, schedule; responds to plan changes without touching an accepted version; internal cost and margin separate from the client total. Pain point 4.

S6 Contract and deposit: document generation from versioned terms, signatory authority, signature and payment through the configured providers with retries, failure and refund paths, finance handoff.

S7 The client workspace: approved plans, decisions outstanding, timeline, guest count, documents, milestones; guest seating, dietary and access requests scoped to the relevant version. Pain point 8.

S8 Change impact: 150 to 180 guests, and dinner moved thirty minutes: affected seating, fit, inventory (goal 05 S7), staff, price, setup time, turnaround, approvals and client commitments, shown together; the old release preserved; the new one published on admin approval; unaffected outputs acquire no review work. Pain points 6 and 9.

S9 Release, the day, actuals, close-out: the release feeds goal 05; observed timings, issues and outcomes are recorded; the seed of Event Memory (goal 09). Pain point 10.

S10 The real event (plan 15 G7): rehearse with a multi-phase fixture, then operate a nominated event with Elaine and a hallkeeper, including a client change, a request, a shift handoff and a poor-connectivity scenario; log and fix every critical break; repeat on a second format and a room flip.

S11 Exports: the venue's records and assets leave in open formats on request. Pain point 12.

## Done when

A client and a coordinator complete S2 to S9 on staging without retyping anything. Each of the twelve pain points has a passing acceptance test or a recorded reason it waits. Accepted versions are immutable under test. The real event closes with matching released instructions, acknowledged changes, actual timings and recorded exceptions, and no critical wrong-version handoff. Pain point 11 is judged by goal 01's sublime test on every surface of the journey.

## Verify

```
pnpm --filter @omnitwin/api test -- --run
pnpm --filter @omnitwin/web test -- --run
pnpm --filter @omnitwin/web exec playwright test e2e/one-event-journey.spec.ts --workers 1
node packages/web/scripts/demo-smoke.mjs
```

## Forbidden

Another calendar, event model or count compiler. A new universal object. Holding client funds. Altering an accepted version. A broad role check as approval authority. A production change before a staging rehearsal. Production data outside the demo-week mandate without asking.

## Human inputs

HUMAN.md 1 (the event and the people), 2 (facts), 8 (who approves), 9 (terms), 10 (providers, later).

## Unlocks

Goal 07's surfaces have a working journey underneath; goal 09 gets dependable facts and actuals; goal 10's second venue has a loop to repeat.
