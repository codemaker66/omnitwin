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
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";

import type { Img2ThreeSculptRuntime } from "../../../lib/furniture-presentation-runtime.js";

const PLATFORM_WIDTH_METRES = 2.44;
const PLATFORM_DEPTH_METRES = 1.22;
const PLATFORM_HEIGHT_METRES = 0.4;

const DECK_CORE_BOTTOM_Y = 0.348;
const CARPET_THICKNESS = 0.006;
const DECK_CORE_TOP_Y = PLATFORM_HEIGHT_METRES - CARPET_THICKNESS;
const DECK_CORE_HEIGHT = DECK_CORE_TOP_Y - DECK_CORE_BOTTOM_Y;
const DECK_CORE_CENTRE_Y = DECK_CORE_BOTTOM_Y + DECK_CORE_HEIGHT / 2;
const CARPET_BORDER = 0.044;
const EDGE_TRIM_DEPTH = 0.044;
const EDGE_TRIM_HEIGHT = PLATFORM_HEIGHT_METRES - DECK_CORE_BOTTOM_Y;
const EDGE_TRIM_CENTRE_Y = DECK_CORE_BOTTOM_Y + EDGE_TRIM_HEIGHT / 2;

const FRAME_LONG_RAIL_LENGTH = 2.24;
const FRAME_SHORT_RAIL_LENGTH = 0.99;
const FRAME_RAIL_THICKNESS = 0.044;
const FRAME_RAIL_CENTRE_Y = 0.326;
const FRAME_LONG_RAIL_Z = 0.53;
const FRAME_SHORT_RAIL_X = 1.1;
const CROSSMEMBER_LENGTH = 1.06;
const CROSSMEMBER_HEIGHT = 0.032;
const CROSSMEMBER_CENTRE_Y = 0.309;
const CROSSMEMBER_X_OFFSETS = [-0.74, 0, 0.74] as const;

const LEG_X_OFFSET = 1.075;
const LEG_Z_OFFSET = 0.495;
const LEG_POST_WIDTH = 0.06;
const LEG_POST_BOTTOM_Y = 0.025;
const LEG_POST_TOP_Y = 0.315;
const LEG_POST_HEIGHT = LEG_POST_TOP_Y - LEG_POST_BOTTOM_Y;
const LEG_POST_CENTRE_Y = LEG_POST_BOTTOM_Y + LEG_POST_HEIGHT / 2;
const FOOT_CAP_WIDTH = 0.076;
const FOOT_CAP_HEIGHT = 0.035;
const LOCK_PLATE_WIDTH = 0.13;
const LOCK_PLATE_HEIGHT = 0.052;
const LOCK_PLATE_DEPTH = 0.012;
const LOCK_PLATE_CENTRE_Y = 0.305;
const LOCK_PLATE_FACE_Z = 0.04;
const LOCK_BOLT_RADIUS = 0.008;
const LOCK_BOLT_DEPTH = 0.008;
const LOCK_BOLT_X_OFFSET = 0.035;
const BRACE_THICKNESS = 0.025;
const BRACE_LOWER_Y = 0.135;
const BRACE_UPPER_Y = 0.344;
const BRACE_INSET_X = 0.33;
const BRACE_Z_OFFSET = 0.495;
const BRACE_HINGE_RADIUS = 0.009;
const BRACE_HINGE_DEPTH = 0.01;

const CARPET_TEXTURE_SIZE = 64;
const EXPLODE_WITH_PARENT = true;
const Y_AXIS = new Vector3(0, 1, 0);

type Vector3Tuple = readonly [number, number, number];

