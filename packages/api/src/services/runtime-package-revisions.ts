import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { stableCanonicalJson, toCanonicalJson } from "@omnitwin/reconstruction-foundry";
import {
  RegisterRuntimePackageInputSchema,
  type CreateRuntimePackageRevisionInput,
  type RegisterRuntimePackageInput,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { runtimePackages } from "../db/schema.js";

const RETRYABLE_CONSTRAINTS = new Set([
  "runtime_packages_venue_room_revision_unique",
  "runtime_packages_venue_room_digest_unique",
  "runtime_packages_revision_monotonic",
]);

export type RuntimePackageRevisionRow = typeof runtimePackages.$inferSelect;

export interface LockedRuntimePackageRevisionStore {
  findByDigest(contentDigest: string): Promise<RuntimePackageRevisionRow | null>;
  findLatestRevision(): Promise<number | null>;
  insertRevision(
    input: RegisterRuntimePackageInput,
    revision: number,
    contentDigest: string,
  ): Promise<RuntimePackageRevisionRow>;
}

export interface RuntimePackageRevisionStore {
  withRoomLock<T>(
    venueSlug: string,
    roomSlug: string,
    operation: (store: LockedRuntimePackageRevisionStore) => Promise<T>,
  ): Promise<T>;
  isRetryableWriteConflict(error: unknown): boolean;
}

export interface CreatedRuntimePackageRevision {
  readonly row: RuntimePackageRevisionRow;
  readonly contentDigest: string;
  readonly created: boolean;
}

export interface RuntimePackageRevisionCreationHooks {
  /** Runs only after no exact digest exists and the requested revision is valid. */
  readonly beforeInsert?: () => Promise<void>;
}

export class RuntimePackageRevisionConflictError extends Error {
  readonly code = "RUNTIME_PACKAGE_REVISION_CONFLICT";

  constructor(
    readonly requestedRevision: number,
    readonly expectedRevision: number,
  ) {
    super(
      `Requested runtime package revision ${String(requestedRevision)}, but the next revision is ${String(expectedRevision)}.`,
    );
    this.name = "RuntimePackageRevisionConflictError";
  }
}

export class RuntimePackageRevisionIntegrityError extends Error {
  readonly code = "RUNTIME_PACKAGE_REVISION_INTEGRITY_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "RuntimePackageRevisionIntegrityError";
  }
}

export function canonicalRuntimePackageRevisionPayload(
  input: RegisterRuntimePackageInput,
): string {
  return stableCanonicalJson(toCanonicalJson({
    schemaVersion: "omnitwin.runtime-package-revision-content.v1",
    venueSlug: input.venueSlug,
    roomSlug: input.roomSlug,
    assetVersionIds: {
      primaryVisualAssetVersionId: input.primaryVisualAssetVersionId ?? null,
      semanticMeshAssetVersionId: input.semanticMeshAssetVersionId ?? null,
      collisionAssetVersionId: input.collisionAssetVersionId ?? null,
      pointCloudAssetVersionId: input.pointCloudAssetVersionId ?? null,
    },
    manifestJson: input.manifestJson,
    evidenceStatus: input.evidenceStatus,
    runtimeStatus: input.runtimeStatus,
  }));
}

export function computeRuntimePackageRevisionDigest(
  input: RegisterRuntimePackageInput,
): string {
  return createHash("sha256")
    .update(canonicalRuntimePackageRevisionPayload(input), "utf8")
    .digest("hex");
}

