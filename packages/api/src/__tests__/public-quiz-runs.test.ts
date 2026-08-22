import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QuizRun } from "@omnitwin/types";
import { publicQuizRunRoutes, type QuizRunStore } from "../routes/public-quiz-runs.js";

// ---------------------------------------------------------------------------
// POST /public/quiz-runs — the promises the route makes, proven rather than
// commented: nothing outside the schema lands, nothing malformed lands, a
// text/plain body (the keepalive send) is accepted, and the row is exactly
// the parsed body.
// ---------------------------------------------------------------------------

const RUN = {
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

function listStore(inserted: QuizRun[]): QuizRunStore {
  return {
    record(run) {
      inserted.push(run);
      return Promise.resolve();
    },
  };
}

describe("POST /public/quiz-runs", () => {
  let server: FastifyInstance;
  let inserted: QuizRun[];

  beforeEach(async () => {
    inserted = [];
    server = Fastify();
    await server.register(publicQuizRunRoutes, { store: listStore(inserted), prefix: "/public" });
  });

  afterEach(async () => {
    await server.close();
  });

  it("accepts a valid run and stores exactly the parsed body", async () => {
    const response = await server.inject({ method: "POST", url: "/public/quiz-runs", payload: RUN });
    expect(response.statusCode).toBe(202);
    expect(inserted).toEqual([RUN]);
  });

  it("strips anything outside the schema before it reaches the row", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/public/quiz-runs",
      payload: { ...RUN, email: "someone@example.com", note: "hello", ip: "203.0.113.9" },
    });
    expect(response.statusCode).toBe(202);
    expect(inserted).toHaveLength(1);
    const [row] = inserted;
    expect(row).toEqual(RUN);
    expect(Object.keys(row ?? {})).toEqual(Object.keys(RUN));
  });

  it("rejects a malformed run without inserting", async () => {
    const bad = [
      { ...RUN, answers: [...RUN.answers, 1] },
      { ...RUN, answers: RUN.answers.map((seat, index) => (index === 0 ? 4 : seat)) },
      { ...RUN, result: "glovers" },
      { ...RUN, durationMs: 7 * 60 * 60 * 1000 },
    ];
    for (const payload of bad) {
      const response = await server.inject({ method: "POST", url: "/public/quiz-runs", payload });
      expect(response.statusCode).toBe(400);
    }
    expect(inserted).toEqual([]);
  });

  it("accepts the keepalive send: JSON in a text/plain body", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/public/quiz-runs",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      payload: JSON.stringify(RUN),
    });
    expect(response.statusCode).toBe(202);
    expect(inserted).toEqual([RUN]);
  });

  it("rejects a text/plain body that is not JSON, without inserting", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/public/quiz-runs",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      payload: "not json",
    });
    expect(response.statusCode).toBe(400);
    expect(inserted).toEqual([]);
  });

  it("refuses a body larger than any run could be, before parsing it", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/public/quiz-runs",
      payload: { ...RUN, padding: "x".repeat(8_000) },
    });
    expect(response.statusCode).toBe(413);
    expect(inserted).toEqual([]);
  });
});
