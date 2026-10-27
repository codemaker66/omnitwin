import { describe, expect, it } from "vitest";
import type { DepositPaymentView, DepositRequestView } from "@omnitwin/types";
import { depositAskedWords, depositStateWords, depositWithdrawable, parsePercentToBasisPoints, previewPercent } from "../deposit-format.js";

const REQUEST: DepositRequestView = {
  id: "8c6d4f7e-1d0b-4e37-9a38-7b1f2f0c9d11",
  state: "requested",
  basis: "percent",
  percentBasisPoints: 2_500,
  amountMinor: 62_500,
  currency: "GBP",
  quoteTotalMinor: 250_000,
  proposalVersion: 1,
  createdAt: "2026-10-27T10:00:00.000Z",
  cancelledAt: null,
  payments: [],
};

function attempt(overrides: Partial<DepositPaymentView>): DepositPaymentView {
  return {
    id: "2a6d4f7e-1d0b-4e37-9a38-7b1f2f0c9d11", state: "open", amountMinor: 62_500, currency: "GBP", amountReceivedMinor: null,
    amountRefundedMinor: 0, failureMessage: null, createdAt: "2026-10-27T11:00:00.000Z", paidAt: null, lastEventAt: null, ...overrides,
  };
}

describe("the deposit on the desk, in the booker's words", () => {
  it("reads a percentage in basis points, never a floating rate", () => {
    expect(parsePercentToBasisPoints("25")).toBe(2_500);
    expect(parsePercentToBasisPoints("12.5")).toBe(1_250);
    expect(parsePercentToBasisPoints("33.33%")).toBe(3_333);
    expect(parsePercentToBasisPoints("100")).toBe(10_000);
    for (const bad of ["", "0", "100.01", "12.345", "-5", "ten", "1,000"]) expect(parsePercentToBasisPoints(bad)).toBeNull();
  });

  it("previews what the API will ask for, a half penny rounding up", () => {
    expect(previewPercent(250_000, 2_500)).toBe(62_500);
    expect(previewPercent(333, 5_000)).toBe(167);
  });

  it("says what was asked for and from which accepted version", () => {
    expect(depositAskedWords(REQUEST)).toBe("£625.00, 25% of version 1's £2,500.00");
    expect(depositAskedWords({ ...REQUEST, basis: "amount", percentBasisPoints: null, amountMinor: 50_000 })).toBe("£500.00, against version 1's £2,500.00");
  });

  it("says where it stands from what Stripe reported, the declines and refunds included", () => {
    expect(depositStateWords(REQUEST)).toBe("Waiting for the client. They have not opened the payment page.");
    expect(depositStateWords({ ...REQUEST, payments: [attempt({ state: "declined", failureMessage: "Your card was declined." })] }))
      .toBe("The client's last attempt was declined: Your card was declined.");
    expect(depositStateWords({ ...REQUEST, payments: [attempt({ state: "expired" })] })).toContain("lapsed unpaid");
    expect(depositStateWords({ ...REQUEST, state: "partially_refunded", payments: [attempt({ state: "partially_refunded", paidAt: "2026-10-27T11:05:00.000Z", amountRefundedMinor: 10_000 })] }))
      .toContain("£100.00 refunded in Stripe.");
    expect(depositStateWords({ ...REQUEST, state: "refunded", payments: [attempt({ state: "refunded" })] })).toBe("Paid, then refunded in full in Stripe.");
    expect(depositStateWords({ ...REQUEST, state: "mismatch", payments: [attempt({ state: "mismatch", amountReceivedMinor: 100 })] }))
      .toBe("Stripe reported £1.00 against the £625.00 asked for. Check the payment in Stripe before relying on it.");
  });

  it("can be withdrawn only while nothing is paid or on its way", () => {
    expect(depositWithdrawable(REQUEST)).toBe(true);
    for (const state of ["paid", "processing", "refunded", "partially_refunded", "mismatch", "cancelled"] as const) {
      expect(depositWithdrawable({ ...REQUEST, state })).toBe(false);
    }
  });
});
