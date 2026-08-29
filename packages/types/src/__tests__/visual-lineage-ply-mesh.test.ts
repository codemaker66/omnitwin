import { describe, expect, it } from "vitest";
import { VisualLineageBenchmarkV0Schema } from "../visual-lineage-benchmark.js";

const SOURCE_SHA = `sha256:${"b".repeat(64)}`;

function validBenchmark() {
  const projectionMatrix = [
    0.9742785792574936, 0, 0, 0,
    0, 1.7320508075688774, 0, 0,
    0, 0, -1.0012507817385865, -1,
    0, 0, -0.10006253908692933, 0,
  ] as const;
  const camera = {
    id: "source-pose-19890-interior-v1",
    revision: 1,
    sourceFrame: "THREE_CAMERA" as const,
    position: [-0.03426186932373998, 2.15606153541565, 8.015104841842623] as const,
    quaternion: [0, -0.01170873415725777, 0, 0.999931450422695] as const,
    projection: "perspective" as const,
    fov: 60,
    near: 0.05,
    far: 80,
    aspect: 16 / 9,
    projectionMatrix,
  };
  return {
    schemaVersion: "visual-lineage-benchmark/v0" as const,
    benchmarkId: "grand-hall-ply-structural-v1",
    roomRef: "trades-hall/grand-hall",
    gitSha: "4c7a34bd7bbe77d16bf36c4c82354737073a497a",
    worktreeDirty: false,
    runStartedAt: "2026-08-29T10:00:00.000Z",
    runCompletedAt: "2026-08-29T10:01:00.000Z",
    camera,
    viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
    rendererSettings: {
      renderer: "Three.js 0.180 / PLYLoader / MeshNormalMaterial",
      antialias: false,
      transparent: false,
      depthWrite: true,
      maxSplats: "not_applicable",
      maxStdDev: "not_applicable",
      minAlpha: "not_applicable",
      preBlurAmount: "not_applicable",
      blurAmount: "not_applicable",
      focalAdjustment: "not_applicable",
      toneMapping: "NoToneMapping",
      outputColorSpace: "srgb",
    },
    representations: [{
      id: "supplied-ply-mesh",
      format: "ply_mesh" as const,
      lineage: "Exact supplied reconstructed triangle PLY; deterministic normal debug shading",
      status: "diagnostic" as const,
      visualAssessment: "not_reviewed" as const,
      cameraRegistration: "inspection_only" as const,
      rendererProfile: "controlled_explicit" as const,
      sourceRefs: [SOURCE_SHA],
      limitations: ["Structural evidence only; derived normal colours are not captured appearance."],
      screenshot: {
        path: "docs/evidence/grand-hall-ply.png",
        sha256: `sha256:${"c".repeat(64)}`,
        sizeBytes: 100,
        width: 1600,
        height: 900,
        backgroundRgb: [16, 18, 23] as const,
        nonBackgroundPixelCount: 100,
        nonBackgroundPixelRatio: 100 / (1600 * 900),
      },
      timings: { loadMs: 10, stableMs: 20, frameP50Ms: 30, frameP95Ms: 40, frameP99Ms: 50 },
      environment: {
        browser: "Chrome",
        operatingSystem: "Windows",
        webglVendor: "NVIDIA",
        webglRenderer: "RTX 4090",
        webglVersion: "WebGL 2",
        contextLost: false,
      },
      sourceMembers: [{
        relativePath: "scans_BIG_MODEL_TH_GH_3/mesh-files/Grand_Hall.ply",
        sizeBytes: 1_185_642,
        sha256: SOURCE_SHA,
      }],
      warmupFrameCount: 0,
      frameSampleCount: 1,
      frameMaxMs: 50,
      fixtureSettings: {
        camera: {
          position: camera.position,
          target: [0.15796363067625974, 2.15606153541565, -0.19184415815737577] as const,
          fov: camera.fov,
          near: camera.near,
          far: camera.far,
        },
        group: {
          zUp: true,
          offset: [4.74065113067626, 2.84312653541565, -8.584035158157375] as const,
        },
        renderer: {
          dpr: 1,
          antialias: false,
          fixedCamera: true,
          transparent: false,
          depthWrite: true,
        },
      },
      plyMeshRuntimeState: {
        sourceSizeBytes: 1_185_642,
        sourceSha256: SOURCE_SHA,
        header: {
          encoding: "binary_little_endian" as const,
          version: "1.0" as const,
          vertexCount: 34_040,
          faceCount: 59_763,
          vertexProperties: ["float x", "float y", "float z"] as const,
          faceList: { countType: "uchar" as const, itemType: "uint" as const, name: "vertex_indices" as const },
        },
        loader: { implementation: "three/addons/loaders/PLYLoader.js" as const, version: "0.180.0" },
        geometry: {
          indexed: true as const,
          positionCount: 34_040,
          positionItemSize: 3 as const,
          positionArrayType: "Float32Array" as const,
          indexCount: 179_289,
          indexArrayType: "Uint16Array" as const,
          triangleCount: 59_763,
          degenerateTriangleCount: 175,
          degenerateTriangleCriterion: "exact_cross_product_squared_equals_zero" as const,
          nonFinitePositionScalarCount: 0,
          outOfRangeIndexCount: 0,
          sourceAttributes: ["position"],
          derivedAttributes: ["normal"],
          localBounds: {
            min: [-31.858928680419922, -23.6622371673584, -6.327584743499756] as const,
            max: [3.825000047683716, 4.925000190734863, 8.617471694946289] as const,
          },
        },
        material: {
          type: "MeshNormalMaterial" as const,
          side: "FrontSide" as const,
          flatShading: true as const,
          transparent: false as const,
          depthTest: true as const,
          depthWrite: true as const,
          toneMapped: false as const,
        },
        frustumCulled: true,
        provenance: {
          truthClass: "RECONSTRUCTED" as const,
          byteTreatment: "source_bytes_unchanged" as const,
          geometryRole: "structural_evidence_only" as const,
          appearanceRole: "deterministic_debug_visualization_not_source_appearance" as const,
          registrationAuthority: "inspection_only" as const,
        },
      },
      actualCamera: {
        position: camera.position,
        quaternion: camera.quaternion,
        projectionMatrix,
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
      },
      actualRenderer: { toneMapping: "NoToneMapping", outputColorSpace: "srgb" },
    }],
  };
}

