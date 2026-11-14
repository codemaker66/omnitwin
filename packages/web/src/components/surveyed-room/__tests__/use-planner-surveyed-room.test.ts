import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { useSurveyedRoomStore } from "../../../stores/surveyed-room-store.js";
import type { SurveyedRoomEntry } from "../room-registry.js";
import { surveyedRoomCaption, surveyedRoomTrouble, surveyedRoomWorking, type SurveyedRoomStatus } from "../room-status.js";
import { encodeReliefFile, flatCeilingEntry, flatWallEntry } from "./fixtures/relief-file.js";

// Whether a space's venue is Trades Hall is read from the API; here it is set, and each asking is kept.
const venue = vi.hoisted(() => ({ tradesHall: true as boolean | null, asked: [] as (string | null)[] }));
vi.mock("../../../hooks/use-trades-hall-venue.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../hooks/use-trades-hall-venue.js")>()),
  useTradesHallVenue: (venueId: string | null) => {
    venue.asked.push(venueId);
    return venue.tradesHall;
  },
}));

const { plannerSurveyedRoomAsk, plannerSurveyedRoomEntry, usePlannerSurveyedRoom } = await import("../use-planner-surveyed-room.js");

const FOLDER = "/rooms/saloon/survey-2026-07-11";
const STAGED = `?rooms=surveyed&roomsBase=${FOLDER}&roomsRev=1`;
const SALOON_SPACE = { slug: "saloon", name: "Saloon", venueId: "00000000-0000-4000-8000-000000000099" };
const FIXTURE_TEXT = readFileSync(path.resolve("src/components/surveyed-room/__tests__/fixtures/saloon-survey.fixture.json"), "utf-8");

interface RawSaloon {
  walls: { reliefId: string; length: number; height: number }[];
  ceiling: { extent: { x: [number, number]; z: [number, number] } };
  files: Record<string, { bytes: number; sha256: string }>;
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Serves the Saloon's survey from its folder; `missing` names a file the server does not have. */
function serveSaloon(missing: string | null = null): Mock<FetchFn> {
  const record = JSON.parse(FIXTURE_TEXT) as RawSaloon;
  const walls = encodeReliefFile(record.walls.map((wall) => flatWallEntry(wall.reliefId, wall.length, wall.height)));
  const ceiling = encodeReliefFile([flatCeilingEntry("ceiling", record.ceiling.extent.x, record.ceiling.extent.z)]);
  const zero = "0".repeat(64);
  record.files["walls-relief.bin"] = { bytes: walls.byteLength, sha256: zero };
  record.files["ceiling-relief.bin"] = { bytes: ceiling.byteLength, sha256: zero };
  const bodies: Readonly<Record<string, () => BodyInit>> = {
    "survey.json": () => JSON.stringify(record), "walls-relief.bin": () => walls.slice(0), "ceiling-relief.bin": () => ceiling.slice(0),
  };
  const fake = vi.fn<FetchFn>((input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const name = url.split("?")[0]?.split("/").pop() ?? "";
    const body = name === missing ? undefined : bodies[name];
    return Promise.resolve(body === undefined ? new Response("not found", { status: 404 }) : new Response(body(), { status: 200 }));
  });
  vi.stubGlobal("fetch", fake);
  return fake;
}

function openPlanner(search: string): void {
  window.history.replaceState(null, "", `/plan${search}`);
}

function status(): SurveyedRoomStatus | null {
  return useSurveyedRoomStore.getState().status;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
  window.localStorage.removeItem("venviewer.surveyed-rooms");
  venue.tradesHall = true;
  venue.asked.length = 0;
});

