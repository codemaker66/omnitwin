import {
  CylinderGeometry,
  DataTexture,
  FrontSide,
  Group,
  LinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { Img2ThreeSculptRuntime } from "../../../lib/furniture-presentation-runtime.js";

const WIDTH_METRES = 0.36;
const HEIGHT_METRES = 0.25;
const DEPTH_METRES = 0.25;
const TEXTURE_SIZE = 64;
const DISPLAY_ANGLE_RADIANS = 0.135;
const DISPLAY_HINGE_Y = 0.021;
const DISPLAY_HINGE_Z = 0.088;
const DISPLAY_DEPTH = 0.008;
const DISPLAY_LENGTH =
  (HEIGHT_METRES - DISPLAY_HINGE_Y - (DISPLAY_DEPTH / 2) * Math.sin(DISPLAY_ANGLE_RADIANS))
  / Math.cos(DISPLAY_ANGLE_RADIANS);

type Vector3Tuple = readonly [number, number, number];
type MaterialFamily = "glass" | "graphite" | "hinge" | "polymer" | "rubber";
type TextureChannel = "albedo" | "ao" | "bump" | "normal" | "roughness";

export interface LaptopProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface LaptopMaterials {
  readonly glass: MeshPhysicalMaterial;
  readonly graphite: MeshPhysicalMaterial;
  readonly hinge: MeshPhysicalMaterial;
  readonly polymer: MeshStandardMaterial;
  readonly rubber: MeshStandardMaterial;
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
  readonly axis: "x";
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

interface LaptopParts {
  readonly base: readonly Object3D[];
  readonly display: readonly Object3D[];
  readonly hinges: readonly Object3D[];
  readonly input: readonly Object3D[];
}

interface KeyDefinition {
  readonly id: string;
  readonly width: number;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function deterministicNoise(x: number, y: number, seed: number): number {
  const mixed = x * 47 + y * 89 + seed * 131 + ((x * y + seed) % 37) * 19;
  return ((mixed % 43) / 21) - 1;
}

function surfaceSignal(family: MaterialFamily, x: number, y: number): number {
  const seed = family === "graphite"
    ? 3
    : family === "glass"
      ? 7
      : family === "hinge"
        ? 11
        : family === "polymer"
          ? 17
          : 23;
  const noise = deterministicNoise(x, y, seed);
  if (family === "graphite") return Math.sin(x * 2.4) * 0.72 + noise * 0.28;
  if (family === "hinge") return Math.sin(x * 3.8) * 0.82 + noise * 0.18;
  if (family === "glass") return Math.sin((x + y) * 0.18) * 0.25 + noise * 0.12;
  if (family === "polymer") return noise * 0.62 + Math.sin((x - y) * 0.71) * 0.18;
  return noise * 0.75 + Math.sin((x + y) * 0.55) * 0.2;
}

function materialBase(family: MaterialFamily, channel: TextureChannel): number {
  if (channel === "ao") return family === "glass" ? 250 : 242;
  if (channel === "bump") return 128;
  if (channel === "roughness") {
    if (family === "glass") return 45;
    if (family === "graphite") return 87;
    if (family === "hinge") return 71;
    if (family === "polymer") return 139;
    return 216;
  }
  if (family === "glass") return 43;
  if (family === "graphite") return 73;
  if (family === "hinge") return 88;
  if (family === "polymer") return 12;
  return 14;
}

function writeTexturePixel(
  pixels: Uint8Array,
  index: number,
  family: MaterialFamily,
  channel: TextureChannel,
  signal: number,
): void {
  if (channel === "normal") {
    const xStrength = family === "graphite" || family === "hinge" ? 3 : 4;
    pixels[index] = clampByte(128 + signal * xStrength);
    pixels[index + 1] = clampByte(128 + signal * 2);
    pixels[index + 2] = 255;
  } else {
    const amplitude = channel === "albedo"
      ? family === "glass" ? 2 : family === "graphite" || family === "hinge" ? 1.5 : 3
      : channel === "roughness"
        ? family === "graphite" || family === "hinge" ? 4 : 8
        : channel === "ao"
          ? 3
          : 5;
    const value = clampByte(materialBase(family, channel) + signal * amplitude);
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
      writeTexturePixel(pixels, index, family, channel, surfaceSignal(family, x, y));
    }
  }
  const texture = new DataTexture(pixels, TEXTURE_SIZE, TEXTURE_SIZE);
  texture.name = `laptop-${family}-${channel}`;
  texture.colorSpace = channel === "albedo" ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  const repeat: readonly [number, number] = family === "graphite"
    ? [5, 3]
    : family === "hinge"
      ? [5, 1]
      : family === "glass"
        ? [1, 1]
        : [3, 3];
  texture.repeat.set(...repeat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  if (channel === "ao") texture.channel = 0;
  texture.needsUpdate = true;
  return texture;
}

function createPhysicalMaterial(
  family: "glass" | "graphite" | "hinge",
): MeshPhysicalMaterial {
  const isGlass = family === "glass";
  const isGraphite = family === "graphite";
  const material = new MeshPhysicalMaterial({
    map: createTexture(family, "albedo"),
    aoMap: createTexture(family, "ao"),
    aoMapIntensity: isGlass ? 0.08 : 0.2,
    bumpMap: createTexture(family, "bump"),
    bumpScale: isGlass ? 0.000006 : 0.000025,
    clearcoat: isGlass ? 0.4 : isGraphite ? 0.05 : 0.18,
    clearcoatRoughness: isGlass ? 0.16 : 0.3,
    metalness: isGlass ? 0 : isGraphite ? 0.72 : 0.9,
    normalMap: createTexture(family, "normal"),
    normalScale: new Vector2(isGlass ? 0.02 : 0.06, isGlass ? 0.02 : 0.025),
    roughness: isGlass ? 0.18 : isGraphite ? 0.38 : 0.28,
    roughnessMap: createTexture(family, "roughness"),
    side: FrontSide,
  });
  material.name = `laptop-${family}-material`;
  return material;
}

function createStandardMaterial(family: "polymer" | "rubber"): MeshStandardMaterial {
  const isRubber = family === "rubber";
  const material = new MeshStandardMaterial({
    map: createTexture(family, "albedo"),
    aoMap: createTexture(family, "ao"),
    aoMapIntensity: isRubber ? 0.26 : 0.2,
    bumpMap: createTexture(family, "bump"),
    bumpScale: isRubber ? 0.000025 : 0.000015,
    metalness: 0,
    normalMap: createTexture(family, "normal"),
    normalScale: new Vector2(isRubber ? 0.08 : 0.045, isRubber ? 0.08 : 0.045),
    roughness: isRubber ? 0.84 : 0.64,
    roughnessMap: createTexture(family, "roughness"),
    side: FrontSide,
  });
  material.name = `laptop-${family}-material`;
  return material;
}

function createMaterials(): LaptopMaterials {
  return {
    glass: createPhysicalMaterial("glass"),
    graphite: createPhysicalMaterial("graphite"),
    hinge: createPhysicalMaterial("hinge"),
    polymer: createStandardMaterial("polymer"),
    rubber: createStandardMaterial("rubber"),
  };
}

function boxCollider(size: Vector3Tuple): BoxColliderDescriptor {
  return { shape: "box", size, approximate: true, authority: "presentation-only" };
}

function cylinderCollider(radius: number, height: number): CylinderColliderDescriptor {
  return { shape: "cylinder", radius, height, axis: "x", approximate: true, authority: "presentation-only" };
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
  followsParent = false,
): Group {
  const container = namedPivot(id);
  container.userData.semanticAssembly = true;
  container.userData.explodeWithParent = followsParent;
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
  options: LaptopProxyOptions,
  followsParent = false,
): Group {
  const pivot = namedPivot(id);
  pivot.position.set(...position);
  pivot.userData.explodeWithParent = followsParent;
  const mesh = new Mesh(geometry, material);
  mesh.name = `${id}__mesh`;
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  mesh.userData.componentId = id;
  mesh.userData.explodeWithParent = followsParent;
  pivot.add(mesh);
  parent.add(pivot);
  registry.nodes[id] = pivot;
  registry.meshes[id] = mesh;
  registry.colliders[id] = collider;
  return pivot;
}

function createRoundedPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  size: Vector3Tuple,
  radius: number,
  material: Material,
  position: Vector3Tuple,
  options: LaptopProxyOptions,
  followsParent = false,
  segments = 2,
): Group {
  return createPart(
    parent,
    registry,
    id,
    new RoundedBoxGeometry(...size, segments, radius),
    material,
    position,
    boxCollider(size),
    options,
    followsParent,
  );
}

const KEY_ROWS: readonly (readonly KeyDefinition[])[] = [
  Array.from({ length: 14 }, (_, index) => ({ id: `key-r0-c${String(index)}`, width: 0.018 })),
  [0.025, ...Array.from({ length: 12 }, () => 0.017), 0.025].map((width, index) => ({ id: `key-r1-c${String(index)}`, width })),
  [0.026, ...Array.from({ length: 11 }, () => 0.019), 0.026].map((width, index) => ({ id: `key-r2-c${String(index)}`, width })),
  [0.03, ...Array.from({ length: 11 }, () => 0.019), 0.03].map((width, index) => ({ id: `key-r3-c${String(index)}`, width })),
  [0.035, ...Array.from({ length: 10 }, () => 0.019), 0.035].map((width, index) => ({ id: `key-r4-c${String(index)}`, width })),
  [
    { id: "key-r5-c0", width: 0.027 },
    { id: "key-r5-c1", width: 0.027 },
    { id: "key-r5-c2", width: 0.027 },
    { id: "spacebar-key", width: 0.105 },
    { id: "key-r5-c4", width: 0.027 },
    { id: "key-r5-c5", width: 0.027 },
    { id: "key-r5-c6", width: 0.027 },
  ],
];

function rowWidth(row: readonly KeyDefinition[], gap: number): number {
  return row.reduce((sum, key) => sum + key.width, 0) + Math.max(0, row.length - 1) * gap;
}

function createKeyboard(
  base: Object3D,
  registry: RuntimeRegistry,
  materials: LaptopMaterials,
  options: LaptopProxyOptions,
): { readonly system: Group; readonly keys: readonly Group[] } {
  const bed = createRoundedPart(
    base,
    registry,
    "keyboard-bed",
    [0.326, 0.002, 0.105],
    0.004,
    materials.polymer,
    [0, 0.0233, 0.057],
    options,
  );
  const system = createContainer(
    bed,
    registry,
    "keyboard-key-system",
    boxCollider([0.31, 0.004, 0.095]),
  );
  const gap = 0.003;
  const keyDepth = 0.013;
  const rowPitch = 0.016;
  const firstRowZ = 0.040;
  const keys: Group[] = [];
  KEY_ROWS.forEach((row, rowIndex) => {
    let cursor = -rowWidth(row, gap) / 2;
    for (const key of row) {
      const centreX = cursor + key.width / 2;
      const keyPart = createRoundedPart(
        system,
        registry,
        key.id,
        [key.width, 0.0035, keyDepth],
        0.0014,
        materials.polymer,
        [centreX, 0.003, firstRowZ - rowIndex * rowPitch],
        options,
        true,
        1,
      );
      keys.push(keyPart);
      cursor += key.width + gap;
    }
  });
  return { system, keys };
}

function createFeet(
  base: Object3D,
  registry: RuntimeRegistry,
  material: MeshStandardMaterial,
  options: LaptopProxyOptions,
): { readonly system: Group; readonly feet: readonly Group[] } {
  const system = createContainer(base, registry, "foot-system", boxCollider([0.33, 0.004, 0.21]));
  const positions = [
    ["front-left", [-0.145, 0.002, -0.097]],
    ["front-right", [0.145, 0.002, -0.097]],
    ["rear-left", [-0.145, 0.002, 0.097]],
    ["rear-right", [0.145, 0.002, 0.097]],
  ] as const satisfies readonly (readonly [string, Vector3Tuple])[];
  const feet = positions.map(([name, position]) => createRoundedPart(
    system,
    registry,
    `foot-${name}`,
    [0.032, 0.004, 0.012],
    0.002,
    material,
    position,
    options,
    true,
    1,
  ));
  return { system, feet };
}

function createPorts(
  base: Object3D,
  registry: RuntimeRegistry,
  material: MeshStandardMaterial,
  options: LaptopProxyOptions,
): { readonly system: Group; readonly ports: readonly Group[] } {
  const system = createContainer(base, registry, "left-port-system", boxCollider([0.001, 0.008, 0.055]));
  const definitions = [
    ["rear", 0.072, 0.015],
    ["middle", 0.051, 0.011],
    ["front", 0.034, 0.008],
  ] as const;
  const ports = definitions.map(([name, z, depth]) => createRoundedPart(
    system,
    registry,
    `port-recess-${name}`,
    [0.001, 0.006, depth],
    0.0004,
    material,
    [-0.1795, 0.0145, z],
    options,
    true,
    1,
  ));
  return { system, ports };
}

function createBase(
  root: Group,
  registry: RuntimeRegistry,
  materials: LaptopMaterials,
  options: LaptopProxyOptions,
): { readonly assembly: Group; readonly parts: readonly Object3D[]; readonly input: readonly Object3D[] } {
  const assembly = createContainer(root, registry, "base-assembly", boxCollider([0.36, 0.029, 0.25]));
  const shell = createRoundedPart(
    assembly,
    registry,
    "base-shell",
    [WIDTH_METRES, 0.018, DEPTH_METRES],
    0.006,
    materials.graphite,
    [0, 0.013, 0],
    options,
  );
  const deck = createRoundedPart(
    assembly,
    registry,
    "upper-deck",
    [0.35, 0.004, 0.238],
    0.004,
    materials.graphite,
    [0, 0.022, 0],
    options,
  );
  const seam = createRoundedPart(
    assembly,
    registry,
    "front-shell-seam",
    [0.335, 0.0012, 0.001],
    0.0004,
    materials.polymer,
    [0, 0.017, -0.1245],
    options,
    true,
    1,
  );
  const trackpad = createRoundedPart(
    assembly,
    registry,
    "trackpad",
    [0.13, 0.0015, 0.072],
    0.006,
    materials.graphite,
    [0, 0.0237, -0.071],
    options,
  );
  const keyboard = createKeyboard(assembly, registry, materials, options);
  const feet = createFeet(assembly, registry, materials.rubber, options);
  const ports = createPorts(assembly, registry, materials.polymer, options);
  return {
    assembly,
    parts: [shell, deck, seam, feet.system, ports.system],
    input: [trackpad, keyboard.system],
  };
}

function createHinges(
  root: Group,
  registry: RuntimeRegistry,
  material: MeshPhysicalMaterial,
  options: LaptopProxyOptions,
): { readonly system: Group; readonly barrels: readonly Group[] } {
  const system = createContainer(root, registry, "hinge-system", boxCollider([0.298, 0.012, 0.012]));
  const barrels = ([-1, 1] as const).map((side) => {
    const geometry = new CylinderGeometry(0.006, 0.006, 0.052, 32);
    geometry.rotateZ(Math.PI / 2);
    return createPart(
      system,
      registry,
      side < 0 ? "hinge-left" : "hinge-right",
      geometry,
      material,
      [side * 0.124, DISPLAY_HINGE_Y, DISPLAY_HINGE_Z],
      cylinderCollider(0.006, 0.052),
      options,
      true,
    );
  });
  return { system, barrels };
}

function createDisplay(
  root: Group,
  registry: RuntimeRegistry,
  materials: LaptopMaterials,
  options: LaptopProxyOptions,
): { readonly assembly: Group; readonly parts: readonly Object3D[] } {
  const assembly = createContainer(
    root,
    registry,
    "display-assembly",
    boxCollider([0.348, DISPLAY_LENGTH, DISPLAY_DEPTH]),
  );
  assembly.position.set(0, DISPLAY_HINGE_Y, DISPLAY_HINGE_Z);
  assembly.rotation.x = DISPLAY_ANGLE_RADIANS;

  const shell = createRoundedPart(
    assembly,
    registry,
    "display-shell",
    [0.348, DISPLAY_LENGTH, DISPLAY_DEPTH],
    0.006,
    materials.graphite,
    [0, DISPLAY_LENGTH / 2, 0],
    options,
  );
  const bezelHeight = DISPLAY_LENGTH - 0.012;
  const bezel = createRoundedPart(
    assembly,
    registry,
    "bezel",
    [0.338, bezelHeight, 0.002],
    0.0045,
    materials.polymer,
    [0, DISPLAY_LENGTH / 2, -0.005],
    options,
  );
  const screenHeight = DISPLAY_LENGTH - 0.043;
  const screen = createRoundedPart(
    assembly,
    registry,
    "screen-surface",
    [0.308, screenHeight, 0.0015],
    0.003,
    materials.glass,
    [0, DISPLAY_LENGTH / 2 - 0.003, -0.0067],
    options,
  );
  const cameraGeometry = new CylinderGeometry(0.00145, 0.00145, 0.0005, 24);
  cameraGeometry.rotateX(Math.PI / 2);
  const camera = createPart(
    assembly,
    registry,
    "camera-aperture",
    cameraGeometry,
    materials.glass,
    [0, DISPLAY_LENGTH - 0.0125, -0.0064],
    boxCollider([0.0029, 0.0029, 0.0005]),
    options,
    true,
  );
  return { assembly, parts: [shell, bezel, screen, camera] };
}

function createSocket(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  position: Vector3Tuple,
  rotationX = 0,
): void {
  const socket = new Object3D();
  socket.name = `${id}__socket`;
  socket.position.set(...position);
  socket.rotation.x = rotationX;
  parent.add(socket);
  registry.sockets[id] = socket;
}

function createSockets(root: Group, registry: RuntimeRegistry): void {
  createSocket(root, registry, "floor-contact", [0, 0, 0]);
  createSocket(root, registry, "display-hinge-axis", [0, DISPLAY_HINGE_Y, DISPLAY_HINGE_Z], DISPLAY_ANGLE_RADIANS);
  createSocket(root, registry, "keyboard-centre", [0, 0.029, 0.057]);
  createSocket(root, registry, "trackpad-centre", [0, 0.0255, -0.071]);
  createSocket(root, registry, "screen-centre", [0, 0.136, 0.1], DISPLAY_ANGLE_RADIANS);
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

function assignDestructionGroups(registry: RuntimeRegistry, parts: LaptopParts): void {
  registry.destructionGroups["base-shell"] = [...parts.base];
  registry.destructionGroups.display = [...parts.display];
  registry.destructionGroups.hinges = [...parts.hinges];
  registry.destructionGroups["input-deck"] = [...parts.input];
}

/**
 * Build an approximate open laptop in canonical metres.
 * The generated reference does not establish brand, key legends, ports,
 * internals, hidden manufacturing geometry, or physics-authoritative colliders.
 */
export function createLaptopProxy(options: LaptopProxyOptions = {}): Group {
  const root = new Group();
  root.name = "laptop";
  root.userData.componentId = "root";
  const registry = createRegistry(root);
  const materials = createMaterials();
  const base = createBase(root, registry, materials, options);
  const hinges = createHinges(root, registry, materials.hinge, options);
  const display = createDisplay(root, registry, materials, options);
  createSockets(root, registry);
  assignDestructionGroups(registry, {
    base: base.parts,
    display: display.parts,
    hinges: [hinges.system],
    input: base.input,
  });

  root.userData.canonicalDimensionsMetres = [WIDTH_METRES, HEIGHT_METRES, DEPTH_METRES];
  root.userData.fixedHingeAngleRadians = DISPLAY_ANGLE_RADIANS;
  root.userData.evidenceSource =
    "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#laptop";
  root.userData.evidenceImage =
    "packages/web/src/assets/generated-furniture/laptop-imagegen-v1.png";
  root.userData.provenance = "generated";
  root.userData.authority = "presentation-only";
  root.userData.measuredGeometry = false;
  root.userData.operational = false;
  root.userData.colliderAuthority = "metadata-only";
  root.userData.sculptRuntime = registry satisfies Img2ThreeSculptRuntime;
  return root;
}
