import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import type { TwinNavEdge } from "@omnitwin/types";
import { prefersReducedMotion } from "../reduced-motion.js";
import { ROOM_DISPLAY_NAMES } from "../shell/twin-rooms.js";
import { HOP_SPRING } from "../useTwinWalk.js";
import {
  TOUR_ENDED_NOTE,
  TOUR_GROUP_LABEL,
  TOUR_NEXT_LABEL,
  TOUR_PAUSED_NOTE,
  TOUR_PAUSE_LABEL,
  TOUR_PLAY_LABEL,
  TOUR_PREVIOUS_LABEL,
  TOUR_REPLAY_LABEL,
  tourAnnouncement,
  tourEyebrow,
  tourLengthLine,
  tourStopLabel,
} from "./tour-copy.js";
import {
  advanceStop,
  hopDurationMs,
  resolveTourLeg,
  retreatStop,
  tourDurationMs,
  type Tour,
  type TourLeg,
  type TourStop,
} from "./tour-model.js";
import "./tour.css";

// -----------------------------------------------------------------------------
// TourControls — press play and the building shows itself.
//
// Most visitors to a venue tour never drive. They arrive from a link, look at
// the first frame, and either press one button or leave. So this is the front
// door of the product, and it is judged on two things: whether it moves through
// the building convincingly, and whether it gets out of the way the instant it
// is not wanted.
//
// THE ONE BEHAVIOUR THAT DECIDES WHETHER THIS IS A FEATURE OR AN IRRITATION
//
// The moment the visitor touches the view, the tour pauses. Not "the tour
// finishes its current flight", not "the tour resumes after five seconds" — it
// stops, and it says so. Anything that keeps moving the camera after a person
// has grabbed it is fighting them for their own hands, and every visitor who has
// met that once distrusts the whole interface afterwards.
//
// The listener is on `window`, in the capture phase, filtered to events that did
// not originate inside this component's own DOM. That last clause is the whole
// trick: pressing Next is a pointerdown too, and a naive listener would pause the
// tour on the very button meant to advance it. Everything else — a drag on the
// canvas, a wheel zoom, a WASD keypress, a tap on the minimap — is the visitor
// taking the view, and the tour lets them have it.
//
// WHY THE HOST STILL DRIVES THE CAMERA
//
// This component owns the sequence and the clock. It does not own the walk. It
// asks — `onGoToStop(stop, leg)` — and reads the answer back through
// `currentNodeId` and `travelling`. The dwell timer only starts once the walk
// says it has ARRIVED, which is why a slow route or a stalled pano cannot desync
// the captions from the view: the title card and the room are the same fact,
// arriving together, or the card waits.
//
// The leg is resolved by tour-model.ts using the same fallback ladder as
// TwinViewer's `usherTo` (glide the corridor; teleport when unreachable, too far,
// or under reduced motion), so a room reached by the tour moves exactly like a
// room reached from the quick rail. The host's job is mechanical: hand
// `leg.hops` to the Usher queue, or teleport, and apply `leg.look` if it is not
// null. Nothing about which room this is, or what may be said about it, is
// decided here — that lives in twin-rooms.ts and cannot be reached from this file
// except through a stop the model already validated.
//
// REDUCED MOTION
//
// No camera flights: `instant: true` on every leg, so each stop is a cut. The
// dwell is KEPT — the preference is about motion, not about being hurried
// through a building — and the sweeping dwell bar is not rendered at all, because
// its entire content is its own movement and the stop markers already say the
// same thing without moving. tour.css strips the entrances to match.
// -----------------------------------------------------------------------------

