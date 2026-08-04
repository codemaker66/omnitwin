import {
  BoxGeometry,
  CylinderGeometry,
  DataTexture,
  FrontSide,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { Img2ThreeSculptRuntime } from "../../../lib/furniture-presentation-runtime.js";

const COUNTER_WIDTH_METRES = 1.6;
const COUNTER_DEPTH_METRES = 0.61;
const COUNTER_HEIGHT_METRES = 1.208;

const TOP_THICKNESS = 0.06;
const TOP_CENTRE_Y = COUNTER_HEIGHT_METRES - TOP_THICKNESS / 2;
const TOP_BEVEL_RADIUS = 0.012;
const TOP_INSET_SIZE: Vector3Tuple = [1.55, 0.004, 0.56];
const TOP_INSET_Y = TOP_THICKNESS / 2 - TOP_INSET_SIZE[1] / 2;
const CORNER_CAP_SIZE: Vector3Tuple = [0.075, 0.012, 0.075];
const CORNER_CAP_X = COUNTER_WIDTH_METRES / 2 - CORNER_CAP_SIZE[0] / 2;
const CORNER_CAP_Z = COUNTER_DEPTH_METRES / 2 - CORNER_CAP_SIZE[2] / 2;
const CORNER_CAP_Y = TOP_THICKNESS / 2 - CORNER_CAP_SIZE[1] / 2;

const CARCASS_BOTTOM_Y = 0.11;
const CARCASS_TOP_Y = COUNTER_HEIGHT_METRES - TOP_THICKNESS;
const CARCASS_HEIGHT = CARCASS_TOP_Y - CARCASS_BOTTOM_Y;
const CARCASS_CENTRE_Y = CARCASS_BOTTOM_Y + CARCASS_HEIGHT / 2;
const CARCASS_WIDTH = 1.42;
const CARCASS_DEPTH = 0.48;
const SIDE_WALL_THICKNESS = 0.06;
const SIDE_WALL_X = (CARCASS_WIDTH - SIDE_WALL_THICKNESS) / 2;
const CARCASS_DECK_THICKNESS = 0.04;
const FRONT_BACKING_SIZE: Vector3Tuple = [1.3, 0.9, 0.028];
const FRONT_BACKING_Y = 0.63;
const FRONT_FACE_Z = CARCASS_DEPTH / 2;
const FRONT_BACKING_Z = FRONT_FACE_Z - FRONT_BACKING_SIZE[2] / 2;

const FACADE_POST_SIZE: Vector3Tuple = [0.085, 0.94, 0.075];
const FACADE_POST_X = (CARCASS_WIDTH - FACADE_POST_SIZE[0]) / 2;
const FACADE_POST_Y = 0.62;
const FACADE_POST_Z = FRONT_FACE_Z - FACADE_POST_SIZE[2] / 2;
const FACADE_RAIL_SIZE: Vector3Tuple = [1.42, 0.09, 0.075];
const FACADE_LOWER_RAIL_Y = 0.17;
const FACADE_UPPER_RAIL_Y = 1.075;

const PANEL_CENTRES_X = [-0.455, 0, 0.455] as const;
const PANEL_CENTRE_Y = 0.62;
const PANEL_CENTRE_Z = 0.252;
const PANEL_INSET_SIZE: Vector3Tuple = [0.36, 0.63, 0.018];
const PANEL_FRAME_WIDTH = 0.43;
const PANEL_FRAME_HEIGHT = 0.74;
const PANEL_FRAME_DEPTH = 0.03;
const PANEL_FRAME_BAR_WIDTH = 0.055;
const PANEL_FRAME_Z = 0.003;
const PANEL_HORIZONTAL_Y = PANEL_FRAME_HEIGHT / 2 - PANEL_FRAME_BAR_WIDTH / 2;
const PANEL_VERTICAL_X = PANEL_FRAME_WIDTH / 2 - PANEL_FRAME_BAR_WIDTH / 2;
const PANEL_VERTICAL_HEIGHT = PANEL_FRAME_HEIGHT - PANEL_FRAME_BAR_WIDTH * 2;

const STAFF_RAIL_WIDTH = 1.3;
const STAFF_RAIL_DEPTH = 0.05;
const STAFF_RAIL_Z = -CARCASS_DEPTH / 2 + STAFF_RAIL_DEPTH / 2;
const STAFF_LOWER_RAIL_SIZE: Vector3Tuple = [STAFF_RAIL_WIDTH, 0.1, STAFF_RAIL_DEPTH];
const STAFF_UPPER_RAIL_SIZE: Vector3Tuple = [STAFF_RAIL_WIDTH, 0.09, STAFF_RAIL_DEPTH];
const STAFF_LOWER_RAIL_Y = 0.19;
const STAFF_UPPER_RAIL_Y = 1.075;
const STAFF_SHELF_SIZE: Vector3Tuple = [1.25, 0.035, 0.43];
const STAFF_SHELF_Y = 0.55;
const STAFF_SHELF_Z = -0.01;
const STAFF_SHELF_LIP_SIZE: Vector3Tuple = [1.25, 0.045, 0.025];
const STAFF_SHELF_LIP_Y = 0.025;
const STAFF_SHELF_LIP_Z = -STAFF_SHELF_SIZE[2] / 2 + STAFF_SHELF_LIP_SIZE[2] / 2;

const LOWER_PLINTH_SIZE: Vector3Tuple = [1.46, 0.04, 0.5];
const LOWER_PLINTH_Y = LOWER_PLINTH_SIZE[1] / 2;
const MIDDLE_PLINTH_SIZE: Vector3Tuple = [1.42, 0.045, 0.47];
const MIDDLE_PLINTH_Y = LOWER_PLINTH_SIZE[1] + MIDDLE_PLINTH_SIZE[1] / 2;
const UPPER_PLINTH_SIZE: Vector3Tuple = [1.38, 0.025, 0.45];
const UPPER_PLINTH_Y = LOWER_PLINTH_SIZE[1]
  + MIDDLE_PLINTH_SIZE[1]
  + UPPER_PLINTH_SIZE[1] / 2;

const FOOT_RAIL_LENGTH = 1.3;
const FOOT_RAIL_RADIUS = 0.014;
const FOOT_RAIL_Y = 0.32;
const FOOT_RAIL_Z = 0.282;
const FOOT_RAIL_SEGMENTS = 24;
const FOOT_RAIL_END_CAP_RADIUS = 0.018;
const FOOT_RAIL_END_CAP_LENGTH = 0.028;
const FOOT_RAIL_END_CAP_X = FOOT_RAIL_LENGTH / 2 + FOOT_RAIL_END_CAP_LENGTH / 2;
const FOOT_RAIL_BRACKET_X = [-0.5, 0, 0.5] as const;
const FOOT_RAIL_BRACKET_LENGTH = 0.055;
const FOOT_RAIL_BRACKET_RADIUS = 0.009;
const FOOT_RAIL_BRACKET_Z = -FOOT_RAIL_BRACKET_LENGTH / 2;
const FOOT_RAIL_MOUNT_RADIUS = 0.03;
const FOOT_RAIL_MOUNT_DEPTH = 0.009;
const FOOT_RAIL_MOUNT_Z = -0.052;
const FOOT_RAIL_COLLAR_MAJOR_RADIUS = 0.017;
const FOOT_RAIL_COLLAR_TUBE_RADIUS = 0.004;

const WALNUT_TEXTURE_SIZE = 128;
const EXPLODE_WITH_PARENT = true;

type Vector3Tuple = readonly [number, number, number];

export interface BarCounterProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface BarCounterMaterials {
  readonly walnut: MeshStandardMaterial;
  readonly walnutEdge: MeshStandardMaterial;
  readonly darkWood: MeshStandardMaterial;
  readonly recessedWood: MeshStandardMaterial;
  readonly interiorWood: MeshStandardMaterial;
  readonly brass: MeshStandardMaterial;
}

interface RuntimeRegistry {
  readonly nodes: Record<string, Object3D>;
  readonly meshes: Record<string, Mesh>;
  readonly sockets: Record<string, Object3D>;
  readonly colliders: Record<string, unknown>;
  readonly destructionGroups: Record<string, Object3D[]>;
}

interface BoxColliderDescriptor {
  readonly shape: "box";
  readonly size: Vector3Tuple;
}

interface CylinderColliderDescriptor {
  readonly shape: "cylinder";
  readonly radius: number;
  readonly height: number;
}

type ColliderDescriptor = BoxColliderDescriptor | CylinderColliderDescriptor;

interface TopBuildResult {
  readonly top: Group;
  readonly details: readonly Group[];
}

interface FacadeBuildResult {
  readonly structure: readonly Group[];
  readonly panels: readonly Group[];
  readonly details: readonly Group[];
}

interface StaffBuildResult {
  readonly structure: readonly Group[];
  readonly details: readonly Group[];
}

interface FootRailBuildResult {
  readonly rail: Group;
  readonly details: readonly Group[];
}

function boxCollider(size: Vector3Tuple): BoxColliderDescriptor {
  return { shape: "box", size };
}

function cylinderCollider(radius: number, height: number): CylinderColliderDescriptor {
  return { shape: "cylinder", radius, height };
}

function createWalnutTexture(): DataTexture {
  const pixels = new Uint8Array(WALNUT_TEXTURE_SIZE * WALNUT_TEXTURE_SIZE * 4);
  for (let y = 0; y < WALNUT_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < WALNUT_TEXTURE_SIZE; x += 1) {
      const wave = Math.sin(y * 0.21 + Math.sin(x * 0.052) * 3.4);
      const fine = Math.sin(y * 1.07 + x * 0.027) * 0.38;
      const band = Math.sin(y * 0.047 + x * 0.014) * 0.6;
      const variation = Math.round(wave * 8 + fine * 5 + band * 6);
      const index = (y * WALNUT_TEXTURE_SIZE + x) * 4;
      pixels[index] = 91 + variation;
      pixels[index + 1] = 53 + Math.round(variation * 0.72);
      pixels[index + 2] = 31 + Math.round(variation * 0.48);
      pixels[index + 3] = 255;
    }
  }

  const texture = new DataTexture(pixels, WALNUT_TEXTURE_SIZE, WALNUT_TEXTURE_SIZE);
  texture.name = "bar-counter-walnut-grain";
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(4, 1.5);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createMaterials(): BarCounterMaterials {
  return {
    walnut: new MeshStandardMaterial({
      map: createWalnutTexture(), metalness: 0, roughness: 0.46, side: FrontSide,
    }),
    walnutEdge: new MeshStandardMaterial({
      color: 0x4d2818, metalness: 0, roughness: 0.52, side: FrontSide,
    }),
    darkWood: new MeshStandardMaterial({
      color: 0x2d1a13, metalness: 0, roughness: 0.62, side: FrontSide,
    }),
    recessedWood: new MeshStandardMaterial({
      color: 0x382017, metalness: 0, roughness: 0.68, side: FrontSide,
    }),
    interiorWood: new MeshStandardMaterial({
      color: 0x4a2b1d, metalness: 0, roughness: 0.7, side: FrontSide,
    }),
    brass: new MeshStandardMaterial({
      color: 0xb89448, metalness: 0.86, roughness: 0.28, side: FrontSide,
    }),
  };
}

function namedPivot(id: string): Group {
  const pivot = new Group();
  pivot.name = `${id}__pivot`;
  pivot.userData.componentId = id;
  return pivot;
}

function configureMesh(
  mesh: Mesh,
  id: string,
  options: BarCounterProxyOptions,
): Mesh {
  mesh.name = `${id}__mesh`;
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  mesh.userData.componentId = id;
  return mesh;
}

function markSurfaceDetail(pivot: Group, mesh: Mesh): void {
  pivot.userData.explodeWithParent = EXPLODE_WITH_PARENT;
  pivot.userData.surfaceDetail = true;
  mesh.userData.explodeWithParent = EXPLODE_WITH_PARENT;
  mesh.userData.surfaceDetail = true;
}

function registerPart(
  registry: RuntimeRegistry,
  id: string,
  pivot: Group,
  mesh: Mesh,
  collider: ColliderDescriptor,
): void {
  registry.nodes[id] = pivot;
  registry.meshes[id] = mesh;
  registry.colliders[id] = collider;
}

function createPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  geometry: BufferGeometry,
  material: Material,
  position: Vector3Tuple,
  collider: ColliderDescriptor,
  options: BarCounterProxyOptions,
  followsParent = false,
): Group {
  const pivot = namedPivot(id);
  pivot.position.set(...position);
  const mesh = configureMesh(new Mesh(geometry, material), id, options);
  pivot.add(mesh);
  parent.add(pivot);
  registerPart(registry, id, pivot, mesh, collider);
  if (followsParent) markSurfaceDetail(pivot, mesh);
  return pivot;
}

function createBoxPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  size: Vector3Tuple,
  position: Vector3Tuple,
  material: Material,
  options: BarCounterProxyOptions,
  followsParent = false,
): Group {
  return createPart(
    parent,
    registry,
    id,
    new BoxGeometry(...size),
    material,
    position,
    boxCollider(size),
    options,
    followsParent,
  );
}

function createRoundedBoxPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  size: Vector3Tuple,
  position: Vector3Tuple,
  material: Material,
  options: BarCounterProxyOptions,
  radius: number,
  followsParent = false,
): Group {
  return createPart(
    parent,
    registry,
    id,
    new RoundedBoxGeometry(...size, 2, radius),
    material,
    position,
    boxCollider(size),
    options,
    followsParent,
  );
}

function createTop(
  root: Group,
  registry: RuntimeRegistry,
  materials: BarCounterMaterials,
  options: BarCounterProxyOptions,
): TopBuildResult {
  const top = createRoundedBoxPart(
    root,
    registry,
    "countertop",
    [COUNTER_WIDTH_METRES, TOP_THICKNESS, COUNTER_DEPTH_METRES],
    [0, TOP_CENTRE_Y, 0],
    materials.walnutEdge,
    options,
    TOP_BEVEL_RADIUS,
  );
  const inset = createRoundedBoxPart(
    top, registry, "countertop-walnut-inset-detail", TOP_INSET_SIZE,
    [0, TOP_INSET_Y, 0], materials.walnut, options, 0.008, true,
  );
  const caps = createCornerCaps(top, registry, materials.brass, options);
  return { top, details: [inset, ...caps] };
}

