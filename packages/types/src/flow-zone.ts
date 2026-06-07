import { z } from "zod";

export const FLOW_ZONE_KINDS = [
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
] as const;
export const FlowZoneKindSchema = z.enum(FLOW_ZONE_KINDS);
export type FlowZoneKind = z.infer<typeof FlowZoneKindSchema>;

export const FLOW_ZONE_CUSTOMER_VISIBILITY_LEVELS = [
  "customer_visible",
  "customer_summary",
  "expert_or_debug_only",
  "staff_or_hallkeeper_only",
  "internal_only",
] as const;
export const FlowZoneCustomerVisibilitySchema = z.enum(FLOW_ZONE_CUSTOMER_VISIBILITY_LEVELS);
export type FlowZoneCustomerVisibility = z.infer<typeof FlowZoneCustomerVisibilitySchema>;

export const FLOW_ZONE_CONSUMERS = [
  "operational_geometry_compiler",
  "validator_kernel",
  "guest_flow_replay",
  "layout_evidence_pack",
  "event_ops_compiler",
  "hallkeeper_sheet",
  "truth_mode",
  "venreplay_bundle",
  "scotland_policy_bundle",
] as const;
export const FlowZoneConsumerSchema = z.enum(FLOW_ZONE_CONSUMERS);
export type FlowZoneConsumer = z.infer<typeof FlowZoneConsumerSchema>;

export const FLOW_ZONE_KIND_CUSTOMER_VISIBILITY = {
  room: "customer_visible",
  obstacle: "customer_summary",
  door: "customer_summary",
  portal: "expert_or_debug_only",
  queue: "customer_visible",
  spawn: "expert_or_debug_only",
  goal: "customer_summary",
  wait_service: "customer_summary",
  staff_only: "staff_or_hallkeeper_only",
  supplier_load_in: "staff_or_hallkeeper_only",
  wheelchair_route: "customer_summary",
  holding_area: "customer_summary",
} as const satisfies Record<FlowZoneKind, FlowZoneCustomerVisibility>;

export const FLOW_ZONE_KIND_CONSUMERS = {
  room: [
    "operational_geometry_compiler",
    "validator_kernel",
    "guest_flow_replay",
    "layout_evidence_pack",
    "event_ops_compiler",
  ],
  obstacle: [
    "operational_geometry_compiler",
    "validator_kernel",
    "guest_flow_replay",
    "hallkeeper_sheet",
  ],
  door: [
    "operational_geometry_compiler",
    "validator_kernel",
    "guest_flow_replay",
    "layout_evidence_pack",
    "scotland_policy_bundle",
  ],
  portal: [
    "operational_geometry_compiler",
    "validator_kernel",
    "guest_flow_replay",
    "venreplay_bundle",
  ],
  queue: [
    "guest_flow_replay",
    "event_ops_compiler",
    "layout_evidence_pack",
    "hallkeeper_sheet",
  ],
  spawn: ["guest_flow_replay", "venreplay_bundle", "layout_evidence_pack"],
  goal: ["guest_flow_replay", "venreplay_bundle", "layout_evidence_pack"],
  wait_service: [
    "guest_flow_replay",
    "event_ops_compiler",
    "layout_evidence_pack",
    "hallkeeper_sheet",
  ],
  staff_only: [
    "event_ops_compiler",
    "hallkeeper_sheet",
    "guest_flow_replay",
    "validator_kernel",
  ],
  supplier_load_in: [
    "event_ops_compiler",
    "hallkeeper_sheet",
    "guest_flow_replay",
    "layout_evidence_pack",
  ],
  wheelchair_route: [
    "validator_kernel",
    "layout_evidence_pack",
    "truth_mode",
    "guest_flow_replay",
    "scotland_policy_bundle",
  ],
  holding_area: ["guest_flow_replay", "event_ops_compiler", "hallkeeper_sheet"],
} as const satisfies Record<FlowZoneKind, readonly FlowZoneConsumer[]>;
