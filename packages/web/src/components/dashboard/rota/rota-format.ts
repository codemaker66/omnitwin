import {
  ROTA_SKILLS,
  ROTA_SKILL_LABELS,
  STAFF_EMPLOYMENT_LABELS,
  addRotaDays,
  rotaClock,
  rotaDayMonth,
  rotaDayMonthYear,
  rotaInstant,
  rotaIsUnder18On,
  rotaLocalDate,
  rotaMinuteOfDay,
  rotaNoticeHours,
  rotaWeekdayIndex,
  rotaWeekdayName,
  type CalendarEntry,
  type CalendarResponse,
  type RotaIssue,
  type RotaPerson,
  type RotaShift,
  type RotaSkill,
  type RotaWeek,
  type StaffRecord,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Words and plans for the Rota view (T-637 slice B). Pure: the view renders
// what these return, and the tests pin them. Every day and time is the
// venue's, from the zone the API sends with the week.
// ---------------------------------------------------------------------------

const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Week of 5 October 2026". */
export function rotaWeekTitle(weekStart: string): string {
  return `Week of ${rotaDayMonthYear(weekStart)}`;
}

export interface DayTile {
  readonly date: string;
  readonly weekday: string;
  readonly day: string;
  readonly month: string;
  /** "Saturday 10 October", for names read aloud. */
  readonly full: string;
}

export function dayTile(date: string): DayTile {
  const [, month = 1, day = 1] = date.split("-").map(Number);
  return {
    date,
    weekday: SHORT_DAYS[rotaWeekdayIndex(date)] ?? "",
    day: String(day),
    month: SHORT_MONTHS[month - 1] ?? "",
    full: `${rotaWeekdayName(date)} ${rotaDayMonth(date)}`,
  };
}

/** "08:00–16:00"; a shift past midnight says so in words for a screen reader. */
export function shiftTimes(shift: Pick<RotaShift, "startsAt" | "endsAt">, timeZone: string): { readonly text: string; readonly spoken: string } {
  const start = Date.parse(shift.startsAt);
  const end = Date.parse(shift.endsAt);
  const from = rotaClock(start, timeZone);
  const to = rotaClock(end, timeZone);
  const nextDay = rotaLocalDate(end, timeZone) !== rotaLocalDate(start, timeZone) && rotaMinuteOfDay(end, timeZone) !== 0;
  return {
    text: `${from}–${to}`,
    spoken: nextDay ? `${from} to ${to} the next day` : `${from} to ${to}`,
  };
}

/** The venue's date a shift belongs to: the day it starts. */
export function shiftDate(shift: Pick<RotaShift, "startsAt">, timeZone: string): string {
  return rotaLocalDate(Date.parse(shift.startsAt), timeZone);
}

/** Warnings nobody has kept, and the legal blocks. */
export function openIssues(shift: Pick<RotaShift, "issues">): readonly RotaIssue[] {
  return shift.issues.filter((issue) => issue.severity === "block" || issue.kept === null);
}

export function hasBlock(shift: Pick<RotaShift, "issues">): boolean {
  return shift.issues.some((issue) => issue.severity === "block");
}

/** "Morag Sinclair, Saturday 10 October, 08:00 to 16:00, set-up, Grand Hall, draft, 1 warning". */
export function shiftName(shift: RotaShift, personName: string | null, timeZone: string): string {
  const date = shiftDate(shift, timeZone);
  const parts = [
    personName ?? "Unfilled",
    `${rotaWeekdayName(date)} ${rotaDayMonth(date)}`,
    shiftTimes(shift, timeZone).spoken,
    ROTA_SKILL_LABELS[shift.role].toLowerCase(),
  ];
  if (shift.spaceName !== null) parts.push(shift.spaceName);
  parts.push(shift.status === "draft" ? "draft" : shift.status === "cancelled" ? "cancelled" : "published");
  const open = openIssues(shift);
  if (open.length > 0) parts.push(`${String(open.length)} ${open.length === 1 ? "warning" : "warnings"}: ${open.map((issue) => issue.short).join("; ")}`);
  return parts.join(", ");
}

export interface WeekSummary {
  readonly shifts: number;
  readonly people: number;
  readonly unfilled: number;
  readonly withWarnings: number;
  readonly drafts: number;
  /** Whole working hours rostered, breaks aside. */
  readonly hours: number;
}

export function weekSummary(week: Pick<RotaWeek, "shifts">): WeekSummary {
  const live = week.shifts.filter((shift) => shift.status !== "cancelled");
  const minutes = live.reduce((sum, shift) => sum + (Date.parse(shift.endsAt) - Date.parse(shift.startsAt)) / 60_000 - shift.breakMinutes, 0);
  return {
    shifts: live.length,
    people: new Set(live.flatMap((shift) => shift.staffMemberId === null ? [] : [shift.staffMemberId])).size,
    unfilled: live.filter((shift) => shift.staffMemberId === null).length,
    withWarnings: live.filter((shift) => openIssues(shift).length > 0).length,
    drafts: live.filter((shift) => shift.status === "draft").length,
    hours: Math.round(minutes / 60),
  };
}

/** "Callum", "Callum and Aileen", "Callum, Aileen and Jo". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

export interface PublishPlan {
  /** Drafts that publishing would turn into published shifts. */
  readonly publishable: readonly RotaShift[];
  /** Drafts held back by a legal block. */
  readonly blocked: readonly RotaShift[];
  readonly told: readonly RotaPerson[];
  readonly notTold: readonly RotaPerson[];
  readonly unfilled: number;
  readonly withWarnings: number;
  /** What pressing the button does, in one sentence. */
  readonly consequence: string;
  /** Why some drafts stay behind, when they do. */
  readonly heldBack: string | null;
  readonly buttonLabel: string;
}

