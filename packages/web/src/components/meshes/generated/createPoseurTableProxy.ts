import {
  CylinderGeometry,
  DataTexture,
  ExtrudeGeometry,
  FrontSide,
  Group,
  LatheGeometry,
  LinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  Object3D,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  type BufferGeometry,
  type Material,
} from "three";

import type { Img2ThreeSculptRuntime } from "../../../lib/furniture-presentation-runtime.js";

const WIDTH_METRES = 0.6;
const HEIGHT_METRES = 1.05;
const DEPTH_METRES = 0.6;
const TEXTURE_SIZE = 64;

type Vector3Tuple = readonly [number, number, number];
type MaterialFamily = "body" | "rubber" | "top";
type TextureChannel = "albedo" | "ao" | "bump" | "normal" | "roughness";

export interface PoseurTableProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface PoseurTableMaterials {
  readonly body: MeshPhysicalMaterial;
  readonly rubber: MeshStandardMaterial;
  readonly top: MeshPhysicalMaterial;
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
  readonly axis: "y";
  readonly approximate: true;
  readonly authority: "presentation-only";
}

type ColliderDescriptor = BoxColliderDescriptor | CylinderColliderDescriptor;

interface RuntimeRegistry {
  readonly nodes: Record<string, Object3D>;
  readonly meshes: Record<string, Mesh>;
  readonly sockets: Record<string, Object3D>;
  readonly colliders: Record<string, ColliderDescriptor>;
  readonly destructionGroups: Record<string, Object3D[]>;
}

interface PoseurParts {
  readonly tabletop: readonly Group[];
  readonly pedestal: readonly Group[];
  readonly base: readonly Group[];
  readonly feet: readonly Group[];
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function deterministicNoise(x: number, y: number): number {
  return (((x * 47 + y * 89 + ((x * y) % 37) * 19) % 41) / 20) - 1;
}

function surfaceSignal(family: MaterialFamily, x: number, y: number): number {
  const nx = (x + 0.5) / TEXTURE_SIZE - 0.5;
  const ny = (y + 0.5) / TEXTURE_SIZE - 0.5;
  if (family === "top") {
    const radius = Math.sqrt(nx * nx + ny * ny);
    return Math.sin(radius * Math.PI * 132) * 0.72 + deterministicNoise(x, y) * 0.28;
  }
  if (family === "body") {
    return Math.sin(x * 1.93) * 0.68 + deterministicNoise(x, y) * 0.32;
  }
  return deterministicNoise(x, y) * 0.75 + Math.sin((x + y) * 0.71) * 0.25;
}

function writeTexturePixel(
  pixels: Uint8Array,
  index: number,
  family: MaterialFamily,
  channel: TextureChannel,
  signal: number,
  x: number,
  y: number,
): void {
  const albedoBase = family === "top" ? 176 : family === "body" ? 157 : 21;
  const roughnessBase = family === "top" ? 82 : family === "body" ? 88 : 217;
  const variation = family === "top" ? 3 : family === "body" ? 2 : 4;
  if (channel === "normal") {
    const angle = Math.atan2(y - TEXTURE_SIZE / 2, x - TEXTURE_SIZE / 2);
    const normalX = family === "top" ? Math.cos(angle) * signal : signal;
    const normalY = family === "top" ? Math.sin(angle) * signal : signal * 0.15;
    pixels[index] = clampByte(128 + normalX * 9);
    pixels[index + 1] = clampByte(128 + normalY * 9);
    pixels[index + 2] = 255;
  } else {
    const base = channel === "albedo"
      ? albedoBase
      : channel === "roughness"
        ? roughnessBase
        : channel === "ao"
          ? 244
          : 128;
    const amplitude = channel === "ao" ? 3 : channel === "bump" ? 5 : variation;
    const value = clampByte(base + signal * amplitude);
    pixels[index] = value;
    pixels[index + 1] = value;
    pixels[index + 2] = value;
  }
  pixels[index + 3] = 255;
}

function createTexture(family: MaterialFamily, channel: TextureChannel): DataTexture {
  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const index = (y * TEXTURE_SIZE + x) * 4;
      writeTexturePixel(pixels, index, family, channel, surfaceSignal(family, x, y), x, y);
    }
  }
  const texture = new DataTexture(pixels, TEXTURE_SIZE, TEXTURE_SIZE);
  texture.name = `poseur-table-${family}-${channel}`;
  texture.colorSpace = channel === "albedo" ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  const repeat: readonly [number, number] = family === "body"
    ? [3, 8]
    : family === "rubber"
      ? [2, 2]
      : [1, 1];
  texture.repeat.set(repeat[0], repeat[1]);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  if (channel === "ao") texture.channel = 0;
  texture.needsUpdate = true;
  return texture;
}