function createCornerCaps(
  top: Group,
  registry: RuntimeRegistry,
  material: Material,
  options: BarCounterProxyOptions,
): readonly Group[] {
  const caps: Group[] = [];
  for (const xDirection of [-1, 1] as const) {
    for (const zDirection of [-1, 1] as const) {
      const hand = xDirection < 0 ? "left" : "right";
      const side = zDirection > 0 ? "guest" : "staff";
      caps.push(createRoundedBoxPart(
        top, registry, `${side}-${hand}-brass-corner-cap-detail`, CORNER_CAP_SIZE,
        [xDirection * CORNER_CAP_X, CORNER_CAP_Y, zDirection * CORNER_CAP_Z],
        material, options, 0.006, true,
      ));
    }
  }
  return caps;
}

function createCarcass(
  root: Group,
  registry: RuntimeRegistry,
  materials: BarCounterMaterials,
  options: BarCounterProxyOptions,
): readonly Group[] {
  const sideSize: Vector3Tuple = [SIDE_WALL_THICKNESS, CARCASS_HEIGHT, CARCASS_DEPTH];
  const deckSize: Vector3Tuple = [
    CARCASS_WIDTH - SIDE_WALL_THICKNESS * 2,
    CARCASS_DECK_THICKNESS,
    CARCASS_DEPTH,
  ];
  return [
    createBoxPart(root, registry, "left-side-wall", sideSize,
      [-SIDE_WALL_X, CARCASS_CENTRE_Y, 0], materials.darkWood, options),
    createBoxPart(root, registry, "right-side-wall", sideSize,
      [SIDE_WALL_X, CARCASS_CENTRE_Y, 0], materials.darkWood, options),
    createBoxPart(root, registry, "carcass-floor", deckSize,
      [0, CARCASS_BOTTOM_Y + CARCASS_DECK_THICKNESS / 2, 0], materials.interiorWood, options),
    createBoxPart(root, registry, "carcass-ceiling", deckSize,
      [0, CARCASS_TOP_Y - CARCASS_DECK_THICKNESS / 2, 0], materials.darkWood, options),
    createBoxPart(root, registry, "guest-front-backing", FRONT_BACKING_SIZE,
      [0, FRONT_BACKING_Y, FRONT_BACKING_Z], materials.darkWood, options),
  ];
}

