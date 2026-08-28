import { createHash } from "node:crypto";
import {
  appendFile,
  link,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  symlink,
  truncate,
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
  __testOnlyGrandHallT554NativeMediaKernel,
  GrandHallT554NativeMediaKernelError,
  verifyGrandHallT554NativeMaskEvidence,
  verifyGrandHallT554NativeMaskPng,
  verifyGrandHallT554NativeSourceJpeg,
  type GrandHallT554NativeMediaInput,
} from "../grand-hall-t554-native-media-kernel.js";
import {
  __testOnlyGrandHallT554MediaValidation,
  GRAND_HALL_T554_MASK_PNG_MAX_BYTES,
  GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
} from "../grand-hall-t554-media-validation.js";

const PIXEL_COUNT = GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const temporaryPaths: string[] = [];
let sourceJpeg: Buffer;
let maskPng: Buffer;
let nonBinaryMaskPng: Buffer;
let reasonMapPng: Buffer;
let mismatchedReasonMapPng: Buffer;
let invalidReasonMapPng: Buffer;

function digest(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error &&
      typeof error.code === "string"
    ? error.code
    : undefined;
}

function stripPngToPixelChunks(bytes: Buffer): Buffer {
  const retained = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) throw new Error("Synthetic PNG chunk is truncated.");
    if (type === "IHDR" || type === "IDAT" || type === "IEND") {
      retained.push(bytes.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
  }
  return Buffer.concat(retained);
}

async function createGrayscalePng(lastSample: number): Promise<Buffer> {
  const pixels = Buffer.alloc(PIXEL_COUNT, 0);
  pixels[PIXEL_COUNT - 1] = lastSample;
  try {
    const encoded = await sharp(pixels, {
      raw: {
        width: GRAND_HALL_PANORAMA_WIDTH_PX,
        height: GRAND_HALL_PANORAMA_HEIGHT_PX,
        channels: 1,
      },
    }).toColourspace("b-w").png({ compressionLevel: 9, palette: false }).toBuffer();
    return stripPngToPixelChunks(encoded);
  } finally {
    pixels.fill(0);
  }
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "grand-hall-native-media-"));
  temporaryPaths.push(root);
  return root;
}

function inputFor(root: string, fileName: string, bytes: Buffer): GrandHallT554NativeMediaInput {
  return { sourceRoot: root, fileName, expectedSha256: digest(bytes),
    expectedByteLength: bytes.length };
}

async function writeFixture(
  fileName: string,
  bytes: Buffer,
): Promise<{ readonly root: string; readonly path: string; readonly input: GrandHallT554NativeMediaInput }> {
  const root = await createRoot();
  const path = join(root, fileName);
  await writeFile(path, bytes);
  return { root, path, input: inputFor(root, fileName, bytes) };
}

async function expectKernelCode(
  operation: Promise<unknown>,
  code: GrandHallT554NativeMediaKernelError["code"],
): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  sourceJpeg = await sharp({
    create: {
      width: GRAND_HALL_PANORAMA_WIDTH_PX,
      height: GRAND_HALL_PANORAMA_HEIGHT_PX,
      channels: 3,
      background: { r: 24, g: 32, b: 40 },
    },
  }).jpeg({ quality: 80, chromaSubsampling: "4:4:4" }).toBuffer();
  maskPng = await createGrayscalePng(255);
  nonBinaryMaskPng = await createGrayscalePng(1);
  reasonMapPng = await createGrayscalePng(5);
  mismatchedReasonMapPng = await createGrayscalePng(0);
  invalidReasonMapPng = await createGrayscalePng(6);
}, 30_000);

