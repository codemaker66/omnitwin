import { createHash } from "node:crypto";

import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS,
  type GrandHallPanoramaSourceJpgIdentityV2,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";

import {
  type GrandHallT554NativeReviewCoordinatorEventV2,
  type GrandHallT554NativeReviewImplementationManifestBindingV2,
  type GrandHallT554NativeReviewMaskEditV2,
  type GrandHallT554NativeReviewMaskStateEvidenceV2,
  type GrandHallT554NativeReviewRegistryBindingV2,
  type GrandHallT554NativeReviewSessionScopeV2,
  type GrandHallT554NativeReviewSourceCustodyBindingV2,
} from "../grand-hall-t554-native-review-events-v2.js";
import {
  GRAND_HALL_T554_NATIVE_MASK_REPLAY_CONTEXT_V2,
  GrandHallT554NativeMaskReplayV2Error,
  buildGrandHallT554NativeMaskReplayContextV2,
  verifyGrandHallT554NativeMaskStateReplayV2,
  type GrandHallT554NativeMaskReplayContextV2,
} from "../grand-hall-t554-native-review-mask-replay-v2.js";
import {
  GrandHallT554NativeMaskRevisionStore,
  type GrandHallT554NativeMaskExactStateV2,
} from "../grand-hall-t554-native-review-mask-store.js";

type Sha256 = `sha256:${string}`;
type MaskEditedEventV2 = Extract<
  GrandHallT554NativeReviewCoordinatorEventV2,
  { readonly eventType: "mask.edited.v2" }
>;

const PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;

function digest(label: string): Sha256 {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function sourceIdentity(
  inventoryIndex = 0,
): GrandHallPanoramaSourceJpgIdentityV2 {
  const sweepNumber = GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS[inventoryIndex];
  if (sweepNumber === undefined) throw new Error("test source index is absent");
  if (inventoryIndex === 0) {
    return {
      inventoryIndex: 0,
      sweepNumber,
      fileName: "sweep_001jpg.jpg",
      sha256:
        "sha256:0543e2ce83bbbb5b8c4a8c689a49391092cc6d856124f8ac095d33b09c1db814",
      byteLength: 6_419_919,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
    };
  }
  return {
    inventoryIndex,
    sweepNumber,
    fileName: `sweep_${String(sweepNumber).padStart(3, "0")}jpg.jpg`,
    sha256: digest(`source-${String(inventoryIndex)}`),
    byteLength: 1_000_000 + inventoryIndex,
    widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
    heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
  };
}

const registry: GrandHallT554NativeReviewRegistryBindingV2 = {
  schemaVersion: "venviewer.grand-hall-t554-native-review-registry-binding.v2",
  venueSlug: "trades-hall",
  roomSlug: "grand-hall",
  sourceCount: 148,
  reviewPack: {
    semanticSha256:
      "sha256:0906aeba265aea9879a65c5e7d698ddaaa5e54912d7024868c1a1abaaf618530",
    fileSha256:
      "sha256:9c7b18186c1065a5216eff64e9c27343d81105f1f4adbfd705ee4612782281dd",
    byteLength: 130_706,
  },
  publicationReceipt: {
    semanticSha256:
      "sha256:67800d907aebb1643ea8ee2dda580d76ca5849b400a46e52aef127339ee42b17",
    fileSha256:
      "sha256:fa03a33401b6589e3e2d6fa2d1e393cdbf0573776de5666f0c0c422d0763dfe5",
    byteLength: 3_590,
  },
  authority: "none",
  reviewState: "human_pending",
  finalDecision: "PENDING",
  acceptanceAuthorized: false,
  reconstructionAuthorized: false,
  runtimeAuthorized: false,
  exportAuthorized: false,
  generatedContentAuthorized: false,
};

const implementation: GrandHallT554NativeReviewImplementationManifestBindingV2 =
  {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2",
    implementationId: "grand-hall-t554-native-review-workbench-v1",
    semanticSha256: digest("implementation-semantic"),
    fileSha256: digest("implementation-file"),
    byteLength: 12_345,
  };

const authorityBoundary = {
  schemaVersion:
    "venviewer.grand-hall-t554-native-review-authority-boundary.v2" as const,
  authority: "none" as const,
  reviewState: "human_pending" as const,
  finalDecision: "PENDING" as const,
  acceptanceAuthorized: false as const,
  reconstructionAuthorized: false as const,
  runtimeAuthorized: false as const,
  exportAuthorized: false as const,
  generatedContentAuthorized: false as const,
};

function sessionScope(): GrandHallT554NativeReviewSessionScopeV2 {
  return {
    schemaVersion: "venviewer.grand-hall-t554-native-review-journal-scope.v2",
    kind: "session",
    sessionIdSha256: digest("session"),
    subjectSha256: digest("session-subject"),
    registry,
    implementationManifest: implementation,
    authorityBoundary,
  };
}

function sourceCustody(
  source = sourceIdentity(),
  subjectSha256 = digest("source-review-subject"),
): GrandHallT554NativeReviewSourceCustodyBindingV2 {
  return {
    source,
    sourceVerification: {
      fileName: source.fileName,
      sha256: source.sha256 as Sha256,
      byteLength: source.byteLength,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
      decodedChannelCount: 3,
      decodedBitsPerSample: 8,
      alphaPresent: false,
      orientationMetadataPresent: false,
      decodedPixelSha256:
        source.inventoryIndex === 0
          ? "sha256:1f09de661c6c9d8a2027e71282569aadf2e1102f9007365b15d7c62b6bd0c936"
          : digest(`decoded-${String(source.inventoryIndex)}`),
      decoderIdentity: {
        schemaVersion:
          "venviewer.grand-hall-t554-source-jpeg-decoder-identity.v1",
        library: "sharp",
        sharpVersion: "0.35.3",
        libvipsVersion: "8.18.3",
        pipeline: "captured-jpeg-buffer-to-unrotated-rgb8.v1",
      },
      descriptorWitnessSha256: digest(
        `descriptor-${String(source.inventoryIndex)}`,
      ),
      sameOpenDescriptorHashedAndDecoded: true,
      fullJpegDecodeCompleted: true,
    },
    sourceReviewSubjectSha256: subjectSha256,
    sourceEpochBindingSha256: digest(
      `epoch-binding-${String(source.inventoryIndex)}`,
    ),
    sourceEpochNonceSha256: digest(
      `epoch-nonce-${String(source.inventoryIndex)}`,
    ),
    sourceEpochRenderGeneration: 1,
  };
}

function replayContext(
  custody = sourceCustody(),
): GrandHallT554NativeMaskReplayContextV2 {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_MASK_REPLAY_CONTEXT_V2,
    sessionIdSha256: digest("session"),
    registry,
    implementationManifest: implementation,
    source: custody.source,
    sourceVerification: custody.sourceVerification,
    sourceReviewSubjectSha256: custody.sourceReviewSubjectSha256,
  };
}

