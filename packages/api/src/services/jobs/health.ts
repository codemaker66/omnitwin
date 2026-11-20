import type { FastifyInstance } from "fastify";
import { installedJobWorker } from "./wake.js";
import type { JobWorkerStatus } from "./worker.js";

// ---------------------------------------------------------------------------
// The job list (T-702): GET /health/worker, the check from outside.
//
// A list that has stopped cannot report itself, so this route says, from the
// worker's memory alone, whether it is alive, when it last finished a pass and
// whether it is stuck in a handler. It never touches the database: a probe
// that woke the database every minute would keep a scale-to-zero database
// awake. The rule is a pure function of a status and a clock.
// ---------------------------------------------------------------------------

/** A wake this late, with no pass running, means the timer never fired: the worker is not running. */
const OVERDUE_WAKE_MS = 120_000;
/** No handler may take longer than 15 seconds, so one running for a minute is stuck. */
const STUCK_HANDLER_MS = 60_000;

export type WorkerHealthBody = JobWorkerStatus | { readonly worker: "off" };

export interface WorkerHealth {
  readonly statusCode: 200 | 503;
  readonly body: WorkerHealthBody;
}

/**
 * 200 `{ worker: "off" }` with no worker installed; 503 with the status when
 * the worker has a fault, when its next wake passed more than two minutes ago
 * and no pass is running, or when its current job began more than 60 seconds
 * ago; otherwise 200 with the status.
 */
export function workerHealth(status: JobWorkerStatus | null, nowMs: number): WorkerHealth {
  if (status === null) return { statusCode: 200, body: { worker: "off" } };
  const overdue = !status.passRunning && status.nextWakeAt !== null && nowMs - status.nextWakeAt > OVERDUE_WAKE_MS;
  const stuck = status.currentJob !== null && nowMs - status.currentJob.since > STUCK_HANDLER_MS;
  const unwell = status.fault !== null || overdue || stuck;
  return { statusCode: unwell ? 503 : 200, body: status };
}

/** Registers GET /health/worker. By default it reads the installed worker and this server's clock. */
export function registerJobWorkerHealth(
  server: FastifyInstance,
  source: { readonly read: () => JobWorkerStatus | null; readonly now: () => number } = {
    read: () => installedJobWorker()?.status() ?? null,
    now: Date.now,
  },
): void {
  server.get("/health/worker", async (_request, reply): Promise<WorkerHealthBody> => {
    const { statusCode, body } = workerHealth(source.read(), source.now());
    reply.code(statusCode);
    return body;
  });
}
