# Diary Slice 3 — drawer, conversion, live channel — Report

**Date:** 2026-07-12 · **Branch:** `feature/diary-p0-slice-3` (branched from slice-2 HEAD; never pushed; production untouched)
**Tasks:** T-495 (drawer) · T-496 (enquiry→hold) · T-497 (live channel) · **Authority:** Diary Research Canon v1.5 §1/§9/§12/§15/§17 per `docs/strategy/authority-map.md`; build plan in `docs/strategy/venue-calendar-planner-architecture.md` §11.

## Status: GREEN

The loop is closed: from `/diary` a coordinator creates, edits, and transitions bookings in a non-modal drawer that validates through the **same** Zod schemas the API enforces (UI hygiene = API hygiene, one source of truth); an open enquiry converts into a hygienic hold with `enquiry_id` provenance in one "Pencil in…" step; and every committed mutation is broadcast over `/ws/diary` so a second coordinator's board refetches and their presence chip shows who else is in the diary. The typescript-reviewer's Block verdict (2 P1, 5 P2) was resolved in-session with regression coverage. Caveats unchanged from Slices 1–2: exercised against mocked data + the full unit matrix, not a live browser session; migrations 0050/0051 are written and journaled but **not applied** to any database (owner-gated), so the end-to-end two-browser proof remains the standing open item.

## Files created / changed

**Commits:** `4ecfa1e2` (plan) · `08f6b632` (API) · `6fb9e161` (web) · `67861909` (post-review hardening).

