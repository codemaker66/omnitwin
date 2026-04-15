import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { emailSends } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Email service
//
// Transactional sends go through four guarantees:
//
//   1. Idempotency. Every send has an `idempotencyKey` that the caller
//      derives from the business event ("enquiry-approved:{id}",
//      "enquiry-new:{enquiryId}:{hallkeeperId}"). Before calling Resend
//      we INSERT a row into `email_sends` keyed on that value. The
//      column has a UNIQUE constraint — a concurrent or replayed attempt
//      hits PG error 23505, which we treat as "already sent", and the
//      second send is a no-op. Survives process restarts.
//
//   2. Bounded retry with exponential backoff. Network errors, 5xx and
//      429 responses retry (250, 500, 1000, 2000 ms). 4xx responses are
//      permanent and fail immediately — no point retrying a bad address.
//
//   3. Structured logging. Every attempt, success, failure, and dedup
//      emits a record with {event, idempotencyKey, recipient, ...}. The
//      logger is injected — routes pass `request.log` (Fastify pino) so
//      the request id is in every line; tests inject a capture.
//
//   4. Audit trail. The `email_sends` row is updated with final status
//      ("sent" / "failed" / "dev_mode"), the provider message id, and
//      the attempt count. A reviewer can reconstruct every send.
//
// Known gaps (documented rather than hidden):
//   - If a process crashes between the INSERT and the Resend call, the
//     row stays at status="pending". No future attempt will retry it;
//     a human has to inspect and requeue. A durable worker with
//     pending-row timeouts is the next evolution — out of scope for the
//     first shipping version.
//   - If a concurrent duplicate arrives mid-flight (before the first
//     attempt finishes), the concurrent caller gets a "success"
//     response even though delivery is still in flight. This is fine
//     operationally — the original attempt WILL finish — but it means
//     "success" reads as "already being handled", not "already
//     delivered". Callers must not use this return as a write-trigger
//     for downstream side effects.
// ---------------------------------------------------------------------------

export interface EmailPayload {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
}

/** Minimal structural subset of Fastify's `FastifyBaseLogger` / pino. */
export interface EmailLogger {
  readonly info: (obj: Record<string, unknown>, msg?: string) => void;
  readonly warn: (obj: Record<string, unknown>, msg?: string) => void;
  readonly error: (obj: Record<string, unknown>, msg?: string) => void;
}

const NOOP_LOGGER: EmailLogger = {
  info: () => { /* noop */ },
  warn: () => { /* noop */ },
  error: () => { /* noop */ },
};

export interface SendOptions {
  readonly db: Database;
  /** Stable key deduping business-level duplicates. See module comment. */
  readonly idempotencyKey: string;
  readonly logger?: EmailLogger;
  /** Test hook — override the retry sleep so tests don't burn real ms. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const RETRY_DELAYS_MS: readonly number[] = [250, 500, 1000, 2000];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// ---------------------------------------------------------------------------
// Resend client — lazy singleton so tests can populate RESEND_API_KEY after
// import order has already run.
// ---------------------------------------------------------------------------

let resendClient: Resend | null = null;
let resendInitialized = false;

function getResendClient(): Resend | null {
  if (resendInitialized) return resendClient;
  resendInitialized = true;
  const apiKey = process.env["RESEND_API_KEY"];
  if (apiKey !== undefined && apiKey !== "") {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

/** Test-only: reset the lazy singleton so a fresh RESEND_API_KEY can take effect. */
export function __resetResendClientForTests(): void {
  resendClient = null;
  resendInitialized = false;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function statusCodeOf(err: unknown): number | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const candidate = (err as { statusCode?: unknown }).statusCode;
  if (typeof candidate === "number") return candidate;
  const alt = (err as { status?: unknown }).status;
  if (typeof alt === "number") return alt;
  return undefined;
}

/**
 * Transient failures retry. Network errors (no status) + 5xx + 429 are
 * transient. 4xx is permanent (bad address, auth, malformed payload).
 */
function isTransientError(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  const code = statusCodeOf(err);
  if (code === undefined) return true; // no statusCode → network/timeout
  return code >= 500 || code === 429;
}

function errorMessage(err: unknown): string {
  if (err === null || err === undefined) return "unknown error";
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
    try {
      return JSON.stringify(err);
    } catch {
      return "unknown error";
    }
  }
  if (typeof err === "string") return err;
  if (typeof err === "number" || typeof err === "boolean") return String(err);
  return "unknown error";
}

/** PostgreSQL error code 23505 = unique_violation. */
function isUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (code === "23505") return true;
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null && (cause as { code?: unknown }).code === "23505") {
    return true;
  }
  const msg = errorMessage(err);
  return msg.includes("duplicate key value") || msg.includes("unique constraint");
}

// ---------------------------------------------------------------------------
// Main send routine
// ---------------------------------------------------------------------------

