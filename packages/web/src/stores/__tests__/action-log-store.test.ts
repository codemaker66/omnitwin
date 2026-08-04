import { afterEach, describe, expect, it } from "vitest";
import type { Action } from "@omnitwin/types";
import { appendWithOverflow } from "../../lib/action-log-overflow.js";
import { useActionLogStore } from "../action-log-store.js";

// G4 Slice 1: the in-session logbook. Append-only within a configuration;
// switching configurations starts a fresh log (a boundary, not an eviction);
// overflow folds the oldest entries into one explicit log.summarized action —
// the log admits truncation, never hides it.

function action(intent: string, ts: string): Action {
  return {
    id: crypto.randomUUID(),
    actor: { kind: "operator" },
    intent,
    payload: { label: intent },
    inverse: null,
    provenance: { surface: "planner_3d" },
    ts,
  };
}

afterEach(() => { useActionLogStore.getState().reset(); });

describe("appendWithOverflow (pure)", () => {
  it("appends under the limit", () => {
    const next = appendWithOverflow([action("object.place", "2026-07-16T19:00:00.000Z")], action("object.update", "2026-07-16T19:00:01.000Z"), {
      maxEntries: 10,
      foldCount: 4,
      makeId: () => "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      now: () => "2026-07-16T19:00:02.000Z",
    });
    expect(next).toHaveLength(2);
  });

  it("folds the oldest entries into one explicit log.summarized action on overflow", () => {
    const limits = {
      maxEntries: 5,
      foldCount: 3,
      makeId: () => "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      now: () => "2026-07-16T19:10:00.000Z",
    };
    let entries: readonly Action[] = [];
    for (let index = 0; index < 5; index += 1) {
      entries = appendWithOverflow(entries, action("object.update", `2026-07-16T19:00:0${String(index)}.000Z`), limits);
    }
    expect(entries).toHaveLength(5);

    // The sixth append exceeds maxEntries: the oldest three fold into one.
    entries = appendWithOverflow(entries, action("object.remove", "2026-07-16T19:00:06.000Z"), limits);
    expect(entries).toHaveLength(4); // summary + 2 survivors + the new one
    const summary = entries[0];
    expect(summary?.intent).toBe("log.summarized");
    expect(summary?.inverse).toBeNull();
    expect(summary?.payload).toMatchObject({
      folded: 3,
      from: "2026-07-16T19:00:00.000Z",
      to: "2026-07-16T19:00:02.000Z",
    });
  });

  it("folds an existing summary into the next one (single summary head)", () => {
    const limits = {
      maxEntries: 3,
      foldCount: 2,
      makeId: () => "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      now: () => "2026-07-16T19:10:00.000Z",
    };
    let entries: readonly Action[] = [];
    for (let index = 0; index < 8; index += 1) {
      entries = appendWithOverflow(entries, action("object.update", `2026-07-16T19:00:0${String(index)}.000Z`), limits);
    }
    // However many folds occurred, the head is a single summary that counts
    // every folded entry (folds absorb prior summaries).
    const summaries = entries.filter((entry) => entry.intent === "log.summarized");
    expect(summaries).toHaveLength(1);
    expect(entries.length).toBeLessThanOrEqual(3);
    const payload = summaries[0]?.payload as { folded: number };
    expect(payload.folded).toBeGreaterThanOrEqual(5);
  });
});

describe("useActionLogStore", () => {
  it("appends within a configuration and starts fresh on a config boundary", () => {
    const store = useActionLogStore.getState();
    store.beginLog("cfg-1");
    store.append(action("object.place", "2026-07-16T19:00:00.000Z"));
    store.append(action("object.update", "2026-07-16T19:00:01.000Z"));
    expect(useActionLogStore.getState().entries).toHaveLength(2);
    expect(useActionLogStore.getState().configId).toBe("cfg-1");

    // Same config: beginLog is idempotent, the log survives.
    store.beginLog("cfg-1");
    expect(useActionLogStore.getState().entries).toHaveLength(2);

    // New config: fresh log (slice 3 flushes to the server before this).
    store.beginLog("cfg-2");
    expect(useActionLogStore.getState().entries).toHaveLength(0);
    expect(useActionLogStore.getState().configId).toBe("cfg-2");
  });

  it("reset clears everything", () => {
    const store = useActionLogStore.getState();
    store.beginLog("cfg-1");
    store.append(action("object.place", "2026-07-16T19:00:00.000Z"));
    store.reset();
    expect(useActionLogStore.getState().entries).toHaveLength(0);
    expect(useActionLogStore.getState().configId).toBeNull();
  });
});
