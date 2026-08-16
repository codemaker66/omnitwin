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
  Quaternion,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { Img2ThreeSculptRuntime } from "../../../lib/furniture-presentation-runtime.js";

const WIDTH_METRES = 0.5;
const HEIGHT_METRES = 1.6;
const DEPTH_METRES = 0.5;
const HUB_X = -0.094;
const TEXTURE_SIZE = 64;
const EXPLODE_WITH_PARENT = true;
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

type Vector3Tuple = readonly [number, number, number];
type MaterialFamily = "gunmetal" | "polymer" | "powder" | "rubber";
type TextureChannel = "albedo" | "ao" | "bump" | "normal" | "roughness";

export interface MicStandProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface MicStandMaterials {
  readonly gunmetal: MeshPhysicalMaterial;
  readonly polymer: MeshStandardMaterial;
  readonly powder: MeshPhysicalMaterial;
  readonly rubber: MeshStandardMaterial;
}

interface BoxColliderDescriptor {
  readonly shape: "box";
  readonly size: Vector3Tuple;
  readonly approximate: true;
  readonly authority: "presentation-only";
}

interface CapsuleColliderDescriptor {
  readonly shape: "capsule";
  readonly start: Vector3Tuple;
  readonly end: Vector3Tuple;
  readonly radius: number;
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

interface SphereColliderDescriptor {
  readonly shape: "sphere";
  readonly radius: number;
  readonly approximate: true;
  readonly authority: "presentation-only";
}

type ColliderDescriptor =
  | BoxColliderDescriptor
  | CapsuleColliderDescriptor
  | CylinderColliderDescriptor
  | SphereColliderDescriptor;

interface RuntimeRegistry {
  readonly nodes: Record<string, Object3D>;
  readonly meshes: Record<string, Mesh>;
  readonly sockets: Record<string, Object3D>;
  readonly colliders: Record<string, ColliderDescriptor>;
  readonly destructionGroups: Record<string, Object3D[]>;
}

interface TripodParts {
  readonly feet: readonly Group[];
  readonly hub: readonly Group[];
  readonly legs: readonly Group[];
}

interface BoomParts {
  readonly hinge: readonly Group[];
  readonly hardware: readonly Group[];
  readonly clip: readonly Group[];
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function deterministicNoise(x: number, y: number, salt: number): number {
  return (((x * 53 + y * 97 + salt * 31 + ((x * y) % 43) * 17) % 47) / 23) - 1;
}

function familySignal(family: MaterialFamily, x: number, y: number): number {
  const salt = family === "powder" ? 3 : family === "polymer" ? 7 : family === "rubber" ? 11 : 17;
  const directional = family === "powder" || family === "gunmetal"
    ? Math.sin(x * (family === "powder" ? 1.73 : 2.41))
    : Math.sin((x + y) * (family === "rubber" ? 1.19 : 0.67));
  return directional * 0.32 + deterministicNoise(x, y, salt) * 0.68;
}

function writeTexturePixel(
  pixels: Uint8Array,
  index: number,
  family: MaterialFamily,
  channel: TextureChannel,
  signal: number,
): void {
  const albedoBase = family === "gunmetal" ? 48 : family === "powder" ? 23 : family === "polymer" ? 17 : 8;
  const roughnessBase = family === "gunmetal" ? 92 : family === "powder" ? 122 : family === "polymer" ? 158 : 214;
  if (channel === "normal") {
    pixels[index] = clampByte(128 + signal * (family === "rubber" ? 11 : 7));
    pixels[index + 1] = clampByte(128 + signal * (family === "powder" ? 3 : 8));
    pixels[index + 2] = 255;
  } else {
    const base = channel === "albedo" ? albedoBase : channel === "roughness" ? roughnessBase : channel === "ao" ? 242 : 128;
    const amplitude = channel === "albedo" ? (family === "gunmetal" ? 5 : 2) : channel === "bump" ? 6 : channel === "ao" ? 4 : 5;
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
      writeTexturePixel(pixels, index, family, channel, familySignal(family, x, y));
    }
  }
  const texture = new DataTexture(pixels, TEXTURE_SIZE, TEXTURE_SIZE);
  texture.name = `mic-stand-${family}-${channel}`;
  texture.colorSpace = channel === "albedo" ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(family === "powder" ? 3 : 2, family === "powder" ? 9 : 3);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  if (channel === "ao") texture.channel = 0;
  texture.needsUpdate = true;
  return texture;
}

function materialMaps(family: MaterialFamily): Record<TextureChannel, DataTexture> {
  return {
    albedo: createTexture(family, "albedo"),
    ao: createTexture(family, "ao"),
    bump: createTexture(family, "bump"),
    normal: createTexture(family, "normal"),
    roughness: createTexture(family, "roughness"),
  };
}

function createMaterials(): MicStandMaterials {
  const powderMaps = materialMaps("powder");
  const powder = new MeshPhysicalMaterial({
    map: powderMaps.albedo, aoMap: powderMaps.ao, aoMapIntensity: 0.2,
    bumpMap: powderMaps.bump, bumpScale: 0.00004, metalness: 0.18,
    normalMap: powderMaps.normal, normalScale: new Vector2(0.05, 0.025),
    roughness: 0.48, roughnessMap: powderMaps.roughness, side: FrontSide,
  });
  powder.name = "mic-stand-satin-black-powder-coated-steel";
  const polymerMaps = materialMaps("polymer");
  const polymer = new MeshStandardMaterial({
    map: polymerMaps.albedo, aoMap: polymerMaps.ao, aoMapIntensity: 0.28,
    bumpMap: polymerMaps.bump, bumpScale: 0.000035, metalness: 0,
    normalMap: polymerMaps.normal, normalScale: new Vector2(0.08, 0.08),
    roughness: 0.62, roughnessMap: polymerMaps.roughness, side: FrontSide,
  });
  polymer.name = "mic-stand-matte-black-moulded-polymer";
  const rubberMaps = materialMaps("rubber");
  const rubber = new MeshStandardMaterial({
    map: rubberMaps.albedo, aoMap: rubberMaps.ao, aoMapIntensity: 0.3,
    bumpMap: rubberMaps.bump, bumpScale: 0.00004, metalness: 0,
    normalMap: rubberMaps.normal, normalScale: new Vector2(0.11, 0.11),
    roughness: 0.84, roughnessMap: rubberMaps.roughness, side: FrontSide,
  });
  rubber.name = "mic-stand-high-roughness-black-rubber";
  const gunmetalMaps = materialMaps("gunmetal");
  const gunmetal = new MeshPhysicalMaterial({
    map: gunmetalMaps.albedo, aoMap: gunmetalMaps.ao, aoMapIntensity: 0.22,
    bumpMap: gunmetalMaps.bump, bumpScale: 0.000025, metalness: 0.82,
    normalMap: gunmetalMaps.normal, normalScale: new Vector2(0.07, 0.035),
    roughness: 0.36, roughnessMap: gunmetalMaps.roughness, side: FrontSide,
  });
  gunmetal.name = "mic-stand-dark-gunmetal-hardware";
  return { gunmetal, polymer, powder, rubber };
}

function boxCollider(size: Vector3Tuple): BoxColliderDescriptor {
  return { shape: "box", size, approximate: true, authority: "presentation-only" };
}

function capsuleCollider(start: Vector3Tuple, end: Vector3Tuple, radius: number): CapsuleColliderDescriptor {
  return { shape: "capsule", start, end, radius, approximate: true, authority: "presentation-only" };
}

function cylinderCollider(radius: number, height: number, axis: "x" | "y" | "z" = "y"): CylinderColliderDescriptor {
  return { shape: "cylinder", radius, height, axis, approximate: true, authority: "presentation-only" };
}

function sphereCollider(radius: number): SphereColliderDescriptor {
  return { shape: "sphere", radius, approximate: true, authority: "presentation-only" };
}

function namedPivot(id: string): Group {
  const pivot = new Group();
  pivot.name = `${id}__pivot`;
  pivot.userData.componentId = id;
  return pivot;
}

function createContainer(parent: Object3D, registry: RuntimeRegistry, id: string, collider: ColliderDescriptor): Group {
  const container = namedPivot(id);
  container.userData.semanticAssembly = true;
  container.userData.explodeWithParent = true;
  parent.add(container);
  registry.nodes[id] = container;
  registry.colliders[id] = collider;
  return container;
}

function configureMesh(mesh: Mesh, id: string, options: MicStandProxyOptions): Mesh {
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

function createPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  geometry: BufferGeometry,
  material: Material,
  position: Vector3Tuple,
  collider: ColliderDescriptor,
  options: MicStandProxyOptions,
  surfaceDetail = false,
  scale: Vector3Tuple = [1, 1, 1],
): Group {
  const pivot = namedPivot(id);
  pivot.position.set(...position);
  const mesh = configureMesh(new Mesh(geometry, material), id, options);
  mesh.scale.set(...scale);
  pivot.add(mesh);
  parent.add(pivot);
  registry.nodes[id] = pivot;
  registry.meshes[id] = mesh;
  registry.colliders[id] = collider;
  if (surfaceDetail) markSurfaceDetail(pivot, mesh);
  return pivot;
}

function createTubePart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  start: Vector3Tuple,
  end: Vector3Tuple,
  startRadius: number,
  endRadius: number,
  material: Material,
  options: MicStandProxyOptions,
  surfaceDetail = false,
  radialSegments = 28,
): Group {
  const startVector = new Vector3(...start);
  const direction = new Vector3(...end).sub(startVector);
  const length = direction.length();
  const pivot = namedPivot(id);
  pivot.position.copy(startVector);
  const mesh = configureMesh(
    new Mesh(new CylinderGeometry(endRadius, startRadius, length, radialSegments, 1), material),
    id,
    options,
  );
  mesh.position.copy(direction).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.clone().normalize());
  pivot.add(mesh);
  parent.add(pivot);
  registry.nodes[id] = pivot;
  registry.meshes[id] = mesh;
  registry.colliders[id] = capsuleCollider([0, 0, 0], [direction.x, direction.y, direction.z], Math.max(startRadius, endRadius));
  if (surfaceDetail) markSurfaceDetail(pivot, mesh);
  return pivot;
}

