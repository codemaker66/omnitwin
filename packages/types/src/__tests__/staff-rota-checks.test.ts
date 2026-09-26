import { describe, expect, it } from "vitest";
import {
  addRotaDays,
  checkRotaWorkingTime,
  resolveRotaTimeZone,
  rotaClock,
  rotaDurationShort,
  rotaDurationWords,
  rotaInstant,
  rotaLocalDate,
  rotaMondayOf,
  rotaNoticeHours,
  rotaPublishBlocks,
  rotaSaveBlocks,
  rotaWeekBounds,
  rotaWeekStartOf,
  withKeptWarnings,
  type RotaCheckAbsence,
  type RotaCheckPerson,
  type RotaCheckShift,
  type RotaFinding,
} from "../staff-rota-checks.js";
import type { RotaShiftStatus, RotaSkill } from "../staff-rota.js";

// ---------------------------------------------------------------------------
// The rota's working-time checks: each rule in the venue's own clock, in the
// words a veteran would use, with the two legal blocks kept apart from the
// warnings a manager may keep with a reason.
// ---------------------------------------------------------------------------

const LONDON = "Europe/London";
const HOUR = 3_600_000;

const MORAG: RotaCheckPerson = {
  displayName: "Morag",
  turns18On: null,
  barTrainedOn: "2025-03-01",
  rightToWorkCheckedOn: "2025-02-01",
  rightToWorkExpiresOn: null,
  workingTimeOptOut: false,
};

const AILEEN: RotaCheckPerson = { ...MORAG, displayName: "Aileen", turns18On: "2027-06-01" };

let counter = 0;
/** A shift on the venue's clock: `date` at `from` to `to` ("HH:MM"; a `to`
 *  at or before `from` runs past midnight). */
function shift(date: string, from: string, to: string, options: {
  readonly role?: RotaSkill; readonly breakMinutes?: number; readonly status?: RotaShiftStatus; readonly id?: string;
} = {}): RotaCheckShift {
  counter += 1;
  const minutes = (clock: string): number => {
    const [hours = 0, mins = 0] = clock.split(":").map(Number);
    return hours * 60 + mins;
  };
  const start = minutes(from);
  let end = minutes(to);
  if (end <= start) end += 24 * 60;
  return {
    id: options.id ?? `shift-${String(counter).padStart(4, "0")}`,
    role: options.role ?? "setup",
    startsAt: new Date(rotaInstant(date, start, LONDON)).toISOString(),
    endsAt: new Date(rotaInstant(date, end, LONDON)).toISOString(),
    breakMinutes: options.breakMinutes ?? 0,
    status: options.status ?? "draft",
  };
}

function check(person: RotaCheckPerson, shifts: readonly RotaCheckShift[], absences: readonly RotaCheckAbsence[] = []) {
  return checkRotaWorkingTime({ person, shifts, absences, timeZone: LONDON });
}

function codes(findings: readonly RotaFinding[] | undefined): string[] {
  return (findings ?? []).map((finding) => finding.code);
}

