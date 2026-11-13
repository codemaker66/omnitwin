// ---------------------------------------------------------------------------
// The listening page for the set-downs (T-677, Task 9).
//
// Blake hears the set-down engine here before it is wired into the planner,
// on laptop speakers, earbuds and his phone. Every sound is rendered by the
// engine itself (packages/web/src/lib/set-down), bundled into the page, and
// played through a graph that mirrors the planner's: each voice into a dry
// gain and a send to the room's tail, a master at the planner's level, the
// registry's limiter and the trim after it. The page also measures how long
// each render takes on the device it runs on, and keeps those figures in the
// artifact's database when the page is served with one.
// ---------------------------------------------------------------------------

import { TRADES_HALL_PUBLISHED_ROOM_NAMES } from "@omnitwin/types";
import { toRealWorld } from "../../packages/web/src/constants/scale.js";
import { computeBoundingBox, roomGeometries, type RoomGeometry } from "../../packages/web/src/data/room-geometries.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../../packages/web/src/lib/catalogue.js";
import type { PlacedItem } from "../../packages/web/src/lib/placement.js";
import { dbToGain, gainToDb, seededRandom } from "../../packages/web/src/lib/planner-sound-render.js";
import { PLANNER_LIMITER, PLANNER_SOUND_DEFAULT_LEVEL, limiterMakeupDb } from "../../packages/web/src/lib/sound-registry.js";
import { SURFACE_ABSORPTION } from "../../packages/web/src/lib/set-down/acoustic-data.js";
import { OCTAVE_BANDS_HZ, type BandValues } from "../../packages/web/src/lib/set-down/bands.js";
import { SET_DOWN_BODIES, bodyFor, type BodyFamily, type FootCap, type SetDownBody } from "../../packages/web/src/lib/set-down/bodies.js";
import { earlyReflections, lateralAzimuth, reflectionRoomFor, type Vec3 } from "../../packages/web/src/lib/set-down/reflections.js";
import { renderSetDown, type SetDownRender } from "../../packages/web/src/lib/set-down/render.js";
import { referenceDinner, roomState, type RoomState } from "../../packages/web/src/lib/set-down/room-acoustics.js";
import { ROOM_ACOUSTICS, ROOM_PLANS, type RoomSlug } from "../../packages/web/src/lib/set-down/rooms.js";
import { floorKindForRoom, surfaceKindForSupport, surfaceResponse, type SurfaceKind } from "../../packages/web/src/lib/set-down/surfaces.js";
import { tailOnsetSeconds, tailSlices, type Stereo } from "../../packages/web/src/lib/set-down/tail.js";

// --- What can be chosen -------------------------------------------------------------------------

const ROOMS: readonly RoomSlug[] = ["grand-hall", "saloon", "robert-adam-room", "reception-room", "north-gallery", "south-gallery"];

type Support = "floor" | "deck" | "dance" | "table";
const SUPPORTS: readonly Support[] = ["floor", "deck", "dance", "table"];
/** The piece each support stands for; the room's floor is no piece. */
const SUPPORT_SLUG: Readonly<Record<Support, string | null>> = {
  floor: null,
  deck: "staging-deck-6x4",
  dance: "dancefloor-panel",
  table: "trestle-6ft",
};

const SURFACE_WORDS: Readonly<Record<SurfaceKind, string>> = {
  "oak-boards-joists": "Oak boards on joists",
  "oak-parquet": "Oak parquet",
  "timber-on-slab": "Timber on a slab",
  carpet: "Carpet",
  "stage-deck": "A stage deck",
  "dance-floor": "The dance floor",
  "table-top": "A table top",
};

const FAMILY_WORDS: Readonly<Record<BodyFamily, string>> = {
  chair: "Chairs",
  "round-table": "Round tables",
  "rect-table": "Trestles and long tables",
  poseur: "Poseurs",
  stage: "Staging",
  "dance-floor": "Dance floor",
  lectern: "Lectern",
  "av-stand": "AV on stands",
  "av-small": "AV, small",
  cabinet: "Counters and units",
  divider: "Divider",
  highchair: "Highchairs",
};

const CAP_WORDS: Readonly<Record<FootCap, string>> = {
  glide: "glides",
  rubber: "rubber feet",
  felt: "felt pads",
  steel: "steel feet",
  castor: "castors",
  "panel-edge": "panel edges",
};

const BAND_WORDS = OCTAVE_BANDS_HZ.map((hz) => (hz >= 1000 ? `${String(hz / 1000)} kHz` : `${String(hz)} Hz`));
const ONE_KHZ = 3;

// --- Where the sound happens ----------------------------------------------------------------------

