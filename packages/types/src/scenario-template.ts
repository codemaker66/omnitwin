import { z } from "zod";
import {
  CrowdAgentProfileTypeSchema,
  CrowdFlowMetricNameSchema,
  CrowdFlowScenarioTypeSchema,
} from "./crowd-simulation-replay.js";
import {
  AssumptionCategorySchema,
  AssumptionReviewRequirementSchema,
} from "./assumption-ledger.js";
import { DataSufficiencyOutcomeSchema } from "./data-sufficiency.js";
import { FlowZoneKindSchema } from "./flow-zone.js";
import { LayoutProofClaimFamilySchema } from "./layout-proof-object.js";

export const SCENARIO_TEMPLATE_SCHEMA_VERSION = "venviewer.scenario-template.v0";

const SLUG_TOKEN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;

export const SCENARIO_TEMPLATE_GEOMETRY_CLASSES = [
  "walkable_area",
  "obstacle_polygons",
  "door_portals",
  "connector_graph",
  "queue_zones",
  "spawn_zones",
  "goal_zones",
  "staff_service_zones",
  "supplier_load_in_routes",
  "wheelchair_routes",
  "holding_areas",
  "runtime_geometry_ref",
] as const;
export const ScenarioTemplateGeometryClassSchema = z.enum(
  SCENARIO_TEMPLATE_GEOMETRY_CLASSES,
);
export type ScenarioTemplateGeometryClass = z.infer<
  typeof ScenarioTemplateGeometryClassSchema
>;

export const SCENARIO_TEMPLATE_ROUTE_INPUT_REQUIREMENTS = [
  "not_required",
  "explicit_polyline",
  "explicit_graph_path",
  "connector_graph",
  "navmesh_required",
  "navmesh_research_only",
  "unsupported_in_v0",
] as const;
export const ScenarioTemplateRouteInputRequirementSchema = z.enum(
  SCENARIO_TEMPLATE_ROUTE_INPUT_REQUIREMENTS,
);
export type ScenarioTemplateRouteInputRequirement = z.infer<
  typeof ScenarioTemplateRouteInputRequirementSchema
>;

export const SCENARIO_TEMPLATE_ENDPOINT_SEMANTICS = [
  "flow_zone_ref",
  "room_ref",
  "door_or_portal_ref",
  "coordinate_point_ref",
  "route_endpoint_ref",
] as const;
export const ScenarioTemplateEndpointSemanticSchema = z.enum(
  SCENARIO_TEMPLATE_ENDPOINT_SEMANTICS,
);
export type ScenarioTemplateEndpointSemantic = z.infer<
  typeof ScenarioTemplateEndpointSemanticSchema
>;

export const SCENARIO_TEMPLATE_MEASUREMENT_UNITS = [
  "count",
  "seconds",
  "metres",
  "metres_per_second",
  "agents",
  "ratio",
  "status",
] as const;
export const ScenarioTemplateMeasurementUnitSchema = z.enum(
  SCENARIO_TEMPLATE_MEASUREMENT_UNITS,
);
export type ScenarioTemplateMeasurementUnit = z.infer<
  typeof ScenarioTemplateMeasurementUnitSchema
>;

export const SCENARIO_TEMPLATE_WITNESS_INTEGRATION_RULES = [
  "cite_template_version",
  "cite_layout_snapshot",
  "cite_runtime_package",
  "cite_assumptions",
  "cite_route_or_navmesh",
  "cite_seed_policy",
  "cite_metrics",
  "cite_limitations",
  "emit_data_sufficiency",
] as const;
export const ScenarioTemplateWitnessIntegrationRuleSchema = z.enum(
  SCENARIO_TEMPLATE_WITNESS_INTEGRATION_RULES,
);
export type ScenarioTemplateWitnessIntegrationRule = z.infer<
  typeof ScenarioTemplateWitnessIntegrationRuleSchema
>;

export const SCENARIO_TEMPLATE_HUMAN_REVIEW_TRIGGERS = [
  "missing_required_flow_zone",
  "missing_required_assumption",
  "missing_route_input",
  "missing_connector_graph",
  "navmesh_dependency_review",
  "single_seed_sensitive_scenario",
  "professional_review_required",
  "unsupported_v0_request",
] as const;
export const ScenarioTemplateHumanReviewTriggerSchema = z.enum(
  SCENARIO_TEMPLATE_HUMAN_REVIEW_TRIGGERS,
);
export type ScenarioTemplateHumanReviewTrigger = z.infer<
  typeof ScenarioTemplateHumanReviewTriggerSchema
>;

