import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  ConfigurationReviewStatusSchema,
  PlatformRoleSchema,
  isPlannerEditable,
  type PlatformRole,
} from "@omnitwin/types";
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  configurationLayoutRevisions,
  configurations,
  placedObjects,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { getUserByClerkId, resolveVerifiedClerkEmail } from "../middleware/auth.js";

const FLUSH_DEBOUNCE_MS = 500;
const EDITABLE_REVIEW_STATUSES = ["draft", "changes_requested", "rejected"] as const;

export const ObjectDataSchema = z.object({
  id: z.string().uuid().optional(),
  assetId: z.string().uuid(),
  position: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }),
  rotation: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }),
  scale: z.number().positive(),
  sortOrder: z.number().int().nonnegative().optional(),
  clothed: z.boolean().optional(),
  clothStyle: z.enum(["black", "white"]).nullable().optional(),
  tableSetting: z.enum(["dinner"]).nullable().optional(),
  groupId: z.string().nullable().optional(),
});

export const UpdateObjectsMessage = z.object({
  type: z.literal("update_objects"),
  expectedRevision: z.number().int().min(1),
  objects: z.array(ObjectDataSchema).min(1).max(500),
});

export const DeleteObjectMessage = z.object({
  type: z.literal("delete_object"),
  expectedRevision: z.number().int().min(1),
  objectId: z.string().uuid(),
});

export const AuthMessage = z.object({
  type: z.literal("auth"),
  token: z.string().min(1),
});

const PingMessage = z.object({ type: z.literal("ping") });
const FlushMessage = z.object({ type: z.literal("flush") });

export const IncomingMessage = z.discriminatedUnion("type", [
  UpdateObjectsMessage,
  DeleteObjectMessage,
  PingMessage,
  FlushMessage,
]);

export type ObjectData = z.infer<typeof ObjectDataSchema>;
export type IncomingMessageType = z.infer<typeof IncomingMessage>;
export type AuthMessageType = z.infer<typeof AuthMessage>;

export interface WsUser {
  readonly userId: string;
  readonly userRole: string;
  readonly platformRole: PlatformRole;
  readonly userVenueId: string | null;
}

interface AutoSaveConfiguration {
  readonly userId: string | null;
  readonly venueId: string;
  readonly reviewStatus: string;
  readonly revision: number;
}

export type AutoSavePersistResult =
  | { readonly status: "saved"; readonly revision: number; readonly objectCount: number }
  | { readonly status: "not_found" }
  | { readonly status: "forbidden" }
  | { readonly status: "locked"; readonly reviewStatus: string }
  | { readonly status: "conflict"; readonly expectedRevision: number; readonly currentRevision: number };

export interface AutoSaveSnapshot {
  readonly expectedRevision: number;
  readonly updates: readonly ObjectData[];
  readonly deletes: readonly string[];
}

function canManageConfiguration(user: WsUser, config: AutoSaveConfiguration): boolean {
  if (user.platformRole === "admin") return true;
  if (config.userId === user.userId) return true;
  const hasVenueRole = user.userRole === "admin" || user.userRole === "staff" || user.userRole === "hallkeeper";
  return hasVenueRole && user.userVenueId !== null && config.venueId === user.userVenueId;
}

function canBypassReviewLock(user: WsUser): boolean {
  return user.platformRole === "admin" || user.userRole === "admin";
}

export function assessAutoSaveConfiguration(
  user: WsUser,
  config: AutoSaveConfiguration,
  expectedRevision: number,
): AutoSavePersistResult | { readonly status: "ok" } {
  if (!canManageConfiguration(user, config)) return { status: "forbidden" };

  const reviewStatus = ConfigurationReviewStatusSchema.safeParse(config.reviewStatus);
  if (!canBypassReviewLock(user) && (!reviewStatus.success || !isPlannerEditable(reviewStatus.data))) {
    return { status: "locked", reviewStatus: config.reviewStatus };
  }

  if (config.revision !== expectedRevision) {
    return { status: "conflict", expectedRevision, currentRevision: config.revision };
  }
  return { status: "ok" };
}

