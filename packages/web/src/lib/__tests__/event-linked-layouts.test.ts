import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventPhaseGraphSchema } from "@omnitwin/types";
import { getConfig, getConfigSummaries, type Configuration } from "../../api/configurations.js";
import { getEventPhaseGraph } from "../../api/events.js";
import { getVenue, type VenueDetail } from "../../api/spaces.js";
import { ApiError } from "../../api/client.js";
import { resolveEventLinkedLayouts } from "../event-linked-layouts.js";

// ---------------------------------------------------------------------------
// Staff path of the event-linked layout choice: the event's layout references
// resolve through ONE summary read (not a whole layout per reference), with
// missing/forbidden layouts counted unavailable and room/venue checks intact.
// ---------------------------------------------------------------------------

vi.mock("../../api/configurations.js", () => ({ getConfig: vi.fn(), getConfigSummaries: vi.fn() }));
vi.mock("../../api/events.js", () => ({ getEventPhaseGraph: vi.fn() }));
vi.mock("../../api/spaces.js", () => ({ getVenue: vi.fn() }));
vi.mock("../../api/client-event-schedule.js", () => ({ getClientEventSchedule: vi.fn() }));

const VENUE = "00000000-0000-4000-8000-000000000001";
const OTHER_VENUE = "00000000-0000-4000-8000-000000000002";
const EVENT = "00000000-0000-4000-8000-000000000003";
const NORTH = "00000000-0000-4000-8000-000000000004";
const SOUTH = "00000000-0000-4000-8000-000000000005";
const NOW = "2026-09-24T12:00:00.000Z";
const configId = (n: number): string => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

const venue: VenueDetail = {
  id: VENUE, name: "Test venue", slug: "test-venue", address: "Test address", logoUrl: null, brandColour: null,
  spaces: [
    { id: NORTH, venueId: VENUE, name: "North Gallery", slug: "north-gallery", widthM: "8", lengthM: "4", heightM: "3", floorPlanOutline: [] },
    { id: SOUTH, venueId: VENUE, name: "South Gallery", slug: "south-gallery", widthM: "8", lengthM: "4", heightM: "3", floorPlanOutline: [] },
  ],
};

function graphLinking(count: number) {
  return EventPhaseGraphSchema.parse({
    event: { id: EVENT, venueId: VENUE, createdBy: null, name: "Gallery event", eventType: "reception", status: "in_planning",
      startsAt: NOW, endsAt: null, guestCount: 0, clientName: null, notes: null, createdAt: NOW, updatedAt: NOW },
    phases: [], scenarios: [], layoutVariants: [], phaseLayoutSnapshots: [],
    configurationLinks: Array.from({ length: count }, (_, index) => ({
      id: `00000000-0000-4000-8000-0000000002${String(index).padStart(2, "0")}`, eventId: EVENT,
      configurationId: configId(index), layoutVariantId: null, linkType: "source_configuration", createdAt: NOW,
    })),
  });
}

function resolve(spaceSlug: string | null = null) {
  return resolveEventLinkedLayouts({ eventId: EVENT, venueSlug: "test-venue", spaceSlug, isCurrent: () => true });
}

