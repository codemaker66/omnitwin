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
import { isEmailDeliveryConfigured } from "../services/email.js";
import { removeLapsedDietaryNotes } from "../services/dietary-retention.js";
import { removeUnusedRememberedNotes } from "../services/dietary-memory.js";
import { runPageChecks } from "../services/competitor-watch-data.js";
import { createHttpsPageFetcher, type PageFetcher } from "../services/page-check.js";

// ---------------------------------------------------------------------------
// The hold-reminder workflow's identity (T-619).
//
// The reminder pass has to run unattended, and an unattended runner cannot
// hold a Clerk session. `DIARY_CRON_TOKEN` is therefore a second accepted
// identity for THAT ONE ROUTE: a shared secret, compared in constant time,
// valid only when the deployment sets it. Everything else about the route is
// unchanged — a signed-in platform administrator still reaches it the normal
// way, and when the variable is unset the scheduled path does not exist
// rather than falling open.
// ---------------------------------------------------------------------------

/** The EnvSchema floor, repeated so a deployment that skipped startup
 *  validation still fails closed here. */
const CRON_TOKEN_MIN_LENGTH = 32;

/** Constant-time equality over the raw bytes. Lengths are compared first
 *  because `timingSafeEqual` throws on a length mismatch; the length of a
 *  secret is not the secret. */
