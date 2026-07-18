import { describe, expect, it } from "vitest";
import {
  ACTION_ACTOR_KINDS,
  ACTION_INTENT_PATTERN,
  ActionSchema,
} from "../action.js";

// G4 Slice 1 (03 §1): the one Action envelope. Every mutation in the product
// serializes to this shape; the schema is the contract for the audit log,
// undo provenance, and (later) the copilot's tool API.

const VALID_ACTION = {
  id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
  actor: { kind: "operator" as const },
  intent: "object.place",
  payload: { added: [{ id: "obj-1", index: 0 }], label: "Place Round table" },
  inverse: { removed: [{ id: "obj-1", index: 0 }] },
  provenance: { surface: "planner_3d" },
  ts: "2026-07-16T19:00:00.000Z",
};

describe("ActionSchema", () => {
  it("accepts a complete, well-formed action", () => {
    const parsed = ActionSchema.parse(VALID_ACTION);
    expect(parsed.intent).toBe("object.place");
    expect(parsed.actor.kind).toBe("operator");
  });

  it("covers the three actor kinds and optional actor ref", () => {
    expect(ACTION_ACTOR_KINDS).toEqual(["operator", "ai", "system"]);
    for (const kind of ACTION_ACTOR_KINDS) {
      expect(ActionSchema.parse({
        ...VALID_ACTION,
        actor: { kind, ref: "user-123" },
      }).actor.ref).toBe("user-123");
    }
  });

  it("requires namespaced lowercase intents", () => {
    for (const good of ["object.place", "object.update", "history.undo", "log.summarized"]) {
      expect(ACTION_INTENT_PATTERN.test(good), good).toBe(true);
    }
    for (const bad of ["Place", "object", "object.Place", "OBJECT.MOVE", "object..move", ".move"]) {
      expect(ActionSchema.safeParse({ ...VALID_ACTION, intent: bad }).success, bad).toBe(false);
    }
  });

  it("requires a UUID id and an ISO timestamp", () => {
    expect(ActionSchema.safeParse({ ...VALID_ACTION, id: "not-a-uuid" }).success).toBe(false);
    expect(ActionSchema.safeParse({ ...VALID_ACTION, ts: "16/07/2026" }).success).toBe(false);
  });

  it("keeps payload and inverse JSON-serializable; inverse may be null for log-management records", () => {
    expect(ActionSchema.safeParse({
      ...VALID_ACTION,
      intent: "log.summarized",
      payload: { folded: 500, from: "2026-07-16T18:00:00.000Z", to: "2026-07-16T18:40:00.000Z" },
      inverse: null,
    }).success).toBe(true);
    // Functions are not serializable and must be rejected.
    expect(ActionSchema.safeParse({
      ...VALID_ACTION,
      payload: { callback: () => undefined },
    }).success).toBe(false);
  });

  it("rejects prototype-polluting record keys at every depth (slice-3 precondition)", () => {
    // JSON.parse creates OWN __proto__/constructor/prototype properties —
    // harmless in the parsed object itself, but poison for any downstream
    // spread/merge/assign over payloads. The server ingests these blobs;
    // the schema is the gate.
    const attacks = [
      '{"__proto__": {"polluted": true}}',
      '{"constructor": {"prototype": {"polluted": true}}}',
      '{"prototype": {"polluted": true}}',
      '{"nested": {"deep": {"__proto__": {"polluted": true}}}}',
      '{"list": [{"__proto__": {"polluted": true}}]}',
    ];
    for (const attack of attacks) {
      const payload: unknown = JSON.parse(attack);
      expect(ActionSchema.safeParse({ ...VALID_ACTION, payload }).success, attack).toBe(false);
      expect(ActionSchema.safeParse({ ...VALID_ACTION, inverse: payload }).success, attack).toBe(false);
    }
    // Benign keys that merely CONTAIN the words stay legal.
    const benign: unknown = JSON.parse('{"proto_notes": {"constructor_name": "Adam"}}');
    expect(ActionSchema.safeParse({ ...VALID_ACTION, payload: benign }).success).toBe(true);
  });

  it("rejects unknown envelope or provenance fields (strict contract)", () => {
    expect(ActionSchema.safeParse({ ...VALID_ACTION, extra: true }).success).toBe(false);
    expect(ActionSchema.safeParse({
      ...VALID_ACTION,
      provenance: { surface: "planner_3d", secret: "x" },
    }).success).toBe(false);
  });
});
