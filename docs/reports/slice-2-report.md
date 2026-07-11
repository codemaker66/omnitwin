# Diary Slice 2 — the Board — Report

**Date:** 2026-07-12 · **Branch:** `feature/diary-p0-slice-2` (branched from slice-1 HEAD; never pushed; production untouched)
**Task:** T-493 · **Authority:** Diary Research Canon v1.5 §8/§9/§12/§18 per `docs/strategy/authority-map.md`; build plan in `docs/strategy/venue-calendar-planner-architecture.md` §10.

## Status: GREEN

The Board exists: `/diary` renders the six Trades Hall rooms as lanes over `GET /calendar` with day/week/month zoom, a venue-local now-line, pointer **and keyboard** drag through one pure reducer, optimistic moves with undo, the conflict rail with honest checks, and the needs-attention tray — in the Ink & Gilt language with no blur anywhere information lives. The typescript-reviewer's Block verdict (1 P1, 4 P2) was resolved in-session with regression tests. Caveats: exercised against mocked data + the full unit matrix, not a live browser session (the dev stack was not brought up); migration 0050 remains unapplied (owner-gated), so end-to-end drag-against-real-Postgres remains the standing verification from Slice 1's open item.

## Files created / changed

**Commits:** `b3c9303e` (plan) · `840db06e` (PATCH spaceId) · `57addd69` (pure core) · `40ae1851` (UI) · `a1e93744` (review hardening).

| Area | Files |
|---|---|
| Plan | architecture doc §10 (file map, decisions, zoom table); tasks.md T-493 |
| API | `types/booking.ts` UpdateBookingSchema + `spaceId`; `api/routes/bookings.ts` PATCH target-space venue validation (+2 types tests, +1 route pin) |
| Pure core | `web/src/pages/diary/lib/`: `board-time.ts` (Intl wall-clock windows — 23h/25h DST days, 167h/169h weeks, snap, geometry, ticks incl. the skipped/doubled hour), `board-layout.ts` (first-fit packing, footprint segments vs orphan strips, needs-action selection), `board-drag.ts` (idle→dragging→confirming reducer; ghost validity with inline reason; drop-time revalidation on BOTH paths), `undo-stack.ts` (LIFO + `rollbackOverride` CAS) |
| UI | `DiaryBoardPage.tsx` (URL `?view&date`, optimistic overrides, undo toast + Ctrl+Z, t/d/w/m shortcuts, live region), `components/BoardGrid.tsx` (sticky rail/axis, lanes, blocks with zoom-priority disclosure, ghost, brass now-line, memoized packing), `components/BoardPanels.tsx` (ConflictRail, HoldingTray, UndoToast, InkConfirm with Escape + focus trap), `diary-board.css`, `api/diary.ts`, `hooks/useCalendar.ts`, `hooks/useBoardDrag.ts` (5px activation, pointer capture, Shift fine-step, keyboard drag), `board-copy.ts`; `/diary` route in router.tsx |

## Tests

**111 new** (board-time 13 · board-layout 10 · board-drag 20 · undo-stack 5 · board-copy 5 · page contract 9 · types +2 · route pin +1, plus review-regression additions counted therein). **Full suites: web 253 files / 3,048 · api 108 / 2,161 · types green with zero type errors — all green.** Web typecheck, ESLint (types/api/web), and the Vite production build (29.3s) green.

## Review (typescript-reviewer, Block → resolved, commit `a1e93744`)

| Finding | Fix |
|---|---|
| P1: a failed PATCH's rollback deleted the override by key — a rapid re-drag of the same booking could have its NEWER move silently reverted by the OLDER call's failure | `rollbackOverride` compare-and-delete: a failure only removes the exact override it wrote (+2 CAS tests) |
| P2: the commit/rollback path had zero coverage | +2 page tests drive a real keyboard drag → PATCH payload asserted; failure → restore toast |
| P2: drop-time revalidation untestable/regressable | +2 reducer tests: a conflict appearing mid-drag or while the ink dialog is open now rejects locally (confirming path gained the same guard) |
| P2: `layoutLane` recomputed per pointermove | packing memoized on `[rooms, entries]` |
| P2: InkConfirm lacked Escape + focus trap | both added per WAI-ARIA alertdialog |
| P3s adopted | checkbox no longer swallows shortcuts; DOM casts → `instanceof` narrowing |

P3s filed as follow-ups: override persists if the post-move refetch itself fails (clears on next success); three structurally-identical move-patch types could consolidate; `SPACE_VENUE_MISMATCH` covers soft-deleted-same-venue imprecisely (matches POST convention).

## Deviations from the Canon, with reasons

1. **No dnd-kit / no TanStack Virtual** (Canon §8 names dnd-kit; §9 names TanStack Virtual) — neither is installed; the Canon's requirement is keyboard-drag-day-one and 60fps, both delivered by the shared pure reducer + live-region announcements; 6 lanes × a week is trivial DOM. Virtualisation slots in at the lane-render seam when lane counts grow.
2. **Holding tray v1 = needs-attention rail** (overdue next actions/decisions, unranked pencils; click focuses the block) — **drag-from-tray deferred**: `bookings.spaceId` is NOT NULL and enquiry→booking conversion is Slice 3; a display+focus tray is honest, a fake drop target is not.
3. **Venue timezone is a constant (`Europe/London`)** — `GET /calendar` doesn't carry `venues.timezone`; single-venue reality; every helper already takes the zone as a parameter.
4. **Ink "resists" = confirm step on drop** (Enter confirms, Escape keeps) rather than a heavier grab modifier — Canon's "explicit intent required" without hiding the affordance.
5. **Undo = PATCH back via a client stack** — no server undo; concurrent-edit caveat documented in `undo-stack.ts`; the board refetches after every mutation.
6. **Closed-day hatching deferred** — no availability-rules data exists yet (Canon phases the rules table later).
7. **Full APG grid roving-focus deferred** — blocks are tabbable buttons with rich labels and complete keyboard drag; arrow-key *browse* (vs drag) navigation is a Slice 3 polish item.
8. **Concurrent-session notes:** built alongside the live A2/foundry session in one tree. Riders declared per commit (one comment-only router hunk). Their `PlannerScene.tsx` typecheck error appeared and was fixed by them mid-slice; two autofixable lint errors in their untracked `InkArchitectureLayer.tsx` were fixed in the working tree but deliberately **not committed** here (their file, their commit).
9. **Bundle note:** the `@omnitwin/types` barrel now splits into a shared lazy chunk (`booking-*.js`, 76 kB gzip) — within budgets; consider subpath exports if route budgets tighten.

## Open questions (none blocking)

Live-browser pass of `/diary` against the seeded week (needs dev stack + applied migration 0050 — the Slice 1 open item) · Playwright e2e spec for the Board (follow-up; unit matrix covers the contracts) · WebSocket live updates (Canon §9, next P0 tail) · tray drag-to-lane with enquiry conversion (Slice 3).

## Recommendation for Slice 3 (one line)

Wire the loop closed: booking create/edit drawer + enquiry→hold conversion (tray drag becomes real) + the websocket command channel, so two coordinators watching `/diary` see each other's pencils land live.
