import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DIETARY_MEMORY_CONSENT, DIETARY_NOTE_RETENTION, type RememberedDietaryNote } from "@omnitwin/types";
import { RememberedNotesPage } from "../RememberedNotesPage.js";
import { ApiError } from "../../api/client.js";

// The client's own page for remembered allergy notes: they can see what is
// kept, from which layout, what they agreed to and when, and remove it at
// any time, with the consequence said before they press.

const { listMock, removeMock } = vi.hoisted(() => ({ listMock: vi.fn(), removeMock: vi.fn() }));
vi.mock("../../api/dietary-memory.js", () => ({
  listRememberedDietaryNotes: listMock,
  removeRememberedDietaryNote: removeMock,
}));

const WORDING = `${DIETARY_MEMORY_CONSENT.question} ${DIETARY_MEMORY_CONSENT.detail}`;

function note(overrides: Partial<RememberedDietaryNote> = {}): RememberedDietaryNote {
  return {
    id: "00000000-0000-4000-8000-0000000000f1",
    venueId: "00000000-0000-4000-8000-000000000001",
    venueName: "Trades Hall",
    otherAllergies: "Two guests: sesame, severe.",
    consentWording: WORDING,
    consentedAt: "2026-10-17T10:00:00.000Z",
    updatedAt: "2026-11-03T09:00:00.000Z",
    sourceLayout: { id: "00000000-0000-4000-8000-0000000000aa", name: "Annual dinner" },
    ...overrides,
  };
}

function renderPage(): void {
  render(<MemoryRouter><RememberedNotesPage /></MemoryRouter>);
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe("remembered allergy notes", () => {
  it("shows each note with where it came from, when it was agreed and the words agreed to", async () => {
    listMock.mockResolvedValue([note()]);
    renderPage();
    expect(screen.getByText("Loading your remembered notes…")).toBeTruthy();

    const item = (await screen.findByText("Two guests: sesame, severe.")).closest("li");
    if (item === null) throw new Error("note card missing");
    const card = within(item);
    expect(card.getByText("Trades Hall")).toBeTruthy();
    expect(item.textContent).toContain("Remembered on 17 October 2026 · last saved 3 November 2026 · from your layout “Annual dinner”");
    expect(card.getByText("What you agreed to")).toBeTruthy();
    expect(card.getByText(WORDING)).toBeTruthy();
    const remove = card.getByRole("button", { name: "Remove this note" });
    const consequence = document.getElementById(remove.getAttribute("aria-describedby") ?? "");
    expect(consequence?.textContent).toContain(`keeps it until ${String(DIETARY_NOTE_RETENTION.daysAfterEvent)} days`);
  });

  it("removes a note at once and says what that means for the next layout", async () => {
    listMock.mockResolvedValue([note()]);
    removeMock.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Remove this note" }));
    await waitFor(() => { expect(removeMock).toHaveBeenCalledWith(note().id); });
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/^Removed from your account on .+\. Your next layout at Trades Hall will not be filled in\.$/u);
    expect(screen.queryByText("Two guests: sesame, severe.")).toBeNull();
  });

  it("keeps the note and offers a way forward when removal fails", async () => {
    listMock.mockResolvedValue([note()]);
    removeMock.mockRejectedValue(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Remove this note" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The note was not removed. Network error — check your connection Try again, or ask the venue's events team to remove it.");
    expect(screen.getByText("Two guests: sesame, severe.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove this note" })).toBeTruthy();
  });

  it("says plainly when nothing is remembered, and that nothing is kept without a tick", async () => {
    listMock.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("No allergy notes are remembered with your account.")).toBeTruthy();
    expect(screen.getByText(/nothing is kept unless you tick it/u)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the planner" }).getAttribute("href")).toBe("/plan");
  });

  it("offers to try again when the notes cannot be loaded", async () => {
    listMock.mockRejectedValueOnce(new ApiError(503, "The service is busy.", "UNAVAILABLE")).mockResolvedValueOnce([note()]);
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Your remembered notes could not be loaded. The service is busy.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Two guests: sesame, severe.")).toBeTruthy();
    expect(listMock).toHaveBeenCalledTimes(2);
  });
});
