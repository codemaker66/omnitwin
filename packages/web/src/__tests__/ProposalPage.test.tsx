import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError } from "../api/client.js";
import { ProposalPage } from "../pages/ProposalPage.js";
import { PublicProposalSchema, type PublicProposal } from "../api/proposals.js";

const {
  mockApproveProposalShare,
  mockCommentOnProposalShare,
  mockGetProposalShare,
  mockGetPublicProposal,
  mockRespondToProposal,
} = vi.hoisted(() => ({
  mockApproveProposalShare: vi.fn(),
  mockCommentOnProposalShare: vi.fn(),
  mockGetProposalShare: vi.fn(),
  mockGetPublicProposal: vi.fn(),
  mockRespondToProposal: vi.fn(),
}));

vi.mock("../api/proposals.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/proposals.js")>();
  return {
    ...actual,
    approveProposalShare: mockApproveProposalShare,
    commentOnProposalShare: mockCommentOnProposalShare,
    getProposalShare: mockGetProposalShare,
    getPublicProposal: mockGetPublicProposal,
    respondToProposal: mockRespondToProposal,
  };
});

// ---------------------------------------------------------------------------
// The client's proposal page (roadmap X1): the document, and the decision at
// its foot. Accepting asks for a name on a link; every answer names the
// version read; a refused answer reads the proposal again and keeps what was
// typed.
// ---------------------------------------------------------------------------

const QUOTE: NonNullable<PublicProposal["quote"]> = {
  quoteId: null,
  currency: "GBP",
  lineItems: [
    { description: "Grand Hall hire", quantity: 1, unitAmountMinor: 250000, lineTotalMinor: 250000 },
    { description: "Round table", quantity: 12, unitAmountMinor: 1250, lineTotalMinor: 15000 },
  ],
  subtotalMinor: 265000,
  totalMinor: 265000,
};

function fixtureProposal(overrides: Partial<PublicProposal> = {}): PublicProposal {
  return {
    title: "Summer wedding — Grand Hall",
    status: "sent",
    sentAt: "2026-06-11T09:00:00.000Z",
    venueName: "Trades Hall Glasgow",
    venueSlug: "trades-hall-glasgow",
    venueAddress: "85 Glassford Street, Glasgow G1 1UH",
    preparedAt: "2026-06-11T08:30:00.000Z",
    sentVersion: null,
    facts: { eventDate: "2027-06-05", guestCount: 160, occasion: "wedding", roomName: "Grand Hall", roomSlug: "grand-hall" },
    accepted: null,
    clientMessage: "Planning-grade draft for your review.",
    capacityNote: "Comfortable for around 120 guests.",
    quote: QUOTE,
    version: 1,
    ...overrides,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/proposal/abcdef"]}>
      <Routes>
        <Route path="/proposal/:shareCode" element={<ProposalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderTokenPage(): void {
  render(
    <MemoryRouter initialEntries={["/proposal-share/client-token"]}>
      <Routes>
        <Route path="/proposal-share/:token" element={<ProposalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockApproveProposalShare.mockReset();
  mockCommentOnProposalShare.mockReset();
  mockGetProposalShare.mockReset();
  mockGetPublicProposal.mockReset();
  mockRespondToProposal.mockReset();
});

// RTL auto-cleanup is not wired globally in this suite's environment.
afterEach(() => {
  cleanup();
});

describe("the document", () => {
  it("states the event, the version, the exact quote and one caveat that leaves the price alone", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal());
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Summer wedding — Grand Hall" })).toBeTruthy();
    expect(screen.getByText("Trades Hall Glasgow")).toBeTruthy();
    expect(screen.getByText("Version 1 · prepared 11 June 2026")).toBeTruthy();
    const facts = within(screen.getByTestId("proposal-facts"));
    expect(facts.getByText("Saturday 5 June 2027")).toBeTruthy();
    expect(facts.getByText("160")).toBeTruthy();
    expect(facts.getByText("Wedding")).toBeTruthy();
    expect(facts.getByText("Grand Hall")).toBeTruthy();
    expect(screen.getByText("£12.50")).toBeTruthy();
    expect(within(screen.getByTestId("proposal-total")).getByText("£2,650.00")).toBeTruthy();
    expect(screen.getByText("Version 1 comes to £2,650.00.")).toBeTruthy();
    expect(screen.getAllByText(/planning estimates/u)).toHaveLength(1);
    expect(screen.getByText(/Capacity and layout are the venue team's planning estimates/u)).toBeTruthy();
    expect(screen.getByText("Trades Hall Glasgow, 85 Glassford Street, Glasgow G1 1UH")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept version 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask for changes…" })).toBeTruthy();
    // The tab, and so a saved PDF, is named for the proposal.
    await waitFor(() => { expect(document.title).toBe("Summer wedding — Grand Hall — Trades Hall Glasgow — version 1"); });
  });

  it("leaves out what is not known, and an occasion that only says 'other'", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal({
      facts: { eventDate: null, guestCount: null, occasion: "other", roomName: "Saloon", roomSlug: "saloon" },
    }));
    renderPage();
    const facts = within(await screen.findByTestId("proposal-facts"));
    expect(facts.getAllByRole("definition").map((node) => node.textContent)).toEqual(["Saloon"]);
    expect(screen.queryByText("Other occasion")).toBeNull();
  });

  it("shows a supplied photograph only of Trades Hall's own room", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal());
    renderPage();
    expect((await screen.findByRole("img", { name: "The Grand Hall" })).getAttribute("src")).toMatch(/grand-hall/u);
    cleanup();

    // Another venue's "Grand Hall" is not this one.
    mockGetPublicProposal.mockResolvedValue(fixtureProposal({ venueSlug: "another-venue" }));
    renderPage();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("img", { name: "The Grand Hall" })).toBeNull();
    cleanup();

    // A room with no supplied photograph shows none rather than a render.
    mockGetPublicProposal.mockResolvedValue(fixtureProposal({
      facts: { eventDate: null, guestCount: null, occasion: null, roomName: "Boardroom", roomSlug: "boardroom" },
    }));
    renderPage();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("img", { name: "The Boardroom" })).toBeNull();
  });

  it("says where it stands once near the top, and asks nothing, when the client has already answered", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal({
      status: "accepted", accepted: { by: "Elaine Crawford", at: "2026-10-01T09:30:00.000Z" },
    }));
    renderPage();
    expect((await screen.findByTestId("proposal-standing")).textContent).toBe("Accepted by Elaine Crawford on 1 October 2026.");
    expect(screen.queryByTestId("proposal-decision")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("says a declined or expired proposal is so, with nothing to press", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal({ status: "expired" }));
    renderPage();
    expect((await screen.findByTestId("proposal-standing")).textContent)
      .toBe("This proposal has expired. Ask the venue team for a current one.");
    expect(screen.queryByRole("button", { name: /Accept/u })).toBeNull();
  });

  it("shows the plain-English unavailable state when the link cannot be read", async () => {
    mockGetPublicProposal.mockRejectedValue(new Error("404"));
    renderPage();
    expect(await screen.findByText("This proposal link isn't available")).toBeTruthy();
  });

  it("draws the layout to scale when there is one, on ivory", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal({
      layoutSnapshot: {
        roomWidthM: 20,
        roomLengthM: 10,
        items: [
          { shape: "round", kind: "table", xM: 4, zM: 3, widthM: 1.8, depthM: 1.8, rotationDeg: 0 },
          { shape: "rect", kind: "chair", xM: 4, zM: 4.5, widthM: 0.45, depthM: 0.45, rotationDeg: 0 },
        ],
      },
    }));
    renderPage();
    const plan = await screen.findByTestId("proposal-layout-visual");
    expect(plan.querySelector("ellipse")?.getAttribute("stroke")).toBe("#94491f");
    expect(screen.getByRole("heading", { level: 2, name: "The layout" })).toBeTruthy();
    cleanup();

    mockGetPublicProposal.mockResolvedValue(fixtureProposal());
    renderPage();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByTestId("proposal-layout-visual")).toBeNull();
  });
});

