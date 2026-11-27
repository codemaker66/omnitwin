import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  CAPACITY_FORMATS,
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_ROOM_DIMENSIONS,
  VENUE_TRUTH_PROVENANCE,
  type RoomCapacity,
  type RoomDimensions,
} from "@omnitwin/types";
import { roomPlan } from "./room-plan.js";
import {
  FRESH_DOSSIER_CLOSE,
  FRESH_DOSSIER_CTA,
  FRESH_DOSSIER_DRAWN_NOTE,
  FRESH_DOSSIER_TWIN_CTA,
  FRESH_TWIN_BASE,
  type FreshRoom,
} from "./fresh-copy.js";

// -----------------------------------------------------------------------------
// RoomDossier — a room's page-within-the-page, on a native <dialog>.
//
// No photograph in here: the card behind it already showed the room, and the
// no-repeat law counts rendered images. The dossier's job is the data the
// card can't carry — published dimensions, and each capacity format drawn
// to count by room-plan. Native dialog semantics give focus trapping and
// Esc for free; clicking the backdrop closes.
// -----------------------------------------------------------------------------

interface RoomDossierProps {
  readonly room: FreshRoom | null;
  readonly onClose: () => void;
}

/** The room's figures, a line for each stated extent: one for a room given as
 *  a whole, one per named section for a room the venue publishes in sections
 *  (the Robert Adam Room), in the venue's order. On each line the height's
 *  qualifier sits in brackets beside it, and a room with no stated height
 *  gives its length and width alone. The room's remark (the Grand Hall's
 *  dome) closes the last line as a sentence of its own, so the dome is never
 *  read as the height. */
function dimsLines(dims: RoomDimensions): readonly string[] {
  const lines = dims.extents.map((extent) => {
    const floor = `${String(extent.lengthM)} × ${String(extent.widthM)} m`;
    const sized = extent.heightM === undefined ? floor : `${floor} · ${String(extent.heightM)} m high`;
    const named = extent.section === undefined ? sized : `${extent.section} section ${sized}`;
    return extent.note === undefined ? named : `${named} (${extent.note})`;
  });
  const remark = dims.remark;
  if (remark === undefined) return lines;
  return lines.map((line, index) => (index === lines.length - 1 ? `${line}. ${remark}` : line));
}

export function RoomDossier({ room, onClose }: RoomDossierProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [format, setFormat] = useState<keyof RoomCapacity>("dinner");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (room !== null) {
      setFormat("dinner");
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [room]);

  // Native close (Esc) must inform the owner so state stays truthful.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    dialog.addEventListener("close", onClose);
    return () => {
      dialog.removeEventListener("close", onClose);
    };
  }, [onClose]);

  const caps = room === null ? null : TRADES_HALL_ROOM_CAPACITIES[room.slug];
  const dims = room === null ? undefined : TRADES_HALL_ROOM_DIMENSIONS[room.slug];
  const capacity = caps === null ? 0 : caps[format];
  const plan = roomPlan(format, capacity);
  const formatLabel =
    CAPACITY_FORMATS.find((f) => f.key === format)?.label ?? "";

  return (
    <dialog
      className="fr-dossier"
      ref={dialogRef}
      aria-label={room?.name}
      onClick={(event) => {
        // Only the backdrop region hits the dialog element itself.
        if (event.target === dialogRef.current) onClose();
      }}
    >
      {room !== null && caps !== null && (
        <div className="fr-dossier-panel">
          <header className="fr-dossier-head">
            <div>
              <h3>{room.name}</h3>
              <p>{room.line}</p>
            </div>
            <button type="button" className="fr-dossier-close" onClick={onClose}>
              {FRESH_DOSSIER_CLOSE}
            </button>
          </header>

          {dims !== undefined && (
            // A paragraph per line, so a room in two sections reads as two
            // statements to a screen reader and not as one run-on figure.
            <div className="fr-dossier-dims">
              {dimsLines(dims).map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}

          <div className="fr-enq-pills fr-dossier-pills">
            {CAPACITY_FORMATS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={format === f.key}
                onClick={() => {
                  setFormat(f.key);
                }}
              >
                {f.label} {caps[f.key]}
              </button>
            ))}
          </div>

          <figure className="fr-dossier-plan">
            <svg
              viewBox={`0 0 ${String(plan.width)} ${String(plan.height)}`}
              role="img"
              aria-label={`${room.name}, ${formatLabel.toLowerCase()}: ${String(plan.count)} places, ${FRESH_DOSSIER_DRAWN_NOTE}`}
            >
              <rect
                className="fr-plan-room"
                x="6"
                y="6"
                width={plan.width - 12}
                height={plan.height - 12}
                rx="8"
              />
              {plan.tables.map((table, index) => (
                <circle
                  key={`t${String(index)}`}
                  className="fr-plan-table"
                  cx={table.x}
                  cy={table.y}
                  r={table.r}
                />
              ))}
              {plan.dots.map((dot, index) => (
                <circle
                  key={`d${String(index)}`}
                  className="fr-plan-dot"
                  cx={dot.x}
                  cy={dot.y}
                  r={dot.r}
                />
              ))}
            </svg>
            <figcaption>
              {formatLabel} — <b>{plan.count}</b>, {FRESH_DOSSIER_DRAWN_NOTE}
            </figcaption>
          </figure>

          <p className="fr-dossier-prov">{VENUE_TRUTH_PROVENANCE.capacities}</p>

          <div className="fr-dossier-actions">
            <a className="fr-cta" href="#enquire" onClick={onClose}>
              {FRESH_DOSSIER_CTA}
            </a>
            {room.twinLook !== undefined && (
              <a
                className="fr-cta-quiet"
                href={`${FRESH_TWIN_BASE}?${room.twinLook}`}
              >
                {FRESH_DOSSIER_TWIN_CTA}
              </a>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
