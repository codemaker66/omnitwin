**Read this when:** changing what AI assistants or search engines can read about a venue, the `/mcp` endpoint, the public busy/held/nothing-on-our-diary rule, its per-session budget, or the front door's schema.org description.

# Public venue discovery for AI assistants (T-649)

## The decisions

Blake, 8 October 2026, asked "Should AI assistants like Claude and ChatGPT be
able to find and query Trades Hall?", chose **"Yes, read-only"**:

> Public: venue facts, room capacities from venue records, and free/busy dates only (no client names). Enquiries still go through staff.

The same day he asked "When an AI assistant asks whether a date is free, how
should a date with only a provisional hold (a 1st or 2nd option, not
confirmed) answer? No names are shown either way." and chose **"Say 'held,
enquire'"**:

> A third answer, matching how your staff reply: someone has an option, and a second option may be possible. It reveals that a hold exists, not who holds it.

### Never a bare "free" (16 October 2026)

The red-teamed upgrade brief (fix-first item 4) found the MCP telling AI
assistants a room was "free" up to two years out, from a Diary that does not
yet hold the venue's whole forward book (it still lives partly in other
systems, email and paper, and no importer exists). An empty Diary day is a
fact about the Diary, not about the room, so it now answers
**`no_booking_on_our_diary_team_confirms`**: the token itself says that only
the venue team confirms a date, so an assistant that keeps only the word still
cannot promise a room. Every answer carries `asOf`. The words for each answer
live once, in `PUBLIC_DAY_STATUS_WORDING` (`packages/types/src/booking.ts`),
for the MCP and for any web surface that shows a public date status (none does
today).

### Hidden until checked (17 October 2026)

Asked whether to hide date status by default until a room's forward book has
been reconciled with the Diary, Blake chose **"hide date status until
checked"**. The public MCP and any public web surface say nothing about a
room's dates (no busy, held or `no_booking_on_our_diary_team_confirms`) until
someone has recorded that the room's whole forward book is on the Diary.
Until then the room answers **`ask_the_team`**, with `asOf` and the venue's
enquiry page, telephone and email, and no date status at all
(`PUBLIC_ROOM_ASK_THE_TEAM` and its wording in `packages/types/src/booking.ts`;
`publicRoomAnswer` is the one rule every surface applies).

- **The record.** Table `forward_book_checks` (migration 0093, provisional
  number): per room, who recorded it (their account while it exists, and their
  name as it was then), when, and an optional note of up to 500 characters;
  clearing it keeps the row with who cleared it and when. At most one record
  stands per room (a partial unique index), and the composite key holds a
  record to its own venue's rooms.
- **Who.** Only the venue's own admin or manager records or clears it
  (`FORWARD_BOOK_RECORD_ROLES` in `packages/types/src/forward-book.ts`,
  `canRecordForwardBook` in the API). There is no platform-admin shortcut: it
  is the venue's word about its own book. Everyone who reads the Diary sees
  where each room stands.
- **Where.** Dashboard → Venue settings → "Dates for assistants and the
  website" (`components/dashboard/forward-book/`), below Changeovers. Each room
  says "Dates shown" or "Dates hidden" with who checked or hid it and when; the
  record and hide actions say their consequence before saving ("Assistants and
  the website will start saying whether the Grand Hall has bookings on a
  date…"). A colleague's record is shown, never overwritten (409 with the
  record that stands). API: `GET`/`POST /venues/:venueId/forward-book`,
  `POST /venues/:venueId/forward-book/:id/clear` (`routes/forward-book.ts`).
- **How fast.** The public read caches the standing records for one minute
  (`PUBLIC_FORWARD_BOOK_CACHE_TTL_MS`), so recording or clearing takes effect
  within a minute; the staff screen says so.
- **What leaves.** For a shown room, `diaryCheckedAt` (when the record was
  made) beside its days; never the name or the note. For an `ask_the_team`
  room the diary is not even read for the answer, and a question where every
  room answers `ask_the_team` spends no dates from the session budget.

