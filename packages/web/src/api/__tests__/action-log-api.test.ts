import { describe, expect, it } from "vitest";
import { AuditEntrySchema } from "../action-log.js";

// G4 Slice 3 (reviewer HIGH): the READ side must be as bounded as the
// write side. JsonValueSchema recurses via z.lazy; an unbounded parse of a
// deep payload THROWS RangeError (empirically at ~1000 levels) instead of
// returning { success: false } — which would escape the api client's
// error contract and crash the audit viewer. The audit-entry schema caps
// depth before the recursive descent, exactly like ingestion does.

function nested(depth: number): unknown {
  let value: unknown = true;
  for (let i = 0; i < depth; i += 1) value = { next: value };
  return value;
}

function entry(payload: unknown): unknown {
  return {
    ordinal: 1,
    id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
    batchId: "0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e",
    revision: 3,
    submittedBy: "00000000-0000-4000-8000-000000000099",
    actor: { kind: "operator" },
    intent: "object.place",
    payload,
    inverse: { removed: [] },
    provenance: { surface: "planner" },
    recordedTs: "2026-07-18T10:00:00.000Z",
    receivedAt: "2026-07-18T10:00:01.000Z",
  };
}

describe("AuditEntrySchema read bounds", () => {
  it("parses an ordinary entry", () => {
    expect(AuditEntrySchema.safeParse(entry({ label: "Place" })).success).toBe(true);
  });

  it("REJECTS (never throws on) a pathologically deep payload", () => {
    const deep = entry(nested(5_000));
    expect(() => AuditEntrySchema.safeParse(deep)).not.toThrow();
    expect(AuditEntrySchema.safeParse(deep).success).toBe(false);
  });

  it("rejects an over-deep inverse the same way", () => {
    const deepInverse = { ...(entry({ ok: true }) as object), inverse: nested(5_000) };
    expect(() => AuditEntrySchema.safeParse(deepInverse)).not.toThrow();
    expect(AuditEntrySchema.safeParse(deepInverse).success).toBe(false);
  });
});
