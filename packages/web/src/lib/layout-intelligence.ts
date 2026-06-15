// ---------------------------------------------------------------------------
// layout-intelligence — an instant, expert-grade critique of a layout.
//
// Synthesises the existing analysis engines (circulation clearance + capacity
// comfort + table dressing) into a single 0–100 Layout Grade with weighted
// sub-scores and a prioritised, human-readable set of recommendations — the
// kind of read a veteran event planner gives a floor plan at a glance.
//
// Pure and deterministic: it consumes already-computed reports, so it adds no
// new geometry and is trivially testable.
//
// SAFE LANGUAGE: every score and message is a PLANNING-GRADE judgement. It is
// NOT a legal occupancy figure, NOT a fire-egress check, and NOT an
// authoritative safety statement; human review is required. The recommendation
// copy below stays strictly inside that vocabulary.
// ---------------------------------------------------------------------------

import type { CirculationReport } from "./circulation.js";
import type { CapacityIntelligence } from "./layout-capacity.js";

export type LayoutBand = "S" | "A" | "B" | "C" | "D";

export type RecommendationSeverity = "critical" | "warning" | "tip" | "praise";

export interface LayoutRecommendation {
  readonly id: string;
  readonly severity: RecommendationSeverity;
  readonly message: string;
}

export interface LayoutSubscores {
  /** 0–100, or null when not assessable yet (e.g. fewer than two tables). */
  readonly circulation: number | null;
  readonly capacity: number | null;
  readonly dressing: number | null;
}

export interface LayoutGrade {
  /** Overall 0–100 score (0 when nothing is placed). */
  readonly score: number;
  readonly band: LayoutBand;
  readonly subscores: LayoutSubscores;
  /** SAFE one-line verdict. */
  readonly headline: string;
  /** Highest-priority issues first; capped, ready to render. */
  readonly recommendations: readonly LayoutRecommendation[];
}

/** What the grader needs — all already derived elsewhere in the planner. */
export interface LayoutSignals {
  readonly hasLayout: boolean;
  readonly circulation: CirculationReport;
  readonly capacity: CapacityIntelligence;
  readonly tableCount: number;
  readonly chairs: number;
  readonly dressedTables: number;
}

// Relative weights for the assessable dimensions. Renormalised over whichever
// dimensions can actually be judged for the current layout.
const WEIGHTS = { circulation: 0.4, capacity: 0.4, dressing: 0.2 } as const;

function circulationScore(report: CirculationReport): number | null {
  switch (report.band) {
    case "open":
      return null; // fewer than two tables — nothing to assess
    case "generous":
      return 100;
    case "comfortable":
      return 85;
    case "tight":
      return 55;
    case "blocked":
      return 20;
  }
}

function capacityScore(capacity: CapacityIntelligence): number | null {
  switch (capacity.band) {
    case "open":
      return null; // no seats placed
    case "comfortable":
      return 100;
    case "spacious":
      return 88;
    case "tight":
      return 60;
    case "over-capacity":
      return 25;
  }
}

function dressingScore(tableCount: number, dressedTables: number): number | null {
  if (tableCount <= 0) return null;
  return Math.round(Math.max(0, Math.min(1, dressedTables / tableCount)) * 100);
}

function bandForScore(score: number): LayoutBand {
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 68) return "B";
  if (score >= 50) return "C";
  return "D";
}

function headlineForBand(band: LayoutBand): string {
  switch (band) {
    case "S":
      return "Beautifully balanced — spacing, capacity and dressing all read well";
    case "A":
      return "Strong layout — a couple of refinements from excellent";
    case "B":
      return "Solid draft — a few areas to tighten up";
    case "C":
      return "Workable, but several planning-grade checks need attention";
    case "D":
      return "Early draft — review spacing, capacity and dressing";
  }
}

