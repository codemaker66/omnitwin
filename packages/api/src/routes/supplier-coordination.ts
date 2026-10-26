import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  CreateSupplierAcknowledgementInputSchema,
  CreateSupplierCoordinationPackInputSchema,
  GenerateSupplierCoordinationShareTokenInputSchema,
  SupplierAcknowledgementSchema,
  SupplierCoordinationPackBundleSchema,
  SupplierCoordinationPackItemSchema,
  SupplierCoordinationPackSchema,
  SupplierCoordinationShareTokenResultSchema,
  SupplierCoordinationShareTokenSchema,
  SupplierSafePackViewSchema,
  checkSupplierPassExpiry,
  defaultSupplierPassExpiry,
  latestSupplierPassExpiry,
  supplierCoordinationPayloadDigest,
  SUPPLIER_PASS_MAX_DAYS_AFTER_EVENT,
  type SupplierAcknowledgement,
  type SupplierCoordinationPack,
  type SupplierCoordinationPackBundle,
  type SupplierCoordinationPackItem,
  type SupplierCoordinationShareToken,
  type SupplierPassDetails,
  type SupplierSafePackView,
  type EventPlanAudienceRole,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  configurations,
  events,
  generalAuditLog,
  handoffPacks,
  supplierAcknowledgements,
  supplierCoordinationPackItems,
  supplierCoordinationPacks,
  supplierCoordinationShareTokens,
  supplierInstructions,
  suppliers,
  snapshotDiffs,
  venues,
} from "../db/schema.js";
import { authenticate } from "../middleware/auth.js";
import { canAdministerVenue, canManageVenue } from "../utils/query.js";
import { notifyVenueRoles } from "../services/commercial-notifications.js";
import {
  NO_EVENT_MOMENTS,
  SUPPLIER_PASS_AUDIT,
  SUPPLIER_PASS_AUDIT_TARGET,
  buildPassDetails,
  buildSupplierPassBoard,
  effectivePassExpiry,
  passContact,
  readEventMoments,
  readUserContact,
  samePassHolder,
  type EventMoments,
} from "../services/supplier-passes.js";

/**
 * Who hears a supplier's response: the people running the day, as for an
 * event-day issue (services/event-day-ops.ts). Before this a clarification
 * request was stored on the pack and reached nobody. The notification
 * carries the supplier's own words and opens the event board, whose
 * Supplier passes section shows who has opened and read each pass.
 */
export const SUPPLIER_RESPONSE_AUDIENCE: readonly EventPlanAudienceRole[] = ["staff", "hallkeeper"];

const IdParam = z.object({ id: z.uuid() });
const EventParam = z.object({ eventId: z.uuid() });
const ShareTokenParam = z.object({
  token: z.string().min(32).max(96).regex(/^[A-Za-z0-9_-]+$/),
});

type SupplierCoordinationPackRow = typeof supplierCoordinationPacks.$inferSelect;
type SupplierCoordinationPackItemRow = typeof supplierCoordinationPackItems.$inferSelect;
type SupplierCoordinationShareTokenRow = typeof supplierCoordinationShareTokens.$inferSelect;
type SupplierAcknowledgementRow = typeof supplierAcknowledgements.$inferSelect;
type SupplierInstructionRow = typeof supplierInstructions.$inferSelect;

function toIso(value: Date): string {
  return value.toISOString();
}

function toIsoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

