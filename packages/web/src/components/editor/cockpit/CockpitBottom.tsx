import { type ReactElement } from "react";
import { Users, ShieldQuestion, BriefcaseBusiness, ChartNoAxesCombined, type LucideIcon } from "lucide-react";
import { useLinkedEvent } from "../../../hooks/use-linked-event.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { buildCockpitPhases } from "../../../lib/cockpit-phase-model.js";
import type { CockpitMode } from "../../../lib/cockpit-modes.js";
import {
  plannerAllowsOperationalGeometry,
  type PlannerLayerPolicy,
} from "../../../lib/planner-layer-composition.js";
import "./CockpitBottom.css";

interface InsightCard {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly mode: CockpitMode;
  readonly tone: "cyan" | "violet" | "amber" | "green";
  readonly Icon: LucideIcon;
}

// SAFE, honest card copy. Each card is a real control — it switches the cockpit
// to the matching lens. Live metrics arrive when each lens panel lands; no
// fabricated numbers are shown here.
const INSIGHT_CARDS: readonly InsightCard[] = [
  { id: "guestFlow", label: "Guest Flow Replay", value: "Simulated", detail: "Human review required", mode: "flow", tone: "cyan", Icon: Users },
  { id: "evidencePack", label: "Layout Evidence Pack", value: "Checks pending", detail: "Purpose-fit draft", mode: "evidence", tone: "violet", Icon: ShieldQuestion },
  { id: "opsCompiler", label: "Ops Compiler", value: "Setup tasks", detail: "Compile in Ops lens", mode: "ops", tone: "amber", Icon: BriefcaseBusiness },
  { id: "revenueScenario", label: "Revenue Scenario", value: "Scenario", detail: "Estimate, not a quote", mode: "costs", tone: "green", Icon: ChartNoAxesCombined },
];

function timelineNote(status: string, eventName: string | null, phaseCount: number): string {
  if (status === "loading") return "Loading event timeline";
  if (status === "error") return "Event timeline unavailable";
  if (phaseCount > 0) return `${eventName ?? "Event"} · ${String(phaseCount)} phases`;
  return "Open with an event link to plan the timeline";
}

/**
 * Cockpit bottom strip: the event phase graph (bound to the optional linked
 * event) plus the four planning insight cards. Phases are selectable (driving
 * the cockpit's selected phase); each insight card switches to its lens.
 */
export interface CockpitBottomProps {
  readonly layerPolicy: PlannerLayerPolicy;
}

function unavailableInsightCopy(policy: PlannerLayerPolicy): {
  readonly title: string;
  readonly body: string;
} {
  switch (policy.kind) {
    case "captured-only":
      return {
        title: "Captured source only",
        body: "Guest-flow, clearance, capacity, and operational insight controls require reviewed room-local geometry.",
      };
    case "identity-pending":
      return {
        title: "Room identity resolving",
        body: "Operational insight controls stay hidden until the current venue and room have been verified.",
      };
    case "identity-unavailable":
      return {
        title: "Room identity unavailable",
        body: "Operational insight controls are unavailable because the current venue and room could not be verified.",
      };
    case "configurable":
      return { title: "Planning insights", body: "Operational planning controls are available." };
  }
}

export function CockpitBottom({ layerPolicy }: CockpitBottomProps): ReactElement {
  const linked = useLinkedEvent();
  const selectedPhaseId = useCockpitStore((s) => s.selectedPhaseId);
  const phases = buildCockpitPhases(linked.graph);
  const operationalGeometryAllowed = plannerAllowsOperationalGeometry(layerPolicy);
  const unavailableCopy = unavailableInsightCopy(layerPolicy);

  return (
    <footer className="cockpit-bottom" data-testid="cockpit-bottom" aria-label="Event timeline and insights">
      <section className="cockpit-bottom__timeline" aria-label="Event phase graph">
        <header className="cockpit-bottom__timeline-head">
          <span className="cockpit-bottom__eyebrow">Event phase graph</span>
          <span className="cockpit-bottom__timeline-note">{timelineNote(linked.status, linked.eventName, phases.length)}</span>
        </header>
        {phases.length > 0 ? (
          <div className="cockpit-bottom__track">
            {phases.map((phase) => {
              const active = phase.id === selectedPhaseId;
              return (
                <button
                  key={phase.id}
                  type="button"
                  className={active ? "cockpit-phase is-active" : "cockpit-phase"}
                  aria-pressed={active}
                  onClick={() => { useCockpitStore.getState().selectPhase(phase.id); }}
                >
                  <span className="cockpit-phase__node">{phase.index}</span>
                  <span className="cockpit-phase__name">{phase.name}</span>
                  <span className="cockpit-phase__meta">{phase.timeLabel} · {phase.durationLabel}</span>
                  <span className="cockpit-phase__meta">Ops {phase.opsTasks} · Gates {phase.reviewGates}</span>
                  <span className={phase.reviewState === "ok" ? "cockpit-phase__state ok" : "cockpit-phase__state review"}>
                    {phase.reviewState === "ok" ? "No phase gates" : "Review gates"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="cockpit-bottom__empty" role="note">
            <strong>No event linked</strong>
            <span>Connect an event to plan the timeline. Planning evidence · human review required.</span>
          </div>
        )}
      </section>

      <section className="cockpit-bottom__cards" aria-label="Planning insights">
        {operationalGeometryAllowed ? INSIGHT_CARDS.map((card) => {
          const Icon = card.Icon;
          return (
            <button
              key={card.id}
              type="button"
              className={`cockpit-insight cockpit-insight--${card.tone}`}
              onClick={() => { useCockpitStore.getState().setMode(card.mode); }}
            >
              <span className="cockpit-insight__icon"><Icon size={20} aria-hidden="true" /></span>
              <span className="cockpit-insight__label">{card.label}</span>
              <span className="cockpit-insight__value">{card.value}</span>
              <span className="cockpit-insight__detail">{card.detail}</span>
            </button>
          );
        }) : (
          <div className="cockpit-bottom__source-only" role="note">
            <strong>{unavailableCopy.title}</strong>
            <span>{unavailableCopy.body}</span>
          </div>
        )}
      </section>
    </footer>
  );
}
