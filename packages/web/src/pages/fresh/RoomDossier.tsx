import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  CAPACITY_FORMATS,
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_ROOM_DIMENSIONS,
  VENUE_TRUTH_PROVENANCE,
  type RoomCapacity,
  type RoomDimensions,
} from "../../lib/trades-hall-venue-truth.js";
import { roomPlan } from "./room-plan.js";
import {
  FRESH_DOSSIER_CLOSE,
  FRESH_DOSSIER_CTA,
  FRESH_DOSSIER_DRAWN_NOTE,
  FRESH_DOSSIER_TWIN_CTA,
  FRESH_DOSSIER_WALK_CTA,
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

function dimsLine(dims: RoomDimensions): string {
  const base = `${String(dims.lengthM)} × ${String(dims.widthM)} m · ${String(dims.heightM)} m high`;
  return dims.note === undefined ? base : `${base} (${dims.note})`;
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

          {dims !== undefined && <p className="fr-dossier-dims">{dimsLine(dims)}</p>}

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
            {room.twinLook !== undefined ? (
              <a
                className="fr-cta-quiet"
                href={`${FRESH_TWIN_BASE}?${room.twinLook}`}
              >
                {FRESH_DOSSIER_TWIN_CTA}
              </a>
            ) : (
              <a className="fr-cta-quiet" href="#walk" onClick={onClose}>
                {FRESH_DOSSIER_WALK_CTA}
              </a>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
