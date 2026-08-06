import { createHash } from "node:crypto";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { basename, isAbsolute, relative, sep } from "node:path";
import type { Stats } from "node:fs";
import { performance } from "node:perf_hooks";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_POTREE_V2_POINT_RECORD_BYTES,
} from "./potree-v2-source-facts.js";
import {
  FOUNDRY_POTREE_V2_POINT_VALUES_OCTREE_MAX_BYTES,
} from "./potree-v2-point-values.js";
import {
  FoundryUniversalIntakeReceiptSchema,
  type FoundryUniversalIntakeReceipt,
} from "./intake-receipt.js";
import {
  FoundryUniversalSourceFactsV8Schema,
  type FoundryUniversalSourceFactsV8,
} from "./source-facts-v8.js";
import { canonicalBundleRoot, resolveBundlePath } from "./path-safety.js";
import {
  FoundryRoomEnvelopeReviewRequestV0Schema,
  compileFoundryRoomEnvelopeReviewV0,
  computeFoundryRoomEnvelopeMappingV0,
  decoderPointToIntrinsicPixel,
  intrinsicPixelInsidePolygon,
  type FoundryRoomEnvelopeReviewRequestV0,
  type FoundryRoomEnvelopeReviewV0,
} from "./room-envelope-review.js";

export const FOUNDRY_ROOM_ENVELOPE_REVIEW_TIME_MAX_MS_V0 = 30_000;
const RECORD_GUARD_INTERVAL = 65_536;

export interface RunFoundryRoomEnvelopeReviewWorkerV0Options {
  readonly sourceRoot: string;
  readonly receipt: FoundryUniversalIntakeReceipt;
  readonly sourceFacts: FoundryUniversalSourceFactsV8;
  readonly request: FoundryRoomEnvelopeReviewRequestV0;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: {
    readonly completedRecords: number;
    readonly totalRecords: number;
  }) => void;
}

export interface FoundryRoomEnvelopeReviewWorkerV0Result {
  readonly report: FoundryRoomEnvelopeReviewV0;
}

export class FoundryRoomEnvelopeReviewCancellationError extends Error {
  public readonly code = "ROOM_ENVELOPE_REVIEW_CANCELLED";
  public constructor() {
    super("The room-envelope review was cancelled.");
    this.name = "AbortError";
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new FoundryRoomEnvelopeReviewCancellationError();
  }
}

function guard(
  signal: AbortSignal | undefined,
  startedAt: number,
): void {
  throwIfCancelled(signal);
  if (performance.now() - startedAt > FOUNDRY_ROOM_ENVELOPE_REVIEW_TIME_MAX_MS_V0) {
    throw new FoundryIntegrityError(
      "ROOM_ENVELOPE_REVIEW_TIME_LIMIT_EXCEEDED",
      "The bounded room-envelope pass exceeded its local time limit.",
    );
  }
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(comparable(root), comparable(candidate));
  return fromRoot === "" || (
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !fromRoot.startsWith("../") &&
    !fromRoot.startsWith("..\\") &&
    !isAbsolute(fromRoot)
  );
}

async function readExactMember(
  root: string,
  member: {
    readonly path: string;
    readonly sizeBytes: number;
    readonly sha256: string;
  },
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  throwIfCancelled(signal);
  const requestedPath = resolveBundlePath(root, member.path);
  const beforePath = await lstat(requestedPath);
  if (beforePath.isSymbolicLink() || !beforePath.isFile()) {
    throw new FoundryIntegrityError(
      "ROOM_ENVELOPE_SOURCE_NOT_REGULAR",
      `A selected Potree member is no longer a regular file: ${member.path}`,
    );
  }
  if (
    beforePath.size !== member.sizeBytes ||
    member.sizeBytes > FOUNDRY_POTREE_V2_POINT_VALUES_OCTREE_MAX_BYTES
  ) {
    throw new FoundryIntegrityError(
      "ROOM_ENVELOPE_SOURCE_SIZE_CHANGED",
      `A selected Potree member changed size or exceeds the local byte bound: ${member.path}`,
    );
  }
  const canonicalPath = await realpath(requestedPath);
  if (!isWithin(root, canonicalPath)) {
    throw new FoundryIntegrityError(
      "ROOM_ENVELOPE_SOURCE_PATH_ESCAPE",
      `A selected Potree member resolves outside the intake root: ${member.path}`,
    );
  }
  let handle: FileHandle | undefined;
  try {
    handle = await open(canonicalPath, "r");
    const beforeHandle = await handle.stat();
    const afterOpenPath = await lstat(requestedPath);
    if (
      afterOpenPath.isSymbolicLink() ||
      !afterOpenPath.isFile() ||
      !sameFileIdentity(beforePath, beforeHandle) ||
      !sameFileIdentity(beforeHandle, afterOpenPath)
    ) {
      throw new FoundryIntegrityError(
        "ROOM_ENVELOPE_SOURCE_CHANGED_BEFORE_READ",
        `A selected Potree member changed before it could be read: ${member.path}`,
      );
    }
    throwIfCancelled(signal);
    const bytes = await handle.readFile({ signal });
    throwIfCancelled(signal);
    const afterHandle = await handle.stat();
    const afterPath = await lstat(requestedPath);
    if (
      afterPath.isSymbolicLink() ||
      !afterPath.isFile() ||
      !sameFileIdentity(beforeHandle, afterHandle) ||
      !sameFileIdentity(afterHandle, afterPath)
    ) {
      bytes.fill(0);
      throw new FoundryIntegrityError(
        "ROOM_ENVELOPE_SOURCE_CHANGED_DURING_READ",
        `A selected Potree member changed while it was being read: ${member.path}`,
      );
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== member.sizeBytes || sha256 !== member.sha256) {
      bytes.fill(0);
      throw new FoundryIntegrityError(
        "ROOM_ENVELOPE_SOURCE_DIGEST_MISMATCH",
        `A selected Potree member no longer matches the receipt: ${member.path}`,
      );
    }
    return bytes;
  } finally {
    await handle?.close();
  }
}