afterEach(async () => {
  for (const path of temporaryPaths.splice(0).reverse()) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("Grand Hall T-554 native same-descriptor media kernel", () => {
  it("fully verifies one exact JPEG and returns only defensive byte copies", async () => {
    const fixture = await writeFixture("sweep_001jpg.jpg", sourceJpeg);
    let destroyed = false;
    const verified = await __testOnlyGrandHallT554NativeMediaKernel.verifySourceJpeg(
      fixture.input,
      { afterTransientBuffersDestroyed: (facts) => {
        destroyed = facts.rawBytesWereZeroed;
      } },
    );

    expect(verified).toMatchObject({ kind: "source_jpeg", fileName: fixture.input.fileName,
      sha256: fixture.input.expectedSha256, byteLength: sourceJpeg.length });
    const first = verified.copyBytes();
    const second = verified.copyBytes();
    expect(first).not.toBe(second);
    first[0] = (first[0] ?? 0) ^ 0xff;
    expect(second.equals(sourceJpeg)).toBe(true);
    expect(verified.copyBytes().equals(sourceJpeg)).toBe(true);
    await verified.destroy();
    expect(destroyed).toBe(true);
    expect(() => verified.copyBytes()).toThrowError(expect.objectContaining({
      code: "SOURCE_CLOSED",
    }));
    await expectKernelCode(verified.destroy(), "SOURCE_CLOSED");
  }, 30_000);

  it("derives exact mask polarity counts and returns defensive copies", async () => {
    const fixture = await writeFixture("mask-001.png", maskPng);
    const verified = await verifyGrandHallT554NativeMaskPng(fixture.input);

    expect(verified).toMatchObject({
      kind: "frozen_binary_mask",
      includedPixelCount: PIXEL_COUNT - 1,
      excludedPixelCount: 1,
    });
    const first = verified.copyBytes();
    first.fill(0);
    expect(verified.copyBytes().equals(maskPng)).toBe(true);
    await verified.destroy();
    expect(() => verified.copyBytes()).toThrowError(expect.objectContaining({
      code: "SOURCE_CLOSED",
    }));
  }, 30_000);

  it("rejects traversal, non-canonical basenames, relative, UNC, and device roots", async () => {
    const root = await createRoot();
    const exact = inputFor(root, "source.jpg", Buffer.from([1]));
    const attacks = [
      { ...exact, fileName: "../source.jpg" },
      { ...exact, fileName: "nested/source.jpg" },
      { ...exact, fileName: "source.JPG" },
      { ...exact, sourceRoot: "." },
      { ...exact, sourceRoot: "//server/share/capture" },
      { ...exact, sourceRoot: "\\\\server\\share\\capture" },
      { ...exact, sourceRoot: "\\\\?\\C:\\capture" },
      { ...exact, sourceRoot: "\\\\.\\C:\\capture" },
    ];
    for (const attack of attacks) {
      await expectKernelCode(
        verifyGrandHallT554NativeSourceJpeg(attack),
        "ARGUMENT_INVALID",
      );
    }
  });

  it("rejects wrong expected length and SHA-256 before any successful decode", async () => {
    const fixture = await writeFixture("sweep_002jpg.jpg", sourceJpeg);
    await expectKernelCode(verifyGrandHallT554NativeSourceJpeg({
      ...fixture.input,
      expectedByteLength: sourceJpeg.length + 1,
    }), "SOURCE_IDENTITY_MISMATCH");
    await expectKernelCode(verifyGrandHallT554NativeSourceJpeg({
      ...fixture.input,
      expectedSha256: digest(Buffer.from("wrong bytes")),
    }), "SOURCE_IDENTITY_MISMATCH");
  });

  it("rejects malformed JPEG and PNG bytes after exact identity checks", async () => {
    const jpeg = await writeFixture("malformed.jpg", Buffer.from("not a jpeg"));
    const png = await writeFixture("malformed.png", Buffer.from("not a png"));
    await expectKernelCode(verifyGrandHallT554NativeSourceJpeg(jpeg.input), "MEDIA_INVALID");
    await expectKernelCode(verifyGrandHallT554NativeMaskPng(png.input), "MEDIA_INVALID");
  });

  it("rejects a grayscale8 mask containing a non-binary source-grid sample", async () => {
    const fixture = await writeFixture("non-binary-mask.png", nonBinaryMaskPng);
    await expectKernelCode(verifyGrandHallT554NativeMaskPng(fixture.input), "MEDIA_INVALID");
  }, 30_000);

  it("derives reason counts only from an exact source-aligned mask/reason pair", async () => {
    const root = await createRoot();
    const maskFileName = "paired-mask.png";
    const reasonFileName = "paired-reason-map.png";
    await writeFile(join(root, maskFileName), maskPng);
    await writeFile(join(root, reasonFileName), reasonMapPng);
    let rawBuffersDestroyed = false;
    const verified = await __testOnlyGrandHallT554NativeMediaKernel.verifyMaskEvidence(
      inputFor(root, maskFileName, maskPng),
      inputFor(root, reasonFileName, reasonMapPng),
      { afterTransientBuffersDestroyed: (facts) => {
        rawBuffersDestroyed = facts.rawBytesWereZeroed;
      } },
    );

    expect(verified).toMatchObject({
      kind: "frozen_mask_evidence",
      includedPixelCount: PIXEL_COUNT - 1,
      excludedPixelCount: 1,
      reasonSampleCounts: [PIXEL_COUNT - 1, 0, 0, 0, 0, 1],
      pixelTileInventorySha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(rawBuffersDestroyed).toBe(true);
  }, 30_000);

  it("keeps both descriptors pinned and rejects first-plane tampering during second-plane decode", async () => {
    const root = await createRoot();
    const maskFileName = "race-mask.png";
    const reasonFileName = "race-reason-map.png";
    const maskPath = join(root, maskFileName);
    await writeFile(maskPath, maskPng);
    await writeFile(join(root, reasonFileName), reasonMapPng);
    let decodeCount = 0;

    await expectKernelCode(__testOnlyGrandHallT554NativeMediaKernel.verifyMaskEvidence(
      inputFor(root, maskFileName, maskPng),
      inputFor(root, reasonFileName, reasonMapPng),
      { afterDecode: async () => {
        decodeCount += 1;
        if (decodeCount !== 2) return;
        const tampered = Buffer.from(maskPng);
        try {
          tampered[20] = (tampered[20] ?? 0) ^ 0xff;
          await writeFile(maskPath, tampered);
        } finally {
          tampered.fill(0);
        }
      } },
    ), "SOURCE_CHANGED");
    expect(decodeCount).toBe(2);
  }, 30_000);

  it("rejects independently valid but contradictory planes and forbidden reason samples", async () => {
    const root = await createRoot();
    await writeFile(join(root, "mask.png"), maskPng);
    await writeFile(join(root, "mismatched-reasons.png"), mismatchedReasonMapPng);
    await writeFile(join(root, "invalid-reasons.png"), invalidReasonMapPng);

    await expectKernelCode(verifyGrandHallT554NativeMaskEvidence(
      inputFor(root, "mask.png", maskPng),
      inputFor(root, "mismatched-reasons.png", mismatchedReasonMapPng),
    ), "MEDIA_INVALID");
    await expectKernelCode(verifyGrandHallT554NativeMaskEvidence(
      inputFor(root, "mask.png", maskPng),
      inputFor(root, "invalid-reasons.png", invalidReasonMapPng),
    ), "MEDIA_INVALID");
  }, 30_000);

  it("zeroes decoded mask and reason buffers on success and contradictory-plane failure", async () => {
    const destroyed: Array<{ readonly maskPixelsWereZeroed: boolean;
      readonly reasonPixelsWereZeroed: boolean }> = [];
    await expect(__testOnlyGrandHallT554MediaValidation.validateMaskEvidencePngBytes(
      maskPng,
      reasonMapPng,
      { afterDecodedBuffersDestroyed: (facts) => { destroyed.push(facts); } },
    )).resolves.toMatchObject({
      includedPixelCount: PIXEL_COUNT - 1,
      pixelTileInventorySha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    await expect(__testOnlyGrandHallT554MediaValidation.validateMaskEvidencePngBytes(
      maskPng,
      mismatchedReasonMapPng,
      { afterDecodedBuffersDestroyed: (facts) => { destroyed.push(facts); } },
    )).rejects.toThrow(/disagree/u);
    expect(destroyed).toEqual([
      { maskPixelsWereZeroed: true, reasonPixelsWereZeroed: true },
      { maskPixelsWereZeroed: true, reasonPixelsWereZeroed: true },
    ]);
  }, 30_000);

  it("rejects oversized sparse JPEG and PNG files before opening them", async () => {
    for (const [fileName, maximumBytes, verify] of [
      ["oversized.jpg", GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
        __testOnlyGrandHallT554NativeMediaKernel.verifySourceJpeg],
      ["oversized.png", GRAND_HALL_T554_MASK_PNG_MAX_BYTES,
        __testOnlyGrandHallT554NativeMediaKernel.verifyMaskPng],
    ] as const) {
      const root = await createRoot();
      const path = join(root, fileName);
      const handle = await open(path, "w");
      await handle.truncate(maximumBytes + 1);
      await handle.close();
      let descriptorPinned = false;
      await expectKernelCode(verify({ sourceRoot: root, fileName,
        expectedSha256: digest(Buffer.from([1])), expectedByteLength: 1 }, {
        afterDescriptorPinned: () => { descriptorPinned = true; },
      }), "SOURCE_INVALID");
      expect(descriptorPinned).toBe(false);
    }
  });

  it("rejects direct non-files, hardlinks, and source-root reparse aliases", async () => {
    const root = await createRoot();
    await mkdir(join(root, "directory.jpg"));
    await expectKernelCode(verifyGrandHallT554NativeSourceJpeg({
      sourceRoot: root,
      fileName: "directory.jpg",
      expectedSha256: digest(Buffer.from([1])),
      expectedByteLength: 1,
    }), "SOURCE_INVALID");

    const original = join(root, "hardlinked.jpg");
    await writeFile(original, Buffer.from([1]));
    await link(original, join(root, "hardlinked-alias.jpg"));
    await expectKernelCode(verifyGrandHallT554NativeSourceJpeg(
      inputFor(root, "hardlinked.jpg", Buffer.from([1])),
    ), "SOURCE_INVALID");

    const symlinkTarget = join(root, "symlink-target.jpg");
    const fileSymlink = join(root, "symlinked.jpg");
    await writeFile(symlinkTarget, Buffer.from([2]));
    try {
      await symlink("symlink-target.jpg", fileSymlink, "file");
      await expectKernelCode(verifyGrandHallT554NativeSourceJpeg(
        inputFor(root, "symlinked.jpg", Buffer.from([2])),
      ), "SOURCE_INVALID");
    } catch (error) {
      if (errnoCode(error) !== "EPERM" && errnoCode(error) !== "EACCES") throw error;
    }

    const aliasRoot = `${root}-alias`;
    await symlink(root, aliasRoot, "junction");
    temporaryPaths.push(aliasRoot);
    await expectKernelCode(verifyGrandHallT554NativeSourceJpeg(
      inputFor(aliasRoot, "hardlinked.jpg", Buffer.from([1])),
    ), "SOURCE_INVALID");
  });

  it("rejects a same-byte path replacement between snapshot and open", async () => {
    const fixture = await writeFixture("replacement.jpg", Buffer.from("same bytes"));
    await expectKernelCode(
      __testOnlyGrandHallT554NativeMediaKernel.verifySourceJpeg(fixture.input, {
        afterPathSnapshot: async (path) => {
          await rename(path, `${path}.original`);
          await writeFile(path, Buffer.from("same bytes"));
        },
      }),
      "SOURCE_CHANGED",
    );
  });

  it("rejects truncation after descriptor pinning and growth after exact read", async () => {
    const truncated = await writeFixture("truncated.jpg", Buffer.alloc(4_096, 1));
    await expectKernelCode(
      __testOnlyGrandHallT554NativeMediaKernel.verifySourceJpeg(truncated.input, {
        afterDescriptorPinned: (path) => truncate(path, 64),
      }),
      "SOURCE_CHANGED",
    );

    const grown = await writeFixture("grown.jpg", Buffer.alloc(4_096, 2));
    await expectKernelCode(
      __testOnlyGrandHallT554NativeMediaKernel.verifySourceJpeg(grown.input, {
        afterExactRead: (path) => appendFile(path, Buffer.from([3])),
      }),
      "SOURCE_CHANGED",
    );
  });

  it("rejects an exact mask with the wrong expected file identity", async () => {
    const fixture = await writeFixture("mask-identity.png", maskPng);
    await expectKernelCode(verifyGrandHallT554NativeMaskPng({
      ...fixture.input,
      expectedSha256: digest(Buffer.from("another mask")),
    }), "SOURCE_IDENTITY_MISMATCH");
    await expectKernelCode(verifyGrandHallT554NativeMaskPng({
      ...fixture.input,
      expectedByteLength: maskPng.length + 1,
    }), "SOURCE_IDENTITY_MISMATCH");
  });
});