describe("the decision", () => {
  it("accepts through the older share code with the version read, reads the proposal again and says so where the buttons were", async () => {
    mockGetPublicProposal
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({ status: "accepted", accepted: { by: null, at: "2026-10-01T09:30:00.000Z" } }));
    mockRespondToProposal.mockResolvedValue({ status: "accepted" });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Accept version 1" }));
    await waitFor(() => { expect(mockRespondToProposal).toHaveBeenCalledWith("abcdef", "accept", undefined, 1); });
    const outcome = await screen.findByText("You accepted this version. The venue team has been told.");
    await waitFor(() => { expect(document.activeElement).toBe(outcome); });
    expect(mockGetPublicProposal).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("proposal-standing").textContent).toBe("Accepted on 1 October 2026.");
    expect(screen.queryByRole("button", { name: "Accept version 1" })).toBeNull();
  });

  it("asks the name to accept in on a link, and sends it with the version", async () => {
    mockGetProposalShare.mockResolvedValue(fixtureProposal({
      comments: [{ kind: "comment", authorName: "Elaine", body: "Looks good.", createdAt: "2026-06-11T10:00:00.000Z" }],
    }));
    mockApproveProposalShare.mockResolvedValue({ status: "accepted" });
    renderTokenPage();

    fireEvent.click(await screen.findByRole("button", { name: "Accept version 1" }));
    expect(await screen.findByText("Please give your name to accept.")).toBeTruthy();
    expect(mockApproveProposalShare).not.toHaveBeenCalled();
    const name = screen.getByLabelText("Your name");
    expect(document.activeElement).toBe(name);
    expect(name.getAttribute("autocomplete")).toBe("name");
    expect(name.getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(name, { target: { value: "  Elaine Crawford " } });
    fireEvent.click(screen.getByRole("button", { name: "Accept version 1" }));
    await waitFor(() => { expect(mockApproveProposalShare).toHaveBeenCalledWith("client-token", { authorName: "Elaine Crawford", version: 1 }); });
    expect(mockRespondToProposal).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/proposalId|quoteId|share token|internal/iu);
  });

  it("asks what to change, and says what asking does", async () => {
    mockGetProposalShare.mockResolvedValue(fixtureProposal());
    mockCommentOnProposalShare.mockResolvedValue({ kind: "request_changes", authorName: null, body: "Could we seat 130?", createdAt: "2026-06-11T10:00:00.000Z" });
    renderTokenPage();

    fireEvent.click(await screen.findByRole("button", { name: "Ask for changes…" }));
    const note = screen.getByLabelText("What would you like changed?");
    await waitFor(() => { expect(document.activeElement).toBe(note); });
    expect(screen.getByText("This version is put on hold until the venue team sends the next one.")).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send to the venue team" });
    expect((send as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(note, { target: { value: "Could we seat 130?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the venue team" }));
    await waitFor(() => {
      expect(mockCommentOnProposalShare).toHaveBeenCalledWith("client-token", { body: "Could we seat 130?", kind: "request_changes", version: 1 });
    });
    expect(await screen.findByText("Your changes went to the venue team. This version is on hold until they send the next one.")).toBeTruthy();
  });

  it("when a newer version arrived after the page opened, shows it and keeps the name typed", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({
        version: 2,
        quote: { ...QUOTE, subtotalMinor: 270000, totalMinor: 270000, lineItems: [{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: 270000, lineTotalMinor: 270000 }] },
      }));
    mockApproveProposalShare.mockRejectedValue(new ApiError(409, "Changed", "PROPOSAL_VERSION_CHANGED"));
    renderTokenPage();

    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Elaine Crawford" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept version 1" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("A newer version arrived after you opened this page. It is shown above now; what you typed is still here.");
    expect(await screen.findByRole("button", { name: "Accept version 2" })).toBeTruthy();
    expect((screen.getByLabelText("Your name")).value).toBe("Elaine Crawford");
    expect(screen.getByText("Version 2 comes to £2,700.00.")).toBeTruthy();
  });

  it("keeps the answer ready to send again when it did not arrive", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal());
    mockRespondToProposal.mockRejectedValue(new Error("network"));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Accept version 1" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("Your answer did not reach the venue team. Please try again, or contact them directly.");
    expect(screen.getByRole("button", { name: "Accept version 1" })).toBeTruthy();
  });
});

