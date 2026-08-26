import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT,
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  GRAND_HALL_REVIEW_PANORAMA_COUNT,
  GrandHallClosedBoundaryV1Schema,
  GrandHallPanoramaMaskSetV1Schema,
  GrandHallPortalDecisionsV1Schema,
  GrandHallRoomMembershipV2Schema,
  GrandHallScopeReviewPackV1Schema,
  stableCanonicalJson,
  type GrandHallScopeReviewPackV1,
} from "@omnitwin/types";
import sharp from "sharp";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

import {
  GrandHallT554AcceptanceError,
  GrandHallT554ClosedVolumeReviewSchema,
  GrandHallT554HumanDecisionsSchema,
  acceptGrandHallT554Scope,
  bindGrandHallT554PendingMaskEvidence,
  buildGrandHallT554AcceptedScopeArtifacts,
  buildGrandHallT554AcceptanceTemplates,
  computeGrandHallT554ClosedVolumeReviewSha256,
  computeGrandHallT554HumanDecisionsSha256,
  publishGrandHallT554AcceptedScopeBundle,
  writeGrandHallT554AcceptanceTemplates,
  type GrandHallT554AcceptanceMediaEvidence,
  type GrandHallT554ClosedVolumeReview,
  type GrandHallT554HumanDecisions,
  type PublishGrandHallT554AcceptedScopeResult,
} from "../grand-hall-t554-acceptance.js";

const REVIEW_PACK_PATH = fileURLToPath(new URL(
  "../../../../docs/operations/grand-hall-t554-review-pack/review-pack.json",
  import.meta.url,
));
const PERSISTED_DECISIONS_TEMPLATE_PATH = fileURLToPath(new URL(
  "../../../../docs/operations/grand-hall-t554-acceptance-template/human-decisions.json",
  import.meta.url,
));
const PERSISTED_VOLUME_TEMPLATE_PATH = fileURLToPath(new URL(
  "../../../../docs/operations/grand-hall-t554-acceptance-template/closed-selection-volume.json",
  import.meta.url,
));

const temporaryRoots: string[] = [];
let reviewPack: GrandHallScopeReviewPackV1;

