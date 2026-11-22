import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DOWNLOAD_TIMEOUT_MS, sdkSandboxApi } from "../sandbox/api.js";
import { OutputTimeoutError, OutputTooLargeError } from "../sandbox/outputs.js";

// A download's limits hold whatever the body does: a body whose cancel never
// settles must not keep a download, or its partial file, past the cap or the
// deadline. No request leaves the machine: the fetch seam answers everything.

// A synthetic key of the shape the client takes, built here so no key-shaped literal sits in the source.
const KEY = ["sk", "ant", "api03", "d".repeat(32)].join("-");

const dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "credit-runner-download-"));
  dirs.push(dir);
  return dir;
}

/** A body that hands out `chunks` 1 KiB chunks and then stalls, whose cancel is counted and never settles. */
function hangingCancelBody(chunks: number) {
  let given = 0;
  let cancels = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (given >= chunks) return new Promise<void>(() => undefined);
      given += 1;
      controller.enqueue(new Uint8Array(1024).fill(0x61));
      return undefined;
    },
    cancel() {
      cancels += 1;
      return new Promise<void>(() => undefined);
    },
  });
  return { body, cancels: () => cancels };
}

type Outcome = { readonly state: "resolved"; readonly value: unknown } | { readonly state: "rejected"; readonly error: unknown };

/**
 * Lets `pending` run, turn by turn, until it settles or `realMs` of real time
 * pass (setTimeout may be faked, so the wait is counted by the clock). The
 * outcome, or null while it is still pending.
 */
async function settleWithin(pending: Promise<unknown>, realMs: number): Promise<Outcome | null> {
  const outcomes: Outcome[] = [];
  pending.then(
    (value: unknown) => outcomes.push({ state: "resolved", value }),
    (error: unknown) => outcomes.push({ state: "rejected", error }),
  );
  const until = Date.now() + realMs;
  while (outcomes.length === 0 && Date.now() < until) await new Promise((resolve) => setImmediate(resolve));
  return outcomes[0] ?? null;
}

function apiAnswering(body: ReadableStream<Uint8Array>) {
  return sdkSandboxApi(KEY, () => Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } })), {});
}

describe("a download whose body's cancel never settles", () => {
  it("is cut off at its cap at once, with the partial file removed, without waiting for the cancel", async () => {
    const dir = await tempDir();
    const destination = path.join(dir, "patch-0001.patch");
    const stream = hangingCancelBody(1000);
    // The deadline cannot fire on its own here: only the cap may end this download.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const outcome = await settleWithin(apiAnswering(stream.body).downloadFile("file_1", destination, 4 * 1024), 15_000);
    expect(outcome?.state).toBe("rejected");
    expect(outcome?.state === "rejected" ? outcome.error : null).toBeInstanceOf(OutputTooLargeError);
    expect(stream.cancels()).toBe(1);
    expect(await readdir(dir)).toEqual([]);
  });

  it("is abandoned at its deadline, with the partial file removed, without waiting for the cancel", async () => {
    const dir = await tempDir();
    const destination = path.join(dir, "patch-0001.patch");
    const stream = hangingCancelBody(2);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const download = apiAnswering(stream.body).downloadFile("file_1", destination, 1024 * 1024);
    // Both chunks written, then the body stalls.
    const until = Date.now() + 15_000;
    while (!(existsSync(destination) && (await stat(destination)).size === 2048) && Date.now() < until) await new Promise((resolve) => setImmediate(resolve));
    expect((await stat(destination)).size).toBe(2048);
    expect(await settleWithin(download, 200)).toBeNull();

    await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS);
    const outcome = await settleWithin(download, 15_000);
    expect(outcome?.state).toBe("rejected");
    expect(outcome?.state === "rejected" ? outcome.error : null).toBeInstanceOf(OutputTimeoutError);
    expect(stream.cancels()).toBeGreaterThanOrEqual(1);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("a download whose request ignores the abort", () => {
  it("fails at its deadline without waiting for the answer, and an answer that comes later writes nothing", async () => {
    const dir = await tempDir();
    const destination = path.join(dir, "patch-0001.patch");
    // The fetch never looks at its signal: it answers only when the test says so.
    const request: { signal?: AbortSignal; answer?: (response: Response) => void } = {};
    const api = sdkSandboxApi(
      KEY,
      (_input, init) => {
        request.signal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          request.answer = resolve;
        });
      },
      {},
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const download = api.downloadFile("file_1", destination, 1024);
    const until = Date.now() + 15_000;
    while (request.answer === undefined && Date.now() < until) await new Promise((resolve) => setImmediate(resolve));
    expect(request.answer).toBeDefined();

    await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS - 1);
    expect(await settleWithin(download, 200)).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    // At the deadline, whatever the fetch does with its aborted signal.
    const outcome = await settleWithin(download, 15_000);
    expect(outcome?.state).toBe("rejected");
    expect(outcome?.state === "rejected" ? outcome.error : null).toBeInstanceOf(OutputTimeoutError);
    expect(request.signal?.aborted).toBe(true);

    // The answer arrives after all, body and all; half a second of turns later, nothing has reached the folder.
    request.answer?.(new Response("From late body\n", { status: 200, headers: { "content-type": "application/octet-stream" } }));
    await settleWithin(new Promise<never>(() => undefined), 500);
    expect(await readdir(dir)).toEqual([]);
  });
});
