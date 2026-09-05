# 05 · The hallkeeper's day — the timetable, the pulse, the generated sheet, the inventory

## The /goal block

Give hallkeepers a next-generation day under the Sublime: the timetable as one line of light across a dark field, every slot's state legible at a glance, slots pulsing gently by the severity of the attention they need and quieting when acknowledged, client requests appearing over their slots, and a hallkeeper sheet generated automatically for every event from its released layout: exact chairs by type, tables by type, projectors, TVs, screens, lecterns and accessories, timings, contacts, and what changed since the last release, identified by its release, readable on a phone or a wall display, printable, working offline. Venue admins edit their own inventory numbers in the product, with shortages surfaced and history kept. Day Board S4 and S5, the sheet, and the inventory, rebuilt under goal 01.

## Outcome, in Blake's words

"we want a next-gen timetable for hallkeepers so at a glance they will see what they need to do that day, things will gently pulse different colours depending on severity of attention needed, notifications will appear over timetable slots if a client from that rooms needs help such as needs more chairs, more refreshments, audio/visual setup help or other something else. hallkeeper sheets for each event will also be auto generated so they will know exactly what needs to go into each room how many chairs, tables of what kind, projectors, tvs etc." Plan 16 §1: "Venue admins can alter their inventory numbers in the product."

## Where we are

/hallkeeper/today is the Day Board S1, read-only (T-556, packages/web/src/pages/hallkeeper/DayBoardPage.tsx); S2 the When ribbon (T-557). The law: times exist only through Diary bookings; everything on the board is a calendar projection; a phase-locked epoch drives spring motion; the slot state machine and motion laws are in docs/plan/hallkeeper-day-board-plan.md §3. The hallkeeper sheet schema has five setup phases, dietary, accessibility and a door schedule; the PDF is server-side pdfkit at /hallkeeper/:configId; the Ops Compiler (packages/api/src/services/ops-compiler.ts) compiles from released snapshots. Turnaround rules ride on GET /calendar. The catalogue is a shared static list (packages/types/src/asset-catalogue.ts) and a per-scene quantity check (packages/web/src/lib/catalogue.ts); asset_definitions is a global visual catalogue; there is no venue stock record and no time-window reservation accounting (plan 16 §3). The demo week is seeded in production with fifteen bookings and one linked wedding.

## Decided

- The day is one line: a horizontal band of light for the current time crossing a dark field; slots as warm slabs on room lanes; this hallkeeper's next action in one line at the top, always. Room, state, time and next action in under one second (the Hallkeeper Test).
- Severity has four levels, each an icon, a verb and a colour, never colour alone: calm (no motion); attention (a slow four-second breath in the room's gold); soon (a two-second breath in amber); now (a one-second breath in oxblood with the label). A pulse exists only for a state a person can act on and quiets on acknowledgement while the unresolved work stays as a steady slab. Reduced motion: steady indicators. No constant pulsing (plan 16 §2).
- The sheet is compiled, never typed: from the released snapshot through the Ops Compiler, with catalogue identity (chair type, table type, projector, TV, screen, lectern, microphone, accessory), per-phase counts, phase timings from the booking, contacts, and the diff from the previous release. It names its release on screen and on paper; a superseded sheet is watermarked as old wherever it appears. The phone view and the print agree by test.
- Inventory is venue stock linked to item definitions (plan 16 §3): owned quantity, adjustments with actor, before, after, reason, effective time and version; unavailable and damaged units; hired-in quantities with validity windows; storage location; active or retired. Total, usable, reserved and remaining are four distinct numbers for a selected period; setup, movement, live use and breakdown all occupy the resource. A true correction is recorded even when it creates a shortage; the count is never clamped to promised demand. A stock change never rewrites yesterday's sheet; it opens a decision (goal 09) for future instructions. Hallkeepers report condition; admins adjust.
- Actual observations (doors open, set, live, flipping, done, cleaned) are distinct from scheduled times and never overwrite them.
- Offline: the day's board and sheets cached; actions queue with authorship and reconcile without overwriting another's update; the stale-release warning survives disconnection.
- Surfaces rebuilt under goal 01: /hallkeeper/today, /hallkeeper/:configId, a wall-display mode, the print sheet, and the admin's inventory page.

## The work, in slices

S1 The keystone (goal 01 slice 4c, on a branch behind `?house=sublime`): the board as one line of light, slots, the four severities and their quieting, reduced motion, the fixtures populated, dense, empty, offline and stale. Screenshots and the sublime test.

S2 Requests over slots: goal 04 S3 lands here; accept and resolve from the slot; the chime opt-in.

S3 Ops states (Day Board S4): doors-open, set, live, flipping, done, cleaned as observations; overrun and turnaround-at-risk exceptions; nothing changes a scheduled time.

S4 The sheet with equipment: extend the catalogue identity and the Ops Compiler for projectors, TVs, screens, lecterns, microphones and accessories; per-phase counts; the release id; the diff; the PDF and the phone view proved identical by a test on the demo-week wedding.

S5 The kiosk (Day Board S5): rollover at the venue's day boundary, the chime, the offline queue, a 60 fps proof on the wall display and the phone fixtures, the print link.

S6 The usability run (HUMAN.md 1): five people across roles; next action found in five seconds, a request acknowledged in fifteen; report n and failures, never a population claim.

S7 Admin-editable inventory (plan 16 §3): the stock record, adjustments and history, hired-in windows, storage, retired items; the four numbers per period; shortage detection listing affected events with remedies through the decision object; tests for zero stock, negative counts, simultaneous adjustments, duplicate delivery, foreign-venue access, overlapping and non-overlapping windows, damage and return corrections, hired-in expiry, revoked approvals and already-printed sheets. The acceptance example: 200 owned, 190 reserved over overlapping windows, 20 recorded damaged, usable 180, a ten-chair deficit visible with feasible remedies, the admin's chosen remedy becoming an approved release that updates picks and tasks, and no silent new promise.

## Done when

A hallkeeper runs a demo-week shift from a phone and the wall display. Every slot's severity is legible in a crowded day and under reduced motion. The sheet for the linked wedding lists exact counts by type and its release id matches print. Offline actions reconcile without loss. An admin corrects stock and sees the shortage and its remedies without an engineer. The usability targets are met and reported with n.

## Verify

```
pnpm --filter @omnitwin/web test -- --run hallkeeper
pnpm --filter @omnitwin/api test -- --run ops-compiler
pnpm --filter @omnitwin/api test -- --run inventory
pnpm --filter @omnitwin/web visual-check
node packages/web/scripts/splat-drag-budget.mjs --route /hallkeeper/today
```

## Forbidden

A second clock. A time set anywhere but the booking. A typed sheet. A pulse that never quiets. Colour carrying meaning alone. A card wall. Clamping stock to demand. Rewriting a released sheet in place. Per-venue forks of the visual catalogue.

## Human inputs

HUMAN.md 1 (the event and the people), 2 (the inventory and a current BEO or day sheet), 6 (the room tone), 8 (the people matrix).

## Unlocks

Goal 06 S8 (change impact needs stock), goal 07's supplier and print outputs, goal 09's shortage decisions.
