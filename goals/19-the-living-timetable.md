# 19 · The living timetable — plan the room, set the when, and the house sees it live

Written Thursday 8 October 2026 by the Fable 5.1 session at Blake's request: "can you create a plan for this and think of every component i may have missed that is neccessary to make it truly real world ready, then write a ./goal for me to give to you in the following prompts". Task **T-651** (written as T-646; that id was already allocated on origin/master to the Startups application, so S0 re-numbered it). Status: active since 8 October 2026, when Blake pasted the block below. Written against origin/master `5eec476e`; re-verified at S0 against `01a779b8`, see "Re-verified at S0" under "Where we are".

## The /goal block

```text
/goal Read goals/19-the-living-timetable.md and deliver it end to end under AGENTS.md and .claude/conventions/shipping-changes.md. Work in an isolated worktree cut from origin/master, never in the shared checkout (it is dirty and hundreds of commits behind). Take the slices in order; each is shippable on its own and none is done until it is verified on production with the three identities. Keep the law of time, the exact audiences and the office-approval rule: nothing a message or request does may change an approved event, a booking time, a layout or stock. Record local, committed, merged, deployed and accepted as different states in goals/EXECUTION.md, docs/state/tasks.md (T-646) and the day's session log. Ask Blake only for the human inputs at the end of this file; everything else is decided here.
```

## Outcome, in Blake's words

"we use our visual viewer to plan our venue room, place the furniture etc but that we can also set the time it will happen, eg, grand hall occupied 12-4pm, we want a really fun and awesome and easy way to set that. the timing info gets sent to a real time updateable timetable for the hallkeepers, it will be colour coded ... event organisers due to start arriving in 1h, a slow pulsing green... guests due to start arriving in 30 minutes, a slow pulsing orange... event in progress a slow pulsing red... we want venue organisers also to be able to tap a timetable slot and send a direct message to hallkeepers regarding it, and it will show a notifaction on that timetable slot that the hallkeeper's can reply to in realtime ... making it as beautiful as possible while also slick and so easy to use, a genuine pleasure with how easy and clear it is, and it must be super polished with no lag at all."

From the same brief: "the venue staff will be able to respond in realtime to the request of when the clients would want their room to be made to this specification and the venue admins will be able to easily allocate it into their timetable with automatic price calculations set and the live timetable that is shared automatically to the hallkeeper's will also be set."

## What this goal absorbs, so nothing has two owners

- Goal 04 (the conversation), all six slices.
- Goal 05 S1 (the board), S2 (requests over slots), S3 (ops states) and S5 (the kiosk). Goal 05 S4 (equipment on the sheet), S6 (the usability run, which this goal also needs) and S7 (inventory) stay in goal 05.
- The Day Board plan's S3 to S5 (docs/plan/hallkeeper-day-board-plan.md) and the Command Centre's C3 to C5.
- The Friday programme's Release 2 communication packages F-04, F-05, F-06 and F-08 (docs/plan/18-FRIDAY-LAUNCH-2026-09-18.md).
- Goal 03's When ribbon is extended here (S6); the rest of goal 03 is untouched.

Not here: the visual quality of the captured room (T-632, goal 13), the cinematic Grand Assembly (goal 03), the inventory record (goal 05 S7, on unmerged codex branches) and supplier or caterer audiences (goal 10). Blake's request in the same message that the viewer for every room follow a billion-dollar company's best practice is goal 03 and goal 13 work. This goal touches the planner only to set the when and send it to the house.

## Where we are (inspected 8 October 2026; nothing here is a demonstrated journey unless it says so)

