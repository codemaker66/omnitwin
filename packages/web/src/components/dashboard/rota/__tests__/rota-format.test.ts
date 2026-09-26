import { describe, expect, it } from "vitest";
import {
  CalendarResponseSchema,
  RotaShiftSchema,
  StaffRecordSchema,
  type CalendarBookingEntry,
  type RotaIssue,
  type RotaPerson,
  type RotaShift,
  type StaffRecord,
} from "@omnitwin/types";
import {
  dayTile,
  draftFromShift,
  draftInstants,
  functionsByDay,
  holdWords,
  leaveSpan,
  nameList,
  noticeSentence,
  personFacts,
  personMeta,
  prefillShift,
  publishPlan,
  rotaWeekTitle,
  shiftName,
  shiftTimes,
  suggestedBreak,
  weekSummary,
  type FunctionLine,
} from "../rota-format.js";

// ---------------------------------------------------------------------------
// The Rota's words and plans: what "Publish this week" says it will do before
// it is pressed, a new shift's first draft, the functions along the top, and
// every day and time on the venue's clock, across the clocks changing.
// ---------------------------------------------------------------------------

const TZ = "Europe/London";
const VENUE = "00000000-0000-4000-8000-000000000100";
const HALL = "00000000-0000-4000-8000-000000000001";
const EVENT = "00000000-0000-4000-8000-0000000000e1";
const MORAG = "00000000-0000-4000-8000-0000000000a1";
const JAMIE = "00000000-0000-4000-8000-0000000000a2";
const CALLUM = "00000000-0000-4000-8000-0000000000a3";
const PRIYA = "00000000-0000-4000-8000-0000000000a4";

