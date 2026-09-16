import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mock only the network edges; stores + model stay real.
const mocks = vi.hoisted(() => ({
  compileOpsHandoffPack: vi.fn(),
  linkEventConfiguration: vi.fn(),
  getEventPhaseGraph: vi.fn(),
}));
vi.mock("../../../../api/ops-handoff.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../api/ops-handoff.js")>();
  return { ...actual, compileOpsHandoffPack: mocks.compileOpsHandoffPack };
});
vi.mock("../../../../api/events.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../api/events.js")>();
  return {
    ...actual,
    linkEventConfiguration: mocks.linkEventConfiguration,
    getEventPhaseGraph: mocks.getEventPhaseGraph,
  };
});

import { OpsLensPanel } from "../OpsLensPanel.js";
import { ApiError } from "../../../../api/client.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { useLightingRigStore } from "../../../../stores/lighting-rig-store.js";
import { CATALOGUE_ITEMS, type CatalogueItem } from "../../../../lib/catalogue.js";
import type { PlacedItem } from "../../../../lib/placement.js";

const CONFIG_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const VENUE_ID = "33333333-3333-4333-8333-333333333333";

function renderPanel(search = ""): void {
  render(<MemoryRouter initialEntries={[`/plan/${CONFIG_ID}${search}`]}><OpsLensPanel /></MemoryRouter>);
}

/** Minimal phase graph: the panel reads only the event id and name from it. */
function eventGraph(): unknown {
  return {
    event: {
      id: EVENT_ID, venueId: VENUE_ID, createdBy: null, name: "Baxter wedding",
      eventType: null, status: "draft", startsAt: null, endsAt: null,
      guestCount: null, clientName: null, notes: null,
      createdAt: "2026-09-15T09:00:00.000Z", updatedAt: "2026-09-15T09:00:00.000Z",
    },
    phases: [], scenarios: [], layoutVariants: [], configurationLinks: [], phaseLayoutSnapshots: [],
  };
}

function find(predicate: (item: CatalogueItem) => boolean, label: string): CatalogueItem {
  const item = CATALOGUE_ITEMS.find(predicate);
  if (item === undefined) throw new Error(`No catalogue item for ${label}`);
  return item;
}
const roundTable = (): CatalogueItem => find((c) => c.category === "table" && c.tableShape === "round", "round table");
const chair = (): CatalogueItem => find((c) => c.category === "chair", "chair");

function place(item: CatalogueItem, n: number): PlacedItem[] {
  return Array.from({ length: n }, (_unused, index) => ({
    id: `${item.slug}-${String(index)}`,
    catalogueItemId: item.id,
    x: 0, y: 0, z: 0, rotationY: 0,
    clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null,
  }));
}

function signInStaff(): void {
  useAuthStore.getState().setUser({ id: "u1", email: "staff@venue.test", role: "staff", platformRole: "none", venueId: VENUE_ID, name: "Staff" });
}

beforeEach(() => {
  mocks.compileOpsHandoffPack.mockReset();
  mocks.linkEventConfiguration.mockReset();
  mocks.linkEventConfiguration.mockResolvedValue({});
  mocks.getEventPhaseGraph.mockReset();
  mocks.getEventPhaseGraph.mockResolvedValue(eventGraph());
  usePlacementStore.setState({ placedItems: [] });
  useEditorStore.setState({ configId: null, venueId: VENUE_ID });
  useAuthStore.getState().logout();
  useLightingRigStore.getState().clear();
});

afterEach(() => { cleanup(); });

