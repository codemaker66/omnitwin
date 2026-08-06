import type { ReactElement } from "react";
import type { AuditLogEntry } from "../api/action-log.js";
import { TimeMachinePanel } from "../components/editor/TimeMachinePanel.js";

// Throwaway visual-verification fixture (disposable worktree only).
const T = (id: string, x: number, z: number, kind: string) => ({ id, kind, positionX: x, positionZ: z });

function entry(o: number, label: string, payload: object, inverse: object, intent = "object.place"): AuditLogEntry {
  return {
    ordinal: o, id: `00000000-0000-4000-8000-${String(o).padStart(12, "0")}`,
    batchId: "0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e", revision: 3,
    submittedBy: "00000000-0000-4000-8000-000000000099",
    actor: { kind: "operator" }, intent,
    payload: { label, added: [], removed: [], updated: [], ...payload },
    inverse: { label, added: [], removed: [], updated: [], ...inverse },
    provenance: { surface: "planner" },
    recordedTs: `2026-07-25T1${String(o % 6)}:1${String(o % 5)}:00.000Z`,
    receivedAt: "2026-07-25T10:15:01.000Z",
  } as AuditLogEntry;
}

const place = (o: number, obj: ReturnType<typeof T>, i: number) =>
  entry(o, `Place ${obj.kind}`, { added: [{ object: obj, index: i }] }, { removed: [{ object: obj, index: i }] });

const move = (o: number, id: string, fx: number, fz: number, tx: number, tz: number) =>
  entry(o, "Move 1 item",
    { updated: [{ id, before: { positionX: fx, positionZ: fz }, after: { positionX: tx, positionZ: tz } }] },
    { updated: [{ id, before: { positionX: tx, positionZ: tz }, after: { positionX: fx, positionZ: fz } }] },
    "object.update");

const TRAIL: AuditLogEntry[] = [
  place(10, T("t1", -6, -3, "table-round"), 0),
  place(20, T("t2", 0, -3, "table-round"), 1),
  place(30, T("t3", 6, -3, "table-round"), 2),
  place(40, T("top", 0, -8, "top-table"), 3),
  move(50, "t1", -6, -3, -7, 1),
  move(60, "t2", 0, -3, 0, 2),
  move(70, "t3", 6, -3, 7, 1),
  place(80, T("df", 0, 6, "dancefloor"), 4),
];

export function TimeMachineFixturePage(): ReactElement {
  return (
    <div style={{ minHeight: "100vh", background: "#0b0b0d", padding: 40, display: "grid", placeItems: "start center" }}>
      <div style={{ width: 520 }}>
        <TimeMachinePanel entries={TRAIL} onRestore={() => undefined} />
      </div>
    </div>
  );
}