export interface PlatformProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface PlatformMaterials {
  readonly carpet: MeshStandardMaterial;
  readonly deckCore: MeshStandardMaterial;
  readonly trim: MeshStandardMaterial;
  readonly aluminium: MeshStandardMaterial;
  readonly lock: MeshStandardMaterial;
  readonly fastener: MeshStandardMaterial;
  readonly rubber: MeshStandardMaterial;
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

interface DeckBuildResult {
  readonly deck: Group;
  readonly details: readonly Group[];
}

interface LegBuildResult {
  readonly id: string;
  readonly leg: Group;
  readonly hardware: readonly Group[];
}

function boxCollider(size: Vector3Tuple): BoxColliderDescriptor {
  return { shape: "box", size };
}

function cylinderCollider(radius: number, height: number): CylinderColliderDescriptor {
  return { shape: "cylinder", radius, height };
}

function createCarpetTexture(): DataTexture {
  const pixels = new Uint8Array(CARPET_TEXTURE_SIZE * CARPET_TEXTURE_SIZE * 4);
  for (let y = 0; y < CARPET_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < CARPET_TEXTURE_SIZE; x += 1) {
      const crossing = ((x * 13 + y * 17 + (x ^ y) * 3) % 19) - 9;
      const fibre = Math.round(Math.sin(x * 1.73 + y * 0.61) * 3);
      const shade = 47 + crossing + fibre;
      const index = (y * CARPET_TEXTURE_SIZE + x) * 4;
      pixels[index] = shade;
      pixels[index + 1] = shade + 1;
      pixels[index + 2] = shade + 2;
      pixels[index + 3] = 255;
    }
  }
  const texture = new DataTexture(pixels, CARPET_TEXTURE_SIZE, CARPET_TEXTURE_SIZE);
  texture.name = "platform-charcoal-carpet-weave";
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(8, 4);
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createMaterials(): PlatformMaterials {
  return {
    carpet: new MeshStandardMaterial({
      map: createCarpetTexture(), metalness: 0, roughness: 0.98, side: FrontSide,
    }),
    deckCore: new MeshStandardMaterial({
      color: 0x242526, metalness: 0, roughness: 0.82, side: FrontSide,
    }),
    trim: new MeshStandardMaterial({
      color: 0x111315, metalness: 0.18, roughness: 0.58, side: FrontSide,
    }),
    aluminium: new MeshStandardMaterial({
      color: 0xa7adb0, metalness: 0.86, roughness: 0.34, side: FrontSide,
    }),
    lock: new MeshStandardMaterial({
      color: 0x4b5053, metalness: 0.72, roughness: 0.38, side: FrontSide,
    }),
    fastener: new MeshStandardMaterial({
      color: 0xc4c8ca, metalness: 0.92, roughness: 0.25, side: FrontSide,
    }),
    rubber: new MeshStandardMaterial({
      color: 0x151617, metalness: 0, roughness: 0.86, side: FrontSide,
    }),
  };
}

function namedGroup(id: string): Group {
  const pivot = new Group();
  pivot.name = `${id}__pivot`;
  pivot.userData.componentId = id;
  return pivot;
}

function configureMesh(
  mesh: Mesh,
  id: string,
  options: PlatformProxyOptions,
): Mesh {
  mesh.name = `${id}__mesh`;
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  mesh.frustumCulled = true;
  mesh.userData.componentId = id;
  return mesh;
}

function markSubordinateDetail(pivot: Group, mesh: Mesh): void {
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
  options: PlatformProxyOptions,
  collider: ColliderDescriptor,
  subordinate = false,
): Group {
  const pivot = namedGroup(id);
  pivot.position.set(...position);
  const mesh = configureMesh(new Mesh(geometry, material), id, options);
  if (subordinate) markSubordinateDetail(pivot, mesh);
  pivot.add(mesh);
  parent.add(pivot);
  registerPart(registry, id, pivot, mesh, collider);
  return pivot;
}

function createBoxPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  size: Vector3Tuple,
  position: Vector3Tuple,
  material: Material,
  options: PlatformProxyOptions,
  subordinate = false,
): Group {
  return createPart(
    parent,
    registry,
    id,
    new BoxGeometry(...size),
    material,
    position,
    options,
    boxCollider(size),
    subordinate,
  );
}

