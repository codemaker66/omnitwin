import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ClientEventSchedule, RoomDay } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
import { WhenRibbon } from "../WhenRibbon.js";
import { useAuthStore } from "../../../../stores/auth-store.js";

// ---------------------------------------------------------------------------
// The client's ribbon (goal 19 S6): built from the anonymised room day, the
// bar is their own slot or the draft; every proposal pauses for the question
// and goes out as ONE keyed PUT; a confirmed time is the office's to change.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const ROOM = "00000000-0000-4000-8000-0000000000a1";
const EVENT = "00000000-0000-4000-8000-0000000000e1";
const CONFIG = "00000000-0000-4000-8000-0000000000f1";
const OWN = "00000000-0000-4000-8000-0000000000b1";
const MIN = 60_000;
// 2030-05-10 18:00 in Glasgow (BST).
const SIX = Date.parse("2030-05-10T17:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

const { getRoomDayMock, proposeWindowMock, scheduleState } = vi.hoisted(() => ({
  getRoomDayMock: vi.fn(),
  proposeWindowMock: vi.fn(),
  scheduleState: { current: null as unknown },
}));
vi.mock("../../../../api/when-window.js", () => ({ getRoomDay: getRoomDayMock, proposeWindow: proposeWindowMock }));
vi.mock("../../../../stores/editor-store.js", () => ({
  useEditorStore: (selector: (state: { configId: string; venueId: string }) => unknown) => selector({ configId: CONFIG, venueId: VENUE }),
}));
vi.mock("../../../../hooks/use-client-event-schedule.js", () => ({
  useClientEventSchedule: () => scheduleState.current,
}));

type Slot = { readonly kind: "hold" | "ink" } | null;

function schedule(slot: Slot): ClientEventSchedule {
  return {
    event: { id: EVENT, venueId: VENUE, name: "Our dinner", eventType: "dinner", status: "in_planning", startsAt: iso(SIX), endsAt: iso(SIX + 300 * MIN), guestCount: 80 },
    venue: { id: VENUE, name: "Trades Hall", timezone: "Europe/London" },
    scheduleState: "working",
    phases: [],
    layouts: [{ id: CONFIG, name: "Dinner layout", space: { id: ROOM, name: "Grand Hall" } }],
    slots: slot === null ? [] : [{ bookingId: OWN, kind: slot.kind, title: "Our dinner", space: { id: ROOM, name: "Grand Hall" }, startsAt: iso(SIX), endsAt: iso(SIX + 300 * MIN) }],
  };
}

function roomDay(day: string, spans: RoomDay["spans"]): RoomDay {
  return {
    eventId: EVENT, space: { id: ROOM, name: "Grand Hall" }, day, timezone: "Europe/London",
    range: { startsAt: `${day}T03:00:00.000Z`, endsAt: `${day}T03:00:00.000Z` }, turnaroundMinutes: 90, spans,
  };
}

const BUSY_MORNING = { kind: "busy" as const, startsAt: "2030-05-10T08:00:00.000Z", endsAt: "2030-05-10T12:00:00.000Z" };
const HELD_AFTERNOON = { kind: "held" as const, startsAt: "2030-05-10T13:00:00.000Z", endsAt: "2030-05-10T15:00:00.000Z" };

function seedClient(): void {
  useAuthStore.getState().setUser({ id: "00000000-0000-4000-8000-0000000000cc", email: "client@test.invalid", role: "client", platformRole: "none", venueId: null, name: "Morag Client" });
}

function renderRibbon(): void {
  render(<MemoryRouter initialEntries={[`/plan?eventId=${EVENT}`]}><WhenRibbon /></MemoryRouter>);
}

function loaded(slot: Slot, spans: RoomDay["spans"] = [BUSY_MORNING, HELD_AFTERNOON]): void {
  scheduleState.current = { status: "loaded", data: schedule(slot), refresh: vi.fn() };
  const own = slot === null ? [] : [{ kind: "yours" as const, bookingId: OWN, title: "Our dinner", startsAt: iso(SIX), endsAt: iso(SIX + 300 * MIN) }];
  getRoomDayMock.mockImplementation((_event: string, query: { day: string }) =>
    Promise.resolve(roomDay(query.day, query.day === "2030-05-10" ? [...spans, ...own] : [])));
}

function typeEntry(text: string): void {
  const entry = screen.getByTestId("when-ribbon-entry");
  fireEvent.change(entry, { target: { value: text } });
  const form = entry.closest("form");
  if (form === null) throw new Error("entry form");
  fireEvent.submit(form);
}

beforeEach(() => { seedClient(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); useAuthStore.getState().logout(); });

describe("the client's When ribbon", () => {
  it("shows the room's day anonymised around the client's own slot, waiting for the office", async () => {
    loaded({ kind: "hold" });
    renderRibbon();
    const ingot = await screen.findByTestId("when-ribbon-ingot");
    expect(ingot.getAttribute("aria-label")).toContain("Our dinner, 18:00 – 23:00");
    expect(screen.getByTestId("when-ribbon-state").textContent).toContain("waiting for the office");
    expect(screen.getAllByTestId("when-ribbon-ghost").map((ghost) => ghost.textContent)).toEqual(["Booked", "Held"]);
    expect(screen.getAllByTestId("when-ribbon-buffer")).toHaveLength(2);
    expect(screen.getByTestId("when-ribbon").getAttribute("data-variant")).toBe("client");
    expect(getRoomDayMock).toHaveBeenCalledWith(EVENT, { spaceId: ROOM, day: "2030-05-10" }, expect.anything());
    expect(getRoomDayMock).toHaveBeenCalledWith(EVENT, { spaceId: ROOM, day: "2030-05-09" }, expect.anything());
  });

  it("every proposal pauses for the question, then goes out as one keyed PUT", async () => {
    loaded({ kind: "hold" });
    proposeWindowMock.mockResolvedValue({});
    renderRibbon();
    const ingot = await screen.findByTestId("when-ribbon-ingot");
    fireEvent.keyDown(ingot, { key: "ArrowRight" });
    fireEvent.keyDown(ingot, { key: "Enter" });
    const confirm = await screen.findByTestId("when-ribbon-confirm");
    expect(confirm.textContent).toContain("Propose 18:15 – 23:15 to the office?");
    expect(proposeWindowMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Propose this time"));
    await waitFor(() => { expect(proposeWindowMock).toHaveBeenCalledTimes(1); });
    const [eventId, input] = proposeWindowMock.mock.calls[0] as [string, { spaceId: string; startsAt: string; endsAt: string; idempotencyKey: string }];
    expect(eventId).toBe(EVENT);
    expect(input).toMatchObject({ spaceId: ROOM, startsAt: iso(SIX + 15 * MIN), endsAt: iso(SIX + 315 * MIN) });
    expect(input.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
    // The status line says "Saving event times…" first, then what was done.
    await waitFor(() => { expect(screen.getByRole("status").textContent).toContain("Proposed 18:15 – 23:15"); });
  });

  it("rests on the draft when nothing is proposed yet, and a typed time echoes what it assumed", async () => {
    loaded(null);
    renderRibbon();
    const ingot = await screen.findByTestId("when-ribbon-ingot");
    expect(ingot.className).toContain("is-draft");
    expect(screen.getByText(/Nothing is booked yet/u)).toBeTruthy();
    typeEntry("7pm till 11");
    const confirm = await screen.findByTestId("when-ribbon-confirm");
    expect(confirm.textContent).toContain("Propose 19:00 – 23:00 to the office?");
    expect(screen.getByTestId("when-ribbon-assumptions").textContent).toContain("11");
    fireEvent.click(screen.getByText("Leave it"));
    expect(screen.queryByTestId("when-ribbon-confirm")).toBeNull();
  });

  it("refuses a typed time on a booked span by name, never by clamping", async () => {
    loaded({ kind: "hold" });
    renderRibbon();
    await screen.findByTestId("when-ribbon-ingot");
    typeEntry("10-12");
    expect((await screen.findByRole("alert")).textContent).toContain("already booked");
    expect(proposeWindowMock).not.toHaveBeenCalled();
  });

  it("a confirmed time is the office's: read-only, and said so", async () => {
    loaded({ kind: "ink" });
    renderRibbon();
    const ingot = await screen.findByTestId("when-ribbon-ingot");
    expect(ingot.getAttribute("role")).toBeNull();
    expect(ingot.getAttribute("aria-label")).toContain("Confirmed by the office");
    expect(screen.queryByTestId("when-ribbon-entry")).toBeNull();
  });

  it("a time the office has since confirmed cannot be moved: the ribbon says so and refreshes", async () => {
    loaded({ kind: "hold" });
    proposeWindowMock.mockRejectedValue(new ApiError(409, "decided", "WINDOW_DECIDED"));
    renderRibbon();
    const ingot = await screen.findByTestId("when-ribbon-ingot");
    const calls = getRoomDayMock.mock.calls.length;
    fireEvent.keyDown(ingot, { key: "ArrowRight" });
    fireEvent.keyDown(ingot, { key: "Enter" });
    fireEvent.click(await screen.findByText("Propose this time"));
    expect((await screen.findByRole("alert")).textContent).toContain("only they can change it now");
    await waitFor(() => { expect(getRoomDayMock.mock.calls.length).toBeGreaterThan(calls); });
  });
});
