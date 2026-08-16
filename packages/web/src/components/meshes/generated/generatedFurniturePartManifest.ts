import { InstancedMesh, Mesh, type Object3D } from "three";

import {
  readImg2ThreeSculptRuntime,
  type Img2ThreeSculptRuntime,
} from "../../../lib/furniture-presentation-runtime.js";

const PART_MANIFEST_SCHEMA_VERSION = "venviewer.img2threejs-parts.v1";
const ROOT_NODE_ID = "root";

export interface GeneratedFurniturePartManifestPart {
  readonly name: string;
  readonly kind: "part" | "assembly";
  readonly module: string;
  readonly triangles: number;
  readonly members?: readonly string[];
}

export interface GeneratedFurniturePartManifest {
  readonly schemaVersion: typeof PART_MANIFEST_SCHEMA_VERSION;
  readonly model: string;
  readonly parts: readonly GeneratedFurniturePartManifestPart[];
  readonly unnamedMeshes: number;
  readonly integralMeshes: number;
}

interface DirectPartRecords {
  readonly parts: readonly GeneratedFurniturePartManifestPart[];
  readonly ids: ReadonlySet<string>;
  readonly integralMeshes: number;
}

function isSurfaceDetail(node: Object3D, mesh: Mesh | undefined): boolean {
  return node.userData.explodeWithParent === true
    || mesh?.userData.explodeWithParent === true;
}

function collectMeshes(nodes: readonly Object3D[]): Set<Mesh> {
  const meshes = new Set<Mesh>();
  for (const node of nodes) {
    node.traverse((candidate) => {
      if (candidate instanceof Mesh) meshes.add(candidate as Mesh);
    });
  }
  return meshes;
}

function countTriangles(nodes: readonly Object3D[]): number {
  let count = 0;
  for (const mesh of collectMeshes(nodes)) {
    const index = mesh.geometry.getIndex();
    const position = mesh.geometry.getAttribute("position");
    const triangles = Math.floor((index === null ? position.count : index.count) / 3);
    count += triangles * (mesh instanceof InstancedMesh ? mesh.count : 1);
  }
  return count;
}

function runtimeIdsByNode(runtime: Img2ThreeSculptRuntime): ReadonlyMap<Object3D, string> {
  const result = new Map<Object3D, string>();
  for (const [id, node] of Object.entries(runtime.nodes)) {
    if (result.has(node)) throw new Error(`runtime node ${id} duplicates another part`);
    result.set(node, id);
  }
  return result;
}

function assemblyMemberIds(
  groupId: string,
  nodes: readonly Object3D[],
  idsByNode: ReadonlyMap<Object3D, string>,
): readonly string[] {
  if (nodes.length === 0) throw new Error(`destruction group ${groupId} is empty`);
  const ids = nodes.map((node) => {
    const id = idsByNode.get(node);
    if (id === undefined) {
      throw new Error(`destruction group ${groupId} contains an unregistered runtime node`);
    }
    return id;
  });
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function moduleForNode(
  node: Object3D,
  runtime: Img2ThreeSculptRuntime,
  fallback: string,
): string {
  const memberships = Object.entries(runtime.destructionGroups)
    .filter(([, members]) => members.includes(node))
    .map(([groupId, members]) => ({ groupId, memberCount: new Set(members).size }))
    .sort((left, right) => left.memberCount - right.memberCount
      || left.groupId.localeCompare(right.groupId));
  return memberships[0]?.groupId ?? fallback;
}

function createDirectPartRecords(runtime: Img2ThreeSculptRuntime): DirectPartRecords {
  const parts: GeneratedFurniturePartManifestPart[] = [];
  const ids = new Set<string>();
  let integralMeshes = 0;
  for (const [id, node] of Object.entries(runtime.nodes)) {
    if (id === ROOT_NODE_ID) continue;
    const mesh = runtime.meshes[id];
    if (isSurfaceDetail(node, mesh)) {
      integralMeshes += mesh === undefined ? 0 : 1;
      continue;
    }
    ids.add(id);
    parts.push({
      name: id,
      kind: "part",
      module: moduleForNode(node, runtime, id),
      triangles: countTriangles([node]),
    });
  }
  return { parts, ids, integralMeshes };
}

function createAssemblyPartRecords(
  runtime: Img2ThreeSculptRuntime,
  directPartIds: ReadonlySet<string>,
  idsByNode: ReadonlyMap<Object3D, string>,
): readonly GeneratedFurniturePartManifestPart[] {
  return Object.entries(runtime.destructionGroups)
    .filter(([groupId]) => !directPartIds.has(groupId))
    .map(([groupId, nodes]) => ({
      name: groupId,
      kind: "assembly" as const,
      module: groupId,
      triangles: countTriangles(nodes),
      members: assemblyMemberIds(groupId, nodes, idsByNode),
    }));
}

function countUnnamedMeshes(root: Object3D, runtime: Img2ThreeSculptRuntime): number {
  const registeredMeshes = new Set(Object.values(runtime.meshes));
  return [...collectMeshes([root])]
    .filter((mesh) => mesh.name.trim().length === 0 || !registeredMeshes.has(mesh))
    .length;
}

/** Build the img2threejs parts.json contract directly from a live generated root. */
export function createGeneratedFurniturePartManifest(
  model: string,
  root: Object3D,
): GeneratedFurniturePartManifest {
  if (model.trim().length === 0) throw new RangeError("part manifest model must not be empty");
  const runtime = readImg2ThreeSculptRuntime(root);
  if (runtime.nodes[ROOT_NODE_ID] !== root) {
    throw new Error("sculptRuntime.nodes.root must reference the generated root");
  }
  const idsByNode = runtimeIdsByNode(runtime);
  const direct = createDirectPartRecords(runtime);
  const parts = [
    ...direct.parts,
    ...createAssemblyPartRecords(runtime, direct.ids, idsByNode),
  ];
  parts.sort((left, right) => left.name.localeCompare(right.name));
  return {
    schemaVersion: PART_MANIFEST_SCHEMA_VERSION,
    model: model.trim(),
    parts,
    unnamedMeshes: countUnnamedMeshes(root, runtime),
    integralMeshes: direct.integralMeshes,
  };
}
