import type { Camera } from "three";
import type { Space } from "../../api/spaces.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { massForCategory, type FurnitureLanding, type FurnitureLandingListener } from "../../lib/furniture-motion.js";
import type { PlacedItem } from "../../lib/placement.js";
import { reportAsync, shielded } from "../../lib/report-async.js";
import { bodyFor } from "../../lib/set-down/bodies.js";
import { planCascade, type CascadePiece } from "../../lib/set-down/cascade.js";
import {
  SetDownCancelled,
  SetDownRendererBroken,
  createSetDownRenderer,
  type SetDownRendered,
  type SetDownRenderer,
} from "../../lib/set-down/renderer.js";
import { playsAsRendered, respatializeSetDown, type SetDownDirect } from "../../lib/set-down/respatialize.js";
import { HEARD_WINDOW_S, presentDelayFor, setDownStartTime, type AudioClock } from "../../lib/set-down/timing.js";
import {
  beginSetDownBatch,
  getPlannerSoundSettings,
  logSetDownDrop,
  plannerAudioClock,
  subscribePlannerSound,
  subscribePlannerSoundArmed,
  wakePlannerSound,
  type SetDownBatch,
  type SetDownDrop,
  type SetDownPlayed,
  type SetDownVoice,
} from "../../lib/sound-registry.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { editorHistoryTravels, useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { AheadRenders } from "./set-down-ahead.js";
import { AdaptiveRenderPolicy, type ContactTiming, type RenderClass } from "./set-down-policy.js";
import { SetDownRoom, spaceKeyOf } from "./set-down-room.js";

// ---------------------------------------------------------------------------
// The set-down driver (T-700, Task 14b): the motion's landings, rendered in the
// Worker and played on each piece's contact frame through the room the planner
// shows. SetDownSound imports it lazily (R78); nothing here renders on the main
// thread (R48), and only the registry makes sound. The room and its tail are
// set-down-room.ts's; the renders made ahead, set-down-ahead.ts's; which
// classes render ahead, set-down-policy.ts's (R100).
//
// - A batch. The pieces that start down in one task (a placement's, a
//   release's, a Lay out's) are gathered on a microtask: up to three are each
//   voiced, four or more go through the listening page's cascade (R75).
// - At drop start each voice's exact render is asked for (R76's kind and
//   speed, the ear 2-6 m from the landing, R61), and a sleeping context woken.
// - A voice is due at its slot: its contact frame, or for a cascade voice its
//   own place in the cascade after it (R105). It plays the first of: its exact
//   render, if ready by its slot; a variant rendered ahead for the same piece,
//   surfaces and room; its exact render, if that arrives within 45 ms after
//   its slot (R80). Otherwise it is dropped, and the tap logs why. The policy
//   judges each voice against its slot in the same way. The surfaces under its
//   feet are read again at contact; a change takes a matching variant or the
//   drop's render, logged stale (Review Focus 5).
// - Silence: a landing whose gesture an undo, a redo, a reset or a load left
//   (R87, the editor's own count of its travels), or whose piece is gone
//   (R89), is dropped. Nothing is asked for before the first gesture, while
//   sound is Off, in a hidden tab, or where module Workers are refused (R83).
//   Loads, undo, redo and other people's changes never start a piece down.
// - Under reduced motion a piece is down at once: its render is asked for at
//   the announcement and it plays when the render answers (R84).
// - Every store listener and the frame are shielded: what throws in them is
//   reported, never thrown into the store or the scene's loop (R86).
// ---------------------------------------------------------------------------

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
  /** The editor's travels when its gesture began (R87). */
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
  /**
   * When its voice is due, page time: its contact, or for a cascade voice its
   * own slot after it (R105). Its exact render is on time if ready by then,
   * late within 45 ms after, and missed past that.
   */
  readonly slotMs: number;
  /** When that frame is shown, on the context's clock, ms (for the tap). */
  readonly contactMs: number;
  /** The contact frame's wait until it is shown, s: the lead an on-time voice keeps. */
  readonly presentDelay: number;
  /** From the exact render's request to its slot, ms: the time it had. */
  readonly windowMs: number;
  /** Its direct sound as the ear hears it at contact: the dry gain every voice of it plays at, and the angle (R104). */
  readonly direct: SetDownDirect;
  readonly surface: string;
  /** The variant key at the contact: what a variant must match to stand in. */
  readonly cacheKey: string;
  /** The surfaces under the feet changed since the drop started. */
  readonly stale: boolean;
  /** Its slot has come: a variant played if there was one, and the 45 ms are running. */
  slotPassed: boolean;
  /** A variant played at the slot, so the exact render need not. */
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
  /** The Worker had said it was ready when its render was asked for: its timing is this device's, not its start-up's. */
  readonly askedReady: boolean;
  exact: SetDownRendered | null;
  failed: boolean;
  contactAtMs: number | null;
  contact: Contact | null;
  done: boolean;
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
 * Starts the driver: it watches the room, the ghost and the sound's setting at
 * once, and makes the Worker's client when the first gesture makes the
 * context. `camera` is read at each drop start for where the set-down is heard.
 */
