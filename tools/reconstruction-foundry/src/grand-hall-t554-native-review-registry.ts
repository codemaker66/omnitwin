import { isAbsolute, resolve } from "node:path";

import {
  GrandHallScopeReviewPackV3Schema,
  GrandHallT554ClosedVolumeReviewV1Schema,
  GrandHallT554HumanDecisionsV3Schema,
  computeGrandHallT554ClosedVolumeReviewV1Sha256,
  computeGrandHallT554HumanDecisionsV3Sha256,
  type GrandHallPanoramaSourceJpgIdentityV2,
  type GrandHallScopeReviewPackV3,
  type GrandHallT554ClosedVolumeReviewV1,
  type GrandHallT554HumanDecisionsV3,
} from "@omnitwin/types";

import {
  GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
  GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME,
  GRAND_HALL_T554_V3_MAX_JSON_BYTES,
  GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME,
  GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME,
  grandHallT554V3FileSha256,
  parseGrandHallT554ReviewPackV3Receipt,
  type GrandHallT554ReviewPackV3Receipt,
} from "./grand-hall-t554-review-pack-v3-contract.js";
import { readGrandHallT554V3ExactFlatDirectory } from "./grand-hall-t554-review-pack-v3-files.js";
import { assertGrandHallT554ReviewPackV3SemanticIntegrity } from "./grand-hall-t554-review-pack-v3.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

const EXACT_V3_FILES = Object.freeze([
  GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
  GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME,
  GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME,
  GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME,
]);

const VERIFIED_REGISTRY_IDENTITIES = new WeakSet();

export interface __GrandHallT554NativeReviewRegistryCandidateAnchor {
  readonly reviewPackSha256: string;
  readonly reviewPackFileSha256: string;
  readonly reviewPackFileByteLength: number;
  readonly publicationReceiptSha256: string;
  readonly publicationReceiptFileSha256: string;
  readonly publicationReceiptFileByteLength: number;
}

const GRAND_HALL_T554_NATIVE_REVIEW_REGISTRY_ANCHOR = Object.freeze({
  reviewPackSha256:
    "sha256:0906aeba265aea9879a65c5e7d698ddaaa5e54912d7024868c1a1abaaf618530",
  reviewPackFileSha256:
    "sha256:9c7b18186c1065a5216eff64e9c27343d81105f1f4adbfd705ee4612782281dd",
  reviewPackFileByteLength: 130_706,
  publicationReceiptSha256:
    "sha256:67800d907aebb1643ea8ee2dda580d76ca5849b400a46e52aef127339ee42b17",
  publicationReceiptFileSha256:
    "sha256:fa03a33401b6589e3e2d6fa2d1e393cdbf0573776de5666f0c0c422d0763dfe5",
  publicationReceiptFileByteLength: 3_590,
} satisfies __GrandHallT554NativeReviewRegistryCandidateAnchor);

export interface GrandHallT554NativeReviewRegistryOptions {
  readonly reviewPackDirectory: string;
  readonly panoramaSourceRoot: string;
}

export interface GrandHallT554NativeReviewRegistrySource {
  readonly source: GrandHallPanoramaSourceJpgIdentityV2;
  readonly observation: GrandHallScopeReviewPackV3["panoramaRecords"][number]["observation"];
  readonly observationBasis: GrandHallScopeReviewPackV3["panoramaRecords"][number]["observationBasis"];
}

export interface GrandHallT554NativeReviewRegistrySummary {
  readonly venueSlug: "trades-hall";
  readonly roomSlug: "grand-hall";
  readonly sourceCount: 148;
  readonly reviewPackSha256: string;
  readonly reviewPackFileSha256: string;
  readonly reviewPackFileByteLength: number;
  readonly publicationReceiptSha256: string;
  readonly publicationReceiptFileSha256: string;
  readonly publicationReceiptFileByteLength: number;
  readonly authority: "none";
  readonly reviewState: "human_pending";
  readonly acceptanceAuthorized: false;
  readonly reconstructionAuthorized: false;
  readonly runtimeAuthorized: false;
  readonly generatedContentAuthorized: false;
}

