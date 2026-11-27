import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../../db/client.js";
import type { Env } from "../../env.js";
import { buildJobAlerts, buildOwnScope, logJobAlerts, type JobAlerts } from "./alerts.js";
import { dailyJob } from "./kinds/daily.js";
import { selfTestJob } from "./kinds/selftest.js";
import { buildJobRegistry, jobErrorText, type JobKind, type JobLogger, type JobRegistry } from "./kinds.js";
import { nextRunsKeeper, type RepeatingJob } from "./repeating.js";
import { installedJobWorker, installJobWorker } from "./wake.js";
import { JobWorker } from "./worker.js";

// ---------------------------------------------------------------------------
// The job list (T-702) inside the API.
//
// `buildJobKinds` is the one place a kind is added. `startJobs` is called once
// by the server after its database connection is made: it always builds the
// registry (the admin routes read it), and only with JOBS_WORKER=on does it
// make a worker, install it for `pokeJobWorker` and the health route, and
// start it. With the switch off or unset (the default) it sends no statement,
// sets no timer, imports nothing and installs nothing.
// ---------------------------------------------------------------------------

/** Every kind this build knows, and which of them repeat. The one place a new kind is added. */
export function buildJobKinds(alerts: JobAlerts): { readonly kinds: readonly JobKind<unknown>[]; readonly repeating: readonly RepeatingJob[] } {
  let registry: JobRegistry | null = null;
  const daily = dailyJob({ registry: () => (registry ??= buildJobRegistry(kinds)), alerts });
  const repeating: readonly RepeatingJob[] = [daily];
  const kinds: readonly JobKind<unknown>[] = [selfTestJob, ...repeating.map((job) => job.kind)];
  return { kinds, repeating };
}

/** The server's logger as the list's: the same three levels, bound to it. */
export function jobLoggerFrom(log: Pick<FastifyBaseLogger, "info" | "warn" | "error">): JobLogger {
  return {
    info: (obj, msg) => { log.info(obj, msg); },
    warn: (obj, msg) => { log.warn(obj, msg); },
    error: (obj, msg) => { log.error(obj, msg); },
  };
}

/** Names this process on the claims it takes. Only for reading a row: the claim's token decides who holds it. */
function serverIdentity(): string {
  return `${hostname()}:${String(process.pid)}:${randomUUID().slice(0, 8)}`;
}

/**
 * Builds the registry; with JOBS_WORKER on, starts a worker (sleepMinutes from
 * JOBS_MAX_SLEEP_MINUTES, afterPass from nextRunsKeeper, and with SENTRY_DSN
 * set a scope of its own for each pass and job run) and installs it.
 * With it off, installs nothing.
 *
 * `stop` takes nothing new, waits up to `graceMs` for the running job, hands
 * back what is unfinished, and then uninstalls the worker. Every call is the
 * same stop, and it never rejects: a failure is logged once at error level.
 * With no worker it does nothing.
 */
export async function startJobs(deps: { readonly db: Database; readonly env: Env; readonly logger: JobLogger }): Promise<{
  readonly worker: JobWorker | null;
  readonly registry: JobRegistry;
  readonly stop: (graceMs: number) => Promise<void>;
}> {
  const { db, env, logger } = deps;
  if (env.JOBS_WORKER !== "on") {
    // Nothing runs, so nothing alerts: the log reporter keeps the Sentry SDK unimported.
    const { kinds } = buildJobKinds(logJobAlerts(logger));
    return { worker: null, registry: buildJobRegistry(kinds), stop: () => Promise.resolve() };
  }

  const alerts = await buildJobAlerts(env, logger);
  // With Sentry on, each pass and each job's run gets a scope and trace of its own; without it, nothing is passed.
  const withOwnScope = await buildOwnScope(env);
  const { kinds, repeating } = buildJobKinds(alerts);
  const registry = buildJobRegistry(kinds);
  const worker = new JobWorker({
    db,
    registry,
    serverId: serverIdentity(),
    logger,
    alerts,
    // Only when set: unset, the worker's own default (60) is the one default.
    ...(env.JOBS_MAX_SLEEP_MINUTES === undefined ? {} : { sleepMinutes: env.JOBS_MAX_SLEEP_MINUTES }),
    afterPass: nextRunsKeeper(repeating, logger, alerts),
    ...(withOwnScope === undefined ? {} : { withOwnScope }),
  });
  installJobWorker(worker);
  worker.start();

  const uninstall = (): void => {
    if (installedJobWorker() === worker) installJobWorker(null);
  };
  let stopped: Promise<void> | null = null;
  // Never rejects: the server begins it in preClose without waiting, and the
  // API has no handler for a stray rejection, which would end the process.
  const stop = (graceMs: number): Promise<void> => {
    stopped ??= Promise.resolve()
      .then(() => worker.stop(graceMs))
      .then(uninstall, (error: unknown) => {
        uninstall();
        try {
          logger.error({ error: jobErrorText(error) }, "the job worker did not stop cleanly");
        } catch {
          // A logger that throws must not turn a finished stop into a rejection.
        }
      });
    return stopped;
  };
  return { worker, registry, stop };
}
