import { describe, it, expect } from "vitest";
import { isStale, memoryBackend, withBackend } from "../idb-cache.js";

// ---------------------------------------------------------------------------
// idb-cache — tests against the in-memory backend
//
// IndexedDB semantics are wrapped; the pure-logic parts are the typed
// handle + TTL helper. We use `memoryBackend()` to stay dependency-free.
// ---------------------------------------------------------------------------

describe("withBackend", () => {
  it("round-trips a put → get", async () => {
    const handle = withBackend<{ n: number }>(memoryBackend());
    await handle.put("k", { n: 1 });
    const got = await handle.get("k");
    expect(got?.value).toEqual({ n: 1 });
  });

  it("decorates the value with an ISO-8601 storedAt timestamp", async () => {
    const handle = withBackend<string>(memoryBackend());
    await handle.put("k", "hi");
    const got = await handle.get("k");
    expect(got?.storedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("returns null for a missing key", async () => {
    const handle = withBackend<string>(memoryBackend());
    expect(await handle.get("missing")).toBeNull();
  });

  it("delete removes a key", async () => {
    const handle = withBackend<string>(memoryBackend());
    await handle.put("k", "v");
    await handle.delete("k");
    expect(await handle.get("k")).toBeNull();
  });

  it("list returns every stored entry", async () => {
    const handle = withBackend<number>(memoryBackend());
    await handle.put("a", 1);
    await handle.put("b", 2);
    await handle.put("c", 3);
    const all = await handle.list();
    expect(all).toHaveLength(3);
    expect(all.map((r) => r.key).sort()).toEqual(["a", "b", "c"]);
  });

  it("list filters out malformed rows (no storedAt)", async () => {
    const backend = memoryBackend();
    await backend.put("bad", { value: "no storedAt" });
    await backend.put("good", { storedAt: new Date().toISOString(), value: "ok" });
    const handle = withBackend<string>(backend);
    const all = await handle.list();
    expect(all.map((r) => r.key)).toEqual(["good"]);
  });

  it("get rejects values with a missing storedAt (returns null)", async () => {
    const backend = memoryBackend();
    await backend.put("k", { value: "orphan" }); // no storedAt
    const handle = withBackend<string>(backend);
    expect(await handle.get("k")).toBeNull();
  });
});

describe("isStale", () => {
  const now = new Date("2026-04-18T12:00:00.000Z");

  it("returns false when storedAt is within the TTL", () => {
    const stored = { storedAt: "2026-04-18T11:59:50.000Z", value: "x" };
    expect(isStale(stored, 30_000, now)).toBe(false);
  });

  it("returns true when storedAt is past the TTL", () => {
    const stored = { storedAt: "2026-04-18T11:59:00.000Z", value: "x" };
    expect(isStale(stored, 30_000, now)).toBe(true);
  });

  it("returns true for an unparseable storedAt", () => {
    const stored = { storedAt: "never", value: "x" };
    expect(isStale(stored, 30_000, now)).toBe(true);
  });

  it("returns false at exactly the TTL boundary (inclusive)", () => {
    const stored = { storedAt: "2026-04-18T11:59:30.000Z", value: "x" };
    expect(isStale(stored, 30_000, now)).toBe(false);
  });
});
