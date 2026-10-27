import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CONTRACT_CONSENT_STATEMENT, type StaffContractVersion, type StaffContractView } from "@omnitwin/types";
import { DeskProposalSchema, type DeskProposal } from "../../../../api/proposals.js";
import { ContractPanel } from "../ContractPanel.js";

const { mockGet, mockPrepare } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPrepare: vi.fn() }));
vi.mock("../../../../api/contracts.js", () => ({ getProposalContract: mockGet, prepareProposalContract: mockPrepare }));

// ---------------------------------------------------------------------------
// The contract on the Proposals desk (Plan 19 L5): prepared from the venue's
// terms against the accepted version; who signed what and when, with the
// record; changing signed terms says a new version is signed afresh.
// ---------------------------------------------------------------------------

const PROPOSAL: DeskProposal = DeskProposalSchema.parse({
  id: "6e7c3b2a-0b4d-4a61-8f2e-1c9d8e7f6a5b", venueId: "2f1e0d9c-8b7a-4c6d-9e5f-4a3b2c1d0e9f", opportunityId: null, enquiryId: null,
  configurationId: null, title: "Autumn gala", status: "accepted", currentVersion: 1, shareCode: null, sentAt: "2026-10-20T10:00:00.000Z",
  createdBy: null, createdAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-21T10:00:00.000Z", deletedAt: null, sentVersion: 1,
});

const VERSION: StaffContractVersion = {
  id: "9d1c0b2a-3e4f-4a5b-8c6d-7e8f9a0b1c2d", version: 1, proposalVersion: 1, documentHash: "c".repeat(64),
  createdAt: "2026-10-27T10:00:00.000Z", createdByLabel: "catherine@trades.test", signature: null,
  document: {
    schemaVersion: "venviewer.contract.v1", contractVersion: 1, preparedAt: "2026-10-27T10:00:00.000Z",
    venue: { name: "Trades Hall Glasgow", address: "85 Glassford Street" }, client: { name: "Ada Client", email: "ada@example.test" },
    proposal: { title: "Autumn gala", version: 1, versionHash: "b".repeat(64) },
    event: { eventDate: null, guestCount: null, occasion: null, roomName: null, roomSlug: null }, quote: null, terms: "1. Deposit 25%.",
  },
};
const SIGNED: StaffContractVersion = {
  ...VERSION,
  signature: {
    signerName: "Ada Client", signerEmail: "ada@example.test", signedAt: "2026-10-27T11:00:00.000Z", documentHash: "c".repeat(64),
    consentStatement: CONTRACT_CONSENT_STATEMENT, userAgent: "Mozilla/5.0 Safari", shareTokenPrefix: "abcdEFGH",
  },
};
const view = (versions: StaffContractVersion[], extra: Partial<StaffContractView> = {}): StaffContractView => ({ acceptedVersion: 1, clientEmail: "ada@example.test", versions, ...extra });

beforeEach(() => { mockGet.mockReset(); mockPrepare.mockReset(); });
afterEach(() => { cleanup(); });

describe("the contract on the desk", () => {
  it("is prepared from the venue's terms against the accepted version", async () => {
    mockGet.mockResolvedValueOnce(view([])).mockResolvedValue(view([VERSION]));
    mockPrepare.mockResolvedValue(VERSION);
    render(<ContractPanel proposal={PROPOSAL} />);
    fireEvent.change(await screen.findByTestId("contract-terms"), { target: { value: "  1. Deposit 25%. " } });
    fireEvent.click(screen.getByTestId("contract-save"));
    await waitFor(() => { expect(mockPrepare).toHaveBeenCalledWith(PROPOSAL.id, { terms: "1. Deposit 25%.", version: 1 }); });
    expect((await screen.findByTestId("contract-version")).textContent).toContain("Version 1, prepared");
    expect(screen.getByTestId("contract-signature").textContent).toBe("Not signed yet. The client signs it on their link.");
  });

  it("shows who signed which version and when, with the record, and says a change is signed afresh", async () => {
    mockGet.mockResolvedValue(view([SIGNED]));
    render(<ContractPanel proposal={PROPOSAL} />);
    expect((await screen.findByTestId("contract-signature")).textContent).toMatch(/^Signed by Ada Client \(ada@example\.test\), /u);
    const record = screen.getByTestId("signature-record");
    expect(record.textContent).toContain("c".repeat(64));
    expect(record.textContent).toContain(CONTRACT_CONSENT_STATEMENT);
    expect(record.textContent).toContain("Mozilla/5.0 Safari");
    expect(record.textContent).toContain("abcdEFGH…");
    fireEvent.click(screen.getByTestId("contract-change"));
    const terms = screen.getByTestId("contract-terms");
    expect(terms instanceof HTMLTextAreaElement && terms.value).toBe("1. Deposit 25%.");
    expect(screen.getByText("Version 1 is signed. Saving makes version 2, which the client signs afresh; the signature on version 1 stays on record.")).toBeTruthy();
    expect(screen.getByTestId("contract-save").textContent).toBe("Save as version 2");
  });

  it("asks for the client's email first, when there is none", async () => {
    mockGet.mockResolvedValue(view([], { clientEmail: null }));
    render(<ContractPanel proposal={PROPOSAL} />);
    expect(await screen.findByText(/Add the client's email to the deal or the enquiry first/u)).toBeTruthy();
    expect(screen.queryByTestId("contract-prepare")).toBeNull();
  });
});
