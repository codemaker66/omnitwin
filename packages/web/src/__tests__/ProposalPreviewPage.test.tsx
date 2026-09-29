import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError } from "../api/client.js";
import type { PublicProposal } from "../api/proposals.js";
import { ProposalPreviewPage, previewStanding } from "../pages/ProposalPreviewPage.js";

const mocks = vi.hoisted(() => ({
  getProposalPreview: vi.fn(),
  getProposalShare: vi.fn(),
  getPublicProposal: vi.fn(),
  approveProposalShare: vi.fn(),
  commentOnProposalShare: vi.fn(),
  respondToProposal: vi.fn(),
}));

vi.mock("../api/proposals.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api/proposals.js")>(),
  ...mocks,
}));

// ---------------------------------------------------------------------------
// Preview as the client (roadmap X1): the latest saved version, exactly as
// the client's page draws it, with a band saying which version the client's
// link shows, and nothing a client could answer. No public endpoint is
// called, so it is never counted as the link being opened.
// ---------------------------------------------------------------------------

function preview(overrides: Partial<PublicProposal> = {}): PublicProposal {
  return {
    title: "Crawford wedding proposal",
    status: "changes_requested",
    sentAt: "2026-09-29T10:00:00.000Z",
    venueName: "Trades Hall Glasgow",
    venueSlug: "trades-hall-glasgow",
    venueAddress: null,
    preparedAt: "2026-10-05T15:00:00.000Z",
    sentVersion: 2,
    linkOpen: true,
    facts: { eventDate: "2027-06-05", guestCount: 160, occasion: "wedding", roomName: "Grand Hall", roomSlug: "grand-hall" },
    accepted: null,
    clientMessage: "Planning-grade proposal for your wedding on 5 June.",
    capacityNote: null,
    quote: {
      quoteId: null, currency: "GBP", subtotalMinor: 1_760_000, totalMinor: 1_760_000,
      lineItems: [{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: 1_760_000, lineTotalMinor: 1_760_000 }],
    },
    version: 3,
    ...overrides,
  };
}

function renderPreview(): void {
  render(
    <MemoryRouter initialEntries={["/proposal-preview/p1"]}>
      <Routes>
        <Route path="/proposal-preview/:proposalId" element={<ProposalPreviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Preview as the client", () => {
  it("draws the latest version as the client's page does, says the link still shows the one sent, and asks nothing", async () => {
    mocks.getProposalPreview.mockResolvedValue(preview());
    renderPreview();

    expect(await screen.findByRole("heading", { level: 1, name: "Crawford wedding proposal" })).toBeDefined();
    expect(mocks.getProposalPreview).toHaveBeenCalledWith("p1");
    expect(screen.getByTestId("preview-band").textContent).toBe(
      "Preview of version 3, as the client sees it. It has not been sent yet; the client's link shows version 2. Opening it here is not counted as the link being opened.",
    );
    // Changes were asked for on version 2, not on this unsent version 3.
    expect(screen.queryByTestId("proposal-standing")).toBeNull();
    const decision = within(screen.getByTestId("preview-decision"));
    expect(decision.getByText("Version 3 comes to £17,600.00.")).toBeDefined();
    expect(decision.queryByRole("button")).toBeNull();
    expect(decision.queryByRole("textbox")).toBeNull();
    // Nothing public is called: no view is stamped and nothing can be answered.
    for (const name of ["getProposalShare", "getPublicProposal", "approveProposalShare", "commentOnProposalShare", "respondToProposal"] as const) {
      expect(mocks[name]).not.toHaveBeenCalled();
    }
    // An effect sets the title after the loaded preview renders; on a busy runner it can run
    // after the heading is found, so wait for the title rather than reading it at once.
    await waitFor(() => { expect(document.title).toBe("Preview — Crawford wedding proposal — Trades Hall Glasgow — version 3"); });
  });

  it("says which version the client's link shows, and when that link no longer opens", () => {
    expect(previewStanding(1, null)).toBe("It has not been sent yet.");
    expect(previewStanding(2, 2)).toBe("This is the version the client's link shows.");
    expect(previewStanding(3, 2)).toBe("It has not been sent yet; the client's link shows version 2.");
    expect(previewStanding(2, 2, false)).toBe("It was sent, but the client's link no longer opens.");
    expect(previewStanding(3, 2, false)).toBe("It has not been sent; the client's link, which showed version 2, no longer opens.");
  });

  it("previews an accepted proposal the team archived as the client still sees it, and prints what it is", async () => {
    mocks.getProposalPreview.mockResolvedValue(preview({
      status: "accepted", version: 2, sentVersion: 2, accepted: { by: "Elaine Crawford", at: "2026-10-06T10:00:00.000Z" },
    }));
    renderPreview();
    expect((await screen.findByTestId("preview-band")).textContent).toContain("This is the version the client's link shows.");
    expect(screen.getByTestId("proposal-standing").textContent).toContain("Accepted by Elaine Crawford");
    // Nothing to answer, as on the client's page.
    expect(screen.queryByTestId("preview-decision")).toBeNull();
    // The band goes to paper, so a printed preview says it is one.
    expect(screen.getByTestId("preview-band").classList.contains("pd-band--prints")).toBe(true);
  });

  it("prints no standing on a version not yet sent, and says a closed link is closed", async () => {
    mocks.getProposalPreview.mockResolvedValue(preview());
    renderPreview();
    await screen.findByTestId("preview-band");
    // Version 3 is unsent: the sent version's standing is not printed on it.
    expect(document.querySelector(".pd-printed-decision")).toBeNull();
    cleanup();

    mocks.getProposalPreview.mockResolvedValue(preview({ status: "withdrawn", version: 2, sentVersion: 2, linkOpen: false }));
    renderPreview();
    expect((await screen.findByTestId("preview-band")).textContent).toContain("It was sent, but the client's link no longer opens.");
    expect(screen.queryByTestId("proposal-standing")).toBeNull();
    expect(screen.queryByTestId("preview-decision")).toBeNull();
  });

  it("says why there is no preview, in words", async () => {
    mocks.getProposalPreview.mockRejectedValue(new ApiError(422, "No version", "PROPOSAL_HAS_NO_VERSION"));
    renderPreview();
    expect((await screen.findByRole("alert")).textContent).toBe("Nothing is saved on this proposal yet. Save a version, then preview it.");
    cleanup();

    mocks.getProposalPreview.mockRejectedValue(new ApiError(403, "Forbidden", "FORBIDDEN"));
    renderPreview();
    expect((await screen.findByRole("alert")).textContent).toBe("This proposal is not one you can preview.");
  });
});