describe("the venue's clock", () => {
  it("reads times in the venue's zone, summer and winter", () => {
    expect(new Date(rotaInstant("2026-10-10", 8 * 60, LONDON)).toISOString()).toBe("2026-10-10T07:00:00.000Z");
    expect(new Date(rotaInstant("2026-11-07", 8 * 60, LONDON)).toISOString()).toBe("2026-11-07T08:00:00.000Z");
    expect(rotaLocalDate(Date.parse("2026-10-10T23:30:00Z"), LONDON)).toBe("2026-10-11");
    expect(rotaClock(Date.parse("2026-07-01T17:00:00Z"), LONDON)).toBe("18:00");
    expect(rotaClock(Date.parse("2026-07-01T17:00:00Z"), "America/New_York")).toBe("13:00");
  });

  it("gives a week with a clock change its real length", () => {
    const autumn = rotaWeekBounds("2026-10-19", LONDON);
    expect((autumn.toMs - autumn.fromMs) / HOUR).toBe(169);
    const spring = rotaWeekBounds("2026-03-23", LONDON);
    expect((spring.toMs - spring.fromMs) / HOUR).toBe(167);
    const ordinary = rotaWeekBounds("2026-10-05", LONDON);
    expect(new Date(ordinary.fromMs).toISOString()).toBe("2026-10-04T23:00:00.000Z");
    expect((ordinary.toMs - ordinary.fromMs) / HOUR).toBe(168);
  });

  it("finds the Monday of a week, by the venue's calendar", () => {
    expect(rotaMondayOf("2026-10-11")).toBe("2026-10-05");
    expect(rotaMondayOf("2026-10-05")).toBe("2026-10-05");
    expect(addRotaDays("2026-12-30", 3)).toBe("2027-01-02");
    // 23:30 UTC on Sunday is already Monday in a British summer.
    expect(rotaWeekStartOf(Date.parse("2026-10-11T23:30:00Z"), LONDON)).toBe("2026-10-12");
  });

  it("falls back to Europe/London for a zone it cannot read", () => {
    expect(resolveRotaTimeZone("Nowhere/Atlantis")).toBe(LONDON);
    expect(resolveRotaTimeZone(null)).toBe(LONDON);
    expect(resolveRotaTimeZone("Europe/Dublin")).toBe("Europe/Dublin");
  });

  it("says durations the way people do", () => {
    expect(rotaDurationWords(9 * 60)).toBe("9 hours");
    expect(rotaDurationWords(61)).toBe("1 hour 1 minute");
    expect(rotaDurationWords(45)).toBe("45 minutes");
    expect(rotaDurationShort(9 * 60 + 30)).toBe("9 h 30");
    expect(rotaDurationShort(45)).toBe("45 min");
  });

  it("counts notice in whole hours, and none once a shift has begun", () => {
    const start = Date.parse("2026-10-10T07:00:00Z");
    expect(rotaNoticeHours(start - 30.9 * HOUR, start)).toBe(30);
    expect(rotaNoticeHours(start + HOUR, start)).toBe(0);
  });
});

describe("rest between shifts", () => {
  it("says what is short, in the venue's words", () => {
    const friday = shift("2026-10-09", "17:00", "23:30", { role: "bar", breakMinutes: 20 });
    const saturday = shift("2026-10-10", "08:30", "16:00", { breakMinutes: 20 });
    const found = check(MORAG, [friday, saturday]);
    expect(found.get(friday.id)).toBeUndefined();
    expect(found.get(saturday.id)).toEqual([{
      code: "short_rest", severity: "warning",
      message: "Morag would have 9 hours between Friday's bar shift and Saturday's set-up; 11 are needed.",
      short: "9 h rest before; 11 needed",
    }]);
  });

  it("is content with exactly 11 hours, and asks 12 for an under-18", () => {
    const evening = shift("2026-10-09", "12:00", "21:00", { breakMinutes: 30 });
    const morning = shift("2026-10-10", "08:00", "12:00");
    expect(codes(check(MORAG, [evening, morning]).get(morning.id))).toEqual([]);
    const young = check(AILEEN, [evening, morning]).get(morning.id);
    expect(young?.[0]?.message).toBe("Aileen would have 11 hours between Friday's set-up and Saturday's set-up; 12 are needed for someone under 18.");
  });

  it("treats a split shift within one day as one working day", () => {
    // The daily rest falls between working days, not in the gap of a split.
    const early = shift("2026-10-10", "06:00", "10:00");
    const late = shift("2026-10-10", "18:00", "23:00", { role: "bar" });
    const found = check(MORAG, [early, late]);
    expect([...found.values()].flat()).toEqual([]);
    // A late finish belongs to the day it started: 02:00 to 09:00 is short.
    const night = shift("2026-10-09", "18:00", "02:00", { breakMinutes: 30 });
    const next = shift("2026-10-10", "09:00", "13:00");
    expect(check(MORAG, [night, next]).get(next.id)?.[0]?.message)
      .toBe("Morag would have 7 hours between Friday's set-up and Saturday's set-up; 11 are needed.");
  });

  it("measures real hours across the autumn clock change, never wall-clock sums", () => {
    // 23:00 BST to 09:00 GMT reads as 10 hours on a clock face but is 11.
    const saturday = shift("2026-10-24", "15:00", "23:00", { breakMinutes: 20 });
    const sunday = shift("2026-10-25", "09:00", "13:00");
    expect(sunday.startsAt).toBe("2026-10-25T09:00:00.000Z");
    expect(codes(check(MORAG, [saturday, sunday]).get(sunday.id))).toEqual([]);
  });

  it("says when two shifts overlap, rather than counting rest", () => {
    const one = shift("2026-10-10", "12:00", "18:00");
    const two = shift("2026-10-10", "17:00", "23:00", { role: "bar" });
    expect(check(MORAG, [one, two]).get(two.id)).toEqual([{
      code: "double_booked", severity: "warning",
      message: "Morag is also on Saturday's set-up, 12:00 to 18:00.",
      short: "Overlaps another shift",
    }]);
  });

  it("ignores a cancelled shift", () => {
    const cancelled = shift("2026-10-09", "17:00", "23:30", { status: "cancelled" });
    const saturday = shift("2026-10-10", "08:30", "16:00", { breakMinutes: 20 });
    expect(codes(check(MORAG, [cancelled, saturday]).get(saturday.id))).toEqual([]);
  });
});

