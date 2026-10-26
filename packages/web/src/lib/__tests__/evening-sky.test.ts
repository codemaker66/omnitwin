import { describe, expect, it } from "vitest";
import {
  bodyEvents,
  bodyRuns,
  chipGlyph,
  degreesScale,
  moodForSun,
  moonRiseAfter,
  skyAt,
  skyBand,
  skySentence,
  skySpoken,
  skyStars,
  splitRun,
  sunHighest,
} from "../evening-sky.js";
import { formatWallTime } from "../../pages/diary/lib/board-time.js";

// ---------------------------------------------------------------------------
// The evening's sky over the hall (spec 6.2, section 15's measured sky: on
// Sat 28 Nov 2026 sunrise 08:18, sunset 15:51, moonrise 20:09; at 21:41 the
// moon is 75 % lit, waning, about 10° up in the east-north-east; at 19:30 it
// is below the horizon).
// ---------------------------------------------------------------------------

const t = (iso: string): number => Date.parse(iso);
const EVENING = { start: t("2026-11-28T17:00:00Z"), end: t("2026-11-29T01:15:00Z") };

describe("what is up over the hall", () => {
  it("reads frame 03's sky at 21:41", () => {
    const reading = skyAt(t("2026-11-28T21:41:00Z"));
    expect(reading.sun.up).toBe(false);
    expect(reading.moon.up).toBe(true);
    expect(Math.round(reading.moon.illuminated * 100)).toBe(75);
    expect(reading.moon.waxing).toBe(false);
    expect(skySentence(reading, { moonrise: null })).toBe("Moon 75% lit, 10° up in the east-north-east");
    expect(skySentence(reading, { moonrise: null, compact: true })).toBe("Moon 75% lit, 10° up, east-north-east");
    expect(skySpoken(reading, { moonrise: null })).toBe("moon 75% lit, 10 degrees up");
  });

  it("finds moonrise at 20:09, and says so while the moon is down at 19:30", () => {
    const rise = moonRiseAfter(t("2026-11-28T19:30:00Z"));
    expect(rise).not.toBeNull();
    expect(formatWallTime(rise ?? 0)).toBe("20:09");
    const reading = skyAt(t("2026-11-28T19:30:00Z"));
    expect(reading.moon.up).toBe(false);
    // Waning: two hours earlier it is a little fuller.
    expect(skySentence(reading, { moonrise: rise })).toBe("Moon 76% lit, rises at 20:09");
    expect(chipGlyph(reading)).toEqual({ kind: "moon", lit: reading.moon.illuminated, waxing: false, risen: false });
  });

  it("says the sun by day, with its time on the floor when it has one", () => {
    const noon = skyAt(t("2026-11-28T12:00:00Z"));
    expect(noon.sun.up).toBe(true);
    expect(chipGlyph(noon)).toEqual({ kind: "sun" });
    expect(skySentence(noon, { moonrise: null })).toBe("Sun 13° up in the south");
    expect(skySentence(noon, { moonrise: null, floor: { start: t("2026-11-28T11:53:00Z"), end: t("2026-11-28T11:57:00Z") } }))
      .toBe("Sun 13° up in the south · on the floor 11:53 to 11:57");
    expect(skySpoken(noon, { moonrise: null })).toBe("sun 13 degrees up");
  });

  it("finds sunrise 08:18 and sunset 15:51 on the venue's day", () => {
    const day = { start: t("2026-11-28T06:00:00Z"), end: t("2026-11-29T06:00:00Z") };
    const sun = bodyEvents(day, "sun");
    expect(sun.rises.map((time) => formatWallTime(time))).toEqual(["08:18"]);
    expect(sun.sets.map((time) => formatWallTime(time))).toEqual(["15:51"]);
    expect(bodyEvents(EVENING, "moon").rises.map((time) => formatWallTime(time))).toEqual(["20:09"]);
  });
});

describe("the light the hour sets where the real sky is off", () => {
  it("is daylight above 6°, evening to 6° down, candlelight after", () => {
    expect(moodForSun(12)).toBe("daylight");
    expect(moodForSun(6.5)).toBe("daylight");
    expect(moodForSun(2)).toBe("evening");
    expect(moodForSun(-5)).toBe("evening");
    expect(moodForSun(-7)).toBe("candlelight");
  });
});

describe("the band of sky", () => {
  it("takes the product's palette by the sun's true altitude, back in the screen's colours", () => {
    // Midsummer noon: the sun above 50°, the palette's top keyframe exactly.
    const noon = skyBand({ start: t("2026-06-21T12:10:00Z"), end: t("2026-06-21T12:20:00Z") }, 1);
    expect(noon[0]?.zenith).toBe("#2c6bc6");
    expect(noon[0]?.horizon).toBe("#d6e5f3");
    expect(noon[0]?.city).toBe(0);
  });

  it("lights the city's glow along the night horizon and lets the stars out at night only", () => {
    const night = skyBand(EVENING, 4);
    expect(night.every((stop) => stop.city > 0.9)).toBe(true);
    expect(skyStars(EVENING, 868, 128).length).toBeGreaterThan(40);
    expect(skyStars({ start: t("2026-11-28T10:00:00Z"), end: t("2026-11-28T14:00:00Z") }, 868, 128)).toEqual([]);
  });

  it("scatters the stars the same way every time", () => {
    expect(skyStars(EVENING, 868, 128)).toEqual(skyStars(EVENING, 868, 128));
  });
});

describe("the moon's path", () => {
  it("runs from moonrise on the horizon, travelled solid to the hour and ahead after it", () => {
    const runs = bodyRuns(EVENING, "moon");
    expect(runs).toHaveLength(1);
    const run = runs[0] ?? [];
    // The path leaves the horizon where the moon crosses it, in the minute before the 20:09 the line names.
    expect(run[0]?.alt).toBe(0);
    expect(formatWallTime(run[0]?.t ?? 0)).toBe("20:08");
    const at = t("2026-11-28T21:41:00Z");
    const { done, ahead } = splitRun(run, at, skyAt(at).moon.altitude);
    expect(done[done.length - 1]?.t).toBe(at);
    expect(ahead[0]?.t).toBe(at);
    expect(Math.round(ahead[0]?.alt ?? 0)).toBe(10);
  });

  it("keeps 35° in the sky's height unless the sun climbs higher", () => {
    expect(degreesScale(128, sunHighest(EVENING))).toBeCloseTo(3.6, 2);
    const summer = sunHighest({ start: t("2026-06-21T05:00:00Z"), end: t("2026-06-22T05:00:00Z") });
    expect(summer).toBeGreaterThan(55);
    expect(degreesScale(128, summer) * summer).toBeCloseTo(112, 0);
  });
});
