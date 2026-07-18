import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runtimeTransformArtifactSha256 } from "../lib/runtime-transform-artifact-receipt.js";

vi.mock("@omnitwin/reconstruction-foundry", async () =>
  import("./support/reconstruction-foundry-canonical-mock.js")
);
import {
  acquirePublicRuntimeProfileTransfer,
  bindPublicRuntimeProfileTransferToResponse,
  readVerifiedRuntimeProfileMemberBytes,
  resolveVerifiedRuntimeProfileResponseRange,
  runtimeQaRecordRegistrationIsExactRetry,
  runtimeQaRecordAllowsPublicRuntimePackage,
  runtimeQaRecordAllowsPublicRoomVisual,
  runtimeTransformArtifactRegistrationIsExactRetry,
  tryAcquirePublicRuntimeProfileTransfer,
  type RuntimePackageRow,
  type RuntimeQaRecordRow,
  type RuntimeTransformArtifactRow,
} from "../routes/assets.js";

describe("public runtime profile transfer capacity", () => {
  it("admits only two concurrent full-object verifications and releases slots idempotently", () => {
    const releaseFirst = tryAcquirePublicRuntimeProfileTransfer();
    const releaseSecond = tryAcquirePublicRuntimeProfileTransfer();
    let releaseReplacement: (() => void) | null = null;
    try {
      expect(releaseFirst).not.toBeNull();
      expect(releaseSecond).not.toBeNull();
      expect(tryAcquirePublicRuntimeProfileTransfer()).toBeNull();

      releaseFirst?.();
      releaseFirst?.();
      releaseReplacement = tryAcquirePublicRuntimeProfileTransfer();
      expect(releaseReplacement).not.toBeNull();
    } finally {
      releaseReplacement?.();
      releaseSecond?.();
      releaseFirst?.();
    }
  });

  it("queues the third and fourth profile members until the two active slots finish", async () => {
    const releaseFirst = tryAcquirePublicRuntimeProfileTransfer();
    const releaseSecond = tryAcquirePublicRuntimeProfileTransfer();
    let releaseThird: (() => void) | null = null;
    let releaseFourth: (() => void) | null = null;
    try {
      expect(releaseFirst).not.toBeNull();
      expect(releaseSecond).not.toBeNull();
      const third = acquirePublicRuntimeProfileTransfer();
      const fourth = acquirePublicRuntimeProfileTransfer();
      let thirdResolved = false;
      let fourthResolved = false;
      void third.then(() => {
        thirdResolved = true;
      });
      void fourth.then(() => {
        fourthResolved = true;
      });

      await Promise.resolve();
      expect(thirdResolved).toBe(false);
      expect(fourthResolved).toBe(false);

      releaseFirst?.();
      releaseThird = await third;
      expect(releaseThird).not.toBeNull();
      expect(thirdResolved).toBe(true);
      expect(fourthResolved).toBe(false);
      expect(tryAcquirePublicRuntimeProfileTransfer()).toBeNull();

      releaseSecond?.();
      releaseFourth = await fourth;
      expect(releaseFourth).not.toBeNull();
      expect(fourthResolved).toBe(true);
      expect(tryAcquirePublicRuntimeProfileTransfer()).toBeNull();
    } finally {
      releaseFourth?.();
      releaseThird?.();
      releaseSecond?.();
      releaseFirst?.();
    }
  });

  it("holds a slot until response finish and aborts an unfinished closed response", () => {
    const releaseFirst = tryAcquirePublicRuntimeProfileTransfer();
    const releaseSecond = tryAcquirePublicRuntimeProfileTransfer();
    let replacement: (() => void) | null = null;
    let replacementAfterClose: (() => void) | null = null;
    try {
      expect(releaseFirst).not.toBeNull();
      expect(releaseSecond).not.toBeNull();
      const finishedResponse = Object.assign(new EventEmitter(), {
        writableFinished: false,
        destroy: vi.fn(),
      });
      const abortFinishedUpstream = vi.fn();
      const markFinishedWorkSettled = bindPublicRuntimeProfileTransferToResponse(
        finishedResponse,
        releaseFirst ?? (() => undefined),
        abortFinishedUpstream,
      );

      expect(tryAcquirePublicRuntimeProfileTransfer()).toBeNull();
      finishedResponse.writableFinished = true;
      finishedResponse.emit("finish");
      finishedResponse.emit("close");
      expect(abortFinishedUpstream).not.toHaveBeenCalled();
      expect(tryAcquirePublicRuntimeProfileTransfer()).toBeNull();
      markFinishedWorkSettled();

      replacement = tryAcquirePublicRuntimeProfileTransfer();
      expect(replacement).not.toBeNull();
      const closedResponse = Object.assign(new EventEmitter(), {
        writableFinished: false,
        destroy: vi.fn(),
      });
      const abortClosedUpstream = vi.fn();
      const markClosedWorkSettled = bindPublicRuntimeProfileTransferToResponse(
        closedResponse,
        replacement ?? (() => undefined),
        abortClosedUpstream,
      );

      expect(tryAcquirePublicRuntimeProfileTransfer()).toBeNull();
      closedResponse.emit("close");
      expect(abortClosedUpstream).toHaveBeenCalledTimes(1);
      expect(tryAcquirePublicRuntimeProfileTransfer()).toBeNull();
      markClosedWorkSettled();
      replacementAfterClose = tryAcquirePublicRuntimeProfileTransfer();
      expect(replacementAfterClose).not.toBeNull();
      closedResponse.writableFinished = true;
      closedResponse.emit("finish");
      closedResponse.emit("close");
      expect(abortClosedUpstream).toHaveBeenCalledTimes(1);
    } finally {
      replacementAfterClose?.();
      replacement?.();
      releaseSecond?.();
      releaseFirst?.();
    }
  });

  it("terminates stalled responses at the absolute deadline and recovers both slots", async () => {
    vi.useFakeTimers();
    const releaseFirst = tryAcquirePublicRuntimeProfileTransfer();
    const releaseSecond = tryAcquirePublicRuntimeProfileTransfer();
    let replacementFirst: (() => void) | null = null;
    let replacementSecond: (() => void) | null = null;
    try {
      expect(releaseFirst).not.toBeNull();
      expect(releaseSecond).not.toBeNull();
      const firstResponse = Object.assign(new EventEmitter(), {
        writableFinished: false,
        destroy: vi.fn(),
      });
      const secondResponse = Object.assign(new EventEmitter(), {
        writableFinished: false,
        destroy: vi.fn(),
      });
      const abortFirstUpstream = vi.fn();
      const abortSecondUpstream = vi.fn();
      const markFirstWorkSettled = bindPublicRuntimeProfileTransferToResponse(
        firstResponse,
        releaseFirst ?? (() => undefined),
        abortFirstUpstream,
        1_000,
      );
      const markSecondWorkSettled = bindPublicRuntimeProfileTransferToResponse(
        secondResponse,
        releaseSecond ?? (() => undefined),
        abortSecondUpstream,
        1_000,
      );

      markFirstWorkSettled();
      expect(tryAcquirePublicRuntimeProfileTransfer()).toBeNull();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(abortFirstUpstream).toHaveBeenCalledTimes(1);
      expect(abortSecondUpstream).toHaveBeenCalledTimes(1);
      expect(firstResponse.destroy).toHaveBeenCalledTimes(1);
      expect(secondResponse.destroy).toHaveBeenCalledTimes(1);
      replacementFirst = tryAcquirePublicRuntimeProfileTransfer();
      expect(replacementFirst).not.toBeNull();
      expect(tryAcquirePublicRuntimeProfileTransfer()).toBeNull();

      // The deadline settles the response even when destroy() does not emit
      // close, but the second slot remains held until its work also settles.
      markSecondWorkSettled();
      replacementSecond = tryAcquirePublicRuntimeProfileTransfer();
      expect(replacementSecond).not.toBeNull();
    } finally {
      replacementSecond?.();
      replacementFirst?.();
      releaseSecond?.();
      releaseFirst?.();
      vi.useRealTimers();
    }
  });

  it("clears the absolute deadline after a normally finished response", async () => {
    vi.useFakeTimers();
    const release = tryAcquirePublicRuntimeProfileTransfer();
    let replacement: (() => void) | null = null;
    try {
      expect(release).not.toBeNull();
      const response = Object.assign(new EventEmitter(), {
        writableFinished: false,
        destroy: vi.fn(),
      });
      const abortUpstream = vi.fn();
      const markWorkSettled = bindPublicRuntimeProfileTransferToResponse(
        response,
        release ?? (() => undefined),
        abortUpstream,
        1_000,
      );

      markWorkSettled();
      response.writableFinished = true;
      response.emit("finish");
      await vi.advanceTimersByTimeAsync(1_000);

      expect(abortUpstream).not.toHaveBeenCalled();
      expect(response.destroy).not.toHaveBeenCalled();
      replacement = tryAcquirePublicRuntimeProfileTransfer();
      expect(replacement).not.toBeNull();
    } finally {
      replacement?.();
      release?.();
      vi.useRealTimers();
    }
  });

  it("bounds the FIFO at 16 waiting requests and rejects the 17th waiter", async () => {
    const releaseFirst = tryAcquirePublicRuntimeProfileTransfer();
    const releaseSecond = tryAcquirePublicRuntimeProfileTransfer();
    const releases: (() => void)[] = [];
    try {
      const queued = Array.from({ length: 16 }, () => acquirePublicRuntimeProfileTransfer());
      await expect(acquirePublicRuntimeProfileTransfer()).resolves.toBeNull();
      releaseFirst?.();
      for (const waiter of queued) {
        const release = await waiter;
        expect(release).not.toBeNull();
        if (release !== null) {
          releases.push(release);
          release();
        }
      }
    } finally {
      for (const release of releases) release();
      releaseSecond?.();
      releaseFirst?.();
    }
  });

  it("removes an expired five-minute waiter without consuming a later slot", async () => {
    vi.useFakeTimers();
    const releaseFirst = tryAcquirePublicRuntimeProfileTransfer();
    const releaseSecond = tryAcquirePublicRuntimeProfileTransfer();
    try {
      const waiting = acquirePublicRuntimeProfileTransfer();
      await vi.advanceTimersByTimeAsync(300_000);
      await expect(waiting).resolves.toBeNull();
      releaseFirst?.();
      const replacement = tryAcquirePublicRuntimeProfileTransfer();
      expect(replacement).not.toBeNull();
      replacement?.();
    } finally {
      releaseSecond?.();
      releaseFirst?.();
      vi.useRealTimers();
    }
  });

  it("removes an aborted queued request immediately", async () => {
    const releaseFirst = tryAcquirePublicRuntimeProfileTransfer();
    const releaseSecond = tryAcquirePublicRuntimeProfileTransfer();
    const controller = new AbortController();
    try {
      const waiting = acquirePublicRuntimeProfileTransfer(controller.signal);
      controller.abort();
      await expect(waiting).resolves.toBeNull();
      releaseFirst?.();
      const replacement = tryAcquirePublicRuntimeProfileTransfer();
      expect(replacement).not.toBeNull();
      replacement?.();
    } finally {
      releaseSecond?.();
      releaseFirst?.();
    }
  });
});

