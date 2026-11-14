import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { jobs } from "../../db/schema.js";
import type { JobExecutor, JobKind } from "./kinds.js";

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
