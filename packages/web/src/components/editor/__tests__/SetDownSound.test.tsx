import { act } from "@testing-library/react";
import { advance } from "@react-three/fiber";
import type { Space } from "@omnitwin/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import * as configApi from "../../../api/configurations.js";
import type { PlacedObject } from "../../../api/configurations.js";
import {
  announceFurnitureLandedInPlace,
  beginFurnitureSettle,
  carryFurniture,
  clearAllFurnitureSettles,
  dropInFurniture,
  furnitureLandingListenerCount,
  releaseFurniture,
  subscribeFurnitureLandings,
} from "../../../lib/furniture-motion.js";
import { createPlacedItem, snapPositionToGrid, type PlacedItem } from "../../../lib/placement.js";
import { renderSetDown, type SetDownInput } from "../../../lib/set-down/render.js";
import { roomState, roomAcousticsFor } from "../../../lib/set-down/room-acoustics.js";
import { renderRoomTail, tailOnsetSeconds } from "../../../lib/set-down/tail.js";
import { presentDelayFor, setDownStartTime, type AudioClock } from "../../../lib/set-down/timing.js";
import { settleSpeedFor } from "../../../lib/set-down/voice.js";
import {
  SetDownCancelled,
  type SetDownPriority,
  type SetDownRendered,
  type SetDownRenderer,
  type SetDownTail,
} from "../../../lib/set-down/renderer.js";
import type { BandValues } from "../../../lib/set-down/bands.js";
import type { TailOptions } from "../../../lib/set-down/worker-protocol.js";
import type * as ConfigurationsModule from "../../../api/configurations.js";
import type * as RegistryModule from "../../../lib/sound-registry.js";
import type * as RenderModule from "../../../lib/set-down/render.js";
import type * as TailModule from "../../../lib/set-down/tail.js";
import type { SetDownVoice, VenSoundTapDrop } from "../../../lib/sound-registry.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { EditorBridge, __resetEditorBridgeMountCountForTests, placedItemToEditor } from "../EditorBridge.js";
import { FurnitureMotion } from "../FurnitureMotion.js";
import { SetDownSound } from "../SetDownSound.js";
import { __setSetDownRendererFactoryForTests } from "../set-down-driver.js";
import { RENDER_MODE_STORAGE_KEY } from "../set-down-policy.js";

// ---------------------------------------------------------------------------
// The set-down sound in the scene (T-700, Task 14b). A piece starting down
// asks the Worker for its render; its contact frame plays it through the
// room (the registry, mocked here: its own tests cover the graph). Nothing is
// rendered on the main thread, nothing plays on load, undo, redo, another
// person's change, a ghost, a hidden tab or before the first gesture, and each
// device learns which pieces it must render ahead (ruling R100).
// ---------------------------------------------------------------------------

interface Played {
  readonly voice: SetDownVoice;
  /** The test's frame count when it played. */
  readonly frame: number;
  readonly atMs: number;
}

interface BatchSeen {
  readonly count: number;
  readonly plays: Played[];
}

const registry = vi.hoisted(() => ({
  mode: "quiet" as "off" | "quiet" | "full",
  rate: null as number | null,
  outputLatency: 0.005,
  armed: new Set<(sampleRate: number) => void>(),
  settings: new Set<() => void>(),
  batches: [] as BatchSeen[],
  /** Page times of the plays admitted in the last second, as the registry's eight-a-second rule keeps them. */
  admitted: [] as number[],
  tails: [] as string[],
  wakes: 0,
  drops: [] as VenSoundTapDrop[],
  frame: 0,
  startMs: 1_000,
}));

vi.mock("../../../lib/sound-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof RegistryModule>();
  const hidden = (): boolean => document.visibilityState === "hidden";
  return {
    ...actual,
    beginSetDownBatch: (count: number): RegistryModule.SetDownBatch | null => {
      const nowMs = performance.now();
      if (registry.rate === null || registry.mode === "off" || hidden()) return null;
      registry.admitted = registry.admitted.filter((at) => nowMs - at < 1000);
      const allowed = Math.min(count, 8 - registry.admitted.length);
      if (allowed < 1) return null;
      for (let i = 0; i < allowed; i++) registry.admitted.push(nowMs);
      const seen: BatchSeen = { count, plays: [] };
      registry.batches.push(seen);
      let left = allowed;
      return {
        play: (voice: SetDownVoice): boolean => {
          if (left <= 0 || registry.mode === "off" || hidden()) return false;
          left -= 1;
          seen.plays.push({ voice, frame: registry.frame, atMs: performance.now() });
          return true;
        },
      };
    },
    setPlannerRoomTail: (_tail: unknown, key: string): boolean => {
      registry.tails.push(key);
      return true;
    },
    plannerAudioClock: (): AudioClock | null => registry.rate === null
      ? null
      : { currentTime: 2 + (performance.now() - registry.startMs) / 1000, outputLatency: registry.outputLatency, sampleRate: registry.rate },
    wakePlannerSound: (): void => { registry.wakes += 1; },
    subscribePlannerSoundArmed: (listener: (sampleRate: number) => void): (() => void) => {
      registry.armed.add(listener);
      if (registry.rate !== null) listener(registry.rate);
      return () => { registry.armed.delete(listener); };
    },
    getPlannerSoundSettings: () => ({ mode: registry.mode, level: 0.6 }),
    subscribePlannerSound: (listener: () => void): (() => void) => {
      registry.settings.add(listener);
      return () => { registry.settings.delete(listener); };
    },
    logSetDownDrop: (drop: VenSoundTapDrop): void => { registry.drops.push(drop); },
  };
});

// The engine's renderers, watched: the main thread must never call them.
vi.mock("../../../lib/set-down/render.js", async (importOriginal) => {
  const actual = await importOriginal<typeof RenderModule>();
  return { ...actual, renderSetDown: vi.fn(actual.renderSetDown) };
});
vi.mock("../../../lib/set-down/tail.js", async (importOriginal) => {
  const actual = await importOriginal<typeof TailModule>();
  return { ...actual, renderRoomTail: vi.fn(actual.renderRoomTail) };
});

// The layout's server, for the tests that record the timeline through the bridge: loads, autosaves.
vi.mock("../../../api/configurations.js", async (importOriginal) => ({
  ...await importOriginal<typeof ConfigurationsModule>(),
  getConfig: vi.fn(),
  getPublicConfig: vi.fn(),
  authBatchSave: vi.fn(),
  publicBatchSave: vi.fn(),
}));
vi.mock("../../../api/configuration-conflict.js", () => ({ parseRevisionConflict: vi.fn(() => null) }));
vi.mock("../../../api/spaces.js", () => ({ getSpace: vi.fn(async () => Promise.reject(new Error("no space in tests"))) }));
vi.mock("../../../api/action-log.js", () => ({ postActionBatch: vi.fn(() => Promise.resolve({ accepted: 0, duplicates: 0 })) }));

// --- A renderer whose answers the test gives -------------------------------------------------

