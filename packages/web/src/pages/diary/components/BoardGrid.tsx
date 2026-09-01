import { useMemo } from "react";
import type { ReactElement } from "react";
import type {
  CalendarTurnaroundRule,
  CalendarEntry,
  CalendarRoom,
  ConflictSeverity,
} from "@omnitwin/types";
import { BOARD_COPY } from "../board-copy.js";
import { roomScanPosterUrl } from "../../../lib/room-posters.js";
import {
  TRADES_HALL_ROOM_CAPACITIES,
  VENUE_TRUTH_PROVENANCE,
  type PublishedRoomSlug,
} from "../../../lib/trades-hall-venue-truth.js";
import {
  dayColumns,
  formatWallTime,
  hourTicks,
  msToX,
  widthPx,
  type BoardRange,
} from "../lib/board-time.js";
import { laneGaps, layoutLane, type PositionedBlock } from "../lib/board-layout.js";
import type { BoardDrag, DragBlockDescriptor } from "../hooks/useBoardDrag.js";

// ---------------------------------------------------------------------------
// BoardGrid (T-493; Canon §8/§18 concept A) — rooms as lanes on a horizontal
// time axis. DOM-first: absolutely positioned blocks inside scrollable lanes,
// sticky room rail, sticky axis, brass now-line. Disclosure follows the zoom:
// colour survives everything, then title, then times (Canon §8 priority).
// ---------------------------------------------------------------------------

const SUB_ROW_HEIGHT = 58;
const BLOCK_HEIGHT = 52;
const LANE_PADDING = 6;
const MIN_BLOCK_WIDTH = 12;
const TITLE_MIN_WIDTH = 42;
const TIME_MIN_WIDTH = 88;
const FACE_MIN_WIDTH = 150;
const COUNTDOWN_WINDOW_MS = 4 * 3_600_000;
const SEGMENT_LABEL_MIN_PX = 46;
const GAP_LABEL_MIN_PX = 56;
const GAP_NOTE_MIN_PX = 120;

export interface BoardGridProps {
  readonly rooms: readonly CalendarRoom[];
  readonly entries: readonly CalendarEntry[];
  readonly range: BoardRange;
  readonly pxPerHour: number;
  readonly conflictSeverity: ReadonlyMap<string, ConflictSeverity>;
  readonly drag: BoardDrag;
  readonly writable: boolean;
  readonly nowMs: number;
  /** The venue's turnaround rules (optional on the wire) — gap dimensions
   *  degrade to plain durations when an older server omits them. */
  readonly turnaroundRules?: readonly CalendarTurnaroundRule[];
}