describe("breaks within a shift", () => {
  it("asks for 20 minutes over six hours' work", () => {
    const long = shift("2026-10-10", "09:00", "17:30");
    expect(check(MORAG, [long]).get(long.id)).toEqual([{
      code: "no_break", severity: "warning",
      message: "Morag's set-up on Saturday runs 8 hours 30 minutes with no break; 20 minutes are needed over 6 hours.",
      short: "No break; 20 min needed",
    }]);
    const rested = shift("2026-10-10", "09:00", "17:30", { breakMinutes: 20 });
    expect(codes(check(MORAG, [rested]).get(rested.id))).toEqual([]);
    const six = shift("2026-10-10", "09:00", "15:00");
    expect(codes(check(MORAG, [six]).get(six.id))).toEqual([]);
  });

  it("asks an under-18 for 30 minutes over four and a half hours", () => {
    const five = shift("2026-10-10", "10:00", "15:20", { breakMinutes: 20 });
    expect(check(AILEEN, [five]).get(five.id)?.[0]?.message)
      .toBe("Aileen's set-up on Saturday runs 5 hours 20 minutes with a 20-minute break; as Aileen is under 18, 30 minutes are needed over 4 hours 30 minutes.");
  });
});

describe("a day off in each week", () => {
  it("keeps quiet for six days on and Sunday off", () => {
    const week = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]
      .map((date) => shift(date, "09:00", "17:00", { breakMinutes: 30 }));
    const found = check(MORAG, week);
    expect([...found.values()].flat()).toEqual([]);
  });

  it("speaks on the week's last shift when there is no 24 hours off", () => {
    const week = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]
      .map((date) => shift(date, "09:00", "17:00", { breakMinutes: 30 }));
    const found = check(MORAG, week);
    const last = week[6];
    if (last === undefined) throw new Error("expected seven shifts");
    expect(found.get(last.id)).toEqual([{
      code: "no_day_off", severity: "warning",
      message: "Morag would not have 24 hours off in the week of 5 October; the longest break is 16 hours.",
      short: "No 24 hours off this week",
    }]);
    expect([...found.keys()]).toEqual([last.id]);
  });

  it("asks 48 hours off for an under-18", () => {
    const week = ["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-10", "2026-10-11"]
      .map((date) => shift(date, "10:00", "14:00"));
    const last = week[4];
    if (last === undefined) throw new Error("expected five shifts");
    expect(codes(check(AILEEN, week).get(last.id))).toEqual(["no_day_off"]);
    expect(codes(check(MORAG, week).get(last.id))).toEqual([]);
  });
});