function panelFrameSpecs(): readonly {
  readonly id: string;
  readonly size: Vector3Tuple;
  readonly position: Vector3Tuple;
}[] {
  const horizontalSize: Vector3Tuple = [
    PANEL_FRAME_WIDTH, PANEL_FRAME_BAR_WIDTH, PANEL_FRAME_DEPTH,
  ];
  const verticalSize: Vector3Tuple = [
    PANEL_FRAME_BAR_WIDTH, PANEL_VERTICAL_HEIGHT, PANEL_FRAME_DEPTH,
  ];
  return [
    { id: "top-moulding-detail", size: horizontalSize, position: [0, PANEL_HORIZONTAL_Y, PANEL_FRAME_Z] },
    { id: "bottom-moulding-detail", size: horizontalSize, position: [0, -PANEL_HORIZONTAL_Y, PANEL_FRAME_Z] },
    { id: "left-moulding-detail", size: verticalSize, position: [-PANEL_VERTICAL_X, 0, PANEL_FRAME_Z] },
    { id: "right-moulding-detail", size: verticalSize, position: [PANEL_VERTICAL_X, 0, PANEL_FRAME_Z] },
  ];
}

function createPanelAssembly(
  root: Group,
  registry: RuntimeRegistry,
  panelIndex: number,
  x: number,
  materials: BarCounterMaterials,
  options: BarCounterProxyOptions,
): { readonly panel: Group; readonly details: readonly Group[] } {
  const panelId = `guest-panel-${String(panelIndex + 1)}`;
  const panel = createRoundedBoxPart(
    root, registry, panelId, PANEL_INSET_SIZE,
    [x, PANEL_CENTRE_Y, PANEL_CENTRE_Z], materials.recessedWood, options, 0.008,
  );
  const details = panelFrameSpecs().map((spec) => createRoundedBoxPart(
    panel, registry, `${panelId}-${spec.id}`, spec.size, spec.position,
    materials.walnutEdge, options, 0.006, true,
  ));
  return { panel, details };
}

