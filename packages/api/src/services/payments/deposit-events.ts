import { z } from "zod";

// ---------------------------------------------------------------------------
// Stripe events, read into what they say about a deposit payment (Plan 19 L5).
//
// The webhook's body is signed by Stripe, and still parsed here field by field
// before anything is believed: only the fields a deposit needs, each checked.
//
// `factsAfter` folds one event into a payment's facts. Each fact is kept as a
// lattice join — the earliest moment for paid / processing / failed /
// expired, the largest refund, the latest decline and its words — so folding
// the same events in any order, or one twice, gives the same facts. The
// state shown is then derived from the facts (depositPaymentState), where a
// payment seen to succeed stays paid whatever is reported late.
// ---------------------------------------------------------------------------

const Metadata = z.record(z.string(), z.string()).nullable().optional();

const SessionObject = z.object({
  id: z.string().regex(/^cs_[A-Za-z0-9_]+$/u),
  payment_status: z.string(),
  amount_total: z.number().int().nonnegative().nullable(),
  currency: z.string().regex(/^[a-z]{3}$/u).nullable(),
  payment_intent: z.union([z.string(), z.object({ id: z.string() }).loose()]).nullable(),
  metadata: Metadata,
}).loose();

const IntentObject = z.object({
  id: z.string().regex(/^pi_[A-Za-z0-9_]+$/u),
  amount_received: z.number().int().nonnegative(),
  currency: z.string().regex(/^[a-z]{3}$/u),
  metadata: Metadata,
  last_payment_error: z.object({ message: z.string().optional() }).loose().nullable().optional(),
}).loose();

const ChargeObject = z.object({
  id: z.string(),
  payment_intent: z.union([z.string(), z.object({ id: z.string() }).loose()]).nullable(),
  amount_captured: z.number().int().nonnegative(),
  amount_refunded: z.number().int().nonnegative(),
  currency: z.string().regex(/^[a-z]{3}$/u),
  created: z.number().int().positive(),
  paid: z.boolean(),
}).loose();

const Envelope = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9_]+$/u),
  type: z.string().min(1).max(100),
  created: z.number().int().positive(),
  livemode: z.boolean(),
  data: z.object({ object: z.unknown() }).loose(),
}).loose();

export type DepositEvent =
  | { readonly kind: "session_paid"; readonly sessionId: string; readonly paymentIntentId: string | null; readonly amountMinor: number | null; readonly currency: string | null }
  | { readonly kind: "session_processing"; readonly sessionId: string; readonly paymentIntentId: string | null; readonly amountMinor: number | null; readonly currency: string | null }
  | { readonly kind: "session_failed"; readonly sessionId: string }
  | { readonly kind: "session_expired"; readonly sessionId: string }
  | { readonly kind: "intent_succeeded"; readonly paymentIntentId: string; readonly amountMinor: number; readonly currency: string; readonly depositPaymentId: string | null }
  | { readonly kind: "intent_declined"; readonly paymentIntentId: string; readonly message: string | null; readonly depositPaymentId: string | null }
  | { readonly kind: "charge_refunded"; readonly paymentIntentId: string | null; readonly amountCapturedMinor: number; readonly amountRefundedMinor: number; readonly currency: string; readonly chargedAt: Date; readonly paid: boolean }
  | { readonly kind: "not_for_deposits" };

export interface ParsedStripeEvent {
  readonly id: string;
  readonly type: string;
  readonly livemode: boolean;
  readonly created: Date;
  readonly event: DepositEvent;
}

const UUID = z.uuid();

function idOf(value: string | { readonly id: string } | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.id;
}

function depositPaymentIdIn(metadata: Readonly<Record<string, string>> | null | undefined): string | null {
  const id = metadata?.["deposit_payment_id"];
  return id !== undefined && UUID.safeParse(id).success ? id : null;
}

/**
 * The event, or null when its envelope or the object a deposit would read
 * from it does not have the shape Stripe documents (then nothing is applied).
 */