- **The law holds.** Times exist only as Diary bookings. The Day Board (`/hallkeeper/today`, T-556) is a pure projection of `GET /calendar` plus one clock: `packages/web/src/pages/hallkeeper/DayBoardPage.tsx` and `lib/day-board-state.ts`. Its state machine already has scheduled, organisers-due, guests-due, imminent, in-progress, done and exception; phase-locked CSS pulses on transform and opacity; a 30-second tick; reduced-motion fixtures. Two of its three exceptions (overrun, urgent-message) are typed but can never fire: there is no done signal and no message. The board is in production and still wears the S1 look, not the selected style.
- **The When ribbon shipped** (T-557): `packages/web/src/components/editor/cockpit/WhenRibbon.tsx` and `when-ribbon-model.ts`. A draggable ingot with 15-minute snap, ink ghosts with hard exclusions, turnaround buffers from the venue's rules, written through `updateBooking`. It is honest and quiet. It is not yet fun, has no phases, no typed entry and no price, and a client cannot use it to propose.
- **Exactly-once exists.** Diary mutations travel as command envelopes over `/ws/diary` through the `diary_commands` ledger (T-537) and carry the same identity over REST in `Idempotency-Key` (T-538). The hub (`packages/api/src/ws/diary-live.ts`) is venue-scoped, carries presence deduped per user, heartbeats and broadcasts `diary.event`; the client hook (`pages/diary/hooks/useDiaryLive.ts`) backs off and refetches a snapshot on every reconnect. The hello message carries no server time. Only staff, admin and hallkeeper may join; a client cannot.
- **The booking knows its plan** (T-539): `bookings.eventId` and `/plan?eventId=…`.
- **Event-day ops exist**: `event_day_issues` (status open, in_progress, resolved, closed; severity info, attention, urgent; source hallkeeper, staff, system; reportedBy, assignedTo), ops tasks, a rota and an offline queue (`packages/web/src/lib/event-day-offline-queue.ts`) that already replays issue creates and task status changes.
- **There is no messaging model**: no threads, messages, receipts or requests anywhere in the schema (plan 18 §1 found the same). Proposal comments exist behind a share token. Email goes through Resend (`services/email.ts`, `email-templates.tsx`); `event_plan_notifications` and `email_sends` exist. No PWA manifest, no service worker, no push.
- **Roles**: `client, planner, staff, hallkeeper, admin` in `packages/types/src/user.ts`. `canWriteBookings` is staff and admin; `canManageVenue` includes hallkeepers and is read scope, never an approval gate. Goal 15 settled that professions map to scoped capabilities, not new global roles.
- **Sheets**: the Ops Compiler compiles approved frozen snapshots; the approved sheet and its PDF are live (T-633).
- **Register**: Blake selected the ivory, forest green, pale copper and sage direction on 6 September (`.claude/conventions/product-experience.md`); the dark "line of light" prescriptions in goals 01, 04 and 05 are proposals he did not approve. His timetable reference (`D:\downloads folder\venuebookingconceptimage9+.png`, the Devonshire House command centre; also `docs/plan/reference/day-board/command-centre-week-board.png`) is dark leather and brass: room photographs on the lanes, a NOW plaque, dimensioned gaps, annotations and an UNPLACED rail. The three-identity usability run (HUMAN.md 1) and the people matrix (HUMAN.md 8) have not happened; `docs/operations/people-matrix.md` does not exist.
- **Repository**: origin/master `5eec476e`; migrations on origin run to `0085_proposal_templates.sql`; the shared checkout `C:\Users\blake\omnitwin2` is 831 commits behind and dirty across lanes. Vercel publishes every master push; Railway rebuilds the API from master pushes touching `packages/api` or `packages/types`; migrations are applied by hand, first. T-601 coordinates releases.

### Re-verified at S0 (8 October 2026, origin/master `01a779b8`)

