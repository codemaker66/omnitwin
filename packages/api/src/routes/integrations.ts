import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  CreateIntegrationConnectionSchema,
  CreateWebsiteEmbedConfigSchema,
  IntegrationConnectionRecordSchema,
  UpdateIntegrationConnectionSchema,
  WebsiteEmbedConfigSchema,
  WebhookOutboundTestInputSchema,
  type IntegrationConnectionRecord,
  type WebsiteEmbedConfig,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  integrationConnections,
  integrationEvents,
  spaces,
  venues,
  websiteEmbedConfigs,
} from "../db/schema.js";
import { authenticate } from "../middleware/auth.js";
import {
  createWebhookSignatureStub,
  publicIntegrationConnection,
  safeEmbedConfig,
} from "../services/integration-layer.js";

const IdParam = z.object({ id: z.string().uuid() });
const VenueQuery = z.object({ venueId: z.string().uuid().optional() });

type AuthedUser = { readonly id: string; readonly role: string; readonly venueId: string | null };
type IntegrationConnectionUpdate = Partial<Pick<
  typeof integrationConnections.$inferInsert,
  "label" | "status" | "credentialMode" | "credentialRef" | "config" | "updatedAt"
>>;

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

function canManageVenue(user: AuthedUser, venueId: string): boolean {
  if (user.role === "admin") return true;
  return (user.role === "staff" || user.role === "planner") && user.venueId === venueId;
}

function resolveVenueScope(
  request: FastifyRequest,
  reply: FastifyReply,
  requestedVenueId: string | undefined,
): string | null {
  const user = request.user;
  if (user.role === "admin") {
    if (requestedVenueId === undefined) {
      void reply.status(400).send({
        error: "Admin integration requests must provide venueId",
        code: "VENUE_REQUIRED",
      });
      return null;
    }
    return requestedVenueId;
  }
  if (user.venueId === null) {
    void reply.status(403).send({ error: "User has no venue scope", code: "FORBIDDEN" });
    return null;
  }
  if (requestedVenueId !== undefined && requestedVenueId !== user.venueId) {
    void reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    return null;
  }
  return user.venueId;
}

function toIso(value: Date): string {
  return value.toISOString();
}