function createDeck(
  root: Group,
  registry: RuntimeRegistry,
  materials: PlatformMaterials,
  options: PlatformProxyOptions,
): DeckBuildResult {
  const deck = createBoxPart(
    root,
    registry,
    "deck",
    [PLATFORM_WIDTH_METRES, DECK_CORE_HEIGHT, PLATFORM_DEPTH_METRES],
    [0, DECK_CORE_CENTRE_Y, 0],
    materials.deckCore,
    options,
  );
  const localY = (globalY: number): number => globalY - DECK_CORE_CENTRE_Y;
  const details = [
    createBoxPart(deck, registry, "deck-carpet-detail", [
      PLATFORM_WIDTH_METRES - CARPET_BORDER * 2,
      CARPET_THICKNESS,
      PLATFORM_DEPTH_METRES - CARPET_BORDER * 2,
    ], [0, localY(PLATFORM_HEIGHT_METRES - CARPET_THICKNESS / 2), 0], materials.carpet, options, true),
    createBoxPart(deck, registry, "front-edge-trim-detail", [
      PLATFORM_WIDTH_METRES, EDGE_TRIM_HEIGHT, EDGE_TRIM_DEPTH,
    ], [0, localY(EDGE_TRIM_CENTRE_Y), PLATFORM_DEPTH_METRES / 2 - EDGE_TRIM_DEPTH / 2], materials.trim, options, true),
    createBoxPart(deck, registry, "rear-edge-trim-detail", [
      PLATFORM_WIDTH_METRES, EDGE_TRIM_HEIGHT, EDGE_TRIM_DEPTH,
    ], [0, localY(EDGE_TRIM_CENTRE_Y), -PLATFORM_DEPTH_METRES / 2 + EDGE_TRIM_DEPTH / 2], materials.trim, options, true),
    createBoxPart(deck, registry, "left-edge-trim-detail", [
      EDGE_TRIM_DEPTH, EDGE_TRIM_HEIGHT, PLATFORM_DEPTH_METRES - EDGE_TRIM_DEPTH * 2,
    ], [-PLATFORM_WIDTH_METRES / 2 + EDGE_TRIM_DEPTH / 2, localY(EDGE_TRIM_CENTRE_Y), 0], materials.trim, options, true),
    createBoxPart(deck, registry, "right-edge-trim-detail", [
      EDGE_TRIM_DEPTH, EDGE_TRIM_HEIGHT, PLATFORM_DEPTH_METRES - EDGE_TRIM_DEPTH * 2,
    ], [PLATFORM_WIDTH_METRES / 2 - EDGE_TRIM_DEPTH / 2, localY(EDGE_TRIM_CENTRE_Y), 0], materials.trim, options, true),
  ];
  return { deck, details };
}

function createPerimeterFrame(
  root: Group,
  registry: RuntimeRegistry,
  material: Material,
  options: PlatformProxyOptions,
): readonly Group[] {
  return [
    createBoxPart(root, registry, "front-perimeter-rail", [
      FRAME_LONG_RAIL_LENGTH, FRAME_RAIL_THICKNESS, FRAME_RAIL_THICKNESS,
    ], [0, FRAME_RAIL_CENTRE_Y, FRAME_LONG_RAIL_Z], material, options),
    createBoxPart(root, registry, "rear-perimeter-rail", [
      FRAME_LONG_RAIL_LENGTH, FRAME_RAIL_THICKNESS, FRAME_RAIL_THICKNESS,
    ], [0, FRAME_RAIL_CENTRE_Y, -FRAME_LONG_RAIL_Z], material, options),
    createBoxPart(root, registry, "left-perimeter-rail", [
      FRAME_RAIL_THICKNESS, FRAME_RAIL_THICKNESS, FRAME_SHORT_RAIL_LENGTH,
    ], [-FRAME_SHORT_RAIL_X, FRAME_RAIL_CENTRE_Y, 0], material, options),
    createBoxPart(root, registry, "right-perimeter-rail", [
      FRAME_RAIL_THICKNESS, FRAME_RAIL_THICKNESS, FRAME_SHORT_RAIL_LENGTH,
    ], [FRAME_SHORT_RAIL_X, FRAME_RAIL_CENTRE_Y, 0], material, options),
  ];
}

function createCrossmembers(
  root: Group,
  registry: RuntimeRegistry,
  material: Material,
  options: PlatformProxyOptions,
): readonly Group[] {
  return CROSSMEMBER_X_OFFSETS.map((x, index) => createBoxPart(
    root,
    registry,
    `underframe-crossmember-${String(index + 1)}`,
    [FRAME_RAIL_THICKNESS, CROSSMEMBER_HEIGHT, CROSSMEMBER_LENGTH],
    [x, CROSSMEMBER_CENTRE_Y, 0],
    material,
    options,
  ));
}

