import { describe, expect, it, beforeEach } from "vitest";
import { ActionSchema } from "@omnitwin/types";
import {
  DEFAULT_RIG_COUNTS,
  useLightingRigStore,
  type ImportedFixtureSpec,
} from "../lighting-rig-store.js";
import { useActionLogStore } from "../action-log-store.js";
import { useAuthStore } from "../auth-store.js";

// G4 Slice 2: the lighting rig emits Actions. The rig has no undo surface
// today — these records are pure audit (and the inverses make a future
// revert tool possible). Rule: no-op mutations stay silent; a mutation that
// deletes data carries enough inverse to restore it fully.

const SPEC: ImportedFixtureSpec = {
  manufacturer: "Robe",
  name: "Esprite",
  family: "spot",
  channels: 49,
  weightKg: 28.4,
  modeName: "Mode 1",
};

function loggedIntents(): readonly string[] {
  return useActionLogStore.getState().entries.map((entry) => entry.intent);
}

function lastAction() {
  const entries = useActionLogStore.getState().entries;
  const action = entries[entries.length - 1];
  if (action === undefined) throw new Error("expected a logged action");
  return action;
}

beforeEach(() => {
  useAuthStore.getState().setUser(null);
  useLightingRigStore.setState({ counts: { ...DEFAULT_RIG_COUNTS }, imported: [] });
  useActionLogStore.getState().reset();
  useActionLogStore.getState().beginLog("cfg-rig-test");
});

describe("lighting rig actions", () => {
  it("setCount logs the change with the previous value in the inverse", () => {
    useLightingRigStore.getState().setCount("par", 18); // default is 12

    expect(loggedIntents()).toEqual(["lighting.rig.set-count"]);
    const action = lastAction();
    expect(ActionSchema.safeParse(action).success).toBe(true);
    expect(action.provenance).toEqual({ surface: "planner", tool: "lighting-rig" });
    expect(action.payload).toEqual({ family: "par", count: 18, previous: 12 });
    expect(action.inverse).toEqual({ family: "par", count: 12 });
  });

  it("setCount to the same value stays silent (state still settles)", () => {
    useLightingRigStore.getState().setCount("par", 12);
    expect(useLightingRigStore.getState().counts.par).toBe(12);
    expect(loggedIntents()).toEqual([]);
  });

  it("importing a new fixture logs import-fixture whose inverse removes it", () => {
    useLightingRigStore.getState().addImportedFixture(SPEC, 2);

    expect(loggedIntents()).toEqual(["lighting.rig.import-fixture"]);
    const action = lastAction();
    const payload = action.payload as { fixture: { id: string; count: number }; added: number };
    expect(payload.fixture.count).toBe(2);
    expect(payload.added).toBe(2);
    expect(action.inverse).toEqual({ id: payload.fixture.id, count: 0 }); // count 0 = remove
  });

  it("importing the same fixture again bumps the count; the inverse restores the old count", () => {
    useLightingRigStore.getState().addImportedFixture(SPEC, 1);
    useLightingRigStore.getState().addImportedFixture(SPEC, 1);

    expect(loggedIntents()).toEqual([
      "lighting.rig.import-fixture",
      "lighting.rig.import-fixture",
    ]);
    const action = lastAction();
    const payload = action.payload as { fixture: { id: string; count: number } };
    expect(payload.fixture.count).toBe(2);
    expect(action.inverse).toEqual({ id: payload.fixture.id, count: 1 });
  });

  it("setImportedCount logs a count change with the previous count in the inverse", () => {
    useLightingRigStore.getState().addImportedFixture(SPEC, 1);
    const id = useLightingRigStore.getState().imported[0]?.id ?? "";
    useLightingRigStore.getState().setImportedCount(id, 4);

    expect(loggedIntents().at(-1)).toBe("lighting.rig.set-imported-count");
    expect(lastAction().payload).toEqual({ id, count: 4, previous: 1 });
    expect(lastAction().inverse).toEqual({ id, count: 1 });
  });

  it("setImportedCount to zero is a removal — the inverse restores the full fixture", () => {
    useLightingRigStore.getState().addImportedFixture(SPEC, 3);
    const fixture = useLightingRigStore.getState().imported[0];
    if (fixture === undefined) throw new Error("expected an imported fixture");
    useLightingRigStore.getState().setImportedCount(fixture.id, 0);

    expect(useLightingRigStore.getState().imported).toHaveLength(0);
    expect(loggedIntents().at(-1)).toBe("lighting.rig.remove-fixture");
    const inverse = lastAction().inverse as { fixture: { id: string; count: number } };
    expect(inverse.fixture).toEqual(fixture); // count 3 comes back on revert
  });

  it("removeImportedFixture logs remove-fixture with a full-fixture inverse; unknown ids stay silent", () => {
    useLightingRigStore.getState().addImportedFixture(SPEC, 2);
    const fixture = useLightingRigStore.getState().imported[0];
    if (fixture === undefined) throw new Error("expected an imported fixture");

    useLightingRigStore.getState().removeImportedFixture("nonexistent");
    expect(loggedIntents()).toEqual(["lighting.rig.import-fixture"]);

    useLightingRigStore.getState().removeImportedFixture(fixture.id);
    expect(loggedIntents().at(-1)).toBe("lighting.rig.remove-fixture");
    const inverse = lastAction().inverse as { fixture: { id: string } };
    expect(inverse.fixture).toEqual(fixture);
  });

  it("reset logs the whole previous rig in the inverse; reset at pristine default stays silent", () => {
    useLightingRigStore.getState().reset();
    expect(loggedIntents()).toEqual([]); // already at the starter rig

    useLightingRigStore.getState().setCount("wash", 9);
    useLightingRigStore.getState().addImportedFixture(SPEC, 1);
    useLightingRigStore.getState().reset();

    expect(loggedIntents().at(-1)).toBe("lighting.rig.reset");
    const inverse = lastAction().inverse as {
      counts: { wash: number };
      imported: { id: string }[];
    };
    expect(inverse.counts.wash).toBe(9);
    expect(inverse.imported).toHaveLength(1);
    expect(useLightingRigStore.getState().counts.wash).toBe(4); // behaviour unchanged
  });

  it("clear logs the whole previous rig in the inverse; clearing an empty rig stays silent", () => {
    useLightingRigStore.getState().clear();
    expect(loggedIntents().at(-1)).toBe("lighting.rig.clear"); // starter rig had fixtures

    useLightingRigStore.getState().clear(); // now genuinely empty
    expect(loggedIntents().filter((i) => i === "lighting.rig.clear")).toHaveLength(1);

    const inverse = useActionLogStore.getState().entries.at(-1)?.inverse as {
      counts: { par: number };
    };
    expect(inverse.counts.par).toBe(12); // the starter rig comes back on revert
  });
});
