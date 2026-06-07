import { z } from "zod";
import { type ArtifactExposureTier } from "./artifact-manifest.js";
import { CanonicalJsonValueSchema } from "./canonical-layout-snapshot.js";
import {
  CrowdFlowMetricNameSchema,
  CrowdSimulatorSourceNameSchema,
} from "./crowd-simulation-replay.js";
import { DataSufficiencyOutcomeSchema } from "./data-sufficiency.js";
import {
  ScenarioInstanceAssumptionRefSchema,
  ScenarioInstanceSeedRefSchema,
  ScenarioInstanceV0Schema,
  type ScenarioInstanceAssumptionRef,
  type ScenarioInstanceSeedRef,
} from "./scenario-instance.js";
import { SCENARIO_TEMPLATE_SCHEMA_VERSION } from "./scenario-template.js";

export const VENREPLAY_ARTIFACT_SCHEMA_VERSION = "venviewer.venreplay.v0";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const SLUG_TOKEN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;
const SEMVERISH = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const CSV_COLUMN_TOKEN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export const VENREPLAY_REQUIRED_FILE_PATHS = [
  "manifest.json",
  "geometry.geojson",
  "scenario.json",
  "agents.csv",
  "trajectory.csv",
  "metrics.json",
  "bottlenecks.geojson",
  "witness.json",
] as const;
export const VenreplayRequiredFilePathSchema = z.enum(VENREPLAY_REQUIRED_FILE_PATHS);
export type VenreplayRequiredFilePath = z.infer<typeof VenreplayRequiredFilePathSchema>;

export const VENREPLAY_OPTIONAL_FILE_PATHS = ["scene.glb"] as const;
export const VenreplayOptionalFilePathSchema = z.enum(VENREPLAY_OPTIONAL_FILE_PATHS);
export type VenreplayOptionalFilePath = z.infer<typeof VenreplayOptionalFilePathSchema>;

export const VENREPLAY_FILE_PATHS = [
  ...VENREPLAY_REQUIRED_FILE_PATHS,
  ...VENREPLAY_OPTIONAL_FILE_PATHS,
] as const;
export const VenreplayFilePathSchema = z.enum(VENREPLAY_FILE_PATHS);
export type VenreplayFilePath = z.infer<typeof VenreplayFilePathSchema>;

export const VENREPLAY_FILE_ROLES = [
  "manifest",
  "geometry",
  "scenario",
  "agents",
  "trajectory",
  "metrics",
  "bottlenecks",
  "witness",
  "display_scene",
] as const;
export const VenreplayFileRoleSchema = z.enum(VENREPLAY_FILE_ROLES);
export type VenreplayFileRole = z.infer<typeof VenreplayFileRoleSchema>;

export const VENREPLAY_EXPOSURE_TIERS = [
  "internal_only",
  "partner_preview",
  "authenticated_client",
  "expert_review",
] as const satisfies readonly ArtifactExposureTier[];
export const VenreplayExposureTierSchema = z.enum(VENREPLAY_EXPOSURE_TIERS);
export type VenreplayExposureTier = z.infer<typeof VenreplayExposureTierSchema>;

export const VENREPLAY_CSV_CONTRACTS = [
  "agents_v0",
  "trajectory_v0",
] as const;
export const VenreplayCsvContractSchema = z.enum(VENREPLAY_CSV_CONTRACTS);
export type VenreplayCsvContract = z.infer<typeof VenreplayCsvContractSchema>;

export const VENREPLAY_CSV_FILE_PATHS = ["agents.csv", "trajectory.csv"] as const;
export const VenreplayCsvFilePathSchema = z.enum(VENREPLAY_CSV_FILE_PATHS);
export type VenreplayCsvFilePath = z.infer<typeof VenreplayCsvFilePathSchema>;

export const VENREPLAY_CSV_REQUIRED_COLUMNS = {
  agents_v0: [
    "agent_id",
    "profile_type",
    "start_ref",
    "goal_ref",
  ],
  trajectory_v0: [
    "time_seconds",
    "agent_id",
    "x_m",
    "y_m",
    "level_id",
    "state",
  ],
} as const satisfies Record<VenreplayCsvContract, readonly string[]>;

export const VENREPLAY_CSV_CONTRACT_FILE_PATH = {
  agents_v0: "agents.csv",
  trajectory_v0: "trajectory.csv",
} as const satisfies Record<VenreplayCsvContract, VenreplayCsvFilePath>;

