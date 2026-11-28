import { useId, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import {
  AlertTriangle, Bell, Check, Clock, DoorOpen, Link2, Radio, RotateCcw, UserCheck, Users, WifiOff, Wrench,
} from "lucide-react";
import { observationMeansOver } from "@omnitwin/types";
import { formatMinutes, type DayBoardIcon, type DayBoardSlot } from "./lib/day-board-state.js";
import { thenLine, type RoomDay } from "./lib/day-board-rooms.js";
import { dayBoardRoomPhoto } from "./lib/day-board-photo.js";
import { useBreathPhase } from "./lib/use-board-clock.js";

// ---------------------------------------------------------------------------
// The rooms of the Day Board (the sentence first, T-753): one card per room,
// in the venue's order, two to a row on the office sheet. Each card has the
// room pictured empty and its name; then the room as it is now, the lead
// slab: the now line (the state's dot and its words) over the function, its
// time and guests; why the room is at risk; what comes then; and All of
// today, every other slot of the room one tap away. Every slot is one
// element, a "slab", whose verb carries its state in words beside an icon
// and a tone (D3); a tap on it opens the slot. On the wall nothing opens
// (D11): a slab there is a group, not a button, and nothing folds.
// ---------------------------------------------------------------------------

const ICONS: Readonly<Record<DayBoardIcon, typeof Clock>> = {
  clock: Clock,
  wrench: Wrench,
  users: Users,
  "door-open": DoorOpen,
  radio: Radio,
  "rotate-ccw": RotateCcw,
  check: Check,
  "alert-triangle": AlertTriangle,
  bell: Bell,
  "user-check": UserCheck,
  "wifi-off": WifiOff,
};

export function StateIcon({ icon, size = 14 }: { readonly icon: DayBoardIcon; readonly size?: number }): ReactElement {
  const Icon = ICONS[icon];
  return <Icon size={size} aria-hidden="true" />;
}

/** The id a room's card answers to, so the day's sentence can link to it. */
export function roomAnchor(roomId: string): string {
  return `dayboard-room-${roomId}`;
}

/** The lead is what the room is doing now, or will do first; a line is a
 *  slot named under All of today. */
export type SlabVariant = "lead" | "line";

/** What the room was last seen doing (S5), beside the schedule; not once the
 *  fact is a done or a cleaned, which the verb already says. */
function seenLine(slot: DayBoardSlot): string | null {
  return slot.observed !== null && !observationMeansOver(slot.observed.kind) ? slot.observed.line : null;
}

/** "14:30 – 16:30 · 200 guests · Provisional · 1st option" */
function slotFacts(slot: DayBoardSlot): string {
  const guests = slot.guestCount === null ? "" : ` · ${String(slot.guestCount)} guests`;
  const kind = slot.kind === "ink" ? "" : ` · ${slot.bookingLabel}`;
  return `${slot.timeRange}${guests}${kind}`;
}

/** The turn-round before a slot whose setup is still ahead: the time the
 *  room has between functions, and what the rule needs when that is short.
 *  Once setup is due it has been spent; a changeover at risk says why in
 *  its own words. */
export function turnRound(slot: DayBoardSlot, nowMs: number): string | null {
  const gap = slot.gapBefore;
  if (gap === null || nowMs >= slot.setupStartsAtMs || slot.exception !== null) return null;
  return gap.short && gap.neededMinutes !== null
    ? `Turn-round ${formatMinutes(gap.minutes)} · needs ${formatMinutes(gap.neededMinutes)}`
    : `Turn-round ${formatMinutes(gap.minutes)}`;
}

/** One slot on its room. The lead: the now line (the state's dot, icon and
 *  verb), the title, its facts, what was seen and why it is at risk. A line:
 *  the title, its verb, and only what that slot alone must say. A request on
 *  the slot is not drawn here: the panel and the next action carry it. */
export function Slab({ slot, variant, nowMs, selected, onOpen, wall, frozen }: {
  readonly slot: DayBoardSlot;
  readonly variant: SlabVariant;
  readonly nowMs: number;
  readonly selected: boolean;
  readonly onOpen: (bookingId: string) => void;
  readonly wall: boolean;
  readonly frozen: boolean;
}): ReactElement {
  // The breath samples its phase the moment it begins: a new motion, or a
  // freeze lifting, starts a new animation and a new sample (D3 law 1).
  const phase = useBreathPhase(`${slot.motion}|${frozen ? "frozen" : "live"}`);
  const seen = seenLine(slot);
  const linked = slot.linkedRooms.length > 0 ? `also ${slot.linkedRooms.join(", ")}` : null;
  const why = slot.exceptionDetail ?? slot.turnaroundWarning;
  // The wall reads room, title, state and time (D11): no turn-round, no
  // facts seen, no other rooms named. A slot named in passing (All of
  // today) says its turn-round only when that is short, so a short
  // changeover is always said in words.
  const shortGap = slot.gapBefore?.short === true;
  const gap = wall || (variant === "line" && !shortGap) ? null : turnRound(slot, nowMs);
  // On a line it says why only when it is at risk. A turnaround warning is
  // the Diary's advice on a pair, copied to both of its bookings and kept
  // after they end, so on a line it would speak of the wrong changeover, or
  // one already over; the opened slot gives it in full.
  const shownWhy = variant === "line" ? slot.exceptionDetail : why;
  // A screen reader hears the slot by its label, which stands in for
  // everything inside it, so the label says every word the slot shows.
  const spokenLinked = linked !== null && !wall ? `, ${linked}` : "";
  const label = `${slot.title}, ${slotFacts(slot)}${spokenLinked}, ${slot.countdown}${gap === null ? "" : `, ${gap}`}${shownWhy === null ? "" : `, ${shownWhy}`}${seen === null || wall ? "" : `, ${seen}`}`;
  const shownSeen = wall ? null : seen;
  const shared = {
    className: `dayboard-slab is-${variant} dayboard-tone-${slot.tone}${selected ? " is-selected" : ""}`,
    "data-state": slot.state,
    "data-tone": slot.tone,
    "data-motion": slot.motion,
    // What the board knows of the slot's requests, for whoever reads the
    // page's structure; nothing is drawn for it on the card.
    "data-attention": slot.attention?.level ?? "none",
    "data-booking": slot.bookingId,
    style: { "--lt-epoch-phase-ms": String(phase) } as CSSProperties,
  };
  const verb = (
    <span className="dayboard-verb">
      <span className="dayboard-dot" aria-hidden="true" />
      <StateIcon icon={slot.icon} size={wall ? 18 : 14} />
      <span className="dayboard-verb-words">{slot.countdown}</span>
    </span>
  );
  const notes = gap !== null || shownSeen !== null
    ? (
      <span className="dayboard-slab-notes">
        {gap !== null && <span className={`dayboard-gap-words${shortGap ? " is-short" : ""}`}>{gap}</span>}
        {shownSeen !== null && <span className="dayboard-slab-seen">{shownSeen}</span>}
      </span>
    )
    : null;
  const face = variant === "line"
    ? (
      <>
        <span className="dayboard-slab-title">{slot.title}</span>
        {verb}
        {shownSeen !== null && <span className="dayboard-slab-seen">{shownSeen}</span>}
        {gap !== null && <span className="dayboard-gap-words is-short">{gap}</span>}
        {shownWhy !== null && <span className="dayboard-slab-why">{shownWhy}</span>}
      </>
    )
    : (
      <>
        {verb}
        <span className="dayboard-slab-head">
          <span className="dayboard-slab-title">{slot.title}</span>
        </span>
        <span className="dayboard-slab-time">{slotFacts(slot)}</span>
        {linked !== null && !wall && <span className="dayboard-linked"><Link2 size={12} aria-hidden="true" />{linked}</span>}
        {notes}
        {shownWhy !== null && <span className="dayboard-slab-why">{shownWhy}</span>}
      </>
    );
  if (wall) return <div {...shared} role="group" aria-label={label}>{face}</div>;
  return (
    <button {...shared} type="button" aria-pressed={selected} aria-label={label} onClick={() => { onOpen(slot.bookingId); }}>
      {face}
    </button>
  );
}

/** One room's card: its photograph, its name, the room as it is now, why it
 *  is at risk, what comes then and All of today. `children` is the open
 *  slot, when it unfolds under its own room (the narrow desk and the
 *  phone). */
export function RoomCard({ day, nowMs, timeZone, venueSlug, today, selectedId, onOpen, wall, frozen, children }: {
  readonly day: RoomDay;
  readonly nowMs: number;
  readonly timeZone: string;
  readonly venueSlug: string | null;
  /** The board shows today, so the fold says "All of today". */
  readonly today: boolean;
  readonly selectedId: string | null;
  readonly onOpen: (bookingId: string) => void;
  readonly wall: boolean;
  readonly frozen: boolean;
  readonly children?: ReactNode;
}): ReactElement {
  const [unfolded, setUnfolded] = useState(false);
  const listId = useId();
  const photo = venueSlug === null ? null : dayBoardRoomPhoto(venueSlug, day.room.slug);
  const slab = (slot: DayBoardSlot, variant: SlabVariant): ReactElement => (
    <Slab
      key={slot.bookingId}
      slot={slot}
      variant={variant}
      nowMs={nowMs}
      selected={slot.bookingId === selectedId}
      onOpen={onOpen}
      wall={wall}
      frozen={frozen}
    />
  );
  const then = thenLine(day, timeZone);
  // Why the room is at risk, when what is at risk is not what it is doing
  // now (the lead says its own why).
  const risk = day.atRisk !== null && day.atRisk !== day.lead ? day.atRisk.exceptionDetail : null;
  const folds = !wall && day.others.length > 0;
  return (
    <li className="dayboard-room-item" id={roomAnchor(day.room.id)}>
      {/* Out of the tab order but focusable, so a room the day's sentence
          links to takes the keyboard and a screen reader there, not only
          the eye. */}
      <section className="dayboard-room" aria-label={day.room.name} data-room={day.room.id} data-tone={day.tone} tabIndex={wall ? undefined : -1}>
        {photo === null
          ? <span className="dayboard-room-photo is-blank" aria-hidden="true">{day.room.name.slice(0, 1)}</span>
          : (
            <img
              className="dayboard-room-photo"
              src={photo.src}
              srcSet={photo.srcSet}
              sizes={wall ? "(min-width: 1600px) 420px, 26vw" : "(max-width: 760px) 64px, 116px"}
              alt=""
              loading="lazy"
              decoding="async"
              style={{ objectPosition: photo.objectPosition }}
            />
          )}
        <div className="dayboard-room-main">
          <h2 className="dayboard-room-name">{day.room.name}</h2>
          {day.lead === null
            ? <p className="dayboard-now-free">{day.slots.length > 0 ? "Done for the day." : "Nothing scheduled."}</p>
            : slab(day.lead, "lead")}
          {risk !== null && <p className="dayboard-room-why">{risk}</p>}
          {(then !== null || folds) && (
            <div className="dayboard-room-foot">
              {then !== null && <p className="dayboard-then">{then}</p>}
              {folds && (
                <button
                  type="button"
                  className="dayboard-today-toggle"
                  aria-expanded={unfolded}
                  aria-controls={listId}
                  onClick={() => { setUnfolded((open) => !open); }}
                >
                  {today ? "All of today" : "All of the day"}
                </button>
              )}
            </div>
          )}
          {/* Every other slot of the room, in time order; on paper it prints
              whether or not it is unfolded. */}
          {folds && (
            <ul className="dayboard-today-list" id={listId} hidden={!unfolded}>
              {day.others.map((slot) => <li key={slot.bookingId}>{slab(slot, "line")}</li>)}
            </ul>
          )}
        </div>
      </section>
      {children}
    </li>
  );
}