function addLegHardware(
  leg: Group,
  registry: RuntimeRegistry,
  id: string,
  zDirection: -1 | 1,
  materials: PlatformMaterials,
  options: PlatformProxyOptions,
): readonly Group[] {
  const foot = createBoxPart(
    leg, registry, `${id}-rubber-foot-detail`,
    [FOOT_CAP_WIDTH, FOOT_CAP_HEIGHT, FOOT_CAP_WIDTH],
    [0, FOOT_CAP_HEIGHT / 2 - LEG_POST_CENTRE_Y, 0], materials.rubber, options, true,
  );
  const plate = createBoxPart(
    leg, registry, `${id}-corner-lock-detail`,
    [LOCK_PLATE_WIDTH, LOCK_PLATE_HEIGHT, LOCK_PLATE_DEPTH],
    [0, LOCK_PLATE_CENTRE_Y - LEG_POST_CENTRE_Y, zDirection * LOCK_PLATE_FACE_Z],
    materials.lock, options, true,
  );
  const bolts = ([-1, 1] as const).map((xDirection) => {
    const bolt = createPart(
      leg, registry, `${id}-${xDirection < 0 ? "left" : "right"}-lock-bolt-detail`,
      new CylinderGeometry(LOCK_BOLT_RADIUS, LOCK_BOLT_RADIUS, LOCK_BOLT_DEPTH, 12, 1),
      materials.fastener,
      [xDirection * LOCK_BOLT_X_OFFSET, LOCK_PLATE_CENTRE_Y - LEG_POST_CENTRE_Y, zDirection * (LOCK_PLATE_FACE_Z + LOCK_PLATE_DEPTH)],
      options,
      cylinderCollider(LOCK_BOLT_RADIUS, LOCK_BOLT_DEPTH),
      true,
    );
    bolt.rotation.x = Math.PI / 2;
    return bolt;
  });
  return [foot, plate, ...bolts];
}

function createLeg(
  root: Group,
  registry: RuntimeRegistry,
  corner: "front-left" | "front-right" | "rear-left" | "rear-right",
  x: number,
  z: number,
  materials: PlatformMaterials,
  options: PlatformProxyOptions,
): LegBuildResult {
  const id = `${corner}-leg`;
  const leg = createBoxPart(
    root, registry, id,
    [LEG_POST_WIDTH, LEG_POST_HEIGHT, LEG_POST_WIDTH],
    [x, LEG_POST_CENTRE_Y, z], materials.aluminium, options,
  );
  const zDirection: -1 | 1 = z < 0 ? -1 : 1;
  const hardware = addLegHardware(leg, registry, id, zDirection, materials, options);
  return { id, leg, hardware };
}

function createLegs(
  root: Group,
  registry: RuntimeRegistry,
  materials: PlatformMaterials,
  options: PlatformProxyOptions,
): readonly LegBuildResult[] {
  return [
    createLeg(root, registry, "front-left", -LEG_X_OFFSET, LEG_Z_OFFSET, materials, options),
    createLeg(root, registry, "front-right", LEG_X_OFFSET, LEG_Z_OFFSET, materials, options),
    createLeg(root, registry, "rear-left", -LEG_X_OFFSET, -LEG_Z_OFFSET, materials, options),
    createLeg(root, registry, "rear-right", LEG_X_OFFSET, -LEG_Z_OFFSET, materials, options),
  ];
}

function createDiagonalBrace(
  root: Group,
  registry: RuntimeRegistry,
  id: string,
  start: Vector3Tuple,
  end: Vector3Tuple,
  materials: PlatformMaterials,
  options: PlatformProxyOptions,
): Group {
  const startPoint = new Vector3(...start);
  const direction = new Vector3(...end).sub(startPoint);
  const length = direction.length();
  const brace = createPart(
    root, registry, id,
    new BoxGeometry(BRACE_THICKNESS, length, BRACE_THICKNESS),
    materials.aluminium, start, options,
    boxCollider([BRACE_THICKNESS, length, BRACE_THICKNESS]),
  );
  const mesh = registry.meshes[id];
  if (mesh === undefined) throw new Error(`platform brace ${id} is missing its mesh`);
  mesh.position.copy(direction).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.clone().normalize());
  const hinge = createPart(
    brace, registry, `${id}-upper-hinge-detail`,
    new CylinderGeometry(BRACE_HINGE_RADIUS, BRACE_HINGE_RADIUS, BRACE_HINGE_DEPTH, 12, 1),
    materials.fastener, [direction.x, direction.y, direction.z], options,
    cylinderCollider(BRACE_HINGE_RADIUS, BRACE_HINGE_DEPTH), true,
  );
  hinge.rotation.x = Math.PI / 2;
  return brace;
}