function createFacade(
  root: Group,
  registry: RuntimeRegistry,
  materials: BarCounterMaterials,
  options: BarCounterProxyOptions,
): FacadeBuildResult {
  const structure = [
    createRoundedBoxPart(root, registry, "guest-left-corner-post", FACADE_POST_SIZE,
      [-FACADE_POST_X, FACADE_POST_Y, FACADE_POST_Z], materials.walnutEdge, options, 0.008),
    createRoundedBoxPart(root, registry, "guest-right-corner-post", FACADE_POST_SIZE,
      [FACADE_POST_X, FACADE_POST_Y, FACADE_POST_Z], materials.walnutEdge, options, 0.008),
    createRoundedBoxPart(root, registry, "guest-lower-facade-rail", FACADE_RAIL_SIZE,
      [0, FACADE_LOWER_RAIL_Y, FACADE_POST_Z], materials.walnutEdge, options, 0.008),
    createRoundedBoxPart(root, registry, "guest-upper-facade-rail", FACADE_RAIL_SIZE,
      [0, FACADE_UPPER_RAIL_Y, FACADE_POST_Z], materials.walnutEdge, options, 0.008),
  ];
  const assemblies = PANEL_CENTRES_X.map((x, index) =>
    createPanelAssembly(root, registry, index, x, materials, options));
  return {
    structure,
    panels: assemblies.map(({ panel }) => panel),
    details: assemblies.flatMap(({ details }) => details),
  };
}

