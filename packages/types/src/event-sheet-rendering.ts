import type {
  AccessibilityRequirements,
  DoorEventType,
  DoorSchedule,
} from "./event-requirements.js";

// ---------------------------------------------------------------------------
// Event-sheet rendering helpers — pure functions shared across every
// renderer (tablet HallkeeperPage, pdfkit PDF, email templates).
//
// Before this module existed, the "how do we surface accessibility
// callouts?" and "which severity does hearingLoop get?" decisions lived
// inside `packages/api/src/services/event-sheet-extractor.ts`. Only the
// API could build callouts; the web sheet renderer would have had to
// duplicate the logic to render them client-side.
//
// By lifting the pure helpers into @omnitwin/types, every renderer
// derives the same callouts + severity ranking + content-bearing
// decisions from the same planner-authored input. Drift risk goes to
// zero.
//
// This module intentionally DOES NOT touch the geometry side (manifest,
// equipment tags). Those stay in the extractor because they need the
// canonical-asset catalogue. This module only handles human-metadata
// transforms: accessibility → severity-ranked callouts, door schedule →
// chronologically-sorted summary.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AccessibilityCallout
// ---------------------------------------------------------------------------

export type AccessibilityCalloutSeverity = "critical" | "warning" | "info";

export interface AccessibilityCallout {
  readonly severity: AccessibilityCalloutSeverity;
  readonly label: string;
  readonly detail: string;
}

const SEVERITY_RANK: Readonly<Record<AccessibilityCalloutSeverity, number>> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function severityRank(s: AccessibilityCalloutSeverity): number {
  return SEVERITY_RANK[s];
}

// ---------------------------------------------------------------------------
// buildAccessibilityCallouts
//
// Each non-default accessibility flag becomes a callout with a severity:
//   - critical: hearing loop, wheelchair spaces, sign-language
//     interpreter — the hallkeeper MUST act on these before guests
//     arrive. Sheet renders these as a red bar at the top of the
//     sheet / card.
//   - warning: step-free routing — logistical but not safety-critical.
//   - info: large-print programme count, free-text notes.
//
// Output is sorted by severity (critical → warning → info). Within a
// severity, declaration order here is preserved — designed so the
// hallkeeper's eye lands on "hearing loop" before "wheelchair" before
// "interpreter".
// ---------------------------------------------------------------------------

export function buildAccessibilityCallouts(
  accessibility: AccessibilityRequirements | null,
): readonly AccessibilityCallout[] {
  if (accessibility === null) return [];
  if (!hasAccessibilityRenderContent(accessibility)) return [];

  const callouts: AccessibilityCallout[] = [];

  if (accessibility.hearingLoopRequired) {
    const zone = accessibility.hearingLoopZone;
    callouts.push({
      severity: "critical",
      label: "Hearing loop",
      detail: zone !== null
        ? `Required in ${zone}`
        : "Zone not set — planner action required",
    });
  }

  if (accessibility.wheelchairSpaces > 0) {
    callouts.push({
      severity: "critical",
      label: "Wheelchair spaces",
      detail: `${String(accessibility.wheelchairSpaces)} required`,
    });
  }

  if (accessibility.signLanguageInterpreter) {
    callouts.push({
      severity: "critical",
      label: "Sign-language interpreter",
      detail: "Scheduled for this event",
    });
  }

  if (accessibility.stepFreeRouteRequired) {
    callouts.push({
      severity: "warning",
      label: "Step-free access",
      detail: "Route required from entrance to seating",
    });
  }

  if (accessibility.largePrintProgrammes > 0) {
    callouts.push({
      severity: "info",
      label: "Large-print programmes",
      detail: `${String(accessibility.largePrintProgrammes)} copies`,
    });
  }

  const trimmedNotes = accessibility.notes.trim();
  if (trimmedNotes.length > 0) {
    callouts.push({
      severity: "info",
      label: "Accessibility notes",
      detail: trimmedNotes,
    });
  }

  // Stable severity sort — declaration order preserved within each tier.
  callouts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return callouts;
}

/**
 * Internal mirror of `hasAccessibilityContent` scoped to render-time —
 * we inline it to avoid a cross-file call for what is effectively a
 * single boolean. Both functions must stay in lockstep if either
 * changes.
 */
function hasAccessibilityRenderContent(a: AccessibilityRequirements): boolean {
  if (a.hearingLoopRequired) return true;
  if (a.wheelchairSpaces > 0) return true;
  if (a.stepFreeRouteRequired) return true;
  if (a.signLanguageInterpreter) return true;
  if (a.largePrintProgrammes > 0) return true;
  if (a.notes.trim().length > 0) return true;
  return false;
}

// ---------------------------------------------------------------------------
// DoorScheduleSummary — chronological per-door timeline for rendering.
//
// Planner may enter events in any order; hallkeepers read chronologically.
// Sort events by ISO-8601 `at` string (lexicographic == chronological for
// ISO-8601 format). Per-door order preserves the planner's authored
// order since they may intentionally list "main door" first.
// ---------------------------------------------------------------------------

export interface DoorScheduleSummaryEvent {
  readonly at: string;
  readonly kind: DoorEventType;
  readonly note: string;
}

export interface DoorScheduleSummaryEntry {
  readonly label: string;
  readonly events: readonly DoorScheduleSummaryEvent[];
}

export interface DoorScheduleSummary {
  readonly entries: readonly DoorScheduleSummaryEntry[];
}

export function buildDoorScheduleSummary(
  schedule: DoorSchedule | null,
): DoorScheduleSummary | null {
  if (schedule === null) return null;
  if (schedule.entries.length === 0) return null;

  const entries: DoorScheduleSummaryEntry[] = schedule.entries.map((e) => ({
    label: e.label,
    events: [...e.events]
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((ev) => ({ at: ev.at, kind: ev.kind, note: ev.note })),
  }));

  return { entries };
}
