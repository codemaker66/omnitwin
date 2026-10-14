// Stages the descriptor-pinned capture bytes that the planner e2e specs serve
// (e2e/support/staged-reception.ts) before any test runs (T-654). The specs
// read and verify these files and never fetch them: the public bucket is
// rate-limited, and downloading inside the fixture failed four specs at once
// in CI. Run this once on a new machine. CI restores the directory from its
// Actions cache and runs this only when that cache misses.
//
//   pnpm --filter @omnitwin/web e2e:stage-captures
//
// E2E_CAPTURE_CACHE_DIR chooses the directory (default: the OS temp dir).
// Tiles already staged with the right digest are kept; nothing else changes.
import { mkdir, rename, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { GENERATED_ROOM_SPLAT_BUNDLES } from "../src/data/generated/trades-hall-splat-bundles.ts";
import {
  PUBLISHED_CAPTURE_ORIGIN,
  cachedTilePath,
  captureCacheDirectory,
  capturePathPrefix,
  matchesDescriptor,
  readTileIfStaged,
  stagedFixtureTiles,
} from "../e2e/support/capture-fixture-cache.ts";

/** Rooms whose staged capture an e2e fixture serves. */
const ROOMS = ["reception-room"];
// One request at a time with a generous deadline: this runs outside every test
// budget, and parallel bursts are what a rate-limited origin turns away.
const DOWNLOAD_DEADLINE_MS = 3 * 60_000;
// A dropped connection, a missed deadline, HTTP 429 or a 5xx is tried again
// after these pauses: on 13 October 2026 the bucket closed sockets mid-body.
// Any other HTTP status fails at once, since asking again gets the same answer.
const RETRY_PAUSES_MS = [15_000, 60_000];

class DefiniteFailure extends Error {}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_DEADLINE_MS) });
  if (!response.ok) {
    await response.body?.cancel();
    const message = `HTTP ${String(response.status)}`;
    throw response.status === 429 || response.status >= 500 ? new Error(message) : new DefiniteFailure(message);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function describe(error) {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}

async function downloadWithRetries(url) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await download(url);
    } catch (error) {
      const pause = RETRY_PAUSES_MS[attempt - 1];
      if (error instanceof DefiniteFailure || pause === undefined) {
        throw new Error(`${url}: ${describe(error)} (attempt ${String(attempt)})`, { cause: error });
      }
      console.log(`${url}: ${describe(error)}; trying again in ${String(pause / 1000)} s`);
      await sleep(pause);
    }
  }
}

const directory = captureCacheDirectory();
await mkdir(directory, { recursive: true });
for (const roomSlug of ROOMS) {
  const bundle = GENERATED_ROOM_SPLAT_BUNDLES.find((room) => room.roomSlug === roomSlug);
  if (bundle === undefined) throw new Error(`No staged capture descriptor for ${roomSlug}`);
  for (const tile of stagedFixtureTiles(bundle)) {
    if (await readTileIfStaged(directory, tile) !== null) {
      console.log(`${roomSlug}/${tile.file}: already staged`);
      continue;
    }
    const url = `${PUBLISHED_CAPTURE_ORIGIN}${capturePathPrefix(roomSlug)}${tile.file}`;
    const bytes = await downloadWithRetries(url);
    if (!matchesDescriptor(tile, bytes)) {
      throw new Error(`${url} differs from its descriptor (${String(bytes.length)} bytes received)`);
    }
    // Written beside its final name and renamed, so an interrupted run never
    // leaves a partial file under a digest name.
    const path = cachedTilePath(directory, tile);
    await writeFile(`${path}.partial`, bytes);
    await rename(`${path}.partial`, path);
    console.log(`${roomSlug}/${tile.file}: staged ${String(bytes.length)} bytes`);
  }
}
console.log(`Capture fixtures staged in ${directory}`);
