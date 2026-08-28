import {
  CanonicalJsonValueSchema,
  GrandHallCoordinatePairIntakeV1MaterialSchema,
  GrandHallCoordinatePairIntakeV1Schema,
  GrandHallRegistrationSeedV1Schema,
  computeGrandHallCoordinatePairIntakeV1Sha256,
  computeGrandHallCoordinatePairNominationInventorySha256,
  computeGrandHallRegistrationSeedV1Sha256,
  computeGrandHallRoom9InterfaceFaceOrdinalInventorySha256,
  computeGrandHallRoom9SharedVertexInventorySha256,
  sha256Hex,
  stableCanonicalJson,
  type GrandHallCoordinatePairIntakeV1,
  type GrandHallRegistrationSeedV1,
} from "@omnitwin/types";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  GRAND_HALL_COORDINATE_FREE_NOMINATION_CHECKPOINT_ARTIFACT_SHA256,
  GRAND_HALL_COORDINATE_FREE_NOMINATION_CHECKPOINT_PACKET_ID,
  GRAND_HALL_COORDINATE_FREE_NOMINATION_EXACT_SEED_ARTIFACT_SHA256,
  GrandHallCoordinateFreeNominationCheckpointError,
  buildGrandHallCoordinateFreeNominationCheckpoint,
  verifyGrandHallCoordinateFreeNominationCheckpoint,
} from "../grand-hall-coordinate-free-nomination-checkpoint.js";

const EXACT_SEED_CANONICAL_JSON_SHA256 =
  "ddd20078d3a61415d506b002f89fde146d28742d79a2f66ec0192923ef7f5a72";

const seedUrl = new URL(
  "../../../../docs/operations/grand-hall-authority-none-registration-seed-v1.json",
  import.meta.url,
);
const persistedCheckpointUrl = new URL(
  "../../../../docs/operations/grand-hall-authority-none-coordinate-free-nomination-checkpoint-v1.json",
  import.meta.url,
);
const boundaryEvidenceUrl = new URL(
  "../../../../docs/operations/grand-hall-room9-source-boundary-evidence-v1.json",
  import.meta.url,
);
const interfaceManifestUrl = new URL(
  "../../../../docs/operations/grand-hall-t554-review-pack/boundary/interfaces/manifest.json",
  import.meta.url,
);

const E57EvidenceSchema = z.object({
  sourceBindings: z.object({
    e57: z.object({
      byteLength: z.number().int().positive(),
      sha256: z.string(),
    }),
  }),
  e57PoseInventory: z.object({
    scanCount: z.number().int().positive(),
    poseSha256: z.string(),
    data3DGuidSha256: z.string(),
    coordinateConvention: z.string(),
  }),
  e57SameRunVerification: z.object({
    rootGuid: z.string(),
  }),
});

const InterfaceManifestEvidenceSchema = z.object({
  manifestSha256: z.string(),
  interfaces: z.array(
    z.object({
      sharedVertices: z.object({
        vertices: z.array(z.object({ index: z.number().int().nonnegative() })),
      }),
      localSourceTopology: z.object({
        room9: z.object({
          sourceFaceOrdinals: z.array(z.number().int().nonnegative()),
        }),
      }),
    }),
  ),
});

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, "utf8")) as unknown;
}

function exactSeed(): GrandHallRegistrationSeedV1 {
  return GrandHallRegistrationSeedV1Schema.parse(readJson(seedUrl));
}

function build(): GrandHallCoordinatePairIntakeV1 {
  return buildGrandHallCoordinateFreeNominationCheckpoint({
    registrationSeed: exactSeed(),
  });
}

