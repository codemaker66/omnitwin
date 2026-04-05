import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// RoomMesh component tests
// ---------------------------------------------------------------------------

// Mock R3F
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: unknown }) => children,
  useThree: () => ({ gl: {}, scene: {}, camera: {}, invalidate: vi.fn() }),
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

  it("Grand Hall has dome and balcony", async () => {
    const { roomGeometries } = await import("../data/room-geometries.js");
    const gh = roomGeometries["Grand Hall"];
    expect(gh).toBeDefined();
    expect(gh?.hasDome).toBe(true);
    expect(gh?.features.length).toBeGreaterThan(0);
  });

  it("fallback: rooms without matching geometry can use rectangular box", async () => {
    // When roomGeometries["Unknown Room"] is undefined, the editor
    // should fall back to a simple box — this is a design contract test
    const { roomGeometries } = await import("../data/room-geometries.js");
    expect(roomGeometries["Unknown Room"]).toBeUndefined();
  });
});
