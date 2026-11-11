import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  buildingBoardDay,
  buildingTickDays,
  resolveRotaTimeZone,
  type BuildingCheck,
  type BuildingCheckKind,
  type BuildingChecksDay,
} from "@omnitwin/types";
import { venueBuildingCheckMarks, venueBuildingChecks, venueSettings, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { canAdministerVenue, canManageVenue, canRecordObservation } from "../utils/query.js";
import type { RequestActor } from "./requests.js";

// ---------------------------------------------------------------------------
// Opening and lock-up (T-693).
//
// The venue's administrators keep its two lists; each change names the list
// it was made from, so a colleague's newer list is refused rather than
// overwritten. A check taken off a list is retired, not deleted, so a day
// keeps what was ticked on it, and a past day reads the list as it stood
// then. Everyone on the floor reads a day's checks and ticks them on the
// board's day: the venue's own, or the one before for a few hours after the
// board rolls, since a night's lock-up may run past the boundary hour. The
// unique index decides two ticks at once, and the second reads the first
// back. A tick is taken back only by whoever made it, or by the office.
// ---------------------------------------------------------------------------

export interface CheckDeny {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly error: string;
}

function deny(status: number, code: string, error: string): CheckDeny {
  return { ok: false, status, code, error };
}

export function isCheckDeny(value: unknown): value is CheckDeny {
  return typeof value === "object" && value !== null && "ok" in value && (value as { readonly ok: unknown }).ok === false;
}

type CheckRow = typeof venueBuildingChecks.$inferSelect;
type MarkRow = typeof venueBuildingCheckMarks.$inferSelect;

/** The column holding who ticked: a longer name is clipped, never refused. */
const NAME_MAX = 160;

/** The venue's clock: its time zone, and the hour its board's day rolls (midnight without settings, as the board). */
interface VenueClock {
  readonly timeZone: string;
  readonly dayBoundaryHour: number;
}

async function venueClock(db: Pick<Database, "select">, venueId: string): Promise<VenueClock | null> {
  const [venue] = await db.select({ timezone: venues.timezone, dayBoundaryHour: venueSettings.dayBoundaryHour })
    .from(venues)
    .leftJoin(venueSettings, eq(venueSettings.venueId, venues.id))
    .where(and(eq(venues.id, venueId), isNull(venues.deletedAt)))
    .limit(1);
  if (venue === undefined) return null;
  return { timeZone: resolveRotaTimeZone(venue.timezone), dayBoundaryHour: venue.dayBoundaryHour ?? 0 };
}

/** Where a check stood on a board day: on that day's list, off it by then, or not yet written. */
function standing(check: CheckRow, day: string, clock: VenueClock): "listed" | "retired" | "later" {
  const dayOf = (at: Date): string => buildingBoardDay(at.getTime(), clock.dayBoundaryHour, clock.timeZone);
  if (dayOf(check.createdAt) > day) return "later";
  return check.retiredAt !== null && dayOf(check.retiredAt) <= day ? "retired" : "listed";
}

function serializeCheck(row: CheckRow, mark: MarkRow | undefined, retired: boolean): BuildingCheck {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    retired,
    mark: mark === undefined ? null : { doneAt: mark.doneAt.toISOString(), doneByUserId: mark.doneByUserId, doneByName: mark.doneByName },
  };
}