function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${String(rank)}th`;
  switch (rank % 10) {
    case 1:
      return `${String(rank)}st`;
    case 2:
      return `${String(rank)}nd`;
    case 3:
      return `${String(rank)}rd`;
    default:
      return `${String(rank)}th`;
  }
}

function rankChip(block: PositionedBlock): string | null {
  const { entry } = block;
  if (entry.kind !== "hold") return null;
  if (entry.rank === null) return BOARD_COPY.block.unranked;
  if (entry.rank === 1 && entry.jointFlag) return BOARD_COPY.block.jointFirst;
  return BOARD_COPY.block.rank(ordinal(entry.rank));
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


/** Deterministic paper tilt for hold cards: a pencilled slip lies at a
 *  slight, stable angle (same booking, same angle, every render). The tilt
 *  lives on the INNER card, never the positioned button — the drag
 *  hit-rect must stay rectangular. */
function tiltFor(id: string, kind: string, active: boolean): 0 | 1 | 2 {
  if (kind !== "hold" || !active) return 0;
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(hash) % 2) + 1) as 1 | 2;
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

export function BoardGrid(props: BoardGridProps): ReactElement {
  const { rooms, entries, range, pxPerHour, conflictSeverity, drag, writable, nowMs, turnaroundRules } = props;
  const canvasWidth = widthPx(range.fromMs, range.toMs, pxPerHour);
  const columns = dayColumns(range);
  const ticks = range.view === "day" ? hourTicks(range) : [];
  const nowVisible = nowMs >= range.fromMs && nowMs < range.toMs;
  const ghost = drag.ghost;
  // Packing depends only on the entries — never recompute it per pointermove
  // while the drag prop churns (review P2).
  const lanes = useMemo(
    () => new Map(rooms.map((room) => [room.id, layoutLane(entries, room.id)])),
    [rooms, entries],
  );

  return (
    <div className="diary-scroll" role="region" aria-label={BOARD_COPY.title} tabIndex={0}>
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
          {rooms.map((room) => {
            const lane = lanes.get(room.id) ?? layoutLane([], room.id);
            const laneHeight = lane.subRowCount * SUB_ROW_HEIGHT + LANE_PADDING * 2;
            const activeBookings = lane.blocks.filter((block) => block.entry.status === "active");
            const inkCount = activeBookings.filter((block) => block.entry.kind === "ink").length;
            const holdCount = activeBookings.filter((block) => block.entry.kind === "hold").length;

            return (
              <div key={room.id} className="diary-lane-row" role="row">
                <div className="diary-rail" role="rowheader">
                  {/* The room's own scan poster (lightweight tier) — a broken
                      or missing file collapses to the typographic rail. */}
                  <img
                    className="diary-rail-photo"
                    src={roomScanPosterUrl(room.slug)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={64}
                    height={44}
                    onError={(event) => { event.currentTarget.classList.add("is-missing"); }}
                  />
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
                    <span className="diary-rail-counts">
                      <span className="diary-rail-count is-ink">
                        {BOARD_COPY.lane.inkCount(inkCount)}
                      </span>
                      <span className="diary-rail-count is-hold">
                        {BOARD_COPY.lane.holdCount(holdCount)}
                      </span>
                    </span>
                  </span>
                </div>
                <div
                  className="diary-lane"
                  data-diary-lane={room.id}
                  style={{ width: canvasWidth, height: laneHeight }}
                >
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
                    return (
                      <span
                        key={gap.id}
                        className={`diary-gap${gap.tight ? " is-tight" : ""}`}
                        style={{ left: gapLeft, width: gapWidth }}
                        aria-hidden="true"
                      >
                        <span className="diary-gap-line" />
                        <span className="diary-gap-label">{countdownLabel(gap.endMs - gap.startMs)}</span>
                        {gap.tight && gap.guidelineMinutes !== null && gapWidth >= GAP_NOTE_MIN_PX ? (
                          <span className="diary-gap-note">
                            {BOARD_COPY.card.tightGap(gap.guidelineMinutes)}
                          </span>
                        ) : null}
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
                    const clampedStart = Math.max(block.startMs, range.fromMs);
                    const clampedEnd = Math.min(block.endMs, range.toMs);
                    const left = msToX(clampedStart, range, pxPerHour);
                    const width = Math.max(
                      msToX(clampedEnd, range, pxPerHour) - left,
                      MIN_BLOCK_WIDTH,
                    );
                    const severity = conflictSeverity.get(block.entry.id);
                    const chip = rankChip(block);
                    const isActive = block.entry.status === "active";
                    const descriptor: DragBlockDescriptor = {
                      id: block.entry.id,
                      title: block.entry.title,
                      spaceId: block.entry.spaceId,
                      startMs: block.startMs,
                      endMs: block.endMs,
                      isInk: block.entry.kind === "ink",
                    };
                    const handlers = isActive ? drag.handlersFor(descriptor) : {};
                    const timeLabel = `${formatWallTime(block.startMs)}–${formatWallTime(block.endMs)}`;
                    const startsInMs = block.startMs - nowMs;
                    const countdown =
                      isActive && block.entry.kind === "ink" && startsInMs > 0 && startsInMs <= COUNTDOWN_WINDOW_MS
                        ? BOARD_COPY.card.doorsIn(countdownLabel(startsInMs))
                        : null;
                    const clientName = block.entry.clientName ?? null;
                    const guestCount = block.entry.guestCount ?? null;
                    const faceParts = [
                      clientName,
                      guestCount === null || guestCount === 0 ? null : BOARD_COPY.card.guests(guestCount),
                    ].filter((part): part is string => part !== null);
                    const stateClass = `is-${block.entry.status === "active" ? block.entry.kind : "exited"}`;
                    const beingDragged = drag.activeBlockId === block.entry.id;
                    const ariaLabel = `${block.entry.title} — ${BOARD_COPY.legend[block.entry.kind]}, ${timeLabel}, ${room.name}${faceParts.length === 0 ? "" : `, ${faceParts.join(", ")}`}${countdown === null ? "" : `, ${countdown}`}${chip === null ? "" : `, ${chip}`}${severity === undefined ? "" : ", has a conflict"}${writable && isActive ? `. ${BOARD_COPY.drag.grabHint}` : ""}`;

                    return (
                      <button
                        key={block.entry.id}
                        type="button"
                        id={`diary-block-${block.entry.id}`}
                        className={[
                          "diary-block",
                          stateClass,
                          severity !== undefined ? `has-conflict-${severity}` : "",
                          beingDragged ? "is-dragging" : "",
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
                          data-tilt={tiltFor(block.entry.id, block.entry.kind, isActive)}
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
                            {faceParts.length > 0 && width >= FACE_MIN_WIDTH ? (
                              <span className="diary-block-client">{faceParts.join(" · ")}</span>
                            ) : null}
                          </span>
                        ) : null}
                        {block.segments.length > 0 && width >= TITLE_MIN_WIDTH ? (
                          <span className="diary-block-segments" aria-hidden="true">
                            {block.segments.map((segment) => {
                              const segStart = Math.max(segment.startMs, block.startMs);
                              const segEnd = Math.min(segment.endMs, block.endMs);
                              const total = block.endMs - block.startMs;
                              const phase = segmentPhase(segment, block);
                              const segWidthPx = ((segEnd - segStart) / total) * width;
                              return (
                                <span
                                  key={segment.id}
                                  className={`diary-block-segment is-${phase}`}
                                  style={{
                                    left: `${String(((segStart - block.startMs) / total) * 100)}%`,
                                    width: `${String(((segEnd - segStart) / total) * 100)}%`,
                                  }}
                                  title={`${BOARD_COPY.card.segments[phase]} · ${segment.name}`}
                                >
                                  {segWidthPx >= SEGMENT_LABEL_MIN_PX ? BOARD_COPY.card.segments[phase] : null}
                                </span>
                              );
                            })}
                          </span>
                        ) : null}
                        {severity === "blocking" ? (
                          <span className="diary-block-stamp" aria-hidden="true">
                            Conflict
                          </span>
                        ) : null}
                        </span>
                      </button>
                    );
                  })}

                  {ghost !== null && ghost.spaceId === room.id ? (
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
          })}

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
}
