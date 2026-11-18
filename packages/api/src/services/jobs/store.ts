import { JobStateSchema, STUCK_JOBS_LIMIT, type JobState, type StuckWork } from "@omnitwin/types";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { z, ZodError } from "zod";
import type { Database } from "../../db/client.js";
import { jobs } from "../../db/schema.js";
import { jobErrorText, type JobExecutor, type JobKind, type JobRegistry } from "./kinds.js";

// ---------------------------------------------------------------------------
// The job list (T-702): writing a job.
//
// `enqueueJob` runs in the caller's own transaction, so the job exists exactly
// when the caller's change does. Every refusal is decided here, before any
// statement, because a failed statement would abort the caller's transaction
// and with it the caller's own work.
// ---------------------------------------------------------------------------

/** The data given does not fit the kind. The message names kinds and fields, never values. */
export class JobInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobInputError";
  }
}

export interface EnqueueInput<P> {
  readonly key: string;
  readonly venueId?: string | null;
  /** Default: the database's now(). */
  readonly runAt?: Date;
  readonly payload: P;
}

/** `jobs_key_length`. */
const MAX_KEY_CHARACTERS = 300;
/** `jobs_payload_small`: the size of the payload as the database prints it. */
const MAX_PAYLOAD_BYTES = 2048;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** A conflict can only vanish from view if the row it hit is deleted between the two statements. */
const MAX_READS_AFTER_CONFLICT = 3;

/**
 * Text PostgreSQL can store: no U+0000 (`text` and jsonb cannot hold it) and
 * no half of a surrogate pair (it has no UTF-8 form, so jsonb refuses it).
 */
function isStorableText(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit === 0) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * The text PostgreSQL prints for a jsonb value: JSON with a space after every
 * `:` and `,`. `jobs_payload_small` measures that text, so a payload that fits
 * as `JSON.stringify` can still be over the limit in the table. A string or an
 * object key it cannot store, and a number it prints differently from
 * JavaScript (jsonb never uses an exponent: `1e300` is 301 digits there and 6
 * characters here), is `undefined`: the payload is refused, not measured.
 */
function jsonbText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return isStorableText(value) ? JSON.stringify(value) : undefined;
  }
  if (typeof value === "number") {
    const text = JSON.stringify(value);
    return text.includes("e") ? undefined : text;
  }
  if (Array.isArray(value)) {
    const items = value.map((item: unknown) => jsonbText(item));
    return items.every((item) => item !== undefined) ? `[${items.join(", ")}]` : undefined;
  }
  if (value !== null && typeof value === "object") {
    const members: string[] = [];
    for (const [name, member] of Object.entries(value)) {
      const text = jsonbText(member);
      if (!isStorableText(name) || text === undefined) return undefined;
      members.push(`${JSON.stringify(name)}: ${text}`);
    }
    return `{${members.join(", ")}}`;
  }
  return JSON.stringify(value);
}

function describeIssues(error: ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return `${path === "" ? "(payload)" : path}: ${issue.code}`;
  });
  return issues.join("; ");
}

