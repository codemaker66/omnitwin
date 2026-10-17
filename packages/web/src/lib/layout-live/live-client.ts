import {
  LIVE_MAX_OPS_PER_FRAME,
  parseLiveServerFrame,
  type LiveOp,
  type LiveParticipant,
  type LiveServerFrame,
} from "@omnitwin/types";
import type { Configuration } from "../../api/configurations.js";
import { nextBackoffMs } from "../../pages/diary/lib/live-protocol.js";
import {
  isEditorGestureActive,
  setEditorLiveHooks,
  useEditorStore,
  type EditorObject,
} from "../../stores/editor-store.js";
import { useLayoutLiveStore } from "../../stores/layout-live-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { getCatalogueItem } from "../catalogue.js";
import { observeServerNow } from "../clock-offset.js";
import {
  EMPTY_OVERLAY,
  applyRemoteOps,
  diffLiveOps,
  expireOverlay,
  locallyModifiedIds,
  reconcileOverlay,
  rekeyRemotePlacements,
  retireOverlayBefore,
  type RemoteEntry,
  type RemoteOverlay,
} from "./live-document.js";

// ---------------------------------------------------------------------------
// Live co-editing v1 — the client of the layout's live room.
//
// Rides /ws/configurations/:configId (the auto-save socket) after its auth
// frame. The server answers `live.hello` only for the layout's owner and the
// venue floor; anyone else stays "connecting" and sees nothing new.
//
//   local edit  → diffed into whole-object ops, coalesced to ≤20 frames/s
//   peer's op   → the remote overlay (drawn, never saved); an object this
//                 person changed is YIELDED when a later write lands on it
//   layout.changed → refetch, then adopt (clean) or rebase (dirty)
//   reconnect   → overlay cleared, document refetched: the server is truth
// ---------------------------------------------------------------------------

/** At most one frame per interval (~20 Hz): the first change of a gesture
 *  leaves at once, the drag frames after it are coalesced. */
export const LIVE_SEND_INTERVAL_MS = 50;
/** Autosave debounce while someone else is in the layout. */
export const CO_EDITING_AUTOSAVE_MS = 400;
const CLIENT_PING_MS = 15_000;
const OVERLAY_SWEEP_MS = 1_000;
const BUSY_RETRY_MS = 250;
/** An op not echoed within this window was dropped by the hub (rate or size)
 *  and no longer counts as the later write. A local echo takes milliseconds. */
const PENDING_ECHO_MS = 2_000;
const SOCKET_OPEN = 1;
const SAVED_IDS_PER_FRAME = 500;

export interface LiveSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

/** The browser's WebSocket behind the narrow interface the client uses. */
export function browserLiveSocket(url: string): LiveSocket {
  const ws = new WebSocket(url);
  const adapter: LiveSocket = {
    get readyState() { return ws.readyState; },
    send: (data) => { ws.send(data); },
    close: () => { ws.close(); },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.onopen = () => { adapter.onopen?.(); };
  ws.onmessage = (event: MessageEvent) => { adapter.onmessage?.({ data: event.data }); };
  ws.onclose = () => { adapter.onclose?.(); };
  ws.onerror = () => { adapter.onerror?.(); };
  return adapter;
}

export interface LayoutLiveClientOptions {
  readonly configId: string;
  readonly url: string;
  readonly openSocket: (url: string) => LiveSocket;
  readonly getToken: () => Promise<string | null>;
  readonly fetchConfig: (configId: string) => Promise<Configuration>;
  /** How many OTHER connections share the layout (drives the autosave pace). */
  readonly onCoEditorsChanged?: (others: number) => void;
  readonly now?: () => number;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/u)[0] ?? name;
}

function nounFor(object: EditorObject | undefined): string {
  if (object === undefined) return "item";
  const item = getCatalogueItem(object.assetDefinitionId);
  if (item === undefined) return "item";
  return item.tableShape !== null ? "table" : item.name.toLowerCase();
}

export class LayoutLiveClient {
  readonly #options: LayoutLiveClientOptions;
  readonly #now: () => number;
  #socket: LiveSocket | null = null;
  #connectionId: string | null = null;
  #hadHello = false;
  #attempt = 0;
  #stopped = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #sweepTimer: ReturnType<typeof setInterval> | null = null;
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #lastSentAtMs = Number.NEGATIVE_INFINITY;
  #busyTimer: ReturnType<typeof setTimeout> | null = null;
  #unsubscribeSpace: (() => void) | null = null;
  /** Ops waiting for the next coalesced frame, latest per object. */
  readonly #queued = new Map<string, LiveOp>();
  /** Ops sent but not yet echoed back with their sequence, per object. */
  readonly #unechoed = new Map<string, { count: number; lastSentAtMs: number }>();
  #refetching = false;
  #refetchAgain = false;

