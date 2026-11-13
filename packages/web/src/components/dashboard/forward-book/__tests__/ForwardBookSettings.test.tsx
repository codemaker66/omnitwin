import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForwardBookCheck, ForwardBookResponse } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
import { ForwardBookSettings } from "../ForwardBookSettings.js";

// ---------------------------------------------------------------------------
// Dates for assistants and the website (Blake, 17 October 2026: "hide date
// status until checked"): where each room stands and who said so, the
// consequence read before anything is saved, a colleague's record shown
// rather than overwritten, and only the venue's admin or manager offered the
// controls.
// ---------------------------------------------------------------------------

const { mocks } = vi.hoisted(() => ({
  mocks: {
    list: vi.fn(),
    record: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("../../../../api/forward-book.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../api/forward-book.js")>(),
  listForwardBook: mocks.list,
  recordForwardBook: mocks.record,
  clearForwardBook: mocks.clear,
}));

const VENUE = "00000000-0000-4000-8000-000000000100";
const HALL = "00000000-0000-4000-8000-000000000001";
const SALOON = "00000000-0000-4000-8000-000000000002";
const RECEPTION = "00000000-0000-4000-8000-000000000003";

function check(id: string, spaceId: string, overrides: Partial<ForwardBookCheck> = {}): ForwardBookCheck {
  return {
    id, spaceId, recordedAt: "2026-10-12T09:30:00.000Z", recordedByName: "Moira Brown", note: null,
    clearedAt: null, clearedByName: null, ...overrides,
  };
}

const SALOON_CHECK = check("00000000-0000-4000-8000-00000000c002", SALOON, { note: "Compared with the paper diary to Dec 2027." });
const RECEPTION_CLEARED = check("00000000-0000-4000-8000-00000000c003", RECEPTION, {
  clearedAt: "2026-10-14T16:00:00.000Z", clearedByName: "Elspeth Grant",
});

function response(): ForwardBookResponse {
  return {
    rooms: [
      { spaceId: HALL, name: "Grand Hall", current: null, previous: null },
      { spaceId: SALOON, name: "Saloon", current: SALOON_CHECK, previous: null },
      { spaceId: RECEPTION, name: "Reception Room", current: null, previous: RECEPTION_CLEARED },
    ],
  };
}

function row(room: string): HTMLElement {
  const found = screen.getAllByRole("listitem").find((item) => item.querySelector(".forward-book__name")?.textContent === room);
  if (found === undefined) throw new Error(`no row for ${room}`);
  return found;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue(response());
});

afterEach(() => { cleanup(); });

