import type { CSSProperties, ReactElement, ReactNode } from "react";
import {
  AlertTriangle, Bell, Check, Clock, DoorOpen, Link2, Radio, RotateCcw, UserCheck, Users, WifiOff, Wrench,
} from "lucide-react";
import { observationMeansOver } from "@omnitwin/types";
import { formatWallTime } from "../diary/lib/board-time.js";
import { roomPhoto } from "../../components/dashboard/enquiries/enquiry-room-photo.js";
import { formatMinutes, runsForDays, type DayBoardIcon, type DayBoardSlot, type SlotAttention } from "./lib/day-board-state.js";
import { gapGeometry, slabGeometry, type BoardWindow, type RulerTick, type Span } from "./lib/day-board-layout.js";
import type { RoomDay } from "./lib/day-board-rooms.js";
import { crewWords, type TurnRoundCrew } from "./lib/turn-round-crew.js";
import { useBreathPhase } from "./lib/use-board-clock.js";

// ---------------------------------------------------------------------------
// The rooms of the Day Board (concept C): one row per room on the ivory
// sheet, its photograph and name, then its day in words — what finished
// earlier, what the room is doing or will do first (the lead), what comes
// next and what comes after — and a bar of the whole day under it with the
// present marked. Every slot is one element, a "slab", whose verb carries its
// state in words beside an icon and a tone (D3); a tap on it opens the slot.
// On the wall nothing opens (D11): a slab there is a group, not a button.
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

/** A fraction of the window as a CSS percentage, to two decimals. */
export function percent(fraction: number): string {
  return `${String(Math.round(fraction * 10_000) / 100)}%`;
}

function across(span: Span): CSSProperties {
  return { left: percent(span.left), width: percent(span.width) };
}

/** The ring's words: who has it, or how many wait and for how long. */
export function ringWords(slot: DayBoardSlot, nowMs: number): string | null {
  const ring = slot.attention;
  if (ring === null) return null;
  if (ring.level === "owned") return ring.ownerName === null ? "In hand" : `${ring.ownerName} has this`;
  const waiting = ring.waitingSinceMs === null ? "" : ` · waiting ${formatMinutes((nowMs - ring.waitingSinceMs) / 60_000)}`;
  const head = ring.unownedCount === 1 ? "1 request" : `${String(ring.unownedCount)} requests`;
  return `${ring.level === "urgent" ? "URGENT · " : ""}${head} · nobody has this${waiting}`;
}

/** The ring's words on the wall, read from across a corridor: "2 waiting ·
 *  30 min", "Urgent · 1 waiting · 8 min", or who has it. */
export function wallRingWords(slot: DayBoardSlot, nowMs: number): string | null {
  const ring = slot.attention;
  if (ring === null) return null;
  if (ring.level === "owned") return ring.ownerName === null ? "In hand" : `${ring.ownerName} has this`;
  const waited = ring.waitingSinceMs === null ? "" : ` · ${formatMinutes((nowMs - ring.waitingSinceMs) / 60_000)}`;
  return `${ring.level === "urgent" ? "Urgent · " : ""}${String(ring.unownedCount)} waiting${waited}`;
}

/** The copper ring on a slot with open requests. Its halo breathes while
 *  nobody owns the request and pulses while it is urgent; the words stay at
 *  full ink and carry the count themselves. Keyed by the parent to the
 *  newest request, so an arrival remounts it and its one stamp plays once. */
function Ring({ ring, words, frozen }: {
  readonly ring: SlotAttention;
  readonly words: string;
  readonly frozen: boolean;
}): ReactElement {
  const phase = useBreathPhase(`${ring.level}|${frozen ? "frozen" : "live"}`);
  const Icon = ring.level === "owned" ? UserCheck : ring.level === "urgent" ? AlertTriangle : Bell;
  return (
    <span
      className="dayboard-ring"
      data-level={ring.level}
      data-arrived={ring.arrived ? "true" : "false"}
      style={{ "--lt-epoch-phase-ms": String(phase) } as CSSProperties}
    >
      <Icon size={13} aria-hidden="true" />
      <span className="dayboard-ring-words">{words}</span>
    </span>
  );
}

