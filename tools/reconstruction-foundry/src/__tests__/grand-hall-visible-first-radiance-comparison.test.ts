import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stableCanonicalJson, toCanonicalJson } from "@omnitwin/reconstruction-foundry";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAND_HALL_VISIBLE_FIRST_COMPARISON_RECEIPT_FILENAME,
  GRAND_HALL_VISIBLE_FIRST_DIFFERENCE_FILENAME,
  GRAND_HALL_VISIBLE_FIRST_SIDE_BY_SIDE_FILENAME,
  GrandHallVisibleFirstComparisonError,
  checkGrandHallVisibleFirstRadianceComparison,
  parseGrandHallVisibleFirstRadianceComparisonArguments,
  runGrandHallVisibleFirstRadianceComparisonCli,
  writeGrandHallVisibleFirstRadianceComparison,
} from "../grand-hall-visible-first-radiance-comparison.js";

const WIDTH = 1_600;
const HEIGHT = 900;
const PIXEL_BYTES = WIDTH * HEIGHT * 3;
const CAMERA_ID = "source-pose-19890-interior-v1";
const CANONICAL_CAMERA_SHA256 = "sha256:9eca9b6582b7301ec1c059b1a5be699e5a4983773afecb2beea46c2668305922";
const CANONICAL_CAMERA_PATH = fileURLToPath(new URL(
  "../../native/grand-hall-lcc-native-capture/camera-profile.json",
  import.meta.url,
));
const CANONICAL_CAMERA_POSITION = [-0.03426186932373998, 2.15606153541565, 8.015104841842623] as const;
const CANONICAL_CAMERA_TARGET = [0.15796363067625974, 2.15606153541565, -0.19184415815737577] as const;
const CANONICAL_CAMERA_QUATERNION = [0, -0.01170873415725777, 0, 0.999931450422695] as const;
const GIT_SHA = "a".repeat(40);
const LAUNCH_ARGS = [
  "--use-angle=d3d11",
  "--disable-software-rasterizer",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--force-device-scale-factor=1",
] as const;

interface CaptureReceipt {
  runOrdinal: number;
  residencyState: "cold_load" | "resident";
  residencyRunOrdinal: number;
  sourceRequestCountBefore: number;
  sourceRequestCountAfter: number;
  runtimeInstanceId: string;
  renderedFrameCountBefore: number;
  renderedFrameCountAfter: number;
  recordPath: string;
  recordSha256: string;
  screenshotPath: string;
  screenshotSha256: string;
}

interface LaneReceipt {
  representation: "sog" | "spz" | "ply";
  runnerPid: number;
  baseUrl: string;
  browserProfileSha256: string;
  radianceRankingEligible: boolean;
  captures: CaptureReceipt[];
}

interface SyntheticReceipt {
  schemaVersion: string;
  authority: "none";
  gitSha: string;
  worktreeDirty: boolean;
  startedAt: string;
  completedAt: string;
  cameraProfile: {
    profileId: string;
    sourcePath: string;
    artifactPath: string;
    sha256: string;
    target: [number, number, number];
  };
  processIsolation: string;
  browserHardwarePreflight: {
    profileSha256: string;
    selectedProfile: HardwareProfile;
    attempts: Array<{
      candidate: HardwareCandidate;
      outcome: "selected_hardware";
      evidence: HardwareEvidence;
    }>;
    completedBeforeEvidenceDirectoryCreation: true;
  };
  executionOrder: ["sog", "spz", "ply"];
  radianceRankingEligibleRepresentations: ["sog", "spz"];
  structuralOnlyRepresentations: ["ply"];
  lanes: LaneReceipt[];
  limitations: [string, string, string, string];
}

interface HardwareCandidate {
  candidateId: string;
  browserName: "chromium";
  channel: "chrome";
  headless: true;
  launchArgs: readonly string[];
}

interface HardwareEvidence {
  browserVersion: string;
  userAgent: string;
  webglVendor: string;
  webglRenderer: string;
  webglVersion: string;
  contextLost: false;
  probeDurationMs: number;
}

interface HardwareProfile extends HardwareCandidate, HardwareEvidence {
  schemaVersion: string;
}

