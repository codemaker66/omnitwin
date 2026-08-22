import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QuizRun } from "@omnitwin/types";
import { classifyViewport, recordQuizRun } from "../quiz-telemetry.js";

const RUN: QuizRun = {
  quiz: "trades-house-craft",
  answers: [2, 0, 3, 1, 2, 2, 0, 3, 1, 2, 0, 1],
  deliberation: { pair: ["masons", "weavers"], choice: 1, authored: true },
  result: "weavers",
  runnerUp: "masons",
  margin: 0.21,
  hung: false,
  durationMs: 412_000,
  viewport: "phone",
};

describe("recording a run", () => {
  const originalFetch = globalThis.fetch;
  let calls: { url: string; body: string; init: RequestInit | undefined }[];

  beforeEach(() => {
    calls = [];
    const stub: typeof fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({ url, body, init });
      return Promise.resolve(new Response(null, { status: 202 }));
    };
    globalThis.fetch = stub;
    Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends exactly the schema, as JSON, with keepalive so a closed tab still counts", () => {
    expect(recordQuizRun(RUN)).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url.endsWith("/public/quiz-runs")).toBe(true);
    expect(call?.init?.method).toBe("POST");
    expect(call?.init?.keepalive).toBe(true);
    const sent = JSON.parse(call?.body ?? "{}") as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["answers", "deliberation", "durationMs", "hung", "margin", "quiz", "result", "runnerUp", "viewport"]);
  });

  it("refuses to send anything the schema would not accept", () => {
    // Three answers where the schema demands twelve. Built through the type
    // system's back door on purpose: the schema, not the type, is the guard.
    const bad: QuizRun = { ...RUN, answers: RUN.answers.slice(0, 3) };
    expect(recordQuizRun(bad)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("stays silent for anyone who has asked not to be tracked", () => {
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    expect(recordQuizRun(RUN)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("classifies the screen by width alone — never a user agent string", () => {
    expect(classifyViewport(375)).toBe("phone");
    expect(classifyViewport(820)).toBe("tablet");
    expect(classifyViewport(1440)).toBe("desktop");
  });
});
