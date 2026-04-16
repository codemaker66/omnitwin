import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { assembleSheetDataV2 } from "../services/hallkeeper-sheet-v2-data.js";
import { generateSheetPdfV2 } from "../services/hallkeeper-pdf-v2.js";
import { authenticate } from "../middleware/auth.js";
import { canAccessResource } from "../utils/query.js";

// ---------------------------------------------------------------------------
// Hallkeeper sheet routes — v2 end-to-end
//
// Two endpoints, both authenticated:
//   GET /hallkeeper/:configId/sheet  → portrait A4 PDF (phase/zone layout)
//   GET /hallkeeper/:configId/v2     → JSON HallkeeperSheetV2 (for web view)
//
// Both routes share the same assembleSheetDataV2 data path, so the PDF
// and the web view are guaranteed to show the same manifest — no risk
// of shape drift between "what the planner sees" and "what the
// hallkeeper gets printed".
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
}