- **A staff requests model already exists.** Ship Friday slice 10 (T-623) shipped migration `0077_requests.sql` (`venue_settings`, `requests`, `request_status_history`), `packages/api/src/services/requests.ts` and `routes/requests.ts`, `@omnitwin/types` `requests.ts`, the slab `packages/web/src/components/requests/SlotRequests.tsx` with its provider on the Day Board route, `request.changed` and `notification.event` frames on `/ws/diary` from a listen-only connection (`lib/requests-live.ts`), and a 15-second escalation sweep for unanswered "now" requests after `venue_settings.request_escalation_seconds` (180 s in production). Kinds: refreshments, temperature, cleaning, av, access, other. States: sent, acknowledged, accepted, resolved; outcomes done, not_possible, no_longer_needed. The audience is fixed at creation; the unique index is the idempotency guard; the ladder is applied in the UPDATE's own WHERE. Only staff (`canManageVenue`) may raise one; a client cannot. There are no threads, messages or receipts, no `serverNowMs`, no cursors, no push.
- **D4 is revised accordingly:** a request is a `requests` row extended (not `event_day_issues`): `kind` gains chairs, tables and setup; `requestedByRole` admits client; `threadId` links the client-facing thread; states gain underway, reopened, escalated and handed-over. The shipped vocabulary and its tests are kept.
- **The board** still shows claret LIVE with red reserved for exceptions (`day-board-state.ts`); D3 keeps Blake's spoken palette and names the token.
- **Migrations:** origin's journal ends at `0085_proposal_templates` (idx 83); the first migration here is `0086` (idx 84). Renumbered on 9 October 2026 to `0087_living_timetable_conversations` (idx 85) when PR #58 merged `0086_venue_location` first.
- **Roles** now include manager, sales and caterer (`USER_ROLES`); `DIARY_WRITE_ROLES` is staff, admin, manager, sales. D2's rows apply to these as the people matrix records.

## The system in one breath

A client plans the room and says when on the ribbon; that writes a **hold** on the Diary ladder with the plan linked. The office sees the hold, the price follows the window, and inking it is the approval. The Day Board is nothing but the inked calendar seen through one corrected clock, so the hallkeepers' timetable is set the moment the office inks. A tap on a slot opens the slot's **conversation**. A client's "we need ten more chairs" is a **request**: an event-day issue with a client-facing thread that lands on the slot within a second, is owned by exactly one person and is resolved with an outcome. Nothing said in a thread changes a time, a layout or stock; anything consequential becomes a decision the office approves. When no screen is watching, the house is told another way.

## Decided

### D1 The law of time

Unchanged, and extended to phases. A booking carries setup, doors, live and clear-down as phase entries (the calendar already returns phases); the ribbon edits them; the board derives every state from them and the venue's turnaround rules. Nothing on the board or in a message ever writes a time. Observed times (doors opened, set, live, flipping, done, cleaned) are separate facts that never overwrite scheduled ones.

### D2 Who may do what (capabilities, not new roles)

| Action | Who | Where enforced |
|---|---|---|
| Propose a window: create or move a hold linked to a plan | client with a live event link; planner; staff; admin | `canProposeWindow` in the booking core, hold rank only |
| Ink, move or resize ink: the approval of a time | staff, admin (the office) | `canWriteBookings` as today; hallkeepers never |
| Read the board | staff, admin, hallkeeper | `DIARY_READ_ROLES` as today |
| Raise a request | client on their own event; planner; staff; admin; hallkeeper | `canRaiseRequest`, scoped to the event link or the venue |
| Acknowledge, accept, hand over, resolve a request | hallkeeper, staff, admin | `canHandleRequests` |
| Read or write a staff-private thread | staff, admin, hallkeeper of that venue | the audience check on every read, write, subscribe and replay |
| Read or write a client-facing thread | the event's client; staff; admin; a hallkeeper only through the request that opened it | the same check |
| Approve a consequential change: quantity beyond the release, a time, a price | admin, or staff where the venue's matrix says so | the decision object (goal 09's first real input); never `canManageVenue` |

The new capabilities live in `packages/api/src/utils/query.ts` beside the existing helpers, the plan 18 Lane 8 shape. No `executive`, no enum per profession.

### D3 Colour and motion: the attention system

Blake's words are kept literally for the ramp: green, then orange, then red. Severity rides on cadence and a copper ring, never on colour alone. Every state pairs an icon, a verb and a colour; reduced motion keeps the words and loses only the motion.