describe("the 48-hour average", () => {
  function heavyWeeks(weeks: number): RotaCheckShift[] {
    const out: RotaCheckShift[] = [];
    for (let week = 0; week < weeks; week += 1) {
      const monday = addRotaDays("2026-06-15", 7 * week);
      for (let day = 0; day < 5; day += 1) out.push(shift(addRotaDays(monday, day), "08:00", "18:30", { breakMinutes: 30 }));
    }
    return out;
  }

  it("warns when seventeen weeks average over 48 hours", () => {
    const shifts = heavyWeeks(17);
    const found = check(MORAG, shifts);
    const last = shifts[shifts.length - 1];
    if (last === undefined) throw new Error("expected shifts");
    expect(found.get(last.id)).toEqual([{
      code: "long_average", severity: "warning",
      message: "Morag's hours would average 50 a week over the 17 weeks to 11 October; the limit is 48 unless Morag opts out in writing.",
      short: "Averages 50 hours a week",
    }]);
  });

  it("keeps quiet for someone who has opted out, and over a shorter record", () => {
    const shifts = heavyWeeks(17);
    expect([...check({ ...MORAG, workingTimeOptOut: true }, shifts).values()].flat()).toEqual([]);
    // Two heavy weeks alone average under 48 over seventeen.
    expect([...check(MORAG, heavyWeeks(2)).values()].flat()).toEqual([]);
  });
});

describe("under-18s", () => {
  it("never between midnight and 04:00: a block, not a warning", () => {
    const late = shift("2026-10-10", "20:00", "01:00", { breakMinutes: 30 });
    const found = check(AILEEN, [late]).get(late.id) ?? [];
    expect(found.map((finding) => [finding.code, finding.severity])).toEqual([["young_small_hours", "block"]]);
    expect(found[0]?.message).toBe("Aileen is under 18, so cannot work between midnight and 04:00. This shift runs 20:00 to 01:00.");
    expect(rotaSaveBlocks(found)).toHaveLength(1);
    // An adult may work it.
    expect(codes(check(MORAG, [late]).get(late.id))).toEqual([]);
  });

  it("warns on work between 22:00 and 06:00", () => {
    const evening = shift("2026-10-10", "19:00", "23:00");
    expect(codes(check(AILEEN, [evening]).get(evening.id))).toEqual(["young_night"]);
    const dawn = shift("2026-10-10", "05:00", "09:00");
    expect(codes(check(AILEEN, [dawn]).get(dawn.id))).toEqual(["young_night"]);
    const day = shift("2026-10-10", "09:00", "13:00");
    expect(codes(check(AILEEN, [day]).get(day.id))).toEqual([]);
  });

  it("warns over 8 hours a day and 40 a week", () => {
    const morning = shift("2026-10-10", "07:00", "11:00");
    const afternoon = shift("2026-10-10", "12:00", "17:30", { breakMinutes: 30 });
    const day = check(AILEEN, [morning, afternoon]).get(afternoon.id);
    expect(codes(day)).toContain("young_long_day");
    expect(day?.find((finding) => finding.code === "young_long_day")?.message)
      .toBe("Aileen is under 18, so should work no more than 8 hours a day; Saturday's shifts come to 9 hours.");

    // Six days of seven hours: no day over eight, 42 in the week, and no two
    // days off together either.
    const week = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]
      .map((date) => shift(date, "09:00", "16:30", { breakMinutes: 30 }));
    const last = week[5];
    if (last === undefined) throw new Error("expected six shifts");
    const found = check(AILEEN, week);
    expect(codes(found.get(last.id))).toEqual(["young_long_week", "no_day_off"]);
    expect(found.get(last.id)?.[0]?.message)
      .toBe("Aileen is under 18, so should work no more than 40 hours a week; the week of 5 October comes to 42 hours.");
  });

  it("stops being young on the eighteenth birthday", () => {
    const late = shift("2027-06-01", "20:00", "01:00", { breakMinutes: 30 });
    expect(codes(check(AILEEN, [late]).get(late.id))).toEqual([]);
  });
});

