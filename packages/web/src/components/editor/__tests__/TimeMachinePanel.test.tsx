import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Action } from "@omnitwin/types";
import { ActionSchema } from "@omnitwin/types";
import type { AuditLogEntry } from "../../../api/action-log.js";
import { TimeMachinePanel } from "../TimeMachinePanel.js";

// The Time Machine surface: scrub the recorded trail, watch the room redraw,
// restore without erasing history. Claim safety is asserted here as UI copy,
// because that is where an overclaim would actually reach a person.

const TABLE = { id: "obj-table", kind: "table-round", positionX: 1, positionZ: 0 };
const CHAIR = { id: "obj-chair", kind: "chair", positionX: 4, positionZ: 2 };
const EMPTY_BASE: readonly [] = [];
const LIVE_TRAIL = [TABLE, CHAIR];

function entry(ordinal: number, overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    ordinal,
    id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    batchId: "0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e",
    revision: 3,
    submittedBy: "00000000-0000-4000-8000-000000000099",
    actor: { kind: "operator" },
    intent: "object.place",
    payload: { label: "Place", added: [], removed: [], updated: [] },
    inverse: { label: "Place", added: [], removed: [], updated: [] },
    provenance: { surface: "planner" },
    recordedTs: "2026-07-25T10:15:00.000Z",
    receivedAt: "2026-07-25T10:15:01.000Z",
    ...overrides,
  };
}

const TRAIL: readonly AuditLogEntry[] = [
  entry(10, {
    payload: { label: "Place round table", added: [{ object: TABLE, index: 0 }], removed: [], updated: [] },
    inverse: { label: "Place round table", added: [], removed: [{ object: TABLE, index: 0 }], updated: [] },
  }),
  entry(20, {
    payload: { label: "Place chair", added: [{ object: CHAIR, index: 1 }], removed: [], updated: [] },
    inverse: { label: "Place chair", added: [], removed: [{ object: CHAIR, index: 1 }], updated: [] },
  }),
];

afterEach(cleanup);

describe("TimeMachinePanel", () => {
  it("opens at the newest recorded moment and draws the room as it stands", () => {
    render(<TimeMachinePanel entries={TRAIL} baseObjects={EMPTY_BASE} liveObjects={LIVE_TRAIL} />);
    expect(screen.getByTestId("time-machine-panel").textContent).toContain("Place chair");
    expect(screen.getAllByTestId("tm-object")).toHaveLength(2);
    expect(screen.getByTestId("tm-restore-state").textContent).toContain("This is the current layout");
  });

  it("scrubbing back redraws the room as it was — the plan follows the trail", () => {
    render(<TimeMachinePanel entries={TRAIL} baseObjects={EMPTY_BASE} liveObjects={LIVE_TRAIL} />);
    fireEvent.change(screen.getByTestId("tm-scrubber"), { target: { value: "0" } });
    expect(screen.getAllByTestId("tm-object")).toHaveLength(1); // the chair had not arrived
    expect(screen.getByTestId("time-machine-panel").textContent).toContain("Place round table");
  });

  it("states the clock honestly and never claims a restore erases history", () => {
    render(<TimeMachinePanel entries={TRAIL} baseObjects={EMPTY_BASE} liveObjects={LIVE_TRAIL} />);
    expect(screen.getByTestId("tm-when").textContent).toContain("as recorded by the planner's device");
    fireEvent.change(screen.getByTestId("tm-scrubber"), { target: { value: "0" } });
    const state = screen.getByTestId("tm-restore-state").textContent ?? "";
    expect(state).toContain("appends a reversible change");
    expect(state).toContain("never erases history");
  });

  it("hands the caller a schema-valid restore Action, and only when travelled away", () => {
    const onRestore = vi.fn<(action: Action) => void>();
    render(<TimeMachinePanel entries={TRAIL} baseObjects={EMPTY_BASE} liveObjects={LIVE_TRAIL} onRestore={onRestore} />);
    // At the newest point there is nothing to restore, so no button.
    expect(screen.queryByTestId("tm-restore")).toBeNull();

    fireEvent.change(screen.getByTestId("tm-scrubber"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("tm-restore"));

    expect(onRestore).toHaveBeenCalledTimes(1);
    const action = onRestore.mock.calls[0]?.[0];
    if (action === undefined) throw new Error("expected an action");
    expect(ActionSchema.safeParse(action).success).toBe(true);
    expect(action.intent).toBe("layout.restore");
    expect(action.provenance.tool).toBe("time-machine");
  });

  it("anchors replay to the persisted room that predates the action trail", () => {
    const moveOnly = [entry(10, {
      intent: "object.update",
      payload: {
        label: "Move table",
        added: [],
        removed: [],
        updated: [{ id: TABLE.id, before: { positionX: 1 }, after: { positionX: 7 } }],
      },
      inverse: {
        label: "Move table",
        added: [],
        removed: [],
        updated: [{ id: TABLE.id, before: { positionX: 7 }, after: { positionX: 1 } }],
      },
    })];

    render(<TimeMachinePanel entries={moveOnly} baseObjects={[TABLE]} liveObjects={[{ ...TABLE, positionX: 7 }]} />);
    expect(screen.getAllByTestId("tm-object")).toHaveLength(1);
    expect(screen.queryByTestId("tm-issues")).toBeNull();
  });

  it("includes an unflushed live edit in the restore delta and its inverse", () => {
    const onRestore = vi.fn<(action: Action) => void>();
    const unflushed = { id: "obj-unflushed", kind: "chair", positionX: 8, positionZ: 3 };
    render(
      <TimeMachinePanel
        entries={TRAIL}
        baseObjects={EMPTY_BASE}
        liveObjects={[...LIVE_TRAIL, unflushed]}
        onRestore={onRestore}
      />,
    );

    fireEvent.click(screen.getByTestId("tm-restore"));
    const action = onRestore.mock.calls[0]?.[0];
    if (action === undefined) throw new Error("expected an action");
    expect(action.payload).toMatchObject({ removed: [{ object: unflushed, index: 2 }] });
    expect(action.inverse).toMatchObject({ added: [{ object: unflushed, index: 2 }] });
  });

  it("says so plainly when there is no history to travel", () => {
    render(<TimeMachinePanel entries={[]} baseObjects={EMPTY_BASE} liveObjects={EMPTY_BASE} />);
    expect(screen.getByTestId("time-machine-panel").textContent).toContain("No recorded history yet");
  });
});
