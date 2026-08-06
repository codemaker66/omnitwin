import { describe, expect, it, beforeEach } from "vitest";
import { ActionSchema } from "@omnitwin/types";
import { logPlannerAction, plannerActionContext } from "../planner-action-log.js";
import { useActionLogStore } from "../action-log-store.js";
import { useAuthStore, type AuthUser } from "../auth-store.js";

// G4 Slice 2: the one wiring seam between direct surfaces (markup, event
// details, lighting rig) and the append-only log. Actor context is built
// HERE — stores never reach into auth themselves — so who-did-it stamping
// stays consistent with the editor history emitter.

const USER: AuthUser = {
  id: "user-7",
  email: "planner@example.com",
  role: "planner",
  platformRole: "none",
  venueId: null,
  name: "Planner",
};

beforeEach(() => {
  useAuthStore.getState().setUser(null);
  useActionLogStore.getState().reset();
  useActionLogStore.getState().beginLog("cfg-wiring-test");
});

describe("actor attribution — the 01 §12 law's load-bearing half", () => {
  // The type system makes "accepted without a recorded operator" impossible.
  // That guarantee is worthless if, at the moment an accepted proposal is
  // APPLIED, the resulting Action is stamped with the operator's identity —
  // the audit trail would then show a human doing work an AI authored, and
  // nothing downstream could ever tell them apart.
  it("stamps an explicitly supplied AI actor rather than the signed-in operator", () => {
    useAuthStore.getState().setUser(USER);

    logPlannerAction(
      {
        intent: "object.update",
        tool: "ai-copilot",
        payload: { moved: 1 },
        inverse: { moved: 1 },
      },
      { kind: "ai", ref: "advisor-v1" },
    );

    const action = useActionLogStore.getState().entries[0];
    if (action === undefined) throw new Error("expected a logged action");
    expect(action.actor).toEqual({ kind: "ai", ref: "advisor-v1" });
    expect(ActionSchema.safeParse(action).success).toBe(true);
  });

  it("still defaults to the signed-in operator when no actor is supplied", () => {
    useAuthStore.getState().setUser(USER);
    logPlannerAction({ intent: "markup.draw", tool: "markup", payload: {}, inverse: {} });
    expect(useActionLogStore.getState().entries[0]?.actor).toEqual({ kind: "operator", ref: "user-7" });
  });

  it("plannerActionContext takes the same override, so the history emitter can too", () => {
    useAuthStore.getState().setUser(USER);
    expect(plannerActionContext().actor).toEqual({ kind: "operator", ref: "user-7" });
    expect(plannerActionContext({ kind: "system" }).actor).toEqual({ kind: "system" });
  });
});

describe("logPlannerAction", () => {
  it("appends a schema-valid planner action stamped with the signed-in operator", () => {
    useAuthStore.getState().setUser(USER);

    logPlannerAction({
      intent: "markup.draw",
      tool: "markup",
      payload: { strokeId: "markup-1" },
      inverse: { strokeId: "markup-1" },
    });

    const entries = useActionLogStore.getState().entries;
    expect(entries).toHaveLength(1);
    const action = entries[0];
    if (action === undefined) throw new Error("expected a logged action");
    expect(ActionSchema.safeParse(action).success).toBe(true);
    expect(action.actor).toEqual({ kind: "operator", ref: "user-7" });
    expect(action.provenance).toEqual({ surface: "planner", tool: "markup" });
    expect(action.intent).toBe("markup.draw");
  });

  it("a failing append never breaks the caller — the audit channel is isolated (reviewer HIGH)", () => {
    // The log rides alongside real mutations (markup commits, rig edits,
    // event-details saves). If appending ever throws, the mutation must
    // survive and the caller must never see the exception — otherwise a
    // pure audit failure masquerades as "Failed to save" or skips a
    // caller's follow-up work (e.g. MarkupLayer's repaint invalidate).
    const original = useActionLogStore.getState().append;
    useActionLogStore.setState({
      append: () => { throw new Error("log storage exploded"); },
    });
    try {
      expect(() => {
        logPlannerAction({
          intent: "markup.draw",
          tool: "markup",
          payload: { strokeId: "markup-1" },
          inverse: { strokeId: "markup-1" },
        });
      }).not.toThrow();
    } finally {
      useActionLogStore.setState({ append: original });
    }
  });

  it("omits the actor ref when no user is signed in (guest planning)", () => {
    logPlannerAction({
      intent: "lighting.rig.clear",
      tool: "lighting-rig",
      payload: {},
      inverse: { counts: {}, imported: [] },
    });

    const action = useActionLogStore.getState().entries[0];
    if (action === undefined) throw new Error("expected a logged action");
    expect(action.actor).toEqual({ kind: "operator" });
    expect(ActionSchema.safeParse(action).success).toBe(true);
  });
});
