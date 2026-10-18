import type { FastifyInstance } from "fastify";
import {
  SheetPaperCheckQuerySchema,
  type SheetPaperCheckQuery,
  type SheetPaperCheckResult,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// GET /public/sheet-check — is this printed sheet current?
//
// No sign-in: the person asking is holding paper at 06:00, perhaps in a
// cellar. The answer is version state only (services/sheet-paper-check.ts):
// it never carries event, room, guest or contact detail, so a QR code on a
// discarded sheet leaks nothing.
//
// Limits: 30 checks a minute per caller on top of the global limiter. With a
// random snapshot id and a 64-bit fingerprint per issued copy that is far
// below anything that could enumerate sheets; it is there to stop a scraper
// hammering the database, not to protect a guessable secret.
// ---------------------------------------------------------------------------

export const SHEET_CHECK_RATE_LIMIT = { max: 30, timeWindow: "1 minute" } as const;

export async function publicSheetCheckRoutes(
  server: FastifyInstance,
  opts: { check: (query: SheetPaperCheckQuery) => Promise<SheetPaperCheckResult> },
): Promise<void> {
  server.get("/sheet-check", {
    config: { rateLimit: SHEET_CHECK_RATE_LIMIT },
  }, async (request, reply) => {
    // The answer changes the moment a new version is approved; never cache it,
    // and keep the page out of search results.
    void reply.header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex");
    const parsed = SheetPaperCheckQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "This link is not a sheet check.", code: "VALIDATION_ERROR" });
    }
    const result = await opts.check(parsed.data);
    return { data: result };
  });
}
