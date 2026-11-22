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
// page-speed measurements. Kept in this browser; where the browser will not
// keep it, kept for this tab (session storage), else for this page load; and
// never measuring where the browser refuses the site its storage.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
  setMeasurementDeclined(false);
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const refuse = (): never => { throw new Error("blocked"); };

type StandIn = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A storage that reads but will not write (full), over the given map. */
const fullStorage = (kept: Map<string, string>): StandIn => ({
  getItem: (key) => kept.get(key) ?? null,
  setItem: () => { throw new Error("QuotaExceededError"); },
  removeItem: (key) => { kept.delete(key); },
});

/** Puts stand-ins for this browser's storages in place for one test, and the
 *  real ones back after (as planner-features.test.ts does): a spy on
 *  happy-dom's storage is not restored by vi.restoreAllMocks, and leaks into
 *  later tests. */
function withStorage(stands: { readonly local?: StandIn; readonly session?: StandIn }, run: () => void): void {
  const realLocal = window.localStorage;
  const realSession = window.sessionStorage;
  if (stands.local !== undefined) Object.defineProperty(window, "localStorage", { configurable: true, value: stands.local });
  if (stands.session !== undefined) Object.defineProperty(window, "sessionStorage", { configurable: true, value: stands.session });
  try {
    run();
  } finally {
    Object.defineProperty(window, "localStorage", { configurable: true, value: realLocal });
    Object.defineProperty(window, "sessionStorage", { configurable: true, value: realSession });
  }
}

/** Another tab of this browser changing the stored choice (or, with a null
 *  key, clearing all of the site's storage). */
function otherTab(key: string | null, newValue: string | null): void {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
}

