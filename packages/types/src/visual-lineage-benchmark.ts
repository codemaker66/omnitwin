import { z } from "zod";
import {
  Matrix4dSchema,
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
  RuntimeTransformFrameSchema,
  RuntimeVec3Schema,
} from "./runtime-venue-manifest.js";

export const VISUAL_LINEAGE_BENCHMARK_V0_VERSION = "visual-lineage-benchmark/v0";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function approximatelyEqual(
  left: number | undefined,
  right: number | undefined,
  tolerance = 1e-6,
): boolean {
  return left !== undefined && right !== undefined && Math.abs(left - right) <= tolerance;
}

function hasUnitQuaternion(quaternion: readonly number[]): boolean {
  const magnitude = Math.hypot(...quaternion);
  return Number.isFinite(magnitude) && Math.abs(magnitude - 1) <= 1e-6;
}

function hasEquivalentQuaternion(
  left: readonly number[],
  right: readonly number[],
  tolerance = 1e-6,
): boolean {
  return left.length === right.length && (
    left.every((value, index) => approximatelyEqual(value, right[index], tolerance))
    || left.every((value, index) => approximatelyEqual(value, -(right[index] ?? Number.NaN), tolerance))
  );
}

export const VisualLineageCameraV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    revision: z.number().int().nonnegative(),
    sourceFrame: RuntimeTransformFrameSchema,
    position: RuntimeVec3Schema,
    quaternion: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]),
    projection: z.literal("perspective"),
    fov: z.number().finite().positive().max(179),
    near: z.number().finite().positive(),
    far: z.number().finite().positive(),
    aspect: z.number().finite().positive(),
    projectionMatrix: Matrix4dSchema,
  })
  .strict()
  .superRefine((camera, ctx) => {
    if (camera.far <= camera.near) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["far"],
        message: "Fixed camera far plane must exceed its near plane.",
      });
    }
    if (!hasUnitQuaternion(camera.quaternion)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quaternion"],
        message: "Fixed camera quaternion must be normalised.",
      });
    }
    const focalY = 1 / Math.tan((camera.fov * Math.PI) / 360);
    const focalX = focalY / camera.aspect;
    const depthA = (camera.far + camera.near) / (camera.near - camera.far);
    const depthB = (2 * camera.far * camera.near) / (camera.near - camera.far);
    if (
      !approximatelyEqual(camera.projectionMatrix[0], focalX)
      || !approximatelyEqual(camera.projectionMatrix[5], focalY)
      || !approximatelyEqual(camera.projectionMatrix[10], depthA)
      || !approximatelyEqual(camera.projectionMatrix[11], -1)
      || !approximatelyEqual(camera.projectionMatrix[14], depthB)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectionMatrix"],
        message: "Fixed camera projection matrix must match its perspective parameters.",
      });
    }
  });

export const VisualLineageRendererSettingsV0Schema = z
  .object({
    renderer: z.string().trim().min(1).max(160),
    antialias: z.boolean(),
    transparent: z.boolean(),
    depthWrite: z.boolean(),
    maxSplats: z.union([z.number().int().positive(), z.string().trim().min(1)]),
    maxStdDev: z.union([z.number().finite(), z.string().trim().min(1)]),
    minAlpha: z.union([z.number().finite(), z.string().trim().min(1)]),
    preBlurAmount: z.union([z.number().finite(), z.string().trim().min(1)]),
    blurAmount: z.union([z.number().finite(), z.string().trim().min(1)]),
    focalAdjustment: z.union([z.number().finite(), z.string().trim().min(1)]),
    toneMapping: z.string().trim().min(1).max(120),
    outputColorSpace: z.string().trim().min(1).max(120),
  })
  .strict();

