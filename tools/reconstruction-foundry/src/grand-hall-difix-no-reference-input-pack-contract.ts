import {
  VisualLineageActualCameraV0Schema,
  VisualLineageActualRendererV0Schema,
  VisualLineageCameraV0Schema,
  VisualLineageEnvironmentV0Schema,
  VisualLineageRendererSettingsV0Schema,
  VisualLineageSourceMemberV0Schema,
  VisualLineageSparkRuntimeStateV0Schema,
} from "@omnitwin/types";
import { z } from "zod";

export const GRAND_HALL_DIFIX_CAPTURE_MODE =
  "difix-no-reference-input-1024x576-v1";
export const GRAND_HALL_DIFIX_CAPTURE_BENCHMARK_ID =
  "grand-hall-sog-source-pose-19890-difix-input-1024x576-v1";
export const GRAND_HALL_DIFIX_CAPTURE_METHOD =
  "playwright_canvas_element_screenshot";
export const GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX =
  "VENVIEWER_CAPTURE_EVIDENCE_V1:";
export const GRAND_HALL_DIFIX_INPUT_PACK_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-input-pack.v1";
export const GRAND_HALL_DIFIX_CAMERA_ARTIFACT_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-camera-artifact.v1";
export const GRAND_HALL_DIFIX_RENDERER_ARTIFACT_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-renderer-artifact.v1";
export const GRAND_HALL_DIFIX_RECONSTRUCTION_ARTIFACT_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-reconstruction-artifact.v1";
export const GRAND_HALL_DIFIX_RENDER_GENERATION_RECEIPT_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-render-generation-receipt.v1";
export const GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-input-pack-publication-receipt.v1";

export const GRAND_HALL_DIFIX_INPUT_WIDTH = 1_024;
export const GRAND_HALL_DIFIX_INPUT_HEIGHT = 576;
// Playwright's `toBeCloseTo(1, 6)` uses an exclusive half-unit tolerance at
// the sixth decimal place. Chrome may expose a nominal DPR of one with this
// small IEEE-754/OS-scale drift, so retain the observation and classify only
// the capture intent with the same bound.
export const GRAND_HALL_DIFIX_NOMINAL_DPR_ONE_ABSOLUTE_TOLERANCE = 5e-7;
export const GRAND_HALL_DIFIX_SOURCE_RENDER_FILENAME = "source-render.png";
export const GRAND_HALL_DIFIX_BROWSER_RECORD_FILENAME = "browser-capture-record.json";
export const GRAND_HALL_DIFIX_PROTECTED_MASK_FILENAME = "protected-mask.png";
export const GRAND_HALL_DIFIX_GENERATED_MASK_FILENAME = "generated-region-mask.png";
export const GRAND_HALL_DIFIX_MANIFEST_FILENAME = "manifest.authority-none.json";
export const GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME = "publication-receipt.json";

export const GRAND_HALL_DIFIX_EXPECTED_CAMERA = Object.freeze({
  id: "source-pose-19890-interior-v1",
  revision: 1,
  sourceFrame: "THREE_CAMERA",
  position: Object.freeze([-0.03426186932373998, 2.15606153541565, 8.015104841842623]),
  quaternion: Object.freeze([0, -0.01170873415725777, 0, 0.999931450422695]),
  projection: "perspective",
  fov: 60,
  near: 0.05,
  far: 80,
  aspect: 16 / 9,
  projectionMatrix: Object.freeze([
    0.9742785792574936, 0, 0, 0,
    0, 1.7320508075688774, 0, 0,
    0, 0, -1.0012507817385865, -1,
    0, 0, -0.10006253908692933, 0,
  ]),
} as const);