/** The rooms as the planner draws them (reflections.ts takes the drawn room, spec section 4). */
const DRAWN_ROOM_NAMES: Readonly<Record<RoomSlug, string | null>> = {
  "grand-hall": "Grand Hall",
  saloon: "Saloon",
  "robert-adam-room": "Robert Adam Room",
  "reception-room": "Reception Room",
  "north-gallery": null,
  "south-gallery": null,
};
/**
 * The galleries have no drawn geometry in the web package (the planner draws
 * them from the space's outline in the database), so their reflections come
 * off the surveyed room: rooms.ts's 11.5 x 4.1 m plan and 2.8 m ceiling.
 */
const GALLERY_CEILING_M = 2.8;

function drawnRoom(slug: RoomSlug): RoomGeometry {
  const name = DRAWN_ROOM_NAMES[slug];
  const drawn = name === null ? undefined : roomGeometries[name];
  if (drawn !== undefined) return drawn;
  const plan = ROOM_PLANS[slug];
  const x = plan.lengthM / 2;
  const z = plan.widthM / 2;
  return { wallPolygon: [[-x, -z], [x, -z], [x, z], [-x, z]], ceilingHeight: GALLERY_CEILING_M, features: [], hasDome: false, domeRadius: 0 };
}

/** The listener's ear: standing height. */
const EAR_HEIGHT_M = 1.6;
/** Facing along +x, the room's length, so +z is to the right (lateralAzimuth's convention). */
const RIGHT: Vec3 = { x: 0, y: 0, z: 1 };
/** The direct sound's gain is 1 at this distance and falls as 1/r beyond it (Task 12's directPath). */
const REFERENCE_DISTANCE_M = 2;

/**
 * The room send's constant (ruling R11: the send is REVERB_SEND x
 * reverberantGain, not scaled by the direct gain). EST, from diffuse-field
 * theory, since the registry does not define it yet (Task 13): a source of
 * directivity Q = 2 on the floor gives a reverberant energy 16 pi r^2 / (Q R)
 * times its direct energy at r. At the 2 m reference that is 32 pi / R. The
 * tail has unit energy per channel, so a send of sqrt(32 pi / R) makes the
 * convolved echo carry that energy; R / R_ref is reverberantGain's square,
 * with R_ref the empty Grand Hall's room constant at 1 kHz.
 */
const REVERB_SEND = Math.sqrt((32 * Math.PI) / emptyHallRoomConstant());

function emptyHallRoomConstant(): number {
  let area = 0;
  let absorption = 0;
  for (const surface of ROOM_ACOUSTICS["grand-hall"].surfaces) {
    area += surface.areaM2;
    absorption += surface.areaM2 * SURFACE_ABSORPTION[surface.material][ONE_KHZ];
  }
  const mean = absorption / area;
  return absorption / (1 - mean);
}

// --- The audio graph (mirroring lib/sound-registry.ts's planner graph) ------------------------------

const MASTER_LEVEL = PLANNER_SOUND_DEFAULT_LEVEL;
/** The room tail's cross-fade when the room or its dressing changes. */
const CROSSFADE_S = 0.12;
/** A frame: the press shows on the next one, so the sound is aimed there. */
const FRAME_S = 1 / 60;
const TAIL_SEED = 1;
/** Before there is a context, the tail is rendered at this rate, the usual one. */
const DEFAULT_RATE = 48000;
/** Each idle slice of the tail works for at most this long. */
const SLICE_MS = 4;
/** The dressing slider's changes are gathered for this long before a new tail is made. */
const TAIL_DEBOUNCE_MS = 250;

interface Wet {
  readonly convolver: ConvolverNode;
  readonly fade: GainNode;
  readonly key: string;
}

interface AudioGraph {
  readonly context: AudioContext;
  readonly master: GainNode;
  /** The room send: every voice's send feeds the current tail's convolver from here. */
  readonly bus: GainNode;
  wet: Wet | null;
  voices: number;
}

/** A browser API the DOM types promise but an older browser may lack. */
function optional<T>(value: T): T | undefined {
  return value;
}

let audio: AudioGraph | null = null;

function makeGraph(): AudioGraph | null {
  const Context = optional(window.AudioContext);
  if (Context === undefined) return null;
  let context: AudioContext;
  try {
    context = new Context({ latencyHint: "interactive" });
  } catch {
    return null;
  }
  // iOS's audio session (Safari 16.4+), set as the registry's arming sets it: "ambient" follows the ring switch.
  if ("audioSession" in navigator) {
    const session: unknown = navigator.audioSession;
    if (typeof session === "object" && session !== null && "type" in session) session.type = "ambient";
  }
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = PLANNER_LIMITER.thresholdDb;
  limiter.ratio.value = PLANNER_LIMITER.ratio;
  limiter.attack.value = PLANNER_LIMITER.attackSeconds;
  limiter.release.value = PLANNER_LIMITER.releaseSeconds;
  limiter.knee.value = 0;
  const trim = context.createGain();
  trim.gain.value = dbToGain(-limiterMakeupDb(PLANNER_LIMITER.thresholdDb, PLANNER_LIMITER.ratio));
  limiter.connect(trim);
  trim.connect(context.destination);
  const master = context.createGain();
  master.gain.value = MASTER_LEVEL;
  master.connect(limiter);
  const bus = context.createGain();
  return { context, master, bus, wet: null, voices: 0 };
}

