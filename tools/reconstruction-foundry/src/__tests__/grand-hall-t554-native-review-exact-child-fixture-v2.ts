import { createHash } from "node:crypto";
import { link, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
} from "@omnitwin/types";

import type {
  GrandHallT554NativeReviewDurableJournalReplayV2,
} from "../grand-hall-t554-native-review-durable-journal-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
  type GrandHallT554NativeReviewCoverageObservedPayloadV2,
  type GrandHallT554NativeReviewMaskChildEventV2,
  type GrandHallT554NativeReviewMaskScopeV2,
  type GrandHallT554NativeReviewSourceChildEventV2,
  type GrandHallT554NativeReviewSourceScopeV2,
} from "../grand-hall-t554-native-review-events-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_DOMAIN,
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_SCHEMA,
} from "../grand-hall-t554-native-review-journal.js";
import {
  computeGrandHallT554NativeReviewCoverageEventV2Sha256,
  emptyGrandHallT554NativeReviewTileBitmapV2,
} from "../grand-hall-t554-native-review-replay-v2.js";

type Sha256 = `sha256:${string}`;

function digest(seed: string | Buffer): Sha256 {
  const bytes = typeof seed === "string" ? Buffer.from(seed, "utf8") : seed;
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

function envelope<const EventType extends string, const Payload>(
  eventType: EventType,
  payload: Payload,
) {
  return {
    schemaVersion:
      GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2 as typeof GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
    eventType,
    payload,
  };
}

function sourceDeliveryEvent(
  scope: GrandHallT554NativeReviewSourceScopeV2,
  tileIndex: number,
) {
  return envelope("source.tile-delivered.v2", {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-tile-delivered.v2" as const,
    browserEpochNonceSha256: scope.browserEpochNonceSha256,
    sourceEpochNonceSha256: scope.sourceCustody.sourceEpochNonceSha256,
    coverageSegmentIdSha256: scope.coverageSegmentIdSha256,
    subjectSha256: scope.sourceCustody.sourceReviewSubjectSha256,
    renderGeneration: scope.renderGeneration,
    column: tileIndex % 32,
    row: Math.floor(tileIndex / 32),
    tileIndex,
    responseFinishedAtUtc: "2000-01-01T00:00:00.001Z",
  });
}

export function completeSourceCoverageEvents(
  scope: GrandHallT554NativeReviewSourceScopeV2,
): readonly GrandHallT554NativeReviewSourceChildEventV2[] {
  const fullBitmap = "ff".repeat(64);
  const delivered = Array.from({ length: 512 }, (_, tileIndex) =>
    sourceDeliveryEvent(scope, tileIndex),
  );
  const zeroDwell = Buffer.alloc(1_024);
  const partialDwell = Buffer.alloc(1_024);
  const fullDwell = Buffer.alloc(1_024);
  for (let index = 0; index < 512; index += 1) {
    partialDwell.writeUInt16LE(500, index * 2);
    fullDwell.writeUInt16LE(750, index * 2);
  }
  const dwellDigest = (bytes: Buffer): Sha256 =>
    digest(
      Buffer.concat([
        Buffer.from(
          "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_DWELL_STATE_V2\n",
          "utf8",
        ),
        bytes,
      ]),
    );
  const firstMaterial: Omit<
    GrandHallT554NativeReviewCoverageObservedPayloadV2,
    "coverageEventSha256"
  > = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-coverage-observed.v2",
    browserEpochNonceSha256: scope.browserEpochNonceSha256,
    sourceEpochNonceSha256: scope.sourceCustody.sourceEpochNonceSha256,
    coverageSegmentIdSha256: scope.coverageSegmentIdSha256,
    subjectSha256: scope.sourceCustody.sourceReviewSubjectSha256,
    renderGeneration: scope.renderGeneration,
    sequence: 0,
    previousCoverageEventSha256: null,
    serverObservation: {
      receivedAtUtc: "2000-01-01T00:00:00.002Z",
      monotonicElapsedMs: 0,
    },
    telemetry: {
      documentVisibilityState: "visible",
      documentFocusState: "focused",
      viewportCssWidth: GRAND_HALL_PANORAMA_WIDTH_PX,
      viewportCssHeight: GRAND_HALL_PANORAMA_HEIGHT_PX,
      devicePixelRatio: 1,
      sourceToCssTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      paintedTileBitsetHex: fullBitmap,
    },
    derived: {
      effectiveDevicePixelsPerSourcePixel: 1,
      serverMonotonicDeltaMs: 0,
      deliveredTileBitsetHex: fullBitmap,
      fullyVisibleDeliveredTileBitsetHex: fullBitmap,
      creditedTileBitsetHex: emptyGrandHallT554NativeReviewTileBitmapV2(),
      creditedDurationMs: 0,
      disqualifier: "first_sample",
      completedTileBitsetHex: emptyGrandHallT554NativeReviewTileBitmapV2(),
      completedTileCount: 0,
      cumulativeDwellStateSha256: dwellDigest(zeroDwell),
    },
  };
  const firstPayload: GrandHallT554NativeReviewCoverageObservedPayloadV2 = {
    ...firstMaterial,
    coverageEventSha256:
      computeGrandHallT554NativeReviewCoverageEventV2Sha256(
        "source",
        firstMaterial,
      ),
  };
  const partialMaterial: Omit<
    GrandHallT554NativeReviewCoverageObservedPayloadV2,
    "coverageEventSha256"
  > = {
    ...firstMaterial,
    sequence: 1,
    previousCoverageEventSha256: firstPayload.coverageEventSha256,
    serverObservation: {
      receivedAtUtc: "2000-01-01T00:00:00.502Z",
      monotonicElapsedMs: 500,
    },
    derived: {
      effectiveDevicePixelsPerSourcePixel: 1,
      serverMonotonicDeltaMs: 500,
      deliveredTileBitsetHex: fullBitmap,
      fullyVisibleDeliveredTileBitsetHex: fullBitmap,
      creditedTileBitsetHex: fullBitmap,
      creditedDurationMs: 500,
      disqualifier: null,
      completedTileBitsetHex: emptyGrandHallT554NativeReviewTileBitmapV2(),
      completedTileCount: 0,
      cumulativeDwellStateSha256: dwellDigest(partialDwell),
    },
  };
  const partialPayload: GrandHallT554NativeReviewCoverageObservedPayloadV2 = {
    ...partialMaterial,
    coverageEventSha256:
      computeGrandHallT554NativeReviewCoverageEventV2Sha256(
        "source",
        partialMaterial,
      ),
  };
  const finalMaterial: Omit<
    GrandHallT554NativeReviewCoverageObservedPayloadV2,
    "coverageEventSha256"
  > = {
    ...partialMaterial,
    sequence: 2,
    previousCoverageEventSha256: partialPayload.coverageEventSha256,
    serverObservation: {
      receivedAtUtc: "2000-01-01T00:00:00.752Z",
      monotonicElapsedMs: 750,
    },
    derived: {
      effectiveDevicePixelsPerSourcePixel: 1,
      serverMonotonicDeltaMs: 250,
      deliveredTileBitsetHex: fullBitmap,
      fullyVisibleDeliveredTileBitsetHex: fullBitmap,
      creditedTileBitsetHex: fullBitmap,
      creditedDurationMs: 250,
      disqualifier: null,
      completedTileBitsetHex: fullBitmap,
      completedTileCount: 512,
      cumulativeDwellStateSha256: dwellDigest(fullDwell),
    },
  };
  zeroDwell.fill(0);
  partialDwell.fill(0);
  fullDwell.fill(0);
  return [
    ...delivered,
    envelope("source.coverage-observed.v2", firstPayload),
    envelope("source.coverage-observed.v2", partialPayload),
    envelope("source.coverage-observed.v2", {
      ...finalMaterial,
      coverageEventSha256:
        computeGrandHallT554NativeReviewCoverageEventV2Sha256(
          "source",
          finalMaterial,
        ),
    }),
  ];
}