function inOrder(a: CheckRow, b: CheckRow): number {
  return a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

/**
 * A day's two lists as they stood that day: the checks on the list by its
 * end, and any ticked that day, though taken off since.
 */
export async function readBuildingChecks(
  db: Database,
  actor: RequestActor,
  venueId: string,
  day: string,
): Promise<BuildingChecksDay | CheckDeny> {
  if (!canManageVenue(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");
  const clock = await venueClock(db, venueId);
  if (clock === null) return deny(404, "VENUE_NOT_FOUND", "Venue not found.");
  const [checks, marks] = await Promise.all([
    db.select().from(venueBuildingChecks).where(eq(venueBuildingChecks.venueId, venueId)),
    db.select().from(venueBuildingCheckMarks)
      .where(and(eq(venueBuildingCheckMarks.venueId, venueId), eq(venueBuildingCheckMarks.boardDay, day))),
  ]);
  const byCheck = new Map(marks.map((mark) => [mark.checkId, mark]));
  const shown = checks
    .map((check) => ({ check, stood: standing(check, day, clock) }))
    .filter(({ check, stood }) => stood === "listed" || byCheck.has(check.id))
    .sort((a, b) => inOrder(a.check, b.check));
  const list = (kind: BuildingCheckKind): BuildingCheck[] => shown
    .filter(({ check }) => check.kind === kind)
    .map(({ check, stood }) => serializeCheck(check, byCheck.get(check.id), stood !== "listed"));
  return { day, opening: list("opening"), lockup: list("lockup") };
}

/**
 * An administrator leaves one list as it should be: existing checks by id,
 * renamed or moved; new ones without; any left out are retired. Refused when
 * the list changed since they saw it.
 */
export async function replaceBuildingChecks(
  db: Database,
  actor: RequestActor,
  venueId: string,
  kind: BuildingCheckKind,
  body: { readonly expected: readonly string[]; readonly items: readonly { readonly id?: string | undefined; readonly label: string }[] },
): Promise<readonly BuildingCheck[] | CheckDeny> {
  if (!canAdministerVenue(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");
  return db.transaction(async (tx) => {
    // One administrator's change to a list at a time, whether or not it has rows yet.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`building-checks:${venueId}:${kind}`}, 0))`);
    const current = await tx.select().from(venueBuildingChecks)
      .where(and(eq(venueBuildingChecks.venueId, venueId), eq(venueBuildingChecks.kind, kind), isNull(venueBuildingChecks.retiredAt)));
    const currentIds = new Set(current.map((check) => check.id));
    const expected = new Set(body.expected);
    if (currentIds.size !== expected.size || [...currentIds].some((id) => !expected.has(id))) {
      return deny(409, "STALE_CHECKS", "Someone changed this list since you opened it.");
    }
    if (body.items.some((item) => item.id !== undefined && !currentIds.has(item.id))) {
      return deny(400, "UNKNOWN_CHECK", "A check on the list is not one of this venue's.");
    }
    const kept = new Set(body.items.flatMap((item) => (item.id === undefined ? [] : [item.id])));
    const retire = [...currentIds].filter((id) => !kept.has(id));
    if (retire.length > 0) {
      await tx.update(venueBuildingChecks).set({ retiredAt: new Date() })
        .where(and(eq(venueBuildingChecks.venueId, venueId), inArray(venueBuildingChecks.id, retire)));
    }
    for (const [index, item] of body.items.entries()) {
      if (item.id === undefined) {
        await tx.insert(venueBuildingChecks).values({ venueId, kind, label: item.label, sortOrder: index });
      } else {
        await tx.update(venueBuildingChecks).set({ label: item.label, sortOrder: index })
          .where(and(eq(venueBuildingChecks.venueId, venueId), eq(venueBuildingChecks.id, item.id)));
      }
    }
    const after = await tx.select().from(venueBuildingChecks)
      .where(and(eq(venueBuildingChecks.venueId, venueId), eq(venueBuildingChecks.kind, kind), isNull(venueBuildingChecks.retiredAt)))
      .orderBy(asc(venueBuildingChecks.sortOrder), asc(venueBuildingChecks.createdAt), asc(venueBuildingChecks.id));
    return after.map((check) => serializeCheck(check, undefined, false));
  });
}

const OUT_OF_RANGE = (): CheckDeny =>
  deny(400, "CHECK_DAY_OUT_OF_RANGE", "A check is ticked on today's board, or on last night's for a few hours after the board rolls.");
const NOT_ON_LIST = (): CheckDeny => deny(404, "CHECK_NOT_FOUND", "That check is not on that day's list.");

/** The floor ticks a check on the board's day; a second tick reads the first back. */
export async function markBuildingCheck(
  db: Database,
  actor: RequestActor,
  venueId: string,
  checkId: string,
  day: string,
  now: () => Date = () => new Date(),
): Promise<BuildingCheck | CheckDeny> {
  if (!canRecordObservation(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");
  const clock = await venueClock(db, venueId);
  if (clock === null) return deny(404, "VENUE_NOT_FOUND", "Venue not found.");
  const at = now();
  if (!buildingTickDays(at.getTime(), clock.dayBoundaryHour, clock.timeZone).includes(day)) return OUT_OF_RANGE();
  return db.transaction(async (tx) => {
    // The check is held while the tick lands, so a list saved at the same
    // moment retires it either before the tick (refused) or after (kept).
    const [check] = await tx.select().from(venueBuildingChecks)
      .where(and(eq(venueBuildingChecks.id, checkId), eq(venueBuildingChecks.venueId, venueId)))
      .limit(1)
      .for("share");
    if (check === undefined || standing(check, day, clock) !== "listed") return NOT_ON_LIST();
    await tx.insert(venueBuildingCheckMarks)
      .values({ venueId, checkId, boardDay: day, doneAt: at, doneByUserId: actor.id, doneByName: actor.name.slice(0, NAME_MAX) })
      // The index decides, not a prior read: two taps at once write one tick.
      .onConflictDoNothing({ target: [venueBuildingCheckMarks.checkId, venueBuildingCheckMarks.boardDay] });
    const [mark] = await tx.select().from(venueBuildingCheckMarks)
      .where(and(eq(venueBuildingCheckMarks.checkId, checkId), eq(venueBuildingCheckMarks.boardDay, day))).limit(1);
    return serializeCheck(check, mark, false);
  });
}

/**
 * A tick is taken back on the same days it may be given, by whoever made it
 * or by the office; never silently by a colleague. A check taken off the
 * list since may still have its tick taken back.
 */
export async function unmarkBuildingCheck(
  db: Database,
  actor: RequestActor,
  venueId: string,
  checkId: string,
  day: string,
  now: () => Date = () => new Date(),
): Promise<BuildingCheck | CheckDeny> {
  if (!canRecordObservation(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");
  const clock = await venueClock(db, venueId);
  if (clock === null) return deny(404, "VENUE_NOT_FOUND", "Venue not found.");
  if (!buildingTickDays(now().getTime(), clock.dayBoundaryHour, clock.timeZone).includes(day)) return OUT_OF_RANGE();
  const [check] = await db.select().from(venueBuildingChecks)
    .where(and(eq(venueBuildingChecks.id, checkId), eq(venueBuildingChecks.venueId, venueId))).limit(1);
  if (check === undefined || standing(check, day, clock) === "later") return NOT_ON_LIST();
  const retired = standing(check, day, clock) === "retired";
  const [mark] = await db.select().from(venueBuildingCheckMarks)
    .where(and(eq(venueBuildingCheckMarks.checkId, checkId), eq(venueBuildingCheckMarks.boardDay, day))).limit(1);
  if (mark === undefined) return serializeCheck(check, undefined, retired);
  if (mark.doneByUserId !== actor.id && !canAdministerVenue(actor, venueId)) {
    return deny(403, "TICK_NOT_YOURS", `${mark.doneByName} ticked this. Only they, or the office, can take it back.`);
  }
  await db.delete(venueBuildingCheckMarks).where(eq(venueBuildingCheckMarks.id, mark.id));
  return serializeCheck(check, undefined, retired);
}
