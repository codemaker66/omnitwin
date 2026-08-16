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
const LEFT_RETURN_POST_SIZE: Vector3Tuple = [
  SIDE_WALL_THICKNESS, FACADE_POST_SIZE[1], FACADE_POST_SIZE[2],
];
const LEFT_RETURN_POST_Z = -FACADE_POST_Z;
const LEFT_RETURN_RAIL_SIZE: Vector3Tuple = [
  SIDE_WALL_THICKNESS, FACADE_RAIL_SIZE[1], FACADE_POST_Z * 2,
];

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
const STAFF_SHELF_SIZE: Vector3Tuple = [
  CARCASS_WIDTH - SIDE_WALL_THICKNESS, 0.035, 0.43,
];
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
type RgbTuple = readonly [number, number, number];
type WoodGrainDirection = "horizontal" | "vertical";

export interface BarCounterProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface BarCounterMaterials {
  readonly countertopWood: MeshStandardMaterial;
  readonly horizontalWood: MeshStandardMaterial;
  readonly verticalWood: MeshStandardMaterial;
  readonly plinthWood: MeshStandardMaterial;
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
  readonly accentHardware: readonly Group[];
}

interface CarcassBuildResult {
  readonly structure: readonly Group[];
  readonly rearLeftPost: Group;
  readonly leftReturnRails: readonly Group[];
}

interface FacadeBuildResult {
  readonly cornerPosts: readonly Group[];
  readonly rails: readonly Group[];
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
  readonly brackets: readonly Group[];
}

function boxCollider(size: Vector3Tuple): BoxColliderDescriptor {
  return { shape: "box", size };
}

function cylinderCollider(radius: number, height: number): CylinderColliderDescriptor {
  return { shape: "cylinder", radius, height };
}

function createWoodTexture(
  id: string,
  base: RgbTuple,
  direction: WoodGrainDirection,
  repeat: readonly [number, number],
): DataTexture {
  const pixels = new Uint8Array(WALNUT_TEXTURE_SIZE * WALNUT_TEXTURE_SIZE * 4);
  for (let y = 0; y < WALNUT_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < WALNUT_TEXTURE_SIZE; x += 1) {
      const acrossGrain = direction === "horizontal" ? y : x;
      const alongGrain = direction === "horizontal" ? x : y;
      const wave = Math.sin(acrossGrain * 0.2 + Math.sin(alongGrain * 0.043) * 2.8);
      const fine = Math.sin(acrossGrain * 1.11 + alongGrain * 0.023) * 0.36;
      const band = Math.sin(acrossGrain * 0.051 + alongGrain * 0.012) * 0.55;
      const variation = Math.round(wave * 2.5 + fine * 1.75 + band * 1.5);
      const index = (y * WALNUT_TEXTURE_SIZE + x) * 4;
      pixels[index] = base[0] + variation;
      pixels[index + 1] = base[1] + Math.round(variation * 0.78);
      pixels[index + 2] = base[2] + Math.round(variation * 0.62);
      pixels[index + 3] = 255;
    }
  }

  const texture = new DataTexture(pixels, WALNUT_TEXTURE_SIZE, WALNUT_TEXTURE_SIZE);
  texture.name = `bar-counter-${id}-grain`;
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createWoodMaterial(
  id: string,
  base: RgbTuple,
  direction: WoodGrainDirection,
  repeat: readonly [number, number],
  roughness: number,
): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    map: createWoodTexture(id, base, direction, repeat),
    metalness: 0,
    roughness,
    side: FrontSide,
  });
  material.name = `bar-counter-${id}`;
  return material;
}

