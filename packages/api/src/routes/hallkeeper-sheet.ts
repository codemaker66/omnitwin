import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { hallkeeperProgress } from "../db/schema.js";
import { assembleSheetDataV2 } from "../services/hallkeeper-sheet-v2-data.js";
import { generateSheetPdfV2 } from "../services/hallkeeper-pdf-v2.js";
import { authenticate } from "../middleware/auth.js";
import { canAccessResource } from "../utils/query.js";

// ---------------------------------------------------------------------------
// Hallkeeper sheet routes — v2 end-to-end
//
// Endpoints (all authenticated):
//   GET   /hallkeeper/:configId/sheet     → portrait A4 PDF
//   GET   /hallkeeper/:configId/v2        → JSON HallkeeperSheetV2
//   GET   /hallkeeper/:configId/progress  → checked row keys
//   PATCH /hallkeeper/:configId/progress  → toggle a row's check state
//
// SECURITY: these endpoints expose PII (contact name, email, phone,
// event details). Access is granted to:
//   - The config owner (the user who claimed it)
//   - Venue staff / hallkeepers for the config's venue
//   - Admin
// Anonymous access is blocked — punch list #4.
// ---------------------------------------------------------------------------

const ConfigIdParam = z.object({ configId: z.string().uuid() });
const DownloadQuery = z.object({ download: z.enum(["true", "false"]).default("false") });
const ToggleBody = z.object({ rowKey: z.string().min(1).max(300) });

export async function hallkeeperSheetRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  const frontendUrl = process.env["FRONTEND_URL"] ?? null;

  // GET /hallkeeper/:configId/sheet — generate PDF (authenticated)
  server.get("/:configId/sheet", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const query = DownloadQuery.safeParse(request.query);
    const isDownload = query.success && query.data.download === "true";

    const baseUrl = frontendUrl ?? `${request.protocol}://${request.hostname}`;

    const result = await assembleSheetDataV2(db, params.data.configId, baseUrl);
    if (result === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, result.authPivot.configUserId, result.authPivot.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const pdfBuffer = await generateSheetPdfV2(result.payload);
    const filename = `hallkeeper-sheet-${result.payload.config.name.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-")}.pdf`;

    void reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", isDownload ? `attachment; filename="${filename}"` : "inline")
      .header("Content-Length", pdfBuffer.length)
      .send(pdfBuffer);
  });

  // GET /hallkeeper/:configId/v2 — JSON HallkeeperSheetV2 payload
  server.get("/:configId/v2", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const baseUrl = frontendUrl ?? `${request.protocol}://${request.hostname}`;

    const result = await assembleSheetDataV2(db, params.data.configId, baseUrl);
    if (result === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, result.authPivot.configUserId, result.authPivot.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    return { data: result.payload };
  });

  // -------------------------------------------------------------------------
  // Progress endpoints — server-backed checkbox state
  //
  // The hallkeeper_progress table stores which rows are checked for a given
  // config. GET returns all checked keys; PATCH toggles one key. Multiple
  // hallkeepers share the same state — no localStorage isolation.
  //
  // The toggle is idempotent: PATCH with a checked key unchecks it (DELETE),
  // PATCH with an unchecked key checks it (INSERT). The client sends the
  // current desired action ("check" or "uncheck") to avoid races.
  // -------------------------------------------------------------------------

  // GET /hallkeeper/:configId/progress — list all checked row keys
  server.get("/:configId/progress", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const rows = await db.select({
      rowKey: hallkeeperProgress.rowKey,
      checkedAt: hallkeeperProgress.checkedAt,
    })
      .from(hallkeeperProgress)
      .where(eq(hallkeeperProgress.configId, params.data.configId));

    const checked: Record<string, string> = {};
    for (const row of rows) {
      checked[row.rowKey] = row.checkedAt.toISOString();
    }

    return { data: { configId: params.data.configId, checked } };
  });

  // PATCH /hallkeeper/:configId/progress — toggle a row's check state
  server.patch("/:configId/progress", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const body = ToggleBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid body", code: "VALIDATION_ERROR", details: body.error.issues });
    }

    const { configId } = params.data;
    const { rowKey } = body.data;

    // Check if already checked
    const [existing] = await db.select({ id: hallkeeperProgress.id })
      .from(hallkeeperProgress)
      .where(and(
        eq(hallkeeperProgress.configId, configId),
        eq(hallkeeperProgress.rowKey, rowKey),
      ))
      .limit(1);

    if (existing !== undefined) {
      // Uncheck: delete the row
      await db.delete(hallkeeperProgress)
        .where(eq(hallkeeperProgress.id, existing.id));
      return { data: { configId, rowKey, checked: false } };
    }

    // Check: insert a new row
    await db.insert(hallkeeperProgress).values({
      configId,
      rowKey,
      checkedBy: request.user.id,
    });

    return { data: { configId, rowKey, checked: true } };
  });
}
