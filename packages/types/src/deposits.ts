import { z } from "zod";
import { CurrencySchema, type Currency } from "./pricing.js";
import { MAX_MINOR_UNIT_AMOUNT } from "./proposal.js";

// ---------------------------------------------------------------------------
// Deposits (Plan 19 L5; goal 06 S6) — a deposit the venue asks for once a
// client has accepted a proposal, paid through Stripe Checkout in TEST MODE.
//
// The deposit is figured from the accepted version's own quote snapshot, the
// version the client accepted, never from a version saved since: a quote can
// not drift under a request (goal 06 pain point 4). It is an amount, or a
// percentage of that quote's total held in basis points (2,500 is 25%), so no
// floating-point rate ever touches money. Accepted price, payment status and
// a confirmed booking stay separate states: paying a deposit confirms nothing
// in the Diary.
//
// A payment's state is derived from facts Stripe has reported, each kept once
// and never walked back, so webhooks arriving in any order, or twice, reach
// the same state: a payment seen to succeed stays paid whatever failure is
// reported late, and a refund only ever grows.
// ---------------------------------------------------------------------------

export const DEPOSIT_BASES = ["amount", "percent"] as const;
export const DepositBasisSchema = z.enum(DEPOSIT_BASES);
export type DepositBasis = z.infer<typeof DepositBasisSchema>;

/** 100% in basis points. */
export const MAX_DEPOSIT_BASIS_POINTS = 10_000;

/** Stripe's smallest charge in each supported currency, in minor units. */
export const STRIPE_MINIMUM_CHARGE_MINOR: Readonly<Record<Currency, number>> = { GBP: 30 };

const AcceptedVersion = z.number().int().positive();

/** What the venue asks for, naming the accepted version the screen showed. */
export const RequestDepositSchema = z.discriminatedUnion("basis", [
  z.object({
    basis: z.literal("amount"),
    amountMinor: z.number().int().positive().max(MAX_MINOR_UNIT_AMOUNT),
    version: AcceptedVersion,
  }).strict(),
  z.object({
    basis: z.literal("percent"),
    percentBasisPoints: z.number().int().min(1).max(MAX_DEPOSIT_BASIS_POINTS),
    version: AcceptedVersion,
  }).strict(),
]);
export type RequestDeposit = z.infer<typeof RequestDepositSchema>;

/**
 * A percentage of a total in whole minor units, a half penny rounding up.
 * Exact integer arithmetic: the largest total (100,000,000) times 10,000 basis
 * points stays far inside Number.MAX_SAFE_INTEGER.
 */
export function depositFromPercent(totalMinor: number, basisPoints: number): number {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) throw new RangeError("total must be a non-negative integer of minor units");
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > MAX_DEPOSIT_BASIS_POINTS) {
    throw new RangeError("basis points must be an integer from 0 to 10,000");
  }
  return Math.floor((totalMinor * basisPoints + 5_000) / 10_000);
}

export type DepositAmountRefusal =
  | "no_quote"
  | "zero_total"
  | "over_total"
  | "under_minimum";

/**
 * The amount a request comes to against the accepted quote, or why it cannot
 * be asked for: no quote to take a share of, a total of nothing, more than
 * the total, or less than Stripe will charge.
 */
export function depositAmount(
  request: { readonly basis: "amount"; readonly amountMinor: number } | { readonly basis: "percent"; readonly percentBasisPoints: number },
  quote: { readonly totalMinor: number; readonly currency: Currency } | null,
): { readonly ok: true; readonly amountMinor: number } | { readonly ok: false; readonly refusal: DepositAmountRefusal } {
  if (quote === null) return { ok: false, refusal: "no_quote" };
  if (quote.totalMinor <= 0) return { ok: false, refusal: "zero_total" };
  const amountMinor = request.basis === "amount" ? request.amountMinor : depositFromPercent(quote.totalMinor, request.percentBasisPoints);
  if (amountMinor > quote.totalMinor) return { ok: false, refusal: "over_total" };
  if (amountMinor < STRIPE_MINIMUM_CHARGE_MINOR[quote.currency]) return { ok: false, refusal: "under_minimum" };
  return { ok: true, amountMinor };
}

// ---------------------------------------------------------------------------
// A payment attempt (one Stripe Checkout Session) and its derived state
// ---------------------------------------------------------------------------

export const DEPOSIT_PAYMENT_STATES = [
  /** The checkout page is open; nothing paid yet. */
  "open",
  /** An attempt was declined; the same checkout page can be tried again. */
  "declined",
  /** Completed with a method that settles later (a bank debit). */
  "processing",
  "paid",
  "partially_refunded",
  "refunded",
  /** A bank debit that failed after completing: this attempt is over. */
  "failed",
  /** The checkout page lapsed unpaid. */
  "expired",
  /** Stripe reported a payment that is not the amount asked for. */
  "mismatch",
] as const;
export const DepositPaymentStateSchema = z.enum(DEPOSIT_PAYMENT_STATES);
export type DepositPaymentState = z.infer<typeof DepositPaymentStateSchema>;

