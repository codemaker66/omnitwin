import { useEffect, useId, useState, type ReactElement } from "react";
import { lookUpRoom, metres, ROOM_TRUTH_PROVENANCE } from "./twin-rooms.js";
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
// The collapse persists nothing, deliberately. The panel unmounts the moment
// the walk leaves a named room, so a remembered "collapsed" would outlive the
// room it was collapsed in and greet the next room shut for no reason the
// visitor could trace.
// -----------------------------------------------------------------------------

/** Toggle labels, phrased as the action the press will take — the house idiom
 *  from TWIN_FULLSCREEN_ENTER / TWIN_FULLSCREEN_EXIT. */
export const TWIN_DOSSIER_COLLAPSE_LABEL = "Hide room details";
export const TWIN_DOSSIER_EXPAND_LABEL = "Show room details";

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

  const [collapsed, setCollapsed] = useState(false);
  const [arrival, setArrival] = useState("");
  const titleId = useId();
  const bodyId = useId();

  // The announcement lands one tick after the region mounts, on purpose: a live
  // region that appears in the DOM already carrying its text is silent in most
  // screen readers, which announce mutations to a region they were already
  // watching. Empty on the first commit, text on the second, arrival spoken.
  useEffect(() => {
    if (roomName === null) {
      setArrival("");
      return;
    }
    const timer = window.setTimeout(() => {
      setArrival(twinDossierArrival(roomName, venueName));
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [roomName, venueName]);

  if (room === null) {
    return null;
  }

  // The galleries publish no dimensions. A room without them shows its two
  // capacity figures alone rather than an em-dash where a measurement should be.
  //
  // Note this reads `dimensions`, not the ready-made `dimensionLine`: that line
  // folds height into the extent, which would state the ceiling twice now that
  // Ceiling has a stat of its own.
  const dimensions = room.dimensions;
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
    value: `${String(room.capacities.reception)} standing`,
  });
  stats.push({
    key: "dinner",
    label: STAT_LABEL_DINNER,
    value: `${String(room.capacities.dinner)} seated`,
  });
  if (dimensions !== null) {
    stats.push({
      key: "ceiling",
      label: STAT_LABEL_CEILING,
      value: `${metres(dimensions.heightM)} m`,
      note: dimensions.note,
    });
  }

  return (
    <div className="vv-twin-dossier" data-testid="twin-room-dossier">
      {/* A named region, not a dialog: it is ambient chrome over a live view, so
          it must never take focus on arrival nor hold it once given. */}
      <section
        className={
          collapsed
            ? "vv-twin-dossier-card vv-twin-dossier-card--collapsed"
            : "vv-twin-dossier-card"
        }
        aria-labelledby={titleId}
      >
        <p className="vv-sr-only" aria-live="polite" data-testid="twin-room-live">
          {arrival}
        </p>

        <header className="vv-twin-dossier-head">
          <div className="vv-twin-dossier-names">
            {/* Survives the collapse: the one thing worth keeping when the panel
                is folded away is which room the visitor is standing in. */}
            <h2 id={titleId} className="vv-twin-dossier-room">
              {room.name}
            </h2>
            <p className="vv-twin-dossier-venue">{venueName}</p>
          </div>
          <button
            type="button"
            className="vv-twin-dossier-toggle"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            aria-label={collapsed ? TWIN_DOSSIER_EXPAND_LABEL : TWIN_DOSSIER_COLLAPSE_LABEL}
            onClick={() => {
              setCollapsed((was) => !was);
            }}
          >
            <span className="vv-twin-dossier-chevron" aria-hidden>
              {collapsed ? "+" : "−"}
            </span>
          </button>
        </header>

        {/* The body element stays mounted so aria-controls always resolves; only
            its contents come and go. Keeping the wrapper also lets the CSS lane
            animate the collapse without reaching for the `hidden` attribute,
            which any `display:` rule on this class would silently defeat. */}
        <div id={bodyId} className="vv-twin-dossier-body">
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
                  onClick={onCompose}
                >
                  {twinDossierActionLabel(room.name)}
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