export async function bulkAppendExactChildFixture(input: {
  readonly journalRoot: string;
  readonly start: GrandHallT554NativeReviewDurableJournalReplayV2;
  readonly scope:
    | GrandHallT554NativeReviewSourceScopeV2
    | GrandHallT554NativeReviewMaskScopeV2;
  readonly events: readonly (
    | GrandHallT554NativeReviewSourceChildEventV2
    | GrandHallT554NativeReviewMaskChildEventV2
  )[];
}): Promise<void> {
  const recordedAtUtc = input.start.records.at(-1)?.recordedAtUtc;
  if (recordedAtUtc === undefined) {
    throw new Error("bulk fixture requires one durable start record");
  }
  let previousEventSha256 = input.start.headEventSha256;
  const files = input.events.map((event, offset) => {
    const sequence = input.start.revision + offset + 1;
    const material = {
      schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_SCHEMA,
      sequence,
      previousEventSha256,
      scope: input.start.lowLevelScope,
      scopeSha256: input.start.lowLevelScopeSha256,
      scopeFileSha256: input.start.lowLevelScopeFileSha256,
      recordedAtUtc,
      eventType: event.eventType,
      payload: toCanonicalJson({
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-durable-scoped-event.v2",
        scopedEvent: { scope: input.scope, event },
      }),
    };
    const eventSha256 = `sha256:${domainSeparatedSha256(
      GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_DOMAIN,
      toCanonicalJson(material),
    )}` as const;
    previousEventSha256 = eventSha256;
    return {
      claimName: `${String(sequence).padStart(16, "0")}.json`,
      eventName: `${String(sequence).padStart(16, "0")}-${eventSha256.replace(":", "-")}.json`,
      bytes: canonicalBytes({ ...material, eventSha256 }),
    };
  });
  for (let offset = 0; offset < files.length; offset += 64) {
    await Promise.all(
      files.slice(offset, offset + 64).map(async (file) => {
        const claimPath = join(input.journalRoot, "claims", file.claimName);
        await writeFile(claimPath, file.bytes, { flag: "wx" });
        await link(
          claimPath,
          join(input.journalRoot, "events", file.eventName),
        );
      }),
    );
  }
}
