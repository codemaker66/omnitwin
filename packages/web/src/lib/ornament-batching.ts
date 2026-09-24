import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Euler,
  FrontSide,
  Matrix3,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Side,
} from "three";
import { isTranslucentAtRest } from "./material-opacity.js";

// ---------------------------------------------------------------------------
// Ornament scene description
//
// Static decorative dressing is described once as data. The same description
// renders the canonical per-mesh tree (one <mesh> per node, exactly as it was
// written in JSX) and bakes merged draw batches of the opaque pieces for
// surfaces that are fully opaque. Transforms are composed with three's own
// Object3D arithmetic (Euler -> Quaternion -> compose, parent * local), so
// baked vertices match the per-mesh world transforms.
// ---------------------------------------------------------------------------

export type Vec3 = readonly [number, number, number];

export type OrnamentGeometry =
  | { readonly kind: "box"; readonly args: readonly [width: number, height: number, depth: number] }
  | { readonly kind: "sphere"; readonly args: readonly [radius: number, widthSegments: number, heightSegments: number] }
  | { readonly kind: "cylinder"; readonly args: readonly [radiusTop: number, radiusBottom: number, height: number, radialSegments: number] }
  | { readonly kind: "plane"; readonly args: readonly [width: number, height: number] }
  | {
    readonly kind: "circle";
    readonly args:
      | readonly [radius: number, segments: number]
      | readonly [radius: number, segments: number, thetaStart: number, thetaLength: number];
  }
  | {
    readonly kind: "ring";
    readonly args:
      | readonly [innerRadius: number, outerRadius: number, thetaSegments: number]
      | readonly [innerRadius: number, outerRadius: number, thetaSegments: number, phiSegments: number, thetaStart: number, thetaLength: number];
  }
  | { readonly kind: "torus"; readonly args: readonly [radius: number, tube: number, radialSegments: number, tubularSegments: number] };

/** The `meshStandardMaterial` props an ornament declares. Omitted props keep three's defaults. */
export interface OrnamentMaterial {
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly depthWrite?: boolean;
  readonly side?: Side;
}

export interface OrnamentTransform {
  readonly position?: Vec3;
  readonly rotation?: Vec3;
  readonly scale?: Vec3;
}

export interface OrnamentGroupNode extends OrnamentTransform {
  readonly kind: "group";
  readonly name?: string;
  readonly children: readonly OrnamentNode[];
}

export interface OrnamentMeshNode {
  readonly kind: "mesh";
  readonly name?: string;
  readonly position?: Vec3;
  readonly rotation?: Vec3;
  readonly geometry: OrnamentGeometry;
  readonly material: OrnamentMaterial;
  /**
   * A face of this piece is coplanar with, and overlaps, a face of a piece in
   * another material. Which one shows depends on bit-level depth ties, so the
   * piece is never baked: it keeps its own draw on its original transform.
   */
  readonly exact?: boolean;
}

/** A drei `<Instances>` block: one instanced draw of a shared geometry/material. */
export interface OrnamentInstancesNode {
  readonly kind: "instances";
  readonly name: string;
  readonly geometry: OrnamentGeometry;
  readonly material: OrnamentMaterial;
  readonly instances: readonly { readonly position: Vec3; readonly rotation?: Vec3 }[];
}

export type OrnamentNode = OrnamentGroupNode | OrnamentMeshNode | OrnamentInstancesNode;

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export function createOrnamentGeometry(spec: OrnamentGeometry): BufferGeometry {
  switch (spec.kind) {
    case "box": return new BoxGeometry(...spec.args);
    case "sphere": return new SphereGeometry(...spec.args);
    case "cylinder": return new CylinderGeometry(...spec.args);
    case "plane": return new PlaneGeometry(...spec.args);
    case "circle": return new CircleGeometry(...spec.args);
    case "ring": return new RingGeometry(...spec.args);
    case "torus": return new TorusGeometry(...spec.args);
  }
}

/** The declared props, without undefined entries, as JSX and the constructor receive them. */
export function ornamentMaterialProps(spec: OrnamentMaterial): OrnamentMaterial {
  const props: { -readonly [K in keyof OrnamentMaterial]: OrnamentMaterial[K] } = {
    color: spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
  };
  if (spec.emissive !== undefined) props.emissive = spec.emissive;
  if (spec.emissiveIntensity !== undefined) props.emissiveIntensity = spec.emissiveIntensity;
  if (spec.transparent !== undefined) props.transparent = spec.transparent;
  if (spec.opacity !== undefined) props.opacity = spec.opacity;
  if (spec.depthWrite !== undefined) props.depthWrite = spec.depthWrite;
  if (spec.side !== undefined) props.side = spec.side;
  return props;
}