function orientedTorusGeometry(normal: Vector3, radius: number, tube: number, arc = Math.PI * 2): TorusGeometry {
  const geometry = new TorusGeometry(radius, tube, 10, 32, arc);
  geometry.applyQuaternion(new Quaternion().setFromUnitVectors(Z_AXIS, normal.clone().normalize()));
  return geometry;
}

const FOOT_DEFINITIONS = [
  { id: "rear", centre: [0, 0.018, 0.223] as const },
  { id: "front-left", centre: [-0.223, 0.018, -0.223] as const },
  { id: "front-right", centre: [0.223, 0.018, -0.223] as const },
] as const;

const LEG_DEFINITIONS = [
  { id: "rear", start: [-0.094, 0.12, 0.055] as const, end: [0, 0.036, 0.208] as const },
  { id: "front-left", start: [-0.134, 0.12, -0.035] as const, end: [-0.208, 0.036, -0.208] as const },
  { id: "front-right", start: [-0.054, 0.12, -0.035] as const, end: [0.208, 0.036, -0.208] as const },
] as const;

function createHub(
  base: Group,
  registry: RuntimeRegistry,
  materials: MicStandMaterials,
  options: MicStandProxyOptions,
): readonly Group[] {
  const hub = createContainer(base, registry, "tripod-hub", cylinderCollider(0.061, 0.155));
  const profile = [
    new Vector2(0.055, 0.07), new Vector2(0.061, 0.082), new Vector2(0.061, 0.13),
    new Vector2(0.052, 0.165), new Vector2(0.038, 0.205), new Vector2(0.024, 0.222),
    new Vector2(0.019, 0.225),
  ];
  const shell = createPart(hub, registry, "tripod-hub-shell", new LatheGeometry(profile, 48), materials.polymer, [HUB_X, 0, 0], cylinderCollider(0.061, 0.155), options);
  const collar = createPart(hub, registry, "tripod-hub-lower-collar", new CylinderGeometry(0.061, 0.061, 0.035, 40), materials.polymer, [HUB_X, 0.0875, 0], cylinderCollider(0.061, 0.035), options);
  const hardware = createContainer(base, registry, "leg-root-hardware-system", boxCollider([0.14, 0.04, 0.14]));
  const caps = LEG_DEFINITIONS.map((definition) => {
    const radial = new Vector3(
      definition.start[0] - HUB_X,
      0,
      definition.start[2],
    ).normalize();
    return createPart(
      hardware,
      registry,
      `tripod-leg-root-${definition.id}-cap`,
      new SphereGeometry(1, 20, 12),
      materials.gunmetal,
      [HUB_X + radial.x * 0.057, 0.125, radial.z * 0.057],
      sphereCollider(0.011),
      options,
      true,
      [0.011, 0.011, 0.006],
    );
  });
  hardware.userData.memberIds = LEG_DEFINITIONS.map(
    (definition) => `tripod-leg-root-${definition.id}-cap`,
  );
  return [hub, shell, collar, hardware, ...caps];
}