interface SyntheticBundle {
  readonly root: string;
  readonly receiptPath: string;
  readonly receipt: SyntheticReceipt;
}

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function pngFromRgb(rgb: Buffer): Promise<Buffer> {
  return sharp(rgb, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

async function pngFromRgba(rgba: Buffer): Promise<Buffer> {
  return sharp(rgba, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

async function coverageFromPng(png: Buffer): Promise<{ readonly count: number; readonly ratio: number }> {
  const decoded = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let offset = 0; offset < decoded.data.length; offset += decoded.info.channels) {
    if (
      Math.abs((decoded.data[offset] ?? 0) - 16) > 6
      || Math.abs((decoded.data[offset + 1] ?? 0) - 18) > 6
      || Math.abs((decoded.data[offset + 2] ?? 0) - 23) > 6
    ) count += 1;
  }
  return { count, ratio: count / (WIDTH * HEIGHT) };
}

function perspectiveProjection(fov: number, near: number, far: number, aspect: number) {
  const focalY = 1 / Math.tan((fov * Math.PI) / 360);
  const focalX = focalY / aspect;
  const depthA = (far + near) / (near - far);
  const depthB = (2 * far * near) / (near - far);
  return [
    focalX, 0, 0, 0,
    0, focalY, 0, 0,
    0, 0, depthA, -1,
    0, 0, depthB, 0,
  ];
}

function sourceMembers(representation: "sog" | "spz" | "ply", count: number, totalSize: number) {
  return Array.from({ length: count }, (_, index) => {
    const digest = hash(Buffer.from(`${representation}-member-${String(index)}`, "utf8"));
    return {
      relativePath: `${representation}/member-${String(index)}.${representation}`,
      sizeBytes: index === 0 ? totalSize - count + 1 : 1,
      sha256: digest,
    };
  });
}

function recordFor(input: {
  readonly representation: "sog" | "spz";
  readonly capture: Omit<CaptureReceipt, "recordPath" | "recordSha256" | "screenshotPath" | "screenshotSha256">;
  readonly screenshotName: string;
  readonly screenshotBytes: Buffer;
  readonly profileSha256: string;
  readonly cameraSha256: string;
  readonly hardware: HardwareProfile;
  readonly coverage: { readonly count: number; readonly ratio: number };
}) {
  const isSog = input.representation === "sog";
  const members = sourceMembers(
    input.representation,
    11,
    isSog ? 106_479_738 : 178_415_360,
  );
  const fov = 60;
  const near = 0.05;
  const far = 80;
  const aspect = WIDTH / HEIGHT;
  const camera = {
    id: CAMERA_ID,
    revision: 1,
    sourceFrame: "THREE_CAMERA",
    position: [...CANONICAL_CAMERA_POSITION] as [number, number, number],
    quaternion: [...CANONICAL_CAMERA_QUATERNION] as [number, number, number, number],
    projection: "perspective",
    fov,
    near,
    far,
    aspect,
    projectionMatrix: perspectiveProjection(fov, near, far, aspect),
  } as const;
  const residency = {
    representation: input.representation,
    runOrdinal: input.capture.runOrdinal,
    residencyState: input.capture.residencyState,
    residencyRunOrdinal: input.capture.residencyRunOrdinal,
    sourceRequestCountBefore: input.capture.sourceRequestCountBefore,
    sourceRequestCountAfter: input.capture.sourceRequestCountAfter,
    runtimeInstanceId: input.capture.runtimeInstanceId,
    renderedFrameCountBefore: input.capture.renderedFrameCountBefore,
    renderedFrameCountAfter: input.capture.renderedFrameCountAfter,
    browserProcessScope: "one_representation_one_cold_load_plus_three_resident_captures",
  };
  const runLabel = input.capture.residencyState === "cold_load"
    ? "cold-load-1"
    : `resident-capture-${String(input.capture.residencyRunOrdinal)}`;
  return {
    schemaVersion: "visual-lineage-benchmark/v0",
    benchmarkId: `grand-hall-${input.representation}-source-pose-local-${runLabel}-diagnostic-controlled-120w-600f-v1`,
    roomRef: "trades-hall/grand-hall",
    gitSha: GIT_SHA,
    worktreeDirty: false,
    runStartedAt: "2026-08-31T10:00:00.000Z",
    runCompletedAt: "2026-08-31T10:01:00.000Z",
    camera,
    viewport: { width: WIDTH, height: HEIGHT, devicePixelRatio: 1 },
    rendererSettings: {
      renderer: "Three.js 0.180 / Spark 2.0",
      antialias: false,
      transparent: true,
      depthWrite: false,
      maxSplats: "asset_count_plus_one",
      maxStdDev: "library_default",
      minAlpha: "library_default",
      preBlurAmount: "library_default",
      blurAmount: "library_default",
      focalAdjustment: "library_default",
      toneMapping: "NoToneMapping",
      outputColorSpace: "srgb",
    },
    representations: [{
      id: isSog ? "exact-sog-frontier" : "name-matched-spz-candidate",
      format: input.representation,
      lineage: `${input.representation}/synthetic-fixture`,
      status: "diagnostic",
      visualAssessment: "not_reviewed",
      cameraRegistration: "inspection_only",
      rendererProfile: "diagnostic_resolved_defaults",
      sourceRefs: members.map((member) => member.sha256),
      limitations: [
        `VENVIEWER_SHARED_CAMERA_PROFILE_V1:${JSON.stringify({
          profileId: CAMERA_ID,
          relativePath: "tools/reconstruction-foundry/native/grand-hall-lcc-native-capture/camera-profile.json",
          sha256: input.cameraSha256,
        })}`,
        `VENVIEWER_BROWSER_SOURCE_RESIDENCY_V1:${JSON.stringify(residency)}`,
        `VENVIEWER_BROWSER_HARDWARE_PREFLIGHT_V1:${JSON.stringify({
          profileSha256: input.profileSha256,
          completedBeforeSourceNavigation: true,
          browserVersion: input.hardware.browserVersion,
        })}`,
      ],
      screenshot: {
        path: `Z:\\relocated\\${input.representation}\\${input.screenshotName}`,
        sha256: hash(input.screenshotBytes),
        sizeBytes: input.screenshotBytes.length,
        width: WIDTH,
        height: HEIGHT,
        backgroundRgb: [16, 18, 23],
        nonBackgroundPixelCount: input.coverage.count,
        nonBackgroundPixelRatio: input.coverage.ratio,
      },
      timings: {
        loadMs: input.capture.residencyState === "cold_load" ? 10 : 0,
        stableMs: 20,
        frameP50Ms: 1,
        frameP95Ms: 2,
        frameP99Ms: 3,
      },
      environment: {
        browser: input.hardware.userAgent,
        operatingSystem: "Windows",
        webglVendor: input.hardware.webglVendor,
        webglRenderer: input.hardware.webglRenderer,
        webglVersion: input.hardware.webglVersion,
        contextLost: false,
      },
      sourceMembers: members,
      decodedSplatCount: 6_019_684,
      warmupFrameCount: 120,
      frameSampleCount: 600,
      frameMaxMs: 4,
      fixtureSettings: {
        camera: { position: camera.position, target: [...CANONICAL_CAMERA_TARGET], fov, near, far },
        group: { zUp: true, offset: [0, 0, 0] },
        renderer: {
          dpr: 1,
          antialias: false,
          fixedCamera: true,
          transparent: true,
          depthWrite: false,
        },
      },
      sparkRuntimeState: {
        activeSplats: 6_019_684,
        maxSplats: 6_019_685,
        sorting: false,
        sortDirty: false,
        dirty: false,
        maxStdDev: Math.sqrt(8),
        minPixelRadius: 0,
        maxPixelRadius: 512,
        minAlpha: 0.5 / 255,
        enable2DGS: false,
        preBlurAmount: 0,
        blurAmount: 0.3,
        focalDistance: 0,
        apertureAngle: 0,
        falloff: 1,
        clipXY: 1.4,
        focalAdjustment: 1,
        encodeLinear: false,
        sortRadial: true,
        minSortIntervalMs: 0,
        enableLod: true,
        enableDriveLod: true,
        enableLodFetching: true,
        lodSplatCount: null,
        lodSplatScale: 1,
        lodRenderScale: 1,
        lodInflate: false,
        pagedExtSplats: false,
        maxPagedSplats: 16_777_216,
        numLodFetchers: 3,
      },
      actualCamera: {
        position: camera.position,
        quaternion: camera.quaternion,
        projectionMatrix: camera.projectionMatrix,
        fov,
        near,
        far,
      },
      actualRenderer: { toneMapping: "NoToneMapping", outputColorSpace: "srgb" },
    }],
  };
}

function plyRecordFor(input: {
  readonly capture: Omit<CaptureReceipt, "recordPath" | "recordSha256" | "screenshotPath" | "screenshotSha256">;
  readonly screenshotName: string;
  readonly screenshotBytes: Buffer;
  readonly profileSha256: string;
  readonly cameraSha256: string;
  readonly hardware: HardwareProfile;
  readonly coverage: { readonly count: number; readonly ratio: number };
}) {
  const base = recordFor({ ...input, representation: "sog" });
  const baseRepresentation = base.representations[0];
  if (baseRepresentation === undefined) throw new Error("Synthetic base representation missing.");
  const members = sourceMembers("ply", 1, 1_185_642);
  const member = members[0];
  if (member === undefined) throw new Error("Synthetic PLY member missing.");
  const runLabel = input.capture.residencyState === "cold_load"
    ? "cold-load-1"
    : `resident-capture-${String(input.capture.residencyRunOrdinal)}`;
  const residency = {
    representation: "ply",
    runOrdinal: input.capture.runOrdinal,
    residencyState: input.capture.residencyState,
    residencyRunOrdinal: input.capture.residencyRunOrdinal,
    sourceRequestCountBefore: input.capture.sourceRequestCountBefore,
    sourceRequestCountAfter: input.capture.sourceRequestCountAfter,
    runtimeInstanceId: input.capture.runtimeInstanceId,
    renderedFrameCountBefore: input.capture.renderedFrameCountBefore,
    renderedFrameCountAfter: input.capture.renderedFrameCountAfter,
    browserProcessScope: "one_representation_one_cold_load_plus_three_resident_captures",
  };
  return {
    ...base,
    benchmarkId: `grand-hall-ply-source-pose-local-${runLabel}-structural-diagnostic-controlled-120w-600f-v1`,
    rendererSettings: {
      renderer: "Three.js 0.180 / PLYLoader / MeshNormalMaterial",
      antialias: false,
      transparent: false,
      depthWrite: true,
      maxSplats: "not_applicable_structural_mesh",
      maxStdDev: "not_applicable_structural_mesh",
      minAlpha: "not_applicable_structural_mesh",
      preBlurAmount: "not_applicable_structural_mesh",
      blurAmount: "not_applicable_structural_mesh",
      focalAdjustment: "not_applicable_structural_mesh",
      toneMapping: "NoToneMapping",
      outputColorSpace: "srgb",
    },
    representations: [{
      ...baseRepresentation,
      id: "supplied-ply-mesh",
      format: "ply_mesh",
      lineage: "Synthetic structural-only PLY fixture",
      rendererProfile: "controlled_explicit",
      sourceRefs: [member.sha256],
      limitations: [
        `VENVIEWER_SHARED_CAMERA_PROFILE_V1:${JSON.stringify({
          profileId: CAMERA_ID,
          relativePath: "tools/reconstruction-foundry/native/grand-hall-lcc-native-capture/camera-profile.json",
          sha256: input.cameraSha256,
        })}`,
        `VENVIEWER_BROWSER_SOURCE_RESIDENCY_V1:${JSON.stringify(residency)}`,
        `VENVIEWER_BROWSER_HARDWARE_PREFLIGHT_V1:${JSON.stringify({
          profileSha256: input.profileSha256,
          completedBeforeSourceNavigation: true,
          browserVersion: input.hardware.browserVersion,
        })}`,
      ],
      screenshot: {
        ...baseRepresentation.screenshot,
        path: `Z:\\relocated\\ply\\${input.screenshotName}`,
        sha256: hash(input.screenshotBytes),
        sizeBytes: input.screenshotBytes.length,
        nonBackgroundPixelCount: input.coverage.count,
        nonBackgroundPixelRatio: input.coverage.ratio,
      },
      sourceMembers: members,
      decodedSplatCount: undefined,
      sparkRuntimeState: undefined,
      fixtureSettings: {
        ...baseRepresentation.fixtureSettings,
        renderer: {
          dpr: 1,
          antialias: false,
          fixedCamera: true,
          transparent: false,
          depthWrite: true,
        },
      },
      plyMeshRuntimeState: {
        sourceSizeBytes: member.sizeBytes,
        sourceSha256: member.sha256,
        header: {
          encoding: "binary_little_endian",
          version: "1.0",
          vertexCount: 3,
          faceCount: 1,
          vertexProperties: ["float x", "float y", "float z"],
          faceList: { countType: "uchar", itemType: "uint", name: "vertex_indices" },
        },
        loader: { implementation: "three/addons/loaders/PLYLoader.js", version: "0.180.0" },
        geometry: {
          indexed: true,
          positionCount: 3,
          positionItemSize: 3,
          positionArrayType: "Float32Array",
          indexCount: 3,
          indexArrayType: "Uint16Array",
          triangleCount: 1,
          degenerateTriangleCount: 0,
          degenerateTriangleCriterion: "exact_cross_product_squared_equals_zero",
          nonFinitePositionScalarCount: 0,
          outOfRangeIndexCount: 0,
          sourceAttributes: ["position"],
          derivedAttributes: ["normal"],
          localBounds: { min: [0, 0, 0], max: [1, 1, 0] },
        },
        material: {
          type: "MeshNormalMaterial",
          side: "FrontSide",
          flatShading: true,
          transparent: false,
          depthTest: true,
          depthWrite: true,
          toneMapped: false,
        },
        frustumCulled: true,
        provenance: {
          truthClass: "RECONSTRUCTED",
          byteTreatment: "source_bytes_unchanged",
          geometryRole: "structural_evidence_only",
          appearanceRole: "deterministic_debug_visualization_not_source_appearance",
          registrationAuthority: "inspection_only",
        },
      },
    }],
  };
}

function captureBase(
  representation: "sog" | "spz" | "ply",
  runOrdinal: number,
): Omit<CaptureReceipt, "recordPath" | "recordSha256" | "screenshotPath" | "screenshotSha256"> {
  const isCold = runOrdinal === 1;
  const memberCount = representation === "ply" ? 1 : 11;
  const residencyRunOrdinal = isCold ? 1 : runOrdinal - 1;
  const frameStart = 22 + (runOrdinal - 1) * 720;
  return {
    runOrdinal,
    residencyState: isCold ? "cold_load" : "resident",
    residencyRunOrdinal,
    sourceRequestCountBefore: isCold ? 0 : memberCount,
    sourceRequestCountAfter: memberCount,
    runtimeInstanceId: `${representation}-runtime-instance`,
    renderedFrameCountBefore: frameStart,
    renderedFrameCountAfter: frameStart + 720,
  };
}

function stem(representation: "sog" | "spz" | "ply", capture: ReturnType<typeof captureBase>) {
  const runLabel = capture.residencyState === "cold_load"
    ? "cold-load-1"
    : `resident-capture-${String(capture.residencyRunOrdinal)}`;
  return `grand-hall-${representation}-${CAMERA_ID}-${runLabel}-${representation === "ply" ? "structural-diagnostic" : "diagnostic"}-controlled-120w-600f`;
}

async function writeSyntheticBundle(input: {
  readonly sogPng: Buffer;
  readonly spzPng: Buffer;
  readonly plyPng?: Buffer;
}): Promise<SyntheticBundle> {
  const parent = await mkdtemp(join(tmpdir(), "visible-first-comparison-test-"));
  cleanupRoots.push(parent);
  const root = resolve(parent, "bundle");
  await mkdir(root);
  for (const lane of ["sog", "spz", "ply"] as const) await mkdir(join(root, lane));

  const hardwareCandidate: HardwareCandidate = {
    candidateId: "chrome-stable-headless-d3d11",
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    launchArgs: LAUNCH_ARGS,
  };
  const hardwareEvidence: HardwareEvidence = {
    browserVersion: "151.0.0.0",
    userAgent: "Synthetic Chrome 151 hardware-v3",
    webglVendor: "Google Inc. (NVIDIA)",
    webglRenderer: "ANGLE (NVIDIA GeForce RTX 4090 Direct3D11)",
    webglVersion: "WebGL 2.0",
    contextLost: false,
    probeDurationMs: 20,
  };
  const hardware: HardwareProfile = {
    schemaVersion: "venviewer.grand-hall.hardware-browser-profile.v1",
    ...hardwareCandidate,
    ...hardwareEvidence,
  };
  const profileSha256 = hash(Buffer.from(JSON.stringify(hardware), "utf8"));
  const cameraBytes = await readFile(CANONICAL_CAMERA_PATH);
  const cameraSha256 = hash(cameraBytes);
  expect(cameraSha256).toBe(CANONICAL_CAMERA_SHA256);
  const cameraName = `${CAMERA_ID}-${cameraSha256.slice("sha256:".length)}.json`;
  await writeFile(join(root, cameraName), cameraBytes);

  const pngByLane = {
    sog: input.sogPng,
    spz: input.spzPng,
    ply: input.plyPng ?? input.sogPng,
  };
  const coverageByLane = {
    sog: await coverageFromPng(pngByLane.sog),
    spz: await coverageFromPng(pngByLane.spz),
    ply: await coverageFromPng(pngByLane.ply),
  };
  const lanes: LaneReceipt[] = [];
  for (const [laneIndex, representation] of (["sog", "spz", "ply"] as const).entries()) {
    const captures: CaptureReceipt[] = [];
    for (let runOrdinal = 1; runOrdinal <= 4; runOrdinal += 1) {
      const base = captureBase(representation, runOrdinal);
      const captureStem = stem(representation, base);
      const recordName = `${captureStem}.json`;
      const screenshotName = `${captureStem}.png`;
      const screenshotBytes = pngByLane[representation];
      const record = representation === "ply"
        ? plyRecordFor({
          capture: base,
          screenshotName,
          screenshotBytes,
          profileSha256,
          cameraSha256,
          hardware,
          coverage: coverageByLane.ply,
        })
        : recordFor({
          representation,
          capture: base,
          screenshotName,
          screenshotBytes,
          profileSha256,
          cameraSha256,
          hardware,
          coverage: coverageByLane[representation],
        });
      const recordBytes = jsonBytes(record);
      await writeFile(join(root, representation, recordName), recordBytes);
      await writeFile(join(root, representation, screenshotName), screenshotBytes);
      captures.push({
        ...base,
        recordPath: `Z:\\relocated\\${representation}\\${recordName}`,
        recordSha256: hash(recordBytes),
        screenshotPath: `Z:\\relocated\\${representation}\\${screenshotName}`,
        screenshotSha256: hash(screenshotBytes),
      });
    }
    lanes.push({
      representation,
      runnerPid: 10_000 + laneIndex,
      baseUrl: `http://127.0.0.1:${String(5_195 + laneIndex)}`,
      browserProfileSha256: profileSha256,
      radianceRankingEligible: representation !== "ply",
      captures,
    });
  }

  const receipt: SyntheticReceipt = {
    schemaVersion: "venviewer.grand-hall.visible-first-browser-bakeoff.v3",
    authority: "none",
    gitSha: GIT_SHA,
    worktreeDirty: false,
    startedAt: "2026-08-31T10:00:00.000Z",
    completedAt: "2026-08-31T10:10:00.000Z",
    cameraProfile: {
      profileId: CAMERA_ID,
      sourcePath: "tools/reconstruction-foundry/native/grand-hall-lcc-native-capture/camera-profile.json",
      artifactPath: `Z:\\relocated\\${cameraName}`,
      sha256: cameraSha256,
      target: [...CANONICAL_CAMERA_TARGET],
    },
    processIsolation: "one_fresh_playwright_and_browser_process_per_representation",
    browserHardwarePreflight: {
      profileSha256,
      selectedProfile: hardware,
      attempts: [{ candidate: hardwareCandidate, outcome: "selected_hardware", evidence: hardwareEvidence }],
      completedBeforeEvidenceDirectoryCreation: true,
    },
    executionOrder: ["sog", "spz", "ply"],
    radianceRankingEligibleRepresentations: ["sog", "spz"],
    structuralOnlyRepresentations: ["ply"],
    lanes,
    limitations: [
      "The shared camera is inspection-only, not a recovered optical camera.",
      "PLY is reconstructed structural evidence and is excluded from radiance ranking.",
      "Each representation receives one cold source navigation/load and four total captures from one live fixture runtime. The following three resident captures perform no navigation, source fetch, decode, or scene attachment. They measure visual and frame-time stability of the long-lived decoded runtime; they do not claim HTTP-cache reload performance.",
      "No human visual acceptance, winner selection, room admission, staging, deployment, or production authority is granted.",
    ],
  };
  const receiptPath = resolve(root, "visible-first-browser-bakeoff-receipt.json");
  await writeFile(receiptPath, jsonBytes(receipt));
  return { root, receiptPath, receipt };
}

async function rewriteReceipt(bundle: SyntheticBundle): Promise<void> {
  await writeFile(bundle.receiptPath, jsonBytes(bundle.receipt));
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function declaredFileName(path: string): string {
  const name = path.replaceAll("/", "\\").split("\\").at(-1);
  if (name === undefined || name.length === 0) throw new Error("Declared file path has no name.");
  return name;
}

async function rewriteCaptureRecord(
  bundle: SyntheticBundle,
  lane: LaneReceipt,
  capture: CaptureReceipt,
  mutate: (record: Record<string, unknown>) => void,
): Promise<void> {
  const path = join(bundle.root, lane.representation, declaredFileName(capture.recordPath));
  const parsed = recordValue(JSON.parse(await readFile(path, "utf8")) as unknown, "Capture record");
  mutate(parsed);
  const bytes = jsonBytes(parsed);
  await writeFile(path, bytes);
  capture.recordSha256 = hash(bytes);
}

function metrics(receipt: unknown): Readonly<Record<string, unknown>> {
  if (typeof receipt !== "object" || receipt === null || !("metrics" in receipt)) {
    throw new Error("Expected metrics in comparison receipt.");
  }
  const value = receipt.metrics;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Metrics must be an object.");
  return value as Readonly<Record<string, unknown>>;
}

async function readOutputReceipt(output: string): Promise<unknown> {
  return JSON.parse(await readFile(join(output, GRAND_HALL_VISIBLE_FIRST_COMPARISON_RECEIPT_FILENAME), "utf8")) as unknown;
}

function uniformRgb(red = 16, green = 18, blue = 23): Buffer {
  const bytes = Buffer.allocUnsafe(PIXEL_BYTES);
  for (let offset = 0; offset < bytes.length; offset += 3) {
    bytes[offset] = red;
    bytes[offset + 1] = green;
    bytes[offset + 2] = blue;
  }
  bytes[0] = 30;
  return bytes;
}

describe("Grand Hall visible-first radiance comparison", () => {
  it("emits exact symmetric metrics and x8 pixels for a one-sample difference", async () => {
    const sogRaw = uniformRgb();
    const spzRaw = Buffer.from(sogRaw);
    spzRaw[0] = (spzRaw[0] ?? 0) + 40;
    const bundle = await writeSyntheticBundle({ sogPng: await pngFromRgb(sogRaw), spzPng: await pngFromRgb(spzRaw) });
    const output = resolve(join(bundle.root, "..", "one-pixel-output"));

    const receipt = await writeGrandHallVisibleFirstRadianceComparison(bundle.receiptPath, output);
    const values = metrics(receipt);
    expect(values["exactEquality"]).toBe(false);
    expect(values["changedPixels"]).toBe(1);
    expect(values["changedRgbSamples"]).toBe(1);
    expect(values["aggregateMeanAbsoluteErrorBytes"]).toBe(40 / PIXEL_BYTES);
    expect(values["meanSquaredErrorBytesSquared"]).toBe(1_600 / PIXEL_BYTES);
    expect(values["rootMeanSquaredErrorBytes"]).toBe(Math.sqrt(1_600 / PIXEL_BYTES));
    expect(values["maximumChannelDelta"]).toBe(40);
    expect(values["differenceX8ClippedRgbSampleCount"]).toBe(1);

    const diff = await sharp(join(output, GRAND_HALL_VISIBLE_FIRST_DIFFERENCE_FILENAME)).raw().toBuffer();
    expect([...diff.subarray(0, 6)]).toEqual([255, 0, 0, 0, 0, 0]);
    const side = await sharp(join(output, GRAND_HALL_VISIBLE_FIRST_SIDE_BY_SIDE_FILENAME)).raw().toBuffer({ resolveWithObject: true });
    expect(side.info.width).toBe(WIDTH * 2 + 8);
    const gapOffset = WIDTH * 3;
    expect([...side.data.subarray(gapOffset, gapOffset + 3)]).toEqual([8, 10, 14]);
    const rightOffset = (WIDTH + 8) * 3;
    expect([...side.data.subarray(rightOffset, rightOffset + 3)]).toEqual([70, 18, 23]);
  });

  it("represents exact equality with zero errors and nullable PSNR", async () => {
    const png = await pngFromRgb(uniformRgb());
    const bundle = await writeSyntheticBundle({ sogPng: png, spzPng: png });
    const output = resolve(join(bundle.root, "..", "identical-output"));
    await writeGrandHallVisibleFirstRadianceComparison(bundle.receiptPath, output);
    const outputReceipt = await readOutputReceipt(output);
    const values = metrics(outputReceipt);
    expect(values).toMatchObject({
      exactEquality: true,
      changedPixels: 0,
      changedRgbSamples: 0,
      aggregateMeanAbsoluteErrorBytes: 0,
      meanSquaredErrorBytesSquared: 0,
      rootMeanSquaredErrorBytes: 0,
      peakSignalToNoiseRatioDb: null,
      maximumChannelDelta: 0,
      differenceX8ClippedRgbSampleCount: 0,
    });
    expect(outputReceipt).toMatchObject({
      authority: "none",
      comparisonKind: "symmetric_representation_disagreement",
      decisionStatus: "not_evaluated",
      winner: null,
      visualAcceptance: "not_reviewed",
      rankingPermitted: false,
      sourceFidelityReferenceAvailable: false,
      humanReviewRequired: true,
      outputInventory: [
        GRAND_HALL_VISIBLE_FIRST_SIDE_BY_SIDE_FILENAME,
        GRAND_HALL_VISIBLE_FIRST_DIFFERENCE_FILENAME,
        GRAND_HALL_VISIBLE_FIRST_COMPARISON_RECEIPT_FILENAME,
      ],
    });
    expect(await readdir(output)).toHaveLength(3);
  });

  it("rejects persisted path traversal and cross-lane hash substitution", async () => {
    const sogPng = await pngFromRgb(uniformRgb());
    const spzPng = await pngFromRgb(uniformRgb(17, 18, 23));
    const escaped = await writeSyntheticBundle({ sogPng, spzPng });
    const sogCapture = escaped.receipt.lanes[0]?.captures[0];
    if (sogCapture === undefined) throw new Error("Synthetic SOG capture missing.");
    sogCapture.recordPath = `Z:\\relocated\\sog\\..\\${sogCapture.recordPath.split("\\").at(-1) ?? "missing"}`;
    await rewriteReceipt(escaped);
    await expect(writeGrandHallVisibleFirstRadianceComparison(
      escaped.receiptPath,
      resolve(join(escaped.root, "..", "escaped-output")),
    )).rejects.toMatchObject({ code: "PATH_ESCAPE" });

    const substituted = await writeSyntheticBundle({ sogPng, spzPng });
    const left = substituted.receipt.lanes[0]?.captures[0];
    const right = substituted.receipt.lanes[1]?.captures[0];
    if (left === undefined || right === undefined) throw new Error("Synthetic captures missing.");
    left.screenshotSha256 = right.screenshotSha256;
    await rewriteReceipt(substituted);
    await expect(writeGrandHallVisibleFirstRadianceComparison(
      substituted.receiptPath,
      resolve(join(substituted.root, "..", "substitution-output")),
    )).rejects.toMatchObject({ code: "HASH_MISMATCH" });
  });

  it("rejects an internally consistent SPZ renderer drift from the SOG capture state", async () => {
    const png = await pngFromRgb(uniformRgb());
    const bundle = await writeSyntheticBundle({ sogPng: png, spzPng: png });
    const spzLane = bundle.receipt.lanes[1];
    if (spzLane === undefined) throw new Error("Synthetic SPZ lane missing.");
    for (const capture of spzLane.captures) {
      await rewriteCaptureRecord(bundle, spzLane, capture, (record) => {
        recordValue(record["rendererSettings"], "Renderer settings")["renderer"] = "Drifted Spark renderer";
      });
    }
    await rewriteReceipt(bundle);
    await expect(writeGrandHallVisibleFirstRadianceComparison(
      bundle.receiptPath,
      resolve(join(bundle.root, "..", "renderer-drift-output")),
    )).rejects.toMatchObject({ code: "CAPTURE_STATE_MISMATCH" });
  });

  it("rejects a fully hash- and marker-rebound camera artifact that drifts from the captures", async () => {
    const png = await pngFromRgb(uniformRgb());
    const bundle = await writeSyntheticBundle({ sogPng: png, spzPng: png });
    const oldCameraName = declaredFileName(bundle.receipt.cameraProfile.artifactPath);
    const oldCameraPath = join(bundle.root, oldCameraName);
    const camera = recordValue(JSON.parse(await readFile(oldCameraPath, "utf8")) as unknown, "Camera profile");
    const frames = recordValue(camera["frames"], "Camera frames");
    recordValue(frames["three"], "Three.js camera frame")["position"] = [1, 0, 5];
    const reboundBytes = jsonBytes(camera);
    const reboundSha256 = hash(reboundBytes);
    const reboundName = `${CAMERA_ID}-${reboundSha256.slice("sha256:".length)}.json`;
    await writeFile(join(bundle.root, reboundName), reboundBytes);
    await rm(oldCameraPath);
    bundle.receipt.cameraProfile.artifactPath = `Z:\\relocated\\${reboundName}`;
    bundle.receipt.cameraProfile.sha256 = reboundSha256;
    for (const lane of bundle.receipt.lanes) {
      for (const capture of lane.captures) {
        await rewriteCaptureRecord(bundle, lane, capture, (record) => {
          const representation = recordValue(arrayValue(record["representations"], "Representations")[0], "Representation");
          const limitations = arrayValue(representation["limitations"], "Limitations");
          representation["limitations"] = limitations.map((limitation) => {
            if (typeof limitation !== "string" || !limitation.startsWith("VENVIEWER_SHARED_CAMERA_PROFILE_V1:")) return limitation;
            const marker = recordValue(JSON.parse(limitation.slice("VENVIEWER_SHARED_CAMERA_PROFILE_V1:".length)) as unknown, "Camera marker");
            marker["sha256"] = reboundSha256;
            return `VENVIEWER_SHARED_CAMERA_PROFILE_V1:${JSON.stringify(marker)}`;
          });
        });
      }
    }
    await rewriteReceipt(bundle);
    await expect(writeGrandHallVisibleFirstRadianceComparison(
      bundle.receiptPath,
      resolve(join(bundle.root, "..", "camera-rebound-output")),
    )).rejects.toMatchObject({ code: "BAKEOFF_RECEIPT_INVALID" });
  });

  it("rejects a fully rebound resident screenshot that diverges within one lane", async () => {
    const png = await pngFromRgb(uniformRgb());
    const divergentPng = await pngFromRgb(uniformRgb(80, 90, 100));
    const divergentCoverage = await coverageFromPng(divergentPng);
    const bundle = await writeSyntheticBundle({ sogPng: png, spzPng: png });
    const spzLane = bundle.receipt.lanes[1];
    const capture = spzLane?.captures[1];
    if (spzLane === undefined || capture === undefined) throw new Error("Synthetic resident SPZ capture missing.");
    const screenshotPath = join(bundle.root, "spz", declaredFileName(capture.screenshotPath));
    await writeFile(screenshotPath, divergentPng);
    capture.screenshotSha256 = hash(divergentPng);
    await rewriteCaptureRecord(bundle, spzLane, capture, (record) => {
      const representation = recordValue(arrayValue(record["representations"], "Representations")[0], "Representation");
      const screenshot = recordValue(representation["screenshot"], "Screenshot");
      screenshot["sha256"] = hash(divergentPng);
      screenshot["sizeBytes"] = divergentPng.length;
      screenshot["nonBackgroundPixelCount"] = divergentCoverage.count;
      screenshot["nonBackgroundPixelRatio"] = divergentCoverage.ratio;
    });
    await rewriteReceipt(bundle);
    await expect(writeGrandHallVisibleFirstRadianceComparison(
      bundle.receiptPath,
      resolve(join(bundle.root, "..", "resident-divergence-output")),
    )).rejects.toMatchObject({ code: "RESIDENCY_INVALID" });
  });

  it("rejects both a v2 receipt and a dirty v3 receipt", async () => {
    const png = await pngFromRgb(uniformRgb());
    const v2 = await writeSyntheticBundle({ sogPng: png, spzPng: png });
    (v2.receipt as { schemaVersion: string }).schemaVersion = "venviewer.grand-hall.visible-first-browser-bakeoff.v2";
    await rewriteReceipt(v2);
    await expect(writeGrandHallVisibleFirstRadianceComparison(
      v2.receiptPath,
      resolve(join(v2.root, "..", "v2-output")),
    )).rejects.toMatchObject({ code: "BAKEOFF_RECEIPT_INVALID" });

    const dirty = await writeSyntheticBundle({ sogPng: png, spzPng: png });
    dirty.receipt.worktreeDirty = true;
    await rewriteReceipt(dirty);
    await expect(writeGrandHallVisibleFirstRadianceComparison(
      dirty.receiptPath,
      resolve(join(dirty.root, "..", "dirty-output")),
    )).rejects.toMatchObject({ code: "BAKEOFF_RECEIPT_INVALID" });
  });

  it("rejects an internally hash-bound alpha image before producing output", async () => {
    const rgba = Buffer.alloc(WIDTH * HEIGHT * 4, 255);
    const rgbaPng = await pngFromRgba(rgba);
    const rgbPng = await pngFromRgb(uniformRgb());
    const bundle = await writeSyntheticBundle({ sogPng: rgbaPng, spzPng: rgbPng });
    const output = resolve(join(bundle.root, "..", "bad-image-output"));
    await expect(writeGrandHallVisibleFirstRadianceComparison(bundle.receiptPath, output))
      .rejects.toMatchObject({ code: "IMAGE_INVALID" });
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("detects a published output target swap and preserves the replacement", async () => {
    const png = await pngFromRgb(uniformRgb());
    const bundle = await writeSyntheticBundle({ sogPng: png, spzPng: png });
    const output = resolve(join(bundle.root, "..", "target-swap-output"));
    const displaced = `${output}-displaced`;
    await expect(writeGrandHallVisibleFirstRadianceComparison(bundle.receiptPath, output, {
      testHooks: {
        afterPublishedIdentityRead: async ({ targetDirectory }) => {
          await rename(targetDirectory, displaced);
          await mkdir(targetDirectory);
          await writeFile(join(targetDirectory, "intruder.txt"), "preserve me", "utf8");
        },
      },
    })).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });
    expect(await readFile(join(output, "intruder.txt"), "utf8")).toBe("preserve me");
    expect(await readdir(displaced)).toHaveLength(3);
  });

  it("is create-only, checks without writes, and regenerates deterministically", async () => {
    const sogRaw = uniformRgb();
    const spzRaw = uniformRgb(40, 50, 60);
    const bundle = await writeSyntheticBundle({ sogPng: await pngFromRgb(sogRaw), spzPng: await pngFromRgb(spzRaw) });
    const outputA = resolve(join(bundle.root, "..", "deterministic-a"));
    const outputB = resolve(join(bundle.root, "..", "deterministic-b"));
    await writeGrandHallVisibleFirstRadianceComparison(bundle.receiptPath, outputA);
    await expect(writeGrandHallVisibleFirstRadianceComparison(bundle.receiptPath, outputA))
      .rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
    const names = await readdir(outputA);
    const before = await Promise.all(names.map(async (name) => ({
      name,
      bytes: await readFile(join(outputA, name)),
      modifiedAt: (await stat(join(outputA, name))).mtimeMs,
    })));
    await checkGrandHallVisibleFirstRadianceComparison(bundle.receiptPath, outputA);
    const after = await Promise.all(names.map(async (name) => ({
      name,
      bytes: await readFile(join(outputA, name)),
      modifiedAt: (await stat(join(outputA, name))).mtimeMs,
    })));
    expect(after).toEqual(before);

    await writeGrandHallVisibleFirstRadianceComparison(bundle.receiptPath, outputB);
    expect(await readdir(outputA)).toEqual(await readdir(outputB));
    for (const name of names) {
      expect(await readFile(join(outputA, name))).toEqual(await readFile(join(outputB, name)));
    }
    const serialized = await readFile(join(outputA, GRAND_HALL_VISIBLE_FIRST_COMPARISON_RECEIPT_FILENAME), "utf8");
    expect(serialized).toBe(`${stableCanonicalJson(toCanonicalJson(JSON.parse(serialized) as unknown))}\n`);
    expect(serialized).not.toContain(outputA);
    expect(serialized).not.toContain(outputB);
  });

  it("parses and runs the exact write/check CLI forms", async () => {
    const png = await pngFromRgb(uniformRgb());
    const bundle = await writeSyntheticBundle({ sogPng: png, spzPng: png });
    const output = resolve(join(bundle.root, "..", "cli-output"));
    expect(parseGrandHallVisibleFirstRadianceComparisonArguments([
      "write",
      "--bakeoff-receipt",
      bundle.receiptPath,
      "--output",
      output,
    ])).toEqual({ mode: "write", bakeoffReceiptPath: bundle.receiptPath, outputDirectory: output });
    expect(() => parseGrandHallVisibleFirstRadianceComparisonArguments([
      "write",
      "--output",
      output,
    ])).toThrow(GrandHallVisibleFirstComparisonError);

    expect(JSON.parse(await runGrandHallVisibleFirstRadianceComparisonCli([
      "write",
      "--bakeoff-receipt",
      bundle.receiptPath,
      "--output",
      output,
    ]))).toMatchObject({ mode: "write", authority: "none", decisionStatus: "not_evaluated" });
    expect(JSON.parse(await runGrandHallVisibleFirstRadianceComparisonCli([
      "check",
      "--bakeoff-receipt",
      bundle.receiptPath,
      "--output",
      output,
    ]))).toMatchObject({ mode: "check", authority: "none", decisionStatus: "not_evaluated" });
  });
});
