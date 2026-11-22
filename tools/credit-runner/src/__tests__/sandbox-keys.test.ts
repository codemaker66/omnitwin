import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readKey } from "../keys.js";
import { ANTHROPIC_API_URL, keyOnlyToAnthropic, sdkSandboxApi, type SandboxApi } from "../sandbox/api.js";
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

describe("the key", () => {
  it("is refused when it is an Admin API key or an OAuth token, with a reason that never holds the key", async () => {
    const dir = await tempDir("credit-runner-keyshape-");
    const cases = [
      [fakeKey("admin01", "a"), /Admin API key/u],
      [fakeKey("oat01", "b"), /OAuth token/u],
    ] as const;
    for (const [key, reason] of cases) {
      const file = path.join(dir, "pot-1.key");
      await writeFile(file, `${key}\n`);
      const error: unknown = await readKey(file).catch((caught: unknown) => caught);
      expect(error, key.slice(0, 13)).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : "";
      expect(message).toMatch(reason);
      expect(message).not.toContain(key);
      expect(message).not.toContain(key.slice(-20));
    }
    const file = path.join(dir, "pot-1.key");
    await writeFile(file, `${KEY}\n`);
    expect(await readKey(file)).toBe(KEY);
  });

  it.runIf(process.platform === "win32")("is refused by setup-keys.ps1 the same way when it is an Admin API key or an OAuth token", () => {
    // The script's own rule, lifted out of it by the PowerShell parser and run alone: the rest never runs, and nothing is prompted for.
    const probe = [
      "$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:CR_SCRIPT, [ref]$null, [ref]$null)",
      "$rule = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-KeyProblem' }, $true)",
      "if ($null -eq $rule) { throw 'no Get-KeyProblem in the script' }",
      ". ([scriptblock]::Create($rule.Extent.Text))",
      "foreach ($name in 'CR_ADMIN', 'CR_OAT', 'CR_API', 'CR_UPPER') { $problem = Get-KeyProblem ([Environment]::GetEnvironmentVariable($name)); Write-Output \"${name}=$problem\" }",
    ].join("\n");
    const child = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", probe], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, CR_SCRIPT: path.join(PACKAGE_DIR, "setup-keys.ps1"), CR_ADMIN: fakeKey("admin01", "a"), CR_OAT: fakeKey("oat01", "b"), CR_API: KEY, CR_UPPER: KEY.toUpperCase() },
    });
    expect(child.stderr).toBe("");
    const lines = child.stdout.trim().split(/\r?\n/u);
    expect(lines[0]).toMatch(/^CR_ADMIN=That is an Admin API key/u);
    expect(lines[1]).toMatch(/^CR_OAT=That is an OAuth token/u);
    expect(lines[2]).toBe("CR_API=");
    // readKey's rule is case-sensitive, so the script's is too: it never stores a key the runner will refuse.
    expect(lines[3]).toMatch(/^CR_UPPER=That does not look like an Anthropic API key/u);
    expect(child.stdout).not.toContain(fakeKey("admin01", "a"));
    expect(child.stdout).not.toContain(KEY);
  }, 30_000);
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
});

describe.runIf(process.platform === "win32")("setup-keys.ps1's key folder", () => {
  /** Runs a copy of the script placed at tools/credit-runner/ of a temporary tree of its own (its "repository"), from that tree. */
  async function runScript(keyDir: string) {
    const root = await tempDir("credit-runner-script-");
    const folder = path.join(root, "tools", "credit-runner");
    await mkdir(folder, { recursive: true });
    await cp(path.join(PACKAGE_DIR, "setup-keys.ps1"), path.join(folder, "setup-keys.ps1"));
    const child = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", path.join(folder, "setup-keys.ps1"), "-KeyDir", keyDir], { cwd: root, encoding: "utf8", windowsHide: true });
    return { status: child.status, output: `${child.stdout}${child.stderr}` };
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
    const atDriveRoot = `credit-runner-test-${path.basename(root)}`;
    try {
      const cases: readonly (readonly [string, RegExp, string])[] = [
        [`\\\\?\\${repo}\\keys`, /starts with \\ or \//u, path.join(repo, "keys")],
        ["\\\\server.invalid\\share\\keys", /starts with \\ or \//u, path.join(root, "share")],
        ["//server.invalid/share/keys", /starts with \\ or \//u, path.join(root, "share")],
        [path.join(viaJunction, "keys"), /inside a git work tree/u, path.join(repo, "sub", "keys")],
        [path.join(outOfRepo, "keys"), /inside a git work tree/u, path.join(outside, "keys")],
        [path.join(repo, "deep", "keys"), /inside a git work tree/u, path.join(repo, "deep")],
        [path.join(worktree, "keys"), /inside a git work tree/u, path.join(worktree, "keys")],
        // Last, so a regression that already fails above never gets as far as making a folder at the drive's root.
        [`/${atDriveRoot}`, /starts with \\ or \//u, path.join(path.parse(root).root, atDriveRoot)],
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
  }, 120_000);

  it("lets a folder outside every work tree through to the prompt", async () => {
    const root = await tempDir("credit-runner-setup-keys-");
    const keyDir = path.join(root, "outside", "keys");
    const { status, output } = await runScript(keyDir);
    // -NonInteractive stops it at the hidden prompt, after it made and locked the folder.
    expect(status).not.toBe(0);
    expect(output).toMatch(/NonInteractive/u);
    expect(existsSync(keyDir)).toBe(true);
  }, 60_000);
});
