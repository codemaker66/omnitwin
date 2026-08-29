import { z } from "zod";

import { GrandHallT554NativeReviewMaskEditV2Schema } from "./grand-hall-t554-native-review-events-v2.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_HTTP_CONTRACT_V2 =
  "venviewer.grand-hall-t554-native-review-http-contract.v2";

export const GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2 = Object.freeze({
  document: "/",
  stylesheet: "/assets/t554-native-review-v2.css",
  script: "/assets/t554-native-review-v2.js",
  bootstrap: "/api/v2/bootstrap",
  state: "/api/v2/state",
  sourceSelect: "/api/v2/source/select",
  sourceTile: "/api/v2/source/tile",
  sourceCoverage: "/api/v2/source/coverage",
  sourceExclude: "/api/v2/source/exclude",
  sourceLeavePending: "/api/v2/source/leave-pending",
  maskBegin: "/api/v2/mask/begin",
  maskEdit: "/api/v2/mask/edit",
  maskTile: "/api/v2/mask/tile",
  maskFreeze: "/api/v2/mask/freeze",
  maskReviewTile: "/api/v2/mask-review/tile",
  maskReviewCoverage: "/api/v2/mask-review/coverage",
  sourceInclude: "/api/v2/source/include",
  sourceAttest: "/api/v2/source/attest",
  sourceAbandon: "/api/v2/source/abandon",
  sessionStop: "/api/v2/session/stop",
} as const);

export const GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2 =
  Object.freeze({
    bootstrap:
      "venviewer.grand-hall-t554-native-review-http-bootstrap-request.v2",
    state: "venviewer.grand-hall-t554-native-review-http-state-request.v2",
    sourceSelect:
      "venviewer.grand-hall-t554-native-review-http-source-select-request.v2",
    sourceTile:
      "venviewer.grand-hall-t554-native-review-http-source-tile-request.v2",
    sourceCoverage:
      "venviewer.grand-hall-t554-native-review-http-source-coverage-request.v2",
    sourceExclude:
      "venviewer.grand-hall-t554-native-review-http-source-exclude-request.v2",
    sourceLeavePending:
      "venviewer.grand-hall-t554-native-review-http-source-leave-pending-request.v2",
    maskBegin:
      "venviewer.grand-hall-t554-native-review-http-mask-begin-request.v2",
    maskEdit:
      "venviewer.grand-hall-t554-native-review-http-mask-edit-request.v2",
    maskTile:
      "venviewer.grand-hall-t554-native-review-http-mask-tile-request.v2",
    maskFreeze:
      "venviewer.grand-hall-t554-native-review-http-mask-freeze-request.v2",
    maskReviewTile:
      "venviewer.grand-hall-t554-native-review-http-mask-review-tile-request.v2",
    maskReviewCoverage:
      "venviewer.grand-hall-t554-native-review-http-mask-review-coverage-request.v2",
    sourceInclude:
      "venviewer.grand-hall-t554-native-review-http-source-include-request.v2",
    sourceAttest:
      "venviewer.grand-hall-t554-native-review-http-source-attest-request.v2",
    sourceAbandon:
      "venviewer.grand-hall-t554-native-review-http-source-abandon-request.v2",
    sessionStop:
      "venviewer.grand-hall-t554-native-review-http-session-stop-request.v2",
  } as const);

export const GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2 =
  Object.freeze({
    bootstrap:
      "venviewer.grand-hall-t554-native-review-http-bootstrap-response.v2",
    error: "venviewer.grand-hall-t554-native-review-http-error-response.v2",
    operatorState:
      "venviewer.grand-hall-t554-native-review-operator-session.v2",
    sourceTile:
      "venviewer.grand-hall-t554-native-review-operator-source-tile.v2",
    maskTile: "venviewer.grand-hall-t554-native-review-operator-mask-tile.v2",
    sourceCoverage:
      "venviewer.grand-hall-t554-native-review-operator-source-coverage-ack.v2",
    maskCoverage:
      "venviewer.grand-hall-t554-native-review-operator-mask-coverage-ack.v2",
  } as const);

const SafeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const PositiveSafeIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const BrowserEpochNumberSchema = PositiveSafeIntegerSchema;
const WorkspaceRevisionSchema = SafeIntegerSchema;
const RenderGenerationSchema = PositiveSafeIntegerSchema;
const TileColumnSchema = z.number().int().min(0).max(31);
const TileRowSchema = z.number().int().min(0).max(15);
const PaintedTileSchema = z
  .object({ column: TileColumnSchema, row: TileRowSchema })
  .strict();
const PaintedTilesSchema = z
  .array(PaintedTileSchema)
  .max(512)
  .superRefine((tiles, context) => {
    const seen = new Set<number>();
    for (let index = 0; index < tiles.length; index += 1) {
      const tile = tiles[index];
      if (tile === undefined) continue;
      const tileIndex = tile.row * 32 + tile.column;
      if (seen.has(tileIndex)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "paintedTiles coordinates must be unique",
          path: [index],
        });
      }
      seen.add(tileIndex);
    }
  });