describe("the measurement choice", () => {
  it("measures by default, until the visitor says not to", () => {
    expect(measurementDeclined()).toBe(false);
    expect(measurementChoiceState()).toBe("measured");
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
    expect(measurementChoiceState()).toBe("declined");
  });

  it("never measures a browser that will not let the site read its storage at all", () => {
    withStorage({ local: { getItem: refuse, setItem: refuse, removeItem: refuse } }, () => {
      expect(measurementDeclined()).toBe(true);
      expect(measurementChoiceState()).toBe("storage-refused");
    });
  });

  // #355's review (13 November 2026): pressing the switch there must not
  // claim the choice lasts only for this visit. The visitor stays declined,
  // on this visit and every later one, whatever they press.
  it("keeps a browser that refuses its storage declined, and says that holds, whatever is pressed", () => {
    withStorage({ local: { getItem: refuse, setItem: refuse, removeItem: refuse } }, () => {
      expect(setMeasurementDeclined(false)).toBe(true);
      expect(measurementDeclined()).toBe(true);
      expect(setMeasurementDeclined(true)).toBe(true);
      expect(measurementDeclined()).toBe(true);
      expect(measurementChoiceState()).toBe("storage-refused");
    });
  });

  // Blake, 13 November 2026 ("Keep it for the tab"): a press the browser will
  // not keep (storage full) is kept for the tab, in its session storage.
  it("keeps a press the browser would not keep for this tab, and says it is not kept for later visits", () => {
    const kept = new Map<string, string>();
    withStorage({ local: fullStorage(kept) }, () => {
      expect(setMeasurementDeclined(true)).toBe(false);
      expect(measurementDeclined()).toBe(true);
      expect(measurementChoiceState()).toBe("declined-this-tab");
      expect(kept.size).toBe(0);
      expect(window.sessionStorage.getItem(MEASUREMENT_DECLINED_KEY)).toBe("1");
      setMeasurementDeclined(false);
      expect(measurementChoiceState()).toBe("measured");
      expect(window.sessionStorage.getItem(MEASUREMENT_DECLINED_KEY)).toBeNull();
    });
  });

  // #355's verification (13 November): the privacy page's own links load a
  // fresh page; a press held only in memory was lost there and the next page
  // measured. A fresh load of the module stands for that page.
  it("still holds a press kept for the tab on the next page the tab loads", async () => {
    const kept = new Map<string, string>();
    const realLocal = window.localStorage;
    Object.defineProperty(window, "localStorage", { configurable: true, value: fullStorage(kept) });
    try {
      setMeasurementDeclined(true);
      vi.resetModules();
      const nextPage = await import("../measurement-choice.js");
      expect(nextPage.measurementDeclined()).toBe(true);
      expect(nextPage.measurementChoiceState()).toBe("declined-this-tab");
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: realLocal });
    }
  });

  it("holds a press neither the browser nor the tab would keep for this page only", () => {
    withStorage({ local: fullStorage(new Map()), session: fullStorage(new Map()) }, () => {
      expect(setMeasurementDeclined(true)).toBe(false);
      expect(measurementDeclined()).toBe(true);
      expect(measurementChoiceState()).toBe("declined-this-page");
      setMeasurementDeclined(false);
      expect(measurementChoiceState()).toBe("measured");
    });
  });

  // #355's code review: the switch reads what holds from the choice itself,
  // so a return to the page cannot reset it.
  it("tells the switch what holds, and only a press the browser would not keep makes this tab's own state", () => {
    setMeasurementDeclined(true);
    expect(measurementChoiceState()).toBe("declined");
    setMeasurementDeclined(false);
    expect(measurementChoiceState()).toBe("measured");
    // A kept press leaves nothing for the tab: what the browser keeps holds,
    // so when its own settings clear the site's data (no event in this tab),
    // the next read sees that, and nothing claims the browser refused it.
    setMeasurementDeclined(true);
    window.localStorage.removeItem(MEASUREMENT_DECLINED_KEY);
    expect(measurementChoiceState()).toBe("measured");
    expect(measurementDeclined()).toBe(false);
    // A press not to decline that the browser would not keep leaves the kept one in force.
    withStorage({ local: { getItem: () => "1", setItem: () => undefined, removeItem: refuse } }, () => {
      expect(setMeasurementDeclined(false)).toBe(true);
      expect(measurementChoiceState()).toBe("declined");
      expect(measurementDeclined()).toBe(true);
    });
  });

  // #355's code review: what the browser keeps is the choice that holds, so a
  // switch on the page, and the reporter, follow another tab's press.
  it("tells whoever shows the choice of a press here or in another tab, and stops when asked", () => {
    const seen: string[] = [];
    const stop = subscribeMeasurementChoice(() => { seen.push(measurementChoiceState()); });
    try {
      setMeasurementDeclined(true);
      expect(seen).toEqual(["declined"]);
      // Another tab undoes it: this tab follows.
      window.localStorage.removeItem(MEASUREMENT_DECLINED_KEY);
      otherTab(MEASUREMENT_DECLINED_KEY, null);
      expect(seen).toEqual(["declined", "measured"]);
      expect(measurementDeclined()).toBe(false);
      // Another tab declines: this tab follows, its reporter included.
      window.localStorage.setItem(MEASUREMENT_DECLINED_KEY, "1");
      otherTab(MEASUREMENT_DECLINED_KEY, "1");
      expect(seen.at(-1)).toBe("declined");
      expect(measurementDeclined()).toBe(true);
      // Another key is nothing to tell.
      otherTab("venviewer.something-else", "x");
      expect(seen).toHaveLength(3);
      // A script in another tab clears all the site's storage: what the
      // browser keeps is followed, as when the browser clears the site's data
      // (the page says the choice lasts until then).
      window.localStorage.clear();
      otherTab(null, null);
      expect(seen.at(-1)).toBe("measured");
      expect(measurementDeclined()).toBe(false);
      // A return to this page from the back/forward cache reads it again.
      window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
      expect(seen).toHaveLength(5);
      window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
      expect(seen).toHaveLength(5);
    } finally {
      stop();
    }
    const told = seen.length;
    setMeasurementDeclined(false);
    otherTab(MEASUREMENT_DECLINED_KEY, "1");
    expect(seen).toHaveLength(told);
  });

  // The press this tab could not have the browser keep holds only here, gives
  // way to whatever another tab then has the browser keep, and outlasts a
  // script there clearing all the site's storage.
  it("holds a press the browser would not keep in this tab only, until another tab's press replaces it", () => {
    const kept = new Map<string, string>();
    withStorage({ local: fullStorage(kept) }, () => {
      setMeasurementDeclined(true);
      expect(measurementChoiceState()).toBe("declined-this-tab");
      // A clear of all the site's storage there leaves this tab's objection.
      otherTab(null, null);
      expect(measurementChoiceState()).toBe("declined-this-tab");
      expect(measurementDeclined()).toBe(true);
      // Another tab, with room by then, declines and then undoes it.
      kept.set(MEASUREMENT_DECLINED_KEY, "1");
      otherTab(MEASUREMENT_DECLINED_KEY, "1");
      expect(measurementChoiceState()).toBe("declined");
      kept.delete(MEASUREMENT_DECLINED_KEY);
      otherTab(MEASUREMENT_DECLINED_KEY, null);
      expect(measurementChoiceState()).toBe("measured");
      expect(measurementDeclined()).toBe(false);
    });
  });

  it("gives a press held for this page only way to another tab's press, and keeps it through a clear there", () => {
    const kept = new Map<string, string>();
    withStorage({ local: fullStorage(kept), session: fullStorage(new Map()) }, () => {
      setMeasurementDeclined(true);
      otherTab(null, null);
      expect(measurementChoiceState()).toBe("declined-this-page");
      kept.set(MEASUREMENT_DECLINED_KEY, "1");
      otherTab(MEASUREMENT_DECLINED_KEY, "1");
      kept.delete(MEASUREMENT_DECLINED_KEY);
      otherTab(MEASUREMENT_DECLINED_KEY, null);
      expect(measurementChoiceState()).toBe("measured");
    });
  });

  it("reads the choice again when a frame of this tab changes the tab's own copy, and takes it for no other tab's press", () => {
    withStorage({ local: fullStorage(new Map()) }, () => {
      // Kept for the tab only, so another tab's press would take it away.
      setMeasurementDeclined(true);
      const seen: string[] = [];
      const stop = subscribeMeasurementChoice(() => { seen.push(measurementChoiceState()); });
      try {
        window.dispatchEvent(new StorageEvent("storage", { key: MEASUREMENT_DECLINED_KEY, newValue: "1", storageArea: window.sessionStorage }));
        expect(seen).toEqual(["declined-this-tab"]);
      } finally {
        stop();
      }
    });
  });

  it("holds a press for the page where the tab's own storage cannot even be read", () => {
    withStorage({ local: fullStorage(new Map()), session: { getItem: refuse, setItem: refuse, removeItem: refuse } }, () => {
      setMeasurementDeclined(true);
      expect(measurementChoiceState()).toBe("declined-this-page");
      expect(measurementDeclined()).toBe(true);
    });
  });

  it("takes an event for another tab's press as one where the tab's own storage cannot be asked", () => {
    const realSession = window.sessionStorage;
    const browserStorage = window.localStorage;
    const seen: string[] = [];
    withStorage({ local: fullStorage(new Map()) }, () => {
      Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
      const stop = subscribeMeasurementChoice(() => { seen.push(measurementChoiceState()); });
      try {
        // Neither the browser nor the tab will keep it: held for this page.
        setMeasurementDeclined(true);
        expect(measurementChoiceState()).toBe("declined-this-page");
        // With its storage area named, the check has to ask for the tab's
        // own, which throws: taken for another tab's press, the press held for
        // the page gives way to it (taken for this tab's own, it would stand).
        window.dispatchEvent(new StorageEvent("storage", { key: MEASUREMENT_DECLINED_KEY, newValue: null, storageArea: browserStorage }));
        expect(seen.at(-1)).toBe("measured");
      } finally {
        stop();
        Object.defineProperty(window, "sessionStorage", { configurable: true, value: realSession });
      }
    });
  });

  it("leaves a press held for the page alone when a frame of this tab changes the tab's own copy", () => {
    const tab: Storage = { ...fullStorage(new Map()), length: 0, key: () => null, clear: () => undefined };
    withStorage({ local: fullStorage(new Map()), session: tab }, () => {
      setMeasurementDeclined(true);
      expect(measurementChoiceState()).toBe("declined-this-page");
      window.dispatchEvent(new StorageEvent("storage", { key: MEASUREMENT_DECLINED_KEY, newValue: null, storageArea: tab }));
      expect(measurementChoiceState()).toBe("declined-this-page");
    });
  });
});
