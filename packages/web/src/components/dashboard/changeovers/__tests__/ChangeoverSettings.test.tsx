import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnaroundRuleSetting, TurnaroundRulesResponse } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
import { ChangeoverSettings } from "../ChangeoverSettings.js";

// ---------------------------------------------------------------------------
// The Changeovers section: every room's time in plain words, demo values
// kept with one press, a colleague's newer change shown rather than
// overwritten, removal that says what the Diary falls back to, and a scope
// that already has a time never offered twice.
// ---------------------------------------------------------------------------

const { mocks } = vi.hoisted(() => ({
  mocks: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    retire: vi.fn(),
  },
}));

vi.mock("../../../../api/turnaround-rules.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../api/turnaround-rules.js")>(),
  listTurnaroundRules: mocks.list,
  createTurnaroundRule: mocks.create,
  updateTurnaroundRule: mocks.update,
  retireTurnaroundRule: mocks.retire,
}));

const VENUE = "00000000-0000-4000-8000-000000000100";
const HALL = "00000000-0000-4000-8000-000000000001";
const SALOON = "00000000-0000-4000-8000-000000000002";

/** Rule ids are UUIDs, as the API sends them: a refusal carrying a rule is
 *  parsed with the shared schema. */
function rule(id: string, spaceId: string | null, eventType: string | null, minutes: number,
  confirmed: Partial<Pick<TurnaroundRuleSetting, "confirmedAt" | "updatedByName">> = {}): TurnaroundRuleSetting {
  return {
    id, venueId: VENUE, spaceId, eventType, name: id, minutes, isActive: true,
    confirmedAt: confirmed.confirmedAt ?? null, updatedByName: confirmed.updatedByName ?? null,
    createdAt: "2026-09-20T09:00:00.000Z", updatedAt: "2026-09-20T09:00:00.000Z",
  };
}

function response(rules: TurnaroundRuleSetting[]): TurnaroundRulesResponse {
  return {
    rules,
    rooms: [{ id: HALL, name: "Grand Hall" }, { id: SALOON, name: "Saloon" }],
    eventTypes: ["wedding", "conference"],
  };
}

const ALL = rule("00000000-0000-4000-8000-00000000a001", null, null, 90);
const HALL_RULE = rule("00000000-0000-4000-8000-00000000a002", HALL, null, 120);
const WEDDING = rule("00000000-0000-4000-8000-00000000a003", HALL, "wedding", 180, { confirmedAt: "2026-09-21T10:00:00.000Z", updatedByName: "Morag Sinclair" });

function row(room: string, kind: string): HTMLElement {
  const rows = screen.getAllByRole("listitem");
  const found = rows.find((candidate) => candidate.textContent?.includes(room) === true && candidate.textContent.includes(kind));
  if (found === undefined) throw new Error(`no row for ${room}, ${kind}`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue(response([ALL, HALL_RULE, WEDDING]));
});

afterEach(() => { cleanup(); });

