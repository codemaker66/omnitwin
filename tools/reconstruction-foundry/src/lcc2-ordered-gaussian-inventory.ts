import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  domainSeparatedSha256,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  inspectOrderedSogMember,
  LCC2_ORDERED_SOG_MAX_GAUSSIANS_PER_MEMBER,
  LCC2_ORDERED_SOG_MAX_IMAGE_PIXELS,
  LCC2_ORDERED_SOG_MAX_RETAINED_DECODED_BYTES,
  LCC2_ORDERED_SOG_MAX_SNAPSHOT_BYTES,
  type OrderedSogMemberInventoryV1,
} from "./lcc2-container-validation.js";
import {
  inspectLcc2HighestDetailFrontier,
  type Lcc2HashedMemberV0,
  type Lcc2HighestDetailFrontierReceiptV0,
} from "./lcc2-frontier.js";

export const LCC2_ORDERED_GAUSSIAN_INVENTORY_RECEIPT_V1 =
  "omnitwin.reconstruction-foundry/lcc2-ordered-gaussian-inventory-receipt/v1";

const RECEIPT_DIGEST_DOMAIN = "OMNITWIN_LCC2_ORDERED_GAUSSIAN_INVENTORY_RECEIPT_V1";
const ORDINAL_DIGEST_DOMAIN = "OMNITWIN_LCC2_ORDERED_GAUSSIAN_INVENTORY_V1";

export type Lcc2OrderedGaussianInventoryErrorCode =
  | "LCC2_ORDERED_ARGUMENT_INVALID"
  | "LCC2_ORDERED_NON_SOG_SOURCE"
  | "LCC2_ORDERED_PATH_ESCAPE"
  | "LCC2_ORDERED_SOURCE_CHANGED"
  | "LCC2_ORDERED_TRAVERSAL_INVALID";

export class Lcc2OrderedGaussianInventoryError extends Error {
  public readonly code: Lcc2OrderedGaussianInventoryErrorCode;

  public constructor(
    code: Lcc2OrderedGaussianInventoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "Lcc2OrderedGaussianInventoryError";
    this.code = code;
  }
}

export interface Lcc2OrderedGaussianMemberV1 extends OrderedSogMemberInventoryV1 {
  readonly fileIndex: number;
  readonly depth: number;
  readonly nodeIds: readonly string[];
  readonly nodeCount: number;
  readonly globalStart: number;
  readonly globalEndExclusive: number;
}

export interface Lcc2OrderedGaussianInventoryReceiptV1 {
  readonly schemaVersion: typeof LCC2_ORDERED_GAUSSIAN_INVENTORY_RECEIPT_V1;
  readonly sourceFrontier: {
    readonly receiptSha256: string;
    readonly manifestFileName: string;
    readonly manifestSizeBytes: number;
    readonly manifestSha256: string;
    readonly lcc2Guid: string;
    readonly splatType: ".sog";
    readonly frontierDepth: number;
    readonly frontierNodeCount: number;
    readonly frontierSizeBytes: number;
  };
  readonly inventory: {
    readonly memberTraversalPolicy: "lcc2_frontier_file_index_ascending_v1";
    readonly localOrdinalPolicy: "sog_row_major_top_left_meta_count_v1";
    readonly gaussianCount: number;
    readonly memberCount: number;
    readonly members: readonly Lcc2OrderedGaussianMemberV1[];
    readonly ordinalInventorySha256: string;
  };
  readonly proof: {
    readonly sourceFrontierStableAcrossInspection: true;
    readonly environmentPolicy: "exclude";
    readonly environmentIncludedInOrdinalInventory: false;
    readonly everyMemberExactSha256Matched: true;
    readonly everyPropertyPlaneUsesLosslessVp8lCodec: true;
    readonly everyLocalOrdinalContiguous: true;
    readonly everyGlobalOrdinalContiguous: true;
    readonly coordinatesDequantized: false;
    readonly coordinateFrameEstablished: false;
    readonly roomMembershipEstablished: false;
    readonly maskProduced: false;
    readonly transformProduced: false;
    readonly generatedContentAddedByInspection: false;
    readonly immutableSha256BoundMemberSnapshotsUsed: true;
    readonly authority: "none";
    readonly applicationNetworkRequests: "none";
    readonly storageTransportAssessment: "not_established";
    readonly sourceWrites: "none";
  };
  readonly inspectionLimits: {
    readonly maximumGaussiansPerMember: number;
    readonly maximumImagePixels: number;
    readonly maximumRetainedDecodedBytesPerMember: number;
    readonly maximumSnapshotBytesPerMember: number;
  };
  readonly receiptSha256: string;
}