function onlyRepresentation(input: ReturnType<typeof validBenchmark>) {
  const representation = input.representations[0];
  if (representation === undefined) throw new Error("Expected one PLY representation.");
  return representation;
}

describe("PLY structural visual-lineage evidence", () => {
  it("accepts one exact-byte indexed-triangle structural diagnostic", () => {
    expect(VisualLineageBenchmarkV0Schema.safeParse(validBenchmark()).success).toBe(true);
  });

  it("rejects a PLY runtime receipt that differs from its source member", () => {
    const input = validBenchmark();
    onlyRepresentation(input).plyMeshRuntimeState.sourceSizeBytes += 1;
    expect(VisualLineageBenchmarkV0Schema.safeParse(input).success).toBe(false);
  });

  it("rejects incoherent header, triangle, or unsafe geometry counters", () => {
    const headerMismatch = validBenchmark();
    onlyRepresentation(headerMismatch).plyMeshRuntimeState.header.vertexCount += 1;
    expect(VisualLineageBenchmarkV0Schema.safeParse(headerMismatch).success).toBe(false);

    const unsafeGeometry = validBenchmark();
    onlyRepresentation(unsafeGeometry).plyMeshRuntimeState.geometry.outOfRangeIndexCount = 1;
    expect(VisualLineageBenchmarkV0Schema.safeParse(unsafeGeometry).success).toBe(false);
  });

  it("pins the exact loader, source/derived attributes, and degeneracy criterion", () => {
    const wrongLoader = validBenchmark();
    Object.assign(onlyRepresentation(wrongLoader).plyMeshRuntimeState.loader, { version: "0.181.0" });
    expect(VisualLineageBenchmarkV0Schema.safeParse(wrongLoader).success).toBe(false);

    const inventedSourceAttribute = validBenchmark();
    Object.assign(onlyRepresentation(inventedSourceAttribute).plyMeshRuntimeState.geometry, {
      sourceAttributes: ["position", "color"],
    });
    expect(VisualLineageBenchmarkV0Schema.safeParse(inventedSourceAttribute).success).toBe(false);

    const missingDerivedNormal = validBenchmark();
    Object.assign(onlyRepresentation(missingDerivedNormal).plyMeshRuntimeState.geometry, {
      derivedAttributes: [],
    });
    expect(VisualLineageBenchmarkV0Schema.safeParse(missingDerivedNormal).success).toBe(false);

    const ambiguousDegeneracy = validBenchmark();
    Object.assign(onlyRepresentation(ambiguousDegeneracy).plyMeshRuntimeState.geometry, {
      degenerateTriangleCriterion: "epsilon_area_test",
    });
    expect(VisualLineageBenchmarkV0Schema.safeParse(ambiguousDegeneracy).success).toBe(false);
  });

  it("rejects a PLY material contract that contradicts its fixture and benchmark", () => {
    const input = validBenchmark();
    input.rendererSettings.transparent = true;
    input.rendererSettings.depthWrite = false;
    const representation = onlyRepresentation(input);
    representation.fixtureSettings.renderer.transparent = true;
    representation.fixtureSettings.renderer.depthWrite = false;
    expect(VisualLineageBenchmarkV0Schema.safeParse(input).success).toBe(false);
  });

  it("accepts the sign-equivalent actual-camera quaternion", () => {
    const input = validBenchmark();
    const actualCamera = onlyRepresentation(input).actualCamera;
    Object.assign(actualCamera, {
      quaternion: actualCamera.quaternion.map((value) => -value),
    });
    expect(VisualLineageBenchmarkV0Schema.safeParse(input).success).toBe(true);
  });

  it("rejects PLY and Spark runtime evidence in either representation direction", () => {
    const plyWithSparkEvidence = validBenchmark();
    Object.assign(onlyRepresentation(plyWithSparkEvidence), { decodedSplatCount: 1 });
    expect(VisualLineageBenchmarkV0Schema.safeParse(plyWithSparkEvidence).success).toBe(false);

    const nonPlyWithPlyRuntime = validBenchmark();
    Object.assign(onlyRepresentation(nonPlyWithPlyRuntime), { format: "lcc" });
    expect(VisualLineageBenchmarkV0Schema.safeParse(nonPlyWithPlyRuntime).success).toBe(false);
  });

  it("rejects missing or duplicated source-member authority", () => {
    const missing = validBenchmark();
    onlyRepresentation(missing).sourceMembers = [];
    expect(VisualLineageBenchmarkV0Schema.safeParse(missing).success).toBe(false);

    const duplicated = validBenchmark();
    const representation = onlyRepresentation(duplicated);
    const sourceMember = representation.sourceMembers[0];
    if (sourceMember === undefined) throw new Error("Expected one PLY source member.");
    representation.sourceMembers.push({
      ...sourceMember,
      relativePath: "duplicate.ply",
    });
    expect(VisualLineageBenchmarkV0Schema.safeParse(duplicated).success).toBe(false);
  });
});
