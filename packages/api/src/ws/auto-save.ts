import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  CONFIGURATION_REVIEW_STATUSES,
  ConfigurationReviewStatusSchema,
  PlatformRoleSchema,
  canJoinLayoutLive,
  isLiveClientFrameType,
  isPlannerEditable,
  type PlatformRole,
} from "@omnitwin/types";
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  configurationLayoutRevisions,
  configurations,
  placedObjects,
  users,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { clerkTokenVerificationOptions, getUserByClerkId } from "../middleware/auth.js";
import { resolveVerifiedClerkEmailWithFallback } from "../middleware/clerk-email.js";
import { emit, subscribe } from "../observability/event-bus.js";
import { LayoutLiveHub, type LayoutLiveConnection } from "./layout-live.js";
import { currentAuthority, readCurrentSocketUser, readCurrentSocketUsers } from "./socket-identity.js";

const FLUSH_DEBOUNCE_MS = 500;
/** Live co-editing heartbeat: the Diary's cadence (Canon §15). */
const LIVE_HEARTBEAT_INTERVAL_MS = 20_000;
/** The review lock as the write's own condition: the shared editable set, never a copy of it. */
const EDITABLE_REVIEW_STATUSES = CONFIGURATION_REVIEW_STATUSES.filter(isPlannerEditable);