/** The graph, made inside the first gesture, and resumed on every gesture until it runs. */
function arm(): AudioGraph | null {
  if (audio === null) {
    audio = makeGraph();
    if (audio === null) {
      ui.saveStatus.textContent = "This browser has no Web Audio, so nothing can play here.";
      return null;
    }
    const graph = audio;
    graph.context.addEventListener("statechange", () => {
      ui.page.dataset.audio = graph.context.state;
    });
    ui.page.dataset.audio = graph.context.state;
    useTail();
  }
  // A touch's pointerdown is not yet a gesture to the browser; the click that follows it resumes.
  if (audio.context.state !== "running") audio.context.resume().catch(() => undefined);
  return audio;
}

/** Puts `tail` on the room send, cross-fading from the tail before it. */
function installTail(graph: AudioGraph, tail: Stereo, key: string): void {
  const { context } = graph;
  const buffer = context.createBuffer(2, tail.left.length, tail.sampleRate);
  buffer.getChannelData(0).set(tail.left);
  buffer.getChannelData(1).set(tail.right);
  const convolver = context.createConvolver();
  convolver.normalize = false;
  convolver.buffer = buffer;
  const fade = context.createGain();
  graph.bus.connect(convolver);
  convolver.connect(fade);
  fade.connect(graph.master);
  const old = graph.wet;
  const now = context.currentTime;
  if (old === null) {
    fade.gain.value = 1;
  } else {
    fade.gain.setValueAtTime(0, now);
    fade.gain.linearRampToValueAtTime(1, now + CROSSFADE_S);
    old.fade.gain.cancelScheduledValues(now);
    old.fade.gain.setValueAtTime(old.fade.gain.value, now);
    old.fade.gain.linearRampToValueAtTime(0, now + CROSSFADE_S);
    window.setTimeout(() => {
      graph.bus.disconnect(old.convolver);
      old.convolver.disconnect();
      old.fade.disconnect();
    }, (CROSSFADE_S + 0.1) * 1000);
  }
  graph.wet = { convolver, fade, key };
}

interface Voice {
  readonly render: SetDownRender;
  /** Seconds after now that the voice's first contact is aimed at. */
  readonly offsetSeconds: number;
  readonly levelDb: number;
  readonly directGain: number;
  readonly send: number;
}

/**
 * Starts each voice so that its audible onset lands where it is aimed: the
 * press shows on the next frame, the output adds its latency, and the render
 * starts `onsetSeconds` before its onset. Never in the past.
 */
function playVoices(graph: AudioGraph, voices: readonly Voice[]): void {
  const { context } = graph;
  const latency = context.outputLatency > 0 ? context.outputLatency : context.baseLatency;
  const lead = Math.max(0, FRAME_S - (Number.isFinite(latency) ? latency : 0));
  const now = context.currentTime;
  for (const voice of voices) {
    const { render } = voice;
    const buffer = context.createBuffer(2, render.left.length, render.sampleRate);
    buffer.getChannelData(0).set(render.left);
    buffer.getChannelData(1).set(render.right);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const level = context.createGain();
    level.gain.value = dbToGain(voice.levelDb);
    const dry = context.createGain();
    dry.gain.value = voice.directGain;
    const send = context.createGain();
    send.gain.value = voice.send;
    source.connect(level);
    level.connect(dry);
    dry.connect(graph.master);
    level.connect(send);
    send.connect(graph.bus);
    source.onended = () => {
      source.disconnect();
      level.disconnect();
      dry.disconnect();
      send.disconnect();
    };
    source.start(now + Math.max(0, lead + voice.offsetSeconds - render.onsetSeconds));
    graph.voices += 1;
  }
  ui.page.dataset.voices = String(graph.voices);
}

// --- The room's tail, rendered in idle slices -----------------------------------------------------

interface TailJob {
  readonly key: string;
  readonly sampleRate: number;
  readonly slices: Iterator<number, Stereo>;
  workMs: number;
}

let tailJob: TailJob | null = null;
let builtTail: { readonly key: string; readonly sampleRate: number; readonly stereo: Stereo } | null = null;
let tailDebounce: number | null = null;

function wantedTail(): { readonly key: string; readonly sampleRate: number; readonly rt: BandValues } {
  const current = currentRoom();
  return { key: `${state.room}|${current.state.key}`, sampleRate: audio?.context.sampleRate ?? DEFAULT_RATE, rt: current.state.rt };
}

