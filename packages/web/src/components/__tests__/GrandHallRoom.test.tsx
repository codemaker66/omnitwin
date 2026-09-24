import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { FrontSide } from "three";
import {
  computeRoomSurfaces,
  computeWainscotingSurfaces,
  isSurfaceClippable,
  GRAND_HALL_SURFACES,
  GRAND_HALL_WAINSCOTING,
  DOME_RADIUS,
  DOME_RECESS_DEPTH,
  type RoomSurface,
} from "../GrandHallRoom.js";
import {
  FLOOR_COLOR, WALL_COLOR, CEILING_COLOR,
  WAINSCOT_COLOR, WAINSCOT_HEIGHT,
  DOME_COLOR,
} from "../../constants/colors.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import {
  computeOppositeLongWallChairRailSegments,
  computeOppositeLongWallDoorCenters,
  computeVisibleLongWainscotPanelCenters,
  computeVisibleShortWainscotPanelCenters,
  computeWindowWallCenters,
  isInWindowWallOpeningBay,
  shouldShowCeilingOrnamentsForSection,
  shouldShowWallOrnamentsForSection,
  WALL_ORNAMENT_SECTION_HIDE_BELOW_M,
  WAINSCOT_PANEL_TOP_Y,
  WINDOW_SILL_Y,
} from "../GrandHallOrnaments.js";
import {
  describeGrandHallOrnaments,
  type OrnamentLayer,
  type OrnamentSurface,
} from "../grand-hall-ornament-parts.js";
import type { OrnamentMeshNode, OrnamentNode } from "../../lib/ornament-batching.js";

// ---------------------------------------------------------------------------
// Ornament description helpers — the data both the per-mesh tree and the
// merged stand-ins are rendered from.
// ---------------------------------------------------------------------------

function grandHallOrnamentSurfaces(): readonly OrnamentSurface[] {
  const { width, length, height } = GRAND_HALL_RENDER_DIMENSIONS;
  const description = describeGrandHallOrnaments(width, length, height);
  const walls = description.walls.flatMap((layer: OrnamentLayer) => (layer.kind === "surface" ? [layer] : layer.surfaces));
  return [...description.ceiling, ...walls, ...description.rosette];
}

function ornamentSurface(name: string): OrnamentSurface {
  const surface = grandHallOrnamentSurfaces().find((candidate) => candidate.name === name);
  if (surface === undefined) throw new Error(`Ornament surface "${name}" not found`);
  return surface;
}

function ornamentNodes(nodes: readonly OrnamentNode[]): OrnamentNode[] {
  return nodes.flatMap((node) => (node.kind === "group" ? [node, ...ornamentNodes(node.children)] : [node]));
}

function ornamentMeshes(surface: OrnamentSurface, name: string): OrnamentMeshNode[] {
  return ornamentNodes(surface.children).filter((node): node is OrnamentMeshNode => node.kind === "mesh" && node.name === name);
}

function allOrnamentNames(): string[] {
  const { width, length, height } = GRAND_HALL_RENDER_DIMENSIONS;
  const description = describeGrandHallOrnaments(width, length, height);
  const surfaces = grandHallOrnamentSurfaces();
  const chandelierNodes = description.chandeliers.flatMap((chandelier) => [...chandelier.fittings, ...chandelier.crystal]);
  return [
    ...surfaces.map((surface) => surface.name),
    ...ornamentNodes([...surfaces.flatMap((surface) => surface.children), ...chandelierNodes])
      .map((node) => node.name ?? ""),
  ];
}

/** Both ornament sources, for guards against reintroduced components. */
async function ornamentSources(): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const files = ["src/components/GrandHallOrnaments.tsx", "src/components/grand-hall-ornament-parts.ts"];
  const sources = await Promise.all(files.map((file) => fs.readFile(path.resolve(file), "utf-8")));
  return sources.join("\n");
}

// ---------------------------------------------------------------------------
// Mock R3F — happy-dom has no WebGL context
// ---------------------------------------------------------------------------

const CanvasMock = vi.hoisted(() =>
  vi.fn((_props: { children?: React.ReactNode }) => <div data-testid="r3f-canvas" />),
);

