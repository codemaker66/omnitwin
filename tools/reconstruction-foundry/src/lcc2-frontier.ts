import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  domainSeparatedSha256,
  sha256RegularFileWithHead,
  toCanonicalJson,
  type ExpectedRegularFileIdentity,
} from "@omnitwin/reconstruction-foundry";
import {
  Lcc2ContainerValidationError,
  validateLcc2Container,
} from "./lcc2-container-validation.js";

export const LCC2_HIGHEST_DETAIL_FRONTIER_RECEIPT_V0 =
  "omnitwin.reconstruction-foundry/lcc2-highest-detail-frontier-receipt/v0";

const RECEIPT_DIGEST_DOMAIN = "OMNITWIN_LCC2_HIGHEST_DETAIL_FRONTIER_RECEIPT_V0";
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_JSON_DEPTH = 128;
const MAX_LEVELS = 64;
const MAX_SPLAT_FILES = 100_000;
const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;

export type Lcc2EnvironmentPolicy = "exclude" | "include";

export type Lcc2FrontierErrorCode =
  | "LCC2_ARGUMENT_INVALID"
  | "LCC2_ENVIRONMENT_POLICY_REQUIRED"
  | "LCC2_MANIFEST_PATH_NOT_ABSOLUTE"
  | "LCC2_REMOTE_OR_DEVICE_PATH"
  | "LCC2_MANIFEST_UNAVAILABLE"
  | "LCC2_MANIFEST_INDIRECT"
  | "LCC2_MANIFEST_NON_REGULAR"
  | "LCC2_FILE_MISSING"
  | "LCC2_FILE_INDIRECT"
  | "LCC2_FILE_NON_REGULAR"
  | "LCC2_FILE_HARDLINKED"
  | "LCC2_SOURCE_CHANGED"
  | "LCC2_CONTAINER_INVALID"
  | "LCC2_CONTAINER_UNSUPPORTED"
  | "LCC2_EMBEDDED_COUNT_MISMATCH"
  | "LCC2_MANIFEST_TOO_LARGE"
  | "LCC2_JSON_ENCODING_INVALID"
  | "LCC2_JSON_LEXICAL_INVALID"
  | "LCC2_JSON_INVALID"
  | "LCC2_SCHEMA_INVALID"
  | "LCC2_PATH_UNSAFE"
  | "LCC2_TREE_INVALID"
  | "LCC2_ENVIRONMENT_INVALID"
  | "LCC2_COUNT_MISMATCH"
  | "LCC2_RANGE_INVALID";

export class Lcc2FrontierError extends Error {
  public readonly code: Lcc2FrontierErrorCode;

  public constructor(code: Lcc2FrontierErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "Lcc2FrontierError";
    this.code = code;
  }
}

export interface Lcc2FrontierMemberPlanV0 {
  readonly fileIndex: number;
  readonly relativePath: string;
  readonly depth: number;
  readonly nodeIds: readonly string[];
  readonly nodeCount: number;
  readonly gaussianCount: number;
}

export interface Lcc2HighestDetailFrontierPlanV0 {
  readonly schemaVersion: typeof LCC2_HIGHEST_DETAIL_FRONTIER_RECEIPT_V0;
  readonly source: {
    readonly lcc2Version: "0.0.3";
    readonly guid: string;
    readonly fileType: string;
    readonly splatType: ".sog" | ".spz";
    readonly totalLevels: number;
    readonly totalSplatsAcrossAlternatives: number;
    readonly lodSplatsHighestToLowest: readonly number[];
  };
  readonly selection: {
    readonly policy: "authoritative_leaf_nodes_v1";
    readonly depth: number;
    readonly nodeCount: number;
    readonly gaussianCount: number;
    readonly members: readonly Lcc2FrontierMemberPlanV0[];
  };
  readonly ancestorAlternatives: readonly Lcc2FrontierMemberPlanV0[];
  readonly environment: {
    readonly policy: Lcc2EnvironmentPolicy;
    readonly fileIndex: number;
    readonly relativePath: string;
    readonly gaussianCount: number;
  };
  readonly declaredSplatFiles: readonly string[];
  readonly proof: {
    readonly sourceOfTruth: "root.child[].data.3dgs";
    readonly everyLeafAtHighestDepth: true;
    readonly everyDeclaredNonEnvironmentFileReferenced: true;
    readonly everyFileUsedByExactlyOneDepth: true;
    readonly everyFileRangeContiguousAndNonOverlapping: true;
    readonly everyLevelMatchesPublishedLodCount: true;
    readonly parentAndChildFilesAreAlternatives: true;
    readonly levels: readonly {
      readonly depth: number;
      readonly nodeCount: number;
      readonly fileCount: number;
      readonly gaussianCount: number;
    }[];
  };
}

