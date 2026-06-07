import { describe, expect, it } from "vitest";
import {
  CROWD_FLOW_SCENARIO_TYPES,
  CrowdFlowScenarioTypeSchema,
} from "../crowd-simulation-replay.js";
import { LayoutProofClaimStatusSchema } from "../layout-proof-object.js";
import {
  FLOW_ZONE_CONSUMERS,
  FLOW_ZONE_CUSTOMER_VISIBILITY_LEVELS,
  FLOW_ZONE_KINDS,
  FLOW_ZONE_KIND_CONSUMERS,
  FLOW_ZONE_KIND_CUSTOMER_VISIBILITY,
  FlowZoneConsumerSchema,
  FlowZoneCustomerVisibilitySchema,
  FlowZoneKindSchema,
} from "../flow-zone.js";

describe("Flow Zone vocabulary", () => {
  it("pins initial flow zone kinds from FZAL-001", () => {
    expect(FLOW_ZONE_KINDS).toEqual([
      "room",
      "obstacle",
      "door",
      "portal",
      "queue",
      "spawn",
      "goal",
      "wait_service",
      "staff_only",
      "supplier_load_in",
      "wheelchair_route",
      "holding_area",
    ]);

    for (const kind of FLOW_ZONE_KINDS) {
      expect(FlowZoneKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("pins customer visibility levels", () => {
    expect(FLOW_ZONE_CUSTOMER_VISIBILITY_LEVELS).toEqual([
      "customer_visible",
      "customer_summary",
      "expert_or_debug_only",
      "staff_or_hallkeeper_only",
      "internal_only",
    ]);

    for (const level of FLOW_ZONE_CUSTOMER_VISIBILITY_LEVELS) {
      expect(FlowZoneCustomerVisibilitySchema.safeParse(level).success).toBe(true);
    }
  });

  it("pins downstream consumer classifications", () => {
    expect(FLOW_ZONE_CONSUMERS).toEqual([
      "operational_geometry_compiler",
      "validator_kernel",
      "guest_flow_replay",
      "layout_evidence_pack",
      "event_ops_compiler",
      "hallkeeper_sheet",
      "truth_mode",
      "venreplay_bundle",
      "scotland_policy_bundle",
    ]);

    for (const consumer of FLOW_ZONE_CONSUMERS) {
      expect(FlowZoneConsumerSchema.safeParse(consumer).success).toBe(true);
    }
  });

  it("maps every zone kind to a customer visibility level", () => {
    expect(Object.keys(FLOW_ZONE_KIND_CUSTOMER_VISIBILITY).sort()).toEqual([...FLOW_ZONE_KINDS].sort());

    for (const kind of FLOW_ZONE_KINDS) {
      expect(
        FlowZoneCustomerVisibilitySchema.safeParse(FLOW_ZONE_KIND_CUSTOMER_VISIBILITY[kind]).success,
      ).toBe(true);
    }
  });

  it("maps every zone kind to at least one known consumer", () => {
    expect(Object.keys(FLOW_ZONE_KIND_CONSUMERS).sort()).toEqual([...FLOW_ZONE_KINDS].sort());

    for (const kind of FLOW_ZONE_KINDS) {
      const consumers = FLOW_ZONE_KIND_CONSUMERS[kind];
      expect(consumers.length).toBeGreaterThan(0);

      for (const consumer of consumers) {
        expect(FlowZoneConsumerSchema.safeParse(consumer).success).toBe(true);
      }
    }
  });

  it("keeps zone kinds separate from verdict statuses and scenario labels where names differ", () => {
    expect(FlowZoneKindSchema.safeParse("pass").success).toBe(false);
    expect(FlowZoneKindSchema.safeParse("fail").success).toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("queue").success).toBe(false);
    expect(FlowZoneKindSchema.safeParse("bar_queue").success).toBe(false);
    expect(CrowdFlowScenarioTypeSchema.safeParse("queue").success).toBe(false);
    expect(CROWD_FLOW_SCENARIO_TYPES.includes("bar_queue")).toBe(true);
  });

  it("uses metadata-only string vocabularies", () => {
    const vocabularies = [
      FLOW_ZONE_KINDS,
      FLOW_ZONE_CUSTOMER_VISIBILITY_LEVELS,
      FLOW_ZONE_CONSUMERS,
    ] as const;

    for (const vocabulary of vocabularies) {
      expect(vocabulary.every((value) => typeof value === "string")).toBe(true);
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }
  });
});
