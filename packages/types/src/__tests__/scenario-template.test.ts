import { describe, expect, it } from "vitest";
import { AssumptionCategorySchema } from "../assumption-ledger.js";
import { CrowdFlowScenarioTypeSchema } from "../crowd-simulation-replay.js";
import { FlowZoneKindSchema } from "../flow-zone.js";
import { LayoutProofClaimStatusSchema } from "../layout-proof-object.js";
import {
  SCENARIO_TEMPLATE_ENDPOINT_SEMANTICS,
  SCENARIO_TEMPLATE_GEOMETRY_CLASSES,
  SCENARIO_TEMPLATE_HUMAN_REVIEW_TRIGGERS,
  SCENARIO_TEMPLATE_MEASUREMENT_UNITS,
  SCENARIO_TEMPLATE_ROUTE_INPUT_REQUIREMENTS,
  SCENARIO_TEMPLATE_SCHEMA_VERSION,
  SCENARIO_TEMPLATE_WITNESS_INTEGRATION_RULES,
  ScenarioTemplateEndpointSemanticSchema,
  ScenarioTemplateGeometryClassSchema,
  ScenarioTemplateHumanReviewTriggerSchema,
  ScenarioTemplateMeasurementUnitSchema,
  ScenarioTemplateRouteInputRequirementSchema,
  ScenarioTemplateV0Schema,
  ScenarioTemplateWitnessIntegrationRuleSchema,
  type ScenarioTemplateV0,
} from "../scenario-template.js";

const BAR_QUEUE_TEMPLATE: ScenarioTemplateV0 = {
  schemaVersion: SCENARIO_TEMPLATE_SCHEMA_VERSION,
  templateId: "bar_queue_after_speeches",
  templateVersion: "0.1.0",
  displayName: "Bar queue after speeches",
  venueApplicability: ["trades_hall", "heritage_event_venue"],
  flowCategory: "bar_queue",
  requiredGeometryClasses: [
    "walkable_area",
    "obstacle_polygons",
    "door_portals",
    "queue_zones",
    "staff_service_zones",
  ],
  requiredFlowZones: [
    {
      zoneKind: "queue",
      minCount: 1,
      dataSufficiencyOnMissing: "not_checked",
    },
    {
      zoneKind: "wait_service",
      minCount: 1,
      dataSufficiencyOnMissing: "requires_human_review",
    },
    {
      zoneKind: "door",
      minCount: 1,
      dataSufficiencyOnMissing: "degraded_evidence",
    },
  ],
  requiredAssumptions: [
    {
      category: "attendance",
      reviewRequirement: "venue_staff_review_required",
      dataSufficiencyOnMissing: "degraded_evidence",
    },
    {
      category: "service_rate",
      reviewRequirement: "hallkeeper_review_required",
      dataSufficiencyOnMissing: "requires_human_review",
    },
  ],
  defaultAgentProfileMix: [
    {
      profileType: "guest",
      weight: 0.9,
      defaultCount: null,
    },
    {
      profileType: "staff",
      weight: 0.1,
      defaultCount: null,
    },
  ],
  spawnSemantics: "flow_zone_ref",
  destinationSemantics: "flow_zone_ref",
  routeInputRequirement: "explicit_graph_path",
  measurementDefinitions: [
    {
      metricName: "max_queue_length",
      unit: "agents",
      requiredForWitness: true,
      dataSufficiencyOnMissing: "not_checked",
    },
    {
      metricName: "queue_wait_time",
      unit: "seconds",
      requiredForWitness: true,
      dataSufficiencyOnMissing: "degraded_evidence",
    },
  ],
  outputMetrics: ["max_queue_length", "queue_wait_time", "route_conflict_count"],
  witnessClaimFamilies: ["venue_specific", "operational_setup"],
  witnessIntegrationRules: [
    "cite_template_version",
    "cite_layout_snapshot",
    "cite_assumptions",
    "cite_route_or_navmesh",
    "cite_metrics",
    "cite_limitations",
    "emit_data_sufficiency",
  ],
  limitations: [
    "Scenario template defines required inputs only; it does not run a simulator.",
  ],
  humanReviewTriggers: ["missing_required_flow_zone", "missing_required_assumption"],
};