/**
 * Connection-local write buffer. A snapshot is acknowledged only after its
 * transaction commits. Failed and conflicted flushes therefore retain the
 * exact pending changes and can be retried with a `{ type: "flush" }` message.
 */
export class AutoSaveBuffer {
  readonly #updates: ObjectData[] = [];
  readonly #deletes: string[] = [];
  #expectedRevision: number | null = null;
  #activeFlush: Promise<AutoSavePersistResult | null> | null = null;

  get pendingCount(): number {
    return this.#updates.length + this.#deletes.length;
  }

  get pendingRevision(): number | null {
    return this.#expectedRevision;
  }

  enqueueUpdates(expectedRevision: number, updates: readonly ObjectData[]): boolean {
    if (!this.#acceptsRevision(expectedRevision)) return false;
    this.#updates.push(...updates);
    return true;
  }

  enqueueDelete(expectedRevision: number, objectId: string): boolean {
    if (!this.#acceptsRevision(expectedRevision)) return false;
    this.#deletes.push(objectId);
    return true;
  }

  async flush(
    persist: (snapshot: AutoSaveSnapshot) => Promise<AutoSavePersistResult>,
  ): Promise<AutoSavePersistResult | null> {
    if (this.#activeFlush !== null) return this.#activeFlush;
    const snapshot = this.#snapshot();
    if (snapshot === null) return null;

    const run = (async (): Promise<AutoSavePersistResult> => {
      const result = await persist(snapshot);
      if (result.status === "saved") this.#acknowledge(snapshot, result.revision);
      return result;
    })();
    this.#activeFlush = run;
    try {
      return await run;
    } finally {
      this.#activeFlush = null;
    }
  }

  #acceptsRevision(expectedRevision: number): boolean {
    if (this.#expectedRevision !== null && this.#expectedRevision !== expectedRevision) return false;
    this.#expectedRevision = expectedRevision;
    return true;
  }

  #snapshot(): AutoSaveSnapshot | null {
    if (this.#expectedRevision === null || this.pendingCount === 0) return null;
    return {
      expectedRevision: this.#expectedRevision,
      updates: [...this.#updates],
      deletes: [...this.#deletes],
    };
  }

  #acknowledge(snapshot: AutoSaveSnapshot, revision: number): void {
    this.#updates.splice(0, snapshot.updates.length);
    this.#deletes.splice(0, snapshot.deletes.length);
    this.#expectedRevision = this.pendingCount === 0 ? null : revision;
  }
}

const MockWsTokenSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  platformRole: PlatformRoleSchema.default("none"),
  venueId: z.string().nullable().optional().default(null),
});

export async function resolveWsUser(
  db: Database,
  token: string,
  isTestMode: boolean = process.env["NODE_ENV"] === "test",
): Promise<WsUser | null> {
  if (isTestMode && token.startsWith("{")) {
    try {
      const parsed = MockWsTokenSchema.safeParse(JSON.parse(token));
      if (!parsed.success) return null;
      return {
        userId: parsed.data.id,
        userRole: parsed.data.role,
        platformRole: parsed.data.platformRole,
        userVenueId: parsed.data.venueId,
      };
    } catch {
      return null;
    }
  }

  try {
    const { verifyToken } = await import("@clerk/backend");
    const secretKey = process.env["CLERK_SECRET_KEY"] ?? "";
    const payload = await verifyToken(token, { secretKey });
    const emailResolution = resolveVerifiedClerkEmail(payload as Record<string, unknown>);
    if (!emailResolution.ok) return null;

    const dbUser = await getUserByClerkId(db, payload.sub, emailResolution.email);
    if (dbUser === null) return null;
    return {
      userId: dbUser.id,
      userRole: dbUser.role,
      platformRole: dbUser.platformRole,
      userVenueId: dbUser.venueId,
    };
  } catch {
    return null;
  }
}

function configAccessCondition(user: WsUser): SQL {
  if (user.platformRole === "admin") return sql`true`;
  const owner = eq(configurations.userId, user.userId);
  const hasVenueRole = user.userRole === "admin" || user.userRole === "staff" || user.userRole === "hallkeeper";
  if (!hasVenueRole || user.userVenueId === null) return owner;
  return or(owner, eq(configurations.venueId, user.userVenueId)) ?? sql`false`;
}

function metadataForObject(object: ObjectData, existing: unknown = null): Record<string, unknown> | null {
  const parsedExisting = z.record(z.unknown()).safeParse(existing);
  const metadata: Record<string, unknown> = parsedExisting.success ? { ...parsedExisting.data } : {};
  if (object.clothed !== undefined) metadata["clothed"] = object.clothed;
  if (object.clothStyle !== undefined) metadata["clothStyle"] = object.clothStyle;
  if (object.tableSetting !== undefined) metadata["tableSetting"] = object.tableSetting;
  if (object.groupId !== undefined) metadata["groupId"] = object.groupId;
  return Object.keys(metadata).length > 0 ? metadata : null;
}

async function loadAutoSaveConfiguration(
  db: Pick<Database, "select">,
  configId: string,
): Promise<AutoSaveConfiguration | null> {
  const [config] = await db.select({
    userId: configurations.userId,
    venueId: configurations.venueId,
    reviewStatus: configurations.reviewStatus,
    revision: configurations.revision,
  }).from(configurations)
    .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
    .limit(1);
  return config ?? null;
}

export async function persistAutoSaveSnapshot(
  db: Database,
  configId: string,
  user: WsUser,
  snapshot: AutoSaveSnapshot,
): Promise<AutoSavePersistResult> {
  const initial = await loadAutoSaveConfiguration(db, configId);
  if (initial === null) return { status: "not_found" };
  const assessment = assessAutoSaveConfiguration(user, initial, snapshot.expectedRevision);
  if (assessment.status !== "ok") return assessment;

  return db.transaction(async (tx) => {
    const conditions: SQL[] = [
      eq(configurations.id, configId),
      eq(configurations.revision, snapshot.expectedRevision),
      isNull(configurations.deletedAt),
      configAccessCondition(user),
    ];
    if (!canBypassReviewLock(user)) {
      conditions.push(inArray(configurations.reviewStatus, EDITABLE_REVIEW_STATUSES));
    }

    const [advanced] = await tx.update(configurations).set({
      revision: sql`${configurations.revision} + 1`,
      updatedAt: new Date(),
    }).where(and(...conditions)).returning({ revision: configurations.revision });

    if (advanced === undefined) {
      const current = await loadAutoSaveConfiguration(tx, configId);
      if (current === null) return { status: "not_found" };
      const currentAssessment = assessAutoSaveConfiguration(user, current, snapshot.expectedRevision);
      return currentAssessment.status === "ok"
        ? { status: "conflict", expectedRevision: snapshot.expectedRevision, currentRevision: current.revision }
        : currentAssessment;
    }

    if (snapshot.deletes.length > 0) {
      await tx.delete(placedObjects).where(and(
        inArray(placedObjects.id, snapshot.deletes),
        eq(placedObjects.configurationId, configId),
      ));
    }

    for (const object of snapshot.updates.filter((candidate) => candidate.id !== undefined)) {
      if (object.id === undefined) continue;
      const [existing] = await tx.select({ metadata: placedObjects.metadata }).from(placedObjects)
        .where(and(eq(placedObjects.id, object.id), eq(placedObjects.configurationId, configId)))
        .limit(1);
      await tx.update(placedObjects).set({
        assetDefinitionId: object.assetId,
        positionX: String(object.position.x),
        positionY: String(object.position.y),
        positionZ: String(object.position.z),
        rotationX: String(object.rotation.x),
        rotationY: String(object.rotation.y),
        rotationZ: String(object.rotation.z),
        scale: String(object.scale),
        coordinateWriteToken: randomUUID(),
        ...(object.sortOrder === undefined ? {} : { sortOrder: object.sortOrder }),
        metadata: metadataForObject(object, existing?.metadata),
      }).where(and(eq(placedObjects.id, object.id), eq(placedObjects.configurationId, configId)));
    }

    const inserts = snapshot.updates.filter((candidate) => candidate.id === undefined);
    if (inserts.length > 0) {
      await tx.insert(placedObjects).values(inserts.map((object) => ({
        configurationId: configId,
        assetDefinitionId: object.assetId,
        positionX: String(object.position.x),
        positionY: String(object.position.y),
        positionZ: String(object.position.z),
        rotationX: String(object.rotation.x),
        rotationY: String(object.rotation.y),
        rotationZ: String(object.rotation.z),
        scale: String(object.scale),
        coordinateWriteToken: randomUUID(),
        sortOrder: object.sortOrder ?? 0,
        metadata: metadataForObject(object),
      })));
    }

    const objects = await tx.select().from(placedObjects)
      .where(eq(placedObjects.configurationId, configId))
      .orderBy(placedObjects.sortOrder);
    await tx.insert(configurationLayoutRevisions).values({
      configurationId: configId,
      revision: advanced.revision,
      source: "websocket_autosave",
      actorUserId: user.userId,
      payload: { objectCount: objects.length, objects },
    });
    return {
      status: "saved",
      revision: advanced.revision,
      objectCount: snapshot.updates.length + snapshot.deletes.length,
    };
  });
}

function autoSaveErrorPayload(result: Exclude<AutoSavePersistResult, { status: "saved" }>): Record<string, unknown> {
  switch (result.status) {
    case "not_found":
      return { type: "error", code: "CONFIGURATION_NOT_FOUND", message: "Configuration not found" };
    case "forbidden":
      return { type: "error", code: "FORBIDDEN", message: "Permission denied" };
    case "locked":
      return { type: "error", code: "CONFIG_LOCKED", message: "Configuration is locked for review", reviewStatus: result.reviewStatus };
    case "conflict":
      return {
        type: "error",
        code: "REVISION_CONFLICT",
        message: "Configuration changed in another session",
        expectedRevision: result.expectedRevision,
        currentRevision: result.currentRevision,
      };
  }
}

export function shouldScheduleBufferedFlush(
  result: AutoSavePersistResult | null,
  pendingCount: number,
): boolean {
  // A stale/locked/failed snapshot needs an explicit client decision. Blindly
  // retrying the same revision would create a permanent 500 ms DB loop.
  return result?.status === "saved" && pendingCount > 0;
}

export async function registerAutoSave(server: FastifyInstance, db: Database): Promise<void> {
  server.get("/ws/configurations/:configId", { websocket: true }, async (socket, request) => {
    const parsedParams = z.object({ configId: z.string().uuid() }).safeParse(request.params);
    if (!parsedParams.success) {
      socket.send(JSON.stringify({ type: "error", code: "VALIDATION_ERROR", message: "Invalid configId" }));
      socket.close();
      return;
    }

    const configId = parsedParams.data.configId;
    const buffer = new AutoSaveBuffer();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let flushInFlight: Promise<void> | null = null;
    let authenticatedUser: WsUser | null = null;
    let authenticationInFlight = false;

    function send(payload: Record<string, unknown>): void {
      if (socket.readyState === 1) socket.send(JSON.stringify(payload));
    }

    async function performFlush(notify: boolean): Promise<void> {
      if (flushTimer !== null) clearTimeout(flushTimer);
      flushTimer = null;
      const user = authenticatedUser;
      if (user === null) {
        if (notify) send({ type: "error", code: "UNAUTHORIZED", message: "Authentication required" });
        return;
      }

      try {
        const result = await buffer.flush((snapshot) => persistAutoSaveSnapshot(db, configId, user, snapshot));
        if (shouldScheduleBufferedFlush(result, buffer.pendingCount)) scheduleFlush();
        if (!notify || result === null) return;
        if (result.status === "saved") {
          send({
            type: "saved",
            revision: result.revision,
            objectCount: result.objectCount,
            pendingObjectCount: buffer.pendingCount,
            timestamp: new Date().toISOString(),
          });
        } else {
          send({ ...autoSaveErrorPayload(result), pendingObjectCount: buffer.pendingCount });
        }
      } catch (err) {
        request.log.error({ err, configId, userId: user.userId }, "WebSocket auto-save flush failed");
        if (notify) {
          send({
            type: "error",
            code: "AUTOSAVE_FAILED",
            message: "Auto-save failed; buffered changes are retained for retry",
            retryable: true,
            pendingObjectCount: buffer.pendingCount,
          });
        }
      }
    }

    function flush(notify: boolean = true): Promise<void> {
      if (flushInFlight !== null) return flushInFlight;
      flushInFlight = performFlush(notify).finally(() => {
        flushInFlight = null;
      });
      return flushInFlight;
    }

    function scheduleFlush(): void {
      if (flushTimer !== null) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => { void flush(); }, FLUSH_DEBOUNCE_MS);
    }

    socket.on("message", (raw: Buffer | string) => {
      let data: unknown;
      try {
        data = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf-8"));
      } catch {
        send({ type: "error", code: "INVALID_JSON", message: "Invalid JSON" });
        return;
      }

      if (authenticatedUser === null) {
        if (authenticationInFlight) {
          send({ type: "error", code: "AUTHENTICATION_IN_PROGRESS", message: "Authentication in progress" });
          return;
        }
        const parsedAuth = AuthMessage.safeParse(data);
        if (!parsedAuth.success) {
          send({ type: "error", code: "UNAUTHORIZED", message: "Authentication required" });
          socket.close();
          return;
        }

        authenticationInFlight = true;
        void resolveWsUser(db, parsedAuth.data.token).then((resolved) => {
          authenticationInFlight = false;
          if (resolved === null) {
            send({ type: "error", code: "UNAUTHORIZED", message: "Invalid token" });
            socket.close();
            return;
          }
          authenticatedUser = resolved;
          send({ type: "authenticated" });
        }).catch((err: unknown) => {
          authenticationInFlight = false;
          request.log.warn({ err }, "WebSocket authentication failed");
          send({ type: "error", code: "UNAUTHORIZED", message: "Invalid token" });
          socket.close();
        });
        return;
      }

      const parsed = IncomingMessage.safeParse(data);
      if (!parsed.success) {
        send({
          type: "error",
          code: "VALIDATION_ERROR",
          message: `Invalid message: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`,
        });
        return;
      }

      switch (parsed.data.type) {
        case "ping":
          send({ type: "pong" });
          break;
        case "flush":
          void flush();
          break;
        case "update_objects":
          if (!buffer.enqueueUpdates(parsed.data.expectedRevision, parsed.data.objects)) {
            send({
              type: "error",
              code: "REVISION_QUEUE_MISMATCH",
              message: "Pending changes use a different expected revision; flush or reconnect before sending more",
              pendingRevision: buffer.pendingRevision,
            });
            return;
          }
          scheduleFlush();
          break;
        case "delete_object":
          if (!buffer.enqueueDelete(parsed.data.expectedRevision, parsed.data.objectId)) {
            send({
              type: "error",
              code: "REVISION_QUEUE_MISMATCH",
              message: "Pending changes use a different expected revision; flush or reconnect before sending more",
              pendingRevision: buffer.pendingRevision,
            });
            return;
          }
          scheduleFlush();
          break;
      }
    });

    socket.on("close", () => {
      if (flushTimer !== null) clearTimeout(flushTimer);
      if (authenticatedUser !== null && buffer.pendingCount > 0) void flush(false);
    });
  });
}