describe("the conversation", () => {
  it("posts a message on a link and shows it, the venue's replies as the venue team's, without the automatic acceptance note", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal({
        comments: [
          { kind: "comment", authorName: "Venue team", body: "Happy to hold the Saturday.", createdAt: "2026-06-11T10:00:00.000Z", from: "venue" },
          { kind: "approval_note", authorName: null, body: "Client approved the proposal.", createdAt: "2026-06-11T10:30:00.000Z" },
        ],
      }))
      .mockResolvedValueOnce(fixtureProposal({
        comments: [{ kind: "comment", authorName: null, body: "Can we add a cheese table?", createdAt: "2026-06-11T11:00:00.000Z", from: "client" }],
      }));
    mockCommentOnProposalShare.mockResolvedValue({ kind: "comment", authorName: null, body: "Can we add a cheese table?", createdAt: "2026-06-11T11:00:00.000Z" });
    renderTokenPage();

    const thread = within(await screen.findByTestId("proposal-comments"));
    expect(thread.getByText("The venue team")).toBeTruthy();
    expect(thread.queryByText("Client approved the proposal.")).toBeNull();

    fireEvent.change(thread.getByTestId("comment-input"), { target: { value: "Can we add a cheese table?" } });
    fireEvent.click(thread.getByTestId("comment-submit"));
    await waitFor(() => { expect(mockCommentOnProposalShare).toHaveBeenCalledWith("client-token", { body: "Can we add a cheese table?", kind: "comment" }); });
    expect(await thread.findByText("Can we add a cheese table?")).toBeTruthy();
    expect(thread.getByText("You")).toBeTruthy();
  });

  it("is not offered on the older share code, which has nowhere to post", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal());
    renderPage();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByTestId("comment-input")).toBeNull();
  });
});

describe("PublicProposalSchema boundary validation", () => {
  it("accepts the fixture, fills what an older API does not send, and rejects malformed payloads", () => {
    expect(PublicProposalSchema.safeParse(fixtureProposal()).success).toBe(true);
    const {
      facts: _facts, accepted: _accepted, venueSlug: _slug, venueAddress: _address, preparedAt: _prepared, sentVersion: _sent, ...older
    } = fixtureProposal();
    const parsed = PublicProposalSchema.parse(older);
    expect(parsed.facts).toEqual({ eventDate: null, guestCount: null, occasion: null, roomName: null, roomSlug: null });
    expect([parsed.accepted, parsed.venueSlug, parsed.preparedAt, parsed.sentVersion]).toEqual([null, null, null, null]);
    expect(PublicProposalSchema.safeParse({ ...fixtureProposal(), status: "approved" }).success).toBe(false);
    expect(PublicProposalSchema.safeParse({ ...fixtureProposal(), version: 0 }).success).toBe(false);
    expect(PublicProposalSchema.safeParse({ ...fixtureProposal(), quote: { ...QUOTE, subtotalMinor: 1 } }).success).toBe(false);
  });
});