export function startSetDownDriver(camera: () => Camera): SetDownDriver {
  let disposed = false;
  const policy = new AdaptiveRenderPolicy();
  let renderer: SetDownRenderer | null = null;
  let refused = false;
  let brokenReported = false;

  /** The editor's travels when each piece in hand was taken up: its landing's gesture began then (R87). */
  const takenUpIn = new Map<string, number>();
  let serial = 0;
  let seed = 0;
  const gathering = new Map<string, Landing>();
  let flushQueued = false;
  const flights = new Map<string, Flight>();
  const contacts: Flight[] = [];

  const nowMs = (): number => performance.now();

  /** The Worker's client, unless it is not made yet, refused or broken. */
  const working = (): SetDownRenderer | null => (renderer !== null && !renderer.broken ? renderer : null);

  const placedItem = (id: string): PlacedItem | null => usePlacementStore.getState().placedItems.find((item) => item.id === id) ?? null;

  const failed = (error: unknown): void => {
    if (error instanceof SetDownCancelled) return;
    if (error instanceof SetDownRendererBroken || renderer?.broken === true) {
      if (brokenReported) return;
      brokenReported = true;
    }
    reportAsync(new Error("A set-down render failed in the Worker", { cause: error }));
  };

  const room = new SetDownRoom({ working, soundAllowed, failed, camera }, useEditorStore.getState().space);

  /** Whether a landing may be rendered for at all. */
  const canSound = (): boolean => working() !== null && room.ready && soundAllowed();

  const ahead = new AheadRenders({
    working,
    canSound,
    voice: (item, landing, handSpeed, voiceSeed) => room.voice(item, landing, handSpeed, voiceSeed),
    spaceKey: () => room.spaceKey,
    placedItem,
    failed,
    now: nowMs,
  }, policy);

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

  /**
   * Whether a landing may still sound now: its gesture not left by an undo, a
   * redo, a reset or a load (R87), its piece still there (R89), a context to
   * play on and sound allowed. A landing that may not is dropped or finished.
   */
  const stillHeard = (flight: Flight): { readonly item: PlacedItem; readonly clock: AudioClock } | null => {
    if (flight.epoch !== editorHistoryTravels()) {
      drop(flight, "undone");
      return null;
    }
    const item = placedItem(flight.id);
    if (item === null) {
      drop(flight, "gone");
      return null;
    }
    const clock = plannerAudioClock();
    if (clock === null || !soundAllowed()) {
      finish(flight);
      return null;
    }
    return { item, clock };
  };

  /**
   * Tells the policy how the exact render arrived for this voice; a class back
   * at its drop asks nothing ahead. A render asked for before the Worker was
   * ready also waited for its start-up, a one-off cost: it is not judged.
   */
  const judge = (flight: Flight, timing: ContactTiming, workMs: number | null): void => {
    const contact = flight.contact;
    if (flight.inPlace || contact === null || !flight.askedReady) return;
    const before = policy.mode(flight.cls);
    const after = policy.recordContact(flight.cls, { timing, workMs, windowMs: contact.windowMs });
    if (before === "ahead" && after === "exact") ahead.backToExact(flight.cls);
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
    const state = room.state;
    if (contact === null || state === null) return;
    const voice: SetDownVoice = {
      render,
      startAt,
      levelDb: flight.levelDb,
      directGain: contact.direct.gain,
      send: state.send,
      tap: { slug: flight.slug, surface: contact.surface, rtMid: state.rt[3], contactMs: contact.contactMs, played, workMs: render.workMs },
    };
    // Refused here (the policy's gap, burst or eight a second, or its batch's count or time used up): on the tap,
    // so Task 16 can tell it from a landing that never came (Minor 2).
    if (flight.batch.admitted?.play(voice) !== true) logSetDownDrop({ drop: "refused", slug: flight.slug, contactMs: contact.contactMs });
  };

  /** Its slot passed 45 ms ago with no exact render (R80, R105). */
  const missed = (flight: Flight): void => {
    if (flight.done) return;
    judge(flight, "miss", null);
    if (flight.contact?.covered === true) finish(flight);
    else drop(flight, "too-late");
  };

  /**
   * On the context's clock now, the start of a voice heard at its slot: an
   * on-time voice's, the contact frame's lead kept, so a cascade voice
   * answered after its contact but by its slot starts exactly as it would
   * have at the contact (R105).
   */
  const onTimeStart = (flight: Flight, contact: Contact, clock: AudioClock, render: SetDownRendered): number =>
    setDownStartTime(clock, contact.presentDelay, render.onsetSeconds) + cascadeWait(flight, nowMs());

  /**
   * A variant rendered ahead for `cacheKey`, heard as this landing is (R104):
   * as rendered when its direct sound came from within 0.2 rad and 1.5 dB of
   * the landing's at contact, otherwise a copy moved to the landing's angle.
   * Its dry gain is the landing's either way (R57); the exact render is never
   * moved. Null when none is kept.
   */
  const variantHeard = (contact: Contact, cacheKey: string): SetDownRendered | null => {
    const kept = ahead.variantFor(cacheKey);
    if (kept === null) return null;
    if (playsAsRendered(kept.direct, contact.direct)) return kept.render;
    const moved = respatializeSetDown(kept.render, kept.direct, contact.direct);
    return { ...kept.render, left: moved.left, right: moved.right };
  };

  /** Its exact render, ready by its slot: played, or a variant for the surfaces it now stands on (Review Focus 5). */
  const playOnTime = (flight: Flight, contact: Contact, clock: AudioClock, exact: SetDownRendered): void => {
    judge(flight, "on-time", exact.workMs);
    const variant = contact.stale ? variantHeard(contact, contact.cacheKey) : null;
    if (variant !== null) play(flight, variant, "variant", onTimeStart(flight, contact, clock, variant));
    else play(flight, exact, contact.stale ? "stale" : "exact", onTimeStart(flight, contact, clock, exact));
    finish(flight);
  };

  /**
   * Its slot came with no exact render: a variant rendered ahead stands in,
   * and its exact render has 45 ms more (R80); one that failed is dropped
   * unless a variant played.
   */
  const due = (flight: Flight, contact: Contact, clock: AudioClock): void => {
    contact.slotPassed = true;
    const variant = variantHeard(contact, contact.stale ? contact.cacheKey : flight.cacheKey);
    if (variant !== null) {
      play(flight, variant, "variant", onTimeStart(flight, contact, clock, variant));
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
    }, Math.max(0, contact.slotMs + HEARD_WINDOW_MS - nowMs()));
  };

  /** A piece seen to land: what plays now, or at its slot, and how the policy hears it. */
  const land = (flight: Flight, presentDelay: number): void => {
    if (flight.done) return;
    const atMs = flight.contactAtMs ?? nowMs();
    const heard = stillHeard(flight);
    if (heard === null) return;
    const { clock } = heard;
    const now = room.voice(heard.item, flight.landing, flight.handSpeed, 1);
    if (now === null) {
      finish(flight);
      return;
    }
    beginBatch(flight, atMs);
    const slotMs = atMs + cascadeWait(flight, atMs) * 1000;
    const contact: Contact = {
      atMs,
      slotMs,
      contactMs: (clock.currentTime + presentDelay) * 1000,
      presentDelay,
      windowMs: slotMs - flight.askedMs,
      direct: { gain: now.directGain, azimuthRad: now.input.direct.azimuthRad },
      surface: now.surface,
      cacheKey: now.cacheKey,
      stale: now.surfacesKey !== flight.surfacesKey,
      slotPassed: false,
      covered: false,
      timer: null,
    };
    flight.contact = contact;
    if (flight.exact !== null) {
      playOnTime(flight, contact, clock, flight.exact);
      return;
    }
    // A cascade voice is due at its own slot: its render may still come by then (R105).
    if (slotMs <= atMs) {
      due(flight, contact, clock);
      return;
    }
    contact.timer = setTimeout(() => {
      contact.timer = null;
      if (flight.done) return;
      const atSlot = stillHeard(flight);
      if (atSlot !== null) due(flight, contact, atSlot.clock);
    }, slotMs - atMs);
  };

  /** Reduced motion: the piece is down already, so its render plays as it answers (R84). */
  const playInPlace = (flight: Flight, render: SetDownRendered): void => {
    const heard = stillHeard(flight);
    if (heard === null) return;
    const { clock } = heard;
    const now = room.voice(heard.item, flight.landing, flight.handSpeed, 1);
    if (now === null) {
      finish(flight);
      return;
    }
    const atMs = nowMs();
    beginBatch(flight, atMs);
    flight.contact = {
      atMs,
      slotMs: atMs,
      contactMs: clock.currentTime * 1000,
      presentDelay: 0,
      windowMs: 0,
      direct: { gain: now.directGain, azimuthRad: now.input.direct.azimuthRad },
      surface: now.surface,
      cacheKey: now.cacheKey,
      stale: false,
      slotPassed: true,
      covered: false,
      timer: null,
    };
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
    const atMs = nowMs();
    if (atMs > contact.slotMs + HEARD_WINDOW_MS) {
      missed(flight);
      return;
    }
    // After its contact but by its slot (a cascade voice): on time, as if it had been ready at the contact (R105).
    if (atMs <= contact.slotMs && !contact.slotPassed) {
      const heard = stillHeard(flight);
      if (heard !== null) playOnTime(flight, contact, heard.clock, render);
      return;
    }
    judge(flight, "late", render.workMs);
    if (contact.covered) {
      finish(flight);
      return;
    }
    const heard = stillHeard(flight);
    if (heard === null) return;
    play(flight, render, "late", heard.clock.currentTime + cascadeWait(flight, atMs));
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
    // Before its slot, the slot decides: a variant, or nothing.
    if ((flight.contact === null || !flight.contact.slotPassed) && !flight.inPlace) return;
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
      ahead.putDown(landing.id);
    }
    const worker = working();
    if (worker === null || !canSound()) return;
    const placed = new Map(usePlacementStore.getState().placedItems.map((item) => [item.id, item]));
    const present = landings.flatMap((landing) => {
      const item = placed.get(landing.id);
      return item === undefined ? [] : [{ landing, item }];
    });
    if (present.length === 0) return;
    for (const { landing, item } of present) if (!landing.inPlace) ahead.placedFromGhost(item.catalogueItemId);
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
      const gathered = entry === undefined ? null : room.voice(entry.item, entry.landing.landing, entry.landing.handSpeed, seed);
      if (entry === undefined || gathered === null) continue;
      serial += 1;
      const flight: Flight = {
        id: voice.id,
        key: `exact|${room.spaceKey}|${voice.id}|${String(serial)}`,
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
        askedReady: worker.ready,
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
    queueMicrotask(() => { shielded(flush); });
  };

  // --- Subscriptions --------------------------------------------------------------------------

  /** Another room: every queued job was the old room's, its tails, its set-downs, its renders ahead. */
  const changeSpace = (next: Space | null): void => {
    working()?.cancel(() => true);
    for (const flight of [...flights.values()]) finish(flight);
    gathering.clear();
    contacts.length = 0;
    ahead.changeRoom();
    room.setSpace(next);
  };

  let placedItems = usePlacementStore.getState().placedItems;
  let ghostPosition = usePlacementStore.getState().ghostPosition;
  let ghostRotation = usePlacementStore.getState().ghostRotation;
  let selectedItemId = useCatalogueStore.getState().selectedItemId;

  const stopEditor = useEditorStore.subscribe((state) => {
    shielded(() => {
      if (spaceKeyOf(state.space) !== room.spaceKey) changeSpace(state.space);
      else room.setSpace(state.space);
    });
  });
  const stopPlacement = usePlacementStore.subscribe((state) => {
    shielded(() => {
      if (state.placedItems !== placedItems) {
        placedItems = state.placedItems;
        room.placementChanged();
      }
      if (state.ghostPosition !== ghostPosition || state.ghostRotation !== ghostRotation) {
        ghostPosition = state.ghostPosition;
        ghostRotation = state.ghostRotation;
        ahead.ghostChanged();
      }
    });
  });
  const stopCatalogue = useCatalogueStore.subscribe((state) => {
    shielded(() => {
      if (state.selectedItemId === selectedItemId) return;
      selectedItemId = state.selectedItemId;
      ahead.ghostChanged();
    });
  });

  // Sound Off or the page hidden makes no tail; on again, or shown, asks for it.
  const soundChanged = (): void => {
    shielded(() => {
      if (soundAllowed()) room.askTail();
      else room.quiet();
    });
  };
  const stopSettings = subscribePlannerSound(soundChanged);
  document.addEventListener("visibilitychange", soundChanged);

  // The first gesture makes the context; the Worker starts with it, and the room's tail is made at its rate.
  const stopArmed = subscribePlannerSoundArmed((sampleRate) => {
    if (disposed) return;
    if (renderer === null && !refused) {
      renderer = rendererFactory();
      refused = renderer === null;
    }
    if (room.setRate(sampleRate)) ahead.forgetVariants();
  });

  return {
    pickedUp(id) {
      takenUpIn.set(id, editorHistoryTravels());
      const item = placedItem(id);
      if (item !== null) ahead.pickedUp(item);
    },

    dropStarted(id, landing, handSpeed, delaySeconds) {
      const epoch = takenUpIn.get(id) ?? editorHistoryTravels();
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
      gatherLanding({ id, landing, handSpeed, delaySeconds: 0, inPlace: true, epoch: editorHistoryTravels() });
    },

    frame(deltaSeconds) {
      if (disposed) return;
      if (contacts.length > 0) {
        const presentDelay = presentDelayFor(deltaSeconds);
        // Taken off the list first: one landing that throws leaves the others, and none is landed twice.
        for (const flight of contacts.splice(0)) {
          try {
            land(flight, presentDelay);
          } catch (error: unknown) {
            reportAsync(error);
          }
        }
      }
      ahead.frame();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      stopEditor();
      stopPlacement();
      stopCatalogue();
      stopSettings();
      stopArmed();
      document.removeEventListener("visibilitychange", soundChanged);
      room.dispose();
      ahead.dispose();
      for (const flight of [...flights.values()]) finish(flight);
      gathering.clear();
      contacts.length = 0;
      takenUpIn.clear();
      renderer?.dispose();
      renderer = null;
    },
  };
}