function custodyForContext(
  context: GrandHallT554NativeMaskReplayContextV2,
  epoch = "epoch-0",
  generation = 1,
): GrandHallT554NativeReviewSourceCustodyBindingV2 {
  return {
    source: context.source,
    sourceVerification: context.sourceVerification,
    sourceReviewSubjectSha256: context.sourceReviewSubjectSha256,
    sourceEpochBindingSha256: digest(`${epoch}-binding`),
    sourceEpochNonceSha256: digest(`${epoch}-nonce`),
    sourceEpochRenderGeneration: generation,
  };
}

function includeRectangle(
  expectedRevision: number,
  leftPx: number,
  topPx: number,
  rightExclusivePx: number,
  bottomExclusivePx: number,
): GrandHallT554NativeReviewMaskEditV2 {
  return {
    expectedRevision,
    operation: "include",
    primitive: {
      kind: "rectangle",
      horizontalSeam: "none",
      leftPx,
      topPx,
      rightExclusivePx,
      bottomExclusivePx,
    },
  };
}

function excludeRectangle(
  expectedRevision: number,
): GrandHallT554NativeReviewMaskEditV2 {
  return {
    expectedRevision,
    operation: "exclude",
    reasonCode: "adjacent_room_pixels",
    primitive: {
      kind: "rectangle",
      horizontalSeam: "none",
      leftPx: 10,
      topPx: 10,
      rightExclusivePx: 11,
      bottomExclusivePx: 11,
    },
  };
}

function stateEvidence(
  exact: GrandHallT554NativeMaskExactStateV2,
): GrandHallT554NativeReviewMaskStateEvidenceV2 {
  return {
    revision: exact.revision,
    maskStateSha256: exact.maskStateSha256,
    includedPixelCount: exact.includedPixelCount,
    excludedPixelCount: exact.excludedPixelCount,
    reasonCounts: [...exact.reasonCounts],
  };
}