export const VisualLineageScreenshotV0Schema = z
  .object({
    path: z.string().trim().min(1).max(500),
    sha256: RuntimeSha256Schema,
    sizeBytes: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    backgroundRgb: z.tuple([
      z.number().int().min(0).max(255),
      z.number().int().min(0).max(255),
      z.number().int().min(0).max(255),
    ]),
    nonBackgroundPixelCount: z.number().int().positive(),
    nonBackgroundPixelRatio: z.number().finite().positive().max(1),
  })
  .strict()
  .superRefine((screenshot, ctx) => {
    const pixelCount = screenshot.width * screenshot.height;
    if (screenshot.nonBackgroundPixelCount > pixelCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nonBackgroundPixelCount"],
        message: "Non-background pixel count cannot exceed screenshot dimensions.",
      });
    }
    const expectedRatio = screenshot.nonBackgroundPixelCount / pixelCount;
    if (!approximatelyEqual(screenshot.nonBackgroundPixelRatio, expectedRatio, 1e-9)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nonBackgroundPixelRatio"],
        message: "Non-background pixel ratio must match the recorded pixel count and dimensions.",
      });
    }
  });

export const VisualLineageTimingsV0Schema = z
  .object({
    loadMs: z.number().finite().nonnegative(),
    stableMs: z.number().finite().nonnegative(),
    frameP50Ms: z.number().finite().nonnegative(),
    frameP95Ms: z.number().finite().nonnegative(),
    frameP99Ms: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((timings, ctx) => {
    if (!(timings.frameP50Ms <= timings.frameP95Ms && timings.frameP95Ms <= timings.frameP99Ms)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frameP99Ms"],
        message: "Frame timing percentiles must be monotonic (p50 <= p95 <= p99).",
      });
    }
  });

export const VisualLineageEnvironmentV0Schema = z
  .object({
    browser: z.string().trim().min(1).max(240),
    operatingSystem: z.string().trim().min(1).max(240),
    webglVendor: z.string().trim().min(1).max(240),
    webglRenderer: z.string().trim().min(1).max(240),
    webglVersion: z.string().trim().min(1).max(240),
    contextLost: z.boolean(),
  })
  .strict();

export const VisualLineageSourceMemberV0Schema = z
  .object({
    relativePath: z.string().trim().min(1).max(500),
    sizeBytes: z.number().int().positive(),
    sha256: RuntimeSha256Schema,
  })
  .strict();

export const VisualLineageActualCameraV0Schema = z
  .object({
    position: RuntimeVec3Schema,
    quaternion: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]),
    projectionMatrix: Matrix4dSchema,
    fov: z.number().finite().positive().max(179).nullable(),
    near: z.number().finite().positive(),
    far: z.number().finite().positive(),
  })
  .strict()
  .superRefine((camera, ctx) => {
    if (camera.far <= camera.near) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["far"],
        message: "Actual camera far plane must exceed its near plane.",
      });
    }
    if (!hasUnitQuaternion(camera.quaternion)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quaternion"],
        message: "Actual camera quaternion must be normalised.",
      });
    }
  });

export const VisualLineageActualRendererV0Schema = z
  .object({
    toneMapping: z.string().trim().min(1).max(120),
    outputColorSpace: z.string().trim().min(1).max(120),
  })
  .strict();

