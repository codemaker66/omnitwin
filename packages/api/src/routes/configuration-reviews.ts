import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { eq, and, isNull, asc, desc, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  configurations,
  configurationReviewHistory,
  enquiries,
  spaces,
  users,
  venues,
} from "../db/schema.js";
import {
  CONFIGURATION_REVIEW_STATUSES,
  type ConfigurationReviewStatus,
} from "@omnitwin/types";
import { canTransition } from "../state-machines/config-review.js";
import { authenticate } from "../middleware/auth.js";
import { canAccessResource } from "../utils/query.js";
import { sendEmailAsync } from "../services/email.js";
import {
  configApproved,
  configChangesRequested,
  configRejected,
  configSubmitted,
  hallkeeperNotified,
} from "../services/email-templates.js";
import {
  appendReviewHistory,
  approveSnapshot,
  ConfigurationNotFoundError,
  createSnapshot,
  getLatestApprovedSnapshot,
  getLatestSnapshot,
  getSnapshotByVersion,
  SnapshotAlreadyApprovedError,
  SnapshotConflictError,
  SnapshotNotFoundError,
} from "../services/sheet-snapshot.js";
import { schedulePrerender } from "../services/pdf-prerender.js";
import { incrementCounter } from "../observability/metrics.js";
import type { Env } from "../env.js";
import { emit as emitEvent } from "../observability/event-bus.js";
import {
  endReviewSession,
  heartbeatReviewSession,
  listActiveReviewers,
} from "../services/review-sessions.js";

// ---------------------------------------------------------------------------
// Configuration review routes — the approval workflow on top of
// /configurations/:id. Mounted under prefix `/configurations`.
//
//   POST /:id/review/submit                 planner submits for approval
//   POST /:id/review/start-review           staff claims the review
//   POST /:id/review/approve                staff approves
//   POST /:id/review/reject                 staff rejects (note required)
//   POST /:id/review/request-changes        staff asks for changes (note required)
//   POST /:id/review/withdraw               planner (or staff) withdraws
//   POST /:id/review/archive                staff closes out post-event
//   GET  /:id/review/history                read-only audit timeline
//   GET  /:id/review/available-transitions  UI: which buttons to render
//   GET  /:id/snapshot/latest               latest snapshot (approved-only for hallkeeper)
//   GET  /:id/snapshot/:version             historical version (admin / audit)
//
// All routes are authenticated. Approver-only routes (approve / reject /
// request-changes / start-review / archive) additionally gate on the
// state machine's role-aware canTransition — the route layer performs
// the HTTP-specific permission check, the state machine decides
// structural + role legality.
// ---------------------------------------------------------------------------

