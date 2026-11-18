import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SURVEYED_ROOMS,
  surveyedRoomFor,
  surveyedRoomsBySlug,
  surveyedRoomsEnabled,
  type SurveyedRoomEntry,
} from "../room-registry.js";

const SALOON: SurveyedRoomEntry = { slug: "saloon", base: "/rooms/saloon/survey-2026-07-11", revision: 3 };
const ROOMS: ReadonlyMap<string, SurveyedRoomEntry> = new Map([["saloon", SALOON]]);

describe("surveyed room registry", () => {
  it("lists no room until one is published", () => {
    expect(SURVEYED_ROOMS.size).toBe(0);
    expect(surveyedRoomFor("trades-hall", "saloon")).toBeNull();
  });

  it("files every listed room under its own slug", () => {
    // The table the planner reads is built by this from the list, which is empty until a room is
    // published: so it is asked here for a list that is not.
    const reception: SurveyedRoomEntry = { slug: "reception-room", base: "/rooms/reception-room/survey-2026-07-11", revision: 1 };
    const table = surveyedRoomsBySlug([SALOON, reception]);
    expect([...table.keys()]).toEqual(["saloon", "reception-room"]);
    for (const [slug, entry] of table) expect(entry.slug).toBe(slug);
    // So a space's slug reaches that room's entry and no other's.
    expect(surveyedRoomFor("trades-hall", "saloon", table)).toBe(SALOON);
    expect(surveyedRoomFor("trades-hall", "reception-room", table)).toBe(reception);
    expect(surveyedRoomFor("trades-hall", "/rooms/saloon/survey-2026-07-11", table)).toBeNull();
    // And the planner's own table is that builder's.
    for (const [slug, entry] of SURVEYED_ROOMS) expect(entry.slug).toBe(slug);
  });

  it("finds a listed room for either of Trades Hall's venue slugs", () => {
    expect(surveyedRoomFor("trades-hall", "saloon", ROOMS)).toBe(SALOON);
    expect(surveyedRoomFor("trades-hall-glasgow", "saloon", ROOMS)).toBe(SALOON);
  });

  it("never finds one for another venue's room of the same slug, or an unlisted room", () => {
    expect(surveyedRoomFor("another-venue", "saloon", ROOMS)).toBeNull();
    expect(surveyedRoomFor("", "saloon", ROOMS)).toBeNull();
    expect(surveyedRoomFor("trades-hall", "grand-hall", ROOMS)).toBeNull();
    expect(surveyedRoomFor("trades-hall", "constructor", ROOMS)).toBeNull();
  });
});

describe("surveyedRoomsEnabled", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.removeItem("venviewer.surveyed-rooms");
  });

  it("is off unless this device has asked for it", () => {
    expect(surveyedRoomsEnabled("")).toBe(false);
    expect(surveyedRoomsEnabled("?sky=1")).toBe(false);
  });

  it("turns on with ?rooms=surveyed and remembers it on this device", () => {
    expect(surveyedRoomsEnabled("?rooms=surveyed")).toBe(true);
    expect(window.localStorage.getItem("venviewer.surveyed-rooms")).toBe("surveyed");
    expect(surveyedRoomsEnabled("")).toBe(true);
  });

  it("turns off again with ?rooms=plain, remembered too", () => {
    surveyedRoomsEnabled("?rooms=surveyed");
    expect(surveyedRoomsEnabled("?rooms=plain")).toBe(false);
    expect(surveyedRoomsEnabled("")).toBe(false);
  });

  it("ignores any other value and keeps the last choice", () => {
    surveyedRoomsEnabled("?rooms=surveyed");
    expect(surveyedRoomsEnabled("?rooms=yes")).toBe(true);
    expect(surveyedRoomsEnabled("?rooms=1")).toBe(true);
  });

  it("still answers the URL when storage is refused, and is off without it", () => {
    // As a browser with site data blocked does: reaching localStorage throws.
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    expect(surveyedRoomsEnabled("?rooms=surveyed")).toBe(true);
    expect(surveyedRoomsEnabled("")).toBe(false);
  });
});
