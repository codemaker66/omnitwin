import type { Env } from "../../env.js";
import { jobErrorText, type JobLogger } from "./kinds.js";

// ---------------------------------------------------------------------------
// The job list (T-702): what the worker tells a person about.
//
// A job that went dead, a claim whose server never answered, and the worker
// itself failing and recovering. Every call carries the kind, the job's id and
// the venue's id only, and any text has been through `jobErrorText`: no name,
// address or amount reaches an alert. The reporters below run the text through
// it once more, so a caller that forgot cannot leak one.
//
// Two reporters: to Sentry when SENTRY_DSN is set (`sentryJobAlerts`, the
// API's capture path for work that has no request; the scrubbing `initSentry`
// sets up applies to it as to a failed request), and to the log otherwise
// (`logJobAlerts`). `buildJobAlerts` chooses. A reporter never throws: an alert
// that cannot be sent is logged.
// ---------------------------------------------------------------------------

export interface JobAlerts {
  readonly jobDead: (job: { readonly id: string; readonly kind: string; readonly venueId: string | null; readonly reason: string }) => void;
  readonly claimLost: (job: { readonly id: string; readonly kind: string; readonly venueId: string | null; readonly lostClaims: number }) => void;
  /** Raised once when a fault begins, and not again until `workerRecovered` has been raised for it. */
  readonly workerFault: (what: "database" | "loop", detail: string) => void;
  readonly workerRecovered: (what: "database" | "loop") => void;
  readonly checkIn: (monitor: string) => void;
}

/**
 * Records every alert as `[name, what it was given]`, in order. A call with
 * one argument records that argument (a copy of a job's fields); `workerFault`
 * and `workerRecovered` record `{ what, detail }` and `{ what }`, and `checkIn`
 * records `{ monitor }`.
 */
export function recordingJobAlerts(): JobAlerts & { readonly calls: readonly (readonly [string, unknown])[] } {
  const calls: (readonly [string, unknown])[] = [];
  return {
    calls,
    jobDead: (job) => { calls.push(["jobDead", { ...job }]); },
    claimLost: (job) => { calls.push(["claimLost", { ...job }]); },
    workerFault: (what, detail) => { calls.push(["workerFault", { what, detail }]); },
    workerRecovered: (what) => { calls.push(["workerRecovered", { what }]); },
    checkIn: (monitor) => { calls.push(["checkIn", { monitor }]); },
  };
}

// ---------------------------------------------------------------------------
// The reporters.
// ---------------------------------------------------------------------------

type WorkerFault = "database" | "loop";
type AlertLevel = "error" | "warning" | "info";

/** One alert, said once, for both reporters: the same name, tags and text either way. */
interface AlertReport {
  readonly name: string;
  readonly level: AlertLevel;
  readonly message: string;
  /** The kind, the job's id and the venue's id (absent for a platform job), or which part of the worker failed. */
  readonly tags: Record<string, string>;
  /** Sentry groups by this: one job's alerts of one kind together, different jobs apart. */
  readonly fingerprint: string[];
  /** Logged beside the tags: a count or the scrubbed text. */
  readonly extra: Record<string, string | number>;
}

function jobTags(job: { readonly id: string; readonly kind: string; readonly venueId: string | null }): Record<string, string> {
  return {
    "job.kind": job.kind,
    "job.id": job.id,
    ...(job.venueId === null ? {} : { "venue.id": job.venueId }),
  };
}

function deadReport(job: Parameters<JobAlerts["jobDead"]>[0]): AlertReport {
  const reason = jobErrorText(job.reason);
  return {
    name: "job.dead",
    level: "error",
    message: `A job is dead (${job.kind}): ${reason}`,
    tags: jobTags(job),
    fingerprint: ["job.dead", job.id],
    extra: { reason },
  };
}

function claimLostReport(job: Parameters<JobAlerts["claimLost"]>[0]): AlertReport {
  return {
    name: "job.claim-lost",
    level: "warning",
    message: `A job's claim ran out and it was put back (${job.kind}); lost claims: ${String(job.lostClaims)}`,
    tags: jobTags(job),
    fingerprint: ["job.claim-lost", job.id],
    extra: { lostClaims: job.lostClaims },
  };
}

function faultReport(what: WorkerFault, detail: string): AlertReport {
  const text = jobErrorText(detail);
  return {
    name: "job.worker-fault",
    level: "error",
    message: `The job worker has a ${what} fault: ${text}`,
    tags: { "job.worker.fault": what },
    fingerprint: ["job.worker-fault", what],
    extra: { detail: text },
  };
}

