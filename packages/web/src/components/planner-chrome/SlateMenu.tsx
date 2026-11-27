import { type MouseEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Check, FileText, Grid2x2, House } from "lucide-react";
import {
  TRADES_HALL_PUBLISHED_ROOM_NAMES,
  TRADES_HALL_ROOM_CAPACITIES,
  type PublishedRoomSlug,
} from "@omnitwin/types";
import type { EventAct } from "../../lib/slate-facts.js";
import { ActivityIndicator } from "../shared/Activity.js";
import { Segmented } from "./Controls.js";
import { QuietKey } from "./Keys.js";
import { Popover, type PopoverState } from "./Popover.js";
import "./chrome.css";
import "./slate.css";

// ---------------------------------------------------------------------------
// The slate's menu (T-671 slice 7; spec 6.15, frame 19), opened by the ▾ on
// the slate's title. The six published rooms with their seated-dinner
// capacities as one grid, the current one ringed; this event's layouts, and
// for staff each act's layout with "Use this layout for {act}" (what the
// function sheet reads); Event details; the walls, Cut or Full; and the Diary
// for staff. It is a popover: the room stays lit behind it, Esc gives focus
// back to the title.
// ---------------------------------------------------------------------------

export interface SlateMenuRoom {
  readonly slug: PublishedRoomSlug;
  /** The room's name as the slate says it: "Grand Hall", not "The Grand Hall". */
  readonly name: string;
  /** Seated for dinner, as the venue publishes it. */
  readonly dinner: number;
}

/** The six published rooms, in the venue's own order, with their seated-dinner capacities. */
export function slateMenuRooms(): readonly SlateMenuRoom[] {
  return (Object.keys(TRADES_HALL_PUBLISHED_ROOM_NAMES) as PublishedRoomSlug[]).map((slug) => ({
    slug,
    name: TRADES_HALL_PUBLISHED_ROOM_NAMES[slug].replace(/^The\s+/u, ""),
    dinner: TRADES_HALL_ROOM_CAPACITIES[slug].dinner,
  }));
}

const ACT_STATE_WORDS: Readonly<Record<EventAct["state"], string>> = {
  this: "uses this layout",
  stale: "uses an earlier save of this layout",
  other: "uses another layout",
  none: "no layout yet",
};

export interface SlateMenuLayout {
  readonly id: string;
  readonly name: string;
  readonly spaceName: string;
  readonly href: string;
}

export interface SlateMenuProps {
  readonly state: PopoverState;
  readonly rooms: readonly SlateMenuRoom[];
  readonly currentRoomSlug: string | null;
  readonly onRoom: (slug: PublishedRoomSlug) => void;
  /** This layout's name, or null before there is one. */
  readonly layoutName: string | null;
  readonly otherLayouts: readonly SlateMenuLayout[];
  /** Opens another layout once this one's work has had its chance to save
   *  (QoL D-X3); without it, the links navigate at once. */
  readonly onOpenLayout?: (layout: SlateMenuLayout) => void;
  /** Staff only: the event's acts in this room. */
  readonly acts: readonly EventAct[];
  /** Whether this person may set an act's layout (event writers; hallkeepers only read). */
  readonly actsSettable: boolean;
  readonly onUseForAct: (actId: string) => void;
  /** The act whose layout is being set now, or null. */
  readonly actBusy: string | null;
  /** Why "Use this layout" waits (the layout is not saved yet), or null. */
  readonly actWaitsOn: string | null;
  /** What went wrong setting an act's layout, in a sentence, or null. */
  readonly actProblem: string | null;
  readonly eventHref: string | null;
  readonly diaryHref: string | null;
  readonly wallsFull: boolean;
  readonly onWalls: (full: boolean) => void;
}

