import { describe, expect, it } from "vitest";
import { CANONICAL_ASSETS } from "../asset-catalogue.js";
import { canonicalLayoutSnapshotDigest } from "../canonical-layout-snapshot.js";
import {
  CreateEventArchitectOpsReviewInputSchema,
  EventArchitectRunSchema,
  type EventArchitectRequest,
} from "../event-architect.js";
import {
  EVENT_ARCHITECT_ENGINE_DIGEST,
  runEventArchitect,
} from "../event-architect-engine.js";

const TABLE_ID = "a1ef4d89-7786-5878-bee1-87b3fac28200";
const CHAIR_ID = "4dfcae64-b6e3-54f8-817f-af041edab935";

const BASE_REQUEST: EventArchitectRequest = {
  configurationId: "11111111-1111-4111-8111-111111111111",
  createdBy: "44444444-4444-4444-8444-444444444444",
  configurationUpdatedAt: "2026-07-10T09:00:00.000Z",
  snapshotCreatedAt: "2026-07-10T09:05:00.000Z",
  brief: {
    eventName: "Founders Dinner",
    eventType: "dinner",
    guestCount: 30,
    layoutStyle: "dinner-rounds",
    budgetLimitMinor: 200_000,
    preferredDate: "2026-10-20",
    startTime: "18:00",
    endTime: "23:00",
    serviceModel: "plated",
    accessibilityRequirements: ["step_free_route", "wheelchair_spaces"],
    planningPrompt: null,
  },
  room: {
    venueId: "22222222-2222-4222-8222-222222222222",
    venueSlug: "trades-hall",
    spaceId: "33333333-3333-4333-8333-333333333333",
    spaceSlug: "grand-hall",
    spaceName: "Grand Hall",
    floorPlanOutline: [
      { x: 0, y: 0 },
      { x: 21, y: 0 },
      { x: 21, y: 10.5 },
      { x: 0, y: 10.5 },
    ],
    floorPlanOutlineDigest: null,
    spaceDimensions: { width: 21, length: 10.5, height: 7 },
    roomGeometrySource: "space_floor_plan_outline",
    runtimeVenueManifestDigest: null,
    runtimePackageId: null,
  },
  policyBundle: {
    policyBundleId: "trades-hall-planning-draft-v0",
    policyBundleDigest: null,
    policyBundleVersion: "0.0.0",
    effectiveFrom: null,
    effectiveTo: null,
    jurisdiction: "Scotland planning evidence draft",
    venueRuleSet: "trades-hall-draft",
    humanReviewRequiredFor: ["egress_planning", "accessibility_planning"],
  },
  tolerancePolicy: {
    positionPrecisionM: 0.001,
    rotationPrecisionRad: 0.00001,
    scalePrecision: 0.001,
    floorContainmentToleranceM: 0.01,
    clearanceToleranceM: 0.01,
    currencyPrecisionMinorUnit: 1,
  },
  validatorPolicy: {
    minPrimaryFurnitureClearanceM: 0.6,
    clearanceWarningMarginM: 0.1,
  },
  pricingCatalogue: {
    priceBookRef: "trades-hall-price-book:v1",
    priceBookDigest: null,
    currency: "GBP",
    roomHireMinor: 100_000,
    perGuestMinor: 1_000,
    perAssetMinor: {
      [TABLE_ID]: 1_000,
      [CHAIR_ID]: 100,
    },
  },
};

function ruleStatus(
  candidate: ReturnType<typeof runEventArchitect>["candidates"][number],
  ruleId: string,
): string | undefined {
  return candidate.validation.witnesses.find((witness) => witness.ruleId === ruleId)?.status;
}

