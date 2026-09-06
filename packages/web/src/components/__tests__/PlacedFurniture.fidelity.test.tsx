import { useEffect, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogueItem } from "../../lib/catalogue.js";
import type { PlacedItem } from "../../lib/placement.js";

const scene = vi.hoisted(() => ({
  width: 1672,
  batchMounts: 0,
  batchUnmounts: 0,
  failedVariants: new Set<string>(),
  invalidate: vi.fn(),
}));

// Mount the actual saved-furniture composition and stores. These children own
// GPU resources and have separate rendering/harvest tests; this seam checks
// which models and dressing stay mounted as the planner viewport/input changes.
vi.mock("@react-three/fiber", () => ({
  useThree: () => ({ size: { width: scene.width, height: 800 }, invalidate: scene.invalidate }),
  useFrame: vi.fn(),
}));
vi.mock("@react-three/drei", () => ({ Html: ({ children }: { children?: ReactNode }) => <>{children}</> }));
vi.mock("../editor/InstancedFurnitureLayer.js", () => ({
  InstancedFurnitureLayer: ({ items, onFailedVariantIdsChange }: {
    items: readonly PlacedItem[];
    onFailedVariantIdsChange: (ids: ReadonlySet<string>) => void;
  }) => {
    useEffect(() => {
      scene.batchMounts += 1;
      return () => { scene.batchUnmounts += 1; };
    }, []);
    useEffect(() => { onFailedVariantIdsChange(scene.failedVariants); }, [onFailedVariantIdsChange]);
    return <div data-testid="detailed-batch" data-ids={items.map(({ id }) => id).join(",")} />;
  },
}));
vi.mock("../FurnitureProxy.js", () => ({
  FurnitureProxy: ({ item }: { item: CatalogueItem }) => <div data-testid="individual-model" data-slug={item.slug} />,
}));
vi.mock("../meshes/TableClothMesh.js", () => ({ TableClothMesh: () => <div data-testid="table-linen" /> }));
vi.mock("../meshes/AnimatedTableCloth.js", () => ({ AnimatedTableCloth: () => <div data-testid="animated-linen" /> }));
vi.mock("../meshes/TableSettingMesh.js", () => ({
  TableSettingMesh: ({ settingsCount }: { settingsCount: number }) => <div data-testid="dinner-settings" data-count={settingsCount} />,
}));
vi.mock("../ConstraintViolationSkin.js", () => ({ ConstraintViolationSkin: () => <div data-testid="constraint-warning" /> }));
vi.mock("../editor/TimelinePreviewFurniture.js", () => ({ TimelinePreviewFurniture: () => <div data-testid="timeline-preview" /> }));

const { PlacedFurniture } = await import("../PlacedFurniture.js");
const { ClearanceRings } = await import("../editor/ClearanceRings.js");
const { getCatalogueItemBySlug } = await import("../../lib/catalogue.js");
const { createPlacedItem } = await import("../../lib/placement.js");
const { usePlacementStore } = await import("../../stores/placement-store.js");
const { useSelectionStore } = await import("../../stores/selection-store.js");
const { useCockpitStore } = await import("../../stores/cockpit-store.js");
const { useFurnitureInspectionStore } = await import("../../stores/furniture-inspection-store.js");
const { useLayoutTimelinePreviewStore } = await import("../../stores/layout-timeline-preview-store.js");

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`missing fixture ${slug}`);
  return item.id;
}

function dressedLayout(): readonly PlacedItem[] {
  return Array.from({ length: 18 }, (_, index) => {
    const groupId = `table-group-${String(index)}`;
    const x = (index % 6) * 3 - 7.5;
    const z = Math.floor(index / 6) * 3 - 3;
    return [
      { ...createPlacedItem(catalogueId("round-table-6ft"), x, z, 0, groupId),
        clothed: index === 0, clothStyle: index === 0 ? "white" as const : null,
        tableSetting: index === 0 ? "dinner" as const : null },
      ...Array.from({ length: 8 }, (_, chair) => createPlacedItem(
        catalogueId("banquet-chair"), x + Math.cos(chair * Math.PI / 4),
        z + Math.sin(chair * Math.PI / 4), 0, groupId,
      )),
    ];
  }).flat();
}