export interface TourControlsProps {
  /** The sequence to play. Build it with buildDefaultTour(); a tour with no
   *  stops renders nothing at all rather than an empty player. */
  readonly tour: Tour;
  /** The viewpoint underfoot, straight from the walk (`walk.currentId`). The
   *  dwell clock will not start until this equals the current stop's node. */
  readonly currentNodeId: string;
  /** True while the walk is in flight — `hopping || usherQueue.length > 0`.
   *  Holds the clock, so a long corridor never eats a stop's dwell. */
  readonly travelling: boolean;
  /** The nav graph, for resolving each leg. `manifest.edges`. */
  readonly edges: readonly TwinNavEdge[];
  /**
   * Take the walk to a stop. Called once per stop change, never per frame.
   *
   *   leg.mode "glide"  → setUsherQueue(leg.hops)
   *   leg.mode "jump"   → walk.hopTo(leg.nodeId, { teleport: true })
   *   leg.mode "stay"   → nothing to travel; already standing there
   *
   * and in every case, if `leg.look` is not null, aim the camera at it.
   */
  readonly onGoToStop: (stop: TourStop, leg: TourLeg) => void;
  /** Announced whenever play state changes — the host uses it to drop any
   *  in-flight Usher queue the moment the visitor takes the view back. */
  readonly onPlayingChange?: (playing: boolean) => void;
  /** The last stop's dwell has elapsed. Fires once per completed run. */
  readonly onEnded?: () => void;
  /** Wrap past the last stop instead of ending. Off by default: an unattended
   *  tour that restarts forever is a screensaver. */
  readonly loop?: boolean;
}

/** 15px reads level with the 9.5px mono eyebrow inside a 30px control; smaller
 *  and the transport glyphs stop being legible over bright imagery. */
const ICON_SIZE = 15;

interface IconProps {
  readonly size?: number;
}