interface FakeJob {
  readonly kind: "render" | "tail";
  readonly priority: SetDownPriority | "tail";
  readonly key: string;
  readonly input: SetDownInput | null;
  readonly rt: BandValues | null;
  readonly options: TailOptions | null;
  state: "pending" | "answered" | "cancelled";
  /** Answers it, with the Worker's time. */
  answer(workMs?: number): void;
}

/** Which job each render came from, so a played voice can be traced to its piece. */
const renderedBy = new WeakMap<object, FakeJob>();

class FakeRenderer implements SetDownRenderer {
  readonly jobs: FakeJob[] = [];
  readonly cancelled: string[] = [];
  disposed = false;
  private readonly rejectors = new Map<FakeJob, (reason: Error) => void>();

  get broken(): boolean { return false; }

  render(input: SetDownInput, priority: SetDownPriority, key: string): Promise<SetDownRendered> {
    return new Promise((resolve, reject) => {
      const job: FakeJob = {
        kind: "render", priority, key, input, rt: null, options: null, state: "pending",
        answer: (workMs = 8) => {
          if (job.state !== "pending") return;
          job.state = "answered";
          this.rejectors.delete(job);
          const length = 480;
          const rendered: SetDownRendered = {
            left: new Float32Array(length).fill(0.01),
            right: new Float32Array(length).fill(0.01),
            sampleRate: input.sampleRate,
            peakDb: -20,
            onsetSeconds: 0.002,
            limitDb: 0,
            workMs,
          };
          renderedBy.set(rendered, job);
          resolve(rendered);
        },
      };
      this.jobs.push(job);
      this.rejectors.set(job, reject);
    });
  }

  tail(rt: BandValues, options: TailOptions, key: string): Promise<SetDownTail> {
    return new Promise((resolve, reject) => {
      const job: FakeJob = {
        kind: "tail", priority: "tail", key, input: null, rt, options, state: "pending",
        answer: (workMs = 40) => {
          if (job.state !== "pending") return;
          job.state = "answered";
          this.rejectors.delete(job);
          resolve({ left: new Float32Array(64), right: new Float32Array(64), sampleRate: options.sampleRate, workMs });
        },
      };
      this.jobs.push(job);
      this.rejectors.set(job, reject);
    });
  }

  cancel(matches: (key: string) => boolean): void {
    for (const job of this.jobs) {
      if (job.state !== "pending" || !matches(job.key)) continue;
      job.state = "cancelled";
      this.cancelled.push(job.key);
      this.rejectors.get(job)?.(new SetDownCancelled("cancelled", job.key));
      this.rejectors.delete(job);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancel(() => true);
  }

  renders(priority?: SetDownPriority): FakeJob[] {
    return this.jobs.filter((job) => job.kind === "render" && (priority === undefined || job.priority === priority));
  }

  tails(): FakeJob[] {
    return this.jobs.filter((job) => job.kind === "tail");
  }

  pending(priority: SetDownPriority, cls?: string): FakeJob[] {
    return this.renders(priority).filter((job) => job.state === "pending" && (cls === undefined || job.key.startsWith(`ahead|${cls}|`)));
  }
}

// --- The room, the clock and the frames -----------------------------------------------------

function space(name: string, slug: string, id: string): Space {
  return {
    id, venueId: "venue-trades-hall", name, slug, description: null, widthM: "21", lengthM: "10.5", heightM: "7.5",
    floorPlanOutline: [], meshUrl: null, thumbnailUrl: null, sortOrder: 0,
    createdAt: "2026-11-18T00:00:00.000Z", updatedAt: "2026-11-18T00:00:00.000Z",
  };
}
const GRAND_HALL = space("Grand Hall", "grand-hall", "space-grand-hall");
const SALOON = space("Saloon", "saloon", "space-saloon");

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return item.id;
}

let now = 1_000;
let seconds = 100;
let reduced = false;
let renderer: FakeRenderer;
let mounted: StubRoot | null = null;
const hiddenState = { hidden: false };

/** Time passes: the page's clock and its timers together. */
function pass(ms: number): void {
  now += ms;
  vi.advanceTimersByTime(ms);
}

/** One display frame at 60 Hz, through the scene's frame loop. */
function frame(): void {
  pass(1000 / 60);
  registry.frame += 1;
  act(() => { advance(seconds, true); });
  seconds += 1 / 60;
}

/** Frames, with each frame's microtasks run before the next, as a browser runs them between frames. */
async function frames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    frame();
    for (let j = 0; j < 5; j++) await Promise.resolve();
  }
}

/** Frames, letting each frame's microtasks run, until `done` holds (at most two seconds of them). */
async function framesUntil(done: () => boolean): Promise<void> {
  for (let i = 0; i < 120 && !done(); i++) {
    frame();
    await settle();
  }
  if (!done()) throw new Error("it never happened");
}

/** Lets promises, microtasks and the driver's lazy import settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

function mount(): void {
  mounted = mountInStubRoot(<><FurnitureMotion /><SetDownSound /></>);
  frame();
  frame();
  registry.frame = 0;
}

/** The first gesture: the registry makes its context and tells its listeners the rate. */
async function arm(rate = 48000): Promise<void> {
  registry.rate = rate;
  act(() => { for (const listener of [...registry.armed]) listener(rate); });
  await settle();
}

async function mountArmed(): Promise<void> {
  mount();
  await arm();
}

function plays(): Played[] {
  return registry.batches.flatMap((batch) => batch.plays);
}

async function place(slug: string, x: number, z: number): Promise<PlacedItem> {
  act(() => { usePlacementStore.getState().placeItem(catalogueId(slug), x, z); });
  await settle();
  const placed = usePlacementStore.getState().placedItems.at(-1);
  if (placed === undefined) throw new Error(`${slug} was not placed`);
  return placed;
}

/** A piece put in the room with no announcement, as a load or the live overlay puts it. */
function stand(slug: string, x: number, z: number, extra: Partial<PlacedItem> = {}): PlacedItem {
  const item: PlacedItem = { ...createPlacedItem(catalogueId(slug), x, z), ...extra };
  usePlacementStore.setState({ placedItems: [...usePlacementStore.getState().placedItems, item] });
  return item;
}

/** Answers every render still waiting, at `workMs`. */
async function answerAll(workMs = 8): Promise<void> {
  for (const job of renderer.renders()) job.answer(workMs);
  await settle();
}

function isFiniteDeep(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isFiniteDeep);
  if (typeof value === "object" && value !== null) return Object.values(value).every(isFiniteDeep);
  return true;
}