/** A plain click: one that opens the link here, not in a new tab or window. */
function opensHere(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function SlateMenu({
  state, rooms, currentRoomSlug, onRoom, layoutName, otherLayouts, onOpenLayout, acts, actsSettable, onUseForAct, actBusy,
  actWaitsOn, actProblem, eventHref, diaryHref, wallsFull, onWalls,
}: SlateMenuProps): ReactElement | null {
  const showLayouts = layoutName !== null || otherLayouts.length > 0 || acts.length > 0;
  return (
    <Popover state={state} label="The event and the room" align="start" side="below" chrome="slate-menu" className="pc-slate-menu">
      <div className="pc-slate-menu__section" role="group" aria-label="Rooms, seated for dinner">
        <div className="pc-slate-menu__head" aria-hidden="true">
          <span className="pc-caps">Rooms</span>
          <span className="pc-meta">seated dinner</span>
        </div>
        <div className="pc-slate-menu__rooms">
          {rooms.map((room) => {
            const current = room.slug === currentRoomSlug;
            return (
              <button
                key={room.slug}
                type="button"
                className="pc-slate-menu__room"
                aria-current={current ? "true" : undefined}
                aria-label={`${room.name}, ${String(room.dinner)} seated for dinner${current ? ", this room" : ""}`}
                onClick={() => { if (current) state.close(true); else onRoom(room.slug); }}
              >
                <span className="pc-slate-menu__room-name">{room.name}</span>
                <span className="pc-slate-menu__capacity">{room.dinner}</span>
              </button>
            );
          })}
        </div>
      </div>

      {showLayouts ? (
        <div className="pc-slate-menu__section" role="group" aria-label="Layouts for this event">
          <div className="pc-slate-menu__head" aria-hidden="true"><span className="pc-caps">Layouts for this event</span></div>
          <ul className="pc-slate-menu__list">
            {layoutName !== null ? (
              <li className="pc-slate-menu__layout is-current">
                <Grid2x2 className="pc-icon" aria-hidden="true" />
                <span className="pc-slate-menu__layout-words">
                  <span className="pc-slate-menu__layout-name">{layoutName}</span>
                  <span className="pc-meta pc-slate-menu__sub">This layout</span>
                </span>
                <Check className="pc-icon pc-slate-menu__check" aria-hidden="true" />
              </li>
            ) : null}
            {otherLayouts.map((layout) => (
              <li key={layout.id}>
                <Link
                  className="pc-slate-menu__layout"
                  to={layout.href}
                  onClick={(event) => {
                    if (onOpenLayout === undefined || !opensHere(event)) return;
                    event.preventDefault();
                    state.close(false);
                    onOpenLayout(layout);
                  }}
                >
                  <Grid2x2 className="pc-icon" aria-hidden="true" />
                  <span className="pc-slate-menu__layout-words">
                    <span className="pc-slate-menu__layout-name">{layout.name}</span>
                    <span className="pc-meta pc-slate-menu__sub">{layout.spaceName}</span>
                  </span>
                </Link>
              </li>
            ))}
            {acts.map((act) => {
              const running = actBusy === act.id;
              const waitsOn = actWaitsOn ?? (actBusy !== null && !running ? "Setting another act" : null);
              return (
                <li key={act.id} className="pc-slate-menu__act">
                  <span className="pc-slate-menu__layout-words">
                    <span className="pc-slate-menu__layout-name">{act.name}</span>
                    <span className="pc-meta pc-slate-menu__sub">{ACT_STATE_WORDS[act.state]}</span>
                  </span>
                  {actsSettable && act.state !== "this" ? (
                    <QuietKey
                      label={`Use this layout for ${act.name}`}
                      aria-busy={running ? true : undefined}
                      icon={running ? <ActivityIndicator size={16} /> : undefined}
                      disabledReason={waitsOn ?? undefined}
                      onPress={() => { if (!running) onUseForAct(act.id); }}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
          {actProblem !== null ? <p className="pc-meta pc-slate-menu__problem" role="alert">{actProblem}</p> : null}
        </div>
      ) : null}

      <ul className="pc-slate-menu__list pc-slate-menu__section">
        {eventHref !== null ? (
          <li>
            <Link className="pc-slate-menu__item" to={eventHref}>
              <FileText className="pc-icon" aria-hidden="true" />
              <span>Event details</span>
            </Link>
          </li>
        ) : null}
        <li className="pc-slate-menu__item pc-slate-menu__item--static">
          <House className="pc-icon" aria-hidden="true" />
          <span aria-hidden="true">Walls</span>
          <Segmented
            label="Walls"
            className="pc-slate-menu__walls"
            value={wallsFull ? "full" : "cut"}
            options={[{ value: "cut", label: "Cut" }, { value: "full", label: "Full" }]}
            onChange={(value) => { onWalls(value === "full"); }}
          />
        </li>
        {diaryHref !== null ? (
          <li>
            <Link className="pc-slate-menu__item" to={diaryHref}>
              <CalendarDays className="pc-icon" aria-hidden="true" />
              <span>Open in the Diary</span>
            </Link>
          </li>
        ) : null}
      </ul>
    </Popover>
  );
}