function createMetalMaterial(family: "body" | "top"): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    map: createTexture(family, "albedo"),
    aoMap: createTexture(family, "ao"),
    aoMapIntensity: family === "top" ? 0.18 : 0.24,
    bumpMap: createTexture(family, "bump"),
    bumpScale: family === "top" ? 0.00006 : 0.00005,
    metalness: 1,
    normalMap: createTexture(family, "normal"),
    normalScale: new Vector2(family === "top" ? 0.06 : 0.035, family === "top" ? 0.06 : 0.018),
    roughness: family === "top" ? 0.32 : 0.35,
    roughnessMap: createTexture(family, "roughness"),
    side: FrontSide,
  });
  material.name = `poseur-table-${family}-brushed-stainless`;
  return material;
}

function createMaterials(): PoseurTableMaterials {
  const rubber = new MeshStandardMaterial({
    map: createTexture("rubber", "albedo"),
    aoMap: createTexture("rubber", "ao"),
    aoMapIntensity: 0.28,
    bumpMap: createTexture("rubber", "bump"),
    bumpScale: 0.00003,
    metalness: 0,
    normalMap: createTexture("rubber", "normal"),
    normalScale: new Vector2(0.08, 0.08),
    roughness: 0.84,
    roughnessMap: createTexture("rubber", "roughness"),
    side: FrontSide,
  });
  rubber.name = "poseur-table-black-rubber";
  return { body: createMetalMaterial("body"), rubber, top: createMetalMaterial("top") };
}

function boxCollider(size: Vector3Tuple): BoxColliderDescriptor {
  return { shape: "box", size, approximate: true, authority: "presentation-only" };
}

function cylinderCollider(radius: number, height: number): CylinderColliderDescriptor {
  return { shape: "cylinder", radius, height, axis: "y", approximate: true, authority: "presentation-only" };
}

function namedPivot(id: string): Group {
  const pivot = new Group();
  pivot.name = `${id}__pivot`;
  pivot.userData.componentId = id;
  return pivot;
}

function createContainer(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  collider: ColliderDescriptor,
): Group {
  const container = namedPivot(id);
  container.userData.semanticAssembly = true;
  container.userData.explodeWithParent = true;
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
  options: PoseurTableProxyOptions,
  rotationY = 0,
): Group {
  const pivot = namedPivot(id);
  pivot.position.set(...position);
  pivot.rotation.y = rotationY;
  const mesh = new Mesh(geometry, material);
  mesh.name = `${id}__mesh`;
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  mesh.userData.componentId = id;
  pivot.add(mesh);
  parent.add(pivot);
  registry.nodes[id] = pivot;
  registry.meshes[id] = mesh;
  registry.colliders[id] = collider;
  return pivot;
}

