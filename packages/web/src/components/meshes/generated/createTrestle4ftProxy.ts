import {
  BoxGeometry,
  CylinderGeometry,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { Img2ThreeSculptRuntime } from "../../../lib/furniture-presentation-runtime.js";

const TABLE_WIDTH_METRES = 1.22;
const TABLE_HEIGHT_METRES = 0.74;
const TABLE_DEPTH_METRES = 0.76;
const TABLETOP_THICKNESS_METRES = 0.055;
const TABLETOP_VENEER_THICKNESS_METRES = 0.003;
const TABLETOP_CORE_THICKNESS_METRES =
  TABLETOP_THICKNESS_METRES - TABLETOP_VENEER_THICKNESS_METRES;
const TABLETOP_CENTRE_Y_METRES = TABLE_HEIGHT_METRES - TABLETOP_THICKNESS_METRES / 2;
const SUPPORT_OFFSET_X_METRES = 0.4;
const SUPPORT_END_OVERHANG_METRES = TABLE_WIDTH_METRES / 2 - SUPPORT_OFFSET_X_METRES;
const SUPPORT_FRONT_REAR_Z_METRES = 0.275;
const UNDERSIDE_Y_METRES = TABLE_HEIGHT_METRES - TABLETOP_THICKNESS_METRES;
const STRETCHER_LENGTH_METRES = SUPPORT_OFFSET_X_METRES * 2 + 0.04;
const OAK_TEXTURE_SIZE = 256;
const STEEL_TEXTURE_SIZE = 64;
const EXPLODE_WITH_PARENT = true;

type Vector3Tuple = readonly [number, number, number];
type SupportSide = "left" | "right";
type DepthSide = "front" | "rear";

export interface Trestle4ftProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface Trestle4ftMaterials {
  readonly oak: MeshStandardMaterial;
  readonly oakEdge: MeshStandardMaterial;
  readonly steel: MeshStandardMaterial;
  readonly hardware: MeshStandardMaterial;
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
  readonly axis?: "x" | "y" | "z";
}

type ColliderDescriptor = BoxColliderDescriptor | CylinderColliderDescriptor;

interface SupportParts {
  readonly structural: readonly Group[];
  readonly braces: readonly Group[];
  readonly feet: readonly Group[];
  readonly fasteners: readonly Group[];
  readonly floorBar: Group;
  readonly undersideRail: Group;
}

interface ProceduralMaps {
  readonly albedo: DataTexture;
  readonly bump: DataTexture;
  readonly roughness: DataTexture;
}

function boxCollider(size: Vector3Tuple): BoxColliderDescriptor {
  return { shape: "box", size };
}

function cylinderCollider(
  radius: number,
  height: number,
  axis: "x" | "y" | "z" = "y",
): CylinderColliderDescriptor {
  return { shape: "cylinder", radius, height, axis };
}

function configureTexture(texture: DataTexture, name: string, repeat: Vector3Tuple): DataTexture {
  texture.name = name;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createOakMaps(): ProceduralMaps {
  const albedoPixels = new Uint8Array(OAK_TEXTURE_SIZE * OAK_TEXTURE_SIZE * 4);
  const bumpPixels = new Uint8Array(OAK_TEXTURE_SIZE * OAK_TEXTURE_SIZE * 4);
  const roughnessPixels = new Uint8Array(OAK_TEXTURE_SIZE * OAK_TEXTURE_SIZE * 4);

  for (let y = 0; y < OAK_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < OAK_TEXTURE_SIZE; x += 1) {
      const textureX = x * 96 / OAK_TEXTURE_SIZE;
      const textureY = y * 96 / OAK_TEXTURE_SIZE;
      const broad = Math.sin(textureY * 0.065 + Math.sin(textureX * 0.045) * 0.42);
      const fine = Math.sin(textureY * 0.23 + Math.sin(textureX * 0.09) * 0.55) * 0.35;
      const variation = Math.round(broad * 8 + fine * 3);
      const height = 128;
      const roughness = 145;
      const index = (y * OAK_TEXTURE_SIZE + x) * 4;

      albedoPixels[index] = 168 + variation;
      albedoPixels[index + 1] = 132 + variation;
      albedoPixels[index + 2] = 96 + Math.round(variation * 0.75);
      albedoPixels[index + 3] = 255;
      bumpPixels[index] = height;
      bumpPixels[index + 1] = height;
      bumpPixels[index + 2] = height;
      bumpPixels[index + 3] = 255;
      roughnessPixels[index] = roughness;
      roughnessPixels[index + 1] = roughness;
      roughnessPixels[index + 2] = roughness;
      roughnessPixels[index + 3] = 255;
    }
  }

  const albedo = configureTexture(
    new DataTexture(albedoPixels, OAK_TEXTURE_SIZE, OAK_TEXTURE_SIZE),
    "trestle-4ft-oak-albedo",
    [1, 1, 1],
  );
  albedo.colorSpace = SRGBColorSpace;
  return {
    albedo,
    bump: configureTexture(
      new DataTexture(bumpPixels, OAK_TEXTURE_SIZE, OAK_TEXTURE_SIZE),
      "trestle-4ft-oak-bump",
      [1, 1, 1],
    ),
    roughness: configureTexture(
      new DataTexture(roughnessPixels, OAK_TEXTURE_SIZE, OAK_TEXTURE_SIZE),
      "trestle-4ft-oak-roughness",
      [1, 1, 1],
    ),
  };
}

function createSteelRoughnessMap(): DataTexture {
  const pixels = new Uint8Array(STEEL_TEXTURE_SIZE * STEEL_TEXTURE_SIZE * 4);
  for (let y = 0; y < STEEL_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < STEEL_TEXTURE_SIZE; x += 1) {
      const stipple = ((x * 37 + y * 17 + (x ^ y) * 13) % 23) - 11;
      const value = Math.max(0, Math.min(255, 120 + stipple));
      const index = (y * STEEL_TEXTURE_SIZE + x) * 4;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }
  return configureTexture(
    new DataTexture(pixels, STEEL_TEXTURE_SIZE, STEEL_TEXTURE_SIZE),
    "trestle-4ft-powder-coat-roughness",
    [5, 5, 1],
  );
}

function createMaterials(): Trestle4ftMaterials {
  const oakMaps = createOakMaps();
  return {
    oak: new MeshStandardMaterial({
      map: oakMaps.albedo,
      bumpMap: oakMaps.bump,
      bumpScale: 0.00025,
      roughnessMap: oakMaps.roughness,
      metalness: 0,
      roughness: 0.56,
    }),
    oakEdge: new MeshStandardMaterial({ color: 0x8a6a4b, metalness: 0, roughness: 0.62 }),
    steel: new MeshStandardMaterial({
      color: 0x27292a,
      metalness: 0.62,
      roughness: 0.72,
      roughnessMap: createSteelRoughnessMap(),
    }),
    hardware: new MeshStandardMaterial({ color: 0x4e5254, metalness: 0.78, roughness: 0.48 }),
    rubber: new MeshStandardMaterial({ color: 0x151617, metalness: 0, roughness: 0.84 }),
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
  options: Trestle4ftProxyOptions,
): Mesh {
  mesh.name = `${id}__mesh`;
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  mesh.userData.componentId = id;
  return mesh;
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

function createMeshPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  geometry: BufferGeometry,
  material: Material,
  position: Vector3Tuple,
  collider: ColliderDescriptor,
  options: Trestle4ftProxyOptions,
  rotation: Vector3Tuple = [0, 0, 0],
): Group {
  const pivot = namedPivot(id);
  pivot.position.set(...position);
  const mesh = configureMesh(new Mesh(geometry, material), id, options);
  mesh.rotation.set(...rotation);
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
  options: Trestle4ftProxyOptions,
  surfaceDetail = false,
): Group {
  const part = createMeshPart(
    parent,
    registry,
    id,
    new BoxGeometry(...size),
    material,
    position,
    boxCollider(size),
    options,
  );
  if (surfaceDetail) markSurfaceDetail(part, registry.meshes[id]);
  return part;
}

function createRoundedBoxPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  size: Vector3Tuple,
  position: Vector3Tuple,
  radius: number,
  material: Material,
  options: Trestle4ftProxyOptions,
  surfaceDetail = false,
): Group {
  const part = createMeshPart(
    parent,
    registry,
    id,
    new RoundedBoxGeometry(...size, 2, radius),
    material,
    position,
    boxCollider(size),
    options,
  );
  if (surfaceDetail) markSurfaceDetail(part, registry.meshes[id]);
  return part;
}

function markSurfaceDetail(pivot: Group, mesh: Mesh | undefined): void {
  if (mesh === undefined) throw new Error(`trestle-4ft detail ${pivot.name} is missing its mesh`);
  pivot.userData.explodeWithParent = EXPLODE_WITH_PARENT;
  pivot.userData.surfaceDetail = true;
  mesh.userData.explodeWithParent = EXPLODE_WITH_PARENT;
  mesh.userData.surfaceDetail = true;
}

function createBeamPart(
  root: Group,
  registry: RuntimeRegistry,
  id: string,
  start: Vector3Tuple,
  end: Vector3Tuple,
  crossSection: readonly [number, number],
  material: Material,
  options: Trestle4ftProxyOptions,
): Group {
  const startPoint = new Vector3(...start);
  const direction = new Vector3(...end).sub(startPoint);
  const length = direction.length();
  const midpoint = startPoint.clone().addScaledVector(direction, 0.5);
  const part = createMeshPart(
    root,
    registry,
    id,
    new BoxGeometry(crossSection[0], length, crossSection[1]),
    material,
    [midpoint.x, midpoint.y, midpoint.z],
    boxCollider([crossSection[0], length, crossSection[1]]),
    options,
  );
  const mesh = registry.meshes[id];
  if (mesh === undefined) throw new Error(`trestle-4ft beam ${id} is missing its mesh`);
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    direction.normalize(),
  ));
  return part;
}

