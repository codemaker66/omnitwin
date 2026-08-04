import { describe, expect, it } from "vitest";
import { ActionSchema } from "@omnitwin/types";
import { surfaceAction } from "../surface-actions.js";

// G4 Slice 2: surfaces that bypass the undo engine (markup, event details,
// lighting rig) build their Actions with this one envelope builder. Unlike
// history-derived actions there is no gesture sealing — each call IS one
// completed mutation, so the builder's whole job is envelope discipline:
// schema-valid, JSON-normalized, tool-tagged provenance, real inverse.

const CTX = {
  actor: { kind: "operator" as const, ref: "user-1" },
  surface: "planner",
  makeId: () => "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
  now: () => "2026-07-17T12:00:00.000Z",
};

describe("surfaceAction", () => {
  it("builds a schema-valid envelope with intent, tool provenance, and the supplied inverse", () => {
    const action = surfaceAction(
      {
        intent: "markup.draw",
        tool: "markup",
        payload: { stroke: { id: "markup-1", color: "gold" } },
        inverse: { strokeId: "markup-1" },
      },
      CTX,
    );

    expect(ActionSchema.safeParse(action).success).toBe(true);
    expect(action.intent).toBe("markup.draw");
    expect(action.provenance).toEqual({ surface: "planner", tool: "markup" });
    expect(action.inverse).toEqual({ strokeId: "markup-1" });
    expect(action.actor).toEqual({ kind: "operator", ref: "user-1" });
    expect(action.id).toBe("6f9619ff-8b86-4d01-b42d-00cf4fc964ff");
    expect(action.ts).toBe("2026-07-17T12:00:00.000Z");
  });

  it("normalizes payload and inverse to plain JSON so the serializable contract holds", () => {
    const action = surfaceAction(
      {
        intent: "lighting.rig.set-count",
        tool: "lighting-rig",
        // `undefined` members must drop rather than poison serialization.
        payload: { family: "par", count: 12, ghost: undefined },
        inverse: { family: "par", count: 4 },
      },
      CTX,
    );

    expect(action.payload).toEqual({ family: "par", count: 12 });
    expect(ActionSchema.safeParse(action).success).toBe(true);
  });
});
