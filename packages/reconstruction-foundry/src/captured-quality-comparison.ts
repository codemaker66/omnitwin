import { FoundryUtcInstantSchema } from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";

export const FOUNDRY_CAPTURED_QUALITY_COMPARISON_REPORT_V0 =
  "omnitwin.foundry.captured-quality-comparison-report.v0";
export const FOUNDRY_CAPTURED_QUALITY_COMPARISON_REPORT_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_CAPTURED_QUALITY_COMPARISON_REPORT_V0";

export const FOUNDRY_CAPTURED_QUALITY_COMPARISON_LIMITATIONS = Object.freeze([
  "This authority-none report is regression-triage evidence only and is not a product-acceptance decision.",
  "Rendered-image comparisons and camera matrices do not establish physical accuracy, metric registration, survey fitness, or real-world completeness.",
  "No candidate winner is selected by this report; any later selection requires a separately reviewed decision bound to the exact evidence.",
  "A self-digest detects un-recomputed changes only; it is not a signature, trusted timestamp, execution attestation, or provenance proof.",
  "This report does not establish source rights, privacy clearance, publication permission, training permission, or release authority.",
  "Zero external requests records the declared boundary of this comparison report; it does not independently prove operating-system or network isolation.",
] as const);

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const VIEW_ID = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const PATH_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u;

const Sha256Schema = z.string().regex(SHA256_HEX);
const StableIdSchema = z.string().regex(STABLE_ID);
const ViewIdSchema = z.string().regex(VIEW_ID);
const PathLabelSchema = z
  .string()
  .regex(PATH_LABEL, "source path labels must be safe base names, not paths")
  .refine((value) => value !== "." && value !== "..", {
    message: "source path labels cannot be dot segments",
  });

const SafePositiveIntegerSchema = z
  .number()
  .finite()
  .int()
  .safe()
  .positive();
const DurationMsSchema = z.number().finite().nonnegative().max(86_400_000);
const FrameDurationMsSchema = z.number().finite().nonnegative().max(60_000);
const MatrixNumberSchema = z.number().finite().min(-1e12).max(1e12);
const CoordinateSchema = z.number().finite().min(-1e9).max(1e9);
const UnitIntervalSchema = z.number().finite().min(0).max(1);

const Vector3Schema = z.tuple([
  CoordinateSchema,
  CoordinateSchema,
  CoordinateSchema,
]);
const Matrix4Schema = z.tuple([
  MatrixNumberSchema,
  MatrixNumberSchema,
  MatrixNumberSchema,
  MatrixNumberSchema,
  MatrixNumberSchema,
  MatrixNumberSchema,
  MatrixNumberSchema,
  MatrixNumberSchema,
  MatrixNumberSchema,
  MatrixNumberSchema,
  MatrixNumberSchema,
  MatrixNumberSchema,
  MatrixNumberSchema,
  MatrixNumberSchema,
  MatrixNumberSchema,
  MatrixNumberSchema,
]);

const CandidateAssetSchema = z
  .object({
    pathLabel: PathLabelSchema,
    sizeBytes: SafePositiveIntegerSchema,
    sha256: Sha256Schema,
  })
  .strict();

const CandidateAssetTupleSchema = z.tuple([
  CandidateAssetSchema,
  CandidateAssetSchema,
  CandidateAssetSchema,
  CandidateAssetSchema,
]);

function candidateProfileSchema<ProfileId extends string>(
  profileId: ProfileId,
  extension: ".sog" | ".spz",
) {
  return z
    .object({
      profileId: z.literal(profileId),
      expectedGaussianCount: SafePositiveIntegerSchema,
      decodedGaussianCount: SafePositiveIntegerSchema,
      assets: CandidateAssetTupleSchema,
    })
    .strict()
    .superRefine((profile, ctx) => {
      if (profile.decodedGaussianCount !== profile.expectedGaussianCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decodedGaussianCount"],
          message: "decoded Gaussian count must equal the frozen profile expectation",
        });
      }
      const labels = profile.assets.map((asset) => asset.pathLabel);
      if (new Set(labels).size !== labels.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets"],
          message: "candidate asset path labels must be unique",
        });
      }
      for (const [index, asset] of profile.assets.entries()) {
        if (!asset.pathLabel.toLowerCase().endsWith(extension)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["assets", index, "pathLabel"],
            message: `${profileId} assets must use ${extension} path labels`,
          });
        }
      }
    });
}

