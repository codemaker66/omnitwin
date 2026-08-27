import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS,
  type GrandHallPanoramaSourceJpgIdentityV2,
} from "@omnitwin/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  validateGrandHallT554MaskPngBytes,
  validateGrandHallT554MaskReasonMapPngBytes,
} from "../grand-hall-t554-media-validation.js";
import {
  verifyGrandHallT554NativeMaskEvidence,
  verifyGrandHallT554NativeMaskPng,
} from "../grand-hall-t554-native-media-kernel.js";
import {
  __testOnlyGrandHallT554NativeMaskRevisionStore,
  GRAND_HALL_T554_NATIVE_MASK_MAX_POLYGON_VERTEX_COUNT,
  GrandHallT554NativeMaskRevisionStore,
  GrandHallT554NativeMaskStoreError,
  type GrandHallT554NativeMaskFrozenBinding,
  type GrandHallT554NativeMaskReasonCode,
} from "../grand-hall-t554-native-review-mask-store.js";

const PIXEL_COUNT = GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const temporaryPaths: string[] = [];
const stores: GrandHallT554NativeMaskRevisionStore[] = [];
let publicationDirectory: string;

function sourceIdentity(inventoryIndex = 0): GrandHallPanoramaSourceJpgIdentityV2 {
  const sweepNumber = GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS[inventoryIndex];
  if (sweepNumber === undefined) throw new Error("test source index is absent");
  const digestDigit = ((inventoryIndex + 1) % 16).toString(16);
  return {
    inventoryIndex,
    sweepNumber,
    fileName: `sweep_${String(sweepNumber).padStart(3, "0")}jpg.jpg`,
    sha256: `sha256:${digestDigit.repeat(64)}`,
    byteLength: 1_024 + inventoryIndex,
    widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
    heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
  };
}

function createStore(inventoryIndex = 0): GrandHallT554NativeMaskRevisionStore {
  const store = new GrandHallT554NativeMaskRevisionStore({
    source: sourceIdentity(inventoryIndex),
    publicationDirectory,
  });
  stores.push(store);
  return store;
}

function includeRectangle(
  expectedRevision: number,
  leftPx: number,
  topPx: number,
  rightExclusivePx: number,
  bottomExclusivePx: number,
  horizontalSeam: "none" | "wrap" = "none",
): Readonly<Record<string, unknown>> {
  return { expectedRevision, operation: "include",
    primitive: { kind: "rectangle", horizontalSeam, leftPx, topPx,
      rightExclusivePx, bottomExclusivePx } };
}

function excludeRectangle(
  expectedRevision: number,
  reasonCode: GrandHallT554NativeMaskReasonCode,
  leftPx: number,
  topPx: number,
  rightExclusivePx: number,
  bottomExclusivePx: number,
): Readonly<Record<string, unknown>> {
  return { expectedRevision, operation: "exclude", reasonCode,
    primitive: { kind: "rectangle", horizontalSeam: "none", leftPx, topPx,
      rightExclusivePx, bottomExclusivePx } };
}

function reasonCount(
  frozen: Pick<GrandHallT554NativeMaskFrozenBinding, "reasonCounts">,
  reasonCode: GrandHallT554NativeMaskReasonCode,
): number {
  return frozen.reasonCounts.find((entry) => entry.reasonCode === reasonCode)?.pixelCount ?? 0;
}

