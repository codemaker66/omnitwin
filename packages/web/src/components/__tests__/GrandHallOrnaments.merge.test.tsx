import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import { GrandHallOrnaments } from "../GrandHallOrnaments.js";
import { describeGrandHallOrnaments } from "../grand-hall-ornament-parts.js";
import { LegacyGrandHallOrnaments } from "./fixtures/legacy-grand-hall-ornaments.js";
import { mountFrameRoot, type FrameRoot } from "./r3f-frame-root.js";
import { collectOrnamentDraws, planOrnamentBatches, type OrnamentMaterial } from "../../lib/ornament-batching.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { useVisibilityStore } from "../../stores/visibility-store.js";
import { useXrayStore } from "../../stores/xray-store.js";
import { useSectionStore } from "../../stores/section-store.js";

// ---------------------------------------------------------------------------
// The pre-merge JSX (fixtures/legacy-grand-hall-ornaments.tsx) is the oracle.
// Both trees are mounted in a real R3F reconciler and stepped frame by frame,
// so SurfaceVisibilityGroup's material overrides and drei's instance matrices
// are exactly what three would draw.
// ---------------------------------------------------------------------------

const SURFACES = [
  "grand-hall-ceiling-ornaments",
  "crown-back", "crown-front", "crown-left", "crown-right",
  "skirt-back", "skirt-front", "skirt-left", "skirt-right",
  "raised-wainscot-back", "raised-wainscot-front", "raised-wainscot-left", "raised-wainscot-right",
  "frieze-back", "frieze-front", "frieze-left", "frieze-right",
  "opposite-long-wall-three-door-cluster",
  "left-end-wall-focal-point",
  "window-wall-ornament-cluster",
  "grand-hall-ceiling-rosette",
] as const;

const initialVisibility = useVisibilityStore.getState();
const initialXray = useXrayStore.getState();
const initialSection = useSectionStore.getState();

let mounted: FrameRoot[] = [];

function mount(element: React.ReactElement): FrameRoot {
  const root = mountFrameRoot(element);
  mounted.push(root);
  return root;
}

function frames(roots: readonly FrameRoot[], count = 1, delta = 1 / 60): void {
  for (let i = 0; i < count; i++) for (const root of roots) root.frame(delta);
  for (const root of roots) root.scene.updateMatrixWorld(true);
}

beforeEach(() => {
  useVisibilityStore.setState({ ...initialVisibility, ceiling: true }, true);
  useXrayStore.setState(initialXray, true);
  useSectionStore.setState(initialSection, true);
});

afterEach(() => {
  for (const root of mounted) root.unmount();
  mounted = [];
  useVisibilityStore.setState(initialVisibility, true);
  useXrayStore.setState(initialXray, true);
  useSectionStore.setState(initialSection, true);
});

// ---------------------------------------------------------------------------
// Scene inspection helpers
// ---------------------------------------------------------------------------

function named(root: Object3D, name: string): Object3D {
  const found = root.getObjectByName(name);
  if (found === undefined) throw new Error(`Missing object ${name}`);
  return found;
}

function isStandIn(object: Object3D): boolean {
  return object.name.endsWith("-opaque-stand-in");
}

function isMesh(object: Object3D): object is Mesh {
  return object instanceof Mesh;
}

/** Meshes (instanced meshes count as one draw) in scene-graph order. */
function drawObjects(root: Object3D, skip: (object: Object3D) => boolean = () => false): Mesh[] {
  const out: Mesh[] = [];
  const visit = (object: Object3D): void => {
    if (skip(object)) return;
    if (isMesh(object)) out.push(object);
    for (const child of object.children) visit(child);
  };
  visit(root);
  return out;
}

/** What three would draw: meshes whose whole ancestry is visible. */
function visibleDraws(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  const visit = (object: Object3D): void => {
    if (!object.visible) return;
    if (isMesh(object)) out.push(object);
    for (const child of object.children) visit(child);
  };
  visit(root);
  return out;
}

