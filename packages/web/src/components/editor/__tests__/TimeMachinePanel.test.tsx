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
    render(<TimeMachinePanel entries={TRAIL} />);
    expect(screen.getByTestId("time-machine-panel").textContent).toContain("Place chair");
    expect(screen.getAllByTestId("tm-object")).toHaveLength(2);
    expect(screen.getByTestId("tm-restore-state").textContent).toContain("This is the current layout");
  });

  it("scrubbing back redraws the room as it was — the plan follows the trail", () => {
    render(<TimeMachinePanel entries={TRAIL} />);
    fireEvent.change(screen.getByTestId("tm-scrubber"), { target: { value: "0" } });
    expect(screen.getAllByTestId("tm-object")).toHaveLength(1); // the chair had not arrived
    expect(screen.getByTestId("time-machine-panel").textContent).toContain("Place round table");
  });

  it("states the clock honestly and never claims a restore erases history", () => {
    render(<TimeMachinePanel entries={TRAIL} />);
    expect(screen.getByTestId("tm-when").textContent).toContain("as recorded by the planner's device");
    fireEvent.change(screen.getByTestId("tm-scrubber"), { target: { value: "0" } });
    const state = screen.getByTestId("tm-restore-state").textContent ?? "";
    expect(state).toContain("appends a reversible change");
    expect(state).toContain("never erases history");
  });

  it("hands the caller a schema-valid restore Action, and only when travelled away", () => {
    const onRestore = vi.fn<(action: Action) => void>();
    render(<TimeMachinePanel entries={TRAIL} onRestore={onRestore} />);
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

  it("says so plainly when there is no history to travel", () => {
    render(<TimeMachinePanel entries={[]} />);
    expect(screen.getByTestId("time-machine-panel").textContent).toContain("No recorded history yet");
  });
});

// ---------------------------------------------------------------------------
// Honesty about the reconstruction.
//
// A history surface earns trust by being MORE precise about its limits than
// about its contents. These four pin the places where the panel currently
// knows something and does not say it — or, worse, draws a confident room it
// cannot support. Each is a live defect, not a hypothetical.
// ---------------------------------------------------------------------------

describe("TimeMachinePanel — what the reconstruction does and does not show", () => {
  it("marks an object that was REMOVED at the selected change", () => {
    // touchedByEntry types `removed` in the payload and never iterates it, so
    // scrubbing to the moment a table was deleted highlights nothing — and a
    // deletion is precisely the change an operator is hunting for.
    const trail: readonly AuditLogEntry[] = [
      ...TRAIL,
      entry(30, {
        payload: { label: "Remove chair", added: [], removed: [{ object: CHAIR, index: 1 }], updated: [] },
        inverse: { label: "Remove chair", added: [{ object: CHAIR, index: 1 }], removed: [], updated: [] },
      }),
    ];
    render(<TimeMachinePanel entries={trail} live={[TABLE]} />);

    const panel = screen.getByTestId("time-machine-panel");
    expect(panel.textContent).toContain("Remove chair");
    expect(panel.textContent).toMatch(/removed here/i);
  });

  it("refuses to draw a room it cannot reconstruct, and prints the engine's own reason", () => {
    // A fold summary has no inverse, so deriveBaseFromLive cannot recover the
    // starting room. The panel currently throws that reason away and renders a
    // confidently wrong plan.
    const folded: readonly AuditLogEntry[] = [
      entry(5, { intent: "log.summarized", payload: { folded: 500 }, inverse: null }),
      ...TRAIL,
    ];
    render(<TimeMachinePanel entries={folded} live={[TABLE, CHAIR]} />);

    const panel = screen.getByTestId("time-machine-panel");
    expect(panel.textContent).toContain("summarized");
    expect(screen.queryByTestId("tm-plan")).toBeNull();
  });

  it("states the coverage of the reconstruction with real counts", () => {
    // verifyReplayable().counts and replayActions().skipped are both computed
    // today and discarded. Markup and lighting are recorded but not drawn on a
    // furniture plan — saying so is the difference between a drawing and a claim.
    const mixed: readonly AuditLogEntry[] = [
      ...TRAIL,
      entry(30, { intent: "markup.draw", payload: { label: "Sketch" }, inverse: { label: "Sketch" } }),
      entry(40, { intent: "lighting.rig.reset", payload: { label: "Rig" }, inverse: { label: "Rig" } }),
    ];
    render(<TimeMachinePanel entries={mixed} live={[TABLE, CHAIR]} />);

    const coverage = screen.getByTestId("tm-coverage").textContent ?? "";
    expect(coverage).toMatch(/2 recorded furniture changes/i);
    expect(coverage).toMatch(/not drawn here/i);
  });

  it("withdraws restore entirely when the trail is known to be truncated", () => {
    // Anchored to the oldest page while the live room reflects everything
    // after it: any restore computed from that is wrong. Absent, not disabled
    // — a disabled control still tells the operator the feature applies here.
    const onRestore = vi.fn();
    render(<TimeMachinePanel entries={TRAIL} live={[TABLE, CHAIR]} trailComplete={false} onRestore={onRestore} />);

    fireEvent.change(screen.getByTestId("tm-scrubber"), { target: { value: "0" } });

    expect(screen.queryByTestId("tm-restore")).toBeNull();
    expect(screen.getByTestId("time-machine-panel").textContent).toMatch(/earlier changes/i);
  });
});