| State | Trigger (venue-local, corrected clock) | Colour | Motion | Reduced motion | Sound (opt-in) |
|---|---|---|---|---|---|
| Scheduled | more than 60 min before setup opens | ink on the lane, forest hairline | none | — | — |
| Organisers due | setup opens within 60 min | forest green | 4 s breath on the dot | "Organisers · 48 min", steady | — |
| Guests due | doors within 30 min | amber | 3 s breath | "Guests · 22 min" | — |
| Imminent | doors within 10 min | deep amber | 2 s breath | "Doors · 6 min" | — |
| Live | start ≤ now < end | oxblood red, LIVE | 4 s breath at low amplitude (≤ 12 % luminance): the room's heartbeat, and the proof the display is alive | "LIVE · 1 h 12 elapsed" | — |
| Clear-down | end to next setup, within the turnaround | sage, hatched | none | — | — |
| Done | marked done by a hallkeeper | faded ink | none | — | — |
| Attention | a request landed and nobody owns it | copper ring on the slab, with a count | one 200 ms arrival, then a 4 s ring breath until acknowledged | steady ring and count | one chime |
| Urgent | an urgent request unacknowledged; an overrun; a changeover at risk | copper ring, oxblood label | 1.5 s pulse until acknowledged | steady ring and "URGENT" | one chime |
| Owned | accepted | copper ring steady, the owner's name | none | — | — |
| Offline or stale | socket down more than 60 s, or data older than 2 min | slate band across the top; every breath stops | none | — | — |

Laws. All cadences (4, 3, 2, 1.5 s) are phase-locked to one 60-second epoch set once per mount, as today. Animation is CSS on transform and opacity only; no React render per frame. State ticks are boundary-exact: the next transition is scheduled to the millisecond, not polled every 30 s. A pulse exists only for a state a person can act on and quiets on acknowledgement while the unresolved work stays as a steady slab. Nothing ever strobes; the fastest cadence is 0.67 Hz, far under the three-flashes threshold. The live breath is the one ambient motion in the product because it doubles as the liveness signal, and it stops the instant the connection does. The earlier plan's "red only for exceptions" divergence is withdrawn in favour of Blake's spoken palette; the single token that would change it is named in the CSS.

### D4 Requests are event-day issues; conversations are new

A request is an `event_day_issues` row extended, not a new table: `kind` (chairs, tables, refreshments, av, access, setup, other), `quantity`, `bookingId`, `spaceId`, `urgency` (routine, soon, now), `source` gains `client`, `ownerUserId` is the exactly-one owner (distinct from `assignedTo`), `threadId`. The hallkeeper's existing issue list, rota and offline queue therefore show and replay requests with no second model. States: queued (client only) → sent → acknowledged → accepted → underway → resolved (done, declined or substituted, with a note), plus reopened, escalated and handed-over (needs the next person's acceptance; responsibility persists until then). Reading is never owning.

Conversations are three new tables: `threads` (venueId; audience fixed at creation; subject: booking, event, request or person), `messages` (threadId; authorUserId, or authorLinkId for a client; body ≤ 2,000 characters; kind text, request or system), `message_receipts` (messageId, recipient, deliveredAt, readAt, acknowledgedAt). Zod schemas in `@omnitwin/types`; migrations numbered after origin's journal at integration (0086 or later; never guessed). Audience can never change by any route; broadening means a new thread.

### D5 Transport

Staff: the existing `/ws/diary` hub gains `conversation.command` (`message.send`, `request.create`, `request.acknowledge`, `request.accept`, `request.handover`, `request.resolve`, `observation.record`) through the same `diary_commands` ledger and `Idempotency-Key` REST fallback, with the replay-authorisation lesson applied: re-check the recorded venue and audience before any replay. Server events: `conversation.event` with a monotonic `cursor`; clients reconnect from their last cursor, replay, then refetch the snapshot. Every `hello` and every event carries `serverNowMs`.

Clients (event-link identity): REST with `Idempotency-Key`, plus `GET /events/:id/conversation?after=<cursor>` polled every 5 s while the page is visible, upgraded to a token-authenticated `/ws/event` channel in S7 if the measured experience needs it. Realtime for a client means seeing "Elaine has this" within five seconds; for the house it means one second.

