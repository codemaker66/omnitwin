import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { BOARD_COPY } from "../board-copy.js";
import { formatWallTime } from "../lib/board-time.js";

// ---------------------------------------------------------------------------
// The paper chip that follows a slip dragged from the enquiry tray (C1).
// It tracks the cursor itself, writing its own position on pointermove, so
// the page holds only what changes the drop (lane + snapped start) and does
// not re-render the board for every pixel of travel.
// ---------------------------------------------------------------------------

const OFFSET_X = 12;
const OFFSET_Y = 10;

export interface EnquiryDragGhostProps {
  readonly name: string;
  /** The snapped pencil time over a lane; null while seeking one. */
  readonly startMs: number | null;
  /** Where the drag began — the chip's position until the pointer moves. */
  readonly originX: number;
  readonly originY: number;
}

export function EnquiryDragGhost({ name, startMs, originX, originY }: EnquiryDragGhostProps): ReactElement {
  const chipRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const chip = chipRef.current;
      if (chip === null) return;
      chip.style.left = `${String(event.clientX + OFFSET_X)}px`;
      chip.style.top = `${String(event.clientY + OFFSET_Y)}px`;
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  // React writes left/top only when the origin changes (a new drag); between
  // those, the listener above owns them.
  return (
    <div
      ref={chipRef}
      className="diary-enquiry-ghost"
      style={{ left: originX + OFFSET_X, top: originY + OFFSET_Y }}
      aria-hidden="true"
    >
      <span className="diary-tray-item-title">{name}</span>
      <span className="diary-enquiry-ghost-time">
        {startMs !== null
          ? BOARD_COPY.trayEnquiries.dropAt(formatWallTime(startMs))
          : BOARD_COPY.trayEnquiries.dropSeeking}
      </span>
    </div>
  );
}
