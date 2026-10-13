import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { SpaceSchema } from "@omnitwin/types";
import { RoomResolveCaption } from "../RoomResolveCaption.js";

// The space's venue is Trades Hall here; reading it is the API's job.
vi.mock("../../../../hooks/use-trades-hall-venue.js", () => ({ useTradesHallVenue: () => true }));
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { useHallViewStore } from "../../../../stores/hall-view-store.js";

function spaceNamed(name: string) {
  return SpaceSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    venueId: "00000000-0000-4000-8000-000000000002",
    name,
    slug: "caption-test-room",
    description: null,
    widthM: "21", lengthM: "10.5", heightM: "6.7",
    floorPlanOutline: [{ x: -10.5, y: -5.25 }, { x: 10.5, y: -5.25 }, { x: 10.5, y: 5.25 }, { x: -10.5, y: 5.25 }],
    meshUrl: null, thumbnailUrl: null, sortOrder: 0,
    createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z",
  });
}

describe("RoomResolveCaption for the drawn Grand Hall", () => {
  beforeEach(() => {
    useEditorStore.setState({ space: spaceNamed("Grand Hall") });
    useCockpitStore.getState().setLayerMode("mesh");
    useHallViewStore.setState({ surfaces: null });
  });
  afterEach(() => {
    cleanup();
    useEditorStore.setState({ space: null });
    useHallViewStore.setState({ surfaces: null });
  });

  it("counts the hall's surfaces in with working motion, then falls quiet", () => {
    const { container } = render(<RoomResolveCaption />);
    act(() => { useHallViewStore.getState().startSurfaces(5); });
    const caption = screen.getByTestId("room-resolve-caption");
    expect(caption.getAttribute("data-visible")).toBe("true");
    expect(caption.textContent).toContain("Loading the Grand Hall's surfaces · 0 of 5");
    expect(container.querySelector("[data-activity-indicator]")).not.toBeNull();
    act(() => { for (let i = 0; i < 5; i++) useHallViewStore.getState().settleSurface(true); });
    expect(caption.getAttribute("data-visible")).toBe("false");
    expect(container.querySelector("[data-activity-indicator]")).toBeNull();
  });

  it("keeps a still note when a surface could not load", () => {
    const { container } = render(<RoomResolveCaption />);
    act(() => {
      const store = useHallViewStore.getState();
      store.startSurfaces(2);
      store.settleSurface(true);
      store.settleSurface(false);
    });
    const caption = screen.getByTestId("room-resolve-caption");
    expect(caption.getAttribute("data-visible")).toBe("true");
    expect(caption.textContent).toContain("could not load");
    expect(container.querySelector("[data-activity-indicator]")).toBeNull();
  });

  it("reports the capture instead while the capture is shown", () => {
    render(<RoomResolveCaption />);
    act(() => {
      useHallViewStore.getState().startSurfaces(5);
      useCockpitStore.getState().setLayerMode("splat");
    });
    const caption = screen.getByTestId("room-resolve-caption");
    expect(caption.textContent).not.toContain("surfaces");
  });
});
