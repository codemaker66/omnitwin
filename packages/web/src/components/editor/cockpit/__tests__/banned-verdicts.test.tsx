import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import type { TradesHallVenueStatus } from "../../../../hooks/use-trades-hall-venue.js";
import type { CatalogueItem } from "../../../../lib/catalogue.js";
import type { PlacedItem } from "../../../../lib/placement.js";

// ---------------------------------------------------------------------------
// Banned verdicts, as rendered (redteam fix-first 2). Every lens that touches
// a structural (rigging), electrical (power, lighting), egress (evidence) or
// occupancy (guests, evidence, the HUD) question is rendered for a visitor, a
// client and the venue's staff, empty and loaded, under and over; none may
// show within, fits, pass, valid or compliant, nor quote another country's
// code. The Flow lens (doors nobody surveyed) and the AV lens (a speaker and a
// room nobody entered) may show no figure at all that only an assumed input
// could produce. The source-text side of this guard is in
// __tests__/public-claim-guard.
// ---------------------------------------------------------------------------

const venue = vi.hoisted(() => ({ status: "trades-hall" as TradesHallVenueStatus }));
vi.mock("../../../../hooks/use-trades-hall-venue.js", () => ({
  useTradesHallVenueStatus: () => venue.status,
  useTradesHallVenue: () => venue.status === "trades-hall",
}));
vi.mock("../../../../api/action-log.js", () => ({
  getActionLog: () => Promise.resolve({ entries: [], nextAfter: 0 }),
}));
vi.mock("../FixtureModelPreview.js", () => ({ FixtureModelPreview: () => null }));
// The Flow lens reads the real engine's output for the scenario on the floor,
// run synchronously here instead of in the browser worker. Its doors are the
// planner's own: placed mid-wall by assumption, because no venue records them.
vi.mock("../../../../hooks/use-cockpit-replay.js", async () => {
  const { runGuestFlowReplayV0 } = await import("@omnitwin/types");
  const { buildGuestFlowReplayInputFromLayout } = await import("../../../../lib/guest-flow-layout-input.js");
  const placement = await import("../../../../stores/placement-store.js");
  const cockpit = await import("../../../../stores/cockpit-store.js");
  return {
    useCockpitReplay: () => {
      const artifact = runGuestFlowReplayV0(buildGuestFlowReplayInputFromLayout({
        roomWidthM: 21,
        roomLengthM: 10.5,
        placedItems: placement.usePlacementStore.getState().placedItems,
        plannedGuestCount: cockpit.useCockpitStore.getState().plannedGuestCount,
      }));
      return { artifact, bounds: artifact.navmesh.roomBounds, status: "ready" as const };
    },
  };
});

const { RiggingLensPanel } = await import("../RiggingLensPanel.js");
const { PowerLensPanel } = await import("../PowerLensPanel.js");
const { LightingLensPanel } = await import("../LightingLensPanel.js");
const { EvidenceLensPanel } = await import("../EvidenceLensPanel.js");
const { GuestsLensPanel } = await import("../GuestsLensPanel.js");
const { CostsLensPanel } = await import("../CostsLensPanel.js");
const { PlannerSpatialHud } = await import("../../PlannerSpatialHud.js");
const { FlowLensPanel } = await import("../FlowLensPanel.js");
const { AVLensPanel } = await import("../AVLensPanel.js");
const { usePlacementStore } = await import("../../../../stores/placement-store.js");
const { useCockpitStore } = await import("../../../../stores/cockpit-store.js");
const { useRoomDimensionsStore } = await import("../../../../stores/room-dimensions-store.js");
const { useLightingRigStore } = await import("../../../../stores/lighting-rig-store.js");
const { CATALOGUE_ITEMS } = await import("../../../../lib/catalogue.js");
const fixtures = await import("./planner-truth-fixtures.js");

const BANNED = /\b(within|fits?|pass(?:es|ed)?|valid|compliant|compliance)\b/i;
const WRONG_CODE = /\b(Approved Document B|ADB|NFPA|BS 9999)\b/;

function find(predicate: (item: CatalogueItem) => boolean, label: string): CatalogueItem {
  const item = CATALOGUE_ITEMS.find(predicate);
  if (item === undefined) throw new Error(`No catalogue item for ${label}`);
  return item;
}