function createTabletop(
  root: Group,
  registry: RuntimeRegistry,
  materials: Trestle4ftMaterials,
  options: Trestle4ftProxyOptions,
): { readonly tabletop: Group; readonly details: readonly Group[] } {
  const tabletop = createMeshPart(
    root,
    registry,
    "tabletop",
    new RoundedBoxGeometry(
      TABLE_WIDTH_METRES,
      TABLETOP_CORE_THICKNESS_METRES,
      TABLE_DEPTH_METRES,
      2,
      0.01,
    ),
    materials.oakEdge,
    [0, TABLETOP_CENTRE_Y_METRES, 0],
    boxCollider([TABLE_WIDTH_METRES, TABLETOP_THICKNESS_METRES, TABLE_DEPTH_METRES]),
    options,
  );
  const coreMesh = registry.meshes.tabletop;
  if (coreMesh === undefined) throw new Error("trestle-4ft tabletop is missing its core mesh");
  coreMesh.position.y = -TABLETOP_VENEER_THICKNESS_METRES / 2;

  const veneer = createRoundedBoxPart(
    tabletop,
    registry,
    "tabletop-surface-detail",
    [1.196, TABLETOP_VENEER_THICKNESS_METRES, 0.736],
    [0, TABLETOP_CORE_THICKNESS_METRES / 2, 0],
    0.006,
    materials.oak,
    options,
    true,
  );
  const edgeDepth = 0.006;
  const edges = [
    createBoxPart(tabletop, registry, "tabletop-front-edge-detail", [1.19, 0.041, edgeDepth], [0, -0.003, TABLE_DEPTH_METRES / 2 - edgeDepth / 2], materials.oakEdge, options, true),
    createBoxPart(tabletop, registry, "tabletop-rear-edge-detail", [1.19, 0.041, edgeDepth], [0, -0.003, -TABLE_DEPTH_METRES / 2 + edgeDepth / 2], materials.oakEdge, options, true),
    createBoxPart(tabletop, registry, "tabletop-left-edge-detail", [edgeDepth, 0.041, 0.724], [-TABLE_WIDTH_METRES / 2 + edgeDepth / 2, -0.003, 0], materials.oakEdge, options, true),
    createBoxPart(tabletop, registry, "tabletop-right-edge-detail", [edgeDepth, 0.041, 0.724], [TABLE_WIDTH_METRES / 2 - edgeDepth / 2, -0.003, 0], materials.oakEdge, options, true),
  ];
  return { tabletop, details: [veneer, ...edges] };
}