export const GRAND_HALL_DIFIX_EXPECTED_SOURCE_MEMBERS = Object.freeze([
  ["0_0_0_1_0_1.sog", 9_980_174, "97efa65f9aaddbd69780664c6668817125c3153469918d5f291b348ee0b6d7e1"],
  ["0_1_0_1_0_0.sog", 9_500_250, "2b0c0cce30cb31a34b253d5985985b3d547debe8bca1a97401eb72ab3ad3bdbf"],
  ["0_2_0_0_1_1.sog", 10_575_631, "b354ba55785e73a42aa4d108ac0c1fb93c333cbf5bd881e6c75149c2cecccd3e"],
  ["0_3_0_0_0_0.sog", 10_376_269, "e590fb5d7488071c63f10df33b31e451f3c0348c2209f1bf594015c28a1fff24"],
  ["0_3_0_1_0_1.sog", 10_207_866, "84b2ff813e0746d8fc8dfcc9d044dba15fef5f62ca137794c30989c04ba82a9d"],
  ["0_4_0_1_0_0.sog", 9_199_768, "5863e052c6f99316914df9168829543b82fb35db0118b5e02d30e4d326a79d03"],
  ["0_5_0_0_0_1.sog", 8_975_642, "65fd21b69a1def23cb4bd5b756da7ac03e4451a476a80a61c47b853a0366a8f1"],
  ["0_5_0_1_0_1.sog", 9_708_760, "d3272fee659e486190af1d2ac9427c39e5536bc85b90b5570df4b6e9e9124631"],
  ["0_6_0_0_0_1.sog", 10_231_737, "18e23290236bb3f220df2b59f6f255a421151c0f1da7ed633bd00d06eddf0171"],
  ["0_7_0_0_0_0.sog", 9_417_293, "7c4cca3644294c2955cfe9e41f387e70ce79e1aedcca132392c0493325ce4386"],
  ["0_7_0_0_0_1.sog", 8_306_348, "5e4409b07084ce7089e77a17d1eec0d2c4691f7a9d9e52f55ef752529d356ea9"],
].map(([fileName, sizeBytes, sha256]) => Object.freeze({
  relativePath: `scans_BIG_MODEL_TH_GH_1/lcc2-result/data/3dgs/${String(fileName)}`,
  sizeBytes: Number(sizeBytes),
  sha256: `sha256:${String(sha256)}`,
})));

export const GRAND_HALL_DIFIX_EXPECTED_GAUSSIAN_COUNT = 6_019_684;

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const FileNameSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,179}$/u);
const PreservedDevicePixelRatioSchema = z.number().finite().positive();

export function isGrandHallDifixNominalDprOne(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value > 0
    && Math.abs(value - 1) < GRAND_HALL_DIFIX_NOMINAL_DPR_ONE_ABSOLUTE_TOLERANCE;
}

export const GrandHallDifixFileReceiptSchema = z.object({
  fileName: FileNameSchema,
  sizeBytes: z.number().int().positive(),
  sha256: Sha256Schema,
}).strict();

const SourceRenderReceiptSchema = GrandHallDifixFileReceiptSchema.extend({
  fileName: z.literal(GRAND_HALL_DIFIX_SOURCE_RENDER_FILENAME),
}).strict();

const BrowserRecordReceiptSchema = GrandHallDifixFileReceiptSchema.extend({
  fileName: z.literal(GRAND_HALL_DIFIX_BROWSER_RECORD_FILENAME),
}).strict();

export const GrandHallDifixObservedCaptureSchema = z.object({
  method: z.literal(GRAND_HALL_DIFIX_CAPTURE_METHOD),
  canvasWidth: z.literal(GRAND_HALL_DIFIX_INPUT_WIDTH),
  canvasHeight: z.literal(GRAND_HALL_DIFIX_INPUT_HEIGHT),
  devicePixelRatio: PreservedDevicePixelRatioSchema,
  contextAntialias: z.literal(false),
  resizeApplied: z.literal(false),
}).strict();

export const GrandHallDifixArtifactReferenceSchema = GrandHallDifixFileReceiptSchema.extend({
  artifactType: z.enum(["camera", "renderer", "reconstruction", "render_generation"]),
}).strict();