function maskEditedEvent(input: {
  readonly index: number;
  readonly custody: GrandHallT554NativeReviewSourceCustodyBindingV2;
  readonly edit: GrandHallT554NativeReviewMaskEditV2;
  readonly previousMaskState: GrandHallT554NativeReviewMaskStateEvidenceV2;
  readonly resultingMaskState: GrandHallT554NativeReviewMaskStateEvidenceV2;
}): MaskEditedEventV2 {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-domain-event.v2",
    eventType: "mask.edited.v2",
    payload: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-edited.v2",
      operationIdSha256: digest(`operation-${String(input.index)}`),
      browserEpochNonceSha256: digest("browser-epoch"),
      previousWorkspaceRevision: input.index,
      resultingWorkspaceRevision: input.index + 1,
      sourceCustody: input.custody,
      previousRenderGeneration: input.index + 1,
      resultingRenderGeneration: input.index + 2,
      edit: input.edit,
      previousMaskState: input.previousMaskState,
      resultingMaskState: input.resultingMaskState,
      invalidatedFrozenBindingSha256: null,
      invalidatedMaskJournal: null,
    },
  };
}

function validClaims(
  context = replayContext(),
): {
  readonly initialMaskState: GrandHallT554NativeReviewMaskStateEvidenceV2;
  readonly events: readonly [MaskEditedEventV2, MaskEditedEventV2];
} {
  const store = GrandHallT554NativeMaskRevisionStore.createReplayOnly(
    context.source,
  );
  const custody = custodyForContext(context);
  try {
    const initialMaskState = stateEvidence(store.exactStateV2(context));
    const firstEdit = includeRectangle(0, 10, 10, 13, 12);
    const firstPrevious = stateEvidence(store.exactStateV2(context));
    store.applyEdit(firstEdit);
    const firstResulting = stateEvidence(store.exactStateV2(context));
    const secondEdit = excludeRectangle(1);
    const secondPrevious = stateEvidence(store.exactStateV2(context));
    store.applyEdit(secondEdit);
    const secondResulting = stateEvidence(store.exactStateV2(context));
    return {
      initialMaskState,
      events: [
        maskEditedEvent({
          index: 1,
          custody,
          edit: firstEdit,
          previousMaskState: firstPrevious,
          resultingMaskState: firstResulting,
        }),
        maskEditedEvent({
          index: 2,
          custody,
          edit: secondEdit,
          previousMaskState: secondPrevious,
          resultingMaskState: secondResulting,
        }),
      ],
    };
  } finally {
    store.abandon();
  }
}

function verify(input: {
  readonly context: GrandHallT554NativeMaskReplayContextV2;
  readonly initialMaskState: GrandHallT554NativeReviewMaskStateEvidenceV2;
  readonly events: readonly MaskEditedEventV2[];
}) {
  return verifyGrandHallT554NativeMaskStateReplayV2(input);
}