/** Starts making the current room's tail in idle time, unless it is made or being made. */
function requestTail(): void {
  const want = wantedTail();
  if (builtTail !== null && builtTail.key === want.key && builtTail.sampleRate === want.sampleRate) {
    useTail();
    return;
  }
  if (tailJob !== null && tailJob.key === want.key && tailJob.sampleRate === want.sampleRate) return;
  const acoustics = ROOM_ACOUSTICS[state.room];
  const job: TailJob = {
    key: want.key,
    sampleRate: want.sampleRate,
    slices: tailSlices(want.rt, { sampleRate: want.sampleRate, seed: TAIL_SEED, onsetSeconds: tailOnsetSeconds(acoustics) }),
    workMs: 0,
  };
  tailJob = job;
  whenIdle(job);
}

function whenIdle(job: TailJob): void {
  const work = (remaining: () => number): void => {
    if (tailJob !== job) return;
    const begin = performance.now();
    do {
      if (stepTail(job)) return;
    } while (performance.now() - begin < SLICE_MS && remaining() > 1);
    whenIdle(job);
  };
  const requestIdle = optional(window.requestIdleCallback);
  if (requestIdle !== undefined) requestIdle.call(window, (deadline) => { work(() => deadline.timeRemaining()); }, { timeout: 250 });
  else window.setTimeout(() => { work(() => SLICE_MS); }, 0);
}

/** One step of the job; true when the tail is done. */
function stepTail(job: TailJob): boolean {
  const begin = performance.now();
  const step = job.slices.next();
  job.workMs += performance.now() - begin;
  if (step.done !== true) return false;
  tailJob = null;
  builtTail = { key: job.key, sampleRate: job.sampleRate, stereo: step.value };
  timings.recordTail(job.workMs);
  ui.tailMs.textContent = `${job.workMs.toFixed(0)} ms`;
  useTail();
  return true;
}

/** Puts the built tail on the graph if it is the room's current one. */
function useTail(): void {
  const want = wantedTail();
  if (audio === null || builtTail === null) return;
  if (builtTail.key !== want.key || builtTail.sampleRate !== want.sampleRate) {
    requestTail();
    return;
  }
  if (audio.wet?.key === builtTail.key) return;
  installTail(audio, builtTail.stereo, builtTail.key);
}

/** Makes sure the current tail is on the graph before a set-down plays, finishing it now if it is not. */
function tailNow(graph: AudioGraph): void {
  const want = wantedTail();
  if (graph.wet?.key === want.key && builtTail?.sampleRate === want.sampleRate) return;
  requestTail();
  const job = tailJob;
  if (job !== null) for (let done = false; !done; ) done = stepTail(job);
  useTail();
}

// --- The page's state -------------------------------------------------------------------------------

interface PageState {
  room: RoomSlug;
  support: Support;
  slug: string;
  /** The share of the reference dinner laid, 0-100 %. */
  dressing: number;
  distanceM: number;
}

const state: PageState = { room: "grand-hall", support: "floor", slug: "chiavari-chair", dressing: 0, distanceM: 3 };
let seed = 1;

const emptyStates = new Map<RoomSlug, RoomState>();

function currentRoom(): { readonly laid: readonly PlacedItem[]; readonly of: number; readonly state: RoomState; readonly empty: RoomState } {
  const acoustics = ROOM_ACOUSTICS[state.room];
  const dinner = referenceDinner(state.room);
  const laid = dinner.slice(0, Math.round((dinner.length * state.dressing) / 100));
  let empty = emptyStates.get(state.room);
  if (empty === undefined) {
    empty = roomState(acoustics, []);
    emptyStates.set(state.room, empty);
  }
  return { laid, of: dinner.length, state: laid.length === 0 ? empty : roomState(acoustics, laid), empty };
}

// --- Rendering set-downs ------------------------------------------------------------------------------

