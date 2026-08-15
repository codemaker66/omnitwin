import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  DataTexture,
  FrontSide,
  Group,
  LatheGeometry,
  LinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type Material,
} from "three";

import type { Img2ThreeSculptRuntime } from "../../../lib/furniture-presentation-runtime.js";

const WIDTH_METRES = 0.6;
const HEIGHT_METRES = 1.05;
const DEPTH_METRES = 0.6;
const TOP_RADIUS_METRES = WIDTH_METRES / 2;
const SIDE_TOP_Y = 1.032;
const TOP_CROWN_HEIGHT = HEIGHT_METRES - SIDE_TOP_Y;
const ANGULAR_SEGMENTS = 96;
const HEIGHT_SEGMENTS = 32;
const CAP_RINGS = 10;
const TEXTURE_SIZE = 64;
const ANCHOR_PHASE_RADIANS = Math.PI / 4;
const PAD_CENTRE_RADIUS = 0.276;
const PAD_RADIUS = 0.022;
const PAD_HEIGHT = 0.021;
const FULL_TURN = Math.PI * 2;

type Vector3Tuple = readonly [number, number, number];
type ClothSlug = "poseur-table-black" | "poseur-table-white";
type SurfaceFamily = "cloth" | "rubber";
type TextureChannel = "albedo" | "ao" | "bump" | "normal" | "roughness";

export interface PoseurTableClothProxyOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface ClothVariant {
  readonly slug: ClothSlug;
  readonly rootName: string;
  readonly evidenceSource: string;
  readonly evidenceImage: string;
  readonly referenceImageSha256: string;
  readonly clothRgb: readonly [number, number, number];
  readonly clothRoughness: number;
  readonly geometryEvidenceImage: string;
  readonly referenceAdmission: "admitted" | "failed-low-contrast-material-only";
}