export interface Lcc2HashedMemberV0 extends Lcc2FrontierMemberPlanV0 {
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface Lcc2HighestDetailFrontierReceiptV0 {
  readonly schemaVersion: typeof LCC2_HIGHEST_DETAIL_FRONTIER_RECEIPT_V0;
  readonly sourceManifest: {
    readonly fileName: string;
    readonly sizeBytes: number;
    readonly sha256: string;
  };
  readonly source: Lcc2HighestDetailFrontierPlanV0["source"];
  readonly selection: {
    readonly policy: "authoritative_leaf_nodes_v1";
    readonly depth: number;
    readonly nodeCount: number;
    readonly gaussianCount: number;
    readonly sizeBytes: number;
    readonly members: readonly Lcc2HashedMemberV0[];
  };
  readonly ancestorAlternatives: readonly Lcc2HashedMemberV0[];
  readonly environment: {
    readonly policy: Lcc2EnvironmentPolicy;
    readonly runtimeLoaded: boolean;
    readonly fileIndex: number;
    readonly relativePath: string;
    readonly gaussianCount: number;
    readonly sizeBytes: number;
    readonly sha256: string;
  };
  readonly runtime: {
    readonly memberPaths: readonly string[];
    readonly gaussianCount: number;
    readonly sizeBytes: number;
  };
  readonly proof: Lcc2HighestDetailFrontierPlanV0["proof"] & {
    readonly everyDeclaredSplatFilePresent: true;
    readonly noDeclaredSplatPathIsLinked: true;
    readonly everyDeclaredContainerValidated: true;
    readonly everyEmbeddedGaussianCountMatchesManifest: true;
    readonly allHashedFilesStable: true;
    readonly networkAccess: "none";
    readonly sourceWrites: "none";
  };
  readonly receiptSha256: string;
}

export interface InspectLcc2HighestDetailFrontierOptionsV0 {
  readonly manifestPath: string;
  readonly environmentPolicy: Lcc2EnvironmentPolicy;
  readonly signal?: AbortSignal;
  /** @internal Deterministic mutation hooks for focused tests. Production callers omit this. */
  readonly testHooks?: {
    readonly beforeHash?: (relativePath: string) => void | PromiseLike<void>;
  };
}

interface MutableFileUse {
  readonly fileIndex: number;
  readonly relativePath: string;
  readonly depth: number;
  readonly nodes: Array<{
    readonly id: string;
    readonly start: number;
    readonly count: number;
  }>;
}

interface LocatedFile {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly identity: ExpectedRegularFileIdentity;
}

function fail(code: Lcc2FrontierErrorCode, message: string, cause?: unknown): never {
  throw new Lcc2FrontierError(code, message, cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) fail("LCC2_SCHEMA_INVALID", `${label} must be an object.`);
  return value;
}

function textMember(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    return fail("LCC2_SCHEMA_INVALID", `${label} must be a non-empty string.`);
  }
  return value;
}

function integerMember(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < minimum) {
    return fail(
      "LCC2_SCHEMA_INVALID",
      `${label} must be a safe integer greater than or equal to ${String(minimum)}.`,
    );
  }
  return value;
}

function checkedSum(values: readonly number[], label: string): number {
  let sum = 0;
  for (const value of values) {
    sum += value;
    if (!Number.isSafeInteger(sum) || sum > SAFE_INTEGER_MAX) {
      return fail("LCC2_COUNT_MISMATCH", `${label} exceeds JavaScript's exact integer range.`);
    }
  }
  return sum;
}

function normalizeEnvironmentPolicy(value: unknown): Lcc2EnvironmentPolicy {
  if (value === undefined) {
    return fail(
      "LCC2_ENVIRONMENT_POLICY_REQUIRED",
      "Choose environmentPolicy \"include\" or \"exclude\"; the environment is never loaded implicitly.",
    );
  }
  if (value !== "include" && value !== "exclude") {
    return fail(
      "LCC2_ENVIRONMENT_POLICY_REQUIRED",
      "environmentPolicy must be exactly \"include\" or \"exclude\".",
    );
  }
  return value;
}

