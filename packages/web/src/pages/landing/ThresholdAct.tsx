import { useRef, type MutableRefObject, type ReactElement } from "react";
import { FlameCanvas } from "./FlameCanvas.js";
import type { PointerMotion } from "./useCursorLight.js";
import { useSeen } from "./useSeen.js";
import {
  DARKNESS_FRAGMENTS,
  DARKNESS_LINES,
  THRESHOLD_ENTER_LABEL,
  THRESHOLD_LINE,
} from "./rite-copy.js";

// -----------------------------------------------------------------------------
// ThresholdAct — Beat 0 and Act I.
//
// Beat 0: near-black, one flame, one line, an Enter glyph. Act I: the descent
// — the cursor-carried light grazes edge-lit fragments of the architecture
// while two whispered lines pace the dark. Both live in scrollytelling
// sections: the outer section provides scroll distance, the inner stage is
// sticky and holds the composition.
// -----------------------------------------------------------------------------

interface DarknessLineProps {
  readonly text: string;
}

function DarknessLine({ text }: DarknessLineProps): ReactElement {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const seen = useSeen(ref, 0.6);
  return (
    <p ref={ref} className={`rite-dark-line${seen ? " is-seen" : ""}`}>
      {text}
    </p>
  );
}

export interface ThresholdActProps {
  readonly reducedMotion: boolean;
  /** True when this visitor already entered this session (no hold). */
  readonly enteredBefore: boolean;
  readonly pointerMotion: MutableRefObject<PointerMotion>;
  /** Flame renders only while threshold/darkness can be seen. */
  readonly flameActive: boolean;
}

export function ThresholdAct({
  reducedMotion,
  enteredBefore,
  pointerMotion,
  flameActive,
}: ThresholdActProps): ReactElement {
  const enter = (): void => {
    window.scrollTo({
      top: window.innerHeight,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  };

  return (
    <>
      <section
        className={`rite-act rite-threshold${enteredBefore ? " is-returning" : ""}`}
        aria-label="Threshold"
      >
        <div className="rite-stage">
          <div className="rite-flame-mount" aria-hidden>
            {/* CSS candle stays underneath: it IS the flame when WebGL is
                absent or motion is reduced, and the glow bed otherwise. */}
            <div className="rite-flame-fallback" />
            {!reducedMotion && (
              <FlameCanvas pointerMotion={pointerMotion} active={flameActive} />
            )}
          </div>
          <h1 className="rite-threshold-line">{THRESHOLD_LINE}</h1>
          <button type="button" className="rite-enter" onClick={enter}>
            {THRESHOLD_ENTER_LABEL} <span aria-hidden>↓</span>
          </button>
        </div>
      </section>

      <section className="rite-act rite-darkness" aria-label="The hall in darkness">
        <div className="rite-stage">
          <div className="rite-fragments" aria-hidden={reducedMotion ? undefined : true}>
            {DARKNESS_FRAGMENTS.map((fragment) => (
              <figure key={fragment.id} className={`rite-fragment rite-fragment-${fragment.id}`}>
                <img
                  src={fragment.image}
                  alt={fragment.alt}
                  loading="lazy"
                  decoding="async"
                  style={{ objectPosition: fragment.imagePosition }}
                />
              </figure>
            ))}
          </div>
          <div className="rite-dark-lines">
            {DARKNESS_LINES.map((line) => (
              <DarknessLine key={line} text={line} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