export interface InspectLcc2OrderedGaussianInventoryOptionsV1 {
  readonly manifestPath: string;
  readonly signal?: AbortSignal;
  /** @internal Deterministic hooks for focused source-race tests. */
  readonly testHooks?: {
    readonly beforeMember?: (
      member: Lcc2HashedMemberV0,
      memberIndex: number,
    ) => void | PromiseLike<void>;
    readonly beforeFinalFrontierInspection?: () => void | PromiseLike<void>;
  };
}

function fail(
  code: Lcc2OrderedGaussianInventoryErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new Lcc2OrderedGaussianInventoryError(code, message, cause);
}

function deepFreeze<T>(value: T, seen = new WeakSet()): T {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(object)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function absoluteMemberPath(manifestPath: string, memberPath: string): string {
  const root = dirname(resolve(manifestPath));
  const candidate = resolve(root, ...memberPath.split("/"));
  const displacement = relative(root, candidate);
  if (
    displacement === "" ||
    isAbsolute(displacement) ||
    displacement === ".." ||
    displacement.startsWith("../") ||
    displacement.startsWith("..\\")
  ) {
    return fail("LCC2_ORDERED_PATH_ESCAPE", `LCC2 ordered member path escapes its package: ${memberPath}.`);
  }
  return candidate;
}

function assertAscendingTraversal(
  members: readonly Lcc2HashedMemberV0[],
  expectedGaussianCount: number,
): void {
  let previousFileIndex = -1;
  let total = 0;
  const paths = new Set<string>();
  for (const member of members) {
    if (
      member.fileIndex <= previousFileIndex ||
      paths.has(member.relativePath) ||
      !Number.isSafeInteger(member.gaussianCount) ||
      member.gaussianCount < 1
    ) {
      return fail(
        "LCC2_ORDERED_TRAVERSAL_INVALID",
        "LCC2 frontier members do not form a unique ascending file-index traversal.",
      );
    }
    previousFileIndex = member.fileIndex;
    paths.add(member.relativePath);
    total += member.gaussianCount;
    if (!Number.isSafeInteger(total)) {
      return fail("LCC2_ORDERED_TRAVERSAL_INVALID", "LCC2 ordered Gaussian total exceeds the exact integer range.");
    }
  }
  if (members.length === 0 || total !== expectedGaussianCount) {
    return fail("LCC2_ORDERED_TRAVERSAL_INVALID", "LCC2 ordered member counts do not match the frontier total.");
  }
}

function sameFrontier(
  before: Lcc2HighestDetailFrontierReceiptV0,
  after: Lcc2HighestDetailFrontierReceiptV0,
): boolean {
  return before.receiptSha256 === after.receiptSha256;
}

/**
 * Builds a read-only, authority-none ordinal inventory for an exact SOG LCC2
 * highest-detail frontier. It intentionally does not dequantize positions,
 * choose a room, create a mask, or establish a transform.
 */
export async function inspectLcc2OrderedGaussianInventory(
  options: InspectLcc2OrderedGaussianInventoryOptionsV1,
): Promise<Lcc2OrderedGaussianInventoryReceiptV1> {
  if (typeof options.manifestPath !== "string" || !isAbsolute(options.manifestPath)) {
    return fail("LCC2_ORDERED_ARGUMENT_INVALID", "Ordered LCC2 inspection requires an absolute manifest path.");
  }
  const initial = await inspectLcc2HighestDetailFrontier({
    manifestPath: options.manifestPath,
    environmentPolicy: "exclude",
    maximumSogImagePixels: LCC2_ORDERED_SOG_MAX_IMAGE_PIXELS,
    signal: options.signal,
  });
  if (initial.source.splatType !== ".sog") {
    return fail(
      "LCC2_ORDERED_NON_SOG_SOURCE",
      "Ordered inventory v1 supports only SOG LCC2 sources; selected SOG planes must separately prove lossless VP8L encoding.",
    );
  }
  assertAscendingTraversal(initial.selection.members, initial.selection.gaussianCount);

  const orderedMembers: Lcc2OrderedGaussianMemberV1[] = [];
  let globalStart = 0;
  for (let memberIndex = 0; memberIndex < initial.selection.members.length; memberIndex += 1) {
    const member = initial.selection.members[memberIndex];
    if (member === undefined) {
      return fail("LCC2_ORDERED_TRAVERSAL_INVALID", "LCC2 ordered member traversal became sparse.");
    }
    await options.testHooks?.beforeMember?.(member, memberIndex);
    const inventory = await inspectOrderedSogMember({
      absolutePath: absoluteMemberPath(options.manifestPath, member.relativePath),
      relativePath: member.relativePath,
      expectedSizeBytes: member.sizeBytes,
      expectedSha256: member.sha256,
      expectedGaussianCount: member.gaussianCount,
      signal: options.signal,
    });
    const globalEndExclusive = globalStart + member.gaussianCount;
    if (!Number.isSafeInteger(globalEndExclusive)) {
      return fail("LCC2_ORDERED_TRAVERSAL_INVALID", "LCC2 global ordinal exceeds the exact integer range.");
    }
    orderedMembers.push(deepFreeze({
      ...inventory,
      fileIndex: member.fileIndex,
      depth: member.depth,
      nodeIds: member.nodeIds,
      nodeCount: member.nodeCount,
      globalStart,
      globalEndExclusive,
    }));
    globalStart = globalEndExclusive;
  }
  if (globalStart !== initial.selection.gaussianCount) {
    return fail("LCC2_ORDERED_TRAVERSAL_INVALID", "LCC2 global ordinal coverage does not match its frontier total.");
  }

  await options.testHooks?.beforeFinalFrontierInspection?.();
  const final = await inspectLcc2HighestDetailFrontier({
    manifestPath: options.manifestPath,
    environmentPolicy: "exclude",
    maximumSogImagePixels: LCC2_ORDERED_SOG_MAX_IMAGE_PIXELS,
    signal: options.signal,
  });
  if (!sameFrontier(initial, final)) {
    return fail("LCC2_ORDERED_SOURCE_CHANGED", "LCC2 frontier changed while its ordered inventory was being derived.");
  }

  const ordinalMaterial = deepFreeze({
    sourceFrontierReceiptSha256: initial.receiptSha256,
    memberTraversalPolicy: "lcc2_frontier_file_index_ascending_v1" as const,
    localOrdinalPolicy: "sog_row_major_top_left_meta_count_v1" as const,
    gaussianCount: initial.selection.gaussianCount,
    members: orderedMembers.map((member) => ({
      fileIndex: member.fileIndex,
      relativePath: member.relativePath,
      globalStart: member.globalStart,
      globalEndExclusive: member.globalEndExclusive,
      gaussianCount: member.gaussianCount,
      sha256: member.sha256,
      metaJsonSha256: member.metaJsonSha256,
      quantizedPositionSha256: member.quantizedPositionSha256,
      packedRecordSha256: member.packedRecordSha256,
      planes: member.planes,
    })),
  });
  const ordinalInventorySha256 = `sha256:${domainSeparatedSha256(
    ORDINAL_DIGEST_DOMAIN,
    toCanonicalJson(ordinalMaterial),
  )}`;
  const material: Omit<Lcc2OrderedGaussianInventoryReceiptV1, "receiptSha256"> = {
    schemaVersion: LCC2_ORDERED_GAUSSIAN_INVENTORY_RECEIPT_V1,
    sourceFrontier: {
      receiptSha256: initial.receiptSha256,
      manifestFileName: initial.sourceManifest.fileName,
      manifestSizeBytes: initial.sourceManifest.sizeBytes,
      manifestSha256: initial.sourceManifest.sha256,
      lcc2Guid: initial.source.guid,
      splatType: ".sog",
      frontierDepth: initial.selection.depth,
      frontierNodeCount: initial.selection.nodeCount,
      frontierSizeBytes: initial.selection.sizeBytes,
    },
    inventory: {
      memberTraversalPolicy: "lcc2_frontier_file_index_ascending_v1",
      localOrdinalPolicy: "sog_row_major_top_left_meta_count_v1",
      gaussianCount: initial.selection.gaussianCount,
      memberCount: orderedMembers.length,
      members: orderedMembers,
      ordinalInventorySha256,
    },
    proof: {
      sourceFrontierStableAcrossInspection: true,
      environmentPolicy: "exclude",
      environmentIncludedInOrdinalInventory: false,
      everyMemberExactSha256Matched: true,
      everyPropertyPlaneUsesLosslessVp8lCodec: true,
      everyLocalOrdinalContiguous: true,
      everyGlobalOrdinalContiguous: true,
      coordinatesDequantized: false,
      coordinateFrameEstablished: false,
      roomMembershipEstablished: false,
      maskProduced: false,
      transformProduced: false,
      generatedContentAddedByInspection: false,
      immutableSha256BoundMemberSnapshotsUsed: true,
      authority: "none",
      applicationNetworkRequests: "none",
      storageTransportAssessment: "not_established",
      sourceWrites: "none",
    },
    inspectionLimits: {
      maximumGaussiansPerMember: LCC2_ORDERED_SOG_MAX_GAUSSIANS_PER_MEMBER,
      maximumImagePixels: LCC2_ORDERED_SOG_MAX_IMAGE_PIXELS,
      maximumRetainedDecodedBytesPerMember: LCC2_ORDERED_SOG_MAX_RETAINED_DECODED_BYTES,
      maximumSnapshotBytesPerMember: LCC2_ORDERED_SOG_MAX_SNAPSHOT_BYTES,
    },
  };
  const frozenMaterial = deepFreeze(material);
  return deepFreeze({
    ...frozenMaterial,
    receiptSha256: `sha256:${domainSeparatedSha256(RECEIPT_DIGEST_DOMAIN, toCanonicalJson(frozenMaterial))}`,
  });
}
