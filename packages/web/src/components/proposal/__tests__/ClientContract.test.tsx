import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CONTRACT_CONSENT_STATEMENT, type ClientContractView, type ContractDocument } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { ClientContract, contractPreparedWords } from "../ClientContract.js";

const { mockGet, mockSign } = vi.hoisted(() => ({ mockGet: vi.fn(), mockSign: vi.fn() }));
vi.mock("../../../api/contracts.js", () => ({ getShareContract: mockGet, signShareContract: mockSign }));

// ---------------------------------------------------------------------------
// The client's contract (Plan 19 L5): the document to read, a name typed and
// the statement ticked to sign, what the record keeps said before signing,
// and a contract changed while the page was open refused with the new one
// shown and the typed name kept.
// ---------------------------------------------------------------------------

const TOKEN = "a".repeat(43);
const DOCUMENT: ContractDocument = {
  schemaVersion: "venviewer.contract.v1",
  contractVersion: 1,
  preparedAt: "2026-10-27T10:00:00.000Z",
  venue: { name: "Trades Hall Glasgow", address: "85 Glassford Street, Glasgow G1 1UH" },
  client: { name: "Ada Client", email: "ada@example.test" },
  proposal: { title: "Autumn gala", version: 1, versionHash: "b".repeat(64) },
  event: { eventDate: "2026-12-05", guestCount: 180, occasion: "gala", roomName: "Grand Hall", roomSlug: "grand-hall" },
  quote: { quoteId: null, currency: "GBP", lineItems: [{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: 250_000, lineTotalMinor: 250_000 }], subtotalMinor: 250_000, totalMinor: 250_000 },
  terms: "1. The deposit is 25% of the hire fee.",
};
const HASH = "c".repeat(64);
const view = (overrides: Partial<NonNullable<ClientContractView["contract"]>> = {}): ClientContractView => ({
  consentStatement: CONTRACT_CONSENT_STATEMENT,
  contract: { version: 1, document: DOCUMENT, documentHash: HASH, signature: null, signable: true, ...overrides },
});

beforeEach(() => { mockGet.mockReset(); mockSign.mockReset(); });
afterEach(() => { cleanup(); });

describe("the client's contract", () => {
  it("says which version it is and the proposal it embodies", () => {
    expect(contractPreparedWords(1, DOCUMENT)).toBe("Version 1 of the contract, prepared 27 October 2026, for the proposal you accepted (version 1).");
  });

  it("shows the document, the record a signature keeps, and signs with the name and the statement", async () => {
    mockGet.mockResolvedValueOnce(view()).mockResolvedValue(view({ signature: { signerName: "Ada Client", signedAt: "2026-10-27T11:00:00.000Z" } }));
    mockSign.mockResolvedValue({ signerName: "Ada Client", signedAt: "2026-10-27T11:00:00.000Z", already: false });
    render(<ClientContract token={TOKEN} />);
    const document = await screen.findByTestId("contract-document");
    expect(document.textContent).toContain("Ada Client (ada@example.test)");
    expect(document.textContent).toContain("£2,500.00, as quoted in version 1");
    expect(document.textContent).toContain("1. The deposit is 25% of the hire fee.");
    expect(document.textContent).toContain(HASH);
    expect(screen.getByText(/your email \(ada@example\.test\), the date and time/u)).toBeTruthy();
    expect(screen.getByText(CONTRACT_CONSENT_STATEMENT)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Your full name"), { target: { value: "  Ada Client " } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("sign-contract"));
    await waitFor(() => { expect(mockSign).toHaveBeenCalledWith(TOKEN, { contractVersion: 1, documentHash: HASH, signerName: "Ada Client", consent: true, consentStatement: CONTRACT_CONSENT_STATEMENT }); });
    expect((await screen.findByTestId("contract-signed")).textContent).toBe("Signed by Ada Client on 27 October 2026.");
    expect(screen.queryByTestId("contract-sign")).toBeNull();
  });

  it("asks for the name and the tick before anything is sent", async () => {
    mockGet.mockResolvedValue(view());
    render(<ClientContract token={TOKEN} />);
    fireEvent.click(await screen.findByTestId("sign-contract"));
    expect((await screen.findByRole("alert")).textContent).toBe("Please type your full name to sign.");
    fireEvent.change(screen.getByLabelText("Your full name"), { target: { value: "Ada Client" } });
    fireEvent.click(screen.getByTestId("sign-contract"));
    expect((await screen.findByRole("alert")).textContent).toBe("Please tick the statement to sign.");
    expect(mockSign).not.toHaveBeenCalled();
  });

  it("refuses a contract changed while the page was open, shows the new one, and keeps the name", async () => {
    const changed: ContractDocument = { ...DOCUMENT, contractVersion: 2, terms: `${DOCUMENT.terms}\n2. Music ends at midnight.` };
    mockGet.mockResolvedValueOnce(view()).mockResolvedValue(view({ version: 2, document: changed, documentHash: "d".repeat(64) }));
    mockSign.mockRejectedValue(new ApiError(409, "changed", "CONTRACT_VERSION_CHANGED"));
    render(<ClientContract token={TOKEN} />);
    fireEvent.change(await screen.findByLabelText("Your full name"), { target: { value: "Ada Client" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("sign-contract"));
    expect((await screen.findByRole("alert")).textContent).toContain("changed the contract after you opened this page");
    expect(await screen.findByText(/2\. Music ends at midnight\./u)).toBeTruthy();
    const name = screen.getByLabelText("Your full name");
    expect(name instanceof HTMLInputElement && name.value).toBe("Ada Client");
    const box = screen.getByRole("checkbox");
    expect(box instanceof HTMLInputElement && !box.checked).toBe(true);
    expect(screen.getByTestId("sign-contract").textContent).toBe("Sign version 2");
  });

  it("offers no signature the venue's link can no longer take", async () => {
    mockGet.mockResolvedValue(view({ signable: false }));
    render(<ClientContract token={TOKEN} />);
    expect((await screen.findByTestId("contract-not-signable")).textContent).toContain("can no longer be signed here");
    expect(screen.getByTestId("contract-document")).toBeTruthy();
    expect(screen.queryByTestId("contract-sign")).toBeNull();
  });

  it("shows nothing when the venue has prepared no contract", async () => {
    mockGet.mockResolvedValue({ consentStatement: CONTRACT_CONSENT_STATEMENT, contract: null });
    const { container } = render(<ClientContract token={TOKEN} />);
    await waitFor(() => { expect(container.innerHTML).toBe(""); });
  });
});
