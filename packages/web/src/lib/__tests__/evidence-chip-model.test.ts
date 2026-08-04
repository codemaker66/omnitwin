import { describe, expect, it } from "vitest";
import {
  EVIDENCE_CHIP_LABELS,
  PROVENANCE_BADGE_LABELS,
  evidenceChipStateFromAssetStatus,
  evidenceChipStateFromTruthTone,
  evidenceChipStateFromVerificationState,
} from "../evidence-chip-model.js";

// CARD A4 (G2b): the chip grammar's pure core. State names must match
// 01 §9 exactly: Current · Review required · Stale · Missing.

describe("EVIDENCE_CHIP_LABELS", () => {
  it("uses the 01 §9 canonical names exactly", () => {
    expect(EVIDENCE_CHIP_LABELS).toEqual({
      current: "Current",
      "review-required": "Review required",
      stale: "Stale",
      missing: "Missing",
    });
  });
});

describe("PROVENANCE_BADGE_LABELS", () => {
  it("covers the four provenance badges from the card", () => {
    expect(PROVENANCE_BADGE_LABELS).toEqual({
      operator: "Operator",
      "machine-checked": "Machine checked",
      ai: "AI",
      simulated: "Simulated",
    });
  });
});

describe("evidenceChipStateFromAssetStatus", () => {
  it("maps reviewed evidence to Current", () => {
    expect(evidenceChipStateFromAssetStatus("human_reviewed")).toBe("current");
  });

  it("maps machine-checked and unverified evidence to Review required", () => {
    expect(evidenceChipStateFromAssetStatus("machine_checked")).toBe("review-required");
    expect(evidenceChipStateFromAssetStatus("unverified")).toBe("review-required");
  });

  it("maps rejected evidence to Review required — reviewed-and-refused still needs review work, never reads Current", () => {
    expect(evidenceChipStateFromAssetStatus("rejected")).toBe("review-required");
  });

  it("staleness overrides everything except absence", () => {
    expect(evidenceChipStateFromAssetStatus("human_reviewed", { stale: true })).toBe("stale");
    expect(evidenceChipStateFromAssetStatus("machine_checked", { stale: true })).toBe("stale");
  });

  it("maps absent evidence to Missing", () => {
    expect(evidenceChipStateFromAssetStatus(null)).toBe("missing");
    expect(evidenceChipStateFromAssetStatus(null, { stale: true })).toBe("missing");
  });
});

describe("evidenceChipStateFromTruthTone", () => {
  it("maps the truth rail's row tones onto the canonical states", () => {
    expect(evidenceChipStateFromTruthTone("neutral")).toBe("current");
    expect(evidenceChipStateFromTruthTone("warning")).toBe("review-required");
  });
});

describe("evidenceChipStateFromVerificationState", () => {
  it("maps the truth-mode verification vocabulary honestly", () => {
    expect(evidenceChipStateFromVerificationState("verified")).toBe("current");
    expect(evidenceChipStateFromVerificationState("expired")).toBe("stale");
    // Unverified, contested, and suppressed evidence all still need review —
    // none may read Current, and none is Missing (the evidence exists).
    expect(evidenceChipStateFromVerificationState("unverified")).toBe("review-required");
    expect(evidenceChipStateFromVerificationState("contested")).toBe("review-required");
    expect(evidenceChipStateFromVerificationState("suppressed")).toBe("review-required");
  });
});
