import { useLayoutEffect, useRef, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { ArrivalArtwork } from "../shared/RouteArrival.js";

/** A top-layer welcome leaves the Canvas mounted and drawing underneath.
 * Native modal focus/inert behavior also prevents accidental furniture edits. */
export function PlannerArrival({ onEnter }: {
  readonly onEnter: () => void;
}): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  return createPortal(
    <dialog ref={dialogRef} className="planner-arrival" aria-label="Opening the Grand Hall"
      onKeyDown={(event) => { event.stopPropagation(); }}
      onKeyUp={(event) => { event.stopPropagation(); }}
      onCancel={(event) => { event.preventDefault(); onEnter(); }}>
      <ArrivalArtwork isGrandHall onEnter={onEnter} />
    </dialog>,
    document.body,
  );
}
