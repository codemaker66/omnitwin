import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TRADES_HALL_ENQUIRY_VENUE_SLUG } from "@omnitwin/types";
import type { Space } from "../../../../api/spaces.js";
import type { PlannerRoomIdentity } from "../../../../lib/planner-layer-composition.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { CanvasLayerControls } from "../CanvasLayerControls.js";

function space(slug: string, venueId = "venue-1", id = `space-${slug}`): Space {
  return {
    id,
    venueId,
    name: slug,
    slug,
    widthM: "10",
    lengthM: "10",
    heightM: "5",
    floorPlanOutline: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
  };
}

function resolveIdentity(
  target: Space,
  venueSlug = TRADES_HALL_ENQUIRY_VENUE_SLUG,
): void {
  const identity: PlannerRoomIdentity = {
    spaceId: target.id,
    venueId: target.venueId,
    roomSlug: target.slug,
    status: "resolved",
    venueSlug,
  };
  useCockpitStore.getState().setPlannerRoomIdentity(identity);
}

beforeEach(() => {
  useCockpitStore.getState().reset();
  useEditorStore.getState().reset();
  const receptionRoom = space("reception-room");
  useEditorStore.setState({ space: receptionRoom });
  resolveIdentity(receptionRoom);
});
afterEach(() => { cleanup(); useEditorStore.getState().reset(); });

describe("CanvasLayerControls", () => {
  it("renders mesh/splat/hybrid with hybrid pressed by default", () => {
    render(<CanvasLayerControls />);
    expect(screen.getByRole("button", { name: /mesh/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /splat/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /hybrid/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("sets the layer mode in the cockpit store on click", () => {
    render(<CanvasLayerControls />);
    fireEvent.click(screen.getByRole("button", { name: /splat/i }));
    expect(useCockpitStore.getState().layerMode).toBe("splat");
    expect(screen.getByRole("button", { name: /splat/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("locks Grand Hall to the captured source without changing the saved mode preference", () => {
    useCockpitStore.getState().setLayerMode("mesh");
    const grandHall = space("grand-hall");
    useEditorStore.setState({ space: grandHall });
    resolveIdentity(grandHall);
    render(<CanvasLayerControls />);

    expect(screen.getByRole("status", { name: "Captured source" })).toBeTruthy();
    expect(screen.getByText("Captured room source only. Alternative architecture layers are unavailable.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /mesh/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /splat/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /hybrid/i })).toBeNull();
    expect(useCockpitStore.getState().layerMode).toBe("mesh");

    const receptionRoom = space("reception-room");
    act(() => {
      useEditorStore.setState({ space: receptionRoom });
      resolveIdentity(receptionRoom);
    });
    const restoredMesh = screen.getByRole("button", { name: /mesh/i });
    expect(restoredMesh.hasAttribute("disabled")).toBe(false);
    expect(restoredMesh.getAttribute("aria-pressed")).toBe("true");
  });

  it("locks controls while room identity is unresolved and restores the saved preference afterward", () => {
    useCockpitStore.getState().setLayerMode("mesh");
    useEditorStore.setState({ space: null });
    render(<CanvasLayerControls />);

    expect(screen.getByRole("status", { name: "Identity resolving" })).toBeTruthy();
    expect(screen.getByText(
      "Room identity is resolving. Architecture remains hidden.",
    )).toBeTruthy();
    expect(screen.queryByRole("button", { name: /mesh/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /splat/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /hybrid/i })).toBeNull();
    expect(useCockpitStore.getState().layerMode).toBe("mesh");

    const receptionRoom = space("reception-room");
    act(() => {
      useEditorStore.setState({ space: receptionRoom });
      resolveIdentity(receptionRoom);
    });
    const restoredMesh = screen.getByRole("button", { name: /mesh/i });
    expect(restoredMesh.hasAttribute("disabled")).toBe(false);
    expect(restoredMesh.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("ignores direct mode changes while displaying the Grand Hall effective layer", () => {
    const grandHall = space("grand-hall");
    useEditorStore.setState({ space: grandHall });
    resolveIdentity(grandHall);
    render(<CanvasLayerControls />);

    act(() => { useCockpitStore.getState().setLayerMode("hybrid"); });
    expect(screen.getByRole("status", { name: "Captured source" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /splat/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /hybrid/i })).toBeNull();
  });

  it("keeps another venue's grand-hall room fully configurable", () => {
    const otherGrandHall = space("grand-hall", "venue-2", "other-grand-hall");
    useEditorStore.setState({ space: otherGrandHall });
    resolveIdentity(otherGrandHall, "another-venue");
    render(<CanvasLayerControls />);

    const mesh = screen.getByRole("button", { name: /mesh/i });
    expect(mesh.hasAttribute("disabled")).toBe(false);
    fireEvent.click(mesh);
    expect(useCockpitStore.getState().layerMode).toBe("mesh");
    expect(mesh.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("fails closed when the stored identity belongs to another room key", () => {
    const grandHall = space("grand-hall");
    useEditorStore.setState({ space: grandHall });
    render(<CanvasLayerControls />);

    expect(screen.queryByRole("button", { name: /mesh/i })).toBeNull();
    expect(screen.getByRole("status", { name: "Identity resolving" })).toBeTruthy();
    expect(screen.getByText(
      "Room identity is resolving. Architecture remains hidden.",
    )).toBeTruthy();
  });

  it("reports a failed identity separately from an in-flight identity", () => {
    const grandHall = space("grand-hall");
    useEditorStore.setState({ space: grandHall });
    useCockpitStore.getState().setPlannerRoomIdentity({
      spaceId: grandHall.id,
      venueId: grandHall.venueId,
      roomSlug: grandHall.slug,
      status: "unavailable",
      venueSlug: null,
    });
    render(<CanvasLayerControls />);

    expect(screen.getByText(
      "Room identity is unavailable. Architecture remains hidden.",
    )).toBeTruthy();
    expect(screen.getByRole("status", { name: "Source unavailable" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /hybrid/i })).toBeNull();
  });
});
