import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DIETARY_MEMORY_CONSENT,
  emptyDietarySummary,
  emptyEventInstructions,
  type EventInstructions,
  type RememberedDietaryNote,
} from "@omnitwin/types";
import { EventDetailsPanel } from "../EventDetailsPanel.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useAuthStore, type AuthUser } from "../../../stores/auth-store.js";
import { ApiError } from "../../../api/client.js";

// "Ask once, then remember" in the planner's Event details sheet: the box
// beside a client's allergy note starts unticked, a tick remembers the note
// after the layout saves, the client's next layout is filled in from it, an
// untick removes it, and nobody else is offered the box.

const { getConfigMock, patchMock, listMock, rememberMock, removeMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  patchMock: vi.fn((_configId: string, _body: { readonly instructions: EventInstructions }) => Promise.resolve({})),
  listMock: vi.fn(),
  rememberMock: vi.fn(),
  removeMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../api/configurations.js", () => ({
  getConfig: getConfigMock,
  patchConfigMetadata: patchMock,
}));
vi.mock("../../../api/dietary-memory.js", () => ({
  listRememberedDietaryNotes: listMock,
  rememberDietaryNote: rememberMock,
  removeRememberedDietaryNote: removeMock,
}));

const CLIENT: AuthUser = { id: "client-1", email: "client@example.test", role: "client", platformRole: "none", venueId: null, name: "Morag" };
const STAFF: AuthUser = { id: "staff-1", email: "staff@example.test", role: "staff", platformRole: "none", venueId: "venue-1", name: "Callum" };
const NOTE = "Two guests: sesame, severe.";

function remembered(overrides: Partial<RememberedDietaryNote> = {}): RememberedDietaryNote {
  return {
    id: "00000000-0000-4000-8000-0000000000f1",
    venueId: "venue-1",
    venueName: "Trades Hall",
    otherAllergies: NOTE,
    consentWording: `${DIETARY_MEMORY_CONSENT.question} ${DIETARY_MEMORY_CONSENT.detail}`,
    consentedAt: "2026-10-17T10:00:00.000Z",
    updatedAt: "2026-10-17T10:00:00.000Z",
    sourceLayout: { id: "cfg-last-year", name: "Annual dinner 2026" },
    ...overrides,
  };
}

function layout(options: { owner?: string; dietaryNote?: string | null; instructions?: boolean } = {}) {
  const note = options.dietaryNote ?? null;
  const instructions = options.instructions ?? true;
  return {
    id: "cfg-now",
    venueId: "venue-1",
    userId: options.owner ?? CLIENT.id,
    metadata: instructions
      ? { instructions: { ...emptyEventInstructions(), specialInstructions: "Loaded", dietary: note === null ? null : { ...emptyDietarySummary(), otherAllergies: note } } }
      : null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([]);
  useAuthStore.getState().setUser(CLIENT);
  useEditorStore.setState({ configId: "cfg-now", isPublicPreview: false });
});
afterEach(() => {
  cleanup();
  useAuthStore.getState().setUser(null);
});

function box(): HTMLInputElement {
  return screen.getByRole("checkbox", { name: DIETARY_MEMORY_CONSENT.question });
}

async function openWithNote(note: string): Promise<void> {
  render(<EventDetailsPanel open onClose={() => undefined} />);
  await screen.findByDisplayValue("Loaded");
  if (screen.queryByPlaceholderText(/One guest: shellfish/u) === null) {
    fireEvent.click(screen.getByRole("button", { name: /Add dietary counts/u }));
  }
  fireEvent.change(screen.getByPlaceholderText(/One guest: shellfish/u), { target: { value: note } });
}

describe("the first ask", () => {
  it("offers the box, unticked, with the words the API records, once a note is written", async () => {
    getConfigMock.mockResolvedValue(layout());
    render(<EventDetailsPanel open onClose={() => undefined} />);
    await screen.findByDisplayValue("Loaded");
    fireEvent.click(screen.getByRole("button", { name: /Add dietary counts/u }));
    expect(screen.queryByRole("checkbox", { name: DIETARY_MEMORY_CONSENT.question })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/One guest: shellfish/u), { target: { value: NOTE } });
    expect(box().checked).toBe(false);
    const detailId = box().getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(detailId)?.textContent).toBe(DIETARY_MEMORY_CONSENT.detail);
  });

  it("without a tick, saves the layout and remembers nothing", async () => {
    getConfigMock.mockResolvedValue(layout());
    await openWithNote(NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(patchMock).toHaveBeenCalledTimes(1); });
    expect(rememberMock).not.toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("with a tick, saves the layout first and then remembers its note", async () => {
    getConfigMock.mockResolvedValue(layout());
    rememberMock.mockResolvedValue(remembered({ sourceLayout: { id: "cfg-now", name: "This year" } }));
    await openWithNote(NOTE);
    fireEvent.click(box());
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(rememberMock).toHaveBeenCalledWith("cfg-now"); });
    expect(patchMock.mock.invocationCallOrder[0]).toBeLessThan(rememberMock.mock.invocationCallOrder[0] ?? 0);
    await screen.findByText(/Remembered with your account since 17 October 2026\./u);
    expect(box().checked).toBe(true);
  });

  it("says plainly when the layout saved but the note was not remembered", async () => {
    getConfigMock.mockResolvedValue(layout());
    rememberMock.mockRejectedValue(new ApiError(503, "The service is busy.", "UNAVAILABLE"));
    await openWithNote(NOTE);
    fireEvent.click(box());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Your layout is saved, but the note was not remembered. The service is busy. Save again to try once more.");
  });
});