function createFootRibs(
  foot: Group,
  registry: RuntimeRegistry,
  definition: (typeof FOOT_DEFINITIONS)[number],
  materials: MicStandMaterials,
  options: MicStandProxyOptions,
): readonly Group[] {
  const radial = new Vector3(definition.centre[0] - HUB_X, 0, definition.centre[2]).normalize();
  return [-0.008, 0, 0.008].map((offset, index) => createPart(
    foot,
    registry,
    `tripod-foot-${definition.id}-rib-${String(index + 1)}`,
    orientedTorusGeometry(radial, 0.014, 0.0014),
    materials.rubber,
    [radial.x * offset, 0, radial.z * offset],
    cylinderCollider(0.0154, 0.0028, "x"),
    options,
    true,
  ));
}

function createTripod(
  root: Group,
  registry: RuntimeRegistry,
  materials: MicStandMaterials,
  options: MicStandProxyOptions,
): TripodParts {
  const base = createContainer(root, registry, "tripod-base-assembly", boxCollider([0.5, 0.23, 0.5]));
  const hub = createHub(base, registry, materials, options);
  const legSystem = createContainer(base, registry, "tripod-leg-system", boxCollider([0.47, 0.11, 0.45]));
  const legs = LEG_DEFINITIONS.map((definition) => createTubePart(
    legSystem, registry, `tripod-leg-${definition.id}`, definition.start, definition.end,
    0.015, 0.013, materials.powder, options,
  ));
  const footSystem = createContainer(base, registry, "tripod-foot-system", boxCollider([0.5, 0.036, 0.5]));
  const feet = FOOT_DEFINITIONS.flatMap((definition) => {
    const foot = createPart(
      footSystem, registry, `tripod-foot-${definition.id}`,
      new SphereGeometry(1, 32, 20), materials.rubber, definition.centre,
      sphereCollider(0.027), options, false, [0.027, 0.018, 0.027],
    );
    return [foot, ...createFootRibs(foot, registry, definition, materials, options)];
  });
  return { hub, legs, feet };
}

