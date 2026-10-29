import { and, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { DIETARY_NOTE_RETENTION } from "@omnitwin/types";
import {
  actionLog,
  configurationSheetSnapshots,
  configurations,
  enquiries,
  eventConfigurationLinks,
  events,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { outerColumn } from "../utils/outer-column.js";
import { sqlStateOf } from "./dietary-memory.js";
import { NO_PIECE_NOTES, pieceNotesHeld, removeLapsedPieceNotes, type PieceNoteCounts } from "./piece-note-retention.js";

// ---------------------------------------------------------------------------
// Retention for guests' allergy notes (fix-first item 18).
//
// A layout can carry a free-text note about guests' allergies
// (metadata.instructions.dietary.otherAllergies), and every event sheet
// issued from it keeps a copy (configuration_sheet_snapshots.payload). The
// sheet's PDF is rendered per signed-in request and never stored (PR #130),
// so the payload is the only copy to redact. The note is health information about
// people who never used the product. It is needed to prepare the day and to
// answer questions just after it, and not after that.
//
// The rule:
//   - a layout with a dated event: the note is removed
//     DIETARY_NOTE_DAYS_AFTER_EVENT days after the latest one ends. The date
//     is the later of the events the layout is linked to (or their live
//     bookings) and the live bookings made from the enquiries filed with it.
//     A client's own layout is never linked to an event (the link would give
//     the client the event's schedule), so without the bookings the very
//     layouts that show the consent wording kept the note for 24 months
//     (release audit people-privacy-1);
//   - a layout with no dated event: the note is removed
//     DIETARY_NOTE_DAYS_WITHOUT_EVENT days after the layout last changed, the
//     same 24 months the privacy policy gives an enquiry that did not become
//     a booking;
//   - either way, never while an enquiry filed with the layout has a
//     preferred date still ahead or within the after-event period.
// Only the free-text note goes. The counts per diet are not about anyone in
// particular and stay with the layout and its sheets. A planner's note on a
// single piece ("Table 5: nut allergy") goes on the same date, from every
// copy of it (services/piece-note-retention.ts, Blake's decision of
// 19 October 2026).
//
// The action log (action_log) is append-only, with this one exception. An
// Event details save logged the note in its payload and inverse, so the log
// kept it with no end date (people-privacy-3). The planner and the log's
// write route now log it blanked (redactAllergyNote in @omnitwin/types), and
// this pass blanks it the same way in any row written before that, whatever
// the layout's dates, because the audit trail never needs it. Only the text
// goes: the row, its intent and the counts stay, and otherAllergiesRedacted:
// true beside the blanked note records that something was removed.
//
// It runs every night in the scheduled cleanup (.github/workflows/cleanup.yml,
// scripts/run-cleanup.ts), because the privacy policy and the planner promise
// the removal, and on demand through POST /admin/cleanup, with a dry run that
// changes nothing (POST /admin/retention/dietary-notes). It is idempotent: a
// note already removed is not touched again, a sheet left by a failed night is
// found again the next, and the layout's updated time is left alone because
// nobody edited it.
//
// A sheet issued before PR #130 may still name the public PDF that was
// pre-rendered for it; that URL is cleared with the note. The stored objects
// themselves go with the one-off purge of the bucket's sheets/ prefix, not
// here, so this pass never touches object storage.
// ---------------------------------------------------------------------------

/** From @omnitwin/types, so the privacy policy and the planner say the same. */
export const DIETARY_NOTE_DAYS_AFTER_EVENT = DIETARY_NOTE_RETENTION.daysAfterEvent;
export const DIETARY_NOTE_DAYS_WITHOUT_EVENT = DIETARY_NOTE_RETENTION.daysWithoutEvent;

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTE_PATH = "{instructions,dietary,otherAllergies}";
const REDACTED_MARK_PATH = "{instructions,dietary,otherAllergiesRedacted}";

export interface DietaryRetentionOptions {
  readonly now?: Date;
  /** Report what would be removed, and remove nothing. */
  readonly dryRun?: boolean;
}

export interface DietaryRetentionResult {
  readonly dryRun: boolean;
  /** Layouts whose note was (or would be) removed. */
  readonly layouts: number;
  /** Event sheets whose copy was (or would be) removed. */
  readonly sheets: number;
  /** Action log entries whose copy was (or would be) removed. */
  readonly actionLog: number;
  /** Planners' notes on single pieces, by where they were copied. */
  readonly pieceNotes: PieceNoteCounts;
}

type NoteColumn =
  | typeof configurations.metadata
  | typeof configurationSheetSnapshots.payload
  | typeof actionLog.payload
  | typeof actionLog.inverse;

function hasNote(column: NoteColumn): SQL {
  return sql`coalesce(${column} #>> ${NOTE_PATH}, '') <> ''`;
}

/** A logged payload or inverse with its note blanked and the removal
 *  recorded, or as it is when it holds none (a null inverse included). */
function redactedEntry(column: typeof actionLog.payload | typeof actionLog.inverse): SQL {
  return sql`case when ${hasNote(column)}
    then jsonb_set(jsonb_set(${column}, ${NOTE_PATH}, '""'::jsonb), ${REDACTED_MARK_PATH}, 'true'::jsonb)
    else ${column} end`;
}

/** The layouts whose notes have outlived their purpose at `now` and that
 *  still hold one: the allergy note, or a piece's note in any of its copies. */
async function lapsedLayoutIds(db: Database, now: Date): Promise<readonly string[]> {
  const afterEvent = new Date(now.getTime() - DIETARY_NOTE_DAYS_AFTER_EVENT * DAY_MS);
  const withoutEvent = new Date(now.getTime() - DIETARY_NOTE_DAYS_WITHOUT_EVENT * DAY_MS);
  // The latest event the layout is for: the events it is linked to (each at
  // the later of its own end and its live bookings', in case its dates lag a
  // move), and the live bookings made from the enquiries filed with it, at
  // the later of the booking's end and its event's. greatest() and max()
  // skip the missing ones. Tables inside these subqueries are aliased, so
  // each column binds to the table meant, not the nearest with that name.
  const linkedEventEnd = sql`(
    select max(greatest(
      coalesce(${events.endsAt}, ${events.startsAt}),
      (select max(live."ends_at") from "bookings" as live
        where live."event_id" = ${events.id} and live."deleted_at" is null
          and live."status" = 'active' and live."kind" in ('hold', 'ink'))
    ))
    from ${eventConfigurationLinks}
    join ${events} on ${events.id} = ${eventConfigurationLinks.eventId}
    where ${eventConfigurationLinks.configurationId} = ${outerColumn(configurations.id)}
      and ${events.deletedAt} is null
  )`;
  const enquiryBookingEnd = sql`(
    select max(greatest(booked."ends_at", coalesce(bound."ends_at", bound."starts_at")))
    from "enquiries" as asked
    join "bookings" as booked on booked."enquiry_id" = asked."id"
      and booked."deleted_at" is null and booked."status" = 'active' and booked."kind" in ('hold', 'ink')
    left join "events" as bound on bound."id" = booked."event_id" and bound."deleted_at" is null
    where asked."configuration_id" = ${configurations.id}
  )`;
  const latestEventEnd = sql`greatest(${linkedEventEnd}, ${enquiryBookingEnd})`;
  // An enquiry filed with this layout whose preferred date is still ahead, or
  // within the after-event period, means the layout is being planned for a
  // day that has not yet happened (a layout reused for next year's dinner,
  // or a wedding enquired about two years out). Its note is for that day and
  // stays, whatever older events the layout is linked to.
  const afterEventDay = afterEvent.toISOString().slice(0, 10);
  const upcomingEnquiry = sql`exists (
    select 1 from ${enquiries}
    where ${enquiries.configurationId} = ${outerColumn(configurations.id)}
      and ${enquiries.preferredDate} >= ${afterEventDay}::date
  )`;
  const rows = await db
    .select({ id: configurations.id })
    .from(configurations)
    .where(and(
      sql`(
        (${latestEventEnd} is not null and ${latestEventEnd} < ${afterEvent})
        or (${latestEventEnd} is null and ${configurations.updatedAt} < ${withoutEvent})
      )`,
      sql`not ${upcomingEnquiry}`,
      sql`(
        ${hasNote(configurations.metadata)}
        or exists (
          select 1 from ${configurationSheetSnapshots}
          where ${configurationSheetSnapshots.configurationId} = ${outerColumn(configurations.id)}
            and ${hasNote(configurationSheetSnapshots.payload)}
        )
        or ${pieceNotesHeld(configurations.id)}
      )`,
    ));
  return rows.map((row) => row.id);
}

/** The retention pass failed. Carries the SQLSTATE and nothing else: the
 *  database's own error can quote the failing row ("Failing row contains …"),
 *  note included, and the nightly job's log is public with the repository. */
export class DietaryRetentionError extends Error {
  readonly sqlState: string | null;
  constructor(cause: unknown) {
    const sqlState = sqlStateOf(cause);
    super(`Allergy note retention pass failed${sqlState === null ? "" : ` (SQLSTATE ${sqlState})`}`);
    this.name = "DietaryRetentionError";
    this.sqlState = sqlState;
  }
}

export async function removeLapsedDietaryNotes(
  db: Database,
  options: DietaryRetentionOptions = {},
): Promise<DietaryRetentionResult> {
  try {
    return await removeLapsed(db, options);
  } catch (error) {
    throw new DietaryRetentionError(error);
  }
}

async function removeLapsed(db: Database, options: DietaryRetentionOptions): Promise<DietaryRetentionResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const ids = await lapsedLayoutIds(db, now);
  const lapsed = ids.length === 0 ? null : {
    layouts: and(inArray(configurations.id, [...ids]), isNotNull(configurations.metadata), hasNote(configurations.metadata)),
    sheets: and(inArray(configurationSheetSnapshots.configurationId, [...ids]), hasNote(configurationSheetSnapshots.payload)),
  };
  // Every logged copy, whatever its layout's dates.
  const logged = or(hasNote(actionLog.payload), hasNote(actionLog.inverse));
  const pieceNotes = ids.length === 0 ? NO_PIECE_NOTES : await removeLapsedPieceNotes(db, ids, dryRun);

  if (dryRun) {
    const layouts = lapsed === null ? [] : await db.select({ id: configurations.id }).from(configurations).where(lapsed.layouts);
    const sheets = lapsed === null ? [] : await db.select({ id: configurationSheetSnapshots.id }).from(configurationSheetSnapshots).where(lapsed.sheets);
    const entries = await db.select({ id: actionLog.id }).from(actionLog).where(logged);
    return { dryRun, layouts: layouts.length, sheets: sheets.length, actionLog: entries.length, pieceNotes };
  }

  const clearedLayouts = lapsed === null ? [] : await db.update(configurations)
    .set({ metadata: sql`jsonb_set(${configurations.metadata}, ${NOTE_PATH}, '""'::jsonb)` })
    .where(lapsed.layouts)
    .returning({ id: configurations.id });

  const clearedSheets = lapsed === null ? [] : await db.update(configurationSheetSnapshots)
    .set({
      payload: sql`jsonb_set(${configurationSheetSnapshots.payload}, ${NOTE_PATH}, '""'::jsonb)`,
      // A legacy row's public PDF address goes with the note; the sheet
      // renders again, without it, when someone signed in next opens it.
      pdfUrl: null,
    })
    .where(lapsed.sheets)
    .returning({ id: configurationSheetSnapshots.id });

  const clearedEntries = await db.update(actionLog)
    .set({ payload: redactedEntry(actionLog.payload), inverse: redactedEntry(actionLog.inverse) })
    .where(logged)
    .returning({ id: actionLog.id });

  return { dryRun, layouts: clearedLayouts.length, sheets: clearedSheets.length, actionLog: clearedEntries.length, pieceNotes };
}