describe("readVerifiedRuntimeProfileMemberBytes", () => {
  it("releases bytes only when the complete registered size and SHA-256 match", async () => {
    const expected = Buffer.from("reviewed-runtime-profile-member", "utf8");
    const expectedSha256 = createHash("sha256").update(expected).digest("hex");

    const verified = await readVerifiedRuntimeProfileMemberBytes(
      Readable.from([expected.subarray(0, 7), expected.subarray(7)]),
      expected.byteLength,
      expectedSha256,
    );
    expect(verified).not.toBeNull();
    expect(verified?.equals(expected)).toBe(true);
  });

  it("rejects changed, truncated, oversized, or invalidly-described bytes", async () => {
    const expected = Buffer.from("reviewed-runtime-profile-member", "utf8");
    const expectedSha256 = createHash("sha256").update(expected).digest("hex");

    await expect(readVerifiedRuntimeProfileMemberBytes(
      Readable.from([Buffer.from("changed-runtime-profile-member", "utf8")]),
      expected.byteLength,
      expectedSha256,
    )).resolves.toBeNull();
    await expect(readVerifiedRuntimeProfileMemberBytes(
      Readable.from([expected.subarray(0, expected.byteLength - 1)]),
      expected.byteLength,
      expectedSha256,
    )).resolves.toBeNull();
    await expect(readVerifiedRuntimeProfileMemberBytes(
      Readable.from([Buffer.concat([expected, Buffer.from("!")])]),
      expected.byteLength,
      expectedSha256,
    )).resolves.toBeNull();
    await expect(readVerifiedRuntimeProfileMemberBytes(
      Readable.from([expected]),
      expected.byteLength,
      "not-a-sha256",
    )).resolves.toBeNull();
  });
});