export function parseStripeEvent(raw: unknown): ParsedStripeEvent | null {
  const envelope = Envelope.safeParse(raw);
  if (!envelope.success) return null;
  const { id, type, livemode, created } = envelope.data;
  const object = envelope.data.data.object;
  const base = { id, type, livemode, created: new Date(created * 1000) };

  const session = (): z.infer<typeof SessionObject> | null => {
    const parsed = SessionObject.safeParse(object);
    return parsed.success ? parsed.data : null;
  };
  switch (type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = session();
      if (s === null) return null;
      const reported = { sessionId: s.id, paymentIntentId: idOf(s.payment_intent), amountMinor: s.amount_total, currency: s.currency };
      // Completed but not yet paid: a method that settles later.
      if (type === "checkout.session.completed" && s.payment_status === "unpaid") return { ...base, event: { kind: "session_processing", ...reported } };
      if (s.payment_status !== "paid") return { ...base, event: { kind: "not_for_deposits" } };
      return { ...base, event: { kind: "session_paid", ...reported } };
    }
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const s = session();
      if (s === null) return null;
      return { ...base, event: { kind: type === "checkout.session.expired" ? "session_expired" : "session_failed", sessionId: s.id } };
    }
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed": {
      const parsed = IntentObject.safeParse(object);
      if (!parsed.success) return null;
      const intent = parsed.data;
      const depositPaymentId = depositPaymentIdIn(intent.metadata);
      if (type === "payment_intent.succeeded") {
        return { ...base, event: { kind: "intent_succeeded", paymentIntentId: intent.id, amountMinor: intent.amount_received, currency: intent.currency, depositPaymentId } };
      }
      const message = intent.last_payment_error?.message?.trim() ?? "";
      return { ...base, event: { kind: "intent_declined", paymentIntentId: intent.id, message: message === "" ? null : message.slice(0, 500), depositPaymentId } };
    }
    case "charge.refunded": {
      const parsed = ChargeObject.safeParse(object);
      if (!parsed.success) return null;
      const charge = parsed.data;
      return {
        ...base,
        event: {
          kind: "charge_refunded",
          paymentIntentId: idOf(charge.payment_intent),
          amountCapturedMinor: charge.amount_captured,
          amountRefundedMinor: charge.amount_refunded,
          currency: charge.currency,
          chargedAt: new Date(charge.created * 1000),
          paid: charge.paid,
        },
      };
    }
    default:
      return { ...base, event: { kind: "not_for_deposits" } };
  }
}

/** What a payment row holds of Stripe's reports. */
export interface PaymentFacts {
  readonly amountMinor: number;
  readonly stripePaymentIntentId: string | null;
  readonly amountReceivedMinor: number | null;
  readonly currencyReceived: string | null;
  readonly amountRefundedMinor: number;
  readonly paidAt: Date | null;
  readonly processingAt: Date | null;
  readonly declinedAt: Date | null;
  readonly failureMessage: string | null;
  readonly failedAt: Date | null;
  readonly expiredAt: Date | null;
  readonly lastEventAt: Date | null;
}

type MutableFacts = { -readonly [K in keyof PaymentFacts]: PaymentFacts[K] };

function earliest(current: Date | null, next: Date): Date {
  return current === null || next.getTime() < current.getTime() ? next : current;
}

function latest(current: Date | null, next: Date): Date {
  return current === null || next.getTime() > current.getTime() ? next : current;
}

/**
 * The amount Stripe reports, kept once; a report that differs from the amount
 * asked for replaces one that matched, so a mismatch, once seen, stays seen.
 */
function reported(facts: MutableFacts, amountMinor: number | null, currency: string | null): void {
  if (amountMinor === null) return;
  const upper = currency === null ? null : currency.toUpperCase();
  const matches = facts.amountReceivedMinor === facts.amountMinor;
  if (facts.amountReceivedMinor === null || (matches && amountMinor !== facts.amountMinor)) {
    facts.amountReceivedMinor = amountMinor;
    facts.currencyReceived = upper;
  } else if (facts.currencyReceived === null && upper !== null) {
    facts.currencyReceived = upper;
  }
}

/** The facts once this event is folded in. Order-independent and idempotent. */
export function factsAfter(current: PaymentFacts, event: DepositEvent, at: Date): PaymentFacts {
  const facts: MutableFacts = { ...current };
  facts.lastEventAt = latest(current.lastEventAt, at);
  const intent = (id: string | null): void => {
    if (facts.stripePaymentIntentId === null && id !== null) facts.stripePaymentIntentId = id;
  };
  switch (event.kind) {
    case "session_paid":
      intent(event.paymentIntentId);
      reported(facts, event.amountMinor, event.currency);
      facts.paidAt = earliest(facts.paidAt, at);
      break;
    case "session_processing":
      intent(event.paymentIntentId);
      reported(facts, event.amountMinor, event.currency);
      facts.processingAt = earliest(facts.processingAt, at);
      break;
    case "session_failed":
      facts.failedAt = earliest(facts.failedAt, at);
      break;
    case "session_expired":
      facts.expiredAt = earliest(facts.expiredAt, at);
      break;
    case "intent_succeeded":
      intent(event.paymentIntentId);
      reported(facts, event.amountMinor, event.currency);
      facts.paidAt = earliest(facts.paidAt, at);
      break;
    case "intent_declined":
      intent(event.paymentIntentId);
      // The latest decline and its words; an equal moment keeps the words
      // that sort first, so two declines in one second agree in any order.
      if (facts.declinedAt === null || at.getTime() > facts.declinedAt.getTime()
        || (at.getTime() === facts.declinedAt.getTime() && (event.message ?? "") < (facts.failureMessage ?? ""))) {
        facts.declinedAt = at;
        facts.failureMessage = event.message;
      }
      break;
    case "charge_refunded":
      intent(event.paymentIntentId);
      // A refund is of a charge that was paid: it says so, whenever the
      // payment's own report arrives.
      if (event.paid) {
        reported(facts, event.amountCapturedMinor, event.currency);
        facts.paidAt = earliest(facts.paidAt, event.chargedAt);
      }
      facts.amountRefundedMinor = Math.max(facts.amountRefundedMinor, event.amountRefundedMinor);
      break;
    case "not_for_deposits":
      break;
  }
  return facts;
}