| Area | Files |
|---|---|
| Plan | architecture doc §11 (file map, decisions, the deferred-command-envelope flag); tasks.md T-495/496/497 |
| Types | `types/booking.ts`: `enquiryId` on `BookingSchema` (uuid, nullable) + `ConvertEnquirySchema` (hold-hygiene quartet required unconditionally; ends>starts refinement) |
| API | `drizzle/0051_diary_enquiry_link.sql` (additive `bookings.enquiry_id` → enquiries, `ON DELETE SET NULL`, index) + journal; `db/schema.ts`; `observability/event-bus.ts` typed `"diary.changed"` event; `routes/bookings.ts` — `publishDiaryChanged` emitted **after** each write commits (create/patch/transition/convert; fire-and-forget) + `POST /bookings/from-enquiry` (venue-scoped via `canWriteBookings`, space∈venue, hold + provenance, title fallback, enquiry lifecycle untouched); `ws/diary-live.ts` — `DiaryLiveHub` (clock-injected registry: presence deduped by user, venue-scoped fanout, 20 s heartbeat + 65 s stale sweep) + `/ws/diary` route (first-message auth reusing `resolveWsUser`, read roles staff/admin/hallkeeper); `index.ts` registration |
| Web | `pages/diary/lib/drawer-form.ts` (pure form model: mode → initial form; form → create/sparse-update/convert payloads via the shared schemas; wall↔ISO via `board-time`'s new `wallInputToMs`/`msToWallInput`; `allowedTransitionTargets` from the shared matrix, role-gated); `lib/live-protocol.ts` (server-message union, `parseLiveMessage`, `nextBackoffMs` 1 s→30 s); `hooks/useDiaryLive.ts` (auth-on-open, client ping 15 s, reconnect backoff, **refetch on every re-connect** — snapshot doctrine); `components/BookingDrawer.tsx`; `components/BoardPanels.tsx` tray "Open enquiries" + Pencil in…; `DiaryBoardPage.tsx` (drawer state, Enter-opens/Space-lifts key split in `useBoardDrag`, header New booking, `Live · N` presence chip); `api/diary.ts` (create/update/transition/convert, schema-validated); `board-copy.ts`; `diary-board.css` |

## Tests

**47 new this slice** (types +6 · api +17 · web +24; 5 of those are post-review regression pins/tests). **Full suites: types 1,815 · api 109 files / 2,178 · web 255 files / 3,072 — all green.** ESLint green across types/api/web; api `tsc` build and web Vite production build green. (Web file/test totals include the concurrent A2 session's additions in the shared tree — also green.)

## Review (typescript-reviewer, Block → resolved, commit `67861909`)

| Finding | Fix |
|---|---|
| P1: the `/ws/diary` auth IIFE ran `resolveWsUser` + a `db.select` unguarded — a transient DB failure stranded the connection forever (never joined, never swept, never closed; client never reconnects) and leaked an unhandled rejection (fatal under Node 22 defaults in dev/CI) | entire post-parse auth path wrapped in try/catch: any failure sends `AUTH_FAILED` and closes the socket; source-pinned |
| P1: `BookingDrawer` seeds its form with `useState(() => initialDrawerForm(mode))` — retargeting the open drawer (edit A → New → edit B) kept the previous form, so a submit wrote recycled values | drawer keyed by an open-nonce in the page: every open remounts with a fresh form; page regression test drives edit→New and asserts the stale value is gone |
| P2: a second frame during in-flight auth was parsed as a (failed) auth and killed the valid attempt | `authenticating` checked **before** `AuthMessage.safeParse`; in-flight frames dropped; order source-pinned |
| P2: a socket that closed during async auth still joined the hub (phantom presence until the sweep) | `closed` flag + `readyState` liveness check before `hub.join`; source-pinned |
| P2: `useDiaryLive.onmessage` lacked a disposed guard — a queued frame after cleanup could resurrect state on an unmounted hook | `if (disposed \|\| socket !== ws) return` at the top of onmessage |
| P2: header Close and Escape bypassed the in-flight `busy` guard the Cancel button enforced | both now respect `busy`; page regression test holds a pending PATCH and asserts Escape/Close wait |
| P2: coverage gaps — the ws route registration is source-pinned rather than socket-driven; `useDiaryLive` is mocked in page tests | partially addressed: hub behaviour is fully unit-tested, the route's race fixes are order-pinned, and the two page tests above are real; the register-closure and hook lifecycle remain documented gaps matching the `ws/auto-save.ts` house precedent (below) |
| P3s adopted | heartbeat `unref()` (never holds the process open); unknown post-auth frames answered with a `VALIDATION_ERROR` frame instead of silence |

P3s filed as follow-ups: presence broadcast fires before the joiner's own `hello` (cosmetic ordering); a null auth token on the client retries on the same backoff ladder as a network failure (could back off harder); `from-enquiry` 404 does not distinguish missing vs foreign-venue enquiries (matches house convention deliberately — no existence disclosure).

## Deviations from the Canon, with reasons (Blake Clause)

1. **Command envelopes deferred (Canon §9)** — the ws carries **events + presence**, not the write path. Mutations stay REST, each in a transaction with the exclusion constraint as final arbiter, emitting `diary.changed` after commit. Envelopes buy offline queueing/idempotency-keys we don't need until the Board works offline; migrating four REST handlers onto them later is mechanical. Flagged in architecture §11 as the explicit remaining §9 step — deferred, not silently dropped.
2. **Conversion does not touch the enquiry's own lifecycle (Canon §1 axis independence)** — `POST /bookings/from-enquiry` writes the hold + provenance link only; the enquiry state machine (submitted/under_review/…) is CRM-owned and moves by its own rules.
3. **Owner = the signed-in coordinator** — no owner picker in the drawer; §17 wants a real accountable name, and the person pencilling it in is that name. A reassignment control is a later CRM concern.
4. **Single-process hub** — presence/fanout state is in-memory; a Redis backplane is the precondition for a second API replica (Canon §15), restated in the plan. Presence is advisory display, never a correctness mechanism (Canon §9).
5. **Drawer is non-modal** (`role="dialog"`, no focus trap) — deliberate: the Board stays interactive so a coordinator can read lanes while editing; Escape and Close close it, and the busy guard keeps an in-flight save's outcome visible. The review's stale-form risk this created is fixed by the remount nonce.
6. **`/ws/diary` route coverage is source-pinned, not socket-driven** — the house has no Fastify-websocket harness (`ws/auto-save.ts` has the same shape); the hub (all registry behaviour) is fully unit-tested and every review fix carries an order-sensitive source pin. A real ws integration harness is a follow-up worth doing once, for both channels.
7. **Concurrent-session notes:** built alongside the live A2/analysis session in one tree; explicit-pathspec commits and rider declarations throughout; their files left to their commits.

## Open questions (none blocking)

Apply migrations 0050 + 0051 to a dev Postgres and run the seeded week live (the standing Slice 1 open item — everything downstream of it is mocked-verified only) · live two-browser `/diary` session to see presence + refetch-on-event with real eyes · Playwright e2e spec for drawer/convert/live · command-envelope migration (§9 tail) · hold-reminder delivery job (Slice 1 P1, still stubbed).

## Recommendation for Slice 4 (one line)

Prove it on real rails: apply 0050/0051 to dev Postgres, seed the Trades Hall week, run the two-coordinator live session end-to-end (create → convert → ink race → 409 → presence), and pin it with a Playwright spec — the Diary's first evidence-grade demo.
