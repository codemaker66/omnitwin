import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadChecks,
  saveChecks,
  toggleCheck,
  storageKeyFor,
} from "../hallkeeper-checks.js";

describe("storageKeyFor", () => {
  it("prefixes configId consistently", () => {
    expect(storageKeyFor("abc")).toBe("omnitwin.hallkeeper.checks.abc");
  });
});

describe("toggleCheck", () => {
  it("turns a missing key into true", () => {
    expect(toggleCheck({}, "r1")).toEqual({ r1: true });
  });

  it("turns an existing true into deleted (not false) so the object stays minimal", () => {
    const out = toggleCheck({ r1: true }, "r1");
    expect(out).toEqual({});
    expect("r1" in out).toBe(false);
  });

  it("doesn't mutate the input", () => {
    const input = { r1: true };
    const copy = { ...input };
    toggleCheck(input, "r1");
    expect(input).toEqual(copy);
  });
});

describe("loadChecks + saveChecks — round trip", () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { window.localStorage.clear(); });

  it("returns {} when nothing is stored", () => {
    expect(loadChecks("nope")).toEqual({});
  });

  it("round-trips a simple map", () => {
    saveChecks("cfg1", { a: true, b: true });
    expect(loadChecks("cfg1")).toEqual({ a: true, b: true });
  });

  it("rejects non-boolean values from storage (defensive)", () => {
    window.localStorage.setItem(storageKeyFor("cfg2"), JSON.stringify({
      valid: true,
      sneaky: "yes",
      numeric: 1,
      nested: { ok: true },
    }));
    expect(loadChecks("cfg2")).toEqual({ valid: true });
  });

  it("returns {} when stored value is not valid JSON", () => {
    window.localStorage.setItem(storageKeyFor("cfg3"), "not{json");
    expect(loadChecks("cfg3")).toEqual({});
  });

  it("returns {} when stored value is a non-object JSON (array, string, number)", () => {
    window.localStorage.setItem(storageKeyFor("cfg4"), "[1,2,3]");
    expect(loadChecks("cfg4")).toEqual({});
  });
});

describe("saveChecks — eviction under cap", () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { window.localStorage.clear(); });

  it("evicts the lex-oldest entry when MAX_CONFIGS is exceeded", () => {
    // 51 distinct configIds, alphabetically ordered — the first one
    // should be evicted when the 51st lands.
    const ids = Array.from({ length: 51 }, (_, i) => `cfg-${String(i).padStart(3, "0")}`);
    for (const id of ids) {
      saveChecks(id, { row: true });
    }
    // cfg-000 should be gone (lex-oldest when we added cfg-050 and hit cap)
    expect(window.localStorage.getItem(storageKeyFor("cfg-000"))).toBeNull();
    expect(window.localStorage.getItem(storageKeyFor("cfg-050"))).not.toBeNull();
  });

  it("overwriting an existing config does not evict anything", () => {
    for (let i = 0; i < 50; i++) saveChecks(`cfg-${String(i).padStart(3, "0")}`, { r: true });
    // Overwrite cfg-010 — everything should still be there
    saveChecks("cfg-010", { r: true, newone: true });
    expect(window.localStorage.getItem(storageKeyFor("cfg-000"))).not.toBeNull();
    expect(loadChecks("cfg-010")).toEqual({ r: true, newone: true });
  });
});

describe("saveChecks — quota exhaustion is non-fatal", () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { window.localStorage.clear(); });

  it("swallows QuotaExceededError rather than propagating", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      const err = new Error("QuotaExceededError");
      (err as Error & { name: string }).name = "QuotaExceededError";
      throw err;
    });
    expect(() => { saveChecks("cfg-quota", { r: true }); }).not.toThrow();
    spy.mockRestore();
  });
});