function selectedBundle(
  sourceFacts: FoundryUniversalSourceFactsV8,
  bundleSha256: string,
) {
  if (sourceFacts.state !== "available" || sourceFacts.inherited.state !== "available") {
    throw new FoundryIntegrityError(
      "ROOM_ENVELOPE_SOURCE_UNAVAILABLE",
      "The selected source has no established V8 Potree bundle.",
    );
  }
  const overlay = sourceFacts.pointValueBundles.find(
    (candidate) => candidate.bundleSha256 === bundleSha256,
  );
  const inherited = sourceFacts.inherited.potreeBundles.find(
    (candidate) => candidate.bundleSha256 === bundleSha256,
  );
  if (
    overlay?.pointValues.state !== "established" ||
    inherited?.inspection.state !== "established" ||
    inherited.facts === null
  ) {
    throw new FoundryIntegrityError(
      "ROOM_ENVELOPE_BUNDLE_NOT_ESTABLISHED",
      "The requested bundle has no exact established V8 record set.",
    );
  }
  return { overlay, inherited };
}

export async function runFoundryRoomEnvelopeReviewWorkerV0(
  options: RunFoundryRoomEnvelopeReviewWorkerV0Options,
): Promise<FoundryRoomEnvelopeReviewWorkerV0Result> {
  const startedAt = performance.now();
  const receipt = FoundryUniversalIntakeReceiptSchema.parse(options.receipt);
  const sourceFacts = FoundryUniversalSourceFactsV8Schema.parse(
    options.sourceFacts,
  );
  const request = FoundryRoomEnvelopeReviewRequestV0Schema.parse(
    options.request,
  );
  if (
    receipt.source.kind !== "directory" ||
    request.receiptSha256 !== receipt.receiptSha256 ||
    sourceFacts.receiptSha256 !== receipt.receiptSha256 ||
    request.sourceFactsSha256 !== sourceFacts.factsSha256
  ) {
    throw new FoundryIntegrityError(
      "ROOM_ENVELOPE_SOURCE_BINDING_MISMATCH",
      "The selected directory, receipt, facts, and review request do not match.",
    );
  }
  const root = await canonicalBundleRoot(options.sourceRoot);
  if (basename(root) !== receipt.source.label) {
    throw new FoundryIntegrityError(
      "ROOM_ENVELOPE_SOURCE_ROOT_LABEL_MISMATCH",
      "The selected source folder no longer matches the intake receipt.",
    );
  }
  const { overlay, inherited } = selectedBundle(
    sourceFacts,
    request.bundleSha256,
  );
  const receiptByPath = new Map(
    receipt.files.map((file) => [file.path, file] as const),
  );
  let octreeBytes: Buffer | undefined;
  try {
    for (const member of inherited.members) {
      guard(options.signal, startedAt);
      const receiptFile = receiptByPath.get(member.path);
      if (
        receiptFile === undefined ||
        receiptFile.sizeBytes !== member.sizeBytes ||
        receiptFile.sha256 !== member.sha256
      ) {
        throw new FoundryIntegrityError(
          "ROOM_ENVELOPE_MEMBER_RECEIPT_MISMATCH",
          "A Potree member is not bound to the current intake receipt.",
        );
      }
      const bytes = await readExactMember(root, member, options.signal);
      if (member.role === "octree") {
        octreeBytes = bytes;
      } else {
        bytes.fill(0);
      }
    }
    if (octreeBytes === undefined) {
      throw new FoundryIntegrityError(
        "ROOM_ENVELOPE_OCTREE_MISSING",
        "The established bundle no longer contains its octree member.",
      );
    }
    if (
      overlay.pointValues.state !== "established" ||
      inherited.facts === null
    ) {
      throw new FoundryIntegrityError(
        "ROOM_ENVELOPE_BUNDLE_NOT_ESTABLISHED",
        "The requested bundle lost its established facts before review.",
      );
    }
    const pointFacts = overlay.pointValues.facts;
    const bundleFacts = inherited.facts;
    const recordCount = pointFacts.recordCount;
    if (
      octreeBytes.byteLength !==
        recordCount * FOUNDRY_POTREE_V2_POINT_RECORD_BYTES ||
      bundleFacts.metadata.pointCount !== recordCount
    ) {
      throw new FoundryIntegrityError(
        "ROOM_ENVELOPE_RECORD_LAYOUT_MISMATCH",
        "The exact octree byte count no longer matches the V7/V8 record declaration.",
      );
    }
    const horizontalPreview = request.reviewedPreviews.find(
      (preview) => preview.viewId === request.horizontalViewId,
    );
    const manifestPreview = pointFacts.previews.images.find(
      (preview) =>
        preview.viewId === horizontalPreview?.viewId &&
        preview.mode === horizontalPreview.mode &&
        preview.sha256 === horizontalPreview.sha256 &&
        preview.pixelSha256 === horizontalPreview.pixelSha256,
    );
    if (horizontalPreview === undefined || manifestPreview === undefined) {
      throw new FoundryIntegrityError(
        "ROOM_ENVELOPE_HORIZONTAL_PREVIEW_MISMATCH",
        "The requested horizontal preview is no longer current.",
      );
    }
    const mapping = computeFoundryRoomEnvelopeMappingV0(
      pointFacts.position.decodedMin,
      pointFacts.position.decodedMax,
      manifestPreview.projectedAxes,
    );
    const scale = bundleFacts.metadata.declaredScale;
    const offset = bundleFacts.metadata.declaredOffset;
    let includedRecordCount = 0;
    const includedMin: [number, number, number] = [Infinity, Infinity, Infinity];
    const includedMax: [number, number, number] = [
      -Infinity,
      -Infinity,
      -Infinity,
    ];
    options.onProgress?.({ completedRecords: 0, totalRecords: recordCount });
    for (let ordinal = 0; ordinal < recordCount; ordinal += 1) {
      if (ordinal % RECORD_GUARD_INTERVAL === 0) {
        guard(options.signal, startedAt);
        options.onProgress?.({
          completedRecords: ordinal,
          totalRecords: recordCount,
        });
      }
      const byteOffset = ordinal * FOUNDRY_POTREE_V2_POINT_RECORD_BYTES;
      const decoded: [number, number, number] = [
        octreeBytes.readInt32LE(byteOffset) * scale[0] + offset[0],
        octreeBytes.readInt32LE(byteOffset + 4) * scale[1] + offset[1],
        octreeBytes.readInt32LE(byteOffset + 8) * scale[2] + offset[2],
      ];
      const pixel = decoderPointToIntrinsicPixel(
        mapping,
        manifestPreview.projectedAxes,
        decoded,
      );
      if (!intrinsicPixelInsidePolygon(pixel, request.polygonIntrinsicPixels)) {
        continue;
      }
      includedRecordCount += 1;
      for (let axis = 0; axis < 3; axis += 1) {
        includedMin[axis] = Math.min(
          includedMin[axis] ?? Infinity,
          decoded[axis] ?? Infinity,
        );
        includedMax[axis] = Math.max(
          includedMax[axis] ?? -Infinity,
          decoded[axis] ?? -Infinity,
        );
      }
    }
    guard(options.signal, startedAt);
    options.onProgress?.({
      completedRecords: recordCount,
      totalRecords: recordCount,
    });
    const includedDecodedBounds = includedRecordCount === 0
      ? null
      : { min: includedMin, max: includedMax };
    return {
      report: compileFoundryRoomEnvelopeReviewV0({
        receipt,
        sourceFacts,
        request,
        includedRecordCount,
        includedDecodedBounds,
      }),
    };
  } finally {
    octreeBytes?.fill(0);
  }
}