export function createOrnamentMaterial(spec: OrnamentMaterial): MeshStandardMaterial {
  return new MeshStandardMaterial(ornamentMaterialProps(spec));
}

/**
 * Identity of the rendered material: two specs with the same key produce
 * materials with identical parameters, so their geometry can share one draw.
 */
export function ornamentMaterialKey(spec: OrnamentMaterial): string {
  return [
    spec.color.toLowerCase(),
    spec.roughness,
    spec.metalness,
    (spec.emissive ?? "#000000").toLowerCase(),
    spec.emissiveIntensity ?? 1,
    spec.transparent ?? false,
    spec.opacity ?? 1,
    spec.depthWrite ?? true,
    spec.side ?? FrontSide,
  ].join("|");
}

const _euler = new Euler();
const _quaternion = new Quaternion();
const _position = new Vector3();
const _scale = new Vector3();

/** Object3D's local matrix for these props (position, XYZ Euler rotation, scale). */
export function ornamentLocalMatrix(transform: OrnamentTransform): Matrix4 {
  const [px, py, pz] = transform.position ?? [0, 0, 0];
  const [rx, ry, rz] = transform.rotation ?? [0, 0, 0];
  const [sx, sy, sz] = transform.scale ?? [1, 1, 1];
  _quaternion.setFromEuler(_euler.set(rx, ry, rz));
  return new Matrix4().compose(_position.set(px, py, pz), _quaternion, _scale.set(sx, sy, sz));
}


// ---------------------------------------------------------------------------
// Draw collection and batching
// ---------------------------------------------------------------------------

/** One draw of the per-mesh tree (a mesh, or a whole instanced block). */
export interface OrnamentDraw {
  readonly name: string;
  readonly geometry: OrnamentGeometry;
  readonly material: OrnamentMaterial;
  /** Primitive transforms relative to the collection root: one per mesh, one per instance. */
  readonly matrices: readonly Matrix4[];
  /** Never baked (see `OrnamentMeshNode.exact`). */
  readonly exact: boolean;
  /** Drawn by an InstancedMesh in the per-mesh tree. */
  readonly instanced: boolean;
}

/**
 * Collects the per-mesh draws of `nodes` in document (material creation)
 * order. World matrices are composed parent * local exactly as
 * `Object3D.updateMatrixWorld` does, so they are bit-identical to the ones
 * three computes for the per-mesh tree under an untransformed root.
 */
export function collectOrnamentDraws(nodes: readonly OrnamentNode[], parent: Matrix4 = new Matrix4()): OrnamentDraw[] {
  const draws: OrnamentDraw[] = [];
  const visit = (node: OrnamentNode, parentMatrix: Matrix4): void => {
    if (node.kind === "instances") {
      // drei's <Instances> is an untransformed InstancedMesh; each instance
      // carries its own position/rotation relative to it.
      draws.push({
        name: node.name,
        geometry: node.geometry,
        material: node.material,
        matrices: node.instances.map((instance) => new Matrix4().multiplyMatrices(parentMatrix, ornamentLocalMatrix(instance))),
        exact: false,
        instanced: true,
      });
      return;
    }
    const world = new Matrix4().multiplyMatrices(parentMatrix, ornamentLocalMatrix(node));
    if (node.kind === "mesh") {
      draws.push({
        name: node.name ?? "",
        geometry: node.geometry,
        material: node.material,
        matrices: [world],
        exact: node.exact === true,
        instanced: false,
      });
      return;
    }
    for (const child of node.children) visit(child, world);
  };
  for (const node of nodes) visit(node, parent);
  return draws;
}

/**
 * A material that still blends on a fully opaque surface (window glass).
 * three draws it in the transparent pass, after every opaque draw, sorting
 * each object by its own depth, so every such piece keeps its own draw on its
 * original transform.
 */
export function isTranslucentOrnamentMaterial(spec: OrnamentMaterial): boolean {
  return isTranslucentAtRest(spec.transparent ?? false, spec.opacity ?? 1);
}

/**
 * An opaque material that does not write depth is order-dependent: whatever
 * is drawn after it can overwrite it. Such draws are barriers that batches
 * never reach across.
 */
export function isOrderDependentOrnamentMaterial(spec: OrnamentMaterial): boolean {
  return spec.depthWrite === false && !isTranslucentOrnamentMaterial(spec);
}

export interface OrnamentBatchPlan {
  readonly key: string;
  readonly material: OrnamentMaterial;
  /** Indices into the collected draws, in draw order. */
  readonly draws: readonly number[];
}

interface PlannedDraw {
  readonly material: OrnamentMaterial;
  readonly exact?: boolean;
}