describe("what a device has asked for", () => {
  it("reads the switch, and in a development build a staged folder and its revision", () => {
    expect(plannerSurveyedRoomAsk("", true)).toEqual({ enabled: false, staged: null });
    expect(plannerSurveyedRoomAsk("?rooms=surveyed", true)).toEqual({ enabled: true, staged: null });
    expect(plannerSurveyedRoomAsk(`?rooms=surveyed&roomsBase=${FOLDER}/&roomsRev=3`, true)).toEqual({ enabled: true, staged: { base: FOLDER, revision: 3 } });
    // Revision 1 when left out.
    expect(plannerSurveyedRoomAsk(`?rooms=surveyed&roomsBase=${FOLDER}`, true).staged).toEqual({ base: FOLDER, revision: 1 });
  });

  it("ignores the staged folder in a production build, whatever the address says", () => {
    expect(plannerSurveyedRoomAsk(`?roomsBase=${FOLDER}&roomsRev=1`, false)).toEqual({ enabled: false, staged: null });
    // The switch itself is read (and remembered) as ever; only the folder is not.
    expect(plannerSurveyedRoomAsk(STAGED, false)).toEqual({ enabled: true, staged: null });
  });

  it.each([
    ["another site", "roomsBase=https://example.com/rooms/saloon"],
    ["a folder that climbs", "roomsBase=/rooms/../secrets"],
    ["a folder with a query", `roomsBase=${encodeURIComponent("/rooms/saloon?x=1")}`],
    ["no folder", "roomsRev=2"],
    ["revision 0", `roomsBase=${FOLDER}&roomsRev=0`],
    ["a revision that is not whole", `roomsBase=${FOLDER}&roomsRev=1.5`],
  ])("stages nothing for %s", (_name, query) => {
    expect(plannerSurveyedRoomAsk(`?rooms=surveyed&${query}`, true).staged).toBeNull();
  });
});

describe("the survey the planner's room has", () => {
  const LISTED: SurveyedRoomEntry = { slug: "saloon", base: "/rooms/saloon/survey-2026-09-01", revision: 4 };
  const ROOMS: ReadonlyMap<string, SurveyedRoomEntry> = new Map([["saloon", LISTED]]);
  const ON = { enabled: true, staged: null };

  it("is the registry's entry for the room's slug, where the switch is on", () => {
    expect(plannerSurveyedRoomEntry(ON, "saloon", ROOMS)).toBe(LISTED);
    expect(plannerSurveyedRoomEntry(ON, "reception-room", ROOMS)).toBeNull();
    expect(plannerSurveyedRoomEntry(ON, null, ROOMS)).toBeNull();
    // No room is listed yet.
    expect(plannerSurveyedRoomEntry(ON, "saloon")).toBeNull();
  });

  it("is nothing where the switch is off, listed or staged", () => {
    expect(plannerSurveyedRoomEntry({ enabled: false, staged: null }, "saloon", ROOMS)).toBeNull();
    expect(plannerSurveyedRoomEntry({ enabled: false, staged: { base: FOLDER, revision: 1 } }, "saloon", ROOMS)).toBeNull();
  });

  it("is the staged folder for whichever room is open, expected to hold that room's own survey", () => {
    const staged = { enabled: true, staged: { base: FOLDER, revision: 2 } };
    expect(plannerSurveyedRoomEntry(staged, "saloon", ROOMS)).toEqual({ slug: "saloon", base: FOLDER, revision: 2 });
    expect(plannerSurveyedRoomEntry(staged, "reception-room")).toEqual({ slug: "reception-room", base: FOLDER, revision: 2 });
  });
});