/** The payload as the kind parsed it, as plain JSON data, no larger than the table allows. */
function checkedPayload<P>(kind: JobKind<P>, payload: P): Record<string, unknown> {
  let parsed: P;
  try {
    parsed = kind.parse(payload);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new JobInputError(`The payload does not fit job kind "${kind.kind}" (${describeIssues(error)})`);
    }
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(JSON.stringify(parsed));
  } catch {
    throw new JobInputError(`The payload of job kind "${kind.kind}" is not plain data`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new JobInputError(`The payload of job kind "${kind.kind}" must be an object`);
  }
  const printed = jsonbText(data);
  if (printed === undefined) {
    throw new JobInputError(`The payload of job kind "${kind.kind}" holds text or a number the table cannot store as written`);
  }
  if (Buffer.byteLength(printed, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new JobInputError(`The payload of job kind "${kind.kind}" is over ${String(MAX_PAYLOAD_BYTES)} bytes`);
  }
  return data as Record<string, unknown>;
}

/**
 * Writes the job in the caller's transaction. A second write of the same kind
 * and key changes nothing and says `created: false` with the first one's id.
 *
 * The write is `INSERT ... ON CONFLICT DO NOTHING`, never a caught unique
 * violation: an error inside the caller's transaction would abort the
 * caller's own work. For the same reason every input the table would reject is
 * refused here, before any statement, with `JobInputError`: a key or payload
 * text holding U+0000 or half a surrogate pair, a payload number jsonb prints
 * differently from JavaScript (an exponent), and a payload over its size.
 *
 * One refusal cannot be made without a query: a venue id that has the shape of
 * an id but names no venue fails the table's foreign key and aborts the
 * caller's transaction. A caller must pass a venue it has read in that same
 * transaction (or one it holds a row for), never an id taken on trust.
 */
export async function enqueueJob<P>(
  tx: JobExecutor,
  kind: JobKind<P>,
  input: EnqueueInput<P>,
): Promise<{ readonly id: string; readonly created: boolean }> {
  if (!isStorableText(input.key)) {
    throw new JobInputError(`The key of job kind "${kind.kind}" holds text the table cannot store`);
  }
  const keyLength = Array.from(input.key).length;
  if (keyLength < 1 || keyLength > MAX_KEY_CHARACTERS) {
    throw new JobInputError(`The key of job kind "${kind.kind}" must be 1 to ${String(MAX_KEY_CHARACTERS)} characters`);
  }
  const venueId = input.venueId ?? null;
  if (kind.scope === "venue" && venueId === null) {
    throw new JobInputError(`Job kind "${kind.kind}" belongs to a venue and needs a venue id`);
  }
  if (kind.scope === "platform" && venueId !== null) {
    throw new JobInputError(`Job kind "${kind.kind}" belongs to the platform and takes no venue id`);
  }
  if (venueId !== null && !UUID_SHAPE.test(venueId)) {
    throw new JobInputError(`The venue id of job kind "${kind.kind}" is not an id`);
  }
  if (input.runAt !== undefined && Number.isNaN(input.runAt.getTime())) {
    throw new JobInputError(`The run time of job kind "${kind.kind}" is not a date`);
  }
  const payload = checkedPayload(kind, input.payload);

  for (let read = 0; read < MAX_READS_AFTER_CONFLICT; read += 1) {
    const [inserted] = await tx
      .insert(jobs)
      .values({
        kind: kind.kind,
        version: kind.version,
        key: input.key,
        scope: kind.scope,
        venueId,
        payload,
        maxAttempts: kind.maxAttempts,
        ...(input.runAt === undefined ? {} : { runAt: input.runAt }),
      })
      .onConflictDoNothing({ target: [jobs.kind, jobs.key] })
      .returning({ id: jobs.id });
    if (inserted !== undefined) return { id: inserted.id, created: true };

    const [existing] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.kind, kind.kind), eq(jobs.key, input.key)));
    if (existing !== undefined) return { id: existing.id, created: false };
  }
  throw new Error(`The job of kind "${kind.kind}" could not be written or found`);
}

// ---------------------------------------------------------------------------
// Taking, finishing, failing and recovering a job.
//
// Each function below is ONE statement: production reaches the database
// through a transaction-mode pooler, where a statement is its own transaction
// and no session state survives it, so a row lock taken here is released when
// the statement ends (or, for `finishJob` given a handler's transaction, when
// that commits). The database's clock decides what is due and whose claim has
// run out; nothing here reads the server's clock.
//
// A running row holds a claim (token, server, expiry) and no other row holds
// one (`jobs_claim`), so every statement that ends a run clears all three in
// the same statement. Finishing, failing and handing back each name the
// claim's token and `state = 'running'`: once a recovery has put the claim
// back (and cleared its token), a late report from the old claim matches no
// row and says so, and a recovery that meets a report holding the row waits
// for it and then finds no expired claim to put back. Under READ COMMITTED a
// statement that waits on a row re-reads it before it writes, and re-checks
// its whole WHERE clause against what the other one committed, so exactly
// one of two racing statements changes the row.
// ---------------------------------------------------------------------------

