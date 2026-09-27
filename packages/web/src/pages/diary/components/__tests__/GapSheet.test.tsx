import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnaroundRuleSetting, TurnaroundRulesResponse } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
import type { LaneGap } from "../../lib/board-layout.js";
import { GapSheet } from "../GapSheet.js";

// ---------------------------------------------------------------------------
// The changeover sheet (T-637): a gap says how long the room has and what the
// room needs, in Venue settings' words; the venue's administrators keep,
// change or give the room its own time in place; a colleague's newer change
// is shown rather than overwritten; other roles read without changing.
// ---------------------------------------------------------------------------

const { mocks } = vi.hoisted(() => ({
  mocks: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

vi.mock("../../../../api/turnaround-rules.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../api/turnaround-rules.js")>(),
  listTurnaroundRules: mocks.list,
  createTurnaroundRule: mocks.create,
  updateTurnaroundRule: mocks.update,
}));

const VENUE = "00000000-0000-4000-8000-000000000100";
const HALL = "00000000-0000-4000-8000-000000000001";
const SALOON = "00000000-0000-4000-8000-000000000002";

function rule(id: string, spaceId: string | null, eventType: string | null, minutes: number,
  confirmed: Partial<Pick<TurnaroundRuleSetting, "confirmedAt" | "updatedByName">> = {}): TurnaroundRuleSetting {
  return {
    id, venueId: VENUE, spaceId, eventType, name: id, minutes, isActive: true,
    confirmedAt: confirmed.confirmedAt ?? null, updatedByName: confirmed.updatedByName ?? null,
    createdAt: "2026-09-20T09:00:00.000Z", updatedAt: "2026-09-20T09:00:00.000Z",
  };
}

function response(rules: TurnaroundRuleSetting[]): TurnaroundRulesResponse {
  return { rules, rooms: [{ id: HALL, name: "Grand Hall" }, { id: SALOON, name: "Saloon" }], eventTypes: ["wedding"] };
}

const ALL = rule("00000000-0000-4000-8000-00000000a001", null, null, 90);
const WEDDING = rule("00000000-0000-4000-8000-00000000a003", HALL, "wedding", 180,
  { confirmedAt: "2026-09-21T10:00:00.000Z", updatedByName: "Morag Sinclair" });

/** 17:00 to 19:30 in Glasgow on Saturday 19 September: two and a half hours. */
function gap(overrides: Partial<LaneGap> = {}): LaneGap {
  return {
    id: "b1:b2",
    startMs: Date.parse("2026-09-19T16:00:00Z"),
    endMs: Date.parse("2026-09-19T18:30:00Z"),
    minutes: 150,
    guidelineMinutes: null,
    guidelineName: null,
    tight: false,
    checked: true,
    before: { id: "b1", title: "Chamber lunch", eventType: "lunch" },
    after: { id: "b2", title: "MacLeod wedding", eventType: "wedding" },
    ...overrides,
  };
}

interface Rendered {
  readonly onClose: ReturnType<typeof vi.fn>;
  readonly onChanged: ReturnType<typeof vi.fn>;
}

function renderSheet(options: { readonly gap?: LaneGap; readonly canEdit?: boolean } = {}): Rendered {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(
    <MemoryRouter>
      <GapSheet venueId={VENUE} room={{ id: HALL, name: "Grand Hall" }} gap={options.gap ?? gap()}
        canEdit={options.canEdit ?? true} onClose={onClose} onChanged={onChanged} />
    </MemoryRouter>,
  );
  return { onClose, onChanged };
}

async function ruleCard(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: "The time this room needs" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue(response([ALL, WEDDING]));
});

afterEach(() => { cleanup(); });

