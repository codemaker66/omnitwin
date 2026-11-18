import { describe, expect, it, vi } from "vitest";
import { computeBoundingBox, roomGeometries } from "../../../data/room-geometries.js";
import { SET_DOWN_BODIES, bodyFor } from "../bodies.js";
import { earlyReflections, reflectionRoomFor, type Reflection } from "../reflections.js";
import { referenceDinner, roomState } from "../room-acoustics.js";
import { renderSetDown, type SetDownInput } from "../render.js";
import { ROOM_ACOUSTICS, isRoomSlug } from "../rooms.js";
import { SURFACES, surfaceResponse, type SurfaceKind } from "../surfaces.js";
import { renderRoomTail, tailOnsetSeconds } from "../tail.js";
import { runSetDownJob, type SetDownJobResult } from "../worker-jobs.js";
import {
  SET_DOWN_RATES_HZ,
  isSetDownAnswer,
  isSetDownJob,
  setDownJobProblem,
  type SetDownRenderAnswer,
  type SetDownRenderJob,
  type SetDownTailAnswer,
  type SetDownTailJob,
} from "../worker-protocol.js";
import { inputFor, sameSamples } from "./set-down-kit.js";

// ---------------------------------------------------------------------------
// The set-down Worker's work, run in Node exactly as the Worker runs it
// (ruling R48): one job in, one answer out, with the two channel buffers to
// transfer. Each job is passed through structuredClone first, as postMessage
// passes it, so what is rendered is what the Worker would receive.
// ---------------------------------------------------------------------------

/**
 * How the mocked engine lays its channels out: as the engine does (each its own whole buffer), as views into the
 * middle of one larger buffer, or as two views on one whole buffer.
 */
type Layout = "own" | "subarray" | "one-buffer";

/** Lets a test make the engine throw, as an allocation that fails on a phone would, or lay its channels out otherwise. */
const engine = vi.hoisted(() => {
  const state: { fail: boolean; layout: Layout } = { fail: false, layout: "own" };
  return state;
});

vi.mock("../render.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../render.js")>();
  return {
    ...real,
    renderSetDown: (input: SetDownInput) => {
      if (engine.fail) throw new RangeError("Array buffer allocation failed");
      const rendered = real.renderSetDown(input);
      const n = rendered.left.length;
      if (engine.layout === "subarray") {
        const padded = new Float32Array(2 * n + 8);
        padded.set(rendered.left, 4);
        padded.set(rendered.right, n + 6);
        return { ...rendered, left: padded.subarray(4, 4 + n), right: padded.subarray(n + 6, 2 * n + 6) };
      }
      if (engine.layout === "one-buffer") {
        const shared = rendered.left.slice().buffer;
        return { ...rendered, left: new Float32Array(shared), right: new Float32Array(shared) };
      }
      return rendered;
    },
  };
});

const SR = 48000;

/** The Grand Hall's early reflections for a source 2 m off its centre and a listener 1.6 m up near it (render-figures.test.ts's cost case). */
function grandHallReflections(): readonly Reflection[] {
  const geometry = roomGeometries["Grand Hall"];
  if (geometry === undefined) throw new Error("no Grand Hall geometry");
  const box = computeBoundingBox(geometry.wallPolygon);
  const centre = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
  return earlyReflections(
    reflectionRoomFor(ROOM_ACOUSTICS["grand-hall"], geometry),
    { x: centre.x + 2, y: 0, z: centre.z + 1 },
    { position: { x: centre.x - 1, y: 1.6, z: centre.z - 1 }, right: { x: 1, y: 0, z: 0 } },
  );
}

function chiavariJob(id = 3): SetDownRenderJob {
  const reflections = grandHallReflections();
  return { kind: "render", id, key: "chiavari-chair|oak", input: inputFor("chiavari-chair", "oak-boards-joists", { seed: 7, reflections, sampleRate: SR }) };
}

function grandHallTailJob(id = 5): SetDownTailJob {
  const room = ROOM_ACOUSTICS["grand-hall"];
  return {
    kind: "tail",
    id,
    key: "grand-hall|dinner",
    rt: roomState(room, referenceDinner("grand-hall")).rt,
    sampleRate: SR,
    seed: 7,
    onsetSeconds: tailOnsetSeconds(room),
  };
}

/** The job as the Worker receives it: through the structured clone postMessage makes. */
function inWorker(job: unknown): SetDownJobResult {
  return runSetDownJob(structuredClone(job));
}

