import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import type { TwinScanNode } from "@omnitwin/types";
import { ROOM_DISPLAY_NAMES, ROOM_TRUTH_PROVENANCE, VERIFIED_ROOM_NODES } from "./twin-rooms.js";
import {
  ROOM_SELECTOR_ORDER,
  formatRoomComparison,
  planRoomSelector,
  type RoomSelectorRow,
} from "./room-selector.js";
import "./room-selector.css";

// -----------------------------------------------------------------------------
// RoomSelector — "which rooms are there, and can I go?", answered in four rows.
//
// It replaces a minimap that drew all 149 scan positions as identical cream
// dots above two buttons reading `Floor 0` and `Floor -1`. That panel was a
// debug visualisation shown to a wedding customer: the dots are the same mark
// whatever they stand for, at 120px on a phone they are a smear, the storey
// labels are the scanner's vocabulary, and the whole thing held 149 tab stops.
// It also painted over the quick-action rail on a phone, because both sit at
// z-index 3 and the map mounted last.
//
// WHAT THIS PANEL MAY SAY. Four rooms, because four is how many a human has
// validated against ground-truth photography (shell/twin-rooms.ts). It takes no
// room list from its caller — QuickActions has a `destinations` prop precisely
// so a caller cannot invent a room name, and the stronger version of that
// guarantee is to have no such prop at all: this component reads the same frozen
// join, so there is no seam a fifth room could arrive through, and the row order
// is a module constant rather than something a render can perturb.
//
// WHAT IT REFUSES TO SAY. At the 144 viewpoints whose room nobody has validated,
// NO row is marked. Not "Between rooms", not a dimmed hedge, not a placeholder —
// a labelled blank is still a label. Four equal travel rows, and silence about
// where the visitor is standing.
//
// WHAT IT CAN STILL SAY THERE, AND THIS IS THE POINT. The storeys. `node.floor`
// is a required integer on every one of the 149 nodes, so grouping the rooms by
// level is honest everywhere, including where the room is unknown — "the Saloon
// is on this level" is true at all 149 viewpoints. So the panel is MORE useful
// when the visitor is lost than the dossier is, while claiming strictly less.
//
// The levels are named RELATIONALLY and never numbered. "Floor -1" is scanner
// vocabulary; "Ground floor" or "Basement" would be an inference about the
// building — the same class of error as inferring a room, and this file exists
// because that error is the one the product cannot afford. The offset itself is
// computed in room-selector.ts from the RANK of the storeys present, so a
// non-contiguous bucket pair can never print a storey nobody scanned.
//
// EVERY FIGURE IS JOINED. Not one capacity or dimension is written here. They
// arrive composed by formatRoomComparison, which reads through twin-rooms into
// the CI-pinned venue-truth module, using the same exported metres() the dossier
// uses — so the two surfaces cannot drift even in their rounding. The footnote
// is ROOM_TRUTH_PROVENANCE re-exported verbatim: a paraphrase would be a second
// claim about the venue's own data, free to firm up "planning guide" or outlive
// the date it cites, and no test would notice.
//
// SHAPE. A persistent pill and a transient modal, at both widths. A
// photograph-first product must not permanently park a 260px list over the
// imagery, and a panel that is absent at rest makes the HUD-disjointness proof
// trivial — see the slot arithmetic in the test. Discoverability survives
// because the word "Rooms" is always on screen, and what is one press away is
// far more than the chips it replaces ever showed.
// -----------------------------------------------------------------------------