Whether to show a room is the venue's call: the brief's validation suggests
comparing about 30 forward dates per room with every place a booking or pencil
lives today (Salesforce export, Cvent, venue software, spreadsheet, paper,
the members' diary) before recording it. Nothing here records it for them.

These authorise exactly that exposure despite the general public WIP hold.
Nothing beyond it is exposed: no prices, no booking details, no option ranks,
no counts, no times, no decision dates, no submissions.

## What is public

| Surface | Where | Source |
| --- | --- | --- |
| MCP server (read-only) | `https://api.venviewer.com/mcp` | `packages/api/src/routes/public-mcp.ts`, `services/public-discovery.ts` |
| schema.org `EventVenue` JSON-LD | the HTML of `https://venviewer.com/` (every app route serves index.html or a titled copy of it, `packages/web/src/lib/route-documents.ts`) | `packages/web/src/lib/venue-structured-data.ts`, written by `venue-structured-data-plugin.ts` |
| Venue truth both read | — | `packages/types/src/trades-hall-venue-truth.ts` (moved from the web package) |

### Tools

All three are annotated `readOnlyHint: true`, `destructiveHint: false`,
`idempotentHint: true`, `openWorldHint: false`. Input is validated by Zod
(`lib/standard-schema.ts` adapts a Zod 3 schema to the SDK's Standard Schema
contract and advertises a JSON Schema written beside it; tests hold the two
to the same cases). `venue` is optional and only ever `trades-hall-glasgow`.

- **`get_venue`** — name, address, time zone (from `venues.timezone`), the
  official website, and every live room from `spaces`: width/length/height and
  floor area computed from `floor_plan_outline`, plus the four layouts
  (theatre, classroom, dinner, reception). A layout figure is the venue's
  published number with its citation (`capacitySource`), or `null` with a
  "Not published" note. Nothing is estimated from dimensions.
- **`check_availability`** — `from`/`to` (YYYY-MM-DD, at most 92 days per
  call, today through 730 days ahead) and optional `room` slug. Each room
  answers `"ask_the_team"` (no record that its forward book is on the Diary:
  no dates at all) or `"dates"` with `diaryCheckedAt` and, per date, `"busy"`,
  `"held"` or `"no_booking_on_our_diary_team_confirms"` and nothing else. A
  plain-words `meaning` covers each (the shared wording), with the enquiry
  page, telephone, email and `asOf`: when the facts were read, the older of
  the forward-book records and the diary.
- **`how_to_enquire`** — the enquiry composer (`https://venviewer.com/#enquire`),
  what to include, and the venue's published telephone, email and website.
  It cannot submit an enquiry, place a hold or book.

### What busy, held and nothing on our diary mean — the rule recorded

The rule lives in `packages/types/src/booking.ts` (`isLiveBooking`,
`ROOM_BLOCKING_BOOKING_KINDS`, `ROOM_OPTION_BOOKING_KINDS`,
`bookingRoomStatus`, `publicDayStatus`). A booking counts only while **live**:
`status = 'active'` and not soft-deleted — the Diary's own liveness test,
which the conflict engine now calls directly (`services/calendar-conflicts.ts`),
and the one the contested-dates and decisions-due reads apply. Nothing lapses
on the clock: a hold past its decision date stays live (the Diary lists it as
a decision due) until staff record an exit; `expired` is a recorded transition
(`services/booking-mutations.ts`), not a time check. For each room and Diary
day, busy beats held beats nothing on the Diary:

- **busy** — a live `ink` (confirmed) booking or a live `internal_block` (the
  venue's own closure: maintenance, blackouts). `ink` is the Diary's hard floor
  (Canon §2.2): the `bookings_ink_no_overlap` exclusion constraint and the
  conflict engine's only `blocking` severity. A block is venue-generated
  unavailability; calling a closed room "free" would send enquirers to a shut
  date.
- **held** — a live `hold`, the Diary's provisional option (1st, 2nd, Joint
  1st), and nothing busy that day. Blake's "held, enquire": someone has an
  option, a second option may be possible, contact the venue team. The rank,
  number of holds, times and decision dates are never shown.
- **no_booking_on_our_diary_team_confirms** — neither. **Prospects**
  ("Interest only" on the board) are not options: they carry no rank
  (`bookings_rank_hold_only`) and never block (Canon §2.1), so they leave a
  date with nothing on the Diary. So do `cancelled`, `released`, `expired` and
  `lost` rows and anything soft-deleted.

Whatever the answer, the tool text says only the venue team confirms a date,
when someone enquires, and never to call a date free or available.

**Dates are the venue's operational day**, 04:00 to 04:00 Europe/London, as
the Diary's day view counts it (`routes/room-layout-timeline.ts`). An evening
that runs past midnight belongs to the date it started on, so a Friday party
ending at 01:00 does not mark Saturday busy. Days are 23 or 25 hours across
clock changes (`venueDayWindow`, built on the shared venue-clock helpers). The
brief said "calendar day"; this is the Diary's own definition of a day, and it
is one constant (`VENUE_DAY_START_MINUTE`) if Blake prefers midnight.

## Privacy guarantees and how they are enforced

- **Query shape.** The availability read selects only `space_id, kind,
  status, deleted_at, starts_at, ends_at` from `bookings`, for live rows of the
  busy and held kinds; `bookingRoomStatus` reduces each to "busy" or "held"
  before anything else sees it. No title, client, event, owner, note, rank,
  decision date or count can reach a response because none is selected, and
  each date carries one answer: `busy`, `held` or
  `no_booking_on_our_diary_team_confirms`.
- **Allowlist.** `PUBLIC_DISCOVERY_VENUES` (code, by DATABASE slug) holds only
  Trades Hall Glasgow. The tool schema's `venue` enum admits nothing else, so a
  second tenant's slug or id gets the same validation error as a name that
  does not exist; the service checks the allowlist again before any query.
  Adding a venue is a reviewed code change with that venue's consent.
- **Tests.** `public-mcp-postgres.test.ts` (platform PostgreSQL gate) seeds
  distinctive client, event, title, notes, next-action, owner and enquiry
  strings plus a second tenant, drives every tool through the official MCP
  client in both protocol eras, and asserts no response body contains any of
  them, any private id, any booking or hold instant, any decision date or any
  option rank. It seeds live, overdue, expired, released, lost and deleted
  holds beside confirmed bookings and blocks on the same and neighbouring days,
  across the autumn 2026 and spring 2027 clock changes, and proves busy beats
  held, exits and prospects leave nothing on the Diary, and non-discovery by
  slug or id. A room whose record was cleared answers `ask_the_team`, and the
  recorder's name, note and the clearing time never leave.
  `forward-book-postgres.test.ts` migrates its own database and proves the
  record's rules in the database, who may record or clear (staff, the floor,
  sales, a platform admin and another venue's manager refused; another
  venue's room or record not found), simultaneous records, and that the
  public read follows a record and its clearing.
  `public-discovery.test.ts` and `public-mcp.test.ts` cover the rule, DST
  windows, bounds, caching, `asOf`, Origin policy, transport and the session
  budget through real clients; `public-mcp-budget.test.ts` covers the budget's
  window, session recognition and memory caps. The JSON-LD test
  proves every string in it comes from the published profile.
- **Errors.** Tool failures return a plain sentence; logs record an event name
  and a truncated error message, never a request body.

## Transport, cost and abuse limits

- MCP protocol **2026-07-28** (stateless; no `initialize`, `server/discover`
  instead) via `@modelcontextprotocol/server` 2.3.1 `createMcpHandler`, which
  also serves 2025-era clients statelessly from the same per-request factory.
  No transport sessions: `GET`/`DELETE /mcp` answer 405. The route does put an
  `Mcp-Session-Id` on a 2025-era `initialize` answer, which the protocol obliges
  the client to send back; it keys the budget below and nothing else. Responses are JSON
  (`responseMode: "json"`) for 2026 clients; no list-changed notifications are
  advertised, so a `subscriptions/listen` is acknowledged and closed at once.
  Every response is finite and passes through the API's own hooks (security
  headers, compression, request id, metrics).
