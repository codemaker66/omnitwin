import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, render, waitFor, type RenderResult } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import type { SpaceDimensions } from "@omnitwin/types";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from "vitest";
import type { TradesHallVenueStatus } from "../../../hooks/use-trades-hall-venue.js";
import { useSurveyedRoomStore } from "../../../stores/surveyed-room-store.js";
import { surveyedRoomOpeningPose } from "../room-opening-view.js";
import type { SurveyedRoomEntry } from "../room-registry.js";
import { surveyedRoomCaption, surveyedRoomTrouble, surveyedRoomWorking, type SurveyedRoomStatus } from "../room-status.js";
import type { PlannerRoomSpace, PlannerSurveyedRoomSeam } from "../use-planner-surveyed-room.js";
import { encodeReliefFile, flatCeilingEntry, flatWallEntry } from "./fixtures/relief-file.js";

// How a space's venue stands is read from the API; here it is set, and each asking is kept.
const venue = vi.hoisted(() => ({ status: "trades-hall" as TradesHallVenueStatus, asked: [] as (string | null)[] }));
vi.mock("../../../hooks/use-trades-hall-venue.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../hooks/use-trades-hall-venue.js")>()),
  useTradesHallVenueStatus: (venueId: string | null) => {
    venue.asked.push(venueId);
    return venue.status;
  },
}));

const { plannerSurveyedRoomAsk, plannerSurveyedRoomEntry, surveyedRoomCode, usePlannerSurveyedRoom } = await import("../use-planner-surveyed-room.js");

const FOLDER = "/rooms/saloon/survey-2026-07-11";
const STAGED = `?rooms=surveyed&roomsBase=${FOLDER}&roomsRev=1`;
const SALOON_SPACE: PlannerRoomSpace = { slug: "saloon", name: "Saloon", venueId: "00000000-0000-4000-8000-000000000099" };
/** The planner's own data for the Saloon, which is not the surveyed room's (room-opening-view.test.ts). */
const DIMENSIONS: SpaceDimensions = { width: 13.1, length: 6.9, height: 5.4 };
const FOV = 55;
const NOTHING: PlannerSurveyedRoomSeam = { model: null, opening: null, loader: null };
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

interface PlannerProps {
  readonly space: PlannerRoomSpace | null;
  readonly eligible?: boolean;
  readonly dimensions?: SpaceDimensions;
}

/** What the seam last handed the planner, and what it handed at every render (the venue asked for, and whether a room was to be drawn). */
let seam: PlannerSurveyedRoomSeam = NOTHING;
const renders: { readonly venueId: string | null; readonly drawn: boolean }[] = [];

/** Stands where the planner's scene does: reads the seam, and mounts its loader beside the canvas. */
function Planner({ space, eligible = true, dimensions = DIMENSIONS }: PlannerProps): ReactElement | null {
  seam = usePlannerSurveyedRoom(space, eligible, dimensions, FOV);
  renders.push({ venueId: space?.venueId ?? null, drawn: seam.model !== null });
  return seam.loader;
}

function plan(props: PlannerProps): RenderResult {
  return render(createElement(Planner, props));
}