function createMaterials(): BarCounterMaterials {
  return {
    countertopWood: createWoodMaterial(
      "countertop", [100, 80, 68], "horizontal", [2.4, 0.85], 0.43,
    ),
    horizontalWood: createWoodMaterial(
      "horizontal-frame", [88, 62, 50], "horizontal", [2.6, 0.9], 0.5,
    ),
    verticalWood: createWoodMaterial(
      "vertical-frame", [82, 58, 48], "vertical", [0.9, 2.2], 0.52,
    ),
    plinthWood: createWoodMaterial(
      "plinth", [72, 49, 40], "horizontal", [3, 0.85], 0.58,
    ),
    darkWood: createWoodMaterial(
      "dark-carcass", [62, 43, 36], "vertical", [1, 2], 0.62,
    ),
    recessedWood: createWoodMaterial(
      "recessed-panel", [94, 68, 56], "vertical", [0.8, 2.1], 0.58,
    ),
    interiorWood: createWoodMaterial(
      "interior", [64, 44, 36], "horizontal", [2.3, 0.9], 0.68,
    ),
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
    materials.horizontalWood,
    options,
    TOP_BEVEL_RADIUS,
  );
  const inset = createRoundedBoxPart(
    top, registry, "countertop-walnut-inset-detail", TOP_INSET_SIZE,
    [0, TOP_INSET_Y, 0], materials.countertopWood, options, 0.008, true,
  );
  const caps = createCornerCaps(top, registry, materials.brass, options);
  return { top, details: [inset, ...caps], accentHardware: caps };
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
): CarcassBuildResult {
  const sideSize: Vector3Tuple = [SIDE_WALL_THICKNESS, CARCASS_HEIGHT, CARCASS_DEPTH];
  const deckSize: Vector3Tuple = [
    CARCASS_WIDTH - SIDE_WALL_THICKNESS * 2,
    CARCASS_DECK_THICKNESS,
    CARCASS_DEPTH,
  ];
  const rightReturn = createBoxPart(root, registry, "right-return", sideSize,
    [SIDE_WALL_X, CARCASS_CENTRE_Y, 0], materials.darkWood, options);
  const rearLeftPost = createRoundedBoxPart(root, registry, "rear-left-post", LEFT_RETURN_POST_SIZE,
    [-SIDE_WALL_X, FACADE_POST_Y, LEFT_RETURN_POST_Z], materials.verticalWood, options, 0.008);
  const leftReturnRails = [
    createRoundedBoxPart(root, registry, "left-return-lower-rail", LEFT_RETURN_RAIL_SIZE,
      [-SIDE_WALL_X, FACADE_LOWER_RAIL_Y, 0], materials.horizontalWood, options, 0.006),
    createRoundedBoxPart(root, registry, "left-return-upper-rail", LEFT_RETURN_RAIL_SIZE,
      [-SIDE_WALL_X, FACADE_UPPER_RAIL_Y, 0], materials.horizontalWood, options, 0.006),
  ];
  const decks = [
    createBoxPart(root, registry, "carcass-floor", deckSize,
      [0, CARCASS_BOTTOM_Y + CARCASS_DECK_THICKNESS / 2, 0], materials.interiorWood, options),
    createBoxPart(root, registry, "carcass-ceiling", deckSize,
      [0, CARCASS_TOP_Y - CARCASS_DECK_THICKNESS / 2, 0], materials.darkWood, options),
    createBoxPart(root, registry, "guest-front-backing", FRONT_BACKING_SIZE,
      [0, FRONT_BACKING_Y, FRONT_BACKING_Z], materials.darkWood, options),
  ];
  return {
    structure: [rightReturn, rearLeftPost, ...leftReturnRails, ...decks],
    rearLeftPost,
    leftReturnRails,
  };
}