/** The waits after the 1st to 5th failed try; a later try waits as long as the 5th. */
export const RETRY_SECONDS = [60, 300, 1800, 7200, 21600] as const;
/** How long a job waits after its first lost claim before it is due again. */
export const LOST_CLAIM_PAUSE_SECONDS = 300;
/** Added to a kind's time limit to make its claim. */
export const CLAIM_MARGIN_SECONDS = 15;

export interface ClaimedJob {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly venueId: string | null;
  readonly payload: unknown;
  readonly attempts: number;
  readonly claimToken: string;
}

export interface RecoveredJob {
  readonly id: string;
  readonly kind: string;
  readonly venueId: string | null;
  readonly state: "queued" | "dead";
  readonly lostClaims: number;
}

export type FailOutcome = "queued" | "dead" | "lost";

const claimedRow = z.object({
  id: z.string(),
  kind: z.string(),
  version: z.number().int(),
  venue_id: z.string().nullable(),
  payload: z.unknown(),
  attempts: z.number().int(),
  claim_token: z.string(),
});

const recoveredRow = z.object({
  id: z.string(),
  kind: z.string(),
  venue_id: z.string().nullable(),
  state: z.enum(["queued", "dead"]),
  lost_claims: z.number().int(),
});

const failedRow = z.object({ state: z.enum(["queued", "dead"]) });

const planRow = z.object({
  due_in_seconds: z.number().nullable(),
  boundary_in_seconds: z.number(),
  now_ms: z.number(),
});

/** A wait given in seconds: a finite number from 0. Refused before any statement otherwise. */
function assertSeconds(seconds: number, name: string): void {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`${name} must be a finite number of seconds from 0`);
  }
}

/**
 * The rows of `known(kind, version, lease_seconds)`: one for each kind in the
 * registry and each version it reads, with its claim's length, the kind's
 * time limit in whole seconds plus the margin. Every value is a bound
 * parameter. `null` for an empty registry, which reads nothing: `VALUES` with
 * no rows is not a statement PostgreSQL accepts.
 */
function knownJobs(registry: JobRegistry): SQL | null {
  const rows: SQL[] = [];
  // Keyed by the registry's own key: the worker finds a claimed job's kind with `registry.get(job.kind)`.
  for (const [kind, definition] of registry) {
    const leaseSeconds = Math.ceil(definition.timeoutMs / 1000) + CLAIM_MARGIN_SECONDS;
    for (const version of new Set(definition.reads)) {
      rows.push(sql`(${kind}::text, ${version}::integer, ${leaseSeconds}::integer)`);
    }
  }
  return rows.length === 0 ? null : sql.join(rows, sql`, `);
}

/**
 * Puts back every claim that has run out. Second lost claim, or no tries left: dead.
 *
 * Two servers recovering at once count one lost claim: the statement that
 * reaches a row second waits for the first, re-reads it, finds it no longer
 * `running` with a claim run out, and leaves it.
 */
export async function recoverLostClaims(
  db: Database,
  pauseSeconds: number = LOST_CLAIM_PAUSE_SECONDS,
): Promise<readonly RecoveredJob[]> {
  assertSeconds(pauseSeconds, "pauseSeconds");
  const result = await db.execute(sql`
    UPDATE jobs SET
      lost_claims = lost_claims + 1,
      state = CASE WHEN lost_claims + 1 >= 2 OR attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
      run_at = CASE WHEN lost_claims + 1 >= 2 OR attempts >= max_attempts THEN run_at
                    ELSE now() + make_interval(secs => ${pauseSeconds}::double precision) END,
      finished_at = CASE WHEN lost_claims + 1 >= 2 OR attempts >= max_attempts THEN now() ELSE NULL END,
      last_error = 'The server that took this job never answered.',
      claim_token = NULL, claimed_by = NULL, claim_expires_at = NULL, updated_at = now()
    WHERE state = 'running' AND claim_expires_at < now()
    RETURNING id, kind, venue_id, state, lost_claims`);
  return result.rows.map((raw) => {
    const row = recoveredRow.parse(raw);
    return { id: row.id, kind: row.kind, venueId: row.venue_id, state: row.state, lostClaims: row.lost_claims };
  });
}

