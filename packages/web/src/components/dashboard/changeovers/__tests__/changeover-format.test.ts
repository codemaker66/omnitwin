import { describe, expect, it } from "vitest";
import type { TurnaroundRuleSetting } from "@omnitwin/types";
import {
  changeoverDuration, changeoverDurationWords, confirmationWords, eventTypeLabel, fallbackRule, firstOpenRoom,
  parseMinutes, removalConsequence, sortRules,
} from "../changeover-format.js";

const HALL = "00000000-0000-4000-8000-000000000001";
const SALOON = "00000000-0000-4000-8000-000000000002";
const rooms = new Map([[HALL, "Grand Hall"], [SALOON, "Saloon"]]);

function rule(id: string, spaceId: string | null, eventType: string | null, minutes: number): TurnaroundRuleSetting {
  return {
    id, venueId: "v", spaceId, eventType, name: id, minutes, isActive: true, confirmedAt: null, updatedByName: null,
    createdAt: "2026-09-26T09:00:00.000Z", updatedAt: "2026-09-26T09:00:00.000Z",
  };
}

describe("changeover words", () => {
  it("reads a duration as a venue team says it", () => {
    expect([0, 30, 60, 90, 125, 1440].map(changeoverDuration)).toEqual(["None", "30 min", "1 h", "1 h 30", "2 h 05", "24 h"]);
    expect(changeoverDurationWords(90)).toBe("1 hour 30 minutes");
    expect(changeoverDurationWords(61)).toBe("1 hour 1 minute");
    expect(changeoverDurationWords(0)).toBe("no changeover time");
  });

  it("names an event type, or any event", () => {
    expect(eventTypeLabel("wedding")).toBe("Wedding");
    expect(eventTypeLabel(null)).toBe("Any event");
  });

  it("says who set a time, or that nobody has confirmed it", () => {
    expect(confirmationWords({ confirmedAt: null, updatedByName: null })).toBe("Not confirmed");
    expect(confirmationWords({ confirmedAt: "2026-09-26T21:30:00.000Z", updatedByName: "Elaine MacGregor" }))
      .toBe("Set by Elaine MacGregor, 26 Sep 2026");
  });

  it("takes whole minutes from 0 to a day, and nothing else", () => {
    expect(parseMinutes(" 90 ")).toBe(90);
    expect(parseMinutes("0")).toBe(0);
    for (const text of ["", "1441", "-5", "12.5", "1h"]) expect(parseMinutes(text), text).toBeNull();
  });
});

describe("removing a time", () => {
  const rules = [rule("all", null, null, 90), rule("hall", HALL, null, 120), rule("hall-wedding", HALL, "wedding", 180)];

  it("falls back as the Diary's engine would: the most specific remaining rule", () => {
    expect(fallbackRule(rules[2] ?? rule("x", null, null, 0), rules)?.id).toBe("hall");
    expect(fallbackRule(rules[1] ?? rule("x", null, null, 0), rules)?.id).toBe("all");
    expect(fallbackRule(rules[0] ?? rule("x", null, null, 0), rules)).toBeNull();
  });

  it("says in one sentence what the Diary will do instead", () => {
    expect(removalConsequence(rules[2] ?? rules[0] as TurnaroundRuleSetting, rules, rooms))
      .toBe("Grand Hall will use the time for Grand Hall: 2 h.");
    expect(removalConsequence(rules[1] ?? rules[0] as TurnaroundRuleSetting, rules, rooms))
      .toBe("Grand Hall will use the time for all rooms: 1 h 30.");
    expect(removalConsequence(rules[0] as TurnaroundRuleSetting, rules, rooms))
      .toBe("Rooms without their own time will have no changeover time, so the Diary will not check those gaps.");
  });

  it("suggests all rooms first, then the first room without a time for any event", () => {
    expect(firstOpenRoom([], [HALL, SALOON])).toBe("");
    expect(firstOpenRoom(rules, [HALL, SALOON])).toBe(SALOON);
    expect(firstOpenRoom([...rules, rule("saloon", SALOON, null, 45)], [HALL, SALOON])).toBe("");
  });

  it("orders times as the API does: all rooms, then each room, any event first", () => {
    const shuffled = [rules[2], rule("saloon", SALOON, null, 45), rules[0], rules[1]]
      .filter((candidate): candidate is TurnaroundRuleSetting => candidate !== undefined);
    expect(sortRules(shuffled, [HALL, SALOON]).map((candidate) => candidate.id))
      .toEqual(["all", "hall", "hall-wedding", "saloon"]);
  });
});