describe("ForwardBookSettings", () => {
  it("names each room's action with the words it shows, so speech control can say them (WCAG 2.5.3)", async () => {
    render(<ForwardBookSettings venueId={VENUE} canRecord />);
    await screen.findByText("Grand Hall");
    const actions = screen.getAllByRole("button").filter((button) => button.getAttribute("aria-label") !== null);
    expect(actions.length).toBe(3);
    for (const button of actions) {
      expect(button.getAttribute("aria-label")).toContain(button.textContent?.trim() ?? "");
    }
  });

  it("says where each room stands and who said so, in the venue's words", async () => {
    render(<ForwardBookSettings venueId={VENUE} canRecord />);
    expect(await screen.findByText("Grand Hall")).toBeDefined();
    expect(mocks.list).toHaveBeenCalledWith(VENUE, expect.any(AbortSignal));
    expect(within(row("Grand Hall")).getByText("Dates hidden")).toBeDefined();
    expect(within(row("Grand Hall")).getByText("Not checked yet")).toBeDefined();
    expect(within(row("Saloon")).getByText("Dates shown")).toBeDefined();
    expect(within(row("Saloon")).getByText("Checked by Moira Brown, 12 Oct 2026")).toBeDefined();
    expect(within(row("Saloon")).getByText("Compared with the paper diary to Dec 2027.")).toBeDefined();
    expect(within(row("Reception Room")).getByText("Hidden by Elspeth Grant, 14 Oct 2026")).toBeDefined();
    expect(row("Saloon").getAttribute("data-state")).toBe("shown");
    expect(row("Grand Hall").getAttribute("data-state")).toBe("hidden");
  });

  it("waits visibly while the rooms load, then shows them", async () => {
    const pending = deferred<ForwardBookResponse>();
    mocks.list.mockReturnValue(pending.promise);
    render(<ForwardBookSettings venueId={VENUE} canRecord />);
    expect(screen.getByRole("status").textContent).toContain("Loading rooms");
    await act(async () => { pending.resolve(response()); await pending.promise; });
    expect(screen.queryByText("Loading rooms…")).toBeNull();
    expect(screen.getByText("Grand Hall")).toBeDefined();
  });

  it("says when the rooms could not be loaded, and tries again", async () => {
    mocks.list.mockRejectedValueOnce(new Error("offline"));
    render(<ForwardBookSettings venueId={VENUE} canRecord />);
    expect((await screen.findByRole("alert")).textContent).toBe("The rooms could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Grand Hall")).toBeDefined();
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("says what recording does before saving, then records the check with its note", async () => {
    const saving = deferred<ForwardBookCheck>();
    mocks.record.mockReturnValue(saving.promise);
    render(<ForwardBookSettings venueId={VENUE} canRecord />);
    fireEvent.click(await screen.findByRole("button", { name: "Record the check for the Grand Hall" }));

    const panel = screen.getByRole("form", { name: "Record the check for the Grand Hall" });
    expect(panel.textContent).toContain("Assistants and the website will start saying whether the Grand Hall has bookings on a date");
    const note = within(panel).getByLabelText("Note (optional)");
    await waitFor(() => { expect(document.activeElement).toBe(note); });
    fireEvent.change(note, { target: { value: "Compared with Salesforce and the paper diary." } });
    fireEvent.click(within(panel).getByRole("button", { name: "Record the check" }));

    expect(mocks.record).toHaveBeenCalledWith(VENUE, HALL, "Compared with Salesforce and the paper diary.");
    expect(within(panel).getByRole("button", { name: "Recording…" }).getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      saving.resolve(check("00000000-0000-4000-8000-00000000c001", HALL, { recordedByName: "Elspeth Grant", note: "Compared with Salesforce and the paper diary." }));
      await saving.promise;
    });
    expect(within(row("Grand Hall")).getByText("Dates shown")).toBeDefined();
    expect(within(row("Grand Hall")).getByText("Checked by Elspeth Grant, 12 Oct 2026")).toBeDefined();
    const hide = within(row("Grand Hall")).getByRole("button", { name: "Hide dates for the Grand Hall" });
    await waitFor(() => { expect(document.activeElement).toBe(hide); });
  });

  it("closes without saving on Cancel or Escape", async () => {
    render(<ForwardBookSettings venueId={VENUE} canRecord />);
    fireEvent.click(await screen.findByRole("button", { name: "Record the check for the Grand Hall" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Record the check for the Grand Hall" }));
    fireEvent.keyDown(screen.getByLabelText("Note (optional)"), { key: "Escape" });
    expect(screen.queryByRole("form")).toBeNull();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("says what hiding does before doing it, then hides the room's dates and keeps who did it", async () => {
    mocks.clear.mockResolvedValue({ ...SALOON_CHECK, clearedAt: "2026-10-17T10:00:00.000Z", clearedByName: "Elspeth Grant" });
    render(<ForwardBookSettings venueId={VENUE} canRecord />);
    fireEvent.click(await screen.findByRole("button", { name: "Hide dates for the Saloon" }));
    const panel = screen.getByRole("group", { name: "Hide dates for the Saloon?" });
    expect(panel.textContent).toContain("will stop saying whether the Saloon has bookings on a date, within a minute");
    fireEvent.click(within(panel).getByRole("button", { name: "Hide dates" }));
    expect(mocks.clear).toHaveBeenCalledWith(VENUE, SALOON_CHECK.id);
    expect(await within(row("Saloon")).findByText("Hidden by Elspeth Grant, 17 Oct 2026")).toBeDefined();
    expect(within(row("Saloon")).getByText("Dates hidden")).toBeDefined();
    expect(within(row("Saloon")).getByRole("button", { name: "Record the check for the Saloon" })).toBeDefined();
  });

  it("shows a colleague's record that got there first, rather than overwriting it", async () => {
    const theirs = check("00000000-0000-4000-8000-00000000c009", HALL, { recordedByName: "Iain Fraser" });
    mocks.record.mockRejectedValue(new ApiError(409, "This room's check was recorded a moment ago.", "FORWARD_BOOK_ALREADY_RECORDED", theirs));
    render(<ForwardBookSettings venueId={VENUE} canRecord />);
    fireEvent.click(await screen.findByRole("button", { name: "Record the check for the Grand Hall" }));
    fireEvent.click(screen.getByRole("button", { name: "Record the check" }));
    expect(await within(row("Grand Hall")).findByText("Iain Fraser recorded this check a moment ago.")).toBeDefined();
    expect(within(row("Grand Hall")).getByText("Checked by Iain Fraser, 12 Oct 2026")).toBeDefined();
  });

  it("keeps the panel open and says nothing changed when the save fails", async () => {
    mocks.record.mockRejectedValue(new ApiError(0, "Network error", "NETWORK_ERROR"));
    render(<ForwardBookSettings venueId={VENUE} canRecord />);
    fireEvent.click(await screen.findByRole("button", { name: "Record the check for the Grand Hall" }));
    fireEvent.click(screen.getByRole("button", { name: "Record the check" }));
    expect(await screen.findByText("The check could not be recorded. Nothing has changed; try again.")).toBeDefined();
    expect(screen.getByRole("form", { name: "Record the check for the Grand Hall" })).toBeDefined();
    expect(within(row("Grand Hall")).getByText("Dates hidden")).toBeDefined();
  });

  it("offers no controls to someone who cannot record, and says who can", async () => {
    render(<ForwardBookSettings venueId={VENUE} canRecord={false} />);
    expect(await screen.findByText("Grand Hall")).toBeDefined();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("The venue’s admin or a manager records these checks.")).toBeDefined();
  });
});
