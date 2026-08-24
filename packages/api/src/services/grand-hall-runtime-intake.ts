import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { RegisterRuntimePackageInputSchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { assetVersions, generalAuditLog, runtimePackages } from "../db/schema.js";
import {
  GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
  GRAND_HALL_FRONTIER_MEMBERS,
  GRAND_HALL_FRONTIER_TOTAL_BYTES,
  GRAND_HALL_ROOM_SLUG,
  GRAND_HALL_VENUE_SLUG,
  buildGrandHallAssetRegistrationInputs,
  buildGrandHallRuntimePackagePayload,
  grandHallAssetIdentityErrors,
  type GrandHallAssetRecord,
  type GrandHallFrontierMemberSpec,
} from "../lib/grand-hall-frontier-contract.js";
import {
  computeRuntimePackageRevisionDigest,
  isRuntimePackageRevisionWriteConflict,
  type RuntimePackageRevisionRow,
} from "./runtime-package-revisions.js";

export type GrandHallRuntimeIntakeErrorCode =
  | "GRAND_HALL_INTAKE_BUSY"
  | "GRAND_HALL_STORAGE_CONFLICT"
  | "GRAND_HALL_STORAGE_FAILED"
  | "GRAND_HALL_REMOTE_VERIFICATION_FAILED"
  | "GRAND_HALL_ASSET_CONFLICT"
  | "GRAND_HALL_INTAKE_INTEGRITY_ERROR"
  | "GRAND_HALL_DATABASE_UNAVAILABLE";

export const GRAND_HALL_STORAGE_OPERATION_DEADLINE_MS = 30_000;

export class GrandHallRuntimeIntakeError extends Error {
  constructor(
    readonly statusCode: 409 | 429 | 500 | 502 | 503,
    readonly code: GrandHallRuntimeIntakeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GrandHallRuntimeIntakeError";
  }
}

export interface GrandHallRemoteObject {
  readonly body: AsyncIterable<Uint8Array | string>;
  readonly contentLength: number | null;
  readonly close: () => void;
}

export interface GrandHallPrivateObjectStore {
  /** Returns null only when the exact server-owned key is absent. */
  open(
    member: GrandHallFrontierMemberSpec,
    signal: AbortSignal,
  ): Promise<GrandHallRemoteObject | null>;
  /** Writes only when the fixed server-owned key is absent; never overwrites. */
  putCreateOnly(
    member: GrandHallFrontierMemberSpec,
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<"created" | "exists">;
}

export interface GrandHallRegistrationResult {
  readonly packageRow: RuntimePackageRevisionRow;
  readonly contentDigest: string;
  readonly created: boolean;
  readonly assetVersionIds: readonly string[];
}

export interface GrandHallRegistrationStore {
  /** Production implementations must make all asset/package writes one locked transaction. */
  registerExactFrontier(actorUserId: string): Promise<GrandHallRegistrationResult>;
}

export interface GrandHallPreparedMember {
  readonly memberIndex: number;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly status: "verified_existing" | "upload_required";
}

export interface GrandHallPrepareResult {
  readonly members: readonly GrandHallPreparedMember[];
  readonly existingMemberCount: number;
  readonly uploadRequiredCount: number;
}

export interface GrandHallCommitResult extends GrandHallRegistrationResult {
  readonly verifiedMemberCount: number;
  readonly verifiedTotalBytes: number;
  readonly gaussianCount: number;
}

function safeChunkBytes(chunk: Uint8Array | string): Uint8Array {
  return typeof chunk === "string" ? Buffer.from(chunk) : chunk;
}

function grandHallStorageFailure(): GrandHallRuntimeIntakeError {
  return new GrandHallRuntimeIntakeError(
    502,
    "GRAND_HALL_STORAGE_FAILED",
    "The server could not access the private Grand Hall storage target.",
  );
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Grand Hall private storage operation aborted", "AbortError");
}

interface GrandHallStorageDeadline {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
}

function grandHallStorageDeadline(parentSignal?: AbortSignal): GrandHallStorageDeadline {
  const controller = new AbortController();
  const abortFromParent = (): void => {
    controller.abort(parentSignal === undefined ? undefined : abortReason(parentSignal));
  };
  if (parentSignal?.aborted === true) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }
  const timeout = setTimeout(() => {
    controller.abort(new DOMException(
      "Grand Hall private storage operation exceeded its deadline",
      "TimeoutError",
    ));
  }, GRAND_HALL_STORAGE_OPERATION_DEADLINE_MS);
  timeout.unref();
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function nextRemoteChunk(
  iterator: AsyncIterator<Uint8Array | string>,
  signal: AbortSignal | undefined,
  close: () => void,
): Promise<IteratorResult<Uint8Array | string>> {
  if (signal === undefined) return iterator.next();
  if (signal.aborted) {
    close();
    return Promise.reject(abortReason(signal));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const handleAbort = (): void => {
      if (settled) return;
      settled = true;
      try {
        close();
      } finally {
        reject(abortReason(signal));
      }
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    void iterator.next().then(
      (result) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", handleAbort);
        resolve(result);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", handleAbort);
        reject(error instanceof Error ? error : new Error("Remote byte stream failed."));
      },
    );
  });
}

function waitForStorageOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  disposeLateResult?: (result: T) => void,
): Promise<T> {
  const disposeLate = (result: T): void => {
    try {
      disposeLateResult?.(result);
    } catch {
      // The operation is already aborted. Cleanup must not surface a second,
      // potentially unhandled failure after the generic storage error wins.
    }
  };
  if (signal.aborted) {
    void operation.then(disposeLate, () => undefined);
    return Promise.reject(abortReason(signal));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const handleAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    void operation.then(
      (result) => {
        if (settled) {
          disposeLate(result);
          return;
        }
        settled = true;
        signal.removeEventListener("abort", handleAbort);
        resolve(result);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", handleAbort);
        reject(error instanceof Error ? error : new Error("Private storage operation failed."));
      },
    );
  });
}

