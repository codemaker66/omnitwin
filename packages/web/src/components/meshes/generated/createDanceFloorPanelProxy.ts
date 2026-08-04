import {
  BoxGeometry,
  CylinderGeometry,
  DataTexture,
  FrontSide,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { Img2ThreeSculptRuntime } from "../../../lib/furniture-presentation-runtime.js";

// ---------------------------------------------------------------------------
// createDanceFloorPanelProxy — 3ft parquet dance floor panel
//
// The UK hire unit is a 3ft (0.91m) square panel that locks to its neighbours,
// so this models ONE panel; a floor is several placed in a grid. The identity
// of the object is the basket-weave parquet field, so the fingers are modelled
// individually rather than faked with a texture — at explode they ride the
// deck, and a click on any finger resolves to the deck.
// ---------------------------------------------------------------------------

type Vector3Tuple = readonly [number, number, number];

const PANEL_WIDTH_METRES = 0.91;
const PANEL_DEPTH_METRES = 0.91;
const PANEL_HEIGHT_METRES = 0.05;

// Vertical stack, floor at y=0. The subframe establishes min.y, the deck
// establishes the X/Z envelope, the parquet fingers establish max.y.
const SUBFRAME_HEIGHT = 0.03;
const SUBFRAME_CENTRE_Y = SUBFRAME_HEIGHT / 2;
const SUBFRAME_INSET = 0.024;
const SUBFRAME_SIZE: Vector3Tuple = [
  PANEL_WIDTH_METRES - SUBFRAME_INSET,
  SUBFRAME_HEIGHT,
  PANEL_DEPTH_METRES - SUBFRAME_INSET,
];

const DECK_THICKNESS = 0.018;
const DECK_BOTTOM_Y = SUBFRAME_HEIGHT;
const DECK_TOP_Y = DECK_BOTTOM_Y + DECK_THICKNESS;
const DECK_CENTRE_Y = DECK_BOTTOM_Y + DECK_THICKNESS / 2;
const DECK_SIZE: Vector3Tuple = [PANEL_WIDTH_METRES, DECK_THICKNESS, PANEL_DEPTH_METRES];
const DECK_EDGE_RADIUS = 0.004;

// Parquet field: a 3x3 grid of cells, each cell three fingers laid at 90 degrees
// to its neighbours — the classic basket weave. The field is inset so the deck
// substrate reads as a thin border, which is what the metal edge trim looks
// like on a real panel.
const PARQUET_THICKNESS = PANEL_HEIGHT_METRES - DECK_TOP_Y;
const PARQUET_CENTRE_Y = DECK_TOP_Y + PARQUET_THICKNESS / 2;
const PARQUET_FIELD_SIZE = 0.87;
const PARQUET_CELLS_PER_AXIS = 3;
const PARQUET_FINGERS_PER_CELL = 3;
const PARQUET_CELL_SIZE = PARQUET_FIELD_SIZE / PARQUET_CELLS_PER_AXIS;
const PARQUET_JOINT = 0.0015;
const PARQUET_FINGER_LENGTH = PARQUET_CELL_SIZE - PARQUET_JOINT;
const PARQUET_FINGER_PITCH = PARQUET_CELL_SIZE / PARQUET_FINGERS_PER_CELL;
const PARQUET_FINGER_WIDTH = PARQUET_FINGER_PITCH - PARQUET_JOINT;

// Locking cams, one per corner, recessed into the subframe underside.
const LOCK_RADIUS = 0.021;
const LOCK_HEIGHT = 0.016;
const LOCK_CENTRE_Y = LOCK_HEIGHT / 2;
const LOCK_INSET = 0.085;
const LOCK_X = PANEL_WIDTH_METRES / 2 - LOCK_INSET;
const LOCK_Z = PANEL_DEPTH_METRES / 2 - LOCK_INSET;
const LOCK_CAM_RADIUS = 0.0085;
const LOCK_CAM_HEIGHT = 0.02;

// Subframe ribs, visible only from beneath but modelled so the exploded view
// shows a real tray rather than a solid slab.
const RIB_COUNT = 4;
const RIB_SIZE: Vector3Tuple = [SUBFRAME_SIZE[0] - 0.05, 0.012, 0.022];
const RIB_LOCAL_Y = RIB_SIZE[1] / 2 - SUBFRAME_HEIGHT / 2;
const RIB_SPAN = SUBFRAME_SIZE[2] - 0.12;

const OAK_TEXTURE_SIZE = 64;
const EXPLODE_WITH_PARENT = true;

export interface DanceFloorPanelProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface DanceFloorPanelMaterials {
  readonly oakLight: MeshStandardMaterial;
  readonly oakMid: MeshStandardMaterial;
  readonly oakDark: MeshStandardMaterial;
  readonly deckSubstrate: MeshStandardMaterial;
  readonly aluminium: MeshStandardMaterial;
  readonly steel: MeshStandardMaterial;
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
  readonly fingers: readonly Group[];
}

interface SubframeBuildResult {
  readonly subframe: Group;
  readonly ribs: readonly Group[];
}

interface LockBuildResult {
  readonly bodies: readonly Group[];
  readonly cams: readonly Group[];
}

function boxCollider(size: Vector3Tuple): BoxColliderDescriptor {
  return { shape: "box", size };
}

function cylinderCollider(radius: number, height: number): CylinderColliderDescriptor {
  return { shape: "cylinder", radius, height };
}

/**
 * Quarter-sawn oak grain. Deliberately anisotropic — the rays run along one
 * axis so alternating finger orientations read as a woven pattern rather than
 * one flat sheet.
 */
function createOakTexture(): DataTexture {
  const pixels = new Uint8Array(OAK_TEXTURE_SIZE * OAK_TEXTURE_SIZE * 4);
  for (let y = 0; y < OAK_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < OAK_TEXTURE_SIZE; x += 1) {
      const ray = Math.sin(x * 0.78 + Math.sin(y * 0.031) * 2.1);
      const fleck = Math.sin(x * 2.9 + y * 0.11) * 0.3;
      const band = Math.sin(x * 0.062 + y * 0.008) * 0.55;
      const variation = Math.round(ray * 7 + fleck * 4 + band * 9);
      const index = (y * OAK_TEXTURE_SIZE + x) * 4;
      pixels[index] = 168 + variation;
      pixels[index + 1] = 121 + Math.round(variation * 0.78);
      pixels[index + 2] = 74 + Math.round(variation * 0.51);
      pixels[index + 3] = 255;
    }
  }

  const texture = new DataTexture(pixels, OAK_TEXTURE_SIZE, OAK_TEXTURE_SIZE);
  texture.name = "dancefloor-panel-oak-grain";
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  // Mipmapped minification: a tiled floor puts many fingers into few pixels,
  // and NearestFilter would shimmer as the camera moves.
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createMaterials(): DanceFloorPanelMaterials {
  return {
    oakLight: new MeshStandardMaterial({
      map: createOakTexture(), metalness: 0, roughness: 0.34, side: FrontSide,
    }),
    oakMid: new MeshStandardMaterial({
      color: 0x9c6c3c, metalness: 0, roughness: 0.38, side: FrontSide,
    }),
    oakDark: new MeshStandardMaterial({
      color: 0x744a26, metalness: 0, roughness: 0.42, side: FrontSide,
    }),
    deckSubstrate: new MeshStandardMaterial({
      color: 0x4b3524, metalness: 0, roughness: 0.72, side: FrontSide,
    }),
    aluminium: new MeshStandardMaterial({
      color: 0xb8bcc2, metalness: 0.82, roughness: 0.34, side: FrontSide,
    }),
    steel: new MeshStandardMaterial({
      color: 0x5b6068, metalness: 0.74, roughness: 0.46, side: FrontSide,
    }),
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
  options: DanceFloorPanelProxyOptions,
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
  collider: ColliderDescriptor,
  options: DanceFloorPanelProxyOptions,
  followsParent = false,
): Group {
  const pivot = namedPivot(id);
  pivot.position.set(...position);
  const mesh = configureMesh(new Mesh(geometry, material), id, options);
  pivot.add(mesh);
  parent.add(pivot);
  registerPart(registry, id, pivot, mesh, collider);
  if (followsParent) markSurfaceDetail(pivot, mesh);
  return pivot;
}

function createBoxPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  size: Vector3Tuple,
  position: Vector3Tuple,
  material: Material,
  options: DanceFloorPanelProxyOptions,
  followsParent = false,
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
    followsParent,
  );
}

function createCylinderPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  radius: number,
  height: number,
  position: Vector3Tuple,
  material: Material,
  options: DanceFloorPanelProxyOptions,
  followsParent = false,
): Group {
  return createPart(
    parent,
    registry,
    id,
    new CylinderGeometry(radius, radius, height, 16),
    material,
    position,
    cylinderCollider(radius, height),
    options,
    followsParent,
  );
}

/** World metre height → the deck pivot's local Y. */
function deckLocalY(worldY: number): number {
  return worldY - DECK_CENTRE_Y;
}

/**
 * One basket-weave cell: three parallel fingers, rotated 90 degrees on
 * alternate cells so the weave reads across the panel. Fingers are surface
 * details of the deck — they ride it during explode and delegate clicks to it.
 */
function createParquetCell(
  deck: Group,
  registry: RuntimeRegistry,
  materials: DanceFloorPanelMaterials,
  options: DanceFloorPanelProxyOptions,
  cellX: number,
  cellZ: number,
): readonly Group[] {
  const half = (PARQUET_CELLS_PER_AXIS - 1) / 2;
  const centreX = (cellX - half) * PARQUET_CELL_SIZE;
  const centreZ = (cellZ - half) * PARQUET_CELL_SIZE;
  // Alternate the weave direction like a chequerboard.
  const runsAlongX = (cellX + cellZ) % 2 === 0;
  const fingers: Group[] = [];

  for (let index = 0; index < PARQUET_FINGERS_PER_CELL; index += 1) {
    const offset = (index - (PARQUET_FINGERS_PER_CELL - 1) / 2) * PARQUET_FINGER_PITCH;
    const size: Vector3Tuple = runsAlongX
      ? [PARQUET_FINGER_LENGTH, PARQUET_THICKNESS, PARQUET_FINGER_WIDTH]
      : [PARQUET_FINGER_WIDTH, PARQUET_THICKNESS, PARQUET_FINGER_LENGTH];
    const position: Vector3Tuple = runsAlongX
      ? [centreX, deckLocalY(PARQUET_CENTRE_Y), centreZ + offset]
      : [centreX + offset, deckLocalY(PARQUET_CENTRE_Y), centreZ];
    // Three tones cycling by finger index give the weave depth without a
    // per-finger texture; the light tone carries the shared grain map.
    const tone = index === 0
      ? materials.oakLight
      : index === 1 ? materials.oakMid : materials.oakDark;
    const id = `deck-parquet-finger-r${String(cellZ + 1)}c${String(cellX + 1)}-${String(index + 1)}-detail`;
    fingers.push(
      createBoxPart(deck, registry, id, size, position, tone, options, true),
    );
  }

  return fingers;
}

