import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_CONTRACT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2,
  GrandHallT554NativeReviewHttpRequestSchemasV2,
} from "../grand-hall-t554-native-review-http-contract-v2.js";

const EPOCH_REVISION_GENERATION = {
  expectedBrowserEpochNumber: 1,
  expectedWorkspaceRevision: 0,
  renderGeneration: 1,
} as const;
const TILE = {
  expectedBrowserEpochNumber: 1,
  renderGeneration: 1,
  column: 0,
  row: 0,
} as const;
const COVERAGE = {
  expectedBrowserEpochNumber: 1,
  renderGeneration: 1,
  documentVisibilityState: "visible",
  documentFocusState: "focused",
  viewportCssWidth: 1_024,
  viewportCssHeight: 512,
  devicePixelRatio: 1,
  sourceToCssTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  paintedTiles: [{ column: 0, row: 0 }],
} as const;

describe("Grand Hall T-554 native review HTTP contract v2", () => {
  it("freezes the exact raw route table without aliases", () => {
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTTP_CONTRACT_V2).toBe(
      "venviewer.grand-hall-t554-native-review-http-contract.v2",
    );
    expect(Object.isFrozen(GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2)).toBe(
      true,
    );
    expect(Object.values(GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2)).toEqual(
      [
        "/",
        "/assets/t554-native-review-v2.css",
        "/assets/t554-native-review-v2.js",
        "/api/v2/bootstrap",
        "/api/v2/state",
        "/api/v2/source/select",
        "/api/v2/source/tile",
        "/api/v2/source/coverage",
        "/api/v2/source/exclude",
        "/api/v2/source/leave-pending",
        "/api/v2/mask/begin",
        "/api/v2/mask/edit",
        "/api/v2/mask/tile",
        "/api/v2/mask/freeze",
        "/api/v2/mask-review/tile",
        "/api/v2/mask-review/coverage",
        "/api/v2/source/include",
        "/api/v2/source/attest",
        "/api/v2/source/abandon",
        "/api/v2/session/stop",
      ],
    );
    expect(
      new Set(Object.values(GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2)).size,
    ).toBe(20);
  });

  it("freezes only v2 request and response schema strings", () => {
    expect(
      Object.isFrozen(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2,
      ),
    ).toBe(true);
    expect(
      Object.isFrozen(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2,
      ),
    ).toBe(true);
    for (const version of [
      ...Object.values(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2,
      ),
      ...Object.values(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2,
      ),
    ]) {
      expect(version.endsWith(".v2")).toBe(true);
    }
  });

  it("accepts one exact minimal body for every API schema", () => {
    const versions =
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2;
    const validBodies = {
      bootstrap: {
        schemaVersion: versions.bootstrap,
        bootstrapToken: "A".repeat(43),
      },
      state: { schemaVersion: versions.state },
      sourceSelect: {
        schemaVersion: versions.sourceSelect,
        expectedBrowserEpochNumber: 1,
        expectedWorkspaceRevision: 0,
        inventoryIndex: 0,
      },
      sourceTile: { schemaVersion: versions.sourceTile, ...TILE },
      sourceCoverage: { schemaVersion: versions.sourceCoverage, ...COVERAGE },
      sourceExclude: {
        schemaVersion: versions.sourceExclude,
        ...EPOCH_REVISION_GENERATION,
        note: "No Grand Hall pixels.",
      },
      sourceLeavePending: {
        schemaVersion: versions.sourceLeavePending,
        ...EPOCH_REVISION_GENERATION,
      },
      maskBegin: {
        schemaVersion: versions.maskBegin,
        ...EPOCH_REVISION_GENERATION,
      },
      maskEdit: {
        schemaVersion: versions.maskEdit,
        ...EPOCH_REVISION_GENERATION,
        edit: {
          expectedRevision: 0,
          operation: "include",
          primitive: {
            kind: "rectangle",
            horizontalSeam: "none",
            leftPx: 0,
            topPx: 0,
            rightExclusivePx: 1,
            bottomExclusivePx: 1,
          },
        },
      },
      maskTile: { schemaVersion: versions.maskTile, ...TILE },
      maskFreeze: {
        schemaVersion: versions.maskFreeze,
        ...EPOCH_REVISION_GENERATION,
        expectedMaskRevision: 1,
      },
      maskReviewTile: { schemaVersion: versions.maskReviewTile, ...TILE },
      maskReviewCoverage: {
        schemaVersion: versions.maskReviewCoverage,
        ...COVERAGE,
      },
      sourceInclude: {
        schemaVersion: versions.sourceInclude,
        ...EPOCH_REVISION_GENERATION,
        classification: "grand_hall_core",
        note: "Human-reviewed Grand Hall pixels.",
      },
      sourceAttest: {
        schemaVersion: versions.sourceAttest,
        ...EPOCH_REVISION_GENERATION,
        reviewerId: "reviewer-1",
        knowledgeBasis: ["Direct visual review"],
      },
      sourceAbandon: {
        schemaVersion: versions.sourceAbandon,
        ...EPOCH_REVISION_GENERATION,
      },
      sessionStop: {
        schemaVersion: versions.sessionStop,
        expectedBrowserEpochNumber: 1,
        expectedWorkspaceRevision: 0,
      },
    } as const;

    for (const name of Object.keys(
      GrandHallT554NativeReviewHttpRequestSchemasV2,
    ) as (keyof typeof GrandHallT554NativeReviewHttpRequestSchemasV2)[]) {
      expect(
        GrandHallT554NativeReviewHttpRequestSchemasV2[name].safeParse(
          validBodies[name],
        ).success,
        name,
      ).toBe(true);
    }
  });

  it.each([
    "path",
    "url",
    "hash",
    "digest",
    "bitmap",
    "dwell",
    "timestamp",
    "authority",
    "acceptance",
    "upload",
    "export",
    "runtime",
    "reconstruction",
    "crash",
    "takeover",
  ])("rejects browser-supplied prohibited field %s", (field) => {
    expect(
      GrandHallT554NativeReviewHttpRequestSchemasV2.state.safeParse({
        schemaVersion:
          GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.state,
        [field]: "forged",
      }).success,
    ).toBe(false);
  });

  it("does not let the browser choose an abandon reason", () => {
    expect(
      GrandHallT554NativeReviewHttpRequestSchemasV2.sourceAbandon.safeParse({
        schemaVersion:
          GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.sourceAbandon,
        ...EPOCH_REVISION_GENERATION,
        reason: "session_stop",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate painted coordinates and non-uniform transforms", () => {
    const schema = GrandHallT554NativeReviewHttpRequestSchemasV2.sourceCoverage;
    const schemaVersion =
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.sourceCoverage;
    expect(
      schema.safeParse({
        schemaVersion,
        ...COVERAGE,
        paintedTiles: [
          { column: 0, row: 0 },
          { column: 0, row: 0 },
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        schemaVersion,
        ...COVERAGE,
        sourceToCssTransform: { a: 1, b: 0, c: 0, d: 2, e: 0, f: 0 },
      }).success,
    ).toBe(false);
  });
});
