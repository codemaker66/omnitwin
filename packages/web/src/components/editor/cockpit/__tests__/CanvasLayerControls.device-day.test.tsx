import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Space } from "../../../../api/spaces.js";

// The modelled Grand Hall is Trades Hall's; the venue read is answered here.
vi.mock("../../../../hooks/use-trades-hall-venue.js", () => ({ useTradesHallVenue: () => true }));

const { useCockpitStore } = await import("../../../../stores/cockpit-store.js");
const { useEditorStore } = await import("../../../../stores/editor-store.js");
const { useAuthStore } = await import("../../../../stores/auth-store.js");
const { CanvasLayerControls, HallViewSheetControls } = await import("../CanvasLayerControls.js");
const { NativeSplatLayer } = await import("../../../scene/NativeSplatLayer.js");

const GRAND_HALL: Space = {
  id: "s-gh", venueId: "v-th", name: "Grand Hall", slug: "grand-hall",
  widthM: "21", lengthM: "10.5", heightM: "7",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
};

function openAt(search: string): void {
  window.history.replaceState(null, "", `/plan/layout-1${search}`);
}

beforeEach(() => {
  vi.stubEnv("DEV", false);
  useCockpitStore.getState().reset();
  useEditorStore.setState({ space: GRAND_HALL });
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

describe("the Grand Hall's Capture choice in production", () => {
  it("is offered for an allowlisted device-day cut, and switches the layer", () => {
    openAt("?splatBundle=l2-1.5m&profiler=1");
    useCockpitStore.setState({ layerMode: "mesh" });
    render(<CanvasLayerControls embedded />);
    const capture = screen.getByTestId("hall-capture-toggle");
    expect(capture.hasAttribute("disabled")).toBe(false);
    fireEvent.click(capture);
    expect(useCockpitStore.getState().layerMode).toBe("splat");
    expect(capture.getAttribute("aria-pressed")).toBe("true");
  });

  it("is offered on a phone's View sheet too", () => {
    openAt("?splatBundle=l2-3m");
    render(<HallViewSheetControls onViewChosen={() => undefined} />);
    expect(screen.getByTestId("hall-capture-toggle").hasAttribute("disabled")).toBe(false);
  });

  it.each(["", "?splatBundle=l2-9m", "?splatUrl=https%3A%2F%2Fexample.com%2Fcapture.sog"])(
    "stays held without an allowlisted cut (%s)",
    (search) => {
      openAt(search);
      render(<CanvasLayerControls embedded />);
      expect(screen.queryByTestId("hall-capture-toggle")).toBeNull();
    },
  );

  it("stays held in another room even with a cut named", () => {
    openAt("?splatBundle=l2-2m");
    useEditorStore.setState({ space: { ...GRAND_HALL, id: "s-rr", name: "Reception Room", slug: "reception-room" } });
    const { container } = render(<CanvasLayerControls embedded />);
    expect(screen.queryByRole("button", { name: "Capture" })).toBeNull();
    expect(container.textContent).not.toMatch(/device-day|splat/iu);
  });
});

describe("the native splat layer's final boundary in production", () => {
  it("still refuses a URL the caller names, and another cut's tile, with a cut in the address", () => {
    openAt("?splatBundle=l2-2m");
    const { container } = render(<NativeSplatLayer url="https://example.com/capture.sog" />);
    expect(container.childElementCount).toBe(0);
    const { container: other } = render(<NativeSplatLayer url="https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev/splats/trades-hall/device-day/l2-3m/l2-3m_0.sog" />);
    expect(other.childElementCount).toBe(0);
  });
});
