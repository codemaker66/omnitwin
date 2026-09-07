import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getVenue, type VenueDetail } from "../../../../api/spaces.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { useLayoutTimelinePreviewStore } from "../../../../stores/layout-timeline-preview-store.js";
import { ReferenceRoomHeader } from "../ReferenceRoomHeader.js";

vi.mock("../../../../api/spaces.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../api/spaces.js")>(),
  getVenue: vi.fn(),
}));

const venueRequest = vi.mocked(getVenue);
const tradesHall: VenueDetail = {
  id: "venue-trades",
  name: "Trades Hall Glasgow",
  slug: "trades-hall-glasgow",
  address: "85 Glassford Street",
  logoUrl: "https://example.com/old-trades-logo.png",
  brandColour: null,
  spaces: [],
};
const cityRooms: VenueDetail = {
  id: "venue-city",
  name: "City Rooms",
  slug: "city-rooms",
  address: "1 Example Street",
  logoUrl: "https://example.com/city-rooms-logo.png",
  brandColour: null,
  spaces: [],
};

function deferredVenue(): {
  readonly promise: Promise<VenueDetail>;
  readonly resolve: (venue: VenueDetail) => void;
  readonly reject: (error: Error) => void;
} {
  let resolve: (venue: VenueDetail) => void = () => { throw new Error("Promise not initialized"); };
  let reject: (error: Error) => void = () => { throw new Error("Promise not initialized"); };
  const promise = new Promise<VenueDetail>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const originalSave = useEditorStore.getState().saveToServer;
const save = vi.fn<typeof originalSave>().mockResolvedValue(true);
const originalReload = useEditorStore.getState().reloadAfterConflict;
const reload = vi.fn<typeof originalReload>().mockResolvedValue(undefined);

beforeEach(() => {
  save.mockClear();
  reload.mockClear();
  venueRequest.mockReset();
  useEditorStore.setState({ configId: "cfg-demo", venueId: null, space: null, isSaving: false, isDirty: true, saveError: null, saveConflict: null, saveToServer: save, reloadAfterConflict: reload });
  useAuthStore.setState({ isAuthenticated: true });
  useLayoutTimelinePreviewStore.getState().clear();
});
afterEach(() => {
  cleanup();
  useEditorStore.setState({ saveToServer: originalSave, reloadAfterConflict: originalReload, saveConflict: null });
  useLayoutTimelinePreviewStore.getState().clear();
});

function showHeader(): void {
  render(<MemoryRouter><ReferenceRoomHeader /></MemoryRouter>);
}

describe("ReferenceRoomHeader", () => {
  it("uses the selected Trades Hall venue and supplied crest while retaining its room subtitle", async () => {
    venueRequest.mockResolvedValue(tradesHall);
    useEditorStore.setState({
      venueId: tradesHall.id,
      space: { id: "space-grand", venueId: tradesHall.id, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10.5", heightM: "7.5", floorPlanOutline: [] },
    });
    useAuthStore.setState({ user: { id: "user-city", email: "planner@example.com", name: "City Planner", role: "planner", platformRole: "none", venueId: cityRooms.id } });
    showHeader();
    const identity = await screen.findByRole("link", { name: "Trade's Hall of Glasgow diary" });
    expect(venueRequest).toHaveBeenCalledWith(tradesHall.id);
    expect(venueRequest).not.toHaveBeenCalledWith(cityRooms.id);
    expect(identity.textContent).toContain("Grand Hall");
    expect(identity.querySelector("img")?.getAttribute("src")).toBe("/images/venues/trades-hall-glasgow-crest.png");
    expect(screen.queryByText("VENVIEWER")).toBeNull();
  });

  it("uses another selected venue's own name and logo", async () => {
    venueRequest.mockResolvedValue(cityRooms);
    useEditorStore.setState({ venueId: cityRooms.id });
    showHeader();
    const identity = await screen.findByRole("link", { name: "City Rooms diary" });
    expect(identity.querySelector("img")?.getAttribute("src")).toBe(cityRooms.logoUrl);
    act(() => { useAuthStore.setState({ isAuthenticated: false }); });
    expect(screen.getByRole("link", { name: "City Rooms home" }).getAttribute("href")).toBe("/");
  });

  it("keeps the current venue when an older selection's request resolves last", async () => {
    const first = deferredVenue();
    const second = deferredVenue();
    venueRequest.mockImplementation((venueId) => venueId === tradesHall.id ? first.promise : second.promise);
    useEditorStore.setState({ venueId: tradesHall.id });
    showHeader();
    expect(screen.getByRole("link", { name: "Venue planner diary" }).querySelector("[data-activity-indicator]")).not.toBeNull();
    act(() => { useEditorStore.setState({ venueId: cityRooms.id }); });
    await act(async () => { second.resolve(cityRooms); await second.promise; });
    expect(screen.getByRole("link", { name: "City Rooms diary" })).toBeTruthy();
    await act(async () => { first.resolve(tradesHall); await first.promise; });
    const identity = screen.getByRole("link", { name: "City Rooms diary" });
    expect(identity.querySelector("img")?.getAttribute("src")).toBe(cityRooms.logoUrl);
    expect(screen.queryByRole("link", { name: "Trade's Hall of Glasgow diary" })).toBeNull();
  });

  it("clears the previous identity during a selection change and reports a failed lookup without its crest", async () => {
    const second = deferredVenue();
    venueRequest.mockImplementation((venueId) => venueId === tradesHall.id ? Promise.resolve(tradesHall) : second.promise);
    useEditorStore.setState({ venueId: tradesHall.id });
    showHeader();
    await screen.findByRole("link", { name: "Trade's Hall of Glasgow diary" });
    act(() => { useEditorStore.setState({ venueId: cityRooms.id }); });
    const pending = screen.getByRole("link", { name: "Venue planner diary" });
    expect(pending.querySelector("img")).toBeNull();
    expect(screen.queryByRole("link", { name: "Trade's Hall of Glasgow diary" })).toBeNull();
    await act(async () => { second.reject(new Error("Venue lookup failed")); await second.promise.catch(() => undefined); });
    const unavailable = screen.getByRole("link", { name: "Venue unavailable diary" });
    expect(unavailable.querySelector("img")).toBeNull();
    expect(unavailable.querySelector("[data-activity-indicator]")).toBeNull();
  });

  it("uses a neutral mark when the selected venue has no logo", async () => {
    venueRequest.mockResolvedValue({ ...cityRooms, logoUrl: null });
    useEditorStore.setState({ venueId: cityRooms.id });
    showHeader();
    const identity = await screen.findByRole("link", { name: "City Rooms diary" });
    expect(identity.querySelector("img")).toBeNull();
    expect(identity.querySelector("svg")).not.toBeNull();
  });

  it("falls back to a neutral mark if the selected venue's logo fails to load", async () => {
    venueRequest.mockResolvedValue(cityRooms);
    useEditorStore.setState({ venueId: cityRooms.id });
    showHeader();
    const identity = await screen.findByRole("link", { name: "City Rooms diary" });
    const logo = identity.querySelector("img");
    expect(logo).not.toBeNull();
    if (logo === null) throw new Error("Expected the venue logo before simulating a failed image load");
    fireEvent.error(logo);
    expect(identity.querySelector("img")).toBeNull();
    expect(identity.querySelector("svg")).not.toBeNull();
    expect(identity.textContent).toContain("City Rooms");
  });

  it("checks the live preview lock even before React replaces the prior click handler", () => {
    useEditorStore.setState({ saveError: "Changed elsewhere", saveConflict: { expectedRevision: 1, currentRevision: 2, message: "Changed" } });
    showHeader();
    const recovery = screen.getByRole("button", { name: "Reload layout" });
    act(() => {
      useLayoutTimelinePreviewStore.getState().showPending("Loading phase");
      // Both actions are in one batch: the button still has its old closure.
      fireEvent.click(recovery);
    });
    expect(reload).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("reloads a conflicted layout instead of resending a stale revision, respecting preview lock", () => {
    useEditorStore.setState({ saveError: "Changed elsewhere", saveConflict: { expectedRevision: 1, currentRevision: 2, message: "Changed" } });
    showHeader();
    expect(screen.getByRole("status").textContent).toBe("Reload layout");
    fireEvent.click(screen.getByRole("button", { name: "Reload layout" }));
    expect(reload).toHaveBeenCalledWith(true);
    expect(save).not.toHaveBeenCalled();
    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Loading phase"); });
    fireEvent.click(screen.getByRole("button", { name: "Reload layout" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("uses the current authentication route and real save action", () => {
    showHeader();
    expect(screen.getByRole("link", { name: "Venue planner diary" }).getAttribute("href")).toBe("/diary");
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    expect(save).toHaveBeenCalledWith(true);
    act(() => { useAuthStore.setState({ isAuthenticated: false }); });
    expect(screen.getByRole("link", { name: "Venue planner home" }).getAttribute("href")).toBe("/");
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    expect(save).toHaveBeenLastCalledWith(false);
  });

  it("shows pending and failed save states without claiming success or allowing duplicate saves", () => {
    showHeader();
    act(() => { useEditorStore.setState({ isSaving: true }); });
    const pending = screen.getByRole("button", { name: "Saving layout" });
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(pending.querySelector("[data-activity-indicator]")).not.toBeNull();
    fireEvent.click(pending);
    expect(save).not.toHaveBeenCalled();
    act(() => { useEditorStore.setState({ isSaving: false, saveError: "Offline" }); });
    expect(screen.getByRole("status").textContent).toBe("Retry save");
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("prevents saving a frozen phase preview or absent configuration", () => {
    showHeader();
    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Loading saved phase"); });
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    expect(save).not.toHaveBeenCalled();
    act(() => { useLayoutTimelinePreviewStore.getState().clear(); useEditorStore.setState({ configId: null, isDirty: false }); });
    fireEvent.click(screen.getByRole("button", { name: "No saved layout" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("No saved layout");
  });
});