export const ObjectDataSchema = z.object({
  id: z.uuid().optional(),
  assetId: z.uuid(),
  position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  rotation: z.object({ x: z.number(), y: z.number(), z: z.number() }),
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
  objectId: z.uuid(),
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
  /** The Clerk account the socket signed in with (absent or null for a
   *  test-mode token). A write re-reads the user row and refuses one no
   *  longer linked to it (socket-identity.ts). */
  readonly clerkId?: string | null;
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
  clerkId: z.string().min(1).nullable().optional().default(null),
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
        clerkId: parsed.data.clerkId,
      };
    } catch {
      return null;
    }
  }

  try {
    const { verifyToken } = await import("@clerk/backend");
    const secretKey = process.env["CLERK_SECRET_KEY"] ?? "";
    const payload = await verifyToken(token, clerkTokenVerificationOptions(secretKey));
    // Claims first; Backend-API fallback when the instance issues default
    // tokens with no email claim (middleware/clerk-email.ts). Fail-closed.
    const emailResolution = await resolveVerifiedClerkEmailWithFallback(
      payload as Record<string, unknown>,
      payload.sub,
    );
    if (!emailResolution.ok) return null;

    const dbUser = await getUserByClerkId(db, payload.sub, emailResolution.email);
    if (dbUser === null) return null;
    return {
      userId: dbUser.id,
      userRole: dbUser.role,
      platformRole: dbUser.platformRole,
      userVenueId: dbUser.venueId,
      clerkId: payload.sub,
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
  const parsedExisting = z.record(z.string(), z.unknown()).safeParse(existing);
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

/**
 * The socket's user as the database holds them now, held FOR SHARE to the end
 * of the caller's transaction, or null when they may no longer write
 * (release audit configs-4): an offboarded, moved or demoted person's open
 * socket, or a venue admin's after demotion, writes with the role they hold
 * now, never the one they connected with.
 */
async function currentWsUser(tx: Pick<Database, "select">, user: WsUser): Promise<WsUser | null> {
  const clerkId = user.clerkId ?? null;
  const current = await readCurrentSocketUser(tx, { userId: user.userId, clerkId }, { lock: true });
  if (current === null) return null;
  return { userId: user.userId, userRole: current.role, platformRole: current.platformRole, userVenueId: current.venueId, clerkId };
}

export async function persistAutoSaveSnapshot(
  db: Database,
  configId: string,
  connected: WsUser,
  snapshot: AutoSaveSnapshot,
): Promise<AutoSavePersistResult> {
  return db.transaction(async (tx) => {
    const user = await currentWsUser(tx, connected);
    if (user === null) return { status: "forbidden" };
    const initial = await loadAutoSaveConfiguration(tx, configId);
    if (initial === null) return { status: "not_found" };
    const assessment = assessAutoSaveConfiguration(user, initial, snapshot.expectedRevision);
    if (assessment.status !== "ok") return assessment;

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

/**
 * The live room this authenticated user may join for this layout, or null.
 * Owner and venue floor only (canJoinLayoutLive); customers get nothing new.
 * Reads the configuration and the user's display name — the hub itself never
 * touches the database.
 */
export async function resolveLayoutLiveUser(
  db: Database,
  configId: string,
  user: WsUser,
): Promise<{ readonly userId: string; readonly name: string; readonly role: string } | null> {
  const [config] = await db.select({ userId: configurations.userId, venueId: configurations.venueId })
    .from(configurations)
    .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
    .limit(1);
  if (config === undefined) return null;
  const admitted = canJoinLayoutLive(
    { userId: user.userId, role: user.userRole, venueId: user.userVenueId, platformRole: user.platformRole },
    { ownerUserId: config.userId, venueId: config.venueId },
  );
  if (!admitted) return null;
  const [profile] = await db.select({ name: users.name }).from(users).where(eq(users.id, user.userId)).limit(1);
  const name = profile?.name.trim() ?? "";
  return { userId: user.userId, name: name.length > 0 ? name.slice(0, 120) : "Colleague", role: user.userRole };
}

/**
 * The periodic access re-check: every connection in every live room is
 * checked against the user's CURRENT role and venue and the layout's current
 * owner, venue and deletion state, and revoked if no longer admitted. Two
 * queries per room. A database error rejects (the caller logs and retries
 * next beat) rather than revoking everyone on a blip.
 */
export async function revalidateLayoutLiveRooms(db: Database, hub: LayoutLiveHub): Promise<number> {
  let revoked = 0;
  for (const [configId, connections] of hub.rooms()) {
    const [config] = await db.select({ userId: configurations.userId, venueId: configurations.venueId })
      .from(configurations)
      .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
      .limit(1);
    const rows = await readCurrentSocketUsers(db, connections.map((connection) => connection.user.userId));
    for (const connection of connections) {
      // An unlinked Clerk account (offboarded) is revoked like a missing row.
      const user = currentAuthority(rows.get(connection.user.userId), { userId: connection.user.userId, clerkId: connection.clerkId });
      const admitted = config !== undefined && user !== null && canJoinLayoutLive(
        { userId: connection.user.userId, role: user.role, venueId: user.venueId, platformRole: user.platformRole },
        { ownerUserId: config.userId, venueId: config.venueId },
      );
      if (!admitted) {
        hub.revoke(connection);
        revoked += 1;
      }
    }
  }
  return revoked;
}

export async function registerAutoSave(server: FastifyInstance, db: Database): Promise<void> {
  // Live co-editing v1: presence and live ops ride this socket after auth.
  const hub = new LayoutLiveHub();
  const unsubscribeLayoutChanged = subscribe("layout.changed", {
    name: "layout-live-hub",
    handle: (payload) => {
      hub.announceCommit(payload.configId, payload.revision, payload.actorUserId);
    },
  });
  let revalidating = false;
  const heartbeat = setInterval(() => {
    hub.pingAll();
    hub.sweepStale();
    // Re-check every member against the database: a role change, a move to
    // another venue or a deleted layout ends live access within one beat.
    if (revalidating) return;
    revalidating = true;
    void revalidateLayoutLiveRooms(db, hub)
      .catch((err: unknown) => { server.log.warn({ err }, "layout-live access re-check failed; retried next beat"); })
      .finally(() => { revalidating = false; });
  }, LIVE_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  server.addHook("onClose", () => {
    clearInterval(heartbeat);
    unsubscribeLayoutChanged();
  });

  server.get("/ws/configurations/:configId", { websocket: true }, async (socket, request) => {
    const parsedParams = z.object({ configId: z.uuid() }).safeParse(request.params);
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
    let liveConnection: LayoutLiveConnection | null = null;
    let closed = false;

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
        if (result?.status === "forbidden") {
          // The person may no longer write this layout as the database holds
          // them now (configs-4): the socket ends here, its buffer with it.
          // A reconnect authenticates afresh.
          authenticatedUser = null;
          send({ ...autoSaveErrorPayload(result), pendingObjectCount: buffer.pendingCount });
          socket.close();
          return;
        }
        if (result?.status === "saved") {
          emit(request.log, "layout.changed", {
            configId,
            revision: result.revision,
            actorUserId: user.userId,
            source: "websocket_autosave",
            at: new Date().toISOString(),
          });
        }
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
          // Live co-editing: join the layout's room when this user may. A
          // refusal is silent — the auto-save protocol is unchanged for them.
          void resolveLayoutLiveUser(db, configId, resolved).then((liveUser) => {
            if (liveUser === null || closed || socket.readyState !== 1) return;
            liveConnection = hub.join(configId, socket, liveUser, resolved.clerkId ?? null);
          }).catch((err: unknown) => {
            request.log.warn({ err, configId }, "layout-live join failed");
          });
        }).catch((err: unknown) => {
          authenticationInFlight = false;
          request.log.warn({ err }, "WebSocket authentication failed");
          send({ type: "error", code: "UNAUTHORIZED", message: "Invalid token" });
          socket.close();
        });
        return;
      }

      if (liveConnection !== null) hub.touch(liveConnection);
      const frameType = typeof data === "object" && data !== null ? (data as { readonly type?: unknown }).type : undefined;
      if (isLiveClientFrameType(frameType)) {
        // Ephemeral frames never reach the write buffer. Without a live room
        // (not admitted, or still joining) they are dropped silently.
        if (liveConnection !== null) {
          const byteLength = typeof raw === "string" ? Buffer.byteLength(raw) : raw.length;
          try {
            hub.handleClientFrame(liveConnection, data, byteLength);
          } catch (err) {
            // Never let one frame take the socket (or the process) down.
            request.log.warn({ err, configId }, "layout-live frame dropped");
          }
        }
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
      closed = true;
      if (liveConnection !== null) {
        hub.leave(liveConnection);
        liveConnection = null;
      }
      if (flushTimer !== null) clearTimeout(flushTimer);
      if (authenticatedUser !== null && buffer.pendingCount > 0) void flush(false);
    });
  });
}
