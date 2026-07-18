import { readFile } from "node:fs/promises";
import {
  TWIN_EQUIRECT_LODS,
  TWIN_FACES,
  TWIN_LODS,
  TwinManifestSchema,
  twinEquirectPath,
  twinTilePath,
  type TwinManifest,
} from "@omnitwin/types";
import { stableCanonicalJson, toCanonicalJson } from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import { inspectGlb, type GlbInspection } from "./glb.js";
import {
  inventoryFile,
  inventoryTwinBundle,
  type FoundryBundleInventory,
  type FoundryInventoryFile,
} from "./inventory.js";
import { resolveBundlePath } from "./path-safety.js";
import { inspectWebp, type WebpDimensions } from "./webp.js";

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const QUATERNION_NORM_TOLERANCE = 0.02;
// Twin Forge persists edge lengths at millimetre precision (toFixed(3)).
// Half a millimetre plus a tiny floating-point envelope is therefore exact
// agreement with the producer contract, not a geometric error allowance.
const EDGE_DISTANCE_TOLERANCE_M = 0.000_500_001;

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export const FOUNDRY_QA_CHECK_IDS = [
  "manifest_schema",
  "exact_file_set",
  "content_hashes",
  "graph_integrity",
  "floor_integrity",
  "webp_integrity",
  "glb_integrity",
] as const;
export type FoundryQaCheckId = (typeof FOUNDRY_QA_CHECK_IDS)[number];

export interface FoundryQaCheck {
  readonly id: FoundryQaCheckId;
  readonly status: "passed";
  readonly evidence: string;
}

export interface TwinBundleQaResult {
  readonly manifest: TwinManifest;
  readonly inventory: FoundryBundleInventory;
  readonly checks: readonly FoundryQaCheck[];
  readonly webpFilesChecked: number;
  readonly mesh: GlbInspection | null;
}

export function expectedTwinContentPaths(manifest: TwinManifest): string[] {
  const paths: string[] = [];
  for (const node of manifest.nodes) {
    if (manifest.imagery === "equirect") {
      for (const lod of TWIN_EQUIRECT_LODS) paths.push(twinEquirectPath(node.id, lod));
    } else {
      for (const face of TWIN_FACES) {
        for (const lod of TWIN_LODS) paths.push(twinTilePath(node.id, face, lod));
      }
    }
  }
  if (manifest.mesh !== undefined) paths.push(manifest.mesh.path);
  return paths.sort(comparePaths);
}

function assertSamePaths(expected: readonly string[], actual: readonly string[], label: string): void {
  const expectedSorted = [...expected].sort(comparePaths);
  const actualSorted = [...actual].sort(comparePaths);
  if (
    expectedSorted.length !== actualSorted.length ||
    expectedSorted.some((path, index) => path !== actualSorted[index])
  ) {
    const expectedSet = new Set(expectedSorted);
    const actualSet = new Set(actualSorted);
    const missing = expectedSorted.filter((path) => !actualSet.has(path));
    const unexpected = actualSorted.filter((path) => !expectedSet.has(path));
    throw new FoundryIntegrityError(
      "BUNDLE_FILE_SET_MISMATCH",
      `${label} does not match the Twin manifest` +
        (missing.length === 0 ? "" : `; missing: ${missing.join(", ")}`) +
        (unexpected.length === 0 ? "" : `; unexpected: ${unexpected.join(", ")}`),
    );
  }
}

export function assertTwinExactFileSet(
  manifest: TwinManifest,
  files: readonly FoundryInventoryFile[],
): void {
  assertSamePaths(
    ["manifest.json", ...expectedTwinContentPaths(manifest)],
    files.map((file) => file.path),
    "bundle files",
  );
}

export function parseTwinManifestText(text: string): TwinManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error: unknown) {
    throw new FoundryIntegrityError("INVALID_TWIN_MANIFEST_JSON", "Twin manifest is not valid JSON.", { cause: error });
  }
  const manifest = TwinManifestSchema.parse(raw);
  if (stableCanonicalJson(toCanonicalJson(raw)) !== stableCanonicalJson(toCanonicalJson(manifest))) {
    throw new FoundryIntegrityError(
      "NON_CANONICAL_TWIN_MANIFEST_SHAPE",
      "Twin manifest contains unknown fields or relies on schema defaults.",
    );
  }
  return manifest;
}

export function assertTwinContentHashes(manifest: TwinManifest, files: readonly FoundryInventoryFile[]): void {
  const hashes = manifest.contentHashes;
  if (hashes === undefined) {
    throw new FoundryIntegrityError("MISSING_CONTENT_HASHES", "Twin manifest must include contentHashes before Foundry intake.");
  }
  const expected = expectedTwinContentPaths(manifest);
  assertSamePaths(expected, Object.keys(hashes), "manifest contentHashes");
  for (const path of expected) {
    const claimed = hashes[path];
    if (claimed === undefined || !SHA256_HEX.test(claimed)) {
      throw new FoundryIntegrityError("INVALID_CONTENT_HASH", `Invalid SHA-256 in Twin manifest for ${path}.`);
    }
    const actual = files.find((file) => file.path === path);
    if (actual === undefined || actual.sha256 !== claimed) {
      throw new FoundryIntegrityError("CONTENT_HASH_MISMATCH", `SHA-256 mismatch for ${path}.`);
    }
  }
}

function euclideanDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
}

export function assertTwinGraphIntegrity(manifest: TwinManifest): void {
  const nodeIds = new Set<string>();
  const indices = new Set<number>();
  const nodes = new Map(manifest.nodes.map((node) => [node.id, node]));
  for (const [index, node] of manifest.nodes.entries()) {
    if (nodeIds.has(node.id) || indices.has(node.index) || node.index !== index) {
      throw new FoundryIntegrityError("INVALID_NODE_IDENTITY", "Twin node IDs and indices must be unique and contiguous.");
    }
    nodeIds.add(node.id);
    indices.add(node.index);
    if (![...node.pose.q, ...node.pose.t].every(Number.isFinite)) {
      throw new FoundryIntegrityError("NON_FINITE_NODE_POSE", `Twin node ${node.id} has a non-finite pose.`);
    }
    const quaternionNorm = Math.hypot(...node.pose.q);
    if (Math.abs(quaternionNorm - 1) > QUATERNION_NORM_TOLERANCE) {
      throw new FoundryIntegrityError("INVALID_NODE_QUATERNION", `Twin node ${node.id} quaternion is not normalized.`);
    }
  }
  if (manifest.capture.kind === "matterport-e57" && manifest.capture.scanCount !== manifest.nodes.length) {
    throw new FoundryIntegrityError("CAPTURE_NODE_COUNT_MISMATCH", "Capture scanCount must equal the Twin node count.");
  }
  if (manifest.entryNodeId !== undefined && !nodeIds.has(manifest.entryNodeId)) {
    throw new FoundryIntegrityError("INVALID_ENTRY_NODE", "Twin entryNodeId must reference a declared node.");
  }

  const edges = new Set<string>();
  const adjacency = new Map<string, Set<string>>(manifest.nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of manifest.edges) {
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (a === undefined || b === undefined || edge.a === edge.b) {
      throw new FoundryIntegrityError("INVALID_NAV_EDGE", "Twin navigation edges must connect two different declared nodes.");
    }
    const key = edge.a < edge.b ? `${edge.a}\0${edge.b}` : `${edge.b}\0${edge.a}`;
    if (edges.has(key)) {
      throw new FoundryIntegrityError("DUPLICATE_NAV_EDGE", `Duplicate Twin navigation edge: ${edge.a}–${edge.b}.`);
    }
    edges.add(key);
    if (!Number.isFinite(edge.distanceM) || edge.distanceM <= 0) {
      throw new FoundryIntegrityError("INVALID_NAV_DISTANCE", `Twin navigation edge ${edge.a}–${edge.b} has an invalid distance.`);
    }
    const measured = euclideanDistance(a.pose.t, b.pose.t);
    if (Math.abs(measured - edge.distanceM) > EDGE_DISTANCE_TOLERANCE_M) {
      throw new FoundryIntegrityError("NAV_DISTANCE_MISMATCH", `Twin navigation edge ${edge.a}–${edge.b} distance is inconsistent.`);
    }
    adjacency.get(edge.a)?.add(edge.b);
    adjacency.get(edge.b)?.add(edge.a);
  }
  if ([...adjacency.values()].some((neighbours) => neighbours.size === 0)) {
    throw new FoundryIntegrityError("ISOLATED_TWIN_NODE", "Every Twin node must participate in the navigation graph.");
  }
}

export function assertTwinFloorIntegrity(manifest: TwinManifest): void {
  const nodes = new Map(manifest.nodes.map((node) => [node.id, node]));
  const floors = [...new Set(manifest.nodes.map((node) => node.floor))].sort((left, right) => left - right);
  for (let index = 1; index < floors.length; index += 1) {
    const currentFloor = floors[index];
    const previousFloor = floors[index - 1];
    if (currentFloor === undefined || previousFloor === undefined || currentFloor !== previousFloor + 1) {
      throw new FoundryIntegrityError("NON_CONTIGUOUS_FLOORS", "Twin floor buckets must be contiguous integers.");
    }
  }
  for (const edge of manifest.edges) {
    if (nodes.get(edge.a)?.floor !== nodes.get(edge.b)?.floor) {
      throw new FoundryIntegrityError("CROSS_FLOOR_NAV_EDGE", "Twin navigation edges cannot silently cross floor buckets.");
    }
  }
  for (const floor of floors) {
    const floorNodeIds = new Set(manifest.nodes.filter((node) => node.floor === floor).map((node) => node.id));
    const first = floorNodeIds.values().next().value;
    if (first === undefined) continue;
    const visited = new Set([first]);
    const queue = [first];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      if (current === undefined) {
        throw new FoundryIntegrityError("INVALID_FLOOR_QUEUE", "Twin floor traversal encountered an invalid queue entry.");
      }
      for (const edge of manifest.edges) {
        const neighbour = edge.a === current ? edge.b : edge.b === current ? edge.a : null;
        if (neighbour !== null && floorNodeIds.has(neighbour) && !visited.has(neighbour)) {
          visited.add(neighbour);
          queue.push(neighbour);
        }
      }
    }
    if (visited.size !== floorNodeIds.size) {
      throw new FoundryIntegrityError("DISCONNECTED_TWIN_FLOOR", `Twin floor ${String(floor)} navigation graph is disconnected.`);
    }
  }
}