/**
 * Where the trigger parks, published so the disjointness proof and the paint
 * are pinned to ONE set of numbers rather than two that agree today.
 *
 * THE SLOT MOVED, and it moved because it was wrong. It used to be the left
 * column at bottom 96, and at 844×390 — landscape phone — the pill sat on the
 * room dossier's provenance sentence. Those are MEASURED rects, taken in a
 * browser: dossier [18,62,358,299] against trigger [18,259,186,294], a 35px
 * overlap. The model below missed it twice over, and both halves are repaired in
 * the test: it never read room-dossier.css's `@media (max-height: 460px)`
 * override, and it derived the dossier's height from the viewport rather than
 * from its content — so the "deliberate over-estimate" its own header claimed
 * was not one.
 *
 * The pill now takes the BOTTOM-RIGHT corner: the corner the minimap vacated
 * when this panel replaced it. The disjointness proof is then structural rather
 * than merely arithmetical — the rect is empty because the thing that filled it
 * is the thing this replaces — and the visitor keeps their muscle memory, since
 * the control answering "what else is in this building" is where it always was.
 *
 * `phoneBottomPx` clears the quick rail's scrolling row and the coach pill on a
 * tall phone. `shortBottomPx` overrides it below 460px of height, where 108
 * would drive the pill into the utility rail; `shortBreakpointPx` is
 * room-dossier.css's own short-viewport switch, so this panel and the dossier
 * change shape together rather than at two heights that agree by accident.
 *
 * The rail is still assumed to carry ONE chip: this panel absorbs its "Walk to
 * <room>" chips, and the host wiring that drops them is what keeps the left
 * column honest. That is not a note in a handoff — the test asserts the
 * four-chip rail really does overflow its own column.
 */
export const ROOMS_SLOT = {
  rightPx: 18,
  bottomPx: 18,
  phoneRightPx: 12,
  phoneBottomPx: 108,
  shortBottomPx: 18,
  /** quick-actions.css and room-dossier.css both switch here; so does this. */
  phoneBreakpointPx: 700,
  /** room-dossier.css's short-viewport switch — the override whose absence from
   *  the old model is half of why the 844×390 collision shipped. */
  shortBreakpointPx: 460,
  /**
   * The pill's width cap, and it is arithmetic rather than taste. 136px is the
   * minimap's own phone footprint (120px map + 7px padding each side), and
   * quick-actions.css caps the rail at `calc(100vw - 170px)` against that same
   * number — so a pill held to 136 still leaves a 10px gap beside the rail at
   * 390px. The rendered pill measures ~118px, so this never truncates; it is a
   * ceiling that keeps the proof true, not a size.
   */
  maxWidthPx: 136,
} as const;

/** The pill's label. One word, and it never changes as the visitor walks: a
 *  trigger that names the current room changes width every few steps, and the
 *  dossier already states the room prominently a few hundred pixels away. */
export const TWIN_ROOMS_TRIGGER = "Rooms";

/** The dialog's own heading. Same word as the trigger, deliberately — the panel
 *  a press opened should be recognisable as the thing that was pressed. */
export const TWIN_ROOMS_HEADING = "Rooms";

/** The list's accessible name, said once for the group so each row's own label
 *  can stay short. Worded distinctly from the quick rail's "Quick actions" so a
 *  screen reader working by accessible name never meets two identical groups. */
export const TWIN_ROOMS_ARIA = "Rooms in this walkthrough";

/** Names the act and its object: "Close" alone is ambiguous on a screen holding
 *  a dossier, an enquiry modal and a walkthrough. */
export const TWIN_ROOMS_CLOSE = "Close the room list";

/** The marker on the room underfoot. A visible string, not a colour: the row is
 *  the only one in the list that is not pressable, and that has to be legible
 *  without seeing the gold rule beside it. */
export const TWIN_ROOMS_HERE = "You are here";

/** The visitor's own storey. Relational, so it stays true whatever the forge's
 *  bucket numbering does. */
export const TWIN_ROOMS_LEVEL_HERE = "On this level";

/** A storey below the visitor's, counted in storeys and never named. */
export function twinRoomsLevelBelow(levels: number): string {
  return levels === 1 ? "One level down" : `${String(levels)} levels down`;
}

/** A storey above the visitor's. */
export function twinRoomsLevelAbove(levels: number): string {
  return levels === 1 ? "One level up" : `${String(levels)} levels up`;
}

