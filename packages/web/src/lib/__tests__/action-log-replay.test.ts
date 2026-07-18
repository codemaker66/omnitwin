import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../../api/action-log.js";
import { verifyReplayable } from "../action-log-replay.js";

// G4 Slice 3: replay-from-log verification. A read-back audit page is
// "replayable" when it can drive a faithful reconstruction: server-ordered
// (strictly increasing ordinals), every entry a valid Action envelope, and
// every document mutation carrying a real inverse (history.*/log.* records
// are meta and exempt). This is the dev verification the programme's DoD
// names — full session replay is slice 4.

function entry(
  ordinal: number,
  overrides: Partial<AuditLogEntry> = {},
): AuditLogEntry {
  return {
    ordinal,
    id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    batchId: "0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e",
    revision: 3,
    submittedBy: "00000000-0000-4000-8000-000000000099",
    actor: { kind: "operator" },
    intent: "object.place",
    payload: { label: "Place Round table" },
    inverse: { removed: [] },
    provenance: { surface: "planner" },
    recordedTs: "2026-07-18T10:00:00.000Z",
    receivedAt: "2026-07-18T10:00:01.000Z",
    ...overrides,
  };
}

describe("verifyReplayable", () => {
  it("accepts a well-ordered page of valid mutations and metas", () => {
    const verdict = verifyReplayable([
      entry(1),
      entry(2, { intent: "history.undo", inverse: { intent: "history.redo" } }),
      entry(3, { intent: "log.summarized", inverse: null }),
      entry(7, { intent: "markup.draw" }), // ordinal gaps are fine (other pages)
    ]);
    expect(verdict.replayable).toBe(true);
    expect(verdict.issues).toEqual([]);
    expect(verdict.counts).toEqual({ total: 4, mutations: 2, metas: 1, logManagement: 1 });
  });

  it("rejects out-of-order or duplicate ordinals — server order is the replay order", () => {
    const outOfOrder = verifyReplayable([entry(2), entry(1)]);
    expect(outOfOrder.replayable).toBe(false);
    expect(outOfOrder.issues.some((issue) => issue.includes("ordinal"))).toBe(true);

    const duplicated = verifyReplayable([entry(1), entry(1, { id: "11111111-1111-4111-8111-111111111111" })]);
    expect(duplicated.replayable).toBe(false);
  });

  it("rejects a document mutation without a real inverse", () => {
    const verdict = verifyReplayable([entry(1, { inverse: null })]);
    expect(verdict.replayable).toBe(false);
    expect(verdict.issues.some((issue) => issue.includes("inverse"))).toBe(true);
  });

  it("rejects an entry whose reconstructed envelope fails the Action contract", () => {
    const verdict = verifyReplayable([entry(1, { intent: "Not A Valid Intent" })]);
    expect(verdict.replayable).toBe(false);
  });

  it("rejects duplicate action ids — one action must never replay twice", () => {
    const verdict = verifyReplayable([
      entry(1),
      entry(2, { id: "00000000-0000-4000-8000-000000000001" }),
    ]);
    expect(verdict.replayable).toBe(false);
    expect(verdict.issues.some((issue) => issue.includes("duplicate"))).toBe(true);
  });
});
