import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveOp } from "@omnitwin/types";
import type { Configuration, PlacedObject } from "../../../api/configurations.js";
import { placedObjectToEditor, setEditorLiveHooks, useEditorStore, type EditorObject } from "../../../stores/editor-store.js";
import { useLayoutLiveStore } from "../../../stores/layout-live-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { LIVE_SEND_INTERVAL_MS, LayoutLiveClient, type LiveSocket } from "../live-client.js";
import { editorToLiveState } from "../live-document.js";
import { decomposeSceneItems, editorToPlacedItem } from "../../../components/editor/EditorBridge.js";

// ---------------------------------------------------------------------------
// Live co-editing v1 — the client of the live room, driven by a scripted
// socket and fake timers: joining resyncs, local edits leave as coalesced
// ops, a peer's later write on an object this person touched yields it and
// says so, a commit announcement refetches, and a lost room resyncs.
// ---------------------------------------------------------------------------

vi.mock("../../../api/spaces.js", () => ({
  getSpace: vi.fn(async () => Promise.reject(new Error("no space in tests"))),
}));
vi.mock("../../../api/action-log.js", () => ({
  postActionBatch: vi.fn(() => Promise.resolve({ accepted: 0, duplicates: 0 })),
}));

const CONFIG = "00000000-0000-4000-8000-00000000c0f1";
const SPACE = "00000000-0000-4000-8000-000000000051";
const VENUE = "00000000-0000-4000-8000-0000000000a1";
/** The catalogue's 6ft round table, so notices read "this table". */
const ROUND_TABLE = "a1ef4d89-7786-5878-bee1-87b3fac28200";
const T1 = "00000000-0000-4000-8000-000000000001";
const T2 = "00000000-0000-4000-8000-000000000002";
const T3 = "00000000-0000-4000-8000-000000000003";

function wire(id: string, positionX: number): PlacedObject {
  return {
    id, configurationId: CONFIG, assetDefinitionId: ROUND_TABLE,
    positionX: String(positionX), positionY: "0", positionZ: "1",
    rotationX: "0", rotationY: "0", rotationZ: "0", scale: "1", sortOrder: 0, metadata: null,
  };
}

function editor(id: string, positionX: number): EditorObject {
  return placedObjectToEditor(wire(id, positionX));
}

function config(revision: number, objects: readonly PlacedObject[]): Configuration {
  return {
    id: CONFIG, spaceId: SPACE, venueId: VENUE, userId: null, name: "Duncan wedding",
    isPublicPreview: false, revision, objects: [...objects],
  };
}

class ScriptedSocket implements LiveSocket {
  readyState = 0;
  readonly sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string): void { this.sent.push(JSON.parse(data) as Record<string, unknown>); }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(frame: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify({ serverNowMs: 1_700_000_000_000, ...frame }) });
  }
  ofType(type: string): Record<string, unknown>[] {
    return this.sent.filter((frame) => frame["type"] === type);
  }
}

const ME = { connectionId: "c-me", userId: "u-me", name: "Blake Example", role: "staff", view: null, joinedAtMs: 1 };
const ALEX = { connectionId: "c-alex", userId: "u-alex", name: "Alex Murray", role: "staff", view: null, joinedAtMs: 2 };

function put(object: EditorObject): LiveOp {
  return { kind: "put", object: editorToLiveState(object) };
}

interface Harness {
  readonly client: LayoutLiveClient;
  readonly sockets: ScriptedSocket[];
  readonly fetchConfig: ReturnType<typeof vi.fn<(id: string) => Promise<Configuration>>>;
  readonly others: number[];
}

function harness(): Harness {
  const sockets: ScriptedSocket[] = [];
  const others: number[] = [];
  const fetchConfig = vi.fn<(id: string) => Promise<Configuration>>(() => Promise.resolve(config(2, [wire(T1, 1), wire(T2, 2), wire(T3, 3)])));
  const client = new LayoutLiveClient({
    configId: CONFIG,
    url: "ws://test/ws/configurations/x",
    openSocket: () => {
      const socket = new ScriptedSocket();
      sockets.push(socket);
      return socket;
    },
    getToken: () => Promise.resolve("token"),
    fetchConfig,
    onCoEditorsChanged: (count) => { others.push(count); },
    now: () => Date.now(),
  });
  return { client, sockets, fetchConfig, others };
}

