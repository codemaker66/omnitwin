import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
function decoderWorker(index: number): DecoderWorker {
  const worker = DecoderWorker.instances[index];
  if (worker === undefined) throw new Error(`Missing decoder worker ${String(index)}`);
  return worker;
}
beforeEach(() => { vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 }); });
afterEach(() => { vi.unstubAllGlobals(); DecoderWorker.instances = []; });

describe("native splat worker lifecycle", () => {
  it.each([
    { hardwareConcurrency: 4, deviceMemory: 8 },
    { hardwareConcurrency: 8, deviceMemory: 4 },
  ])("serializes complete source decoding on constrained devices: %j", async (capabilities) => {
    vi.stubGlobal("navigator", capabilities);
    vi.stubGlobal("Worker", DecoderWorker);
    const first = loadNativeSplatGeometry("/one.sog"), second = loadNativeSplatGeometry("/two.sog");
    expect(DecoderWorker.instances).toHaveLength(1);
    decoderWorker(0).complete();
    expect(DecoderWorker.instances).toHaveLength(2);
    decoderWorker(1).complete();
    for (const geometry of await Promise.all([first, second])) {
      expect(geometry.getAttribute("position").count).toBe(1);
      expect(geometry.hasAttribute("sphericalHarmonics3")).toBe(true);
      geometry.dispose();
    }
  });

  it("caps concurrent decoding at two workers and transfers native geometry", async () => {
    vi.stubGlobal("Worker", DecoderWorker);
    const first = loadNativeSplatGeometry("/one.sog"), second = loadNativeSplatGeometry("/two.sog"), third = loadNativeSplatGeometry("/three.sog");
    expect(DecoderWorker.instances).toHaveLength(2);
    decoderWorker(0).complete();
    expect(DecoderWorker.instances).toHaveLength(3);
    decoderWorker(1).complete(); decoderWorker(2).complete();
    for (const geometry of await Promise.all([first, second, third])) { expect(geometry.getAttribute("position").count).toBe(1); geometry.dispose(); }
    expect(DecoderWorker.instances.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  });

  it("serializes the unknown-memory six-processor touch fallback without discarding points or SH", async () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 6 });
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" || query === "(hover: none)" }));
    vi.stubGlobal("Worker", DecoderWorker);
    const first = loadNativeSplatGeometry("/one.sog"), second = loadNativeSplatGeometry("/two.sog");
    expect(DecoderWorker.instances).toHaveLength(1);
    decoderWorker(0).complete();
    expect(DecoderWorker.instances).toHaveLength(2);
    decoderWorker(1).complete();
    for (const geometry of await Promise.all([first, second])) {
      expect(geometry.getAttribute("position").count).toBe(1);
      expect(geometry.hasAttribute("sphericalHarmonics3")).toBe(true);
      geometry.dispose();
    }
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
    decoderWorker(1).complete(); (await second).dispose();
    await Promise.all([firstRejected, thirdRejected]);
    expect(DecoderWorker.instances).toHaveLength(2);
    expect(decoderWorker(0).terminate).toHaveBeenCalledOnce();
  });
});