export const VisualLineageFixtureSettingsV0Schema = z
  .object({
    camera: z
      .object({
        position: RuntimeVec3Schema,
        target: RuntimeVec3Schema,
        fov: z.number().finite().positive().max(179),
        near: z.number().finite().positive(),
        far: z.number().finite().positive(),
      })
      .strict(),
    group: z
      .object({
        zUp: z.boolean(),
        offset: RuntimeVec3Schema,
      })
      .strict(),
    renderer: z
      .object({
        dpr: z.number().finite().positive(),
        antialias: z.boolean(),
        fixedCamera: z.boolean(),
        transparent: z.boolean(),
        depthWrite: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const VisualLineageSparkRuntimeStateV0Schema = z
  .object({
    activeSplats: z.number().int().nonnegative(),
    maxSplats: z.number().int().positive(),
    sorting: z.boolean(),
    sortDirty: z.boolean(),
    dirty: z.boolean(),
    maxStdDev: z.number().finite().positive(),
    minPixelRadius: z.number().finite().nonnegative(),
    maxPixelRadius: z.number().finite().positive(),
    minAlpha: z.number().finite().nonnegative(),
    enable2DGS: z.boolean(),
    preBlurAmount: z.number().finite().nonnegative(),
    blurAmount: z.number().finite().nonnegative(),
    focalDistance: z.number().finite().nonnegative(),
    apertureAngle: z.number().finite().nonnegative(),
    falloff: z.number().finite(),
    clipXY: z.number().finite().positive(),
    focalAdjustment: z.number().finite().positive(),
    encodeLinear: z.boolean(),
    sortRadial: z.boolean(),
    minSortIntervalMs: z.number().finite().nonnegative(),
    enableLod: z.boolean(),
    enableDriveLod: z.boolean(),
    enableLodFetching: z.boolean(),
    lodSplatCount: z.number().int().positive().nullable(),
    lodSplatScale: z.number().finite().positive(),
    lodRenderScale: z.number().finite().positive(),
    lodInflate: z.boolean(),
    pagedExtSplats: z.boolean(),
    maxPagedSplats: z.number().int().positive(),
    numLodFetchers: z.number().int().positive(),
  })
  .strict();

export const VisualLineagePlyMeshRuntimeStateV0Schema = z
  .object({
    sourceSizeBytes: z.number().int().positive(),
    sourceSha256: RuntimeSha256Schema,
    header: z
      .object({
        encoding: z.literal("binary_little_endian"),
        version: z.literal("1.0"),
        vertexCount: z.number().int().positive(),
        faceCount: z.number().int().positive(),
        vertexProperties: z.tuple([
          z.literal("float x"),
          z.literal("float y"),
          z.literal("float z"),
        ]),
        faceList: z
          .object({
            countType: z.literal("uchar"),
            itemType: z.literal("uint"),
            name: z.literal("vertex_indices"),
          })
          .strict(),
      })
      .strict(),
    loader: z
      .object({
        implementation: z.literal("three/addons/loaders/PLYLoader.js"),
        version: z.literal("0.180.0"),
      })
      .strict(),
    geometry: z
      .object({
        indexed: z.literal(true),
        positionCount: z.number().int().positive(),
        positionItemSize: z.literal(3),
        positionArrayType: z.literal("Float32Array"),
        indexCount: z.number().int().positive(),
        indexArrayType: z.enum(["Uint16Array", "Uint32Array"]),
        triangleCount: z.number().int().positive(),
        degenerateTriangleCount: z.number().int().nonnegative(),
        degenerateTriangleCriterion: z.literal("exact_cross_product_squared_equals_zero"),
        nonFinitePositionScalarCount: z.number().int().nonnegative(),
        outOfRangeIndexCount: z.number().int().nonnegative(),
        sourceAttributes: z.tuple([z.literal("position")]),
        derivedAttributes: z.tuple([z.literal("normal")]),
        localBounds: z
          .object({
            min: RuntimeVec3Schema,
            max: RuntimeVec3Schema,
          })
          .strict(),
      })
      .strict(),
    material: z
      .object({
        type: z.literal("MeshNormalMaterial"),
        side: z.literal("FrontSide"),
        flatShading: z.literal(true),
        transparent: z.literal(false),
        depthTest: z.literal(true),
        depthWrite: z.literal(true),
        toneMapped: z.literal(false),
      })
      .strict(),
    frustumCulled: z.boolean(),
    provenance: z
      .object({
        truthClass: z.literal("RECONSTRUCTED"),
        byteTreatment: z.literal("source_bytes_unchanged"),
        geometryRole: z.literal("structural_evidence_only"),
        appearanceRole: z.literal("deterministic_debug_visualization_not_source_appearance"),
        registrationAuthority: z.literal("inspection_only"),
      })
      .strict(),
  })
  .strict();

export const VisualLineageRepresentationV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    format: z.enum(["lcc", "lcc2", "sog", "spz", "ply_mesh", "venviewer"]),
    lineage: z.string().trim().min(1).max(500),
    status: z.enum(["not_run", "unavailable", "diagnostic", "passed", "failed"]),
    visualAssessment: z.enum(["not_reviewed", "reviewed_accepted", "reviewed_rejected"]),
    cameraRegistration: z.enum(["unavailable", "inspection_only", "reviewed_matched"]),
    rendererProfile: z.enum([
      "unavailable",
      "diagnostic_unresolved_defaults",
      "diagnostic_resolved_defaults",
      "controlled_explicit",
    ]),
    sourceRefs: z.array(z.string().trim().min(1).max(500)).min(1),
    limitations: z.array(z.string().trim().min(1).max(500)).min(1),
    screenshot: VisualLineageScreenshotV0Schema.optional(),
    timings: VisualLineageTimingsV0Schema.optional(),
    environment: VisualLineageEnvironmentV0Schema.optional(),
    sourceMembers: z.array(VisualLineageSourceMemberV0Schema).min(1).optional(),
    decodedSplatCount: z.number().int().nonnegative().optional(),
    warmupFrameCount: z.number().int().nonnegative().optional(),
    frameSampleCount: z.number().int().positive().max(600).optional(),
    frameMaxMs: z.number().finite().nonnegative().optional(),
    fixtureSettings: VisualLineageFixtureSettingsV0Schema.optional(),
    sparkRuntimeState: VisualLineageSparkRuntimeStateV0Schema.optional(),
    plyMeshRuntimeState: VisualLineagePlyMeshRuntimeStateV0Schema.optional(),
    actualCamera: VisualLineageActualCameraV0Schema.optional(),
    actualRenderer: VisualLineageActualRendererV0Schema.optional(),
  })
  .strict()
  .superRefine((representation, ctx) => {
    if (
      (representation.status === "passed" || representation.status === "diagnostic")
      && (
        representation.screenshot === undefined
        || representation.timings === undefined
        || representation.environment === undefined
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passed or diagnostic lineage entries require screenshot, timing, and environment evidence.",
      });
    }
    const completed = representation.status === "passed" || representation.status === "diagnostic";
    if (completed && representation.environment?.contextLost === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["environment", "contextLost"],
        message: "A context-lost render cannot be retained as passed or diagnostic evidence.",
      });
    }
    if (completed && representation.cameraRegistration !== "unavailable" && representation.actualCamera === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actualCamera"],
        message: "A registered completed camera run must record the actual camera state.",
      });
    }
    if (completed && representation.actualRenderer === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actualRenderer"],
        message: "Completed lineage evidence must record the actual renderer colour pipeline.",
      });
    }
    if (
      completed
      && (representation.format === "sog" || representation.format === "spz" || representation.format === "venviewer")
      && (
        representation.sourceMembers === undefined
        || representation.decodedSplatCount === undefined
        || representation.decodedSplatCount === 0
        || representation.warmupFrameCount === undefined
        || representation.frameSampleCount === undefined
        || representation.frameMaxMs === undefined
        || representation.fixtureSettings === undefined
        || representation.sparkRuntimeState === undefined
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Completed splat lineage entries require member receipts, active count, frame profile, fixture settings, and maximum frame time.",
      });
    }
    if (
      completed
      && representation.sparkRuntimeState !== undefined
      && (
        representation.sparkRuntimeState.activeSplats === 0
        || representation.sparkRuntimeState.activeSplats > (representation.decodedSplatCount ?? 0)
        || representation.sparkRuntimeState.sorting
        || representation.sparkRuntimeState.sortDirty
        || representation.sparkRuntimeState.dirty
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sparkRuntimeState"],
        message: "Completed splat evidence requires visible active splats and a fully settled Spark state.",
      });
    }
    if (
      completed
      && representation.format === "ply_mesh"
      && (
        representation.sourceMembers?.length !== 1
        || representation.plyMeshRuntimeState === undefined
        || representation.fixtureSettings === undefined
        || representation.warmupFrameCount === undefined
        || representation.frameSampleCount === undefined
        || representation.frameMaxMs === undefined
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Completed PLY mesh lineage requires exactly one source-member receipt, PLY runtime state, fixture settings, and a frame profile.",
      });
    }
    if (representation.format === "ply_mesh" && representation.plyMeshRuntimeState !== undefined) {
      const runtime = representation.plyMeshRuntimeState;
      const member = representation.sourceMembers?.[0];
      if (
        member === undefined
        || representation.sourceMembers?.length !== 1
        || runtime.sourceSha256 !== member.sha256
        || runtime.sourceSizeBytes !== member.sizeBytes
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["plyMeshRuntimeState"],
          message: "PLY runtime source receipt must exactly match its representation source member.",
        });
      }
      const geometry = runtime.geometry;
      if (
        runtime.header.vertexCount !== geometry.positionCount
        || runtime.header.faceCount !== geometry.triangleCount
        || geometry.indexCount !== geometry.triangleCount * 3
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["plyMeshRuntimeState", "geometry"],
          message: "PLY header counts must match decoded indexed-triangle geometry.",
        });
      }
      if (
        geometry.degenerateTriangleCount > geometry.triangleCount
        || geometry.nonFinitePositionScalarCount !== 0
        || geometry.outOfRangeIndexCount !== 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["plyMeshRuntimeState", "geometry"],
          message: "Completed PLY structural evidence must contain finite positions and in-range triangle indices.",
        });
      }
      if (geometry.localBounds.min.some((value, index) => value > (geometry.localBounds.max[index] ?? value))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["plyMeshRuntimeState", "geometry", "localBounds"],
          message: "PLY local bounds must be ordered min-to-max on every axis.",
        });
      }
      const fixtureRenderer = representation.fixtureSettings?.renderer;
      if (
        fixtureRenderer !== undefined
        && (
          runtime.material.transparent !== fixtureRenderer.transparent
          || runtime.material.depthWrite !== fixtureRenderer.depthWrite
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["plyMeshRuntimeState", "material"],
          message: "PLY runtime material transparency and depth-write state must match its fixture renderer contract.",
        });
      }
    }
    if (
      (representation.format === "ply_mesh" && (
        representation.sparkRuntimeState !== undefined
        || representation.decodedSplatCount !== undefined
      ))
      || (representation.format !== "ply_mesh" && representation.plyMeshRuntimeState !== undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "PLY and Spark runtime state are mutually exclusive.",
      });
    }
    if (completed && representation.sourceRefs.some((sourceRef) => !SHA256_PATTERN.test(sourceRef))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceRefs"],
        message: "Completed lineage source references must be immutable SHA-256 receipts.",
      });
    }
    if (completed && representation.sourceMembers !== undefined) {
      const sourceRefs = new Set(representation.sourceRefs);
      const memberRefs = new Set(representation.sourceMembers.map((member) => member.sha256));
      const memberPaths = new Set(representation.sourceMembers.map((member) => member.relativePath));
      if (
        sourceRefs.size !== representation.sourceRefs.length
        || memberRefs.size !== representation.sourceMembers.length
        || memberPaths.size !== representation.sourceMembers.length
        || sourceRefs.size !== memberRefs.size
        || [...sourceRefs].some((sourceRef) => !memberRefs.has(sourceRef))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceRefs"],
          message: "Completed lineage sourceRefs and member paths/receipts must be unique and exactly matched.",
        });
      }
    }
    if (
      completed
      && representation.timings !== undefined
      && representation.frameMaxMs !== undefined
      && representation.frameMaxMs < representation.timings.frameP99Ms
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frameMaxMs"],
        message: "Maximum frame time cannot be below the recorded p99 frame time.",
      });
    }
    if (
      representation.status === "passed"
      && (
        representation.visualAssessment !== "reviewed_accepted"
        || representation.cameraRegistration !== "reviewed_matched"
        || representation.rendererProfile !== "controlled_explicit"
        || (representation.warmupFrameCount ?? 0) < 120
        || (representation.frameSampleCount ?? 0) < 600
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "Passed lineage entries require accepted human visual review, a reviewed matched camera, and the controlled 120-warm-up/600-frame profile.",
      });
    }
    if (representation.status === "failed" && representation.visualAssessment === "reviewed_accepted") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visualAssessment"],
        message: "Failed lineage entries cannot claim accepted human visual review.",
      });
    }
  });

