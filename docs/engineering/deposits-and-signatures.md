# Deposits and contract signatures (Plan 19 L5)

What happens after a client accepts a proposal: the venue asks for a deposit, which is paid on Stripe Checkout in
**test mode only**, and prepares a contract, which the client signs with a simple electronic signature
(Electronic Communications Act 2000 s.7). Built 27 October 2026 in PRs #269 (schema, gateway, webhook), #273
(deposit flow) and the two after it (contract signature; acceptance tests), then corrected after an independent
adversarial review the same day.

## Where it lives

| Piece | Code |
| --- | --- |
| Shared contracts | `packages/types/src/deposits.ts`, `contracts.ts` |
| Tables | `packages/api/drizzle/0103_deposits_and_signatures.sql`, `db/schema.ts` (`proposalDepositRequests`, `depositPayments`, `proposalContractVersions`, `proposalContractSignatures`); `stripe_events` (0018) is the webhook's idempotency log |
| Stripe boundary | `services/payments/deposit-gateway.ts` (the only code holding the key; stripe-node pinned), `stripe-mode.ts` |
| Webhook | `routes/stripe-webhook.ts` → `services/payments/deposit-events.ts` (parse, fold) → `deposit-ledger.ts` (once, under lock) |
| Deposit routes | `routes/deposits.ts`, `services/deposits.ts` |
| Contract routes | `routes/contracts.ts`, `services/contracts.ts`, `services/proposal-client.ts` |
| Web | `components/proposal/ClientDeposit.tsx`, `ClientContract.tsx` (share page); `components/dashboard/proposals/DepositPanel.tsx`, `ContractPanel.tsx` (desk); `pages/LegalPage.tsx` (privacy) |

## Invariants

- **Test mode only.** The API will not start with a `STRIPE_SECRET_KEY` that is not `sk_test_…` unless
  `STRIPE_LIVE_PAYMENTS_ALLOWED=true`. `depositPaymentsFrom` refuses such a key again, and so does a gateway reporting
  live mode. A refused deployment takes no payment: staff see deposits off, the client's routes answer 404, and the
  webhook answers 503. `deposit_payments.livemode` is CHECKed false, and live-mode webhook events are refused. Going
  live needs a migration, the flag, and Stripe Connect direct charges, because Venviewer never holds money.
- **Off unless configured.** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_DEPOSIT_VENUE_SLUG` must be set
  together. The slug names the one venue whose Stripe account the key belongs to; other venues offer no deposit.
- **The accepted version, never a later one.** Deposits and contracts read `proposals.sent_version` and its
  `proposal_versions.source_hash`, never `current_version`. A version a platform admin saves on an accepted proposal
  (the bypass in `routes/proposals.ts`) changes neither. A deposit request is checked against the accepted version
  again before Stripe is asked for anything; a mismatch is refused and the team is told.
- **Webhooks: once, in any order.** The `stripe_events` row is written in the effect's transaction. The payment row is
  held `FOR UPDATE`. Events fold into facts kept as lattice joins: the earliest paid, processing, failed and expired
  moments, the largest refund, and the latest decline with its words. The state is derived from those facts
  (`depositPaymentState`), so paid wins over any failure reported late. A payment Stripe reports at another amount or
  currency is `mismatch`, never paid.
- **Stripe decides whether a page was paid.** Our record can lag the webhook, so it is never asked alone:
  - Pay reopens a page that is still open for a while. A lapsing page is closed at Stripe
    (`closeCheckoutSession` asks Stripe first) before another is opened. If Stripe says it was paid, no second page
    is opened.
  - Withdrawing commits first, so no new page opens, then closes each open page at Stripe. Paid as withdrawn answers
    409 `DEPOSIT_PAID_AS_WITHDRAWN`, and the payment stays on record.
  - No database lock is held while Stripe is called.
- **Money held blocks the next request.** A request with a payment that is processing, paid or partly refunded
  cannot be withdrawn, and no new request is made on the proposal (`DEPOSIT_HELD`) until it is refunded in full.
- **The client always sees what they paid.** Their link shows the request in force, or else the latest withdrawn
  request that a payment settled on, read only (`payable: false`). An accepted proposal the team archived shows
  its deposit and contract read only.
- **No share token reaches Stripe.** Stripe keeps `success_url` and `cancel_url` and shows the way back on its page,
  so both are `/deposit-return?outcome=…`. The tab that left keeps the token in session storage and returns to the
  proposal once (`DepositReturnPage`).
- **Signatures are evidence and never change.** A contract version is generated from the accepted version, the
  addressed client's name and email, and the venue's terms. Its SHA-256 over canonical JSON is stored with it.
  Signing sends back the version and the hash the page showed; both must still be the latest. The record keeps the
  typed name, the email of record (named in the signed document), the time, the hash, the user agent, the statement
  word for word (the client sends back the statement it showed, and a changed one is refused), and the link's id
  and prefix. It keeps **no IP address**: the privacy page says so, and changing that needs the page changed first.
  A trigger refuses UPDATE, DELETE and TRUNCATE of versions and signatures. A change makes a new version. The page
  and the sign route ask the same question (`signable`), so the page never offers a signature the route refuses.
- **Paying or signing confirms nothing.** Accepted price, payment, signature and a confirmed booking remain separate
  states (goal 06). Neither flow touches the Diary.

## Checks

```
pnpm --filter @omnitwin/api exec vitest run src/__tests__/stripe-test-mode-lock.test.ts src/__tests__/deposit-events.test.ts
VENVIEWER_PAYMENTS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55476/venviewer_payments_test \
  pnpm --filter @omnitwin/api exec vitest run src/__tests__/stripe-webhook-postgres.test.ts src/__tests__/deposits-postgres.test.ts \
  src/__tests__/contract-signatures-postgres.test.ts src/__tests__/one-event-pain-points-postgres.test.ts
pnpm --filter @omnitwin/web exec playwright test e2e/proposal-deposit.spec.ts e2e/proposal-contract.spec.ts --workers 1
```

The Postgres suites accept only the loopback `venviewer_payments_test` database, which they migrate with the whole
set. CI creates it in the Test job.

## Open

- Retention. The privacy page keeps signed contracts and deposit records for six years after the end of the financial
  year of the event. Nothing deletes them yet, and the immutability trigger means a deletion is a deliberate,
  logged administrative step (disable the trigger inside a transaction). Follow-up with the retention passes.
- A printable copy of the signed contract (the forest panel is hidden in print).
- Disputes (`charge.dispute.*`) are recorded as events but not shown.
- A refund that later fails can lower Stripe's `amount_refunded`. Only `charge.refunded` is read, and the largest
  refund is kept, so a failed refund still reads as refunded. Check it in Stripe.
- A client who presses Pay on a request that no longer matches its accepted version notifies the team each time
  (rate-limited to 20 an hour per link).