function createCollarRibs(
  collar: Group,
  registry: RuntimeRegistry,
  material: Material,
  options: MicStandProxyOptions,
): readonly Group[] {
  const system = createContainer(collar, registry, "collar-grip-rib-system", cylinderCollider(0.029, 0.056));
  const definitions = [
    [[0.026, 0, 0], [0.005, 0.056, 0.011]],
    [[-0.026, 0, 0], [0.005, 0.056, 0.011]],
    [[0, 0, 0.026], [0.011, 0.056, 0.005]],
    [[0, 0, -0.026], [0.011, 0.056, 0.005]],
  ] as const satisfies readonly (readonly [Vector3Tuple, Vector3Tuple])[];
  return definitions.map(([position, size], index) => createPart(
    system, registry, `telescoping-collar-rib-${String(index + 1)}`,
    new RoundedBoxGeometry(...size, 2, 0.0015), material, position,
    boxCollider(size), options, true,
  ));
}

function createPoleCableClip(
  lowerPole: Group,
  registry: RuntimeRegistry,
  material: Material,
  options: MicStandProxyOptions,
): readonly Group[] {
  const ringGeometry = orientedTorusGeometry(Y_AXIS, 0.019, 0.0032, Math.PI * 1.55);
  const ring = createPart(lowerPole, registry, "upright-cable-clip", ringGeometry, material, [0, 0.595, 0], cylinderCollider(0.0222, 0.0064), options, true);
  const tab = createPart(ring, registry, "upright-cable-clip-tab", new RoundedBoxGeometry(0.027, 0.012, 0.012, 2, 0.002), material, [0.021, 0, -0.006], boxCollider([0.027, 0.012, 0.012]), options, true);
  return [ring, tab];
}