export const VisualLineageBenchmarkV0Schema = z
  .object({
    schemaVersion: z.literal(VISUAL_LINEAGE_BENCHMARK_V0_VERSION),
    benchmarkId: RuntimeManifestKeySchema,
    roomRef: z.string().trim().min(1).max(240),
    gitSha: z.string().regex(/^[a-f0-9]{40}$/u),
    worktreeDirty: z.boolean(),
    worktreeSourceStateSha256: RuntimeSha256Schema.optional(),
    runStartedAt: z.string().datetime({ offset: true }).optional(),
    runCompletedAt: z.string().datetime({ offset: true }).optional(),
    camera: VisualLineageCameraV0Schema,
    viewport: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        devicePixelRatio: z.number().finite().positive(),
      })
      .strict(),
    rendererSettings: VisualLineageRendererSettingsV0Schema,
    representations: z.array(VisualLineageRepresentationV0Schema).min(1),
  })
  .strict()
  .superRefine((benchmark, ctx) => {
    const hasCompletedRun = benchmark.representations.some(
      (representation) => representation.status === "passed" || representation.status === "diagnostic",
    );
    if (hasCompletedRun && (benchmark.runStartedAt === undefined || benchmark.runCompletedAt === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runCompletedAt"],
        message: "Completed lineage runs require start and completion timestamps.",
      });
    }
    if (
      benchmark.worktreeDirty
      && benchmark.representations.some((representation) => representation.status === "passed")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["worktreeDirty"],
        message: "Dirty-worktree lineage evidence may be diagnostic, but cannot pass the controlled benchmark.",
      });
    }
    if (hasCompletedRun && benchmark.worktreeDirty && benchmark.worktreeSourceStateSha256 === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["worktreeSourceStateSha256"],
        message: "Dirty-worktree lineage evidence requires a digest of the served source state.",
      });
    }
    const expectedAspect = benchmark.viewport.width / benchmark.viewport.height;
    if (!approximatelyEqual(benchmark.camera.aspect, expectedAspect)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["camera", "aspect"],
        message: "Fixed camera aspect must match the benchmark viewport.",
      });
    }
    for (const [index, representation] of benchmark.representations.entries()) {
      const completed = representation.status === "passed" || representation.status === "diagnostic";
      if (!completed) continue;
      if (
        representation.screenshot !== undefined
        && (
          representation.screenshot.width !== Math.round(benchmark.viewport.width * benchmark.viewport.devicePixelRatio)
          || representation.screenshot.height !== Math.round(benchmark.viewport.height * benchmark.viewport.devicePixelRatio)
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["representations", index, "screenshot"],
          message: "Screenshot pixel dimensions must match the viewport and device pixel ratio.",
        });
      }
      const actual = representation.actualCamera;
      if (
        actual !== undefined
        && (
          actual.position.some((value, component) => !approximatelyEqual(value, benchmark.camera.position[component]))
          || !hasEquivalentQuaternion(actual.quaternion, benchmark.camera.quaternion)
          || actual.projectionMatrix.some((value, component) => !approximatelyEqual(value, benchmark.camera.projectionMatrix[component]))
          || actual.fov === null
          || !approximatelyEqual(actual.fov, benchmark.camera.fov)
          || !approximatelyEqual(actual.near, benchmark.camera.near)
          || !approximatelyEqual(actual.far, benchmark.camera.far)
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["representations", index, "actualCamera"],
          message: "Recorded actual camera must match the immutable benchmark camera.",
        });
      }
      const fixture = representation.fixtureSettings;
      if (
        fixture !== undefined
        && (
          !approximatelyEqual(fixture.renderer.dpr, benchmark.viewport.devicePixelRatio)
          || fixture.renderer.antialias !== benchmark.rendererSettings.antialias
          || fixture.renderer.transparent !== benchmark.rendererSettings.transparent
          || fixture.renderer.depthWrite !== benchmark.rendererSettings.depthWrite
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["representations", index, "fixtureSettings", "renderer"],
          message: "Recorded fixture renderer settings must match the benchmark renderer contract.",
        });
      }
      if (
        representation.actualRenderer !== undefined
        && (
          representation.actualRenderer.toneMapping !== benchmark.rendererSettings.toneMapping
          || representation.actualRenderer.outputColorSpace !== benchmark.rendererSettings.outputColorSpace
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["representations", index, "actualRenderer"],
          message: "Recorded renderer colour state must match the benchmark renderer contract.",
        });
      }
      const plyMaterial = representation.plyMeshRuntimeState?.material;
      if (
        plyMaterial !== undefined
        && (
          plyMaterial.transparent !== benchmark.rendererSettings.transparent
          || plyMaterial.depthWrite !== benchmark.rendererSettings.depthWrite
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["representations", index, "plyMeshRuntimeState", "material"],
          message: "PLY runtime material transparency and depth-write state must match the benchmark renderer contract.",
        });
      }
    }
    if (
      benchmark.representations.some((representation) =>
        representation.status === "passed"
        && (representation.format === "sog" || representation.format === "spz" || representation.format === "venviewer"))
      && [
        benchmark.rendererSettings.maxSplats,
        benchmark.rendererSettings.maxStdDev,
        benchmark.rendererSettings.minAlpha,
        benchmark.rendererSettings.preBlurAmount,
        benchmark.rendererSettings.blurAmount,
        benchmark.rendererSettings.focalAdjustment,
      ].some((value) => typeof value !== "number")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rendererSettings"],
        message: "A passed controlled renderer profile must pin every numeric Spark setting explicitly.",
      });
    }
    for (const [index, representation] of benchmark.representations.entries()) {
      if (representation.status !== "passed" || representation.sparkRuntimeState === undefined) continue;
      const expected = benchmark.rendererSettings;
      const actual = representation.sparkRuntimeState;
      if (
        expected.maxSplats !== actual.maxSplats
        || expected.maxStdDev !== actual.maxStdDev
        || expected.minAlpha !== actual.minAlpha
        || expected.preBlurAmount !== actual.preBlurAmount
        || expected.blurAmount !== actual.blurAmount
        || expected.focalAdjustment !== actual.focalAdjustment
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["representations", index, "sparkRuntimeState"],
          message: "Passed lineage Spark state must exactly match the controlled renderer profile.",
        });
      }
    }
    if (
      benchmark.runStartedAt !== undefined
      && benchmark.runCompletedAt !== undefined
      && Date.parse(benchmark.runCompletedAt) < Date.parse(benchmark.runStartedAt)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runCompletedAt"],
        message: "Lineage completion must not precede its start.",
      });
    }
  });

