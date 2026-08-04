import { createHash } from "node:crypto";

import {
  FOUNDRY_INGEST_MANIFEST_V0,
  FoundryIngestManifestV0Schema,
  type FoundryIngestManifestV0,
} from "@omnitwin/types";

/**
 * Deterministic builder for the bounded Grand Hall pilot ingest manifest
 * (phase-1 goal). Consumes a read-only hash inventory and emits a
 * schema-validated FoundryIngestManifestV0. It never touches the
 * filesystem: hashing happens upstream, against sources mounted read-only.
 */

export interface PilotHashRecord {
  readonly sha256Hex: string;
  readonly sizeBytes: number;
  readonly relativePath: string;
}

const INVENTORY_LINE = /^([0-9a-f]{64}) (\d+) (.+)$/u;

export function parsePilotHashInventory(text: string): PilotHashRecord[] {
  const records: PilotHashRecord[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/u)) {
    const match = INVENTORY_LINE.exec(line.trim());
    if (match === null) continue;
    const [, sha256Hex, size, relativePath] = match;
    if (sha256Hex === undefined || size === undefined || relativePath === undefined) continue;
    if (seen.has(relativePath)) {
      throw new Error(`duplicate inventory path: ${relativePath}`);
    }
    seen.add(relativePath);
    records.push({ sha256Hex, sizeBytes: Number(size), relativePath });
  }
  return records.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
  );
}

type PilotInputClass =
  | "e57"
  | "colmap_database"
  | "colmap_sparse"
  | "colmap_image"
  | "benchmark_trajectory";

function classifyPilotInput(relativePath: string): PilotInputClass {
  if (relativePath === "cloud_0.e57") return "e57";
  if (/^colmap_v2\/database\.db(?:-shm|-wal)?$/u.test(relativePath)) return "colmap_database";
  if (/^colmap_v2\/sparse\/0\/[a-z0-9A-Z._-]+$/u.test(relativePath)) return "colmap_sparse";
  if (/^colmap_v2\/images\/scan_\d{3}_[a-z]+\.jpg$/u.test(relativePath)) return "colmap_image";
  if (/^Grand_Hall_Bright_Walls_[0-9-]+\/project_data\/poses\.csv$/u.test(relativePath)) {
    return "benchmark_trajectory";
  }
  throw new Error(`not a declared pilot input: ${relativePath}`);
}

// The COLMAP set's original derivation environment was never recorded; this
// digest of a fixed marker string states that honestly instead of inventing
// an environment identity.
const UNRECORDED_ENVIRONMENT_DIGEST = `sha256:${createHash("sha256")
  .update("omnitwin.foundry.derivation-environment:unrecorded-historical")
  .digest("hex")}`;

const MATTERPORT_TERMS = {
  termsReviewedAt: "2026-07-12T00:00:00.000Z",
  termsReference: "https://matterport.com/terms-of-use",
} as const;

function matterportDerivedRights() {
  return {
    basis: "customer_owned" as const,
    commercialUse: "allowed" as const,
    modelTrainingUse: "requires_review" as const,
    redistribution: "restricted" as const,
    ...MATTERPORT_TERMS,
    restrictions: [
      "Derived from Matterport Data: the 2026-03-01 Terms of Use prohibit commercial AI/ML training pending contract-specific counsel review.",
    ],
  };
}

function assetIdFor(relativePath: string, inputClass: PilotInputClass): string {
  if (inputClass === "e57") return "e57-main";
  if (inputClass === "benchmark_trajectory") return "bright-walls-poses";
  const leaf = relativePath.split("/").at(-1) ?? relativePath;
  const slug = leaf.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (inputClass === "colmap_sparse") return `colmap-sparse-${slug}`;
  if (inputClass === "colmap_database") return `colmap-${slug}`;
  return `colmap-image-${slug.replace(/-jpg$/u, "")}`;
}

const CLASS_OPERATION: Record<Exclude<PilotInputClass, "e57" | "benchmark_trajectory">, string> = {
  colmap_database: "colmap-feature-database-derivation",
  colmap_sparse: "colmap-sparse-reconstruction",
  colmap_image: "e57-cubeface-jpeg-derivation",
};

