import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import type { VenueDetail } from "../../../api/spaces.js";
import { HallkeeperRoomPlansPage } from "../HallkeeperRoomPlansPage.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { RoomPlanReference } from "../../../components/hallkeeper/RoomPlanReference.js";
import { getHallkeeperRoomPlan, HALLKEEPER_ROOM_PLANS } from "../../../data/hallkeeper-room-plans.js";

const { getVenueMock } = vi.hoisted(() => ({ getVenueMock: vi.fn() }));
vi.mock("../../../api/spaces.js", () => ({ getVenue: getVenueMock }));
vi.mock("../../../components/dashboard/DashboardLayout.js", () => ({
  DashboardLayout: ({ children }: { readonly children: ReactNode }) => <main>{children}</main>,
}));

function venue(id = "venue-1", slug = "trades-hall-glasgow"): VenueDetail {
  return { id, slug, name: "Trades Hall", address: "", logoUrl: null, brandColour: null, spaces: [] };
}

function Location(): React.ReactElement {
  return <output data-testid="location">{useLocation().search}</output>;
}

function renderLibrary(query = ""): void {
  render(<MemoryRouter initialEntries={[`/hallkeeper/rooms${query}`]}><HallkeeperRoomPlansPage /><Location /></MemoryRouter>);
}

function setVenueId(venueId: string | null): void {
  useAuthStore.getState().setUser({ id: "keeper", email: "keeper@example.test", role: "hallkeeper", platformRole: "none", name: "Keeper", venueId });
}

beforeEach(() => {
  getVenueMock.mockReset();
  getVenueMock.mockResolvedValue(venue());
  setVenueId("venue-1");
});
afterEach(() => { cleanup(); useAuthStore.getState().logout(); });