function serializePack(row: SupplierCoordinationPackRow): SupplierCoordinationPack {
  return SupplierCoordinationPackSchema.parse({
    id: row.id,
    venueId: row.venueId,
    handoffPackId: row.handoffPackId,
    eventId: row.eventId,
    supplierId: row.supplierId,
    title: row.title,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    status: row.status,
    sourceSnapshotHash: row.sourceSnapshotHash,
    sourceDigest: row.sourceDigest,
    sourceLabel: row.sourceLabel,
    safeStatus: row.safeStatus,
    createdBy: row.createdBy,
    issuedAt: toIsoOrNull(row.issuedAt),
    acknowledgedAt: toIsoOrNull(row.acknowledgedAt),
    expiresAt: toIsoOrNull(row.expiresAt),
    revokedAt: toIsoOrNull(row.revokedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

function serializeItem(row: SupplierCoordinationPackItemRow): SupplierCoordinationPackItem {
  return SupplierCoordinationPackItemSchema.parse({
    id: row.id,
    packId: row.packId,
    supplierInstructionId: row.supplierInstructionId,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    arrivalWindow: row.arrivalWindow,
    sourceRef: row.sourceRef,
    sortOrder: row.sortOrder,
    createdAt: toIso(row.createdAt),
  });
}

function serializeShareToken(row: SupplierCoordinationShareTokenRow): SupplierCoordinationShareToken {
  return SupplierCoordinationShareTokenSchema.parse({
    id: row.id,
    packId: row.packId,
    tokenHash: row.tokenHash,
    tokenPrefix: row.tokenPrefix,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    expiresAt: toIsoOrNull(row.expiresAt),
    revokedAt: toIsoOrNull(row.revokedAt),
    lastViewedAt: toIsoOrNull(row.lastViewedAt),
  });
}

function serializeAcknowledgement(row: SupplierAcknowledgementRow): SupplierAcknowledgement {
  return SupplierAcknowledgementSchema.parse({
    id: row.id,
    packId: row.packId,
    shareTokenId: row.shareTokenId,
    status: row.status,
    acknowledgedByName: row.acknowledgedByName,
    acknowledgedByEmail: row.acknowledgedByEmail,
    note: row.note,
    createdAt: toIso(row.createdAt),
  });
}

async function getSupplierCoordinationPackBundle(
  db: Database,
  packId: string,
): Promise<SupplierCoordinationPackBundle | null> {
  const [packRow] = await db.select().from(supplierCoordinationPacks)
    .where(eq(supplierCoordinationPacks.id, packId))
    .limit(1);
  if (packRow === undefined) return null;

  const [itemRows, shareTokenRows, acknowledgementRows] = await Promise.all([
    db.select().from(supplierCoordinationPackItems)
      .where(eq(supplierCoordinationPackItems.packId, packId))
      .orderBy(supplierCoordinationPackItems.sortOrder),
    db.select().from(supplierCoordinationShareTokens)
      .where(eq(supplierCoordinationShareTokens.packId, packId))
      .orderBy(supplierCoordinationShareTokens.createdAt),
    db.select().from(supplierAcknowledgements)
      .where(eq(supplierAcknowledgements.packId, packId))
      .orderBy(supplierAcknowledgements.createdAt),
  ]);

  return SupplierCoordinationPackBundleSchema.parse({
    pack: serializePack(packRow),
    items: itemRows.map(serializeItem),
    shareTokens: shareTokenRows.map(serializeShareToken),
    acknowledgements: acknowledgementRows.map(serializeAcknowledgement),
  });
}

async function loadPackSource(db: Database, handoffPackId: string): Promise<{
  readonly handoffPackId: string;
  readonly eventId: string | null;
  readonly venueId: string;
  readonly venueName: string | null;
  readonly status: string;
  readonly snapshotHash: string;
  readonly version: number;
  readonly sourceLabel: string;
  readonly compiledAt: Date;
} | null> {
  const [source] = await db.select({
    handoffPackId: handoffPacks.id,
    eventId: handoffPacks.eventId,
    venueId: configurations.venueId,
    venueName: venues.name,
    status: handoffPacks.status,
    snapshotHash: handoffPacks.snapshotHash,
    version: handoffPacks.version,
    sourceLabel: handoffPacks.sourceLabel,
    compiledAt: handoffPacks.compiledAt,
  })
    .from(handoffPacks)
    .innerJoin(configurations, eq(handoffPacks.configId, configurations.id))
    .leftJoin(venues, eq(configurations.venueId, venues.id))
    .where(and(eq(handoffPacks.id, handoffPackId), isNull(configurations.deletedAt)))
    .limit(1);
  return source ?? null;
}

function dateFromOptionalIso(value: string | null | undefined): Date | null {
  return value === undefined || value === null ? null : new Date(value);
}

/**
 * Every pass stops working on a date (A Door for Everyone Outside, stage 1):
 * the one asked for, else seven days after the event. A pass whose event has
 * no date must be given one. Returns the date, or sends the refusal and
 * returns null. The words say what to do next.
 */
function passExpiryOrRefuse(
  reply: FastifyReply,
  requested: Date | null,
  eventLastMoment: Date | null,
  now: Date,
): Date | null {
  const expiresAt = requested ?? defaultSupplierPassExpiry(eventLastMoment);
  const check = checkSupplierPassExpiry(expiresAt, eventLastMoment, now);
  if (check === "ok" && expiresAt !== null) return expiresAt;
  const latestExpiresAt = latestSupplierPassExpiry(eventLastMoment, now).toISOString();
  if (check === "missing") {
    void reply.status(422).send({
      error: "Choose the day this pass stops working: the event has no date in the Diary yet.",
      code: "PASS_EXPIRY_REQUIRED",
      details: { latestExpiresAt },
    });
  } else if (check === "past") {
    void reply.status(422).send({
      error: "That day has already passed. Choose a later day for the pass to stop working.",
      code: "PASS_EXPIRY_PAST",
      details: { latestExpiresAt },
    });
  } else {
    void reply.status(422).send({
      error: `A pass can stay open until ${String(SUPPLIER_PASS_MAX_DAYS_AFTER_EVENT)} days after the event at most.`,
      code: "PASS_EXPIRY_TOO_LATE",
      details: { latestExpiresAt },
    });
  }
  return null;
}

function isExpired(value: Date | null, now: Date): boolean {
  return value !== null && value.getTime() <= now.getTime();
}

function uniqueNonNull(values: readonly (string | null)[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

async function resolveSupplier(db: Database, supplierId: string | null, venueId: string): Promise<{
  readonly id: string;
  readonly name: string;
  readonly venueId: string | null;
  readonly contactName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
} | "missing" | "venue_mismatch" | null> {
  if (supplierId === null) return null;
  const [supplier] = await db.select({
    id: suppliers.id,
    name: suppliers.name,
    venueId: suppliers.venueId,
    contactName: suppliers.contactName,
    email: suppliers.email,
    phone: suppliers.phone,
  })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), isNull(suppliers.deletedAt)))
    .limit(1);
  if (supplier === undefined) return "missing";
  if (supplier.venueId !== null && supplier.venueId !== venueId) return "venue_mismatch";
  return supplier;
}

function orderedInstructions(
  inputIds: readonly string[],
  rows: readonly SupplierInstructionRow[],
): readonly SupplierInstructionRow[] | null {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered: SupplierInstructionRow[] = [];
  for (const id of inputIds) {
    const row = byId.get(id);
    if (row === undefined) return null;
    ordered.push(row);
  }
  return ordered;
}

export async function supplierCoordinationRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.post("/packs", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateSupplierCoordinationPackInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const source = await loadPackSource(db, parsed.data.handoffPackId);
    if (source === null) {
      return reply.status(404).send({ error: "Handoff pack not found", code: "NOT_FOUND" });
    }
    // Sending a link in the venue's name to someone outside it is the events
    // team's call: staff, managers and admins. Hallkeepers read passes on the
    // event board; they do not issue them.
    if (!canAdministerVenue(request.user, source.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (source.status !== "compiled" && source.status !== "exported") {
      return reply.status(409).send({
        error: "Supplier packs require a current compiled handoff pack",
        code: "HANDOFF_PACK_NOT_SHAREABLE",
      });
    }

    const instructionRows = await db.select().from(supplierInstructions)
      .where(inArray(supplierInstructions.id, parsed.data.supplierInstructionIds));
    const selectedInstructions = orderedInstructions(parsed.data.supplierInstructionIds, instructionRows);
    if (
      selectedInstructions === null ||
      selectedInstructions.some((instruction) => instruction.handoffPackId !== source.handoffPackId)
    ) {
      return reply.status(422).send({
        error: "Supplier instructions must belong to the selected handoff pack",
        code: "SUPPLIER_INSTRUCTION_MISMATCH",
      });
    }

    const instructionSupplierIds = uniqueNonNull(selectedInstructions.map((instruction) => instruction.supplierId));
    if (instructionSupplierIds.length > 1) {
      return reply.status(422).send({
        error: "A supplier pack cannot span multiple linked suppliers",
        code: "MULTIPLE_SUPPLIERS_SELECTED",
      });
    }
    if (
      parsed.data.supplierId !== undefined &&
      parsed.data.supplierId !== null &&
      instructionSupplierIds.length === 1 &&
      instructionSupplierIds[0] !== parsed.data.supplierId
    ) {
      return reply.status(422).send({
        error: "Selected instructions are linked to a different supplier",
        code: "SUPPLIER_MISMATCH",
      });
    }

    const effectiveSupplierId = parsed.data.supplierId ?? instructionSupplierIds[0] ?? null;
    const supplier = await resolveSupplier(db, effectiveSupplierId, source.venueId);
    if (supplier === "missing") {
      return reply.status(404).send({ error: "Supplier not found", code: "NOT_FOUND" });
    }
    if (supplier === "venue_mismatch") {
      return reply.status(422).send({ error: "Supplier belongs to a different venue", code: "VENUE_MISMATCH" });
    }

    const sourceDigest = supplierCoordinationPayloadDigest({
      handoffPackId: source.handoffPackId,
      sourceSnapshotHash: source.snapshotHash,
      supplierInstructionIds: selectedInstructions.map((instruction) => instruction.id),
      itemTitles: selectedInstructions.map((instruction) => instruction.title),
      itemDetails: selectedInstructions.map((instruction) => instruction.detail),
    });
    const now = new Date();
    const moments = source.eventId === null ? NO_EVENT_MOMENTS : await readEventMoments(db, source.eventId, source.venueId);
    const expiresAt = passExpiryOrRefuse(reply, dateFromOptionalIso(parsed.data.expiresAt), moments.lastAt, now);
    if (expiresAt === null) return reply;

    const insertedPack = await db.transaction(async (tx) => {
      const [pack] = await tx.insert(supplierCoordinationPacks).values({
        venueId: source.venueId,
        handoffPackId: source.handoffPackId,
        eventId: source.eventId,
        supplierId: effectiveSupplierId,
        title: parsed.data.title ?? `${selectedInstructions[0]?.category ?? "Supplier"} coordination pack`,
        contactName: parsed.data.contactName ?? supplier?.contactName ?? null,
        contactEmail: parsed.data.contactEmail ?? supplier?.email ?? null,
        contactPhone: parsed.data.contactPhone ?? supplier?.phone ?? null,
        status: "draft",
        sourceSnapshotHash: source.snapshotHash,
        sourceDigest,
        sourceLabel: source.sourceLabel,
        safeStatus: "supplier_safe_operations_handoff",
        createdBy: request.user.id,
        expiresAt,
        updatedAt: now,
      }).returning();
      if (pack === undefined) throw new Error("supplier coordination pack insert returned no row");

      await tx.insert(supplierCoordinationPackItems).values(selectedInstructions.map((instruction, index) => ({
        packId: pack.id,
        supplierInstructionId: instruction.id,
        kind: "requirement",
        title: instruction.title,
        detail: instruction.detail,
        arrivalWindow: instruction.arrivalWindow,
        sourceRef: instruction.sourceRef,
        sortOrder: index,
      })));

      return pack;
    });

    const bundle = await getSupplierCoordinationPackBundle(db, insertedPack.id);
    if (bundle === null) throw new Error("created supplier coordination pack could not be reloaded");
    return reply.status(201).send({ data: bundle });
  });

  server.get("/packs/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid supplier pack ID", code: "VALIDATION_ERROR" });
    }

    const bundle = await getSupplierCoordinationPackBundle(db, params.data.id);
    if (bundle === null) {
      return reply.status(404).send({ error: "Supplier pack not found", code: "NOT_FOUND" });
    }
    if (!canManageVenue(request.user, bundle.pack.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    return { data: bundle };
  });

  server.post("/packs/:id/share-token", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid supplier pack ID", code: "VALIDATION_ERROR" });
    }
    const parsed = GenerateSupplierCoordinationShareTokenInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [pack] = await db.select().from(supplierCoordinationPacks)
      .where(eq(supplierCoordinationPacks.id, params.data.id))
      .limit(1);
    if (pack === undefined) {
      return reply.status(404).send({ error: "Supplier pack not found", code: "NOT_FOUND" });
    }
    if (!canAdministerVenue(request.user, pack.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (pack.status === "revoked" || pack.status === "expired" || pack.revokedAt !== null) {
      return reply.status(409).send({
        error: "This pass was withdrawn. Make a fresh pass to send the supplier a new link.",
        code: "SUPPLIER_PACK_NOT_SHAREABLE",
      });
    }

    // A fresh pass replaces an earlier one only for the same venue, the same
    // event and the same holder; anything else is refused in the same words,
    // so the answer never says whether another venue's pass exists.
    const supersedesPackId = parsed.data.supersedesPackId ?? null;
    let superseded: typeof supplierCoordinationPacks.$inferSelect | null = null;
    if (supersedesPackId !== null) {
      const [earlier] = await db.select().from(supplierCoordinationPacks)
        .where(eq(supplierCoordinationPacks.id, supersedesPackId))
        .limit(1);
      if (
        earlier === undefined ||
        earlier.id === pack.id ||
        earlier.venueId !== pack.venueId ||
        earlier.eventId === null ||
        earlier.eventId !== pack.eventId ||
        !samePassHolder(earlier, pack)
      ) {
        return reply.status(422).send({
          error: "A fresh pass can only replace an earlier pass for the same supplier on the same event.",
          code: "SUPERSEDED_PASS_MISMATCH",
        });
      }
      superseded = earlier;
    }

    const now = new Date();
    const moments = pack.eventId === null ? NO_EVENT_MOMENTS : await readEventMoments(db, pack.eventId, pack.venueId);
    const expiresAt = passExpiryOrRefuse(
      reply,
      dateFromOptionalIso(parsed.data.expiresAt) ?? pack.expiresAt,
      moments.lastAt,
      now,
    );
    if (expiresAt === null) return reply;

    let token = generateShareToken();
    let tokenHash = hashShareToken(token);
    let hasUniqueToken = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [existing] = await db.select({ id: supplierCoordinationShareTokens.id })
        .from(supplierCoordinationShareTokens)
        .where(eq(supplierCoordinationShareTokens.tokenHash, tokenHash))
        .limit(1);
      if (existing === undefined) {
        hasUniqueToken = true;
        break;
      }
      token = generateShareToken();
      tokenHash = hashShareToken(token);
    }
    if (!hasUniqueToken) throw new Error("unable to generate unique supplier share token");

    const result = await db.transaction(async (tx) => {
      // The pass is read again under a row lock: a withdrawal that landed
      // since the check above wins, and no new link is made for it.
      const [locked] = await tx.select({ status: supplierCoordinationPacks.status, revokedAt: supplierCoordinationPacks.revokedAt })
        .from(supplierCoordinationPacks)
        .where(eq(supplierCoordinationPacks.id, pack.id))
        .for("update");
      if (locked === undefined || locked.revokedAt !== null || locked.status === "revoked" || locked.status === "expired") {
        return null;
      }

      // One live link per pass: a new link closes the ones before it, so a
      // link that went astray stops working the moment its replacement exists.
      const closedLinks = await tx.update(supplierCoordinationShareTokens)
        .set({ revokedAt: now })
        .where(and(eq(supplierCoordinationShareTokens.packId, pack.id), isNull(supplierCoordinationShareTokens.revokedAt)))
        .returning({ id: supplierCoordinationShareTokens.id });

      const [shareToken] = await tx.insert(supplierCoordinationShareTokens).values({
        packId: pack.id,
        tokenHash,
        tokenPrefix: token.slice(0, 8),
        createdBy: request.user.id,
        expiresAt,
      }).returning();
      if (shareToken === undefined) throw new Error("supplier share token insert returned no row");

      const [updatedPack] = await tx.update(supplierCoordinationPacks)
        .set({
          status: locked.status === "draft" ? "issued" : locked.status,
          issuedAt: pack.issuedAt ?? now,
          expiresAt,
          updatedAt: now,
        })
        .where(eq(supplierCoordinationPacks.id, pack.id))
        .returning();
      if (updatedPack === undefined) throw new Error("supplier pack update returned no row");

      const audit: (typeof generalAuditLog.$inferInsert)[] = [{
        actorUserId: request.user.id,
        action: SUPPLIER_PASS_AUDIT.issued,
        targetType: SUPPLIER_PASS_AUDIT_TARGET,
        targetId: pack.id,
        summary: "Supplier pass link made.",
        metadata: {
          venueId: pack.venueId,
          eventId: pack.eventId,
          tokenPrefix: shareToken.tokenPrefix,
          expiresAt: expiresAt.toISOString(),
          closedLinks: closedLinks.length,
        },
      }];

      if (superseded !== null) {
        // The earlier pass is withdrawn, never deleted: what its holder was
        // told, and what they acknowledged, stays on record.
        await tx.update(supplierCoordinationShareTokens)
          .set({ revokedAt: now })
          .where(and(eq(supplierCoordinationShareTokens.packId, superseded.id), isNull(supplierCoordinationShareTokens.revokedAt)));
        await tx.update(supplierCoordinationPacks)
          .set({ status: "revoked", revokedAt: superseded.revokedAt ?? now, updatedAt: now })
          .where(and(eq(supplierCoordinationPacks.id, superseded.id), eq(supplierCoordinationPacks.venueId, pack.venueId)));
        audit.push({
          actorUserId: request.user.id,
          action: SUPPLIER_PASS_AUDIT.replaces,
          targetType: SUPPLIER_PASS_AUDIT_TARGET,
          targetId: pack.id,
          summary: "Fresh supplier pass replaces an earlier one.",
          metadata: { venueId: pack.venueId, eventId: pack.eventId, previousPackId: superseded.id },
        }, {
          actorUserId: request.user.id,
          action: SUPPLIER_PASS_AUDIT.withdrawn,
          targetType: SUPPLIER_PASS_AUDIT_TARGET,
          targetId: superseded.id,
          summary: "Supplier pass withdrawn: replaced by a fresh pass.",
          metadata: { venueId: pack.venueId, eventId: pack.eventId, reason: "replaced", replacedByPackId: pack.id },
        });
      }
      await tx.insert(generalAuditLog).values(audit);
      return { shareToken, pack: updatedPack };
    });
    if (result === null) {
      return reply.status(409).send({
        error: "This pass was withdrawn. Make a fresh pass to send the supplier a new link.",
        code: "SUPPLIER_PACK_NOT_SHAREABLE",
      });
    }

    const payload = SupplierCoordinationShareTokenResultSchema.parse({
      token,
      shareUrl: `/supplier-share/${token}`,
      tokenPrefix: result.shareToken.tokenPrefix,
      pack: serializePack(result.pack),
    });
    return reply.status(201).send({ data: payload });
  });

  // One tap: the pass and every link to it stop working at once. The pass is
  // kept, with what its holder acknowledged, and says when it was withdrawn.
  server.post("/packs/:id/revoke", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid supplier pack ID", code: "VALIDATION_ERROR" });
    }
    const [pack] = await db.select().from(supplierCoordinationPacks)
      .where(eq(supplierCoordinationPacks.id, params.data.id))
      .limit(1);
    if (pack === undefined) {
      return reply.status(404).send({ error: "Supplier pack not found", code: "NOT_FOUND" });
    }
    if (!canAdministerVenue(request.user, pack.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      await tx.update(supplierCoordinationShareTokens)
        .set({ revokedAt: now })
        .where(and(eq(supplierCoordinationShareTokens.packId, pack.id), isNull(supplierCoordinationShareTokens.revokedAt)));
      if (pack.revokedAt !== null && pack.status === "revoked") return pack;
      const [row] = await tx.update(supplierCoordinationPacks)
        .set({ status: "revoked", revokedAt: pack.revokedAt ?? now, updatedAt: now })
        .where(eq(supplierCoordinationPacks.id, pack.id))
        .returning();
      if (row === undefined) throw new Error("supplier pack revoke returned no row");
      await tx.insert(generalAuditLog).values({
        actorUserId: request.user.id,
        action: SUPPLIER_PASS_AUDIT.withdrawn,
        targetType: SUPPLIER_PASS_AUDIT_TARGET,
        targetId: pack.id,
        summary: "Supplier pass withdrawn.",
        metadata: { venueId: pack.venueId, eventId: pack.eventId, reason: "withdrawn" },
      });
      return row;
    });

    return { data: serializePack(updated) };
  });

  // The event's passes, for the event board: what new passes are made from,
  // who can receive one, and who has opened and read the passes already sent.
  server.get("/events/:eventId/passes", { preHandler: [authenticate] }, async (request, reply) => {
    const params = EventParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid event ID", code: "VALIDATION_ERROR" });
    }
    const [event] = await db.select({ id: events.id, venueId: events.venueId })
      .from(events)
      .where(and(eq(events.id, params.data.eventId), isNull(events.deletedAt)))
      .limit(1);
    if (event === undefined) {
      return reply.status(404).send({ error: "Event not found", code: "NOT_FOUND" });
    }
    if (!canManageVenue(request.user, event.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const canIssue = canAdministerVenue(request.user, event.venueId);
    const issuer = canIssue
      ? (await readUserContact(db, request.user.id)) ?? passContact(request.user.name, null)
      : null;
    const board = await buildSupplierPassBoard(db, { event, canIssue, issuer, now: new Date() });
    return { data: board };
  });
}

