import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  actionLog,
  configurationLayoutRevisions,
  configurationSheetSnapshots,
  generalAuditLog,
  handoffPacks,
  opsTasks,
  placedObjects,
} from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Retention for planners' notes on single pieces (card task_1cbeb4c5).
//
// A planner can write a note on one table or chair ("Table 5, seat 4: severe
// peanut allergy"). Blake decided on 19 October 2026 that such a note is
// health information like the layout's allergy note, so it goes on the same
// date (services/dietary-retention.ts decides which layouts have lapsed).
//
// The note is copied wherever the layout is, and each copy goes:
//   - placed_objects.metadata.notes, the live piece;
//   - configuration_layout_revisions.payload.objects[].metadata.notes, the
//     planner's save history;
//   - configuration_sheet_snapshots.payload: floorPlan.objects[].note, marked
//     on the printed plan, and phases[].zones[].rows[].notes, the setup rows'
//     join of their pieces' notes;
//   - action_log, the object deltas' added[], removed[] and updated[] entries
//     (payload and inverse), each marked notesRedacted: true;
//   - ops_tasks.detail of the layout's handoff packs, whose setup tasks end
//     "Notes: <the rows' notes>".
// Labels stay (displayLabel, a plan's "Table 5"); only notes go.
//
// A sheet keeps its source hash. The paper check (docs/engineering/
// paper-version-check.md) identifies a version by that hash, and the version
// is unchanged: a copy printed before the removal still reads "current", as
// it should. The allergy note's removal set the precedent.
//
// Not here, because their content is hash-checked on every read and a blanked
// copy would read as tampered: canonical_layout_snapshots and
// phase_layout_snapshots no longer capture piece notes at all
// (comparablePersistedMetadata), and the event-day mission baseline
// (event_missions.baseline, event_mission_tasks) still copies the setup
// tasks' detail. That last copy needs a redaction its replay hash accounts
// for, and is an open item.
//
// One transaction per layout, so a layout's copies go together or not at all,
// and one general_audit_log row per layout with the counts (never the text).
// Idempotent: a copy already gone is not found again.
// ---------------------------------------------------------------------------

export interface PieceNoteCounts {
  /** Layouts with at least one copy removed (or that would be). */
  readonly layouts: number;
  readonly pieces: number;
  readonly revisions: number;
  readonly sheets: number;
  readonly actionLog: number;
  readonly opsTasks: number;
}

export const NO_PIECE_NOTES: PieceNoteCounts = { layouts: 0, pieces: 0, revisions: 0, sheets: 0, actionLog: 0, opsTasks: 0 };

const SETUP_NOTES_MARK = " Notes: ";

// What each store's note looks like in SQL. The same tests find the rows to
// change and, in pieceNotesHeld, the layouts that still hold any.
const pieceHasNote = sql`coalesce(${placedObjects.metadata} ->> 'notes', '') <> ''`;
const revisionHasNote = sql`jsonb_path_exists(${configurationLayoutRevisions.payload}, '$.objects[*].metadata.notes ? (@ != "" && @ != null)')`;
const sheetHasPieceNote = sql`(jsonb_path_exists(${configurationSheetSnapshots.payload}, '$.floorPlan.objects[*].note')
  or jsonb_path_exists(${configurationSheetSnapshots.payload}, '$.phases[*].zones[*].rows[*].notes ? (@ != "")'))`;
const logHasPieceNote = sql`${actionLog.intent} like 'object.%'
  and (jsonb_path_exists(${actionLog.payload}, '$.**.notes ? (@ != "" && @ != null)')
    or jsonb_path_exists(coalesce(${actionLog.inverse}, 'null'::jsonb), '$.**.notes ? (@ != "" && @ != null)'))`;
const taskHasNotes = sql`${opsTasks.kind} = 'setup' and ${opsTasks.detail} like ${`%${SETUP_NOTES_MARK}%`}`;

/** Whether the layout in `configurationId` (an outer query's column) still
 *  holds a piece's note anywhere this pass clears it. */
