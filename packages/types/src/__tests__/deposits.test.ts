import { describe, expect, it } from "vitest";
import {
  RequestDepositSchema,
  depositAmount,
  depositFromPercent,
  depositPaymentState,
  depositRequestState,
  formatDepositMoney,
  type DepositPaymentFacts,
} from "../deposits.js";

const NONE: DepositPaymentFacts = {
  amountMinor: 50_000, currency: "GBP", amountReceivedMinor: null, currencyReceived: null, amountRefundedMinor: 0,
  paidAt: null, processingAt: null, declinedAt: null, failedAt: null, expiredAt: null,
};
const AT = "2026-10-27T12:00:00.000Z";

describe("a deposit figured from the accepted quote", () => {
  it("takes a percentage in whole pence, a half penny rounding up, with no floating-point rate", () => {
    expect(depositFromPercent(250_000, 2_500)).toBe(62_500);
    expect(depositFromPercent(333, 5_000)).toBe(167); // 166.5 → 167
    expect(depositFromPercent(100_000_000, 10_000)).toBe(100_000_000);
    expect(depositFromPercent(1, 1)).toBe(0);
  });

  it("refuses a rate outside 0 to 100% and a total that is not whole pence", () => {
    expect(() => depositFromPercent(100, 10_001)).toThrow(RangeError);
    expect(() => depositFromPercent(100, 0.5)).toThrow(RangeError);
    expect(() => depositFromPercent(10.5, 100)).toThrow(RangeError);
  });

  it("is never more than the total, never less than Stripe charges, and needs a quote", () => {
    const quote = { totalMinor: 250_000, currency: "GBP" as const };
    expect(depositAmount({ basis: "amount", amountMinor: 50_000 }, quote)).toEqual({ ok: true, amountMinor: 50_000 });
    expect(depositAmount({ basis: "percent", percentBasisPoints: 2_000 }, quote)).toEqual({ ok: true, amountMinor: 50_000 });
    expect(depositAmount({ basis: "amount", amountMinor: 250_001 }, quote)).toEqual({ ok: false, refusal: "over_total" });
    expect(depositAmount({ basis: "amount", amountMinor: 29 }, quote)).toEqual({ ok: false, refusal: "under_minimum" });
    expect(depositAmount({ basis: "percent", percentBasisPoints: 1 }, { totalMinor: 1_000, currency: "GBP" })).toEqual({ ok: false, refusal: "under_minimum" });
    expect(depositAmount({ basis: "amount", amountMinor: 100 }, null)).toEqual({ ok: false, refusal: "no_quote" });
    expect(depositAmount({ basis: "amount", amountMinor: 100 }, { totalMinor: 0, currency: "GBP" })).toEqual({ ok: false, refusal: "zero_total" });
  });

  it("accepts exactly one basis, with the version the screen showed, and nothing else", () => {
    expect(RequestDepositSchema.safeParse({ basis: "amount", amountMinor: 5_000, version: 2 }).success).toBe(true);
    expect(RequestDepositSchema.safeParse({ basis: "percent", percentBasisPoints: 2_500, version: 2 }).success).toBe(true);
    expect(RequestDepositSchema.safeParse({ basis: "percent", amountMinor: 5_000, version: 2 }).success).toBe(false);
    expect(RequestDepositSchema.safeParse({ basis: "amount", amountMinor: 50.5, version: 2 }).success).toBe(false);
    expect(RequestDepositSchema.safeParse({ basis: "amount", amountMinor: 5_000 }).success).toBe(false);
    expect(RequestDepositSchema.safeParse({ basis: "amount", amountMinor: 5_000, version: 2, venueId: "x" }).success).toBe(false);
  });
});

describe("a payment's state from what Stripe reported", () => {
  it("is open until Stripe says anything", () => {
    expect(depositPaymentState(NONE)).toBe("open");
  });

  it("stays paid whatever failure is reported, and reads refunds as they grow", () => {
    const paid = { ...NONE, paidAt: AT, amountReceivedMinor: 50_000, currencyReceived: "GBP" };
    expect(depositPaymentState(paid)).toBe("paid");
    expect(depositPaymentState({ ...paid, declinedAt: AT, expiredAt: AT, failedAt: AT })).toBe("paid");
    expect(depositPaymentState({ ...paid, amountRefundedMinor: 10_000 })).toBe("partially_refunded");
    expect(depositPaymentState({ ...paid, amountRefundedMinor: 50_000 })).toBe("refunded");
  });

  it("calls a payment reported without an amount a mismatch, never paid", () => {
    expect(depositPaymentState({ ...NONE, paidAt: AT })).toBe("mismatch");
  });

  it("calls a payment that is not the amount or currency asked for a mismatch, never paid", () => {
    expect(depositPaymentState({ ...NONE, paidAt: AT, amountReceivedMinor: 40_000, currencyReceived: "GBP" })).toBe("mismatch");
    expect(depositPaymentState({ ...NONE, paidAt: AT, amountReceivedMinor: 50_000, currencyReceived: "EUR" })).toBe("mismatch");
  });

  it("orders the unpaid outcomes: a failed bank payment, processing, a lapsed page, a declined card", () => {
    expect(depositPaymentState({ ...NONE, processingAt: AT, failedAt: AT })).toBe("failed");
    expect(depositPaymentState({ ...NONE, processingAt: AT, declinedAt: AT })).toBe("processing");
    expect(depositPaymentState({ ...NONE, declinedAt: AT, expiredAt: AT })).toBe("expired");
    expect(depositPaymentState({ ...NONE, declinedAt: AT })).toBe("declined");
  });

  it("gives a request the state of the attempt that settled it, else requested or cancelled", () => {
    expect(depositRequestState(false, [])).toBe("requested");
    expect(depositRequestState(true, [{ state: "expired" }])).toBe("cancelled");
    expect(depositRequestState(false, [{ state: "declined" }, { state: "paid" }])).toBe("paid");
    expect(depositRequestState(true, [{ state: "paid" }])).toBe("paid");
    expect(depositRequestState(false, [{ state: "paid" }, { state: "mismatch" }])).toBe("mismatch");
  });

  it("writes money the way the venue reads it", () => {
    expect(formatDepositMoney(62_500, "GBP")).toBe("£625.00");
  });
});
