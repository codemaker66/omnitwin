import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { fetchSurveyRecord, SurveyLoadError } from "../load-survey.js";
import { SurveyRecordError } from "../survey-record.js";

const URL_ = "/rooms/saloon/survey-2026-07-11/survey.json?r=1";
const FIXTURE_TEXT = readFileSync(path.resolve("src/components/surveyed-room/__tests__/fixtures/saloon-survey.fixture.json"), "utf-8");

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubFetch(implementation: FetchFn): Mock<FetchFn> {
  const fake = vi.fn(implementation);
  vi.stubGlobal("fetch", fake);
  return fake;
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("the load succeeded");
}

describe("fetchSurveyRecord", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches, parses and checks a record", async () => {
    const fake = stubFetch(() => Promise.resolve(new Response(FIXTURE_TEXT, { status: 200 })));
    const record = await fetchSurveyRecord(URL_);
    expect(record.slug).toBe("saloon");
    expect(record.walls).toHaveLength(12);
    expect(fake).toHaveBeenCalledTimes(1);
    expect(fake.mock.calls[0]?.[0]).toBe(URL_);
  });

  it("passes the caller's signal to the request", async () => {
    const fake = stubFetch(() => Promise.resolve(new Response(FIXTURE_TEXT, { status: 200 })));
    const controller = new AbortController();
    await fetchSurveyRecord(URL_, controller.signal);
    const init = fake.mock.calls[0]?.[1];
    expect(init?.signal).toBe(controller.signal);
  });

  it("tells an HTTP failure apart, with its status", async () => {
    stubFetch(() => Promise.resolve(new Response("missing", { status: 404 })));
    const error = await failure(fetchSurveyRecord(URL_));
    expect(error).toBeInstanceOf(SurveyLoadError);
    expect(error).toMatchObject({ reason: "http", status: 404, url: URL_ });
    expect((error as Error).message).toMatch(/HTTP 404/);
  });

  it("tells a request that never completed apart", async () => {
    const cause = new TypeError("Failed to fetch");
    stubFetch(() => Promise.reject(cause));
    const error = await failure(fetchSurveyRecord(URL_));
    expect(error).toMatchObject({ reason: "network", status: null, cause });
  });

  it("tells a body that is not JSON apart", async () => {
    stubFetch(() => Promise.resolve(new Response("<!doctype html><title>Venviewer</title>", { status: 200 })));
    const error = await failure(fetchSurveyRecord(URL_));
    expect(error).toBeInstanceOf(SurveyLoadError);
    expect(error).toMatchObject({ reason: "json" });
    expect((error as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it("tells a record that fails the schema apart, keeping its faults", async () => {
    const record = JSON.parse(FIXTURE_TEXT) as { schemaVersion: number };
    record.schemaVersion = 1;
    stubFetch(() => Promise.resolve(new Response(JSON.stringify(record), { status: 200 })));
    const error = await failure(fetchSurveyRecord(URL_));
    expect(error).toMatchObject({ reason: "schema" });
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(SurveyRecordError);
    expect((cause as SurveyRecordError).faults[0]).toMatch(/^schemaVersion is 1/);
    expect((error as Error).message).toMatch(/^survey\.json: schemaVersion is 1/);
  });

  it("does not fetch for a signal already aborted", async () => {
    const fake = stubFetch(() => Promise.resolve(new Response(FIXTURE_TEXT, { status: 200 })));
    const controller = new AbortController();
    controller.abort();
    const error = await failure(fetchSurveyRecord(URL_, controller.signal));
    expect(error).toBe(controller.signal.reason);
    expect(fake).not.toHaveBeenCalled();
  });

  it("passes an abort during the request through untouched", async () => {
    const controller = new AbortController();
    stubFetch((_input, init) => new Promise<Response>((_resolve, reject) => {
      // As fetch does: it rejects with the signal's reason (an AbortError).
      init?.signal?.addEventListener("abort", () => { reject(init.signal?.reason as DOMException); });
    }));
    const pending = fetchSurveyRecord(URL_, controller.signal);
    controller.abort();
    const error = await failure(pending);
    expect(error).toBe(controller.signal.reason);
    expect(error).not.toBeInstanceOf(SurveyLoadError);
  });

  it("stops with the abort when it comes after the response", async () => {
    const controller = new AbortController();
    stubFetch(() => {
      const response = new Response(FIXTURE_TEXT, { status: 200 });
      // The caller gives up while the body is read.
      vi.spyOn(response, "text").mockImplementation(() => {
        controller.abort();
        return Promise.resolve(FIXTURE_TEXT);
      });
      return Promise.resolve(response);
    });
    const error = await failure(fetchSurveyRecord(URL_, controller.signal));
    expect(error).toBe(controller.signal.reason);
  });
});