function assertSafeSplatPath(value: unknown, index: number, splatType: string): string {
  const path = textMember(value, `root.splatFiles[${String(index)}]`);
  if (
    path.length > 2048 ||
    path !== path.normalize("NFC") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    !path.startsWith("data/3dgs/") ||
    !path.endsWith(splatType)
  ) {
    return fail("LCC2_PATH_UNSAFE", `Unsafe or unexpected LCC2 splat path: ${path}`);
  }
  const parts = path.split("/");
  if (
    parts.some((part) => part === "" || part === "." || part === "..") ||
    parts.some((part) => /[<>:"|?*]/u.test(part))
  ) {
    return fail("LCC2_PATH_UNSAFE", `Unsafe LCC2 splat path: ${path}`);
  }
  return path;
}

function stableMember(use: MutableFileUse): Lcc2FrontierMemberPlanV0 {
  const nodes = [...use.nodes].sort((left, right) => left.start - right.start);
  let cursor = 0;
  for (const node of nodes) {
    if (node.start !== cursor) {
      return fail(
        "LCC2_RANGE_INVALID",
        `File ${use.relativePath} has a gap or overlap before node ${node.id}; expected start ${String(cursor)}, got ${String(node.start)}.`,
      );
    }
    cursor += node.count;
    if (!Number.isSafeInteger(cursor)) {
      return fail("LCC2_RANGE_INVALID", `File ${use.relativePath} has an unsafe aggregate count.`);
    }
  }
  return Object.freeze({
    fileIndex: use.fileIndex,
    relativePath: use.relativePath,
    depth: use.depth,
    nodeIds: Object.freeze(nodes.map((node) => node.id)),
    nodeCount: nodes.length,
    gaussianCount: cursor,
  });
}

/**
 * Compile the highest-detail, complete LCC2 frontier from the vendor tree.
 * Filenames are treated only as paths; depth and membership come from
 * `root.child[].data.3dgs`, where `name` indexes `root.splatFiles`.
 */
export function compileLcc2HighestDetailFrontier(
  input: unknown,
  options: { readonly environmentPolicy: Lcc2EnvironmentPolicy },
): Lcc2HighestDetailFrontierPlanV0 {
  const environmentPolicy = normalizeEnvironmentPolicy(options.environmentPolicy);
  const manifest = record(input, "LCC2 manifest");
  if (manifest.version !== "0.0.3") {
    return fail("LCC2_SCHEMA_INVALID", "Only the observed LCC2 version 0.0.3 is supported.");
  }
  const guid = textMember(manifest.guid, "guid");
  if (!/^[a-f0-9]{32}$/u.test(guid)) {
    return fail("LCC2_SCHEMA_INVALID", "guid must be 32 lowercase hexadecimal characters.");
  }
  const fileType = textMember(manifest.fileType, "fileType");
  const splatTypeValue = textMember(manifest.splatType, "splatType");
  if (splatTypeValue !== ".sog" && splatTypeValue !== ".spz") {
    return fail("LCC2_SCHEMA_INVALID", "splatType must be exactly .sog or .spz.");
  }
  const splatType: ".sog" | ".spz" = splatTypeValue;
  const totalLevels = integerMember(manifest.totalLevels, "totalLevels", 1);
  if (totalLevels > MAX_LEVELS) {
    return fail("LCC2_SCHEMA_INVALID", `totalLevels cannot exceed ${String(MAX_LEVELS)}.`);
  }
  if (!Array.isArray(manifest.lodSplats) || manifest.lodSplats.length !== totalLevels) {
    return fail("LCC2_SCHEMA_INVALID", "lodSplats must contain one count for every declared level.");
  }
  const lodSplats = manifest.lodSplats.map((value, index) =>
    integerMember(value, `lodSplats[${String(index)}]`, 1));
  const totalSplats = integerMember(manifest.totalSplats, "totalSplats", 1);
  if (checkedSum(lodSplats, "lodSplats") !== totalSplats) {
    return fail("LCC2_COUNT_MISMATCH", "totalSplats must equal the sum of all alternative LOD counts.");
  }

  const root = record(manifest.root, "root");
  if (root.id !== "0") return fail("LCC2_TREE_INVALID", "root.id must be exactly \"0\".");
  if (!Array.isArray(root.splatFiles) || root.splatFiles.length < 2 || root.splatFiles.length > MAX_SPLAT_FILES) {
    return fail("LCC2_SCHEMA_INVALID", "root.splatFiles must be a bounded array with at least one LOD file and one environment file.");
  }
  const splatFiles = root.splatFiles.map((value, index) =>
    assertSafeSplatPath(value, index, splatType));
  const foldedPaths = new Map<string, string>();
  for (const path of splatFiles) {
    const folded = path.toLocaleLowerCase("en-US");
    const collision = foldedPaths.get(folded);
    if (collision !== undefined) {
      return fail("LCC2_PATH_UNSAFE", `Duplicate or case-colliding splat paths: ${collision} and ${path}.`);
    }
    foldedPaths.set(folded, path);
  }

  const rootData = record(root.data, "root.data");
  if (rootData["3dgs"] !== undefined) {
    return fail("LCC2_TREE_INVALID", "The root cannot contain a 3dgs LOD range.");
  }
  const rootEnvironment = record(rootData.env, "root.data.env");
  const environmentFileIndex = integerMember(rootEnvironment.name, "root.data.env.name");
  const environmentPath = splatFiles[environmentFileIndex];
  if (environmentPath === undefined) {
    return fail("LCC2_ENVIRONMENT_INVALID", "root.data.env.name points outside root.splatFiles.");
  }
  const expectedEnvironmentPath = `data/3dgs/env${splatType}`;
  const environmentPaths = splatFiles.filter((path) => basename(path) === `env${splatType}`);
  if (environmentPath !== expectedEnvironmentPath || environmentPaths.length !== 1) {
    return fail(
      "LCC2_ENVIRONMENT_INVALID",
      `The environment must be the one explicit ${expectedEnvironmentPath} member referenced by root.data.env.name.`,
    );
  }
  const environment = record(manifest.env, "env");
  if (environment.type !== "splats") {
    return fail("LCC2_ENVIRONMENT_INVALID", "env.type must be exactly \"splats\".");
  }
  const environmentGaussianCount = integerMember(environment.splatsCount, "env.splatsCount", 1);

  const fileUses = new Map<number, MutableFileUse>();
  const nodeIds = new Set<string>();
  const levelNodeCounts = Array.from({ length: totalLevels }, () => 0);
  const levelGaussianCounts = Array.from({ length: totalLevels }, () => 0);
  let leafNodeCount = 0;

  const visit = (nodeInput: unknown, parentId: string | null, childKey: string | null, depth: number): void => {
    const node = record(nodeInput, parentId === null ? "root" : `node below ${parentId}`);
    const id = textMember(node.id, "node.id");
    const expectedId = parentId === null ? "0" : `${parentId}_${childKey ?? ""}`;
    if (id !== expectedId || nodeIds.has(id)) {
      return fail("LCC2_TREE_INVALID", `Node id ${id} does not match its unique tree position ${expectedId}.`);
    }
    nodeIds.add(id);
    const childNum = integerMember(node.childNum, `${id}.childNum`);
    const children = node.child === undefined ? {} : record(node.child, `${id}.child`);
    const childKeys = Object.keys(children);
    if (childKeys.length !== childNum) {
      return fail("LCC2_TREE_INVALID", `${id}.childNum does not match its child object.`);
    }
    for (let index = 0; index < childNum; index += 1) {
      if (!Object.hasOwn(children, String(index))) {
        return fail("LCC2_TREE_INVALID", `${id}.child must use contiguous numeric keys from 0.`);
      }
    }
    if (childKeys.some((key) => !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= childNum)) {
      return fail("LCC2_TREE_INVALID", `${id}.child contains an unexpected key.`);
    }

    if (depth === 0) {
      if (id !== "0") return fail("LCC2_TREE_INVALID", "The root tree node must be id 0.");
    } else {
      if (depth > totalLevels) {
        return fail("LCC2_TREE_INVALID", `${id} is deeper than totalLevels.`);
      }
      const data = record(node.data, `${id}.data`);
      const splat = record(data["3dgs"], `${id}.data.3dgs`);
      const fileIndex = integerMember(splat.name, `${id}.data.3dgs.name`);
      if (fileIndex === environmentFileIndex) {
        return fail("LCC2_ENVIRONMENT_INVALID", `Node ${id} incorrectly uses the environment file as a LOD member.`);
      }
      const relativePath = splatFiles[fileIndex];
      if (relativePath === undefined) {
        return fail("LCC2_TREE_INVALID", `${id}.data.3dgs.name points outside root.splatFiles.`);
      }
      const start = integerMember(splat.start, `${id}.data.3dgs.start`);
      const count = integerMember(splat.count, `${id}.data.3dgs.count`, 1);
      const existingUse = fileUses.get(fileIndex);
      if (existingUse !== undefined && existingUse.depth !== depth) {
        return fail("LCC2_TREE_INVALID", `${relativePath} is used by more than one LOD depth.`);
      }
      const use = existingUse ?? {
        fileIndex,
        relativePath,
        depth,
        nodes: [],
      };
      use.nodes.push({ id, start, count });
      fileUses.set(fileIndex, use);
      levelNodeCounts[depth - 1] = (levelNodeCounts[depth - 1] ?? 0) + 1;
      const nextLevelCount = (levelGaussianCounts[depth - 1] ?? 0) + count;
      if (!Number.isSafeInteger(nextLevelCount)) {
        return fail("LCC2_COUNT_MISMATCH", `Depth ${String(depth)} Gaussian count is unsafe.`);
      }
      levelGaussianCounts[depth - 1] = nextLevelCount;
      if (childNum === 0) {
        if (depth !== totalLevels) {
          return fail("LCC2_TREE_INVALID", `Leaf ${id} stops before the declared highest-detail depth.`);
        }
        leafNodeCount += 1;
      } else if (depth === totalLevels) {
        return fail("LCC2_TREE_INVALID", `Node ${id} continues beyond the declared highest-detail depth.`);
      }
    }

    for (let index = 0; index < childNum; index += 1) {
      visit(children[String(index)], id, String(index), depth + 1);
    }
  };
  visit(root, null, null, 0);

  if (leafNodeCount === 0) return fail("LCC2_TREE_INVALID", "The LCC2 tree has no highest-detail leaves.");
  for (let depth = 1; depth <= totalLevels; depth += 1) {
    const measured = levelGaussianCounts[depth - 1] ?? 0;
    const published = lodSplats[totalLevels - depth];
    if (published === undefined || measured !== published) {
      return fail(
        "LCC2_COUNT_MISMATCH",
        `Depth ${String(depth)} contains ${String(measured)} Gaussians, but lodSplats publishes ${String(published ?? 0)}.`,
      );
    }
  }
  for (const [fileIndex, path] of splatFiles.entries()) {
    if (fileIndex !== environmentFileIndex && !fileUses.has(fileIndex)) {
      return fail("LCC2_TREE_INVALID", `Declared non-environment splat file is not referenced by the tree: ${path}.`);
    }
  }

  const allMembers = [...fileUses.values()]
    .sort((left, right) => left.fileIndex - right.fileIndex)
    .map(stableMember);
  const frontierMembers = allMembers.filter((member) => member.depth === totalLevels);
  const ancestorAlternatives = allMembers.filter((member) => member.depth < totalLevels);
  const frontierGaussianCount = checkedSum(
    frontierMembers.map((member) => member.gaussianCount),
    "Highest-detail frontier",
  );
  if (frontierGaussianCount !== lodSplats[0]) {
    return fail("LCC2_COUNT_MISMATCH", "Highest-detail file ranges do not equal lodSplats[0].");
  }
  const levels = Array.from({ length: totalLevels }, (_, offset) => {
    const depth = offset + 1;
    return Object.freeze({
      depth,
      nodeCount: levelNodeCounts[offset] ?? 0,
      fileCount: allMembers.filter((member) => member.depth === depth).length,
      gaussianCount: levelGaussianCounts[offset] ?? 0,
    });
  });

  return Object.freeze({
    schemaVersion: LCC2_HIGHEST_DETAIL_FRONTIER_RECEIPT_V0,
    source: Object.freeze({
      lcc2Version: "0.0.3" as const,
      guid,
      fileType,
      splatType,
      totalLevels,
      totalSplatsAcrossAlternatives: totalSplats,
      lodSplatsHighestToLowest: Object.freeze(lodSplats),
    }),
    selection: Object.freeze({
      policy: "authoritative_leaf_nodes_v1" as const,
      depth: totalLevels,
      nodeCount: leafNodeCount,
      gaussianCount: frontierGaussianCount,
      members: Object.freeze(frontierMembers),
    }),
    ancestorAlternatives: Object.freeze(ancestorAlternatives),
    environment: Object.freeze({
      policy: environmentPolicy,
      fileIndex: environmentFileIndex,
      relativePath: environmentPath,
      gaussianCount: environmentGaussianCount,
    }),
    declaredSplatFiles: Object.freeze(splatFiles),
    proof: Object.freeze({
      sourceOfTruth: "root.child[].data.3dgs" as const,
      everyLeafAtHighestDepth: true as const,
      everyDeclaredNonEnvironmentFileReferenced: true as const,
      everyFileUsedByExactlyOneDepth: true as const,
      everyFileRangeContiguousAndNonOverlapping: true as const,
      everyLevelMatchesPublishedLodCount: true as const,
      parentAndChildFilesAreAlternatives: true as const,
      levels: Object.freeze(levels),
    }),
  });
}

function comparablePath(path: string): string {
  const normalized = resolve(path).replace(/^\\\\\?\\/u, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function pathIsWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(comparablePath(root), comparablePath(candidate));
  return fromRoot === "" || (
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

function identityFromStats(metadata: Stats): ExpectedRegularFileIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
  };
}

function sameIdentity(left: ExpectedRegularFileIdentity, right: ExpectedRegularFileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function errorCode(error: unknown): string | null {
  return isRecord(error) && typeof error.code === "string" ? error.code : null;
}

function mapContainerValidationError(error: Lcc2ContainerValidationError): never {
  switch (error.code) {
    case "cancelled":
      return fail("LCC2_ARGUMENT_INVALID", error.message, error);
    case "count_mismatch":
      return fail("LCC2_EMBEDDED_COUNT_MISMATCH", error.message, error);
    case "invalid":
      return fail("LCC2_CONTAINER_INVALID", error.message, error);
    case "source_changed":
      return fail("LCC2_SOURCE_CHANGED", error.message, error);
    case "unsupported":
      return fail("LCC2_CONTAINER_UNSUPPORTED", error.message, error);
  }
}

function mapHashError(error: unknown, relativePath: string): never {
  const code = errorCode(error);
  if (code === "HASH_CANCELLED") {
    return fail("LCC2_ARGUMENT_INVALID", `Hashing was cancelled for ${relativePath}.`, error);
  }
  return fail("LCC2_SOURCE_CHANGED", `Declared LCC2 file changed or became unreadable while hashing: ${relativePath}.`, error);
}

function deepFreeze<T>(value: T, seen = new WeakSet()): T {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const key of Reflect.ownKeys(object)) {
    deepFreeze(Reflect.get(object, key), seen);
  }
  return Object.freeze(value);
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    return fail("LCC2_ARGUMENT_INVALID", "The read-only LCC2 inspection was cancelled.");
  }
}

async function locateManifest(pathInput: string): Promise<LocatedFile> {
  if (typeof pathInput !== "string" || pathInput.length === 0 || pathInput.includes("\0")) {
    return fail("LCC2_ARGUMENT_INVALID", "manifestPath must be a non-empty local path.");
  }
  if (!isAbsolute(pathInput)) {
    return fail("LCC2_MANIFEST_PATH_NOT_ABSOLUTE", "manifestPath must be absolute.");
  }
  if (process.platform === "win32" && pathInput.replaceAll("/", "\\").startsWith("\\\\")) {
    return fail("LCC2_REMOTE_OR_DEVICE_PATH", "UNC and Windows device paths are outside this local trust boundary.");
  }
  const requested = resolve(pathInput);
  try {
    const before = await lstat(requested);
    if (before.isSymbolicLink()) {
      return fail("LCC2_MANIFEST_INDIRECT", "The LCC2 manifest cannot be a symbolic link or junction.");
    }
    if (!before.isFile()) {
      return fail("LCC2_MANIFEST_NON_REGULAR", "The LCC2 manifest must be a regular file.");
    }
    if (before.nlink !== 1) {
      return fail("LCC2_FILE_HARDLINKED", "The LCC2 manifest cannot have additional hard links.");
    }
    const canonical = await realpath(requested);
    const canonicalMetadata = await lstat(canonical);
    const after = await lstat(requested);
    if (
      comparablePath(canonical) !== comparablePath(requested) ||
      canonicalMetadata.isSymbolicLink() ||
      after.isSymbolicLink()
    ) {
      return fail("LCC2_MANIFEST_INDIRECT", "The LCC2 manifest path cannot pass through a symbolic link or junction.");
    }
    const identity = identityFromStats(after);
    if (!sameIdentity(identityFromStats(before), identity) || !sameIdentity(identity, identityFromStats(canonicalMetadata))) {
      return fail("LCC2_SOURCE_CHANGED", "The LCC2 manifest changed during discovery.");
    }
    return { absolutePath: canonical, relativePath: basename(canonical), identity };
  } catch (error: unknown) {
    if (error instanceof Lcc2FrontierError) throw error;
    return fail("LCC2_MANIFEST_UNAVAILABLE", "The LCC2 manifest is unavailable.", error);
  }
}

async function readStableManifest(file: LocatedFile, signal: AbortSignal | undefined): Promise<Buffer> {
  if (file.identity.size > MAX_MANIFEST_BYTES) {
    return fail("LCC2_MANIFEST_TOO_LARGE", `The LCC2 manifest exceeds ${String(MAX_MANIFEST_BYTES)} bytes.`);
  }
  assertNotCancelled(signal);
  const handle = await open(file.absolutePath, "r");
  try {
    const before = identityFromStats(await handle.stat());
    if (!sameIdentity(before, file.identity)) {
      return fail("LCC2_SOURCE_CHANGED", "The LCC2 manifest changed before it was read.");
    }
    const bytes = await handle.readFile();
    assertNotCancelled(signal);
    const after = identityFromStats(await handle.stat());
    const pathAfter = await lstat(file.absolutePath);
    if (
      !sameIdentity(before, after) ||
      !sameIdentity(after, identityFromStats(pathAfter)) ||
      pathAfter.isSymbolicLink() ||
      bytes.length !== after.size
    ) {
      return fail("LCC2_SOURCE_CHANGED", "The LCC2 manifest changed while it was being read.");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function decodeAndValidateJson(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return fail("LCC2_JSON_ENCODING_INVALID", "The LCC2 manifest must not contain a UTF-8 byte-order mark.");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error: unknown) {
    return fail("LCC2_JSON_ENCODING_INVALID", "The LCC2 manifest must be valid UTF-8.", error);
  }
  let index = 0;
  const whitespace = (character: string | undefined): boolean =>
    character === " " || character === "\t" || character === "\n" || character === "\r";
  const skipWhitespace = (): void => {
    while (index < text.length && whitespace(text[index])) index += 1;
  };
  const lexicalFail = (message: string): never =>
    fail("LCC2_JSON_LEXICAL_INVALID", `${message} at character ${String(index)}.`);
  const parseString = (): string => {
    if (text[index] !== '"') return lexicalFail("Invalid JSON string token");
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        try {
          const parsed: unknown = JSON.parse(text.slice(start, index));
          return typeof parsed === "string" ? parsed : lexicalFail("Invalid JSON string value");
        } catch (error: unknown) {
          if (error instanceof Lcc2FrontierError) throw error;
          return lexicalFail("Invalid escaped JSON string");
        }
      }
      if (character === "\\") {
        index += 1;
        const escape = text[index];
        if (escape === "u") {
          if (!/^[a-fA-F0-9]{4}$/u.test(text.slice(index + 1, index + 5))) {
            return lexicalFail("Invalid JSON unicode escape");
          }
          index += 5;
          continue;
        }
        if (escape === undefined || !/^["\\/bfnrt]$/u.test(escape)) {
          return lexicalFail("Invalid JSON escape");
        }
        index += 1;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        return lexicalFail("Unescaped JSON control character");
      }
      index += 1;
    }
    return lexicalFail("Unterminated JSON string");
  };
  const parseNumber = (): void => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(index));
    if (match === null) return lexicalFail("Invalid JSON number");
    index += match[0].length;
  };
  const prohibitedKeys = new Set(["__proto__", "constructor", "prototype"]);
  const parseValue = (depth: number): void => {
    if (depth > MAX_JSON_DEPTH) return lexicalFail("JSON nesting is too deep");
    skipWhitespace();
    const character = text[index];
    if (character === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      for (;;) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) return lexicalFail(`Duplicate JSON object key ${JSON.stringify(key)}`);
        if (prohibitedKeys.has(key)) return lexicalFail(`Prohibited JSON object key ${JSON.stringify(key)}`);
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ":") return lexicalFail("Missing colon after JSON object key");
        index += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return;
        }
        if (text[index] !== ",") return lexicalFail("Missing comma between JSON object members");
        index += 1;
      }
    }
    if (character === "[") {
      index += 1;
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      for (;;) {
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return;
        }
        if (text[index] !== ",") return lexicalFail("Missing comma between JSON array elements");
        index += 1;
      }
    }
    if (character === '"') {
      parseString();
      return;
    }
    if (character === "-" || (character !== undefined && /^[0-9]$/u.test(character))) {
      parseNumber();
      return;
    }
    for (const literal of ["true", "false", "null"] as const) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    return lexicalFail("Invalid JSON value");
  };
  parseValue(0);
  skipWhitespace();
  if (index !== text.length) return lexicalFail("Trailing JSON data");
  return text;
}

