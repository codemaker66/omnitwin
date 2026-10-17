import { describe, expect, it } from "vitest";
import type { LiveOp } from "@omnitwin/types";
import type { EditorObject } from "../../../stores/editor-store.js";
import {
  EMPTY_OVERLAY,
  applyRemoteOps,
  composeWithOverlay,
  diffLiveOps,
  editorToLiveState,
  expireOverlay,
  liveStateToEditor,
  locallyModifiedIds,
  rebaseOntoServer,
  reconcileOverlay,
  rekeyRemotePlacements,
  retireOverlayBefore,
  sameObjectState,
} from "../live-document.js";

// ---------------------------------------------------------------------------
// Live co-editing v1 — the pure client core: last write wins per object in
// the server's sequence, the remote overlay never enters the saved document,
// and a stale save rebases object by object instead of overwriting anyone.
// ---------------------------------------------------------------------------

const ASSET = "9a6c1f3e-0000-4000-8000-0000000000aa";
const T1 = "00000000-0000-4000-8000-000000000001";
const T2 = "00000000-0000-4000-8000-000000000002";
const T3 = "00000000-0000-4000-8000-000000000003";
const T4 = "00000000-0000-4000-8000-000000000004";

function object(id: string, positionX: number, extra: Partial<EditorObject> = {}): EditorObject {
  return {
    id,
    assetDefinitionId: ASSET,
    positionX,
    positionY: 0,
    positionZ: 1,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    scale: 1,
    sortOrder: 0,
    clothed: false,
    clothStyle: null,
    tableSetting: null,
    chairStyle: null,
    centerpiece: null,
    groupId: null,
    notes: "",
    ...extra,
  };
}

function put(target: EditorObject): LiveOp {
  return { kind: "put", object: editorToLiveState(target) };
}

const frame = (seq: number, ops: readonly LiveOp[], connectionId = "c-alex") => ({
  seq, connectionId, userId: "u-alex", name: "Alex", ops,
});

const never = (): boolean => false;

describe("wire round trip", () => {
  it("survives store → wire → store with dressing, notes and label intact", () => {
    const original = object(T1, 3.25, {
      rotationY: 1.2, clothed: true, clothStyle: "white", tableSetting: "dinner",
      chairStyle: "chiavari", centerpiece: "candles", groupId: "g-1", notes: "VIP", label: "Table 4",
    });
    const back = liveStateToEditor(editorToLiveState(original), T1);
    expect(sameObjectState(back, original)).toBe(true);
  });

  it("degrades hostile metadata to none instead of trusting it", () => {
    const state = { ...editorToLiveState(object(T1, 1)), metadata: { clothed: "yes please", notes: 42 } };
    const back = liveStateToEditor(state, T1);
    expect(back.clothed).toBe(false);
    expect(back.notes).toBe("");
  });
});

describe("diffLiveOps", () => {
  it("sends whole state for placed and moved objects and a remove for deletions", () => {
    const a = object(T1, 1);
    const b = object(T2, 2);
    const ops = diffLiveOps([a, b], [{ ...a, positionX: 5 }, object("local-9", 3)]);
    expect(ops.map((op) => op.kind === "put" ? `put:${op.object.id}` : `remove:${op.id}`))
      .toEqual([`put:${T1}`, "put:local-9", `remove:${T2}`]);
  });

  it("sends nothing for an unchanged document", () => {
    const a = object(T1, 1);
    expect(diffLiveOps([a], [a])).toEqual([]);
    expect(diffLiveOps([a], [{ ...a }])).toEqual([]);
  });
});

