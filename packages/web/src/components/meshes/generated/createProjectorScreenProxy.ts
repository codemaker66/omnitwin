import {
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { Img2ThreeSculptRuntime } from "../../../lib/furniture-presentation-runtime.js";

const SCREEN_WIDTH_METRES = 2.5;
const SCREEN_HEIGHT_METRES = 1.8;
const SCREEN_DEPTH_METRES = 0.6;
const FRAME_SECTION_METRES = 0.055;
const FRAME_DEPTH_METRES = 0.05;
const FRAME_HALF_X_METRES = SCREEN_WIDTH_METRES / 2 - FRAME_SECTION_METRES / 2;
const TOP_RAIL_Y_METRES = SCREEN_HEIGHT_METRES - FRAME_SECTION_METRES / 2;
const BOTTOM_RAIL_Y_METRES = 0.52;
const SCREEN_SURFACE_BOTTOM_METRES = BOTTOM_RAIL_Y_METRES + FRAME_SECTION_METRES / 2;
const SCREEN_SURFACE_TOP_METRES = SCREEN_HEIGHT_METRES - FRAME_SECTION_METRES;
const SCREEN_SURFACE_HEIGHT_METRES =
  SCREEN_SURFACE_TOP_METRES - SCREEN_SURFACE_BOTTOM_METRES;
const SIDE_RAIL_BOTTOM_METRES = BOTTOM_RAIL_Y_METRES - FRAME_SECTION_METRES / 2;
const SIDE_RAIL_HEIGHT_METRES = SCREEN_HEIGHT_METRES - SIDE_RAIL_BOTTOM_METRES;
const BASE_RAIL_Y_METRES = 0.04;
const BASE_RAIL_HEIGHT_METRES = 0.05;
const LOWER_POST_BOTTOM_METRES = BASE_RAIL_Y_METRES + BASE_RAIL_HEIGHT_METRES / 2;
const LOWER_POST_TOP_METRES = BOTTOM_RAIL_Y_METRES + FRAME_SECTION_METRES / 2;
const LOWER_POST_HEIGHT_METRES = LOWER_POST_TOP_METRES - LOWER_POST_BOTTOM_METRES;
const FABRIC_TEXTURE_SIZE = 64;
const EXPLODE_WITH_PARENT = true;

type Vector3Tuple = readonly [number, number, number];
type SupportSide = "left" | "right";
type DepthEnd = "front" | "rear";

export interface ProjectorScreenProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface ProjectorScreenMaterials {
  readonly fabric: MeshStandardMaterial;
  readonly frame: MeshStandardMaterial;
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

interface FrameParts {
  readonly screen: Group;
  readonly rails: readonly Group[];
  readonly hardware: readonly Group[];
}

interface SupportParts {
  readonly structural: readonly Group[];
  readonly hardware: readonly Group[];
}

function boxCollider(size: Vector3Tuple): BoxColliderDescriptor {
  return { shape: "box", size };
}

function cylinderCollider(radius: number, height: number): CylinderColliderDescriptor {
  return { shape: "cylinder", radius, height };
}

function createFabricTexture(): DataTexture {
  const pixels = new Uint8Array(FABRIC_TEXTURE_SIZE * FABRIC_TEXTURE_SIZE * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 242;
    pixels[index + 1] = 242;
    pixels[index + 2] = 240;
    pixels[index + 3] = 255;
  }
  const texture = new DataTexture(pixels, FABRIC_TEXTURE_SIZE, FABRIC_TEXTURE_SIZE);
  texture.name = "projector-screen-matte-fabric-weave";
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createMaterials(): ProjectorScreenMaterials {
  return {
    fabric: new MeshStandardMaterial({
      map: createFabricTexture(),
      metalness: 0,
      roughness: 0.82,
      side: DoubleSide,
    }),
    frame: new MeshStandardMaterial({ color: 0x1c1d1d, metalness: 0.68, roughness: 0.42 }),
    hardware: new MeshStandardMaterial({ color: 0x343737, metalness: 0.82, roughness: 0.28 }),
    rubber: new MeshStandardMaterial({ color: 0x121313, metalness: 0, roughness: 0.86 }),
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
  options: ProjectorScreenProxyOptions,
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
  options: ProjectorScreenProxyOptions,
): Group {
  const pivot = namedPivot(id);
  pivot.position.set(...position);
  const mesh = configureMesh(new Mesh(geometry, material), id, options);
  pivot.add(mesh);
  parent.add(pivot);
  registerPart(registry, id, pivot, mesh, collider);
  return pivot;
}

function createRoundedBoxPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  size: Vector3Tuple,
  position: Vector3Tuple,
  material: Material,
  options: ProjectorScreenProxyOptions,
  radius = 0.004,
): Group {
  return createMeshPart(
    parent,
    registry,
    id,
    new RoundedBoxGeometry(...size, 1, radius),
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

function addDetail(
  parent: Group,
  registry: RuntimeRegistry,
  id: string,
  geometry: BufferGeometry,
  material: Material,
  position: Vector3Tuple,
  collider: ColliderDescriptor,
  options: ProjectorScreenProxyOptions,
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
  if (mesh === undefined) throw new Error(`projector-screen detail ${id} is missing its mesh`);
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
  options: ProjectorScreenProxyOptions,
): Group {
  const startPoint = new Vector3(...start);
  const direction = new Vector3(...end).sub(startPoint);
  const length = direction.length();
  const midpoint = startPoint.clone().addScaledVector(direction, 0.5);
  const part = createMeshPart(
    root,
    registry,
    id,
    new RoundedBoxGeometry(crossSection[0], length, crossSection[1], 1, 0.003),
    material,
    [midpoint.x, midpoint.y, midpoint.z],
    boxCollider([crossSection[0], length, crossSection[1]]),
    options,
  );
  const mesh = registry.meshes[id];
  if (mesh === undefined) throw new Error(`projector-screen beam ${id} is missing its mesh`);
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    direction.normalize(),
  ));
  return part;
}

function addJointCap(
  parent: Group,
  registry: RuntimeRegistry,
  id: string,
  position: Vector3Tuple,
  materials: ProjectorScreenMaterials,
  options: ProjectorScreenProxyOptions,
): readonly Group[] {
  const plateSize: Vector3Tuple = [0.055, 0.055, 0.012];
  const cap = addDetail(
    parent,
    registry,
    id,
    new RoundedBoxGeometry(...plateSize, 1, 0.006),
    materials.hardware,
    position,
    boxCollider(plateSize),
    options,
  );
  const fastenerId = id.endsWith("-cap")
    ? id.replace(/-cap$/, "-fastener")
    : `${id}-fastener`;
  const fastener = addDetail(
    cap,
    registry,
    fastenerId,
    new CylinderGeometry(0.011, 0.011, 0.008, 16, 1),
    materials.hardware,
    [0, 0, 0.01],
    cylinderCollider(0.011, 0.008),
    options,
    [Math.PI / 2, 0, 0],
  );
  return [cap, fastener];
}

function createFrame(
  root: Group,
  registry: RuntimeRegistry,
  materials: ProjectorScreenMaterials,
  options: ProjectorScreenProxyOptions,
): FrameParts {
  const top = createRoundedBoxPart(
    root,
    registry,
    "top-frame-rail",
    [SCREEN_WIDTH_METRES, FRAME_SECTION_METRES, FRAME_DEPTH_METRES],
    [0, TOP_RAIL_Y_METRES, 0],
    materials.frame,
    options,
  );
  const bottom = createRoundedBoxPart(
    root,
    registry,
    "bottom-frame-rail",
    [SCREEN_WIDTH_METRES, FRAME_SECTION_METRES, FRAME_DEPTH_METRES],
    [0, BOTTOM_RAIL_Y_METRES, 0],
    materials.frame,
    options,
  );
  const sideY = SIDE_RAIL_BOTTOM_METRES + SIDE_RAIL_HEIGHT_METRES / 2;
  const left = createRoundedBoxPart(root, registry, "left-frame-rail", [
    FRAME_SECTION_METRES,
    SIDE_RAIL_HEIGHT_METRES,
    FRAME_DEPTH_METRES,
  ], [-FRAME_HALF_X_METRES, sideY, 0], materials.frame, options);
  const right = createRoundedBoxPart(root, registry, "right-frame-rail", [
    FRAME_SECTION_METRES,
    SIDE_RAIL_HEIGHT_METRES,
    FRAME_DEPTH_METRES,
  ], [FRAME_HALF_X_METRES, sideY, 0], materials.frame, options);
  const screen = createRoundedBoxPart(root, registry, "screen-surface", [
    SCREEN_WIDTH_METRES - FRAME_SECTION_METRES * 2,
    SCREEN_SURFACE_HEIGHT_METRES,
    0.008,
  ], [
    0,
    SCREEN_SURFACE_BOTTOM_METRES + SCREEN_SURFACE_HEIGHT_METRES / 2,
    0.02,
  ], materials.fabric, options, 0.002);
  const hardware = [
    ...addJointCap(top, registry, "upper-left-corner-cap", [
      -FRAME_HALF_X_METRES,
      0,
      0.031,
    ], materials, options),
    ...addJointCap(top, registry, "upper-right-corner-cap", [
      FRAME_HALF_X_METRES,
      0,
      0.031,
    ], materials, options),
    ...addJointCap(bottom, registry, "left-mid-joint-plate", [
      -FRAME_HALF_X_METRES,
      0,
      0.031,
    ], materials, options),
    ...addJointCap(bottom, registry, "right-mid-joint-plate", [
      FRAME_HALF_X_METRES,
      0,
      0.031,
    ], materials, options),
  ];
  return { screen, rails: [top, bottom, left, right], hardware };
}

function addBaseCollar(
  side: SupportSide,
  post: Group,
  registry: RuntimeRegistry,
  materials: ProjectorScreenMaterials,
  options: ProjectorScreenProxyOptions,
): Group {
  const worldY = 0.105;
  const postCentreY = LOWER_POST_BOTTOM_METRES + LOWER_POST_HEIGHT_METRES / 2;
  const size: Vector3Tuple = [FRAME_SECTION_METRES, 0.08, 0.075];
  return addDetail(
    post,
    registry,
    `${side}-base-collar`,
    new RoundedBoxGeometry(...size, 1, 0.005),
    materials.hardware,
    [0, worldY - postCentreY, 0],
    boxCollider(size),
    options,
  );
}

function addFeet(
  side: SupportSide,
  base: Group,
  registry: RuntimeRegistry,
  materials: ProjectorScreenMaterials,
  options: ProjectorScreenProxyOptions,
): readonly Group[] {
  return (["front", "rear"] as const).map((end) => {
    const direction = end === "front" ? 1 : -1;
    return addDetail(
      base,
      registry,
      `${side}-${end}-foot`,
      new CylinderGeometry(0.024, 0.024, 0.015, 16, 1),
      materials.rubber,
      [0, 0.0075 - BASE_RAIL_Y_METRES, direction * 0.27],
      cylinderCollider(0.024, 0.015),
      options,
    );
  });
}

function addBaseEndCaps(
  side: SupportSide,
  base: Group,
  registry: RuntimeRegistry,
  materials: ProjectorScreenMaterials,
  options: ProjectorScreenProxyOptions,
): readonly Group[] {
  const size: Vector3Tuple = [FRAME_SECTION_METRES, 0.052, 0.04];
  return (["front", "rear"] as const).map((end) => {
    const direction = end === "front" ? 1 : -1;
    return addDetail(
      base,
      registry,
      `${side}-${end}-base-end-cap`,
      new RoundedBoxGeometry(...size, 1, 0.004),
      materials.rubber,
      [0, 0, direction * 0.28],
      boxCollider(size),
      options,
    );
  });
}

function createBrace(
  side: SupportSide,
  end: DepthEnd,
  x: number,
  root: Group,
  registry: RuntimeRegistry,
  materials: ProjectorScreenMaterials,
  options: ProjectorScreenProxyOptions,
): Group {
  const direction = end === "front" ? 1 : -1;
  return createBeamPart(
    root,
    registry,
    `${side}-${end}-brace`,
    [x, 0.065, direction * 0.2],
    [x, 0.405, direction * 0.012],
    [0.026, 0.018],
    materials.frame,
    options,
  );
}

function createSupport(
  side: SupportSide,
  root: Group,
  registry: RuntimeRegistry,
  materials: ProjectorScreenMaterials,
  options: ProjectorScreenProxyOptions,
): SupportParts {
  const x = side === "left" ? -FRAME_HALF_X_METRES : FRAME_HALF_X_METRES;
  const post = createRoundedBoxPart(root, registry, `${side}-lower-post`, [
    FRAME_SECTION_METRES,
    LOWER_POST_HEIGHT_METRES,
    FRAME_DEPTH_METRES,
  ], [x, LOWER_POST_BOTTOM_METRES + LOWER_POST_HEIGHT_METRES / 2, 0], materials.frame, options);
  const base = createRoundedBoxPart(root, registry, `${side}-base-rail`, [
    FRAME_SECTION_METRES,
    BASE_RAIL_HEIGHT_METRES,
    SCREEN_DEPTH_METRES,
  ], [x, BASE_RAIL_Y_METRES, 0], materials.frame, options);
  const frontBrace = createBrace(side, "front", x, root, registry, materials, options);
  const rearBrace = createBrace(side, "rear", x, root, registry, materials, options);
  return {
    structural: [post, base, frontBrace, rearBrace],
    hardware: [
      addBaseCollar(side, post, registry, materials, options),
      ...addFeet(side, base, registry, materials, options),
      ...addBaseEndCaps(side, base, registry, materials, options),
    ],
  };
}

function createSocket(parent: Object3D, name: string, position: Vector3Tuple): Object3D {
  const socket = new Object3D();
  socket.name = `${name}__socket`;
  socket.position.set(...position);
  parent.add(socket);
  return socket;
}

function createSockets(root: Group, registry: RuntimeRegistry): void {
  registry.sockets["floor-contact"] = createSocket(root, "floor-contact", [0, 0, 0]);
  registry.sockets["screen-centre"] = createSocket(root, "screen-centre", [0, 1.15, 0]);
  registry.sockets["projection-front"] = createSocket(root, "projection-front", [0, 1.15, 0.026]);
  registry.sockets["top-centre"] = createSocket(root, "top-centre", [0, SCREEN_HEIGHT_METRES, 0]);
  registry.sockets["left-support"] = createSocket(root, "left-support", [-FRAME_HALF_X_METRES, 0.065, 0]);
  registry.sockets["right-support"] = createSocket(root, "right-support", [FRAME_HALF_X_METRES, 0.065, 0]);
}

function createRuntimeRegistry(root: Group): RuntimeRegistry {
  return {
    nodes: { root },
    meshes: {},
    sockets: {},
    colliders: { root: boxCollider([SCREEN_WIDTH_METRES, SCREEN_HEIGHT_METRES, SCREEN_DEPTH_METRES]) },
    destructionGroups: {},
  };
}

function assignDestructionGroups(
  registry: RuntimeRegistry,
  frame: FrameParts,
  left: SupportParts,
  right: SupportParts,
): void {
  const hardware = [...frame.hardware, ...left.hardware, ...right.hardware];
  registry.destructionGroups.screen = [frame.screen];
  registry.destructionGroups.frame = [...frame.rails];
  registry.destructionGroups["left-support"] = [...left.structural];
  registry.destructionGroups["right-support"] = [...right.structural];
  registry.destructionGroups.supports = [...left.structural, ...right.structural];
  registry.destructionGroups.hardware = hardware;
}

/**
 * Build an approximate presentation-only freestanding projector screen in canonical metres.
 * The single ImageGen reference does not establish rear tensioning, fabrication, stability,
 * optical gain, or physics behavior; hidden construction is mirrored for visual continuity.
 */
export function createProjectorScreenProxy(
  options: ProjectorScreenProxyOptions = {},
): Group {
  const root = new Group();
  root.name = "projector-screen";
  root.userData.componentId = "root";
  const registry = createRuntimeRegistry(root);
  const materials = createMaterials();
  const frame = createFrame(root, registry, materials, options);
  const left = createSupport("left", root, registry, materials, options);
  const right = createSupport("right", root, registry, materials, options);
  createSockets(root, registry);
  assignDestructionGroups(registry, frame, left, right);

  root.userData.canonicalDimensionsMetres = [
    SCREEN_WIDTH_METRES,
    SCREEN_HEIGHT_METRES,
    SCREEN_DEPTH_METRES,
  ];
  root.userData.evidenceSource =
    "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#projector-screen";
  root.userData.evidenceImage =
    "packages/web/src/assets/generated-furniture/projector-screen-imagegen-v1.png";
  root.userData.provenance = "generated";
  root.userData.authority = "presentation-only";
  root.userData.measuredGeometry = false;
  root.userData.colliderAuthority = "metadata-only";
  root.userData.sculptRuntime = registry satisfies Img2ThreeSculptRuntime;
  return root;
}
