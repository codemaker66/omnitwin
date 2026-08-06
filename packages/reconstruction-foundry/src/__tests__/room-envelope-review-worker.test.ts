import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectUniversalIntakeWithSourceFactsV8,
} from "../intake-receipt.js";
import {
  FOUNDRY_ROOM_ENVELOPE_REVIEW_DIGEST_DOMAIN_V0,
  FoundryRoomEnvelopeReviewRequestV0Schema,
  FoundryRoomEnvelopeReviewV0Schema,
  decoderPointToIntrinsicPixel,
  intrinsicPixelInsidePolygon,
  serializeFoundryRoomEnvelopeReviewV0,
  type FoundryRoomEnvelopeReviewRequestV0,
  type FoundryRoomEnvelopeReviewV0,
} from "../room-envelope-review.js";
import {
  runFoundryRoomEnvelopeReviewWorkerV0,
} from "../room-envelope-review-worker.js";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function attribute(
  name: "position" | "intensity" | "lcc prediction",
): Record<string, unknown> {
  const position = name === "position";
  return {
    name,
    description: "fixture declaration is not semantic authority",
    size: position ? 12 : 1,
    numElements: position ? 3 : 1,
    elementSize: position ? 4 : 1,
    type: position ? "int32" : "uint8",
    min: position ? [0, 0, 0] : [0],
    max: position ? [10, 20, 30] : [255],
    scale: position ? [1, 1, 1] : [1],
    offset: position ? [0, 0, 0] : [0],
  };
}

function metadata(pointCount: number): Buffer {
  return Buffer.from(JSON.stringify({
    version: "2.0",
    name: "potree",
    description: "room-envelope worker fixture",
    points: pointCount,
    projection: "",
    hierarchy: { firstChunkSize: 22, stepSize: 4, depth: 0 },
    offset: [0, 0, 0],
    scale: [0.001, 0.001, 0.001],
    spacing: 0.1,
    boundingBox: { min: [0, 0, 0], max: [10, 20, 30] },
    encoding: "DEFAULT",
    attributes: [
      attribute("position"),
      attribute("intensity"),
      attribute("lcc prediction"),
    ],
  }), "utf8");
}

function hierarchy(pointCount: number): Buffer {
  const bytes = Buffer.alloc(22);
  bytes.writeUInt8(1, 0);
  bytes.writeUInt8(0, 1);
  bytes.writeUInt32LE(pointCount, 2);
  bytes.writeBigUInt64LE(0n, 6);
  bytes.writeBigUInt64LE(BigInt(pointCount * 14), 14);
  return bytes;
}

function record(
  position: readonly [number, number, number],
  ordinal: number,
): Buffer {
  const bytes = Buffer.alloc(14);
  bytes.writeInt32LE(position[0], 0);
  bytes.writeInt32LE(position[1], 4);
  bytes.writeInt32LE(position[2], 8);
  bytes.writeUInt8(ordinal % 256, 12);
  bytes.writeUInt8((ordinal * 7) % 256, 13);
  return bytes;
}

function octree(pointCount = 600): Buffer {
  return Buffer.concat(Array.from({ length: pointCount }, (_, ordinal) => {
    const column = ordinal % 25;
    const row = Math.floor(ordinal / 25);
    return record([
      Math.round((column / 24) * 10_000),
      Math.round((row / 23) * 20_000),
      (ordinal * 43) % 30_001,
    ], ordinal);
  }));
}

