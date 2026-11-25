import { toRealWorld } from "../../constants/scale.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { massForCategory, type FurnitureLanding } from "../../lib/furniture-motion.js";
import { createPlacedItem, type PlacedItem } from "../../lib/placement.js";
import { reportAsync } from "../../lib/report-async.js";
import type { SetDownInput } from "../../lib/set-down/render.js";
import type { SetDownRendered, SetDownRenderer } from "../../lib/set-down/renderer.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import type { AdaptiveRenderPolicy, RenderClass } from "./set-down-policy.js";

// ---------------------------------------------------------------------------
// Render-ahead (T-700, ruling R100): the set-down driver's renders made before
// a piece starts down, so a class whose exact renders arrive too late on this
// device still has a variant to play at its contact.
//
// - A piece taken in hand, and the placement ghost, are rendered ahead while
//   the policy has their class on render-ahead.
// - They are asked again when the surfaces under them change, or when they
//   have moved more than a metre from where their last render ahead was taken
//   (R102): a render bakes in the source's pan and early reflections.
// - Each class has at most one render ahead in flight, and asks at most one
//   every 250 ms; a request made meanwhile waits, the newest replacing older
//   ones. A piece put back down, or a ghost that leaves with nothing placed,
//   cancels its class's.
// - Up to three seeds of each variant (piece, scale, cloth, kind, surfaces,
//   room, rate) are kept, played in turn, each with the angle its direct
//   sound was rendered for (R104, R107: the driver moves one whose pan is not
//   the landing's to where its piece lands); renders from a metre or more
//   away replace them.
// ---------------------------------------------------------------------------

/** How often a carried piece, or the ghost, is looked at again. */
const SUPPORTS_CHECK_MS = 250;
/** Each class asks the Worker for at most one render ahead in this long. */
const ASK_INTERVAL_MS = 250;
/** A render ahead is asked again once its piece is this far from where the last was taken, metres (R102). */
const MOVE_REASK_M = 1;
/** Variants kept for one piece on one set of surfaces in one room: seeds 1-3. */
const VARIANT_SEEDS = 3;
/** Variants kept in all: each holds a few hundred kilobytes of samples. */
const VARIANTS_KEPT = 18;
/** A carried piece's variant lands as a let-go from a still hand (R76): the softest settle. */
const VARIANT_HAND_SPEED = 0;
/** The placement ghost's stand-in, never a placed piece's id. */
const GHOST_ID = "set-down-ghost";

/** A render input, with what the driver keys and plays it by. */
export interface Gathered {
  readonly input: SetDownInput;
  readonly directGain: number;
  readonly surfacesKey: string;
  readonly slug: string;
  /** The surfaces' kinds, for the tap. */
  readonly surface: string;
  /** Piece, scale, cloth, kind, surfaces, room and rate: what a variant must match to stand in. */
  readonly cacheKey: string;
}

/** What render-ahead asks of the driver. */
export interface AheadHost {
  /** The Worker's client, unless it is not made yet, refused or broken. */
  working(): SetDownRenderer | null;
  /** Whether anything may be rendered now: a client, a rate, a room, sound on and the page shown. */
  canSound(): boolean;
  /** The render input for `item` landing where it stands, or null with no room or rate. */
  voice(item: PlacedItem, landing: FurnitureLanding, handSpeed: number, seed: number): Gathered | null;
  /** The room, as keys name it: a render ahead for another room is never kept. */
  spaceKey(): string;
  placedItem(id: string): PlacedItem | null;
  /** A render that failed, other than by being cancelled. */
  failed(error: unknown): void;
  now(): number;
}

/** Where, on the floor, in metres. */
interface Where {
  readonly x: number;
  readonly z: number;
}

interface Request {
  readonly cacheKey: string;
  readonly input: SetDownInput;
  readonly at: Where;
  readonly azimuthRad: number;
}

interface Running {
  readonly key: string;
  readonly cacheKey: string;
  readonly at: Where;
  readonly azimuthRad: number;
  readonly spaceKey: string;
}

