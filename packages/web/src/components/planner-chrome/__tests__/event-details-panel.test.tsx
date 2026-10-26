import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClientEventScheduleSchema,
  EventPhaseGraphSchema,
  emptyDietarySummary,
  emptyEventInstructions,
  type ClientEventSchedule,
  type EventInstructions,
  type EventPhaseGraph,
} from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { useActionLogStore } from "../../../stores/action-log-store.js";
import { useAuthStore, type AuthUser } from "../../../stores/auth-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlannerChromeStore } from "../../../stores/planner-chrome-store.js";
import { EventDetailsPanel, GUEST_LINE } from "../EventDetailsPanel.js";
import { resetEventDetailsForTests } from "../event-details-state.js";

// ---------------------------------------------------------------------------
// Event details in the left zone (T-674 slice 19; spec 6.13, 4.5). It saves
// as you type, one request at a time; Esc and Close send what is waiting and
// give the focus back; a refusal says so in plain words and keeps the words
// typed; the action log learns that details changed, never what they say.
// ---------------------------------------------------------------------------

const CONFIG = "33333333-3333-4333-8333-333333333333";
const VENUE = "6b0f1f8e-3c2a-4d5e-9f10-2a3b4c5d6e7f";
const EVENT = "0e5c7a52-1b2c-4d3e-8f4a-5b6c7d8e9f00";
const DINNER = "11111111-1111-4111-8111-111111111111";
const CEILIDH = "22222222-2222-4222-8222-222222222222";
const SPACE = "44444444-4444-4444-8444-444444444444";
const ALLERGY = "One guest: shellfish, severe.";

const mocks = vi.hoisted(() => ({
  getLayoutDetails: vi.fn(),
  patchMetadata: vi.fn(),
  patchEventGuests: vi.fn(),
  patchLayoutGuests: vi.fn(),
  updatePhase: vi.fn(),
  createPhase: vi.fn(),
  getGraph: vi.fn(),
  getSchedule: vi.fn(),
}));

vi.mock("../../../api/configurations.js", () => ({ patchConfigMetadata: mocks.patchMetadata }));
vi.mock("../../../api/events.js", () => ({
  getEventPhaseGraph: mocks.getGraph,
  updateEventPhase: mocks.updatePhase,
  createEventPhase: mocks.createPhase,
}));
vi.mock("../../../api/client-event-schedule.js", () => ({ getClientEventSchedule: mocks.getSchedule }));
vi.mock("../../../lib/event-details-requests.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/event-details-requests.js")>()),
  getLayoutDetails: mocks.getLayoutDetails,
  patchEventGuestCount: mocks.patchEventGuests,
  patchLayoutGuestCount: mocks.patchLayoutGuests,
}));

const STAFF: AuthUser = { id: "u-staff", email: "elaine@example.com", role: "staff", platformRole: "none", venueId: VENUE, name: "Elaine" };
const CLIENT: AuthUser = { id: "u-client", email: "ailsa@example.com", role: "client", platformRole: "none", venueId: null, name: "Ailsa" };