/**
 * Takes the oldest due job among the kinds and versions in the registry, or null.
 *
 * `FOR UPDATE SKIP LOCKED` passes over a row another taker holds, so two
 * takers never take the same job; a row another taker has already taken and
 * committed is re-read and no longer `queued`, so it is passed over too. The
 * claim counts the try. `next` is MATERIALIZED so the locking select runs
 * exactly once, whatever plan the update is given.
 */
export async function claimNextJob(db: Database, registry: JobRegistry, serverId: string): Promise<ClaimedJob | null> {
  const known = knownJobs(registry);
  if (known === null) return null;
  const result = await db.execute(sql`
    WITH known(kind, version, lease_seconds) AS (VALUES ${known}),
    next AS MATERIALIZED (
      SELECT j.id, k.lease_seconds
      FROM jobs j JOIN known k ON k.kind = j.kind AND k.version = j.version
      WHERE j.state = 'queued' AND j.run_at <= now()
      ORDER BY j.run_at, j.id
      FOR UPDATE OF j SKIP LOCKED
      LIMIT 1
    )
    UPDATE jobs SET state = 'running', attempts = jobs.attempts + 1, claim_token = gen_random_uuid(),
      claimed_by = ${serverId}::text, claim_expires_at = now() + make_interval(secs => next.lease_seconds),
      updated_at = now()
    FROM next WHERE jobs.id = next.id
    RETURNING jobs.id, jobs.kind, jobs.version, jobs.venue_id, jobs.payload, jobs.attempts, jobs.claim_token`);
  const [raw] = result.rows;
  if (raw === undefined) return null;
  const row = claimedRow.parse(raw);
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    venueId: row.venue_id,
    payload: row.payload,
    attempts: row.attempts,
    claimToken: row.claim_token,
  };
}

/**
 * True if this claim finished it. False if the claim had gone.
 *
 * Takes the handler's own transaction (or the database): where the work only
 * changes our own database, the change and `done` commit together.
 */
export async function finishJob(executor: JobExecutor, id: string, claimToken: string): Promise<boolean> {
  const result = await executor.execute(sql`
    UPDATE jobs SET state = 'done', finished_at = now(),
      claim_token = NULL, claimed_by = NULL, claim_expires_at = NULL, updated_at = now()
    WHERE id = ${id}::uuid AND claim_token = ${claimToken}::uuid AND state = 'running'
    RETURNING id`);
  return result.rows.length === 1;
}

/**
 * Records a failed try under the claim. `queued` again after
 * `RETRY_SECONDS[attempts - 1]` (or `retryInSeconds`, when given); `dead` when
 * `permanent`, or when the try just made was the last; `lost` when the claim
 * had gone, and then nothing changes. The error's text is stored as
 * `jobErrorText` gives it, without U+0000, which `text` cannot hold.
 */
export async function failJob(
  db: Database,
  id: string,
  claimToken: string,
  error: string,
  options: { readonly permanent: boolean; readonly retryInSeconds?: number },
): Promise<FailOutcome> {
  const { permanent, retryInSeconds } = options;
  if (retryInSeconds !== undefined) assertSeconds(retryInSeconds, "retryInSeconds");
  const lastError = jobErrorText(error).replaceAll("\u0000", "");
  const dead = permanent ? sql`true` : sql`attempts >= max_attempts`;
  const waits = sql.join(RETRY_SECONDS.map((seconds) => sql`${seconds}::integer`), sql`, `);
  const wait = retryInSeconds === undefined
    ? sql`(ARRAY[${waits}])[LEAST(GREATEST(attempts, 1), ${RETRY_SECONDS.length}::integer)]`
    : sql`${retryInSeconds}::double precision`;
  const result = await db.execute(sql`
    UPDATE jobs SET
      state = CASE WHEN ${dead} THEN 'dead' ELSE 'queued' END,
      run_at = CASE WHEN ${dead} THEN run_at ELSE now() + make_interval(secs => ${wait}) END,
      finished_at = CASE WHEN ${dead} THEN now() ELSE NULL END,
      last_error = ${lastError}::text,
      claim_token = NULL, claimed_by = NULL, claim_expires_at = NULL, updated_at = now()
    WHERE id = ${id}::uuid AND claim_token = ${claimToken}::uuid AND state = 'running'
    RETURNING state`);
  const [raw] = result.rows;
  if (raw === undefined) return "lost";
  return failedRow.parse(raw).state;
}

