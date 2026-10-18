import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { _resetTokenGetterForTests, setTokenGetter } from "../../../../api/auth-bridge.js";
import { nextBackoffMs } from "../../lib/live-protocol.js";
import { useDiaryLive } from "../useDiaryLive.js";

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
  close(): void { this.closedByHook = true; this.readyState = FakeSocket.CLOSED; }
  /** The server accepted the connection. */
  open(): void { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
  /** The line dropped. */
  drop(): void { this.readyState = FakeSocket.CLOSED; this.onclose?.(); }
}

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

  it("closes the socket and sends no auth frame when no token is available", async () => {
    setTokenGetter(() => Promise.resolve(null));
    renderHook(() => useDiaryLive(true, () => undefined, { device: "phone" }));
    const socket = FakeSocket.instances[0];
    if (socket === undefined) throw new Error("no socket opened");
    act(() => { socket.open(); });
    await flush();
    expect(socket.sent).toEqual([]);
    expect(socket.closedByHook).toBe(true);
  });
});