function parseManifestBytes(bytes: Buffer): unknown {
  try {
    return JSON.parse(decodeAndValidateJson(bytes)) as unknown;
  } catch (error: unknown) {
    if (error instanceof Lcc2FrontierError) throw error;
    return fail("LCC2_JSON_INVALID", "The LCC2 manifest is not valid JSON.", error);
  }
}

async function locateDeclaredFile(root: string, relativePath: string): Promise<LocatedFile> {
  let cursor = root;
  const parts = relativePath.split("/");
  for (const [index, part] of parts.entries()) {
    cursor = resolve(cursor, part);
    let metadata: Stats;
    try {
      metadata = await lstat(cursor);
    } catch (error: unknown) {
      if (errorCode(error) === "ENOENT") {
        return fail("LCC2_FILE_MISSING", `Declared LCC2 file is missing: ${relativePath}.`);
      }
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      return fail("LCC2_FILE_INDIRECT", `Declared LCC2 path is linked: ${relativePath}.`);
    }
    const final = index === parts.length - 1;
    if ((!final && !metadata.isDirectory()) || (final && !metadata.isFile())) {
      return fail("LCC2_FILE_NON_REGULAR", `Declared LCC2 path has the wrong filesystem type: ${relativePath}.`);
    }
    if (final && metadata.nlink !== 1) {
      return fail("LCC2_FILE_HARDLINKED", `Declared LCC2 file has additional hard links: ${relativePath}.`);
    }
  }
  const canonical = await realpath(cursor);
  if (comparablePath(canonical) !== comparablePath(cursor) || !pathIsWithin(root, canonical)) {
    return fail("LCC2_FILE_INDIRECT", `Declared LCC2 path resolves indirectly or escapes the package: ${relativePath}.`);
  }
  const metadata = await lstat(canonical);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    return fail("LCC2_FILE_NON_REGULAR", `Declared LCC2 path is not a regular file: ${relativePath}.`);
  }
  return { absolutePath: canonical, relativePath, identity: identityFromStats(metadata) };
}