describe("usePlannerSurveyedRoom", () => {
  it("asks nothing of anyone where the switch is off: no venue read, no fetch, nothing published", () => {
    const fake = serveSaloon();
    openPlanner(`?roomsBase=${FOLDER}&roomsRev=1`);
    const { result } = renderHook(() => usePlannerSurveyedRoom(SALOON_SPACE, true));
    expect(result.current).toBeNull();
    expect(venue.asked.every((venueId) => venueId === null)).toBe(true);
    expect(fake).not.toHaveBeenCalled();
    expect(status()).toBeNull();
  });

  it("asks nothing for a room without a survey, the switch on", () => {
    const fake = serveSaloon();
    openPlanner("?rooms=surveyed");
    const { result } = renderHook(() => usePlannerSurveyedRoom(SALOON_SPACE, true));
    expect(result.current).toBeNull();
    expect(venue.asked.every((venueId) => venueId === null)).toBe(true);
    expect(fake).not.toHaveBeenCalled();
    expect(status()).toBeNull();
  });

  it("ignores a staged folder in a production build", () => {
    vi.stubEnv("DEV", false);
    const fake = serveSaloon();
    openPlanner(STAGED);
    const { result } = renderHook(() => usePlannerSurveyedRoom(SALOON_SPACE, true));
    expect(result.current).toBeNull();
    expect(venue.asked.every((venueId) => venueId === null)).toBe(true);
    expect(fake).not.toHaveBeenCalled();
    expect(status()).toBeNull();
  });

  it("loads a staged survey for a Trades Hall room, saying so until it hands the room over", async () => {
    const fake = serveSaloon();
    openPlanner(STAGED);
    const { result } = renderHook(() => usePlannerSurveyedRoom(SALOON_SPACE, true));
    // Until it is ready there is no room to draw, and the planner is told one is loading.
    expect(result.current).toBeNull();
    expect(venue.asked).toContain(SALOON_SPACE.venueId);
    expect(status()).toMatchObject({ roomName: "Saloon", phase: "loading", photos: null });
    expect(surveyedRoomCaption(status())).toBe("Loading the Saloon as surveyed");
    await waitFor(() => { expect(result.current).not.toBeNull(); });
    expect(result.current?.record.slug).toBe("saloon");
    expect(result.current?.entry).toEqual({ slug: "saloon", base: FOLDER, revision: 1 });
    expect(fake.mock.calls.map((call) => call[0])).toEqual([`${FOLDER}/survey.json?r=1`, `${FOLDER}/walls-relief.bin?r=1`, `${FOLDER}/ceiling-relief.bin?r=1`]);
    expect(status()).toMatchObject({ roomName: "Saloon", phase: "ready", failure: null });
  });

  it("hands over no room when the survey cannot be loaded, and says so with the reason kept", async () => {
    serveSaloon("walls-relief.bin");
    openPlanner(STAGED);
    const { result } = renderHook(() => usePlannerSurveyedRoom(SALOON_SPACE, true));
    await waitFor(() => { expect(status()?.phase).toBe("failed"); });
    expect(result.current).toBeNull();
    expect(status()?.failure).toMatch(/^walls-relief\.bin \(http\): HTTP 404/);
    expect(surveyedRoomCaption(status())).toBe("The surveyed Saloon could not load, so the room is drawn plainly. Planning is unaffected.");
  });

  it("refuses a staged folder that holds another room's survey", async () => {
    serveSaloon();
    openPlanner(STAGED);
    const { result } = renderHook(() => usePlannerSurveyedRoom({ ...SALOON_SPACE, slug: "reception-room", name: "Reception Room" }, true));
    await waitFor(() => { expect(status()?.phase).toBe("failed"); });
    expect(result.current).toBeNull();
    expect(status()?.failure).toMatch(/^survey\.json \(room\): the record is of "saloon"/);
  });

  it.each<[boolean | null, string]>([[false, "another venue's"], [null, "a venue not yet read, or that could not be read"]])(
    "never loads Trades Hall's survey for a room of the same slug where the venue is %s (%s)", (tradesHall) => {
      venue.tradesHall = tradesHall;
      const fake = serveSaloon();
      openPlanner(STAGED);
      const { result } = renderHook(() => usePlannerSurveyedRoom(SALOON_SPACE, true));
      expect(result.current).toBeNull();
      expect(fake).not.toHaveBeenCalled();
      expect(status()).toBeNull();
    },
  );

  it("is never asked about a room drawn by other code, and leaves nothing said when the scene goes", async () => {
    const fake = serveSaloon();
    openPlanner(STAGED);
    const hall = renderHook(() => usePlannerSurveyedRoom({ ...SALOON_SPACE, slug: "grand-hall", name: "Grand Hall" }, false));
    expect(hall.result.current).toBeNull();
    expect(fake).not.toHaveBeenCalled();
    hall.unmount();
    const saloon = renderHook(() => usePlannerSurveyedRoom(SALOON_SPACE, true));
    await waitFor(() => { expect(status()?.phase).toBe("ready"); });
    saloon.unmount();
    expect(status()).toBeNull();
  });
});

