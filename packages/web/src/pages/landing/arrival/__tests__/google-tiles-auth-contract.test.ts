import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tile } from "3d-tiles-renderer/core";
import { TilesRenderer } from "3d-tiles-renderer/three";
import { GoogleCloudAuthPlugin } from "3d-tiles-renderer/plugins";

// -----------------------------------------------------------------------------
// The CONTRACT this feature rests on, pinned against the REAL installed
// 3d-tiles-renderer (0.5.2) — Task 12b review finding 4.
//
// GoogleTilesStage.test.tsx dispatches a hand-written `load-error` payload at a
// fake tiles object. That proves our handler branches and logs once; it cannot
// prove the claim the whole invalid-key story rests on, which belongs to the
// LIBRARY:
//
//   an invalid / mistyped / revoked / restricted / over-quota key makes Google
//   answer the ROOT tileset request with a JSON error body, GoogleCloudAuth
//   dereferences `json.root.content` on it inside a `.then` — asynchronously —
//   and TilesRendererBase.update()'s own `.catch` converts that rejection into
//   a `load-error` event with `tile: null` instead of letting it escape as an
//   unhandled rejection (TilesRendererBase.js:790-836).
//
// Nothing in this repo used to notice if that stopped being true. A library
// bump that drops that `.catch`, or that starts pre-creating a session token
// (flipping the `isMapTilesSession` / token path so the root request is no
// longer the key-carrying one), would silently regress the hero to "phase stuck
// at loading forever, no diagnostic" — the exact failure the report lists as
// its own uncovered case 2. This file is that regression gate: no browser, no
// network, no secret — the real renderer and the real auth plugin, with only
// `fetch` stubbed to answer the way Google actually answers.
//
// It drives `TilesRenderer` from `3d-tiles-renderer/three` — the same concrete
// class GoogleTilesStage receives through the r3f wrapper — deliberately, and
// not `TilesRendererBase` from `/core`: the base class declares
// `dispatchEvent( e ) {}` and `addEventListener( name, callback ) {}` as
// no-op stubs (TilesRendererBase.js:1099-1106) and leaves the event surface to
// its subclasses, so a base instance accepts a listener and then silently
// never calls it. `update()` loads the root tileset before it looks at cameras
// (TilesRenderer.js:569-584 — `super.update()` first, and the "no cameras
// defined" warning is gated on `this.root`, still null while the root request
// is in flight), which is why no camera, canvas or WebGL context is needed
// here.
//
// The 400 body below is the verified real one, confirmed against the live
// service (GET https://tile.googleapis.com/v1/3dtiles/root.json?key=<invalid>
// → HTTP 400, content-type: application/json). See task-12b-report.md §1.
// -----------------------------------------------------------------------------

const INVALID_KEY = "AIza-invalid-test-key";

/** Google's real answer to a rejected key. */
const API_KEY_INVALID_BODY = {
  error: {
    code: 400,
    message: "API key not valid. Please pass a valid API key.",
    status: "INVALID_ARGUMENT",
    details: [{ reason: "API_KEY_INVALID" }],
  },
};

interface LoadErrorEvent {
  readonly tile: Tile | null;
  readonly error: Error;
  readonly url: string | URL;
}

/** Every URL the library actually fetched, in order. */
let requested: string[] = [];

