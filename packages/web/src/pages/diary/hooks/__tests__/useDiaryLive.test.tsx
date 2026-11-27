import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { _resetTokenGetterForTests, setTokenGetter } from "../../../../api/auth-bridge.js";
import { nextBackoffMs } from "../../lib/live-protocol.js";
import { useDiaryLive, type DiaryLiveRefresh } from "../useDiaryLive.js";

// Token refresh over a long shift (goal 19 S8 item 14): a wall or a phone
// that drops its socket at 03:00 reconnects with the token Clerk holds NOW,
// never the one it signed in with at 15:00. An unavailable token closes the
// socket and backs off; it never sends an auth frame with nothing in it.

class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = FakeSocket.CONNECTING;
  readonly sent: string[] = [];
  closedByHook = false;
  onopen: (() => void) | null = null;
  onmessage: ((frame: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { FakeSocket.instances.push(this); }
  send(data: string): void { this.sent.push(data); }
  /** As a browser does: close() is answered by onclose on a later tick. */
  close(): void { this.closedByHook = true; this.readyState = FakeSocket.CLOSED; queueMicrotask(() => { this.onclose?.(); }); }
  /** The server accepted the connection. */
  open(): void { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
  /** The line dropped. */
  drop(): void { this.readyState = FakeSocket.CLOSED; this.onclose?.(); }
  /** A frame from the server. */
  receive(frame: object): void { this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) })); }
}

const HELLO = { type: "hello", venueId: "venue-a", presence: [], serverNowMs: Date.parse("2026-10-24T18:04:00Z") };

const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const authFrames = (socket: FakeSocket): unknown[] => socket.sent.map((raw) => JSON.parse(raw) as { type: string }).filter((frame) => frame.type === "auth");

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _resetTokenGetterForTests();
});

describe("useDiaryLive over a long shift", () => {
  it("asks for a fresh token on every reconnect and sends it in the auth frame", async () => {
    const tokens = ["t1", "t2"];
    const getToken = vi.fn(() => Promise.resolve(tokens.shift() ?? null));
    setTokenGetter(getToken);
    renderHook(() => useDiaryLive(true, () => undefined, { device: "wall" }));

    const first = FakeSocket.instances[0];
    if (first === undefined) throw new Error("no socket opened");
    act(() => { first.open(); });
    await flush();
    expect(authFrames(first)).toEqual([{ type: "auth", token: "t1", device: "wall" }]);

    act(() => { first.drop(); });
    act(() => { vi.advanceTimersByTime(nextBackoffMs(0) + 1); });
    const second = FakeSocket.instances[1];
    if (second === undefined) throw new Error("no reconnect");
    act(() => { second.open(); });
    await flush();
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(authFrames(second)).toEqual([{ type: "auth", token: "t2", device: "wall" }]);
  });

  it("closes the socket and sends no auth frame when no token is available, then backs off and asks again", async () => {
    const getToken = vi.fn(() => Promise.resolve(null));
    setTokenGetter(getToken);
    renderHook(() => useDiaryLive(true, () => undefined, { device: "phone" }));
    const socket = FakeSocket.instances[0];
    if (socket === undefined) throw new Error("no socket opened");
    act(() => { socket.open(); });
    await flush();
    expect(socket.sent).toEqual([]);
    expect(socket.closedByHook).toBe(true);
    // Not a tight loop: the next socket waits for the backoff.
    expect(FakeSocket.instances).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(nextBackoffMs(0) - 1); });
    expect(FakeSocket.instances).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(2); });
    expect(FakeSocket.instances).toHaveLength(2);
    const again = FakeSocket.instances[1];
    if (again === undefined) throw new Error("no reconnect");
    act(() => { again.open(); });
    await flush();
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(again.sent).toEqual([]);
  });
});

