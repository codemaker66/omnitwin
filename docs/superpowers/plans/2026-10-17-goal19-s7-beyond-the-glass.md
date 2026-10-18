# Goal 19 S7, Beyond the glass: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When no screen is watching, the house is still told: unowned requests escalate on the venue's windows to the duty admin, by email outside quiet hours, by web push on three events; an outgoing hallkeeper hands open requests to a named relief; the office sees which screens are live.

**Architecture:** One venue-settings row carries every window and quiet hour (data, never a constant). The existing 15-second sweep in the diary hub keeps doing the work, extended to every urgency, to deferred quiet-hours email and to unanswered handovers. Presence gains a device kind on the hub's auth frame. Push is a `push_subscriptions` table, a `web-push` sender behind VAPID env, and a service worker; without VAPID keys push is off the way email is off without a Resend key.

**Tech Stack:** Fastify, Drizzle (PostgreSQL), Zod, Vitest, React 18, Playwright, `web-push` (API), the browser Push API and a hand-written service worker (no workbox).

**Spec:** `goals/19-the-living-timetable.md` (D8, D6, D11, S7, Verify, Forbidden) and `docs/operations/people-matrix.md` (§2, §3, §6). Blake's decisions of 10 Oct 2026: escalation now 2 min, soon 5 min, routine 15 min; email quiet hours 22:00 to 07:00 Europe/London; in-product never sleeps.

## Global Constraints