/**
 * The act a row performs. Kept as its own exported function — rather than
 * inlined into the row label — because it is the phrase the quick rail used to
 * render, and the copy sweep's guarantee that every nameable room has a swept
 * walk label follows this string wherever it lives.
 */
export function twinRoomsWalkLabel(roomName: string): string {
  return `Walk to ${roomName}`;
}

/**
 * A row's accessible name: the act, then the same figures the row shows.
 *
 * The comparison is spliced in BYTE-IDENTICALLY rather than reformatted, which
 * is what makes Label in Name (WCAG 2.5.3) hold by construction: a speech-input
 * user saying what they can read reaches the control, and no second formatter
 * exists to drift from the first. A room with no published figures gets the act
 * alone rather than a dangling dash.
 */
export function twinRoomsRowLabel(roomName: string, comparison: string): string {
  const act = twinRoomsWalkLabel(roomName);
  return comparison === "" ? act : `${act} — ${comparison}`;
}

/** Who confirmed the figures, when, and what still moves them — verbatim from
 *  the venue-truth module, so this panel and the dossier and the public room
 *  cards all make byte-identical provenance claims. */
export const TWIN_ROOMS_FOOTNOTE = ROOM_TRUTH_PROVENANCE;

/**
 * Every user-visible string this panel can render, for the copy-claim sweep.
 *
 * ENUMERATED, not sampled — the QuickActions principle. Because the room set is
 * the frozen join and the comparison lines are composed from it, the full set of
 * renderable phrases is finite and knowable here, so the sweep covers the panel
 * exactly instead of covering one example and trusting the rest. That makes this
 * list strictly stronger than allRoomDossierCopy(), which sweeps the stat
 * LABELS but never the composed values — so "250 standing" is unswept there and
 * swept here.
 */
export function allRoomSelectorCopy(): readonly string[] {
  const lines: string[] = [
    TWIN_ROOMS_TRIGGER,
    TWIN_ROOMS_HEADING,
    TWIN_ROOMS_ARIA,
    TWIN_ROOMS_CLOSE,
    TWIN_ROOMS_HERE,
    TWIN_ROOMS_LEVEL_HERE,
    TWIN_ROOMS_FOOTNOTE,
  ];
  // Three storeys each way covers any capture this bundle format carries today;
  // the phrasing is uniform beyond one, so a fourth adds no new shape.
  for (const distance of [1, 2, 3]) {
    lines.push(twinRoomsLevelBelow(distance), twinRoomsLevelAbove(distance));
  }
  for (const slug of ROOM_SELECTOR_ORDER) {
    lines.push(twinRoomsWalkLabel(ROOM_DISPLAY_NAMES[slug]));
  }
  // Per VIEWPOINT, not per room: both validated ends of the Grand Hall compose
  // the same line today, and sweeping the viewpoints is what keeps that a
  // demonstrated fact rather than an assumption.
  for (const [nodeId, slug] of Object.entries(VERIFIED_ROOM_NODES)) {
    const comparison = formatRoomComparison(nodeId);
    if (comparison !== null) {
      lines.push(comparison, twinRoomsRowLabel(ROOM_DISPLAY_NAMES[slug], comparison));
    }
  }
  return lines;
}

export interface RoomSelectorProps {
  /**
   * Every node in the bundle. Read for `floor` ONLY — the one manifest field
   * this panel trusts, and the one that is populated on all 149 nodes. Room
   * identity never comes from here: `roomSlug` is null on every node, and
   * proximity, floor bucket and nav-graph adjacency are all tempting and all
   * wrong.
   */
  readonly nodes: readonly TwinScanNode[];
  /**
   * The viewpoint underfoot. Room identity is the validated join and nothing
   * else; anything outside it marks nothing and says nothing.
   */
  readonly currentId: string;
  /**
   * Glide to a viewpoint. The host wires this to the Usher (shortestRoute
   * drained hop by hop), never to a teleport — a room reached by naming it
   * should feel exactly like a room reached by walking to it.
   *
   * Required, not optional: a selector that cannot travel is four beautiful dead
   * buttons on the glass, and the honest state is not to render at all.
   */
  readonly onWalkTo: (nodeId: string) => void;
}