/** What Stripe has reported about one attempt, each fact kept once. */
export interface DepositPaymentFacts {
  readonly amountMinor: number;
  readonly currency: string;
  readonly amountReceivedMinor: number | null;
  readonly currencyReceived: string | null;
  readonly amountRefundedMinor: number;
  readonly paidAt: Date | string | null;
  readonly processingAt: Date | string | null;
  readonly declinedAt: Date | string | null;
  readonly failedAt: Date | string | null;
  readonly expiredAt: Date | string | null;
}

/**
 * The state the facts add up to, whatever order they arrived in. Paid wins
 * over every failure; an amount received that is not the amount asked for is
 * a mismatch for the venue to look at, never "paid".
 */
export function depositPaymentState(facts: DepositPaymentFacts): DepositPaymentState {
  if (facts.amountReceivedMinor !== null
    && (facts.amountReceivedMinor !== facts.amountMinor
      || (facts.currencyReceived !== null && facts.currencyReceived.toUpperCase() !== facts.currency.toUpperCase()))) {
    return "mismatch";
  }
  if (facts.paidAt !== null) {
    if (facts.amountRefundedMinor >= facts.amountMinor) return "refunded";
    if (facts.amountRefundedMinor > 0) return "partially_refunded";
    return "paid";
  }
  if (facts.failedAt !== null) return "failed";
  if (facts.processingAt !== null) return "processing";
  if (facts.expiredAt !== null) return "expired";
  if (facts.declinedAt !== null) return "declined";
  return "open";
}

/** States in which money has moved or is moving: no second attempt is opened. */
export const DEPOSIT_SETTLING_STATES: readonly DepositPaymentState[] = ["processing", "paid", "partially_refunded", "refunded", "mismatch"];

/** States in which the attempt's checkout page can still be paid. */
export const DEPOSIT_PAYABLE_STATES: readonly DepositPaymentState[] = ["open", "declined"];

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const IsoDate = z.iso.datetime({ offset: true });

export const DepositPaymentViewSchema = z.object({
  id: z.uuid(),
  state: DepositPaymentStateSchema,
  amountMinor: z.number().int(),
  currency: CurrencySchema,
  amountReceivedMinor: z.number().int().nullable(),
  amountRefundedMinor: z.number().int(),
  /** Stripe's own words for the last declined attempt, written for the payer. */
  failureMessage: z.string().nullable(),
  createdAt: IsoDate,
  paidAt: IsoDate.nullable(),
  /** When Stripe last told us anything about it. */
  lastEventAt: IsoDate.nullable(),
}).strict();
export type DepositPaymentView = z.infer<typeof DepositPaymentViewSchema>;

/** Where a request stands, from its attempts. */
export const DEPOSIT_REQUEST_STATES = ["requested", "processing", "paid", "partially_refunded", "refunded", "mismatch", "cancelled"] as const;
export const DepositRequestStateSchema = z.enum(DEPOSIT_REQUEST_STATES);
export type DepositRequestState = z.infer<typeof DepositRequestStateSchema>;

export function depositRequestState(
  cancelled: boolean,
  payments: readonly Pick<DepositPaymentView, "state">[],
): DepositRequestState {
  const states = payments.map((payment) => payment.state);
  for (const settled of ["mismatch", "refunded", "partially_refunded", "paid", "processing"] as const) {
    if (states.includes(settled)) return settled;
  }
  return cancelled ? "cancelled" : "requested";
}

export const DepositRequestViewSchema = z.object({
  id: z.uuid(),
  state: DepositRequestStateSchema,
  basis: DepositBasisSchema,
  percentBasisPoints: z.number().int().nullable(),
  amountMinor: z.number().int(),
  currency: CurrencySchema,
  /** The accepted version's quote total the deposit was figured from. */
  quoteTotalMinor: z.number().int(),
  proposalVersion: z.number().int().positive(),
  createdAt: IsoDate,
  cancelledAt: IsoDate.nullable(),
  payments: z.array(DepositPaymentViewSchema),
}).strict();
export type DepositRequestView = z.infer<typeof DepositRequestViewSchema>;

/** Whether deposits can be taken here, and in which Stripe mode. */
export const DEPOSIT_AVAILABILITY = ["off", "test", "live"] as const;
export const DepositAvailabilitySchema = z.enum(DEPOSIT_AVAILABILITY);
export type DepositAvailability = z.infer<typeof DepositAvailabilitySchema>;

/** The staff view: every request for the proposal, newest first. */
export const StaffDepositViewSchema = z.object({
  availability: DepositAvailabilitySchema,
  requests: z.array(DepositRequestViewSchema),
}).strict();
export type StaffDepositView = z.infer<typeof StaffDepositViewSchema>;

/** The client's view: the request in force, if any, and how it stands. */
export const ClientDepositViewSchema = z.object({
  mode: z.enum(["test", "live"]),
  request: DepositRequestViewSchema.nullable(),
}).strict();
export type ClientDepositView = z.infer<typeof ClientDepositViewSchema>;

/** The client's Pay press: the request their page showed. */
export const StartDepositCheckoutSchema = z.object({ requestId: z.uuid() }).strict();
export type StartDepositCheckout = z.infer<typeof StartDepositCheckoutSchema>;

/** An amount in minor units as the venue's people read it ("£1,250.00"). */
export function formatDepositMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}
