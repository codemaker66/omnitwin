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
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { Img2ThreeSculptRuntime } from "../../../lib/furniture-presentation-runtime.js";

const PROJECTOR_WIDTH_METRES = 0.55;
const PROJECTOR_HEIGHT_METRES = 0.1;
const PROJECTOR_DEPTH_METRES = 0.35;
const TEXTURE_SIZE = 64;
const EXPLODE_WITH_PARENT = true;

type Vector3Tuple = readonly [number, number, number];
type TextureChannel = "albedo" | "bump" | "roughness";

export interface ProjectorProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface ProjectorMaterials {
  readonly shell: MeshPhysicalMaterial;
  readonly fascia: MeshStandardMaterial;
  readonly cavity: MeshStandardMaterial;
  readonly optics: MeshPhysicalMaterial;
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
  | CylinderColliderDescriptor
  | SphereColliderDescriptor;

interface RuntimeRegistry {
  readonly nodes: Record<string, Object3D>;
  readonly meshes: Record<string, Mesh>;
  readonly sockets: Record<string, Object3D>;
  readonly colliders: Record<string, ColliderDescriptor>;
  readonly destructionGroups: Record<string, Object3D[]>;
}

interface ProjectorParts {
  readonly shell: readonly Group[];
  readonly optics: readonly Group[];
  readonly ventilation: readonly Group[];
  readonly feet: readonly Group[];
  readonly rearDetail: readonly Group[];
}

interface ShellParts {
  readonly all: readonly Group[];
  readonly top: Group;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function shellTexturePixels(channel: TextureChannel): Uint8Array {
  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const broad = Math.sin(x * 0.13) * 0.5 + Math.sin(y * 0.17) * 0.5;
      const hashed = (
        (x * 37 + y * 101 + ((x * y) % 29) * 17) % 31
      ) / 15 - 1;
      const grain = broad * 0.12 + hashed * 0.88;
      const index = (y * TEXTURE_SIZE + x) * 4;
      if (channel === "albedo") {
        pixels[index] = clampByte(73 + grain * 1.3);
        pixels[index + 1] = clampByte(73 + grain * 1.3);
        pixels[index + 2] = clampByte(76 + grain * 1.3);
      } else {
        const base = channel === "bump" ? 128 : 148;
        const amplitude = channel === "bump" ? 4 : 3;
        const value = clampByte(base + grain * amplitude);
        pixels[index] = value;
        pixels[index + 1] = value;
        pixels[index + 2] = value;
      }
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

function createShellTexture(channel: TextureChannel): DataTexture {
  const texture = new DataTexture(
    shellTexturePixels(channel),
    TEXTURE_SIZE,
    TEXTURE_SIZE,
  );
  texture.name = `projector-shell-${channel}`;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  if (channel === "albedo") texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createMaterials(): ProjectorMaterials {
  const shell = new MeshPhysicalMaterial({
    map: createShellTexture("albedo"),
    bumpMap: createShellTexture("bump"),
    roughnessMap: createShellTexture("roughness"),
    bumpScale: 0.00003,
    clearcoat: 0.12,
    clearcoatRoughness: 0.48,
    metalness: 0.08,
    roughness: 0.58,
    side: FrontSide,
  });
  shell.name = "projector-satin-charcoal-shell";
  const fascia = new MeshStandardMaterial({
    color: 0x3b3b3e,
    metalness: 0.06,
    roughness: 0.62,
    side: FrontSide,
  });
  fascia.name = "projector-front-fascia";
  const cavity = new MeshStandardMaterial({
    color: 0x080809,
    metalness: 0,
    roughness: 0.8,
    side: FrontSide,
  });
  cavity.name = "projector-cavity";
  const optics = new MeshPhysicalMaterial({
    color: 0x142324,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
    metalness: 0,
    roughness: 0.1,
    side: FrontSide,
  });
  optics.name = "projector-non-emissive-optics";
  const rubber = new MeshStandardMaterial({
    color: 0x151516,
    metalness: 0,
    roughness: 0.88,
    side: FrontSide,
  });
  rubber.name = "projector-rubber";
  return { shell, fascia, cavity, optics, rubber };
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

function sphereCollider(radius: number): SphereColliderDescriptor {
  return { shape: "sphere", radius, approximate: true, authority: "presentation-only" };
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
  options: ProjectorProxyOptions,
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

function createPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  geometry: BufferGeometry,
  material: Material,
  position: Vector3Tuple,
  collider: ColliderDescriptor,
  options: ProjectorProxyOptions,
  surfaceDetail = false,
  meshRotation: Vector3Tuple = [0, 0, 0],
  meshScale: Vector3Tuple = [1, 1, 1],
): Group {
  const pivot = namedPivot(id);
  pivot.position.set(...position);
  const mesh = configureMesh(new Mesh(geometry, material), id, options);
  mesh.rotation.set(...meshRotation);
  mesh.scale.set(...meshScale);
  pivot.add(mesh);
  parent.add(pivot);
  registry.nodes[id] = pivot;
  registry.meshes[id] = mesh;
  registry.colliders[id] = collider;
  if (surfaceDetail) markSurfaceDetail(pivot, mesh);
  return pivot;
}

function createRoundedBoxPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  size: Vector3Tuple,
  position: Vector3Tuple,
  material: Material,
  radius: number,
  options: ProjectorProxyOptions,
  surfaceDetail = false,
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
    surfaceDetail,
  );
}

function createBoxPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  size: Vector3Tuple,
  position: Vector3Tuple,
  material: Material,
  options: ProjectorProxyOptions,
  surfaceDetail = false,
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
    surfaceDetail,
  );
}

function createShell(
  root: Group,
  registry: RuntimeRegistry,
  materials: ProjectorMaterials,
  options: ProjectorProxyOptions,
): ShellParts {
  const chassis = createRoundedBoxPart(
    root,
    registry,
    "chassis-shell",
    [0.538, 0.083, 0.338],
    [0, 0.0505, 0.003],
    materials.shell,
    0.022,
    options,
  );
  const top = createRoundedBoxPart(
    root,
    registry,
    "top-shell",
    [0.55, 0.019, 0.35],
    [0, 0.0905, 0],
    materials.shell,
    0.0045,
    options,
    false,
    1,
  );
  const fascia = createRoundedBoxPart(
    root,
    registry,
    "front-fascia",
    [0.536, 0.071, 0.014],
    [0, 0.049, -0.167],
    materials.fascia,
    0.006,
    options,
  );
  const band = createRoundedBoxPart(
    top,
    registry,
    "shell-shadow-band",
    [0.544, 0.003, 0.344],
    [0, -0.009, 0],
    materials.cavity,
    0.001,
    options,
    true,
  );
  return { all: [chassis, top, fascia, band], top };
}

function createTopInset(
  top: Group,
  registry: RuntimeRegistry,
  materials: ProjectorMaterials,
  options: ProjectorProxyOptions,
): readonly Group[] {
  const panel = createBoxPart(
    top,
    registry,
    "top-inset-panel",
    [0.498, 0.002, 0.298],
    [0, 0.0085, -0.002],
    materials.shell,
    options,
    true,
  );
  const rails = [
    createBoxPart(
      panel, registry, "top-seam-front", [0.46, 0.0008, 0.002],
      [0, 0.00045, -0.132], materials.cavity, options, true,
    ),
    createBoxPart(
      panel, registry, "top-seam-rear", [0.46, 0.0008, 0.002],
      [0, 0.00045, 0.132], materials.cavity, options, true,
    ),
    createBoxPart(
      panel, registry, "top-seam-left", [0.002, 0.0008, 0.264],
      [-0.232, 0.00045, 0], materials.cavity, options, true,
    ),
    createBoxPart(
      panel, registry, "top-seam-right", [0.002, 0.0008, 0.264],
      [0.232, 0.00045, 0], materials.cavity, options, true,
    ),
  ];
  return [panel, ...rails];
}

function createOptics(
  root: Group,
  registry: RuntimeRegistry,
  materials: ProjectorMaterials,
  options: ProjectorProxyOptions,
): readonly Group[] {
  const window = createRoundedBoxPart(
    root,
    registry,
    "optical-assembly",
    [0.19, 0.064, 0.008],
    [0, 0.052, -0.1705],
    materials.cavity,
    0.003,
    options,
  );
  const outer = createPart(
    window,
    registry,
    "lens-bezel-stack",
    new TorusGeometry(0.027, 0.0035, 14, 36),
    materials.fascia,
    [0, 0, -0.001],
    cylinderCollider(0.0305, 0.007, "z"),
    options,
    true,
  );
  const inner = createPart(
    window,
    registry,
    "lens-inner-bezel",
    new TorusGeometry(0.0215, 0.0022, 12, 32),
    materials.cavity,
    [0, 0, -0.0023],
    cylinderCollider(0.0237, 0.0044, "z"),
    options,
    true,
  );
  const glass = createPart(
    window,
    registry,
    "lens-glass",
    new SphereGeometry(0.019, 32, 18),
    materials.optics,
    [0, 0, -0.00108],
    sphereCollider(0.019),
    options,
    true,
    [0, 0, 0],
    [1, 1, 0.18],
  );
  return [window, outer, inner, glass];
}

function frontLouvreY(index: number): number {
  return (index - 3) * 0.0072;
}

function createFrontVentBank(
  side: "left" | "right",
  root: Group,
  registry: RuntimeRegistry,
  materials: ProjectorMaterials,
  options: ProjectorProxyOptions,
): readonly Group[] {
  const x = side === "left" ? -0.19 : 0.19;
  const bank = createRoundedBoxPart(
    root,
    registry,
    side === "left" ? "front-vent-system" : "front-right-vent",
    [0.105, 0.056, 0.009],
    [x, 0.052, -0.1695],
    materials.cavity,
    0.003,
    options,
  );
  const louvres = Array.from({ length: 7 }, (_, index) => createRoundedBoxPart(
    bank,
    registry,
    `front-${side}-louvre-${String(index + 1)}`,
    [0.098, 0.0027, 0.004],
    [0, frontLouvreY(index), -0.0035],
    materials.cavity,
    0.001,
    options,
    true,
  ));
  const rib = createBoxPart(
    bank,
    registry,
    `front-${side}-vent-rib`,
    [0.003, 0.052, 0.003],
    [0, 0, -0.002],
    materials.cavity,
    options,
    true,
  );
  return [bank, ...louvres, rib];
}

function createRightSideVent(
  root: Group,
  registry: RuntimeRegistry,
  materials: ProjectorMaterials,
  options: ProjectorProxyOptions,
): readonly Group[] {
  const bank = createRoundedBoxPart(
    root,
    registry,
    "side-vent-system",
    [0.008, 0.061, 0.19],
    [0.27, 0.052, 0.025],
    materials.cavity,
    0.003,
    options,
  );
  const louvres = Array.from({ length: 11 }, (_, index) => createRoundedBoxPart(
    bank,
    registry,
    `right-side-louvre-${String(index + 1)}`,
    [0.004, 0.0022, 0.177],
    [0.0025, (index - 5) * 0.005, 0],
    materials.cavity,
    0.0008,
    options,
    true,
  ));
  const ribs = [-0.06, 0, 0.06].map((z, index) => createBoxPart(
    bank,
    registry,
    `right-side-vent-rib-${String(index + 1)}`,
    [0.004, 0.056, 0.003],
    [0.002, 0, z],
    materials.cavity,
    options,
    true,
  ));
  return [bank, ...louvres, ...ribs];
}

function createRearDetail(
  root: Group,
  registry: RuntimeRegistry,
  materials: ProjectorMaterials,
  options: ProjectorProxyOptions,
): readonly Group[] {
  const recess = createRoundedBoxPart(
    root,
    registry,
    "rear-connector-recess",
    [0.008, 0.044, 0.034],
    [0.27, 0.052, 0.145],
    materials.cavity,
    0.002,
    options,
  );
  const inlet = createPart(
    recess,
    registry,
    "rear-generic-inlet",
    new CylinderGeometry(0.006, 0.006, 0.004, 20, 1),
    materials.fascia,
    [0.0025, 0, 0],
    cylinderCollider(0.006, 0.004, "x"),
    options,
    true,
    [0, 0, -Math.PI / 2],
  );
  return [recess, inlet];
}

function createFoot(
  id: string,
  position: Vector3Tuple,
  root: Group,
  registry: RuntimeRegistry,
  materials: ProjectorMaterials,
  options: ProjectorProxyOptions,
): readonly Group[] {
  const foot = createPart(
    root,
    registry,
    id,
    new CylinderGeometry(0.0135, 0.0145, 0.006, 24, 1),
    materials.rubber,
    position,
    cylinderCollider(0.0145, 0.006),
    options,
  );
  const collar = createPart(
    foot,
    registry,
    `${id}-collar`,
    new CylinderGeometry(0.016, 0.016, 0.0045, 24, 1),
    materials.rubber,
    [0, 0.00425, 0],
    cylinderCollider(0.016, 0.0045),
    options,
    true,
  );
  return [foot, collar];
}

function createFeet(
  root: Group,
  registry: RuntimeRegistry,
  materials: ProjectorMaterials,
  options: ProjectorProxyOptions,
): readonly Group[] {
  const definitions = [
    ["foot-system", [-0.238, 0.003, -0.138]],
    ["front-right-foot", [0.238, 0.003, -0.138]],
    ["rear-left-foot", [-0.238, 0.003, 0.138]],
    ["rear-right-foot", [0.238, 0.003, 0.138]],
  ] as const satisfies readonly (readonly [string, Vector3Tuple])[];
  return definitions.flatMap(([id, position]) =>
    createFoot(id, position, root, registry, materials, options));
}

function createSocket(
  root: Group,
  registry: RuntimeRegistry,
  id: string,
  position: Vector3Tuple,
): void {
  const socket = new Object3D();
  socket.name = `${id}__socket`;
  socket.position.set(...position);
  root.add(socket);
  registry.sockets[id] = socket;
}

function createSockets(root: Group, registry: RuntimeRegistry): void {
  createSocket(root, registry, "floor-contact", [0, 0, 0]);
  createSocket(root, registry, "lens-origin", [0, 0.052, -0.175]);
  createSocket(root, registry, "mount-centre", [0, 0.1, 0]);
  createSocket(root, registry, "power-rear", [0.275, 0.052, 0.145]);
}

function createRuntimeRegistry(root: Group): RuntimeRegistry {
  return {
    nodes: { root },
    meshes: {},
    sockets: {},
    colliders: {
      root: boxCollider([
        PROJECTOR_WIDTH_METRES,
        PROJECTOR_HEIGHT_METRES,
        PROJECTOR_DEPTH_METRES,
      ]),
    },
    destructionGroups: {},
  };
}

function assignDestructionGroups(
  registry: RuntimeRegistry,
  parts: ProjectorParts,
): void {
  registry.destructionGroups.shell = [...parts.shell];
  registry.destructionGroups.optics = [...parts.optics];
  registry.destructionGroups.ventilation = [...parts.ventilation];
  registry.destructionGroups.feet = [...parts.feet];
  registry.destructionGroups["rear-detail"] = [...parts.rearDetail];
}

/**
 * Build an approximate, non-operational projector stand-in in canonical metres.
 * The single ImageGen reference does not establish measured product geometry,
 * rear/underside construction, working optics, airflow, power, or photometrics.
 */
export function createProjectorProxy(
  options: ProjectorProxyOptions = {},
): Group {
  const root = new Group();
  root.name = "projector";
  root.userData.componentId = "root";
  const registry = createRuntimeRegistry(root);
  const materials = createMaterials();
  const shell = createShell(root, registry, materials, options);
  const topInset = createTopInset(shell.top, registry, materials, options);
  const optics = createOptics(root, registry, materials, options);
  const ventilation = [
    ...createFrontVentBank("left", root, registry, materials, options),
    ...createFrontVentBank("right", root, registry, materials, options),
    ...createRightSideVent(root, registry, materials, options),
  ];
  const rearDetail = createRearDetail(root, registry, materials, options);
  const feet = createFeet(root, registry, materials, options);
  createSockets(root, registry);
  assignDestructionGroups(registry, {
    shell: [...shell.all, ...topInset],
    optics,
    ventilation,
    feet,
    rearDetail,
  });

  root.userData.canonicalDimensionsMetres = [
    PROJECTOR_WIDTH_METRES,
    PROJECTOR_HEIGHT_METRES,
    PROJECTOR_DEPTH_METRES,
  ];
  root.userData.evidenceSource =
    "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#projector";
  root.userData.evidenceImage =
    "packages/web/src/assets/generated-furniture/projector-imagegen-v1.png";
  root.userData.provenance = "generated";
  root.userData.authority = "presentation-only";
  root.userData.measuredGeometry = false;
  root.userData.operational = false;
  root.userData.colliderAuthority = "metadata-only";
  root.userData.sculptRuntime = registry satisfies Img2ThreeSculptRuntime;
  return root;
}