async function joined(h: Harness): Promise<ScriptedSocket> {
  h.client.start();
  const socket = h.sockets.at(-1);
  if (socket === undefined) throw new Error("no socket");
  socket.open();
  await vi.advanceTimersByTimeAsync(0);
  socket.receive({ type: "authenticated" });
  socket.receive({ type: "live.hello", connectionId: "c-me", participants: [ME, ALEX], seq: 0 });
  await vi.advanceTimersByTimeAsync(0);
  return socket;
}

const BASE = [editor(T1, 1), editor(T2, 2), editor(T3, 3)];

beforeEach(() => {
  vi.useFakeTimers();
  useEditorStore.getState().reset();
  useEditorStore.setState({
    configId: CONFIG, configRevision: 2, isPublicPreview: false,
    objects: BASE, baseObjects: BASE, isDirty: false, isSaving: false,
    history: { past: [], future: [] },
  });
  useLayoutLiveStore.getState().resetLive();
  useSelectionStore.getState().clearSelection();
});

afterEach(() => {
  setEditorLiveHooks(null);
  vi.useRealTimers();
});

describe("joining the room", () => {
  it("authenticates, goes live, counts the others and resyncs from the server", async () => {
    const h = harness();
    const socket = await joined(h);
    expect(socket.ofType("auth")).toEqual([{ type: "auth", token: "token" }]);
    expect(useLayoutLiveStore.getState().status).toBe("live");
    expect(h.others.at(-1)).toBe(1);
    expect(h.fetchConfig).toHaveBeenCalledWith(CONFIG);
    h.client.stop();
  });

  it("stays out of sight when the server never admits this person", async () => {
    const h = harness();
    h.client.start();
    const socket = h.sockets[0];
    socket?.open();
    await vi.advanceTimersByTimeAsync(0);
    socket?.receive({ type: "authenticated" });
    expect(useLayoutLiveStore.getState().status).toBe("connecting");
    useEditorStore.getState().updateObject(T1, { positionX: 9 });
    await vi.advanceTimersByTimeAsync(LIVE_SEND_INTERVAL_MS * 2);
    expect(socket?.ofType("live.ops")).toEqual([]);
    h.client.stop();
  });
});

describe("outgoing", () => {
  it("sends a gesture's first change at once and coalesces the rest per interval", async () => {
    const h = harness();
    const socket = await joined(h);
    for (let x = 1; x <= 5; x += 1) useEditorStore.getState().updateObject(T1, { positionX: x + 0.5 });
    const positionsSent = (): number[] => socket.ofType("live.ops").map((frame) =>
      (frame["ops"] as { object: { positionX: number } }[])[0]?.object.positionX ?? Number.NaN);
    expect(positionsSent()).toEqual([1.5]);
    await vi.advanceTimersByTimeAsync(LIVE_SEND_INTERVAL_MS);
    expect(positionsSent()).toEqual([1.5, 5.5]);
    // Each frame carries one op per object: the latest state, not the path.
    expect((socket.ofType("live.ops")[1]?.["ops"] as unknown[]).length).toBe(1);
    h.client.stop();
  });

  it("announces the server ids a save gave this person's new placements", async () => {
    const h = harness();
    const socket = await joined(h);
    socket.sent.length = 0;
    // The store calls onSaved after a committed save; drive the registered hook.
    captureHooks()?.onSaved(5, new Map([["local-1", T3]]));
    expect(socket.ofType("live.saved")).toEqual([{ type: "live.saved", revision: 5, ids: [["local-1", T3]] }]);
    h.client.stop();
  });

  it("sends ops still queued under a local id under the server id the save gave it", async () => {
    const h = harness();
    const socket = await joined(h);
    useEditorStore.getState().addObject(ROUND_TABLE, 1, 0, 1);
    const localId = useEditorStore.getState().objects.find((o) => o.id.startsWith("local-"))?.id ?? "";
    // The placement left at once; a nudge inside the interval is still queued
    // under the local id when the save lands.
    useEditorStore.getState().updateObject(localId, { positionX: 2 });
    socket.sent.length = 0;
    captureHooks()?.onSaved(5, new Map([[localId, T3]]));
    const sentIds = socket.ofType("live.ops").flatMap((frame) =>
      (frame["ops"] as { kind: string; object: { id: string } }[]).map((op) => op.object.id));
    expect(sentIds).toEqual([T3]);
    expect(socket.sent.map((frame) => frame["type"])).toEqual(["live.ops", "live.saved"]);
    h.client.stop();
  });
});

