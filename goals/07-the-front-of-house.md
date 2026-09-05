# 07 · The front of house — every client-facing surface rebuilt under the Sublime

## The /goal block

Rebuild every client-facing surface under the Sublime (goals/01): the public site (the home, the eight room pages, the walk, the tour), the visual enquiry, the living proposal and the client workspace. The real room is the hero and resolves from its coarse level; one light, one accent measured from the room; no generated image ever poses as a photograph; no enquiry dead-ends; Core Web Vitals measured at the 75th percentile on production; the sublime test on every surface. The old landings (the Rite at /landing, /fresh, /living-hall, /welcome, /tour) are retired behind redirects once the new home passes.

## Outcome, in Blake's words

"a spectacularly beautiful venue planning platform that will make everyone's live easier from the venue booker, the venue admin team, the venue hallkeepers, guests, clients, everybody"; "make it look as many years ahead as possible as our competitors".

## Where we are

`/` serves RoomsHomePage; /fresh is a footer-linked sibling; /landing is the Rite (July); /living-hall draws the Reception Room (five tiles since T-580); /welcome and /tour exist; /tour and Enquire are dead ends on the Monday fix list. The 2026-07-02 critique of live venviewer.com scored it 6.5/10 with three P0s: the enquiry dead-end (no form, email or phone at #contact), capacities contradicting the venue's published numbers, no og:image. The homepage enquiry is a mailto while POST /public/enquiries works. The two flagship slugs. The proposal pages exist at /proposal/:shareCode and /proposal-share/:token; the supplier share at /supplier-share/:token. The route inventory is in packages/web/src/router.tsx (CRLF; patch with line-ending-safe anchors).

## Decided

- One public route family; every retired route redirects; no deep link, work or client is stranded (plan 16 §2).
- The hero is the captured Grand Hall resolving from its coarsest level through the ladder, never a video and never a generated image; first view within goal 02's gate.
- Capacities come from the venue's verified facts (HUMAN.md 2) and are worded as capacity envelopes by layout, never one number.
- The enquiry is goal 06 S2's structured visual enquiry; the proposal is goal 06 S4's surface; the workspace is goal 06 S7's surface. This goal owns their presentation; goal 06 owns their correctness.
- Web vitals at p75, split by device class: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, measured alongside the 3D canvas, not instead of it.
- Each room page carries its own measured palette (goal 01 §3), so the Saloon is not dressed like the Grand Hall.
- og:image and every social image are real renders from the court's poses.

## The work, in slices

S1 The home: the hall resolves; the room's name in Canela; one line; one action (enquire or walk). Behind the flag until goal 01 is approved, then live on Tuesday or later.

S2 The eight room pages: the room resolving, its facts, its layouts as capacity envelopes, its own palette, the walk one gesture away.

S3 The walk's chrome (goal 01 slice 4a) on every room.

S4 The enquiry surface over goal 06 S2: start from the room you are looking at; the sketch travels; the confirmation is warm and names the coordinator.

S5 The living proposal surface over goal 06 S4: ivory, one photograph, the layouts to compare, the item comments, the decision to make.

S6 The client workspace surface over goal 06 S7.

S7 Retire /landing, /fresh, /living-hall, /welcome and the old /tour behind redirects; delete their code and tests only after the redirects are live and the smoke passes.

S8 The report: web vitals at p75 from production, the critique's P0s closed, og:image live, the sublime test per surface, in docs/reports/front-of-house-2026-NN-NN.md.

## Done when

The sublime test passes on every client-facing surface. Web vitals meet the p75 thresholds on production for desktop and phone. The three P0s from the July critique are closed. Elaine's client goes from the home to a sent enquiry in under two minutes without a dead end, on a phone. Every retired route redirects.

## Verify

```
pnpm --filter @omnitwin/web visual-check
node packages/web/scripts/demo-smoke.mjs
pnpm --filter @omnitwin/web exec playwright test e2e/front-of-house-vitals.spec.ts --workers 1
```

## Forbidden

An AI "after" photograph of Trades Hall. A video hero. A second accent. Retiring a route before its redirect exists. A capacity stated as one number. Copy that claims what the venue has not verified.

## Human inputs

HUMAN.md 2 (verified capacities), 4 (optional taste).

## Unlocks

Goal 10's second venue gets a configurable public site rather than a Trades Hall fork.
