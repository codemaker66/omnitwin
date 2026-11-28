// ---------------------------------------------------------------------------
// The set-down Worker's work (T-700, ruling R48): one job in, one answer out,
// with the buffers to transfer. set-down.worker.ts is only its onmessage, so
// this is tested in Node exactly as the Worker runs it.
//
// It never throws: a job that fails its check (worker-protocol.ts) is refused
// by name, and an engine that throws (an allocation that fails on a phone) is
// answered as a refusal, so every job the client posts is answered once.
// ---------------------------------------------------------------------------

import { renderSetDown } from "./render.js";
import { renderRoomTail, type Stereo } from "./tail.js";
import { isSetDownJob, setDownJobProblem, type SetDownAnswer, type SetDownJob, type SetDownRefusal } from "./worker-protocol.js";

export interface SetDownJobResult {
  readonly answer: SetDownAnswer;
  /** The answer's two channel buffers, to transfer with it: empty for a refusal. */
  readonly transfer: ArrayBuffer[];
}

/** Renders `data`, a message from the client, or says why it cannot. Never throws. */
export function runSetDownJob(data: unknown): SetDownJobResult {
  try {
    if (!isSetDownJob(data)) return refuse(data, setDownJobProblem(data) ?? "the job is malformed");
    return run(data);
  } catch (error) {
    return refuse(data, describe(error));
  }
}

function run(job: SetDownJob): SetDownJobResult {
  const started = performance.now();
  if (job.kind === "render") {
    const rendered = renderSetDown(job.input);
    const [left, right] = channels(rendered);
    return {
      answer: {
        kind: "render",
        id: job.id,
        ok: true,
        left,
        right,
        sampleRate: rendered.sampleRate,
        peakDb: rendered.peakDb,
        onsetSeconds: rendered.onsetSeconds,
        limitDb: rendered.limitDb,
        workMs: performance.now() - started,
      },
      transfer: [left, right],
    };
  }
  const tail = renderRoomTail(job.rt, { sampleRate: job.sampleRate, seed: job.seed, onsetSeconds: job.onsetSeconds });
  const [left, right] = channels(tail);
  return {
    answer: { kind: "tail", id: job.id, ok: true, left, right, sampleRate: tail.sampleRate, workMs: performance.now() - started },
    transfer: [left, right],
  };
}

/**
 * Each channel's own buffer, to transfer as it is. The engine gives each
 * channel a buffer of its own; a channel that is a view on part of a buffer,
 * on shared memory, or on the other channel's buffer is copied instead, since
 * moving that buffer would hand over the wrong samples or fail the post.
 */
function channels(stereo: Stereo): readonly [ArrayBuffer, ArrayBuffer] {
  const left = ownBuffer(stereo.left, null);
  return [left, ownBuffer(stereo.right, left)];
}

function ownBuffer(channel: Float32Array, taken: ArrayBuffer | null): ArrayBuffer {
  const { buffer } = channel;
  if (buffer instanceof ArrayBuffer && buffer !== taken && channel.byteOffset === 0 && channel.byteLength === buffer.byteLength) return buffer;
  return channel.slice().buffer;
}

/** A refusal of `data`, carrying its kind and id where it has them. Reading them cannot throw out of here. */
function refuse(data: unknown, error: string): SetDownJobResult {
  let kind: SetDownRefusal["kind"] = null;
  let id: number | null = null;
  try {
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      const named: unknown = Reflect.get(data, "kind");
      const numbered: unknown = Reflect.get(data, "id");
      if (named === "render" || named === "tail") kind = named;
      if (typeof numbered === "number" && Number.isSafeInteger(numbered)) id = numbered;
    }
  } catch {
    // A job whose kind or id cannot even be read is answered with neither.
  }
  return { answer: { kind, id, ok: false, error }, transfer: [] };
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