// The live client registers its hooks through setEditorLiveHooks; capture the
// most recent registration by wrapping it once for the suite.
let lastHooks: Parameters<typeof setEditorLiveHooks>[0] = null;
vi.mock("../../../stores/editor-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../stores/editor-store.js")>();
  return {
    ...actual,
    setEditorLiveHooks: (hooks: Parameters<typeof actual.setEditorLiveHooks>[0]) => {
      lastHooks = hooks;
      actual.setEditorLiveHooks(hooks);
    },
  };
});
function captureHooks(): Parameters<typeof setEditorLiveHooks>[0] {
  return lastHooks;
}

describe("incoming", () => {
  it("draws a peer's move on an untouched object without touching the document", async () => {
    const h = harness();
    const socket = await joined(h);
    socket.receive({ type: "live.ops", seq: 1, connectionId: "c-alex", userId: "u-alex", name: "Alex Murray", ops: [put(editor(T2, 8))] });
    expect(useLayoutLiveStore.getState().overlay.get(T2)?.state?.positionX).toBe(8);
    expect(useEditorStore.getState().objects.find((o) => o.id === T2)?.positionX).toBe(2);
    expect(useLayoutLiveStore.getState().notice).toBeNull();
    h.client.stop();
  });

  it("yields an object this person changed when a later write lands on it, and says who", async () => {
    const h = harness();
    const socket = await joined(h);
    useEditorStore.getState().updateObject(T1, { positionX: 5 });
    await vi.advanceTimersByTimeAsync(LIVE_SEND_INTERVAL_MS);
    // My op is echoed first (seq 1), so Alex's (seq 2) is the later write.
    socket.receive({ type: "live.ops", seq: 1, connectionId: "c-me", userId: "u-me", name: "Blake Example", ops: [put(editor(T1, 5))] });
    socket.receive({ type: "live.ops", seq: 2, connectionId: "c-alex", userId: "u-alex", name: "Alex Murray", ops: [put(editor(T1, 8))] });
    expect(useEditorStore.getState().objects.find((o) => o.id === T1)?.positionX).toBe(1);
    expect(useLayoutLiveStore.getState().overlay.get(T1)?.state?.positionX).toBe(8);
    expect(useLayoutLiveStore.getState().notice?.text).toBe("Alex moved this table");
    h.client.stop();
  });

  it("ignores a peer's earlier write on an object whose op of mine is still in flight", async () => {
    const h = harness();
    const socket = await joined(h);
    useEditorStore.getState().updateObject(T1, { positionX: 5 });
    await vi.advanceTimersByTimeAsync(LIVE_SEND_INTERVAL_MS);
    // Alex's op was sequenced before mine (it arrives before my echo).
    socket.receive({ type: "live.ops", seq: 1, connectionId: "c-alex", userId: "u-alex", name: "Alex Murray", ops: [put(editor(T1, 8))] });
    expect(useLayoutLiveStore.getState().overlay.has(T1)).toBe(false);
    expect(useEditorStore.getState().objects.find((o) => o.id === T1)?.positionX).toBe(5);
    h.client.stop();
  });

  it("refetches and adopts when a newer commit is announced, retiring what it reflects", async () => {
    const h = harness();
    const socket = await joined(h);
    socket.receive({ type: "live.ops", seq: 1, connectionId: "c-alex", userId: "u-alex", name: "Alex Murray", ops: [put(editor(T2, 8))] });
    h.fetchConfig.mockResolvedValueOnce(config(3, [wire(T1, 1), wire(T2, 8), wire(T3, 3)]));
    socket.receive({ type: "layout.changed", revision: 3, actorUserId: "u-alex" });
    await vi.advanceTimersByTimeAsync(0);
    expect(useEditorStore.getState().configRevision).toBe(3);
    expect(useEditorStore.getState().objects.find((o) => o.id === T2)?.positionX).toBe(8);
    expect(useLayoutLiveStore.getState().overlay.size).toBe(0);
    h.client.stop();
  });

  it("ignores an announcement of the revision it already holds", async () => {
    const h = harness();
    const socket = await joined(h);
    h.fetchConfig.mockClear();
    socket.receive({ type: "layout.changed", revision: 2, actorUserId: "u-me" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchConfig).not.toHaveBeenCalled();
    h.client.stop();
  });

  it("returns to the server's truth when a peer's op is never committed", async () => {
    const h = harness();
    const socket = await joined(h);
    socket.receive({ type: "live.ops", seq: 1, connectionId: "c-alex", userId: "u-alex", name: "Alex Murray", ops: [put(editor(T2, 8))] });
    await vi.advanceTimersByTimeAsync(16_500);
    expect(useLayoutLiveStore.getState().overlay.size).toBe(0);
    h.client.stop();
  });
});

describe("access and heartbeat", () => {
  it("leaves the room for good when the server revokes access", async () => {
    const h = harness();
    const socket = await joined(h);
    socket.receive({ type: "live.ops", seq: 1, connectionId: "c-alex", userId: "u-alex", name: "Alex Murray", ops: [put(editor(T2, 8))] });
    socket.receive({ type: "live.revoked" });
    expect(useLayoutLiveStore.getState().status).toBe("off");
    expect(useLayoutLiveStore.getState().overlay.size).toBe(0);
    expect(h.others.at(-1)).toBe(0);
    socket.sent.length = 0;
    useEditorStore.getState().updateObject(T1, { positionX: 9 });
    await vi.advanceTimersByTimeAsync(LIVE_SEND_INTERVAL_MS * 2);
    expect(socket.ofType("live.ops")).toEqual([]);
    h.client.stop();
  });

  it("answers the server's heartbeat", async () => {
    const h = harness();
    const socket = await joined(h);
    socket.sent.length = 0;
    socket.receive({ type: "ping" });
    expect(socket.ofType("ping")).toHaveLength(1);
    h.client.stop();
  });
});

describe("losing the room", () => {
  it("clears what it saw, shows reconnecting, and resyncs on return", async () => {
    const h = harness();
    const socket = await joined(h);
    socket.receive({ type: "live.ops", seq: 1, connectionId: "c-alex", userId: "u-alex", name: "Alex Murray", ops: [put(editor(T2, 8))] });
    socket.close();
    expect(useLayoutLiveStore.getState().status).toBe("reconnecting");
    expect(useLayoutLiveStore.getState().overlay.size).toBe(0);
    expect(h.others.at(-1)).toBe(0);

    await vi.advanceTimersByTimeAsync(1_000);
    const again = h.sockets[1];
    expect(again).toBeDefined();
    h.fetchConfig.mockClear();
    again?.open();
    await vi.advanceTimersByTimeAsync(0);
    again?.receive({ type: "live.hello", connectionId: "c-me-2", participants: [{ ...ME, connectionId: "c-me-2" }], seq: 4 });
    await vi.advanceTimersByTimeAsync(0);
    expect(useLayoutLiveStore.getState().status).toBe("live");
    expect(h.fetchConfig).toHaveBeenCalledTimes(1);
    h.client.stop();
  });
});

describe("decomposeSceneItems — the overlay never enters the saved document", () => {
  it("keeps the local object where the scene shows a peer's state", () => {
    const local = [editor(T1, 1), editor(T2, 2)];
    useLayoutLiveStore.setState({ overlay: new Map() });
    const overlay = new Map([[T1, {
      key: T1, seq: 1, connectionId: "c-alex", userId: "u-alex", name: "Alex", state: editor(T1, 8), touchedAtMs: 0,
    }]]);
    const scene = [editorToPlacedItem(editor(T1, 8)), editorToPlacedItem(editor(T2, 6))];
    const result = decomposeSceneItems(scene, local, overlay);
    expect(result.map((o) => o.positionX)).toEqual([1, 6]);
  });

  it("drops a peer's unsaved placement and keeps an object a peer deleted", () => {
    const local = [editor(T1, 1), editor(T2, 2)];
    const overlay = new Map([
      [T2, { key: T2, seq: 1, connectionId: "c-alex", userId: "u-alex", name: "Alex", state: null, touchedAtMs: 0 }],
      ["remote:c-alex:local-4", {
        key: "remote:c-alex:local-4", seq: 2, connectionId: "c-alex", userId: "u-alex", name: "Alex",
        state: { ...editor(T3, 4), id: "remote:c-alex:local-4" }, touchedAtMs: 0,
      }],
    ]);
    const scene = [editorToPlacedItem(editor(T1, 1)), editorToPlacedItem({ ...editor(T3, 4), id: "remote:c-alex:local-4" })];
    const result = decomposeSceneItems(scene, local, overlay);
    expect(result.map((o) => o.id)).toEqual([T1, T2]);
  });
});
