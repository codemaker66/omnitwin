import { z } from "zod";

// ---------------------------------------------------------------------------
// The job list (T-702): Stuck work, the platform administrator's page.
//
// A job that ran out of tries is `dead`. A platform administrator sees every
// dead job here, with the reason the server gave, and either puts it back on
// the list ("Try again") or closes it with a note ("Close"). Nothing here
// carries a job's payload: a job holds ids, and a person's name or address
// never leaves the table that owns it.
// ---------------------------------------------------------------------------

/** The most dead jobs Stuck work lists, newest first. */
export const STUCK_JOBS_LIMIT = 200;

/** The five states of a job, and no others. */
export const JobStateSchema = z.enum(["queued", "running", "done", "dead", "abandoned"]);

/** One dead job, as the page shows it. */
export const StuckJobSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  venueId: z.uuid().nullable(),
  venueName: z.string().nullable(),
  attempts: z.number().int(),
  lostClaims: z.number().int(),
  /** The error text the server stored when the job ran out of tries. */
  reason: z.string().nullable(),
  /** When the job was last due. */
  dueAt: z.iso.datetime(),
  /** When the list gave up on it. */
  gaveUpAt: z.iso.datetime(),
});

/** What one server's worker reports about itself (GET /health/worker, and Stuck work). */
export const JobWorkerStatusSchema = z.object({
  started: z.boolean(),
  /** Epoch ms of the last pass that finished. */
  lastPassAt: z.number().nullable(),
  nextWakeAt: z.number().nullable(),
  currentJob: z.object({ id: z.uuid(), kind: z.string(), since: z.number() }).nullable(),
  abandonedHandlers: z.number().int(),
  fault: z.enum(["database", "loop"]).nullable(),
  /** A pass is running, or has been asked for and begins at once. */
  passRunning: z.boolean(),
});

export const StuckWorkSchema = z.object({
  /** The newest STUCK_JOBS_LIMIT dead jobs, newest first. */
  jobs: z.array(StuckJobSchema).max(STUCK_JOBS_LIMIT),
  counts: z.object({
    /** Jobs that are queued and due now; a job waiting for a later time is not counted. */
    queued: z.number().int(),
    running: z.number().int(),
    dead: z.number().int(),
    /** Sends still `pending` more than a day after they were written. */
    oldPendingSends: z.number().int(),
  }),
  worker: z.union([z.object({ worker: z.literal("off") }), JobWorkerStatusSchema]),
  /**
   * The answering server's clock, epoch ms, when it answered: the clock the worker's `lastPassAt` is on, so the
   * page counts how long ago the worker ran from this and never from the browser's own clock.
   */
  serverNowMs: z.number().int().positive(),
});

/** The note a person leaves when they close a dead job: 1 to 500 characters, no U+0000 (PostgreSQL text cannot hold it). */
export const CloseStuckJobSchema = z.object({
  note: z.string().trim().min(1).max(500).refine((note) => !note.includes("\u0000"), "The note holds a character that cannot be stored"),
});

/** The answer to Try again and Close: the job's id. */
export const StuckJobActionSchema = z.object({ id: z.uuid() });

/** The self-test's answer: its job's id, and the state the job had reached when the server stopped waiting. */
export const SelfTestResultSchema = z.object({ id: z.uuid(), state: JobStateSchema });

export type JobState = z.infer<typeof JobStateSchema>;
export type SelfTestResult = z.infer<typeof SelfTestResultSchema>;
export type StuckJob = z.infer<typeof StuckJobSchema>;
export type JobWorkerStatus = z.infer<typeof JobWorkerStatusSchema>;
export type StuckWork = z.infer<typeof StuckWorkSchema>;
export type CloseStuckJob = z.infer<typeof CloseStuckJobSchema>;
export type StuckJobAction = z.infer<typeof StuckJobActionSchema>;
