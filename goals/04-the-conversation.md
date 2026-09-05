# 04 · The conversation — direct messages and requests between admins, clients and hallkeepers

## The /goal block

Build direct messaging into Venviewer so venue admins, clients and hallkeepers talk inside the product: person-to-person conversations and threads attached to an event, a room or a timetable slot; a client request ("ten more chairs in the Grand Hall", refreshments, AV help, access, other) that carries its kind, quantity, room, slot and urgency, lands over the slot on the hallkeeper's timetable, is accepted by exactly one owner and resolved with an outcome. Audiences are exact and never widen: staff-private, client-facing, supplier-scoped. Exactly once through the existing command envelopes; states sent, delivered, read, acknowledged, accepted, resolved. A message never changes an approved event or commits stock; it can propose, and the proposal goes through the decision object (goal 09) and admin approval. Day Board S3, revised for three audiences. The surface is built under the Sublime.

## Outcome, in Blake's words

"we want venue admin staff to be able to communicate freely with clients planning rooms and with hallkeeper staff via a useful and easy to use direct message feature"; "notifications will appear over timetable slots if a client from that rooms needs help such as needs more chairs, more refreshments, audio/visual setup help or other something else".

## Where we are

Proposal comments exist (packages/api/src/routes/proposals.ts; the client page approves, requests changes and comments through a share token). The Diary has a live websocket channel; command envelopes (T-537) and REST idempotency (T-538) are in production. Day Board S1 and S2 shipped (T-556, T-557); S3 was planned as organiser-to-hallkeeper slot messaging only (docs/plan/hallkeeper-day-board-plan.md §4, exactly-once) and the Diary canon forbade chat; Blake's message supersedes both (plan 15 §1, plan 16, the authority map's amendment). Event-day issue and offline primitives exist (packages/api/src/routes/event-day-ops.ts). Email goes through Resend (eight templates). Five canonical roles in packages/types/src/user.ts; "executive" is branched on in four files but is not a role, so nothing is built on it. The canManageVenue helper includes staff and hallkeepers and therefore cannot be the approval gate (plan 16 §5).

## Decided

- Three audiences, fixed at thread creation and never widened: staff-private (admins and hallkeepers), client-facing (admins with the client; a hallkeeper joins a client only inside a request thread), supplier-scoped (later, goal 10). A client can never read a staff-private thread. Every client-facing thread carries a visible badge for staff so nobody types a private note into it.
- A request is a message of kind `request`: kind (chairs, tables, refreshments, av, access, other), quantity where it applies, room, booking or slot, urgency (routine, soon, now), owner, state. It is the only kind that appears on the timetable.
- States: sent, delivered, read (per recipient); for requests, acknowledged, accepted (exactly one owner), resolved (done, declined or substituted, with a note). A read receipt never means ownership.
- Transport is the existing websocket channel and command envelope; one idempotency key per send; reconnect replays; the hallkeeper surface queues offline (goal 05 S5). Retries create one logical message.
- Data: threads, messages, message_receipts and requests as Drizzle migrations; Zod in @omnitwin/types; routes with venue tenancy gates for staff and share-token gates for clients. Reconcile with the event-day issue primitives before adding a table: an issue and a request share one model if the fields say they do.
- A message never mutates an approved event, a booking time or stock. Anything consequential becomes a decision object (goal 09) that a venue admin approves; the message shows the decision's state.
- Notifications are in-product first; email after a venue-set silence; push later. Unowned requests escalate on the venue's window to the duty admin (HUMAN.md 8).
- Under the Sublime: a conversation is a quiet column at the edge of the room; a request is one slab on a slot. No chat bubbles, no avatars in circles, no unread badges shouting.

## The work, in slices

S1 Types, migrations and routes, test first: contract tests for every route; 401 without identity, 403 across venues and across audiences, 400 on malformed input; the idempotency key replayed returns the same message; the audience of a thread cannot be changed by any route.

S2 The staff thread drawer on the Diary's event drawer (packages/web/src/pages/diary/components/BookingDrawer.tsx) and the planner, and the client-facing thread on the client's plan and proposal pages, with the audience badge. Surface under goal 01's tokens; it may ship behind the `?house=sublime` flag before the brief is approved.

S3 The request: composed from the client's page with room and slot pre-filled and kind, quantity and urgency chosen in one gesture; lands on the Day Board slot (goal 05 S2) within one second over the websocket; accept and resolve from the slot.

S4 Notifications: in-product presence and unread; Resend email for a request unanswered after the venue's window; the escalation to the duty admin when unowned.

S5 The people matrix (HUMAN.md 8) drafted from current roles into docs/operations/people-matrix.md, wired as venue configuration, never as code constants.

S6 The hard cases as tests: wrong room, wrong venue, duplicate send, revoked share token, absent staff, reconnect mid-send, a hallkeeper trying to read a staff-private thread through the request, a message that tries to change a booking time.

## Done when

The sentence in Blake's words works end to end on the local stack with three signed-in identities (admin, hallkeeper, client) and then on a staging deployment: the request reaches the right people and the right slot, one person owns it, stock and approval implications are surfaced through the decision object, the client sees progress, the outcome is recorded. Exactly once under reconnect. Audiences are proved exact by tests. In the usability run a hallkeeper acknowledges a request within fifteen seconds. Nothing a message does changes an approved event.

## Verify

```
pnpm --filter @omnitwin/api test -- --run messaging
pnpm --filter @omnitwin/web test -- --run conversation
pnpm --filter @omnitwin/web exec playwright test e2e/conversation-three-identities.spec.ts --workers 1
```

The local stack: portable Postgres on 54329, the neon websocket bridge on 54331, the API on 3011 (never 3001), Vite on 5174 (the project_local_dev_stack memory).

## Forbidden

A generic chat widget. Widening a thread's audience. Building on the "executive" role. Email as the source of truth. A message that mutates an event, a time or stock. canManageVenue as the approval gate. Production before goal 06's staging rehearsal.

## Human inputs

HUMAN.md 8 (the people matrix).

## Unlocks

Goal 05 S2 (requests over slots); goal 06's client change requests; goal 09's decision object gets its first real inputs.