describe("Grand Hall T-554 exact native mask-state replay v2", () => {
  it("canonically derives a frozen replay context from strict session scope and source custody", () => {
    const session = sessionScope();
    const custody = sourceCustody();
    const context = buildGrandHallT554NativeMaskReplayContextV2(
      session,
      custody,
    );

    expect(context).toEqual(replayContext(custody));
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.registry)).toBe(true);
    expect(context.registry).not.toBe(session.registry);
    expect(context.source).not.toBe(custody.source);
  });

  it("rejects non-strict session scope and internally inconsistent custody", () => {
    const sessionWithUnknownKey = {
      ...sessionScope(),
      browserControlledPath: "C:\\untrusted",
    };
    expect(() =>
      buildGrandHallT554NativeMaskReplayContextV2(
        sessionWithUnknownKey,
        sourceCustody(),
      ),
    ).toThrowError(expect.objectContaining({ code: "INPUT_INVALID" }));

    const validCustody = sourceCustody();
    const inconsistentCustody = {
      ...validCustody,
      sourceVerification: {
        ...validCustody.sourceVerification,
        sha256: digest("different-source-bytes"),
      },
    };
    expect(() =>
      buildGrandHallT554NativeMaskReplayContextV2(
        sessionScope(),
        inconsistentCustody,
      ),
    ).toThrowError(expect.objectContaining({ code: "INPUT_INVALID" }));
  });

  it("replays valid ordered edits through the deterministic rasterizer", () => {
    const context = replayContext();
    const claims = validClaims(context);
    const replay = verify({ context, ...claims });

    expect(replay).toMatchObject({
      editCount: 2,
      initialState: {
        revision: 0,
        includedPixelCount: 0,
        excludedPixelCount: PIXEL_COUNT,
      },
      finalState: {
        revision: 2,
        includedPixelCount: 5,
        excludedPixelCount: PIXEL_COUNT - 5,
        reasonCounts: [
          { reasonCode: "adjacent_room_pixels", pixelCount: 1 },
          {
            reasonCode: "unverified_or_unknown_pixels",
            pixelCount: PIXEL_COUNT - 6,
          },
        ],
      },
    });
    expect(replay.states).toHaveLength(3);
    expect(replay.finalState.pixelTileInventorySha256).not.toBe(
      replay.initialState.pixelTileInventorySha256,
    );
    expect(Object.isFrozen(replay)).toBe(true);
  });

  it("is path and OS independent and rejects publication controls in replay input", () => {
    const context = replayContext();
    const claims = validClaims(context);
    const first = verify({ context, ...claims });
    const second = verify({ context, ...claims });

    expect(second).toEqual(first);
    for (const publicationDirectory of [
      "C:\\browser-controlled\\mask-output",
      "/tmp/browser-controlled-mask-output",
    ]) {
      expect(() => verifyGrandHallT554NativeMaskStateReplayV2({
        publicationDirectory,
        context,
        ...claims,
      })).toThrowError(expect.objectContaining({ code: "INPUT_INVALID" }));
    }
  });

  it("rejects forged counts and a forged digest", () => {
    const context = replayContext();
    const claims = validClaims(context);
    const first = claims.events[0];
    const result = first.payload.resultingMaskState;
    const forgedCounts: MaskEditedEventV2 = {
      ...first,
      payload: {
        ...first.payload,
        resultingMaskState: {
          ...result,
          includedPixelCount: result.includedPixelCount + 1,
          excludedPixelCount: result.excludedPixelCount - 1,
          reasonCounts: [
            {
              reasonCode: "unverified_or_unknown_pixels",
              pixelCount: result.excludedPixelCount - 1,
            },
          ],
        },
      },
    };
    expect(() =>
      verify({
        context,
        initialMaskState: claims.initialMaskState,
        events: [forgedCounts],
      }),
    ).toThrowError(expect.objectContaining({ code: "STATE_MISMATCH" }));

    const forgedDigest: MaskEditedEventV2 = {
      ...first,
      payload: {
        ...first.payload,
        resultingMaskState: {
          ...result,
          maskStateSha256: digest("forged-mask-state"),
        },
      },
    };
    expect(() =>
      verify({
        context,
        initialMaskState: claims.initialMaskState,
        events: [forgedDigest],
      }),
    ).toThrowError(expect.objectContaining({ code: "STATE_MISMATCH" }));

    const second = claims.events[1];
    const forgedPrevious: MaskEditedEventV2 = {
      ...second,
      payload: {
        ...second.payload,
        previousMaskState: {
          ...second.payload.previousMaskState,
          maskStateSha256: digest("forged-previous-mask-state"),
        },
      },
    };
    expect(() =>
      verify({
        context,
        initialMaskState: claims.initialMaskState,
        events: [first, forgedPrevious],
      }),
    ).toThrowError(expect.objectContaining({ code: "STATE_MISMATCH" }));
  });

  it("rejects a validly shaped edit whose claimed result was not rerasterized", () => {
    const context = replayContext();
    const claims = validClaims(context);
    const first = claims.events[0];
    const forgedEdit: MaskEditedEventV2 = {
      ...first,
      payload: {
        ...first.payload,
        edit: includeRectangle(0, 10, 10, 14, 12),
      },
    };

    expect(() =>
      verify({
        context,
        initialMaskState: claims.initialMaskState,
        events: [forgedEdit],
      }),
    ).toThrowError(expect.objectContaining({ code: "STATE_MISMATCH" }));
  });

  it("rejects session, registry, implementation, and subject context transplants", () => {
    const context = replayContext();
    const claims = validClaims(context);
    const alternateCustody = sourceCustody(
      context.source,
      digest("alternate-subject"),
    );
    const transplants: readonly GrandHallT554NativeMaskReplayContextV2[] = [
      { ...context, sessionIdSha256: digest("another-session") },
      {
        ...context,
        registry: {
          ...context.registry,
          reviewPack: {
            ...context.registry.reviewPack,
            semanticSha256: digest("another-registry"),
          },
        },
      },
      {
        ...context,
        implementationManifest: {
          ...context.implementationManifest,
          semanticSha256: digest("another-implementation"),
        },
      },
      {
        ...context,
        source: alternateCustody.source,
        sourceVerification: alternateCustody.sourceVerification,
        sourceReviewSubjectSha256:
          alternateCustody.sourceReviewSubjectSha256,
      },
    ];

    for (const transplanted of transplants) {
      expect(() =>
        verify({
          context: transplanted,
          initialMaskState: claims.initialMaskState,
          events: claims.events,
        }),
      ).toThrowError(expect.objectContaining({ code: "STATE_MISMATCH" }));
    }
  });

  it("rejects an edit transplanted from different exact source custody", () => {
    const context = replayContext();
    const claims = validClaims(context);
    const first = claims.events[0];
    const transplanted: MaskEditedEventV2 = {
      ...first,
      payload: {
        ...first.payload,
        sourceCustody: sourceCustody(
          sourceIdentity(1),
          digest("other-source-subject"),
        ),
      },
    };

    expect(() =>
      verify({
        context,
        initialMaskState: claims.initialMaskState,
        events: [transplanted],
      }),
    ).toThrowError(expect.objectContaining({ code: "CONTEXT_MISMATCH" }));
  });

  it("rejects a revision sequence discontinuity", () => {
    const context = replayContext();
    const claims = validClaims(context);

    expect(() =>
      verify({
        context,
        initialMaskState: claims.initialMaskState,
        events: [claims.events[1]],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "SEQUENCE_DISCONTINUITY" }),
    );
  });

  it("adds local continuity checks after coordinator validation", () => {
    const context = replayContext();
    const claims = validClaims(context);
    const first = claims.events[0];
    const second = claims.events[1];
    const duplicateOperation: MaskEditedEventV2 = {
      ...second,
      payload: {
        ...second.payload,
        operationIdSha256: first.payload.operationIdSha256,
      },
    };
    const regressedWorkspace: MaskEditedEventV2 = {
      ...second,
      payload: {
        ...second.payload,
        previousWorkspaceRevision: 1,
        resultingWorkspaceRevision: 2,
      },
    };
    const regressedRender: MaskEditedEventV2 = {
      ...second,
      payload: {
        ...second.payload,
        previousRenderGeneration: 2,
        resultingRenderGeneration: 4,
      },
    };

    for (const invalidSecond of [
      duplicateOperation,
      regressedWorkspace,
      regressedRender,
    ]) {
      expect(() => verify({
        context,
        initialMaskState: claims.initialMaskState,
        events: [first, invalidSecond],
      })).toThrowError(expect.objectContaining({
        code: "SEQUENCE_DISCONTINUITY",
      }));
    }
  });

  it("replays edits across a crash-rotated source epoch using only stable custody context", () => {
    const context = replayContext();
    const beforeCrash = custodyForContext(context, "before-crash", 1);
    const afterCrash = custodyForContext(context, "after-crash", 4);
    const store = GrandHallT554NativeMaskRevisionStore.createReplayOnly(
      context.source,
    );
    try {
      const initialMaskState = stateEvidence(store.exactStateV2(context));
      const firstEdit = includeRectangle(0, 20, 20, 22, 22);
      const firstPrevious = stateEvidence(store.exactStateV2(context));
      store.applyEdit(firstEdit);
      const firstResulting = stateEvidence(store.exactStateV2(context));
      const secondEdit = includeRectangle(1, 30, 30, 32, 32);
      const secondPrevious = stateEvidence(store.exactStateV2(context));
      store.applyEdit(secondEdit);
      const secondResulting = stateEvidence(store.exactStateV2(context));
      const replay = verify({
        context,
        initialMaskState,
        events: [
          maskEditedEvent({
            index: 1,
            custody: beforeCrash,
            edit: firstEdit,
            previousMaskState: firstPrevious,
            resultingMaskState: firstResulting,
          }),
          maskEditedEvent({
            index: 2,
            custody: afterCrash,
            edit: secondEdit,
            previousMaskState: secondPrevious,
            resultingMaskState: secondResulting,
          }),
        ],
      });
      expect(replay.finalState).toMatchObject({
        revision: 2,
        includedPixelCount: 8,
      });
      expect(replay.context).not.toHaveProperty("sourceEpochNonceSha256");
      expect(replay.context).not.toHaveProperty("sourceCustody");
    } finally {
      store.abandon();
    }
  });

  it("fails closed on a non-canonical initial-state claim", () => {
    const context = replayContext();
    const claims = validClaims(context);
    expect(() =>
      verifyGrandHallT554NativeMaskStateReplayV2({
        context,
        initialMaskState: {
          ...claims.initialMaskState,
          browserControlledDigest: digest("injected"),
        },
        events: [],
      }),
    ).toThrowError(GrandHallT554NativeMaskReplayV2Error);
  });
});