describe("resolveVerifiedRuntimeProfileResponseRange", () => {
  it("supports full, bounded, open-ended, and suffix ranges after full-object verification", () => {
    expect(resolveVerifiedRuntimeProfileResponseRange(undefined, 100)).toEqual({
      start: 0, end: 99, partial: false,
    });
    expect(resolveVerifiedRuntimeProfileResponseRange("bytes=10-19", 100)).toEqual({
      start: 10, end: 19, partial: true,
    });
    expect(resolveVerifiedRuntimeProfileResponseRange("bytes=90-", 100)).toEqual({
      start: 90, end: 99, partial: true,
    });
    expect(resolveVerifiedRuntimeProfileResponseRange("bytes=-5", 100)).toEqual({
      start: 95, end: 99, partial: true,
    });
    expect(resolveVerifiedRuntimeProfileResponseRange("bytes=90-999", 100)).toEqual({
      start: 90, end: 99, partial: true,
    });
  });

  it("rejects empty, reversed, out-of-bounds, unsafe, or malformed ranges", () => {
    for (const range of [
      "bytes=-",
      "bytes=-0",
      "bytes=50-49",
      "bytes=100-",
      "bytes=999999999999999999999-",
      "items=0-1",
    ]) {
      expect(resolveVerifiedRuntimeProfileResponseRange(range, 100)).toBeNull();
    }
  });
});

