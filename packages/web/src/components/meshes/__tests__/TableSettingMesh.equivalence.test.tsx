import { useMemo, type ReactElement, type ReactNode } from "react";
import {
  Frustum,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Vector3,
  Vector4,
  type BufferGeometry,
  type Camera,
  type Material,
  type Mesh,
  type Object3D,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toRenderSpace } from "../../../constants/scale.js";
import { getCatalogueItemBySlug, type CatalogueItem } from "../../../lib/catalogue.js";
import { noClipPlanes } from "../../SectionPlane.js";
import { TableSettingMesh } from "../TableSettingMesh.js";
import {
  TableSettingResourcesContext,
  useOwnedTableSettingResources,
  type TableSettingResources,
} from "../table-setting-resources.js";
import { tableSettingLayout } from "../table-setting-layout.js";
import { mountTestRoot, type TestRoot } from "./r3f-test-root.js";

// ---------------------------------------------------------------------------
// The pre-change implementation (d7eb71b), frozen verbatim as the reference:
// one geometry and one material per part per cover.
// ---------------------------------------------------------------------------

interface LegacyPlaceSetting {
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
}

function legacyNormalizeSettingCount(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Math.max(1, Math.min(48, Math.round(value)));
}

function legacyRoundSettings(tableItem: CatalogueItem, settingsCount: number | undefined): readonly LegacyPlaceSetting[] {
  const count = legacyNormalizeSettingCount(settingsCount, 10);
  const radius = toRenderSpace(tableItem.width) * 0.34;
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      rotationY: -angle + Math.PI / 2,
    };
  });
}

function legacyRectSettings(tableItem: CatalogueItem, settingsCount: number | undefined): readonly LegacyPlaceSetting[] {
  const length = toRenderSpace(tableItem.width);
  const depth = toRenderSpace(tableItem.depth);
  const fallbackCount = Math.max(4, Math.min(12, Math.round(length / 0.55) * 2));
  const count = legacyNormalizeSettingCount(settingsCount, fallbackCount);
  const perSide = Math.max(1, Math.ceil(count / 2));
  const insetX = length * 0.36;
  const sideZ = depth * 0.25;
  const settings: LegacyPlaceSetting[] = [];
  for (let i = 0; i < perSide; i++) {
    const t = perSide === 1 ? 0.5 : i / (perSide - 1);
    const x = -insetX + t * insetX * 2;
    if (settings.length < count) settings.push({ x, z: -sideZ, rotationY: 0 });
    if (settings.length < count) settings.push({ x, z: sideZ, rotationY: Math.PI });
  }
  return settings;
}

