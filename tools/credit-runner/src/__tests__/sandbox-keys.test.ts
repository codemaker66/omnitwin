import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { ANTHROPIC_API_URL, keyOnlyToAnthropic, sdkSandboxApi, type SandboxApi } from "../sandbox/api.js";
import { describeError } from "../task.js";

// Synthetic keys, built here so no key-shaped literal sits in the source.
const fakeKey = (kind: string, fill: string): string => ["sk", "ant", kind, fill.repeat(40)].join("-");
const KEY = fakeKey("api03", "t");
const OTHER_KEY = fakeKey("api03", "o");

/**
 * Every header SDK 0.131 builds for the launcher's requests, read from its
 * client (buildHeaders, the platform headers) and the resources the launcher
 * calls. The guard's allow-list must match it; a new SDK that sends more fails
 * the comparison test below and needs a look.
 */
const SDK_HEADERS: ReadonlySet<string> = new Set([
  "accept",
  "anthropic-beta",
  "anthropic-version",
  "content-type",
  "user-agent",
  "x-stainless-arch",
  "x-stainless-helper",
  "x-stainless-helper-method",
  "x-stainless-lang",
  "x-stainless-os",
  "x-stainless-package-version",
  "x-stainless-retry-count",
  "x-stainless-runtime",
  "x-stainless-runtime-version",
  "x-stainless-timeout",
]);

interface Seen {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
}

/** A fetch that records each request and answers it with `answer`. */
function seam(answer: (url: URL, method: string) => Response) {
  const seen: Seen[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    seen.push({ method, url, headers: new Headers(init?.headers) });
    return Promise.resolve(answer(url, method));
  };
  return { seen, fetch };
}

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const redirect = (status: number, location: string): Response => new Response(null, { status, headers: { location } });

/** A plausible answer to any of the launcher's calls. */
function anyAnswer(url: URL): Response {
  if (url.pathname.endsWith("/content")) return new Response("From abc\n", { status: 200, headers: { "content-type": "application/octet-stream" } });
  if (url.pathname.endsWith("/stream")) return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
  return json({ id: "x_1", status: "idle", data: [], next_page: null });
}

async function drain(items: AsyncIterable<unknown>): Promise<void> {
  for await (const item of items) void item;
}

/** One of each kind of request the launcher makes. */
async function everyCall(api: SandboxApi, dir: string): Promise<void> {
  await api.createEnvironment({ name: "e" });
  await api.retrieveEnvironment("env_1");
  await api.createAgent({ name: "a", model: "claude-opus-5-5" });
  await api.retrieveAgent("agent_1", 1);
  await api.uploadFile("spec.md", "# spec\n");
  await api.createSession({ agent: "agent_1", environment_id: "env_1" });
  await api.retrieveSession("sesn_1");
  await drain(api.listSessions("2026-01-01T00:00:00.000Z"));
  await api.archiveSession("sesn_1");
  (await api.openStream("sesn_1")).close();
  await drain(api.listEvents("sesn_1"));
  await api.sendEvents("sesn_1", [{ type: "user.interrupt" }]);
  await api.listOutputFiles("sesn_1");
  await api.downloadFile("file_1", path.join(dir, "patch-0001.patch"), 1000);
}

/** The same requests made with a bare SDK client, as SDK 0.131 builds them before any guard. */
async function everyCallBare(client: Anthropic): Promise<void> {
  await client.beta.environments.create({ name: "e" });
  await client.beta.environments.retrieve("env_1");
  await client.beta.agents.create({ name: "a", model: "claude-opus-5-5" });
  await client.beta.agents.retrieve("agent_1", { version: 1 });
  await client.files.upload({ file: await toFile(Buffer.from("# spec\n", "utf8"), "spec.md") });
  await client.beta.sessions.create({ agent: "agent_1", environment_id: "env_1" }, { maxRetries: 0, timeout: 60_000 });
  await client.beta.sessions.retrieve("sesn_1");
  await drain(client.beta.sessions.list({ "created_at[gte]": "2026-01-01T00:00:00.000Z", include_archived: true }));
  await client.beta.sessions.archive("sesn_1");
  (await client.beta.sessions.events.stream("sesn_1")).controller.abort();
  await drain(client.beta.sessions.events.list("sesn_1"));
  await client.beta.sessions.events.send("sesn_1", { events: [{ type: "user.interrupt" }] });
  await drain(client.beta.files.list({ scope_id: "sesn_1", betas: ["managed-agents-2026-04-01"] }));
  await (await client.files.download("file_1")).text();
}

/** Runs `body` with these variables set in process.env, and puts them back afterwards. */
async function withEnv<T>(vars: Readonly<Record<string, string | undefined>>, body: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  const put = (values: Readonly<Record<string, string | undefined>>): void => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  };
  put(vars);
  try {
    return await body();
  } finally {
    put(saved);
  }
}

