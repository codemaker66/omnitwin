import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { isWorkspaceKey, keyFileExposure, readKey } from "../keys.js";
import { ANTHROPIC_API_URL, keyGuard, sdkSandboxApi, type SandboxApi } from "../sandbox/api.js";
import { main } from "../sandbox/cli.js";
import { describeError } from "../task.js";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

/** Removes a junction or symlink itself, never what it points at. */
async function removeLink(link: string): Promise<void> {
  if (process.platform === "win32") await rmdir(link);
  else await unlink(link);
}
const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

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
    await expect(keyGuard(KEY, wire.fetch).fetch(`${ANTHROPIC_API_URL}/v1/sessions/sesn_1`, { method: "GET" })).rejects.toThrow(/key/u);
    await expect(keyGuard(KEY, wire.fetch).fetch(`${ANTHROPIC_API_URL}/v1/sessions/sesn_1`, { method: "GET", headers: { "x-api-key": OTHER_KEY } })).rejects.toThrow(/key/u);
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
    const guard = keyGuard(KEY, wire.fetch).fetch;
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

  it("are decided by the request's first URL alone, whatever path a hop on api.anthropic.com passes through", async () => {
    const seen: string[] = [];
    const guard = keyGuard(KEY, (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      seen.push(url.href);
      if (url.pathname === "/v1/sessions/sesn_1") return Promise.resolve(redirect(302, "/v1/files/file_1/content"));
      if (url.pathname === "/v1/files/file_2/content") return Promise.resolve(redirect(302, "/v1/elsewhere"));
      if (url.origin === ANTHROPIC_API_URL) return Promise.resolve(redirect(302, STORAGE));
      return Promise.resolve(new Response("from storage", { status: 200 }));
    }).fetch;
    const get = { method: "GET", headers: { "x-api-key": KEY } };
    // A JSON endpoint led through a file's content path on the same host is still a JSON endpoint: refused before it leaves.
    await expect(guard(`${ANTHROPIC_API_URL}/v1/sessions/sesn_1`, get)).rejects.toThrow(/only a file download may leave/u);
    expect(seen).toEqual([`${ANTHROPIC_API_URL}/v1/sessions/sesn_1`, `${ANTHROPIC_API_URL}/v1/files/file_1/content`]);
    // A download led through another path on the same host is still a download: followed to storage.
    seen.length = 0;
    expect(await (await guard(`${ANTHROPIC_API_URL}/v1/files/file_2/content`, get)).text()).toBe("from storage");
    expect(seen).toEqual([`${ANTHROPIC_API_URL}/v1/files/file_2/content`, `${ANTHROPIC_API_URL}/v1/elsewhere`, STORAGE]);
  });

  it("pass on a last answer that is not 2xx as its status alone, its body cancelled, so no large or escape-laden body reaches an error", async () => {
    const dir = await tempDir("credit-runner-redirect-");
    // Two million characters from the storage host, ANSI escapes included, in one finite body.
    const big = `\u001b[31mSTORAGE-SAYS\u001b[0m ${"z".repeat(2_000_000)}`;
    let cancels = 0;
    const wire = seam((url) => {
      if (url.origin === ANTHROPIC_API_URL) return redirect(302, STORAGE);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(big));
          controller.close();
        },
        cancel() {
          cancels += 1;
        },
      });
      return new Response(body, { status: 403, headers: { "content-type": "text/plain" } });
    });
    const error: unknown = await sdkSandboxApi(KEY, wire.fetch, {})
      .downloadFile("file_1", path.join(dir, "patch-0001.patch"), 1000)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Anthropic.PermissionDeniedError);
    for (const text of [error instanceof Error ? error.message : "", describeError(error)]) {
      expect(text).toBe("403 status code (no body)");
    }
    expect(cancels).toBe(1);
    expect(wire.seen.map((request) => request.url.origin)).toEqual([ANTHROPIC_API_URL, new URL(STORAGE).origin]);
    expect(await readdir(dir)).toEqual([]);
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

  it("is final too for a Location that cannot be read, or whose host or scheme says timeout, and its reason holds nothing the server sent", async () => {
    // The SDK retries any error whose text says "timed out", "time out" or "timeout", and a fetch TypeError as a connection failure.
    const cases: readonly (readonly [string, number, string, RegExp])[] = [
      ["an unreadable Location", 302, "https://[", /Location cannot be read/u],
      ["a host that says timeout", 307, "https://timeout.example.invalid/v1/agents", /POST redirect to another host/u],
      ["a scheme that says timeout", 307, "timeout:x", /only https is followed/u],
    ];
    for (const [what, status, location, reason] of cases) {
      const wire = seam(() => redirect(status, location));
      const error: unknown = await sdkSandboxApi(KEY, wire.fetch, {})
        .createAgent({ name: "a", model: "claude-opus-5-5" })
        .catch((caught: unknown) => caught);
      expect(wire.seen.map((request) => request.method), what).toEqual(["POST"]);
      expect(error, what).toBeInstanceOf(Error);
      expect(error, what).not.toBeInstanceOf(Anthropic.APIConnectionError);
      const text = describeError(error);
      expect(text, what).toMatch(reason);
      expect(text, what).not.toMatch(/timed? ?out|example\.invalid|\[/iu);
    }
    // A JSON GET redirected to such a host is refused after its one request too.
    const wire = seam(() => redirect(302, "https://timeout.example.invalid/v1/sessions/sesn_1"));
    const error: unknown = await sdkSandboxApi(KEY, wire.fetch, {})
      .retrieveSession("sesn_1")
      .catch((caught: unknown) => caught);
    expect(wire.seen).toHaveLength(1);
    expect(error).not.toBeInstanceOf(Anthropic.APIConnectionError);
    expect(describeError(error)).toMatch(/only a file download may leave/u);
    expect(describeError(error)).not.toMatch(/timed? ?out/iu);
  });

  it("comes from a guard exported only together with the middleware that makes its refusals final", async () => {
    expect(Object.keys(await import("../sandbox/api.js"))).not.toContain("keyOnlyToAnthropic");
    // A client built from the pair, as sdkSandboxApi builds its own: the refused POST is sent once and keeps its reason.
    const wire = seam(() => redirect(302, `${ANTHROPIC_API_URL}/v1/agents/elsewhere`));
    const guard = keyGuard(KEY, wire.fetch);
    const client = new Anthropic({ apiKey: KEY, authToken: null, baseURL: ANTHROPIC_API_URL, fetch: guard.fetch, middleware: [guard.middleware] });
    const error: unknown = await client.beta.agents.create({ name: "a", model: "claude-opus-5-5" }).catch((caught: unknown) => caught);
    expect(wire.seen).toHaveLength(1);
    expect(error).not.toBeInstanceOf(Anthropic.APIConnectionError);
    expect(describeError(error)).toMatch(/refusing to follow a 302 redirect of a POST request/u);
    // The guard holds a key to the client's rule too.
    expect(() => keyGuard(`${KEY}\nsecond-line`, wire.fetch)).toThrow(/workspace API key/u);
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

  it("leaves out control characters and cuts each message at 2,000 characters, so no server's text can fill or drive the terminal", () => {
    const body = `\u001b[31mSTORAGE-SAYS\u001b[0m ${"z".repeat(2_000_000)}`;
    const cause = `\u009b2J\u0007bell\ttab\u007fdel ${"y".repeat(10_000)}`;
    const text = describeError(new Error(`403 ${body}`, { cause: new Error(cause) }));
    expect(text).not.toMatch(/\p{Cc}/u);
    const [first = "", second = ""] = text.split(" (caused by: ");
    expect(first).toBe(`403 [31mSTORAGE-SAYS[0m ${"z".repeat(2000 - "403 [31mSTORAGE-SAYS[0m ".length)}...`);
    expect(second).toBe(`2Jbell tabdel ${"y".repeat(2000 - "2Jbell tabdel ".length)}...)`);
    // A message at the limit is left whole; a character pair is never cut in two.
    expect(describeError(new Error("x".repeat(2000)))).toBe("x".repeat(2000));
    expect(describeError(new Error(`${"x".repeat(1999)}\u{1F600}y`))).toBe(`${"x".repeat(1999)}...`);
    // A validation error's issues get the same treatment: a spec's own key names reach them.
    const parsed = z.object({}).strict().safeParse({ "\u001b[2Jodd": 1 });
    expect(describeError(parsed.error)).toMatch(/^\(root\): .*\[2Jodd/u);
    expect(describeError(parsed.error)).not.toMatch(/\p{Cc}/u);
  });
});

/** Runs pwsh, or Windows PowerShell where pwsh is missing, as the CLI tests do; says which ran. */
function powershell(args: readonly string[], options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {}) {
  const run = (shell: string) => spawnSync(shell, args, { ...options, encoding: "utf8", windowsHide: true });
  let shell = "pwsh";
  let child = run(shell);
  if (child.error !== undefined) {
    shell = "powershell";
    child = run(shell);
  }
  return { shell, status: child.status, output: `${child.stdout}${child.stderr}` };
}

/** A copy of setup-keys.ps1 at tools/credit-runner/ of a temporary tree of its own (its "repository"), so nothing it makes lands in this checkout. */
async function scriptCopy(): Promise<{ readonly root: string; readonly script: string }> {
  const root = await tempDir("credit-runner-script-");
  const folder = path.join(root, "tools", "credit-runner");
  await mkdir(folder, { recursive: true });
  await cp(path.join(PACKAGE_DIR, "setup-keys.ps1"), path.join(folder, "setup-keys.ps1"));
  return { root, script: path.join(folder, "setup-keys.ps1") };
}

/** Every kind of Anthropic credential the runner refuses, and why; built at run time, so no key-shaped literal sits in the source. */
const REFUSED_KEYS: readonly (readonly [string, string, RegExp])[] = [
  ["admin", fakeKey("admin01", "a"), /Admin API key/u],
  ["OAuth access", fakeKey("oat01", "b"), /OAuth access token/u],
  ["OAuth refresh", fakeKey("ort01", "c"), /OAuth refresh token/u],
  ["session", fakeKey("sid01", "d"), /session key/u],
  ["unknown kind", fakeKey("xyz01", "e"), /does not/u],
  ["no digits", fakeKey("api", "f"), /does not/u],
  ["capitals", KEY.toUpperCase(), /does not/u],
];

describe("the key", () => {
  it("is taken only when it is a workspace API key; every other kind is refused with a reason that never holds the key", async () => {
    const dir = await tempDir("credit-runner-keyshape-");
    const file = path.join(dir, "pot-1.key");
    for (const [what, key, reason] of REFUSED_KEYS) {
      await writeFile(file, `${key}\n`);
      const error: unknown = await readKey(file).catch((caught: unknown) => caught);
      expect(error, what).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : "";
      expect(message, what).toMatch(reason);
      expect(message, what).not.toContain(key);
      expect(message, what).not.toContain(key.slice(-20));
    }
    await writeFile(file, `${KEY}\n`);
    expect(await readKey(file)).toBe(KEY);
  });

  it("is refused by the client before it is built when it is not one line of that shape, with a reason that names no part of it", async () => {
    const cases: readonly (readonly [string, string])[] = [
      ["a second line", `${KEY}\nsecond-line`],
      ["a control character", `${KEY}\u0007`],
      ["a NUL inside", `${KEY.slice(0, 24)}\u0000${KEY.slice(24)}`],
      ["a trailing space", `${KEY} `],
      ["no key", ""],
      ...REFUSED_KEYS.map(([what, key]) => [what, key] as const),
    ];
    for (const [what, key] of cases) {
      const wire = seam(anyAnswer);
      // Thrown when the client is made, or when it is first used: either way nothing may be sent and nothing of the key shown.
      const error: unknown = await (async () => sdkSandboxApi(key, wire.fetch, {}).retrieveSession("sesn_1"))().then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(wire.seen, what).toEqual([]);
      expect(error, what).toBeInstanceOf(Error);
      for (const text of [error instanceof Error ? error.message : "", describeError(error)]) {
        expect(text, what).toMatch(/workspace API key/u);
        // No prefix, no length, no characters of it: no "sk-", no digit, nothing of its fill or its second line.
        expect(text, what).not.toMatch(/sk-|\d|tttt|second-line/iu);
      }
      expect(() => sdkSandboxApi(key, wire.fetch, {}), what).toThrow(/workspace API key/u);
    }
    // The key the client takes, and the one rule readKey holds a file to.
    expect(isWorkspaceKey(KEY)).toBe(true);
    for (const [what, key] of cases) expect(isWorkspaceKey(key), what).toBe(false);
  });

  it.runIf(process.platform === "win32")("is stored by setup-keys.ps1's prompt loop only when it is a workspace API key, in a file only its owner can read", async () => {
    const { root, script } = await scriptCopy();
    const keyDir = path.join(await tempDir("credit-runner-prompt-"), "keys");
    const keys = [...REFUSED_KEYS.map(([, key]) => key), KEY];
    const pots = keys.map((_, index) => `pot-${String(index + 1)}`);
    const stored = pots[pots.length - 1] ?? "";
    // A Read-Host defined where the script is called from stands in for the cmdlet inside it (a function wins over a
    // cmdlet): it answers each hidden prompt with the next key, read from the environment, never the command line.
    const command = [
      "$global:answers = $env:CR_KEYS -split ','",
      "$global:asked = 0",
      "function Read-Host { $answer = $global:answers[$global:asked]; $global:asked += 1; ConvertTo-SecureString $answer -AsPlainText -Force }",
      "& $env:CR_SCRIPT -KeyDir $env:CR_KEY_DIR -Pot ($env:CR_POTS -split ',')",
    ].join("\n");
    const { status, output } = powershell(["-NoProfile", "-NonInteractive", "-Command", command], {
      cwd: root,
      env: { ...process.env, CR_KEYS: keys.join(","), CR_POTS: pots.join(","), CR_SCRIPT: script, CR_KEY_DIR: keyDir },
    });
    expect(status, output).toBe(0);
    for (const [index, [what, , reason]] of REFUSED_KEYS.entries()) {
      expect(output, what).toMatch(new RegExp(`${reason.source}[^\\n]*Skipped pot-${String(index + 1)}\\.`, "u"));
    }
    expect(output).toContain(`Saved ${stored}`);
    for (const key of keys) expect(output).not.toContain(key);
    // Only the workspace key was written, as the runner reads it, and only its owner can open it.
    expect(await readdir(keyDir)).toEqual([`${stored}.key`]);
    expect(await readKey(path.join(keyDir, `${stored}.key`))).toBe(KEY);
    expect(await keyFileExposure(path.join(keyDir, `${stored}.key`))).toEqual([]);
  }, 120_000);
});

describe("the key folder, inside any git work tree", () => {
  it("is refused by the CLI when a .git file or folder sits in it or above it, through junctions or links either way", async () => {
    const root = await tempDir("credit-runner-worktree-");
    // A linked worktree's .git is a file; a main checkout's is a folder.
    const worktree = path.join(root, "worktree");
    await mkdir(worktree);
    await writeFile(path.join(worktree, ".git"), "gitdir: ../repo/.git/worktrees/w\n");
    const repo = path.join(root, "repo");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await mkdir(path.join(repo, "sub"));
    const outside = path.join(root, "outside");
    await mkdir(outside);
    // A link outside that leads to a folder inside the repository (only the real path shows the .git above it),
    // and one inside the repository that leads out (only the path as written shows it).
    const intoRepo = path.join(root, "into-repo");
    await symlink(path.join(repo, "sub"), intoRepo, LINK_TYPE);
    const outOfRepo = path.join(repo, "out");
    await symlink(outside, outOfRepo, LINK_TYPE);
    const configWith = async (keyDir: string): Promise<string> => {
      const file = path.join(root, "sandbox.config.json");
      await writeFile(file, JSON.stringify({ workRoot: path.join(root, "work"), ledgerFile: path.join(root, "ledger.jsonl"), keyDir, keyFile: "pot-1.key", lane: "sandbox", laneCapUsd: 1, orgCapUsd: 2 }));
      return file;
    };
    const quiet = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      for (const keyDir of [path.join(worktree, "keys"), worktree, path.join(repo, "a", "b", "keys"), path.join(intoRepo, "keys"), path.join(outOfRepo, "keys")]) {
        for (const command of ["setup", "run", "collect"]) {
          await expect(main([command, "--config", await configWith(keyDir)]), `${command} ${path.relative(root, keyDir)}`).rejects.toThrow(/inside a git work tree/u);
        }
      }
      // A folder no work tree holds goes on to look for the key file.
      await expect(main(["setup", "--config", await configWith(path.join(outside, "keys"))])).rejects.toThrow(/no key file at/u);
    } finally {
      quiet.mockRestore();
      await removeLink(intoRepo);
      await removeLink(outOfRepo);
    }
  });

  it("is named in a warning by status, which reads nothing else differently and refuses nothing", async () => {
    const root = await tempDir("credit-runner-status-");
    const worktree = path.join(root, "worktree");
    await mkdir(worktree);
    await writeFile(path.join(worktree, ".git"), "gitdir: ../repo/.git/worktrees/w\n");
    const statusOf = async (keyDir: string): Promise<string> => {
      const file = path.join(root, "sandbox.config.json");
      await writeFile(file, JSON.stringify({ workRoot: path.join(root, "work"), ledgerFile: path.join(root, "ledger.jsonl"), keyDir, keyFile: "pot-1.key", lane: "sandbox", laneCapUsd: 1, orgCapUsd: 2 }));
      const printed: string[] = [];
      const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
        printed.push(String(chunk));
        return true;
      });
      try {
        expect(await main(["status", "--config", file]), keyDir).toBe(0);
      } finally {
        spy.mockRestore();
      }
      return printed.join("");
    };
    const lines = (text: string) => text.split("\n").filter((line) => line !== "");
    // A folder under a work tree, and one inside this repository (named, never created).
    const inWorktree = lines(await statusOf(path.join(worktree, "keys")));
    expect(inWorktree[0]).toMatch(/^Warning: the key folder .+ is inside a git work tree/u);
    expect(inWorktree.slice(1).map((line) => line.split(" ")[0])).toEqual(["Key", "Sandbox:", "Spend:", "Unbooked", "Git:"]);
    // The unbooked-session check needs the key, and status does not read a key from a folder under a work tree.
    expect(inWorktree.find((line) => line.startsWith("Unbooked"))).toMatch(/^Unbooked sessions: not checked \(the key folder .+ is inside a git work tree/u);
    const inRepo = lines(await statusOf(path.join(PACKAGE_DIR, "..", "..", "keys-status-test")));
    expect(inRepo[0]).toMatch(/^Warning: the key folder .+ is inside the repository/u);
    expect(existsSync(path.join(PACKAGE_DIR, "..", "..", "keys-status-test"))).toBe(false);
    // A folder no work tree holds: no warning.
    const outside = lines(await statusOf(path.join(root, "outside", "keys")));
    expect(outside[0]).toMatch(/^Key file /u);
  });
});

