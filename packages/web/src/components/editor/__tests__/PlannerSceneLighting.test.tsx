import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceSchema } from "@omnitwin/types";

const sceneState = vi.hoisted(() => ({ width: 1440, hasAsset: true }));

// Mount the real room and lighting components selected by PlannerScene. Other
// Canvas children need a WebGL renderer; filtering them keeps this a CPU-only
// integration test of ownership, including the actual room-owned light defaults.
function roomChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return null;
    if (child.type === Fragment) return roomChildren(child.props.children);
    if (typeof child.type !== "function") return null;
    return ["RoomMesh", "GrandHallRoom", "RoomLighting"].includes(child.type.name)
      ? child
      : null;
  });
}

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children?: ReactNode }) => <div>{roomChildren(children)}</div>,
  useThree: () => ({ size: { width: sceneState.width, height: 900 } }),
  useFrame: vi.fn(),
}));
vi.mock("../../BrickWall.js", () => ({ BrickWall: () => null }));
vi.mock("../../GrandHallOrnaments.js", () => ({ GrandHallOrnaments: () => null }));
vi.mock("../../GrandHallDome.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../GrandHallDome.js")>(),
  GrandHallDome: () => null,
}));
vi.mock("../CockpitSplatLayer.js", () => ({ CockpitSplatLayer: () => null }));
vi.mock("../../../hooks/use-room-runtime-splat.js", () => ({
  useRoomRuntimeSplat: () => ({
    splatUrls: sceneState.hasAsset ? ["/lighting-regression.sog"] : [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, note: "identity" },
    hasAsset: sceneState.hasAsset,
    status: sceneState.hasAsset ? "loaded" : "none",
  }),
}));

const { PlannerScene } = await import("../PlannerScene.js");
const { RoomMesh } = await import("../RoomMesh.js");
const { GrandHallRoom } = await import("../../GrandHallRoom.js");
const { useCockpitStore } = await import("../../../stores/cockpit-store.js");
const { useEditorStore } = await import("../../../stores/editor-store.js");
const { useDeviceStore } = await import("../../../stores/device-store.js");
const { resolveRoomGeometry } = await import("../../../data/room-geometries.js");

function spaceNamed(name: string) {
  return SpaceSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    venueId: "00000000-0000-4000-8000-000000000002",
    name,
    slug: "lighting-test-room",
    description: null,
    widthM: "12", lengthM: "8", heightM: "4",
    floorPlanOutline: [{ x: -6, y: -4 }, { x: 6, y: -4 }, { x: 6, y: 4 }, { x: -6, y: 4 }],
    meshUrl: null, thumbnailUrl: null, sortOrder: 0,
    createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z",
  });
}

function lightSignature(container: HTMLElement) {
  return Array.from(container.querySelectorAll("hemisphereLight, ambientLight, directionalLight"))
    .map((light) => ({
      type: light.tagName.toLowerCase(),
      args: light.getAttribute("args"),
      intensity: light.getAttribute("intensity"),
      color: light.getAttribute("color"),
      position: light.getAttribute("position"),
    }));
}

function expectLightCount(container: HTMLElement, directionalCount: number): void {
  expect(container.querySelectorAll("hemisphereLight")).toHaveLength(1);
  expect(container.querySelectorAll("ambientLight")).toHaveLength(1);
  expect(container.querySelectorAll("directionalLight")).toHaveLength(directionalCount);
}

beforeEach(() => {
  useCockpitStore.getState().reset();
  useCockpitStore.getState().setLayerMode("mesh");
  useEditorStore.setState({ space: null });
  useDeviceStore.getState().override("low");
  sceneState.width = 1440;
  sceneState.hasAsset = true;
  // R3F host nodes intentionally reach happy-dom in this test. Suppress only
  // React's DOM-only diagnostics for those nodes; preserve all other errors.
  // eslint-disable-next-line no-console -- forward unexpected diagnostics unchanged
  const originalError = console.error.bind(console);
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const message = typeof args[0] === "string" ? args[0] : "";
    if (/incorrect casing|is unrecognized in this browser|does not recognize the|non-boolean attribute/.test(message)) return;
    originalError(...args);
  });
});

afterEach(() => {
  cleanup();
  useEditorStore.setState({ space: null });
  useCockpitStore.getState().reset();
  vi.restoreAllMocks();
});

describe("planner lighting ownership", () => {
  for (const width of [768, 1440]) {
    for (const name of ["Grand Hall", "Custom room", null]) {
      it(`keeps one unchanged light rig through mode switches at ${String(width)}px for ${name ?? "fallback"}`, () => {
        sceneState.width = width;
        useEditorStore.setState({ space: name === null ? null : spaceNamed(name) });
        const { container } = render(<PlannerScene />);
        const roomSelector = name === null ? '[name="grand-hall-room"]' : '[name="room-mesh"]';
        expectLightCount(container, name === null ? 2 : 0);
        const initialLights = lightSignature(container);
        for (const mode of ["splat", "hybrid", "mesh", "splat"] as const) {
          act(() => { useCockpitStore.getState().setLayerMode(mode); });
          expect(container.querySelectorAll(roomSelector)).toHaveLength(mode === "splat" ? 0 : 1);
          expectLightCount(container, name === null ? 2 : 0);
          expect(lightSignature(container)).toEqual(initialLights);
        }
      });
    }
  }

  it("keeps lights when camera motion swaps the detailed polygon room to its lean shell", () => {
    useEditorStore.setState({ space: spaceNamed("Grand Hall") });
    const { container } = render(<PlannerScene />);
    const initialLights = lightSignature(container);
    for (const active of [true, false, true]) {
      act(() => { useCockpitStore.setState({ cameraInteractionActive: active }); });
      expectLightCount(container, 0);
      expect(lightSignature(container)).toEqual(initialLights);
    }
  });

  it("keeps exactly one rig with the procedural fallback when no captured asset is available", () => {
    sceneState.hasAsset = false;
    useCockpitStore.getState().setLayerMode("splat");
    const { container } = render(<PlannerScene />);
    expect(container.querySelector('[name="grand-hall-room"]')).not.toBeNull();
    expectLightCount(container, 2);
  });

  it("retains the polygon room's standalone lighting preset", () => {
    const geometry = resolveRoomGeometry(spaceNamed("Custom room"));
    if (geometry === null) throw new Error("test room must have geometry");
    const { container } = render(<RoomMesh geometry={geometry} detail="detailed" />);
    expectLightCount(container, 0);
    expect(container.querySelector("hemisphereLight")?.getAttribute("args")).toBe("#f0f0ff,#d0c8c0,1.2");
    expect(container.querySelector("ambientLight")?.getAttribute("intensity")).toBe("0.3");
  });

  it("retains the fallback room's standalone lighting preset and device-tier update", () => {
    const { container } = render(<GrandHallRoom />);
    expectLightCount(container, 2);
    expect(container.querySelector("hemisphereLight")?.getAttribute("args")).toBe("#f0f0ff,#d0c8c0,1.5");
    expect(container.querySelector("ambientLight")?.getAttribute("intensity")).toBe("0.38");
    act(() => { useDeviceStore.getState().override("high"); });
    expectLightCount(container, 2);
    expect(container.querySelector("hemisphereLight")?.getAttribute("args")).toBe("#f0f0ff,#d0c8c0,2");
  });
});