export interface GrandHallT554NativeReviewRegistry {
  readonly reviewPack: GrandHallScopeReviewPackV3;
  readonly pendingHumanDecisions: GrandHallT554HumanDecisionsV3;
  readonly pendingClosedVolumeReview: GrandHallT554ClosedVolumeReviewV1;
  readonly publicationReceipt: GrandHallT554ReviewPackV3Receipt;
  readonly sources: readonly GrandHallT554NativeReviewRegistrySource[];
  readonly summary: GrandHallT554NativeReviewRegistrySummary;
  readonly sourceAt: (inventoryIndex: number) => GrandHallT554NativeReviewRegistrySource;
  readonly mediaInputAt: (inventoryIndex: number) => {
    readonly sourceRoot: string;
    readonly fileName: string;
    readonly expectedSha256: string;
    readonly expectedByteLength: number;
  };
}

export class GrandHallT554NativeReviewRegistryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewRegistryError";
  }
}

/**
 * Returns true only for the exact in-process object returned by this module's
 * completed registry loader. Structural copies and look-alike objects are not
 * evidence that the reviewed v3 anchors or source roots were verified.
 */
export function isGrandHallT554NativeReviewRegistry(
  value: unknown,
): value is GrandHallT554NativeReviewRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    VERIFIED_REGISTRY_IDENTITIES.has(value)
  );
}

/** Fails closed unless `value` is an identity-branded loaded registry. */
export function assertGrandHallT554NativeReviewRegistry(
  value: unknown,
): asserts value is GrandHallT554NativeReviewRegistry {
  if (!isGrandHallT554NativeReviewRegistry(value)) {
    throw new GrandHallT554NativeReviewRegistryError(
      "Native-review registry handle was not returned by the exact reviewed v3 loader.",
    );
  }
}

function requireAbsoluteDirectoryArgument(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("//")
  ) {
    throw new GrandHallT554NativeReviewRegistryError(`${label} must be one absolute directory.`);
  }
  return resolve(value);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value);
}

function requiredFile(
  files: Awaited<ReturnType<typeof readGrandHallT554V3ExactFlatDirectory>>["files"],
  name: string,
): NonNullable<
  ReturnType<
    Awaited<ReturnType<typeof readGrandHallT554V3ExactFlatDirectory>>["files"]["get"]
  >
> {
  const file = files.get(name);
  if (file === undefined) {
    throw new GrandHallT554NativeReviewRegistryError(`Verified v3 pack omitted ${name}.`);
  }
  return file;
}

function parseStrictSchema<T>(
  bytes: Buffer,
  parse: (value: unknown) => T,
  label: string,
): T {
  try {
    return parse(parseGrandHallT554StrictJson(bytes));
  } catch (error) {
    throw new GrandHallT554NativeReviewRegistryError(
      `${label} is not a strict valid v3 artifact.`,
      error,
    );
  }
}

function verifyPayloadInventory(
  receipt: GrandHallT554ReviewPackV3Receipt,
  files: Awaited<ReturnType<typeof readGrandHallT554V3ExactFlatDirectory>>["files"],
): void {
  for (const payload of receipt.payloads) {
    const file = requiredFile(files, payload.relativePath);
    if (
      file.sha256 !== payload.sha256 ||
      Number(file.stats.size) !== payload.byteLength
    ) {
      throw new GrandHallT554NativeReviewRegistryError(
        `V3 payload ${payload.relativePath} does not match its receipt bytes.`,
      );
    }
  }
}

function assertPendingLifecycle(
  decisions: GrandHallT554HumanDecisionsV3,
  volume: GrandHallT554ClosedVolumeReviewV1,
): void {
  if (
    decisions.reviewState !== "human_pending" ||
    decisions.finalDecision !== "PENDING" ||
    decisions.nativeResolutionHumanReviewCompleted ||
    decisions.panoramaDecisions.some((decision) => decision.result !== "UNSURE") ||
    volume.reviewState !== "human_pending" ||
    volume.finalDecision !== "PENDING"
  ) {
    throw new GrandHallT554NativeReviewRegistryError(
      "The workbench accepts only the exact fail-closed human-pending v3 lifecycle.",
    );
  }
}