interface Slot {
  /** The class's one render ahead in flight. */
  running: Running | null;
  /** The newest request made while it ran, or within the interval: it goes next, replacing any older one. */
  next: Request | null;
  /** When the class last asked. */
  askedMs: number;
  /** The wait for the interval to pass. */
  timer: ReturnType<typeof setTimeout> | null;
}

/** A render made ahead, with the angle its direct sound was heard at then. */
export interface KeptRender {
  readonly render: SetDownRendered;
  readonly azimuthRad: number;
}

interface Variant {
  readonly renders: readonly KeptRender[];
  readonly at: Where;
}

/** What a piece in hand, or the ghost, was last rendered ahead for. */
interface Asked {
  readonly cacheKey: string;
  readonly at: Where;
}

function farApart(a: Where, b: Where): boolean {
  return Math.hypot(a.x - b.x, a.z - b.z) > MOVE_REASK_M;
}

/** Whether `request` asks for what `asked` already asked for: the same variant, within a metre. */
function asksAgain(asked: Asked, request: Request): boolean {
  return asked.cacheKey === request.cacheKey && !farApart(asked.at, request.at);
}

/** A catalogue piece's class, as the motion weighs it: what the policy decides by. */
export function classOf(catalogueItemId: string): RenderClass {
  return massForCategory(getCatalogueItem(catalogueItemId)?.category);
}

export class AheadRenders {
  private readonly slots: Record<RenderClass, Slot> = {
    light: { running: null, next: null, askedMs: Number.NEGATIVE_INFINITY, timer: null },
    table: { running: null, next: null, askedMs: Number.NEGATIVE_INFINITY, timer: null },
    heavy: { running: null, next: null, askedMs: Number.NEGATIVE_INFINITY, timer: null },
  };
  /** Per class, the piece in hand it renders ahead for, and what it last asked for it. */
  private readonly carried = new Map<RenderClass, { readonly id: string; readonly asked: Asked }>();
  private carriedCheckedMs = Number.NEGATIVE_INFINITY;
  private readonly variants = new Map<string, Variant>();
  private readonly turns = new Map<string, number>();
  private ghost: { readonly cls: RenderClass; readonly catalogueItemId: string; readonly asked: Asked; placed: boolean } | null = null;
  private ghostTimer: ReturnType<typeof setTimeout> | null = null;
  private ghostCheckedMs = Number.NEGATIVE_INFINITY;
  private serial = 0;
  private disposed = false;

  constructor(private readonly host: AheadHost, private readonly policy: AdaptiveRenderPolicy) {}

  /** A piece taken in hand: rendered ahead at once if its class is on render-ahead. */
  pickedUp(item: PlacedItem): void {
    const cls = classOf(item.catalogueItemId);
    if (!this.host.canSound() || this.policy.mode(cls) !== "ahead") return;
    const request = this.request(item, "let-go");
    if (request === null) return;
    this.carried.set(cls, { id: item.id, asked: request });
    this.ask(cls, request);
  }

  /** A piece starting down: its class's render ahead could not now come before its exact render (condition 2). */
  putDown(id: string): void {
    for (const [cls, held] of this.carried) {
      if (held.id !== id) continue;
      this.carried.delete(cls);
      this.cancel(cls);
    }
  }

  /**
   * The scene's frame: the pieces in hand, and a still ghost (its supports can
   * change under it: a deck placed or undone), looked at again at most every
   * 250 ms. Nothing in hand and no ghost rendered ahead: nothing at all.
   */
  frame(): void {
    if (this.ghost !== null && this.ghostTimer === null && this.host.now() - this.ghostCheckedMs >= SUPPORTS_CHECK_MS) this.ghostChanged();
    if (this.carried.size === 0) return;
    const atMs = this.host.now();
    if (atMs - this.carriedCheckedMs < SUPPORTS_CHECK_MS) return;
    this.carriedCheckedMs = atMs;
    for (const [cls, held] of this.carried) {
      const item = this.host.placedItem(held.id);
      if (item === null || !this.host.canSound() || this.policy.mode(cls) !== "ahead") {
        this.carried.delete(cls);
        continue;
      }
      const request = this.request(item, "let-go");
      if (request === null || asksAgain(held.asked, request)) continue;
      this.carried.set(cls, { id: held.id, asked: request });
      this.ask(cls, request);
    }
  }