function createTabletop(
  root: Group,
  registry: RuntimeRegistry,
  materials: PoseurTableMaterials,
  options: PoseurTableProxyOptions,
): readonly Group[] {
  const assembly = createContainer(root, registry, "tabletop-assembly", cylinderCollider(0.3, 0.04));
  const surface = createPart(assembly, registry, "top-surface", new CylinderGeometry(0.292, 0.292, 0.014, 96), materials.top, [0, 1.043, 0], cylinderCollider(0.292, 0.014), options);
  const rimGeometry = new TorusGeometry(0.292, 0.008, 18, 96);
  rimGeometry.rotateX(Math.PI / 2);
  const rim = createPart(assembly, registry, "rolled-rim", rimGeometry, materials.top, [0, 1.036, 0], cylinderCollider(0.3, 0.016), options);
  const band = createPart(assembly, registry, "underside-band", new CylinderGeometry(0.285, 0.285, 0.014, 96), materials.body, [0, 1.023, 0], cylinderCollider(0.285, 0.014), options);
  const plate = createPart(assembly, registry, "underplate", new CylinderGeometry(0.245, 0.245, 0.01, 80), materials.body, [0, 1.015, 0], cylinderCollider(0.245, 0.01), options);
  return [surface, rim, band, plate];
}

function createPedestal(
  root: Group,
  registry: RuntimeRegistry,
  material: MeshPhysicalMaterial,
  options: PoseurTableProxyOptions,
): readonly Group[] {
  const assembly = createContainer(root, registry, "pedestal-assembly", cylinderCollider(0.052, 0.901));
  const upper = createPart(assembly, registry, "upper-collar", new CylinderGeometry(0.044, 0.047, 0.032, 64), material, [0, 1.002, 0], cylinderCollider(0.047, 0.032), options);
  const column = createPart(assembly, registry, "pedestal-column", new CylinderGeometry(0.025, 0.025, 0.84, 64), material, [0, 0.572, 0], cylinderCollider(0.025, 0.84), options);
  const lower = createPart(assembly, registry, "lower-collar", new CylinderGeometry(0.034, 0.052, 0.05, 64), material, [0, 0.142, 0], cylinderCollider(0.052, 0.05), options);
  return [upper, column, lower];
}

function createArmGeometry(): ExtrudeGeometry {
  const shape = new Shape();
  shape.moveTo(-0.055, 0.035);
  shape.lineTo(-0.032, 0.263);
  shape.quadraticCurveTo(-0.032, 0.278, 0, 0.278);
  shape.quadraticCurveTo(0.032, 0.278, 0.032, 0.263);
  shape.lineTo(0.055, 0.035);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 5,
    bevelSize: 0.012,
    bevelThickness: 0.009,
    curveSegments: 12,
    depth: 0.036,
    steps: 1,
  });
  geometry.center();
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

const ARM_DEFINITIONS = [
  ["north", [0, 0.083, -0.1565], Math.PI],
  ["east", [0.1565, 0.083, 0], Math.PI / 2],
  ["south", [0, 0.083, 0.1565], 0],
  ["west", [-0.1565, 0.083, 0], -Math.PI / 2],
] as const satisfies readonly (readonly [string, Vector3Tuple, number])[];

const FOOT_POSITIONS = [
  ["north", [0, 0, -0.278]],
  ["east", [0.278, 0, 0]],
  ["south", [0, 0, 0.278]],
  ["west", [-0.278, 0, 0]],
] as const satisfies readonly (readonly [string, Vector3Tuple])[];

function createFootPadGeometry(): LatheGeometry {
  return new LatheGeometry([
    new Vector2(0, 0),
    new Vector2(0.018, 0),
    new Vector2(0.022, 0.003),
    new Vector2(0.022, 0.008),
    new Vector2(0.018, 0.011),
    new Vector2(0.018, 0.015),
    new Vector2(0.012, 0.018),
    new Vector2(0, 0.018),
  ], 48);
}

