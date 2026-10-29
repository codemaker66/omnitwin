import { describe, expect, it } from "vitest";
import {
  loggedDeltaWithoutPieceNotes,
  metadataWithoutNote,
  revisionWithoutPieceNotes,
  setupDetailWithoutNotes,
  sheetWithoutPieceNotes,
} from "../services/piece-note-retention.js";

// ---------------------------------------------------------------------------
// A planner's note on one piece leaves every copy on the layout's retention
// date (card task_1cbeb4c5); labels stay. The database half is in
// dietary-retention-postgres.test.ts.
// ---------------------------------------------------------------------------

const NOTE = "Table 5, seat 4: peanut";

describe("piece note redaction", () => {
  it("drops a piece's note and keeps its label and everything else", () => {
    const metadata = { notes: NOTE, displayLabel: "Table 5", groupId: "g1" };
    expect(metadataWithoutNote(metadata)).toEqual({ displayLabel: "Table 5", groupId: "g1" });
    expect(metadata.notes).toBe(NOTE);
    for (const none of [{ displayLabel: "Table 5" }, { notes: "" }, { notes: null }, null, "text"]) {
      expect(metadataWithoutNote(none)).toBeNull();
    }
  });

  it("clears the save history's pieces, and says when there was nothing to clear", () => {
    const payload = { revision: 3, objects: [
      { id: "a", metadata: { notes: NOTE, displayLabel: "Table 5" } },
      { id: "b", metadata: null },
    ] };
    expect(revisionWithoutPieceNotes(payload)).toEqual({ revision: 3, objects: [
      { id: "a", metadata: { displayLabel: "Table 5" } },
      { id: "b", metadata: null },
    ] });
    expect(revisionWithoutPieceNotes({ objects: [{ id: "b", metadata: { displayLabel: "Table 5" } }] })).toBeNull();
    expect(revisionWithoutPieceNotes({ objects: "x" })).toBeNull();
  });

  it("takes the note off an issued sheet's plan and setup rows, keeping the plan's labels", () => {
    const payload = {
      config: { id: "c" },
      floorPlan: { coordinateSpace: "real_m_v1", objects: [
        { objectId: "a", label: "Table 5", note: NOTE },
        { objectId: "b", label: "Table 6" },
      ] },
      phases: [{ phase: "setup", zones: [{ zone: "main", rows: [
        { key: "round", qty: 2, notes: `${NOTE} · Table 6: VIP` },
        { key: "chair", qty: 20, notes: "" },
      ] }] }],
    };
    expect(sheetWithoutPieceNotes(payload)).toEqual({
      config: { id: "c" },
      floorPlan: { coordinateSpace: "real_m_v1", objects: [
        { objectId: "a", label: "Table 5" },
        { objectId: "b", label: "Table 6" },
      ] },
      phases: [{ phase: "setup", zones: [{ zone: "main", rows: [
        { key: "round", qty: 2, notes: "" },
        { key: "chair", qty: 20, notes: "" },
      ] }] }],
    });
    expect(sheetWithoutPieceNotes({ floorPlan: null, phases: [] })).toBeNull();
  });

  it("marks each logged piece that lost its note, in added, removed and both sides of an update", () => {
    const payload = {
      label: "Edit note",
      added: [{ id: "a", notes: NOTE }],
      removed: [{ id: "b", notes: null }],
      updated: [{ id: "c", before: { notes: "" }, after: { notes: NOTE } }, { id: "d", after: { x: 1 } }],
    };
    expect(loggedDeltaWithoutPieceNotes(payload)).toEqual({
      label: "Edit note",
      added: [{ id: "a", notesRedacted: true }],
      removed: [{ id: "b", notes: null }],
      updated: [{ id: "c", before: { notes: "" }, after: { notesRedacted: true } }, { id: "d", after: { x: 1 } }],
    });
    expect(loggedDeltaWithoutPieceNotes({ label: "Move", updated: [{ id: "d", before: { x: 0 }, after: { x: 1 } }] })).toBeNull();
    expect(loggedDeltaWithoutPieceNotes(null)).toBeNull();
  });

  it("cuts a setup task's detail at the notes it ends with", () => {
    expect(setupDetailWithoutNotes(`Place in Main during Setup. Notes: ${NOTE}`)).toBe("Place in Main during Setup.");
    expect(setupDetailWithoutNotes("Place in Main during Setup.")).toBeNull();
  });
});
