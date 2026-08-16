import {
  BoxGeometry,
  CylinderGeometry,
  DataTexture,
  FrontSide,
  Group,
  LinearFilter,
  Mesh,
  MeshPhysicalMaterial,
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

const LECTERN_WIDTH_METRES = 0.6;
const LECTERN_HEIGHT_METRES = 1.15;
const LECTERN_DEPTH_METRES = 0.5;

const LOWER_PLINTH_CORE_SIZE: Vector3Tuple = [0.6, 0.07, 0.5];
const LOWER_PLINTH_CORE_POSITION: Vector3Tuple = [0, 0.035, 0];
const PUBLIC_FOOT_NOTCH_SIZE: Vector3Tuple = [0.06, 0.009, 0.002];
const PUBLIC_FOOT_NOTCH_POSITION: Vector3Tuple = [0, -0.0305, -0.249];
const LOWER_PLINTH_MOULDING_SIZE: Vector3Tuple = [0.56, 0.055, 0.46];
const LOWER_PLINTH_MOULDING_Y = 0.0975;
const UPPER_PLINTH_SIZE: Vector3Tuple = [0.51, 0.042, 0.43];
const UPPER_PLINTH_Y = 0.146;
const UPPER_PLINTH_MOULDING_SIZE: Vector3Tuple = [0.48, 0.035, 0.405];
const UPPER_PLINTH_MOULDING_Y = 0.1845;

const CABINET_BOTTOM_Y = 0.19;
const CABINET_TOP_Y = 1.02;
const CABINET_HEIGHT = CABINET_TOP_Y - CABINET_BOTTOM_Y;
const CABINET_CENTRE_Y = CABINET_BOTTOM_Y + CABINET_HEIGHT / 2;
const CABINET_WIDTH = 0.44;
const CABINET_DEPTH = 0.38;
const CABINET_SIDE_THICKNESS = 0.045;
const CABINET_SIDE_X = (CABINET_WIDTH - CABINET_SIDE_THICKNESS) / 2;
const CABINET_BACK_SIZE: Vector3Tuple = [0.35, CABINET_HEIGHT, 0.035];
const CABINET_BACK_Z = (CABINET_DEPTH - CABINET_BACK_SIZE[2]) / 2;
const LOWER_FRONT_BACKING_SIZE: Vector3Tuple = [0.35, 0.59, 0.025];
const LOWER_FRONT_BACKING_Y = 0.51;
const LOWER_FRONT_BACKING_Z = -CABINET_DEPTH / 2 + LOWER_FRONT_BACKING_SIZE[2] / 2;
const SHELF_FLOOR_SIZE: Vector3Tuple = [0.35, 0.035, 0.35];
const SHELF_FLOOR_Y = 0.8225;
const SHELF_RECESS_BACK_SIZE: Vector3Tuple = [0.35, 0.145, 0.025];
const SHELF_RECESS_BACK_Y = 0.9125;
const SHELF_RECESS_BACK_Z = 0.1475;
const CABINET_HEADER_SIZE: Vector3Tuple = [0.44, 0.04, 0.38];
const CABINET_HEADER_Y = 1.0;

const FRONT_PANEL_SIZE: Vector3Tuple = [0.29, 0.48, 0.018];
const FRONT_PANEL_POSITION: Vector3Tuple = [0, 0.5, -0.199];
const OUTER_FRAME_WIDTH = 0.35;
const OUTER_FRAME_HEIGHT = 0.54;
const OUTER_FRAME_BAR = 0.03;
const OUTER_FRAME_DEPTH = 0.014;
const OUTER_FRAME_Z = -0.215;
const INNER_FRAME_WIDTH = 0.31;
const INNER_FRAME_HEIGHT = 0.5;
const INNER_FRAME_BAR = 0.012;
const INNER_FRAME_DEPTH = 0.008;
const INNER_FRAME_Z = -0.226;

const DECK_ANGLE_RADIANS = -Math.PI / 18;
const READING_DECK_SIZE: Vector3Tuple = [0.54, 0.028, 0.46];
const DECK_SIDE_RAIL_SIZE: Vector3Tuple = [0.03, 0.07, 0.48];
const DECK_SIDE_RAIL_X = 0.285;
const DECK_SIDE_RAIL_Y = 0.035;
const DECK_PIVOT_Y = LECTERN_HEIGHT_METRES
  - (DECK_SIDE_RAIL_Y + DECK_SIDE_RAIL_SIZE[1] / 2) * Math.cos(DECK_ANGLE_RADIANS)
  - (DECK_SIDE_RAIL_SIZE[2] / 2) * Math.abs(Math.sin(DECK_ANGLE_RADIANS));
const RETAINING_RAIL_RADIUS = 0.012;
const RETAINING_RAIL_LENGTH = 0.47;
const RETAINING_RAIL_POSITION: Vector3Tuple = [0, 0.025, -0.205];
const GROMMET_POSITION: Vector3Tuple = [-0.15, 0.0175, 0.1];
const GROMMET_MAJOR_RADIUS = 0.023;
const GROMMET_TUBE_RADIUS = 0.004;

const GRAIN_TEXTURE_SIZE = 1024;
const EXPLODE_WITH_PARENT = true;

const texturePixelCache = new Map<string, Uint8Array>();

type Vector3Tuple = readonly [number, number, number];
type RgbTuple = readonly [number, number, number];
type GrainDirection = "horizontal" | "vertical";

export interface LecternProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface LecternMaterials {
  readonly horizontalWood: MeshPhysicalMaterial;
  readonly verticalWood: MeshPhysicalMaterial;
  readonly mouldingWood: MeshPhysicalMaterial;
  readonly cavityWood: MeshStandardMaterial;
  readonly charcoal: MeshStandardMaterial;
}

interface RuntimeRegistry {
  readonly nodes: Record<string, Object3D>;
  readonly meshes: Record<string, Mesh>;
  readonly sockets: Record<string, Object3D>;
  readonly colliders: Record<string, ColliderDescriptor>;
  readonly destructionGroups: Record<string, Object3D[]>;
}

interface BoxColliderDescriptor {
  readonly shape: "box";
  readonly size: Vector3Tuple;
  readonly approximate: true;
  readonly authority: "presentation-only";
}

interface CylinderColliderDescriptor {
  readonly shape: "cylinder";
  readonly radius: number;
  readonly height: number;
  readonly axis: "x" | "y" | "z";
  readonly approximate: true;
  readonly authority: "presentation-only";
}

type ColliderDescriptor = BoxColliderDescriptor | CylinderColliderDescriptor;

interface GrainTextures {
  readonly map: DataTexture;
  readonly bumpMap: DataTexture;
  readonly roughnessMap: DataTexture;
}

interface PlinthParts {
  readonly assembly: Group;
  readonly parts: readonly Group[];
}

interface CabinetParts {
  readonly assembly: Group;
  readonly shell: Group;
  readonly shellParts: readonly Group[];
  readonly panelParts: readonly Group[];
  readonly shelfParts: readonly Group[];
}

interface DeckParts {
  readonly assembly: Group;
  readonly deck: Group;
  readonly rails: readonly Group[];
  readonly grommetParts: readonly Group[];
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function texturePixels(
  base: RgbTuple,
  direction: GrainDirection,
  channel: "albedo" | "bump" | "roughness",
): Uint8Array {
  const cacheKey = `${base.join("-")}:${direction}:${channel}`;
  const cached = texturePixelCache.get(cacheKey);
  if (cached !== undefined) return new Uint8Array(cached);

  const pixels = new Uint8Array(GRAIN_TEXTURE_SIZE * GRAIN_TEXTURE_SIZE * 4);
  for (let y = 0; y < GRAIN_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < GRAIN_TEXTURE_SIZE; x += 1) {
      const across = direction === "horizontal" ? y : x;
      const along = direction === "horizontal" ? x : y;
      const warped = across + Math.sin(along * 0.013) * 9 + Math.sin(along * 0.0041) * 17;
      const broad = Math.sin(warped * 0.027) * 0.38;
      const fine = (
        Math.sin(warped * 0.083 + Math.sin(along * 0.011) * 0.8) * 0.18
        + Math.sin(warped * 0.21) * 0.05
      );
      const figure = Math.sin(warped * 0.009 + Math.sin(along * 0.0027) * 1.2) * 0.22;
      const grain = broad + fine + figure;
      const index = (y * GRAIN_TEXTURE_SIZE + x) * 4;
      if (channel === "albedo") {
        pixels[index] = clampChannel(base[0] + grain * 10);
        pixels[index + 1] = clampChannel(base[1] + grain * 6);
        pixels[index + 2] = clampChannel(base[2] + grain * 4);
      } else {
        const neutral = channel === "bump" ? 128 + grain * 12 : 205 + grain * 9;
        const value = clampChannel(neutral);
        pixels[index] = value;
        pixels[index + 1] = value;
        pixels[index + 2] = value;
      }
      pixels[index + 3] = 255;
    }
  }
  texturePixelCache.set(cacheKey, pixels);
  return new Uint8Array(pixels);
}

function configureTexture(
  texture: DataTexture,
  name: string,
  repeat: readonly [number, number],
  isAlbedo: boolean,
): DataTexture {
  texture.name = name;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  if (isAlbedo) texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createGrainTextures(
  id: string,
  base: RgbTuple,
  direction: GrainDirection,
  repeat: readonly [number, number],
): GrainTextures {
  const texture = (channel: "albedo" | "bump" | "roughness"): DataTexture => configureTexture(
    new DataTexture(texturePixels(base, direction, channel), GRAIN_TEXTURE_SIZE, GRAIN_TEXTURE_SIZE),
    `lectern-${id}-${channel}`,
    repeat,
    channel === "albedo",
  );
  return {
    map: texture("albedo"),
    bumpMap: texture("bump"),
    roughnessMap: texture("roughness"),
  };
}

function createWoodMaterial(
  id: string,
  base: RgbTuple,
  direction: GrainDirection,
  repeat: readonly [number, number],
  roughness: number,
): MeshPhysicalMaterial {
  const textures = createGrainTextures(id, base, direction, repeat);
  const material = new MeshPhysicalMaterial({
    ...textures,
    bumpScale: 0.0015,
    clearcoat: 0.1,
    clearcoatRoughness: 0.5,
    metalness: 0,
    roughness,
    side: FrontSide,
    specularIntensity: 0.35,
  });
  material.name = `lectern-${id}`;
  return material;
}

function createMaterials(): LecternMaterials {
  return {
    horizontalWood: createWoodMaterial(
      "horizontal-walnut", [100, 54, 32], "horizontal", [1.5, 1], 0.56,
    ),
    verticalWood: createWoodMaterial(
      "vertical-walnut", [90, 47, 29], "vertical", [1, 1.8], 0.58,
    ),
    mouldingWood: createWoodMaterial(
      "moulding-walnut", [105, 55, 30], "horizontal", [1.4, 1], 0.5,
    ),
    cavityWood: new MeshStandardMaterial({
      color: 0x2b1811,
      metalness: 0,
      roughness: 0.58,
      side: FrontSide,
    }),
    charcoal: new MeshStandardMaterial({
      color: 0x242625,
      metalness: 0,
      roughness: 0.42,
      side: FrontSide,
    }),
  };
}

function boxCollider(size: Vector3Tuple): BoxColliderDescriptor {
  return { shape: "box", size, approximate: true, authority: "presentation-only" };
}

function cylinderCollider(
  radius: number,
  height: number,
  axis: "x" | "y" | "z" = "y",
): CylinderColliderDescriptor {
  return {
    shape: "cylinder",
    radius,
    height,
    axis,
    approximate: true,
    authority: "presentation-only",
  };
}

function namedPivot(id: string): Group {
  const pivot = new Group();
  pivot.name = `${id}__pivot`;
  pivot.userData.componentId = id;
  return pivot;
}

function configureMesh(mesh: Mesh, id: string, options: LecternProxyOptions): Mesh {
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

function registerContainer(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  collider: ColliderDescriptor,
  position: Vector3Tuple = [0, 0, 0],
): Group {
  const container = namedPivot(id);
  container.position.set(...position);
  parent.add(container);
  registry.nodes[id] = container;
  registry.colliders[id] = collider;
  return container;
}

function createPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  geometry: BufferGeometry,
  material: Material,
  position: Vector3Tuple,
  collider: ColliderDescriptor,
  options: LecternProxyOptions,
  followsParent = false,
): Group {
  const pivot = namedPivot(id);
  pivot.position.set(...position);
  const mesh = configureMesh(new Mesh(geometry, material), id, options);
  pivot.add(mesh);
  parent.add(pivot);
  registry.nodes[id] = pivot;
  registry.meshes[id] = mesh;
  registry.colliders[id] = collider;
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
  options: LecternProxyOptions,
  followsParent = false,
): Group {
  return createPart(
    parent, registry, id, new BoxGeometry(...size), material,
    position, boxCollider(size), options, followsParent,
  );
}

function createRoundedBoxPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  size: Vector3Tuple,
  position: Vector3Tuple,
  material: Material,
  radius: number,
  options: LecternProxyOptions,
  followsParent = false,
): Group {
  return createPart(
    parent, registry, id, new RoundedBoxGeometry(...size, 2, radius), material,
    position, boxCollider(size), options, followsParent,
  );
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

function createPlinth(
  root: Group,
  registry: RuntimeRegistry,
  materials: LecternMaterials,
  options: LecternProxyOptions,
): PlinthParts {
  const assembly = registerContainer(
    root, registry, "plinth-assembly",
    boxCollider([LECTERN_WIDTH_METRES, 0.202, LECTERN_DEPTH_METRES]),
  );
  const lower = createRoundedBoxPart(
    assembly, registry, "lower-plinth", LOWER_PLINTH_CORE_SIZE,
    LOWER_PLINTH_CORE_POSITION, materials.horizontalWood, 0.006, options,
  );
  const notch = createRoundedBoxPart(
    lower,
    registry,
    "public-foot-notch-detail",
    PUBLIC_FOOT_NOTCH_SIZE,
    PUBLIC_FOOT_NOTCH_POSITION,
    materials.cavityWood,
    0.001,
    options,
    true,
  );
  const lowerMoulding = createRoundedBoxPart(
    assembly, registry, "lower-plinth-moulding", LOWER_PLINTH_MOULDING_SIZE,
    [0, LOWER_PLINTH_MOULDING_Y, 0], materials.mouldingWood, 0.009, options,
  );
  const upper = createRoundedBoxPart(
    assembly, registry, "upper-plinth", UPPER_PLINTH_SIZE,
    [0, UPPER_PLINTH_Y, 0], materials.horizontalWood, 0.006, options,
  );
  const upperMoulding = createRoundedBoxPart(
    assembly, registry, "upper-plinth-moulding", UPPER_PLINTH_MOULDING_SIZE,
    [0, UPPER_PLINTH_MOULDING_Y, 0], materials.mouldingWood, 0.008, options,
  );
  return { assembly, parts: [lower, notch, lowerMoulding, upper, upperMoulding] };
}

function createCabinetShell(
  assembly: Group,
  registry: RuntimeRegistry,
  materials: LecternMaterials,
  options: LecternProxyOptions,
): { readonly shell: Group; readonly parts: readonly Group[] } {
  const shell = registerContainer(
    assembly, registry, "cabinet-shell",
    boxCollider([CABINET_WIDTH, CABINET_HEIGHT, CABINET_DEPTH]),
  );
  const sideSize: Vector3Tuple = [CABINET_SIDE_THICKNESS, CABINET_HEIGHT, CABINET_DEPTH];
  const sides = ([-1, 1] as const).map((direction) => createRoundedBoxPart(
    shell,
    registry,
    direction < 0 ? "cabinet-left-side" : "cabinet-right-side",
    sideSize,
    [direction * CABINET_SIDE_X, CABINET_CENTRE_Y, 0],
    materials.verticalWood,
    0.004,
    options,
  ));
  const back = createBoxPart(
    shell, registry, "cabinet-back", CABINET_BACK_SIZE,
    [0, CABINET_CENTRE_Y, CABINET_BACK_Z], materials.verticalWood, options,
  );
  const frontBacking = createBoxPart(
    shell, registry, "lower-front-backing", LOWER_FRONT_BACKING_SIZE,
    [0, LOWER_FRONT_BACKING_Y, LOWER_FRONT_BACKING_Z], materials.verticalWood, options,
  );
  const header = createRoundedBoxPart(
    shell, registry, "cabinet-header", CABINET_HEADER_SIZE,
    [0, CABINET_HEADER_Y, 0], materials.horizontalWood, 0.004, options,
  );
  return { shell, parts: [...sides, back, frontBacking, header] };
}

function createShelfRecess(
  assembly: Group,
  registry: RuntimeRegistry,
  materials: LecternMaterials,
  options: LecternProxyOptions,
): readonly Group[] {
  const back = createBoxPart(
    assembly, registry, "shelf-recess", SHELF_RECESS_BACK_SIZE,
    [0, SHELF_RECESS_BACK_Y, SHELF_RECESS_BACK_Z], materials.cavityWood, options,
  );
  const floor = createRoundedBoxPart(
    back, registry, "shelf-floor-detail", SHELF_FLOOR_SIZE,
    [0, SHELF_FLOOR_Y - SHELF_RECESS_BACK_Y, -SHELF_RECESS_BACK_Z],
    materials.cavityWood, 0.003, options, true,
  );
  const frontLip = createRoundedBoxPart(
    floor, registry, "shelf-front-lip-detail", [0.35, 0.025, 0.025],
    [0, 0.025, -SHELF_FLOOR_SIZE[2] / 2 + 0.0125],
    materials.mouldingWood, 0.003, options, true,
  );
  return [back, floor, frontLip];
}

function createFrameAssembly(
  assembly: Group,
  registry: RuntimeRegistry,
  id: "front-panel-frame" | "front-panel-moulding",
  width: number,
  height: number,
  bar: number,
  depth: number,
  z: number,
  material: Material,
  options: LecternProxyOptions,
): readonly Group[] {
  const horizontalSize: Vector3Tuple = [width, bar, depth];
  const verticalSize: Vector3Tuple = [bar, height - bar * 2, depth];
  const upperY = 0.5 + (height - bar) / 2;
  const upper = createRoundedBoxPart(
    assembly, registry, id, horizontalSize, [0, upperY, z], material, bar * 0.22, options,
  );
  const lower = createRoundedBoxPart(
    upper, registry, `${id}-lower-detail`, horizontalSize,
    [0, -(height - bar), 0], material, bar * 0.22, options, true,
  );
  const sideY = -(height - bar) / 2;
  const sideX = (width - bar) / 2;
  const sides = ([-1, 1] as const).map((direction) => createRoundedBoxPart(
    upper,
    registry,
    `${id}-${direction < 0 ? "left" : "right"}-detail`,
    verticalSize,
    [direction * sideX, sideY, 0],
    material,
    bar * 0.22,
    options,
    true,
  ));
  return [upper, lower, ...sides];
}

function createPublicPanel(
  assembly: Group,
  registry: RuntimeRegistry,
  materials: LecternMaterials,
  options: LecternProxyOptions,
): readonly Group[] {
  const field = createRoundedBoxPart(
    assembly, registry, "front-panel-field", FRONT_PANEL_SIZE,
    FRONT_PANEL_POSITION, materials.verticalWood, 0.004, options,
  );
  const outerFrame = createFrameAssembly(
    assembly, registry, "front-panel-frame",
    OUTER_FRAME_WIDTH, OUTER_FRAME_HEIGHT, OUTER_FRAME_BAR,
    OUTER_FRAME_DEPTH, OUTER_FRAME_Z, materials.verticalWood, options,
  );
  const innerFrame = createFrameAssembly(
    assembly, registry, "front-panel-moulding",
    INNER_FRAME_WIDTH, INNER_FRAME_HEIGHT, INNER_FRAME_BAR,
    INNER_FRAME_DEPTH, INNER_FRAME_Z, materials.mouldingWood, options,
  );
  return [field, ...outerFrame, ...innerFrame];
}

function createCabinet(
  root: Group,
  registry: RuntimeRegistry,
  materials: LecternMaterials,
  options: LecternProxyOptions,
): CabinetParts {
  const assembly = registerContainer(
    root, registry, "cabinet-assembly",
    boxCollider([CABINET_WIDTH, CABINET_HEIGHT, CABINET_DEPTH]),
  );
  const shell = createCabinetShell(assembly, registry, materials, options);
  const shelfParts = createShelfRecess(assembly, registry, materials, options);
  const panelParts = createPublicPanel(assembly, registry, materials, options);
  return {
    assembly,
    shell: shell.shell,
    shellParts: shell.parts,
    panelParts,
    shelfParts,
  };
}

function rotateMesh(
  registry: RuntimeRegistry,
  id: string,
  rotation: Vector3Tuple,
): void {
  const mesh = registry.meshes[id];
  if (mesh === undefined) throw new Error(`lectern part ${id} is missing its mesh`);
  mesh.rotation.set(...rotation);
}

function createDeckRails(
  assembly: Group,
  registry: RuntimeRegistry,
  materials: LecternMaterials,
  options: LecternProxyOptions,
): readonly Group[] {
  const sideRails = ([-1, 1] as const).map((direction) => createRoundedBoxPart(
    assembly,
    registry,
    direction < 0 ? "deck-left-rail" : "deck-right-rail",
    DECK_SIDE_RAIL_SIZE,
    [direction * DECK_SIDE_RAIL_X, DECK_SIDE_RAIL_Y, 0],
    materials.mouldingWood,
    0.005,
    options,
  ));
  const retaining = createPart(
    assembly,
    registry,
    "deck-retaining-rail",
    new CylinderGeometry(
      RETAINING_RAIL_RADIUS,
      RETAINING_RAIL_RADIUS,
      RETAINING_RAIL_LENGTH,
      28,
      1,
    ),
    materials.mouldingWood,
    RETAINING_RAIL_POSITION,
    cylinderCollider(RETAINING_RAIL_RADIUS, RETAINING_RAIL_LENGTH, "x"),
    options,
  );
  rotateMesh(registry, "deck-retaining-rail", [0, 0, Math.PI / 2]);
  return [...sideRails, retaining];
}

function createGrommet(
  assembly: Group,
  registry: RuntimeRegistry,
  material: Material,
  options: LecternProxyOptions,
): readonly Group[] {
  const ring = createPart(
    assembly,
    registry,
    "cable-grommet",
    new TorusGeometry(GROMMET_MAJOR_RADIUS, GROMMET_TUBE_RADIUS, 10, 28),
    material,
    GROMMET_POSITION,
    cylinderCollider(GROMMET_MAJOR_RADIUS + GROMMET_TUBE_RADIUS, GROMMET_TUBE_RADIUS * 2),
    options,
  );
  rotateMesh(registry, "cable-grommet", [Math.PI / 2, 0, 0]);
  const disc = createPart(
    ring,
    registry,
    "grommet-disc",
    new CylinderGeometry(0.019, 0.019, 0.003, 28, 1),
    material,
    [0, -0.002, 0],
    cylinderCollider(0.019, 0.003),
    options,
    true,
  );
  const slot = createRoundedBoxPart(
    ring, registry, "grommet-slot", [0.014, 0.0015, 0.003],
    [0.006, 0.0006, 0], material, 0.0006, options, true,
  );
  slot.rotation.y = 0.35;
  return [ring, disc, slot];
}

function createDeck(
  root: Group,
  registry: RuntimeRegistry,
  materials: LecternMaterials,
  options: LecternProxyOptions,
): DeckParts {
  const assembly = registerContainer(
    root,
    registry,
    "deck-assembly",
    boxCollider([LECTERN_WIDTH_METRES, 0.15, LECTERN_DEPTH_METRES]),
    [0, DECK_PIVOT_Y, 0],
  );
  assembly.rotation.x = DECK_ANGLE_RADIANS;
  const deck = createRoundedBoxPart(
    assembly, registry, "reading-deck", READING_DECK_SIZE,
    [0, 0, 0], materials.horizontalWood, 0.006, options,
  );
  const apron = createRoundedBoxPart(
    deck, registry, "deck-front-apron-detail", [0.56, 0.035, 0.03],
    [0, -0.004, -0.215], materials.horizontalWood, 0.004, options, true,
  );
  const rails = createDeckRails(assembly, registry, materials, options);
  const grommetParts = createGrommet(assembly, registry, materials.charcoal, options);
  return { assembly, deck, rails: [...rails, apron], grommetParts };
}

function createRuntimeRegistry(root: Group): RuntimeRegistry {
  return {
    nodes: { root },
    meshes: {},
    sockets: {},
    colliders: {
      root: boxCollider([
        LECTERN_WIDTH_METRES,
        LECTERN_HEIGHT_METRES,
        LECTERN_DEPTH_METRES,
      ]),
    },
    destructionGroups: {},
  };
}

function createSockets(
  root: Group,
  deck: DeckParts,
  registry: RuntimeRegistry,
): void {
  addSocket(root, registry, "floor-contact", [0, 0, 0]);
  addSocket(root, registry, "plan-anchor", [0, LECTERN_HEIGHT_METRES / 2, 0]);
  addSocket(root, registry, "speaker-front", [0, 0.9, -LECTERN_DEPTH_METRES / 2]);
  addSocket(deck.assembly, registry, "reading-surface-centre", [0, 0.018, 0]);
  addSocket(deck.assembly, registry, "av-mount", [0, 0.025, 0.11]);
  addSocket(deck.assembly, registry, "cable-pass-through", GROMMET_POSITION);
}

function publishDestructionGroups(
  registry: RuntimeRegistry,
  plinth: PlinthParts,
  cabinet: CabinetParts,
  deck: DeckParts,
): void {
  registry.destructionGroups["plinth-assembly"] = [plinth.assembly, ...plinth.parts];
  registry.destructionGroups["cabinet-shell"] = [
    cabinet.assembly,
    cabinet.shell,
    ...cabinet.shellParts,
  ];
  registry.destructionGroups["public-panel-assembly"] = [...cabinet.panelParts];
  registry.destructionGroups["shelf-recess"] = [...cabinet.shelfParts];
  registry.destructionGroups["reading-deck"] = [deck.assembly, deck.deck];
  registry.destructionGroups["deck-rails"] = [...deck.rails];
  registry.destructionGroups["cable-grommet"] = [...deck.grommetParts];
}

/**
 * Builds an action-ready, presentation-only lectern proxy in canonical metres.
 * The single ImageGen view does not evidence its rear joinery or internal construction.
 */
export function createLecternProxy(options: LecternProxyOptions = {}): Group {
  const root = namedPivot("root");
  root.name = "lectern-proxy";
  const registry = createRuntimeRegistry(root);
  const materials = createMaterials();
  const plinth = createPlinth(root, registry, materials, options);
  const cabinet = createCabinet(root, registry, materials, options);
  const deck = createDeck(root, registry, materials, options);

  createSockets(root, deck, registry);
  publishDestructionGroups(registry, plinth, cabinet, deck);
  root.userData.canonicalDimensionsMetres = [
    LECTERN_WIDTH_METRES,
    LECTERN_HEIGHT_METRES,
    LECTERN_DEPTH_METRES,
  ];
  root.userData.evidenceSource =
    "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#lectern";
  root.userData.evidenceImage =
    "packages/web/src/assets/generated-furniture/lectern-imagegen-v1.png";
  root.userData.sourceKind = "ai-generated-image";
  root.userData.generator = "OpenAI ImageGen";
  root.userData.geometryKind = "procedural-generated-stand-in";
  root.userData.provenance = "generated";
  root.userData.authority = "presentation-only";
  root.userData.measuredGeometry = false;
  root.userData.limitations = [
    "not measured venue evidence",
    "single-view hidden sides are conservative procedural approximations",
    "collider and destruction declarations are metadata only",
  ];
  root.userData.sculptRuntime = registry satisfies Img2ThreeSculptRuntime;
  return root;
}
