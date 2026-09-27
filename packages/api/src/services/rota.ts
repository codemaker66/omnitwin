import { and, asc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import {
  ROTA_ROLE_NOUNS,
  RotaKeptWarningSchema,
  addRotaDays,
  checkRotaWorkingTime,
  rotaClock,
  rotaDayMonth,
  rotaInstant,
  rotaLocalDate,
  rotaLongDay,
  rotaNoticeHours,
  rotaPublishBlocks,
  rotaSaveBlocks,
  rotaWeekBounds,
  rotaWeekStartOf,
  rotaWeekdayName,
  toEventPlanAudienceRole,
  withKeptWarnings,
  type CreateRotaShift,
  type CreateStaffMemberBody,
  type CreateStaffUnavailability,
  type EventPlanNotificationSeverity,
  type RotaAccess,
  type RotaFinding,
  type RotaIssue,
  type RotaKeptWarning,
  type RotaPerson,
  type RotaShift,
  type RotaWarningCode,
  type RotaWeek,
  type StaffRecord,
  type StaffUnavailability,
  type UpdateRotaShift,
  type UpdateStaffMemberBody,
} from "@omnitwin/types";
import {
  eventPlanNotifications,
  events,
  rotaShiftChanges,
  rotaShifts,
  spaces,
  staffMembers,
  staffUnavailability,
  users,
  venues,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { canManageCommercial, canManageVenue } from "../utils/query.js";

// ---------------------------------------------------------------------------
// The staff rota, version 1 (T-637 slice B): reads, checks and writes.
//
// The routes authorise; this module keeps the rota's promises:
//   - every row is read and written inside its venue, and a person, event or
//     room named on a shift must belong to that venue;
//   - an edit made from a stale copy never overwrites a newer one: the
//     revision the editor saw sits in the UPDATE's own WHERE;
//   - publishing, and every change or cancellation after it, records who,
//     when and the notice given, and tells the people on the shift in the
//     app, in the same transaction as the change itself;
//   - the only hard blocks are the legal ones (staff-rota-checks.ts).
// ---------------------------------------------------------------------------

export type RotaConn = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

type ShiftRow = typeof rotaShifts.$inferSelect;
type StaffRow = typeof staffMembers.$inferSelect;

interface Actor {
  readonly id: string;
  readonly name: string;
}

/** Weeks of history the 48-hour average reads before the week in question. */
const HISTORY_WEEKS = 16;

/** Where a rota notification takes its reader. */
export function rotaActionPath(weekStart: string): string {
  return `/dashboard?view=rota&week=${weekStart}`;
}

/**
 * The venue's own team: everyone on the floor and everyone who works its
 * commercial side. Only their accounts may be linked to a person on the rota,
 * and only they are sent to the Rota view from a notification. Read through
 * the capability helpers with no platform role, so a Venviewer operator's
 * account is judged by its venue role like anyone else's.
 */
export function isVenueTeamRole(role: string, userVenueId: string | null, venueId: string): boolean {
  const member = { role, venueId: userVenueId, platformRole: "none" as const };
  return canManageVenue(member, venueId) || canManageCommercial(member, venueId);
}

export async function venueTimeZone(conn: RotaConn, venueId: string): Promise<string | null> {
  const [venue] = await conn.select({ timezone: venues.timezone }).from(venues)
    .where(and(eq(venues.id, venueId), isNull(venues.deletedAt)))
    .limit(1);
  return venue?.timezone ?? null;
}

// ---------------------------------------------------------------------------
// Shapes the API sends
// ---------------------------------------------------------------------------

const SHIFT_COLUMNS = {
  shift: rotaShifts,
  eventName: events.name,
  eventDeletedAt: events.deletedAt,
  spaceName: spaces.name,
  spaceDeletedAt: spaces.deletedAt,
  updatedByName: users.name,
};

interface ShiftWithNames {
  readonly shift: ShiftRow;
  readonly eventName: string | null;
  readonly eventDeletedAt: Date | null;
  readonly spaceName: string | null;
  readonly spaceDeletedAt: Date | null;
  readonly updatedByName: string | null;
}

function shiftsWithNames(conn: RotaConn) {
  return conn.select(SHIFT_COLUMNS)
    .from(rotaShifts)
    .leftJoin(events, and(eq(events.id, rotaShifts.eventId), eq(events.venueId, rotaShifts.venueId)))
    .leftJoin(spaces, and(eq(spaces.id, rotaShifts.spaceId), eq(spaces.venueId, rotaShifts.venueId)))
    .leftJoin(users, eq(users.id, rotaShifts.updatedBy));
}

export async function loadShift(conn: RotaConn, venueId: string, shiftId: string): Promise<ShiftWithNames | null> {
  const [row] = await shiftsWithNames(conn)
    .where(and(eq(rotaShifts.id, shiftId), eq(rotaShifts.venueId, venueId)))
    .limit(1);
  return row ?? null;
}

function keptWarnings(row: ShiftRow): readonly RotaKeptWarning[] {
  const parsed = RotaKeptWarningSchema.array().safeParse(row.keptWarnings);
  return parsed.success ? parsed.data : [];
}

export function serializeShift(row: ShiftWithNames, findings: readonly RotaFinding[] | null): RotaShift {
  const { shift } = row;
  const issues: RotaIssue[] = findings === null ? [] : [...withKeptWarnings(findings, keptWarnings(shift))];
  return {
    id: shift.id,
    venueId: shift.venueId,
    staffMemberId: shift.staffMemberId,
    role: shift.role,
    startsAt: shift.startsAt.toISOString(),
    endsAt: shift.endsAt.toISOString(),
    breakMinutes: shift.breakMinutes,
    eventId: shift.eventId,
    eventName: row.eventDeletedAt === null ? row.eventName : null,
    spaceId: shift.spaceId,
    spaceName: row.spaceDeletedAt === null ? row.spaceName : null,
    note: shift.note,
    status: shift.status,
    revision: shift.revision,
    publishedAt: shift.publishedAt?.toISOString() ?? null,
    cancelledAt: shift.cancelledAt?.toISOString() ?? null,
    cancellationNoticeHours: shift.cancellationNoticeHours,
    updatedAt: shift.updatedAt.toISOString(),
    updatedByName: row.updatedByName,
    issues,
  };
}

interface StaffWithAccount {
  readonly person: StaffRow;
  readonly accountName: string | null;
  readonly accountEmail: string | null;
}

function staffWithAccounts(conn: RotaConn) {
  // The link counts only while the account still belongs to this venue.
  return conn.select({ person: staffMembers, accountName: users.name, accountEmail: users.email })
    .from(staffMembers)
    .leftJoin(users, and(eq(users.id, staffMembers.userId), eq(users.venueId, staffMembers.venueId)));
}

export async function loadStaffMember(conn: RotaConn, venueId: string, id: string): Promise<StaffWithAccount | null> {
  const [row] = await staffWithAccounts(conn)
    .where(and(eq(staffMembers.id, id), eq(staffMembers.venueId, venueId)))
    .limit(1);
  return row ?? null;
}

export function serializeRecord(row: StaffWithAccount): StaffRecord {
  const { person } = row;
  return {
    id: person.id,
    venueId: person.venueId,
    userId: person.userId,
    account: row.accountName === null || row.accountEmail === null ? null : { name: row.accountName, email: row.accountEmail },
    displayName: person.displayName,
    email: person.email,
    phone: person.phone,
    employmentType: person.employmentType,
    skills: [...person.skills],
    barTrainedOn: person.barTrainedOn,
    turns18On: person.turns18On,
    rightToWorkCheckedOn: person.rightToWorkCheckedOn,
    rightToWorkExpiresOn: person.rightToWorkExpiresOn,
    workingTimeOptOut: person.workingTimeOptOut,
    isActive: person.isActive,
    revision: person.revision,
    updatedAt: person.updatedAt.toISOString(),
  };
}

function serializePerson(row: StaffWithAccount): RotaPerson {
  return {
    id: row.person.id,
    displayName: row.person.displayName,
    employmentType: row.person.employmentType,
    skills: [...row.person.skills],
    isActive: row.person.isActive,
    hasAccount: row.accountName !== null,
  };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * Findings for every shift of these people around a stretch of time: their
 * shifts from sixteen weeks before its week (for the 48-hour average) to a
 * week after (for rest into the next week), and their leave and
 * unavailability across it.
 */
export async function findingsFor(
  conn: RotaConn,
  venueId: string,
  timeZone: string,
  people: readonly StaffRow[],
  around: { readonly fromMs: number; readonly toMs: number },
  extra: readonly ShiftRow[] = [],
): Promise<Map<string, readonly RotaFinding[]>> {
  const found = new Map<string, readonly RotaFinding[]>();
  if (people.length === 0) return found;
  const ids = people.map((person) => person.id);
  const firstWeek = rotaWeekStartOf(around.fromMs, timeZone);
  const lastWeek = rotaWeekStartOf(around.toMs - 1, timeZone);
  const contextFrom = new Date(rotaInstant(addRotaDays(firstWeek, -7 * HISTORY_WEEKS), 0, timeZone));
  const contextTo = new Date(rotaInstant(addRotaDays(lastWeek, 14), 0, timeZone));

  const [shifts, absences] = await Promise.all([
    conn.select().from(rotaShifts).where(and(
      eq(rotaShifts.venueId, venueId),
      inArray(rotaShifts.staffMemberId, ids),
      ne(rotaShifts.status, "cancelled"),
      lt(rotaShifts.startsAt, contextTo),
      gt(rotaShifts.endsAt, contextFrom),
    )),
    conn.select().from(staffUnavailability).where(and(
      eq(staffUnavailability.venueId, venueId),
      inArray(staffUnavailability.staffMemberId, ids),
      lt(staffUnavailability.startsAt, contextTo),
      gt(staffUnavailability.endsAt, contextFrom),
    )),
  ]);

  // A shift not yet saved (or about to change) replaces its stored copy.
  const byId = new Map(shifts.map((shift) => [shift.id, shift]));
  for (const shift of extra) byId.set(shift.id, shift);

  for (const person of people) {
    const mine = [...byId.values()].filter((shift) => shift.staffMemberId === person.id);
    if (mine.length === 0) continue;
    const results = checkRotaWorkingTime({
      person,
      timeZone,
      shifts: mine.map((shift) => ({
        id: shift.id,
        role: shift.role,
        startsAt: shift.startsAt.toISOString(),
        endsAt: shift.endsAt.toISOString(),
        breakMinutes: shift.breakMinutes,
        status: shift.status,
      })),
      absences: absences
        .filter((absence) => absence.staffMemberId === person.id)
        .map((absence) => ({ startsAt: absence.startsAt.toISOString(), endsAt: absence.endsAt.toISOString(), reason: absence.reason })),
    });
    for (const [shiftId, findings] of results) found.set(shiftId, findings);
  }
  return found;
}

function weekAround(shift: Pick<ShiftRow, "startsAt">, timeZone: string): { readonly fromMs: number; readonly toMs: number } {
  return rotaWeekBounds(rotaWeekStartOf(shift.startsAt.getTime(), timeZone), timeZone);
}

/** One shift as the API sends it, with its findings for a manager. */
export async function shiftForManager(conn: RotaConn, venueId: string, timeZone: string, row: ShiftWithNames): Promise<RotaShift> {
  if (row.shift.staffMemberId === null) return serializeShift(row, []);
  const [person] = await conn.select().from(staffMembers)
    .where(and(eq(staffMembers.id, row.shift.staffMemberId), eq(staffMembers.venueId, venueId)))
    .limit(1);
  if (person === undefined) return serializeShift(row, []);
  const found = await findingsFor(conn, venueId, timeZone, [person], weekAround(row.shift, timeZone));
  return serializeShift(row, found.get(row.shift.id) ?? []);
}

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

export async function loadRotaWeek(
  db: Database,
  input: {
    readonly venueId: string;
    readonly timeZone: string;
    readonly weekStart: string;
    readonly access: RotaAccess;
    readonly viewerId: string;
  },
): Promise<RotaWeek> {
  const { venueId, timeZone, weekStart, access } = input;
  const { fromMs, toMs } = rotaWeekBounds(weekStart, timeZone);
  const from = new Date(fromMs);
  const to = new Date(toMs);

  const records = await staffWithAccounts(db)
    .where(access === "own"
      ? and(eq(staffMembers.venueId, venueId), eq(staffMembers.userId, input.viewerId))
      : eq(staffMembers.venueId, venueId))
    .orderBy(asc(staffMembers.displayName), asc(staffMembers.id));
  const recordIds = records.map((row) => row.person.id);

  // Someone outside the floor sees only their own shifts; if they are on no
  // record, there is nothing of theirs to read.
  const nothingOfTheirs = access === "own" && recordIds.length === 0;
  const shiftRows: ShiftWithNames[] = nothingOfTheirs ? [] : await shiftsWithNames(db)
    .where(and(
      eq(rotaShifts.venueId, venueId),
      lt(rotaShifts.startsAt, to),
      gt(rotaShifts.endsAt, from),
      access === "manage" ? undefined : inArray(rotaShifts.status, ["published", "cancelled"]),
      access === "own" ? inArray(rotaShifts.staffMemberId, recordIds) : undefined,
    ))
    .orderBy(asc(rotaShifts.startsAt), asc(rotaShifts.id));

  let findings = new Map<string, readonly RotaFinding[]>();
  if (access === "manage") {
    const onShift = new Set(shiftRows.map((row) => row.shift.staffMemberId));
    findings = await findingsFor(db, venueId, timeZone,
      records.filter((row) => onShift.has(row.person.id)).map((row) => row.person), { fromMs, toMs });
  }

  const absenceFrom = new Date(fromMs - 86_400_000);
  const absenceTo = new Date(toMs + 86_400_000);
  const absences = access === "read" || nothingOfTheirs ? [] : await db.select().from(staffUnavailability)
    .where(and(
      eq(staffUnavailability.venueId, venueId),
      lt(staffUnavailability.startsAt, absenceTo),
      gt(staffUnavailability.endsAt, absenceFrom),
      access === "own" ? inArray(staffUnavailability.staffMemberId, recordIds) : undefined,
    ))
    .orderBy(asc(staffUnavailability.startsAt), asc(staffUnavailability.id));

  let rooms: { id: string; name: string }[] = [];
  let accounts: { id: string; name: string; email: string; role: string; venueId: string | null }[] = [];
  if (access === "manage") {
    [rooms, accounts] = await Promise.all([
      db.select({ id: spaces.id, name: spaces.name }).from(spaces)
        .where(and(eq(spaces.venueId, venueId), isNull(spaces.deletedAt)))
        .orderBy(asc(spaces.sortOrder), asc(spaces.name)),
      db.select({ id: users.id, name: users.name, email: users.email, role: users.role, venueId: users.venueId }).from(users)
        .where(eq(users.venueId, venueId))
        .orderBy(asc(users.name), asc(users.id)),
    ]);
  }

  const onShift = new Set(shiftRows.map((row) => row.shift.staffMemberId));
  const people = records.filter((row) => access === "own" || row.person.isActive || onShift.has(row.person.id));

  return {
    venueId,
    timeZone,
    weekStart,
    from: from.toISOString(),
    to: to.toISOString(),
    access,
    people: people.map(serializePerson),
    records: access === "manage" ? records.map(serializeRecord) : [],
    shifts: shiftRows.map((row) => serializeShift(row, access === "manage" ? findings.get(row.shift.id) ?? [] : null)),
    unavailability: absences.map((absence): StaffUnavailability => ({
      id: absence.id,
      staffMemberId: absence.staffMemberId,
      startsAt: absence.startsAt.toISOString(),
      endsAt: absence.endsAt.toISOString(),
      reason: absence.reason,
      note: absence.note,
    })),
    rooms,
    accounts: accounts
      .filter((account) => isVenueTeamRole(account.role, account.venueId, venueId))
      .map(({ id, name, email }) => ({ id, name, email })),
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

interface PersonNotice {
  readonly staffMemberId: string;
  readonly title: string;
  readonly body: string;
  readonly severity: EventPlanNotificationSeverity;
}

function bounded(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/** "Saturday 10 October, 08:00 to 16:00, set-up, Grand Hall". */
export function rotaShiftLine(
  shift: Pick<ShiftRow, "startsAt" | "endsAt" | "role">,
  spaceName: string | null,
  timeZone: string,
): string {
  const date = rotaLocalDate(shift.startsAt.getTime(), timeZone);
  const parts = [
    rotaLongDay(date),
    `${rotaClock(shift.startsAt.getTime(), timeZone)} to ${rotaClock(shift.endsAt.getTime(), timeZone)}`,
    ROTA_ROLE_NOUNS[shift.role],
  ];
  if (spaceName !== null) parts.push(spaceName);
  return parts.join(", ");
}

/**
 * One in-app notification per person, for those whose account still belongs
 * to the venue. Returns how many people were told.
 */
async function notifyPeople(conn: RotaConn, venueId: string, weekStart: string, notices: readonly PersonNotice[]): Promise<number> {
  if (notices.length === 0) return 0;
  const linked = await conn.select({ staffMemberId: staffMembers.id, userId: users.id, role: users.role, userVenueId: users.venueId })
    .from(staffMembers)
    .innerJoin(users, and(eq(users.id, staffMembers.userId), eq(users.venueId, staffMembers.venueId)))
    .where(and(eq(staffMembers.venueId, venueId), inArray(staffMembers.id, notices.map((notice) => notice.staffMemberId))));
  const accounts = new Map(linked.map((row) => [row.staffMemberId, row]));
  const rows = notices.flatMap((notice) => {
    const account = accounts.get(notice.staffMemberId);
    if (account === undefined) return [];
    return [{
      changeId: null,
      eventId: null,
      venueId,
      audienceRole: toEventPlanAudienceRole(account.role),
      recipientUserId: account.userId,
      title: bounded(notice.title, 180),
      body: bounded(notice.body, 1000),
      severity: notice.severity,
      actionPath: isVenueTeamRole(account.role, account.userVenueId, venueId) ? rotaActionPath(weekStart) : null,
    }];
  });
  if (rows.length > 0) await conn.insert(eventPlanNotifications).values(rows);
  return rows.length;
}

function snapshot(row: ShiftRow) {
  return {
    staffMemberId: row.staffMemberId,
    role: row.role,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    breakMinutes: row.breakMinutes,
    spaceId: row.spaceId,
    eventId: row.eventId,
    note: row.note,
    status: row.status,
  };
}

/** "30 hours before it was due to start", from the real times. */
function noticeWords(changedAtMs: number, startsAtMs: number): string {
  if (startsAtMs <= changedAtMs) return "after it had started";
  const hours = rotaNoticeHours(changedAtMs, startsAtMs);
  if (hours === 0) return "less than an hour before it was due to start";
  return `${String(hours)} ${hours === 1 ? "hour" : "hours"} before it was due to start`;
}

async function spaceName(conn: RotaConn, venueId: string, spaceId: string | null): Promise<string | null> {
  if (spaceId === null) return null;
  const [space] = await conn.select({ name: spaces.name }).from(spaces)
    .where(and(eq(spaces.id, spaceId), eq(spaces.venueId, venueId), isNull(spaces.deletedAt)))
    .limit(1);
  return space?.name ?? null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type ReferenceProblem =
  | { readonly kind: "person_not_found" }
  | { readonly kind: "person_inactive"; readonly name: string }
  | { readonly kind: "event_not_found" }
  | { readonly kind: "room_not_found" };

/** Everything a shift names must belong to its venue; a person must still
 *  be on the rota to be given new work. */
async function checkReferences(
  conn: RotaConn,
  venueId: string,
  refs: { readonly staffMemberId: string | null; readonly eventId: string | null; readonly spaceId: string | null },
  unchangedPersonId: string | null,
): Promise<{ readonly person: StaffRow | null; readonly problem: ReferenceProblem | null }> {
  let person: StaffRow | null = null;
  if (refs.staffMemberId !== null) {
    const [row] = await conn.select().from(staffMembers)
      .where(and(eq(staffMembers.id, refs.staffMemberId), eq(staffMembers.venueId, venueId)))
      .limit(1);
    if (row === undefined) return { person: null, problem: { kind: "person_not_found" } };
    if (!row.isActive && row.id !== unchangedPersonId) {
      return { person: row, problem: { kind: "person_inactive", name: row.displayName } };
    }
    person = row;
  }
  if (refs.eventId !== null) {
    const [event] = await conn.select({ id: events.id }).from(events)
      .where(and(eq(events.id, refs.eventId), eq(events.venueId, venueId), isNull(events.deletedAt)))
      .limit(1);
    if (event === undefined) return { person, problem: { kind: "event_not_found" } };
  }
  if (refs.spaceId !== null) {
    const [space] = await conn.select({ id: spaces.id }).from(spaces)
      .where(and(eq(spaces.id, refs.spaceId), eq(spaces.venueId, venueId), isNull(spaces.deletedAt)))
      .limit(1);
    if (space === undefined) return { person, problem: { kind: "room_not_found" } };
  }
  return { person, problem: null };
}

/** The legal block that stops a shift being saved: an under-18 between
 *  midnight and 04:00. */
function saveBlock(person: StaffRow | null, shift: ShiftRow, timeZone: string): RotaFinding | null {
  if (person === null) return null;
  const found = checkRotaWorkingTime({
    person,
    timeZone,
    absences: [],
    shifts: [{
      id: shift.id, role: shift.role, startsAt: shift.startsAt.toISOString(), endsAt: shift.endsAt.toISOString(),
      breakMinutes: shift.breakMinutes, status: shift.status,
    }],
  });
  return rotaSaveBlocks(found.get(shift.id) ?? [])[0] ?? null;
}

export type CreateShiftOutcome =
  | { readonly kind: "created"; readonly shift: RotaShift }
  | { readonly kind: "reference"; readonly problem: ReferenceProblem }
  | { readonly kind: "blocked"; readonly finding: RotaFinding };

export async function createRotaShift(
  db: Database,
  input: { readonly venueId: string; readonly timeZone: string; readonly body: CreateRotaShift; readonly actor: Actor },
): Promise<CreateShiftOutcome> {
  const { venueId, timeZone, body, actor } = input;
  const refs = await checkReferences(db, venueId, body, null);
  if (refs.problem !== null) return { kind: "reference", problem: refs.problem };
  const now = new Date();
  const candidate: ShiftRow = {
    id: "00000000-0000-4000-8000-000000000000",
    venueId,
    staffMemberId: body.staffMemberId,
    role: body.role,
    startsAt: new Date(body.startsAt),
    endsAt: new Date(body.endsAt),
    breakMinutes: body.breakMinutes,
    eventId: body.eventId,
    spaceId: body.spaceId,
    note: body.note,
    status: "draft",
    keptWarnings: [],
    revision: 1,
    createdBy: actor.id,
    updatedBy: actor.id,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    cancelledAt: null,
    cancellationNoticeHours: null,
  };
  const blocked = saveBlock(refs.person, candidate, timeZone);
  if (blocked !== null) return { kind: "blocked", finding: blocked };

  const [created] = await db.insert(rotaShifts).values({
    venueId,
    staffMemberId: body.staffMemberId,
    role: body.role,
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    breakMinutes: body.breakMinutes,
    eventId: body.eventId,
    spaceId: body.spaceId,
    note: body.note,
    status: "draft",
    createdBy: actor.id,
    updatedBy: actor.id,
    createdAt: now,
    updatedAt: now,
  }).returning({ id: rotaShifts.id });
  if (created === undefined) throw new Error("The shift was not saved");
  const row = await loadShift(db, venueId, created.id);
  if (row === null) throw new Error("The shift could not be read back");
  return { kind: "created", shift: await shiftForManager(db, venueId, timeZone, row) };
}

export type ChangeShiftOutcome =
  | { readonly kind: "changed"; readonly shift: RotaShift }
  | { readonly kind: "not_found" }
  | { readonly kind: "stale"; readonly shift: RotaShift }
  | { readonly kind: "cancelled"; readonly shift: RotaShift }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "reference"; readonly problem: ReferenceProblem }
  | { readonly kind: "blocked"; readonly finding: RotaFinding };

const MATERIAL_FIELDS = ["staffMemberId", "role", "startsAt", "endsAt", "breakMinutes"] as const;

export async function updateRotaShift(
  db: Database,
  input: {
    readonly venueId: string;
    readonly timeZone: string;
    readonly shiftId: string;
    readonly body: UpdateRotaShift;
    readonly actor: Actor;
  },
): Promise<ChangeShiftOutcome> {
  const { venueId, timeZone, shiftId, body, actor } = input;
  const current = await loadShift(db, venueId, shiftId);
  if (current === null) return { kind: "not_found" };
  const before = current.shift;
  if (before.status === "cancelled") return { kind: "cancelled", shift: serializeShift(current, []) };
  if (before.revision !== body.expectedRevision) {
    return { kind: "stale", shift: await shiftForManager(db, venueId, timeZone, current) };
  }

  const next: ShiftRow = {
    ...before,
    staffMemberId: body.staffMemberId === undefined ? before.staffMemberId : body.staffMemberId,
    role: body.role ?? before.role,
    startsAt: body.startsAt === undefined ? before.startsAt : new Date(body.startsAt),
    endsAt: body.endsAt === undefined ? before.endsAt : new Date(body.endsAt),
    breakMinutes: body.breakMinutes ?? before.breakMinutes,
    eventId: body.eventId === undefined ? before.eventId : body.eventId,
    spaceId: body.spaceId === undefined ? before.spaceId : body.spaceId,
    note: body.note === undefined ? before.note : body.note,
  };
  const minutes = (next.endsAt.getTime() - next.startsAt.getTime()) / 60_000;
  if (!(minutes > 0) || minutes > 24 * 60) return { kind: "invalid", message: "A shift ends after it starts, within 24 hours." };
  if (next.breakMinutes >= minutes) return { kind: "invalid", message: "The break is shorter than the shift." };

  const refs = await checkReferences(db, venueId, next, before.staffMemberId);
  if (refs.problem !== null) return { kind: "reference", problem: refs.problem };
  const blocked = saveBlock(refs.person, next, timeZone);
  if (blocked !== null) return { kind: "blocked", finding: blocked };

  const material = MATERIAL_FIELDS.some((field) => {
    const left = before[field];
    const right = next[field];
    return left instanceof Date && right instanceof Date ? left.getTime() !== right.getTime() : left !== right;
  });
  const moved = next.staffMemberId !== before.staffMemberId || next.spaceId !== before.spaceId;
  const now = new Date();

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(rotaShifts).set({
      staffMemberId: next.staffMemberId,
      role: next.role,
      startsAt: next.startsAt,
      endsAt: next.endsAt,
      breakMinutes: next.breakMinutes,
      eventId: next.eventId,
      spaceId: next.spaceId,
      note: next.note,
      // A reason kept for the old arrangement says nothing about the new one.
      ...(material ? { keptWarnings: [] } : {}),
      revision: sql`${rotaShifts.revision} + 1`,
      updatedBy: actor.id,
      updatedAt: now,
    }).where(and(
      eq(rotaShifts.id, shiftId),
      eq(rotaShifts.venueId, venueId),
      eq(rotaShifts.revision, body.expectedRevision),
      eq(rotaShifts.status, before.status),
    )).returning();
    if (row === undefined) return null;

    if (before.status === "published") {
      const noticeHours = rotaNoticeHours(now.getTime(), before.startsAt.getTime());
      await tx.insert(rotaShiftChanges).values({
        venueId, shiftId, kind: "changed", changedBy: actor.id, changedAt: now, noticeHours,
        before: snapshot(before), after: snapshot(row),
      });
      if (material || moved) {
        const weekStart = rotaWeekStartOf(row.startsAt.getTime(), timeZone);
        const room = await spaceName(tx, venueId, row.spaceId);
        const day = rotaWeekdayName(rotaLocalDate(before.startsAt.getTime(), timeZone));
        const notices: PersonNotice[] = [];
        const wasLine = rotaShiftLine(before, current.spaceName, timeZone);
        const nowLine = rotaShiftLine(row, room, timeZone);
        if (before.staffMemberId !== row.staffMemberId) {
          if (before.staffMemberId !== null) {
            notices.push({
              staffMemberId: before.staffMemberId, severity: "attention",
              title: `You are no longer on ${day}'s ${ROTA_ROLE_NOUNS[before.role]}`,
              body: `${wasLine}. Changed by ${actor.name}, ${noticeWords(now.getTime(), before.startsAt.getTime())}.`,
            });
          }
          if (row.staffMemberId !== null) {
            notices.push({
              staffMemberId: row.staffMemberId, severity: "attention",
              title: `You have a new shift on ${rotaWeekdayName(rotaLocalDate(row.startsAt.getTime(), timeZone))}`,
              body: `${nowLine}. Added by ${actor.name}.`,
            });
          }
        } else if (row.staffMemberId !== null) {
          notices.push({
            staffMemberId: row.staffMemberId, severity: "attention",
            title: `Your ${day} shift has changed`,
            body: `Now ${nowLine}. It was ${wasLine}. Changed by ${actor.name}, ${noticeWords(now.getTime(), before.startsAt.getTime())}.`,
          });
        }
        await notifyPeople(tx, venueId, weekStart, notices);
      }
    }
    return row;
  });

  const after = await loadShift(db, venueId, shiftId);
  if (after === null) return { kind: "not_found" };
  if (updated === null) {
    if (after.shift.status === "cancelled") return { kind: "cancelled", shift: serializeShift(after, []) };
    return { kind: "stale", shift: await shiftForManager(db, venueId, timeZone, after) };
  }
  return { kind: "changed", shift: await shiftForManager(db, venueId, timeZone, after) };
}

export type RemoveShiftOutcome =
  | { readonly kind: "removed" }
  | { readonly kind: "not_found" }
  | { readonly kind: "published"; readonly shift: RotaShift }
  | { readonly kind: "stale"; readonly shift: RotaShift };

/** A draft nobody has been told about is removed outright. */
export async function removeDraftShift(
  db: Database,
  input: { readonly venueId: string; readonly timeZone: string; readonly shiftId: string; readonly expectedRevision: number },
): Promise<RemoveShiftOutcome> {
  const { venueId, timeZone, shiftId, expectedRevision } = input;
  const [removed] = await db.delete(rotaShifts).where(and(
    eq(rotaShifts.id, shiftId),
    eq(rotaShifts.venueId, venueId),
    eq(rotaShifts.status, "draft"),
    eq(rotaShifts.revision, expectedRevision),
  )).returning({ id: rotaShifts.id });
  if (removed !== undefined) return { kind: "removed" };
  const current = await loadShift(db, venueId, shiftId);
  if (current === null) return { kind: "not_found" };
  if (current.shift.status !== "draft") return { kind: "published", shift: await shiftForManager(db, venueId, timeZone, current) };
  return { kind: "stale", shift: await shiftForManager(db, venueId, timeZone, current) };
}

export type CancelShiftOutcome =
  | { readonly kind: "cancelled"; readonly shift: RotaShift; readonly told: boolean }
  | { readonly kind: "not_found" }
  | { readonly kind: "draft"; readonly shift: RotaShift }
  | { readonly kind: "stale"; readonly shift: RotaShift };

/** A published shift is cancelled, never removed: the person was told of it,
 *  so they are told of this, and the notice they had is recorded. */
export async function cancelPublishedShift(
  db: Database,
  input: { readonly venueId: string; readonly timeZone: string; readonly shiftId: string; readonly expectedRevision: number; readonly actor: Actor },
): Promise<CancelShiftOutcome> {
  const { venueId, timeZone, shiftId, expectedRevision, actor } = input;
  const current = await loadShift(db, venueId, shiftId);
  if (current === null) return { kind: "not_found" };
  if (current.shift.status === "draft") return { kind: "draft", shift: await shiftForManager(db, venueId, timeZone, current) };
  const now = new Date();
  const noticeHours = rotaNoticeHours(now.getTime(), current.shift.startsAt.getTime());

  const result = await db.transaction(async (tx) => {
    const [row] = await tx.update(rotaShifts).set({
      status: "cancelled",
      cancelledAt: now,
      cancellationNoticeHours: noticeHours,
      revision: sql`${rotaShifts.revision} + 1`,
      updatedBy: actor.id,
      updatedAt: now,
    }).where(and(
      eq(rotaShifts.id, shiftId),
      eq(rotaShifts.venueId, venueId),
      eq(rotaShifts.status, "published"),
      eq(rotaShifts.revision, expectedRevision),
    )).returning();
    if (row === undefined) return null;
    await tx.insert(rotaShiftChanges).values({
      venueId, shiftId, kind: "cancelled", changedBy: actor.id, changedAt: now, noticeHours,
      before: snapshot(current.shift), after: null,
    });
    let told = 0;
    if (row.staffMemberId !== null) {
      const day = rotaWeekdayName(rotaLocalDate(row.startsAt.getTime(), timeZone));
      told = await notifyPeople(tx, venueId, rotaWeekStartOf(row.startsAt.getTime(), timeZone), [{
        staffMemberId: row.staffMemberId, severity: "attention",
        title: `Your ${day} shift is cancelled`,
        body: `${rotaShiftLine(row, current.spaceName, timeZone)}. Cancelled by ${actor.name}, ${noticeWords(now.getTime(), current.shift.startsAt.getTime())}.`,
      }]);
    }
    return { told: told > 0 };
  });

  const after = await loadShift(db, venueId, shiftId);
  if (after === null) return { kind: "not_found" };
  if (result === null) return { kind: "stale", shift: await shiftForManager(db, venueId, timeZone, after) };
  return { kind: "cancelled", shift: serializeShift(after, []), told: result.told };
}

export type KeepWarningOutcome =
  | { readonly kind: "kept"; readonly shift: RotaShift }
  | { readonly kind: "not_found" }
  | { readonly kind: "stale"; readonly shift: RotaShift }
  | { readonly kind: "gone"; readonly shift: RotaShift };

/** Keep a warning as it is, with the reason why. Blocks are never kept. */
export async function keepRotaWarning(
  db: Database,
  input: {
    readonly venueId: string;
    readonly timeZone: string;
    readonly shiftId: string;
    readonly code: RotaWarningCode;
    readonly reason: string;
    readonly expectedRevision: number;
    readonly actor: Actor;
  },
): Promise<KeepWarningOutcome> {
  const { venueId, timeZone, shiftId, code, reason, expectedRevision, actor } = input;
  const current = await loadShift(db, venueId, shiftId);
  if (current === null || current.shift.status === "cancelled") return { kind: "not_found" };
  const view = await shiftForManager(db, venueId, timeZone, current);
  if (current.shift.revision !== expectedRevision) return { kind: "stale", shift: view };
  if (!view.issues.some((issue) => issue.code === code && issue.severity === "warning")) return { kind: "gone", shift: view };

  const now = new Date();
  const kept = [
    ...keptWarnings(current.shift).filter((entry) => entry.code !== code),
    { code, reason, byUserId: actor.id, byName: actor.name, at: now.toISOString() },
  ];
  const [row] = await db.update(rotaShifts).set({
    keptWarnings: kept,
    revision: sql`${rotaShifts.revision} + 1`,
    updatedBy: actor.id,
    updatedAt: now,
  }).where(and(
    eq(rotaShifts.id, shiftId),
    eq(rotaShifts.venueId, venueId),
    eq(rotaShifts.revision, expectedRevision),
    ne(rotaShifts.status, "cancelled"),
  )).returning({ id: rotaShifts.id });
  const after = await loadShift(db, venueId, shiftId);
  if (after === null) return { kind: "not_found" };
  const shift = await shiftForManager(db, venueId, timeZone, after);
  return row === undefined ? { kind: "stale", shift } : { kind: "kept", shift };
}

export type PublishOutcome =
  | { readonly kind: "published"; readonly published: number; readonly told: number; readonly notTold: number }
  | { readonly kind: "stale"; readonly shiftIds: readonly string[] }
  | { readonly kind: "blocked"; readonly blocks: readonly { readonly shiftId: string; readonly message: string }[] };

/**
 * Publish exactly the drafts the manager was shown, as they were shown, and
 * tell each person on them once, in one transaction. A shift that changed,
 * went, or left the week since stops the publish, and nothing changes.
 */
export async function publishRotaWeek(
  db: Database,
  input: {
    readonly venueId: string;
    readonly timeZone: string;
    readonly weekStart: string;
    readonly shifts: readonly { readonly id: string; readonly revision: number }[];
    readonly actor: Actor;
  },
): Promise<PublishOutcome> {
  const { venueId, timeZone, weekStart, actor } = input;
  const { fromMs, toMs } = rotaWeekBounds(weekStart, timeZone);
  const requested = new Map(input.shifts.map((shift) => [shift.id, shift.revision]));

  return db.transaction(async (tx): Promise<PublishOutcome> => {
    const rows = await tx.select().from(rotaShifts)
      .where(and(eq(rotaShifts.venueId, venueId), inArray(rotaShifts.id, [...requested.keys()])))
      .for("update");
    const byId = new Map(rows.map((row) => [row.id, row]));
    const stale = [...requested].filter(([id, revision]) => {
      const row = byId.get(id);
      return row === undefined || row.status !== "draft" || row.revision !== revision
        || row.startsAt.getTime() < fromMs || row.startsAt.getTime() >= toMs;
    }).map(([id]) => id);
    if (stale.length > 0) return { kind: "stale", shiftIds: stale };

    const personIds = [...new Set(rows.flatMap((row) => row.staffMemberId === null ? [] : [row.staffMemberId]))];
    const people = personIds.length === 0 ? [] : await tx.select().from(staffMembers)
      .where(and(eq(staffMembers.venueId, venueId), inArray(staffMembers.id, personIds)));
    const findings = await findingsFor(tx, venueId, timeZone, people, { fromMs, toMs });
    const blocks = rows.flatMap((row) => rotaPublishBlocks(findings.get(row.id) ?? [])
      .map((finding) => ({ shiftId: row.id, message: finding.message })));
    if (blocks.length > 0) return { kind: "blocked", blocks };

    const now = new Date();
    const published = await tx.update(rotaShifts).set({
      status: "published",
      publishedAt: now,
      revision: sql`${rotaShifts.revision} + 1`,
      updatedBy: actor.id,
      updatedAt: now,
    }).where(and(
      eq(rotaShifts.venueId, venueId),
      inArray(rotaShifts.id, [...requested.keys()]),
      eq(rotaShifts.status, "draft"),
    )).returning();
    if (published.length !== requested.size) throw new Error("The rota changed while it was being published");

    await tx.insert(rotaShiftChanges).values(published.map((row) => ({
      venueId, shiftId: row.id, kind: "published" as const, changedBy: actor.id, changedAt: now,
      noticeHours: rotaNoticeHours(now.getTime(), row.startsAt.getTime()), before: null, after: snapshot(row),
    })));

    const roomIds = [...new Set(published.flatMap((row) => row.spaceId === null ? [] : [row.spaceId]))];
    const rooms = roomIds.length === 0 ? [] : await tx.select({ id: spaces.id, name: spaces.name }).from(spaces)
      .where(and(eq(spaces.venueId, venueId), inArray(spaces.id, roomIds), isNull(spaces.deletedAt)));
    const roomNames = new Map(rooms.map((room) => [room.id, room.name]));
    const byPerson = new Map<string, ShiftRow[]>();
    for (const row of [...published].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())) {
      if (row.staffMemberId !== null) byPerson.set(row.staffMemberId, [...(byPerson.get(row.staffMemberId) ?? []), row]);
    }
    const notices = [...byPerson].map(([staffMemberId, shifts]): PersonNotice => ({
      staffMemberId,
      severity: "info",
      title: `Your shifts for the week of ${rotaDayMonth(weekStart)}`,
      body: `${shifts.map((row) => rotaShiftLine(row, row.spaceId === null ? null : roomNames.get(row.spaceId) ?? null, timeZone)).join(". ")}.`,
    }));
    const told = await notifyPeople(tx, venueId, weekStart, notices);
    return { kind: "published", published: published.length, told, notTold: byPerson.size - told };
  });
}

export type AbsenceOutcome =
  | { readonly kind: "created"; readonly absence: StaffUnavailability }
  | { readonly kind: "person_not_found" };

export async function createUnavailability(
  db: Database,
  input: { readonly venueId: string; readonly body: CreateStaffUnavailability; readonly actor: Actor },
): Promise<AbsenceOutcome> {
  const { venueId, body, actor } = input;
  const [person] = await db.select({ id: staffMembers.id }).from(staffMembers)
    .where(and(eq(staffMembers.id, body.staffMemberId), eq(staffMembers.venueId, venueId)))
    .limit(1);
  if (person === undefined) return { kind: "person_not_found" };
  const [row] = await db.insert(staffUnavailability).values({
    venueId,
    staffMemberId: body.staffMemberId,
    startsAt: new Date(body.startsAt),
    endsAt: new Date(body.endsAt),
    reason: body.reason,
    note: body.note,
    createdBy: actor.id,
  }).returning();
  if (row === undefined) throw new Error("The unavailability was not saved");
  return {
    kind: "created",
    absence: {
      id: row.id, staffMemberId: row.staffMemberId, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(),
      reason: row.reason, note: row.note,
    },
  };
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export type StaffOutcome =
  | { readonly kind: "saved"; readonly record: StaffRecord }
  | { readonly kind: "not_found" }
  | { readonly kind: "stale"; readonly record: StaffRecord }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "account_outside_team" }
  | { readonly kind: "account_linked"; readonly name: string | null };

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } }).code
    ?? (error as { cause?: { code?: unknown } }).cause?.code;
  return code === "23505";
}

