import type { LiveObjectState, LiveOp } from "@omnitwin/types";
import { ObjectMetadataResponseSchema } from "../../api/configurations.js";
import type { EditorObject } from "../../stores/editor-store.js";
import { editorToBatch, placedObjectToEditor } from "../../stores/editor-store.js";

// ---------------------------------------------------------------------------
// Live co-editing v1 — the pure half of the client.
//
// Three documents meet here:
//   - BASE: the last layout the server confirmed (load, save echo, adopt).
//   - LOCAL: what this person's editor holds — base plus their own edits.
//     The only thing the save path ever sends.
//   - REMOTE OVERLAY: the latest live op from someone else, per object,
//     shown in the scene but never saved by this client. It is a prediction
//     of a commit the other person's save will make; it is retired when the
//     server's document reflects it, or when it expires.
//
// Last write wins per object, in the server's per-room sequence. An object
// someone else wrote after this person's last edit is YIELDED: local goes
// back to base for that object, so this client's next save cannot overwrite
// the later write with its own older one.
// ---------------------------------------------------------------------------

/** Remote ops older than this with no follow-up are dropped: if the author's
 *  save never landed, everyone returns to the server's truth. */
export const REMOTE_OVERLAY_TTL_MS = 15_000;

const POSITION_EPSILON = 1e-4;

export function isLocalObjectId(id: string): boolean {
  return id.startsWith("local-");
}

/** Wire state (real metres) from the store's render-space object. */
export function editorToLiveState(object: EditorObject): LiveObjectState {
  const batch = editorToBatch(object);
  return {
    id: object.id,
    assetDefinitionId: batch.assetDefinitionId,
    positionX: batch.positionX,
    positionY: batch.positionY,
    positionZ: batch.positionZ,
    rotationX: batch.rotationX,
    rotationY: batch.rotationY,
    rotationZ: batch.rotationZ,
    scale: batch.scale,
    sortOrder: batch.sortOrder,
    metadata: batch.metadata === undefined || batch.metadata === null ? null : { ...batch.metadata },
  };
}

/** Store object from a peer's wire state, with an id chosen by the caller.
 *  Metadata is untrusted: it goes through the same schema as a server read,
 *  and anything it rejects degrades to no metadata. */
export function liveStateToEditor(state: LiveObjectState, id: string): EditorObject {
  const metadata = ObjectMetadataResponseSchema.safeParse(state.metadata);
  return placedObjectToEditor({
    id,
    configurationId: "",
    assetDefinitionId: state.assetDefinitionId,
    positionX: String(state.positionX),
    positionY: String(state.positionY),
    positionZ: String(state.positionZ),
    rotationX: String(state.rotationX),
    rotationY: String(state.rotationY),
    rotationZ: String(state.rotationZ),
    scale: String(state.scale),
    sortOrder: state.sortOrder,
    metadata: metadata.success ? metadata.data : null,
  });
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= POSITION_EPSILON;
}

/** Same placement and dressing, ignoring id and float noise from the
 *  metres ↔ render-space round trip. */
export function sameObjectState(a: EditorObject, b: EditorObject): boolean {
  return a.assetDefinitionId === b.assetDefinitionId
    && near(a.positionX, b.positionX)
    && near(a.positionY, b.positionY)
    && near(a.positionZ, b.positionZ)
    && near(a.rotationX, b.rotationX)
    && near(a.rotationY, b.rotationY)
    && near(a.rotationZ, b.rotationZ)
    && near(a.scale, b.scale)
    && a.clothed === b.clothed
    && a.clothStyle === b.clothStyle
    && a.tableSetting === b.tableSetting
    && a.chairStyle === b.chairStyle
    && a.centerpiece === b.centerpiece
    && a.groupId === b.groupId
    && (a.label ?? "") === (b.label ?? "")
    && a.notes === b.notes;
}

/** The live ops that turn `before` into `after`: whole state for every
 *  placed or changed object, a remove for every deleted one. */
export function diffLiveOps(before: readonly EditorObject[], after: readonly EditorObject[]): LiveOp[] {
  const beforeById = new Map(before.map((object) => [object.id, object]));
  const afterIds = new Set<string>();
  const ops: LiveOp[] = [];
  for (const object of after) {
    afterIds.add(object.id);
    const prior = beforeById.get(object.id);
    if (prior === object) continue;
    if (prior === undefined || !sameObjectState(prior, object)) {
      ops.push({ kind: "put", object: editorToLiveState(object) });
    }
  }
  for (const object of before) {
    if (!afterIds.has(object.id)) ops.push({ kind: "remove", id: object.id });
  }
  return ops;
}

