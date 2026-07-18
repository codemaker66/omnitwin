import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, gt, isNull } from "drizzle-orm";
import { ActionLogBatchSchema } from "@omnitwin/types";
import { actionLog, configurations } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, type JwtUser } from "../middleware/auth.js";
import { canAccessResource } from "../utils/query.js";

// ---------------------------------------------------------------------------
// Action log — G4 Slice 3 (03 §2). The append-only audit trail's write and
// read surface.
//
// Write: the client flushes log batches on its save/config boundaries. The
// bounded ingestion contract (ActionLogBatchSchema: batch cap, per-action
// byte cap, iterative depth cap, pollution-hardened records) parses BEFORE
// any database work; inserts land ON CONFLICT (id) DO NOTHING so a retried
// batch is idempotent, never duplicated.
//
// Read: the audit trail pages by the server-assigned `ordinal` — client
// clocks never order the trail. Claim safety: `recordedTs` is the
// operator's clock as reported, `receivedAt` is this server's; the two are
// distinct fields and neither is ever presented as the other, and nothing
// here labels client-supplied actor/provenance as verified.
//
// Append-only by code contract: this file has no update or delete surface.
// ---------------------------------------------------------------------------

const ConfigIdParam = z.object({ configId: z.string().uuid() });

const ReadQuery = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

async function verifyConfigAccess(
  db: Database,
  configId: string,
  user: JwtUser,
): Promise<{ config: typeof configurations.$inferSelect } | { error: string; code: string; status: number }> {
  const [config] = await db.select()
    .from(configurations)
    .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
    .limit(1);

  if (config === undefined) {
    return { error: "Configuration not found", code: "NOT_FOUND", status: 404 };
  }

  if (!canAccessResource(user, config.userId, config.venueId)) {
    return { error: "Insufficient permissions", code: "FORBIDDEN", status: 403 };
  }

  return { config };
}

export async function actionLogRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // POST /configurations/:configId/actions — authenticated batch append.
  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid configuration id", code: "VALIDATION_ERROR" });
    }

    // Bounds parse first — an adversarial body never reaches the database
    // (or the recursive envelope parse; see ActionLogBatchSchema).
    const body = ActionLogBatchSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid action batch",
        code: "VALIDATION_ERROR",
        details: body.error.issues.slice(0, 5),
      });
    }

    const access = await verifyConfigAccess(db, params.data.configId, request.user);
    if ("error" in access) {
      return reply.status(access.status).send({ error: access.error, code: access.code });
    }

    const rows = body.data.actions.map((entry) => ({
      id: entry.id,
      configurationId: params.data.configId,
      batchId: body.data.batchId,
      revision: body.data.revision,
      // Claim safety, actor half: the actor blob below is client-reported;
      // this is the authenticated principal the server actually observed.
      submittedBy: request.user.id,
      actor: entry.actor,
      intent: entry.intent,
      payload: entry.payload,
      inverse: entry.inverse,
      provenance: entry.provenance,
      recordedTs: new Date(entry.ts),
    }));

    const inserted = await db.insert(actionLog)
      .values(rows)
      .onConflictDoNothing({ target: actionLog.id })
      .returning({ id: actionLog.id });

    return {
      data: {
        accepted: inserted.length,
        duplicates: rows.length - inserted.length,
      },
    };
  });

  // GET /configurations/:configId/actions — the audit read model, paged by
  // the server-assigned ordinal.
  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid configuration id", code: "VALIDATION_ERROR" });
    }
    const query = ReadQuery.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid audit query", code: "VALIDATION_ERROR" });
    }

    const access = await verifyConfigAccess(db, params.data.configId, request.user);
    if ("error" in access) {
      return reply.status(access.status).send({ error: access.error, code: access.code });
    }

    const rows = await db.select()
      .from(actionLog)
      .where(and(
        eq(actionLog.configurationId, params.data.configId),
        gt(actionLog.ordinal, query.data.after),
      ))
      .orderBy(actionLog.ordinal)
      .limit(query.data.limit);

    const entries = rows.map((row) => ({
      ordinal: row.ordinal,
      id: row.id,
      batchId: row.batchId,
      revision: row.revision,
      /** Server-observed authenticated principal at ingestion. */
      submittedBy: row.submittedBy,
      actor: row.actor,
      intent: row.intent,
      payload: row.payload,
      inverse: row.inverse,
      provenance: row.provenance,
      /** Operator-reported clock, as recorded — not server-verified. */
      recordedTs: row.recordedTs.toISOString(),
      /** This server's clock at ingestion. */
      receivedAt: row.receivedAt.toISOString(),
    }));

    const last = entries.length > 0 ? entries[entries.length - 1] : undefined;
    return {
      data: {
        entries,
        nextAfter: last?.ordinal ?? query.data.after,
      },
    };
  });
}
