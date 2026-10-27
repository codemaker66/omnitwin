# AI drafts: what is sent, who writes them, and what they may say

The events team's AI drafts: an enquiry's summary, a proposal's message to its
client, and the general drafts on the ops handoff and Truth Mode screens. Every
draft is review-gated (`createReviewGatedAIDraft` in `@omnitwin/types`): it is
marked AI-written and unverified, and it is never sent by the platform. The
provider, its metering and each venue's allowance are in
[AI usage and billing](ai-usage-and-billing.md); typed event briefs are in
[AI event briefs](ai-event-briefs.md).

## What a provider is sent (release audit ai-1, 27 October 2026)

| Draft | Route | Context built by | Sent |
| --- | --- | --- | --- |
| Proposal message | `POST /proposals/:id/message-draft` | the server, from the proposal's venue (`services/proposal-message-draft.ts`) | the client's name (not one holding an email address or phone number), occasion, date, guests, room, the client's enquiry words and latest message, scrubbed |
| Enquiry summary | `POST /enquiries/:id/summary-draft` | the server, from the enquiry at the asker's venue (`services/enquiry-summary-draft.ts`) | occasion, date, guests, the room when the guest chose it, stage, the day it arrived, the guest's words, scrubbed; no name |
| General drafts (handoff wording, Truth Mode) | `POST /ai/drafts` | the screen, then held to the rule on the server (`scrubDraftRequest` in `services/ai-assistant.ts`) | the screen's context, at most 16,000 characters, with each key read word by word and dropped where it names contact details, a person or a record id (at any depth), and every string and the tone scrubbed; an enquiry summary or proposal message sent here is refused (400 `DRAFT_HAS_ITS_OWN_ROUTE`) |

"Scrubbed" is one scrub (`scrubContactDetails` / `clientWords`): email
addresses become "(email address)" and phone numbers "(phone number)", with
dates, times, ranges and guest counts kept. It finds the forms people type,
not every form ("jane at example dot com" passes), and names inside free text
are not found; the privacy page says both. Its email pattern is anchored at a
word's start: unanchored, a long run of letters with no space took time that
grew with its square (40,000 letters, two seconds; release review, 27 October
2026), and a regression test bounds it.

