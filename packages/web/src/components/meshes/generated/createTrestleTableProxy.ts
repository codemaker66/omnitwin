import {
  BoxGeometry,
  CylinderGeometry,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { Img2ThreeSculptRuntime } from "../../../lib/furniture-presentation-runtime.js";

const TABLE_WIDTH_METRES = 1.83;
const TABLE_DEPTH_METRES = 0.76;
const TABLE_HEIGHT_METRES = 0.74;
const TABLETOP_THICKNESS_METRES = 0.055;
const TABLETOP_CENTRE_Y_METRES = TABLE_HEIGHT_METRES - TABLETOP_THICKNESS_METRES / 2;
const TRESTLE_OFFSET_X_METRES = 0.62;
const FRAME_TOP_Y_METRES = TABLE_HEIGHT_METRES - TABLETOP_THICKNESS_METRES;
const FOOT_CAP_HEIGHT_METRES = 0.03;
const FOOT_CAP_OFFSET_Z_METRES = 0.335;
const OAK_TEXTURE_SIZE = 128;
const EXPLODE_WITH_PARENT = true;

type Vector3Tuple = readonly [number, number, number];
type TrestleSide = "left" | "right";

export interface TrestleTableProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface TrestleTableMaterials {
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
}

type ColliderDescriptor = BoxColliderDescriptor | CylinderColliderDescriptor;

interface TrestleBuildResult {
  readonly structuralParts: readonly Group[];
  readonly hardware: readonly Group[];
}

interface TrestleRails {
  readonly topRail: Group;
  readonly footBar: Group;
}

interface BoxDetailSpec {
  readonly id: string;
  readonly size: Vector3Tuple;
  readonly position: Vector3Tuple;
}

function boxCollider(size: Vector3Tuple): BoxColliderDescriptor {
  return { shape: "box", size };
}

function cylinderCollider(radius: number, height: number): CylinderColliderDescriptor {
  return { shape: "cylinder", radius, height };
}

function createOakTexture(): DataTexture {
  const pixels = new Uint8Array(OAK_TEXTURE_SIZE * OAK_TEXTURE_SIZE * 4);
  for (let y = 0; y < OAK_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < OAK_TEXTURE_SIZE; x += 1) {
      const longGrain = Math.sin(y * 0.27 + Math.sin(x * 0.055) * 2.3);
      const fineGrain = Math.sin(y * 1.19 + x * 0.031) * 0.42;
      const broadBand = Math.sin(y * 0.061 + x * 0.013) * 0.55;
      const variation = Math.round(longGrain * 6 + fineGrain * 4 + broadBand * 5);
      const index = (y * OAK_TEXTURE_SIZE + x) * 4;
      pixels[index] = 191 + variation;
      pixels[index + 1] = 137 + variation;
      pixels[index + 2] = 82 + Math.round(variation * 0.7);
      pixels[index + 3] = 255;
    }
  }

  const texture = new DataTexture(pixels, OAK_TEXTURE_SIZE, OAK_TEXTURE_SIZE);
  texture.name = "trestle-6ft-warm-oak-grain";
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(4, 1.5);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createMaterials(): TrestleTableMaterials {
  const oakTexture = createOakTexture();
  return {
    oak: new MeshStandardMaterial({ map: oakTexture, metalness: 0, roughness: 0.57 }),
    oakEdge: new MeshStandardMaterial({ color: 0xa96e36, metalness: 0, roughness: 0.63 }),
    steel: new MeshStandardMaterial({ color: 0x222525, metalness: 0.72, roughness: 0.43 }),
    hardware: new MeshStandardMaterial({ color: 0x555b5b, metalness: 0.86, roughness: 0.32 }),
    rubber: new MeshStandardMaterial({ color: 0x151616, metalness: 0, roughness: 0.84 }),
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
  options: TrestleTableProxyOptions,
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
  options: TrestleTableProxyOptions,
): Group {
  const pivot = namedPivot(id);
  pivot.position.set(...position);
  const mesh = configureMesh(new Mesh(geometry, material), id, options);
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
  options: TrestleTableProxyOptions,
): Group {
  return createMeshPart(
    parent,
    registry,
    id,
    new BoxGeometry(...size),
    material,
    position,
    boxCollider(size),
    options,
  );
}

function markSurfaceDetail(pivot: Group, mesh: Mesh): void {
  pivot.userData.explodeWithParent = EXPLODE_WITH_PARENT;
  pivot.userData.surfaceDetail = true;
  mesh.userData.explodeWithParent = EXPLODE_WITH_PARENT;
  mesh.userData.surfaceDetail = true;
}

function addSurfaceDetail(
  parent: Group,
  registry: RuntimeRegistry,
  id: string,
  geometry: BufferGeometry,
  material: Material,
  position: Vector3Tuple,
  collider: ColliderDescriptor,
  options: TrestleTableProxyOptions,
  rotation: Vector3Tuple = [0, 0, 0],
): Group {
  const detail = createMeshPart(
    parent,
    registry,
    id,
    geometry,
    material,
    position,
    collider,
    options,
  );
  const mesh = registry.meshes[id];
  if (mesh === undefined) throw new Error(`trestle detail ${id} is missing its mesh`);
  mesh.rotation.set(...rotation);
  markSurfaceDetail(detail, mesh);
  return detail;
}

function createBeamPart(
  root: Group,
  registry: RuntimeRegistry,
  id: string,
  start: Vector3Tuple,
  end: Vector3Tuple,
  crossSection: readonly [number, number],
  material: Material,
  options: TrestleTableProxyOptions,
): Group {
  const startPoint = new Vector3(...start);
  const direction = new Vector3(...end).sub(startPoint);
  const length = direction.length();
  const midpoint = startPoint.clone().addScaledVector(direction, 0.5);
  const geometry = new BoxGeometry(crossSection[0], length, crossSection[1]);
  const pivot = createMeshPart(
    root,
    registry,
    id,
    geometry,
    material,
    [midpoint.x, midpoint.y, midpoint.z],
    boxCollider([crossSection[0], length, crossSection[1]]),
    options,
  );
  const mesh = registry.meshes[id];
  if (mesh === undefined) throw new Error(`trestle beam ${id} is missing its mesh`);
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    direction.normalize(),
  ));
  return pivot;
}

