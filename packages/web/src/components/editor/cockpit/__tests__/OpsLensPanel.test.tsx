import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Mock only the ops compile call; stores + model stay real.
const mocks = vi.hoisted(() => ({ compileOpsHandoffPack: vi.fn() }));
vi.mock("../../../../api/ops-handoff.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../api/ops-handoff.js")>();
  return { ...actual, compileOpsHandoffPack: mocks.compileOpsHandoffPack };
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
    clothed: false, clothStyle: null, tableSetting: null, groupId: null,
  }));
}

function signInStaff(): void {
  useAuthStore.getState().setUser({ id: "u1", email: "staff@venue.test", role: "staff", platformRole: "none", venueId: "v1", name: "Staff" });
}

beforeEach(() => {
  mocks.compileOpsHandoffPack.mockReset();
  usePlacementStore.setState({ placedItems: [] });
  useEditorStore.setState({ configId: null });
  useAuthStore.getState().logout();
  useLightingRigStore.getState().clear();
});

afterEach(() => { cleanup(); });

describe("OpsLensPanel", () => {
  it("builds the live setup plan from the layout", () => {
    usePlacementStore.setState({ placedItems: [...place(roundTable(), 18), ...place(chair(), 144)] });
    render(<OpsLensPanel />);
    expect(screen.getByTestId("ops-lens-panel")).toBeTruthy();
    expect(screen.getByText("Run of show")).toBeTruthy();
    expect(screen.getByTestId("ops-task-round-tables")).toBeTruthy();
    expect(screen.getByTestId("ops-task-chairs")).toBeTruthy();
    expect(screen.getByText("Suggested crew")).toBeTruthy();
    expect(screen.getByText(/not a guaranteed schedule/i)).toBeTruthy();
  });

  it("shows an empty-state hint with nothing placed", () => {
    render(<OpsLensPanel />);
    expect(screen.getByTestId("ops-empty")).toBeTruthy();
  });

  it("adds a lighting rig task from the Lighting lens rig", () => {
    useLightingRigStore.getState().setCount("par", 12);
    render(<OpsLensPanel />);
    expect(screen.getByTestId("ops-task-lighting").textContent).toMatch(/12 to place/);
  });

  it("blocks compiling until staff sign-in", () => {
    usePlacementStore.setState({ placedItems: place(chair(), 10) });
    render(<OpsLensPanel />);
    expect(screen.getByTestId("ops-precondition").textContent).toMatch(/sign in as venue staff/i);
    expect(screen.queryByTestId("ops-compile")).toBeNull();
  });

  it("asks to save the layout when signed in without a saved configuration", () => {
    signInStaff();
    render(<OpsLensPanel />);
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

    render(<OpsLensPanel />);
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

    render(<OpsLensPanel />);
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

    render(<OpsLensPanel />);
    fireEvent.click(screen.getByTestId("ops-compile"));

    await waitFor(() => {
      expect(screen.getByTestId("ops-error").textContent).toMatch(/separate reviewed guest-flow evidence artifact/i);
    });
  });
});