function supportHeight(support: Support): number {
  const slug = SUPPORT_SLUG[support];
  return slug === null ? 0 : (getCatalogueItemBySlug(slug)?.height ?? 0);
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Renders one piece landing at `source`, heard at `ear`, on `surface`, and times it. */
function renderAt(body: SetDownBody, surface: SurfaceKind, kind: "drop" | "settle", source: Vec3, ear: Vec3, sampleRate: number): { readonly render: SetDownRender; readonly ms: number; readonly directGain: number } {
  const response = surfaceResponse(surface, state.room);
  const begin = performance.now();
  const reflections = earlyReflections(reflectionRoomFor(ROOM_ACOUSTICS[state.room], drawnRoom(state.room)), source, { position: ear, right: RIGHT });
  // Rendered at full direct gain and turned down by the dry gain: the render is linear in its direct gain,
  // so the dry sound is the same, and the send stays the room's alone (ruling R11).
  const render = renderSetDown({
    body,
    surfaces: body.feet.map(() => response),
    speed: 1,
    kind,
    clothed: false,
    direct: { gain: 1, azimuthRad: lateralAzimuth({ x: source.x - ear.x, y: source.y - ear.y, z: source.z - ear.z }, RIGHT) },
    reflections,
    seed,
    sampleRate,
  });
  const ms = performance.now() - begin;
  seed += 1;
  return { render, ms, directGain: Math.min(1, REFERENCE_DISTANCE_M / Math.max(distance(source, ear), 1e-6)) };
}

/** The selected piece, set down (or settled) at the chosen distance ahead of the listener. */
function playPiece(kind: "drop" | "settle"): void {
  const graph = arm();
  if (graph === null) return;
  tailNow(graph);
  const height = supportHeight(state.support);
  const across = Math.sqrt(Math.max(0, state.distanceM ** 2 - (EAR_HEIGHT_M - height) ** 2));
  const source: Vec3 = { x: across / 2, y: height, z: 0 };
  const ear: Vec3 = { x: -across / 2, y: EAR_HEIGHT_M, z: 0 };
  const surface = surfaceKindForSupport(SUPPORT_SLUG[state.support], state.room);
  const { render, ms, directGain } = renderAt(bodyFor(state.slug), surface, kind, source, ear, graph.context.sampleRate);
  playVoices(graph, [{ render, offsetSeconds: 0, levelDb: 0, directGain, send: REVERB_SEND * currentRoom().state.reverberantGain }]);
  timings.recordSetDown(state.slug, ms);
  showRender(render, ms, 1);
}

/** Lay out's cascade (spec section 6; Task 12's plan): eight voices, tables first, about 0.1 s apart, each 1 dB softer. */
const CASCADE_VOICES = 8;
const CASCADE_GAP_S = 0.085;
const CASCADE_GAP_SPREAD_S = 0.025;
const CASCADE_STEP_DB = -1;

/** One piece of each table family first, then chairs spread across the layout, so the cascade sweeps the room. */
function cascadePieces(items: readonly PlacedItem[]): readonly { readonly item: PlacedItem; readonly slug: string }[] {
  const tables: { item: PlacedItem; slug: string }[] = [];
  const chairs: { item: PlacedItem; slug: string }[] = [];
  const families = new Set<BodyFamily>();
  for (const item of items) {
    const slug = getCatalogueItem(item.catalogueItemId)?.slug ?? item.catalogueItemId;
    const family = bodyFor(slug).family;
    if (family === "chair") chairs.push({ item, slug });
    else if (!families.has(family)) {
      families.add(family);
      tables.push({ item, slug });
    }
  }
  const picked = tables.slice(0, CASCADE_VOICES);
  const count = Math.min(CASCADE_VOICES - picked.length, chairs.length);
  for (let k = 0; k < count; k += 1) {
    const chair = chairs[Math.floor(((k + 0.5) * chairs.length) / count)];
    if (chair !== undefined) picked.push(chair);
  }
  return picked;
}

/**
 * "Lay out a dinner": the reference dinner's cascade, each piece heard from
 * the chosen distance on the line to a listener standing at the room's end
 * (Task 12's ear rule, held to 2 m at the nearest), on the room's floor.
 */
function playCascade(): void {
  const graph = arm();
  if (graph === null) return;
  tailNow(graph);
  const geometry = drawnRoom(state.room);
  const box = computeBoundingBox(geometry.wallPolygon);
  const viewer: Vec3 = { x: box.minX + 1, y: EAR_HEIGHT_M, z: 0 };
  const random = seededRandom(seed);
  const send = REVERB_SEND * currentRoom().state.reverberantGain;
  const surface = floorKindForRoom(state.room);
  const voices: Voice[] = [];
  let offset = 0;
  let total = 0;
  let lastMs = 0;
  let last: SetDownRender | null = null;
  for (const [index, { item, slug }] of cascadePieces(referenceDinner(state.room)).entries()) {
    const source: Vec3 = { x: toRealWorld(item.x), y: 0, z: toRealWorld(item.z) };
    const away = distance(viewer, source);
    const reach = Math.min(Math.max(away, REFERENCE_DISTANCE_M), state.distanceM);
    const k = away > 1e-6 ? reach / away : 0;
    const ear: Vec3 = { x: source.x + (viewer.x - source.x) * k, y: source.y + (viewer.y - source.y) * k, z: source.z + (viewer.z - source.z) * k };
    const { render, ms, directGain } = renderAt(bodyFor(slug), surface, "drop", source, ear, graph.context.sampleRate);
    if (index > 0) offset += CASCADE_GAP_S + CASCADE_GAP_SPREAD_S * random();
    voices.push({ render, offsetSeconds: offset, levelDb: CASCADE_STEP_DB * index, directGain, send });
    timings.recordSetDown(slug, ms);
    total += ms;
    last = render;
    lastMs = ms;
  }
  playVoices(graph, voices);
  if (last !== null) showRender(last, lastMs, voices.length, total);
}

// --- Device figures (the artifact's `db` capability) ------------------------------------------------

/** The slice of the artifact runtime's `db` this page uses (artifact-capabilities db.d.ts). */
interface DbSnapshot {
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface DbDocument {
  get(): Promise<DbSnapshot>;
  set(data: Record<string, unknown>): Promise<void>;
}
interface Db {
  doc(path: string): DbDocument;
}
interface ClaudeRuntime {
  use(name: "db"): Promise<Db | null>;
}
declare global {
  interface Window {
    claude?: ClaudeRuntime;
  }
}

const KEEP_PER_LIST = 20;
const WRITE_PAUSE_MS = 1500;

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  return "unavailable";
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [];
}

function kept(list: readonly number[], value: number): number[] {
  return [...list, Math.round(value * 100) / 100].slice(-KEEP_PER_LIST);
}

/** A short hash of the user agent and the screen's size, so a phone's figures never mix with a laptop's. */
function deviceKey(screenSize: string): string {
  let hash = 0x811c9dc5;
  for (const char of `${navigator.userAgent}|${screenSize}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * This device's render times, kept in one document at `timings/<device>`:
 * read once when the store arrives, then written once per pause, one write
 * at a time, never from the render itself.
 */
class DeviceTimings {
  private readonly screenSize = `${String(Math.min(screen.width, screen.height))}x${String(Math.max(screen.width, screen.height))}`;
  private readonly setDown: Record<string, number[]> = {};
  private tail: number[] = [];
  private document: DbDocument | null = null;
  private dirty = false;
  private writing = false;
  private timer: number | null = null;
  private retried = false;

  recordSetDown(slug: string, ms: number): void {
    this.setDown[slug] = kept(this.setDown[slug] ?? [], ms);
    this.changed();
  }

  recordTail(ms: number): void {
    this.tail = kept(this.tail, ms);
    this.changed();
  }

  async connect(): Promise<void> {
    const runtime = window.claude;
    const db = runtime === undefined ? null : await runtime.use("db").catch(() => null);
    if (db === null) {
      ui.saveStatus.textContent = "Render times stay on this screen: this view does not save them.";
      return;
    }
    const doc = db.doc(`timings/${deviceKey(this.screenSize)}`);
    try {
      const snapshot = await doc.get();
      const saved = snapshot.exists ? snapshot.data() : undefined;
      if (saved !== undefined) this.merge(saved);
    } catch (error) {
      this.failed(errorCode(error));
      return;
    }
    this.document = doc;
    ui.saveStatus.textContent = "Render times on this device are saved with the page.";
    if (this.dirty) this.schedule();
  }

  private merge(saved: Record<string, unknown>): void {
    const setDown = saved.setDown;
    if (typeof setDown === "object" && setDown !== null) {
      for (const [slug, list] of Object.entries(setDown)) {
        this.setDown[slug] = [...numbers(list), ...(this.setDown[slug] ?? [])].slice(-KEEP_PER_LIST);
      }
    }
    this.tail = [...numbers(saved.tail), ...this.tail].slice(-KEEP_PER_LIST);
  }

  private changed(): void {
    this.dirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.document === null) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.write();
    }, WRITE_PAUSE_MS);
  }

  private async write(): Promise<void> {
    const doc = this.document;
    if (doc === null || !this.dirty) return;
    if (this.writing) {
      this.schedule();
      return;
    }
    this.writing = true;
    this.dirty = false;
    try {
      await doc.set({
        userAgent: navigator.userAgent,
        screen: this.screenSize,
        sampleRate: audio?.context.sampleRate ?? null,
        date: new Date().toISOString(),
        setDown: this.setDown,
        tail: this.tail,
      });
      this.retried = false;
    } catch (error) {
      const code = errorCode(error);
      if (code === "unavailable" && !this.retried) {
        this.retried = true;
        this.dirty = true;
        window.setTimeout(() => { void this.write(); }, 1000 + Math.random() * 1000);
      } else {
        this.failed(code);
      }
    } finally {
      this.writing = false;
    }
  }

  private failed(code: string): void {
    this.document = null;
    ui.saveStatus.textContent =
      code === "quota_exceeded" ? "The page's store is full, so render times are no longer saved." : "Render times could not be saved from this view.";
  }
}

// --- The page ------------------------------------------------------------------------------------------

function element<T extends HTMLElement>(id: string, type: { new (): T; prototype: T }): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`The page has no #${id}`);
  return found;
}

const ui = {
  page: element("page", HTMLDivElement),
  rooms: element("rooms", HTMLDivElement),
  roomName: element("room-name", HTMLHeadingElement),
  roomFacts: element("room-facts", HTMLParagraphElement),
  surfaces: element("surfaces", HTMLDivElement),
  piece: element("piece", HTMLSelectElement),
  pieceFacts: element("piece-facts", HTMLParagraphElement),
  distance: element("distance", HTMLInputElement),
  distanceValue: element("distance-value", HTMLOutputElement),
  rtHero: element("rt-hero", HTMLParagraphElement),
  rtCaption: element("rt-caption", HTMLParagraphElement),
  rtChart: element("rt-chart", HTMLDivElement),
  rtAxis: element("rt-axis", HTMLDivElement),
  dressing: element("dressing", HTMLInputElement),
  dressingValue: element("dressing-value", HTMLOutputElement),
  tailLevel: element("tail-level", HTMLParagraphElement),
  setDown: element("set-down", HTMLButtonElement),
  move: element("move", HTMLButtonElement),
  layOut: element("lay-out", HTMLButtonElement),
  renderMs: element("render-ms", HTMLElement),
  peakDb: element("peak-db", HTMLElement),
  limitRow: element("limit-row", HTMLDivElement),
  limitDb: element("limit-db", HTMLElement),
  tailMs: element("tail-ms", HTMLElement),
  saveStatus: element("save-status", HTMLParagraphElement),
};

const timings = new DeviceTimings();

/** A typographic minus for figures below zero. */
function signed(value: number, digits: number): string {
  const text = Math.abs(value).toFixed(digits);
  return value < 0 && Number(text) !== 0 ? `−${text}` : text;
}

function chip(id: string, text: string, selected: boolean, choose: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip";
  button.id = id;
  button.textContent = text;
  button.setAttribute("role", "radio");
  button.setAttribute("aria-checked", String(selected));
  button.tabIndex = selected ? 0 : -1;
  button.addEventListener("click", () => {
    choose();
    // The group is drawn again: the new chip keeps the focus the old one had.
    document.getElementById(id)?.focus();
  });
  return button;
}

/** Arrow keys move the choice within a chip group, as a radio group's do. */
function radioKeys(group: HTMLElement): void {
  group.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    const chips = [...group.querySelectorAll<HTMLButtonElement>(".chip")];
    const at = chips.findIndex((c) => c === document.activeElement);
    const next = chips[(at + step + chips.length) % chips.length];
    if (next === undefined) return;
    event.preventDefault();
    next.click();
  });
}

