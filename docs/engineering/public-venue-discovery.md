**Read this when:** changing what AI assistants or search engines can read about a venue, the `/mcp` endpoint, the public free/busy rule, or the front door's schema.org description.

# Public venue discovery for AI assistants (T-649)

## The decision

Blake, 8 October 2026, asked "Should AI assistants like Claude and ChatGPT be
able to find and query Trades Hall?", chose **"Yes, read-only"**:

> Public: venue facts, room capacities from venue records, and free/busy dates only (no client names). Enquiries still go through staff.

This authorises exactly that exposure despite the general public WIP hold.
Nothing beyond it is exposed: no prices, no booking details, no counts, no
holds, no submissions.

## What is public

| Surface | Where | Source |
| --- | --- | --- |
| MCP server (read-only) | `https://api.venviewer.com/mcp` | `packages/api/src/routes/public-mcp.ts`, `services/public-discovery.ts` |
| schema.org `EventVenue` JSON-LD | the HTML of `https://venviewer.com/` (every route serves the same index.html) | `packages/web/src/lib/venue-structured-data.ts`, written by `venue-structured-data-plugin.ts` |
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
  call, today through 730 days ahead) and optional `room` slug. Returns, per
  room per date, `"free"` or `"busy"` and nothing else.
- **`how_to_enquire`** — the enquiry composer (`https://venviewer.com/#enquire`),
  what to include, and the venue's published telephone, email and website.
  It cannot submit an enquiry, place a hold or book.

### What "busy" means — the decision recorded

The Diary's hard floor (Canon §2.2) is the `bookings_ink_no_overlap`
exclusion constraint: an active, non-deleted **confirmed** (`ink`) booking. It
is also the conflict engine's only `blocking` severity. Public busy is
`ROOM_BLOCKING_BOOKING_KINDS` in `packages/types/src/booking.ts`:

- `ink` (confirmed), active, not deleted — busy.
- `internal_block` (the venue's own closure: maintenance, blackouts), active,
  not deleted — busy. The schema defines it as venue-generated unavailability;
  calling a closed room "free" would send enquirers to a date the venue has
  shut. The conflict engine ignores blocks only because it compares bookings
  with each other.
- **Provisional holds do not make a date busy.** Holds stack as 1st/2nd
  options by design, a later enquirer can still take the next option, and the
  engine rates hold overlaps advisory. The tool says so: "free" can still carry
  a provisional option, and the venue team confirms availability on enquiry.
  This also keeps the sales pipeline private.
- Prospects, and every exited (`cancelled`, `released`, `expired`, `lost`) or
  soft-deleted row — free.

**Dates are the venue's operational day**, 04:00 to 04:00 Europe/London, as
the Diary's day view counts it (`routes/room-layout-timeline.ts`). An evening
that runs past midnight belongs to the date it started on, so a Friday party
ending at 01:00 does not mark Saturday busy. Days are 23 or 25 hours across
clock changes (`venueDayWindow`, built on the shared venue-clock helpers). The
brief said "calendar day"; this is the Diary's own definition of a day, and it
is one constant (`VENUE_DAY_START_MINUTE`) if Blake prefers midnight.

## Privacy guarantees and how they are enforced

- **Query shape.** The busy read selects only `space_id, starts_at, ends_at`
  from `bookings` filtered by venue, kind, status and `deleted_at`. No title,
  client, event, owner, note, status or count can reach a response because none
  is selected. Output carries dates and `free`/`busy` only.
- **Allowlist.** `PUBLIC_DISCOVERY_VENUES` (code, by DATABASE slug) holds only
  Trades Hall Glasgow. The tool schema's `venue` enum admits nothing else, so a
  second tenant's slug or id gets the same validation error as a name that
  does not exist; the service checks the allowlist again before any query.
  Adding a venue is a reviewed code change with that venue's consent.
- **Tests.** `public-mcp-postgres.test.ts` (platform PostgreSQL gate) seeds
  distinctive client, event, title, notes, next-action, owner and enquiry
  strings plus a second tenant, drives every tool through the official MCP
  client in both protocol eras, and asserts no response body contains any of
  them, any private id, or any booking instant. It also proves the blocking
  rule (cancelled, deleted, released, provisional and prospect rows free), the
  autumn 2026 and spring 2027 boundaries, and non-discovery by slug or id.
  `public-discovery.test.ts` and `public-mcp.test.ts` cover the rule, DST
  windows, bounds, caching, Origin policy and transport. The JSON-LD test
  proves every string in it comes from the published profile.
- **Errors.** Tool failures return a plain sentence; logs record an event name
  and a truncated error message, never a request body.

## Transport, cost and abuse limits

- MCP protocol **2026-07-28** (stateless; no `initialize`, `server/discover`
  instead) via `@modelcontextprotocol/server` 2.3.1 `createMcpHandler`, which
  also serves 2025-era clients statelessly from the same per-request factory.
  No sessions: `GET`/`DELETE /mcp` answer 405. Responses are JSON
  (`responseMode: "json"`) for 2026 clients; no list-changed notifications are
  advertised, so a `subscriptions/listen` is acknowledged and closed at once.
  Every response is finite and passes through the API's own hooks (security
  headers, compression, request id, metrics).
- Per-IP rate limit **120/minute** on `/mcp` (the shared limiter; AI assistants
  call from shared cloud addresses, and reads are cached). Bodies over 64 KiB
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
   "Is the Grand Hall free on Saturdays in June 2027?".

Any client that speaks remote Streamable HTTP MCP uses the same URL.

## Checks

```bash
# Unit and route tests (one file per command on this PC).
pnpm --filter @omnitwin/api exec vitest run src/__tests__/public-discovery.test.ts
pnpm --filter @omnitwin/api exec vitest run src/__tests__/public-mcp.test.ts
# Privacy against migrated PostgreSQL (disposable 127.0.0.1:55477 only).
VENVIEWER_PLATFORM_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55477/venviewer_platform_test \
  pnpm --filter @omnitwin/api test:platform-db

# Live, after deployment.
curl -s https://api.venviewer.com/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
npx @modelcontextprotocol/inspector@2.10.1 --cli https://api.venviewer.com/mcp \
  --transport http --protocol-era modern --method tools/call --tool-name check_availability \
  --tool-arg from=2027-06-01 --tool-arg to=2027-06-30
curl -s https://venviewer.com/ | grep -c 'application/ld+json'
```
