import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import { prefersReducedMotion } from "../reduced-motion.js";
import { lookUpRoom, metres, ROOM_TRUTH_PROVENANCE, type VerifiedRoom } from "./twin-rooms.js";
import "./room-dossier.css";

// -----------------------------------------------------------------------------
// RoomDossier — the first place the twin is allowed to say a room's name.
//
// Every manifest node carries `roomSlug: null`, and twin-copy.ts records why
// nobody has been allowed to fix that by inference: "inventing one would risk
// labelling the Saloon 'Grand Hall'". twin-rooms holds the small hand-validated
// join between the viewpoints a human checked against ground-truth photography
// and the venue's published rooms. This panel is that join made visible — and,
// just as importantly, its silence made visible: where lookUpRoom answers null
// this component renders nothing at all, so a visitor between rooms sees the
// walkthrough unadorned rather than a label hedging about where they might be.
//
// No figure is written here. Dimensions and capacities arrive already joined
// from twin-rooms, which is the single import of the venue truth module, so
// there remains exactly one place a number can drift and one test that pins it.
//
// It floats over a live 3D view, and that drives three rules. The outer frame
// takes no pointer events and only the card itself takes them back — enforced
// in room-dossier.css, not merely intended here, because click-anywhere travel
// is the primary movement mechanic and an unstyled block would silently disable
// walking across its whole width. It never traps focus, because a visitor
// tabbing through has to be able to leave and keep walking. And it collapses to
// a single line, because anything parked over the view must be possible to get
// out of the way.
//
// The collapse persists nothing across rooms, deliberately: a remembered
// "collapsed" would outlive the room it was collapsed in and greet the next room
// shut for no reason the visitor could trace. That does NOT come for free, and
// the earlier version of this comment claimed it did. The host renders this
// component for the whole of walk mode (TwinViewer gates on `mode === "walk"`,
// not on the room), so returning null does not unmount it and `collapsed`
// survives the walk between rooms untouched. It is reset explicitly, keyed on
// the room's SLUG rather than the viewpoint id, so crossing the Grand Hall from
// scan_028 to scan_046 leaves a collapse the visitor chose alone.
//
// MOTION. The panel used to appear and vanish on a frame boundary, and its
// collapse was a DOM swap. Three transitions now, all of them CSS — the
// component's only job is to keep the right element on screen long enough for
// the stylesheet to animate it, and to hand over the one measurement CSS cannot
// take for itself:
//
//   arrival   the card rises in when the walk enters a named room
//   departure the card is seen out, and stops being rendered TWIN_DOSSIER_LEAVE_MS
//             later — the component itself never unmounts, see above
//   fold      the body's height animates between 0 and the height it measured
//
// The arrival is the one that does NOT come for free, and an earlier version of
// this file shipped without it playing in the case it exists for. A CSS
// animation starts when the element it is on is created, or when its
// animation-name changes; re-labelling an element that survived the render
// starts nothing. Walking from one named room straight into another named room
// re-used the same <section> — same tag, same position, no key — so React
// swapped the text in place and the card that should have risen in for the
// Saloon simply had "Grand Hall" replaced by "Saloon" mid-air. Measured before
// the fix: all twenty ordered transitions between the five validated viewpoints
// kept the same element, so none of them animated. The card is therefore KEYED
// ON THE ROOM, which is the whole fix — a new room is a new card, and a new card
// animates. Two things have to travel with that key, and both are below: the
// caret, which a remount would otherwise drop, and the arrival announcement,
// which must not be born inside the new room's live region still naming the old
// one.
//
// Both of the state changes that drive them are LAYOUT effects, not effects, and
// that is load-bearing rather than cautious. A departure detected after paint
// would show one frame with the panel already gone before the exit could start —
// the blink this work exists to remove, reintroduced one frame earlier. A room
// arrival that reset the collapse after paint would flash the new room's panel
// shut, which is exactly what a visitor with reduced motion (and so no arrival
// animation to hide it) would see.
//
// The measurement is the fold's, and it is asymmetric for a reason worth stating
// once: collapsing has to measure BEFORE React removes the contents, expanding
// only AFTER it has added them. See the toggle handler.
// -----------------------------------------------------------------------------