One API replica: the hub is in-process. The Redis backplane remains the documented gate before a second replica; nothing in this goal adds it.

### D6 Audiences

Fixed at thread creation, never widened. Staff-private: staff, admin, hallkeeper. Client-facing: the client, staff, admin; a hallkeeper only inside the request that opened it. Every client-facing composer shows a copper "Client can read this" badge so nobody types a private note into it. A revoked event link closes the client's reads and writes the same instant (goal 15's revocation contract, tested here too). Supplier-scoped waits for goal 10 and is not drawn as a decorative option.

### D7 Register and composition

Office and phone surfaces use the selected ivory, forest, copper and sage register. The **wall display** uses the dark drawing-sheet register of Blake's reference, because it hangs in a back-of-house corridor and is read from across a room at night; it is the one surface outside the 3D viewport allowed dark graphite. Human input 1 confirms or overrules this. Kept from the reference: room lanes with their photograph and capacity; a NOW plaque on the ruler; slabs with setup, live and clear-down segments; dimensioned gaps for turnarounds; marginal annotations; and the UNPLACED rail re-purposed as the **UNOWNED rail**, the requests nobody has taken, at the right edge. Dropped: brass-pinned skeuomorphic hardware on every slab, and the invented numbers. This hallkeeper's next action is one line at the top, always. Phone: one lane at a time, swipe between rooms, the next-action line fixed above. The Hallkeeper Test (room, state, time and next action in under one second) is timed with a person.

### D8 Beyond the glass

Presence tells the truth. The office sees "Wall display live · Elaine's phone live" (the hub already dedupes presence per user) and, when nothing is watching, "No hallkeeper screen is on; escalating in 5 min". Unowned requests escalate to the duty admin after the venue's window (defaults: now 2 min, soon 5 min, routine 15 min), then by Resend email outside quiet hours (default 22:00 to 07:00; in-product never sleeps). Web push (VAPID, a PWA manifest and service worker, a subscription per device) for three events only: a request landed for you, a request escalated to you, a reply to your request. iPhone push needs the installed PWA; the goal documents the install. No SMS, no Slack, no third-party chat.

### D9 The clock

One corrected clock. The client keeps the median of the last five `serverNowMs − receivedAt` offsets and derives every state from corrected time. A kiosk whose own clock is more than 60 s out shows "Clock corrected" in the status strip. Venue time is Europe/London through `board-time.ts`; the two DST Sundays (29 March and 25 October 2026), cross-midnight events and multi-day installs (the North Gallery kind) are fixtures. An event spanning rooms renders one slot per lane with a linked badge.

### D10 Kiosk and phone realities

Session refresh before Clerk token expiry so the wall never dies overnight; day rollover at the venue's boundary (04:00 default); auto-reconnect with the stale band; Wake Lock while mounted; a one-pixel-per-minute drift of the whole composition against burn-in; the offline queue for acknowledge, accept, reply and observations with authorship and reconcile-without-overwrite; the issued release id on every slab and the stale-release watermark surviving disconnection; a print link to the day sheet and to each slot's approved PDF for the hour the screen fails; iPad Guided Access documented.

### D11 Privacy, audit, retention

Wall mode shows room, event title, state, time and next action; guest names, dietary and access notes never (venue configurable, conservative default). Every message, request transition and observation is in the ledger with actor and time; the action-log pattern applies. Messages are venue records: retained 12 months, then pruned by the existing cleanup workflow; a client's messages are included in their data export and deletion. Body ≤ 2,000 characters; attachments are out of scope and no paperclip is drawn; rate limit per identity; the claim-safe lexicon throughout.

### D12 Performance

