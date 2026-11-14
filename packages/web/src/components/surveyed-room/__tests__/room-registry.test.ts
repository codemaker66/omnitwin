import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SURVEYED_ROOMS,
  surveyedRoomFor,
  surveyedRoomsEnabled,
  surveyFileUrl,
  type SurveyedRoomEntry,
} from "../room-registry.js";

const SALOON: SurveyedRoomEntry = { base: "/rooms/saloon/survey-2026-07-11", revision: 3 };
const ROOMS: ReadonlyMap<string, SurveyedRoomEntry> = new Map([["saloon", SALOON]]);

describe("surveyed room registry", () => {
  it("lists no room until one is published", () => {
    expect(SURVEYED_ROOMS.size).toBe(0);
    expect(surveyedRoomFor("trades-hall", "saloon")).toBeNull();
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

  it("builds a file's URL at the entry's revision", () => {
    expect(surveyFileUrl(SALOON, "survey.json")).toBe("/rooms/saloon/survey-2026-07-11/survey.json?r=3");
    expect(surveyFileUrl(SALOON, "walls-4096.webp")).toBe("/rooms/saloon/survey-2026-07-11/walls-4096.webp?r=3");
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
