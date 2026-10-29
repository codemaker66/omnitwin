# AI usage, its cost, and each venue's monthly allowance (T-656)

Blake, 13 October 2026: "if this is going to actively bill us for claude then
we need to work out a way for us to bill our clients on the features that need
to use claude's abilities, or work out a way where we don't need to call the
api, or something else."

How Venviewer charges for AI is Blake's decision. This work provides two things
every option needs:

- every Claude call is recorded against the venue and the feature it served,
  with its exact cost;
- no venue can spend more than an allowance a month.

The code is in `packages/api/src/services/ai-usage.ts`, the
`*_ai_usage_ledger.sql` migration and `routes/ai-usage.ts`.

## What is recorded

`ai_usage_ledger` has one row for each model call, and one for each call the
allowance refused. It records:

- the venue and the person who asked (their user id);
- the feature;
- the provider;
- the model asked for and the model that answered (a fallback's after a
  refusal);
- the provider's request id;
- four token counts: input, output, cache writes and cache reads;
- how the call ended;
- the cost in whole micro-US-dollars, with the price-table version that priced
  it;
- `attempts`, a per-attempt record.

A row holds no prompt or answer text, and no names or contact details.

The table is append-only: triggers refuse any update, delete or truncate. Its
keys stop a venue or person who has usage from being deleted (both are
soft-deleted in practice).

| Outcome | Meaning |
| --- | --- |
| `ok` | an answer the route could use |
| `refusal` | Claude declined (after any fallback), or another model than the one asked wrote a draft, which is then not passed on |
| `max_tokens` | cut off before it finished |
| `error` | the provider failed, or the answer was unusable |
| `budget_blocked` | refused by the allowance; nothing was sent, so no tokens and no cost (a check constraint enforces this) |

The features are the six general drafts (`enquiry_summary`,
`lead_qualification`, `proposal_draft`, `beo_supplier_instruction_draft`,
`route_conflict_explanation`, `truth_mode_explanation`) and `event_brief`.

The proposal composer's "Draft the message with AI" records as
`proposal_draft`.

Each call also writes one structured log line: event `ai_usage`, with the
feature, the model requested and served, the outcome, the venue id, the request
id, the four token counts, the cost and the table version. It never includes
prompt text, the person, or a key. Four other events can appear:

- a refused call logs a warning with the month's spend, the amount held, the
  reservation and the limit;
- `ai_usage_unpriced_model` warns when the model that answered is not in the
  price table;
- `ai_usage_estimated` warns when a call went to a provider that reports no
  usage and was charged an estimate (see below);
- `ai_usage_record_failed` is an error when a row could not be written. It logs
  every field the row would have held.

## Pricing

`ANTHROPIC_PRICE_TABLE` holds Anthropic's first-party prices, read on
13 October 2026 from the pricing page. Its version is `anthropic-2026-10-13`.
Rates are US dollars per million tokens.

| Model | Input | 5-min cache write | 1-hour cache write | Cache read | Output |
| --- | --- | --- | --- | --- | --- |
| Claude Fable 5.1 | 10 | 12.50 | 20 | 0.25 | 50 |
| Claude Opus 5.5 | 4 | 5 | 8 | 0.20 | 20 |
| Claude Opus 5, Opus 4.8 | 5 | 6.25 | 10 | 0.50 | 25 |
| Claude Sonnet 5.5 | 2 | 2.50 | 4 | 0.10 | 10 |
| Claude Sonnet 5 | 2 | 2.50 | 4 | 0.20 | 10 |
| Claude Haiku 5.5 | 0.10 | 0.125 | 0.20 | 0.01 | 0.50 |
| Claude Haiku 5.5, prompt over 100,000 tokens | 0.50 | 0.625 | 1 | 0.05 | 2.50 |

**Sonnet 5.5 cache reads.** The claude-api skill lists them at $0.20. The
pricing page says $0.10 (0.05 times input, as for Opus 5.5), and the table
uses the page. The difference matters only if the platform is set to
Sonnet 5.5.

**How a call is priced:**

- When the response has `usage.iterations`, each attempt is priced at its own
  model's rates: a declined attempt is a `message`, and the fallback that
  answered is a `fallback_message`. Top-level `usage` covers only the attempt
  that answered, so it is used only when there are no iterations.
- One-hour and five-minute cache writes are priced apart.
- A Haiku 5.5 prompt over 100,000 tokens, counting cache reads and writes,
  takes the higher card.
- Each attempt is rounded up to the next whole micro-dollar.

**Refusals.**

- A call's final refusal, before any output, is free unless its
  `stop_details.category` is one Anthropic bills (`bio`, `frontier_llm`,
  `reasoning_extraction`). This includes a refusal with no category.
- In a fallback chain, every declined attempt before the last is charged. The
  response names only the final refusal's category, so the earlier ones are
  charged, which is the safe side.
- A refusal that came after output began is billed.

**Models without a price.**

- A model that answers but is not in the table is priced at the table's highest
  rates, and logged.
- If the configured model has no price, AI drafts are off at startup, with the
  disabled reason "AI drafts are off: X has no price in the usage table, so its
  cost cannot be held to a venue's allowance."