function createUpright(
  root: Group,
  registry: RuntimeRegistry,
  materials: MicStandMaterials,
  options: MicStandProxyOptions,
): readonly Group[] {
  const assembly = createContainer(root, registry, "upright-assembly", cylinderCollider(0.045, 1.27));
  const lower = createTubePart(assembly, registry, "lower-upright-pole", [HUB_X, 0.185, 0], [HUB_X, 1.04, 0], 0.0175, 0.0175, materials.powder, options);
  const upper = createTubePart(assembly, registry, "upper-upright-pole", [HUB_X, 0.96, 0], [HUB_X, 1.445, 0], 0.0135, 0.0135, materials.powder, options);
  const collar = createPart(assembly, registry, "telescoping-lock-collar", new CylinderGeometry(0.027, 0.027, 0.08, 36), materials.polymer, [HUB_X, 0.99, 0], cylinderCollider(0.027, 0.08), options);
  const ribs = createCollarRibs(collar, registry, materials.polymer, options);
  const knobStem = createTubePart(collar, registry, "telescoping-knob-stem", [0.018, 0, 0], [0.047, 0, 0], 0.0085, 0.0085, materials.gunmetal, options, true);
  const knobHead = createTubePart(collar, registry, "telescoping-knob-head", [0.042, 0, 0], [0.064, 0, 0], 0.012, 0.012, materials.polymer, options, true);
  const cableClip = createPoleCableClip(lower, registry, materials.polymer, options);
  return [lower, upper, collar, ...ribs, knobStem, knobHead, ...cableClip];
}

function createHingeGeometry(): ExtrudeGeometry {
  const shape = new Shape();
  shape.moveTo(-0.036, -0.04);
  shape.quadraticCurveTo(-0.043, -0.008, -0.034, 0.027);
  shape.quadraticCurveTo(-0.024, 0.046, 0.014, 0.045);
  shape.quadraticCurveTo(0.038, 0.036, 0.039, 0.006);
  shape.quadraticCurveTo(0.034, -0.033, 0.012, -0.044);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth: 0.046, bevelEnabled: true, bevelSegments: 2,
    bevelSize: 0.003, bevelThickness: 0.002, curveSegments: 12, steps: 1,
  });
  geometry.center();
  return geometry;
}

function createHinge(
  boom: Group,
  registry: RuntimeRegistry,
  materials: MicStandMaterials,
  options: MicStandProxyOptions,
): readonly Group[] {
  const body = createPart(boom, registry, "boom-hinge-body", createHingeGeometry(), materials.polymer, [HUB_X, 1.42, 0], boxCollider([0.082, 0.094, 0.05]), options);
  const axleSystem = createContainer(boom, registry, "hinge-axle-system", cylinderCollider(0.014, 0.068, "z"));
  const axle = createTubePart(axleSystem, registry, "hinge-axle", [HUB_X, 1.43, -0.03], [HUB_X, 1.43, 0.03], 0.013, 0.013, materials.gunmetal, options);
  const capLeft = createTubePart(axle, registry, "hinge-axle-cap-left", [0, 0, -0.005], [0, 0, 0.004], 0.015, 0.015, materials.gunmetal, options, true);
  const capRight = createTubePart(axle, registry, "hinge-axle-cap-right", [0, 0, 0.056], [0, 0, 0.065], 0.015, 0.015, materials.gunmetal, options, true);
  const insetLeft = createTubePart(capLeft, registry, "hinge-axle-inset-left", [0, 0, -0.001], [0, 0, 0.001], 0.009, 0.009, materials.polymer, options, true);
  const insetRight = createTubePart(capRight, registry, "hinge-axle-inset-right", [0, 0, 0.008], [0, 0, 0.01], 0.009, 0.009, materials.polymer, options, true);
  return [body, axleSystem, axle, capLeft, capRight, insetLeft, insetRight];
}

