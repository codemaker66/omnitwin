import { and, asc, eq, isNull, isNotNull } from "drizzle-orm";
import { bookings, spaces, users } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { userDisplayName } from "../utils/user-display-name.js";
import { computeHoldReminderInstants, type HoldReminderInstant } from "./hold-hygiene.js";
import { sendEmail, type EmailLogger, type EmailPayload, type SendOptions } from "./email.js";
import { holdDecisionReminder } from "./email-templates.js";

// ---------------------------------------------------------------------------
// Hold-reminder delivery (T-527, Slice 7) — the job the Slice-1 core was
// waiting for. `computeHoldReminderInstants` supplies the T-7/3/1 schedule;
// this module decides which instants are DUE at a given clock and turns
// them into idempotent sends through the house email service.
//
// Design decisions (architecture doc §12):
//   - NO new schema. The email service's `email_sends` UNIQUE idempotency
//     key IS the restart-proof sent-marker: `hold-reminder:{bookingId}:t-{n}`.
//     Re-running a pass re-attempts every due instant; already-sent ones
//     dedupe inside sendEmail (PG 23505 → treated as success).
//   - Freshness window. A due instant older than 24h is SKIPPED, not sent
//     late — "7 days to decide" is misinformation on day 5. The gaps in
//     the T-7/3/1 ladder are ≥ 2 days, so at most one instant is ever due.
//   - Decisions already reached get nothing: overdue-decision comms are a
//     different conversation (hold hygiene's resequence path), not a
//     countdown reminder.
//   - Only the hold's OWNER is emailed — a member of staff, never the client
//     (Blake, 26 September 2026). A due reminder on a hold nobody owns is
//     reported as "no_owner" and sent to no one.
//   - The pass summary carries no email address. It is what the scheduled
//     workflow prints (T-619), and that log is readable by anyone with read
//     access to the repository; the owner's display name identifies them.
//   - Scheduling follows the house cleanup convention: a pure pass invoked
//     from an admin endpoint by an external cron — no in-process timers,
//     nothing to double-fire across replicas (and idempotency would absorb
//     it even if two crons raced).
// ---------------------------------------------------------------------------

export const HOLD_REMINDER_STALE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ReminderHold {
  readonly id: string;
  readonly title: string;
  readonly spaceName: string;
  /** When the provisional booking itself begins — the date it holds. */
  readonly startsAt: Date;
  readonly rank: number | null;
  readonly jointFlag: boolean;
  readonly ownerEmail: string | null;
  readonly ownerName: string | null;
  readonly decisionAt: Date;
}

export interface DueHoldReminder {
  readonly hold: ReminderHold;
  readonly daysBefore: HoldReminderInstant["daysBefore"];
  readonly at: Date;
}

/** The reminders due for one hold at `now`, whoever owns it: instant
 *  passed, still fresh, decision still ahead. */
function dueInstantsFor(hold: ReminderHold, now: Date): readonly DueHoldReminder[] {
  if (now.getTime() >= hold.decisionAt.getTime()) return [];
  const due: DueHoldReminder[] = [];
  for (const instant of computeHoldReminderInstants(hold.decisionAt)) {
    const age = now.getTime() - instant.at.getTime();
    if (age >= 0 && age < HOLD_REMINDER_STALE_WINDOW_MS) {
      due.push({ hold, daysBefore: instant.daysBefore, at: instant.at });
    }
  }
  return due;
}

/** Which reminders are due at `now`: instant passed, still fresh, decision
 *  still ahead, owner reachable. Pure — the job's testable heart. */
export function selectDueHoldReminders(
  holds: readonly ReminderHold[],
  now: Date,
): readonly DueHoldReminder[] {
  return holds.filter((hold) => hold.ownerEmail !== null).flatMap((hold) => dueInstantsFor(hold, now));
}

/** Reminders that would be due if the hold had an owner. Reported so a dry
 *  run shows who will NOT be told; never sent — the client is never the
 *  fallback recipient. */
export function selectOwnerlessDueReminders(
  holds: readonly ReminderHold[],
  now: Date,
): readonly DueHoldReminder[] {
  return holds.filter((hold) => hold.ownerEmail === null).flatMap((hold) => dueInstantsFor(hold, now));
}

export type ReminderOutcome = "sent" | "failed" | "dry_run" | "no_owner";

/** One due reminder as the pass reports it — everything a person checking a
 *  dry run needs, and deliberately no email address (see the module note). */