No lag means numbers. Request commit to painted ring on every connected staff screen ≤ 1,000 ms p95 on the local stack and ≤ 1,500 ms on production, measured by timestamps in the e2e, never felt. Board render ≤ 400 ms after data. A state tick ≤ 2 ms on the main thread. Zero React re-renders per animation frame. Frame-interval p95 ≤ 16.7 ms on the wall display and the phone fixtures with a dense day (eight lanes, thirty slots, twelve open requests), measured with `packages/web/scripts/splat-drag-budget.mjs --route /hallkeeper/today`, and labelled "emulated" until a physical device is measured (HUMAN.md 3). Calendar refetches carry ETags and bursts are coalesced within 250 ms.

## What the brief missed: the real-world list

Each item names the slice that carries it.

1. Setup is not start: organisers due keys off the setup phase, which the ribbon now sets (S3, S6).
2. Without a done signal there is no overrun; without doors-open there is no "guests arrived". Observations are first-class and never edit the schedule (S5).
3. Only one person may own a request; two simultaneous accepts resolve in the database, and the loser is told who has it (S1, S4).
4. A read receipt is not ownership; "seen by" and "owned by" are different words on the slab (S4).
5. Nobody watching: presence, escalation to a named duty admin, email after the window, push to a pocket (S7, S8).
6. The people matrix (who gets chairs, who gets AV, who covers, how long before escalation, who approves) is venue configuration, drafted now with defaults, corrected by Blake, never constants (S0, S7).
7. The client proposes and the office approves: a client's ribbon writes a hold; inking is the approval; the price follows the window from the existing pricing rules (S6).
8. The timetable is the office's allocation surface too: approving a time and releasing a layout are the two acts the Diary and the sheet already have; this goal connects them so the board, the sheet and the client show the same release id (S6, S9).
9. Audiences are exact; a private note never reaches a client; revocation is instant (S1, S4).
10. Shift handover: an outgoing hallkeeper's open requests pass to a named person who accepts; absent relief escalates and never silently extends a shift (S7).
11. Multi-room events, cross-midnight, DST and multi-day installs (S3).
12. The clock itself: kiosks drift (S2, S3).
13. The display dies: print fallbacks, the stale band, the breathing dot as the liveness signal (S8).
14. Overnight: token refresh, rollover, wake lock, burn-in (S8).
15. Offline on the floor: queued taps with authorship and reconcile (S8).
16. Sound: a chime that is opt-in, once, from the building's own room tone when it arrives and a plain bell until then; audio off loses nothing (S4).
17. Accessibility: colour plus icon plus verb; 44 px targets; `aria-live` polite for arrivals and assertive for urgent; keyboard and screen-reader fixtures (S3, S4).
18. Privacy on a wall that guests might see (S3, D11).
19. Audit, retention, export and deletion for messages (S1, D11).
20. Abuse: size, rate, revoked tokens, cross-venue and cross-audience attempts, all as tests (S1).
21. Honest realtime: the sender sees sent, delivered, seen and owned; never a fabricated tick (S4).
22. Production reality: no staging exists; a Vercel preview with a disposable Neon branch is the rehearsal; migrations before the API; the serial release lane; test ink titled "VENVIEWER TEST — delete" (S9).
23. Observability: connection counts and the landed-within-a-second measure are logged so a slow day is seen, not reported (S2, S9).
24. One replica: documented, not solved (D5).
25. Stock is not here: a chairs request beyond the release shows the shortage only when goal 05 S7 lands; until then it shows the request and the released count honestly (S4).

## The work, in slices

Each slice: a worktree from origin/master, contract tests first, independent review, merge through T-601's lane, deploy, live check, record. A slice is not done at "merged".

**S0 Ground (half a day).** Record T-646 ownership in `goals/EXECUTION.md`; cut the worktree; draft `docs/operations/people-matrix.md` from current roles with the D8 defaults for Blake to correct; write the D3 table into `docs/design/living-timetable/attention-system.md` with the exact tokens; confirm the migration numbers against origin's journal.