const ConfigIdParam = z.object({ configId: z.string().uuid() });
const VersionParam = z.object({
  configId: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

const OptionalNoteBody = z.object({
  note: z.string().max(2000).optional(),
});

const RequiredNoteBody = z.object({
  note: z.string().trim().min(1, "note is required").max(2000),
});

// ---------------------------------------------------------------------------
// Lookup helper — shared by every route.
// ---------------------------------------------------------------------------

interface ConfigLookup {
  readonly id: string;
  readonly userId: string | null;
  readonly venueId: string;
  readonly spaceId: string;
  readonly reviewStatus: ConfigurationReviewStatus;
  readonly name: string;
}

async function loadConfig(
  db: Database,
  configId: string,
): Promise<ConfigLookup | null> {
  const [row] = await db.select({
    id: configurations.id,
    userId: configurations.userId,
    venueId: configurations.venueId,
    spaceId: configurations.spaceId,
    reviewStatus: configurations.reviewStatus,
    name: configurations.name,
  })
    .from(configurations)
    .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
    .limit(1);
  if (row === undefined) return null;
  return {
    id: row.id,
    userId: row.userId,
    venueId: row.venueId,
    spaceId: row.spaceId,
    reviewStatus: row.reviewStatus as ConfigurationReviewStatus,
    name: row.name,
  };
}

// ---------------------------------------------------------------------------
// Review-email context loader
//
// Resolves the humans + the names-for-display needed to send any review
// transition email. Always returns a best-effort value (the caller treats
// every field as optional UI material — a missing planner still transitions
// the review state, we just skip that email).
//
// All reads run in parallel; the whole call is O(4) DB round trips even in
// the hot-path approval case (planner + staff + hallkeepers + space/venue).
// ---------------------------------------------------------------------------

interface ReviewEmailRecipient {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
}

interface ReviewEmailContext {
  readonly venueName: string;
  readonly spaceName: string;
  readonly planner: ReviewEmailRecipient | null;
  readonly staff: readonly ReviewEmailRecipient[];
  readonly hallkeepers: readonly ReviewEmailRecipient[];
  readonly actor: ReviewEmailRecipient;
  /**
   * Human-readable event date for the most-recent enquiry linked to
   * this configuration (or null when none). Feeds the `eventDate` field
   * in the hallkeeperNotified email — previously hardcoded to null,
   * which meant hallkeepers never saw WHEN an approved event was
   * happening without opening the sheet.
   *
   * Format is a pass-through en-GB long-form date string
   * (e.g. "Saturday, 15 June 2026"). Templates render as plain text so
   * timezone considerations do not apply at the email layer — the
   * underlying `preferred_date` column is a Postgres `date` (no time).
   */
  readonly eventDate: string | null;
}

function displayNameForUser(row: { email: string; name: string | null }): string {
  const trimmed = row.name === null ? "" : row.name.trim();
  return trimmed.length > 0 ? trimmed : row.email;
}

async function loadReviewEmailContext(
  db: Database,
  config: ConfigLookup,
  actor: { id: string; email: string; role: string },
): Promise<ReviewEmailContext> {
  const [
    venueRows, spaceRows, plannerRows, staffRows, hallkeeperRows, actorRows, enquiryRows,
  ] = await Promise.all([
    db.select({ name: venues.name }).from(venues).where(eq(venues.id, config.venueId)).limit(1),
    db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, config.spaceId)).limit(1),
    config.userId === null
      ? Promise.resolve([])
      : db.select({ id: users.id, email: users.email, name: users.name })
          .from(users).where(eq(users.id, config.userId)).limit(1),
    db.select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(and(eq(users.venueId, config.venueId), eq(users.role, "staff"))),
    db.select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(and(eq(users.venueId, config.venueId), eq(users.role, "hallkeeper"))),
    db.select({ id: users.id, email: users.email, name: users.name })
      .from(users).where(eq(users.id, actor.id)).limit(1),
    // Most-recent enquiry linked to this config. Used only to surface
    // the event date in the hallkeeper approval email — empty/null
    // rows yield `eventDate: null`, which the template hides cleanly.
    db.select({ preferredDate: enquiries.preferredDate })
      .from(enquiries)
      .where(eq(enquiries.configurationId, config.id))
      .orderBy(desc(enquiries.createdAt))
      .limit(1),
  ]);

  const venueName = venueRows[0]?.name ?? "Venue";
  const spaceName = spaceRows[0]?.name ?? "Space";

  const planner: ReviewEmailRecipient | null = plannerRows[0] === undefined
    ? null
    : {
        id: plannerRows[0].id,
        email: plannerRows[0].email,
        displayName: displayNameForUser(plannerRows[0]),
      };

  const staff: ReviewEmailRecipient[] = staffRows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: displayNameForUser(r),
  }));

  const hallkeepers: ReviewEmailRecipient[] = hallkeeperRows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: displayNameForUser(r),
  }));

  // Actor is always populated: if the users table lookup returned nothing
  // (test environment, token-only user), fall back to the JWT's email.
  const actorRow = actorRows[0];
  const actorRecipient: ReviewEmailRecipient = actorRow !== undefined
    ? { id: actorRow.id, email: actorRow.email, displayName: displayNameForUser(actorRow) }
    : { id: actor.id, email: actor.email, displayName: actor.email };

  // Enquiry preferredDate is a Postgres `date` column → string "YYYY-MM-DD".
  // Format as en-GB long form for email rendering; null if no enquiry.
  const rawDate = enquiryRows[0]?.preferredDate ?? null;
  const eventDate = rawDate === null ? null : formatEventDate(rawDate);

  return {
    venueName, spaceName, planner, staff, hallkeepers,
    actor: actorRecipient, eventDate,
  };
}

