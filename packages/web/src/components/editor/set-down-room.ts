import type { Camera } from "three";
import type { Space } from "../../api/spaces.js";
import { toRealWorld } from "../../constants/scale.js";
import { resolveRoomGeometry, type RoomGeometry } from "../../data/room-geometries.js";
import type { FurnitureLanding } from "../../lib/furniture-motion.js";
import type { PlacedItem } from "../../lib/placement.js";
import { reportAsync } from "../../lib/report-async.js";
import { earFor } from "../../lib/set-down/listener.js";
import type { Vec3 } from "../../lib/set-down/reflections.js";
import { SetDownCancelled, type SetDownRenderer } from "../../lib/set-down/renderer.js";
import { roomAcousticsFor, roomState, type RoomState } from "../../lib/set-down/room-acoustics.js";
import type { RoomAcoustics } from "../../lib/set-down/rooms.js";
import { tailOnsetSeconds } from "../../lib/set-down/tail.js";
import { voiceInput } from "../../lib/set-down/voice.js";
import { clearPlannerRoomTail, setPlannerRoomTail } from "../../lib/sound-registry.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import type { Gathered } from "./set-down-ahead.js";

// ---------------------------------------------------------------------------
// The room a set-down is heard in (T-700, Task 14b): the space the planner
// shows, its acoustics and drawn outline, its state as the placement fills it,
// and its late tail, which the Worker renders and the registry puts on the
// room bus.
//
// - The state follows the placement 250 ms after its last change; a new
//   state, room or context rate asks the Worker for a new tail (latest wins).
// - Another room takes the old room's tail off the bus at once, sound on or
//   not, so a set-down there is dry until the new room's tail answers.
// - No tail is made while sound is Off or the page is hidden: one waiting is
//   cancelled, and the tail is asked for again when sound comes back on or
//   the page is shown.
// - A render input (`voice`) is built here, for the room it will sound in: the
//   ear 2-6 m from the landing (R61), the send left to the room (R58), and a
//   variant key that names everything the render depends on but where it
//   stands (R81: the cloth included).
// ---------------------------------------------------------------------------

/** One tail per room state, as the listening page seeds it. */
const TAIL_SEED = 1;
/** Placement changes are gathered this long before the room is worked out again. */
const ROOM_SETTLE_MS = 250;

/** A room's name in keys: its slug and id, never with a "|". */
export function spaceKeyOf(space: { readonly slug: string; readonly id: string } | null): string {
  return space === null ? "none" : `${space.slug}:${space.id}`.replace(/\|/gu, "/");
}

/** What the room asks of the driver. */
export interface RoomHost {
  /** The Worker's client, unless it is not made yet, refused or broken. */
  working(): SetDownRenderer | null;
  /** Sound on and the page shown: what a tail needs. */
  soundAllowed(): boolean;
  /** A tail that failed, other than by being cancelled. */
  failed(error: unknown): void;
  /** Where the set-down is heard from. */
  camera(): Camera;
}

