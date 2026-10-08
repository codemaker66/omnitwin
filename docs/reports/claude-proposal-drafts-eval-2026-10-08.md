# Claude in the proposal message draft — first live evaluation

8 October 2026 · T-646 · `claude-opus-5-5` through `@anthropic-ai/sdk` 0.131.0

## What was run

`packages/api/src/scripts/eval-proposal-drafts.ts` drafts a proposal message
for 12 made-up enquiries through the production path: the context fields and
client-word scrubbing of `services/proposal-message-draft.ts`, the Anthropic
adapter (`services/anthropic-draft-adapter.ts`), and the claim guard and review
gate of `generateAIDraft`. No venue or client data was used.

The cases cover a full wedding, a day conference with timings, a missing date,
a missing guest count, a direct price-and-availability question, prompt
injection in the enquiry and in the client's latest message, a room and
numbers change, an accessibility question, an enquiry carrying a phone number
and email address, a bare follow-up, and an unnamed client.

Each draft is checked by rule (numbers not in the context; subject line,
markdown, bracket placeholders, draft banners, added weekdays and ISO dates)
and graded by a separate Claude call against the context (faithful, confirms
the unconfirmed, follows injected instructions, answers the client). The
grader is a second opinion, not ground truth. The drafts were also read in
full by the developing agent; no venue staff have reviewed them.

Cost uses Claude Opus 5.5 list prices ($4 / $20 per million input / output
tokens) on the measured usage of the drafting call only, not the grader.

## Results by round

| Round | Prompt change | Faithful (grader) | Confirms unconfirmed | Follows injection | Format issues | Median / max latency | Mean cost per draft |
|---|---|---|---|---|---|---|---|
| 1 | as shipped in X1 | 12/12 | 0 | 0 | 12/12 | 8.1 s / 9.4 s | $0.0130 |
| 2 | plain text only; no subject, markdown, placeholders or banner; dates as given | 10/12 | 0 | 0 | 0/12 (ISO dates not yet checked) | 5.9 s / 14.6 s | $0.0100 |
| 3 | dates in words, no weekday; no unstated policy, terms or timing | 12/12 | 0 | 0 | 0/12 | 5.2 s / 7.1 s | $0.0096 |

Round 1's format issues were markdown (12), subject lines (11), draft banners
(9), added weekdays (9) and a `[Name]`/`[Venue name]` placeholder (1): the
composer pastes the draft into a plain-text message as written, so each would
have reached the client unless staff removed it. Round 1's two rule flags for
numbers were a reformatted time ("0830" as "08:30") and list numbering; the
check was corrected before round 2. Round 2's two grader findings were an
assumed evening and an unstated "nothing is held until confirmed in writing"
policy; round 2 also pasted ISO dates ("2027-09-17") into the message.

## Reading the round 3 drafts

Both injection attempts were declined in the client's terms without obeying
them. Price and availability were deferred, never stated. The accessibility
reply offered to confirm the route and facilities and a visit rather than
describing either. Two small points a reviewer would still edit: the drinks
reception draft refers to "the evening", which the client never said, and the
accessibility draft opens "We'd be glad to host…", warmer than a
non-confirmation should read. Twelve synthetic cases are a smoke test of the
integration and its guard rails, not a measure of accuracy on real enquiries.

## Next

Run on real enquiries with the venue's team before switching drafting on:
factual accuracy, staff corrections, editing time against manual drafting,
latency and cost per enquiry. Drafting is off unless `AI_ASSISTANT_ENABLED`
is `true` (the production value was not inspected for this record); switching
it on for Claude needs `AI_ASSISTANT_PROVIDER=anthropic`, a model and a key,
and the privacy notice should name Anthropic as a processor of the enquiry
text sent.

Raw results (drafts, grades, usage): `D:\claude\claude-startups\eval-2026-10-08`,
`-v2` and `-v3` on the build machine, outside Git.
