import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { CloseStuckJobSchema, type JobState, type SelfTestResult, type StuckJobAction, type StuckWork } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate, authorizePlatformAdmin } from "../middleware/auth.js";
import type { JobRegistry } from "../services/jobs/kinds.js";
import { selfTestJob } from "../services/jobs/kinds/selftest.js";
import { abandonDeadJob, enqueueJob, JobRetryPreparationError, listStuckWork, readJobState, retryDeadJob } from "../services/jobs/store.js";
import { installedJobWorker, pokeJobWorker } from "../services/jobs/wake.js";

// ---------------------------------------------------------------------------
// Stuck work (T-702): the platform administrator's view of the job list.
//
// GET  /admin/jobs/stuck        the newest dead jobs (at most STUCK_JOBS_LIMIT), the counts, the worker
// POST /admin/jobs/:id/retry    Try again: a dead job back on the list, due now
// POST /admin/jobs/:id/close    Close: a dead job put down, with a note
// POST /admin/jobs/selftest     one harmless job, to see the list carry work;
//                               the answer says what became of it
//
// Every route is for platform administrators only. A response carries the
// fields of `StuckJobSchema` and nothing else: never a job's payload, and no
// person's name or address.
// ---------------------------------------------------------------------------

/**
 * How long the self-test waits for its job when a worker runs in this process:
 * one read after each gap, 5 seconds in all. A bounded wait inside one
 * administrator's request, not the worker polling.
 */
const SELF_TEST_WAIT_MS: readonly number[] = [100, 200, 400, 800, 1500, 2000];

/**
 * A state that waiting longer will not change: done and abandoned are never left, and dead is left only by a
 * person's hand.
 */
function isFinished(state: JobState): boolean {
  return state === "done" || state === "dead" || state === "abandoned";
}

const JobIdParams = z.object({ id: z.uuid() });

const NOT_STUCK = {
  error: "This job is already back on the list.",
  code: "JOB_NOT_STUCK",
} as const;

const NOT_FOUND = {
  error: "There is no such job.",
  code: "JOB_NOT_FOUND",
} as const;

const PREPARATION_FAILED = {
  error: "This job could not be made ready for another try. It is still stuck.",
  code: "JOB_RETRY_PREPARATION_FAILED",
} as const;

const KIND_UNREADABLE = {
  error: "This server can no longer run this kind of job. Close it with a note.",
  code: "JOB_KIND_UNREADABLE",
} as const;

function invalid(reply: FastifyReply, error: z.ZodError, what: string): FastifyReply {
  return reply.status(400).send({ error: what, code: "VALIDATION_ERROR", details: error.issues });
}

export async function adminJobsRoutes(
  server: FastifyInstance,
  opts: { db: Database; registry: JobRegistry; selfTestWaitMs?: readonly number[] },
): Promise<void> {
  const { db, registry } = opts;
  const selfTestWaitMs = opts.selfTestWaitMs ?? SELF_TEST_WAIT_MS;
  const preHandler = [authenticate, authorizePlatformAdmin()];

  server.get("/stuck", { preHandler }, async (): Promise<{ data: StuckWork }> => {
    const listed = await listStuckWork(db);
    // The same two shapes as GET /health/worker: its status, or "off" when no worker runs here.
    const worker = installedJobWorker()?.status() ?? { worker: "off" as const };
    return { data: { ...listed, worker } };
  });

  server.post("/selftest", { preHandler }, async (request): Promise<{ data: SelfTestResult }> => {
    const { id } = await db.transaction((tx) =>
      enqueueJob(tx, selfTestJob, { key: `manual:${randomUUID()}`, payload: { nonce: randomUUID() } }));
    // After the commit: a poke inside the transaction could wake the worker before the job is visible.
    pokeJobWorker();

    // With no worker in this process nothing here will run the job: read once and say so (another server's worker may already have taken it).
    // With one, wait for it, bounded: a read after each gap, stopping at the first state the job does not leave by itself.
    // `request.raw.destroyed` is true as soon as the request body has been read, so the caller leaving is read from the socket.
    let state: JobState | null = null;
    if (installedJobWorker() !== null) {
      for (const gap of selfTestWaitMs) {
        if (request.socket.destroyed) break;
        await new Promise<void>((resolve) => { setTimeout(resolve, gap); });
        state = await readJobState(db, id);
        if (state !== null && isFinished(state)) break;
      }
    }
    state ??= await readJobState(db, id);
    if (state === null) throw new Error("the self-test job disappeared");
    return { data: { id, state } };
  });

  server.post("/:id/retry", { preHandler }, async (request, reply) => {
    const params = JobIdParams.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error, "Invalid job id");
    let outcome: Awaited<ReturnType<typeof retryDeadJob>>;
    try {
      outcome = await retryDeadJob(db, registry, params.data.id, request.user.id);
    } catch (error) {
      // Only the kind's own preparation is answered here (the job stays dead,
      // its row rolled back with it). Any other error, the database's
      // included, keeps the server's normal error path. What is logged is the
      // kind, the job and its venue and text that went through jobErrorText.
      if (!(error instanceof JobRetryPreparationError)) throw error;
      request.log.error(
        { kind: error.kind, jobId: error.jobId, venueId: error.venueId, reason: error.message },
        "A job's own preparation for Try again failed",
      );
      return reply.status(500).send(PREPARATION_FAILED);
    }
    if (outcome === "not-found") return reply.status(404).send(NOT_FOUND);
    if (outcome === "not-dead") return reply.status(409).send(NOT_STUCK);
    if (outcome === "unreadable") return reply.status(409).send(KIND_UNREADABLE);
    pokeJobWorker();
    const data: StuckJobAction = { id: params.data.id };
    return { data };
  });

  server.post("/:id/close", { preHandler }, async (request, reply) => {
    const params = JobIdParams.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error, "Invalid job id");
    const body = CloseStuckJobSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error, "Invalid body");
    const closed = await abandonDeadJob(db, params.data.id, request.user.id, body.data.note);
    if (closed === "not-found") return reply.status(404).send(NOT_FOUND);
    if (closed === "not-dead") return reply.status(409).send(NOT_STUCK);
    const data: StuckJobAction = { id: params.data.id };
    return { data };
  });
}
