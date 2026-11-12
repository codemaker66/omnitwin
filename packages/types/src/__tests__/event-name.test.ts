import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { eventDisplayName, eventNameFor, eventTitleFor } from "../event-name.js";

// What an event is called when it has no name of its own (the release lead's
// ruling of 12 November 2026 on #397): the occasion and the venue's own day
// of its start, "Wedding, 14 March 2027", or "Event, 14 March 2027" with no
// occasion. Never anything personal: the name travels to sheets, supplier
// passes and notifications.

const LONDON = "Europe/London";
const MARCH_14 = "2027-03-14T18:00:00.000Z";

describe("eventNameFor", () => {
  it("keeps a booking's own title, trimmed", () => {
    expect(eventNameFor({ title: "  Fraser wedding ", eventType: "wedding", startsAt: MARCH_14, timeZone: LONDON })).toBe("Fraser wedding");
    // A dash inside a title is part of someone's name for it.
    expect(eventNameFor({ title: "Fraser — Wedding", eventType: "wedding", startsAt: MARCH_14, timeZone: LONDON })).toBe("Fraser — Wedding");
  });

  it("names an event with no title by its occasion and day", () => {
    for (const title of ["", "   "]) {
      expect(eventNameFor({ title, eventType: "wedding", startsAt: MARCH_14, timeZone: LONDON }), JSON.stringify(title)).toBe("Wedding, 14 March 2027");
    }
    expect(eventNameFor({ title: "", eventType: "reception", startsAt: MARCH_14, timeZone: LONDON })).toBe("Drinks reception, 14 March 2027");
    // An occasion typed in free reads as typed.
    expect(eventNameFor({ title: "", eventType: " Charity gala ", startsAt: MARCH_14, timeZone: LONDON })).toBe("Charity gala, 14 March 2027");
  });

  // A venue's stored zone can be one no clock knows. The name is read on the
  // house's clock then, as the rota reads such a zone, and never throws: it is
  // made inside the Diary's read, the room's timeline and a booking's save.
  it("reads a venue zone no clock knows as the house's, and never throws for it", () => {
    expect(eventNameFor({ title: "", eventType: "wedding", startsAt: MARCH_14, timeZone: "Nowhere/Never_Land" })).toBe("Wedding, 14 March 2027");
    expect(eventNameFor({ title: "", eventType: null, startsAt: MARCH_14, timeZone: "" })).toBe("Event, 14 March 2027");
    expect(eventDisplayName({ name: "", eventType: "dinner", startsAt: MARCH_14 }, "Not/AZone")).toBe("Dinner, 14 March 2027");
  });

  it("calls it an event when there is no occasion either", () => {
    for (const eventType of [null, undefined, "", "   "]) {
      expect(eventNameFor({ title: "", eventType, startsAt: MARCH_14, timeZone: LONDON }), String(eventType)).toBe("Event, 14 March 2027");
    }
  });

  it("treats the bare ' — <occasion>' an enquiry with a blank name once gave as no title", () => {
    // As written before #350, and as a read that trims it shows it.
    for (const title of [" — Wedding", "— Wedding", "—Wedding"]) {
      expect(eventNameFor({ title, eventType: "wedding", startsAt: MARCH_14, timeZone: LONDON }), title).toBe("Wedding, 14 March 2027");
    }
    expect(eventNameFor({ title: " — Drinks reception", eventType: "reception", startsAt: MARCH_14, timeZone: LONDON }))
      .toBe("Drinks reception, 14 March 2027");
    // The event's own occasion decides; without one, the occasion the title names.
    expect(eventNameFor({ title: " — Wedding", eventType: "dinner", startsAt: MARCH_14, timeZone: LONDON })).toBe("Dinner, 14 March 2027");
    expect(eventNameFor({ title: " — Wedding", eventType: null, startsAt: MARCH_14, timeZone: LONDON })).toBe("Wedding, 14 March 2027");
    expect(eventNameFor({ title: " — ", eventType: null, startsAt: MARCH_14, timeZone: LONDON })).toBe("Event, 14 March 2027");
    // Typed with an en dash or a hyphen, it is the same bare title (N6).
    for (const title of [" – Wedding", "- Wedding", "-Wedding"]) {
      expect(eventNameFor({ title, eventType: null, startsAt: MARCH_14, timeZone: LONDON }), title).toBe("Wedding, 14 March 2027");
    }
  });

  // A guest who gave no name is filed under their email, and the hold made for
  // them is titled by it (N4, R7). A title holding an address says who asked,
  // never what the event is, so it counts as no title; an occasion the title
  // names after a dash still names it when the event has none of its own.
  it("treats a title holding an email address as no title", () => {
    const named = (title: string, eventType: string | null = "wedding"): string =>
      eventNameFor({ title, eventType, startsAt: MARCH_14, timeZone: LONDON });
    expect(named("jane.fraser@example.test")).toBe("Wedding, 14 March 2027");
    expect(named("  Jane.Fraser@Example.TEST — Wedding ")).toBe("Wedding, 14 March 2027");
    expect(named("jane.fraser@example.test — Drinks reception", null)).toBe("Drinks reception, 14 March 2027");
    expect(named("Wedding for jane.fraser@example.test")).toBe("Wedding, 14 March 2027");
    expect(named("jane.fraser@example.test and party", null)).toBe("Event, 14 March 2027");
    expect(named("jane@example.test — bob@example.test", null)).toBe("Event, 14 March 2027");
    // An @ that is not an address is somebody's words.
    expect(named("Drinks @ the Saloon")).toBe("Drinks @ the Saloon");
    expect(named("Fraser wedding @Saloon")).toBe("Fraser wedding @Saloon");
  });

  it("dates it by the venue's own calendar day, near midnight and across both changes of the clocks", () => {
    const day = (startsAt: string, timeZone = LONDON): string =>
      eventNameFor({ title: "", eventType: null, startsAt, timeZone }).replace("Event, ", "");
    // Greenwich Mean Time: the venue's day is the UTC day.
    expect(day("2027-03-13T23:59:00.000Z")).toBe("13 March 2027");
    // British Summer Time: 23:30 UTC is half past midnight the next day.
    expect(day("2027-06-13T23:30:00.000Z")).toBe("14 June 2027");
    // The spring change, 01:00 UTC on Sunday 28 March 2027.
    expect(day("2027-03-27T23:30:00.000Z")).toBe("27 March 2027");
    expect(day("2027-03-28T00:30:00.000Z")).toBe("28 March 2027");
    expect(day("2027-03-28T23:30:00.000Z")).toBe("29 March 2027");
    // The autumn change, 01:00 UTC on Sunday 31 October 2027.
    expect(day("2027-10-30T23:30:00.000Z")).toBe("31 October 2027");
    expect(day("2027-10-31T23:30:00.000Z")).toBe("31 October 2027");
    // Another venue's clock.
    expect(day("2027-03-15T03:30:00.000Z", "America/New_York")).toBe("14 March 2027");
    expect(day("2027-03-14T14:00:00.000Z", "Australia/Sydney")).toBe("15 March 2027");
  });

  it("takes the start as an instant or its ISO string alike", () => {
    expect(eventNameFor({ title: "", eventType: "wedding", startsAt: new Date(MARCH_14), timeZone: LONDON })).toBe("Wedding, 14 March 2027");
  });

  it("names the occasion alone when the event has no start", () => {
    expect(eventNameFor({ title: "", eventType: "wedding", startsAt: null, timeZone: LONDON })).toBe("Wedding");
    expect(eventNameFor({ title: "", eventType: null, startsAt: "not a date", timeZone: LONDON })).toBe("Event");
  });

  // Every screen that shows an event's name bundles this module, so it reads
  // the occasion words from a module that imports nothing, never enquiry.ts.
  it("imports only the occasion words and the venue clock", async () => {
    const source = async (file: string): Promise<string> => readFile(resolve(import.meta.dirname, "..", file), "utf8");
    expect([...(await source("event-name.ts")).matchAll(/^import .* from "(.+)";\r?$/gmu)].map((found) => found[1]))
      .toEqual(["./occasion.js", "./staff-rota-checks.js"]);
    expect(await source("occasion.ts")).not.toMatch(/^import /mu);
  });

  it("never gives a name longer than an event's name may be", () => {
    expect(eventNameFor({ title: "x".repeat(250), eventType: null, startsAt: MARCH_14, timeZone: LONDON })).toHaveLength(200);
  });
});