function createBase(
  root: Group,
  registry: RuntimeRegistry,
  materials: PoseurTableMaterials,
  options: PoseurTableProxyOptions,
): { readonly base: readonly Group[]; readonly feet: readonly Group[] } {
  const assembly = createContainer(root, registry, "base-assembly", boxCollider([0.6, 0.14, 0.6]));
  const hub = createPart(assembly, registry, "central-hub", new CylinderGeometry(0.052, 0.06, 0.07, 64), materials.body, [0, 0.089, 0], cylinderCollider(0.06, 0.07), options);
  const armSystem = createContainer(assembly, registry, "star-arm-system", boxCollider([0.568, 0.054, 0.568]));
  const arms = ARM_DEFINITIONS.map(([direction, position, rotation]) => createPart(armSystem, registry, `arm-${direction}`, createArmGeometry(), materials.body, position, boxCollider([0.11, 0.054, 0.255]), options, rotation));
  const stemSystem = createContainer(assembly, registry, "foot-stem-system", boxCollider([0.574, 0.046, 0.574]));
  const stems = FOOT_POSITIONS.map(([direction, position]) => createPart(stemSystem, registry, `foot-stem-${direction}`, new CylinderGeometry(0.009, 0.0095, 0.046, 32), materials.rubber, [position[0], 0.035, position[2]], cylinderCollider(0.0095, 0.046), options));
  const padSystem = createContainer(assembly, registry, "foot-pad-system", boxCollider([0.6, 0.018, 0.6]));
  const pads = FOOT_POSITIONS.map(([direction, position]) => createPart(padSystem, registry, `foot-pad-${direction}`, createFootPadGeometry(), materials.rubber, position, cylinderCollider(0.022, 0.018), options));
  return { base: [hub, ...arms], feet: [...stems, ...pads] };
}

function createSocket(parent: Object3D, registry: RuntimeRegistry, id: string, position: Vector3Tuple): void {
  const socket = new Object3D();
  socket.name = `${id}__socket`;
  socket.position.set(...position);
  parent.add(socket);
  registry.sockets[id] = socket;
}

function createSockets(root: Group, registry: RuntimeRegistry): void {
  createSocket(root, registry, "floor-contact", [0, 0, 0]);
  createSocket(root, registry, "tabletop-centre", [0, 1.05, 0]);
  createSocket(root, registry, "top-to-pedestal", [0, 1.01, 0]);
  createSocket(root, registry, "pedestal-to-base", [0, 0.135, 0]);
  for (const [direction, position] of FOOT_POSITIONS) {
    createSocket(root, registry, `foot-${direction}`, position);
  }
}

function createRegistry(root: Group): RuntimeRegistry {
  return {
    nodes: { root },
    meshes: {},
    sockets: {},
    colliders: { root: boxCollider([WIDTH_METRES, HEIGHT_METRES, DEPTH_METRES]) },
    destructionGroups: {},
  };
}

function assignDestructionGroups(registry: RuntimeRegistry, parts: PoseurParts): void {
  registry.destructionGroups.tabletop = [...parts.tabletop];
  registry.destructionGroups.pedestal = [...parts.pedestal];
  registry.destructionGroups["star-base"] = [...parts.base];
  registry.destructionGroups["levelling-feet"] = [...parts.feet];
}

/**
 * Build an approximate uncloth poseur table in canonical metres.
 * The single ImageGen reference does not establish hidden fixings, exact
 * manufacturing geometry, load ratings, or physics-authoritative colliders.
 */
export function createPoseurTableProxy(options: PoseurTableProxyOptions = {}): Group {
  const root = new Group();
  root.name = "poseur-table";
  root.userData.componentId = "root";
  const registry = createRegistry(root);
  const materials = createMaterials();
  const tabletop = createTabletop(root, registry, materials, options);
  const pedestal = createPedestal(root, registry, materials.body, options);
  const { base, feet } = createBase(root, registry, materials, options);
  createSockets(root, registry);
  assignDestructionGroups(registry, { tabletop, pedestal, base, feet });

  root.userData.canonicalDimensionsMetres = [WIDTH_METRES, HEIGHT_METRES, DEPTH_METRES];
  root.userData.evidenceSource =
    "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#poseur-table";
  root.userData.evidenceImage =
    "packages/web/src/assets/generated-furniture/poseur-table-imagegen-v1.png";
  root.userData.provenance = "generated";
  root.userData.authority = "presentation-only";
  root.userData.measuredGeometry = false;
  root.userData.operational = false;
  root.userData.colliderAuthority = "metadata-only";
  root.userData.sculptRuntime = registry satisfies Img2ThreeSculptRuntime;
  return root;
}
