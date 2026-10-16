import { describe, expect, it } from "vitest";
import { parseWhenEntry, type WhenEntryContext, type WhenEntryResult } from "../when-ribbon-entry.js";

// ---------------------------------------------------------------------------
// The When ribbon's typed natural-time parser (goal 19 S6, T-651).
//
// Every instant is asserted as an absolute ISO string against an explicit
// IANA zone, so the suite reads the same on any machine in any zone. The
// fixture day, 10 May 2030, is in British Summer Time (UTC+1); the DST cases
// move to the clock-change morning and to a GMT day in January.
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const LONDON = "Europe/London";

function context(overrides: Partial<WhenEntryContext> = {}): WhenEntryContext {
  return {
    date: "2030-05-10",
    timeZone: LONDON,
    current: null,
    defaultDurationMs: 5 * HOUR_MS,
    ...overrides,
  };
}

/** 18:00 to 23:00 on the venue's clock, 10 May 2030: the usual evening. */
const EVENING = {
  startMs: Date.parse("2030-05-10T17:00:00.000Z"),
  endMs: Date.parse("2030-05-10T22:00:00.000Z"),
};

type Window = Extract<WhenEntryResult, { kind: "window" }>;

function windowFor(text: string, overrides: Partial<WhenEntryContext> = {}): Window {
  const result = parseWhenEntry(text, context(overrides));
  if (result.kind !== "window") {
    throw new Error(`expected a window for ${JSON.stringify(text)}, got: ${result.hint}`);
  }
  return result;
}

function hintFor(text: string, overrides: Partial<WhenEntryContext> = {}): string {
  const result = parseWhenEntry(text, context(overrides));
  if (result.kind !== "unparsed") {
    throw new Error(`expected ${JSON.stringify(text)} to be refused, got a window`);
  }
  return result.hint;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : iso(ms);
}

function span(window: Window): readonly [string, string] {
  return [iso(window.startMs), iso(window.endMs)];
}

function echoed(window: Window): string {
  return window.assumptions.join(" | ");
}