function createStaffSide(
  root: Group,
  registry: RuntimeRegistry,
  materials: BarCounterMaterials,
  options: BarCounterProxyOptions,
): StaffBuildResult {
  const lowerRail = createRoundedBoxPart(
    root, registry, "staff-opening-lower-rail", STAFF_LOWER_RAIL_SIZE,
    [0, STAFF_LOWER_RAIL_Y, STAFF_RAIL_Z], materials.walnutEdge, options, 0.006,
  );
  const upperRail = createRoundedBoxPart(
    root, registry, "staff-opening-upper-rail", STAFF_UPPER_RAIL_SIZE,
    [0, STAFF_UPPER_RAIL_Y, STAFF_RAIL_Z], materials.walnutEdge, options, 0.006,
  );
  const shelf = createRoundedBoxPart(
    root, registry, "staff-service-shelf", STAFF_SHELF_SIZE,
    [0, STAFF_SHELF_Y, STAFF_SHELF_Z], materials.interiorWood, options, 0.006,
  );
  const lip = createRoundedBoxPart(
    shelf, registry, "staff-shelf-rear-lip-detail", STAFF_SHELF_LIP_SIZE,
    [0, STAFF_SHELF_LIP_Y, STAFF_SHELF_LIP_Z], materials.walnutEdge, options, 0.004, true,
  );
  return { structure: [lowerRail, upperRail, shelf], details: [lip] };
}

function createPlinth(
  root: Group,
  registry: RuntimeRegistry,
  materials: BarCounterMaterials,
  options: BarCounterProxyOptions,
): readonly Group[] {
  return [
    createRoundedBoxPart(root, registry, "lower-plinth", LOWER_PLINTH_SIZE,
      [0, LOWER_PLINTH_Y, 0], materials.darkWood, options, 0.006),
    createRoundedBoxPart(root, registry, "middle-plinth", MIDDLE_PLINTH_SIZE,
      [0, MIDDLE_PLINTH_Y, 0], materials.walnutEdge, options, 0.005),
    createRoundedBoxPart(root, registry, "upper-plinth", UPPER_PLINTH_SIZE,
      [0, UPPER_PLINTH_Y, 0], materials.darkWood, options, 0.004),
  ];
}

function rotateCylinderAlongX(pivot: Group, registry: RuntimeRegistry, id: string): void {
  const mesh = registry.meshes[id];
  if (mesh === undefined) throw new Error(`bar counter part ${id} is missing its mesh`);
  mesh.rotation.z = Math.PI / 2;
  pivot.userData.axis = "x";
}

function rotateCylinderAlongZ(pivot: Group, registry: RuntimeRegistry, id: string): void {
  const mesh = registry.meshes[id];
  if (mesh === undefined) throw new Error(`bar counter part ${id} is missing its mesh`);
  mesh.rotation.x = Math.PI / 2;
  pivot.userData.axis = "z";
}