export function pieceNotesHeld(configurationId: AnyPgColumn): SQL {
  return sql`(
    exists (select 1 from ${placedObjects} where ${placedObjects.configurationId} = ${configurationId} and ${pieceHasNote})
    or exists (select 1 from ${configurationLayoutRevisions}
      where ${configurationLayoutRevisions.configurationId} = ${configurationId} and ${revisionHasNote})
    or exists (select 1 from ${configurationSheetSnapshots}
      where ${configurationSheetSnapshots.configurationId} = ${configurationId} and ${sheetHasPieceNote})
    or exists (select 1 from ${actionLog} where ${actionLog.configurationId} = ${configurationId} and ${logHasPieceNote})
    or exists (select 1 from ${opsTasks} join ${handoffPacks} on ${handoffPacks.id} = ${opsTasks.handoffPackId}
      where ${handoffPacks.configId} = ${configurationId} and ${taskHasNotes})
  )`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The allergy note's test: any value but a missing, null or empty one. */
function holdsText(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function omit(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

/** A piece's metadata without its note, or null when it has none. */
export function metadataWithoutNote(metadata: unknown): Record<string, unknown> | null {
  if (!isRecord(metadata) || !holdsText(metadata["notes"])) return null;
  return omit(metadata, "notes");
}

/** A save-history payload with no piece's note, or null when it has none. */
export function revisionWithoutPieceNotes(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload) || !Array.isArray(payload["objects"])) return null;
  let changed = false;
  const objects = payload["objects"].map((object: unknown) => {
    if (!isRecord(object)) return object;
    const metadata = metadataWithoutNote(object["metadata"]);
    if (metadata === null) return object;
    changed = true;
    return { ...object, metadata };
  });
  return changed ? { ...payload, objects } : null;
}

/** An issued sheet's payload with no piece's note on its plan or setup rows,
 *  or null when it has none. The plan's `note` is optional and never empty
 *  (HallkeeperFloorPlanSchema), so it is dropped; a row's `notes` is "". */
export function sheetWithoutPieceNotes(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  let changed = false;
  const next: Record<string, unknown> = { ...payload };
  const plan = payload["floorPlan"];
  if (isRecord(plan) && Array.isArray(plan["objects"])) {
    next["floorPlan"] = {
      ...plan,
      objects: plan["objects"].map((object: unknown) => {
        if (!isRecord(object) || !holdsText(object["note"])) return object;
        changed = true;
        return omit(object, "note");
      }),
    };
  }
  const phases = payload["phases"];
  if (Array.isArray(phases)) {
    const withoutRowNotes = (row: unknown): unknown => {
      if (!isRecord(row) || !holdsText(row["notes"])) return row;
      changed = true;
      return { ...row, notes: "" };
    };
    next["phases"] = phases.map((phase: unknown) => {
      if (!isRecord(phase) || !Array.isArray(phase["zones"])) return phase;
      return {
        ...phase,
        zones: phase["zones"].map((zone: unknown) => (
          isRecord(zone) && Array.isArray(zone["rows"]) ? { ...zone, rows: zone["rows"].map(withoutRowNotes) } : zone
        )),
      };
    });
  }
  return changed ? next : null;
}

/** An object action's payload or inverse with no piece's note, each entry
 *  that held one marked notesRedacted: true, or null when it has none. */
export function loggedDeltaWithoutPieceNotes(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  let changed = false;
  const withoutNote = (entry: unknown): unknown => {
    if (!isRecord(entry) || !holdsText(entry["notes"])) return entry;
    changed = true;
    return { ...omit(entry, "notes"), notesRedacted: true };
  };
  const next: Record<string, unknown> = { ...value };
  for (const key of ["added", "removed"]) {
    const entries = value[key];
    if (Array.isArray(entries)) next[key] = entries.map(withoutNote);
  }
  const updated = value["updated"];
  if (Array.isArray(updated)) {
    next["updated"] = updated.map((patch: unknown) => {
      if (!isRecord(patch)) return patch;
      const before = withoutNote(patch["before"]);
      const after = withoutNote(patch["after"]);
      return { ...patch, ...(patch["before"] === undefined ? {} : { before }), ...(patch["after"] === undefined ? {} : { after }) };
    });
  }
  return changed ? next : null;
}

/** A setup task's detail without the rows' notes it ends with, or null. */
export function setupDetailWithoutNotes(detail: string): string | null {
  const at = detail.indexOf(SETUP_NOTES_MARK);
  return at < 0 ? null : detail.slice(0, at);
}

/** Remove the piece notes of every lapsed layout, or count them on a dry run. */
export async function removeLapsedPieceNotes(
  db: Database,
  layoutIds: readonly string[],
  dryRun: boolean,
): Promise<PieceNoteCounts> {
  let totals = NO_PIECE_NOTES;
  for (const configurationId of layoutIds) {
    const counts = await db.transaction(async (tx) => {
      const pieces = await tx.select({ id: placedObjects.id }).from(placedObjects)
        .where(and(eq(placedObjects.configurationId, configurationId), pieceHasNote));

      const revisionRows = await tx.select({ id: configurationLayoutRevisions.id, payload: configurationLayoutRevisions.payload })
        .from(configurationLayoutRevisions)
        .where(and(eq(configurationLayoutRevisions.configurationId, configurationId), revisionHasNote));
      const revisions = revisionRows.flatMap((row) => {
        const payload = revisionWithoutPieceNotes(row.payload);
        return payload === null ? [] : [{ id: row.id, payload }];
      });

      const sheetRows = await tx.select({ id: configurationSheetSnapshots.id, payload: configurationSheetSnapshots.payload })
        .from(configurationSheetSnapshots)
        .where(and(eq(configurationSheetSnapshots.configurationId, configurationId), sheetHasPieceNote));
      const sheets = sheetRows.flatMap((row) => {
        const payload = sheetWithoutPieceNotes(row.payload);
        return payload === null ? [] : [{ id: row.id, payload }];
      });

      const loggedRows = await tx.select({ id: actionLog.id, payload: actionLog.payload, inverse: actionLog.inverse })
        .from(actionLog)
        .where(and(eq(actionLog.configurationId, configurationId), logHasPieceNote));
      const logged = loggedRows.flatMap((row) => {
        const payload = loggedDeltaWithoutPieceNotes(row.payload);
        const inverse = loggedDeltaWithoutPieceNotes(row.inverse);
        return payload === null && inverse === null ? [] : [{ id: row.id, payload: payload ?? row.payload, inverse: inverse ?? row.inverse }];
      });

      const packs = tx.select({ id: handoffPacks.id }).from(handoffPacks).where(eq(handoffPacks.configId, configurationId));
      const taskRows = await tx.select({ id: opsTasks.id, detail: opsTasks.detail }).from(opsTasks)
        .where(and(inArray(opsTasks.handoffPackId, packs), taskHasNotes));
      const tasks = taskRows.flatMap((row) => {
        const detail = setupDetailWithoutNotes(row.detail);
        return detail === null ? [] : [{ id: row.id, detail }];
      });

      const found = { pieces: pieces.length, revisions: revisions.length, sheets: sheets.length, actionLog: logged.length, opsTasks: tasks.length };
      const any = Object.values(found).some((count) => count > 0);
      if (dryRun || !any) return { layouts: any ? 1 : 0, ...found };

      if (pieces.length > 0) {
        await tx.update(placedObjects)
          .set({ metadata: sql`${placedObjects.metadata} - 'notes'` })
          .where(inArray(placedObjects.id, pieces.map((piece) => piece.id)));
      }
      for (const row of revisions) {
        await tx.update(configurationLayoutRevisions).set({ payload: row.payload }).where(eq(configurationLayoutRevisions.id, row.id));
      }
      for (const row of sheets) {
        await tx.update(configurationSheetSnapshots).set({ payload: row.payload }).where(eq(configurationSheetSnapshots.id, row.id));
      }
      for (const row of logged) {
        await tx.update(actionLog).set({ payload: row.payload, inverse: row.inverse }).where(eq(actionLog.id, row.id));
      }
      for (const row of tasks) {
        await tx.update(opsTasks).set({ detail: row.detail }).where(eq(opsTasks.id, row.id));
      }
      await tx.insert(generalAuditLog).values({
        actorUserId: null,
        action: "retention.piece_notes_removed",
        targetType: "configuration",
        targetId: configurationId,
        summary: "Planner notes on single pieces removed on the layout's retention date",
        metadata: found,
      });
      return { layouts: 1, ...found };
    });
    totals = {
      layouts: totals.layouts + counts.layouts,
      pieces: totals.pieces + counts.pieces,
      revisions: totals.revisions + counts.revisions,
      sheets: totals.sheets + counts.sheets,
      actionLog: totals.actionLog + counts.actionLog,
      opsTasks: totals.opsTasks + counts.opsTasks,
    };
  }
  return totals;
}