describe("the next event", () => {
  it("fills in a new layout from the remembered note, says where it came from, and saves it as use", async () => {
    getConfigMock.mockResolvedValue(layout({ instructions: false }));
    listMock.mockResolvedValue([remembered()]);
    rememberMock.mockResolvedValue(remembered({ sourceLayout: { id: "cfg-now", name: "This year" } }));
    render(<EventDetailsPanel open onClose={() => undefined} />);

    expect(await screen.findByDisplayValue(NOTE)).toBeTruthy();
    expect(screen.getByText("Filled in from the note you asked us to remember on 17 October 2026.")).toBeTruthy();
    expect(box().checked).toBe(true);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(patchMock).toHaveBeenCalledTimes(1); });
    expect(patchMock.mock.calls[0]?.[1].instructions.dietary?.otherAllergies).toBe(NOTE);
    await waitFor(() => { expect(rememberMock).toHaveBeenCalledWith("cfg-now"); });
  });

  it("lets the client leave the remembered note out of this event", async () => {
    getConfigMock.mockResolvedValue(layout({ instructions: false }));
    listMock.mockResolvedValue([remembered()]);
    render(<EventDetailsPanel open onClose={() => undefined} />);
    await screen.findByDisplayValue(NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Leave it out of this event" }));
    expect(screen.queryByDisplayValue(NOTE)).toBeNull();
    expect(screen.getByRole("button", { name: "Fill in your remembered note" })).toBeTruthy();
  });

  it("does not fill in a layout already worked on, but offers the note by hand", async () => {
    getConfigMock.mockResolvedValue(layout({ dietaryNote: "" }));
    listMock.mockResolvedValue([remembered()]);
    render(<EventDetailsPanel open onClose={() => undefined} />);
    await screen.findByDisplayValue("Loaded");
    expect(screen.queryByDisplayValue(NOTE)).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Fill in your remembered note" }));
    expect(screen.getByDisplayValue(NOTE)).toBeTruthy();
    expect(box().checked).toBe(true);
  });

  it("never fills in from a note remembered for another venue", async () => {
    getConfigMock.mockResolvedValue(layout({ instructions: false }));
    listMock.mockResolvedValue([remembered({ venueId: "venue-2" })]);
    render(<EventDetailsPanel open onClose={() => undefined} />);
    expect(await screen.findByRole("button", { name: /Add dietary counts/u })).toBeTruthy();
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByDisplayValue(NOTE)).toBeNull();
    expect(screen.queryByRole("button", { name: "Fill in your remembered note" })).toBeNull();
  });
});

describe("taking it back", () => {
  it("unticking says what saving will do, then removes the remembered note", async () => {
    getConfigMock.mockResolvedValue(layout({ dietaryNote: NOTE }));
    listMock.mockResolvedValue([remembered()]);
    render(<EventDetailsPanel open onClose={() => undefined} />);
    await screen.findByDisplayValue(NOTE);
    expect(box().checked).toBe(true);

    fireEvent.click(box());
    expect(screen.getByText(/Saving removes the remembered note from your account\./u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(removeMock).toHaveBeenCalledWith(remembered().id); });
    expect(rememberMock).not.toHaveBeenCalled();
  });

  it("emptying the note on one layout leaves the remembered note alone", async () => {
    getConfigMock.mockResolvedValue(layout({ dietaryNote: NOTE }));
    listMock.mockResolvedValue([remembered()]);
    render(<EventDetailsPanel open onClose={() => undefined} />);
    fireEvent.change(await screen.findByDisplayValue(NOTE), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(patchMock).toHaveBeenCalledTimes(1); });
    expect(removeMock).not.toHaveBeenCalled();
    expect(rememberMock).not.toHaveBeenCalled();
  });
});

describe("who is offered the box", () => {
  it("never staff, who cannot agree for a client", async () => {
    useAuthStore.getState().setUser(STAFF);
    getConfigMock.mockResolvedValue(layout({ dietaryNote: NOTE }));
    render(<EventDetailsPanel open onClose={() => undefined} />);
    await screen.findByDisplayValue(NOTE);
    expect(screen.queryByRole("checkbox", { name: DIETARY_MEMORY_CONSENT.question })).toBeNull();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("never on another person's layout, and saving there remembers nothing", async () => {
    getConfigMock.mockResolvedValue(layout({ owner: "someone-else", dietaryNote: NOTE }));
    listMock.mockResolvedValue([remembered()]);
    render(<EventDetailsPanel open onClose={() => undefined} />);
    await screen.findByDisplayValue(NOTE);
    expect(screen.queryByRole("checkbox", { name: DIETARY_MEMORY_CONSENT.question })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(patchMock).toHaveBeenCalledTimes(1); });
    expect(rememberMock).not.toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
  });
});
