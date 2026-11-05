import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DepositRequestView, StaffDepositView } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
import { DeskProposalSchema, type DeskProposal } from "../../../../api/proposals.js";
import { DepositPanel } from "../DepositPanel.js";

const { mockGet, mockRequest, mockCancel } = vi.hoisted(() => ({ mockGet: vi.fn(), mockRequest: vi.fn(), mockCancel: vi.fn() }));
vi.mock("../../../../api/deposits.js", () => ({
  getProposalDeposit: mockGet,
  requestProposalDeposit: mockRequest,
  cancelProposalDeposit: mockCancel,
}));

// ---------------------------------------------------------------------------
// The deposit on the Proposals desk (Plan 19 L5): ask for a percentage of the
// accepted quote, seeing what it comes to before asking; hear a refusal in
// the API's words; withdraw an unpaid request; say test mode every time.
// ---------------------------------------------------------------------------

const PROPOSAL: DeskProposal = DeskProposalSchema.parse({
  id: "6e7c3b2a-0b4d-4a61-8f2e-1c9d8e7f6a5b", venueId: "2f1e0d9c-8b7a-4c6d-9e5f-4a3b2c1d0e9f", opportunityId: null, enquiryId: null,
  configurationId: null, title: "Autumn gala", status: "accepted", currentVersion: 1, shareCode: null, sentAt: "2026-10-20T10:00:00.000Z",
  createdBy: null, createdAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-21T10:00:00.000Z", deletedAt: null,
  sentVersion: 1, latestTotalMinor: 250_000, latestCurrency: "GBP",
});

const REQUEST: DepositRequestView = {
  id: "8c6d4f7e-1d0b-4e37-9a38-7b1f2f0c9d11", state: "requested", basis: "percent", percentBasisPoints: 2_500, amountMinor: 62_500,
  currency: "GBP", quoteTotalMinor: 250_000, proposalVersion: 1, createdAt: "2026-10-27T10:00:00.000Z", cancelledAt: null, payments: [],
};
const view = (requests: readonly DepositRequestView[], availability: StaffDepositView["availability"] = "test"): StaffDepositView => ({ availability, requests: [...requests] });

beforeEach(() => { mockGet.mockReset(); mockRequest.mockReset(); mockCancel.mockReset(); });
afterEach(() => { cleanup(); });

describe("the deposit on the desk", () => {
  it("previews the percentage of the accepted quote and asks for exactly that", async () => {
    mockGet.mockResolvedValueOnce(view([])).mockResolvedValue(view([REQUEST]));
    mockRequest.mockResolvedValue(REQUEST);
    render(<DepositPanel proposal={PROPOSAL} />);
    fireEvent.change(await screen.findByTestId("deposit-value"), { target: { value: "25" } });
    expect(screen.getByText("Comes to £625.00 of the £2,500.00 accepted in version 1.")).toBeTruthy();
    const ask = screen.getByTestId("deposit-ask-button");
    expect(ask.textContent).toBe("Ask for £625.00");
    fireEvent.click(ask);
    await waitFor(() => { expect(mockRequest).toHaveBeenCalledWith(PROPOSAL.id, { basis: "percent", percentBasisPoints: 2_500, version: 1 }); });
    expect((await screen.findByTestId("deposit-asked")).textContent).toBe("£625.00, 25% of version 1's £2,500.00");
    expect(screen.getByTestId("deposit-state").textContent).toContain("Waiting for the client");
    expect(screen.getByTestId("deposit-test-mode").textContent).toContain("no real money moves");
  });

  it("will not ask for more than the accepted quote, and says the API's refusal", async () => {
    mockGet.mockResolvedValue(view([]));
    mockRequest.mockRejectedValue(new ApiError(422, "Stripe cannot take a payment this small. The smallest is £0.30.", "DEPOSIT_UNDER_MINIMUM"));
    render(<DepositPanel proposal={PROPOSAL} />);
    fireEvent.click(await screen.findByRole("radio", { name: /An amount/u }));
    const value = screen.getByTestId("deposit-value");
    fireEvent.change(value, { target: { value: "2600" } });
    expect(screen.getByText("More than the £2,500.00 accepted.")).toBeTruthy();
    expect(screen.getByTestId("deposit-ask-button").hasAttribute("disabled")).toBe(true);
    fireEvent.change(value, { target: { value: "0.10" } });
    fireEvent.click(screen.getByTestId("deposit-ask-button"));
    expect((await screen.findByRole("alert")).textContent).toBe("Stripe cannot take a payment this small. The smallest is £0.30.");
  });

  it("withdraws an unpaid request, and offers no withdrawal once paid", async () => {
    mockGet.mockResolvedValueOnce(view([REQUEST])).mockResolvedValue(view([{ ...REQUEST, state: "cancelled", cancelledAt: "2026-10-27T12:00:00.000Z" }]));
    mockCancel.mockResolvedValue({ ...REQUEST, state: "cancelled" });
    render(<DepositPanel proposal={PROPOSAL} />);
    fireEvent.click(await screen.findByTestId("deposit-withdraw"));
    await waitFor(() => { expect(mockCancel).toHaveBeenCalledWith(PROPOSAL.id, REQUEST.id); });
    expect(await screen.findByTestId("deposit-ask")).toBeTruthy();
    expect(screen.getByText("Earlier requests (1)")).toBeTruthy();
    cleanup();
    mockGet.mockReset();
    mockGet.mockResolvedValue(view([{ ...REQUEST, state: "paid", payments: [{
      id: "2a6d4f7e-1d0b-4e37-9a38-7b1f2f0c9d11", state: "paid", amountMinor: 62_500, currency: "GBP", amountReceivedMinor: 62_500,
      amountRefundedMinor: 0, failureMessage: null, createdAt: "2026-10-27T11:00:00.000Z", paidAt: "2026-10-27T11:05:00.000Z", lastEventAt: null,
    }] }]));
    render(<DepositPanel proposal={PROPOSAL} />);
    expect((await screen.findByTestId("deposit-state")).textContent).toMatch(/^Paid/u);
    expect(screen.queryByTestId("deposit-withdraw")).toBeNull();
  });

  it("says when deposits are not set up for the venue", async () => {
    mockGet.mockResolvedValue(view([], "off"));
    render(<DepositPanel proposal={PROPOSAL} />);
    expect(await screen.findByText(/Deposits are not set up for this venue/u)).toBeTruthy();
    expect(screen.queryByTestId("deposit-ask")).toBeNull();
  });
});