export async function verifyGrandHallRemoteObject(
  object: GrandHallRemoteObject,
  member: GrandHallFrontierMemberSpec,
  signal?: AbortSignal,
): Promise<void> {
  const hash = createHash("sha256");
  let receivedBytes = 0;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    object.close();
  };
  try {
    if (object.contentLength !== null && object.contentLength !== member.sizeBytes) {
      throw new GrandHallRuntimeIntakeError(
        409,
        "GRAND_HALL_STORAGE_CONFLICT",
        "A private Grand Hall object already exists with a different byte length.",
      );
    }
    const iterator = object.body[Symbol.asyncIterator]();
    for (;;) {
      const result = await nextRemoteChunk(iterator, signal, close);
      if (result.done === true) break;
      const chunk = result.value;
      const bytes = safeChunkBytes(chunk);
      receivedBytes += bytes.byteLength;
      if (receivedBytes > member.sizeBytes) {
        throw new GrandHallRuntimeIntakeError(
          409,
          "GRAND_HALL_STORAGE_CONFLICT",
          "A private Grand Hall object already exists with unexpected bytes.",
        );
      }
      hash.update(bytes);
    }
  } catch (error) {
    if (signal?.aborted === true) throw grandHallStorageFailure();
    if (error instanceof GrandHallRuntimeIntakeError) throw error;
    throw new GrandHallRuntimeIntakeError(
      502,
      "GRAND_HALL_REMOTE_VERIFICATION_FAILED",
      "The server could not completely verify the private Grand Hall bytes.",
    );
  } finally {
    close();
  }

  if (receivedBytes !== member.sizeBytes || hash.digest("hex") !== member.sha256) {
    throw new GrandHallRuntimeIntakeError(
      409,
      "GRAND_HALL_STORAGE_CONFLICT",
      "A private Grand Hall object already exists with unexpected bytes.",
    );
  }
}

async function verifyStoredMember(
  objectStore: GrandHallPrivateObjectStore,
  member: GrandHallFrontierMemberSpec,
  parentSignal?: AbortSignal,
): Promise<"missing" | "verified"> {
  const deadline = grandHallStorageDeadline(parentSignal);
  let object: GrandHallRemoteObject | null;
  try {
    object = await waitForStorageOperation(
      objectStore.open(member, deadline.signal),
      deadline.signal,
      (lateObject) => lateObject?.close(),
    );
    if (object === null) return "missing";
    await verifyGrandHallRemoteObject(object, member, deadline.signal);
    return "verified";
  } catch (error) {
    if (deadline.signal.aborted) throw grandHallStorageFailure();
    if (error instanceof GrandHallRuntimeIntakeError) throw error;
    throw grandHallStorageFailure();
  } finally {
    deadline.dispose();
  }
}