function drawRooms(): void {
  ui.rooms.replaceChildren(
    ...ROOMS.map((room) =>
      chip(`room-${room}`, TRADES_HALL_PUBLISHED_ROOM_NAMES[room].replace(/^The /, ""), room === state.room, () => {
        if (state.room === room) return;
        state.room = room;
        drawAll();
        requestTail();
      }),
    ),
  );
}

function drawSurfaces(): void {
  ui.surfaces.replaceChildren(
    ...SUPPORTS.map((support) =>
      chip(`surface-${support}`, SURFACE_WORDS[surfaceKindForSupport(SUPPORT_SLUG[support], state.room)], support === state.support, () => {
        state.support = support;
        drawSurfaces();
      }),
    ),
  );
}

function drawPieces(): void {
  const groups = new Map<BodyFamily, HTMLOptGroupElement>();
  for (const body of Object.values(SET_DOWN_BODIES)) {
    let group = groups.get(body.family);
    if (group === undefined) {
      group = document.createElement("optgroup");
      group.label = FAMILY_WORDS[body.family];
      groups.set(body.family, group);
    }
    const option = document.createElement("option");
    option.value = body.slug;
    option.textContent = getCatalogueItemBySlug(body.slug)?.name ?? body.slug;
    group.append(option);
  }
  ui.piece.replaceChildren(...groups.values());
  ui.piece.value = state.slug;
}