function panelFrameSpecs(): readonly {
  readonly id: string;
  readonly size: Vector3Tuple;
  readonly position: Vector3Tuple;
  readonly direction: WoodGrainDirection;
}[] {
  const horizontalSize: Vector3Tuple = [
    PANEL_FRAME_WIDTH, PANEL_FRAME_BAR_WIDTH, PANEL_FRAME_DEPTH,
  ];
  const verticalSize: Vector3Tuple = [
    PANEL_FRAME_BAR_WIDTH, PANEL_VERTICAL_HEIGHT, PANEL_FRAME_DEPTH,
  ];
  return [
    { id: "top-moulding-detail", size: horizontalSize,
      position: [0, PANEL_HORIZONTAL_Y, PANEL_FRAME_Z], direction: "horizontal" },
    { id: "bottom-moulding-detail", size: horizontalSize,
      position: [0, -PANEL_HORIZONTAL_Y, PANEL_FRAME_Z], direction: "horizontal" },
    { id: "left-moulding-detail", size: verticalSize,
      position: [-PANEL_VERTICAL_X, 0, PANEL_FRAME_Z], direction: "vertical" },
    { id: "right-moulding-detail", size: verticalSize,
      position: [PANEL_VERTICAL_X, 0, PANEL_FRAME_Z], direction: "vertical" },
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
  const panelIds = ["front-panel-left", "front-panel-centre", "front-panel-right"] as const;
  const panelId = panelIds[panelIndex];
  if (panelId === undefined) throw new RangeError(`unsupported bar-counter panel index ${String(panelIndex)}`);
  const panel = createRoundedBoxPart(
    root, registry, panelId, PANEL_INSET_SIZE,
    [x, PANEL_CENTRE_Y, PANEL_CENTRE_Z], materials.recessedWood, options, 0.008,
  );
  const details = panelFrameSpecs().map((spec) => createRoundedBoxPart(
    panel, registry, `${panelId}-${spec.id}`, spec.size, spec.position,
    spec.direction === "horizontal" ? materials.horizontalWood : materials.verticalWood,
    options, 0.006, true,
  ));
  return { panel, details };
}

function createFacade(
  root: Group,
  registry: RuntimeRegistry,
  materials: BarCounterMaterials,
  options: BarCounterProxyOptions,
): FacadeBuildResult {
  const cornerPosts = [
    createRoundedBoxPart(root, registry, "front-left-post", FACADE_POST_SIZE,
      [-FACADE_POST_X, FACADE_POST_Y, FACADE_POST_Z], materials.verticalWood, options, 0.008),
    createRoundedBoxPart(root, registry, "front-right-post", FACADE_POST_SIZE,
      [FACADE_POST_X, FACADE_POST_Y, FACADE_POST_Z], materials.verticalWood, options, 0.008),
  ];
  const rails = [
    createRoundedBoxPart(root, registry, "guest-lower-facade-rail", FACADE_RAIL_SIZE,
      [0, FACADE_LOWER_RAIL_Y, FACADE_POST_Z], materials.horizontalWood, options, 0.008),
    createRoundedBoxPart(root, registry, "guest-upper-facade-rail", FACADE_RAIL_SIZE,
      [0, FACADE_UPPER_RAIL_Y, FACADE_POST_Z], materials.horizontalWood, options, 0.008),
  ];
  const assemblies = PANEL_CENTRES_X.map((x, index) =>
    createPanelAssembly(root, registry, index, x, materials, options));
  return {
    cornerPosts,
    rails,
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
    [0, STAFF_LOWER_RAIL_Y, STAFF_RAIL_Z], materials.horizontalWood, options, 0.006,
  );
  const upperRail = createRoundedBoxPart(
    root, registry, "staff-opening-upper-rail", STAFF_UPPER_RAIL_SIZE,
    [0, STAFF_UPPER_RAIL_Y, STAFF_RAIL_Z], materials.horizontalWood, options, 0.006,
  );
  const shelf = createRoundedBoxPart(
    root, registry, "service-shelf", STAFF_SHELF_SIZE,
    [0, STAFF_SHELF_Y, STAFF_SHELF_Z], materials.interiorWood, options, 0.006,
  );
  const lip = createRoundedBoxPart(
    shelf, registry, "staff-shelf-rear-lip-detail", STAFF_SHELF_LIP_SIZE,
    [0, STAFF_SHELF_LIP_Y, STAFF_SHELF_LIP_Z], materials.horizontalWood, options, 0.004, true,
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
      [0, LOWER_PLINTH_Y, 0], materials.plinthWood, options, 0.006),
    createRoundedBoxPart(root, registry, "middle-plinth", MIDDLE_PLINTH_SIZE,
      [0, MIDDLE_PLINTH_Y, 0], materials.horizontalWood, options, 0.005),
    createRoundedBoxPart(root, registry, "upper-plinth", UPPER_PLINTH_SIZE,
      [0, UPPER_PLINTH_Y, 0], materials.plinthWood, options, 0.004),
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
  return { rail, details: [...brackets, ...caps], brackets };
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
  carcass: CarcassBuildResult,
  facade: FacadeBuildResult,
  staff: StaffBuildResult,
  plinth: readonly Group[],
  footRail: FootRailBuildResult,
): void {
  registry.destructionGroups.countertop = [top.top, ...top.details];
  registry.destructionGroups["cabinet-shell"] = [...carcass.structure];
  registry.destructionGroups["front-panel-system"] = [
    ...facade.rails, ...facade.panels, ...facade.details,
  ];
  registry.destructionGroups["corner-post-system"] = [
    ...facade.cornerPosts,
    carcass.rearLeftPost,
    ...top.accentHardware,
  ];
  registry.destructionGroups["staff-side-bay"] = [...staff.structure, ...staff.details];
  registry.destructionGroups["base-plinth"] = [...plinth];
  registry.destructionGroups["foot-rail-system"] = [footRail.rail, ...footRail.details];
  registry.destructionGroups["left-return"] = [
    carcass.rearLeftPost,
    ...carcass.leftReturnRails,
  ];
  registry.destructionGroups["rail-bracket-system"] = [...footRail.brackets];
  registry.destructionGroups["accent-hardware"] = [...top.accentHardware];
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
  root.userData.evidenceSource =
    "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#bar-counter";
  root.userData.evidenceImage =
    "packages/web/src/assets/generated-furniture/bar-counter-imagegen-v1.png";
  root.userData.provenance = "generated";
  root.userData.authority = "presentation-only";
  root.userData.measuredGeometry = false;
  root.userData.sculptRuntime = registry satisfies Img2ThreeSculptRuntime;
  return root;
}