const dirs: string[] = [];
async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("the headers that reach api.anthropic.com", () => {
  it("are only those SDK 0.131 builds, and the launcher's key, whatever ANTHROPIC_CUSTOM_HEADERS adds and whichever environment was checked", async () => {
    const dir = await tempDir("credit-runner-headers-");
    const wire = seam(anyAnswer);
    // The launcher's own check is handed an empty environment, so only the guard stands between process.env and the wire.
    await withEnv({ ANTHROPIC_CUSTOM_HEADERS: "X-Unknown-Extra: synthetic-extra\nAnthropic-Workspace-Id: wrkspc_synthetic" }, () => everyCall(sdkSandboxApi(KEY, wire.fetch, {}), dir));
    expect(wire.seen.length).toBeGreaterThanOrEqual(14);
    for (const request of wire.seen) {
      const where = `${request.method} ${request.url.pathname}`;
      expect(request.url.origin, where).toBe(ANTHROPIC_API_URL);
      for (const name of request.headers.keys()) expect(SDK_HEADERS.has(name) || name === "x-api-key", `${where}: ${name}`).toBe(true);
      expect(request.headers.get("x-api-key"), where).toBe(KEY);
    }
    expect(await readFile(path.join(dir, "patch-0001.patch"), "utf8")).toBe("From abc\n");
  });

  it("refuse an Authorization, a cookie or another X-Api-Key before anything is sent, naming neither value", async () => {
    for (const [header, value] of [
      ["Authorization", "Bearer synthetic-token-value"],
      ["X-Api-Key", OTHER_KEY],
      ["Proxy-Authorization", "Basic synthetic-proxy-value"],
      ["Cookie", "session=synthetic-cookie-value"],
    ] as const) {
      const wire = seam(anyAnswer);
      const errors = await withEnv({ ANTHROPIC_CUSTOM_HEADERS: `${header}: ${value}` }, async () => {
        const api = sdkSandboxApi(KEY, wire.fetch, {});
        return [await api.retrieveSession("sesn_1").catch((caught: unknown) => caught), await api.createSession({ agent: "agent_1", environment_id: "env_1" }).catch((caught: unknown) => caught)];
      });
      expect(wire.seen, header).toEqual([]);
      for (const error of errors) {
        expect(error, header).toBeInstanceOf(Error);
        const text = describeError(error);
        expect(text, header).not.toContain(value);
        expect(text, header).not.toContain(KEY);
      }
    }
    // The wrapper itself: no key, or a key other than the launcher's, is refused too.
    const wire = seam(anyAnswer);
    await expect(keyOnlyToAnthropic(KEY, wire.fetch)(`${ANTHROPIC_API_URL}/v1/sessions/sesn_1`, { method: "GET" })).rejects.toThrow(/key/u);
    await expect(keyOnlyToAnthropic(KEY, wire.fetch)(`${ANTHROPIC_API_URL}/v1/sessions/sesn_1`, { method: "GET", headers: { "x-api-key": OTHER_KEY } })).rejects.toThrow(/key/u);
    expect(wire.seen).toEqual([]);
  });

  it("include every header the SDK itself builds: the allow-list drops nothing SDK 0.131 sends for these calls", async () => {
    const dir = await tempDir("credit-runner-headers-");
    const bare = seam(anyAnswer);
    const guarded = seam(anyAnswer);
    await withEnv({ ANTHROPIC_CUSTOM_HEADERS: undefined }, async () => {
      await everyCallBare(new Anthropic({ apiKey: KEY, authToken: null, baseURL: ANTHROPIC_API_URL, fetch: bare.fetch }));
      await everyCall(sdkSandboxApi(KEY, guarded.fetch, {}), dir);
    });
    // Uploads first probe the fetch with a `data:,` URL (the SDK's FormData check), which the guard refuses and the SDK then ignores.
    const names = (requests: readonly Seen[]) =>
      requests.filter((request) => request.url.origin === ANTHROPIC_API_URL).map((request) => `${request.method} ${request.url.pathname}: ${[...request.headers.keys()].sort().join(" ")}`);
    expect(names(guarded.seen)).toHaveLength(14);
    expect(names(guarded.seen)).toEqual(names(bare.seen));
    for (const request of bare.seen) {
      for (const name of request.headers.keys()) expect(SDK_HEADERS.has(name) || name === "x-api-key", `${request.method} ${request.url.pathname}: ${name}`).toBe(true);
    }
  });
});