function recoveredReport(what: WorkerFault): AlertReport {
  return {
    name: "job.worker-recovered",
    level: "info",
    message: `The job worker has recovered from its ${what} fault`,
    tags: { "job.worker.fault": what },
    // The same group as the fault it ends.
    fingerprint: ["job.worker-fault", what],
    extra: {},
  };
}

/** Writes each alert to the log: errors as errors, a lost claim as a warning, a recovery and a check-in as info. */
export function logJobAlerts(logger: JobLogger): JobAlerts {
  const write = (report: AlertReport): void => {
    const fields = { alert: report.name, ...report.tags, ...report.extra };
    if (report.level === "error") logger.error(fields, report.message);
    else if (report.level === "warning") logger.warn(fields, report.message);
    else logger.info(fields, report.message);
  };
  return {
    jobDead: (job) => { write(deadReport(job)); },
    claimLost: (job) => { write(claimLostReport(job)); },
    workerFault: (what, detail) => { write(faultReport(what, detail)); },
    workerRecovered: (what) => { write(recoveredReport(what)); },
    checkIn: (monitor) => { logger.info({ alert: "job.check-in", monitor }, "the job list checked in"); },
  };
}

/** The part of a message event the reporter sets. `@sentry/node`'s `captureMessage` accepts it. */
export interface SentryMessageContext {
  readonly level: AlertLevel;
  readonly tags: Record<string, string>;
  readonly fingerprint: string[];
}

/** A check-in that says the work ran. `@sentry/node`'s `captureCheckIn` accepts it. */
export interface SentryCheckIn {
  readonly monitorSlug: string;
  readonly status: "ok";
}

/** The monitor Sentry creates, or updates, from a check-in. */
export interface SentryMonitorConfig {
  readonly schedule: { readonly type: "interval"; readonly value: number; readonly unit: "day" };
  /** Minutes late before Sentry calls a check-in missed. */
  readonly checkinMargin: number;
}

/** The two calls the reporter makes. The `@sentry/node` module itself is one. */
export interface JobAlertsSentryClient {
  readonly captureMessage: (message: string, context: SentryMessageContext) => unknown;
  readonly captureCheckIn: (checkIn: SentryCheckIn, monitorConfig: SentryMonitorConfig) => unknown;
}

/**
 * Every monitor the list checks in to expects a check-in each day. The config
 * goes with every check-in, so Sentry creates the monitor on the first one
 * (and re-creates it if it was deleted); two hours' margin before a day
 * without one is an alert.
 */
const DAILY_MONITOR_CONFIG: SentryMonitorConfig = {
  schedule: { type: "interval", value: 1, unit: "day" },
  checkinMargin: 120,
};

/**
 * Reports each alert to Sentry as a message event tagged with the kind, the
 * job's id and the venue's id, grouped by the alert's name and the job's id;
 * `checkIn` is a cron check-in. A client that throws is logged, never thrown.
 */
export function sentryJobAlerts(client: JobAlertsSentryClient, logger: JobLogger): JobAlerts {
  const unsent = (alert: string, error: unknown): void => {
    logger.error({ alert, error: jobErrorText(error) }, "a job alert could not be sent to Sentry");
  };
  const send = (report: AlertReport): void => {
    try {
      client.captureMessage(report.message, { level: report.level, tags: report.tags, fingerprint: report.fingerprint });
    } catch (error: unknown) {
      unsent(report.name, error);
    }
  };
  return {
    jobDead: (job) => { send(deadReport(job)); },
    claimLost: (job) => { send(claimLostReport(job)); },
    workerFault: (what, detail) => { send(faultReport(what, detail)); },
    workerRecovered: (what) => { send(recoveredReport(what)); },
    checkIn: (monitor) => {
      try {
        client.captureCheckIn({ monitorSlug: monitor, status: "ok" }, DAILY_MONITOR_CONFIG);
      } catch (error: unknown) {
        unsent("job.check-in", error);
      }
    },
  };
}

/**
 * Reports through @sentry/node when SENTRY_DSN is set; otherwise returns
 * logJobAlerts(logger). As in `observability/sentry.ts`, the SDK is imported
 * only when the DSN is set; `initSentry` has already initialised it then.
 */
export async function buildJobAlerts(env: Pick<Env, "SENTRY_DSN">, logger: JobLogger): Promise<JobAlerts> {
  if (env.SENTRY_DSN === undefined) return logJobAlerts(logger);
  const Sentry = await import("@sentry/node");
  return sentryJobAlerts(Sentry, logger);
}
