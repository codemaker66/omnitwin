import type { Camera } from "three";
import { toRealWorld } from "../../constants/scale.js";
import { resolveRoomGeometry, type RoomGeometry } from "../../data/room-geometries.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { massForCategory, type FurnitureLanding, type FurnitureLandingListener } from "../../lib/furniture-motion.js";
import { createPlacedItem, type PlacedItem } from "../../lib/placement.js";
import { bodyFor } from "../../lib/set-down/bodies.js";
import { planCascade, type CascadePiece } from "../../lib/set-down/cascade.js";
import { earFor } from "../../lib/set-down/listener.js";
import type { Vec3 } from "../../lib/set-down/reflections.js";
import type { SetDownInput } from "../../lib/set-down/render.js";
import {
  SetDownCancelled,
  SetDownRendererBroken,
  createSetDownRenderer,
  type SetDownRendered,
  type SetDownRenderer,
} from "../../lib/set-down/renderer.js";
import { roomAcousticsFor, roomState, type RoomState } from "../../lib/set-down/room-acoustics.js";
import type { RoomAcoustics } from "../../lib/set-down/rooms.js";
import { tailOnsetSeconds } from "../../lib/set-down/tail.js";
import { HEARD_WINDOW_S, presentDelayFor, setDownStartTime } from "../../lib/set-down/timing.js";
import { voiceInput } from "../../lib/set-down/voice.js";
import {
  beginSetDownBatch,
  getPlannerSoundSettings,
  logSetDownDrop,
  plannerAudioClock,
  setPlannerRoomTail,
  subscribePlannerSoundArmed,
  wakePlannerSound,
  type SetDownBatch,
  type SetDownDrop,
  type SetDownPlayed,
  type SetDownVoice,
} from "../../lib/sound-registry.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { AdaptiveRenderPolicy, type ContactTiming, type RenderClass } from "./set-down-policy.js";

// ---------------------------------------------------------------------------
// The set-down driver (T-700, Task 14b): the motion's landings, rendered in the
// Worker and played on each piece's contact frame through the room the planner
// shows. SetDownSound imports it lazily (R78); nothing here renders on the main
// thread (R48), and only the registry makes sound.
//
// - A batch. The pieces that start down in one task (a placement's, a
//   release's, a Lay out's) are gathered on a microtask: up to three are each
//   voiced, four or more go through the listening page's cascade (R75).
// - At drop start each voice's exact render is asked for (R76's kind and
//   speed, the ear 2-6 m from the landing, R61), and a sleeping context woken.
// - At its contact frame a voice plays the first of: its exact render, if
//   ready; a variant rendered ahead for the same piece, surfaces and room; its
//   exact render, if that arrives within 45 ms (R80). Otherwise it is dropped,
//   and the tap logs why. The surfaces under its feet are read again at
//   contact; a change takes a matching variant or the drop's render, logged
//   stale (Review Focus 5).
// - Silence: a landing whose gesture an undo or redo ended (R87), or whose
//   piece is gone (R89), is dropped. Nothing is asked for before the first
//   gesture, while sound is Off, in a hidden tab, or where module Workers are
//   refused (R83). Loads, undo, redo and other people's changes never start a
//   piece down, so they are silent by construction.
// - Under reduced motion a piece is down at once: its render is asked for at
//   the announcement and it plays when the render answers (R84).
// - The room: its state follows the placement, 250 ms after the last change,
//   and a new state, room or rate asks the Worker for a new tail. A voice's
//   send is the room's (R58), never scaled by distance (R11).
// - Render-ahead (ruling R100): per class of piece, the adaptive policy
//   (set-down-policy.ts) says whether pieces are also rendered ahead, at
//   pickup and while the placement ghost shows. At most one render ahead is in
//   flight per class; a piece put back down, or a ghost that leaves with
//   nothing placed, cancels its class's; a ghost or a carried piece asks again
//   only when the surfaces under it change. Up to three seeds of each variant
//   are kept, played in turn.
// ---------------------------------------------------------------------------

/** One tail per room state, as the listening page seeds it. */
const TAIL_SEED = 1;
/** Placement changes are gathered this long before the room is worked out again. */
const ROOM_SETTLE_MS = 250;
/** How often a carried piece, or the ghost, is looked at again for new surfaces under it. */
const SUPPORTS_CHECK_MS = 250;
/** Variants kept for one piece on one set of surfaces in one room: seeds 1-3. */
const VARIANT_SEEDS = 3;
/** Variants kept in all: each holds a few hundred kilobytes of samples. */
const VARIANTS_KEPT = 18;
/** A carried piece's variant lands as a let-go from a still hand (R76): the softest settle. */
const VARIANT_HAND_SPEED = 0;
/** The placement ghost's stand-in, never a placed piece's id. */
const GHOST_ID = "set-down-ghost";
const HEARD_WINDOW_MS = HEARD_WINDOW_S * 1000;

