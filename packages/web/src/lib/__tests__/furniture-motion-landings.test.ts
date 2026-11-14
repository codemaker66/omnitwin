import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DROP_HEIGHT,
  activeFurnitureSettleCount,
  announceFurnitureLandedInPlace,
  carryFurniture,
  clearAllFurnitureSettles,
  dropInFurniture,
  furnitureLandingListenerCount,
  furnitureMotionPose,
  releaseFurniture,
  setFurnitureMassResolver,
  stepFurnitureSettles,
  subscribeFurnitureLandings,
  type FurnitureLandingListener,
} from "../furniture-motion.js";

// ---------------------------------------------------------------------------
// The landing seam (T-700, rulings R25 and R75-R84): how a piece starts down,
// the frame it reaches its support and how it came down, for the set-down
// sound. The contact frames are master's spring stepped at 60 frames a
// second: a drop-in lands on frame 5 (83.3 ms) at 0.654 m/s, a carried light
// piece on frame 4 (66.7 ms) at 0.558 m/s, a carried heavy one on frame 3
// (50.0 ms) at 0.434 m/s.
// ---------------------------------------------------------------------------

type Callback = keyof FurnitureLandingListener;
type Primitive = string | number | boolean;

interface Heard {
  /** Frames stepped when the call was made; 0 before the first. */
  readonly frame: number;
  readonly callback: Callback;
  readonly args: readonly Primitive[];
}

let frame = 0;
let heard: Heard[] = [];
let unsubscribe: () => void = () => undefined;

const recorder: FurnitureLandingListener = {
  pickedUp: (...args) => { heard.push({ frame, callback: "pickedUp", args }); },
  dropStarted: (...args) => { heard.push({ frame, callback: "dropStarted", args }); },
  touchedDown: (...args) => { heard.push({ frame, callback: "touchedDown", args }); },
  landedInPlace: (...args) => { heard.push({ frame, callback: "landedInPlace", args }); },
};

/** One display frame at 60 a second. */
function step(): void {
  frame += 1;
  stepFurnitureSettles(1 / 60);
}

function steps(count: number): void {
  for (let i = 0; i < count; i++) step();
}

function calls(callback: Callback): Heard[] {
  return heard.filter((entry) => entry.callback === callback);
}

function only(callback: Callback): Heard {
  const found = calls(callback);
  expect(found).toHaveLength(1);
  const [entry] = found;
  if (entry === undefined) throw new Error(`No ${callback}`);
  return entry;
}

/** The number at `index` in a call's arguments. */
function numberAt(entry: Heard, index: number): number {
  const value = entry.args[index];
  if (typeof value !== "number") throw new Error(`Argument ${String(index)} of ${entry.callback} is not a number`);
  return value;
}

function expectNear(value: number, target: number, tolerance: number): void {
  expect(Math.abs(value - target)).toBeLessThanOrEqual(tolerance);
}

/** Carries `id` at `speed` m/s along x for `count` frames, the hand moving every frame. */
function carryFor(id: string, speed: number, count: number): void {
  for (let i = 0; i < count; i++) {
    carryFurniture([id], speed, 0);
    step();
  }
}

beforeEach(() => {
  clearAllFurnitureSettles();
  frame = 0;
  heard = [];
  unsubscribe = subscribeFurnitureLandings(recorder);
});

afterEach(() => {
  unsubscribe();
  clearAllFurnitureSettles();
  vi.unstubAllGlobals();
  // The seam hands its listeners primitives only: no object or array is made for them.
  for (const entry of heard) {
    for (const arg of entry.args) expect(["string", "number", "boolean"]).toContain(typeof arg);
  }
});