/** three's opaque sort key: materials number themselves in creation order (untyped in @types/three). */
function materialId(material: Material): number {
  const id: unknown = Reflect.get(material, "id");
  if (typeof id !== "number") throw new Error("three materials carry a numeric id");
  return id;
}

function standardMaterial(mesh: Mesh): MeshStandardMaterial {
  const { material } = mesh;
  if (!(material instanceof MeshStandardMaterial)) throw new Error(`${mesh.name} is not a standard material`);
  return material;
}

/** Everything about a material that affects the pixels it produces. */
function materialSignature(material: Material): Record<string, unknown> {
  if (!(material instanceof MeshStandardMaterial)) throw new Error("Expected MeshStandardMaterial");
  return {
    type: material.type,
    color: material.color.toArray(),
    emissive: material.emissive.toArray(),
    emissiveIntensity: material.emissiveIntensity,
    roughness: material.roughness,
    metalness: material.metalness,
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    depthTest: material.depthTest,
    depthFunc: material.depthFunc,
    side: material.side,
    blending: material.blending,
    alphaTest: material.alphaTest,
    alphaHash: material.alphaHash,
    alphaToCoverage: material.alphaToCoverage,
    premultipliedAlpha: material.premultipliedAlpha,
    colorWrite: material.colorWrite,
    polygonOffset: material.polygonOffset,
    fog: material.fog,
    toneMapped: material.toneMapped,
    flatShading: material.flatShading,
    vertexColors: material.vertexColors,
    wireframe: material.wireframe,
    visible: material.visible,
    forceSinglePass: material.forceSinglePass,
    dithering: material.dithering,
    envMapIntensity: material.envMapIntensity,
    clippingPlanes: material.clippingPlanes,
    textures: [
      material.map, material.emissiveMap, material.roughnessMap, material.metalnessMap,
      material.normalMap, material.aoMap, material.lightMap, material.envMap, material.alphaMap,
    ].map((texture) => texture === null),
  };
}

/** The material props a mesh declared, read before any frame applies surface opacity. */
function declaredMaterial(material: Material): OrnamentMaterial {
  if (!(material instanceof MeshStandardMaterial)) throw new Error("Expected MeshStandardMaterial");
  return {
    color: `#${material.color.getHexString()}`,
    roughness: material.roughness,
    metalness: material.metalness,
    emissive: `#${material.emissive.getHexString()}`,
    emissiveIntensity: material.emissiveIntensity,
    transparent: material.transparent,
    opacity: material.opacity,
    depthWrite: material.depthWrite,
    side: material.side,
  };
}

function primitiveMatrices(mesh: Mesh): Matrix4[] {
  if (mesh instanceof InstancedMesh) {
    const matrices: Matrix4[] = [];
    for (let i = 0; i < mesh.count; i++) {
      const instance = new Matrix4();
      mesh.getMatrixAt(i, instance);
      matrices.push(new Matrix4().multiplyMatrices(mesh.matrixWorld, instance));
    }
    return matrices;
  }
  return [mesh.matrixWorld.clone()];
}

interface VertexSoup {
  readonly position: number[];
  readonly normal: number[];
  readonly uv: number[];
  readonly index: number[];
}

/** World-space vertices of every primitive of `meshes`, concatenated in order. */
function worldSoup(meshes: readonly Mesh[]): VertexSoup {
  const soup: VertexSoup = { position: [], normal: [], uv: [], index: [] };
  for (const mesh of meshes) {
    for (const matrix of primitiveMatrices(mesh)) {
      const geometry: BufferGeometry = mesh.geometry.clone().applyMatrix4(matrix);
      const offset = soup.position.length / 3;
      soup.position.push(...geometry.getAttribute("position").array);
      soup.normal.push(...geometry.getAttribute("normal").array);
      soup.uv.push(...geometry.getAttribute("uv").array);
      const index = geometry.getIndex();
      if (index === null) throw new Error(`${mesh.name} geometry is not indexed`);
      for (let i = 0; i < index.count; i++) soup.index.push(index.getX(i) + offset);
      geometry.dispose();
    }
  }
  return soup;
}

