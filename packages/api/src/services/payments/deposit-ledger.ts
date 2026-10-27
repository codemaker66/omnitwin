import { eq } from "drizzle-orm";
import { depositPaymentState, type DepositPaymentState } from "@omnitwin/types";
import { depositPayments, stripeEvents } from "../../db/schema.js";
import type { Database } from "../../db/client.js";
import type { DepositGateway } from "./deposit-gateway.js";
import { factsAfter, type DepositEvent, type ParsedStripeEvent, type PaymentFacts } from "./deposit-events.js";

// ---------------------------------------------------------------------------
// The deposit ledger (Plan 19 L5): a verified Stripe event applied to the
// payment it is about, exactly once.
//
// The event's id is written to stripe_events (0018) first, in the same
// transaction as its effect: a second delivery of the same event finds the id
// and changes nothing, two at once are ordered by the unique index, and an
// effect that fails rolls the id back with it so Stripe's retry applies it.
// The payment row is held FOR UPDATE while its facts are folded, so two
// different events about one payment never write over each other.
//
// An event about nothing of ours (another product sold on the same Stripe
// account, a subscription) is recorded and ignored.
// ---------------------------------------------------------------------------

type PaymentRow = typeof depositPayments.$inferSelect;
type LedgerTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type LedgerOutcome =
  | { readonly kind: "duplicate" }
  | { readonly kind: "ignored" }
  | {
    readonly kind: "applied";
    readonly paymentId: string;
    readonly depositRequestId: string;
    readonly venueId: string;
    readonly before: DepositPaymentState;
    readonly after: DepositPaymentState;
  };

export function paymentFacts(row: PaymentRow): PaymentFacts {
  return {
    amountMinor: row.amountMinor,
    stripePaymentIntentId: row.stripePaymentIntentId,
    amountReceivedMinor: row.amountReceivedMinor,
    currencyReceived: row.currencyReceived,
    amountRefundedMinor: row.amountRefundedMinor,
    paidAt: row.paidAt,
    processingAt: row.processingAt,
    declinedAt: row.declinedAt,
    failureMessage: row.failureMessage,
    failedAt: row.failedAt,
    expiredAt: row.expiredAt,
    lastEventAt: row.lastEventAt,
  };
}

export function paymentRowState(row: PaymentRow): DepositPaymentState {
  return depositPaymentState({ ...paymentFacts(row), currency: row.currency });
}

/** The payment row an event is about, held for the rest of the transaction. */
async function heldPayment(tx: LedgerTransaction, event: DepositEvent, hintedPaymentId: string | null): Promise<PaymentRow | null> {
  const one = async (where: ReturnType<typeof eq>): Promise<PaymentRow | null> => {
    const [row] = await tx.select().from(depositPayments).where(where).limit(1).for("update");
    return row ?? null;
  };
  switch (event.kind) {
    case "session_paid":
    case "session_processing":
    case "session_failed":
    case "session_expired":
      return one(eq(depositPayments.stripeCheckoutSessionId, event.sessionId));
    case "intent_succeeded":
    case "intent_declined": {
      const byIntent = await one(eq(depositPayments.stripePaymentIntentId, event.paymentIntentId));
      if (byIntent !== null || event.depositPaymentId === null) return byIntent;
      // Before the session's own report has named its PaymentIntent: found
      // by the payment id we put on the PaymentIntent, unless that payment
      // has another PaymentIntent already.
      const byId = await one(eq(depositPayments.id, event.depositPaymentId));
      return byId !== null && (byId.stripePaymentIntentId === null || byId.stripePaymentIntentId === event.paymentIntentId) ? byId : null;
    }
    case "charge_refunded": {
      if (event.paymentIntentId === null) return null;
      const byIntent = await one(eq(depositPayments.stripePaymentIntentId, event.paymentIntentId));
      if (byIntent !== null || hintedPaymentId === null) return byIntent;
      const byId = await one(eq(depositPayments.id, hintedPaymentId));
      return byId !== null && (byId.stripePaymentIntentId === null || byId.stripePaymentIntentId === event.paymentIntentId) ? byId : null;
    }
    case "not_for_deposits":
      return null;
  }
}

/**
 * A refund can be reported before the payment's own report has named its
 * PaymentIntent. Then the PaymentIntent is asked which payment it is (our id
 * is in its metadata). Asked before the transaction, so no lock is held
 * across a call to Stripe.
 */
async function hintFor(db: Database, event: DepositEvent, gateway: DepositGateway): Promise<string | null> {
  if (event.kind !== "charge_refunded" || event.paymentIntentId === null) return null;
  const [known] = await db.select({ id: depositPayments.id }).from(depositPayments)
    .where(eq(depositPayments.stripePaymentIntentId, event.paymentIntentId)).limit(1);
  if (known !== undefined) return null;
  const metadata = await gateway.paymentIntentMetadata(event.paymentIntentId);
  const id = metadata?.["deposit_payment_id"];
  return id !== undefined && /^[0-9a-f-]{36}$/u.test(id) ? id : null;
}

export async function applyStripeEvent(db: Database, parsed: ParsedStripeEvent, gateway: DepositGateway): Promise<LedgerOutcome> {
  const hinted = await hintFor(db, parsed.event, gateway);
  return db.transaction(async (tx): Promise<LedgerOutcome> => {
    const [recorded] = await tx.insert(stripeEvents)
      .values({ eventId: parsed.id, type: parsed.type })
      .onConflictDoNothing({ target: stripeEvents.eventId })
      .returning({ id: stripeEvents.id });
    if (recorded === undefined) return { kind: "duplicate" };

    const payment = await heldPayment(tx, parsed.event, hinted);
    if (payment === null) return { kind: "ignored" };

    const before = paymentRowState(payment);
    const { amountMinor: _asked, ...facts } = factsAfter(paymentFacts(payment), parsed.event, parsed.created);
    const [updated] = await tx.update(depositPayments).set({ ...facts, updatedAt: new Date() })
      .where(eq(depositPayments.id, payment.id))
      .returning();
    if (updated === undefined) throw new Error("deposit payment update returned no row");
    return {
      kind: "applied",
      paymentId: updated.id,
      depositRequestId: updated.depositRequestId,
      venueId: updated.venueId,
      before,
      after: paymentRowState(updated),
    };
  });
}