describe("a drop-in", () => {
  it("starts down at once and touches down once, on frame 5 (83.3 ms) at 0.654 m/s, where its lift first reads 0", () => {
    dropInFurniture("a");
    expect(heard).toEqual([{ frame: 0, callback: "dropStarted", args: ["a", "drop-in", 0, 0] }]);
    let firstOnFloor = -1;
    for (let i = 0; i < 40; i++) {
      step();
      if (firstOnFloor < 0 && furnitureMotionPose("a")?.lift === 0) firstOnFloor = frame;
    }
    const touchdown = only("touchedDown");
    expect(touchdown.frame).toBe(5);
    expect(firstOnFloor).toBe(5);
    expect((touchdown.frame / 60) * 1000).toBeCloseTo(83.3, 1);
    expect(touchdown.args.slice(0, 2)).toEqual(["a", "drop-in"]);
    expectNear(numberAt(touchdown, 2), 0.654, 0.01);
    expect(numberAt(touchdown, 3)).toBe(0);
    expect(calls("pickedUp")).toEqual([]);
    expect(calls("landedInPlace")).toEqual([]);
  });

  it("waits its turn: drop-ins 0 s and 0.1 s apart touch down 7 frames apart", () => {
    dropInFurniture("first", DROP_HEIGHT, 0);
    dropInFurniture("second", DROP_HEIGHT, 0.1);
    expect(calls("dropStarted").map((entry) => entry.args)).toEqual([
      ["first", "drop-in", 0, 0],
      ["second", "drop-in", 0, 0.1],
    ]);
    steps(40);
    const touchdowns = calls("touchedDown");
    expect(touchdowns.map((entry) => entry.args[0])).toEqual(["first", "second"]);
    const [first, second] = touchdowns;
    if (first === undefined || second === undefined) throw new Error("Missing touchdowns");
    // 0.1 s is six frames, but six subtractions of 1/60 leave 2e-17 s of the
    // wait, so the motion waits a seventh frame before it starts down.
    expect(second.frame - first.frame).toBe(7);
    expectNear(numberAt(second, 2), 0.654, 0.01);
  });
});

describe("a carried piece let go", () => {
  it("is picked up once, starts down at the hand's speed and touches down on frame 4 (66.7 ms) at 0.558 m/s", () => {
    carryFor("a", 1.2, 20);
    expect(heard).toEqual([{ frame: 0, callback: "pickedUp", args: ["a", false] }]);
    const releasedAt = frame;
    releaseFurniture(["a"]);
    const drop = only("dropStarted");
    expect(drop.frame).toBe(releasedAt);
    expect(drop.args.slice(0, 2)).toEqual(["a", "let-go"]);
    expect(numberAt(drop, 2)).toBeCloseTo(1.2, 12);
    expect(numberAt(drop, 3)).toBe(0);
    steps(40);
    const touchdown = only("touchedDown");
    expect(touchdown.frame - releasedAt).toBe(4);
    expect(touchdown.args.slice(0, 2)).toEqual(["a", "let-go"]);
    expectNear(numberAt(touchdown, 2), 0.558, 0.01);
    expect(numberAt(touchdown, 3)).toBeCloseTo(1.2, 12);
    expect(calls("pickedUp")).toHaveLength(1);
  });

  it("tells a heavy piece apart and lands it sooner, on frame 3 (50.0 ms) at 0.434 m/s", () => {
    const uninstall = setFurnitureMassResolver(() => "heavy");
    try {
      carryFor("stage", 1.2, 20);
      expect(heard).toEqual([{ frame: 0, callback: "pickedUp", args: ["stage", true] }]);
      const releasedAt = frame;
      releaseFurniture(["stage"]);
      expect(only("dropStarted").args.slice(0, 2)).toEqual(["stage", "let-go"]);
      steps(40);
      const touchdown = only("touchedDown");
      expect(touchdown.frame - releasedAt).toBe(3);
      expectNear(numberAt(touchdown, 2), 0.434, 0.01);
      expect(numberAt(touchdown, 3)).toBeCloseTo(1.2, 12);
    } finally {
      uninstall();
    }
  });

  it("sets a piece down when the hand rests past HOLD_STILL, and a later let-go plays neither", () => {
    carryFor("a", 1, 12);
    // The hand rests: 0.4 s later it sets the piece down where it is.
    steps(30);
    const drop = only("dropStarted");
    expect(drop.args.slice(0, 2)).toEqual(["a", "set-down"]);
    const handSpeed = numberAt(drop, 2);
    expect(handSpeed).toBeGreaterThanOrEqual(0);
    expect(handSpeed).toBeLessThan(0.05);
    expect(numberAt(drop, 3)).toBe(0);
    const touchdown = only("touchedDown");
    expect(touchdown.frame).toBeGreaterThan(drop.frame);
    expect(touchdown.args.slice(0, 2)).toEqual(["a", "set-down"]);
    expect(numberAt(touchdown, 2)).toBeGreaterThan(0);
    expect(numberAt(touchdown, 3)).toBe(handSpeed);

    releaseFurniture(["a"]);
    steps(60);
    expect(calls("dropStarted")).toHaveLength(1);
    expect(calls("touchedDown")).toHaveLength(1);
  });

  it("goes back into the hand when caught on its way down, and lands only once let go", () => {
    dropInFurniture("a");
    steps(2);
    expect(furnitureMotionPose("a")?.lift).toBeGreaterThan(0);
    carryFor("a", 0.5, 20);
    expect(only("pickedUp").args).toEqual(["a", false]);
    expect(calls("touchedDown")).toEqual([]);
    releaseFurniture(["a"]);
    steps(40);
    const dropLandings = calls("dropStarted").map((entry) => entry.args[1]);
    expect(dropLandings).toEqual(["drop-in", "let-go"]);
    expect(only("touchedDown").args.slice(0, 2)).toEqual(["a", "let-go"]);
  });
});

