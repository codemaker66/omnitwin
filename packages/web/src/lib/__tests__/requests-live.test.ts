import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestsLiveListenerCount, subscribeRequestsLive } from "../requests-live.js";

// ---------------------------------------------------------------------------
// The requests live channel — when it may open a socket at all.
//
// Written after CI caught the answer being wrong. The provider mounts above
// the router, so this channel is asked for on EVERY signed-in page. Under the
// E2E harness there is no websocket server behind the mocked API, and a
// refused handshake is a console error the BROWSER writes — no `catch` can
// swallow it, and the accessibility audit rightly refuses to ignore it. It
// failed 29 tests across two shards, on surfaces with nothing to do with
// requests.
//
// So: listeners still register and the snapshot is still fetched, but no
// socket is opened under the harness. The live path is proved against a real
// server instead, which is the only place it means anything.
// ---------------------------------------------------------------------------

interface E2EWindow extends Window {
  __OMNITWIN_E2E__?: boolean;
}

/** A socket that never opens, connects or errors: we only count construction. */
class InertSocket {
  static instances = 0;
  readonly readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    InertSocket.instances += 1;
  }
  addEventListener(): void { /* the channel uses handler properties */ }
  send(): void { /* never reached in these tests */ }
  close(): void { /* never reached in these tests */ }
}

beforeEach(() => {
  InertSocket.instances = 0;
  // `vi.stubGlobal` is the house way to swap a global in a test: it takes the
  // replacement as `unknown`, so no cast is needed, and `unstubAllGlobals`
  // puts the real constructor back.
  vi.stubGlobal("WebSocket", InertSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as E2EWindow).__OMNITWIN_E2E__;
});

describe("the requests live channel", () => {
  it("opens no socket under the E2E harness, and still accepts listeners", () => {
    (window as E2EWindow).__OMNITWIN_E2E__ = true;
    const unsubscribe = subscribeRequestsLive(vi.fn());
    expect(requestsLiveListenerCount()).toBe(1);
    expect(InertSocket.instances).toBe(0);
    unsubscribe();
    expect(requestsLiveListenerCount()).toBe(0);
  });

  it("opens exactly one socket for any number of surfaces, outside the harness", () => {
    const first = subscribeRequestsLive(vi.fn());
    const second = subscribeRequestsLive(vi.fn());
    expect(requestsLiveListenerCount()).toBe(2);
    // One socket for the venue, however many slabs and counters are on screen.
    expect(InertSocket.instances).toBe(1);
    first();
    second();
    expect(requestsLiveListenerCount()).toBe(0);
  });
});