describe("Scenario Template schema", () => {
  it("pins reusable scenario-template vocabularies from CSRB-001", () => {
    expect(SCENARIO_TEMPLATE_GEOMETRY_CLASSES).toEqual([
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
    ]);

    expect(SCENARIO_TEMPLATE_ROUTE_INPUT_REQUIREMENTS).toEqual([
      "not_required",
      "explicit_polyline",
      "explicit_graph_path",
      "connector_graph",
      "navmesh_required",
      "navmesh_research_only",
      "unsupported_in_v0",
    ]);

    expect(SCENARIO_TEMPLATE_ENDPOINT_SEMANTICS).toEqual([
      "flow_zone_ref",
      "room_ref",
      "door_or_portal_ref",
      "coordinate_point_ref",
      "route_endpoint_ref",
    ]);
  });

  it("pins measurement, witness, and human-review vocabularies", () => {
    expect(SCENARIO_TEMPLATE_MEASUREMENT_UNITS).toEqual([
      "count",
      "seconds",
      "metres",
      "metres_per_second",
      "agents",
      "ratio",
      "status",
    ]);

    expect(SCENARIO_TEMPLATE_WITNESS_INTEGRATION_RULES).toEqual([
      "cite_template_version",
      "cite_layout_snapshot",
      "cite_runtime_package",
      "cite_assumptions",
      "cite_route_or_navmesh",
      "cite_seed_policy",
      "cite_metrics",
      "cite_limitations",
      "emit_data_sufficiency",
    ]);

    expect(SCENARIO_TEMPLATE_HUMAN_REVIEW_TRIGGERS).toEqual([
      "missing_required_flow_zone",
      "missing_required_assumption",
      "missing_route_input",
      "missing_connector_graph",
      "navmesh_dependency_review",
      "single_seed_sensitive_scenario",
      "professional_review_required",
      "unsupported_v0_request",
    ]);
  });

  it("parses a reusable bar queue template without implying a simulator exists", () => {
    expect(ScenarioTemplateV0Schema.parse(BAR_QUEUE_TEMPLATE)).toEqual(BAR_QUEUE_TEMPLATE);
  });

  it("requires bar queue templates to declare queue and wait-service zones", () => {
    expect(ScenarioTemplateV0Schema.safeParse({
      ...BAR_QUEUE_TEMPLATE,
      requiredFlowZones: BAR_QUEUE_TEMPLATE.requiredFlowZones.filter(
        (requirement) => requirement.zoneKind !== "wait_service",
      ),
    }).success).toBe(false);
  });

  it("requires connector and navmesh route inputs to declare review behavior", () => {
    expect(ScenarioTemplateV0Schema.safeParse({
      ...BAR_QUEUE_TEMPLATE,
      routeInputRequirement: "connector_graph",
      humanReviewTriggers: ["missing_required_flow_zone"],
    }).success).toBe(false);

    expect(ScenarioTemplateV0Schema.safeParse({
      ...BAR_QUEUE_TEMPLATE,
      routeInputRequirement: "navmesh_research_only",
      humanReviewTriggers: ["missing_connector_graph", "navmesh_dependency_review"],
    }).success).toBe(true);

    expect(ScenarioTemplateV0Schema.safeParse({
      ...BAR_QUEUE_TEMPLATE,
      routeInputRequirement: "unsupported_in_v0",
      humanReviewTriggers: ["unsupported_v0_request"],
    }).success).toBe(true);
  });

  it("rejects one-off instance fields and status substitutions", () => {
    expect(ScenarioTemplateV0Schema.safeParse({
      ...BAR_QUEUE_TEMPLATE,
      scenarioInstanceId: "wedding_160_arrival_seed_03",
    }).success).toBe(false);

    expect(CrowdFlowScenarioTypeSchema.safeParse("emergency_evacuation_research_track").success)
      .toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("bar_queue").success).toBe(false);
    expect(FlowZoneKindSchema.safeParse("bar_queue").success).toBe(false);
    expect(AssumptionCategorySchema.safeParse("bar_queue").success).toBe(false);
  });

  it("uses metadata-only string vocabularies", () => {
    const vocabularies = [
      SCENARIO_TEMPLATE_GEOMETRY_CLASSES,
      SCENARIO_TEMPLATE_ROUTE_INPUT_REQUIREMENTS,
      SCENARIO_TEMPLATE_ENDPOINT_SEMANTICS,
      SCENARIO_TEMPLATE_MEASUREMENT_UNITS,
      SCENARIO_TEMPLATE_WITNESS_INTEGRATION_RULES,
      SCENARIO_TEMPLATE_HUMAN_REVIEW_TRIGGERS,
    ] as const;

    for (const vocabulary of vocabularies) {
      expect(vocabulary.every((value) => typeof value === "string")).toBe(true);
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }

    for (const value of SCENARIO_TEMPLATE_GEOMETRY_CLASSES) {
      expect(ScenarioTemplateGeometryClassSchema.safeParse(value).success).toBe(true);
    }

    for (const value of SCENARIO_TEMPLATE_ROUTE_INPUT_REQUIREMENTS) {
      expect(ScenarioTemplateRouteInputRequirementSchema.safeParse(value).success).toBe(true);
    }

    for (const value of SCENARIO_TEMPLATE_ENDPOINT_SEMANTICS) {
      expect(ScenarioTemplateEndpointSemanticSchema.safeParse(value).success).toBe(true);
    }

    for (const value of SCENARIO_TEMPLATE_MEASUREMENT_UNITS) {
      expect(ScenarioTemplateMeasurementUnitSchema.safeParse(value).success).toBe(true);
    }

    for (const value of SCENARIO_TEMPLATE_WITNESS_INTEGRATION_RULES) {
      expect(ScenarioTemplateWitnessIntegrationRuleSchema.safeParse(value).success).toBe(true);
    }

    for (const value of SCENARIO_TEMPLATE_HUMAN_REVIEW_TRIGGERS) {
      expect(ScenarioTemplateHumanReviewTriggerSchema.safeParse(value).success).toBe(true);
    }
  });
});
