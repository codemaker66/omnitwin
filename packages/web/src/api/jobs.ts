import { SelfTestResultSchema, StuckJobActionSchema, StuckWorkSchema, type SelfTestResult, type StuckWork } from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Stuck work (routes/admin-jobs.ts): platform administrators only. A refusal
// arrives as an ApiError carrying the server's own words.
// ---------------------------------------------------------------------------

/** The jobs that ran out of tries, the list's counts and the worker's state. */
export function getStuckWork(signal?: AbortSignal): Promise<StuckWork> {
  return api.get("/admin/jobs/stuck", StuckWorkSchema, signal);
}

/** Put a dead job back on the list. */
export async function retryStuckJob(id: string): Promise<void> {
  await api.post(`/admin/jobs/${id}/retry`, undefined, undefined, StuckJobActionSchema);
}

/** Close a dead job with a note (1 to 500 characters). */
export async function closeStuckJob(id: string, note: string): Promise<void> {
  await api.post(`/admin/jobs/${id}/close`, { note }, undefined, StuckJobActionSchema);
}

/** Put a harmless job on the list. The answer is its id and the state it had reached when the server stopped waiting. */
export function runSelfTest(): Promise<SelfTestResult> {
  return api.post("/admin/jobs/selftest", undefined, undefined, SelfTestResultSchema);
}
