import { createHash } from "node:crypto";
import {
  appendFile,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
} from "@omnitwin/types";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT,
  GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX,
  GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT,
  GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX,
} from "../grand-hall-t554-native-review-coverage.js";
import {
  GRAND_HALL_T554_NATIVE_RGB8_TILE_BYTE_LENGTH,
  GrandHallT554NativeSourceEpochError,
  __testOnlyGrandHallT554NativeSourceEpochV1,
  openGrandHallT554NativeSourceEpochV1,
  type GrandHallT554NativeSourceEpochBindingsV1,
  type GrandHallT554NativeSourceEpochV1,
} from "../grand-hall-t554-native-source-epoch.js";

const temporaryPaths: string[] = [];
const epochs: GrandHallT554NativeSourceEpochV1[] = [];
const SOURCE_EPOCH_NONCE = Buffer.alloc(32, 0x5a).toString("base64url");
const STALE_SOURCE_EPOCH_NONCE = Buffer.alloc(32, 0xa5).toString("base64url");
const RENDER_GENERATION = 23;
let sourceJpeg: Buffer;
let sourcePixels: Buffer;
let replacementJpeg: Buffer;

function digest(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function artifactBinding(seed: string): {
  readonly semanticSha256: `sha256:${string}`;
  readonly fileSha256: `sha256:${string}`;
  readonly byteLength: number;
} {
  return {
    semanticSha256: digest(Buffer.from(`${seed}:semantic`, "utf8")),
    fileSha256: digest(Buffer.from(`${seed}:file`, "utf8")),
    byteLength: Buffer.byteLength(seed, "utf8") + 1,
  };
}

function bindingsFor(bytes: Buffer): GrandHallT554NativeSourceEpochBindingsV1 {
  return {
    schemaVersion: "venviewer.grand-hall-t554-native-source-epoch-bindings.v1",
    sourceEpochNonce: SOURCE_EPOCH_NONCE,
    renderGeneration: RENDER_GENERATION,
    reviewPack: artifactBinding("review-pack-v3"),
    publicationReceipt: artifactBinding("publication-receipt-v3"),
    workbenchImplementationManifest: artifactBinding("workbench-implementation"),
    source: {
      inventoryIndex: 0,
      sweepNumber: 1,
      fileName: "sweep_001jpg.jpg",
      sha256: digest(bytes),
      byteLength: bytes.length,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
    },
  };
}

async function createFixture(): Promise<{
  readonly root: string;
  readonly path: string;
  readonly bindings: GrandHallT554NativeSourceEpochBindingsV1;
}> {
  const root = await mkdtemp(join(tmpdir(), "grand-hall-native-source-epoch-"));
  temporaryPaths.push(root);
  const bindings = bindingsFor(sourceJpeg);
  const path = join(root, bindings.source.fileName);
  await writeFile(path, sourceJpeg);
  return { root, path, bindings };
}

function tileRequest(column: number, row: number): {
  readonly sourceEpochNonce: string;
  readonly renderGeneration: number;
  readonly column: number;
  readonly row: number;
} {
  return {
    sourceEpochNonce: SOURCE_EPOCH_NONCE,
    renderGeneration: RENDER_GENERATION,
    column,
    row,
  };
}

function expectedTile(column: number, row: number): Buffer {
  const rowBytes = GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX * 3;
  const expected = Buffer.alloc(GRAND_HALL_T554_NATIVE_RGB8_TILE_BYTE_LENGTH);
  for (let rowOffset = 0; rowOffset < GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX; rowOffset += 1) {
    const sourceStart = (
      (row * GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX + rowOffset) *
        GRAND_HALL_PANORAMA_WIDTH_PX +
      column * GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX
    ) * 3;
    sourcePixels.copy(
      expected,
      rowOffset * rowBytes,
      sourceStart,
      sourceStart + rowBytes,
    );
  }
  return expected;
}

function expectEpochCode(
  operation: () => unknown,
  code: GrandHallT554NativeSourceEpochError["code"],
): void {
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected native source epoch error code ${code}.`);
}

beforeAll(async () => {
  const sentinelGrid = Buffer.alloc(
    GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT *
      GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT *
      3,
  );
  for (let row = 0; row < GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT; row += 1) {
    for (let column = 0; column < GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT; column += 1) {
      const offset = (row * GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT + column) * 3;
      sentinelGrid[offset] = (column * 7 + row * 3) % 256;
      sentinelGrid[offset + 1] = (row * 17 + column * 5) % 256;
      sentinelGrid[offset + 2] = (row * 31 + column * 11) % 256;
    }
  }
  sourceJpeg = await sharp(sentinelGrid, {
    raw: {
      width: GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT,
      height: GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT,
      channels: 3,
    },
  })
    .resize(GRAND_HALL_PANORAMA_WIDTH_PX, GRAND_HALL_PANORAMA_HEIGHT_PX, {
      kernel: "nearest",
    })
    .jpeg({ quality: 96, chromaSubsampling: "4:4:4" })
    .toBuffer();
  const decoded = await sharp(sourceJpeg, {
    failOn: "error",
    limitInputPixels:
      GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX,
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  sourcePixels = decoded.data;
  replacementJpeg = await sharp({
    create: {
      width: GRAND_HALL_PANORAMA_WIDTH_PX,
      height: GRAND_HALL_PANORAMA_HEIGHT_PX,
      channels: 3,
      background: { r: 250, g: 1, b: 99 },
    },
  })
    .jpeg({ quality: 82, chromaSubsampling: "4:4:4" })
    .toBuffer();
}, 60_000);

afterEach(async () => {
  for (const epoch of epochs.splice(0).reverse()) {
    if (epoch.snapshot().lifecycle === "active") {
      await epoch.abandon();
    }
  }
  for (const path of temporaryPaths.splice(0).reverse()) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("Grand Hall T-554 pinned native source epoch and exact tile service", () => {
  it("derives decoder/hash witnesses and serves exact defensive sentinel tiles", async () => {
    const fixture = await createFixture();
    await expect(openGrandHallT554NativeSourceEpochV1({
      sourceRoot: fixture.root,
      bindings: { ...fixture.bindings, sourceEpochNonce: "not-random" },
    })).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
    let destroyedFacts:
      | { readonly rawBytesWereZeroed: boolean; readonly decodedPixelsWereZeroed: boolean }
      | undefined;
    const epoch = await __testOnlyGrandHallT554NativeSourceEpochV1.openSourceEpoch(
      { sourceRoot: fixture.root, bindings: fixture.bindings },
      { afterBuffersDestroyed: (facts) => { destroyedFacts = facts; } },
    );
    epochs.push(epoch);

    const snapshot = epoch.snapshot();
    expect(snapshot).toMatchObject({
      lifecycle: "active",
      closedDisposition: null,
      sourceEpochNonce: SOURCE_EPOCH_NONCE,
      renderGeneration: RENDER_GENERATION,
      source: fixture.bindings.source,
      tileGrid: {
        widthPx: 256,
        heightPx: 256,
        columnCount: 32,
        rowCount: 16,
        channelCount: 3,
        bytesPerTile: 196_608,
        resampling: "none",
      },
      sourceVerification: {
        widthPx: 8192,
        heightPx: 4096,
        decodedChannelCount: 3,
        decodedBitsPerSample: 8,
        sameOpenDescriptorHashedAndDecoded: true,
        fullJpegDecodeCompleted: true,
        decoderIdentity: {
          library: "sharp",
          sharpVersion: sharp.versions.sharp,
          libvipsVersion: sharp.versions.vips,
          pipeline: "captured-jpeg-buffer-to-unrotated-rgb8.v1",
        },
      },
    });
    expect(snapshot.sourceVerification.decodedPixelSha256).toBe(digest(sourcePixels));
    expect(snapshot.sourceVerification.descriptorWitnessSha256).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    expect(snapshot.epochBindingSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const first = epoch.copyTile(tileRequest(19, 11));
    const second = epoch.copyTile(tileRequest(19, 11));
    expect(first).not.toBe(second);
    expect(first.length).toBe(GRAND_HALL_T554_NATIVE_RGB8_TILE_BYTE_LENGTH);
    expect(first.equals(expectedTile(19, 11))).toBe(true);
    first.fill(0);
    expect(second.equals(expectedTile(19, 11))).toBe(true);
    expect(epoch.copyTile(tileRequest(0, 0)).equals(expectedTile(0, 0))).toBe(true);
    expect(
      epoch.copyTile(tileRequest(31, 15)).equals(expectedTile(31, 15)),
    ).toBe(true);

    for (const request of [
      tileRequest(-1, 0),
      tileRequest(GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT, 0),
      tileRequest(0, -1),
      tileRequest(0, GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT),
      { ...tileRequest(0, 0), injectedVerifiedTruth: true },
    ]) {
      expectEpochCode(() => epoch.copyTile(request), "TILE_INVALID");
    }
    expectEpochCode(
      () => epoch.copyTile({
        ...tileRequest(0, 0),
        sourceEpochNonce: STALE_SOURCE_EPOCH_NONCE,
      }),
      "EPOCH_STALE",
    );
    expectEpochCode(
      () => epoch.copyTile({ ...tileRequest(0, 0), renderGeneration: 24 }),
      "EPOCH_STALE",
    );

    await epoch.abandon();
    expect(epoch.snapshot()).toMatchObject({
      lifecycle: "closed",
      closedDisposition: "abandoned",
    });
    expect(destroyedFacts).toEqual({
      rawBytesWereZeroed: true,
      decodedPixelsWereZeroed: true,
    });
    expectEpochCode(
      () => epoch.copyTile(tileRequest(19, 11)),
      "EPOCH_CLOSED",
    );
  }, 60_000);

  it("never reopens a substituted path for an active epoch", async () => {
    const fixture = await createFixture();
    let destroyed = false;
    const epoch = await __testOnlyGrandHallT554NativeSourceEpochV1.openSourceEpoch(
      { sourceRoot: fixture.root, bindings: fixture.bindings },
      {
        afterBuffersDestroyed: (facts) => {
          destroyed = facts.rawBytesWereZeroed && facts.decodedPixelsWereZeroed;
        },
      },
    );
    epochs.push(epoch);
    const expected = expectedTile(7, 4);

    await rename(fixture.path, `${fixture.path}.original`);
    await writeFile(fixture.path, replacementJpeg);

    expect(epoch.copyTile(tileRequest(7, 4)).equals(expected)).toBe(true);
    await expect(epoch.finalize()).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(epoch.snapshot()).toMatchObject({
      lifecycle: "closed",
      closedDisposition: "finalization_failed",
    });
    expect(destroyed).toBe(true);
    expectEpochCode(
      () => epoch.copyTile(tileRequest(7, 4)),
      "EPOCH_CLOSED",
    );
  }, 60_000);

  it("fails finalization on descriptor stat drift and still destroys custody buffers", async () => {
    const fixture = await createFixture();
    let destroyed = false;
    const epoch = await __testOnlyGrandHallT554NativeSourceEpochV1.openSourceEpoch(
      { sourceRoot: fixture.root, bindings: fixture.bindings },
      {
        afterBuffersDestroyed: (facts) => {
          destroyed = facts.rawBytesWereZeroed && facts.decodedPixelsWereZeroed;
        },
      },
    );
    epochs.push(epoch);

    await appendFile(fixture.path, Buffer.from([0x7f]));
    expect(epoch.copyTile(tileRequest(2, 13)).equals(expectedTile(2, 13))).toBe(true);
    await expect(epoch.finalize()).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(destroyed).toBe(true);
    expectEpochCode(
      () => epoch.copyTile(tileRequest(2, 13)),
      "EPOCH_CLOSED",
    );
  }, 60_000);

  it("finalizes one stable descriptor exactly once and refuses every closed-epoch operation", async () => {
    const fixture = await createFixture();
    let destroyed = false;
    const epoch = await __testOnlyGrandHallT554NativeSourceEpochV1.openSourceEpoch(
      { sourceRoot: fixture.root, bindings: fixture.bindings },
      {
        afterBuffersDestroyed: (facts) => {
          destroyed = facts.rawBytesWereZeroed && facts.decodedPixelsWereZeroed;
        },
      },
    );
    epochs.push(epoch);

    const finalizing = epoch.finalize();
    expectEpochCode(
      () => epoch.copyTile(tileRequest(0, 0)),
      "EPOCH_CLOSED",
    );
    const finalized = await finalizing;
    expect(finalized).toMatchObject({
      schemaVersion:
        "venviewer.grand-hall-t554-finalized-native-source-epoch.v1",
      renderGeneration: RENDER_GENERATION,
      epochBindingSha256: epoch.snapshot().epochBindingSha256,
      sourceVerification: {
        sha256: fixture.bindings.source.sha256,
        decodedPixelSha256: digest(sourcePixels),
      },
      disposition: "finalized_stable",
    });
    expect(epoch.snapshot()).toMatchObject({
      lifecycle: "closed",
      closedDisposition: "finalized_stable",
    });
    expect(destroyed).toBe(true);
    expectEpochCode(
      () => epoch.copyTile(tileRequest(0, 0)),
      "EPOCH_CLOSED",
    );
    await expect(epoch.finalize()).rejects.toMatchObject({ code: "EPOCH_CLOSED" });
    await expect(epoch.abandon()).rejects.toMatchObject({ code: "EPOCH_CLOSED" });
  }, 60_000);
});