const BOOM_REAR = new Vector3(-0.218, 1.365, 0);
const BOOM_FRONT = new Vector3(0.182, 1.542, 0);
const BOOM_DIRECTION = BOOM_FRONT.clone().sub(BOOM_REAR).normalize();

function boomPoint(fraction: number): Vector3Tuple {
  const point = BOOM_REAR.clone().lerp(BOOM_FRONT, fraction);
  return [point.x, point.y, point.z];
}

function createBoomCableClip(
  boom: Group,
  registry: RuntimeRegistry,
  materials: MicStandMaterials,
  options: MicStandProxyOptions,
): readonly Group[] {
  const centre = boomPoint(0.46);
  const ring = createPart(boom, registry, "boom-cable-clip", orientedTorusGeometry(BOOM_DIRECTION, 0.013, 0.0025, Math.PI * 1.55), materials.polymer, centre, cylinderCollider(0.0155, 0.005, "x"), options, true);
  const tab = createPart(ring, registry, "boom-cable-clip-tab", new RoundedBoxGeometry(0.025, 0.012, 0.01, 2, 0.002), materials.polymer, [0, 0.018, 0], boxCollider([0.025, 0.012, 0.01]), options, true);
  return [ring, tab];
}

function createBoomHardware(
  boom: Group,
  registry: RuntimeRegistry,
  materials: MicStandMaterials,
  options: MicStandProxyOptions,
): readonly Group[] {
  const tube = createTubePart(boom, registry, "boom-tube", [BOOM_REAR.x, BOOM_REAR.y, 0], [BOOM_FRONT.x, BOOM_FRONT.y, 0], 0.0115, 0.011, materials.powder, options);
  const counterweightAssembly = createContainer(boom, registry, "rear-counterweight", capsuleCollider([-0.226, 1.3615, 0], boomPoint(0.17), 0.018));
  const counterweight = createTubePart(counterweightAssembly, registry, "rear-counterweight-sleeve", [-0.226, 1.3615, 0], boomPoint(0.17), 0.018, 0.017, materials.polymer, options);
  const counterweightCap = createPart(counterweight, registry, "rear-counterweight-cap", new SphereGeometry(1, 24, 14), materials.polymer, [0, 0, 0], sphereCollider(0.018), options, true, [0.018, 0.018, 0.018]);
  const collar = createTubePart(boom, registry, "boom-slide-collar", boomPoint(0.58), boomPoint(0.69), 0.017, 0.017, materials.polymer, options);
  const collarCentre = boomPoint(0.635);
  const knobStem = createTubePart(collar, registry, "boom-slide-knob-stem", [0, 0, 0.009], [0, 0, 0.033], 0.0065, 0.0065, materials.gunmetal, options, true);
  const knobHead = createTubePart(collar, registry, "boom-slide-knob-head", [0, 0, 0.029], [0, 0, 0.048], 0.0095, 0.0095, materials.polymer, options, true);
  collar.userData.referenceCentre = collarCentre;
  const cableClip = createBoomCableClip(boom, registry, materials, options);
  const terminal = createTubePart(boom, registry, "terminal-adapter", boomPoint(0.91), [0.2, 1.55, 0], 0.015, 0.014, materials.gunmetal, options);
  const terminalCollar = createTubePart(terminal, registry, "terminal-adapter-collar", [0, 0, 0], [0.026, 0.0115, 0], 0.017, 0.016, materials.polymer, options, true);
  return [tube, counterweightAssembly, counterweight, counterweightCap, collar, knobStem, knobHead, ...cableClip, terminal, terminalCollar];
}

