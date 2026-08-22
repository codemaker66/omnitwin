import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TRADES_HALL_ENQUIRY_VENUE_SLUG } from "@omnitwin/types";
import type { PlannerLayerPolicy } from "../../../../lib/planner-layer-composition.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../../stores/editor-store.js";

// The cockpit hosts the full editor (App) in its stage; mock it to a stand-in
// so the test stays a structural shell test (no WebGL). The top bar reads
// router + store context of its own, so mock it too for this shell test.
vi.mock("../../../../App.js", () => ({ App: () => <div data-testid="mock-editor-3d" /> }));
vi.mock("../CockpitTopBar.js", () => ({
  CockpitTopBar: ({ layerPolicy }: { readonly layerPolicy: PlannerLayerPolicy }) => (
    <header data-testid="cockpit-topbar-mock" data-policy-kind={layerPolicy.kind} />
  ),
}));
vi.mock("../CockpitRightDock.js", () => ({
  CockpitRightDock: ({ layerPolicy }: { readonly layerPolicy: PlannerLayerPolicy }) => (
    <aside data-testid="cockpit-dock-mock" data-policy-kind={layerPolicy.kind} />
  ),
}));
vi.mock("../CockpitBottom.js", () => ({
  CockpitBottom: ({ layerPolicy }: { readonly layerPolicy: PlannerLayerPolicy }) => (
    <footer data-testid="cockpit-bottom-mock" data-policy-kind={layerPolicy.kind} />
  ),
}));

const { PlannerCockpit } = await import("../PlannerCockpit.js");

const RECEPTION_ROOM = {
  id: "reception-space",
  venueId: "trades-hall-venue",
  name: "Reception Room",
  slug: "reception-room",
  widthM: "10",
  lengthM: "8",
  heightM: "5",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }],
};

function resolveRoom(room: typeof RECEPTION_ROOM, venueSlug = TRADES_HALL_ENQUIRY_VENUE_SLUG): void {
  useEditorStore.setState({ space: room });
  useCockpitStore.getState().setPlannerRoomIdentity({
    spaceId: room.id,
    venueId: room.venueId,
    roomSlug: room.slug,
    status: "resolved",
    venueSlug,
  });
}

beforeEach(() => {
  useCockpitStore.getState().reset();
  useEditorStore.getState().reset();
  resolveRoom(RECEPTION_ROOM);
});
afterEach(() => {
  cleanup();
  useCockpitStore.getState().reset();
  useEditorStore.getState().reset();
});

describe("PlannerCockpit", () => {
  it("renders the grid regions, the live editor, and the nav rail", () => {
    render(<PlannerCockpit />);
    expect(screen.getByTestId("cockpit-shell")).toBeTruthy();
    expect(screen.getByTestId("mock-editor-3d")).toBeTruthy();
    expect(screen.getByTestId("cockpit-rail")).toBeTruthy();
  });

  it("hosts the editor inside the stage region", () => {
    const { container } = render(<PlannerCockpit />);
    const stage = container.querySelector(".cockpit-stage");
    expect(stage).not.toBeNull();
    expect(stage?.querySelector('[data-testid="mock-editor-3d"]')).not.toBeNull();
  });

  it("marks the stage with the active lens (Design by default) so CSS shows tools only in Design", () => {
    const { container } = render(<PlannerCockpit />);
    expect(container.querySelector(".cockpit-stage")?.getAttribute("data-cockpit-mode")).toBe("design");
    fireEvent.click(screen.getByRole("button", { name: /flow/i }));
    expect(container.querySelector(".cockpit-stage")?.getAttribute("data-cockpit-mode")).toBe("flow");
  });

  // CARD A2: the stage exposes the resolve phase as an honesty attribute and
  // hosts the quiet caption while the captured room develops. No spinner.
  it("exposes the resolve phase on the stage and shows the quiet caption while developing", () => {
    useCockpitStore.getState().setRoomResolve({ phase: "developing", loadedChunks: 2, totalChunks: 7 });
    const { container } = render(<PlannerCockpit />);

    expect(container.querySelector(".cockpit-stage")?.getAttribute("data-resolve-phase")).toBe("developing");
    const caption = screen.getByTestId("room-resolve-caption");
    expect(caption.getAttribute("data-visible")).toBe("true");
    expect(caption.textContent).toContain("Loading captured room");
    expect(caption.textContent).toContain("2 of 7 chunks");
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("keeps the caption hidden outside the developing phase", () => {
    useCockpitStore.getState().setRoomResolve({ phase: "fallback", loadedChunks: 0, totalChunks: 0 });
    const { container } = render(<PlannerCockpit />);

    expect(container.querySelector(".cockpit-stage")?.getAttribute("data-resolve-phase")).toBe("fallback");
    expect(screen.getByTestId("room-resolve-caption").getAttribute("data-visible")).toBe("false");
  });

  it("suppresses plan geometry and routes every cockpit region to captured-only policy for Grand Hall", () => {
    resolveRoom({ ...RECEPTION_ROOM, id: "grand-hall-space", name: "Grand Hall", slug: "grand-hall" });
    render(<PlannerCockpit />);

    expect(screen.queryByText("Plan view")).toBeNull();
    expect(screen.queryByRole("button", { name: /flow/i })).toBeNull();
    expect(screen.getByTestId("captured-source-rail-status").textContent).toContain("Source");
    expect(screen.getByTestId("cockpit-topbar-mock").getAttribute("data-policy-kind")).toBe("captured-only");
    expect(screen.getByTestId("cockpit-dock-mock").getAttribute("data-policy-kind")).toBe("captured-only");
    expect(screen.getByTestId("cockpit-bottom-mock").getAttribute("data-policy-kind")).toBe("captured-only");
  });

  it("retains minimap and operational lenses for a verified configurable room", () => {
    render(<PlannerCockpit />);
    expect(screen.getByText("Plan view")).toBeTruthy();
    expect(screen.getByRole("button", { name: /flow/i })).toBeTruthy();
    expect(screen.getByTestId("cockpit-dock-mock").getAttribute("data-policy-kind")).toBe("configurable");
  });
});
