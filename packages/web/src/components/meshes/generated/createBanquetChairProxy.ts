import {
  BoxGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Path,
  Quaternion,
  Shape,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { Img2ThreeSculptRuntime } from "../../../lib/furniture-presentation-runtime.js";

const CHAIR_WIDTH_METRES = 0.45;
const CHAIR_DEPTH_METRES = 0.45;
const CHAIR_HEIGHT_METRES = 0.9;
const SEAT_HEIGHT_METRES = 0.09;
const SEAT_CENTRE_Y_METRES = 0.48;
const BACK_LOOP_DEPTH_METRES = 0.032;
const BACK_LOOP_BASE_Y_METRES = 0.44;
const FRAME_MEMBER_THICKNESS_METRES = 0.03;
const FOOT_CAP_SIZE_METRES = 0.045;
const FOOT_CAP_HEIGHT_METRES = 0.035;
const FOOT_CAP_CENTRE_OFFSET_METRES = 0.2025;
const EXPLODE_WITH_PARENT = true;

type Vector3Tuple = readonly [number, number, number];

export interface BanquetChairProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface ChairMaterials {
  readonly brass: MeshPhysicalMaterial;
  readonly upholstery: MeshStandardMaterial;
  readonly upholsteryDetail: MeshStandardMaterial;
  readonly rubber: MeshStandardMaterial;
  readonly rubberDetail: MeshStandardMaterial;
}

interface ModelRecords {
  readonly nodes: Record<string, Object3D>;
  readonly meshes: Record<string, Mesh>;
  readonly colliders: Record<string, unknown>;
}

interface BoxColliderDescriptor {
  readonly shape: "box";
  readonly size: Vector3Tuple;
}

function requireRegisteredMesh(records: ModelRecords, id: string): Mesh {
  const mesh = records.meshes[id];
  if (mesh === undefined) throw new Error(`chair part ${id} is missing its registered mesh`);
  return mesh;
}

function boxCollider(size: Vector3Tuple): BoxColliderDescriptor {
  return { shape: "box", size };
}

function createMaterials(): ChairMaterials {
  return {
    brass: new MeshPhysicalMaterial({
      color: 0xbe8e38,
      metalness: 0.9,
      roughness: 0.38,
      clearcoat: 0.12,
      clearcoatRoughness: 0.28,
    }),
    upholstery: new MeshStandardMaterial({
      color: 0x6f182b,
      metalness: 0,
      roughness: 0.82,
      flatShading: true,
    }),
    upholsteryDetail: new MeshStandardMaterial({
      color: 0x581322,
      metalness: 0,
      roughness: 0.9,
      flatShading: true,
    }),
    rubber: new MeshStandardMaterial({
      color: 0x1b1b1a,
      metalness: 0,
      roughness: 0.72,
      flatShading: true,
    }),
    rubberDetail: new MeshStandardMaterial({
      color: 0x302d2a,
      metalness: 0,
      roughness: 0.82,
      flatShading: true,
    }),
  };
}

function configureMesh(
  mesh: Mesh,
  id: string,
  options: BanquetChairProxyOptions,
): void {
  mesh.name = `${id}__mesh`;
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  mesh.userData.componentId = id;
}

function registerPart(
  records: ModelRecords,
  id: string,
  pivot: Group,
  mesh: Mesh,
  collider?: BoxColliderDescriptor,
): void {
  records.nodes[id] = pivot;
  records.meshes[id] = mesh;
  if (collider !== undefined) records.colliders[id] = collider;
}

function createMeshPart(
  parent: Object3D,
  records: ModelRecords,
  id: string,
  geometry: BufferGeometry,
  material: Material,
  position: Vector3Tuple,
  options: BanquetChairProxyOptions,
  collider?: BoxColliderDescriptor,
): Group {
  const pivot = new Group();
  pivot.name = `${id}__pivot`;
  pivot.position.set(...position);
  pivot.userData.componentId = id;
  const mesh = new Mesh(geometry, material);
  configureMesh(mesh, id, options);
  pivot.add(mesh);
  parent.add(pivot);
  registerPart(records, id, pivot, mesh, collider);
  return pivot;
}

function addSurfaceDetail(
  parent: Group,
  records: ModelRecords,
  id: string,
  geometry: BufferGeometry,
  material: Material,
  position: Vector3Tuple,
  options: BanquetChairProxyOptions,
  collider: BoxColliderDescriptor,
): Group {
  const detail = createMeshPart(
    parent,
    records,
    id,
    geometry,
    material,
    position,
    options,
    collider,
  );
  detail.userData.surfaceDetail = true;
  detail.userData.explodeWithParent = EXPLODE_WITH_PARENT;
  const detailMesh = requireRegisteredMesh(records, id);
  detailMesh.userData.surfaceDetail = true;
  detailMesh.userData.explodeWithParent = EXPLODE_WITH_PARENT;
  return detail;
}

function createCushions(
  root: Group,
  records: ModelRecords,
  materials: ChairMaterials,
  options: BanquetChairProxyOptions,
): readonly [Group, Group] {
  const seat = createMeshPart(
    root,
    records,
    "seat-pad",
    new RoundedBoxGeometry(CHAIR_WIDTH_METRES, SEAT_HEIGHT_METRES, CHAIR_DEPTH_METRES, 1, 0.018),
    materials.upholstery,
    [0, SEAT_CENTRE_Y_METRES, 0],
    options,
    boxCollider([CHAIR_WIDTH_METRES, SEAT_HEIGHT_METRES, CHAIR_DEPTH_METRES]),
  );
  addSurfaceDetail(
    seat,
    records,
    "seat-panel-detail",
    new RoundedBoxGeometry(0.392, 0.006, 0.392, 1, 0.014),
    materials.upholsteryDetail,
    [0, 0.047, 0],
    options,
    boxCollider([0.392, 0.006, 0.392]),
  );

  const backrest = createMeshPart(
    root,
    records,
    "backrest-pad",
    new RoundedBoxGeometry(0.36, 0.23, 0.07, 1, 0.02),
    materials.upholstery,
    [0, 0.72, -0.175],
    options,
    boxCollider([0.36, 0.23, 0.07]),
  );
  backrest.rotation.x = -0.04;
  addSurfaceDetail(
    backrest,
    records,
    "backrest-panel-detail",
    new RoundedBoxGeometry(0.31, 0.18, 0.006, 1, 0.014),
    materials.upholsteryDetail,
    [0, 0, 0.038],
    options,
    boxCollider([0.31, 0.18, 0.006]),
  );
  return [seat, backrest];
}

function createBackLoopGeometry(): ExtrudeGeometry {
  const loop = new Shape();
  loop.moveTo(-0.215, 0);
  loop.lineTo(-0.205, 0.33);
  loop.lineTo(-0.16, CHAIR_HEIGHT_METRES - BACK_LOOP_BASE_Y_METRES);
  loop.lineTo(0.16, CHAIR_HEIGHT_METRES - BACK_LOOP_BASE_Y_METRES);
  loop.lineTo(0.205, 0.33);
  loop.lineTo(0.215, 0);
  loop.closePath();

  const opening = new Path();
  opening.moveTo(-0.175, 0.035);
  opening.lineTo(0.175, 0.035);
  opening.lineTo(0.165, 0.305);
  opening.lineTo(0.132, 0.412);
  opening.lineTo(-0.132, 0.412);
  opening.lineTo(-0.165, 0.305);
  opening.closePath();
  loop.holes.push(opening);

  const geometry = new ExtrudeGeometry(loop, {
    depth: BACK_LOOP_DEPTH_METRES,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -BACK_LOOP_DEPTH_METRES / 2);
  return geometry;
}

function createBackFrame(
  root: Group,
  records: ModelRecords,
  materials: ChairMaterials,
  options: BanquetChairProxyOptions,
): Group {
  return createMeshPart(
    root,
    records,
    "back-frame-loop",
    createBackLoopGeometry(),
    materials.brass,
    [0, BACK_LOOP_BASE_Y_METRES, -0.209],
    options,
    boxCollider([0.43, 0.46, BACK_LOOP_DEPTH_METRES]),
  );
}

function createBeamPart(
  root: Group,
  records: ModelRecords,
  id: string,
  start: Vector3Tuple,
  end: Vector3Tuple,
  thickness: number,
  material: Material,
  options: BanquetChairProxyOptions,
): Group {
  const startPoint = new Vector3(...start);
  const direction = new Vector3(...end).sub(startPoint);
  const length = direction.length();
  const pivot = createMeshPart(
    root,
    records,
    id,
    new BoxGeometry(thickness, length, thickness),
    material,
    start,
    options,
    boxCollider([thickness, length, thickness]),
  );
  const mesh = requireRegisteredMesh(records, id);
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    direction.normalize(),
  ));
  mesh.position.copy(direction.setLength(length / 2));
  return pivot;
}