// --- the remote overlay ----------------------------------------------------

export interface RemoteEntry {
  /** Scene key: the object id, or `remote:<connection>:<local-id>` for a
   *  placement its author has not saved yet. */
  readonly key: string;
  readonly seq: number;
  readonly connectionId: string;
  readonly userId: string;
  readonly name: string;
  /** Render-space state with `id === key`; null means deleted. */
  readonly state: EditorObject | null;
  readonly touchedAtMs: number;
}

export type RemoteOverlay = ReadonlyMap<string, RemoteEntry>;

export const EMPTY_OVERLAY: RemoteOverlay = new Map();

export function overlayKey(objectId: string, connectionId: string): string {
  return isLocalObjectId(objectId) ? `remote:${connectionId}:${objectId}` : objectId;
}

export function isRemotePlacementKey(key: string): boolean {
  return key.startsWith("remote:");
}

export interface RemoteOpsFrame {
  readonly seq: number;
  readonly connectionId: string;
  readonly userId: string;
  readonly name: string;
  readonly ops: readonly LiveOp[];
}

export interface AppliedRemoteOps {
  readonly overlay: RemoteOverlay;
  /** Persisted object ids this frame now owns in the scene. */
  readonly claimedIds: readonly string[];
}

/**
 * Apply a peer's frame. An object this client has an UNECHOED op on is
 * skipped: the server has not sequenced that op yet, so it will land after
 * this frame and is the later write.
 */
export function applyRemoteOps(
  overlay: RemoteOverlay,
  frame: RemoteOpsFrame,
  isPendingLocally: (objectId: string) => boolean,
  nowMs: number,
): AppliedRemoteOps {
  const next = new Map(overlay);
  const claimed: string[] = [];
  for (const op of frame.ops) {
    const objectId = op.kind === "put" ? op.object.id : op.id;
    const key = overlayKey(objectId, frame.connectionId);
    if (!isRemotePlacementKey(key) && isPendingLocally(key)) continue;
    const prior = next.get(key);
    if (prior !== undefined && prior.seq > frame.seq) continue;
    if (op.kind === "remove" && isRemotePlacementKey(key)) {
      // A placement its author removed before saving: nothing to show.
      next.delete(key);
      continue;
    }
    next.set(key, {
      key,
      seq: frame.seq,
      connectionId: frame.connectionId,
      userId: frame.userId,
      name: frame.name,
      state: op.kind === "put" ? liveStateToEditor(op.object, key) : null,
      touchedAtMs: nowMs,
    });
    if (!isRemotePlacementKey(key)) claimed.push(key);
  }
  return { overlay: next, claimedIds: claimed };
}

/** This client's own op on these objects was sequenced at `seq`: anything
 *  older in the overlay for them has lost. */
export function retireOverlayBefore(overlay: RemoteOverlay, objectIds: readonly string[], seq: number): RemoteOverlay {
  let next: Map<string, RemoteEntry> | null = null;
  for (const id of objectIds) {
    const entry = overlay.get(id);
    if (entry === undefined || entry.seq >= seq) continue;
    next ??= new Map(overlay);
    next.delete(id);
  }
  return next ?? overlay;
}

/** A peer's save gave its local placements server ids: re-key them so the
 *  refetched document retires them. */
export function rekeyRemotePlacements(
  overlay: RemoteOverlay,
  connectionId: string,
  ids: readonly (readonly [string, string])[],
): RemoteOverlay {
  if (ids.length === 0) return overlay;
  const next = new Map(overlay);
  for (const [localId, serverId] of ids) {
    const key = overlayKey(localId, connectionId);
    const entry = next.get(key);
    if (entry === undefined) continue;
    next.delete(key);
    // The author may already have sent newer ops under the server id.
    const newer = next.get(serverId);
    if (newer !== undefined && newer.seq >= entry.seq) continue;
    next.set(serverId, {
      ...entry,
      key: serverId,
      state: entry.state === null ? null : { ...entry.state, id: serverId },
    });
  }
  return next;
}

/** Retire every entry the server's document already reflects. A peer's
 *  unsaved placement is retired once an identical object exists on the server
 *  (its save landed before its id map reached us, or the map never came). */