function LegacyTableSettingMesh({
  tableItem,
  opacity = 1,
  settingsCount,
}: {
  readonly tableItem: CatalogueItem;
  readonly opacity?: number;
  readonly settingsCount?: number;
}): ReactElement {
  const settings = useMemo(
    () => tableItem.tableShape === "round"
      ? legacyRoundSettings(tableItem, settingsCount)
      : legacyRectSettings(tableItem, settingsCount),
    [settingsCount, tableItem],
  );
  const y = tableItem.height + 0.032;

  return (
    <group name="table-setting-dinner">
      {settings.map((setting, index) => (
        <group
          key={`${String(index)}-${String(setting.x)}-${String(setting.z)}`}
          position={[setting.x, y, setting.z]}
          rotation={[0, setting.rotationY, 0]}
        >
          <mesh renderOrder={6}>
            <cylinderGeometry args={[0.115, 0.115, 0.012, 36]} />
            <meshStandardMaterial
              color="#f8f3e8"
              roughness={0.56}
              metalness={0.03}
              transparent
              opacity={opacity}
              clippingPlanes={noClipPlanes}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} renderOrder={7}>
            <torusGeometry args={[0.094, 0.004, 8, 36]} />
            <meshStandardMaterial
              color="#d7b75a"
              roughness={0.42}
              metalness={0.35}
              transparent
              opacity={opacity * 0.9}
              clippingPlanes={noClipPlanes}
            />
          </mesh>
          <mesh position={[0.115, 0.07, -0.03]} renderOrder={7}>
            <cylinderGeometry args={[0.026, 0.021, 0.105, 20]} />
            <meshPhysicalMaterial
              color="#cfe7ff"
              roughness={0.08}
              metalness={0}
              transparent
              opacity={opacity * 0.38}
              transmission={0.45}
              thickness={0.04}
              clippingPlanes={noClipPlanes}
            />
          </mesh>
          <mesh position={[-0.15, 0.014, 0]} rotation={[0, 0, 0]} renderOrder={7}>
            <boxGeometry args={[0.018, 0.012, 0.22]} />
            <meshStandardMaterial
              color="#d9d1bf"
              roughness={0.28}
              metalness={0.72}
              transparent
              opacity={opacity * 0.86}
              clippingPlanes={noClipPlanes}
            />
          </mesh>
          <mesh position={[0.15, 0.014, 0.015]} renderOrder={7}>
            <boxGeometry args={[0.018, 0.012, 0.19]} />
            <meshStandardMaterial
              color="#d9d1bf"
              roughness={0.28}
              metalness={0.72}
              transparent
              opacity={opacity * 0.86}
              clippingPlanes={noClipPlanes}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Fixtures and scene inspection
// ---------------------------------------------------------------------------

function catalogueItem(slug: string): CatalogueItem {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`missing fixture ${slug}`);
  return item;
}

const ROUND = catalogueItem("round-table-6ft");
const TRESTLE = catalogueItem("trestle-6ft");
const SHORT_TRESTLE = catalogueItem("trestle-4ft");
/** A dining table without a declared shape takes the rectangular layout. */
const UNSHAPED: CatalogueItem = { ...TRESTLE, id: "unshaped-dining-table", tableShape: null };

interface TablePose {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotationY: number;
  readonly scale: number;
}

const ORIGIN: TablePose = { id: "origin", x: 0, y: 0, z: 0, rotationY: 0, scale: 1 };

const POSES: readonly TablePose[] = [
  ORIGIN,
  { id: "turned", x: 3.2, y: 0, z: -7.5, rotationY: 0.7, scale: 1 },
  { id: "raised", x: -12.25, y: 0.3, z: 4.1, rotationY: -2.4, scale: 1.35 },
  { id: "reversed", x: 5, y: 0, z: 5, rotationY: Math.PI, scale: 0.6 },
];

interface CoverCase {
  readonly name: string;
  readonly tableItem: CatalogueItem;
  readonly settingsCount: number | undefined;
}

const CASES: readonly CoverCase[] = [
  { name: "round default", tableItem: ROUND, settingsCount: undefined },
  { name: "round 10", tableItem: ROUND, settingsCount: 10 },
  { name: "round 7.4 rounds to 7", tableItem: ROUND, settingsCount: 7.4 },
  { name: "round 1", tableItem: ROUND, settingsCount: 1 },
  { name: "round 60 clamps to 48", tableItem: ROUND, settingsCount: 60 },
  { name: "trestle default", tableItem: TRESTLE, settingsCount: undefined },
  { name: "trestle odd 5", tableItem: TRESTLE, settingsCount: 5 },
  { name: "short trestle 8", tableItem: SHORT_TRESTLE, settingsCount: 8 },
  { name: "unshaped 3", tableItem: UNSHAPED, settingsCount: 3 },
];

function PosedTable({ pose, children }: { readonly pose: TablePose; readonly children: ReactNode }): ReactElement {
  // PlacedFurnitureItem's structure: the pick-resolving furniture group, then
  // the table transform the covers are drawn in.
  return (
    <group name={`furniture-${pose.id}`}>
      <group position={[pose.x, pose.y, pose.z]} rotation={[0, pose.rotationY, 0]} scale={pose.scale}>
        {children}
      </group>
    </group>
  );
}

interface ResourceCapture {
  current: TableSettingResources | null;
}

function capturedResources(capture: ResourceCapture): TableSettingResources {
  if (capture.current === null) throw new Error("no layout resources");
  return capture.current;
}

function resourceParts(
  resources: TableSettingResources,
): readonly { readonly geometry: BufferGeometry; readonly material: Material }[] {
  return [resources.plate, resources.rim, resources.glass, resources.knife, resources.fork];
}

/** PlacedFurniture's role: own one set for the layout and provide it to every table. */
function LayoutResources({
  capture,
  children,
}: {
  readonly capture?: ResourceCapture;
  readonly children: ReactNode;
}): ReactElement {
  const resources = useOwnedTableSettingResources(1);
  if (capture !== undefined) capture.current = resources;
  return <TableSettingResourcesContext.Provider value={resources}>{children}</TableSettingResourcesContext.Provider>;
}

const PART_NAMES = ["plate", "rim", "glass", "knife", "fork"] as const;

function isMesh(object: Object3D): object is Mesh {
  return (object as { readonly isMesh?: boolean }).isMesh === true;
}

function furnitureName(object: Object3D): string {
  let current: Object3D | null = object;
  while (current !== null) {
    if (current.name.startsWith("furniture-")) return current.name;
    current = current.parent;
  }
  return "(none)";
}

/** `furniture-id/setting/part` for a cover mesh, otherwise the object's own name. */
function labelOf(object: Object3D): string {
  const setting = object.parent;
  const dinner = setting?.parent ?? null;
  if (setting === null || dinner === null || dinner.name !== "table-setting-dinner") {
    return object.name.length > 0 ? object.name : object.type;
  }
  const part = PART_NAMES[setting.children.indexOf(object)] ?? "unknown";
  return `${furnitureName(dinner)}/${String(dinner.children.indexOf(setting))}/${part}`;
}

interface CoverMesh {
  readonly label: string;
  readonly mesh: Mesh;
}

function coverMeshes(root: Object3D): readonly CoverMesh[] {
  root.updateMatrixWorld(true);
  const covers: CoverMesh[] = [];
  root.traverse((object) => {
    if (object.name !== "table-setting-dinner") return;
    for (const setting of object.children) {
      expect(setting.type).toBe("Group");
      expect(setting.children).toHaveLength(PART_NAMES.length);
      for (const part of setting.children) {
        if (!isMesh(part)) throw new Error(`cover part ${part.type} is not a mesh`);
        covers.push({ label: labelOf(part), mesh: part });
      }
    }
  });
  return covers;
}

function maxAbsDifference(a: readonly number[], b: readonly number[]): number {
  expect(a).toHaveLength(b.length);
  let max = 0;
  for (let i = 0; i < a.length; i += 1) max = Math.max(max, Math.abs((a[i] ?? Number.NaN) - (b[i] ?? Number.NaN)));
  return max;
}

function geometryParameters(geometry: BufferGeometry): unknown {
  return { type: geometry.type, parameters: (geometry as { readonly parameters?: unknown }).parameters };
}

function geometryBuffers(geometry: BufferGeometry): unknown {
  const attributes: Record<string, readonly number[]> = {};
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    attributes[name] = Array.from(attribute.array);
  }
  return {
    index: geometry.index === null ? null : Array.from(geometry.index.array),
    attributes,
    groups: geometry.groups,
  };
}

function materialSignature(material: Material): unknown {
  const { uuid: _uuid, ...json } = material.toJSON();
  return {
    json,
    type: material.type,
    transparent: material.transparent,
    opacity: material.opacity,
    depthWrite: material.depthWrite,
    depthTest: material.depthTest,
    side: material.side,
    blending: material.blending,
    unclipped: material.clippingPlanes === noClipPlanes,
    clipIntersection: material.clipIntersection,
    clipShadows: material.clipShadows,
    standard: material instanceof MeshStandardMaterial
      ? { color: material.color.toArray(), roughness: material.roughness, metalness: material.metalness }
      : null,
    physical: material instanceof MeshPhysicalMaterial
      ? { transmission: material.transmission, thickness: material.thickness, ior: material.ior }
      : null,
  };
}

function singleMaterial(mesh: Mesh): Material {
  const { material } = mesh;
  if (Array.isArray(material)) throw new Error("cover meshes use one material");
  return material;
}

interface RenderItem {
  readonly label: string;
  readonly groupOrder: number;
  readonly renderOrder: number;
  readonly z: number;
  readonly id: number;
}

/**
 * The native renderer's projection pass and transparent sort
 * (three r186 Renderer._projectObject + RenderList reversePainterSortStable):
 * frustum-culled, keyed by group order, render order, clip-space depth of the
 * geometry's bounding-sphere centre (back to front), then object id.
 */
function transparentDrawOrder(root: Object3D, camera: Camera): readonly string[] {
  root.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  const projScreen = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new Frustum().setFromProjectionMatrix(projScreen);
  const items: RenderItem[] = [];
  const project = (object: Object3D, inheritedGroupOrder: number): void => {
    if (!object.visible) return;
    let groupOrder = inheritedGroupOrder;
    if ((object as { readonly isGroup?: boolean }).isGroup === true) {
      groupOrder = object.renderOrder;
    } else if (isMesh(object) && (!object.frustumCulled || frustum.intersectsObject(object))) {
      const material = singleMaterial(object);
      expect(material.transparent).toBe(true);
      const { geometry } = object;
      if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
      const center = geometry.boundingSphere?.center ?? new Vector3();
      const clip = new Vector4(center.x, center.y, center.z, 1).applyMatrix4(object.matrixWorld).applyMatrix4(projScreen);
      items.push({ label: labelOf(object), groupOrder, renderOrder: object.renderOrder, z: clip.z, id: object.id });
    }
    for (const child of object.children) project(child, groupOrder);
  };
  project(root, 0);
  items.sort((a, b) => (
    a.groupOrder !== b.groupOrder ? a.groupOrder - b.groupOrder
      : a.renderOrder !== b.renderOrder ? a.renderOrder - b.renderOrder
        : a.z !== b.z ? b.z - a.z
          : a.id - b.id
  ));
  return items.map((item) => item.label);
}

interface HitSignature {
  readonly label: string;
  readonly distance: number;
  readonly faceIndex: number | null | undefined;
}

function rayHits(root: Object3D, origin: Vector3, target: Vector3): readonly HitSignature[] {
  // Picking reads the world matrices of the last rendered frame.
  root.updateMatrixWorld(true);
  const raycaster = new Raycaster(origin, target.clone().sub(origin).normalize());
  return raycaster.intersectObject(root, true).map((hit) => ({
    label: labelOf(hit.object),
    distance: hit.distance,
    faceIndex: hit.faceIndex,
  }));
}

function camerasAround(pose: TablePose, tableItem: CatalogueItem): readonly Camera[] {
  const target = new Vector3(pose.x, pose.y + tableItem.height * pose.scale, pose.z);
  const perspective = (dx: number, dy: number, dz: number): Camera => {
    const camera = new PerspectiveCamera(55, 1.6, 0.1, 200);
    camera.position.set(pose.x + dx, pose.y + dy, pose.z + dz);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    return camera;
  };
  const top = new OrthographicCamera(-3, 3, 3, -3, 0.1, 200);
  top.position.set(pose.x, 50, pose.z);
  top.lookAt(pose.x, 0, pose.z);
  top.updateProjectionMatrix();
  return [
    perspective(7, 9, 8), // planner orbit
    perspective(-2.2, 1.9, 1.4), // close oblique
    perspective(9, 1.6, -3), // walk-mode eye height, grazing the covers
    perspective(0.01, 12, 0), // near top-down
    perspective(0.4, 0.95, 0.3), // inside the cover field
    top,
  ];
}

let roots: TestRoot[] = [];

function mount(element: ReactElement): TestRoot {
  const root = mountTestRoot(element);
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots) root.unmount();
  roots = [];
  vi.restoreAllMocks();
});