describe("what the planner says of a surveyed room", () => {
  const loading: SurveyedRoomStatus = { roomName: "Saloon", phase: "loading", files: { settled: 0, expected: null }, photos: null, failure: null };
  const drawn: SurveyedRoomStatus = { roomName: "Saloon", phase: "ready", files: { settled: 0, expected: null }, photos: null, failure: null };

  it("counts the survey's files in, with working motion", () => {
    expect(surveyedRoomCaption(loading)).toBe("Loading the Saloon as surveyed");
    expect(surveyedRoomCaption({ ...loading, files: { settled: 2, expected: 3 } })).toBe("Loading the Saloon as surveyed · 2 of 3 files");
    expect(surveyedRoomWorking(loading)).toBe(true);
    expect(surveyedRoomTrouble(loading)).toBe(false);
  });

  it("counts the photographs in only once the drawn room has said how many, then falls quiet", () => {
    // Drawn, but its model has not reported: nothing is known to be loading, so nothing is claimed.
    expect(surveyedRoomCaption(drawn)).toBeNull();
    expect(surveyedRoomWorking(drawn)).toBe(false);
    const arriving = { ...drawn, photos: { expected: 3, settled: 1, failed: 0 } };
    expect(surveyedRoomCaption(arriving)).toBe("Loading the Saloon's photographs · 1 of 3");
    expect(surveyedRoomWorking(arriving)).toBe(true);
    const whole = { ...drawn, photos: { expected: 3, settled: 3, failed: 0 } };
    expect(surveyedRoomCaption(whole)).toBeNull();
    expect(surveyedRoomWorking(whole)).toBe(false);
    expect(surveyedRoomTrouble(whole)).toBe(false);
  });

  it("keeps a still note when a photograph, or the survey, could not load", () => {
    const patchy = { ...drawn, photos: { expected: 3, settled: 3, failed: 1 } };
    expect(surveyedRoomCaption(patchy)).toBe("Some of the Saloon's photographs could not load, so parts of the room are drawn in a plain tone. Planning is unaffected.");
    expect(surveyedRoomWorking(patchy)).toBe(false);
    expect(surveyedRoomTrouble(patchy)).toBe(true);
    const failed: SurveyedRoomStatus = { ...loading, phase: "failed", failure: "survey.json (http): HTTP 404" };
    expect(surveyedRoomCaption(failed)).toBe("The surveyed Saloon could not load, so the room is drawn plainly. Planning is unaffected.");
    expect(surveyedRoomWorking(failed)).toBe(false);
    expect(surveyedRoomTrouble(failed)).toBe(true);
  });

  it("says nothing where no surveyed room is asked for", () => {
    expect(surveyedRoomCaption(null)).toBeNull();
    expect(surveyedRoomWorking(null)).toBe(false);
    expect(surveyedRoomTrouble(null)).toBe(false);
  });

  it("keeps a drawn room's photographs through its own reports, and drops them when another load begins", () => {
    const store = useSurveyedRoomStore.getState();
    store.publish({ roomName: "Saloon", phase: "ready", files: { settled: 0, expected: null }, failure: null });
    store.reportPhotos({ expected: 3, settled: 2, failed: 0 });
    expect(status()?.photos).toEqual({ expected: 3, settled: 2, failed: 0 });
    // The scene's word again, the room still drawn: the photographs stand.
    store.publish({ roomName: "Saloon", phase: "ready", files: { settled: 0, expected: null }, failure: null });
    expect(status()?.photos).toEqual({ expected: 3, settled: 2, failed: 0 });
    store.publish({ roomName: "Saloon", phase: "loading", files: { settled: 0, expected: null }, failure: null });
    expect(status()?.photos).toBeNull();
    store.publish(null);
    // With no surveyed room asked for, a late report is no one's.
    store.reportPhotos({ expected: 3, settled: 3, failed: 0 });
    expect(status()).toBeNull();
  });
});