export const GrandHallDifixAuthorityGuardsSchema = z.object({
  authority: z.literal("none"),
  providerExecutionPermitted: z.literal(false),
  modelTrainingPermitted: z.literal(false),
  reconstructionReplacementPermitted: z.literal(false),
  sourceTruthReplacementPermitted: z.literal(false),
  runtimeAdmissionPermitted: z.literal(false),
  stagingPermitted: z.literal(false),
  publicationPermitted: z.literal(false),
  productionPromotionPermitted: z.literal(false),
}).strict();

export const GrandHallDifixCameraArtifactSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_DIFIX_CAMERA_ARTIFACT_SCHEMA),
  authority: z.literal("none"),
  roomRef: z.literal("trades-hall/grand-hall"),
  sourcePoseIndex: z.literal(19_890),
  sourcePoseAuthority: z.literal("position_derived_inspection_only"),
  opticalCalibrationAuthority: z.literal("none"),
  fixedCamera: VisualLineageCameraV0Schema,
  observedCamera: VisualLineageActualCameraV0Schema,
}).strict();

export const GrandHallDifixRendererArtifactSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_DIFIX_RENDERER_ARTIFACT_SCHEMA),
  authority: z.literal("none"),
  roomRef: z.literal("trades-hall/grand-hall"),
  engine: z.literal("Three.js 0.180 / Spark 2.0"),
  viewport: z.object({
    width: z.literal(GRAND_HALL_DIFIX_INPUT_WIDTH),
    height: z.literal(GRAND_HALL_DIFIX_INPUT_HEIGHT),
    devicePixelRatio: PreservedDevicePixelRatioSchema,
  }).strict(),
  observedCapture: GrandHallDifixObservedCaptureSchema,
  directCanvasCapture: z.literal(true),
  resizeApplied: z.literal(false),
  rendererClass: z.literal("hardware"),
  settings: VisualLineageRendererSettingsV0Schema,
  observedRenderer: VisualLineageActualRendererV0Schema,
  environment: VisualLineageEnvironmentV0Schema,
}).strict();

export const GrandHallDifixReconstructionArtifactSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_DIFIX_RECONSTRUCTION_ARTIFACT_SCHEMA),
  authority: z.literal("none"),
  roomRef: z.literal("trades-hall/grand-hall"),
  truthClass: z.literal("source_derived_reconstruction_render_input"),
  format: z.literal("sog"),
  representationId: z.literal("exact-sog-frontier"),
  sourceVariant: z.literal("scans_BIG_MODEL_TH_GH_1"),
  sourceMembers: z.array(VisualLineageSourceMemberV0Schema).length(11),
  decodedSplatCount: z.literal(GRAND_HALL_DIFIX_EXPECTED_GAUSSIAN_COUNT),
  runtimeState: VisualLineageSparkRuntimeStateV0Schema,
}).strict();

export const GrandHallDifixRenderGenerationReceiptSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_DIFIX_RENDER_GENERATION_RECEIPT_SCHEMA),
  authority: z.literal("none"),
  roomRef: z.literal("trades-hall/grand-hall"),
  captureMode: z.literal(GRAND_HALL_DIFIX_CAPTURE_MODE),
  benchmarkId: z.literal(GRAND_HALL_DIFIX_CAPTURE_BENCHMARK_ID),
  truthClass: z.literal("source_derived_diagnostic_render"),
  capturedSourceTruthClaimed: z.literal(false),
  generatedContentPresent: z.literal(false),
  directCanvasCapture: z.literal(true),
  resizeApplied: z.literal(false),
  sourceRender: SourceRenderReceiptSchema,
  browserCaptureRecord: BrowserRecordReceiptSchema,
  git: z.object({
    commitSha: z.string().regex(/^[a-f0-9]{40}$/u),
    worktreeDirty: z.boolean(),
    sourceStateSha256: Sha256Schema,
  }).strict(),
  runStartedAt: z.string().datetime({ offset: true }),
  runCompletedAt: z.string().datetime({ offset: true }),
  cameraArtifact: GrandHallDifixArtifactReferenceSchema,
  rendererArtifact: GrandHallDifixArtifactReferenceSchema,
  reconstructionArtifact: GrandHallDifixArtifactReferenceSchema,
  limitations: z.tuple([
    z.literal("Inspection-only camera; not source optical calibration or accepted metric camera authority."),
    z.literal("Source-derived diagnostic render; not captured-source truth and not an accepted room-boundary result."),
    z.literal("No provider execution, generated fill, reconstruction replacement, runtime admission, staging, publication, or production promotion authority."),
  ]),
}).strict();

export const GrandHallDifixInputPackManifestSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_DIFIX_INPUT_PACK_SCHEMA),
  packId: z.literal("trades-hall-grand-hall-difix-no-reference-source-pose-19890-v1"),
  authority: GrandHallDifixAuthorityGuardsSchema,
  roomRef: z.literal("trades-hall/grand-hall"),
  inputLane: z.literal("source_derived_diagnostic"),
  providerTarget: z.literal("difix_no_reference_diagnostic"),
  sourceRender: SourceRenderReceiptSchema,
  browserCaptureRecord: BrowserRecordReceiptSchema,
  protectedMask: GrandHallDifixFileReceiptSchema.extend({
    fileName: z.literal(GRAND_HALL_DIFIX_PROTECTED_MASK_FILENAME),
    semantics: z.literal("white_255_means_protected"),
    protectedPixelCount: z.literal(GRAND_HALL_DIFIX_INPUT_WIDTH * GRAND_HALL_DIFIX_INPUT_HEIGHT),
  }).strict(),
  generatedRegionMask: GrandHallDifixFileReceiptSchema.extend({
    fileName: z.literal(GRAND_HALL_DIFIX_GENERATED_MASK_FILENAME),
    semantics: z.literal("white_255_means_generated_region"),
    generatedPixelCount: z.literal(0),
  }).strict(),
  cameraArtifact: GrandHallDifixArtifactReferenceSchema,
  rendererArtifact: GrandHallDifixArtifactReferenceSchema,
  reconstructionArtifact: GrandHallDifixArtifactReferenceSchema,
  renderGenerationReceipt: GrandHallDifixArtifactReferenceSchema,
  bundleMaterialSha256: Sha256Schema,
}).strict();

export const GrandHallDifixPublicationReceiptSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_SCHEMA),
  authority: z.literal("none"),
  outputState: z.literal("complete_authority_none"),
  receiptWrittenLast: z.literal(true),
  manifest: GrandHallDifixFileReceiptSchema.extend({
    fileName: z.literal(GRAND_HALL_DIFIX_MANIFEST_FILENAME),
  }).strict(),
  filesBeforeReceipt: z.array(GrandHallDifixFileReceiptSchema).length(9),
  bundleMaterialSha256: Sha256Schema,
}).strict();

export type GrandHallDifixFileReceipt = z.infer<typeof GrandHallDifixFileReceiptSchema>;
export type GrandHallDifixArtifactReference = z.infer<typeof GrandHallDifixArtifactReferenceSchema>;
export type GrandHallDifixObservedCapture = z.infer<typeof GrandHallDifixObservedCaptureSchema>;
export type GrandHallDifixCameraArtifact = z.infer<typeof GrandHallDifixCameraArtifactSchema>;
export type GrandHallDifixRendererArtifact = z.infer<typeof GrandHallDifixRendererArtifactSchema>;
export type GrandHallDifixReconstructionArtifact = z.infer<typeof GrandHallDifixReconstructionArtifactSchema>;
export type GrandHallDifixRenderGenerationReceipt = z.infer<typeof GrandHallDifixRenderGenerationReceiptSchema>;
export type GrandHallDifixInputPackManifest = z.infer<typeof GrandHallDifixInputPackManifestSchema>;
export type GrandHallDifixPublicationReceipt = z.infer<typeof GrandHallDifixPublicationReceiptSchema>;