describe("parseWhenEntry — the given cases", () => {
  it("1. 12-4pm reads the bare 12 as midday against the pm end", () => {
    const window = windowFor("12-4pm");
    expect(span(window)).toEqual(["2030-05-10T11:00:00.000Z", "2030-05-10T15:00:00.000Z"]);
    expect(window.liveMs).toBeNull();
    expect(echoed(window)).toMatch(/midday/u);
  });

  it("2. 7 for 7:30 opens the doors at 7, starts at 7:30 and runs the default length", () => {
    const window = windowFor("7 for 7:30");
    expect(iso(window.startMs)).toBe("2030-05-10T18:00:00.000Z");
    expect(isoOrNull(window.liveMs)).toBe("2030-05-10T18:30:00.000Z");
    expect(iso(window.endMs)).toBe("2030-05-10T23:00:00.000Z");
    expect(echoed(window)).toMatch(/pm/u);
    expect(echoed(window)).toMatch(/5 hours|5-hour/u);
  });

  it("3. 18:00-23:00 is explicit, so nothing is assumed", () => {
    const window = windowFor("18:00-23:00");
    expect(span(window)).toEqual(["2030-05-10T17:00:00.000Z", "2030-05-10T22:00:00.000Z"]);
    expect(window.assumptions).toEqual([]);
  });

  it("4. 6.30pm to 11.30pm", () => {
    expect(span(windowFor("6.30pm to 11.30pm"))).toEqual([
      "2030-05-10T17:30:00.000Z",
      "2030-05-10T22:30:00.000Z",
    ]);
  });

  it("5. 9-5 reads the end as pm and says so", () => {
    const window = windowFor("9-5");
    expect(span(window)).toEqual(["2030-05-10T08:00:00.000Z", "2030-05-10T16:00:00.000Z"]);
    expect(echoed(window)).toMatch(/5pm/u);
  });

  it("6. noon to 4", () => {
    expect(span(windowFor("noon to 4"))).toEqual(["2030-05-10T11:00:00.000Z", "2030-05-10T15:00:00.000Z"]);
  });

  it("7. 7pm till 1am rolls the end into the next day", () => {
    expect(span(windowFor("7pm till 1am"))).toEqual(["2030-05-10T18:00:00.000Z", "2030-05-11T00:00:00.000Z"]);
  });

  it("8. half 7 keeps the current window's length and says so", () => {
    const window = windowFor("half 7", { current: EVENING });
    expect(span(window)).toEqual(["2030-05-10T18:30:00.000Z", "2030-05-10T23:30:00.000Z"]);
    expect(echoed(window)).toMatch(/[Kk]ept.*5-hour/u);
  });

  it("9. from 6 with the current window", () => {
    expect(span(windowFor("from 6", { current: EVENING }))).toEqual([
      "2030-05-10T17:00:00.000Z",
      "2030-05-10T22:00:00.000Z",
    ]);
  });

  it("10. refuses empty text, nonsense, impossible hours and minutes, and a zero-length window", () => {
    for (const text of ["", "banana", "25:00", "7:75", "7 to 7"]) {
      const result = parseWhenEntry(text, context());
      expect(result.kind, text).toBe("unparsed");
      if (result.kind === "unparsed") expect(result.hint.length, text).toBeGreaterThan(0);
    }
  });

  it("11. DST: the clock-change morning is already BST, a January day is GMT", () => {
    expect(span(windowFor("12-4pm", { date: "2030-03-31" }))).toEqual([
      "2030-03-31T11:00:00.000Z",
      "2030-03-31T15:00:00.000Z",
    ]);
    expect(span(windowFor("12-4pm", { date: "2030-01-10" }))).toEqual([
      "2030-01-10T12:00:00.000Z",
      "2030-01-10T16:00:00.000Z",
    ]);
  });

  it("12. 4pm to 2am", () => {
    expect(span(windowFor("4pm to 2am"))).toEqual(["2030-05-10T15:00:00.000Z", "2030-05-11T01:00:00.000Z"]);
  });

  it("13. every result instant is a whole minute", () => {
    const entries = [
      "12-4pm", "7 for 7:30", "18:00-23:00", "6.30pm to 11.30pm", "9-5", "noon to 4",
      "7pm till 1am", "half 7", "from 6", "4pm to 2am", "quarter to 8", "7 till late",
      "7:07pm to 9:49pm", "7 for 7:30 till 11", "midnight to 2am",
    ];
    for (const text of entries) {
      for (const current of [null, EVENING]) {
        const window = windowFor(text, { current });
        expect(window.startMs % MINUTE_MS, text).toBe(0);
        expect(window.endMs % MINUTE_MS, text).toBe(0);
        if (window.liveMs !== null) expect(window.liveMs % MINUTE_MS, text).toBe(0);
      }
    }
  });
});

