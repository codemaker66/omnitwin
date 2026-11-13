import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { SurveyedRoomEntry } from "../room-registry.js";
import {
  loadSurveyedRoom,
  SurveyedRoomLoadError,
  useSurveyedRoom,
  type SurveyedRoomFailure,
  type SurveyedRoomProgress,
  type SurveyedRoomState,
} from "../use-surveyed-room.js";
import { grandHallFile, grandHallRecordJson } from "./fixtures/grand-hall-record.js";
import { encodeReliefFile, flatCeilingEntry, flatWallEntry, type ReliefEntrySource } from "./fixtures/relief-file.js";

const SALOON: SurveyedRoomEntry = { base: "/rooms/saloon/survey-2026-07-11", revision: 1 };
const FIXTURE_TEXT = readFileSync(path.resolve("src/components/surveyed-room/__tests__/fixtures/saloon-survey.fixture.json"), "utf-8");

interface RawSaloon {
  schemaVersion: number;
  revision: number;
  walls: { id: string; reliefId: string; length: number; height: number }[];
  ceiling: { extent: { x: [number, number]; z: [number, number] }; relief?: { file: string; id: string } };
  files: Record<string, { bytes: number; sha256: string }>;
}

/** The Saloon's walls as flat reliefs, one entry a wall, as its relief file would hold them. */
function saloonWalls(record: RawSaloon): ReliefEntrySource[] {
  return record.walls.map((wall) => flatWallEntry(wall.reliefId, wall.length, wall.height));
}

interface SaloonFiles {
  readonly record: RawSaloon;
  readonly walls: ArrayBuffer;
  readonly ceiling: ArrayBuffer;
}

/** The Saloon's three data files, the record listing the reliefs at their real sizes. */
function saloonFiles(change: (record: RawSaloon) => void = () => undefined, walls?: ArrayBuffer): SaloonFiles {
  const record = JSON.parse(FIXTURE_TEXT) as RawSaloon;
  const wallsFile = walls ?? encodeReliefFile(saloonWalls(record));
  const ceilingFile = encodeReliefFile([flatCeilingEntry("ceiling", record.ceiling.extent.x, record.ceiling.extent.z)]);
  const zero = "0".repeat(64);
  record.files["walls-relief.bin"] = { bytes: wallsFile.byteLength, sha256: zero };
  record.files["ceiling-relief.bin"] = { bytes: ceilingFile.byteLength, sha256: zero };
  change(record);
  return { record, walls: wallsFile, ceiling: ceilingFile };
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Answer = (init: RequestInit | undefined) => Response | Promise<Response>;

/** Answers each survey file by name; a file left out is a 404, as a static host answers. */
function serve(answers: Readonly<Record<string, Answer>>): Mock<FetchFn> {
  const fake = vi.fn<FetchFn>((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const name = url.split("?")[0]?.split("/").pop() ?? "";
    const answer = answers[name];
    return Promise.resolve(answer === undefined ? new Response("not found", { status: 404 }) : answer(init));
  });
  vi.stubGlobal("fetch", fake);
  return fake;
}

const json = (value: unknown): Answer => () => new Response(JSON.stringify(value), { status: 200 });
const bytes = (buffer: ArrayBuffer): Answer => () => new Response(buffer.slice(0), { status: 200 });

function serveSaloon(files: SaloonFiles, overrides: Readonly<Record<string, Answer>> = {}): Mock<FetchFn> {
  return serve({ "survey.json": json(files.record), "walls-relief.bin": bytes(files.walls), "ceiling-relief.bin": bytes(files.ceiling), ...overrides });
}

/** The failure a load ends in. */
async function failureOf(promise: Promise<unknown>): Promise<SurveyedRoomFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SurveyedRoomLoadError) return error.failure;
    throw error;
  }
  throw new Error("the room loaded");
}

