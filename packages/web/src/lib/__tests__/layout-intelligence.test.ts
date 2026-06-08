import { describe, it, expect } from "vitest";
import type { CirculationBand, CirculationReport } from "../circulation.js";
import type { CapacityIntelligence, ComfortBand } from "../layout-capacity.js";
import {
  gradeLayout,
  type LayoutSignals,
  type LayoutGrade,
} from "../layout-intelligence.js";

function circ(band: CirculationBand): CirculationReport {
  return {
    pairCount: band === "open" ? 0 : 1,
    tightestGapM: band === "open" ? null : 1,
    tightestPair: null,
    problemGaps: [],
    tightCount: band === "tight" ? 2 : 0,
    blockedCount: band === "blocked" ? 1 : 0,
    band,
  };
}

function cap(band: ComfortBand): CapacityIntelligence {
  return {
    floorAreaM2: 150,
    layoutStyle: "dinner-rounds",
    plannedSeats: 80,
    comfortableCapacity: 100,
    tightCapacity: 130,
    spacePerGuestM2: 1.5,
    utilizationPercent: 80,
    band,
  };
}

function signals(overrides: Partial<LayoutSignals> = {}): LayoutSignals {
  return {
    hasLayout: true,
    circulation: circ("generous"),
    capacity: cap("comfortable"),
    tableCount: 10,
    chairs: 80,
    dressedTables: 10,
    ...overrides,
  };
}

const FORBIDDEN = [
  "fire approved", "certified safe", "legally compliant", "survey-grade",
  "approved for occupancy", "guaranteed accessible", "production ready",
  "photoreal digital twin", "fire capacity", "legal capacity",
];

function assertSafe(grade: LayoutGrade): void {
  const text = [grade.headline, ...grade.recommendations.map((r) => r.message)].join(" ").toLowerCase();
  for (const phrase of FORBIDDEN) expect(text).not.toContain(phrase);
}

describe("gradeLayout — empty state", () => {
  it("scores 0 / D with a starter tip when nothing is placed", () => {
    const grade = gradeLayout(signals({ hasLayout: false, circulation: circ("open"), capacity: cap("open"), tableCount: 0, chairs: 0, dressedTables: 0 }));
    expect(grade.score).toBe(0);
    expect(grade.band).toBe("D");
    expect(grade.headline).toMatch(/start placing/i);
    expect(grade.recommendations).toHaveLength(1);
    expect(grade.recommendations[0]?.severity).toBe("tip");
  });
});

describe("gradeLayout — scoring", () => {
  it("awards a perfect S grade when every dimension is ideal", () => {
    const grade = gradeLayout(signals());
    expect(grade.score).toBe(100);
    expect(grade.band).toBe("S");
    expect(grade.subscores).toEqual({ circulation: 100, capacity: 100, dressing: 100 });
  });

  it("renormalises over only the assessable dimensions", () => {
    // Chairs but fewer than two tables: circulation + dressing are N/A, so the
    // score is exactly the capacity sub-score.
    const grade = gradeLayout(signals({ circulation: circ("open"), capacity: cap("comfortable"), tableCount: 0, dressedTables: 0 }));
    expect(grade.subscores.circulation).toBeNull();
    expect(grade.subscores.dressing).toBeNull();
    expect(grade.score).toBe(100);
  });

  it("weights the dimensions (0.4 / 0.4 / 0.2)", () => {
    // generous 100·0.4 + tight 60·0.4 + dressing 0·0.2 = 64 → band C.
    const grade = gradeLayout(signals({ circulation: circ("generous"), capacity: cap("tight"), dressedTables: 0 }));
    expect(grade.score).toBe(64);
    expect(grade.band).toBe("C");
  });

  it("collapses to D for a blocked, over-capacity, undressed layout", () => {
    const grade = gradeLayout(signals({ circulation: circ("blocked"), capacity: cap("over-capacity"), dressedTables: 0 }));
    // blocked 20·0.4 + over 25·0.4 + 0·0.2 = 18
    expect(grade.score).toBe(18);
    expect(grade.band).toBe("D");
  });

  it("scores partial dressing proportionally", () => {
    const grade = gradeLayout(signals({ dressedTables: 5, tableCount: 10 }));
    expect(grade.subscores.dressing).toBe(50);
  });
});

describe("gradeLayout — recommendations", () => {
  it("surfaces blocked circulation as the top critical issue", () => {
    const grade = gradeLayout(signals({ circulation: circ("blocked"), capacity: cap("over-capacity"), dressedTables: 0 }));
    expect(grade.recommendations[0]?.severity).toBe("critical");
    // Critical items sort ahead of warnings/tips.
    const severities = grade.recommendations.map((r) => r.severity);
    expect(severities).toEqual([...severities].sort((a, b) =>
      ({ critical: 0, warning: 1, tip: 2, praise: 3 })[a] - ({ critical: 0, warning: 1, tip: 2, praise: 3 })[b]));
  });

  it("counts multiple tight aisles in the warning copy", () => {
    const grade = gradeLayout(signals({ circulation: circ("tight"), dressedTables: 10 }));
    const tight = grade.recommendations.find((r) => r.id === "circulation-tight");
    expect(tight?.severity).toBe("warning");
    expect(tight?.message).toMatch(/2 table aisles/);
  });

  it("flags undressed tables with an exact count", () => {
    const grade = gradeLayout(signals({ dressedTables: 7, tableCount: 10 }));
    const dressing = grade.recommendations.find((r) => r.id === "dressing");
    expect(dressing?.message).toMatch(/3 tables are undressed/);
  });

  it("praises a clean layout when there is nothing to flag", () => {
    const grade = gradeLayout(signals());
    expect(grade.recommendations).toHaveLength(1);
    expect(grade.recommendations[0]?.severity).toBe("praise");
  });

  it("keeps all copy inside SAFE planning-grade language", () => {
    for (const c of ["open", "generous", "comfortable", "tight", "blocked"] as const) {
      for (const k of ["open", "spacious", "comfortable", "tight", "over-capacity"] as const) {
        assertSafe(gradeLayout(signals({ circulation: circ(c), capacity: cap(k), dressedTables: 4 })));
      }
    }
  });
});