  /** The placement ghost moved, turned, changed piece or went: rendered ahead when its surfaces change or it moves a metre. */
  ghostChanged(): void {
    const { ghostPosition, ghostRotation } = usePlacementStore.getState();
    const catalogueItemId = useCatalogueStore.getState().selectedItemId;
    if (ghostPosition === null || catalogueItemId === null) {
      this.leaveGhost();
      return;
    }
    const waitMs = this.ghostCheckedMs + SUPPORTS_CHECK_MS - this.host.now();
    if (waitMs > 0) {
      this.ghostTimer ??= setTimeout(() => {
        this.ghostTimer = null;
        if (!this.disposed) this.ghostChanged();
      }, waitMs);
      return;
    }
    this.ghostCheckedMs = this.host.now();
    if (getCatalogueItem(catalogueItemId) === undefined) return;
    const cls = classOf(catalogueItemId);
    // Another piece in the ghost, of another class: the last one's render ahead goes with it if nothing was placed
    // from it, whether or not the new class renders ahead, and the ghost names it no more (fix-1 Minor 1).
    const left = this.ghost;
    if (left !== null && left.cls !== cls) {
      if (!left.placed) this.cancel(left.cls);
      this.ghost = null;
    }
    if (!this.host.canSound() || this.policy.mode(cls) !== "ahead") return;
    const standIn = createPlacedItem(catalogueItemId, ghostPosition[0], ghostPosition[2], ghostRotation, null, ghostPosition[1], GHOST_ID);
    const request = this.request(standIn, "drop-in");
    if (request === null) return;
    const shown = this.ghost;
    if (shown !== null && shown.catalogueItemId === catalogueItemId && asksAgain(shown.asked, request)) return;
    this.ghost = { cls, catalogueItemId, asked: request, placed: false };
    this.ask(cls, request);
  }

  /** A piece of the ghost's was placed: its render ahead is the placement's, not the ghost's to cancel. */
  placedFromGhost(catalogueItemId: string): void {
    if (this.ghost !== null && this.ghost.catalogueItemId === catalogueItemId) this.ghost.placed = true;
  }

  /** The policy took `cls` back to exact renders: it asks nothing ahead any more. */
  backToExact(cls: RenderClass): void {
    this.cancel(cls);
    this.carried.delete(cls);
    if (this.ghost?.cls === cls) this.ghost = null;
  }

  /** A variant rendered ahead for `cacheKey`, each of its seeds in turn, with its direct sound; null when there is none. */
  variantFor(cacheKey: string): KeptRender | null {
    const kept = this.variants.get(cacheKey);
    if (kept === undefined || kept.renders.length === 0) return null;
    const turn = this.turns.get(cacheKey) ?? 0;
    this.turns.set(cacheKey, turn + 1);
    return kept.renders[turn % kept.renders.length] ?? null;
  }

  /** Another room: nothing kept or waiting is its. The driver has cancelled every queued job. */
  changeRoom(): void {
    for (const slot of Object.values(this.slots)) this.forgetNext(slot);
    this.carried.clear();
    this.forgetVariants();
    this.leaveGhost();
  }

