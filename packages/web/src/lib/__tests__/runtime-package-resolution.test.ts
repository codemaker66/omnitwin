import { describe, it, expect } from "vitest";
import type { AssetEvidenceStatus, RuntimePackage } from "@omnitwin/types";
import { decideRuntimeAsset, evidenceStatusLabel } from "../runtime-package-resolution.js";

function makePackage(overrides: {
  assetUrl?: string | null;
  evidenceStatus?: AssetEvidenceStatus;
} = {}): RuntimePackage {
  const evidenceStatus = overrides.evidenceStatus ?? "machine_checked";
  return {
    id: "rp1",
    venueId: "v1",
    spaceId: null,
    assetVersionId: "av1",
    status: "published",
    label: null,
    publishedAt: "2026-06-06T10:00:00.000Z",
    createdAt: "2026-06-06T10:00:00.000Z",
    assetUrl: overrides.assetUrl === undefined ? "https://assets.example/grand-hall/scene.spz" : overrides.assetUrl,
    assetVersion: {
      id: "av1", venueId: "v1", spaceId: null, source: "runpod",
      r2Key: "private/venues/trades-hall/runtime/grand-hall/scene.spz",
      splatExtension: ".spz", sha256: "a".repeat(64), captureDate: "2026-06-01",
      evidenceStatus, sizeBytes: 2048, label: null, createdBy: "u1",
      createdAt: "2026-06-06T10:00:00.000Z",
    },
  };
}

// Phrases the product must never imply about a planning-grade asset.
const FORBIDDEN_PHRASES = [
  "production ready", "approved for occupancy", "survey-grade",
  "photoreal digital twin", "legally compliant", "certified safe", "fire approved",
];

describe("decideRuntimeAsset", () => {
  it("uses a manual dev URL even when a published package exists (operator override)", () => {
    const decision = decideRuntimeAsset("https://manual.example/scene.ply", makePackage());
    expect(decision.source).toBe("manual");
    expect(decision.splatUrl).toBe("https://manual.example/scene.ply");
    expect(decision.isProceduralFallback).toBe(false);
    expect(decision.evidenceStatus).toBeNull();
  });

  it("renders the published package when there is no manual override", () => {
    const decision = decideRuntimeAsset(null, makePackage({ evidenceStatus: "human_reviewed" }));
    expect(decision.source).toBe("published");
    expect(decision.splatUrl).toBe("https://assets.example/grand-hall/scene.spz");
    expect(decision.evidenceStatus).toBe("human_reviewed");
    expect(decision.isProceduralFallback).toBe(false);
  });

  it("falls back to the procedural room when nothing is published (empty state)", () => {
    const decision = decideRuntimeAsset(null, null);
    expect(decision.source).toBe("none");
    expect(decision.splatUrl).toBeNull();
    expect(decision.isProceduralFallback).toBe(true);
    expect(decision.evidenceLabel).toMatch(/procedural/i);
  });

  it("falls back to procedural when a package exists but its URL is unresolved (R2 not configured)", () => {
    const decision = decideRuntimeAsset(null, makePackage({ assetUrl: null }));
    expect(decision.source).toBe("none");
    expect(decision.splatUrl).toBeNull();
    expect(decision.isProceduralFallback).toBe(true);
  });

  it("treats an empty manual URL as no override", () => {
    const decision = decideRuntimeAsset("", makePackage());
    expect(decision.source).toBe("published");
  });
});

describe("evidenceStatusLabel", () => {
  it("returns an honest label for each status", () => {
    expect(evidenceStatusLabel("unverified")).toMatch(/unverified/i);
    expect(evidenceStatusLabel("machine_checked")).toMatch(/machine checked/i);
    expect(evidenceStatusLabel("human_reviewed")).toMatch(/human reviewed/i);
  });

  it("never makes an unsafe certification/occupancy/fidelity claim", () => {
    const statuses: AssetEvidenceStatus[] = ["unverified", "machine_checked", "human_reviewed"];
    const labels = [
      ...statuses.map((s) => evidenceStatusLabel(s)),
      decideRuntimeAsset("https://m/x.ply", null).evidenceLabel,
      decideRuntimeAsset(null, null).evidenceLabel,
    ];
    for (const label of labels) {
      const lower = label.toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(lower).not.toContain(phrase);
      }
    }
  });
});
