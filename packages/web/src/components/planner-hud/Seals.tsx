import { useMemo, useRef, useState, type ReactElement } from "react";
import { roomSeals, type RoomSeal } from "../../lib/hud/room-seals.js";
import { SPRING_PRESETS } from "../../lib/springs.js";
import { useSpringCssVariable } from "../../lib/use-spring-value.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { usePlannerHudStore } from "../../stores/planner-hud-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useToolStore } from "../../stores/tool-store.js";
import { useHudFacts } from "./hud-facts.js";
import { SealGlyph } from "./glyphs.js";

// ---------------------------------------------------------------------------
// "Your room": the seals down the left (design spec, "The stations").
//
// Each seal is one fact, lit when there is nothing left to do about it. A
// press says what it is reading, in one sentence, and where a press can help
// it does: a waiting seal takes its card, a blocked door or a tight gap
// chooses the pieces concerned.
// ---------------------------------------------------------------------------

/** The seats ring's length (r = 17 in a 40 px box). */
const RING_LENGTH = 2 * Math.PI * 17;

function SeatsRing({ progress }: { readonly progress: number }): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);
  useSpringCssVariable(ref, "--hud-ring", progress * RING_LENGTH, SPRING_PRESETS.dialGlide, { unit: "" });
  return (
    <span ref={ref} className="hud-seal__ring">
      <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <circle className="hud-seal__ring-track" cx="20" cy="20" r="17" />
        <circle className="hud-seal__ring-fill" cx="20" cy="20" r="17" pathLength={RING_LENGTH} />
      </svg>
    </span>
  );
}

function SealKey({ seal, open, onToggle }: { readonly seal: RoomSeal; readonly open: boolean; readonly onToggle: () => void }): ReactElement {
  const facts = useHudFacts();
  const press = (): void => {
    onToggle();
    if (seal.card !== null) {
      useToolStore.getState().setTool("select");
      usePlannerHudStore.getState().closeSheet();
      useCatalogueStore.getState().armCard(seal.card);
      return;
    }
    if (seal.id === "seats" && seal.state !== "lit") {
      usePlannerHudStore.getState().openSheet(seal.state === "waiting" ? "event" : "layout");
      return;
    }
    if (seal.id === "doors" && seal.state === "attention") {
      const first = facts.doors?.blockers[0];
      if (first !== undefined) useSelectionStore.getState().selectMultiple([...first.ids]);
      return;
    }
    if (seal.id === "aisles" && seal.state === "attention") {
      const pair = facts.aisles.tightestPair;
      if (pair !== null) useSelectionStore.getState().selectMultiple([pair.aId, pair.bId]);
    }
  };
  const said = seal.value === null ? seal.label : `${seal.label}, ${seal.value}`;
  return (
    <li className="hud-seal-slot">
      <button
        type="button"
        className="hud-seal"
        data-seal={seal.id}
        data-state={seal.state}
        aria-expanded={open}
        aria-label={`${said}. ${seal.detail}`}
        onClick={press}
      >
        <span className="hud-seal__mark">
          {seal.id === "seats" ? <SeatsRing progress={seal.progress ?? 0} /> : <SealGlyph id={seal.id} />}
        </span>
        <span className="hud-seal__words">
          <span className="hud-seal__label">{seal.label}</span>
          {seal.value !== null ? <span className="hud-seal__value">{seal.value}</span> : null}
        </span>
      </button>
      {open ? <p className="hud-seal__detail">{seal.detail}</p> : null}
    </li>
  );
}

export function Seals(): ReactElement {
  const facts = useHudFacts();
  const seals = useMemo(() => roomSeals(facts), [facts]);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <aside className="hud-seals" aria-label="Your room">
      <h2 className="hud-seals__title">Your room</h2>
      <ul className="hud-seals__list" role="list">
        {seals.map((seal) => (
          <SealKey
            key={seal.id}
            seal={seal}
            open={openId === seal.id}
            onToggle={() => { setOpenId((current) => (current === seal.id ? null : seal.id)); }}
          />
        ))}
      </ul>
    </aside>
  );
}