export async function prepareGrandHallRuntimeIntake(
  objectStore: GrandHallPrivateObjectStore,
  signal?: AbortSignal,
): Promise<GrandHallPrepareResult> {
  const members: GrandHallPreparedMember[] = [];
  for (let memberIndex = 0; memberIndex < GRAND_HALL_FRONTIER_MEMBERS.length; memberIndex += 1) {
    const member = GRAND_HALL_FRONTIER_MEMBERS[memberIndex];
    if (member === undefined) {
      throw new GrandHallRuntimeIntakeError(
        500,
        "GRAND_HALL_INTAKE_INTEGRITY_ERROR",
        "The canonical Grand Hall member contract is incomplete.",
      );
    }
    const status = await verifyStoredMember(objectStore, member, signal);
    if (status === "verified") {
      members.push({
        memberIndex,
        fileName: member.fileName,
        sizeBytes: member.sizeBytes,
        sha256: member.sha256,
        status: "verified_existing",
      });
      continue;
    }
    members.push({
      memberIndex,
      fileName: member.fileName,
      sizeBytes: member.sizeBytes,
      sha256: member.sha256,
      status: "upload_required",
    });
  }
  const existingMemberCount = members.filter((member) => member.status === "verified_existing").length;
  return {
    members,
    existingMemberCount,
    uploadRequiredCount: members.length - existingMemberCount,
  };
}