function renderAnswer(result: SetDownJobResult): SetDownRenderAnswer {
  const { answer } = result;
  if (answer.kind !== "render" || !answer.ok) throw new Error(`expected a rendered set-down, got ${JSON.stringify(answer)}`);
  return answer;
}

function tailAnswer(result: SetDownJobResult): SetDownTailAnswer {
  const { answer } = result;
  if (answer.kind !== "tail" || !answer.ok) throw new Error(`expected a rendered tail, got ${JSON.stringify(answer)}`);
  return answer;
}

describe("runSetDownJob renders what the engine renders", () => {
  it("renders a Chiavari on the Grand Hall's oak, with its 18 reflections, seed 7 at 48 kHz, bytewise as renderSetDown does", () => {
    const job = chiavariJob();
    expect(job.input.reflections).toHaveLength(18);
    const expected = renderSetDown(job.input);

    const result = inWorker(job);
    const answer = renderAnswer(result);

    expect(answer.id).toBe(3);
    expect(sameSamples(new Float32Array(answer.left), expected.left)).toBe(true);
    expect(sameSamples(new Float32Array(answer.right), expected.right)).toBe(true);
    expect(answer.sampleRate).toBe(SR);
    expect(answer.peakDb).toBe(expected.peakDb);
    expect(answer.onsetSeconds).toBe(expected.onsetSeconds);
    expect(answer.limitDb).toBe(expected.limitDb);
    expect(Number.isFinite(answer.workMs) && answer.workMs >= 0).toBe(true);
  });

  it("renders a room's tail bytewise as renderRoomTail does: the Grand Hall laid for dinner, seed 7 at 48 kHz", () => {
    const job = grandHallTailJob();
    const expected = renderRoomTail(job.rt, { sampleRate: job.sampleRate, seed: job.seed, onsetSeconds: job.onsetSeconds });

    const answer = tailAnswer(inWorker(job));

    expect(answer.id).toBe(5);
    expect(sameSamples(new Float32Array(answer.left), expected.left)).toBe(true);
    expect(sameSamples(new Float32Array(answer.right), expected.right)).toBe(true);
    expect(answer.sampleRate).toBe(SR);
    expect(Number.isFinite(answer.workMs) && answer.workMs >= 0).toBe(true);
  });

  it("hands both channels' own buffers over to transfer, and the transfer moves them without a copy", () => {
    for (const job of [chiavariJob(), grandHallTailJob()]) {
      const result = inWorker(job);
      const { answer, transfer } = result;
      if (!answer.ok) throw new Error(answer.error);
      expect(transfer).toHaveLength(2);
      expect(transfer[0]).toBe(answer.left);
      expect(transfer[1]).toBe(answer.right);
      expect(answer.left).not.toBe(answer.right);
      const bytes = answer.left.byteLength;
      expect(bytes).toBeGreaterThan(0);
      expect(answer.right.byteLength).toBe(bytes);

      // Posting with this transfer list moves both buffers: the sender's are detached, the receiver's hold the samples.
      const sentLeft = new Float32Array(answer.left).slice();
      const received = structuredClone(answer, { transfer });
      expect(answer.left.byteLength).toBe(0);
      expect(answer.right.byteLength).toBe(0);
      expect(received.left.byteLength).toBe(bytes);
      expect(sameSamples(new Float32Array(received.left), sentLeft)).toBe(true);
    }
  });

  it("copies a channel that is a view into part of a larger buffer, so only its own samples are transferred", () => {
    const job = chiavariJob();
    const expected = renderSetDown(job.input);
    engine.layout = "subarray";
    try {
      const { answer, transfer } = inWorker(job);
      if (!answer.ok) throw new Error(answer.error);
      expect(answer.left.byteLength).toBe(expected.left.byteLength);
      expect(answer.right.byteLength).toBe(expected.right.byteLength);
      expect(sameSamples(new Float32Array(answer.left), expected.left)).toBe(true);
      expect(sameSamples(new Float32Array(answer.right), expected.right)).toBe(true);
      expect(answer.left).not.toBe(answer.right);
      expect(() => structuredClone(answer, { transfer })).not.toThrow();
    } finally {
      engine.layout = "own";
    }
  });

  it("copies the second of two channels on one buffer, so the transfer names each buffer once", () => {
    const job = chiavariJob();
    const expected = renderSetDown(job.input);
    engine.layout = "one-buffer";
    try {
      const { answer, transfer } = inWorker(job);
      if (!answer.ok) throw new Error(answer.error);
      expect(answer.left).not.toBe(answer.right);
      expect(sameSamples(new Float32Array(answer.left), expected.left)).toBe(true);
      expect(sameSamples(new Float32Array(answer.right), expected.left)).toBe(true);
      // A buffer named twice in a transfer list is refused (DataCloneError).
      expect(() => structuredClone(answer, { transfer })).not.toThrow();
      expect(() => structuredClone(answer, { transfer: [answer.left, answer.left] })).toThrow();
    } finally {
      engine.layout = "own";
    }
  });

  it("answers a 44.1 kHz tail and a 96 kHz render at their own rates", () => {
    const tail = { ...grandHallTailJob(), sampleRate: 44100 };
    expect(tailAnswer(inWorker(tail)).sampleRate).toBe(44100);
    const job = chiavariJob();
    const render = { ...job, input: { ...job.input, sampleRate: 96000 } };
    const answer = renderAnswer(inWorker(render));
    expect(answer.sampleRate).toBe(96000);
    expect(sameSamples(new Float32Array(answer.left), renderSetDown(render.input).left)).toBe(true);
  });
});