beforeEach(() => {
  vi.spyOn(document, "createElement").mockImplementation((name) => {
    const element = document.createElementNS("http://www.w3.org/1999/xhtml", name);
    if (!(element instanceof HTMLElement)) throw new Error(`Unexpected test host ${name}`);
    // Let the historical block instancer mount in this CPU harness so a
    // regression fails on its missing detailed batch, not a DOM-host method.
    if (name.toLowerCase() === "instancedmesh") {
      Object.assign(element, { setMatrixAt: () => undefined, instanceMatrix: { needsUpdate: false } });
    }
    return element;
  });
  scene.width = 1672;
  scene.batchMounts = 0;
  scene.batchUnmounts = 0;
  scene.failedVariants = new Set();
  useCockpitStore.setState({ cameraInteractionActive: false });
  useSelectionStore.getState().clearSelection();
  useFurnitureInspectionStore.getState().closeInspection();
  useLayoutTimelinePreviewStore.setState({ mode: "inactive" });
  usePlacementStore.setState({ placedItems: dressedLayout() });
  // R3F host nodes intentionally reach happy-dom. Only its DOM-only React
  // diagnostics are irrelevant here; unexpected errors still reach the runner.
  // eslint-disable-next-line no-console -- preserve unexpected diagnostics
  const originalError = console.error.bind(console);
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const message = typeof args[0] === "string" ? args[0] : "";
    if (/incorrect casing|is unrecognized in this browser|does not recognize the|non-boolean attribute/.test(message)) return;
    originalError(...args);
  });
});

afterEach(() => { try { cleanup(); } finally { vi.restoreAllMocks(); } });

function expectDetailedLayout(): void {
  const ids = screen.getByTestId("detailed-batch").getAttribute("data-ids")?.split(",");
  expect(ids).toHaveLength(162);
  expect(screen.getAllByTestId("table-linen")).toHaveLength(1);
  expect(screen.getAllByTestId("dinner-settings")).toHaveLength(1);
  expect(screen.getByTestId("dinner-settings").getAttribute("data-count")).toBe("8");
  expect(screen.queryByTestId("animated-linen")).toBeNull();
}

describe("saved furniture fidelity", () => {
  it("keeps the same detailed 18-table/144-chair batch and dressing across width and motion", () => {
    const { rerender, unmount } = render(<PlacedFurniture />);
    expectDetailedLayout();
    for (const width of [1100, 1099, 884, 390, 1672]) {
      scene.width = width;
      rerender(<PlacedFurniture />);
      expectDetailedLayout();
      for (const active of [true, false]) {
        act(() => { useCockpitStore.setState({ cameraInteractionActive: active }); });
        expectDetailedLayout();
      }
    }
    expect(scene.batchMounts).toBe(1);
    expect(scene.batchUnmounts).toBe(0);
    unmount();
    expect(scene.batchUnmounts).toBe(1);
  });

  it("renders detailed furniture and applied dressing on an initially compact canvas", () => {
    scene.width = 884;
    render(<PlacedFurniture />);
    expectDetailedLayout();
    expect(screen.queryByTestId("individual-model")).toBeNull();
  });

  it("retains failed-instancing fallback and exactly one inspected hierarchy while compact and moving", () => {
    scene.width = 884;
    scene.failedVariants = new Set([catalogueId("round-table-6ft")]);
    useCockpitStore.setState({ cameraInteractionActive: true });
    const inspected = usePlacementStore.getState().placedItems[1];
    if (inspected === undefined) throw new Error("missing chair");
    usePlacementStore.setState({ placedItems: usePlacementStore.getState().placedItems.map((item) => (
      item.id === inspected.id ? { ...item, x: 1000 } : item
    )) });
    useSelectionStore.getState().select(inspected.id);
    useFurnitureInspectionStore.getState().openInspection(inspected.id);
    render(<PlacedFurniture />);
    const ids = screen.getByTestId("detailed-batch").getAttribute("data-ids")?.split(",");
    expect(ids).toHaveLength(161);
    expect(ids).not.toContain(inspected.id);
    expect(screen.getAllByTestId("individual-model").map((node) => node.getAttribute("data-slug")))
      .toEqual(["round-table-6ft", "banquet-chair", ...Array<string>(17).fill("round-table-6ft")]);
    expect(screen.getAllByTestId("constraint-warning")).toHaveLength(1);
  });

  it("selects a nine-item table group without repeating a target as measured clearance", () => {
    const group = usePlacementStore.getState().placedItems.slice(0, 9);
    const table = group[0];
    if (table === undefined) throw new Error("missing table");
    const neighbour = createPlacedItem(table.catalogueItemId, table.x + 1.83 + 0.6, table.z);
    usePlacementStore.setState({ placedItems: [...group, neighbour] });
    useSelectionStore.getState().selectMultiple(group.map(({ id }) => id));
    const { container } = render(<><PlacedFurniture /><ClearanceRings /></>);
    expect(container.querySelectorAll(".clearance-ring-label")).toHaveLength(0);
    expect(screen.queryByText("1.2 m clearance")).toBeNull();
    const reasons = screen.getAllByTestId("clearance-ring-reason");
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.textContent).toContain("0.60 m");
    expect(reasons[0]?.textContent).toContain("0.90 m single-file");
    expect(container.querySelectorAll('[name="clearance-rings"] lineLoop')).toHaveLength(1);
  });
});