function place(item: CatalogueItem, n: number): PlacedItem[] {
  return Array.from({ length: n }, (_unused, index) => ({
    id: `${item.slug}-${String(index)}`,
    catalogueItemId: item.id,
    x: (index % 20) * 0.7, y: 0, z: Math.floor(index / 20) * 0.7, rotationY: 0,
    clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null,
  }));
}

type Viewer = "visitor" | "client" | "staff";
const VIEWERS: readonly Viewer[] = ["visitor", "client", "staff"];

function viewAs(viewer: Viewer): void {
  if (viewer === "staff") fixtures.viewAsStaff();
  else if (viewer === "client") fixtures.viewAsClient();
  else fixtures.viewAsVisitor();
}

interface Scenario {
  readonly name: string;
  readonly guests: number | null;
  readonly items: () => PlacedItem[];
}

const SCENARIOS: readonly Scenario[] = [
  { name: "an empty floor", guests: null, items: () => [] },
  {
    name: "a dinner under the published figure",
    guests: 120,
    items: () => [...place(find((c) => c.category === "table" && c.tableShape === "round", "round"), 15), ...place(find((c) => c.category === "chair", "chair"), 120)],
  },
  {
    name: "a reception over the published figure",
    guests: 400,
    items: () => place(find((c) => c.slug.startsWith("poseur-table"), "poseur"), 40),
  },
  {
    name: "theatre rows over the published figure",
    guests: 300,
    items: () => place(find((c) => c.category === "chair", "chair"), 300),
  },
];

const SURFACES: ReadonlyArray<{ readonly name: string; readonly render: () => ReactElement; readonly testId: string }> = [
  { name: "Rigging", render: () => <RiggingLensPanel />, testId: "rigging-lens-panel" },
  { name: "Power", render: () => <PowerLensPanel />, testId: "power-lens-panel" },
  { name: "Lighting", render: () => <LightingLensPanel />, testId: "lighting-lens-panel" },
  { name: "Evidence", render: () => <EvidenceLensPanel />, testId: "evidence-lens-panel" },
  { name: "Guests", render: () => <GuestsLensPanel />, testId: "guests-lens-panel" },
  { name: "Costs", render: () => <CostsLensPanel />, testId: "costs-lens-panel" },
  { name: "Layout summary", render: () => <PlannerSpatialHud />, testId: "planner-spatial-hud" },
  { name: "Flow", render: () => <FlowLensPanel />, testId: "flow-lens-panel" },
  { name: "AV", render: () => <AVLensPanel />, testId: "av-lens-panel" },
];

// A verdict or figure that only an assumed input could produce: the Flow
// lens's density, queue, bottleneck and attention figures for doors nobody
// surveyed, and the AV lens's speech verdict for a speaker and room nobody
// entered (integration check, 17 Oct 2026: "1 review · 6 attention", a peak
// density of 97.78, an 11-minute queue, and "Clear speech" from defaults).
const ASSUMED_FIGURE = /\b(bottleneck score|peak density|hotspots?|queues|wait|simulated agents|avg travel|clear speech|marginal|below ambient|spl at listener|speech over ambient|coverage width)\b|\d+\s*(attention|review|info)\b/i;

function assertNoVerdict(testId: string, context: string): void {
  const text = screen.getByTestId(testId).textContent ?? "";
  expect(text, `${context}: ${text}`).not.toMatch(BANNED);
  expect(text, `${context}: ${text}`).not.toMatch(WRONG_CODE);
}

beforeEach(() => {
  venue.status = "trades-hall";
  usePlacementStore.setState({ placedItems: [] });
  useCockpitStore.getState().reset();
  useLightingRigStore.getState().reset();
  useRoomDimensionsStore.getState().setDimensions({ width: 21, length: 10.5, height: 7 });
  fixtures.resetPlannerTruth();
  fixtures.openRoom(fixtures.plannerRoom());
});

afterEach(() => {
  cleanup();
  usePlacementStore.setState({ placedItems: [] });
  useCockpitStore.getState().reset();
  useLightingRigStore.getState().reset();
  fixtures.resetPlannerTruth();
});