describe("HallkeeperRoomPlansPage", () => {
  it("opens the URL-selected room and preserves other query context when selecting another room", async () => {
    renderLibrary("?room=south-gallery&from=sheet");
    await screen.findByRole("heading", { name: "South Gallery" });
    expect(screen.getByRole("button", { name: "South Gallery" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByAltText("South Gallery cleaned reference plan").getAttribute("src")).toBe("/room-plans/cleaned/south-gallery.png");
    for (const room of HALLKEEPER_ROOM_PLANS) expect(screen.getByRole("button", { name: room.name })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Saloon" }));
    expect(screen.getByRole("heading", { name: "Saloon" })).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("?room=saloon&from=sheet");
  });

  it("switches the image to the untouched source and resets to the selected room's default view", async () => {
    renderLibrary();
    await screen.findByRole("heading", { name: "Grand Hall" });
    fireEvent.click(screen.getByRole("button", { name: "Original" }));
    expect(screen.getByAltText("Grand Hall original reference plan").getAttribute("src")).toBe("/room-plans/originals/grand-hall.png");
    const download = screen.getByRole("link", { name: "Download original" });
    expect(download.getAttribute("href")).toBe("/room-plans/originals/grand-hall.png");
    expect(download.hasAttribute("download")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Robert Adam Room" }));
    expect(screen.getByRole("button", { name: "Cleaned" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByAltText("Robert Adam Room cleaned reference plan")).toBeTruthy();
  });

  it("uses the original left-room viewport for North and offers the full combined source", async () => {
    renderLibrary("?room=north-gallery");
    await screen.findByRole("heading", { name: "North Gallery" });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Cleaned" }).disabled).toBe(true);
    const image = screen.getByAltText("North Gallery original reference plan, left-hand room detail");
    expect(image.getAttribute("src")).toBe("/room-plans/originals/galleries-combined.png");
    expect(screen.getByTestId("room-plan-crop").style.aspectRatio).toBe("320 / 566");
    expect(image.style.width).toBe("231.875%");
    expect(screen.getByRole("link", { name: "View the full combined source" }).getAttribute("href")).toBe("/room-plans/originals/galleries-combined.png");
    expect(screen.getByText(/original download retains both galleries/u)).toBeTruthy();
    expect(getHallkeeperRoomPlan("north-gallery")?.cleanedSrc).toBeNull();
  });

  it("does not request or display venue plans for an unassigned account", () => {
    setVenueId(null);
    renderLibrary();
    expect(screen.getByText("No venue is linked to this account.")).toBeTruthy();
    expect(getVenueMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Plan version" })).toBeNull();
  });

  it("does not map another venue by its display name", async () => {
    getVenueMock.mockResolvedValue(venue("venue-1", "another-venue"));
    renderLibrary();
    await screen.findByText("No supplied room references are available for this venue.");
    expect(screen.queryByRole("button", { name: "Grand Hall" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Plan version" })).toBeNull();
  });

  it("rejects a mismatched venue id and lets a real retry recover", async () => {
    getVenueMock.mockResolvedValueOnce(venue("wrong-venue")).mockResolvedValueOnce(venue());
    renderLibrary();
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Grand Hall" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "Grand Hall" });
    expect(getVenueMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed venue load actionable", async () => {
    getVenueMock.mockRejectedValue(new Error("Connection interrupted"));
    renderLibrary();
    await screen.findByText("Connection interrupted");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Plan version" })).toBeNull();
  });

  it("does not let a stale response reveal Trades Hall plans after the venue changes", async () => {
    let resolveFirst: (value: VenueDetail) => void = () => { throw new Error("Request not started"); };
    getVenueMock.mockReturnValueOnce(new Promise<VenueDetail>((resolve) => { resolveFirst = resolve; }));
    getVenueMock.mockResolvedValueOnce(venue("venue-2", "another-venue"));
    renderLibrary();
    const status = screen.getByText("Loading venue references…").closest("[role='status']");
    expect(status?.querySelector("[data-activity-indicator]")).not.toBeNull();
    act(() => { setVenueId("venue-2"); });
    await screen.findByText("No supplied room references are available for this venue.");
    await act(async () => { resolveFirst(venue()); await Promise.resolve(); });
    expect(screen.queryByRole("button", { name: "Grand Hall" })).toBeNull();
    expect(screen.getByText("No supplied room references are available for this venue.")).toBeTruthy();
  });

  it("hides already displayed references immediately on a venue switch", async () => {
    renderLibrary();
    await screen.findByRole("heading", { name: "Grand Hall" });
    getVenueMock.mockReturnValue(new Promise<VenueDetail>(() => undefined));
    act(() => { setVenueId("venue-2"); });
    expect(screen.queryByRole("heading", { name: "Grand Hall" })).toBeNull();
    expect(screen.getByText("Loading venue references…")).toBeTruthy();
  });

  it("falls back safely from an unknown room query", async () => {
    renderLibrary("?room=toString");
    await screen.findByRole("heading", { name: "Grand Hall" });
    expect(getHallkeeperRoomPlan("toString")).toBeNull();
    expect(getHallkeeperRoomPlan("Grand Hall")).toBeNull();
  });
});

describe("RoomPlanReference", () => {
  it("uses shared image activity and recovers through the other source after an image failure", async () => {
    const room = getHallkeeperRoomPlan("south-gallery");
    if (room === null) throw new Error("Missing fixture reference");
    render(<RoomPlanReference room={room} compact />);
    expect(screen.getByText("Loading room reference…").closest("[role='status']")?.querySelector("[data-activity-indicator]")).not.toBeNull();
    fireEvent.error(screen.getByAltText("South Gallery cleaned reference plan"));
    expect(screen.getByRole("alert").textContent).toContain("could not load");
    expect(screen.getByRole("link", { name: "Open the original source" }).getAttribute("href")).toBe(room.originalSrc);
    fireEvent.click(screen.getByRole("button", { name: "Original" }));
    fireEvent.load(screen.getByAltText("South Gallery original reference plan"));
    await waitFor(() => { expect(screen.queryByText("Loading room reference…")).toBeNull(); });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