/** Toggle labels, phrased as the action the press will take — the house idiom
 *  from TWIN_FULLSCREEN_ENTER / TWIN_FULLSCREEN_EXIT. */
export const TWIN_DOSSIER_COLLAPSE_LABEL = "Hide room details";
export const TWIN_DOSSIER_EXPAND_LABEL = "Show room details";

/**
 * How long the panel stays on screen after the walk leaves the room it named.
 *
 * 260 ms is not a taste call: it is the settling time of the departure spring in
 * room-dossier.css (critically damped, ω₀ = 30 rad/s), computed rather than
 * eyeballed — see that file's motion header for the parameters and the residual.
 *
 * Published to CSS as `--vv-dossier-leave` from this one constant instead of
 * being written on both sides. A drift between the component's unmount clock and
 * the stylesheet's animation is invisible in a screenshot and in every test that
 * does not run a browser: too short and the card is cut off mid-exit, too long
 * and a fully transparent card sits over the view holding its own pointer-events
 * hole open. One number, one place.
 */
export const TWIN_DOSSIER_LEAVE_MS = 260;

/** Where the fold animation is told how far it has to travel. Written by the
 *  component, read by the keyframes; the name is the whole contract. */
const FOLD_HEIGHT_PROPERTY = "--vv-dossier-fold-h";

/**
 * Hand the stylesheet the height the body has RIGHT NOW.
 *
 * CSS still cannot animate to or from `auto` anywhere this ships, so the one
 * thing JS is here for is the number — the same division of labour Radix's
 * accordion makes, and the reason no animation library is needed for any of
 * this. Deliberately unrounded: rounding to whole pixels puts a sub-pixel snap
 * at the end of every expansion, which is the artefact people describe as the
 * panel "clicking" into place.
 */
function pinFoldHeight(body: HTMLElement): void {
  const height = body.getBoundingClientRect().height;
  body.style.setProperty(FOLD_HEIGHT_PROPERTY, `${String(height)}px`);
}

/** Which way the body is folding, or null when it is simply at rest. The class
 *  it produces is the only thing room-dossier.css keys the fold on. */
type FoldPhase = "folding" | "unfolding" | null;

/**
 * A pending arrival line, and the room it is about.
 *
 * The slug travels WITH the text rather than the text being stored alone,
 * because the card is remounted per room (see the key on the section): a live
 * region that mounts already carrying the previous room's line is one DOM
 * insertion away from announcing "Grand Hall" to a visitor standing in the
 * Saloon — the one sentence this whole surface exists not to say. Rendered only
 * while its slug still matches the room underfoot, so the new region always
 * starts empty, which is also the only condition under which it speaks at all.
 *
 * The type is taken off VerifiedRoom rather than imported from the venue-truth
 * module: twin-rooms is this file's single door to that module, and a type-only
 * import would still be a second one.
 */
interface PendingArrival {
  readonly slug: VerifiedRoom["slug"];
  readonly text: string;
}

/**
 * The exit duration, published to the cascade.
 *
 * Hoisted to module scope so the object identity is stable: this is a constant
 * dressed as a style prop, and rebuilding it every render would hand React a new
 * object to diff on every frame of the walk for no change at all.
 */
const DOSSIER_FRAME_STYLE = {
  "--vv-dossier-leave": `${String(TWIN_DOSSIER_LEAVE_MS)}ms`,
} as CSSProperties;

/** The honest qualifier beneath the figures: who confirmed them, when, and what
 *  still moves them.
 *
 *  Taken verbatim from the venue-truth module rather than reworded, so this
 *  panel and the public room cards make byte-identical provenance claims. A
 *  paraphrase is a second claim about someone else's data: it can quietly firm
 *  up "planning guide", or outlive the date it cites, and no test would catch
 *  either. */
export const TWIN_DOSSIER_FOOTNOTE = ROOM_TRUTH_PROVENANCE;

