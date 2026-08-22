import { TRADES_HALL_ENQUIRY_VENUE_SLUG } from "@omnitwin/types";
import type { CockpitLayerMode } from "./cockpit-modes.js";

export interface PlannerRoomKey {
  readonly spaceId: string;
  readonly venueId: string;
  readonly roomSlug: string;
}

export type PlannerRoomIdentity =
  | (PlannerRoomKey & {
    readonly status: "pending" | "unavailable";
    readonly venueSlug: null;
  })
  | (PlannerRoomKey & {
    readonly status: "resolved";
    readonly venueSlug: string;
  });

export type PlannerLayerPolicyKind =
  | "identity-pending"
  | "identity-unavailable"
  | "captured-only"
  | "configurable";

export interface PlannerLayerPolicyInput {
  readonly currentRoom: PlannerRoomKey | null;
  readonly roomIdentity: PlannerRoomIdentity | null;
  readonly requestedMode: CockpitLayerMode;
}

export interface PlannerLayerPolicy {
  readonly kind: PlannerLayerPolicyKind;
  readonly effectiveMode: CockpitLayerMode;
  readonly controlsLocked: boolean;
}

export type PlannerArchitectureSource =
  | "captured"
  | "procedural"
  | "hybrid"
  | "unavailable";

export interface PlannerLayerCompositionInput {
  readonly policy: PlannerLayerPolicy;
  readonly hasCapturedAsset: boolean;
}

export interface PlannerLayerComposition {
  readonly architecture: PlannerArchitectureSource;
  readonly renderCapturedArchitecture: boolean;
  readonly renderProceduralArchitecture: boolean;
  readonly renderArchitecturalInk: boolean;
  /**
   * Metric furniture, paths, and measurement tools require a reviewed
   * room-local transform and non-rendering collision surface. They stay off
   * for source-only Grand Hall inspection so authored content cannot be
   * mistaken for captured room evidence.
   */
  readonly renderPlanningOverlays: boolean;
}

/**
 * Operational geometry is available only after the current room identity has
 * resolved to the ordinary configurable policy. Pending/unavailable identity
 * and capture-authoritative Grand Hall inspection all fail closed so generic
 * dimensions, furniture, and simulations cannot imply a reviewed alignment.
 */
export function plannerAllowsOperationalGeometry(policy: PlannerLayerPolicy): boolean {
  return policy.kind === "configurable";
}

const GRAND_HALL_SLUG = "grand-hall";

const CAPTURED_ONLY_COMPOSITION: PlannerLayerComposition = {
  architecture: "captured",
  renderCapturedArchitecture: true,
  renderProceduralArchitecture: false,
  renderArchitecturalInk: false,
  renderPlanningOverlays: false,
};

const UNAVAILABLE_COMPOSITION: PlannerLayerComposition = {
  architecture: "unavailable",
  renderCapturedArchitecture: false,
  renderProceduralArchitecture: false,
  renderArchitecturalInk: false,
  renderPlanningOverlays: false,
};

function roomIdentityMatches(
  currentRoom: PlannerRoomKey,
  roomIdentity: PlannerRoomIdentity,
): boolean {
  return currentRoom.spaceId === roomIdentity.spaceId
    && currentRoom.venueId === roomIdentity.venueId
    && currentRoom.roomSlug === roomIdentity.roomSlug;
}

/**
 * Resolves the visual-layer control policy from a room identity verified by
 * the venue API. The full room key is compared so a prior room's async result
 * cannot authorize or lock the room currently on screen.
 */
export function resolvePlannerLayerPolicy({
  currentRoom,
  roomIdentity,
  requestedMode,
}: PlannerLayerPolicyInput): PlannerLayerPolicy {
  if (
    currentRoom === null
    || roomIdentity === null
    || !roomIdentityMatches(currentRoom, roomIdentity)
    || roomIdentity.status === "pending"
  ) {
    return {
      kind: "identity-pending",
      effectiveMode: requestedMode,
      controlsLocked: true,
    };
  }

  if (roomIdentity.status === "unavailable") {
    return {
      kind: "identity-unavailable",
      effectiveMode: requestedMode,
      controlsLocked: true,
    };
  }

  if (
    roomIdentity.venueSlug === TRADES_HALL_ENQUIRY_VENUE_SLUG
    && roomIdentity.roomSlug === GRAND_HALL_SLUG
  ) {
    return {
      kind: "captured-only",
      effectiveMode: "splat",
      controlsLocked: true,
    };
  }

  return {
    kind: "configurable",
    effectiveMode: requestedMode,
    controlsLocked: false,
  };
}

/**
 * Resolves which architecture sources may contribute pixels to the planner.
 *
 * Only the venue-verified Trades Hall Grand Hall is capture-authoritative:
 * controls cannot substitute or blend generated architecture, and a missing
 * capture fails closed. Pending or failed identity also fails closed. Every
 * other verified room retains the existing Mesh / Splat / Hybrid behaviour.
 */
export function resolvePlannerLayerComposition({
  policy,
  hasCapturedAsset,
}: PlannerLayerCompositionInput): PlannerLayerComposition {
  if (policy.kind === "identity-pending" || policy.kind === "identity-unavailable") {
    return UNAVAILABLE_COMPOSITION;
  }

  if (policy.kind === "captured-only") {
    return hasCapturedAsset ? CAPTURED_ONLY_COMPOSITION : UNAVAILABLE_COMPOSITION;
  }

  const renderCapturedArchitecture =
    hasCapturedAsset && policy.effectiveMode !== "mesh";
  const renderProceduralArchitecture =
    !hasCapturedAsset || policy.effectiveMode !== "splat";

  return {
    architecture: renderCapturedArchitecture
      ? renderProceduralArchitecture
        ? "hybrid"
        : "captured"
      : "procedural",
    renderCapturedArchitecture,
    renderProceduralArchitecture,
    renderArchitecturalInk: true,
    renderPlanningOverlays: true,
  };
}
