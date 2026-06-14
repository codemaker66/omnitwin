import type { TruthModeSummary } from "@omnitwin/types";

// Pure mapper: TruthModeSummary -> displayable rows for the cockpit Truth rail.
// Tone is deliberately cautious — only genuinely current/high states read as
// neutral; everything else (and the always-cautious verification + review-gate
// rows) reads as a warning. No single green "all clear" is ever produced.

export interface TruthRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly tone: "neutral" | "warning";
}

const VERIFICATION_LABEL = "Machine checked / not legally certified";

function humanize(value: string): string {
  const spaced = value.replace(/_/gu, " ").trim();
  if (spaced.length === 0) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const FALLBACK_ROWS: readonly TruthRow[] = [
  { key: "source", label: "Source", value: "Planning context — not a measured source of record", tone: "warning" },
  { key: "verification", label: "Verification", value: VERIFICATION_LABEL, tone: "warning" },
  { key: "confidence", label: "Confidence", value: "Unknown — human review required", tone: "warning" },
  { key: "assumptions", label: "Assumptions", value: "Human review required before reliance", tone: "warning" },
  { key: "evidence", label: "Evidence status", value: "Not checked", tone: "warning" },
  { key: "review", label: "Review gate", value: "Human review required", tone: "warning" },
  { key: "freshness", label: "Freshness", value: "Unknown", tone: "warning" },
];

export function buildTruthRailRows(summary: TruthModeSummary | null): readonly TruthRow[] {
  if (summary === null) return FALLBACK_ROWS;
  return [
    { key: "source", label: "Source", value: summary.source, tone: "neutral" },
    { key: "verification", label: "Verification", value: VERIFICATION_LABEL, tone: "warning" },
    {
      key: "confidence",
      label: "Confidence",
      value: humanize(summary.confidence),
      tone: summary.confidence === "high" ? "neutral" : "warning",
    },
    { key: "assumptions", label: "Assumptions", value: summary.assumption, tone: "neutral" },
    {
      key: "evidence",
      label: "Evidence status",
      value: humanize(summary.evidenceStatus),
      tone: summary.evidenceStatus === "current" ? "neutral" : "warning",
    },
    { key: "review", label: "Review gate", value: summary.reviewGate, tone: "warning" },
    {
      key: "freshness",
      label: "Freshness",
      value: humanize(summary.staleState),
      tone: summary.staleState === "current" ? "neutral" : "warning",
    },
  ];
}