const SourceToCssTransformSchema = z
  .object({
    a: z.number().finite().positive().max(64),
    b: z.literal(0),
    c: z.literal(0),
    d: z.number().finite().positive().max(64),
    e: z.number().finite().min(-1_000_000).max(1_000_000),
    f: z.number().finite().min(-1_000_000).max(1_000_000),
  })
  .strict()
  .superRefine((matrix, context) => {
    if (Math.abs(matrix.a - matrix.d) > 1e-9) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "source transform must use one uniform scale",
        path: ["d"],
      });
    }
  });
const EpochRevisionGenerationShape = {
  expectedBrowserEpochNumber: BrowserEpochNumberSchema,
  expectedWorkspaceRevision: WorkspaceRevisionSchema,
  renderGeneration: RenderGenerationSchema,
};
const TileShape = {
  expectedBrowserEpochNumber: BrowserEpochNumberSchema,
  renderGeneration: RenderGenerationSchema,
  column: TileColumnSchema,
  row: TileRowSchema,
};
const CoverageShape = {
  expectedBrowserEpochNumber: BrowserEpochNumberSchema,
  renderGeneration: RenderGenerationSchema,
  documentVisibilityState: z.enum(["visible", "hidden", "prerender"]),
  documentFocusState: z.enum(["focused", "blurred"]),
  viewportCssWidth: z.number().finite().positive().max(16_384),
  viewportCssHeight: z.number().finite().positive().max(16_384),
  devicePixelRatio: z.number().finite().min(0.25).max(8),
  sourceToCssTransform: SourceToCssTransformSchema,
  paintedTiles: PaintedTilesSchema,
};

function schemaVersion<T extends string>(version: T): z.ZodLiteral<T> {
  return z.literal(version);
}

export const GrandHallT554NativeReviewHttpRequestSchemasV2 = Object.freeze({
  bootstrap: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.bootstrap,
      ),
      bootstrapToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    })
    .strict(),
  state: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.state,
      ),
    })
    .strict(),
  sourceSelect: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.sourceSelect,
      ),
      expectedBrowserEpochNumber: BrowserEpochNumberSchema,
      expectedWorkspaceRevision: WorkspaceRevisionSchema,
      inventoryIndex: z.number().int().min(0).max(147),
    })
    .strict(),
  sourceTile: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.sourceTile,
      ),
      ...TileShape,
    })
    .strict(),
  sourceCoverage: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.sourceCoverage,
      ),
      ...CoverageShape,
    })
    .strict(),
  sourceExclude: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.sourceExclude,
      ),
      ...EpochRevisionGenerationShape,
      note: z.string().trim().min(1).max(1_000),
    })
    .strict(),
  sourceLeavePending: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.sourceLeavePending,
      ),
      ...EpochRevisionGenerationShape,
    })
    .strict(),
  maskBegin: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.maskBegin,
      ),
      ...EpochRevisionGenerationShape,
    })
    .strict(),
  maskEdit: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.maskEdit,
      ),
      ...EpochRevisionGenerationShape,
      edit: GrandHallT554NativeReviewMaskEditV2Schema,
    })
    .strict(),
  maskTile: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.maskTile,
      ),
      ...TileShape,
    })
    .strict(),
  maskFreeze: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.maskFreeze,
      ),
      ...EpochRevisionGenerationShape,
      expectedMaskRevision: WorkspaceRevisionSchema,
    })
    .strict(),
  maskReviewTile: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.maskReviewTile,
      ),
      ...TileShape,
    })
    .strict(),
  maskReviewCoverage: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.maskReviewCoverage,
      ),
      ...CoverageShape,
    })
    .strict(),
  sourceInclude: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.sourceInclude,
      ),
      ...EpochRevisionGenerationShape,
      classification: z.enum([
        "grand_hall_core",
        "grand_hall_portal_threshold",
      ]),
      note: z.string().trim().min(1).max(1_000),
    })
    .strict(),
  sourceAttest: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.sourceAttest,
      ),
      ...EpochRevisionGenerationShape,
      reviewerId: z.string().trim().min(1).max(160),
      knowledgeBasis: z.array(z.string().trim().min(1).max(240)).min(1).max(32),
    })
    .strict(),
  sourceAbandon: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.sourceAbandon,
      ),
      ...EpochRevisionGenerationShape,
    })
    .strict(),
  sessionStop: z
    .object({
      schemaVersion: schemaVersion(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.sessionStop,
      ),
      expectedBrowserEpochNumber: BrowserEpochNumberSchema,
      expectedWorkspaceRevision: WorkspaceRevisionSchema,
    })
    .strict(),
});

export type GrandHallT554NativeReviewHttpBootstrapRequestV2 = z.infer<
  typeof GrandHallT554NativeReviewHttpRequestSchemasV2.bootstrap
>;
