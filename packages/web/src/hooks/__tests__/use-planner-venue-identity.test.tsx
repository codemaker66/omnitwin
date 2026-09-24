import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VenueDetail } from "../../api/spaces.js";

vi.mock("../../api/spaces.js", () => ({ getVenue: vi.fn() }));
const spacesApi = vi.mocked(await import("../../api/spaces.js"));
const { prefetchPlannerVenue, usePlannerVenueIdentity } = await import("../use-planner-venue-identity.js");

const cityRooms: VenueDetail = { id: "venue-city", name: "City Rooms", slug: "city-rooms", address: "1 Example Street", logoUrl: null, brandColour: null, spaces: [] };

function Identity({ venueId }: { readonly venueId: string | null }): ReactElement {
  const venue = usePlannerVenueIdentity(venueId);
  return <p data-loading={String(venue.loading)}>{venue.name}</p>;
}

beforeEach(() => {
  vi.resetAllMocks();
  spacesApi.getVenue.mockResolvedValue(cityRooms);
});
afterEach(cleanup);

describe("usePlannerVenueIdentity", () => {
  it("joins the venue read the planner bootstrap started instead of repeating it", async () => {
    prefetchPlannerVenue(cityRooms.id);
    render(<Identity venueId={cityRooms.id} />);
    expect(await screen.findByText("City Rooms")).toBeTruthy();
    expect(spacesApi.getVenue).toHaveBeenCalledTimes(1);
  });

  it("reads the venue itself when the early read failed", async () => {
    spacesApi.getVenue.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(cityRooms);
    prefetchPlannerVenue(cityRooms.id);
    render(<Identity venueId={cityRooms.id} />);
    expect(await screen.findByText("City Rooms")).toBeTruthy();
    expect(spacesApi.getVenue).toHaveBeenCalledTimes(2);
  });

  it("does not show an early read of another venue", async () => {
    spacesApi.getVenue.mockImplementation((venueId) => Promise.resolve({ ...cityRooms, id: venueId, name: venueId === "venue-other" ? "Other venue" : cityRooms.name }));
    prefetchPlannerVenue("venue-other");
    render(<Identity venueId={cityRooms.id} />);
    expect(await screen.findByText("City Rooms")).toBeTruthy();
    expect(spacesApi.getVenue.mock.calls).toEqual([["venue-other"], [cityRooms.id]]);
  });

  it("shows the unavailable state when the venue cannot be read", async () => {
    spacesApi.getVenue.mockRejectedValue(new Error("offline"));
    prefetchPlannerVenue(cityRooms.id);
    render(<Identity venueId={cityRooms.id} />);
    expect(await screen.findByText("Venue unavailable")).toBeTruthy();
  });
});
