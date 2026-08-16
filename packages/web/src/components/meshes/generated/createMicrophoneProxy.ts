import {
  CatmullRomCurve3,
  CylinderGeometry,
  DataTexture,
  FrontSide,
  Group,
  InstancedMesh,
  LatheGeometry,
  LinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  Object3D,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { Img2ThreeSculptRuntime } from "../../../lib/furniture-presentation-runtime.js";

const WIDTH_METRES = 0.10;
const HEIGHT_METRES = 0.25;
const DEPTH_METRES = 0.10;
const TEXTURE_SIZE = 64;
const GOOSENECK_RIB_COUNT = 40;

type Vector3Tuple = readonly [number, number, number];
type MaterialFamily =
  | "base-polymer"
  | "coated-metal"
  | "grille-metal"
  | "plinth-polymer"
  | "rubber"
  | "status-accent";
type TextureChannel = "albedo" | "ao" | "bump" | "normal" | "roughness";

export interface MicrophoneProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface MicrophoneMaterials {
  readonly basePolymer: MeshPhysicalMaterial;
  readonly coatedMetal: MeshPhysicalMaterial;
  readonly grilleMetal: MeshPhysicalMaterial;
  readonly plinthPolymer: MeshStandardMaterial;
  readonly rubber: MeshStandardMaterial;
  readonly statusAccent: MeshPhysicalMaterial;
}

interface ColliderDescriptor {
  readonly shape: "box" | "capsule" | "cylinder";
  readonly size?: Vector3Tuple;
  readonly radius?: number;
  readonly height?: number;
  readonly axis?: "y" | "z";
  readonly approximate: true;
  readonly authority: "presentation-only";
}

interface RuntimeRegistry {
  readonly nodes: Record<string, Object3D>;
  readonly meshes: Record<string, Mesh>;
  readonly sockets: Record<string, Object3D>;
  readonly colliders: Record<string, ColliderDescriptor>;
  readonly destructionGroups: Record<string, Object3D[]>;
}

interface MicrophoneAssemblies {
  readonly base: readonly Object3D[];
  readonly capsule: readonly Object3D[];
  readonly controls: readonly Object3D[];
  readonly neck: readonly Object3D[];
}

const Z_AXIS = new Vector3(0, 0, 1);

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function familyIndex(family: MaterialFamily): number {
  const families: readonly MaterialFamily[] = [
    "base-polymer",
    "plinth-polymer",
    "rubber",
    "coated-metal",
    "grille-metal",
    "status-accent",
  ];
  return families.indexOf(family);
}

function deterministicSignal(family: MaterialFamily, x: number, y: number): number {
  const seed = familyIndex(family) + 1;
  const hashed = (x * 47 + y * 89 + seed * 131 + ((x * y + seed * 17) % 41) * 23) % 97;
  const grain = hashed / 48 - 1;
  const axial = Math.sin((x + seed * 7) * 0.47) * 0.45;
  const diagonal = Math.sin((x + y + seed * 11) * 0.23) * 0.32;
  return grain * 0.42 + axial + diagonal;
}

function albedoBase(family: MaterialFamily): readonly [number, number, number] {
  switch (family) {
    case "base-polymer": return [20, 20, 22];
    case "plinth-polymer": return [17, 17, 19];
    case "rubber": return [8, 8, 9];
    case "coated-metal": return [24, 24, 26];
    case "grille-metal": return [10, 10, 11];
    case "status-accent": return [177, 40, 45];
  }
}

function roughnessBase(family: MaterialFamily): number {
  switch (family) {
    case "base-polymer": return 215;
    case "plinth-polymer": return 184;
    case "rubber": return 232;
    case "coated-metal": return 110;
    case "grille-metal": return 86;
    case "status-accent": return 72;
  }
}

function writeTexturePixel(
  pixels: Uint8Array,
  index: number,
  family: MaterialFamily,
  channel: TextureChannel,
  signal: number,
): void {
  if (channel === "normal") {
    const strength = family === "rubber" || family === "grille-metal" ? 7 : 4;
    pixels[index] = clampByte(128 + signal * strength);
    pixels[index + 1] = clampByte(128 - signal * (strength * 0.7));
    pixels[index + 2] = 255;
  } else if (channel === "albedo") {
    const [red, green, blue] = albedoBase(family);
    const amplitude = family === "status-accent"
      ? 6
      : family === "grille-metal"
        ? 4
        : family === "base-polymer"
          ? 1
          : 2;
    pixels[index] = clampByte(red + signal * amplitude);
    pixels[index + 1] = clampByte(green + signal * amplitude * 0.85);
    pixels[index + 2] = clampByte(blue + signal * amplitude * 0.9);
  } else {
    const base = channel === "roughness"
      ? roughnessBase(family)
      : channel === "ao"
        ? family === "grille-metal" ? 222 : 243
        : 128;
    const amplitude = channel === "roughness" ? 9 : channel === "ao" ? 5 : 7;
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
      writeTexturePixel(pixels, index, family, channel, deterministicSignal(family, x, y));
    }
  }
  const texture = new DataTexture(pixels, TEXTURE_SIZE, TEXTURE_SIZE);
  texture.name = `microphone-${family}-${channel}`;
  texture.colorSpace = channel === "albedo" ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  const repeat = family === "coated-metal"
    ? [6, 2] as const
    : family === "grille-metal" || family === "status-accent"
      ? [1, 1] as const
      : [4, 4] as const;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  if (channel === "ao") texture.channel = 0;
  texture.needsUpdate = true;
  return texture;
}