describe("parseWhenEntry — markers and inference", () => {
  it("a pm end settles a bare start: 7-11pm", () => {
    const window = windowFor("7-11pm");
    expect(span(window)).toEqual(["2030-05-10T18:00:00.000Z", "2030-05-10T22:00:00.000Z"]);
    expect(echoed(window)).toMatch(/7 as 7pm/u);
  });

  it("an am end settles a bare start the other way: 7 to 11am", () => {
    const window = windowFor("7 to 11am");
    expect(span(window)).toEqual(["2030-05-10T06:00:00.000Z", "2030-05-10T10:00:00.000Z"]);
    expect(echoed(window)).toMatch(/7 as 7am/u);
  });

  it("an exact start settles a bare end to the soonest reading: 10pm to 9 is the next morning", () => {
    const window = windowFor("10pm to 9");
    expect(span(window)).toEqual(["2030-05-10T21:00:00.000Z", "2030-05-11T08:00:00.000Z"]);
    expect(echoed(window)).toMatch(/9 as 9am/u);
  });

  it("all bare: 7 to 1 rolls the end by twelve hours into the next morning", () => {
    const window = windowFor("7 to 1");
    expect(span(window)).toEqual(["2030-05-10T18:00:00.000Z", "2030-05-11T00:00:00.000Z"]);
    expect(echoed(window)).toMatch(/1 as 1am/u);
  });

  it("all bare: 11 to 10 is a morning start and an evening end", () => {
    expect(span(windowFor("11 to 10"))).toEqual(["2030-05-10T10:00:00.000Z", "2030-05-10T21:00:00.000Z"]);
  });

  it("all bare: 7-12 ends at midnight", () => {
    const window = windowFor("7-12");
    expect(span(window)).toEqual(["2030-05-10T18:00:00.000Z", "2030-05-10T23:00:00.000Z"]);
    expect(echoed(window)).toMatch(/12 as midnight/u);
  });

  it("all bare: 8-10 is a morning, and both readings are echoed", () => {
    const window = windowFor("8-10");
    expect(span(window)).toEqual(["2030-05-10T07:00:00.000Z", "2030-05-10T09:00:00.000Z"]);
    expect(window.assumptions).toEqual(["Took 8 as 8am", "Took 10 as 10am"]);
  });

  it("12 to 2am reads the 12 as midnight", () => {
    const window = windowFor("12 to 2am");
    expect(span(window)).toEqual(["2030-05-09T23:00:00.000Z", "2030-05-10T01:00:00.000Z"]);
    expect(echoed(window)).toMatch(/12 as midnight/u);
  });

  it("12 noon to 4 is explicit about noon, so only the end is assumed", () => {
    const window = windowFor("12 noon to 4");
    expect(span(window)).toEqual(["2030-05-10T11:00:00.000Z", "2030-05-10T15:00:00.000Z"]);
    expect(window.assumptions).toHaveLength(1);
    expect(echoed(window)).toMatch(/4 as 4pm/u);
  });

  it("midday to midnight assumes nothing", () => {
    const window = windowFor("midday to midnight");
    expect(span(window)).toEqual(["2030-05-10T11:00:00.000Z", "2030-05-10T23:00:00.000Z"]);
    expect(window.assumptions).toEqual([]);
  });

  it("the word midnight is the midnight that ends the shown day, even as a start", () => {
    expect(span(windowFor("midnight to 2am"))).toEqual(["2030-05-10T23:00:00.000Z", "2030-05-11T01:00:00.000Z"]);
  });

  it("a numeric midnight start is the small hours of the shown day", () => {
    expect(span(windowFor("12am to 2am"))).toEqual(["2030-05-09T23:00:00.000Z", "2030-05-10T01:00:00.000Z"]);
    const window = windowFor("00:00-02:00");
    expect(span(window)).toEqual(["2030-05-09T23:00:00.000Z", "2030-05-10T01:00:00.000Z"]);
    expect(echoed(window)).toMatch(/midnight/u);
  });

  it("7 till late ends at midnight and says so", () => {
    const window = windowFor("7 till late");
    expect(span(window)).toEqual(["2030-05-10T18:00:00.000Z", "2030-05-10T23:00:00.000Z"]);
    expect(echoed(window)).toMatch(/late as midnight/u);
  });
});

