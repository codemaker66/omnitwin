// ---------------------------------------------------------------------------
// The set-down Worker (T-700, rulings R48 and R15): renders set-downs and
// room tails off the main thread, one job per message (worker-protocol.ts).
// Each answer goes back with its two channel buffers transferred, so the main
// thread neither renders nor copies. runSetDownJob never throws, so every job
// is answered once.
//
// Once its handler is in place it posts one ready message: the client counts
// a job's time only from then, so a slow first load is not taken for a Worker
// that stopped (ruling R99).
// ---------------------------------------------------------------------------

import { runSetDownJob } from "./worker-jobs.js";
import { SET_DOWN_READY } from "./worker-protocol.js";

self.onmessage = (event: MessageEvent<unknown>) => {
  const { answer, transfer } = runSetDownJob(event.data);
  self.postMessage(answer, { transfer });
};

self.postMessage(SET_DOWN_READY);