describe("eventDisplayName", () => {
  it("shows a stored event's own name, or the same name eventNameFor gives when it was stored without one", () => {
    expect(eventDisplayName({ name: "Fraser wedding", eventType: "wedding", startsAt: MARCH_14 }, LONDON)).toBe("Fraser wedding");
    expect(eventDisplayName({ name: "", eventType: "wedding", startsAt: MARCH_14 }, LONDON)).toBe("Wedding, 14 March 2027");
    expect(eventDisplayName({ name: "— Wedding", eventType: "wedding", startsAt: new Date(MARCH_14) }, LONDON)).toBe("Wedding, 14 March 2027");
    expect(eventDisplayName({ name: "", eventType: null, startsAt: null }, LONDON)).toBe("Event");
  });

  it("shows an event stored under its client's email by its occasion and day, with no migration", () => {
    expect(eventDisplayName({ name: "jane.fraser@example.test — Wedding", eventType: "wedding", startsAt: MARCH_14 }, LONDON))
      .toBe("Wedding, 14 March 2027");
    expect(eventDisplayName({ name: "jane.fraser@example.test", eventType: null, startsAt: MARCH_14 }, LONDON)).toBe("Event, 14 March 2027");
  });
});

// A hold a client proposes is titled by its event and keeps that title when
// it moves, so the title carries no day: the name a person gave the event,
// else the occasion alone (the release lead's ruling of 12 November 2026 on
// #407, item 1). It rests on the same decision as the shown name, so the two
// never disagree: where the shown name is the stored one, the title is that
// name; where the shown name is made from the occasion and the day, the
// title is that occasion.
describe("eventTitleFor", () => {
  const rows: readonly { readonly name: string; readonly eventType: string | null; readonly given: boolean; readonly title: string }[] = [
    { name: "Fraser wedding", eventType: "wedding", given: true, title: "Fraser wedding" },
    { name: "  Fraser wedding ", eventType: "wedding", given: true, title: "Fraser wedding" },
    { name: "Drinks @ the Saloon", eventType: "reception", given: true, title: "Drinks @ the Saloon" },
    // A dated name that is not the one made for this event's day is someone's,
    // as the rule that moves a made name's day reads it (syncEventStatus).
    { name: "Wedding, 21 March 2027", eventType: "wedding", given: true, title: "Wedding, 21 March 2027" },
    { name: "", eventType: "wedding", given: false, title: "Wedding" },
    { name: "   ", eventType: null, given: false, title: "Event" },
    { name: " — Drinks reception", eventType: null, given: false, title: "Drinks reception" },
    { name: "jane.fraser@example.test — Wedding", eventType: "wedding", given: false, title: "Wedding" },
    { name: "jane.fraser@example.test", eventType: null, given: false, title: "Event" },
    // The name the API made for the event (createEventFor) is nobody's.
    { name: "Wedding, 14 March 2027", eventType: "wedding", given: false, title: "Wedding" },
    { name: " Dinner, 14 March 2027 ", eventType: "dinner", given: false, title: "Dinner" },
  ];

  it("is the stored name wherever that is shown, and the occasion alone wherever the shown name is made", () => {
    for (const { name, eventType, given, title } of rows) {
      const event = { name, eventType, startsAt: MARCH_14 };
      expect(eventTitleFor(event, LONDON), JSON.stringify(name)).toBe(title);
      expect(eventDisplayName(event, LONDON), JSON.stringify(name)).toBe(given ? title : `${title}, 14 March 2027`);
    }
  });

  it("knows a made name by the venue's own day", () => {
    // 03:30 UTC on 10 May is 23:30 on 9 May in New York: the API named the
    // event for the 9th there, and nobody gave it that name.
    const event = { name: "Dinner, 9 May 2030", eventType: "dinner", startsAt: "2030-05-10T03:30:00.000Z" };
    expect(eventTitleFor(event, "America/New_York")).toBe("Dinner");
    // On a London clock the same words name another day than the event's, so someone gave them.
    expect(eventTitleFor(event, LONDON)).toBe("Dinner, 9 May 2030");
  });

  it("is the occasion alone for an event with no start", () => {
    expect(eventTitleFor({ name: "", eventType: "wedding", startsAt: null }, LONDON)).toBe("Wedding");
    expect(eventTitleFor({ name: "Wedding", eventType: "wedding", startsAt: null }, LONDON)).toBe("Wedding");
  });
});
