import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import {
  CreateProposalTemplateSchema,
  ProposalTemplateContentSchema,
  ReplaceProposalTemplateSchema,
  type CreateProposalTemplate,
  type ProposalTemplate,
} from "@omnitwin/types";
import { pricingRules, proposalTemplates, spaces, users, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canManageCommercial } from "../utils/query.js";

// ---------------------------------------------------------------------------
// Proposal templates (T-635, roadmap X1; Tier B #16; migration 0085).
//
// A venue's proposal words and quote lines, kept by room and occasion so the
// next proposal starts from them. The venue's commercial roles read and keep
// them, as they write proposals. A template holds no price: a price-list line
// is a reference, checked here to be a live entry of this venue, of the kind
// it was saved as, and venue-wide unless the template is for a room. Removed
// templates are kept, so Remove can be undone.
// ---------------------------------------------------------------------------

const VenueIdParam = z.object({ venueId: z.string().uuid() });
const TemplateIdParam = z.object({ venueId: z.string().uuid(), id: z.string().uuid() });

const TEMPLATE_COLUMNS = {
  id: proposalTemplates.id,
  venueId: proposalTemplates.venueId,
  spaceId: proposalTemplates.spaceId,
  occasion: proposalTemplates.occasion,
  name: proposalTemplates.name,
  message: proposalTemplates.message,
  lines: proposalTemplates.lines,
  createdAt: proposalTemplates.createdAt,
  updatedAt: proposalTemplates.updatedAt,
  roomName: spaces.name,
  roomDeletedAt: spaces.deletedAt,
  updatedByName: users.name,
};

interface TemplateRow {
  readonly id: string;
  readonly venueId: string;
  readonly spaceId: string | null;
  readonly occasion: string | null;
  readonly name: string;
  readonly message: string;
  readonly lines: unknown;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly roomName: string | null;
  readonly roomDeletedAt: Date | null;
  readonly updatedByName: string | null;
}

/** A stored template as the team reads it. One whose content no longer
 *  parses is listed as unreadable, with nothing in it to use. */
function serialize(row: TemplateRow): ProposalTemplate {
  const content = ProposalTemplateContentSchema.safeParse({ message: row.message, lines: row.lines });
  const roomListed = row.spaceId === null || (row.roomName !== null && row.roomDeletedAt === null);
  return {
    id: row.id,
    venueId: row.venueId,
    spaceId: row.spaceId,
    roomName: row.spaceId !== null && roomListed ? row.roomName : null,
    roomListed,
    occasion: row.occasion,
    name: row.name,
    message: content.success ? content.data.message : "",
    lines: content.success ? content.data.lines : [],
    readable: content.success,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedByName,
  };
}

/** Postgres keeps microseconds; the API speaks milliseconds. */
function sameInstant(column: typeof proposalTemplates.updatedAt, iso: string): SQL {
  return sql`date_trunc('milliseconds', ${column}) = ${new Date(iso).toISOString()}::timestamptz`;
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } }).code
    ?? (error as { cause?: { code?: unknown } }).cause?.code;
  return code === "23505";
}

interface Refusal {
  readonly error: string;
  readonly code: "ROOM_NOT_AT_VENUE" | "PRICE_ENTRY_NOT_AT_VENUE" | "PRICE_ENTRY_CHANGED" | "ROOM_PRICE_NEEDS_ROOM";
  readonly details?: { readonly names: readonly string[] };
}