export class SetDownRoom {
  private space: Space | null;
  private key: string;
  private acoustics: RoomAcoustics | null;
  private geometry: RoomGeometry | null;
  private room: RoomState | null = null;
  private sampleRate: number | null = null;
  /** The tail asked for last; it is on the bus once answered. Null when the next chance must ask again. */
  private tailKey: string | null = null;
  /** The tail asked for and not yet answered. */
  private tailWaiting: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly host: RoomHost, space: Space | null) {
    this.space = space;
    this.key = spaceKeyOf(space);
    this.acoustics = space === null ? null : roomAcousticsFor(space);
    this.geometry = space === null ? null : resolveRoomGeometry(space);
    this.compute();
  }

  /** The room, as keys name it. */
  get spaceKey(): string {
    return this.key;
  }

  /** Its state as the placement last settled, or null with no room. */
  get state(): RoomState | null {
    return this.room;
  }

  /** The context's rate, once the first gesture has made it. */
  get rate(): number | null {
    return this.sampleRate;
  }

  /** Whether a render input can be built: a room and a rate. */
  get ready(): boolean {
    return this.space !== null && this.acoustics !== null && this.sampleRate !== null;
  }

  /** The editor's space now. True when it is another room; the same room under a new object is only kept. */
  setSpace(next: Space | null): boolean {
    if (spaceKeyOf(next) === this.key) {
      this.space = next;
      return false;
    }
    this.space = next;
    this.key = spaceKeyOf(next);
    this.acoustics = next === null ? null : roomAcousticsFor(next);
    this.geometry = next === null ? null : resolveRoomGeometry(next);
    this.tailKey = null;
    this.tailWaiting = null;
    this.clearTimer();
    clearPlannerRoomTail();
    this.compute();
    return true;
  }

  /** The context's rate, at arming. True when it changed. */
  setRate(rate: number): boolean {
    const changed = this.sampleRate !== rate;
    this.sampleRate = rate;
    this.askTail();
    return changed;
  }

  /** The placement changed: the room is worked out again once it has been still for 250 ms. */
  placementChanged(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.disposed) this.compute();
    }, ROOM_SETTLE_MS);
  }

  /** Asks the Worker for the room's tail, unless it has it, or sound is Off or the page hidden. */
  askTail(): void {
    const worker = this.host.working();
    const { sampleRate, room, acoustics } = this;
    if (worker === null || sampleRate === null || room === null || acoustics === null || !this.host.soundAllowed()) return;
    const key = `tail|${this.key}|${room.key}|${String(sampleRate)}`;
    if (key === this.tailKey) return;
    // Asked first, then kept as asked: a client that throws leaves it to be asked again at the next chance.
    const asked = worker.tail(room.rt, { sampleRate, seed: TAIL_SEED, onsetSeconds: tailOnsetSeconds(acoustics) }, key);
    this.tailKey = key;
    this.tailWaiting = key;
    asked.then((tail) => {
      if (this.tailWaiting === key) this.tailWaiting = null;
      if (!this.disposed && this.tailKey === key) setPlannerRoomTail(tail, key);
    }, (error: unknown) => {
      if (this.tailWaiting === key) this.tailWaiting = null;
      // A failed tail is asked for again at the next chance; a replaced or cancelled one already was.
      if (this.tailKey === key && !(error instanceof SetDownCancelled)) this.tailKey = null;
      this.host.failed(error);
    }).catch(reportAsync);
  }

  /** Sound went Off or the page hid: a tail still waiting is not made, and is asked for again when it can play. */
  quiet(): void {
    const waiting = this.tailWaiting;
    if (waiting === null) return;
    this.tailWaiting = null;
    this.tailKey = null;
    this.host.working()?.cancel((key) => key === waiting);
  }

  /**
   * The render input for `item` landing where it stands now, heard from the
   * camera, or null with no room or rate.
   */
  voice(item: PlacedItem, landing: FurnitureLanding, handSpeed: number, seed: number): Gathered | null {
    const { space, acoustics, sampleRate } = this;
    if (space === null || acoustics === null || sampleRate === null) return null;
    const source: Vec3 = { x: toRealWorld(item.x), y: toRealWorld(item.y), z: toRealWorld(item.z) };
    const voice = voiceInput({
      item,
      placedItems: usePlacementStore.getState().placedItems,
      roomSlug: space.slug,
      geometry: this.geometry,
      acoustics,
      ear: earFor(this.cameraPose(), source, useCockpitStore.getState().walkMode),
      landing,
      handSpeed,
      seed,
      sampleRate,
    });
    const kinds = [...new Set(voice.input.surfaces.map((surface) => surface.kind))];
    return {
      input: voice.input,
      directGain: voice.directGain,
      surfacesKey: voice.surfacesKey,
      slug: voice.slug,
      surface: kinds.join("+"),
      cacheKey: [voice.slug, String(item.scale ?? 1), String(item.clothed), voice.input.kind, voice.surfacesKey, this.key, String(sampleRate)].join("|"),
    };
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private compute(): void {
    this.room = this.acoustics === null ? null : roomState(this.acoustics, usePlacementStore.getState().placedItems);
    this.askTail();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Where the camera is, in metres, and its right. */
  private cameraPose(): { readonly position: Vec3; readonly right: Vec3 } {
    const view = this.host.camera();
    view.updateWorldMatrix(true, false);
    const e = view.matrixWorld.elements;
    return {
      position: { x: toRealWorld(e[12]), y: toRealWorld(e[13]), z: toRealWorld(e[14]) },
      right: { x: e[0], y: e[1], z: e[2] },
    };
  }
}
