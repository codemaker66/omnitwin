import { describe, expect, it } from "vitest";
import { LayoutLiveHub, type LayoutLiveSocket } from "../../ws/layout-live.js";

const CONFIG = "00000000-0000-4000-8000-00000000c0a1";
const OBJECT = "00000000-0000-4000-8000-0000000000f1";

function socket(): LayoutLiveSocket & { sent: string[] } {
  const sent: string[] = [];
  return { sent, send(text: string) { sent.push(text); }, close() { /* noop */ } };
}

function deep(depth: number): unknown {
  let value: unknown = 1;
  for (let i = 0; i < depth; i += 1) value = [value];
  return value;
}

describe("LayoutLiveHub — hostile frames", () => {
  it("drops a frame whose metadata nests deep enough to break JSON.stringify, without throwing", () => {
    const hub = new LayoutLiveHub();
    const attacker = hub.join(CONFIG, socket(), { userId: "u-a", name: "A", role: "staff" });
    const peer = socket();
    hub.join(CONFIG, peer, { userId: "u-b", name: "B", role: "staff" });
    const frame = {
      type: "live.ops",
      ops: [{ kind: "put", object: {
        id: OBJECT, assetDefinitionId: "x", positionX: 0, positionY: 0, positionZ: 0,
        rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: 0, metadata: { a: deep(5_000) },
      } }],
    };
    expect(() => hub.handleClientFrame(attacker, frame, 20_000)).not.toThrow();
    expect(peer.sent.some((text) => text.includes("live.ops"))).toBe(false);
  });
});

describe("LayoutLiveHub — revocation", () => {
  it("tells a revoked connection, removes it, and drops anything it sends after", () => {
    const hub = new LayoutLiveHub();
    const gone = socket();
    const stays = socket();
    const goneConnection = hub.join(CONFIG, gone, { userId: "u-a", name: "A", role: "staff" });
    hub.join(CONFIG, stays, { userId: "u-b", name: "B", role: "staff" });
    hub.revoke(goneConnection);
    expect(gone.sent.some((text) => text.includes("\"live.revoked\""))).toBe(true);
    expect(hub.participants(CONFIG).map((p) => p.userId)).toEqual(["u-b"]);
    const op = { kind: "remove", id: OBJECT };
    expect(hub.handleClientFrame(goneConnection, { type: "live.ops", ops: [op] }, 80)).toBe("dropped");
    expect(stays.sent.some((text) => text.includes("\"live.ops\""))).toBe(false);
  });

  it("skips a member whose socket is too far behind instead of buffering without bound", () => {
    const hub = new LayoutLiveHub();
    const sender = hub.join(CONFIG, socket(), { userId: "u-a", name: "A", role: "staff" });
    const slow = { ...socket(), bufferedAmount: 64 * 1024 * 1024 };
    hub.join(CONFIG, slow, { userId: "u-b", name: "B", role: "staff" });
    hub.handleClientFrame(sender, { type: "live.ops", ops: [{ kind: "remove", id: OBJECT }] }, 80);
    expect(slow.sent.some((text) => text.includes("\"live.ops\""))).toBe(false);
  });
});