describe("OpsLensPanel", () => {
  it("builds the live setup plan from the layout", () => {
    usePlacementStore.setState({ placedItems: [...place(roundTable(), 18), ...place(chair(), 144)] });
    renderPanel();
    expect(screen.getByTestId("ops-lens-panel")).toBeTruthy();
    expect(screen.getByText("Run of show")).toBeTruthy();
    expect(screen.getByTestId("ops-task-round-tables")).toBeTruthy();
    expect(screen.getByTestId("ops-task-chairs")).toBeTruthy();
    expect(screen.getByText("Suggested crew")).toBeTruthy();
    expect(screen.getByText(/not a guaranteed schedule/i)).toBeTruthy();
  });

  it("shows an empty-state hint with nothing placed", () => {
    renderPanel();
    expect(screen.getByTestId("ops-empty")).toBeTruthy();
  });

  it("adds a lighting rig task from the Lighting lens rig", () => {
    useLightingRigStore.getState().setCount("par", 12);
    renderPanel();
    expect(screen.getByTestId("ops-task-lighting").textContent).toMatch(/12 to place/);
  });

  it("blocks compiling until staff sign-in", () => {
    usePlacementStore.setState({ placedItems: place(chair(), 10) });
    renderPanel();
    expect(screen.getByTestId("ops-precondition").textContent).toMatch(/sign in as venue staff/i);
    expect(screen.queryByTestId("ops-compile")).toBeNull();
  });

  it("asks to save the layout when signed in without a saved configuration", () => {
    signInStaff();
    renderPanel();
    expect(screen.getByTestId("ops-precondition").textContent).toMatch(/save this layout/i);
    expect(screen.queryByTestId("ops-compile")).toBeNull();
  });

  it("compiles the handoff pack and links to it", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID });
    usePlacementStore.setState({ placedItems: place(chair(), 20) });
    mocks.compileOpsHandoffPack.mockResolvedValue({
      pack: { id: "pk1", summary: "Setup plan compiled for the Grand Hall.", status: "draft" },
      opsTasks: [{}, {}, {}],
      loadInSequence: [{}, {}],
    });

    renderPanel();
    fireEvent.click(screen.getByTestId("ops-compile"));

    await waitFor(() => { expect(screen.getByTestId("ops-pack-result")).toBeTruthy(); });
    expect(mocks.compileOpsHandoffPack).toHaveBeenCalledWith({ configId: CONFIG_ID });
    expect(screen.getByTestId("ops-pack-open").getAttribute("href")).toBe("/ops/handoff/pk1");
    expect(screen.getByTestId("ops-pack-result").textContent).toMatch(/3 tasks · 2 load-in steps/);
  });

  it("shows a friendly error when compiling fails", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID });
    mocks.compileOpsHandoffPack.mockRejectedValue(new Error("network"));

    renderPanel();
    fireEvent.click(screen.getByTestId("ops-compile"));

    await waitFor(() => { expect(screen.getByTestId("ops-error")).toBeTruthy(); });
    expect(screen.queryByTestId("ops-pack-result")).toBeNull();
  });

  it("shows an actionable server review gate instead of a generic connection error", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID });
    mocks.compileOpsHandoffPack.mockRejectedValue(new ApiError(
      409,
      "Ops compilation remains blocked until a separate reviewed guest-flow evidence artifact is attached",
      "BLOCKING_REVIEW_GATE",
    ));

    renderPanel();
    fireEvent.click(screen.getByTestId("ops-compile"));

    await waitFor(() => {
      expect(screen.getByTestId("ops-error").textContent).toMatch(/separate reviewed guest-flow evidence artifact/i);
    });
  });

  it("binds the corridor's event to the saved layout and compiles the pack against it", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID, venueId: VENUE_ID });
    usePlacementStore.setState({ placedItems: place(chair(), 20) });
    mocks.compileOpsHandoffPack.mockResolvedValue({
      pack: { id: "pk2", summary: "Setup plan compiled for the Grand Hall.", status: "compiled" },
      opsTasks: [{}],
      loadInSequence: [{}],
    });

    renderPanel(`?eventId=${EVENT_ID}`);

    // The corridor records the link on open, before anyone presses compile.
    await waitFor(() => {
      expect(mocks.linkEventConfiguration).toHaveBeenCalledWith(EVENT_ID, {
        configurationId: CONFIG_ID,
        linkType: "source_configuration",
      });
    });
    expect((await screen.findByTestId("ops-event-binding")).textContent)
      .toMatch(/Baxter wedding/);

    fireEvent.click(screen.getByTestId("ops-compile"));
    await waitFor(() => { expect(screen.getByTestId("ops-pack-result")).toBeTruthy(); });
    expect(mocks.compileOpsHandoffPack).toHaveBeenCalledWith({ configId: CONFIG_ID, eventId: EVENT_ID });
    // One corridor, one link request, however many renders happened.
    expect(mocks.linkEventConfiguration).toHaveBeenCalledTimes(1);
  });

  it("compiles without an event when the planner was not opened from an event link", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID, venueId: VENUE_ID });
    mocks.compileOpsHandoffPack.mockResolvedValue({
      pack: { id: "pk3", summary: "Setup plan compiled.", status: "compiled" },
      opsTasks: [], loadInSequence: [],
    });

    renderPanel();
    fireEvent.click(screen.getByTestId("ops-compile"));

    await waitFor(() => { expect(screen.getByTestId("ops-pack-result")).toBeTruthy(); });
    expect(mocks.compileOpsHandoffPack).toHaveBeenCalledWith({ configId: CONFIG_ID });
    expect(mocks.linkEventConfiguration).not.toHaveBeenCalled();
    expect(screen.queryByTestId("ops-event-binding")).toBeNull();
  });

  it("still compiles and reports the server reason when the binding request is refused", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID, venueId: VENUE_ID });
    mocks.linkEventConfiguration.mockRejectedValue(new ApiError(403, "Insufficient permissions", "FORBIDDEN"));
    mocks.compileOpsHandoffPack.mockRejectedValue(new ApiError(
      409,
      "Bind this approved configuration to the event before compiling its Ops handoff",
      "EVENT_CONFIGURATION_BINDING_REQUIRED",
    ));

    renderPanel(`?eventId=${EVENT_ID}`);
    await waitFor(() => { expect(mocks.linkEventConfiguration).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId("ops-compile"));

    await waitFor(() => {
      expect(screen.getByTestId("ops-error").textContent).toMatch(/Bind this approved configuration to the event/i);
    });
    expect(mocks.compileOpsHandoffPack).toHaveBeenCalledWith({ configId: CONFIG_ID, eventId: EVENT_ID });
  });
});