function maxDifference(a: readonly number[], b: readonly number[]): number {
  expect(a.length).toBe(b.length);
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs((a[i] ?? Number.NaN) - (b[i] ?? Number.NaN)));
  return max;
}

function expectSameSoup(actual: VertexSoup, expected: VertexSoup): void {
  expect(actual.index).toEqual(expected.index);
  expect(maxDifference(actual.position, expected.position)).toBeLessThan(1e-5);
  expect(maxDifference(actual.normal, expected.normal)).toBeLessThan(1e-5);
  expect(maxDifference(actual.uv, expected.uv)).toBeLessThan(1e-5);
}

function meshSignature(mesh: Mesh): Record<string, unknown> {
  const geometry = mesh.geometry as BufferGeometry & { parameters?: unknown };
  return {
    kind: mesh instanceof InstancedMesh ? "instanced" : "mesh",
    name: mesh.name,
    geometry: geometry.type,
    parameters: geometry.parameters,
    material: materialSignature(standardMaterial(mesh)),
    matrices: primitiveMatrices(mesh).map((matrix) => matrix.toArray()),
  };
}

/** Per-mesh ornament content of a surface (the stand-in subtree excluded). */
function perMeshDraws(root: Object3D, surface: string): Mesh[] {
  return drawObjects(named(root, surface), isStandIn);
}

function standInDraws(root: Object3D, surface: string): Mesh[] | null {
  const standIn = root.getObjectByName(`${surface}-opaque-stand-in`);
  return standIn === undefined ? null : drawObjects(standIn);
}

interface ChandelierParts {
  readonly fittings: Mesh[];
  readonly crystal: Mesh[];
}

function legacyChandelierParts(root: Object3D, declared: ReadonlyMap<Material, OrnamentMaterial>): ChandelierParts {
  const all = drawObjects(named(root, "grand-hall-ornaments"), (object) => SURFACES.some((surface) => surface === object.name))
    .filter((mesh) => mesh.parent?.name === "chandelier");
  const isCrystal = (mesh: Mesh): boolean => declared.get(standardMaterial(mesh))?.transparent === true;
  return { fittings: all.filter((mesh) => !isCrystal(mesh)), crystal: all.filter(isCrystal) };
}

function declaredMaterials(root: Object3D): Map<Material, OrnamentMaterial> {
  const declared = new Map<Material, OrnamentMaterial>();
  for (const mesh of drawObjects(root)) declared.set(standardMaterial(mesh), declaredMaterial(standardMaterial(mesh)));
  return declared;
}

function declaredFor(declared: ReadonlyMap<Material, OrnamentMaterial>, mesh: Mesh): OrnamentMaterial {
  const spec = declared.get(standardMaterial(mesh));
  if (spec === undefined) throw new Error(`No declared material for ${mesh.name}`);
  return spec;
}

const hall = describeGrandHallOrnaments(
  GRAND_HALL_RENDER_DIMENSIONS.width,
  GRAND_HALL_RENDER_DIMENSIONS.length,
  GRAND_HALL_RENDER_DIMENSIONS.height,
);

/**
 * Pieces the description keeps on exact draws, by per-mesh draw index, for a
 * surface name or "chandelier-fittings". The per-mesh order equals the legacy
 * order (first test), so indices line up.
 */
function exactFlags(surface: string): boolean[] {
  if (surface === "chandelier-fittings") {
    return collectOrnamentDraws(hall.chandeliers.map((chandelier) => ({
      kind: "group" as const,
      position: chandelier.placement.position,
      scale: chandelier.placement.scale,
      children: chandelier.fittings,
    }))).map((draw) => draw.exact);
  }
  const found = [...hall.ceiling, ...hall.walls.flatMap((layer) => (layer.kind === "surface" ? [layer] : layer.surfaces)), ...hall.rosette]
    .find((candidate) => candidate.name === surface);
  if (found === undefined) throw new Error(`No described surface ${surface}`);
  return collectOrnamentDraws(found.children).map((draw) => draw.exact);
}