export const ScenarioTemplateFlowZoneRequirementSchema = z.object({
  zoneKind: FlowZoneKindSchema,
  minCount: z.number().int().nonnegative(),
  dataSufficiencyOnMissing: DataSufficiencyOutcomeSchema,
}).strict();
export type ScenarioTemplateFlowZoneRequirement = z.infer<
  typeof ScenarioTemplateFlowZoneRequirementSchema
>;

export const ScenarioTemplateAssumptionRequirementSchema = z.object({
  category: AssumptionCategorySchema,
  reviewRequirement: AssumptionReviewRequirementSchema,
  dataSufficiencyOnMissing: DataSufficiencyOutcomeSchema,
}).strict();
export type ScenarioTemplateAssumptionRequirement = z.infer<
  typeof ScenarioTemplateAssumptionRequirementSchema
>;

export const ScenarioTemplateAgentProfileMixSchema = z.object({
  profileType: CrowdAgentProfileTypeSchema,
  weight: z.number().positive().max(1),
  defaultCount: z.number().int().positive().nullable(),
}).strict();
export type ScenarioTemplateAgentProfileMix = z.infer<
  typeof ScenarioTemplateAgentProfileMixSchema
>;

export const ScenarioTemplateMeasurementDefinitionSchema = z.object({
  metricName: CrowdFlowMetricNameSchema,
  unit: ScenarioTemplateMeasurementUnitSchema,
  requiredForWitness: z.boolean(),
  dataSufficiencyOnMissing: DataSufficiencyOutcomeSchema,
}).strict();
export type ScenarioTemplateMeasurementDefinition = z.infer<
  typeof ScenarioTemplateMeasurementDefinitionSchema
>;

export const ScenarioTemplateV0Schema = z.object({
  schemaVersion: z.literal(SCENARIO_TEMPLATE_SCHEMA_VERSION),
  templateId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN),
  templateVersion: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(160),
  venueApplicability: z.array(z.string().trim().min(1).max(120).regex(SLUG_TOKEN)).min(1),
  flowCategory: CrowdFlowScenarioTypeSchema,
  requiredGeometryClasses: z.array(ScenarioTemplateGeometryClassSchema).min(1),
  requiredFlowZones: z.array(ScenarioTemplateFlowZoneRequirementSchema).min(1),
  requiredAssumptions: z.array(ScenarioTemplateAssumptionRequirementSchema).min(1),
  defaultAgentProfileMix: z.array(ScenarioTemplateAgentProfileMixSchema).min(1),
  spawnSemantics: ScenarioTemplateEndpointSemanticSchema,
  destinationSemantics: ScenarioTemplateEndpointSemanticSchema,
  routeInputRequirement: ScenarioTemplateRouteInputRequirementSchema,
  measurementDefinitions: z.array(ScenarioTemplateMeasurementDefinitionSchema).min(1),
  outputMetrics: z.array(CrowdFlowMetricNameSchema).min(1),
  witnessClaimFamilies: z.array(LayoutProofClaimFamilySchema).min(1),
  witnessIntegrationRules: z.array(ScenarioTemplateWitnessIntegrationRuleSchema).min(1),
  limitations: z.array(z.string().trim().min(1).max(1000)).min(1),
  humanReviewTriggers: z.array(ScenarioTemplateHumanReviewTriggerSchema),
}).strict().superRefine((template, ctx) => {
  const requiredZoneKinds = new Set(
    template.requiredFlowZones
      .filter((requirement) => requirement.minCount > 0)
      .map((requirement) => requirement.zoneKind),
  );
  const humanReviewTriggers = new Set(template.humanReviewTriggers);

  if (template.flowCategory === "bar_queue") {
    for (const requiredKind of ["queue", "wait_service"] as const) {
      if (!requiredZoneKinds.has(requiredKind)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["requiredFlowZones"],
          message: "Bar queue templates require queue and wait_service flow zones.",
        });
      }
    }
  }

  if (
    (template.routeInputRequirement === "connector_graph" ||
      template.routeInputRequirement === "navmesh_required") &&
    !humanReviewTriggers.has("missing_connector_graph")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["humanReviewTriggers"],
      message: "Connector or navmesh requirements must declare missing connector review behavior.",
    });
  }

  if (
    (template.routeInputRequirement === "navmesh_required" ||
      template.routeInputRequirement === "navmesh_research_only") &&
    !humanReviewTriggers.has("navmesh_dependency_review")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["humanReviewTriggers"],
      message: "Navmesh-dependent templates must declare navmesh dependency review.",
    });
  }

  if (
    template.routeInputRequirement === "unsupported_in_v0" &&
    !humanReviewTriggers.has("unsupported_v0_request")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["humanReviewTriggers"],
      message: "Unsupported v0 route input requirements must declare unsupported request review.",
    });
  }
});
export type ScenarioTemplateV0 = z.infer<typeof ScenarioTemplateV0Schema>;
