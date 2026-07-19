import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../../api/action-log.js";
import { changeHistoryRows } from "../change-history-model.js";

// G4 Slice 4: the Change-history display model — audit entries → rows the
// Evidence lens renders. Claim safety: the timestamp shown is the
// operator's clock AS REPORTED (never presented as server-verified), the
// origin line says who/what recorded it without dressing client-supplied
// provenance up as fact, and fold summaries say plainly that detail was
// compressed.

function entry(ordinal: number, overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
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
    recordedTs: "2026-07-18T10:15:00.000Z",
    receivedAt: "2026-07-18T10:15:01.000Z",
    ...overrides,
  };
}

describe("changeHistoryRows", () => {
  it("titles object gestures from their recorded labels, newest first", () => {
    const rows = changeHistoryRows([
      entry(1, { payload: { label: "Place Round table" } }),
      entry(2, { intent: "object.update", payload: { label: "Move 3 items" } }),
    ]);
    expect(rows.map((row) => row.title)).toEqual(["Move 3 items", "Place Round table"]);
    expect(rows[0]?.tone).toBe("edit");
    expect(rows[1]?.tone).toBe("add");
  });

  it("falls back to readable intent names when no label was recorded", () => {
    const rows = changeHistoryRows([
      entry(1, { intent: "markup.draw", payload: { strokeId: "markup-1" } }),
      entry(2, { intent: "event.details.update", payload: { instructions: {} } }),
      entry(3, { intent: "lighting.rig.set-count", payload: { family: "par", count: 4, previous: 12 } }),
      entry(4, { intent: "history.undo", payload: { label: "Move" } }),
    ]);
    expect(rows.map((row) => row.title)).toEqual([
      "Undo — Move",
      "Lighting rig adjusted",
      "Event details updated",
      "Markup drawn",
    ]);
    expect(rows[0]?.tone).toBe("meta");
  });

  it("keeps the clock claim-safe: the operator-reported time, labelled as such", () => {
    const [row] = changeHistoryRows([entry(1)]);
    expect(row?.when).toContain("10:15");
    expect(row?.whenNote).toBe("as recorded by the planner's device");
  });

  it("describes the origin without certifying client-supplied provenance", () => {
    const rows = changeHistoryRows([
      entry(1, { actor: { kind: "operator" }, provenance: { surface: "planner", tool: "markup" } }),
      entry(2, { actor: { kind: "ai", ref: "copilot-v1" }, provenance: { surface: "planner", tool: "ai-copilot" } }),
    ]);
    expect(rows[1]?.origin).toBe("Operator · markup");
    expect(rows[0]?.origin).toBe("AI · ai-copilot");
  });

  it("says plainly when earlier detail was compressed", () => {
    const [row] = changeHistoryRows([
      entry(1, { intent: "log.summarized", payload: { folded: 1000 }, inverse: null }),
    ]);
    expect(row?.title).toBe("1000 earlier actions summarized");
    expect(row?.tone).toBe("note");
  });
});