function drawPieceFacts(): void {
  const body = bodyFor(state.slug);
  const caps = [...new Set(body.feet.map((foot) => foot.cap))].map((cap) => CAP_WORDS[cap]).join(" and ");
  const extras = [body.legRattle ? "folding legs that rattle" : null, body.seatPuff ? "an upholstered seat" : null, body.castorRoll ? "castors that roll on" : null].filter(
    (extra): extra is string => extra !== null,
  );
  ui.pieceFacts.textContent = `${body.massKg.toFixed(body.massKg < 10 ? 1 : 0)} kg on ${String(body.feet.length)} ${caps}${extras.length > 0 ? `, ${extras.join(", ")}` : ""}.`;
}

function drawRoom(): void {
  const acoustics = ROOM_ACOUSTICS[state.room];
  ui.roomName.textContent = TRADES_HALL_PUBLISHED_ROOM_NAMES[state.room];
  ui.roomFacts.textContent = `${SURFACE_WORDS[floorKindForRoom(state.room)]} · ${Math.round(acoustics.volumeM3).toLocaleString("en-GB")} m³`;
}

/** The reverberation readout: the 1 kHz figure, and every band as a decay on one scale, the empty room's time marked. */
function drawEcho(): void {
  const { laid, of, state: room, empty } = currentRoom();
  ui.dressingValue.textContent = `${String(laid.length)} of ${String(of)} pieces laid`;
  ui.rtHero.replaceChildren(room.rt[ONE_KHZ].toFixed(2), Object.assign(document.createElement("small"), { textContent: "s" }));
  ui.rtCaption.textContent =
    laid.length === 0 ? `Empty. The room's dinner, laid, takes it to ${dressedRt().toFixed(2)} s.` : `Empty, it rings for ${empty.rt[ONE_KHZ].toFixed(2)} s.`;
  const longest = Math.max(...empty.rt, ...room.rt);
  const scale = Math.max(1, Math.ceil(longest * 2) / 2);
  ui.rtChart.replaceChildren(
    ...OCTAVE_BANDS_HZ.map((hz, band) => {
      const row = document.createElement("div");
      row.className = "band";
      row.setAttribute("role", "listitem");
      const seconds = room.rt[band] ?? 0;
      const label = `RT ${BAND_WORDS[band] ?? ""} ${seconds.toFixed(2)} s`;
      row.setAttribute("aria-label", label);
      row.title = label;
      const name = Object.assign(document.createElement("span"), { className: "hz", textContent: BAND_WORDS[band] ?? "" });
      const track = Object.assign(document.createElement("span"), { className: "track" });
      const bar = Object.assign(document.createElement("span"), { className: "bar" });
      bar.style.width = `${((100 * seconds) / scale).toFixed(2)}%`;
      const ghost = Object.assign(document.createElement("span"), { className: "ghost" });
      ghost.style.left = `${((100 * (empty.rt[band] ?? 0)) / scale).toFixed(2)}%`;
      track.append(bar, ghost);
      const value = Object.assign(document.createElement("span"), { className: "value", id: `rt-${String(hz)}`, textContent: `${seconds.toFixed(2)} s` });
      row.append(name, track, value);
      return row;
    }),
  );
  const ticks: HTMLSpanElement[] = [];
  const step = scale > 3 ? 1 : 0.5;
  for (let t = 0; t <= scale + 1e-9; t += step) {
    const tick = document.createElement("span");
    tick.style.left = `${((100 * t) / scale).toFixed(2)}%`;
    tick.textContent = `${t.toFixed(t % 1 === 0 ? 0 : 1)} s`;
    ticks.push(tick);
  }
  ui.rtAxis.replaceChildren(...ticks);
  ui.tailLevel.textContent = `The echo's level is ${signed(gainToDb(room.reverberantGain), 1)} dB against the empty Grand Hall's. The faint mark on each band is this room empty.`;
}

