import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ActivityStatus } from "../components/shared/Activity.js";
import {
  RoomSplatScene,
  type RoomSplatProgress,
} from "../components/rooms/RoomSplatScene.js";
import {
  roomSplatBundle,
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
      /** Gaussians currently drawn, so a measurement says WHICH room it timed. */
      splats: number;
      failed: number;
      /** What the page is telling the visitor right now, verbatim. */
      status: string;
    };
  }
}

/**
 * Whether this browser can put an element full-screen.
 *
 * Not universal, and the gap is exactly where it matters: an iPhone's Safari
 * has no `Element.requestFullscreen` at all, while an iPad's does. So the
 * control is offered only where it works rather than shown and then failing
 * silently, which is worse than its absence.
 */
function canGoFullscreen(): boolean {
  return typeof document !== "undefined"
    && document.fullscreenEnabled
    && typeof document.documentElement.requestFullscreen === "function";
}

/**
 * What the pill says, and whether it may show a number.
 *
 * The pill used to flip to "Sharpening the room — 0%" the moment the coarse
 * room landed, and sit there for the whole finest level: 101.5 MB over eleven
 * tiles in the Grand Hall, which is minutes on a phone. Nought per cent is the
 * one number that reads as broken, and it was being shown at the exact moment
 * the room had in fact just arrived.
 *
 * So a percentage is offered only once there is one to back. Three states:
 * nothing on screen yet, the room on screen and sharpening with no countable
 * progress, and sharpening with tiles actually in. The floor of 1 % matters
 * for the same reason: a first tile out of a large set rounds to zero, and
 * zero is the thing that must never be shown once something has happened.
 */
export function walkStatusLine(
  progress: RoomSplatProgress,
): { readonly label: string; readonly percent: number | undefined } {
  if (!progress.firstView) return { label: "Streaming the room", percent: undefined };
  if (progress.total === 0 || progress.settled === 0) {
    return { label: "The room is here. Sharpening it.", percent: undefined };
  }
  const percent = Math.max(1, Math.round((progress.settled / progress.total) * 100));
  return { label: `Sharpening the room — ${String(percent)}%`, percent };
}

/** How long a lost view is given to come back before a reload is offered. */
const CONTEXT_RECOVERY_GRACE_MS = 6_000;