export const VENREPLAY_GEOJSON_FILE_PATHS = [
  "geometry.geojson",
  "bottlenecks.geojson",
] as const;
export const VenreplayGeojsonFilePathSchema = z.enum(VENREPLAY_GEOJSON_FILE_PATHS);
export type VenreplayGeojsonFilePath = z.infer<typeof VenreplayGeojsonFilePathSchema>;

export const VENREPLAY_GEOJSON_FEATURE_REQUIREMENTS = [
  "feature_collection",
  "feature_id",
  "geometry_type",
  "coordinate_frame",
  "units",
  "source_ref",
  "data_sufficiency",
] as const;
export const VenreplayGeojsonFeatureRequirementSchema = z.enum(
  VENREPLAY_GEOJSON_FEATURE_REQUIREMENTS,
);
export type VenreplayGeojsonFeatureRequirement = z.infer<
  typeof VenreplayGeojsonFeatureRequirementSchema
>;

export const VENREPLAY_WITNESS_COMPATIBILITY_REQUIREMENTS = [
  "scenario_instance_ref",
  "layout_snapshot_digest",
  "runtime_package_hash",
  "policy_bundle_ref",
  "assumption_refs",
  "simulator_ref",
  "seed_ref",
  "metric_refs",
  "limitations",
] as const;
export const VenreplayWitnessCompatibilityRequirementSchema = z.enum(
  VENREPLAY_WITNESS_COMPATIBILITY_REQUIREMENTS,
);
export type VenreplayWitnessCompatibilityRequirement = z.infer<
  typeof VenreplayWitnessCompatibilityRequirementSchema
>;

const VENREPLAY_FILE_ROLE_BY_PATH = {
  "manifest.json": "manifest",
  "geometry.geojson": "geometry",
  "scenario.json": "scenario",
  "agents.csv": "agents",
  "trajectory.csv": "trajectory",
  "metrics.json": "metrics",
  "bottlenecks.geojson": "bottlenecks",
  "witness.json": "witness",
  "scene.glb": "display_scene",
} as const satisfies Record<VenreplayFilePath, VenreplayFileRole>;

const REQUIRED_FILE_PATH_SET: ReadonlySet<VenreplayFilePath> = new Set(
  VENREPLAY_REQUIRED_FILE_PATHS,
);

export const VenreplayFileHashSchema = z.object({
  path: VenreplayFilePathSchema,
  role: VenreplayFileRoleSchema,
  sha256: z.string().regex(SHA256_HEX),
  byteSize: z.number().int().positive(),
  required: z.boolean(),
}).strict();
export type VenreplayFileHash = z.infer<typeof VenreplayFileHashSchema>;

export const VenreplayMetricsShapeSchema = z.object({
  metricName: CrowdFlowMetricNameSchema,
  dataSufficiency: DataSufficiencyOutcomeSchema,
  valuePath: z.string().trim().min(1).max(160),
  unit: z.string().trim().min(1).max(80),
}).strict();
export type VenreplayMetricsShape = z.infer<typeof VenreplayMetricsShapeSchema>;

export const VenreplayCsvColumnContractSchema = z.object({
  filePath: VenreplayCsvFilePathSchema,
  contract: VenreplayCsvContractSchema,
  columns: z.array(z.string().trim().min(1).max(80).regex(CSV_COLUMN_TOKEN)).min(1),
}).strict();
export type VenreplayCsvColumnContract = z.infer<
  typeof VenreplayCsvColumnContractSchema
>;

export const VenreplayGeojsonFeatureContractSchema = z.object({
  filePath: VenreplayGeojsonFilePathSchema,
  requirements: z.array(VenreplayGeojsonFeatureRequirementSchema).min(1),
}).strict();
export type VenreplayGeojsonFeatureContract = z.infer<
  typeof VenreplayGeojsonFeatureContractSchema
>;