interface ProxyMaterials {
  readonly cloth: MeshPhysicalMaterial;
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
  readonly axis: "y";
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

interface BuiltParts {
  readonly cover: Group;
  readonly relief: readonly Group[];
  readonly pads: readonly Group[];
}

const BLACK_VARIANT: ClothVariant = {
  slug: "poseur-table-black",
  rootName: "poseur-table-black-proxy",
  evidenceSource:
    "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#poseur-table-black",
  evidenceImage:
    "packages/web/src/assets/generated-furniture/poseur-table-black-imagegen-v1.png",
  referenceImageSha256:
    "405d52d8507522342ce5497db377d8d82bbd33bc9bea7cd24589d7000fbb0b3c",
  clothRgb: [30, 30, 30],
  clothRoughness: 0.712,
  geometryEvidenceImage:
    "packages/web/src/assets/generated-furniture/poseur-table-black-imagegen-v1.png",
  referenceAdmission: "admitted",
};

const WHITE_VARIANT: ClothVariant = {
  slug: "poseur-table-white",
  rootName: "poseur-table-white-proxy",
  evidenceSource:
    "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#poseur-table-white",
  evidenceImage:
    "packages/web/src/assets/generated-furniture/poseur-table-white-imagegen-v1.png",
  referenceImageSha256:
    "4a97f1c4dc382a2348b04ffac4b190643b1766c6468dc7f15d1023edbe37e812",
  clothRgb: [235, 230, 226],
  clothRoughness: 0.696,
  geometryEvidenceImage:
    "packages/web/src/assets/generated-furniture/poseur-table-black-imagegen-v1.png",
  referenceAdmission: "failed-low-contrast-material-only",
};

const PAD_DEFINITIONS = [
  ["front-left", -3 * Math.PI / 4],
  ["front-right", -Math.PI / 4],
  ["rear-right", Math.PI / 4],
  ["rear-left", 3 * Math.PI / 4],
] as const satisfies readonly (readonly [string, number])[];

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function deterministicNoise(x: number, y: number, salt: number): number {
  const hash = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return (hash - Math.floor(hash)) * 2 - 1;
}

function wrapTextureCoordinate(value: number): number {
  return (value + TEXTURE_SIZE) % TEXTURE_SIZE;
}

function wovenHeight(x: number, y: number, salt: number): number {
  const warp = Math.sin((x + 0.35) * Math.PI * 0.68);
  const weft = Math.sin((y + 0.15) * Math.PI * 0.74);
  const crossing = warp * weft * 0.54;
  return crossing + deterministicNoise(x, y, salt) * 0.12;
}

function rubberHeight(x: number, y: number, salt: number): number {
  return deterministicNoise(x, y, salt) * 0.62
    + Math.sin((x + y) * 0.58) * 0.21
    + Math.cos((x - y) * 0.41) * 0.17;
}

function surfaceHeight(family: SurfaceFamily, x: number, y: number, salt: number): number {
  return family === "cloth" ? wovenHeight(x, y, salt) : rubberHeight(x, y, salt);
}

function writeNormalPixel(
  pixels: Uint8Array,
  index: number,
  family: SurfaceFamily,
  x: number,
  y: number,
  salt: number,
): void {
  const left = surfaceHeight(family, wrapTextureCoordinate(x - 1), y, salt);
  const right = surfaceHeight(family, wrapTextureCoordinate(x + 1), y, salt);
  const down = surfaceHeight(family, x, wrapTextureCoordinate(y - 1), salt);
  const up = surfaceHeight(family, x, wrapTextureCoordinate(y + 1), salt);
  const strength = family === "cloth" ? 7.5 : 5.5;
  pixels[index] = clampByte(128 + (left - right) * strength);
  pixels[index + 1] = clampByte(128 + (down - up) * strength);
  pixels[index + 2] = 255;
  pixels[index + 3] = 255;
}

function writeScalarPixel(
  pixels: Uint8Array,
  index: number,
  variant: ClothVariant,
  family: SurfaceFamily,
  channel: Exclude<TextureChannel, "normal">,
  x: number,
  y: number,
): void {
  const salt = channel === "albedo" ? 1 : channel === "ao" ? 2 : channel === "bump" ? 3 : 4;
  const height = surfaceHeight(family, x, y, salt);
  const broad = deterministicNoise(Math.floor(x / 8), Math.floor(y / 8), salt + 7);
  if (channel === "albedo") {
    const base = family === "cloth" ? variant.clothRgb : [17, 17, 17] as const;
    const amplitude = family === "cloth" ? 2.2 : 3.2;
    pixels[index] = clampByte(base[0] + height * amplitude + broad * 0.8);
    pixels[index + 1] = clampByte(base[1] + height * amplitude + broad * 0.8);
    pixels[index + 2] = clampByte(base[2] + height * amplitude + broad * 0.8);
  } else {
    const base = channel === "ao"
      ? family === "cloth" ? 248 : 238
      : channel === "bump"
        ? 128
        : Math.round((family === "cloth" ? variant.clothRoughness : 0.86) * 255);
    const amplitude = channel === "ao" ? 4 : channel === "bump" ? 13 : family === "cloth" ? 9 : 12;
    const value = clampByte(base + height * amplitude + broad * (channel === "roughness" ? 3 : 0));
    pixels[index] = value;
    pixels[index + 1] = value;
    pixels[index + 2] = value;
  }
  pixels[index + 3] = 255;
}

function createSurfaceTexture(
  variant: ClothVariant,
  family: SurfaceFamily,
  channel: TextureChannel,
): DataTexture {
  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const index = (y * TEXTURE_SIZE + x) * 4;
      if (channel === "normal") {
        writeNormalPixel(pixels, index, family, x, y, family === "cloth" ? 5 : 9);
      } else {
        writeScalarPixel(pixels, index, variant, family, channel, x, y);
      }
    }
  }
  const texture = new DataTexture(pixels, TEXTURE_SIZE, TEXTURE_SIZE);
  texture.name = `${variant.slug}-${family}-${channel}`;
  texture.colorSpace = channel === "albedo" ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(family === "cloth" ? 8 : 2, family === "cloth" ? 16 : 2);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  if (channel === "ao") texture.channel = 0;
  texture.needsUpdate = true;
  return texture;
}