const QualityCandidateProfileSchema = candidateProfileSchema(
  "quality-sog-fine-v1",
  ".sog",
);
const MobileCandidateProfileSchema = candidateProfileSchema(
  "mobile-spz-fine-v1",
  ".spz",
);

const RendererProfileSchema = z
  .object({
    id: StableIdSchema,
    profileSha256: Sha256Schema,
  })
  .strict();

const ViewportSchema = z
  .object({
    widthPx: SafePositiveIntegerSchema.max(16_384),
    heightPx: SafePositiveIntegerSchema.max(16_384),
    deviceScaleFactor: z.number().finite().min(0.25).max(8),
  })
  .strict();

const CameraSchema = z
  .object({
    model: z.literal("perspective"),
    position: Vector3Schema,
    target: Vector3Schema,
    up: Vector3Schema,
    verticalFovDegrees: z.number().finite().positive().lt(180),
    nearClip: z.number().finite().positive().max(1e9),
    farClip: z.number().finite().positive().max(1e12),
    viewMatrix: Matrix4Schema,
    projectionMatrix: Matrix4Schema,
  })
  .strict()
  .superRefine((camera, ctx) => {
    if (camera.farClip <= camera.nearClip) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["farClip"],
        message: "camera far clip must be greater than near clip",
      });
    }
    if (camera.position.every((value, index) => value === camera.target[index])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target"],
        message: "camera position and target cannot be identical",
      });
    }
    if (camera.up.every((value) => value === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["up"],
        message: "camera up vector cannot be zero",
      });
    }
  });

const ViewDefinitionSchema = z
  .object({
    viewId: ViewIdSchema,
    kind: z.enum([
      "e57_matched",
      "spatial_near",
      "spatial_mid",
      "spatial_far",
      "orbit",
      "other_reviewed",
    ]),
    camera: CameraSchema,
  })
  .strict();

const ScreenshotSchema = z
  .object({
    mediaType: z.literal("image/png"),
    widthPx: SafePositiveIntegerSchema.max(16_384),
    heightPx: SafePositiveIntegerSchema.max(16_384),
    sizeBytes: SafePositiveIntegerSchema.max(1_073_741_824),
    sha256: Sha256Schema,
  })
  .strict();

const CaptureTelemetrySchema = z
  .object({
    loadedAssetCount: z.literal(4),
    loadedBytes: SafePositiveIntegerSchema,
    decodedGaussianCount: SafePositiveIntegerSchema,
    assetLoadDurationMs: DurationMsSchema,
    settleDurationMs: DurationMsSchema,
    screenshotDurationMs: DurationMsSchema,
    totalDurationMs: DurationMsSchema,
    frameSampleCount: SafePositiveIntegerSchema.max(10_000_000),
    frameTimeP50Ms: FrameDurationMsSchema,
    frameTimeP95Ms: FrameDurationMsSchema,
    frameTimeP99Ms: FrameDurationMsSchema,
  })
  .strict()
  .superRefine((telemetry, ctx) => {
    if (
      telemetry.frameTimeP50Ms > telemetry.frameTimeP95Ms ||
      telemetry.frameTimeP95Ms > telemetry.frameTimeP99Ms
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frameTimeP95Ms"],
        message: "frame-time percentiles must be monotonic",
      });
    }
    if (
      telemetry.totalDurationMs < telemetry.assetLoadDurationMs ||
      telemetry.totalDurationMs < telemetry.settleDurationMs ||
      telemetry.totalDurationMs < telemetry.screenshotDurationMs
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalDurationMs"],
        message: "total duration cannot be shorter than a component duration",
      });
    }
  });