async function resolveSupplierShareToken(
  db: Database,
  token: string,
): Promise<{
  readonly shareToken: SupplierCoordinationShareTokenRow;
  readonly pack: SupplierCoordinationPackRow;
  readonly handoffVersion: number;
  readonly compiledAt: Date;
  readonly venueName: string | null;
  readonly supplierName: string | null;
  readonly supplierContactName: string | null;
  readonly supplierEmail: string | null;
  readonly supplierPhone: string | null;
  readonly diffSummary: string | null;
  readonly diffAddedCount: number | null;
  readonly diffRemovedCount: number | null;
  readonly diffChangedCount: number | null;
  readonly moments: EventMoments;
  /** The stop date that applies, stored or (for an older pass) assumed. */
  readonly packExpiresAt: Date;
} | null> {
  const tokenHash = hashShareToken(token);
  const [shareToken] = await db.select().from(supplierCoordinationShareTokens)
    .where(eq(supplierCoordinationShareTokens.tokenHash, tokenHash))
    .limit(1);
  if (shareToken === undefined) return null;

  const now = new Date();
  if (shareToken.revokedAt !== null || isExpired(shareToken.expiresAt, now)) return null;

  const [resolved] = await db.select({
    pack: supplierCoordinationPacks,
    handoffVersion: handoffPacks.version,
    compiledAt: handoffPacks.compiledAt,
    venueName: venues.name,
    supplierName: suppliers.name,
    supplierContactName: suppliers.contactName,
    supplierEmail: suppliers.email,
    supplierPhone: suppliers.phone,
    diffSummary: snapshotDiffs.summary,
    diffAddedCount: snapshotDiffs.addedCount,
    diffRemovedCount: snapshotDiffs.removedCount,
    diffChangedCount: snapshotDiffs.changedCount,
  })
    .from(supplierCoordinationPacks)
    .innerJoin(handoffPacks, eq(supplierCoordinationPacks.handoffPackId, handoffPacks.id))
    .leftJoin(venues, eq(supplierCoordinationPacks.venueId, venues.id))
    .leftJoin(suppliers, eq(supplierCoordinationPacks.supplierId, suppliers.id))
    .leftJoin(snapshotDiffs, eq(snapshotDiffs.handoffPackId, supplierCoordinationPacks.handoffPackId))
    .where(eq(supplierCoordinationPacks.id, shareToken.packId))
    .limit(1);
  if (resolved === undefined) return null;
  if (
    resolved.pack.status === "draft" ||
    resolved.pack.status === "revoked" ||
    resolved.pack.status === "expired" ||
    resolved.pack.revokedAt !== null
  ) {
    return null;
  }

  // Every pass stops working on a date. One made before passes carried a
  // date is read as stopping seven days after its event; with no stored date
  // and no event date the link does not open at all.
  const moments = resolved.pack.eventId === null
    ? NO_EVENT_MOMENTS
    : await readEventMoments(db, resolved.pack.eventId, resolved.pack.venueId);
  const packExpiresAt = effectivePassExpiry(resolved.pack.expiresAt, moments.lastAt).expiresAt;
  const linkExpiresAt = shareToken.expiresAt ?? packExpiresAt;
  if (packExpiresAt === null || linkExpiresAt === null || isExpired(packExpiresAt, now) || isExpired(linkExpiresAt, now)) {
    return null;
  }

  return { shareToken, ...resolved, moments, packExpiresAt };
}