export function buildGrandHallPilotManifest(
  inventory: readonly PilotHashRecord[],
  createdAt: string,
): FoundryIngestManifestV0 {
  const classified = inventory.map((record) => ({
    record,
    inputClass: classifyPilotInput(record.relativePath),
  }));
  const assets = classified.map(({ record, inputClass }) => {
    const id = assetIdFor(record.relativePath, inputClass);
    const shared = {
      id,
      mediaType: "application/octet-stream",
      sizeBytes: record.sizeBytes,
      sha256: `sha256:${record.sha256Hex}`,
      immutable: true as const,
      capturedAt: null,
      calibrationAssetIds: [],
      evidenceKinds: [],
    };
    if (inputClass === "e57") {
      return {
        ...shared,
        sourceRootId: "e57-root",
        relativePath: record.relativePath,
        inputType: "matterport_e57" as const,
        mediaType: "model/e57",
        captureState: "official_export" as const,
        accessState: "official_export" as const,
        coordinateFrameId: "venue-control",
        parentAssetIds: [],
        rights: matterportDerivedRights(),
        provenanceClass: "captured" as const,
        inspection: {
          geometryValue: "high" as const,
          appearanceValue: "medium" as const,
          calibrationValue: "medium" as const,
          scaleValue: "high" as const,
          metadataKeys: ["data3D", "images2D"],
          decisiveNextTest:
            "Deterministically re-extract scan count, pose translations and cubeface counts and compare with the recorded 149/965.52M/894 evidence.",
        },
        notes: [
          "ASTM E57 venue capture; identity of sweeps 0-49 human-reviewed per the decade-30 pack and prior decision B (sweep 49 excluded).",
        ],
      };
    }
    if (inputClass === "benchmark_trajectory") {
      return {
        ...shared,
        sourceRootId: "xgrids-root",
        relativePath: record.relativePath,
        inputType: "trajectory" as const,
        mediaType: "text/csv",
        captureState: "official_export" as const,
        accessState: "official_export" as const,
        coordinateFrameId: null,
        parentAssetIds: [],
        rights: {
          basis: "explicit_licence" as const,
          commercialUse: "allowed" as const,
          modelTrainingUse: "prohibited" as const,
          redistribution: "prohibited" as const,
          termsReviewedAt: "2026-07-12T00:00:00.000Z",
          termsReference: "https://github.com/xgrids/LCCWhitepaper",
          restrictions: [
            "Benchmark-only per the phase-1 goal; XGRIDS LCC terms are custom non-OSI — no training or redistribution pending counsel.",
          ],
        },
        provenanceClass: "captured" as const,
        inspection: {
          geometryValue: "medium" as const,
          appearanceValue: "none" as const,
          calibrationValue: "low" as const,
          scaleValue: "medium" as const,
          metadataKeys: [],
          decisiveNextTest:
            "Replay the bounded V5 trajectory source-facts inspection and bind its digests to this manifest entry.",
        },
        notes: [
          "PortalCam project sidecar used strictly as a rights-approved benchmark; pose convention/frame undocumented.",
        ],
      };
    }
    const inputType =
      inputClass === "colmap_database"
        ? ("colmap_database" as const)
        : inputClass === "colmap_sparse"
          ? ("colmap_sparse_model" as const)
          : ("generic_image" as const);
    return {
      ...shared,
      sourceRootId: "e57-root",
      relativePath: record.relativePath,
      inputType,
      mediaType: inputClass === "colmap_image" ? "image/jpeg" : "application/octet-stream",
      captureState: "derived" as const,
      accessState: "direct" as const,
      coordinateFrameId: inputClass === "colmap_image" ? null : "colmap-sfm",
      parentAssetIds: ["e57-main"],
      rights: matterportDerivedRights(),
      provenanceClass: "captured" as const,
      inspection: {
        geometryValue: inputClass === "colmap_image" ? ("low" as const) : ("medium" as const),
        appearanceValue: inputClass === "colmap_image" ? ("medium" as const) : ("none" as const),
        calibrationValue: "medium" as const,
        scaleValue: "low" as const,
        metadataKeys: [],
        decisiveNextTest:
          inputClass === "colmap_sparse"
            ? "Parse the sparse binary deterministically and compare camera/image/point counts with the recorded 1/231/124617 evidence."
            : inputClass === "colmap_database"
              ? "Open read-only and compare image and keypoint table counts with the sparse model."
              : "Verify byte-lineage to the E57-embedded 4096px cubeface of the same scan and face.",
      },
      notes: [
        "Derivation environment unrecorded; producing edge carries the digest of the fixed 'unrecorded-historical' marker string.",
      ],
    };
  });
  const provenanceEdges = classified
    .filter(({ inputClass }) => inputClass !== "e57" && inputClass !== "benchmark_trajectory")
    .map(({ record, inputClass }) => {
      const outputAssetId = assetIdFor(record.relativePath, inputClass);
      return {
        id: `edge-${outputAssetId}`,
        operationId:
          CLASS_OPERATION[inputClass as Exclude<PilotInputClass, "e57" | "benchmark_trajectory">],
        inputAssetIds: ["e57-main"],
        outputAssetId,
        operationVersion: "unrecorded-historical",
        environmentDigest: UNRECORDED_ENVIRONMENT_DIGEST,
        createdAt,
      };
    });
  return FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: "grand-hall-pilot",
    createdAt,
    createdBy: "foundry-phase1-goal",
    sourceRoots: [
      {
        id: "e57-root",
        kind: "local_directory",
        displayName: "E57 asset root (read-only)",
        locationRedacted: "E57_ASSET_ROOT",
        caseSensitivity: "insensitive",
        readOnly: true,
      },
      {
        id: "xgrids-root",
        kind: "local_directory",
        displayName: "XGRIDS model root (read-only)",
        locationRedacted: "XGRIDS_MODEL_ROOT",
        caseSensitivity: "insensitive",
        readOnly: true,
      },
    ],
    coordinateFrames: [
      {
        id: "venue-control",
        kind: "venue_control",
        units: "meters",
        handedness: "right",
        upAxis: "z",
        authority: "measured",
        provenanceAssetIds: ["e57-main"],
        crs: null,
      },
      {
        id: "colmap-sfm",
        kind: "arbitrary",
        units: "unitless",
        handedness: "unknown",
        upAxis: "unknown",
        authority: "registered",
        provenanceAssetIds: [],
        crs: null,
      },
    ],
    transforms: [],
    assets,
    provenanceEdges,
    generatedRegions: [],
    legalReviewState: "requires_review",
    sourceMutationPermitted: false,
  });
}
