import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  type GrandHallPanoramaSourceJpgIdentityV2,
} from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
  GrandHallT554NativeReviewMaskScopeV2Schema,
  type GrandHallT554NativeReviewMaskScopeV2,
} from "../grand-hall-t554-native-review-events-v2.js";
import {
  GrandHallT554NativeReviewSessionOrchestrationV2Error,
  publishGrandHallT554NativeReviewMaskChildStartV2,
  reconcileGrandHallT554NativeReviewMaskChildStartV2,
} from "../grand-hall-t554-native-review-session-orchestration-v2.js";

const PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const temporaryParents: string[] = [];

type Sha256 = `sha256:${string}`;

function digest(seed: string): Sha256 {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

function artifact(seed: string) {
  return {
    semanticSha256: digest(`${seed}-semantic`),
    fileSha256: digest(`${seed}-file`),
    byteLength: 1_024,
  };
}

const authority = {
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

const implementation = {
  schemaVersion:
    "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2" as const,
  implementationId: "grand-hall-t554-native-review-workbench-v1" as const,
  semanticSha256: digest("implementation-semantic"),
  fileSha256: digest("implementation-file"),
  byteLength: 8_192,
};

const registry = {
  schemaVersion:
    "venviewer.grand-hall-t554-native-review-registry-binding.v2" as const,
  venueSlug: "trades-hall" as const,
  roomSlug: "grand-hall" as const,
  sourceCount: 148 as const,
  reviewPack: artifact("review-pack"),
  publicationReceipt: artifact("receipt"),
  authority: "none" as const,
  reviewState: "human_pending" as const,
  finalDecision: "PENDING" as const,
  acceptanceAuthorized: false as const,
  reconstructionAuthorized: false as const,
  runtimeAuthorized: false as const,
  exportAuthorized: false as const,
  generatedContentAuthorized: false as const,
};

const source: GrandHallPanoramaSourceJpgIdentityV2 = {
  inventoryIndex: 0,
  sweepNumber: 1,
  fileName: "sweep_001jpg.jpg",
  sha256: digest("source"),
  byteLength: 6_419_919,
  widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
  heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
};

function maskScope(seed = "a"): GrandHallT554NativeReviewMaskScopeV2 {
  return GrandHallT554NativeReviewMaskScopeV2Schema.parse({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    kind: "mask",
    sessionIdSha256: digest("session"),
    implementationManifest: implementation,
    registry,
    authorityBoundary: authority,
    browserEpochNonceSha256: digest("browser"),
    coverageSegmentIdSha256: digest(`mask-segment-${seed}`),
    renderGeneration: seed === "a" ? 2 : 3,
    sourceCustody: {
      source,
      sourceVerification: {
        fileName: source.fileName,
        sha256: source.sha256,
        byteLength: source.byteLength,
        widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
        heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
        decodedChannelCount: 3,
        decodedBitsPerSample: 8,
        alphaPresent: false,
        orientationMetadataPresent: false,
        decodedPixelSha256: digest("decoded"),
        decoderIdentity: {
          schemaVersion:
            "venviewer.grand-hall-t554-source-jpeg-decoder-identity.v1",
          library: "sharp",
          sharpVersion: "0.35.3",
          libvipsVersion: "8.18.3",
          pipeline: "captured-jpeg-buffer-to-unrotated-rgb8.v1",
        },
        descriptorWitnessSha256: digest("descriptor-witness"),
        sameOpenDescriptorHashedAndDecoded: true,
        fullJpegDecodeCompleted: true,
      },
      sourceReviewSubjectSha256: digest("source-subject"),
      sourceEpochBindingSha256: digest("source-epoch-binding"),
      sourceEpochNonceSha256: digest("source-epoch-nonce"),
      sourceEpochRenderGeneration: 1,
    },
    maskReviewSubjectSha256: digest(`mask-subject-${seed}`),
    maskStateSha256: digest(`mask-state-${seed}`),
    frozenBindingSha256: digest(`frozen-binding-${seed}`),
    frozenBinding: {
      schemaVersion: "venviewer.grand-hall-t554-native-mask-frozen-binding.v2",
      source,
      revision: 1,
      fileName: `grand-hall-mask-${seed}.png`,
      sha256: digest(`mask-png-${seed}`),
      byteLength: 50_000,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
      bitDepth: 8,
      channelCount: 1,
      permittedPixelValues: [0, 255],
      zeroMeaning: "grand_hall_included",
      twoHundredFiftyFiveMeaning: "excluded_or_unknown",
      includedPixelCount: 1,
      excludedPixelCount: PIXEL_COUNT - 1,
      reasonCounts: [
        {
          reasonCode: "unverified_or_unknown_pixels",
          pixelCount: PIXEL_COUNT - 1,
        },
      ],
      publicationDurability: "directory_fsync",
      immutableFrozen: true,
      reasonMap: {
        fileName: `grand-hall-reason-map-${seed}.png`,
        sha256: digest(`reason-map-${seed}`),
        byteLength: 60_000,
        widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
        heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
        bitDepth: 8,
        channelCount: 1,
        permittedPixelValues: [0, 1, 2, 3, 4, 5],
        zeroMeaning: "grand_hall_included",
        reasonSampleCodebook: [
          { sample: 1, reasonCode: "adjacent_room_pixels" },
          { sample: 2, reasonCode: "portal_beyond_grand_hall_plane" },
          { sample: 3, reasonCode: "facade_or_exterior_pixels" },
          {
            sample: 4,
            reasonCode: "capture_artifact_outside_verified_room",
          },
          { sample: 5, reasonCode: "unverified_or_unknown_pixels" },
        ],
      },
    },
  });
}

interface Fixture {
  readonly parent: string;
  readonly sessionRoot: string;
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly operationIdentitySha256: Sha256;
}

async function fixture(seed = "a"): Promise<Fixture> {
  const parent = await mkdtemp(join(tmpdir(), "venviewer-t554-orchestration-"));
  temporaryParents.push(parent);
  const sessionRoot = join(parent, "session");
  await mkdir(join(sessionRoot, "children"), { recursive: true });
  await mkdir(join(sessionRoot, "child-scopes"));
  return {
    parent,
    sessionRoot,
    leafName: "mask-child-0000000000000002",
    scope: maskScope(seed),
    operationIdentitySha256: digest(`operation-${seed}`),
  };
}

function publishInput(built: Fixture) {
  return {
    sessionRoot: built.sessionRoot,
    scope: built.scope,
    leafName: built.leafName,
    startedAtUtc: "2000-01-01T00:00:00.000Z",
    predecessorCoverage: null,
    stageIdentitySha256: built.operationIdentitySha256,
  } as const;
}

function reconciliationInput(built: Fixture) {
  return {
    sessionRoot: built.sessionRoot,
    scope: built.scope,
    leafName: built.leafName,
    descriptorStageIdentitySha256: built.operationIdentitySha256,
  } as const;
}

async function stageNames(parent: string): Promise<string[]> {
  return (await readdir(parent)).filter((name) => name.endsWith(".stage"));
}

async function expectPublicationError(
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action();
    throw new Error("Expected mask child publication to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(
      GrandHallT554NativeReviewSessionOrchestrationV2Error,
    );
    expect(
      (error as GrandHallT554NativeReviewSessionOrchestrationV2Error).code,
    ).toBe("CHILD_PUBLICATION_INVALID");
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("Grand Hall T-554 mask child publication orchestration v2", () => {
  it("publishes one exact revision-one child and descriptor with no retained stage", async () => {
    const built = await fixture();
    const published = await publishGrandHallT554NativeReviewMaskChildStartV2(
      publishInput(built),
    );

    expect(published.evidence.kind).toBe("mask");
    expect(published.evidence.checkpoint.revision).toBe(1);
    expect(await stageNames(built.parent)).toEqual([]);
    expect(
      (
        await lstat(
          join(
            built.sessionRoot,
            "child-scopes",
            `${built.leafName}.json`,
          ),
          { bigint: true },
        )
      ).nlink,
    ).toBe(1n);

    const reconciled =
      await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        reconciliationInput(built),
      );
    expect(reconciled.disposition).toBe("exact");
  });

  it("repairs child-before-descriptor interruption only with the same durable operation", async () => {
    const built = await fixture();
    await expect(
      publishGrandHallT554NativeReviewMaskChildStartV2({
        ...publishInput(built),
        afterChildPublished: () => {
          throw new Error("injected child-before-descriptor crash");
        },
      }),
    ).rejects.toThrow("injected child-before-descriptor crash");
    expect(await stageNames(built.parent)).toHaveLength(1);

    await expectPublicationError(async () =>
      await reconcileGrandHallT554NativeReviewMaskChildStartV2({
        ...reconciliationInput(built),
        descriptorStageIdentitySha256: digest("different-operation"),
      }),
    );
    expect(await stageNames(built.parent)).toHaveLength(1);

    const recovered =
      await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        reconciliationInput(built),
      );
    expect(recovered.disposition).toBe("exact");
    expect(await stageNames(built.parent)).toEqual([]);
  });

  it("completes only an exact partial no-replace child topology from its durable stage", async () => {
    const built = await fixture();
    await expect(
      publishGrandHallT554NativeReviewMaskChildStartV2({
        ...publishInput(built),
        afterChildPublished: () => {
          throw new Error("injected child-before-descriptor crash");
        },
      }),
    ).rejects.toThrow("injected child-before-descriptor crash");
    const eventDirectory = join(
      built.sessionRoot,
      "children",
      built.leafName,
      "events",
    );
    const [eventName] = await readdir(eventDirectory);
    if (eventName === undefined) throw new Error("missing published event fixture");
    await unlink(join(eventDirectory, eventName));

    const recovered =
      await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        reconciliationInput(built),
      );
    expect(recovered.disposition).toBe("exact");
    if (recovered.disposition !== "exact") {
      throw new Error("exact partial child did not reconcile");
    }
    expect(recovered.evidence.checkpoint.revision).toBe(1);
    expect(await stageNames(built.parent)).toEqual([]);
  });

  it("repairs exact partial destination scope and claim writes", async () => {
    for (const partialFile of ["scope", "claim"] as const) {
      const built = await fixture(`partial-${partialFile}`);
      await expect(
        publishGrandHallT554NativeReviewMaskChildStartV2({
          ...publishInput(built),
          afterChildPublished: () => {
            throw new Error("injected child-before-descriptor crash");
          },
        }),
      ).rejects.toThrow("injected child-before-descriptor crash");
      const childPath = join(
        built.sessionRoot,
        "children",
        built.leafName,
      );
      const eventDirectory = join(childPath, "events");
      const [eventName] = await readdir(eventDirectory);
      if (eventName === undefined) throw new Error("missing published event fixture");
      await unlink(join(eventDirectory, eventName));
      const claimPath = join(childPath, "claims", "0000000000000001.json");
      if (partialFile === "scope") {
        await unlink(claimPath);
        const scopePath = join(childPath, "scope.json");
        const bytes = await readFile(scopePath);
        await writeFile(scopePath, bytes.subarray(0, Math.floor(bytes.length / 2)));
      } else {
        const bytes = await readFile(claimPath);
        await writeFile(claimPath, bytes.subarray(0, Math.floor(bytes.length / 2)));
      }

      const recovered =
        await reconcileGrandHallT554NativeReviewMaskChildStartV2(
          reconciliationInput(built),
        );
      expect(recovered.disposition).toBe("exact");
      expect(await stageNames(built.parent)).toEqual([]);
    }
  });

  it("rejects an impossible partial destination directory subset", async () => {
    const built = await fixture();
    await expect(
      publishGrandHallT554NativeReviewMaskChildStartV2({
        ...publishInput(built),
        afterChildPublished: () => {
          throw new Error("injected child-before-descriptor crash");
        },
      }),
    ).rejects.toThrow("injected child-before-descriptor crash");
    const childPath = join(built.sessionRoot, "children", built.leafName);
    await rm(join(childPath, "claims"), { recursive: true });
    await rm(join(childPath, "events"), { recursive: true });

    await expectPublicationError(async () =>
      await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        reconciliationInput(built),
      ),
    );
    expect(await stageNames(built.parent)).toHaveLength(1);
  });

  it("never overwrites a descriptor that appears after child publication", async () => {
    const built = await fixture();
    const descriptorPath = join(
      built.sessionRoot,
      "child-scopes",
      `${built.leafName}.json`,
    );
    const racedBytes = Buffer.from("raced-destination\n", "utf8");

    await expectPublicationError(async () =>
      await publishGrandHallT554NativeReviewMaskChildStartV2({
        ...publishInput(built),
        afterChildPublished: async () => {
          await writeFile(descriptorPath, racedBytes, { flag: "wx" });
        },
      }),
    );
    expect(await readFile(descriptorPath)).toEqual(racedBytes);
    expect(await stageNames(built.parent)).toHaveLength(1);
  });

  it("adopts an independently created descriptor only after exact-byte verification", async () => {
    const built = await fixture();
    await expect(
      publishGrandHallT554NativeReviewMaskChildStartV2({
        ...publishInput(built),
        afterChildPublished: () => {
          throw new Error("injected child-before-descriptor crash");
        },
      }),
    ).rejects.toThrow("injected child-before-descriptor crash");
    const [stageName] = await stageNames(built.parent);
    if (stageName === undefined) throw new Error("missing deterministic stage");
    const descriptorBytes = await readFile(
      join(built.parent, stageName, "descriptor.json"),
    );
    const descriptorPath = join(
      built.sessionRoot,
      "child-scopes",
      `${built.leafName}.json`,
    );
    await writeFile(descriptorPath, descriptorBytes, { flag: "wx" });

    const recovered =
      await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        reconciliationInput(built),
      );
    expect(recovered.disposition).toBe("exact");
    expect((await lstat(descriptorPath, { bigint: true })).nlink).toBe(1n);
    expect(await stageNames(built.parent)).toEqual([]);
  });

  it("allows only one of two competing scopes to reserve the child destination", async () => {
    const builtA = await fixture("a");
    const builtB: Fixture = {
      ...builtA,
      scope: maskScope("b"),
      operationIdentitySha256: digest("operation-b"),
    };
    const outcomes = await Promise.allSettled([
      publishGrandHallT554NativeReviewMaskChildStartV2(publishInput(builtA)),
      publishGrandHallT554NativeReviewMaskChildStartV2(publishInput(builtB)),
    ]);

    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    const winner = outcomes[0]?.status === "fulfilled" ? builtA : builtB;
    const reconciled =
      await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        reconciliationInput(winner),
      );
    expect(reconciled.disposition).toBe("exact");
  });

  it("rejects and preserves a replacement installed before exact stage cleanup", async () => {
    const built = await fixture();
    let replacementPath: string | undefined;
    await expectPublicationError(async () =>
      await publishGrandHallT554NativeReviewMaskChildStartV2({
        ...publishInput(built),
        afterDescriptorPublished: async () => {
          const [stageName] = await stageNames(built.parent);
          if (stageName === undefined) throw new Error("missing deterministic stage");
          const stagePath = join(built.parent, stageName);
          await rename(stagePath, `${stagePath}.displaced`);
          await mkdir(stagePath);
          replacementPath = join(stagePath, "foreign.txt");
          await writeFile(replacementPath, "foreign replacement", "utf8");
        },
      }),
    );
    expect(replacementPath).toBeDefined();
    expect(await readFile(replacementPath ?? "", "utf8")).toBe(
      "foreign replacement",
    );
  });

  it("reopens the published pair after cleanup and never returns stale evidence", async () => {
    const built = await fixture();
    const childPath = join(
      built.sessionRoot,
      "children",
      built.leafName,
    );
    const replacementPath = join(childPath, "foreign.txt");
    await expectPublicationError(async () =>
      await publishGrandHallT554NativeReviewMaskChildStartV2({
        ...publishInput(built),
        afterStageCleanupBeforePublicationReopen: async () => {
          await rename(childPath, `${childPath}.displaced`);
          await mkdir(childPath);
          await writeFile(replacementPath, "foreign replacement", "utf8");
        },
      }),
    );
    expect(await readFile(replacementPath, "utf8")).toBe(
      "foreign replacement",
    );
    expect(await stageNames(built.parent)).toEqual([]);
  });

  it("discards an exact partial operation write and recreates the full stage", async () => {
    const built = await fixture();
    await expect(
      publishGrandHallT554NativeReviewMaskChildStartV2({
        ...publishInput(built),
        afterChildPublished: () => {
          throw new Error("injected post-stage crash");
        },
      }),
    ).rejects.toThrow("injected post-stage crash");
    const [stageName] = await stageNames(built.parent);
    if (stageName === undefined) throw new Error("missing deterministic stage");
    const stagePath = join(built.parent, stageName);
    await rm(join(built.sessionRoot, "children", built.leafName), {
      recursive: true,
    });
    await rm(join(stagePath, "child"), { recursive: true });
    await unlink(join(stagePath, "descriptor.json"));
    const operationPath = join(stagePath, "operation.json");
    const operationBytes = await readFile(operationPath);
    await writeFile(
      operationPath,
      operationBytes.subarray(0, Math.floor(operationBytes.length / 2)),
    );

    const reconciled =
      await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        reconciliationInput(built),
      );
    expect(reconciled.disposition).toBe("absent");
    expect(await stageNames(built.parent)).toEqual([]);

    const published = await publishGrandHallT554NativeReviewMaskChildStartV2(
      publishInput(built),
    );
    expect(published.evidence.checkpoint.revision).toBe(1);
    expect(await stageNames(built.parent)).toEqual([]);
  });

  it("discards the exact empty reserved stage after a pre-binding crash", async () => {
    const built = await fixture();
    await expect(
      publishGrandHallT554NativeReviewMaskChildStartV2({
        ...publishInput(built),
        afterChildPublished: () => {
          throw new Error("injected post-stage crash");
        },
      }),
    ).rejects.toThrow("injected post-stage crash");
    const [stageName] = await stageNames(built.parent);
    if (stageName === undefined) throw new Error("missing deterministic stage");
    const stagePath = join(built.parent, stageName);
    await rm(join(built.sessionRoot, "children", built.leafName), {
      recursive: true,
    });
    await rm(stagePath, { recursive: true });
    await mkdir(stagePath);

    const reconciled =
      await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        reconciliationInput(built),
      );
    expect(reconciled.disposition).toBe("absent");
    expect(await stageNames(built.parent)).toEqual([]);
  });

  it("rolls an exact committed staged journal forward without discarding it", async () => {
    const built = await fixture();
    await expect(
      publishGrandHallT554NativeReviewMaskChildStartV2({
        ...publishInput(built),
        afterChildPublished: () => {
          throw new Error("injected post-stage crash");
        },
      }),
    ).rejects.toThrow("injected post-stage crash");
    const [stageName] = await stageNames(built.parent);
    if (stageName === undefined) throw new Error("missing deterministic stage");
    const stagePath = join(built.parent, stageName);
    await rm(join(built.sessionRoot, "children", built.leafName), {
      recursive: true,
    });
    await unlink(join(stagePath, "descriptor.json"));

    const reconciled =
      await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        reconciliationInput(built),
      );
    expect(reconciled.disposition).toBe("exact");
    expect(await stageNames(built.parent)).toEqual([]);
  });

  it("retries a second crash during revision-zero creation-prefix discard", async () => {
    const built = await fixture();
    await expect(
      publishGrandHallT554NativeReviewMaskChildStartV2({
        ...publishInput(built),
        afterChildPublished: () => {
          throw new Error("injected post-stage crash");
        },
      }),
    ).rejects.toThrow("injected post-stage crash");
    const [stageName] = await stageNames(built.parent);
    if (stageName === undefined) throw new Error("missing deterministic stage");
    const stagePath = join(built.parent, stageName);
    await rm(join(built.sessionRoot, "children", built.leafName), {
      recursive: true,
    });
    await unlink(join(stagePath, "descriptor.json"));
    const stagedEvents = join(stagePath, "child", "events");
    const [eventName] = await readdir(stagedEvents);
    if (eventName === undefined) throw new Error("missing staged event");
    await unlink(join(stagedEvents, eventName));
    await unlink(
      join(stagePath, "child", "claims", "0000000000000001.json"),
    );
    await unlink(join(stagePath, "child", "scope.json"));
    await rm(join(stagePath, "child", "quarantine"), { recursive: true });

    const reconciled =
      await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        reconciliationInput(built),
      );
    expect(reconciled.disposition).toBe("absent");
    expect(await stageNames(built.parent)).toEqual([]);
  });

  it("repairs an exact partial stage descriptor and rolls forward", async () => {
    const built = await fixture();
    await expect(
      publishGrandHallT554NativeReviewMaskChildStartV2({
        ...publishInput(built),
        afterChildPublished: () => {
          throw new Error("injected post-stage crash");
        },
      }),
    ).rejects.toThrow("injected post-stage crash");
    const [stageName] = await stageNames(built.parent);
    if (stageName === undefined) throw new Error("missing deterministic stage");
    const stagePath = join(built.parent, stageName);
    await rm(join(built.sessionRoot, "children", built.leafName), {
      recursive: true,
    });
    const descriptorPath = join(stagePath, "descriptor.json");
    const descriptorBytes = await readFile(descriptorPath);
    await writeFile(
      descriptorPath,
      descriptorBytes.subarray(0, Math.floor(descriptorBytes.length / 2)),
    );

    const reconciled =
      await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        reconciliationInput(built),
      );
    expect(reconciled.disposition).toBe("exact");
    expect(await stageNames(built.parent)).toEqual([]);
  });

  it("restarts an exact descriptor-only construction prefix", async () => {
    const built = await fixture();
    await publishGrandHallT554NativeReviewMaskChildStartV2(publishInput(built));
    const publishedDescriptorPath = join(
      built.sessionRoot,
      "child-scopes",
      `${built.leafName}.json`,
    );
    await unlink(publishedDescriptorPath);
    await expect(
      reconcileGrandHallT554NativeReviewMaskChildStartV2({
        ...reconciliationInput(built),
        afterDescriptorPublished: () => {
          throw new Error("injected descriptor-stage crash");
        },
      }),
    ).rejects.toThrow("injected descriptor-stage crash");
    const [stageName] = await stageNames(built.parent);
    if (stageName === undefined) throw new Error("missing descriptor stage");
    const stagePath = join(built.parent, stageName);
    await unlink(publishedDescriptorPath);
    const descriptorPath = join(stagePath, "descriptor.json");
    const descriptorBytes = await readFile(descriptorPath);
    await writeFile(
      descriptorPath,
      descriptorBytes.subarray(0, Math.floor(descriptorBytes.length / 2)),
    );

    const reconciled =
      await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        reconciliationInput(built),
      );
    expect(reconciled.disposition).toBe("exact");
    expect(await stageNames(built.parent)).toEqual([]);
  });

  it("finishes an exact post-event cleanup suffix against the published pair", async () => {
    const built = await fixture();
    await expect(
      publishGrandHallT554NativeReviewMaskChildStartV2({
        ...publishInput(built),
        afterDescriptorPublished: () => {
          throw new Error("injected pre-cleanup crash");
        },
      }),
    ).rejects.toThrow("injected pre-cleanup crash");
    const [stageName] = await stageNames(built.parent);
    if (stageName === undefined) throw new Error("missing deterministic stage");
    const stagePath = join(built.parent, stageName);
    await unlink(join(stagePath, "descriptor.json"));
    const eventDirectory = join(stagePath, "child", "events");
    const [eventName] = await readdir(eventDirectory);
    if (eventName === undefined) throw new Error("missing staged event");
    await unlink(join(eventDirectory, eventName));

    const reconciled =
      await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        reconciliationInput(built),
      );
    expect(reconciled.disposition).toBe("exact");
    expect(await stageNames(built.parent)).toEqual([]);
  });

  it("finishes an exact late operation-only cleanup suffix", async () => {
    const built = await fixture();
    await expect(
      publishGrandHallT554NativeReviewMaskChildStartV2({
        ...publishInput(built),
        afterDescriptorPublished: () => {
          throw new Error("injected pre-cleanup crash");
        },
      }),
    ).rejects.toThrow("injected pre-cleanup crash");
    const [stageName] = await stageNames(built.parent);
    if (stageName === undefined) throw new Error("missing deterministic stage");
    const stagePath = join(built.parent, stageName);
    await unlink(join(stagePath, "descriptor.json"));
    await rm(join(stagePath, "child"), { recursive: true });

    const reconciled =
      await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        reconciliationInput(built),
      );
    expect(reconciled.disposition).toBe("exact");
    expect(await stageNames(built.parent)).toEqual([]);
  });

  it("rejects an impossible cleanup subset and preserves it", async () => {
    const built = await fixture();
    await expect(
      publishGrandHallT554NativeReviewMaskChildStartV2({
        ...publishInput(built),
        afterDescriptorPublished: () => {
          throw new Error("injected pre-cleanup crash");
        },
      }),
    ).rejects.toThrow("injected pre-cleanup crash");
    const [stageName] = await stageNames(built.parent);
    if (stageName === undefined) throw new Error("missing deterministic stage");
    const stagePath = join(built.parent, stageName);
    await unlink(join(stagePath, "descriptor.json"));
    await rm(join(stagePath, "child", "claims"), { recursive: true });

    await expectPublicationError(async () =>
      await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        reconciliationInput(built),
      ),
    );
    expect(await stageNames(built.parent)).toEqual([stageName]);
  });
});