/** The driver, as the shell hears the motion and the frame loop for it. */
export interface SetDownDriver extends FurnitureLandingListener {
  /** The scene's frame, after the motion's: the contacts it heard are played here. */
  frame(deltaSeconds: number): void;
  /** Lets go of every subscription, timer and the Worker. */
  dispose(): void;
}

type RendererFactory = () => SetDownRenderer | null;
const workerRenderer: RendererFactory = () => createSetDownRenderer();
let rendererFactory: RendererFactory = workerRenderer;

/** Test seam: a stand-in for the Worker's client, made at arming as the real one is. */
export function __setSetDownRendererFactoryForTests(factory: RendererFactory | null): void {
  rendererFactory = factory ?? workerRenderer;
}

interface Landing {
  readonly id: string;
  readonly landing: FurnitureLanding;
  readonly handSpeed: number;
  readonly delaySeconds: number;
  /** Reduced motion: down at once, with no contact frame. */
  readonly inPlace: boolean;
  /** The history epoch its gesture began in (R87). */
  readonly epoch: number;
}

interface Batch {
  /** Its voices not yet played or dropped: what its first contact asks the registry for. */
  live: number;
  /** Undefined until its first contact (or first play under reduced motion); null if refused. */
  admitted: SetDownBatch | null | undefined;
  /** The page time of its first contact, and that voice's cascade offset. */
  firstAtMs: number;
  firstOffsetSeconds: number;
}