beforeEach(() => {
  vi.mocked(getVenue).mockResolvedValue(venue);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveEventLinkedLayouts (staff path)", () => {
  it("reads every linked layout's summary in one request and keeps reference order", async () => {
    vi.mocked(getEventPhaseGraph).mockResolvedValue(graphLinking(5));
    vi.mocked(getConfigSummaries).mockResolvedValue([
      { id: configId(3), name: "South dinner", spaceId: SOUTH, venueId: VENUE },
      { id: configId(0), name: "North lunch", spaceId: NORTH, venueId: VENUE },
      { id: configId(2), name: "Elsewhere", spaceId: NORTH, venueId: OTHER_VENUE },
    ]);
    const result = await resolve();
    expect(getConfigSummaries).toHaveBeenCalledTimes(1);
    expect(getConfigSummaries).toHaveBeenCalledWith([0, 1, 2, 3, 4].map(configId));
    expect(result.layouts).toEqual([
      { configurationId: configId(0), name: "North lunch", spaceName: "North Gallery" },
      { configurationId: configId(3), name: "South dinner", spaceName: "South Gallery" },
    ]);
    // Missing or forbidden layouts are absent from the summaries.
    expect(result.unavailableCount).toBe(2);
  });

  it("keeps the requested room filter", async () => {
    vi.mocked(getEventPhaseGraph).mockResolvedValue(graphLinking(2));
    vi.mocked(getConfigSummaries).mockResolvedValue([
      { id: configId(0), name: "North lunch", spaceId: NORTH, venueId: VENUE },
      { id: configId(1), name: "South dinner", spaceId: SOUTH, venueId: VENUE },
    ]);
    const result = await resolve("south-gallery");
    expect(result.roomName).toBe("South Gallery");
    expect(result.layouts.map((layout) => layout.name)).toEqual(["South dinner"]);
  });

  it("splits more than 100 references into bounded requests", async () => {
    const graph = graphLinking(0);
    const links = Array.from({ length: 101 }, (_, index) => ({
      id: `00000000-0000-4000-8000-00000000${String(3000 + index)}`, eventId: EVENT,
      configurationId: `00000000-0000-4000-8000-00000000${String(5000 + index)}`, layoutVariantId: null,
      linkType: "source_configuration" as const, createdAt: NOW,
    }));
    vi.mocked(getEventPhaseGraph).mockResolvedValue({ ...graph, configurationLinks: links });
    vi.mocked(getConfigSummaries).mockResolvedValue([]);
    const result = await resolve();
    expect(vi.mocked(getConfigSummaries).mock.calls.map(([ids]) => ids.length)).toEqual([100, 1]);
    expect(result.unavailableCount).toBe(101);
  });

  it("falls back to whole-layout reads while the API predates the summary endpoint", async () => {
    vi.mocked(getEventPhaseGraph).mockResolvedValue(graphLinking(3));
    // An older API reads "summaries" as a layout id and rejects it.
    vi.mocked(getConfigSummaries).mockRejectedValue(new ApiError(400, "Invalid configuration id", "VALIDATION_ERROR"));
    const layout = (n: number, name: string, spaceId: string): Configuration => ({
      id: configId(n), spaceId, venueId: VENUE, userId: null, name, isPublicPreview: false, revision: 1,
    });
    vi.mocked(getConfig).mockImplementation((id) => {
      if (id === configId(0)) return Promise.resolve(layout(0, "North lunch", NORTH));
      if (id === configId(1)) return Promise.reject(new ApiError(403, "Forbidden", "FORBIDDEN"));
      return Promise.resolve(layout(2, "South dinner", SOUTH));
    });
    const result = await resolve();
    expect(vi.mocked(getConfig).mock.calls.map(([id]) => id)).toEqual([0, 1, 2].map(configId));
    expect(result.layouts).toEqual([
      { configurationId: configId(0), name: "North lunch", spaceName: "North Gallery" },
      { configurationId: configId(2), name: "South dinner", spaceName: "South Gallery" },
    ]);
    expect(result.unavailableCount).toBe(1);
  });

  it("still reports an incomplete choice when a fallback read fails", async () => {
    vi.mocked(getEventPhaseGraph).mockResolvedValue(graphLinking(2));
    vi.mocked(getConfigSummaries).mockRejectedValue(new ApiError(400, "Invalid configuration id", "VALIDATION_ERROR"));
    vi.mocked(getConfig).mockRejectedValue(new ApiError(503, "Unavailable", "DB_UNREACHABLE"));
    await expect(resolve()).rejects.toThrow("Some linked layouts could not be checked. Retry to load the complete choice.");
  });

  it("reports an incomplete choice when the summary read fails", async () => {
    vi.mocked(getEventPhaseGraph).mockResolvedValue(graphLinking(2));
    vi.mocked(getConfigSummaries).mockRejectedValue(new ApiError(503, "Unavailable", "DB_UNREACHABLE"));
    await expect(resolve()).rejects.toThrow("Some linked layouts could not be checked. Retry to load the complete choice.");
  });
});
