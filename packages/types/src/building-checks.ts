import { z } from "zod";
import { addRotaDays, rotaLocalDate, rotaMinuteOfDay } from "./staff-rota-checks.js";

// ---------------------------------------------------------------------------
// Opening and lock-up (T-693): the building's own checks, done each day.
//
// A venue's administrators write its two lists once: what is checked when the
// building opens and when it is locked up. The words are the venue's (its
// doors, its alarm, its heating): Venviewer suggests none, since a list it
// invented would be a claim about a building it has not seen. The floor ticks
// each check on the board's day, and the board says who did it and when; a
// tick is a record of what someone says they did, never a compliance claim.
// A night's lock-up may run past the board's boundary hour, so the board day
// before stays open to ticks for a few hours after the board has rolled.
// ---------------------------------------------------------------------------

const IsoInstantSchema = z.iso.datetime({ offset: true });
const CalendarDateSchema = z.iso.date({ error: "Use a date such as 2026-11-14" });

export const BUILDING_CHECK_KINDS = ["opening", "lockup"] as const;
export const BuildingCheckKindSchema = z.enum(BUILDING_CHECK_KINDS);
export type BuildingCheckKind = z.infer<typeof BuildingCheckKindSchema>;

export const BUILDING_CHECK_LABEL_MAX = 200;
/** Enough for a real building's list, short enough to read at the door. */
export const BUILDING_CHECKS_MAX = 40;

export const BuildingCheckMarkSchema = z.object({
  doneAt: IsoInstantSchema,
  /** Who ticked it: only they, or the office, may take it back. Null once their account is gone. */
  doneByUserId: z.uuid().nullable(),
  doneByName: z.string().min(1),
}).strict();
export type BuildingCheckMark = z.infer<typeof BuildingCheckMarkSchema>;

export const BuildingCheckSchema = z.object({
  id: z.uuid(),
  kind: BuildingCheckKindSchema,
  label: z.string().min(1).max(BUILDING_CHECK_LABEL_MAX),
  /** Off the list by the day asked for; still shown on a day it was ticked. */
  retired: z.boolean(),
  /** The tick on the day asked for, or null. */
  mark: BuildingCheckMarkSchema.nullable(),
}).strict();
export type BuildingCheck = z.infer<typeof BuildingCheckSchema>;

export const BuildingChecksDaySchema = z.object({
  day: CalendarDateSchema,
  opening: z.array(BuildingCheckSchema),
  lockup: z.array(BuildingCheckSchema),
}).strict();
export type BuildingChecksDay = z.infer<typeof BuildingChecksDaySchema>;

export const BuildingChecksDayQuerySchema = z.object({ day: CalendarDateSchema }).strict();

/**
 * One list, as the administrator leaves it: existing checks by id (renamed
 * or moved), new ones without. `expected` is the list as they saw it, so a
 * colleague's newer change is refused rather than overwritten.
 */
export const ReplaceBuildingChecksSchema = z.object({
  expected: z.array(z.uuid()).max(BUILDING_CHECKS_MAX),
  items: z.array(z.object({
    id: z.uuid().optional(),
    label: z.string().trim().min(1, "Write the check").max(BUILDING_CHECK_LABEL_MAX),
  }).strict()).max(BUILDING_CHECKS_MAX),
}).strict().refine((body) => {
  const ids = body.items.flatMap((item) => (item.id === undefined ? [] : [item.id]));
  return new Set(ids).size === ids.length;
}, { message: "A check appears once.", path: ["items"] });
export type ReplaceBuildingChecks = z.input<typeof ReplaceBuildingChecksSchema>;

export const BuildingCheckMarkBodySchema = z.object({ day: CalendarDateSchema }).strict();

/** How long after the board rolls its night may still be ticked: a lock-up past the boundary hour, and the morning's look at it. */
export const BUILDING_TICK_GRACE_MS = 8 * 3_600_000;

/** The board day an instant falls on, on the venue's clock: before its boundary hour, the date before. */
export function buildingBoardDay(ms: number, dayBoundaryHour: number, timeZone: string): string {
  const date = rotaLocalDate(ms, timeZone);
  return rotaMinuteOfDay(ms, timeZone) < dayBoundaryHour * 60 ? addRotaDays(date, -1) : date;
}

/**
 * The board days a check may be ticked on, or a tick taken back, now: the
 * venue's own, and the one before for the grace after the board rolls.
 */
export function buildingTickDays(nowMs: number, dayBoundaryHour: number, timeZone: string): readonly string[] {
  const today = buildingBoardDay(nowMs, dayBoundaryHour, timeZone);
  const night = buildingBoardDay(nowMs - BUILDING_TICK_GRACE_MS, dayBoundaryHour, timeZone);
  return night === today ? [today] : [night, today];
}
