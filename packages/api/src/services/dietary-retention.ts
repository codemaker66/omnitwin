import { and, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { DIETARY_NOTE_RETENTION } from "@omnitwin/types";
import {
  configurationSheetSnapshots,
  configurations,
  enquiries,
  eventConfigurationLinks,
  events,
} from "../db/schema.js";
import type { Database } from "../db/client.js";

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
//   - a layout linked to an event: the note is removed
//     DIETARY_NOTE_DAYS_AFTER_EVENT days after the latest linked event ends;
//   - a layout with no dated event: the note is removed
//     DIETARY_NOTE_DAYS_WITHOUT_EVENT days after the layout last changed, the
//     same 24 months the privacy policy gives an enquiry that did not become
//     a booking;
//   - either way, never while an enquiry filed with the layout has a
//     preferred date still ahead or within the after-event period.
// Only the free-text note goes. The counts per diet are not about anyone in
// particular and stay with the layout and its sheets. A planner's note on a
// single piece (placed_objects.metadata.notes, copied into the sheet's rows
// and, since T-669, onto its plan) is not covered: it is an operational note
// that can still mention an allergy ("Table 5: nut allergy"), and whether such
// notes count as health text is an open decision, not a rule this job applies.
//
// It runs through the house cleanup endpoint (POST /admin/cleanup), with a
// dry run that changes nothing (POST /admin/retention/dietary-notes). It is
// idempotent: a note already removed is not touched again, and the layout's
// updated time is left alone because nobody edited it.
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
}

function hasNote(column: typeof configurations.metadata | typeof configurationSheetSnapshots.payload): SQL {
  return sql`coalesce(${column} #>> ${NOTE_PATH}, '') <> ''`;
}

/** The layouts whose note has outlived its purpose at `now`. */
async function lapsedLayoutIds(db: Database, now: Date): Promise<readonly string[]> {
  const afterEvent = new Date(now.getTime() - DIETARY_NOTE_DAYS_AFTER_EVENT * DAY_MS);
  const withoutEvent = new Date(now.getTime() - DIETARY_NOTE_DAYS_WITHOUT_EVENT * DAY_MS);
  const latestEventEnd = sql`(
    select max(coalesce(${events.endsAt}, ${events.startsAt}))
    from ${eventConfigurationLinks}
    join ${events} on ${events.id} = ${eventConfigurationLinks.eventId}
    where ${eventConfigurationLinks.configurationId} = ${configurations.id}
      and ${events.deletedAt} is null
  )`;
  // An enquiry filed with this layout whose preferred date is still ahead, or
  // within the after-event period, means the layout is being planned for a
  // day that has not yet happened (a layout reused for next year's dinner,
  // or a wedding enquired about two years out). Its note is for that day and
  // stays, whatever older events the layout is linked to.
  const afterEventDay = afterEvent.toISOString().slice(0, 10);
  const upcomingEnquiry = sql`exists (
    select 1 from ${enquiries}
    where ${enquiries.configurationId} = ${configurations.id}
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
          where ${configurationSheetSnapshots.configurationId} = ${configurations.id}
            and ${hasNote(configurationSheetSnapshots.payload)}
        )
      )`,
    ));
  return rows.map((row) => row.id);
}

export async function removeLapsedDietaryNotes(
  db: Database,
  options: DietaryRetentionOptions = {},
): Promise<DietaryRetentionResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const ids = await lapsedLayoutIds(db, now);
  if (ids.length === 0) return { dryRun, layouts: 0, sheets: 0 };

  const sheetNotes = and(inArray(configurationSheetSnapshots.configurationId, [...ids]), hasNote(configurationSheetSnapshots.payload));

  if (dryRun) {
    const layouts = await db.select({ id: configurations.id }).from(configurations)
      .where(and(inArray(configurations.id, [...ids]), hasNote(configurations.metadata)));
    const sheets = await db.select({ id: configurationSheetSnapshots.id }).from(configurationSheetSnapshots).where(sheetNotes);
    return { dryRun, layouts: layouts.length, sheets: sheets.length };
  }

  const clearedLayouts = await db.update(configurations)
    .set({ metadata: sql`jsonb_set(${configurations.metadata}, ${NOTE_PATH}, '""'::jsonb)` })
    .where(and(inArray(configurations.id, [...ids]), isNotNull(configurations.metadata), hasNote(configurations.metadata)))
    .returning({ id: configurations.id });

  const clearedSheets = await db.update(configurationSheetSnapshots)
    .set({
      payload: sql`jsonb_set(${configurationSheetSnapshots.payload}, ${NOTE_PATH}, '""'::jsonb)`,
      // A legacy row's public PDF address goes with the note; the sheet
      // renders again, without it, when someone signed in next opens it.
      pdfUrl: null,
    })
    .where(sheetNotes)
    .returning({ id: configurationSheetSnapshots.id });

  return { dryRun, layouts: clearedLayouts.length, sheets: clearedSheets.length };
}