/**
 * Format a Postgres `date` string ("YYYY-MM-DD") as a human-readable
 * en-GB long form ("Saturday, 15 June 2026"). Returns the raw input
 * unchanged if it fails to parse — the template then renders whatever
 * string was stored, which is still informational.
 *
 * We parse via `Date.UTC(Y, M-1, D)` rather than the one-arg Date
 * constructor because the latter is locale-dependent on invalid
 * inputs. The date is rendered in UTC for the same reason a
 * planner-entered "15 June" should print as 15 June regardless of
 * the server's runtime timezone.
 */
function formatEventDate(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (match === null) return dateStr;
  const [, y, m, d] = match;
  if (y === undefined || m === undefined || d === undefined) return dateStr;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Fire-and-forget email send wrapper. Accepts either a resolved
 * { subject, html } object OR a Promise of one — the react-email
 * templates are async since @react-email/render v2 returns a Promise.
 * Taking both here lets call sites stay one-liners without awaiting
 * every template factory.
 */
function fireEmail(
  db: Database,
  logger: FastifyBaseLogger,
  to: string,
  idempotencyKey: string,
  payload:
    | { subject: string; html: string }
    | Promise<{ subject: string; html: string }>,
): void {
  void Promise.resolve(payload).then((resolved) => {
    sendEmailAsync(
      { to, subject: resolved.subject, html: resolved.html },
      { db, idempotencyKey, logger },
    );
  });
}

// ---------------------------------------------------------------------------
// Transition executor — the common write path for every state-change
// route. After the state-machine + access checks, we:
//
//   1. UPDATE configurations.review_status (+ any extraColumns the
//      route supplies, e.g. submittedAt)
//   2. INSERT a row into configuration_review_history
// ---------------------------------------------------------------------------

interface ExecuteTransitionInput {
  readonly db: Database;
  readonly config: ConfigLookup;
  readonly toStatus: ConfigurationReviewStatus;
  readonly changedBy: string | null;
  readonly note: string | null;
  readonly extraColumns?: Partial<typeof configurations.$inferInsert>;
}

async function executeTransition(input: ExecuteTransitionInput): Promise<void> {
  // CONSISTENCY BOUNDARY: the state change and its audit-history row
  // must commit atomically. Before this transaction, a failure of
  // the history insert would leave the state advanced but with NO
  // audit row — a regulatory-grade defect for an event-planning
  // platform where approval/rejection trails are legally relevant.
  //
  // The block is short and does not span network I/O beyond the
  // two writes — safe for Postgres default isolation (READ COMMITTED).
  await input.db.transaction(async (tx) => {
    await tx.update(configurations)
      .set({
        reviewStatus: input.toStatus,
        reviewNote: input.note,
        updatedAt: new Date(),
        ...input.extraColumns,
      })
      .where(eq(configurations.id, input.config.id));

    await appendReviewHistory(tx, {
      configurationId: input.config.id,
      fromStatus: input.config.reviewStatus,
      toStatus: input.toStatus,
      changedBy: input.changedBy,
      note: input.note,
    });
  });

  // Business-level observability. Post-commit so we never emit a
  // counter for a transition that was rolled back by the transaction.
  // Labels are low-cardinality (8×8 possible combinations, bounded by
  // the state machine) so Prometheus won't time-series-explode.
  incrementCounter("configuration_review_transition_total", {
    from: input.config.reviewStatus,
    to: input.toStatus,
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

interface ReviewRoutesOpts {
  readonly db: Database;
  readonly env: Env;
}

export async function configurationReviewRoutes(
  server: FastifyInstance,
  opts: ReviewRoutesOpts,
): Promise<void> {
  const { db, env } = opts;

  const frontendUrl = process.env["FRONTEND_URL"] ?? null;

  // -------------------------------------------------------------------------
  // POST /:configId/review/submit — planner submits for approval
  //
  // Idempotent: if the layout is identical to the latest snapshot the
  // call returns 200 with { created: false }, leaving review_status
  // untouched. Otherwise a new snapshot is created and review_status
  // advances to "submitted".
  // -------------------------------------------------------------------------

  server.post("/:configId/review/submit", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const body = OptionalNoteBody.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid body", code: "VALIDATION_ERROR", details: body.error.issues });
    }

    const config = await loadConfig(db, params.data.configId);
    if (config === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    if (!canTransition(config.reviewStatus, "submitted", request.user.role)) {
      return reply.status(409).send({
        error: `Cannot submit from state '${config.reviewStatus}'`,
        code: "INVALID_TRANSITION",
        currentStatus: config.reviewStatus,
      });
    }

    const baseUrl = frontendUrl ?? `${request.protocol}://${request.hostname}`;

    let snapshot;
    let created: boolean;
    try {
      const result = await createSnapshot(db, {
        configId: config.id,
        createdBy: request.user.id,
        baseUrl,
      });
      snapshot = result.snapshot;
      created = result.created;
    } catch (err) {
      if (err instanceof ConfigurationNotFoundError) {
        return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
      }
      if (err instanceof SnapshotConflictError) {
        // Two concurrent submits both tried to insert the same next
        // version. The unique constraint rejected the loser. Map to 409
        // so the client can show "another submission is in flight, please
        // refresh" instead of the generic error banner.
        return reply.status(409).send({
          error: "Another submission is in progress for this configuration. Please refresh and try again.",
          code: "SNAPSHOT_CONFLICT",
        });
      }
      throw err;
    }

    if (!created) {
      return { data: { created: false, snapshot, reviewStatus: config.reviewStatus } };
    }

    const note = body.data.note?.trim();
    await executeTransition({
      db,
      config,
      toStatus: "submitted",
      changedBy: request.user.id,
      note: note !== undefined && note.length > 0 ? note : null,
      extraColumns: { submittedAt: new Date() },
    });

    // Notify venue staff — one email per staff member, idempotent per
    // (snapshot, recipient) so a retried submit doesn't double-send.
    const baseFeUrl = frontendUrl ?? `${request.protocol}://${request.hostname}`;
    const ctx = await loadReviewEmailContext(db, config, request.user);
    const reviewUrl = `${baseFeUrl}/dashboard/reviews/${config.id}`;
    for (const recipient of ctx.staff) {
      fireEmail(
        db,
        request.log,
        recipient.email,
        `config-submitted:${snapshot.id}:${recipient.id}`,
        configSubmitted({
          eventName: config.name,
          venueName: ctx.venueName,
          spaceName: ctx.spaceName,
          snapshotVersion: snapshot.version,
          submittedByName: ctx.actor.displayName,
          reviewUrl,
        }),
      );
    }

    return { data: { created: true, snapshot, reviewStatus: "submitted" as const } };
  });

  // -------------------------------------------------------------------------
  // POST /:configId/review/start-review — staff claims the review
  // -------------------------------------------------------------------------

  server.post("/:configId/review/start-review", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const config = await loadConfig(db, params.data.configId);
    if (config === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    if (!canTransition(config.reviewStatus, "under_review", request.user.role)) {
      return reply.status(409).send({
        error: `Cannot start review from state '${config.reviewStatus}'`,
        code: "INVALID_TRANSITION",
        currentStatus: config.reviewStatus,
      });
    }

    await executeTransition({
      db,
      config,
      toStatus: "under_review",
      changedBy: request.user.id,
      note: null,
    });

    return { data: { reviewStatus: "under_review" as const } };
  });

  // -------------------------------------------------------------------------
  // POST /:configId/review/approve — staff approves
  //
  // Invariant: approval requires a snapshot. If none exists → 409.
  // -------------------------------------------------------------------------

  server.post("/:configId/review/approve", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const body = OptionalNoteBody.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid body", code: "VALIDATION_ERROR", details: body.error.issues });
    }

    const config = await loadConfig(db, params.data.configId);
    if (config === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    if (!canTransition(config.reviewStatus, "approved", request.user.role)) {
      return reply.status(409).send({
        error: `Cannot approve from state '${config.reviewStatus}'`,
        code: "INVALID_TRANSITION",
        currentStatus: config.reviewStatus,
      });
    }

    const latest = await getLatestSnapshot(db, config.id);
    if (latest === null) {
      return reply.status(409).send({
        error: "Cannot approve a configuration with no snapshot",
        code: "NO_SNAPSHOT",
      });
    }

    let approved;
    try {
      approved = await approveSnapshot(db, latest.id, request.user.id);
    } catch (err) {
      if (err instanceof SnapshotNotFoundError) {
        return reply.status(404).send({ error: "Snapshot not found", code: "SNAPSHOT_NOT_FOUND" });
      }
      if (err instanceof SnapshotAlreadyApprovedError) {
        return reply.status(409).send({ error: "Snapshot already approved", code: "SNAPSHOT_ALREADY_APPROVED" });
      }
      throw err;
    }

    // Fire-and-forget PDF pre-render. Uploads the rendered PDF to R2
    // under a content-hashed key and sets `snapshot.pdfUrl`, so the
    // /hallkeeper/:configId/sheet route can redirect to a CDN URL
    // instead of rendering on-demand. Failures log and fall back to
    // on-demand — no error path blocks the approval response.
    schedulePrerender(db, env, request.log, {
      snapshotId: approved.id,
      configId: config.id,
      version: approved.version,
      sourceHash: approved.sourceHash,
      payload: approved.payload,
    });

    const note = body.data.note?.trim();
    const trimmedNote = note !== undefined && note.length > 0 ? note : null;
    await appendReviewHistory(db, {
      configurationId: config.id,
      fromStatus: config.reviewStatus,
      toStatus: "approved",
      changedBy: request.user.id,
      note: trimmedNote,
    });

    // Notify planner + every hallkeeper on duty at the venue. The two
    // emails are intentionally distinct: planner's CTA is editor / sheet
    // preview; hallkeeper's CTA is the day-of sheet.
    const baseFeUrl = frontendUrl ?? `${request.protocol}://${request.hostname}`;
    const ctx = await loadReviewEmailContext(db, config, request.user);
    const hallkeeperUrl = `${baseFeUrl}/hallkeeper/${config.id}`;
    const editorUrl = `${baseFeUrl}/editor/${config.id}`;
    const approvedAtIso = approved.approvedAt ?? new Date().toISOString();

    // Emit a typed `approval.recorded` event AFTER the audit history
    // row is appended + the email context is resolved. Subscribers
    // (registered during `buildServer`) handle their own concerns:
    // analytics, webhooks, Slack pings, future integrations.
    // Emitting is non-blocking; hot path stays snappy.
    emitEvent(request.log, "approval.recorded", {
      configId: config.id,
      snapshotId: approved.id,
      version: approved.version,
      sourceHash: approved.sourceHash,
      approval: {
        version: approved.version,
        approvedAt: approvedAtIso,
        approverName: ctx.actor.displayName,
      },
      payload: approved.payload,
    });

    if (ctx.planner !== null) {
      fireEmail(
        db,
        request.log,
        ctx.planner.email,
        `config-approved:${approved.id}:${ctx.planner.id}`,
        configApproved({
          eventName: config.name,
          venueName: ctx.venueName,
          spaceName: ctx.spaceName,
          snapshotVersion: approved.version,
          approvedByName: ctx.actor.displayName,
          approvedAt: approvedAtIso,
          hallkeeperUrl,
          editorUrl,
          note: trimmedNote,
        }),
      );
    }

    for (const hk of ctx.hallkeepers) {
      fireEmail(
        db,
        request.log,
        hk.email,
        `hallkeeper-notified:${approved.id}:${hk.id}`,
        hallkeeperNotified({
          eventName: config.name,
          venueName: ctx.venueName,
          spaceName: ctx.spaceName,
          snapshotVersion: approved.version,
          eventDate: ctx.eventDate,
          hallkeeperUrl,
        }),
      );
    }

    return { data: { reviewStatus: "approved" as const, snapshot: approved } };
  });

  // -------------------------------------------------------------------------
  // POST /:configId/review/reject — staff rejects (note required)
  // -------------------------------------------------------------------------

  server.post("/:configId/review/reject", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const body = RequiredNoteBody.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "A rejection note is required",
        code: "VALIDATION_ERROR",
        details: body.error.issues,
      });
    }

    const config = await loadConfig(db, params.data.configId);
    if (config === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    if (!canTransition(config.reviewStatus, "rejected", request.user.role)) {
      return reply.status(409).send({
        error: `Cannot reject from state '${config.reviewStatus}'`,
        code: "INVALID_TRANSITION",
        currentStatus: config.reviewStatus,
      });
    }

    await executeTransition({
      db,
      config,
      toStatus: "rejected",
      changedBy: request.user.id,
      note: body.data.note,
    });

    // Notify planner with the reviewer's note so they know why.
    const baseFeUrl = frontendUrl ?? `${request.protocol}://${request.hostname}`;
    const ctx = await loadReviewEmailContext(db, config, request.user);
    const latest = await getLatestSnapshot(db, config.id);
    const snapshotVersion = latest?.version ?? 1;
    if (ctx.planner !== null) {
      fireEmail(
        db,
        request.log,
        ctx.planner.email,
        `config-rejected:${config.id}:v${String(snapshotVersion)}:${ctx.planner.id}`,
        configRejected({
          eventName: config.name,
          venueName: ctx.venueName,
          spaceName: ctx.spaceName,
          snapshotVersion,
          rejectedByName: ctx.actor.displayName,
          editorUrl: `${baseFeUrl}/editor/${config.id}`,
          note: body.data.note,
        }),
      );
    }

    return { data: { reviewStatus: "rejected" as const } };
  });

  // -------------------------------------------------------------------------
  // POST /:configId/review/request-changes — staff asks for revisions
  // -------------------------------------------------------------------------

  server.post("/:configId/review/request-changes", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const body = RequiredNoteBody.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "A changes-requested note is required",
        code: "VALIDATION_ERROR",
        details: body.error.issues,
      });
    }

    const config = await loadConfig(db, params.data.configId);
    if (config === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    if (!canTransition(config.reviewStatus, "changes_requested", request.user.role)) {
      return reply.status(409).send({
        error: `Cannot request changes from state '${config.reviewStatus}'`,
        code: "INVALID_TRANSITION",
        currentStatus: config.reviewStatus,
      });
    }

    await executeTransition({
      db,
      config,
      toStatus: "changes_requested",
      changedBy: request.user.id,
      note: body.data.note,
    });

    // Notify planner with the list of requested changes.
    const baseFeUrl = frontendUrl ?? `${request.protocol}://${request.hostname}`;
    const ctx = await loadReviewEmailContext(db, config, request.user);
    const latest = await getLatestSnapshot(db, config.id);
    const snapshotVersion = latest?.version ?? 1;
    if (ctx.planner !== null) {
      fireEmail(
        db,
        request.log,
        ctx.planner.email,
        `config-changes-requested:${config.id}:v${String(snapshotVersion)}:${ctx.planner.id}`,
        configChangesRequested({
          eventName: config.name,
          venueName: ctx.venueName,
          spaceName: ctx.spaceName,
          snapshotVersion,
          requestedByName: ctx.actor.displayName,
          editorUrl: `${baseFeUrl}/editor/${config.id}`,
          note: body.data.note,
        }),
      );
    }

    return { data: { reviewStatus: "changes_requested" as const } };
  });

  // -------------------------------------------------------------------------
  // POST /:configId/review/withdraw — planner (or staff) pulls submission
  // -------------------------------------------------------------------------

  server.post("/:configId/review/withdraw", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const body = OptionalNoteBody.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid body", code: "VALIDATION_ERROR", details: body.error.issues });
    }

    const config = await loadConfig(db, params.data.configId);
    if (config === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    if (!canTransition(config.reviewStatus, "withdrawn", request.user.role)) {
      return reply.status(409).send({
        error: `Cannot withdraw from state '${config.reviewStatus}'`,
        code: "INVALID_TRANSITION",
        currentStatus: config.reviewStatus,
      });
    }

    const note = body.data.note?.trim();
    await executeTransition({
      db,
      config,
      toStatus: "withdrawn",
      changedBy: request.user.id,
      note: note !== undefined && note.length > 0 ? note : null,
    });

    return { data: { reviewStatus: "withdrawn" as const } };
  });

  // -------------------------------------------------------------------------
  // POST /:configId/review/archive — staff closes out post-event
  // -------------------------------------------------------------------------

  server.post("/:configId/review/archive", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const config = await loadConfig(db, params.data.configId);
    if (config === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    if (!canTransition(config.reviewStatus, "archived", request.user.role)) {
      return reply.status(409).send({
        error: `Cannot archive from state '${config.reviewStatus}'`,
        code: "INVALID_TRANSITION",
        currentStatus: config.reviewStatus,
      });
    }

    await executeTransition({
      db,
      config,
      toStatus: "archived",
      changedBy: request.user.id,
      note: null,
    });

    return { data: { reviewStatus: "archived" as const } };
  });

  // -------------------------------------------------------------------------
  // GET /:configId/review/history — audit timeline (oldest-first)
  // -------------------------------------------------------------------------

  server.get("/:configId/review/history", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const config = await loadConfig(db, params.data.configId);
    if (config === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    // LEFT JOIN users — the history row may have `changed_by = NULL`
    // (system-automatic transition) or point at a user who has since
    // been deleted. Both cases produce `changedByName: null` in the
    // response. The raw UUID is NOT returned; planners could otherwise
    // enumerate staff IDs via a visible timeline.
    const rows = await db.select({
      id: configurationReviewHistory.id,
      configurationId: configurationReviewHistory.configurationId,
      fromStatus: configurationReviewHistory.fromStatus,
      toStatus: configurationReviewHistory.toStatus,
      changedByDisplayName: users.displayName,
      changedByName: users.name,
      note: configurationReviewHistory.note,
      createdAt: configurationReviewHistory.createdAt,
    })
      .from(configurationReviewHistory)
      .leftJoin(users, eq(configurationReviewHistory.changedBy, users.id))
      .where(eq(configurationReviewHistory.configurationId, config.id))
      .orderBy(asc(configurationReviewHistory.createdAt));

    return {
      data: {
        configurationId: config.id,
        entries: rows.map((r) => ({
          id: r.id,
          configurationId: r.configurationId,
          fromStatus: r.fromStatus,
          toStatus: r.toStatus,
          changedByName: r.changedByDisplayName ?? r.changedByName,
          note: r.note,
          createdAt: r.createdAt.toISOString(),
        })),
      },
    };
  });

  // -------------------------------------------------------------------------
  // GET /:configId/review/available-transitions — UI helper
  // -------------------------------------------------------------------------

  server.get("/:configId/review/available-transitions", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const config = await loadConfig(db, params.data.configId);
    if (config === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const available: ConfigurationReviewStatus[] = [];
    for (const target of CONFIGURATION_REVIEW_STATUSES) {
      if (target === config.reviewStatus) continue;
      if (canTransition(config.reviewStatus, target, request.user.role)) {
        available.push(target);
      }
    }

    return {
      data: {
        configurationId: config.id,
        currentStatus: config.reviewStatus,
        availableTransitions: available,
      },
    };
  });

  // -------------------------------------------------------------------------
  // GET /reviews/pending — venue-scoped list of reviews awaiting action
  //
  // Role-scoped results:
  //   - admin:  all pending reviews across all venues
  //   - staff:  pending reviews for their venue (submitted, under_review,
  //             changes_requested)
  //   - other:  403 — only approvers can browse the pending queue
  //
  // "pending" intentionally includes `changes_requested` because from the
  // approver's perspective, a config the planner has revised needs re-review.
  // Sorted by most-recently-submitted first so stale claims surface at the
  // top of the staff's attention.
  // -------------------------------------------------------------------------

  server.get("/reviews/pending", { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user;
    if (user.role !== "admin" && user.role !== "staff") {
      return reply.status(403).send({
        error: "Only approvers can list pending reviews",
        code: "FORBIDDEN",
      });
    }

    // Mutable array satisfies drizzle's inArray signature (which expects a
    // writable string[] rather than a readonly tuple).
    const pendingStatuses: string[] = [
      "submitted",
      "under_review",
      "changes_requested",
    ];

    const scopedRows = user.role === "admin"
      ? await db.select({
          id: configurations.id,
          name: configurations.name,
          venueId: configurations.venueId,
          spaceId: configurations.spaceId,
          userId: configurations.userId,
          reviewStatus: configurations.reviewStatus,
          submittedAt: configurations.submittedAt,
          updatedAt: configurations.updatedAt,
          guestCount: configurations.guestCount,
        })
          .from(configurations)
          .where(and(
            isNull(configurations.deletedAt),
            inArray(configurations.reviewStatus, pendingStatuses),
          ))
          .orderBy(asc(configurations.submittedAt))
      : user.venueId === null
        ? []
        : await db.select({
            id: configurations.id,
            name: configurations.name,
            venueId: configurations.venueId,
            spaceId: configurations.spaceId,
            userId: configurations.userId,
            reviewStatus: configurations.reviewStatus,
            submittedAt: configurations.submittedAt,
            updatedAt: configurations.updatedAt,
            guestCount: configurations.guestCount,
          })
            .from(configurations)
            .where(and(
              eq(configurations.venueId, user.venueId),
              isNull(configurations.deletedAt),
              inArray(configurations.reviewStatus, pendingStatuses),
            ))
            .orderBy(asc(configurations.submittedAt));

    return {
      data: {
        entries: scopedRows.map((r) => ({
          id: r.id,
          name: r.name,
          venueId: r.venueId,
          spaceId: r.spaceId,
          userId: r.userId,
          reviewStatus: r.reviewStatus as ConfigurationReviewStatus,
          submittedAt: r.submittedAt === null ? null : r.submittedAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          guestCount: r.guestCount,
        })),
      },
    };
  });

  // -------------------------------------------------------------------------
  // Presence — review-sessions heartbeat + active-viewers list
  //
  // Two staff members opening the same review should see each other so
  // they don't double-approve. Polling-based: client heartbeats every
  // ~10s while the review detail is open, and polls the viewers
  // endpoint to render the presence badge. No WebSocket — works behind
  // any HTTP proxy and survives server restarts without reconnect.
  //
  // Auth: both endpoints require the caller to pass `canAccessResource`
  // — planners can only heartbeat their own configs, staff can
  // heartbeat any config at their venue.
  // -------------------------------------------------------------------------

  server.post("/:configId/review/viewers/heartbeat", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }
    const config = await loadConfig(db, params.data.configId);
    if (config === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }
    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    await heartbeatReviewSession(db, params.data.configId, request.user.id);
    return { data: { ok: true } };
  });

  server.get("/:configId/review/viewers", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }
    const config = await loadConfig(db, params.data.configId);
    if (config === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }
    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const viewers = await listActiveReviewers(db, params.data.configId, request.user.id);
    return { data: { configurationId: params.data.configId, viewers } };
  });

  server.delete("/:configId/review/viewers/self", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }
    // Explicit leave — always safe for the caller themselves (no
    // canAccessResource needed because we only ever delete the
    // caller's own row by userId).
    await endReviewSession(db, params.data.configId, request.user.id);
    return { data: { ok: true } };
  });

  // -------------------------------------------------------------------------
  // GET /:configId/snapshot/latest — role-aware read
  // -------------------------------------------------------------------------

  server.get("/:configId/snapshot/latest", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const config = await loadConfig(db, params.data.configId);
    if (config === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const role = request.user.role;
    const isOwner = config.userId === request.user.id;

    // Drafts are the planner's private workspace. A prior submit-then-
    // withdraw cycle can leave an orphaned snapshot row, so we must
    // gate by `reviewStatus` — not just snapshot presence — to stop
    // staff at the same venue from reading stale pre-submission
    // content. Admin and the owner themselves still see drafts.
    if (
      config.reviewStatus === "draft"
      && !isOwner
      && role !== "admin"
    ) {
      return reply.status(404).send({ error: "No snapshot available", code: "SNAPSHOT_NOT_FOUND" });
    }

    const snapshot = role === "staff" || role === "admin"
      ? await getLatestSnapshot(db, config.id)
      : await getLatestApprovedSnapshot(db, config.id);

    if (snapshot === null) {
      return reply.status(404).send({ error: "No snapshot available", code: "SNAPSHOT_NOT_FOUND" });
    }

    return { data: snapshot };
  });

  // -------------------------------------------------------------------------
  // GET /:configId/snapshot/:version — historical lookup
  // -------------------------------------------------------------------------

  server.get("/:configId/snapshot/:version", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VersionParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "Invalid parameters — expected UUID configId + positive int version",
        code: "VALIDATION_ERROR",
      });
    }

    const config = await loadConfig(db, params.data.configId);
    if (config === null) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const snapshot = await getSnapshotByVersion(db, config.id, params.data.version);
    if (snapshot === null) {
      return reply.status(404).send({ error: "Snapshot version not found", code: "SNAPSHOT_NOT_FOUND" });
    }

    return { data: snapshot };
  });
}