export interface GrandHallMemberUploadResult {
  readonly created: boolean;
  readonly memberIndex: number;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export async function uploadGrandHallRuntimeMember(
  objectStore: GrandHallPrivateObjectStore,
  memberIndex: number,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<GrandHallMemberUploadResult> {
  const member = GRAND_HALL_FRONTIER_MEMBERS[memberIndex];
  if (member === undefined) {
    throw new GrandHallRuntimeIntakeError(
      409,
      "GRAND_HALL_STORAGE_CONFLICT",
      "The requested Grand Hall member is not part of the canonical frontier.",
    );
  }
  if (
    bytes.byteLength !== member.sizeBytes ||
    createHash("sha256").update(bytes).digest("hex") !== member.sha256
  ) {
    throw new GrandHallRuntimeIntakeError(
      409,
      "GRAND_HALL_STORAGE_CONFLICT",
      "The uploaded bytes do not match the canonical Grand Hall member.",
    );
  }

  let result: "created" | "exists";
  const putDeadline = grandHallStorageDeadline(signal);
  try {
    result = await waitForStorageOperation(
      objectStore.putCreateOnly(member, bytes, putDeadline.signal),
      putDeadline.signal,
    );
  } catch (error) {
    if (putDeadline.signal.aborted) throw grandHallStorageFailure();
    if (error instanceof GrandHallRuntimeIntakeError) throw error;
    throw new GrandHallRuntimeIntakeError(
      502,
      "GRAND_HALL_STORAGE_FAILED",
      "The server could not create the private Grand Hall object.",
    );
  } finally {
    putDeadline.dispose();
  }
  const verification = await verifyStoredMember(objectStore, member, signal);
  if (verification !== "verified") {
    throw new GrandHallRuntimeIntakeError(
      502,
      "GRAND_HALL_REMOTE_VERIFICATION_FAILED",
      "The server could not read back the uploaded Grand Hall object.",
    );
  }
  return {
    created: result === "created",
    memberIndex,
    fileName: member.fileName,
    sizeBytes: member.sizeBytes,
    sha256: member.sha256,
  };
}

/**
 * Rehearsal-only proof that the fixed canonical member-0 key cannot be replaced.
 * The route constructs one same-length corrupt copy internally; callers cannot
 * select a key or use this helper as a general upload path.
 */
export async function probeGrandHallRuntimeConditionalCreateConflict(
  objectStore: GrandHallPrivateObjectStore,
  corruptBytes: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  const member = GRAND_HALL_FRONTIER_MEMBERS[0];
  if (
    corruptBytes.byteLength !== member.sizeBytes ||
    createHash("sha256").update(corruptBytes).digest("hex") === member.sha256
  ) {
    throw new GrandHallRuntimeIntakeError(
      500,
      "GRAND_HALL_INTAKE_INTEGRITY_ERROR",
      "The conditional-create rehearsal probe is not the expected corrupt member copy.",
    );
  }

  const putDeadline = grandHallStorageDeadline(signal);
  let result: "created" | "exists";
  try {
    result = await waitForStorageOperation(
      objectStore.putCreateOnly(member, corruptBytes, putDeadline.signal),
      putDeadline.signal,
    );
  } catch (error) {
    if (putDeadline.signal.aborted) throw grandHallStorageFailure();
    if (error instanceof GrandHallRuntimeIntakeError) throw error;
    throw grandHallStorageFailure();
  } finally {
    putDeadline.dispose();
  }
  if (result !== "exists") {
    throw new GrandHallRuntimeIntakeError(
      500,
      "GRAND_HALL_INTAKE_INTEGRITY_ERROR",
      "Private storage did not reject the corrupt conditional-create probe.",
    );
  }

  const verification = await verifyStoredMember(objectStore, member, signal);
  if (verification !== "verified") {
    throw new GrandHallRuntimeIntakeError(
      500,
      "GRAND_HALL_INTAKE_INTEGRITY_ERROR",
      "Private storage changed after the corrupt conditional-create probe.",
    );
  }
}

export async function commitGrandHallRuntimeIntake(
  objectStore: GrandHallPrivateObjectStore,
  registrationStore: GrandHallRegistrationStore,
  actorUserId: string,
  signal?: AbortSignal,
): Promise<GrandHallCommitResult> {
  for (const member of GRAND_HALL_FRONTIER_MEMBERS) {
    const status = await verifyStoredMember(objectStore, member, signal);
    if (status === "missing") {
      throw new GrandHallRuntimeIntakeError(
        409,
        "GRAND_HALL_STORAGE_CONFLICT",
        "The exact Grand Hall upload set is incomplete.",
      );
    }
  }

  let registration: GrandHallRegistrationResult;
  try {
    registration = await registrationStore.registerExactFrontier(actorUserId);
  } catch (error) {
    if (error instanceof GrandHallRuntimeIntakeError) throw error;
    throw new GrandHallRuntimeIntakeError(
      503,
      "GRAND_HALL_DATABASE_UNAVAILABLE",
      "The exact Grand Hall bytes were verified, but registration is currently unavailable.",
    );
  }
  return {
    ...registration,
    verifiedMemberCount: GRAND_HALL_FRONTIER_MEMBERS.length,
    verifiedTotalBytes: GRAND_HALL_FRONTIER_TOTAL_BYTES,
    gaussianCount: GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
  };
}

function packageInputFromRow(row: RuntimePackageRevisionRow) {
  return RegisterRuntimePackageInputSchema.parse({
    venueSlug: row.venueSlug,
    roomSlug: row.roomSlug,
    primaryVisualAssetVersionId: row.primaryVisualAssetVersionId,
    semanticMeshAssetVersionId: row.semanticMeshAssetVersionId,
    collisionAssetVersionId: row.collisionAssetVersionId,
    pointCloudAssetVersionId: row.pointCloudAssetVersionId,
    manifestJson: row.manifestJson,
    evidenceStatus: row.evidenceStatus,
    runtimeStatus: row.runtimeStatus,
  });
}

function assertExistingPackageIdentity(
  row: RuntimePackageRevisionRow,
  expectedDigest: string,
): void {
  if (
    row.identityKind !== "content_sha256" ||
    row.contentDigest !== expectedDigest ||
    computeRuntimePackageRevisionDigest(packageInputFromRow(row)) !== expectedDigest
  ) {
    throw new GrandHallRuntimeIntakeError(
      500,
      "GRAND_HALL_INTAKE_INTEGRITY_ERROR",
      "Stored Grand Hall package identity does not match its immutable content.",
    );
  }
}

function assetInsertValues(input: ReturnType<typeof buildGrandHallAssetRegistrationInputs>[number]) {
  return {
    venueSlug: input.venueSlug,
    roomSlug: input.roomSlug ?? null,
    captureSessionId: null,
    assetKind: input.assetKind,
    sourceType: input.sourceType,
    fileName: input.fileName,
    fileExt: input.fileExt,
    r2Key: input.r2Key ?? null,
    externalUrl: null,
    mimeType: input.mimeType ?? null,
    sha256: input.sha256 ?? null,
    sizeBytes: input.sizeBytes ?? null,
    evidenceStatus: input.evidenceStatus,
    runtimeStatus: input.runtimeStatus,
    notes: input.notes ?? null,
  };
}

export function createDatabaseGrandHallRegistrationStore(
  db: Database,
): GrandHallRegistrationStore {
  return {
    async registerExactFrontier(actorUserId) {
      const operation = async (): Promise<GrandHallRegistrationResult> => db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '5s'`);
        await tx.execute(sql`set local statement_timeout = '30s'`);
        await tx.execute(sql`
          select pg_advisory_xact_lock(
            hashtextextended(${`${GRAND_HALL_VENUE_SLUG}\u001f${GRAND_HALL_ROOM_SLUG}`}, 0)
          )
        `);

        const inputs = buildGrandHallAssetRegistrationInputs();
        const keys = inputs.map((input) => input.r2Key).filter((key): key is string => key !== null && key !== undefined);
        const rows = await tx
          .select()
          .from(assetVersions)
          .where(inArray(assetVersions.r2Key, keys));
        const rowsByKey = new Map(rows.map((row) => [row.r2Key, row]));

        for (const input of inputs) {
          const key = input.r2Key;
          if (key === null || key === undefined) {
            throw new GrandHallRuntimeIntakeError(
              500,
              "GRAND_HALL_INTAKE_INTEGRITY_ERROR",
              "The canonical Grand Hall storage identity is incomplete.",
            );
          }
          const existing = rowsByKey.get(key);
          if (existing !== undefined) {
            if (grandHallAssetIdentityErrors(existing, input).length > 0) {
              throw new GrandHallRuntimeIntakeError(
                409,
                "GRAND_HALL_ASSET_CONFLICT",
                "An existing Grand Hall asset registration conflicts with the exact byte identity.",
              );
            }
            continue;
          }
          const [inserted] = await tx.insert(assetVersions).values(assetInsertValues(input)).returning();
          if (inserted === undefined) {
            throw new GrandHallRuntimeIntakeError(
              500,
              "GRAND_HALL_INTAKE_INTEGRITY_ERROR",
              "The database did not return a Grand Hall asset registration.",
            );
          }
          rowsByKey.set(key, inserted);
        }
        const orderedAssets: GrandHallAssetRecord[] = inputs.map((input) => {
          const row = rowsByKey.get(input.r2Key ?? null);
          if (row === undefined || grandHallAssetIdentityErrors(row, input).length > 0) {
            throw new GrandHallRuntimeIntakeError(
              409,
              "GRAND_HALL_ASSET_CONFLICT",
              "The exact Grand Hall asset set could not be reconciled.",
            );
          }
          return row;
        });
        const packageInput = buildGrandHallRuntimePackagePayload(orderedAssets);
        const contentDigest = computeRuntimePackageRevisionDigest(packageInput);
        const [existingPackage] = await tx
          .select()
          .from(runtimePackages)
          .where(and(
            eq(runtimePackages.venueSlug, GRAND_HALL_VENUE_SLUG),
            eq(runtimePackages.roomSlug, GRAND_HALL_ROOM_SLUG),
            eq(runtimePackages.contentDigest, contentDigest),
          ))
          .limit(1);

        if (existingPackage !== undefined) {
          assertExistingPackageIdentity(existingPackage, contentDigest);
          return {
            packageRow: existingPackage,
            contentDigest,
            created: false,
            assetVersionIds: orderedAssets.map((asset) => asset.id),
          };
        }

        const [latest] = await tx
          .select({ revision: runtimePackages.revision })
          .from(runtimePackages)
          .where(and(
            eq(runtimePackages.venueSlug, GRAND_HALL_VENUE_SLUG),
            eq(runtimePackages.roomSlug, GRAND_HALL_ROOM_SLUG),
          ))
          .orderBy(desc(runtimePackages.revision))
          .limit(1);
        const revision = (latest?.revision ?? 0) + 1;
        const [packageRow] = await tx.insert(runtimePackages).values({
          venueSlug: packageInput.venueSlug,
          roomSlug: packageInput.roomSlug,
          revision,
          identityKind: "content_sha256",
          contentDigest,
          primaryVisualAssetVersionId: packageInput.primaryVisualAssetVersionId ?? null,
          semanticMeshAssetVersionId: null,
          collisionAssetVersionId: null,
          pointCloudAssetVersionId: null,
          manifestJson: packageInput.manifestJson,
          evidenceStatus: packageInput.evidenceStatus,
          runtimeStatus: packageInput.runtimeStatus,
        }).returning();
        if (packageRow === undefined) {
          throw new GrandHallRuntimeIntakeError(
            500,
            "GRAND_HALL_INTAKE_INTEGRITY_ERROR",
            "The database did not return the immutable Grand Hall package.",
          );
        }
        assertExistingPackageIdentity(packageRow, contentDigest);
        await tx.insert(generalAuditLog).values({
          actorUserId,
          action: "grand_hall_runtime_intake.committed",
          targetType: "runtime_package",
          targetId: packageRow.id,
          summary: "Exact capture-only Grand Hall runtime frontier registered.",
          metadata: {
            revision,
            contentDigest,
            memberCount: orderedAssets.length,
            totalBytes: GRAND_HALL_FRONTIER_TOTAL_BYTES,
            captureSessionId: null,
          },
        });
        return {
          packageRow,
          contentDigest,
          created: true,
          assetVersionIds: orderedAssets.map((asset) => asset.id),
        };
      });

      try {
        return await operation();
      } catch (error) {
        if (
          error instanceof GrandHallRuntimeIntakeError ||
          !isRuntimePackageRevisionWriteConflict(error)
        ) {
          throw error;
        }
        return operation();
      }
    },
  };
}