export const VenreplayManifestV0Schema = z.object({
  schemaVersion: z.literal(VENREPLAY_ARTIFACT_SCHEMA_VERSION),
  artifactVersion: z.string().trim().regex(SEMVERISH).max(80),
  artifactId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN),
  scenarioTemplateId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN),
  scenarioTemplateVersion: z.string().trim().min(1).max(80),
  scenarioTemplateSchemaVersion: z.literal(SCENARIO_TEMPLATE_SCHEMA_VERSION),
  scenarioInstanceId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN),
  scenarioInstance: ScenarioInstanceV0Schema,
  layoutSnapshotHash: z.string().regex(SHA256_HEX),
  runtimePackageId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN).nullable(),
  runtimePackageHash: z.string().regex(SHA256_HEX).nullable(),
  policyBundleDigest: z.string().regex(SHA256_HEX).nullable(),
  simulatorName: CrowdSimulatorSourceNameSchema,
  simulatorVersion: z.string().trim().min(1).max(120).nullable(),
  simulatorHash: z.string().regex(SHA256_HEX).nullable(),
  seed: ScenarioInstanceSeedRefSchema,
  seedCount: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
  assumptions: z.array(ScenarioInstanceAssumptionRefSchema).min(1),
  limitations: z.array(z.string().trim().min(1).max(1000)).min(1),
  fileHashes: z.array(VenreplayFileHashSchema).min(VENREPLAY_REQUIRED_FILE_PATHS.length),
  csvColumnContracts: z.array(VenreplayCsvColumnContractSchema).min(2),
  geojsonFeatureContracts: z.array(VenreplayGeojsonFeatureContractSchema).min(2),
  metricsShape: z.array(VenreplayMetricsShapeSchema).min(1),
  witnessCompatibility: z.array(VenreplayWitnessCompatibilityRequirementSchema).min(1),
  exposureTier: VenreplayExposureTierSchema,
  manifestExtension: z.record(CanonicalJsonValueSchema).optional(),
}).strict().superRefine((manifest, ctx) => {
  const filePaths = new Set<VenreplayFilePath>();

  for (const fileHash of manifest.fileHashes) {
    if (filePaths.has(fileHash.path)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fileHashes"],
        message: `Duplicate venreplay file hash for ${fileHash.path}.`,
      });
    }

    filePaths.add(fileHash.path);

    const expectedRole = VENREPLAY_FILE_ROLE_BY_PATH[fileHash.path];
    if (fileHash.role !== expectedRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fileHashes"],
        message: `${fileHash.path} must use role ${expectedRole}.`,
      });
    }

    const expectedRequired = REQUIRED_FILE_PATH_SET.has(fileHash.path);
    if (fileHash.required !== expectedRequired) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fileHashes"],
        message: `${fileHash.path} required flag must be ${String(expectedRequired)}.`,
      });
    }
  }

  for (const path of VENREPLAY_REQUIRED_FILE_PATHS) {
    if (!filePaths.has(path)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fileHashes"],
        message: `Missing required venreplay file hash for ${path}.`,
      });
    }
  }

  if (manifest.scenarioInstance.lifecycleState !== "replay_ready") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scenarioInstance", "lifecycleState"],
      message: "Venreplay manifests require a replay-ready scenario instance.",
    });
  }

  if (manifest.scenarioInstance.witnessBlockRef === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scenarioInstance", "witnessBlockRef"],
      message: "Venreplay manifests require a witness block reference.",
    });
  }

  if (manifest.scenarioInstanceId !== manifest.scenarioInstance.instanceId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scenarioInstanceId"],
      message: "Manifest scenarioInstanceId must match scenarioInstance.instanceId.",
    });
  }

  if (manifest.scenarioTemplateId !== manifest.scenarioInstance.templateId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scenarioTemplateId"],
      message: "Manifest scenarioTemplateId must match scenarioInstance.templateId.",
    });
  }

  if (manifest.scenarioTemplateVersion !== manifest.scenarioInstance.templateVersion) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scenarioTemplateVersion"],
      message: "Manifest scenarioTemplateVersion must match scenarioInstance.templateVersion.",
    });
  }

  if (manifest.layoutSnapshotHash !== manifest.scenarioInstance.layoutSnapshotDigest) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["layoutSnapshotHash"],
      message: "Manifest layoutSnapshotHash must match scenarioInstance.layoutSnapshotDigest.",
    });
  }

  if (manifest.runtimePackageId !== manifest.scenarioInstance.runtimePackageId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["runtimePackageId"],
      message: "Manifest runtimePackageId must match scenarioInstance.runtimePackageId.",
    });
  }

  if (manifest.runtimePackageHash !== manifest.scenarioInstance.runtimePackageHash) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["runtimePackageHash"],
      message: "Manifest runtimePackageHash must match scenarioInstance.runtimePackageHash.",
    });
  }

  if (manifest.policyBundleDigest !== manifest.scenarioInstance.policyBundle.policyBundleDigest) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["policyBundleDigest"],
      message: "Manifest policyBundleDigest must match scenarioInstance.policyBundle.",
    });
  }

  const simulator = manifest.scenarioInstance.simulator;
  if (simulator === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scenarioInstance", "simulator"],
      message: "Venreplay manifests require simulator metadata.",
    });
  } else {
    if (manifest.simulatorName !== simulator.simulatorName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["simulatorName"],
        message: "Manifest simulatorName must match scenarioInstance.simulator.",
      });
    }

    if (manifest.simulatorVersion !== simulator.simulatorVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["simulatorVersion"],
        message: "Manifest simulatorVersion must match scenarioInstance.simulator.",
      });
    }

    if (manifest.simulatorHash !== simulator.simulatorHash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["simulatorHash"],
        message: "Manifest simulatorHash must match scenarioInstance.simulator.",
      });
    }
  }

  if (!seedRefsEqual(manifest.seed, manifest.scenarioInstance.seed)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["seed"],
      message: "Manifest seed must match scenarioInstance.seed.",
    });
  }

  if (manifest.seedCount !== venreplaySeedCount(manifest.seed)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["seedCount"],
      message: "seedCount must match seed policy.",
    });
  }

  validateAssumptionRefs(manifest.assumptions, manifest.scenarioInstance.assumptionRefs, ctx);
  validateCsvContracts(manifest.csvColumnContracts, ctx);
  validateGeojsonContracts(manifest.geojsonFeatureContracts, ctx);
  validateWitnessCompatibility(manifest.witnessCompatibility, ctx);
  validateMetricsShape(manifest.metricsShape, manifest.scenarioInstance.metricsSummary, ctx);
});
export type VenreplayManifestV0 = z.infer<typeof VenreplayManifestV0Schema>;