export interface ReminderRecord {
  readonly bookingId: string;
  readonly holdTitle: string;
  readonly spaceName: string;
  /** Venue-local, e.g. "Saturday 14 November 2026". */
  readonly holdDate: string;
  /** Venue-local, e.g. "Friday 2 October 2026". */
  readonly decisionDate: string;
  readonly daysBefore: HoldReminderInstant["daysBefore"];
  /** The owner's display name; null only when nobody owns the hold. */
  readonly ownerName: string | null;
  readonly idempotencyKey: string;
  readonly outcome: ReminderOutcome;
}

export interface HoldReminderPassSummary {
  readonly scanned: number;
  /** Due reminders with an owner to tell. */
  readonly due: number;
  readonly sent: number;
  readonly failed: number;
  /** Due reminders on holds nobody owns: listed, never sent. */
  readonly noOwner: number;
  readonly dryRun: boolean;
  readonly reminders: readonly ReminderRecord[];
}

/** Structural type of the injected send layer (defaults to the house
 *  sendEmail — tests inject a recorder). */
export type ReminderSend = (payload: EmailPayload, options: SendOptions) => Promise<boolean>;

export interface HoldReminderPassOptions {
  readonly db: Database;
  readonly now?: Date;
  readonly dryRun?: boolean;
  readonly logger?: EmailLogger;
  readonly send?: ReminderSend;
}

/** Venue-local (Europe/London) calendar day, YYYY-MM-DD. Built from
 *  formatToParts so the shape never depends on a locale's string ordering —
 *  this value is embedded in a UNIQUE database key and must be stable
 *  across ICU/CLDR upgrades. */
function londonDay(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/London",
  }).formatToParts(instant);
  const part = (type: "year" | "month" | "day"): string => {
    const found = parts.find((p) => p.type === type);
    if (found === undefined) throw new Error(`Intl part ${type} missing`);
    return found.value;
  };
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole venue-local calendar days from `now` to the decision: 0 on the day
 *  itself, 1 the day before. The email is worded from this, not from the
 *  schedule stage — a once-a-day run can deliver a T-1 reminder on the
 *  decision day, and "tomorrow" would then be untrue. */
export function daysUntilDecision(now: Date, decisionAt: Date): number {
  const dayStart = (instant: Date): number => Date.parse(`${londonDay(instant)}T00:00:00.000Z`);
  return Math.round((dayStart(decisionAt) - dayStart(now)) / DAY_MS);
}

/** The decision DAY is part of the key: hold decision dates move (ladders
 *  resequence, clients renegotiate), and a moved date must earn its own
 *  fresh T-7/3/1 — deduping only repeats for the SAME scheduled decision. */
function reminderIdempotencyKey(bookingId: string, decisionAt: Date, daysBefore: number): string {
  return `hold-reminder:${bookingId}:${londonDay(decisionAt)}:t-${String(daysBefore)}`;
}

const VENUE_DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

/** "Saturday 14 November 2026" in the venue's zone — the house long date.
 *  Assembled from parts: ICU's en-GB pattern inserts a comma after the
 *  weekday, which the house style does not use. A display string, never a
 *  key, so a missing part degrades to the ISO day instead of throwing. */
export function formatVenueDay(instant: Date): string {
  const parts = VENUE_DAY_FORMAT.formatToParts(instant);
  const part = (type: "weekday" | "day" | "month" | "year"): string | undefined =>
    parts.find((p) => p.type === type)?.value;
  const [weekday, day, month, year] = [part("weekday"), part("day"), part("month"), part("year")];
  if (weekday === undefined || day === undefined || month === undefined || year === undefined) {
    return instant.toISOString().slice(0, 10);
  }
  return `${weekday} ${day} ${month} ${year}`;
}

/** Run the delivery pass over an already-fetched hold list. Split from the
 *  DB fetch so the send orchestration is unit-testable end to end. */