function createMaterials(variant: ClothVariant): ProxyMaterials {
  const cloth = new MeshPhysicalMaterial({
    map: createSurfaceTexture(variant, "cloth", "albedo"),
    aoMap: createSurfaceTexture(variant, "cloth", "ao"),
    aoMapIntensity: variant.slug === "poseur-table-white" ? 0.16 : 0.2,
    bumpMap: createSurfaceTexture(variant, "cloth", "bump"),
    bumpScale: variant.slug === "poseur-table-white" ? 0.00016 : 0.00018,
    metalness: 0,
    normalMap: createSurfaceTexture(variant, "cloth", "normal"),
    normalScale: new Vector2(0.18, 0.18),
    roughness: variant.clothRoughness,
    roughnessMap: createSurfaceTexture(variant, "cloth", "roughness"),
    side: FrontSide,
  });
  cloth.name = `${variant.slug}-matte-woven-cloth`;

  const rubber = new MeshStandardMaterial({
    map: createSurfaceTexture(variant, "rubber", "albedo"),
    aoMap: createSurfaceTexture(variant, "rubber", "ao"),
    aoMapIntensity: 0.28,
    bumpMap: createSurfaceTexture(variant, "rubber", "bump"),
    bumpScale: 0.00008,
    metalness: 0,
    normalMap: createSurfaceTexture(variant, "rubber", "normal"),
    normalScale: new Vector2(0.09, 0.09),
    roughness: 0.86,
    roughnessMap: createSurfaceTexture(variant, "rubber", "roughness"),
    side: FrontSide,
  });
  rubber.name = `${variant.slug}-floor-pad-rubber`;
  return { cloth, rubber };
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function anchorStrength(theta: number): number {
  const wave = 0.5 + 0.5 * Math.cos(4 * (theta - ANCHOR_PHASE_RADIANS));
  return wave * wave;
}

function lowerRadius(theta: number): number {
  return 0.215 + anchorStrength(theta) * 0.07;
}

function lowerEdgeY(theta: number): number {
  return 0.02 + (1 - anchorStrength(theta)) * 0.063;
}

function shellRadius(t: number, theta: number): number {
  const waist = 0.121 + anchorStrength(theta) * 0.003;
  if (t <= 0.52) {
    return lowerRadius(theta) + (waist - lowerRadius(theta)) * smoothstep(t / 0.52);
  }
  return waist + (TOP_RADIUS_METRES - waist) * smoothstep((t - 0.52) / 0.48);
}

function shellY(t: number, theta: number): number {
  return lowerEdgeY(theta) + (SIDE_TOP_Y - lowerEdgeY(theta)) * smoothstep(t);
}

function pushVertex(
  positions: number[],
  uvs: number[],
  x: number,
  y: number,
  z: number,
  u: number,
  v: number,
): number {
  const index = positions.length / 3;
  positions.push(x, y, z);
  uvs.push(u, v);
  return index;
}

function addSideVertices(positions: number[], uvs: number[]): void {
  for (let level = 0; level <= HEIGHT_SEGMENTS; level += 1) {
    const t = level / HEIGHT_SEGMENTS;
    for (let segment = 0; segment <= ANGULAR_SEGMENTS; segment += 1) {
      const theta = (segment / ANGULAR_SEGMENTS) * FULL_TURN;
      const radius = shellRadius(t, theta);
      pushVertex(
        positions,
        uvs,
        Math.cos(theta) * radius,
        shellY(t, theta),
        Math.sin(theta) * radius,
        segment / ANGULAR_SEGMENTS,
        t,
      );
    }
  }
}

function addSideIndices(indices: number[]): void {
  const stride = ANGULAR_SEGMENTS + 1;
  for (let level = 0; level < HEIGHT_SEGMENTS; level += 1) {
    for (let segment = 0; segment < ANGULAR_SEGMENTS; segment += 1) {
      const lower = level * stride + segment;
      const upper = lower + stride;
      indices.push(lower, upper, lower + 1, lower + 1, upper, upper + 1);
    }
  }
}

function addCapRing(
  positions: number[],
  uvs: number[],
  radius: number,
): number {
  const start = positions.length / 3;
  const normalized = radius / TOP_RADIUS_METRES;
  const y = SIDE_TOP_Y + TOP_CROWN_HEIGHT * (1 - normalized * normalized);
  for (let segment = 0; segment <= ANGULAR_SEGMENTS; segment += 1) {
    const theta = (segment / ANGULAR_SEGMENTS) * FULL_TURN;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    pushVertex(positions, uvs, x, y, z, 0.5 + x / WIDTH_METRES, 0.5 + z / DEPTH_METRES);
  }
  return start;
}

function addCapGeometry(positions: number[], uvs: number[], indices: number[]): void {
  const ringStarts: number[] = [];
  for (let ring = 1; ring < CAP_RINGS; ring += 1) {
    ringStarts.push(addCapRing(positions, uvs, TOP_RADIUS_METRES * ring / CAP_RINGS));
  }
  ringStarts.push(HEIGHT_SEGMENTS * (ANGULAR_SEGMENTS + 1));
  const centre = pushVertex(positions, uvs, 0, HEIGHT_METRES, 0, 0.5, 0.5);
  const firstRing = ringStarts[0];
  if (firstRing === undefined) throw new Error("fitted cloth cap requires an inner ring");
  for (let segment = 0; segment < ANGULAR_SEGMENTS; segment += 1) {
    indices.push(centre, firstRing + segment + 1, firstRing + segment);
  }
  for (let ring = 0; ring < ringStarts.length - 1; ring += 1) {
    const inner = ringStarts[ring];
    const outer = ringStarts[ring + 1];
    if (inner === undefined || outer === undefined) continue;
    for (let segment = 0; segment < ANGULAR_SEGMENTS; segment += 1) {
      indices.push(
        inner + segment,
        inner + segment + 1,
        outer + segment,
        inner + segment + 1,
        outer + segment + 1,
        outer + segment,
      );
    }
  }
}

function createFittedCoverGeometry(slug: ClothSlug): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  addSideVertices(positions, uvs);
  addSideIndices(indices);
  addCapGeometry(positions, uvs, indices);
  const geometry = new BufferGeometry();
  geometry.name = `${slug}-continuous-fitted-cover-geometry`;
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function lowerHemPoint(theta: number): Vector3 {
  const radius = lowerRadius(theta) + 0.001;
  return new Vector3(
    Math.cos(theta) * radius,
    lowerEdgeY(theta) + 0.0025,
    Math.sin(theta) * radius,
  );
}

function createLowerHemGeometry(slug: ClothSlug): TubeGeometry {
  const points = Array.from({ length: ANGULAR_SEGMENTS }, (_, index) =>
    lowerHemPoint((index / ANGULAR_SEGMENTS) * FULL_TURN));
  const curve = new CatmullRomCurve3(points, true, "centripetal");
  const geometry = new TubeGeometry(curve, 192, 0.0025, 6, true);
  geometry.name = `${slug}-lower-perimeter-hem-geometry`;
  return geometry;
}

function createUpperHemGeometry(slug: ClothSlug): TorusGeometry {
  const geometry = new TorusGeometry(0.292, 0.008, 12, ANGULAR_SEGMENTS);
  geometry.rotateX(Math.PI / 2);
  geometry.name = `${slug}-upper-rolled-hem-geometry`;
  return geometry;
}

function createVerticalSeamGeometry(slug: ClothSlug): TubeGeometry {
  const theta = Math.PI / 2 - 0.32;
  const points = Array.from({ length: 25 }, (_, index) => {
    const t = 0.04 + (index / 24) * 0.92;
    const radius = shellRadius(t, theta) + 0.0012;
    return new Vector3(
      Math.cos(theta) * radius,
      shellY(t, theta),
      Math.sin(theta) * radius,
    );
  });
  const curve = new CatmullRomCurve3(points, false, "centripetal");
  const geometry = new TubeGeometry(curve, 72, 0.0012, 5, false);
  geometry.name = `${slug}-vertical-panel-seam-geometry`;
  return geometry;
}

function createPadGeometry(slug: ClothSlug, id: string): LatheGeometry {
  const geometry = new LatheGeometry([
    new Vector2(0, 0),
    new Vector2(PAD_RADIUS * 0.82, 0),
    new Vector2(PAD_RADIUS, 0.003),
    new Vector2(PAD_RADIUS, 0.008),
    new Vector2(PAD_RADIUS * 0.82, 0.011),
    new Vector2(PAD_RADIUS * 0.76, PAD_HEIGHT - 0.003),
    new Vector2(PAD_RADIUS * 0.58, PAD_HEIGHT),
    new Vector2(0, PAD_HEIGHT),
  ], 32);
  geometry.name = `${slug}-${id}-geometry`;
  return geometry;
}

function boxCollider(size: Vector3Tuple): BoxColliderDescriptor {
  return { shape: "box", size, approximate: true, authority: "presentation-only" };
}

function cylinderCollider(radius: number, height: number): CylinderColliderDescriptor {
  return { shape: "cylinder", radius, height, axis: "y", approximate: true, authority: "presentation-only" };
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

function namedPivot(id: string): Group {
  const pivot = new Group();
  pivot.name = `${id}__pivot`;
  pivot.userData.componentId = id;
  return pivot;
}

function createPart(
  parent: Object3D,
  registry: RuntimeRegistry,
  id: string,
  geometry: BufferGeometry,
  material: Material,
  collider: ColliderDescriptor,
  options: PoseurTableClothProxyOptions,
  position: Vector3Tuple = [0, 0, 0],
  surfaceDetail = false,
): Group {
  const pivot = namedPivot(id);
  pivot.position.set(...position);
  const mesh = new Mesh(geometry, material);
  mesh.name = `${id}__mesh`;
  mesh.userData.componentId = id;
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  if (surfaceDetail) {
    pivot.userData.surfaceDetail = true;
    pivot.userData.explodeWithParent = true;
    mesh.userData.surfaceDetail = true;
    mesh.userData.explodeWithParent = true;
  }
  pivot.add(mesh);
  parent.add(pivot);
  registry.nodes[id] = pivot;
  registry.meshes[id] = mesh;
  registry.colliders[id] = collider;
  return pivot;
}

function buildCover(
  root: Group,
  registry: RuntimeRegistry,
  variant: ClothVariant,
  material: MeshPhysicalMaterial,
  options: PoseurTableClothProxyOptions,
): { readonly cover: Group; readonly relief: readonly Group[] } {
  const cover = createPart(
    root,
    registry,
    "cover-assembly",
    createFittedCoverGeometry(variant.slug),
    material,
    cylinderCollider(TOP_RADIUS_METRES, HEIGHT_METRES),
    options,
  );
  const upperHem = createPart(
    cover,
    registry,
    "upper-hem",
    createUpperHemGeometry(variant.slug),
    material,
    cylinderCollider(TOP_RADIUS_METRES, 0.016),
    options,
    [0, SIDE_TOP_Y, 0],
    true,
  );
  const lowerHem = createPart(
    cover,
    registry,
    "lower-hem",
    createLowerHemGeometry(variant.slug),
    material,
    boxCollider([0.58, 0.07, 0.58]),
    options,
    [0, 0, 0],
    true,
  );
  const verticalSeam = createPart(
    cover,
    registry,
    "vertical-seam",
    createVerticalSeamGeometry(variant.slug),
    material,
    boxCollider([0.22, 0.98, 0.22]),
    options,
    [0, 0, 0],
    true,
  );
  return { cover, relief: [upperHem, lowerHem, verticalSeam] };
}

function buildPads(
  root: Group,
  registry: RuntimeRegistry,
  variant: ClothVariant,
  material: MeshStandardMaterial,
  options: PoseurTableClothProxyOptions,
): readonly Group[] {
  return PAD_DEFINITIONS.map(([corner, theta]) => {
    const id = `anchor-pad-${corner}`;
    const position: Vector3Tuple = [
      Math.cos(theta) * PAD_CENTRE_RADIUS,
      0,
      Math.sin(theta) * PAD_CENTRE_RADIUS,
    ];
    return createPart(
      root,
      registry,
      id,
      createPadGeometry(variant.slug, id),
      material,
      cylinderCollider(PAD_RADIUS, PAD_HEIGHT),
      options,
      position,
    );
  });
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
  createSocket(root, registry, "tabletop-centre", [0, HEIGHT_METRES, 0]);
  createSocket(root, registry, "cover-waist", [0, 0.55, 0]);
  createSocket(root, registry, "upper-cover-seam", [0, SIDE_TOP_Y, 0]);
  for (const [corner, theta] of PAD_DEFINITIONS) {
    createSocket(root, registry, `anchor-${corner}`, [
      Math.cos(theta) * PAD_CENTRE_RADIUS,
      0,
      Math.sin(theta) * PAD_CENTRE_RADIUS,
    ]);
  }
}

function assignDestructionGroups(registry: RuntimeRegistry, parts: BuiltParts): void {
  registry.destructionGroups["cloth-cover"] = [parts.cover];
  registry.destructionGroups["cloth-relief"] = [...parts.relief];
  registry.destructionGroups["floor-pad-system"] = [...parts.pads];
}

function assignProvenance(root: Group, variant: ClothVariant): void {
  root.userData.canonicalDimensionsMetres = [WIDTH_METRES, HEIGHT_METRES, DEPTH_METRES];
  root.userData.evidenceSource = variant.evidenceSource;
  root.userData.evidenceImage = variant.evidenceImage;
  root.userData.referenceImageSha256 = variant.referenceImageSha256;
  root.userData.geometryEvidenceImage = variant.geometryEvidenceImage;
  root.userData.geometryEvidenceAdmission = "admitted-black-reference";
  root.userData.referenceAdmission = variant.referenceAdmission;
  root.userData.provenance = "generated";
  root.userData.authority = "presentation-only";
  root.userData.measuredGeometry = false;
  root.userData.operational = false;
  root.userData.colliderAuthority = "metadata-only";
  root.userData.rootScalePolicy = "unit-root";
  root.userData.intrinsicClothVariant = true;
  root.userData.approximationNotes = variant.slug === "poseur-table-white"
    ? "Not measured. The white reference failed low-contrast geometry admission and supplies material evidence only; the admitted black reference supplies the shared fitted-cover geometry."
    : "Not measured. One admitted ImageGen view establishes an approximate visible fitted-cover silhouette; hidden structure, rear seams, textile specification, and physics are not authoritative.";
}

function createFittedClothPoseurProxy(
  variant: ClothVariant,
  options: PoseurTableClothProxyOptions,
): Group {
  const root = new Group();
  root.name = variant.rootName;
  root.userData.componentId = "root";
  const registry = createRegistry(root);
  const materials = createMaterials(variant);
  const { cover, relief } = buildCover(root, registry, variant, materials.cloth, options);
  const pads = buildPads(root, registry, variant, materials.rubber, options);
  createSockets(root, registry);
  assignDestructionGroups(registry, { cover, relief, pads });
  assignProvenance(root, variant);
  root.userData.sculptRuntime = registry satisfies Img2ThreeSculptRuntime;
  return root;
}

/** Build the intrinsic matte-black fitted-cloth poseur variant in canonical metres. */
export function createPoseurTableBlackProxy(
  options: PoseurTableClothProxyOptions = {},
): Group {
  return createFittedClothPoseurProxy(BLACK_VARIANT, options);
}

/** Build the intrinsic warm-white fitted-cloth poseur variant in canonical metres. */
export function createPoseurTableWhiteProxy(
  options: PoseurTableClothProxyOptions = {},
): Group {
  return createFittedClothPoseurProxy(WHITE_VARIANT, options);
}