export function venreplaySeedCount(seedRef: ScenarioInstanceSeedRef): number {
  switch (seedRef.seedPolicy) {
    case "no_seed_required":
      return 0;
    case "single_seed":
      return 1;
    case "seed_set":
      return seedRef.seedSet.length;
    case "deterministic_recipe":
      return seedRef.seedSet.length > 0 ? seedRef.seedSet.length : Number(seedRef.seed !== null);
  }
}

function seedRefsEqual(left: ScenarioInstanceSeedRef, right: ScenarioInstanceSeedRef): boolean {
  if (left.seedPolicy !== right.seedPolicy || left.seed !== right.seed) {
    return false;
  }

  if (left.seedSet.length !== right.seedSet.length) {
    return false;
  }

  return left.seedSet.every((seed, index) => seed === right.seedSet[index]);
}

function assumptionKey(assumption: ScenarioInstanceAssumptionRef): string {
  return `${assumption.assumptionId}:${assumption.category}:${assumption.contentHash ?? "null"}`;
}

function validateAssumptionRefs(
  manifestAssumptions: readonly ScenarioInstanceAssumptionRef[],
  instanceAssumptions: readonly ScenarioInstanceAssumptionRef[],
  ctx: z.RefinementCtx,
): void {
  const manifestKeys = new Set(manifestAssumptions.map(assumptionKey));
  const instanceKeys = new Set(instanceAssumptions.map(assumptionKey));

  if (manifestKeys.size !== manifestAssumptions.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assumptions"],
      message: "Manifest assumptions must not contain duplicates.",
    });
  }

  if (manifestKeys.size !== instanceKeys.size) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assumptions"],
      message: "Manifest assumptions must exactly match scenarioInstance.assumptionRefs.",
    });
  }

  for (const key of instanceKeys) {
    if (!manifestKeys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assumptions"],
        message: "Manifest assumptions must include every scenario instance assumption.",
      });
    }
  }
}

