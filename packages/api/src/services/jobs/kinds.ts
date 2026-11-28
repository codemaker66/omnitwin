import type { z } from "zod";
import type { Database } from "../../db/client.js";
import { scrubErrorMessage } from "../../observability/redact.js";

// ---------------------------------------------------------------------------
// The job list (T-702): how a kind of work is declared in code.
//
// A kind names a piece of work, the shape of the ids it carries, the shapes of
// those ids this code can still run, and the handler that does it. The list
// promises at least once, so every handler is safe to repeat. The registry
// (`buildJobRegistry`) is what the worker looks a job's kind up in.
// ---------------------------------------------------------------------------

export type JobScope = "venue" | "platform";

/** The transaction a caller writes a job in, or a handler completes one in. */
export type JobTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** What `enqueueJob` writes through: the database, or a caller's open transaction. */
export type JobExecutor = Database | JobTransaction;

export interface JobLogger {
  readonly info: (obj: Record<string, unknown>, msg?: string) => void;
  readonly warn: (obj: Record<string, unknown>, msg?: string) => void;
  readonly error: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface JobContext<P> {
  readonly db: Database;
  readonly jobId: string;
  readonly venueId: string | null;
  readonly payload: P;
  /** 1 for the first try. */
  readonly attempt: number;
  /**
   * Aborted when the kind's time limit passes; on a stop, only if the handler is still running when the
   * stop's grace runs out. Pass it to every outside call.
   */
  readonly signal: AbortSignal;
  readonly logger: JobLogger;
  /** Marks the job done inside the caller's transaction. Throws ClaimLostError if the claim has gone. */
  readonly completeIn: (tx: JobTransaction) => Promise<void>;
}

/** Cannot get better: the job is dead at once. */
export class PermanentJobError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

/** Try again after this many seconds instead of the usual wait. The try still counts. */
export class RetryJobIn extends Error {
  constructor(readonly seconds: number, message: string) {
    super(message);
    this.name = "RetryJobIn";
  }
}

/** The claim passed to another taker. The worker stops quietly; the handler's transaction rolls back. */
export class ClaimLostError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "ClaimLostError";
  }
}

export interface JobKind<P> {
  readonly kind: string;
  readonly version: number;
  readonly reads: readonly number[];
  readonly scope: JobScope;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly parse: (payload: unknown) => P;
  readonly run: (ctx: JobContext<unknown>) => Promise<void>;
  readonly onManualRetry?: (tx: JobTransaction, payload: unknown) => Promise<void>;
}

const KIND_NAME = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/u;
const MAX_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 6;
/** The table's own limit (`jobs_counts`). */
const MAX_ATTEMPTS_LIMIT = 20;

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

export function defineJobKind<P>(definition: {
  /** Lower case, dots: `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/`. */
  readonly kind: string;
  /** The shape this code writes. */
  readonly version: number;
  /** The shapes this code can run; default `[version]`. */
  readonly reads?: readonly number[];
  readonly scope: JobScope;
  /** 1 to 15,000, else this throws at definition. */
  readonly timeoutMs: number;
  /** Default 6. */
  readonly maxAttempts?: number;
  readonly payload: z.ZodType<P>;
  readonly handler: (ctx: JobContext<P>) => Promise<void>;
  readonly onManualRetry?: (tx: JobTransaction, payload: P) => Promise<void>;
}): JobKind<P> {
  const { kind, version, scope, timeoutMs, payload: schema, handler, onManualRetry } = definition;
  if (!KIND_NAME.test(kind)) {
    throw new Error(`Job kind "${kind}" must be lower case words joined by dots`);
  }
  if (!isPositiveInteger(version)) {
    throw new Error(`Job kind "${kind}": version must be a whole number from 1`);
  }
  const reads = definition.reads ?? [version];
  if (reads.length === 0 || !reads.every(isPositiveInteger)) {
    throw new Error(`Job kind "${kind}": reads must list whole numbers from 1`);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`Job kind "${kind}": timeoutMs must be a whole number from 1 to ${String(MAX_TIMEOUT_MS)}`);
  }
  const maxAttempts = definition.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS_LIMIT) {
    throw new Error(`Job kind "${kind}": maxAttempts must be a whole number from 1 to ${String(MAX_ATTEMPTS_LIMIT)}`);
  }

  const parse = (raw: unknown): P => schema.parse(raw);
  return {
    kind,
    version,
    reads: [...reads],
    scope,
    timeoutMs,
    maxAttempts,
    parse,
    // The handler gets the payload as the schema parsed it, so a stored shape
    // that no longer matches fails here, as an error of the run.
    run: (ctx) => handler({ ...ctx, payload: parse(ctx.payload) }),
    ...(onManualRetry === undefined
      ? {}
      : { onManualRetry: (tx: JobTransaction, raw: unknown) => onManualRetry(tx, parse(raw)) }),
  };
}

export type JobRegistry = ReadonlyMap<string, JobKind<unknown>>;

/** Throws if two definitions share a kind. */
export function buildJobRegistry(kinds: readonly JobKind<unknown>[]): JobRegistry {
  const registry = new Map<string, JobKind<unknown>>();
  for (const definition of kinds) {
    if (registry.has(definition.kind)) {
      throw new Error(`Job kind "${definition.kind}" is defined twice`);
    }
    registry.set(definition.kind, definition);
  }
  return registry;
}

// ---------------------------------------------------------------------------
// An error's text, for `jobs.last_error`, a log line and an alert.
//
// A drizzle failure's message carries the query parameters (a recipient, a
// name), so the text goes through `scrubErrorMessage`; a provider's refusal
// can quote the address it refused, so any address left is replaced too. The
// same two steps a send's error gets in `services/email.ts` (its
// `EMAIL_ADDRESS` and `errorMessage`); that pattern is copied here, not
// imported, because `email.ts` keeps it private.
// ---------------------------------------------------------------------------

const EMAIL_ADDRESS = /[^\s@<>()[\]"',;:]+@[^\s@<>()[\]"',;:]+\.[^\s@<>()[\]"',;:]+/gu;
const UNKNOWN_ERROR = "unknown error";
const MAX_ERROR_TEXT = 500;

function rawErrorText(error: unknown): string {
  if (error === null || error === undefined) return UNKNOWN_ERROR;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean") return String(error);
  if (typeof error === "object") {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string") return message;
    return JSON.stringify(error);
  }
  return UNKNOWN_ERROR;
}

/**
 * An error's text, safe to store, log and report: query parameters removed by
 * `scrubErrorMessage`, any email address replaced with "[email address]", and
 * at most 500 characters. Never throws.
 */
export function jobErrorText(error: unknown): string {
  try {
    const text = scrubErrorMessage(rawErrorText(error)).replace(EMAIL_ADDRESS, "[email address]").trim();
    if (text === "") return UNKNOWN_ERROR;
    if (text.length <= MAX_ERROR_TEXT) return text;
    const cut = text.slice(0, MAX_ERROR_TEXT);
    // Never end on half of a surrogate pair.
    const last = cut.charCodeAt(cut.length - 1);
    return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
  } catch {
    return UNKNOWN_ERROR;
  }
}
