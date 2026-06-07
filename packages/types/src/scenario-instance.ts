import { z } from "zod";
import { AssumptionCategorySchema } from "./assumption-ledger.js";
import { CanonicalJsonValueSchema } from "./canonical-layout-snapshot.js";
import {
  CrowdFlowMetricNameSchema,
  CrowdReplayBundleLifecycleStateSchema,
  CrowdSimulatorSourceNameSchema,
} from "./crowd-simulation-replay.js";
import { DataSufficiencyOutcomeSchema } from "./data-sufficiency.js";
import { SCENARIO_TEMPLATE_SCHEMA_VERSION } from "./scenario-template.js";

export const SCENARIO_INSTANCE_SCHEMA_VERSION = "venviewer.scenario-instance.v0";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const SLUG_TOKEN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;

export const SCENARIO_INSTANCE_ROUTE_MODEL_TYPES = [
  "not_required",
  "explicit_polyline",
  "explicit_graph_path",
  "connector_graph",
  "navmesh",
  "unsupported",
] as const;
export const ScenarioInstanceRouteModelTypeSchema = z.enum(
  SCENARIO_INSTANCE_ROUTE_MODEL_TYPES,
);
export type ScenarioInstanceRouteModelType = z.infer<
  typeof ScenarioInstanceRouteModelTypeSchema
>;

export const SCENARIO_INSTANCE_SEED_POLICIES = [
  "no_seed_required",
  "single_seed",
  "seed_set",
  "deterministic_recipe",
] as const;
export const ScenarioInstanceSeedPolicySchema = z.enum(SCENARIO_INSTANCE_SEED_POLICIES);
export type ScenarioInstanceSeedPolicy = z.infer<typeof ScenarioInstanceSeedPolicySchema>;

export const SCENARIO_INSTANCE_ARTIFACT_REF_TYPES = [
  "trajectory",
  "heatmap",
  "bottlenecks",
  "metrics",
  "replay_bundle",
  "geometry",
  "route_model",
  "witness_block",
] as const;
export const ScenarioInstanceArtifactRefTypeSchema = z.enum(
  SCENARIO_INSTANCE_ARTIFACT_REF_TYPES,
);
export type ScenarioInstanceArtifactRefType = z.infer<
  typeof ScenarioInstanceArtifactRefTypeSchema
>;

export const SCENARIO_INSTANCE_STALENESS_TRIGGERS = [
  "scenario_template_changed",
  "layout_snapshot_changed",
  "runtime_package_changed",
  "policy_bundle_changed",
  "assumptions_changed",
  "route_model_changed",
  "simulator_changed",
  "simulator_parameters_changed",
  "seed_policy_changed",
] as const;
export const ScenarioInstanceStalenessTriggerSchema = z.enum(
  SCENARIO_INSTANCE_STALENESS_TRIGGERS,
);
export type ScenarioInstanceStalenessTrigger = z.infer<
  typeof ScenarioInstanceStalenessTriggerSchema
>;

export const ScenarioInstanceAssumptionRefSchema = z.object({
  assumptionId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN),
  category: AssumptionCategorySchema,
  contentHash: z.string().regex(SHA256_HEX).nullable(),
}).strict();
export type ScenarioInstanceAssumptionRef = z.infer<
  typeof ScenarioInstanceAssumptionRefSchema
>;

export const ScenarioInstancePolicyBundleRefSchema = z.object({
  policyBundleId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN),
  policyBundleVersion: z.string().trim().min(1).max(80),
  policyBundleDigest: z.string().regex(SHA256_HEX).nullable(),
}).strict();
export type ScenarioInstancePolicyBundleRef = z.infer<
  typeof ScenarioInstancePolicyBundleRefSchema
>;

export const ScenarioInstanceRouteModelRefSchema = z.object({
  routeModelType: ScenarioInstanceRouteModelTypeSchema,
  routeModelId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN).nullable(),
  routeModelHash: z.string().regex(SHA256_HEX).nullable(),
  dataSufficiency: DataSufficiencyOutcomeSchema,
}).strict();
export type ScenarioInstanceRouteModelRef = z.infer<
  typeof ScenarioInstanceRouteModelRefSchema
>;

export const ScenarioInstanceSimulatorRefSchema = z.object({
  simulatorName: CrowdSimulatorSourceNameSchema,
  simulatorVersion: z.string().trim().min(1).max(120).nullable(),
  simulatorHash: z.string().regex(SHA256_HEX).nullable(),
  parameters: z.record(CanonicalJsonValueSchema),
}).strict();
export type ScenarioInstanceSimulatorRef = z.infer<
  typeof ScenarioInstanceSimulatorRefSchema
