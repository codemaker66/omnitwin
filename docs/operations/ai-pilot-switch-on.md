# AI drafts pilot: switch-on, narrowing and rollback (C1)

Written 5 November 2026 with the change that adds the per-venue allow list
(`AI_ASSISTANT_VENUE_IDS`), the per-draft switch (`AI_ASSISTANT_FEATURES`) and
the "AI drafts are unavailable" state. Code: `packages/api/src/services/ai-access.ts`,
`packages/api/src/env.ts`.

## What the variables do

| Variable | Value for the Trades Hall pilot | Notes |
|---|---|---|
| `AI_ASSISTANT_ENABLED` | `true` | The platform switch. Goes on last, off first. |
| `AI_ASSISTANT_PROVIDER` | `anthropic` | |
| `AI_ASSISTANT_MODEL` | `claude-opus-5-5` | Must be in the usage price table, or AI stays off with a reason. |
| `AI_ASSISTANT_API_KEY` | the Production org's `live-ai` workspace key | Blake pastes it in Railway himself. Never in chat, a file in the repo or a log. |
| `AI_ASSISTANT_VENUE_IDS` | `100c31e6-e146-4df8-92bc-f3633b316bbb` | Trades Hall Glasgow (`trades-hall-glasgow`), read from the public `GET /venues` on 5 Nov 2026. Comma-separated ids. There is no "every venue" value. |
| `AI_ASSISTANT_FEATURES` | `proposal_draft,enquiry_summary,event_brief` | The three pilot drafts. `beo_supplier_instruction_draft`, `truth_mode_explanation`, `route_conflict_explanation` and `lead_qualification` stay off by being left out. |
| `AI_VENUE_MONTHLY_BUDGET_USD` | `20` (proposed; Blake decides) | Unset, it is $50 per venue per UTC month. Keep it below the Console workspace limit ($30 proposed) so the app's own cap is reached first. |

**The boot rule.** With `AI_ASSISTANT_ENABLED=true`, the API refuses to start
unless `AI_ASSISTANT_PROVIDER`, `AI_ASSISTANT_MODEL`, `AI_ASSISTANT_API_KEY`,
`AI_ASSISTANT_VENUE_IDS` and `AI_ASSISTANT_FEATURES` are all set (and
`AI_ASSISTANT_BASE_URL` for a provider other than `anthropic`). A list that is
empty, names something that is not a venue id, or names a draft that does not
exist also stops it. Railway then keeps the previous container serving and marks
the new deployment failed; every later API deploy fails the same way until the
variables are fixed. So every change below is ordered to keep the API bootable
at each step.

## A. The deploy of this change, while production already has AI on

As of 5 Nov 2026 09:22 production has `AI_ASSISTANT_ENABLED=true` with
provider, model and key, and no allow list (Blake's decision, 5 Nov: keep it on).
The code before this change ignores the two new variables; the code after it
needs them. So:

1. **Before the PR merges**, add to the `@omnitwin/api` service, production
   environment, in Railway: `AI_ASSISTANT_VENUE_IDS` and `AI_ASSISTANT_FEATURES`
   with the values above (and `AI_VENUE_MONTHLY_BUDGET_USD=20` if Blake agrees).
   Railway redeploys the running code with them; it ignores them. Check
   `/health/ready` answers 200.
2. Merge the PR. Railway builds and deploys it on the master push.
3. Check, in order:
   - `GET https://api.venviewer.com/health/ready` answers 200 and the Railway
     deployment for the merge commit is ACTIVE (not FAILED).
   - Signed in as a Trades Hall manager: `GET /ai/status?feature=proposal_draft`
     answers `configured: true`; `GET /ai/status?feature=beo_supplier_instruction_draft`
     answers `configured: false` with "This AI draft is not switched on."
   - `GET /event-architect/brief-drafts/status?venueId=<Trades Hall id>` answers `configured: true`.
   - In the app: the BEO wording and Truth Mode draft panels no longer show.
4. If step 3's first check fails, the deployment log names the variable; fix it
   in Railway and redeploy. Do not revert the code to get round it.

## B. Switching on from off (any later time)

1. While `AI_ASSISTANT_ENABLED` is `false` (or unset), set the key, provider,
   model, venue list, draft list and budget. Each is ignored while AI is off,
   and a malformed list stops the boot now, not at switch-on, so a mistake
   shows while it is harmless.
2. Check `/health/ready` answers 200.
3. Set `AI_ASSISTANT_ENABLED=true` last.
4. Check `/health/ready`, then the status checks in A.3.
5. Change `/platform` copy only if the shipped copy no longer matches (it says
   "In use at one venue · Staff-only and optional").

## C. Adding a venue or a draft

Add it to the list in Railway; the API redeploys with it. A venue is added
only once that venue's data controller has agreed to Anthropic as a
sub-processor and its privacy notice names it.

## D. Rollback

- **Everything off:** set `AI_ASSISTANT_ENABLED=false`. Nothing else needs to
  change; the lists and key are ignored while it is off. Every AI control
  disappears from the app; staff write by hand as before.
- **One draft off:** remove it from `AI_ASSISTANT_FEATURES` (keep at least one,
  or switch everything off).
- **One venue off:** remove it from `AI_ASSISTANT_VENUE_IDS` (same rule).

## E. When the credit runs out or the grant renews

The provider answers "credit balance is too low", a spend-limit message or a
402. The API answers 503 `AI_DRAFTS_UNAVAILABLE`, and staff see "AI drafts are
unavailable just now. Write this one by hand; drafts return on their own." The
call is still recorded in the AI usage ledger. Nothing needs to be done: drafts
return when the next grant lands. No card is on the Production org, by Blake's
decision on 5 Nov 2026. A venue's own allowance running out is different: 429
`AI_BUDGET_REACHED`, reset at the start of the UTC month.

## Checks each month

- The AI usage ledger's Production total against the Console's usage for the
  `live-ai` workspace.
- Staff note editing time and corrections on the first 20 drafts (the keep or
  kill test in the credit plan, section C1).
