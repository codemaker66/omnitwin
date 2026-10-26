import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SceneOutliner } from "../SceneOutliner.js";
import { SelectedFurnitureInspector } from "../SelectedFurnitureInspector.js";
import { ReferenceRoomHeader } from "../ReferenceRoomHeader.js";
import { CanvasLayerControls } from "../CanvasLayerControls.js";
import { ToolPill } from "../ToolPill.js";
import { PlannerCommandDeck } from "../../PlannerCommandDeck.js";
import { ObjectNotePanel } from "../../ObjectNotePanel.js";
import { placedItemToEditor } from "../../EditorBridge.js";
import { measurementName } from "../../../MeasurementTool.js";
import { getCatalogueItemBySlug } from "../../../../lib/catalogue.js";
import { createTableGroup } from "../../../../lib/table-group.js";
import type { PlacedItem } from "../../../../lib/placement.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useSelectionStore } from "../../../../stores/selection-store.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { useLayoutTimelinePreviewStore } from "../../../../stores/layout-timeline-preview-store.js";

vi.mock("../../../../api/spaces.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../api/spaces.js")>(),
  getVenue: vi.fn(() => new Promise(() => undefined)),
}));

// ---------------------------------------------------------------------------
// The v1 cockpit's copy guard (QoL F-15, spec §13 rule 4): what a guest can
// read or hear on the surfaces this lane owns carries none of the retired or
// engineering words, and no count reads "1 tables". It reads the text, and
// every accessible name, tooltip and placeholder, in production (no capture).
// ---------------------------------------------------------------------------

const BANNED = /auto-fill|laser|layers|objects|showcase|splat|annotations/iu;
const BAD_PLURALS = /\b1 (?:tables|groups|chairs|seats|pieces)\b/u;

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return item.id;
}

function words(root: HTMLElement): string {
  const attributes = [...root.querySelectorAll("*")].flatMap((node) =>
    ["aria-label", "title", "placeholder", "alt", "aria-description"].map((name) => node.getAttribute(name) ?? ""));
  return [root.textContent ?? "", ...attributes].join("\n");
}

function Cockpit(): React.ReactElement {
  return (
    <MemoryRouter>
      <ReferenceRoomHeader />
      <SceneOutliner />
      <PlannerCommandDeck compact />
      <ToolPill />
      <CanvasLayerControls embedded />
      <SelectedFurnitureInspector />
      <ObjectNotePanel />
    </MemoryRouter>
  );
}

function place(items: readonly PlacedItem[]): void {
  usePlacementStore.setState({ placedItems: items, snapEnabled: false });
  useEditorStore.setState({ objects: items.map((item) => placedItemToEditor(item, undefined)) });
}

beforeEach(() => {
  vi.stubEnv("DEV", false);
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
  useEditorStore.getState().reset();
  useEditorStore.setState({
    configId: "00000000-0000-4000-8000-000000000001",
    space: { id: "space-saloon", venueId: "venue-1", name: "Saloon", slug: "saloon", widthM: "12", lengthM: "8", heightM: "5", floorPlanOutline: [] },
  });
  useCockpitStore.getState().reset();
  useLayoutTimelinePreviewStore.getState().clear();
  useSelectionStore.getState().clearSelection();
  usePlacementStore.setState({ placedItems: [], snapEnabled: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  useSelectionStore.getState().clearSelection();
  useEditorStore.getState().reset();
  usePlacementStore.setState({ placedItems: [] });
});

describe("v1 cockpit copy, as a guest", () => {
  it("an empty floor carries no retired or engineering word", () => {
    const { container } = render(<Cockpit />);
    const text = words(container);
    expect(text).not.toMatch(BANNED);
    expect(text).not.toMatch(BAD_PLURALS);
    // Every surface rendered, and its names and placeholders were read.
    for (const expected of [/Lay out tables and seats for your guests/u, /Draw on the floor/u, /Present/u, /Find a table or piece/u, /On the floor/u, /Measure/u, /Layout saved/u]) {
      expect(text).toMatch(expected);
    }
    expect(text).toMatch(/Nothing on the floor yet\. Add a table, or lay out for your guests\./u);
  });

  it("one round with its ten chairs, at rest and selected, carries none either", () => {
    const round = createTableGroup(catalogueId("round-table-6ft"), 0, 0, 0, 10);
    place(round);
    const { container } = render(<Cockpit />);
    expect(words(container)).not.toMatch(BANNED);
    expect(words(container)).not.toMatch(BAD_PLURALS);
    expect(container.textContent).toMatch(/1 table · 10 chairs/u);
    expect(container.textContent).not.toMatch(/group/iu);
    act(() => { useSelectionStore.getState().selectMultiple(round.map((item) => item.id)); });
    const selected = words(container);
    expect(selected).not.toMatch(BANNED);
    expect(selected).not.toMatch(BAD_PLURALS);
    expect(selected).toMatch(/Note for the hallkeeper/u);
    expect(selected).not.toMatch(/planner note|scale/iu);
  });
});

describe("the measurement's warning (spec 4.7 F-52)", () => {
  it("names the shortfall in words, not a glyph", () => {
    expect(measurementName(0.9, true)).toBe("0.90m · narrower than the 1.05 m an exit route needs");
    expect(measurementName(1.2, false)).toBe("1.20m");
    expect(measurementName(0.9, true)).not.toMatch(/⚠/u);
  });
});
