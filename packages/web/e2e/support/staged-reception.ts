import { createServer } from "node:http";
import { test as base, type Route } from "@playwright/test";
import { GENERATED_ROOM_SPLAT_BUNDLES } from "../../src/data/generated/trades-hall-splat-bundles.js";
import { captureCacheDirectory, capturePathPrefix, readStagedTile, stagedFixtureTiles } from "./capture-fixture-cache.js";
import { describeWorkerLoop, watchWorkerEventLoop, type WorkerLoopWatch } from "./stage-timeline.js";

const bundle = GENERATED_ROOM_SPLAT_BUNDLES.find((room) => room.roomSlug === "reception-room");
if (bundle === undefined) throw new Error("Reception Room capture descriptor is missing");
const tiles = stagedFixtureTiles(bundle);
const assetPrefix = capturePathPrefix(bundle.roomSlug);

interface StagedReception {
  readonly files: readonly string[];
  readonly requestedFiles: ReadonlySet<string>;
}

export const test = base.extend<{ stagedReception: StagedReception; workerEventLoop: WorkerLoopWatch }>({
  // The CARD A2 cases (this file's only users) time the Playwright worker's own event loop from
  // before the browser context opens until the case ends, pass or fail: the page's requests all go
  // through this worker, so the page's clock alone cannot say which side stalled
  // (support/stage-timeline.ts). The line is printed at teardown, so a case that failed or timed
  // out before its evidence still leaves it in the job log.
  workerEventLoop: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's needs from this destructuring; it needs none
    async ({}, use, testInfo) => {
      const watch = watchWorkerEventLoop();
      try {
        await use(watch);
      } finally {
        const delay = watch.stop();
        // eslint-disable-next-line no-console -- deliberate: CARD-A2 timing evidence in the runner output
        console.log(`[CARD-A2 worker] ${testInfo.title.slice(0, 60)} (attempt ${String(testInfo.retry + 1)}, ${testInfo.status ?? "unknown"}): ${describeWorkerLoop(delay)}`);
        await testInfo.attach("worker-event-loop.json", { body: JSON.stringify(delay, null, 2), contentType: "application/json" });
      }
    },
    { auto: true },
  ],
  stagedReception: async ({ page, baseURL }, use) => {
    if (baseURL === undefined) throw new Error("The capture fixture requires an explicit loopback HTTP baseURL");
    const appUrl = new URL(baseURL);
    if (appUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(appUrl.hostname)) {
      throw new Error("The capture fixture requires a loopback HTTP app target");
    }
    // Real published capture bytes, pinned to the checked-in descriptor and
    // staged before the run (capture-fixture-cache.ts). Nothing is fetched here.
    const directory = captureCacheDirectory();
    const bytes = new Map(await Promise.all(tiles.map(async (tile) => [tile.file, await readStagedTile(directory, tile)] as const)));
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
  },
});