**A provider that reports no usage.** The bespoke HTTP gateway is any
`AI_ASSISTANT_PROVIDER` other than `anthropic`; it answers only text. It is
held to the same allowance on the safe side:

- each call reserves the request body's bytes plus the 4,096 framing tokens at
  the table's dearest input-side rate ($20 per million, Fable 5.1's 1-hour
  cache write), and 16,000 output tokens at its dearest output rate ($50) —
  about $0.90 for a short draft (`reserveForUnreportedRequest`);
- the call is recorded at that whole reservation however it ended, an error
  included, because the gateway may have spent before it failed;
- the row's token columns are 0 (unknown, not none), and its one attempt says
  `priced: "estimate"`; each such call also logs `ai_usage_estimated`.

So with the default $50 a venue gets about 55 gateway calls a month. The
summary's costs include these estimates; the rows say which they are.

**Multipliers not applied.** The adapter sends no `inference_geo` (the US-only
1.1x), no fast mode and no batch request, so none of their multipliers apply.

**When a rate changes,** edit the table and change `version`. Old rows keep the
version that priced them and are never rewritten. Each row stores its token
counts, so any month can be repriced later.

## The allowance

`AI_VENUE_MONTHLY_BUDGET_USD` is each venue's allowance for a UTC calendar
month (on the database's clock), in US dollars.

- Valid values are 0.01 to 100,000. The default is $50.
- Anything else (a word, zero, Infinity, over 100,000) stops the API at boot,
  so it never runs unbounded.
- `AI_ASSISTANT_ENABLED` is still the global switch. With AI off, nothing is
  reserved or recorded.

**Before every call,** the adapter reserves the call's worst-case cost.
`PostgresAIUsageMeter.hold` does this in one transaction under
`pg_advisory_xact_lock(hashtextextended('ai-usage:' || venue_id, 0))`:

1. Deletes the venue's lapsed reservations.
2. Sums this month's recorded cost and the unexpired reservations.
3. If spent + held + this reservation is more than the allowance, writes a
   `budget_blocked` row and throws `AIBudgetReachedError`. Nothing is sent, and
   the route answers 429 `{ code: "AI_BUDGET_REACHED", error: "This venue's AI
   allowance for the month is used" }`.
4. Otherwise inserts a reservation that lapses after ten minutes.

**After the call,** `settle` writes the ledger row and deletes the reservation
in one transaction. It never throws: the person still gets the answer, and a
failed write is logged as above. A second `settle` is ignored.

**The worst case** is the most the request could cost:

- input: the request's own bytes (system, messages, output format, tools) plus
  4,096 tokens of framing, since no token is shorter than a byte, priced at the
  dearest input-side rate (fresh input or either cache write);
- output: `max_tokens` (16,000) at the output rate;
- fallback: when the request carries the server-side fallback, a second attempt
  at the dearest rates among that model's fallback models. Only event briefs
  carry it: a draft is written by the model asked or not at all (27 October
  2026), so a draft is reserved as one attempt.

At Claude Opus 5.5 this is about $0.36 for a draft and $1 for a brief. Real
calls cost cents: the 8 October proposal-draft evaluation measured a mean of
$0.0096–$0.0130 a draft
([report](../reports/claude-proposal-drafts-eval-2026-10-08.md)). Event briefs
have not been measured live.

### The bound, and what can escape it

The advisory lock makes check-and-reserve one step across every API process.
Concurrent calls take turns, so they cannot all pass a check that only one
fits. Each reservation is an upper bound on its call. So at every decision,
recorded spend plus calls in flight stays within the allowance, and the
month's recorded spend never passes it.

The cost of a hard bound: a call needs room for its worst case, so the last
dollar or so of an allowance is never used.

What can still escape:

- **A call that fails in flight** (the 90-second timeout, a cancel, a lost
  connection, a 5xx after the provider did the work) is recorded with no
  tokens. The provider may still bill some. The SDK's default two retries make
  up to three attempts per call, so the worst unrecorded case is about three
  reservations.
- **A ledger write that fails after a call** is logged with everything it
  would have held. Its reservation keeps the money held until it lapses ten
  minutes later; after that the spend is unrecorded.
- **The server-side `default` fallback** (event briefs only) is reserved as one extra hop. If the
  API chained more, the ledger would still be exact (it prices
  `usage.iterations`), but the call could cost more than it reserved.
- **A wrong or stale price table** gives a wrong ledger. The stored tokens and
  version allow a reprice.
- **The gateway's true cost** is unknown. It is held by a charge, not a
  measurement: if its upstream ever spent more than 16,000 output tokens'
  worth at the dearest rates on one call, the ledger would understate it.

A call cannot outlive its ten-minute reservation: three 90-second attempts and
their backoff take about five minutes.

**The hard backstop is Anthropic's own workspace spend limit,** set in the
Claude Console for the workspace the key belongs to. The allowance bounds each
venue as the platform sees it; the workspace limit bounds what Anthropic will
bill whatever the platform does, so it covers every Claude escape above. (A
gateway's upstream needs its own provider's limit.) Setting it is on Blake's
list for switching AI on.

`ai-usage-postgres.test.ts` (the platform PostgreSQL gate) checks these
guarantees on a migrated database:

- the allowance at its micro-dollar boundary;
- 20 concurrent holds at a limit that fits five: exactly 5 held and 15 refused;
- a burst of 10 drafts through the real SDK with only `fetch` replaced: exactly
  3 sent and 7 refused;
- a lapsed reservation;
- a gateway with an 80-character provider name: each call charged its whole
  reservation and marked as an estimate, and the third refused unsent when the
  allowance fits two;
- append-only rows, exact costs and the log fields.

## Prompt caching

Claude Opus 5.5 caches a prefix only if it is at least 512 tokens (the
claude-api skill's model table). A shorter prefix silently never caches.
Writes cost 1.25 times input and reads 0.05 times. A cached prefix therefore
saves money only when more than about 21% of calls hit the cache within its
five minutes.

- **Event briefs: cached.** `EVENT_BRIEF_SYSTEM_PROMPT` is 3,903 characters,
  roughly 900–1,300 tokens. It goes as a system block with a five-minute
  `cache_control` breakpoint (`cacheSystem: true`). Everything that varies
  (the room, today's date, the description) is in the user turn after it.
- **Drafts: not cached.** Their rules are about 1,900 characters for a
  proposal message and under 1,000 for the others (27 October 2026, with the
  price, availability and capacity rule), below the minimum, so they
  carry no breakpoint.

The hit rate is unmeasured until a key is set. Once one is, the ledger's
`cache_read_input_tokens` and the usage summary show it.

## Reading usage

`GET /venues/:venueId/ai-usage?months=N` returns the venue's usage, newest
month first, for N from 1 to 24 (default 3). For each UTC month and feature it
gives:

- calls, and how they ended (`budget_blocked` is counted apart from calls);
- tokens, with cache writes and reads apart;
- cost in micro-dollars.

It also returns this month's allowance: limit, spent, held by calls in flight,
and remaining. The `currency` is `USD` and the response names the price-table
version.

The venue's own `admin` and `manager`, and platform admins, may read it
(`AI_USAGE_READ_ROLES` in `@omnitwin/types`, read by `canReadAIUsage`).
Everyone else gets 403 `FORBIDDEN`: staff, sales, hallkeeper, planner, client,
caterer, and any other venue's managers. An unknown venue is 404, and a bad
parameter or unknown query key is 400.

**The screen (Plan 19, L6, 27 October 2026):** Venue settings shows the
venue's admin and manager an "AI drafting" section
(`packages/web/src/components/dashboard/ai-usage/AIUsageSettings.tsx`): this
month's spend against the allowance, money set aside for drafts being
written, drafts the allowance refused, each feature's calls, unanswered calls
and cost, and the two months before. Costs show in US dollars as the ledger
records them, with a spend under a cent shown as "under US$0.01", never as
nothing. How usage is billed to venues still waits on Blake.

## Who may spend a venue's allowance

Every call is attributed to a venue, so only that venue's own people may make
one.

- **Proposal messages (X1):** the proposal's venue's commercial roles (admin,
  manager, staff, sales), or a platform admin. Unchanged.
- **Event briefs (T-650):** the venue floor (admin, manager, staff,
  hallkeeper) at its own venue, or a platform admin. Unchanged.
- **General drafts (`POST /ai/drafts`):** before T-656, any signed-in account
  could call this. It now needs the venue floor or commercial roles at the
  asker's own venue. Anyone else gets 403 `FORBIDDEN`: planner, client,
  caterer, an account with no venue, and a platform admin with no venue.

  The AI draft panel on the enquiry screen and the ops handoff screen
  (`/ops/handoff/:handoffPackId`) shows only to venue members with a venue
  (`canDraftWithAI` in `packages/web/src/lib/role-capabilities.ts`).

  This is option A, chosen in orchestration. Planners are external event
  planners, AI is off in production so no one lost a live feature, and
  customers should not spend a venue's allowance on a staff tool.

  Option B, left open for Blake, would let planners draft from their own
  enquiries and handoff packs. It needs a decision on whose allowance pays.

The composers treat 429 `AI_BUDGET_REACHED` like the server's own "AI is off":

- the proposal composer and the event-brief reader show their existing "not
  available now" wording and hide AI for the visit;
- the draft panel shows its existing failure line ("AI draft generation is
  unavailable. Continue with manual review.").

This needed no new design.

## What this makes possible

None of these is decided.

- Charge each venue its ledger cost, or cost plus a margin, by feature and
  month.
- Include an allowance in a plan and charge for what goes over it. This is
  already an `AI_VENUE_MONTHLY_BUDGET_USD` per deployment; a per-venue value
  would be a column.
- Use the per-feature counts to see where a deterministic path (templates,
  rules) could replace a call entirely.

## Operator scripts

`eval:proposal-drafts` and `eval:event-briefs` belong to no venue. They meter
with `TallyAIUsageMeter` (in memory, never the ledger) and print each run's
cost from the same price table. The event-brief run also prints its cache
reads.
