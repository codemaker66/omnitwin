import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { CloseStuckJobSchema, type StuckJobAction, type StuckWork } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate, authorizePlatformAdmin } from "../middleware/auth.js";
import type { JobRegistry } from "../services/jobs/kinds.js";
import { selfTestJob } from "../services/jobs/kinds/selftest.js";
import { abandonDeadJob, enqueueJob, listStuckWork, retryDeadJob } from "../services/jobs/store.js";
import { installedJobWorker, pokeJobWorker } from "../services/jobs/wake.js";

// ---------------------------------------------------------------------------
// Stuck work (T-702): the platform administrator's view of the job list.
//
// GET  /admin/jobs/stuck        the newest 200 dead jobs, the counts, the worker
// POST /admin/jobs/:id/retry    Try again: a dead job back on the list, due now
// POST /admin/jobs/:id/close    Close: a dead job put down, with a note
// POST /admin/jobs/selftest     one harmless job, to see the list carry work
//
// Every route is for platform administrators only. A response carries the
// fields of `StuckJobSchema` and nothing else: never a job's payload, and no
// person's name or address.
// ---------------------------------------------------------------------------

const JobIdParams = z.object({ id: z.uuid() });

const NOT_STUCK = {
  error: "This job is already back on the list.",
  code: "JOB_NOT_STUCK",
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
  opts: { db: Database; registry: JobRegistry },
): Promise<void> {
  const { db, registry } = opts;
  const preHandler = [authenticate, authorizePlatformAdmin()];

  server.get("/stuck", { preHandler }, async (): Promise<{ data: StuckWork }> => {
    const listed = await listStuckWork(db);
    // The same two shapes as GET /health/worker: its status, or "off" when no worker runs here.
    const worker = installedJobWorker()?.status() ?? { worker: "off" as const };
    return { data: { ...listed, worker } };
  });

  server.post("/selftest", { preHandler }, async (): Promise<{ data: StuckJobAction }> => {
    const { id } = await db.transaction((tx) =>
      enqueueJob(tx, selfTestJob, { key: `manual:${randomUUID()}`, payload: { nonce: randomUUID() } }));
    // After the commit: a poke inside the transaction could wake the worker before the job is visible.
    pokeJobWorker();
    return { data: { id } };
  });

  server.post("/:id/retry", { preHandler }, async (request, reply) => {
    const params = JobIdParams.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error, "Invalid job id");
    // An error from the kind's own preparation is not caught: the job stays
    // dead and the server's normal error path answers 500.
    const outcome = await retryDeadJob(db, registry, params.data.id, request.user.id);
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
    if (!closed) return reply.status(409).send(NOT_STUCK);
    const data: StuckJobAction = { id: params.data.id };
    return { data };
  });
}