async function fixture(pointCount = 600) {
  const root = await mkdtemp(join(tmpdir(), "foundry-room-envelope-"));
  roots.push(root);
  const octreeBytes = octree(pointCount);
  await writeFile(join(root, "metadata.json"), metadata(pointCount));
  await writeFile(join(root, "hierarchy.bin"), hierarchy(pointCount));
  await writeFile(join(root, "octree.bin"), octreeBytes);
  const inspected = await inspectUniversalIntakeWithSourceFactsV8(root);
  if (inspected.sourceFacts.state !== "available") {
    throw new Error("expected available V8 facts");
  }
  const overlay = inspected.sourceFacts.pointValueBundles[0];
  if (overlay?.pointValues.state !== "established") {
    throw new Error("expected established V8 point values");
  }
  const pointValueFacts = overlay.pointValues.facts;
  if (pointValueFacts === null) {
    throw new Error("expected established V8 point-value facts");
  }
  const request: FoundryRoomEnvelopeReviewRequestV0 =
    FoundryRoomEnvelopeReviewRequestV0Schema.parse({
      receiptSha256: inspected.receipt.receiptSha256,
      sourceFactsSha256: inspected.sourceFacts.factsSha256,
      bundleSha256: overlay.bundleSha256,
      horizontalViewId: "position_0_1",
      reviewedPreviews: [
        "position_0_1",
        "position_0_2",
        "position_1_2",
      ].map((viewId) => {
        const preview = pointValueFacts.previews.images.find(
          (candidate) =>
            candidate.viewId === viewId && candidate.mode === "record_density",
        );
        if (preview === undefined) throw new Error("missing fixture preview");
        return {
          viewId: preview.viewId,
          mode: preview.mode,
          sha256: preview.sha256,
          pixelSha256: preview.pixelSha256,
        };
      }),
      polygonIntrinsicPixels: [
        [0, 0],
        [1023, 0],
        [1023, 1023],
        [0, 1023],
      ],
      roomLabel: "Fixture room",
      reviewerLabel: "Fixture operator",
      reviewedAt: "2026-07-19T10:00:00.000Z",
      decision: "accepted_as_fit_seed",
      note: "Controlled fixture only.",
    });
  return { root, inspected, request, octreeBytes };
}

function redigest(
  report: FoundryRoomEnvelopeReviewV0,
  patch: Partial<FoundryRoomEnvelopeReviewV0>,
): FoundryRoomEnvelopeReviewV0 {
  const changed = { ...report, ...patch };
  const { reportSha256: _reportSha256, ...payload } = changed;
  return {
    ...changed,
    reportSha256: domainSeparatedSha256(
      FOUNDRY_ROOM_ENVELOPE_REVIEW_DIGEST_DOMAIN_V0,
      toCanonicalJson(payload),
    ),
  };
}

