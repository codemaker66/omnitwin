# 09 · The venue's mind — intelligence that prepares the decision; admins own the approval

## The /goal block

Give Venviewer intelligence that understands the venue and learns from its events, built on one decision object: a brief becomes editable layout alternatives with explained trade-offs and an honest no-fit; feasible offers and capacity envelopes replace one capacity number; every consequential change (a time, a guest count, a shortage, an unanswered request) arrives at the venue admin as a prepared decision with options, a recommendation, complete consequences and the exact mutations, executed only on approval through the authoritative command path; Truth Mode says what you are looking at and where it came from; Guest Flow Replay rehearses phases deterministically; Event Memory links actuals to templates. Then bounded, revocable delegation, then wider delegated operation as shadow runs and outcomes earn it (plan 16 §5). Permission and checks live in the application, never only in a prompt.

## Outcome, in Blake's words

Plan 16 §1: "Venue admins approve changes and times; intelligence does the decision preparation. It should work out feasible choices, recommend what to do and prepare the consequences, making the admin's work radically easier. Design the system so full delegated autonomy becomes possible." From the vision: "AI proposes; deterministic checks evaluate specified constraints; reviewers authorise consequential releases."

## Where we are

The Event Architect produces deterministic multi-candidate layouts for dinner rounds and theatre (/event-architect, packages/api/src/routes/event-architect.ts); an AI assistant route is review-gated (packages/api/src/routes/ai-assistant.ts); Event Mission Control exists (packages/api/src/routes/event-mission-control.ts); the egress library (packages/web/src/lib/egress.ts), capacity intelligence, the eleven cockpit lenses, evidence chips, the operational geometry schema (T-297) and the bar-queue zone authoring task (T-306, not started) are in place; Time Machine is on master. None of this is a configured production autonomous operator. The canManageVenue helper in packages/api/src/utils/query.ts includes staff and hallkeepers, so it cannot express admin approval (plan 16 §5). Language tasks use the Claude API through the claude-api skill with pinned model ids.

## Decided

- The decision object (plan 16 §5) is one model shared by goals 04, 05 and 06, built from the existing event, command and approval primitives: intended outcome; current event, booking and inventory versions; feasible options with the recommendation and intelligible reasons; costs, resource, timing, layout and task consequences; missing facts, unverified assumptions, conflicts, urgency and the minimum useful question; the exact proposed mutations, the approval authority required, the execution receipt and the compensation path.
- Approval is a narrow venue-scoped capability held by named admins (HUMAN.md 8). An admin's direct action expresses approval when the exact action and consequences are clear; there is no redundant second click for trivial edits. Draft exploration stays fluid; publishing a promise or a schedule follows the policy. A stale approval revalidates and returns the revised choice; it never executes.
- Hallkeeper completions and observations, client acceptance, payment and specialist review keep their own meanings and are never conflated with approval.
- AI proposes; deterministic checks evaluate; people authorise. Every venue fact an answer uses carries source, freshness and scope. Heatmaps mean the same at every zoom. Simulation is seeded and fixed-step; attractive crowd motion is never validated behaviour.
- The route to delegation has five steps: recommend, prepare, execute approval, delegate bounded operation (revocable scopes, time, resource and money limits, exception triggers), full delegated operation expanded by action class as shadow runs prove reliability. No achieved factor is claimed without a measured baseline of admin handling time, interruptions, rework and wrong decisions on matched tasks.

## The work, in slices

M1 The decision object: types in @omnitwin/types, storage, the narrow approval capability, the revalidate-on-stale rule, receipts; tests for scope (one approval never implies authority beyond it), stale approval, duplicate execution, partial failure, concurrent booking and stock changes, revocation and recovery.

M2 The first three decisions wired: a booking time moved thirty minutes (Diary drag and the planner's When ribbon), a guest-count change (goal 06 S8) and a stock shortage (goal 05 S7), each arriving as a prepared decision with consequences across bookings, turnaround, staff, catering and equipment.

M3 The unanswered service request (goal 04) as a decision with escalation.

M4 The brief to alternatives: the Event Architect's surface rebuilt under the Sublime, alternatives explained, the no-fit case with the smallest useful change, the reveal through goal 03's Grand Assembly.

M5 Feasible offers and capacity envelopes: "three dates for a 160-guest dinner with dancing and a separate arrival room" answered with compromises and outstanding checks, using goal 05's stock and goal 06's holds.

M6 Truth Mode, selection-aware: a table shows its catalogue and placement evidence, a route its geometry and assumptions, a splat its lineage, a heatmap its scenario, a proposal its approved version.

M7 Guest Flow Replay: the bar-queue scenario first (T-306), seeded, deterministic, with uncertainty across runs; phase rehearsal; the Counterfactual Rehearsal Lab's first questions.

M8 Event Memory from goal 06's actuals: "when did a dinner like this last work", with source-linked lessons and proposed template updates that never change a rule silently.

M9 Bounded delegation: the admin grants revocable scopes (HUMAN.md 16); shadow runs on real decisions first; the register of action classes with reliability evidence; expansion one class at a time.

## Done when

A date change, a guest-count change, a stock shortage and an unanswered request each run from suggestion through approval, execution and current instructions on staging, and the hard cases pass: no feasible option, contradictory facts, concurrent changes, permissions, stale approval, duplicate execution, partial failure, revocation, recovery. A real brief (HUMAN.md 13) yields alternatives Elaine finds useful with a no-fit case. Scenarios replay bit-identically by seed. Every recommendation cites the venue's evidence. The admin-effort baseline is measured before any improvement factor is stated.

## Verify

```
pnpm --filter @omnitwin/api test -- --run decision
pnpm --filter @omnitwin/api test -- --run event-architect
pnpm --filter @omnitwin/web test -- --run flow-replay
pnpm --filter @omnitwin/web exec playwright test e2e/decision-approval.spec.ts --workers 1
```

## Forbidden

A language model changing a booking, a price, staff or stock. canManageVenue as approval. An unsourced venue fact in an answer. Crowd motion sold as behaviour. A delegation without a revocation path. An improvement factor without a baseline.

## Human inputs

HUMAN.md 8 (who holds approval), 13 (three hard briefs and the rules), 16 (delegation limits, later).

## Unlocks

Goal 10's second venue runs on policy, not on code; the vision's authority-aware agent becomes reachable.
