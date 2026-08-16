import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach } from "vitest";

type ThreeDevWindow = Window & {
  __THREE__?: string;
};

delete (window as ThreeDevWindow).__THREE__;

// Unit tests must not silently fall through to the local API. Tests that
// exercise HTTP behavior install an explicit fetch stub; an unstubbed request
// to the development backend is test isolation drift and otherwise surfaces as
// a late, context-free ECONNREFUSED error from happy-dom/undici.

const PUBLIC_ROOT = resolve(import.meta.dirname, "..", "..", "public");

/** Map a URL path to a file in public/, or null. Refuses to escape the root. */
function resolvePublicAsset(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname).replace(/^[/]+/, "");
  if (decoded === "") return null;
  const candidate = resolve(PUBLIC_ROOT, decoded);
  if (!candidate.startsWith(PUBLIC_ROOT)) return null;
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : null;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
const environmentFetch = globalThis.fetch.bind(globalThis);
const unexpectedApiRequests: string[] = [];
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const rawUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  const url = new URL(rawUrl, window.location.href);

  // Any loopback address, not just the dev API's 3001. A relative request
  // like fetch("/api/...") names no port at all, so it inherits happy-dom's
  // default origin (localhost:3000) and slipped past a 3001-only check —
  // reaching the real network and surfacing as an intermittent ECONNREFUSED
  // that made the whole suite non-deterministic.
  if (LOOPBACK_HOSTS.has(url.hostname)) {
    // A request for a file that genuinely ships in public/ is not isolation
    // drift — it is an absent dev server. Reject it the way an offline fetch
    // rejects so components take their normal asset-unavailable fallback, and
    // do NOT record it as a violation. Serving the real bytes instead was
    // tried and was worse: it pulled the Convener's audio-driven, rAF-based
    // typewriter into unit tests, where rAF does not advance under fake
    // timers, and the line stalled after one character.
    if (resolvePublicAsset(url.pathname) !== null) {
      throw new TypeError(`fetch failed: no dev server for ${url.pathname}`);
    }
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