/** Build the prioritised recommendation list (critical → warning → tip → praise). */
function buildRecommendations(signals: LayoutSignals): LayoutRecommendation[] {
  const { circulation, capacity, tableCount, dressedTables } = signals;
  const recs: LayoutRecommendation[] = [];

  // Critical — passability and over-capacity.
  if (circulation.band === "blocked") {
    recs.push({
      id: "circulation-blocked",
      severity: "critical",
      message:
        "Tables are too close to pass between — widen the aisles. Planning-grade only; venue review required.",
    });
  }
  if (capacity.band === "over-capacity") {
    recs.push({
      id: "capacity-over",
      severity: "critical",
      message:
        "Seating is past the comfortable planning capacity — venue review required before use.",
    });
  }

  // Warning — tight but workable.
  if (circulation.band === "tight") {
    const count = circulation.tightCount + circulation.blockedCount;
    recs.push({
      id: "circulation-tight",
      severity: "warning",
      message:
        count > 1
          ? `${String(count)} table aisles are below the comfortable walkway — add space between tables.`
          : "A table aisle is tight — add a little space between those tables.",
    });
  }
  if (capacity.band === "tight") {
    recs.push({
      id: "capacity-tight",
      severity: "warning",
      message: "The room is filling up — space per guest is below the comfortable guideline.",
    });
  }

  // Tip — finishing touches and headroom.
  const undressed = tableCount - dressedTables;
  if (tableCount > 0 && undressed > 0) {
    recs.push({
      id: "dressing",
      severity: "tip",
      message:
        undressed === 1
          ? "1 table is undressed — add linen for a finished look."
          : `${String(undressed)} tables are undressed — add linen for a finished look.`,
    });
  }
  if (capacity.band === "spacious") {
    recs.push({
      id: "capacity-headroom",
      severity: "tip",
      message: "Plenty of room per guest — you could add more seating if you need the capacity.",
    });
  }

  // Praise — only when there is genuinely nothing to flag.
  if (recs.length === 0 && signals.hasLayout) {
    if (circulation.band === "generous" || circulation.band === "comfortable") {
      recs.push({
        id: "praise-circulation",
        severity: "praise",
        message: "Comfortable walkways throughout and capacity within guidance — nicely judged.",
      });
    }
  }

  return recs;
}

const SEVERITY_RANK: Readonly<Record<RecommendationSeverity, number>> = {
  critical: 0,
  warning: 1,
  tip: 2,
  praise: 3,
};

/**
 * Grade a layout. Combines the assessable sub-scores (renormalised over those
 * that apply) into a 0–100 score and band, and returns recommendations ordered
 * by severity. An empty floor scores 0 / band D with a single starter tip.
 */
export function gradeLayout(signals: LayoutSignals): LayoutGrade {
  const subscores: LayoutSubscores = {
    circulation: circulationScore(signals.circulation),
    capacity: capacityScore(signals.capacity),
    dressing: dressingScore(signals.tableCount, signals.dressedTables),
  };

  if (!signals.hasLayout) {
    return {
      score: 0,
      band: "D",
      subscores,
      headline: "Start placing furniture to grade your layout",
      recommendations: [
        { id: "empty", severity: "tip", message: "Drop a few tables to see your layout grade." },
      ],
    };
  }

  const weighted: { value: number; weight: number }[] = [];
  if (subscores.circulation !== null) weighted.push({ value: subscores.circulation, weight: WEIGHTS.circulation });
  if (subscores.capacity !== null) weighted.push({ value: subscores.capacity, weight: WEIGHTS.capacity });
  if (subscores.dressing !== null) weighted.push({ value: subscores.dressing, weight: WEIGHTS.dressing });

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  const score = totalWeight > 0
    ? Math.round(weighted.reduce((sum, w) => sum + w.value * w.weight, 0) / totalWeight)
    : 0;
  const band = bandForScore(score);

  const recommendations = buildRecommendations(signals).sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );

  return { score, band, subscores, headline: headlineForBand(band), recommendations };
}
