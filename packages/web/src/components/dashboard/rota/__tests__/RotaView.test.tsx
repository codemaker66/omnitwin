import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RotaShift, RotaWeek } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { RotaView } from "../RotaView.js";
import {
  CALLUM, HALL, JAMIE, MORAG, MORAG_SATURDAY, RECORDS, UNFILLED_BAR, VENUE, WEDDING_EVENT, hallCalendar, rotaWeek, shift,
} from "./rota-fixtures.js";

// ---------------------------------------------------------------------------
// The Rota view: Activity while the week loads, a failed load said plainly
// with a way to try again, a shift added from an empty day already filled in
// from the day's function, publishing that says what it will do before it is
// done, a week that changed underneath shown rather than overwritten, and one
// day at a time on a phone.
// ---------------------------------------------------------------------------

const { mocks, media } = vi.hoisted(() => ({
  mocks: { week: vi.fn(), calendar: vi.fn(), create: vi.fn(), publish: vi.fn(), updatePerson: vi.fn() },
  media: { phone: false, turnTaking: false },
}));

vi.mock("../../../../api/rota.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../api/rota.js")>(),
  getRotaWeek: mocks.week,
  createRotaShift: mocks.create,
  publishRotaWeek: mocks.publish,
  updateStaffMember: mocks.updatePerson,
}));

vi.mock("../../../../api/diary.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../api/diary.js")>(),
  getCalendar: mocks.calendar,
}));

vi.mock("../../../../hooks/use-media-query.js", () => ({
  useMediaQuery: (query: string): boolean => query.includes("760px") ? media.phone : query.includes("1179px") ? media.turnTaking : false,
}));

function renderView(path = "/dashboard?view=rota&week=2026-10-05"): ReturnType<typeof render> {
  return render(<MemoryRouter initialEntries={[path]}><RotaView /></MemoryRouter>);
}

function lede(container: HTMLElement): string {
  return container.querySelector(".rota__lede")?.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  media.phone = false;
  media.turnTaking = false;
  mocks.week.mockResolvedValue(rotaWeek());
  mocks.calendar.mockResolvedValue(hallCalendar());
  useAuthStore.getState().setUser({
    id: "00000000-0000-4000-8000-0000000000d1", name: "Elaine MacGregor", email: "elaine@tradeshall.example",
    role: "admin", platformRole: "none", venueId: VENUE,
  });
});

afterEach(() => { cleanup(); useAuthStore.getState().setUser(null); });

