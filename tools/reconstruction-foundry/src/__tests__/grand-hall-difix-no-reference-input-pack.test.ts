import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { VisualLineageBenchmarkV0Schema } from "@omnitwin/types";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAND_HALL_DIFIX_BROWSER_RECORD_FILENAME,
  GRAND_HALL_DIFIX_CAPTURE_BENCHMARK_ID,
  GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX,
  GRAND_HALL_DIFIX_CAPTURE_METHOD,
  GRAND_HALL_DIFIX_EXPECTED_CAMERA,
  GRAND_HALL_DIFIX_EXPECTED_GAUSSIAN_COUNT,
  GRAND_HALL_DIFIX_EXPECTED_SOURCE_MEMBERS,
  GRAND_HALL_DIFIX_GENERATED_MASK_FILENAME,
  GRAND_HALL_DIFIX_INPUT_HEIGHT,
  GRAND_HALL_DIFIX_INPUT_WIDTH,
  GRAND_HALL_DIFIX_MANIFEST_FILENAME,
  GRAND_HALL_DIFIX_NOMINAL_DPR_ONE_ABSOLUTE_TOLERANCE,
  GRAND_HALL_DIFIX_PROTECTED_MASK_FILENAME,
  GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME,
  GRAND_HALL_DIFIX_SOURCE_RENDER_FILENAME,
  isGrandHallDifixNominalDprOne,
} from "../grand-hall-difix-no-reference-input-pack-contract.js";
import {
  GrandHallDifixInputPackError,
  checkGrandHallDifixNoReferenceInputPack,
  parseGrandHallDifixInputPackArguments,
  writeGrandHallDifixNoReferenceInputPack,
} from "../grand-hall-difix-no-reference-input-pack.js";

const temporaryRoots: string[] = [];
const INPUT_PACK_DIGEST_DOMAIN = "VENVIEWER_GRAND_HALL_DIFIX_INPUT_PACK_V1";
const OBSERVED_CHROME_NOMINAL_DPR_ONE = 1.0000000298023224;

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })));
});

function rendererSettings(): Record<string, unknown> {
  return {
    renderer: "Three.js 0.180 / Spark 2.0",
    antialias: false,
    transparent: true,
    depthWrite: false,
    maxSplats: "asset_count_plus_one_exact_runtime; library_default_fixture",
    maxStdDev: "library_default",
    minAlpha: "library_default",
    preBlurAmount: "library_default",
    blurAmount: "library_default",
    focalAdjustment: "library_default",
    toneMapping: "NoToneMapping",
    outputColorSpace: "srgb",
  };
}

function sparkRuntimeState(): Record<string, unknown> {
  return {
    activeSplats: GRAND_HALL_DIFIX_EXPECTED_GAUSSIAN_COUNT,
    maxSplats: GRAND_HALL_DIFIX_EXPECTED_GAUSSIAN_COUNT + 1,
    sorting: false,
    sortDirty: false,
    dirty: false,
    maxStdDev: 3,
    minPixelRadius: 0,
    maxPixelRadius: 1_024,
    minAlpha: 0,
    enable2DGS: false,
    preBlurAmount: 0,
    blurAmount: 0,
    focalDistance: 0,
    apertureAngle: 0,
    falloff: 1,
    clipXY: 1,
    focalAdjustment: 1,
    encodeLinear: false,
    sortRadial: false,
    minSortIntervalMs: 0,
    enableLod: false,
    enableDriveLod: false,
    enableLodFetching: false,
    lodSplatCount: null,
    lodSplatScale: 1,
    lodRenderScale: 1,
    lodInflate: false,
    pagedExtSplats: false,
    maxPagedSplats: 1,
    numLodFetchers: 1,
  };
}

function actualCamera(): Record<string, unknown> {
  return {
    position: GRAND_HALL_DIFIX_EXPECTED_CAMERA.position,
    quaternion: GRAND_HALL_DIFIX_EXPECTED_CAMERA.quaternion,
    projectionMatrix: GRAND_HALL_DIFIX_EXPECTED_CAMERA.projectionMatrix,
    fov: GRAND_HALL_DIFIX_EXPECTED_CAMERA.fov,
    near: GRAND_HALL_DIFIX_EXPECTED_CAMERA.near,
    far: GRAND_HALL_DIFIX_EXPECTED_CAMERA.far,
  };
}

