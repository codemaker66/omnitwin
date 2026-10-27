import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ClientDepositView, DepositPaymentView, DepositRequestView } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { ClientDeposit, depositAskWords, depositStandingWords } from "../ClientDeposit.js";

const { mockGetShareDeposit, mockStartCheckout } = vi.hoisted(() => ({
  mockGetShareDeposit: vi.fn(),
  mockStartCheckout: vi.fn(),
}));
vi.mock("../../../api/deposits.js", () => ({
  getShareDeposit: mockGetShareDeposit,
  startShareDepositCheckout: mockStartCheckout,
}));

// ---------------------------------------------------------------------------
// The client's deposit below their accepted proposal (Plan 19 L5): what is
// asked and from which version, where it stands as Stripe reported it, Pay
// that opens Stripe's page, the test-mode line, and the words when it fails.
// ---------------------------------------------------------------------------

const TOKEN = "a".repeat(43);
const REQUEST: DepositRequestView = {
  id: "8c6d4f7e-1d0b-4e37-9a38-7b1f2f0c9d11", state: "requested", basis: "percent", percentBasisPoints: 2_500,
  amountMinor: 62_500, currency: "GBP", quoteTotalMinor: 250_000, proposalVersion: 2,
  createdAt: "2026-10-27T10:00:00.000Z", cancelledAt: null, payments: [],
};
const attempt = (overrides: Partial<DepositPaymentView>): DepositPaymentView => ({
  id: "2a6d4f7e-1d0b-4e37-9a38-7b1f2f0c9d11", state: "open", amountMinor: 62_500, currency: "GBP", amountReceivedMinor: null,
  amountRefundedMinor: 0, failureMessage: null, createdAt: "2026-10-27T11:00:00.000Z", paidAt: null, lastEventAt: null, ...overrides,
});
const view = (request: DepositRequestView | null): ClientDepositView => ({ mode: "test", request });

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mockGetShareDeposit.mockReset();
  mockStartCheckout.mockReset();
  assign = vi.fn();
  // Only Pay leaves the page, through location.assign.
  vi.stubGlobal("location", { assign });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the words", () => {
  it("say what is asked, from the version the client accepted", () => {
    expect(depositAskWords(REQUEST)).toBe("A deposit of £625.00, 25% of the £2,500.00 you accepted in version 2.");
  });

  it("say where it stands and whether the client can pay now", () => {
    expect(depositStandingWords(REQUEST)).toEqual({ words: null, payable: true });
    expect(depositStandingWords({ ...REQUEST, payments: [attempt({ state: "declined", failureMessage: "Your card was declined." })] }))
      .toEqual({ words: "Your last attempt did not go through: Your card was declined. You can try again.", payable: true });
    expect(depositStandingWords({ ...REQUEST, state: "paid", payments: [attempt({ state: "paid", paidAt: "2026-10-27T11:05:00.000Z" })] }))
      .toEqual({ words: "£625.00 paid on 27 October 2026.", payable: false });
    expect(depositStandingWords({ ...REQUEST, state: "refunded" }).payable).toBe(false);
    expect(depositStandingWords({ ...REQUEST, state: "processing" }).payable).toBe(false);
    expect(depositStandingWords({ ...REQUEST, state: "mismatch" }).words).toContain("does not match");
  });
});

describe("the deposit section", () => {
  it("shows nothing when the venue has asked for no deposit", async () => {
    mockGetShareDeposit.mockResolvedValue(view(null));
    const { container } = render(<ClientDeposit token={TOKEN} returned={null} />);
    expect(screen.getByRole("status").textContent).toContain("Checking for a deposit");
    await waitFor(() => { expect(container.innerHTML).toBe(""); });
  });

  it("asks, says it is a test, and sends the client to Stripe's page to pay", async () => {
    mockGetShareDeposit.mockResolvedValue(view(REQUEST));
    mockStartCheckout.mockResolvedValue("https://checkout.stripe.com/c/pay/cs_test_1");
    render(<ClientDeposit token={TOKEN} returned={null} />);
    const pay = await screen.findByTestId("pay-deposit");
    expect(pay.textContent).toContain("Pay £625.00");
    expect(screen.getByTestId("deposit-test-mode").textContent).toContain("Stripe takes no real money");
    expect(screen.getByText(/does not confirm the booking/u)).toBeTruthy();
    fireEvent.click(pay);
    expect(pay.getAttribute("aria-busy")).toBe("true");
    expect(pay.textContent).toContain("Opening Stripe…");
    await waitFor(() => { expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_1"); });
    expect(mockStartCheckout).toHaveBeenCalledWith(TOKEN, REQUEST.id);
  });

  it("says plainly when Stripe cannot be reached, and Pay works again", async () => {
    mockGetShareDeposit.mockResolvedValue(view(REQUEST));
    mockStartCheckout.mockRejectedValue(new ApiError(502, "Stripe could not be reached. Nothing was charged. Please try again in a moment.", "PAYMENT_PROVIDER_UNAVAILABLE"));
    render(<ClientDeposit token={TOKEN} returned={null} />);
    fireEvent.click(await screen.findByTestId("pay-deposit"));
    expect((await screen.findByRole("alert")).textContent).toContain("Nothing was charged");
    expect(screen.getByTestId("pay-deposit").hasAttribute("disabled")).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows a paid deposit without a Pay button", async () => {
    mockGetShareDeposit.mockResolvedValue(view({ ...REQUEST, state: "paid", payments: [attempt({ state: "paid", paidAt: "2026-10-27T11:05:00.000Z" })] }));
    render(<ClientDeposit token={TOKEN} returned={null} />);
    expect((await screen.findByTestId("deposit-standing")).textContent).toContain("£625.00 paid on 27 October 2026.");
    expect(screen.queryByTestId("pay-deposit")).toBeNull();
  });

  it("waits for Stripe's confirmation after the client comes back, then shows it", async () => {
    mockGetShareDeposit
      .mockResolvedValueOnce(view({ ...REQUEST, payments: [attempt({ state: "open" })] }))
      .mockResolvedValue(view({ ...REQUEST, state: "paid", payments: [attempt({ state: "paid", paidAt: "2026-10-27T11:05:00.000Z" })] }));
    render(<ClientDeposit token={TOKEN} returned="returned" />);
    expect(await screen.findByText("Waiting for Stripe to confirm your payment…")).toBeTruthy();
    expect(screen.queryByTestId("pay-deposit")).toBeNull();
    expect((await screen.findByTestId("deposit-standing", {}, { timeout: 4_000 })).textContent).toContain("paid on 27 October 2026");
  });

  it("offers to try again when the deposit cannot be read", async () => {
    mockGetShareDeposit.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(view(REQUEST));
    render(<ClientDeposit token={TOKEN} returned={null} />);
    expect((await screen.findByRole("alert")).textContent).toContain("The deposit could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("pay-deposit")).toBeTruthy();
  });
});