function validateCsvContracts(
  contracts: readonly VenreplayCsvColumnContract[],
  ctx: z.RefinementCtx,
): void {
  const contractNames = new Set<VenreplayCsvContract>();
  const filePaths = new Set<VenreplayCsvFilePath>();
  const columnsByContract = new Map<VenreplayCsvContract, readonly string[]>();

  for (const contract of contracts) {
    if (contractNames.has(contract.contract)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["csvColumnContracts"],
        message: `Duplicate CSV contract ${contract.contract}.`,
      });
    }

    if (filePaths.has(contract.filePath)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["csvColumnContracts"],
        message: `Duplicate CSV file contract for ${contract.filePath}.`,
      });
    }

    const expectedFilePath = VENREPLAY_CSV_CONTRACT_FILE_PATH[contract.contract];
    if (contract.filePath !== expectedFilePath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["csvColumnContracts"],
        message: `${contract.contract} must describe ${expectedFilePath}.`,
      });
    }

    contractNames.add(contract.contract);
    filePaths.add(contract.filePath);
    columnsByContract.set(contract.contract, contract.columns);
  }

  for (const contract of VENREPLAY_CSV_CONTRACTS) {
    const columns = columnsByContract.get(contract);
    if (columns === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["csvColumnContracts"],
        message: `Missing CSV contract ${contract}.`,
      });
      continue;
    }

    for (const requiredColumn of VENREPLAY_CSV_REQUIRED_COLUMNS[contract]) {
      if (!columns.includes(requiredColumn)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["csvColumnContracts"],
          message: `${contract} missing required column ${requiredColumn}.`,
        });
      }
    }
  }
}

function validateGeojsonContracts(
  contracts: readonly VenreplayGeojsonFeatureContract[],
  ctx: z.RefinementCtx,
): void {
  const filePaths = new Set<VenreplayGeojsonFilePath>();
  const requirementsByPath = new Map<
    VenreplayGeojsonFilePath,
    readonly VenreplayGeojsonFeatureRequirement[]
  >();

  for (const contract of contracts) {
    if (filePaths.has(contract.filePath)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["geojsonFeatureContracts"],
        message: `Duplicate GeoJSON contract for ${contract.filePath}.`,
      });
    }

    filePaths.add(contract.filePath);
    requirementsByPath.set(contract.filePath, contract.requirements);
  }

  for (const filePath of VENREPLAY_GEOJSON_FILE_PATHS) {
    const requirements = requirementsByPath.get(filePath);
    if (requirements === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["geojsonFeatureContracts"],
        message: `Missing GeoJSON contract for ${filePath}.`,
      });
      continue;
    }

    for (const requirement of VENREPLAY_GEOJSON_FEATURE_REQUIREMENTS) {
      if (!requirements.includes(requirement)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["geojsonFeatureContracts"],
          message: `${filePath} missing GeoJSON requirement ${requirement}.`,
        });
      }
    }
  }
}

function validateWitnessCompatibility(
  requirements: readonly VenreplayWitnessCompatibilityRequirement[],
  ctx: z.RefinementCtx,
): void {
  if (new Set(requirements).size !== requirements.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["witnessCompatibility"],
      message: "Witness compatibility requirements must not contain duplicates.",
    });
  }

  for (const requirement of VENREPLAY_WITNESS_COMPATIBILITY_REQUIREMENTS) {
    if (!requirements.includes(requirement)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["witnessCompatibility"],
        message: `Missing witness compatibility requirement ${requirement}.`,
      });
    }
  }
}

function validateMetricsShape(
  metricsShape: readonly VenreplayMetricsShape[],
  metricsSummary: readonly {
    metricName: VenreplayMetricsShape["metricName"];
    dataSufficiency: VenreplayMetricsShape["dataSufficiency"];
  }[],
  ctx: z.RefinementCtx,
): void {
  const metricsByName = new Map<VenreplayMetricsShape["metricName"], VenreplayMetricsShape>();

  for (const metric of metricsShape) {
    if (metricsByName.has(metric.metricName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metricsShape"],
        message: `Duplicate metric shape ${metric.metricName}.`,
      });
    }

    metricsByName.set(metric.metricName, metric);
  }

  for (const metricSummary of metricsSummary) {
    const metricShape = metricsByName.get(metricSummary.metricName);
    if (metricShape === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metricsShape"],
        message: `metricsShape must include scenario metric ${metricSummary.metricName}.`,
      });
      continue;
    }

    if (metricShape.dataSufficiency !== metricSummary.dataSufficiency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metricsShape"],
        message: `${metricSummary.metricName} data sufficiency must match scenario metrics.`,
      });
    }
  }
}