describe("GapSheet", () => {
  it("says how long the room has, between which functions, and the time the room needs and who set it", async () => {
    renderSheet();
    const sheet = screen.getByRole("dialog", { name: "Changeover" });
    expect(within(sheet).getByText("2 h 30")).toBeDefined();
    expect(within(sheet).getByText("2 hours 30 minutes")).toBeDefined();
    expect(within(sheet).getByText("Chamber lunch ends at 17:00. MacLeod wedding starts at 19:30.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Close" })).toBe(document.activeElement);

    const card = await ruleCard();
    expect(mocks.list).toHaveBeenCalledWith(VENUE, expect.any(AbortSignal));
    // The most specific time wins: the Grand Hall's for weddings.
    expect(within(card).getByText("3 h")).toBeDefined();
    expect(within(card).getByText("Grand Hall, wedding")).toBeDefined();
    expect(within(card).getByText("Set by Morag Sinclair, 21 Sep 2026")).toBeDefined();
    expect(within(card).getByText("30 min short")).toBeDefined();
    expect(card.getAttribute("data-fit")).toBe("short");
  });

  it("says there is enough time when the gap covers the room's", async () => {
    renderSheet({ gap: gap({ minutes: 240, endMs: Date.parse("2026-09-19T20:00:00Z") }) });
    const card = await ruleCard();
    expect(within(card).getByText("Enough time")).toBeDefined();
    expect(card.getAttribute("data-fit")).toBe("enough");
  });

  it("checks only a gap between two confirmed functions, as the lane does", async () => {
    renderSheet({ gap: gap({ checked: false }) });
    const card = await ruleCard();
    expect(within(card).getByText("Checked once both functions are confirmed")).toBeDefined();
    expect(within(card).queryByText("30 min short")).toBeNull();
  });

  it("keeps a demo time with one press, and the board re-reads its gaps", async () => {
    mocks.list.mockResolvedValue(response([ALL]));
    const kept = { ...ALL, confirmedAt: "2026-09-26T21:00:00.000Z", updatedByName: "Elaine Gray", updatedAt: "2026-09-26T21:00:00.000Z" };
    mocks.update.mockResolvedValue(kept);
    const { onChanged } = renderSheet();
    const card = await ruleCard();
    expect(within(card).getByText("Not confirmed")).toBeDefined();
    expect(within(card).getByText("This time is for every room without its own.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Keep 1 h 30" }));
    await waitFor(() => { expect(within(card).getByText("Set by Elaine Gray, 26 Sep 2026")).toBeDefined(); });
    expect(mocks.update).toHaveBeenCalledWith(VENUE, ALL, 90);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Keep 1 h 30" })).toBeNull();
    expect(screen.getByText("All rooms, any event now needs 1 h 30.")).toBeDefined();
  });

  it("changes the time that applies in place, and gives focus back to Change", async () => {
    mocks.update.mockResolvedValue({ ...WEDDING, minutes: 150, updatedAt: "2026-09-26T21:00:00.000Z" });
    const { onChanged } = renderSheet();
    await ruleCard();
    fireEvent.click(screen.getByRole("button", { name: "Change the time for Grand Hall, wedding" }));
    const minutes = screen.getByRole("spinbutton", { name: "Minutes for Grand Hall, wedding" });
    expect(minutes).toBe(document.activeElement);
    fireEvent.change(minutes, { target: { value: "150" } });
    expect(screen.getByText("2 h 30", { selector: ".diary-changeover-preview" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(screen.getByRole("button", { name: "Change the time for Grand Hall, wedding" })).toBe(document.activeElement); });
    expect(mocks.update).toHaveBeenCalledWith(VENUE, WEDDING, 150);
    expect(within(await ruleCard()).getByText("Enough time")).toBeDefined();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("refuses to save what is not a time", async () => {
    renderSheet();
    await ruleCard();
    fireEvent.click(screen.getByRole("button", { name: "Change the time for Grand Hall, wedding" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minutes for Grand Hall, wedding" }), { target: { value: "2000" } });
    expect(screen.getByText("Enter 0 to 1,440 minutes")).toBeDefined();
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  });

  it("shows a colleague's newer change rather than overwriting it", async () => {
    const current = { ...WEDDING, minutes: 200, updatedAt: "2026-09-26T20:59:00.000Z" };
    mocks.update.mockRejectedValue(new ApiError(409, "Someone changed this", "RULE_CHANGED", current));
    const { onChanged } = renderSheet();
    await ruleCard();
    fireEvent.click(screen.getByRole("button", { name: "Change the time for Grand Hall, wedding" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minutes for Grand Hall, wedding" }), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Someone changed this a moment ago. It now says 3 h 20.")).toBeDefined();
    expect(within(await ruleCard()).getByText("3 h 20")).toBeDefined();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("gives the room its own time where only the every-room time applies", async () => {
    mocks.list.mockResolvedValue(response([ALL]));
    const own = rule("00000000-0000-4000-8000-00000000a004", HALL, null, 120, { confirmedAt: "2026-09-26T21:00:00.000Z", updatedByName: "Elaine Gray" });
    mocks.create.mockResolvedValue(own);
    renderSheet();
    await ruleCard();
    fireEvent.click(screen.getByRole("button", { name: "Set a time for Grand Hall" }));
    const minutes = screen.getByRole("spinbutton", { name: "Minutes for Grand Hall, any event" });
    expect((minutes as HTMLInputElement).value).toBe("90");
    fireEvent.change(minutes, { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const card = await ruleCard();
    await waitFor(() => { expect(within(card).getByText("Grand Hall, any event")).toBeDefined(); });
    expect(mocks.create).toHaveBeenCalledWith(VENUE, { spaceId: HALL, eventType: null, minutes: 120 });
    expect(within(card).getByText("2 h")).toBeDefined();
    expect(within(card).queryByText("This time is for every room without its own.")).toBeNull();
  });

  it("says a gap in a room with no time is not checked, and offers the room one", async () => {
    mocks.list.mockResolvedValue(response([]));
    renderSheet();
    const card = await ruleCard();
    expect(within(card).getByText("Grand Hall has no changeover time yet, so the Diary does not check this gap.")).toBeDefined();
    expect(card.getAttribute("data-fit")).toBe("none");
    fireEvent.click(screen.getByRole("button", { name: "Set a time for Grand Hall" }));
    const minutes = screen.getByRole("spinbutton", { name: "Minutes for Grand Hall, any event" });
    expect((minutes as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  });

  it("reads without changing for a role that does not set changeover times", async () => {
    renderSheet({ canEdit: false });
    await ruleCard();
    expect(screen.getByText("The venue's administrators set changeover times.")).toBeDefined();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Close"]);
    expect(screen.queryByRole("link", { name: "All changeover times" })).toBeNull();
  });

  it("links an administrator to every changeover time in Venue settings", async () => {
    renderSheet();
    await ruleCard();
    expect(screen.getByRole("link", { name: "All changeover times" }).getAttribute("href")).toBe("/dashboard?view=settings");
  });

  it("steps back one level with Escape: out of an edit, then the sheet", async () => {
    const { onClose } = renderSheet();
    await ruleCard();
    fireEvent.click(screen.getByRole("button", { name: "Change the time for Grand Hall, wedding" }));
    const minutes = screen.getByRole("spinbutton", { name: "Minutes for Grand Hall, wedding" });
    fireEvent.keyDown(minutes, { key: "Escape" });
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => { expect(screen.getByRole("button", { name: "Change the time for Grand Hall, wedding" })).toBe(document.activeElement); });
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Changeover" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says when the times could not be read, and tries again", async () => {
    mocks.list.mockRejectedValueOnce(new Error("offline"));
    renderSheet();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The changeover times could not be read.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); await Promise.resolve(); });
    expect(within(await ruleCard()).getByText("3 h")).toBeDefined();
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
});
