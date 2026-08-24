import { describe, expect, it } from "vitest";
import {
  VISUAL_LINEAGE_BENCHMARK_V0_VERSION,
  VisualLineageBenchmarkV0Schema,
  type VisualLineageBenchmarkV0Input,
} from "../visual-lineage-benchmark.js";

function benchmark(): VisualLineageBenchmarkV0Input {
  return {
    schemaVersion: VISUAL_LINEAGE_BENCHMARK_V0_VERSION,
    benchmarkId: "grand-hall-lineage-v0",
    roomRef: "trades-hall/grand-hall",
    gitSha: "4c7a34bd7bbe77d16bf36c4c82354737073a497a",
    worktreeDirty: true,
    camera: {
      id: "grand-hall-inspection-overview-v0",
      revision: 0,
      sourceFrame: "THREE_CAMERA",
      position: [0, 18.50455324455698, 33.68793434824826],
      quaternion: [-0.18738131458572455, 0, 0, 0.9822872507286887],
      projection: "perspective",
      fov: 48,
      near: 0.1,
      far: 200,
      aspect: 16 / 9,
      projectionMatrix: [
        1.2633956853211212, 0, 0, 0,
        0, 2.2460367739042155, 0, 0,
        0, 0, -1.001000500250125, -1,
        0, 0, -0.2001000500250125, 0,
      ],
    },
    viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
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
    representations: [
      {
        id: "sog-exact-frontier",
        format: "sog",
        lineage: "Grand_Hall.lcc2/exact-fine-frontier",
        status: "not_run",
        visualAssessment: "not_reviewed",
        cameraRegistration: "inspection_only",
        rendererProfile: "diagnostic_unresolved_defaults",
        sourceRefs: ["sha256:8e7514e75aa19345dda1955f2cee3f9369339c553c2711c084cd04be4c9c1352"],
        limitations: ["Authenticated browser run not yet recorded."],
      },
    ],
  };
}

function firstRepresentation(input: VisualLineageBenchmarkV0Input) {
  const representation = input.representations[0];
  if (representation === undefined) throw new Error("Expected a first lineage representation.");
  return representation;
}