function sideX(side: SupportSide): number {
  return side === "left" ? -SUPPORT_OFFSET_X_METRES : SUPPORT_OFFSET_X_METRES;
}

function depthZ(depthSide: DepthSide): number {
  return depthSide === "front" ? SUPPORT_FRONT_REAR_Z_METRES : -SUPPORT_FRONT_REAR_Z_METRES;
}

function createFootCaps(
  side: SupportSide,
  root: Group,
  registry: RuntimeRegistry,
  materials: Trestle4ftMaterials,
  options: Trestle4ftProxyOptions,
): readonly Group[] {
  const x = sideX(side);
  return (["front", "rear"] as const).map((depthSide) => createRoundedBoxPart(
    root,
    registry,
    `${side}-${depthSide}-foot-cap`,
    [0.085, 0.05, 0.05],
    [x, 0.025, depthSide === "front" ? 0.355 : -0.355],
    0.006,
    materials.rubber,
    options,
  ));
}

function createBolt(
  id: string,
  parent: Object3D,
  registry: RuntimeRegistry,
  position: Vector3Tuple,
  material: Material,
  options: Trestle4ftProxyOptions,
): Group {
  const bolt = createMeshPart(
    parent,
    registry,
    id,
    new CylinderGeometry(0.007, 0.007, 0.008, 16, 1),
    material,
    position,
    cylinderCollider(0.007, 0.008, "x"),
    options,
    [0, 0, Math.PI / 2],
  );
  markSurfaceDetail(bolt, registry.meshes[id]);
  return bolt;
}