function phase(id: string, name: string, startsAt: string, durationMinutes: number, sortOrder: number): Record<string, unknown> {
  return {
    id, eventId: EVENT, spaceId: null, templateKey: null, name, sortOrder, startsAt, durationMinutes, guestCount: null,
    opsTasksCount: 0, reviewGatesCount: 0, densityStatus: "not_checked", densityLabel: "x", staffConflictsStatus: "not_checked",
    staffConflictsLabel: "x", notes: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function graph(): EventPhaseGraph {
  // Listed out of time order: the panel puts them in order.
  return EventPhaseGraphSchema.parse({
    event: {
      id: EVENT, venueId: VENUE, createdBy: null, name: "St Andrew's Night dinner", eventType: null, status: "proposed",
      startsAt: "2026-11-28T19:00:00.000Z", endsAt: null, guestCount: 180, clientName: null, notes: null,
      createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    },
    phases: [phase(CEILIDH, "Ceilidh", "2026-11-28T21:30:00.000Z", 150, 1), phase(DINNER, "Dinner", "2026-11-28T19:00:00.000Z", 120, 0)],
    scenarios: [], layoutVariants: [], configurationLinks: [], phaseLayoutSnapshots: [],
  });
}

function schedule(): ClientEventSchedule {
  return ClientEventScheduleSchema.parse({
    event: { id: EVENT, venueId: VENUE, name: "St Andrew's Night dinner", eventType: null, status: "proposed", startsAt: "2026-11-28T19:00:00.000Z", endsAt: null, guestCount: 180 },
    venue: { id: VENUE, name: "Trades Hall", timezone: "Europe/London" },
    scheduleState: "working",
    phases: [
      { id: DINNER, name: "Dinner", startsAt: "2026-11-28T19:00:00.000Z", durationMinutes: 120, space: null },
      { id: CEILIDH, name: "Ceilidh", startsAt: "2026-11-28T21:30:00.000Z", durationMinutes: 150, space: null },
    ],
    layouts: [{ id: CONFIG, name: "Dinner rounds", space: { id: SPACE, name: "Grand Hall" } }],
    slots: [],
  });
}

function layout(instructions: EventInstructions = emptyEventInstructions(), guestCount = 0): Record<string, unknown> {
  return { id: CONFIG, venueId: VENUE, userId: "u-client", isPublicPreview: false, guestCount, metadata: { instructions } };
}

function signIn(user: AuthUser | null): void {
  useAuthStore.setState({ user, isAuthenticated: user !== null, isLoading: false });
}

function Host(): React.ReactElement {
  const left = usePlannerChromeStore((state) => state.left);
  return (
    <>
      <button type="button" onClick={() => { usePlannerChromeStore.getState().open("left", "event-details"); }}>Open event details</button>
      {left === "event-details" ? <EventDetailsPanel /> : null}
    </>
  );
}

function mount(path = `/plan/${CONFIG}?eventId=${EVENT}`): void {
  render(<MemoryRouter initialEntries={[path]}><Host /></MemoryRouter>);
  const trigger = screen.getByRole("button", { name: "Open event details" });
  trigger.focus();
  fireEvent.click(trigger);
}

async function panel(): Promise<HTMLElement> {
  return screen.findByTestId("planner-event-details");
}

/** What a field holds. */
function valueOf(element: HTMLElement): string {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : "";
}

function nth(elements: readonly HTMLElement[], index: number): HTMLElement {
  const element = elements[index];
  if (element === undefined) throw new Error(`no element ${String(index)}`);
  return element;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetEventDetailsForTests();
  mocks.getLayoutDetails.mockResolvedValue(layout());
  mocks.patchMetadata.mockResolvedValue({ id: CONFIG });
  mocks.patchEventGuests.mockResolvedValue(undefined);
  mocks.patchLayoutGuests.mockResolvedValue(undefined);
  mocks.updatePhase.mockResolvedValue({});
  mocks.getGraph.mockResolvedValue(graph());
  mocks.getSchedule.mockResolvedValue(schedule());
  useEditorStore.setState({ configId: CONFIG, venueId: VENUE, isPublicPreview: false, reviewStatus: null, reviewLockRefused: false, isOnline: true });
  usePlannerChromeStore.setState({ left: null, right: null });
  useActionLogStore.getState().reset();
  useActionLogStore.getState().beginLog(CONFIG);
  signIn(STAFF);
});

afterEach(() => {
  cleanup();
  signIn(null);
});

describe("who sees what", () => {
  it("tells a guest in one line what event details are and how to get them, with no fields", async () => {
    signIn(null);
    mount(`/plan/${CONFIG}`);
    const shown = await panel();
    expect(within(shown).getByRole("heading", { name: "Event details" })).toBeTruthy();
    expect(within(shown).getByTestId("planner-event-details-guest").textContent).toBe(GUEST_LINE);
    expect(within(shown).queryByRole("textbox")).toBeNull();
    expect(mocks.getLayoutDetails).not.toHaveBeenCalled();
  });

  it("treats an unclaimed preview layout as a guest's", async () => {
    useEditorStore.setState({ isPublicPreview: true });
    mount();
    expect(within(await panel()).getByTestId("planner-event-details-guest")).toBeTruthy();
  });

  it("gives staff the running order to edit, in time order, the event's guests and the function sheet", async () => {
    mount();
    const shown = await panel();
    await waitFor(() => { expect(within(shown).getAllByTestId("planner-event-details-act")).toHaveLength(2); });
    const names = within(shown).getAllByLabelText("Act").map(valueOf);
    expect(names).toEqual(["Dinner", "Ceilidh"]);
    expect(within(shown).getAllByLabelText("Starts").map(valueOf)).toEqual(["19:00", "21:30"]);
    expect(valueOf(within(shown).getByRole("textbox", { name: "Guests" }))).toBe("180");
    expect(within(shown).getByText("The event's figure, the one the plane shows.")).toBeTruthy();
    expect(within(shown).getByTestId("planner-event-details-sheet").getAttribute("href")).toBe(`/hallkeeper/${CONFIG}`);
    expect(within(shown).getByText("St Andrew's Night dinner · Sat 28 Nov 2026")).toBeTruthy();
  });

  it("gives a client their event to read, their layout's details to edit, and no function sheet", async () => {
    signIn(CLIENT);
    mount();
    const shown = await panel();
    await waitFor(() => { expect(within(shown).getAllByTestId("planner-event-details-act")).toHaveLength(2); });
    expect(within(shown).queryByLabelText("Act")).toBeNull();
    expect(within(shown).getByText("Ceilidh")).toBeTruthy();
    expect(within(shown).getByText("Glasgow time. The events team sets the timings.")).toBeTruthy();
    expect(within(shown).getByText("180 guests")).toBeTruthy();
    expect(within(shown).queryByTestId("planner-event-details-sheet")).toBeNull();
    expect(within(shown).getByRole("textbox", { name: "Instructions for the hallkeeper" })).toBeTruthy();
  });

  it("reads only while the layout is with the events team", async () => {
    useEditorStore.setState({ reviewStatus: "submitted" });
    mount();
    const shown = await panel();
    expect(await within(shown).findByText("View only · sent for approval")).toBeTruthy();
    const instructions = within(shown).getByRole("textbox", { name: "Instructions for the hallkeeper" });
    expect(instructions.hasAttribute("readonly")).toBe(true);
    expect(within(shown).queryByLabelText("Act")).toBeNull();
    expect(within(shown).queryByRole("button", { name: "Add a contact" })).toBeNull();
  });
});

describe("saving as you type", () => {
  it("sends one save per pause, says Saved, and logs the change without the words", async () => {
    mocks.getLayoutDetails.mockResolvedValue(layout({ ...emptyEventInstructions(), dietary: { ...emptyDietarySummary(), otherAllergies: "" } }));
    mount();
    const shown = await panel();
    const note = await within(shown).findByLabelText("Allergies and other needs");
    for (const text of ["One", "One guest", ALLERGY]) fireEvent.change(note, { target: { value: text } });
    const section = within(shown).getByTestId("planner-event-details-dietary");
    expect(within(section).getByText("Saving")).toBeTruthy();
    await waitFor(() => { expect(mocks.patchMetadata).toHaveBeenCalledTimes(1); }, { timeout: 3000 });
    const [, body] = mocks.patchMetadata.mock.calls[0] as [string, { instructions: EventInstructions }];
    expect(body.instructions.dietary?.otherAllergies).toBe(ALLERGY);
    await waitFor(() => { expect(within(section).getByText("Saved")).toBeTruthy(); });
    const entries = useActionLogStore.getState().entries;
    expect(entries.map((entry) => entry.intent)).toEqual(["event.details.update"]);
    expect(JSON.stringify(entries)).not.toContain("shellfish");
    expect(entries[0]?.payload).toEqual({ changed: ["dietary"] });
  });

  it("two quick edits to different fields both survive: one request out at a time, the second after the reply", async () => {
    const replies: (() => void)[] = [];
    mocks.patchMetadata.mockImplementation(() => new Promise<void>((resolve) => { replies.push(resolve); }));
    mount();
    const shown = await panel();
    fireEvent.change(await within(shown).findByLabelText("Access and deliveries"), { target: { value: "South door." } });
    await waitFor(() => { expect(mocks.patchMetadata).toHaveBeenCalledTimes(1); }, { timeout: 3000 });
    fireEvent.change(within(shown).getByRole("textbox", { name: "Instructions for the hallkeeper" }), { target: { value: "Board at 18:45." } });
    await pause(1000);
    expect(mocks.patchMetadata).toHaveBeenCalledTimes(1);
    await act(async () => { replies[0]?.(); await Promise.resolve(); });
    await waitFor(() => { expect(mocks.patchMetadata).toHaveBeenCalledTimes(2); });
    const [, second] = mocks.patchMetadata.mock.calls[1] as [string, { instructions: EventInstructions }];
    expect(second.instructions.accessNotes).toBe("South door.");
    expect(second.instructions.specialInstructions).toBe("Board at 18:45.");
    await act(async () => { replies[1]?.(); await Promise.resolve(); });
  }, 10000);

  it("Esc sends what is waiting at once, closes, and gives the focus back to its trigger", async () => {
    mount();
    const shown = await panel();
    const field = await within(shown).findByRole("textbox", { name: "Instructions for the hallkeeper" });
    fireEvent.change(field, { target: { value: "Fire exits clear." } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByTestId("planner-event-details")).toBeNull();
    expect(usePlannerChromeStore.getState().left).toBeNull();
    // Sent now, not after the pause.
    expect(mocks.patchMetadata).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open event details" }));
  });

  it("keeps what was typed through a refusal, says so plainly, and sends it on Try again", async () => {
    mocks.patchMetadata.mockRejectedValueOnce(new ApiError(403, "Insufficient permissions", "FORBIDDEN"));
    mount();
    const shown = await panel();
    fireEvent.change(await within(shown).findByLabelText("Access and deliveries"), { target: { value: "North door." } });
    const status = within(shown).getByTestId("planner-event-details-status");
    await waitFor(() => { expect(status.textContent).toBe("Venviewer refused this change: you cannot change these details on this layout."); }, { timeout: 3000 });
    expect(status.textContent).not.toContain("Insufficient");
    fireEvent.click(within(shown).getByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(mocks.patchMetadata).toHaveBeenCalledTimes(2); });
    await waitFor(() => { expect(status.textContent).toMatch(/^Saved/); });
    expect(valueOf(within(shown).getByLabelText("Access and deliveries"))).toBe("North door.");
  });

  it("closing and reopening never reads over an edit that has not reached the server", async () => {
    mocks.patchMetadata.mockRejectedValue(new ApiError(503, "Unavailable", "UNAVAILABLE"));
    mount();
    const shown = await panel();
    fireEvent.change(await within(shown).findByLabelText("Access and deliveries"), { target: { value: "Kept words." } });
    fireEvent.click(within(shown).getByRole("button", { name: /Close/ }));
    expect(screen.queryByTestId("planner-event-details")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open event details" }));
    const again = await panel();
    expect(valueOf(await within(again).findByLabelText("Access and deliveries"))).toBe("Kept words.");
    expect(mocks.getLayoutDetails).toHaveBeenCalledTimes(1);
  });

  it("says offline plainly and never claims the device keeps it", async () => {
    mocks.patchMetadata.mockRejectedValue(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"));
    mount();
    const shown = await panel();
    fireEvent.change(await within(shown).findByLabelText("Access and deliveries"), { target: { value: "South door." } });
    const status = within(shown).getByTestId("planner-event-details-status");
    await waitFor(() => { expect(status.textContent).toBe("Not sent: you are offline. It is kept here while this page is open and sends when you are back."); }, { timeout: 3000 });
    expect(status.textContent).not.toMatch(/on this device/);
    expect(within(shown).queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("the guests figure has one home", () => {
  it("writes the event's figure when an event is linked (the one the plane reads)", async () => {
    mount();
    const shown = await panel();
    fireEvent.change(await within(shown).findByRole("textbox", { name: "Guests" }), { target: { value: "196" } });
    await waitFor(() => { expect(mocks.patchEventGuests).toHaveBeenCalledWith(EVENT, 196); }, { timeout: 3000 });
    expect(mocks.patchLayoutGuests).not.toHaveBeenCalled();
  });

  it("writes the layout's own figure when no event is linked", async () => {
    mocks.getLayoutDetails.mockResolvedValue(layout(emptyEventInstructions(), 120));
    mount(`/plan/${CONFIG}`);
    const shown = await panel();
    const guests = await within(shown).findByRole("textbox", { name: "Guests" });
    await waitFor(() => { expect(valueOf(guests)).toBe("120"); });
    expect(within(shown).getByText("This layout's figure, printed on the function sheet.")).toBeTruthy();
    fireEvent.change(guests, { target: { value: "110" } });
    await waitFor(() => { expect(mocks.patchLayoutGuests).toHaveBeenCalledWith(CONFIG, 110); }, { timeout: 3000 });
    expect(mocks.patchEventGuests).not.toHaveBeenCalled();
  });

  it("checks the diet counts against it, without blocking", async () => {
    mocks.getLayoutDetails.mockResolvedValue(layout({ ...emptyEventInstructions(), dietary: { ...emptyDietarySummary(), vegetarian: 160 } }));
    mount();
    const shown = await panel();
    await waitFor(() => { expect(within(shown).getAllByTestId("planner-event-details-act")).toHaveLength(2); });
    fireEvent.change(await within(shown).findByLabelText("Vegan"), { target: { value: "36" } });
    expect(within(shown).getByTestId("planner-event-details-diet-over").textContent).toBe("These add to 196, more than the 180 guests.");
  });
});

describe("the running order", () => {
  it("saves an act's new start in Glasgow time and says plainly when acts overlap", async () => {
    mount();
    const shown = await panel();
    await waitFor(() => { expect(within(shown).getAllByLabelText("Starts")).toHaveLength(2); });
    fireEvent.change(nth(within(shown).getAllByLabelText("Starts"), 1), { target: { value: "20:30" } });
    expect(within(shown).getByTestId("planner-event-details-overlaps").textContent).toBe("Dinner runs to 21:00, past the start of Ceilidh at 20:30.");
    await waitFor(() => {
      expect(mocks.updatePhase).toHaveBeenCalledWith(CEILIDH, { name: "Ceilidh", startsAt: "2026-11-28T20:30:00.000Z", durationMinutes: 150 });
    }, { timeout: 3000 });
  });

  it("holds an act with no name, and says why", async () => {
    mount();
    const shown = await panel();
    await waitFor(() => { expect(within(shown).getAllByLabelText("Act")).toHaveLength(2); });
    fireEvent.change(nth(within(shown).getAllByLabelText("Act"), 0), { target: { value: " " } });
    expect(within(shown).getByText("Name the act to save it")).toBeTruthy();
    await pause(1000);
    expect(mocks.updatePhase).not.toHaveBeenCalled();
  });
});
