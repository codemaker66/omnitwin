import { useEffect, type ReactElement } from "react";
import { useEscapeLayer } from "../../lib/planner-keys.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { usePlannerEventStore, type PlannerEventKind } from "../../stores/planner-event-store.js";
import { usePlannerHudStore } from "../../stores/planner-hud-store.js";
import { useHudFacts } from "./hud-facts.js";
import "./hud-first-open.css";

// ---------------------------------------------------------------------------
// The first screen: "What are you planning?" (design spec, "The rule every
// choice answers to").
//
// An empty hall and a full hand ask a newcomer to know where to begin. So the
// first thing shown, while the floor is empty and nothing is known of the
// event, is one question with three large answers, each a photograph of what
// it leads to. An answer says what the day is and opens Your event, so the
// guest count is the next thing asked; the quiet words under them leave the
// hall empty for someone who would rather begin with their own hands. Either
// way it is not asked again on this page.
//
// It is the shelf, risen (the HUD's design note, "Sheets are the shelf, grown"): the
// same surface over the shelf's own contents, which stand aside while it
// shows (the frame's data-first-open, hud-first-open.css). The top bar stays,
// so the screen still says where you are and what follows.
// ---------------------------------------------------------------------------

const TITLE_ID = "hud-first-open-title";

interface FirstAnswer {
  readonly kind: PlannerEventKind;
  readonly name: string;
  readonly line: string;
  /** A rendered photograph of what this kind of day is built from, on its seamless ground. */
  readonly art: string;
}

const ANSWERS: readonly FirstAnswer[] = [
  { kind: "wedding", name: "Wedding", line: "Ceremony, dinner and dancing", art: "/models/furniture/setup-round/setup-v2/white-chiavari.webp" },
  { kind: "corporate", name: "Corporate", line: "Conference, dinner or awards", art: "/models/furniture/platform/crafted-v4/preview.webp" },
  { kind: "other", name: "Something else", line: "Tell us what you have in mind", art: "/models/furniture/setup-dance-floor/setup-v2/floor.webp" },
];

/**
 * Whether the first screen is showing: an empty floor, no kind of event, no
 * guest count, not yet answered or put aside on this page, and no sheet open
 * (a step pressed on the journey, or the view's tools, is answered first).
 */
export function useFirstOpenShowing(): boolean {
  const { plane } = useHudFacts();
  // The saved layout reaches the floor an effect after the first paint (EditorBridge), so its own objects are asked too.
  const placedNone = usePlacementStore((state) => state.placedItems.length === 0);
  const savedNone = useEditorStore((state) => state.objects.length === 0);
  const floorEmpty = placedNone && savedNone;
  const kindUnknown = usePlannerEventStore((state) => state.eventKind === null);
  const done = usePlannerHudStore((state) => state.firstOpenDone);
  const sheetOpen = usePlannerHudStore((state) => state.sheet !== null);
  const guestsUnknown = plane.guests === null || plane.guests === 0;
  return floorEmpty && kindUnknown && guestsUnknown && !done && !sheetOpen;
}

function answer(kind: PlannerEventKind): void {
  usePlannerEventStore.getState().setEventKind(kind);
  const hud = usePlannerHudStore.getState();
  hud.finishFirstOpen();
  hud.openSheet("event");
}

function putAside(): void {
  usePlannerHudStore.getState().finishFirstOpen();
}

export function FirstOpen(): ReactElement {
  // Escape is "Start with an empty hall": the question never holds anyone.
  useEscapeLayer("panel", { open: true, onEscape: putAside });
  // A card taken by its digit while the hand stands aside: they have begun with their own hands.
  useEffect(() => useCatalogueStore.subscribe((state, previous) => {
    if (state.armedCardId !== null && previous.armedCardId === null) putAside();
  }), []);
  return (
    <div className="hud-first-open" data-testid="hud-first-open">
      <section className="hud-first-open__stage" aria-labelledby={TITLE_ID}>
        <h2 className="hud-first-open__title" id={TITLE_ID}>What are you planning?</h2>
        <div className="hud-first-open__answers" role="radiogroup" aria-labelledby={TITLE_ID}>
          {ANSWERS.map((option) => (
            <button
              key={option.kind}
              type="button"
              role="radio"
              aria-checked={false}
              className="hud-first-open__answer"
              data-kind={option.kind}
              onClick={() => { answer(option.kind); }}
            >
              <span className="hud-first-open__art">
                <img src={option.art} alt="" draggable={false} decoding="async" />
              </span>
              <span className="hud-first-open__words">
                <span className="hud-first-open__name">{option.name}</span>
                <span className="hud-first-open__line">{option.line}</span>
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="hud-word hud-first-open__aside" onClick={putAside}>
          Start with an empty hall
        </button>
      </section>
    </div>
  );
}
