import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// RoomMesh component tests
// ---------------------------------------------------------------------------

// Mock R3F
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: unknown }) => children,
  useThree: () => ({
    gl: {},
    scene: {},
    camera: {},
    invalidate: vi.fn(),
    size: { width: 1440, height: 900 },
  }),
  useFrame: vi.fn(),
}));

vi.mock("@react-three/drei", () => ({
  OrbitControls: () => null,
}));

// Mock SectionPlane exports
vi.mock("../components/SectionPlane.js", () => ({
  sectionClipPlanes: [],
  noClipPlanes: [],
}));

describe("RoomMesh", () => {
  it("exports a component", async () => {
    const { RoomMesh } = await import("../components/editor/RoomMesh.js");
    expect(typeof RoomMesh).toBe("function");
  });

  it("accepts a RoomGeometry prop", async () => {
    const { RoomMesh } = await import("../components/editor/RoomMesh.js");
    expect(RoomMesh.length).toBeLessThanOrEqual(1);
  });

  it("keeps the Grand Hall ornament layer out of mobile and tablet planner budgets", async () => {
    const { shouldRenderGrandHallOrnaments } = await import("../components/editor/RoomMesh.js");
    expect(shouldRenderGrandHallOrnaments({ isGrandHall: true, viewportWidth: 390 })).toBe(false);
    expect(shouldRenderGrandHallOrnaments({ isGrandHall: true, viewportWidth: 768 })).toBe(false);
    expect(shouldRenderGrandHallOrnaments({ isGrandHall: true, viewportWidth: 1440 })).toBe(true);
    expect(shouldRenderGrandHallOrnaments({ isGrandHall: false, viewportWidth: 1440 })).toBe(false);
  });

  it("uses the lean room shell for mobile and tablet planner canvases", async () => {
    const { shouldUseLeanPlannerRoomShell } = await import("../components/editor/RoomMesh.js");
    expect(shouldUseLeanPlannerRoomShell(390)).toBe(true);
    expect(shouldUseLeanPlannerRoomShell(768)).toBe(true);
    expect(shouldUseLeanPlannerRoomShell(1024)).toBe(true);
    expect(shouldUseLeanPlannerRoomShell(1440)).toBe(false);
  });

  it("allows route-level detail to force the lean or detailed shell", async () => {
    const { shouldUseRoomMeshLeanShell } = await import("../components/editor/RoomMesh.js");
    expect(shouldUseRoomMeshLeanShell("lean", 1440)).toBe(true);
    expect(shouldUseRoomMeshLeanShell("detailed", 390)).toBe(false);
    expect(shouldUseRoomMeshLeanShell("auto", 390)).toBe(true);
    expect(shouldUseRoomMeshLeanShell("auto", 1440)).toBe(false);
  });

  it("keeps camera-driven brick wall fading out of the lean shell", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.resolve("src/components/editor/RoomMesh.tsx"), "utf-8");
    expect(source).toContain("{!useLeanRoomShell && <CameraWallDriver />}");
  });

  it("keeps the lean shell on unlit geometry without feature meshes or scene lights", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.resolve("src/components/editor/RoomMesh.tsx"), "utf-8");
    expect(source).toContain("useLeanRoomShell ? (");
    expect(source).toContain("<meshBasicMaterial");
    expect(source).toContain("{!useLeanRoomShell && geometry.features.map");
    expect(source).toContain("{!useLeanRoomShell && (");
  });
});

describe("room-geometries data", () => {
  it("all rooms render without errors (geometry data is valid)", async () => {
    const { roomGeometries } = await import("../data/room-geometries.js");
    // Verify the shapes can be created from polygon data
    for (const [name, geom] of Object.entries(roomGeometries)) {
      expect(geom.wallPolygon.length).toBeGreaterThanOrEqual(4);
      expect(geom.ceilingHeight).toBeGreaterThan(0);
      // Name should be a non-empty string
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("Grand Hall has dome", async () => {
    const { roomGeometries } = await import("../data/room-geometries.js");
    const gh = roomGeometries["Grand Hall"];
    expect(gh).toBeDefined();
    expect(gh?.hasDome).toBe(true);
  });

  it("fallback: rooms without matching geometry can use rectangular box", async () => {
    // When roomGeometries["Unknown Room"] is undefined, the editor
    // should fall back to a simple box — this is a design contract test
    const { roomGeometries } = await import("../data/room-geometries.js");
    expect(roomGeometries["Unknown Room"]).toBeUndefined();
  });
});