export async function runHoldReminderPassOnHolds(
  holds: readonly ReminderHold[],
  options: HoldReminderPassOptions,
): Promise<HoldReminderPassSummary> {
  const { db, logger } = options;
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const send = options.send ?? sendEmail;

  const due = selectDueHoldReminders(holds, now);
  const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5173";

  const reminders: ReminderRecord[] = [];
  let sent = 0;
  let failed = 0;

  const record = (reminder: DueHoldReminder, idempotencyKey: string, outcome: ReminderOutcome): ReminderRecord => ({
    bookingId: reminder.hold.id,
    holdTitle: reminder.hold.title,
    spaceName: reminder.hold.spaceName,
    holdDate: formatVenueDay(reminder.hold.startsAt),
    decisionDate: formatVenueDay(reminder.hold.decisionAt),
    daysBefore: reminder.daysBefore,
    ownerName: reminder.hold.ownerName,
    idempotencyKey,
    outcome,
  });

  for (const reminder of due) {
    // selectDueHoldReminders only passes owner-reachable holds through; if
    // that contract ever loosens, fail LOUDLY rather than silently dropping
    // a reminder the summary already counted as due.
    const to = reminder.hold.ownerEmail;
    if (to === null) {
      logger?.error(
        { event: "hold_reminder_unreachable_owner", bookingId: reminder.hold.id },
        "due reminder reached the send loop without an owner email — selectDueHoldReminders contract violated",
      );
      failed += 1;
      continue;
    }
    // Everything per-reminder — key derivation, render, send — sits inside
    // one try: a single bad reminder must never starve the rest of the pass.
    let idempotencyKey = `hold-reminder:${reminder.hold.id}:unkeyed`;
    let outcome: ReminderOutcome = "failed";
    try {
      idempotencyKey = reminderIdempotencyKey(
        reminder.hold.id,
        reminder.hold.decisionAt,
        reminder.daysBefore,
      );

      if (dryRun) {
        reminders.push(record(reminder, idempotencyKey, "dry_run"));
        continue;
      }

      const { subject, html } = await holdDecisionReminder({
        holdTitle: reminder.hold.title,
        spaceName: reminder.hold.spaceName,
        ownerName: reminder.hold.ownerName,
        holdDate: formatVenueDay(reminder.hold.startsAt),
        decisionDate: formatVenueDay(reminder.hold.decisionAt),
        daysUntilDecision: daysUntilDecision(now, reminder.hold.decisionAt),
        rank: reminder.hold.rank,
        jointFlag: reminder.hold.jointFlag,
        // The week the hold sits in, so the link opens where the booking is.
        diaryUrl: `${frontendUrl}/diary?view=week&date=${londonDay(reminder.hold.startsAt)}`,
      });
      const ok = await send({ to, subject, html }, { db, idempotencyKey, logger });
      outcome = ok ? "sent" : "failed";
    } catch (err) {
      logger?.error(
        { event: "hold_reminder_failed", idempotencyKey, error: err instanceof Error ? err.message : String(err) },
        "hold reminder send threw",
      );
      outcome = "failed";
    }

    if (outcome === "sent") sent += 1;
    else failed += 1;
    reminders.push(record(reminder, idempotencyKey, outcome));
  }

  // Nobody owns these holds, so nobody is told — and the client is never the
  // fallback. Listed so a dry run shows the gap before the schedule is on.
  const ownerless = selectOwnerlessDueReminders(holds, now);
  for (const reminder of ownerless) {
    reminders.push(record(
      reminder,
      reminderIdempotencyKey(reminder.hold.id, reminder.hold.decisionAt, reminder.daysBefore),
      "no_owner",
    ));
  }

  return { scanned: holds.length, due: due.length, sent, failed, noOwner: ownerless.length, dryRun, reminders };
}

/** Fetch every active hold with a decision date, then run the delivery pass
 *  — most urgent decision first, so sends and the summary share one order.
 *  Invoked from POST /admin/diary/hold-reminders. */
export async function runHoldReminderPass(
  options: HoldReminderPassOptions,
): Promise<HoldReminderPassSummary> {
  const rows = await options.db
    .select({
      id: bookings.id,
      title: bookings.title,
      spaceName: spaces.name,
      startsAt: bookings.startsAt,
      rank: bookings.rank,
      jointFlag: bookings.jointFlag,
      ownerEmail: users.email,
      ownerName: userDisplayName,
      decisionAt: bookings.decisionAt,
    })
    .from(bookings)
    .innerJoin(spaces, eq(bookings.spaceId, spaces.id))
    // LEFT join — ownerUserId is nullable (and ON DELETE SET NULL), and an
    // ownerless hold must still appear in `scanned` so the summary is an
    // honest count; selectDueHoldReminders then skips it as unreachable and
    // the summary lists its due reminder as "no_owner" (the
    // configuration-reviews.ts changed_by precedent).
    .leftJoin(users, eq(bookings.ownerUserId, users.id))
    .where(
      and(
        eq(bookings.kind, "hold"),
        eq(bookings.status, "active"),
        isNull(bookings.deletedAt),
        isNotNull(bookings.decisionAt),
      ),
    )
    .orderBy(asc(bookings.decisionAt), asc(bookings.id));

  const holds: ReminderHold[] = rows
    .filter((row): row is typeof row & { decisionAt: Date } => row.decisionAt !== null)
    .map((row) => ({
      id: row.id,
      title: row.title,
      spaceName: row.spaceName,
      startsAt: row.startsAt,
      rank: row.rank,
      jointFlag: row.jointFlag,
      ownerEmail: row.ownerEmail,
      ownerName: row.ownerName,
      decisionAt: row.decisionAt,
    }));

  return runHoldReminderPassOnHolds(holds, options);
}
