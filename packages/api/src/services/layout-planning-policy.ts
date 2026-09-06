import {
  sha256Hex,
  stableCanonicalJson,
  type CanonicalJsonValue,
  type LayoutSnapshotPolicyBundleReference,
  type LayoutSnapshotTolerancePolicy,
  type LayoutValidatorContext,
} from "@omnitwin/types";

const POLICY_DEFINITION: CanonicalJsonValue = {
  policyBundleId: "venviewer.internal-planning-policy.v0",
  policyBundleVersion: "0.1.0",
  minPrimaryFurnitureClearanceM: 1.2,
  clearanceWarningMarginM: 0.2,
  status: "internal_planning_defaults_requires_human_review",
  humanReviewRequiredFor: [
    "accessibility route",
    "door and obstruction state",
    "egress route",
    "guest-flow simulation",
    "pricing approval",
  ],
};

export const PLANNING_POLICY_DIGEST = sha256Hex(stableCanonicalJson(POLICY_DEFINITION));

export function planningPolicyBundle(): LayoutSnapshotPolicyBundleReference {
  return {
    policyBundleId: "venviewer.internal-planning-policy.v0",
    policyBundleDigest: PLANNING_POLICY_DIGEST,
    policyBundleVersion: "0.1.0",
    effectiveFrom: null,
    effectiveTo: null,
    jurisdiction: "Internal venue planning context",
    venueRuleSet: "Venviewer conservative planning defaults v0",
    humanReviewRequiredFor: [
      "accessibility route", "door and obstruction state", "egress route",
      "guest-flow simulation", "pricing approval",
    ],
  };
}

export function planningTolerancePolicy(): LayoutSnapshotTolerancePolicy {
  return {
    positionPrecisionM: 0.001,
    rotationPrecisionRad: 0.00001,
    scalePrecision: 0.001,
    floorContainmentToleranceM: 0.01,
    clearanceToleranceM: 0.01,
    currencyPrecisionMinorUnit: 1,
  };
}

export function planningValidatorContext(): LayoutValidatorContext {
  return {
    policyBundleId: "venviewer.internal-planning-policy.v0",
    policyBundleDigest: PLANNING_POLICY_DIGEST,
    policyBundleVersion: "0.1.0",
    minPrimaryFurnitureClearanceM: 1.2,
    clearanceWarningMarginM: 0.2,
    // No versioned, asset-complete price book: retain not_checked/review gates.
    pricing: null,
  };
}
