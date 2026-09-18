import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNativeSplatGeometry } from "../native-splat-loader.js";
import { allocateSplatData } from "../native-splat-data.js";

class DecoderWorker {
  static instances: DecoderWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { DecoderWorker.instances.push(this); }
  complete(): void { this.onmessage?.({ data: { type: "loaded", data: allocateSplatData(1, 3, "sog") } } as MessageEvent); }
}
afterEach(() => { vi.unstubAllGlobals(); DecoderWorker.instances = []; });

describe("native splat worker lifecycle", () => {
  it("caps concurrent decoding at two workers and transfers native geometry", async () => {
    vi.stubGlobal("Worker", DecoderWorker);
    const first = loadNativeSplatGeometry("/one.sog"), second = loadNativeSplatGeometry("/two.sog"), third = loadNativeSplatGeometry("/three.sog");
    expect(DecoderWorker.instances).toHaveLength(2);
    DecoderWorker.instances[0]!.complete();
    expect(DecoderWorker.instances).toHaveLength(3);
    DecoderWorker.instances[1]!.complete(); DecoderWorker.instances[2]!.complete();
    for (const geometry of await Promise.all([first, second, third])) { expect(geometry.getAttribute("position").count).toBe(1); geometry.dispose(); }
    expect(DecoderWorker.instances.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  });

  it("terminates an active cancelled decode and removes queued cancelled work", async () => {
    vi.stubGlobal("Worker", DecoderWorker);
    const active = new AbortController(), queued = new AbortController();
    const first = loadNativeSplatGeometry("/one.sog", { signal: active.signal });
    const firstRejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = loadNativeSplatGeometry("/two.sog");
    const third = loadNativeSplatGeometry("/three.sog", { signal: queued.signal });
    const thirdRejected = expect(third).rejects.toMatchObject({ name: "AbortError" });
    queued.abort(); active.abort();
    DecoderWorker.instances[1]!.complete(); (await second).dispose();
    await Promise.all([firstRejected, thirdRejected]);
    expect(DecoderWorker.instances).toHaveLength(2);
    expect(DecoderWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });
});
