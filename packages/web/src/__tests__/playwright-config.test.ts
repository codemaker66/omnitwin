import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const configUrl = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "../../playwright.config.ts"));
const snapshotSchema = z.object({
  baseURL: z.string(),
  webServer: z.object({
    command: z.string(),
    url: z.string(),
    reuseExistingServer: z.boolean(),
  }).nullable(),
});
const resultsSchema = z.record(z.union([snapshotSchema, z.object({ error: z.string() })]));
const invalidPorts = ["", "0", "65536", "-1", "5199.5", "abc", "5199 && echo injected"];
const environments: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  default: {},
  selected: { E2E_PORT: "5199" },
  minimum: { E2E_PORT: "1" },
  maximum: { E2E_PORT: "65535" },
  preview: { E2E_WEB_SERVER: "preview", E2E_PORT: "unused" },
  external: { E2E_BASE_URL: "https://example.test", E2E_START_SERVER: "false", E2E_PORT: "unused" },
  existing: { E2E_PORT: "5199", E2E_START_SERVER: "false" },
  explicit: { E2E_PORT: "5199", E2E_BASE_URL: "http://localhost:5199" },
  ci: { CI: "true", E2E_PORT: "5199" },
  ...Object.fromEntries(invalidPorts.map((port, index) => [`invalid-${index.toString()}`, { E2E_PORT: port }])),
};
let results: z.infer<typeof resultsSchema>;

beforeAll(() => {
  // One isolated process loads the actual config with a unique module URL per
  // scenario. Environment reads stay isolated without starting browsers/servers
  // or paying Playwright's cold import cost for every assertion.
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    `const results = {};
     for (const [name, overrides] of Object.entries(${JSON.stringify(environments)})) {
       for (const key of ["CI", "E2E_PORT", "E2E_BASE_URL", "E2E_START_SERVER", "E2E_WEB_SERVER", "E2E_BROWSER_CHANNEL"])
         delete process.env[key];
       Object.assign(process.env, overrides);
       const url = new URL(${JSON.stringify(configUrl.href)});
       url.searchParams.set("scenario", name);
       try {
         const { default: config } = await import(url.href);
         results[name] = { baseURL: config.use?.baseURL, webServer: config.webServer ?? null };
       } catch (error) {
         results[name] = { error: error instanceof Error ? error.message : String(error) };
       }
     }
     process.stdout.write(JSON.stringify(results));`,
  ], { env: process.env, encoding: "utf8", timeout: 15_000 });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  results = resultsSchema.parse(JSON.parse(result.stdout));
// The child has its own 15-second deadline. Allow it to return the bounded
// result before the outer hook times out on a cold Windows module cache.
}, 20_000);

function snapshot(name: string): z.infer<typeof snapshotSchema> {
  return snapshotSchema.parse(results[name]);
}

describe("Playwright server configuration", () => {
  it("preserves the default development server", () => {
    expect(snapshot("default")).toEqual({
      baseURL: "http://localhost:5173",
      webServer: {
        command: "pnpm dev",
        url: "http://localhost:5173",
        reuseExistingServer: true,
      },
    });
  });

  it("uses the selected development port for both readiness and browser requests", () => {
    expect(snapshot("selected")).toEqual({
      baseURL: "http://127.0.0.1:5199",
      webServer: {
        command: "pnpm dev --host 127.0.0.1 --port 5199 --strictPort",
        url: "http://127.0.0.1:5199",
        reuseExistingServer: true,
      },
    });
  });

  it.each([["minimum", "1"], ["maximum", "65535"]])("accepts valid port boundary %s", (name, port) => {
    const config = snapshot(name);
    expect(config.baseURL).toBe(`http://127.0.0.1:${port}`);
    expect(config.webServer?.url).toBe(config.baseURL);
  });

  it.each(invalidPorts.map((port, index) => ({ port, name: `invalid-${index.toString()}` })))(
    "rejects invalid development port $port before constructing a server command",
    ({ name }) => {
      expect(results[name]).toEqual({ error: "E2E_PORT must be an integer between 1 and 65535." });
    },
  );

  it("preserves preview mode and ignores the unused development port", () => {
    expect(snapshot("preview")).toEqual({
      baseURL: "http://127.0.0.1:4176",
      webServer: {
        command: "pnpm exec vite preview --host 127.0.0.1 --port 4176",
        url: "http://127.0.0.1:4176",
        reuseExistingServer: true,
      },
    });
  });

  it("preserves an explicit external URL without requiring a local port", () => {
    expect(snapshot("external")).toEqual({ baseURL: "https://example.test", webServer: null });
  });

  it("can target an already running server using the selected port", () => {
    expect(snapshot("existing")).toEqual({ baseURL: "http://127.0.0.1:5199", webServer: null });
  });

  it("honors an explicit base URL when starting a selected development port", () => {
    const config = snapshot("explicit");
    expect(config.baseURL).toBe("http://localhost:5199");
    expect(config.webServer?.url).toBe(config.baseURL);
    expect(config.webServer?.command).toContain("--port 5199 --strictPort");
  });

  it("keeps CI from reusing an existing server", () => {
    expect(snapshot("ci").webServer?.reuseExistingServer).toBe(false);
  });
});
