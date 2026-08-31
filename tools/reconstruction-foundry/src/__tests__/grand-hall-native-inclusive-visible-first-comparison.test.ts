import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildGrandHallNativeInclusiveVisibleFirstComparison,
  checkGrandHallNativeInclusiveVisibleFirstComparison,
  GRAND_HALL_NATIVE_INCLUSIVE_RECEIPT,
  GrandHallNativeInclusiveComparisonError,
  validateGrandHallNativeOperatorEvidence,
  verifyGrandHallExpandedPng16,
  verifyGrandHallNativePixelBindings,
  verifyGrandHallNativePng8,
  writeGrandHallNativeInclusiveVisibleFirstComparison,
} from "../grand-hall-native-inclusive-visible-first-comparison.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const REAL_NATIVE = "C:\\Users\\blake\\AppData\\Local\\Venviewer\\native-captures\\grand-hall-gh1-lcc2-20260831T210928Z-61dd133e";
const REAL_BROWSER = "C:\\Users\\blake\\omnitwin2-grand-hall-exact-runtime\\docs\\evidence\\grand-hall-lineage\\2026-08-31-visible-first-hardware-v3\\visible-first-browser-bakeoff-receipt.json";
const REAL_OUTPUT = "C:\\Users\\blake\\omnitwin2-grand-hall-exact-runtime\\docs\\evidence\\grand-hall-lineage\\2026-08-31-native-inclusive-visible-first-v1";
const PNG8 = "grand-hall-native-capture-1600x900.png";
const RAW = "grand-hall-native-capture-1600x900.unorm-lower-left.rgb24";
const PNG16 = "grand-hall-native-capture-1600x900.srgb-tagged-expanded16.png";
const EXPECTED_OUTPUT_HASHES = Object.freeze({
  "native-inclusive-comparison-receipt.json": "68889dd7d73b6c3e7525501f9f0984507c83223bc0dc81d6bf93084b8b4a96f4",
  "sog-native-absolute-rgb-difference-x8.png": "1179f80aeea0fb8eabce91362b2efe0d3082d5fb497bc942e8969d1adc010b90",
  "sog-spz-absolute-rgb-difference-x8.png": "68e65209e737748f0fa5ac608d018ddfaefd01ef34745510dfaf0078916a9a7d",
  "sog-spz-native-side-by-side.png": "bc05456cc3190185854844af79cd2e378034addfc5c86e75d220d8d533dbbdd9",
  "spz-native-absolute-rgb-difference-x8.png": "b4abcb198ff207a83c198004d164c15465f3c61f245dbae280cde5b1edad945f",
});