/** 13px reads level with the 0.72rem uppercase label — the quick rail's pairing. */
const ICON_SIZE = 13;

/** The overhead read of a hall: an outline with one dividing wall. Deliberately
 *  the quick rail's plan glyph, because it means the same thing here. */
const ICON_ROOMS: ReactElement = (
  <svg
    className="vv-twin-rooms-icon"
    viewBox="0 0 24 24"
    width={ICON_SIZE}
    height={ICON_SIZE}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden
  >
    <path d="M3 3h18v18H3z" />
    <path d="M3 10h11M14 10v11" />
  </svg>
);

/** Up, because the panel rises from the pill. */
const ICON_CHEVRON: ReactElement = (
  <svg
    className="vv-twin-rooms-chevron"
    viewBox="0 0 24 24"
    width={ICON_SIZE}
    height={ICON_SIZE}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    aria-hidden
  >
    <path d="m6 15 6-6 6 6" />
  </svg>
);

/** Everything inside the dialog that can hold the caret. The heading carries
 *  tabindex="-1" so it can be focused programmatically without joining the tab
 *  order, and is excluded here by the same token. */
const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** The heading a level group is given, or null when there is nothing worth
 *  saying: one level (the grouping states the obvious) or an unknown storey
 *  (nothing true can be said, so nothing is). */
function levelHeading(offset: number | null, levelCount: number): string | null {
  if (offset === null || levelCount < 2) {
    return null;
  }
  if (offset === 0) {
    return TWIN_ROOMS_LEVEL_HERE;
  }
  return offset < 0 ? twinRoomsLevelBelow(-offset) : twinRoomsLevelAbove(offset);
}