**S1 Contracts (two days).** Types, migrations, routes and command kinds for D4 and D2, test first: 401 without identity; 403 across venues, across audiences, for a hallkeeper reading a staff-private thread through a request, and for a revoked event link; 400 on malformed input; the same `Idempotency-Key` replayed returns the same message; a thread's audience cannot be changed by any route; two concurrent accepts against real PostgreSQL yield one owner and one `REQUEST_TAKEN` naming the owner; a message that tries to carry a time or stock change is rejected at the schema.
Verify: `pnpm --filter @omnitwin/types test`; `pnpm --filter @omnitwin/api exec vitest run src/__tests__/conversation*.test.ts src/__tests__/requests-postgres.test.ts` against the disposable PostgreSQL.

**S2 Transport (one day).** `conversation.command` and `conversation.event` on the hub with cursors, replay authorisation and `serverNowMs` on hello and events; the web hook `useConversationLive` beside `useDiaryLive` with cursor replay then snapshot; the client poll; the clock-offset store. Verify: the ws route source pins; a reconnect-mid-send e2e proving one logical message; the landed-within-a-second measure logged.

**S3 The board, rebuilt (three days).** `/hallkeeper/today` under D7 with the D3 system: lanes, the ruler and NOW plaque, phase-segmented slabs, dimensioned gaps, the UNOWNED rail, the next-action line, phone and wall modes, boundary-exact ticks, the stale band, the DST and multi-room fixtures. Fixtures: populated, dense, empty, offline, stale, night, reduced motion, phone, wall. Verify: `pnpm --filter @omnitwin/web exec vitest run src/pages/hallkeeper`; `pnpm --filter @omnitwin/web visual-check`; the frame harness on the route; the Hallkeeper Test timed with a person.

**S4 Requests and conversations on the slot (three days).** Tap a slot: the thread drawer, staff-private by default, with the client-facing badge where it applies. The client's request composer on their event page: kind, quantity and urgency in one gesture; room and slot prefilled; wrong-room correction easy; local feedback, then the true sent or queued state. The slab gains the ring within a second; acknowledge, "I'll take this", hand over and resolve with an outcome from the slab; the sender sees seen and owned; the chime opt-in; `aria-live`. Verify: `e2e/living-timetable-three-identities.spec.ts` with admin, hallkeeper and client, asserting the ring within 1,000 ms and one owner under a double accept.

**S5 Observations (one day).** Doors open, set, live, flipping, done and cleaned as observations from the slab, through the offline queue; overrun and changeover-at-risk exceptions derived from them against the schedule; nothing writes a time. Verify: state-machine unit tests for every boundary; the offline replay test.

**S6 The When, made fun and complete (two days).** The ribbon gains phase handles (setup, doors, live, clear-down) with the venue's buffers drawn; typed natural entry ("12–4pm", "7 for 7:30"); spring resistance at ink ghosts (the release and magnetise tuning from goal 01 §5 as starting values, measured in the motion lab); a soft tick on each snap (opt-in); the price line recomputed from the existing pricing rules as the window moves; and "Propose this time" (client, writes a hold) or "Ink it" (office). The Diary shows the proposed hold pencilled; inking it is the approval and the board updates live. Verify: `when-ribbon-model` tests for phases and parsing; a contract test that a client can only create or move a hold; the live e2e of propose, ink, board.

**S7 Beyond the glass (two days).** Escalation on the venue's windows to the duty admin; Resend email outside quiet hours; the PWA manifest, service worker and VAPID push for the three events; shift handover of open requests; presence shown to the office. Verify: escalation timing tests with a fake clock; a push subscription round trip on the local stack; the handover contract tests.

**S8 Kiosk and phone hardening (one day).** Token refresh, rollover, Wake Lock, burn-in drift, print links, and the Guided Access note in `docs/operations/hallkeeper-wall-display.md`. Verify: a 26-hour simulated clock in a unit test for rollover and refresh; the stale band e2e.

**S9 Delivery and the run (two days).** Rehearse the whole sentence on a Vercel preview with a disposable Neon branch and three identities; migrate production first; deploy API, then web, through the serial lane; verify the changed live flow with test ink and delete it; run HUMAN.md 1 with Elaine and a working hallkeeper (next action found in five seconds, a request acknowledged in fifteen; report n and every failure); publish `docs/reports/living-timetable-2026-10.md`.