function serializeConnection(row: typeof integrationConnections.$inferSelect): IntegrationConnectionRecord {
  return IntegrationConnectionRecordSchema.parse({
    id: row.id,
    venueId: row.venueId,
    provider: row.provider,
    label: row.label,
    status: row.status,
    credentialMode: row.credentialMode,
    credentialRef: row.credentialRef,
    config: row.config,
    healthStatus: row.healthStatus,
    lastCheckedAt: row.lastCheckedAt === null ? null : toIso(row.lastCheckedAt),
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

function serializeEmbed(row: typeof websiteEmbedConfigs.$inferSelect): WebsiteEmbedConfig {
  return WebsiteEmbedConfigSchema.parse({
    id: row.id,
    venueId: row.venueId,
    roomId: row.roomId,
    embedKey: row.embedKey,
    venueName: row.venueName,
    roomName: row.roomName,
    ctaLabel: row.ctaLabel,
    ctaUrl: row.ctaUrl,
    safeMode: row.safeMode,
    analyticsMode: row.analyticsMode,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

function embedKeyFor(venueName: string, roomName: string | null): string {
  const base = `${venueName}-${roomName ?? "venue"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base.length >= 6 ? base : "venue-embed"}-${suffix}`;
}

export async function integrationRoutes(server: FastifyInstance, opts: { readonly db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const query = VenueQuery.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error.issues);
    const venueId = resolveVenueScope(request, reply, query.data.venueId);
    if (venueId === null) return;
    const rows = await db.select().from(integrationConnections)
      .where(eq(integrationConnections.venueId, venueId))
      .orderBy(desc(integrationConnections.updatedAt));
    return { data: rows.map((row) => publicIntegrationConnection(serializeConnection(row))) };
  });

  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateIntegrationConnectionSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    if (!canManageVenue(request.user, parsed.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const [inserted] = await db.insert(integrationConnections).values({
      venueId: parsed.data.venueId,
      provider: parsed.data.provider,
      label: parsed.data.label,
      status: parsed.data.status,
      credentialMode: parsed.data.credentialMode,
      credentialRef: parsed.data.credentialRef ?? null,
      config: parsed.data.config,
      createdBy: request.user.id,
    }).returning();
    if (inserted === undefined) {
      return reply.status(500).send({ error: "Failed to create integration connection", code: "INTEGRATION_CREATE_FAILED" });
    }
    return reply.status(201).send({ data: publicIntegrationConnection(serializeConnection(inserted)) });
  });

  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const parsed = UpdateIntegrationConnectionSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    const [existing] = await db.select().from(integrationConnections)
      .where(eq(integrationConnections.id, params.data.id))
      .limit(1);
    if (existing === undefined) {
      return reply.status(404).send({ error: "Integration connection not found", code: "NOT_FOUND" });
    }
    if (!canManageVenue(request.user, existing.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const updates: IntegrationConnectionUpdate = { updatedAt: new Date() };
    if (parsed.data.label !== undefined) updates.label = parsed.data.label;
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.credentialMode !== undefined) updates.credentialMode = parsed.data.credentialMode;
    if (parsed.data.credentialRef !== undefined) updates.credentialRef = parsed.data.credentialRef;
    if (parsed.data.config !== undefined) updates.config = parsed.data.config;

    const [updated] = await db.update(integrationConnections)
      .set(updates)
      .where(eq(integrationConnections.id, existing.id))
      .returning();
    if (updated === undefined) {
      return reply.status(500).send({ error: "Failed to update integration connection", code: "INTEGRATION_UPDATE_FAILED" });
    }
    return { data: publicIntegrationConnection(serializeConnection(updated)) };
  });
}

export async function webhookOutboundRoutes(server: FastifyInstance, opts: { readonly db: Database }): Promise<void> {
  const { db } = opts;

  server.post("/outbound/test", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = WebhookOutboundTestInputSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    if (!canManageVenue(request.user, parsed.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const result = createWebhookSignatureStub({
      eventType: parsed.data.eventType,
      payload: parsed.data.payload,
      signingSecretRef: parsed.data.signingSecretRef ?? null,
    });
    await db.insert(integrationEvents).values({
      venueId: parsed.data.venueId,
      direction: "outbound",
      eventType: parsed.data.eventType,
      status: "stubbed",
      payloadHash: result.payloadHash,
      summary: "Outbound webhook test signed locally; no external delivery attempted.",
    });
    return { data: result };
  });
}

export async function embedConfigRoutes(server: FastifyInstance, opts: { readonly db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const query = VenueQuery.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error.issues);
    const venueId = resolveVenueScope(request, reply, query.data.venueId);
    if (venueId === null) return;
    const rows = await db.select().from(websiteEmbedConfigs)
      .where(eq(websiteEmbedConfigs.venueId, venueId))
      .orderBy(desc(websiteEmbedConfigs.updatedAt));
    return { data: rows.map((row) => safeEmbedConfig(serializeEmbed(row))) };
  });

  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateWebsiteEmbedConfigSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    if (!canManageVenue(request.user, parsed.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const [venue] = await db.select().from(venues)
      .where(and(eq(venues.id, parsed.data.venueId), isNull(venues.deletedAt)))
      .limit(1);
    if (venue === undefined) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }
    const roomId = parsed.data.roomId ?? null;
    const [space] = roomId === null
      ? [undefined]
      : await db.select().from(spaces)
        .where(and(eq(spaces.id, roomId), eq(spaces.venueId, parsed.data.venueId), isNull(spaces.deletedAt)))
        .limit(1);
    if (roomId !== null && space === undefined) {
      return reply.status(404).send({ error: "Room not found for venue", code: "NOT_FOUND" });
    }
    const [inserted] = await db.insert(websiteEmbedConfigs).values({
      venueId: parsed.data.venueId,
      roomId,
      embedKey: embedKeyFor(venue.name, space?.name ?? null),
      venueName: venue.name,
      roomName: space?.name ?? null,
      ctaLabel: parsed.data.ctaLabel,
      ctaUrl: parsed.data.ctaUrl,
      safeMode: true,
      analyticsMode: "stub",
      status: parsed.data.status,
      createdBy: request.user.id,
    }).returning();
    if (inserted === undefined) {
      return reply.status(500).send({ error: "Failed to create embed config", code: "EMBED_CONFIG_CREATE_FAILED" });
    }
    return reply.status(201).send({ data: safeEmbedConfig(serializeEmbed(inserted)) });
  });
}