describe("table setting layout", () => {
  it("is the pre-change layout for every table shape and count", () => {
    for (const { tableItem, settingsCount } of CASES) {
      const legacy = tableItem.tableShape === "round"
        ? legacyRoundSettings(tableItem, settingsCount)
        : legacyRectSettings(tableItem, settingsCount);
      expect(tableSettingLayout(tableItem, settingsCount)).toEqual(legacy);
    }
    expect(tableSettingLayout(ROUND, 60)).toHaveLength(48);
    expect(tableSettingLayout(TRESTLE, undefined)).toHaveLength(6);
  });
});

describe("TableSettingMesh equivalence with the per-cover implementation", () => {
  it("builds the same scene graph, world matrices, geometry and materials", () => {
    for (const cover of CASES) {
      for (const pose of POSES) {
        const legacy = mount(
          <PosedTable pose={pose}><LegacyTableSettingMesh tableItem={cover.tableItem} settingsCount={cover.settingsCount} /></PosedTable>,
        );
        const current = mount(
          <LayoutResources>
            <PosedTable pose={pose}><TableSettingMesh tableItem={cover.tableItem} settingsCount={cover.settingsCount} /></PosedTable>
          </LayoutResources>,
        );
        const before = coverMeshes(legacy.scene);
        const after = coverMeshes(current.scene);
        const expectedCovers = tableSettingLayout(cover.tableItem, cover.settingsCount).length * PART_NAMES.length;
        expect(before, cover.name).toHaveLength(expectedCovers);
        expect(after.map(({ label }) => label)).toEqual(before.map(({ label }) => label));
        for (let i = 0; i < before.length; i += 1) {
          const old = before[i];
          const next = after[i];
          if (old === undefined || next === undefined) throw new Error("cover pairing failed");
          // Bit-identical transforms, not merely within tolerance.
          expect(maxAbsDifference(next.mesh.matrixWorld.elements, old.mesh.matrixWorld.elements), old.label).toBe(0);
          expect(next.mesh.renderOrder, old.label).toBe(old.mesh.renderOrder);
          expect(next.mesh.visible).toBe(old.mesh.visible);
          expect(next.mesh.frustumCulled).toBe(old.mesh.frustumCulled);
          expect(next.mesh.castShadow).toBe(old.mesh.castShadow);
          expect(next.mesh.receiveShadow).toBe(old.mesh.receiveShadow);
          expect(next.mesh.layers.mask).toBe(old.mesh.layers.mask);
          expect(geometryParameters(next.mesh.geometry), old.label).toEqual(geometryParameters(old.mesh.geometry));
          expect(materialSignature(singleMaterial(next.mesh)), old.label).toEqual(materialSignature(singleMaterial(old.mesh)));
        }
        roots.splice(0).forEach((root) => { root.unmount(); });
      }
    }
  });

  it("uses bit-identical geometry buffers for every part", () => {
    const legacy = mount(<PosedTable pose={ORIGIN}><LegacyTableSettingMesh tableItem={ROUND} settingsCount={1} /></PosedTable>);
    const current = mount(
      <LayoutResources><PosedTable pose={ORIGIN}><TableSettingMesh tableItem={ROUND} settingsCount={1} /></PosedTable></LayoutResources>,
    );
    const before = coverMeshes(legacy.scene);
    const after = coverMeshes(current.scene);
    expect(after).toHaveLength(PART_NAMES.length);
    after.forEach(({ mesh }, index) => {
      const old = before[index];
      if (old === undefined) throw new Error("missing legacy part");
      expect(geometryBuffers(mesh.geometry)).toEqual(geometryBuffers(old.mesh.geometry));
    });
  });

  it("keeps the renderer's transparent draw order and culling from every view", () => {
    for (const cover of [CASES[1], CASES[4], CASES[6]]) {
      if (cover === undefined) throw new Error("missing case");
      for (const pose of POSES) {
        const legacy = mount(
          <PosedTable pose={pose}><LegacyTableSettingMesh tableItem={cover.tableItem} settingsCount={cover.settingsCount} /></PosedTable>,
        );
        const current = mount(
          <LayoutResources>
            <PosedTable pose={pose}><TableSettingMesh tableItem={cover.tableItem} settingsCount={cover.settingsCount} /></PosedTable>
          </LayoutResources>,
        );
        for (const camera of camerasAround(pose, cover.tableItem)) {
          const expected = transparentDrawOrder(legacy.scene, camera);
          expect(expected.length).toBeGreaterThan(0);
          expect(transparentDrawOrder(current.scene, camera), `${cover.name} ${pose.id}`).toEqual(expected);
        }
        roots.splice(0).forEach((root) => { root.unmount(); });
      }
    }
  });

  it("returns identical raycast hits, so picking still resolves every cover to its table", () => {
    for (const cover of [CASES[1], CASES[6]]) {
      if (cover === undefined) throw new Error("missing case");
      for (const pose of POSES) {
        const legacy = mount(
          <PosedTable pose={pose}><LegacyTableSettingMesh tableItem={cover.tableItem} settingsCount={cover.settingsCount} /></PosedTable>,
        );
        const current = mount(
          <LayoutResources>
            <PosedTable pose={pose}><TableSettingMesh tableItem={cover.tableItem} settingsCount={cover.settingsCount} /></PosedTable>
          </LayoutResources>,
        );
        const covers = coverMeshes(legacy.scene);
        const targets = [0, Math.floor(covers.length / 2), covers.length - 3]
          .map((index) => covers[index]?.mesh.getWorldPosition(new Vector3()))
          .filter((point): point is Vector3 => point !== undefined);
        let coverHits = 0;
        for (const elevation of [3, 10, 25, 50, 85]) {
          for (let azimuth = 0; azimuth < 360; azimuth += 30) {
            const e = (elevation * Math.PI) / 180;
            const a = (azimuth * Math.PI) / 180;
            for (const target of targets) {
              const origin = target.clone().add(new Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)).multiplyScalar(4));
              const expected = rayHits(legacy.scene, origin, target);
              expect(rayHits(current.scene, origin, target)).toEqual(expected);
              coverHits += expected.length;
              for (const hit of expected) expect(hit.label.startsWith(`furniture-${pose.id}/`)).toBe(true);
            }
          }
        }
        expect(coverHits).toBeGreaterThan(0);
        roots.splice(0).forEach((root) => { root.unmount(); });
      }
    }
  });
});

