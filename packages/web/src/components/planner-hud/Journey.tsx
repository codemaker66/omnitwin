import { useMemo, type ReactElement } from "react";
import { moveDoorBlockersClear } from "../../lib/door-clear-actions.js";
import { journeySteps, nextMove, type NextMove } from "../../lib/hud/journey.js";
import type { RoomFacts } from "../../lib/hud/room-seals.js";
import { usePlannerHudStore } from "../../stores/planner-hud-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useHudFacts } from "./hud-facts.js";
import { ChevronGlyph, TickGlyph } from "./glyphs.js";

// ---------------------------------------------------------------------------
// The journey across the top: four steps, each opening its own sheet, and one
// line that always names the next best move (design spec, "The stations").
// Pressing the line does the move where one press can, and otherwise opens
// the step that carries it out.
// ---------------------------------------------------------------------------

function carryOut(move: NextMove, facts: RoomFacts): void {
  if (move.id === "clear-door") {
    if (moveDoorBlockersClear() > 0) return;
  }
  if (move.id === "open-gap") {
    const pair = facts.aisles.tightestPair;
    if (pair !== null) {
      useSelectionStore.getState().selectMultiple([pair.aId, pair.bId]);
      return;
    }
  }
  usePlannerHudStore.getState().openSheet(move.step);
}

export function Journey(): ReactElement {
  const facts = useHudFacts();
  const sent = usePlannerHudStore((state) => state.sent);
  const sheet = usePlannerHudStore((state) => state.sheet);
  const eventKnown = facts.plane.guests !== null && facts.plane.guests > 0;
  const steps = useMemo(
    () => journeySteps({ eventKnown, seated: facts.plane.standing === "seated", dressed: facts.dressed, sent }),
    [eventKnown, facts.plane.standing, facts.dressed, sent],
  );
  const move = useMemo(() => nextMove(facts, sent), [facts, sent]);
  return (
    <nav className="hud-journey" aria-label="Your plan, step by step">
      <ol className="hud-journey__steps" role="list">
        {steps.map((step) => (
          <li key={step.id} className="hud-journey__slot">
            <button
              type="button"
              className="hud-step"
              data-step={step.id}
              data-state={step.state}
              data-open={sheet === step.id ? "true" : undefined}
              aria-current={step.state === "current" ? "step" : undefined}
              aria-expanded={sheet === step.id}
              onClick={() => { usePlannerHudStore.getState().toggleSheet(step.id); }}
            >
              {step.state === "done" ? <TickGlyph /> : null}
              <span>{step.label}</span>
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="hud-next" data-move={move.id} onClick={() => { carryOut(move, facts); }}>
        <span className="hud-next__lead">{move.id === "sent" ? "Sent:" : "Next:"}</span>
        <span className="hud-next__move">{move.text}</span>
        <ChevronGlyph />
      </button>
    </nav>
  );
}