function stubFetch(respond: () => Promise<Response>): void {
  vi.stubGlobal("fetch", (input: URL | string): Promise<Response> => {
    requested.push(String(input));
    return respond();
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Drives one root-tileset load to completion and returns every `load-error`
 * the real renderer dispatched. `update()` is asserted not to throw
 * SYNCHRONOUSLY here rather than in each test: an error boundary could only
 * ever see a synchronous throw, and the fact that there is never one is why
 * this failure is armored by an event subscription and not by a boundary.
 */
async function loadRoot(): Promise<readonly LoadErrorEvent[]> {
  const events: LoadErrorEvent[] = [];
  const tiles = new TilesRenderer();
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: INVALID_KEY }));
  tiles.addEventListener("load-error", (event) => {
    events.push(event);
  });

  expect(() => {
    tiles.update();
  }).not.toThrow();

  // Bounded wait rather than a fixed tick count: the chain is fetch → .json()
  // → the library's own .catch, and a timer-quantised Windows runner should
  // not be able to turn "the library stopped catching" into a flake either
  // way. The extra turn after the loop is what lets Node raise
  // `unhandledRejection` for anything the library failed to catch — it fires
  // at the end of the turn in which the rejection went unhandled.
  for (let turn = 0; turn < 50 && events.length === 0; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  tiles.dispose();
  return events;
}

describe("3d-tiles-renderer auth-failure contract (real library, stubbed fetch)", () => {
  let restoreConsole: () => void;
  let unhandled: unknown[];
  let onUnhandled: (reason: unknown) => void;

  beforeEach(() => {
    requested = [];
    // TilesRendererBase.js:825 does its own console.error(error) immediately
    // before dispatching load-error — the very line that made this failure
    // look like an uncaught crash. Silenced here so a passing run is quiet;
    // it is noise, not the assertion.
    const original = console.error.bind(console);
    console.error = (): void => {
      /* swallowed on purpose */
    };
    restoreConsole = () => {
      console.error = original;
    };

    unhandled = [];
    onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
  });

  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    restoreConsole();
    vi.unstubAllGlobals();
  });

  it("turns Google's 400 API_KEY_INVALID into ONE load-error with tile null, never an escaped rejection", async () => {
    stubFetch(() => Promise.resolve(jsonResponse(400, API_KEY_INVALID_BODY)));

    const events = await loadRoot();

    // Exactly one, so GoogleTilesStage's once-per-mount guard is guarding a
    // real single event rather than papering over a storm.
    expect(events).toHaveLength(1);
    const event = events[0];
    if (event === undefined) throw new Error("expected a load-error event");
    // `tile === null` is what the diagnostic branches on to decide whether it
    // may blame the API key. If a library bump stopped setting it, the hero
    // would start telling developers that a failed TILE was a bad key.
    expect(event.tile).toBeNull();
    expect(event.error).toBeInstanceOf(Error);
    // The rejection never escaped: this is why no unhandledrejection listener
    // and no error boundary is — or could be — the armor for this failure.
    expect(unhandled).toEqual([]);
  });

  it("produces the exact error shape GoogleTilesStage.test.tsx's ROOT_AUTH_FAILURE fixture models", async () => {
    stubFetch(() => Promise.resolve(jsonResponse(400, API_KEY_INVALID_BODY)));

    const events = await loadRoot();
    const event = events[0];
    if (event === undefined) throw new Error("expected a load-error event");

    // The unit test's fixture is a hand-written TypeError. This is the line
    // that keeps it honest: the real library really does dereference
    // `tile.content` on an undefined root (GoogleCloudAuth.js:105-115 →
    // getSessionToken → TraversalUtils.traverseSet) rather than, say,
    // reporting the HTTP status. If that ever changes, the fixture — and the
    // diagnostic wording calling that TypeError "a symptom, not the cause" —
    // must change with it.
    expect(event.error.name).toBe("TypeError");
    expect(event.error.message).toContain("content");
  });

  it("sends the API key on the ROOT request itself — no session token is pre-created", async () => {
    stubFetch(() => Promise.resolve(jsonResponse(400, API_KEY_INVALID_BODY)));

    await loadRoot();

    // One request, not two. With sessionOptions null the plugin is NOT in a
    // Map-Tiles session, so it never POSTs to createSession first: the root
    // tileset request is the one carrying `key`, which is precisely why the
    // diagnostic may name VITE_GOOGLE_MAPS_TILES_KEY when `tile === null` and
    // must not when a single tile fails. A bump that pre-creates a session
    // moves the key failure off this event entirely.
    expect(requested).toHaveLength(1);
    const url = requested[0];
    if (url === undefined) throw new Error("expected one fetch");
    expect(url).toContain("tile.googleapis.com/v1/3dtiles/root.json");
    expect(new URL(url).searchParams.get("key")).toBe(INVALID_KEY);
  });

  it("also contains a non-JSON error page (502 HTML) as one load-error", async () => {
    // A proxy/CDN error page is the other realistic failure body: res.json()
    // rejects with a SyntaxError instead of the TypeError above. Same
    // containment, different error — proving it is the .catch that contains
    // this, not something specific to the session-token code path.
    stubFetch(() =>
      Promise.resolve(
        new Response("<html><body>502 Bad Gateway</body></html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    const events = await loadRoot();

    expect(events).toHaveLength(1);
    expect(events[0]?.tile).toBeNull();
    expect(unhandled).toEqual([]);
  });

  it("also contains a network-level fetch rejection (offline / CSP / DNS)", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));

    const events = await loadRoot();

    expect(events).toHaveLength(1);
    expect(events[0]?.tile).toBeNull();
    expect(unhandled).toEqual([]);
  });
});