  constructor(options: LayoutLiveClientOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => Date.now());
  }

  start(): void {
    useLayoutLiveStore.setState({ status: "connecting", connectionId: null, participants: [], overlay: EMPTY_OVERLAY, notice: null });
    this.#sweepTimer = setInterval(() => { this.#sweepOverlay(); }, OVERLAY_SWEEP_MS);
    let lastSpace = useEditorStore.getState().space;
    this.#unsubscribeSpace = useEditorStore.subscribe((state) => {
      if (state.space === lastSpace) return;
      lastSpace = state.space;
      this.#sendView();
    });
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    for (const timer of [this.#reconnectTimer, this.#flushTimer, this.#busyTimer]) {
      if (timer !== null) clearTimeout(timer);
    }
    if (this.#pingTimer !== null) clearInterval(this.#pingTimer);
    if (this.#sweepTimer !== null) clearInterval(this.#sweepTimer);
    this.#unsubscribeSpace?.();
    setEditorLiveHooks(null);
    const socket = this.#socket;
    this.#socket = null;
    socket?.close();
    this.#options.onCoEditorsChanged?.(0);
    useLayoutLiveStore.getState().resetLive();
  }

  // --- connection ----------------------------------------------------------

  #connect(): void {
    if (this.#stopped) return;
    const socket = this.#options.openSocket(this.#options.url);
    this.#socket = socket;
    socket.onopen = () => {
      void this.#options.getToken().then((token) => {
        if (this.#socket !== socket || this.#stopped) return;
        if (token === null) {
          socket.close();
          return;
        }
        socket.send(JSON.stringify({ type: "auth", token }));
        if (this.#pingTimer !== null) clearInterval(this.#pingTimer);
        this.#pingTimer = setInterval(() => {
          if (socket.readyState === SOCKET_OPEN) socket.send(JSON.stringify({ type: "ping" }));
        }, CLIENT_PING_MS);
      }).catch(() => { socket.close(); });
    };
    socket.onmessage = (event) => {
      if (this.#socket !== socket || this.#stopped || typeof event.data !== "string") return;
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      // Answer the server's heartbeat. A background tab's timers are
      // throttled to about one a minute, but its socket messages are not, so
      // this keeps a quiet tab in the room past the server's 65 s sweep.
      if (typeof data === "object" && data !== null && Reflect.get(data, "type") === "ping") {
        if (socket.readyState === SOCKET_OPEN) socket.send(JSON.stringify({ type: "ping" }));
        return;
      }
      const frame = parseLiveServerFrame(data);
      if (frame !== null) this.#handle(frame);
    };
    socket.onclose = () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#leaveRoom();
      if (this.#stopped) return;
      useLayoutLiveStore.setState({ status: this.#hadHello ? "reconnecting" : "connecting" });
      const delay = nextBackoffMs(this.#attempt);
      this.#attempt += 1;
      this.#reconnectTimer = setTimeout(() => { this.#connect(); }, delay);
    };
    socket.onerror = () => { socket.close(); };
  }

  /** The room is gone: nothing seen through it can be trusted any more. */
  #leaveRoom(): void {
    if (this.#pingTimer !== null) clearInterval(this.#pingTimer);
    this.#pingTimer = null;
    setEditorLiveHooks(null);
    this.#connectionId = null;
    this.#queued.clear();
    this.#unechoed.clear();
    this.#options.onCoEditorsChanged?.(0);
    useLayoutLiveStore.setState({ connectionId: null, participants: [], overlay: EMPTY_OVERLAY });
  }

  #handle(frame: LiveServerFrame): void {
    observeServerNow(frame.serverNowMs);
    switch (frame.type) {
      case "live.hello":
        this.#hadHello = true;
        this.#attempt = 0;
        this.#connectionId = frame.connectionId;
        useLayoutLiveStore.setState({
          status: "live",
          connectionId: frame.connectionId,
          participants: frame.participants,
          overlay: EMPTY_OVERLAY,
        });
        this.#setParticipants(frame.participants);
        setEditorLiveHooks({
          onLocalChange: (before, after) => { this.#onLocalChange(before, after); },
          onSaved: (revision, idMap) => { this.#onSaved(revision, idMap); },
        });
        this.#sendView();
        // Joining (or rejoining) is a resync: whatever was missed is in the
        // server's document, never in a replay of ops.
        void this.#refetch();
        return;
      case "live.presence":
        this.#setParticipants(frame.participants);
        return;
      case "live.revoked":
        // Access ended (role, venue or the layout changed). The socket stays
        // for autosave; nothing live is shown or sent on it again.
        this.#leaveRoom();
        useLayoutLiveStore.setState({ status: "off" });
        return;
      case "live.ops":
        if (frame.connectionId === this.#connectionId) {
          this.#onEcho(frame.seq, frame.ops);
        } else {
          this.#onRemoteOps(frame);
        }
        return;
      case "live.saved": {
        if (frame.connectionId === this.#connectionId) return;
        const rekeyed = rekeyRemotePlacements(useLayoutLiveStore.getState().overlay, frame.connectionId, frame.ids);
        this.#setOverlay(reconcileOverlay(rekeyed, useEditorStore.getState().baseObjects));
        return;
      }
      case "layout.changed": {
        const held = useEditorStore.getState().configRevision;
        if (held === null || frame.revision > held) void this.#refetch();
        return;
      }
    }
  }

  #setParticipants(participants: readonly LiveParticipant[]): void {
    useLayoutLiveStore.setState({ participants });
    const others = participants.filter((participant) => participant.connectionId !== this.#connectionId).length;
    this.#options.onCoEditorsChanged?.(others);
  }

  #setOverlay(overlay: RemoteOverlay): void {
    if (overlay !== useLayoutLiveStore.getState().overlay) useLayoutLiveStore.setState({ overlay });
  }

  #sendView(): void {
    const socket = this.#socket;
    if (socket === null || socket.readyState !== SOCKET_OPEN || this.#connectionId === null) return;
    const space = useEditorStore.getState().space;
    const label = space?.name.trim() ?? "";
    if (space === null || label.length === 0) return;
    socket.send(JSON.stringify({ type: "live.view", view: { spaceId: space.id, label: label.slice(0, 80) } }));
  }

  // --- outgoing --------------------------------------------------------------

  #onLocalChange(before: readonly EditorObject[], after: readonly EditorObject[]): void {
    if (useEditorStore.getState().configId !== this.#options.configId) return;
    const ops = diffLiveOps(before, after);
    if (ops.length === 0) return;
    // This person's write is later than anything already received for these
    // objects: drop those remote entries so the scene follows their hand.
    const overlay = useLayoutLiveStore.getState().overlay;
    let next: Map<string, RemoteEntry> | null = null;
    for (const op of ops) {
      const id = op.kind === "put" ? op.object.id : op.id;
      this.#queued.set(id, op);
      if (overlay.has(id)) {
        next ??= new Map(overlay);
        next.delete(id);
      }
    }
    if (next !== null) this.#setOverlay(next);
    if (this.#flushTimer !== null) return;
    // Leading edge: a placement, a delete or a drag's first frame goes now;
    // only the frames that follow within the interval wait to be coalesced.
    const waitMs = LIVE_SEND_INTERVAL_MS - (this.#now() - this.#lastSentAtMs);
    if (waitMs <= 0) {
      this.#flush();
      return;
    }
    this.#flushTimer = setTimeout(() => { this.#flush(); }, waitMs);
  }

  #flush(): void {
    this.#flushTimer = null;
    const socket = this.#socket;
    if (socket === null || socket.readyState !== SOCKET_OPEN || this.#connectionId === null) {
      // Not in a room: the durable save carries the change on its own.
      this.#queued.clear();
      return;
    }
    const ops = [...this.#queued.values()];
    this.#queued.clear();
    if (ops.length === 0) return;
    this.#lastSentAtMs = this.#now();
    for (let start = 0; start < ops.length; start += LIVE_MAX_OPS_PER_FRAME) {
      const chunk = ops.slice(start, start + LIVE_MAX_OPS_PER_FRAME);
      const ids = chunk.map((op) => op.kind === "put" ? op.object.id : op.id);
      socket.send(JSON.stringify({ type: "live.ops", ops: chunk }));
      const sentAtMs = this.#now();
      for (const id of ids) {
        this.#unechoed.set(id, { count: (this.#unechoed.get(id)?.count ?? 0) + 1, lastSentAtMs: sentAtMs });
      }
    }
  }

  /** Paired by the ids the echoed frame carries, never by send order: the
   *  hub may drop a frame, and then every later pairing would be wrong. */
  #onEcho(seq: number, ops: readonly LiveOp[]): void {
    const ids = ops.map((op) => op.kind === "put" ? op.object.id : op.id);
    for (const id of ids) {
      const entry = this.#unechoed.get(id);
      if (entry === undefined) continue;
      if (entry.count <= 1) this.#unechoed.delete(id);
      else this.#unechoed.set(id, { ...entry, count: entry.count - 1 });
    }
    this.#setOverlay(retireOverlayBefore(useLayoutLiveStore.getState().overlay, ids, seq));
  }

  #onSaved(revision: number, idMap: ReadonlyMap<string, string>): void {
    if (idMap.size === 0) return;
    // Ops still queued under a local id must leave under the server id, or
    // peers would keep a placement nobody can retire.
    for (const [localId, serverId] of idMap) {
      const queued = this.#queued.get(localId);
      if (queued === undefined) continue;
      this.#queued.delete(localId);
      this.#queued.set(
        serverId,
        queued.kind === "put" ? { kind: "put", object: { ...queued.object, id: serverId } } : { kind: "remove", id: serverId },
      );
    }
    if (this.#flushTimer !== null) {
      clearTimeout(this.#flushTimer);
      this.#flush();
    }
    const socket = this.#socket;
    if (socket === null || socket.readyState !== SOCKET_OPEN || this.#connectionId === null) return;
    const pairs = [...idMap.entries()];
    for (let start = 0; start < pairs.length; start += SAVED_IDS_PER_FRAME) {
      socket.send(JSON.stringify({ type: "live.saved", revision, ids: pairs.slice(start, start + SAVED_IDS_PER_FRAME) }));
    }
  }

  // --- incoming --------------------------------------------------------------

  #onRemoteOps(frame: Extract<LiveServerFrame, { type: "live.ops" }>): void {
    const editor = useEditorStore.getState();
    if (editor.configId !== this.#options.configId) return;
    const selected = useSelectionStore.getState().selectedIds;
    const dragging = isEditorGestureActive();
    const nowMs = this.#now();
    const isPending = (id: string): boolean => {
      const sent = this.#unechoed.get(id);
      const inFlight = sent !== undefined && nowMs - sent.lastSentAtMs < PENDING_ECHO_MS;
      return inFlight || this.#queued.has(id) || (dragging && selected.has(id));
    };
    const { overlay, claimedIds } = applyRemoteOps(useLayoutLiveStore.getState().overlay, frame, isPending, this.#now());
    this.#setOverlay(overlay);
    if (claimedIds.length === 0) return;

    const modified = locallyModifiedIds(editor.baseObjects, editor.objects);
    const yielding = claimedIds.filter((id) => modified.has(id));
    if (yielding.length > 0) editor.yieldObjectsToRemote(yielding);

    const landedOn = claimedIds.find((id) => modified.has(id) || selected.has(id));
    if (landedOn === undefined) return;
    const op = frame.ops.find((candidate) => (candidate.kind === "put" ? candidate.object.id : candidate.id) === landedOn);
    const local = editor.objects.find((object) => object.id === landedOn);
    const verb = op?.kind === "remove" ? "removed" : "moved";
    useLayoutLiveStore.getState().showNotice(`${firstName(frame.name)} ${verb} this ${nounFor(local)}`);
  }

  async #refetch(): Promise<void> {
    if (this.#refetching) {
      this.#refetchAgain = true;
      return;
    }
    this.#refetching = true;
    let busy = false;
    try {
      const config = await this.#options.fetchConfig(this.#options.configId);
      if (this.#stopped) return;
      const outcome = useEditorStore.getState().adoptServerConfiguration(config);
      if (outcome.status === "busy") {
        busy = true;
      } else if (outcome.status === "adopted" || outcome.status === "rebased") {
        this.#setOverlay(reconcileOverlay(useLayoutLiveStore.getState().overlay, useEditorStore.getState().baseObjects));
        const lost = outcome.lostToRemoteDelete[0];
        if (lost !== undefined) {
          useLayoutLiveStore.getState().showNotice(`Someone else removed the ${nounFor(lost)} you changed`);
        }
      }
    } catch {
      // A failed read changes nothing; the next announcement or reconnect
      // tries again, and saves still guard themselves with the revision.
    } finally {
      this.#refetching = false;
    }
    if (this.#stopped) return;
    if (busy) {
      // A save or a drag owns the document: come back once it has settled.
      this.#busyTimer ??= setTimeout(() => {
        this.#busyTimer = null;
        void this.#refetch();
      }, BUSY_RETRY_MS);
      return;
    }
    if (this.#refetchAgain) {
      this.#refetchAgain = false;
      void this.#refetch();
    }
  }

  #sweepOverlay(): void {
    const overlay = useLayoutLiveStore.getState().overlay;
    if (overlay.size === 0) return;
    const reconciled = reconcileOverlay(overlay, useEditorStore.getState().baseObjects);
    this.#setOverlay(expireOverlay(reconciled, this.#now()));
  }
}