export type SlabVariant = "lead" | "next" | "line";

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
 *  room has between functions, what the rule needs when that is short, and
 *  who is on setup for it when the rota plans setup. Once setup is due it
 *  has been spent; a changeover at risk says why in its own words. */
function turnRound(slot: DayBoardSlot, nowMs: number, crew: TurnRoundCrew | null): string | null {
  const gap = slot.gapBefore;
  if (gap === null || nowMs >= slot.setupStartsAtMs || slot.exception !== null) return null;
  const time = gap.short && gap.neededMinutes !== null
    ? `Turn-round ${formatMinutes(gap.minutes)} · needs ${formatMinutes(gap.neededMinutes)}`
    : `Turn-round ${formatMinutes(gap.minutes)}`;
  return crew === null ? time : `${time} · ${crewWords(crew)}`;
}

/** One slot on its room: the state's dot, icon and verb, the title, and for
 *  the lead its facts, what was seen, why it is at risk and the ring. */
export function Slab({ slot, variant, nowMs, selected, onOpen, wall, frozen, changed = 0, crew = null }: {
  readonly slot: DayBoardSlot;
  readonly variant: SlabVariant;
  readonly nowMs: number;
  readonly selected: boolean;
  readonly onOpen: (bookingId: string) => void;
  readonly wall: boolean;
  readonly frozen: boolean;
  /** Changes on the slot's event nobody on the floor has acknowledged yet. */
  readonly changed?: number;
  /** Who is on setup for the turn-round before it, when the rota plans setup. */
  readonly crew?: TurnRoundCrew | null;
}): ReactElement {
  // The breath samples its phase the moment it begins: a new motion, or a
  // freeze lifting, starts a new animation and a new sample (D3 law 1).
  const phase = useBreathPhase(`${slot.motion}|${frozen ? "frozen" : "live"}`);
  const ring = slot.attention;
  const words = ringWords(slot, nowMs);
  const seen = seenLine(slot);
  const changedWords = changed === 0 ? null : changed === 1 ? "a change to read" : `${String(changed)} changes to read`;
  // The wall reads room, title, state and time (D11): no turn-round, no
  // facts seen, no other rooms named; the ring in its short words on what
  // it shows, so a request nobody has still breathes there (D3).
  const gap = variant === "line" || wall ? null : turnRound(slot, nowMs, crew);
  const label = `${slot.title}, ${slot.timeRange}, ${slot.countdown}${words === null ? "" : `, ${words}`}${changedWords === null ? "" : `, ${changedWords}`}${gap === null ? "" : `, ${gap}`}${seen === null ? "" : `, ${seen}`}`;
  const linked = slot.linkedRooms.length > 0 ? `also ${slot.linkedRooms.join(", ")}` : null;
  const why = slot.exceptionDetail ?? slot.turnaroundWarning;
  const shownSeen = wall ? null : seen;
  const shownWords = wall ? wallRingWords(slot, nowMs) : words;
  const ringed = ring !== null && shownWords !== null
    ? <Ring key={slot.requestSignal?.newestId ?? "steady"} ring={ring} words={shownWords} frozen={frozen} />
    : null;
  const shared = {
    className: `dayboard-slab is-${variant} dayboard-tone-${slot.tone}${selected ? " is-selected" : ""}`,
    "data-state": slot.state,
    "data-tone": slot.tone,
    "data-motion": slot.motion,
    "data-attention": ring?.level ?? "none",
    "data-booking": slot.bookingId,
    style: { "--lt-epoch-phase-ms": String(phase) } as CSSProperties,
  };
  const verb = (
    <span className="dayboard-verb">
      <span className="dayboard-dot" aria-hidden="true" />
      <StateIcon icon={slot.icon} size={wall ? 17 : 14} />
      <span className="dayboard-verb-words">{slot.countdown}</span>
    </span>
  );
  const notes = gap !== null || shownSeen !== null
    ? (
      <span className="dayboard-slab-notes">
        {gap !== null && <span className={`dayboard-gap-words${slot.gapBefore?.short === true ? " is-short" : ""}`}>{gap}</span>}
        {shownSeen !== null && <span className="dayboard-slab-seen">{shownSeen}</span>}
      </span>
    )
    : null;
  // A change nobody on the floor has acknowledged: a word in copper beside
  // the title, never a tint on it. Its words are in the label.
  const mark = changed === 0 ? null : (
    <span className="dayboard-slab-changed" aria-hidden="true">
      <span className="dayboard-slab-changed-dot" />{changed === 1 ? "Changed" : `${String(changed)} changes`}
    </span>
  );
  // The ring comes after the words it belongs to, so a narrow row wraps the
  // ring and never the state.
  const face = variant === "line"
    ? (
      <>
        <span className="dayboard-slab-title">{slot.title}</span>
        {mark}
        {verb}
        {seen !== null && <span className="dayboard-slab-seen">{seen}</span>}
        {ringed}
      </>
    )
    : variant === "next"
      ? (
        <>
          <span className="dayboard-slab-head">
            {verb}
            <span className="dayboard-slab-title">{slot.title}</span>
            {mark}
            {notes}
            {ringed}
          </span>
          {why !== null && <span className="dayboard-slab-why">{why}</span>}
        </>
      )
      : (
        <>
          <span className="dayboard-slab-head">
            {verb}
            <span className="dayboard-slab-title">{slot.title}</span>
            {mark}
          </span>
          <span className="dayboard-slab-time">
            <span>{slotFacts(slot)}</span>
            {linked !== null && !wall && <span className="dayboard-linked"><Link2 size={12} aria-hidden="true" />{linked}</span>}
            {ringed}
          </span>
          {notes}
          {why !== null && <span className="dayboard-slab-why">{why}</span>}
        </>
      );
  if (wall) return <div {...shared} role="group" aria-label={label}>{face}</div>;
  return (
    <button {...shared} type="button" aria-pressed={selected} aria-label={label} onClick={() => { onOpen(slot.bookingId); }}>
      {face}
    </button>
  );
}

