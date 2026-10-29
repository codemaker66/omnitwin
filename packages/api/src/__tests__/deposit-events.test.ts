import { describe, expect, it } from "vitest";
import { depositPaymentState } from "@omnitwin/types";
import { factsAfter, parseStripeEvent, type DepositEvent, type PaymentFacts } from "../services/payments/deposit-events.js";

// ---------------------------------------------------------------------------
// Stripe events folded into a deposit payment's facts (Plan 19 L5). Stripe
// does not promise order and delivers at least once, so the fold must give
// the same facts for every order of the same events, and for any event twice.
// ---------------------------------------------------------------------------

const PAYMENT_ID = "8c6d4f7e-1d0b-4e37-9a38-7b1f2f0c9d11";
const EMPTY: PaymentFacts = {
  amountMinor: 50_000, currency: "GBP", stripePaymentIntentId: null, amountReceivedMinor: null, currencyReceived: null,
  amountRefundedMinor: 0, paidAt: null, processingAt: null, declinedAt: null, failureMessage: null,
  failedAt: null, expiredAt: null, lastEventAt: null,
};

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

function fold(events: readonly (readonly [DepositEvent, Date])[]): PaymentFacts {
  return events.reduce((facts, [event, at]) => factsAfter(facts, event, at), EMPTY);
}

const t = (seconds: number): Date => new Date(Date.UTC(2026, 9, 27, 12, 0, seconds));

describe("reading a Stripe event", () => {
  const envelope = (type: string, object: unknown, extra: Record<string, unknown> = {}) => ({
    id: "evt_1Abc", type, created: 1_793_000_000, livemode: false, data: { object }, ...extra,
  });

  it("reads a paid checkout, its PaymentIntent and the amount Stripe charged", () => {
    const parsed = parseStripeEvent(envelope("checkout.session.completed", {
      id: "cs_test_a1", payment_status: "paid", amount_total: 50_000, currency: "gbp", payment_intent: "pi_1", metadata: { deposit_payment_id: PAYMENT_ID },
    }));
    expect(parsed?.event).toEqual({ kind: "session_paid", sessionId: "cs_test_a1", paymentIntentId: "pi_1", amountMinor: 50_000, currency: "gbp" });
    expect(parsed?.created.toISOString()).toBe(new Date(1_793_000_000_000).toISOString());
  });

  it("reads a completed checkout that has not been paid yet as processing", () => {
    const parsed = parseStripeEvent(envelope("checkout.session.completed", {
      id: "cs_test_a1", payment_status: "unpaid", amount_total: 50_000, currency: "gbp", payment_intent: null,
    }));
    expect(parsed?.event.kind).toBe("session_processing");
  });

  it("reads a declined attempt with Stripe's words for the payer, and our payment id only if it is a uuid", () => {
    const declined = parseStripeEvent(envelope("payment_intent.payment_failed", {
      id: "pi_1", amount_received: 0, currency: "gbp", metadata: { deposit_payment_id: PAYMENT_ID }, last_payment_error: { message: "Your card was declined." },
    }));
    expect(declined?.event).toEqual({ kind: "intent_declined", paymentIntentId: "pi_1", message: "Your card was declined.", depositPaymentId: PAYMENT_ID });
    const forged = parseStripeEvent(envelope("payment_intent.payment_failed", {
      id: "pi_1", amount_received: 0, currency: "gbp", metadata: { deposit_payment_id: "1 OR 1=1" }, last_payment_error: null,
    }));
    expect(forged?.event).toMatchObject({ kind: "intent_declined", depositPaymentId: null, message: null });
  });

  it("reads a refund with the cumulative amount refunded", () => {
    const parsed = parseStripeEvent(envelope("charge.refunded", {
      id: "ch_1", payment_intent: "pi_1", amount_captured: 50_000, amount_refunded: 20_000, currency: "gbp", created: 1_792_999_000, paid: true,
    }));
    expect(parsed?.event).toMatchObject({ kind: "charge_refunded", paymentIntentId: "pi_1", amountRefundedMinor: 20_000, amountCapturedMinor: 50_000 });
  });

  it("passes over event types deposits do not read, and refuses a malformed envelope or object", () => {
    expect(parseStripeEvent(envelope("customer.created", { id: "cus_1" }))?.event.kind).toBe("not_for_deposits");
    expect(parseStripeEvent({ ...envelope("checkout.session.completed", {}), id: "nope" })).toBeNull();
    expect(parseStripeEvent(envelope("checkout.session.completed", { id: "cs_test_a1", payment_status: "paid", amount_total: -5, currency: "gbp", payment_intent: null }))).toBeNull();
    expect(parseStripeEvent(envelope("charge.refunded", { id: "ch_1" }))).toBeNull();
    expect(parseStripeEvent(null)).toBeNull();
  });
});

