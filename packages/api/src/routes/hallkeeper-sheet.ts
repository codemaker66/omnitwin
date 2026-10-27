import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  configurations,
  events,
  hallkeeperProgress,
} from "../db/schema.js";
import { assembleSheetDataV2, ApprovedSnapshotUnavailableError, linkedEventIds } from "../services/hallkeeper-sheet-v2-data.js";
import { generateSheetPdfV2 } from "../services/hallkeeper-pdf-v2.js";
import { authenticate } from "../middleware/auth.js";
import type { JwtUser } from "../middleware/auth.js";
import { canAccessResource } from "../utils/query.js";
import { resolveProgressMutation, checkedStateAfter, progressEventFor } from "../lib/hallkeeper-progress.js";
import { summarizeSheet } from "../lib/hallkeeper-summary.js";
import { buildSheetPaperCheck } from "../services/sheet-paper-check.js";

// ---------------------------------------------------------------------------
// Hallkeeper sheet routes — v2 end-to-end
//
// Endpoints (all authenticated):
//   GET   /hallkeeper/:configId/sheet     → portrait A4 PDF, rendered per request
//   GET   /hallkeeper/:configId/v2        → JSON HallkeeperSheetV2
//   GET   /hallkeeper/:configId/summary   → ready-by time and rows checked
//   GET   /hallkeeper/:configId/progress  → checked row keys
//   PATCH /hallkeeper/:configId/progress  → set or toggle a row's check state
//
// SECURITY: these endpoints expose PII (contact name, email, phone,
// event details). Access is granted to:
//   - The config owner (the user who claimed it)
//   - Venue staff / hallkeepers for the config's venue
//   - Admin
// Anonymous access is blocked — punch list #4.
//
// Paper that knows its version: both the JSON and the PDF carry a paper
// check (services/sheet-paper-check.ts) — the link the printout's QR code
// opens, which tells anyone holding the paper only whether it is current.
// ---------------------------------------------------------------------------

const ConfigIdParam = z.object({ configId: z.uuid() });
const DownloadQuery = z.object({ download: z.enum(["true", "false"]).default("false") });
/** Which event the hallkeeper arrived from. A layout can be reused across
 *  events; without this the sheet has to guess which one's hour to print, and
 *  a shared layout printed the earlier event's time whatever slot was tapped.
 *  Optional: a sheet opened directly still renders, on the union of its links,
 *  and so does one carrying an eventId this configuration is not linked to —
 *  see `resolveTiming`, which is where that contract is enforced. */
const SheetEventQuery = z.object({ eventId: z.uuid().optional() });

/** Ignore an unparseable eventId rather than 400 — the sheet is still useful
 *  without it, and a hallkeeper with a stale link should see the room, not an
 *  error. The union fallback then applies, exactly as it does for an id that
 *  parses but names an event this configuration is not linked to. */
function requestedEventId(query: unknown): string | null {
  const parsed = SheetEventQuery.safeParse(query);
  return parsed.success ? parsed.data.eventId ?? null : null;
}
// `checked` present → idempotent set-state (force the row); omitted → legacy
// toggle (flip). Unknown keys are stripped, so older `{ rowKey }`-only clients
// keep working and newer set-state clients are accepted by older servers.
const ProgressBody = z.object({
  rowKey: z.string().min(1).max(300),
  checked: z.boolean().optional(),
});

/**
 * Lightweight ownership probe for the progress routes — these routes
 * don't need the full sheet assembly, just the auth pivot. Returns the
 * (venueId, ownerId) pair the canAccessResource helper expects, or
 * `null` when the config does not exist.
 *
 * Security fix (2026-04-17): before this helper existed, the progress
 * GET/PATCH routes skipped `canAccessResource` entirely — any
 * authenticated user with a valid `configId` UUID could read or mutate
 * another venue's checkbox state. Adding this probe + the guard below
 * closes that path.
 */
async function loadConfigAuthPivot(
  db: Database,
  configId: string,
): Promise<{ venueId: string; ownerId: string | null } | null> {
  const [row] = await db.select({
    venueId: configurations.venueId,
    ownerId: configurations.userId,
  })
    .from(configurations)
    .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
    .limit(1);
  return row === undefined ? null : row;
}

/** Whether an event is a live event of the layout's own venue. */
async function isVenueEvent(db: Database, configId: string, eventId: string): Promise<boolean> {
  const [row] = await db.select({ id: events.id })
    .from(events)
    .innerJoin(configurations, eq(configurations.venueId, events.venueId))
    .where(and(eq(events.id, eventId), isNull(events.deletedAt), eq(configurations.id, configId)))
    .limit(1);
  return row !== undefined;
}

/** The event this request's ticks belong to (lib/hallkeeper-progress.ts
 *  progressEventFor), and how many events the layout is linked to, so a
 *  sheet keeping eventless ticks on a reused layout can say they count on no
 *  Day Board. */