function createLegs(
  root: Group,
  records: ModelRecords,
  materials: ChairMaterials,
  options: BanquetChairProxyOptions,
): readonly Group[] {
  const bottomY = 0.018;
  const topY = 0.445;
  return [
    createBeamPart(root, records, "front-left-leg", [-0.2025, bottomY, 0.2025], [-0.1875, topY, 0.1875], FRAME_MEMBER_THICKNESS_METRES, materials.brass, options),
    createBeamPart(root, records, "front-right-leg", [0.2025, bottomY, 0.2025], [0.1875, topY, 0.1875], FRAME_MEMBER_THICKNESS_METRES, materials.brass, options),
    createBeamPart(root, records, "rear-left-leg", [-0.2025, bottomY, -0.2025], [-0.1875, topY, -0.1875], FRAME_MEMBER_THICKNESS_METRES, materials.brass, options),
    createBeamPart(root, records, "rear-right-leg", [0.2025, bottomY, -0.2025], [0.1875, topY, -0.1875], FRAME_MEMBER_THICKNESS_METRES, materials.brass, options),
  ];
}

function createFrameBoxPart(
  root: Group,
  records: ModelRecords,
  id: string,
  size: Vector3Tuple,
  position: Vector3Tuple,
  material: Material,
  options: BanquetChairProxyOptions,
): Group {
  return createMeshPart(
    root,
    records,
    id,
    new BoxGeometry(...size),
    material,
    position,
    options,
    boxCollider(size),
  );
}