function createFootRailBracket(
  rail: Group,
  registry: RuntimeRegistry,
  index: number,
  x: number,
  material: Material,
  options: BarCounterProxyOptions,
): readonly Group[] {
  const prefix = `guest-foot-rail-bracket-${String(index + 1)}`;
  const mount = createPart(
    rail, registry, `${prefix}-mount-detail`,
    new CylinderGeometry(FOOT_RAIL_MOUNT_RADIUS, FOOT_RAIL_MOUNT_RADIUS, FOOT_RAIL_MOUNT_DEPTH, 20, 1),
    material, [x, 0, FOOT_RAIL_MOUNT_Z],
    cylinderCollider(FOOT_RAIL_MOUNT_RADIUS, FOOT_RAIL_MOUNT_DEPTH), options, true,
  );
  rotateCylinderAlongZ(mount, registry, `${prefix}-mount-detail`);
  const arm = createPart(
    rail, registry, `${prefix}-arm-detail`,
    new CylinderGeometry(FOOT_RAIL_BRACKET_RADIUS, FOOT_RAIL_BRACKET_RADIUS, FOOT_RAIL_BRACKET_LENGTH, 16, 1),
    material, [x, 0, FOOT_RAIL_BRACKET_Z],
    cylinderCollider(FOOT_RAIL_BRACKET_RADIUS, FOOT_RAIL_BRACKET_LENGTH), options, true,
  );
  rotateCylinderAlongZ(arm, registry, `${prefix}-arm-detail`);
  const collar = createPart(
    rail, registry, `${prefix}-collar-detail`,
    new TorusGeometry(FOOT_RAIL_COLLAR_MAJOR_RADIUS, FOOT_RAIL_COLLAR_TUBE_RADIUS, 8, 20),
    material, [x, 0, 0],
    cylinderCollider(FOOT_RAIL_COLLAR_MAJOR_RADIUS + FOOT_RAIL_COLLAR_TUBE_RADIUS,
      FOOT_RAIL_COLLAR_TUBE_RADIUS * 2), options, true,
  );
  const collarMesh = registry.meshes[`${prefix}-collar-detail`];
  if (collarMesh === undefined) throw new Error(`bar counter part ${prefix}-collar-detail is missing its mesh`);
  collarMesh.rotation.y = Math.PI / 2;
  return [mount, arm, collar];
}

function createFootRailEndCap(
  rail: Group,
  registry: RuntimeRegistry,
  side: "left" | "right",
  material: Material,
  options: BarCounterProxyOptions,
): Group {
  const id = `guest-foot-rail-${side}-end-cap-detail`;
  const direction = side === "left" ? -1 : 1;
  const cap = createPart(
    rail, registry, id,
    new CylinderGeometry(FOOT_RAIL_END_CAP_RADIUS, FOOT_RAIL_END_CAP_RADIUS,
      FOOT_RAIL_END_CAP_LENGTH, 20, 1),
    material, [direction * FOOT_RAIL_END_CAP_X, 0, 0],
    cylinderCollider(FOOT_RAIL_END_CAP_RADIUS, FOOT_RAIL_END_CAP_LENGTH), options, true,
  );
  rotateCylinderAlongX(cap, registry, id);
  return cap;
}

function createFootRail(
  root: Group,
  registry: RuntimeRegistry,
  material: Material,
  options: BarCounterProxyOptions,
): FootRailBuildResult {
  const id = "guest-foot-rail";
  const rail = createPart(
    root, registry, id,
    new CylinderGeometry(FOOT_RAIL_RADIUS, FOOT_RAIL_RADIUS, FOOT_RAIL_LENGTH,
      FOOT_RAIL_SEGMENTS, 1),
    material, [0, FOOT_RAIL_Y, FOOT_RAIL_Z],
    cylinderCollider(FOOT_RAIL_RADIUS, FOOT_RAIL_LENGTH), options,
  );
  rotateCylinderAlongX(rail, registry, id);
  const brackets = FOOT_RAIL_BRACKET_X.flatMap((x, index) =>
    createFootRailBracket(rail, registry, index, x, material, options));
  const caps = [
    createFootRailEndCap(rail, registry, "left", material, options),
    createFootRailEndCap(rail, registry, "right", material, options),
  ];
  return { rail, details: [...brackets, ...caps] };
}