/** The plan three-order rules give for the legacy draws (materials as the legacy JSX declared them). */
function legacyPlan(declared: ReadonlyMap<Material, OrnamentMaterial>, draws: readonly Mesh[], surface: string): ReturnType<typeof planOrnamentBatches> {
  const exact = exactFlags(surface);
  expect(exact).toHaveLength(draws.length);
  return planOrnamentBatches(draws.map((mesh, i) => ({ material: declaredFor(declared, mesh), exact: exact[i] === true })));
}

/** A batch drawn on its original transform must be the legacy draw, bit for bit. */
function expectSameDraw(batch: Mesh, source: Mesh): void {
  expect({ ...meshSignature(batch), name: "" }).toEqual({ ...meshSignature(source), name: "" });
}

interface MountedPair {
  readonly legacy: FrameRoot;
  readonly current: FrameRoot;
  readonly declared: ReadonlyMap<Material, OrnamentMaterial>;
}

/** Legacy and current ornaments at rest: first frame warms the per-mesh trees, second shows stand-ins. */
function mountPair(): MountedPair {
  const legacy = mount(<LegacyGrandHallOrnaments />);
  const current = mount(<GrandHallOrnaments />);
  const declared = declaredMaterials(legacy.scene);
  frames([legacy, current], 2);
  return { legacy, current, declared };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GrandHallOrnaments merged stand-ins", () => {
  it("renders the pre-merge per-mesh tree unchanged for every surface", () => {
    const { legacy, current } = mountPair();
    for (const surface of SURFACES) {
      const legacyDraws = drawObjects(named(legacy.scene, surface));
      const currentDraws = perMeshDraws(current.scene, surface);
      expect(currentDraws.map(meshSignature), surface).toEqual(legacyDraws.map(meshSignature));
    }
  });

  /** Compares each stand-in batch with the legacy draws it replaces; returns how many were baked together. */
  function expectBatchesMatch(label: string, batches: readonly Mesh[], plans: ReturnType<typeof planOrnamentBatches>, legacyDraws: readonly Mesh[]): number {
    expect(batches.length, label).toBe(plans.length);
    let baked = 0;
    plans.forEach((plan, b) => {
      const batch = batches[b];
      if (batch === undefined) throw new Error(`${label} batch ${String(b)} missing`);
      const sources = plan.draws.map((i) => legacyDraws[i]).filter((mesh): mesh is Mesh => mesh !== undefined);
      expect(sources).toHaveLength(plan.draws.length);
      for (const source of sources) {
        expect(materialSignature(standardMaterial(batch)), `${label} batch ${String(b)}`)
          .toEqual(materialSignature(standardMaterial(source)));
        // drei instance colours are white, a no-op multiplier batches omit.
        if (source instanceof InstancedMesh) expect(Array.from(source.instanceColor?.array ?? []).every((v) => v === 1)).toBe(true);
      }
      const onOriginalTransform = !batch.matrixAutoUpdate;
      const lone = sources.length === 1 && !(sources[0] instanceof InstancedMesh);
      expect(onOriginalTransform, `${label} batch ${String(b)} exactness`).toBe(lone);
      const source = sources[0];
      if (onOriginalTransform && source !== undefined) {
        expectSameDraw(batch, source);
      } else {
        expect(batch.matrixWorld.equals(new Matrix4()), `${label} batch ${String(b)} world`).toBe(true);
        expectSameSoup(worldSoup([batch]), worldSoup(sources));
        baked += sources.length;
      }
    });
    return baked;
  }

  it("bakes identical world-space triangles, per surface and material, into each stand-in", () => {
    const { legacy, current, declared } = mountPair();
    let baked = 0;
    for (const surface of SURFACES) {
      const legacyDraws = drawObjects(named(legacy.scene, surface));
      const plans = legacyPlan(declared, legacyDraws, surface);
      const batches = standInDraws(current.scene, surface);
      if (plans.length === legacyDraws.length) {
        // Nothing to merge: the per-mesh tree is drawn at rest, compared above.
        expect(batches, surface).toBeNull();
        continue;
      }
      if (batches === null) throw new Error(`${surface} has no stand-in`);
      baked += expectBatchesMatch(surface, batches, plans, legacyDraws);
    }
    expect(baked).toBeGreaterThan(280);
  });

  it("merges chandelier fittings exactly and keeps blended crystal as separate objects", () => {
    const { legacy, current, declared } = mountPair();
    const parts = legacyChandelierParts(legacy.scene, declared);
    expect(parts.fittings).toHaveLength(18);
    expect(parts.crystal).toHaveLength(6);

    const plans = legacyPlan(declared, parts.fittings, "chandelier-fittings");
    const batches = drawObjects(named(current.scene, "chandelier-fittings"));
    // Rods and roses stay exact (their top caps share a plane); rings, arms and candles merge.
    expect(batches).toHaveLength(8);
    expectBatchesMatch("chandelier-fittings", batches, plans, parts.fittings);

    const crystal = drawObjects(named(current.scene, "grand-hall-ornaments"), (object) => object.name === "chandelier-fittings" || SURFACES.some((surface) => surface === object.name))
      .filter((mesh) => mesh.parent?.name === "chandelier");
    expect(crystal.map(meshSignature)).toEqual(parts.crystal.map(meshSignature));
  });

  it("keeps every draw on the same side of each depth-write-disabled pane in three's opaque order", () => {
    const { legacy, current, declared } = mountPair();

    // Map each legacy draw to the object that draws it now.
    const drawnBy = new Map<Mesh, Mesh>();
    for (const surface of SURFACES) {
      const legacyDraws = drawObjects(named(legacy.scene, surface));
      const batches = standInDraws(current.scene, surface);
      if (batches === null) {
        perMeshDraws(current.scene, surface).forEach((mesh, i) => {
          const source = legacyDraws[i];
          if (source !== undefined) drawnBy.set(source, mesh);
        });
        continue;
      }
      legacyPlan(declared, legacyDraws, surface).forEach((plan, b) => {
        for (const i of plan.draws) {
          const source = legacyDraws[i];
          const batch = batches[b];
          if (source !== undefined && batch !== undefined) drawnBy.set(source, batch);
        }
      });
    }
    const fittings = legacyChandelierParts(legacy.scene, declared).fittings;
    const fittingBatches = drawObjects(named(current.scene, "chandelier-fittings"));
    legacyPlan(declared, fittings, "chandelier-fittings").forEach((plan, b) => {
      for (const i of plan.draws) {
        const source = fittings[i];
        const batch = fittingBatches[b];
        if (source !== undefined && batch !== undefined) drawnBy.set(source, batch);
      }
    });

    // three sorts opaque draws by material id (render/group order are all 0 here).
    const opaqueOrder = (root: Object3D): Map<Mesh, number> => new Map(
      visibleDraws(root)
        .filter((mesh) => !standardMaterial(mesh).transparent)
        .sort((a, b) => materialId(standardMaterial(a)) - materialId(standardMaterial(b)))
        .map((mesh, position) => [mesh, position]),
    );
    const legacyOrder = opaqueOrder(legacy.scene);
    const currentOrder = opaqueOrder(current.scene);

    const barriers = [...legacyOrder.keys()].filter((mesh) => !standardMaterial(mesh).depthWrite);
    expect(barriers).toHaveLength(12);
    let checkedPairs = 0;
    for (const barrier of barriers) {
      const barrierNow = drawnBy.get(barrier);
      const barrierBefore = legacyOrder.get(barrier);
      if (barrierNow === undefined || barrierBefore === undefined) throw new Error("Unmapped barrier");
      for (const [other, before] of legacyOrder) {
        const otherNow = drawnBy.get(other);
        if (otherNow === undefined) throw new Error(`Unmapped draw ${other.name}`);
        if (other === barrier || otherNow === barrierNow) continue;
        const now = currentOrder.get(otherNow);
        const barrierPosition = currentOrder.get(barrierNow);
        if (now === undefined || barrierPosition === undefined) throw new Error(`Draw ${other.name} is not drawn opaque now`);
        expect(Math.sign(now - barrierPosition), `${other.name} vs ${barrier.name}`).toBe(Math.sign(before - barrierBefore));
        checkedPairs += 1;
      }
    }
    expect(checkedPairs).toBeGreaterThan(4000);
  });

  it("issues a fraction of the draw calls for the same content", () => {
    const { legacy, current } = mountPair();
    expect(visibleDraws(legacy.scene)).toHaveLength(391);
    expect(visibleDraws(current.scene)).toHaveLength(133);

    // Default planner view: ceiling hidden, chandeliers still hung.
    act(() => { useVisibilityStore.setState({ ceiling: false }); });
    frames([legacy, current], 1);
    expect(visibleDraws(legacy.scene)).toHaveLength(359);
    expect(visibleDraws(current.scene)).toHaveLength(119);
  });

  it("draws the per-mesh tree on a surface's first visible frame, then the stand-in", () => {
    const current = mount(<GrandHallOrnaments />);
    frames([current], 1);
    expect(named(current.scene, "frieze-back-per-mesh").visible).toBe(true);
    expect(named(current.scene, "frieze-back-opaque-stand-in").visible).toBe(false);
    const requested = current.invalidations();
    frames([current], 1);
    expect(named(current.scene, "frieze-back-per-mesh").visible).toBe(false);
    expect(named(current.scene, "frieze-back-opaque-stand-in").visible).toBe(true);
    // Settled: no surface keeps requesting frames.
    frames([current], 3);
    expect(current.invalidations()).toBe(requested);
  });
});