function assertExpectedAnchor(
  anchor: __GrandHallT554NativeReviewRegistryCandidateAnchor,
  reviewPack: GrandHallScopeReviewPackV3,
  reviewPackFile: NonNullable<
    ReturnType<
      Awaited<ReturnType<typeof readGrandHallT554V3ExactFlatDirectory>>["files"]["get"]
    >
  >,
  publicationReceipt: GrandHallT554ReviewPackV3Receipt,
  receiptFile: NonNullable<
    ReturnType<
      Awaited<ReturnType<typeof readGrandHallT554V3ExactFlatDirectory>>["files"]["get"]
    >
  >,
): void {
  if (
    reviewPack.artifactSha256 !== anchor.reviewPackSha256 ||
    reviewPackFile.sha256 !== anchor.reviewPackFileSha256 ||
    Number(reviewPackFile.stats.size) !== anchor.reviewPackFileByteLength ||
    publicationReceipt.receiptSha256 !== anchor.publicationReceiptSha256 ||
    receiptFile.sha256 !== anchor.publicationReceiptFileSha256 ||
    Number(receiptFile.stats.size) !== anchor.publicationReceiptFileByteLength
  ) {
    throw new GrandHallT554NativeReviewRegistryError(
      "The v3 pack does not match the reviewed Grand Hall evidence anchors.",
    );
  }
}

