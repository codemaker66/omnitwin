import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __handleFrameForTests,
  __resetConversationCursorForTests,
  conversationCursor,
  requestsLiveListenerCount,
  subscribeRequestsLive,
  type RequestsLiveEvent,
} from "../requests-live.js";
import { __resetClockForTests, clockSampleCount } from "../clock-offset.js";

vi.mock("../../api/client.js", () => ({ getAuthToken: () => Promise.resolve("token-1") }));

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

/** A socket that opens when told to and records what it was sent. */
class RecordingSocket {
  static latest: RecordingSocket | null = null;
  static readonly OPEN = 1;
  readyState = 0;
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    RecordingSocket.latest = this;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  send(text: string): void { this.sent.push(text); }
  close(): void { this.readyState = 3; }
}

describe("the requests live channel", () => {
  it("authenticates as a listener, so its person is not counted on the Diary", async () => {
    vi.stubGlobal("WebSocket", RecordingSocket);
    const unsubscribe = subscribeRequestsLive(vi.fn());
    try {
      const socket = RecordingSocket.latest;
      if (socket === null) throw new Error("The channel should have opened a socket");
      socket.open();
      await vi.waitFor(() => { expect(socket.sent.length).toBeGreaterThan(0); });
      expect(JSON.parse(socket.sent[0] ?? "{}")).toEqual({ type: "auth", token: "token-1", presence: false });
    } finally {
      // The channel is module state: close it even when the case fails, so
      // the next case starts with no listener and no socket.
      unsubscribe();
    }
  });

  it("opens no socket under the E2E harness, and still accepts listeners", () => {
    (window as E2EWindow).__OMNITWIN_E2E__ = true;
    const unsubscribe = subscribeRequestsLive(vi.fn());
    expect(requestsLiveListenerCount()).toBe(1);
    expect(InertSocket.instances).toBe(0);
    unsubscribe();
    expect(requestsLiveListenerCount()).toBe(0);
  });

  it("announces a conversation frame, feeds the clock, and resumes from the last cursor on the next auth", async () => {
    vi.stubGlobal("WebSocket", RecordingSocket);
    __resetConversationCursorForTests();
    __resetClockForTests();
    const UUID = "00000000-0000-4000-8000-00000000f001";
    const heard: RequestsLiveEvent[] = [];
    const unsubscribe = subscribeRequestsLive((event) => { heard.push(event); });
    try {
      const socket = RecordingSocket.latest;
      if (socket === null) throw new Error("The channel should have opened a socket");
      socket.open();
      await vi.waitFor(() => { expect(socket.sent.length).toBeGreaterThan(0); });
      // A fresh app asks for no replay: it has no cursor yet.
      expect(JSON.parse(socket.sent[0] ?? "{}")).toEqual({ type: "auth", token: "token-1", presence: false });

      __handleFrameForTests(JSON.stringify({
        type: "conversation.event", venueId: UUID, kind: "message.sent", threadId: UUID, audience: "staff-private",
        subject: "booking", bookingId: UUID, eventId: null, requestId: null, messageId: UUID, cursor: 42,
        actorUserId: null, at: "2026-10-08T15:00:00.000Z", serverNowMs: Date.now() + 5_000,
      }));
      expect(heard.some((event) => event.kind === "conversation" && event.event.cursor === 42)).toBe(true);
      expect(conversationCursor()).toBe(42);
      expect(clockSampleCount()).toBe(1);

      __handleFrameForTests(JSON.stringify({ type: "conversation.caughtUp", cursor: 50, serverNowMs: Date.now() }));
      expect(heard.some((event) => event.kind === "caughtUp" && event.cursor === 50)).toBe(true);
      expect(conversationCursor()).toBe(50);
      expect(clockSampleCount()).toBe(2);
    } finally {
      unsubscribe();
    }

    // The next socket asks the server to replay everything after 50.
    const again = subscribeRequestsLive(vi.fn());
    try {
      const socket = RecordingSocket.latest;
      if (socket === null) throw new Error("The channel should have opened a second socket");
      socket.open();
      await vi.waitFor(() => { expect(socket.sent.length).toBeGreaterThan(0); });
      expect(JSON.parse(socket.sent[0] ?? "{}")).toEqual({ type: "auth", token: "token-1", presence: false, afterCursor: 50 });
    } finally {
      again();
      __resetConversationCursorForTests();
      __resetClockForTests();
    }
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