/** Gives the job back without counting the try. */
export async function handBackJob(db: Database, id: string, claimToken: string): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE jobs SET state = 'queued', attempts = GREATEST(attempts - 1, 0),
      claim_token = NULL, claimed_by = NULL, claim_expires_at = NULL, updated_at = now()
    WHERE id = ${id}::uuid AND claim_token = ${claimToken}::uuid AND state = 'running'
    RETURNING id`);
  return result.rows.length === 1;
}

/**
 * Seconds until the next thing this server should wake for, by the database's clock, and that clock's now.
 *
 * `dueInSeconds` is the earlier of the next due job of a kind and version this
 * registry reads and the next claim to run out among all running jobs (any
 * server's, any kind's: recovery puts back every one); 0 when that is already
 * past, `null` when there is neither. `boundaryInSeconds` is the time to the
 * next whole multiple of `sleepMinutes` since the epoch: with 60, the top of
 * the hour. Every server computes the same boundary, so they wake the database
 * together.
 */
export async function planNextWake(
  db: Database,
  registry: JobRegistry,
  sleepMinutes: number,
): Promise<{ readonly dueInSeconds: number | null; readonly boundaryInSeconds: number; readonly now: Date }> {
  if (!Number.isFinite(sleepMinutes) || sleepMinutes <= 0) {
    throw new RangeError("sleepMinutes must be a finite number above 0");
  }
  const known = knownJobs(registry);
  const nextDue = known === null
    ? sql`NULL::timestamp with time zone`
    : sql`(SELECT min(j.run_at)
        FROM jobs j JOIN (VALUES ${known}) AS known(kind, version, lease_seconds)
          ON known.kind = j.kind AND known.version = j.version
        WHERE j.state = 'queued')`;
  const result = await db.execute(sql`
    SELECT
      CASE WHEN wake.at IS NULL THEN NULL
           ELSE GREATEST(0, extract(epoch from wake.at - now())) END::double precision AS due_in_seconds,
      (ceil(extract(epoch from now()) / (${sleepMinutes}::numeric * 60)) * (${sleepMinutes}::numeric * 60)
        - extract(epoch from now()))::double precision AS boundary_in_seconds,
      (extract(epoch from now()) * 1000)::double precision AS now_ms
    FROM (SELECT LEAST(${nextDue},
      (SELECT min(claim_expires_at) FROM jobs WHERE state = 'running')) AS at) AS wake`);
  const [raw] = result.rows;
  if (raw === undefined) throw new Error("The wake plan returned no row");
  const row = planRow.parse(raw);
  // The database's own now, as a value: no clock of this server's is read.
  return { dueInSeconds: row.due_in_seconds, boundaryInSeconds: row.boundary_in_seconds, now: new Date(row.now_ms) };
}

// ---------------------------------------------------------------------------
// Stuck work: what a platform administrator sees and does about dead jobs.
//
// `retryDeadJob` and `abandonDeadJob` are each one conditional UPDATE naming
// `state = 'dead'`: of two people pressing the button at once, the statement
// that reaches the row second waits for the first, re-reads the row, finds it
// no longer dead and changes nothing. None of these read or return a payload
// except to hand it to the kind's own preparation.
// ---------------------------------------------------------------------------

/** What `retryDeadJob` records as the resolution. */
const TRIED_AGAIN = "Tried again";

const stuckRow = z.object({
  id: z.string(),
  kind: z.string(),
  venue_id: z.string().nullable(),
  venue_name: z.string().nullable(),
  attempts: z.number().int(),
  lost_claims: z.number().int(),
  reason: z.string().nullable(),
  due_ms: z.number(),
  gave_up_ms: z.number(),
});

const stuckCountsRow = z.object({
  queued: z.number().int(),
  running: z.number().int(),
  dead: z.number().int(),
  old_pending_sends: z.number().int(),
});

const retriedRow = z.object({ kind: z.string(), venue_id: z.string().nullable(), payload: z.unknown() });
const classifiedRow = z.object({ state: z.string(), readable: z.boolean() });

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * The newest 200 dead jobs, each with its venue's name (a platform job has
 * none), and the whole table's counts. The counts are one statement and the
 * list another, so a job can move between them; the page is a look, not a lock.
 *
 * Newest first by when the list gave up (`finished_at`), then by `id` so two
 * jobs that gave up at the same instant keep one order from one read to the
 * next (the id is arbitrary, not a time). A dead job's `finished_at` is always
 * set by the code that kills it; `coalesce` only keeps a hand-written row from
 * failing the page. `oldPendingSends` is a send still `pending` after a day.
 * The database's clock decides every age.
 */
export async function listStuckWork(db: Database): Promise<Omit<StuckWork, "worker">> {
  const counts = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM jobs WHERE state = 'queued')::int AS queued,
      (SELECT count(*) FROM jobs WHERE state = 'running')::int AS running,
      (SELECT count(*) FROM jobs WHERE state = 'dead')::int AS dead,
      (SELECT count(*) FROM email_sends WHERE status = 'pending' AND created_at < now() - interval '1 day')::int AS old_pending_sends`);
  const [countsRaw] = counts.rows;
  if (countsRaw === undefined) throw new Error("The stuck work counts returned no row");
  const total = stuckCountsRow.parse(countsRaw);

  const listed = await db.execute(sql`
    SELECT j.id, j.kind, j.venue_id, v.name AS venue_name, j.attempts, j.lost_claims, j.last_error AS reason,
      (extract(epoch from j.run_at) * 1000)::double precision AS due_ms,
      (extract(epoch from coalesce(j.finished_at, j.updated_at)) * 1000)::double precision AS gave_up_ms
    FROM jobs j LEFT JOIN venues v ON v.id = j.venue_id
    WHERE j.state = 'dead'
    ORDER BY j.finished_at DESC NULLS LAST, j.id DESC
    LIMIT ${STUCK_JOBS_LIMIT}`);
  return {
    jobs: listed.rows.map((raw) => {
      const row = stuckRow.parse(raw);
      return {
        id: row.id,
        kind: row.kind,
        venueId: row.venue_id,
        venueName: row.venue_name,
        attempts: row.attempts,
        lostClaims: row.lost_claims,
        reason: row.reason,
        dueAt: isoFromMs(row.due_ms),
        gaveUpAt: isoFromMs(row.gave_up_ms),
      };
    }),
    counts: { queued: total.queued, running: total.running, dead: total.dead, oldPendingSends: total.old_pending_sends },
  };
}