export function expectedTwinWebpDimensions(path: string, manifest: TwinManifest): { readonly width: number; readonly height: number } {
  if (manifest.imagery === "equirect") {
    const match = /\/equirect_(512|4096|8192)\.webp$/u.exec(path);
    if (match === null) throw new FoundryIntegrityError("UNEXPECTED_WEBP_PATH", `Unexpected equirect WebP path: ${path}`);
    const width = Number(match[1]);
    return { width, height: width / 2 };
  }
  const match = /\/(?:front|back|left|right|up|down)_(256|1024)\.webp$/u.exec(path);
  if (match === null) throw new FoundryIntegrityError("UNEXPECTED_WEBP_PATH", `Unexpected cube-face WebP path: ${path}`);
  const size = Number(match[1]);
  return { width: size, height: size };
}

function assertDimensions(path: string, expected: { readonly width: number; readonly height: number }, actual: WebpDimensions): void {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new FoundryIntegrityError(
      "WEBP_DIMENSION_MISMATCH",
      `WebP ${path} is ${String(actual.width)}×${String(actual.height)}; expected ${String(expected.width)}×${String(expected.height)}.`,
    );
  }
}

export function createVerifiedTwinBundleQaResult(input: {
  readonly manifest: TwinManifest;
  readonly inventory: FoundryBundleInventory;
  readonly webpFilesChecked: number;
  readonly mesh: GlbInspection | null;
}): TwinBundleQaResult {
  const expected = expectedTwinContentPaths(input.manifest);
  return {
    ...input,
    checks: [
      { id: "manifest_schema", status: "passed", evidence: `${input.manifest.schema}:${input.manifest.venueSlug}` },
      { id: "exact_file_set", status: "passed", evidence: `${String(input.inventory.files.length)} files` },
      { id: "content_hashes", status: "passed", evidence: `${String(expected.length)} content hashes` },
      { id: "graph_integrity", status: "passed", evidence: `${String(input.manifest.nodes.length)} nodes / ${String(input.manifest.edges.length)} edges` },
      { id: "floor_integrity", status: "passed", evidence: `${String(new Set(input.manifest.nodes.map((node) => node.floor)).size)} floors` },
      { id: "webp_integrity", status: "passed", evidence: `${String(input.webpFilesChecked)} complete WebP pixel streams decoded at declared dimensions` },
      { id: "glb_integrity", status: "passed", evidence: input.mesh === null
        ? "No mesh declared"
        : `${String(input.mesh.meshCount)} meshes / ${String(input.mesh.primitiveCount)} primitives / ${String(input.mesh.vertexCount)} vertices / ${String(input.mesh.triangleCount)} triangles` },
    ],
  };
}

export async function inspectTwinBundle(root: string): Promise<TwinBundleQaResult> {
  const inventory = await inventoryTwinBundle(root);
  const manifestFile = inventoryFile(inventory, "manifest.json");
  if (manifestFile.sizeBytes > MAX_MANIFEST_BYTES) {
    throw new FoundryIntegrityError("MANIFEST_TOO_LARGE", "Twin manifest exceeds the Foundry size limit.");
  }
  const manifestText = await readFile(resolveBundlePath(inventory.root, "manifest.json"), "utf8");
  const manifest = parseTwinManifestText(manifestText);
  assertTwinExactFileSet(manifest, inventory.files);
  assertTwinContentHashes(manifest, inventory.files);
  assertTwinGraphIntegrity(manifest);
  assertTwinFloorIntegrity(manifest);

  let webpFilesChecked = 0;
  for (const file of inventory.files) {
    if (file.mediaKind !== "webp") continue;
    const dimensions = await inspectWebp(resolveBundlePath(inventory.root, file.path), file.sizeBytes);
    assertDimensions(file.path, expectedTwinWebpDimensions(file.path, manifest), dimensions);
    webpFilesChecked += 1;
  }

  let mesh: GlbInspection | null = null;
  if (manifest.mesh !== undefined) {
    const meshFile = inventoryFile(inventory, manifest.mesh.path);
    if (meshFile.sizeBytes !== manifest.mesh.bytes) {
      throw new FoundryIntegrityError("GLB_MANIFEST_SIZE_MISMATCH", "Twin manifest mesh byte count does not match inventory.");
    }
    mesh = await inspectGlb(resolveBundlePath(inventory.root, manifest.mesh.path), meshFile.sizeBytes);
  }

  return createVerifiedTwinBundleQaResult({
    manifest,
    inventory,
    webpFilesChecked,
    mesh,
  });
}
