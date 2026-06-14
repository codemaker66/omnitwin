import { describe, expect, it } from "vitest";
import type { TruthModeSummary } from "@omnitwin/types";
import { buildTruthRailRows } from "../cockpit-truth-rail-model.js";

function summary(overrides: Partial<TruthModeSummary> = {}): TruthModeSummary {
  return {
    targetType: "configuration",
    targetId: "cfg-1",
    source: "Observed capture + planner objects",
    confidence: "high",
    assumption: "180 guests, 2 service lanes",
    evidenceStatus: "current",
    reviewGate: "Egress pathway review pending",
    staleState: "current",
    safeWording: ["Planning evidence", "Human review required"],
    humanReviewRequired: true,
    counts: { evidenceItems: 12, checkResults: 8, assumptions: 3, reviewGates: 3, staleEvents: 0 },
    ...overrides,
  };
}

function row(rows: readonly { key: string; value: string; tone: string }[], key: string): { value: string; tone: string } {
  const found = rows.find((r) => r.key === key);
  if (found === undefined) throw new Error(`row ${key} missing`);
  return found;
}

describe("buildTruthRailRows", () => {
  it("returns SAFE warning fallbacks when there is no summary", () => {
    const rows = buildTruthRailRows(null);
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.tone === "warning")).toBe(true);
    expect(row(rows, "source").value).toMatch(/not a measured source/i);
    expect(row(rows, "verification").value).toBe("Machine checked / not legally certified");
  });

  it("maps a current/high summary with neutral tones, but keeps review + verification cautious", () => {
    const rows = buildTruthRailRows(summary());
    expect(row(rows, "source").value).toBe("Observed capture + planner objects");
    expect(row(rows, "confidence").tone).toBe("neutral");
    expect(row(rows, "evidence").tone).toBe("neutral");
    expect(row(rows, "freshness").tone).toBe("neutral");
    expect(row(rows, "review").tone).toBe("warning");
    expect(row(rows, "verification").tone).toBe("warning");
  });

  it("humanises enum values and flags non-current states as warnings", () => {
    const rows = buildTruthRailRows(summary({ confidence: "low", evidenceStatus: "missing", staleState: "review_due" }));
    expect(row(rows, "confidence")).toEqual(expect.objectContaining({ value: "Low", tone: "warning" }));
    expect(row(rows, "evidence")).toEqual(expect.objectContaining({ value: "Missing", tone: "warning" }));
    expect(row(rows, "freshness")).toEqual(expect.objectContaining({ value: "Review due", tone: "warning" }));
  });
});
