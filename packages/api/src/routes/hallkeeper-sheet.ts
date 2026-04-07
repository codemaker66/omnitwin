import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { assembleSheetData, generateSheetPdf } from "../services/hallkeeper-sheet-v2.js";

// ---------------------------------------------------------------------------
// Hallkeeper sheet routes — PDF generation and data endpoint
// ---------------------------------------------------------------------------

const ConfigIdParam = z.object({ configId: z.string().uuid() });
const DownloadQuery = z.object({ download: z.enum(["true", "false"]).default("false") });

export async function hallkeeperSheetRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // GET /hallkeeper/:configId/sheet — generate PDF
  server.get("/:configId/sheet", async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const query = DownloadQuery.safeParse(request.query);
    const isDownload = query.success && query.data.download === "true";

    // Determine base URL for QR code / web view link
    const protocol = request.protocol;
    const host = request.hostname;
    const baseUrl = `${protocol}://${host}`;

    const data = await assembleSheetData(db, params.data.configId, baseUrl);
    if (data === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    const pdfBuffer = await generateSheetPdf(data);

    const filename = `hallkeeper-sheet-${data.config.name.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-")}.pdf`;

    void reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", isDownload ? `attachment; filename="${filename}"` : "inline")
      .header("Content-Length", pdfBuffer.length)
      .send(pdfBuffer);
  });

  // GET /hallkeeper/:configId/data — JSON data for web view
  server.get("/:configId/data", async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const protocol = request.protocol;
    const host = request.hostname;
    const baseUrl = `${protocol}://${host}`;

    const data = await assembleSheetData(db, params.data.configId, baseUrl);
    if (data === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    return { data };
  });
}