function createJointHardware(
  side: SupportSide,
  depthSide: DepthSide,
  root: Group,
  registry: RuntimeRegistry,
  materials: Trestle4ftMaterials,
  options: Trestle4ftProxyOptions,
): readonly Group[] {
  const x = sideX(side);
  const z = depthZ(depthSide);
  const plate = createRoundedBoxPart(
    root,
    registry,
    `${side}-${depthSide}-hinge-plate-detail`,
    [0.012, 0.09, 0.075],
    [x, 0.3, z],
    0.004,
    materials.hardware,
    options,
    false,
  );
  const outwardX = side === "left" ? -0.01 : 0.01;
  return [
    plate,
    createBolt(`${side}-${depthSide}-hinge-bolt-lower-detail`, plate, registry, [outwardX, -0.022, 0], materials.hardware, options),
    createBolt(`${side}-${depthSide}-hinge-bolt-upper-detail`, plate, registry, [outwardX, 0.022, 0], materials.hardware, options),
  ];
}

function createSupport(
  side: SupportSide,
  root: Group,
  registry: RuntimeRegistry,
  materials: Trestle4ftMaterials,
  options: Trestle4ftProxyOptions,
): SupportParts {
  const x = sideX(side);
  const undersideRail = createBoxPart(
    root,
    registry,
    `${side}-underside-rail`,
    [0.075, 0.055, 0.62],
    [x, UNDERSIDE_Y_METRES - 0.0275, 0],
    materials.steel,
    options,
  );
  const floorBar = createBoxPart(
    root,
    registry,
    `${side}-floor-bar`,
    [0.075, 0.04, 0.66],
    [x, 0.025, 0],
    materials.steel,
    options,
  );
  const uprights = (["front", "rear"] as const).map((depthSide) => createBeamPart(
    root,
    registry,
    `${side}-${depthSide}-upright`,
    [x, 0.025, depthZ(depthSide)],
    [x, 0.65, depthZ(depthSide)],
    [0.045, 0.045],
    materials.steel,
    options,
  ));
  const braces = (["front", "rear"] as const).map((depthSide) => {
    const sign = depthSide === "front" ? 1 : -1;
    return createBeamPart(
      root,
      registry,
      `${side}-${depthSide}-diagonal-brace`,
      [x, 0.275, sign * SUPPORT_FRONT_REAR_Z_METRES],
      [x, 0.65, sign * 0.075],
      [0.012, 0.024],
      materials.hardware,
      options,
    );
  });
  const feet = createFootCaps(side, root, registry, materials, options);
  const fasteners = (["front", "rear"] as const).flatMap((depthSide) =>
    createJointHardware(side, depthSide, root, registry, materials, options));
  return {
    structural: [undersideRail, floorBar, ...uprights, ...braces],
    braces,
    feet,
    fasteners,
    floorBar,
    undersideRail,
  };
}

function createStretcher(
  root: Group,
  registry: RuntimeRegistry,
  materials: Trestle4ftMaterials,
  options: Trestle4ftProxyOptions,
): { readonly stretcher: Group; readonly brackets: readonly Group[]; readonly fasteners: readonly Group[] } {
  const stretcher = createRoundedBoxPart(
    root,
    registry,
    "stretcher",
    [STRETCHER_LENGTH_METRES, 0.055, 0.05],
    [0, 0.35, 0],
    0.004,
    materials.steel,
    options,
  );
  const brackets: Group[] = [];
  const fasteners: Group[] = [];
  for (const side of ["left", "right"] as const) {
    const x = sideX(side);
    const bracket = createRoundedBoxPart(
      root,
      registry,
      `${side}-stretcher-bracket`,
      [0.025, 0.1, 0.56],
      [x, 0.35, 0],
      0.004,
      materials.hardware,
      options,
    );
    brackets.push(bracket);
    const outwardX = side === "left" ? -0.017 : 0.017;
    for (const depthSide of ["front", "rear"] as const) {
      const z = depthSide === "front" ? 0.22 : -0.22;
      fasteners.push(createBolt(
        `${side}-${depthSide}-stretcher-bolt-detail`,
        bracket,
        registry,
        [outwardX, 0, z],
        materials.hardware,
        options,
      ));
    }
  }
  return { stretcher, brackets, fasteners };
}