- Per-IP rate limit **120/minute** on `/mcp` (the shared limiter; AI assistants
  call from shared cloud addresses, and reads are cached).
- **Per-session budget** on top of it (`services/public-mcp-budget.ts`): a
  recognised session may make **60 requests** and read **366 dates** of
  availability an hour; a caller with no recognised session (2026-era clients
  have no handshake) is budgeted by address and user agent at **240 requests
  and 732 dates** an hour, because several conversations can share one
  assistant's address. Only session ids this process issued count, so a made-up
  id buys nothing. A spent request budget answers HTTP 429 with `Retry-After`
  and a JSON-RPC error; a spent date budget answers the tool call with an error.
  Both name the venue team's enquiry page, telephone and email and when asking
  here works again. A refused question spends nothing. State is in memory per
  API process with capped maps, like the rate limiter's own store; a caller who
  opens a new session per handshake gets a new budget each time, so the per-IP
  limit stays the floor. Bodies over 64 KiB
  get 413. `maxToolInputElements` 32.
- Each venue's rooms and its blocking intervals (yesterday through the horizon)
  are read once per **5 minutes** and shared by all callers; answers carry an
  `asOf` stamp.
- `Origin`: requests without one (every server-side MCP client) pass; the
  API's CORS origins plus `claude.ai`, `claude.com` and `chatgpt.com` pass;
  anything else gets 403, per the Streamable HTTP transport's MUST. CORS
  itself is the API's existing allowlist.