/** The whole day of one room as a bar: each slot from its setup to the end
 *  of its clear-down, the doors-to-end part solid; a short turn-round as a
 *  red rule; the present as a copper line. A picture of what the words above
 *  it say, so assistive technology is not read it twice. */
function DayBar({ day, view, plaque, selectedId }: {
  readonly day: RoomDay;
  readonly view: BoardWindow;
  readonly plaque: number | null;
  readonly selectedId: string | null;
}): ReactElement {
  return (
    <span className="dayboard-bar" aria-hidden="true">
      {day.slots.map((slot, index) => {
        const geometry = slabGeometry(slot, view);
        const width = geometry.slab.width > 0 ? geometry.slab.width : 1;
        const short = slot.gapBefore?.short === true ? gapGeometry(day.slots[index - 1], slot, view) : null;
        return (
          <span key={slot.bookingId} className="dayboard-bar-slot">
            {short !== null && short.width > 0 && <span className="dayboard-bar-gap" style={across(short)} />}
            <span
              className="dayboard-seg"
              data-tone={slot.tone}
              data-kind={slot.kind}
              data-days={runsForDays(slot.startsAtMs, slot.endsAtMs) ? "true" : undefined}
              data-selected={slot.bookingId === selectedId ? "true" : "false"}
              style={across(geometry.slab)}
            >
              <span className="dayboard-seg-setup" style={{ width: percent(geometry.setup.width / width) }} />
              <span className="dayboard-seg-live" style={{ width: percent(geometry.live.width / width) }} />
              <span className="dayboard-seg-clear" style={{ width: percent(geometry.clearDown.width / width) }} />
            </span>
          </span>
        );
      })}
      {plaque !== null && <span className="dayboard-bar-now" style={{ left: percent(plaque) }} />}
    </span>
  );
}

/** The hours across the rooms and the NOW plaque above them, aligned with
 *  every room's bar: the plaque on its own line, so the present never covers
 *  the hour it is nearest to. */