async function assertFilesUnchanged(files: readonly LocatedFile[]): Promise<void> {
  for (const file of files) {
    let current: Stats;
    try {
      current = await lstat(file.absolutePath);
    } catch (error: unknown) {
      return fail("LCC2_SOURCE_CHANGED", `Declared LCC2 file disappeared: ${file.relativePath}.`, error);
    }
    if (
      current.isSymbolicLink() ||
      !current.isFile() ||
      current.nlink !== 1 ||
      !sameIdentity(file.identity, identityFromStats(current))
    ) {
      return fail("LCC2_SOURCE_CHANGED", `Declared LCC2 file changed during inspection: ${file.relativePath}.`);
    }
  }
}

function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Read-only worker: validates the manifest and every declared splat path, then
 * hashes only the selected leaf files plus the explicitly handled environment.
 * It does not copy, rewrite, upload, render, register, or publish any file.
 */
export async function inspectLcc2HighestDetailFrontier(
  options: InspectLcc2HighestDetailFrontierOptionsV0,
): Promise<Lcc2HighestDetailFrontierReceiptV0> {
  const environmentPolicy = normalizeEnvironmentPolicy(options.environmentPolicy);
  assertNotCancelled(options.signal);
  const manifestFile = await locateManifest(options.manifestPath);
  const manifestBytes = await readStableManifest(manifestFile, options.signal);
  const plan = compileLcc2HighestDetailFrontier(parseManifestBytes(manifestBytes), {
    environmentPolicy,
  });
  const packageRoot = dirname(manifestFile.absolutePath);
  const declaredFiles: LocatedFile[] = [];
  for (const relativePath of plan.declaredSplatFiles) {
    assertNotCancelled(options.signal);
    declaredFiles.push(await locateDeclaredFile(packageRoot, relativePath));
  }
  const filesByPath = new Map(declaredFiles.map((file) => [file.relativePath, file] as const));
  const declaredCountByPath = new Map([
    ...plan.selection.members.map((member) => [member.relativePath, member.gaussianCount] as const),
    ...plan.ancestorAlternatives.map((member) => [member.relativePath, member.gaussianCount] as const),
    [plan.environment.relativePath, plan.environment.gaussianCount] as const,
  ]);
  for (const file of declaredFiles) {
    assertNotCancelled(options.signal);
    const expectedGaussianCount = declaredCountByPath.get(file.relativePath);
    if (expectedGaussianCount === undefined) {
      return fail("LCC2_COUNT_MISMATCH", `No manifest count was compiled for ${file.relativePath}.`);
    }
    try {
      await validateLcc2Container({
        absolutePath: file.absolutePath,
        relativePath: file.relativePath,
        expectedIdentity: file.identity,
        expectedGaussianCount,
        splatType: plan.source.splatType,
        signal: options.signal,
      });
    } catch (error: unknown) {
      if (error instanceof Lcc2ContainerValidationError) mapContainerValidationError(error);
      return fail("LCC2_CONTAINER_INVALID", `Container validation failed for ${file.relativePath}.`, error);
    }
  }
  // Hash every container whose validation contributes to the receipt proof.
  // Otherwise altered ancestor bytes could produce the same receipt while it
  // still claimed that every declared container had been validated.
  const pathsToHash = plan.declaredSplatFiles;
  const digestByPath = new Map<string, { readonly sizeBytes: number; readonly sha256: string }>();
  for (const relativePath of pathsToHash) {
    assertNotCancelled(options.signal);
    const file = filesByPath.get(relativePath);
    if (file === undefined) {
      return fail("LCC2_FILE_MISSING", `Selected LCC2 file is missing: ${relativePath}.`);
    }
    await options.testHooks?.beforeHash?.(relativePath);
    let digest: Awaited<ReturnType<typeof sha256RegularFileWithHead>>;
    try {
      digest = await sha256RegularFileWithHead(
        file.absolutePath,
        0,
        file.identity,
        options.signal,
      );
    } catch (error: unknown) {
      mapHashError(error, relativePath);
    }
    digestByPath.set(relativePath, { sizeBytes: digest.sizeBytes, sha256: digest.sha256 });
  }
  await assertFilesUnchanged(declaredFiles);
  await assertFilesUnchanged([manifestFile]);

  const selectedMembers = plan.selection.members.map((member): Lcc2HashedMemberV0 => {
    const digest = digestByPath.get(member.relativePath);
    if (digest === undefined) return fail("LCC2_FILE_MISSING", `No digest was produced for ${member.relativePath}.`);
    return Object.freeze({
      ...member,
      sizeBytes: digest.sizeBytes,
      sha256: `sha256:${digest.sha256}`,
    });
  });
  const ancestorAlternatives = plan.ancestorAlternatives.map((member): Lcc2HashedMemberV0 => {
    const digest = digestByPath.get(member.relativePath);
    if (digest === undefined) return fail("LCC2_FILE_MISSING", `No digest was produced for ${member.relativePath}.`);
    return Object.freeze({
      ...member,
      sizeBytes: digest.sizeBytes,
      sha256: `sha256:${digest.sha256}`,
    });
  });
  const selectedBytes = checkedSum(selectedMembers.map((member) => member.sizeBytes), "Selected frontier bytes");
  const environmentDigest = digestByPath.get(plan.environment.relativePath);
  if (environmentDigest === undefined) {
    return fail("LCC2_FILE_MISSING", "No digest was produced for the explicit environment file.");
  }
  const environmentLoaded = environmentPolicy === "include";
  const runtimePaths = [
    ...selectedMembers.map((member) => member.relativePath),
    ...(environmentLoaded ? [plan.environment.relativePath] : []),
  ];
  const runtimeGaussianCount = plan.selection.gaussianCount +
    (environmentLoaded ? plan.environment.gaussianCount : 0);
  const runtimeBytes = selectedBytes + (environmentLoaded ? environmentDigest.sizeBytes : 0);
  if (!Number.isSafeInteger(runtimeGaussianCount) || !Number.isSafeInteger(runtimeBytes)) {
    return fail("LCC2_COUNT_MISMATCH", "Runtime totals exceed JavaScript's exact integer range.");
  }

  const material: Omit<Lcc2HighestDetailFrontierReceiptV0, "receiptSha256"> = {
    schemaVersion: LCC2_HIGHEST_DETAIL_FRONTIER_RECEIPT_V0,
    sourceManifest: {
      fileName: manifestFile.relativePath,
      sizeBytes: manifestBytes.length,
      sha256: `sha256:${rawSha256(manifestBytes)}`,
    },
    source: plan.source,
    selection: {
      policy: plan.selection.policy,
      depth: plan.selection.depth,
      nodeCount: plan.selection.nodeCount,
      gaussianCount: plan.selection.gaussianCount,
      sizeBytes: selectedBytes,
      members: selectedMembers,
    },
    ancestorAlternatives,
    environment: {
      policy: environmentPolicy,
      runtimeLoaded: environmentLoaded,
      fileIndex: plan.environment.fileIndex,
      relativePath: plan.environment.relativePath,
      gaussianCount: plan.environment.gaussianCount,
      sizeBytes: environmentDigest.sizeBytes,
      sha256: `sha256:${environmentDigest.sha256}`,
    },
    runtime: {
      memberPaths: runtimePaths,
      gaussianCount: runtimeGaussianCount,
      sizeBytes: runtimeBytes,
    },
    proof: {
      ...plan.proof,
      everyDeclaredSplatFilePresent: true as const,
      noDeclaredSplatPathIsLinked: true as const,
      everyDeclaredContainerValidated: true as const,
      everyEmbeddedGaussianCountMatchesManifest: true as const,
      allHashedFilesStable: true as const,
      networkAccess: "none" as const,
      sourceWrites: "none" as const,
    },
  };
  const frozenMaterial = deepFreeze(material);
  return deepFreeze({
    ...frozenMaterial,
    receiptSha256: `sha256:${domainSeparatedSha256(RECEIPT_DIGEST_DOMAIN, toCanonicalJson(frozenMaterial))}`,
  });
}
