import { describe, expect, it } from "vitest";
import { EVENING_MEMORY_PREFIX, readRememberedHour, rememberHour, type HourStorage } from "../evening-memory.js";

// ---------------------------------------------------------------------------
// The hour each layout opens at (spec 6.2, finding D-11): kept per layout on
// this device, checked before it is believed, and never a reason to fail.
// ---------------------------------------------------------------------------

function memoryStorage(): HourStorage & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
  };
}

const AT = Date.parse("2026-11-28T21:41:00Z");

describe("the hour a layout opens at", () => {
  it("keeps each layout's own hour: A, then B, then A gives A's again", () => {
    const storage = memoryStorage();
    rememberHour("layout-a", { mode: "set", at: AT }, storage);
    rememberHour("layout-b", { mode: "now" }, storage);
    expect(readRememberedHour("layout-a", storage)).toEqual({ mode: "set", at: AT });
    expect(readRememberedHour("layout-b", storage)).toEqual({ mode: "now" });
    expect(storage.entries.get(`${EVENING_MEMORY_PREFIX}layout-a`)).toBe(JSON.stringify({ mode: "set", at: AT }));
  });

  it("has nothing for a layout never set", () => {
    expect(readRememberedHour("layout-c", memoryStorage())).toBeNull();
  });

  it("believes nothing malformed, out of range or extra", () => {
    const storage = memoryStorage();
    for (const raw of ["not json", "{\"mode\":\"set\"}", "{\"mode\":\"set\",\"at\":\"21:41\"}", "{\"mode\":\"set\",\"at\":-99999999999999}",
      "{\"mode\":\"now\",\"extra\":1}", "{\"mode\":\"later\"}", "null"]) {
      storage.entries.set(`${EVENING_MEMORY_PREFIX}x`, raw);
      expect(readRememberedHour("x", storage)).toBeNull();
    }
  });

  it("works without storage, and when storage throws", () => {
    expect(readRememberedHour("x", null)).toBeNull();
    expect(() => { rememberHour("x", { mode: "now" }, null); }).not.toThrow();
    const broken: HourStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("full"); },
    };
    expect(readRememberedHour("x", broken)).toBeNull();
    expect(() => { rememberHour("x", { mode: "set", at: AT }, broken); }).not.toThrow();
  });

  it("never keeps an hour for no layout", () => {
    const storage = memoryStorage();
    rememberHour("", { mode: "now" }, storage);
    expect(storage.entries.size).toBe(0);
  });
});