function createDeck(
  root: Group,
  registry: RuntimeRegistry,
  materials: DanceFloorPanelMaterials,
  options: DanceFloorPanelProxyOptions,
): DeckBuildResult {
  const deck = createPart(
    root,
    registry,
    "deck",
    new RoundedBoxGeometry(DECK_SIZE[0], DECK_SIZE[1], DECK_SIZE[2], 1, DECK_EDGE_RADIUS),
    materials.deckSubstrate,
    [0, DECK_CENTRE_Y, 0],
    boxCollider(DECK_SIZE),
    options,
  );

  const fingers: Group[] = [];
  for (let cellZ = 0; cellZ < PARQUET_CELLS_PER_AXIS; cellZ += 1) {
    for (let cellX = 0; cellX < PARQUET_CELLS_PER_AXIS; cellX += 1) {
      fingers.push(
        ...createParquetCell(deck, registry, materials, options, cellX, cellZ),
      );
    }
  }

  return { deck, fingers };
}

function createSubframe(
  root: Group,
  registry: RuntimeRegistry,
  materials: DanceFloorPanelMaterials,
  options: DanceFloorPanelProxyOptions,
): SubframeBuildResult {
  const subframe = createBoxPart(
    root,
    registry,
    "subframe",
    SUBFRAME_SIZE,
    [0, SUBFRAME_CENTRE_Y, 0],
    materials.steel,
    options,
  );

  const ribs: Group[] = [];
  for (let index = 0; index < RIB_COUNT; index += 1) {
    const t = index / (RIB_COUNT - 1);
    const z = -RIB_SPAN / 2 + t * RIB_SPAN;
    ribs.push(
      createBoxPart(
        subframe,
        registry,
        `subframe-rib-${String(index + 1)}-detail`,
        RIB_SIZE,
        [0, RIB_LOCAL_Y, z],
        materials.aluminium,
        options,
        true,
      ),
    );
  }

  return { subframe, ribs };
}