/**
 * What "Publish this week" would do, said before it is done: which shifts,
 * who is told in the app, who has to be told another way, and what stays in
 * draft for a legal reason.
 */
export function publishPlan(week: Pick<RotaWeek, "shifts" | "people">): PublishPlan {
  const drafts = week.shifts.filter((shift) => shift.status === "draft");
  const publishable = drafts.filter((shift) => !hasBlock(shift));
  const blocked = drafts.filter(hasBlock);
  const byId = new Map(week.people.map((person) => [person.id, person]));
  const onThem = [...new Set(publishable.flatMap((shift) => shift.staffMemberId === null ? [] : [shift.staffMemberId]))]
    .flatMap((id) => { const person = byId.get(id); return person === undefined ? [] : [person]; });
  const told = onThem.filter((person) => person.hasAccount);
  const notTold = onThem.filter((person) => !person.hasAccount);
  const unfilled = publishable.filter((shift) => shift.staffMemberId === null).length;
  const withWarnings = publishable.filter((shift) => openIssues(shift).length > 0).length;

  // Up to three people are named; beyond that they are counted.
  const named = (people: readonly RotaPerson[]): string | null => people.length <= 3 ? nameList(people.map((person) => person.displayName)) : null;

  let consequence: string;
  if (publishable.length === 0) {
    // With only held-back drafts left, the reason below is the whole story.
    consequence = drafts.length > 0 ? "" : week.shifts.length > 0 ? "Every shift this week is published." : "Nothing to publish yet.";
  } else {
    const shifts = plural(publishable.length, "shift", "shifts");
    const unfilledWords = unfilled === 0 ? "" : unfilled === publishable.length
      ? (publishable.length === 1 ? ", unfilled," : ", all unfilled,")
      : `, ${String(unfilled)} of them unfilled,`;
    const toldWords = named(told) ?? plural(told.length, "person", "people");
    if (onThem.length === 0) {
      consequence = `Publishes ${shifts}${unfilledWords.replace(/,$/u, "")}.`;
    } else if (notTold.length === 0) {
      consequence = `Publishes ${shifts}${unfilledWords} and tells ${toldWords} in the app.`;
    } else if (told.length === 0) {
      const names = named(notTold);
      consequence = `Publishes ${shifts}${unfilledWords.replace(/,$/u, "")}. ${names === null
        ? "Nobody on them has an account, so tell them yourself."
        : `${names} ${notTold.length === 1 ? "has" : "have"} no account, so tell them yourself.`}`;
    } else {
      consequence = `Publishes ${shifts}${unfilledWords} and tells ${toldWords} in the app; tell ${named(notTold) ?? `the other ${String(notTold.length)}`} yourself.`;
    }
    if (withWarnings > 0) {
      consequence += ` ${publishable.length === 1 ? "The shift carries a warning."
        : withWarnings === publishable.length ? "Each shift carries a warning."
          : withWarnings === 1 ? "One of the shifts carries a warning."
            : `${String(withWarnings)} of the shifts carry warnings.`}`;
    }
  }

  let heldBack: string | null = null;
  if (blocked.length > 0) {
    const names = [...new Set(blocked.flatMap((shift) => {
      const person = shift.staffMemberId === null ? undefined : byId.get(shift.staffMemberId);
      return person === undefined ? [] : [person.displayName];
    }))];
    const codes = new Set(blocked.flatMap((shift) => shift.issues.filter((issue) => issue.severity === "block").map((issue) => issue.code)));
    const count = blocked.length === 1 ? "1 shift stays" : `${String(blocked.length)} shifts stay`;
    const only = (code: RotaIssue["code"]): boolean => codes.size === 1 && codes.has(code);
    heldBack = only("right_to_work_missing") && names.length > 0
      ? `${nameList(names)} ${names.length === 1 ? "has" : "have"} no right-to-work check recorded, so ${count} in draft until one is.`
      : only("young_small_hours")
        ? `${count} in draft: nobody under 18 may work between midnight and 04:00.`
        : `${count} in draft until what the law needs is in place. Open ${blocked.length === 1 ? "it" : "each"} to see what.`;
  }

  if (consequence === "" && heldBack !== null) {
    consequence = heldBack;
    heldBack = null;
  }

  const buttonLabel = told.length > 0
    ? `Publish and tell ${plural(told.length, "person", "people")}`
    : `Publish ${plural(publishable.length, "shift", "shifts")}`;

  return { publishable, blocked, told, notTold, unfilled, withWarnings, consequence, heldBack, buttonLabel };
}