function browserRecord(
  capturePath: string,
  captureBytes: Buffer,
  observedDevicePixelRatio = 1,
): Record<string, unknown> {
  const captureSha = `sha256:${createSha256(captureBytes)}`;
  const pixelCount = GRAND_HALL_DIFIX_INPUT_WIDTH * GRAND_HALL_DIFIX_INPUT_HEIGHT;
  return {
    schemaVersion: "visual-lineage-benchmark/v0",
    benchmarkId: GRAND_HALL_DIFIX_CAPTURE_BENCHMARK_ID,
    roomRef: "trades-hall/grand-hall",
    gitSha: "a".repeat(40),
    worktreeDirty: false,
    worktreeSourceStateSha256: `sha256:${"b".repeat(64)}`,
    runStartedAt: "2026-08-30T01:00:00.000Z",
    runCompletedAt: "2026-08-30T01:00:01.000Z",
    camera: structuredClone(GRAND_HALL_DIFIX_EXPECTED_CAMERA),
    viewport: {
      width: GRAND_HALL_DIFIX_INPUT_WIDTH,
      height: GRAND_HALL_DIFIX_INPUT_HEIGHT,
      devicePixelRatio: observedDevicePixelRatio,
    },
    rendererSettings: rendererSettings(),
    representations: [{
      id: "exact-sog-frontier",
      format: "sog",
      lineage: "Grand_Hall.lcc2 exact non-environment fine frontier",
      status: "diagnostic",
      visualAssessment: "not_reviewed",
      cameraRegistration: "inspection_only",
      rendererProfile: "diagnostic_resolved_defaults",
      sourceRefs: GRAND_HALL_DIFIX_EXPECTED_SOURCE_MEMBERS.map((member) => member.sha256),
      limitations: [
        "Test fixture; no authority.",
        `${GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX}${JSON.stringify({
          method: GRAND_HALL_DIFIX_CAPTURE_METHOD,
          canvasWidth: GRAND_HALL_DIFIX_INPUT_WIDTH,
          canvasHeight: GRAND_HALL_DIFIX_INPUT_HEIGHT,
          devicePixelRatio: observedDevicePixelRatio,
          contextAntialias: false,
          resizeApplied: false,
        })}`,
      ],
      screenshot: {
        path: capturePath,
        sha256: captureSha,
        sizeBytes: captureBytes.byteLength,
        width: GRAND_HALL_DIFIX_INPUT_WIDTH,
        height: GRAND_HALL_DIFIX_INPUT_HEIGHT,
        backgroundRgb: [16, 18, 23],
        nonBackgroundPixelCount: pixelCount,
        nonBackgroundPixelRatio: 1,
      },
      timings: {
        loadMs: 1,
        stableMs: 2,
        frameP50Ms: 3,
        frameP95Ms: 4,
        frameP99Ms: 5,
      },
      environment: {
        browser: "Mozilla/5.0 test",
        operatingSystem: "Windows test",
        webglVendor: "Google Inc. (NVIDIA)",
        webglRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11)",
        webglVersion: "WebGL 2.0",
        contextLost: false,
      },
      sourceMembers: GRAND_HALL_DIFIX_EXPECTED_SOURCE_MEMBERS.map((member) => ({ ...member })),
      decodedSplatCount: GRAND_HALL_DIFIX_EXPECTED_GAUSSIAN_COUNT,
      warmupFrameCount: 8,
      frameSampleCount: 1,
      frameMaxMs: 5,
      fixtureSettings: {
        camera: {
          position: GRAND_HALL_DIFIX_EXPECTED_CAMERA.position,
          target: [0.15796363067625974, 2.15606153541565, -0.19184415815737577],
          fov: 60,
          near: 0.05,
          far: 80,
        },
        group: {
          zUp: true,
          offset: [4.74065113067626, 2.84312653541565, -8.584035158157375],
        },
        renderer: {
          dpr: 1,
          antialias: false,
          fixedCamera: true,
          transparent: true,
          depthWrite: false,
        },
      },
      sparkRuntimeState: sparkRuntimeState(),
      actualCamera: actualCamera(),
      actualRenderer: {
        toneMapping: "NoToneMapping",
        outputColorSpace: "srgb",
      },
    }],
  };
}

function createSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface Harness {
  readonly root: string;
  readonly capturePath: string;
  readonly recordPath: string;
  readonly outputDirectory: string;
  readonly captureBytes: Buffer;
  readonly record: Record<string, unknown>;
}

async function makeHarnessFromCapture(
  captureBytes: Buffer,
  observedDevicePixelRatio = 1,
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "grand-hall-difix-input-pack-"));
  temporaryRoots.push(root);
  const capturePath = join(root, "capture.png");
  const recordPath = join(root, "capture.json");
  const outputDirectory = join(root, "pack");
  const record = browserRecord(capturePath, captureBytes, observedDevicePixelRatio);
  await writeFile(capturePath, captureBytes, { flag: "wx" });
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  return { root, capturePath, recordPath, outputDirectory, captureBytes, record };
}