describe("runSetDownJob refuses what is malformed, and never throws", () => {
  /** The job's answer, which must be a refusal with no buffers to transfer. */
  function refused(job: unknown): { readonly kind: string | null; readonly id: number | null; readonly error: string } {
    let result: SetDownJobResult | undefined;
    expect(() => { result = runSetDownJob(job); }).not.toThrow();
    if (result === undefined) throw new Error("no answer");
    const { answer, transfer } = result;
    if (answer.ok) throw new Error(`expected a refusal, got an answer for ${String(answer.id)}`);
    expect(transfer).toEqual([]);
    expect(answer.error.length).toBeGreaterThan(0);
    return answer;
  }

  it("refuses an unknown kind, naming it", () => {
    const answer = refused({ kind: "chime", id: 4, key: "x" });
    expect(answer).toMatchObject({ kind: null, id: 4 });
    expect(answer.error).toMatch(/kind/);
  });

  it("refuses a NaN sample rate, for a tail and for a render", () => {
    const tail = refused({ ...grandHallTailJob(6), sampleRate: Number.NaN });
    expect(tail).toMatchObject({ kind: "tail", id: 6 });
    expect(tail.error).toMatch(/job\.sampleRate/);

    const job = chiavariJob(7);
    const render = refused({ ...job, input: { ...job.input, sampleRate: Number.NaN } });
    expect(render).toMatchObject({ kind: "render", id: 7 });
    expect(render.error).toMatch(/job\.input\.sampleRate/);
  });

  it("refuses a rate outside 8 to 384 kHz, so a tail never asks for gigabytes", () => {
    expect(refused({ ...grandHallTailJob(), sampleRate: 1e9 }).error).toMatch(/sampleRate/);
    expect(refused({ ...grandHallTailJob(), sampleRate: SET_DOWN_RATES_HZ.lowest - 1 }).error).toMatch(/sampleRate/);
    expect(isSetDownJob({ ...grandHallTailJob(), sampleRate: SET_DOWN_RATES_HZ.highest })).toBe(true);
  });

  it("refuses what is not a job at all, with no id to answer to", () => {
    for (const value of [null, undefined, "render", 42, [], [chiavariJob()]]) {
      expect(refused(value)).toMatchObject({ kind: null, id: null });
    }
  });

  it("names the first field at fault, deep in the input", () => {
    const job = chiavariJob(8);
    const cases: readonly (readonly [unknown, RegExp])[] = [
      [{ ...job, id: 1.5 }, /job\.id/],
      [{ ...job, key: 7 }, /job\.key/],
      [{ ...job, input: { ...job.input, surfaces: job.input.surfaces.map((surface, i) => (i === 2 ? { ...surface, kind: "lava" } : surface)) } }, /job\.input\.surfaces\[2\]\.kind/],
      [{ ...job, input: { ...job.input, surfaces: job.input.surfaces.slice(1) } }, /surfaces/],
      [{ ...job, input: { ...job.input, body: { ...job.input.body, parts: [{ kind: "granite", lengthM: 1, thicknessM: 0.1, share: 1 }] } } }, /job\.input\.body\.parts\[0\]\.kind/],
      [{ ...job, input: { ...job.input, body: { ...job.input.body, feet: [{ x: 0, z: Number.POSITIVE_INFINITY, cap: "glide" }] } } }, /job\.input\.body\.feet\[0\]\.z/],
      [{ ...job, input: { ...job.input, reflections: [{ ...job.input.reflections[0], gain: [1, 1, 1, 1, 1, 1] }] } }, /job\.input\.reflections\[0\]\.gain/],
      [{ ...job, input: { ...job.input, direct: { gain: 1, azimuthRad: Number.NaN } } }, /job\.input\.direct\.azimuthRad/],
      [{ ...job, input: { ...job.input, kind: "fling" } }, /job\.input\.kind/],
      [{ ...job, input: { ...job.input, seed: 2.5 } }, /job\.input\.seed/],
      [{ ...grandHallTailJob(), rt: [1, 2, 3] }, /job\.rt/],
      [{ ...grandHallTailJob(), onsetSeconds: "soon" }, /job\.onsetSeconds/],
    ];
    for (const [value, field] of cases) {
      expect(setDownJobProblem(value)).toMatch(field);
      expect(refused(value).error).toMatch(field);
    }
  });

  it("answers a refusal when the engine throws, and when reading the job throws", () => {
    engine.fail = true;
    try {
      const answer = refused(chiavariJob(9));
      expect(answer).toMatchObject({ kind: "render", id: 9 });
      expect(answer.error).toMatch(/RangeError: Array buffer allocation failed/);
    } finally {
      engine.fail = false;
    }

    const trap = { kind: "tail", id: 10, get key(): string { throw new Error("a getter that throws"); } };
    expect(refused(trap).error).toMatch(/a getter that throws|job\.key/);
  });
});

