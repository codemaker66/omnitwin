import { z } from "zod";
import { defineJobKind } from "../kinds.js";

// ---------------------------------------------------------------------------
// The job list (T-702): the harmless test kind.
//
// It does nothing, and ends done: written by hand (or by a test) to show that
// the list carries work from the request that wrote it to a worker and back.
// The list ships switched off, then on, with this one kind.
// ---------------------------------------------------------------------------

export const selfTestJob = defineJobKind({
  kind: "jobs.selftest",
  version: 1,
  scope: "platform",
  timeoutMs: 5000,
  payload: z.object({ nonce: z.string().min(1).max(100) }).strict(),
  handler: (): Promise<void> => Promise.resolve(),
});
