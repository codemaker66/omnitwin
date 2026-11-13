import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEASUREMENT_DECLINED_KEY,
  measurementChoiceState,
  measurementDeclined,
  setMeasurementDeclined,
  subscribeMeasurementChoice,
} from "../measurement-choice.js";

// ---------------------------------------------------------------------------
// "Don't measure my visits" (T-685): the privacy page's way to object to the
// page-speed measurements, kept in this browser; for this visit where the
// browser will not keep it; and never measuring where storage is refused.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
  setMeasurementDeclined(false);
  window.localStorage.clear();
});

const refuse = (): never => { throw new Error("blocked"); };

/** Puts a stand-in for this browser's storage in place for one test, and the
 *  real one back after (as planner-features.test.ts does): a spy on happy-dom's
 *  localStorage is not restored by vi.restoreAllMocks, and leaks into later tests. */
function withStorage(stand: Pick<Storage, "getItem" | "setItem" | "removeItem">, run: () => void): void {
  const real = window.localStorage;
  Object.defineProperty(window, "localStorage", { configurable: true, value: stand });
  try {
    run();
  } finally {
    Object.defineProperty(window, "localStorage", { configurable: true, value: real });
  }
}

describe("the measurement choice", () => {
  it("measures by default, until the visitor says not to", () => {
    expect(measurementDeclined()).toBe(false);
  });

  it("keeps the choice in this browser, says it did, and forgets it when undone", () => {
    expect(setMeasurementDeclined(true)).toBe(true);
    expect(window.localStorage.getItem(MEASUREMENT_DECLINED_KEY)).toBe("1");
    expect(measurementDeclined()).toBe(true);
    expect(setMeasurementDeclined(false)).toBe(true);
    expect(window.localStorage.getItem(MEASUREMENT_DECLINED_KEY)).toBeNull();
    expect(measurementDeclined()).toBe(false);
  });

  it("honours a choice stored on an earlier visit", () => {
    window.localStorage.setItem(MEASUREMENT_DECLINED_KEY, "1");
    expect(measurementDeclined()).toBe(true);
  });

  it("never measures a browser that will not let the site read its storage at all", () => {
    withStorage({ getItem: refuse, setItem: refuse, removeItem: refuse }, () => {
      expect(measurementDeclined()).toBe(true);
    });
  });

  // #355's review (13 November 2026): pressing the switch there must not
  // claim the choice lasts only for this visit. The visitor stays declined,
  // on this visit and every later one, whatever they press.
  it("keeps a browser that refuses its storage declined, and says that holds, whatever is pressed", () => {
    withStorage({ getItem: refuse, setItem: refuse, removeItem: refuse }, () => {
      expect(setMeasurementDeclined(false)).toBe(true);
      expect(measurementDeclined()).toBe(true);
      expect(setMeasurementDeclined(true)).toBe(true);
      expect(measurementDeclined()).toBe(true);
    });
  });

  it("says when the browser would not keep the choice (storage full): it holds for this visit only", () => {
    const kept = new Map<string, string>();
    withStorage({
      getItem: (key) => kept.get(key) ?? null,
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: (key) => { kept.delete(key); },
    }, () => {
      expect(setMeasurementDeclined(true)).toBe(false);
      expect(measurementDeclined()).toBe(true);
      // Nothing was kept, so the next visit is measured unless the visitor says again.
      expect(kept.size).toBe(0);
    });
  });

  // #355's code review (13 November 2026): the switch reads what holds from
  // the choice itself, so a return to the page cannot reset it.
  it("tells the switch what holds: measured, declined and kept, declined for this visit only, or never measured", () => {
    expect(measurementChoiceState()).toBe("measured");
    setMeasurementDeclined(true);
    expect(measurementChoiceState()).toBe("declined");
    setMeasurementDeclined(false);
    expect(measurementChoiceState()).toBe("measured");
    // Kept from an earlier visit.
    window.localStorage.setItem(MEASUREMENT_DECLINED_KEY, "1");
    expect(measurementChoiceState()).toBe("declined");
    window.localStorage.removeItem(MEASUREMENT_DECLINED_KEY);
    // Storage full: in memory only, and undone in memory.
    const kept = new Map<string, string>();
    withStorage({
      getItem: (key) => kept.get(key) ?? null,
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: (key) => { kept.delete(key); },
    }, () => {
      setMeasurementDeclined(true);
      expect(measurementChoiceState()).toBe("declined-this-visit");
      setMeasurementDeclined(false);
      expect(measurementChoiceState()).toBe("measured");
    });
    // A choice not to decline that the browser would not keep leaves the kept one in force.
    withStorage({ getItem: () => "1", setItem: () => undefined, removeItem: refuse }, () => {
      expect(setMeasurementDeclined(false)).toBe(true);
      expect(measurementChoiceState()).toBe("declined");
      expect(measurementDeclined()).toBe(true);
    });
    // Storage refused: never measured, whatever is pressed.
    withStorage({ getItem: refuse, setItem: refuse, removeItem: refuse }, () => {
      expect(measurementChoiceState()).toBe("storage-refused");
      setMeasurementDeclined(false);
      expect(measurementChoiceState()).toBe("storage-refused");
    });
  });

  // #355's code review: a switch on the page shows a press made in another tab,
  // and the latest press in this browser is the one that holds.
  it("tells whoever shows the choice of a press here or in another tab, and stops when asked", () => {
    const seen: string[] = [];
    const stop = subscribeMeasurementChoice(() => { seen.push(measurementChoiceState()); });
    try {
      setMeasurementDeclined(true);
      expect(seen).toEqual(["declined"]);
      // Another tab undoes it: this tab follows, its own press in memory included.
      window.localStorage.removeItem(MEASUREMENT_DECLINED_KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: MEASUREMENT_DECLINED_KEY, oldValue: "1", newValue: null }));
      expect(seen).toEqual(["declined", "measured"]);
      expect(measurementDeclined()).toBe(false);
      // Another tab declines.
      window.localStorage.setItem(MEASUREMENT_DECLINED_KEY, "1");
      window.dispatchEvent(new StorageEvent("storage", { key: MEASUREMENT_DECLINED_KEY, oldValue: null, newValue: "1" }));
      expect(seen.at(-1)).toBe("declined");
      // Another key is nothing to tell.
      window.dispatchEvent(new StorageEvent("storage", { key: "venviewer.something-else", newValue: "x" }));
      expect(seen).toHaveLength(3);
      // Something clears all the site's storage: told, and this tab's own
      // press in memory still holds (it can only measure less).
      setMeasurementDeclined(true);
      window.localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
      expect(seen.at(-1)).toBe("declined-this-visit");
      expect(measurementDeclined()).toBe(true);
    } finally {
      stop();
    }
    const told = seen.length;
    setMeasurementDeclined(false);
    window.dispatchEvent(new StorageEvent("storage", { key: MEASUREMENT_DECLINED_KEY, newValue: "1" }));
    expect(seen).toHaveLength(told);
  });
});
