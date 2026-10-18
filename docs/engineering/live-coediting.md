# Live co-editing (v1)

T-664. Two or more of a venue's team open the same layout and see each other
and each other's changes as they happen. Built 17 October 2026 from the 22 August
design (phases 2 and 3 of it; the design itself is private, rescued outside the repo).

## What v1 does

- **Presence.** A quiet row of initials beside the Inspector names the other
  people in this layout and, in the tooltip and accessible name, the room each is
  viewing. Presence is per connection: one person in two tabs is two entries.
- **Live changes.** Every placement, move and delete appears in the other people's
  scenes within one frame of reaching them. Measured on a local stack after warm-up:
  1–3 ms from one browser's action to the other browser's scene; production adds the
  round trip to the API. The durable commit follows: 436 ms from a gesture's end to a
  clean editor locally (the 400 ms co-editing debounce plus the save), 1.4–2.8 s while
  a headless browser was rendering the hall on the CPU.
- **Conflicts.** The last write to an object wins, in the server's order. When a
  later write lands on an object this person changed or has selected, they see
  "Alex moved this table" for about three seconds.
- **Access.** The layout's owner and the venue floor (admin, manager, staff,
  hallkeeper at that venue), plus Venviewer platform admins. A client (or the legacy
  planner role) is never admitted, even on a layout they own; they see nothing new.
- **Persistence.** The batch save and its `configurations.revision`
  compare-and-swap stay the only way the layout changes. Reconnecting refetches.

Out of scope for v1, with seams left for them: concurrent merging of the same
object (rebase is object-level; a field-level merge would slot into
`rebaseOntoServer`), shared undo (undo stays per person and per object id), and
offline edits (the overlay is dropped on disconnect; a queue would replace that).

## The two channels

| | Ephemeral (live) | Durable (the layout) |
| --- | --- | --- |
| Carries | Presence, the room viewed, live ops (whole-object state, real metres) | `placed_objects` via the batch save |
| Order | Per-room sequence stamped by the hub; the sender gets its own frame back | `configurations.revision` compare-and-swap |
| Stored | Nowhere. `ws/layout-live.ts` takes no database handle (a test asserts it) | Postgres, with a `configuration_layout_revisions` row per commit |
| Crosses over | `layout.changed { revision }` after every commit, no geometry | |

Every writer that advances the revision emits `layout.changed` on the event bus
after its transaction resolves: the authenticated batch, the public batch and the
websocket autosave. The single-object REST routes (`POST/PATCH/DELETE
/configurations/:id/objects/…`) do not advance the revision and so announce nothing;
the planner does not use them.

## Client rules

Code: `packages/web/src/lib/layout-live/` (pure core and the socket client),
`stores/editor-store.ts` (base snapshot, adopt, rebase, yield),
`components/editor/EditorBridge.tsx` (compose and decompose),
`components/editor/LayoutLiveLayer.tsx` (mount and presence row).

1. **Three documents.** BASE is the last document the server confirmed (load, save
   echo, adopted refetch). LOCAL is this person's editor: base plus their edits, and
   the only thing a save sends. The REMOTE OVERLAY holds other people's latest live
   op per object; the scene draws it on top of local, and it never enters local.
2. **Compose and decompose.** EditorBridge pushes `composeWithOverlay(local,
   overlay)` into the placement store. When the scene changes, `decomposeSceneItems`
   takes back only this person's edits: an item still showing a peer's state keeps
   the local object, a peer's unsaved placement (`remote:<connection>:<local-id>`) is
   skipped, and an object a peer deleted stays in the local document.
3. **Last write wins.** An op this client has sent but not yet seen echoed is the
   later write, so a peer's op on that object is ignored until the echo. Once
   echoed, a peer's higher sequence wins.
4. **Yield.** When a later peer write lands on an object this person changed, that
   object returns to the server copy and stays tied to it (also after a save's echo)
   until this person edits it again, so no save resends the older value.
5. **Adopt or rebase.** On `layout.changed` with a newer revision the client
   refetches: a clean editor adopts the server document wholesale; a dirty one keeps
   its changed objects and takes everything else from the server
   (`rebaseOntoServer`). An object this person changed that someone else deleted is
   dropped with a notice, not resurrected (the batch cannot update a deleted row).
   While live, a 409 does the same and retries once instead of asking for a reload.
6. **Pace.** A gesture's first change is sent at once; the frames after it are
   coalesced to one per 50 ms. While someone else is in the layout the autosave
   debounce drops from 3 s to 400 ms, so the room converges on the server's truth
   quickly and two people rarely race one revision.
7. **Reconnect.** A lost socket clears the overlay and pending state, shows
   "Reconnecting to the room…", backs off like the Diary, and resyncs from the server
   on the next `live.hello`. An overlay entry nobody commits expires after 15 s.

## Operating limits

- **One API replica.** The hub is an in-process map, like the Diary's. A second
  Railway replica would split a room in half with no error anywhere. A backplane
  (Redis, or a verified Postgres LISTEN/NOTIFY) is the precondition for a second
  replica.
- **Access is checked at join and every 20 s.** The heartbeat re-reads each member's
  role and venue and the layout's owner, venue and deletion; anyone no longer
  admitted gets `live.revoked` and is removed (the socket stays for autosave, which
  authorises every flush). A database error skips that pass rather than revoking all.
- **Public-preview guests** keep single-person planning; the client never opens
  the live room for a public draft.
- The hub drops a client frame silently when it is malformed, over 128 KB or over
  30 frames a second (burst 40); it never closes a session over one. Object metadata
  is flat primitives only (a nested blob once crashed `JSON.stringify` on the relay).
  The websocket `maxPayload` is 1 MiB. A member more than 4 MiB behind skips frames.
  A sent op not echoed within 2 s stops counting as in flight.

## Verify

- Unit and socket tests: `pnpm --filter @omnitwin/api exec vitest run
  src/__tests__/ws/layout-live.test.ts` (two real sockets on the real route against a
  database stub that fails on any write) and `pnpm --filter @omnitwin/web exec vitest
  run src/lib/layout-live src/stores/__tests__/editor-store-live.test.ts`.
- Two browsers, live local stack (`e2e/layout-live-coediting.spec.ts`, self-gated):
  a disposable Postgres migrated and seeded, the API with `NODE_ENV=test` (it accepts
  the seeded JSON identity as a token), Vite in dev mode, then
  `E2E_LAYOUT_LIVE=1 E2E_START_SERVER=false E2E_BASE_URL=… E2E_API_URL=…` with
  `E2E_VENUE_ID`, `E2E_SPACE_ID` (Grand Hall) and the seeded `E2E_FIONA_ID`,
  `E2E_GRAHAM_ID` and `E2E_CLIENT_ID`. The spec edits through the planner's stores
  (one gesture per edit, as a drag makes it) and reads the other browser's placement
  store, which is what its scene draws. Use `expect.poll` over `page.evaluate` for
  async in-page checks: measured on Playwright 1.59, `waitForFunction` with an async
  predicate that always resolves `false` timed out once and then returned in 3–4 ms,
  so it cannot be trusted to wait. Restart Vite after editing a store: HMR then
  serves the app's copy under a `?t=` URL, and the spec's bare import gets a second,
  empty instance (the planner "never loads").