function createSocket(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  position: Vector3Tuple,
): void {
  const socket = new Object3D();
  socket.name = `${id}__socket`;
  socket.position.set(...position);
  parent.add(socket);
  registry.sockets[id] = socket;
}

function createSockets(root: Group, tabletop: Group, registry: RuntimeRegistry): void {
  createSocket(root, registry, "floor-contact", [0, 0, 0]);
  createSocket(tabletop, registry, "tabletop-centre", [0, TABLETOP_THICKNESS_METRES / 2, 0]);
  createSocket(root, registry, "left-support-centre", [-SUPPORT_OFFSET_X_METRES, 0.34, 0]);
  createSocket(root, registry, "right-support-centre", [SUPPORT_OFFSET_X_METRES, 0.34, 0]);
  createSocket(root, registry, "stretcher-centre", [0, 0.35, 0]);
}

function createRuntimeRegistry(root: Group): RuntimeRegistry {
  return {
    nodes: { root },
    meshes: {},
    sockets: {},
    colliders: {
      root: boxCollider([TABLE_WIDTH_METRES, TABLE_HEIGHT_METRES, TABLE_DEPTH_METRES]),
    },
    destructionGroups: {},
  };
}

function textureMaps(material: MeshStandardMaterial): readonly Texture[] {
  return [material.map, material.bumpMap, material.roughnessMap]
    .filter((map): map is Texture => map !== null);
}

/**
 * Build a compact four-foot folding trestle-table presentation proxy in metres.
 * Its support stations are authored at X +/-0.40 m for the 1.22 m top; this is
 * not a uniformly scaled six-foot factory. Hidden rear/underside construction
 * is a symmetric approximation of one AI-generated reference view.
 */
export function createTrestle4ftProxy(
  options: Trestle4ftProxyOptions = {},
): Group {
  const root = new Group();
  root.name = "trestle-4ft";
  root.userData.componentId = "root";
  const registry = createRuntimeRegistry(root);
  const materials = createMaterials();
  const tabletop = createTabletop(root, registry, materials, options);
  const left = createSupport("left", root, registry, materials, options);
  const right = createSupport("right", root, registry, materials, options);
  const stretcher = createStretcher(root, registry, materials, options);
  createSockets(root, tabletop.tabletop, registry);

  registry.destructionGroups.tabletop = [tabletop.tabletop];
  registry.destructionGroups["left-support"] = [...left.structural, ...stretcher.brackets.slice(0, 1)];
  registry.destructionGroups["right-support"] = [...right.structural, ...stretcher.brackets.slice(1)];
  registry.destructionGroups["support-stations"] = [
    ...left.structural,
    ...right.structural,
  ];
  registry.destructionGroups.stretcher = [stretcher.stretcher, ...stretcher.brackets];
  registry.destructionGroups["brace-system"] = [...left.braces, ...right.braces];
  registry.destructionGroups["foot-system"] = [...left.feet, ...right.feet];
  registry.destructionGroups["fastener-system"] = [
    ...left.fasteners,
    ...right.fasteners,
    ...stretcher.fasteners,
  ];
  registry.destructionGroups.frame = [
    ...left.structural,
    ...right.structural,
    stretcher.stretcher,
    ...stretcher.brackets,
  ];

  root.userData.canonicalDimensionsMetres = [
    TABLE_WIDTH_METRES,
    TABLE_HEIGHT_METRES,
    TABLE_DEPTH_METRES,
  ];
  root.userData.supportStationCentresXMetres = [
    -SUPPORT_OFFSET_X_METRES,
    SUPPORT_OFFSET_X_METRES,
  ];
  root.userData.supportEndOverhangMetres = SUPPORT_END_OVERHANG_METRES;
  root.userData.evidenceSource =
    "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#trestle-4ft";
  root.userData.evidenceImage =
    "packages/web/src/assets/generated-furniture/trestle-4ft-imagegen-v1.png";
  root.userData.provenance = "generated";
  root.userData.authority = "presentation-only";
  root.userData.measuredGeometry = false;
  root.userData.operational = false;
  root.userData.colliderAuthority = "metadata-only";
  root.userData.referenceLimitations = [
    "single AI-generated front-left three-quarter view",
    "rear and underside construction are symmetric approximations",
    "no folding, load-capacity, manufacturer, or physics authority",
  ];
  root.userData.proceduralMapNames = [
    ...textureMaps(materials.oak),
    ...textureMaps(materials.steel),
  ].map((map) => map.name);
  root.userData.sculptRuntime = registry satisfies Img2ThreeSculptRuntime;
  return root;
}