interface Contact {
  /** The page time of the contact frame. */
  readonly atMs: number;
  /** When that frame is shown, on the context's clock, ms (for the tap). */
  readonly contactMs: number;
  /** From the exact render's request to the contact, ms: the time it had. */
  readonly windowMs: number;
  readonly directGain: number;
  readonly surface: string;
  /** The surfaces under the feet changed since the drop started. */
  readonly stale: boolean;
  /** A variant played at the contact, so the exact render need not. */
  covered: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Flight {
  readonly id: string;
  /** Its exact render's job key: `exact|<room>|<piece>|<n>`. */
  readonly key: string;
  readonly batch: Batch;
  readonly cls: RenderClass;
  readonly slug: string;
  readonly landing: FurnitureLanding;
  readonly handSpeed: number;
  readonly cacheKey: string;
  readonly surfacesKey: string;
  readonly offsetSeconds: number;
  readonly levelDb: number;
  readonly epoch: number;
  readonly inPlace: boolean;
  readonly askedMs: number;
  exact: SetDownRendered | null;
  failed: boolean;
  contactAtMs: number | null;
  contact: Contact | null;
  done: boolean;
}

/** A render input, with what the driver keys and plays it by. */
interface Gathered {
  readonly input: SetDownInput;
  readonly directGain: number;
  readonly surfacesKey: string;
  readonly slug: string;
  /** The surfaces' kinds, for the tap. */
  readonly surface: string;
  /** Piece, scale, kind, surfaces, room and rate: what a variant must match to stand in. */
  readonly cacheKey: string;
}

interface AheadRequest {
  readonly cacheKey: string;
  readonly input: SetDownInput;
}

interface AheadSlot {
  /** The class's one render ahead in flight. */
  running: { readonly key: string; readonly cacheKey: string; readonly spaceKey: string } | null;
  /** The newest request made while it ran: it goes next, replacing any older one. */
  next: AheadRequest | null;
}

/** The slice of the editor's history a travel is read from: each step's stable sequence number. */
interface HistoryStacks {
  readonly past: readonly { readonly seq: number }[];
  readonly future: readonly { readonly seq: number }[];
}

/**
 * Whether the history moved other than forward (R87): an undo, a redo, a
 * reset or load, or steps forgotten. A new step, a step merged into the last,
 * or ids renamed by a save keep the same epoch. Sequence numbers are the
 * history's own stable names for its steps (editor-history.ts).
 */
function historyTravelled(previous: HistoryStacks, next: HistoryStacks): boolean {
  if (previous === next) return false;
  const lastBefore = previous.past.at(-1)?.seq ?? 0;
  const lastNow = next.past.at(-1)?.seq ?? 0;
  const redoBefore = previous.future.at(-1)?.seq;
  const redoNow = next.future.at(-1)?.seq;
  if (lastBefore === lastNow && redoBefore === redoNow) return false;
  if (redoBefore !== undefined && lastNow === redoBefore) return true;
  if (next.future.length === 0 && lastNow > lastBefore) return false;
  return true;
}

/** A room's name in keys: its slug and id, never with a "|". */
function spaceKeyOf(space: { readonly slug: string; readonly id: string } | null): string {
  return space === null ? "none" : `${space.slug}:${space.id}`.replace(/\|/gu, "/");
}

/** Reported, never swallowed, and never thrown into the motion (as the landings' listeners, R86). */
function reportAsync(error: unknown): void {
  const host: { reportError?: (error: unknown) => void } = globalThis;
  if (typeof host.reportError === "function") host.reportError(error);
  else queueMicrotask(() => { throw error; });
}

function pageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** Sound on and the page shown: what every play needs, besides a context. */
function soundAllowed(): boolean {
  return getPlannerSoundSettings().mode !== "off" && !pageHidden();
}

function classOf(item: PlacedItem): RenderClass {
  return massForCategory(getCatalogueItem(item.catalogueItemId)?.category);
}

/**
 * Starts the driver: it watches the room, the history and the ghost at once,
 * and makes the Worker's client when the first gesture makes the context.
 * `camera` is read at each drop start for where the set-down is heard.
 */
export function startSetDownDriver(camera: () => Camera): SetDownDriver {
  let disposed = false;
  const policy = new AdaptiveRenderPolicy();
  let renderer: SetDownRenderer | null = null;
  let refused = false;
  let brokenReported = false;
  let rate: number | null = null;

  let space = useEditorStore.getState().space;
  let spaceKey = spaceKeyOf(space);
  let acoustics: RoomAcoustics | null = space === null ? null : roomAcousticsFor(space);
  let geometry: RoomGeometry | null = space === null ? null : resolveRoomGeometry(space);
  let room: RoomState | null = null;
  let tailKey: string | null = null;
  let roomTimer: ReturnType<typeof setTimeout> | null = null;

  let history: HistoryStacks = useEditorStore.getState().history;
  let historyEpoch = 0;
  /** The epoch each piece in hand was taken up in: its landing's gesture began then (R87). */
  const takenUpIn = new Map<string, number>();

  let serial = 0;
  let seed = 0;
  const gathering = new Map<string, Landing>();
  let flushQueued = false;
  const flights = new Map<string, Flight>();
  const contacts: Flight[] = [];

  const slots: Record<RenderClass, AheadSlot> = {
    light: { running: null, next: null },
    table: { running: null, next: null },
    heavy: { running: null, next: null },
  };
  /** Per class, the piece in hand it rendered ahead for last, and the variant it asked for. */
  const carried = new Map<RenderClass, { readonly id: string; readonly cacheKey: string }>();
  let carriedCheckedMs = Number.NEGATIVE_INFINITY;
  const variants = new Map<string, readonly SetDownRendered[]>();
  const variantTurns = new Map<string, number>();
  let ghost: { readonly cls: RenderClass; readonly catalogueItemId: string; readonly cacheKey: string; placed: boolean } | null = null;
  let ghostTimer: ReturnType<typeof setTimeout> | null = null;
  let ghostCheckedMs = Number.NEGATIVE_INFINITY;

  const nowMs = (): number => performance.now();

  /** The Worker's client, unless it is not made yet, refused or broken. */
  const working = (): SetDownRenderer | null => (renderer !== null && !renderer.broken ? renderer : null);

  /** Whether a landing may be rendered for at all. */
  const canSound = (): boolean => working() !== null && rate !== null && space !== null && soundAllowed();

  const placedItem = (id: string): PlacedItem | null => usePlacementStore.getState().placedItems.find((item) => item.id === id) ?? null;

  const failed = (error: unknown): void => {
    if (error instanceof SetDownCancelled) return;
    if (error instanceof SetDownRendererBroken || renderer?.broken === true) {
      if (brokenReported) return;
      brokenReported = true;
    }
    reportAsync(new Error("A set-down render failed in the Worker", { cause: error }));
  };

  /** Where the camera is, in metres, and its right. */
  const cameraPose = (): { readonly position: Vec3; readonly right: Vec3 } => {
    const view = camera();
    view.updateWorldMatrix(true, false);
    const e = view.matrixWorld.elements;
    return {
      position: { x: toRealWorld(e[12]), y: toRealWorld(e[13]), z: toRealWorld(e[14]) },
      right: { x: e[0], y: e[1], z: e[2] },
    };
  };

  /** The render input for `item` landing where it stands now, or null with no room or rate. */
  const gather = (item: PlacedItem, landing: FurnitureLanding, handSpeed: number, renderSeed: number): Gathered | null => {
    if (space === null || acoustics === null || rate === null) return null;
    const source: Vec3 = { x: toRealWorld(item.x), y: toRealWorld(item.y), z: toRealWorld(item.z) };
    const voice = voiceInput({
      item,
      placedItems: usePlacementStore.getState().placedItems,
      roomSlug: space.slug,
      geometry,
      acoustics,
      ear: earFor(cameraPose(), source, useCockpitStore.getState().walkMode),
      landing,
      handSpeed,
      seed: renderSeed,
      sampleRate: rate,
    });
    const kinds = [...new Set(voice.input.surfaces.map((surface) => surface.kind))];
    return {
      input: voice.input,
      directGain: voice.directGain,
      surfacesKey: voice.surfacesKey,
      slug: voice.slug,
      surface: kinds.join("+"),
      cacheKey: [voice.slug, String(item.scale ?? 1), voice.input.kind, voice.surfacesKey, spaceKey, String(rate)].join("|"),
    };
  };

  // --- The room -----------------------------------------------------------------------------

  const requestTail = (): void => {
    const worker = working();
    if (worker === null || rate === null || room === null || acoustics === null) return;
    const key = `tail|${spaceKey}|${room.key}|${String(rate)}`;
    if (key === tailKey) return;
    tailKey = key;
    worker.tail(room.rt, { sampleRate: rate, seed: TAIL_SEED, onsetSeconds: tailOnsetSeconds(acoustics) }, key).then((tail) => {
      if (!disposed && tailKey === key) setPlannerRoomTail(tail, key);
    }, (error: unknown) => {
      // A failed tail is asked for again by the next change; a replaced or cancelled one already was.
      if (tailKey === key && !(error instanceof SetDownCancelled)) tailKey = null;
      failed(error);
    }).catch(reportAsync);
  };

  const computeRoom = (): void => {
    room = acoustics === null ? null : roomState(acoustics, usePlacementStore.getState().placedItems);
    requestTail();
  };

  const clearRoomTimer = (): void => {
    if (roomTimer !== null) clearTimeout(roomTimer);
    roomTimer = null;
  };

  const roomChanged = (): void => {
    clearRoomTimer();
    roomTimer = setTimeout(() => {
      roomTimer = null;
      computeRoom();
    }, ROOM_SETTLE_MS);
  };

  // --- Render-ahead (R100) ------------------------------------------------------------------

  const keepVariant = (cacheKey: string, render: SetDownRendered): void => {
    const kept = variants.get(cacheKey) ?? [];
    if (kept.length >= VARIANT_SEEDS) return;
    variants.delete(cacheKey);
    variants.set(cacheKey, [...kept, render]);
    let total = 0;
    for (const list of variants.values()) total += list.length;
    for (const [key, list] of variants) {
      if (total <= VARIANTS_KEPT) break;
      variants.delete(key);
      variantTurns.delete(key);
      total -= list.length;
    }
  };

  const variantFor = (cacheKey: string): SetDownRendered | null => {
    const kept = variants.get(cacheKey);
    if (kept === undefined || kept.length === 0) return null;
    const turn = variantTurns.get(cacheKey) ?? 0;
    variantTurns.set(cacheKey, turn + 1);
    return kept[turn % kept.length] ?? null;
  };

  /** A render ahead for `item` landing where it stands, at the next of its variant's three seeds. */
  const aheadFor = (item: PlacedItem, landing: FurnitureLanding): AheadRequest | null => {
    const gathered = gather(item, landing, VARIANT_HAND_SPEED, 1);
    if (gathered === null) return null;
    const next = (variants.get(gathered.cacheKey)?.length ?? 0) + 1;
    return { cacheKey: gathered.cacheKey, input: { ...gathered.input, seed: next } };
  };

  /** Drops the class's waiting request, and its render ahead if the Worker has not started it. */
  const cancelAhead = (cls: RenderClass): void => {
    const slot = slots[cls];
    slot.next = null;
    const running = slot.running;
    if (running !== null) working()?.cancel((key) => key === running.key);
  };

  /** At most one render ahead in flight per class: a request while one runs waits, the newest replacing older ones. */
  const askAhead = (cls: RenderClass, request: AheadRequest): void => {
    if ((variants.get(request.cacheKey)?.length ?? 0) >= VARIANT_SEEDS) return;
    const slot = slots[cls];
    if (slot.running !== null) {
      if (slot.running.cacheKey !== request.cacheKey) slot.next = request;
      return;
    }
    const worker = working();
    if (worker === null) return;
    serial += 1;
    const running = { key: `ahead|${cls}|${spaceKey}|${String(serial)}`, cacheKey: request.cacheKey, spaceKey };
    slot.running = running;
    worker.render(request.input, "ahead", running.key).then((render) => {
      policy.recordWork(cls, render.workMs);
      if (!disposed && running.spaceKey === spaceKey) keepVariant(running.cacheKey, render);
    }, failed).finally(() => {
      if (slot.running !== running) return;
      slot.running = null;
      const next = slot.next;
      slot.next = null;
      if (next !== null && !disposed) askAhead(cls, next);
    }).catch(reportAsync);
  };

  const checkCarried = (): void => {
    const atMs = nowMs();
    if (atMs - carriedCheckedMs < SUPPORTS_CHECK_MS) return;
    carriedCheckedMs = atMs;
    for (const [cls, held] of carried) {
      const item = placedItem(held.id);
      if (item === null || !canSound() || policy.mode(cls) !== "ahead") {
        carried.delete(cls);
        continue;
      }
      const request = aheadFor(item, "let-go");
      if (request === null || request.cacheKey === held.cacheKey) continue;
      carried.set(cls, { id: held.id, cacheKey: request.cacheKey });
      askAhead(cls, request);
    }
  };

  const leaveGhost = (): void => {
    if (ghostTimer !== null) clearTimeout(ghostTimer);
    ghostTimer = null;
    const left = ghost;
    ghost = null;
    if (left !== null && !left.placed) cancelAhead(left.cls);
  };

  /** The placement ghost moved, turned, changed piece or went: render its piece ahead when its surfaces change. */
  const ghostChanged = (): void => {
    const { ghostPosition, ghostRotation } = usePlacementStore.getState();
    const catalogueItemId = useCatalogueStore.getState().selectedItemId;
    if (ghostPosition === null || catalogueItemId === null) {
      leaveGhost();
      return;
    }
    const waitMs = ghostCheckedMs + SUPPORTS_CHECK_MS - nowMs();
    if (waitMs > 0) {
      ghostTimer ??= setTimeout(() => {
        ghostTimer = null;
        ghostChanged();
      }, waitMs);
      return;
    }
    ghostCheckedMs = nowMs();
    const entry = getCatalogueItem(catalogueItemId);
    if (entry === undefined) return;
    const cls = massForCategory(entry.category);
    if (!canSound() || policy.mode(cls) !== "ahead") return;
    const standIn = createPlacedItem(catalogueItemId, ghostPosition[0], ghostPosition[2], ghostRotation, null, ghostPosition[1], GHOST_ID);
    const request = aheadFor(standIn, "drop-in");
    if (request === null) return;
    if (ghost !== null && ghost.catalogueItemId === catalogueItemId && ghost.cacheKey === request.cacheKey) return;
    ghost = { cls, catalogueItemId, cacheKey: request.cacheKey, placed: false };
    askAhead(cls, request);
  };

  // --- Flights ------------------------------------------------------------------------------

  const finish = (flight: Flight): void => {
    if (flight.done) return;
    flight.done = true;
    const contact = flight.contact;
    if (contact !== null && contact.timer !== null) {
      clearTimeout(contact.timer);
      contact.timer = null;
    }
    if (flights.get(flight.id) === flight) flights.delete(flight.id);
    flight.batch.live -= 1;
  };

  /** A later start for the same piece takes its place (the latest dropStarted counts). */
  const retire = (flight: Flight): void => {
    finish(flight);
    working()?.cancel((key) => key === flight.key);
  };

  const drop = (flight: Flight, why: SetDownDrop): void => {
    logSetDownDrop({
      drop: why,
      slug: flight.slug,
      ...(flight.contact === null ? {} : { contactMs: flight.contact.contactMs }),
      ...(flight.exact === null ? {} : { workMs: flight.exact.workMs }),
    });
    if (flight.exact === null && !flight.failed) working()?.cancel((key) => key === flight.key);
    finish(flight);
  };

  /** Tells the policy how the exact render arrived at this contact; a class back at its drop asks nothing ahead. */
  const judge = (flight: Flight, timing: ContactTiming, workMs: number | null): void => {
    const contact = flight.contact;
    if (flight.inPlace || contact === null) return;
    const before = policy.mode(flight.cls);
    const after = policy.recordContact(flight.cls, { timing, workMs, windowMs: contact.windowMs });
    if (before === "ahead" && after === "exact") {
      cancelAhead(flight.cls);
      carried.delete(flight.cls);
      if (ghost?.cls === flight.cls) ghost = null;
    }
  };

  /** How much later than its own contact a cascade voice waits, so the voices keep their spacing (R75). */
  const cascadeWait = (flight: Flight, atMs: number): number => {
    const { batch } = flight;
    return Math.max(0, flight.offsetSeconds - batch.firstOffsetSeconds - (atMs - batch.firstAtMs) / 1000);
  };

  const beginBatch = (flight: Flight, atMs: number): void => {
    const { batch } = flight;
    if (batch.admitted !== undefined) return;
    batch.admitted = beginSetDownBatch(batch.live);
    batch.firstAtMs = atMs;
    batch.firstOffsetSeconds = flight.offsetSeconds;
  };

  const play = (flight: Flight, render: SetDownRendered, played: SetDownPlayed, startAt: number): void => {
    const contact = flight.contact;
    const state = room;
    if (contact === null || state === null) return;
    const voice: SetDownVoice = {
      render,
      startAt,
      levelDb: flight.levelDb,
      directGain: contact.directGain,
      send: state.send,
      tap: { slug: flight.slug, surface: contact.surface, rtMid: state.rt[3], contactMs: contact.contactMs, played, workMs: render.workMs },
    };
    flight.batch.admitted?.play(voice);
  };

  /** The contact passed 45 ms ago with no exact render (R80). */
  const missed = (flight: Flight): void => {
    if (flight.done) return;
    judge(flight, "miss", null);
    if (flight.contact?.covered === true) finish(flight);
    else drop(flight, "too-late");
  };

  /** A piece seen to land: what plays now, and how the policy hears it. */
  const land = (flight: Flight, presentDelay: number): void => {
    if (flight.done) return;
    const atMs = flight.contactAtMs ?? nowMs();
    if (flight.epoch !== historyEpoch) {
      drop(flight, "undone");
      return;
    }
    const item = placedItem(flight.id);
    if (item === null) {
      drop(flight, "gone");
      return;
    }
    const clock = plannerAudioClock();
    const now = clock === null || !soundAllowed() ? null : gather(item, flight.landing, flight.handSpeed, 1);
    if (clock === null || now === null) {
      finish(flight);
      return;
    }
    beginBatch(flight, atMs);
    const contact: Contact = {
      atMs,
      contactMs: (clock.currentTime + presentDelay) * 1000,
      windowMs: atMs - flight.askedMs,
      directGain: now.directGain,
      surface: now.surface,
      stale: now.surfacesKey !== flight.surfacesKey,
      covered: false,
      timer: null,
    };
    flight.contact = contact;
    const startAt = (render: SetDownRendered): number => setDownStartTime(clock, presentDelay, render.onsetSeconds) + cascadeWait(flight, atMs);
    if (flight.exact !== null) {
      judge(flight, "on-time", flight.exact.workMs);
      const variant = contact.stale ? variantFor(now.cacheKey) : null;
      if (variant !== null) play(flight, variant, "variant", startAt(variant));
      else play(flight, flight.exact, contact.stale ? "stale" : "exact", startAt(flight.exact));
      finish(flight);
      return;
    }
    const variant = variantFor(contact.stale ? now.cacheKey : flight.cacheKey);
    if (variant !== null) {
      play(flight, variant, "variant", startAt(variant));
      contact.covered = true;
    }
    if (flight.failed) {
      if (contact.covered) finish(flight);
      else drop(flight, "failed");
      return;
    }
    contact.timer = setTimeout(() => {
      contact.timer = null;
      missed(flight);
    }, HEARD_WINDOW_MS);
  };

  /** Reduced motion: the piece is down already, so its render plays as it answers (R84). */
  const playInPlace = (flight: Flight, render: SetDownRendered): void => {
    if (flight.epoch !== historyEpoch) {
      drop(flight, "undone");
      return;
    }
    const item = placedItem(flight.id);
    if (item === null) {
      drop(flight, "gone");
      return;
    }
    const clock = plannerAudioClock();
    const now = clock === null || !soundAllowed() ? null : gather(item, flight.landing, flight.handSpeed, 1);
    if (clock === null || now === null) {
      finish(flight);
      return;
    }
    const atMs = nowMs();
    beginBatch(flight, atMs);
    flight.contact = { atMs, contactMs: clock.currentTime * 1000, windowMs: 0, directGain: now.directGain, surface: now.surface, stale: false, covered: false, timer: null };
    play(flight, render, "exact", clock.currentTime + cascadeWait(flight, atMs));
    finish(flight);
  };

  const answered = (flight: Flight, render: SetDownRendered): void => {
    policy.recordWork(flight.cls, render.workMs);
    if (flight.done || disposed) return;
    flight.exact = render;
    if (flight.inPlace) {
      playInPlace(flight, render);
      return;
    }
    const contact = flight.contact;
    // Ready before its contact: the contact plays it.
    if (contact === null) return;
    if (nowMs() - contact.atMs > HEARD_WINDOW_MS) {
      missed(flight);
      return;
    }
    judge(flight, "late", render.workMs);
    if (contact.covered) {
      finish(flight);
      return;
    }
    if (flight.epoch !== historyEpoch) {
      drop(flight, "undone");
      return;
    }
    if (placedItem(flight.id) === null) {
      drop(flight, "gone");
      return;
    }
    const clock = plannerAudioClock();
    if (clock !== null && soundAllowed()) play(flight, render, "late", clock.currentTime + cascadeWait(flight, nowMs()));
    finish(flight);
  };

  const renderFailed = (flight: Flight, error: unknown): void => {
    failed(error);
    if (flight.done) return;
    flight.failed = true;
    if (error instanceof SetDownCancelled) {
      finish(flight);
      return;
    }
    // Before its contact, the contact decides: a variant, or nothing.
    if (flight.contact === null && !flight.inPlace) return;
    if (flight.contact?.covered === true) finish(flight);
    else drop(flight, "failed");
  };

  // --- Landings ------------------------------------------------------------------------------

  const flush = (): void => {
    flushQueued = false;
    if (gathering.size === 0) return;
    const landings = [...gathering.values()];
    gathering.clear();
    if (disposed) return;
    for (const landing of landings) {
      const earlier = flights.get(landing.id);
      if (earlier !== undefined) retire(earlier);
      // A piece put back down: its class's render ahead could not now come before its exact render (condition 2).
      for (const [cls, held] of carried) {
        if (held.id !== landing.id) continue;
        carried.delete(cls);
        cancelAhead(cls);
      }
    }
    const worker = working();
    if (worker === null || !canSound()) return;
    const placed = new Map(usePlacementStore.getState().placedItems.map((item) => [item.id, item]));
    const present = landings.flatMap((landing) => {
      const item = placed.get(landing.id);
      return item === undefined ? [] : [{ landing, item }];
    });
    if (present.length === 0) return;
    const ghostNow = ghost;
    if (ghostNow !== null && present.some(({ landing, item }) => !landing.inPlace && item.catalogueItemId === ghostNow.catalogueItemId)) ghostNow.placed = true;
    const least = Math.min(...present.map(({ landing }) => landing.delaySeconds));
    const byId = new Map(present.map((entry) => [entry.landing.id, entry]));
    const pieces: CascadePiece[] = present.map(({ landing, item }) => ({
      id: landing.id,
      family: bodyFor(getCatalogueItem(item.catalogueItemId)?.slug ?? item.catalogueItemId, item.scale).family,
      landsAfterSeconds: landing.delaySeconds - least,
    }));
    seed += 1;
    const voices = planCascade(pieces, seed);
    const batch: Batch = { live: 0, admitted: undefined, firstAtMs: 0, firstOffsetSeconds: 0 };
    const askedMs = nowMs();
    for (const voice of voices) {
      const entry = byId.get(voice.id);
      seed += 1;
      const gathered = entry === undefined ? null : gather(entry.item, entry.landing.landing, entry.landing.handSpeed, seed);
      if (entry === undefined || gathered === null) continue;
      serial += 1;
      const flight: Flight = {
        id: voice.id,
        key: `exact|${spaceKey}|${voice.id}|${String(serial)}`,
        batch,
        cls: classOf(entry.item),
        slug: gathered.slug,
        landing: entry.landing.landing,
        handSpeed: entry.landing.handSpeed,
        cacheKey: gathered.cacheKey,
        surfacesKey: gathered.surfacesKey,
        offsetSeconds: voice.offsetSeconds,
        levelDb: voice.levelDb,
        epoch: entry.landing.epoch,
        inPlace: entry.landing.inPlace,
        askedMs,
        exact: null,
        failed: false,
        contactAtMs: null,
        contact: null,
        done: false,
      };
      batch.live += 1;
      flights.set(flight.id, flight);
      worker.render(gathered.input, "exact", flight.key)
        .then((render) => { answered(flight, render); }, (error: unknown) => { renderFailed(flight, error); })
        .catch(reportAsync);
    }
    if (batch.live > 0) wakePlannerSound();
  };

  const gatherLanding = (landing: Landing): void => {
    gathering.delete(landing.id);
    gathering.set(landing.id, landing);
    if (flushQueued) return;
    flushQueued = true;
    queueMicrotask(flush);
  };

  // --- Subscriptions --------------------------------------------------------------------------

  const changeSpace = (next: typeof space): void => {
    space = next;
    spaceKey = spaceKeyOf(next);
    acoustics = next === null ? null : roomAcousticsFor(next);
    geometry = next === null ? null : resolveRoomGeometry(next);
    // Every queued job was the old room's: its tails, its set-downs, its renders ahead.
    working()?.cancel(() => true);
    for (const flight of [...flights.values()]) finish(flight);
    gathering.clear();
    contacts.length = 0;
    carried.clear();
    variants.clear();
    variantTurns.clear();
    for (const slot of Object.values(slots)) slot.next = null;
    leaveGhost();
    tailKey = null;
    clearRoomTimer();
    computeRoom();
  };

  let placedItems = usePlacementStore.getState().placedItems;
  let ghostPosition = usePlacementStore.getState().ghostPosition;
  let ghostRotation = usePlacementStore.getState().ghostRotation;
  let selectedItemId = useCatalogueStore.getState().selectedItemId;

  const stopEditor = useEditorStore.subscribe((state) => {
    if (state.history !== history) {
      if (historyTravelled(history, state.history)) historyEpoch += 1;
      history = state.history;
    }
    if (spaceKeyOf(state.space) !== spaceKey) changeSpace(state.space);
    else space = state.space;
  });
  const stopPlacement = usePlacementStore.subscribe((state) => {
    if (state.placedItems !== placedItems) {
      placedItems = state.placedItems;
      roomChanged();
    }
    if (state.ghostPosition !== ghostPosition || state.ghostRotation !== ghostRotation) {
      ghostPosition = state.ghostPosition;
      ghostRotation = state.ghostRotation;
      ghostChanged();
    }
  });
  const stopCatalogue = useCatalogueStore.subscribe((state) => {
    if (state.selectedItemId === selectedItemId) return;
    selectedItemId = state.selectedItemId;
    ghostChanged();
  });

  computeRoom();

  // The first gesture makes the context; the Worker starts with it, and the room's tail is made at its rate.
  const stopArmed = subscribePlannerSoundArmed((sampleRate) => {
    if (disposed) return;
    if (rate !== sampleRate) {
      variants.clear();
      variantTurns.clear();
    }
    rate = sampleRate;
    if (renderer === null && !refused) {
      renderer = rendererFactory();
      refused = renderer === null;
    }
    requestTail();
  });

  return {
    pickedUp(id) {
      takenUpIn.set(id, historyEpoch);
      if (!canSound()) return;
      const item = placedItem(id);
      if (item === null) return;
      const cls = classOf(item);
      if (policy.mode(cls) !== "ahead") return;
      const request = aheadFor(item, "let-go");
      if (request === null) return;
      carried.set(cls, { id, cacheKey: request.cacheKey });
      askAhead(cls, request);
    },

    dropStarted(id, landing, handSpeed, delaySeconds) {
      const epoch = takenUpIn.get(id) ?? historyEpoch;
      takenUpIn.delete(id);
      gatherLanding({ id, landing, handSpeed, delaySeconds, inPlace: false, epoch });
    },

    touchedDown(id) {
      // Started down and landed in one task (a long frame): the start is heard first.
      if (gathering.has(id)) flush();
      const flight = flights.get(id);
      if (flight === undefined || flight.done || flight.inPlace || flight.contactAtMs !== null) return;
      flight.contactAtMs = nowMs();
      contacts.push(flight);
    },

    landedInPlace(id, landing, handSpeed) {
      takenUpIn.delete(id);
      gatherLanding({ id, landing, handSpeed, delaySeconds: 0, inPlace: true, epoch: historyEpoch });
    },

    frame(deltaSeconds) {
      if (disposed) return;
      if (contacts.length > 0) {
        const presentDelay = presentDelayFor(deltaSeconds);
        for (const flight of contacts) land(flight, presentDelay);
        contacts.length = 0;
      }
      if (carried.size > 0) checkCarried();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      stopEditor();
      stopPlacement();
      stopCatalogue();
      stopArmed();
      clearRoomTimer();
      if (ghostTimer !== null) clearTimeout(ghostTimer);
      ghostTimer = null;
      for (const flight of [...flights.values()]) finish(flight);
      gathering.clear();
      contacts.length = 0;
      carried.clear();
      variants.clear();
      takenUpIn.clear();
      renderer?.dispose();
      renderer = null;
    },
  };
}
