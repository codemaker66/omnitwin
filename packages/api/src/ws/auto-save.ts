import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { configurations, placedObjects } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// WebSocket auto-save — debounced placed object sync
// ---------------------------------------------------------------------------

/** Debounce interval for flushing buffered updates to DB. */
const FLUSH_DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Message schemas
// ---------------------------------------------------------------------------

const ObjectDataSchema = z.object({
  id: z.string().uuid().optional(),
  assetId: z.string().uuid(),
  position: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }),
  rotation: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }),
  scale: z.number().positive(),
});

const UpdateObjectsMessage = z.object({
  type: z.literal("update_objects"),
  objects: z.array(ObjectDataSchema).min(1).max(500),
});

const DeleteObjectMessage = z.object({
  type: z.literal("delete_object"),
  objectId: z.string().uuid(),
});

const PingMessage = z.object({
  type: z.literal("ping"),
});

const IncomingMessage = z.discriminatedUnion("type", [
  UpdateObjectsMessage,
  DeleteObjectMessage,
  PingMessage,
]);

export type IncomingMessageType = z.infer<typeof IncomingMessage>;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function registerAutoSave(
  server: FastifyInstance,
  db: Database,
): Promise<void> {
  server.get("/ws/configurations/:configId", { websocket: true }, async (socket, request) => {
    // --- Authenticate via query param token ---
    const url = new URL(request.url, `http://${request.hostname}`);
    const token = url.searchParams.get("token");

    if (token === null) {
      socket.send(JSON.stringify({ type: "error", message: "Missing token" }));
      socket.close();
      return;
    }

    let userId: string;
    let userRole: string;
    let userVenueId: string | null;
    try {
      // In test mode ONLY, accept JSON-encoded mock tokens
      const isTest = process.env["NODE_ENV"] === "test" || process.env["VITEST"] !== undefined;
      if (isTest && token.startsWith("{")) {
        const mock = JSON.parse(token) as { id: string; role: string; venueId: string | null };
        userId = mock.id;
        userRole = mock.role;
        userVenueId = mock.venueId ?? null;
      } else {
        // Clerk token verification — import verifyToken dynamically to avoid
        // circular dependency issues at module scope
        const { verifyToken } = await import("@clerk/backend");
        const secretKey = process.env["CLERK_SECRET_KEY"] ?? "";
        const payload = await verifyToken(token, { secretKey });
        userId = payload.sub;
        userRole = ((payload as Record<string, unknown>)["role"] as string) ?? "planner";
        userVenueId = ((payload as Record<string, unknown>)["venueId"] as string) ?? null;
      }
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Invalid token" }));
      socket.close();
      return;
    }

    const rawConfigId = (request.params as { configId?: string }).configId;
    if (rawConfigId === undefined) {
      socket.send(JSON.stringify({ type: "error", message: "Missing configId" }));
      socket.close();
      return;
    }
    const configId: string = rawConfigId;

    // --- Buffer + debounce ---
    let buffer: z.infer<typeof ObjectDataSchema>[] = [];
    let deleteBuffer: string[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    async function flush(): Promise<void> {
      const updates = [...buffer];
      const deletes = [...deleteBuffer];
      buffer = [];
      deleteBuffer = [];
      flushTimer = null;

      try {
        // Verify config ownership (on each flush in case permissions change)
        const [config] = await db.select({ userId: configurations.userId, venueId: configurations.venueId })
          .from(configurations)
          .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
          .limit(1);

        if (config === undefined) {
          socket.send(JSON.stringify({ type: "error", message: "Configuration not found" }));
          return;
        }

        const isOwner = config.userId === userId;
        const isVenueManager = userRole === "admin" ||
          ((userRole === "staff" || userRole === "hallkeeper") && config.venueId === userVenueId);

        if (!isOwner && !isVenueManager) {
          socket.send(JSON.stringify({ type: "error", message: "Permission denied" }));
          return;
        }

        // Atomic flush: deletes + updates + inserts in one transaction
        const toInsert = updates.filter((o) => o.id === undefined);
        const toUpdate = updates.filter((o) => o.id !== undefined);

        await db.transaction(async (tx) => {
          if (deletes.length > 0) {
            await tx.delete(placedObjects).where(
              and(inArray(placedObjects.id, deletes), eq(placedObjects.configurationId, configId)),
            );
          }

          for (const obj of toUpdate) {
            if (obj.id === undefined) continue;
            await tx.update(placedObjects).set({
              assetDefinitionId: obj.assetId,
              positionX: String(obj.position.x),
              positionY: String(obj.position.y),
              positionZ: String(obj.position.z),
              rotationX: String(obj.rotation.x),
              rotationY: String(obj.rotation.y),
              rotationZ: String(obj.rotation.z),
              scale: String(obj.scale),
            }).where(and(eq(placedObjects.id, obj.id), eq(placedObjects.configurationId, configId)));
          }

          if (toInsert.length > 0) {
            await tx.insert(placedObjects).values(
              toInsert.map((obj) => ({
                configurationId: configId,
                assetDefinitionId: obj.assetId,
                positionX: String(obj.position.x),
                positionY: String(obj.position.y),
                positionZ: String(obj.position.z),
                rotationX: String(obj.rotation.x),
                rotationY: String(obj.rotation.y),
                rotationZ: String(obj.rotation.z),
                scale: String(obj.scale),
              })),
            );
          }
        });

        const objectCount = updates.length + deletes.length;
        socket.send(JSON.stringify({
          type: "saved",
          objectCount,
          timestamp: new Date().toISOString(),
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error during flush";
        socket.send(JSON.stringify({ type: "error", message }));
      }
    }

    function scheduleFlush(): void {
      if (flushTimer !== null) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => { void flush(); }, FLUSH_DEBOUNCE_MS);
    }

    // --- Handle messages ---
    socket.on("message", (raw: Buffer | string) => {
      let data: unknown;
      try {
        data = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf-8"));
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      const parsed = IncomingMessage.safeParse(data);
      if (!parsed.success) {
        socket.send(JSON.stringify({
          type: "error",
          message: `Invalid message: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
        }));
        return;
      }

      switch (parsed.data.type) {
        case "ping":
          socket.send(JSON.stringify({ type: "pong" }));
          break;

        case "update_objects":
          buffer.push(...parsed.data.objects);
          scheduleFlush();
          break;

        case "delete_object":
          deleteBuffer.push(parsed.data.objectId);
          scheduleFlush();
          break;
      }
    });

    // --- Flush on disconnect ---
    socket.on("close", () => {
      if (flushTimer !== null) clearTimeout(flushTimer);
      if (buffer.length > 0 || deleteBuffer.length > 0) {
        void flush();
      }
    });
  });
}