const NOW = new Date("2026-06-16T00:00:00.000Z");
const RUNTIME_PACKAGE_ID = "10000000-0000-4000-8000-000000000004";
const SIGNED_TRANSFORM_ID = "reception-room-landmark-solve-v0";
const evidenceRef = {
  label: "Exposure review",
  ref: "docs/operations/reception-room-exposure-review.md",
};

function qaRecordRow(overrides: Partial<RuntimeQaRecordRow> = {}): RuntimeQaRecordRow {
  const record: RuntimeQaRecordRow["recordJson"] = {
    schemaVersion: "runtime-qa-record.v0",
    recordId: "reception-room-runtime-qa-2026-06-16",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    runtimePackageId: RUNTIME_PACKAGE_ID,
    recordedAt: "2026-06-16T00:00:00.000Z",
    recordedBy: "runtime-qa-operator",
    assetEvidenceStatus: "human_reviewed",
    runtimeStatus: "published",
    sourceBundle: {
      sourceLabel: "Reception Room reviewed runtime bundle",
      sourceBundleHash: "a".repeat(64),
      totalSourceFiles: 48,
      totalSourceBytes: 64_323_846,
      totalSplats: 3_491_322,
    },
    sparkLoad: {
      renderer: "@sparkjsdev/spark",
      route: "/dev/trades-hall-visual?venue=trades-hall&room=reception-room",
      loadStatus: "loaded",
      visualChunkCount: 7,
      excludedChunkCount: 1,
      loadedSplats: 3_491_322,
      evidenceRefs: [evidenceRef],
    },
    viewTransform: {
      posture: "signed_room_local_transform",
      position: [1.11, 2.57, 2.77],
      rotation: [-Math.PI / 2, 0, 0],
      scale: 0.63,
      signedTransformArtifactId: SIGNED_TRANSFORM_ID,
      signedTransformArtifactSha256: runtimeTransformArtifactSha256(
        transformArtifactRow().transformArtifact,
      ),
      note: "Signed room-local transform for reviewed runtime alignment.",
    },
    cameraProfile: {
      position: [0.2, 6.2, 13.4],
      target: [0, 0.9, -4.15],
      arrivalPosition: [0.25, 7.15, 14.1],
      arrivalTarget: [0, 1.2, -4],
      arrivalDurationMs: 1400,
      fov: 48,
      targetBounds: {
        min: [-5.8, 0.7, -9.2],
        max: [5.8, 2.35, 4.8],
      },
      cameraBounds: {
        min: [-6.8, 1.4, -11.8],
        max: [6.8, 7.4, 14.2],
      },
      note: "Bounded interior inspection camera for runtime QA only.",
    },
    checks: [
      {
        checkKey: "runtime_package_resolves",
        status: "passed",
        summary: "Runtime package resolves through the internal route.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "served_chunk_count",
        status: "passed",
        summary: "Served visual chunks are recorded.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "spark_payload_loads",
        status: "passed",
        summary: "Spark loads the served runtime payloads.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "camera_framing",
        status: "passed",
        summary: "The start view frames the reviewed room package.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "user_orbit_bounds",
        status: "passed",
        summary: "User orbit stays inside reviewed camera bounds.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "approximate_view_transform_documented",
        status: "passed",
        summary: "Previous approximate transform limitations are documented.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "signed_transform_artifact",
        status: "passed",
        summary: "Signed room-local transform artifact is recorded.",
        evidenceRefs: [{ label: "Transform artifact", ref: SIGNED_TRANSFORM_ID }],
      },
      {
        checkKey: "metric_scale_alignment",
        status: "passed",
        summary: "Metric scale alignment review is recorded.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "floor_wall_alignment",
        status: "passed",
        summary: "Floor and wall alignment review is recorded.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "lcc2_lod_graph",
        status: "passed",
        summary: "Runtime LOD or chunk strategy review is recorded.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "public_exposure_review",
        status: "passed",
        summary: "Public exposure review is recorded.",
        evidenceRefs: [evidenceRef],
      },
    ],
    limitations: [
      "Public exposure is limited to reviewed visual preview copy.",
    ],
    publicExposure: {
      decision: "approved_public",
      reason: "Human review and signed transform evidence are recorded.",
      requiredBeforeApproval: ["No remaining approval blockers."],
    },
  };

  return {
    id: "10000000-0000-4000-8000-000000000008",
    runtimePackageId: RUNTIME_PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    recordId: record.recordId,
    recordJson: record,
    signedTransformArtifactId: SIGNED_TRANSFORM_ID,
    publicExposureDecision: record.publicExposure.decision,
    assetEvidenceStatus: record.assetEvidenceStatus,
    runtimeStatus: record.runtimeStatus,
    reviewedBy: "10000000-0000-4000-8000-000000000009",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function transformArtifactRow(overrides: Partial<RuntimeTransformArtifactRow> = {}): RuntimeTransformArtifactRow {
  const transformArtifact: RuntimeTransformArtifactRow["transformArtifact"] = {
    id: SIGNED_TRANSFORM_ID,
    sourceFrame: "COLMAP_RDF",
    targetFrame: "CVF",
    units: "meters",
    matrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
    alignmentMethod: "landmark_solve",
    residualRmseM: 0.012,
    landmarks: [
      {
        id: "corner-01",
        label: "Control corner 01",
        source: [0, 0, 0],
        target: [0, 0, 0],
        residualM: 0.01,
        provenanceRefs: [
          {
            refType: "landmark_set",
            ref: "docs/operations/reception-room-landmarks-v0.json",
            role: "source_landmarks",
          },
        ],
      },
    ],
    provenance: {
      state: "measured",
      refs: [
        {
          refType: "landmark_set",
          ref: "docs/operations/reception-room-landmarks-v0.json",
          role: "source_landmarks",
        },
      ],
    },
    creator: {
      actorType: "human",
      id: "ops/runtime-operator",
      displayName: "Runtime operator",
      role: "runtime_operator",
    },
    reviewer: {
      actorType: "human",
      id: "ops/runtime-reviewer",
      displayName: "Runtime reviewer",
      role: "runtime_reviewer",
    },
    date: "2026-06-16T00:00:00.000Z",
  };

  return {
    id: "10000000-0000-4000-8000-000000000010",
    runtimePackageId: RUNTIME_PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    transformArtifactId: SIGNED_TRANSFORM_ID,
    transformArtifact,
    reviewNote: "Route contract test only; not live Reception Room evidence.",
    registeredBy: "10000000-0000-4000-8000-000000000009",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function runtimePackageRow(overrides: Partial<RuntimePackageRow> = {}): RuntimePackageRow {
  return {
    id: RUNTIME_PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    revision: 1,
    identityKind: "content_sha256",
    contentDigest: "a".repeat(64),
    primaryVisualAssetVersionId: "10000000-0000-4000-8000-000000000001",
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: "10000000-0000-4000-8000-000000000001",
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    },
    evidenceStatus: "human_reviewed",
    runtimeStatus: "published",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("runtimeQaRecordAllowsPublicRuntimePackage", () => {
  it("binds the QA row and signed transform to the exact package venue and room", () => {
    expect(runtimeQaRecordAllowsPublicRuntimePackage(
      runtimePackageRow(),
      qaRecordRow(),
      transformArtifactRow(),
    )).toBe(true);

    expect(runtimeQaRecordAllowsPublicRuntimePackage(
      runtimePackageRow({ roomSlug: "grand-hall" }),
      qaRecordRow(),
      transformArtifactRow(),
    )).toBe(false);
    expect(runtimeQaRecordAllowsPublicRuntimePackage(
      runtimePackageRow({ evidenceStatus: "unverified" }),
      qaRecordRow(),
      transformArtifactRow(),
    )).toBe(false);
    expect(runtimeQaRecordAllowsPublicRuntimePackage(
      runtimePackageRow({ runtimeStatus: "internal_ready" }),
      qaRecordRow(),
      transformArtifactRow(),
    )).toBe(false);
    expect(runtimeQaRecordAllowsPublicRuntimePackage(
      runtimePackageRow(),
      qaRecordRow({ roomSlug: "grand-hall" }),
      transformArtifactRow({ roomSlug: "grand-hall" }),
    )).toBe(false);
    expect(runtimeQaRecordAllowsPublicRuntimePackage(
      runtimePackageRow(),
      qaRecordRow({
        recordJson: {
          ...qaRecordRow().recordJson,
          roomSlug: "grand-hall",
        },
      }),
      transformArtifactRow(),
    )).toBe(false);
    expect(runtimeQaRecordAllowsPublicRuntimePackage(
      runtimePackageRow(),
      qaRecordRow(),
      transformArtifactRow({
        transformArtifact: {
          ...transformArtifactRow().transformArtifact,
          id: "different-transform-content-id",
        },
      }),
    )).toBe(false);
    expect(runtimeQaRecordAllowsPublicRuntimePackage(
      runtimePackageRow({ id: "10000000-0000-4000-8000-000000000099" }),
      qaRecordRow(),
      transformArtifactRow(),
    )).toBe(false);
  });
});

describe("runtimeQaRecordAllowsPublicRoomVisual", () => {
  it("blocks public visuals when there is no persisted QA record", () => {
    expect(runtimeQaRecordAllowsPublicRoomVisual(null, transformArtifactRow())).toBe(false);
    expect(runtimeQaRecordAllowsPublicRoomVisual(undefined, transformArtifactRow())).toBe(false);
  });

  it("allows public visuals only from an approved QA record with its registered transform artifact", () => {
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow(), transformArtifactRow())).toBe(true);
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow(), null)).toBe(false);
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow(), transformArtifactRow({
      transformArtifactId: "wrong-transform-artifact",
    }))).toBe(false);
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow({
      recordJson: {
        ...qaRecordRow().recordJson,
        publicExposure: {
          decision: "approved_internal_preview",
          reason: "Internal preview review is recorded.",
          requiredBeforeApproval: ["Public review remains required."],
        },
      },
      publicExposureDecision: "approved_internal_preview",
    }), transformArtifactRow())).toBe(false);
  });

  it("blocks public visuals when persisted QA row readiness columns drift from the signed record", () => {
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow({
      signedTransformArtifactId: null,
    }), transformArtifactRow())).toBe(false);
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow({
      signedTransformArtifactId: "wrong-transform-artifact",
    }), transformArtifactRow())).toBe(false);
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow({
      publicExposureDecision: "blocked_internal_only",
    }), transformArtifactRow())).toBe(false);
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow({
      assetEvidenceStatus: "unverified",
    }), transformArtifactRow())).toBe(false);
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow({
      runtimeStatus: "internal_ready",
    }), transformArtifactRow())).toBe(false);
  });

  it("binds approval to exact transform bytes reviewed no earlier than that transform", () => {
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow({
      recordJson: {
        ...qaRecordRow().recordJson,
        viewTransform: {
          ...qaRecordRow().recordJson.viewTransform,
          signedTransformArtifactSha256: "b".repeat(64),
        },
      },
    }), transformArtifactRow())).toBe(false);

    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow(), transformArtifactRow({
      transformArtifact: {
        ...transformArtifactRow().transformArtifact,
        matrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0.25, 0, 0, 1,
        ],
      },
    }))).toBe(false);

    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow(), transformArtifactRow({
      updatedAt: new Date("2026-06-16T00:00:00.001Z"),
    }))).toBe(false);
  });

  it("fails closed when persisted QA or transform JSON no longer passes its full schema", () => {
    const invalidTransform = { ...transformArtifactRow().transformArtifact };
    Reflect.set(invalidTransform, "units", "centimeters");
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow({
      recordJson: {
        ...qaRecordRow().recordJson,
        checks: [],
      } as RuntimeQaRecordRow["recordJson"],
    }), transformArtifactRow())).toBe(false);
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow(), transformArtifactRow({
      transformArtifact: invalidTransform,
    }))).toBe(false);
  });
});