describe("what never lands", () => {
  it("reports no touchdown for a motion cleared before contact", () => {
    carryFor("b", 1.2, 20);
    dropInFurniture("a");
    releaseFurniture(["b"]);
    // Both are on their way down: the drop-in lands on its frame 5, the let-go on its frame 4.
    steps(2);
    clearAllFurnitureSettles();
    steps(40);
    expect(calls("dropStarted")).toHaveLength(2);
    expect(calls("touchedDown")).toEqual([]);
  });

  it("announces pieces landed in place, under reduced motion, and nothing else", () => {
    announceFurnitureLandedInPlace(["a", "b"], "let-go", 0.8);
    expect(heard).toEqual([
      { frame: 0, callback: "landedInPlace", args: ["a", "let-go", 0.8] },
      { frame: 0, callback: "landedInPlace", args: ["b", "let-go", 0.8] },
    ]);
    expect(activeFurnitureSettleCount()).toBe(0);
    steps(10);
    expect(heard).toHaveLength(2);
  });
});

describe("the listeners", () => {
  it("returns the listener count to what it was on unsubscribe, and the listener hears no more", () => {
    const before = furnitureLandingListenerCount();
    let touchdowns = 0;
    const counting: FurnitureLandingListener = {
      pickedUp: () => undefined,
      dropStarted: () => undefined,
      touchedDown: () => { touchdowns += 1; },
      landedInPlace: () => undefined,
    };
    const stop = subscribeFurnitureLandings(counting);
    expect(furnitureLandingListenerCount()).toBe(before + 1);
    dropInFurniture("a");
    steps(10);
    expect(touchdowns).toBe(1);
    stop();
    stop();
    expect(furnitureLandingListenerCount()).toBe(before);
    dropInFurniture("b");
    steps(10);
    expect(touchdowns).toBe(1);
    // The recorder subscribed before it still hears both.
    expect(calls("touchedDown")).toHaveLength(2);
  });

  it("still tells every listener of a touchdown when one unsubscribes as it hears it", () => {
    const order: string[] = [];
    const stopFirst = subscribeFurnitureLandings({
      pickedUp: () => undefined,
      dropStarted: () => undefined,
      touchedDown: () => { order.push("first"); stopFirst(); },
      landedInPlace: () => undefined,
    });
    const stopSecond = subscribeFurnitureLandings({
      pickedUp: () => undefined,
      dropStarted: () => undefined,
      touchedDown: () => { order.push("second"); },
      landedInPlace: () => undefined,
    });
    try {
      dropInFurniture("a");
      steps(10);
      expect(order).toEqual(["first", "second"]);
      expect(calls("touchedDown")).toHaveLength(1);
    } finally {
      stopSecond();
    }
  });
});