describe("isSetDownJob takes every job the planner can ask for", () => {
  it("takes every catalogue body, and an imported piece's scaled fallback, on every surface with the Grand Hall's reflections", () => {
    const reflections = grandHallReflections();
    const kinds = Object.keys(SURFACES).filter((kind): kind is SurfaceKind => kind in SURFACES);
    const bodies = [...Object.values(SET_DOWN_BODIES), bodyFor("imported-piece", 1.7)];
    let id = 0;
    for (const body of bodies) {
      for (const kind of kinds) {
        const surface = surfaceResponse(kind, "grand-hall");
        const job: SetDownRenderJob = {
          kind: "render",
          id: (id += 1),
          key: `${body.slug}|${kind}`,
          input: { body, surfaces: body.feet.map(() => surface), speed: 1, kind: "settle", clothed: true, direct: { gain: 0.4, azimuthRad: -0.7 }, reflections, seed: 3, sampleRate: 44100 },
        };
        expect(setDownJobProblem(job)).toBeNull();
      }
    }
    expect(id).toBe(bodies.length * kinds.length);
  });

  it("takes every surveyed room's tail, empty and laid, at 44.1, 48 and 96 kHz", () => {
    for (const [slug, room] of Object.entries(ROOM_ACOUSTICS)) {
      if (!isRoomSlug(slug)) throw new Error(`not a room slug: ${slug}`);
      for (const items of [[], referenceDinner(slug)]) {
        for (const sampleRate of [44100, 48000, 96000]) {
          const job: SetDownTailJob = { kind: "tail", id: 1, key: slug, rt: roomState(room, items).rt, sampleRate, seed: 1, onsetSeconds: tailOnsetSeconds(room) };
          expect(setDownJobProblem(job)).toBeNull();
        }
      }
    }
  });
});

describe("the Worker's shell (set-down.worker.ts)", () => {
  it("posts one ready message as it evaluates (ruling R99), then answers each job with its two buffers transferred", async () => {
    const posted: unknown[][] = [];
    const post = vi.spyOn(self, "postMessage").mockImplementation((...args: unknown[]) => { posted.push(args); });
    try {
      await import("../set-down.worker.js");
      expect(posted).toEqual([[{ kind: "ready" }]]);

      const handler = self.onmessage;
      if (handler === null) throw new Error("the Worker set no onmessage");
      handler.call(self, new MessageEvent("message", { data: structuredClone(chiavariJob(11)) }));
      expect(posted).toHaveLength(2);
      const [answer, options] = posted[1] ?? [];
      if (!isSetDownAnswer(answer) || !answer.ok) throw new Error(`expected an answer, got ${JSON.stringify(answer)}`);
      expect(answer).toMatchObject({ kind: "render", id: 11 });
      const transfer: unknown = Reflect.get(Object(options), "transfer");
      expect(Array.isArray(transfer) && transfer.length === 2 && transfer[0] === answer.left && transfer[1] === answer.right).toBe(true);
    } finally {
      post.mockRestore();
      self.onmessage = null;
    }
  });
});