async function progressEventOf(
  db: Database,
  configId: string,
  query: unknown,
): Promise<{ readonly eventId: string | null; readonly linkedEvents: number }> {
  const requested = requestedEventId(query);
  const [linked, requestedIsVenueEvent] = await Promise.all([
    linkedEventIds(db, configId),
    requested === null ? Promise.resolve(false) : isVenueEvent(db, configId, requested),
  ]);
  return {
    eventId: progressEventFor({ linkedEventIds: linked, requestedEventId: requested, requestedIsVenueEvent }),
    linkedEvents: linked.length,
  };
}

/** One event's ticks on a layout, or the layout's eventless ticks — never
 *  another event's. */
function progressScope(configId: string, eventId: string | null) {
  return and(
    eq(hallkeeperProgress.configId, configId),
    eventId === null ? isNull(hallkeeperProgress.eventId) : eq(hallkeeperProgress.eventId, eventId),
  );
}

async function requireConfigAccess(
  db: Database,
  configId: string,
  user: JwtUser,
): Promise<
  | { ok: true }
  | { ok: false; status: 404 | 403; error: string; code: string }
> {
  const pivot = await loadConfigAuthPivot(db, configId);
  if (pivot === null) {
    return { ok: false, status: 404, error: "Configuration not found", code: "NOT_FOUND" };
  }
  if (!canAccessResource(user, pivot.ownerId, pivot.venueId)) {
    return { ok: false, status: 403, error: "Insufficient permissions", code: "FORBIDDEN" };
  }
  return { ok: true };
}