function commonMaterialMaps(family: MaterialFamily): {
  readonly map: DataTexture;
  readonly aoMap: DataTexture;
  readonly bumpMap: DataTexture;
  readonly normalMap: DataTexture;
  readonly roughnessMap: DataTexture;
} {
  return {
    map: createTexture(family, "albedo"),
    aoMap: createTexture(family, "ao"),
    bumpMap: createTexture(family, "bump"),
    normalMap: createTexture(family, "normal"),
    roughnessMap: createTexture(family, "roughness"),
  };
}

function createMaterials(): MicrophoneMaterials {
  const basePolymer = new MeshPhysicalMaterial({
    ...commonMaterialMaps("base-polymer"),
    aoMapIntensity: 0.16,
    bumpScale: 0.000004,
    clearcoat: 0.01,
    clearcoatRoughness: 0.82,
    metalness: 0,
    normalScale: new Vector2(0.02, 0.02),
    roughness: 0.78,
    side: FrontSide,
  });
  basePolymer.name = "microphone-base-polymer-material";

  const plinthPolymer = new MeshStandardMaterial({
    ...commonMaterialMaps("plinth-polymer"),
    aoMapIntensity: 0.28,
    bumpScale: 0.000014,
    metalness: 0,
    normalScale: new Vector2(0.07, 0.07),
    roughness: 0.72,
    side: FrontSide,
  });
  plinthPolymer.name = "microphone-plinth-polymer-material";

  const rubber = new MeshStandardMaterial({
    ...commonMaterialMaps("rubber"),
    aoMapIntensity: 0.24,
    bumpScale: 0.00002,
    metalness: 0,
    normalScale: new Vector2(0.11, 0.11),
    roughness: 0.91,
    side: FrontSide,
  });
  rubber.name = "microphone-rubber-material";

  const coatedMetal = new MeshPhysicalMaterial({
    ...commonMaterialMaps("coated-metal"),
    aoMapIntensity: 0.2,
    bumpScale: 0.000012,
    clearcoat: 0.12,
    clearcoatRoughness: 0.36,
    metalness: 0.62,
    normalScale: new Vector2(0.06, 0.035),
    roughness: 0.43,
    side: FrontSide,
  });
  coatedMetal.name = "microphone-coated-metal-material";

  const grilleMetal = new MeshPhysicalMaterial({
    ...commonMaterialMaps("grille-metal"),
    aoMapIntensity: 0.42,
    bumpScale: 0.000025,
    clearcoat: 0.04,
    clearcoatRoughness: 0.35,
    metalness: 0.88,
    normalScale: new Vector2(0.12, 0.12),
    roughness: 0.34,
    side: FrontSide,
  });
  grilleMetal.name = "microphone-grille-metal-material";

  const statusAccent = new MeshPhysicalMaterial({
    ...commonMaterialMaps("status-accent"),
    aoMapIntensity: 0.08,
    bumpScale: 0.000004,
    clearcoat: 0.35,
    clearcoatRoughness: 0.2,
    emissive: 0x5e0e12,
    emissiveIntensity: 0.18,
    metalness: 0,
    normalScale: new Vector2(0.025, 0.025),
    roughness: 0.32,
    side: FrontSide,
  });
  statusAccent.name = "microphone-status-accent-material";

  return { basePolymer, coatedMetal, grilleMetal, plinthPolymer, rubber, statusAccent };
}

