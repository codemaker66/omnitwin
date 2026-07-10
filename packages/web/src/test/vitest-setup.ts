import { afterEach } from "vitest";

type ThreeDevWindow = Window & {
  __THREE__?: string;
};

delete (window as ThreeDevWindow).__THREE__;

// Unit tests must not silently fall through to the local API. Tests that
// exercise HTTP behavior install an explicit fetch stub; an unstubbed request
// to the development backend is test isolation drift and otherwise surfaces as
// a late, context-free ECONNREFUSED error from happy-dom/undici.
const environmentFetch = globalThis.fetch.bind(globalThis);
const unexpectedApiRequests: string[] = [];
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const rawUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  const url = new URL(rawUrl, window.location.href);

  if (
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") &&
    url.port === "3001"
  ) {
    const error = new Error(`Unexpected unstubbed API request in unit test: ${url.href}`);
    unexpectedApiRequests.push(error.stack ?? error.message);
    throw error;
  }

  return environmentFetch(input, init);
};

afterEach(() => {
  if (unexpectedApiRequests.length === 0) return;
  const requests = unexpectedApiRequests.splice(0, unexpectedApiRequests.length);
  throw new Error(`Unit test attempted real API traffic:\n${requests.join("\n\n")}`);
});

// @sparkjsdev/spark loads its sorter WASM with WebAssembly.instantiateStreaming
// at import time. Under Node + happy-dom the streaming source (a happy-dom
// Response) is rejected by Node's WASM API ("source argument must be an
// instance of Response"), producing a benign async unhandled rejection that can
// flake longer-running test files. Apply the standard arrayBuffer fallback so
// the WASM instantiates normally in the test environment instead of rejecting.
if (typeof WebAssembly.instantiateStreaming === "function") {
  WebAssembly.instantiateStreaming = async (
    source: Response | PromiseLike<Response>,
    importObject?: WebAssembly.Imports,
  ): Promise<WebAssembly.WebAssemblyInstantiatedSource> => {
    const response = await source;
    const bytes = await response.arrayBuffer();
    return WebAssembly.instantiate(bytes, importObject);
  };
}
