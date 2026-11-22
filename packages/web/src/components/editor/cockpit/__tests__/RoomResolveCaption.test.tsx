import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { SpaceSchema } from "@omnitwin/types";
import { RoomResolveCaption } from "../RoomResolveCaption.js";

// The space's venue is Trades Hall here; reading it is the API's job.
vi.mock("../../../../hooks/use-trades-hall-venue.js", () => ({ useTradesHallVenue: () => true }));
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { useHallViewStore } from "../../../../stores/hall-view-store.js";
import { useSurveyedRoomStore } from "../../../../stores/surveyed-room-store.js";

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

describe("RoomResolveCaption for another room drawn as surveyed", () => {
  const loading = { roomName: "Saloon", phase: "loading" as const, files: { settled: 1, expected: 3 }, failure: null };
  const drawn = { roomName: "Saloon", phase: "ready" as const, files: { settled: 0, expected: null }, failure: null };
  const failed = { roomName: "Saloon", phase: "failed" as const, files: { settled: 0, expected: null }, failure: "survey.json (http): HTTP 404" };

  beforeEach(() => {
    useEditorStore.setState({ space: spaceNamed("Saloon") });
    useCockpitStore.getState().setLayerMode("mesh");
    useSurveyedRoomStore.getState().publish(null);
  });
  afterEach(() => {
    cleanup();
    useEditorStore.setState({ space: null });
    useSurveyedRoomStore.getState().publish(null);
  });

  it("counts the survey's files, then its photographs, in with working motion, then falls quiet", () => {
    const { container } = render(<RoomResolveCaption />);
    const caption = screen.getByTestId("room-resolve-caption");
    expect(caption.getAttribute("data-visible")).toBe("false");
    act(() => { useSurveyedRoomStore.getState().publish(loading); });
    expect(caption.getAttribute("data-visible")).toBe("true");
    expect(caption.textContent).toContain("Loading the Saloon as surveyed · 1 of 3 files");
    expect(container.querySelector("[data-activity-indicator]")).not.toBeNull();
    // Drawn, its model yet to say what it loads: nothing is claimed to be loading.
    act(() => { useSurveyedRoomStore.getState().publish(drawn); });
    expect(caption.getAttribute("data-visible")).toBe("false");
    expect(container.querySelector("[data-activity-indicator]")).toBeNull();
    act(() => { useSurveyedRoomStore.getState().reportPhotos({ expected: 3, settled: 1, failed: 0 }); });
    expect(caption.textContent).toContain("Loading the Saloon's photographs · 1 of 3");
    expect(container.querySelector("[data-activity-indicator]")).not.toBeNull();
    act(() => { useSurveyedRoomStore.getState().reportPhotos({ expected: 3, settled: 3, failed: 0 }); });
    expect(caption.getAttribute("data-visible")).toBe("false");
    expect(container.querySelector("[data-activity-indicator]")).toBeNull();
  });

  it("keeps a still note when the survey, or a photograph, could not load", () => {
    const { container } = render(<RoomResolveCaption />);
    act(() => { useSurveyedRoomStore.getState().publish(failed); });
    const caption = screen.getByTestId("room-resolve-caption");
    expect(caption.getAttribute("data-visible")).toBe("true");
    expect(caption.textContent).toContain("The surveyed Saloon could not load, so the room is drawn plainly.");
    expect(container.querySelector("[data-activity-indicator]")).toBeNull();
    act(() => {
      useSurveyedRoomStore.getState().publish(drawn);
      useSurveyedRoomStore.getState().reportPhotos({ expected: 3, settled: 3, failed: 1 });
    });
    expect(caption.textContent).toContain("Some of the Saloon's photographs could not load");
    expect(container.querySelector("[data-activity-indicator]")).toBeNull();
  });

  it("leaves the capture's own word alone while the capture alone is shown", () => {
    render(<RoomResolveCaption />);
    act(() => {
      useSurveyedRoomStore.getState().publish(failed);
      useCockpitStore.getState().setLayerMode("splat");
    });
    expect(screen.getByTestId("room-resolve-caption").textContent).not.toContain("surveyed");
  });
});