vi.mock("@react-three/fiber", () => ({
  Canvas: CanvasMock,
  useThree: () => ({
    camera: {
      position: { x: 0, y: 0, z: 0, set: vi.fn(), copy: vi.fn() },
      quaternion: { setFromEuler: vi.fn() },
      lookAt: vi.fn(),
    },
    gl: { domElement: document.createElement("canvas") },
    invalidate: vi.fn(),
    // CameraRig reads size for aspect-aware pose; stub desktop viewport.
    size: { width: 1440, height: 900 },
  }),
  useFrame: vi.fn(),
}));

vi.mock("@react-three/drei", () => ({
  OrbitControls: vi.fn(() => null),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

// Import App after mock is registered
const { App } = await import("../../App.js");

// ---------------------------------------------------------------------------
// Helper — find a surface by name
// ---------------------------------------------------------------------------

function findSurface(surfaces: readonly RoomSurface[], name: string): RoomSurface {
  const surface = surfaces.find((s) => s.name === name);
  if (surface === undefined) {
    throw new Error(`Surface "${name}" not found`);
  }
  return surface;
}

// ---------------------------------------------------------------------------
// Pure geometry tests — computeRoomSurfaces
// ---------------------------------------------------------------------------

describe("computeRoomSurfaces", () => {
  const dimensions = { width: 10, length: 8, height: 4 };
  const surfaces = computeRoomSurfaces(dimensions);

  it("returns exactly 6 surfaces", () => {
    expect(surfaces).toHaveLength(6);
  });

  it("returns surfaces named floor, ceiling, wall-back, wall-front, wall-left, wall-right", () => {
    const names = surfaces.map((s) => s.name).sort();
    expect(names).toEqual(["ceiling", "floor", "wall-back", "wall-front", "wall-left", "wall-right"]);
  });

  // --- Floor ---

  it("positions the floor at y=0 (ground level)", () => {
    const floor = findSurface(surfaces, "floor");
    expect(floor.position[1]).toBe(0);
  });

  it("sizes the floor to width × length", () => {
    const floor = findSurface(surfaces, "floor");
    expect(floor.size).toEqual([10, 8]);
  });

  it("rotates the floor -90° around X so normal faces up", () => {
    const floor = findSurface(surfaces, "floor");
    expect(floor.rotation[0]).toBeCloseTo(-Math.PI / 2);
    expect(floor.rotation[1]).toBe(0);
    expect(floor.rotation[2]).toBe(0);
  });

  it("assigns floor colour", () => {
    const floor = findSurface(surfaces, "floor");
    expect(floor.color).toBe(FLOOR_COLOR);
  });

  it("uses the polished honey timber floor colour", () => {
    expect(FLOOR_COLOR).toBe("#f5d9a1");
  });

  // --- Ceiling ---

  it("positions the ceiling at y=height", () => {
    const ceiling = findSurface(surfaces, "ceiling");
    expect(ceiling.position[1]).toBe(4);
  });

  it("sizes the ceiling to width × length", () => {
    const ceiling = findSurface(surfaces, "ceiling");
    expect(ceiling.size).toEqual([10, 8]);
  });

  it("rotates the ceiling +90° around X so normal faces down", () => {
    const ceiling = findSurface(surfaces, "ceiling");
    expect(ceiling.rotation[0]).toBeCloseTo(Math.PI / 2);
  });

  it("assigns ceiling colour", () => {
    const ceiling = findSurface(surfaces, "ceiling");
    expect(ceiling.color).toBe(CEILING_COLOR);
  });

  // --- Back wall ---

  it("positions the back wall at z = -length/2", () => {
    const wall = findSurface(surfaces, "wall-back");
    expect(wall.position[2]).toBe(-4);
  });

  it("centers the back wall vertically at height/2", () => {
    const wall = findSurface(surfaces, "wall-back");
    expect(wall.position[1]).toBe(2);
  });

  it("sizes the back wall to width × height", () => {
    const wall = findSurface(surfaces, "wall-back");
    expect(wall.size).toEqual([10, 4]);
  });

  it("back wall has no rotation (default normal +Z faces into room)", () => {
    const wall = findSurface(surfaces, "wall-back");
    expect(wall.rotation).toEqual([0, 0, 0]);
  });

  // --- Front wall ---

  it("positions the front wall at z = +length/2", () => {
    const wall = findSurface(surfaces, "wall-front");
    expect(wall.position[2]).toBe(4);
  });

  it("rotates the front wall 180° around Y so normal faces -Z into room", () => {
    const wall = findSurface(surfaces, "wall-front");
    expect(wall.rotation[1]).toBeCloseTo(Math.PI);
  });

  it("sizes the front wall to width × height", () => {
    const wall = findSurface(surfaces, "wall-front");
    expect(wall.size).toEqual([10, 4]);
  });

  // --- Left wall ---

  it("positions the left wall at x = -width/2", () => {
    const wall = findSurface(surfaces, "wall-left");
    expect(wall.position[0]).toBe(-5);
  });

  it("sizes the left wall to length × height", () => {
    const wall = findSurface(surfaces, "wall-left");
    expect(wall.size).toEqual([8, 4]);
  });

  it("rotates the left wall +90° around Y so normal faces +X into room", () => {
    const wall = findSurface(surfaces, "wall-left");
    expect(wall.rotation[1]).toBeCloseTo(Math.PI / 2);
  });

  // --- Right wall ---

  it("positions the right wall at x = +width/2", () => {
    const wall = findSurface(surfaces, "wall-right");
    expect(wall.position[0]).toBe(5);
  });

  it("sizes the right wall to length × height", () => {
    const wall = findSurface(surfaces, "wall-right");
    expect(wall.size).toEqual([8, 4]);
  });

  it("rotates the right wall -90° around Y so normal faces -X into room", () => {
    const wall = findSurface(surfaces, "wall-right");
    expect(wall.rotation[1]).toBeCloseTo(-Math.PI / 2);
  });

  // --- All walls share wall colour ---

  it("assigns wall colour to all 4 walls", () => {
    const wallNames = ["wall-back", "wall-front", "wall-left", "wall-right"];
    for (const name of wallNames) {
      const wall = findSurface(surfaces, name);
      expect(wall.color).toBe(WALL_COLOR);
    }
  });

  // --- Centering ---

  it("centers floor and ceiling on X=0, Z=0", () => {
    const floor = findSurface(surfaces, "floor");
    const ceiling = findSurface(surfaces, "ceiling");
    expect(floor.position[0]).toBe(0);
    expect(floor.position[2]).toBe(0);
    expect(ceiling.position[0]).toBe(0);
    expect(ceiling.position[2]).toBe(0);
  });

  it("centers all walls on their non-offset axes", () => {
    const back = findSurface(surfaces, "wall-back");
    const front = findSurface(surfaces, "wall-front");
    const left = findSurface(surfaces, "wall-left");
    const right = findSurface(surfaces, "wall-right");
    // Back/front walls centered on X
    expect(back.position[0]).toBe(0);
    expect(front.position[0]).toBe(0);
    // Left/right walls centered on Z
    expect(left.position[2]).toBe(0);
    expect(right.position[2]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Grand Hall specific dimensions
// ---------------------------------------------------------------------------

describe("GRAND_HALL_SURFACES", () => {
  it("matches the scaled render dimensions", () => {
    const { width, length, height } = GRAND_HALL_RENDER_DIMENSIONS;
    const floor = findSurface(GRAND_HALL_SURFACES, "floor");
    expect(floor.size).toEqual([width, length]);

    const ceiling = findSurface(GRAND_HALL_SURFACES, "ceiling");
    expect(ceiling.position[1]).toBe(height);
  });

  it("positions back wall at z = -halfLength", () => {
    const wall = findSurface(GRAND_HALL_SURFACES, "wall-back");
    expect(wall.position[2]).toBe(-GRAND_HALL_RENDER_DIMENSIONS.length / 2);
  });

  it("positions left wall at x = -halfWidth", () => {
    const wall = findSurface(GRAND_HALL_SURFACES, "wall-left");
    expect(wall.position[0]).toBe(-GRAND_HALL_RENDER_DIMENSIONS.width / 2);
  });

  it("sizes the left/right walls to length × height", () => {
    const { length, height } = GRAND_HALL_RENDER_DIMENSIONS;
    const wall = findSurface(GRAND_HALL_SURFACES, "wall-left");
    expect(wall.size).toEqual([length, height]);
  });

  it("has exactly 6 surfaces", () => {
    expect(GRAND_HALL_SURFACES).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Wainscoting
// ---------------------------------------------------------------------------

describe("computeWainscotingSurfaces", () => {
  const dimensions = { width: 10, length: 8, height: 4 };
  const panels = computeWainscotingSurfaces(dimensions);

  it("returns exactly 4 panels", () => {
    expect(panels).toHaveLength(4);
  });

  it("returns panels named wainscot-back, wainscot-front, wainscot-left, wainscot-right", () => {
    const names = panels.map((p) => p.name).sort();
    expect(names).toEqual(["wainscot-back", "wainscot-front", "wainscot-left", "wainscot-right"]);
  });

  it("all panels use WAINSCOT_COLOR", () => {
    for (const panel of panels) {
      expect(panel.color).toBe(WAINSCOT_COLOR);
    }
  });

  it("panels are WAINSCOT_HEIGHT tall", () => {
    for (const panel of panels) {
      expect(panel.size[1]).toBe(WAINSCOT_HEIGHT);
    }
  });

  it("panels are positioned at half wainscot height (centered on lower wall)", () => {
    for (const panel of panels) {
      expect(panel.position[1]).toBeCloseTo(WAINSCOT_HEIGHT / 2);
    }
  });

  it("back panel is slightly inset from the wall (z-fighting prevention)", () => {
    const back = findSurface(panels, "wainscot-back");
    expect(back.position[2]).toBeGreaterThan(-4); // slightly closer than wall at -4
  });
});

describe("GRAND_HALL_WAINSCOTING", () => {
  it("has exactly 4 panels", () => {
    expect(GRAND_HALL_WAINSCOTING).toHaveLength(4);
  });

  it("back panel width matches scaled room width", () => {
    const back = findSurface(GRAND_HALL_WAINSCOTING, "wainscot-back");
    expect(back.size[0]).toBe(GRAND_HALL_RENDER_DIMENSIONS.width);
  });

  it("left panel width matches scaled room length", () => {
    const left = findSurface(GRAND_HALL_WAINSCOTING, "wainscot-left");
    expect(left.size[0]).toBe(GRAND_HALL_RENDER_DIMENSIONS.length);
  });
});

// ---------------------------------------------------------------------------
// Colour constants
// ---------------------------------------------------------------------------

describe("colour constants", () => {
  it("FLOOR_COLOR is a valid hex colour", () => {
    expect(FLOOR_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("WALL_COLOR is a valid hex colour", () => {
    expect(WALL_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("CEILING_COLOR is a valid hex colour", () => {
    expect(CEILING_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("all three colours are distinct", () => {
    const colors = new Set([FLOOR_COLOR, WALL_COLOR, CEILING_COLOR]);
    expect(colors.size).toBe(3);
  });

  it("WAINSCOT_COLOR is a valid hex colour", () => {
    expect(WAINSCOT_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("WAINSCOT_COLOR is distinct from wall and floor", () => {
    expect(WAINSCOT_COLOR).not.toBe(WALL_COLOR);
    expect(WAINSCOT_COLOR).not.toBe(FLOOR_COLOR);
  });
});

// ---------------------------------------------------------------------------
// Dome constants
// ---------------------------------------------------------------------------

describe("dome constants", () => {
  it("DOME_RADIUS is 3.5m (7m diameter)", () => {
    expect(DOME_RADIUS).toBe(3.5);
  });

  it("DOME_RECESS_DEPTH is a shallow cap, not a full hemisphere", () => {
    expect(DOME_RECESS_DEPTH).toBeGreaterThan(1);
    expect(DOME_RECESS_DEPTH).toBeLessThan(DOME_RADIUS);
  });

  it("dome fits within the room width", () => {
    expect(DOME_RADIUS * 2).toBeLessThanOrEqual(GRAND_HALL_RENDER_DIMENSIONS.width);
  });

  it("dome fits within the room length", () => {
    expect(DOME_RADIUS * 2).toBeLessThanOrEqual(GRAND_HALL_RENDER_DIMENSIONS.length);
  });

  it("DOME_COLOR is a valid hex colour", () => {
    expect(DOME_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("DOME_COLOR is distinct from CEILING_COLOR", () => {
    expect(DOME_COLOR).not.toBe(CEILING_COLOR);
  });
});

describe("Grand Hall ornaments source", () => {
  it("keeps dark raised panels out of the window, door, and fireplace end walls", () => {
    const { width, length } = GRAND_HALL_RENDER_DIMENSIONS;
    const backWallPanels = computeVisibleLongWainscotPanelCenters(width, "back");
    const frontWallPanels = computeVisibleLongWainscotPanelCenters(width, "front");
    const leftWallPanels = computeVisibleShortWainscotPanelCenters(length, "left");
    const rightWallPanels = computeVisibleShortWainscotPanelCenters(length, "right");

    expect(computeWindowWallCenters(width)).toHaveLength(3);
    expect(frontWallPanels).toHaveLength(0);
    expect(backWallPanels).toHaveLength(0);
    expect(leftWallPanels).toHaveLength(0);
    expect(rightWallPanels).toHaveLength(0);
    expect(backWallPanels.every((x) => !isInWindowWallOpeningBay(x, width))).toBe(true);
  });

  it("places arched window sills above the dark lower-wall panelling", () => {
    expect(WINDOW_SILL_Y).toBeGreaterThan(WAINSCOT_PANEL_TOP_Y);
  });

  it("gives the arched windows translucent glass over daylight backing", () => {
    const windows = ornamentSurface("window-wall-ornament-cluster");
    const daylight = ornamentMeshes(windows, "arched-window-daylight-pane-rect");
    const glass = ornamentMeshes(windows, "arched-window-glass-pane-rect");
    const archGlass = ornamentMeshes(windows, "arched-window-glass-pane-arch");
    expect(daylight).toHaveLength(3);
    expect(glass).toHaveLength(3);
    expect(archGlass).toHaveLength(3);
    expect(ornamentMeshes(windows, "arched-window-daylight-pane-arch")).toHaveLength(3);
    expect(ornamentMeshes(windows, "arched-window-glass-highlight")).toHaveLength(6);

    for (const pane of daylight) {
      expect(pane.material.emissive).toBe(pane.material.color);
      expect(pane.material.transparent ?? false).toBe(false);
    }
    for (const pane of [...glass, ...archGlass]) {
      expect(pane.material.transparent).toBe(true);
      expect(pane.material.depthWrite).toBe(false);
    }
    expect(glass.map((pane) => pane.material.opacity)).toEqual([0.42, 0.42, 0.42]);
    // The glass sits in front of (room-side of) its daylight backing.
    glass.forEach((pane, i) => {
      expect(pane.position?.[2] ?? 0).toBeGreaterThan(daylight[i]?.position?.[2] ?? 0);
    });
  });

  it("uses a polished lengthwise plank texture for the floor", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.resolve("src/lib/grand-hall-textures.ts"), "utf-8");

    expect(source).toContain("Polished honey timber plank floor");
    expect(source).toContain("BOARD_W");
    expect(source).toContain("rowOffset");
    expect(source).toContain("endJointY");
    expect(source).toContain("centreWear");
    expect(source).toContain("glint");
    expect(source).toContain("return finalize(canvas, 3.8, 3.4)");
  });

  it("restores three ornate double-door sets on the long wall opposite the windows", async () => {
    const { width, length } = GRAND_HALL_RENDER_DIMENSIONS;
    const doors = ornamentSurface("opposite-long-wall-three-door-cluster");
    expect(doors.surfaceKey).toBe("wall-front");
    const doorSets = doors.children.filter((node) => node.kind === "group" && node.name === "front-long-wall-door-set");
    expect(doorSets).toHaveLength(3);
    expect(doorSets.map((node) => (node.kind === "group" ? node.position : undefined)))
      .toEqual(computeOppositeLongWallDoorCenters(width).map((x) => [x, 0, length / 2 - 0.085]));
    expect(ornamentMeshes(doors, "grand-hall-front-wall-door")).toHaveLength(6);
    expect(ornamentMeshes(doors, "front-wall-door-raised-panel-frame")).toHaveLength(12);
    expect(ornamentMeshes(doors, "front-wall-door-brass-handle")).toHaveLength(6);
    expect(allOrnamentNames()).not.toContain("honour-cabinet-long-wall");
    expect(await ornamentSources()).not.toContain("honour-cabinet-long-wall");
  });

  it("interrupts the opposite-wall chair rail around each double-door set", () => {
    const { width } = GRAND_HALL_RENDER_DIMENSIONS;
    const segments = computeOppositeLongWallChairRailSegments(width);
    const doorCenters = computeOppositeLongWallDoorCenters(width);

    expect(segments).toHaveLength(4);
    for (const doorCenter of doorCenters) {
      expect(
        segments.some((segment) => {
          const start = segment.centerX - segment.width / 2;
          const end = segment.centerX + segment.width / 2;
          return start < doorCenter && end > doorCenter;
        }),
      ).toBe(false);
    }
  });

  it("renders a named interrupted chair rail on the opposite-wall door side", () => {
    const { width } = GRAND_HALL_RENDER_DIMENSIONS;
    const rails = ornamentMeshes(ornamentSurface("raised-wainscot-front"), "front-long-wall-door-interrupted-chair-rail");
    const segments = computeOppositeLongWallChairRailSegments(width);
    expect(rails).toHaveLength(segments.length);
    rails.forEach((rail, i) => {
      expect(rail.position?.[0]).toBe(segments[i]?.centerX);
      expect(rail.geometry).toEqual({ kind: "box", args: [segments[i]?.width, 0.1, 0.075] });
    });
  });

  it("keeps the opposite short end wall clear of door assemblies", async () => {
    const source = await ornamentSources();
    const names = allOrnamentNames();
    for (const banned of ["right-end-wall-doors", "grand-hall-right-wall-door", "right-wall-door-brass-handle", "short-end-door"]) {
      expect(source).not.toContain(banned);
      expect(names.some((name) => name.includes(banned))).toBe(false);
    }
    expect(source).not.toContain("wallSide=\"right\"");
    // The right short wall carries only its continuous mouldings and rail.
    expect(grandHallOrnamentSurfaces().filter((surface) => surface.surfaceKey === "wall-right").map((surface) => surface.name))
      .toEqual(["crown-right", "skirt-right", "raised-wainscot-right", "frieze-right"]);
  });

  it("keeps the far short-end fireplace as separate surround pieces", () => {
    const focal = ornamentSurface("left-end-wall-focal-point");
    expect(focal.surfaceKey).toBe("wall-left");
    for (const piece of ["left-firebox-back-panel", "left-fireplace-left-jamb", "left-fireplace-right-jamb"]) {
      expect(ornamentMeshes(focal, piece)).toHaveLength(1);
    }
    expect(allOrnamentNames()).not.toContain("right-firebox-back-panel");
    const boxes = grandHallOrnamentSurfaces()
      .flatMap((surface) => ornamentNodes(surface.children))
      .flatMap((node) => (node.kind === "mesh" && node.geometry.kind === "box" ? [node.geometry.args] : []));
    expect(boxes).not.toContainEqual([0.16, 1.08, 2.4]);
    expect(boxes).not.toContainEqual([0.08, 0.72, 1.35]);
  });

  it("removes decorative wall and ceiling ornaments in lowered section mode", async () => {
    const source = await ornamentSources();
    expect(source).toContain("wallOrnamentsVisible");
    expect(source).toContain("ceilingOrnamentsVisible");
    const names = grandHallOrnamentSurfaces().map((surface) => surface.name);
    for (const surface of [
      "window-wall-ornament-cluster",
      "opposite-long-wall-three-door-cluster",
      "left-end-wall-focal-point",
      "grand-hall-ceiling-ornaments",
    ]) {
      expect(names).toContain(surface);
    }
    // Rendered behaviour at each section height is compared with the
    // pre-merge ornaments in GrandHallOrnaments.merge.test.tsx.
  });

  it("keeps wall ornaments only while the section plane is above planning-cut height", () => {
    expect(shouldShowWallOrnamentsForSection(WALL_ORNAMENT_SECTION_HIDE_BELOW_M - 0.1, 7)).toBe(false);
    expect(shouldShowWallOrnamentsForSection(WALL_ORNAMENT_SECTION_HIDE_BELOW_M, 7)).toBe(true);
    expect(shouldShowWallOrnamentsForSection(7, 7)).toBe(true);
  });

  it("keeps ceiling ornaments only when the full ceiling is restored", () => {
    expect(shouldShowCeilingOrnamentsForSection(6.7, 7)).toBe(false);
    expect(shouldShowCeilingOrnamentsForSection(6.9, 7)).toBe(true);
  });

  it("upgrades the fireplace beyond a flat box surround", () => {
    const focal = ornamentSurface("left-end-wall-focal-point");
    const surround = ornamentNodes(focal.children).find((node) => node.name === "left-fireplace-realistic-surround");
    expect(surround?.kind).toBe("group");
    expect(ornamentMeshes(focal, "left-fireplace-firebox-arch")).toHaveLength(1);
    expect(ornamentMeshes(focal, "left-fireplace-brass-grate-bar")).toHaveLength(4);
    expect(ornamentMeshes(focal, "left-fireplace-charred-log")).toHaveLength(2);
    expect(ornamentMeshes(focal, "left-fireplace-ember-glow")).toHaveLength(1);
    expect(ornamentMeshes(focal, "left-fireplace-marble-vein")).toHaveLength(3);
  });

  it("does not bake fixed wall-chair rows into the empty hall", async () => {
    const source = await ornamentSources();
    const names = allOrnamentNames();
    for (const banned of ["WallChairRows", "red-upholstered-wall-chair-rows", "BalconyWallCue", "floorplan-balcony-wall-cue"]) {
      expect(source).not.toContain(banned);
      expect(names).not.toContain(banned);
    }
  });

});

// ---------------------------------------------------------------------------
// Section plane clipping
// ---------------------------------------------------------------------------

describe("isSurfaceClippable", () => {
  it("floor is NOT clippable (always visible)", () => {
    expect(isSurfaceClippable("floor")).toBe(false);
  });

  it("ceiling IS clippable", () => {
    expect(isSurfaceClippable("ceiling")).toBe(true);
  });

  it("all 4 walls are clippable", () => {
    expect(isSurfaceClippable("wall-back")).toBe(true);
    expect(isSurfaceClippable("wall-front")).toBe(true);
    expect(isSurfaceClippable("wall-left")).toBe(true);
    expect(isSurfaceClippable("wall-right")).toBe(true);
  });

  it("wainscoting is clippable", () => {
    expect(isSurfaceClippable("wainscot-back")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("computeRoomSurfaces edge cases", () => {
  it("handles a 1×1×1 unit cube", () => {
    const surfaces = computeRoomSurfaces({ width: 1, length: 1, height: 1 });
    expect(surfaces).toHaveLength(6);
    const floor = findSurface(surfaces, "floor");
    expect(floor.size).toEqual([1, 1]);
    expect(floor.position).toEqual([0, 0, 0]);
  });

  it("handles non-integer dimensions", () => {
    const surfaces = computeRoomSurfaces({ width: 3.7, length: 2.3, height: 1.1 });
    const ceiling = findSurface(surfaces, "ceiling");
    expect(ceiling.position[1]).toBeCloseTo(1.1);
    const back = findSurface(surfaces, "wall-back");
    expect(back.position[2]).toBeCloseTo(-1.15);
  });

  it("handles very large dimensions", () => {
    const surfaces = computeRoomSurfaces({ width: 200, length: 200, height: 50 });
    expect(surfaces).toHaveLength(6);
    const ceiling = findSurface(surfaces, "ceiling");
    expect(ceiling.position[1]).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Three.js material verification
// ---------------------------------------------------------------------------

describe("FrontSide import", () => {
  it("FrontSide equals 0 (Three.js constant)", () => {
    expect(FrontSide).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Component smoke test — renders inside mocked Canvas
// ---------------------------------------------------------------------------

describe("App with GrandHallRoom", () => {
  it("renders without crashing", () => {
    const { getByTestId } = render(<App />);
    expect(getByTestId("r3f-canvas")).toBeDefined();
  });
});
