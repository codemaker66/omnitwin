import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DatabaseConnection } from "../db/client.js";
import { clientEventScheduleRoutes } from "../routes/client-event-schedule.js";

const EVENT = "00000000-0000-4000-8000-000000000001";
const token = JSON.stringify({ id: "00000000-0000-4000-8000-000000000002", email: "test@example.invalid", role: "client", venueId: null });

describe("client event schedule HTTP validation", () => {
  let server: FastifyInstance;
  let connection: DatabaseConnection;
  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "test");
    // Pool creation is lazy. These requests must stop before any database use.
    connection = createDbConnection("postgresql://unused:unused@127.0.0.1:1/unused");
    server = Fastify();
    await server.register(clientEventScheduleRoutes, { db: connection.db, prefix: "/events" });
    await server.ready();
  });
  afterAll(async () => { await server.close(); await connection.close(); vi.unstubAllEnvs(); });

  it("requires authentication", async () => {
    expect((await server.inject({ method: "GET", url: `/events/${EVENT}/client-schedule` })).statusCode).toBe(401);
  });

  it("rejects malformed IDs, repeated configuration IDs and extra query grants before database access", async () => {
    for (const url of [
      "/events/not-a-uuid/client-schedule",
      `/events/${EVENT}/client-schedule?configurationId=not-a-uuid`,
      `/events/${EVENT}/client-schedule?configurationId=${EVENT}&configurationId=${EVENT}`,
      `/events/${EVENT}/client-schedule?audience=admin`,
    ]) {
      const response = await server.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
  });
});