function createRailsAndBraces(
  root: Group,
  records: ModelRecords,
  materials: ChairMaterials,
  options: BanquetChairProxyOptions,
): readonly Group[] {
  const railThickness = 0.03;
  return [
    createFrameBoxPart(root, records, "underseat-front-rail", [0.405, railThickness, railThickness], [0, 0.43, 0.1875], materials.brass, options),
    createFrameBoxPart(root, records, "underseat-rear-rail", [0.405, railThickness, railThickness], [0, 0.43, -0.1875], materials.brass, options),
    createFrameBoxPart(root, records, "underseat-left-rail", [railThickness, railThickness, 0.405], [-0.1875, 0.43, 0], materials.brass, options),
    createFrameBoxPart(root, records, "underseat-right-rail", [railThickness, railThickness, 0.405], [0.1875, 0.43, 0], materials.brass, options),
    createFrameBoxPart(root, records, "left-lateral-brace", [0.025, 0.025, 0.345], [-0.197, 0.245, 0], materials.brass, options),
    createFrameBoxPart(root, records, "right-lateral-brace", [0.025, 0.025, 0.345], [0.197, 0.245, 0], materials.brass, options),
  ];
}

function createFootCap(
  root: Group,
  records: ModelRecords,
  id: string,
  position: Vector3Tuple,
  materials: ChairMaterials,
  options: BanquetChairProxyOptions,
): Group {
  const cap = createMeshPart(
    root,
    records,
    id,
    new RoundedBoxGeometry(FOOT_CAP_SIZE_METRES, FOOT_CAP_HEIGHT_METRES, FOOT_CAP_SIZE_METRES, 1, 0.003),
    materials.rubber,
    position,
    options,
    boxCollider([FOOT_CAP_SIZE_METRES, FOOT_CAP_HEIGHT_METRES, FOOT_CAP_SIZE_METRES]),
  );
  addSurfaceDetail(
    cap,
    records,
    `${id}-sleeve-seam`,
    new BoxGeometry(0.044, 0.003, 0.044),
    materials.rubberDetail,
    [0, 0.012, 0],
    options,
    boxCollider([0.044, 0.003, 0.044]),
  );
  return cap;
}

function createFootCaps(
  root: Group,
  records: ModelRecords,
  materials: ChairMaterials,
  options: BanquetChairProxyOptions,
): readonly Group[] {
  const y = FOOT_CAP_HEIGHT_METRES / 2;
  const offset = FOOT_CAP_CENTRE_OFFSET_METRES;
  return [
    createFootCap(root, records, "front-left-foot-cap", [-offset, y, offset], materials, options),
    createFootCap(root, records, "front-right-foot-cap", [offset, y, offset], materials, options),
    createFootCap(root, records, "rear-left-foot-cap", [-offset, y, -offset], materials, options),
    createFootCap(root, records, "rear-right-foot-cap", [offset, y, -offset], materials, options),
  ];
}