describe("RotaView", () => {
  it("shows Activity while the week loads, then the week with the Diary's functions along the top", async () => {
    let resolveWeek: (week: RotaWeek) => void = () => undefined;
    mocks.week.mockImplementation(() => new Promise<RotaWeek>((resolve) => { resolveWeek = resolve; }));
    const { container } = renderView();
    expect(screen.getByRole("status").textContent).toContain("Loading the rota…");
    expect(mocks.week).toHaveBeenCalledWith(VENUE, "2026-10-05", expect.any(AbortSignal));

    await act(async () => { resolveWeek(rotaWeek()); await Promise.resolve(); });
    expect(await screen.findByRole("heading", { name: "Rota", level: 1 })).toBeDefined();
    expect(screen.getByText("Week of 5 October 2026")).toBeDefined();
    expect(lede(container)).toBe("3 shifts for 2 people. 1 still needs someone.");
    expect(await screen.findByText("Robertson and Kaur wedding")).toBeDefined();
    // Provisional work is only quiet likely demand, never a Confirmed function.
    expect(screen.getByText("Provisional").closest(".rota-fn-likely")).not.toBeNull();
    expect(mocks.calendar).toHaveBeenCalledWith(VENUE, "2026-10-04T23:00:00.000Z", "2026-10-11T23:00:00.000Z", expect.any(AbortSignal));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says plainly when the week cannot be loaded, and loads it on a second try", async () => {
    mocks.week.mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR")).mockResolvedValue(rotaWeek());
    renderView();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The rota could not be loaded. Nothing has changed.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Rota", level: 1 })).toBeDefined();
    expect(mocks.week).toHaveBeenCalledTimes(2);
  });

  it("says all shifts are filled when nothing needs someone", async () => {
    mocks.week.mockResolvedValue(rotaWeek({ shifts: [MORAG_SATURDAY] }));
    const { container } = renderView();
    await screen.findByRole("heading", { name: "Rota", level: 1 });
    expect(lede(container)).toBe("1 shift for 1 person. All shifts filled.");
  });

  it("adds a shift from an empty day, filled in from that day's Confirmed function", async () => {
    const created = shift({
      id: "00000000-0000-4000-8000-0000000000b9", staffMemberId: JAMIE, role: "av", startsAt: "2026-10-10T10:00:00.000Z",
      endsAt: "2026-10-10T23:30:00.000Z", eventId: WEDDING_EVENT, eventName: "Robertson and Kaur wedding",
    });
    mocks.create.mockResolvedValue(created);
    renderView();
    await screen.findByText("Robertson and Kaur wedding");

    fireEvent.click(screen.getByRole("button", { name: "Add a shift for Jamie Kerr on Saturday 10 October" }));
    const panel = screen.getByRole("complementary", { name: "Shift" });
    expect(within(panel).getByRole("heading", { name: "New shift" })).toBeDefined();
    expect(within(panel).getByLabelText<HTMLSelectElement>("Role").value).toBe("av");
    expect(within(panel).getByLabelText<HTMLInputElement>("Starts").value).toBe("11:00");
    expect(within(panel).getByLabelText<HTMLInputElement>("Ends").value).toBe("00:30");
    expect(within(panel).getByText("13 hours 30 minutes, ending the next day.")).toBeDefined();
    expect(within(panel).getByText("Nobody is told until the week is published.")).toBeDefined();

    fireEvent.click(within(panel).getByRole("button", { name: "Add shift" }));
    await waitFor(() => { expect(mocks.create).toHaveBeenCalledTimes(1); });
    expect(mocks.create).toHaveBeenCalledWith(VENUE, {
      staffMemberId: JAMIE, role: "av", startsAt: "2026-10-10T10:00:00.000Z", endsAt: "2026-10-10T23:30:00.000Z",
      breakMinutes: 20, eventId: WEDDING_EVENT, spaceId: HALL, note: null,
    });
    expect(await within(panel).findByText("Added as a draft. Nobody is told until the week is published.")).toBeDefined();
    expect(within(panel).getByRole("heading", { name: "Draft shift" })).toBeDefined();
    // The new shift is on the week at once, before the week is read again.
    expect(screen.getByRole("button", { name: /^Jamie Kerr, Saturday 10 October, 11:00 to 00:30 the next day, av/u })).toBeDefined();
  });

  it("says what publishing will do before it is done, asks, then says what it did", async () => {
    mocks.publish.mockResolvedValue({ published: 2, told: 1, notTold: 0 });
    renderView();
    await screen.findByRole("heading", { name: "Rota", level: 1 });
    const consequence = "Publishes 2 shifts, 1 of them unfilled, and tells Morag Sinclair in the app. One of the shifts carries a warning.";
    expect(screen.getByText(consequence)).toBeDefined();
    expect(screen.getByText("Callum Reid has no right-to-work check recorded, so 1 shift stays in draft until one is.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Publish this week" }));
    const question = screen.getByText("Publish the week of 5 October 2026?");
    // The question takes focus, so a second press of Enter cannot publish.
    expect(document.activeElement).toBe(question);
    expect(screen.queryByRole("button", { name: "Publish this week" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Publish and tell 1 person" }));
    expect(await screen.findByText("Published 2 shifts. 1 person has been told in the app.")).toBeDefined();
    const sent = (mocks.publish.mock.calls[0] ?? []) as [string, string, readonly RotaShift[]];
    expect(sent[0]).toBe(VENUE);
    expect(sent[1]).toBe("2026-10-05");
    expect(sent[2].map((one) => one.id)).toEqual([MORAG_SATURDAY.id, UNFILLED_BAR.id]);
    await waitFor(() => { expect(mocks.week).toHaveBeenCalledTimes(2); });
  });

  it("lets the question go with Escape, and puts focus back on the button", async () => {
    renderView();
    await screen.findByRole("heading", { name: "Rota", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Publish this week" }));
    fireEvent.keyDown(screen.getByText("Publish the week of 5 October 2026?"), { key: "Escape" });
    const button = await screen.findByRole("button", { name: "Publish this week" });
    await waitFor(() => { expect(document.activeElement).toBe(button); });
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("shows the week as it stands when it changed while being published, and publishes nothing", async () => {
    mocks.publish.mockRejectedValue(new ApiError(409, "Something on this week changed a moment ago.", "WEEK_CHANGED"));
    renderView();
    await screen.findByRole("heading", { name: "Rota", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Publish this week" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish and tell 1 person" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("The week changed while you were looking at it. Here it is as it stands now; nothing was published.");
    await waitFor(() => { expect(mocks.week).toHaveBeenCalledTimes(2); });
  });

  it("shows one day at a time on a phone, chosen from day tabs", async () => {
    media.phone = true;
    media.turnTaking = true;
    renderView();
    await screen.findByRole("heading", { name: "Rota", level: 1 });
    expect(screen.queryByRole("table")).toBeNull();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(7);
    expect(screen.getByRole("heading", { name: "Monday 5 October", level: 2 })).toBeDefined();

    const saturday = screen.getByRole("tab", { name: "Saturday 10 October, 2 shifts" });
    fireEvent.click(saturday);
    expect(screen.getByRole("heading", { name: "Saturday 10 October", level: 2 })).toBeDefined();
    expect(saturday.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: /^Morag Sinclair, Saturday 10 October, 08:30 to 16:00, set-up/u })).toBeDefined();

    fireEvent.keyDown(saturday, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { name: "Sunday 11 October", level: 2 })).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Sunday 11 October, 0 shifts" }));
  });

  it("puts a saved staff record on the week at once, so the same change is never offered twice", async () => {
    const callum = RECORDS.find((one) => one.id === CALLUM);
    if (callum === undefined) throw new Error("fixture");
    mocks.updatePerson.mockResolvedValue({ ...callum, rightToWorkCheckedOn: "2026-09-24", revision: 2 });
    renderView();
    await screen.findByRole("heading", { name: "Rota", level: 1 });
    // The week is read again after the save, and that read is still on its way.
    mocks.week.mockImplementation(() => new Promise<RotaWeek>(() => undefined));
    fireEvent.click(screen.getByRole("button", { name: "Callum Reid: open their staff record" }));
    const drawer = screen.getByRole("complementary", { name: "Staff" });
    fireEvent.change(within(drawer).getByLabelText("Right to work checked on"), { target: { value: "2026-09-24" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
    expect(await within(drawer).findByText("Saved.")).toBeDefined();
    expect(within(drawer).getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    expect(within(drawer).getByLabelText<HTMLInputElement>("Right to work checked on").value).toBe("2026-09-24");
    expect(mocks.week).toHaveBeenCalledTimes(2);
  });

  it("gives the venue floor the published week to read, with nothing to change", async () => {
    mocks.week.mockResolvedValue(rotaWeek({
      access: "read", records: [],
      people: RECORDS.slice(0, 2).map((one) => ({ id: one.id, displayName: one.displayName, employmentType: one.employmentType, skills: one.skills, isActive: true, hasAccount: false })),
      shifts: [shift({ id: MORAG_SATURDAY.id, staffMemberId: MORAG, status: "published", publishedAt: "2026-10-01T09:00:00.000Z" })],
    }));
    renderView();
    await screen.findByRole("heading", { name: "Rota", level: 1 });
    expect(screen.queryByRole("button", { name: "Publish this week" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Staff" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Add a shift/u })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Morag Sinclair, Saturday 10 October/u }));
    const panel = screen.getByRole("complementary", { name: "Shift" });
    expect(within(panel).queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(within(panel).getByText("08:30 to 16:00")).toBeDefined();
  });

  it("shows anyone else on the rota their own shifts, without the Diary", async () => {
    mocks.week.mockResolvedValue(rotaWeek({
      access: "own", records: [],
      people: [{ id: JAMIE, displayName: "Jamie Kerr", employmentType: "agency", skills: ["av"], isActive: true, hasAccount: true }],
      shifts: [shift({ id: "00000000-0000-4000-8000-0000000000b7", staffMemberId: JAMIE, role: "av", status: "published", publishedAt: "2026-10-01T09:00:00.000Z" })],
    }));
    const { container } = renderView();
    await screen.findByRole("heading", { name: "Rota", level: 1 });
    expect(lede(container)).toBe("You have 1 shift this week.");
    expect(mocks.calendar).not.toHaveBeenCalled();
    expect(screen.queryByText("Unfilled")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish this week" })).toBeNull();
  });
});
