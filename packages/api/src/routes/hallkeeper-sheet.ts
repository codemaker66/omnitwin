import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { assembleSheetData, generateSheetPdf } from "../services/hallkeeper-sheet-v2.js";
import { assembleSheetDataV2 } from "../services/hallkeeper-sheet-v2-data.js";
import { authenticate } from "../middleware/auth.js";
import { canAccessResource } from "../utils/query.js";

// ---------------------------------------------------------------------------
// Hallkeeper sheet routes — PDF generation and data endpoint
//
// SECURITY: these endpoints expose PII (contact name, email, phone, event
// details). They MUST be authenticated. Access is granted to:
//   - The config owner (the user who claimed the config)
//   - Venue staff / hallkeepers for the config's venue
//   - Admin
//
// Punch list #4: the previous version was anonymous — anyone with a guessed
// or leaked UUID could retrieve full event PII. The signed-share-URL UX
// (e.g. one-time link generated from the dashboard) is a follow-up; for
// now we require an auth session, which the dashboard already has.
// ---------------------------------------------------------------------------

const ConfigIdParam = z.object({ configId: z.string().uuid() });
const DownloadQuery = z.object({ download: z.enum(["true", "false"]).default("false") });

export async function hallkeeperSheetRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // Base URL for QR codes / web view links — use FRONTEND_URL to prevent
  // Host header spoofing (an attacker could send Host: evil.com and get
  // their domain printed on the QR code). Falls back to request origin
  // only in dev when FRONTEND_URL is not set.
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

    const data = await assembleSheetData(db, params.data.configId, baseUrl);
    if (data === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, data.config.userId, data.venue.id)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const pdfBuffer = await generateSheetPdf(data);

    const filename = `hallkeeper-sheet-${data.config.name.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-")}.pdf`;

    void reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", isDownload ? `attachment; filename="${filename}"` : "inline")
      .header("Content-Length", pdfBuffer.length)
      .send(pdfBuffer);
  });

  // GET /hallkeeper/:configId/data — JSON data (authenticated).
  //
  // Status: LEGACY. The web HallkeeperPage migrated to /v2 in the phase-zone
  // redesign; this endpoint remains live because:
  //   1. The PDF renderer (assembleSheetData -> generateSheetPdf) still
  //      consumes the flat manifest shape — retiring /data before the PDF
  //      is rewritten against v2 would break downloads.
  //   2. External integrations (if any) may reference /data; we keep the
  //      contract until we're confident nothing reaches it.
  //
  // When the PDF is ported to v2, retire /data and delete assembleSheetData
  // + the v1 manifest-generator.ts.
  server.get("/:configId/data", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const baseUrl = frontendUrl ?? `${request.protocol}://${request.hostname}`;

    const data = await assembleSheetData(db, params.data.configId, baseUrl);
    if (data === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, data.config.userId, data.venue.id)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    return { data };
  });

  // GET /hallkeeper/:configId/v2 — NEW phase/zone data shape for the
  // redesigned sheet. Lives alongside /data (v1) until the v1 web view
  // retires, so a rollback to v1 is a routing-level change with no data
  // migration. Same auth policy as /data.
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
}