/**
 * Whether job `j` is of a kind and version this registry reads: the rule
 * `claimNextJob` takes a job by (it joins the same `knownJobs` rows). An empty
 * registry reads nothing.
 */
function readableBy(registry: JobRegistry): SQL {
  const known = knownJobs(registry);
  if (known === null) return sql`false`;
  return sql`EXISTS (SELECT 1 FROM (VALUES ${known}) AS known(kind, version, lease_seconds)
    WHERE known.kind = j.kind AND known.version = j.version)`;
}

export type RetryOutcome = "retried" | "not-dead" | "not-found" | "unreadable";

/**
 * A kind's own preparation for Try again failed. It names the kind, the job
 * and its venue, and carries the cause's text as `jobErrorText` gives it (no
 * query parameters, no address), never the cause itself: whatever the
 * preparation threw (a database error, a ZodError from the kind's own parse of
 * a stored payload) is one error to the caller, who logs these fields only.
 * Thrown inside the retry's transaction, so the row goes back to dead.
 */
export class JobRetryPreparationError extends Error {
  constructor(
    readonly kind: string,
    readonly jobId: string,
    readonly venueId: string | null,
    text: string,
  ) {
    super(text);
    this.name = "JobRetryPreparationError";
  }
}

/**
 * Dead back to queued, due now, tries and lost claims reset, and who did it.
 * Runs the kind's `onManualRetry` (when it has one) in the same transaction as
 * the UPDATE, and only when this call's UPDATE changed the row: if the
 * preparation throws, the transaction rolls back, the job stays dead and a
 * `JobRetryPreparationError` is thrown.
 *
 * `"not-found"`: no job has this id. `"not-dead"`: the job is not dead (another
 * person got there first). `"unreadable"`: it is dead, but no server of this release reads its
 * kind or version, so putting it back would hide it from Stuck work and no one
 * would ever take it; it stays dead, to be closed with a note.
 */