describe("a listener that throws (R86)", () => {
  const failure = new Error("a listener's fault");
  const thrower: FurnitureLandingListener = {
    pickedUp: () => { throw failure; },
    dropStarted: () => { throw failure; },
    touchedDown: () => { throw failure; },
    landedInPlace: () => { throw failure; },
  };

  /** The thrower first, then the recorder, so the recorder hears only what got past it. */
  function throwerFirst(): () => void {
    unsubscribe();
    const stopThrowing = subscribeFurnitureLandings(thrower);
    unsubscribe = subscribeFurnitureLandings(recorder);
    return stopThrowing;
  }

  it("is reported, not thrown, and the next listener hears each touchdown as the step goes on", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const stopThrowing = throwerFirst();
    try {
      dropInFurniture("a");
      dropInFurniture("b");
      expect(() => { steps(10); }).not.toThrow();
      expect(calls("touchedDown").map((entry) => entry.args.slice(0, 2))).toEqual([["a", "drop-in"], ["b", "drop-in"]]);
      // Two starts and two touchdowns, each reported once.
      expect(reportError).toHaveBeenCalledTimes(4);
      for (const [error] of reportError.mock.calls) expect(error).toBe(failure);
      steps(60);
      expect(activeFurnitureSettleCount()).toBe(0);
    } finally {
      stopThrowing();
    }
  });

  it("lets a carry and a release finish for every piece", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const stopThrowing = throwerFirst();
    try {
      carryFurniture(["a", "b", "c"], 1, 0);
      expect(calls("pickedUp").map((entry) => entry.args[0])).toEqual(["a", "b", "c"]);
      steps(6);
      for (const id of ["a", "b", "c"]) expect(furnitureMotionPose(id)?.lift).toBeGreaterThan(0);
      releaseFurniture(["a", "b", "c"]);
      expect(calls("dropStarted").map((entry) => entry.args.slice(0, 2))).toEqual([["a", "let-go"], ["b", "let-go"], ["c", "let-go"]]);
      steps(60);
      expect(calls("touchedDown").map((entry) => entry.args[0])).toEqual(["a", "b", "c"]);
      expect(activeFurnitureSettleCount()).toBe(0);
      expect(reportError).toHaveBeenCalledTimes(9);
    } finally {
      stopThrowing();
    }
  });

  it("lets an in-place announcement reach every piece and every listener", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const stopThrowing = throwerFirst();
    try {
      announceFurnitureLandedInPlace(["a", "b"], "set-down", 0);
      expect(calls("landedInPlace").map((entry) => entry.args)).toEqual([["a", "set-down", 0], ["b", "set-down", 0]]);
      expect(reportError).toHaveBeenCalledTimes(2);
    } finally {
      stopThrowing();
    }
  });

  it("throws the error again on a microtask where the page has no reportError", () => {
    const queued: (() => void)[] = [];
    vi.stubGlobal("reportError", undefined);
    vi.stubGlobal("queueMicrotask", (task: () => void) => { queued.push(task); });
    const stopThrowing = throwerFirst();
    try {
      dropInFurniture("a");
    } finally {
      vi.unstubAllGlobals();
      stopThrowing();
    }
    // The drop still started, and the recorder after the thrower heard it.
    expect(only("dropStarted").args).toEqual(["a", "drop-in", 0, 0]);
    expect(queued).toHaveLength(1);
    const [rethrow] = queued;
    expect(() => { rethrow?.(); }).toThrow(failure);
  });
});

describe("the seam's cost", () => {
  // A guard on the whole step's time, springs and all. It cannot see an
  // allocation: that the seam makes no object or array per frame is review's
  // to check (the plan's perf guard), and the primitive-arguments check above.
  it("steps 180 dropping pieces with one counting listener in a median under 0.5 ms a frame", () => {
    unsubscribe();
    unsubscribe = () => undefined;
    let touchdowns = 0;
    const stop = subscribeFurnitureLandings({
      pickedUp: () => undefined,
      dropStarted: () => undefined,
      touchedDown: () => { touchdowns += 1; },
      landedInPlace: () => undefined,
    });
    /** 180 drop-ins, a Lay out's worth, landing over about a third of a second; each frame's step time, ms. */
    const layOut = (): number[] => {
      clearAllFurnitureSettles();
      for (let i = 0; i < 180; i++) dropInFurniture(`piece-${String(i)}`, DROP_HEIGHT, (i % 20) * 0.012);
      const times: number[] = [];
      for (let i = 0; i < 30; i++) {
        const started = performance.now();
        stepFurnitureSettles(1 / 60);
        times.push(performance.now() - started);
      }
      return times;
    };
    try {
      layOut(); // warm the step up
      touchdowns = 0;
      const times = layOut().sort((a, b) => a - b);
      // All 180 touch down inside the 30 frames, so the seam's path is what is timed.
      expect(touchdowns).toBe(180);
      const median = ((times[14] ?? Number.NaN) + (times[15] ?? Number.NaN)) / 2;
      console.info(`furniture landing seam: median step ${median.toFixed(4)} ms over 30 frames, 180 pieces`);
      expect(median).toBeLessThan(0.5);
    } finally {
      stop();
    }
  });
});