- **No `/.well-known` discovery.** The 2026-07-28 core specification defines
  none. Server Cards (SEP-2127) are an optional extension still incubated in
  `experimental-ext-server-card`; adopt it when it stabilises, per that spec.

## schema.org description

`EventVenue` with `@id`, name, alternate name, `url` (venviewer.com),
`sameAs` (the venue's own website), image, telephone, `PostalAddress`, and
`containsPlace` listing each published room as a `MeetingRoom` whose
`maximumAttendeeCapacity` is the largest of its published layout figures.
No building total is stated. The earlier hand-written block's `email` was
dropped: schema.org does not define `email` for a Place. Every type and
property is checked against a schema.org v30.1 vocabulary subset
(`packages/web/src/lib/__tests__/fixtures/`). It is written at build time into
`index.html`, so crawlers that do not run JavaScript read it; the meta and
Open Graph tags are unchanged.

## Add it to Claude as a custom connector

1. In Claude (web or desktop), open **Settings → Connectors** and choose
   **Add custom connector**. On a Team or Enterprise plan an owner adds it
   for the organisation.
2. Name: `Trades Hall Glasgow`. Remote MCP server URL:
   **`https://api.venviewer.com/mcp`**. Leave any OAuth client fields empty:
   the server is public and needs no sign-in.
3. Enable it in a conversation from the tools menu and ask, for example,
   "What does the Grand Hall's diary hold for Saturdays in June 2027, and how do I
   enquire?". It never answers that a date is free: only the venue team confirms one.

Any client that speaks remote Streamable HTTP MCP uses the same URL.

## Checks

```bash
# Unit and route tests (one file per command on this PC).
pnpm --filter @omnitwin/api exec vitest run src/__tests__/public-discovery.test.ts
pnpm --filter @omnitwin/api exec vitest run src/__tests__/public-mcp.test.ts
# Privacy against migrated PostgreSQL (disposable 127.0.0.1:55477 only).
VENVIEWER_PLATFORM_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55477/venviewer_platform_test \
  pnpm --filter @omnitwin/api test:platform-db
# The forward-book record: migration, access, routes and the public read
# (a disposable loopback database named venviewer_forward_book_test).
VENVIEWER_FORWARD_BOOK_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55476/venviewer_forward_book_test \
  pnpm --filter @omnitwin/api exec vitest run src/__tests__/forward-book-postgres.test.ts

# Live, after deployment.
curl -s https://api.venviewer.com/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
npx @modelcontextprotocol/inspector@2.10.1 --cli https://api.venviewer.com/mcp \
  --transport http --protocol-era modern --method tools/call --tool-name check_availability \
  --tool-arg from=2027-06-01 --tool-arg to=2027-06-30
curl -s https://venviewer.com/ | grep -c 'application/ld+json'
```