export function Scale({ ticks, plaque, nowMs, timeZone }: {
  readonly ticks: readonly RulerTick[];
  readonly plaque: number | null;
  readonly nowMs: number;
  readonly timeZone: string;
}): ReactElement {
  return (
    <div className="dayboard-scale" aria-hidden="true">
      <span className="dayboard-scale-track">
        {ticks.map((tick) => (
          <span key={tick.ms} className={`dayboard-tick${tick.major ? " is-major" : ""}`} style={{ left: percent(tick.x) }}>
            {tick.major && <span className="dayboard-tick-label">{tick.label}</span>}
          </span>
        ))}
        {/* Near either end the plaque leans inward, so it never runs past
            the sheet (a phone in the evening, a morning at the start). */}
        {plaque !== null && (
          <span className="dayboard-now" data-edge={plaque > 0.85 ? "end" : plaque < 0.15 ? "start" : "middle"} style={{ left: percent(plaque) }}>
            <span className="dayboard-now-plaque">NOW<span className="dayboard-now-time">{formatWallTime(nowMs, timeZone)}</span></span>
          </span>
        )}
      </span>
    </div>
  );
}

/** "4 bookings", or that nothing is booked. */
function bookingCount(count: number): string {
  if (count === 0) return "Nothing scheduled.";
  return count === 1 ? "1 booking" : `${String(count)} bookings`;
}

/** One room: its photograph, its name and its day. `children` is the open
 *  slot, when it unfolds under its own room (the narrow desk and the phone). */
export function RoomRow({ day, view, plaque, nowMs, venueSlug, selectedId, onOpen, wall, frozen, changed, crew, children }: {
  readonly day: RoomDay;
  /** Changes to read, by booking. */
  readonly changed?: ReadonlyMap<string, number>;
  /** Who is on setup for each turn-round, by the booking it leads to. */
  readonly crew?: ReadonlyMap<string, TurnRoundCrew>;
  readonly view: BoardWindow;
  readonly plaque: number | null;
  readonly nowMs: number;
  readonly venueSlug: string | null;
  readonly selectedId: string | null;
  readonly onOpen: (bookingId: string) => void;
  readonly wall: boolean;
  readonly frozen: boolean;
  readonly children?: ReactNode;
}): ReactElement {
  const photo = venueSlug === null ? null : roomPhoto(venueSlug, day.room.slug);
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
      changed={changed?.get(slot.bookingId) ?? 0}
      crew={crew?.get(slot.bookingId) ?? null}
    />
  );
  // The wall reads the room, what it is doing and what is next (D11).
  const earlier = wall ? [] : day.earlier;
  const later = wall ? [] : day.later;
  return (
    <li className="dayboard-room-item">
      <section className="dayboard-room" aria-label={day.room.name} data-room={day.room.id} data-tone={day.tone}>
        {photo === null
          ? <span className="dayboard-room-photo is-blank" aria-hidden="true">{day.room.name.slice(0, 1)}</span>
          : (
            <img
              className="dayboard-room-photo"
              src={photo.src}
              srcSet={photo.srcSet}
              sizes={wall ? "136px" : "96px"}
              alt=""
              loading="lazy"
              decoding="async"
              style={{ objectPosition: photo.objectPosition }}
            />
          )}
        <div className="dayboard-room-main">
          <header className="dayboard-room-head">
            <h2 className="dayboard-room-name">{day.room.name}</h2>
            <p className="dayboard-room-count">{bookingCount(day.slots.length)}</p>
          </header>
          {/* Divisions, not paragraphs: on the wall a slot is a group. */}
          {earlier.length > 0 && (
            <div className="dayboard-line is-earlier">
              <span className="dayboard-line-label">Earlier</span>
              <span className="dayboard-line-items">{earlier.map((slot) => slab(slot, "line"))}</span>
            </div>
          )}
          {day.lead !== null && slab(day.lead, "lead")}
          {day.lead === null && day.slots.length > 0 && <p className="dayboard-line is-free">Done for the day.</p>}
          {day.next !== null && (
            <div className="dayboard-line is-next">
              <span className="dayboard-line-label">{day.nextLabel}</span>
              <span className="dayboard-line-items">{slab(day.next, "next")}</span>
            </div>
          )}
          {later.length > 0 && (
            <div className="dayboard-line is-later">
              <span className="dayboard-line-label">Later</span>
              <span className="dayboard-line-items">{later.map((slot) => slab(slot, "line"))}</span>
            </div>
          )}
          {day.slots.length > 0 && <DayBar day={day} view={view} plaque={plaque} selectedId={selectedId} />}
        </div>
      </section>
      {children}
    </li>
  );
}