export async function hallkeeperSheetRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  const frontendUrl = process.env["FRONTEND_URL"] ?? null;

  // GET /hallkeeper/:configId/sheet — the PDF, rendered for this request
  //
  // Every copy is rendered when it is asked for, because each copy prints
  // its own time ("v7, issued 16 Oct 14:02, printed 17 Oct 06:02") and a QR
  // code carrying that time. Rendering costs a few hundred milliseconds of
  // pdfkit per download, which a venue's handful of sheets a day affords.
  //
  // PRIVACY: the sheet can carry free-text allergy and access notes, which
  // are health data. It is never stored in a bucket and this route never
  // redirects; the bytes leave only in this signed-in response, marked
  // `private, no-store` so no shared cache keeps a copy. A legacy
  // `snapshot.pdfUrl` left in the database is ignored.
  server.get("/:configId/sheet", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const query = DownloadQuery.safeParse(request.query);
    const isDownload = query.success && query.data.download === "true";

    const baseUrl = frontendUrl ?? `${request.protocol}://${request.hostname}`;

    // Deny foreign access before revealing whether approved evidence is damaged.
    const gate = await requireConfigAccess(db, params.data.configId, request.user);
    if (!gate.ok) {
      return reply.status(gate.status).send({ error: gate.error, code: gate.code });
    }

    let result;
    try {
      result = await assembleSheetDataV2(db, params.data.configId, baseUrl, requestedEventId(request.query));
    } catch (error) {
      if (!(error instanceof ApprovedSnapshotUnavailableError)) throw error;
      return reply.status(503).header("Cache-Control", "private, no-store")
        .send({ error: error.message, code: error.code });
    }
    if (result === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, result.authPivot.configUserId, result.authPivot.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const paperCheck = await buildSheetPaperCheck(baseUrl, params.data.configId, result.issue);
    const payload = paperCheck === null ? result.payload : { ...result.payload, paperCheck };
    const pdfBuffer = await generateSheetPdfV2(payload);
    const filename = `hallkeeper-sheet-${payload.config.name.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-")}.pdf`;

    void reply
      .header("Content-Type", "application/pdf")
      .header("Cache-Control", "private, no-store")
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

    // Deny foreign access before revealing whether approved evidence is damaged.
    const gate = await requireConfigAccess(db, params.data.configId, request.user);
    if (!gate.ok) {
      return reply.status(gate.status).send({ error: gate.error, code: gate.code });
    }

    let result;
    try {
      result = await assembleSheetDataV2(db, params.data.configId, baseUrl, requestedEventId(request.query));
    } catch (error) {
      if (!(error instanceof ApprovedSnapshotUnavailableError)) throw error;
      return reply.status(503).header("Cache-Control", "private, no-store")
        .send({ error: error.message, code: error.code });
    }
    if (result === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, result.authPivot.configUserId, result.authPivot.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const paperCheck = await buildSheetPaperCheck(baseUrl, params.data.configId, result.issue);
    return { data: paperCheck === null ? result.payload : { ...result.payload, paperCheck } };
  });

  // GET /hallkeeper/:configId/summary — the Day Board's line about a sheet:
  // when setup must be done and how many rows are checked, counted from the
  // same sheet the v2 route serves and behind the same gates.
  server.get("/:configId/summary", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const gate = await requireConfigAccess(db, params.data.configId, request.user);
    if (!gate.ok) {
      return reply.status(gate.status).send({ error: gate.error, code: gate.code });
    }

    const baseUrl = frontendUrl ?? `${request.protocol}://${request.hostname}`;
    let result;
    try {
      result = await assembleSheetDataV2(db, params.data.configId, baseUrl, requestedEventId(request.query));
    } catch (error) {
      if (!(error instanceof ApprovedSnapshotUnavailableError)) throw error;
      return reply.status(503).header("Cache-Control", "private, no-store")
        .send({ error: error.message, code: error.code });
    }
    if (result === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, result.authPivot.configUserId, result.authPivot.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    // Tonight's ticks only: a layout reused from an earlier event must not
    // arrive on the Day Board already counted as set.
    const { eventId } = await progressEventOf(db, params.data.configId, request.query);
    const marks = await db.select({ rowKey: hallkeeperProgress.rowKey })
      .from(hallkeeperProgress)
      .where(progressScope(params.data.configId, eventId));

    return { data: summarizeSheet(params.data.configId, result.payload, marks.map((mark) => mark.rowKey)) };
  });

  // -------------------------------------------------------------------------
  // Progress endpoints — server-backed checkbox state
  //
  // The hallkeeper_progress table stores which rows are checked for a given
  // config and event: both routes take the sheet's ?eventId= and keep to that
  // event's ticks (progressEventOf). GET returns all checked keys. Multiple
  // hallkeepers share the same state — no localStorage isolation.
  //
  // PATCH has two modes (see `resolveProgressMutation`):
  //   - `{ rowKey, checked }` → idempotent SET-STATE: force the row to
  //     `checked` (INSERT if absent, DELETE if present, no-op if already
  //     there). Safe to replay — the offline sync queue relies on this so a
  //     lost response or a concurrent device can't flip the row to the wrong
  //     value.
  //   - `{ rowKey }`          → legacy TOGGLE: flip the current state. Kept
  //     for backward compatibility with older clients.
  // -------------------------------------------------------------------------

  // GET /hallkeeper/:configId/progress — list all checked row keys
  server.get("/:configId/progress", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const gate = await requireConfigAccess(db, params.data.configId, request.user);
    if (!gate.ok) {
      return reply.status(gate.status).send({ error: gate.error, code: gate.code });
    }

    const { eventId, linkedEvents } = await progressEventOf(db, params.data.configId, request.query);
    const rows = await db.select({
      rowKey: hallkeeperProgress.rowKey,
      checkedAt: hallkeeperProgress.checkedAt,
    })
      .from(hallkeeperProgress)
      .where(progressScope(params.data.configId, eventId));

    const checked: Record<string, string> = {};
    for (const row of rows) {
      checked[row.rowKey] = row.checkedAt.toISOString();
    }

    // eventId is the scope these ticks belong to; the sheet pins it for its
    // writes. linkedEvents lets it say when eventless ticks count on no board.
    return { data: { configId: params.data.configId, eventId, linkedEvents, checked } };
  });

  // PATCH /hallkeeper/:configId/progress — set or toggle a row's check state
  server.patch("/:configId/progress", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const body = ProgressBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid body", code: "VALIDATION_ERROR", details: body.error.issues });
    }

    const gate = await requireConfigAccess(db, params.data.configId, request.user);
    if (!gate.ok) {
      return reply.status(gate.status).send({ error: gate.error, code: gate.code });
    }

    const { configId } = params.data;
    const { rowKey, checked: desired } = body.data;
    const { eventId } = await progressEventOf(db, configId, request.query);

    // Idempotent set-state path. Avoid select-then-insert races: two devices
    // replaying "checked: true" for the same row must converge, not surface a
    // duplicate-key 500 from the unique (config_id, event_id, row_key) key.
    if (desired !== undefined) {
      if (desired) {
        await db.insert(hallkeeperProgress).values({
          configId,
          eventId,
          rowKey,
          checkedBy: request.user.id,
        }).onConflictDoNothing({
          target: [hallkeeperProgress.configId, hallkeeperProgress.eventId, hallkeeperProgress.rowKey],
        });
      } else {
        await db.delete(hallkeeperProgress)
          .where(and(progressScope(configId, eventId), eq(hallkeeperProgress.rowKey, rowKey)));
      }

      return { data: { configId, eventId, rowKey, checked: desired } };
    }

    // Legacy toggle path for older clients that omit `checked`.
    const [existing] = await db.select({ id: hallkeeperProgress.id })
      .from(hallkeeperProgress)
      .where(and(progressScope(configId, eventId), eq(hallkeeperProgress.rowKey, rowKey)))
      .limit(1);

    const exists = existing !== undefined;
    const mutation = resolveProgressMutation(exists, undefined);

    if (mutation === "insert") {
      await db.insert(hallkeeperProgress).values({
        configId,
        eventId,
        rowKey,
        checkedBy: request.user.id,
      });
    } else if (mutation === "delete" && existing !== undefined) {
      await db.delete(hallkeeperProgress)
        .where(eq(hallkeeperProgress.id, existing.id));
    }
    // mutation === "noop" → server already in the desired state; nothing to do.

    return { data: { configId, eventId, rowKey, checked: checkedStateAfter(mutation, exists) } };
  });
}