describe("redirects off api.anthropic.com", () => {
  const STORAGE = "https://files.example.invalid/blob";

  it("are followed only for a file's content, without the key; every JSON endpoint refuses one after a single request", async () => {
    const dir = await tempDir("credit-runner-redirect-");
    const wire = seam((url) =>
      url.origin === ANTHROPIC_API_URL ? redirect(302, STORAGE) : new Response("From abc\n", { status: 200, headers: { "content-type": "application/octet-stream" } }),
    );
    const api = sdkSandboxApi(KEY, wire.fetch);
    expect(await api.downloadFile("file_1", path.join(dir, "patch-0001.patch"), 1000)).toBe("saved");
    expect(await readFile(path.join(dir, "patch-0001.patch"), "utf8")).toBe("From abc\n");
    expect(wire.seen.map((request) => [request.method, request.url.href.split("?")[0], request.headers.get("x-api-key"), request.headers.get("authorization")])).toEqual([
      ["GET", `${ANTHROPIC_API_URL}/v1/files/file_1/content`, KEY, null],
      ["GET", STORAGE, null, null],
    ]);

    const calls: Record<string, () => Promise<unknown>> = {
      retrieveSession: () => api.retrieveSession("sesn_1"),
      retrieveAgent: () => api.retrieveAgent("agent_1", 1),
      retrieveEnvironment: () => api.retrieveEnvironment("env_1"),
      listOutputFiles: () => api.listOutputFiles("sesn_1"),
      listSessions: () => drain(api.listSessions("2026-01-01T00:00:00.000Z")),
      listEvents: () => drain(api.listEvents("sesn_1")),
    };
    for (const [name, call] of Object.entries(calls)) {
      wire.seen.length = 0;
      const error: unknown = await call().then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error, name).toBeInstanceOf(Error);
      // Refused with its own reason, not retried as a connection error.
      expect(error, name).not.toBeInstanceOf(Anthropic.APIConnectionError);
      expect(describeError(error), name).toMatch(/only a file download may leave/u);
      expect(wire.seen.map((request) => request.url.origin), name).toEqual([ANTHROPIC_API_URL]);
    }
  });

  it("decide by the API path: only GET /v1/files/<id>/content may leave", async () => {
    const wire = seam((url) => (url.origin === ANTHROPIC_API_URL ? redirect(302, STORAGE) : new Response("x", { status: 200 })));
    const guard = keyOnlyToAnthropic(KEY, wire.fetch);
    const get = { method: "GET", headers: { "x-api-key": KEY } };
    for (const pathname of ["/v1/files/file_1", "/v1/files/file_1/content/more", "/v1/files/a/b/content", "/v1/sessions/sesn_1/content", "/v2/files/file_1/content"]) {
      wire.seen.length = 0;
      await expect(guard(`${ANTHROPIC_API_URL}${pathname}`, get), pathname).rejects.toThrow(/only a file download may leave/u);
      expect(wire.seen, pathname).toHaveLength(1);
    }
    wire.seen.length = 0;
    expect((await guard(`${ANTHROPIC_API_URL}/v1/files/file_1/content?beta=true`, get)).status).toBe(200);
    expect(wire.seen.map((request) => [request.url.href, request.headers.get("x-api-key")])).toEqual([
      [`${ANTHROPIC_API_URL}/v1/files/file_1/content?beta=true`, KEY],
      [STORAGE, null],
    ]);
  });
});

describe("a refused request", () => {
  it("is not retried by the SDK as a connection error, and says why", async () => {
    // createAgent keeps the SDK's two retries; a 302 of its POST is refused once and never re-sent.
    const wire = seam(() => redirect(302, `${ANTHROPIC_API_URL}/v1/agents/elsewhere`));
    const error: unknown = await sdkSandboxApi(KEY, wire.fetch)
      .createAgent({ name: "a", model: "claude-opus-5-5" })
      .catch((caught: unknown) => caught);
    expect(wire.seen).toHaveLength(1);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(Anthropic.APIConnectionError);
    expect(describeError(error)).toMatch(/refusing to follow a 302 redirect of a POST request/u);
  });

  it("leaves a real connection failure on the SDK's retry path, and the CLI's message shows its cause", async () => {
    let attempts = 0;
    const failing = sdkSandboxApi(KEY, () => {
      attempts += 1;
      return Promise.reject(new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 192.0.2.1:443") }));
    });
    const error: unknown = await failing.retrieveSession("sesn_1").catch((caught: unknown) => caught);
    expect(attempts).toBe(3);
    expect(error).toBeInstanceOf(Anthropic.APIConnectionError);
    expect(describeError(error)).toBe("Connection error. (caused by: fetch failed; caused by: connect ECONNREFUSED 192.0.2.1:443)");
  }, 30_000);
});

describe("describeError", () => {
  it("prints the cause chain on one line, each message once, at most four causes deep, and survives a cycle", () => {
    expect(describeError(new Error("top"))).toBe("top");
    expect(describeError("plain")).toBe("plain");
    expect(describeError(new Error("top", { cause: new Error("first\nsecond line") }))).toBe("top (caused by: first second line)");
    expect(describeError(new Error("same", { cause: new Error("same") }))).toBe("same");
    expect(describeError(new Error("top", { cause: "a string cause" }))).toBe("top (caused by: a string cause)");
    let deep: Error = new Error("c6");
    for (const name of ["c5", "c4", "c3", "c2", "c1"]) deep = new Error(name, { cause: deep });
    expect(describeError(new Error("top", { cause: deep }))).toBe("top (caused by: c1; caused by: c2; caused by: c3; caused by: c4; ...)");
    const looping = new Error("a");
    const other = new Error("b", { cause: looping });
    looping.cause = other;
    expect(describeError(looping)).toBe("a (caused by: b)");
  });
});