async function makeHarness(
  width: number = GRAND_HALL_DIFIX_INPUT_WIDTH,
  height: number = GRAND_HALL_DIFIX_INPUT_HEIGHT,
  observedDevicePixelRatio = 1,
): Promise<Harness> {
  const captureBytes = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 80, g: 100, b: 120 },
    },
  }).png().toBuffer();
  return makeHarnessFromCapture(captureBytes, observedDevicePixelRatio);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function sixteenBitRgbPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(GRAND_HALL_DIFIX_INPUT_WIDTH, 0);
  header.writeUInt32BE(GRAND_HALL_DIFIX_INPUT_HEIGHT, 4);
  header[8] = 16;
  header[9] = 2;
  const rowLength = 1 + GRAND_HALL_DIFIX_INPUT_WIDTH * 3 * 2;
  const pixels = Buffer.alloc(rowLength * GRAND_HALL_DIFIX_INPUT_HEIGHT);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function sixteenBitGrayscalePng(value: 0 | 255): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(GRAND_HALL_DIFIX_INPUT_WIDTH, 0);
  header.writeUInt32BE(GRAND_HALL_DIFIX_INPUT_HEIGHT, 4);
  header[8] = 16;
  header[9] = 0;
  const rowLength = 1 + GRAND_HALL_DIFIX_INPUT_WIDTH * 2;
  const pixels = Buffer.alloc(rowLength * GRAND_HALL_DIFIX_INPUT_HEIGHT);
  if (value === 255) {
    for (let row = 0; row < GRAND_HALL_DIFIX_INPUT_HEIGHT; row += 1) {
      const start = row * rowLength + 1;
      pixels.fill(255, start, start + rowLength - 1);
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

function fileReceipt(fileName: string, bytes: Buffer): Record<string, unknown> {
  return {
    fileName,
    sizeBytes: bytes.byteLength,
    sha256: `sha256:${createSha256(bytes)}`,
  };
}

function baseReceiptValue(value: Record<string, unknown>): Record<string, unknown> {
  return {
    fileName: value["fileName"],
    sizeBytes: value["sizeBytes"],
    sha256: value["sha256"],
  };
}

function artifactReference(
  prefix: string,
  artifactType: string,
  bytes: Buffer,
): Record<string, unknown> {
  const digest = createSha256(bytes);
  return {
    artifactType,
    fileName: `${prefix}.sha256-${digest}.json`,
    sizeBytes: bytes.byteLength,
    sha256: `sha256:${digest}`,
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`${key} is not a string.`);
  return value;
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  return asRecord(JSON.parse(await readFile(filePath, "utf8")), filePath);
}

interface CompletedPackMutation {
  readonly sourceBytes?: Buffer;
  readonly protectedMaskBytes?: Buffer;
  readonly generatedMaskBytes?: Buffer;
  readonly mutateBrowserRecord?: (value: Record<string, unknown>) => void;
  readonly mutateCamera?: (value: Record<string, unknown>) => void;
  readonly mutateRenderer?: (value: Record<string, unknown>) => void;
  readonly mutateRenderGeneration?: (value: Record<string, unknown>) => void;
}

async function replaceArtifact(
  outputDirectory: string,
  oldReference: Record<string, unknown>,
  prefix: string,
  artifactType: string,
  value: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const oldPath = join(outputDirectory, requiredString(oldReference, "fileName"));
  const bytes = canonicalBytes(value);
  const reference = artifactReference(prefix, artifactType, bytes);
  const newPath = join(outputDirectory, requiredString(reference, "fileName"));
  await rm(oldPath);
  await writeFile(newPath, bytes, { flag: "wx" });
  return reference;
}

function bundleDigest(manifest: Record<string, unknown>): string {
  const protectedMask = asRecord(manifest["protectedMask"], "protectedMask");
  const generatedMask = asRecord(manifest["generatedRegionMask"], "generatedRegionMask");
  return `sha256:${domainSeparatedSha256(INPUT_PACK_DIGEST_DOMAIN, toCanonicalJson({
    sourceRender: manifest["sourceRender"],
    browserCaptureRecord: manifest["browserCaptureRecord"],
    protectedMask: baseReceiptValue(protectedMask),
    generatedRegionMask: baseReceiptValue(generatedMask),
    cameraArtifact: manifest["cameraArtifact"],
    rendererArtifact: manifest["rendererArtifact"],
    reconstructionArtifact: manifest["reconstructionArtifact"],
    renderGenerationReceipt: manifest["renderGenerationReceipt"],
  }))}`;
}

async function resealCompletedPack(
  harness: Harness,
  mutation: CompletedPackMutation,
): Promise<void> {
  const output = harness.outputDirectory;
  const manifestPath = join(output, GRAND_HALL_DIFIX_MANIFEST_FILENAME);
  const publicationPath = join(output, GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME);
  const manifest = await readJsonRecord(manifestPath);
  const sourcePath = join(output, GRAND_HALL_DIFIX_SOURCE_RENDER_FILENAME);
  const recordPath = join(output, GRAND_HALL_DIFIX_BROWSER_RECORD_FILENAME);
  const protectedPath = join(output, GRAND_HALL_DIFIX_PROTECTED_MASK_FILENAME);
  const generatedPath = join(output, GRAND_HALL_DIFIX_GENERATED_MASK_FILENAME);
  const sourceBytes = mutation.sourceBytes ?? await readFile(sourcePath);
  const protectedBytes = mutation.protectedMaskBytes ?? await readFile(protectedPath);
  const generatedBytes = mutation.generatedMaskBytes ?? await readFile(generatedPath);
  await rm(sourcePath);
  await writeFile(sourcePath, sourceBytes, { flag: "wx" });
  if (mutation.protectedMaskBytes !== undefined) {
    await rm(protectedPath);
    await writeFile(protectedPath, protectedBytes, { flag: "wx" });
  }
  if (mutation.generatedMaskBytes !== undefined) {
    await rm(generatedPath);
    await writeFile(generatedPath, generatedBytes, { flag: "wx" });
  }

  const browserRecord = await readJsonRecord(recordPath);
  const browserRepresentation = representation(browserRecord);
  const screenshot = asRecord(browserRepresentation["screenshot"], "screenshot");
  screenshot["sha256"] = `sha256:${createSha256(sourceBytes)}`;
  screenshot["sizeBytes"] = sourceBytes.byteLength;
  mutation.mutateBrowserRecord?.(browserRecord);
  const browserBytes = canonicalBytes(browserRecord);
  await rm(recordPath);
  await writeFile(recordPath, browserBytes, { flag: "wx" });

  const oldCamera = asRecord(manifest["cameraArtifact"], "cameraArtifact");
  const oldRenderer = asRecord(manifest["rendererArtifact"], "rendererArtifact");
  const oldReconstruction = asRecord(manifest["reconstructionArtifact"], "reconstructionArtifact");
  const oldRenderGeneration = asRecord(
    manifest["renderGenerationReceipt"],
    "renderGenerationReceipt",
  );
  const camera = await readJsonRecord(join(output, requiredString(oldCamera, "fileName")));
  const renderer = await readJsonRecord(join(output, requiredString(oldRenderer, "fileName")));
  const reconstruction = await readJsonRecord(
    join(output, requiredString(oldReconstruction, "fileName")),
  );
  const renderGeneration = await readJsonRecord(
    join(output, requiredString(oldRenderGeneration, "fileName")),
  );
  mutation.mutateCamera?.(camera);
  mutation.mutateRenderer?.(renderer);
  const cameraReference = await replaceArtifact(output, oldCamera, "camera", "camera", camera);
  const rendererReference = await replaceArtifact(
    output,
    oldRenderer,
    "renderer",
    "renderer",
    renderer,
  );
  const reconstructionReference = await replaceArtifact(
    output,
    oldReconstruction,
    "reconstruction",
    "reconstruction",
    reconstruction,
  );

  const sourceReceipt = fileReceipt(GRAND_HALL_DIFIX_SOURCE_RENDER_FILENAME, sourceBytes);
  const browserReceipt = fileReceipt(GRAND_HALL_DIFIX_BROWSER_RECORD_FILENAME, browserBytes);
  renderGeneration["sourceRender"] = sourceReceipt;
  renderGeneration["browserCaptureRecord"] = browserReceipt;
  renderGeneration["cameraArtifact"] = cameraReference;
  renderGeneration["rendererArtifact"] = rendererReference;
  renderGeneration["reconstructionArtifact"] = reconstructionReference;
  mutation.mutateRenderGeneration?.(renderGeneration);
  const renderGenerationReference = await replaceArtifact(
    output,
    oldRenderGeneration,
    "render-generation-receipt",
    "render_generation",
    renderGeneration,
  );

  const protectedReceipt = fileReceipt(GRAND_HALL_DIFIX_PROTECTED_MASK_FILENAME, protectedBytes);
  const generatedReceipt = fileReceipt(GRAND_HALL_DIFIX_GENERATED_MASK_FILENAME, generatedBytes);
  manifest["sourceRender"] = sourceReceipt;
  manifest["browserCaptureRecord"] = browserReceipt;
  manifest["protectedMask"] = {
    ...asRecord(manifest["protectedMask"], "protectedMask"),
    ...protectedReceipt,
  };
  manifest["generatedRegionMask"] = {
    ...asRecord(manifest["generatedRegionMask"], "generatedRegionMask"),
    ...generatedReceipt,
  };
  manifest["cameraArtifact"] = cameraReference;
  manifest["rendererArtifact"] = rendererReference;
  manifest["reconstructionArtifact"] = reconstructionReference;
  manifest["renderGenerationReceipt"] = renderGenerationReference;
  manifest["bundleMaterialSha256"] = bundleDigest(manifest);
  const manifestBytes = canonicalBytes(manifest);
  await rm(manifestPath);
  await writeFile(manifestPath, manifestBytes, { flag: "wx" });

  const publication = await readJsonRecord(publicationPath);
  publication["manifest"] = fileReceipt(GRAND_HALL_DIFIX_MANIFEST_FILENAME, manifestBytes);
  publication["filesBeforeReceipt"] = [
    sourceReceipt,
    browserReceipt,
    protectedReceipt,
    generatedReceipt,
    baseReceiptValue(cameraReference),
    baseReceiptValue(rendererReference),
    baseReceiptValue(reconstructionReference),
    baseReceiptValue(renderGenerationReference),
    publication["manifest"],
  ];
  publication["bundleMaterialSha256"] = manifest["bundleMaterialSha256"];
  await rm(publicationPath);
  await writeFile(publicationPath, canonicalBytes(publication), { flag: "wx" });
}

async function rewriteRecord(harness: Harness, mutate: (record: Record<string, unknown>) => void): Promise<void> {
  mutate(harness.record);
  VisualLineageBenchmarkV0Schema.parse(harness.record);
  await rm(harness.recordPath);
  await writeFile(harness.recordPath, `${JSON.stringify(harness.record, null, 2)}\n`, { flag: "wx" });
}

function representation(record: Record<string, unknown>): Record<string, unknown> {
  const representations = record["representations"];
  if (!Array.isArray(representations) || typeof representations[0] !== "object" || representations[0] === null) {
    throw new Error("Invalid test representation.");
  }
  return representations[0] as Record<string, unknown>;
}

async function expectPackError(
  action: Promise<unknown>,
  code: GrandHallDifixInputPackError["code"],
): Promise<void> {
  await expect(action).rejects.toMatchObject({ code });
}

describe("Grand Hall Difix no-reference input pack", () => {
  it("writes a create-only authority-none pack, constant masks, digest-addressed closure, and receipt last", async () => {
    const harness = await makeHarness();
    const result = await writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: harness.capturePath,
      browserRecordPath: harness.recordPath,
      outputDirectory: harness.outputDirectory,
    });

    expect(result.manifest.authority).toEqual({
      authority: "none",
      providerExecutionPermitted: false,
      modelTrainingPermitted: false,
      reconstructionReplacementPermitted: false,
      sourceTruthReplacementPermitted: false,
      runtimeAdmissionPermitted: false,
      stagingPermitted: false,
      publicationPermitted: false,
      productionPromotionPermitted: false,
    });
    expect(await readFile(join(harness.outputDirectory, GRAND_HALL_DIFIX_SOURCE_RENDER_FILENAME)))
      .toEqual(harness.captureBytes);
    expect(await readFile(join(harness.outputDirectory, GRAND_HALL_DIFIX_BROWSER_RECORD_FILENAME)))
      .toEqual(await readFile(harness.recordPath));

    for (const [fileName, expected] of [
      [GRAND_HALL_DIFIX_PROTECTED_MASK_FILENAME, 255],
      [GRAND_HALL_DIFIX_GENERATED_MASK_FILENAME, 0],
    ] as const) {
      const maskBytes = await readFile(join(harness.outputDirectory, fileName));
      const metadata = await sharp(maskBytes).metadata();
      const decoded = await sharp(maskBytes)
        .toColourspace("b-w")
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(metadata).toMatchObject({ space: "b-w", channels: 1 });
      expect(decoded.info).toMatchObject({
        width: GRAND_HALL_DIFIX_INPUT_WIDTH,
        height: GRAND_HALL_DIFIX_INPUT_HEIGHT,
        channels: 1,
      });
      expect(decoded.data.every((value) => value === expected)).toBe(true);
    }

    for (const artifact of [
      result.manifest.cameraArtifact,
      result.manifest.rendererArtifact,
      result.manifest.reconstructionArtifact,
      result.manifest.renderGenerationReceipt,
    ]) {
      expect(artifact.fileName).toMatch(/\.sha256-[a-f0-9]{64}\.json$/u);
      expect(await readFile(join(harness.outputDirectory, artifact.fileName))).toHaveLength(
        artifact.sizeBytes,
      );
    }
    expect((await readdir(harness.outputDirectory)).sort()).toEqual([
      ...result.publicationReceipt.filesBeforeReceipt.map((file) => file.fileName),
      GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME,
    ].sort());
    expect(result.publicationReceipt.filesBeforeReceipt.at(-1)?.fileName)
      .toBe(GRAND_HALL_DIFIX_MANIFEST_FILENAME);
    expect(result.publicationReceipt.filesBeforeReceipt.map((file) => file.fileName)).toEqual([
      GRAND_HALL_DIFIX_SOURCE_RENDER_FILENAME,
      GRAND_HALL_DIFIX_BROWSER_RECORD_FILENAME,
      GRAND_HALL_DIFIX_PROTECTED_MASK_FILENAME,
      GRAND_HALL_DIFIX_GENERATED_MASK_FILENAME,
      result.manifest.cameraArtifact.fileName,
      result.manifest.rendererArtifact.fileName,
      result.manifest.reconstructionArtifact.fileName,
      result.manifest.renderGenerationReceipt.fileName,
      GRAND_HALL_DIFIX_MANIFEST_FILENAME,
    ]);
    const rendererArtifact = await readJsonRecord(join(
      harness.outputDirectory,
      result.manifest.rendererArtifact.fileName,
    ));
    expect(rendererArtifact["observedCapture"]).toEqual({
      method: GRAND_HALL_DIFIX_CAPTURE_METHOD,
      canvasWidth: GRAND_HALL_DIFIX_INPUT_WIDTH,
      canvasHeight: GRAND_HALL_DIFIX_INPUT_HEIGHT,
      devicePixelRatio: 1,
      contextAntialias: false,
      resizeApplied: false,
    });
    expect(await checkGrandHallDifixNoReferenceInputPack(harness.outputDirectory))
      .toEqual(result);
  });

  it("preserves and accepts the real Chrome nominal-DPR-one observation", async () => {
    const harness = await makeHarness(
      GRAND_HALL_DIFIX_INPUT_WIDTH,
      GRAND_HALL_DIFIX_INPUT_HEIGHT,
      OBSERVED_CHROME_NOMINAL_DPR_ONE,
    );
    const result = await writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: harness.capturePath,
      browserRecordPath: harness.recordPath,
      outputDirectory: harness.outputDirectory,
    });
    const rendererArtifact = await readJsonRecord(join(
      harness.outputDirectory,
      result.manifest.rendererArtifact.fileName,
    ));
    expect(asRecord(rendererArtifact["viewport"], "viewport")["devicePixelRatio"])
      .toBe(OBSERVED_CHROME_NOMINAL_DPR_ONE);
    expect(asRecord(rendererArtifact["observedCapture"], "observedCapture")["devicePixelRatio"])
      .toBe(OBSERVED_CHROME_NOMINAL_DPR_ONE);
    expect(await readFile(join(harness.outputDirectory, GRAND_HALL_DIFIX_BROWSER_RECORD_FILENAME)))
      .toEqual(await readFile(harness.recordPath));
    await expect(checkGrandHallDifixNoReferenceInputPack(harness.outputDirectory))
      .resolves.toEqual(result);
  });

  it("uses the exclusive nominal-DPR-one tolerance and rejects invalid values", async () => {
    expect(isGrandHallDifixNominalDprOne(OBSERVED_CHROME_NOMINAL_DPR_ONE)).toBe(true);
    expect(isGrandHallDifixNominalDprOne(
      1 + GRAND_HALL_DIFIX_NOMINAL_DPR_ONE_ABSOLUTE_TOLERANCE * 0.999,
    )).toBe(true);
    expect(isGrandHallDifixNominalDprOne(
      1 + GRAND_HALL_DIFIX_NOMINAL_DPR_ONE_ABSOLUTE_TOLERANCE * 1.001,
    )).toBe(false);
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(isGrandHallDifixNominalDprOne(invalid)).toBe(false);
    }

    const outsideTolerance = await makeHarness(
      GRAND_HALL_DIFIX_INPUT_WIDTH,
      GRAND_HALL_DIFIX_INPUT_HEIGHT,
      1 + GRAND_HALL_DIFIX_NOMINAL_DPR_ONE_ABSOLUTE_TOLERANCE * 1.001,
    );
    await expectPackError(writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: outsideTolerance.capturePath,
      browserRecordPath: outsideTolerance.recordPath,
      outputDirectory: outsideTolerance.outputDirectory,
    }), "RECORD_MISMATCH");

    const nonPositive = await makeHarness(
      GRAND_HALL_DIFIX_INPUT_WIDTH,
      GRAND_HALL_DIFIX_INPUT_HEIGHT,
      0,
    );
    await expectPackError(writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: nonPositive.capturePath,
      browserRecordPath: nonPositive.recordPath,
      outputDirectory: nonPositive.outputDirectory,
    }), "INPUT_INVALID");
  });

  it("requires exact structured-marker cross-binding inside the nominal DPR tolerance", async () => {
    const harness = await makeHarness(
      GRAND_HALL_DIFIX_INPUT_WIDTH,
      GRAND_HALL_DIFIX_INPUT_HEIGHT,
      OBSERVED_CHROME_NOMINAL_DPR_ONE,
    );
    await rewriteRecord(harness, (record) => {
      const rep = representation(record);
      const limitations = rep["limitations"] as string[];
      const index = limitations.findIndex((entry) => (
        entry.startsWith(GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX)
      ));
      const captureEvidence = asRecord(JSON.parse(
        limitations[index]?.slice(GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX.length) ?? "{}",
      ), "captureEvidence");
      captureEvidence["devicePixelRatio"] = 1;
      limitations[index] = `${GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX}${JSON.stringify(captureEvidence)}`;
    });
    await expectPackError(writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: harness.capturePath,
      browserRecordPath: harness.recordPath,
      outputDirectory: harness.outputDirectory,
    }), "RECORD_MISMATCH");
  });

  it("allows exactly one of two concurrent create-only writers to claim the pack", async () => {
    const harness = await makeHarness();
    const outcomes = await Promise.allSettled([1, 2].map(async () => (
      writeGrandHallDifixNoReferenceInputPack({
        capturePngPath: harness.capturePath,
        browserRecordPath: harness.recordPath,
        outputDirectory: harness.outputDirectory,
      })
    )));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: { code: "OUTPUT_EXISTS" },
    });
    await expect(checkGrandHallDifixNoReferenceInputPack(harness.outputDirectory)).resolves.toBeDefined();
  });

  it("refuses an existing output without changing its sentinel", async () => {
    const harness = await makeHarness();
    await writeFile(harness.outputDirectory, "not a directory", { flag: "wx" });
    await expectPackError(writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: harness.capturePath,
      browserRecordPath: harness.recordPath,
      outputDirectory: harness.outputDirectory,
    }), "OUTPUT_EXISTS");
    expect(await readFile(harness.outputDirectory, "utf8")).toBe("not a directory");
  });

  it("fully decodes and rejects a non-1024x576 PNG before creating output", async () => {
    const harness = await makeHarness(800, 450);
    await expectPackError(writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: harness.capturePath,
      browserRecordPath: harness.recordPath,
      outputDirectory: harness.outputDirectory,
    }), "PNG_INVALID");
    await expect(readFile(harness.outputDirectory)).rejects.toThrow();
  });

  it.each([
    ["RGBA", async () => sharp({
      create: {
        width: GRAND_HALL_DIFIX_INPUT_WIDTH,
        height: GRAND_HALL_DIFIX_INPUT_HEIGHT,
        channels: 4,
        background: { r: 80, g: 100, b: 120, alpha: 0.5 },
      },
    }).png().toBuffer()],
    ["palette", async () => sharp({
      create: {
        width: GRAND_HALL_DIFIX_INPUT_WIDTH,
        height: GRAND_HALL_DIFIX_INPUT_HEIGHT,
        channels: 3,
        background: { r: 80, g: 100, b: 120 },
      },
    }).png({ palette: true, colours: 2 }).toBuffer()],
    ["16-bit depth", async () => Promise.resolve(sixteenBitRgbPng())],
  ] as const)("rejects a %s source PNG before creating output", async (_label, makePng) => {
    const harness = await makeHarnessFromCapture(await makePng());
    await expectPackError(writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: harness.capturePath,
      browserRecordPath: harness.recordPath,
      outputDirectory: harness.outputDirectory,
    }), "PNG_INVALID");
    await expect(readFile(harness.outputDirectory)).rejects.toThrow();
  });

  it.each([
    "screenshot hash",
    "camera",
    "renderer",
    "source member",
    "software WebGL",
    "active splat count",
    "warmup count",
    "sample count",
    "capture method",
    "observed canvas width",
    "observed context antialias",
  ] as const)("rejects adversarial %s mismatch", async (attack) => {
    const harness = await makeHarness();
    await rewriteRecord(harness, (record) => {
      const rep = representation(record);
      if (attack === "screenshot hash") {
        (rep["screenshot"] as Record<string, unknown>)["sha256"] = `sha256:${"0".repeat(64)}`;
      } else if (attack === "camera") {
        const changed = [...GRAND_HALL_DIFIX_EXPECTED_CAMERA.position] as [number, number, number];
        changed[0] += 0.01;
        (record["camera"] as Record<string, unknown>)["position"] = changed;
        (rep["actualCamera"] as Record<string, unknown>)["position"] = changed;
        (rep["fixtureSettings"] as Record<string, Record<string, unknown>>)["camera"]!["position"] = changed;
      } else if (attack === "renderer") {
        (record["rendererSettings"] as Record<string, unknown>)["toneMapping"] = "ACESFilmicToneMapping";
        (rep["actualRenderer"] as Record<string, unknown>)["toneMapping"] = "ACESFilmicToneMapping";
      } else if (attack === "source member") {
        const members = rep["sourceMembers"] as Record<string, unknown>[];
        members[0] = { ...members[0], sha256: `sha256:${"1".repeat(64)}` };
        const refs = rep["sourceRefs"] as string[];
        refs[0] = `sha256:${"1".repeat(64)}`;
      } else if (attack === "software WebGL") {
        (rep["environment"] as Record<string, unknown>)["webglRenderer"] = "Google SwiftShader";
      } else if (attack === "active splat count") {
        (rep["sparkRuntimeState"] as Record<string, unknown>)["activeSplats"] =
          GRAND_HALL_DIFIX_EXPECTED_GAUSSIAN_COUNT - 1;
      } else if (attack === "warmup count") {
        rep["warmupFrameCount"] = 9;
      } else if (attack === "sample count") {
        rep["frameSampleCount"] = 2;
      } else {
        const limitations = rep["limitations"] as string[];
        const index = limitations.findIndex((entry) => (
          entry.startsWith(GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX)
        ));
        const captureEvidence = asRecord(JSON.parse(
          limitations[index]?.slice(GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX.length) ?? "{}",
        ), "captureEvidence");
        if (attack === "capture method") {
          captureEvidence["method"] = "raw_framebuffer_readback";
        } else if (attack === "observed canvas width") {
          captureEvidence["canvasWidth"] = GRAND_HALL_DIFIX_INPUT_WIDTH - 1;
        } else {
          captureEvidence["contextAntialias"] = true;
        }
        limitations[index] = `${GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX}${JSON.stringify(captureEvidence)}`;
      }
    });
    await expectPackError(writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: harness.capturePath,
      browserRecordPath: harness.recordPath,
      outputDirectory: harness.outputDirectory,
    }), "RECORD_MISMATCH");
  });

  it("rejects a fully rehashed completed pack with camera cross-binding tampered", async () => {
    const harness = await makeHarness();
    await writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: harness.capturePath,
      browserRecordPath: harness.recordPath,
      outputDirectory: harness.outputDirectory,
    });
    await resealCompletedPack(harness, {
      mutateCamera: (camera) => {
        const observed = asRecord(camera["observedCamera"], "observedCamera");
        observed["position"] = [1, 2, 3];
      },
    });
    await expectPackError(
      checkGrandHallDifixNoReferenceInputPack(harness.outputDirectory),
      "RECORD_MISMATCH",
    );
  });

  it("rejects a fully rehashed renderer artifact whose nominal DPR is not exact", async () => {
    const harness = await makeHarness(
      GRAND_HALL_DIFIX_INPUT_WIDTH,
      GRAND_HALL_DIFIX_INPUT_HEIGHT,
      OBSERVED_CHROME_NOMINAL_DPR_ONE,
    );
    await writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: harness.capturePath,
      browserRecordPath: harness.recordPath,
      outputDirectory: harness.outputDirectory,
    });
    await resealCompletedPack(harness, {
      mutateRenderer: (renderer) => {
        asRecord(renderer["viewport"], "viewport")["devicePixelRatio"] = 1;
        asRecord(renderer["observedCapture"], "observedCapture")["devicePixelRatio"] = 1;
      },
    });
    await expectPackError(
      checkGrandHallDifixNoReferenceInputPack(harness.outputDirectory),
      "RECORD_MISMATCH",
    );
  });

  it("rejects a fully rehashed completed pack whose run timestamps are not cross-bound", async () => {
    const harness = await makeHarness();
    await writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: harness.capturePath,
      browserRecordPath: harness.recordPath,
      outputDirectory: harness.outputDirectory,
    });
    await resealCompletedPack(harness, {
      mutateBrowserRecord: (record) => {
        record["runStartedAt"] = "2026-08-30T00:59:59.000Z";
      },
    });
    await expectPackError(
      checkGrandHallDifixNoReferenceInputPack(harness.outputDirectory),
      "RECORD_MISMATCH",
    );
  });

  it("rejects fully rehashed completed protected-mask and RGBA source tampering", async () => {
    const maskHarness = await makeHarness();
    await writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: maskHarness.capturePath,
      browserRecordPath: maskHarness.recordPath,
      outputDirectory: maskHarness.outputDirectory,
    });
    const blackMask = await sharp(
      Buffer.alloc(GRAND_HALL_DIFIX_INPUT_WIDTH * GRAND_HALL_DIFIX_INPUT_HEIGHT),
      {
        raw: {
        width: GRAND_HALL_DIFIX_INPUT_WIDTH,
        height: GRAND_HALL_DIFIX_INPUT_HEIGHT,
        channels: 1,
        },
      },
    ).toColourspace("b-w").png().toBuffer();
    await resealCompletedPack(maskHarness, { protectedMaskBytes: blackMask });
    await expectPackError(
      checkGrandHallDifixNoReferenceInputPack(maskHarness.outputDirectory),
      "OUTPUT_INVALID",
    );

    const rgbaHarness = await makeHarness();
    await writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: rgbaHarness.capturePath,
      browserRecordPath: rgbaHarness.recordPath,
      outputDirectory: rgbaHarness.outputDirectory,
    });
    const rgba = await sharp({
      create: {
        width: GRAND_HALL_DIFIX_INPUT_WIDTH,
        height: GRAND_HALL_DIFIX_INPUT_HEIGHT,
        channels: 4,
        background: { r: 80, g: 100, b: 120, alpha: 1 },
      },
    }).png().toBuffer();
    await resealCompletedPack(rgbaHarness, { sourceBytes: rgba });
    await expectPackError(
      checkGrandHallDifixNoReferenceInputPack(rgbaHarness.outputDirectory),
      "OUTPUT_INVALID",
    );
  });

  it("rejects fully resealed 16-bit grayscale white and black masks", async () => {
    const protectedHarness = await makeHarness();
    await writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: protectedHarness.capturePath,
      browserRecordPath: protectedHarness.recordPath,
      outputDirectory: protectedHarness.outputDirectory,
    });
    await resealCompletedPack(protectedHarness, {
      protectedMaskBytes: sixteenBitGrayscalePng(255),
    });
    await expectPackError(
      checkGrandHallDifixNoReferenceInputPack(protectedHarness.outputDirectory),
      "OUTPUT_INVALID",
    );

    const generatedHarness = await makeHarness();
    await writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: generatedHarness.capturePath,
      browserRecordPath: generatedHarness.recordPath,
      outputDirectory: generatedHarness.outputDirectory,
    });
    await resealCompletedPack(generatedHarness, {
      generatedMaskBytes: sixteenBitGrayscalePng(0),
    });
    await expectPackError(
      checkGrandHallDifixNoReferenceInputPack(generatedHarness.outputDirectory),
      "OUTPUT_INVALID",
    );
  });

  it("rejects a canonical completed receipt with a reordered filesBeforeReceipt list", async () => {
    const harness = await makeHarness();
    await writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: harness.capturePath,
      browserRecordPath: harness.recordPath,
      outputDirectory: harness.outputDirectory,
    });
    const receiptPath = join(harness.outputDirectory, GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME);
    const publication = await readJsonRecord(receiptPath);
    const files = publication["filesBeforeReceipt"];
    if (!Array.isArray(files)) throw new Error("filesBeforeReceipt is not an array.");
    [files[0], files[1]] = [files[1], files[0]];
    await rm(receiptPath);
    await writeFile(receiptPath, canonicalBytes(publication), { flag: "wx" });
    await expectPackError(
      checkGrandHallDifixNoReferenceInputPack(harness.outputDirectory),
      "OUTPUT_INVALID",
    );
  });

  it("rejects a relative input path and strict duplicate-key browser JSON", async () => {
    const harness = await makeHarness();
    await expectPackError(writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: "capture.png",
      browserRecordPath: harness.recordPath,
      outputDirectory: harness.outputDirectory,
    }), "OUTPUT_UNSAFE");
    await rm(harness.recordPath);
    await writeFile(harness.recordPath, "{\"schemaVersion\":1,\"schemaVersion\":2}\n", { flag: "wx" });
    await expectPackError(writeGrandHallDifixNoReferenceInputPack({
      capturePngPath: harness.capturePath,
      browserRecordPath: harness.recordPath,
      outputDirectory: harness.outputDirectory,
    }), "INPUT_INVALID");
  });

  it("parses write/check arguments fail-closed", () => {
    expect(parseGrandHallDifixInputPackArguments([
      "--capture-png", "C:\\capture.png",
      "--browser-record", "C:\\capture.json",
      "--output", "C:\\pack",
    ])).toEqual({
      check: false,
      capturePngPath: "C:\\capture.png",
      browserRecordPath: "C:\\capture.json",
      outputDirectory: "C:\\pack",
    });
    expect(parseGrandHallDifixInputPackArguments(["--check", "--output", "C:\\pack"]))
      .toEqual({ check: true, outputDirectory: "C:\\pack" });
    expect(() => parseGrandHallDifixInputPackArguments(["--check", "--unknown"]))
      .toThrow(GrandHallDifixInputPackError);
  });
});