export async function proposalTemplateRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  const readTemplates = (venueId: string, where: SQL | undefined) => db.select(TEMPLATE_COLUMNS)
    .from(proposalTemplates)
    .leftJoin(spaces, eq(spaces.id, proposalTemplates.spaceId))
    .leftJoin(users, eq(users.id, proposalTemplates.updatedBy))
    .where(and(eq(proposalTemplates.venueId, venueId), where));

  const liveTemplate = async (venueId: string, id: string): Promise<TemplateRow | undefined> => {
    const [row] = await readTemplates(venueId, and(eq(proposalTemplates.id, id), isNull(proposalTemplates.deletedAt))).limit(1);
    return row;
  };

  const liveByName = async (venueId: string, name: string): Promise<TemplateRow | undefined> => {
    const [row] = await readTemplates(venueId, and(
      sql`lower(${proposalTemplates.name}) = lower(${name})`,
      isNull(proposalTemplates.deletedAt),
    )).limit(1);
    return row;
  };

  const venueExists = async (venueId: string): Promise<boolean> => {
    const [venue] = await db.select({ id: venues.id }).from(venues)
      .where(and(eq(venues.id, venueId), isNull(venues.deletedAt)))
      .limit(1);
    return venue !== undefined;
  };

  /** Whether what is to be kept belongs to this venue as it stands: the room
   *  a listed room of it, each price entry a live entry of it, of the kind it
   *  was saved as, and a room's entry only in a template for a room. A
   *  removed entry and another venue's are answered alike. */
  const refusalFor = async (venueId: string, template: CreateProposalTemplate): Promise<Refusal | null> => {
    if (template.spaceId !== null) {
      const [room] = await db.select({ id: spaces.id }).from(spaces)
        .where(and(eq(spaces.id, template.spaceId), eq(spaces.venueId, venueId), isNull(spaces.deletedAt)))
        .limit(1);
      if (room === undefined) {
        return { error: "That room is not listed at this venue", code: "ROOM_NOT_AT_VENUE" };
      }
    }
    const referenced = template.lines.flatMap((line) => (line.kind === "price_list" ? [line] : []));
    if (referenced.length === 0) return null;
    const entries = await db.select({ id: pricingRules.id, type: pricingRules.type, spaceId: pricingRules.spaceId })
      .from(pricingRules)
      .where(and(
        inArray(pricingRules.id, [...new Set(referenced.map((line) => line.pricingRuleId))]),
        eq(pricingRules.venueId, venueId),
        eq(pricingRules.isActive, true),
        isNull(pricingRules.deletedAt),
      ));
    const byId = new Map(entries.map((entry) => [entry.id.toLowerCase(), entry]));
    const names = (lines: typeof referenced): { names: readonly string[] } => ({ names: lines.map((line) => line.name) });
    const missing = referenced.filter((line) => !byId.has(line.pricingRuleId));
    if (missing.length > 0) {
      return { error: "A price-list entry is not on this venue's price list", code: "PRICE_ENTRY_NOT_AT_VENUE", details: names(missing) };
    }
    const changed = referenced.filter((line) => byId.get(line.pricingRuleId)?.type !== line.ruleType);
    if (changed.length > 0) {
      return { error: "A price-list entry is priced differently now", code: "PRICE_ENTRY_CHANGED", details: names(changed) };
    }
    if (template.spaceId === null) {
      const roomPrices = referenced.filter((line) => (byId.get(line.pricingRuleId)?.spaceId ?? null) !== null);
      if (roomPrices.length > 0) {
        return { error: "A room's price needs a template for a room", code: "ROOM_PRICE_NEEDS_ROOM", details: names(roomPrices) };
      }
    }
    return null;
  };

  const nameTaken = async (reply: FastifyReply, venueId: string, name: string): Promise<FastifyReply> => {
    const existing = await liveByName(venueId, name);
    return reply.status(409).send({
      error: "A template already has that name",
      code: "NAME_TAKEN",
      ...(existing === undefined ? {} : { details: serialize(existing) }),
    });
  };

  // GET /venues/:venueId/proposal-templates — the venue's live templates, by name.
  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    }
    const { venueId } = params.data;
    if (!canManageCommercial(request.user, venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (!await venueExists(venueId)) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }
    const rows = await readTemplates(venueId, isNull(proposalTemplates.deletedAt))
      .orderBy(sql`lower(${proposalTemplates.name})`, proposalTemplates.id);
    return { data: rows.map(serialize) };
  });

  // POST /venues/:venueId/proposal-templates — keep a new template.
  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    }
    const { venueId } = params.data;
    if (!canManageCommercial(request.user, venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const parsed = CreateProposalTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    if (!await venueExists(venueId)) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }
    const refusal = await refusalFor(venueId, parsed.data);
    if (refusal !== null) return reply.status(422).send(refusal);

    const now = new Date();
    let createdId: string;
    try {
      const [created] = await db.insert(proposalTemplates).values({
        venueId,
        spaceId: parsed.data.spaceId,
        occasion: parsed.data.occasion,
        name: parsed.data.name,
        message: parsed.data.message,
        lines: parsed.data.lines,
        createdBy: request.user.id,
        updatedBy: request.user.id,
        createdAt: now,
        updatedAt: now,
      }).returning({ id: proposalTemplates.id });
      if (created === undefined) throw new Error("proposal template insert returned no row");
      createdId = created.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return nameTaken(reply, venueId, parsed.data.name);
    }
    const row = await liveTemplate(venueId, createdId);
    if (row === undefined) throw new Error("proposal template could not be read back");
    return reply.status(201).send({ data: serialize(row) });
  });

  // PATCH /venues/:venueId/proposal-templates/:id — replace a template as it was
  // read: one changed since, by anyone, is not overwritten.
  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = TemplateIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }
    const { venueId, id } = params.data;
    if (!canManageCommercial(request.user, venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const parsed = ReplaceProposalTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    const refusal = await refusalFor(venueId, parsed.data);
    if (refusal !== null) return reply.status(422).send(refusal);

    let replaced: { id: string } | undefined;
    try {
      // The precondition sits in the UPDATE's own WHERE, so a colleague's
      // newer change is never overwritten by someone who had not seen it.
      [replaced] = await db.update(proposalTemplates)
        .set({
          spaceId: parsed.data.spaceId,
          occasion: parsed.data.occasion,
          name: parsed.data.name,
          message: parsed.data.message,
          lines: parsed.data.lines,
          updatedBy: request.user.id,
          updatedAt: new Date(),
        })
        .where(and(
          eq(proposalTemplates.id, id),
          eq(proposalTemplates.venueId, venueId),
          isNull(proposalTemplates.deletedAt),
          sameInstant(proposalTemplates.updatedAt, parsed.data.expectedUpdatedAt),
        ))
        .returning({ id: proposalTemplates.id });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return nameTaken(reply, venueId, parsed.data.name);
    }
    const row = await liveTemplate(venueId, id);
    if (row === undefined) {
      return reply.status(404).send({ error: "Template not found", code: "NOT_FOUND" });
    }
    if (replaced === undefined) {
      return reply.status(409).send({
        error: "Someone changed this template a moment ago. Here is what it says now.",
        code: "TEMPLATE_CHANGED",
        details: serialize(row),
      });
    }
    return { data: serialize(row) };
  });

  // DELETE /venues/:venueId/proposal-templates/:id — remove it for everyone at
  // the venue; it is kept, so it can come back.
  server.delete("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = TemplateIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }
    const { venueId, id } = params.data;
    if (!canManageCommercial(request.user, venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const [removed] = await db.update(proposalTemplates)
      .set({ deletedAt: new Date(), deletedBy: request.user.id })
      .where(and(eq(proposalTemplates.id, id), eq(proposalTemplates.venueId, venueId), isNull(proposalTemplates.deletedAt)))
      .returning({ id: proposalTemplates.id });
    if (removed === undefined) {
      return reply.status(404).send({ error: "Template not found", code: "NOT_FOUND" });
    }
    return reply.status(204).send();
  });

  // POST /venues/:venueId/proposal-templates/:id/restore — undo a removal,
  // unless its name has been taken since. What it says is unchanged, so who
  // last saved it, and when, stay as they were.
  server.post("/:id/restore", { preHandler: [authenticate] }, async (request, reply) => {
    const params = TemplateIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }
    const { venueId, id } = params.data;
    if (!canManageCommercial(request.user, venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    let restored: { id: string; name: string } | undefined;
    try {
      [restored] = await db.update(proposalTemplates)
        .set({ deletedAt: null, deletedBy: null })
        .where(and(eq(proposalTemplates.id, id), eq(proposalTemplates.venueId, venueId), isNotNull(proposalTemplates.deletedAt)))
        .returning({ id: proposalTemplates.id, name: proposalTemplates.name });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const [removed] = await db.select({ name: proposalTemplates.name }).from(proposalTemplates)
        .where(and(eq(proposalTemplates.id, id), eq(proposalTemplates.venueId, venueId)))
        .limit(1);
      return nameTaken(reply, venueId, removed?.name ?? "");
    }
    if (restored === undefined) {
      return reply.status(404).send({ error: "Template not found", code: "NOT_FOUND" });
    }
    const row = await liveTemplate(venueId, id);
    if (row === undefined) throw new Error("restored proposal template could not be read back");
    return { data: serialize(row) };
  });
}