function createJawGeometry(side: "left" | "right"): ExtrudeGeometry {
  const sign = side === "left" ? -1 : 1;
  const outer = 0.03 * sign;
  const inner = 0.017 * sign;
  const tip = 0.006 * sign;
  const shape = new Shape();
  shape.moveTo(outer, 0);
  shape.lineTo(outer, 0.03);
  shape.quadraticCurveTo(outer, 0.05, 0.012 * sign, 0.05);
  shape.lineTo(tip, 0.043);
  shape.quadraticCurveTo(inner, 0.039, inner, 0.03);
  shape.lineTo(inner, 0);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth: 0.018, bevelEnabled: false, curveSegments: 12, steps: 1,
  });
  geometry.translate(0, 0, -0.009);
  return geometry;
}

function createEmptyClip(
  boom: Group,
  registry: RuntimeRegistry,
  materials: MicStandMaterials,
  options: MicStandProxyOptions,
): readonly Group[] {
  const assembly = createContainer(boom, registry, "empty-microphone-clip", boxCollider([0.064, 0.06, 0.028]));
  assembly.userData.empty = true;
  assembly.userData.containsMicrophone = false;
  const cradle = createPart(assembly, registry, "empty-clip-cradle", new RoundedBoxGeometry(0.052, 0.02, 0.026, 3, 0.004), materials.polymer, [0.205, 1.55, 0], boxCollider([0.052, 0.02, 0.026]), options);
  const jawSystem = createContainer(assembly, registry, "empty-clip-jaw-system", boxCollider([0.064, 0.055, 0.022]));
  const leftJaw = createPart(jawSystem, registry, "empty-clip-left-jaw", createJawGeometry("left"), materials.polymer, [0.205, 1.55, 0], boxCollider([0.024, 0.05, 0.018]), options);
  const rightJaw = createPart(jawSystem, registry, "empty-clip-right-jaw", createJawGeometry("right"), materials.polymer, [0.205, 1.55, 0], boxCollider([0.024, 0.05, 0.018]), options);
  const leftPad = createPart(leftJaw, registry, "empty-clip-left-pad", new RoundedBoxGeometry(0.007, 0.012, 0.021, 2, 0.0015), materials.rubber, [-0.0075, 0.043, 0], boxCollider([0.007, 0.012, 0.021]), options, true);
  const rightPad = createPart(rightJaw, registry, "empty-clip-right-pad", new RoundedBoxGeometry(0.007, 0.012, 0.021, 2, 0.0015), materials.rubber, [0.0075, 0.043, 0], boxCollider([0.007, 0.012, 0.021]), options, true);
  return [assembly, cradle, jawSystem, leftJaw, rightJaw, leftPad, rightPad];
}

function createBoom(
  root: Group,
  registry: RuntimeRegistry,
  materials: MicStandMaterials,
  options: MicStandProxyOptions,
): BoomParts {
  const boom = createContainer(root, registry, "boom-assembly", boxCollider([0.47, 0.25, 0.09]));
  const hinge = createHinge(boom, registry, materials, options);
  const hardware = createBoomHardware(boom, registry, materials, options);
  const clip = createEmptyClip(boom, registry, materials, options);
  return { hinge, hardware, clip };
}

function createSocket(root: Group, registry: RuntimeRegistry, id: string, position: Vector3Tuple): void {
  const socket = new Object3D();
  socket.name = `${id}__socket`;
  socket.position.set(...position);
  root.add(socket);
  registry.sockets[id] = socket;
}

