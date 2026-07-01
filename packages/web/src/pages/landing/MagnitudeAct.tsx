import { useMemo, useRef, type ReactElement } from "react";
import { RiteCountUp } from "./RiteCountUp.js";
import { useSeen } from "./useSeen.js";
import {
  MAGNITUDE_KICKER,
  buildMagnitudeMeasures,
  type MagnitudeMeasure,
} from "./rite-copy.js";
import { tradesHallVenueImages } from "../../lib/trades-hall-room-showcase.js";

// -----------------------------------------------------------------------------
// MagnitudeAct — Act II, the mathematical sublime.
//
// The hard cut out of darkness: the Grand Hall ceiling full-bleed, then the
// measures as typographic architecture. The first figure (21) is set at
// viewport height with metre-etchings behind it — deliberately larger than
// the screen can politely hold; Kant's point is the overflow. Numbers resolve
// from that overflow into calm, measured fact as they enter view.
// -----------------------------------------------------------------------------

interface MeasureBlockProps {
  readonly measure: MagnitudeMeasure;
  readonly monument: boolean;
  readonly reducedMotion: boolean;
}

function MeasureBlock({ measure, monument, reducedMotion }: MeasureBlockProps): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const seen = useSeen(ref, 0.4);
  const cls = `rite-measure${monument ? " is-monument" : ""}${seen ? " is-seen" : ""}`;
  return (
    <div ref={ref} className={cls}>
      <span className="rite-measure-figure">
        {measure.countTo !== null ? (
          <RiteCountUp to={measure.countTo} static={reducedMotion} />
        ) : (
          measure.figure
        )}
        {monument && <span className="rite-measure-etchings" aria-hidden />}
      </span>
      <span className="rite-measure-label">{measure.label}</span>
    </div>
  );
}

export interface MagnitudeActProps {
  readonly reducedMotion: boolean;
}

export function MagnitudeAct({ reducedMotion }: MagnitudeActProps): ReactElement {
  const measures = useMemo(() => buildMagnitudeMeasures(), []);
  const domeRef = useRef<HTMLElement | null>(null);
  const domeSeen = useSeen(domeRef, 0.25);

  return (
    <section className="rite-act rite-magnitude" aria-label="The measure of the Grand Hall">
      <figure
        ref={domeRef}
        className={`rite-dome${domeSeen ? " is-seen" : ""}`}
      >
        <img
          src={tradesHallVenueImages.grandHall}
          alt="The ceiling of the Grand Hall from below, chandeliers against the dome"
          loading="lazy"
          decoding="async"
        />
        <figcaption className="rite-kicker">{MAGNITUDE_KICKER}</figcaption>
      </figure>

      <div className="rite-measures">
        {measures.map((measure, index) => (
          <MeasureBlock
            // The measures list is a fixed dramaturgy — positional identity
            // is the stable key (labels are prose and may repeat one day).
            key={`measure-${String(index)}`}
            measure={measure}
            monument={index === 0}
            reducedMotion={reducedMotion}
          />
        ))}
      </div>
    </section>
  );
}