function addSocket(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  position: Vector3Tuple,
): Object3D {
  const socket = new Object3D();
  socket.name = `${id}__socket`;
  socket.position.set(...position);
  parent.add(socket);
  registry.sockets[id] = socket;
  return socket;
}

function createSockets(root: Group, top: Group, registry: RuntimeRegistry): void {
  addSocket(root, registry, "floor-contact", [0, 0, 0]);
  addSocket(top, registry, "countertop-centre", [0, TOP_THICKNESS / 2, 0]);
  addSocket(root, registry, "staff-service-centre", [0, 0.78, -CARCASS_DEPTH / 2]);
  addSocket(root, registry, "guest-service-centre", [0, COUNTER_HEIGHT_METRES, COUNTER_DEPTH_METRES / 2]);
}

function createRuntimeRegistry(root: Group): RuntimeRegistry {
  return {
    nodes: { root },
    meshes: {},
    sockets: {},
    colliders: {
      root: boxCollider([COUNTER_WIDTH_METRES, COUNTER_HEIGHT_METRES, COUNTER_DEPTH_METRES]),
    },
    destructionGroups: {},
  };
}

function publishDestructionGroups(
  registry: RuntimeRegistry,
  top: TopBuildResult,
  carcass: readonly Group[],
  facade: FacadeBuildResult,
  staff: StaffBuildResult,
  plinth: readonly Group[],
  footRail: FootRailBuildResult,
): void {
  registry.destructionGroups.countertop = [top.top, ...top.details];
  registry.destructionGroups["cabinet-carcass"] = [...carcass];
  registry.destructionGroups["guest-facade"] = [
    ...facade.structure, ...facade.panels, ...facade.details,
  ];
  registry.destructionGroups["staff-service"] = [...staff.structure, ...staff.details];
  registry.destructionGroups.plinth = [...plinth];
  registry.destructionGroups["brass-hardware"] = [footRail.rail, ...footRail.details];
}

/**
 * Builds a presentation-only mobile bar-counter proxy in canonical metres.
 * The staff-side interior is a symmetric structural approximation because the
 * generated evidence contains only one oblique view of the hidden rear.
 */
export function createBarCounterProxy(options: BarCounterProxyOptions = {}): Group {
  const root = namedPivot("root");
  root.name = "bar-counter-proxy";
  const registry = createRuntimeRegistry(root);
  const materials = createMaterials();
  const top = createTop(root, registry, materials, options);
  const carcass = createCarcass(root, registry, materials, options);
  const facade = createFacade(root, registry, materials, options);
  const staff = createStaffSide(root, registry, materials, options);
  const plinth = createPlinth(root, registry, materials, options);
  const footRail = createFootRail(root, registry, materials.brass, options);

  createSockets(root, top.top, registry);
  publishDestructionGroups(registry, top, carcass, facade, staff, plinth, footRail);
  root.userData.canonicalDimensionsMetres = [
    COUNTER_WIDTH_METRES, COUNTER_HEIGHT_METRES, COUNTER_DEPTH_METRES,
  ];
  root.userData.evidenceSource = "artifacts/img2threejs/bar-counter";
  root.userData.provenance = "generated";
  root.userData.authority = "presentation-only";
  root.userData.measuredGeometry = false;
  root.userData.sculptRuntime = registry satisfies Img2ThreeSculptRuntime;
  return root;
}