function addTabletopDetails(
  tabletop: Group,
  registry: RuntimeRegistry,
  materials: TrestleTableMaterials,
  options: TrestleTableProxyOptions,
): readonly Group[] {
  const veneerThickness = 0.003;
  const edgeDepth = 0.006;
  const edgeSpecs: readonly BoxDetailSpec[] = [
    { id: "tabletop-front-edge-detail", size: [1.79, 0.043, edgeDepth], position: [0, 0, TABLE_DEPTH_METRES / 2 - edgeDepth / 2] },
    { id: "tabletop-rear-edge-detail", size: [1.79, 0.043, edgeDepth], position: [0, 0, -TABLE_DEPTH_METRES / 2 + edgeDepth / 2] },
    { id: "tabletop-left-edge-detail", size: [edgeDepth, 0.043, 0.744], position: [-TABLE_WIDTH_METRES / 2 + edgeDepth / 2, 0, 0] },
    { id: "tabletop-right-edge-detail", size: [edgeDepth, 0.043, 0.744], position: [TABLE_WIDTH_METRES / 2 - edgeDepth / 2, 0, 0] },
  ];
  const surface = addSurfaceDetail(
    tabletop,
    registry,
    "tabletop-surface-detail",
    new RoundedBoxGeometry(1.806, veneerThickness, 0.736, 1, 0.006),
    materials.oak,
    [0, TABLETOP_THICKNESS_METRES / 2 - veneerThickness / 2, 0],
    boxCollider([1.806, veneerThickness, 0.736]),
    options,
  );
  const edges = edgeSpecs.map((spec) => addSurfaceDetail(
    tabletop,
    registry,
    spec.id,
    new BoxGeometry(...spec.size),
    materials.oakEdge,
    spec.position,
    boxCollider(spec.size),
    options,
  ));
  return [surface, ...edges];
}

function createTabletop(
  root: Group,
  registry: RuntimeRegistry,
  materials: TrestleTableMaterials,
  options: TrestleTableProxyOptions,
): { readonly tabletop: Group; readonly details: readonly Group[] } {
  const dimensions: Vector3Tuple = [
    TABLE_WIDTH_METRES,
    TABLETOP_THICKNESS_METRES,
    TABLE_DEPTH_METRES,
  ];
  const tabletop = createMeshPart(
    root,
    registry,
    "tabletop",
    new RoundedBoxGeometry(...dimensions, 2, 0.008),
    materials.oakEdge,
    [0, TABLETOP_CENTRE_Y_METRES, 0],
    boxCollider(dimensions),
    options,
  );
  return { tabletop, details: addTabletopDetails(tabletop, registry, materials, options) };
}

