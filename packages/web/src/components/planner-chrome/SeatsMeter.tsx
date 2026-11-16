import { useLayoutEffect, useRef, type ReactElement } from "react";
import { lastInputWasKeys } from "../../lib/planner-keys.js";
import { seatsInHand } from "../../lib/setup-cards.js";
import { meterShape } from "../../lib/slate-facts.js";
import { SPRING_PRESETS } from "../../lib/springs.js";
import { useSpringValue } from "../../lib/use-spring-value.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";
import "./cards.css";

// ---------------------------------------------------------------------------
// The seats meter (T-671; card-dock spec §9, Q-17): a 3 px bar at the joint
// between the rail and the dock. Copper fills from the left with seats over
// guests, spring-filled on detent and instant when the keys changed it; a
// sage tick at its end when everyone has a seat; the part past the room's
// published seats in the attention colour; a card's seats in hand as a cream
// segment. No digits anywhere: the plane carries the figures and speaks them.
// ---------------------------------------------------------------------------

function fraction(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export function SeatsMeter(): ReactElement | null {
  const figures = usePlannerChromeStore((state) => state.figures);
  const params = useCatalogueStore((state) => state.cardParams);
  const ref = useRef<HTMLDivElement>(null);
  const shape = figures === null
    ? null
    : meterShape({ ...figures, inHand: params === null ? 0 : seatsInHand(params) });

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || shape === null) return;
    element.style.setProperty("--pc-meter-target", fraction(shape.fill));
    element.style.setProperty("--pc-meter-hand", fraction(shape.handTo));
    element.style.setProperty("--pc-meter-over", shape.overFrom === null ? "1" : fraction(shape.overFrom));
  }, [shape]);

  useSpringValue(shape?.fill ?? 0, SPRING_PRESETS.detent, (value) => {
    ref.current?.style.setProperty("--pc-meter-fill", fraction(value));
  }, { instant: lastInputWasKeys(), epsilon: 0.001 });

  if (shape === null) return null;
  return (
    <div
      ref={ref}
      className={["pc-meter", shape.full ? "is-full" : "", shape.overFrom !== null ? "is-over" : ""].filter(Boolean).join(" ")}
      aria-hidden="true"
      data-testid="seats-meter"
    />
  );
}