function createSocket(parent: Group, name: string, position: Vector3Tuple): Object3D {
  const socket = new Object3D();
  socket.name = name;
  socket.position.set(...position);
  parent.add(socket);
  return socket;
}

function createSockets(
  root: Group,
  backFrame: Group,
): Readonly<Record<string, Object3D>> {
  return {
    "floor-contact": createSocket(root, "floor-contact__socket", [0, 0, 0]),
    "seat-contact": createSocket(root, "seat-contact__socket", [0, 0.445, 0]),
    "back-loop-contact": createSocket(root, "back-loop-contact__socket", [0, 0.48, -0.19]),
    "front-leg-contact": createSocket(root, "front-leg-contact__socket", [0, 0.43, 0.17]),
    "rear-leg-contact": createSocket(root, "rear-leg-contact__socket", [0, 0.43, -0.17]),
    "brace-contact": createSocket(root, "brace-contact__socket", [0, 0.24, 0]),
    "backrest-mount": createSocket(
      backFrame,
      "backrest-mount__socket",
      // The runtime loop pivot is authored at its 0.44m base, whereas the
      // sculpt spec records the loop around its visual centre. Preserve the
      // specified world-space mount at [0, 0.735, -0.172] in this pivot frame.
      [0, 0.295, 0.037],
    ),
  };
}

function publishRuntime(
  root: Group,
  records: ModelRecords,
  sockets: Readonly<Record<string, Object3D>>,
  cushions: readonly [Group, Group],
  backFrame: Group,
  legs: readonly Group[],
  railsAndBraces: readonly Group[],
  footCaps: readonly Group[],
): void {
  const runtime: Img2ThreeSculptRuntime = {
    nodes: records.nodes,
    meshes: records.meshes,
    sockets,
    colliders: records.colliders,
    destructionGroups: {
      "seat-assembly": [cushions[0]],
      "backrest-assembly": [cushions[1]],
      "brass-frame": [backFrame, ...legs, ...railsAndBraces],
      "front-leg-pair": legs.slice(0, 2),
      "rear-leg-pair": legs.slice(2, 4),
      "lateral-brace-pair": railsAndBraces.slice(4, 6),
      "underseat-frame": railsAndBraces,
      "foot-cap-system": footCaps,
    },
  };
  root.userData.sculptRuntime = runtime;
}

/**
 * Builds the evidence-derived, stylized low-poly banquet-chair proxy in metres.
 * Hidden joints remain symmetric structural approximations because the source
 * bundle contains only one useful view.
 */
export function createBanquetChairProxy(
  options: BanquetChairProxyOptions = {},
): Group {
  const root = new Group();
  root.name = "banquet-chair-proxy";
  root.userData.componentId = "root";

  const records: ModelRecords = {
    nodes: { root },
    meshes: {},
    colliders: {
      root: boxCollider([CHAIR_WIDTH_METRES, CHAIR_HEIGHT_METRES, CHAIR_DEPTH_METRES]),
    },
  };
  const materials = createMaterials();
  const cushions = createCushions(root, records, materials, options);
  const backFrame = createBackFrame(root, records, materials, options);
  const legs = createLegs(root, records, materials, options);
  const railsAndBraces = createRailsAndBraces(root, records, materials, options);
  const footCaps = createFootCaps(root, records, materials, options);
  const sockets = createSockets(root, backFrame);

  publishRuntime(
    root,
    records,
    sockets,
    cushions,
    backFrame,
    legs,
    railsAndBraces,
    footCaps,
  );
  root.userData.canonicalDimensionsMetres = [
    CHAIR_WIDTH_METRES,
    CHAIR_HEIGHT_METRES,
    CHAIR_DEPTH_METRES,
  ];
  root.userData.evidenceSource =
    "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#banquet-chair";
  root.userData.evidenceImage =
    "packages/web/src/assets/generated-furniture/banquet-chair-imagegen-v1.png";
  root.userData.provenance = "generated";
  root.userData.authority = "presentation-only";
  root.userData.measuredGeometry = false;
  return root;
}