describe("the law before the first shift", () => {
  it("blocks publishing a draft for someone with no right-to-work check", () => {
    const draft = shift("2026-10-10", "09:00", "13:00");
    const published = shift("2026-10-11", "09:00", "13:00", { status: "published" });
    const found = check({ ...MORAG, rightToWorkCheckedOn: null }, [draft, published]);
    expect(found.get(draft.id)).toEqual([{
      code: "right_to_work_missing", severity: "block",
      message: "Morag has no right-to-work check recorded, so this shift cannot be published until one is.",
      short: "No right-to-work check",
    }]);
    expect(rotaPublishBlocks(found.get(draft.id) ?? [])).toHaveLength(1);
    expect(rotaSaveBlocks(found.get(draft.id) ?? [])).toHaveLength(0);
    expect(found.get(published.id)).toBeUndefined();
  });

  it("warns once the check has run out", () => {
    const after = shift("2026-10-10", "09:00", "13:00");
    const found = check({ ...MORAG, rightToWorkExpiresOn: "2026-09-01" }, [after]);
    expect(found.get(after.id)?.[0]?.message)
      .toBe("Morag's right-to-work check ran to 1 September 2026; a follow-up check is needed before this shift.");
  });

  it("warns on a bar shift without bar training", () => {
    const bar = shift("2026-10-10", "17:00", "23:00", { role: "bar" });
    expect(check({ ...MORAG, barTrainedOn: null }, [bar]).get(bar.id)?.[0]?.message)
      .toBe("Morag has no bar training recorded. Anyone who sells alcohol needs it first.");
    expect(check({ ...MORAG, barTrainedOn: "2026-10-12" }, [bar]).get(bar.id)?.[0]?.short).toBe("Bar training comes after this");
    expect(codes(check(MORAG, [bar]).get(bar.id))).toEqual([]);
    const setup = shift("2026-10-10", "09:00", "13:00");
    expect(codes(check({ ...MORAG, barTrainedOn: null }, [setup]).get(setup.id))).toEqual([]);
  });
});

describe("leave and unavailability", () => {
  it("names whole days of leave and part-day unavailability", () => {
    const saturday = shift("2026-10-10", "09:00", "13:00");
    const leave: RotaCheckAbsence = {
      reason: "leave",
      startsAt: new Date(rotaInstant("2026-10-09", 0, LONDON)).toISOString(),
      endsAt: new Date(rotaInstant("2026-10-12", 0, LONDON)).toISOString(),
    };
    expect(check(MORAG, [saturday], [leave]).get(saturday.id)?.[0]?.message)
      .toBe("Morag is on leave from Friday 9 October to Sunday 11 October.");
    const busy: RotaCheckAbsence = {
      reason: "unavailable",
      startsAt: new Date(rotaInstant("2026-10-10", 12 * 60, LONDON)).toISOString(),
      endsAt: new Date(rotaInstant("2026-10-10", 20 * 60, LONDON)).toISOString(),
    };
    expect(check(MORAG, [saturday], [busy]).get(saturday.id)?.[0]?.message)
      .toBe("Morag is marked unavailable on Saturday 10 October, 12:00 to 20:00.");
    const sunday = shift("2026-10-11", "09:00", "13:00");
    expect(codes(check(MORAG, [sunday], [busy]).get(sunday.id))).toEqual([]);
  });
});

describe("keeping a warning", () => {
  it("attaches the reason to the warning it names, never to a block", () => {
    const findings: RotaFinding[] = [
      { code: "short_rest", severity: "warning", message: "m", short: "s" },
      { code: "young_small_hours", severity: "block", message: "m", short: "s" },
    ];
    const kept = withKeptWarnings(findings, [
      { code: "short_rest", reason: "Swapped with Callum; rest given on Monday", byUserId: null, byName: "Elaine", at: "2026-10-01T09:00:00.000Z" },
    ]);
    expect(kept[0]?.kept?.reason).toBe("Swapped with Callum; rest given on Monday");
    expect(kept[1]?.kept).toBeNull();
  });
});