// ---------------------------------------------------------------------------
// Functions along the top, from the Diary's calendar
// ---------------------------------------------------------------------------

export interface FunctionLine {
  readonly id: string;
  readonly title: string;
  readonly room: string | null;
  readonly spaceId: string;
  readonly eventId: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly times: string;
  readonly guests: number | null;
  /** For likely demand: "Provisional", "1st option", "Joint 1st". */
  readonly hold: string | null;
}

export interface DayFunctions {
  readonly confirmed: readonly FunctionLine[];
  readonly likely: readonly FunctionLine[];
}

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${String(value)}th`;
  const suffix = value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th";
  return `${String(value)}${suffix}`;
}

/** Blake's hold words: Provisional, 1st option, 2nd option, Joint 1st. */
export function holdWords(entry: Extract<CalendarEntry, { entryType: "booking" }>): string {
  if (entry.state === "prospect") return "Provisional";
  if (entry.jointFlag && (entry.rank ?? 1) === 1) return "Joint 1st";
  return entry.rank === null ? "Option" : `${ordinal(entry.rank)} option`;
}

/**
 * Each day's Confirmed functions, and quietly the Provisional and option
 * holds, by the day they start on the venue's clock.
 */
export function functionsByDay(calendar: CalendarResponse, timeZone: string): ReadonlyMap<string, DayFunctions> {
  const rooms = new Map(calendar.rooms.map((room) => [room.id, room.name]));
  const days = new Map<string, { confirmed: FunctionLine[]; likely: FunctionLine[] }>();
  for (const entry of calendar.entries) {
    if (entry.entryType !== "booking") continue;
    const confirmed = entry.state === "ink";
    const likely = entry.state === "hold" || entry.state === "prospect";
    if (!confirmed && !likely) continue;
    const date = rotaLocalDate(Date.parse(entry.startsAt), timeZone);
    const line: FunctionLine = {
      id: entry.id,
      title: entry.eventName ?? entry.title,
      room: rooms.get(entry.spaceId) ?? null,
      spaceId: entry.spaceId,
      eventId: entry.eventId,
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      times: shiftTimes(entry, timeZone).text,
      guests: entry.guestCount ?? null,
      hold: confirmed ? null : holdWords(entry),
    };
    const day = days.get(date) ?? { confirmed: [], likely: [] };
    (confirmed ? day.confirmed : day.likely).push(line);
    days.set(date, day);
  }
  return days;
}

// ---------------------------------------------------------------------------
// A new shift, prefilled
// ---------------------------------------------------------------------------

export interface ShiftDraft {
  readonly staffMemberId: string | null;
  readonly role: RotaSkill;
  readonly date: string;
  /** "HH:MM" on the venue's clock; an end at or before the start is the next day. */
  readonly start: string;
  readonly end: string;
  readonly breakMinutes: number;
  readonly functionId: string | null;
  readonly eventId: string | null;
  readonly spaceId: string | null;
  readonly note: string;
}

function clockFromMinutes(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

function minutesOf(clock: string): number | null {
  const match = /^(\d{2}):(\d{2})$/u.exec(clock);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** The instants a draft's day and clock times stand for. */
export function draftInstants(draft: Pick<ShiftDraft, "date" | "start" | "end">, timeZone: string): { readonly startsAt: string; readonly endsAt: string } | null {
  const start = minutesOf(draft.start);
  const end = minutesOf(draft.end);
  if (start === null || end === null) return null;
  const endMinutes = end <= start ? end + 1440 : end;
  return {
    startsAt: new Date(rotaInstant(draft.date, start, timeZone)).toISOString(),
    endsAt: new Date(rotaInstant(draft.date, endMinutes, timeZone)).toISOString(),
  };
}

/** The break the law asks for, over the working time a draft describes. */
export function suggestedBreak(minutes: number, under18: boolean): number {
  if (under18) return minutes > 4 * 60 + 30 ? 30 : 0;
  return minutes > 6 * 60 ? 20 : 0;
}

/** The longest shift a prefill suggests; anyone can make it longer. */
const PREFILL_MAX_MINUTES = 16 * 60;

/**
 * A sensible first draft for a person's day: their first skill in the rota's
 * order; the day's first Confirmed function from an hour before it starts to
 * when it ends (at most sixteen hours), with its room; otherwise 09:00 to
 * 17:00. The break the law asks for is filled in, and an under-18 is kept
 * out of 22:00 to 06:00.
 */
export function prefillShift(input: {
  readonly record: Pick<StaffRecord, "id" | "skills" | "turns18On"> | null;
  readonly date: string;
  readonly functions: readonly FunctionLine[];
  readonly timeZone: string;
}): ShiftDraft {
  const { record, date, timeZone } = input;
  const role: RotaSkill = ROTA_SKILLS.find((skill) => record?.skills.includes(skill) === true) ?? "setup";
  const under18 = record !== null && rotaIsUnder18On(record.turns18On, date);
  const first = [...input.functions].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))[0];

  let start = 9 * 60;
  let end = 17 * 60;
  if (first !== undefined) {
    const functionStart = rotaMinuteOfDay(Date.parse(first.startsAt), timeZone);
    const sameDayEnd = rotaLocalDate(Date.parse(first.endsAt), timeZone) === date;
    const functionEnd = sameDayEnd ? rotaMinuteOfDay(Date.parse(first.endsAt), timeZone) : 1440 + rotaMinuteOfDay(Date.parse(first.endsAt), timeZone);
    start = Math.max(0, Math.floor((functionStart - 60) / 15) * 15);
    end = Math.min(start + PREFILL_MAX_MINUTES, Math.ceil(functionEnd / 15) * 15);
  }
  if (under18) {
    start = Math.max(start, 6 * 60);
    end = Math.min(Math.max(end, start + 60), 22 * 60);
  }
  return {
    staffMemberId: record?.id ?? null,
    role,
    date,
    start: clockFromMinutes(start),
    end: clockFromMinutes(end),
    breakMinutes: suggestedBreak(end - start, under18),
    functionId: first?.id ?? null,
    eventId: first?.eventId ?? null,
    spaceId: first?.spaceId ?? null,
    note: "",
  };
}

/** A saved shift as the editor's draft. */
export function draftFromShift(shift: RotaShift, timeZone: string, functions: readonly FunctionLine[]): ShiftDraft {
  const date = shiftDate(shift, timeZone);
  const match = functions.find((line) => line.eventId !== null && line.eventId === shift.eventId)
    ?? functions.find((line) => shift.eventId === null && line.spaceId === shift.spaceId && line.eventId === null);
  return {
    staffMemberId: shift.staffMemberId,
    role: shift.role,
    date,
    start: rotaClock(Date.parse(shift.startsAt), timeZone),
    end: rotaClock(Date.parse(shift.endsAt), timeZone),
    breakMinutes: shift.breakMinutes,
    functionId: match?.id ?? null,
    eventId: shift.eventId,
    spaceId: shift.spaceId,
    note: shift.note ?? "",
  };
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** "Casual · Bar, Set-up". */
export function personMeta(person: Pick<RotaPerson, "employmentType" | "skills">): string {
  const skills = person.skills.map((skill) => ROTA_SKILL_LABELS[skill]).join(", ");
  return skills === "" ? STAFF_EMPLOYMENT_LABELS[person.employmentType] : `${STAFF_EMPLOYMENT_LABELS[person.employmentType]} · ${skills}`;
}

export interface PersonFact {
  readonly text: string;
  /** Needs doing before this person can be rostered as planned. */
  readonly attention: boolean;
}

/** What a rota manager should know about a record, in plain words. */
export function personFacts(record: StaffRecord, today: string): readonly PersonFact[] {
  const facts: PersonFact[] = [];
  if (record.rightToWorkCheckedOn === null) {
    facts.push({ text: "No right-to-work check recorded", attention: true });
  } else if (record.rightToWorkExpiresOn !== null && record.rightToWorkExpiresOn < today) {
    facts.push({ text: `Right to work ran out on ${rotaDayMonthYear(record.rightToWorkExpiresOn)}`, attention: true });
  } else if (record.rightToWorkExpiresOn !== null) {
    facts.push({ text: `Right to work checked to ${rotaDayMonthYear(record.rightToWorkExpiresOn)}`, attention: false });
  }
  if (record.skills.includes("bar") && record.barTrainedOn === null) {
    facts.push({ text: "Bar training not recorded", attention: true });
  }
  if (rotaIsUnder18On(record.turns18On, today) && record.turns18On !== null) {
    facts.push({ text: `Under 18 until ${rotaDayMonthYear(record.turns18On)}`, attention: false });
  }
  if (record.workingTimeOptOut) facts.push({ text: "Opted out of the 48-hour week", attention: false });
  facts.push({ text: record.account === null ? "No account, so told in person" : "Told in the app", attention: false });
  return facts;
}

/**
 * The notice cancelling now would give, said before it is done: "That is 30
 * hours' notice, and it is recorded."
 */
export function noticeSentence(startsAt: string, nowMs: number): string {
  const start = Date.parse(startsAt);
  if (start <= nowMs) return "It has already started; the cancellation is recorded.";
  const hours = rotaNoticeHours(nowMs, start);
  const notice = hours === 0 ? "less than an hour's notice" : hours === 1 ? "1 hour's notice" : `${String(hours)} hours' notice`;
  return `That is ${notice}, and it is recorded.`;
}

/** The dates of the days a stretch of leave covers, first and last. */
export function leaveDates(entry: { readonly startsAt: string; readonly endsAt: string }, timeZone: string): { readonly first: string; readonly last: string } {
  const first = rotaLocalDate(Date.parse(entry.startsAt), timeZone);
  const endMs = Date.parse(entry.endsAt);
  const last = rotaMinuteOfDay(endMs, timeZone) === 0 ? addRotaDays(rotaLocalDate(endMs, timeZone), -1) : rotaLocalDate(endMs, timeZone);
  return { first, last: last < first ? first : last };
}

/** "Sat 10 Oct" or "Fri 9 – Sun 11 Oct". */
export function leaveSpan(entry: { readonly startsAt: string; readonly endsAt: string }, timeZone: string): string {
  const { first, last } = leaveDates(entry, timeZone);
  const a = dayTile(first);
  if (first === last) return `${a.weekday} ${a.day} ${a.month}`;
  const b = dayTile(last);
  return a.month === b.month ? `${a.weekday} ${a.day} – ${b.weekday} ${b.day} ${b.month}` : `${a.weekday} ${a.day} ${a.month} – ${b.weekday} ${b.day} ${b.month}`;
}