function PlayIcon({ size = ICON_SIZE }: IconProps): ReactElement {
  return (
    <svg
      className="vv-twin-tour-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

function PauseIcon({ size = ICON_SIZE }: IconProps): ReactElement {
  return (
    <svg
      className="vv-twin-tour-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 5h3v14H8zM13 5h3v14h-3z" />
    </svg>
  );
}

function PreviousIcon(): ReactElement {
  return (
    <svg
      className="vv-twin-tour-icon"
      viewBox="0 0 24 24"
      width={ICON_SIZE}
      height={ICON_SIZE}
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 6h2v12H8zM18 6v12l-8-6z" />
    </svg>
  );
}

function NextIcon(): ReactElement {
  return (
    <svg
      className="vv-twin-tour-icon"
      viewBox="0 0 24 24"
      width={ICON_SIZE}
      height={ICON_SIZE}
      fill="currentColor"
      aria-hidden
    >
      <path d="M14 6h2v12h-2zM6 6v12l8-6z" />
    </svg>
  );
}

/**
 * Where the dwell clock had got to, tagged with the stop it belongs to.
 *
 * The tag is what makes pause/resume correct without a second timer. The dwell
 * effect's cleanup writes the remaining time under the index it was counting
 * for; when the index has since changed, the next run sees a tag that does not
 * match and starts the new stop from full. Without the tag, pausing on stop 2
 * and then pressing Next would give stop 3 whatever was left of stop 2.
 */
interface DwellRemainder {
  readonly index: number;
  readonly remainingMs: number;
}

/** Events that mean "the visitor has taken the view". Capture phase, so a
 *  handler that stops propagation further down cannot hide the intent. */
const INTERRUPT_EVENTS = ["pointerdown", "wheel", "keydown", "touchstart"] as const;

export function TourControls({
  tour,
  currentNodeId,
  travelling,
  edges,
  onGoToStop,
  onPlayingChange,
  onEnded,
  loop = false,
}: TourControlsProps): ReactElement | null {
  const total = tour.stops.length;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  /** Whether the tour has ever been started. Before it has, the card is an
   *  invitation — the title and how long it takes — and the camera is untouched. */
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  /**
   * The stop the CARD is describing — which is the last one the walk actually
   * arrived at, not the one it is heading for.
   *
   * The distinction is the room-identity rule applied to time. `index` moves the
   * instant the visitor presses Next; the walk takes a corridor to catch up. A
   * card bound to `index` therefore prints "The Grand Hall again, from elsewhere
   * in the room" over a photograph of the Saloon for as long as the journey
   * lasts — the exact sentence this product must never say, arrived at not by
   * inferring a room but by being early about one.
   *
   * So the card follows arrival and the stop MARKERS follow intent: the press is
   * acknowledged instantly by the gold marker moving and the camera setting off,
   * and the words wait until they are true. Null until the first arrival, which
   * is why an opening journey shows the tour's own title rather than a room.
   */
  const [shownIndex, setShownIndex] = useState<number | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  /** The last index travel was requested for, so a re-render caused by the walk
   *  moving cannot re-issue the same journey. */
  const requestedIndexRef = useRef<number | null>(null);
  const dwellRef = useRef<DwellRemainder | null>(null);
  const playingRef = useRef(playing);

  // Host callbacks behind refs. TwinViewer will pass inline arrows, and an
  // effect that depended on them directly would re-run — and so re-issue travel,
  // or restart a dwell — on every parent render, which during a walk is every
  // frame. The refs are updated on each render, so the effects always call the
  // current callback while depending on none of them.
  const onGoToStopRef = useRef(onGoToStop);
  const onPlayingChangeRef = useRef(onPlayingChange);
  const onEndedRef = useRef(onEnded);
  onGoToStopRef.current = onGoToStop;
  onPlayingChangeRef.current = onPlayingChange;
  onEndedRef.current = onEnded;

  // Read at render rather than cached: the visitor may change the OS setting
  // mid-session, and this decides both what is drawn and how the camera travels.
  const reduceMotion = prefersReducedMotion();

  const stop: TourStop | undefined = tour.stops[index];
  const arrived = !travelling && stop !== undefined && currentNodeId === stop.nodeId;

  const hopMs = useMemo(() => hopDurationMs(HOP_SPRING.stiffness, HOP_SPRING.damping), []);

  // Only ever read before the first play, so the Dijkstra runs happen while the
  // visitor is standing still, never during a walk.
  const lengthMinutes = useMemo(() => {
    if (started || total === 0) {
      return 0;
    }
    const ms = tourDurationMs(tour, currentNodeId, edges, { hopMs, instant: reduceMotion });
    return Math.max(1, Math.round(ms / 60_000));
  }, [started, total, tour, currentNodeId, edges, hopMs, reduceMotion]);

  /** Move the tour to a stop. Starting the tour IS going to a stop, so every
   *  entry point — play, next, previous, a marker — funnels through here. */
  const goToIndex = useCallback((next: number): void => {
    setStarted(true);
    setEnded(false);
    setIndex(next);
  }, []);

  // Report play-state changes exactly once each, from one place. Doing it in the
  // handlers instead would mean four call sites and one of them eventually
  // forgetting — and the host uses this to drop an in-flight Usher queue, so a
  // missed report leaves the camera gliding after the visitor grabbed it.
  useEffect(() => {
    if (playingRef.current === playing) {
      return;
    }
    playingRef.current = playing;
    onPlayingChangeRef.current?.(playing);
  }, [playing]);

  // Travel. Keyed on the index alone: the walk's own progress must not re-trigger
  // the journey it is already making. currentNodeId is READ here — it is the
  // origin at the moment the journey is decided, which is exactly right — but
  // depending on it would re-run this effect at every hop of the route it just
  // asked for, and each re-run would re-request the remainder from the new
  // origin. The request guard is what makes reading it safe.
  const currentNodeIdRef = useRef(currentNodeId);
  currentNodeIdRef.current = currentNodeId;
  useEffect(() => {
    if (!started) {
      return;
    }
    const target = tour.stops[index];
    if (target === undefined || requestedIndexRef.current === index) {
      return;
    }
    requestedIndexRef.current = index;
    const leg = resolveTourLeg(currentNodeIdRef.current, target, edges, {
      instant: reduceMotion,
    });
    onGoToStopRef.current(target, leg);
  }, [started, index, tour, edges, reduceMotion]);

  // The dwell clock. It starts only once the walk has actually arrived, so the
  // caption on screen and the room in view are never two different rooms.
  useEffect(() => {
    // `arrived` already carries "there is a stop here" — it is false whenever
    // tour.stops[index] is undefined — so it narrows `stop` on its own.
    if (!playing || !arrived) {
      return;
    }
    const remainder = dwellRef.current;
    const remaining =
      remainder !== null && remainder.index === index ? remainder.remainingMs : stop.dwellMs;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => {
      dwellRef.current = null;
      const next = advanceStop(tour, index, { loop });
      if (next === null) {
        setPlaying(false);
        setEnded(true);
        onEndedRef.current?.();
        return;
      }
      setIndex(next);
    }, remaining);
    return () => {
      window.clearTimeout(timer);
      // Tagged with the index this run was counting for; a later run under a
      // different index ignores it. See DwellRemainder.
      dwellRef.current = {
        index,
        remainingMs: Math.max(0, remaining - (Date.now() - startedAt)),
      };
    };
  }, [playing, arrived, stop, index, tour, loop]);

  // The interruption. Everything the visitor can do to the view, caught before
  // it reaches whatever handles it, and ignored when it came from these controls.
  useEffect(() => {
    if (!playing) {
      return;
    }
    const takeover = (event: Event): void => {
      const root = rootRef.current;
      const target: EventTarget | null = event.target;
      if (root !== null && target instanceof Node && root.contains(target)) {
        return;
      }
      setPlaying(false);
    };
    for (const type of INTERRUPT_EVENTS) {
      window.addEventListener(type, takeover, { capture: true, passive: true });
    }
    return () => {
      for (const type of INTERRUPT_EVENTS) {
        window.removeEventListener(type, takeover, { capture: true });
      }
    };
  }, [playing]);

  // The card catches up with the walk. Only on arrival — see shownIndex — and
  // only once the tour has been started: a visitor who happens to be standing on
  // the first stop must not be handed its caption before pressing anything. The
  // idle card is an invitation, and an invitation that named the room underfoot
  // would be the player asserting a room it was never asked to.
  useEffect(() => {
    if (started && arrived) {
      setShownIndex(index);
    }
  }, [started, arrived, index]);

  // The arrival line, one tick after the stop is reached. A live region that
  // already holds its text when it mounts is silent in most screen readers; this
  // region stays mounted for the life of the player and only its text changes,
  // which is the mutation they announce.
  useEffect(() => {
    if (!started || !arrived) {
      return;
    }
    const timer = window.setTimeout(() => {
      setAnnouncement(tourAnnouncement(stop.caption, index + 1, total));
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [started, arrived, stop, index, total]);

  // An empty tour is not a player with nothing in it — it is no player. The same
  // rule the quick rail keeps: never announce a group a screen reader can walk
  // into and find nothing inside.
  if (total === 0 || stop === undefined) {
    return null;
  }

  const previousIndex = retreatStop(tour, index, { loop });
  const nextIndex = advanceStop(tour, index, { loop });

  const togglePlay = (): void => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (ended) {
      // Replaying is a fresh run: the first stop, from the top, and the request
      // guard cleared so stop 0 is travelled to again even though the index is
      // the one it already holds.
      requestedIndexRef.current = null;
      dwellRef.current = null;
      goToIndex(0);
    } else {
      setStarted(true);
      setEnded(false);
    }
    setPlaying(true);
  };

  const playLabel = playing ? TOUR_PAUSE_LABEL : ended ? TOUR_REPLAY_LABEL : TOUR_PLAY_LABEL;
  const note = ended ? TOUR_ENDED_NOTE : started && !playing ? TOUR_PAUSED_NOTE : null;
  // Both lines describe where the visitor IS, so both read the arrived stop. The
  // eyebrow's "3 of 5" beside stop 2's caption would be a small incoherence with
  // a large tell: it would say the tour had moved on while the words had not.
  const shownStop = shownIndex === null ? undefined : tour.stops[shownIndex];
  const eyebrow =
    shownIndex === null ? TOUR_GROUP_LABEL : tourEyebrow(tour.title, shownIndex + 1, total);
  const caption = shownStop === undefined ? tour.title : shownStop.caption;
  const dwellStyle = { "--vv-tour-dwell": `${String(stop.dwellMs)}ms` } as CSSProperties;
  const showDwell = started && !ended && arrived && !reduceMotion;

  return (
    <div
      ref={rootRef}
      className="vv-twin-tour"
      role="group"
      aria-label={TOUR_GROUP_LABEL}
      data-testid="twin-tour"
    >
      <div className="vv-twin-tour-card">
        <p className="vv-twin-tour-eyebrow" data-testid="twin-tour-eyebrow">
          {eyebrow}
        </p>

        {/* Keyed on the stop so each caption is a NEW element, and so animates.
            A CSS animation plays when its element is created or its
            animation-name changes; re-labelling an element that survived the
            render starts nothing, and every caption would simply be swapped in
            place mid-air. The dossier learned this the same way. */}
        <p className="vv-twin-tour-caption" key={shownStop?.nodeId ?? "idle"}>
          {caption}
        </p>

        {note !== null && (
          <p className="vv-twin-tour-note" data-testid="twin-tour-note">
            {note}
          </p>
        )}

        {!started && (
          <p className="vv-twin-tour-note" data-testid="twin-tour-length">
            {tourLengthLine(lengthMinutes)}
          </p>
        )}

        {showDwell && (
          <div className="vv-twin-tour-dwell" aria-hidden>
            {/* Keyed on the stop as well: a new stop is a new sweep from zero,
                while a pause holds this element and the browser holds its
                animation exactly where the visitor stopped it — which is the
                same place the JS clock resumes from. */}
            <span
              key={`${stop.nodeId}-${String(index)}`}
              className={
                playing
                  ? "vv-twin-tour-dwell-fill"
                  : "vv-twin-tour-dwell-fill vv-twin-tour-dwell-fill--paused"
              }
              style={dwellStyle}
              data-testid="twin-tour-dwell"
            />
          </div>
        )}

        <p className="vv-sr-only" aria-live="polite" data-testid="twin-tour-live">
          {announcement}
        </p>
      </div>

      <div className="vv-twin-tour-bar">
        <button
          type="button"
          className="vv-twin-tour-btn"
          aria-label={TOUR_PREVIOUS_LABEL}
          disabled={previousIndex === null}
          onClick={() => {
            if (previousIndex !== null) {
              goToIndex(previousIndex);
            }
          }}
          data-testid="twin-tour-previous"
        >
          <PreviousIcon />
        </button>

        <button
          type="button"
          className="vv-twin-tour-btn vv-twin-tour-btn--primary"
          aria-label={playLabel}
          aria-pressed={playing}
          onClick={togglePlay}
          data-testid="twin-tour-play"
        >
          {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        </button>

        <button
          type="button"
          className="vv-twin-tour-btn"
          aria-label={TOUR_NEXT_LABEL}
          disabled={nextIndex === null}
          onClick={() => {
            if (nextIndex !== null) {
              goToIndex(nextIndex);
            }
          }}
          data-testid="twin-tour-next"
        >
          <NextIcon />
        </button>

        {/* A list, because it is one — five ordered places, and a screen reader
            should be told how many there are before walking them. Each marker
            names its room, so choosing one is a decision rather than a guess. */}
        <ol className="vv-twin-tour-ticks">
          {tour.stops.map((entry, position) => {
            const state =
              position === index ? "current" : started && position < index ? "seen" : null;
            return (
              <li key={entry.nodeId}>
                <button
                  type="button"
                  className={
                    state === null
                      ? "vv-twin-tour-tick"
                      : `vv-twin-tour-tick vv-twin-tour-tick--${state}`
                  }
                  aria-label={tourStopLabel(position + 1, ROOM_DISPLAY_NAMES[entry.slug])}
                  aria-current={position === index ? "true" : undefined}
                  onClick={() => {
                    goToIndex(position);
                  }}
                  data-testid={`twin-tour-tick-${entry.nodeId}`}
                />
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
