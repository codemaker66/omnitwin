import type { EventPhaseGraph } from "@omnitwin/types";

// Pure mapper: EventPhaseGraph -> display cards for the cockpit phase strip.
// Owns its own formatting so the cockpit does not depend on the dev command
// shell's demo-state module (which is retired later).

export interface CockpitPhaseCard {
  readonly id: string;
  readonly index: number;
  readonly name: string;
  readonly timeLabel: string;
  readonly durationLabel: string;
  readonly densityLabel: string;
  readonly staffConflictsLabel: string;
  readonly opsTasks: number;
  readonly reviewGates: number;
  readonly reviewState: "ok" | "review";
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(remaining)}m`;
}

function timeLabel(value: string | null): string {
  if (value === null) return "Time not set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Time not set";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(parsed);
}

export function buildCockpitPhases(graph: EventPhaseGraph | null): readonly CockpitPhaseCard[] {
  if (graph === null) return [];
  return graph.phases.map((phase, index) => ({
    id: phase.id,
    index: index + 1,
    name: phase.name,
    timeLabel: timeLabel(phase.startsAt),
    durationLabel: durationLabel(phase.durationMinutes),
    densityLabel: phase.densityLabel,
    staffConflictsLabel: phase.staffConflictsLabel,
    opsTasks: phase.opsTasksCount,
    reviewGates: phase.reviewGatesCount,
    reviewState: phase.reviewGatesCount > 0 ? "review" : "ok",
  }));
}