  /** Another context rate: every variant was rendered at the old one. */
  forgetVariants(): void {
    this.variants.clear();
    this.turns.clear();
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of Object.values(this.slots)) this.forgetNext(slot);
    if (this.ghostTimer !== null) clearTimeout(this.ghostTimer);
    this.ghostTimer = null;
    this.ghost = null;
    this.carried.clear();
    this.forgetVariants();
  }

  // --- The slots ----------------------------------------------------------------------------

  /** A render ahead for `item` landing where it stands: the next of its variant's seeds, or seed 1 where it is a metre from them. */
  private request(item: PlacedItem, landing: FurnitureLanding): Request | null {
    const gathered = this.host.voice(item, landing, VARIANT_HAND_SPEED, 1);
    if (gathered === null) return null;
    const at: Where = { x: toRealWorld(item.x), z: toRealWorld(item.z) };
    const kept = this.variants.get(gathered.cacheKey);
    const seed = kept === undefined || farApart(kept.at, at) ? 1 : kept.renders.length + 1;
    return { cacheKey: gathered.cacheKey, input: { ...gathered.input, seed }, at, azimuthRad: gathered.input.direct.azimuthRad };
  }

  private ask(cls: RenderClass, request: Request): void {
    const kept = this.variants.get(request.cacheKey);
    if (kept !== undefined && !farApart(kept.at, request.at) && kept.renders.length >= VARIANT_SEEDS) return;
    const slot = this.slots[cls];
    if (slot.running !== null) {
      // One like the running one needs nothing more, and an older one waiting is stale now.
      slot.next = asksAgain(slot.running, request) ? null : request;
      return;
    }
    const waitMs = slot.askedMs + ASK_INTERVAL_MS - this.host.now();
    if (waitMs > 0) {
      slot.next = request;
      slot.timer ??= setTimeout(() => {
        slot.timer = null;
        if (!this.disposed) this.askNext(cls);
      }, waitMs);
      return;
    }
    this.start(cls, request);
  }

  private askNext(cls: RenderClass): void {
    const slot = this.slots[cls];
    const next = slot.next;
    slot.next = null;
    if (next !== null) this.ask(cls, next);
  }

  private start(cls: RenderClass, request: Request): void {
    const worker = this.host.working();
    if (worker === null) return;
    const slot = this.slots[cls];
    this.serial += 1;
    const spaceKey = this.host.spaceKey();
    const running: Running = { key: `ahead|${cls}|${spaceKey}|${String(this.serial)}`, cacheKey: request.cacheKey, at: request.at, azimuthRad: request.azimuthRad, spaceKey };
    slot.running = running;
    slot.askedMs = this.host.now();
    worker.render(request.input, "ahead", running.key).then((render) => {
      if (!this.disposed && running.spaceKey === this.host.spaceKey()) this.keep(running, render);
    }, (error: unknown) => { this.host.failed(error); }).finally(() => {
      if (slot.running !== running) return;
      slot.running = null;
      if (!this.disposed) this.askNext(cls);
    }).catch(reportAsync);
  }

  /** Drops the class's waiting request, and its render ahead if the Worker has not started it. */
  private cancel(cls: RenderClass): void {
    const slot = this.slots[cls];
    this.forgetNext(slot);
    const running = slot.running;
    if (running !== null) this.host.working()?.cancel((key) => key === running.key);
  }

  private forgetNext(slot: Slot): void {
    slot.next = null;
    if (slot.timer !== null) clearTimeout(slot.timer);
    slot.timer = null;
  }

  private keep(running: Running, render: SetDownRendered): void {
    const kept = this.variants.get(running.cacheKey);
    const fresh = kept === undefined || farApart(kept.at, running.at);
    if (!fresh && kept.renders.length >= VARIANT_SEEDS) return;
    this.variants.delete(running.cacheKey);
    const made: KeptRender = { render, azimuthRad: running.azimuthRad };
    this.variants.set(running.cacheKey, { renders: fresh ? [made] : [...kept.renders, made], at: fresh ? running.at : kept.at });
    if (fresh) this.turns.delete(running.cacheKey);
    let total = 0;
    for (const variant of this.variants.values()) total += variant.renders.length;
    for (const [key, variant] of this.variants) {
      if (total <= VARIANTS_KEPT) break;
      this.variants.delete(key);
      this.turns.delete(key);
      total -= variant.renders.length;
    }
  }

  private leaveGhost(): void {
    if (this.ghostTimer !== null) clearTimeout(this.ghostTimer);
    this.ghostTimer = null;
    const left = this.ghost;
    this.ghost = null;
    if (left !== null && !left.placed) this.cancel(left.cls);
  }
}