export function RoomSelector({
  nodes,
  currentId,
  onWalkTo,
}: RoomSelectorProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const panelId = useId();
  const headingId = useId();
  const levelIdBase = useId();

  const levels = useMemo(() => planRoomSelector(nodes, currentId), [nodes, currentId]);

  // The caret goes to the heading rather than to the first row: a modal that
  // opens with a travel button focused is one stray Enter away from moving the
  // visitor somewhere they were still deciding about.
  useEffect(() => {
    if (open) {
      headingRef.current?.focus();
    }
  }, [open]);

  const close = useCallback((): void => {
    setOpen(false);
    // Handing the caret back is the half of "focus management" that gets
    // forgotten, and losing it drops a keyboard visitor to the top of the
    // document for the crime of closing a panel.
    triggerRef.current?.focus();
  }, []);

  const travel = useCallback(
    (targetNodeId: string): void => {
      // Dismiss FIRST. The visitor must see the walk begin, not watch a panel
      // animate away over the top of it.
      setOpen(false);
      triggerRef.current?.focus();
      onWalkTo(targetNodeId);
    },
    [onWalkTo],
  );

  const onPanelKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      // Travel is on window-level keys (WalkControls), so an unhandled arrow
      // press inside this dialog would walk the visitor along behind it. React
      // forwards stopPropagation to the native event, and its listener sits on
      // the root container — below window — so this genuinely stops there.
      event.stopPropagation();

      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const panel = panelRef.current;
      if (panel === null) {
        return;
      }
      const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      // A real trap, unlike RoomDossier's deliberate refusal to trap: that panel
      // is ambient chrome over a live view and a visitor tabbing past it has to
      // be able to keep walking. Here there is one thing to do, and a way out on
      // Escape, on the close button, and on the backdrop.
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !panel.contains(active) || active === panel) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (active === last || !panel.contains(active) || active === panel) {
        event.preventDefault();
        first.focus();
      }
    },
    [close],
  );

  // A click inside the panel must not ALSO travel: click-anywhere is the walk's
  // primary movement mechanic, and the live view is directly beneath.
  const swallow = useCallback((event: ReactMouseEvent<HTMLElement>): void => {
    event.stopPropagation();
  }, []);

  const onBackdropClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      event.stopPropagation();
      close();
    },
    [close],
  );

  const roomCount = levels.reduce((total, level) => total + level.rooms.length, 0);
  if (roomCount === 0) {
    // No reachable room means no selector — not an empty panel announcing a
    // heading with nothing under it.
    return null;
  }

  const renderRow = (room: RoomSelectorRow): ReactElement => {
    const comparison = room.comparison;
    if (room.here) {
      // NOT a disabled button: a disabled control invites a press that does
      // nothing. This row is a statement, so it is not a control at all — and
      // it keeps its figures, because ragged rows do not compare.
      return (
        <li className="vv-twin-rooms-item" key={room.slug}>
          <div
            className="vv-twin-rooms-row vv-twin-rooms-row--here"
            aria-current="location"
            data-testid={`twin-rooms-here-${room.slug}`}
          >
            <span className="vv-twin-rooms-head">
              <span className="vv-twin-rooms-name">{room.name}</span>
              <span className="vv-twin-rooms-mark">{TWIN_ROOMS_HERE}</span>
            </span>
            {comparison !== null && (
              <span className="vv-twin-rooms-compare">{comparison}</span>
            )}
          </div>
        </li>
      );
    }
    return (
      <li className="vv-twin-rooms-item" key={room.slug}>
        <button
          type="button"
          className="vv-twin-rooms-row vv-twin-rooms-row--go"
          aria-label={twinRoomsRowLabel(room.name, comparison ?? "")}
          onClick={() => {
            travel(room.targetNodeId);
          }}
          data-testid={`twin-rooms-row-${room.slug}`}
        >
          <span className="vv-twin-rooms-head">
            <span className="vv-twin-rooms-name">{room.name}</span>
          </span>
          {comparison !== null && (
            <span className="vv-twin-rooms-compare">{comparison}</span>
          )}
        </button>
      </li>
    );
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="vv-twin-rooms-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((was) => !was);
        }}
        data-testid="twin-rooms-trigger"
      >
        {ICON_ROOMS}
        <span className="vv-twin-rooms-trigger-label">{TWIN_ROOMS_TRIGGER}</span>
        {ICON_CHEVRON}
      </button>

      {open && (
        <>
          <div
            className="vv-twin-rooms-backdrop"
            onClick={onBackdropClick}
            data-testid="twin-rooms-backdrop"
          />
          <div
            ref={panelRef}
            id={panelId}
            className="vv-twin-rooms-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            onKeyDown={onPanelKeyDown}
            onClick={swallow}
            data-testid="twin-rooms-panel"
          >
            <header className="vv-twin-rooms-headrow">
              <h2
                id={headingId}
                ref={headingRef}
                className="vv-twin-rooms-title"
                tabIndex={-1}
              >
                {TWIN_ROOMS_HEADING}
              </h2>
              <button
                type="button"
                className="vv-twin-rooms-close"
                aria-label={TWIN_ROOMS_CLOSE}
                onClick={close}
                data-testid="twin-rooms-close"
              >
                <span aria-hidden>×</span>
              </button>
            </header>

            {levels.map((level) => {
              const heading = levelHeading(level.offset, levels.length);
              const headingElementId = `${levelIdBase}-${level.key}`;
              return (
                <section className="vv-twin-rooms-level-group" key={level.key}>
                  {heading !== null && (
                    <p
                      className="vv-twin-rooms-level"
                      id={headingElementId}
                      data-testid="twin-rooms-level"
                    >
                      {heading}
                    </p>
                  )}
                  <ul
                    className="vv-twin-rooms-list"
                    aria-label={heading === null ? TWIN_ROOMS_ARIA : undefined}
                    aria-labelledby={heading === null ? undefined : headingElementId}
                  >
                    {level.rooms.map(renderRow)}
                  </ul>
                </section>
              );
            })}

            <p className="vv-twin-rooms-footnote">{TWIN_ROOMS_FOOTNOTE}</p>
          </div>
        </>
      )}
    </>
  );
}
