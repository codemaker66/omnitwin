import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, type Route } from "@playwright/test";
import { GENERATED_ROOM_SPLAT_BUNDLES } from "../../src/data/generated/trades-hall-splat-bundles.js";

const bundle = GENERATED_ROOM_SPLAT_BUNDLES.find((room) => room.roomSlug === "reception-room");
if (bundle === undefined) throw new Error("Reception Room capture descriptor is missing");
const tiles = bundle.tiles.filter((tile) => tile.isEnvironment || tile.lodLevel === bundle.finestLevel);
const assetPrefix = "/splats/trades-hall/reception-room/";
const publishedOrigin = "https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev";
const cacheDirectory = join(tmpdir(), "venviewer-e2e-captures-v1");

/** Real published capture bytes, pinned to the checked-in descriptor. */
async function captureBytes(tile: (typeof tiles)[number]): Promise<Buffer> {
  await mkdir(cacheDirectory, { recursive: true });
  const path = join(cacheDirectory, tile.sha256);
  const matches = (bytes: Buffer): boolean => bytes.length === tile.bytes
    && createHash("sha256").update(bytes).digest("hex") === tile.sha256;
  try {
    const cached = await readFile(path);
    if (matches(cached)) return cached;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const response = await fetch(`${publishedOrigin}${assetPrefix}${tile.file}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Capture fixture ${tile.file}: HTTP ${String(response.status)}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!matches(bytes)) throw new Error(`Capture fixture ${tile.file} differs from its source descriptor`);
  await writeFile(path, bytes);
  return bytes;
}

interface StagedReception {
  readonly files: readonly string[];
  readonly requestedFiles: ReadonlySet<string>;
}

export const test = base.extend<{ stagedReception: StagedReception }>({
  stagedReception: [async ({ page, baseURL }, use) => {
    if (baseURL === undefined) throw new Error("The capture fixture requires an explicit loopback HTTP baseURL");
    const appUrl = new URL(baseURL);
    if (appUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(appUrl.hostname)) {
      throw new Error("The capture fixture requires a loopback HTTP app target");
    }
    const bytes = new Map(await Promise.all(tiles.map(async (tile) => [tile.file, await captureBytes(tile)] as const)));
    const requestedFiles = new Set<string>();
    // Serve over actual HTTP so CDP network throttling still applies. A route
    // fulfilled with an in-memory body would bypass the streaming workload.
    const server = createServer((request, response) => {
      const file = request.url?.slice(1) ?? "";
      const body = bytes.get(file);
      if (request.method !== "GET" || body === undefined) {
        response.writeHead(404).end();
        return;
      }
      requestedFiles.add(file);
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": body.length,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      response.end(body);
    });
    const routePattern = `**${assetPrefix}*`;
    const handler = async (route: Route): Promise<void> => {
      const source = new URL(route.request().url());
      if (source.origin !== appUrl.origin) throw new Error("Capture fixture request escaped the owned app origin");
      const file = source.pathname.slice(assetPrefix.length);
      if (!bytes.has(file)) throw new Error(`Unexpected capture tile: ${file}`);
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Capture fixture server did not bind");
      await route.continue({ url: `http://127.0.0.1:${String(address.port)}/${file}` });
    };
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
      });
      await page.route(routePattern, handler);
      await use({ files: tiles.map((tile) => tile.file), requestedFiles });
    } finally {
      try {
        if (!page.isClosed()) await page.unroute(routePattern, handler);
      } finally {
        if (server.listening) {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) => server.close((error) => {
            if (error !== undefined) reject(error); else resolve();
          }));
        }
      }
    }
  // Cold downloads happen before the test body can set its own timeout.
  // This setup/teardown budget leaves all browser assertion budgets intact.
  }, { timeout: 90_000 }],
});