/** Lets promises already settled, and the effects they lead to, run. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

type SurveyedRoomCode = Awaited<ReturnType<typeof surveyedRoomCode.load>>;

/** A promise settled by hand: the code's download, held back or failed when a test says. */
function held<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (reason: unknown) => void } {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Each asking for the surveyed room's code. Left alone it is the real import. */
let load: MockInstance<(typeof surveyedRoomCode)["load"]>;

beforeEach(() => {
  load = vi.spyOn(surveyedRoomCode, "load");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
  window.localStorage.removeItem("venviewer.surveyed-rooms");
  venue.status = "trades-hall";
  venue.asked.length = 0;
  seam = NOTHING;
  renders.length = 0;
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

describe("usePlannerSurveyedRoom, where no survey is asked for", () => {
  /** Nothing of a surveyed room: none to draw, no loader to mount, no code asked for, no venue read, no file fetched, nothing said. */
  async function expectNothingAsked(fake: Mock<FetchFn>): Promise<void> {
    await settle();
    expect(seam).toEqual(NOTHING);
    expect(load).not.toHaveBeenCalled();
    expect(venue.asked).toEqual([]);
    expect(fake).not.toHaveBeenCalled();
    expect(status()).toBeNull();
  }

  it("asks nothing of anyone where the switch is off: no code, no venue read, no fetch, nothing published", async () => {
    const fake = serveSaloon();
    openPlanner(`?roomsBase=${FOLDER}&roomsRev=1`);
    plan({ space: SALOON_SPACE });
    await expectNothingAsked(fake);
  });

  it("asks nothing for a room without a survey, the switch on", async () => {
    const fake = serveSaloon();
    openPlanner("?rooms=surveyed");
    plan({ space: SALOON_SPACE });
    await expectNothingAsked(fake);
  });

  it("ignores a staged folder in a production build", async () => {
    vi.stubEnv("DEV", false);
    const fake = serveSaloon();
    openPlanner(STAGED);
    plan({ space: SALOON_SPACE });
    await expectNothingAsked(fake);
  });

  it("is never asked about a room drawn by other code, or before the planner has a room", async () => {
    const fake = serveSaloon();
    openPlanner(STAGED);
    const view = plan({ space: { ...SALOON_SPACE, slug: "grand-hall", name: "Grand Hall" }, eligible: false });
    await expectNothingAsked(fake);
    view.rerender(createElement(Planner, { space: null }));
    await expectNothingAsked(fake);
  });
});

describe("usePlannerSurveyedRoom, where a survey is asked for", () => {
  it("says the room is arriving at once, then loads a staged survey for a Trades Hall room and hands it over with its opening pose", async () => {
    const fake = serveSaloon();
    openPlanner(STAGED);
    plan({ space: SALOON_SPACE });
    // In the pass that asks for the survey, before any of its code or files has come: nothing to draw, and
    // the planner is told one is arriving.
    expect(seam.model).toBeNull();
    expect(seam.opening).toBeNull();
    expect(status()).toMatchObject({ roomName: "Saloon", phase: "loading", files: { settled: 0, expected: null }, photos: null });
    expect(surveyedRoomCaption(status())).toBe("Loading the Saloon as surveyed");
    expect(surveyedRoomWorking(status())).toBe(true);
    expect(load).toHaveBeenCalled();
    await waitFor(() => { expect(seam.model).not.toBeNull(); });
    const room = seam.model?.props.room;
    if (room === undefined) throw new Error("no room was handed over");
    expect(room.record.slug).toBe("saloon");
    expect(room.entry).toEqual({ slug: "saloon", base: FOLDER, revision: 1 });
    expect(venue.asked).toContain(SALOON_SPACE.venueId);
    expect(fake.mock.calls.map((call) => call[0])).toEqual([`${FOLDER}/survey.json?r=1`, `${FOLDER}/walls-relief.bin?r=1`, `${FOLDER}/ceiling-relief.bin?r=1`]);
    expect(status()).toMatchObject({ roomName: "Saloon", phase: "ready", failure: null });
    // The planner's own view of the room's data, from as far back as holds the room as surveyed.
    expect(seam.opening).toEqual(surveyedRoomOpeningPose(room.geometry, DIMENSIONS, FOV));
    // The drawn room's photograph reports reach the caption.
    act(() => { seam.model?.props.onPhotoProgress?.({ expected: 3, settled: 1, failed: [] }); });
    expect(surveyedRoomCaption(status())).toBe("Loading the Saloon's photographs · 1 of 3");
  });

  it("counts the code's own download as part of the room's arrival: nothing is read, fetched or drawn until it has come", async () => {
    const fake = serveSaloon();
    openPlanner(STAGED);
    const download = held<SurveyedRoomCode>();
    load.mockImplementation(() => download.promise);
    plan({ space: SALOON_SPACE });
    await settle();
    expect(load).toHaveBeenCalled();
    // Still arriving, with working motion: never settled, so nothing is photographed as a finished room.
    expect(status()).toMatchObject({ roomName: "Saloon", phase: "loading", files: { settled: 0, expected: null } });
    expect(surveyedRoomWorking(status())).toBe(true);
    expect(seam).toEqual(NOTHING);
    expect(venue.asked).toEqual([]);
    expect(fake).not.toHaveBeenCalled();
    // It arrives, late.
    const code = await import("../PlannerSurveyedRoom.js");
    await act(async () => {
      download.resolve(code);
      await download.promise;
    });
    await waitFor(() => { expect(seam.model).not.toBeNull(); });
    expect(status()).toMatchObject({ roomName: "Saloon", phase: "ready", failure: null });
    expect(fake).toHaveBeenCalledTimes(3);
  });

  it("ends as the survey's failure when its code cannot be had: the reason kept, the shell left standing, and the next room asks again", async () => {
    const fake = serveSaloon();
    openPlanner(STAGED);
    load.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module: /assets/PlannerSurveyedRoom.js")));
    const view = plan({ space: SALOON_SPACE });
    await waitFor(() => { expect(status()?.phase).toBe("failed"); });
    expect(status()?.failure).toBe("the room's code (import): Failed to fetch dynamically imported module: /assets/PlannerSurveyedRoom.js");
    expect(surveyedRoomCaption(status())).toBe("The surveyed Saloon could not load, so the room is drawn plainly. Planning is unaffected.");
    expect(surveyedRoomWorking(status())).toBe(false);
    expect(surveyedRoomTrouble(status())).toBe(true);
    // Nothing of it is mounted, so nothing can suspend or throw; and nothing was read or fetched for it.
    expect(seam).toEqual(NOTHING);
    expect(venue.asked).toEqual([]);
    expect(fake).not.toHaveBeenCalled();
    // A failure is not kept: another room asks for the code afresh, and gets it.
    load.mockRestore();
    load = vi.spyOn(surveyedRoomCode, "load");
    view.rerender(createElement(Planner, { space: { ...SALOON_SPACE, venueId: "00000000-0000-4000-8000-000000000100" } }));
    expect(status()?.phase).toBe("loading");
    await waitFor(() => { expect(seam.model).not.toBeNull(); });
    expect(load).toHaveBeenCalled();
    expect(status()?.phase).toBe("ready");
  });

  it("treats a download that came back with nothing as a failure, never as code to mount", async () => {
    // No build answers this way now: a chunk that will not load rejects, and the page reloads only
    // once the app's own server has answered (route-error-boundary.tsx). The seam still refuses it.
    serveSaloon();
    openPlanner(STAGED);
    load.mockImplementation(() => Promise.resolve(undefined));
    plan({ space: SALOON_SPACE });
    await waitFor(() => { expect(status()?.phase).toBe("failed"); });
    expect(status()?.failure).toMatch(/^the room's code \(import\): /);
    expect(seam).toEqual(NOTHING);
  });

  it("hands over no room when the survey cannot be loaded, and says so with the reason kept", async () => {
    serveSaloon("walls-relief.bin");
    openPlanner(STAGED);
    plan({ space: SALOON_SPACE });
    await waitFor(() => { expect(status()?.phase).toBe("failed"); });
    expect(seam.model).toBeNull();
    expect(seam.opening).toBeNull();
    expect(status()?.failure).toMatch(/^walls-relief\.bin \(http\): HTTP 404/);
    expect(surveyedRoomCaption(status())).toBe("The surveyed Saloon could not load, so the room is drawn plainly. Planning is unaffected.");
  });

  it("refuses a staged folder that holds another room's survey", async () => {
    serveSaloon();
    openPlanner(STAGED);
    plan({ space: { ...SALOON_SPACE, slug: "reception-room", name: "Reception Room" } });
    await waitFor(() => { expect(status()?.phase).toBe("failed"); });
    expect(seam.model).toBeNull();
    expect(status()?.failure).toMatch(/^survey\.json \(room\): the record is of "saloon"/);
  });

  it.each<[TradesHallVenueStatus, string]>([["other", "another venue's"], ["unknown", "a venue that could not be read"]])(
    "never loads Trades Hall's survey for a room of the same slug where the venue is %s (%s), and stops saying one is arriving", async (venueStatus) => {
      venue.status = venueStatus;
      const fake = serveSaloon();
      openPlanner(STAGED);
      plan({ space: SALOON_SPACE });
      // A survey is asked for by the room's slug, so until its venue is read the room is said to be arriving.
      expect(status()?.phase).toBe("loading");
      await waitFor(() => { expect(status()).toBeNull(); });
      expect(venue.asked).toContain(SALOON_SPACE.venueId);
      expect(seam.model).toBeNull();
      expect(fake).not.toHaveBeenCalled();
    },
  );

  it("goes on saying the room is arriving while its venue is still being read, and fetches nothing yet", async () => {
    venue.status = "reading";
    const fake = serveSaloon();
    openPlanner(STAGED);
    plan({ space: SALOON_SPACE });
    await waitFor(() => { expect(venue.asked).toContain(SALOON_SPACE.venueId); });
    await settle();
    expect(status()).toMatchObject({ roomName: "Saloon", phase: "loading", files: { settled: 0, expected: null } });
    expect(seam.model).toBeNull();
    expect(fake).not.toHaveBeenCalled();
  });

  it("hands over one opening pose for as long as the room and its data's numbers stand, and a new one when they change (SM3)", async () => {
    const fake = serveSaloon();
    openPlanner(STAGED);
    const view = plan({ space: SALOON_SPACE });
    await waitFor(() => { expect(seam.model).not.toBeNull(); });
    const { opening, model } = seam;
    const room = model?.props.room;
    if (room === undefined || opening === null) throw new Error("no room was handed over");
    const fetched = fake.mock.calls.length;
    // The space read again and found equal: new objects, the same numbers. The rig opens the camera afresh for a
    // new pose object, so the pose, and the room, must be the ones already handed over.
    view.rerender(createElement(Planner, { space: { ...SALOON_SPACE }, dimensions: { ...DIMENSIONS } }));
    expect(seam.opening).toBe(opening);
    expect(seam.model).toBe(model);
    // The room's data grows taller: the planner's own view of it moves, and the opening with it. The survey does not load again.
    const taller: SpaceDimensions = { ...DIMENSIONS, height: 6.4 };
    view.rerender(createElement(Planner, { space: SALOON_SPACE, dimensions: taller }));
    expect(seam.opening).not.toBe(opening);
    expect(seam.opening).toEqual(surveyedRoomOpeningPose(room.geometry, taller, FOV));
    expect(seam.opening).not.toEqual(opening);
    expect(seam.model).toBe(model);
    expect(fake.mock.calls.length).toBe(fetched);
  });

  it("never draws a room handed over for an earlier request: another venue's room of the same slug has its shell from its first pass", async () => {
    serveSaloon();
    openPlanner(STAGED);
    const view = plan({ space: SALOON_SPACE });
    await waitFor(() => { expect(seam.model).not.toBeNull(); });
    const elsewhere = "00000000-0000-4000-8000-000000000100";
    venue.status = "other";
    view.rerender(createElement(Planner, { space: { ...SALOON_SPACE, venueId: elsewhere } }));
    // Not in any pass for that venue's room, the first included: the room in hand was Trades Hall's.
    const passes = renders.filter((pass) => pass.venueId === elsewhere);
    expect(passes.length).toBeGreaterThan(0);
    expect(passes.every((pass) => !pass.drawn)).toBe(true);
    expect(seam.model).toBeNull();
    expect(seam.opening).toBeNull();
    await waitFor(() => { expect(status()).toBeNull(); });
  });

  it("leaves nothing said when the scene goes", async () => {
    serveSaloon();
    openPlanner(STAGED);
    const view = plan({ space: SALOON_SPACE });
    await waitFor(() => { expect(status()?.phase).toBe("ready"); });
    view.unmount();
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
