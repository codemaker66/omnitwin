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

## Checks

```
pnpm --filter @omnitwin/api exec vitest run src/__tests__/anthropic-draft-adapter.test.ts src/__tests__/ai-assistant.test.ts
VENVIEWER_ROUTE_TEST_DATABASE_URL=… pnpm --filter @omnitwin/api exec vitest run src/__tests__/enquiry-summary-draft-postgres.test.ts src/__tests__/proposal-message-draft-anthropic-postgres.test.ts
pnpm --filter @omnitwin/web exec vitest run src/components/dashboard/__tests__/EnquiriesView.test.tsx src/pages/__tests__/LegalPage.test.tsx
```