function digest(label: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

const HUMAN_REVIEW = {
  reviewerId: "venue-owner-reviewer",
  reviewerRole: "venue_owner_or_authorized_domain_reviewer" as const,
  reviewedAt: "2026-08-26T12:00:00.000Z",
  knowledgeBasis: ["Captured the Grand Hall and knows its physical room boundaries."],
  agentDecisionAuthority: "none" as const,
};

function acceptedPanoramaDecision(
  decision: GrandHallT554HumanDecisions["panoramaDecisions"][number],
): GrandHallT554HumanDecisions["panoramaDecisions"][number] {
  const excluded = decision.sweepNumber === 19 || decision.sweepNumber === 50;
  const threshold = [1, 18, 49].includes(decision.sweepNumber);
  return {
    ...decision,
    result: excluded ? "EXCLUDE" : "INCLUDE",
    classification: excluded
      ? "adjacent_room_or_outside_grand_hall"
      : threshold
        ? "grand_hall_portal_threshold"
        : "grand_hall_core",
    maskFileName: excluded
      ? null
      : `masks/sweep-${String(decision.sweepNumber).padStart(3, "0")}.png`,
    reviewedMaskBinding: excluded
      ? null
      : {
        sha256: digest(`mask-${String(decision.sweepNumber)}`),
        byteLength: 100 + decision.sweepNumber,
        includedPixelCount: 8_192 * 4_096 - (threshold ? 1 : 0),
        excludedPixelCount: threshold ? 1 : 0,
      },
    maskReviewed: !excluded,
    maskReasonCodes: threshold ? ["adjacent_room_pixels"] : [],
    note: excluded
      ? "Reviewed as outside the Grand Hall."
      : "Reviewed against the source panorama and Grand Hall boundary.",
  };
}

function acceptedHumanDecisions(): GrandHallT554HumanDecisions {
  const { humanDecisions } = buildGrandHallT554AcceptanceTemplates(reviewPack);
  return GrandHallT554HumanDecisionsSchema.parse({
    ...humanDecisions,
    reviewState: "human_accepted",
    finalDecision: "ACCEPT",
    reviewer: HUMAN_REVIEW,
    matterPakRoomDecision: {
      ...humanDecisions.matterPakRoomDecision,
      result: "ACCEPT_AS_GRAND_HALL",
      note: "I recognize exact MatterPak room 9 as the Grand Hall.",
    },
    cleanupArtifactInspections: humanDecisions.cleanupArtifactInspections.map((inspection) => ({
      ...inspection,
      result: "ACCEPT_SOURCE_SCOPE_HANDLING_NO_ARCHITECTURAL_AUTHORITY",
      note: `Reviewed ${inspection.artifactClass} source cleanup evidence without granting architecture authority.`,
    })),
    panoramaDecisions: humanDecisions.panoramaDecisions.map(acceptedPanoramaDecision),
    nonCandidatePanoramaDecisions: humanDecisions.nonCandidatePanoramaDecisions.map(
      (decision) => ({
        ...decision,
        result: "EXCLUDE_OUTSIDE_GRAND_HALL",
        note: "Reviewed this exact source JPEG and confirmed it is outside the Grand Hall.",
      }),
    ),
    interfaceDecisions: humanDecisions.interfaceDecisions.map((decision) => ({
      ...decision,
      result: "EXCLUDE_BEYOND_INTERFACE",
      note: "Reviewed against the exact source topology atlas; retain only the Grand Hall side.",
    })),
  });
}

function acceptedClosedVolume(): GrandHallT554ClosedVolumeReview {
  const { closedVolume } = buildGrandHallT554AcceptanceTemplates(reviewPack);
  return GrandHallT554ClosedVolumeReviewSchema.parse({
    ...closedVolume,
    reviewState: "human_accepted",
    finalDecision: "ACCEPT",
    reviewer: HUMAN_REVIEW,
    footprintXY: [
      [0, 0],
      [8, 0],
      [8, 5],
      [5, 5],
      [5, 3],
      [3, 3],
      [3, 5],
      [0, 5],
    ],
    zMin: -0.25,
    zMax: 8,
    note: "Reviewed only as an invisible source-selection volume, never as architecture.",
  });
}

function rejectedHumanDecisions(): GrandHallT554HumanDecisions {
  const { humanDecisions } = buildGrandHallT554AcceptanceTemplates(reviewPack);
  return GrandHallT554HumanDecisionsSchema.parse({
    ...humanDecisions,
    reviewState: "human_rejected",
    finalDecision: "REJECT",
    reviewer: HUMAN_REVIEW,
  });
}

function rejectedClosedVolume(): GrandHallT554ClosedVolumeReview {
  const { closedVolume } = buildGrandHallT554AcceptanceTemplates(reviewPack);
  return GrandHallT554ClosedVolumeReviewSchema.parse({
    ...closedVolume,
    reviewState: "human_rejected",
    finalDecision: "REJECT",
    reviewer: HUMAN_REVIEW,
  });
}

function acceptedMediaEvidence(
  decisions: GrandHallT554HumanDecisions,
): GrandHallT554AcceptanceMediaEvidence {
  const sourceJpegs = new Map(reviewPack.panoramaDirectoryFiles.map((source) => [
    source.fileName,
    {
      fileName: source.fileName,
      sha256: source.sha256,
      byteLength: source.byteLength,
      exactSourceGridDecoded: true as const,
    },
  ]));
  const masks = new Map(decisions.panoramaDecisions.flatMap((decision) => {
    if (decision.result !== "INCLUDE" || decision.maskFileName === null) return [];
    const threshold = decision.classification === "grand_hall_portal_threshold";
    return [[decision.maskFileName, {
      fileName: decision.maskFileName,
      sha256: digest(`mask-${String(decision.sweepNumber)}`),
      byteLength: 100 + decision.sweepNumber,
      includedPixelCount: 8_192 * 4_096 - (threshold ? 1 : 0),
      excludedPixelCount: threshold ? 1 : 0,
      exactBinarySourceGridDecoded: true as const,
    }] as const];
  }));
  return { sourceJpegs, masks };
}

function completeInjectedPublicationResult(
  decisions: GrandHallT554HumanDecisions,
  volume: GrandHallT554ClosedVolumeReview,
): PublishGrandHallT554AcceptedScopeResult {
  return {
    outputDirectory: "accepted-output",
    outputFileNames: [
      "closed-selection-volume.json",
      "interface-decisions.json",
      "panorama-mask-set.json",
      "room-membership.json",
    ],
    publicationReceiptFileName: "publication-receipt.json",
    preservedReviewFileNames: [
      "review-pack.json",
      "review/human-decisions.json",
      "review/closed-selection-volume-review.json",
    ],
    preservedMaskFileNames: decisions.panoramaDecisions.flatMap((decision) =>
      decision.result === "INCLUDE" && decision.maskFileName !== null
        ? [decision.maskFileName]
        : []
    ),
    humanDecisionsSha256: computeGrandHallT554HumanDecisionsSha256(decisions),
    closedVolumeReviewSha256: computeGrandHallT554ClosedVolumeReviewSha256(volume),
  };
}

const PANORAMA_PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const ONE_MASK_FILE_NAME = "masks/sweep-001.png";
let exactAllIncludedMaskPng: Buffer;
let exactChangedMaskPng: Buffer;

interface OneMaskPublicationFixture {
  readonly root: string;
  readonly decisionsPath: string;
  readonly maskRoot: string;
  readonly maskPath: string;
  readonly boundOutput: string;
  readonly decisions: GrandHallT554HumanDecisions;
  readonly closedVolume: GrandHallT554ClosedVolumeReview;
  readonly mediaEvidence: GrandHallT554AcceptanceMediaEvidence;
  readonly artifacts: ReturnType<typeof buildGrandHallT554AcceptedScopeArtifacts>;
}

function digestBytes(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function stripPngToPixelChunks(bytes: Buffer): Buffer {
  const retained: Buffer[] = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) throw new Error("Synthetic PNG chunk is truncated.");
    if (type === "IHDR" || type === "IDAT" || type === "IEND") {
      retained.push(bytes.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
  }
  return Buffer.concat(retained);
}

async function createExactMaskPng(excludeLastPixel: boolean): Promise<Buffer> {
  const pixels = Buffer.alloc(PANORAMA_PIXEL_COUNT, 0);
  if (excludeLastPixel) pixels[PANORAMA_PIXEL_COUNT - 1] = 255;
  const encoded = await sharp(pixels, {
    raw: {
      width: GRAND_HALL_PANORAMA_WIDTH_PX,
      height: GRAND_HALL_PANORAMA_HEIGHT_PX,
      channels: 1,
    },
  }).toColourspace("b-w").png({ compressionLevel: 9, palette: false }).toBuffer();
  return stripPngToPixelChunks(encoded);
}

function oneMaskPendingDecisions(): GrandHallT554HumanDecisions {
  const decisions = acceptedHumanDecisions();
  return GrandHallT554HumanDecisionsSchema.parse({
    ...decisions,
    reviewState: "human_pending",
    finalDecision: "PENDING",
    reviewer: null,
    panoramaDecisions: decisions.panoramaDecisions.map((decision, index) => index === 0
      ? {
        ...decision,
        result: "INCLUDE",
        classification: "grand_hall_core",
        maskFileName: ONE_MASK_FILE_NAME,
        reviewedMaskBinding: null,
        maskReviewed: false,
        maskReasonCodes: [],
      }
      : {
        ...decision,
        result: "EXCLUDE",
        classification: "adjacent_room_or_outside_grand_hall",
        maskFileName: null,
        reviewedMaskBinding: null,
        maskReviewed: false,
        maskReasonCodes: [],
      }),
  });
}

function acceptBoundDecisions(
  bound: GrandHallT554HumanDecisions,
): GrandHallT554HumanDecisions {
  return GrandHallT554HumanDecisionsSchema.parse({
    ...bound,
    reviewState: "human_accepted",
    finalDecision: "ACCEPT",
    reviewer: HUMAN_REVIEW,
    panoramaDecisions: bound.panoramaDecisions.map((decision) => decision.result === "INCLUDE"
      ? { ...decision, maskReviewed: true }
      : decision),
  });
}

function boundMediaEvidence(
  decisions: GrandHallT554HumanDecisions,
): GrandHallT554AcceptanceMediaEvidence {
  const sourceJpegs = acceptedMediaEvidence(decisions).sourceJpegs;
  const masks = new Map(decisions.panoramaDecisions.flatMap((decision) => {
    if (decision.maskFileName === null || decision.reviewedMaskBinding === null) return [];
    const binding = decision.reviewedMaskBinding;
    return [[decision.maskFileName, {
      fileName: decision.maskFileName,
      ...binding,
      exactBinarySourceGridDecoded: true as const,
    }] as const];
  }));
  return { sourceJpegs, masks };
}

async function createOneMaskPublicationFixture(): Promise<OneMaskPublicationFixture> {
  const root = await mkdtemp(join(tmpdir(), "grand-hall-t554-one-mask-"));
  temporaryRoots.push(root);
  const inputRoot = join(root, "input");
  const maskRoot = join(inputRoot, "mask-root");
  const maskPath = join(maskRoot, ...ONE_MASK_FILE_NAME.split("/"));
  const decisionsPath = join(inputRoot, "pending-decisions.json");
  const boundOutput = join(root, "bound-pending");
  await mkdir(dirname(maskPath), { recursive: true });
  await writeFile(maskPath, exactAllIncludedMaskPng);
  await writeFile(decisionsPath, `${JSON.stringify(oneMaskPendingDecisions(), null, 2)}\n`);
  await bindGrandHallT554PendingMaskEvidence({ decisionsPath, maskRoot, outputDirectory: boundOutput });
  const bound = GrandHallT554HumanDecisionsSchema.parse(
    JSON.parse(await readFile(join(boundOutput, "human-decisions.json"), "utf8")) as unknown,
  );
  const decisions = acceptBoundDecisions(bound);
  const closedVolume = acceptedClosedVolume();
  const mediaEvidence = boundMediaEvidence(decisions);
  const artifacts = buildGrandHallT554AcceptedScopeArtifacts({
    reviewPack, decisions, closedVolume, mediaEvidence,
  });
  return {
    root,
    decisionsPath,
    maskRoot,
    maskPath,
    boundOutput,
    decisions,
    closedVolume,
    mediaEvidence,
    artifacts,
  };
}

interface TestPublicationReceipt {
  readonly schemaVersion: string;
  readonly state: string;
  readonly authority: string;
  readonly productionTrust: null;
  readonly runtimeAdmissionAuthorized: boolean;
  readonly reconstructionAuthorized: boolean;
  readonly reviewPackSha256: string;
  readonly humanDecisionsSha256: string;
  readonly closedVolumeReviewSha256: string;
  readonly artifactSha256s: Readonly<Record<string, string>>;
  readonly files: readonly {
    readonly fileName: string;
    readonly sha256: string;
    readonly byteLength: number;
  }[];
}

async function assertBundleInventory(
  output: string,
  payloadNames: readonly string[],
): Promise<void> {
  const rootNames = [...new Set(payloadNames.map((name) => name.split("/")[0]))];
  rootNames.push("publication-receipt.json");
  expect((await readdir(output)).sort()).toEqual(rootNames.sort());
  expect(await readdir(join(output, "masks"))).toEqual(["sweep-001.png"]);
  expect((await readdir(join(output, "review"))).sort()).toEqual([
    "closed-selection-volume-review.json",
    "human-decisions.json",
  ]);
}

async function assertCompleteBundle(
  fixture: OneMaskPublicationFixture,
  output: string,
  result: Awaited<ReturnType<typeof publishGrandHallT554AcceptedScopeBundle>>,
): Promise<void> {
  const receiptText = await readFile(join(output, "publication-receipt.json"), "utf8");
  const receipt = JSON.parse(receiptText) as TestPublicationReceipt;
  const payloadNames = [
    ...result.outputFileNames,
    ...result.preservedReviewFileNames,
    ...result.preservedMaskFileNames,
  ].sort((left, right) => left.localeCompare(right));
  expect(receipt).toMatchObject({
    schemaVersion: "venviewer.grand-hall-t554-acceptance-publication.v1",
    state: "complete",
    authority: "human_accepted",
    productionTrust: null,
    runtimeAdmissionAuthorized: false,
    reconstructionAuthorized: false,
    reviewPackSha256: reviewPack.artifactSha256,
    humanDecisionsSha256: result.humanDecisionsSha256,
    closedVolumeReviewSha256: result.closedVolumeReviewSha256,
    artifactSha256s: {
      roomMembership: fixture.artifacts.roomMembership.artifactSha256,
      interfaceDecisions: fixture.artifacts.interfaceDecisions.artifactSha256,
      closedBoundary: fixture.artifacts.closedBoundary.artifactSha256,
      panoramaMaskSet: fixture.artifacts.panoramaMaskSet.artifactSha256,
    },
  });
  expect(receipt.files.map((file) => file.fileName)).toEqual(payloadNames);
  for (const file of receipt.files) {
    const bytes = await readFile(join(output, ...file.fileName.split("/")));
    expect({ sha256: digestBytes(bytes), byteLength: bytes.byteLength }).toEqual({
      sha256: file.sha256,
      byteLength: file.byteLength,
    });
  }
  await assertBundleInventory(output, payloadNames);
  expect(await readFile(join(output, ...ONE_MASK_FILE_NAME.split("/")))).toEqual(
    exactAllIncludedMaskPng,
  );
  expect(receiptText.slice(0, -1)).toBe(stableCanonicalJson(receipt as never));
  expect(fixture.decisions.panoramaDecisions[0]?.maskReviewed).toBe(true);
}

function assertPendingHumanTemplate(
  templates: ReturnType<typeof buildGrandHallT554AcceptanceTemplates>,
): void {
  expect(templates.humanDecisions).toMatchObject({
    authority: "none",
    reviewState: "human_pending",
    finalDecision: "PENDING",
    reviewer: null,
    generatedFillPermitted: false,
    geometricCameraAuthority: "none",
  });
  expect(templates.humanDecisions.panoramaDecisions).toHaveLength(
    GRAND_HALL_REVIEW_PANORAMA_COUNT,
  );
  expect(templates.humanDecisions.nonCandidatePanoramaDecisions).toHaveLength(98);
  const allReviewedSources = new Set([
    ...templates.humanDecisions.panoramaDecisions.map((decision) => decision.sourceJpgFileName),
    ...templates.humanDecisions.nonCandidatePanoramaDecisions.map(
      (decision) => decision.sourceJpgFileName,
    ),
  ]);
  expect(allReviewedSources).toEqual(new Set(
    reviewPack.panoramaDirectoryFiles.map((source) => source.fileName),
  ));
  expect(templates.humanDecisions.panoramaDecisions.every(
    (decision) => decision.result === "UNSURE" && decision.maskFileName === null,
  )).toBe(true);
  expect(templates.humanDecisions.interfaceDecisions).toHaveLength(8);
  expect(templates.humanDecisions.interfaceDecisions.every(
    (decision) => decision.result === "UNSURE",
  )).toBe(true);
  expect(templates.humanDecisions.matterPakRoomDecision).toMatchObject({
    sourceRoomKey: "matterpak:g001:s009",
    result: "UNSURE",
    note: null,
  });
}

function assertPendingVolumeTemplate(
  templates: ReturnType<typeof buildGrandHallT554AcceptanceTemplates>,
): void {
  expect(templates.humanDecisions.cleanupArtifactInspections).toEqual([
    expect.objectContaining({ artifactClass: "Window", result: "UNSURE", note: null }),
    expect.objectContaining({ artifactClass: "Mirror", result: "UNSURE", note: null }),
  ]);
  expect(templates.closedVolume).toMatchObject({
    authority: "none",
    reviewState: "human_pending",
    finalDecision: "PENDING",
    reviewer: null,
    geometryRole: "non_rendered_selection_volume",
    footprintXY: [],
    zMin: null,
    zMax: null,
    rendered: false,
    collisionGeometry: false,
    exportedAsArchitecture: false,
    generatedGeometryCreated: false,
  });
}

beforeAll(async () => {
  reviewPack = GrandHallScopeReviewPackV1Schema.parse(
    JSON.parse(await readFile(REVIEW_PACK_PATH, "utf8")) as unknown,
  );
  exactAllIncludedMaskPng = await createExactMaskPng(false);
  exactChangedMaskPng = await createExactMaskPng(true);
});

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

it("builds exact pending templates without deciding room membership or geometry", () => {
  const templates = buildGrandHallT554AcceptanceTemplates(reviewPack);
  assertPendingHumanTemplate(templates);
  assertPendingVolumeTemplate(templates);
  expect(
    templates.humanDecisions.panoramaDecisions.length +
    templates.humanDecisions.nonCandidatePanoramaDecisions.length,
  ).toBe(GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT);
});

  it("keeps the checked-in human-pending templates exact and authority-free", async () => {
    const expected = buildGrandHallT554AcceptanceTemplates(reviewPack);
    const decisions = GrandHallT554HumanDecisionsSchema.parse(
      JSON.parse(await readFile(PERSISTED_DECISIONS_TEMPLATE_PATH, "utf8")) as unknown,
    );
    const volume = GrandHallT554ClosedVolumeReviewSchema.parse(
      JSON.parse(await readFile(PERSISTED_VOLUME_TEMPLATE_PATH, "utf8")) as unknown,
    );

    expect(decisions).toEqual(expected.humanDecisions);
    expect(volume).toEqual(expected.closedVolume);
    expect(decisions.authority).toBe("none");
    expect(volume.authority).toBe("none");
  });

  it("verifies the persisted review pack before writing editable pending templates", async () => {
    const root = await mkdtemp(join(tmpdir(), "grand-hall-t554-template-"));
    temporaryRoots.push(root);
    const output = join(root, "pending");

    const result = await writeGrandHallT554AcceptanceTemplates({
      reviewPackDirectory: dirname(REVIEW_PACK_PATH),
      outputDirectory: output,
    });

    expect(result).toEqual({
      outputDirectory: output,
      reviewPackSha256: reviewPack.artifactSha256,
      outputFileNames: ["closed-selection-volume.json", "human-decisions.json"],
    });
    const decisions = GrandHallT554HumanDecisionsSchema.parse(
      JSON.parse(await readFile(join(output, "human-decisions.json"), "utf8")) as unknown,
    );
    const volume = GrandHallT554ClosedVolumeReviewSchema.parse(
      JSON.parse(await readFile(join(output, "closed-selection-volume.json"), "utf8")) as unknown,
    );
    expect(decisions.reviewState).toBe("human_pending");
    expect(volume.footprintXY).toEqual([]);
  });

  it("builds the four cross-bound accepted artifacts only from complete reviewed evidence", () => {
    const decisions = acceptedHumanDecisions();
    const volume = acceptedClosedVolume();
    const artifacts = buildGrandHallT554AcceptedScopeArtifacts({
      reviewPack,
      decisions,
      closedVolume: volume,
      mediaEvidence: acceptedMediaEvidence(decisions),
    });

    expect(GrandHallRoomMembershipV2Schema.safeParse(artifacts.roomMembership).success).toBe(true);
    expect(GrandHallPortalDecisionsV1Schema.safeParse(artifacts.interfaceDecisions).success).toBe(true);
    expect(GrandHallClosedBoundaryV1Schema.safeParse(artifacts.closedBoundary).success).toBe(true);
    expect(GrandHallPanoramaMaskSetV1Schema.safeParse(artifacts.panoramaMaskSet).success).toBe(true);
    expect(artifacts.roomMembership).toMatchObject({
      authority: "human_accepted",
      productionTrust: null,
      geometricCameraAuthority: "none",
      matterPakRoomMembership: {
        includedRoomKeys: ["matterpak:g001:s009"],
        neighbouringRoomGeometryIncluded: false,
        facadeGeometryIncluded: false,
      },
    });
    expect(artifacts.panoramaMaskSet).toMatchObject({
      geometricCameraAuthority: "none",
      generatedFillPermitted: false,
      maskCount: 48,
      wholeFrameExclusionCount: 2,
      productionTrust: null,
    });
    expect(artifacts.closedBoundary.semanticRefinements.every(
      (refinement) => refinement.operation === "exclude_beyond_interface",
    )).toBe(true);
    expect(artifacts.closedBoundary.roomMembershipArtifactSha256).toBe(
      artifacts.roomMembership.artifactSha256,
    );
    expect(artifacts.closedBoundary.portalDecisionArtifactSha256).toBe(
      artifacts.interfaceDecisions.artifactSha256,
    );
    expect(artifacts.panoramaMaskSet.membershipArtifactSha256).toBe(
      artifacts.roomMembership.artifactSha256,
    );
  });

  it("rejects UNSURE decisions, source-identity drift, and authority escalation", () => {
    const decisions = acceptedHumanDecisions();
    const volume = acceptedClosedVolume();
    const mediaEvidence = acceptedMediaEvidence(decisions);

    expect(() => buildGrandHallT554AcceptedScopeArtifacts({
      reviewPack,
      decisions: {
        ...decisions,
        panoramaDecisions: decisions.panoramaDecisions.map((decision, index) => index === 0
          ? { ...decision, result: "UNSURE" as const }
          : decision),
      },
      closedVolume: volume,
      mediaEvidence,
    })).toThrowError(GrandHallT554AcceptanceError);

    expect(() => buildGrandHallT554AcceptedScopeArtifacts({
      reviewPack,
      decisions: {
        ...decisions,
        panoramaDecisions: decisions.panoramaDecisions.map((decision, index) => index === 0
          ? { ...decision, sourceJpgSha256: digest("forged-source") }
          : decision),
      },
      closedVolume: volume,
      mediaEvidence,
    })).toThrowError(GrandHallT554AcceptanceError);

    expect(() => buildGrandHallT554AcceptedScopeArtifacts({
      reviewPack,
      decisions: { ...decisions, geometricCameraAuthority: "human_accepted" },
      closedVolume: volume,
      mediaEvidence,
    })).toThrowError(GrandHallT554AcceptanceError);
  });

  it("requires explicit room-9 and Window/Mirror acceptance", () => {
    const decisions = acceptedHumanDecisions();
    const volume = acceptedClosedVolume();
    const mediaEvidence = acceptedMediaEvidence(decisions);

    expect(() => buildGrandHallT554AcceptedScopeArtifacts({
      reviewPack,
      decisions: {
        ...decisions,
        matterPakRoomDecision: {
          ...decisions.matterPakRoomDecision,
          result: "UNSURE",
          note: null,
        },
      },
      closedVolume: volume,
      mediaEvidence,
    })).toThrowError(/MatterPak room 9/u);

    for (const artifactClass of ["Window", "Mirror"] as const) {
      expect(() => buildGrandHallT554AcceptedScopeArtifacts({
        reviewPack,
        decisions: {
          ...decisions,
          cleanupArtifactInspections: decisions.cleanupArtifactInspections.map(
            (inspection) => inspection.artifactClass === artifactClass
              ? { ...inspection, result: "UNSURE" as const, note: null }
              : inspection,
          ),
        },
        closedVolume: volume,
        mediaEvidence,
      })).toThrowError(/Window\/Mirror/u);
    }
  });

  it("rejects duplicate masks and mask reasons that contradict decoded pixels", () => {
    const decisions = acceptedHumanDecisions();
    const volume = acceptedClosedVolume();
    const firstMask = decisions.panoramaDecisions[0]?.maskFileName;
    if (firstMask === null || firstMask === undefined) throw new Error("Expected first mask.");
    const duplicate = GrandHallT554HumanDecisionsSchema.parse({
      ...decisions,
      panoramaDecisions: decisions.panoramaDecisions.map((decision, index) => index === 1
        ? { ...decision, maskFileName: firstMask }
        : decision),
    });
    expect(() => buildGrandHallT554AcceptedScopeArtifacts({
      reviewPack,
      decisions: duplicate,
      closedVolume: volume,
      mediaEvidence: acceptedMediaEvidence(duplicate),
    })).toThrowError(GrandHallT554AcceptanceError);

    const contradictory = GrandHallT554HumanDecisionsSchema.parse({
      ...decisions,
      panoramaDecisions: decisions.panoramaDecisions.map((decision, index) => index === 1
        ? { ...decision, maskReasonCodes: ["adjacent_room_pixels"] }
        : decision),
    });
    expect(() => buildGrandHallT554AcceptedScopeArtifacts({
      reviewPack,
      decisions: contradictory,
      closedVolume: volume,
      mediaEvidence: acceptedMediaEvidence(contradictory),
    })).toThrowError(GrandHallT554AcceptanceError);
  });

  it("rejects a post-review swap of exact mask bytes", () => {
    const decisions = acceptedHumanDecisions();
    const mediaEvidence = acceptedMediaEvidence(decisions);
    const firstIncluded = decisions.panoramaDecisions.find(
      (decision) => decision.result === "INCLUDE" && decision.maskFileName !== null,
    );
    if (firstIncluded?.maskFileName === null || firstIncluded?.maskFileName === undefined) {
      throw new Error("Expected at least one reviewed mask.");
    }
    const originalEvidence = mediaEvidence.masks.get(firstIncluded.maskFileName);
    if (originalEvidence === undefined) throw new Error("Expected exact mask evidence.");
    const masks = new Map(mediaEvidence.masks);
    masks.set(firstIncluded.maskFileName, {
      ...originalEvidence,
      sha256: digest("mask-bytes-swapped-after-human-review"),
    });

    expect(() => buildGrandHallT554AcceptedScopeArtifacts({
      reviewPack,
      decisions,
      closedVolume: acceptedClosedVolume(),
      mediaEvidence: {
        sourceJpegs: mediaEvidence.sourceJpegs,
        masks,
      },
    })).toThrowError(/differs from the exact bytes and counts reviewed by the human/u);
  });

  it("rejects a convex or architecture-authoritative selection volume", () => {
    const decisions = acceptedHumanDecisions();
    const mediaEvidence = acceptedMediaEvidence(decisions);
    const volume = acceptedClosedVolume();

    expect(() => buildGrandHallT554AcceptedScopeArtifacts({
      reviewPack,
      decisions,
      closedVolume: {
        ...volume,
        footprintXY: [[0, 0], [8, 0], [8, 5], [0, 5]],
      },
      mediaEvidence,
    })).toThrowError(GrandHallT554AcceptanceError);
    expect(() => buildGrandHallT554AcceptedScopeArtifacts({
      reviewPack,
      decisions,
      closedVolume: { ...volume, rendered: true },
      mediaEvidence,
    })).toThrowError(GrandHallT554AcceptanceError);
  });

  it("binds one real mask and publishes a receipt-last full evidence bundle", async () => {
    const fixture = await createOneMaskPublicationFixture();
    const first = fixture.decisions.panoramaDecisions[0];
    expect(first).toMatchObject({
      result: "INCLUDE",
      maskFileName: ONE_MASK_FILE_NAME,
      maskReviewed: true,
      reviewedMaskBinding: {
        sha256: digestBytes(exactAllIncludedMaskPng),
        byteLength: exactAllIncludedMaskPng.byteLength,
        includedPixelCount: PANORAMA_PIXEL_COUNT,
        excludedPixelCount: 0,
      },
    });
    await expect(stat(join(fixture.boundOutput, "publication-receipt.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(bindGrandHallT554PendingMaskEvidence({
      decisionsPath: fixture.decisionsPath,
      maskRoot: fixture.maskRoot,
      outputDirectory: fixture.boundOutput,
    })).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });

    const output = join(fixture.root, "accepted");
    const options = {
      reviewPack,
      decisions: fixture.decisions,
      closedVolume: fixture.closedVolume,
      maskRoot: fixture.maskRoot,
    };
    const result = await publishGrandHallT554AcceptedScopeBundle(
      output,
      fixture.artifacts,
      options,
    );
    await assertCompleteBundle(fixture, output, result);
    await expect(publishGrandHallT554AcceptedScopeBundle(output, fixture.artifacts, options))
      .rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
  }, 60_000);

  it("rejects changed mask bytes before reserving a publication directory", async () => {
    const fixture = await createOneMaskPublicationFixture();
    await writeFile(fixture.maskPath, exactChangedMaskPng);
    const output = join(fixture.root, "changed-mask-output");
    let failure: unknown;
    try {
      await publishGrandHallT554AcceptedScopeBundle(output, fixture.artifacts, {
        reviewPack,
        decisions: fixture.decisions,
        closedVolume: fixture.closedVolume,
        maskRoot: fixture.maskRoot,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(GrandHallT554AcceptanceError);
    if (!(failure instanceof GrandHallT554AcceptanceError)) throw failure;
    expect(["FILE_INVALID", "SOURCE_IDENTITY_DRIFT"]).toContain(failure.code);
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
  }, 60_000);

  it("rejects mixed accepted artifacts and an existing redirected output", async () => {
    const fixture = await createOneMaskPublicationFixture();
    const alternativeDecisions = GrandHallT554HumanDecisionsSchema.parse({
      ...fixture.decisions,
      interfaceDecisions: fixture.decisions.interfaceDecisions.map((decision, index) => index === 0
        ? {
          ...decision,
          result: "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE",
          note: "Reviewed this exact interface and close it at the Grand Hall-side plane.",
        }
        : decision),
    });
    const alternative = buildGrandHallT554AcceptedScopeArtifacts({
      reviewPack,
      decisions: alternativeDecisions,
      closedVolume: fixture.closedVolume,
      mediaEvidence: fixture.mediaEvidence,
    });
    const options = {
      reviewPack,
      decisions: fixture.decisions,
      closedVolume: fixture.closedVolume,
      maskRoot: fixture.maskRoot,
    };
    const mixedOutput = join(fixture.root, "mixed-output");
    await expect(publishGrandHallT554AcceptedScopeBundle(mixedOutput, {
      ...fixture.artifacts,
      interfaceDecisions: alternative.interfaceDecisions,
    }, options)).rejects.toMatchObject({ code: "SOURCE_IDENTITY_DRIFT" });
    await expect(stat(mixedOutput)).rejects.toMatchObject({ code: "ENOENT" });

    const outside = join(fixture.root, "outside");
    const redirectedOutput = join(fixture.root, "redirected-output");
    await mkdir(outside);
    await writeFile(join(outside, "sentinel.txt"), "untouched\n");
    await symlink(outside, redirectedOutput, process.platform === "win32" ? "junction" : "dir");
    await expect(publishGrandHallT554AcceptedScopeBundle(
      redirectedOutput,
      fixture.artifacts,
      options,
    )).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
    expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("untouched\n");
    await expect(stat(join(outside, "publication-receipt.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  }, 60_000);

  it("parses a formal human REJECT as authority-none and never publishes it", async () => {
    const decisions = rejectedHumanDecisions();
    const volume = rejectedClosedVolume();
    const mediaEvidence = acceptedMediaEvidence(decisions);
    const publish = vi.fn(() => Promise.reject(new Error("must not publish")));

    expect(decisions).toMatchObject({
      authority: "none",
      reviewState: "human_rejected",
      finalDecision: "REJECT",
    });
    expect(volume).toMatchObject({
      authority: "none",
      reviewState: "human_rejected",
      finalDecision: "REJECT",
    });
    await expect(acceptGrandHallT554Scope({
      reviewPackDirectory: "review-pack",
      panoramaSourceRoot: "panoramas",
      decisionsPath: "decisions.json",
      closedVolumePath: "volume.json",
      maskRoot: "masks",
      outputDirectory: "accepted-output",
    }, {
      loadVerifiedReviewPack: () => Promise.resolve(reviewPack),
      readHumanDecisions: () => Promise.resolve(decisions),
      readClosedVolumeReview: () => Promise.resolve(volume),
      inspectPanoramaSources: () => Promise.resolve(mediaEvidence.sourceJpegs),
      inspectPanoramaMasks: () => Promise.resolve(mediaEvidence.masks),
      publish,
    })).rejects.toMatchObject({ code: "DECISIONS_INVALID" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("orchestrates exact source and mask verification before publishing", async () => {
    const decisions = acceptedHumanDecisions();
    const volume = acceptedClosedVolume();
    const mediaEvidence = acceptedMediaEvidence(decisions);
    const inspectSources = vi.fn(() => Promise.resolve(mediaEvidence.sourceJpegs));
    const inspectMasks = vi.fn(() => Promise.resolve(mediaEvidence.masks));
    const publish = vi.fn(() => Promise.resolve(
      completeInjectedPublicationResult(decisions, volume),
    ));

    const result = await acceptGrandHallT554Scope({
      reviewPackDirectory: "review-pack",
      panoramaSourceRoot: "panoramas",
      decisionsPath: "decisions.json",
      closedVolumePath: "volume.json",
      maskRoot: "masks",
      outputDirectory: "accepted-output",
    }, {
      loadVerifiedReviewPack: () => Promise.resolve(reviewPack),
      readHumanDecisions: () => Promise.resolve(decisions),
      readClosedVolumeReview: () => Promise.resolve(volume),
      inspectPanoramaSources: inspectSources,
      inspectPanoramaMasks: inspectMasks,
      publish,
    });

    expect(inspectSources).toHaveBeenCalledTimes(1);
    expect(inspectMasks).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      authority: "human_accepted",
      productionTrust: null,
      runtimeAdmissionAuthorized: false,
      reconstructionAuthorized: false,
      publicationReceiptFileName: "publication-receipt.json",
      panoramaSourceCount: GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT,
      candidatePanoramaSourceCount: GRAND_HALL_REVIEW_PANORAMA_COUNT,
      panoramaMaskCount: 48,
      interfaceDecisionCount: 8,
      humanDecisionsSha256: computeGrandHallT554HumanDecisionsSha256(decisions),
    });
  });

  it("fails closed when an injected publisher returns no complete receipt bundle", async () => {
    const decisions = acceptedHumanDecisions();
    const volume = acceptedClosedVolume();
    const mediaEvidence = acceptedMediaEvidence(decisions);
    const receiptLess = completeInjectedPublicationResult(decisions, volume);
    expect(Reflect.deleteProperty(receiptLess, "publicationReceiptFileName")).toBe(true);
    const publish = vi.fn(() => Promise.resolve(receiptLess));

    await expect(acceptGrandHallT554Scope({
      reviewPackDirectory: "review-pack",
      panoramaSourceRoot: "panoramas",
      decisionsPath: "decisions.json",
      closedVolumePath: "volume.json",
      maskRoot: "masks",
      outputDirectory: "accepted-output",
    }, {
      loadVerifiedReviewPack: () => Promise.resolve(reviewPack),
      readHumanDecisions: () => Promise.resolve(decisions),
      readClosedVolumeReview: () => Promise.resolve(volume),
      inspectPanoramaSources: () => Promise.resolve(mediaEvidence.sourceJpegs),
      inspectPanoramaMasks: () => Promise.resolve(mediaEvidence.masks),
      publish,
    })).rejects.toMatchObject({ code: "OUTPUT_PUBLISH_FAILED" });
    expect(publish).toHaveBeenCalledTimes(1);
  });