## Done when

The sentence works on production with three signed-in identities. A client proposes "Grand Hall, 12 to 4" from the planner. The office inks it and the price updated with the window. The Day Board shows the slot green an hour before setup, amber half an hour before doors and red while live, on the corrected time. The client asks for ten more chairs and the copper ring is on the slot on the wall and on a phone within a second. Two hallkeepers tap accept and exactly one owns it. The client sees "Elaine has this" and then the outcome. A staff-private note never reaches the client, and a revoked link is closed at once. The wall display survives the night. A disconnected phone's acknowledgement reconciles on reconnect. Nothing any message did changed a time, a layout or stock. The frame and latency numbers in D12 are met and labelled emulated or measured. The usability targets are reported with n. Blake has judged the board, the ring and the ribbon with his eyes.

## Verify (the standing set)

```
pnpm --filter @omnitwin/types test
pnpm --filter @omnitwin/api exec vitest run src/__tests__/conversation src/__tests__/requests-postgres.test.ts src/__tests__/route-atomicity-postgres.test.ts
pnpm --filter @omnitwin/web exec vitest run src/pages/hallkeeper src/components/editor/cockpit
pnpm --filter @omnitwin/web visual-check
pnpm --filter @omnitwin/web exec playwright test e2e/living-timetable-three-identities.spec.ts --workers 1
node packages/web/scripts/splat-drag-budget.mjs --route /hallkeeper/today
```

Local stack: portable Postgres on 54329, the ws bridge on 54331, the API on 3011 (never 3001), Vite on 5174; `TWIN_PUBLIC_VENUE_SLUGS=trades-hall-glasgow`. E2E serial, one file per invocation; never edit web source during a harness run.

## Forbidden

A second clock, or any time written outside a booking. A generic chat widget, chat bubbles, avatars in circles, unread badges that shout. Widening a thread's audience. `canManageVenue` as an approval gate; a new global role per profession. A message or request that mutates an event, a time, a layout or stock. A pulse that never quiets (the live breath is the one exception, and it stops with the connection); anything that strobes; colour carrying meaning alone. A fabricated delivered or seen state. A decorative paperclip. Email as the source of truth. Pushing the shared checkout. A 60 fps claim without a device name. Working in `C:\Users\blake\omnitwin2`.

## Human inputs

1. **The wall register.** D7 makes the wall display dark, from your reference, and keeps the office and phone in the selected ivory register. Say "wall dark, as decided" or "all ivory". **Answered 10 October 2026: dark, as built.**
2. **The people matrix.** Correct `docs/operations/people-matrix.md` when S0 produces it: who receives each request kind, who covers, escalation windows, quiet hours, who may approve timing. Until then the D8 defaults apply. **Answered 10 October 2026 on the two decisions asked: who may ink a time is staff and admin only (the code change lands with S6); escalation now 2 min, soon 5 min, routine 15 min, email quiet hours 22:00 to 07:00 (S7). The usual owner per kind, the duty admin by name and manager approvals keep the matrix's defaults until S7 asks.**
3. **A hallkeeper on production.** Invite one real hallkeeper account (or Elaine's) through the existing onboarding so S9 can run the three-identity live check without impersonation. **In progress 10 October 2026: Blake invites a hallkeeper email and signs in once; the email follows, then the three-identity check runs.**
4. **Already asked, not asked again:** the room tone (HUMAN.md 6) for the chime; a phone and an iPad for a day (HUMAN.md 3) so the 60 fps lines lose the word "emulated"; Elaine and a working hallkeeper for 60 to 90 minutes (HUMAN.md 1).

## Unlocks

Goal 06's client change requests and the release id on every surface; goal 09's decision object gets its first real inputs (quantity beyond release, timing changes); goal 05 S7's shortages have a slab to land on; goal 10's supplier audience has a model to extend.