describe("TableSettingMesh shared resources", () => {
  it("draws every cover of every table from one geometry and one material per part", () => {
    const pose = (id: string, x: number): TablePose => ({ id, x, y: 0, z: 0, rotationY: x / 7, scale: 1 });
    const tables = Array.from({ length: 6 }, (_, index) => pose(`t${String(index)}`, index * 3));
    const legacy = mount(
      <>{tables.map((table) => <PosedTable key={table.id} pose={table}><LegacyTableSettingMesh tableItem={ROUND} settingsCount={10} /></PosedTable>)}</>,
    );
    const capture: ResourceCapture = { current: null };
    const current = mount(
      <LayoutResources capture={capture}>
        {tables.map((table) => <PosedTable key={table.id} pose={table}><TableSettingMesh tableItem={ROUND} settingsCount={10} /></PosedTable>)}
      </LayoutResources>,
    );
    const before = coverMeshes(legacy.scene);
    const after = coverMeshes(current.scene);
    expect(after).toHaveLength(6 * 10 * 5);
    expect(new Set(before.map(({ mesh }) => mesh.geometry)).size).toBe(300);
    expect(new Set(before.map(({ mesh }) => singleMaterial(mesh))).size).toBe(300);
    expect(new Set(after.map(({ mesh }) => mesh.geometry)).size).toBe(5);
    expect(new Set(after.map(({ mesh }) => singleMaterial(mesh))).size).toBe(5);
    const parts = resourceParts(capturedResources(capture));
    after.forEach(({ mesh }, index) => {
      const part = parts[index % PART_NAMES.length];
      expect(mesh.geometry).toBe(part?.geometry);
      expect(mesh.material).toBe(part?.material);
    });
  });

  it("keeps meshes, geometries and materials while a table is dragged, and follows the pose", () => {
    const start: TablePose = { id: "dragged", x: 1, y: 0, z: 2, rotationY: 0.3, scale: 1.1 };
    const element = (pose: TablePose): ReactElement => (
      <LayoutResources>
        <PosedTable pose={pose}><TableSettingMesh tableItem={ROUND} settingsCount={10} /></PosedTable>
      </LayoutResources>
    );
    const current = mount(element(start));
    const initial = coverMeshes(current.scene);
    const identities = initial.map(({ mesh }) => [mesh, mesh.geometry, mesh.material] as const);
    for (let step = 1; step <= 5; step += 1) {
      const moved: TablePose = { ...start, x: start.x + step * 0.37, z: start.z - step * 0.21, rotationY: start.rotationY + step * 0.4 };
      current.render(element(moved));
      const legacy = mountTestRoot(<PosedTable pose={moved}><LegacyTableSettingMesh tableItem={ROUND} settingsCount={10} /></PosedTable>);
      const expected = coverMeshes(legacy.scene);
      const after = coverMeshes(current.scene);
      after.forEach(({ mesh }, index) => {
        const [sameMesh, sameGeometry, sameMaterial] = identities[index] ?? [];
        expect(mesh).toBe(sameMesh);
        expect(mesh.geometry).toBe(sameGeometry);
        expect(mesh.material).toBe(sameMaterial);
        const reference = expected[index]?.mesh.matrixWorld.elements ?? [];
        expect(maxAbsDifference(mesh.matrixWorld.elements, reference)).toBe(0);
      });
      legacy.unmount();
    }
  });

  it("disposes the layout set once, when its owner unmounts", () => {
    const capture: ResourceCapture = { current: null };
    const owner = mountTestRoot(
      <LayoutResources capture={capture}>
        <PosedTable pose={ORIGIN}><TableSettingMesh tableItem={ROUND} settingsCount={4} /></PosedTable>
      </LayoutResources>,
    );
    const resources = capturedResources(capture);
    const disposals = resourceParts(resources)
      .flatMap((part) => [vi.spyOn(part.geometry, "dispose"), vi.spyOn(part.material, "dispose")]);

    // A table losing its covers releases nothing the layout still owns.
    owner.render(<LayoutResources capture={capture}>{null}</LayoutResources>);
    expect(capturedResources(capture)).toBe(resources);
    for (const dispose of disposals) expect(dispose).not.toHaveBeenCalled();

    owner.unmount();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("gives a differently faded cover (the dressing ghost) its own shared set, disposed with it", () => {
    const capture: ResourceCapture = { current: null };
    const table: TablePose = { ...ORIGIN, id: "ghost" };
    const ghost = mountTestRoot(
      <LayoutResources capture={capture}>
        <PosedTable pose={table}><TableSettingMesh tableItem={ROUND} opacity={0.62} settingsCount={10} /></PosedTable>
      </LayoutResources>,
    );
    const covers = coverMeshes(ghost.scene);
    const layoutMaterials = new Set(resourceParts(capturedResources(capture)).map(({ material }) => material));
    expect(new Set(covers.map(({ mesh }) => mesh.geometry)).size).toBe(5);
    const materials = new Set(covers.map(({ mesh }) => singleMaterial(mesh)));
    expect(materials.size).toBe(5);
    for (const material of materials) expect(layoutMaterials.has(material)).toBe(false);
    const plate = covers[0]?.mesh;
    if (plate === undefined) throw new Error("missing ghost plate");
    expect(singleMaterial(plate).opacity).toBe(0.62);
    const legacy = mount(<PosedTable pose={table}><LegacyTableSettingMesh tableItem={ROUND} opacity={0.62} settingsCount={10} /></PosedTable>);
    coverMeshes(legacy.scene).forEach(({ mesh }, index) => {
      const next = covers[index]?.mesh;
      if (next === undefined) throw new Error("missing ghost cover");
      expect(materialSignature(singleMaterial(next))).toEqual(materialSignature(singleMaterial(mesh)));
    });
    const disposals = [...materials].map((material) => vi.spyOn(material, "dispose"));
    ghost.unmount();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });
});
