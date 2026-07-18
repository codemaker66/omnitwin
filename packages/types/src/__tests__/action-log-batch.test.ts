import { describe, expect, it } from "vitest";
import {
  ACTION_LOG_MAX_BATCH,
  ACTION_MAX_BYTES,
  ACTION_MAX_DEPTH,
  ActionLogBatchSchema,
  jsonDepth,
} from "../action-log-batch.js";

// G4 Slice 3 (precondition 2): the server-ingestion contract. The Action
// envelope's JsonValueSchema recurses via z.lazy — these bounds run BEFORE
// that recursion so adversarial nesting/size can never reach it. (Fastify's
// bodyLimit gates raw request size upstream; these are the semantic caps.)

const ACTION = {
  id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
  actor: { kind: "operator" as const },
  intent: "object.place",
  payload: { added: [{ id: "obj-1" }], label: "Place Round table" },
  inverse: { removed: [{ id: "obj-1" }] },
  provenance: { surface: "planner", tool: "markup" },
  ts: "2026-07-17T19:00:00.000Z",
};

function batch(actions: readonly unknown[]): unknown {
  return {
    batchId: "0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e",
    revision: 7,
    actions,
  };
}

function nested(depth: number): unknown {
  let value: unknown = true;
  for (let i = 0; i < depth; i += 1) value = { next: value };
  return value;
}

describe("jsonDepth", () => {
  it("measures nesting iteratively (no recursion to blow)", () => {
    expect(jsonDepth("x")).toBe(1);
    expect(jsonDepth({ a: 1 })).toBe(2);
    expect(jsonDepth({ a: { b: 1 } })).toBe(3);
    expect(jsonDepth([{ a: [1] }])).toBe(4);
    // A 100k-deep chain must return, not overflow the call stack.
    expect(jsonDepth(nested(100_000))).toBe(100_001);
  });
});

describe("ActionLogBatchSchema", () => {
  it("accepts a well-formed batch and exposes the caps", () => {
    const parsed = ActionLogBatchSchema.parse(batch([ACTION, { ...ACTION, id: "1d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e", intent: "object.remove" }]));
    expect(parsed.actions).toHaveLength(2);
    expect(parsed.revision).toBe(7);
    expect(ACTION_LOG_MAX_BATCH).toBeGreaterThan(0);
    expect(ACTION_MAX_BYTES).toBeGreaterThan(1024);
    expect(ACTION_MAX_DEPTH).toBeGreaterThanOrEqual(8);
  });

  it("bounds the batch: empty and oversized both rejected", () => {
    expect(ActionLogBatchSchema.safeParse(batch([])).success).toBe(false);
    const oversized = Array.from({ length: ACTION_LOG_MAX_BATCH + 1 }, () => ACTION);
    expect(ActionLogBatchSchema.safeParse(batch(oversized)).success).toBe(false);
  });

  it("rejects an action whose serialized size exceeds the byte cap", () => {
    const fat = { ...ACTION, payload: { blob: "x".repeat(ACTION_MAX_BYTES + 1024) } };
    expect(ActionLogBatchSchema.safeParse(batch([fat])).success).toBe(false);
  });

  it("rejects nesting beyond the depth cap BEFORE the recursive envelope parse", () => {
    const deep = { ...ACTION, payload: nested(ACTION_MAX_DEPTH + 5) };
    const result = ActionLogBatchSchema.safeParse(batch([deep]));
    expect(result.success).toBe(false);
    // And a pathological chain must be rejected without a stack overflow.
    const abyss = { ...ACTION, payload: nested(50_000) };
    expect(ActionLogBatchSchema.safeParse(batch([abyss])).success).toBe(false);
  });

  it("rejects intra-batch duplicate action ids (reviewer HIGH — dedup semantics stay unambiguous)", () => {
    // The server dedups across batches by id (ON CONFLICT DO NOTHING);
    // duplicates WITHIN one batch would make the accepted/duplicates
    // accounting depend on Postgres's intra-statement conflict handling.
    // The contract forbids them outright.
    const duplicated = batch([ACTION, { ...ACTION, intent: "object.remove" }]);
    const result = ActionLogBatchSchema.safeParse(duplicated);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("duplicate"))).toBe(true);
    }
  });

  it("keeps the envelope contract: pollution and strictness still enforced through the batch", () => {
    const polluted = { ...ACTION, payload: JSON.parse('{"__proto__": {"x": 1}}') as unknown };
    expect(ActionLogBatchSchema.safeParse(batch([polluted])).success).toBe(false);
    expect(ActionLogBatchSchema.safeParse({ ...(batch([ACTION]) as object), extra: 1 }).success).toBe(false);
    expect(ActionLogBatchSchema.safeParse({ batchId: "not-a-uuid", revision: 0, actions: [ACTION] }).success).toBe(false);
    expect(ActionLogBatchSchema.safeParse({ ...(batch([ACTION]) as object), revision: -1 }).success).toBe(false);
  });
});