function dressedRt(): number {
  return roomState(ROOM_ACOUSTICS[state.room], referenceDinner(state.room)).rt[ONE_KHZ];
}

function drawDistance(): void {
  ui.distanceValue.textContent = `${state.distanceM.toFixed(1)} m`;
}

function showRender(render: SetDownRender, ms: number, count: number, totalMs?: number): void {
  ui.renderMs.textContent = count > 1 && totalMs !== undefined ? `${ms.toFixed(1)} ms (${String(count)} in ${totalMs.toFixed(0)} ms)` : `${ms.toFixed(1)} ms`;
  ui.peakDb.textContent = `${signed(render.peakDb, 1)} dBFS`;
  ui.limitRow.hidden = render.limitDb === 0;
  ui.limitDb.textContent = `${render.limitDb.toFixed(1)} dB`;
}

function drawAll(): void {
  drawRooms();
  drawRoom();
  drawSurfaces();
  drawPieceFacts();
  drawDistance();
  drawEcho();
}

/**
 * Plays on the press itself, so the sound lands with the press's feedback;
 * a click with no pointer before it (Enter or Space) plays too.
 */
function onPress(button: HTMLButtonElement, play: () => void): void {
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    play();
  });
  button.addEventListener("click", (event) => {
    if (event.detail === 0) play();
  });
}

function wire(): void {
  radioKeys(ui.rooms);
  radioKeys(ui.surfaces);
  ui.piece.addEventListener("change", () => {
    state.slug = ui.piece.value;
    drawPieceFacts();
  });
  ui.distance.addEventListener("input", () => {
    state.distanceM = Number(ui.distance.value);
    drawDistance();
  });
  ui.dressing.addEventListener("input", () => {
    state.dressing = Number(ui.dressing.value);
    drawEcho();
    if (tailDebounce !== null) window.clearTimeout(tailDebounce);
    tailDebounce = window.setTimeout(() => {
      tailDebounce = null;
      requestTail();
    }, TAIL_DEBOUNCE_MS);
  });
  onPress(ui.setDown, () => { playPiece("drop"); });
  onPress(ui.move, () => { playPiece("settle"); });
  onPress(ui.layOut, playCascade);
  // Any first gesture makes the context; each later one resumes it if the browser suspended it.
  for (const type of ["pointerdown", "keydown", "touchend", "click"] as const) {
    document.addEventListener(type, () => { arm(); }, { capture: true });
  }
}

drawPieces();
drawAll();
wire();
requestTail();
void timings.connect();