// hallkeeper-web-4: the server starts sending a socket the Diary's changes
// only when it joins, just before its hello. A change committed after the
// page's own read and before that join is never sent, so every hello, the
// first included, reads again; and the board says Live only once that read
// is in, never on the strength of an older one.
describe("useDiaryLive and what was committed before it subscribed", () => {
  /** The venue's diary on the server, and the page's copy of it. */
  function venue(): {
    committed: string;
    shown: string | null;
    readonly reads: { readonly land: () => void; readonly fail: () => void }[];
    readonly read: () => Promise<void>;
  } {
    const state = {
      committed: "Robert Adam Room dinner at 19:00",
      shown: null as string | null,
      reads: [] as { readonly land: () => void; readonly fail: () => void }[],
      read: (): Promise<void> => new Promise<void>((resolve, reject) => {
        state.reads.push({
          land: () => { state.shown = state.committed; resolve(); },
          fail: () => { reject(new Error("Offline")); },
        });
      }),
    };
    return state;
  }

  it("reads again on the first hello, and says Live only once that read is in", async () => {
    setTokenGetter(() => Promise.resolve("t1"));
    const diary = venue();
    // 18:02: the page's own read lands.
    diary.shown = diary.committed;
    const { result } = renderHook(() => useDiaryLive(true, diary.read, { device: "wall" }));
    const socket = FakeSocket.instances[0];
    if (socket === undefined) throw new Error("no socket opened");

    // 18:03: the office moves the dinner while the socket is still connecting.
    diary.committed = "Robert Adam Room dinner at 18:30";
    act(() => { socket.open(); });
    await flush();
    act(() => { socket.receive(HELLO); });

    expect(diary.reads).toHaveLength(1);
    expect(result.current.connected).toBe(false);

    await act(async () => { diary.reads[0]?.land(); await Promise.resolve(); });
    expect(diary.shown).toBe("Robert Adam Room dinner at 18:30");
    expect(result.current.connected).toBe(true);
  });

  it("reads again on every later hello too, and says Live once each read is in", async () => {
    setTokenGetter(() => Promise.resolve("t1"));
    const diary = venue();
    const read = vi.fn((_why: DiaryLiveRefresh) => diary.read());
    const { result } = renderHook(() => useDiaryLive(true, read));
    const first = FakeSocket.instances[0];
    if (first === undefined) throw new Error("no socket opened");
    act(() => { first.open(); });
    await flush();
    act(() => { first.receive(HELLO); });
    await act(async () => { diary.reads[0]?.land(); await Promise.resolve(); });
    expect(result.current.connected).toBe(true);

    act(() => { first.drop(); });
    expect(result.current.connected).toBe(false);
    diary.committed = "Robert Adam Room dinner at 18:30";
    act(() => { vi.advanceTimersByTime(nextBackoffMs(0) + 1); });
    const second = FakeSocket.instances[1];
    if (second === undefined) throw new Error("no reconnect");
    act(() => { second.open(); });
    await flush();
    act(() => { second.receive(HELLO); });
    expect(diary.reads).toHaveLength(2);
    expect(result.current.connected).toBe(false);
    await act(async () => { diary.reads[1]?.land(); await Promise.resolve(); });
    expect(diary.shown).toBe("Robert Adam Room dinner at 18:30");
    expect(result.current.connected).toBe(true);
    // A colleague's change reads again too; the page is told why each time.
    act(() => { second.receive({ type: "diary.event", kind: "booking.updated", bookingId: "b1", actorUserId: null, at: "2026-10-24T18:05:00Z" }); });
    expect(read.mock.calls.map(([why]) => why)).toEqual(["joined", "rejoined", "changed"]);
  });

  it("never says Live for a socket that dropped before its read came in", async () => {
    setTokenGetter(() => Promise.resolve("t1"));
    const diary = venue();
    const { result } = renderHook(() => useDiaryLive(true, diary.read));
    const socket = FakeSocket.instances[0];
    if (socket === undefined) throw new Error("no socket opened");
    act(() => { socket.open(); });
    await flush();
    act(() => { socket.receive(HELLO); });
    act(() => { socket.drop(); });
    await act(async () => { diary.reads[0]?.land(); await Promise.resolve(); });
    expect(result.current.connected).toBe(false);
  });

  it("says Live once a read that failed has ended: the socket is up, and the page says its read failed", async () => {
    setTokenGetter(() => Promise.resolve("t1"));
    const diary = venue();
    const { result } = renderHook(() => useDiaryLive(true, diary.read));
    const socket = FakeSocket.instances[0];
    if (socket === undefined) throw new Error("no socket opened");
    act(() => { socket.open(); });
    await flush();
    act(() => { socket.receive(HELLO); });
    expect(result.current.connected).toBe(false);
    await act(async () => { diary.reads[0]?.fail(); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.connected).toBe(true);
  });

  it("asks a page that cannot say when its read lands to read again on the first hello, and says Live at once", async () => {
    setTokenGetter(() => Promise.resolve("t1"));
    const onEvent = vi.fn();
    const { result } = renderHook(() => useDiaryLive(true, onEvent));
    const socket = FakeSocket.instances[0];
    if (socket === undefined) throw new Error("no socket opened");
    act(() => { socket.open(); });
    await flush();
    act(() => { socket.receive(HELLO); });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith("joined");
    expect(result.current.connected).toBe(true);
  });
});