/** A request that waits for the test, and stops as fetch does when its signal aborts. */
function held(): { readonly answer: Answer; readonly release: (response: Response) => void; readonly signal: () => AbortSignal | null } {
  let release: (response: Response) => void = () => undefined;
  let seen: AbortSignal | null = null;
  const answer: Answer = (init) => new Promise<Response>((resolve, reject) => {
    release = resolve;
    seen = init?.signal ?? null;
    init?.signal?.addEventListener("abort", () => { reject(init.signal?.reason as Error); });
  });
  return { answer, release: (response) => { release(response); }, signal: () => seen };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("loading a surveyed room", () => {
  it("reads the record and both reliefs at the entry's revision, and builds the room's surfaces", async () => {
    const files = saloonFiles();
    const fake = serveSaloon(files);
    const progress: SurveyedRoomProgress[] = [];
    const room = await loadSurveyedRoom(SALOON, undefined, (step) => { progress.push(step); });
    expect(fake.mock.calls.map((call) => call[0])).toEqual([
      "/rooms/saloon/survey-2026-07-11/survey.json?r=1",
      "/rooms/saloon/survey-2026-07-11/walls-relief.bin?r=1",
      "/rooms/saloon/survey-2026-07-11/ceiling-relief.bin?r=1",
    ]);
    // The record says how many files there are; before it, nobody knows.
    expect(progress).toEqual([{ settled: 1, expected: 3 }, { settled: 2, expected: 3 }, { settled: 3, expected: 3 }]);
    expect(room.entry).toBe(SALOON);
    expect(room.record.slug).toBe("saloon");
    expect(room.frame.walls).toHaveLength(12);
    expect(room.reliefs.walls?.size).toBe(12);
    expect(room.reliefs.ceiling?.id).toBe("ceiling");
    expect(room.geometry.walls.runs.map((run) => run.measured)).toEqual(Array.from({ length: 12 }, () => true));
    expect(room.geometry.ceiling.measured).toBe(true);
    expect(room.geometry.floor.indices).toHaveLength(30);
  });

  it("loads a room without a ceiling relief from two files", async () => {
    const files = saloonFiles((record) => {
      delete record.ceiling.relief;
      delete record.files["ceiling-relief.bin"];
    });
    const fake = serveSaloon(files);
    const progress: SurveyedRoomProgress[] = [];
    const room = await loadSurveyedRoom(SALOON, undefined, (step) => { progress.push(step); });
    expect(fake).toHaveBeenCalledTimes(2);
    expect(progress).toEqual([{ settled: 1, expected: 2 }, { settled: 2, expected: 2 }]);
    expect(room.reliefs.ceiling).toBeNull();
    expect(room.geometry.ceiling.measured).toBe(false);
  });

  it("loads the Grand Hall's shipped relief through a record that lists its real size", async () => {
    const hall: SurveyedRoomEntry = { base: "/rooms/grand-hall/survey-2026-07-11", revision: 7 };
    serve({ "survey.json": json(grandHallRecordJson()), "walls-relief.bin": bytes(grandHallFile("walls-relief.bin")) });
    const room = await loadSurveyedRoom(hall);
    expect(room.geometry.walls.indices.length / 3).toBe(35185);
    expect(room.geometry.walls.runs.every((run) => run.measured)).toBe(true);
    expect(room.geometry.ceiling.measured).toBe(false);
  });

  it.each<[string, Answer, Partial<SurveyedRoomFailure>]>([
    ["the server refuses the record", () => new Response("gone", { status: 404 }), { reason: "http", status: 404 }],
    ["the record's request never completes", () => Promise.reject(new TypeError("Failed to fetch")), { reason: "network", status: null }],
    ["the record is a page, not JSON", () => new Response("<!doctype html><title>Venviewer</title>", { status: 200 }), { reason: "json" }],
    ["the record is another schema version", json({ ...saloonFiles().record, schemaVersion: 1 }), { reason: "schema" }],
    ["the record is another revision than was asked for", json({ ...saloonFiles().record, revision: 2 }), { reason: "revision" }],
  ])("fails, naming survey.json, when %s", async (_name, answer, expected) => {
    const fake = serveSaloon(saloonFiles(), { "survey.json": answer });
    const failure = await failureOf(loadSurveyedRoom(SALOON));
    expect(failure).toMatchObject({ file: "survey.json", url: "/rooms/saloon/survey-2026-07-11/survey.json?r=1", ...expected });
    expect(failure.detail.length).toBeGreaterThan(0);
    // Nothing else is asked for once the record cannot be used.
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it("says which revision it wanted and which it found", async () => {
    serveSaloon(saloonFiles((record) => { record.revision = 2; }));
    const failure = await failureOf(loadSurveyedRoom(SALOON));
    expect(failure.detail).toBe("the record is revision 2 but revision 1 was asked for");
  });

  const insideOut = (): ArrayBuffer => {
    const entries = saloonWalls(saloonFiles().record);
    const [front, ...rest] = entries;
    if (front === undefined) throw new Error("no wall");
    return encodeReliefFile([{ ...front, indices: [0, 2, 1, 0, 3, 2] }, ...rest]);
  };
  const withoutAWall = (): ArrayBuffer => encodeReliefFile(saloonWalls(saloonFiles().record).slice(0, 11));

  it.each<[string, () => SaloonFiles, Answer | null, Partial<SurveyedRoomFailure>, RegExp]>([
    ["the server refuses it", saloonFiles, () => new Response("gone", { status: 503 }), { reason: "http", status: 503 }, /HTTP 503/],
    ["its request never completes", saloonFiles, () => Promise.reject(new TypeError("Failed to fetch")), { reason: "network" }, /could not be fetched/],
    ["it is a page, not a relief", saloonFiles, () => new Response("<!doctype html>", { status: 200 }), { reason: "format" }, /not a relief file/],
    ["it leaves a wall out", () => saloonFiles(undefined, withoutAWall()), null, { reason: "format" }, /missing "fire-f-end"/],
    ["it is not the size the record lists", () => saloonFiles((record) => { record.files["walls-relief.bin"] = { bytes: 12, sha256: "0".repeat(64) }; }), null, { reason: "integrity" }, /but the record lists 12/],
    ["a wall in it is wound inside out", () => saloonFiles(undefined, insideOut()), null, { reason: "geometry" }, /wall "front"'s relief is wound clockwise/],
  ])("fails, naming the walls' relief, when %s", async (_name, files, answer, expected, detail) => {
    serveSaloon(files(), answer === null ? {} : { "walls-relief.bin": answer });
    const failure = await failureOf(loadSurveyedRoom(SALOON));
    expect(failure).toMatchObject({ file: "walls-relief.bin", url: "/rooms/saloon/survey-2026-07-11/walls-relief.bin?r=1", ...expected });
    expect(failure.detail).toMatch(detail);
  });

  it("fails, naming the ceiling's relief, when that is the file missing", async () => {
    serve({ "survey.json": json(saloonFiles().record), "walls-relief.bin": bytes(saloonFiles().walls) });
    const failure = await failureOf(loadSurveyedRoom(SALOON));
    expect(failure).toMatchObject({ file: "ceiling-relief.bin", reason: "http", status: 404 });
  });

  it("never draws a room flat because its relief failed: the load fails whole", async () => {
    serveSaloon(saloonFiles(), { "walls-relief.bin": () => new Response("gone", { status: 404 }) });
    await expect(loadSurveyedRoom(SALOON)).rejects.toBeInstanceOf(SurveyedRoomLoadError);
  });

  it("stops the other relief's request when one fails", async () => {
    const ceiling = held();
    serveSaloon(saloonFiles(), { "walls-relief.bin": () => new Response("gone", { status: 500 }), "ceiling-relief.bin": ceiling.answer });
    const failure = await failureOf(loadSurveyedRoom(SALOON));
    expect(failure).toMatchObject({ file: "walls-relief.bin", reason: "http", status: 500 });
    expect(ceiling.signal()?.aborted).toBe(true);
  });

  it("does not fetch for a signal already aborted", async () => {
    const fake = serveSaloon(saloonFiles());
    const controller = new AbortController();
    controller.abort();
    await expect(loadSurveyedRoom(SALOON, controller.signal)).rejects.toBe(controller.signal.reason);
    expect(fake).not.toHaveBeenCalled();
  });

  it("passes an abort through untouched, and stops the requests under way", async () => {
    const walls = held();
    serveSaloon(saloonFiles(), { "walls-relief.bin": walls.answer });
    const controller = new AbortController();
    const progress: SurveyedRoomProgress[] = [];
    const pending = loadSurveyedRoom(SALOON, controller.signal, (step) => { progress.push(step); });
    await waitFor(() => { expect(walls.signal()).not.toBeNull(); });
    controller.abort();
    const outcome = await pending.then(() => "loaded", (error: unknown) => error);
    expect(outcome).toBe(controller.signal.reason);
    expect(outcome).not.toBeInstanceOf(SurveyedRoomLoadError);
    expect(walls.signal()?.aborted).toBe(true);
    // Nothing is reported after the abort.
    const reported = progress.length;
    await Promise.resolve();
    expect(progress).toHaveLength(reported);
  });
});

describe("useSurveyedRoom", () => {
  it("asks for nothing without an entry", () => {
    const fake = serveSaloon(saloonFiles());
    const { result } = renderHook(() => useSurveyedRoom(null));
    expect(result.current).toEqual({ status: "idle" });
    expect(fake).not.toHaveBeenCalled();
  });

  it("goes from loading, counting the files in, to ready", async () => {
    const files = saloonFiles();
    const record = held();
    const walls = held();
    const ceiling = held();
    serve({ "survey.json": record.answer, "walls-relief.bin": walls.answer, "ceiling-relief.bin": ceiling.answer });
    const { result } = renderHook(() => useSurveyedRoom(SALOON));
    expect(result.current).toEqual({ status: "loading", settled: 0, expected: null });
    act(() => { record.release(new Response(JSON.stringify(files.record), { status: 200 })); });
    await waitFor(() => { expect(result.current).toEqual({ status: "loading", settled: 1, expected: 3 }); });
    act(() => { ceiling.release(new Response(files.ceiling, { status: 200 })); });
    await waitFor(() => { expect(result.current).toEqual({ status: "loading", settled: 2, expected: 3 }); });
    act(() => { walls.release(new Response(files.walls, { status: 200 })); });
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    const state: SurveyedRoomState = result.current;
    if (state.status !== "ready") throw new Error("not ready");
    expect(state.room.record.room.name).toBe("Saloon");
    expect(state.room.geometry.walls.runs).toHaveLength(12);
  });

  it("ends in a failed state that says which file and why", async () => {
    serveSaloon(saloonFiles(), { "walls-relief.bin": () => new Response("gone", { status: 404 }) });
    const { result } = renderHook(() => useSurveyedRoom(SALOON));
    await waitFor(() => { expect(result.current.status).toBe("failed"); });
    expect(result.current).toMatchObject({ status: "failed", failure: { file: "walls-relief.bin", reason: "http", status: 404 } });
  });

  it("keeps the room it has when handed an equal entry, and fetches nothing again", async () => {
    const fake = serveSaloon(saloonFiles());
    const { result, rerender } = renderHook(({ entry }: { entry: SurveyedRoomEntry }) => useSurveyedRoom(entry), { initialProps: { entry: SALOON } });
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    const first = result.current;
    rerender({ entry: { ...SALOON } });
    expect(result.current).toBe(first);
    expect(fake).toHaveBeenCalledTimes(3);
  });

  it("drops the room before at once for another entry, and stops its load", async () => {
    const files = saloonFiles();
    const slowWalls = held();
    const fake = serveSaloon(files, { "walls-relief.bin": slowWalls.answer });
    const { result, rerender } = renderHook(({ entry }: { entry: SurveyedRoomEntry }) => useSurveyedRoom(entry), { initialProps: { entry: SALOON } });
    await waitFor(() => { expect(slowWalls.signal()).not.toBeNull(); });
    const firstSignal = slowWalls.signal();

    // The same folder republished at revision 2: a different entry.
    const republished = saloonFiles((record) => { record.revision = 2; });
    fake.mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const name = url.split("?")[0]?.split("/").pop() ?? "";
      const body = name === "survey.json" ? JSON.stringify(republished.record) : name === "walls-relief.bin" ? republished.walls : republished.ceiling;
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    rerender({ entry: { ...SALOON, revision: 2 } });
    // In the very render the entry changes, the state is the new entry's.
    expect(result.current).toEqual({ status: "loading", settled: 0, expected: null });
    expect(firstSignal?.aborted).toBe(true);
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    const state: SurveyedRoomState = result.current;
    if (state.status !== "ready") throw new Error("not ready");
    expect(state.room.record.revision).toBe(2);
    expect(state.room.entry).toEqual({ ...SALOON, revision: 2 });
  });

  it("stops its load when it unmounts, and reports nothing after", async () => {
    const walls = held();
    serveSaloon(saloonFiles(), { "walls-relief.bin": walls.answer });
    const { result, unmount } = renderHook(() => useSurveyedRoom(SALOON));
    await waitFor(() => { expect(walls.signal()).not.toBeNull(); });
    const before = result.current;
    unmount();
    expect(walls.signal()?.aborted).toBe(true);
    expect(result.current).toBe(before);
  });
});
