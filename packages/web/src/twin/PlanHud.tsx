import { useRef, type KeyboardEvent, type ReactElement } from "react";
import { scaleBarSpec, type PlanStorey } from "./plan-mode.js";
import "./plan.css";

// -----------------------------------------------------------------------------
// PlanHud — the plan's DOM chrome: the storey switcher and the scale bar.
//
// The switcher speaks the twin's storey language: relational level names with
// the VALIDATED rooms beneath them, never scanner floor numbers (the
// "Floor -1" class of claim is banned) and never a storey name nobody
// confirmed. One storey renders no switcher at all — a control with one
// option is furniture.
//
// The scale bar restates the orthographic zoom as a measured length on the
// 1-2-5 ladder. It is an INSTRUMENT, not decoration: its width in px is
// exactly metres × zoom, which is what makes the plan a drawing to scale —
// and it disappears rather than lie when the scale is degenerate.
// -----------------------------------------------------------------------------

export interface PlanHudProps {
  readonly storeys: readonly PlanStorey[];
  /** The active storey's floor bucket. */
  readonly activeFloor: number;
  readonly onSelectFloor: (floor: number) => void;
  /** Live orthographic zoom — px per metre. */
  readonly pxPerMetre: number;
}

/** The storey switcher — a vertical radiogroup, roving tabindex, arrow keys
 *  moving both selection and focus (the TwinModeControl grammar). */
function PlanStoreyControl({
  storeys,
  activeFloor,
  onSelectFloor,
}: Pick<PlanHudProps, "storeys" | "activeFloor" | "onSelectFloor">): ReactElement | null {
  const buttonsRef = useRef(new Map<number, HTMLButtonElement | null>());

  if (storeys.length < 2) {
    return null;
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const index = storeys.findIndex((storey) => storey.floor === activeFloor);
    const next = storeys[(index + step + storeys.length) % storeys.length];
    if (next !== undefined) {
      onSelectFloor(next.floor);
      buttonsRef.current.get(next.floor)?.focus();
    }
  };

  return (
    <div
      className="vv-twin-plan-storeys"
      role="radiogroup"
      aria-label="Storey"
      data-testid="twin-plan-storeys"
      onKeyDown={onKeyDown}
    >
      {storeys.map((storey) => (
        <button
          key={storey.floor}
          ref={(element) => {
            buttonsRef.current.set(storey.floor, element);
          }}
          type="button"
          role="radio"
          aria-checked={storey.floor === activeFloor}
          tabIndex={storey.floor === activeFloor ? 0 : -1}
          className={
            storey.floor === activeFloor
              ? "vv-twin-plan-storey vv-twin-plan-storey--active"
              : "vv-twin-plan-storey"
          }
          onClick={() => {
            onSelectFloor(storey.floor);
          }}
        >
          <span className="vv-twin-plan-storey-label">{storey.label}</span>
          {storey.roomNames.length > 0 && (
            <span className="vv-twin-plan-storey-rooms">
              {storey.roomNames.join(" · ")}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** The scale bar — a measured length with end ticks and its figure. */
function PlanScaleBar({ pxPerMetre }: { readonly pxPerMetre: number }): ReactElement | null {
  const spec = scaleBarSpec(pxPerMetre);
  if (spec === null) {
    return null;
  }
  return (
    <div className="vv-twin-plan-scale" data-testid="twin-plan-scale" aria-hidden>
      <span className="vv-twin-plan-scale-bar" style={{ width: `${String(spec.px)}px` }} />
      <span className="vv-twin-plan-scale-label">{spec.label}</span>
    </div>
  );
}

export function PlanHud({
  storeys,
  activeFloor,
  onSelectFloor,
  pxPerMetre,
}: PlanHudProps): ReactElement {
  return (
    <div className="vv-twin-plan-hud">
      <PlanStoreyControl
        storeys={storeys}
        activeFloor={activeFloor}
        onSelectFloor={onSelectFloor}
      />
      <PlanScaleBar pxPerMetre={pxPerMetre} />
    </div>
  );
}