function resealCheckpoint(
  checkpoint: GrandHallCoordinatePairIntakeV1,
  mutate: (
    material: Omit<GrandHallCoordinatePairIntakeV1, "artifactSha256">,
  ) => void,
): GrandHallCoordinatePairIntakeV1 {
  const { artifactSha256, ...material } = structuredClone(checkpoint);
  expect(artifactSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  mutate(material);
  const parsed = GrandHallCoordinatePairIntakeV1MaterialSchema.parse(material);
  return {
    ...parsed,
    artifactSha256: computeGrandHallCoordinatePairIntakeV1Sha256(parsed),
  };
}

function expectCode(
  action: () => unknown,
  code: GrandHallCoordinateFreeNominationCheckpointError["code"],
): void {
  try {
    action();
    throw new Error("expected coordinate-free checkpoint failure");
  } catch (error) {
    expect(error).toBeInstanceOf(
      GrandHallCoordinateFreeNominationCheckpointError,
    );
    expect(
      (error as GrandHallCoordinateFreeNominationCheckpointError).code,
    ).toBe(code);
  }
}

describe("Grand Hall coordinate-free nomination checkpoint", () => {
  it("exactly regenerates an empty revision-1 root from the persisted canonical seed", () => {
    const seedText = readFileSync(seedUrl, "utf8");
    expect(seedText.endsWith("\n")).toBe(true);
    const seedCanonicalJson = seedText.slice(0, -1);
    const canonicalSeed = CanonicalJsonValueSchema.parse(
      JSON.parse(seedCanonicalJson) as unknown,
    );
    expect(stableCanonicalJson(canonicalSeed)).toBe(seedCanonicalJson);
    expect(sha256Hex(seedCanonicalJson)).toBe(
      EXACT_SEED_CANONICAL_JSON_SHA256,
    );

    const seed = exactSeed();
    const checkpoint = build();
    expect(seed.artifactSha256).toBe(
      GRAND_HALL_COORDINATE_FREE_NOMINATION_EXACT_SEED_ARTIFACT_SHA256,
    );
    expect(checkpoint).toMatchObject({
      schemaVersion:
        "venviewer.grand-hall-arf-cvf-coordinate-pair-intake.v1",
      packetId: GRAND_HALL_COORDINATE_FREE_NOMINATION_CHECKPOINT_PACKET_ID,
      revision: 1,
      predecessorArtifactSha256: null,
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      authority: "none",
      productionTrust: null,
      state: "nomination_only",
      nominations: [],
      coordinatePairs: [],
      split: null,
      humanReview: null,
      rejection: null,
    });
    expect(checkpoint.nominationSeed.seedArtifactSha256).toBe(
      seed.artifactSha256,
    );
    expect(checkpoint.artifactSha256).toBe(
      GRAND_HALL_COORDINATE_FREE_NOMINATION_CHECKPOINT_ARTIFACT_SHA256,
    );
    expect(checkpoint.nominationSeed.matrixUsedAsMeasurement).toBe(false);
    expect(checkpoint.nominationSeed.matrixUsedAsSolverInput).toBe(false);
    expect(stableCanonicalJson(checkpoint)).not.toContain(
      "candidateArfToCvfRowMajorMatrixFloat64Hex",
    );
  });

  it("exactly regenerates the persisted canonical checkpoint artifact", () => {
    const persistedText = readFileSync(persistedCheckpointUrl, "utf8");
    expect(persistedText.endsWith("\n")).toBe(true);
    expect(persistedText.endsWith("\n\n")).toBe(false);
    expect(persistedText.includes("\r")).toBe(false);
    const canonicalJson = persistedText.slice(0, -1);
    expect(canonicalJson).toHaveLength(5_092);
    expect(sha256Hex(canonicalJson)).toBe(
      "d0423052da9437ef7ed1a21cde064389c31a382b4a26c5bfe998febca5e8283f",
    );
    const persisted = GrandHallCoordinatePairIntakeV1Schema.parse(
      JSON.parse(canonicalJson) as unknown,
    );
    expect(stableCanonicalJson(persisted)).toBe(canonicalJson);
    expect(persisted).toEqual(build());
  });

  it("binds E57 and room-9 inventory fields to existing exact repository evidence", () => {
    const seed = exactSeed();
    const checkpoint = build();
    const e57Evidence = E57EvidenceSchema.parse(readJson(boundaryEvidenceUrl));
    const interfaceEvidence = InterfaceManifestEvidenceSchema.parse(
      readJson(interfaceManifestUrl),
    );
    expect(interfaceEvidence.manifestSha256).toBe(
      seed.target.upstreamLineage.interfaceAtlasSha256,
    );

    const e57 = checkpoint.targetBindings.e57;
    expect(e57).toEqual({
      ...e57Evidence.sourceBindings.e57,
      rootGuid: e57Evidence.e57SameRunVerification.rootGuid,
      scanCount: e57Evidence.e57PoseInventory.scanCount,
      data3DGuidSha256: e57Evidence.e57PoseInventory.data3DGuidSha256,
      poseSha256: e57Evidence.e57PoseInventory.poseSha256,
      coordinateConvention: e57Evidence.e57PoseInventory.coordinateConvention,
    });

    const sharedVertices = [
      ...new Set(
        interfaceEvidence.interfaces.flatMap((entry) =>
          entry.sharedVertices.vertices.map((vertex) => vertex.index),
        ),
      ),
    ].sort((left, right) => left - right);
    const interfaceFaces = [
      ...new Set(
        interfaceEvidence.interfaces.flatMap(
          (entry) => entry.localSourceTopology.room9.sourceFaceOrdinals,
        ),
      ),
    ].sort((left, right) => left - right);
    expect(checkpoint.targetBindings.room9).toMatchObject({
      evidenceFaceOrdinalsSha256:
        seed.target.exactRoom9.faceOrdinalInventorySha256,
      sharedVertexCount: sharedVertices.length,
      sharedVertexInventorySha256:
        computeGrandHallRoom9SharedVertexInventorySha256(sharedVertices),
      interfaceFaceCount: interfaceFaces.length,
      interfaceFaceOrdinalInventorySha256:
        computeGrandHallRoom9InterfaceFaceOrdinalInventorySha256(
          interfaceFaces,
        ),
    });
  });

  it("verifies only the exact empty projection and returns no authority", () => {
    const seed = exactSeed();
    const checkpoint = build();
    expect(
      verifyGrandHallCoordinateFreeNominationCheckpoint({
        registrationSeed: seed,
        checkpoint,
      }),
    ).toEqual({
      authority: "none",
      registrationSeedArtifactSha256: seed.artifactSha256,
      checkpointArtifactSha256: checkpoint.artifactSha256,
      state: "nomination_only",
      nominationCount: 0,
      coordinatePairCount: 0,
      coordinatesGenerated: false,
      matrixUsedAsMeasurement: false,
      matrixUsedAsSolverInput: false,
      transformArtifactCreated: false,
      operationalGeometryCreated: false,
      runtimeAuthorityGranted: false,
      publicExposureChanged: false,
    });
  });

  it("rejects a schema-valid resealed registration seed", () => {
    const seed = exactSeed();
    const { artifactSha256, ...material } = structuredClone(seed);
    expect(artifactSha256).toBe(
      GRAND_HALL_COORDINATE_FREE_NOMINATION_EXACT_SEED_ARTIFACT_SHA256,
    );
    const changedMaterial = { ...material, artifactId: "resealed-seed" };
    const resealedSeed = {
      ...changedMaterial,
      artifactSha256:
        computeGrandHallRegistrationSeedV1Sha256(changedMaterial),
    };
    expect(GrandHallRegistrationSeedV1Schema.safeParse(resealedSeed).success).toBe(
      true,
    );
    expectCode(
      () =>
        buildGrandHallCoordinateFreeNominationCheckpoint({
          registrationSeed: resealedSeed,
        }),
      "INVALID_REGISTRATION_SEED",
    );
  });

  it("rejects a valid resealed packet with caller-selected packet identity drift", () => {
    const changedId = resealCheckpoint(build(), (material) => {
      material.packetId = "caller-selected-packet-id";
    });
    expectCode(
      () =>
        verifyGrandHallCoordinateFreeNominationCheckpoint({
          registrationSeed: exactSeed(),
          checkpoint: changedId,
        }),
      "REGISTRATION_SEED_BINDING_MISMATCH",
    );
  });

  it("rejects a valid resealed packet with one visible-only nomination", () => {
    const checkpoint = build();
    const nonEmpty = resealCheckpoint(checkpoint, (material) => {
      material.nominations = [
        {
          nominationId: "candidate-001",
          status: "candidate_visible_only",
          label: "Human review still required",
          featureClass: "architectural_detail",
          seedRank: 1,
          evidenceRefs: [
            {
              role: "source_view",
              sha256: `sha256:${"1".repeat(64)}`,
              byteLength: 100,
              mimeType: "image/png",
            },
            {
              role: "target_view",
              sha256: `sha256:${"2".repeat(64)}`,
              byteLength: 101,
              mimeType: "image/png",
            },
          ],
        },
      ];
      material.nominationInventorySha256 =
        computeGrandHallCoordinatePairNominationInventorySha256(
          material.nominations,
        );
    });
    expectCode(
      () =>
        verifyGrandHallCoordinateFreeNominationCheckpoint({
          registrationSeed: exactSeed(),
          checkpoint: nonEmpty,
        }),
      "REGISTRATION_SEED_BINDING_MISMATCH",
    );
  });

  it("rejects valid resealed E57 drift and any attempted runtime claim", () => {
    const checkpoint = build();
    const driftedE57 = resealCheckpoint(checkpoint, (material) => {
      material.targetBindings.e57.poseSha256 =
        `sha256:${"f".repeat(64)}`;
    });
    expectCode(
      () =>
        verifyGrandHallCoordinateFreeNominationCheckpoint({
          registrationSeed: exactSeed(),
          checkpoint: driftedE57,
        }),
      "REGISTRATION_SEED_BINDING_MISMATCH",
    );

    const authorityClaim = {
      ...checkpoint,
      guardrails: {
        ...checkpoint.guardrails,
        runtimeAuthorityGranted: true,
      },
    };
    expectCode(
      () =>
        verifyGrandHallCoordinateFreeNominationCheckpoint({
          registrationSeed: exactSeed(),
          checkpoint: authorityClaim,
        }),
      "INVALID_CHECKPOINT",
    );
  });
});