describe("no verdict on a safety question, for anyone, in any state", () => {
  for (const surface of SURFACES) {
    for (const viewer of VIEWERS) {
      for (const scenario of SCENARIOS) {
        it(`${surface.name} · ${viewer} · ${scenario.name}`, () => {
          viewAs(viewer);
          usePlacementStore.setState({ placedItems: scenario.items() });
          useCockpitStore.getState().setPlannedGuestCount(scenario.guests);
          render(surface.render());
          assertNoVerdict(surface.testId, `${surface.name} · ${viewer} · ${scenario.name}`);
        });
      }
    }
  }
});

describe("no figure from an input nobody stated (Flow doors, AV defaults)", () => {
  for (const viewer of VIEWERS) {
    for (const scenario of SCENARIOS) {
      it(`Flow · ${viewer} · ${scenario.name}`, () => {
        viewAs(viewer);
        usePlacementStore.setState({ placedItems: scenario.items() });
        useCockpitStore.getState().setPlannedGuestCount(scenario.guests);
        render(<FlowLensPanel />);
        const text = screen.getByTestId("flow-lens-panel").textContent ?? "";
        expect(text, `${viewer} · ${scenario.name}: ${text}`).not.toMatch(ASSUMED_FIGURE);
        expect(screen.getByTestId("flow-doors-unrecorded-status").textContent).toBe("Not recorded");
        // The way forward: a drafted question, or who to ask when there is no address.
        expect(screen.queryByTestId("flow-doors-unrecorded-ask") ?? screen.queryByTestId("flow-doors-unrecorded-next")).not.toBeNull();
      });
    }

    it(`AV · ${viewer} · nothing entered`, () => {
      viewAs(viewer);
      render(<AVLensPanel />);
      const text = screen.getByTestId("av-lens-panel").textContent ?? "";
      expect(text).not.toMatch(ASSUMED_FIGURE);
      expect(screen.getByTestId("av-unrecorded-ambient").textContent).toContain("Not recorded");
    });

    it(`AV · ${viewer} · figures entered, loud and quiet room`, () => {
      viewAs(viewer);
      render(<AVLensPanel />);
      fireEvent.change(screen.getByTestId("av-spl"), { target: { value: "127" } });
      fireEvent.change(screen.getByTestId("av-distance"), { target: { value: "12" } });
      fireEvent.change(screen.getByTestId("av-ambient"), { target: { value: "40" } });
      fireEvent.change(screen.getByTestId("av-target"), { target: { value: "10" } });
      assertNoVerdict("av-lens-panel", `${viewer} quiet`);
      expect(screen.getByTestId("av-lens-panel").textContent).not.toMatch(/\b(clear speech|clear|good|marginal)\b/i);
      fireEvent.change(screen.getByTestId("av-ambient"), { target: { value: "120" } });
      assertNoVerdict("av-lens-panel", `${viewer} loud`);
    });
  }
});

describe("no verdict once the planner types figures in", () => {
  for (const viewer of VIEWERS) {
    it(`Rigging · ${viewer} · a load under and over an entered WLL`, () => {
      viewAs(viewer);
      render(<RiggingLensPanel />);
      fireEvent.change(screen.getByTestId("rig-wll"), { target: { value: "500" } });
      fireEvent.change(screen.getByTestId("rig-permitted"), { target: { value: "power-hoist" } });
      fireEvent.change(screen.getByTestId("rig-load"), { target: { value: "200" } });
      assertNoVerdict("rigging-lens-panel", `${viewer} under`);
      fireEvent.change(screen.getByTestId("rig-load"), { target: { value: "900" } });
      assertNoVerdict("rigging-lens-panel", `${viewer} over`);
    });

    it(`Power · ${viewer} · a rig under and over an entered breaker`, () => {
      viewAs(viewer);
      useLightingRigStore.getState().setCount("par", 40);
      render(<PowerLensPanel />);
      fireEvent.change(screen.getByTestId("power-breaker"), { target: { value: "63" } });
      assertNoVerdict("power-lens-panel", `${viewer} under`);
      fireEvent.change(screen.getByTestId("power-breaker"), { target: { value: "5" } });
      assertNoVerdict("power-lens-panel", `${viewer} over`);
    });
  }
});