function addFootCaps(
  side: TrestleSide,
  footBar: Group,
  registry: RuntimeRegistry,
  materials: TrestleTableMaterials,
  options: TrestleTableProxyOptions,
): readonly Group[] {
  const size: Vector3Tuple = [0.085, FOOT_CAP_HEIGHT_METRES, 0.09];
  return (["front", "rear"] as const).map((end) => {
    const z = end === "front" ? FOOT_CAP_OFFSET_Z_METRES : -FOOT_CAP_OFFSET_Z_METRES;
    return addSurfaceDetail(
      footBar,
      registry,
      `${side}-${end}-foot-cap-detail`,
      new RoundedBoxGeometry(...size, 1, 0.004),
      materials.rubber,
      [0, FOOT_CAP_HEIGHT_METRES / 2 - 0.05, z],
      boxCollider(size),
      options,
    );
  });
}

function addHingeHardware(
  side: TrestleSide,
  topRail: Group,
  registry: RuntimeRegistry,
  materials: TrestleTableMaterials,
  options: TrestleTableProxyOptions,
): readonly Group[] {
  const hardware: Group[] = [];
  const sideDirection = side === "left" ? -1 : 1;
  for (const end of ["front", "rear"] as const) {
    const z = end === "front" ? 0.24 : -0.24;
    const plateId = `${side}-${end}-hinge-plate-detail`;
    const plate = addSurfaceDetail(
      topRail,
      registry,
      plateId,
      new RoundedBoxGeometry(0.012, 0.1, 0.105, 1, 0.004),
      materials.hardware,
      [sideDirection * 0.041, -0.045, z],
      boxCollider([0.012, 0.1, 0.105]),
      options,
    );
    hardware.push(plate);
    for (const position of ["lower", "upper"] as const) {
      const y = position === "lower" ? -0.024 : 0.024;
      hardware.push(addSurfaceDetail(
        plate,
        registry,
        `${side}-${end}-hinge-bolt-${position}-detail`,
        new CylinderGeometry(0.007, 0.007, 0.008, 12, 1),
        materials.hardware,
        [sideDirection * 0.009, y, 0],
        cylinderCollider(0.007, 0.008),
        options,
        [0, 0, Math.PI / 2],
      ));
    }
  }
  return hardware;
}

function createTrestleRails(
  side: TrestleSide,
  x: number,
  root: Group,
  registry: RuntimeRegistry,
  material: Material,
  options: TrestleTableProxyOptions,
): TrestleRails {
  const topRail = createBoxPart(
    root,
    registry,
    `${side}-trestle-top-rail`,
    [0.07, 0.06, 0.62],
    [x, FRAME_TOP_Y_METRES - 0.03, 0],
    material,
    options,
  );
  const footBar = createBoxPart(
    root,
    registry,
    `${side}-trestle-foot-bar`,
    [0.07, 0.04, 0.67],
    [x, 0.05, 0],
    material,
    options,
  );
  return { topRail, footBar };
}

function createTrestleLegs(
  side: TrestleSide,
  x: number,
  root: Group,
  registry: RuntimeRegistry,
  material: Material,
  options: TrestleTableProxyOptions,
): readonly Group[] {
  return (["front", "rear"] as const).map((end) => {
    const direction = end === "front" ? 1 : -1;
    return createBeamPart(
      root,
      registry,
      `${side}-${end}-leg`,
      [x, 0.055, direction * 0.31],
      [x, 0.63, direction * 0.24],
      [0.045, 0.045],
      material,
      options,
    );
  });
}

function createTrestleBraces(
  side: TrestleSide,
  x: number,
  root: Group,
  registry: RuntimeRegistry,
  material: Material,
  options: TrestleTableProxyOptions,
): readonly Group[] {
  return (["front", "rear"] as const).map((end) => {
    const direction = end === "front" ? 1 : -1;
    return createBeamPart(
      root,
      registry,
      `${side}-${end}-diagonal-brace`,
      [x, 0.2, direction * 0.295],
      [x, 0.625, direction * 0.085],
      [0.014, 0.026],
      material,
      options,
    );
  });
}

function createTrestleSide(
  side: TrestleSide,
  root: Group,
  registry: RuntimeRegistry,
  materials: TrestleTableMaterials,
  options: TrestleTableProxyOptions,
): TrestleBuildResult {
  const x = side === "left" ? -TRESTLE_OFFSET_X_METRES : TRESTLE_OFFSET_X_METRES;
  const rails = createTrestleRails(side, x, root, registry, materials.steel, options);
  const legs = createTrestleLegs(side, x, root, registry, materials.steel, options);
  const braces = createTrestleBraces(side, x, root, registry, materials.hardware, options);
  return {
    structuralParts: [rails.topRail, rails.footBar, ...legs, ...braces],
    hardware: [
      ...addFootCaps(side, rails.footBar, registry, materials, options),
      ...addHingeHardware(side, rails.topRail, registry, materials, options),
    ],
  };
}