function boxCollider(size: Vector3Tuple): ColliderDescriptor {
  return { shape: "box", size, approximate: true, authority: "presentation-only" };
}

function cylinderCollider(radius: number, height: number, axis: "y" | "z" = "y"): ColliderDescriptor {
  return { shape: "cylinder", radius, height, axis, approximate: true, authority: "presentation-only" };
}

function capsuleCollider(radius: number, height: number, axis: "y" | "z" = "y"): ColliderDescriptor {
  return { shape: "capsule", radius, height, axis, approximate: true, authority: "presentation-only" };
}

function namedPivot(id: string, followsParent = false): Group {
  const pivot = new Group();
  pivot.name = `${id}__pivot`;
  pivot.userData.componentId = id;
  pivot.userData.explodeWithParent = followsParent;
  pivot.userData.surfaceDetail = followsParent;
  return pivot;
}

function createContainer(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  collider: ColliderDescriptor,
): Group {
  const pivot = namedPivot(id);
  pivot.userData.semanticAssembly = true;
  parent.add(pivot);
  registry.nodes[id] = pivot;
  registry.colliders[id] = collider;
  return pivot;
}

function createPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  geometry: BufferGeometry,
  material: Material,
  position: Vector3Tuple,
  collider: ColliderDescriptor,
  options: MicrophoneProxyOptions,
  followsParent = false,
): Group {
  const pivot = namedPivot(id, followsParent);
  pivot.position.set(...position);
  const mesh = new Mesh(geometry, material);
  mesh.name = `${id}__mesh`;
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  mesh.userData.componentId = id;
  mesh.userData.explodeWithParent = followsParent;
  mesh.userData.surfaceDetail = followsParent;
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
  options: MicrophoneProxyOptions,
  followsParent = false,
  segments = 3,
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

function createInstancedPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  geometry: BufferGeometry,
  material: Material,
  collider: ColliderDescriptor,
  options: MicrophoneProxyOptions,
  matrices: readonly Object3D[],
  followsParent = false,
): Group {
  const pivot = namedPivot(id, followsParent);
  const mesh = new InstancedMesh(geometry, material, matrices.length);
  mesh.name = `${id}__mesh`;
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  mesh.userData.componentId = id;
  mesh.userData.explodeWithParent = followsParent;
  mesh.userData.surfaceDetail = followsParent;
  matrices.forEach((matrixSource, index) => {
    matrixSource.updateMatrix();
    mesh.setMatrixAt(index, matrixSource.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  pivot.add(mesh);
  parent.add(pivot);
  registry.nodes[id] = pivot;
  registry.meshes[id] = mesh;
  registry.colliders[id] = collider;
  return pivot;
}

function createBase(
  root: Group,
  registry: RuntimeRegistry,
  materials: MicrophoneMaterials,
  options: MicrophoneProxyOptions,
): { readonly assembly: Group; readonly parts: readonly Object3D[]; readonly controls: readonly Object3D[] } {
  const assembly = createContainer(root, registry, "base-assembly", boxCollider([0.10, 0.03345, 0.10]));

  const upperShell = createRoundedPart(
    assembly,
    registry,
    "upper-base-shell",
    [0.10, 0.018, 0.10],
    0.010,
    materials.basePolymer,
    [0, 0.0235, 0],
    options,
  );
  const lowerPlinth = createRoundedPart(
    assembly,
    registry,
    "lower-base-plinth",
    [0.096, 0.011, 0.096],
    0.008,
    materials.plinthPolymer,
    [0, 0.009, 0],
    options,
  );
  const seam = createRoundedPart(
    assembly,
    registry,
    "perimeter-seam",
    [0.099, 0.0012, 0.099],
    0.0085,
    materials.plinthPolymer,
    [0, 0.01475, 0],
    options,
    true,
    2,
  );

  const footMatrices = ([-1, 1] as const).flatMap((xSign) =>
    ([-1, 1] as const).map((zSign) => {
      const transform = new Object3D();
      transform.position.set(xSign * 0.0365, 0.002, zSign * 0.0365);
      return transform;
    }),
  );
  const feet = createInstancedPart(
    assembly,
    registry,
    "rubber-foot-system",
    new RoundedBoxGeometry(0.014, 0.004, 0.010, 2, 0.002),
    materials.rubber,
    boxCollider([0.080, 0.004, 0.080]),
    options,
    footMatrices,
  );

  const switchBezel = createPart(
    assembly,
    registry,
    "mute-switch",
    new CylinderGeometry(0.0074, 0.0074, 0.0012, 32),
    materials.plinthPolymer,
    [-0.015, 0.03255, -0.020],
    cylinderCollider(0.0074, 0.0012),
    options,
  );
  const indicator = createPart(
    switchBezel,
    registry,
    "status-indicator",
    new CylinderGeometry(0.00135, 0.00135, 0.0004, 24),
    materials.statusAccent,
    [0, 0.00075, 0],
    cylinderCollider(0.00135, 0.0004),
    options,
    true,
  );

  return {
    assembly,
    parts: [upperShell, lowerPlinth, seam, feet],
    controls: [switchBezel, indicator],
  };
}

function createGland(
  root: Group,
  registry: RuntimeRegistry,
  material: MeshPhysicalMaterial,
  options: MicrophoneProxyOptions,
): Group {
  const profile = [
    new Vector2(0.0080, 0),
    new Vector2(0.0080, 0.0025),
    new Vector2(0.0067, 0.0170),
    new Vector2(0.0055, 0.0210),
    new Vector2(0.0050, 0.0240),
  ];
  return createPart(
    root,
    registry,
    "neck-gland",
    new LatheGeometry(profile, 32),
    material,
    [0, 0.029, 0.021],
    cylinderCollider(0.008, 0.024),
    options,
  );
}

function createGooseneckCurve(): CatmullRomCurve3 {
  const curve = new CatmullRomCurve3([
    new Vector3(0, 0.049, 0.021),
    new Vector3(0, 0.094, 0.021),
    new Vector3(0, 0.148, 0.019),
    new Vector3(0, 0.194, 0.011),
    new Vector3(0, 0.222, -0.002),
    new Vector3(0, 0.240, -0.0115),
  ]);
  curve.curveType = "centripetal";
  return curve;
}

function createGooseneck(
  root: Group,
  registry: RuntimeRegistry,
  material: MeshPhysicalMaterial,
  options: MicrophoneProxyOptions,
): { readonly assembly: Group; readonly core: Group; readonly ribs: Group } {
  const curve = createGooseneckCurve();
  const assembly = createContainer(root, registry, "gooseneck-assembly", capsuleCollider(0.004, 0.191));
  const core = createPart(
    assembly,
    registry,
    "gooseneck-core",
    new TubeGeometry(curve, 96, 0.0032, 16, false),
    material,
    [0, 0, 0],
    capsuleCollider(0.0036, 0.191),
    options,
  );

  const ringTransforms: Object3D[] = [];
  for (let index = 0; index < GOOSENECK_RIB_COUNT; index += 1) {
    const t = 0.018 + (index / (GOOSENECK_RIB_COUNT - 1)) * 0.94;
    const transform = new Object3D();
    transform.position.copy(curve.getPointAt(t));
    const tangent = curve.getTangentAt(t).normalize();
    transform.quaternion.copy(new Quaternion().setFromUnitVectors(Z_AXIS, tangent));
    ringTransforms.push(transform);
  }
  const ribs = createInstancedPart(
    core,
    registry,
    "gooseneck-rib-system",
    new TorusGeometry(0.00335, 0.00030, 6, 16),
    material,
    capsuleCollider(0.00365, 0.183),
    options,
    ringTransforms,
  );
  return { assembly, core, ribs };
}

function cylinderAlongZ(radiusTop: number, radiusBottom: number, length: number, segments = 32): CylinderGeometry {
  const geometry = new CylinderGeometry(radiusTop, radiusBottom, length, segments);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function grilleCellTransforms(): readonly Object3D[] {
  const transforms: Object3D[] = [];
  const rowSpacing = 0.00215;
  const columnSpacing = 0.00245;
  for (let row = -3; row <= 3; row += 1) {
    for (let column = -3; column <= 3; column += 1) {
      const x = column * columnSpacing + (Math.abs(row) % 2 === 1 ? columnSpacing / 2 : 0);
      const y = row * rowSpacing;
      if (Math.hypot(x, y) > 0.0075) continue;
      const transform = new Object3D();
      transform.position.set(x, y, -0.00065);
      transforms.push(transform);
    }
  }
  return transforms;
}

function createCapsule(
  root: Group,
  registry: RuntimeRegistry,
  materials: MicrophoneMaterials,
  options: MicrophoneProxyOptions,
): { readonly assembly: Group; readonly parts: readonly Object3D[] } {
  const assembly = createContainer(root, registry, "capsule-assembly", cylinderCollider(0.010, 0.042, "z"));
  const rearCollar = createPart(
    assembly,
    registry,
    "capsule-rear-collar",
    cylinderAlongZ(0.0064, 0.0050, 0.008, 28),
    materials.coatedMetal,
    [0, 0.240, -0.013],
    cylinderCollider(0.0064, 0.008, "z"),
    options,
  );
  const transitionCollar = createPart(
    assembly,
    registry,
    "capsule-transition-collar",
    cylinderAlongZ(0.0080, 0.0063, 0.007, 32),
    materials.coatedMetal,
    [0, 0.240, -0.019],
    cylinderCollider(0.008, 0.007, "z"),
    options,
  );
  const barrel = createPart(
    assembly,
    registry,
    "capsule-barrel",
    cylinderAlongZ(0.0094, 0.0091, 0.028, 40),
    materials.coatedMetal,
    [0, 0.240, -0.034],
    cylinderCollider(0.0094, 0.028, "z"),
    options,
  );
  const grilleRing = createPart(
    assembly,
    registry,
    "grille-ring",
    new TorusGeometry(0.0087, 0.0013, 10, 40),
    materials.grilleMetal,
    [0, 0.240, -0.0480],
    cylinderCollider(0.010, 0.0026, "z"),
    options,
  );
  const grilleFace = createPart(
    assembly,
    registry,
    "grille-face",
    cylinderAlongZ(0.0082, 0.0082, 0.0011, 40),
    materials.grilleMetal,
    [0, 0.240, -0.04835],
    cylinderCollider(0.0082, 0.0011, "z"),
    options,
  );
  const grilleCells = createInstancedPart(
    grilleFace,
    registry,
    "grille-perforation-system",
    cylinderAlongZ(0.00067, 0.00067, 0.00045, 8),
    materials.plinthPolymer,
    cylinderCollider(0.0075, 0.00045, "z"),
    options,
    grilleCellTransforms(),
    true,
  );
  return {
    assembly,
    parts: [rearCollar, transitionCollar, barrel, grilleRing, grilleFace, grilleCells],
  };
}

function createSocket(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  position: Vector3Tuple,
  rotation: Vector3Tuple = [0, 0, 0],
): void {
  const socket = new Object3D();
  socket.name = `${id}__socket`;
  socket.position.set(...position);
  socket.rotation.set(...rotation);
  parent.add(socket);
  registry.sockets[id] = socket;
}

function createSockets(root: Group, registry: RuntimeRegistry): void {
  createSocket(root, registry, "floor-contact", [0, 0, 0]);
  createSocket(root, registry, "plan-anchor", [0, 0, 0]);
  createSocket(root, registry, "tabletop-contact", [0, 0, 0]);
  createSocket(root, registry, "control-centre", [-0.015, 0.033, -0.020]);
  createSocket(root, registry, "neck-mount", [0, 0.0325, 0.021]);
  createSocket(root, registry, "capsule-axis", [0, 0.240, -0.034], [Math.PI / 2, 0, 0]);
  createSocket(root, registry, "speaker-target", [0, 0.240, -0.050], [Math.PI / 2, 0, 0]);
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

function assignDestructionGroups(registry: RuntimeRegistry, assemblies: MicrophoneAssemblies): void {
  registry.destructionGroups["weighted-base"] = [...assemblies.base];
  registry.destructionGroups.controls = [...assemblies.controls];
  registry.destructionGroups.gooseneck = [...assemblies.neck];
  registry.destructionGroups.capsule = [...assemblies.capsule];
}

/**
 * Build a compact, unbranded conference microphone in canonical metres.
 * The ImageGen reference is appearance evidence only: rear connector geometry,
 * internals, acoustic behaviour, cable routing, and physics authority are unknown.
 */
export function createMicrophoneProxy(options: MicrophoneProxyOptions = {}): Group {
  const root = new Group();
  root.name = "microphone";
  root.userData.componentId = "root";
  const registry = createRegistry(root);
  const materials = createMaterials();
  const base = createBase(root, registry, materials, options);
  const gland = createGland(root, registry, materials.coatedMetal, options);
  const neck = createGooseneck(root, registry, materials.coatedMetal, options);
  const capsule = createCapsule(root, registry, materials, options);
  createSockets(root, registry);
  assignDestructionGroups(registry, {
    base: [...base.parts, gland],
    capsule: capsule.parts,
    controls: base.controls,
    neck: [neck.core, neck.ribs],
  });

  root.userData.canonicalDimensionsMetres = [WIDTH_METRES, HEIGHT_METRES, DEPTH_METRES] as const;
  root.userData.provenance = "generated";
  root.userData.authority = "presentation-only";
  root.userData.measuredGeometry = false;
  root.userData.operational = false;
  root.userData.sourceKind = "ai-generated-image";
  root.userData.generator = "OpenAI ImageGen";
  root.userData.geometryKind = "procedural-generated-stand-in";
  root.userData.evidenceSource =
    "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#microphone";
  root.userData.evidenceImage =
    "packages/web/src/assets/generated-furniture/microphone-imagegen-v1.png";
  root.userData.colliderAuthority = "metadata-only";
  root.userData.limitations = [
    "AI-generated appearance reference; not measured venue evidence",
    "rear connector, cable routing, internals, and acoustic behaviour are not evidenced",
    "underside feet are symmetry-inferred approximations",
    "colliders are presentation metadata only and are not physics-authoritative",
  ];
  root.userData.sculptRuntime = registry satisfies Img2ThreeSculptRuntime;
  return root;
}
