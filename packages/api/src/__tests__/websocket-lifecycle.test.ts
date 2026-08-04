import { expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

function nextImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

it("owns one websocket shutdown lifecycle while retaining the HTTP fallback route", async () => {
  const websocketListenerWarnings: Error[] = [];
  const onWarning = (warning: Error): void => {
    if (
      warning.name === "MaxListenersExceededWarning" &&
      warning.message.includes("WebSocketServer")
    ) {
      websocketListenerWarnings.push(warning);
    }
  };

  let server: FastifyInstance | null = null;
  process.on("warning", onWarning);

  try {
    const builtServer = await buildServer();
    server = builtServer;

    const response = await builtServer.inject({
      method: "GET",
      url: "/ws/configurations/00000000-0000-4000-8000-000000000001",
    });
    expect(response.statusCode).toBe(404);

    await builtServer.close();
    server = null;
    await nextImmediate();

    expect(websocketListenerWarnings).toEqual([]);
  } finally {
    process.off("warning", onWarning);
    if (server !== null) await server.close();
  }
});
