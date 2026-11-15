// ---------------------------------------------------------------------------
// The job list (T-702): what the worker tells a person about.
//
// A job that went dead, a claim whose server never answered, and the worker
// itself failing and recovering. Every call carries the kind, the job's id and
// the venue's id only, and any text has been through `jobErrorText`: no name,
// address or amount reaches an alert. The reporter that sends these to Sentry,
// or to the log without a DSN, is Task 7's; this file holds the shape and a
// fake that records what it was told, for tests.
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
