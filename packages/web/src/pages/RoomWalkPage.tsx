import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  RoomSplatScene,
  type RoomSplatProgress,
} from "../components/rooms/RoomSplatScene.js";
import {
  roomSplatBundle,
  roomSplatServedSplats,
  roomsWithSplatBundles,
} from "../data/room-splat-bundles.js";
import { isRoomWalkable } from "../data/room-walk-exposure.js";
import {
  TRADES_HALL_RUNTIME_ROOMS,
  type TradesHallRuntimeRoomSlug,
} from "../lib/runtime-package-resolution.js";
import "./RoomWalkPage.css";

// ---------------------------------------------------------------------------
// One room, walkable.
//
// Where a poster on the front door leads. The room fills the frame and the
// chrome floats over it — the room is the light source, and the interface is
// not the thing anyone came to look at.
//
// The scan is a working capture, not a survey, and the page says so plainly
// once rather than hedging in every line.
// ---------------------------------------------------------------------------

function displayName(slug: string): string {
  return TRADES_HALL_RUNTIME_ROOMS.find((room) => room.slug === slug)?.label ?? slug;
}

function isCapturedRoom(slug: string | undefined): slug is TradesHallRuntimeRoomSlug {
  return slug !== undefined && roomsWithSplatBundles().includes(slug);
}

/**
 * Load state for the offline poster renderer.
 *
 * In bare mode there is no loading pill to watch, and "the pill is absent" is
 * true before it mounts as well as after it goes — a false signal that captures
 * an empty room. This publishes the real counts instead, so the renderer waits
 * on something that can only be true once.
 */
declare global {
  interface Window {
    __roomWalk?: {
      settled: number;
      total: number;
      complete: boolean;
      /** The coarse first view is up. On a slow line the two moments are far apart. */
      firstView: boolean;
    };
  }
}

export function RoomWalkPage(): ReactElement {
  const params = useParams<{ roomSlug?: string }>();
  const [search] = useSearchParams();
  // ?bare=1 drops the chrome so the poster renderer captures only the room.
  // Done in React rather than by injecting CSS into a loaded page: injecting a
  // stylesheet after a heavy splat load forces a re-composite that stalls
  // screenshot capture indefinitely.
  const bare = search.get("bare") === "1";
  // Frame the room from outside. Only honest because the scene clips the
  // capture to the room's measured box first.
  const [progress, setProgress] = useState<RoomSplatProgress>({
    settled: 0, total: 0, splats: 0, failed: 0, complete: false, firstView: false,
  });
  const onProgress = useCallback((next: RoomSplatProgress) => {
    setProgress(next);
    window.__roomWalk = {
      settled: next.settled,
      total: next.total,
      complete: next.complete,
      firstView: next.firstView,
    };
  }, []);

  const room = isCapturedRoom(params.roomSlug) ? params.roomSlug : null;
  const bundle = room === null ? null : roomSplatBundle(room);

  const measured = useMemo(() => {
    if (bundle === null) return null;
    const [width, height, depth] = bundle.extentM;
    return `${width.toFixed(1)} × ${depth.toFixed(1)} × ${height.toFixed(1)} m`;
  }, [bundle]);

  if (room === null || bundle === null) {
    return (
      <main className="walk walk--missing">
        <p className="walk__missingText">That room has not been scanned.</p>
        <Link className="walk__back" to="/">Back to the rooms</Link>
      </main>
    );
  }

  // A capture that renders is not a room a visitor may stand in. Three rooms'
  // walk boxes cannot yet hold the room (see data/room-walk-exposure.ts), so
  // their door stays closed rather than placing someone through a wall.
  if (!isRoomWalkable(room)) {
    return (
      <main className="walk walk--missing" data-testid="room-walk-closed">
        <p className="walk__missingText">
          {displayName(room)} is being aligned and is not yet walkable.
        </p>
        <Link className="walk__back" to="/">Back to the rooms</Link>
      </main>
    );
  }

  const pct = progress.total === 0
    ? 0
    : Math.round((progress.settled / progress.total) * 100);

  return (
    <main className="walk" data-testid="room-walk">
      <div className="walk__stage">
        <RoomSplatScene key={room} room={room} onProgress={onProgress} captureReadback={bare} />
      </div>

      {!bare && <header className="walk__bar">
        <Link className="walk__back" to="/" aria-label="Back to the rooms">
          <span aria-hidden="true">←</span> Rooms
        </Link>
        <h1 className="walk__name">{displayName(room)}</h1>
        <p className="walk__measure">
          {/* Dimensions only where the scan measured cleanly; the count is
              always true, the measurement is not. */}
          {bundle.alignmentConfidence === "confident" && measured !== null && (
            <>
              {measured}
              <span className="walk__dot" aria-hidden="true">·</span>
            </>
          )}
          {roomSplatServedSplats(room).toLocaleString("en-GB")} splats
        </p>
      </header>}

      {/* The room arrives twice: a coarse view in seconds, then the full
          reconstruction. Saying "streaming" through both would call a room
          that is already on screen absent. */}
      {!bare && !progress.complete && (
        <p className="walk__loading" role="status" data-testid="walk-loading">
          {progress.firstView
            ? `Sharpening the room — ${String(pct)}%`
            : "Streaming the room"}
        </p>
      )}

      {!bare && <footer className="walk__foot">
        <p className="walk__note">
          {bundle.alignmentConfidence === "confident"
            ? "A working scan of the real room, not a survey. Dimensions are measured from the scan, not the venue's own figures."
            : "A working scan of the real room, not a survey. You can move where the scanner's operator walked; beyond that the scan has no data, so the room may end before its walls do. This room's alignment is still being checked, so no dimensions are given."}
        </p>
        {progress.failed > 0 && (
          <p className="walk__failed">{String(progress.failed)} parts of this room did not load.</p>
        )}
      </footer>}
    </main>
  );
}