describe("immutable transform and QA registration retries", () => {
  it("accepts an identical transform retry but rejects changed content under the same id", () => {
    const existing = transformArtifactRow();
    const request = {
      runtimePackageId: existing.runtimePackageId,
      venueSlug: existing.venueSlug,
      roomSlug: existing.roomSlug,
      transformArtifact: existing.transformArtifact,
      reviewNote: existing.reviewNote,
    };
    expect(runtimeTransformArtifactRegistrationIsExactRetry(existing, request)).toBe(true);
    expect(runtimeTransformArtifactRegistrationIsExactRetry(existing, {
      ...request,
      transformArtifact: {
        ...request.transformArtifact,
        matrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0.01, 0, 0, 1,
        ],
      },
    })).toBe(false);
    expect(runtimeTransformArtifactRegistrationIsExactRetry(existing, {
      ...request,
      transformArtifact: {
        ...request.transformArtifact,
        reviewer: {
          ...request.transformArtifact.reviewer,
          id: "ops/different-reviewer",
        },
      },
    })).toBe(false);
    expect(runtimeTransformArtifactRegistrationIsExactRetry(existing, {
      ...request,
      reviewNote: "Changed review note under the same artifact id.",
    })).toBe(false);
  });

  it("accepts an identical QA retry but rejects a changed review under the same record id", () => {
    const existing = qaRecordRow();
    const request = {
      runtimePackageId: existing.runtimePackageId,
      venueSlug: existing.venueSlug,
      roomSlug: existing.roomSlug,
      record: existing.recordJson,
    };
    expect(runtimeQaRecordRegistrationIsExactRetry(existing, request)).toBe(true);
    expect(runtimeQaRecordRegistrationIsExactRetry(existing, {
      ...request,
      record: {
        ...request.record,
        publicExposure: {
          ...request.record.publicExposure,
          reason: "A changed approval requires a new immutable record id.",
        },
      },
    })).toBe(false);
  });
});
