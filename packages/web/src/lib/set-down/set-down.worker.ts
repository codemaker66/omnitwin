// ---------------------------------------------------------------------------
// The set-down Worker (T-700, rulings R48 and R15): renders set-downs and
// room tails off the main thread, one job per message (worker-protocol.ts).
// Each answer goes back with its two channel buffers transferred, so the main
// thread neither renders nor copies. runSetDownJob never throws, so every job
// is answered once.
// ---------------------------------------------------------------------------

import { runSetDownJob } from "./worker-jobs.js";

self.onmessage = (event: MessageEvent<unknown>) => {
  const { answer, transfer } = runSetDownJob(event.data);
  self.postMessage(answer, { transfer });
};
