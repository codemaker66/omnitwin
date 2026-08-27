import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  LOCAL_SESSION_MINIMUM_TTL_MS,
  LOCAL_SESSION_SECURITY_HEADERS,
  LocalSessionHttpError,
  LocalSessionRequestGate,
  assertLocalSessionRequest,
  assertLocalSessionUrlHasNoQuery,
  createLocalSessionTokenBroker,
  listenLocalSessionServer,
  readLocalSessionStrictJsonObject,
  sendLocalSessionError,
  sendLocalSessionJson,
} from "../local-session-http.js";

interface HttpResult {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: Buffer;
}

const openServers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
    server.closeAllConnections();
  })));
});

async function startServer(
  handler: (
    incoming: IncomingMessage,
    response: ServerResponse,
    origin: string,
  ) => Promise<void> | void,
): Promise<{ readonly origin: string; readonly port: number }> {
  let origin = "";
  const server = createServer((incoming, response) => {
    void Promise.resolve()
      .then(() => handler(incoming, response, origin))
      .catch((error: unknown) => {
        sendLocalSessionError(
          response,
          error instanceof LocalSessionHttpError
            ? error
            : new LocalSessionHttpError(500, "Unexpected test server failure.", error),
        );
      });
  });
  openServers.push(server);
  const port = await listenLocalSessionServer(server, 0);
  origin = `http://127.0.0.1:${String(port)}`;
  return { origin, port };
}

function performRequest(
  port: number,
  options: {
    readonly path?: string;
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: Buffer;
  } = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const outgoing = request({
      hostname: "127.0.0.1",
      port,
      path: options.path ?? "/",
      method: options.method ?? "GET",
      headers: options.headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    outgoing.once("error", reject);
    if (options.body !== undefined) outgoing.write(options.body);
    outgoing.end();
  });
}

describe("local-session HTTP security boundary", () => {
  it("uses one fragment bootstrap and a memory bearer without query tokens", () => {
    const broker = createLocalSessionTokenBroker();
    const bootstrap = new URLSearchParams(broker.bootstrapFragment.slice(1)).get("bootstrap");
    if (bootstrap === null) throw new Error("fixture bootstrap missing");
    const bearer = broker.exchangeBootstrapToken(bootstrap);
    expect(bearer).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(() => broker.exchangeBootstrapToken(bootstrap)).toThrow(/already been used/i);
    expect(() => {
      assertLocalSessionUrlHasNoQuery(
        new URL(`http://127.0.0.1:1234/api/state?token=${bearer}`),
      );
    }).toThrow(/query credentials/i);
    broker.destroy();
  });

  it("enforces exact loopback Host, mutation Origin, and one bearer header", async () => {
    const broker = createLocalSessionTokenBroker();
    const bootstrap = new URLSearchParams(broker.bootstrapFragment.slice(1)).get("bootstrap");
    if (bootstrap === null) throw new Error("fixture bootstrap missing");
    const bearer = broker.exchangeBootstrapToken(bootstrap);
    const running = await startServer((incoming, response, origin) => {
      assertLocalSessionRequest(incoming, `127.0.0.1:${String(running.port)}`, origin, true);
      broker.authorizeRequest(incoming);
      sendLocalSessionJson(response, 200, { ok: true });
    });
    const valid = await performRequest(running.port, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Origin: running.origin,
        "Sec-Fetch-Site": "same-origin",
      },
    });
    expect(valid.statusCode).toBe(200);

    const missingOrigin = await performRequest(running.port, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(missingOrigin.statusCode).toBe(403);

    const wrongBearer = await performRequest(running.port, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${"z".repeat(43)}`,
        Origin: running.origin,
      },
    });
    expect(wrongBearer.statusCode).toBe(401);
  });

  it("expires and destroys the in-memory bearer at the fixed session deadline", async () => {
    let now = 10_000;
    const broker = createLocalSessionTokenBroker({
      ttlMs: LOCAL_SESSION_MINIMUM_TTL_MS,
      monotonicNowMs: () => now,
    });
    const bootstrap = new URLSearchParams(broker.bootstrapFragment.slice(1)).get("bootstrap");
    if (bootstrap === null) throw new Error("fixture bootstrap missing");
    const bearer = broker.exchangeBootstrapToken(bootstrap);
    const running = await startServer((incoming, response) => {
      broker.authorizeRequest(incoming);
      sendLocalSessionJson(response, 200, { ok: true });
    });
    const authorized = () => performRequest(running.port, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect((await authorized()).statusCode).toBe(200);
    now += LOCAL_SESSION_MINIMUM_TTL_MS;
    expect((await authorized()).statusCode).toBe(401);
    expect(() => broker.bootstrapFragment).toThrow(/expired/i);

    const destroyed = createLocalSessionTokenBroker();
    const destroyedBootstrap = new URLSearchParams(
      destroyed.bootstrapFragment.slice(1),
    ).get("bootstrap");
    if (destroyedBootstrap === null) throw new Error("fixture bootstrap missing");
    destroyed.exchangeBootstrapToken(destroyedBootstrap);
    destroyed.destroy();
    expect(destroyed.bootstrapFragment).toBe("");
  });

  it.each([
    [Buffer.from("{\"safe\":1,\"safe\":2}"), "duplicate"],
    [Buffer.from("{\"__proto__\":{}}"), "prototype"],
    [Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), "BOM"],
    [Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]), "UTF-8"],
  ])("rejects non-strict JSON bytes (%s)", async (body) => {
    const running = await startServer(async (incoming, response) => {
      const value = await readLocalSessionStrictJsonObject(incoming, 1_024);
      sendLocalSessionJson(response, 200, value);
    });
    const result = await performRequest(running.port, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(body.byteLength),
      },
      body,
    });
    expect(result.statusCode).toBe(400);
  });

  it("accepts one bounded strict JSON object and rejects oversize before parsing", async () => {
    const running = await startServer(async (incoming, response) => {
      const value = await readLocalSessionStrictJsonObject(incoming, 16);
      sendLocalSessionJson(response, 200, value);
    });
    const validBody = Buffer.from("{\"ok\":true}");
    const valid = await performRequest(running.port, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(validBody.byteLength),
      },
      body: validBody,
    });
    expect(valid.statusCode).toBe(200);

    const oversize = await performRequest(running.port, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "17",
      },
      body: Buffer.alloc(17, 0x20),
    });
    expect(oversize.statusCode).toBe(413);
  });

  it("sets the complete no-store, no-frame, no-worker security policy", async () => {
    const running = await startServer((_incoming, response) => {
      sendLocalSessionJson(response, 200, { ok: true });
    });
    const result = await performRequest(running.port);
    expect(result.statusCode).toBe(200);
    for (const [name, value] of Object.entries(LOCAL_SESSION_SECURITY_HEADERS)) {
      expect(result.headers[name.toLowerCase()]).toBe(value);
    }
    expect(result.headers["content-security-policy"]).toContain("worker-src 'none'");
    expect(result.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it("caps concurrent and rolling-minute request entry", () => {
    let now = 1_000;
    const gate = new LocalSessionRequestGate({
      maximumConcurrent: 2,
      maximumPerMinute: 3,
      monotonicNowMs: () => now,
    });
    const releaseFirst = gate.enter();
    const releaseSecond = gate.enter();
    expect(() => gate.enter()).toThrow(/too many.*active/i);
    releaseFirst();
    const releaseThird = gate.enter();
    releaseSecond();
    releaseThird();
    expect(() => gate.enter()).toThrow(/rate is too high/i);
    now += 60_001;
    expect(() => gate.enter()).not.toThrow();
  });
});