describe("GrandHallOrnaments fades, clicked walls, x-ray and sections", () => {
  /** What a surface draws: nothing, its per-mesh tree, or its stand-in. */
  function drawnRepresentation(root: Object3D, surface: string): "hidden" | "per-mesh" | "stand-in" {
    const group = named(root, surface);
    if (!group.visible) return "hidden";
    const standIn = root.getObjectByName(`${surface}-opaque-stand-in`);
    return standIn?.visible === true ? "stand-in" : "per-mesh";
  }

  function expectSameDrawing(legacy: FrameRoot, current: FrameRoot, surfaces: readonly string[] = SURFACES): void {
    for (const surface of surfaces) {
      const legacyGroup = named(legacy.scene, surface);
      const legacyDraws = drawObjects(legacyGroup);
      const blended = legacyDraws.some((mesh) => standardMaterial(mesh).transparent);
      const representation = drawnRepresentation(current.scene, surface);
      if (!legacyGroup.visible) {
        expect(representation, surface).toBe("hidden");
        continue;
      }
      if (blended || standInDraws(current.scene, surface) === null) {
        // Blended surfaces sort per object: the exact pre-merge meshes must draw.
        expect(representation, surface).toBe("per-mesh");
        expect(visibleDraws(named(current.scene, surface)).map(meshSignature), surface)
          .toEqual(visibleDraws(legacyGroup).map(meshSignature));
      } else {
        expect(representation, surface).toBe("stand-in");
      }
      // Surface opacity reaches every material of both representations.
      const first = legacyDraws[0];
      if (first === undefined) throw new Error(`${surface} has no draws`);
      const expected = materialSignature(standardMaterial(first));
      for (const mesh of drawObjects(named(current.scene, surface))) {
        const signature = materialSignature(standardMaterial(mesh));
        expect([signature.opacity, signature.transparent], `${surface} ${mesh.name}`).toEqual([expected.opacity, expected.transparent]);
      }
    }
  }

  it("draws a camera-faded wall exactly as before and returns to the stand-in when opaque", () => {
    const { legacy, current } = mountPair();
    act(() => {
      useVisibilityStore.setState({ wallOpacity: { ...useVisibilityStore.getState().wallOpacity, "wall-back": 0.5 } });
    });
    frames([legacy, current], 2);
    expect(drawnRepresentation(current.scene, "window-wall-ornament-cluster")).toBe("per-mesh");
    expectSameDrawing(legacy, current);

    act(() => {
      useVisibilityStore.setState({ wallOpacity: { ...useVisibilityStore.getState().wallOpacity, "wall-back": 0 } });
    });
    frames([legacy, current], 1);
    expect(drawnRepresentation(current.scene, "window-wall-ornament-cluster")).toBe("hidden");
    expectSameDrawing(legacy, current);

    act(() => {
      useVisibilityStore.setState({ wallOpacity: { ...useVisibilityStore.getState().wallOpacity, "wall-back": 1 } });
    });
    frames([legacy, current], 1);
    expect(drawnRepresentation(current.scene, "window-wall-ornament-cluster")).toBe("stand-in");
    expectSameDrawing(legacy, current);
  });

  it("animates a clicked-open wall frame for frame like the pre-merge ornaments", () => {
    const { legacy, current } = mountPair();
    act(() => { useVisibilityStore.getState().toggleWall("wall-front"); });
    for (let step = 0; step < 12; step++) {
      frames([legacy, current], 1, 0.05);
      expect(drawnRepresentation(current.scene, "opposite-long-wall-three-door-cluster")).toBe("per-mesh");
      expectSameDrawing(legacy, current);
    }
    // Rebuilding the wall runs the same assembly back to opaque.
    act(() => { useVisibilityStore.getState().toggleWall("wall-front"); });
    frames([legacy, current], 200, 0.05);
    expectSameDrawing(legacy, current);
    expect(drawnRepresentation(current.scene, "opposite-long-wall-three-door-cluster")).toBe("stand-in");
  });

  it("draws x-ray ghosting through the per-mesh trees on every surface", () => {
    const { legacy, current } = mountPair();
    act(() => { useXrayStore.setState({ enabled: true, opacity: 0.15 }); });
    frames([legacy, current], 1);
    for (const surface of SURFACES) expect(drawnRepresentation(current.scene, surface), surface).toBe("per-mesh");
    expectSameDrawing(legacy, current);
  });

  it("hides and restores the ceiling ornaments with the ceiling toggle", () => {
    const { legacy, current } = mountPair();
    act(() => { useVisibilityStore.getState().toggleCeiling(); });
    frames([legacy, current], 1);
    expect(drawnRepresentation(current.scene, "grand-hall-ceiling-ornaments")).toBe("hidden");
    expectSameDrawing(legacy, current);
    act(() => { useVisibilityStore.getState().toggleCeiling(); });
    frames([legacy, current], 2);
    expect(drawnRepresentation(current.scene, "grand-hall-ceiling-rosette")).toBe("stand-in");
    expectSameDrawing(legacy, current);
  });

  it("applies the section-height rules to both representations", () => {
    const { legacy, current } = mountPair();
    const present = (root: Object3D): string[] => [
      ...SURFACES.filter((surface) => root.getObjectByName(surface) !== undefined),
      ...(root.getObjectByName("chandelier") === undefined ? [] : ["chandelier"]),
    ];
    for (const height of [2.4, 3.19, 3.2, 6.8, 6.88, 7]) {
      act(() => { useSectionStore.getState().setHeight(height); });
      frames([legacy, current], 2);
      expect(present(current.scene), String(height)).toEqual(present(legacy.scene));
      expect(current.scene.getObjectByName("chandelier-fittings") !== undefined, String(height))
        .toBe(legacy.scene.getObjectByName("chandelier") !== undefined);
    }
    expect(present(current.scene)).toHaveLength(SURFACES.length + 1);
    expectSameDrawing(legacy, current);
  });

  it("raycasts the per-mesh ornaments exactly as before and never the stand-ins", () => {
    const { legacy, current } = mountPair();
    const hits = (root: Object3D, origin: Vector3, direction: Vector3): [string, number][] =>
      new Raycaster(origin, direction.normalize()).intersectObject(root, true)
        .map((hit): [string, number] => [hit.object.name, Number(hit.distance.toFixed(9))]);
    const rays: [Vector3, Vector3][] = [
      [new Vector3(0.3, 3, 0), new Vector3(0, 0, -1)], // centre window glass and daylight
      [new Vector3(-6, 5.3, -3), new Vector3(-0.2, 0, -1)], // frieze figures behind a window
      [new Vector3(0.4, 1.2, 0), new Vector3(0, 0, 1)], // opposite-wall door leaves
      [new Vector3(0, 1, 0), new Vector3(-1, -0.05, 0.02)], // fireplace
    ];
    for (const [origin, direction] of rays) {
      const before = hits(legacy.scene, origin, direction.clone());
      expect(before.length).toBeGreaterThan(0);
      expect(hits(current.scene, origin, direction.clone())).toEqual(before);
    }
  });
});