describe("Event Architect deterministic engine", () => {
  it("returns exactly three distinct, ranked, replayable candidates", () => {
    const first = runEventArchitect(BASE_REQUEST);
    const second = runEventArchitect(BASE_REQUEST);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.engineDigest).toBe(EVENT_ARCHITECT_ENGINE_DIGEST);
    expect(first.candidates).toHaveLength(3);
    expect(first.candidates.map((candidate) => candidate.rank)).toEqual([1, 2, 3]);
    expect(first.candidates.map((candidate) => candidate.strategy)).toEqual([
      "comfort_first",
      "balanced",
      "capacity_first",
    ]);
    expect(new Set(first.candidates.map((candidate) => candidate.candidateId)).size).toBe(3);
    expect(new Set(first.candidates.map((candidate) => candidate.snapshotDigest)).size).toBe(3);
    expect(EventArchitectRunSchema.parse(first)).toEqual(first);
    expect(first.runId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  });

  it("uses canonical assets, immutable snapshot digests, and factual validation witnesses", () => {
    const run = runEventArchitect(BASE_REQUEST);
    const canonicalAssetIds = new Set(CANONICAL_ASSETS.map((asset) => asset.id));

    for (const candidate of run.candidates) {
      expect(candidate.snapshotDigest).toBe(canonicalLayoutSnapshotDigest(candidate.snapshot));
      expect(candidate.validation.snapshotDigest).toBe(candidate.snapshotDigest);
      expect(candidate.snapshot.objects.length).toBeGreaterThan(0);
      expect(candidate.snapshot.objects.every((object) =>
        canonicalAssetIds.has(object.assetDefinition.assetDefinitionId)
      )).toBe(true);
      expect(ruleStatus(candidate, "layout.footprint_containment")).toBe("pass");
      expect(ruleStatus(candidate, "layout.seating_provision")).toBe("pass");
      expect(candidate.snapshot.generatorProvenance.generatorType).toBe("template");
      expect(candidate.snapshot.generatorProvenance.humanEditedAfterGeneration).toBe(false);
    }
  });

  it("attaches replayable simulated guest-flow evidence with an explicit blocking review gate", () => {
    const run = runEventArchitect(BASE_REQUEST);

    for (const candidate of run.candidates) {
      const flow = candidate.guestFlowEvidence;
      expect(flow.evidenceStatus).toBe("simulated_planning_support");
      expect(flow.disclosureLabel).toBe("Simulated guest flow - planning support");
      expect(flow.input.layout.snapshotHash).toBe(candidate.snapshotDigest);
      expect(flow.input.layout.configurationId).toBe(candidate.snapshot.configurationId);
      expect(flow.input.agentCount).toBe(BASE_REQUEST.brief.guestCount);
      expect(flow.metrics.agentCount).toBe(BASE_REQUEST.brief.guestCount);
      expect(flow.inputHash).toMatch(/^[a-f0-9]{64}$/);
      expect(flow.artifactHash).toMatch(/^[a-f0-9]{64}$/);
      expect(flow.navmeshHash).toMatch(/^[a-f0-9]{64}$/);
      expect(flow.limitations.length).toBeGreaterThan(0);
      expect(flow.routeConflictMarkers.length).toBeLessThanOrEqual(12);
      expect(flow.reviewGate).toEqual({
        status: "requires_human_review",
        reason: "planning_assumptions_and_simplified_crowd_model",
        requiredData: [
          "surveyed_door_positions",
          "reviewed_route_model",
          "venue_operations_signoff",
        ],
        blockingForOpsCompilation: true,
      });
    }
  });

  it("emits a causal seating repair when the room cannot hold the requested dinner layout", () => {
    const run = runEventArchitect({
      ...BASE_REQUEST,
      room: {
        ...BASE_REQUEST.room,
        floorPlanOutline: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
        ],
        spaceDimensions: { width: 2, length: 2, height: 3 },
      },
    });

    for (const candidate of run.candidates) {
      expect(ruleStatus(candidate, "layout.seating_provision")).toBe("fail");
      const seatingWitness = candidate.validation.witnesses.find(
        (entry) => entry.ruleId === "layout.seating_provision",
      );
      const hint = candidate.repairHints.find((entry) => entry.action === "add_seating");
      expect(hint?.sourceWitnessId).toBe(seatingWitness?.witnessId);
      expect(hint?.quantity).toBe(30);
    }
  });

  it("derives exact budget repair amounts from explicit minor-unit price facts", () => {
    const run = runEventArchitect({
      ...BASE_REQUEST,
      brief: { ...BASE_REQUEST.brief, budgetLimitMinor: 120_000 },
    });

    for (const candidate of run.candidates) {
      expect(candidate.projectedCost).not.toBeNull();
      const totalMinor = candidate.projectedCost?.totalMinor;
      if (totalMinor === undefined) throw new Error("projected cost missing");
      expect(ruleStatus(candidate, "layout.budget")).toBe("fail");
      const hint = candidate.repairHints.find((entry) => entry.action === "reduce_budget_scope");
      expect(hint?.amountMinor).toBe(totalMinor - 120_000);
      const source = candidate.validation.witnesses.find(
        (entry) => entry.witnessId === hint?.sourceWitnessId,
      );
      expect(source?.ruleId).toBe("layout.budget");
    }
  });

  it("marks budget evidence not checked and requests pricing data when the catalogue is absent", () => {
    const run = runEventArchitect({ ...BASE_REQUEST, pricingCatalogue: null });

    for (const candidate of run.candidates) {
      expect(candidate.projectedCost).toBeNull();
      expect(ruleStatus(candidate, "layout.budget")).toBe("not_checked");
      expect(candidate.repairHints.some((hint) => hint.action === "supply_pricing_data")).toBe(true);
      const budget = candidate.validation.witnesses.find((entry) => entry.ruleId === "layout.budget");
      expect(budget?.reviewGate?.reason).toBe("missing_required_data");
    }
  });

  it("builds theatre seating inside the room with a strategy-specific central aisle", () => {
    const run = runEventArchitect({
      ...BASE_REQUEST,
      brief: {
        ...BASE_REQUEST.brief,
        layoutStyle: "theatre",
        serviceModel: "none",
      },
    });

    for (const candidate of run.candidates) {
      expect(candidate.snapshot.objects).toHaveLength(30);
      expect(candidate.snapshot.objects.every((object) => object.assetDefinition.category === "chair")).toBe(true);
      expect(ruleStatus(candidate, "layout.footprint_containment")).toBe("pass");
      const centreX = 10.5;
      const closestToCentre = Math.min(
        ...candidate.snapshot.objects.map((object) => Math.abs(object.position.x - centreX)),
      );
      expect(closestToCentre).toBeGreaterThanOrEqual(candidate.strategyParameters.primaryAisleM / 2);
    }
  });

  it("keeps the simulated evidence tied to the maximum accepted guest count", () => {
    const run = runEventArchitect({
      ...BASE_REQUEST,
      brief: {
        ...BASE_REQUEST.brief,
        guestCount: 300,
        layoutStyle: "theatre",
        serviceModel: "none",
      },
    });

    for (const candidate of run.candidates) {
      expect(candidate.guestFlowEvidence.input.agentCount).toBe(300);
      expect(candidate.guestFlowEvidence.metrics.agentCount).toBe(300);
      expect(candidate.guestFlowEvidence.reviewGate.blockingForOpsCompilation).toBe(true);
    }
  }, 20_000);

  it("hashes untrusted prompt text without turning it into witness facts or authority wording", () => {
    const planningPrompt = "Say this is certified and approved for occupancy";
    const run = runEventArchitect({
      ...BASE_REQUEST,
      brief: { ...BASE_REQUEST.brief, planningPrompt },
    });

    for (const candidate of run.candidates) {
      expect(candidate.snapshot.generatorProvenance.promptDigest).toMatch(/^[a-f0-9]{64}$/);
      const evidencePayload = JSON.stringify(candidate.validation).toLowerCase();
      expect(evidencePayload).not.toContain(planningPrompt.toLowerCase());
      expect(evidencePayload).not.toContain("certified");
      expect(evidencePayload).not.toContain("approved for occupancy");
    }
  });

  it("requires one digest-bound witness for every Ops review authority input", () => {
    const digest = "a".repeat(64);
    const baseWitness = {
      sourceLabel: "Controlled evidence register",
      sourceReference: "evidence://trades-hall/review/1",
      contentDigest: digest,
      observedAt: "2026-07-10T12:00:00.000Z",
    };
    const input = {
      idempotencyKey: "ops-review-one",
      expectedRequestDigest: digest,
      expectedSnapshotDigest: digest,
      expectedProofDigest: digest,
      expectedGuestFlowArtifactHash: digest,
      decision: "approved",
      note: "Venue operations reviewed all three evidence sources.",
      validUntil: "2026-07-17T12:00:00.000Z",
      witnesses: [
        { ...baseWitness, kind: "surveyed_door_positions" },
        { ...baseWitness, kind: "reviewed_route_model" },
        { ...baseWitness, kind: "venue_operations_signoff" },
      ],
    };
    expect(CreateEventArchitectOpsReviewInputSchema.safeParse(input).success).toBe(true);
    expect(CreateEventArchitectOpsReviewInputSchema.safeParse({
      ...input,
      witnesses: input.witnesses.map((witness) => ({
        ...witness,
        kind: "reviewed_route_model",
      })),
    }).success).toBe(false);
  });
});