export async function sendEmail(
  payload: EmailPayload,
  options: SendOptions,
): Promise<boolean> {
  const { db, idempotencyKey } = options;
  const logger = options.logger ?? NOOP_LOGGER;
  const sleep = options.sleep ?? defaultSleep;

  // 1. Atomic dedup via the UNIQUE(idempotency_key) constraint.
  try {
    await db.insert(emailSends).values({
      idempotencyKey,
      recipient: payload.to,
      subject: payload.subject,
      status: "pending",
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      logger.info({
        event: "email.dedup_skip",
        idempotencyKey,
        recipient: payload.to,
      }, "email.dedup_skip");
      return true;
    }
    logger.error({
      event: "email.audit_insert_failed",
      idempotencyKey,
      recipient: payload.to,
      error: errorMessage(err),
    }, "email.audit_insert_failed");
    return false;
  }

  // 2. Dev mode — no API key set. Audit row records a clear "dev_mode"
  // status so a reviewer can distinguish "no provider" from "provider
  // succeeded".
  const client = getResendClient();
  const emailFrom = process.env["EMAIL_FROM"] ?? "OMNITWIN <notifications@omnitwin.com>";
  if (client === null) {
    logger.warn({
      event: "email.dev_mode_skip",
      idempotencyKey,
      recipient: payload.to,
    }, "email.dev_mode_skip");
    await db.update(emailSends)
      .set({ status: "dev_mode", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(emailSends.idempotencyKey, idempotencyKey));
    return true;
  }

  // 3. Retry loop. `attempt` runs 0..N where N = RETRY_DELAYS_MS.length;
  // the loop exits either on success, permanent failure, or exhaustion.
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await client.emails.send({
        from: emailFrom,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      });

      // Resend's SDK returns `{ data, error }` — inspect error first.
      const resendErr = (result as { error?: unknown }).error;
      if (resendErr !== null && resendErr !== undefined) {
        lastError = errorMessage(resendErr);
        const transient = isTransientError(resendErr);
        logger.warn({
          event: "email.send_attempt_failed",
          idempotencyKey,
          recipient: payload.to,
          attempt,
          transient,
          error: lastError,
        }, "email.send_attempt_failed");
        if (!transient || attempt >= RETRY_DELAYS_MS.length) {
          await markFailed(db, idempotencyKey, lastError, attempt + 1);
          logger.error({
            event: "email.send_failed",
            idempotencyKey,
            recipient: payload.to,
            attempt,
            error: lastError,
          }, "email.send_failed");
          return false;
        }
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay !== undefined) await sleep(delay);
        continue;
      }

      const messageId = (result as { data?: { id?: string } | null }).data?.id ?? null;
      await db.update(emailSends)
        .set({
          status: "sent",
          providerMessageId: messageId,
          sentAt: new Date(),
          attemptCount: attempt + 1,
          updatedAt: new Date(),
        })
        .where(eq(emailSends.idempotencyKey, idempotencyKey));
      logger.info({
        event: "email.sent",
        idempotencyKey,
        recipient: payload.to,
        attempt,
        providerMessageId: messageId,
      }, "email.sent");
      return true;
    } catch (err) {
      lastError = errorMessage(err);
      const transient = isTransientError(err);
      logger.warn({
        event: "email.send_exception",
        idempotencyKey,
        recipient: payload.to,
        attempt,
        transient,
        error: lastError,
      }, "email.send_exception");
      if (!transient || attempt >= RETRY_DELAYS_MS.length) {
        await markFailed(db, idempotencyKey, lastError, attempt + 1);
        logger.error({
          event: "email.send_failed",
          idempotencyKey,
          recipient: payload.to,
          attempt,
          error: lastError,
        }, "email.send_failed");
        return false;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) await sleep(delay);
    }
  }

  // Unreachable — every iteration either returns or continues.
  return false;
}

async function markFailed(
  db: Database,
  idempotencyKey: string,
  lastError: string,
  attemptCount: number,
): Promise<void> {
  await db.update(emailSends)
    .set({ status: "failed", lastError, attemptCount, updatedAt: new Date() })
    .where(eq(emailSends.idempotencyKey, idempotencyKey));
}

// ---------------------------------------------------------------------------
// Fire-and-forget wrapper
//
// Routes respond to the HTTP request before delivery completes. The audit
// row is INSERTED on the next tick (not before the response), so there's
// still a window where the response ships before the row exists. For the
// shipping business (customer emails, hallkeeper notifications) this is
// acceptable: the API's 200 means "the transition is recorded", not "the
// email has landed in the inbox".
// ---------------------------------------------------------------------------

export function sendEmailAsync(payload: EmailPayload, options: SendOptions): void {
  setImmediate(() => {
    void sendEmail(payload, options).catch(() => {
      /* errors are already logged by sendEmail; the .catch here only
       * prevents an unhandled-rejection warning from bubbling. */
    });
  });
}