export function reconcileOverlay(overlay: RemoteOverlay, server: readonly EditorObject[]): RemoteOverlay {
  if (overlay.size === 0) return overlay;
  const serverById = new Map(server.map((object) => [object.id, object]));
  const next = new Map(overlay);
  for (const [key, entry] of overlay) {
    if (isRemotePlacementKey(key)) {
      const placed = entry.state;
      if (placed !== null && server.some((object) => sameObjectState(object, placed))) next.delete(key);
      continue;
    }
    const confirmed = serverById.get(key);
    const reflected = entry.state === null
      ? confirmed === undefined
      : confirmed !== undefined && sameObjectState(confirmed, entry.state);
    if (reflected) next.delete(key);
  }
  return next.size === overlay.size ? overlay : next;
}

export function expireOverlay(overlay: RemoteOverlay, nowMs: number, ttlMs: number = REMOTE_OVERLAY_TTL_MS): RemoteOverlay {
  let next: Map<string, RemoteEntry> | null = null;
  for (const [key, entry] of overlay) {
    if (nowMs - entry.touchedAtMs <= ttlMs) continue;
    next ??= new Map(overlay);
    next.delete(key);
  }
  return next ?? overlay;
}

/** What the scene shows: the local document with the overlay on top. */
export function composeWithOverlay(local: readonly EditorObject[], overlay: RemoteOverlay): readonly EditorObject[] {
  if (overlay.size === 0) return local;
  const shown: EditorObject[] = [];
  const localIds = new Set<string>();
  for (const object of local) {
    localIds.add(object.id);
    const entry = overlay.get(object.id);
    if (entry === undefined) {
      shown.push(object);
    } else if (entry.state !== null) {
      shown.push(entry.state);
    }
  }
  for (const [key, entry] of overlay) {
    if (!localIds.has(key) && entry.state !== null) shown.push(entry.state);
  }
  return shown;
}

// --- rebase -----------------------------------------------------------------

export interface RebaseInput {
  /** The server's document now. */
  readonly server: readonly EditorObject[];
  /** The server document this client's edits were made against. */
  readonly base: readonly EditorObject[];
  /** This client's document. */
  readonly local: readonly EditorObject[];
  /** Objects a later remote write took from this client. */
  readonly yielded: ReadonlySet<string>;
}

export interface RebaseResult {
  readonly objects: readonly EditorObject[];
  /** Objects this client changed that someone else deleted meanwhile.
   *  Dropped, not resurrected: the batch cannot update a deleted row. */
  readonly lostToRemoteDelete: readonly EditorObject[];
}

/**
 * Object-level rebase of this client's edits onto the server's document.
 * Field-free and id-keyed — exactly the batch's granularity:
 *   - objects this client did not touch (or yielded) come from the server;
 *   - objects it changed keep its values (its save is the later write);
 *   - its new placements are kept; its deletions stay deleted;
 *   - objects someone else added appear; objects someone else deleted go.
 */
export function rebaseOntoServer({ server, base, local, yielded }: RebaseInput): RebaseResult {
  const serverById = new Map(server.map((object) => [object.id, object]));
  const baseById = new Map(base.map((object) => [object.id, object]));
  const localIds = new Set(local.map((object) => object.id));
  const objects: EditorObject[] = [];
  const lost: EditorObject[] = [];

  for (const object of local) {
    if (isLocalObjectId(object.id)) {
      objects.push(object);
      continue;
    }
    const onServer = serverById.get(object.id);
    const before = baseById.get(object.id);
    const touched = !yielded.has(object.id) && (before === undefined || !sameObjectState(before, object));
    if (onServer === undefined) {
      if (touched && before !== undefined) lost.push(object);
      continue;
    }
    objects.push(touched ? object : onServer);
  }
  for (const object of server) {
    if (localIds.has(object.id)) continue;
    // In base but not local: this client deleted it, and that delete stands.
    if (baseById.has(object.id) && !yielded.has(object.id)) continue;
    objects.push(object);
  }
  return { objects, lostToRemoteDelete: lost };
}

/** Ids this client changed since the base it last confirmed: changed, newly
 *  placed, and deleted (in base, gone from local). */
export function locallyModifiedIds(base: readonly EditorObject[], local: readonly EditorObject[]): ReadonlySet<string> {
  return changedBetween(base, local);
}

/** Ids that differ between two documents: changed, added or removed. */
export function changedBetween(before: readonly EditorObject[], after: readonly EditorObject[]): Set<string> {
  const beforeById = new Map(before.map((object) => [object.id, object]));
  const changed = new Set<string>();
  const afterIds = new Set<string>();
  for (const object of after) {
    afterIds.add(object.id);
    const prior = beforeById.get(object.id);
    if (prior === undefined || !sameObjectState(prior, object)) changed.add(object.id);
  }
  for (const object of before) {
    if (!afterIds.has(object.id)) changed.add(object.id);
  }
  return changed;
}