describe("parseWhenEntry — forms", () => {
  it("24-hour forms: four digits are explicit, three stay open", () => {
    const explicit = windowFor("0730 to 0900");
    expect(span(explicit)).toEqual(["2030-05-10T06:30:00.000Z", "2030-05-10T08:00:00.000Z"]);
    expect(explicit.assumptions).toEqual([]);
    expect(span(windowFor("730 to 930"))).toEqual(["2030-05-10T18:30:00.000Z", "2030-05-10T20:30:00.000Z"]);
    const evening = windowFor("1930-2330");
    expect(span(evening)).toEqual(["2030-05-10T18:30:00.000Z", "2030-05-10T22:30:00.000Z"]);
    expect(evening.assumptions).toEqual([]);
  });

  it("a.m./p.m., capitals, en and em dashes and o'clock all read", () => {
    expect(span(windowFor("7.30 p.m. to 11 p.m."))).toEqual(["2030-05-10T18:30:00.000Z", "2030-05-10T22:00:00.000Z"]);
    expect(span(windowFor("7 PM – 11 PM"))).toEqual(["2030-05-10T18:00:00.000Z", "2030-05-10T22:00:00.000Z"]);
    expect(span(windowFor("7—11pm"))).toEqual(["2030-05-10T18:00:00.000Z", "2030-05-10T22:00:00.000Z"]);
    expect(span(windowFor("7 o'clock till 11pm"))).toEqual(["2030-05-10T18:00:00.000Z", "2030-05-10T22:00:00.000Z"]);
  });

  it("half, quarter past and quarter to", () => {
    expect(iso(windowFor("half 7").startMs)).toBe("2030-05-10T18:30:00.000Z");
    expect(iso(windowFor("half past 7").startMs)).toBe("2030-05-10T18:30:00.000Z");
    expect(iso(windowFor("quarter past 7").startMs)).toBe("2030-05-10T18:15:00.000Z");
    const quarterTo = windowFor("quarter to 8");
    expect(iso(quarterTo.startMs)).toBe("2030-05-10T18:45:00.000Z");
    expect(echoed(quarterTo)).toMatch(/quarter to 8 as 7:45pm/u);
    expect(iso(windowFor("quarter to 8pm").startMs)).toBe("2030-05-10T18:45:00.000Z");
    expect(span(windowFor("9am to quarter to 12pm"))).toEqual(["2030-05-10T08:00:00.000Z", "2030-05-10T10:45:00.000Z"]);
    expect(span(windowFor("11pm to quarter to 1am"))).toEqual(["2030-05-10T22:00:00.000Z", "2030-05-10T23:45:00.000Z"]);
  });

  it("between X and Y, X onwards, at X", () => {
    expect(span(windowFor("between 7 and 11"))).toEqual(["2030-05-10T18:00:00.000Z", "2030-05-10T22:00:00.000Z"]);
    expect(span(windowFor("7pm onwards"))).toEqual(["2030-05-10T18:00:00.000Z", "2030-05-10T23:00:00.000Z"]);
    expect(span(windowFor("at 7"))).toEqual(["2030-05-10T18:00:00.000Z", "2030-05-10T23:00:00.000Z"]);
  });

  it("typed times are exact and never snapped", () => {
    expect(span(windowFor("7:07pm to 9:49pm"))).toEqual(["2030-05-10T18:07:00.000Z", "2030-05-10T20:49:00.000Z"]);
  });

  it("the zone is the context's, not the machine's", () => {
    expect(span(windowFor("12-4pm", { timeZone: "America/New_York" }))).toEqual([
      "2030-05-10T16:00:00.000Z",
      "2030-05-10T20:00:00.000Z",
    ]);
  });
});

describe("parseWhenEntry — doors and start", () => {
  it("7 for 7:30 till 11 carries doors, start and end", () => {
    const window = windowFor("7 for 7:30 till 11");
    expect(iso(window.startMs)).toBe("2030-05-10T18:00:00.000Z");
    expect(isoOrNull(window.liveMs)).toBe("2030-05-10T18:30:00.000Z");
    expect(iso(window.endMs)).toBe("2030-05-10T22:00:00.000Z");
  });

  it("7pm for 7:30 settles the start against the doors", () => {
    const window = windowFor("7pm for 7:30");
    expect(isoOrNull(window.liveMs)).toBe("2030-05-10T18:30:00.000Z");
    expect(echoed(window)).toMatch(/7:30 as 7:30pm/u);
  });

  it("7 for 7:30pm till 11 anchors the bare doors on the explicit start", () => {
    const window = windowFor("7 for 7:30pm till 11");
    expect(iso(window.startMs)).toBe("2030-05-10T18:00:00.000Z");
    expect(isoOrNull(window.liveMs)).toBe("2030-05-10T18:30:00.000Z");
    expect(iso(window.endMs)).toBe("2030-05-10T22:00:00.000Z");
  });

  it("refuses a start that is not after the doors, or not before the end", () => {
    for (const text of ["7 for 7", "7pm for 7am", "7 for 7:30 till 7:15"]) {
      expect(hintFor(text).length, text).toBeGreaterThan(0);
    }
  });
});