async function buildSupplierSafePackView(
  db: Database,
  resolved: NonNullable<Awaited<ReturnType<typeof resolveSupplierShareToken>>>,
  onDetailsFailed: (error: unknown) => void,
): Promise<SupplierSafePackView> {
  const [itemRows, acknowledgementRows] = await Promise.all([
    db.select().from(supplierCoordinationPackItems)
      .where(eq(supplierCoordinationPackItems.packId, resolved.pack.id))
      .orderBy(supplierCoordinationPackItems.sortOrder),
    db.select().from(supplierAcknowledgements)
      .where(eq(supplierAcknowledgements.packId, resolved.pack.id))
      .orderBy(supplierAcknowledgements.createdAt),
  ]);

  // The plain words are read beside the brief, never in front of it: if they
  // cannot be read the supplier still gets their part of the event.
  let passDetails: SupplierPassDetails | undefined;
  try {
    passDetails = await buildPassDetails(db, {
      pack: resolved.pack,
      builtFromCompiledAt: resolved.compiledAt,
      supplierContactName: resolved.supplierContactName,
      moments: resolved.moments,
      items: itemRows,
    });
  } catch (error: unknown) {
    onDetailsFailed(error);
    passDetails = undefined;
  }

  return SupplierSafePackViewSchema.parse({
    title: resolved.pack.title,
    venueName: resolved.venueName,
    supplierName: resolved.supplierName,
    contactName: resolved.pack.contactName ?? resolved.supplierContactName,
    contactEmail: resolved.pack.contactEmail ?? resolved.supplierEmail,
    contactPhone: resolved.pack.contactPhone ?? resolved.supplierPhone,
    status: resolved.pack.status,
    safeStatus: resolved.pack.safeStatus,
    issuedAt: toIsoOrNull(resolved.pack.issuedAt),
    expiresAt: toIso(resolved.packExpiresAt),
    source: {
      sourceLabel: resolved.pack.sourceLabel,
      handoffVersion: resolved.handoffVersion,
      compiledAt: toIso(resolved.compiledAt),
      snapshotHashPrefix: resolved.pack.sourceSnapshotHash.slice(0, 12),
      sourceDigest: resolved.pack.sourceDigest,
    },
    changesSincePreviousHandoff: {
      summary: resolved.diffSummary ?? "No previous approved snapshot is available for comparison.",
      addedCount: resolved.diffAddedCount ?? 0,
      removedCount: resolved.diffRemovedCount ?? 0,
      changedCount: resolved.diffChangedCount ?? 0,
    },
    items: itemRows.map((item) => ({
      title: item.title,
      detail: item.detail,
      kind: item.kind,
      arrivalWindow: item.arrivalWindow,
      sourceRef: item.sourceRef,
      sortOrder: item.sortOrder,
    })),
    acknowledgements: acknowledgementRows.map((ack) => ({
      status: ack.status,
      acknowledgedByName: ack.acknowledgedByName,
      note: ack.note,
      createdAt: toIso(ack.createdAt),
    })),
    supplierNotice: "Your part of the event, from the venue's approved plan. Check anything unclear with the venue before you arrive.",
    ...(passDetails === undefined ? {} : { passDetails }),
  });
}