/**
 * Groups draws that share identical material parameters while preserving the
 * opaque-pass guarantees of the per-mesh tree.
 *
 * three sorts opaque draws by material id (creation order) and relies on the
 * depth buffer for the rest, so the order of depth-writing opaque draws does
 * not change the image. An opaque depth-write-disabled draw is different:
 * later draws behind it overwrite it. Every batch therefore stays entirely
 * before or entirely after each such barrier, and barriers keep their relative
 * order (adjacent identical barriers merge in their original order).
 * Translucent draws belong to the transparent pass, so they neither join nor
 * divide opaque batches; each keeps a batch of its own, as do exact draws.
 * Batches are returned in material-creation order.
 */
export function planOrnamentBatches(draws: readonly PlannedDraw[]): OrnamentBatchPlan[] {
  const plans: { key: string; material: OrnamentMaterial; draws: number[]; barrier: boolean }[] = [];
  let segment = new Map<string, { key: string; material: OrnamentMaterial; draws: number[]; barrier: boolean }>();
  draws.forEach((draw, index) => {
    const key = ornamentMaterialKey(draw.material);
    if (isTranslucentOrnamentMaterial(draw.material)) {
      plans.push({ key, material: draw.material, draws: [index], barrier: false });
      return;
    }
    if (isOrderDependentOrnamentMaterial(draw.material)) {
      segment = new Map();
      const previous = plans.at(-1);
      if (draw.exact !== true && previous?.barrier === true && previous.key === key) {
        previous.draws.push(index);
        return;
      }
      plans.push({ key, material: draw.material, draws: [index], barrier: draw.exact !== true });
      return;
    }
    if (draw.exact === true) {
      plans.push({ key, material: draw.material, draws: [index], barrier: false });
      return;
    }
    let plan = segment.get(key);
    if (plan === undefined) {
      plan = { key, material: draw.material, draws: [], barrier: false };
      segment.set(key, plan);
      plans.push(plan);
    }
    plan.draws.push(index);
  });
  return plans.map(({ key, material, draws: indices }) => ({ key, material, draws: indices }));
}

interface BakeTemplate {
  readonly geometry: BufferGeometry;
  readonly position: BufferAttribute;
  readonly normal: BufferAttribute;
  readonly uv: BufferAttribute;
  readonly index: BufferAttribute;
}

const BAKED_ATTRIBUTES = "normal,position,uv";

function bakeTemplateAttribute(geometry: BufferGeometry, name: "position" | "normal" | "uv"): BufferAttribute {
  const attribute = geometry.getAttribute(name);
  if (!(attribute instanceof BufferAttribute) || attribute.normalized) {
    throw new Error(`Ornament geometry ${name} attribute cannot be baked`);
  }
  return attribute;
}

function createBakeTemplate(spec: OrnamentGeometry): BakeTemplate {
  const geometry = createOrnamentGeometry(spec);
  const attributes = Object.keys(geometry.attributes).sort().join(",");
  const index = geometry.getIndex();
  if (attributes !== BAKED_ATTRIBUTES || Object.keys(geometry.morphAttributes).length > 0) {
    throw new Error(`Ornament geometry ${spec.kind} with attributes ${attributes} cannot be baked`);
  }
  if (index === null || index.count % 3 !== 0) throw new Error(`Ornament geometry ${spec.kind} must be an indexed triangle list`);
  return {
    geometry,
    position: bakeTemplateAttribute(geometry, "position"),
    normal: bakeTemplateAttribute(geometry, "normal"),
    uv: bakeTemplateAttribute(geometry, "uv"),
    index,
  };
}

const _vertex = new Vector3();
const _normalMatrix = new Matrix3();

/**
 * Bakes every primitive of `drawIndices` into one geometry relative to the
 * collection root. Each vertex goes through the arithmetic of
 * `BufferGeometry.applyMatrix4` (`Vector3.applyMatrix4` for positions, the
 * normal matrix and `applyNormalMatrix` for normals, float32 storage), a
 * mirrored transform swaps each triangle's last two corners so front faces
 * stay front, and parts are concatenated in order as `mergeGeometries` does
 * without groups. The result equals cloning, transforming and merging every
 * part, without allocating the intermediate copies.
 */
