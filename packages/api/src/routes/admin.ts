import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { authenticate, authorizePlatformAdmin } from "../middleware/auth.js";
import { cleanupPreviewConfigurations, cleanupOrphanedFiles } from "../services/cleanup.js";
import {
  DEFAULT_SNAPSHOT_RETENTION,
  pruneArchivedConfigSnapshots,
  pruneSnapshotsForConfig,
} from "../services/sheet-snapshot.js";
import { runHoldReminderPass } from "../services/hold-reminders.js";

// ---------------------------------------------------------------------------
// The hold-reminder cron's identity (T-619).
//
// The reminder pass has to run unattended, and an unattended runner cannot
// hold a Clerk session. `DIARY_CRON_TOKEN` is therefore a second accepted
// identity for THAT ONE ROUTE: a shared secret, compared in constant time,
// valid only when the deployment sets it. Everything else about the route
// is unchanged — a human platform administrator still reaches it the
// normal way, and when the variable is unset the scheduled path simply
// does not exist rather than falling open.
// ---------------------------------------------------------------------------

/** Constant-time equality over the raw bytes. Lengths are compared first
 *  because `timingSafeEqual` throws on a length mismatch; the length of a
 *  secret is not the secret. */
function secretEquals(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** True when the request carries the configured cron service token. */
function hasCronToken(request: FastifyRequest): boolean {
  const configured = process.env["DIARY_CRON_TOKEN"];
  // An unset — or implausibly short — token must never authenticate
  // anything. This mirrors the EnvSchema floor so a deployment that skipped
  // startup validation still fails closed here.
  if (configured === undefined || configured.length < 32) return false;
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  return secretEquals(header.slice(7), configured);
}

// ---------------------------------------------------------------------------
// Plugin — admin-only endpoints
// ---------------------------------------------------------------------------

export async function adminRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // POST /admin/cleanup — trigger manual cleanup of stale preview configs
  server.post("/cleanup", {
    preHandler: [authenticate, authorizePlatformAdmin()],
  }, async () => {
    const deletedConfigs = await cleanupPreviewConfigurations(db);
    const deletedFiles = await cleanupOrphanedFiles(db);
    return {
      data: {
        deletedConfigs,
        deletedFiles,
        message: `Cleaned up ${String(deletedConfigs)} stale preview configuration(s) and ${String(deletedFiles)} orphaned file(s)`,
      },
    };
  });

  // -------------------------------------------------------------------------
  // POST /admin/prune-snapshots — retention for `configuration_sheet_snapshots`
  //
  // Two modes:
  //   - body.configId absent   → prune across EVERY archived config
  //   - body.configId present  → prune just that config (admin override
  //                               for an explicit ask)
  //
  // Non-archived configs are never touched by the global-mode path;
  // see the `pruneArchivedConfigSnapshots` comment for rationale.
  // Retention count defaults to 3 (see `DEFAULT_SNAPSHOT_RETENTION`);
  // operators can override via body.keep.
  //
  // Idempotent: re-running produces deleted=0 on the second pass.
  // -------------------------------------------------------------------------

  const PruneBody = z.object({
    configId: z.string().uuid().optional(),
    keep: z.number().int().min(1).max(100).optional(),
  });

  server.post("/prune-snapshots", {
    preHandler: [authenticate, authorizePlatformAdmin()],
  }, async (request, reply) => {
    const body = PruneBody.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid body",
        code: "VALIDATION_ERROR",
        details: body.error.issues,
      });
    }
    const keep = body.data.keep ?? DEFAULT_SNAPSHOT_RETENTION;
    const result = body.data.configId !== undefined
      ? await pruneSnapshotsForConfig(db, body.data.configId, keep)
      : await pruneArchivedConfigSnapshots(db, keep);
    return {
      data: {
        scope: body.data.configId !== undefined ? "single-config" : "all-archived",
        configId: body.data.configId ?? null,
        keep,
        deleted: result.deleted,
        kept: result.kept,
      },
    };
  });

  // -------------------------------------------------------------------------
  // POST /admin/diary/hold-reminders — run the T-7/3/1 hold-reminder
  // delivery pass (T-527). Idempotent: `email_sends` unique keys dedupe
  // repeats, so an external cron can invoke this hourly without double
  // sends. `dryRun: true` reports what WOULD send without sending —
  // the rehearsal path (first-live-week runbook §reminders).
  //
  // Two identities reach it (T-619): a signed-in platform administrator, or
  // the scheduled runner presenting `DIARY_CRON_TOKEN`. The token path skips
  // Clerk entirely — there is no `request.user` to set and none is read here.
  // -------------------------------------------------------------------------

  const HoldRemindersBody = z.object({
    dryRun: z.boolean().optional(),
  });

  // Two preHandlers rather than one wrapper: when `authenticate` answers 401
  // Fastify stops the lifecycle, so the second never runs. Nothing here
  // inspects `reply.sent` — Fastify 5 removed it, and a wrapper that guessed
  // wrong would run the admin check against an unset `request.user`.
  const cronAuthorised = new WeakSet<FastifyRequest>();

  const authenticateOrCron = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    if (hasCronToken(request)) {
      cronAuthorised.add(request);
      request.log.info({ actor: "diary-cron" }, "hold-reminder pass authorised by service token");
      return;
    }
    await authenticate(request, reply);
  };

  const platformAdminOrCron = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    if (cronAuthorised.has(request)) return;
    await authorizePlatformAdmin()(request, reply);
  };

  server.post("/diary/hold-reminders", {
    preHandler: [authenticateOrCron, platformAdminOrCron],
  }, async (request, reply) => {
    const body = HoldRemindersBody.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid body",
        code: "VALIDATION_ERROR",
        details: body.error.issues,
      });
    }
    const summary = await runHoldReminderPass({
      db,
      dryRun: body.data.dryRun ?? false,
      logger: request.log,
    });
    return { data: summary };
  });
}