describe("folding events into a payment's facts", () => {
  const declined: DepositEvent = { kind: "intent_declined", paymentIntentId: "pi_1", message: "Your card was declined.", depositPaymentId: PAYMENT_ID };
  const paid: DepositEvent = { kind: "session_paid", sessionId: "cs_1", paymentIntentId: "pi_1", amountMinor: 50_000, currency: "gbp" };
  const succeeded: DepositEvent = { kind: "intent_succeeded", paymentIntentId: "pi_1", amountMinor: 50_000, currency: "gbp", depositPaymentId: PAYMENT_ID };
  const refundSome: DepositEvent = { kind: "charge_refunded", paymentIntentId: "pi_1", amountCapturedMinor: 50_000, amountRefundedMinor: 20_000, currency: "gbp", chargedAt: t(5), paid: true };
  const refundAll: DepositEvent = { ...refundSome, amountRefundedMinor: 50_000 } as DepositEvent;
  const expired: DepositEvent = { kind: "session_expired", sessionId: "cs_1" };

  it("reaches the same facts in every order of the same events", () => {
    const events: (readonly [DepositEvent, Date])[] = [[declined, t(1)], [paid, t(6)], [succeeded, t(6)], [refundSome, t(30)], [refundAll, t(40)]];
    const outcomes = new Set(permutations(events).map((order) => JSON.stringify(fold(order))));
    expect(outcomes.size).toBe(1);
    const facts = fold(events);
    expect(depositPaymentState(facts)).toBe("refunded");
    expect(facts.amountRefundedMinor).toBe(50_000);
    expect(facts.paidAt?.toISOString()).toBe(t(5).toISOString());
    expect(facts.stripePaymentIntentId).toBe("pi_1");
  });

  it("changes nothing when the same event is folded twice", () => {
    const once = fold([[declined, t(1)], [paid, t(6)]]);
    const twice = fold([[declined, t(1)], [paid, t(6)], [paid, t(6)], [declined, t(1)]]);
    expect(twice).toEqual(once);
  });

  it("keeps a payment paid when its page lapses or a decline arrives after the success", () => {
    const facts = fold([[paid, t(6)], [expired, t(3_600)], [declined, t(1)]]);
    expect(depositPaymentState(facts)).toBe("paid");
    expect(facts.failureMessage).toBe("Your card was declined.");
  });

  it("records a refund that arrives before the payment's own report as a paid, refunded payment", () => {
    const facts = fold([[refundSome, t(30)]]);
    expect(depositPaymentState(facts)).toBe("partially_refunded");
    expect(facts.amountReceivedMinor).toBe(50_000);
  });

  it("keeps the latest decline's words", () => {
    const later: DepositEvent = { ...declined, message: "Your card has insufficient funds." } as DepositEvent;
    expect(fold([[later, t(9)], [declined, t(1)]]).failureMessage).toBe("Your card has insufficient funds.");
    expect(fold([[declined, t(1)], [later, t(9)]]).failureMessage).toBe("Your card has insufficient funds.");
  });

  it("keeps a reported currency that differs from the one asked for, in either order", () => {
    const euros: DepositEvent = { ...succeeded, currency: "eur" } as DepositEvent;
    for (const order of permutations<readonly [DepositEvent, Date]>([[paid, t(6)], [euros, t(7)]])) {
      const facts = fold(order);
      expect(facts.currencyReceived).toBe("EUR");
      expect(depositPaymentState(facts)).toBe("mismatch");
    }
  });

  it("keeps the same one of two different wrong amounts whatever their order", () => {
    const short: DepositEvent = { ...succeeded, amountMinor: 40_000 } as DepositEvent;
    const shorter: DepositEvent = { ...succeeded, amountMinor: 30_000 } as DepositEvent;
    const kept = new Set(permutations<readonly [DepositEvent, Date]>([[short, t(6)], [shorter, t(7)], [paid, t(8)]]).map((order) => fold(order).amountReceivedMinor));
    expect([...kept]).toEqual([30_000]);
  });

  it("never calls a payment reported without an amount paid", () => {
    const silent: DepositEvent = { ...paid, amountMinor: null, currency: null } as DepositEvent;
    expect(depositPaymentState(fold([[silent, t(6)]]))).toBe("mismatch");
    expect(depositPaymentState(fold([[silent, t(6)], [succeeded, t(7)]]))).toBe("paid");
  });

  it("keeps a reported amount that differs from the one asked for, in either order", () => {
    const short: DepositEvent = { ...succeeded, amountMinor: 40_000 } as DepositEvent;
    for (const order of permutations<readonly [DepositEvent, Date]>([[paid, t(6)], [short, t(7)]])) {
      const facts = fold(order);
      expect(facts.amountReceivedMinor).toBe(40_000);
      expect(depositPaymentState(facts)).toBe("mismatch");
    }
  });
});