export function RoomWalkPage(): ReactElement {
  const params = useParams<{ roomSlug?: string }>();
  const [search] = useSearchParams();
  // ?bare=1 drops the chrome so the poster renderer captures only the room.
  // Done in React rather than by injecting CSS into a loaded page: injecting a
  // stylesheet after a heavy splat load forces a re-composite that stalls
  // screenshot capture indefinitely.
  const bare = search.get("bare") === "1";
  // The kill order for touch (T-617). `?touch=tap` keeps tap-to-glide and
  // withdraws hold-to-walk and the pinch, so the gesture set can be pulled
  // back from a device that handles it badly without a deploy and without
  // taking the room away. Nothing links to it; it is an operator's switch.
  const touchLocomotion = search.get("touch") === "tap" ? "tap-only" : "full";
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
      splats: next.splats,
      failed: next.failed,
      // The ledger carries the words as well as the numbers: a measurement
      // that cannot say what the visitor was being told is half a measurement.
      status: walkStatusLine(next).label,
    };
  }, []);

  // The drawing context can be taken away at any moment — heat, a background
  // tab, a driver reset. The scene prevents the default so the browser may
  // restore it; this is only what the visitor is told meanwhile.
  const [rendererLost, setRendererLost] = useState(false);
  const [recoveryGaveUp, setRecoveryGaveUp] = useState(false);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRendererLost = useCallback((lost: boolean) => {
    setRendererLost(lost);
    if (graceTimer.current !== null) clearTimeout(graceTimer.current);
    graceTimer.current = null;
    if (!lost) { setRecoveryGaveUp(false); return; }
    // Offer the reload only after the view has had a fair chance to come
    // back. Offering it immediately would make an interruption that usually
    // resolves in under a second look like a failure.
    graceTimer.current = setTimeout(() => { setRecoveryGaveUp(true); }, CONTEXT_RECOVERY_GRACE_MS);
  }, []);
  useEffect(() => () => {
    if (graceTimer.current !== null) clearTimeout(graceTimer.current);
  }, []);

  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenOffered] = useState(canGoFullscreen);
  useEffect(() => {
    const sync = (): void => { setFullscreen(document.fullscreenElement !== null); };
    document.addEventListener("fullscreenchange", sync);
    return () => { document.removeEventListener("fullscreenchange", sync); };
  }, []);
  const toggleFullscreen = useCallback(() => {
    // A rejected promise here is not a failure worth a message: the browser
    // has already declined, the room is still on screen, and the control
    // simply stays as it was.
    if (document.fullscreenElement === null) {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    } else {
      void document.exitFullscreen().catch(() => undefined);
    }
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

  const status = walkStatusLine(progress);

  return (
    <main className="walk" data-testid="room-walk">
      <div className="walk__stage">
        <RoomSplatScene
          key={room}
          room={room}
          onProgress={onProgress}
          onRendererLost={onRendererLost}
          touchLocomotion={touchLocomotion}
          captureReadback={bare}
        />
      </div>

      {!bare && <header className="walk__bar">
        <Link className="walk__back" to="/" aria-label="Back to the rooms">
          <span aria-hidden="true">←</span> Rooms
        </Link>
        <h1 className="walk__name">{displayName(room)}</h1>
        {bundle.alignmentConfidence === "confident" && measured !== null && (
          <p className="walk__measure">{measured}</p>
        )}
        {/* A visitor's door, and nothing else. The staff entrances that used
            to sit here — the dashboard, the hallkeeper's day, the log-in —
            belong to people who already know where they are; on a public page
            they are three invitations to a locked room. */}
        <nav className="walk__navigation" aria-label="Planning this room">
          {/* A document navigation starts a fresh plan for this room even after
              another room's configuration has been opened in the editor. */}
          <a className="walk__plan" href={`/plan?space=${room}`}>Plan this room</a>
          {fullscreenOffered && (
            <button
              type="button"
              className="walk__fullscreen"
              data-testid="walk-fullscreen"
              onClick={toggleFullscreen}
              aria-pressed={fullscreen}
            >
              {fullscreen ? "Leave full screen" : "Full screen"}
            </button>
          )}
        </nav>
      </header>}

      {/* The room arrives twice: a coarse view in seconds, then the full
          reconstruction. Saying "streaming" through both would call a room
          that is already on screen absent — and a percentage is only offered
          once there is one to stand behind. */}
      {!bare && !progress.complete && !rendererLost && (
        <p className="walk__loading" data-testid="walk-loading">
          <ActivityStatus progress={status.percent}>{status.label}</ActivityStatus>
        </p>
      )}

      {/* The view was taken away. Calm, because it usually comes straight
          back; and after a fair wait, a way out that is a link rather than a
          dialog — nothing here should trap anyone. */}
      {!bare && rendererLost && (
        <p className="walk__loading walk__loading--lost" data-testid="walk-context-lost">
          <ActivityStatus>
            {recoveryGaveUp
              ? "The view has not come back."
              : "The view paused. Bringing the room back."}
          </ActivityStatus>
          {recoveryGaveUp && (
            <button
              type="button"
              className="walk__reload"
              data-testid="walk-reload"
              onClick={() => { window.location.reload(); }}
            >
              Reload the room
            </button>
          )}
        </p>
      )}

      {!bare && <footer className="walk__foot">
        <p className="walk__note">
          {bundle.alignmentConfidence === "confident"
            ? "Scan dimensions are estimates. Confirm with the venue."
            : "Incomplete scan. Alignment is under review; dimensions unavailable."}
        </p>
        {progress.failed > 0 && (
          <p className="walk__failed">{String(progress.failed)} parts of this room did not load.</p>
        )}
      </footer>}
    </main>
  );
}