// Each store's live subscriptions, counted, so an unmount can be seen to leave none behind.
const subscriptions = new Map<string, number>();
function countSubscriptions(name: string, store: { subscribe: (listener: never) => () => void }): void {
  const original = store.subscribe;
  vi.spyOn(store, "subscribe").mockImplementation((listener: never) => {
    subscriptions.set(name, (subscriptions.get(name) ?? 0) + 1);
    const unsubscribe = original(listener);
    let live = true;
    return () => {
      if (live) subscriptions.set(name, (subscriptions.get(name) ?? 0) - 1);
      live = false;
      unsubscribe();
    };
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  now = 1_000;
  seconds = 100;
  reduced = false;
  hiddenState.hidden = false;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => (hiddenState.hidden ? "hidden" : "visible"));
  vi.spyOn(window, "matchMedia").mockImplementation((query: string): MediaQueryList => ({
    matches: reduced && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
  Object.assign(registry, {
    mode: "quiet", rate: null, outputLatency: 0.005, batches: [], admitted: [], tails: [], wakes: 0, drops: [], frame: 0, startMs: 1_000,
  });
  registry.armed.clear();
  registry.settings.clear();
  subscriptions.clear();
  clearAllFurnitureSettles();
  useEditorStore.getState().reset();
  useEditorStore.setState({ space: GRAND_HALL });
  usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostRotation: 0, snapEnabled: false });
  useCatalogueStore.getState().clearSelection();
  useCockpitStore.setState({ walkMode: false });
  renderer = new FakeRenderer();
  __setSetDownRendererFactoryForTests(() => renderer);
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  __setSetDownRendererFactoryForTests(null);
  clearAllFurnitureSettles();
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
  useCatalogueStore.getState().clearSelection();
  useEditorStore.getState().reset();
  // Nothing in the scene ever renders on the main thread.
  expect(renderSetDown).not.toHaveBeenCalled();
  expect(renderRoomTail).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

// --- Silence -------------------------------------------------------------------------------

describe("what never sounds", () => {
  it("posts and plays nothing for a load, an undo, a redo or another person's change", async () => {
    await mountArmed();
    // A load, as the bridge writes it, and another person's change through the live overlay: no announcement.
    act(() => { stand("chiavari-chair", 1, 1); stand("round-table-6ft", 3, 2); });
    act(() => { useEditorStore.getState().addObject(catalogueId("chiavari-chair"), 1, 0, 2); });
    act(() => { useEditorStore.getState().undo(); });
    act(() => { useEditorStore.getState().redo(); });
    await settle();
    await frames(30);
    expect(renderer.renders()).toEqual([]);
    expect(plays()).toEqual([]);
  });

  it("renders and plays nothing before the first gesture", async () => {
    mount();
    pass(2_000);
    await settle();
    await place("chiavari-chair", 2, 1);
    await frames(10);
    expect(renderer.jobs).toEqual([]);
    expect(plays()).toEqual([]);
  });

  it("renders and plays nothing in a hidden tab", async () => {
    await mountArmed();
    hiddenState.hidden = true;
    await place("chiavari-chair", 2, 1);
    await frames(10);
    expect(renderer.renders()).toEqual([]);
    expect(plays()).toEqual([]);
  });

  it("renders and plays nothing while sound is Off", async () => {
    await mountArmed();
    registry.mode = "off";
    await place("chiavari-chair", 2, 1);
    await frames(10);
    expect(renderer.renders()).toEqual([]);
    expect(plays()).toEqual([]);
  });

  it("plays no set-downs where module Workers are refused (R83)", async () => {
    __setSetDownRendererFactoryForTests(() => null);
    await mountArmed();
    await place("chiavari-chair", 2, 1);
    await frames(10);
    expect(plays()).toEqual([]);
  });

  it("never voices a landing whose gesture an undo ended, nor one in hand when the undo came (R87)", async () => {
    await mountArmed();
    act(() => { useEditorStore.getState().addObject(catalogueId("chiavari-chair"), 1, 0, 2); });
    await place("chiavari-chair", 2, 1);
    await answerAll();
    await frames(2);
    act(() => { useEditorStore.getState().undo(); });
    await frames(10);
    expect(plays()).toEqual([]);
    expect(registry.drops).toEqual([expect.objectContaining({ drop: "undone" })]);

    // In hand when the redo came: the resting hand sets it down 0.4 s later, and it stays silent.
    const chair = stand("chiavari-chair", -2, -1);
    act(() => { carryFurniture([chair.id], 1.2, 0); });
    await frames(3);
    act(() => { useEditorStore.getState().redo(); });
    await frames(40);
    await answerAll();
    await frames(10);
    expect(plays()).toEqual([]);
    expect(registry.drops.map((drop) => drop.drop)).toEqual(["undone", "undone"]);
  });

  it("still voices a landing when a new edit, not an undo, comes during its drop", async () => {
    await mountArmed();
    await place("chiavari-chair", 2, 1);
    await answerAll();
    await frames(2);
    act(() => { useEditorStore.getState().addObject(catalogueId("chiavari-chair"), 1, 0, 2); });
    await frames(5);
    expect(plays()).toHaveLength(1);
  });

  it("drops, and counts, a landing whose piece is gone by its contact (R89)", async () => {
    await mountArmed();
    const chair = await place("chiavari-chair", 2, 1);
    await answerAll();
    await frames(2);
    act(() => { usePlacementStore.setState({ placedItems: usePlacementStore.getState().placedItems.filter((item) => item.id !== chair.id) }); });
    await frames(10);
    expect(plays()).toEqual([]);
    expect(registry.drops).toEqual([expect.objectContaining({ drop: "gone", slug: "chiavari-chair" })]);
  });
});

// --- Lazy loading (R78) --------------------------------------------------------------------

describe("the shell and its driver (R78)", () => {
  it("hears the landings from its mount, and drops and counts one whose driver has not loaded by its contact", async () => {
    const before = furnitureLandingListenerCount();
    mount();
    expect(furnitureLandingListenerCount()).toBe(before + 1);
    await place("chiavari-chair", 2, 1);
    await frames(10);
    expect(registry.drops).toEqual([{ drop: "not-loaded" }]);
    expect(plays()).toEqual([]);
  });

  it("loads the driver at the planner's first idle when sound is on, and starts the Worker only at arming", async () => {
    let made = 0;
    __setSetDownRendererFactoryForTests(() => { made += 1; return renderer; });
    countSubscriptions("placement", usePlacementStore);
    mount();
    const shellOnly = subscriptions.get("placement") ?? 0;
    pass(2_000);
    await settle();
    expect(subscriptions.get("placement") ?? 0, "the driver now watches the room").toBeGreaterThan(shellOnly);
    expect(made).toBe(0);
    await arm();
    expect(made).toBe(1);
    expect(renderer.tails()).toHaveLength(1);
  });

  it("does not load the driver at idle while sound is Off, and loads it at arming", async () => {
    let made = 0;
    __setSetDownRendererFactoryForTests(() => { made += 1; return renderer; });
    countSubscriptions("placement", usePlacementStore);
    registry.mode = "off";
    mount();
    const shellOnly = subscriptions.get("placement") ?? 0;
    pass(5_000);
    await settle();
    expect(subscriptions.get("placement") ?? 0).toBe(shellOnly);
    registry.mode = "quiet";
    await arm();
    expect(made).toBe(1);
  });

  it("leaves no listener, subscription, timer or Worker behind when it unmounts", async () => {
    // Unmounting an R3F root schedules the root's own disposal (unmountComponentAtNode): measured on a root without the sound.
    mountInStubRoot(<FurnitureMotion />).unmount();
    const rootTimers = vi.getTimerCount();
    vi.clearAllTimers();
    countSubscriptions("placement", usePlacementStore);
    countSubscriptions("editor", useEditorStore);
    countSubscriptions("catalogue", useCatalogueStore);
    const landings = furnitureLandingListenerCount();
    await mountArmed();
    expect(furnitureLandingListenerCount()).toBe(landings + 1);
    expect(subscriptions.get("placement") ?? 0).toBeGreaterThan(0);
    expect(registry.armed.size).toBeGreaterThan(0);
    // A chair landing with its render not yet in: the room's 250 ms settle and the 45 ms wait are both running.
    await place("chiavari-chair", 2, 1);
    await frames(5);
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2);
    mounted?.unmount();
    mounted = null;
    expect(furnitureLandingListenerCount()).toBe(landings);
    expect(subscriptions.get("placement") ?? 0).toBe(0);
    expect(subscriptions.get("editor") ?? 0).toBe(0);
    expect(subscriptions.get("catalogue") ?? 0).toBe(0);
    expect(registry.armed.size).toBe(0);
    expect(registry.settings.size).toBe(0);
    expect(renderer.disposed).toBe(true);
    expect(vi.getTimerCount(), "only the root's own disposal: no settle or wait left running").toBe(rootTimers);
  });
});

// --- Playing set-downs ------------------------------------------------------------------------

describe("a piece set down", () => {
  it("posts one exact render at the announcement and plays one voice on its contact frame (frame 5)", async () => {
    await mountArmed();
    const wakes = registry.wakes;
    await place("chiavari-chair", 2, 1);
    expect(renderer.renders()).toHaveLength(1);
    expect(renderer.renders("exact")).toHaveLength(1);
    expect(registry.wakes, "the drop wakes a sleeping context").toBe(wakes + 1);
    await answerAll();
    await frames(4);
    expect(plays()).toEqual([]);
    frame();
    expect(plays()).toHaveLength(1);
    expect(plays()[0]?.frame).toBe(5);
    expect(registry.batches).toEqual([expect.objectContaining({ count: 1 })]);
    await frames(20);
    expect(plays()).toHaveLength(1);
  });

  it.each([0.005, 0.06])("starts its voice at setDownStartTime with an output latency of %f s", async (latency) => {
    registry.outputLatency = latency;
    await mountArmed();
    await place("chiavari-chair", 2, 1);
    await answerAll();
    await frames(4);
    const delta = 1 / 60;
    frame();
    const played = plays()[0];
    if (played === undefined) throw new Error("nothing played");
    const clock: AudioClock = { currentTime: 2 + (now - registry.startMs) / 1000, outputLatency: latency, sampleRate: 48000 };
    expect(played.voice.startAt).toBeCloseTo(setDownStartTime(clock, presentDelayFor(delta), 0.002), 6);
    expect(played.voice.startAt).toBeGreaterThanOrEqual(clock.currentTime);
  });

  it("sends the room's own send, never scaled by distance, and its dry gain alone falls with distance (R58, R11)", async () => {
    await mountArmed();
    await place("chiavari-chair", 8, 4);
    await answerAll();
    await frames(5);
    const voice = plays()[0]?.voice;
    if (voice === undefined) throw new Error("nothing played");
    expect(voice.send).toBe(roomState(roomAcousticsFor(GRAND_HALL), []).send);
    expect(voice.directGain).toBeGreaterThan(0);
    expect(voice.directGain).toBeLessThanOrEqual(1);
    expect(voice.tap).toMatchObject({ slug: "chiavari-chair", played: "exact", workMs: 8 });
  });

  it.each([
    [10, "late"],
    [40, "late"],
  ])("plays a chair's render answered %i ms after its contact at once, logged %s (R80)", async (afterMs) => {
    await mountArmed();
    await place("chiavari-chair", 2, 1);
    await frames(5);
    expect(plays()).toEqual([]);
    pass(afterMs);
    await answerAll(30);
    expect(plays()).toHaveLength(1);
    const voice = plays()[0]?.voice;
    expect(voice?.tap).toMatchObject({ played: "late", workMs: 30 });
    expect(voice?.startAt).toBeCloseTo(2 + (now - registry.startMs) / 1000, 9);
  });

  it("plays nothing for a chair whose render answers past 45 ms after its contact, and logs the miss (R80)", async () => {
    await mountArmed();
    await place("chiavari-chair", 2, 1);
    await frames(5);
    pass(50);
    await answerAll(60);
    await frames(5);
    expect(plays()).toEqual([]);
    expect(registry.drops).toEqual([expect.objectContaining({ drop: "too-late", slug: "chiavari-chair" })]);
  });

  it("plays a staging deck's variant, rendered ahead since its pickup, when its exact render is not ready", async () => {
    await mountArmed();
    const deck = stand("staging-deck-6x4", 0, 0);
    act(() => { carryFurniture([deck.id], 0.6, 0); });
    await settle();
    const ahead = renderer.renders("ahead");
    expect(ahead).toHaveLength(1);
    expect(ahead[0]?.input?.kind).toBe("settle");
    ahead[0]?.answer(20);
    await settle();
    await frames(3);
    act(() => { releaseFurniture([deck.id]); });
    await settle();
    expect(renderer.pending("exact")).toHaveLength(1);
    await frames(8);
    expect(plays()).toHaveLength(1);
    expect(plays()[0]?.voice.tap).toMatchObject({ slug: "staging-deck-6x4", played: "variant" });
  });

  it("under reduced motion plays nothing until the render answers, then one voice at once (R84)", async () => {
    reduced = true;
    await mountArmed();
    await place("chiavari-chair", 2, 1);
    expect(renderer.renders("exact")).toHaveLength(1);
    await frames(20);
    expect(plays()).toEqual([]);
    pass(30);
    await answerAll();
    expect(plays()).toHaveLength(1);
    expect(plays()[0]?.voice.startAt).toBeCloseTo(2 + (now - registry.startMs) / 1000, 9);
  });

  it("plays a let-go chair as a settle at its contact (frame 4), and nothing more for a release after a resting hand set it down", async () => {
    await mountArmed();
    const chair = stand("chiavari-chair", 0, 0);
    act(() => { carryFurniture([chair.id], 1.2, 0); });
    await frames(3);
    act(() => { releaseFurniture([chair.id]); });
    await settle();
    const [exact] = renderer.renders("exact");
    expect(exact?.input?.kind).toBe("settle");
    expect(exact?.input?.speed).toBeCloseTo(settleSpeedFor(1.2), 12);
    await answerAll();
    registry.frame = 0;
    await frames(3);
    expect(plays()).toEqual([]);
    frame();
    expect(plays().map((played) => played.frame)).toEqual([4]);

    // A resting hand sets it down 0.4 s on, its render answered at once; a later release has nothing to land.
    act(() => { carryFurniture([chair.id], 0.2, 0); });
    await framesUntil(() => renderer.renders("exact").length === 2);
    await answerAll();
    await frames(10);
    expect(plays()).toHaveLength(2);
    const renders = renderer.renders().length;
    act(() => { releaseFurniture([chair.id]); });
    await settle();
    await frames(10);
    expect(renderer.renders()).toHaveLength(renders);
    expect(plays()).toHaveLength(2);
  });

  it("renders a chair set on a staging deck with the deck's surface under every foot", async () => {
    await mountArmed();
    stand("staging-deck-6x4", 0, 0);
    await place("chiavari-chair", 0, 0);
    const surfaces = renderer.renders("exact")[0]?.input?.surfaces ?? [];
    expect(surfaces.length).toBeGreaterThan(0);
    expect(surfaces.every((surface) => surface.kind === "stage-deck")).toBe(true);
  });

  it("plays the drop's render, logged stale, when the deck under a chair is taken away before it lands (Review Focus 5)", async () => {
    await mountArmed();
    const deck = stand("staging-deck-6x4", 0, 0);
    await place("chiavari-chair", 0, 0);
    await answerAll();
    frame();
    act(() => { usePlacementStore.setState({ placedItems: usePlacementStore.getState().placedItems.filter((item) => item.id !== deck.id) }); });
    await frames(8);
    expect(plays()).toHaveLength(1);
    expect(plays()[0]?.voice.tap).toMatchObject({ played: "stale" });
  });

  it("renders an imported piece at scale 1.7 to finite figures, and plays it (Review Focus 4)", async () => {
    await mountArmed();
    const imported: PlacedItem = { ...createPlacedItem("imported-gltf-sculpture", 1, 1), scale: 1.7 };
    usePlacementStore.setState({ placedItems: [imported] });
    act(() => { dropInFurniture(imported.id); });
    await settle();
    const [job] = renderer.renders("exact");
    expect(job).toBeDefined();
    expect(isFiniteDeep(job?.input)).toBe(true);
    await answerAll();
    await frames(8);
    expect(plays()).toHaveLength(1);
  });
});

// --- Many at once -----------------------------------------------------------------------------

describe("many pieces", () => {
  it("voices a Lay out of 80 chairs and 8 rounds with at most 8 renders and one batch, never before a piece's contact, at most 3 in 250 ms", async () => {
    await mountArmed();
    const contacts = new Map<string, number>();
    const stopHearing = subscribeFurnitureLandings({
      pickedUp: () => undefined,
      dropStarted: () => undefined,
      touchedDown: (id) => { contacts.set(id, performance.now()); },
      landedInPlace: () => undefined,
    });
    act(() => { usePlacementStore.getState().autoArrangeBanquet(catalogueId("round-table-6ft"), 80, 10); });
    await settle();
    expect(usePlacementStore.getState().placedItems.length).toBeGreaterThanOrEqual(88);
    expect(renderer.renders().length).toBeGreaterThan(0);
    expect(renderer.renders().length).toBeLessThanOrEqual(8);
    await answerAll();
    await frames(60);
    stopHearing();
    expect(registry.batches).toHaveLength(1);
    expect(registry.batches[0]?.count).toBeLessThanOrEqual(8);
    const played = plays();
    expect(played.length).toBeGreaterThan(3);
    for (const play of played) {
      const job = renderedBy.get(play.voice.render);
      const id = job?.key.split("|")[2] ?? "";
      const contactMs = contacts.get(id);
      expect(contactMs, `voiced piece ${id} touched down`).toBeDefined();
      expect(play.atMs).toBeGreaterThanOrEqual(contactMs ?? Number.POSITIVE_INFINITY);
    }
    const starts = played.map((play) => play.voice.startAt).sort((a, b) => a - b);
    for (let i = 0; i + 3 < starts.length; i++) {
      expect((starts[i + 3] ?? 0) - (starts[i] ?? 0), "no four voices within 250 ms").toBeGreaterThanOrEqual(0.25);
    }
  });

  it("admits at most 8 plays for ten placements within a second, and never holds more than 8 renders (Review Focus 2)", async () => {
    await mountArmed();
    let mostPending = 0;
    for (let i = 0; i < 10; i++) {
      await place("chiavari-chair", -6 + i * 1.2, 2);
      mostPending = Math.max(mostPending, renderer.pending("exact").length);
      await answerAll();
      await frames(6);
    }
    expect(plays().length).toBeLessThanOrEqual(8);
    expect(registry.batches.every((batch) => batch.count <= 8 && batch.plays.length <= batch.count)).toBe(true);
    expect(mostPending).toBeLessThanOrEqual(8);
  });
});

// --- The room ---------------------------------------------------------------------------------

describe("the room's tail", () => {
  it("is rendered in the Worker at the context's rate on arming, then put on the room bus", async () => {
    await mountArmed();
    const [tail] = renderer.tails();
    const empty = roomState(roomAcousticsFor(GRAND_HALL), []);
    expect(tail?.options).toEqual({ sampleRate: 48000, seed: 1, onsetSeconds: tailOnsetSeconds(roomAcousticsFor(GRAND_HALL)) });
    expect(tail?.rt).toEqual(empty.rt);
    tail?.answer();
    await settle();
    expect(registry.tails).toEqual([tail?.key]);
  });

  it("follows a change of room at once: the next tail is the Saloon's, and the Grand Hall's is cancelled (Review Focus 3)", async () => {
    await mountArmed();
    const [grandHall] = renderer.tails();
    act(() => { useEditorStore.setState({ space: SALOON }); });
    await settle();
    expect(grandHall?.state).toBe("cancelled");
    const next = renderer.tails().at(-1);
    expect(next).not.toBe(grandHall);
    expect(next?.key).toContain("saloon");
    expect(next?.rt).toEqual(roomState(roomAcousticsFor(SALOON), []).rt);
  });

  it("gets a new tail 250 ms after a dressed round changes the room's key, put on the bus once", async () => {
    useEditorStore.setState({ space: SALOON });
    await mountArmed();
    renderer.tails()[0]?.answer();
    await settle();
    expect(registry.tails).toHaveLength(1);
    const round = createPlacedItem(catalogueId("round-table-6ft-white"), 1, 1);
    const before = roomState(roomAcousticsFor(SALOON), []);
    const after = roomState(roomAcousticsFor(SALOON), [round]);
    expect(after.key, "a dressed round is enough to change the Saloon's key").not.toBe(before.key);
    act(() => { usePlacementStore.setState({ placedItems: [round] }); });
    pass(200);
    expect(renderer.tails()).toHaveLength(1);
    pass(60);
    await settle();
    expect(renderer.tails()).toHaveLength(2);
    renderer.tails()[1]?.answer();
    await settle();
    expect(registry.tails).toHaveLength(2);
    expect(registry.tails[1]).toContain(after.key);
  });
});

// --- The adaptive render policy (R100) -------------------------------------------------------

describe("the adaptive render policy (R100)", () => {
  /** A chair set down whose render answers `afterContactMs` after its contact, at `workMs`. */
  async function chairLanding(x: number, afterContactMs: number | null, workMs: number): Promise<void> {
    await place("chiavari-chair", x, 3);
    if (afterContactMs === null) {
      await answerAll(workMs);
      await frames(6);
      return;
    }
    await frames(5);
    pass(afterContactMs);
    await answerAll(workMs);
    await frames(1);
  }

  it("switches chairs to render-ahead on a cold start whose slow renders miss 2 of the first 5 contacts, and keeps it on the device (condition 1)", async () => {
    await mountArmed();
    expect(localStorage.getItem(RENDER_MODE_STORAGE_KEY)).toBeNull();
    await chairLanding(-4, 60, 120);
    expect(localStorage.getItem(RENDER_MODE_STORAGE_KEY)).toBeNull();
    await chairLanding(-2, 70, 130);
    expect(localStorage.getItem(RENDER_MODE_STORAGE_KEY)).toBe(JSON.stringify({ light: "ahead", table: "exact" }));
    expect(registry.drops.map((drop) => drop.drop)).toEqual(["too-late", "too-late"]);
    // Now a chair taken in hand is rendered ahead.
    const chair = stand("chiavari-chair", 5, 5);
    act(() => { carryFurniture([chair.id], 1, 0); });
    await settle();
    expect(renderer.pending("ahead", "light")).toHaveLength(1);
  });

  it("switches back to exact renders after 10 on-time contacts well inside their window, and not after 9 and a late one (condition 3)", async () => {
    localStorage.setItem(RENDER_MODE_STORAGE_KEY, JSON.stringify({ light: "ahead", table: "exact" }));
    await mountArmed();
    for (let i = 0; i < 9; i++) await chairLanding(-6 + i, null, 8);
    await chairLanding(4, 20, 70);
    expect(JSON.parse(localStorage.getItem(RENDER_MODE_STORAGE_KEY) ?? "{}")).toMatchObject({ light: "ahead" });
    for (let i = 0; i < 10; i++) await chairLanding(-6 + i, null, 8);
    expect(localStorage.getItem(RENDER_MODE_STORAGE_KEY)).toBe(JSON.stringify({ light: "exact", table: "exact" }));
    const chair = stand("chiavari-chair", 5, 5);
    act(() => { carryFurniture([chair.id], 1, 0); });
    await settle();
    expect(renderer.pending("ahead", "light"), "back at its drop: nothing rendered ahead").toHaveLength(0);
  });

  it("keeps at most one render ahead in flight per class, however many pieces are taken up (condition 2)", async () => {
    localStorage.setItem(RENDER_MODE_STORAGE_KEY, JSON.stringify({ light: "ahead", table: "exact" }));
    await mountArmed();
    const chairs = [0, 1, 2, 3].map((i) => stand("chiavari-chair", i, -2));
    act(() => { carryFurniture(chairs.map((chair) => chair.id), 1, 0); });
    await settle();
    await frames(20);
    expect(renderer.pending("ahead", "light")).toHaveLength(1);
    const deck = stand("staging-deck-6x4", -5, 4);
    act(() => { carryFurniture([deck.id], 0.5, 0); });
    await settle();
    expect(renderer.pending("ahead", "heavy"), "each class has its own one").toHaveLength(1);
    expect(renderer.pending("ahead", "light")).toHaveLength(1);
  });

  it("cancels a piece's render ahead when it is put back down (condition 2)", async () => {
    localStorage.setItem(RENDER_MODE_STORAGE_KEY, JSON.stringify({ light: "ahead", table: "exact" }));
    await mountArmed();
    const chair = stand("chiavari-chair", 1, 1);
    act(() => { carryFurniture([chair.id], 1, 0); });
    await settle();
    const [ahead] = renderer.pending("ahead", "light");
    await frames(3);
    act(() => { releaseFurniture([chair.id]); });
    await settle();
    expect(ahead?.state).toBe("cancelled");
    expect(renderer.pending("exact")).toHaveLength(1);
  });

  it("renders a new piece ahead while its ghost shows, not again as the ghost only moves, again when its supports change, and cancels when the ghost leaves (condition 2)", async () => {
    localStorage.setItem(RENDER_MODE_STORAGE_KEY, JSON.stringify({ light: "ahead", table: "exact" }));
    await mountArmed();
    stand("staging-deck-6x4", 6, 0);
    act(() => { useCatalogueStore.getState().selectItem(catalogueId("chiavari-chair")); });
    act(() => { usePlacementStore.setState({ ghostPosition: [-4, 0, -2] }); });
    await settle();
    expect(renderer.pending("ahead", "light")).toHaveLength(1);
    const [first] = renderer.pending("ahead", "light");
    expect(first?.input?.kind).toBe("drop");
    for (let i = 1; i <= 5; i++) {
      pass(300);
      act(() => { usePlacementStore.setState({ ghostPosition: [-4 + i * 0.3, 0, -2] }); });
      await settle();
    }
    expect(renderer.renders("ahead"), "moving over the same floor renders nothing more").toHaveLength(1);
    first?.answer(15);
    await settle();
    pass(300);
    act(() => { usePlacementStore.setState({ ghostPosition: [6, 0.4, 0] }); });
    pass(300);
    await settle();
    const onDeck = renderer.pending("ahead", "light");
    expect(onDeck).toHaveLength(1);
    expect(onDeck[0]?.input?.surfaces.every((surface) => surface.kind === "stage-deck")).toBe(true);
    act(() => { usePlacementStore.setState({ ghostPosition: null }); });
    await settle();
    expect(onDeck[0]?.state, "the ghost left without a placement").toBe("cancelled");
  });

  it("plays a new chair's ghost-rendered variant at its contact when its exact render is late", async () => {
    localStorage.setItem(RENDER_MODE_STORAGE_KEY, JSON.stringify({ light: "ahead", table: "exact" }));
    await mountArmed();
    act(() => { useCatalogueStore.getState().selectItem(catalogueId("chiavari-chair")); });
    act(() => { usePlacementStore.setState({ ghostPosition: [2, 0, 1] }); });
    await settle();
    renderer.pending("ahead", "light")[0]?.answer(15);
    await settle();
    await place("chiavari-chair", 2, 1);
    expect(renderer.pending("exact")).toHaveLength(1);
    await frames(5);
    expect(plays()).toHaveLength(1);
    expect(plays()[0]?.voice.tap).toMatchObject({ played: "variant" });
    // The exact render then arriving plays nothing more.
    await answerAll();
    await frames(3);
    expect(plays()).toHaveLength(1);
  });
});

// --- The timeline recording, with snap on (R87) -------------------------------------------------

// The planner as it runs: the bridge records every move on the editor's
// timeline, snap is on (a 1 m grid), and a drag is one history gesture with
// its grid settle inside it. A drag that ends where it began drops its step
// from the timeline, and must still be heard; an undo, a redo or a load that
// comes while a piece is coming down must never be.

describe("with the timeline recording, and snap on (R87)", () => {
  const LAYOUT_ID = "00000000-0000-4000-8000-00000000c0f1";
  const CHAIR_ID = "00000000-0000-4000-8000-000000000c01";

  // The server takes every save, the one the bridge sends as it unmounts included, giving each new piece its own id.
  beforeEach(() => {
    vi.mocked(configApi.publicBatchSave).mockImplementation((_id, batch) => Promise.resolve({
      revision: 2,
      objects: batch.map((item, index) => servedObject(item.id ?? `00000000-0000-4000-8000-0000000005${String(index).padStart(2, "0")}`, item.assetDefinitionId, item.positionX, item.positionZ)),
    }));
  });

  /** Pieces in a layout as it stands open: the editor's document and the scene's, nothing on the timeline. */
  function openLayout(items: readonly PlacedItem[]): void {
    useEditorStore.setState({
      configId: LAYOUT_ID, configRevision: 1, isPublicPreview: true, spaceId: GRAND_HALL.id, venueId: GRAND_HALL.venueId,
      objects: items.map((item) => placedItemToEditor(item, undefined)),
    });
    usePlacementStore.setState({ placedItems: [...items], snapEnabled: true });
  }

  async function mountWithBridge(): Promise<void> {
    __resetEditorBridgeMountCountForTests();
    mounted = mountInStubRoot(<><EditorBridge /><FurnitureMotion /><SetDownSound /></>);
    frame();
    frame();
    registry.frame = 0;
    await arm();
  }

  function at(id: string): PlacedItem {
    const item = usePlacementStore.getState().placedItems.find((placed) => placed.id === id);
    if (item === undefined) throw new Error(`no piece ${id}`);
    return item;
  }

  /** Moves the pieces by these steps inside the open gesture, the hand carrying them unless motion is reduced. */
  async function carryBy(ids: readonly string[], steps: readonly (readonly [number, number])[]): Promise<void> {
    const moving = new Set(ids);
    for (const [dx, dz] of steps) {
      act(() => {
        usePlacementStore.getState().moveItemsByDelta(moving, dx, dz);
        if (!reduced) carryFurniture(moving, dx * 8, dz * 8);
      });
      await frames(1);
    }
  }

  /**
   * A mouse drag as SelectionSystem makes one: a history gesture opened at the
   * press, the moves, then settleDrop (the snapped position written at once,
   * the spring taking the offset, the pieces let go) and the gesture closed.
   * The steps are exact binary fractions, so a snap back lands exactly where
   * the piece began.
   */
  async function drag(ids: readonly string[], steps: readonly (readonly [number, number])[]): Promise<void> {
    const moving = new Set(ids);
    const token = useEditorStore.getState().beginHistoryGesture();
    await carryBy(ids, steps);
    act(() => {
      const placement = usePlacementStore.getState();
      const primary = at(ids[0] ?? "");
      const [x, , z] = snapPositionToGrid(primary.x, primary.z);
      if (placement.snapEnabled && (x !== primary.x || z !== primary.z)) {
        placement.moveItemsByDelta(moving, x - primary.x, z - primary.z);
        for (const id of ids) beginFurnitureSettle(id, primary.x - x, primary.z - z);
      }
      if (reduced) announceFurnitureLandedInPlace(moving, "let-go", 0.6);
      else releaseFurniture(moving);
      if (token !== null) useEditorStore.getState().endHistoryGesture(token);
    });
    await settle();
  }

  /** A touch lift the browser cancels, as returnLiftedPiece handles it: back where it was, and set down there. */
  async function cancelledLift(ids: readonly string[], steps: readonly (readonly [number, number])[]): Promise<void> {
    const moving = new Set(ids);
    const origin = at(ids[0] ?? "");
    const token = useEditorStore.getState().beginHistoryGesture();
    await carryBy(ids, steps);
    act(() => {
      const primary = at(ids[0] ?? "");
      usePlacementStore.getState().moveItemsByDelta(moving, origin.x - primary.x, origin.z - primary.z);
      if (reduced) announceFurnitureLandedInPlace(moving, "let-go", 0.6);
      else releaseFurniture(moving);
      if (token !== null) useEditorStore.getState().endHistoryGesture(token);
    });
    await settle();
  }

  it("voices a chair dragged about 0.3 m, whose snap takes it back where it began", async () => {
    const chair = createPlacedItem(catalogueId("chiavari-chair"), 2, 1);
    openLayout([chair]);
    await mountWithBridge();
    await drag([chair.id], [[0.125, 0], [0.125, 0], [0.0625, 0]]);
    expect(at(chair.id)).toMatchObject({ x: 2, z: 1 });
    // The gesture's step was dropped from the timeline: the case that once read as an undo.
    expect(useEditorStore.getState().history.past).toEqual([]);
    await answerAll();
    await frames(10);
    expect(plays()).toHaveLength(1);
    expect(plays()[0]?.voice.tap).toMatchObject({ slug: "chiavari-chair", played: "exact" });
    expect(registry.drops).toEqual([]);
  });

  it.each([false, true])("voices a touch lift the browser cancelled, back where it began (reduced motion: %s, R85)", async (reducedMotion) => {
    reduced = reducedMotion;
    const chair = createPlacedItem(catalogueId("chiavari-chair"), 2, 1);
    openLayout([chair]);
    await mountWithBridge();
    await cancelledLift([chair.id], [[0.25, 0.125], [0.25, 0.125], [0.25, 0.25]]);
    expect(at(chair.id)).toMatchObject({ x: 2, z: 1 });
    expect(useEditorStore.getState().history.past).toEqual([]);
    await answerAll();
    await frames(10);
    expect(plays()).toHaveLength(1);
    expect(registry.drops).toEqual([]);
  });

  it("keeps silent a chair an undo takes back while it comes down", async () => {
    const chair = createPlacedItem(catalogueId("chiavari-chair"), 2, 1);
    openLayout([chair]);
    await mountWithBridge();
    await drag([chair.id], [[0.5, 0], [0.75, 0], [0.75, 0]]);
    expect(at(chair.id)).toMatchObject({ x: 4, z: 1 });
    expect(useEditorStore.getState().history.past).toHaveLength(1);
    act(() => { useEditorStore.getState().undo(); });
    expect(at(chair.id)).toMatchObject({ x: 2, z: 1 });
    await answerAll();
    await frames(10);
    expect(plays()).toEqual([]);
    expect(registry.drops.map((drop) => drop.drop)).toEqual(["undone"]);
  });

  it("keeps silent a chair in hand when an undo came, as the resting hand sets it down", async () => {
    const chair = createPlacedItem(catalogueId("chiavari-chair"), 2, 1);
    openLayout([chair]);
    await mountWithBridge();
    useEditorStore.getState().beginHistoryGesture();
    await carryBy([chair.id], [[0.5, 0], [0.5, 0]]);
    // The undo takes back the drag's own moves; the hand rests, and sets the chair down 0.4 s on.
    act(() => { useEditorStore.getState().undo(); });
    expect(at(chair.id)).toMatchObject({ x: 2, z: 1 });
    await frames(40);
    await answerAll();
    await frames(10);
    expect(plays()).toEqual([]);
    expect(registry.drops.map((drop) => drop.drop)).toEqual(["undone"]);
  });

  it("keeps silent a piece coming down when a redo comes", async () => {
    const moved = createPlacedItem(catalogueId("chiavari-chair"), 2, 1);
    const dropped = createPlacedItem(catalogueId("chiavari-chair"), -2, -1);
    openLayout([moved, dropped]);
    await mountWithBridge();
    await drag([moved.id], [[0.5, 0], [0.75, 0], [0.75, 0]]);
    await answerAll();
    await frames(10);
    expect(plays()).toHaveLength(1);
    act(() => { useEditorStore.getState().undo(); });
    await frames(5);
    // A drop-in records nothing, so the redo is still there to come while it falls.
    act(() => { dropInFurniture(dropped.id); });
    await settle();
    act(() => { useEditorStore.getState().redo(); });
    expect(at(moved.id)).toMatchObject({ x: 4, z: 1 });
    await answerAll();
    await frames(10);
    expect(plays()).toHaveLength(1);
    expect(registry.drops.map((drop) => drop.drop)).toEqual(["undone"]);
  });

  it("keeps silent a piece coming down when a load comes, though nothing was on the timeline", async () => {
    const chair = createPlacedItem(catalogueId("chiavari-chair"), 2, 1, 0, null, 0, CHAIR_ID);
    openLayout([chair]);
    await mountWithBridge();
    act(() => { dropInFurniture(chair.id); });
    await settle();
    expect(renderer.pending("exact")).toHaveLength(1);
    vi.mocked(configApi.getPublicConfig).mockResolvedValue(servedLayout([servedObject(CHAIR_ID, chair.catalogueItemId, 2, 1)]));
    await act(async () => { await useEditorStore.getState().loadConfiguration(LAYOUT_ID, false); });
    expect(at(CHAIR_ID)).toMatchObject({ x: 2, z: 1 });
    await answerAll();
    await frames(10);
    expect(plays()).toEqual([]);
    expect(registry.drops.map((drop) => drop.drop)).toEqual(["undone"]);
  });

  /** A piece as the server sends it. */
  function servedObject(id: string, catalogueItemId: string, x: number, z: number): PlacedObject {
    return {
      id, configurationId: LAYOUT_ID, assetDefinitionId: catalogueItemId, positionX: x.toFixed(3), positionY: "0.000", positionZ: z.toFixed(3),
      rotationX: "0.00000", rotationY: "0.00000", rotationZ: "0.00000", scale: "1.000", sortOrder: 0, metadata: null,
    };
  }

  /** The layout as the server sends it, in the room the planner shows. */
  function servedLayout(objects: readonly PlacedObject[]): ConfigurationsModule.Configuration {
    return {
      id: LAYOUT_ID, spaceId: GRAND_HALL.id, venueId: GRAND_HALL.venueId, userId: null, name: "Burns supper",
      isPublicPreview: true, revision: 2, objects: [...objects], updatedAt: "2026-11-22T10:00:00.000Z",
    };
  }

  // What never sounds, with the bridge recording and snap on (M-8).

  it("posts and plays nothing for a load through the bridge", async () => {
    openLayout([createPlacedItem(catalogueId("chiavari-chair"), 2, 1)]);
    await mountWithBridge();
    const round = "00000000-0000-4000-8000-000000000c02";
    vi.mocked(configApi.getPublicConfig).mockResolvedValue(servedLayout([
      servedObject(CHAIR_ID, catalogueId("chiavari-chair"), 3, 2),
      servedObject(round, catalogueId("round-table-6ft"), -3, -2),
    ]));
    await act(async () => { await useEditorStore.getState().loadConfiguration(LAYOUT_ID, false); });
    expect(usePlacementStore.getState().placedItems.map((item) => item.id).sort()).toEqual([CHAIR_ID, round].sort());
    await settle();
    await frames(30);
    expect(renderer.renders()).toEqual([]);
    expect(plays()).toEqual([]);
  });

  it("posts and plays nothing for an undo or a redo through the bridge", async () => {
    openLayout([]);
    await mountWithBridge();
    await place("chiavari-chair", 2, 1);
    await answerAll();
    await frames(10);
    expect(plays()).toHaveLength(1);
    expect(useEditorStore.getState().history.past).toHaveLength(1);
    const renders = renderer.renders().length;
    act(() => { useEditorStore.getState().undo(); });
    await settle();
    await frames(10);
    expect(usePlacementStore.getState().placedItems).toEqual([]);
    act(() => { useEditorStore.getState().redo(); });
    await settle();
    await frames(30);
    expect(usePlacementStore.getState().placedItems).toHaveLength(1);
    expect(renderer.renders()).toHaveLength(renders);
    expect(plays()).toHaveLength(1);
  });

  it("posts and plays nothing for an autosave that gives a placed piece the server's id", async () => {
    openLayout([]);
    await mountWithBridge();
    const chair = await place("chiavari-chair", 2, 1);
    await answerAll();
    await frames(10);
    expect(plays()).toHaveLength(1);
    const renders = renderer.renders().length;
    // The bridge's autosave waits 3 s after the last change.
    pass(3_500);
    await settle();
    await frames(30);
    expect(configApi.publicBatchSave).toHaveBeenCalled();
    expect(usePlacementStore.getState().placedItems.map((item) => item.id)).not.toContain(chair.id);
    expect(usePlacementStore.getState().placedItems).toHaveLength(1);
    expect(renderer.renders()).toHaveLength(renders);
    expect(plays()).toHaveLength(1);
  });

  it("plays nothing for the placement ghost, which it renders ahead", async () => {
    localStorage.setItem(RENDER_MODE_STORAGE_KEY, JSON.stringify({ light: "ahead", table: "exact" }));
    openLayout([]);
    await mountWithBridge();
    act(() => { useCatalogueStore.getState().selectItem(catalogueId("chiavari-chair")); });
    for (let i = 0; i < 6; i++) {
      pass(300);
      act(() => { usePlacementStore.setState({ ghostPosition: [-4 + i * 1.5, 0, -2] }); });
      await settle();
      await answerAll();
    }
    await frames(30);
    act(() => { usePlacementStore.setState({ ghostPosition: null }); });
    await settle();
    await frames(10);
    expect(renderer.renders("ahead").length).toBeGreaterThan(0);
    expect(renderer.renders("exact")).toEqual([]);
    expect(plays()).toEqual([]);
  });
});