async function verifyCandidateRegistry(
  options: GrandHallT554NativeReviewRegistryOptions,
  anchor: __GrandHallT554NativeReviewRegistryCandidateAnchor,
): Promise<GrandHallT554NativeReviewRegistry> {
  const reviewPackDirectory = requireAbsoluteDirectoryArgument(
    options.reviewPackDirectory,
    "T-554 v3 review-pack directory",
  );
  const panoramaSourceRoot = requireAbsoluteDirectoryArgument(
    options.panoramaSourceRoot,
    "T-554 panorama source root",
  );
  try {
    const read = await readGrandHallT554V3ExactFlatDirectory(
      reviewPackDirectory,
      EXACT_V3_FILES,
      GRAND_HALL_T554_V3_MAX_JSON_BYTES,
    );
    const reviewPackFile = requiredFile(read.files, GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME);
    const decisionsFile = requiredFile(read.files, GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME);
    const volumeFile = requiredFile(
      read.files,
      GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
    );
    const receiptFile = requiredFile(
      read.files,
      GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME,
    );
    const publicationReceipt = parseGrandHallT554ReviewPackV3Receipt(receiptFile.bytes);
    verifyPayloadInventory(publicationReceipt, read.files);
    const reviewPack = parseStrictSchema(
      reviewPackFile.bytes,
      (value) => GrandHallScopeReviewPackV3Schema.parse(value),
      "T-554 v3 review pack",
    );
    const pendingHumanDecisions = parseStrictSchema(
      decisionsFile.bytes,
      (value) => GrandHallT554HumanDecisionsV3Schema.parse(value),
      "T-554 v3 human decisions",
    );
    const pendingClosedVolumeReview = parseStrictSchema(
      volumeFile.bytes,
      (value) => GrandHallT554ClosedVolumeReviewV1Schema.parse(value),
      "T-554 v3 closed-volume template",
    );
    assertExpectedAnchor(
      anchor,
      reviewPack,
      reviewPackFile,
      publicationReceipt,
      receiptFile,
    );
    if (
      reviewPack.artifactSha256 !== publicationReceipt.reviewPackSha256 ||
      computeGrandHallT554HumanDecisionsV3Sha256(pendingHumanDecisions) !==
        publicationReceipt.humanDecisionsSha256 ||
      computeGrandHallT554ClosedVolumeReviewV1Sha256(pendingClosedVolumeReview) !==
        publicationReceipt.closedVolumeReviewSha256
    ) {
      throw new GrandHallT554NativeReviewRegistryError(
        "V3 semantic artifacts do not match the terminal publication receipt.",
      );
    }
    assertPendingLifecycle(
      pendingHumanDecisions,
      pendingClosedVolumeReview,
    );
    assertGrandHallT554ReviewPackV3SemanticIntegrity({
      reviewPack,
      humanDecisions: pendingHumanDecisions,
      closedVolume: pendingClosedVolumeReview,
      receipt: publicationReceipt,
    });
    const frozenReviewPack = deepFreeze(structuredClone(reviewPack));
    const frozenHumanDecisions = deepFreeze(structuredClone(pendingHumanDecisions));
    const frozenClosedVolumeReview = deepFreeze(structuredClone(pendingClosedVolumeReview));
    const frozenPublicationReceipt = deepFreeze(structuredClone(publicationReceipt));
    const sources = deepFreeze(frozenReviewPack.panoramaRecords.map((record) => ({
      source: record.source,
      observation: record.observation,
      observationBasis: record.observationBasis,
    })));
    const sourceAt = (inventoryIndex: number): GrandHallT554NativeReviewRegistrySource => {
      if (!Number.isInteger(inventoryIndex) || inventoryIndex < 0 || inventoryIndex >= 148) {
        throw new GrandHallT554NativeReviewRegistryError(
          "Panorama inventory index must be an integer from 0 through 147.",
        );
      }
      const source = sources[inventoryIndex];
      if (source === undefined || source.source.inventoryIndex !== inventoryIndex) {
        throw new GrandHallT554NativeReviewRegistryError(
          "V3 panorama registry ordering drifted.",
        );
      }
      return source;
    };
    const summary: GrandHallT554NativeReviewRegistrySummary = Object.freeze({
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      sourceCount: 148,
      reviewPackSha256: reviewPack.artifactSha256,
      reviewPackFileSha256: reviewPackFile.sha256,
      reviewPackFileByteLength: Number(reviewPackFile.stats.size),
      publicationReceiptSha256: publicationReceipt.receiptSha256,
      publicationReceiptFileSha256: grandHallT554V3FileSha256(receiptFile.bytes),
      publicationReceiptFileByteLength: Number(receiptFile.stats.size),
      authority: "none",
      reviewState: "human_pending",
      acceptanceAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAuthorized: false,
      generatedContentAuthorized: false,
    });
    const registry = Object.freeze({
      reviewPack: frozenReviewPack,
      pendingHumanDecisions: frozenHumanDecisions,
      pendingClosedVolumeReview: frozenClosedVolumeReview,
      publicationReceipt: frozenPublicationReceipt,
      sources,
      summary,
      sourceAt,
      mediaInputAt: (inventoryIndex: number) => {
        const row = sourceAt(inventoryIndex).source;
        return Object.freeze({
          sourceRoot: panoramaSourceRoot,
          fileName: row.fileName,
          expectedSha256: row.sha256,
          expectedByteLength: row.byteLength,
        });
      },
    });
    return registry;
  } catch (error) {
    if (error instanceof GrandHallT554NativeReviewRegistryError) throw error;
    throw new GrandHallT554NativeReviewRegistryError(
      "The exact T-554 v3 review registry could not be loaded safely.",
      error,
    );
  }
}

export async function loadGrandHallT554NativeReviewRegistry(
  options: GrandHallT554NativeReviewRegistryOptions,
): Promise<GrandHallT554NativeReviewRegistry> {
  const registry = await verifyCandidateRegistry(
    options,
    GRAND_HALL_T554_NATIVE_REVIEW_REGISTRY_ANCHOR,
  );
  VERIFIED_REGISTRY_IDENTITIES.add(registry);
  return registry;
}

export const __testOnlyGrandHallT554NativeReviewRegistry =
  /* @__PURE__ */ Object.freeze({ verifyCandidateRegistry });
