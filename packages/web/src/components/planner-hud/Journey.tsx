import { useMemo, type ReactElement } from "react";
import { moveDoorBlockersClear } from "../../lib/door-clear-actions.js";
import { journeySteps, nextMove, type NextMove } from "../../lib/hud/journey.js";
import type { RoomFacts } from "../../lib/hud/room-seals.js";
import { postPlacementNotice } from "../../stores/placement-notice-store.js";
import { usePlanSent, usePlannerHudStore } from "../../stores/planner-hud-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useHudFacts } from "./hud-facts.js";
import { TickGlyph } from "./glyphs.js";

// ---------------------------------------------------------------------------
// The journey (the HUD's design note): four steps as four words in the
// centre of the top bar, each opening its own sheet, and the ONE primary key
// at the right of the shelf, whose words are always the next best move.
// Pressing it does the move where one press can, and otherwise opens the step
// that carries it out.
// ---------------------------------------------------------------------------

function carryOut(move: NextMove, facts: RoomFacts): void {
  if (move.id === "clear-door") {
    if (moveDoorBlockersClear() > 0) return;
    // No free floor near the piece: said once, in the receipt's place on the status line.
    const many = (facts.doors?.blockers.length ?? 0) > 1;
    postPlacementNotice(many
      ? "There is no free floor near them. Make room beside them, or move them by hand."
      : "There is no free floor near it. Make room beside it, or move it by hand.");
    return;
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

/** The four steps, top centre: the current one underlined, those done ticked, the rest standing back. */
export function Journey(): ReactElement {
  const facts = useHudFacts();
  const sent = usePlanSent();
  const sheet = usePlannerHudStore((state) => state.sheet);
  const eventKnown = facts.plane.guests !== null && facts.plane.guests > 0;
  const steps = useMemo(
    () => journeySteps({ eventKnown, seated: facts.plane.standing === "seated", dressed: facts.dressed, sent }),
    [eventKnown, facts.plane.standing, facts.dressed, sent],
  );
  return (
    <nav className="hud-steps" aria-label="Your plan, step by step">
      <ol className="hud-steps__list" role="list">
        {steps.map((step) => (
          <li key={step.id} className="hud-steps__slot" data-state={step.state}>
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
              <span className="hud-step__word">{step.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The one primary key: the next best move, in its own words, carried out on a
 * press. While the sheet that carries the move out is open, the sheet's own
 * act is the primary, and this key steps aside.
 */
export function NextMoveKey(): ReactElement {
  const facts = useHudFacts();
  const sent = usePlanSent();
  const sheet = usePlannerHudStore((state) => state.sheet);
  const move = useMemo(() => nextMove(facts, sent), [facts, sent]);
  return (
    <button type="button" className="hud-act" data-move={move.id} hidden={sheet === move.step} onClick={() => { carryOut(move, facts); }}>
      {move.text}
    </button>
  );
}