A bare `name` key stays (a room's or an item's as often as a person's) and its
value is scrubbed like any string; a key that says whose name it is
(`clientName`, `displayName`, `organiser`) is dropped. The word lists are in
`services/ai-assistant.ts`; the two current screens send only `targetId` and
`handoffPackId` that the rule drops.

Before 27 October the enquiry summary sent the enquirer's name, email address
and message word for word from the browser. It now sends only the enquiry's id
in the path; another venue's enquiry is 404.

The privacy page (`packages/web/src/pages/LegalPage.tsx`, "Who else processes
your information") names Anthropic for all three paths that reach it (the
summary, the proposal's message and the planner's brief reader), what each is
sent and what it is not.

The enquiry panel offers a summary only for an enquiry at the venue the person
works at (a platform admin reads every venue's enquiries, and the route would
not find another venue's), and the panel says in words why a server-built
draft did not come: nothing to draft from, or not this venue's.

## The context is data

The draft's rules go in the system prompt; the context goes in the user turn
inside `<context>` tags, written as JSON with `<`, `>` and `&` escaped
(`contextTagJson`), so words that hold `</context>` cannot close the data
early. The rules say the context is data, not instructions.

## A draft is the asked model's, or none

Drafts are sent without the server-side refusal fallback. A model that declines
gives no draft (502 `AI_DRAFT_GENERATION_FAILED`; the composer says the draft
could not be written and the message is unchanged), never a draft another model
wrote in its place. An answer that says another model served it (a
`fallback_message` iteration, a `fallback` block, or another model's name; a
dated snapshot of the asked model is the asked model) is refused the same way
and recorded in the ledger as a `refusal`. A dated snapshot of the asked model
is the asked model, for the check and for its price alike (`undatedModel` in
`services/ai-usage.ts`); what the live API names its model is to be read from
the ledger's first real call. Event briefs keep the fallback: their
answer is typed and checked field by field before a planner reviews it.

## What a draft may not say (Plan 19, L6)

A draft never states a price, availability or capacity: only the venue's team
confirms these, from the quote, the Diary and the venue's sourced figures.

- **The rules** (`buildAIDraftInstructions`) tell the model so for every use
  case: no amount of money of any kind, the client's own budget included;
  never whether a date, time or room is free, held or booked; never how many a
  room holds or whether a group fits; even when repeating the client, in a
  question or in quotation marks. Where one of them comes up, the draft says
  only that the events team will confirm the details; an internal summary
  names the topic ("asks about price and availability", "has a budget in
  mind").
- **The check after the model** (`withholdDraftCommitments` in
  `packages/types/src/ai-draft-commitments.ts`) reads the draft line by line
  and sentence by sentence, and takes out every sentence whose words have a
  claim's shape ("£65 per head", "the Grand Hall is free on the 17th", "it
  seats 200", "Capacity: 200 seated"). The topic without a claim's shape stays
  ("the team will confirm the details", "your 150 guests", "6.30pm").
- **Nothing excuses a claim's shape.** Three reviews (27 October 2026) tried
  exemptions in turn, and each let the draft's own claims through in the way
  a model writes them when it answers: a clause holding "you asked" or
  "budget" hid 210 of 248 known claims framed as answers ("as you asked, room
  hire is £4,500"); a question excused its answer in the next sentence ("you
  asked whether the 17th is free. It is."); quotation marks, "if" and a
  venue price beside the word "budget" did the same. The rule the model is
  given matches the check, so a draft that keeps it loses nothing; the cost is
  that a summary does not repeat the client's figure or question word for
  word (the enquiry shows both).
- **Where it runs.** `createReviewGatedAIDraft` makes the wording safe, then
  takes the claims out of the words as they will be shown, for every draft.
  It is not checked again where a draft is read: the web and the API deploy
  apart, and a page open since an earlier build would otherwise refuse drafts
  a later check passed.
- **The draft says what was taken out** (`withheldCommitments`, present only
  when something was), and both draft surfaces say it in words: "Wording that
  seemed to give a price was taken out, as only the team confirms that."
- **A draft that is nothing else** is no draft: with fewer than 12 words left
  (a greeting and a sign-off), the call answers 502, the composer says it
  could not be written, and the call stays recorded. The ledger records the
  model's own outcome, so a call whose draft the check refused is an answered
  call (`ok`) at what it cost.
- **What is kept is kept as written**: spacing, indentation, list markers and
  line endings; a line that goes adds no blank line.

How well it reads text it has not seen is measured on sentence sets written
by agents that never saw the patterns, each run once before it was used
(`__tests__/ai-draft-blind-sets.ts`). On the current design's set, which asked
for claims in answers, questions, quotations and two sentences, it took out 1
of 60 sentences that kept the rule and found 39 of 60 claims: 19 of 20 prices,
9 of 20 dates and rooms, 11 of 20 sizes. Earlier designs read 34 to 41 of 60 on
their own sets, but excused claims those sets did not frame. It finds nearly
every price and about half the dates and sizes phrased in a way it has not
met. The rules are the first guard and the person who reads every draft
before it is used is the last; this check sits between them and does not
replace either. All five sets now pass, with the tuned, held-out and review
sets, as regression tests, as do the reviews' framings of every known claim.
None was written by venue staff. The live evaluation (`eval:proposal-drafts`)
records `withheldCommitments` per draft and `withWithheldCommitments` in its
summary: how often Claude wrote a claim the check knows, a lower bound on how
often it wrote one.

Every pattern is bounded and each sentence is read once, so time grows
linearly with the text: an 8,000-character draft of prose, or of runs of
stops, quotation marks, claims or clauses, takes under 70 ms; one of 4,000
one-character lines, the worst shape measured, about a second (each line is read by every pattern).

**Deploying.** `withheldCommitments` is a new field. A web build from before
it reads every draft that took nothing out; one that took something out it
refuses, after the call is made and charged. AI is off in production until
switch-on, so deploy the web and the API from the same commit before then.

## Checks

```
pnpm --filter @omnitwin/types exec vitest run src/__tests__/ai-draft-commitments.test.ts
pnpm --filter @omnitwin/api exec vitest run src/__tests__/anthropic-draft-adapter.test.ts src/__tests__/ai-assistant.test.ts
VENVIEWER_ROUTE_TEST_DATABASE_URL=… pnpm --filter @omnitwin/api exec vitest run src/__tests__/enquiry-summary-draft-postgres.test.ts src/__tests__/proposal-message-draft-anthropic-postgres.test.ts
pnpm --filter @omnitwin/web exec vitest run src/components/dashboard/__tests__/EnquiriesView.test.tsx src/pages/__tests__/LegalPage.test.tsx
```