function captureRepeatSchema<Repeat extends 1 | 2>(repeat: Repeat) {
  return z
    .object({
      repeat: z.literal(repeat),
      screenshot: ScreenshotSchema,
      telemetry: CaptureTelemetrySchema,
    })
    .strict();
}

const CaptureRepeatTupleSchema = z.tuple([
  captureRepeatSchema(1),
  captureRepeatSchema(2),
]);

const ViewCaptureSchema = z
  .object({
    viewId: ViewIdSchema,
    repeats: CaptureRepeatTupleSchema,
  })
  .strict();

function profileCapturesSchema<ProfileId extends string>(profileId: ProfileId) {
  return z
    .object({
      profileId: z.literal(profileId),
      views: z.array(ViewCaptureSchema).min(1).max(32),
    })
    .strict();
}

const SourceSnapshotEntrySchema = z
  .object({
    profileId: z.enum(["quality-sog-fine-v1", "mobile-spz-fine-v1"]),
    pathLabel: PathLabelSchema,
    sizeBytes: SafePositiveIntegerSchema,
    sha256: Sha256Schema,
  })
  .strict();

const SourceSnapshotSchema = z
  .array(SourceSnapshotEntrySchema)
  .length(8);

const PairMetricValuesSchema = z
  .object({
    comparedPixelCount: SafePositiveIntegerSchema.max(2_147_483_647),
    meanAbsoluteError: UnitIntervalSchema,
    rootMeanSquareError: UnitIntervalSchema,
    psnrDb: z.number().finite().nonnegative().max(500).nullable(),
    ssim: z.number().finite().min(-1).max(1),
  })
  .strict();

function pairMetricRepeatSchema<Repeat extends 1 | 2>(repeat: Repeat) {
  return z
    .object({
      repeat: z.literal(repeat),
      qualityScreenshotSha256: Sha256Schema,
      mobileScreenshotSha256: Sha256Schema,
      metrics: PairMetricValuesSchema,
    })
    .strict();
}

const PairMetricSchema = z
  .object({
    viewId: ViewIdSchema,
    repeats: z.tuple([
      pairMetricRepeatSchema(1),
      pairMetricRepeatSchema(2),
    ]),
  })
  .strict();

const ScorerSchema = z
  .object({
    id: StableIdSchema,
    version: z.string().trim().min(1).max(128),
    implementationSha256: Sha256Schema,
    receiptSha256: Sha256Schema,
  })
  .strict();

const ReportPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_CAPTURED_QUALITY_COMPARISON_REPORT_V0,
    ),
    generatedAt: FoundryUtcInstantSchema,
    authority: z.literal("none"),
    resultType: z.literal("regression_triage_not_acceptance"),
    winner: z.literal("not_selected"),
    sourceReceiptSha256: Sha256Schema.nullable(),
    candidateProfiles: z.tuple([
      QualityCandidateProfileSchema,
      MobileCandidateProfileSchema,
    ]),
    rendererProfile: RendererProfileSchema,
    viewport: ViewportSchema,
    views: z.array(ViewDefinitionSchema).min(1).max(32),
    captures: z.tuple([
      profileCapturesSchema("quality-sog-fine-v1"),
      profileCapturesSchema("mobile-spz-fine-v1"),
    ]),
    pairMetrics: z.array(PairMetricSchema).min(1).max(32),
    sourceIntegrity: z
      .object({
        preCapture: SourceSnapshotSchema,
        postCapture: SourceSnapshotSchema,
        allSourcesUnchanged: z.literal(true),
      })
      .strict(),
    scorer: ScorerSchema,
    limitations: z.tuple([
      z.literal(FOUNDRY_CAPTURED_QUALITY_COMPARISON_LIMITATIONS[0]),
      z.literal(FOUNDRY_CAPTURED_QUALITY_COMPARISON_LIMITATIONS[1]),
      z.literal(FOUNDRY_CAPTURED_QUALITY_COMPARISON_LIMITATIONS[2]),
      z.literal(FOUNDRY_CAPTURED_QUALITY_COMPARISON_LIMITATIONS[3]),
      z.literal(FOUNDRY_CAPTURED_QUALITY_COMPARISON_LIMITATIONS[4]),
      z.literal(FOUNDRY_CAPTURED_QUALITY_COMPARISON_LIMITATIONS[5]),
    ]),
    externalRequests: z.literal(0),
  })
  .strict();

function addIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [...path],
    message,
  });
}

function sameSourceIdentity(
  left: z.infer<typeof SourceSnapshotEntrySchema>,
  right: z.infer<typeof SourceSnapshotEntrySchema>,
): boolean {
  return left.profileId === right.profileId &&
    left.pathLabel === right.pathLabel &&
    left.sizeBytes === right.sizeBytes &&
    left.sha256 === right.sha256;
}

const ReportPayloadSchema = ReportPayloadObjectSchema.superRefine(
  (report, ctx) => {
    const viewIds = report.views.map((view) => view.viewId);
    if (new Set(viewIds).size !== viewIds.length) {
      addIssue(ctx, ["views"], "view IDs must be unique");
    }

    const expectedSources = report.candidateProfiles.flatMap((profile) =>
      profile.assets.map((asset) => ({
        profileId: profile.profileId,
        pathLabel: asset.pathLabel,
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
      })),
    );
    for (const phase of ["preCapture", "postCapture"] as const) {
      const actualSources = report.sourceIntegrity[phase];
      for (const [index, expected] of expectedSources.entries()) {
        const actual = actualSources[index];
        if (actual === undefined || !sameSourceIdentity(actual, expected)) {
          addIssue(
            ctx,
            ["sourceIntegrity", phase, index],
            `${phase} source identity must exactly match candidate profile order`,
          );
        }
      }
    }

    for (const [profileIndex, profileCaptures] of report.captures.entries()) {
      const profile = report.candidateProfiles[profileIndex];
      if (profile === undefined) continue;
      const expectedLoadedBytes = profile.assets.reduce(
        (total, asset) => total + asset.sizeBytes,
        0,
      );
      if (
        profileCaptures.views.length !== viewIds.length ||
        profileCaptures.views.some((view, index) => view.viewId !== viewIds[index])
      ) {
        addIssue(
          ctx,
          ["captures", profileIndex, "views"],
          "capture views must exactly match report view order",
        );
      }
      for (const [viewIndex, viewCapture] of profileCaptures.views.entries()) {
        for (const [repeatIndex, repeat] of viewCapture.repeats.entries()) {
          if (
            repeat.screenshot.widthPx !== report.viewport.widthPx ||
            repeat.screenshot.heightPx !== report.viewport.heightPx
          ) {
            addIssue(
              ctx,
              [
                "captures",
                profileIndex,
                "views",
                viewIndex,
                "repeats",
                repeatIndex,
                "screenshot",
              ],
              "screenshot dimensions must exactly match the frozen viewport",
            );
          }
          if (repeat.telemetry.loadedBytes !== expectedLoadedBytes) {
            addIssue(
              ctx,
              [
                "captures",
                profileIndex,
                "views",
                viewIndex,
                "repeats",
                repeatIndex,
                "telemetry",
                "loadedBytes",
              ],
              "loaded bytes must equal the candidate asset byte total",
            );
          }
          if (
            repeat.telemetry.decodedGaussianCount !==
            profile.decodedGaussianCount
          ) {
            addIssue(
              ctx,
              [
                "captures",
                profileIndex,
                "views",
                viewIndex,
                "repeats",
                repeatIndex,
                "telemetry",
                "decodedGaussianCount",
              ],
              "capture telemetry must match the candidate decoded Gaussian count",
            );
          }
        }
      }
    }

    if (
      report.pairMetrics.length !== viewIds.length ||
      report.pairMetrics.some((pair, index) => pair.viewId !== viewIds[index])
    ) {
      addIssue(
        ctx,
        ["pairMetrics"],
        "pair metrics must exactly match report view order",
      );
    }
    for (const [viewIndex, pair] of report.pairMetrics.entries()) {
      const qualityCapture = report.captures[0].views[viewIndex];
      const mobileCapture = report.captures[1].views[viewIndex];
      if (qualityCapture === undefined || mobileCapture === undefined) continue;
      for (const [repeatIndex, metric] of pair.repeats.entries()) {
        const qualityRepeat = qualityCapture.repeats[repeatIndex];
        const mobileRepeat = mobileCapture.repeats[repeatIndex];
        if (
          qualityRepeat === undefined ||
          metric.qualityScreenshotSha256 !== qualityRepeat.screenshot.sha256
        ) {
          addIssue(
            ctx,
            [
              "pairMetrics",
              viewIndex,
              "repeats",
              repeatIndex,
              "qualityScreenshotSha256",
            ],
            "pair metric must reference the matching quality screenshot",
          );
        }
        if (
          mobileRepeat === undefined ||
          metric.mobileScreenshotSha256 !== mobileRepeat.screenshot.sha256
        ) {
          addIssue(
            ctx,
            [
              "pairMetrics",
              viewIndex,
              "repeats",
              repeatIndex,
              "mobileScreenshotSha256",
            ],
            "pair metric must reference the matching mobile screenshot",
          );
        }
      }
    }
  },
);