export async function retryDeadJob(db: Database, registry: JobRegistry, id: string, byUserId: string): Promise<RetryOutcome> {
  return db.transaction(async (tx) => {
    const moved = await tx.execute(sql`
      UPDATE jobs AS j SET state = 'queued', run_at = now(), attempts = 0, lost_claims = 0, finished_at = NULL,
        resolved_by = ${byUserId}::uuid, resolved_at = now(), resolution = ${TRIED_AGAIN}::text, updated_at = now()
      WHERE j.id = ${id}::uuid AND j.state = 'dead' AND ${readableBy(registry)}
      RETURNING j.kind, j.venue_id, j.payload`);
    const [movedRaw] = moved.rows;
    if (movedRaw !== undefined) {
      const row = retriedRow.parse(movedRaw);
      try {
        await registry.get(row.kind)?.onManualRetry?.(tx, row.payload);
      } catch (cause) {
        // Only the preparation is wrapped: the UPDATE's and the SELECT's own failures keep the normal path.
        throw new JobRetryPreparationError(row.kind, id, row.venue_id, jobErrorText(cause));
      }
      return "retried";
    }
    // Nothing changed: say why. Another person's UPDATE that committed while
    // this one waited has made the job queued, and that is `not-dead` too.
    const found = await tx.execute(sql`
      SELECT j.state, ${readableBy(registry)} AS readable FROM jobs j WHERE j.id = ${id}::uuid`);
    const [foundRaw] = found.rows;
    if (foundRaw === undefined) return "not-found";
    const row = classifiedRow.parse(foundRaw);
    return row.state === "dead" && !row.readable ? "unreadable" : "not-dead";
  });
}

/**
 * Dead to abandoned, with who, when and the note. `"not-dead"` if the job
 * exists and was not dead, `"not-found"` if no job has this id. Works for any
 * kind, readable or not. The note is the caller's, already trimmed and checked
 * (`CloseStuckJobSchema`).
 */
export async function abandonDeadJob(
  db: Database,
  id: string,
  byUserId: string,
  note: string,
): Promise<"closed" | "not-dead" | "not-found"> {
  const result = await db.execute(sql`
    UPDATE jobs SET state = 'abandoned', resolved_by = ${byUserId}::uuid, resolved_at = now(),
      resolution = ${note}::text, updated_at = now()
    WHERE id = ${id}::uuid AND state = 'dead'
    RETURNING id`);
  if (result.rows.length === 1) return "closed";
  // Nothing changed: one read says whether the job is there at all.
  const found = await db.execute(sql`SELECT 1 AS present FROM jobs WHERE id = ${id}::uuid`);
  return found.rows.length === 0 ? "not-found" : "not-dead";
}

const stateRow = z.object({ state: JobStateSchema });

/** The state of one job, or `null` when no job has this id. One statement; it reads nothing else of the row. */
export async function readJobState(executor: JobExecutor, id: string): Promise<JobState | null> {
  const result = await executor.execute(sql`SELECT state FROM jobs WHERE id = ${id}::uuid`);
  const [raw] = result.rows;
  return raw === undefined ? null : stateRow.parse(raw).state;
}
