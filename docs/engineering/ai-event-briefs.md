# Typed event briefs through Claude, and their evaluation (T-650)

The Event Architect is the deterministic half of a proven pattern: a language
model turns a free-text brief into typed constraints, a deterministic engine
places the furniture, the validators prove the result, and the model reads and
explains rather than computes. T-650 adds the language half. This note records
how it works and where its guarantees live.

## The provider

Claude is called through `AnthropicAIGenerationAdapter`
(`packages/api/src/services/anthropic-draft-adapter.ts`), added for proposal
drafts by T-646 and selected by `AI_ASSISTANT_PROVIDER=anthropic` with
`AI_ASSISTANT_MODEL` and `AI_ASSISTANT_API_KEY` (no base URL is required; an
optional `AI_ASSISTANT_WORKSPACE_ID` serves Console keys not scoped to one
workspace). Any other provider name is the bespoke HTTP gateway
(`HttpAIGenerationAdapter`), unchanged; with AI off or the environment
incomplete, `DisabledAIGenerationAdapter` answers.

T-650 adds `generateStructured` to the Anthropic adapter. It sends
`output_config: { effort: "medium", format: { type: "json_schema", schema } }`
(structured outputs) with the rules as the system prompt and the request in the
user turn, through the same `client.beta.messages.create` call, `max_tokens`
16000 and, for models that accept it, the server-side refusal fallback
(`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Thinking is
left adaptive; sampling parameters are not sent. A refusal, a cut-off answer,
an empty answer or one that is not JSON is an `AIDraftNotProducedError`, as
for drafts; SDK errors pass through. Its send takes an abort signal, and the
default client pins its log level to `warn` so an environment debug level
cannot log request bodies. Errors carry a status, reason or contract paths,
never the description.

Only the Anthropic provider reads briefs:
`createAIStructuredGenerationAdapterFromEnv` returns it, or a disabled reader
that says "Reading event briefs needs the Anthropic provider" when the gateway
is configured. The routes fail exactly as for drafts: any provider failure is
502 `AI_DRAFT_GENERATION_FAILED`, and AI off is 503 `AI_ASSISTANT_DISABLED`.

**Model.** `RECOMMENDED_ANTHROPIC_MODEL` is `claude-opus-5-5`, the current
Opus. The eval script uses it unless `AI_ASSISTANT_MODEL` says otherwise.
Production reads `AI_ASSISTANT_MODEL`; set it to `claude-opus-5-5`. The SDK
honours its own `ANTHROPIC_BASE_URL`, which the local UI check pointed at a
stub; leave it unset in production.

## Typed event briefs

`POST /event-architect/brief-drafts` takes `{ venueId, spaceId, description }`
(description ≤ 4,000 characters) and answers an `EventBriefDraft`. It shares
`requireArchitectAccess` with `POST /runs`: the venue floor (admin, manager,
staff, hallkeeper) at its own venue, or a platform admin. `GET
/event-architect/brief-drafts/status` returns the reader's `AIAssistantStatus`;
the page shows "Describe the event" only when it says `configured`, and a 503
`AI_ASSISTANT_DISABLED` hides it for the visit. Only the Anthropic provider
reads briefs; with the gateway configured, the status says why it is off.

The flow (`services/event-brief-draft.ts`):

1. The room is loaded at its own venue (name and seed dimensions).
2. The description is scrubbed with X1's scrubber (`scrubContactDetails`):
   email addresses and phone numbers become `(email address)` and
   `(phone number)` before anything is sent. It goes to Claude as data inside
   `<description>` … `</description>`; a closing tag typed into it (any case
   or spacing) gets a zero-width space after its `<`
   (`neutraliseDescriptionTag`) so it cannot end that block early. Nothing
   else is escaped: "bride & groom" is sent as written.
3. Claude answers in `EVENT_BRIEF_ANSWER_SCHEMA` through structured outputs
   (`output_config.format`, JSON Schema). Every object is closed and every key
   required; a test keeps the schema and `EventBriefExtractionSchema` in step.
4. `interpretEventBriefExtraction` (`@omnitwin/types`) Zod-validates the answer
   and checks it against the engine's own bounds.

The contract (`packages/types/src/event-brief-draft.ts`):

- Each field comes back as `{ value, source: stated | inferred | absent, words,
  basis }`. A value Claude inferred, or claimed to read in words that are not in
  the description, becomes an **assumption** with the planner's words and the
  reason.
- Anything the engine cannot represent is an **unsupported** item with the
  planner's own words (`verbatim` says whether they were found as written), a
  kind (`not_modelled`, `layout_style`, `service_style`, `beyond_limits`,
  `needs_exact_value`, `other_room`, `other`) and a plain explanation.
- Quotes are checked against the scrubbed description as written, ignoring
  case, spacing, quote and dash styles and zero-width characters. A quote that
  takes in any part of a closing `</description>` tag is never the planner's
  own words, whether or not Claude copied the neutraliser: its item is not
  verbatim, and a value "stated" in it becomes an assumption.
- **Never clamped.** A guest count outside 1–300, a negative budget, a month
  for a date, a loose time, or a layout or service the engine does not offer
  leaves the field unset and becomes an unsupported item, added
  deterministically if Claude did not list it. A field held back this way is
  never kept beside its unsupported item (enforced by the schema).
- Model-written wording passes the claim guard (`safePlanningLanguage`); the
  planner's quoted words are left as written.
- The draft is `humanReviewRequired: true`, `provenance: "ai_generated"`,
  `evidenceStatus: "unverified"`, `runState: "not_run"`. Nothing is stored and
  nothing runs.

On the page (`components/event-architect/EventBriefReader.tsx`), the preview
shows every field editable, marks inferred values "Assumed" until the planner
changes them, lists the assumptions and the requests not carried into the plan,
and needs an explicit "Fill the request form". The unsupported list stays in
view after filling. The existing Generate flow then runs the engine and the
validators. Stop aborts the browser request; the route aborts the provider
request when the client goes away.

## Evaluation

`packages/api/src/evals/event-brief-cases.ts` holds 21 synthetic Trades Hall
briefs (weddings, dinners, conferences, a lecture, awards, a board meeting, a
standing reception, "about 120-ish", "black tie for 350", exactly 300, 301, a
range, a date without a year, contact details, instructions inside the text,
two layouts in one day, another room). Each lists the fields a careful reader
would agree on (undefined fields are not scored), the words that must appear in
unsupported items, and the fields that must be declared assumptions.

Run it only by hand, with a key set for that shell:

```powershell
$env:AI_ASSISTANT_API_KEY = '<key>'   # never commit or print it
pnpm --filter @omnitwin/api eval:event-briefs            # all cases
pnpm --filter @omnitwin/api eval:event-briefs one-over   # named cases
Remove-Item Env:AI_ASSISTANT_API_KEY
```

It refuses to run when `CI` is set or no key is present (exit 2), reads the
cases one at a time through the real provider and prints per-field accuracy,
unsupported-item recall, assumption recall and the contact-detail check. Each
run makes 21 paid calls.

Unit tests replace only the SDK's HTTP boundary (`fetch`), so request shape,
SDK error classes and abort are the SDK's own; they do not prove the live
integration. Only the eval script against a real key, and a signed-in live
check, do. The proposal-draft path has its own live evaluation
(`eval:proposal-drafts`, T-646).