function digest(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function pngChunkTypes(bytes: Buffer): string[] {
  const types: string[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    types.push(bytes.toString("ascii", offset + 4, offset + 8));
    offset += length + 12;
  }
  if (offset !== bytes.length) throw new Error("test PNG parser found trailing bytes");
  return types;
}

async function expectStoreCode(
  operation: Promise<unknown> | (() => unknown),
  code: GrandHallT554NativeMaskStoreError["code"],
): Promise<void> {
  if (typeof operation === "function") {
    expect(operation).toThrowError(expect.objectContaining({ code }));
  } else {
    await expect(operation).rejects.toMatchObject({ code });
  }
}

beforeEach(async () => {
  publicationDirectory = await mkdtemp(join(tmpdir(), "grand-hall-native-mask-"));
  temporaryPaths.push(publicationDirectory);
});

afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.abandon();
    } catch (error) {
      if (!(error instanceof GrandHallT554NativeMaskStoreError) || error.code !== "STORE_ABANDONED") {
        throw error;
      }
    }
  }
  for (const path of temporaryPaths.splice(0).reverse()) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("Grand Hall T-554 fail-closed native mask revision store", () => {
  it("starts at revision zero as an exact all-255 excluded/unknown source grid", () => {
    const store = createStore();
    const snapshot = store.snapshot();

    expect(snapshot).toMatchObject({
      revision: 0,
      includedPixelCount: 0,
      excludedPixelCount: PIXEL_COUNT,
      activeFrozenBinding: null,
      reasonCounts: [{
        reasonCode: "unverified_or_unknown_pixels",
        pixelCount: PIXEL_COUNT,
      }],
    });
    expect(store.pixelForServerRender(0, 0)).toEqual({
      value: 255,
      reasonCode: "unverified_or_unknown_pixels",
    });
    expect(store.pixelForServerRender(
      GRAND_HALL_PANORAMA_WIDTH_PX - 1,
      GRAND_HALL_PANORAMA_HEIGHT_PX - 1,
    )).toEqual({ value: 255, reasonCode: "unverified_or_unknown_pixels" });

    expect(() => store.applyEdit(excludeRectangle(
      0,
      "unverified_or_unknown_pixels",
      0,
      0,
      1,
      1,
    ))).toThrow(/did not change any source-grid pixel/u);
    expect(store.snapshot()).toMatchObject({
      revision: 0,
      includedPixelCount: 0,
      excludedPixelCount: PIXEL_COUNT,
    });
  });

  it("rasterizes rectangles, ordinary polygons, and explicit seam-wrapped shapes at pixel centres", () => {
    const store = createStore();
    store.applyEdit(includeRectangle(0, 10, 10, 13, 12));
    store.applyEdit({
      expectedRevision: 1,
      operation: "include",
      primitive: {
        kind: "polygon",
        horizontalSeam: "none",
        points: [
          { xPx: 20, yPx: 20 },
          { xPx: 23, yPx: 20 },
          { xPx: 23, yPx: 22 },
          { xPx: 20, yPx: 22 },
        ],
      },
    });
    store.applyEdit(includeRectangle(2, 8_190, 30, 2, 31, "wrap"));
    store.applyEdit({
      expectedRevision: 3,
      operation: "include",
      primitive: {
        kind: "polygon",
        horizontalSeam: "wrap_shortest",
        points: [
          { xPx: 8_190, yPx: 40 },
          { xPx: 2, yPx: 40 },
          { xPx: 2, yPx: 42 },
          { xPx: 8_190, yPx: 42 },
        ],
      },
    });

    expect(store.snapshot()).toMatchObject({ revision: 4, includedPixelCount: 24 });
    for (const [x, y] of [[10, 10], [12, 11], [20, 20], [22, 21],
      [8_190, 30], [8_191, 30], [0, 30], [1, 30],
      [8_190, 40], [8_191, 41], [0, 40], [1, 41]] as const) {
      expect(store.pixelForServerRender(x, y).value).toBe(0);
    }
    for (const [x, y] of [[13, 10], [23, 20], [2, 30], [4_096, 30], [2, 40]] as const) {
      expect(store.pixelForServerRender(x, y).value).toBe(255);
    }
  });

  it("cannot exhaust the revision budget with repeated no-op edits", () => {
    const store = createStore();
    const noOp = excludeRectangle(
      0,
      "unverified_or_unknown_pixels",
      0,
      0,
      1,
      1,
    );
    for (let attempt = 0; attempt < 4_097; attempt += 1) {
      expect(() => store.applyEdit(noOp)).toThrow(/did not change any source-grid pixel/u);
    }
    expect(store.snapshot().revision).toBe(0);
  });

  it("enforces compare-and-swap revision ordering for two writers", async () => {
    const store = createStore();
    const writerA = includeRectangle(0, 1, 1, 2, 2);
    const writerB = includeRectangle(0, 3, 3, 4, 4);

    expect(store.applyEdit(writerA).revision).toBe(1);
    await expectStoreCode(() => store.applyEdit(writerB), "REVISION_CONFLICT");
    expect(store.pixelForServerRender(1, 1).value).toBe(0);
    expect(store.pixelForServerRender(3, 3).value).toBe(255);
  });

  it("rejects noninteger, out-of-bounds, ambiguous, oversized, self-intersecting, and truth-injecting edits", async () => {
    const store = createStore();
    const oversizedPoints = Array.from(
      { length: GRAND_HALL_T554_NATIVE_MASK_MAX_POLYGON_VERTEX_COUNT + 1 },
      (_, index) => ({ xPx: index % 100, yPx: Math.floor(index / 100) }),
    );
    const attacks: unknown[] = [
      includeRectangle(0, 0.5, 0, 2, 2),
      includeRectangle(0, 0, 0, GRAND_HALL_PANORAMA_WIDTH_PX + 1, 2),
      includeRectangle(0, 1, 0, 2, 2, "wrap"),
      { ...includeRectangle(0, 0, 0, 1, 1), maskSha256: `sha256:${"0".repeat(64)}` },
      { ...includeRectangle(0, 0, 0, 1, 1), includedPixelCount: 1, frozen: true },
      { expectedRevision: 0, operation: "exclude",
        primitive: { kind: "rectangle", horizontalSeam: "none", leftPx: 0,
          topPx: 0, rightExclusivePx: 1, bottomExclusivePx: 1 } },
      { expectedRevision: 0, operation: "include", reasonCode: "unverified_or_unknown_pixels",
        primitive: { kind: "rectangle", horizontalSeam: "none", leftPx: 0,
          topPx: 0, rightExclusivePx: 1, bottomExclusivePx: 1 } },
      { expectedRevision: 0, operation: "include",
        primitive: { kind: "polygon", horizontalSeam: "none", points: oversizedPoints } },
      { expectedRevision: 0, operation: "include",
        primitive: { kind: "polygon", horizontalSeam: "none", points: [
          { xPx: 0, yPx: 0 }, { xPx: 4, yPx: 4 },
          { xPx: 0, yPx: 4 }, { xPx: 4, yPx: 0 },
        ] } },
      { expectedRevision: 0, operation: "include",
        primitive: { kind: "polygon", horizontalSeam: "wrap_shortest", points: [
          { xPx: GRAND_HALL_PANORAMA_WIDTH_PX, yPx: 0 },
          { xPx: 2, yPx: 0 }, { xPx: 2, yPx: 2 },
        ] } },
    ];

    for (const attack of attacks) {
      await expectStoreCode(() => store.applyEdit(attack), "ARGUMENT_INVALID");
    }
    await expectStoreCode(
      store.freeze({ expectedRevision: 0, fileName: "browser-mask.png", includedPixelCount: 1 }),
      "ARGUMENT_INVALID",
    );
    await expectStoreCode(store.freeze({ expectedRevision: 0.5 }), "ARGUMENT_INVALID");
    await expectStoreCode(
      () => store.pixelForServerRender(GRAND_HALL_PANORAMA_WIDTH_PX, 0),
      "ARGUMENT_INVALID",
    );
    expect(store.snapshot().revision).toBe(0);
  });

  it("invalidates the active frozen binding whenever a later edit creates a new revision", async () => {
    const store = createStore();
    store.applyEdit(includeRectangle(0, 100, 100, 102, 102));
    const first = await store.freeze({ expectedRevision: 1 });

    expect(store.snapshot().activeFrozenBinding).toMatchObject({
      revision: 1,
      sha256: first.sha256,
    });
    await access(join(publicationDirectory, first.fileName));
    const edited = store.applyEdit(includeRectangle(1, 200, 200, 201, 201));

    expect(edited).toMatchObject({ revision: 2, activeFrozenBinding: null });
    await access(join(publicationDirectory, first.fileName));
  }, 30_000);

  it("derives exact PNG pixel and exclusion-reason counts from immutable server state", async () => {
    const store = createStore();
    store.applyEdit(includeRectangle(0, 10, 10, 20, 12));
    store.applyEdit(excludeRectangle(
      1,
      "adjacent_room_pixels",
      10,
      10,
      11,
      11,
    ));

    const frozen = await store.freeze({ expectedRevision: 2 });
    expect(frozen.schemaVersion)
      .toBe("venviewer.grand-hall-t554-native-mask-frozen-binding.v2");
    if (frozen.schemaVersion !== "venviewer.grand-hall-t554-native-mask-frozen-binding.v2") {
      throw new Error("real native mask store did not emit its reason-bound v2 evidence");
    }
    expect(frozen.includedPixelCount).toBe(19);
    expect(frozen.excludedPixelCount).toBe(PIXEL_COUNT - 19);
    expect(reasonCount(frozen, "adjacent_room_pixels")).toBe(1);
    expect(reasonCount(frozen, "unverified_or_unknown_pixels")).toBe(PIXEL_COUNT - 20);
    expect(frozen.reasonCounts.reduce((sum, entry) => sum + entry.pixelCount, 0))
      .toBe(frozen.excludedPixelCount);
    expect(frozen.reasonMap.reasonSampleCodebook).toEqual([
      { sample: 1, reasonCode: "adjacent_room_pixels" },
      { sample: 2, reasonCode: "portal_beyond_grand_hall_plane" },
      { sample: 3, reasonCode: "facade_or_exterior_pixels" },
      { sample: 4, reasonCode: "capture_artifact_outside_verified_room" },
      { sample: 5, reasonCode: "unverified_or_unknown_pixels" },
    ]);
  }, 30_000);

  it("publishes canonical mask and reason-map PNGs and derives their exact paired facts", async () => {
    const store = createStore();
    store.applyEdit(includeRectangle(0, 0, 0, 2, 2));
    const frozen = await store.freeze({ expectedRevision: 1 });
    if (frozen.schemaVersion !== "venviewer.grand-hall-t554-native-mask-frozen-binding.v2") {
      throw new Error("real native mask store did not emit v2 evidence");
    }
    const bytes = await readFile(join(publicationDirectory, frozen.fileName));
    const reasonBytes = await readFile(join(publicationDirectory, frozen.reasonMap.fileName));

    expect(pngChunkTypes(bytes)).toEqual(expect.arrayContaining(["IHDR", "IDAT", "IEND"]));
    expect(new Set(pngChunkTypes(bytes))).toEqual(new Set(["IHDR", "IDAT", "IEND"]));
    expect(new Set(pngChunkTypes(reasonBytes))).toEqual(new Set(["IHDR", "IDAT", "IEND"]));
    expect(digest(bytes)).toBe(frozen.sha256);
    expect(digest(reasonBytes)).toBe(frozen.reasonMap.sha256);
    expect(bytes.length).toBe(frozen.byteLength);
    expect(reasonBytes.length).toBe(frozen.reasonMap.byteLength);
    expect(frozen.reasonMap.fileName).not.toBe(frozen.fileName);
    await expect(validateGrandHallT554MaskPngBytes(bytes)).resolves.toEqual({
      includedPixelCount: 4,
      excludedPixelCount: PIXEL_COUNT - 4,
    });
    await expect(validateGrandHallT554MaskReasonMapPngBytes(reasonBytes)).resolves.toEqual({
      reasonSampleCounts: [4, 0, 0, 0, 0, PIXEL_COUNT - 4],
    });
    const legacyVerified = await verifyGrandHallT554NativeMaskPng({
      sourceRoot: publicationDirectory,
      fileName: frozen.fileName,
      expectedSha256: frozen.sha256,
      expectedByteLength: frozen.byteLength,
    });
    expect(legacyVerified).toMatchObject({ kind: "frozen_binary_mask", includedPixelCount: 4 });
    await legacyVerified.destroy();
    await expect(verifyGrandHallT554NativeMaskEvidence({
      sourceRoot: publicationDirectory,
      fileName: frozen.fileName,
      expectedSha256: frozen.sha256,
      expectedByteLength: frozen.byteLength,
    }, {
      sourceRoot: publicationDirectory,
      fileName: frozen.reasonMap.fileName,
      expectedSha256: frozen.reasonMap.sha256,
      expectedByteLength: frozen.reasonMap.byteLength,
    })).resolves.toMatchObject({
      includedPixelCount: 4,
      excludedPixelCount: PIXEL_COUNT - 4,
      reasonSampleCounts: [4, 0, 0, 0, 0, PIXEL_COUNT - 4],
    });
  }, 30_000);

  it("reopens both cached evidence files and rejects deletion or tampering", async () => {
    const deletedReasonStore = createStore(0);
    deletedReasonStore.applyEdit(includeRectangle(0, 4, 4, 5, 5));
    const deletedReason = await deletedReasonStore.freeze({ expectedRevision: 1 });
    if (deletedReason.schemaVersion !==
      "venviewer.grand-hall-t554-native-mask-frozen-binding.v2") {
      throw new Error("real native mask store did not emit v2 evidence");
    }
    await rm(join(publicationDirectory, deletedReason.reasonMap.fileName));
    await expectStoreCode(
      deletedReasonStore.freeze({ expectedRevision: 1 }),
      "PUBLICATION_INVALID",
    );

    const tamperedMaskStore = createStore(1);
    tamperedMaskStore.applyEdit(includeRectangle(0, 8, 8, 9, 9));
    const tamperedMask = await tamperedMaskStore.freeze({ expectedRevision: 1 });
    await writeFile(join(publicationDirectory, tamperedMask.fileName), Buffer.from("tampered"));
    await expectStoreCode(
      tamperedMaskStore.freeze({ expectedRevision: 1 }),
      "PUBLICATION_INVALID",
    );
    expect(deletedReasonStore.snapshot().activeFrozenBinding).toBeNull();
    expect(tamperedMaskStore.snapshot().activeFrozenBinding).toBeNull();
  }, 60_000);

  it("records the completed directory or Windows file-flush durability barrier before ack", async () => {
    const store = createStore(0);
    const barriers: Array<{ readonly publicationDirectory: string;
      readonly mode: "directory_fsync" | "windows_file_fsync_fallback" }> = [];
    __testOnlyGrandHallT554NativeMaskRevisionStore.observePublicationDirectorySync(store, {
      afterPublicationDurabilityBarrier: (facts) => { barriers.push(facts); },
    });

    const frozen = await store.freeze({ expectedRevision: 0 });
    const expectedMode = process.platform === "win32"
      ? "windows_file_fsync_fallback" as const
      : "directory_fsync" as const;
    expect(barriers).toEqual([
      { publicationDirectory, mode: expectedMode },
      { publicationDirectory, mode: expectedMode },
    ]);
    expect(frozen.publicationDurability).toBe(expectedMode);

    const failingStore = createStore(1);
    __testOnlyGrandHallT554NativeMaskRevisionStore.observePublicationDirectorySync(failingStore, {
      beforePublicationDirectorySync: () => { throw new Error("injected directory fsync failure"); },
    });
    await expectStoreCode(failingStore.freeze({ expectedRevision: 0 }), "PUBLICATION_INVALID");
    expect(failingStore.snapshot().activeFrozenBinding).toBeNull();
  }, 60_000);

  it("never replaces a pre-existing derived frozen-mask path", async () => {
    const firstStore = createStore();
    firstStore.applyEdit(includeRectangle(0, 30, 30, 32, 32));
    const first = await firstStore.freeze({ expectedRevision: 1 });
    const before = await readFile(join(publicationDirectory, first.fileName));

    const competingStore = createStore();
    competingStore.applyEdit(includeRectangle(0, 30, 30, 32, 32));
    await expectStoreCode(
      competingStore.freeze({ expectedRevision: 1 }),
      "PUBLICATION_EXISTS",
    );
    const after = await readFile(join(publicationDirectory, first.fileName));
    expect(after.equals(before)).toBe(true);
  }, 30_000);

  it("accepts byte-identical masks for different sources while keeping paths source-unique", async () => {
    const first = await createStore(0).freeze({ expectedRevision: 0 });
    const second = await createStore(1).freeze({ expectedRevision: 0 });
    const firstBytes = await readFile(join(publicationDirectory, first.fileName));
    const secondBytes = await readFile(join(publicationDirectory, second.fileName));

    expect(first.sha256).toBe(second.sha256);
    expect(first.byteLength).toBe(second.byteLength);
    expect(first.fileName).not.toBe(second.fileName);
    expect(firstBytes.equals(secondBytes)).toBe(true);
    expect(first.source.inventoryIndex).toBe(0);
    expect(second.source.inventoryIndex).toBe(1);
  }, 30_000);

  it("zeroes every unique owned revision buffer before abandoning it", async () => {
    const store = createStore();
    store.applyEdit(includeRectangle(0, 1, 1, 2, 2));
    store.applyEdit(excludeRectangle(1, "adjacent_room_pixels", 300, 300, 301, 301));
    const destroyed: Buffer[] = [];
    __testOnlyGrandHallT554NativeMaskRevisionStore.observeBufferZeroing(
      store,
      (buffer) => { destroyed.push(buffer); },
    );

    store.abandon();

    expect(destroyed.length).toBeGreaterThanOrEqual(6);
    expect(new Set(destroyed).size).toBe(destroyed.length);
    expect(destroyed.every((buffer) => buffer.every((sample) => sample === 0))).toBe(true);
    await expectStoreCode(() => store.snapshot(), "STORE_ABANDONED");
  });

  it("rejects invalid source/index bindings and browser-controlled publication paths", async () => {
    const wrongSweep = sourceIdentity(1);
    const invalidSource = { ...wrongSweep, sweepNumber: 1,
      fileName: "sweep_001jpg.jpg" };
    await expectStoreCode(
      () => new GrandHallT554NativeMaskRevisionStore({
        source: invalidSource,
        publicationDirectory,
      }),
      "SOURCE_BINDING_INVALID",
    );
    await expectStoreCode(
      () => new GrandHallT554NativeMaskRevisionStore({
        source: sourceIdentity(),
        publicationDirectory: ".",
      }),
      "ARGUMENT_INVALID",
    );
    for (const unsafeRoot of [
      "//server/share/review",
      "\\\\server\\share\\review",
      "\\\\?\\C:\\review",
      "\\\\.\\C:\\review",
    ]) {
      await expectStoreCode(
        () => new GrandHallT554NativeMaskRevisionStore({
          source: sourceIdentity(),
          publicationDirectory: unsafeRoot,
        }),
        "ARGUMENT_INVALID",
      );
    }
  });
});