describe("ChangeoverSettings", () => {
  it("lists each room's time in plain words, and says which are not confirmed", async () => {
    render(<ChangeoverSettings venueId={VENUE} />);
    expect(await screen.findAllByText("Grand Hall", { selector: ".changeovers__room" })).toHaveLength(2);
    expect(mocks.list).toHaveBeenCalledWith(VENUE, expect.any(AbortSignal));
    expect(within(row("All rooms", "Any event")).getByText("1 h 30")).toBeDefined();
    expect(within(row("All rooms", "Any event")).getByText("1 hour 30 minutes")).toBeDefined();
    expect(within(row("All rooms", "Any event")).getByText("Not confirmed")).toBeDefined();
    expect(within(row("Grand Hall", "Wedding")).getByText("Set by Morag Sinclair, 21 Sep 2026")).toBeDefined();
    // A confirmed time offers no "Keep".
    expect(within(row("Grand Hall", "Wedding")).queryByRole("button", { name: /^Keep/u })).toBeNull();
  });

  it("keeps a demo value as it is with one press, and records who set it", async () => {
    mocks.update.mockResolvedValue({ ...ALL, confirmedAt: "2026-09-26T20:00:00.000Z", updatedByName: "Elaine MacGregor",
      updatedAt: "2026-09-26T20:00:00.000Z" });
    render(<ChangeoverSettings venueId={VENUE} />);
    fireEvent.click(await screen.findByRole("button", { name: "Keep 1 hour 30 minutes for All rooms, any event" }));
    await waitFor(() => { expect(mocks.update).toHaveBeenCalledWith(VENUE, ALL, 90); });
    expect(await within(row("All rooms", "Any event")).findByText("Set by Elaine MacGregor, 26 Sep 2026")).toBeDefined();
  });

  it("changes a time, and shows a colleague's newer change instead of overwriting it", async () => {
    const current = { ...HALL_RULE, minutes: 150, confirmedAt: "2026-09-26T19:59:00.000Z", updatedByName: "Morag Sinclair",
      updatedAt: "2026-09-26T19:59:00.000Z" };
    mocks.update.mockRejectedValue(new ApiError(409, "Someone changed this", "RULE_CHANGED", current));
    render(<ChangeoverSettings venueId={VENUE} />);
    fireEvent.click(await screen.findByRole("button", { name: "Change the time for Grand Hall, any event" }));
    const minutes = screen.getByRole("spinbutton", { name: "Minutes for Grand Hall, any event" });
    fireEvent.change(minutes, { target: { value: "105" } });
    expect(within(row("Grand Hall", "Any event")).getByText("1 h 45")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(mocks.update).toHaveBeenCalledWith(VENUE, HALL_RULE, 105); });
    expect(await screen.findByText("Someone changed this a moment ago. It now says 2 h 30.")).toBeDefined();
    expect(within(row("Grand Hall", "Any event")).getByText("2 h 30")).toBeDefined();
  });

  it("will not save minutes outside a day", async () => {
    render(<ChangeoverSettings venueId={VENUE} />);
    fireEvent.click(await screen.findByRole("button", { name: "Change the time for Grand Hall, any event" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minutes for Grand Hall, any event" }), { target: { value: "1500" } });
    expect(screen.getByText("Enter 0 to 1,440 minutes")).toBeDefined();
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  it("says what the Diary falls back to before removing a time", async () => {
    mocks.retire.mockResolvedValue(undefined);
    render(<ChangeoverSettings venueId={VENUE} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove the time for Grand Hall, wedding" }));
    const confirm = screen.getByRole("group", { name: "Remove the time for Grand Hall, wedding?" });
    expect(within(confirm).getByText("Grand Hall will use the time for Grand Hall: 2 h.")).toBeDefined();
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => { expect(mocks.retire).toHaveBeenCalledWith(VENUE, WEDDING.id); });
    await waitFor(() => { expect(screen.queryByText("Set by Morag Sinclair, 21 Sep 2026")).toBeNull(); });
  });

  it("opens the add form on the first room without a time, never offers one that has one, and adds in its place", async () => {
    mocks.create.mockResolvedValue(rule("00000000-0000-4000-8000-00000000a004", SALOON, null, 45, { confirmedAt: "2026-09-26T20:00:00.000Z", updatedByName: "Elaine MacGregor" }));
    render(<ChangeoverSettings venueId={VENUE} />);
    await screen.findAllByText("Grand Hall", { selector: ".changeovers__room" });
    const addForm = screen.getByRole("form", { name: "Add a changeover time" });
    const room = within(addForm).getByRole("combobox", { name: "Room" });
    // All rooms and the Grand Hall have a time for any event; the Saloon has none.
    expect(room).toHaveProperty("value", SALOON);

    fireEvent.change(room, { target: { value: "" } });
    expect(within(addForm).getByText("All rooms already has a time for any event. Change it above.")).toBeDefined();
    expect(within(addForm).getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(room, { target: { value: SALOON } });
    fireEvent.change(within(addForm).getByRole("spinbutton", { name: "Minutes" }), { target: { value: "45" } });
    fireEvent.click(within(addForm).getByRole("button", { name: "Add" }));
    await waitFor(() => { expect(mocks.create).toHaveBeenCalledWith(VENUE, { spaceId: SALOON, eventType: null, minutes: 45 }); });
    expect(await within(row("Saloon", "Any event")).findByText("45 min")).toBeDefined();
    // Listed after the Grand Hall's times, in the venue's room order.
    const rooms = [...document.querySelectorAll(".changeovers__room")].map((node) => node.textContent);
    expect(rooms).toEqual(["All rooms", "Grand Hall", "Grand Hall", "Saloon"]);
    // Every room now has a time, so the form goes back to all rooms.
    expect(within(addForm).getByRole("combobox", { name: "Room" })).toHaveProperty("value", "");
  });

  it("keeps keyboard focus with the reader: back to Change after an edit, on to the next row after a removal", async () => {
    mocks.update.mockResolvedValue({ ...HALL_RULE, minutes: 105, confirmedAt: "2026-09-26T20:00:00.000Z", updatedByName: "Elaine MacGregor",
      updatedAt: "2026-09-26T20:00:00.000Z" });
    mocks.retire.mockResolvedValue(undefined);
    render(<ChangeoverSettings venueId={VENUE} />);
    fireEvent.click(await screen.findByRole("button", { name: "Change the time for Grand Hall, any event" }));
    expect(document.activeElement).toBe(screen.getByRole("spinbutton", { name: "Minutes for Grand Hall, any event" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Change the time for Grand Hall, any event" }));

    fireEvent.click(screen.getByRole("button", { name: "Change the time for Grand Hall, any event" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minutes for Grand Hall, any event" }), { target: { value: "105" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Change the time for Grand Hall, any event" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove the time for Grand Hall, any event" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Remove the time for Grand Hall, any event?" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Change the time for Grand Hall, wedding" }));
    });
  });

  it("starts afresh for another venue, never showing one venue's times under another", async () => {
    const { rerender } = render(<ChangeoverSettings venueId={VENUE} />);
    await screen.findAllByText("Grand Hall", { selector: ".changeovers__room" });
    mocks.list.mockReturnValueOnce(new Promise(() => undefined));
    rerender(<ChangeoverSettings venueId="00000000-0000-4000-8000-000000000200" />);
    expect(screen.queryAllByText("Grand Hall", { selector: ".changeovers__room" })).toHaveLength(0);
    expect(screen.getByText("Loading changeover times…")).toBeDefined();
  });

  it("says when the times cannot be loaded, and loads them again on request", async () => {
    mocks.list.mockRejectedValueOnce(new Error("Unavailable"));
    render(<ChangeoverSettings venueId={VENUE} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Changeover times could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findAllByText("Grand Hall", { selector: ".changeovers__room" })).toHaveLength(2);
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
});