function createSockets(root: Group, registry: RuntimeRegistry): void {
  createSocket(root, registry, "floor-contact", [0, 0, 0]);
  createSocket(root, registry, "hub-centre", [HUB_X, 0.145, 0]);
  createSocket(root, registry, "upright-bottom", [HUB_X, 0.185, 0]);
  createSocket(root, registry, "telescoping-lock", [HUB_X, 0.99, 0]);
  createSocket(root, registry, "boom-hinge", [HUB_X, 1.43, 0]);
  createSocket(root, registry, "boom-terminal", [0.2, 1.55, 0]);
  createSocket(root, registry, "empty-clip-centre", [0.205, 1.575, 0]);
  for (const definition of FOOT_DEFINITIONS) {
    createSocket(root, registry, `foot-${definition.id}`, [definition.centre[0], 0, definition.centre[2]]);
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

function registeredMembers(
  registry: RuntimeRegistry,
  groupId: string,
  memberIds: readonly string[],
): Object3D[] {
  return memberIds.map((memberId) => {
    const node = registry.nodes[memberId];
    if (node === undefined) {
      throw new Error(`mic-stand destruction group ${groupId} references missing node ${memberId}`);
    }
    return node;
  });
}

function assignDestructionGroups(registry: RuntimeRegistry): void {
  const semanticGroups = {
    "tripod-base-assembly": [
      "tripod-hub",
      "tripod-leg-system",
      "tripod-foot-system",
      "leg-root-hardware-system",
    ],
    "tripod-hub": ["tripod-hub-shell", "tripod-hub-lower-collar"],
    "tripod-leg-system": [
      "tripod-leg-rear",
      "tripod-leg-front-left",
      "tripod-leg-front-right",
    ],
    "tripod-foot-system": [
      "tripod-foot-rear",
      "tripod-foot-front-left",
      "tripod-foot-front-right",
    ],
    "leg-root-hardware-system": [
      "tripod-leg-root-rear-cap",
      "tripod-leg-root-front-left-cap",
      "tripod-leg-root-front-right-cap",
    ],
    "upright-assembly": [
      "lower-upright-pole",
      "upper-upright-pole",
      "telescoping-lock-collar",
    ],
    "collar-grip-rib-system": [
      "telescoping-collar-rib-1",
      "telescoping-collar-rib-2",
      "telescoping-collar-rib-3",
      "telescoping-collar-rib-4",
    ],
    "boom-assembly": [
      "boom-hinge-body",
      "hinge-axle-system",
      "boom-tube",
      "rear-counterweight",
      "boom-slide-collar",
      "boom-cable-clip",
      "terminal-adapter",
      "empty-microphone-clip",
    ],
    "hinge-axle-system": [
      "hinge-axle",
      "hinge-axle-cap-left",
      "hinge-axle-cap-right",
      "hinge-axle-inset-left",
      "hinge-axle-inset-right",
    ],
    "empty-microphone-clip": ["empty-clip-cradle", "empty-clip-jaw-system"],
    "empty-clip-jaw-system": ["empty-clip-left-jaw", "empty-clip-right-jaw"],
  } as const satisfies Readonly<Record<string, readonly string[]>>;

  for (const [groupId, memberIds] of Object.entries(semanticGroups)) {
    registry.destructionGroups[groupId] = registeredMembers(registry, groupId, memberIds);
  }
}

/**
 * Build an approximate passive tripod microphone-stand planning proxy in metres.
 * The single ImageGen reference is presentation evidence only: it does not
 * establish measured product geometry, load ratings, working adjustment,
 * thread standards, a microphone, a cable, power, branding, or tags.
 */
export function createMicStandProxy(options: MicStandProxyOptions = {}): Group {
  const root = new Group();
  root.name = "mic-stand";
  root.userData.componentId = "root";
  const registry = createRegistry(root);
  const materials = createMaterials();
  createTripod(root, registry, materials, options);
  createUpright(root, registry, materials, options);
  createBoom(root, registry, materials, options);
  createSockets(root, registry);
  assignDestructionGroups(registry);

  root.userData.canonicalDimensionsMetres = [WIDTH_METRES, HEIGHT_METRES, DEPTH_METRES];
  root.userData.evidenceSource =
    "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#mic-stand";
  root.userData.evidenceImage =
    "packages/web/src/assets/generated-furniture/mic-stand-imagegen-v1.png";
  root.userData.provenance = "generated";
  root.userData.authority = "presentation-only";
  root.userData.measuredGeometry = false;
  root.userData.operational = false;
  root.userData.passiveStandOnly = true;
  root.userData.containsMicrophone = false;
  root.userData.containsCable = false;
  root.userData.containsPower = false;
  root.userData.branded = false;
  root.userData.tagged = false;
  root.userData.emptyUniversalClip = true;
  root.userData.colliderAuthority = "metadata-only";
  root.userData.sculptRuntime = registry satisfies Img2ThreeSculptRuntime;
  return root;
}