describe("GrandHallOrnaments stand-in lifetime", () => {
  it("rebuilds merged geometry only for new dimensions and releases it on unmount", () => {
    const current = mount(<GrandHallOrnaments width={21} length={10.5} height={7} />);
    frames([current], 2);
    const before = standInDraws(current.scene, "frieze-back") ?? [];
    expect(before.length).toBeGreaterThan(0);
    const geometries = before.map((mesh) => mesh.geometry);
    const materials = before.map(standardMaterial);
    const geometryDisposals = geometries.map((geometry) => vi.spyOn(geometry, "dispose"));

    current.rerender(<GrandHallOrnaments width={21} length={10.5} height={7} />);
    frames([current], 1);
    expect((standInDraws(current.scene, "frieze-back") ?? []).map((mesh) => mesh.geometry)).toEqual(geometries);

    current.rerender(<GrandHallOrnaments width={20} length={10.5} height={7} />);
    frames([current], 1);
    const resized = standInDraws(current.scene, "frieze-back") ?? [];
    expect(resized.map((mesh) => mesh.geometry).some((geometry) => geometries.includes(geometry))).toBe(false);
    // Materials keep their identity (and so their place in three's opaque order).
    expect(resized.map(standardMaterial)).toEqual(materials);
    for (const dispose of geometryDisposals) expect(dispose).toHaveBeenCalledTimes(1);

    const materialDisposals = materials.map((material) => vi.spyOn(material, "dispose"));
    const resizedDisposals = resized.map((mesh) => vi.spyOn(mesh.geometry, "dispose"));
    current.unmount();
    mounted = mounted.filter((root) => root !== current);
    for (const dispose of [...materialDisposals, ...resizedDisposals]) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("releases the materials of batches a resized model no longer has, once", () => {
    const current = mount(<GrandHallOrnaments width={21} length={10.5} height={7} />);
    frames([current], 2);
    const batchMaterials = (): MeshStandardMaterial[] => {
      const out: MeshStandardMaterial[] = [];
      current.scene.traverse((object) => {
        if (isStandIn(object) || object.name === "chandelier-fittings") out.push(...drawObjects(object).map(standardMaterial));
      });
      return out;
    };
    const disposals = new Map<Material, number>();
    const track = (materials: readonly Material[]): void => {
      for (const material of materials) {
        if (disposals.has(material)) continue;
        disposals.set(material, 0);
        material.addEventListener("dispose", () => { disposals.set(material, (disposals.get(material) ?? 0) + 1); });
      }
    };
    const before = batchMaterials();
    track(before);

    // A narrower hall changes which pieces keep exact draws, so some batches change.
    current.rerender(<GrandHallOrnaments width={16} length={10.5} height={7} />);
    frames([current], 2);
    const after = batchMaterials();
    track(after);
    const dropped = before.filter((material) => !after.includes(material));
    expect(dropped.length).toBeGreaterThan(0);
    expect(after.filter((material) => before.includes(material)).length).toBeGreaterThan(0);
    for (const material of dropped) expect(disposals.get(material), material.name).toBe(1);
    for (const material of after) expect(disposals.get(material), material.name).toBe(0);

    current.unmount();
    mounted = mounted.filter((root) => root !== current);
    expect([...disposals.values()].every((count) => count === 1)).toBe(true);
  });
});
