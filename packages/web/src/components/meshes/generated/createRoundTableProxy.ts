import {
  BoxGeometry,
  CylinderGeometry,
  DataTexture,
  ExtrudeGeometry,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from "three";

import type { Img2ThreeSculptRuntime } from "../../../lib/furniture-presentation-runtime.js";

const TABLE_DIAMETER_METRES = 1.83;
const TABLE_HEIGHT_METRES = 0.76;
const TABLETOP_THICKNESS_METRES = 0.055;
const TABLETOP_RADIUS_METRES = TABLE_DIAMETER_METRES / 2;
const TABLETOP_CENTRE_Y = TABLE_HEIGHT_METRES - TABLETOP_THICKNESS_METRES / 2;
const TABLETOP_CORE_RADIUS = TABLETOP_RADIUS_METRES - 0.008;
const FRAME_OFFSET_X = 0.57;
const LEG_OFFSET_Z = 0.43;
const LEG_WIDTH = 0.055;
const LEG_BOTTOM_Y = 0.025;
const LEG_TOP_Y = 0.684;
const OAK_TEXTURE_SIZE = 128;
const FULL_TURN = Math.PI * 2;

export interface RoundTableProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface TableMaterials {
  readonly oak: MeshStandardMaterial;
  readonly oakEdge: MeshStandardMaterial;
  readonly bronze: MeshStandardMaterial;
  readonly fastener: MeshStandardMaterial;
  readonly cap: MeshStandardMaterial;
}

interface RuntimeRegistry {
  readonly nodes: Record<string, Object3D>;
  readonly meshes: Record<string, Mesh>;
  readonly sockets: Record<string, Object3D>;
  readonly colliders: Record<string, unknown>;
  readonly destructionGroups: Record<string, Object3D[]>;
}

interface FrameBuildResult {
  readonly frame: Group;
  readonly parts: readonly Object3D[];
  readonly braces: readonly Object3D[];
  readonly hingePlates: readonly Object3D[];
  readonly hingeFasteners: readonly Object3D[];
  readonly cleat: Object3D;
  readonly pivotTab: Object3D;
}

interface HingeHardwareBuildResult {
  readonly plates: readonly Object3D[];
  readonly fasteners: readonly Object3D[];
}

interface FrameRailDetailBuildResult {
  readonly cleat: Mesh;
  readonly pivotTab: Mesh;
}

function createOakTexture(): DataTexture {
  const pixels = new Uint8Array(OAK_TEXTURE_SIZE * OAK_TEXTURE_SIZE * 4);
  for (let y = 0; y < OAK_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < OAK_TEXTURE_SIZE; x += 1) {
      const grain = Math.sin(y * 0.31 + Math.sin(x * 0.075) * 2.1);
      const pore = Math.sin(y * 1.37 + x * 0.043) * 0.35;
      const broadBand = Math.sin(y * 0.071 + x * 0.009) * 0.45;
      const variation = Math.round(grain * 5 + pore * 3 + broadBand * 5);
      const index = (y * OAK_TEXTURE_SIZE + x) * 4;
      pixels[index] = 188 + variation;
      pixels[index + 1] = 132 + variation;
      pixels[index + 2] = 80 + Math.round(variation * 0.7);
      pixels[index + 3] = 255;
    }
  }
  const texture = new DataTexture(pixels, OAK_TEXTURE_SIZE, OAK_TEXTURE_SIZE);
  texture.name = "round-table-warm-oak-grain";
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createMaterials(): TableMaterials {
  const oakTexture = createOakTexture();
  return {
    oak: new MeshStandardMaterial({ map: oakTexture, metalness: 0, roughness: 0.6 }),
    oakEdge: new MeshStandardMaterial({ color: 0xa96f3f, metalness: 0, roughness: 0.54 }),
    bronze: new MeshStandardMaterial({ color: 0x3e3125, metalness: 0.62, roughness: 0.49 }),
    fastener: new MeshStandardMaterial({ color: 0x49392b, metalness: 0.74, roughness: 0.38 }),
    cap: new MeshStandardMaterial({ color: 0x251910, metalness: 0, roughness: 0.8 }),
  };
}

function namedGroup(name: string): Group {
  const group = new Group();
  group.name = `${name}__pivot`;
  return group;
}

function configureMesh(mesh: Mesh, name: string, options: RoundTableProxyOptions): Mesh {
  mesh.name = name;
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  return mesh;
}

function markSurfaceDetail(mesh: Mesh): Mesh {
  mesh.userData.explodeWithParent = true;
  mesh.userData.surfaceDetail = true;
  return mesh;
}

function registerSurfaceDetail(
  registry: RuntimeRegistry,
  id: string,
  mesh: Mesh,
  collider: Readonly<Record<string, unknown>>,
): Mesh {
  registry.nodes[id] = mesh;
  registry.meshes[id] = mesh;
  registry.colliders[id] = collider;
  return markSurfaceDetail(mesh);
}

function registerPart(
  registry: RuntimeRegistry,
  id: string,
  pivot: Group,
  mesh: Mesh,
  collider: Readonly<Record<string, unknown>>,
): void {
  registry.nodes[id] = pivot;
  registry.meshes[id] = mesh;
  registry.colliders[id] = collider;
}

function createTabletopGeometry(): ExtrudeGeometry {
  const outline = new Shape();
  outline.absarc(0, 0, TABLETOP_CORE_RADIUS, 0, FULL_TURN, false);
  const geometry = new ExtrudeGeometry(outline, {
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.008,
    bevelThickness: 0.008,
    curveSegments: 48,
    depth: TABLETOP_THICKNESS_METRES - 0.016,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

function addTabletop(
  root: Group,
  materials: TableMaterials,
  registry: RuntimeRegistry,
  options: RoundTableProxyOptions,
): Group {
  const pivot = namedGroup("tabletop");
  pivot.position.y = TABLETOP_CENTRE_Y;
  const top = configureMesh(new Mesh(createTabletopGeometry(), materials.oak), "tabletop", options);
  const rim = registerSurfaceDetail(registry, "tabletop-rim-detail", configureMesh(
    new Mesh(new TorusGeometry(0.909, 0.0035, 4, 48), materials.oakEdge),
    "tabletop-rim-detail",
    options,
  ), {
    type: "cylinder",
    radius: TABLETOP_RADIUS_METRES,
    height: 0.007,
  });
  rim.rotateX(Math.PI / 2);
  // Sit the bead on the tabletop's lower edge instead of buried at mid-depth.
  // The extruded top sustains radius 0.915 through y ±0.0195 about this pivot,
  // so a 0.9125-radius torus at y=0 was sealed inside 24mm of oak and never
  // rendered a pixel. Dropping it to the underside (top of the bead meeting
  // the tabletop's bottom face at -0.0275) makes it read as the edge moulding
  // it was modelled to be, and it stays inside the 0.915 canonical radius.
  rim.position.y = -0.0275 - 0.0035 / 2;
  const apron = registerSurfaceDetail(registry, "underside-apron-detail", configureMesh(
    new Mesh(new CylinderGeometry(0.84, 0.84, 0.018, 48, 1), materials.oakEdge),
    "tabletop-underside-apron-detail",
    options,
  ), {
    type: "cylinder",
    radius: 0.84,
    height: 0.018,
  });
  apron.position.y = -0.0365;
  pivot.add(top, rim, apron);
  root.add(pivot);
  registerPart(registry, "tabletop", pivot, top, {
    type: "cylinder",
    radius: TABLETOP_RADIUS_METRES,
    height: TABLETOP_THICKNESS_METRES,
  });
  registry.destructionGroups.tabletop = [pivot];
  registry.destructionGroups["underside-apron"] = [apron];
  return pivot;
}

function createLeg(
  side: "left" | "right",
  end: "front" | "rear",
  materials: TableMaterials,
  registry: RuntimeRegistry,
  options: RoundTableProxyOptions,
): Group {
  const id = `${end}-${side}-leg`;
  const pivot = namedGroup(id);
  pivot.position.z = end === "front" ? LEG_OFFSET_Z : -LEG_OFFSET_Z;
  const height = LEG_TOP_Y - LEG_BOTTOM_Y;
  const leg = configureMesh(
    new Mesh(new BoxGeometry(LEG_WIDTH, height, LEG_WIDTH), materials.bronze),
    `${id}-post`,
    options,
  );
  leg.position.y = LEG_BOTTOM_Y + height / 2;
  const capId = `${id}-foot-cap-detail`;
  const cap = registerSurfaceDetail(registry, capId, configureMesh(
    new Mesh(new BoxGeometry(0.066, 0.035, 0.066), materials.cap),
    capId,
    options,
  ), { type: "box", size: [0.066, 0.035, 0.066] });
  cap.position.y = 0.0175;
  pivot.add(leg, cap);
  registerPart(registry, id, pivot, leg, {
    type: "box",
    size: [LEG_WIDTH, height, LEG_WIDTH],
  });
  return pivot;
}

function createBrace(
  id: string,
  end: "front" | "rear",
  material: MeshStandardMaterial,
  registry: RuntimeRegistry,
  options: RoundTableProxyOptions,
): Group {
  const zDirection = end === "front" ? 1 : -1;
  const start = new Vector3(0, 0.485, zDirection * 0.30);
  const finish = new Vector3(0, 0.682, zDirection * 0.09);
  const direction = finish.clone().sub(start);
  const pivot = namedGroup(id);
  pivot.position.copy(start);
  const brace = configureMesh(
    new Mesh(new BoxGeometry(0.032, direction.length(), 0.018), material),
    `${id}-strap`,
    options,
  );
  brace.position.copy(direction).multiplyScalar(0.5);
  brace.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize());
  pivot.add(brace);
  registerPart(registry, id, pivot, brace, {
    type: "box",
    size: [0.032, direction.length(), 0.018],
  });
  return pivot;
}

function addHingeHardware(
  assemblyId: "a" | "b",
  side: "left" | "right",
  frame: Group,
  materials: TableMaterials,
  registry: RuntimeRegistry,
  options: RoundTableProxyOptions,
): HingeHardwareBuildResult {
  const plates: Object3D[] = [];
  const fasteners: Object3D[] = [];
  for (const end of ["front", "rear"] as const) {
    const zDirection = end === "front" ? 1 : -1;
    const plateId = `hinge-plate-${assemblyId}-${end}-detail`;
    const plate = registerSurfaceDetail(registry, plateId, configureMesh(
      new Mesh(new BoxGeometry(0.012, 0.09, 0.09), materials.bronze),
      plateId,
      options,
    ), { type: "box", size: [0.012, 0.09, 0.09] });
    plate.position.set(0, 0.475, zDirection * LEG_OFFSET_Z);
    frame.add(plate);
    plates.push(plate);
    for (const yOffset of [-0.021, 0.021]) {
      const fastenerId = `hinge-fastener-${assemblyId}-${end}-${yOffset < 0 ? "lower" : "upper"}-detail`;
      const fastener = registerSurfaceDetail(registry, fastenerId, configureMesh(
        new Mesh(new CylinderGeometry(0.008, 0.008, 0.006, 10, 1), materials.fastener),
        fastenerId,
        options,
      ), { type: "cylinder", radius: 0.008, height: 0.006 });
      fastener.rotateZ(Math.PI / 2);
      fastener.position.set(side === "left" ? -0.009 : 0.009, 0.475 + yOffset, zDirection * LEG_OFFSET_Z);
      frame.add(fastener);
      fasteners.push(fastener);
    }
  }
  return { plates, fasteners };
}

function addFrameRailDetails(
  assemblyId: "a" | "b",
  frame: Group,
  materials: TableMaterials,
  registry: RuntimeRegistry,
  options: RoundTableProxyOptions,
): FrameRailDetailBuildResult {
  const cleatId = `cleat-${assemblyId}-detail`;
  const cleat = registerSurfaceDetail(registry, cleatId, configureMesh(
    new Mesh(new BoxGeometry(0.12, 0.026, 0.72), materials.bronze),
    cleatId,
    options,
  ), { type: "box", size: [0.12, 0.026, 0.72] });
  cleat.position.y = 0.687;
  const pivotTabId = `pivot-tab-${assemblyId}-detail`;
  const pivotTab = registerSurfaceDetail(registry, pivotTabId, configureMesh(
    new Mesh(new BoxGeometry(0.068, 0.068, 0.014), materials.bronze),
    pivotTabId,
    options,
  ), { type: "box", size: [0.068, 0.068, 0.014] });
  pivotTab.position.set(0, 0.49, 0);
  frame.add(cleat, pivotTab);
  return { cleat, pivotTab };
}

function buildFrame(
  assemblyId: "a" | "b",
  side: "left" | "right",
  x: number,
  materials: TableMaterials,
  registry: RuntimeRegistry,
  options: RoundTableProxyOptions,
): FrameBuildResult {
  const trestleId = `trestle-${assemblyId}`;
  const frame = namedGroup(trestleId);
  frame.position.x = x;
  const rail = configureMesh(
    new Mesh(new BoxGeometry(0.06, 0.06, 0.93), materials.bronze),
    trestleId,
    options,
  );
  rail.position.y = 0.47;
  frame.add(rail);
  registerPart(registry, trestleId, frame, rail, {
    type: "box",
    size: [0.06, 0.06, 0.93],
  });

  const frontLeg = createLeg(side, "front", materials, registry, options);
  const rearLeg = createLeg(side, "rear", materials, registry, options);
  const frontBrace = createBrace(
    `${side}-front-brace`,
    "front",
    materials.bronze,
    registry,
    options,
  );
  const rearBrace = createBrace(
    `${side}-rear-brace`,
    "rear",
    materials.bronze,
    registry,
    options,
  );
  frame.add(frontLeg, rearLeg, frontBrace, rearBrace);
  const hardware = addHingeHardware(
    assemblyId,
    side,
    frame,
    materials,
    registry,
    options,
  );
  const railDetails = addFrameRailDetails(
    assemblyId,
    frame,
    materials,
    registry,
    options,
  );
  return {
    frame,
    parts: [frame, frontLeg, rearLeg, frontBrace, rearBrace],
    braces: [frontBrace, rearBrace],
    hingePlates: hardware.plates,
    hingeFasteners: hardware.fasteners,
    cleat: railDetails.cleat,
    pivotTab: railDetails.pivotTab,
  };
}

function addCrossbar(
  root: Group,
  material: MeshStandardMaterial,
  registry: RuntimeRegistry,
  options: RoundTableProxyOptions,
): Group {
  const pivot = namedGroup("frame-crossbar");
  // 0.654, not 0.65: the beam is 0.04 deep, so its top lands exactly on the
  // underside cleat at y=0.674. At 0.65 it stopped 4mm short and was the only
  // mesh in any proxy with no neighbour it actually touched — a beam bolted to
  // nothing, which reads as a modelling error the moment the table is exploded.
  pivot.position.y = 0.654;
  const crossbar = configureMesh(
    new Mesh(new BoxGeometry(1.16, 0.04, 0.05), material),
    "frame-crossbar-beam",
    options,
  );
  pivot.add(crossbar);
  root.add(pivot);
  registerPart(registry, "frame-crossbar", pivot, crossbar, {
    type: "box",
    size: [1.16, 0.04, 0.05],
  });
  return pivot;
}

function createRuntimeRegistry(root: Group): RuntimeRegistry {
  return {
    nodes: { root },
    meshes: {},
    sockets: {},
    colliders: {
      root: {
        type: "cylinder",
        radius: TABLETOP_RADIUS_METRES,
        height: TABLE_HEIGHT_METRES,
      },
    },
    destructionGroups: {},
  };
}

function addTabletopSocket(tabletop: Group, registry: RuntimeRegistry): void {
  const socket = namedGroup("tabletop-centre-socket");
  socket.position.y = TABLETOP_THICKNESS_METRES / 2;
  tabletop.add(socket);
  registry.sockets["tabletop-centre"] = socket;
}

/** Build the final metre-scale procedural proxy for a six-foot round banquet table. */
export function createRoundTableProxy(options: RoundTableProxyOptions = {}): Group {
  const root = namedGroup("round-table-6ft");
  root.name = "round-table-6ft";
  root.userData.componentId = "root";
  const materials = createMaterials();
  const registry = createRuntimeRegistry(root);
  const tabletop = addTabletop(root, materials, registry, options);
  addTabletopSocket(tabletop, registry);

  const frameA = buildFrame("a", "left", -FRAME_OFFSET_X, materials, registry, options);
  const frameB = buildFrame("b", "right", FRAME_OFFSET_X, materials, registry, options);
  root.add(frameA.frame, frameB.frame);
  const crossbar = addCrossbar(root, materials.bronze, registry, options);

  registry.destructionGroups["frame-a"] = [...frameA.parts];
  registry.destructionGroups["frame-b"] = [...frameB.parts];
  registry.destructionGroups["brace-set-a"] = [...frameA.braces];
  registry.destructionGroups["brace-set-b"] = [...frameB.braces];
  registry.destructionGroups["hinge-plate-a"] = [...frameA.hingePlates];
  registry.destructionGroups["hinge-plate-b"] = [...frameB.hingePlates];
  registry.destructionGroups["cleat-a"] = [frameA.cleat];
  registry.destructionGroups["cleat-b"] = [frameB.cleat];
  registry.destructionGroups["pivot-tab-a"] = [frameA.pivotTab];
  registry.destructionGroups["pivot-tab-b"] = [frameB.pivotTab];
  registry.destructionGroups["hinge-fastener-system"] = [
    ...frameA.hingeFasteners,
    ...frameB.hingeFasteners,
  ];
  registry.destructionGroups.hardware = [
    crossbar,
    ...frameA.hingePlates,
    ...frameA.hingeFasteners,
    frameA.cleat,
    frameA.pivotTab,
    ...frameB.hingePlates,
    ...frameB.hingeFasteners,
    frameB.cleat,
    frameB.pivotTab,
  ];
  registry.destructionGroups["frame-crossbar"] = [crossbar];
  registry.destructionGroups.root = [tabletop, frameA.frame, frameB.frame, crossbar];
  root.userData.canonicalDimensionsMetres = [TABLE_DIAMETER_METRES, TABLE_HEIGHT_METRES, TABLE_DIAMETER_METRES];
  root.userData.evidenceSource =
    "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#round-table-6ft";
  root.userData.evidenceImage =
    "packages/web/src/assets/generated-furniture/round-table-6ft-imagegen-v1.png";
  root.userData.provenance = "generated";
  root.userData.authority = "presentation-only";
  root.userData.measuredGeometry = false;
  root.userData.sculptRuntime = registry satisfies Img2ThreeSculptRuntime;
  return root;
}
