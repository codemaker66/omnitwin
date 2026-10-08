import { memo, useEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import type {
  CalendarTurnaroundRule,
  CalendarEntry,
  CalendarRoom,
  ConflictSeverity,
} from "@omnitwin/types";
import { BOARD_COPY, ordinal } from "../board-copy.js";
import { diaryRoomPhoto, DIARY_ROOM_PHOTO_SIZES } from "../../../lib/diary-room-photos.js";
import {
  TRADES_HALL_ROOM_CAPACITIES,
  VENUE_TRUTH_PROVENANCE,
  type PublishedRoomSlug,
} from "@omnitwin/types";
import {
  dayColumns,
  formatWallTime,
  hourTicks,
  msToX,
  snapMs,
  widthPx,
  type BoardRange,
  type DayColumn,
} from "../lib/board-time.js";
import { decisionAge } from "../lib/decision-age.js";
import { laneGaps, laneUtilisation, layoutLane, type LaneGap, type LaneLayout, type PositionedBlock } from "../lib/board-layout.js";
import { changeoverDuration, changeoverDurationWords } from "../../../components/dashboard/changeovers/changeover-format.js";
import type { Ghost } from "../lib/board-drag.js";
import { dayOpeningMs } from "../lib/day-opening.js";
import type { BoardDrag, DragBlockDescriptor } from "../hooks/useBoardDrag.js";

// ---------------------------------------------------------------------------
// BoardGrid (T-493; Canon §8/§18 concept A) — rooms as lanes on a horizontal
// time axis. DOM-first: absolutely positioned blocks inside scrollable lanes,
// sticky room rail, sticky axis, brass now-line. Disclosure follows the zoom:
// colour survives everything, then title, then times (Canon §8 priority).
// ---------------------------------------------------------------------------

const SUB_ROW_HEIGHT = 80;
const BLOCK_HEIGHT = 68;
const LANE_PADDING = 14;
const MIN_BLOCK_WIDTH = 1;
const TITLE_MIN_WIDTH = 42;
const TIME_MIN_WIDTH = 88;
const FACE_MIN_WIDTH = 150;
const COUNTDOWN_WINDOW_MS = 4 * 3_600_000;
const SEGMENT_LABEL_MIN_PX = 46;
/** "Provisional, no option yet" crowds out the title below this. */
const UNRANKED_CHIP_MIN_WIDTH = 300;
const GAP_LABEL_MIN_PX = 56;
const GAP_NOTE_MIN_PX = 120;
const CREATE_SNAP_MINUTES = 15;

/** Create-in-context on the timeline (T-619). A pointer says WHERE and the
 *  instant is read from it; a keyboard cannot, so it falls back to `day` —
 *  the day the board is showing — whose label is also what the control
 *  announces, so what a screen reader hears is what the control does. */
export interface BoardCreate {
  readonly at: (spaceId: string, startMs: number) => void;
  readonly onDay: (spaceId: string, dayStartMs: number) => void;
  readonly day: { readonly startMs: number; readonly label: string };
}

export interface BoardGridProps {
  readonly rooms: readonly CalendarRoom[];
  readonly entries: readonly CalendarEntry[];
  readonly range: BoardRange;
  readonly pxPerHour: number;
  readonly conflictSeverity: ReadonlyMap<string, ConflictSeverity>;
  readonly drag: BoardDrag;
  readonly writable: boolean;
  readonly nowMs: number;
  readonly onOpenBlock?: (blockId: string) => void;
  /** Undefined for a read-only role — there is then no create control. */
  readonly create?: BoardCreate;
  /** The venue's turnaround rules (optional on the wire) — gap dimensions
   *  degrade to plain durations when an older server omits them. */
  readonly turnaroundRules?: readonly CalendarTurnaroundRule[];
  /** Opens the changeover sheet for a gap (T-637); undefined leaves a gap's
   *  time as a plain label. `opener` takes focus back when the sheet closes. */
  readonly onOpenGap?: OpenGap;
  /** The range is on its way: rooms and days stand, and nothing is claimed
   *  about bookings the board has not read (no counts, no "0%"). */
  readonly pending?: boolean;
}

export type OpenGap = (room: { readonly id: string; readonly name: string }, gap: LaneGap, opener: HTMLElement) => void;


/** A hold's option as its block shows it: in full where the block is wide
 *  enough to keep its title, as the copper numeral alone where it is narrow
 *  (roadmap N3). The block's label always says it in full. */
function rankChip(block: PositionedBlock, width: number): string | null {
  const { entry } = block;
  if (entry.kind !== "hold") return null;
  const roomy = width >= FACE_MIN_WIDTH;
  if (entry.rank === null) return width >= UNRANKED_CHIP_MIN_WIDTH ? BOARD_COPY.block.unranked : null;
  if (entry.rank === 1 && entry.jointFlag) return roomy ? BOARD_COPY.block.jointFirst : BOARD_COPY.block.jointFirstShort;
  return roomy ? BOARD_COPY.block.rank(ordinal(entry.rank)) : ordinal(entry.rank);
}


/** Published reception capacity for the rail, or null — CalendarRoom.slug is
 *  a plain string, so the venue-truth record needs a runtime guard. Only
 *  published figures render; a room the venue publishes no number for shows
 *  none (never a scan-derived guess). */
function railCapacity(slug: string): number | null {
  return slug in TRADES_HALL_ROOM_CAPACITIES
    ? TRADES_HALL_ROOM_CAPACITIES[slug as PublishedRoomSlug].reception
    : null;
}


/** Which band of the day a phase segment belongs to, judged by its midpoint
 *  against the booking window — the same partition a hallkeeper makes:
 *  before doors is setup, after the end is teardown, the rest is live. */
function segmentPhase(
  segment: { readonly startMs: number; readonly endMs: number },
  block: { readonly startMs: number; readonly endMs: number },
): "setup" | "live" | "teardown" {
  const midMs = (segment.startMs + segment.endMs) / 2;
  if (midMs < block.startMs) return "setup";
  if (midMs >= block.endMs) return "teardown";
  return "live";
}

/** Minute-granular duration for the doors countdown ("2h 05m"). */
function countdownLabel(ms: number): string {
  const totalMinutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${String(minutes)}m`;
  return `${String(hours)}h ${String(minutes).padStart(2, "0")}m`;
}


interface BoardBlockProps {
  readonly block: PositionedBlock;
  readonly roomName: string;
  readonly range: BoardRange;
  readonly pxPerHour: number;
  readonly severity: ConflictSeverity | undefined;
  readonly writable: boolean;
  /** The doors countdown, worked out by the lane: the block re-renders only
   *  when its text changes, not on every minute tick. */
  readonly countdown: string | null;
  /** A live hold's decision age once a week or less remains (roadmap N3),
   *  worked out by the lane in the same way. */
  readonly decision: string | null;
  readonly beingDragged: boolean;
  /** A finger or pen is carrying this block: only it stops the page scrolling. */
  readonly lifted: boolean;
  readonly handlersFor: BoardDrag["handlersFor"];
  readonly onOpenBlock: ((blockId: string) => void) | undefined;
}

/** One booking block. Memoised: its props are primitives or references that
 *  survive a drag move, so a pointermove re-renders the ghost, not the board. */
const BoardBlock = memo(function BoardBlock({
  block,
  roomName,
  range,
  pxPerHour,
  severity,
  writable,
  countdown,
  decision,
  beingDragged,
  lifted,
  handlersFor,
  onOpenBlock,
}: BoardBlockProps): ReactElement {
  const clampedStart = Math.max(block.startMs, range.fromMs);
  const clampedEnd = Math.min(block.endMs, range.toMs);
  const left = msToX(clampedStart, range, pxPerHour);
  const width = Math.max(
    msToX(clampedEnd, range, pxPerHour) - left,
    MIN_BLOCK_WIDTH,
  );
  const chip = rankChip(block, width);
  const option = rankChip(block, Number.POSITIVE_INFINITY);
  const isActive = block.entry.status === "active";
  const descriptor: DragBlockDescriptor = {
    id: block.entry.id,
    title: block.entry.title,
    spaceId: block.entry.spaceId,
    startMs: block.startMs,
    endMs: block.endMs,
    isInk: block.entry.kind === "ink",
  };
  const handlers = isActive ? handlersFor(descriptor) : { onClick: () => { onOpenBlock?.(block.entry.id); } };
  const timeLabel = `${formatWallTime(block.startMs)}–${formatWallTime(block.endMs)}`;
  const clientName = block.entry.clientName ?? null;
  const guestCount = block.entry.guestCount ?? null;
  const faceParts = [
    clientName,
    guestCount === null || guestCount === 0 ? null : BOARD_COPY.card.guests(guestCount),
  ].filter((part): part is string => part !== null);
  const stateClass = `is-${block.entry.status === "active" ? block.entry.kind : "exited"}`;
  const ariaLabel = `${block.entry.title} — ${BOARD_COPY.legend[block.entry.kind]}, ${timeLabel}, ${roomName}${faceParts.length === 0 ? "" : `, ${faceParts.join(", ")}`}${countdown === null ? "" : `, ${countdown}`}${option === null ? "" : `, ${option}`}${decision === null ? "" : `, ${decision}`}${severity === undefined ? "" : ", has a conflict"}${writable && isActive ? `. ${BOARD_COPY.drag.grabHint}` : ""}`;

  return (
    <button
      type="button"
      id={`diary-block-${block.entry.id}`}
      className={[
        "diary-block",
        stateClass,
        severity !== undefined ? `has-conflict-${severity}` : "",
        beingDragged ? "is-dragging" : "",
        lifted ? "is-lifted" : "",
        block.startMs < range.fromMs ? "is-clipped-start" : "",
        block.endMs > range.toMs ? "is-clipped-end" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        left,
        width,
        top: LANE_PADDING + block.subRow * SUB_ROW_HEIGHT,
        height: BLOCK_HEIGHT,
      }}
      aria-label={ariaLabel}
      {...handlers}
    >
      <span
        className="diary-block-card"
      >
      <span className="diary-block-main">
        {width >= TITLE_MIN_WIDTH ? (
          <span className="diary-block-title">{block.entry.title}</span>
        ) : null}
        {countdown !== null && width >= TIME_MIN_WIDTH ? (
          <span className="diary-block-countdown">{countdown}</span>
        ) : null}
        {chip !== null && width >= TIME_MIN_WIDTH ? (
          <span className="diary-block-chip">{chip}</span>
        ) : null}
      </span>
      {width >= TIME_MIN_WIDTH ? (
        <span className="diary-block-face">
          <span className="diary-block-time">{timeLabel}</span>
          {/* The face's second line: a near decision before the client, and
              the conflict's word beside it, in the flow so it covers nothing. */}
          {((decision !== null || faceParts.length > 0) && width >= FACE_MIN_WIDTH) || severity !== undefined ? (
            <span className="diary-block-note">
              {width < FACE_MIN_WIDTH ? null : decision !== null ? (
                <span className="diary-block-decision">{decision}</span>
              ) : faceParts.length > 0 ? (
                <span className="diary-block-client">{faceParts.join(" · ")}</span>
              ) : null}
              {severity === undefined ? null : (
                // Every conflict edge comes with its word (roadmap N3).
                <span className={`diary-block-stamp is-${severity}`} aria-hidden="true">
                  {severity === "blocking" ? "Conflict" : "Review"}
                </span>
              )}
            </span>
          ) : null}
        </span>
      ) : null}
      {block.segments.length > 0 && width >= TITLE_MIN_WIDTH ? (
        // The card's run of show, drawn as a SCHEMATIC over
        // the occupancy extent (setup phases live before
        // doors, teardown after the end — clamping them to
        // the booking window would erase them). The booking
        // window itself is the LIVE band. Decoration with
        // titles; the timeline's positional truth stays
        // with the blocks and phases themselves.
        <span className="diary-block-segments" aria-hidden="true">
          {(() => {
            const extentStart = Math.min(
              block.startMs,
              ...block.segments.map((segment) => segment.startMs),
            );
            const extentEnd = Math.max(
              block.endMs,
              ...block.segments.map((segment) => segment.endMs),
            );
            const total = extentEnd - extentStart;
            const bands = [
              ...block.segments.map((segment) => ({
                id: segment.id,
                name: segment.name,
                startMs: segment.startMs,
                endMs: segment.endMs,
                phase: segmentPhase(segment, block),
              })),
              {
                id: `${block.entry.id}:live`,
                name: block.entry.title,
                startMs: block.startMs,
                endMs: block.endMs,
                phase: "live" as const,
              },
            ];
            return bands.map((band) => {
              const bandWidthPx = ((band.endMs - band.startMs) / total) * width;
              return (
                <span
                  key={band.id}
                  className={`diary-block-segment is-${band.phase}`}
                  style={{
                    left: `${String(((band.startMs - extentStart) / total) * 100)}%`,
                    width: `${String(((band.endMs - band.startMs) / total) * 100)}%`,
                  }}
                  title={`${BOARD_COPY.card.segments[band.phase]} · ${band.name}`}
                >
                  {bandWidthPx >= SEGMENT_LABEL_MIN_PX ? BOARD_COPY.card.segments[band.phase] : null}
                </span>
              );
            });
          })()}
        </span>
      ) : null}
      </span>
    </button>
  );
});

interface BoardLaneProps {
  readonly room: CalendarRoom;
  readonly lane: LaneLayout;
  readonly columns: readonly DayColumn[];
  readonly range: BoardRange;
  readonly pxPerHour: number;
  readonly canvasWidth: number;
  readonly conflictSeverity: ReadonlyMap<string, ConflictSeverity>;
  readonly writable: boolean;
  readonly nowMs: number;
  readonly turnaroundRules: readonly CalendarTurnaroundRule[] | undefined;
  readonly handlersFor: BoardDrag["handlersFor"];
  readonly onOpenBlock: ((blockId: string) => void) | undefined;
  /** The lifted block, if any — constant for the whole drag. */
  readonly activeBlockId: string | null;
  /** The block a finger or pen carries, if any — constant for the drag. */
  readonly liftedBlockId: string | null;
  readonly create: BoardCreate | undefined;
  /** The ghost only while it is over THIS lane, so a drag move re-renders
   *  the lanes it leaves and enters and no others. */
  readonly ghost: Ghost | null;
  readonly onOpenGap: OpenGap | undefined;
  readonly pending: boolean;
}

/** One room: its rail and its lane of columns, gaps, phases, blocks, ghost. */
const BoardLane = memo(function BoardLane({
  room,
  lane,
  columns,
  range,
  pxPerHour,
  canvasWidth,
  conflictSeverity,
  writable,
  nowMs,
  turnaroundRules,
  handlersFor,
  onOpenBlock,
  activeBlockId,
  liftedBlockId,
  create,
  ghost,
  onOpenGap,
  pending,
}: BoardLaneProps): ReactElement {
  const photo = diaryRoomPhoto(room.slug);
  const laneHeight = Math.max(118, lane.subRowCount * SUB_ROW_HEIGHT + LANE_PADDING * 2);
  const activeBookings = lane.blocks.filter((block) => block.entry.status === "active");
  const inkCount = activeBookings.filter((block) => block.entry.kind === "ink").length;
  const holdCount = activeBookings.filter((block) => block.entry.kind === "hold").length;

  return (
    <div className="diary-lane-row" role="row">
      <div className="diary-rail" role="rowheader">
        {/* The room's own scan poster (lightweight tier) — a broken
            or missing file collapses to the typographic rail. */}
        {photo === null ? null : <img
          className="diary-rail-photo"
          src={photo.src}
          srcSet={photo.srcSet}
          sizes={DIARY_ROOM_PHOTO_SIZES}
          style={{ objectPosition: photo.objectPosition }}
          alt=""
          loading="lazy"
          decoding="async"
          width={photo.width}
          height={photo.height}
          onError={(event) => { event.currentTarget.classList.add("is-missing"); }}
        />}
        <span className="diary-rail-id">
          <span className="diary-rail-name">{room.name}</span>
          {railCapacity(room.slug) !== null ? (
            <span
              className="diary-rail-capacity"
              title={VENUE_TRUTH_PROVENANCE.capacities}
            >
              {railCapacity(room.slug)} reception
            </span>
          ) : null}
          <span className={`diary-rail-counts${pending ? " is-pending" : ""}`} aria-hidden={pending || undefined}>
            <span className="diary-rail-count is-ink">
              {BOARD_COPY.lane.inkCount(inkCount)}
            </span>
            <span className="diary-rail-count is-hold">
              {BOARD_COPY.lane.holdCount(holdCount)}
            </span>
          </span>
          {(() => {
            const pct = Math.round(laneUtilisation(lane.blocks, range) * 100);
            return (
              <span
                className={`diary-rail-utilisation${pending ? " is-pending" : ""}`}
                aria-hidden={pending || undefined}
                title={BOARD_COPY.rail.utilisationNote}
              >
                {pct}%
              </span>
            );
          })()}
        </span>
      </div>
      <div
        className="diary-lane"
        data-diary-lane={room.id}
        style={{ width: canvasWidth, height: laneHeight }}
      >
        {/* Create-in-context (T-619). Empty lane space is the natural place
            to say "put something here". The control sits UNDER the blocks
            (z-index 1 against their 2), so it is only reached where the lane
            is genuinely free, and it is a <button> so the keyboard and a
            screen reader reach it too. A keyboard activation reports
            detail 0 and no position of its own, so it takes the day the
            board is showing rather than a time derived from a meaningless
            clientX. */}
        {create === undefined ? null : (
          <button
            type="button"
            className="diary-lane-new"
            aria-label={BOARD_COPY.create.laneLabel(room.name, create.day.label)}
            onClick={(event) => {
              if (event.detail === 0) {
                create.onDay(room.id, create.day.startMs);
                return;
              }
              const bounds = event.currentTarget.getBoundingClientRect();
              const offsetMs = ((event.clientX - bounds.left) / pxPerHour) * 3_600_000;
              const clicked = snapMs(range.fromMs + offsetMs, CREATE_SNAP_MINUTES);
              create.at(
                room.id,
                Math.min(Math.max(clicked, range.fromMs), range.toMs - CREATE_SNAP_MINUTES * 60_000),
              );
            }}
          />
        )}
        {columns.map((column) => (
          <div
            key={column.startMs}
            className={`diary-lane-col${column.isWeekend ? " is-weekend" : ""}`}
            style={{
              left: msToX(column.startMs, range, pxPerHour),
              width: widthPx(column.startMs, column.endMs, pxPerHour),
            }}
            aria-hidden="true"
          />
        ))}

        {laneGaps(lane.blocks, turnaroundRules, room.id).map((gap) => {
          const gapStart = Math.max(gap.startMs, range.fromMs);
          const gapEnd = Math.min(gap.endMs, range.toMs);
          if (gapEnd <= gapStart) return null;
          const gapLeft = msToX(gapStart, range, pxPerHour);
          const gapWidth = widthPx(gapStart, gapEnd, pxPerHour);
          if (gapWidth < GAP_LABEL_MIN_PX) return null;
          // The time, in Venue settings' words ("2 h 30"), and beside a gap
          // shorter than the room's changeover time, what the room needs.
          const chip = (
            <>
              <span className="diary-gap-label">{changeoverDuration(gap.minutes)}</span>
              {gap.tight && gap.guidelineMinutes !== null && gapWidth >= GAP_NOTE_MIN_PX ? (
                <span className="diary-gap-note">
                  {BOARD_COPY.card.tightGap(changeoverDuration(gap.guidelineMinutes))}
                </span>
              ) : null}
            </>
          );
          const needs = gap.tight && gap.guidelineMinutes !== null
            ? `, ${BOARD_COPY.card.tightGap(changeoverDurationWords(gap.guidelineMinutes))}`
            : "";
          return (
            <span
              key={gap.id}
              className={`diary-gap${gap.tight ? " is-tight" : ""}`}
              style={{ left: gapLeft, width: gapWidth }}
            >
              <span className="diary-gap-line" aria-hidden="true" />
              {onOpenGap === undefined ? (
                <span className="diary-gap-chip" aria-hidden="true">{chip}</span>
              ) : (
                <button
                  type="button"
                  className="diary-gap-chip"
                  aria-label={`${BOARD_COPY.changeover.gapLabel(room.name, changeoverDurationWords(gap.minutes), gap.before.title, gap.after.title)}${needs}`}
                  onClick={(event) => { onOpenGap({ id: room.id, name: room.name }, gap, event.currentTarget); }}
                >
                  {chip}
                </button>
              )}
            </span>
          );
        })}

        {lane.orphanPhases.map((positioned) => {
          const left = msToX(
            Math.max(positioned.startMs, range.fromMs),
            range,
            pxPerHour,
          );
          const right = msToX(Math.min(positioned.endMs, range.toMs), range, pxPerHour);
          return (
            <div
              key={positioned.phase.id}
              className="diary-phase-strip"
              style={{
                left,
                width: Math.max(right - left, MIN_BLOCK_WIDTH),
                top:
                  LANE_PADDING + positioned.subRow * SUB_ROW_HEIGHT + BLOCK_HEIGHT - 14,
              }}
              title={`${positioned.phase.eventName} — ${positioned.phase.name}`}
            >
              <span className="diary-phase-strip-label">
                {positioned.phase.eventName} · {positioned.phase.name}
              </span>
            </div>
          );
        })}

        {lane.blocks.map((block) => {
          const startsInMs = block.startMs - nowMs;
          const countdown =
            block.entry.status === "active" && block.entry.kind === "ink" && startsInMs > 0 && startsInMs <= COUNTDOWN_WINDOW_MS
              ? BOARD_COPY.card.doorsIn(countdownLabel(startsInMs))
              : null;
          const decision = block.entry.status === "active" && block.entry.kind === "hold" ? decisionAge(block.entry.decisionAt, nowMs) : null;
          return (
            <BoardBlock
              key={block.entry.id}
              block={block}
              roomName={room.name}
              range={range}
              pxPerHour={pxPerHour}
              severity={conflictSeverity.get(block.entry.id)}
              writable={writable}
              countdown={countdown}
              decision={decision}
              beingDragged={activeBlockId === block.entry.id}
              lifted={liftedBlockId === block.entry.id}
              handlersFor={handlersFor}
              onOpenBlock={onOpenBlock}
            />
          );
        })}

        {ghost !== null ? (
          <div
            className={`diary-ghost is-${ghost.validity.kind}`}
            style={{
              left: msToX(Math.max(ghost.startMs, range.fromMs), range, pxPerHour),
              width: Math.max(
                msToX(Math.min(ghost.endMs, range.toMs), range, pxPerHour) -
                  msToX(Math.max(ghost.startMs, range.fromMs), range, pxPerHour),
                MIN_BLOCK_WIDTH,
              ),
            }}
            aria-hidden="true"
          >
            <span className="diary-ghost-time">
              {formatWallTime(ghost.startMs)}–{formatWallTime(ghost.endMs)}
            </span>
            {ghost.validity.kind !== "ok" ? (
              <span className="diary-ghost-reason">{ghost.validity.reason}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

/** Memoised: the page re-renders for toasts, presence and enquiry loads that
 *  leave the board untouched; `drag` keeps one identity per drag state. */
export const BoardGrid = memo(function BoardGrid(props: BoardGridProps): ReactElement {
  const { rooms, entries, range, pxPerHour, conflictSeverity, drag, writable, nowMs, turnaroundRules, onOpenBlock, create, onOpenGap, pending = false } = props;
  const canvasWidth = widthPx(range.fromMs, range.toMs, pxPerHour);
  const columns = useMemo(() => dayColumns(range), [range]);
  const ticks = useMemo(() => (range.view === "day" ? hourTicks(range) : []), [range]);
  const nowVisible = nowMs >= range.fromMs && nowMs < range.toMs;
  const { ghost, activeBlockId, liftedBlockId, handlersFor } = drag;
  // Packing depends only on the entries — never recompute it per pointermove
  // while the drag prop churns (review P2).
  const lanes = useMemo(
    () => new Map(rooms.map((room) => [room.id, layoutLane(entries, room.id)])),
    [rooms, entries],
  );

  // A day opens where the day is (roadmap N3): at the current time today,
  // else at its first booking. Once per day, and only when that day's
  // bookings have been read, so it never fights the booker's own scrolling.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const openedDayRef = useRef<number | null>(null);
  useEffect(() => {
    if (range.view !== "day" || pending || openedDayRef.current === range.fromMs) return;
    openedDayRef.current = range.fromMs;
    const scroller = scrollRef.current;
    if (scroller !== null) scroller.scrollLeft = msToX(dayOpeningMs(range, entries, nowMs), range, pxPerHour);
  }, [entries, nowMs, pending, pxPerHour, range]);

  return (
    <div ref={scrollRef} className={`diary-scroll${pending ? " is-pending" : ""}`} role="region" aria-label={BOARD_COPY.title} aria-busy={pending} tabIndex={0}>
      <div
        className="diary-canvas"
        style={{ width: `calc(var(--diary-rail-width) + ${String(canvasWidth)}px)` }}
      >
        <div className="diary-axis-row" role="row">
          <div className="diary-rail diary-axis-corner" aria-hidden="true" />
          <div className="diary-axis" style={{ width: canvasWidth }}>
            {columns.map((column) => (
              <div
                key={column.startMs}
                className={`diary-axis-day${column.isWeekend ? " is-weekend" : ""}`}
                style={{
                  left: msToX(column.startMs, range, pxPerHour),
                  width: widthPx(column.startMs, column.endMs, pxPerHour),
                }}
              >
                <span className="diary-axis-day-label">{column.label}</span>
              </div>
            ))}
            {ticks.map((tick) => (
              <span
                key={tick.ms}
                className="diary-axis-tick"
                style={{ left: msToX(tick.ms, range, pxPerHour) }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>

        <div className="diary-lanes">
          {rooms.map((room) => (
            <BoardLane
              key={room.id}
              room={room}
              lane={lanes.get(room.id) ?? layoutLane([], room.id)}
              columns={columns}
              range={range}
              pxPerHour={pxPerHour}
              canvasWidth={canvasWidth}
              conflictSeverity={conflictSeverity}
              writable={writable}
              nowMs={nowMs}
              turnaroundRules={turnaroundRules}
              handlersFor={handlersFor}
              onOpenBlock={onOpenBlock}
              activeBlockId={activeBlockId}
              liftedBlockId={liftedBlockId}
              create={create}
              ghost={ghost !== null && ghost.spaceId === room.id ? ghost : null}
              onOpenGap={onOpenGap}
              pending={pending}
            />
          ))}

          {nowVisible ? (
            <div
              className="diary-now"
              style={{
                left: `calc(var(--diary-rail-width) + ${String(msToX(nowMs, range, pxPerHour))}px)`,
              }}
              aria-hidden="true"
            >
              <span className="diary-now-plaque">{BOARD_COPY.nowLabel}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});