describe("VisualLineageBenchmarkV0Schema", () => {
  it("accepts an honest deterministic NOT RUN record", () => {
    const parsed = VisualLineageBenchmarkV0Schema.parse(benchmark());
    expect(parsed.representations[0]?.status).toBe("not_run");
    expect(parsed.camera.projectionMatrix).toHaveLength(16);
  });

  it("requires screenshot, timings, and environment before a representation can pass", () => {
    const input = benchmark();
    input.representations[0] = { ...firstRepresentation(input), status: "passed" };
    expect(VisualLineageBenchmarkV0Schema.safeParse(input).success).toBe(false);
  });

  it("accepts an explicitly limited dirty-worktree diagnostic record", () => {
    const input = benchmark();
    const camera = input.camera;
    input.runStartedAt = "2026-08-23T17:00:00.000Z";
    input.runCompletedAt = "2026-08-23T17:10:00.000Z";
    input.worktreeSourceStateSha256 = `sha256:${"a".repeat(64)}`;
    input.representations[0] = {
      ...firstRepresentation(input),
      status: "diagnostic",
      sourceRefs: [`sha256:${"d".repeat(64)}`],
      warmupFrameCount: 0,
      frameSampleCount: 12,
      frameMaxMs: 4_000,
      sourceMembers: [{
        relativePath: "scans_BIG_MODEL_TH_GH_1/lcc2-result/data/3dgs/0_0_0_1_0_1.sog",
        sizeBytes: 100,
        sha256: `sha256:${"d".repeat(64)}`,
      }],
      decodedSplatCount: 1,
      screenshot: {
        path: "docs/evidence/grand-hall-sog.png",
        sha256: `sha256:${"c".repeat(64)}`,
        sizeBytes: 100,
        width: 1600,
        height: 900,
        backgroundRgb: [16, 18, 23],
        nonBackgroundPixelCount: 100,
        nonBackgroundPixelRatio: 100 / (1600 * 900),
      },
      timings: {
        loadMs: 10,
        stableMs: 20,
        frameP50Ms: 30,
        frameP95Ms: 40,
        frameP99Ms: 50,
      },
      environment: {
        browser: "Chromium",
        operatingSystem: "Windows",
        webglVendor: "Vendor",
        webglRenderer: "Renderer",
        webglVersion: "WebGL 2",
        contextLost: false,
      },
      actualRenderer: {
        toneMapping: "NoToneMapping",
        outputColorSpace: "srgb",
      },
      fixtureSettings: {
        camera: {
          position: camera.position,
          target: [0, 0, 0],
          fov: camera.fov,
          near: camera.near,
          far: camera.far,
        },
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
        activeSplats: 1,
        maxSplats: 1,
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
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
      },
    };

    expect(VisualLineageBenchmarkV0Schema.parse(input).representations[0]?.status).toBe("diagnostic");
  });

  it("rejects incoherent camera and completed-render evidence", () => {
    const cameraInput = benchmark();
    cameraInput.camera = {
      ...cameraInput.camera,
      quaternion: [0, 0, 0, 0],
    };
    expect(VisualLineageBenchmarkV0Schema.safeParse(cameraInput).success).toBe(false);

    const completedInput = benchmark();
    completedInput.runStartedAt = "2026-08-23T17:00:00.000Z";
    completedInput.runCompletedAt = "2026-08-23T17:10:00.000Z";
    completedInput.representations[0] = {
      ...firstRepresentation(completedInput),
      format: "lcc",
      status: "diagnostic",
      cameraRegistration: "unavailable",
      rendererProfile: "unavailable",
      visualAssessment: "not_reviewed",
      screenshot: {
        path: "docs/evidence/grand-hall-lcc.png",
        sha256: `sha256:${"e".repeat(64)}`,
        sizeBytes: 100,
        width: 800,
        height: 450,
        backgroundRgb: [16, 18, 23],
        nonBackgroundPixelCount: 100,
        nonBackgroundPixelRatio: 100 / (800 * 450),
      },
      timings: {
        loadMs: 10,
        stableMs: 20,
        frameP50Ms: 30,
        frameP95Ms: 20,
        frameP99Ms: 10,
      },
      environment: {
        browser: "Chromium",
        operatingSystem: "Windows",
        webglVendor: "Vendor",
        webglRenderer: "Renderer",
        webglVersion: "WebGL 2",
        contextLost: true,
      },
    };
    expect(VisualLineageBenchmarkV0Schema.safeParse(completedInput).success).toBe(false);
  });

  it("binds completed member receipts and passed renderer settings to observed state", () => {
    const input = benchmark();
    const camera = input.camera;
    const memberSha = `sha256:${"d".repeat(64)}`;
    input.worktreeDirty = false;
    input.runStartedAt = "2026-08-23T17:00:00.000Z";
    input.runCompletedAt = "2026-08-23T17:10:00.000Z";
    input.rendererSettings = {
      ...input.rendererSettings,
      maxSplats: 1,
      maxStdDev: Math.sqrt(8),
      minAlpha: 0.5 / 255,
      preBlurAmount: 0,
      blurAmount: 0.3,
      focalAdjustment: 1,
    };
    input.representations[0] = {
      ...firstRepresentation(input),
      status: "passed",
      visualAssessment: "reviewed_accepted",
      cameraRegistration: "reviewed_matched",
      rendererProfile: "controlled_explicit",
      sourceRefs: [memberSha],
      sourceMembers: [{ relativePath: "member.sog", sizeBytes: 100, sha256: memberSha }],
      decodedSplatCount: 1,
      warmupFrameCount: 120,
      frameSampleCount: 600,
      frameMaxMs: 50,
      screenshot: {
        path: "docs/evidence/grand-hall-sog.png",
        sha256: `sha256:${"c".repeat(64)}`,
        sizeBytes: 100,
        width: 1600,
        height: 900,
        backgroundRgb: [16, 18, 23],
        nonBackgroundPixelCount: 100,
        nonBackgroundPixelRatio: 100 / (1600 * 900),
      },
      timings: { loadMs: 10, stableMs: 20, frameP50Ms: 30, frameP95Ms: 40, frameP99Ms: 50 },
      environment: {
        browser: "Chromium",
        operatingSystem: "Windows",
        webglVendor: "Vendor",
        webglRenderer: "Renderer",
        webglVersion: "WebGL 2",
        contextLost: false,
      },
      fixtureSettings: {
        camera: {
          position: camera.position,
          target: [0, 0, 0],
          fov: camera.fov,
          near: camera.near,
          far: camera.far,
        },
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
        activeSplats: 1,
        maxSplats: 1,
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
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
      },
      actualRenderer: { toneMapping: "NoToneMapping", outputColorSpace: "srgb" },
    };
    expect(VisualLineageBenchmarkV0Schema.safeParse(input).success).toBe(true);

    const validRepresentation = firstRepresentation(input);
    const validMember = validRepresentation.sourceMembers?.[0];
    const validSparkState = validRepresentation.sparkRuntimeState;
    if (validMember === undefined || validSparkState === undefined) {
      throw new Error("Expected completed splat evidence fixtures.");
    }

    input.representations[0] = {
      ...validRepresentation,
      sourceRefs: [memberSha, memberSha],
    };
    expect(VisualLineageBenchmarkV0Schema.safeParse(input).success).toBe(false);

    input.representations[0] = {
      ...validRepresentation,
      sourceRefs: [memberSha, `sha256:${"e".repeat(64)}`],
      sourceMembers: [
        validMember,
        { ...validMember, sha256: `sha256:${"e".repeat(64)}` },
      ],
    };
    expect(VisualLineageBenchmarkV0Schema.safeParse(input).success).toBe(false);

    input.representations[0] = {
      ...validRepresentation,
      sparkRuntimeState: { ...validSparkState, dirty: true },
    };
    expect(VisualLineageBenchmarkV0Schema.safeParse(input).success).toBe(false);

    input.representations[0] = {
      ...validRepresentation,
      sourceRefs: [`sha256:${"e".repeat(64)}`],
    };
    expect(VisualLineageBenchmarkV0Schema.safeParse(input).success).toBe(false);

    input.representations[0] = {
      ...validRepresentation,
      sourceRefs: [memberSha],
    };
    input.rendererSettings = { ...input.rendererSettings, blurAmount: 9 };
    expect(VisualLineageBenchmarkV0Schema.safeParse(input).success).toBe(false);
  });
});