describe("room-envelope review V0", () => {
  it("issues a deterministic authority-none fit seed from exact receipt-bound bytes", async () => {
    const { root, inspected, request, octreeBytes } = await fixture();
    const before = await readFile(join(root, "octree.bin"));
    const first = await runFoundryRoomEnvelopeReviewWorkerV0({
      sourceRoot: root,
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
      request,
    });
    const second = await runFoundryRoomEnvelopeReviewWorkerV0({
      sourceRoot: root,
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
      request,
    });

    expect(FoundryRoomEnvelopeReviewV0Schema.parse(first.report)).toEqual(
      first.report,
    );
    expect(serializeFoundryRoomEnvelopeReviewV0(first.report)).toBe(
      serializeFoundryRoomEnvelopeReviewV0(second.report),
    );
    expect(first.report).toMatchObject({
      schemaVersion: "omnitwin.foundry.room-envelope-review.v0",
      authority: "none",
      review: {
        decision: "accepted_as_fit_seed",
        reviewedPreviews: [
          { viewId: "position_0_1" },
          { viewId: "position_0_2" },
          { viewId: "position_1_2" },
        ],
      },
      selection: {
        horizontalViewId: "position_0_1",
        projectedAxes: [0, 1],
        omittedAxis: 2,
        includedRecordCount: 600,
        excludedRecordCount: 0,
      },
      eligibility: "eligible_for_fit_only_diagnostic",
      policy: {
        fitOnlyDiagnostic: true,
        validationInputsRead: false,
        sourceBytesMutated: false,
        networkUsed: false,
      },
    });
    expect(first.report.source.members.map((member) => member.role)).toEqual([
      "metadata",
      "hierarchy",
      "octree",
    ]);
    expect(JSON.stringify(first.report)).not.toContain(root);
    expect(await readFile(join(root, "octree.bin"))).toEqual(before);
    expect(before).toEqual(octreeBytes);
  });

  it("keeps an explicit revision decision ineligible without discarding evidence", async () => {
    const { root, inspected, request } = await fixture();
    const result = await runFoundryRoomEnvelopeReviewWorkerV0({
      sourceRoot: root,
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
      request: { ...request, decision: "needs_revision" },
    });
    expect(result.report.selection.includedRecordCount).toBe(600);
    expect(result.report.eligibility).toBe("not_eligible");
  });

  it("rejects self-intersection, duplicate vertices, stale previews, and unknown keys", async () => {
    const { root, inspected, request } = await fixture();
    expect(() => FoundryRoomEnvelopeReviewRequestV0Schema.parse({
      ...request,
      polygonIntrinsicPixels: [[100, 100], [900, 900], [900, 100], [100, 900]],
    })).toThrow(/intersect/u);
    expect(() => FoundryRoomEnvelopeReviewRequestV0Schema.parse({
      ...request,
      polygonIntrinsicPixels: [[100, 100], [900, 100], [900, 900], [100, 100]],
    })).toThrow(/unique/u);
    expect(() => FoundryRoomEnvelopeReviewRequestV0Schema.parse({
      ...request,
      unexpected: true,
    })).toThrow();
    const reviewedPreviews = request.reviewedPreviews.map((preview, index) =>
      index === 0 ? { ...preview, sha256: "0".repeat(64) } : preview
    );
    await expect(runFoundryRoomEnvelopeReviewWorkerV0({
      sourceRoot: root,
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
      request: { ...request, reviewedPreviews },
    })).rejects.toMatchObject({
      name: "FoundryIntegrityError",
      code: "ROOM_ENVELOPE_HORIZONTAL_PREVIEW_MISMATCH",
    });
  });

  it("refuses changed source bytes and an already cancelled run", async () => {
    const changed = await fixture();
    const bytes = Buffer.from(changed.octreeBytes);
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    await writeFile(join(changed.root, "octree.bin"), bytes);
    await expect(runFoundryRoomEnvelopeReviewWorkerV0({
      sourceRoot: changed.root,
      receipt: changed.inspected.receipt,
      sourceFacts: changed.inspected.sourceFacts,
      request: changed.request,
    })).rejects.toMatchObject({
      name: "FoundryIntegrityError",
      code: "ROOM_ENVELOPE_SOURCE_DIGEST_MISMATCH",
    });

    const cancelled = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(runFoundryRoomEnvelopeReviewWorkerV0({
      sourceRoot: cancelled.root,
      receipt: cancelled.inspected.receipt,
      sourceFacts: cancelled.inspected.sourceFacts,
      request: cancelled.request,
      signal: controller.signal,
    })).rejects.toMatchObject({
      name: "AbortError",
      code: "ROOM_ENVELOPE_REVIEW_CANCELLED",
    });
  });

  it("rejects a digest-valid eligibility escalation and uses inclusive polygon boundaries", async () => {
    const { root, inspected, request } = await fixture(20);
    const result = await runFoundryRoomEnvelopeReviewWorkerV0({
      sourceRoot: root,
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
      request,
    });
    expect(result.report.eligibility).toBe("not_eligible");
    expect(() => FoundryRoomEnvelopeReviewV0Schema.parse(redigest(
      result.report,
      { eligibility: "eligible_for_fit_only_diagnostic" },
    ))).toThrow(/Eligibility/u);
    expect(() => FoundryRoomEnvelopeReviewV0Schema.parse(redigest(
      result.report,
      {
        selection: {
          ...result.report.selection,
          includedDecodedBounds: {
            min: [-999, -999, -999],
            max: result.report.selection.mapping.decodedMax,
          },
        },
      },
    ))).toThrow(/inside the observed/u);
    expect(() => FoundryRoomEnvelopeReviewV0Schema.parse(redigest(
      result.report,
      {
        source: {
          ...result.report.source,
          members: result.report.source.members.map((member, index) =>
            index === 2
              ? { ...member, relativePath: "elsewhere/octree.bin" }
              : member
          ),
        },
      },
    ))).toThrow(/canonical paths/u);
    expect(() => FoundryRoomEnvelopeReviewV0Schema.parse(redigest(
      result.report,
      {
        review: {
          ...result.report.review,
          reviewedPreviews: result.report.review.reviewedPreviews.map(
            (preview, index) => index === 0
              ? { ...preview, projectedAxes: [0, 0] as [0, 0] }
              : preview,
          ),
        },
      },
    ))).toThrow(/projection/u);

    const mapping = result.report.selection.mapping;
    const pixel = decoderPointToIntrinsicPixel(
      mapping,
      result.report.selection.projectedAxes,
      mapping.decodedMin,
    );
    expect(intrinsicPixelInsidePolygon(pixel, [
      pixel,
      [pixel[0] + 10, pixel[1]],
      [pixel[0] + 10, pixel[1] + 10],
      [pixel[0], pixel[1] + 10],
    ])).toBe(true);
  });
});