const roots: string[] = [];
const hash = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function thrownCode(action: () => unknown): string {
  try { action(); } catch (error) {
    if (error instanceof GrandHallNativeInclusiveComparisonError) return error.code;
    throw error;
  }
  throw new Error("Expected GrandHallNativeInclusiveComparisonError.");
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function mutateChunkWithValidCrc(bytes: Buffer, typeWanted: string, mutate: (data: Buffer) => void): Buffer {
  const result = Buffer.from(bytes);
  let offset = 8;
  while (offset < result.length) {
    const length = result.readUInt32BE(offset);
    const typeStart = offset + 4;
    const type = result.subarray(typeStart, typeStart + 4).toString("ascii");
    const dataStart = offset + 8;
    const crcOffset = dataStart + length;
    if (type === typeWanted) {
      mutate(result.subarray(dataStart, crcOffset));
      result.writeUInt32BE(crc32(result.subarray(typeStart, crcOffset)), crcOffset);
      return result;
    }
    offset = crcOffset + 4;
  }
  throw new Error(`Chunk not found: ${typeWanted}`);
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("native-inclusive visible-first comparison", () => {
  it.runIf(existsSync(REAL_NATIVE))("validates the exact frozen v14 build, package, lease, log, attempts, and pixel artifacts", async () => {
    const evidence = await validateGrandHallNativeOperatorEvidence(REAL_NATIVE);
    expect(evidence.bindings).toMatchObject({
      operatorReceiptSha256: "sha256:a37fa98ee31abbd14a96a91462e571c2aed2b4b6e8b51d4918cda39efe7e314e",
      nativeReceiptSha256: "sha256:a97006c8facd90b8e4e8d4914acc72ea63ffbb967754ac9aaca4132c99369f90",
      runLogSha256: "sha256:5de2d06f1b922326dea9da7509ab7ec113bb1d3fd8866d1f563ccb2b02280b28",
      png8Sha256: "sha256:c08e5f2074792e852635b3ae6b48d1cdc114c440efd6f604f31f9ed1827c13e7",
      rawRgb24Sha256: "sha256:aa5caa2c91da3e9526bb538d77d495848dbe15fd6217b1470138e6bd3cea2364",
      png16Sha256: "sha256:6fb177906d1a0f4484b2c5b664453439cd776fa6b7ed7f844f0906eb892e8b69",
    });
    expect(evidence.rgb).toHaveLength(1_600 * 900 * 3);
  });

  it.runIf(existsSync(REAL_NATIVE))("rejects raw drift, malformed PNG8, and valid-CRC PNG16 colour-declaration drift", async () => {
    const [png8, raw, png16] = await Promise.all([
      readFile(join(REAL_NATIVE, PNG8)), readFile(join(REAL_NATIVE, RAW)), readFile(join(REAL_NATIVE, PNG16)),
    ]);
    const decoded = verifyGrandHallNativePng8(png8);
    expect(() => { verifyGrandHallExpandedPng16(png16, decoded); }).not.toThrow();
    expect(verifyGrandHallNativePixelBindings(png8, raw, png16)).toEqual(decoded);

    const changedRaw = Buffer.from(raw); changedRaw[0] = (changedRaw[0] ?? 0) ^ 1;
    expect(thrownCode(() => verifyGrandHallNativePixelBindings(png8, changedRaw, png16))).toBe("PIXEL_BINDING_INVALID");
    expect(thrownCode(() => verifyGrandHallNativePng8(Buffer.concat([png8, Buffer.from([0])])))).toBe("PNG8_INVALID");
    const changedPng16 = mutateChunkWithValidCrc(png16, "sRGB", (data) => { data[0] = 1; });
    expect(thrownCode(() => { verifyGrandHallExpandedPng16(changedPng16, decoded); })).toBe("PNG16_INVALID");
  });

  it("rejects non-normalized native paths and incomplete native inventories before trusting receipts", async () => {
    await expect(validateGrandHallNativeOperatorEvidence(`${REAL_NATIVE}\\..\\grand-hall-gh1-lcc2-20260831T210928Z-61dd133e`))
      .rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
    const root = await temporaryRoot("native-inclusive-empty-");
    await expect(validateGrandHallNativeOperatorEvidence(root)).rejects.toMatchObject({ code: "INVENTORY_INVALID" });
  });

  it.runIf(existsSync(REAL_BROWSER) && existsSync(REAL_NATIVE) && existsSync(REAL_OUTPUT))("rebuilds and checks the real browser-v3 plus native-v14 bundle byte-exactly without changing authority", async () => {
    const built = await buildGrandHallNativeInclusiveVisibleFirstComparison(REAL_BROWSER, REAL_NATIVE);
    expect(built.receipt).toMatchObject({ authority: "none", decisionStatus: "not_evaluated", winner: null, rankingPermitted: false });
    expect([...built.files.keys()].sort()).toEqual(Object.keys(EXPECTED_OUTPUT_HASHES).sort());
    for (const [name, expectedHash] of Object.entries(EXPECTED_OUTPUT_HASHES)) {
      const generated = built.files.get(name);
      expect(generated, name).toBeDefined();
      expect(hash(generated ?? Buffer.alloc(0)), name).toBe(expectedHash);
      expect(generated?.compare(await readFile(join(REAL_OUTPUT, name))), name).toBe(0);
    }
    const checked = await checkGrandHallNativeInclusiveVisibleFirstComparison(REAL_BROWSER, REAL_NATIVE, REAL_OUTPUT);
    expect(checked).toMatchObject({ authority: "none", winner: null, rankingPermitted: false });
  });

  it.runIf(existsSync(REAL_BROWSER) && existsSync(REAL_NATIVE))("publishes atomically, checks regeneration, and refuses to overwrite the exact output", async () => {
    const root = await temporaryRoot("native-inclusive-write-");
    const output = join(root, "result");
    const receipt = await writeGrandHallNativeInclusiveVisibleFirstComparison(REAL_BROWSER, REAL_NATIVE, output);
    expect(receipt).toMatchObject({ authority: "none", winner: null });
    await expect(checkGrandHallNativeInclusiveVisibleFirstComparison(REAL_BROWSER, REAL_NATIVE, output)).resolves.toMatchObject({ authority: "none", winner: null });
    const before = await Promise.all((await readdir(output)).sort().map(async (name) => [name, hash(await readFile(join(output, name)))] as const));
    await expect(writeGrandHallNativeInclusiveVisibleFirstComparison(REAL_BROWSER, REAL_NATIVE, output)).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
    const after = await Promise.all((await readdir(output)).sort().map(async (name) => [name, hash(await readFile(join(output, name)))] as const));
    expect(after).toEqual(before);
  });

  it.runIf(existsSync(REAL_BROWSER) && existsSync(REAL_NATIVE))("preserves a racing target and cleans only its own verified staging directory", async () => {
    const root = await temporaryRoot("native-inclusive-target-race-");
    const output = join(root, "result");
    await expect(writeGrandHallNativeInclusiveVisibleFirstComparison(REAL_BROWSER, REAL_NATIVE, output, {
      testHooks: { beforePublish: async ({ targetDirectory }) => { await mkdir(targetDirectory); await writeFile(join(targetDirectory, "attacker.txt"), "preserve-me"); } },
    })).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
    expect(await readFile(join(output, "attacker.txt"), "utf8")).toBe("preserve-me");
    expect((await readdir(root)).filter((name) => name.startsWith(".result.staging-"))).toEqual([]);
  });

  it.runIf(existsSync(REAL_BROWSER) && existsSync(REAL_NATIVE))("does not delete a replacement staging object after an adversarial identity swap", async () => {
    const root = await temporaryRoot("native-inclusive-staging-race-");
    const output = join(root, "result");
    let replacement = "";
    await expect(writeGrandHallNativeInclusiveVisibleFirstComparison(REAL_BROWSER, REAL_NATIVE, output, {
      testHooks: { afterStagingClaimed: async ({ stagingDirectory }) => {
        replacement = stagingDirectory;
        await rename(stagingDirectory, `${stagingDirectory}.original`);
        await mkdir(stagingDirectory);
        await writeFile(join(stagingDirectory, "attacker.txt"), "preserve-me");
      } },
    })).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    expect(await readFile(join(replacement, "attacker.txt"), "utf8")).toBe("preserve-me");
    expect(existsSync(output)).toBe(false);
  });

  it.runIf(existsSync(REAL_BROWSER) && existsSync(REAL_NATIVE))("fails after a post-rename target identity swap without deleting the replacement", async () => {
    const root = await temporaryRoot("native-inclusive-published-race-");
    const output = join(root, "result");
    const original = join(root, "published-original");
    await expect(writeGrandHallNativeInclusiveVisibleFirstComparison(REAL_BROWSER, REAL_NATIVE, output, {
      testHooks: { afterPublishedIdentityRead: async ({ targetDirectory }) => {
        await rename(targetDirectory, original);
        await mkdir(targetDirectory);
        await writeFile(join(targetDirectory, "attacker.txt"), "preserve-me");
      } },
    })).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    expect(await readFile(join(output, "attacker.txt"), "utf8")).toBe("preserve-me");
    expect((await readdir(original)).sort()).toContain(GRAND_HALL_NATIVE_INCLUSIVE_RECEIPT);
  });

  it.runIf(existsSync(REAL_BROWSER) && existsSync(REAL_NATIVE))("fails a deterministic check when the output directory is replaced before member reads", async () => {
    const root = await temporaryRoot("native-inclusive-check-race-");
    const output = join(root, "result");
    const original = join(root, "check-original");
    await writeGrandHallNativeInclusiveVisibleFirstComparison(REAL_BROWSER, REAL_NATIVE, output);
    let swapped = false;
    await expect(checkGrandHallNativeInclusiveVisibleFirstComparison(REAL_BROWSER, REAL_NATIVE, output, {
      testHooks: { beforeOutputMemberRead: async ({ outputDirectory }) => {
        if (swapped) return;
        swapped = true;
        await rename(outputDirectory, original);
        await mkdir(outputDirectory);
        await writeFile(join(outputDirectory, "attacker.txt"), "preserve-me");
      } },
    })).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    expect(await readFile(join(output, "attacker.txt"), "utf8")).toBe("preserve-me");
    expect((await readdir(original)).sort()).toContain(GRAND_HALL_NATIVE_INCLUSIVE_RECEIPT);
  });
});