describe("remote overlay — last write wins in server order", () => {
  it("shows a peer's move over the local document without changing it", () => {
    const local = [object(T1, 1), object(T2, 2)];
    const { overlay, claimedIds } = applyRemoteOps(EMPTY_OVERLAY, frame(1, [put(object(T1, 8))]), never, 0);
    expect(claimedIds).toEqual([T1]);
    const shown = composeWithOverlay(local, overlay);
    expect(shown.map((o) => o.positionX)).toEqual([8, 2]);
    expect(local[0]?.positionX).toBe(1);
  });

  it("skips an object this client has an unechoed op on: that op is later", () => {
    const { overlay, claimedIds } = applyRemoteOps(
      EMPTY_OVERLAY, frame(4, [put(object(T1, 8))]), (id) => id === T1, 0,
    );
    expect(claimedIds).toEqual([]);
    expect(overlay.size).toBe(0);
  });

  it("never lets an older sequence replace a newer one", () => {
    const newer = applyRemoteOps(EMPTY_OVERLAY, frame(7, [put(object(T1, 7))]), never, 0).overlay;
    const after = applyRemoteOps(newer, frame(6, [put(object(T1, 6))], "c-sam"), never, 0).overlay;
    expect(after.get(T1)?.state?.positionX).toBe(7);
  });

  it("retires remote entries older than this client's own sequenced op", () => {
    const overlay = applyRemoteOps(EMPTY_OVERLAY, frame(3, [put(object(T1, 3))]), never, 0).overlay;
    expect(retireOverlayBefore(overlay, [T1], 5).has(T1)).toBe(false);
    expect(retireOverlayBefore(overlay, [T1], 2).has(T1)).toBe(true);
  });

  it("hides a peer's delete and shows a peer's unsaved placement under its own key", () => {
    const local = [object(T1, 1), object(T2, 2)];
    const overlay = applyRemoteOps(EMPTY_OVERLAY, frame(1, [
      { kind: "remove", id: T2 },
      put(object("local-3", 9)),
    ]), never, 0).overlay;
    const shown = composeWithOverlay(local, overlay);
    expect(shown.map((o) => o.id)).toEqual([T1, "remote:c-alex:local-3"]);
  });

  it("retires a placement its author removed before saving", () => {
    const placed = applyRemoteOps(EMPTY_OVERLAY, frame(1, [put(object("local-3", 9))]), never, 0).overlay;
    const removed = applyRemoteOps(placed, frame(2, [{ kind: "remove", id: "local-3" }]), never, 0).overlay;
    expect(removed.size).toBe(0);
  });

  it("re-keys a saved placement and retires it once the server document holds it", () => {
    const placed = applyRemoteOps(EMPTY_OVERLAY, frame(1, [put(object("local-3", 9))]), never, 0).overlay;
    const rekeyed = rekeyRemotePlacements(placed, "c-alex", [["local-3", T3]]);
    expect([...rekeyed.keys()]).toEqual([T3]);
    expect(reconcileOverlay(rekeyed, [object(T3, 9)]).size).toBe(0);
  });

  it("keeps an entry the server has not caught up with, and expires it after the TTL", () => {
    const overlay = applyRemoteOps(EMPTY_OVERLAY, frame(1, [put(object(T1, 8))]), never, 1_000).overlay;
    expect(reconcileOverlay(overlay, [object(T1, 1)]).size).toBe(1);
    expect(expireOverlay(overlay, 1_000 + 15_000).size).toBe(1);
    expect(expireOverlay(overlay, 1_000 + 15_001).size).toBe(0);
  });

  it("retires a remote delete once the server no longer has the object", () => {
    const overlay = applyRemoteOps(EMPTY_OVERLAY, frame(1, [{ kind: "remove", id: T2 }]), never, 0).overlay;
    expect(reconcileOverlay(overlay, [object(T2, 2)]).size).toBe(1);
    expect(reconcileOverlay(overlay, []).size).toBe(0);
  });
});

describe("rebaseOntoServer — object-level, never field-level", () => {
  const base = [object(T1, 1), object(T2, 2), object(T3, 3)];

  it("keeps what I changed, takes what I did not, and adds what others placed", () => {
    const local = [object(T1, 10), object(T2, 2), object(T3, 3), object("local-1", 4)];
    const server = [object(T1, 1), object(T2, 20), object(T3, 3), object(T4, 40)];
    const { objects, lostToRemoteDelete } = rebaseOntoServer({ server, base, local, yielded: new Set() });
    expect(objects.map((o) => `${o.id}@${String(o.positionX)}`)).toEqual([
      `${T1}@10`, `${T2}@20`, `${T3}@3`, "local-1@4", `${T4}@40`,
    ]);
    expect(lostToRemoteDelete).toEqual([]);
  });

  it("keeps my deletion and drops what someone else deleted", () => {
    const local = [object(T1, 1), object(T2, 2)];
    const server = [object(T1, 1), object(T3, 3)];
    const { objects } = rebaseOntoServer({ server, base, local, yielded: new Set() });
    expect(objects.map((o) => o.id)).toEqual([T1]);
  });

  it("reports an object I changed that someone else deleted, instead of resurrecting it", () => {
    const local = [object(T1, 99), object(T2, 2), object(T3, 3)];
    const server = [object(T2, 2), object(T3, 3)];
    const { objects, lostToRemoteDelete } = rebaseOntoServer({ server, base, local, yielded: new Set() });
    expect(objects.map((o) => o.id)).toEqual([T2, T3]);
    expect(lostToRemoteDelete.map((o) => o.id)).toEqual([T1]);
  });

  it("takes the server's copy of a yielded object even when local differs", () => {
    const local = [object(T1, 10), object(T2, 2), object(T3, 3)];
    const server = [object(T1, 50), object(T2, 2), object(T3, 3)];
    const { objects } = rebaseOntoServer({ server, base, local, yielded: new Set([T1]) });
    expect(objects[0]?.positionX).toBe(50);
  });

  it("brings back a yielded object this client had deleted", () => {
    const local = [object(T2, 2), object(T3, 3)];
    const server = [object(T1, 50), object(T2, 2), object(T3, 3)];
    const { objects } = rebaseOntoServer({ server, base, local, yielded: new Set([T1]) });
    expect(objects.map((o) => o.id)).toContain(T1);
  });

  it("locallyModifiedIds names changed and new objects, not untouched ones", () => {
    const local = [object(T1, 10), object(T2, 2), object("local-1", 4)];
    expect([...locallyModifiedIds(base, local)].sort()).toEqual([T1, "local-1"].sort());
  });
});