type FoundryCapturedQualityComparisonReportPayloadV0 = z.infer<
  typeof ReportPayloadSchema
>;

export function computeFoundryCapturedQualityComparisonReportSha256(
  input: unknown,
): string {
  const payload = ReportPayloadSchema.parse(input);
  return domainSeparatedSha256(
    FOUNDRY_CAPTURED_QUALITY_COMPARISON_REPORT_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
}

export const FoundryCapturedQualityComparisonReportV0Schema =
  ReportPayloadObjectSchema.extend({
    reportSha256: Sha256Schema,
  })
    .strict()
    .superRefine((report, ctx) => {
      const { reportSha256: _reportSha256, ...payload } = report;
      const parsed = ReportPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) ctx.addIssue(issue);
        return;
      }
      if (
        report.reportSha256 !==
        computeFoundryCapturedQualityComparisonReportSha256(parsed.data)
      ) {
        addIssue(
          ctx,
          ["reportSha256"],
          "captured-quality comparison report digest does not match its payload",
        );
      }
    });

export type FoundryCapturedQualityComparisonReportV0 = z.infer<
  typeof FoundryCapturedQualityComparisonReportV0Schema
>;

export type CompileFoundryCapturedQualityComparisonReportV0Input = Omit<
  FoundryCapturedQualityComparisonReportPayloadV0,
  | "schemaVersion"
  | "authority"
  | "resultType"
  | "winner"
  | "limitations"
  | "externalRequests"
>;

const CompileInputSchema = ReportPayloadObjectSchema.omit({
  schemaVersion: true,
  authority: true,
  resultType: true,
  winner: true,
  limitations: true,
  externalRequests: true,
}).strict();

export function compileFoundryCapturedQualityComparisonReportV0(
  input: CompileFoundryCapturedQualityComparisonReportV0Input,
): FoundryCapturedQualityComparisonReportV0 {
  const parsedInput = CompileInputSchema.parse(input);
  const payload = ReportPayloadSchema.parse({
    ...parsedInput,
    schemaVersion: FOUNDRY_CAPTURED_QUALITY_COMPARISON_REPORT_V0,
    authority: "none",
    resultType: "regression_triage_not_acceptance",
    winner: "not_selected",
    limitations: [...FOUNDRY_CAPTURED_QUALITY_COMPARISON_LIMITATIONS],
    externalRequests: 0,
  });
  return FoundryCapturedQualityComparisonReportV0Schema.parse({
    ...payload,
    reportSha256:
      computeFoundryCapturedQualityComparisonReportSha256(payload),
  });
}

export function verifyFoundryCapturedQualityComparisonReportV0(
  input: unknown,
): FoundryCapturedQualityComparisonReportV0 {
  return FoundryCapturedQualityComparisonReportV0Schema.parse(input);
}

export function serializeFoundryCapturedQualityComparisonReportV0(
  value: FoundryCapturedQualityComparisonReportV0,
): string {
  return stableCanonicalJson(
    toCanonicalJson(
      FoundryCapturedQualityComparisonReportV0Schema.parse(value),
    ),
  );
}
