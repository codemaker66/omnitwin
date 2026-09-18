import { decodeNativeSplatBuffer } from "./native-splat-decode.js";

// One request per worker. The owner terminates the worker to abort fetch, WASM
// decoding or synchronous PLY parsing, and releases its WASM heap after transfer.
const scope = self;
scope.onmessage = (event: MessageEvent<unknown>) => {
  void (async () => {
    try {
      const request = event.data;
      if (typeof request !== "object" || request === null || !("url" in request) || typeof request.url !== "string") throw new Error("Invalid native splat decoder request.");
      const response = await fetch(request.url, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Splat download failed (${String(response.status)}).`);
      const totalHeader = response.headers.get("content-length");
      const declared = totalHeader === null ? NaN : Number(totalHeader);
      const total = Number.isSafeInteger(declared) && declared >= 0 ? declared : null;
      const limit = 2 * 1024 * 1024 * 1024;
      if (total !== null && total > limit) throw new Error("Splat download exceeds 2 GiB.");
      scope.postMessage({ type: "progress", progress: { loaded: 0, total, phase: "fetch" } });
      if (!response.body) throw new Error("Splat download has no response body.");
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let loaded = 0, lastProgress = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          loaded += value.byteLength;
          if (loaded > limit) { await reader.cancel(); throw new Error("Splat download exceeds 2 GiB."); }
          chunks.push(value);
          if (performance.now() - lastProgress >= 100) {
            scope.postMessage({ type: "progress", progress: { loaded, total, phase: "fetch" } });
            lastProgress = performance.now();
          }
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      chunks.length = 0;
      const buffer = bytes.buffer;
      scope.postMessage({ type: "progress", progress: { loaded: buffer.byteLength, total: buffer.byteLength, phase: "decode" } });
      const data = await decodeNativeSplatBuffer(buffer, request.url);
      const transfer = [data.centers.buffer, data.covariances.buffer, data.colors.buffer, ...data.sh.map((values) => values.buffer)] as ArrayBuffer[];
      scope.postMessage({ type: "loaded", data }, { transfer });
    } catch (error) {
      scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  })();
};