/** Only an account of the venue's own team, at this venue, may be linked. */
async function accountInTeam(conn: RotaConn, venueId: string, userId: string): Promise<boolean> {
  const [user] = await conn.select({ role: users.role, venueId: users.venueId }).from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user !== undefined && isVenueTeamRole(user.role, user.venueId, venueId);
}

async function linkedElsewhere(conn: RotaConn, venueId: string, userId: string): Promise<StaffOutcome> {
  const [other] = await conn.select({ name: staffMembers.displayName }).from(staffMembers)
    .where(and(eq(staffMembers.venueId, venueId), eq(staffMembers.userId, userId)))
    .limit(1);
  return { kind: "account_linked", name: other?.name ?? null };
}

export async function createStaffMember(
  db: Database,
  input: { readonly venueId: string; readonly body: CreateStaffMemberBody; readonly actor: Actor },
): Promise<StaffOutcome> {
  const { venueId, body, actor } = input;
  if (body.userId !== null && !await accountInTeam(db, venueId, body.userId)) return { kind: "account_outside_team" };
  const now = new Date();
  try {
    const [created] = await db.insert(staffMembers).values({
      venueId,
      userId: body.userId,
      displayName: body.displayName,
      email: body.email,
      phone: body.phone,
      employmentType: body.employmentType,
      skills: body.skills,
      barTrainedOn: body.barTrainedOn,
      turns18On: body.turns18On,
      rightToWorkCheckedOn: body.rightToWorkCheckedOn,
      rightToWorkExpiresOn: body.rightToWorkExpiresOn,
      workingTimeOptOut: body.workingTimeOptOut,
      createdBy: actor.id,
      updatedBy: actor.id,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: staffMembers.id });
    if (created === undefined) throw new Error("The person was not saved");
    const row = await loadStaffMember(db, venueId, created.id);
    if (row === null) throw new Error("The person could not be read back");
    return { kind: "saved", record: serializeRecord(row) };
  } catch (error) {
    if (!isUniqueViolation(error) || body.userId === null) throw error;
    return linkedElsewhere(db, venueId, body.userId);
  }
}

