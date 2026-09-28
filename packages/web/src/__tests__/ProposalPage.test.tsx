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
    linkOpen: true,
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
    // Announced as it appears, not only by the field's description.
    expect((await screen.findByRole("alert")).textContent).toBe("Please give your name to accept.");
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
    expect(screen.getByLabelText<HTMLInputElement>("Your name").value).toBe("Elaine Crawford");
    expect(screen.getByText("Version 2 comes to £2,700.00.")).toBeTruthy();
  });

  it("says so, and claims nothing, when this version had already been accepted", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({ status: "accepted", accepted: { by: "Bea Crawford", at: "2026-06-12T09:00:00.000Z" } }));
    mockApproveProposalShare.mockResolvedValue({ status: "accepted", already: true });
    renderTokenPage();

    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Alex Crawford" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept version 1" }));
    expect((await screen.findByRole("status")).textContent).toBe("This version had already been accepted. Nothing more is needed.");
    expect(screen.queryByText("You accepted this version. The venue team has been told.")).toBeNull();
  });

  it("when the proposal is no longer waiting for an answer, reads it again, says so and keeps what was written", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({ status: "changes_requested" }));
    mockCommentOnProposalShare.mockRejectedValue(new ApiError(422, "Not awaiting", "NOT_AWAITING_RESPONSE"));
    renderTokenPage();

    fireEvent.click(await screen.findByRole("button", { name: "Ask for changes…" }));
    fireEvent.change(screen.getByLabelText("What would you like changed?"), { target: { value: "Could we seat 130?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the venue team" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("This proposal is no longer waiting for an answer. It now shows where it stands.");
    await waitFor(() => { expect(mockGetProposalShare).toHaveBeenCalledTimes(2); });
    expect(screen.getByTestId("kept-note").textContent).toBe("Could we seat 130?");
    // Nothing is offered that would only be refused again.
    expect(screen.queryByRole("button", { name: /Accept version/u })).toBeNull();
    expect(screen.queryByText(/Please try again/u)).toBeNull();
  });

  it("shows the link as unavailable when it was withdrawn while the page was open", async () => {
    mockGetPublicProposal
      .mockResolvedValueOnce(fixtureProposal())
      .mockRejectedValueOnce(new ApiError(404, "Not found", "NOT_FOUND"));
    mockRespondToProposal.mockRejectedValue(new ApiError(404, "Not found", "NOT_FOUND"));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Accept version 1" }));
    const unavailable = await screen.findByRole("heading", { name: "This proposal link isn't available" });
    expect(screen.queryByRole("button", { name: /Accept version/u })).toBeNull();
    // The form that had the focus is gone; the sentence saying why takes it.
    await waitFor(() => { expect(document.activeElement).toBe(unavailable); });
    // Nothing was typed that did not reach the venue team.
    expect(screen.queryByTestId("kept-words")).toBeNull();
  });

  it("returns focus to Ask for changes when the client decides not to", async () => {
    mockGetProposalShare.mockResolvedValue(fixtureProposal());
    renderTokenPage();

    const ask = await screen.findByRole("button", { name: "Ask for changes…" });
    fireEvent.click(ask);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ask for changes…" })); });
  });

  it("says a newer version brought in by a message's read before it can be accepted", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({ version: 2, comments: [{ kind: "comment", authorName: null, body: "Hello", createdAt: "2026-06-12T09:00:00.000Z", from: "client" }] }));
    mockCommentOnProposalShare.mockResolvedValue({ kind: "comment" });
    renderTokenPage();
    fireEvent.change(await screen.findByTestId("comment-input"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send the message" }));
    expect(await screen.findByText("A newer version was sent after you opened this page. It is shown above now.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept version 2" })).toBeTruthy();
  });

  it("drops what this visit's answer said once a newer version is sent, and offers the new one", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({ status: "changes_requested" }))
      .mockResolvedValueOnce(fixtureProposal({ version: 2 }));
    mockCommentOnProposalShare.mockResolvedValueOnce({ kind: "request_changes" }).mockResolvedValueOnce({ kind: "comment" });
    renderTokenPage();
    fireEvent.click(await screen.findByRole("button", { name: "Ask for changes…" }));
    fireEvent.change(screen.getByLabelText("What would you like changed?"), { target: { value: "Could we seat 130?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the venue team" }));
    expect(await screen.findByText("Your changes went to the venue team. This version is on hold until they send the next one.")).toBeTruthy();
    // Later, from the same tab, a message reads the proposal again: version 2 is out.
    fireEvent.change(screen.getByTestId("comment-input"), { target: { value: "Thanks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send the message" }));
    expect(await screen.findByRole("button", { name: "Accept version 2" })).toBeTruthy();
    expect(screen.queryByText("Your changes went to the venue team. This version is on hold until they send the next one.")).toBeNull();
    expect(screen.getByText("A newer version was sent after you opened this page. It is shown above now.")).toBeTruthy();
    // The request already went; it does not come back as an unsent draft.
    expect(screen.queryByLabelText("What would you like changed?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ask for changes…" }));
    expect(screen.getByLabelText<HTMLTextAreaElement>("What would you like changed?").value).toBe("");
  });

  it("offers the same version again once the venue team sends it again after changes were asked for", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({ status: "changes_requested" }))
      .mockResolvedValueOnce(fixtureProposal({ sentAt: "2026-06-13T09:00:00.000Z" }));
    mockCommentOnProposalShare.mockResolvedValueOnce({ kind: "request_changes" }).mockResolvedValueOnce({ kind: "comment" });
    renderTokenPage();
    fireEvent.click(await screen.findByRole("button", { name: "Ask for changes…" }));
    fireEvent.change(screen.getByLabelText("What would you like changed?"), { target: { value: "Could we seat 130?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the venue team" }));
    expect(await screen.findByText("Your changes went to the venue team. This version is on hold until they send the next one.")).toBeTruthy();
    fireEvent.change(screen.getByTestId("comment-input"), { target: { value: "Understood, thank you." } });
    fireEvent.click(screen.getByRole("button", { name: "Send the message" }));
    expect(await screen.findByText("The venue team sent this version to you again. You can answer it below.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept version 1" })).toBeTruthy();
    expect(screen.queryByText("Your changes went to the venue team. This version is on hold until they send the next one.")).toBeNull();
  });

  it("confirms an answer from a page opened before the same version was sent again", async () => {
    // Opened at the first send; meanwhile someone asked for changes and the
    // venue sent version 1 again.
    const resent = "2026-06-13T09:00:00.000Z";
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({ status: "accepted", sentAt: resent, accepted: { by: "Elaine Crawford", at: "2026-06-14T09:00:00.000Z" } }));
    mockApproveProposalShare.mockResolvedValue({ status: "accepted" });
    renderTokenPage();
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Elaine Crawford" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept version 1" }));
    const outcome = await screen.findByText("You accepted this version. The venue team has been told.");
    await waitFor(() => { expect(document.activeElement).toBe(outcome); });
    cleanup();

    mockGetProposalShare.mockReset();
    mockCommentOnProposalShare.mockReset();
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({ status: "changes_requested", sentAt: resent }));
    mockCommentOnProposalShare.mockResolvedValue({ kind: "request_changes" });
    renderTokenPage();
    fireEvent.click(await screen.findByRole("button", { name: "Ask for changes…" }));
    fireEvent.change(screen.getByLabelText("What would you like changed?"), { target: { value: "Could we seat 130?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the venue team" }));
    expect(await screen.findByText("Your changes went to the venue team. This version is on hold until they send the next one.")).toBeTruthy();
  });

  it("drops its answer at once when the answer's own read finds the version sent again", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({ status: "sent", sentAt: "2026-06-13T09:00:00.000Z" }));
    mockCommentOnProposalShare.mockResolvedValue({ kind: "request_changes" });
    renderTokenPage();
    fireEvent.click(await screen.findByRole("button", { name: "Ask for changes…" }));
    fireEvent.change(screen.getByLabelText("What would you like changed?"), { target: { value: "Could we seat 130?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the venue team" }));
    expect(await screen.findByText("The venue team sent this version to you again. You can answer it below.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept version 1" })).toBeTruthy();
    expect(screen.queryByText("Your changes went to the venue team. This version is on hold until they send the next one.")).toBeNull();
  });

  it("gives way to a newer version brought by a message after an answer that did not arrive", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({ version: 2 }));
    mockApproveProposalShare.mockRejectedValueOnce(new Error("network"));
    mockCommentOnProposalShare.mockResolvedValue({ kind: "comment" });
    renderTokenPage();
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Elaine Crawford" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept version 1" }));
    await screen.findByText("Your answer did not reach the venue team. Please try again, or contact them directly.");
    fireEvent.change(screen.getByTestId("comment-input"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send the message" }));
    expect(await screen.findByText("A newer version was sent after you opened this page. It is shown above now.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept version 2" })).toBeTruthy();
    expect(screen.queryByText(/did not reach the venue team/u)).toBeNull();
  });

  it("gives way to a newer version after an answer the proposal could no longer take", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({ status: "changes_requested" }))
      .mockResolvedValueOnce(fixtureProposal({ version: 2 }));
    // Someone else with the link asked for changes first.
    mockApproveProposalShare.mockRejectedValueOnce(new ApiError(422, "Not awaiting", "NOT_AWAITING_RESPONSE"));
    mockCommentOnProposalShare.mockResolvedValue({ kind: "comment" });
    renderTokenPage();
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Bea Crawford" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept version 1" }));
    await screen.findByText("This proposal is no longer waiting for an answer. It now shows where it stands.");
    fireEvent.change(screen.getByTestId("comment-input"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send the message" }));
    expect(await screen.findByText("A newer version was sent after you opened this page. It is shown above now.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept version 2" })).toBeTruthy();
    expect(screen.queryByText(/changed while your answer was on its way/u)).toBeNull();
    expect(within(screen.getByTestId("proposal-decision")).queryByRole("alert")).toBeNull();
  });

  it("says why an answer was refused only once the proposal has been read again, and never more than that read showed", async () => {
    let finish: ((value: PublicProposal) => void) | undefined;
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockImplementationOnce(() => new Promise<PublicProposal>((resolve) => { finish = resolve; }));
    mockApproveProposalShare.mockRejectedValueOnce(new ApiError(422, "Not awaiting", "NOT_AWAITING_RESPONSE"));
    renderTokenPage();
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Bea Crawford" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept version 1" }));
    await waitFor(() => { expect(mockGetProposalShare).toHaveBeenCalledTimes(2); });
    // While it is read again, nothing is claimed and the button says it is working.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Accepting…" })).toBeTruthy();
    finish?.(fixtureProposal({ status: "accepted", accepted: { by: "Alex Crawford", at: "2026-06-12T09:00:00.000Z" } }));
    expect((await screen.findByRole("alert")).textContent).toBe("This proposal is no longer waiting for an answer. It now shows where it stands.");
    cleanup();

    // The read again fails: nothing newer is claimed to be shown.
    mockGetProposalShare.mockReset();
    mockGetProposalShare.mockResolvedValueOnce(fixtureProposal()).mockRejectedValueOnce(new Error("network"));
    mockApproveProposalShare.mockRejectedValueOnce(new ApiError(409, "Changed", "PROPOSAL_VERSION_CHANGED"));
    renderTokenPage();
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Bea Crawford" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept version 1" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("Your answer was not taken, because this proposal changed while it was on its way. Please reload the page to see it as it stands; what you typed is still here.");
    expect(screen.getByLabelText<HTMLInputElement>("Your name").value).toBe("Bea Crawford");
  });

  it("hands back only words that did not reach the venue team when the link closes", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal())
      .mockRejectedValueOnce(new ApiError(404, "Not found", "NOT_FOUND"));
    // A message refused while the proposal changed, then sent again and delivered.
    mockCommentOnProposalShare
      .mockRejectedValueOnce(new ApiError(409, "Changed", "PROPOSAL_STATUS_CHANGED"))
      .mockResolvedValueOnce({ kind: "comment" });
    mockApproveProposalShare.mockRejectedValueOnce(new ApiError(404, "Not found", "NOT_FOUND"));
    renderTokenPage();
    fireEvent.change(await screen.findByTestId("comment-input"), { target: { value: "One more thing." } });
    fireEvent.click(screen.getByRole("button", { name: "Send the message" }));
    await screen.findByText("This proposal changed while your message was on its way. It is still here; you can send it again.");
    fireEvent.click(screen.getByRole("button", { name: "Send the message" }));
    await waitFor(() => { expect(screen.getByTestId<HTMLTextAreaElement>("comment-input").value).toBe(""); });
    // The link is then withdrawn as the client accepts.
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Bea Crawford" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept version 1" }));
    expect(await screen.findByRole("heading", { name: "This proposal link isn't available" })).toBeTruthy();
    expect(screen.queryByTestId("kept-words")).toBeNull();
  });

  it("claims nothing is still here once the form is gone: a newer version accepted by someone else", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({ version: 2, status: "accepted", accepted: { by: "Bea Crawford", at: "2026-06-12T09:00:00.000Z" } }));
    mockApproveProposalShare.mockRejectedValue(new ApiError(409, "Changed", "PROPOSAL_VERSION_CHANGED"));
    renderTokenPage();
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Alex Crawford" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept version 1" }));
    const refusal = await screen.findByText("This proposal is no longer waiting for an answer. It now shows where it stands.");
    expect(screen.queryByText(/still here/u)).toBeNull();
    // Focus goes to the sentence that replaced the form.
    await waitFor(() => { expect(document.activeElement).toBe(refusal); });
  });

  it("returns focus to the button pressed when an answer did not arrive", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal());
    mockRespondToProposal.mockRejectedValue(new Error("network"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Accept version 1" }));
    await screen.findByRole("alert");
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("button", { name: "Accept version 1" })); });
  });

  it("gives back a change request refused because the link was withdrawn", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockRejectedValueOnce(new ApiError(404, "Not found", "NOT_FOUND"));
    mockCommentOnProposalShare.mockRejectedValue(new ApiError(404, "Not found", "NOT_FOUND"));
    renderTokenPage();
    fireEvent.click(await screen.findByRole("button", { name: "Ask for changes…" }));
    fireEvent.change(screen.getByLabelText("What would you like changed?"), { target: { value: "Could we seat 130?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the venue team" }));
    expect(await screen.findByRole("heading", { name: "This proposal link isn't available" })).toBeTruthy();
    expect(screen.getByTestId("kept-words").textContent).toBe("Could we seat 130?");
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
    // With the version on the page, so the venue team knows which one it is about.
    await waitFor(() => { expect(mockCommentOnProposalShare).toHaveBeenCalledWith("client-token", { body: "Can we add a cheese table?", kind: "comment", version: 1 }); });
    expect(await thread.findByText("Can we add a cheese table?")).toBeTruthy();
    // A link reaches more than one person: a nameless client message is the
    // client's, not "You".
    expect(thread.getByText("The client")).toBeTruthy();
  });

  it("says whose each message is by where it came from, never by the name typed alone", async () => {
    mockGetProposalShare.mockResolvedValue(fixtureProposal({
      comments: [
        { kind: "comment", authorName: "The venue team", body: "We have taken £500 off; please accept today.", createdAt: "2026-06-11T10:00:00.000Z", from: "client" },
        { kind: "comment", authorName: "Venue team", body: "Happy to help.", createdAt: "2026-06-11T11:00:00.000Z", from: "venue" },
      ],
    }));
    renderTokenPage();
    const thread = within(await screen.findByTestId("proposal-comments"));
    expect(thread.getByText("The venue team (client)")).toBeTruthy();
    expect(thread.getAllByText("The venue team")).toHaveLength(1);
  });

  it("keeps a message the closed proposal would not take, and says why", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({ status: "accepted", accepted: { by: "Bea Crawford", at: "2026-06-12T09:00:00.000Z" } }));
    mockCommentOnProposalShare.mockRejectedValue(new ApiError(422, "Not awaiting", "NOT_AWAITING_RESPONSE"));
    renderTokenPage();

    fireEvent.change(await screen.findByTestId("comment-input"), { target: { value: "One more thing." } });
    fireEvent.click(screen.getByRole("button", { name: "Send the message" }));
    const thread = within(await screen.findByTestId("proposal-comments"));
    expect((await thread.findByRole("alert")).textContent).toBe("This proposal is no longer taking messages here.");
    expect(thread.getByTestId("kept-message").textContent).toBe("One more thing.");
    expect(thread.queryByTestId("comment-input")).toBeNull();
  });

  it("says a message may go again when the proposal only changed, and that it is closed when it closed", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({ status: "changes_requested" }));
    mockCommentOnProposalShare.mockRejectedValueOnce(new ApiError(409, "Changed", "PROPOSAL_STATUS_CHANGED"));
    renderTokenPage();
    fireEvent.change(await screen.findByTestId("comment-input"), { target: { value: "One more thing." } });
    fireEvent.click(screen.getByRole("button", { name: "Send the message" }));
    const thread = within(await screen.findByTestId("proposal-comments"));
    expect((await thread.findByRole("alert")).textContent)
      .toBe("This proposal changed while your message was on its way. It is still here; you can send it again.");
    expect(thread.getByTestId<HTMLTextAreaElement>("comment-input").value).toBe("One more thing.");
    cleanup();

    // A message that did not arrive, then the proposal closes: no "try again".
    mockGetProposalShare.mockReset();
    mockCommentOnProposalShare.mockReset();
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({ status: "accepted", accepted: { by: "Bea", at: "2026-06-12T09:00:00.000Z" } }));
    mockCommentOnProposalShare.mockRejectedValueOnce(new Error("network"));
    mockApproveProposalShare.mockResolvedValue({ status: "accepted" });
    renderTokenPage();
    fireEvent.change(await screen.findByTestId("comment-input"), { target: { value: "One more thing." } });
    fireEvent.click(screen.getByRole("button", { name: "Send the message" }));
    await screen.findByText("Your message was not posted. It is still here; please try again.");
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Bea" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept version 1" }));
    const closed = within(screen.getByTestId("proposal-comments"));
    expect((await closed.findByText("This proposal is no longer taking messages here."))).toBeTruthy();
    expect(closed.queryByText(/please try again/u)).toBeNull();
    expect(closed.getByTestId("kept-message").textContent).toBe("One more thing.");
  });

  it("says a message was not taken, and no more, when the proposal could not be read again", async () => {
    mockGetProposalShare.mockResolvedValueOnce(fixtureProposal()).mockRejectedValueOnce(new Error("network"));
    mockCommentOnProposalShare.mockRejectedValueOnce(new ApiError(422, "Not awaiting", "NOT_AWAITING_RESPONSE"));
    renderTokenPage();
    fireEvent.change(await screen.findByTestId("comment-input"), { target: { value: "One more thing." } });
    fireEvent.click(screen.getByRole("button", { name: "Send the message" }));
    const thread = within(await screen.findByTestId("proposal-comments"));
    expect((await thread.findByRole("alert")).textContent)
      .toBe("Your message was not posted, because this proposal changed while it was on its way. Please reload the page to see it as it stands; your message is still here.");
    expect(thread.getByTestId<HTMLTextAreaElement>("comment-input").value).toBe("One more thing.");
  });

  it("gives back a message and moves the focus to why, when the link closed while it was on its way", async () => {
    mockGetProposalShare.mockResolvedValueOnce(fixtureProposal()).mockRejectedValueOnce(new ApiError(404, "Not found", "NOT_FOUND"));
    mockCommentOnProposalShare.mockRejectedValueOnce(new ApiError(404, "Not found", "NOT_FOUND"));
    renderTokenPage();
    fireEvent.change(await screen.findByTestId("comment-input"), { target: { value: "One more thing." } });
    fireEvent.click(screen.getByRole("button", { name: "Send the message" }));
    const unavailable = await screen.findByRole("heading", { name: "This proposal link isn't available" });
    expect(screen.getByTestId("kept-words").textContent).toBe("One more thing.");
    await waitFor(() => { expect(document.activeElement).toBe(unavailable); });
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
      facts: _facts, accepted: _accepted, venueSlug: _slug, venueAddress: _address, preparedAt: _prepared, sentVersion: _sent,
      linkOpen: _open, ...older
    } = fixtureProposal();
    const parsed = PublicProposalSchema.parse(older);
    expect(parsed.facts).toEqual({ eventDate: null, guestCount: null, occasion: null, roomName: null, roomSlug: null });
    expect([parsed.accepted, parsed.venueSlug, parsed.preparedAt, parsed.sentVersion, parsed.linkOpen]).toEqual([null, null, null, null, true]);
    expect(PublicProposalSchema.safeParse({ ...fixtureProposal(), status: "approved" }).success).toBe(false);
    expect(PublicProposalSchema.safeParse({ ...fixtureProposal(), version: 0 }).success).toBe(false);
    expect(PublicProposalSchema.safeParse({ ...fixtureProposal(), quote: { ...QUOTE, subtotalMinor: 1 } }).success).toBe(false);
  });
});