export function bakeOrnamentGeometry(draws: readonly OrnamentDraw[], drawIndices: readonly number[]): BufferGeometry {
  const templates = new Map<string, BakeTemplate>();
  const parts: { readonly template: BakeTemplate; readonly matrix: Matrix4 }[] = [];
  let vertexCount = 0;
  let indexCount = 0;
  for (const drawIndex of drawIndices) {
    const draw = draws[drawIndex];
    if (draw === undefined) throw new Error(`Unknown ornament draw ${String(drawIndex)}`);
    const templateKey = JSON.stringify(draw.geometry);
    let template = templates.get(templateKey);
    if (template === undefined) {
      template = createBakeTemplate(draw.geometry);
      templates.set(templateKey, template);
    }
    for (const matrix of draw.matrices) {
      parts.push({ template, matrix });
      vertexCount += template.position.count;
      indexCount += template.index.count;
    }
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  // setIndex's rule: 32-bit once an index can reach 65535 (the primitive restart value).
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const { template, matrix } of parts) {
    const { position, normal, uv, index } = template;
    _normalMatrix.getNormalMatrix(matrix);
    for (let i = 0; i < position.count; i += 1) {
      const vertex = vertexOffset + i;
      _vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
      positions[vertex * 3] = _vertex.x;
      positions[vertex * 3 + 1] = _vertex.y;
      positions[vertex * 3 + 2] = _vertex.z;
      _vertex.fromBufferAttribute(normal, i).applyNormalMatrix(_normalMatrix);
      normals[vertex * 3] = _vertex.x;
      normals[vertex * 3 + 1] = _vertex.y;
      normals[vertex * 3 + 2] = _vertex.z;
      uvs[vertex * 2] = uv.getX(i);
      uvs[vertex * 2 + 1] = uv.getY(i);
    }
    const mirrored = matrix.determinant() < 0;
    for (let i = 0; i < index.count; i += 3) {
      indices[indexOffset + i] = index.getX(i) + vertexOffset;
      indices[indexOffset + i + 1] = index.getX(mirrored ? i + 2 : i + 1) + vertexOffset;
      indices[indexOffset + i + 2] = index.getX(mirrored ? i + 1 : i + 2) + vertexOffset;
    }
    vertexOffset += position.count;
    indexOffset += index.count;
  }
  for (const template of templates.values()) template.geometry.dispose();

  const baked = new BufferGeometry();
  baked.setAttribute("position", new BufferAttribute(positions, 3));
  baked.setAttribute("normal", new BufferAttribute(normals, 3));
  baked.setAttribute("uv", new BufferAttribute(uvs, 2));
  baked.setIndex(new BufferAttribute(indices, 1));
  return baked;
}

export interface OrnamentBatch {
  readonly key: string;
  readonly material: OrnamentMaterial;
  /** Baked geometry (relative to the root), or the piece's own geometry when `transform` is set. */
  readonly geometry: BufferGeometry;
  /**
   * Set when the batch is one mesh drawn on its original transform: an exact
   * or translucent piece, or a lone primitive that baking could not merge with
   * anything. Such a draw is bit-identical to the per-mesh draw it replaces,
   * and sorts at the same depth.
   */
  readonly transform: Matrix4 | null;
  /** Per-mesh draws this batch replaces. */
  readonly sourceDraws: readonly number[];
}

export interface OrnamentBatchSet {
  readonly batches: readonly OrnamentBatch[];
  /** Number of draws the per-mesh tree issues for the same content. */
  readonly sourceDrawCount: number;
}

function bakeOrnamentBatches(draws: readonly OrnamentDraw[], plans: readonly OrnamentBatchPlan[]): OrnamentBatchSet {
  const batches = plans.map((plan): OrnamentBatch => {
    const single = plan.draws.length === 1 ? draws[plan.draws[0] ?? -1] : undefined;
    if (single?.instanced === true && isTranslucentOrnamentMaterial(plan.material)) {
      // Baking would move the block's depth-sort position to the root.
      throw new Error(`Translucent instanced ornament ${single.name} cannot be baked; keep it out of batched content`);
    }
    const matrix = single !== undefined && !single.instanced ? single.matrices[0] : undefined;
    if (single !== undefined && matrix !== undefined) {
      return {
        key: plan.key,
        material: plan.material,
        geometry: createOrnamentGeometry(single.geometry),
        transform: matrix.clone(),
        sourceDraws: plan.draws,
      };
    }
    return {
      key: plan.key,
      material: plan.material,
      geometry: bakeOrnamentGeometry(draws, plan.draws),
      transform: null,
      sourceDraws: plan.draws,
    };
  });
  return { batches, sourceDrawCount: draws.length };
}

/** Plans and bakes the merged batches for a subtree. */
export function buildOrnamentBatches(nodes: readonly OrnamentNode[]): OrnamentBatchSet {
  const draws = collectOrnamentDraws(nodes);
  return bakeOrnamentBatches(draws, planOrnamentBatches(draws));
}

/** Merged batches for a subtree, or null when merging would not remove a draw. */
export function buildOrnamentStandIn(nodes: readonly OrnamentNode[]): OrnamentBatchSet | null {
  const draws = collectOrnamentDraws(nodes);
  const plans = planOrnamentBatches(draws);
  return plans.length < draws.length ? bakeOrnamentBatches(draws, plans) : null;
}

export function disposeOrnamentBatches(set: OrnamentBatchSet): void {
  for (const batch of set.batches) batch.geometry.dispose();
}