/**
 * Primary action, rendered only when the host wires `onCompose` — so the label
 * can promise something the twin actually does.
 *
 * It names the room in its VISIBLE text rather than hiding the room in an
 * aria-label over a generic "Enquire about this room". A hidden name that
 * disagrees with the visible one fails Label in Name (WCAG 2.5.3): a speech-input
 * user who says what they can read would miss the control entirely. It is also
 * simply better copy — the button says what it does when the card is skimmed.
 */
export function twinDossierActionLabel(roomName: string): string {
  return `Enquire about the ${roomName}`;
}

/** Polite arrival line. The room leads, because the room is the news; the venue
 *  follows so the announcement stands alone if it is all a visitor hears. */
export function twinDossierArrival(roomName: string, venueName: string): string {
  return `${roomName}, ${venueName}`;
}

/** Quiet labels for the four published facts, in the venue's own vocabulary —
 *  "Reception" and "Dinner" are the venue's format names (CAPACITY_FORMATS),
 *  not our paraphrase of them. */
const STAT_LABEL_DIMENSIONS = "Dimensions";
const STAT_LABEL_RECEPTION = "Reception";
const STAT_LABEL_DINNER = "Dinner";
/** Exported so a test can locate the ceiling row by its label and assert the
 *  COMPOSED value — figure plus the venue's qualifier plus the separator
 *  between them, which is the part that silently broke. */
export const STAT_LABEL_CEILING = "Ceiling";

/** A published figure, the quiet word for it, and the venue's own qualifier
 *  where one exists (the Grand Hall's further height inside the dome). */
interface DossierStat {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}

/**
 * Every user-facing string this panel can render, for the copy-claim sweep in
 * shell/__tests__/shell-copy-claims.test.ts. That guard is the repo's only
 * enforcement of the banned certainty phrases, and it can only check strings it
 * is handed — a surface that keeps its copy to itself is simply unguarded.
 *
 * It is swept there rather than being spliced into twin-copy.ts's allTwinCopy()
 * because that module is pure data: importing this component into it would
 * invert the dependency and drag React and a stylesheet into the copy graph.
 *
 * The two parameterised lines are sampled with a real room name so the sweep
 * sees the sentence a visitor sees, not a template.
 */
export function allRoomDossierCopy(): readonly string[] {
  return [
    TWIN_DOSSIER_COLLAPSE_LABEL,
    TWIN_DOSSIER_EXPAND_LABEL,
    TWIN_DOSSIER_FOOTNOTE,
    STAT_LABEL_DIMENSIONS,
    STAT_LABEL_RECEPTION,
    STAT_LABEL_DINNER,
    STAT_LABEL_CEILING,
    twinDossierActionLabel("Grand Hall"),
    twinDossierArrival("Grand Hall", "Trades Hall Glasgow"),
  ];
}

export interface RoomDossierProps {
  /** The viewpoint underfoot. Anything outside the validated join renders nothing. */
  readonly currentId: string;
  readonly venueName: string;
  /** Primary action, wired by the host. Absent → no button at all, rather than a
   *  control that looks live and does nothing. */
  readonly onCompose?: () => void;
}