function secretEquals(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The workflow tokens, one per unattended route, so one leaked secret
 *  reaches one pass only. */
type CronTokenVariable = "DIARY_CRON_TOKEN" | "COMPETITOR_WATCH_CRON_TOKEN";

/** True when the request carries the configured workflow token. */
function hasCronToken(request: FastifyRequest, variable: CronTokenVariable = "DIARY_CRON_TOKEN"): boolean {
  const configured = process.env[variable];
  // An unset — or implausibly short — token never authenticates anything.
  if (configured === undefined || configured.length < CRON_TOKEN_MIN_LENGTH) return false;
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  return secretEquals(header.slice("Bearer ".length), configured);
}

// ---------------------------------------------------------------------------
// Error-reporting check.
//
// Proves that a production failure reaches Sentry, through the same path a
// real one takes: the handler throws, the error normaliser logs it and hands
// the raw error to the Sentry capture hook, the event is scrubbed, and the
// caller receives the ordinary 500 envelope. Run it after a deploy or a DSN
// change; a 500 here plus a SentryVerificationError issue in the venviewer-api
// project means errors are arriving. It reads and writes no data.
// ---------------------------------------------------------------------------

/** The deliberate error the check throws; its name keeps it grouped as one
 *  Sentry issue, apart from any real failure. */
export class SentryVerificationError extends Error {
  override readonly name = "SentryVerificationError";
}

// ---------------------------------------------------------------------------
// Plugin — admin-only endpoints
// ---------------------------------------------------------------------------

export async function adminRoutes(
  server: FastifyInstance,
  opts: { db: Database; pageFetcher?: PageFetcher },
): Promise<void> {
  const { db } = opts;
  const pageFetcher = opts.pageFetcher ?? createHttpsPageFetcher();

  // POST /admin/cleanup — trigger manual cleanup of stale preview configs,
  // orphaned uploads, guests' allergy notes past their retention, and
  // remembered allergy notes unused for the period the client agreed to.
  server.post("/cleanup", {
    preHandler: [authenticate, authorizePlatformAdmin()],
  }, async () => {
    const deletedConfigs = await cleanupPreviewConfigurations(db);
    const deletedFiles = await cleanupOrphanedFiles(db);
    const dietaryNotes = await removeLapsedDietaryNotes(db);
    const rememberedNotes = await removeUnusedRememberedNotes(db);
    return {
      data: {
        deletedConfigs,
        deletedFiles,
        dietaryNotes,
        rememberedNotes,
        message: `Cleaned up ${String(deletedConfigs)} stale preview configuration(s) and ${String(deletedFiles)} orphaned file(s); `
          + `removed the allergy note from ${String(dietaryNotes.layouts)} layout(s) and ${String(dietaryNotes.sheets)} event sheet(s)`
          + ` past their retention, and from ${String(dietaryNotes.actionLog)} logged change(s)`
          + `; removed ${String(rememberedNotes.removed)} remembered note(s) unused for the agreed period`,
      },
    };
  });

  // POST /admin/retention/dietary-notes — what the retention pass would
  // remove now, changing nothing. The rehearsal before a real pass.
  server.post("/retention/dietary-notes", {
    preHandler: [authenticate, authorizePlatformAdmin()],
  }, async () => {
    const layoutNotes = await removeLapsedDietaryNotes(db, { dryRun: true });
    const rememberedNotes = await removeUnusedRememberedNotes(db, { dryRun: true });
    return { data: { ...layoutNotes, rememberedNotes } };
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
    configId: z.uuid().optional(),
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
  // repeats, so the workflow can retry within a morning without double
  // sends. `dryRun: true` reports what WOULD send without sending — the
  // rehearsal Blake checks before the schedule is switched on (T-619).
  //
  // Two identities reach it (T-619): a signed-in platform administrator, or
  // the scheduled workflow presenting `DIARY_CRON_TOKEN`. The token path skips
  // Clerk entirely — there is no `request.user` to set and none is read here.
  //
  // A real pass is refused while email delivery is not configured: without
  // RESEND_API_KEY every send is recorded as "dev_mode" under the reminder's
  // idempotency key, so the pass would report success and that reminder
  // could never be sent afterwards. A dry run still reports, and says so.
  // -------------------------------------------------------------------------

  const HoldRemindersBody = z.object({
    dryRun: z.boolean().optional(),
  });

  // Two preHandlers rather than one wrapper: when `authenticate` answers 401
  // Fastify stops the lifecycle, so the second never runs. Nothing here
  // inspects `reply.sent` — a wrapper that guessed wrong would run the admin
  // check against an unset `request.user`.
  const cronAuthorised = new WeakSet<FastifyRequest>();

  const authenticateOrCron = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (hasCronToken(request)) {
      cronAuthorised.add(request);
      request.log.info({ actor: "diary-cron" }, "hold-reminder pass authorised by service token");
      return;
    }
    await authenticate(request, reply);
  };

  const platformAdminOrCron = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
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
    const dryRun = body.data.dryRun ?? false;
    const emailDelivery = isEmailDeliveryConfigured() ? "configured" : "not_configured";
    if (!dryRun && emailDelivery === "not_configured") {
      return reply.status(503).send({
        error: "Email delivery is not configured on this API (RESEND_API_KEY is unset). No reminder was sent and none was marked as sent.",
        code: "EMAIL_NOT_CONFIGURED",
      });
    }
    const summary = await runHoldReminderPass({ db, dryRun, logger: request.log });
    return { data: { ...summary, emailDelivery } };
  });

  // -------------------------------------------------------------------------
  // POST /admin/competitor-watch/page-checks — the competitor watch's
  // page-change pass for every venue: each page a person has recorded as
  // allowed (terms and robots.txt read), at most weekly, robots.txt obeyed,
  // a hash and a date kept, never a price. The same pass a venue's own
  // "Check the pages now" runs for its set (routes/competitor-watch.ts).
  //
  // Two identities, as for the hold reminders: a signed-in platform
  // administrator, or the Competitor page check workflow presenting
  // COMPETITOR_WATCH_CRON_TOKEN (its own secret, so the reminder token
  // cannot run it). The workflow's schedule stays commented out until Blake
  // approves it. The answer carries counts only: the workflow's summary is
  // public, so it never names a venue or a competitor.
  // -------------------------------------------------------------------------

  const pageCheckCron = new WeakSet<FastifyRequest>();

  const authenticateOrPageCheckCron = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (hasCronToken(request, "COMPETITOR_WATCH_CRON_TOKEN")) {
      pageCheckCron.add(request);
      request.log.info({ actor: "competitor-watch-cron" }, "page-check pass authorised by service token");
      return;
    }
    await authenticate(request, reply);
  };

  const platformAdminOrPageCheckCron = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (pageCheckCron.has(request)) return;
    await authorizePlatformAdmin()(request, reply);
  };

  server.post("/competitor-watch/page-checks", {
    preHandler: [authenticateOrPageCheckCron, platformAdminOrPageCheckCron],
  }, async (request) => {
    const scheduled = pageCheckCron.has(request);
    const run = await runPageChecks(db, {
      venueId: null,
      now: new Date(),
      fetcher: pageFetcher,
      runBy: scheduled ? "schedule" : "person",
      triggeredBy: scheduled ? null : request.user.id,
    });
    const outcomes: Record<string, number> = {};
    for (const result of run.results) outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    return { data: { checkedAt: run.checkedAt, pages: run.results.length, outcomes } };
  });

  // POST /admin/observability/sentry-check — see SentryVerificationError.
  server.post("/observability/sentry-check", {
    preHandler: [authenticate, authorizePlatformAdmin()],
  }, async () => {
    throw new SentryVerificationError(
      "Deliberate error from POST /admin/observability/sentry-check, raised to prove production errors reach Sentry.",
    );
  });
}