export type VisualLineageCameraV0 = z.infer<typeof VisualLineageCameraV0Schema>;
export type VisualLineageRendererSettingsV0 = z.infer<typeof VisualLineageRendererSettingsV0Schema>;
export type VisualLineageSourceMemberV0 = z.infer<typeof VisualLineageSourceMemberV0Schema>;
export type VisualLineageActualCameraV0 = z.infer<typeof VisualLineageActualCameraV0Schema>;
export type VisualLineageActualRendererV0 = z.infer<typeof VisualLineageActualRendererV0Schema>;
export type VisualLineageFixtureSettingsV0 = z.infer<typeof VisualLineageFixtureSettingsV0Schema>;
export type VisualLineageSparkRuntimeStateV0 = z.infer<typeof VisualLineageSparkRuntimeStateV0Schema>;
export type VisualLineagePlyMeshRuntimeStateV0 = z.infer<typeof VisualLineagePlyMeshRuntimeStateV0Schema>;
export type VisualLineageRepresentationV0 = z.infer<typeof VisualLineageRepresentationV0Schema>;
export type VisualLineageBenchmarkV0Input = z.input<typeof VisualLineageBenchmarkV0Schema>;
export type VisualLineageBenchmarkV0 = z.infer<typeof VisualLineageBenchmarkV0Schema>;