function createStretcher(
  root: Group,
  registry: RuntimeRegistry,
  materials: TrestleTableMaterials,
  options: TrestleTableProxyOptions,
): { readonly stretcher: Group; readonly hardware: readonly Group[] } {
  const stretcher = createBoxPart(
    root,
    registry,
    "centre-stretcher",
    [1.3, 0.06, 0.055],
    [0, 0.38, 0],
    materials.steel,
    options,
  );
  const hardware = (["left", "right"] as const).map((side) => {
    const x = side === "left" ? -0.64 : 0.64;
    return addSurfaceDetail(
      stretcher,
      registry,
      `${side}-stretcher-bracket-detail`,
      // 0.56 deep, not 0.11. The legs stand at z ±0.2177..0.3323 while the
      // stretcher runs down the centreline at z ±0.0275, so a 0.11-deep
      // bracket bolted the stretcher to thin air — nothing in the assembly
      // came within 18mm of it. A gusset spanning z ±0.28 reaches both the
      // front and rear leg at this height, which is how a real trestle's
      // H-frame is tied together. Stays inside the canonical 0.76 depth.
      new RoundedBoxGeometry(0.02, 0.12, 0.56, 1, 0.004),
      materials.hardware,
      [x, 0, 0],
      boxCollider([0.02, 0.12, 0.56]),
      options,
    );
  });
  return { stretcher, hardware };
}

function createSocket(
  parent: Object3D,
  name: string,
  position: Vector3Tuple,
): Object3D {
  const socket = new Object3D();
  socket.name = `${name}__socket`;
  socket.position.set(...position);
  parent.add(socket);
  return socket;
}

function createSockets(
  root: Group,
  tabletop: Group,
  registry: RuntimeRegistry,
): void {
  registry.sockets["floor-contact"] = createSocket(root, "floor-contact", [0, 0, 0]);
  registry.sockets["tabletop-centre"] = createSocket(
    tabletop,
    "tabletop-centre",
    [0, TABLETOP_THICKNESS_METRES / 2, 0],
  );
  registry.sockets["stretcher-centre"] = createSocket(root, "stretcher-centre", [0, 0.38, 0]);
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

/**
 * Build a presentation-only six-foot folding trestle table in canonical metres.
 * Hidden rear-side joints are symmetric structural approximations of the single
 * generated reference view; the proxy does not represent measured geometry.
 */
export function createTrestleTableProxy(
  options: TrestleTableProxyOptions = {},
): Group {
  const root = new Group();
  root.name = "trestle-6ft";
  root.userData.componentId = "root";
  const registry = createRuntimeRegistry(root);
  const materials = createMaterials();
  const tabletop = createTabletop(root, registry, materials, options);
  const left = createTrestleSide("left", root, registry, materials, options);
  const right = createTrestleSide("right", root, registry, materials, options);
  const stretcher = createStretcher(root, registry, materials, options);
  const hardware = [
    ...tabletop.details,
    ...left.hardware,
    ...right.hardware,
    ...stretcher.hardware,
  ];

  createSockets(root, tabletop.tabletop, registry);
  registry.destructionGroups.tabletop = [tabletop.tabletop];
  registry.destructionGroups["left-trestle"] = [...left.structuralParts];
  registry.destructionGroups["right-trestle"] = [...right.structuralParts];
  registry.destructionGroups["centre-stretcher"] = [stretcher.stretcher];
  registry.destructionGroups.frame = [
    ...left.structuralParts,
    ...right.structuralParts,
    stretcher.stretcher,
  ];
  registry.destructionGroups.hardware = hardware;

  root.userData.canonicalDimensionsMetres = [
    TABLE_WIDTH_METRES,
    TABLE_HEIGHT_METRES,
    TABLE_DEPTH_METRES,
  ];
  root.userData.evidenceSource = "artifacts/img2threejs/trestle-6ft";
  root.userData.provenance = "generated";
  root.userData.authority = "presentation-only";
  root.userData.measuredGeometry = false;
  root.userData.sculptRuntime = registry satisfies Img2ThreeSculptRuntime;
  return root;
}