function inputFromRow(row: RuntimePackageRevisionRow): RegisterRuntimePackageInput {
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

function assertMatchingStoredRevision(
  row: RuntimePackageRevisionRow,
  expectedDigest: string,
): void {
  if (row.identityKind !== "content_sha256" || row.contentDigest !== expectedDigest) {
    throw new RuntimePackageRevisionIntegrityError(
      "A runtime package digest lookup returned a row without the matching content identity.",
    );
  }
  let storedDigest: string;
  try {
    storedDigest = computeRuntimePackageRevisionDigest(inputFromRow(row));
  } catch (error) {
    throw new RuntimePackageRevisionIntegrityError(
      `Stored runtime package content cannot be validated: ${error instanceof Error ? error.message : "unknown validation error"}`,
    );
  }
  if (storedDigest !== expectedDigest) {
    throw new RuntimePackageRevisionIntegrityError(
      "A stored runtime package content digest does not match its immutable package content.",
    );
  }
}

async function createAttempt(
  store: RuntimePackageRevisionStore,
  input: CreateRuntimePackageRevisionInput,
  contentDigest: string,
  hooks: RuntimePackageRevisionCreationHooks,
): Promise<CreatedRuntimePackageRevision> {
  return store.withRoomLock(
    input.package.venueSlug,
    input.package.roomSlug,
    async (lockedStore) => {
      const existing = await lockedStore.findByDigest(contentDigest);
      if (existing !== null) {
        assertMatchingStoredRevision(existing, contentDigest);
        return { row: existing, contentDigest, created: false };
      }

      const latestRevision = await lockedStore.findLatestRevision();
      const nextRevision = (latestRevision ?? 0) + 1;
      if (
        input.requestedRevision !== undefined &&
        input.requestedRevision !== nextRevision
      ) {
        throw new RuntimePackageRevisionConflictError(
          input.requestedRevision,
          nextRevision,
        );
      }

      await hooks.beforeInsert?.();

      const row = await lockedStore.insertRevision(
        input.package,
        nextRevision,
        contentDigest,
      );
      if (
        row.revision !== nextRevision ||
        row.identityKind !== "content_sha256" ||
        row.contentDigest !== contentDigest
      ) {
        throw new RuntimePackageRevisionIntegrityError(
          "The inserted runtime package revision did not return its expected immutable identity.",
        );
      }
      assertMatchingStoredRevision(row, contentDigest);
      return { row, contentDigest, created: true };
    },
  );
}

export async function createRuntimePackageRevision(
  store: RuntimePackageRevisionStore,
  input: CreateRuntimePackageRevisionInput,
  hooks: RuntimePackageRevisionCreationHooks = {},
): Promise<CreatedRuntimePackageRevision> {
  const contentDigest = computeRuntimePackageRevisionDigest(input.package);
  try {
    return await createAttempt(store, input, contentDigest, hooks);
  } catch (error) {
    if (
      error instanceof RuntimePackageRevisionConflictError ||
      error instanceof RuntimePackageRevisionIntegrityError ||
      !store.isRetryableWriteConflict(error)
    ) {
      throw error;
    }
    return createAttempt(store, input, contentDigest, hooks);
  }
}

function databaseErrorField(error: unknown, field: "code" | "constraint"): string | null {
  let cursor: unknown = error;
  const visited = new Set<unknown>();
  while (typeof cursor === "object" && cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    const record = cursor as Record<string, unknown>;
    const value = record[field];
    if (typeof value === "string") return value;
    cursor = record["cause"];
  }
  return null;
}

export function isRuntimePackageRevisionWriteConflict(error: unknown): boolean {
  const code = databaseErrorField(error, "code");
  if (code === "40001" || code === "40P01") return true;
  const constraint = databaseErrorField(error, "constraint");
  return (code === "23505" || code === "23514") &&
    constraint !== null &&
    RETRYABLE_CONSTRAINTS.has(constraint);
}

export function createDatabaseRuntimePackageRevisionStore(
  db: Database,
): RuntimePackageRevisionStore {
  return {
    async withRoomLock<T>(
      venueSlug: string,
      roomSlug: string,
      operation: (store: LockedRuntimePackageRevisionStore) => Promise<T>,
    ): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`
          select pg_advisory_xact_lock(
            hashtextextended(${`${venueSlug}\u001f${roomSlug}`}, 0)
          )
        `);

        const lockedStore: LockedRuntimePackageRevisionStore = {
          async findByDigest(contentDigest) {
            const [row] = await tx
              .select()
              .from(runtimePackages)
              .where(and(
                eq(runtimePackages.venueSlug, venueSlug),
                eq(runtimePackages.roomSlug, roomSlug),
                eq(runtimePackages.contentDigest, contentDigest),
              ))
              .limit(1);
            return row ?? null;
          },
          async findLatestRevision() {
            const [row] = await tx
              .select({ revision: runtimePackages.revision })
              .from(runtimePackages)
              .where(and(
                eq(runtimePackages.venueSlug, venueSlug),
                eq(runtimePackages.roomSlug, roomSlug),
              ))
              .orderBy(desc(runtimePackages.revision))
              .limit(1);
            return row?.revision ?? null;
          },
          async insertRevision(input, revision, contentDigest) {
            const [row] = await tx.insert(runtimePackages).values({
              venueSlug: input.venueSlug,
              roomSlug: input.roomSlug,
              revision,
              identityKind: "content_sha256",
              contentDigest,
              primaryVisualAssetVersionId: input.primaryVisualAssetVersionId ?? null,
              semanticMeshAssetVersionId: input.semanticMeshAssetVersionId ?? null,
              collisionAssetVersionId: input.collisionAssetVersionId ?? null,
              pointCloudAssetVersionId: input.pointCloudAssetVersionId ?? null,
              manifestJson: input.manifestJson,
              evidenceStatus: input.evidenceStatus,
              runtimeStatus: input.runtimeStatus,
            }).returning();
            if (row === undefined) {
              throw new RuntimePackageRevisionIntegrityError(
                "The database did not return the newly inserted runtime package revision.",
              );
            }
            return row;
          },
        };

        return operation(lockedStore);
      });
    },
    isRetryableWriteConflict: isRuntimePackageRevisionWriteConflict,
  };
}