- TypeScript strict, zero `any`; `@typescript-eslint/strict-boolean-expressions` on. Zod at every boundary.
- Migration number: **0092** (idx 90). 0090 is the redesign session's bind (#104), 0091 is T-656. Re-check origin's journal at cut time and take the next free number if either moved. Additive only; `request_escalation_seconds` stays and is no longer read.
- Branch order: cut `claude/living-timetable-s7` from origin/master only after #98 (this session), #104 (the bind) and #109 (living record) have merged, because the bind touches `DayBoardPage.tsx` and `board-copy.ts`, which Task 4 edits. The guards branch #108 later writes notifications inside `booking-mutations.ts`; read its diff before Task 5 touches notification writes.
- `email-templates.tsx`: the redesign session's #113 restyles the client emails into the ivory and forest register (palette constants, `INK_MUTED`, contrast assertions in its tests). If #113 has not merged when Task 2 reaches the escalation template, take #113's palette constants so the escalation email matches the rest.
- `web-push` 3.6.7 (latest on npm, published Jan 2024, Node ≥ 16); pin exactly. `setVapidDetails(subject, publicKey, privateKey)` once; `sendNotification(subscription, payload, { TTL, urgency })` resolves `{ statusCode, body, headers }` and rejects with `WebPushError` (`.statusCode`, `.endpoint`) on any non-2xx; 404 and 410 mean the subscription is gone (disable it), 429 and 5xx are retryable (do not retry in-process; the next event tries again). `VAPID_SUBJECT` must be a real `mailto:` address: Apple's service answers 403 `BadJwtToken` for a localhost or placeholder subject. `generateVAPIDKeys()` makes the pair once; the private key goes only into Railway's variables, never a file in the repo or a message.
- Defaults (people matrix §3, §6): `escalation_now_seconds` 120, `escalation_soon_seconds` 300, `escalation_routine_seconds` 900, `quiet_hours_start` 22:00, `quiet_hours_end` 07:00, `duty_admin_user_id` null, `day_boundary_hour` 4, `handover_relief_seconds` 300, `wall_shows_guest_details` false. Venue time Europe/London through `board-time.ts`.
- A venue with no settings row never escalates (today's rule, kept).
- Push carries three events only: a request landed for you, a request escalated to you, a reply to your request. No SMS, no Slack. Email is never the source of truth.
- Copy in the back-of-house register: verb-first, terse, no compliance vocabulary, no exclamation marks.
- Every claim of delivery is a recorded fact (`email_sends`, `push_sends`), never assumed.
- Forbidden: a second clock; widening a thread's audience; a message that mutates a time, layout or stock; pushing the shared checkout.

## Review Focus

1. A request raised at 21:59 with a 15-minute window escalates at 22:14, inside quiet hours: the inbox and push fire at once, the email waits until 07:00 and goes only if the request is still unowned. Test in Task 2.
2. The duty admin named in settings has left the venue (user deleted or role changed): the escalation falls back to every venue admin rather than nobody. Test in Task 2.
3. A handover to a relief who never accepts: after `handover_relief_seconds` the request escalates once, and the outgoing person is still the owner of record until acceptance. Test in Task 3.
4. A push endpoint that answers 404 or 410 is disabled and never retried, and a sender failure never fails the request transition that triggered it. Test in Task 5.
5. The wall display signed in as Elaine and Elaine's phone are one person with two devices: the office line reads "Wall display live · Elaine's phone live", not "Elaine, Elaine". Test in Task 4.

---

### Task 1: Operating settings (migration, schema, service, route)

**Files:**
- Create: `packages/api/drizzle/0092_operating_settings.sql`; append to `packages/api/drizzle/meta/_journal.json`
- Modify: `packages/api/src/db/schema.ts` (venueSettings, requests, new pushSubscriptions and pushSends tables)
- Create: `packages/api/src/services/venue-operating-settings.ts`
- Create: `packages/types/src/venue-operating-settings.ts`; export from `packages/types/src/index.ts`
- Modify: `packages/api/src/routes/venues.ts` (GET and PATCH `/venues/:venueId/operating-settings`)
- Test: `packages/api/src/__tests__/venue-operating-settings-postgres.test.ts`, `packages/types/src/__tests__/venue-operating-settings.test.ts`

**Interfaces:**
- Produces: `VenueOperatingSettings` (types) `{ escalationNowSeconds, escalationSoonSeconds, escalationRoutineSeconds, quietHoursStart: "HH:MM", quietHoursEnd: "HH:MM", dutyAdminUserId: string | null, dayBoundaryHour, handoverReliefSeconds, wallShowsGuestDetails }`; `VenueOperatingSettingsSchema`; `OPERATING_SETTINGS_DEFAULTS`.
- Produces: `readOperatingSettings(db, venueId): Promise<VenueOperatingSettings | null>` (null when no row); `writeOperatingSettings(db, venueId, patch: Partial<VenueOperatingSettings>): Promise<VenueOperatingSettings>` (upsert with defaults); `escalationWindowSeconds(settings, urgency): number`.
- Produces tables: `requests.escalation_emailed_at timestamptz`, `requests.handover_due_at timestamptz`; `push_subscriptions(id, user_id, venue_id, endpoint UNIQUE, p256dh, auth, device_kind, user_agent, created_at, last_used_at, disabled_at)`; `push_sends(id, subscription_id, event, idempotency_key UNIQUE, status pending|sent|failed|gone, status_code, last_error, created_at, sent_at)`.

- [ ] **Step 1: Write the failing Postgres test** (`describe.skipIf` on `VENVIEWER_OPERATING_SETTINGS_TEST_DATABASE_URL`, migrate with drizzle's migrator as the other `*-postgres.test.ts` do)

```ts
it("reads null for a venue with no row, and defaults filled in after the first write", async () => {
  expect(await readOperatingSettings(db, venueId)).toBeNull();
  const written = await writeOperatingSettings(db, venueId, { escalationNowSeconds: 120 });
  expect(written).toEqual({ ...OPERATING_SETTINGS_DEFAULTS, escalationNowSeconds: 120 });
});
it("carries today's single window into the now window", async () => {
  // seed venue_settings with request_escalation_seconds 180 and escalation_now_seconds at its default,
  // run the migration's UPDATE statement (exported from the test as the same SQL text), read 180
});
it("refuses a duty admin from another venue", async () => { /* writeOperatingSettings rejects: DUTY_ADMIN_NOT_IN_VENUE */ });
```

- [ ] **Step 2: Run it to see it fail** — `VENVIEWER_OPERATING_SETTINGS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/venviewer_s7_test pnpm --filter @omnitwin/api exec vitest run src/__tests__/venue-operating-settings-postgres.test.ts` → FAIL, module not found.
- [ ] **Step 3: Write the migration** `0092_operating_settings.sql`: `ALTER TABLE venue_settings ADD COLUMN` × 9 with the defaults above (`quiet_hours_start time NOT NULL DEFAULT '22:00'`, `duty_admin_user_id uuid REFERENCES users(id) ON DELETE SET NULL`, CHECKs 30..86400 on the three windows and the relief, 0..23 on the boundary hour); `UPDATE venue_settings SET escalation_now_seconds = request_escalation_seconds`; `ALTER TABLE requests ADD COLUMN escalation_emailed_at timestamptz, ADD COLUMN handover_due_at timestamptz`; `CREATE TABLE push_subscriptions`, `CREATE TABLE push_sends` as in Interfaces, indexes on `push_subscriptions(user_id)` and `(venue_id)`. Journal entry idx 90, tag `0092_operating_settings`, `when` later than 0091's.
- [ ] **Step 4: Schema, types, service, route.** Types file with the Zod schema (times as `/^([01]\d|2[0-3]):[0-5]\d$/`), the defaults constant and `escalationWindowSeconds`. Service as in Interfaces. Route: GET for `canManageVenue`, PATCH for admin or platform admin, body `VenueOperatingSettingsSchema.partial()`, 400 on shape, 404 `DUTY_ADMIN_NOT_IN_VENUE` when the named user is not an admin or manager of this venue.
- [ ] **Step 5: Run the Postgres test and the types test** → PASS. `pnpm --filter @omnitwin/types build`.
- [ ] **Step 6: Commit** `git add packages/api/drizzle packages/api/src/db/schema.ts packages/api/src/services/venue-operating-settings.ts packages/api/src/routes/venues.ts packages/types/src packages/api/src/__tests__/venue-operating-settings-postgres.test.ts` — "Venue operating settings: windows, quiet hours, duty admin, relief, push tables (0092)".

### Task 2: Escalation on every urgency, to the duty admin, email outside quiet hours

**Files:**
- Create: `packages/api/src/services/escalation-clock.ts`
- Modify: `packages/api/src/services/requests.ts` (`insertRequest` L265-274, `selectDueRequestEscalations` L779, `runRequestEscalationPass` L810-896, new `runEscalationEmailPass`)
- Modify: `packages/api/src/ws/diary-live.ts` L557-602 (the sweep also runs the email pass)
- Modify: `packages/api/src/services/email-templates.tsx` (`requestEscalation` gains `reason: "unowned" | "handover"` wording)
- Test: `packages/api/src/__tests__/escalation-clock.test.ts`, `packages/api/src/__tests__/requests-state.test.ts` (extend), `packages/api/src/__tests__/requests-postgres.test.ts` (extend L383-460)

**Interfaces:**
- Consumes: `readOperatingSettings`, `escalationWindowSeconds` (Task 1).
- Produces: `withinQuietHours(nowMs: number, quiet: { start: "HH:MM"; end: "HH:MM" }, zone?: string): boolean`; `quietHoursEndAfter(nowMs, quiet, zone?): number` (the next end instant, ms); `dutyAdminsFor(db, venueId, settings): Promise<readonly { id; name; email }[]>`; `runEscalationEmailPass(db, deps): Promise<readonly { requestId: string; emailedAdmins: number }[]>`; `EscalatedRequest.reason: "unowned" | "handover"`.

- [ ] **Step 1: Write the failing clock tests** (fake instants, Europe/London)

```ts
it("22:00 to 07:00 holds 22:00, 23:30 and 06:59, not 07:00 or 21:59", ...);
it("crosses the DST Sundays 29 Mar and 25 Oct 2026 on wall-clock hours", ...);
it("quietHoursEndAfter at 23:10 is 07:00 the next day; at 06:30 is 07:00 today; outside quiet hours it is now", ...);
```

- [ ] **Step 2: Run** `pnpm --filter @omnitwin/api exec vitest run src/__tests__/escalation-clock.test.ts` → FAIL.
- [ ] **Step 3: Implement `escalation-clock.ts`** with `Intl.DateTimeFormat` parts for the zone (no new dependency), the way `board-time.ts` does it.
- [ ] **Step 4: Extend the state and Postgres tests before changing the service**

```ts
// requests-state.test.ts
it("a soon request is due after its own window and a routine after its", ...);
// requests-postgres.test.ts, injected now + send
it("escalates soon after 300 s and routine after 900 s to the duty admin only when one is named", ...);
it("falls back to every venue admin when the named duty admin no longer belongs to the venue", ...);
it("inside quiet hours writes the inbox copy and no email; the email pass sends at 07:00 if still unowned, and never if owned by then", ...);
it("a request with no settings row never escalates", ...); // kept
```

- [ ] **Step 5: Implement.** `insertRequest`: `escalationDueAt = now + escalationWindowSeconds(settings, urgency)` for every urgency (null without a row). `selectDueRequestEscalations`: drop the `urgency === "now"` filter; also admit `state === "handed-over" && handoverDueAt <= now` (Task 3 sets it). Pass: recipients from `dutyAdminsFor`; inbox as today; email only when `!withinQuietHours(now, settings)`, writing `escalation_emailed_at`; otherwise leave it null. `runEscalationEmailPass`: candidates `escalated_at NOT NULL AND escalation_emailed_at IS NULL AND owner_user_id IS NULL AND state IN ('sent','handed-over')`, send when outside quiet hours with the same idempotency key, write `escalation_emailed_at`. Sweep calls both passes in turn.
- [ ] **Step 6: Run** the three suites → PASS; `pnpm --filter @omnitwin/api exec vitest run src/__tests__/requests-routes.test.ts src/ws` → PASS.
- [ ] **Step 7: Commit** "Escalate every urgency on the venue's windows, to the duty admin, by email outside quiet hours".

### Task 3: Shift handover of open requests

**Files:**
- Modify: `packages/types/src/requests.ts` (`HandoverShiftSchema { toUserId: UUID }`, `VenueRequestSchema` gains `handoverDueAt: string | null`)
- Modify: `packages/api/src/services/requests.ts` (new `handoverOpenRequestsCore(db, actor, venueId, toUserId): Promise<HandoverOk | RequestDeny>`; `transitionRequestCore` sets `handoverDueAt` on `handed-over` and clears it on accept/resolve)
- Modify: `packages/api/src/routes/requests.ts` (`POST /:venueId/requests/handover`)
- Modify: `packages/web/src/pages/hallkeeper/DayBoardPage.tsx` status strip: "Hand over my shift" → handler picker (reuse `GET /:venueId/handlers`) → one call
- Test: `packages/api/src/__tests__/requests-living-postgres.test.ts` (extend), `packages/api/src/__tests__/requests-routes.test.ts` (extend), `packages/web/src/pages/hallkeeper/__tests__/` (the control)

**Interfaces:**
- Consumes: `transitionRequestCore` (exists), `listRequestHandlers`, `handoverReliefSeconds` from settings.
- Produces: `HandoverOk { ok: true; handedOver: readonly VenueRequest[]; toName: string }`; route 200 `{ data: { handedOver, toName } }`, 403 unless `canHandleRequests`, 404 `HANDLER_NOT_FOUND` when the target is not a handler of the venue, 400 `NOTHING_TO_HAND_OVER` when the actor owns no open request.

- [ ] **Step 1: Failing contract tests**: the owner hands over three owned requests and not a colleague's; each is `handed-over` with `handoverDueAt = now + 300 s`, history rows name the actor; the relief's accept clears `handoverDueAt`; after 300 s unaccepted, the escalation pass escalates it once with `reason: "handover"` and the owner of record is still the outgoing person.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** service and route, and the Day Board control (the picker lists handlers, one button, the result read back as a toast "Handed 3 requests to Callum"). **Step 4: Run** API suites and `pnpm --filter @omnitwin/web exec vitest run src/pages/hallkeeper src/components/requests` → PASS. **Step 5: Commit** "Hand a shift's open requests to a named relief; absent relief escalates".

### Task 4: Presence with devices, and the office's line

**Files:**
- Modify: `packages/api/src/ws/diary-live.ts` (`DiaryAuthMessage` gains `device: z.enum(["wall","phone","desk"]).optional()`; `DiaryLiveUser` gains `devices: readonly DeviceKind[]`; `presenceFor` merges a user's devices; hello and presence frames unchanged in shape beyond that field)
- Modify: `packages/web/src/pages/diary/lib/live-protocol.ts` (`LivePresenceUserSchema` + `devices` optional, older servers), `packages/web/src/pages/diary/hooks/useDiaryLive.ts` (`useDiaryLive(enabled, onEvent, options?: { device?: DeviceKind })`, sends `device` on auth), `packages/web/src/pages/hallkeeper/DayBoardPage.tsx` L849 (wall → "wall", narrow → "phone", else "desk"), `packages/web/src/pages/diary/DiaryBoardPage.tsx` L1077-1080 and `board-copy.ts` (the line)
- Create: `packages/web/src/pages/diary/lib/presence-line.ts`
- Test: `packages/api/src/ws/__tests__/diary-live.test.ts` (extend), `packages/web/src/pages/diary/lib/__tests__/presence-line.test.ts`

**Interfaces:**
- Produces: `presenceLine(users: readonly LivePresenceUser[], options: { nowWindowSeconds: number | null; selfUserId: string }): string` → "Wall display live · Elaine's phone live", "Elaine's desk live", or "No hallkeeper screen is on; escalating in 2 min" (null window → "No hallkeeper screen is on"). A hallkeeper screen is any hallkeeper presence, or any `wall` device.

- [ ] **Step 1: Failing tests**: hub dedupes Elaine on wall and phone into one user with `devices: ["wall","phone"]`; the line reads as above; no hallkeeper presence with window 120 → "escalating in 2 min"; the self user is left out.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; the Diary reads `nowWindowSeconds` from `GET /venues/:venueId/operating-settings` (Task 1), fetched once per venue. **Step 4: Run** both suites → PASS. **Step 5: Commit** "Presence names the device; the office sees which screens are live".

### Task 5: Web push for three events

**Files:**
- Modify: `packages/api/package.json` (`web-push` dependency, exact version from the registry on the day), `packages/api/src/env.ts` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` optional)
- Create: `packages/api/src/services/push.ts`, `packages/api/src/routes/push.ts` (registered at `/push` in `index.ts`)
- Modify: `packages/api/src/services/requests.ts` (after a created request and after an escalation), `packages/api/src/services/conversation-commands.ts` (after a message lands on a request's thread)
- Create: `packages/web/public/sw.js`, `packages/web/src/lib/push-alerts.ts`
- Modify: `packages/web/src/main.tsx` (register `/sw.js` when `"serviceWorker" in navigator`), `packages/web/src/components/dashboard/NotificationCenter.tsx` and `DayBoardPage.tsx` status strip (the "Alerts on this device" switch)
- Create: `docs/operations/push-alerts.md` (how to turn it on; iPhone needs the installed app from Share → Add to Home Screen; what is and is not sent)
- Test: `packages/api/src/__tests__/push.test.ts`, `packages/api/src/__tests__/push-routes.test.ts`, `packages/web/src/lib/__tests__/push-alerts.test.ts`, `packages/web/e2e/push-alerts.spec.ts` (gated on `E2E_PUSH=1` like the three-identities spec)

**Interfaces:**
- Produces: `isPushConfigured(): boolean`; `sendPush(db, { userIds, event: "request.landed" | "request.escalated" | "request.replied", title, body, url, idempotencyKeyBase }, deps?: { send?: (sub, payload) => Promise<{ statusCode: number }> }): Promise<readonly PushSendRecord[]>`; routes `GET /push/vapid-public-key` → `{ data: { publicKey } | null }`, `POST /push/subscriptions` body `{ endpoint, keys: { p256dh, auth }, deviceKind, venueId }` → 201, `DELETE /push/subscriptions` body `{ endpoint }` → 204; web `subscribeThisDevice(venueId, deviceKind): Promise<"on" | "denied" | "unsupported" | "off">`, `unsubscribeThisDevice()`.
- Push payload JSON `{ title, body, url, event }`; the worker shows it with `tag = event + ":" + requestId` so a repeat replaces, and opens `url` on click.

- [ ] **Step 1: Failing API tests**: without VAPID env `sendPush` writes nothing and returns `[]`; with env and an injected sender, one `push_sends` row per live subscription with status sent; a 410 disables the subscription (`disabled_at`) and records `gone`; the same idempotency key never sends twice; a request created pushes to the audience's subscribed users minus the requester; an escalation pushes to the duty admins; a reply pushes to the requester when the author is someone else, never to the author.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with `web-push`'s `sendNotification`, `setVapidDetails` once at start when configured, TTL 300 s, urgency `high` for escalated. **Step 4: Run** → PASS.
- [ ] **Step 5: Web**: the worker, the registration, the switch (states on, off, denied with the words to fix it, unsupported with the iPhone install words), unit tests on `push-alerts.ts` with a stubbed `PushManager`. **Step 6:** the e2e against the local stack: Playwright grants `notifications`, the switch is turned on, the API's `push_subscriptions` row is asserted through `GET /push/subscriptions/mine`, and delivery stays with the API unit test. **Step 7: Commit** "Web push for a request landed, escalated or answered, on the devices that asked".

### Task 6: Evidence, records, hand-over

- [ ] Run the standing set from goals/19 Verify plus: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/escalation-clock.test.ts src/__tests__/requests-state.test.ts src/__tests__/push.test.ts`, the Postgres suites on a private cluster, `pnpm --filter @omnitwin/web typecheck && pnpm --filter @omnitwin/web lint`, `pnpm --filter @omnitwin/api typecheck && lint`.
- [ ] Browser check on the local stack: raise a "soon" request as the client with the venue's soon window set to 30 s, see the duty admin's inbox row and the `email_sends` row (`dev_mode` locally, since the local API has no Resend key), see the Diary's line change when the Day Board tab (wall) closes.
- [ ] Session log entry, ledger row (T-651 S7 as local, then merged, then live as each happens), `goals/EXECUTION.md` S7 row, hand-over note in the shared folder, PR with the evidence through the orchestration session; deploy and live check follow the merge (S9 rehearses the whole sentence).