describe.runIf(process.platform === "win32")("setup-keys.ps1's key folder", () => {
  /** Runs a copy of the script placed at tools/credit-runner/ of a temporary tree of its own (its "repository"), from that tree. */
  async function runScript(keyDir: string) {
    const { root, script } = await scriptCopy();
    return powershell(["-NoProfile", "-NonInteractive", "-File", script, "-KeyDir", keyDir], { cwd: root });
  }

  it("refuses a path starting with \\ or /, and one that reaches a .git through a junction, a long-path prefix or a folder above it, before creating anything", async () => {
    const root = await tempDir("credit-runner-setup-keys-");
    const repo = path.join(root, "fake-repo");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    const worktree = path.join(root, "worktree");
    await mkdir(worktree);
    await writeFile(path.join(worktree, ".git"), "gitdir: ../fake-repo/.git/worktrees/w\n");
    await mkdir(path.join(repo, "sub"));
    const outside = path.join(root, "outside");
    await mkdir(outside);
    // Into a folder of the repository from outside (the real path shows the .git), and out of it from inside (the path as written does).
    const viaJunction = path.join(root, "via-junction");
    await symlink(path.join(repo, "sub"), viaJunction, "junction");
    const outOfRepo = path.join(repo, "out");
    await symlink(outside, outOfRepo, "junction");
    // A spelling rooted at the drive (`/` and the rest of the path), led into this test's own temp folder: if the check
    // regressed, its folder would be made there, never at the drive's root.
    const rooted = `/${path.relative(path.parse(root).root, path.join(root, "rooted", "keys")).split(path.sep).join("/")}`;
    try {
      const cases: readonly (readonly [string, RegExp, string])[] = [
        [`\\\\?\\${repo}\\keys`, /starts with \\ or \//u, path.join(repo, "keys")],
        ["\\\\server.invalid\\share\\keys", /starts with \\ or \//u, path.join(root, "share")],
        ["//server.invalid/share/keys", /starts with \\ or \//u, path.join(root, "share")],
        [path.join(viaJunction, "keys"), /inside a git work tree/u, path.join(repo, "sub", "keys")],
        [path.join(outOfRepo, "keys"), /inside a git work tree/u, path.join(outside, "keys")],
        [path.join(repo, "deep", "keys"), /inside a git work tree/u, path.join(repo, "deep")],
        [path.join(worktree, "keys"), /inside a git work tree/u, path.join(worktree, "keys")],
        [rooted, /starts with \\ or \//u, path.join(root, "rooted")],
      ];
      for (const [keyDir, reason, notCreated] of cases) {
        const { status, output } = await runScript(keyDir);
        expect(status, keyDir).not.toBe(0);
        expect(output, keyDir).toMatch(reason);
        expect(existsSync(notCreated), keyDir).toBe(false);
        // No path but the one given: the junction's target is never named.
        if (keyDir.startsWith(viaJunction)) expect(output).not.toContain("fake-repo");
      }
    } finally {
      await removeLink(viaJunction);
      await removeLink(outOfRepo);
    }
    // Eight PowerShell runs, one after another: on a loaded machine they have taken longer than two minutes.
  }, 300_000);

  it("lets a folder outside every work tree through to the prompt", async () => {
    const root = await tempDir("credit-runner-setup-keys-");
    const keyDir = path.join(root, "outside", "keys");
    const { status, output } = await runScript(keyDir);
    // -NonInteractive stops it at the hidden prompt, after it made and locked the folder.
    expect(status).not.toBe(0);
    expect(output).toMatch(/NonInteractive/u);
    expect(existsSync(keyDir)).toBe(true);
  }, 60_000);

  it("refuses a relative path given from a long-path location, which would lead to a \\\\?\\ path, before creating anything", async () => {
    const { script } = await scriptCopy();
    const here = path.join(await tempDir("credit-runner-location-"), "here");
    await mkdir(here);
    // The window stands in the same folder spelled with the long-path prefix; a relative -KeyDir is taken from there.
    const command = "Set-Location -LiteralPath $env:CR_LOCATION; & $env:CR_SCRIPT -KeyDir keys";
    const { shell, status, output } = powershell(["-NoProfile", "-NonInteractive", "-Command", command], {
      env: { ...process.env, CR_LOCATION: `Microsoft.PowerShell.Core\\FileSystem::\\\\?\\${here}`, CR_SCRIPT: script },
    });
    expect(status, output).not.toBe(0);
    expect(existsSync(path.join(here, "keys")), output).toBe(false);
    // Windows PowerShell 5.1 cannot join a path onto a \\?\ location and stops before this check; PowerShell 7 reaches it.
    if (shell === "pwsh") expect(output).toMatch(/leads to a network or device path/u);
  }, 60_000);
});