describe("parseWhenEntry — lengths", () => {
  it("only a start and no current window: the default length, echoed", () => {
    const window = windowFor("noon");
    expect(span(window)).toEqual(["2030-05-10T11:00:00.000Z", "2030-05-10T16:00:00.000Z"]);
    expect(window.assumptions).toHaveLength(1);
    expect(echoed(window)).toMatch(/5 hours/u);
  });

  it("a current window too short to keep falls back to the default", () => {
    const current = { startMs: EVENING.startMs, endMs: EVENING.startMs + 5 * MINUTE_MS };
    const window = windowFor("from 6", { current });
    expect(span(window)).toEqual(["2030-05-10T17:00:00.000Z", "2030-05-10T22:00:00.000Z"]);
    expect(echoed(window)).toMatch(/5 hours/u);
    expect(echoed(window)).not.toMatch(/[Kk]ept/u);
  });

  it("half-hour and minute lengths read naturally", () => {
    const halfHours = { startMs: EVENING.startMs, endMs: EVENING.startMs + 4.5 * HOUR_MS };
    expect(echoed(windowFor("6", { current: halfHours }))).toMatch(/4½-hour/u);
    const minutes = { startMs: EVENING.startMs, endMs: EVENING.startMs + 45 * MINUTE_MS };
    expect(echoed(windowFor("6", { current: minutes }))).toMatch(/45-minute/u);
  });

  it("refuses windows shorter than fifteen minutes or longer than a day", () => {
    expect(hintFor("7pm to 7:10pm")).toMatch(/15/u);
    const dayAndMore = {
      startMs: Date.parse("2030-05-10T00:00:00.000Z"),
      endMs: Date.parse("2030-05-11T06:00:00.000Z"),
    };
    expect(hintFor("6", { current: dayAndMore }).length).toBeGreaterThan(0);
  });
});

describe("parseWhenEntry — refusals", () => {
  it("each refusal carries a hint", () => {
    const refused = ["13am", "7:5", "7 to 11 and more", "to 11", "7 to", "late", "-", "12 to 12", "7am to 7am", "24:00", "7 for", "7 ? 11"];
    for (const text of refused) {
      expect(hintFor(text).length, text).toBeGreaterThan(0);
    }
  });

  it("names the problem for impossible hours and minutes, and shows the forms for nothing", () => {
    expect(hintFor("25:00")).toMatch(/24 hours/u);
    expect(hintFor("7:75")).toMatch(/[Mm]inutes/u);
    expect(hintFor("")).toMatch(/12-4pm/u);
    expect(hintFor("banana")).toMatch(/7 for 7:30/u);
  });
});

describe("parseWhenEntry — client-safe copy", () => {
  it("never speaks in booking jargon", () => {
    const entries = [
      "", "banana", "25:00", "7:75", "7 to 7", "7 for 7", "7pm for 7am", "7 for 7:30 till 7:15",
      "7pm to 7:10pm", "13am", "7:5", "12-4pm", "7 for 7:30", "9-5", "noon to 4", "7pm till 1am",
      "half 7", "from 6", "quarter to 8", "7 till late", "7-12", "12 to 2am", "00:00-02:00",
      "8-10", "10pm to 9", "noon", "6",
    ];
    const forbidden = /\b(pencil\w*|ink(ed|s)?|hold(s|ing)?)\b/iu;
    const lengths = [null, EVENING, { startMs: EVENING.startMs, endMs: EVENING.startMs + 45 * MINUTE_MS }];
    for (const text of entries) {
      for (const current of lengths) {
        const result = parseWhenEntry(text, context({ current }));
        const lines = result.kind === "window" ? result.assumptions : [result.hint];
        for (const line of lines) {
          expect(line, text).not.toMatch(forbidden);
          expect(line.length, text).toBeGreaterThan(0);
        }
      }
    }
  });
});