let nextId = 0;
function shift(fields: Partial<RotaShift> = {}): RotaShift {
  nextId += 1;
  return RotaShiftSchema.parse({
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`,
    venueId: VENUE, staffMemberId: null, role: "setup",
    startsAt: "2026-10-10T07:00:00.000Z", endsAt: "2026-10-10T15:00:00.000Z", breakMinutes: 30,
    eventId: null, eventName: null, spaceId: null, spaceName: null, note: null,
    status: "draft", revision: 1, publishedAt: null, cancelledAt: null, cancellationNoticeHours: null,
    updatedAt: "2026-10-01T09:00:00.000Z", updatedByName: null, issues: [],
    ...fields,
  });
}

function person(id: string, displayName: string, hasAccount: boolean): RotaPerson {
  return { id, displayName, employmentType: "casual", skills: ["setup"], isActive: true, hasAccount };
}

const SHORT_REST: RotaIssue = {
  code: "short_rest", severity: "warning", kept: null, short: "9 h rest before; 11 needed",
  message: "Morag Sinclair would have 9 hours between Friday's bar shift and Saturday's set-up; 11 are needed.",
};
const NO_CHECK: RotaIssue = {
  code: "right_to_work_missing", severity: "block", kept: null, short: "No right-to-work check",
  message: "Callum Reid has no right-to-work check recorded, so this shift cannot be published yet.",
};
const SMALL_HOURS: RotaIssue = {
  code: "young_small_hours", severity: "block", kept: null, short: "Under 18: not midnight to 04:00",
  message: "Aileen Brodie is under 18 and cannot work between midnight and 04:00.",
};

const PEOPLE = [person(MORAG, "Morag Sinclair", true), person(JAMIE, "Jamie Kerr", false), person(CALLUM, "Callum Reid", false), person(PRIYA, "Priya Raman", true)];

describe("publishPlan", () => {
  it("names what publishing does: the shifts, who is told in the app, who to tell yourself, and what stays back", () => {
    const week = {
      people: PEOPLE,
      shifts: [
        shift({ staffMemberId: MORAG, issues: [SHORT_REST] }),
        shift({ staffMemberId: JAMIE }),
        shift({ staffMemberId: PRIYA }),
        shift({ staffMemberId: null }),
        shift({ staffMemberId: CALLUM, issues: [NO_CHECK] }),
        shift({ staffMemberId: MORAG, status: "published", publishedAt: "2026-10-01T09:00:00.000Z" }),
      ],
    };
    const plan = publishPlan(week);
    expect(plan.publishable).toHaveLength(4);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.consequence).toBe("Publishes 4 shifts, 1 of them unfilled, and tells Morag Sinclair and Priya Raman in the app; tell Jamie Kerr yourself. One of the shifts carries a warning.");
    expect(plan.heldBack).toBe("Callum Reid has no right-to-work check recorded, so 1 shift stays in draft until one is.");
    expect(plan.buttonLabel).toBe("Publish and tell 2 people");
  });

  it("counts people once there are more than three, and tells each person once however many shifts they have", () => {
    const ids = Array.from({ length: 5 }, (_, index) => `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`);
    const people = ids.map((id, index) => person(id, `Person ${String(index + 1)}`, index < 4));
    const week = { people, shifts: [...ids.map((id) => shift({ staffMemberId: id })), shift({ staffMemberId: ids[0] ?? null })] };
    const plan = publishPlan(week);
    expect(plan.told).toHaveLength(4);
    expect(plan.consequence).toBe("Publishes 6 shifts and tells 4 people in the app; tell Person 5 yourself.");
    expect(plan.buttonLabel).toBe("Publish and tell 4 people");
    const three = publishPlan({ people, shifts: ids.slice(0, 3).map((id) => shift({ staffMemberId: id })) });
    expect(three.consequence).toBe("Publishes 3 shifts and tells Person 1, Person 2 and Person 3 in the app.");
  });

  it("says who has no account when nobody on the shifts can be told in the app", () => {
    const plan = publishPlan({ people: PEOPLE, shifts: [shift({ staffMemberId: JAMIE })] });
    expect(plan.consequence).toBe("Publishes 1 shift. Jamie Kerr has no account, so tell them yourself.");
    expect(plan.buttonLabel).toBe("Publish 1 shift");
  });

  it("describes a week of unfilled needs without promising to tell anyone", () => {
    const plan = publishPlan({ people: PEOPLE, shifts: [shift(), shift({ issues: [SHORT_REST] })] });
    expect(plan.consequence).toBe("Publishes 2 shifts, all unfilled. One of the shifts carries a warning.");
    expect(plan.buttonLabel).toBe("Publish 2 shifts");
  });

  it("says plainly when there is nothing left to publish", () => {
    expect(publishPlan({ people: PEOPLE, shifts: [] }).consequence).toBe("Nothing to publish yet.");
    const published = publishPlan({ people: PEOPLE, shifts: [shift({ status: "published", publishedAt: "2026-10-01T09:00:00.000Z" })] });
    expect(published.publishable).toHaveLength(0);
    expect(published.consequence).toBe("Every shift this week is published.");
    expect(published.heldBack).toBeNull();
  });

  it("gives the reason as the whole story when only held-back drafts remain", () => {
    const plan = publishPlan({ people: PEOPLE, shifts: [shift({ staffMemberId: CALLUM, issues: [NO_CHECK] })] });
    expect(plan.publishable).toHaveLength(0);
    expect(plan.consequence).toBe("Callum Reid has no right-to-work check recorded, so 1 shift stays in draft until one is.");
    expect(plan.heldBack).toBeNull();
  });

  it("gives each kind of legal block its own reason", () => {
    const young = publishPlan({ people: PEOPLE, shifts: [shift({ staffMemberId: MORAG }), shift({ staffMemberId: PRIYA, issues: [SMALL_HOURS] })] });
    expect(young.heldBack).toBe("1 shift stays in draft: nobody under 18 may work between midnight and 04:00.");
    const mixed = publishPlan({ people: PEOPLE, shifts: [shift({ staffMemberId: MORAG }), shift({ staffMemberId: PRIYA, issues: [SMALL_HOURS] }), shift({ staffMemberId: CALLUM, issues: [NO_CHECK] })] });
    expect(mixed.heldBack).toBe("2 shifts stay in draft until what the law needs is in place. Open each to see what.");
  });

  it("no longer counts a warning once it has been kept with a reason", () => {
    const kept: RotaIssue = { ...SHORT_REST, kept: { code: "short_rest", reason: "Asked for it", byUserId: null, byName: "Elaine", at: "2026-10-02T09:00:00.000Z" } };
    const plan = publishPlan({ people: PEOPLE, shifts: [shift({ staffMemberId: MORAG, issues: [kept] })] });
    expect(plan.withWarnings).toBe(0);
    expect(plan.consequence).toBe("Publishes 1 shift and tells Morag Sinclair in the app.");
  });
});

describe("the week in numbers", () => {
  it("counts live shifts, distinct people, unfilled needs and working hours, leaving cancelled shifts out", () => {
    const summary = weekSummary({
      shifts: [
        shift({ staffMemberId: MORAG, issues: [SHORT_REST] }),
        shift({ staffMemberId: MORAG, startsAt: "2026-10-11T07:00:00.000Z", endsAt: "2026-10-11T11:00:00.000Z", breakMinutes: 0 }),
        shift({ staffMemberId: null, status: "published", publishedAt: "2026-10-01T09:00:00.000Z" }),
        shift({ staffMemberId: JAMIE, status: "cancelled", publishedAt: "2026-10-01T09:00:00.000Z", cancelledAt: "2026-10-02T09:00:00.000Z", cancellationNoticeHours: 190 }),
      ],
    });
    // 7 h 30 + 4 h + 7 h 30 working, rounded to whole hours.
    expect(summary).toEqual({ shifts: 3, people: 1, unfilled: 1, withWarnings: 1, drafts: 2, hours: 19 });
  });
});

describe("times and names on the venue's clock", () => {
  it("writes a shift past midnight as the next day for a screen reader, and a midnight end as the same night", () => {
    expect(shiftTimes({ startsAt: "2026-10-10T17:00:00.000Z", endsAt: "2026-10-10T23:30:00.000Z" }, TZ))
      .toEqual({ text: "18:00–00:30", spoken: "18:00 to 00:30 the next day" });
    expect(shiftTimes({ startsAt: "2026-10-10T17:00:00.000Z", endsAt: "2026-10-10T23:00:00.000Z" }, TZ))
      .toEqual({ text: "18:00–00:00", spoken: "18:00 to 00:00" });
  });

  it("reads a whole shift aloud: who, when, what, where, its state and what it needs", () => {
    const named = shift({ staffMemberId: MORAG, spaceName: "Grand Hall", startsAt: "2026-10-10T07:30:00.000Z", issues: [SHORT_REST] });
    expect(shiftName(named, "Morag Sinclair", TZ))
      .toBe("Morag Sinclair, Saturday 10 October, 08:30 to 16:00, set-up, Grand Hall, draft, 1 warning: 9 h rest before; 11 needed");
    expect(shiftName(shift({ role: "bar", status: "published", publishedAt: "2026-10-01T09:00:00.000Z" }), null, TZ))
      .toBe("Unfilled, Saturday 10 October, 08:00 to 16:00, bar, published");
  });

  it("titles the week and its day tiles", () => {
    expect(rotaWeekTitle("2026-10-05")).toBe("Week of 5 October 2026");
    expect(dayTile("2026-10-10")).toEqual({ date: "2026-10-10", weekday: "Sat", day: "10", month: "Oct", full: "Saturday 10 October" });
  });

  it("joins names the way a person would", () => {
    expect(nameList([])).toBe("");
    expect(nameList(["Callum"])).toBe("Callum");
    expect(nameList(["Callum", "Aileen"])).toBe("Callum and Aileen");
    expect(nameList(["Callum", "Aileen", "Jo"])).toBe("Callum, Aileen and Jo");
  });

  it("says the notice a cancellation gives before it is made", () => {
    const start = "2026-10-10T07:00:00.000Z";
    const at = (iso: string): number => Date.parse(iso);
    expect(noticeSentence(start, at("2026-10-08T21:00:00.000Z"))).toBe("That is 34 hours' notice, and it is recorded.");
    expect(noticeSentence(start, at("2026-10-10T05:30:00.000Z"))).toBe("That is 1 hour's notice, and it is recorded.");
    expect(noticeSentence(start, at("2026-10-10T06:30:00.000Z"))).toBe("That is less than an hour's notice, and it is recorded.");
    expect(noticeSentence(start, at("2026-10-10T08:00:00.000Z"))).toBe("It has already started; the cancellation is recorded.");
  });
});

describe("a new shift, and the instants it stands for", () => {
  const wedding: FunctionLine = {
    id: "00000000-0000-4000-8000-0000000000f1", title: "Robertson and Kaur wedding", room: "Grand Hall", spaceId: HALL, eventId: EVENT,
    startsAt: "2026-10-10T11:00:00.000Z", endsAt: "2026-10-10T23:30:00.000Z", times: "12:00–00:30", guests: 160, hold: null,
  };
  const record = (fields: Partial<Pick<StaffRecord, "skills" | "turns18On">> = {}): Pick<StaffRecord, "id" | "skills" | "turns18On"> =>
    ({ id: MORAG, skills: ["bar", "setup"], turns18On: null, ...fields });

  it("starts an ordinary day at 09:00 to 17:00 with the break the law asks for, in the person's first skill", () => {
    expect(prefillShift({ record: record(), date: "2026-10-10", functions: [], timeZone: TZ })).toEqual({
      staffMemberId: MORAG, role: "setup", date: "2026-10-10", start: "09:00", end: "17:00", breakMinutes: 20,
      functionId: null, eventId: null, spaceId: null, note: "",
    });
    expect(prefillShift({ record: null, date: "2026-10-10", functions: [], timeZone: TZ }).staffMemberId).toBeNull();
  });

  it("covers a function from an hour before it to its end, past midnight, in its room", () => {
    const draft = prefillShift({ record: record({ skills: ["av"] }), date: "2026-10-10", functions: [wedding], timeZone: TZ });
    expect(draft).toMatchObject({ role: "av", start: "11:00", end: "00:30", breakMinutes: 20, functionId: wedding.id, eventId: EVENT, spaceId: HALL });
  });

  it("suggests at most sixteen hours however long the function runs", () => {
    const long = { ...wedding, startsAt: "2026-10-10T07:00:00.000Z", endsAt: "2026-10-11T05:00:00.000Z" };
    expect(prefillShift({ record: record(), date: "2026-10-10", functions: [long], timeZone: TZ })).toMatchObject({ start: "07:00", end: "23:00" });
  });

  it("keeps someone under 18 out of 22:00 to 06:00 and gives them their longer break", () => {
    const young = record({ turns18On: "2027-03-02" });
    expect(prefillShift({ record: young, date: "2026-10-10", functions: [wedding], timeZone: TZ })).toMatchObject({ start: "11:00", end: "22:00", breakMinutes: 30 });
    const early = { ...wedding, startsAt: "2026-10-10T04:00:00.000Z", endsAt: "2026-10-10T09:00:00.000Z" };
    expect(prefillShift({ record: young, date: "2026-10-10", functions: [early], timeZone: TZ })).toMatchObject({ start: "06:00", end: "10:00", breakMinutes: 0 });
  });

  it("asks for a break only past six hours, or four and a half for someone under 18", () => {
    expect(suggestedBreak(360, false)).toBe(0);
    expect(suggestedBreak(361, false)).toBe(20);
    expect(suggestedBreak(270, true)).toBe(0);
    expect(suggestedBreak(271, true)).toBe(30);
  });

  it("turns a day and clock times into instants, the end past midnight the next day, across the clocks going back", () => {
    expect(draftInstants({ date: "2026-10-10", start: "18:00", end: "00:30" }, TZ))
      .toEqual({ startsAt: "2026-10-10T17:00:00.000Z", endsAt: "2026-10-10T23:30:00.000Z" });
    // 25 October 2026: 02:00 BST becomes 01:00 GMT, so midnight to 06:00 is seven hours.
    expect(draftInstants({ date: "2026-10-25", start: "00:00", end: "06:00" }, TZ))
      .toEqual({ startsAt: "2026-10-24T23:00:00.000Z", endsAt: "2026-10-25T06:00:00.000Z" });
    expect(draftInstants({ date: "2026-10-10", start: "24:00", end: "06:00" }, TZ)).toBeNull();
    expect(draftInstants({ date: "2026-10-10", start: "", end: "06:00" }, TZ)).toBeNull();
  });

  it("opens a saved shift as its draft, matched to its function", () => {
    const saved = shift({ staffMemberId: MORAG, eventId: EVENT, spaceId: HALL, startsAt: "2026-10-10T10:00:00.000Z", endsAt: "2026-10-10T23:30:00.000Z", breakMinutes: 20, note: "Keys at 10:45" });
    expect(draftFromShift(saved, TZ, [wedding])).toEqual({
      staffMemberId: MORAG, role: "setup", date: "2026-10-10", start: "11:00", end: "00:30", breakMinutes: 20,
      functionId: wedding.id, eventId: EVENT, spaceId: HALL, note: "Keys at 10:45",
    });
  });
});

describe("functions along the top", () => {
  const ROOMS = [{ id: HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }];
  const booking = (fields: Partial<CalendarBookingEntry>): CalendarBookingEntry => ({
    entryType: "booking", id: "00000000-0000-4000-8000-0000000009a1", spaceId: HALL, kind: "ink", status: "active", state: "ink",
    title: "Booking", eventType: null, startsAt: "2026-10-10T11:00:00.000Z", endsAt: "2026-10-10T23:30:00.000Z",
    rank: null, jointFlag: false, decisionAt: null, ownerUserId: null, nextAction: null, nextActionDueAt: null,
    eventId: null, seriesId: null, ...fields,
  });

  it("uses the Diary's hold words", () => {
    expect(holdWords(booking({ kind: "prospect", state: "prospect" }))).toBe("Provisional");
    expect(holdWords(booking({ kind: "hold", state: "hold", rank: 1 }))).toBe("1st option");
    expect(holdWords(booking({ kind: "hold", state: "hold", rank: 2 }))).toBe("2nd option");
    expect(holdWords(booking({ kind: "hold", state: "hold", rank: 3 }))).toBe("3rd option");
    expect(holdWords(booking({ kind: "hold", state: "hold", rank: 11 }))).toBe("11th option");
    expect(holdWords(booking({ kind: "hold", state: "hold", rank: 22 }))).toBe("22nd option");
    expect(holdWords(booking({ kind: "hold", state: "hold", rank: 1, jointFlag: true }))).toBe("Joint 1st");
    expect(holdWords(booking({ kind: "hold", state: "hold", rank: null }))).toBe("Option");
  });

  it("puts Confirmed functions first, holds and provisionals quietly, by the day they start on the venue's clock", () => {
    const calendar = CalendarResponseSchema.parse({
      venueId: VENUE, range: { from: "2026-10-04T23:00:00.000Z", to: "2026-10-11T23:00:00.000Z" }, rooms: ROOMS,
      entries: [
        booking({ id: "00000000-0000-4000-8000-0000000009b1", title: "Wedding", eventName: "Robertson and Kaur wedding", eventId: EVENT, guestCount: 160 }),
        booking({ id: "00000000-0000-4000-8000-0000000009b2", title: "Burns supper", kind: "hold", state: "hold", rank: 1 }),
        booking({ id: "00000000-0000-4000-8000-0000000009b3", title: "Late ceilidh", startsAt: "2026-10-10T23:30:00.000Z", endsAt: "2026-10-11T02:00:00.000Z" }),
        booking({ id: "00000000-0000-4000-8000-0000000009b4", title: "Released", kind: "hold", state: "released", status: "released" }),
        booking({ id: "00000000-0000-4000-8000-0000000009b5", title: "Maintenance", kind: "internal_block", state: "internal_block" }),
      ],
      conflicts: { conflicts: [], checks: { inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" }, turnaround: { status: "checked", uncoveredPairCount: 0, detail: "" } } },
    });
    const days = functionsByDay(calendar, TZ);
    const saturday = days.get("2026-10-10");
    expect(saturday?.confirmed.map((line) => [line.title, line.room, line.times, line.guests, line.hold])).toEqual([["Robertson and Kaur wedding", "Grand Hall", "12:00–00:30", 160, null]]);
    expect(saturday?.likely.map((line) => [line.title, line.hold])).toEqual([["Burns supper", "1st option"]]);
    // 23:30 UTC on the 10th is 00:30 on Sunday in Glasgow.
    expect(days.get("2026-10-11")?.confirmed.map((line) => line.title)).toEqual(["Late ceilidh"]);
  });
});

describe("people", () => {
  const base = StaffRecordSchema.parse({
    id: MORAG, venueId: VENUE, userId: null, account: null, displayName: "Morag Sinclair", email: null, phone: null,
    employmentType: "employed", skills: ["setup", "bar"], barTrainedOn: "2025-04-01", turns18On: null,
    rightToWorkCheckedOn: "2025-03-01", rightToWorkExpiresOn: null, workingTimeOptOut: false, isActive: true, revision: 1,
    updatedAt: "2026-09-01T09:00:00.000Z",
  });

  it("says a person's employment and skills in a line", () => {
    expect(personMeta(base)).toBe("Employed · Set-up, Bar");
    expect(personMeta({ employmentType: "agency", skills: [] })).toBe("Agency");
  });

  it("says what a rota manager needs to know, and marks what needs doing", () => {
    expect(personFacts(base, "2026-10-05")).toEqual([{ text: "No account, so told in person", attention: false }]);
    expect(personFacts({ ...base, rightToWorkCheckedOn: null, barTrainedOn: null }, "2026-10-05")).toEqual([
      { text: "No right-to-work check recorded", attention: true },
      { text: "Bar training not recorded", attention: true },
      { text: "No account, so told in person", attention: false },
    ]);
    expect(personFacts({ ...base, rightToWorkExpiresOn: "2026-09-30" }, "2026-10-05")[0]).toEqual({ text: "Right to work ran out on 30 September 2026", attention: true });
    expect(personFacts({ ...base, rightToWorkExpiresOn: "2027-09-30" }, "2026-10-05")[0]).toEqual({ text: "Right to work checked to 30 September 2027", attention: false });
    expect(personFacts({ ...base, turns18On: "2027-03-02", workingTimeOptOut: true, account: { name: "Morag", email: "m@example.test" } }, "2026-10-05")).toEqual([
      { text: "Under 18 until 2 March 2027", attention: false },
      { text: "Opted out of the 48-hour week", attention: false },
      { text: "Told in the app", attention: false },
    ]);
  });

  it("writes leave as the whole days it covers", () => {
    expect(leaveSpan({ startsAt: "2026-10-09T23:00:00.000Z", endsAt: "2026-10-10T23:00:00.000Z" }, TZ)).toBe("Sat 10 Oct");
    expect(leaveSpan({ startsAt: "2026-10-08T23:00:00.000Z", endsAt: "2026-10-11T23:00:00.000Z" }, TZ)).toBe("Fri 9 – Sun 11 Oct");
    expect(leaveSpan({ startsAt: "2026-09-29T23:00:00.000Z", endsAt: "2026-10-02T23:00:00.000Z" }, TZ)).toBe("Wed 30 Sep – Fri 2 Oct");
  });
});