function createCornerLocks(
  root: Group,
  registry: RuntimeRegistry,
  materials: DanceFloorPanelMaterials,
  options: DanceFloorPanelProxyOptions,
): LockBuildResult {
  const corners: readonly (readonly [string, number, number])[] = [
    ["front-left", -LOCK_X, LOCK_Z],
    ["front-right", LOCK_X, LOCK_Z],
    ["rear-left", -LOCK_X, -LOCK_Z],
    ["rear-right", LOCK_X, -LOCK_Z],
  ];

  const bodies: Group[] = [];
  const cams: Group[] = [];
  for (const [corner, x, z] of corners) {
    const id = `corner-lock-${corner}`;
    const body = createCylinderPart(
      root, registry, id, LOCK_RADIUS, LOCK_HEIGHT,
      [x, LOCK_CENTRE_Y, z], materials.aluminium, options,
    );
    bodies.push(body);
    cams.push(
      createCylinderPart(
        body,
        registry,
        `${id}-cam-detail`,
        LOCK_CAM_RADIUS,
        LOCK_CAM_HEIGHT,
        [0, (LOCK_CAM_HEIGHT - LOCK_HEIGHT) / 2, 0],
        materials.steel,
        options,
        true,
      ),
    );
  }

  return { bodies, cams };
}

function addSocket(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  position: Vector3Tuple,
): Object3D {
  const socket = new Object3D();
  socket.name = `${id}__socket`;
  socket.position.set(...position);
  parent.add(socket);
  registry.sockets[id] = socket;
  return socket;
}

/**
 * Edge-link sockets are the point of this asset: panels tile, so the four
 * mid-edge points are where the next panel registers.
 */
function createSockets(root: Group, registry: RuntimeRegistry): void {
  addSocket(root, registry, "floor-contact", [0, 0, 0]);
  addSocket(root, registry, "dance-surface-centre", [0, PANEL_HEIGHT_METRES, 0]);
  addSocket(root, registry, "edge-link-front", [0, SUBFRAME_CENTRE_Y, PANEL_DEPTH_METRES / 2]);
  addSocket(root, registry, "edge-link-rear", [0, SUBFRAME_CENTRE_Y, -PANEL_DEPTH_METRES / 2]);
  addSocket(root, registry, "edge-link-left", [-PANEL_WIDTH_METRES / 2, SUBFRAME_CENTRE_Y, 0]);
  addSocket(root, registry, "edge-link-right", [PANEL_WIDTH_METRES / 2, SUBFRAME_CENTRE_Y, 0]);
}

function createRuntimeRegistry(root: Group): RuntimeRegistry {
  return {
    nodes: { root },
    meshes: {},
    sockets: {},
    colliders: {
      root: boxCollider([PANEL_WIDTH_METRES, PANEL_HEIGHT_METRES, PANEL_DEPTH_METRES]),
    },
    destructionGroups: {},
  };
}

function publishDestructionGroups(
  registry: RuntimeRegistry,
  deck: DeckBuildResult,
  subframe: SubframeBuildResult,
  locks: LockBuildResult,
): void {
  registry.destructionGroups.deck = [deck.deck];
  registry.destructionGroups["parquet-field"] = [...deck.fingers];
  registry.destructionGroups.subframe = [subframe.subframe];
  registry.destructionGroups["subframe-ribs"] = [...subframe.ribs];
  registry.destructionGroups["corner-locks"] = [...locks.bodies];
  registry.destructionGroups["lock-hardware"] = [...locks.cams];
}

/**
 * Builds a presentation-only 3ft parquet dance-floor panel in canonical metres.
 *
 * The panel is authored as one tile of a tiled floor: the four edge-link
 * sockets are the registration points a neighbouring panel snaps to, and the
 * corner cams are the real locking mechanism rather than decoration.
 */
export function createDanceFloorPanelProxy(
  options: DanceFloorPanelProxyOptions = {},
): Group {
  const root = namedPivot("root");
  root.name = "dancefloor-panel-proxy";
  const registry = createRuntimeRegistry(root);
  const materials = createMaterials();

  const subframe = createSubframe(root, registry, materials, options);
  const deck = createDeck(root, registry, materials, options);
  const locks = createCornerLocks(root, registry, materials, options);

  createSockets(root, registry);
  publishDestructionGroups(registry, deck, subframe, locks);

  root.userData.canonicalDimensionsMetres = [
    PANEL_WIDTH_METRES, PANEL_HEIGHT_METRES, PANEL_DEPTH_METRES,
  ];
  root.userData.evidenceSource = "artifacts/img2threejs/dancefloor-panel";
  root.userData.provenance = "generated";
  root.userData.authority = "presentation-only";
  root.userData.measuredGeometry = false;
  root.userData.sculptRuntime = registry satisfies Img2ThreeSculptRuntime;
  return root;
}