function createDiagonalBraces(
  root: Group,
  registry: RuntimeRegistry,
  materials: PlatformMaterials,
  options: PlatformProxyOptions,
): readonly Group[] {
  const braces: Group[] = [];
  for (const xDirection of [-1, 1] as const) {
    for (const zDirection of [-1, 1] as const) {
      const x = xDirection * LEG_X_OFFSET;
      const z = zDirection * BRACE_Z_OFFSET;
      const side = zDirection > 0 ? "front" : "rear";
      const hand = xDirection < 0 ? "left" : "right";
      braces.push(createDiagonalBrace(
        root, registry, `${side}-${hand}-diagonal-brace`,
        [x, BRACE_LOWER_Y, z],
        [x - xDirection * BRACE_INSET_X, BRACE_UPPER_Y, z],
        materials, options,
      ));
    }
  }
  return braces;
}

function addSocket(
  root: Group,
  registry: RuntimeRegistry,
  id: string,
  position: Vector3Tuple,
): Object3D {
  const socket = new Object3D();
  socket.name = `${id}__socket`;
  socket.position.set(...position);
  root.add(socket);
  registry.sockets[id] = socket;
  return socket;
}

function createRuntimeRegistry(root: Group): RuntimeRegistry {
  return {
    nodes: { root },
    meshes: {},
    sockets: {},
    colliders: {
      root: boxCollider([PLATFORM_WIDTH_METRES, PLATFORM_HEIGHT_METRES, PLATFORM_DEPTH_METRES]),
    },
    destructionGroups: {},
  };
}

function publishDestructionGroups(
  registry: RuntimeRegistry,
  deck: DeckBuildResult,
  frame: readonly Group[],
  crossmembers: readonly Group[],
  legs: readonly LegBuildResult[],
  braces: readonly Group[],
): void {
  registry.destructionGroups["deck-assembly"] = [deck.deck, ...deck.details];
  registry.destructionGroups["perimeter-frame"] = [...frame, ...crossmembers];
  registry.destructionGroups.legs = legs.map(({ leg }) => leg);
  registry.destructionGroups["diagonal-braces"] = [...braces];
  registry.destructionGroups["corner-hardware"] = legs.flatMap(({ hardware }) => hardware);
  for (const { id, leg } of legs) registry.destructionGroups[`${id}-assembly`] = [leg];
}

/**
 * Builds the evidence-derived, stylized modular stage-platform proxy in metres.
 * The generated reference is a single view, so hidden folding joints use a
 * symmetric structural approximation and remain presentation-only evidence.
 */
export function createPlatformProxy(options: PlatformProxyOptions = {}): Group {
  const root = namedGroup("root");
  root.name = "platform-proxy";
  root.userData.provenance = "img2threejs-platform-evidence";
  const registry = createRuntimeRegistry(root);
  const materials = createMaterials();
  const deck = createDeck(root, registry, materials, options);
  const frame = createPerimeterFrame(root, registry, materials.aluminium, options);
  const crossmembers = createCrossmembers(root, registry, materials.aluminium, options);
  const legs = createLegs(root, registry, materials, options);
  const braces = createDiagonalBraces(root, registry, materials, options);

  addSocket(root, registry, "floor-contact", [0, 0, 0]);
  addSocket(root, registry, "deck-support-plane", [0, PLATFORM_HEIGHT_METRES, 0]);
  addSocket(root, registry, "stack-centre", [0, PLATFORM_HEIGHT_METRES, 0]);
  publishDestructionGroups(registry, deck, frame, crossmembers, legs, braces);

  root.userData.canonicalDimensionsMetres = [
    PLATFORM_WIDTH_METRES, PLATFORM_HEIGHT_METRES, PLATFORM_DEPTH_METRES,
  ];
  root.userData.operationalSupportPlaneY = PLATFORM_HEIGHT_METRES;
  root.userData.evidenceSource = "artifacts/img2threejs/platform";
  root.userData.sculptRuntime = registry satisfies Img2ThreeSculptRuntime;
  return root;
}