export async function supplierShareRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.get("/:token", async (request, reply) => {
    const params = ShareTokenParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid share token", code: "VALIDATION_ERROR" });
    }

    const resolved = await resolveSupplierShareToken(db, params.data.token);
    if (resolved === null) {
      return reply.status(404).send({ error: "Supplier pack not found", code: "NOT_FOUND" });
    }

    const supplierSafe = await buildSupplierSafePackView(db, resolved, (error) => {
      request.log.warn({ err: error, packId: resolved.pack.id }, "supplier pass details could not be read");
    });
    await db.update(supplierCoordinationShareTokens)
      .set({ lastViewedAt: new Date() })
      .where(eq(supplierCoordinationShareTokens.id, resolved.shareToken.id));

    return { data: supplierSafe };
  });

  server.post("/:token/acknowledge", async (request, reply) => {
    const params = ShareTokenParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid share token", code: "VALIDATION_ERROR" });
    }
    const parsed = CreateSupplierAcknowledgementInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const resolved = await resolveSupplierShareToken(db, params.data.token);
    if (resolved === null) {
      return reply.status(404).send({ error: "Supplier pack not found", code: "NOT_FOUND" });
    }

    const now = new Date();
    const itemTitles = await db.select({ title: supplierCoordinationPackItems.title })
      .from(supplierCoordinationPackItems)
      .where(eq(supplierCoordinationPackItems.packId, resolved.pack.id))
      .orderBy(supplierCoordinationPackItems.sortOrder);
    const result = await db.transaction(async (tx) => {
      const [acknowledgement] = await tx.insert(supplierAcknowledgements).values({
        packId: resolved.pack.id,
        shareTokenId: resolved.shareToken.id,
        status: parsed.data.status,
        acknowledgedByName: parsed.data.acknowledgedByName ?? null,
        acknowledgedByEmail: parsed.data.acknowledgedByEmail ?? null,
        note: parsed.data.note ?? null,
      }).returning();
      if (acknowledgement === undefined) throw new Error("supplier acknowledgement insert returned no row");

      await tx.update(supplierCoordinationPacks)
        .set({
          status: parsed.data.status === "acknowledged" ? "acknowledged" : "changes_requested",
          acknowledgedAt: parsed.data.status === "acknowledged" ? (resolved.pack.acknowledgedAt ?? now) : resolved.pack.acknowledgedAt,
          updatedAt: now,
        })
        .where(eq(supplierCoordinationPacks.id, resolved.pack.id));

      // The supplier's proof of what they were told, kept where no cascade
      // reaches it: supplier_acknowledgements still cascade from the pass at
      // the database level (changing that needs a migration), and the audit
      // log has no foreign key to the pass. It holds what was shown (titles
      // and the digest of the brief), the name as given and when; the note
      // stays on the pass only, so free text is not copied twice.
      await tx.insert(generalAuditLog).values({
        actorUserId: null,
        action: SUPPLIER_PASS_AUDIT.replied,
        targetType: SUPPLIER_PASS_AUDIT_TARGET,
        targetId: resolved.pack.id,
        summary: parsed.data.status === "acknowledged"
          ? "Supplier marked their brief as read."
          : "Supplier sent a question about their brief.",
        metadata: {
          venueId: resolved.pack.venueId,
          eventId: resolved.pack.eventId,
          acknowledgementId: acknowledgement.id,
          status: acknowledgement.status,
          nameGiven: acknowledgement.acknowledgedByName,
          passTitle: resolved.pack.title,
          sourceDigest: resolved.pack.sourceDigest,
          itemTitles: itemTitles.map((item) => item.title),
          linkPrefix: resolved.shareToken.tokenPrefix,
          at: acknowledgement.createdAt.toISOString(),
        },
      });

      return acknowledgement;
    });

    // The response is saved whatever happens here: a notification that
    // cannot be written is logged, never turned into a failed response.
    // The name is whatever the holder of the link typed, so it is reported as
    // given, never as a verified identity.
    const supplier = resolved.supplierName ?? resolved.pack.title;
    const who = [
      parsed.data.acknowledgedByName ?? null,
      parsed.data.acknowledgedByEmail ?? null,
    ].filter((part): part is string => part !== null && part.length > 0).join(", ");
    const note = parsed.data.note ?? null;
    try {
      await notifyVenueRoles(db, {
        venueId: resolved.pack.venueId,
        audienceRoles: SUPPLIER_RESPONSE_AUDIENCE,
        title: parsed.data.status === "needs_clarification"
          ? `${supplier} has a question`
          : `${supplier} has read their brief`,
        body: `${resolved.pack.title}. ${who.length > 0 ? `Name given on the link: ${who}. ` : ""}${note === null ? "No note." : `"${note}"`}`,
        severity: parsed.data.status === "needs_clarification" ? "attention" : "info",
        actionPath: resolved.pack.eventId === null ? null : `/ops/events/${resolved.pack.eventId}`,
      });
    } catch (error: unknown) {
      request.log.warn({ err: error, packId: resolved.pack.id }, "supplier response notification failed");
    }

    return reply.status(201).send({ data: serializeAcknowledgement(result) });
  });
}
