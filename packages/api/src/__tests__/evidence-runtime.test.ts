import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  AssumptionRecordSchema,
  CheckResultSchema,
  EvidenceItemSchema,
  ReviewGateSchema,
  type ConfigurationSheetSnapshot,
} from "@omnitwin/types";
import {
  buildEvidencePackPayload,
  buildTruthModeSummary,
} from "../services/evidence-runtime.js";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const CONFIG_ID = "00000000-0000-4000-8000-000000000101";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000102";
const USER_ID = "00000000-0000-4000-8000-000000000103";
const EVIDENCE_ITEM_ID = "00000000-0000-4000-8000-000000000104";
const CHECK_RESULT_ID = "00000000-0000-4000-8000-000000000105";
const ASSUMPTION_ID = "00000000-0000-4000-8000-000000000106";
const REVIEW_GATE_ID = "00000000-0000-4000-8000-000000000107";
const NOW = "2026-06-11T10:00:00.000Z";
const SNAPSHOT_HASH = "b".repeat(64);

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

function adminToken(): string {
  return signToken({
    id: USER_ID,
    email: "admin@test.com",
    role: "admin",
    venueId: "00000000-0000-4000-8000-000000000001",
  });
}

function approvedSnapshot(): ConfigurationSheetSnapshot {
  return {
    id: SNAPSHOT_ID,
    configurationId: CONFIG_ID,
    version: 4,
    payload: {
      config: {
        id: CONFIG_ID,
        name: "Dinner layout",
        guestCount: 120,
        layoutStyle: "dinner-rounds",
      },
      venue: {
        name: "Trades Hall Glasgow",
        address: "85 Glassford Street, Glasgow G1 1UH",
        timezone: "Europe/London",
      },
      space: {
        name: "Grand Hall",
        widthM: 21,
        lengthM: 10.5,
        heightM: 7,
      },
      timing: null,
      instructions: null,
      phases: [],
      totals: {
        entries: [],
        totalRows: 12,
        totalItems: 120,
      },
      diagramUrl: null,
      webViewUrl: "https://example.test/hallkeeper/configuration",
      generatedAt: NOW,
      approval: {
        version: 4,
        approvedAt: NOW,
        approverName: "Venue reviewer",
      },
    },
    diagramUrl: null,
    pdfUrl: null,
    sourceHash: SNAPSHOT_HASH,
    createdAt: NOW,
    createdBy: USER_ID,
    approvedAt: NOW,
    approvedBy: USER_ID,
  };
}

beforeAll(async () => {
  server = await buildServer();
});

afterAll(async () => {
  await server.close();
});

describe("evidence runtime services", () => {
  it("generates a v0 evidence payload from an approved snapshot without unsafe claims", () => {
    const payload = buildEvidencePackPayload({
      snapshot: approvedSnapshot(),
      runtimePackage: null,
    });

    expect(payload.snapshotHash).toBe(SNAPSHOT_HASH);
    expect(payload.layoutCount).toBe(12);
    expect(payload.capacityResult.status).toBe("requires_review");
    expect(payload.routeClearanceResult.status).toBe("not_checked");
    expect(payload.runtimeAssetStatus.status).toBe("missing");
    expect(payload.assumptions.map((item) => item.assumptionType)).toEqual([
      "guest_count",
      "layout_count",
      "route_clearance",
    ]);
    expect(payload.reviewGates.map((gate) => gate.gateType)).toContain("human_review_required");
    expect(payload.safeWording.join(" ")).toContain("Planning evidence");
    expect(payload.humanReviewRequired).toBe(true);
  });

  it("summarises selection evidence with stale and review state visible", () => {
    const item = EvidenceItemSchema.parse({
      id: EVIDENCE_ITEM_ID,
      configId: CONFIG_ID,
      targetType: "table",
      targetId: "table-12",
      itemType: "capacity_result",
      sourceType: "system_generated",
      sourceLabel: "Evidence generator v0",
      confidence: "low",
      status: "partial",
      staleState: "review_due",
      wording: "Capacity is planning evidence and requires human review.",
      metadata: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const check = CheckResultSchema.parse({
      id: CHECK_RESULT_ID,
      evidenceItemId: EVIDENCE_ITEM_ID,
      configId: CONFIG_ID,
      targetType: "table",
      targetId: "table-12",
      checkType: "capacity",
      status: "requires_review",
      severity: "warning",
      message: "Capacity is planning evidence and requires human review.",
      measuredValue: 120,
      thresholdValue: null,
      unit: "guests",
      sourceLabel: "Frozen layout snapshot",
      createdAt: NOW,
    });
    const assumption = AssumptionRecordSchema.parse({
      id: ASSUMPTION_ID,
      configId: CONFIG_ID,
      targetType: "table",
      targetId: "table-12",
      assumptionType: "guest_count",
      value: 120,
      sourceLabel: "Frozen layout snapshot",
      status: "active",
      createdAt: NOW,
    });
    const gate = ReviewGateSchema.parse({
      id: REVIEW_GATE_ID,
      configId: CONFIG_ID,
      targetType: "table",
      targetId: "table-12",
      gateType: "human_review_required",
      status: "open",
      title: "Human review required",
      description: "This table evidence needs a venue review before operational use.",
      requiredRole: "venue_staff",
      decisionBy: null,
      decisionAt: null,
      decisionNote: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const summary = buildTruthModeSummary({
      targetType: "table",
      targetId: "table-12",
      evidenceItems: [item],
      checkResults: [check],
      assumptions: [assumption],
      reviewGates: [gate],
      staleEventCount: 1,
    });

    expect(summary.evidenceStatus).toBe("partial");
    expect(summary.staleState).toBe("review_due");
    expect(summary.humanReviewRequired).toBe(true);
    expect(summary.counts.reviewGates).toBe(1);
  });
});

describe("evidence runtime routes", () => {
  it("requires auth before generating an evidence pack", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/evidence-packs/from-configuration/${CONFIG_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("validates evidence pack configuration IDs before database access", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/evidence-packs/from-configuration/not-a-uuid",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects open review-gate decisions before database access", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/review-gates/${REVIEW_GATE_ID}/decision`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: "open" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("validates Truth Mode targets before database access", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/truth-mode/summary?targetType=fire&targetId=table-12",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("mounts the requested route prefixes", async () => {
    const source = await readFile(resolve("src/index.ts"), "utf-8");
    expect(source).toContain('prefix: "/evidence-packs"');
    expect(source).toContain('prefix: "/evidence"');
    expect(source).toContain('prefix: "/review-gates"');
    expect(source).toContain('prefix: "/truth-mode"');
  });

  it("keeps runtime route wording inside planning support boundaries", async () => {
    const routeSource = await readFile(resolve("src/routes/evidence-runtime.ts"), "utf-8");
    const serviceSource = await readFile(resolve("src/services/evidence-runtime.ts"), "utf-8");
    const source = `${routeSource}\n${serviceSource}`;
    expect(source).not.toMatch(/\bfire approved\b/iu);
    expect(source).not.toMatch(/\bcertified safe\b/iu);
    expect(source).not.toMatch(/\blegally compliant\b/iu);
    expect(source).not.toMatch(/\bsurvey-grade\b/iu);
    expect(source).not.toMatch(/\bapproved for occupancy\b/iu);
    expect(source).not.toMatch(/\bguaranteed accessible\b/iu);
    expect(source).not.toMatch(/\bBlack Label\b/u);
    expect(source).not.toMatch(/\bphotoreal digital twin\b/iu);
  });
});
