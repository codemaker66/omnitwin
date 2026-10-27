import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { formatDepositMoney, type DepositPaymentState } from "@omnitwin/types";
import { depositPayments, proposalDepositRequests, proposals } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { WebhookSignatureError, type DepositPayments } from "../services/payments/deposit-gateway.js";
import { parseStripeEvent } from "../services/payments/deposit-events.js";
import { applyStripeEvent, type LedgerOutcome } from "../services/payments/deposit-ledger.js";
import { notifyCommercialTeam } from "../services/commercial-notifications.js";
import { proposalDeskPath } from "../services/client-answer-notice.js";

// ---------------------------------------------------------------------------
// POST /webhooks/stripe — Stripe's reports on deposit payments (Plan 19 L5).
//
// The signature is verified against the raw body exactly as it arrived
// (fastify-raw-body), never a re-serialised parse, with Stripe's five-minute
// tolerance. Nothing is believed before it verifies; nothing is applied to a
// payment twice (stripe_events, written with the effect). A live-mode event
// is refused while payments are test-only. With deposits off the route does
// not exist; refused (a live key without the live flag), it answers 503 so
// the misconfiguration shows in Stripe's dashboard.
//
// 2xx tells Stripe to stop: a duplicate and an event about nothing of ours
// both answer 200. A failure to apply answers 5xx and Stripe retries, for up
// to three days, which is also how an event that arrives before the payment
// it concerns is written is applied later.
// ---------------------------------------------------------------------------

/** The states the venue team hears about the moment Stripe reports them. */
const ANNOUNCED: Readonly<Partial<Record<DepositPaymentState, { readonly title: string; readonly severity: "info" | "attention" }>>> = {
  paid: { title: "Deposit paid", severity: "info" },
  processing: { title: "Deposit payment processing", severity: "info" },
  failed: { title: "Deposit payment failed", severity: "attention" },
  partially_refunded: { title: "Deposit partly refunded", severity: "attention" },
  refunded: { title: "Deposit refunded", severity: "attention" },
  mismatch: { title: "Deposit payment does not match the request", severity: "attention" },
};

/**
 * Tells the venue's commercial team when a payment changes to a state they
 * act on. After the commit and failure-isolated: the payment record stands
 * whether or not the notice is written.
 */
async function announce(db: Database, outcome: LedgerOutcome, logger: FastifyBaseLogger): Promise<void> {
  if (outcome.kind !== "applied" || outcome.before === outcome.after) return;
  const notice = ANNOUNCED[outcome.after];
  if (notice === undefined) return;
  try {
    const [row] = await db.select({
      proposalId: proposalDepositRequests.proposalId,
      title: proposals.title,
      amountMinor: depositPayments.amountMinor,
      currency: depositPayments.currency,
      amountRefundedMinor: depositPayments.amountRefundedMinor,
      amountReceivedMinor: depositPayments.amountReceivedMinor,
    })
      .from(depositPayments)
      .innerJoin(proposalDepositRequests, eq(proposalDepositRequests.id, depositPayments.depositRequestId))
      .innerJoin(proposals, eq(proposals.id, proposalDepositRequests.proposalId))
      .where(eq(depositPayments.id, outcome.paymentId))
      .limit(1);
    if (row === undefined) return;
    const asked = formatDepositMoney(row.amountMinor, row.currency);
    const body = outcome.after === "mismatch"
      ? `Stripe reported ${formatDepositMoney(row.amountReceivedMinor ?? 0, row.currency)} against the ${asked} deposit asked for on ${row.title}. Check the payment in Stripe before relying on it.`
      : outcome.after === "refunded" || outcome.after === "partially_refunded"
        ? `${formatDepositMoney(row.amountRefundedMinor, row.currency)} of the ${asked} deposit on ${row.title} was refunded in Stripe.`
        : outcome.after === "failed"
          ? `The ${asked} deposit on ${row.title} was not paid: the client's bank payment failed. They can pay again from their link.`
          : outcome.after === "processing"
            ? `The client has paid the ${asked} deposit on ${row.title} by a method that settles in a few days. It shows as paid once Stripe confirms it.`
            : `The client paid the ${asked} deposit on ${row.title}. Stripe test mode: no real money moved.`;
    await notifyCommercialTeam(db, {
      venueId: outcome.venueId,
      title: notice.title,
      body,
      severity: notice.severity,
      actionPath: proposalDeskPath(row.proposalId),
    });
  } catch (err) {
    logger.error({ event: "deposit.notice_failed", paymentId: outcome.paymentId, err }, "deposit payment recorded but the team's notice could not be written");
  }
}

export async function stripeWebhookRoutes(
  server: FastifyInstance,
  opts: { db: Database; payments: DepositPayments },
): Promise<void> {
  const { db, payments } = opts;

  server.post("/stripe", {
    config: { rawBody: true, rateLimit: { max: 600, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    if (payments.status === "off") {
      return reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
    }
    if (payments.status === "refused") {
      request.log.error({ event: "stripe.webhook_refused", reason: payments.reason }, "Stripe webhook refused: payments are not in an allowed mode");
      return reply.status(503).send({ error: "Payments are switched off for this deployment", code: "PAYMENTS_REFUSED" });
    }

    const raw = request.rawBody;
    if (raw === undefined) {
      return reply.status(400).send({ error: "The request body could not be read", code: "VALIDATION_ERROR" });
    }
    const header = request.headers["stripe-signature"];
    let verified: unknown;
    try {
      verified = payments.gateway.verifyWebhook(typeof raw === "string" ? Buffer.from(raw, "utf8") : raw, typeof header === "string" ? header : undefined);
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        request.log.warn({ event: "stripe.webhook_signature_invalid" }, "Stripe webhook signature did not verify");
        return reply.status(400).send({ error: "Invalid Stripe signature", code: "INVALID_SIGNATURE" });
      }
      throw error;
    }

    const parsed = parseStripeEvent(verified);
    if (parsed === null) {
      // Signed by Stripe yet not the shape this code reads: an API version
      // change, most likely. Loud, and refused, so Stripe shows it failing
      // and retries once the code reads it.
      request.log.error({ event: "stripe.webhook_unreadable" }, "A signed Stripe event did not have the shape deposits read");
      return reply.status(400).send({ error: "Unreadable Stripe event", code: "VALIDATION_ERROR" });
    }
    if (parsed.livemode && payments.gateway.mode !== "live") {
      request.log.error({ event: "stripe.webhook_live_refused", stripeEventId: parsed.id }, "A live-mode Stripe event reached a test-mode deployment");
      return reply.status(400).send({ error: "Live-mode events are refused: deposits are in test mode", code: "LIVE_EVENT_REFUSED" });
    }

    const outcome = await applyStripeEvent(db, parsed, payments.gateway);
    await announce(db, outcome, request.log);
    return reply.status(200).send({ received: true, outcome: outcome.kind });
  });
}