export function RoomDossier({
  currentId,
  venueName,
  onCompose,
}: RoomDossierProps): ReactElement | null {
  const room = lookUpRoom(currentId);
  // Hooks run before the null return, so the name is lifted out as a primitive:
  // lookUpRoom builds a fresh object each call, and depending on it directly
  // would re-announce on every render.
  const roomName = room === null ? null : room.name;
  const roomSlug = room === null ? null : room.slug;

  const [collapsed, setCollapsed] = useState(false);
  const [arrival, setArrival] = useState<PendingArrival | null>(null);
  /** The viewpoint whose room is currently being seen out, or null. */
  const [departedFrom, setDepartedFrom] = useState<string | null>(null);
  const [fold, setFold] = useState<FoldPhase>(null);
  /** The last viewpoint that resolved to a room — what a departure departs FROM. */
  const lastNamedIdRef = useRef<string | null>(null);
  /** Set by the toggle, consumed by the layout effect that measures the unfold. */
  const unfoldPendingRef = useRef(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  /** Whether the caret is on the toggle. Kept by the button's own focus events
   *  rather than read from document.activeElement when it is wanted, because by
   *  the time the room has changed the element that held it is already gone and
   *  the answer is always "the body". */
  const toggleHeldFocusRef = useRef(false);
  const titleId = useId();
  const bodyId = useId();

  // The announcement lands one tick after the region mounts, on purpose: a live
  // region that appears in the DOM already carrying its text is silent in most
  // screen readers, which announce mutations to a region they were already
  // watching. Empty on the first commit, text on the second, arrival spoken.
  //
  // Which is why the line is stored WITH the room it is about. Each room gets
  // its own card and so its own region, and a region born carrying the last
  // room's line is either silent (most readers) or wrong (the rest) — and wrong
  // here means telling someone standing in the Saloon that they are in the Grand
  // Hall. Matched against the room underfoot at render, the new region is always
  // born empty, which is both the safe state and the only speaking one.
  useEffect(() => {
    if (roomName === null || roomSlug === null) {
      setArrival(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setArrival({ slug: roomSlug, text: twinDossierArrival(roomName, venueName) });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [roomName, roomSlug, venueName]);

  // Departure. The walk has stepped out of a named room and into one of the 144
  // viewpoints nobody has validated, so `room` is null and the panel would
  // otherwise be gone this commit. Hold the room it left for as long as the exit
  // animation runs — then, and only then, say nothing.
  //
  // A LAYOUT effect because the state it sets decides what this very frame
  // paints. Run after paint, it would show one frame with the panel already
  // removed and then bring it back to fade out, which is a worse blink than the
  // one this replaces. React does still remove the card's DOM on the commit
  // where the room stopped resolving and re-create it on the one this effect
  // schedules — but it flushes an update made in a layout effect before yielding
  // to the browser, so both commits land in a single paint. The churn is one
  // small subtree, once per departure, and it buys a guarantee worth having: the
  // exit animation always starts from its first keyframe.
  //
  // Under reduced motion it never enters the departing state at all: the panel
  // is simply gone on the commit the room stopped resolving, which is the final
  // state, immediately — not a shorter version of the same exit.
  useLayoutEffect(() => {
    if (roomName !== null) {
      lastNamedIdRef.current = currentId;
      setDepartedFrom(null);
      return;
    }
    const left = lastNamedIdRef.current;
    lastNamedIdRef.current = null;
    if (left === null || prefersReducedMotion()) {
      return;
    }
    setDepartedFrom(left);
  }, [currentId, roomName]);

  // The exit's own clock, keyed on the departure rather than on the viewpoint.
  // Walking on through further unvalidated viewpoints while it runs must not
  // restart it — and must not strand it either, which is what a timer keyed on
  // currentId does: its cleanup cancels on the next step and nothing re-arms.
  useEffect(() => {
    if (departedFrom === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDepartedFrom(null);
    }, TWIN_DOSSIER_LEAVE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [departedFrom]);

  // Every room is greeted open, and greeted still. Keyed on the SLUG, so moving
  // between two viewpoints of the same room keeps a collapse the visitor chose,
  // while arriving anywhere new opens the panel that room deserves.
  //
  // A layout effect for the same reason as the departure above: after paint, the
  // new room's panel would be visible shut for a frame first.
  //
  // Clearing the fold is not tidying, it is a fix. A fold belongs to the room it
  // was started in and to the height measured there. Collapse the panel and walk
  // straight out and the exit takes the wrapper out of the DOM part-way through,
  // so its animationend never fires and the phase is never released the usual
  // way — leaving the next room to be greeted by its own panel folding shut
  // against a height measured in the room before it.
  //
  // It is also where the caret is handed back. The card is keyed on the room, so
  // arriving somewhere new tears out the toggle along with everything else, and
  // travel is on window-level keys (WalkControls) — a visitor can be holding the
  // caret on "Hide room details" and press an arrow to walk. Dropping them to
  // the top of the document for moving through a doorway is not an acceptable
  // price for the arrival animation, so the caret follows the panel into the new
  // room. Guarded twice: only if the toggle actually held it, and only if
  // nothing else has taken it since, so this can never pull focus off a control
  // the visitor moved to themselves.
  useLayoutEffect(() => {
    setFold(null);
    unfoldPendingRef.current = false;
    if (roomSlug === null) {
      return;
    }
    setCollapsed(false);
    const active: Element | null = document.activeElement;
    if (toggleHeldFocusRef.current && (active === null || active === document.body)) {
      toggleRef.current?.focus();
    }
  }, [roomSlug]);

  // The expansion's measurement, taken on the far side of the commit that
  // mounted the contents — before paint, so the animation's first frame already
  // knows how far it has to travel. Gated on the ref rather than on `collapsed`
  // alone: opening the panel because the walk arrived in a new room must not
  // play a fold on top of the card's own arrival.
  useLayoutEffect(() => {
    if (!unfoldPendingRef.current) {
      return;
    }
    unfoldPendingRef.current = false;
    const body = bodyRef.current;
    if (body === null) {
      return;
    }
    pinFoldHeight(body);
    setFold("unfolding");
  }, [collapsed]);

  // The room the panel is SHOWING, which during an exit is the room the walk has
  // just left. That is not a claim about where the visitor is standing — the
  // card is visibly on its way out, it is inert, and it leaves the accessibility
  // tree the moment the exit starts, so nothing asserts a room to anyone who
  // cannot see it fading.
  const shown = room ?? (departedFrom === null ? null : lookUpRoom(departedFrom));
  if (shown === null) {
    return null;
  }
  const leaving = room === null;

  const toggleFold = (): void => {
    const animate = !prefersReducedMotion();
    if (collapsed) {
      // Expanding. There is nothing to measure yet: the contents this fold has
      // to make room for do not exist until React commits. The layout effect
      // above takes the measurement on the far side of that commit.
      unfoldPendingRef.current = animate;
      if (!animate) {
        setFold(null);
      }
      setCollapsed(false);
      return;
    }
    // Collapsing. The measurement has to happen HERE, on this side of the
    // commit: by the time any class could be applied React has removed the
    // contents and the wrapper has nothing left to be as tall as.
    const body = bodyRef.current;
    if (animate && body !== null) {
      pinFoldHeight(body);
      setFold("folding");
    } else {
      setFold(null);
    }
    setCollapsed(true);
  };

  // The galleries publish no dimensions. A room without them shows its two
  // capacity figures alone rather than an em-dash where a measurement should be.
  //
  // Note this reads `dimensions`, not the ready-made `dimensionLine`: that line
  // folds height into the extent, which would state the ceiling twice now that
  // Ceiling has a stat of its own.
  const dimensions = shown.dimensions;
  const stats: DossierStat[] = [];
  if (dimensions !== null) {
    stats.push({
      key: "dimensions",
      label: STAT_LABEL_DIMENSIONS,
      value: `${metres(dimensions.lengthM)} × ${metres(dimensions.widthM)} m`,
    });
  }
  stats.push({
    key: "reception",
    label: STAT_LABEL_RECEPTION,
    value: `${String(shown.capacities.reception)} standing`,
  });
  stats.push({
    key: "dinner",
    label: STAT_LABEL_DINNER,
    value: `${String(shown.capacities.dinner)} seated`,
  });
  if (dimensions !== null) {
    stats.push({
      key: "ceiling",
      label: STAT_LABEL_CEILING,
      value: `${metres(dimensions.heightM)} m`,
      note: dimensions.note,
    });
  }

  const cardClass = [
    "vv-twin-dossier-card",
    collapsed ? "vv-twin-dossier-card--collapsed" : null,
    leaving ? "vv-twin-dossier-card--leaving" : null,
  ]
    .filter((name): name is string => name !== null)
    .join(" ");

  const bodyClass =
    fold === null ? "vv-twin-dossier-body" : `vv-twin-dossier-body vv-twin-dossier-body--${fold}`;

  return (
    <div className="vv-twin-dossier" data-testid="twin-room-dossier" style={DOSSIER_FRAME_STYLE}>
      {/* A named region, not a dialog: it is ambient chrome over a live view, so
          it must never take focus on arrival nor hold it once given.

          On the way out it leaves the accessibility tree entirely. The card is
          still readable because it is still visible, but it has stopped being a
          statement about where the visitor IS, and a screen reader has no way to
          see that it is fading. aria-hidden over a focusable control is a fault,
          so the two controls are disabled in the same breath — which also takes
          them out of the tab order, and blurs the toggle if it held the caret. */}
      <section
        // The room, not the viewpoint. A CSS animation plays when its element is
        // created, so a card that survives from one room into the next never
        // arrives — it is simply relabelled. Keying on the slug makes each room's
        // card its own element and its own arrival, while the two ends of the
        // Grand Hall stay one card, one arrival, and one collapse the visitor
        // chose. The cost is a remount per room: the caret is handed back in the
        // layout effect above, and the announcement below is keyed the same way
        // so a fresh live region can never be born already naming the last room.
        key={shown.slug}
        className={cardClass}
        aria-labelledby={titleId}
        aria-hidden={leaving || undefined}
      >
        <p className="vv-sr-only" aria-live="polite" data-testid="twin-room-live">
          {arrival !== null && arrival.slug === roomSlug ? arrival.text : ""}
        </p>

        <header className="vv-twin-dossier-head">
          <div className="vv-twin-dossier-names">
            {/* Survives the collapse: the one thing worth keeping when the panel
                is folded away is which room the visitor is standing in. */}
            <h2 id={titleId} className="vv-twin-dossier-room">
              {shown.name}
            </h2>
            <p className="vv-twin-dossier-venue">{venueName}</p>
          </div>
          <button
            ref={toggleRef}
            type="button"
            className="vv-twin-dossier-toggle"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            aria-label={collapsed ? TWIN_DOSSIER_EXPAND_LABEL : TWIN_DOSSIER_COLLAPSE_LABEL}
            disabled={leaving}
            onClick={toggleFold}
            // The caret's whereabouts, recorded while the element that holds it
            // still exists. Removing a focused element fires no blur, so a ref
            // left true across a remount is telling the truth about where the
            // caret was — which is precisely what the handoff above needs.
            onFocus={() => {
              toggleHeldFocusRef.current = true;
            }}
            onBlur={() => {
              toggleHeldFocusRef.current = false;
            }}
          >
            <span className="vv-twin-dossier-chevron" aria-hidden>
              {collapsed ? "+" : "−"}
            </span>
          </button>
        </header>

        {/* The body element stays mounted so aria-controls always resolves; only
            its contents come and go. Keeping the wrapper is also what lets the
            fold animate at all: there is no `display` rule on this class and
            there must not be one, because a `display` toggle cannot be animated
            and would silently defeat the `hidden` attribute besides.

            The class carries the fold; the inline custom property carries the
            distance. onAnimationEnd releases the class when it lands so nothing
            stays pinned to a measured pixel height — and the keyframes fill
            `backwards` rather than `forwards`, so the worst a class that somehow
            outlived its animation can do is nothing at all. */}
        <div
          id={bodyId}
          ref={bodyRef}
          className={bodyClass}
          onAnimationEnd={() => {
            setFold(null);
          }}
        >
          {collapsed ? null : (
            <>
              <dl className="vv-twin-dossier-stats">
                {stats.map((stat) => (
                  <div className="vv-twin-dossier-stat" key={stat.key}>
                    <dt className="vv-twin-dossier-stat-label">{stat.label}</dt>
                    <dd className="vv-twin-dossier-stat-value">
                      {stat.value}
                      {/* The separator is DOM text, not a CSS margin: a span is
                          inline with no default whitespace, so styling alone
                          would read "7 ma further 7 m under the dome" to anyone
                          whose stylesheet had not loaded — and to every screen
                          reader, which hears the concatenation regardless. */}
                      {stat.note !== undefined && (
                        <span className="vv-twin-dossier-stat-note">{` — ${stat.note}`}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="vv-twin-dossier-footnote">{TWIN_DOSSIER_FOOTNOTE}</p>
              {onCompose !== undefined && (
                <button
                  type="button"
                  className="vv-twin-dossier-action"
                  disabled={leaving}
                  onClick={onCompose}
                >
                  {twinDossierActionLabel(shown.name)}
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