>;

export const ScenarioInstanceSeedRefSchema = z.object({
  seedPolicy: ScenarioInstanceSeedPolicySchema,
  seed: z.number().int().nonnegative().nullable(),
  seedSet: z.array(z.number().int().nonnegative()),
}).strict().superRefine((seedRef, ctx) => {
  if (seedRef.seedPolicy === "single_seed" && seedRef.seed === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["seed"],
      message: "single_seed policy requires seed.",
    });
  }

  if (seedRef.seedPolicy === "seed_set" && seedRef.seedSet.length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["seedSet"],
      message: "seed_set policy requires at least two seeds.",
    });
  }

  if (seedRef.seedPolicy === "no_seed_required" && (seedRef.seed !== null || seedRef.seedSet.length > 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["seedPolicy"],
      message: "no_seed_required must not carry seed values.",
    });
  }
});
export type ScenarioInstanceSeedRef = z.infer<typeof ScenarioInstanceSeedRefSchema>;

export const ScenarioInstanceArtifactRefSchema = z.object({
  refType: ScenarioInstanceArtifactRefTypeSchema,
  ref: z.string().trim().min(1).max(512),
  contentHash: z.string().regex(SHA256_HEX).nullable(),
}).strict();
export type ScenarioInstanceArtifactRef = z.infer<
  typeof ScenarioInstanceArtifactRefSchema
>;

export const ScenarioInstanceMetricSummarySchema = z.object({
  metricName: CrowdFlowMetricNameSchema,
  value: CanonicalJsonValueSchema,
  dataSufficiency: DataSufficiencyOutcomeSchema,
  worstCase: z.boolean(),
}).strict();
export type ScenarioInstanceMetricSummary = z.infer<
  typeof ScenarioInstanceMetricSummarySchema
>;

export const ScenarioInstanceV0Schema = z.object({
  schemaVersion: z.literal(SCENARIO_INSTANCE_SCHEMA_VERSION),
  instanceId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN),
  templateId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN),
  templateVersion: z.string().trim().min(1).max(80),
  templateSchemaVersion: z.literal(SCENARIO_TEMPLATE_SCHEMA_VERSION),
  layoutSnapshotDigest: z.string().regex(SHA256_HEX),
  runtimePackageId: z.string().trim().min(1).max(160).nullable(),
  runtimePackageHash: z.string().regex(SHA256_HEX).nullable(),
  policyBundle: ScenarioInstancePolicyBundleRefSchema,
  assumptionRefs: z.array(ScenarioInstanceAssumptionRefSchema).min(1),
  routeModel: ScenarioInstanceRouteModelRefSchema,
  simulator: ScenarioInstanceSimulatorRefSchema.nullable(),
  seed: ScenarioInstanceSeedRefSchema,
  artifactRefs: z.array(ScenarioInstanceArtifactRefSchema),
  metricsSummary: z.array(ScenarioInstanceMetricSummarySchema),
  witnessBlockRef: ScenarioInstanceArtifactRefSchema.nullable(),
  lifecycleState: CrowdReplayBundleLifecycleStateSchema,
  staleWhen: z.array(ScenarioInstanceStalenessTriggerSchema),
}).strict().superRefine((instance, ctx) => {
  const artifactTypes = new Set(instance.artifactRefs.map((artifact) => artifact.refType));

  if (
    (instance.lifecycleState === "simulation_run" ||
      instance.lifecycleState === "metrics_ready" ||
      instance.lifecycleState === "replay_ready") &&
    instance.simulator === null
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["simulator"],
      message: "Simulation lifecycle states require simulator metadata.",
    });
  }

  if (
    (instance.lifecycleState === "metrics_ready" || instance.lifecycleState === "replay_ready") &&
    instance.metricsSummary.length === 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["metricsSummary"],
      message: "Metrics-ready and replay-ready instances require metrics summary.",
    });
  }

  if (instance.lifecycleState === "replay_ready" && !artifactTypes.has("trajectory")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["artifactRefs"],
      message: "Replay-ready instances require a trajectory artifact reference.",
    });
  }

  if (instance.witnessBlockRef !== null && instance.witnessBlockRef.refType !== "witness_block") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["witnessBlockRef"],
      message: "witnessBlockRef must use refType witness_block.",
    });
  }

  if (
    instance.routeModel.routeModelType === "unsupported" &&
    instance.routeModel.dataSufficiency !== "unsupported_request"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["routeModel", "dataSufficiency"],
      message: "Unsupported route models must emit unsupported_request.",
    });
  }
});
export type ScenarioInstanceV0 = z.infer<typeof ScenarioInstanceV0Schema>;
