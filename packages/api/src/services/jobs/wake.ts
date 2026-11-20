import type { JobWorker } from "./worker.js";

// ---------------------------------------------------------------------------
// The job list (T-702): the one worker this process runs, reachable by name.
//
// After the pattern of `services/escalation-wake.ts`: code that has just
// committed a job wakes the worker without importing the server that owns it,
// and the health route reads it from here. Nothing is installed while
// JOBS_WORKER is off, and then every call here does nothing.
// ---------------------------------------------------------------------------

let active: JobWorker | null = null;

export function installJobWorker(worker: JobWorker | null): void {
  active = worker;
}

/** Wakes the installed worker. Does nothing when none is installed. Call it after your transaction commits. */
export function pokeJobWorker(): void {
  active?.poke();
}

export function installedJobWorker(): JobWorker | null {
  return active;
}
