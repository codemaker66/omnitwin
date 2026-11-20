import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerJobWorkerHealth, workerHealth } from "../services/jobs/health.js";
import type { JobWorkerStatus } from "../services/jobs/worker.js";

// T-702: GET /health/worker, the check from outside. It answers from the
// worker's memory only, so its rule is a pure function of a status and a
// clock, tested here without a database or the whole server.

const NOW = 1_800_000_000_000;

const healthy: JobWorkerStatus = {
  started: true,
  lastPassAt: NOW - 5_000,
  nextWakeAt: NOW + 600_000,
  currentJob: null,
  abandonedHandlers: 0,
  fault: null,
  passRunning: false,
};

describe("jobs: the worker's health rule", () => {
  it("with no worker installed it answers 200 and says the worker is off", () => {
    expect(workerHealth(null, NOW)).toEqual({ statusCode: 200, body: { worker: "off" } });
  });

  it("a worker sleeping until its next wake is well: 200 with its status", () => {
    expect(workerHealth(healthy, NOW)).toEqual({ statusCode: 200, body: healthy });
  });

  it("a worker with a fault answers 503 with its status", () => {
    const faulty: JobWorkerStatus = { ...healthy, fault: "database" };
    expect(workerHealth(faulty, NOW)).toEqual({ statusCode: 503, body: faulty });
  });

  it("a wake more than two minutes overdue with no pass running answers 503", () => {
    const overdue: JobWorkerStatus = { ...healthy, nextWakeAt: NOW - 120_001 };
    expect(workerHealth(overdue, NOW)).toEqual({ statusCode: 503, body: overdue });
  });

  it("a wake two minutes late, or later but with a pass running, is still well", () => {
    expect(workerHealth({ ...healthy, nextWakeAt: NOW - 120_000 }, NOW).statusCode).toBe(200);
    expect(workerHealth({ ...healthy, nextWakeAt: NOW - 600_000, passRunning: true }, NOW).statusCode).toBe(200);
  });

  it("a handler running for more than 60 seconds answers 503", () => {
    const stuck: JobWorkerStatus = { ...healthy, passRunning: true, currentJob: { id: "j1", kind: "jobs.daily", since: NOW - 60_001 } };
    expect(workerHealth(stuck, NOW)).toEqual({ statusCode: 503, body: stuck });
    expect(workerHealth({ ...stuck, currentJob: { id: "j1", kind: "jobs.daily", since: NOW - 60_000 } }, NOW).statusCode).toBe(200);
  });
});

describe("jobs: GET /health/worker", () => {
  it("answers from the status it is given: off, well, overdue and faulty", async () => {
    let status: JobWorkerStatus | null = null;
    const server = Fastify();
    registerJobWorkerHealth(server, { read: () => status, now: () => NOW });
    try {
      const off = await server.inject({ method: "GET", url: "/health/worker" });
      expect(off.statusCode).toBe(200);
      expect(off.json()).toEqual({ worker: "off" });

      status = healthy;
      const well = await server.inject({ method: "GET", url: "/health/worker" });
      expect(well.statusCode).toBe(200);
      expect(well.json()).toEqual(healthy);

      status = { ...healthy, nextWakeAt: NOW - 180_000 };
      const overdue = await server.inject({ method: "GET", url: "/health/worker" });
      expect(overdue.statusCode).toBe(503);
      expect(overdue.json()).toEqual(status);

      status = { ...healthy, fault: "loop" };
      const faulty = await server.inject({ method: "GET", url: "/health/worker" });
      expect(faulty.statusCode).toBe(503);
      expect(faulty.json()).toMatchObject({ fault: "loop" });
    } finally {
      await server.close();
    }
  });
});