export async function updateStaffMember(
  db: Database,
  input: { readonly venueId: string; readonly id: string; readonly body: UpdateStaffMemberBody; readonly actor: Actor },
): Promise<StaffOutcome> {
  const { venueId, id, body, actor } = input;
  const current = await loadStaffMember(db, venueId, id);
  if (current === null) return { kind: "not_found" };
  if (current.person.revision !== body.expectedRevision) return { kind: "stale", record: serializeRecord(current) };

  const before = current.person;
  const next = {
    displayName: body.displayName ?? before.displayName,
    email: body.email === undefined ? before.email : body.email,
    phone: body.phone === undefined ? before.phone : body.phone,
    employmentType: body.employmentType ?? before.employmentType,
    skills: body.skills ?? before.skills,
    barTrainedOn: body.barTrainedOn === undefined ? before.barTrainedOn : body.barTrainedOn,
    turns18On: body.turns18On === undefined ? before.turns18On : body.turns18On,
    rightToWorkCheckedOn: body.rightToWorkCheckedOn === undefined ? before.rightToWorkCheckedOn : body.rightToWorkCheckedOn,
    rightToWorkExpiresOn: body.rightToWorkExpiresOn === undefined ? before.rightToWorkExpiresOn : body.rightToWorkExpiresOn,
    workingTimeOptOut: body.workingTimeOptOut ?? before.workingTimeOptOut,
    userId: body.userId === undefined ? before.userId : body.userId,
    isActive: body.isActive ?? before.isActive,
  };
  if (next.rightToWorkExpiresOn !== null
    && (next.rightToWorkCheckedOn === null || next.rightToWorkExpiresOn < next.rightToWorkCheckedOn)) {
    return { kind: "invalid", message: "Record the right-to-work check, and an expiry after it." };
  }
  if (next.userId !== null && next.userId !== before.userId && !await accountInTeam(db, venueId, next.userId)) {
    return { kind: "account_outside_team" };
  }

  try {
    const [updated] = await db.update(staffMembers).set({
      ...next,
      revision: sql`${staffMembers.revision} + 1`,
      updatedBy: actor.id,
      updatedAt: new Date(),
    }).where(and(
      eq(staffMembers.id, id),
      eq(staffMembers.venueId, venueId),
      eq(staffMembers.revision, body.expectedRevision),
    )).returning({ id: staffMembers.id });
    const row = await loadStaffMember(db, venueId, id);
    if (row === null) return { kind: "not_found" };
    return updated === undefined ? { kind: "stale", record: serializeRecord(row) } : { kind: "saved", record: serializeRecord(row) };
  } catch (error) {
    if (!isUniqueViolation(error) || next.userId === null) throw error;
    return linkedElsewhere(db, venueId, next.userId);
  }
}

export async function removeUnavailability(db: Database, venueId: string, id: string): Promise<boolean> {
  const [removed] = await db.delete(staffUnavailability)
    .where(and(eq(staffUnavailability.id, id), eq(staffUnavailability.venueId, venueId)))
    .returning({ id: staffUnavailability.id });
  return removed !== undefined;
}
