import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  addRotaDays,
  resolveRotaTimeZone,
  rotaLocalDate,
  type BuildingCheck,
  type BuildingCheckKind,
  type BuildingChecksDay,
} from "@omnitwin/types";
import { venueBuildingCheckMarks, venueBuildingChecks, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { canAdministerVenue, canManageVenue, canRecordObservation } from "../utils/query.js";
import type { RequestActor } from "./requests.js";

// ---------------------------------------------------------------------------
// Opening and lock-up (T-693).
//
// The venue's administrators keep its two lists; each change names the list
// it was made from, so a colleague's newer list is refused rather than
// overwritten. A check taken off a list is retired, not deleted, so a day
// keeps what was ticked on it. Everyone on the floor reads a day's checks and
// ticks them on the board's day; the unique index decides two ticks at once,
// and the second reads the first back. A tick may be taken back the same way.
// Ticks are held to the venue's yesterday, today and tomorrow: the board's day
// runs to its boundary hour, past midnight, and nobody ticks next week.
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

function serializeCheck(row: CheckRow, mark: MarkRow | undefined): BuildingCheck {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    retired: row.retiredAt !== null,
    mark: mark === undefined ? null : { doneAt: mark.doneAt.toISOString(), doneByName: mark.doneByName },
  };
}

function inOrder(a: CheckRow, b: CheckRow): number {
  return a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

/** A day's two lists: the current checks, and any retired since that were ticked that day. */
export async function readBuildingChecks(
  db: Database,
  actor: RequestActor,
  venueId: string,
  day: string,
): Promise<BuildingChecksDay | CheckDeny> {
  if (!canManageVenue(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");
  const [checks, marks] = await Promise.all([
    db.select().from(venueBuildingChecks).where(eq(venueBuildingChecks.venueId, venueId)),
    db.select().from(venueBuildingCheckMarks)
      .where(and(eq(venueBuildingCheckMarks.venueId, venueId), eq(venueBuildingCheckMarks.boardDay, day))),
  ]);
  const byCheck = new Map(marks.map((mark) => [mark.checkId, mark]));
  const shown = checks.filter((check) => check.retiredAt === null || byCheck.has(check.id)).sort(inOrder);
  const list = (kind: BuildingCheckKind): BuildingCheck[] =>
    shown.filter((check) => check.kind === kind).map((check) => serializeCheck(check, byCheck.get(check.id)));
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
      return deny(409, "STALE_CHECKS", "Someone changed this list since you opened it. Read it again.");
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
    return after.map((check) => serializeCheck(check, undefined));
  });
}

/** The venue's calendar day now, and the days a tick may be for. */
async function tickableDays(db: Database, venueId: string, now: Date): Promise<readonly string[] | null> {
  const [venue] = await db.select({ timezone: venues.timezone }).from(venues)
    .where(and(eq(venues.id, venueId), isNull(venues.deletedAt))).limit(1);
  if (venue === undefined) return null;
  const today = rotaLocalDate(now.getTime(), resolveRotaTimeZone(venue.timezone));
  return [addRotaDays(today, -1), today, addRotaDays(today, 1)];
}

async function activeCheck(db: Database, venueId: string, checkId: string): Promise<CheckRow | null> {
  const [check] = await db.select().from(venueBuildingChecks)
    .where(and(eq(venueBuildingChecks.id, checkId), eq(venueBuildingChecks.venueId, venueId), isNull(venueBuildingChecks.retiredAt)))
    .limit(1);
  return check ?? null;
}

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
  const check = await activeCheck(db, venueId, checkId);
  if (check === null) return deny(404, "CHECK_NOT_FOUND", "That check is not on this venue's lists.");
  const days = await tickableDays(db, venueId, now());
  if (days === null || !days.includes(day)) return deny(400, "CHECK_DAY_OUT_OF_RANGE", "A check is ticked on today, or yesterday's or tomorrow's board.");
  await db.insert(venueBuildingCheckMarks)
    .values({ venueId, checkId, boardDay: day, doneAt: now(), doneByUserId: actor.id, doneByName: actor.name })
    // The index decides, not a prior read: two taps at once write one tick.
    .onConflictDoNothing({ target: [venueBuildingCheckMarks.checkId, venueBuildingCheckMarks.boardDay] });
  const [mark] = await db.select().from(venueBuildingCheckMarks)
    .where(and(eq(venueBuildingCheckMarks.checkId, checkId), eq(venueBuildingCheckMarks.boardDay, day))).limit(1);
  return serializeCheck(check, mark);
}

/** The floor takes a tick back, on the same days it may give one. */
export async function unmarkBuildingCheck(
  db: Database,
  actor: RequestActor,
  venueId: string,
  checkId: string,
  day: string,
  now: () => Date = () => new Date(),
): Promise<BuildingCheck | CheckDeny> {
  if (!canRecordObservation(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");
  const check = await activeCheck(db, venueId, checkId);
  if (check === null) return deny(404, "CHECK_NOT_FOUND", "That check is not on this venue's lists.");
  const days = await tickableDays(db, venueId, now());
  if (days === null || !days.includes(day)) return deny(400, "CHECK_DAY_OUT_OF_RANGE", "A check is ticked on today, or yesterday's or tomorrow's board.");
  await db.delete(venueBuildingCheckMarks)
    .where(and(eq(venueBuildingCheckMarks.venueId, venueId), eq(venueBuildingCheckMarks.checkId, checkId), eq(venueBuildingCheckMarks.boardDay, day)));
  return serializeCheck(check, undefined);
}
